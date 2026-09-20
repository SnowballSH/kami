#!/usr/bin/env bash

pin_eye_requirements() {
  uv export --project ml --locked --no-dev --no-group train --no-emit-project \
    --quiet -o "$EYE_BUILD/requirements.txt.part"
  mv "$EYE_BUILD/requirements.txt.part" "$EYE_BUILD/requirements.txt"
}

gather_eye_wheels() {
  local platform_flags=() platform
  local helper=scripts/gx10/box/runtime.py
  for platform in "${BOX_PLATFORMS[@]}"; do platform_flags+=(--platform "$platform"); done
  if python3 "$helper" verify-wheels "$WHEELS" "$EYE_BUILD/requirements.txt" "$BOX_PYTHON" 2>/dev/null; then
    echo "  ✓ verified cached wheels for the locked requirements"
    return
  fi
  rm -rf "$WHEELS.part"
  uvx --from pip==25.0.1 --python "$BOX_PYTHON" pip download \
    --quiet --disable-pip-version-check --dest "$WHEELS.part" --require-hashes \
    --only-binary=:all: --implementation cp --python-version "${BOX_PYTHON/./}" \
    "${platform_flags[@]}" -r "$EYE_BUILD/requirements.txt"
  python3 "$helper" seal-wheels "$WHEELS.part" "$EYE_BUILD/requirements.txt" "$BOX_PYTHON"
  rm -rf "$WHEELS"
  mv "$WHEELS.part" "$WHEELS"
}
