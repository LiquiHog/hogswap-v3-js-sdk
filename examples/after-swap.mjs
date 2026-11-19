// Use a swap's output in the same atomic group: swap ALGO to USDC, then send exactly the
// guaranteed minimum on to another address (standing in for a deposit or repayment). One group,
// all or nothing. Simulates the group first; sends only with --send.
//
//   npm install --no-save algosdk
//   (load your 25 words into MY_MNEMONIC first: docs/GETTING-STARTED.md, step 5; never type them
//   on the command line, where they'd land in your shell history)
//   DEST_ADDRESS=... node examples/after-swap.mjs [--send]
//
// DEST_ADDRESS must be opted into USDC, or the simulate fails and nothing is sent.
import algosdk from 'algosdk';
import { HogswapClient, ASSETS, composeGroup, formatUnits, submitAndConfirm, toBigInt } from '../src/index.js';

if (!process.env.MY_MNEMONIC || !process.env.DEST_ADDRESS) throw new Error('set MY_MNEMONIC and DEST_ADDRESS');
const me = algosdk.mnemonicToSecretKey(process.env.MY_MNEMONIC);
const user = me.addr.toString();
const algodUrl = process.env.ALGOD_URL ?? 'https://mainnet-api.algonode.cloud';
const algodOpts = { algodUrl, algodToken: process.env.ALGOD_TOKEN };
const algod = new algosdk.Algodv2(process.env.ALGOD_TOKEN ?? '', algodUrl); // the port comes from the URL
const hogswap = new HogswapClient();

// 1. Quote with room for the one transaction we add after the swap.
const quote = await hogswap.quote({ assetIn: ASSETS.ALGO, assetOut: ASSETS.USDC, amountIn: 1_000_000n, sender: user, maxOuterTxns: 16 - 1 });
const amount = toBigInt(quote.min_out_at_slippage);
console.log(`swap 1 ALGO -> at least ${formatUnits(amount, 6)} USDC; then send exactly that on, in the same group`);

// 2. Build the swap, and the step after it, sized to the guaranteed minimum.
const build = await hogswap.execute({ quoteId: quote.quote_id, userAddress: user });
const params = await algod.getTransactionParams().do();
const after = [algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: user, receiver: process.env.DEST_ADDRESS, assetIndex: ASSETS.USDC, amount, suggestedParams: params })];
const group = composeGroup({ algosdk, build, after });

// 3. Simulate the whole group: the router checks its swap, not the transactions you add.
const req = new algosdk.modelsv2.SimulateRequest({
  txnGroups: [new algosdk.modelsv2.SimulateRequestTransactionGroup({ txns: group.map((txn) => new algosdk.SignedTransaction({ txn })) })],
  allowEmptySignatures: true,
});
const sim = (await algod.simulateTransactions(req).do()).txnGroups[0];
if (sim.failureMessage) throw new Error(`simulate failed at ${sim.failedAt}: ${sim.failureMessage}`);
console.log(`simulate clean: ${group.length} transactions`);
if (!process.argv.includes('--send')) process.exit(0);

// 4. Sign (one wallet prompt in a real app) and send.
const signed = group.map((t) => t.signTxn(me.sk));
console.log('confirmed', await submitAndConfirm(signed, algodOpts));
