#!/usr/bin/env bash
# On the GX10: stop the Kami server and its MongoDB, if they are running.
cd ~/kami
for service in server mongod; do
  pidfile=run/$service.pid
  [ -s "$pidfile" ] || continue
  pid=$(cat "$pidfile")
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    for _ in $(seq 1 40); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
  fi
  rm -f "$pidfile"
done
