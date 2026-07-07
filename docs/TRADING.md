# How trading works (RFQ atomic swaps)

Navio has no on-chain order book and no smart contracts. Trading is
**request-for-quote (RFQ)** over an encrypted peer-to-peer message bus,
settled by **transaction-half aggregation**. This document walks the whole
protocol as the app exercises it, bottom-up.

## 1. The transport: an encrypted broadcast bus

Every naviod with `-p2pmsg=1` participates in an application-agnostic
message bus:

- every message is **encrypted** (ECIES: per-message ephemeral BLS key →
  ECDH → ChaCha20-Poly1305). Public announcements use a well-known key so
  anyone can read them, private replies use the recipient's key;
- every message carries a mandatory **proof-of-work stamp** (hashcash) so
  relaying is spam-resistant;
- nodes **relay blind** — they forward well-formed messages whether or not
  they understand them.

The web app never touches this layer directly: its daemon does, driven
through the ElectrumX RFQ bridge (nav-io/electrumx#2).

## 2. Swap halves — the settlement primitive

A BLSCT transaction proves, with a *balance proof*, that inputs and
outputs balance per token. The trick behind swaps:

> Build a transaction that is deliberately **unbalanced** — it spends your
> token A and "receives" token B out of thin air — and sign it. Alone it
> can never confirm. Combined with a counterparty's half that is unbalanced
> the *opposite* way, the union balances, and because BLS signatures
> aggregate, the two halves merge into ONE valid transaction.

Consequences worth internalizing:

- **Atomicity is free.** There is no state where only one side paid: the
  combined transaction either confirms (both legs) or doesn't exist.
- **Amounts are pinned by cryptography.** A tampered half fails the
  balance proof; nobody can alter the terms after signing.
- **Price is NOT protected.** A perfectly valid swap can still be a bad
  deal. Takers must bound what they accept — the SDK's `acceptQuote`
  refuses to run without `maxPay`/`minRecv`.
- **Fees**: the maker's half over-funds the network fee, so the taker's
  half pays none. (Convention from navio-core; it makes accepting cheap.)

## 3. The taker flow (`src/components/TradeDesk.tsx`)

```
app                        daemon A (via ElectrumX)          makers (bus)
 │ requestQuote(pair,size)  │                                   │
 │──────────────────────────▶ broadcast RFQ_REQ ────────────────▶
 │        {uuid, replyKey}  │        (public, PoW-stamped)      │
 │                          │                                   │ maker matches
 │ listQuotes(uuid) …poll…  │ ◀──────── RFQ_QUOTE (encrypted to replyKey)
 │◀───ranked quotes─────────│                                   │
 │ acceptQuote(quote, bounds)                                   │
 │   · SDK builds + signs YOUR half locally                     │
 │──────────────────────────▶ combine halves, broadcast swap    │
 │                          │────────── one atomic tx ─────────▶ chain
```

Details the code comments call out:

- the `replyKey` is a fresh key per request — quotes cannot be linked to
  your wallet or to your other requests;
- quotes are **signed** by the maker's session key and verified before the
  daemon hands them to you;
- polling `listQuotes` is honest: quotes genuinely trickle in over the bus.

## 4. The maker flow (`src/components/MakerDesk.tsx`)

Three escalating levels of commitment:

1. **Intent** (`setSwapIntent`) — pure configuration on your daemon:
   pair, size band, minimum price. Costs nothing, signs nothing. When a
   broadcast RFQ matches, the daemon queues a *pending quote request*.
2. **Quote** (`replyQuote`) — answers one request: the SDK builds and
   signs your half (spending real coins, over-funding the fee) and sends
   it encrypted to the taker. If the taker never accepts, the half simply
   expires; your coins were never locked.
3. **Standing order** (`broadcastOrder`) — a signed half broadcast to the
   whole network and cached by peers (up to 14 days), fillable while you
   are offline.

The "auto-reply" toggle is a complete market-maker bot in ~15 lines: a
subscription to pending requests plus `replyQuote` per item. In
production you would run the `navio-p2pmsg` daemon beside your node
instead — same loop, no browser needed.

**Inventory caveat** (repeated in the UI): coins committed by outstanding
quotes/orders are *not locked*. Spending them elsewhere invalidates the
quote — harmless to the network, disappointing to your counterparty.

## 5. What the ElectrumX bridge adds

Light wallets can't join the p2p bus (no listening socket, no PoW budget).
The bridge (nav-io/electrumx#2 + the `sendquote`/`sendorder` node RPCs
from nav-io/navio-core#263) turns the daemon into the wallet's bus proxy:

| App call | Bridge method | Who signs what |
|---|---|---|
| `requestQuote` | `blockchain.rfq.request_quote` | nothing signed; daemon holds the reply key |
| `listQuotes` | `blockchain.rfq.list_quotes` | — |
| `acceptQuote` | `blockchain.rfq.accept_quote` | **browser** signs the taker half; daemon combines + broadcasts |
| `setSwapIntent` | `blockchain.swap.set_intent` | nothing (config) |
| pending feed | `blockchain.swap.pending.subscribe` | — |
| `replyQuote` | `blockchain.swap.send_quote` | **browser** signs the maker half; daemon wraps/encrypts/sends |
| `broadcastOrder` | `blockchain.swap.broadcast_order` | **browser** signs; network caches |

The invariant across every row: **private keys never leave the browser**.
The daemon contributes transport identity (quote signatures) and relaying;
it can censor you, but it cannot spend for you or alter your terms.

## 6. Known trade-offs of this design

- Intents registered through a shared ElectrumX are visible to (and mixed
  with) other clients of that server — run your own for real making.
- RFQ requests reveal pair + size to the network by design (that's the
  advertisement). Wallet identity stays hidden.
- The taker trusts its daemon to relay honestly; a censoring daemon can
  starve you of quotes but never steal.
