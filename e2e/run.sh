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
#   E2E_PORT_OFFSET=n  run the emulators n ports up (e.g. 10000), beside
#                      another project's emulators on the usual ports
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d /opt/homebrew/opt/openjdk@21/bin ] && export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"

[ -d e2e/node_modules ] || (cd e2e && npm install --no-audit --no-fund >/dev/null)

OFF=${E2E_PORT_OFFSET:-0}
CONFIG=firebase.json
if [ "$OFF" != 0 ]; then
  # Beside firebase.json: the rules paths in it are relative to the config.
  CONFIG=firebase.e2e-ports.json
  trap 'rm -f firebase.e2e-ports.json' EXIT
  node -e '
    const off = Number(process.argv[1]); const c = require("./firebase.json")
    const e = c.emulators || {}
    const at = (k, usual) => ({ ...(e[k] || {}), port: (e[k]?.port || usual) + off })
    c.emulators = { ...e, auth: at("auth", 9099), firestore: at("firestore", 8080), storage: at("storage", 9199),
      hub: at("hub", 4400), logging: at("logging", 4500), ui: { enabled: false } }
    require("fs").writeFileSync(process.argv[2], JSON.stringify(c, null, 2))' "$OFF" "$CONFIG"
fi

echo "[e2e] building the site for the emulators…"
(cd app && VITE_USE_EMULATOR=1 \
  VITE_EMULATOR_AUTH_PORT=$((9099 + OFF)) VITE_EMULATOR_FIRESTORE_PORT=$((8080 + OFF)) VITE_EMULATOR_STORAGE_PORT=$((9199 + OFF)) \
  VITE_FIREBASE_PROJECT_ID=demo-trackbyphoto \
  VITE_FIREBASE_API_KEY=demo-key \
  VITE_FIREBASE_AUTH_DOMAIN=localhost \
  VITE_FIREBASE_STORAGE_BUCKET=demo-trackbyphoto.appspot.com \
  VITE_FIREBASE_MESSAGING_SENDER_ID=0 \
  VITE_FIREBASE_APP_ID=demo \
  npx vite build --outDir ../e2e/.tmp/site --emptyOutDir >/dev/null)

echo "[e2e] building the worker…"
(cd worker && npm run build >/dev/null)

firebase emulators:exec --config "$CONFIG" --only auth,firestore,storage --project demo-trackbyphoto "node e2e/run.mjs"
