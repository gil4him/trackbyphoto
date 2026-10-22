#!/bin/bash
# Build the worker and install it as a launchd agent on this Mac.
#
#   ./scripts/install.sh            build, copy to ~/trackbyphoto-worker, (re)start
#   ./scripts/install.sh --check    only run the deploy guard (exit 0 = would deploy)
#   ./scripts/install.sh uninstall  stop and remove the agent
#
# Deploy guard: the worker is deployed only from committed, pushed code that
# contains origin/main and whatever is running now (DEPLOYED in the install
# folder). Several sessions share this Mac; on 2026-10-21 a deploy from main
# silently replaced a worker installed from uncommitted edits.
# FORCE_DEPLOY=1 skips the guard, for emergencies only.
#
# The worker runs from the home folder rather than the external Seagate
# volume: launchd starts agents at login, possibly before external drives
# mount, and exFAT sprays ._ files into node_modules.
#
# Prerequisites (one-time):
#   ~/.trackbyphoto/sa-key.json   service-account key (chmod 600)
#   ~/.trackbyphoto/worker.env    optional, e.g. KAKAO_REST_KEY=..., OLLAMA_MODEL=...
set -euo pipefail

# Overridable so a second instance (simple/worker/install-simple.sh) can sit
# beside this one.
LABEL="${WORKER_LABEL:-com.trackbyphoto.worker}"
DEST="${WORKER_DEST:-$HOME/trackbyphoto-worker}"
KEY="${WORKER_SA_KEY:-$HOME/.trackbyphoto/sa-key.json}"
LOG="${WORKER_LOG:-~/Library/Logs/trackbyphoto-worker.log}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_TEMPLATE="${WORKER_PLIST:-$SRC/launchd/$LABEL.plist}"

stop_agent() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  # bootout returns before the job is gone; bootstrapping too soon fails
  # with "5: Input/output error". Wait (up to ~10 s) for it to unload.
  for _ in $(seq 1 20); do
    launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || return 0
    sleep 0.5
  done
}

REPO="$(git -C "$SRC" rev-parse --show-toplevel 2>/dev/null || true)"

refuse() {
  echo "" >&2
  echo "배포 거부 / Deploy refused: $1" >&2
  echo "  $2" >&2
  echo "  (긴급 시에만 / emergencies only: FORCE_DEPLOY=1 $0)" >&2
  REFUSED=1
}

# Exit 1 with a reason when this checkout must not be deployed.
guard() {
  REFUSED=0
  if [ -z "$REPO" ]; then
    refuse "not a git checkout" "git 체크아웃에서만 배포할 수 있어요. Deploy from a git checkout."
  else
    if [ -n "$(git -C "$REPO" status --porcelain -- worker)" ]; then
      refuse "uncommitted or untracked changes under worker/" "worker/에 커밋하지 않은 변경이 있어요. Commit and push first:"
      git -C "$REPO" status --porcelain -- worker | sed 's/^/    /' >&2
    fi
    git -C "$REPO" fetch -q origin main 2>/dev/null || refuse "could not fetch origin/main" "origin/main을 가져오지 못했어요. Check the network or credentials."
    if ! git -C "$REPO" merge-base --is-ancestor origin/main HEAD 2>/dev/null; then
      refuse "HEAD does not contain origin/main" "최신 main이 아니에요. Rebase or merge origin/main, push, then deploy."
    fi
    if [ -z "$(git -C "$REPO" branch -r --contains HEAD 2>/dev/null)" ]; then
      refuse "HEAD is not pushed" "푸시하지 않은 커밋이에요. Push to origin (main or a merged PR) first."
    fi
    local running=""
    [ -f "$DEST/DEPLOYED" ] && running="$(sed -n 's/^commit=//p' "$DEST/DEPLOYED")"
    if [ -n "$running" ] && ! git -C "$REPO" merge-base --is-ancestor "$running" HEAD 2>/dev/null; then
      refuse "the running worker ($running) has commits this checkout lacks" "지금 실행 중인 코드를 덮어쓰게 돼요. Get that commit into your checkout, or ask whoever deployed it."
    fi
  fi
  if [ "$REFUSED" = 1 ]; then
    if [ "${FORCE_DEPLOY:-}" = "1" ]; then
      echo "" >&2
      echo "################################################################" >&2
      echo "#  FORCE_DEPLOY=1: 경고를 무시하고 배포해요 / deploying anyway  #" >&2
      echo "#  Tell the user what was overwritten.                          #" >&2
      echo "################################################################" >&2
      return 0
    fi
    exit 1
  fi
  echo "Deploy guard: OK ($(git -C "$REPO" rev-parse --short HEAD) contains origin/main and the running worker)"
}

if [ "${1:-}" = "--check" ]; then
  guard
  exit 0
fi

if [ "${1:-}" = "uninstall" ]; then
  stop_agent
  rm -f "$PLIST"
  echo "Removed $LABEL (left $DEST and ~/.trackbyphoto in place)."
  exit 0
fi

if [ ! -f "$KEY" ]; then
  echo "Missing $KEY — create the service-account key first (see worker/README.md)." >&2
  exit 1
fi
chmod 600 "$KEY"

guard

echo "Building..."
(cd "$SRC" && npm ci --silent && npm run build --silent)

echo "Copying to ${DEST}..."
mkdir -p "$DEST"
rsync -a --delete --exclude '._*' --exclude '.DS_Store' \
  "$SRC/dist" "$SRC/scripts" "$SRC/package.json" "$SRC/package-lock.json" "$DEST/"
(cd "$DEST" && npm ci --omit=dev --silent)

# What is running now, for the next deploy's guard and the worker's start log.
{
  echo "commit=$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "branch=$(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  echo "date=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "checkout=$REPO"
  [ "${FORCE_DEPLOY:-}" = "1" ] && echo "forced=1"
} > "$DEST/DEPLOYED"

mkdir -p "$HOME/Library/Logs" "$(dirname "$PLIST")"
sed "s#__HOME__#$HOME#g" "$PLIST_TEMPLATE" > "$PLIST"

stop_agent
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Started $LABEL. Logs: tail -f $LOG"
