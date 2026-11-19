// Look up asset ids by name or unit name. Nothing is signed or sent.
//
//   node examples/find-asset.mjs gold
import { HogswapClient } from '../src/index.js';

const q = process.argv.slice(2).join(' ');
if (!q) {
  console.error('usage: node examples/find-asset.mjs <name or unit name>');
  process.exit(2);
}
const { assets } = await new HogswapClient().assets({ q, limit: 20 });
if (assets.length === 0) console.log(`nothing found for "${q}"`);
for (const a of assets) console.log(`${String(a.asset_id).padStart(12)}  ${(a.unit_name ?? '').padEnd(10)} ${a.name ?? ''} (${a.decimals} decimals)`);
console.log('\nALGO is asset 0. Check the id in your wallet or an explorer before trading: names can be copied.');
