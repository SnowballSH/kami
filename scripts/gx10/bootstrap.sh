#!/usr/bin/env bash
# Run on the Mac when it can reach the GX10. Installs Claude's SSH key (you type the box's password
# once), then saves a probe report.
#   bootstrap.sh                          find the box on its hotspot
#   bootstrap.sh 10.189.4.20              the box is at this address
#   bootstrap.sh 10.189.4.20 --new-identity [user]
#       the box was set up again, reset or swapped, so its SSH identity changed: forget the old one —
#       but only if you read the address off the box's own screen, or checked the fingerprint there
#       (ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub).
set -euo pipefail
cd "$(dirname "$0")/../.."

HOST_ALIAS=gx10
IDENTITY_PIN=gx10-box
HOTSPOT_NAME=gx10-4d82.local
WIFI_DEVICE=en0
SSH_CONFIG=$HOME/.ssh/config
KEY="$HOME/.ssh/kami_gx10_ed25519"
REPORT=.gx10/probe.txt
GIVEN_ADDRESS=${1:-}
NEW_IDENTITY=${2:-}
BOX_USER=${3:-asus}
mkdir -p .gx10

answers_ssh() { nc -z -G 4 "$1" 22 >/dev/null 2>&1; }

find_gx10() {
  local router
  router=$(ipconfig getoption "$WIFI_DEVICE" router 2>/dev/null || true)
  if [ -n "$GIVEN_ADDRESS" ]; then answers_ssh "$GIVEN_ADDRESS" && echo "$GIVEN_ADDRESS"
  elif answers_ssh "$HOTSPOT_NAME"; then echo "$HOTSPOT_NAME"
  elif [ -n "$router" ] && answers_ssh "$router"; then echo "$router"
  fi
}

echo "→ Looking for the GX10…"
TARGET=$(find_gx10 || true)
if [ -z "$TARGET" ]; then
  echo "✗ Can't reach the GX10${GIVEN_ADDRESS:+ at $GIVEN_ADDRESS}. This Mac's Wi-Fi: address" \
       "$(ipconfig getifaddr "$WIFI_DEVICE" 2>/dev/null || echo none)."
  exit 1
fi
echo "✓ Something answers SSH at $TARGET"

if [ "$NEW_IDENTITY" = "--new-identity" ]; then
  echo "  It presents:  $(ssh-keyscan -T 5 -t ed25519 "$TARGET" 2>/dev/null | ssh-keygen -lf - | awk '{print $2}')"
  echo "  Trust it only if ONE of these is true:"
  echo "    a) you read the address $TARGET off the box's OWN screen, or"
  echo "    b) on the box, 'ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub' prints that same fingerprint."
  echo "  (No keyboard? GNOME has one for the mouse: Settings → Accessibility → Typing → Screen Keyboard.)"
  read -r -p "  Type yes to trust this machine as the box: " answer
  [ "$answer" = "yes" ] || { echo "✗ Not trusted. Nothing changed."; exit 1; }
  ssh-keygen -R "$IDENTITY_PIN" >/dev/null 2>&1 || true
fi

/usr/bin/sed -E -i '' "/^Host $HOST_ALIAS\$/,/^(Host|Match) /{
  s|^  HostName .*|  HostName $TARGET|
  s|^  HostKeyAlias .*|  HostKeyAlias $IDENTITY_PIN|
  s|^  User .*|  User $BOX_USER|
}" "$SSH_CONFIG"

if ssh -o BatchMode=yes "$HOST_ALIAS" true 2>/dev/null; then
  echo "✓ Key already installed."
else
  echo "→ Installing the SSH key. Confirm the fingerprint, then type the box's password (the only time)."
  ssh-copy-id -i "$KEY.pub" -o IdentitiesOnly=yes -o "HostKeyAlias=$IDENTITY_PIN" "$BOX_USER@$TARGET"
fi

echo "→ Probing the box…"
{ date; echo "reached via: $TARGET"; ssh -o BatchMode=yes "$HOST_ALIAS" 'bash -s' < scripts/gx10/probe.sh; } | tee "$REPORT"
echo
echo "✓ Saved to $REPORT. 'ssh $HOST_ALIAS' now reaches the box — tell Claude it's done."
