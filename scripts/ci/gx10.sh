#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

REVISION="${1:-}"
ARTIFACT="${2:-}"
if [[ $# != 2 || ! "$REVISION" =~ ^[0-9a-f]{40}$ || ! "$ARTIFACT" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]]; then
  echo "usage: bun run check:gx10 <full-commit-sha> <artifact-name>" >&2
  exit 2
fi

mkdir -p .gx10
ssh -o BatchMode=yes -o ConnectTimeout=10 gx10 bash -s -- "$REVISION" "$ARTIFACT" <<'REMOTE' 2>&1 | tee ".gx10/check-$REVISION-$ARTIFACT.log"
set -euo pipefail
REVISION="$1"
ARTIFACT="$2"
if [[ "$(uname -s)" != Linux || "$(uname -m)" != aarch64 ]]; then
  echo "Model checks require the Linux/aarch64 GX10." >&2
  exit 1
fi
GPU="$(nvidia-smi --query-gpu=name --format=csv,noheader)"
if [[ "$GPU" != *GB10* ]]; then
  echo "Model checks require the GX10's NVIDIA GB10." >&2
  exit 1
fi

cd "$HOME/kami-checkouts/$REVISION"
export PYTHONDONTWRITEBYTECODE=1
test "$(git rev-parse HEAD)" = "$REVISION"
test -z "$(git status --porcelain --untracked-files=all)"
export KAMI_EYE_MODEL
KAMI_EYE_MODEL="$(realpath -e "$HOME/kami-ml/artifacts/$ARTIFACT")"
PYTHON="$HOME/kami-ml/.venv/bin/python"
export MYPY_CACHE_DIR="$HOME/kami-ml/.mypy-check-cache"
printf 'revision=%s\nartifact=%s\ngpu=%s\n' "$REVISION" "$KAMI_EYE_MODEL" "$GPU"
date -u '+checked_at=%Y-%m-%dT%H:%M:%SZ'
cd ml
"$PYTHON" --version
"$PYTHON" -c 'from importlib.metadata import distributions; print("\n".join(sorted("{}=={}".format(d.metadata["Name"], d.version) for d in distributions())))'
"$PYTHON" -c 'import torch; import onnx; import onnxruntime'
echo 'release_identity:'
"$PYTHON" validate_release.py "$KAMI_EYE_MODEL"
"$PYTHON" -m mypy .
"$PYTHON" -m pytest -p no:cacheprovider -v
echo 'GX10 checks passed'
REMOTE
