# Using HogSwap from your own scripts

New to this? [GETTING-STARTED.md](GETTING-STARTED.md) walks you through installing everything
and your first swap, step by step. This page is for when you're ready to write your own scripts.

You don't need to be a platform to use the SDK. With your own account you can script swaps,
liquidity moves and rebalances, and run them yourself.

## Setup

```sh
mkdir my-hogswap && cd my-hogswap
npm init -y
npm install algosdk
npm install /path/to/hogswap-v3-js-sdk   # the folder you downloaded or cloned
```

Keep your key out of your code:

- Put the 25-word mnemonic in an environment variable, or your OS keychain.
- Never commit it.
- Add `.env` to `.gitignore` if you use one.
- Consider a separate account for scripts, holding only what they need.

```js
import algosdk from 'algosdk';
const me = algosdk.mnemonicToSecretKey(process.env.MY_MNEMONIC);
const address = me.addr.toString();
```

## Quote, check, then send

A script should show you the deal and wait for a yes before signing. The example
[examples/my-swap.mjs](../examples/my-swap.mjs) does exactly this:

Load your words into the terminal first (see [GETTING-STARTED.md](GETTING-STARTED.md), step 5), then:

```sh
node examples/my-swap.mjs 0 31566704 25        # quote 25 ALGO -> USDC, then ask
node examples/my-swap.mjs 0 31566704 25 --yes  # no prompt (for schedulers)
```

The core of it:

```js
const { quote, build, txns } = await hogswap.prepareSwap({ assetIn, assetOut, amountIn, sender: address });
// show quote.expected_out, quote.min_out_at_slippage, quote.router_fee_amount ...
const signed = txns.map((b) => algosdk.decodeUnsignedTransaction(b).signTxn(me.sk));
await submitAndConfirm(signed, { algodUrl });
```

Always pass `sender: address` when you quote. If you hold HOG, your router fee discount shows up
in the quote.

## Opt-ins

Your account must be opted into an asset before it can receive it:

```js
const params = await algod.getTransactionParams().do();
const optIn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
  sender: address, receiver: address, assetIndex: 31566704, amount: 0, suggestedParams: params,
});
await submitAndConfirm([optIn.signTxn(me.sk)], { algodUrl });
```

Opting in locks 0.1 ALGO of minimum balance per asset, refunded if you opt out later.

## Repeating a trade (DCA)

```js
const every = 60 * 60 * 1000; // hourly
for (;;) {
  try {
    const { txns } = await hogswap.prepareSwap({ assetIn: 31566704, assetOut: 0, amountIn: 5_000_000n, sender: address });
    const signed = txns.map((b) => algosdk.decodeUnsignedTransaction(b).signTxn(me.sk));
    console.log(await submitAndConfirm(signed, { algodUrl }));
  } catch (err) {
    console.error(err.code, err.message); // log and try again next time
  }
  await new Promise((r) => setTimeout(r, every));
}
```

## Good practice

- **Quote and send promptly.** A quote builds for about 30 seconds.
- **Keep slippage sensible:** 50 bps for most pairs. Wider only for thin tokens.
- **Check your balance first**, including ALGO for `network_fee_max_microalgo` above your minimum
  balance.
- **Stay within the limits:** 30 quote and execute calls per 10 s from your IP. The client paces
  itself, and a script trading every few minutes never gets near the limit.
- **Use your own node** if you run many scripts: any algod works for `algodUrl`.
- **Try it first** with a tiny amount. `my-swap.mjs` always asks before sending unless you pass
  `--yes`; `node-bot-sign.mjs` stops before signing with `DRY_RUN=1`.

## Liquidity from a script

The same pattern works for LP deposits and withdrawals: `quoteLpMint` or `quoteLpRedeem`, then
`execute`, sign and submit. See [LP-AND-MULTI-ASSET.md](LP-AND-MULTI-ASSET.md), and
[examples/lp.mjs](../examples/lp.mjs) for a quote-only walk-through.
