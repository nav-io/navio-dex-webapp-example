/**
 * Collection introspection
 * ========================
 *
 * Before minting, the app inspects the target collection ON-CHAIN so it can
 * catch the three ways a mint gets rejected by consensus with the opaque
 * `failed-to-execute-predicate` error (see navio-core
 * `blsct/tokens/predicate_exec.cpp`):
 *
 *   1. Wrong TYPE — minting a fungible amount into an NFT collection (or an
 *      NFT into a fungible one). The predicate checks `token.info.type`.
 *   2. Supply — a fungible mint must keep `currentSupply + amount` within
 *      `maxSupply`; an NFT id must be `< maxSupply`.
 *   3. Wrong KEY — the collection is minted under a token key derived from
 *      the CREATOR wallet's seed. A different wallet (or an older app/binding
 *      version whose derivation differed) derives a different key, so its
 *      mints reference a token the chain has no record of. This is the
 *      subtle one: the collection is perfectly valid and fungible, yet YOUR
 *      wallet still can't mint into it.
 *
 * We answer all three by combining the daemon's `gettoken` (via the Electrum
 * `blockchain.token.get_token` bridge) with a local re-derivation of the
 * token public key from this wallet's master token key.
 */
import type { NavioClient } from 'navio-sdk';

export interface CollectionInfo {
  tokenId: string;
  type: 'token' | 'nft';
  /** The token public key the collection was created under (hex). */
  publicKey: string;
  maxSupply: bigint;
  currentSupply: bigint;
  metadata: Record<string, string>;
  /** True when THIS wallet's derived key matches — i.e. it can mint here. */
  mintableByThisWallet: boolean;
}

/** Raw daemon shape returned by `gettoken`. */
interface RawToken {
  tokenId: string;
  publicKey: string;
  type: string;
  metadata?: Array<{ key: string; value: string }>;
  maxSupply: number | string;
  currentSupply: number | string;
}

/**
 * Fetch a collection's on-chain info and decide whether this wallet can mint
 * into it. Returns null when the id is unknown to the indexer/daemon, or when
 * the connected server doesn't expose `blockchain.token.get_token`.
 */
export async function fetchCollectionInfo(
  client: NavioClient,
  collectionTokenId: string,
): Promise<CollectionInfo | null> {
  const electrum = client.getElectrumClient();
  if (!electrum) return null;

  let raw: RawToken | null = null;
  try {
    raw = (await electrum.call('blockchain.token.get_token', collectionTokenId)) as RawToken;
  } catch {
    return null; // unknown token, or method unsupported by this server
  }
  if (!raw || !raw.publicKey) return null;

  const metadata: Record<string, string> = {};
  for (const { key, value } of raw.metadata ?? []) metadata[key] = value;

  return {
    tokenId: collectionTokenId,
    type: raw.type === 'nft' ? 'nft' : 'token',
    publicKey: raw.publicKey,
    maxSupply: BigInt(raw.maxSupply ?? 0),
    currentSupply: BigInt(raw.currentSupply ?? 0),
    metadata,
    mintableByThisWallet: await walletDerivesKey(client, collectionTokenId, raw.publicKey),
  };
}

/**
 * Does this wallet derive the same token public key the collection was
 * created under? Re-derives locally from the master token key using the same
 * primitive the SDK uses at create/mint time. Any failure is treated as
 * "unknown" (true) so we never block a mint on a derivation hiccup — the
 * chain remains the final authority.
 */
async function walletDerivesKey(
  client: NavioClient,
  collectionTokenId: string,
  committedPublicKey: string,
): Promise<boolean> {
  try {
    // deriveCollectionTokenPublicKeyFromMaster is exported by navio-blsct at
    // runtime (the SDK uses it) even though it is absent from the public
    // type surface — hence the `any`.
    const blsct = (await import('navio-blsct')) as any;
    const masterTokenKey = client.getKeyManager().getMasterTokenKey();
    const derived = blsct.deriveCollectionTokenPublicKeyFromMaster(masterTokenKey, collectionTokenId);
    return derived.serialize() === committedPublicKey;
  } catch {
    return true;
  }
}
