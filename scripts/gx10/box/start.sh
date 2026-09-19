#!/usr/bin/env bash
# On the GX10: (re)start MongoDB and the Kami server. Everything Kami computes happens on this box:
# the game is served from here, memory is this MongoDB, and rules are compiled by this Ollama.
set -euo pipefail
cd ~/kami
PORT=${PORT:-8787}
MONGO_PORT=27017
MODEL=${KAMI_LLM_MODEL:-qwen3.8:latest}
export MONGODB_URI="mongodb://127.0.0.1:$MONGO_PORT"

wait_for_port() {
  for _ in $(seq 1 120); do (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && return 0; sleep 0.25; done
  return 1
}

bash box/stop.sh
runtime/mongodb/bin/mongod --dbpath "$PWD/data" --bind_ip 127.0.0.1 --port "$MONGO_PORT" \
  --fork --logpath "$PWD/logs/mongod.log" --pidfilepath "$PWD/run/mongod.pid" >/dev/null
wait_for_port "$MONGO_PORT" || { echo "✗ mongod did not start:"; tail -5 logs/mongod.log; exit 1; }

snapshot=app/quickdraw.ndjson.gz
stamp=$(cksum "$snapshot" | cut -d' ' -f1)
if [ "$(cat run/quickdraw.stamp 2>/dev/null)" != "$stamp" ]; then
  runtime/bun app/snapshot.js import "$snapshot" | sed 's/^/  /'
  echo "$stamp" > run/quickdraw.stamp
fi

PORT=$PORT KAMI_WEB_DIR="$PWD/dist" KAMI_LLM_URL="http://127.0.0.1:11434" KAMI_LLM_MODEL="$MODEL" \
  nohup runtime/bun app/server.js > logs/server.log 2>&1 &
echo $! > run/server.pid
wait_for_port "$PORT" || { echo "✗ the Kami server did not start:"; tail -15 logs/server.log; exit 1; }

sleep 1
sed 's/^/  /' logs/server.log
echo "✓ running on this box, port $PORT (model: $MODEL)"
