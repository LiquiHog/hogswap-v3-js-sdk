// A quote from Node. Nothing is signed or sent.
//   node examples/node-quote.mjs [amount-in-ALGO]
import { HogswapClient, ASSETS, parseUnits, formatUnits, toBigInt } from '../src/index.js';

const hogswap = new HogswapClient();
const amount = process.argv[2] ?? '10';

const [algo, usdc] = (await hogswap.assetsByIds([ASSETS.ALGO, ASSETS.USDC])).assets;

const quote = await hogswap.quote({
  assetIn: ASSETS.ALGO,
  assetOut: ASSETS.USDC,
  amountIn: parseUnits(amount, algo.decimals),
  slippageBps: 50,
});

const out = toBigInt(quote.expected_out);
console.log(`${amount} ${algo.unit_name} -> ${formatUnits(out, usdc.decimals)} ${usdc.unit_name}`);
console.log(`worst case ${formatUnits(quote.min_out_at_slippage, usdc.decimals)} ${usdc.unit_name} (slippage ${quote.slippage_bps} bps)`);
console.log(`router fee ${formatUnits(quote.router_fee_amount, usdc.decimals)} ${usdc.unit_name}, network fee up to ${formatUnits(quote.network_fee_max_microalgo, 6)} ALGO`);
console.log('route:');
for (const leg of quote.legs) {
  console.log(`  ${leg.dex_name.padEnd(16)} pool ${leg.pool_id}: ${leg.asset_in} -> ${leg.asset_out}`);
}
