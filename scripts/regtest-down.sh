#!/usr/bin/env bash
# Stop the local regtest environment. Chain/wallet/electrumx state stays in
# .regtest/ so `regtest-up.sh` resumes where you left off; delete the
# directory for a factory reset.

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

for name in explorer-api explorer-indexer electrumx nodeA nodeB; do
  if [ -f "$STATE/$name.pid" ]; then
    PID=$(cat "$STATE/$name.pid")
    if kill -0 "$PID" 2>/dev/null; then
      # The explorer pids are npm wrappers — take their descendants
      # (npm → tsx → node) down with them, depth-first.
      kill_tree() {
        local children
        children=$(pgrep -P "$1" 2>/dev/null || true)
        for c in $children; do kill_tree "$c"; done
        kill "$1" 2>/dev/null || true
      }
      kill_tree "$PID"
      echo "· stopped $name (pid $PID)"
    fi
    rm -f "$STATE/$name.pid"
  fi
done
echo "done — state kept in $STATE (rm -rf it for a clean slate)"
