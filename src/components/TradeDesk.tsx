/**
 * Trade desk — the TAKER side of an RFQ atomic swap
 * =================================================
 *
 * How a swap works on Navio (no order book, no custodian, no contract):
 *
 *   1. requestQuote(...)   The daemon broadcasts your request-for-quote
 *                          over the encrypted p2p message bus. It names
 *                          the pair and size — never your identity. A
 *                          fresh reply key means quotes can't be linked
 *                          to your other requests.
 *
 *   2. listQuotes(uuid)    Makers whose advertised intents match answer
 *                          with signed quotes, each carrying a pre-signed
 *                          HALF-TRANSACTION. Poll and rank; cheapest
 *                          first.
 *
 *   3. acceptQuote(...)    The SDK builds YOUR half locally: it spends
 *                          your sell-side coins and adds an output that
 *                          receives the buy side. Each half is unbalanced
 *                          on its own — the two halves only balance
 *                          TOGETHER, and BLS signature aggregation glues
 *                          them into one valid transaction. Either the
 *                          whole swap confirms or nothing moves: atomic
 *                          by construction.
 *
 * The `maxPay` / `minRecv` bounds passed to acceptQuote are enforced by
 * the SDK before signing and are your ONLY protection against a hostile
 * quote — the chain guarantees atomicity, not a fair price. This UI
 * derives them from your slippage setting rather than letting them float.
 */
import { FormEvent, useEffect, useRef, useState } from 'react';
import type { QuoteSummary } from 'navio-sdk';
import { useWallet } from '../state/WalletContext';
import { minutesFromNow, parseIntegerUnits, shorten } from '../lib/format';
import { UnlockInline } from './Portfolio';
import { TokenField } from './TokenField';

interface OpenRequest {
  uuid: string;
  buyTokenId: string | null;
  sellTokenId: string | null;
  amount: bigint;
  expiry: number;
}

export function TradeDesk() {
  const { session, refresh, log, locked, unlock } = useWallet();
  const [request, setRequest] = useState<OpenRequest | null>(null);
  const [quotes, setQuotes] = useState<QuoteSummary[]>([]);
  const [slippagePct, setSlippagePct] = useState(1);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll collected quotes every few seconds while a request is open.
  // Quotes arrive asynchronously over the p2p bus; there is no push
  // channel for the taker, so polling is the honest model.
  useEffect(() => {
    if (!request || !session) return;
    const poll = async () => {
      try {
        setQuotes(await session.client.listQuotes(request.uuid));
      } catch {
        /* transient */
      }
    };
    void poll();
    pollRef.current = setInterval(poll, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [request, session]);

  if (!session) return null;

  function tokenIdOrNull(value: string): string | null {
    const v = value.trim();
    return v === '' || v.toLowerCase() === 'nav' ? null : v;
  }

  function onRequest(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    void (async () => {
      setBusy('request');
      setError('');
      try {
        const buyTokenId = tokenIdOrNull(String(data.get('buy') ?? ''));
        const sellTokenId = tokenIdOrNull(String(data.get('sell') ?? ''));
        const amount = parseIntegerUnits(String(data.get('amount') ?? ''));
        const expiry = minutesFromNow(Number(data.get('window') || 5));
        const res = await session!.client.requestQuote({ buyTokenId, sellTokenId, amount, expiry });
        setQuotes([]);
        setRequest({ uuid: res.uuid, buyTokenId, sellTokenId, amount, expiry });
        log('info', `Quote request ${shorten(res.uuid, 8, 4)} broadcast — collecting maker quotes`);
      } catch (err: any) {
        setError(err?.message ?? String(err));
      } finally {
        setBusy('');
      }
    })();
  }

  function onAccept(quote: QuoteSummary) {
    if (!request) return;
    void (async () => {
      setBusy(quote.quoteId);
      setError('');
      try {
        if (locked) throw new Error('Wallet is locked — unlock it below first');
        // Slippage bounds: accept only if the maker charges at most
        // quoted-price × (1 + slippage) and delivers the full amount.
        const maxPay = quote.sellCost + (quote.sellCost * BigInt(Math.round(slippagePct * 100))) / 10_000n;
        const result = await session!.client.acceptQuote({
          uuid: request.uuid,
          quoteId: quote.quoteId,
          buyTokenId: request.buyTokenId,
          sellTokenId: request.sellTokenId,
          maxPay,
          minRecv: request.amount,
        });
        log('ok', `Swap broadcast — paying ${result.quote.sellCost} for ${result.quote.fill}`, result.txId);
        setRequest(null);
        setQuotes([]);
        await refresh();
      } catch (err: any) {
        setError(err?.message ?? String(err));
      } finally {
        setBusy('');
      }
    })();
  }

  function onCancel() {
    if (!request) return;
    void session!.client.cancelQuoteRequest(request.uuid).catch(() => undefined);
    setRequest(null);
    setQuotes([]);
    log('info', 'Quote request cancelled');
  }

  return (
    <div className="grid two">
      <section className="panel">
        <h2>Request quotes</h2>
        <p className="hint">
          Broadcasts an anonymous request-for-quote to every maker on the network. Use token ids
          (64-hex), or <code>NAV</code> / empty for the native coin.
        </p>
        <form onSubmit={onRequest} className="stack">
          <TokenField name="buy" label="Buy" hint="what you want to receive" />
          <TokenField name="sell" label="Pay with" placeholder="NAV" />
          <label>
            Amount to buy <small>(base units)</small>
            <input name="amount" required placeholder="500" />
          </label>
          <div className="row gap">
            <label className="grow">
              Collection window (minutes)
              <input name="window" type="number" min={1} max={60} defaultValue={5} />
            </label>
            <label className="grow">
              Max slippage %
              <input
                type="number"
                min={0}
                max={50}
                step={0.5}
                value={slippagePct}
                onChange={(e) => setSlippagePct(Number(e.target.value))}
              />
            </label>
          </div>
          <div className="row gap">
            <button className="primary" disabled={busy !== '' || request !== null}>
              {busy === 'request' ? 'Broadcasting…' : 'Request quotes'}
            </button>
            {request && (
              <button type="button" onClick={onCancel}>Cancel request</button>
            )}
          </div>
          {error && <p className="error">{error}</p>}
        </form>
        {locked && <UnlockInline unlock={unlock} />}
      </section>

      <section className="panel">
        <div className="row spread">
          <h2>Quotes</h2>
          {request && <span className="tag live">collecting · {shorten(request.uuid, 8, 4)}</span>}
        </div>
        {!request ? (
          <p className="empty">Open a request to start collecting quotes from makers.</p>
        ) : quotes.length === 0 ? (
          <p className="empty">
            Waiting for makers… Quotes arrive over the p2p bus within a few seconds when a maker's
            advertised intent matches your pair and size.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Maker delivers</th>
                <th>You pay</th>
                <th className="num">Unit price</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {quotes.map((q, i) => (
                <tr key={q.quoteId} className={i === 0 ? 'best' : ''}>
                  <td className="num">{q.fill.toString()}</td>
                  <td className="num">{q.sellCost.toString()}</td>
                  <td className="num">{q.price.toPrecision(4)}</td>
                  <td className="num">
                    <button
                      className="primary"
                      disabled={busy !== ''}
                      onClick={() => onAccept(q)}
                      title="Builds and signs your half locally, then broadcasts the combined atomic swap"
                    >
                      {busy === q.quoteId ? 'Swapping…' : i === 0 ? 'Accept best' : 'Accept'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
