#!/usr/bin/env bash
# Generate electron/icon.icns from docs/icons/icon-512.png using macOS iconutil.
# Run once from the repo root; output is committed.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO/docs/icons/icon-512.png"
TMP="$REPO/electron/icon.iconset"
OUT="$REPO/electron/icon.icns"

command -v sips      >/dev/null 2>&1 || { echo "sips not found (macOS only)";    exit 1; }
command -v iconutil  >/dev/null 2>&1 || { echo "iconutil not found (macOS only)"; exit 1; }

rm -rf "$TMP"
mkdir  "$TMP"

sizes=(16 32 64 128 256 512)
for s in "${sizes[@]}"; do
  sips -z "$s"        "$s"        "$SRC" --out "$TMP/icon_${s}x${s}.png"        >/dev/null
  sips -z "$((s*2))"  "$((s*2))"  "$SRC" --out "$TMP/icon_${s}x${s}@2x.png"    >/dev/null
done

iconutil -c icns "$TMP" -o "$OUT"
rm -rf "$TMP"
echo "Wrote $OUT"
