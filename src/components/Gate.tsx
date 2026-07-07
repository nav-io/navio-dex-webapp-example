/**
 * Gate: wallet list, create, restore, unlock
 * ==========================================
 *
 * "Login" in this app means opening a wallet whose encrypted database
 * already lives in the browser (IndexedDB) — no extension, no server-side
 * account. The flows:
 *
 *   Create   → NavioClient with `createWalletIfNotExists` generates a
 *              fresh BIP39 mnemonic; we show it ONCE for backup and set a
 *              password (Argon2id → AES-256-GCM inside the SDK).
 *   Restore  → `restoreFromMnemonic` + a rescan start height.
 *   Open     → initialize an existing wallet id and `unlock(password)`.
 *
 * The mnemonic is the wallet. Anyone with it can spend; losing it while
 * the browser profile is wiped loses the funds. The UI repeats this where
 * it matters instead of burying it in docs.
 */
import { FormEvent, useState } from 'react';
import { useWallet } from '../state/WalletContext';
import {
  NETWORK_PRESETS,
  NetworkPreset,
  WalletEntry,
  loadState,
  presetById,
  removeWallet,
} from '../lib/settings';

type Mode = 'list' | 'create' | 'restore' | 'backup';

export function Gate() {
  const { createWallet, openWallet, deleteWallet } = useWallet();
  const [mode, setMode] = useState<Mode>('list');
  const [wallets, setWallets] = useState<WalletEntry[]>(() => loadState().wallets);
  const [presetId, setPresetId] = useState(() => loadState().lastNetworkId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [backupWords, setBackupWords] = useState('');

  const preset: NetworkPreset = presetById(presetId);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const password = String(data.get('password') ?? '');
    if (password !== String(data.get('confirm') ?? '')) {
      setError('Passwords do not match');
      return;
    }
    void run(async () => {
      const words = await createWallet({
        name: String(data.get('name') || 'My wallet'),
        preset,
        password,
      });
      setBackupWords(words);
      setMode('backup');
    });
  }

  function onRestore(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    void run(async () => {
      await createWallet({
        name: String(data.get('name') || 'Restored wallet'),
        preset,
        password: String(data.get('password') ?? ''),
        mnemonic: String(data.get('mnemonic') ?? ''),
        restoreHeight: Number(data.get('height') || 0),
      });
    });
  }

  function onOpen(entry: WalletEntry, password: string) {
    void run(() => openWallet(entry, presetById(entry.networkId), password));
  }

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="gate-head">
          <span className="brand-mark big">◈</span>
          <h1>Navio DEX</h1>
          <p>
            An example decentralized exchange built on <code>navio-sdk</code>. The wallet lives in
            your browser; keys never leave it.
          </p>
        </div>

        {mode === 'list' && (
          <>
            {wallets.length === 0 ? (
              <p className="empty">No wallets in this browser yet. Create one to start.</p>
            ) : (
              <ul className="wallet-list">
                {wallets.map((w) => (
                  <WalletRow
                    key={w.id}
                    entry={w}
                    busy={busy}
                    onOpen={onOpen}
                    onDelete={() =>
                      void run(async () => {
                        await deleteWallet(w);
                        removeWallet(w.id);
                        setWallets(loadState().wallets);
                      })
                    }
                  />
                ))}
              </ul>
            )}
            <div className="row gap">
              <button className="primary" disabled={busy} onClick={() => setMode('create')}>
                Create wallet
              </button>
              <button disabled={busy} onClick={() => setMode('restore')}>
                Restore from mnemonic
              </button>
            </div>
          </>
        )}

        {(mode === 'create' || mode === 'restore') && (
          <form onSubmit={mode === 'create' ? onCreate : onRestore} className="stack">
            <label>
              Wallet name
              <input name="name" placeholder="My wallet" autoFocus />
            </label>
            <label>
              Network
              <select value={presetId} onChange={(e) => setPresetId(e.target.value)}>
                {NETWORK_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            {mode === 'restore' && (
              <>
                <label>
                  Recovery mnemonic
                  <textarea name="mnemonic" rows={3} required placeholder="24 words separated by spaces" />
                </label>
                <label>
                  Rescan from block height
                  <input name="height" type="number" min={0} defaultValue={0} />
                </label>
              </>
            )}
            <label>
              Password <small>(encrypts keys at rest in this browser)</small>
              <input name="password" type="password" required minLength={4} />
            </label>
            {mode === 'create' && (
              <label>
                Confirm password
                <input name="confirm" type="password" required minLength={4} />
              </label>
            )}
            <div className="row gap">
              <button className="primary" disabled={busy}>
                {busy ? 'Working…' : mode === 'create' ? 'Create wallet' : 'Restore wallet'}
              </button>
              <button type="button" disabled={busy} onClick={() => setMode('list')}>
                Back
              </button>
            </div>
          </form>
        )}

        {mode === 'backup' && (
          <div className="stack">
            <h2>Back up your mnemonic</h2>
            <p>
              These 24 words are the wallet. Write them down and store them offline — this is the
              only time the app shows them unprompted.
            </p>
            <pre className="mnemonic">{backupWords}</pre>
            <button className="primary" onClick={() => setMode('list')}>
              I saved my mnemonic
            </button>
          </div>
        )}

        {error && <p className="error">{error}</p>}
      </div>
      <footer className="gate-foot">
        Learning resource, not production software · <a href="https://github.com/nav-io/navio-sdk">navio-sdk</a>
      </footer>
    </div>
  );
}

function WalletRow({
  entry,
  busy,
  onOpen,
  onDelete,
}: {
  entry: WalletEntry;
  busy: boolean;
  onOpen: (entry: WalletEntry, password: string) => void;
  onDelete: () => void;
}) {
  const [password, setPassword] = useState('');
  return (
    <li className="wallet-row">
      <div>
        <strong>{entry.name}</strong>
        <small>{presetById(entry.networkId).label}</small>
      </div>
      {entry.encrypted && (
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onOpen(entry, password)}
        />
      )}
      <button className="primary" disabled={busy} onClick={() => onOpen(entry, password)}>
        Open
      </button>
      <button
        className="ghost danger"
        disabled={busy}
        title="Deletes this wallet's database from the browser. Only the mnemonic can bring it back."
        onClick={() => {
          if (confirm(`Delete "${entry.name}" from this browser? Only its mnemonic can restore it.`)) onDelete();
        }}
      >
        Delete
      </button>
    </li>
  );
}
