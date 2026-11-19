/**
 * Every error the SDK throws is a HogswapError. API errors carry the HTTP status, the server's
 * `detail` message and the parsed body; input errors are raised before any request is sent.
 */
export class HogswapError extends Error {
  /**
   * @param {string} message
   * @param {{status?: number, detail?: unknown, body?: unknown, code?: string, cause?: unknown}} [info]
   */
  constructor(message, info = {}) {
    super(message, info.cause !== undefined ? { cause: info.cause } : undefined);
    this.name = 'HogswapError';
    /** HTTP status, or 0 when no response arrived. */
    this.status = info.status ?? 0;
    /** The server's `detail` field, when it sent one. */
    this.detail = info.detail;
    /** The parsed response body, when there was one. */
    this.body = info.body;
    /** A stable machine-readable code, e.g. 'rate_limited', 'missing_opt_in'. */
    this.code = info.code ?? 'error';
  }
}

/** A bad argument, caught before anything was sent. */
export class HogswapInputError extends HogswapError {
  constructor(message) {
    super(message, { code: 'invalid_input' });
    this.name = 'HogswapInputError';
  }
}

/** 429: too many requests. `retryAfterMs` says how long to wait. */
export class HogswapRateLimitError extends HogswapError {
  constructor(message, info = {}) {
    super(message, { ...info, code: 'rate_limited' });
    this.name = 'HogswapRateLimitError';
    /** @type {number} */
    this.retryAfterMs = info.retryAfterMs ?? 1000;
  }
}

/** 425 or 503: the router is starting or momentarily busy. Safe to retry shortly. */
export class HogswapUnavailableError extends HogswapError {
  constructor(message, info = {}) {
    super(message, { ...info, code: info.code ?? 'unavailable' });
    this.name = 'HogswapUnavailableError';
    this.retryAfterMs = info.retryAfterMs ?? 1000;
  }
}

/** 404 on /quote: no route fits this trade (or the asset is unknown). */
export class HogswapNoRouteError extends HogswapError {
  constructor(message, info = {}) {
    super(message, { ...info, code: 'no_route' });
    this.name = 'HogswapNoRouteError';
  }
}

/** The quote expired (about 30 s) or used its 5 builds. Request a fresh quote. */
export class HogswapQuoteExpiredError extends HogswapError {
  constructor(message, info = {}) {
    super(message, { ...info, code: info.code ?? 'quote_expired' });
    this.name = 'HogswapQuoteExpiredError';
  }
}

/** 422 on /execute: the wallet isn't opted into an asset it would receive. */
export class HogswapMissingOptInError extends HogswapError {
  constructor(message, info = {}) {
    super(message, { ...info, code: 'missing_opt_in' });
    this.name = 'HogswapMissingOptInError';
    /** Asset ids the wallet must opt into before building again. @type {number[]} */
    this.assets = info.assets ?? [];
  }
}

/**
 * The group would fail on current chain state: 409 on /execute (`build_failed`), or a build whose
 * warnings say the user can't fund it (`insufficient_balance`).
 */
export class HogswapBuildError extends HogswapError {
  constructor(message, info = {}) {
    super(message, { ...info, code: info.code ?? 'build_failed' });
    this.name = 'HogswapBuildError';
  }
}

/** The algod node refused or failed a submission or lookup. */
export class HogswapSubmitError extends HogswapError {
  constructor(message, info = {}) {
    super(message, { ...info, code: info.code ?? 'submit_failed' });
    this.name = 'HogswapSubmitError';
  }
}
