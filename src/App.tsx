/**
 * App shell & routing
 * ===================
 *
 * Deliberately no router library: the app is a single-page tool with five
 * views, and a `useState<View>` keeps the example free of incidental
 * dependencies. Each view is one file under components/ and maps 1:1 to a
 * capability of navio-sdk:
 *
 *   portfolio → balances, receive address, send (client.sendTransaction /
 *               sendToken / sendNft)
 *   market    → public listings (explorer API) + your assets as a market
 *   trade     → taker side of RFQ swaps (requestQuote → listQuotes →
 *               acceptQuote)
 *   maker     → maker side (setSwapIntent, pending-request subscription,
 *               replyQuote, broadcastOrder)
 *   mint      → createTokenCollection / mintToken / createNftCollection /
 *               mintNft
 *
 * The <Gate> renders instead of the shell until a wallet session exists.
 */
import { useState } from 'react';
import { WalletProvider, useWallet } from './state/WalletContext';
import { Gate } from './components/Gate';
import { Layout, View } from './components/Layout';
import { Portfolio } from './components/Portfolio';
import { Market } from './components/Market';
import { TradeDesk } from './components/TradeDesk';
import { MakerDesk } from './components/MakerDesk';
import { MintStudio } from './components/MintStudio';

function Shell() {
  const { session } = useWallet();
  const [view, setView] = useState<View>('portfolio');

  if (!session) return <Gate />;

  return (
    <Layout view={view} onNavigate={setView}>
      {view === 'portfolio' && <Portfolio />}
      {view === 'market' && <Market onTrade={() => setView('trade')} />}
      {view === 'trade' && <TradeDesk />}
      {view === 'maker' && <MakerDesk />}
      {view === 'mint' && <MintStudio />}
    </Layout>
  );
}

export function App() {
  return (
    <WalletProvider>
      <Shell />
    </WalletProvider>
  );
}
