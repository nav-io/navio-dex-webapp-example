#!/usr/bin/env bash
# Drive node B as the app's trading counterparty.
#
#   npm run regtest:maker                # default: MAKER MODE
#   npm run regtest:maker -- take <amount-of-DEMO>   # TAKER MODE
#   npm run regtest:maker -- mine [n]    # mine n blocks (default 1)
#
# MAKER MODE (exercise the app's Trade view):
#   Registers a swap intent on node B — sell DEMO for NAV at 0.1 NAV-unit
#   per token unit — then loops: whenever the app's request-for-quote
#   matches, node B's wallet builds+signs its half and replies. Accepting
#   in the app completes the atomic swap. This loop is exactly what the
#   `navio-p2pmsg` daemon binary does in production; a shell loop keeps it
#   transparent here.
#
# TAKER MODE (exercise the app's Maker desk):
#   Node B broadcasts an RFQ to BUY DEMO from the app. Register an intent
#   in the app's Maker desk first (deliver = DEMO token id, receive NAV),
#   enable auto-reply (or press "Send quote"), and this script accepts the
#   quote and mines the swap.

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

TOKEN_ID=$(cat "$STATE/demo-token.id")
EXPIRY=$(( $(date +%s) + 3600 ))

case "${1:-maker}" in
  maker)
    echo "== intent on node B: sell DEMO for NAV (price 0.1 per unit, fills 1..100000)"
    cli_b setswapintent "$TOKEN_ID" "" 1 100000 10000000 "$EXPIRY" >/dev/null
    echo "== answering matching requests (ctrl-C to stop)"
    echo "   In the app: Trade → buy = $TOKEN_ID, pay with NAV"
    while true; do
      PENDING=$(cli_b listpendingquoterequests)
      COUNT=$(echo "$PENDING" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')
      if [ "$COUNT" -gt 0 ]; then
        UUID=$(echo "$PENDING" | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["uuid"])')
        echo "· request $UUID matched — replying with a signed half"
        cli_b_wallet replyquote "$UUID" >/dev/null && echo "· quote sent"
        # Mine shortly after so an accepted swap confirms.
        ( sleep 5; mine_b 2; echo "· mined 2 blocks" ) &
      fi
      sleep 2
    done
    ;;

  take)
    SIZE="${2:-100}"
    echo "== node B requests to BUY $SIZE DEMO paying NAV"
    echo "   (register a matching intent + auto-reply in the app's Maker desk first)"
    UUID=$(cli_b requestquote "$TOKEN_ID" "" "$SIZE" "$EXPIRY" | python3 -c 'import json,sys; print(json.load(sys.stdin)["uuid"])')
    echo "· rfq $UUID broadcast — waiting for the app's quote"
    for _ in $(seq 1 30); do
      QID=$(cli_b listquotes "$UUID" | python3 -c 'import json,sys; q=json.load(sys.stdin); print(q[0]["quote_id"] if q else "")')
      [ -n "$QID" ] && break
      sleep 2
    done
    [ -n "${QID:-}" ] || { echo "error: no quote arrived — is auto-reply on in the app?" >&2; exit 1; }
    echo "· accepting quote $QID (node B builds its half; swap broadcasts)"
    TXID=$(cli_b_wallet acceptquotewallet "$UUID" "$QID" 100000000000 "$SIZE")
    mine_b 2
    echo "· swap $TXID mined — the app wallet received NAV for its DEMO"
    ;;

  mine)
    mine_b "${2:-1}"
    echo "mined ${2:-1} block(s)"
    ;;

  *)
    echo "usage: counterparty-maker.sh [maker|take <size>|mine [n]]" >&2
    exit 1
    ;;
esac
