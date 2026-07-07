/**
 * Market: what exists on this network
 * ===================================
 *
 * Listings come from two independent sources, clearly labeled:
 *
 *   - The block explorer indexer (blocks.nav.io API) — public token /
 *     NFT collections everyone can see. Best-effort: some deployments or
 *     networks (local regtest) have no indexer, and the panel says so.
 *
 *   - Your own wallet — assets you hold, which you can immediately trade
 *     from the Trade view.
 *
 * A real DEX would add its own order-book indexer here; on Navio the
 * standing-order cache on every node (`listorders`) plays that role for
 * offline makers, and RFQ broadcasts reach makers directly, so a DEX can
 * work with no central index at all.
 */
import { useEffect, useState } from 'react';
import { useWallet } from '../state/WalletContext';
import { ExplorerSupply, ExplorerToken } from '../lib/explorer';
import { shorten } from '../lib/format';
import { Amount } from './Amount';

export function Market({ onTrade }: { onTrade: () => void }) {
  const { session, balances } = useWallet();
  const [supply, setSupply] = useState<ExplorerSupply | null>(null);
  const [tokens, setTokens] = useState<ExplorerToken[] | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void (async () => {
      const [s, t] = await Promise.all([session.explorer.supply(), session.explorer.tokens()]);
      if (!cancelled) {
        setSupply(s);
        setTokens(t);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (!session) return null;

  return (
    <div className="stack">
      <section className="panel">
        <div className="row spread">
          <h2>Network</h2>
          {supply && (
            <div className="stat-row">
              <span>height <strong>{supply.height.toLocaleString()}</strong></span>
              <span>supply <strong>{Math.floor(supply.total_supply / 1e8).toLocaleString()} NAV</strong></span>
            </div>
          )}
        </div>
        {!session.explorer.available && (
          <p className="hint">
            No explorer indexer for this network ({session.preset.label}) — public listings are
            unavailable. Your own assets below are read straight from the chain.
          </p>
        )}
      </section>

      <section className="panel">
        <h2>Indexed collections</h2>
        {tokens === null || tokens.length === 0 ? (
          <p className="empty">
            {session.explorer.available
              ? 'The indexer returned no collections (the endpoint may not be deployed yet).'
              : 'Unavailable without an explorer API.'}
          </p>
        ) : (
          <table>
            <thead>
              <tr><th>Name</th><th>Type</th><th>Token id</th><th className="num">Supply</th></tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.token_id}>
                  <td>{t.name ?? t.metadata?.name ?? '—'}</td>
                  <td><span className="tag">{t.type ?? 'token'}</span></td>
                  <td className="mono" title={t.token_id}>{shorten(t.token_id, 14, 6)}</td>
                  <td className="num">{t.current_supply?.toLocaleString() ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <div className="row spread">
          <h2>Your assets</h2>
          {session.tradingAvailable && (
            <button className="primary" onClick={onTrade}>Trade</button>
          )}
        </div>
        {balances.length === 0 ? (
          <p className="empty">Nothing yet — mint an asset or request a quote to buy one.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Asset</th><th>Kind</th><th className="num">Balance</th></tr>
            </thead>
            <tbody>
              {balances.map((b) => (
                <tr key={b.tokenId}>
                  <td className="mono" title={b.tokenId}>{shorten(b.tokenId, 14, 6)}</td>
                  <td><span className="tag">{b.kind}</span></td>
                  <td className="num"><Amount units={b.balance} decimals={0} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
