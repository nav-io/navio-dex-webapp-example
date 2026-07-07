/**
 * Portfolio: balances, receive, send
 * ==================================
 *
 * Everything here reads from the wallet's local scan and writes through
 * three SDK calls:
 *
 *   client.sendTransaction({ address, amount })          — NAV
 *   client.sendToken({ address, amount, tokenId })       — fungible tokens
 *   client.sendNft({ address, tokenId })                 — NFTs
 *
 * Sends build a full confidential transaction locally (coin selection,
 * range proofs, BLS signatures) and broadcast it through the Electrum
 * server. The fee is always paid in NAV, so token sends need a little NAV
 * alongside the token balance.
 */
import { FormEvent, useState } from 'react';
import { useWallet } from '../state/WalletContext';
import { Amount } from './Amount';
import { formatTime, parseUnits, parseIntegerUnits, shorten } from '../lib/format';

export function Portfolio() {
  const { session, navBalance, balances, activity, refresh, log, locked, unlock } = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  if (!session) return null;

  const tokens = balances.filter((b) => b.kind === 'token');
  const nfts = balances.filter((b) => b.kind === 'nft');

  async function onSend(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const address = String(data.get('address') ?? '').trim();
    const asset = String(data.get('asset') ?? 'nav');
    setBusy(true);
    setError('');
    try {
      if (locked) throw new Error('Wallet is locked — unlock it below first');
      let txId: string;
      if (asset === 'nav') {
        const amount = parseUnits(String(data.get('amount') ?? ''));
        ({ txId } = await session!.client.sendTransaction({ address, amount }));
      } else {
        const balance = balances.find((b) => b.tokenId === asset);
        if (!balance) throw new Error('Unknown asset');
        if (balance.kind === 'nft') {
          ({ txId } = await session!.client.sendNft({ address, tokenId: balance.tokenId }));
        } else {
          const amount = parseIntegerUnits(String(data.get('amount') ?? ''));
          ({ txId } = await session!.client.sendToken({ address, amount, tokenId: balance.tokenId }));
        }
      }
      log('ok', `Sent to ${shorten(address)}`, txId);
      form.reset();
      await refresh();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid two">
      <section className="panel">
        <h2>Balances</h2>
        <div className="balance-hero">
          <Amount units={navBalance} suffix="NAV" />
        </div>
        <h3>Tokens</h3>
        {tokens.length === 0 ? (
          <p className="empty">No tokens yet. Mint one in the Mint studio, or buy one on Trade.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Token</th><th className="num">Balance</th><th className="num">Outputs</th></tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.tokenId}>
                  <td className="mono" title={t.tokenId}>{shorten(t.tokenId, 14, 6)}</td>
                  <td className="num"><Amount units={t.balance} decimals={0} /></td>
                  <td className="num">{t.outputCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <h3>NFTs</h3>
        {nfts.length === 0 ? (
          <p className="empty">No NFTs in this wallet.</p>
        ) : (
          <ul className="nft-list">
            {nfts.map((n) => (
              <li key={n.tokenId} className="mono" title={n.tokenId}>
                {shorten(n.collectionTokenId ?? n.tokenId, 12, 4)} <span className="tag">#{String(n.nftId)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="stack">
        <section className="panel">
          <h2>Receive</h2>
          <p className="hint">
            Your primary BLSCT address. Every payment to it is unlinkable on-chain; the wallet
            finds incoming outputs by scanning with its view key.
          </p>
          <div className="address-box mono">{session.address}</div>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(session.address);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? 'Copied' : 'Copy address'}
          </button>
        </section>

        <section className="panel">
          <h2>Send</h2>
          <form onSubmit={onSend} className="stack">
            <label>
              Recipient address
              <input name="address" required placeholder="nv1… / tnv1… / rnv1…" className="mono" />
            </label>
            <label>
              Asset
              <select name="asset">
                <option value="nav">NAV</option>
                {tokens.map((t) => (
                  <option key={t.tokenId} value={t.tokenId}>Token {shorten(t.tokenId, 10, 4)}</option>
                ))}
                {nfts.map((n) => (
                  <option key={n.tokenId} value={n.tokenId}>NFT {shorten(n.tokenId, 10, 4)} #{String(n.nftId)}</option>
                ))}
              </select>
            </label>
            <label>
              Amount <small>(NAV in coins; tokens in base units; ignored for NFTs)</small>
              <input name="amount" placeholder="1.5" />
            </label>
            <button className="primary" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
            {error && <p className="error">{error}</p>}
          </form>
          {locked && <UnlockInline unlock={unlock} />}
        </section>

        <section className="panel">
          <h2>Activity</h2>
          {activity.length === 0 ? (
            <p className="empty">Session activity shows up here.</p>
          ) : (
            <ul className="activity">
              {activity.slice(0, 12).map((a, i) => (
                <li key={i} className={a.kind}>
                  <time>{formatTime(Math.floor(a.time / 1000))}</time>
                  <span>{a.text}</span>
                  {a.txId && session.explorer.txUrl(a.txId) ? (
                    <a href={session.explorer.txUrl(a.txId)!} target="_blank" rel="noreferrer" className="mono">
                      {shorten(a.txId, 8, 4)}
                    </a>
                  ) : a.txId ? (
                    <span className="mono">{shorten(a.txId, 8, 4)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

export function UnlockInline({ unlock }: { unlock: (password: string) => Promise<boolean> }) {
  const [pw, setPw] = useState('');
  const [failed, setFailed] = useState(false);
  return (
    <div className="row gap unlock-inline">
      <input
        type="password"
        placeholder="Password to unlock"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
      />
      <button
        onClick={() => {
          void unlock(pw).then((ok) => setFailed(!ok));
          setPw('');
        }}
      >
        Unlock
      </button>
      {failed && <span className="error">Wrong password</span>}
    </div>
  );
}
