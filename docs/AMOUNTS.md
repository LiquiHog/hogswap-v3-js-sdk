# Amounts and big numbers

## The rules

1. **Amounts are base units.** 1 ALGO is `1000000` (6 decimals). Each asset has its own
   `decimals`; read it from `asset(id)` or `assetsByIds(ids)`.
2. **The API sends quantities as decimal strings.** `expected_out`, `min_out_at_slippage`, fees,
   reserves, supplies and referral balances all arrive as strings like `"778891"`.
3. **Do arithmetic in BigInt.** Convert with `toBigInt()` first.
4. **Send amounts as bigint or strings.** The SDK also accepts a `number`, but only a safe integer.

## Why

Algorand amounts go up to 2^64 - 1 (18,446,744,073,709,551,615). A JavaScript `number` is exact
only up to 2^53 - 1 (9,007,199,254,740,991). Above that, numbers round silently:

```js
JSON.parse('{"total": 18446744073709551615}').total; // 18446744073709552000: wrong
```

Real assets cross that line: tokens with 18 decimals, or large supplies. If you read amounts as
numbers you'll show wrong balances, and if you send them as numbers you'll quote the wrong amount.
Strings and BigInt are exact at every size.

## Converting

```js
import { toBigInt, formatUnits, parseUnits, toAmountString } from 'hogswap-v3-js-sdk';

parseUnits('12.5', 6);                // 12500000n: user input to base units
formatUnits('12500000', 6);           // "12.5": base units to display
formatUnits(1999999n, 6, { maxDecimals: 2 }); // "1.99": truncated, never rounded up

const out = toBigInt(quote.expected_out); // bigint, or null/undefined passed through
toAmountString(out);                      // "778891": what the API takes
```

`parseUnits` refuses more decimal places than the asset has, so `"0.0000001"` for a 6-decimal
asset is an error, not a silent truncation.

## Common mistakes

**Mixing BigInt and Number.** JavaScript refuses it:

```js
toBigInt(quote.expected_out) * 0.99;          // TypeError: Cannot mix BigInt and other types
toBigInt(quote.expected_out) * 99n / 100n;    // correct (rounds down)
```

**Floating point for money.** `Number(quote.expected_out) / 1e6` is fine for a rough chart, but
never for amounts you send or compare. Use `formatUnits` to display and bigint to calculate.

**`JSON.stringify` and BigInt.** `JSON.stringify({ a: 1n })` throws. When you store or send a
bigint yourself, convert it with `.toString()` (or `toAmountString`). The SDK does this for every
request it makes.

**`Math.min` / `Math.max` with BigInt.** They don't accept bigints. Compare directly:
`a < b ? a : b`.

**Sorting.** `list.sort((x, y) => x - y)` breaks on bigints (the comparator must return a
number). Use `(x, y) => (x < y ? -1 : x > y ? 1 : 0)`.

**Prices.** `price_usd` and `price_algo` are decimal strings with high precision, for display.
`price_usd_micro` and `price_algo_micro` are integer strings (millionths) for exact math.

## Ids

Asset, app and pool ids are JSON numbers. They're far below 2^53 today. The SDK accepts them as
numbers, bigints or strings.
