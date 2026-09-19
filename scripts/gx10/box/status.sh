#!/usr/bin/env bash
# On the GX10: is Kami up, and what has it been saying?
cd ~/kami
for service in mongod server; do
  pid=$(cat run/$service.pid 2>/dev/null || true)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then echo "✓ $service (pid $pid)"; else echo "✗ $service is not running"; fi
done
echo "--- server log"; tail -15 logs/server.log 2>/dev/null
echo "--- models loaded in Ollama"; ollama ps 2>/dev/null
