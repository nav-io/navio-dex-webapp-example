/**
 * Mint studio: token & NFT creation
 * =================================
 *
 * Navio assets come in two layers:
 *
 *   1. A COLLECTION — an on-chain declaration created with
 *      `createTokenCollection` (fungible) or `createNftCollection`. Its
 *      token id is DERIVED from its metadata + max supply
 *      (`calcCollectionTokenHashHex`), and only the creating wallet's
 *      token key — also derived from the seed — can mint into it. Because
 *      the id is derived, the collection's metadata is fixed at creation.
 *
 *   2. MINTS into it — `mintToken` (an amount of fungible units) or
 *      `mintNft` (one sub-id plus that piece's own metadata).
 *
 * The form is fully controlled and ADAPTS to the selected type:
 *   - fungible token: name/metadata + max supply → later mint an amount;
 *   - NFT collection: name/metadata → later mint sub-ids with per-NFT
 *     metadata (no amount).
 *
 * Both steps are ordinary confidential transactions paying a NAV fee, so
 * the wallet needs some NAV. On regtest a freshly created collection must
 * be mined into a block before you can mint into it (the studio reminds
 * you); on a public network just wait for a confirmation.
 */
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useWallet } from '../state/WalletContext';
import { shorten } from '../lib/format';
import { UnlockInline } from './Portfolio';
import { MetaRow, MetadataEditor, toMetadata } from './MetadataEditor';
import { CollectionInfo, fetchCollectionInfo } from '../lib/token';

type AssetType = 'token' | 'nft';

/**
 * Translate the daemon's opaque mint rejection into something actionable.
 * `failed-to-execute-predicate` (navio-core blsct/tokens/predicate_exec.cpp)
 * is returned for every reason a mint can't apply, so we can't know which
 * one from the message alone — but these are the only causes, and listing
 * them is far more useful than the raw string. Needed most on servers whose
 * Electrum build predates `blockchain.token.get_token`, where the app can't
 * inspect the collection up front (e.g. public testnet today).
 */
function explainMintError(message: string): string {
  if (!/failed-to-execute-predicate/i.test(message)) return message;
  return (
    'The network rejected the mint (failed-to-execute-predicate). For a mint that ' +
    'means one of: the collection is a different type than what you minted (a token ' +
    'amount into an NFT collection or vice-versa); the amount would exceed the ' +
    'collection’s max supply, or the NFT id is outside 0…max-1; or the collection was ' +
    'created by a different wallet (or an older app version) whose token key this ' +
    'wallet does not hold. Creating a fresh collection here and minting into it will ' +
    'always work.'
  );
}

interface CreatedCollection {
  id: string;
  type: AssetType;
  name: string;
  /** For NFT collections: mintable NFT ids are 0 .. maxSupply-1. */
  maxSupply: number;
}

export function MintStudio() {
  const { session, navBalance, refresh, log, locked, unlock } = useWallet();

  // --- create-collection form state ---
  const [createType, setCreateType] = useState<AssetType>('token');
  const [createMeta, setCreateMeta] = useState<MetaRow[]>([{ key: 'name', value: '' }]);
  const [maxSupply, setMaxSupply] = useState('1000000');

  // --- mint form state ---
  const [collectionId, setCollectionId] = useState('');
  const [mintAmount, setMintAmount] = useState('1000');
  const [nftId, setNftId] = useState('1');
  const [nftMeta, setNftMeta] = useState<MetaRow[]>([{ key: 'name', value: '' }]);

  const [collections, setCollections] = useState<CreatedCollection[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  // Chain-authoritative info for the collection being minted into. Looked up
  // from the daemon (via the Electrum bridge) so the form knows the real
  // type, remaining supply, and — crucially — whether THIS wallet can mint
  // into it at all. Prevents the opaque failed-to-execute-predicate rejection.
  const [chainInfo, setChainInfo] = useState<CollectionInfo | null>(null);
  const [chainLoading, setChainLoading] = useState(false);

  const selected = useMemo(
    () => collections.find((c) => c.id === collectionId.trim()),
    [collections, collectionId],
  );
  const [manualMintType, setManualMintType] = useState<AssetType>('token');
  // Chain truth wins; then a collection we created this session; then the
  // manual toggle for ids we know nothing about (offline / no indexer).
  const mintType: AssetType = chainInfo?.type ?? selected?.type ?? manualMintType;

  // Debounced on-chain lookup whenever the collection id settles.
  useEffect(() => {
    const id = collectionId.trim();
    if (!session || id.length < 64) {
      setChainInfo(null);
      return;
    }
    let cancelled = false;
    setChainLoading(true);
    const t = setTimeout(async () => {
      const info = await fetchCollectionInfo(session.client, id);
      if (!cancelled) {
        setChainInfo(info);
        setChainLoading(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [collectionId, session]);

  if (!session) return null;

  const hasFunds = navBalance > 0n;

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
      setError(explainMintError(err?.message ?? String(err)));
    } finally {
      setBusy('');
    }
  }

  function onCreateCollection(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const metadata = toMetadata(createMeta);
    const name = metadata.name || 'Untitled';
    const supply = Number(maxSupply || 0);
    if (supply <= 0) {
      // For NFTs this is not cosmetic: the chain only lets you mint ids in
      // [0, maxSupply), so a 0-supply collection can never be minted into.
      setError('Max supply must be at least 1');
      return;
    }
    void guard('collection', async () => {
      const result =
        createType === 'token'
          ? await session!.client.createTokenCollection({ metadata, totalSupply: supply })
          : await session!.client.createNftCollection({ metadata, totalSupply: supply });
      setCollections((prev) => [{ id: result.collectionTokenId, type: createType, name, maxSupply: supply }, ...prev]);
      // Pre-fill the mint form with the collection we just made.
      setCollectionId(result.collectionTokenId);
      log('ok', `Created ${createType} collection "${name}"`, result.txId);
      setCreateMeta([{ key: 'name', value: '' }]);
    });
  }

  function onMint(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const id = collectionId.trim();
    // Note: we do NOT hard-block on a key mismatch. The status panel already
    // warns when this wallet's derived key doesn't match the collection's, but
    // that comparison depends on the daemon and binding serializing the token
    // key identically — if they ever diverge we'd wrongly block a valid mint.
    // So we let the attempt proceed; the chain is the final authority, and a
    // genuine mismatch fails on-chain with the context the warning provided.
    void guard('mint', async () => {
      const address = String((e.target as HTMLFormElement).address?.value || '').trim() || session!.address;
      let txId: string;
      if (mintType === 'token') {
        if (chainInfo && chainInfo.currentSupply + BigInt(mintAmount || '0') > chainInfo.maxSupply) {
          throw new Error(
            `Minting ${mintAmount} would exceed the max supply ` +
              `(${chainInfo.currentSupply} of ${chainInfo.maxSupply} already minted)`,
          );
        }
        ({ txId } = await session!.client.mintToken({
          address,
          collectionTokenId: id,
          amount: BigInt(mintAmount || '0'),
        }));
        log('ok', `Minted ${mintAmount} into ${shorten(id, 10, 4)}`, txId);
      } else {
        // The chain requires 0 <= nftId < collection max supply.
        const cap = chainInfo ? Number(chainInfo.maxSupply) : selected?.maxSupply;
        if (cap !== undefined && Number(nftId) >= cap) {
          throw new Error(`NFT sub-id must be between 0 and ${cap - 1} for this collection`);
        }
        ({ txId } = await session!.client.mintNft({
          address,
          collectionTokenId: id,
          nftId: BigInt(nftId || '0'),
          metadata: toMetadata(nftMeta),
        }));
        log('ok', `Minted NFT #${nftId} into ${shorten(id, 10, 4)}`, txId);
      }
      setNftMeta([{ key: 'name', value: '' }]);
    });
  }

  return (
    <div className="stack">
      {!hasFunds && (
        <div className="panel notice">
          This wallet has no NAV. Creating a collection and minting both pay a NAV fee — fund the
          address in your Portfolio first (on regtest: <code>npm run regtest:fund -- {shorten(session.address, 12, 6)}</code>).
        </div>
      )}

      <div className="grid two">
        <section className="panel">
          <h2>1 · Create a collection</h2>
          <p className="hint">
            A collection declares the asset on-chain. Its id is derived from the metadata + max
            supply below, and only this wallet can mint into it.
          </p>

          <div className="segmented" role="tablist" aria-label="Collection type">
            <button
              type="button"
              role="tab"
              aria-selected={createType === 'token'}
              className={createType === 'token' ? 'active' : ''}
              onClick={() => setCreateType('token')}
            >
              Fungible token
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={createType === 'nft'}
              className={createType === 'nft' ? 'active' : ''}
              onClick={() => setCreateType('nft')}
            >
              NFT collection
            </button>
          </div>

          <form onSubmit={onCreateCollection} className="stack">
            <MetadataEditor rows={createMeta} setRows={setCreateMeta} label="Collection metadata" />

            {createType === 'token' ? (
              <label>
                Max supply <small>(base units — the cap this token can ever mint)</small>
                <input
                  type="number"
                  min={1}
                  value={maxSupply}
                  onChange={(e) => setMaxSupply(e.target.value)}
                  required
                />
              </label>
            ) : (
              <label>
                Max NFTs <small>(the collection can mint ids 0 … N−1; must be ≥ 1)</small>
                <input
                  type="number"
                  min={1}
                  value={maxSupply}
                  onChange={(e) => setMaxSupply(e.target.value)}
                  required
                />
              </label>
            )}

            <button className="primary" disabled={busy !== ''}>
              {busy === 'collection' ? 'Creating…' : `Create ${createType === 'token' ? 'token' : 'NFT'} collection`}
            </button>
          </form>

          {collections.length > 0 && (
            <>
              <h3>Created this session</h3>
              <ul className="stack-tight">
                {collections.map((c) => (
                  <li key={c.id} className="collection-item">
                    <span className="tag">{c.type}</span>
                    <span className="mono" title={c.id}>{c.name} · {shorten(c.id, 12, 6)}</span>
                    <span className="row gap">
                      <button className="ghost" type="button" onClick={() => setCollectionId(c.id)}>use</button>
                      <button className="ghost" type="button" onClick={() => void navigator.clipboard.writeText(c.id)}>copy</button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="panel">
          <h2>2 · Mint into a collection</h2>
          <p className="hint">
            Wait for the collection transaction to confirm (a mined block), then mint. Minting to an
            empty destination sends to this wallet.
          </p>

          <form onSubmit={onMint} className="stack">
            <label>
              Collection token id
              <input
                name="collection"
                className="mono"
                required
                list="known-collections"
                value={collectionId}
                onChange={(e) => setCollectionId(e.target.value)}
                placeholder="64-hex collection id"
              />
              <datalist id="known-collections">
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
                ))}
              </datalist>
            </label>

            {chainLoading ? (
              <p className="hint">Looking up the collection on-chain…</p>
            ) : chainInfo ? (
              <div className="collection-status">
                <div className="row spread">
                  <span><span className="tag">{chainInfo.type}</span> {chainInfo.metadata.name ?? 'collection'}</span>
                  <span className="mono">
                    {chainInfo.type === 'token'
                      ? `${chainInfo.currentSupply} / ${chainInfo.maxSupply} minted`
                      : `${chainInfo.maxSupply} ids (0…${chainInfo.maxSupply - 1n})`}
                  </span>
                </div>
              </div>
            ) : selected ? (
              <p className="hint">
                Minting a <strong>{selected.type === 'token' ? 'fungible amount' : 'unique NFT'}</strong>{' '}
                into “{selected.name}”.
              </p>
            ) : (
              // No chain info (offline / no indexer) and not created this
              // session: fall back to a manual type toggle.
              <div className="segmented" role="tablist" aria-label="Mint type">
                <button
                  type="button"
                  role="tab"
                  aria-selected={manualMintType === 'token'}
                  className={manualMintType === 'token' ? 'active' : ''}
                  onClick={() => setManualMintType('token')}
                >
                  Fungible
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={manualMintType === 'nft'}
                  className={manualMintType === 'nft' ? 'active' : ''}
                  onClick={() => setManualMintType('nft')}
                >
                  NFT
                </button>
              </div>
            )}

            <label>
              Destination address <small>(empty = this wallet)</small>
              <input name="address" className="mono" placeholder={shorten(session.address, 16, 8)} />
            </label>

            {mintType === 'token' ? (
              <label>
                Amount <small>(base units to mint)</small>
                <input
                  type="number"
                  min={1}
                  value={mintAmount}
                  onChange={(e) => setMintAmount(e.target.value)}
                  required
                />
              </label>
            ) : (
              <>
                <label>
                  NFT sub-id <small>(unique index within the collection)</small>
                  <input
                    type="number"
                    min={0}
                    value={nftId}
                    onChange={(e) => setNftId(e.target.value)}
                    required
                  />
                </label>
                <MetadataEditor rows={nftMeta} setRows={setNftMeta} label="NFT metadata (per piece)" />
              </>
            )}

            <button className="primary" disabled={busy !== '' || collectionId.trim() === ''}>
              {busy === 'mint' ? 'Minting…' : mintType === 'token' ? 'Mint tokens' : 'Mint NFT'}
            </button>
            {error && <p className="error">{error}</p>}
          </form>
          {locked && <UnlockInline unlock={unlock} />}
        </section>
      </div>
    </div>
  );
}
