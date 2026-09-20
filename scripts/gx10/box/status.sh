#!/usr/bin/env bash
# On the GX10: is Kami up, and what has it been saying?
cd -P "$(dirname "$0")/.." || exit 1
echo "release: $PWD"
EYE_PORT=${KAMI_EYE_PORT:-8790}
for service in mongod eye server; do
  pid=$(cat run/$service.pid 2>/dev/null || true)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then echo "✓ $service (pid $pid)"
  elif [ "$service" = eye ]; then echo "– eye is not running (the k-NN answers instead)"
  else echo "✗ $service is not running"; fi
done
echo "--- eye health"
python3 -c 'import sys, urllib.request; print(urllib.request.urlopen(sys.argv[1], timeout=2).read().decode())' \
  "http://127.0.0.1:$EYE_PORT/health" 2>/dev/null || echo "no answer on port $EYE_PORT"
echo "--- eye log"; tail -5 logs/eye.log 2>/dev/null
echo "--- server log"; tail -15 logs/server.log 2>/dev/null
echo "--- models loaded in Ollama"; ollama ps 2>/dev/null
