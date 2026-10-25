#!/usr/bin/env bash
# §Q screenshots of the 운영실 on the emulators (docs/admin/DAYLIE_ADMIN_DASHBOARD.md):
#   cd e2e && bash admin-shots.sh [D0]  → docs/admin/shots/<phase>/<view>-<viewport>.png
# Nothing touches a real project (project "demo-…").
set -euo pipefail
cd "$(dirname "$0")/.."
export ADMIN_PHASE="${1:-${ADMIN_PHASE:-D0}}"
[ -d /opt/homebrew/opt/openjdk@21/bin ] && export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
[ -d e2e/node_modules ] || (cd e2e && npm install --no-audit --no-fund >/dev/null)

echo "[admin-shots] building the simple site for the emulators…"
(cd app && VITE_USE_EMULATOR=1 \
  VITE_FIREBASE_PROJECT_ID=demo-trackbyphoto \
  VITE_FIREBASE_API_KEY=demo-key \
  VITE_FIREBASE_AUTH_DOMAIN=localhost \
  VITE_FIREBASE_STORAGE_BUCKET=demo-trackbyphoto.appspot.com \
  VITE_FIREBASE_MESSAGING_SENDER_ID=0 \
  VITE_FIREBASE_APP_ID=demo \
  VITE_EMULATOR_AUTH_PORT=9098 VITE_EMULATOR_FIRESTORE_PORT=8089 VITE_EMULATOR_STORAGE_PORT=9198 \
  npx vite build --mode simple --outDir ../e2e/.tmp/admin-site --emptyOutDir >/dev/null)
echo "[admin-shots] building the worker…"
(cd worker && npm run build >/dev/null)

# Its own ports (firebase.shots.json, repo root), so a dev emulator on the usual ones is left alone.
firebase emulators:exec --config firebase.shots.json --only auth,firestore,storage --project demo-trackbyphoto "node e2e/admin-shots.mjs"
