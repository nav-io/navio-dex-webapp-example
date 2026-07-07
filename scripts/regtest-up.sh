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
  ( cd "$ELECTRUMX_DIR" && \
    COIN=Navio NET=regtest \
    DAEMON_URL="http://$RPC_USER:$RPC_PASS@127.0.0.1:$A_RPC/" \
    DB_DIRECTORY="$STATE/electrumx-db" \
    SERVICES="ws://0.0.0.0:$EX_WS_PORT,rpc://127.0.0.1:8000" \
    COST_SOFT_LIMIT=0 COST_HARD_LIMIT=0 \
    ${ELECTRUMX_PYTHON:-python3} ./electrumx_server \
  ) >"$STATE/logs/electrumx.log" 2>&1 &
  echo $! > "$STATE/electrumx.pid"
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
echo "  DEMO token id  $(cat "$STATE/demo-token.id")"
echo
echo "next:"
echo "  npm run dev                          # open the app, pick 'Local regtest'"
echo "  npm run regtest:fund -- <address>    # fund the app wallet (copy it from Receive)"
echo "  npm run regtest:maker                # node B advertises + auto-answers RFQs"
