#!/usr/bin/env bash
# On the GX10: unpack Bun and MongoDB under ~/kami/runtime, and the Python packages Kami's Eye needs
# under ~/kami/pydeps (from the wheels the Mac carried over). Nothing is installed system-wide.
set -euo pipefail
cd ~/kami
mkdir -p runtime data logs run

EYE_REQUIREMENTS=app/eye/requirements.txt
WHEELS=cache/wheels
PYDEPS=pydeps
PYDEPS_STAMP=run/pydeps.stamp

install_eye_packages() {
  local stamp
  stamp=$({ cat "$EYE_REQUIREMENTS"; ls "$WHEELS"; } | cksum | cut -d' ' -f1)
  if [ -d "$PYDEPS" ] && [ "$(cat "$PYDEPS_STAMP" 2>/dev/null)" = "$stamp" ]; then return 0; fi
  rm -rf "$PYDEPS" "$PYDEPS_STAMP"
  python3 -m pip install --quiet --disable-pip-version-check --no-user --no-index \
    --find-links "$WHEELS" --target "$PYDEPS" -r "$EYE_REQUIREMENTS" || return 1
  PYTHONPATH=$PYDEPS python3 -c 'import cv2, numpy, onnxruntime' || return 1
  echo "$stamp" > "$PYDEPS_STAMP"
}

if [ ! -x runtime/bun ]; then
  rm -rf runtime/bun-unpacked
  python3 -m zipfile -e cache/bun-linux-aarch64-*.zip runtime/bun-unpacked
  mv runtime/bun-unpacked/bun-linux-aarch64/bun runtime/bun
  chmod +x runtime/bun
  rm -rf runtime/bun-unpacked
fi
if [ ! -x runtime/mongodb/bin/mongod ]; then
  rm -rf runtime/mongodb && mkdir -p runtime/mongodb
  tar -xzf cache/mongodb-linux-aarch64-*.tgz -C runtime/mongodb --strip-components=1
fi
echo "  bun $(runtime/bun --version) · $(runtime/mongodb/bin/mongod --version | head -1) · page size $(getconf PAGESIZE)"

if [ ! -s "$EYE_REQUIREMENTS" ] || ! ls "$WHEELS"/*.whl >/dev/null 2>&1; then
  echo "  eye: no sidecar was shipped — Kami will use the k-NN"
elif install_eye_packages; then
  echo "  eye: onnxruntime $(PYTHONPATH=$PYDEPS python3 -c 'import onnxruntime; print(onnxruntime.__version__)') under ~/kami/$PYDEPS"
else
  rm -rf "$PYDEPS" "$PYDEPS_STAMP"
  echo "  ! eye: its Python packages did not install — Kami will use the k-NN"
fi
