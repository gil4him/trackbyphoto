#!/usr/bin/env bash
# Store screenshots of 오늘하루 (simple edition) on the emulators, into the
# fastlane folders:
#   cd e2e && bash shots.sh
#     → e2e/.tmp/store-shots/*.png
#     → app/fastlane/metadata/ios/ko/0N-<name>.png                       (1320×2868)
#     → app/fastlane/metadata/android/ko-KR/images/phoneScreenshots/…    (1080×1920)
# Nothing touches a real project (project "demo-…"). The parent's viewfinder
# shows UI_CAMERA_FILE (default: a clip made here from a demo photo).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d /opt/homebrew/opt/openjdk@21/bin ] && export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
[ -d e2e/node_modules ] || (cd e2e && npm install --no-audit --no-fund >/dev/null)

echo "[shots] building the simple site for the emulators…"
(cd app && VITE_USE_EMULATOR=1 \
  VITE_FIREBASE_PROJECT_ID=demo-trackbyphoto \
  VITE_FIREBASE_API_KEY=demo-key \
  VITE_FIREBASE_AUTH_DOMAIN=localhost \
  VITE_FIREBASE_STORAGE_BUCKET=demo-trackbyphoto.appspot.com \
  VITE_FIREBASE_MESSAGING_SENDER_ID=0 \
  VITE_FIREBASE_APP_ID=demo \
  VITE_EMULATOR_AUTH_PORT=9098 VITE_EMULATOR_FIRESTORE_PORT=8089 VITE_EMULATOR_STORAGE_PORT=9198 \
  npx vite build --mode simple --outDir ../e2e/.tmp/shots-site --emptyOutDir >/dev/null)

if [ "${SHOTS_SKIP_WORKER_BUILD:-}" != "1" ]; then
  echo "[shots] building the worker (pairing the parent's phone)…"
  (cd worker && npm run build >/dev/null)
fi

# The viewfinder: a short portrait clip of one demo photo, unless a clip is given.
if [ -z "${UI_CAMERA_FILE:-}" ] && command -v ffmpeg >/dev/null; then
  mkdir -p e2e/.tmp
  ffmpeg -y -loglevel error -loop 1 -i "e2e/demo-photos/${SHOTS_CAMERA_PHOTO:-photo1.jpg}" -t 2 -r 5 \
    -vf "scale=-2:1280,crop=720:1280:(iw-720)*0.8:0" -c:v mjpeg -q:v 3 e2e/.tmp/viewfinder.mjpeg
  export UI_CAMERA_FILE="$PWD/e2e/.tmp/viewfinder.mjpeg"
fi

# Its own ports (firebase.shots.json, repo root: rules must sit beside it), so a dev emulator on the usual ones is left alone.
firebase emulators:exec --config firebase.shots.json --only auth,firestore,storage --project demo-trackbyphoto "node e2e/shots.mjs"

# Into the fastlane folders, numbered in listing order.
IOS=app/fastlane/metadata/ios/ko
ANDROID=app/fastlane/metadata/android/ko-KR/images/phoneScreenshots
mkdir -p "$IOS" "$ANDROID"
for f in e2e/.tmp/store-shots/iphone69-*.png; do
  [ -e "$f" ] || continue
  n=$(basename "$f" .png); n=${n#iphone69-}; cp "$f" "$IOS/0$n.png"
done
for f in e2e/.tmp/store-shots/android916-*.png; do
  [ -e "$f" ] || continue
  n=$(basename "$f" .png); n=${n#android916-}; cp "$f" "$ANDROID/0$n.png"
done
echo "[shots] iOS → $IOS"; ls "$IOS"
echo "[shots] Android → $ANDROID"; ls "$ANDROID"
