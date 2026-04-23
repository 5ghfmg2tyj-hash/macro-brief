#!/bin/bash
# ============================================================================
# fetch_and_push.sh — run the live-data fetcher, then commit & push if
# live.json actually changed. Invoked by launchd on a schedule, or manually
# from the repo root at any time.
#
# Exits non-zero only on unrecoverable config errors (missing python, missing
# repo). Individual network failures are handled inside fetch_live.py and
# reflected in live.json as per-asset "error" entries, so they don't break
# the cron run.
# ============================================================================

set -u  # unset vars are errors; do NOT use -e — we want to continue past fetcher stalls

# Resolve the repo root from the script's own location, so this works whether
# it's invoked from launchd (cwd=/), the user's home, or the repo.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT" || { echo "[$(date -u +%FT%TZ)] cannot cd to $REPO_ROOT"; exit 2; }

# Keep PATH sane under launchd (which strips most of the user's PATH).
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

LIVE_PATH="docs/data/live.json"
HIST_PATH="docs/data/history.json"
LOG_DIR="$HOME/Library/Logs/macro-brief"
LOG="$LOG_DIR/fetch.log"
mkdir -p "$LOG_DIR"

# Rotate the log at ~1MB so it doesn't grow unbounded.
if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG" 2>/dev/null || stat -c%s "$LOG" 2>/dev/null || echo 0)" -gt 1048576 ]; then
  mv "$LOG" "$LOG.old"
fi

{
  echo ""
  echo "==== $(date -u +%FT%TZ) (UTC) — fetch_and_push run ===="
  echo "repo: $REPO_ROOT"

  # 1. Fetch. Any Python-side error is logged but non-fatal.
  if command -v python3 >/dev/null 2>&1; then
    PY=python3
  elif command -v python >/dev/null 2>&1; then
    PY=python
  else
    echo "ERROR: no python3 on PATH"; exit 2
  fi

  "$PY" scripts/fetch_live.py "$LIVE_PATH" "$HIST_PATH"
  RC=$?
  if [ "$RC" -ne 0 ]; then
    echo "fetch_live.py exited $RC — skipping commit"
    exit 0
  fi

  # 2. Did live.json actually change (excluding the fetchedAt timestamp)?
  # Use git diff --stat and grep for non-whitespace changes in the value fields.
  # Simplest: if diff shows any line change other than fetchedAt, commit.
  if ! git diff --quiet -- "$LIVE_PATH"; then
    # Count meaningful changes — if only fetchedAt changed, skip the commit.
    CHANGED_LINES=$(git diff --unified=0 -- "$LIVE_PATH" \
      | grep -E '^[-+]' \
      | grep -vE '^(---|\+\+\+|[-+]\s*"fetchedAt")' \
      | wc -l | tr -d ' ')
    if [ "${CHANGED_LINES:-0}" -eq 0 ]; then
      echo "only fetchedAt changed — reverting, no commit"
      git checkout -- "$LIVE_PATH"
      exit 0
    fi

    echo "live.json changed ($CHANGED_LINES meaningful lines) — committing"
    git add "$LIVE_PATH"
    git -c user.name="macro-brief-cron" \
        -c user.email="macro-brief-cron@localhost" \
        commit -m "chore: refresh live.json ($(date -u +%Y-%m-%dT%H:%MZ))" >/dev/null

    # 3. Push. If it fails (no network, auth problem), log and exit 0 so the
    # next cron run can retry. Never abort the chain.
    if git push --quiet 2>&1; then
      echo "pushed OK"
    else
      echo "push failed (kept local commit for next run)"
    fi
  else
    echo "no changes to live.json — done"
  fi
} >> "$LOG" 2>&1

exit 0
