#!/usr/bin/env bash
# Checks the whole photo pipeline before a deploy. Run from anywhere:
#   bash worker/scripts/check-pipeline.sh
# Tests use local emulators and fakes only. The last step only reads the running
# worker's log. It needs Java 21 for the emulators (Homebrew openjdk@21).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
fail=0
step() { echo; echo "── $1"; shift; if "$@"; then echo "   OK"; else echo "   FAILED"; fail=1; fi; }

step "Worker types" bash -c "cd '$ROOT/worker' && npx tsc --noEmit"
step "Worker tests, with the end-to-end story (test/pipelineCheck.test.ts)" bash -c "cd '$ROOT/worker' && npm test 2>&1 | grep -E 'Test Files|Tests  |FAIL |AssertionError' ; exit \${PIPESTATUS[0]}"
step "App types" bash -c "cd '$ROOT/app' && npx tsc -b"
step "App tests" bash -c "cd '$ROOT/app' && npx vitest run 2>&1 | grep -E 'Test Files|Tests  |FAIL ' ; exit \${PIPESTATUS[0]}"

LOG="$HOME/Library/Logs/daylie-worker-simple.log"
if [ -f "$LOG" ]; then
  echo; echo "── Running simple worker (read only)"
  grep '\[worker\] starting' "$LOG" | tail -1 | grep -oE '^[^ ]+|"deployedCommit":"[a-f0-9]{7}'
  start=$(grep -n '\[worker\] starting' "$LOG" | tail -1 | cut -d: -f1)
  echo "   since that start:"
  tail -n +"$start" "$LOG" | grep -E ' ERROR | WARN ' | sed -E 's/^[^ ]+ //; s/ \{.*//' | sort | uniq -c | sort -rn | head -12
fi
echo
[ "$fail" = 0 ] && echo "All checks passed." || echo "Some checks FAILED."
exit "$fail"
