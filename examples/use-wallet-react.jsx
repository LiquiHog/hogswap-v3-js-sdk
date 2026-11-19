// A swap button with @txnlab/use-wallet-react: Pera, Defly and Lute behind one API.
//
//   npm install @txnlab/use-wallet-react algosdk
//   npm install /path/to/hogswap-v3-js-sdk   (the folder you downloaded or cloned)
//
// Wrap your app once:
//
//   const manager = new WalletManager({
//     wallets: [WalletId.PERA, WalletId.DEFLY, { id: WalletId.LUTE, options: { siteName: 'Your site' } }],
//     defaultNetwork: NetworkId.MAINNET,
//   });
//   <WalletProvider manager={manager}><App /></WalletProvider>
import { useEffect, useMemo, useRef, useState } from 'react';
import { useWallet } from '@txnlab/use-wallet-react';
import {
  HogswapClient,
  HogswapMissingOptInError,
  HogswapQuoteExpiredError,
  HogswapNoRouteError,
  assertFullySigned,
  formatUnits,
  groupBytes,
  parseUnits,
  submitAndConfirm,
} from 'hogswap-v3-js-sdk';

// One client for the whole app: it paces requests to the public limits.
const hogswap = new HogswapClient();
const ALGOD = { algodUrl: 'https://mainnet-api.algonode.cloud' };

const ALGO = { id: 0, decimals: 6, unit: 'ALGO' };
const USDC = { id: 31566704, decimals: 6, unit: 'USDC' };

// Optional: your platform's address and rate, to earn on swaps (see docs/REFERRALS.md).
const REFERRAL = undefined; // { referrer: 'YOUR_PLATFORM_ADDRESS', feePpm: 2500 }

export function SwapBox() {
  const { activeAddress, signTransactions } = useWallet();
  const [text, setText] = useState('10');
  const [quote, setQuote] = useState(null);
  const [status, setStatus] = useState('');
  const quotedAt = useRef(0);

  const amountIn = useMemo(() => {
    try {
      const v = parseUnits(text, ALGO.decimals);
      return v > 0n ? v : null;
    } catch {
      return null;
    }
  }, [text]);

  // Debounced quote while the user types.
  useEffect(() => {
    setQuote(null);
    if (!amountIn) return undefined;
    const t = setTimeout(async () => {
      try {
        const q = await hogswap.quote({ assetIn: ALGO.id, assetOut: USDC.id, amountIn, sender: activeAddress ?? undefined, ...REFERRAL });
        quotedAt.current = Date.now();
        setQuote(q);
        setStatus('');
      } catch (err) {
        setStatus(err instanceof HogswapNoRouteError ? 'No route for this amount' : err.message);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [amountIn, activeAddress]);

  async function swap() {
    if (!activeAddress || !amountIn) return;
    try {
      // Quotes build for about 30 s: re-quote if this one is getting old.
      let q = quote;
      if (!q || Date.now() - quotedAt.current > 20_000) {
        q = await hogswap.quote({ assetIn: ALGO.id, assetOut: USDC.id, amountIn, sender: activeAddress, ...REFERRAL });
      }
      setStatus('Building...');
      const build = await hogswap.execute({ quoteId: q.quote_id, userAddress: activeAddress });
      const txns = groupBytes(build);

      setStatus('Sign in your wallet...');
      const signed = assertFullySigned(await signTransactions(txns), txns.length);

      setStatus('Sending...');
      const { txId } = await submitAndConfirm(signed, ALGOD);
      setStatus(`Done: ${txId}`);
    } catch (err) {
      if (err instanceof HogswapMissingOptInError) setStatus(`Opt in to asset ${err.assets.join(', ')} first`);
      else if (err instanceof HogswapQuoteExpiredError) setStatus('Quote expired, try again');
      else setStatus(err.message);
    }
  }

  return (
    <div>
      <input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" /> {ALGO.unit}
      {quote && (
        <p>
          You get about {formatUnits(quote.expected_out, USDC.decimals, { maxDecimals: 4 })} {USDC.unit}, at least{' '}
          {formatUnits(quote.min_out_at_slippage, USDC.decimals, { maxDecimals: 4 })}
        </p>
      )}
      <button onClick={swap} disabled={!activeAddress || !quote}>
        {activeAddress ? 'Swap' : 'Connect a wallet'}
      </button>
      <p>{status}</p>
    </div>
  );
}
