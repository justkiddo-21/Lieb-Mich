#!/usr/bin/env bash
# Render the whole video in 4K: a true 3840x2160 render (--scale 2) at 60 fps with adaptive motion
# blur (--samples auto: 4 … 324 sub-frames per frame until the image stops changing, see
# docs/ENGINE.md), encoded as 10-bit H.264 (High 10) with the song muxed in.
#
# It renders in segments (default 32 s) that survive a crash: rerun it and finished segments are
# skipped. The segments are concatenated without re-encoding and the audio is added once at the end.
#
# Usage:  app/scripts/render-4k.sh [out_dir]          (default: out/4k)
# Env:    CRF=18 PRESET=slow TOL=3 MIN_SAMPLES=4 MAX_SAMPLES=324 SHUTTER=0.2 SEG=32 DRY_RUN=1
# Needs:  bun, ffmpeg + ffprobe with a libx264 that does 10-bit (yuv420p10le), a browser for
#         playwright (bunx playwright-core install chromium-headless-shell on Linux), a GPU, and the
#         song at audio/liebmich.mp3 (not in the repo).
set -euo pipefail

APP="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(dirname "$APP")"
OUT="${1:-$ROOT/out/4k}"
CRF="${CRF:-18}"
PRESET="${PRESET:-slow}"
TOL="${TOL:-3}"
MIN_SAMPLES="${MIN_SAMPLES:-4}"
MAX_SAMPLES="${MAX_SAMPLES:-324}"
SHUTTER="${SHUTTER:-0.2}"
SEG="${SEG:-32}"
AUDIO="$ROOT/audio/liebmich.mp3"
FINAL="$OUT/liebmich-4k60-10bit.mp4"

die() { echo "render-4k: $*" >&2; exit 1; }
run() { echo "+ $*"; [ -n "${DRY_RUN:-}" ] || "$@"; }

# ---- preflight
for c in bun ffmpeg ffprobe; do command -v "$c" >/dev/null || die "$c not found"; done
if ! ffmpeg -hide_banner -h encoder=libx264 2>/dev/null | grep -q 'yuv420p10le'; then
  msg="this ffmpeg has no 10-bit libx264 (on Fedora, ffmpeg-free has no libx264 at all: install RPM Fusion's ffmpeg)"
  [ -n "${DRY_RUN:-}" ] && echo "render-4k: warning: $msg" >&2 || die "$msg"
fi
[ -f "$AUDIO" ] || die "put the song at $AUDIO"
DUR="$(bun -e "console.log(require('$ROOT/data/audio.json').duration)")"
N="$(bun -e "console.log(Math.ceil($DUR / $SEG))")"   # segments of SEG s; the last one runs to the song's end
mkdir -p "$OUT"
echo "render-4k: ${DUR}s in $N segments of ${SEG}s -> $FINAL"

# ---- segments (video only; boundaries are whole seconds, so frame-exact at 60 fps)
LIST="$OUT/segments.txt"
: > "$LIST"
cd "$APP"
for ((i = 0; i < N; i++)); do
  a=$((i * SEG)); b=$(((i + 1) * SEG))
  f="$OUT/seg_$(printf %02d "$i").mp4"
  echo "file '$f'" >> "$LIST"
  if [ -f "$f" ] && ffprobe -v error "$f" >/dev/null 2>&1; then echo "segment $i done, skipping"; continue; fi
  to=(); if [ "$i" -lt $((N - 1)) ]; then to=(--to "$b"); else b=end; fi
  echo "=== segment $i: ${a}s -> ${b}  ($(date '+%F %T'))"
  run bun scripts/render.ts video --scale 2 --fps 60 --from "$a" "${to[@]}" \
    --samples auto --min-samples "$MIN_SAMPLES" --max-samples "$MAX_SAMPLES" --tol "$TOL" --shutter "$SHUTTER" \
    --codec x264 --bits 10 --crf "$CRF" --preset "$PRESET" --x264 aq-mode=3:rc-lookahead=30 \
    --noaudio --out "$f.part.mp4"
  run mv "$f.part.mp4" "$f"
done

# ---- concat (no re-encode) + the song
echo "=== concat + audio  ($(date '+%F %T'))"
run ffmpeg -v error -y -f concat -safe 0 -i "$LIST" -i "$AUDIO" \
  -map 0:v -map 1:a -c:v copy -c:a aac -b:a 320k -shortest -movflags +faststart "$FINAL"
[ -n "${DRY_RUN:-}" ] || ffprobe -v error -show_entries stream=codec_name,profile,width,height,r_frame_rate,pix_fmt:format=duration,size -of default=nw=1 "$FINAL"
echo "=== done  ($(date '+%F %T'))"
