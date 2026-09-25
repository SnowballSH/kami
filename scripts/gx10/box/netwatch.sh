#!/usr/bin/env bash
# On the GX10, every two minutes from cron. The venue Wi-Fi is the only way the laptop and the iPads reach
# this box, and nobody is sitting at its keyboard: so whenever its one radio is not on the venue network —
# on nothing, or serving its own hotspot with nobody connected — it tries the venue network again. If that
# fails the hotspot comes back, so there is always a way in. A hotspot somebody is using is left alone, and
# so is one that was tried less than HOTSPOT_RETRY_MINUTES ago: a hotspot that blinks is no way in either.
#   netwatch.sh            one check (what cron runs)
#   netwatch.sh install    add the cron entry      netwatch.sh uninstall    remove it
set -uo pipefail

KAMI=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
LOG=$KAMI/logs/netwatch.log
LOCK=$KAMI/run/netwatch.lock
TRIED=$KAMI/run/netwatch.tried
JOIN_WAIT=40
HOTSPOT_RETRY_MINUTES=10
ENTRY="*/2 * * * * bash $KAMI/box/netwatch.sh # kami-netwatch"
mkdir -p "$KAMI/run" "$KAMI/logs"

say() { printf '%s  %s\n' "$(date '+%F %T')" "$*" >> "$LOG"; }
nm() { nmcli "$@" 2>/dev/null || sudo -n nmcli "$@" 2>/dev/null; }
wifi_device() { nmcli -t -f DEVICE,TYPE device status | awk -F: '$2=="wifi"{print $1; exit}'; }
mode_of() { nmcli -g 802-11-wireless.mode connection show "$1" 2>/dev/null; }
priority_of() { nmcli -g connection.autoconnect-priority connection show "$1" 2>/dev/null; }
wifi_profiles() { nmcli -t -f NAME,TYPE connection show | awk -F: '$2=="802-11-wireless"{print $1}'; }

profile_in_mode() {
  local wanted=$1 best="" best_priority=-1000 name priority
  while IFS= read -r name; do
    [ "$(mode_of "$name")" = "$wanted" ] || continue
    priority=$(priority_of "$name")
    if [ "${priority:-0}" -gt "$best_priority" ]; then best=$name; best_priority=${priority:-0}; fi
  done < <(wifi_profiles)
  printf '%s' "$best"
}

guests_on() { iw dev "$1" station dump 2>/dev/null | grep -c '^Station' || true; }

tried_recently() {
  [ -e "$TRIED" ] && [ -n "$(find "$TRIED" -mmin "-$HOTSPOT_RETRY_MINUTES" 2>/dev/null)" ]
}

check() {
  local device active venue hotspot
  device=$(wifi_device)
  venue=$(profile_in_mode infrastructure)
  [ -n "$device" ] && [ -n "$venue" ] || return 0
  active=$(nmcli -g GENERAL.CONNECTION device show "$device" 2>/dev/null)
  [ "$active" = "$venue" ] && return 0
  if [ -n "$active" ] && [ "$(mode_of "$active")" = ap ]; then
    [ "$(guests_on "$device")" -gt 0 ] && return 0
    tried_recently && return 0
  fi
  touch "$TRIED"
  say "on '${active:-nothing}', not the venue network: trying it"
  if nm --wait "$JOIN_WAIT" connection up "$venue" >/dev/null; then
    say "✓ back on the venue network at $(hostname -I | cut -d' ' -f1)"
    return 0
  fi
  hotspot=$(profile_in_mode ap)
  say "✗ the venue network did not take; ${hotspot:+the hotspot comes back}"
  [ -n "$hotspot" ] && nm --wait "$JOIN_WAIT" connection up "$hotspot" >/dev/null
  return 0
}

without_entry() { crontab -l 2>/dev/null | grep -v '# kami-netwatch$' || true; }

case "${1:-}" in
  install) { without_entry; echo "$ENTRY"; } | crontab -; echo "  ✓ the box checks its network every two minutes" ;;
  uninstall) without_entry | crontab -; echo "  ✓ network watch removed" ;;
  "")
    exec 9>"$LOCK"
    flock -n 9 || exit 0
    check
    ;;
  *) echo "usage: netwatch.sh [install|uninstall]"; exit 2 ;;
esac
