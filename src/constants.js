/** Public HogSwap v3 API. */
export const DEFAULT_BASE_URL = 'https://hogswap-v3.liquihog.dev';

/** The HogSwap v3 router application on Algorand mainnet. */
export const ROUTER_APP_ID = 3687031461;

/** Well-known asset ids (mainnet). ALGO is asset 0 throughout the API. */
export const ASSETS = Object.freeze({
  ALGO: 0,
  USDC: 31566704,
  HOG: 3178895177,
});

/** The router's base fee, in parts per million of the swap output (0.05%). */
export const BASE_FEE_PPM = 500;

/** The highest rate a referring platform can set, in ppm (1%). */
export const FEE_PPM_CAP = 10000;

/**
 * Public limits, per client IP. Quote, execute and the referrer endpoints share one window:
 * 30 requests per 10 seconds, and at most 4 running at once. Data reads (GET) are not limited.
 */
export const RATE_LIMIT = Object.freeze({ perWindow: 30, windowMs: 10_000, inFlight: 4 });

/** A quote can be built for about 30 seconds, and at most 5 times. */
export const QUOTE_TTL_MS = 30_000;
export const BUILDS_PER_QUOTE = 5;

/**
 * Venue keys for `excludeVenues`, with what each covers. Pass the key, e.g. ['algofi_cp'].
 */
export const VENUES = Object.freeze({
  stamm: 'STAMM pools (all fee tiers)',
  tinyman_v2: 'Tinyman v2',
  pact_cp: 'Pact constant-product pools (v1 and v2)',
  pact_stable: 'Pact stableswap pools',
  pact_weighted: 'Pact weighted pools',
  pact_clmm: 'Pact concentrated-liquidity pools',
  algofi_cp: 'AlgoFi constant-product pools',
  humble_v2: 'Humble v2',
  biatec: 'Biatec concentrated-liquidity pools',
  folks_lend: 'Folks Finance lending (deposit and withdraw fAssets)',
  xalgo: 'xALGO liquid staking (mint and burn)',
  talgo: 'tALGO liquid staking (mint and burn)',
  dualstake: 'DualSTAKE liquid staking (mint and redeem)',
});

/** The most transactions an Algorand atomic group can hold. */
export const MAX_GROUP_SIZE = 16;

/** The most asset ids one referrerSetup or referrerClaim request takes. */
export const MAX_REFERRER_ASSETS = 200;
