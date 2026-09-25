#!/usr/bin/env bash
# Run on the Mac. Gathers everything the GX10 runs: the built game, the server as one file, the
# Quick, Draw! snapshot, Bun + MongoDB for Linux arm64, and Kami's Eye: the sidecar and its Python wheels.
# The Eye's model is trained on the box itself (~/kami-ml/artifacts/kami-eye) and start.sh finds it there;
# a model under ml/artifacts here is shipped too (with its exemplars/, if built), for a box that has none.
#   KAMI_EYE_MODEL_NAME=<dir under ml/artifacts>   ship this model instead of the newest one
set -euo pipefail
cd "$(dirname "$0")/../.."

BUN_VERSION=$(bun --version)
MONGO_VERSION=8.2.6
BUILD=.gx10/build
CACHE=.gx10/cache
EYE_BUILD=$BUILD/eye
WHEELS=$CACHE/wheels
EYE_SOURCES=(artifacts.py render.py recognizer.py exemplar_set.py pose.py morph.py likeness.py completion.py sidecar.py validate_release.py)
BOX_PYTHON=3.12
BOX_PLATFORMS=(manylinux_2_28_aarch64 manylinux_2_17_aarch64 manylinux2014_aarch64)
mkdir -p "$BUILD" "$CACHE"

fetch_once() {
  local url=$1 dest=$2
  if [ -s "$dest" ]; then echo "  ✓ $(basename "$dest") (cached)"; return; fi
  echo "  ↓ $(basename "$dest")"
  curl -fL --progress-bar -o "$dest.part" "$url"
  mv "$dest.part" "$dest"
}

eye_model_directory() {
  if [ -n "${KAMI_EYE_MODEL_NAME:-}" ]; then echo "ml/artifacts/$KAMI_EYE_MODEL_NAME"; return; fi
  ls -td ml/artifacts/*/ 2>/dev/null | head -1 || true
}

copy_eye_model() {
  local model
  model=$(eye_model_directory)
  model=${model%/}
  if [ -z "$model" ]; then
    if [ -n "${KAMI_EYE_MODEL_NAME:-}" ]; then echo "✗ $model has no model.onnx + labels.json"; exit 1; fi
    echo "  – no model under ml/artifacts to ship; the box uses the one it trained, or the k-NN"
    return
  fi
  PYTHONPATH=ml python3 -c 'import sys; from pathlib import Path; from artifacts import validate_bundle; validate_bundle(Path(sys.argv[1]))' "$model"
  mkdir -p "$EYE_BUILD/artifacts"
  cp -RL "$model" "$EYE_BUILD/artifacts/"
  echo "  ✓ model $(basename "$model")"
}

source scripts/gx10/eye-deps.sh

echo "→ Building the game"
bunx vite build --logLevel warn

echo "→ Bundling the server into single files"
bun build server/index.ts --target=bun --outfile="$BUILD/server.js" --external mongodb-memory-server >/dev/null

echo "→ The Quick, Draw! corpus Kami learns from"
CORPUS=${KAMI_QUICKDRAW_SNAPSHOT:-.kami-data/quickdraw.ndjson.gz}
[ -s "$CORPUS" ] || { echo "✗ $CORPUS is missing — run 'bun run quickdraw:ingest' first (with internet)."; exit 1; }
cp "$CORPUS" "$BUILD/quickdraw.ndjson.gz"

echo "→ Runtimes for the box (Linux arm64)"
fetch_once "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-linux-aarch64.zip" \
  "$CACHE/bun-linux-aarch64-$BUN_VERSION.zip"
fetch_once "https://fastdl.mongodb.org/linux/mongodb-linux-aarch64-ubuntu2404-$MONGO_VERSION.tgz" \
  "$CACHE/mongodb-linux-aarch64-ubuntu2404-$MONGO_VERSION.tgz"

echo "→ Kami's Eye (the sketch-recognition sidecar)"
rm -rf "$EYE_BUILD"
if [ "${KAMI_EYE_ENABLED:-1}" != 0 ]; then
  mkdir -p "$EYE_BUILD"
  for source in "${EYE_SOURCES[@]}"; do cp "ml/$source" "$EYE_BUILD/"; done
  copy_eye_model
  pin_eye_requirements
  gather_eye_wheels
else
  echo "  – sidecar explicitly disabled; the box will use the k-NN"
fi
python3 scripts/gx10/box/runtime.py write "$BUILD" "$CACHE" \
  "$BUN_VERSION" "$MONGO_VERSION" "$BOX_PYTHON"

echo
du -sh dist "$BUILD" "$CACHE" | sed 's/^/  /'
echo "✓ Ready. Run: bun run gx10:deploy"
