/**
 * App settings & wallet registry (localStorage)
 * =============================================
 *
 * What lives in localStorage and what does NOT:
 *
 *  - localStorage: the list of wallet ids/names, whether each is password
 *    protected, and the selected network preset. NO key material, ever.
 *  - IndexedDB (one database per wallet, managed by navio-sdk): the seed,
 *    derived keys, and the scanned output set. When a password is set, the
 *    SDK encrypts key material with Argon2id + AES-256-GCM before it is
 *    written.
 *
 * This split means clearing localStorage "forgets" the wallet list but the
 * wallet databases survive; deleting a wallet removes its IndexedDB too.
 *
 * Network presets: the app is network-agnostic. Each preset names an
 * ElectrumX endpoint (WebSocket) and, optionally, a block-explorer API used
 * for public listings. Trading requires an ElectrumX that carries the RFQ
 * bridge (nav-io/electrumx#2) connected to a daemon with `-p2pmsg=1`; the
 * app feature-detects this per session and degrades gracefully.
 */

export interface NetworkPreset {
  id: string;
  label: string;
  network: 'mainnet' | 'testnet' | 'regtest';
  electrum: { host: string; port: number; ssl: boolean };
  /** blocks.nav.io style explorer API base, or null when unavailable. */
  explorerApi: string | null;
}

export const NETWORK_PRESETS: NetworkPreset[] = [
  {
    id: 'testnet',
    label: 'Testnet (public)',
    network: 'testnet',
    electrum: { host: 'testnet.nav.io', port: 50005, ssl: window.location.protocol === 'https:' },
    explorerApi: 'https://blocks.nav.io/api/testnet',
  },
  {
    id: 'regtest',
    label: 'Local regtest (scripts/regtest-up.sh)',
    network: 'regtest',
    electrum: { host: '127.0.0.1', port: 50005, ssl: false },
    explorerApi: null,
  },
];

export interface WalletEntry {
  id: string;
  name: string;
  encrypted: boolean;
  networkId: string;
  createdAt: number;
}

interface StoredState {
  wallets: WalletEntry[];
  lastNetworkId: string;
}

const STORAGE_KEY = 'navio-dex-example';

export function loadState(): StoredState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* corrupted state: start fresh */
  }
  return { wallets: [], lastNetworkId: 'testnet' };
}

export function saveState(state: StoredState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function addWallet(entry: WalletEntry): void {
  const state = loadState();
  state.wallets.push(entry);
  state.lastNetworkId = entry.networkId;
  saveState(state);
}

export function removeWallet(id: string): void {
  const state = loadState();
  state.wallets = state.wallets.filter((w) => w.id !== id);
  saveState(state);
}

export function presetById(id: string): NetworkPreset {
  return NETWORK_PRESETS.find((p) => p.id === id) ?? NETWORK_PRESETS[0];
}

/** Delete a wallet's IndexedDB database (navio-sdk names it after the id). */
export function deleteWalletDatabase(id: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(id);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
