# The in-browser wallet

"Login" in this app means opening a wallet that lives entirely in your
browser. No extension, no server account, no custody. This file explains
what that actually stores, how scanning finds your money, and what the
security envelope is.

## Key material and where it lives

One BIP39 mnemonic (24 words) is the root of everything. From its seed the
SDK derives, per navio-core's BLSCT scheme:

```
seed ─▶ child key ─▶ transaction key ─▶ view key   (scan & decrypt amounts)
                │                    └▶ spend key  (authorize spending)
                └▶ blinding/token keys             (outputs, minting authority)
```

Storage split (see `src/lib/settings.ts`):

| Store | Contents | Secret? |
|---|---|---|
| `localStorage` | wallet list (ids, names, chosen network) | no |
| IndexedDB, one DB per wallet | seed & derived keys, scanned outputs, sync state | **yes** |

With a password set, the SDK encrypts key material inside IndexedDB using
**Argon2id** (memory-hard KDF) → **AES-256-GCM**. `lock()` drops the
decrypted keys from memory; `unlock(password)` re-derives them. Balances
stay readable while locked — spending doesn't.

## How the wallet finds its outputs (light-wallet scanning)

Navio amounts and recipients are confidential on-chain. A light wallet
cannot ask a server "what's my balance" — the server doesn't know. Instead
(`navio-sdk` internals, driven by `startBackgroundSync`):

1. ElectrumX streams, per block, the compact **transaction keys** of every
   output (blinding key, spending key, a 16-bit **view tag**).
2. For each output the wallet computes what the view tag *would be* if the
   output were addressed to it (one ECDH with the view key). 65 535 of
   65 536 foreign outputs fail this check instantly.
3. Survivors get the full check and **amount recovery**: the range proof
   doubles as an encrypted envelope only the recipient's view key opens,
   yielding amount + memo + blinding factor.
4. Recovered outputs land in IndexedDB; spends are detected by watching
   inputs that reference them.

Privacy consequence: the server learns which *blocks* you fetched and what
you *broadcast*, but never which outputs are yours or what they're worth.

## The security envelope, stated plainly

This is a **hot wallet in a browser profile**. Within that envelope:

- ✅ password-encrypted at rest; keys never leave the page; no extension
  or third-party script can reach IndexedDB from another origin.
- ⚠️ anything that can run script *in this origin* owns the wallet (XSS,
  a malicious dependency, a compromised dev server). The example app has
  no third-party runtime deps beyond React for exactly this reason.
- ⚠️ browser data loss (profile wipe, "clear site data") destroys the
  wallet database. **The mnemonic is the only backup.** The UI shows it
  once at creation and again behind the password.
- ❌ no hardware-wallet path: BLSCT signing needs the keys in memory.

For a production DEX you would keep this exact architecture for small
"trading balance" wallets and add: a Content-Security-Policy, subresource
integrity, origin-isolated deployment, and encrypted mnemonic export.

## Networks

The wallet is network-agnostic; a preset (`src/lib/settings.ts`) names an
ElectrumX endpoint and optional explorer API:

- **Testnet** — public `testnet.nav.io:50005`; trading appears when that
  server carries the RFQ bridge.
- **Local regtest** — the environment from `scripts/` (see
  docs/LOCAL-REGTEST.md); full trading, instant blocks, free money.

The app feature-detects the trading bridge per session
(`blockchain.p2pmsg.info`) and hides Trade/Maker views when absent —
graceful degradation instead of broken buttons.

## One wart worth knowing about

navio-blsct ≤ 1.1.15 renders **regtest** addresses with the HRP `rnav`
while the daemon expects `rnv` (a navio-core constant mismatch, fixed
upstream on the `p2pmsg` branch). `src/lib/address.ts` transposes the
checksum so regtest addresses work today — it's also a nice, contained
example of the bech32_mod encoding if you ever need to implement it.
