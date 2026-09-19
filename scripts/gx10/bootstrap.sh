#!/usr/bin/env bash
# Run ONCE on the Mac while it is on the GX10's network (its hotspot, or a shared one).
# Installs Claude's SSH key (you type the GX10 password once), then saves a probe report.
set -euo pipefail
cd "$(dirname "$0")/../.."

HOST_ALIAS=gx10
HOST_NAME=gx10-4d82.local
HOTSPOT_SSID=gx10-4d82
WIFI_DEVICE=en0
KEY="$HOME/.ssh/kami_gx10_ed25519"
REPORT=.gx10/probe.txt
mkdir -p .gx10

answers_ssh() { nc -z -G 4 "$1" 22 >/dev/null 2>&1; }

find_gx10() {
  local router
  router=$(ipconfig getoption "$WIFI_DEVICE" router 2>/dev/null || true)
  if answers_ssh "$HOST_NAME"; then echo "$HOST_NAME"
  elif [ -n "$router" ] && answers_ssh "$router"; then echo "$router"
  fi
}

echo "→ Looking for the GX10…"
TARGET=$(find_gx10)
if [ -z "$TARGET" ]; then
  echo "✗ Can't reach the GX10 from here."
  echo "  This Mac's Wi-Fi: address $(ipconfig getifaddr "$WIFI_DEVICE" 2>/dev/null || echo none)," \
       "router $(ipconfig getoption "$WIFI_DEVICE" router 2>/dev/null || echo none)."
  echo "  A GX10 hotspot hands out 10.42.0.x with router 10.42.0.1. If you see something else, macOS is"
  echo "  on another network: join '$HOTSPOT_SSID' from the Wi-Fi menu, and if it hops back, turn off"
  echo "  Auto-Join for the other network for now. Then re-run this."
  exit 1
fi
echo "✓ Found it at $TARGET"
SSH=(ssh -o "HostName=$TARGET" "$HOST_ALIAS")

if "${SSH[@]}" -o BatchMode=yes true 2>/dev/null; then
  echo "✓ Key already installed."
else
  echo "→ Installing the SSH key. Type the GX10 password when asked (this is the only time)."
  ssh-copy-id -i "$KEY.pub" -o IdentitiesOnly=yes "asus@$TARGET"
fi

echo "→ Probing the box…"
{ date; echo "reached via: $TARGET"; "${SSH[@]}" -o BatchMode=yes 'bash -s' < scripts/gx10/probe.sh; } | tee "$REPORT"
echo
echo "✓ Saved to $REPORT — rejoin your normal Wi-Fi and tell Claude it's done."
