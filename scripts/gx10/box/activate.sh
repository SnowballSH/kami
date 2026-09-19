#!/usr/bin/env bash
set -euo pipefail
ROOT=${KAMI_HOME:-$HOME/kami}
RELEASE=$(cd -P "${1:?usage: activate.sh RELEASE_DIRECTORY}" && pwd)
mkdir -p "$ROOT/run" "$ROOT/data" "$ROOT/logs" "$ROOT/cache"
mkdir "$ROOT/run/deploy.lock" || { echo "Another activation is in progress" >&2; exit 1; }
previous=
switched=false

point_to() {
  local target=$1 name=$2
  ln -s "$target" "$ROOT/.$name-$$"
  mv -Tf "$ROOT/.$name-$$" "$ROOT/$name"
}

finish() {
  local result=$?
  trap - EXIT INT TERM
  if [ "$result" -ne 0 ] && [ "$switched" = true ]; then
    bash "$RELEASE/box/stop.sh" || true
    if [ -n "$previous" ]; then
      point_to "$previous" current
      if bash "$previous/box/start.sh" &&
          python3 "$RELEASE/box/release.py" ready "$previous" "http://127.0.0.1:${PORT:-8787}"; then
        echo "Restored previous release: $previous" >&2
      else
        echo "Rollback startup failed; inspect $ROOT/logs" >&2
      fi
    else
      rm -f "$ROOT/current"
    fi
  fi
  rm -f "$ROOT/.current-$$" "$ROOT/.previous-$$"
  rmdir "$ROOT/run/deploy.lock"
  exit "$result"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

python3 "$RELEASE/box/release.py" verify "$RELEASE"
if [ -L "$ROOT/current" ]; then
  previous=$(readlink -f "$ROOT/current")
elif [ -s "$ROOT/box/start.sh" ]; then
  previous=$ROOT
fi
[ "$previous" != "$RELEASE" ] || { echo "Release is already active"; exit 0; }
for name in data logs run cache; do
  if [ ! -e "$RELEASE/$name" ]; then ln -s "$ROOT/$name" "$RELEASE/$name"; fi
done
KAMI_RELEASE=$RELEASE bash "$RELEASE/box/install.sh"
for needed in runtime/bun runtime/mongodb/bin/mongod; do
  [ -x "$RELEASE/$needed" ] || { echo "Missing $needed" >&2; exit 1; }
done
switched=true
if [ -n "$previous" ]; then bash "$previous/box/stop.sh"; fi
point_to "$RELEASE" current
bash "$RELEASE/box/start.sh"
python3 "$RELEASE/box/release.py" ready "$RELEASE" "http://127.0.0.1:${PORT:-8787}"
if [ -n "$previous" ]; then point_to "$previous" previous; fi
echo "Activated $RELEASE"
