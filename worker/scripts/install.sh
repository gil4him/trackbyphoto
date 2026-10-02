#!/bin/bash
# Build the worker and install it as a launchd agent on this Mac.
#
#   ./scripts/install.sh            build, copy to ~/trackbyphoto-worker, (re)start
#   ./scripts/install.sh uninstall  stop and remove the agent
#
# The worker runs from the home folder rather than the external Seagate
# volume: launchd starts agents at login, possibly before external drives
# mount, and exFAT sprays ._ files into node_modules.
#
# Prerequisites (one-time):
#   ~/.trackbyphoto/sa-key.json   service-account key (chmod 600)
#   ~/.trackbyphoto/worker.env    optional, e.g. KAKAO_REST_KEY=..., OLLAMA_MODEL=...
set -euo pipefail

LABEL=com.trackbyphoto.worker
DEST="$HOME/trackbyphoto-worker"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SRC="$(cd "$(dirname "$0")/.." && pwd)"

stop_agent() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
}

if [ "${1:-}" = "uninstall" ]; then
  stop_agent
  rm -f "$PLIST"
  echo "Removed $LABEL (left $DEST and ~/.trackbyphoto in place)."
  exit 0
fi

KEY="$HOME/.trackbyphoto/sa-key.json"
if [ ! -f "$KEY" ]; then
  echo "Missing $KEY — create the service-account key first (see worker/README.md)." >&2
  exit 1
fi
chmod 600 "$KEY"

echo "Building..."
(cd "$SRC" && npm ci --silent && npm run build --silent)

echo "Copying to ${DEST}..."
mkdir -p "$DEST"
rsync -a --delete --exclude '._*' --exclude '.DS_Store' \
  "$SRC/dist" "$SRC/scripts" "$SRC/package.json" "$SRC/package-lock.json" "$DEST/"
(cd "$DEST" && npm ci --omit=dev --silent)

mkdir -p "$HOME/Library/Logs" "$(dirname "$PLIST")"
sed "s#__HOME__#$HOME#g" "$SRC/launchd/$LABEL.plist" > "$PLIST"

stop_agent
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Started $LABEL. Logs: tail -f ~/Library/Logs/trackbyphoto-worker.log"
