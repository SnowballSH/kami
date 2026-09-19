#!/usr/bin/env bash
# Run on the Mac, on the venue Wi-Fi, after join-wifi.sh. Finds the box on the shared network, tells it
# to stay there (otherwise it returns to its hotspot after ten minutes), and points the `gx10` SSH alias at it.
set -euo pipefail
cd "$(dirname "$0")/../.."

HOST_ALIAS=gx10
SSH_CONFIG=$HOME/.ssh/config
PATIENCE_SECONDS=${1:-120}

candidates() {
  local name mac
  name=$(cat .gx10/box-hostname 2>/dev/null || true)
  mac=$(cat .gx10/box-wifi-mac 2>/dev/null || true)
  if [ -n "$name" ]; then echo "$name.local"; fi
  [ -n "$mac" ] && arp -an | awk -v wanted="$mac" '
    function canonical(address,    parts, count, i, out) {
      count = split(tolower(address), parts, ":")
      for (i = 1; i <= count; i++) { sub(/^0/, "", parts[i]); out = out (i > 1 ? ":" : "") parts[i] }
      return out
    }
    canonical($4) == canonical(wanted) { gsub(/[()]/, "", $2); print $2 }'
  return 0
}

is_the_box() { ssh -o BatchMode=yes -o ConnectTimeout=4 -o "HostName=$1" "$HOST_ALIAS" true 2>/dev/null; }

echo "→ Looking for the box on this network (up to ${PATIENCE_SECONDS}s)…"
deadline=$((SECONDS + PATIENCE_SECONDS))
found=""
while [ -z "$found" ] && [ "$SECONDS" -lt "$deadline" ]; do
  for address in $(candidates); do
    if is_the_box "$address"; then found=$address; break; fi
  done
  [ -n "$found" ] || sleep 4
done

if [ -z "$found" ]; then
  echo "✗ Not found. If 'gx10-4d82' is back in the Wi-Fi list, the join failed and the box rolled back:"
  echo "  join it and read ~/kami/logs/wifi.log, or just re-run join-wifi.sh."
  exit 1
fi

ssh -o BatchMode=yes -o "HostName=$found" "$HOST_ALIAS" 'bash ~/kami/box/wifi.sh confirm' >/dev/null
/usr/bin/sed -E -i '' "/^Host $HOST_ALIAS\$/,/^(Host|Match) /s|^  HostName .*|  HostName $found|" "$SSH_CONFIG"
echo "$found" > .gx10/box-address
echo "✓ The box is at $found and will stay on this network. 'ssh $HOST_ALIAS' now goes there."
ssh -o BatchMode=yes "$HOST_ALIAS" 'curl -fs -m 5 -o /dev/null https://ollama.com && echo "  ✓ the box has internet"'
