#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

export UV_PROJECT_ENVIRONMENT="$PWD/.gx10/check-venv"
export PYTHONPYCACHEPREFIX="$PWD/.gx10/check-pycache"
uv sync --project ml --locked --only-group check
TOOLS="$UV_PROJECT_ENVIRONMENT/bin"

(
  cd ml
  "$TOOLS/ruff" check .
  "$TOOLS/ruff" format --check .
  "$TOOLS/ruff" check --config pyproject.toml ../scripts/ci
  "$TOOLS/ruff" check --isolated --select E4,E7,E9,F ../scripts/gx10/box ../scripts/gx10/tests
  "$TOOLS/ruff" format --check --config pyproject.toml ../scripts/ci
  "$TOOLS/mypy" --config-file pyproject.toml artifacts.py prefetch.py unit \
    ../scripts/gx10/box/release.py ../scripts/gx10/box/runtime.py ../scripts/gx10/tests ../scripts/ci/tests
)

git ls-files --cached --others --exclude-standard -z '*.py' |
  xargs -0 "$TOOLS/python" -m py_compile
while IFS= read -r -d '' file; do
  bash -n "$file"
done < <(git ls-files --cached --others --exclude-standard -z '*.sh')

PYTHONPATH=ml "$TOOLS/python" -m unittest discover -s ml/unit -v
PYTHONPATH=scripts/gx10/box "$TOOLS/python" -m unittest discover -s scripts/gx10/tests -v
"$TOOLS/python" -m unittest discover -s scripts/ci/tests -v
