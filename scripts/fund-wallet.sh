#!/usr/bin/env bash
# Fund an app wallet from the regtest faucet (the maker wallet on node B).
#
#   npm run regtest:fund -- <address> [nav-amount] [--with-token]
#
# Sends NAV (default 1000), optionally 500 units of the DEMO token, and
# mines two blocks so the outputs confirm. The app's background sync picks
# the funds up within a few seconds.

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

ADDRESS="${1:?usage: fund-wallet.sh <address> [nav-amount] [--with-token]}"
AMOUNT="${2:-1000}"

echo "== sending $AMOUNT NAV to $ADDRESS"
cli_b_wallet sendtoblsctaddress "$ADDRESS" "$AMOUNT" >/dev/null

if [[ "${3:-}" == "--with-token" || "${2:-}" == "--with-token" ]]; then
  TOKEN_ID=$(cat "$STATE/demo-token.id")
  echo "== sending 500 DEMO ($TOKEN_ID)"
  cli_b_wallet sendtokentoblsctaddress "$TOKEN_ID" "$ADDRESS" 500 >/dev/null
fi

mine_b 2
echo "== mined 2 blocks — funds confirm as soon as the app syncs"
