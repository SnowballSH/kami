#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:---all}"
if [[ "$#" -gt 1 || ( "$mode" != "--all" && "$mode" != "--native" ) ]]; then
  echo "Usage: $0 [--all|--native]" >&2
  exit 2
fi

native_tests=(cabinetInput joystickStick)
sketches=(cabinet joystick)

cache="${XDG_CACHE_HOME:-$HOME/.cache}"
mkdir -p "$cache"
build="$(mktemp -d "$cache/kami-hardware.XXXXXX")"
trap 'rm -rf "$build"' EXIT
for test in "${native_tests[@]}"; do
  "${CXX:-c++}" -std=c++11 -Wall -Wextra -Werror -pedantic -I "$root/hardware/libraries/KamiControls" \
    "$root/hardware/$test.test.cpp" -o "$build/$test"
  "$build/$test"
done
echo "Cabinet debounce, framing and feedback tests and joystick travel, reporting and line tests passed."

if [[ "$mode" == "--all" ]]; then
  for sketch in "${sketches[@]}"; do
    "${ARDUINO_CLI:-arduino-cli}" compile --profile uno-r4-wifi \
      --build-path "$build/$sketch" "$root/hardware/$sketch"
  done
fi
