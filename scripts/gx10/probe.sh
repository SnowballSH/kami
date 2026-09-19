#!/usr/bin/env bash
# Runs ON the GX10 (piped over SSH). Read-only: reports what the box is and what it can reach.
section() { printf '\n=== %s\n' "$1"; }

section "identity";      hostname; whoami; uptime -p 2>/dev/null
section "os";            . /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"; uname -srm
section "gpu";           nvidia-smi --query-gpu=name,driver_version,memory.total,memory.used --format=csv 2>&1 | head -5
section "memory";        free -h 2>/dev/null | head -2
section "disk";          df -h / /home 2>/dev/null | sort -u
section "network";       nmcli -t -f DEVICE,TYPE,STATE,CONNECTION device status 2>/dev/null; ip -4 -brief addr 2>/dev/null; ip route show default 2>/dev/null
section "internet";      (curl -s -m 5 -o /dev/null -w 'https ok (%{http_code})\n' https://ollama.com || echo "no internet")
section "passwordless sudo"; (sudo -n true 2>/dev/null && echo yes || echo no)
section "docker";        (docker --version && docker info --format 'runtimes: {{json .Runtimes}}' 2>/dev/null | cut -c1-200) 2>&1 | head -3
section "ollama";        (command -v ollama && ollama --version && ollama list) 2>&1 | head -12
section "python";        (python3 --version; command -v uv pip3 conda) 2>&1 | head -5
section "listening";     (ss -tlnH 2>/dev/null | awk '{print $4}' | sort -u | head -20)
