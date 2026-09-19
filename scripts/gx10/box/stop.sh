#!/usr/bin/env bash
# On the GX10: stop the Kami server, Kami's Eye and their MongoDB, if they are running.
#   stop.sh          all of them
#   stop.sh eye      only the named services
cd ~/kami || exit 1
services=("$@")
[ ${#services[@]} -gt 0 ] || services=(server eye mongod)
for service in "${services[@]}"; do
  pidfile=run/$service.pid
  [ -s "$pidfile" ] || continue
  pid=$(cat "$pidfile")
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    for _ in $(seq 1 40); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
  fi
  rm -f "$pidfile"
done
