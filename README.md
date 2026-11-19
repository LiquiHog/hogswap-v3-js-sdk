# hogswap-v3-js-sdk

JavaScript SDK for the **HogSwap v3** router on Algorand.

- **Best-price swaps** across Algorand DEXes, split over many pools when that pays more.
- **Unsigned transaction groups** for any wallet: Pera, Defly, Lute, or anything use-wallet supports.
- **The referral programme**: platforms earn part of the fee on every swap they send.
- **Market data**: assets, prices, pools, TVL and LP tokens.

Zero runtime dependencies. Works in browsers and Node 18+. ESM, with TypeScript types included.

HogSwap never holds keys. The router returns unsigned transactions; your user's wallet signs
them, and you submit them to an Algorand node you choose.

## Install

Download or clone this repository, then add it to your project from that folder:

```sh
npm install /path/to/hogswap-v3-js-sdk
```

It has no dependencies of its own. Imports then work as shown below
(`from 'hogswap-v3-js-sdk'`). npm links to that folder rather than copying it, so keep it where
it is (or run `npm pack` in it and install the `.tgz` file instead).

**New to this?** [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) walks you through your first
swap from your own computer, step by step. Running a wallet, site or bot that wants to earn on
the swaps it sends? [docs/REFERRAL-WALKTHROUGH.md](docs/REFERRAL-WALKTHROUGH.md) goes from nothing
to your first claim.

## Quick start

```js
import { HogswapClient, ASSETS, parseUnits, formatUnits } from 'hogswap-v3-js-sdk';

const hogswap = new HogswapClient();

// 10 ALGO to USDC. Amounts are base units: ALGO and USDC both have 6 decimals.
const quote = await hogswap.quote({
  assetIn: ASSETS.ALGO,
  assetOut: ASSETS.USDC,
  amountIn: parseUnits('10', 6), // 10000000n
});

console.log('expected', formatUnits(quote.expected_out, 6), 'USDC');
console.log('at least', formatUnits(quote.min_out_at_slippage, 6), 'USDC');
```

## A full swap

```js
import { HogswapClient, groupBytes, assertFullySigned, submitAndConfirm } from 'hogswap-v3-js-sdk';

const hogswap = new HogswapClient();

// 1. Quote with the signing wallet as sender, so its fee discount (if any) is included.
const quote = await hogswap.quote({ assetIn: 0, assetOut: 31566704, amountIn: 10_000_000n, sender: address });

// 2. Build the unsigned group for that wallet. Nothing is signed or sent.
const build = await hogswap.execute({ quoteId: quote.quote_id, userAddress: address });

// 3. Sign every transaction with the user's wallet (see docs/WALLETS.md).
const txns = groupBytes(build);
const signed = assertFullySigned(await signTransactions(txns), txns.length);

// 4. Submit to your node and wait for confirmation.
const { txId, confirmedRound } = await submitAndConfirm(signed, { algodUrl: 'https://mainnet-api.algonode.cloud' });
```

`prepareSwap()` does steps 1 and 2 in one call and returns `{ quote, build, txns }`.

The group is atomic, and the router reverts it if the user would receive less than
`min_out_at_slippage`. Submit it exactly as built: changing, reordering or dropping a transaction
invalidates the group.

## Wallets

| Wallet | Package | Takes |
|---|---|---|
| Any of these, with one API | `@txnlab/use-wallet-react` (also `-vue`, `-solid`, or the core `@txnlab/use-wallet`) | `groupBytes(build)` |
| Pera | `@perawallet/connect` | `algosdk.Transaction` objects |
| Defly | `@blockshake/defly-connect` | `algosdk.Transaction` objects |
| Lute | `lute-connect` | `groupBase64(build)` |

[docs/WALLETS.md](docs/WALLETS.md) has setup and signing code for each, plus server-side signing
for bots.

## Amounts and big numbers

Algorand amounts are 64-bit integers, and many balances and supplies are larger than a JavaScript
`number` can hold exactly. So:

- the API returns every quantity as a **decimal string** (`"18446744073709551615"`);
- the SDK accepts amounts as a **bigint**, a **digit string**, or a **safe integer** `number`,
  and refuses anything that could lose precision;
- `toBigInt()`, `formatUnits()` and `parseUnits()` convert exactly, with no floating point.

```js
import { toBigInt, formatUnits } from 'hogswap-v3-js-sdk';

const expected = toBigInt(quote.expected_out);        // bigint, after the router fee
const worst = toBigInt(quote.min_out_at_slippage);    // the least the user can receive
const room = expected - worst;                        // BigInt arithmetic, exact
formatUnits(expected, 6);                             // e.g. "0.778891" for 778891 base units
```

[docs/AMOUNTS.md](docs/AMOUNTS.md) has the rules and the common mistakes.

## Referral programme

Platforms earn on swaps they route: pass your address and a rate with each quote.

```js
const quote = await hogswap.quote({
  assetIn: 0, assetOut: 31566704, amountIn: 10_000_000n,
  referrer: 'YOUR_PLATFORM_ADDRESS',
  feePpm: 5000, // 0.5%, up to 10000 (1%)
});
quote.referrer_fee_amount; // your expected share of this swap, in base units of the output asset
```

You keep half of the fee above the router's 0.05% base fee. It accrues in the router, and you
claim it when you like:

```js
await hogswap.referrerSetup({ referrer, assets: [0, 31566704] }); // once per asset you earn in
await hogswap.referrerStatus(referrer);                            // balances
await hogswap.referrerClaim({ referrer });                         // unsigned claim groups
```

[docs/REFERRALS.md](docs/REFERRALS.md) covers the terms, deposits, discount tokens and claiming.

## Routing options

Narrow or shape the route: `slippageBps`, `maxHops` (1 to 4), `maxLegs`, `maxOuterTxns`
(group size), and `excludeVenues` / `excludePools` (venue keys are in `VENUES`).
[docs/ROUTING-OPTIONS.md](docs/ROUTING-OPTIONS.md) explains each one and when to use it.

## Liquidity and multi-asset swaps

- `quoteLpMint` and `quoteLpRedeem`: deposit into and withdraw from STAMM, Tinyman v2 and Pact
  weighted pools, two-sided, one-sided or from a third asset.
- `quote({ inputs })`: swap 2 to 4 assets into one.
- `quote({ extraOutputs })`: swap one asset into several.

See [docs/LP-AND-MULTI-ASSET.md](docs/LP-AND-MULTI-ASSET.md).

## Adding your own transactions

Your product can put its own transactions in the same atomic group as a swap, before it, after
it, or both, within Algorand's 16-transaction limit. Before: a payment, an opt-in, a withdrawal
that funds the swap. After: deposit the output as collateral, repay a loan, send it on.

```js
const quote = await hogswap.quote({ ...params, maxOuterTxns: 16 - before.length - after.length });
const build = await hogswap.execute({ quoteId: quote.quote_id, userAddress, prefixTxns: before.map((t) => t.toByte()) });
const group = composeGroup({ algosdk, build, before, after }); // one group id, all or nothing
```

Transactions after the swap can spend up to `min_out_at_slippage` of its output.
[docs/COMPOSING.md](docs/COMPOSING.md) has the rules and a mixed-signer example;
[docs/AFTER-SWAP.md](docs/AFTER-SWAP.md) covers using the output, including the exact amount
received.

## For your own scripts

Not a platform? Script swaps and liquidity from your own account: quote, check, confirm, send.
[docs/PERSONAL-USE.md](docs/PERSONAL-USE.md) and [examples/my-swap.mjs](examples/my-swap.mjs).

## Limits

| What | Limit (per IP) |
|---|---|
| `quote`, `execute`, and all `referrer*` calls | 30 per 10 s, shared; at most 4 at once |
| Market data (`assets`, `prices`, `pools`, ...) | not rate limited; cache what you can |
| A quote | builds for about 30 s, at most 5 times |

The client paces itself to these limits by default and retries rate-limit and busy answers.
In a browser each visitor has their own limit. On a server, every user shares your server's IP,
so share one client and avoid quoting on every keystroke.
[docs/LIMITS-AND-ERRORS.md](docs/LIMITS-AND-ERRORS.md) has the details and every error class.

## API reference

[docs/API.md](docs/API.md) lists every method, its parameters and its response.

## Examples

- [examples/node-quote.mjs](examples/node-quote.mjs): a quote from Node, nothing signed.
- [examples/my-swap.mjs](examples/my-swap.mjs): swap from your own account, with a confirmation prompt.
- [examples/lp.mjs](examples/lp.mjs): LP deposit and withdraw quotes.
- [examples/compose-before-swap.mjs](examples/compose-before-swap.mjs): your own transaction in the swap's group.
- [examples/after-swap.mjs](examples/after-swap.mjs): use the swap's output in the same atomic group.
- [examples/node-bot-sign.mjs](examples/node-bot-sign.mjs): quote, build, sign with a server key, submit.
- [examples/use-wallet-react.jsx](examples/use-wallet-react.jsx): a swap box with use-wallet.
- [examples/referral-platform.mjs](examples/referral-platform.mjs): referral setup, status and claim.

## License

MIT
