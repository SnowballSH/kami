#!/usr/bin/env bash
# On the GX10: (re)start MongoDB, Kami's Eye and the Kami server. Everything Kami computes happens on
# this box: the game is served from here, memory is this MongoDB, rules are compiled by this Ollama, and
# sketches are recognised by the Eye sidecar — or by the server's own k-NN when no trained model is here.
# The same sidecar finishes drawings (/complete) when its model has an exemplar set (ml/exemplars.py).
set -euo pipefail
cd ~/kami
PORT=${PORT:-8787}
MONGO_PORT=27017
EYE_PORT=${KAMI_EYE_PORT:-8790}
EYE_URL="http://127.0.0.1:$EYE_PORT"
EYE_HEALTH_ATTEMPTS=120
EYE_MODEL_NAME=${KAMI_EYE_MODEL_NAME:-kami-eye}
ML_HOME=~/kami-ml
MODEL=${KAMI_LLM_MODEL:-qwen3.8:latest}
export MONGODB_URI="mongodb://127.0.0.1:$MONGO_PORT"

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

PORT=$PORT KAMI_WEB_DIR="$PWD/dist" KAMI_LLM_URL="http://127.0.0.1:11434" KAMI_LLM_MODEL="$MODEL" \
  nohup runtime/bun app/server.js > logs/server.log 2>&1 &
echo $! > run/server.pid
wait_for_port "$PORT" || { echo "✗ the Kami server did not start:"; tail -15 logs/server.log; exit 1; }

sleep 1
sed 's/^/  /' logs/server.log
echo "✓ running on this box, port $PORT (model: $MODEL, eye: ${KAMI_RECOGNIZER_URL:-k-NN only}, finishes drawings: ${KAMI_BEAUTIFY_URL:-no})"
