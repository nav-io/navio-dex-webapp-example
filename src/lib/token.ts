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
 * We answer 1 and 2 from the daemon's `gettoken` (via the Electrum
 * `blockchain.token.get_token` bridge). Cause 3 (wrong wallet) can't be
 * detected reliably up front — it would require re-deriving the token key
 * exactly as the SDK does (id normalization included) and matching the
 * daemon's key serialization byte-for-byte — so we surface it only after a
 * mint is rejected, via the error explanation in MintStudio.
 */
import type { NavioClient } from 'navio-sdk';
import { ExplorerApi } from './explorer';

export interface CollectionInfo {
  /** The chain/explorer token id (tokenPublicKey.GetHash()). What you paste. */
  tokenId: string;
  type: 'token' | 'nft';
  /** The token public key the collection was created under (hex). */
  publicKey: string;
  maxSupply: bigint;
  currentSupply: bigint;
  metadata: Record<string, string>;
  /**
   * The id that mint calls actually need — Hash(metadata‖supply), a.k.a.
   * `calcCollectionTokenHashHex`. IMPORTANT: this is NOT the same value as
   * `tokenId`. The chain identifies a token by its public-key hash, but the
   * wallet derives the minting token key from Hash(metadata‖supply). Pasting
   * the chain id into a mint would derive the wrong key and be rejected, so
   * we recompute the correct one from the on-chain metadata + supply.
   */
  mintId: string;
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

/** A resolved collection, from whichever source answered. */
interface ResolvedRaw {
  type: string;
  publicKey: string;
  metadata: Record<string, string>;
  maxSupply: bigint;
  currentSupply: bigint;
}

/** Ask the Electrum server's `blockchain.token.get_token`. */
async function viaElectrum(client: NavioClient, id: string): Promise<ResolvedRaw | null> {
  const electrum = client.getElectrumClient();
  if (!electrum) return null;
  // Some Electrum builds silently ignore the Navio token method, so bound the
  // wait rather than hang the form waiting for a reply that never comes.
  const raw = await Promise.race([
    electrum.call('blockchain.token.get_token', id).catch(() => null) as Promise<RawToken | null>,
    new Promise<null>((r) => setTimeout(() => r(null), 6000)),
  ]);
  if (!raw || !raw.publicKey) return null;
  const metadata: Record<string, string> = {};
  for (const { key, value } of raw.metadata ?? []) metadata[key] = value;
  return {
    type: raw.type,
    publicKey: raw.publicKey,
    metadata,
    maxSupply: BigInt(raw.maxSupply ?? 0),
    currentSupply: BigInt(raw.currentSupply ?? 0),
  };
}

/** Fall back to the block explorer's token endpoint (works on testnet). */
async function viaExplorer(explorer: ExplorerApi, id: string): Promise<ResolvedRaw | null> {
  const t = await explorer.token(id);
  if (!t || !t.public_key) return null;
  const metadata: Record<string, string> = {};
  for (const { key, value } of t.metadata ?? []) metadata[key] = value;
  return {
    type: t.type ?? 'token',
    publicKey: t.public_key,
    metadata,
    maxSupply: BigInt(t.max_supply ?? 0),
    currentSupply: BigInt(t.current_supply ?? 0),
  };
}

/**
 * Fetch a collection's info from the chain and compute the id the wallet must
 * use to mint into it. Tries the Electrum token method first, then the block
 * explorer. Returns null when neither source knows the id.
 */
export async function fetchCollectionInfo(
  client: NavioClient,
  explorer: ExplorerApi,
  collectionTokenId: string,
): Promise<CollectionInfo | null> {
  const raw = (await viaElectrum(client, collectionTokenId)) ?? (await viaExplorer(explorer, collectionTokenId));
  if (!raw) return null;

  const metadata = raw.metadata;
  const maxSupply = raw.maxSupply;

  // Recompute the mint-side id from the committed metadata + supply. This is
  // the value createTokenCollection returned to the creator; it is what the
  // wallet must feed to mintToken/mintNft to derive the right token key.
  // calcCollectionTokenHashHex is exported by navio-blsct at runtime (the SDK
  // uses it) though it is absent from the public type surface — hence `any`.
  let mintId = collectionTokenId;
  try {
    const blsct = (await import('navio-blsct')) as any;
    mintId = blsct.calcCollectionTokenHashHex(metadata, Number(maxSupply));
  } catch {
    /* fall back to the pasted id */
  }

  return {
    tokenId: collectionTokenId,
    type: raw.type === 'nft' ? 'nft' : 'token',
    publicKey: raw.publicKey,
    maxSupply,
    currentSupply: raw.currentSupply,
    metadata,
    mintId,
  };
}
