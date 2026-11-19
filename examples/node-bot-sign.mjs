// A backend swapping from its own account: quote, build, sign with algosdk, submit.
//
//   npm install --no-save algosdk
//   (load your 25 words into BOT_MNEMONIC first: docs/GETTING-STARTED.md, step 5; never type them
//   on the command line, where they'd land in your shell history)
//   ALGOD_URL="https://mainnet-api.algonode.cloud" node examples/node-bot-sign.mjs
//
// This sends a real mainnet transaction (0.1 ALGO to USDC by default). Set DRY_RUN=1 to stop
// before signing.
import algosdk from 'algosdk';
import {
  HogswapClient,
  ASSETS,
  HogswapMissingOptInError,
  formatUnits,
  submitAndConfirm,
} from '../src/index.js';

const mnemonic = process.env.BOT_MNEMONIC;
if (!mnemonic) throw new Error('set BOT_MNEMONIC (never hard-code it)');
const account = algosdk.mnemonicToSecretKey(mnemonic);
const sender = account.addr.toString();
const algod = { algodUrl: process.env.ALGOD_URL ?? 'https://mainnet-api.algonode.cloud', algodToken: process.env.ALGOD_TOKEN };

const hogswap = new HogswapClient();

try {
  const { quote, build, txns } = await hogswap.prepareSwap({
    assetIn: ASSETS.ALGO,
    assetOut: ASSETS.USDC,
    amountIn: 100_000n, // 0.1 ALGO
    slippageBps: 50,
    sender,
  });
  console.log(`expect ${formatUnits(quote.expected_out, 6)} USDC, at least ${formatUnits(build.min_out_at_slippage, 6)}`);
  build.unsigned_group.forEach((t) => console.log(' ', t.description));

  if (process.env.DRY_RUN) process.exit(0);

  const signed = txns.map((bytes) => algosdk.decodeUnsignedTransaction(bytes).signTxn(account.sk));
  const { txId, confirmedRound } = await submitAndConfirm(signed, algod);
  console.log(`confirmed in round ${confirmedRound}: ${txId}`);
} catch (err) {
  if (err instanceof HogswapMissingOptInError) {
    console.error(`opt ${sender} into asset(s) ${err.assets.join(', ')} first`);
    process.exit(1);
  }
  throw err;
}

