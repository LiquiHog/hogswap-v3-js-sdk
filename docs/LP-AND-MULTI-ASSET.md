# Liquidity, multi-input and multi-output swaps

Every one of these follows the usual flow:

1. quote;
2. `execute({ quoteId, userAddress })`;
3. sign every transaction;
4. submit.

Only the quote call differs.

## Providing liquidity (LP deposit)

`quoteLpMint` deposits into a pool and returns its LP token. Supported pools: STAMM (each fee
tier separately), Tinyman v2 and Pact weighted.

### Find a pool

```js
const { pools } = await hogswap.stammPools({ activeOnly: true });
const pool = pools.find((p) => p.asset_a === 0 && p.asset_b === 3178895177); // ALGO/HOG
pool.extra.tiers; // [{ index, fee_bps, reserve_a, reserve_b, total_lp, active }, ...]
```

- **STAMM pools** have up to six fee tiers (`tierIndex` 0 to 5). Each tier has its own reserves
  and its own LP token.
- **Other venues:** `pools({ kind, assetA, assetB })` and `assetPools(assetId)` list them.

### Two-sided deposit

Give both assets, roughly in the pool's ratio:

```js
const q = await hogswap.quoteLpMint({
  poolAppId: 3544790053, tierIndex: 1,
  amountA: 10_000_000n, // 10 ALGO
  amountB: 4_700_000n,  // 4.7 HOG
  sender: user,
});
q.lp.expected_lp_out;   // LP tokens you receive (min: q.min_out_at_slippage)
q.lp.lp_asset_id;       // the LP token: the user must be opted into it
q.lp.deposit_trimmed;   // true if part of one side was left out to match the ratio
```

### One-sided deposit

Give one asset. The router balances it for the pool in the same group, swapping part of it where needed:

```js
const q = await hogswap.quoteLpMint({ poolAppId: 3544790053, tierIndex: 1, amountA: 10_000_000n });
```

### Depositing a third asset

`externalInputs` (up to 2) are swapped into the pool's assets first:

```js
await hogswap.quoteLpMint({ poolAppId, tierIndex: 1, externalInputs: [{ assetId: 31566704, amount: 5_000_000n }] });
```

### Value check

- **`lp.value_in_microalgo` and `lp.value_out_microalgo`:** what goes in and what the LP tokens
  are worth, in microALGO.
- **`lp.value_impact_bps`:** the difference between them (the cost of depositing).
- **Seeding:** `lp.seeds_tier` or `lp.needs_seed_tier` say a STAMM tier is empty and this deposit
  seeds it first.
- **More than 2% lost:** the quote is refused (`lp_high_impact`) unless you pass
  `allowHighImpact: true`.

**Opt in first:** the user must be opted into `lp.lp_asset_id` to receive LP tokens. Otherwise
`execute` throws `HogswapMissingOptInError` naming it.

## Withdrawing liquidity (LP withdraw)

`quoteLpRedeem` returns LP tokens to the pool.

```js
// Both assets back:
const q = await hogswap.quoteLpRedeem({ poolAppId: 3544790053, tierIndex: 1, lpAmount: 1_000_000n });
q.lp.outputs; // [{ asset_id: 0, expected_out, min_out_at_slippage }, { asset_id: 3178895177, ... }]

// Everything in one asset (the other side is swapped into it):
const q2 = await hogswap.quoteLpRedeem({ poolAppId: 3544790053, tierIndex: 1, lpAmount: 1_000_000n, targetAsset: 0 });
q2.expected_out; // all in ALGO
```

`extraOutputs` (up to 3, `{ assetId, amount? }`) settles part of the withdrawal in other assets.
An entry without `amount` takes a whole side.

To see what an LP holding is worth before withdrawing:

```js
await hogswap.lpToken(3544790059, { amount: 1_000_000n }); // what this holding is backed by, per asset and in USD
```

## Multi-input swaps

Swap 2 to 4 assets into one, in one group:

```js
const q = await hogswap.quote({
  assetOut: 31566704, // USDC
  inputs: [
    { assetId: 0, amount: 10_000_000n },          // 10 ALGO
    { assetId: 3178895177, amount: 5_000_000n },  // 5 HOG
  ],
});
q.deposits;     // what the user sends
q.expected_out; // total USDC
```

Inputs must be distinct and differ from `assetOut`. They can't be combined with `extraOutputs`,
`amountOut` or `coverAlgoFee`.

## Multi-output (basket) swaps

Swap one asset into several. Give the **exact** amount of each extra asset you want. The rest of
the input goes to the main `assetOut`:

```js
const q = await hogswap.quote({
  assetIn: 0, amountIn: 50_000_000n,                       // 50 ALGO
  assetOut: 31566704,                                       // the rest becomes USDC
  extraOutputs: [{ assetId: 3178895177, amount: 5_000_000n }], // exactly 5 HOG
});
q.extra_outputs; // [{ asset_id: 3178895177, amount: "5000000" }]
q.expected_out;  // USDC from what's left
```

- **Limits:** 1 to 3 extra outputs, exact-in only. They must differ from `assetIn` and
  `assetOut`.
- **Opt-ins:** the user must be opted into every output asset.
- **No room:** if the extra targets would use up the whole input, the quote is refused.

## Referrals

LP deposits and withdrawals, multi-input and basket swaps can't carry a referrer. Only plain
swaps can (see [REFERRALS.md](REFERRALS.md)).
