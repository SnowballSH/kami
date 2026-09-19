#!/usr/bin/env bash
# Run ONCE on the Mac while it is on the GX10's network (its hotspot, or a shared one).
# Installs Claude's SSH key (you type the GX10 password once), then saves a probe report.
set -euo pipefail
cd "$(dirname "$0")/../.."

HOST_ALIAS=gx10
KEY="$HOME/.ssh/kami_gx10_ed25519"
REPORT=.gx10/probe.txt
mkdir -p .gx10

echo "→ Looking for the GX10…"
if ! ssh -G "$HOST_ALIAS" >/dev/null 2>&1 || ! nc -z -G 5 gx10-4d82.local 22 2>/dev/null; then
  echo "✗ gx10-4d82.local:22 is not reachable. Join the Wi-Fi network 'gx10-4d82' first, then re-run."
  exit 1
fi

if ssh -o BatchMode=yes "$HOST_ALIAS" true 2>/dev/null; then
  echo "✓ Key already installed."
else
  echo "→ Installing the SSH key. Type the GX10 password when asked (this is the only time)."
  ssh-copy-id -i "$KEY.pub" -o IdentitiesOnly=yes asus@gx10-4d82.local
fi

echo "→ Probing the box…"
{ date; ssh -o BatchMode=yes "$HOST_ALIAS" 'bash -s' < scripts/gx10/probe.sh; } | tee "$REPORT"
echo
echo "✓ Saved to $REPORT — rejoin your normal Wi-Fi and tell Claude it's done."
