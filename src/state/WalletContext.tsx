/**
 * Wallet session state
 * ====================
 *
 * One React context owns the live `NavioClient` and everything derived
 * from it. Components never touch the SDK directly for *state* — they read
 * this context — but they DO call SDK actions (send, mint, trade) through
 * the `client` handle it exposes. That keeps the example honest: you can
 * see exactly which SDK call each button maps to.
 *
 * Lifecycle
 * ---------
 *   openWallet()  → construct NavioClient (IndexedDB adapter, WebSocket
 *                   electrum), initialize, optionally unlock, start a
 *                   background sync loop.
 *   refresh()     → re-read balances/assets from the wallet DB. Called
 *                   after the sync loop reports progress and after any
 *                   action that changes the wallet (send/mint/trade).
 *   closeWallet() → stop syncing, disconnect, drop state.
 *
 * Sync strategy
 * -------------
 * `client.startBackgroundSync` subscribes to new block headers over the
 * Electrum WebSocket and rescans incrementally. Wallet scanning is CLIENT
 * SIDE: the server only hands us per-block transaction keys; view tags and
 * range-proof recovery run locally, so the server never learns which
 * outputs are ours. (That is the whole point of BLSCT light wallets.)
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { NavioClient as NavioClientT, WalletAssetBalance } from 'navio-sdk';
import { normalizeRegtestAddress } from '../lib/address';
import { ExplorerApi } from '../lib/explorer';
import { NetworkPreset, WalletEntry, addWallet, deleteWalletDatabase } from '../lib/settings';

export interface ActivityItem {
  time: number;
  kind: 'info' | 'ok' | 'error';
  text: string;
  txId?: string;
}

export interface SyncStatus {
  height: number;
  tip: number;
  syncing: boolean;
}

interface WalletSession {
  client: NavioClientT;
  entry: WalletEntry;
  preset: NetworkPreset;
  explorer: ExplorerApi;
  address: string;
  /** True when the connected ElectrumX carries the RFQ trading bridge. */
  tradingAvailable: boolean;
}

interface WalletContextValue {
  session: WalletSession | null;
  balances: WalletAssetBalance[];
  navBalance: bigint;
  sync: SyncStatus;
  activity: ActivityItem[];
  /** Privacy screen: when true, amounts render blurred until hovered. */
  concealAmounts: boolean;
  setConcealAmounts(v: boolean): void;
  locked: boolean;
  createWallet(opts: {
    name: string;
    preset: NetworkPreset;
    password: string;
    mnemonic?: string;
    restoreHeight?: number;
  }): Promise<string>;
  openWallet(entry: WalletEntry, preset: NetworkPreset, password: string): Promise<void>;
  closeWallet(): Promise<void>;
  deleteWallet(entry: WalletEntry): Promise<void>;
  refresh(): Promise<void>;
  log(kind: ActivityItem['kind'], text: string, txId?: string): void;
  unlock(password: string): Promise<boolean>;
  lock(): void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used inside <WalletProvider>');
  return ctx;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<WalletSession | null>(null);
  const [balances, setBalances] = useState<WalletAssetBalance[]>([]);
  const [navBalance, setNavBalance] = useState(0n);
  const [sync, setSync] = useState<SyncStatus>({ height: 0, tip: 0, syncing: false });
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [concealAmounts, setConcealAmounts] = useState(false);
  const [locked, setLocked] = useState(false);
  const sessionRef = useRef<WalletSession | null>(null);

  const log = useCallback((kind: ActivityItem['kind'], text: string, txId?: string) => {
    setActivity((prev) => [{ time: Date.now(), kind, text, txId }, ...prev].slice(0, 200));
  }, []);

  const refresh = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    // Balances are computed from the wallet's own scanned output set —
    // no network round-trip happens here.
    // getBalance() returns bigint base units; (getBalanceNav() would be a
    // display-ready number of coins, but the UI formats units itself.)
    const [nav, assets] = await Promise.all([
      s.client.getBalance(),
      s.client.getAssetBalances(),
    ]);
    setNavBalance(nav);
    setBalances(assets);
  }, []);

  const startSync = useCallback(
    async (s: WalletSession) => {
      setSync((prev) => ({ ...prev, syncing: true }));
      await s.client.startBackgroundSync({
        pollInterval: 10_000,
        onProgress: (current: number, tip: number) => {
          setSync({ height: current, tip, syncing: current < tip });
        },
        onBalanceChange: () => {
          void refresh();
        },
        onError: (err: Error) => log('error', `Sync error: ${err.message}`),
      });
      await refresh();
    },
    [log, refresh],
  );

  /**
   * Detect the RFQ trading bridge. `blockchain.p2pmsg.info` is the
   * cheapest bridge method; servers without the bridge reject it as an
   * unknown method and we simply hide the trading UI.
   */
  const detectTrading = useCallback(async (client: NavioClientT): Promise<boolean> => {
    try {
      const electrum = client.getElectrumClient();
      if (!electrum) return false;
      const info = await electrum.p2pmsgInfo();
      return Boolean(info?.enabled);
    } catch {
      return false;
    }
  }, []);

  const buildSession = useCallback(
    async (client: NavioClientT, entry: WalletEntry, preset: NetworkPreset): Promise<WalletSession> => {
      const km = client.getKeyManager();
      // Encode the primary receive address (account 0, index 0) from the
      // sub-address key material. See lib/address.ts for the regtest HRP
      // normalization story.
      const blsct = await import('navio-blsct');
      const subAddr = km.getSubAddress({ account: 0, address: 0 });
      const dpk = blsct.DoublePublicKey.deserialize(subAddr.serialize());
      const address = normalizeRegtestAddress(
        blsct.Address.encode(dpk, blsct.AddressEncoding.Bech32M),
      );
      return {
        client,
        entry,
        preset,
        explorer: new ExplorerApi(preset.explorerApi),
        address,
        tradingAvailable: await detectTrading(client),
      };
    },
    [detectTrading],
  );

  const activateSession = useCallback(
    async (s: WalletSession) => {
      sessionRef.current = s;
      setSession(s);
      setLocked(false);
      log('info', `Connected to ${s.preset.label} via ${s.preset.electrum.host}:${s.preset.electrum.port}`);
      log(
        s.tradingAvailable ? 'ok' : 'info',
        s.tradingAvailable
          ? 'RFQ trading bridge detected — trading is enabled'
          : 'This server has no RFQ trading bridge; trading is hidden',
      );
      await startSync(s);
    },
    [log, startSync],
  );

  const createWallet = useCallback<WalletContextValue['createWallet']>(
    async ({ name, preset, password, mnemonic, restoreHeight }) => {
      const id = `navio-dex-${crypto.randomUUID()}`;
      if (mnemonic) await deleteWalletDatabase(id);

      const { NavioClient } = await import('navio-sdk');
      const config: any = {
        network: preset.network,
        backend: 'electrum',
        electrum: preset.electrum,
        walletDbPath: id,
        databaseAdapter: 'indexeddb',
      };
      if (mnemonic) {
        config.restoreFromMnemonic = mnemonic.trim();
        config.restoreFromHeight = restoreHeight ?? 0;
      } else {
        config.createWalletIfNotExists = true;
      }

      const client: NavioClientT = new NavioClient(config);
      await client.initialize();

      const km = client.getKeyManager();
      const words = km.getMnemonic();
      if (password) {
        // The SDK derives an AES-256-GCM key from the password with
        // Argon2id and encrypts key material inside the wallet database.
        await km.setPassword(password);
        const params = km.getEncryptionParams();
        if (params) {
          await client.getWalletDB().saveEncryptionMetadata(params.salt, params.verificationHash);
        }
      }

      const entry: WalletEntry = {
        id,
        name,
        encrypted: Boolean(password),
        networkId: preset.id,
        createdAt: Date.now(),
      };
      addWallet(entry);
      await activateSession(await buildSession(client, entry, preset));
      return words ?? '';
    },
    [activateSession, buildSession],
  );

  const openWallet = useCallback<WalletContextValue['openWallet']>(
    async (entry, preset, password) => {
      const { NavioClient } = await import('navio-sdk');
      const client: NavioClientT = new NavioClient({
        network: preset.network,
        backend: 'electrum',
        electrum: preset.electrum,
        walletDbPath: entry.id,
        databaseAdapter: 'indexeddb',
      } as any);
      await client.initialize();

      const km = client.getKeyManager();
      if (km.isEncrypted()) {
        if (!(await km.unlock(password))) {
          client.disconnect();
          throw new Error('Wrong password');
        }
      }
      await activateSession(await buildSession(client, entry, preset));
    },
    [activateSession, buildSession],
  );

  const closeWallet = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    s.client.stopBackgroundSync();
    await s.client.disconnect();
    sessionRef.current = null;
    setSession(null);
    setBalances([]);
    setNavBalance(0n);
    setSync({ height: 0, tip: 0, syncing: false });
    setActivity([]);
  }, []);

  const deleteWallet = useCallback(
    async (entry: WalletEntry) => {
      if (sessionRef.current?.entry.id === entry.id) await closeWallet();
      await deleteWalletDatabase(entry.id);
    },
    [closeWallet],
  );

  const unlock = useCallback(async (password: string): Promise<boolean> => {
    const s = sessionRef.current;
    if (!s) return false;
    const ok = await s.client.getKeyManager().unlock(password);
    if (ok) setLocked(false);
    return ok;
  }, []);

  const lock = useCallback(() => {
    sessionRef.current?.client.getKeyManager().lock();
    setLocked(true);
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({
      session,
      balances,
      navBalance,
      sync,
      activity,
      concealAmounts,
      setConcealAmounts,
      locked,
      createWallet,
      openWallet,
      closeWallet,
      deleteWallet,
      refresh,
      log,
      unlock,
      lock,
    }),
    [
      session, balances, navBalance, sync, activity, concealAmounts, locked,
      createWallet, openWallet, closeWallet, deleteWallet, refresh, log, unlock, lock,
    ],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
