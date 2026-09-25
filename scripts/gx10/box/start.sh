#!/usr/bin/env bash
# On the GX10: (re)start MongoDB, Kami's Eye and the Kami server. Everything Kami computes happens on
# this box: the game is served from here, memory is this MongoDB, rules are compiled by this Ollama, and
# sketches are recognised by the Eye sidecar — or by the server's own k-NN when no trained model is here.
# Which trained model is live is the one name in ~/kami-ml/artifacts/LIVE (kami-eye when there is no such file).
# The same sidecar finishes drawings (/complete) when its model has an exemplar set (ml/exemplars.py),
# and the server summons drawings by name from that set (KAMI_SKETCHES), all 345 categories.
set -euo pipefail
cd -P "$(dirname "$0")/.."
PORT=${PORT:-8787}
TLS_PORT=${TLS_PORT:-8443}
MONGO_PORT=27017
EYE_PORT=${KAMI_EYE_PORT:-8790}
EYE_URL="http://127.0.0.1:$EYE_PORT"
EYE_HEALTH_ATTEMPTS=120
ML_HOME=~/kami-ml
LIVE_MODEL_FILE=$ML_HOME/artifacts/LIVE
EYE_MODEL_NAME=${KAMI_EYE_MODEL_NAME:-$(cat "$LIVE_MODEL_FILE" 2>/dev/null || echo kami-eye)}
MODEL=${KAMI_LLM_MODEL:-qwen3.8:latest}
export MONGODB_URI="mongodb://127.0.0.1:$MONGO_PORT"

ensure_tls_cert() {
  local cert=run/tls/kami.crt
  local key=run/tls/kami.key
  if [ -s "$cert" ] && [ -s "$key" ]; then
    KAMI_TLS_CERT="$PWD/$cert"
    KAMI_TLS_KEY="$PWD/$key"
    return 0
  fi
  if ! command -v openssl >/dev/null 2>&1; then
    echo "  ! openssl is missing — skipping TLS"
    return 0
  fi
  mkdir -p run/tls
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 3650 \
    -subj "/CN=kami" \
    -addext "subjectAltName=DNS:kami,DNS:$(hostname),DNS:$(hostname).local,IP:127.0.0.1$(hostname -I | tr ' ' '\n' | grep . | sed 's/^/,IP:/' | tr -d '\n')" \
    -keyout "$key" -out "$cert"
  KAMI_TLS_CERT="$PWD/$cert"
  KAMI_TLS_KEY="$PWD/$key"
}

wait_for_port() {
  for _ in $(seq 1 120); do (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && return 0; sleep 0.25; done
  return 1
}

eye_model_directory() {
  local model
  [ -n "$EYE_PYTHON" ] && [ -s app/eye/validate_release.py ] || return 0
  for model in "$ML_HOME/artifacts/$EYE_MODEL_NAME/" "$PWD"/app/eye/artifacts/*/ "$(cat run/eye-model 2>/dev/null || true)"; do
    [ -d "$model" ] || continue
    if PYTHONPATH="$PWD/pydeps" "$EYE_PYTHON" app/eye/validate_release.py "$model" >/dev/null; then
      realpath "$model"
      return 0
    fi
    echo "  eye: rejected incompatible release $model" >&2
  done
  return 0
}

eye_python() {
  if [ -d pydeps ]; then echo python3
  elif [ -x "$ML_HOME/.venv/bin/python" ]; then echo "$ML_HOME/.venv/bin/python"; fi
}

eye_is_healthy() {
  python3 -c 'import json, sys, urllib.request; health=json.load(urllib.request.urlopen(sys.argv[1], timeout=2)); sys.exit(0 if health.get("ok") is True and health.get("renderMatches") is True and health.get("artifactId") else 1)' \
    "$EYE_URL/health" 2>/dev/null
}

start_eye() {
  PYTHONPATH="$PWD/pydeps" KAMI_EYE_PORT=$EYE_PORT KAMI_EYE_MODEL=$1 \
    nohup "$2" app/eye/sidecar.py > logs/eye.log 2>&1 &
  echo $! > run/eye.pid
  for _ in $(seq 1 "$EYE_HEALTH_ATTEMPTS"); do
    eye_is_healthy && return 0
    kill -0 "$(cat run/eye.pid)" 2>/dev/null || return 1
    sleep 0.25
  done
  return 1
}

EYE_PYTHON=$(eye_python)
EYE_MODEL=$(eye_model_directory)
if [ -s run/eye-model ] && [ -z "$EYE_MODEL" ]; then
  echo "No compatible Eye release; leaving the running services untouched." >&2
  exit 1
fi
bash box/stop.sh
runtime/mongodb/bin/mongod --dbpath "$PWD/data" --bind_ip 127.0.0.1 --port "$MONGO_PORT" \
  --fork --logpath "$PWD/logs/mongod.log" --pidfilepath "$PWD/run/mongod.pid" >/dev/null
wait_for_port "$MONGO_PORT" || { echo "✗ mongod did not start:"; tail -5 logs/mongod.log; exit 1; }

snapshot=app/quickdraw.ndjson.gz
stamp=$(cat "$snapshot" app/snapshot.js | cksum | cut -d' ' -f1)
if [ "$(cat run/quickdraw.stamp 2>/dev/null)" != "$stamp" ]; then
  runtime/bun app/snapshot.js import "$snapshot" | sed 's/^/  /'
  echo "$stamp" > run/quickdraw.stamp
fi

if [ -z "$EYE_MODEL" ] || [ ! -s app/eye/sidecar.py ] || [ -z "$EYE_PYTHON" ]; then
  echo "  eye: no trained model (or its Python packages) on this box — the k-NN recognises sketches"
elif start_eye "$EYE_MODEL" "$EYE_PYTHON"; then
  printf '%s\n' "$EYE_MODEL" > run/eye-model
  export KAMI_RECOGNIZER_URL=$EYE_URL
  export KAMI_BEAUTIFY_URL=${KAMI_BEAUTIFY_URL:-$EYE_URL/complete}
else
  echo "  ! eye: the sidecar did not come up — the k-NN recognises sketches. Its last words:"
  tail -5 logs/eye.log | sed 's/^/    /'
  bash box/stop.sh eye
  previous=$(cat run/eye-model 2>/dev/null || true)
  if [ -n "$previous" ] && [ "$previous" != "$EYE_MODEL" ] &&
      PYTHONPATH="$PWD/pydeps" "$EYE_PYTHON" app/eye/validate_release.py "$previous" >/dev/null &&
      start_eye "$previous" "$EYE_PYTHON"; then
    export KAMI_RECOGNIZER_URL=$EYE_URL
    export KAMI_BEAUTIFY_URL=${KAMI_BEAUTIFY_URL:-$EYE_URL/complete}
    echo "  eye: restored previous working release"
  else
    bash box/stop.sh eye
  fi
fi

if [ -z "${KAMI_SKETCHES:-}" ] && [ -n "$EYE_MODEL" ] && [ -s "$EYE_MODEL/exemplars/meta.json" ]; then
  export KAMI_SKETCHES="$EYE_MODEL/exemplars"
fi

KAMI_TLS_CERT=
KAMI_TLS_KEY=
ensure_tls_cert
PORT=$PORT KAMI_WEB_DIR="$PWD/dist" KAMI_LLM_URL="http://127.0.0.1:11434" KAMI_LLM_MODEL="$MODEL" \
  KAMI_TLS_CERT="$KAMI_TLS_CERT" KAMI_TLS_KEY="$KAMI_TLS_KEY" KAMI_TLS_PORT="$TLS_PORT" \
  nohup runtime/bun app/server.js > logs/server.log 2>&1 &
echo $! > run/server.pid
wait_for_port "$PORT" || { echo "✗ the Kami server did not start:"; tail -15 logs/server.log; exit 1; }
ready=false
for _ in $(seq 1 120); do
  if python3 box/release.py ready "$PWD" "http://127.0.0.1:$PORT" 2>/dev/null; then
    ready=true
    break
  fi
  kill -0 "$(cat run/server.pid)" 2>/dev/null || break
  sleep 0.25
done
[ "$ready" = true ] || { echo "Kami failed application readiness" >&2; exit 1; }

sleep 1
sed 's/^/  /' logs/server.log
echo "✓ running on this box, ports $PORT (http) and $TLS_PORT (https) (model: $MODEL, eye: ${KAMI_RECOGNIZER_URL:-k-NN only}, finishes drawings: ${KAMI_BEAUTIFY_URL:-no})"
PORT=$PORT bash box/screen.sh start || echo "  – the big screen did not come up (box/screen.sh status)"
