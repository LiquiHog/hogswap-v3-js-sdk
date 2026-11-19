# Connecting wallets

Every HogSwap action ends the same way: you receive an **unsigned group** (from `execute()`,
`referrerSetup()` or `referrerClaim()`), the user's wallet signs **every** transaction in it, and
you submit the signed group to an Algorand node. HogSwap never sees keys.

The SDK gives you the group in the two shapes wallets take:

```js
import { groupBytes, groupBase64 } from 'hogswap-v3-js-sdk';

groupBytes(build);  // Uint8Array[]: use-wallet, algosdk
groupBase64(build); // string[]: Lute and other ARC-1 wallets
```

After signing, check the result and submit:

```js
import { assertFullySigned, submitAndConfirm } from 'hogswap-v3-js-sdk';

const signed = assertFullySigned(walletResult, txns.length);
await submitAndConfirm(signed, { algodUrl });
```

## Recommended: use-wallet

If you already use [`@txnlab/use-wallet`](https://github.com/TxnLab/use-wallet) (React, Vue,
Solid or vanilla), you're done: it supports Pera, Defly, Lute and others behind one API, and its
`signTransactions` takes the group's bytes directly.

```jsx
import { WalletManager, WalletProvider, WalletId, NetworkId, useWallet } from '@txnlab/use-wallet-react';

const manager = new WalletManager({
  wallets: [
    WalletId.PERA,
    WalletId.DEFLY,
    { id: WalletId.LUTE, options: { siteName: 'Your site name' } },
  ],
  defaultNetwork: NetworkId.MAINNET,
});

// <WalletProvider manager={manager}> ... </WalletProvider>
```

```jsx
const { activeAddress, signTransactions } = useWallet();

const { build, txns } = await hogswap.prepareSwap({ assetIn: 0, assetOut: 31566704, amountIn, sender: activeAddress });
const signed = assertFullySigned(await signTransactions(txns), txns.length);
await submitAndConfirm(signed, { algodUrl });
```

Manager options differ slightly between use-wallet major versions; `signTransactions` works the
same way. Check the use-wallet docs for the version you have.

## Pera and Defly, directly

Pera Connect and Defly Connect share one API. Both take `algosdk.Transaction` objects, so decode
the group with `algosdk` (which you already have if you use them):

```js
import algosdk from 'algosdk';
import { PeraWalletConnect } from '@perawallet/connect';
// Defly: import { DeflyWalletConnect } from '@blockshake/defly-connect';

const pera = new PeraWalletConnect();
const [address] = await pera.connect(); // or pera.reconnectSession() on page load

const txns = groupBytes(build).map((b) => algosdk.decodeUnsignedTransaction(b));
const signed = await pera.signTransaction([txns.map((txn) => ({ txn }))]);
await submitAndConfirm(assertFullySigned(signed, txns.length), { algodUrl });
```

Pass the whole group as **one** inner array, so the wallet shows it as one atomic action.

## Lute, directly

Lute takes base64 transactions:

```js
import LuteConnect from 'lute-connect';

const lute = new LuteConnect('Your site name');
const [address] = await lute.connect('mainnet-v1.0');

const signed = await lute.signTxns(groupBase64(build).map((txn) => ({ txn })));
await submitAndConfirm(assertFullySigned(signed, groupBase64(build).length), { algodUrl });
```

## Server-side signing (bots and backends)

A backend that trades from its own account signs with `algosdk`:

```js
import algosdk from 'algosdk';

const account = algosdk.mnemonicToSecretKey(process.env.BOT_MNEMONIC); // never hard-code it
const signed = groupBytes(build).map((b) => algosdk.decodeUnsignedTransaction(b).signTxn(account.sk));
await submitAndConfirm(signed, { algodUrl, algodToken });
```

See [examples/node-bot-sign.mjs](../examples/node-bot-sign.mjs).

## Opt-ins

On Algorand, an account must opt into an asset before it can receive it. If the user isn't
opted into an asset the swap pays out, `execute()` throws `HogswapMissingOptInError` with the
asset ids in `err.assets`. Build an opt-in (a zero-amount transfer to themselves), have them sign
it, then request a fresh quote:

```js
import algosdk from 'algosdk';

const params = await algod.getTransactionParams().do();
const optIn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
  sender: address, receiver: address, assetIndex: assetId, amount: 0, suggestedParams: params,
});
```

(Field names follow algosdk v3; v2 uses `from`/`to`.) ALGO (asset 0) never needs an opt-in.

## Which node to submit to

Any mainnet algod works: your own, or a hosted one such as `https://mainnet-api.algonode.cloud`.
Hosted public nodes have their own rate limits, so a busy backend should use a node it controls
or a paid plan. `submitAndConfirm` only needs `POST /v2/transactions` and
`GET /v2/transactions/pending/{txid}`.

## Before the user signs

Show them what they're agreeing to. From the quote: `expected_out`, `min_out_at_slippage` (the
worst case, below which the whole group reverts), `router_fee_amount`, and
`network_fee_max_microalgo` (the most the network fee can be). Each transaction in
`build.unsigned_group` also has a short `description`.
