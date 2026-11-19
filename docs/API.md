# API reference

```js
import { HogswapClient } from 'hogswap-v3-js-sdk';
const hogswap = new HogswapClient(options);
```

Every request method returns a Promise and rejects with a `HogswapError` subclass (see
[LIMITS-AND-ERRORS.md](LIMITS-AND-ERRORS.md)). Responses are the API's JSON, unchanged: field
names in `snake_case`, quantities as decimal strings (see [AMOUNTS.md](AMOUNTS.md)). Types for
every response are in `types/index.d.ts`.

Parameter types:

- *amount*: a bigint, a digit string, or a safe integer, in base units.
- *id*: a number, a bigint or a string.

## Options

| Option | Default | |
|---|---|---|
| `baseUrl` | `https://hogswap-v3.liquihog.dev` | |
| `fetch` | `globalThis.fetch` | Pass one for old runtimes or tests |
| `timeoutMs` | `20000` | Per request |
| `retries` | `2` | For 429, 503, 425 and network errors (never `execute` network errors) |
| `rateLimit` | `{ perWindow: 30, windowMs: 10000, inFlight: 4 }` | Client-side pacing; `false` turns it off |
| `apiKey` | none | Only if HogSwap issued you one. Server-side only |
| `headers` | `{}` | Extra headers on every request |

## Swaps

### `quote(params)` → `Quote`

| Param | Type | |
|---|---|---|
| `assetIn` | id | Not with `inputs` |
| `assetOut` | id | Required |
| `amountIn` | amount | Exact in. Give this or `amountOut` |
| `amountOut` | amount | Exact out |
| `inputs` | `[{assetId, amount}]` | Multi-input swap, 2 to 4 inputs |
| `extraOutputs` | `[{assetId, amount}]` | Basket swap, 1 to 3 extra outputs (exact in only) |
| `slippageBps` | 1 to 5000 | Default 50 (0.5%) |
| `maxHops` | 1 to 4 | Default 3 |
| `maxLegs`, `maxOuterTxns` | integer | Cap the route's legs / the group's transactions (leave room for your own: [COMPOSING.md](COMPOSING.md)) |
| `sender` | address | The signing wallet; includes its HOG fee discount |
| `referrer`, `feePpm` | address, 0 to 10000 | Referral (plain swaps only) |
| `coverAlgoFee` | boolean | Take the network fee out of the swap |
| `allowHighImpact` | boolean | (LP deposits) accept more than 2% value loss |
| `excludeVenues`, `excludePools` | venue keys, id[] | Leave venues or pools out (keys in `VENUES`; see [ROUTING-OPTIONS.md](ROUTING-OPTIONS.md)) |

**Key response fields:**
- `quote_id`
- `expected_out`; `expected_out_robust` (slightly conservative); `min_out_at_slippage` (the floor
  the group enforces: `expected_out_robust` less the slippage)
- `legs`, `path_breakdown`
- `router_fee_amount`, `router_fee_ppm_effective`
- `network_fee_microalgo`, `network_fee_max_microalgo`
- on referred quotes: `referrer`, `referrer_fee_amount`, `referrer_share_ppm`

### `quoteLpMint(params)` → `Quote`

Deposit into a pool for its LP token.

| Param | |
|---|---|
| `poolAppId` | Required |
| `tierIndex` | STAMM fee tier, 0 to 5 |
| `amountA`, `amountB` | amounts |
| `externalInputs` | Up to 2 `{assetId, amount}`, swapped into the pool's assets first |

Plus the common `slippageBps`, `sender`, ... The response's `lp` has `expected_lp_out`,
`lp_asset_id`, and value fields.

### `quoteLpRedeem(params)` → `Quote`

Return LP tokens for the pool's assets.

| Param | |
|---|---|
| `poolAppId` | Required |
| `tierIndex` | |
| `lpAmount` | Required |
| `targetAsset` | Settle in one asset |
| `extraOutputs` | Up to 3 `{assetId, amount?}` |

The response's `lp.outputs` lists each asset with `expected_out` and `min_out_at_slippage`.

### `execute({ quoteId, userAddress, prefixTxns?, allowWarnings? })` → `Build`

The unsigned group for a quote, built for `userAddress`.

- `prefixTxns` are your own transactions (base64 or bytes) that run before the group, for
  example the step that funds the swap. They are simulated ahead of the build only, never returned.
- **Response:**
  - `unsigned_group`: `[{txn_b64, description}]`;
  - `group_id_b64`, `min_out_at_slippage`, `network_fee_microalgo`;
  - `notes`, and `warnings` when the group would fail as it stands: execute throws for
    those unless `allowWarnings` (see [LIMITS-AND-ERRORS.md](LIMITS-AND-ERRORS.md)).

### `prepareSwap(params)` → `{ quote, build, txns }`

`quote` then `execute`, with `params.sender` as the user. `txns` is `groupBytes(build)`.

## Referrals

### `referrerStatus(referrer)` → `ReferrerStatus`

- `registered`, `discount_token_id`, `discount_unit`
- `assets: [{asset_id, accrued, can_receive}]`
- `terms`

Cached 10 s per address.

### `referrerSetup({ referrer, assets?, discountTokenId?, discountUnit? })` → `ReferrerGroups`

Open up to 200 assets for earning (`MAX_REFERRER_ASSETS`), and/or register or change a discount
token. Give at least one.

### `referrerClaim({ referrer, assets?, close?, unregister? })` → `ReferrerGroups`

- Pays out every opened asset with a balance, or only `assets` (up to 200).
- `close: true` also deletes each asset's record and refunds its deposit.
- `unregister: true` adds a last group that deletes the discount-token record and refunds its
  deposit. Open assets keep earning; add `close: true` to leave entirely.

`ReferrerGroups`:
- `groups: [{group_id_b64, steps, network_fee_microalgo, deposit_microalgo, unsigned_group}]`
- `group_shape`: `"batch"` (dozens of assets per group) or `"per_asset"`; sign and submit either
  the same way, in order
- `notes`

Sign each group with the platform's wallet and submit them in order.

## Market data

These calls aren't rate limited, but cache what you can.

| Method | Endpoint | Notes |
|---|---|---|
| `health()` | `GET /health` | `ok: true` when serving |
| `assets({limit?, cursor?, q?})` | `GET /assets` | A page of up to 500 (`limit`), `next_cursor` continues; `q` searches name, unit and id |
| `assetsByIds(ids)` | `GET /assets?ids=` | Plus `unknown_ids` |
| `asset(id)` | `GET /assets/{id}` | Name, unit, decimals, total, prices, LP info |
| `assetPools(id, {sort?})` | `GET /assets/{id}/pools` | Every pool holding the asset (large for major assets) |
| `pools({limit?, cursor?, kind?, assetA?, assetB?, minTvlAlgoMicro?})` | `GET /pools` | Paged, filterable |
| `pool(id)` | `GET /pools/{id}` | |
| `prices(ids)` | `GET /prices?ids=` | `price_usd`, `price_algo`, and integer `_micro` forms |
| `tvl()` | `GET /tvl` | Totals |
| `tvlAssets(ids)` | `GET /tvl/assets?ids=` | Per asset |
| `stammPools({activeOnly?, sort?})` | `GET /stamm/pools` | STAMM pools with fee tiers |
| `lpToken(id, {amount?})` | `GET /lp/{id}` | What an LP token (and optionally a holding) is backed by |
| `lpBalance({poolAppId, assetId, amount, tierIndex?})` | `POST /lp/balance` | LP value for a pool |
| `analyticsPrices()` | `GET /analytics/prices` | |
| `iterateAssets(o)`, `iteratePools(o)` | | Async iterators over every page |
| `blocksStreamUrl({pools?})` | `GET /stream/blocks` | Server-sent events URL: one `block` event per round |

## Helpers

| Function | |
|---|---|
| `toBigInt(x)`, `toAmountString(x)`, `toBigIntStrict(x)`, `toId(x)` | Exact conversions |
| `formatUnits(amount, decimals, {maxDecimals?, trimZeros?})`, `parseUnits(text, decimals)` | Display and input |
| `applySlippage(amount, bps)` | Rounded down |
| `groupBytes(build)`, `groupBase64(build)` | The group for wallets |
| `assertFullySigned(signed, n)` | Every transaction signed |
| `submitSignedGroup(signed, algod)`, `waitForConfirmation(txId, algod)`, `submitAndConfirm(signed, algod)` | Submit to your node: `{ algodUrl, algodToken?, algodTokenHeader? }` |
| `composeGroup({ algosdk, build, before?, after? })` | Your transactions before and/or after the swap, one atomic group ([COMPOSING.md](COMPOSING.md), [AFTER-SWAP.md](AFTER-SWAP.md)) |
| `receivedFromSwap({ finalTxId, receiver, assetId }, algod)` | What a confirmed swap paid, as bigint ([AFTER-SWAP.md](AFTER-SWAP.md)) |
| `parseJsonLossless(text)` | `JSON.parse` that keeps 16+ digit integers exact (as strings) |
| `base64ToBytes`, `bytesToBase64` | |

## Constants

| Constant | Value |
|---|---|
| `DEFAULT_BASE_URL` | `https://hogswap-v3.liquihog.dev` |
| `ROUTER_APP_ID` | `3687031461` |
| `ASSETS` | `{ ALGO: 0, USDC: 31566704, HOG: 3178895177 }` |
| `BASE_FEE_PPM` | `500` |
| `FEE_PPM_CAP` | `10000` |
| `RATE_LIMIT` | `{ perWindow: 30, windowMs: 10000, inFlight: 4 }` |
| `QUOTE_TTL_MS` | `30000` |
| `BUILDS_PER_QUOTE` | `5` |
| `MAX_GROUP_SIZE` | `16` |
| `MAX_REFERRER_ASSETS` | `200`: asset ids per referrer setup or claim request |
| `VENUES` | venue keys for `excludeVenues`, with descriptions |
