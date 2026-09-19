#!/usr/bin/env bash
# Run on the Mac whenever it can reach the box. Times the box's local models on Kami's real compiler
# prompt and saves the report to .gx10/bench.txt.   usage: bench.sh [model ...]
set -euo pipefail
cd "$(dirname "$0")/../.."

HOST_ALIAS=gx10
REPORT=.gx10/bench.txt
mkdir -p .gx10

ssh -o BatchMode=yes "$HOST_ALIAS" true 2>/dev/null ||
  { echo "✗ Can't reach the box (ssh $HOST_ALIAS)."; exit 1; }

bun -e '
  import { COMPILER_SYSTEM_PROMPT } from "./server/compile/prompt";
  console.log(JSON.stringify({
    system: COMPILER_SYSTEM_PROMPT,
    lines: [
      "make it feel like the red planet",
      "gravity is sideways and time is slow",
      "make everything feel like jelly",
      "everything should drift gently to the left like a breeze",
      "a bouncy mushroom",
    ],
  }));
' > .gx10/bench-payload.json

ssh "$HOST_ALIAS" 'mkdir -p /tmp/kami-bench'
scp -q scripts/gx10/bench.py .gx10/bench-payload.json "$HOST_ALIAS:/tmp/kami-bench/"
ssh "$HOST_ALIAS" "python3 /tmp/kami-bench/bench.py /tmp/kami-bench/bench-payload.json $*" | tee "$REPORT"
echo
echo "(saved to $REPORT)"
