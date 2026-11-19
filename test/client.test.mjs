import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HogswapClient,
  HogswapInputError,
  HogswapMissingOptInError,
  HogswapNoRouteError,
  HogswapQuoteExpiredError,
  HogswapRateLimitError,
  HogswapBuildError,
  RateLimiter,
  groupBytes,
  groupBase64,
  bytesToBase64,
  base64ToBytes,
  assertFullySigned,
  submitSignedGroup,
} from '../src/index.js';

const ADDR = 'AEBAGBAFAYDQQCIKBMGA2DQPCAIREEYUCULBOGAZDINRYHI6D4QDTYK3BA';

/** A fake fetch that records requests and replies from a queue. */
function fakeFetch(replies) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body === undefined ? undefined : init.body });
    const r = replies.shift() ?? { status: 200, body: {} };
    const headers = new Map(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (k) => headers.get(k.toLowerCase()) ?? null },
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
      json: async () => r.body,
    };
  };
  f.calls = calls;
  return f;
}

const client = (f, extra = {}) => new HogswapClient({ fetch: f, rateLimit: false, retries: 1, ...extra });

test('quote sends snake_case fields with amounts as exact strings', async () => {
  const f = fakeFetch([{ status: 200, body: { quote_id: 'q1', expected_out: '778891' } }]);
  const q = await client(f).quote({ assetIn: 0, assetOut: 31566704n, amountIn: 10_000_000n, slippageBps: 30, sender: ADDR });
  assert.equal(q.quote_id, 'q1');
  const call = f.calls[0];
  assert.equal(call.method, 'POST');
  assert.equal(call.url, 'https://hogswap-v3.liquihog.dev/quote');
  assert.deepEqual(JSON.parse(call.body), { asset_in: 0, asset_out: 31566704, amount_in: '10000000', slippage_bps: 30, sender: ADDR });
});

test('a referred quote carries referrer and fee_ppm; referral rules are checked locally', async () => {
  const f = fakeFetch([{ status: 200, body: {} }]);
  await client(f).quote({ assetIn: 0, assetOut: 31566704, amountIn: '1000000', referrer: ADDR, feePpm: 5000 });
  assert.deepEqual(JSON.parse(f.calls[0].body), { asset_in: 0, asset_out: 31566704, amount_in: '1000000', referrer: ADDR, fee_ppm: 5000 });
  const c = client(fakeFetch([]));
  await assert.rejects(c.quote({ assetIn: 0, assetOut: 1, amountIn: 1, referrer: ADDR, feePpm: 10001 }), HogswapInputError);
  await assert.rejects(c.quote({ assetIn: 0, assetOut: 1, amountIn: 1, feePpm: 100 }), HogswapInputError);
  await assert.rejects(c.quote({ assetIn: 0, assetOut: 1, amountIn: 1, referrer: ADDR, coverAlgoFee: true }), HogswapInputError);
  await assert.rejects(c.quote({ assetOut: 1, inputs: [{ assetId: 0, amount: 1 }, { assetId: 2, amount: 1 }], referrer: ADDR }), HogswapInputError);
});

test('quote input checks: exactly one amount, positive, no unsafe numbers', async () => {
  const c = client(fakeFetch([]));
  await assert.rejects(c.quote({ assetIn: 0, assetOut: 1 }), HogswapInputError);
  await assert.rejects(c.quote({ assetIn: 0, assetOut: 1, amountIn: 1, amountOut: 1 }), HogswapInputError);
  await assert.rejects(c.quote({ assetIn: 0, assetOut: 1, amountIn: 0 }), HogswapInputError);
  await assert.rejects(c.quote({ assetIn: 0, assetOut: 1, amountIn: 2 ** 60 }), HogswapInputError);
  await assert.rejects(c.quote({ assetIn: 0, assetOut: 1, amountIn: 1, slippageBps: 0 }), HogswapInputError);
});

test('exact-out, multi-input, basket and LP bodies', async () => {
  const f = fakeFetch([{ status: 200, body: {} }, { status: 200, body: {} }, { status: 200, body: {} }, { status: 200, body: {} }, { status: 200, body: {} }]);
  const c = client(f);
  await c.quote({ assetIn: 31566704, assetOut: 0, amountOut: '5000000' });
  await c.quote({ assetOut: 0, inputs: [{ assetId: 31566704, amount: 1n }, { assetId: 3178895177, amount: '2' }] });
  await c.quote({ assetIn: 0, assetOut: 31566704, amountIn: 9n, extraOutputs: [{ assetId: 3178895177, amount: 3n }] });
  await c.quoteLpMint({ poolAppId: 3544790053, tierIndex: 1, amountA: 1000000n, amountB: '470000' });
  await c.quoteLpRedeem({ poolAppId: 3544790053, tierIndex: 1, lpAmount: 5n, targetAsset: 0 });
  const bodies = f.calls.map((x) => JSON.parse(x.body));
  assert.deepEqual(bodies[0], { asset_out: 0, asset_in: 31566704, amount_out: '5000000' });
  assert.deepEqual(bodies[1], { asset_out: 0, inputs: [{ asset_id: 31566704, amount: '1' }, { asset_id: 3178895177, amount: '2' }] });
  assert.deepEqual(bodies[2], { asset_out: 31566704, asset_in: 0, amount_in: '9', extra_outputs: [{ asset_id: 3178895177, amount: '3' }] });
  assert.deepEqual(bodies[3], { mode: 'LP_MINT', pool_app_id: 3544790053, tier_index: 1, amount_a: '1000000', amount_b: '470000' });
  assert.deepEqual(bodies[4], { mode: 'LP_REDEEM', pool_app_id: 3544790053, lp_amount: '5', tier_index: 1, target_asset: 0 });
});

test('errors map to specific classes', async () => {
  const c = (reply) => client(fakeFetch([reply]), { retries: 0 });
  await assert.rejects(c({ status: 404, body: { detail: 'no route' } }).quote({ assetIn: 0, assetOut: 1, amountIn: 1 }), HogswapNoRouteError);
  await assert.rejects(c({ status: 404, body: { detail: 'quote_id q not found or expired' } }).execute({ quoteId: 'q', userAddress: ADDR }), HogswapQuoteExpiredError);
  await assert.rejects(
    c({ status: 429, body: { detail: 'quote_id q exceeded its 5-build budget — request a fresh quote' } }).execute({ quoteId: 'q', userAddress: ADDR }),
    (e) => e instanceof HogswapQuoteExpiredError && e.code === 'build_budget_spent',
  );
  await assert.rejects(c({ status: 409, body: { detail: 'build failed: x' } }).execute({ quoteId: 'q', userAddress: ADDR }), HogswapBuildError);
  await assert.rejects(
    c({ status: 422, body: { detail: 'user is not opted into output asset(s) [31566704]', error: 'missing_opt_in', assets: [31566704] } }).execute({ quoteId: 'q', userAddress: ADDR }),
    (e) => e instanceof HogswapMissingOptInError && e.assets[0] === 31566704,
  );
  await assert.rejects(
    c({ status: 429, headers: { 'Retry-After': '10' }, body: { error: 'rate limited', detail: '30 requests/10s per IP — slow down' } }).quote({ assetIn: 0, assetOut: 1, amountIn: 1 }),
    (e) => e instanceof HogswapRateLimitError && e.retryAfterMs === 10000,
  );
});

test('a 503 busy answer is retried after Retry-After, then succeeds', async () => {
  const f = fakeFetch([{ status: 503, headers: { 'Retry-After': '0' }, body: { detail: 'router busy — retry shortly' } }, { status: 200, body: { ok: true } }]);
  const h = await client(f, { retries: 1 }).request('POST', '/quote', { body: {}, limited: true });
  assert.equal(h.ok, true);
  assert.equal(f.calls.length, 2);
});

test('execute is never retried after a network failure (it would spend a build)', async () => {
  let n = 0;
  const f = async () => {
    n += 1;
    throw new TypeError('socket hang up');
  };
  await assert.rejects(new HogswapClient({ fetch: f, rateLimit: false, retries: 3 }).execute({ quoteId: 'q', userAddress: ADDR }));
  assert.equal(n, 1);
});

test('referrer calls validate and send the documented fields', async () => {
  const f = fakeFetch([{ status: 200, body: {} }, { status: 200, body: {} }, { status: 200, body: {} }]);
  const c = client(f);
  await c.referrerStatus(ADDR);
  await c.referrerSetup({ referrer: ADDR, assets: [0, 31566704n], discountTokenId: 3178895177, discountUnit: 1_000_000_000n });
  await c.referrerClaim({ referrer: ADDR, close: true, unregister: true });
  assert.equal(f.calls[0].url, `https://hogswap-v3.liquihog.dev/referrer/${ADDR}`);
  assert.deepEqual(JSON.parse(f.calls[1].body), { referrer: ADDR, assets: [0, 31566704], discount_token_id: 3178895177, discount_unit: '1000000000' });
  assert.deepEqual(JSON.parse(f.calls[2].body), { referrer: ADDR, close: true, unregister: true });
  await assert.rejects(c.referrerSetup({ referrer: ADDR }), HogswapInputError);
  await assert.rejects(c.referrerSetup({ referrer: ADDR, discountTokenId: 5 }), HogswapInputError);
  await assert.rejects(c.referrerSetup({ referrer: ADDR, assets: [0], discountUnit: 5n }), HogswapInputError);
  await assert.rejects(c.quoteLpMint({ poolAppId: 1, amountA: 5n, referrer: ADDR, feePpm: 5000 }), HogswapInputError);
  await assert.rejects(c.quoteLpRedeem({ poolAppId: 1, lpAmount: 5n, referrer: ADDR }), HogswapInputError);
  const many = Array.from({ length: 201 }, (_, i) => i + 1);
  await assert.rejects(c.referrerSetup({ referrer: ADDR, assets: many }), HogswapInputError);
  await assert.rejects(c.referrerClaim({ referrer: ADDR, assets: many }), HogswapInputError);
  await c.referrerSetup({ referrer: ADDR, assets: many.slice(0, 200) });
  await assert.rejects(c.referrerStatus('not-an-address'), HogswapInputError);
});

test('data calls build query strings and paginate', async () => {
  const f = fakeFetch([
    { status: 200, body: { assets: [{ asset_id: 0 }], next_cursor: '0' } },
    { status: 200, body: { assets: [{ asset_id: 31566704 }], next_cursor: null } },
    { status: 200, body: { prices: [] } },
  ]);
  const c = client(f);
  const ids = [];
  for await (const a of c.iterateAssets({ limit: 1 })) ids.push(a.asset_id);
  assert.deepEqual(ids, [0, 31566704]);
  assert.equal(f.calls[1].url, 'https://hogswap-v3.liquihog.dev/assets?limit=1&cursor=0');
  await c.prices([0, 31566704n, '3178895177']);
  assert.equal(f.calls[2].url, 'https://hogswap-v3.liquihog.dev/prices?ids=0%2C31566704%2C3178895177');
});

test('API keys go in a header only when configured', async () => {
  const f = fakeFetch([{ status: 200, body: {} }, { status: 200, body: {} }]);
  await client(f).health();
  await client(f, { apiKey: 'k' }).health();
  assert.equal(f.calls[0].headers['X-API-Key'], undefined);
  assert.equal(f.calls[1].headers['X-API-Key'], 'k');
});

test('group helpers round-trip base64 and check signatures', () => {
  const raw = [new Uint8Array([1, 2, 3]), new Uint8Array([255, 0])];
  const build = { unsigned_group: raw.map((b) => ({ txn_b64: bytesToBase64(b) })) };
  assert.deepEqual(groupBase64(build), ['AQID', '/wA=']);
  assert.deepEqual(groupBytes(build).map((b) => [...b]), [[1, 2, 3], [255, 0]]);
  assert.deepEqual([...base64ToBytes('AQID')], [1, 2, 3]);
  assert.throws(() => assertFullySigned([raw[0], null], 2), HogswapInputError);
  assert.throws(() => assertFullySigned([raw[0]], 2), HogswapInputError);
  assert.equal(assertFullySigned(raw, 2).length, 2);
});

test('submitSignedGroup posts the concatenated group to algod', async () => {
  const f = fakeFetch([{ status: 200, body: { txId: 'TX1' } }]);
  const r = await submitSignedGroup([new Uint8Array([1]), new Uint8Array([2, 3])], { algodUrl: 'https://node.example/', algodToken: 't', fetch: f });
  assert.equal(r.txId, 'TX1');
  assert.equal(f.calls[0].url, 'https://node.example/v2/transactions');
  assert.equal(f.calls[0].headers['X-Algo-API-Token'], 't');
  assert.deepEqual([...f.calls[0].body], [1, 2, 3]);
});

test('the rate limiter holds starts to the window and in-flight cap', async () => {
  let now = 0;
  const sleeps = [];
  const lim = new RateLimiter({ perWindow: 2, windowMs: 1000, inFlight: 5 }, {
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
  });
  const r1 = await lim.acquire();
  const r2 = await lim.acquire();
  const third = lim.acquire(); // window full: waits until t=1000
  const r3 = await third;
  assert.equal(now, 1000);
  assert.deepEqual(sleeps, [1000]);
  [r1, r2, r3].forEach((r) => r());

  const lim2 = new RateLimiter({ perWindow: 100, windowMs: 1000, inFlight: 1 });
  const a = await lim2.acquire();
  let gotB = false;
  const b = lim2.acquire().then((rel) => {
    gotB = true;
    return rel;
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(gotB, false); // in-flight cap holds it
  a();
  (await b)();
  assert.equal(gotB, true);
});
