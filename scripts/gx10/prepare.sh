#!/usr/bin/env bash
# Run on the Mac WITH internet. Gathers everything the GX10 needs, because the box has none:
# the built game, the server as one file, the Quick, Draw! snapshot, Bun + MongoDB for Linux arm64,
# and — once ml/ has them — Kami's Eye: the sidecar, its trained model and its Python wheels.
#   KAMI_EYE_MODEL_NAME=<dir under ml/artifacts>   ship this model instead of the newest one
set -euo pipefail
cd "$(dirname "$0")/../.."

BUN_VERSION=$(bun --version)
MONGO_VERSION=8.2.6
BUILD=.gx10/build
CACHE=.gx10/cache
EYE_BUILD=$BUILD/eye
WHEELS=$CACHE/wheels
EYE_PACKAGES=(onnxruntime numpy opencv-python-headless)
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
  if [ -z "$model" ] || [ ! -s "$model/model.onnx" ] || [ ! -s "$model/labels.json" ]; then
    if [ -n "${KAMI_EYE_MODEL_NAME:-}" ]; then echo "✗ $model has no model.onnx + labels.json"; exit 1; fi
    echo "  – no trained model under ml/artifacts yet; the box will use the k-NN"
    return
  fi
  mkdir -p "$EYE_BUILD/artifacts"
  cp -R "$model" "$EYE_BUILD/artifacts/"
  echo "  ✓ model $(basename "$model")"
}

pin_eye_requirements() {
  uv export --project ml --frozen --no-dev --no-group train --no-hashes --no-emit-project \
    --quiet -o "$EYE_BUILD/requirements.txt" >/dev/null 2>&1 \
    || printf '%s\n' "${EYE_PACKAGES[@]}" > "$EYE_BUILD/requirements.txt"
}

pip_for_the_box() {
  if command -v uv >/dev/null; then uvx --python "$BOX_PYTHON" pip "$@"; else python3 -m pip "$@"; fi
}

gather_eye_wheels() {
  local platform_flags=() platform
  for platform in "${BOX_PLATFORMS[@]}"; do platform_flags+=(--platform "$platform"); done
  rm -rf "$WHEELS.part"
  if pip_for_the_box download --quiet --disable-pip-version-check --dest "$WHEELS.part" \
       --only-binary=:all: --implementation cp --python-version "${BOX_PYTHON/./}" \
       "${platform_flags[@]}" -r "$EYE_BUILD/requirements.txt"; then
    rm -rf "$WHEELS"
    mv "$WHEELS.part" "$WHEELS"
    echo "  ✓ $(find "$WHEELS" -name '*.whl' | wc -l | tr -d ' ') Python wheels for the box"
  else
    rm -rf "$WHEELS.part"
    echo "  ! could not gather the Python wheels; keeping what $WHEELS already holds"
  fi
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

echo "→ Kami's Eye (the sketch-recognition sidecar)"
rm -rf "$EYE_BUILD"
if [ -s ml/sidecar.py ] && [ -s ml/render.py ]; then
  mkdir -p "$EYE_BUILD"
  cp ml/render.py ml/sidecar.py "$EYE_BUILD/"
  copy_eye_model
  pin_eye_requirements
  gather_eye_wheels
else
  echo "  – ml/sidecar.py is not written yet; the box will use the k-NN"
fi

echo
du -sh dist "$BUILD" "$CACHE" | sed 's/^/  /'
echo "✓ Ready. Join the 'gx10-4d82' Wi-Fi and run: bun run gx10:deploy"
