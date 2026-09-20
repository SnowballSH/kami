#!/usr/bin/env bash
# On the GX10: install the exact offline runtime bundle without system-wide changes.
set -euo pipefail
cd "${KAMI_RELEASE:-$HOME/kami}"
mkdir -p data logs run
python3 box/runtime.py install "$PWD"
echo "  bun $(runtime/bun --version) · $(runtime/mongodb/bin/mongod --version | head -1) · page size $(getconf PAGESIZE)"
