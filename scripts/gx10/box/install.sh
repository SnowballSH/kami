#!/usr/bin/env bash
# On the GX10: unpack Bun and MongoDB under ~/kami/runtime. Nothing is installed system-wide.
set -euo pipefail
cd ~/kami
mkdir -p runtime data logs run

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
