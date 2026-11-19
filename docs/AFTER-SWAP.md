# Doing something with the swap's output

A common flow: swap into an asset, then use it right away. Examples include:

- depositing it as collateral;
- repaying a loan;
- adding it to a vault or sending it on.

Your transactions can go **after** the swap in the same atomic group. They run once the swap has
paid out, so they can spend its output. If any of them fails, the whole group fails, swap
included, and the user keeps what they started with.

| | Before the swap | After the swap |
|---|---|---|
| Same atomic group | Yes | Yes |
| Can use | what the user already holds | the swap's output too |
| If your step fails | nothing happens at all | nothing happens at all |

## Pattern 1: one atomic group, sized to the guaranteed minimum

The swap guarantees at least `min_out_at_slippage`. Build your step for exactly that amount and put
it after the swap with `composeGroup`. That's one wallet prompt and one submit, all or nothing.

```js
import algosdk from 'algosdk';
import { HogswapClient, composeGroup, submitAndConfirm, toBigInt } from 'hogswap-v3-js-sdk';

const hogswap = new HogswapClient();
const params = await algod.getTransactionParams().do();

// Quote with room for your step (two transactions here).
const quote = await hogswap.quote({
  assetIn: 0, assetOut: USDC, amountIn, sender: user,
  maxOuterTxns: 16 - 2,
});
const amount = toBigInt(quote.min_out_at_slippage);

// Your step: here, a deposit call to your own app with the asset transfer it expects. Build it
// however your protocol needs.
const after = [
  algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: user, receiver: VAULT, assetIndex: USDC, amount, suggestedParams: params }),
  algosdk.makeApplicationNoOpTxnFromObject({ sender: user, appIndex: YOUR_APP, appArgs: [new TextEncoder().encode('deposit')], suggestedParams: params }),
];

const build = await hogswap.execute({ quoteId: quote.quote_id, userAddress: user });
const group = composeGroup({ algosdk, build, after }); // the swap, then yours, one group id

const signed = await signTransactions(group.map((t) => t.toByte()));
await submitAndConfirm(signed, { algodUrl });
```

- **Anything above the minimum** stays in the user's wallet. Usually that's a small amount,
  bounded by the slippage.
- **Don't spend more than `min_out_at_slippage`.** The swap may pay out exactly that. A step sized
  above it fails on a poor fill and takes the swap down with it.
- **Simulate the whole group** before asking for a signature (algod `simulateTransactions` with
  `allowEmptySignatures`). The router checks its own swap, not your transactions.

## Pattern 2: exact amount, a second group

To use every unit the swap paid, for example to close a loan to exactly zero, submit the swap on
its own. Wait for it to confirm, read what it actually delivered, then build and sign the
follow-up:

```js
import { groupBytes, receivedFromSwap } from 'hogswap-v3-js-sdk';

await submitAndConfirm(swapSigned, { algodUrl });

// The router's final transaction pays the output. Its id, from the unsigned group:
const finalTxId = algosdk.decodeUnsignedTransaction(groupBytes(build).at(-1)).txID();
const received = await receivedFromSwap({ finalTxId, receiver: user, assetId: USDC }, { algodUrl });

// Build the follow-up for `received`, ask the user to sign it, submit.
```

`receivedFromSwap` reads the confirmed transaction from your node. Call it soon after
confirmation, because nodes keep that view for a while, not forever. Amounts come back as bigint,
exact at any size.

These two steps are not atomic. If the follow-up fails, the swap stands and the user holds the
asset they swapped into. Tell them so in your UI.

## Which to choose

- **Pattern 1:** one prompt, all or nothing. Best when "at least X" is fine for your action, as
  for most deposits and repayments.
- **Pattern 2:** two prompts. Best when the exact amount matters.
- **Both:** you can combine them. Pattern 1 for the guaranteed part, then an optional top-up with
  the remainder.
  When you do, the swap goes through `composeGroup`, which gives it a new group id and so new
  transaction ids: take the final id from the composed group,
  `group[before.length + groupBytes(build).length - 1].txID()`, not from `build`.

## Both ends together

A position change often needs both ends in one group. For example: withdraw collateral, swap it,
and repay with the proceeds.

```js
const quote = await hogswap.quote({ ...swap, maxOuterTxns: 16 - before.length - after.length });
const build = await hogswap.execute({
  quoteId: quote.quote_id, userAddress: user,
  prefixTxns: before.map((t) => t.toByte()), // the router builds knowing the withdrawal lands first
});
const group = composeGroup({ algosdk, build, before, after });
```

1. **Before:** the withdrawal.
2. **The swap.**
3. **After:** the repayment, sized to `min_out_at_slippage`.

All three succeed or fail together.

## Rules recap

- Nothing can go **between** the swap's own transactions. `composeGroup` keeps them together.
- One swap per group.
- At most 16 transactions in total.

[COMPOSING.md](COMPOSING.md) covers signing a group with more than one sender.
