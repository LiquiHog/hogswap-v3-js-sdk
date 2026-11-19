# Adding your own transactions to a swap

If your product needs something to happen in the same atomic step as the swap, you can put your
own transactions in the same group, before the swap, after it, or both. The group then succeeds
or fails as one: either everything happens, or nothing does. Examples include:

- before: a payment to your platform, an opt-in the user needs first, a withdrawal that funds the
  swap;
- after: depositing the swap's output as collateral, repaying a loan, sending it on (see
  [AFTER-SWAP.md](AFTER-SWAP.md)).

## The rules

These come from the router contract:

1. **Before, after, or both, but never in between.** Nothing can go between the router's own
   transactions. `composeGroup` keeps them together.
2. **One swap per group.** The router refuses a second route in the same group.
3. **At most 16 transactions in total.** That's Algorand's limit for one group. Quote with
   `maxOuterTxns: 16 - before.length - after.length` so the swap leaves room.
4. **Order matters.** Transactions before the swap can't use its output (they can fund it,
   though: a withdrawal in front of the swap is fine).
   Transactions after it can also spend the swap's output, up to `min_out_at_slippage`.
5. **Everyone signs.** Every transaction needs its sender's signature. If one of yours is sent by
   your platform's account, your backend signs it, and the user's wallet signs the rest.
6. **Submit the whole group.** Changing, adding or removing anything after regrouping invalidates
   it.

## Step by step

```js
import algosdk from 'algosdk';
import { HogswapClient, composeGroup, submitAndConfirm } from 'hogswap-v3-js-sdk';

const hogswap = new HogswapClient();
const params = await algod.getTransactionParams().do();

// 1. Your transaction(s). Here: a 0.1 ALGO payment from the user to your platform.
const mine = [
  algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: user, receiver: PLATFORM, amount: 100_000, suggestedParams: params,
  }),
];

// 2. Quote with room left for them.
const quote = await hogswap.quote({
  assetIn: 0, assetOut: 31566704, amountIn: 10_000_000n,
  sender: user,
  maxOuterTxns: 16 - mine.length,
});

// 3. Build, telling the router about your transactions, so it checks the swap against the
//    balances they leave behind.
const build = await hogswap.execute({
  quoteId: quote.quote_id,
  userAddress: user,
  prefixTxns: mine.map((t) => t.toByte()),
});

// 4. One group: yours first, then the swap, with a new group id.
const group = composeGroup({ algosdk, build, before: mine });

// 5. Sign. With use-wallet, pass bytes; with Pera or Defly, pass the Transaction objects.
const signed = await signTransactions(group.map((t) => t.toByte()));

// 6. Submit.
await submitAndConfirm(signed, { algodUrl });
```

`composeGroup` takes your `algosdk` module as an argument (v2 or v3), so this SDK stays
dependency-free. It clears the swap's old group id, puts `before` in front of the swap and `after`
behind it, and assigns one new group id to all of them. Pass `before`, `after`, or both.

## About `prefixTxns`

`prefixTxns` tells the router what runs before the swap. (There's no equivalent for `after`:
those run once the swap is done, so they can't change how it's built.) The router simulates them ahead of the
swap while building, so the build sees the balances they leave behind. They aren't returned or
signed by the router; you still add them with `composeGroup`. If they can't run on current chain
state, the build notes it (`prefix_simulated: false`) and checks the swap alone.

## Fees and validity

- **Fees:** each of your transactions pays its own network fee (at least 0.001 ALGO), on top of
  the swap's `network_fee_max_microalgo`.
- **Validity:** build your transactions from fresh suggested params, so their validity window
  overlaps the swap's. Submit within about 30 seconds of the quote.

## Signing a mixed group

When the group has transactions from two senders (the user and your platform):

```js
// algosdk v3 (on v2, use t.from instead of t.sender).
// Your backend signs its own transactions:
const platformSigned = group.map((t) => (t.sender.toString() === PLATFORM ? t.signTxn(platformKey) : null));
// The user's wallet signs the rest. use-wallet: signTransactions(bytes, indexesToSign)
const userIdx = group.map((t, i) => (t.sender.toString() === user ? i : -1)).filter((i) => i >= 0);
const userSigned = await signTransactions(group.map((t) => t.toByte()), userIdx);
const signed = group.map((_, i) => platformSigned[i] ?? userSigned[i]);
```

Every slot must end up signed (`assertFullySigned` checks it) before you submit.

## Show users the whole group

A transaction placed after the swap can move the swap's output anywhere, and it's signed in the
same prompt as the swap. So:

- **Builders:** show your users what each of your transactions does before they sign, and don't
  add anything they didn't ask for.
- **Wallets and users:** read every transaction in a swap's signing request, not only the swap.
  A transfer of the output to an address you don't recognise is a red flag.
