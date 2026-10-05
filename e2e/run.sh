#!/usr/bin/env bash
# End-to-end check of the website. Everything runs on this machine against
# the Firebase emulators (project "demo-…", which can never reach a real
# project); nothing touches production.
#
#   cd e2e && npm test
#
# Needs: Node 20+, Java (for the emulators), firebase-tools, Google Chrome.
#   E2E_REAL_LLM=1     write memos with the local Ollama model instead of the stand-in
#   E2E_SKIP_STALL=1   skip the two-minute dead-upload step
#   E2E_HEADFUL=1      watch it in a visible browser
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d /opt/homebrew/opt/openjdk@21/bin ] && export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"

[ -d e2e/node_modules ] || (cd e2e && npm install --no-audit --no-fund >/dev/null)

echo "[e2e] building the site for the emulators…"
(cd app && VITE_USE_EMULATOR=1 \
  VITE_FIREBASE_PROJECT_ID=demo-trackbyphoto \
  VITE_FIREBASE_API_KEY=demo-key \
  VITE_FIREBASE_AUTH_DOMAIN=localhost \
  VITE_FIREBASE_STORAGE_BUCKET=demo-trackbyphoto.appspot.com \
  VITE_FIREBASE_MESSAGING_SENDER_ID=0 \
  VITE_FIREBASE_APP_ID=demo \
  npx vite build --outDir ../e2e/.tmp/site --emptyOutDir >/dev/null)

echo "[e2e] building the worker…"
(cd worker && npm run build >/dev/null)

firebase emulators:exec --only auth,firestore,storage --project demo-trackbyphoto "node e2e/run.mjs"
