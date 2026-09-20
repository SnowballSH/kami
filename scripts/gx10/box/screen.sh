#!/usr/bin/env bash
# On the GX10: the big screen (docs/screen.md). Shows the game's /?screen page full-screen on the monitor
# plugged into this box: Firefox in kiosk mode on the desktop session that is logged in, with a profile of
# its own, held awake by an idle inhibitor for exactly as long as it runs. No settings are changed and no
# sudo is used; on a box with no desktop session `start` says so and leaves the game headless.
#   screen.sh start [url] | reload (load the page afresh, same address) | stop | status |
#             install (come up with the desktop session) | uninstall
set -euo pipefail

SCRIPT_DIR=$(cd -P "$(dirname "$0")" && pwd)
SCRIPT_PATH="$SCRIPT_DIR/$(basename "$0")"
cd -P "$SCRIPT_DIR/.."
KAMI_HOME=$PWD

PORT=${PORT:-8787}
STABLE_SCRIPT_PATH="$HOME/kami/current/box/screen.sh"
PID_FILE="$KAMI_HOME/run/screen.pid"
URL_FILE="$KAMI_HOME/run/screen.url"
LOG_FILE="$KAMI_HOME/logs/screen.log"
AUTOSTART_FILE="$HOME/.config/autostart/kami-screen.desktop"
mkdir -p "$KAMI_HOME/run" "$KAMI_HOME/logs"

SESSION_TYPE=""
DISPLAY_VALUE=""
XAUTHORITY_VALUE=""
WAYLAND_DISPLAY_VALUE=""
DBUS_SESSION_BUS_ADDRESS_VALUE=""
XDG_RUNTIME_DIR_VALUE=""

lan_address() {
  ip -4 route get 1.1.1.1 2>/dev/null | awk '{ for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit } }'
}

default_url() {
  local address
  address=$(lan_address)
  if [ -n "$address" ]; then
    echo "http://localhost:$PORT/?screen&join=http://$address:$PORT"
  else
    echo "http://localhost:$PORT/?screen"
  fi
}

detect_session() {
  local uid session_id
  uid=$(id -u)
  XDG_RUNTIME_DIR_VALUE=${XDG_RUNTIME_DIR:-/run/user/$uid}
  [ -d "$XDG_RUNTIME_DIR_VALUE" ] || return 1

  session_id=$(loginctl list-sessions --no-legend 2>/dev/null |
    awk -v u="$uid" '$2==u && $4!="-" && $6=="active"{print $1; exit}') || true
  if [ -z "$session_id" ]; then
    session_id=$(loginctl list-sessions --no-legend 2>/dev/null |
      awk -v u="$uid" '$2==u && $4!="-"{print $1; exit}') || true
  fi
  [ -n "$session_id" ] || return 1

  SESSION_TYPE=$(loginctl show-session "$session_id" -p Type --value 2>/dev/null) || true
  case "$SESSION_TYPE" in
    wayland | x11) ;;
    *) return 1 ;;
  esac

  DBUS_SESSION_BUS_ADDRESS_VALUE=""
  if [ -S "$XDG_RUNTIME_DIR_VALUE/bus" ]; then
    DBUS_SESSION_BUS_ADDRESS_VALUE="unix:path=$XDG_RUNTIME_DIR_VALUE/bus"
  fi

  WAYLAND_DISPLAY_VALUE=""
  if [ "$SESSION_TYPE" = wayland ]; then
    local sock
    for sock in "$XDG_RUNTIME_DIR_VALUE"/wayland-*; do
      [ -S "$sock" ] || continue
      WAYLAND_DISPLAY_VALUE=$(basename "$sock")
      break
    done
  fi

  DISPLAY_VALUE=""
  XAUTHORITY_VALUE=""
  if [ "$SESSION_TYPE" = x11 ] || [ -z "$WAYLAND_DISPLAY_VALUE" ]; then
    local pid var val
    for pid in $(pgrep -u "$uid" -x gnome-shell 2>/dev/null) \
      $(pgrep -u "$uid" -x Xorg 2>/dev/null) \
      $(pgrep -u "$uid" -x Xwayland 2>/dev/null); do
      [ -n "$DISPLAY_VALUE" ] && break
      [ -r "/proc/$pid/environ" ] || continue
      while IFS='=' read -r -d '' var val; do
        case "$var" in
          DISPLAY) DISPLAY_VALUE=$val ;;
          XAUTHORITY) XAUTHORITY_VALUE=$val ;;
          WAYLAND_DISPLAY) [ -n "$WAYLAND_DISPLAY_VALUE" ] || WAYLAND_DISPLAY_VALUE=$val ;;
        esac
      done <"/proc/$pid/environ"
    done
  fi

  if [ "$SESSION_TYPE" = wayland ] && [ -z "$WAYLAND_DISPLAY_VALUE" ]; then return 1; fi
  if [ "$SESSION_TYPE" = x11 ] && [ -z "$DISPLAY_VALUE" ]; then return 1; fi
  return 0
}

wait_for_url() {
  local url=$1 attempts=$2 host="" port="" scheme=""
  if [[ $url =~ ^([a-zA-Z][a-zA-Z0-9+.-]*)://([^/:?#]+)(:([0-9]+))? ]]; then
    scheme=${BASH_REMATCH[1]}
    host=${BASH_REMATCH[2]}
    port=${BASH_REMATCH[4]}
    if [ -z "$port" ]; then
      if [ "$scheme" = https ]; then port=443; else port=80; fi
    fi
  fi
  [ -n "$host" ] && [ -n "$port" ] || return 0
  for _ in $(seq 1 "$attempts"); do
    (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null && return 0
    sleep 1
  done
  return 1
}

write_kiosk_prefs() {
  local dir=$1
  cat >"$dir/user.js" <<'EOF'
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.sessionstore.resume_from_crash", false);
user_pref("browser.startup.page", 0);
user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);
user_pref("browser.aboutwelcome.enabled", false);
user_pref("startup.homepage_welcome_url", "about:blank");
user_pref("startup.homepage_welcome_url.additional", "");
user_pref("browser.uitour.enabled", false);
user_pref("browser.newtabpage.enabled", false);
user_pref("full-screen-api.warning.timeout", 0);
user_pref("full-screen-api.transition-duration.enter", "0 0");
user_pref("full-screen-api.transition-duration.leave", "0 0");
user_pref("browser.tabs.warnOnClose", false);
user_pref("browser.warnOnQuit", false);
user_pref("app.update.auto", false);
user_pref("app.update.enabled", false);
user_pref("signon.rememberSignons", false);
user_pref("browser.disableResetPrompt", true);
user_pref("browser.tabs.crashReporting.sendReport", false);
user_pref("breakpad.reportURL", "");
EOF
}

current_pid() {
  [ -s "$PID_FILE" ] || return 1
  local pid
  pid=$(cat "$PID_FILE")
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 1
  printf '%s\n' "$pid"
}

stop_kiosk() {
  local pid
  if ! pid=$(current_pid); then
    echo "– kiosk is not running"
    rm -f "$PID_FILE"
    return 0
  fi
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 40); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.25
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  echo "✓ kiosk stopped"
}

start_kiosk() {
  local url=$1

  if ! detect_session; then
    echo "→ no graphical session for $(id -un) — nothing to show on a screen; leaving the game headless"
    return 0
  fi

  if command -v firefox >/dev/null 2>&1; then
    :
  else
    echo "✗ firefox is not installed" >&2
    return 1
  fi

  local previous_pid
  if previous_pid=$(current_pid); then
    echo "→ restarting the kiosk (was pid $previous_pid)"
    stop_kiosk
  fi

  local firefox_profile_dir firefox_snap_common_profile_dir
  if snap list firefox >/dev/null 2>&1; then
    firefox_snap_common_profile_dir="$HOME/snap/firefox/common/kami-screen"
    firefox_profile_dir=$firefox_snap_common_profile_dir
    echo "  firefox is a snap — using $firefox_profile_dir so the snap's confinement can reach it"
  else
    firefox_profile_dir="$KAMI_HOME/run/screen-profile"
  fi
  mkdir -p "$firefox_profile_dir"
  write_kiosk_prefs "$firefox_profile_dir"

  echo "→ waiting up to 60s for $url to answer…"
  wait_for_url "$url" 60 || echo "  ! not answering yet — opening the kiosk anyway"

  local -a inhibitor=()
  if command -v gnome-session-inhibit >/dev/null 2>&1; then
    inhibitor=(gnome-session-inhibit --inhibit idle:suspend --reason "Kami spectator screen")
  elif command -v systemd-inhibit >/dev/null 2>&1; then
    inhibitor=(systemd-inhibit --what=idle:sleep --why "Kami spectator screen")
  else
    echo "  ! no idle inhibitor available on this box — the monitor may sleep"
  fi

  local -a env_args=("XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR_VALUE")
  [ -n "$DBUS_SESSION_BUS_ADDRESS_VALUE" ] && env_args+=("DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS_VALUE")
  if [ -n "$WAYLAND_DISPLAY_VALUE" ]; then
    env_args+=("WAYLAND_DISPLAY=$WAYLAND_DISPLAY_VALUE" "MOZ_ENABLE_WAYLAND=1")
  fi
  if [ -n "$DISPLAY_VALUE" ]; then
    env_args+=("DISPLAY=$DISPLAY_VALUE")
    [ -n "$XAUTHORITY_VALUE" ] && env_args+=("XAUTHORITY=$XAUTHORITY_VALUE")
  fi

  : >"$LOG_FILE"
  setsid nohup env "${env_args[@]}" "${inhibitor[@]}" \
    firefox --kiosk --no-remote --new-instance -profile "$firefox_profile_dir" "$url" \
    >>"$LOG_FILE" 2>&1 </dev/null &
  local launcher_pid=$!
  printf '%s\n' "$url" >"$URL_FILE"

  # Firefox leads a process group of its own, apart from the inhibitor that launched it, so the pid
  # kept for stop is Firefox's: the process named firefox whose command line carries this profile.
  local pid=$launcher_pid candidate
  if [ "${#inhibitor[@]}" -gt 0 ]; then
    for _ in $(seq 1 40); do
      for candidate in $(pgrep -f -- "-profile $firefox_profile_dir" 2>/dev/null); do
        [ "$(ps -o comm= -p "$candidate" 2>/dev/null)" = firefox ] || continue
        pid=$candidate
        break 2
      done
      kill -0 "$launcher_pid" 2>/dev/null || break
      sleep 0.25
    done
  fi
  echo "$pid" >"$PID_FILE"

  sleep 2
  if kill -0 "$pid" 2>/dev/null; then
    echo "✓ kiosk running on $SESSION_TYPE (pid $pid) → $url"
  else
    echo "✗ kiosk did not start; its last words:"
    tail -15 "$LOG_FILE" | sed 's/^/    /'
    return 1
  fi
}

show_status() {
  local pid=""
  pid=$(current_pid) || true
  if [ -n "$pid" ]; then
    echo "✓ kiosk running (pid $pid)"
    [ -s "$URL_FILE" ] && echo "  url: $(cat "$URL_FILE")"
  else
    echo "✗ kiosk is not running"
    [ -s "$URL_FILE" ] && echo "  last url: $(cat "$URL_FILE")"
  fi

  if detect_session; then
    echo "  session: $SESSION_TYPE"
  else
    echo "  session: none found for $(id -un)"
  fi

  local f state name
  local -a connected=()
  for f in /sys/class/drm/*/status; do
    [ -r "$f" ] || continue
    state=$(cat "$f" 2>/dev/null) || true
    [ "$state" = connected ] || continue
    name=$(basename "$(dirname "$f")")
    connected+=("$name")
  done
  if [ "${#connected[@]}" -gt 0 ]; then
    echo "  monitors: ${connected[*]}"
  else
    echo "  monitors: none detected"
  fi
}

install_autostart() {
  mkdir -p "$(dirname "$AUTOSTART_FILE")"
  cat >"$AUTOSTART_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=Kami Spectator Screen
Comment=Shows the Kami spectator page full-screen once this desktop session logs in
Exec=/bin/bash -c 'sleep 5; exec "$STABLE_SCRIPT_PATH" start'
X-GNOME-Autostart-enabled=true
NoDisplay=true
EOF
  echo "✓ installed $AUTOSTART_FILE → runs $STABLE_SCRIPT_PATH start after login"
}

uninstall_autostart() {
  rm -f "$AUTOSTART_FILE"
  echo "✓ removed $AUTOSTART_FILE"
}

action=${1:-}
case "$action" in
  start)
    start_kiosk "${2:-$(default_url)}"
    ;;
  reload)
    start_kiosk "$(cat "$URL_FILE" 2>/dev/null || default_url)"
    ;;
  stop)
    stop_kiosk
    ;;
  status)
    show_status
    ;;
  install)
    install_autostart
    ;;
  uninstall)
    uninstall_autostart
    ;;
  *)
    echo "usage: $(basename "$SCRIPT_PATH") start [url] | reload | stop | status | install | uninstall" >&2
    exit 2
    ;;
esac
