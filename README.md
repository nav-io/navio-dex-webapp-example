# Navio DEX — example web app

A full-featured **example decentralized exchange** built on
[`navio-sdk`](https://github.com/nav-io/navio-sdk), written to be read.
It shows how far a plain browser tab gets you on Navio:

- 🔑 **Wallet in the browser** — create/restore from a BIP39 mnemonic,
  encrypted at rest (Argon2id + AES-256-GCM) in IndexedDB, unlocked with a
  password. No extension, no server account, keys never leave the page.
- 📡 **Light-wallet sync** — client-side confidential-output scanning over
  an ElectrumX WebSocket; the server never learns your balance.
- 🪙 **Mint studio** — create fungible token collections and NFT
  collections, mint into them, send tokens/NFTs.
- 📈 **Trade (taker)** — broadcast a request-for-quote over Navio's
  encrypted p2p message bus, collect signed maker quotes, accept the best
  one; settlement is a single atomic transaction assembled from two
  signed halves.
- 🏦 **Maker desk** — advertise swap intents, answer quote requests (one
  click or auto-reply), publish standing orders the network caches while
  you're offline, manage it all.
- 🌐 **Market view** — public token/NFT listings via the
  [blocks.nav.io](https://blocks.nav.io) indexer where available.
- 🧪 **A complete local network** — `scripts/` boots two `naviod`
  daemons + ElectrumX on blsctregtest so you can play both sides of every
  trade on your laptop.

> **This is a learning resource, not production software.** Corners are
> deliberately left visible: no framework beyond React, no backend, and
> comments everywhere a real product would hide the machinery. Start with
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Documentation

| Doc | Covers |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | system diagram, trust model, module map, non-goals |
| [docs/TRADING.md](docs/TRADING.md) | the RFQ protocol end-to-end: message bus, swap halves, taker/maker flows, what the ElectrumX bridge does |
| [docs/WALLET.md](docs/WALLET.md) | key derivation, storage & encryption, how scanning finds your outputs, the security envelope |
| [docs/LOCAL-REGTEST.md](docs/LOCAL-REGTEST.md) | running the whole stack locally |

Every source file opens with a doc comment explaining *why* it exists —
the code is the other half of the documentation.

## Quick start

```sh
npm install
npm run dev
```

Open the app, create a wallet on **Testnet**, and get testnet NAV to its
receive address. Wallet, sync, minting and the market view work against
any Navio ElectrumX; the **Trade/Maker views light up automatically** when
the connected server carries the RFQ trading bridge.

### Trading prerequisites (until merged/released)

The trading stack spans three PRs; the app degrades gracefully without
them:

- [nav-io/navio-core#263](https://github.com/nav-io/navio-core/pull/263) — the p2p message bus, RFQ subsystem and `sendquote`/`sendorder` RPCs
- [nav-io/electrumx#2](https://github.com/nav-io/electrumx/pull/2) — the Electrum-protocol RFQ bridge
- [nav-io/navio-sdk#9](https://github.com/nav-io/navio-sdk/pull/9) — the trading API this app calls (`navio-sdk ≥ 0.1.18`)

If `navio-sdk@0.1.18` isn't on npm yet, point the dependency at the
branch: `npm i github:nav-io/navio-sdk#rfq-swap-trading`.

### Full local playground

```sh
npm run regtest:up      # two daemons + electrumx + funded maker + DEMO token
npm run dev             # create a wallet on the "Local regtest" preset
npm run regtest:fund -- <your-address> 1000 --with-token
npm run regtest:maker   # a counterparty that answers your quote requests
```

See [docs/LOCAL-REGTEST.md](docs/LOCAL-REGTEST.md) for prerequisites and
the maker-side walkthrough.

## License

MIT
