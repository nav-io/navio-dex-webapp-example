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
  constructor(private readonly base: string | null) {}

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
    return this.get<ExplorerToken>(`/token/${tokenId}`);
  }

  /** Human link to a transaction on the explorer website, when one exists. */
  txUrl(txid: string): string | null {
    if (!this.base) return null;
    const site = this.base.replace(/\/api(\/testnet)?$/, (m) => (m.includes('testnet') ? '/testnet' : ''));
    return `${site}/tx/${txid}`;
  }
}
