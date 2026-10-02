#!/bin/bash
# launchd entry point. Loads ~/.trackbyphoto/worker.env (secrets + overrides,
# never committed) and starts the worker. Must stay in sync with install.sh.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
ENV_FILE="$HOME/.trackbyphoto/worker.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi
: "${GOOGLE_APPLICATION_CREDENTIALS:=$HOME/.trackbyphoto/sa-key.json}"
export GOOGLE_APPLICATION_CREDENTIALS
cd "$(dirname "$0")/.."
exec node dist/index.js
