#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

export UV_PROJECT_ENVIRONMENT="$PWD/.cache/check-venv"
export PYTHONPYCACHEPREFIX="$PWD/.cache/check-pycache"
uv sync --project ml --locked --only-group check
TOOLS="$UV_PROJECT_ENVIRONMENT/bin"

(
  cd ml
  "$TOOLS/ruff" check .
  "$TOOLS/ruff" format --check .
  "$TOOLS/mypy" --config-file pyproject.toml artifacts.py unit
)

git ls-files --cached --others --exclude-standard -z '*.py' |
  xargs -0 "$TOOLS/python" -m py_compile
while IFS= read -r -d '' file; do
  bash -n "$file"
done < <(git ls-files --cached --others --exclude-standard -z '*.sh')

PYTHONPATH=ml "$TOOLS/python" -m unittest discover -s ml/unit -v
