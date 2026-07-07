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

export interface CollectionInfo {
  tokenId: string;
  type: 'token' | 'nft';
  /** The token public key the collection was created under (hex). */
  publicKey: string;
  maxSupply: bigint;
  currentSupply: bigint;
  metadata: Record<string, string>;
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
  };
}
