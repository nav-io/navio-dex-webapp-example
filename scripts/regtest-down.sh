#!/usr/bin/env bash
# Stop the local regtest environment. Chain/wallet/electrumx state stays in
# .regtest/ so `regtest-up.sh` resumes where you left off; delete the
# directory for a factory reset.

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

for name in electrumx nodeA nodeB; do
  if [ -f "$STATE/$name.pid" ]; then
    PID=$(cat "$STATE/$name.pid")
    if kill -0 "$PID" 2>/dev/null; then
      kill "$PID" 2>/dev/null || true
      echo "· stopped $name (pid $PID)"
    fi
    rm -f "$STATE/$name.pid"
  fi
done
echo "done — state kept in $STATE (rm -rf it for a clean slate)"
