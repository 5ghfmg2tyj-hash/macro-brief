#!/bin/bash
# ============================================================================
# install_cron.sh — install the macro-brief launchd job on the current Mac.
#
# Usage:
#   ./scripts/install_cron.sh           # install + load
#   ./scripts/install_cron.sh uninstall # unload + remove
# ============================================================================
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LABEL="com.macro-brief.fetch"
TEMPLATE="$REPO_ROOT/scripts/com.macro-brief.fetch.plist"
DEST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOGDIR="$HOME/Library/Logs/macro-brief"

case "${1:-install}" in
  uninstall)
    if [ -f "$DEST" ]; then
      launchctl unload "$DEST" 2>/dev/null || true
      rm "$DEST"
      echo "Removed $DEST"
    else
      echo "Nothing to remove (no plist at $DEST)"
    fi
    exit 0
    ;;
  install|*)
    [ -f "$TEMPLATE" ] || { echo "Template missing: $TEMPLATE"; exit 1; }
    mkdir -p "$HOME/Library/LaunchAgents" "$LOGDIR"

    # If already loaded, unload first so the new copy takes effect.
    if [ -f "$DEST" ]; then
      launchctl unload "$DEST" 2>/dev/null || true
    fi

    # Substitute the absolute paths.
    sed -e "s#__REPO_ROOT__#${REPO_ROOT}#g" \
        -e "s#__HOME__#${HOME}#g" \
        "$TEMPLATE" > "$DEST"

    launchctl load "$DEST"
    echo "Installed and loaded: $DEST"
    echo ""
    echo "Check it's queued:"
    echo "  launchctl list | grep macro-brief"
    echo ""
    echo "Run it right now (don't wait for the next :00 / :30):"
    echo "  launchctl start ${LABEL}"
    echo ""
    echo "Tail the log:"
    echo "  tail -f ${LOGDIR}/fetch.log"
    exit 0
    ;;
esac
