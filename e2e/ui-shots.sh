#!/usr/bin/env bash
# Design-review screenshots of the simple edition on the emulators
# (docs/DAYLIE_V3_UI_FIX.md): cd e2e && bash ui-shots.sh [A0]  → docs/v3-ui/<phase>-*.png
#   UI_MATRIX=1  the §Q device matrix instead: <phase>-<screen>-<width>[-L].png
# Nothing touches a real project (project "demo-…").
set -euo pipefail
cd "$(dirname "$0")/.."
export UI_PHASE="${1:-${UI_PHASE:-A0}}"
[ -d /opt/homebrew/opt/openjdk@21/bin ] && export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
[ -d e2e/node_modules ] || (cd e2e && npm install --no-audit --no-fund >/dev/null)

echo "[ui-shots] building the simple site for the emulators…"
(cd app && VITE_USE_EMULATOR=1 \
  VITE_FIREBASE_PROJECT_ID=demo-trackbyphoto \
  VITE_FIREBASE_API_KEY=demo-key \
  VITE_FIREBASE_AUTH_DOMAIN=localhost \
  VITE_FIREBASE_STORAGE_BUCKET=demo-trackbyphoto.appspot.com \
  VITE_FIREBASE_MESSAGING_SENDER_ID=0 \
  VITE_FIREBASE_APP_ID=demo \
  VITE_EMULATOR_AUTH_PORT=9098 VITE_EMULATOR_FIRESTORE_PORT=8089 VITE_EMULATOR_STORAGE_PORT=9198 \
  npx vite build --mode simple --outDir ../e2e/.tmp/ui-site --emptyOutDir >/dev/null)

# The parent's screens (A6, A9, A11, A12) link a phone, which needs the worker.
case "$UI_PHASE" in A6|A9|A11|A12)
  echo "[ui-shots] building the worker…"
  (cd worker && npm run build >/dev/null) ;;
esac

# The viewfinder: a short portrait clip of one demo photo (as shots.sh does), unless a clip is given.
if [ -z "${UI_CAMERA_FILE:-}" ] && command -v ffmpeg >/dev/null; then
  mkdir -p e2e/.tmp
  ffmpeg -y -loglevel error -loop 1 -i "e2e/demo-photos/${SHOTS_CAMERA_PHOTO:-photo1.jpg}" -t 2 -r 5 \
    -vf "scale=-2:1280,crop=720:1280:(iw-720)*0.8:0" -c:v mjpeg -q:v 3 e2e/.tmp/viewfinder.mjpeg
  export UI_CAMERA_FILE="$PWD/e2e/.tmp/viewfinder.mjpeg"
fi

# Its own ports (firebase.shots.json, repo root), so a dev emulator on the usual ones is left alone.
firebase emulators:exec --config firebase.shots.json --only auth,firestore,storage --project demo-trackbyphoto "node e2e/ui-shots.mjs"
