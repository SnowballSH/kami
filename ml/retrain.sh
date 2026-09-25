#!/usr/bin/env bash
# Kami's Eye retraining kit — see ml/README.md.
#
#   ml/retrain.sh setup                     uv environment with the right torch for this machine
#   ml/retrain.sh launch all --preset full  a detached run: survives the terminal, keeps the machine
#                                           awake, restarts after a crash, resumes from its checkpoint
#   ml/retrain.sh status [--name N]         where a run is
#   ml/retrain.sh watch [--name N]          follow its log
#   ml/retrain.sh stop [--name N]           checkpoint and stop (launch again to resume)
#   ml/retrain.sh STAGE [options]           any retrain.py stage in the foreground
set -euo pipefail

ML="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="$ML/.venv/bin/python"
SELF="$ML/$(basename "${BASH_SOURCE[0]}")"
CRASH_RESTARTS=5
RESTART_PAUSE_SECONDS=60

run_name() {
  local name="kami-eye-next"
  while (($#)); do
    case "$1" in
      --name) name="$2"; shift 2 ;;
      --name=*) name="${1#--name=}"; shift ;;
      *) shift ;;
    esac
  done
  printf '%s' "$name"
}

artifacts_dir() {
  local directory="$ML/artifacts"
  while (($#)); do
    case "$1" in
      --artifacts-dir) directory="$2"; shift 2 ;;
      --artifacts-dir=*) directory="${1#--artifacts-dir=}"; shift ;;
      *) shift ;;
    esac
  done
  printf '%s' "$directory"
}

run_dir() { printf '%s/runs/%s' "$(artifacts_dir "$@")" "$(run_name "$@")"; }

require_environment() {
  if [[ ! -x "$PYTHON" ]]; then
    echo "no environment yet: run '$0 setup' first" >&2
    exit 1
  fi
}

setup() {
  command -v uv > /dev/null || { echo "uv is required: https://docs.astral.sh/uv/" >&2; exit 1; }
  cd "$ML"
  uv sync --group train --group dev
  if [[ "$(uname -s)" == "Linux" ]] && command -v nvidia-smi > /dev/null \
    && ! "$PYTHON" -c 'import sys, torch; sys.exit(0 if torch.cuda.is_available() else 1)'; then
    echo "an NVIDIA GPU but a torch without CUDA for it: installing the matching CUDA build"
    uv pip install --python "$PYTHON" --torch-backend=auto --reinstall-package torch \
      --reinstall-package torchvision torch torchvision
  fi
  "$PYTHON" - << 'EOF'
import torch
from kit.devices import Accelerator
print(f"ready: {Accelerator.of('auto').describe()}")
EOF
  echo "Stages run through $0 use $PYTHON directly; 'uv run' would re-sync torch to the lock file."
}

keep_awake() {
  if [[ "$(uname -s)" == "Darwin" ]]; then
    caffeinate -dimsu "$@"
  elif command -v systemd-inhibit > /dev/null; then
    systemd-inhibit --what=sleep:idle --who="Kami's Eye" --why="retraining" "$@"
  else
    "$@"
  fi
}

supervise() {
  local attempt code
  for ((attempt = 0; attempt <= CRASH_RESTARTS; attempt++)); do
    code=0
    "$PYTHON" "$ML/retrain.py" "$@" || code=$?
    if ((code == 0 || code >= 128)); then
      exit "$code"
    fi
    echo "$(date '+%F %T') retrain.py exited with $code; restarting in ${RESTART_PAUSE_SECONDS} s"
    sleep "$RESTART_PAUSE_SECONDS"
  done
  exit "$code"
}

launch() {
  require_environment
  local directory
  directory="$(run_dir "$@")"
  mkdir -p "$directory"
  if [[ -f "$directory/retrain.pid" ]] && kill -0 "$(cat "$directory/retrain.pid")" 2> /dev/null; then
    echo "run $(run_name "$@") is already running (pid $(cat "$directory/retrain.pid"))" >&2
    exit 1
  fi
  nohup "$SELF" _supervise "$@" >> "$directory/launch.out" 2>&1 < /dev/null &
  echo "launched $(run_name "$@") (supervisor pid $!); the machine stays awake until it ends"
  echo "  log:    $directory/retrain.log"
  echo "  watch:  $0 watch --name $(run_name "$@")"
  echo "  status: $0 status --name $(run_name "$@")"
  echo "  stop:   $0 stop --name $(run_name "$@")   (checkpoints; launch the same command to resume)"
}

stop() {
  local pid_file
  pid_file="$(run_dir "$@")/retrain.pid"
  if [[ ! -f "$pid_file" ]] || ! kill -0 "$(cat "$pid_file")" 2> /dev/null; then
    echo "run $(run_name "$@") is not running" >&2
    exit 1
  fi
  kill -TERM "$(cat "$pid_file")"
  echo "asked pid $(cat "$pid_file") to checkpoint and stop"
}

command="${1:-}"
[[ -n "$command" ]] && shift
case "$command" in
  setup) setup ;;
  launch) launch "$@" ;;
  _supervise) keep_awake "$SELF" _loop "$@" ;;
  _loop) supervise "$@" ;;
  stop) stop "$@" ;;
  watch) tail -n 40 -F "$(run_dir "$@")/retrain.log" ;;
  status) require_environment && "$PYTHON" "$ML/retrain.py" status "$@" ;;
  "" | -h | --help) sed -n '2,11p' "$0" ;;
  *) require_environment && "$PYTHON" "$ML/retrain.py" "$command" "$@" ;;
esac
