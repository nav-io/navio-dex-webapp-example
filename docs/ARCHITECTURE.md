# Architecture

This app is a **learning resource**: every design decision optimizes for
being readable and honest about how a Navio light-wallet DEX works, not for
production hardening. Read this file first, then the source — each module
has a doc comment explaining its role.

## The big picture

```
┌──────────────────────────── browser ────────────────────────────┐
│                                                                  │
│  React UI (src/components)                                       │
│      │  reads state / calls actions                              │
│  WalletContext (src/state) ── owns one NavioClient               │
│      │                                                           │
│  navio-sdk ──────────────┐                                       │
│   · key derivation       │  navio-blsct (WebAssembly)            │
│   · output scanning      │   · range proofs, BLS signatures      │
│   · tx building/signing  │   · loaded once at boot               │
│   · RFQ trading API      │                                       │
│      │                                                           │
│  IndexedDB (per-wallet DB: keys*, scanned outputs)               │
└──────┼───────────────────────────────────────────────────────────┘
       │ WebSocket (Electrum protocol + RFQ bridge methods)
┌──────▼──────────┐     JSON-RPC      ┌──────────────────┐
│    ElectrumX    │ ─────────────────▶│  naviod (-p2pmsg) │──── p2p bus ──▶ makers/takers
└─────────────────┘                   └──────────────────┘
       ▲
       │ HTTPS (optional, public data only)
  blocks.nav.io indexer
```

\* encrypted with Argon2id + AES-256-GCM when a password is set.

## Trust model — what each party can and cannot do

| Party | Sees | Cannot |
|---|---|---|
| **Browser** | everything (it *is* the wallet) | — |
| **ElectrumX server** | your IP, which blocks you fetch, txs you broadcast | learn balances or which outputs are yours: scanning happens client-side with your view key; amounts are confidential on-chain |
| **naviod** | the p2p bus traffic (encrypted envelopes) | forge quotes (signed), steal swap funds (atomicity is enforced by the BLSCT balance proof) |
| **Explorer indexer** | nothing about you (read-only public data) | affect funds in any way |

The chain guarantees swap **atomicity**, not a fair **price** — that is why
`acceptQuote` requires explicit `maxPay` / `minRecv` slippage bounds and the
UI derives them from a user-visible setting.

## Why there is no backend

Everything a DEX classically needs a server for maps onto a Navio
primitive:

- **Order book** → maker *intents* live on daemons; *standing orders* are
  pre-signed halves cached by every node for up to 14 days.
- **Matching** → taker RFQs broadcast over the encrypted p2p bus; daemons
  match them against local intents.
- **Settlement** → BLS signature aggregation combines the two signed
  halves into one atomic transaction. No escrow, no contract.
- **Discovery/history** → any block explorer indexer (best-effort here).

## Module map

| Path | What it teaches |
|---|---|
| `src/main.tsx` | Buffer polyfill + WASM boot ordering (load-bearing!) |
| `src/lib/blsct.ts` | how the navio-blsct WebAssembly build is loaded |
| `src/lib/address.ts` | bech32_mod addresses; the regtest HRP workaround |
| `src/lib/settings.ts` | what goes in localStorage vs IndexedDB |
| `src/lib/explorer.ts` | treating an indexer as untrusted convenience |
| `src/state/WalletContext.tsx` | client lifecycle, sync loop, trading feature-detection |
| `src/components/Gate.tsx` | create/restore/unlock — "login without a server" |
| `src/components/Portfolio.tsx` | balances, receive, send (NAV / token / NFT) |
| `src/components/MintStudio.tsx` | collections vs mints, token authority |
| `src/components/TradeDesk.tsx` | the taker side of an RFQ atomic swap |
| `src/components/MakerDesk.tsx` | intents, quote replies, auto-reply bot, standing orders |
| `scripts/` | a full local blsctregtest network (see docs/LOCAL-REGTEST.md) |

## Deliberate non-goals

Kept out so the interesting parts stay visible:

- no router, no state library, no CSS framework — `useState` + one context
  + one stylesheet;
- no token metadata caching layer;
- no multi-account UI (the SDK supports sub-address accounts);
- no persistence of the activity log;
- error handling favors surfacing the SDK's message over recovering
  silently.
