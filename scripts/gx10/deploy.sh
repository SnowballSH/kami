#!/usr/bin/env bash
# Run on the Mac while it can reach the GX10 (`ssh gx10`). Ships what prepare.sh gathered
# into ~/kami on the box, installs the runtimes there (no sudo), and starts MongoDB, Kami's Eye (when a
# trained model was prepared) and the Kami server.
#   --autostart   also start Kami whenever the box boots (a user crontab entry; remove with box/autostart.sh disable)
set -euo pipefail
cd "$(dirname "$0")/../.."
export COPYFILE_DISABLE=1

HOST_ALIAS=gx10
BOX_ADDRESS=$(ssh -G "$HOST_ALIAS" | awk '$1 == "hostname" { print $2 }')
PORT=8787
BUILD=.gx10/build
CACHE=.gx10/cache
LOG=.gx10/deploy.log
AUTOSTART=${1:-}
RELEASE="$(date -u +%Y%m%dT%H%M%S)-$(git rev-parse --short HEAD)-$$"
STAGE=".gx10/releases/$RELEASE"

for needed in dist/index.html "$BUILD/server.js" "$BUILD/snapshot.js" "$BUILD/quickdraw.ndjson.gz" "$BUILD/runtime.json"; do
  [ -s "$needed" ] || { echo "✗ $needed is missing — run 'bun run gx10:prepare' first (with internet)."; exit 1; }
done
if ! ssh -o BatchMode=yes "$HOST_ALIAS" true 2>/dev/null; then
  echo "✗ Can't reach the GX10 over 'ssh gx10'. Same network? (First time, or a new address: bun run gx10:bootstrap <address>)"
  exit 1
fi

mkdir -p .gx10
exec > >(tee "$LOG") 2>&1
date

ship_missing() {
  local source=$1 destination=$2 file name checksum
  for file in "$source"/*; do
    [ -f "$file" ] || continue
    name=$(basename "$file")
    checksum=$(python3 scripts/gx10/box/runtime.py hash "$file")
    if ssh "$HOST_ALIAS" "cd ~/kami/$destination && echo '$checksum  $name' | sha256sum --check --status" 2>/dev/null; then
      echo "  ✓ $name (verified)"
    else
      echo "  ↑ $name"
      scp -q "$file" "$HOST_ALIAS:kami/$destination/$name.part"
      ssh "$HOST_ALIAS" "cd ~/kami/$destination && echo '$checksum  $name.part' | sha256sum --check --status && mv '$name.part' '$name'"
    fi
  done
}

echo "→ Shipping the game, the server and Kami's Eye"
mkdir -p "$STAGE/app"
cp -R dist "$STAGE/dist"
cp -R "$BUILD/." "$STAGE/app/"
cp -R scripts/gx10/box "$STAGE/box"
python3 "$STAGE/box/release.py" write "$STAGE"
python3 "$STAGE/box/release.py" verify "$STAGE"
ssh "$HOST_ALIAS" "mkdir -p ~/kami/cache/wheels ~/kami/releases && mkdir ~/kami/releases/$RELEASE"
tar --no-xattrs -czf - -C "$STAGE" . | ssh "$HOST_ALIAS" "tar -xzf - -C ~/kami/releases/$RELEASE"

echo "→ Shipping runtimes and Python wheels the box doesn't have yet"
ship_missing "$CACHE" cache
ship_missing "$CACHE/wheels" cache/wheels

echo "→ Installing and starting on the box"
ssh "$HOST_ALIAS" "bash ~/kami/releases/$RELEASE/box/activate.sh ~/kami/releases/$RELEASE"
[ "$AUTOSTART" = "--autostart" ] && ssh "$HOST_ALIAS" 'bash ~/kami/current/box/autostart.sh enable'

echo "→ Checking it from this side of the Wi-Fi"
if curl -fs -m 8 "http://$BOX_ADDRESS:$PORT/api/boards" >/dev/null; then
  echo "✓ Kami is live. On the iPad, on the same network: http://$BOX_ADDRESS:$PORT"
else
  echo "✗ The server runs on the box but port $PORT isn't reachable from here — likely its firewall."
  echo "  On the box:  sudo ufw allow $PORT/tcp     (needs the box password)"
fi
echo "(log saved to $LOG)"
