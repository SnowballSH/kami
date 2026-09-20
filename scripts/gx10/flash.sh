#!/usr/bin/env bash
# Run on the Mac whenever it can reach the box. Compiles a sketch from hardware/ on the GX10 and uploads it
# to the Arduino plugged into the box. The box installs its own pinned Arduino CLI under ~/kami-hardware on
# the first run (no sudo). The Kami server reads the same port, and two readers would corrupt the upload,
# so a server that holds the port is stopped for the upload and everything is started again after.
#   usage: flash.sh [joystick|cabinet]      KAMI_FLASH_PORT=/dev/ttyACM1 names a port other than the first
set -euo pipefail
cd "$(dirname "$0")/../.."

HOST_ALIAS=gx10
SKETCH="${1:-joystick}"
if [[ $# -gt 1 || ! -f "hardware/$SKETCH/$SKETCH.ino" ]]; then
  echo "usage: $0 [$(find hardware -name '*.ino' -exec basename {} .ino \; | sort | paste -sd'|' -)]" >&2
  exit 2
fi

ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST_ALIAS" true 2>/dev/null ||
  { echo "✗ Can't reach the box (ssh $HOST_ALIAS)."; exit 1; }

COPYFILE_DISABLE=1 tar --no-xattrs -C hardware -cf - . |
  ssh "$HOST_ALIAS" 'rm -rf ~/kami-hardware/sketches && mkdir -p ~/kami-hardware/sketches && tar -C ~/kami-hardware/sketches -xf -'

ssh "$HOST_ALIAS" bash -s -- "$SKETCH" "${KAMI_FLASH_PORT:-}" <<'REMOTE'
set -euo pipefail
SKETCH="$1"
PORT="${2:-$(find /dev -maxdepth 1 -name 'ttyACM*' | sort | head -1)}"
HARDWARE_HOME="$HOME/kami-hardware"
CLI_VERSION=1.3.1
CLI_ARCHIVE="arduino-cli_${CLI_VERSION}_Linux_ARM64.tar.gz"
CLI_SHA256=cf4f668b1add7a20310d79e83a1f3eb148031f95e5673d9171c65f5e9a126a94
CLI="$HARDWARE_HOME/bin/arduino-cli"
KAMI_HOME="$HOME/kami"
export ARDUINO_DIRECTORIES_DATA="$HARDWARE_HOME/data"
export ARDUINO_DIRECTORIES_USER="$HARDWARE_HOME/user"
export ARDUINO_DIRECTORIES_DOWNLOADS="$HARDWARE_HOME/downloads"

[ -n "$PORT" ] || { echo "✗ No Arduino on the box (/dev/ttyACM*): check the USB data cable." >&2; exit 1; }
[ -r "$PORT" ] && [ -w "$PORT" ] ||
  { echo "✗ No permission for $PORT: sudo usermod -aG dialout \$USER on the box, then run this again." >&2; exit 1; }

if [[ "$("$CLI" version 2>/dev/null)" != *"Version: $CLI_VERSION "* ]]; then
  mkdir -p "$HARDWARE_HOME/bin" "$ARDUINO_DIRECTORIES_DOWNLOADS"
  curl -fsSL -o "$ARDUINO_DIRECTORIES_DOWNLOADS/$CLI_ARCHIVE" "https://downloads.arduino.cc/arduino-cli/$CLI_ARCHIVE"
  echo "$CLI_SHA256  $ARDUINO_DIRECTORIES_DOWNLOADS/$CLI_ARCHIVE" | sha256sum --check --quiet
  tar -xzf "$ARDUINO_DIRECTORIES_DOWNLOADS/$CLI_ARCHIVE" -C "$HARDWARE_HOME/bin" arduino-cli
fi

server_pid="$(cat "$KAMI_HOME/run/server.pid" 2>/dev/null || true)"
server_reads_port() {
  [ -n "$server_pid" ] && find "/proc/$server_pid/fd" -lname "$PORT" 2>/dev/null | grep -q .
}
restart_kami=false
BUILD="$(mktemp -d "$HARDWARE_HOME/build.XXXXXX")"
finish() {
  rm -rf "$BUILD"
  [ "$restart_kami" = false ] || bash "$KAMI_HOME/current/box/start.sh"
}
trap finish EXIT

"$CLI" compile --profile uno-r4-wifi --build-path "$BUILD" "$HARDWARE_HOME/sketches/$SKETCH"

if server_reads_port; then
  echo "  the Kami server is reading $PORT — stopping it for the upload"
  bash "$KAMI_HOME/current/box/stop.sh" server
  restart_kami=true
fi
"$CLI" upload --profile uno-r4-wifi --input-dir "$BUILD" --port "$PORT" "$HARDWARE_HOME/sketches/$SKETCH"
echo "✓ $SKETCH is on the Arduino at $PORT"
REMOTE
