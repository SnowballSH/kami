#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:---all}"
if [[ "$#" -gt 1 || ( "$mode" != "--all" && "$mode" != "--native" ) ]]; then
  echo "Usage: $0 [--all|--native]" >&2
  exit 2
fi

cache="${XDG_CACHE_HOME:-$HOME/.cache}"
mkdir -p "$cache"
build="$(mktemp -d "$cache/kami-cabinet.XXXXXX")"
trap 'rm -rf "$build"' EXIT
"${CXX:-c++}" -std=c++11 -Wall -Wextra -Werror -pedantic \
  "$root/hardware/cabinetInput.test.cpp" -o "$build/input-test"
"$build/input-test"
echo "Cabinet debounce, framing and feedback tests passed."

if [[ "$mode" == "--all" ]]; then
  "${ARDUINO_CLI:-arduino-cli}" compile --profile uno-r4-wifi \
    --build-path "$build/firmware" "$root/hardware/cabinet"
fi
