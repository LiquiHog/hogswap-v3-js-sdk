// Your own transaction in the same atomic group as a swap: here, a small payment to a platform
// address before the swap. Builds and prints the combined group; sends only with --send.
//
//   npm install --no-save algosdk
//   (load your 25 words into MY_MNEMONIC first: docs/GETTING-STARTED.md, step 5; never type them
//   on the command line, where they'd land in your shell history)
//   PLATFORM_ADDRESS=... node examples/compose-before-swap.mjs [--send]
import algosdk from 'algosdk';
import { HogswapClient, composeGroup, submitAndConfirm, MAX_GROUP_SIZE } from '../src/index.js';

if (!process.env.MY_MNEMONIC || !process.env.PLATFORM_ADDRESS) throw new Error('set MY_MNEMONIC and PLATFORM_ADDRESS');
const me = algosdk.mnemonicToSecretKey(process.env.MY_MNEMONIC);
const user = me.addr.toString();
const algodUrl = process.env.ALGOD_URL ?? 'https://mainnet-api.algonode.cloud';
const algod = new algosdk.Algodv2(process.env.ALGOD_TOKEN ?? '', algodUrl); // the port comes from the URL
const hogswap = new HogswapClient();

// 1. Your transaction(s), from fresh params.
const params = await algod.getTransactionParams().do();
const mine = [
  algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: user, receiver: process.env.PLATFORM_ADDRESS, amount: 10_000, suggestedParams: params }),
];

// 2. Quote with room for them, 3. build with them as prefixTxns.
const quote = await hogswap.quote({ assetIn: 0, assetOut: 31566704, amountIn: 1_000_000n, sender: user, maxOuterTxns: MAX_GROUP_SIZE - mine.length });
const build = await hogswap.execute({ quoteId: quote.quote_id, userAddress: user, prefixTxns: mine.map((t) => t.toByte()) });

// 4. One group: yours first.
const group = composeGroup({ algosdk, build, before: mine });
group.forEach((t, i) => console.log(`${i}: ${t.type} from ${t.sender.toString().slice(0, 8)}…`)); // algosdk v3 (v2: t.from)

if (!process.argv.includes('--send')) process.exit(0);
const signed = group.map((t) => t.signTxn(me.sk));
console.log(await submitAndConfirm(signed, { algodUrl, algodToken: process.env.ALGOD_TOKEN }));
