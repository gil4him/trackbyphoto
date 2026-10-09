#!/bin/bash
# Install the simple-core worker (Firebase project daylie-simple-4df13) as a
# second launchd agent beside the main one. Never touches com.trackbyphoto.worker.
#
#   ./scripts/install-simple.sh            build, copy to ~/daylie-worker-simple, (re)start
#   ./scripts/install-simple.sh uninstall  stop and remove the agent
#
# Prerequisites (one-time, outside the repo):
#   ~/daylie-secrets/simple/daylie-simple-sa.json  service-account key
#   ~/daylie-secrets/simple/worker.env             GOOGLE_APPLICATION_CREDENTIALS,
#     FIREBASE_STORAGE_BUCKET, APP_URL, WORKER_STATE_DIR (see docs/Daylie-v3-Simple-Core.md)
set -euo pipefail

ENV_FILE="$HOME/daylie-secrets/simple/worker.env"
if [ "${1:-}" != "uninstall" ] && [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — without it the worker would talk to the main project." >&2
  exit 1
fi

export WORKER_LABEL=com.daylie.worker.simple
export WORKER_DEST="$HOME/daylie-worker-simple"
export WORKER_SA_KEY="$HOME/daylie-secrets/simple/daylie-simple-sa.json"
export WORKER_LOG="~/Library/Logs/daylie-worker-simple.log"
exec "$(dirname "$0")/install.sh" "$@"
