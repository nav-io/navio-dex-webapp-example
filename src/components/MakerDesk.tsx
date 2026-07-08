/**
 * Maker desk — the LIQUIDITY side of RFQ swaps
 * ============================================
 *
 * A maker has three tools, all demonstrated here:
 *
 *   Intents (setSwapIntent / listSwapIntents / clearSwapIntent)
 *     A standing offer registered on the CONNECTED DAEMON: "I pay out
 *     token X for token Y, size between A and B, at ≥ this price."
 *     Intents are configuration, not transactions — nothing is signed or
 *     locked. When a taker's broadcast RFQ matches one, the daemon queues
 *     it as a pending quote request. NOTE: intents live on the daemon and
 *     are shared by every client of the same ElectrumX server — fine for
 *     a personal or per-shop server, a real deployment would isolate them.
 *
 *   Pending requests (subscribePendingQuoteRequests → replyQuote)
 *     Matched taker requests waiting for an answer. `replyQuote` builds
 *     and signs YOUR half locally — spending your inventory, over-funding
 *     the network fee so the taker can accept fee-free — and sends it
 *     encrypted to the taker's one-time reply key. Auto-reply turns this
 *     wallet into a tiny market-making bot.
 *
 *   Standing orders (broadcastOrder)
 *     A fully signed half broadcast to the network and cached by peers
 *     for up to 14 days. Any node can hand it to a matching taker while
 *     you are OFFLINE. The coins it spends are NOT locked: spend them
 *     yourself and the order simply becomes unfillable.
 */
import { FormEvent, useEffect, useState } from 'react';
import type { PendingQuoteRequest, SwapIntent } from 'navio-sdk';
import { useWallet } from '../state/WalletContext';
import { minutesFromNow, parseIntegerUnits, shorten } from '../lib/format';
import { UnlockInline } from './Portfolio';
import { TokenField } from './TokenField';

export function MakerDesk() {
  const { session, refresh, log, locked, unlock } = useWallet();
  const [intents, setIntents] = useState<SwapIntent[]>([]);
  const [pending, setPending] = useState<PendingQuoteRequest[]>([]);
  const [autoReply, setAutoReply] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function loadIntents() {
    if (!session) return;
    try {
      setIntents(await session.client.listSwapIntents());
    } catch {
      /* bridge may be briefly unavailable */
    }
  }

  // Live pending-request feed: the ElectrumX bridge polls the daemon and
  // pushes the full updated list whenever it changes. Cleaner than the
  // client polling, and it survives reconnects.
  useEffect(() => {
    if (!session) return;
    let disposed = false;
    void session.client
      .subscribePendingQuoteRequests((list) => {
        if (!disposed) setPending(list);
      })
      .then((initial) => {
        if (!disposed) setPending(initial);
      })
      .catch(() => undefined);
    void loadIntents();
    return () => {
      disposed = true;
      void session.client.unsubscribePendingQuoteRequests().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Auto-reply: answer every pending request at your intent's price.
  // This is the whole "market-maker bot" — one effect.
  useEffect(() => {
    if (!autoReply || pending.length === 0 || locked) return;
    void (async () => {
      for (const request of pending) {
        try {
          const res = await session!.client.replyQuote({ request });
          log('ok', `Auto-replied to ${shorten(request.uuid, 8, 4)} (quote ${shorten(res.quoteId, 8, 4)})`);
        } catch (err: any) {
          log('error', `Auto-reply failed: ${err?.message ?? err}`);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoReply, pending, locked]);

  if (!session) return null;

  function guarded(label: string, fn: () => Promise<void>) {
    void (async () => {
      if (locked) {
        setError('Wallet is locked — unlock it first');
        return;
      }
      setBusy(label);
      setError('');
      try {
        await fn();
      } catch (err: any) {
        setError(err?.message ?? String(err));
      } finally {
        setBusy('');
      }
    })();
  }

  function tokenIdOrNull(value: string): string | null {
    const v = value.trim();
    return v === '' || v.toLowerCase() === 'nav' ? null : v;
  }

  function onCreateIntent(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    guarded('intent', async () => {
      const id = await session!.client.setSwapIntent({
        tokenInId: tokenIdOrNull(String(data.get('tokenIn') ?? '')),
        tokenOutId: tokenIdOrNull(String(data.get('tokenOut') ?? '')),
        minSize: parseIntegerUnits(String(data.get('min') ?? '1')),
        maxSize: parseIntegerUnits(String(data.get('max') ?? '1')),
        // Price is sell-units per buy-unit scaled by 1e8: "10000000" = 0.1.
        priceMin: parseIntegerUnits(String(data.get('price') ?? '0')),
        expiry: minutesFromNow(Number(data.get('hours') || 1) * 60),
      });
      log('ok', `Intent #${id} registered on the daemon`);
      form.reset();
      await loadIntents();
    });
  }

  function onReply(request: PendingQuoteRequest) {
    guarded(request.uuid, async () => {
      const res = await session!.client.replyQuote({ request });
      log('ok', `Quote ${shorten(res.quoteId, 8, 4)} sent (fee over-funded: ${res.fee})`);
    });
  }

  function onBroadcastOrder(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    guarded('order', async () => {
      const res = await session!.client.broadcastOrder({
        offerTokenId: tokenIdOrNull(String(data.get('offerToken') ?? '')),
        offerAmount: parseIntegerUnits(String(data.get('offerAmount') ?? '0')),
        wantTokenId: tokenIdOrNull(String(data.get('wantToken') ?? '')),
        wantAmount: parseIntegerUnits(String(data.get('wantAmount') ?? '0')),
        expiry: minutesFromNow(Number(data.get('days') || 1) * 24 * 60),
      });
      log('ok', `Standing order ${shorten(res.quoteId, 8, 4)} broadcast — peers now cache it`);
      form.reset();
      await refresh();
    });
  }

  return (
    <div className="stack">
      <div className="grid two">
        <section className="panel">
          <h2>Advertise an intent</h2>
          <p className="hint">
            Configuration only — nothing is signed until a request matches and you (or auto-reply)
            answer it.
          </p>
          <form onSubmit={onCreateIntent} className="stack">
            <TokenField
              name="tokenIn"
              label="You deliver"
              hint="token id, or NAV"
              required
              placeholder="token id you sell"
            />
            <TokenField name="tokenOut" label="You receive" placeholder="NAV" />
            <div className="row gap">
              <label className="grow">Min fill<input name="min" defaultValue="1" /></label>
              <label className="grow">Max fill<input name="max" defaultValue="10000" /></label>
            </div>
            <div className="row gap">
              <label className="grow">
                Min price <small>(receive-units per deliver-unit × 1e8)</small>
                <input name="price" defaultValue="10000000" />
              </label>
              <label className="grow">
                Valid for (hours)
                <input name="hours" type="number" min={1} defaultValue={12} />
              </label>
            </div>
            <button className="primary" disabled={busy !== ''}>
              {busy === 'intent' ? 'Registering…' : 'Register intent'}
            </button>
          </form>
        </section>

        <section className="panel">
          <div className="row spread">
            <h2>Pending quote requests</h2>
            <label className="toggle" title="Answer every matched request automatically at your intent price">
              <input type="checkbox" checked={autoReply} onChange={(e) => setAutoReply(e.target.checked)} />
              Auto-reply
            </label>
          </div>
          {pending.length === 0 ? (
            <p className="empty">
              When a taker's RFQ matches one of your intents it appears here for you to answer.
            </p>
          ) : (
            <table>
              <thead>
                <tr><th>Request</th><th className="num">Deliver</th><th className="num">Receive</th><th /></tr>
              </thead>
              <tbody>
                {pending.map((p) => (
                  <tr key={p.uuid}>
                    <td className="mono">{shorten(p.uuid, 10, 4)}</td>
                    <td className="num">{p.fill.toString()}</td>
                    <td className="num">{p.sellCost.toString()}</td>
                    <td className="num">
                      <button className="primary" disabled={busy !== ''} onClick={() => onReply(p)}>
                        {busy === p.uuid ? 'Signing…' : 'Send quote'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {error && <p className="error">{error}</p>}
          {locked && <UnlockInline unlock={unlock} />}
        </section>
      </div>

      <div className="grid two">
        <section className="panel">
          <h2>Your intents on this daemon</h2>
          {intents.length === 0 ? (
            <p className="empty">No intents registered.</p>
          ) : (
            <table>
              <thead>
                <tr><th>#</th><th>Deliver</th><th>Receive</th><th className="num">Size</th><th className="num">Min price</th><th /></tr>
              </thead>
              <tbody>
                {intents.map((it) => (
                  <tr key={it.id}>
                    <td>{it.id}</td>
                    <td className="mono">{it.tokenIn ? shorten(it.tokenIn, 8, 4) : 'NAV'}</td>
                    <td className="mono">{it.tokenOut ? shorten(it.tokenOut, 8, 4) : 'NAV'}</td>
                    <td className="num">{it.minSize.toString()}–{it.maxSize.toString()}</td>
                    <td className="num">{it.priceMin.toString()}</td>
                    <td className="num">
                      <button
                        className="ghost danger"
                        onClick={() =>
                          guarded('clear', async () => {
                            await session!.client.clearSwapIntent(it.id);
                            await loadIntents();
                          })
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel">
          <h2>Publish a standing order</h2>
          <p className="hint">
            A pre-signed half cached by the whole network — fillable while you're offline. Don't
            spend the inventory it commits, or the order dies quietly.
          </p>
          <form onSubmit={onBroadcastOrder} className="stack">
            <div className="row gap">
              <TokenField
                name="offerToken"
                label="You offer"
                hint="token id / NAV"
                required
                className="grow"
              />
              <label className="grow">Amount<input name="offerAmount" required placeholder="100" /></label>
            </div>
            <div className="row gap">
              <TokenField name="wantToken" label="You want" placeholder="NAV" className="grow" />
              <label className="grow">Amount<input name="wantAmount" required placeholder="10" /></label>
            </div>
            <label>
              Valid for (days, network caps at 14)
              <input name="days" type="number" min={1} max={14} defaultValue={7} />
            </label>
            <button className="primary" disabled={busy !== ''}>
              {busy === 'order' ? 'Signing & broadcasting…' : 'Broadcast order'}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
