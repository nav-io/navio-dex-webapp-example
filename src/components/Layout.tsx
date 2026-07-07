/**
 * Layout: sidebar navigation + status bar
 * =======================================
 *
 * The top bar surfaces the three pieces of session state a trader wants
 * at all times: sync progress, the privacy screen toggle, and the wallet
 * lock. Trading views are only offered when the connected server actually
 * carries the RFQ bridge (see WalletContext.detectTrading).
 */
import React from 'react';
import { useWallet } from '../state/WalletContext';
import { shorten } from '../lib/format';

export type View = 'portfolio' | 'market' | 'trade' | 'maker' | 'mint';

const NAV: Array<{ view: View; label: string; hint: string; needsTrading?: boolean }> = [
  { view: 'portfolio', label: 'Portfolio', hint: 'Balances, send & receive' },
  { view: 'market', label: 'Market', hint: 'Tokens & NFTs on this network' },
  { view: 'trade', label: 'Trade', hint: 'Request quotes, swap atomically', needsTrading: true },
  { view: 'maker', label: 'Maker desk', hint: 'Provide liquidity, answer quotes', needsTrading: true },
  { view: 'mint', label: 'Mint studio', hint: 'Create tokens & NFTs' },
];

export function Layout({
  view,
  onNavigate,
  children,
}: {
  view: View;
  onNavigate: (v: View) => void;
  children: React.ReactNode;
}) {
  const { session, sync, concealAmounts, setConcealAmounts, locked, lock, closeWallet } = useWallet();
  if (!session) return null;

  const synced = sync.tip > 0 && sync.height >= sync.tip;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">◈</span>
          <div>
            <div className="brand-name">Navio DEX</div>
            <div className="brand-sub">sdk example</div>
          </div>
        </div>
        <nav>
          {NAV.map((item) => {
            const disabled = item.needsTrading && !session.tradingAvailable;
            return (
              <button
                key={item.view}
                className={`nav-item${view === item.view ? ' active' : ''}`}
                disabled={disabled}
                title={disabled ? 'Connected server has no RFQ trading bridge' : item.hint}
                onClick={() => onNavigate(item.view)}
              >
                <span>{item.label}</span>
                <small>{disabled ? 'unavailable here' : item.hint}</small>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <div className="wallet-chip" title={session.address}>
            <strong>{session.entry.name}</strong>
            <span>{shorten(session.address, 12, 6)}</span>
            <span className="net-tag">{session.preset.label}</span>
          </div>
          <button className="ghost" onClick={() => void closeWallet()}>
            Switch wallet
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className={`sync-pill${synced ? ' ok' : ''}`}>
            <span className="dot" />
            {sync.tip === 0
              ? 'Connecting…'
              : synced
                ? `Synced · block ${sync.tip.toLocaleString()}`
                : `Scanning ${sync.height.toLocaleString()} / ${sync.tip.toLocaleString()}`}
          </div>
          <div className="topbar-actions">
            <button
              className={`ghost${concealAmounts ? ' active' : ''}`}
              onClick={() => setConcealAmounts(!concealAmounts)}
              title="Blur amounts (privacy screen). Hover an amount to reveal it."
            >
              {concealAmounts ? '◉ Amounts hidden' : '◎ Amounts visible'}
            </button>
            {session.entry.encrypted && (
              <button className="ghost" onClick={lock} disabled={locked} title="Forget the decrypted keys until unlocked again">
                {locked ? 'Locked' : 'Lock keys'}
              </button>
            )}
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
