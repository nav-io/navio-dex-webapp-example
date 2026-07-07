/**
 * Mint studio: token & NFT creation
 * =================================
 *
 * Navio assets live in two layers:
 *
 *   1. A COLLECTION — an on-chain declaration carrying metadata and a max
 *      supply, created with `createTokenCollection` (fungible) or
 *      `createNftCollection`. Its token id is derived from the metadata +
 *      supply, and minting authority belongs to a token key derived from
 *      this wallet's seed — only the creating wallet can mint into it.
 *
 *   2. MINTS into the collection — `mintToken` (amount of fungible units)
 *      or `mintNft` (one sub-id + per-NFT metadata each).
 *
 * Both steps are ordinary confidential transactions paying a NAV fee.
 * After the collection tx confirms, mint into it (the studio remembers
 * collections you created this session; you can also paste any collection
 * id you control from a previous session).
 */
import { FormEvent, useState } from 'react';
import { useWallet } from '../state/WalletContext';
import { shorten } from '../lib/format';
import { UnlockInline } from './Portfolio';

interface CreatedCollection {
  id: string;
  kind: 'token' | 'nft';
  name: string;
}

export function MintStudio() {
  const { session, refresh, log, locked, unlock } = useWallet();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [collections, setCollections] = useState<CreatedCollection[]>([]);
  if (!session) return null;

  async function guard(label: string, fn: () => Promise<void>) {
    if (locked) {
      setError('Wallet is locked — unlock it first');
      return;
    }
    setBusy(label);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy('');
    }
  }

  function onCreateCollection(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const kind = String(data.get('kind')) as 'token' | 'nft';
    const name = String(data.get('name') ?? 'Asset');
    const supply = Number(data.get('supply') || 0);
    void guard('collection', async () => {
      const metadata = { name };
      const result =
        kind === 'token'
          ? await session!.client.createTokenCollection({ metadata, totalSupply: supply })
          : await session!.client.createNftCollection({ metadata, totalSupply: supply });
      setCollections((prev) => [{ id: result.collectionTokenId, kind, name }, ...prev]);
      log('ok', `Created ${kind} collection "${name}"`, result.txId);
      form.reset();
    });
  }

  function onMint(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const collectionTokenId = String(data.get('collection') ?? '').trim();
    const kind = collections.find((c) => c.id === collectionTokenId)?.kind
      ?? (String(data.get('mintKind')) as 'token' | 'nft');
    void guard('mint', async () => {
      // Minting to your own address keeps the demo self-contained; any
      // BLSCT address works (e.g. mint directly to a buyer).
      const address = String(data.get('address') || session!.address);
      let txId: string;
      if (kind === 'token') {
        ({ txId } = await session!.client.mintToken({
          address,
          collectionTokenId,
          amount: BigInt(String(data.get('amount') || '0')),
        }));
      } else {
        ({ txId } = await session!.client.mintNft({
          address,
          collectionTokenId,
          nftId: BigInt(String(data.get('nftId') || '0')),
          metadata: { name: String(data.get('nftName') || 'NFT') },
        }));
      }
      log('ok', `Minted into ${shorten(collectionTokenId, 10, 4)}`, txId);
      form.reset();
    });
  }

  return (
    <div className="grid two">
      <section className="panel">
        <h2>1 · Create a collection</h2>
        <p className="hint">
          A collection declares the asset on-chain. Only this wallet's token key can mint into it.
        </p>
        <form onSubmit={onCreateCollection} className="stack">
          <label>
            Type
            <select name="kind">
              <option value="token">Fungible token</option>
              <option value="nft">NFT collection</option>
            </select>
          </label>
          <label>
            Name <small>(stored as on-chain metadata)</small>
            <input name="name" required placeholder="Demo Token" />
          </label>
          <label>
            Max supply <small>(base units; for NFT collections this is informational)</small>
            <input name="supply" type="number" min={1} defaultValue={1_000_000} />
          </label>
          <button className="primary" disabled={busy !== ''}>
            {busy === 'collection' ? 'Creating…' : 'Create collection'}
          </button>
        </form>
        {collections.length > 0 && (
          <>
            <h3>Created this session</h3>
            <ul className="stack-tight">
              {collections.map((c) => (
                <li key={c.id} className="mono" title={c.id}>
                  <span className="tag">{c.kind}</span> {c.name} · {shorten(c.id, 14, 6)}
                  <button className="ghost" onClick={() => void navigator.clipboard.writeText(c.id)}>copy id</button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="panel">
        <h2>2 · Mint into it</h2>
        <p className="hint">Wait for the collection transaction to confirm, then mint.</p>
        <form onSubmit={onMint} className="stack">
          <label>
            Collection token id
            <input
              name="collection"
              className="mono"
              required
              list="known-collections"
              placeholder="64-hex collection id"
            />
            <datalist id="known-collections">
              {collections.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </datalist>
          </label>
          <label>
            If pasting an id from elsewhere, its type
            <select name="mintKind">
              <option value="token">Fungible token</option>
              <option value="nft">NFT</option>
            </select>
          </label>
          <label>
            Destination address <small>(empty = this wallet)</small>
            <input name="address" className="mono" placeholder={shorten(session.address, 16, 8)} />
          </label>
          <label>
            Amount <small>(fungible mints, base units)</small>
            <input name="amount" type="number" min={1} defaultValue={1000} />
          </label>
          <div className="row gap">
            <label className="grow">
              NFT sub-id
              <input name="nftId" type="number" min={0} defaultValue={1} />
            </label>
            <label className="grow">
              NFT name
              <input name="nftName" placeholder="Piece #1" />
            </label>
          </div>
          <button className="primary" disabled={busy !== ''}>
            {busy === 'mint' ? 'Minting…' : 'Mint'}
          </button>
          {error && <p className="error">{error}</p>}
        </form>
        {locked && <UnlockInline unlock={unlock} />}
      </section>
    </div>
  );
}
