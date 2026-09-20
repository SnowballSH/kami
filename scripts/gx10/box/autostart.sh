#!/usr/bin/env bash
# On the GX10: start Kami at boot via the user's crontab (no sudo).
set -euo pipefail
ENTRY='@reboot sleep 20 && bash $HOME/kami/current/box/start.sh >> $HOME/kami/logs/boot.log 2>&1 # kami'
without_kami() { crontab -l 2>/dev/null | grep -v '# kami$' || true; }
case "${1:-}" in
  enable)  { without_kami; echo "$ENTRY"; } | crontab -; echo "  ✓ Kami will start when the box boots" ;;
  disable) without_kami | crontab -; echo "  ✓ autostart removed" ;;
  migrate)
    existing=$(crontab -l 2>/dev/null || true)
    if printf '%s\n' "$existing" | grep -q '# kami$'; then
      { printf '%s\n' "$existing" | grep -v '# kami$' || true; echo "$ENTRY"; } | crontab -
      echo "  ✓ Kami autostart follows the active release"
    fi
    ;;
  *) echo "usage: autostart.sh enable|disable|migrate"; exit 2 ;;
esac
