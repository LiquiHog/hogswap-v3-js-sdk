import { HogswapInputError } from './errors.js';
import { MAX_GROUP_SIZE } from './constants.js';
import { groupBytes } from './group.js';

/**
 * Put your own transactions around a HogSwap group, as one atomic group: some before the swap,
 * some after it, or both. Everything succeeds or fails together.
 *
 * Rules (enforced by the router contract):
 * - `before` runs first, so it can't use the swap's output (it can fund the swap).
 * - `after` runs once the swap has paid out, so it CAN spend the swap's output: up to
 *   `min_out_at_slippage`, which the swap guarantees (e.g. deposit it as collateral).
 * - Nothing can go between the swap's own transactions, and only one swap fits in a group.
 * - The whole group is at most 16 transactions: quote with
 *   `maxOuterTxns: 16 - before.length - after.length` to leave room.
 *
 * Needs `algosdk` (v2 or v3), passed in so this SDK stays dependency-free. Returns
 * `algosdk.Transaction[]` with a fresh group id, ready for wallets that take Transaction objects;
 * `.map((t) => t.toByte())` gives bytes for wallets that take bytes.
 *
 * @param {{
 *   algosdk: any,
 *   build: {unsigned_group: Array<{txn_b64: string}>},
 *   before?: Array<any>,
 *   after?: Array<any>,
 * }} p algosdk Transactions or unsigned transaction bytes
 * @returns {any[]} algosdk.Transaction[]: before..., the swap, after...
 */
export function composeGroup({ algosdk, build, before = [], after = [] }) {
  if (!algosdk || typeof algosdk.decodeUnsignedTransaction !== 'function' || typeof algosdk.assignGroupID !== 'function') {
    throw new HogswapInputError('composeGroup needs the algosdk module: composeGroup({ algosdk, build, before, after })');
  }
  if (!Array.isArray(before) || !Array.isArray(after)) throw new HogswapInputError('before and after must be lists of transactions');
  if (before.length === 0 && after.length === 0) throw new HogswapInputError('give at least one transaction in before or after');
  const decode = (list, name) =>
    list.map((t, i) => {
      if (t instanceof Uint8Array) return algosdk.decodeUnsignedTransaction(t);
      if (t && typeof t === 'object' && typeof t.txID === 'function') return t;
      throw new HogswapInputError(`${name}[${i}] must be an algosdk Transaction or unsigned transaction bytes`);
    });
  const swap = groupBytes(build).map((b) => algosdk.decodeUnsignedTransaction(b));
  const head = decode(before, 'before');
  const tail = decode(after, 'after');
  const all = [...head, ...swap, ...tail];
  if (all.length > MAX_GROUP_SIZE) {
    throw new HogswapInputError(
      `the combined group would have ${all.length} transactions (max ${MAX_GROUP_SIZE}); quote with maxOuterTxns: ${MAX_GROUP_SIZE - head.length - tail.length}`,
    );
  }
  // Clear the old group id first: it is part of each transaction's id, and so of the new one.
  for (const t of all) t.group = undefined;
  algosdk.assignGroupID(all);
  return all;
}
