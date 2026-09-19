#!/usr/bin/env bash
# Run on the Mac while it is on the GX10's hotspot. Moves the box onto the venue Wi-Fi, so that from
# then on the Mac and the box share a network (and the box has internet) with no more hopping.
# You type the venue Wi-Fi password here; it goes straight to the box and is never stored on the Mac.
set -euo pipefail
cd "$(dirname "$0")/../.."

HOST_ALIAS=gx10
HOTSPOT_ADDRESS=10.13.37.1
SSID=${1:-HackMIT.2026}
SSH=(ssh -o "HostName=$HOTSPOT_ADDRESS" "$HOST_ALIAS")
mkdir -p .gx10

if ! "${SSH[@]}" -o BatchMode=yes true 2>/dev/null; then
  echo "✗ Can't reach the box. Join the 'gx10-4d82' Wi-Fi on this Mac first, then re-run."
  exit 1
fi

echo "→ Sending the network script to the box"
"${SSH[@]}" 'mkdir -p ~/kami/box ~/kami/run ~/kami/logs'
scp -q -o "HostName=$HOTSPOT_ADDRESS" scripts/gx10/box/wifi.sh "$HOST_ALIAS:kami/box/wifi.sh"
"${SSH[@]}" 'hostname' > .gx10/box-hostname
"${SSH[@]}" 'cat /sys/class/net/$(nmcli -t -f DEVICE,TYPE device status | awk -F: "\$2==\"wifi\"{print \$1; exit}")/address' > .gx10/box-wifi-mac

read -rs -p "Wi-Fi password for '$SSID': " wifi_password
echo
[ -n "$wifi_password" ] || { echo "✗ No password entered."; exit 1; }
printf '%s' "$wifi_password" | "${SSH[@]}" 'umask 077; cat > ~/kami/run/wifi.secret'
unset wifi_password

mac_venue_ip=$(cat .gx10/mac-venue-ip 2>/dev/null || true)
"${SSH[@]}" -t "bash ~/kami/box/wifi.sh join $(printf '%q' "$SSID") $(printf '%q' "$mac_venue_ip")"

echo
echo "Next: put this Mac back on '$SSID', then run:  bun run gx10:find"
echo "(If the box can't get online it returns to its hotspot by itself — 'gx10-4d82' will reappear.)"
