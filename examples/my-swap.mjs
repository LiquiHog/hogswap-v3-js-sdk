// Swap from your own account, with a confirmation prompt.
//
//   npm install --no-save algosdk
//   (load your 25 words into MY_MNEMONIC first: docs/GETTING-STARTED.md, step 5; never type them
//   on the command line, where they'd land in your shell history)
//   node examples/my-swap.mjs <assetIn> <assetOut> <amount> [--yes]
//   e.g.  node examples/my-swap.mjs 0 31566704 25      (25 ALGO -> USDC, asks before sending)
//
// <amount> is in whole tokens ("25", "0.5"); the script reads the asset's decimals.
// Optional: ALGOD_URL, ALGOD_TOKEN, SLIPPAGE_BPS, EXCLUDE_VENUES (comma-separated keys).
import readline from 'node:readline/promises';
import algosdk from 'algosdk';
import { HogswapClient, formatUnits, parseUnits, submitAndConfirm, HogswapMissingOptInError, HogswapNoRouteError } from '../src/index.js';

const [assetIn, assetOut, amountText] = process.argv.slice(2);
const yes = process.argv.includes('--yes');
if (amountText === undefined) {
  console.error('usage: node examples/my-swap.mjs <assetIn> <assetOut> <amount> [--yes]');
  process.exit(2);
}
if (!process.env.MY_MNEMONIC) throw new Error('set MY_MNEMONIC (never hard-code it)');
const me = algosdk.mnemonicToSecretKey(process.env.MY_MNEMONIC);
const address = me.addr.toString();
const algod = { algodUrl: process.env.ALGOD_URL ?? 'https://mainnet-api.algonode.cloud', algodToken: process.env.ALGOD_TOKEN };

const hogswap = new HogswapClient();
const [ain, aout] = await Promise.all([hogswap.asset(assetIn), hogswap.asset(assetOut)]);
const name = (a) => a.unit_name ?? `asset ${a.asset_id}`;

try {
  const { quote, txns } = await hogswap.prepareSwap({
    assetIn,
    assetOut,
    amountIn: parseUnits(amountText, ain.decimals),
    slippageBps: Number(process.env.SLIPPAGE_BPS ?? 50),
    excludeVenues: process.env.EXCLUDE_VENUES ? process.env.EXCLUDE_VENUES.split(',') : undefined,
    sender: address,
  });

  console.log(`swap      ${amountText} ${name(ain)} -> ${formatUnits(quote.expected_out, aout.decimals)} ${name(aout)}`);
  console.log(`at least  ${formatUnits(quote.min_out_at_slippage, aout.decimals)} ${name(aout)} (or the swap reverts)`);
  console.log(`fees      router ${formatUnits(quote.router_fee_amount, aout.decimals)} ${name(aout)}, network up to ${formatUnits(quote.network_fee_max_microalgo, 6)} ALGO`);
  console.log(`route     ${quote.legs.map((l) => l.dex_name).join(', ')} (${quote.legs.length} legs, ${txns.length} txns)`);

  if (!yes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('send it? [y/N] ');
    rl.close();
    if (answer.trim().toLowerCase() !== 'y') process.exit(0);
  }

  const signed = txns.map((b) => algosdk.decodeUnsignedTransaction(b).signTxn(me.sk));
  const { txId, confirmedRound } = await submitAndConfirm(signed, algod);
  console.log(`confirmed in round ${confirmedRound}: ${txId}`);
} catch (err) {
  if (err instanceof HogswapMissingOptInError) console.error(`opt in to asset(s) ${err.assets.join(', ')} first`);
  else if (err instanceof HogswapNoRouteError) console.error(`no route: ${err.message}`);
  else throw err;
  process.exit(1);
}
