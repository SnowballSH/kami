#!/usr/bin/env bash
# Run on the Mac while it is on the GX10's hotspot. Moves the box onto the venue Wi-Fi, so that from
# then on the Mac and the box share a network (and the box has internet) with no more hopping.
# You type the venue Wi-Fi password here; it goes straight to the box and is never stored on the Mac.
# It also stops the box from suspending when idle, which is what makes its Wi-Fi vanish.
set -euo pipefail
cd "$(dirname "$0")/../.."

HOST_ALIAS=gx10
SSID=${1:?"usage: join-wifi.sh <venue Wi-Fi name>"}
HOTSPOT_ADDRESS=$(cat .gx10/box-hotspot-address 2>/dev/null || true)
if [ -z "$HOTSPOT_ADDRESS" ]; then
  echo "✗ Put the box's address on its own hotspot in .gx10/box-hotspot-address first (its gateway: \`ipconfig getoption en0 router\` while this Mac is on that hotspot)."
  exit 1
fi
SSH=(ssh -o "HostName=$HOTSPOT_ADDRESS" "$HOST_ALIAS")
mkdir -p .gx10

if ! "${SSH[@]}" -o BatchMode=yes true 2>/dev/null; then
  echo "✗ Can't reach the box. Join the box's own hotspot on this Mac first, then re-run."
  exit 1
fi

echo "→ Sending the network script to the box"
"${SSH[@]}" 'mkdir -p ~/kami/box ~/kami/run ~/kami/logs'
scp -q -o "HostName=$HOTSPOT_ADDRESS" scripts/gx10/box/wifi.sh "$HOST_ALIAS:kami/box/wifi.sh"
"${SSH[@]}" 'hostname' > .gx10/box-hostname
"${SSH[@]}" 'cat /sys/class/net/$(nmcli -t -f DEVICE,TYPE device status | awk -F: "\$2==\"wifi\"{print \$1; exit}")/address' > .gx10/box-wifi-mac

echo "→ Did the box fall asleep earlier? (suspend events in the last 3 hours)"
"${SSH[@]}" 'journalctl --since "-3h" --no-pager 2>/dev/null | grep -iE "suspend entry|PM: suspend|Reached target.*[Ss]leep" | tail -3 || true' | sed 's/^/    /'

echo "→ Keeping the box awake: desktop Ubuntu suspends when idle, which takes its Wi-Fi down with it."
echo "  This needs sudo on the box — type the BOX password. (Undo later: sudo systemctl unmask sleep.target suspend.target)"
"${SSH[@]}" -t 'sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target' ||
  echo "  ! Could not disable sleep — carrying on, but the box may doze off again after ~20 idle minutes."

read -rs -p "Wi-Fi password for '$SSID': " wifi_password
echo
[ -n "$wifi_password" ] || { echo "✗ No password entered."; exit 1; }
printf '%s' "$wifi_password" | "${SSH[@]}" 'umask 077; cat > ~/kami/run/wifi.secret'
unset wifi_password

mac_venue_ip=$(cat .gx10/mac-venue-ip 2>/dev/null || true)
"${SSH[@]}" -t "bash ~/kami/box/wifi.sh join $(printf '%q' "$SSID") $(printf '%q' "$mac_venue_ip")"

echo
echo "Next: put this Mac back on '$SSID', then run:  bun run gx10:find"
echo "(If the box can't get online it returns to its hotspot by itself, and that network will reappear.)"
