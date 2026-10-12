#!/bin/bash
# Install the simple-core worker (Firebase project daylie-simple-4df13) as a
# second launchd agent beside the main one. Never touches com.trackbyphoto.worker.
#
#   simple/worker/install-simple.sh            build, copy to ~/daylie-worker-simple, (re)start
#   simple/worker/install-simple.sh uninstall  stop and remove the agent
#
# The worker code is the shared worker/ (EDITION=simple in worker.env picks
# the simple behaviour); only this launcher and its launchd template live here.
#
# Prerequisites (one-time, outside the repo):
#   ~/daylie-secrets/simple/daylie-simple-sa.json  service-account key
#   ~/daylie-secrets/simple/worker.env             GOOGLE_APPLICATION_CREDENTIALS,
#     FIREBASE_STORAGE_BUCKET, APP_URL, WORKER_STATE_DIR, EDITION=simple
#     (see simple/Daylie-v3-Simple-Core.md)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

ENV_FILE="$HOME/daylie-secrets/simple/worker.env"
if [ "${1:-}" != "uninstall" ] && [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — without it the worker would talk to the main project." >&2
  exit 1
fi

export WORKER_LABEL=com.daylie.worker.simple
export WORKER_DEST="$HOME/daylie-worker-simple"
export WORKER_SA_KEY="$HOME/daylie-secrets/simple/daylie-simple-sa.json"
export WORKER_LOG="~/Library/Logs/daylie-worker-simple.log"
export WORKER_PLIST="$HERE/com.daylie.worker.simple.plist"
exec "$HERE/../../worker/scripts/install.sh" "$@"
