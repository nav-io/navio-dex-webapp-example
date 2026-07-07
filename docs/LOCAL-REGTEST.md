# Running everything locally (blsctregtest)

The `scripts/` directory brings up a complete private Navio network on
your machine so you can exercise every feature of the app — including both
sides of a trade — with instant blocks and free coins.

## What gets started

```
┌────────────┐   p2p (+ encrypted message bus)   ┌────────────┐
│   node A   │◀─────────────────────────────────▶│   node B   │
│ rpc :18545 │                                   │ rpc :18555 │
└─────▲──────┘                                   └────────────┘
      │ JSON-RPC                                  · "maker" wallet
┌─────┴──────┐                                    · 110 mined blocks
│ ElectrumX  │ ws://127.0.0.1:50005               · DEMO token (10 000 minted)
└─────▲──────┘
      │ WebSocket
   the web app
```

Two daemons because the message bus never loops a node's own broadcasts
back to itself — for the app's RFQ to reach a counterparty (and vice
versa) the two sides must sit on different nodes. Node B doubles as the
faucet.

## Prerequisites

Two sibling checkouts (paths overridable via `NAVIO_CORE_DIR` /
`ELECTRUMX_DIR`):

1. **navio-core**, branch `p2pmsg` (PR [nav-io/navio-core#263]), built:

   ```sh
   git clone -b p2pmsg https://github.com/nav-io/navio-core ../navio-core
   cd ../navio-core
   cmake -B build -DCMAKE_BUILD_TYPE=RelWithDebInfo   # needs boost, libevent
   cmake --build build -j8 --target naviod navio-cli
   ```

   (On macOS with Homebrew: `-DCMAKE_PREFIX_PATH="/opt/homebrew;$(brew --prefix boost)"`.
   If naviod complains about `libevent…dylib` at runtime, the scripts
   already export `DYLD_LIBRARY_PATH=/opt/homebrew/lib`; override with
   `NAVIOD_LIB_PATH`.)

2. **electrumx**, branch `rfq-swap-bridge` (PR [nav-io/electrumx#2]), with
   Python deps:

   ```sh
   git clone -b rfq-swap-bridge https://github.com/nav-io/electrumx ../electrumx
   cd ../electrumx && python3 -m pip install -e .
   ```

   Point `ELECTRUMX_PYTHON` at a specific interpreter if your default
   python3 isn't the one with the deps.

## The loop

```sh
npm run regtest:up        # daemons + funded maker wallet + DEMO token + electrumx
npm run dev               # open the app → create wallet → network: "Local regtest"

# copy the address from Portfolio → Receive, then:
npm run regtest:fund -- rnv1... 1000 --with-token   # NAV + 500 DEMO, mined

# Trade view (app = taker): node B advertises DEMO and auto-answers
npm run regtest:maker

# Maker desk (app = maker): register an intent for the DEMO token id
# (printed by regtest:up, also in .regtest/demo-token.id), enable
# auto-reply, then have node B request a quote from you:
npm run regtest:maker -- take 100

npm run regtest:mine -- 3       # via: npm run regtest:maker -- mine 3
npm run regtest:down            # stop; state survives in .regtest/
rm -rf .regtest                 # full reset
```

Logs live in `.regtest/logs/` — `nodeA.log`, `nodeB.log`,
`electrumx.log`. When something misbehaves, the answer is almost always in
one of those three files.

## Why blocks don't mine themselves

Regtest has no miners: blocks exist only when a script asks for them
(`generatetoblsctaddress`). The maker script mines automatically a few
seconds after answering a quote so accepted swaps confirm; for anything
else use `npm run regtest:maker -- mine <n>`. If the app looks "stuck
pending", you almost certainly just need a block.

## Two quirks, documented rather than hidden

- **Address prefix**: the published navio-blsct renders regtest addresses
  as `rnav1…`; the app transposes them to the `rnv1…` the daemon expects
  (see `src/lib/address.ts`). Fund whatever the Receive view shows — it's
  already corrected.
- **Trading needs both PRs**: a vanilla master naviod or electrumx will
  serve the wallet fine but the app will (correctly) hide Trade/Maker —
  that's the feature detection working, not a bug in your setup.

[nav-io/navio-core#263]: https://github.com/nav-io/navio-core/pull/263
[nav-io/electrumx#2]: https://github.com/nav-io/electrumx/pull/2
