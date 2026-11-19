// Liquidity quotes on a STAMM pool: deposit (two-sided and one-sided) and withdraw.
// Quote only: nothing is signed or sent.
//   node examples/lp.mjs
import { HogswapClient, formatUnits } from '../src/index.js';

const hogswap = new HogswapClient();
const POOL = 3544790053; // STAMM ALGO/HOG
const TIER = 1;

const { pools } = await hogswap.stammPools({ activeOnly: true });
const pool = pools.find((p) => p.pool_id === POOL);
console.log(`pool ${POOL}: ${pool.asset_a}/${pool.asset_b}, tiers:`);
for (const t of pool.extra.tiers) console.log(`  tier ${t.index}: fee ${t.fee_bps} bps, active ${t.active}`);

const two = await hogswap.quoteLpMint({ poolAppId: POOL, tierIndex: TIER, amountA: 10_000_000n, amountB: 4_700_000n });
console.log(`deposit 10 ALGO + 4.7 HOG -> ${formatUnits(two.lp.expected_lp_out, 6)} LP (token ${two.lp.lp_asset_id}), value impact ${two.lp.value_impact_bps} bps`);

const one = await hogswap.quoteLpMint({ poolAppId: POOL, tierIndex: TIER, amountA: 10_000_000n });
console.log(`deposit 10 ALGO only -> ${formatUnits(one.lp.expected_lp_out, 6)} LP`);

const both = await hogswap.quoteLpRedeem({ poolAppId: POOL, tierIndex: TIER, lpAmount: 1_000_000n });
console.log(`withdraw 1 LP -> ${both.lp.outputs.map((o) => `${formatUnits(o.expected_out, 6)} of ${o.asset_id}`).join(' + ')}`);

const algoOnly = await hogswap.quoteLpRedeem({ poolAppId: POOL, tierIndex: TIER, lpAmount: 1_000_000n, targetAsset: 0 });
console.log(`withdraw 1 LP all as ALGO -> ${formatUnits(algoOnly.expected_out, 6)} ALGO`);
