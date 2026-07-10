#!/usr/bin/env bash
# Bring up a complete local Navio blsctregtest environment for the web app:
#
#   1. two connected naviod nodes with the encrypted p2p message bus on
#      (-p2pmsg=1) and instant anti-spam PoW (-p2pmsgpowbits=1),
#   2. a funded "maker" wallet on node B with a freshly minted DEMO token,
#   3. ElectrumX (with the RFQ bridge) serving WebSocket on port 50005.
#
# After this script prints its summary:
#
#   npm run dev                 → open the app, create a wallet with the
#                                 "Local regtest" network preset
#   npm run regtest:fund -- <address>   → give the app wallet NAV
#   npm run regtest:maker       → make node B answer the app's RFQs
#   npm run regtest:down        → stop everything (state kept in .regtest/)
#
# Prerequisites are checked, not installed: see docs/LOCAL-REGTEST.md for
# the two checkouts/builds this needs.

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

mkdir -p "$STATE"/{nodeA,nodeB,electrumx-db,logs}

# ---- preflight -------------------------------------------------------------
[ -x "$NAVIOD" ] || {
  echo "error: naviod not found at $NAVIOD" >&2
  echo "Build navio-core (branch: p2pmsg) with cmake, or set NAVIOD/NAVIO_CORE_DIR." >&2
  echo "See docs/LOCAL-REGTEST.md." >&2
  exit 1
}
[ -e "$ELECTRUMX_DIR/electrumx_server" ] || {
  echo "error: electrumx not found at $ELECTRUMX_DIR (branch: rfq-swap-bridge)" >&2
  echo "Set ELECTRUMX_DIR or clone nav-io/electrumx next to this repo." >&2
  exit 1
}

# Record the resolved checkouts so fund/maker/down reuse the exact same ones
# even in shells where these env vars aren't exported (see common.sh).
cat > "$STATE/env.sh" <<EOF
SAVED_NAVIO_CORE_DIR="$NAVIO_CORE_DIR"
SAVED_ELECTRUMX_DIR="$ELECTRUMX_DIR"
SAVED_ELECTRUMX_PYTHON="$ELECTRUMX_PYTHON"
SAVED_ELECTRUMX_LEVELDB_LIB="$ELECTRUMX_LEVELDB_LIB"
SAVED_NAVIO_BLOCKS_DIR="$NAVIO_BLOCKS_DIR"
EOF

start_node() { # start_node <name> <p2p> <rpc> <extra...>
  local name=$1 p2p=$2 rpc=$3; shift 3
  if [ -f "$STATE/$name.pid" ] && kill -0 "$(cat "$STATE/$name.pid")" 2>/dev/null; then
    echo "· $name already running (pid $(cat "$STATE/$name.pid"))"
    return
  fi
  "$NAVIOD" -chain=$CHAIN -datadir="$STATE/$name" \
    -port=$p2p -rpcport=$rpc -rpcuser=$RPC_USER -rpcpassword=$RPC_PASS \
    -p2pmsg=1 -p2pmsgpowbits=1 -server=1 -listen=1 -fallbackfee=0.00001 \
    -debug=net "$@" >"$STATE/logs/$name.log" 2>&1 &
  echo $! > "$STATE/$name.pid"
  echo "· started $name (pid $!)"
}

echo "== starting daemons"
start_node nodeA $A_P2P $A_RPC -connect=0
start_node nodeB $B_P2P $B_RPC -connect=127.0.0.1:$A_P2P
wait_rpc cli_a
wait_rpc cli_b

# ---- maker wallet + funds + demo token ------------------------------------
if [ ! -f "$STATE/maker.address" ]; then
  echo "== creating maker wallet on node B"
  cli_b -named createwallet wallet_name=maker blsct=true >/dev/null
  ADDR=$(cli_b_wallet getnewaddress "" blsct)
  echo "$ADDR" > "$STATE/maker.address"
  echo "== mining 110 blocks to the maker wallet (coin maturity)"
  cli_b generatetoblsctaddress 110 "$ADDR" >/dev/null

  echo "== minting the DEMO token"
  TOKEN_ID=$(cli_b_wallet createtoken '{"name":"DEMO"}' 1000000 | python3 -c 'import json,sys; print(json.load(sys.stdin)["tokenId"])')
  echo "$TOKEN_ID" > "$STATE/demo-token.id"
  mine_b 1
  cli_b_wallet minttoken "$TOKEN_ID" "$ADDR" 10000 >/dev/null
  mine_b 2
else
  echo "· maker wallet exists ($(cat "$STATE/maker.address"))"
  cli_b loadwallet maker >/dev/null 2>&1 || true
fi

# ---- electrumx --------------------------------------------------------------
if [ -f "$STATE/electrumx.pid" ] && kill -0 "$(cat "$STATE/electrumx.pid")" 2>/dev/null; then
  echo "· electrumx already running (pid $(cat "$STATE/electrumx.pid"))"
else
  echo "== starting electrumx (ws://127.0.0.1:$EX_WS_PORT)"
  # ELECTRUMX_LEVELDB_LIB: optional dir holding an RTTI-enabled libleveldb —
  # macOS homebrew builds LevelDB with -fno-rtti, which crashes plyvel (see
  # docs/LOCAL-REGTEST.md). Prepended so plyvel picks it up first.
  ( cd "$ELECTRUMX_DIR" && \
    COIN=Navio NET=regtest \
    DAEMON_URL="http://$RPC_USER:$RPC_PASS@127.0.0.1:$A_RPC/" \
    DB_DIRECTORY="$STATE/electrumx-db" \
    SERVICES="ws://0.0.0.0:$EX_WS_PORT,rpc://127.0.0.1:8000" \
    COST_SOFT_LIMIT=0 COST_HARD_LIMIT=0 \
    DYLD_LIBRARY_PATH="${ELECTRUMX_LEVELDB_LIB:+$ELECTRUMX_LEVELDB_LIB:}$DYLD_LIBRARY_PATH" \
    ${ELECTRUMX_PYTHON:-python3} ./electrumx_server \
  ) >"$STATE/logs/electrumx.log" 2>&1 &
  echo $! > "$STATE/electrumx.pid"
fi

# ---- auto-miner --------------------------------------------------------------
# regtest mines no blocks on its own, so anything broadcast (mints, sends,
# swaps) would sit in the mempool forever. Tick a block to the maker wallet
# every BLOCK_SECONDS (default 15) so transactions confirm like on a real
# chain. Disable with BLOCK_SECONDS=0.
BLOCK_SECONDS="${BLOCK_SECONDS:-15}"
if [ "$BLOCK_SECONDS" = "0" ]; then
  echo "· auto-miner disabled (BLOCK_SECONDS=0)"
elif [ -f "$STATE/miner.pid" ] && kill -0 "$(cat "$STATE/miner.pid")" 2>/dev/null; then
  echo "· auto-miner already running (pid $(cat "$STATE/miner.pid"))"
else
  echo "== starting auto-miner (1 block / ${BLOCK_SECONDS}s)"
  (
    MINE_ADDR=$(cli_b_wallet getnewaddress "" blsct)
    while sleep "$BLOCK_SECONDS"; do
      cli_b generatetoblsctaddress 1 "$MINE_ADDR" >/dev/null 2>&1 || true
    done
  ) >"$STATE/logs/miner.log" 2>&1 &
  echo $! > "$STATE/miner.pid"
fi

# ---- block explorer (navio-blocks, optional) --------------------------------
# Gives the app the same explorer REST API it uses against blocks.nav.io:
# token listings for the Market view and collection lookups for minting.
# navio-blocks only knows mainnet/testnet, so the regtest chain is indexed
# under its "testnet" label and served at http://127.0.0.1:3100/api/testnet
# (which is what the app's regtest preset expects). Skipped with a note when
# no checkout is found — everything else works without it.
NAVIO_BLOCKS_DIR="${NAVIO_BLOCKS_DIR:-$ROOT/../navio-blocks}"
EXPLORER_API_PORT="${EXPLORER_API_PORT:-3100}"
if [ ! -f "$NAVIO_BLOCKS_DIR/package.json" ]; then
  echo "· explorer skipped (no navio-blocks checkout at $NAVIO_BLOCKS_DIR — set NAVIO_BLOCKS_DIR)"
elif [ -f "$STATE/explorer-api.pid" ] && kill -0 "$(cat "$STATE/explorer-api.pid")" 2>/dev/null; then
  echo "· explorer already running (pid $(cat "$STATE/explorer-api.pid"))"
else
  echo "== starting block explorer (http://127.0.0.1:$EXPLORER_API_PORT/api/testnet)"
  mkdir -p "$STATE/explorer"
  cat > "$STATE/explorer/regtest.env" <<EOF
NETWORK=testnet
RPC_HOST=127.0.0.1
RPC_PORT=$A_RPC
RPC_USER=$RPC_USER
RPC_PASSWORD=$RPC_PASS
DB_PATH=$STATE/explorer/explorer.db
TESTNET_DB_PATH=$STATE/explorer/explorer.db
TESTNET_RPC_HOST=127.0.0.1
TESTNET_RPC_PORT=$A_RPC
TESTNET_RPC_USER=$RPC_USER
TESTNET_RPC_PASSWORD=$RPC_PASS
API_PORT=$EXPLORER_API_PORT
API_HOST=127.0.0.1
POLL_INTERVAL=2000
BSC_WNAV_ENABLED=false
NAVIO_AUDIT_ENABLED=false
EOF
  ( cd "$NAVIO_BLOCKS_DIR" && ENV_FILE="$STATE/explorer/regtest.env" npm -w packages/indexer run dev ) \
    >"$STATE/logs/explorer-indexer.log" 2>&1 &
  echo $! > "$STATE/explorer-indexer.pid"
  ( cd "$NAVIO_BLOCKS_DIR" && ENV_FILE="$STATE/explorer/regtest.env" npm -w packages/api run dev ) \
    >"$STATE/logs/explorer-api.log" 2>&1 &
  echo $! > "$STATE/explorer-api.pid"
fi

sleep 2
for pid_file in nodeA nodeB electrumx; do
  kill -0 "$(cat "$STATE/$pid_file.pid")" 2>/dev/null || {
    echo "error: $pid_file died — check $STATE/logs/$pid_file.log" >&2
    exit 1
  }
done

echo
echo "regtest environment is up"
echo "  node A rpc     127.0.0.1:$A_RPC   (behind ElectrumX; the app's node)"
echo "  node B rpc     127.0.0.1:$B_RPC   (counterparty/faucet)"
echo "  electrumx      ws://127.0.0.1:$EX_WS_PORT"
[ -f "$STATE/explorer-api.pid" ] && \
echo "  explorer api   http://127.0.0.1:$EXPLORER_API_PORT/api/testnet"
echo "  DEMO token id  $(cat "$STATE/demo-token.id")"
echo
echo "next:"
echo "  npm run dev                          # open the app, pick 'Local regtest'"
echo "  npm run regtest:fund -- <address>    # fund the app wallet (copy it from Receive)"
echo "  npm run regtest:maker                # node B advertises + auto-answers RFQs"
