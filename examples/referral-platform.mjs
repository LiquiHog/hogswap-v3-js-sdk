// The referral programme from a platform's side, start to finish: where you stand, opening the
// assets you earn in, opting in so you can claim, what a referred swap pays you, and claiming.
// Every group is simulated first. Nothing is signed or sent without --send.
//
//   npm install --no-save algosdk
//   (load your 25 words into PLATFORM_MNEMONIC first: docs/GETTING-STARTED.md, step 5; never type them
//   on the command line, where they'd land in your shell history)
//   PLATFORM_ADDRESS=YOUR_ADDRESS node examples/referral-platform.mjs             # look only
//   node examples/referral-platform.mjs --send            # do it
//
// Optional: ASSETS (comma-separated ids to open, default ALGO,USDC,HOG), FEE_PPM (default 5000),
// ALGOD_URL, ALGOD_TOKEN.
import algosdk from 'algosdk';
import { HogswapClient, ASSETS, formatUnits, groupBytes, submitAndConfirm } from '../src/index.js';

const send = process.argv.includes('--send');
const key = process.env.PLATFORM_MNEMONIC ? algosdk.mnemonicToSecretKey(process.env.PLATFORM_MNEMONIC) : null;
const referrer = key ? key.addr.toString() : process.env.PLATFORM_ADDRESS;
if (!referrer) throw new Error('set PLATFORM_ADDRESS (look only) or PLATFORM_MNEMONIC (to send)');
if (send && !key) throw new Error('--send needs PLATFORM_MNEMONIC');

const algodUrl = process.env.ALGOD_URL ?? 'https://mainnet-api.algonode.cloud';
const algodOpts = { algodUrl, algodToken: process.env.ALGOD_TOKEN };
const algod = new algosdk.Algodv2(process.env.ALGOD_TOKEN ?? '', algodUrl); // the port comes from the URL
const hogswap = new HogswapClient();
const wanted = process.env.ASSETS ? process.env.ASSETS.split(',').map(Number) : [ASSETS.ALGO, ASSETS.USDC, ASSETS.HOG];
const feePpm = Number(process.env.FEE_PPM ?? 5000);

const toTxns = (group) => groupBytes(group).map((b) => algosdk.decodeUnsignedTransaction(b));

// Simulate each group against current chain state (algod takes one group per request); stop on
// the first failure. Each is checked on its own, so a later group can't rely on an earlier one.
async function simulate(groups) {
  for (const [i, txns] of groups.entries()) {
    const req = new algosdk.modelsv2.SimulateRequest({
      txnGroups: [new algosdk.modelsv2.SimulateRequestTransactionGroup({ txns: txns.map((txn) => new algosdk.SignedTransaction({ txn })) })],
      allowEmptySignatures: true,
    });
    const g = (await algod.simulateTransactions(req).do()).txnGroups[0];
    if (g.failureMessage) throw new Error(`group ${i + 1} of ${groups.length} would fail at ${g.failedAt}: ${g.failureMessage}`);
  }
  if (groups.length) console.log(`  simulated ${groups.length} group(s): clean`);
}

async function run(label, groups) {
  await simulate(groups);
  if (!send) return;
  for (const [i, txns] of groups.entries()) {
    const { txId, confirmedRound } = await submitAndConfirm(txns.map((t) => t.signTxn(key.sk)), algodOpts);
    console.log(`  ${label} ${i + 1}/${groups.length} confirmed in round ${confirmedRound}: ${txId}`);
  }
}

// 1. Where do we stand?
const status = await hogswap.referrerStatus(referrer);
console.log(`platform ${referrer}`);
console.log(`discount token: ${status.discount_token_id || 'off'}; open assets: ${status.assets.length}`);
for (const a of status.assets) console.log(`  asset ${a.asset_id}: accrued ${a.accrued} base units${a.can_receive ? '' : ' (opt in to claim)'}`);

// 2. Open the assets you want to earn in. Only the ones not open yet produce transactions.
const setup = await hogswap.referrerSetup({ referrer, assets: wanted });
console.log(`\nopen ${wanted.join(', ')}: ${setup.groups.length} group(s) to sign`);
for (const g of setup.groups) console.log(`  ${g.steps.join('; ')}; deposit ${formatUnits(g.deposit_microalgo, 6)} ALGO, fee ${formatUnits(g.network_fee_microalgo, 6)} ALGO`);
setup.notes.forEach((n) => console.log(`  note: ${n}`));
await run('setup', setup.groups.map(toTxns));

// 3. Opt in to each asset (not ALGO) you don't hold yet, or its claims can't pay you.
const account = await algod.accountInformation(referrer).do();
const held = new Set((account.assets ?? []).map((a) => Number(a.assetId)));
const missing = wanted.filter((a) => a !== 0 && !held.has(a));
console.log(`\nopt-ins needed: ${missing.length ? missing.join(', ') : 'none'}`);
if (missing.length) {
  const params = await algod.getTransactionParams().do();
  await run('opt-in', missing.map((assetIndex) => [algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: referrer, receiver: referrer, assetIndex, amount: 0, suggestedParams: params })]));
}

// 4. What one referred swap pays: 100 ALGO -> USDC at your rate.
const q = await hogswap.quote({ assetIn: ASSETS.ALGO, assetOut: ASSETS.USDC, amountIn: 100_000_000n, referrer, feePpm });
console.log(`\na 100 ALGO -> USDC swap you refer at ${feePpm} ppm:`);
console.log(`  user receives about ${formatUnits(q.expected_out, 6)} USDC, paying ${q.router_fee_ppm_effective} ppm in fees`);
console.log(`  you earn ${formatUnits(q.referrer_fee_amount, 6)} USDC (${q.referrer_share_ppm} ppm of the output)`);

// 5. Claim whatever has accrued.
const claim = await hogswap.referrerClaim({ referrer });
console.log(`\nclaim: ${claim.groups.length} group(s)`);
claim.notes.forEach((n) => console.log(`  note: ${n}`));
await run('claim', claim.groups.map(toTxns));

if (!send) console.log('\nlook-only run: nothing was signed or sent. Add --send (with PLATFORM_MNEMONIC) to do it.');
