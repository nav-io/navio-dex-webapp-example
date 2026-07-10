/**
 * Block explorer API client (blocks.nav.io)
 * =========================================
 *
 * The explorer is an INDEXER — a convenience layer for public data the
 * wallet does not need to trust: chain stats, token/NFT metadata, supply.
 * Nothing security-critical flows through it; balances and spendability
 * always come from the wallet's own scan of the chain via ElectrumX.
 *
 * Endpoints used (base is e.g. `https://blocks.nav.io/api/testnet`):
 *
 *   GET {base}/supply                 → { height, total_supply, ... }
 *   GET {base}/tokens?limit&offset    → token/NFT collection listings
 *   GET {base}/token/{id}             → collection detail
 *   GET {base}/txs/{txid}             → transaction detail
 *
 * The deployment may lag the app (e.g. `/tokens` can 404 on some
 * instances) and local regtest has no explorer at all, so every helper is
 * best-effort: failures surface as `null`/empty and the UI says so instead
 * of breaking. Listings then fall back to what the wallet itself knows.
 */

export interface ExplorerSupply {
  height: number;
  total_supply: number;
  network: string;
}

/**
 * A collection as the explorer returns it. Note `metadata` is an ARRAY of
 * key/value pairs (mirroring the daemon's `gettoken`), not an object — the
 * name lives at the `name` key. Supply fields are snake_case.
 */
export interface ExplorerToken {
  token_id: string;
  type?: string;
  public_key?: string;
  max_supply?: number;
  current_supply?: number;
  metadata?: Array<{ key: string; value: string }>;
}

/** Pull the display name out of a collection's metadata array. */
export function tokenName(t: ExplorerToken): string | null {
  return t.metadata?.find((m) => m.key === 'name')?.value ?? null;
}

export class ExplorerApi {
  constructor(
    private readonly base: string | null,
    /** Explorer website base for human-facing links; null = API only. */
    private readonly site: string | null = null,
  ) {}

  get available(): boolean {
    return this.base !== null;
  }

  private async get<T>(path: string): Promise<T | null> {
    if (!this.base) return null;
    try {
      const res = await fetch(`${this.base}${path}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  supply(): Promise<ExplorerSupply | null> {
    return this.get<ExplorerSupply>('/supply');
  }

  async tokens(limit = 50, offset = 0): Promise<ExplorerToken[]> {
    const res = await this.get<{ data?: ExplorerToken[] } | ExplorerToken[]>(
      `/tokens?limit=${limit}&offset=${offset}`,
    );
    if (!res) return [];
    return Array.isArray(res) ? res : (res.data ?? []);
  }

  token(tokenId: string): Promise<ExplorerToken | null> {
    // Note: the collection-detail endpoint is /tokens/{id} (plural), not
    // /token/{id} — the singular path 404s.
    return this.get<ExplorerToken>(`/tokens/${tokenId}`);
  }

  /**
   * Link for a transaction: the explorer website when one exists, otherwise
   * the API's JSON detail — raw but real, better than a dead frontend route.
   */
  txUrl(txid: string): string | null {
    if (this.site) return `${this.site}/tx/${txid}`;
    if (this.base) return `${this.base}/txs/${txid}`;
    return null;
  }
}
