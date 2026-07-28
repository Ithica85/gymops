#!/bin/bash
# Rasterises the 6.5 PWA icons from their SVG sources using headless Chrome —
# the same renderer that will display them, so no second rasteriser to disagree
# with. Each icon is rendered at its exact pixel size (never upscaled).
set -euo pipefail

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"          # must be absolute: it goes into a file:// URL
trap 'rm -rf "$WORK"' EXIT

# size  source-svg                  output                      transparent?
render() {
  local size="$1" src="$2" out="$3" transparent="$4"
  local html="$WORK/wrap-${size}-$(basename "$out" .png).html"
  cat > "$html" <<HTML
<!doctype html><meta charset="utf-8">
<style>
  html,body { margin:0; padding:0; width:${size}px; height:${size}px; overflow:hidden; }
  img { display:block; width:${size}px; height:${size}px; }
</style>
<img src="file://${src}">
HTML

  local bg="--default-background-color=181818ff"
  [ "$transparent" = "yes" ] && bg="--default-background-color=00000000"

  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    "$bg" \
    --force-device-scale-factor=1 \
    --window-size="${size},${size}" \
    --screenshot="$out" \
    "file://$html" >/dev/null 2>&1
}

SRC_ANY="$REPO/icons/icon-source.svg"
SRC_MASK="$REPO/icons/icon-maskable-source.svg"

# "any" purpose: artwork's own rounded corners, transparent outside them.
render 192 "$SRC_ANY"  "$REPO/icons/icon-192.png" yes
render 512 "$SRC_ANY"  "$REPO/icons/icon-512.png" yes

# maskable: full-bleed, opaque — the launcher crops it.
render 192 "$SRC_MASK" "$REPO/icons/icon-maskable-192.png" no
render 512 "$SRC_MASK" "$REPO/icons/icon-maskable-512.png" no

# iOS home screen. iOS ignores the manifest, applies its own rounding, and
# composites transparency onto black — so this uses the full-bleed art.
render 180 "$SRC_MASK" "$REPO/icons/apple-touch-icon.png" no

echo "--- rendered ---"
for f in "$REPO"/icons/*.png; do
  printf "%-34s %s\n" "$(basename "$f")" "$(sips -g pixelWidth -g pixelHeight "$f" 2>/dev/null | awk '/pixel/{printf "%s ", $2}')"
done
