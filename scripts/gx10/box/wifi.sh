#!/usr/bin/env bash
# On the GX10. Its one Wi-Fi radio either serves the box's own hotspot or joins a venue network.
# Joining drops the hotspot — the only way in — so a join never strands the box: if it can't reach the
# internet, or the Mac doesn't confirm it found the box within CONFIRM_MINUTES, the hotspot comes back.
#   wifi.sh join <ssid> [mac-ip]   password is read from run/wifi.secret (written by join-wifi.sh), then shredded
#   wifi.sh confirm                the Mac found the box: keep the venue network
#   wifi.sh hotspot                go back to serving the hotspot (for the demo)
#   wifi.sh status
set -euo pipefail

KAMI=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
RUN=$KAMI/run
LOG=$KAMI/logs/wifi.log
PROFILE=kami-venue
SECRET=$RUN/wifi.secret
HOTSPOT_UUID=$RUN/hotspot.uuid
STATE=$RUN/wifi.state
CONFIRMED=$RUN/wifi.confirmed
CONNECT_WAIT=90
SETTLE_GRACE=30
INTERNET_WAIT=45
CONFIRM_MINUTES=10
mkdir -p "$RUN" "$(dirname "$LOG")"

say() { printf '%s  %s\n' "$(date '+%H:%M:%S')" "$*" | tee -a "$LOG" >&2; }

wifi_device() { nmcli -t -f DEVICE,TYPE device status | awk -F: '$2=="wifi"{print $1; exit}'; }

active_uuid_on() {
  nmcli -t -f UUID,DEVICE connection show --active | awk -F: -v device="$1" '$2==device{print $1; exit}'
}

remember_hotspot() {
  local uuid
  uuid=$(active_uuid_on "$(wifi_device)")
  [ -n "$uuid" ] && [ "$(nmcli -g 802-11-wireless.mode connection show uuid "$uuid")" = "ap" ] || return 0
  echo "$uuid" > "$HOTSPOT_UUID"
}

may_change_networks() {
  local permissions
  permissions=$(nmcli -t general permissions)
  grep -q '^org.freedesktop.NetworkManager.network-control:yes$' <<<"$permissions" &&
    grep -q '^org.freedesktop.NetworkManager.settings.modify.system:yes$' <<<"$permissions"
}

has_internet() { curl -fs -m 4 -o /dev/null https://example.com; }

wait_until() {
  local seconds=$1; shift
  for _ in $(seq 1 "$seconds"); do "$@" && return 0; sleep 1; done
  return 1
}

hand_back_files() {
  [ -n "${SUDO_UID:-}" ] && chown -R "$SUDO_UID:${SUDO_GID:-$SUDO_UID}" "$RUN" "$(dirname "$LOG")" || true
}

on_venue() {
  [ "$(nmcli -g GENERAL.CONNECTION device show "$(wifi_device)" 2>/dev/null)" = "$PROFILE" ] &&
    nmcli -g GENERAL.STATE device show "$(wifi_device)" 2>/dev/null | grep -q '^100 '
}

hotspot_is_up() { [ "$(active_uuid_on "$(wifi_device)")" = "$(cat "$HOTSPOT_UUID" 2>/dev/null)" ]; }

settled=no

restore_hotspot() {
  settled=yes
  say "↩ back to the hotspot: $1"
  nmcli connection delete "$PROFILE" >/dev/null 2>&1 || true
  if hotspot_is_up || nmcli --wait "$CONNECT_WAIT" connection up uuid "$(cat "$HOTSPOT_UUID")" >/dev/null 2>&1; then
    echo "hotspot (rolled back: $1)" > "$STATE"
  else
    echo "UNREACHABLE — power-cycle the box to bring its hotspot back ($1)" > "$STATE"
    say "✗ could not bring the hotspot back; a power-cycle will"
  fi
  hand_back_files
}

apply_join() {
  local ssid=$1 mac_ip=${2:-} device password address
  trap '[ "$settled" = yes ] || restore_hotspot "the join script stopped unexpectedly"' EXIT
  device=$(wifi_device)
  password=$(cat "$SECRET")
  shred -u "$SECRET" 2>/dev/null || rm -f "$SECRET"
  rm -f "$CONFIRMED"
  sleep 3

  nmcli connection delete "$PROFILE" >/dev/null 2>&1 || true
  if ! nmcli connection add type wifi ifname "$device" con-name "$PROFILE" ssid "$ssid" \
      wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$password" \
      connection.autoconnect yes connection.autoconnect-priority 10 connection.autoconnect-retries 2 >/dev/null 2>>"$LOG"; then
    unset password
    restore_hotspot "could not create the Wi-Fi profile"
    return
  fi
  unset password

  say "→ joining '$ssid' (the hotspot goes down now)"
  nmcli --wait "$CONNECT_WAIT" connection up "$PROFILE" >/dev/null 2>>"$LOG" ||
    wait_until "$SETTLE_GRACE" on_venue ||
    { restore_hotspot "could not join '$ssid' — wrong password, or out of range"; return; }
  wait_until "$INTERNET_WAIT" has_internet ||
    { restore_hotspot "joined '$ssid' but there is no internet"; return; }

  address=$(nmcli -g IP4.ADDRESS device show "$device" | head -1 | cut -d/ -f1)
  echo "venue '$ssid' at $address — waiting for the Mac to confirm" > "$STATE"
  say "✓ on '$ssid' at $address with internet; waiting up to $CONFIRM_MINUTES min for the Mac"
  hand_back_files

  for _ in $(seq 1 $((CONFIRM_MINUTES * 12))); do
    if [ -e "$CONFIRMED" ]; then
      settled=yes
      echo "venue '$ssid' at $address" > "$STATE"
      say "✓ confirmed by the Mac"
      hand_back_files
      return
    fi
    [ -n "$mac_ip" ] && ping -c 1 -W 1 "$mac_ip" >/dev/null 2>&1 || true
    sleep 5
  done
  restore_hotspot "the Mac never confirmed it could reach the box (client isolation?)"
}

join() {
  local ssid=${1:?usage: wifi.sh join <ssid> [mac-ip]} mac_ip=${2:-}
  [ -s "$SECRET" ] || { echo "✗ $SECRET is missing — run scripts/gx10/join-wifi.sh on the Mac"; exit 1; }
  remember_hotspot
  [ -s "$HOTSPOT_UUID" ] || { echo "✗ the box isn't serving a hotspot, so there would be nothing to fall back to"; exit 1; }

  if may_change_networks; then
    setsid nohup bash "${BASH_SOURCE[0]}" _apply "$ssid" "$mac_ip" >>"$LOG" 2>&1 </dev/null &
  else
    echo "  Changing networks over SSH needs sudo on this box. Type the BOX password:"
    sudo -v
    sudo -b setsid nohup bash "${BASH_SOURCE[0]}" _apply "$ssid" "$mac_ip" >>"$LOG" 2>&1 </dev/null
  fi
  echo "✓ The box will now leave its hotspot and join '$ssid'. This connection is about to drop."
  echo "  If anything goes wrong it returns to the hotspot by itself (within $CONFIRM_MINUTES minutes at most)."
}

apply_hotspot() {
  nmcli connection modify "$PROFILE" connection.autoconnect no >/dev/null 2>&1 || true
  sleep 3
  if hotspot_is_up || nmcli --wait "$CONNECT_WAIT" connection up uuid "$(cat "$HOTSPOT_UUID")" >/dev/null 2>>"$LOG"; then
    echo "hotspot" > "$STATE"
    say "✓ serving the hotspot again"
  else
    say "✗ could not bring the hotspot up; still on the venue network"
  fi
  hand_back_files
}

back_to_hotspot() {
  [ -s "$HOTSPOT_UUID" ] || { echo "✗ no hotspot on record"; exit 1; }
  if may_change_networks; then
    setsid nohup bash "${BASH_SOURCE[0]}" _hotspot >>"$LOG" 2>&1 </dev/null &
  else
    echo "  Changing networks over SSH needs sudo on this box. Type the BOX password:"
    sudo -v
    sudo -b setsid nohup bash "${BASH_SOURCE[0]}" _hotspot >>"$LOG" 2>&1 </dev/null
  fi
  echo "✓ The box is going back to its hotspot. This connection is about to drop."
}

case "${1:-status}" in
  join)     shift; join "$@" ;;
  _apply)   shift; apply_join "$@" ;;
  confirm)  touch "$CONFIRMED"; echo "✓ confirmed" ;;
  hotspot)  back_to_hotspot ;;
  _hotspot) apply_hotspot ;;
  status)   cat "$STATE" 2>/dev/null || echo "hotspot (never changed)"; nmcli -t -f DEVICE,STATE,CONNECTION device status | grep -v '^lo:'; tail -5 "$LOG" 2>/dev/null ;;
  *) echo "usage: wifi.sh join <ssid> [mac-ip] | confirm | hotspot | status"; exit 2 ;;
esac
