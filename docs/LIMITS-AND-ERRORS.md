# Limits and errors

## Rate limits

| Endpoint | Limit, per client IP |
|---|---|
| `POST /quote`, `POST /execute`, every `/referrer/...` call (GET included) | 30 requests per 10 s, shared; at most 4 running at once |
| Market data: `/assets`, `/prices`, `/pools`, `/tvl`, `/lp`, `/stamm/...`, `/health` | not rate limited |

- **Over the window:** `429` with `Retry-After` (seconds).
- **More than 4 at once:** `429`.
- **The router as a whole momentarily full:** `503` with `Retry-After: 1`.
- **Still starting after a restart:** `425`.

### What the client does for you

- **Paces itself:** `quote`, `execute` and `referrer*` calls queue so they never exceed the
  window or the in-flight cap. Turn it off with `new HogswapClient({ rateLimit: false })`.
- **Retries** (default 2 times) rate-limit, busy and starting answers after the server's
  `Retry-After`, and network errors on everything except `execute`.
- **Never retries `execute` after a network error**, because each build spends one of the
  quote's 5 builds. Request a new quote instead.

### Browser or server

- **In a browser,** call the API straight from the page. Each visitor has their own IP and so
  their own limit. No key is needed, and none should ever be in browser code.
- **On a server,** every one of your users shares your server's IP, and so one limit. Share a
  single `HogswapClient`, cache market data, and don't proxy quotes you could make from the
  browser.

### Good habits

- **Debounce** quotes while the user types (300 to 500 ms).
- **Re-quote** when the quote is older than about 20 s, or when the amount changes.
- **Quote once,** then build when the user confirms. A quote builds for about 30 s, at most 5
  times.
- **Cache** asset lists and prices for a few seconds or more. They change at most once per block
  (about 2.8 s).

## Quote lifetime

- A quote id is valid for about 30 seconds, and can be built at most 5 times.
- After that, `execute()` throws `HogswapQuoteExpiredError`. Its `code` is `quote_expired`, or
  `build_budget_spent` after 5 builds.
- Request a fresh quote.

## Builds that would fail as they stand

The router checks every build against current chain state. Problems it finds don't stop the
build, because you may fix some yourself in front of the group, but the build reports them in
`warnings`:

| Warning | Meaning | `execute()` throws |
|---|---|---|
| `missing_opt_in` | the user isn't opted into an output asset (`assets` lists them) | `HogswapMissingOptInError` |
| `insufficient_balance` | the user can't fund the group (balance or minimum balance) | `HogswapBuildError`, code `insufficient_balance` |
| `simulate_failed` | the group failed simulation for another reason (`detail` says why) | `HogswapBuildError`, code `build_failed` |
| `min_out_risk` | the swap settles just under `min_out_at_slippage` right now: prices are moving | no, it's returned; consider re-quoting |

- **Fixing it yourself,** for example with an opt-in in front of the group: pass that fix as
  `prefixTxns`. The build then checks the group with the fix applied, and the warning goes away.
- **`allowWarnings: true`** returns the build regardless.

## Error classes

Every error is a `HogswapError` with `status` (0 if no response), `code`, `detail` (the server's
message) and `body`.

| Class | `code` | When | What to do |
|---|---|---|---|
| `HogswapInputError` | `invalid_input` | A bad argument, caught before sending | Fix the call |
| `HogswapNoRouteError` | `no_route` | `quote`: 404, no route fits this trade | Try a smaller amount, another pair, or more slippage |
| `HogswapQuoteExpiredError` | `quote_expired`, `build_budget_spent` | `execute`: the quote is gone | Quote again |
| `HogswapMissingOptInError` | `missing_opt_in` | `execute`: the wallet can't receive an output; `err.assets` lists them | Opt in, then quote again |
| `HogswapBuildError` | `build_failed`, `insufficient_balance` | `execute`: 409, the group failed simulation on current chain state (balance, price moved) | Check the balance, then quote again |
| `HogswapRateLimitError` | `rate_limited` | 429 after retries; `err.retryAfterMs` | Slow down |
| `HogswapUnavailableError` | `busy`, `starting` | 503 or 425 after retries | Retry shortly |
| `HogswapSubmitError` | `submit_failed`, `pool_error`, `timeout`, `network` | Your algod refused, rejected or didn't confirm the group | See the message; a `pool_error` is final |
| `HogswapError` | `invalid_request` (422), `bad_request` (400), `not_found` (404 on other paths), `unauthorized` (401), `upstream` (502), `timeout`, `network` | Everything else | See `detail` |

```js
import { HogswapMissingOptInError, HogswapQuoteExpiredError, HogswapNoRouteError } from 'hogswap-v3-js-sdk';

try {
  const build = await hogswap.execute({ quoteId, userAddress });
} catch (err) {
  if (err instanceof HogswapMissingOptInError) askUserToOptIn(err.assets);
  else if (err instanceof HogswapQuoteExpiredError) requote();
  else throw err;
}
```

## Network fees

- **`network_fee_microalgo`** is a typical fee for the group: an estimate, good for display.
- **`network_fee_max_microalgo`** is the most it can be. Use it to check the user has enough
  ALGO.
- The router fee is separate. It's taken from the swap output and reported as
  `router_fee_amount`.
