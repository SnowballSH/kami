#!/usr/bin/env bash
# Brings the GX10's localhost-only services to this Mac over SSH. Nothing on the box is changed.
#   localhost:11434 → Ollama (what KAMI_LLM_URL points at)
#   localhost:11000 → DGX Dashboard
set -euo pipefail

HOST_ALIAS=gx10
OLLAMA_PORT=11434
DASHBOARD_PORT=11000

if ! ssh -o BatchMode=yes "$HOST_ALIAS" true 2>/dev/null; then
  echo "✗ Can't reach the GX10 over 'ssh gx10'. Same network as the box?"
  echo "  A new address or no key yet: bun run gx10:bootstrap <address>"
  exit 1
fi

echo "✓ Tunnel up. Ollama → http://localhost:$OLLAMA_PORT · DGX Dashboard → http://localhost:$DASHBOARD_PORT"
echo "  Models on the box:"
ssh -o BatchMode=yes "$HOST_ALIAS" 'ollama list' | sed 's/^/    /'
echo "  Ctrl-C to close."
exec ssh -N -o ExitOnForwardFailure=yes \
  -L "$OLLAMA_PORT:127.0.0.1:$OLLAMA_PORT" \
  -L "$DASHBOARD_PORT:127.0.0.1:$DASHBOARD_PORT" \
  "$HOST_ALIAS"
