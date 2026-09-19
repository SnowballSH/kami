#!/usr/bin/env bash
# Run on the Mac WITH internet. Gathers everything the GX10 needs, because the box has none:
# the built game, the server as one file, the Quick, Draw! snapshot, and Bun + MongoDB for Linux arm64.
set -euo pipefail
cd "$(dirname "$0")/../.."

BUN_VERSION=$(bun --version)
MONGO_VERSION=8.2.6
BUILD=.gx10/build
CACHE=.gx10/cache
mkdir -p "$BUILD" "$CACHE"

fetch_once() {
  local url=$1 dest=$2
  if [ -s "$dest" ]; then echo "  ✓ $(basename "$dest") (cached)"; return; fi
  echo "  ↓ $(basename "$dest")"
  curl -fL --progress-bar -o "$dest.part" "$url"
  mv "$dest.part" "$dest"
}

echo "→ Building the game"
bunx vite build --logLevel warn

echo "→ Bundling the server into single files"
bun build server/index.ts --target=bun --outfile="$BUILD/server.js" --external mongodb-memory-server >/dev/null
bun build server/quickdraw/snapshot.ts --target=bun --outfile="$BUILD/snapshot.js" --external mongodb-memory-server >/dev/null

echo "→ Exporting what Kami learned from Quick, Draw!"
bun server/quickdraw/snapshot.ts export "$BUILD/quickdraw.ndjson.gz"

echo "→ Runtimes for the box (Linux arm64)"
fetch_once "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-linux-aarch64.zip" \
  "$CACHE/bun-linux-aarch64-$BUN_VERSION.zip"
fetch_once "https://fastdl.mongodb.org/linux/mongodb-linux-aarch64-ubuntu2404-$MONGO_VERSION.tgz" \
  "$CACHE/mongodb-linux-aarch64-ubuntu2404-$MONGO_VERSION.tgz"

echo
du -sh dist "$BUILD" "$CACHE" | sed 's/^/  /'
echo "✓ Ready. Join the 'gx10-4d82' Wi-Fi and run: bun run gx10:deploy"
