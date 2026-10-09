#!/bin/bash
# launchd entry point. Loads an env file (secrets + overrides, never
# committed; default ~/.trackbyphoto/worker.env, or the first argument) and
# starts the worker. Must stay in sync with install.sh.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
ENV_FILE="${1:-$HOME/.trackbyphoto/worker.env}"
# A named env file must exist: falling back to the defaults below would point
# a second instance at the main project.
if [ -n "${1:-}" ] && [ ! -f "$ENV_FILE" ]; then
  echo "run.sh: missing $ENV_FILE" >&2
  exit 1
fi
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
