#!/usr/bin/env bash
# Shared configuration for the local blsctregtest environment.
#
# The scripts assume sibling checkouts (override with env vars):
#
#   NAVIO_CORE_DIR  navio-core on the `p2pmsg` branch (PR #263), built with
#                   cmake so build/bin/naviod + navio-cli exist.
#   ELECTRUMX_DIR   nav-io/electrumx on the `rfq-swap-bridge` branch
#                   (PR #2), with its Python deps installed.
#
# Layout of the environment this file describes:
#
#   node A (127.0.0.1:18544 p2p / 18545 rpc)   ← ElectrumX + the web app
#   node B (127.0.0.1:18554 p2p / 18555 rpc)   ← counterparty: faucet,
#                                                 demo token, maker wallet
#   ElectrumX ws://127.0.0.1:50005             ← what the web app talks to
#
# Two daemons because the p2p message bus does not loop a node's own
# broadcasts back to itself: for the web app's RFQ to reach a maker (or
# vice versa) the two sides must sit on different nodes.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="$ROOT/.regtest"

# regtest-up.sh records the directories it resolved into $STATE/env.sh so the
# other scripts (fund, maker, down) reuse the SAME checkouts in later shells
# where the env vars aren't exported anymore. A stale navio-cli from a
# different checkout fails subtly — e.g. numeric RPC args passed as strings
# because its param-conversion table predates the trading RPCs. Explicit env
# vars still win over the recorded values.
if [ -f "$STATE/env.sh" ]; then
  # shellcheck disable=SC1091
  source "$STATE/env.sh"
fi

NAVIO_CORE_DIR="${NAVIO_CORE_DIR:-${SAVED_NAVIO_CORE_DIR:-$ROOT/../navio-core}}"
ELECTRUMX_DIR="${ELECTRUMX_DIR:-${SAVED_ELECTRUMX_DIR:-$ROOT/../electrumx}}"
ELECTRUMX_PYTHON="${ELECTRUMX_PYTHON:-${SAVED_ELECTRUMX_PYTHON:-python3}}"
ELECTRUMX_LEVELDB_LIB="${ELECTRUMX_LEVELDB_LIB:-${SAVED_ELECTRUMX_LEVELDB_LIB:-}}"
NAVIO_BLOCKS_DIR="${NAVIO_BLOCKS_DIR:-${SAVED_NAVIO_BLOCKS_DIR:-$ROOT/../navio-blocks}}"

NAVIOD="${NAVIOD:-$NAVIO_CORE_DIR/build/bin/naviod}"
NAVIO_CLI="${NAVIO_CLI:-$NAVIO_CORE_DIR/build/bin/navio-cli}"

CHAIN=blsctregtest
RPC_USER=dex
RPC_PASS=dex

A_P2P=18544; A_RPC=18545
B_P2P=18554; B_RPC=18555
EX_WS_PORT=50005

# macOS: hardened runtimes strip DYLD_*, and a homebrew-linked naviod needs
# its library path back. Harmless elsewhere.
export DYLD_LIBRARY_PATH="${NAVIOD_LIB_PATH:-/opt/homebrew/lib}"
export LD_LIBRARY_PATH="${NAVIOD_LIB_PATH:-/opt/homebrew/lib}"

cli_a() { "$NAVIO_CLI" -chain=$CHAIN -rpcport=$A_RPC -rpcuser=$RPC_USER -rpcpassword=$RPC_PASS "$@"; }
cli_b() { "$NAVIO_CLI" -chain=$CHAIN -rpcport=$B_RPC -rpcuser=$RPC_USER -rpcpassword=$RPC_PASS "$@"; }
cli_b_wallet() { cli_b -rpcwallet=maker "$@"; }

wait_rpc() { # wait_rpc <cli_fn>
  local fn=$1
  for _ in $(seq 1 60); do
    if "$fn" getblockcount >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  echo "error: daemon RPC did not come up" >&2
  return 1
}

mine_b() { # mine_b <blocks> — mine to the maker wallet's address
  local addr
  addr=$(cat "$STATE/maker.address")
  cli_b generatetoblsctaddress "$1" "$addr" >/dev/null
}
