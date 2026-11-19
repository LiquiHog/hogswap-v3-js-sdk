import { DEFAULT_BASE_URL, FEE_PPM_CAP, MAX_REFERRER_ASSETS, RATE_LIMIT } from './constants.js';
import { toAmountString, toId } from './amounts.js';
import { RateLimiter } from './limiter.js';
import { bytesToBase64, groupBytes } from './group.js';
import {
  HogswapBuildError,
  HogswapError,
  HogswapInputError,
  HogswapMissingOptInError,
  HogswapNoRouteError,
  HogswapQuoteExpiredError,
  HogswapRateLimitError,
  HogswapUnavailableError,
} from './errors.js';

const ADDRESS = /^[A-Z2-7]{58}$/;
const ZERO_ADDRESS = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';

/**
 * @typedef {object} ClientOptions
 * @property {string} [baseUrl] default https://hogswap-v3.liquihog.dev
 * @property {typeof fetch} [fetch] default globalThis.fetch
 * @property {number} [timeoutMs] per request, default 20000
 * @property {number} [retries] retries for rate limits, busy and starting answers, default 2
 * @property {{perWindow: number, windowMs: number, inFlight: number} | false} [rateLimit]
 *   client-side pacing for quote, execute and referrer calls; default the public limits; false = off
 * @property {string} [apiKey] only if HogSwap issued you one; never ship it in browser code
 * @property {Record<string, string>} [headers] extra headers on every request
 */

export class HogswapClient {
  /** @param {ClientOptions} [opts] */
  constructor(opts = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetch = opts.fetch ?? globalThis.fetch?.bind(globalThis);
    if (typeof this.fetch !== 'function') throw new HogswapInputError('no fetch available; pass opts.fetch');
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.retries = Math.max(0, opts.retries ?? 2);
    this.apiKey = opts.apiKey;
    this.headers = { ...(opts.headers ?? {}) };
    this.limiter = opts.rateLimit === false ? null : new RateLimiter(opts.rateLimit ?? RATE_LIMIT);
  }

  // ---------------------------------------------------------------- transport

  /**
   * @param {'GET' | 'POST'} method
   * @param {string} path
   * @param {{query?: Record<string, unknown>, body?: unknown, limited?: boolean, retryNetwork?: boolean}} [o]
   */
  async request(method, path, o = {}) {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(o.query ?? {})) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
    const headers = { Accept: 'application/json', ...this.headers };
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    const body = o.body !== undefined ? JSON.stringify(o.body) : undefined;

    for (let attempt = 0; ; attempt += 1) {
      const release = o.limited && this.limiter ? await this.limiter.acquire() : null;
      let res;
      let text;
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
        try {
          res = await this.fetch(url.toString(), { method, headers, body, signal: ctl.signal });
          text = await res.text();
        } finally {
          clearTimeout(timer);
        }
      } catch (cause) {
        release?.();
        const timedOut = cause?.name === 'AbortError';
        if (o.retryNetwork !== false && attempt < this.retries) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new HogswapError(timedOut ? `${method} ${path} timed out after ${this.timeoutMs} ms` : `${method} ${path} failed: ${cause?.message ?? cause}`, {
          cause,
          code: timedOut ? 'timeout' : 'network',
        });
      }
      release?.();

      const parsed = parseJson(text);
      if (res.ok) return parsed;

      const err = toError(res, parsed, text, path);
      const retryable = err instanceof HogswapRateLimitError || err instanceof HogswapUnavailableError;
      if (err instanceof HogswapRateLimitError) this.limiter?.pause(err.retryAfterMs);
      if (retryable && attempt < this.retries) {
        await sleep(err.retryAfterMs);
        continue;
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------- swaps

  /** GET /health: router status. `ok: true` once it's serving. */
  async health() {
    return this.request('GET', '/health');
  }

  /**
   * POST /quote for a swap. Give exactly one of amountIn (exact in) or amountOut (exact out), or
   * `inputs` for a multi-input swap. Amounts are base units: bigint, digit string or safe integer.
   *
   * @param {import('../types/index.js').SwapQuoteParams} p
   * @returns {Promise<import('../types/index.js').Quote>}
   */
  async quote(p) {
    return this.request('POST', '/quote', { body: swapBody(p), limited: true });
  }

  /**
   * POST /quote, mode LP_MINT: deposit into a pool for its LP token.
   * @param {import('../types/index.js').LpMintQuoteParams} p
   * @returns {Promise<import('../types/index.js').Quote>}
   */
  async quoteLpMint(p) {
    noReferrer(p, 'LP deposits');
    const body = { mode: 'LP_MINT', pool_app_id: toId(p.poolAppId, 'poolAppId'), ...common(p) };
    if (p.tierIndex !== undefined) body.tier_index = tier(p.tierIndex);
    if (p.amountA !== undefined) body.amount_a = toAmountString(p.amountA, 'amountA');
    if (p.amountB !== undefined) body.amount_b = toAmountString(p.amountB, 'amountB');
    if (p.externalInputs?.length) body.external_inputs = p.externalInputs.map((e, i) => assetAmount(e, `externalInputs[${i}]`));
    if (body.amount_a === undefined && body.amount_b === undefined && !body.external_inputs) {
      throw new HogswapInputError('quoteLpMint needs amountA, amountB or externalInputs');
    }
    return this.request('POST', '/quote', { body, limited: true });
  }

  /**
   * POST /quote, mode LP_REDEEM: return LP tokens for the pool's assets (or one target asset).
   * @param {import('../types/index.js').LpRedeemQuoteParams} p
   * @returns {Promise<import('../types/index.js').Quote>}
   */
  async quoteLpRedeem(p) {
    noReferrer(p, 'LP withdrawals');
    const body = { mode: 'LP_REDEEM', pool_app_id: toId(p.poolAppId, 'poolAppId'), lp_amount: toAmountString(p.lpAmount, 'lpAmount'), ...common(p) };
    if (p.tierIndex !== undefined) body.tier_index = tier(p.tierIndex);
    if (p.targetAsset !== undefined) body.target_asset = toId(p.targetAsset, 'targetAsset');
    if (p.extraOutputs?.length) {
      body.extra_outputs = p.extraOutputs.map((e, i) => {
        const o = { asset_id: toId(e.assetId, `extraOutputs[${i}].assetId`) };
        if (e.amount !== undefined) o.amount = toAmountString(e.amount, `extraOutputs[${i}].amount`);
        return o;
      });
    }
    return this.request('POST', '/quote', { body, limited: true });
  }

  /**
   * POST /execute: the unsigned transaction group for a quote, built for `userAddress`. Nothing is
   * signed or sent. A quote can be built for about 30 s, at most 5 times.
   *
   * The router checks the group against current chain state. If it would fail as it stands (the
   * user isn't opted into an output, or can't fund it), the build carries `warnings`, and this
   * method throws the matching error: HogswapMissingOptInError (with `assets`) or
   * HogswapBuildError (code `insufficient_balance`). Pass `allowWarnings: true` to get the build
   * anyway, e.g. when you will put the fix in front of the group yourself.
   *
   * @param {{quoteId: string, userAddress: string, prefixTxns?: Array<string | Uint8Array>, allowWarnings?: boolean}} p
   *   prefixTxns: your own transactions that run before this group (simulated ahead of it only)
   * @returns {Promise<import('../types/index.js').Build>}
   */
  async execute(p) {
    if (!p?.quoteId || typeof p.quoteId !== 'string') throw new HogswapInputError('quoteId is required');
    const body = { quote_id: p.quoteId, user_address: address(p.userAddress, 'userAddress') };
    if (p.prefixTxns?.length) body.prefix_txns = p.prefixTxns.map((t) => (typeof t === 'string' ? t : bytesToBase64(t)));
    // A retry after a timeout would spend another of the quote's 5 builds; leave that to the caller.
    const build = await this.request('POST', '/execute', { body, limited: true, retryNetwork: false });
    if (!p.allowWarnings) throwOnWarnings(build);
    return build;
  }

  /**
   * Quote and build in one call: the quote, the build, and the group's transactions as bytes,
   * ready for the wallet. `sender` is required (the wallet that will sign).
   *
   * @param {import('../types/index.js').SwapQuoteParams & {sender: string}} p
   * @returns {Promise<{quote: import('../types/index.js').Quote, build: import('../types/index.js').Build, txns: Uint8Array[]}>}
   */
  async prepareSwap(p) {
    const sender = address(p?.sender, 'sender');
    const quote = await this.quote({ ...p, sender });
    const build = await this.execute({ quoteId: quote.quote_id, userAddress: sender });
    return { quote, build, txns: groupBytes(build) };
  }

  // ---------------------------------------------------------------- referrals

  /**
   * GET /referrer/{address}: a platform's registration, discount token and balance per asset.
   * @param {string} referrer
   * @returns {Promise<import('../types/index.js').ReferrerStatus>}
   */
  async referrerStatus(referrer) {
    return this.request('GET', `/referrer/${address(referrer, 'referrer')}`, { limited: true });
  }

  /**
   * POST /referrer/setup: unsigned groups that open assets for earning (each with its deposit) and
   * optionally register or change a discount token. Sign with the platform's wallet, send in order.
   *
   * @param {{referrer: string, assets?: Array<number | bigint | string>, discountTokenId?: number | bigint | string, discountUnit?: bigint | string | number}} p
   * @returns {Promise<import('../types/index.js').ReferrerGroups>}
   */
  async referrerSetup(p) {
    const body = { referrer: address(p?.referrer, 'referrer') };
    if (p.assets !== undefined) {
      if (!Array.isArray(p.assets) || p.assets.length > MAX_REFERRER_ASSETS) throw new HogswapInputError(`assets must be a list of at most ${MAX_REFERRER_ASSETS} asset ids`);
      body.assets = p.assets.map((a, i) => toId(a, `assets[${i}]`));
    }
    if ((p.discountTokenId === undefined) !== (p.discountUnit === undefined)) {
      throw new HogswapInputError('discountTokenId and discountUnit go together (0 and 0 = no discount)');
    }
    if (p.discountTokenId !== undefined) body.discount_token_id = toId(p.discountTokenId, 'discountTokenId');
    if (p.discountUnit !== undefined) body.discount_unit = toAmountString(p.discountUnit, 'discountUnit');
    if (body.assets === undefined && body.discount_token_id === undefined) {
      throw new HogswapInputError('referrerSetup needs assets, a discount token, or both');
    }
    return this.request('POST', '/referrer/setup', { body, limited: true });
  }

  /**
   * POST /referrer/claim: unsigned groups that pay out what the platform has earned. Without
   * `assets`, every opened asset with a balance. `close: true` also deletes each asset's record
   * and refunds its deposit. `unregister: true` adds a last group that deletes the platform's
   * discount-token record and refunds its 22,500 µALGO deposit; open assets keep earning.
   *
   * @param {{referrer: string, assets?: Array<number | bigint | string>, close?: boolean, unregister?: boolean}} p
   * @returns {Promise<import('../types/index.js').ReferrerGroups>}
   */
  async referrerClaim(p) {
    const body = { referrer: address(p?.referrer, 'referrer') };
    if (p.assets !== undefined) {
      if (!Array.isArray(p.assets) || p.assets.length > MAX_REFERRER_ASSETS) throw new HogswapInputError(`assets must be a list of at most ${MAX_REFERRER_ASSETS} asset ids`);
      body.assets = p.assets.map((a, i) => toId(a, `assets[${i}]`));
    }
    if (p.close !== undefined) body.close = Boolean(p.close);
    if (p.unregister !== undefined) body.unregister = Boolean(p.unregister);
    return this.request('POST', '/referrer/claim', { body, limited: true });
  }

  // ---------------------------------------------------------------- market data (GET, not rate limited)

  /** @param {{limit?: number, cursor?: string | number, q?: string}} [o] one page; next_cursor continues */
  async assets(o = {}) {
    return this.request('GET', '/assets', { query: { limit: o.limit, cursor: o.cursor, q: o.q } });
  }

  /** @param {Array<number | bigint | string>} ids */
  async assetsByIds(ids) {
    return this.request('GET', '/assets', { query: { ids: idList(ids, 'ids') } });
  }

  /** @param {number | bigint | string} assetId */
  async asset(assetId) {
    return this.request('GET', `/assets/${toId(assetId, 'assetId')}`);
  }

  /** Every pool holding the asset (can be large for major assets). @param {number | bigint | string} assetId @param {{sort?: 'tvl'}} [o] */
  async assetPools(assetId, o = {}) {
    return this.request('GET', `/assets/${toId(assetId, 'assetId')}/pools`, { query: { sort: o.sort } });
  }

  /** @param {{limit?: number, cursor?: string | number, kind?: number, assetA?: number, assetB?: number, minTvlAlgoMicro?: bigint | string | number}} [o] */
  async pools(o = {}) {
    return this.request('GET', '/pools', {
      query: {
        limit: o.limit,
        cursor: o.cursor,
        kind: o.kind,
        asset_a: o.assetA === undefined ? undefined : toId(o.assetA, 'assetA'),
        asset_b: o.assetB === undefined ? undefined : toId(o.assetB, 'assetB'),
        min_tvl_algo_micro: o.minTvlAlgoMicro === undefined ? undefined : toAmountString(o.minTvlAlgoMicro, 'minTvlAlgoMicro'),
      },
    });
  }

  /** @param {number | bigint | string} poolId */
  async pool(poolId) {
    return this.request('GET', `/pools/${toId(poolId, 'poolId')}`);
  }

  /** @param {Array<number | bigint | string>} ids */
  async prices(ids) {
    return this.request('GET', '/prices', { query: { ids: idList(ids, 'ids') } });
  }

  async tvl() {
    return this.request('GET', '/tvl');
  }

  /** @param {Array<number | bigint | string>} ids */
  async tvlAssets(ids) {
    return this.request('GET', '/tvl/assets', { query: { ids: idList(ids, 'ids') } });
  }

  /** STAMM pools with their fee tiers. @param {{activeOnly?: boolean, sort?: 'tvl'}} [o] */
  async stammPools(o = {}) {
    return this.request('GET', '/stamm/pools', { query: { active_only: o.activeOnly === undefined ? undefined : String(o.activeOnly), sort: o.sort } });
  }

  /** What an LP token is backed by. @param {number | bigint | string} lpAssetId @param {{amount?: bigint | string | number}} [o] */
  async lpToken(lpAssetId, o = {}) {
    return this.request('GET', `/lp/${toId(lpAssetId, 'lpAssetId')}`, { query: { amount: o.amount === undefined ? undefined : toAmountString(o.amount, 'amount') } });
  }

  /** @param {{poolAppId: number | bigint | string, assetId: number | bigint | string, amount: bigint | string | number, tierIndex?: number}} p */
  async lpBalance(p) {
    const body = { pool_app_id: toId(p.poolAppId, 'poolAppId'), asset_id: toId(p.assetId, 'assetId'), amount: toAmountString(p.amount, 'amount') };
    if (p.tierIndex !== undefined) body.tier_index = tier(p.tierIndex);
    return this.request('POST', '/lp/balance', { body });
  }

  async analyticsPrices() {
    return this.request('GET', '/analytics/prices');
  }

  /** Every asset, page by page. @param {{limit?: number, q?: string}} [o] */
  async *iterateAssets(o = {}) {
    let cursor;
    do {
      const page = await this.assets({ ...o, cursor });
      for (const a of page.assets) yield a;
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
  }

  /** Every pool matching the filters, page by page. @param {Parameters<HogswapClient['pools']>[0]} [o] */
  async *iteratePools(o = {}) {
    let cursor;
    do {
      const page = await this.pools({ ...o, cursor });
      for (const p of page.pools) yield p;
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
  }

  /**
   * The URL of the server-sent block stream (one `block` event per round with pool updates).
   * Open it with EventSource. @param {{pools?: Array<number | bigint | string>}} [o]
   */
  blocksStreamUrl(o = {}) {
    const url = new URL(`${this.baseUrl}/stream/blocks`);
    if (o.pools?.length) url.searchParams.set('pools', idList(o.pools, 'pools').join(','));
    return url.toString();
  }
}

// -------------------------------------------------------------------- request bodies

function swapBody(p) {
  if (!p || typeof p !== 'object') throw new HogswapInputError('quote parameters are required');
  const body = { ...common(p) };
  const multi = Array.isArray(p.inputs) && p.inputs.length > 0;
  body.asset_out = toId(p.assetOut, 'assetOut');
  if (multi) {
    if (p.assetIn !== undefined || p.amountIn !== undefined || p.amountOut !== undefined) {
      throw new HogswapInputError('inputs replace assetIn, amountIn and amountOut');
    }
    if (p.inputs.length < 2 || p.inputs.length > 4) throw new HogswapInputError('a multi-input swap takes 2 to 4 inputs');
    body.inputs = p.inputs.map((e, i) => assetAmount(e, `inputs[${i}]`));
  } else {
    body.asset_in = toId(p.assetIn, 'assetIn');
    const hasIn = p.amountIn !== undefined;
    const hasOut = p.amountOut !== undefined;
    if (hasIn === hasOut) throw new HogswapInputError('give exactly one of amountIn or amountOut');
    if (hasIn) body.amount_in = positive(p.amountIn, 'amountIn');
    else body.amount_out = positive(p.amountOut, 'amountOut');
  }
  if (p.extraOutputs?.length) {
    if (p.extraOutputs.length > 3) throw new HogswapInputError('a basket swap takes 1 to 3 extra outputs');
    body.extra_outputs = p.extraOutputs.map((e, i) => assetAmount(e, `extraOutputs[${i}]`));
  }
  if (p.coverAlgoFee) body.cover_algo_fee = true;
  if (p.excludeVenues?.length) body.exclude_venues = p.excludeVenues.map(String);
  if (p.excludePools?.length) body.exclude_pools = p.excludePools.map((x, i) => toId(x, `excludePools[${i}]`));
  if (p.referrer !== undefined && p.referrer !== null && p.referrer !== ZERO_ADDRESS) {
    body.referrer = address(p.referrer, 'referrer');
    if (multi || body.extra_outputs || body.cover_algo_fee) {
      throw new HogswapInputError('a referrer applies to plain swaps only: one input, one output, no coverAlgoFee');
    }
    if (p.feePpm !== undefined) {
      if (!Number.isInteger(p.feePpm) || p.feePpm < 0 || p.feePpm > FEE_PPM_CAP) throw new HogswapInputError(`feePpm must be an integer 0-${FEE_PPM_CAP}`);
      body.fee_ppm = p.feePpm;
    }
  } else if (p.feePpm !== undefined) {
    throw new HogswapInputError('feePpm needs a referrer');
  }
  return body;
}

function common(p) {
  const o = {};
  if (p.slippageBps !== undefined) {
    if (!Number.isInteger(p.slippageBps) || p.slippageBps < 1 || p.slippageBps > 5000) throw new HogswapInputError('slippageBps must be an integer 1-5000');
    o.slippage_bps = p.slippageBps;
  }
  if (p.maxHops !== undefined) {
    if (!Number.isInteger(p.maxHops) || p.maxHops < 1 || p.maxHops > 4) throw new HogswapInputError('maxHops must be an integer 1-4');
    o.max_hops = p.maxHops;
  }
  if (p.maxLegs !== undefined) o.max_legs = smallInt(p.maxLegs, 'maxLegs');
  if (p.maxOuterTxns !== undefined) o.max_outer_txns = smallInt(p.maxOuterTxns, 'maxOuterTxns');
  if (p.allowHighImpact) o.allow_high_impact = true;
  if (p.sender !== undefined) o.sender = address(p.sender, 'sender');
  return o;
}

function assetAmount(e, name) {
  if (!e || typeof e !== 'object') throw new HogswapInputError(`${name} must be {assetId, amount}`);
  return { asset_id: toId(e.assetId, `${name}.assetId`), amount: positive(e.amount, `${name}.amount`) };
}

function positive(v, name) {
  const s = toAmountString(v, name);
  if (s === '0') throw new HogswapInputError(`${name} must be greater than zero`);
  return s;
}

function smallInt(v, name) {
  if (!Number.isInteger(v) || v < 1 || v > 1000) throw new HogswapInputError(`${name} must be a positive integer`);
  return v;
}

function tier(v) {
  if (!Number.isInteger(v) || v < 0 || v > 5) throw new HogswapInputError('tierIndex must be an integer 0-5');
  return v;
}

function address(v, name) {
  if (typeof v !== 'string' || !ADDRESS.test(v.trim())) throw new HogswapInputError(`${name} must be a 58-character Algorand address`);
  return v.trim();
}

/** Referred quotes are plain swaps only: refuse a referrer rather than silently dropping it. */
function noReferrer(p, what) {
  if (p?.referrer !== undefined || p?.feePpm !== undefined) {
    throw new HogswapInputError(`${what} can't carry a referrer or feePpm; referred quotes are plain swaps only`);
  }
}

function idList(ids, name) {
  if (!Array.isArray(ids) || ids.length === 0) throw new HogswapInputError(`${name} must be a non-empty list of ids`);
  return ids.map((x, i) => toId(x, `${name}[${i}]`));
}

// -------------------------------------------------------------------- responses

/**
 * Throw for a build that would fail as it stands. Skipped when the caller's own prefixTxns
 * couldn't be simulated (`prefix_simulated: false`): the warnings then describe the group without
 * them and may not apply.
 */
function throwOnWarnings(build) {
  const warnings = Array.isArray(build?.warnings) ? build.warnings : [];
  if (warnings.length === 0 || build.prefix_simulated === false) return;
  const info = { status: 200, detail: warnings, body: build };
  for (const w of warnings) {
    if (w?.code === 'missing_opt_in') throw new HogswapMissingOptInError(w.detail, { ...info, assets: w.assets ?? [] });
    if (w?.code === 'insufficient_balance') throw new HogswapBuildError(w.detail, { ...info, code: 'insufficient_balance' });
    if (w?.code === 'simulate_failed') throw new HogswapBuildError(w.detail, info);
  }
  // 'min_out_risk' is returned, not thrown: the group may still settle; show the user or re-quote.
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function detailText(parsed, text) {
  const d = parsed && typeof parsed === 'object' ? parsed.detail : undefined;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x) => (x && typeof x === 'object' ? [x.loc?.slice(-1)[0], x.msg].filter(Boolean).join(': ') : String(x))).join('; ');
  if (typeof parsed === 'string') return parsed.slice(0, 300);
  return (text ?? '').slice(0, 300);
}

function retryAfterMs(res, fallback) {
  const h = res.headers?.get?.('retry-after');
  const s = h === null || h === undefined ? NaN : Number(h);
  return Number.isFinite(s) && s >= 0 ? Math.min(s * 1000, 60_000) : fallback;
}

/** Map an HTTP error to the matching error class. Exported for tests. */
export function toError(res, parsed, text, path) {
  const status = res.status;
  const detail = parsed && typeof parsed === 'object' ? parsed.detail : undefined;
  const msg = detailText(parsed, text) || `HTTP ${status}`;
  const info = { status, detail, body: parsed };
  switch (status) {
    case 404:
      if (path === '/quote') return new HogswapNoRouteError(msg, info);
      if (path === '/execute') return new HogswapQuoteExpiredError(msg, info);
      return new HogswapError(msg, { ...info, code: 'not_found' });
    case 409:
      return new HogswapBuildError(msg, info);
    case 422:
      if (parsed?.error === 'missing_opt_in') return new HogswapMissingOptInError(msg, { ...info, assets: parsed.assets ?? [] });
      return new HogswapError(msg, { ...info, code: 'invalid_request' });
    case 425:
      return new HogswapUnavailableError(msg, { ...info, code: 'starting', retryAfterMs: 2000 });
    case 429:
      if (/build budget/i.test(msg)) return new HogswapQuoteExpiredError(msg, { ...info, code: 'build_budget_spent' });
      return new HogswapRateLimitError(msg, { ...info, retryAfterMs: retryAfterMs(res, 2000) });
    case 503:
      return new HogswapUnavailableError(msg, { ...info, code: 'busy', retryAfterMs: retryAfterMs(res, 1000) });
    case 400:
      return new HogswapError(msg, { ...info, code: 'bad_request' });
    case 401:
      return new HogswapError(msg, { ...info, code: 'unauthorized' });
    case 502:
      return new HogswapError(msg, { ...info, code: 'upstream' });
    default:
      return new HogswapError(msg, info);
  }
}

function backoff(attempt) {
  return Math.min(500 * 2 ** attempt, 4000);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
