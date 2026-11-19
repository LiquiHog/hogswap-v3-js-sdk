// Type declarations for hogswap-v3-js-sdk.
//
// Quantities in API responses are decimal strings (`AmountString`): convert with toBigInt() and
// do arithmetic in BigInt. Request amounts accept a bigint, a digit string, or a safe integer.

/** A base-unit amount as a decimal string, e.g. "1500000". Exact for any 64-bit value. */
export type AmountString = string;
/** What request amounts accept. Numbers must be safe integers; prefer bigint or string. */
export type AmountInput = bigint | string | number;
/** An asset, app or pool id. */
export type IdInput = number | bigint | string;
/** A 58-character Algorand address. */
export type Address = string;

export interface RateLimitConfig {
  perWindow: number;
  windowMs: number;
  inFlight: number;
}

export interface ClientOptions {
  /** Default https://hogswap-v3.liquihog.dev */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Per request. Default 20000. */
  timeoutMs?: number;
  /** Retries for rate-limit, busy and starting answers. Default 2. */
  retries?: number;
  /** Client-side pacing for quote, execute and referrer calls. Default: the public limits. */
  rateLimit?: RateLimitConfig | false;
  /** Only if HogSwap issued you one. Never ship it in browser code. */
  apiKey?: string;
  headers?: Record<string, string>;
}

// ------------------------------------------------------------------ requests

export interface CommonQuoteParams {
  /** 1-5000, default 50 (0.5%). */
  slippageBps?: number;
  /** 1-4, default 3. */
  maxHops?: number;
  /** Cap the number of pool legs (fewer legs, smaller group). */
  maxLegs?: number;
  /** Cap the group's transactions (3-16); leave room for your own with 16 - yours. */
  maxOuterTxns?: number;
  /** LP deposits: accept a deposit losing more than 2% of its value. Default false. */
  allowHighImpact?: boolean;
  /** The wallet that will sign. Lets the quote account for its HOG fee discount. */
  sender?: Address;
}

export interface AssetAmount {
  assetId: IdInput;
  amount: AmountInput;
}

export interface SwapQuoteParams extends CommonQuoteParams {
  assetIn?: IdInput;
  assetOut: IdInput;
  /** Exact in: spend exactly this much. */
  amountIn?: AmountInput;
  /** Exact out: receive exactly this much. */
  amountOut?: AmountInput;
  /** Multi-input swap: 2-4 inputs instead of assetIn/amountIn. */
  inputs?: AssetAmount[];
  /** Basket swap: 1-3 extra output assets with target amounts. */
  extraOutputs?: AssetAmount[];
  /** Pay the network fee out of the swap. */
  coverAlgoFee?: boolean;
  /** Venue keys to leave out; see VENUES. */
  excludeVenues?: VenueKey[];
  excludePools?: IdInput[];
  /** Your platform's address, to earn on this swap. Plain swaps only. */
  referrer?: Address;
  /** Your rate, 0-10000 ppm (10000 = 1%). Raised to the 500 ppm base fee if lower. */
  feePpm?: number;
}

export interface LpMintQuoteParams extends CommonQuoteParams {
  poolAppId: IdInput;
  /** STAMM fee tier 0-5. */
  tierIndex?: number;
  amountA?: AmountInput;
  amountB?: AmountInput;
  /** Up to 2 other assets, swapped into the pool's assets first. */
  externalInputs?: AssetAmount[];
}

export interface LpRedeemQuoteParams extends CommonQuoteParams {
  poolAppId: IdInput;
  tierIndex?: number;
  lpAmount: AmountInput;
  /** Settle everything in this asset. Absent: receive both pool assets. */
  targetAsset?: IdInput;
  /** Up to 3 other outputs; amount absent = a whole side. */
  extraOutputs?: Array<{ assetId: IdInput; amount?: AmountInput }>;
}

// ------------------------------------------------------------------ responses

export interface QuoteLeg {
  pool_id: number;
  dex_kind: number;
  dex_name: string;
  asset_in: number;
  asset_out: number;
  planned_in: AmountString;
  planned_out: AmountString;
}

export interface Quote {
  /** Pass to execute(). Valid about 30 s, at most 5 builds. */
  quote_id: string;
  asset_in: number;
  asset_out: number;
  amount_in: AmountString;
  expected_out: AmountString;
  expected_out_robust: AmountString;
  /** The least the user receives; the group reverts below it. */
  min_out_at_slippage: AmountString;
  slippage_bps: number;
  legs: QuoteLeg[];
  path_breakdown: Array<{ assets: number[]; input_amount: AmountString; output_amount: AmountString }>;
  /** A typical network fee for the group (an estimate). */
  network_fee_microalgo: AmountString;
  /** The most the group's network fee can be. */
  network_fee_max_microalgo: AmountString;
  cover_algo_fee: boolean;
  cover_algo_fee_strategy: string | null;
  efficiency_loss_bps: number;
  n_outers: number;
  requested_out: AmountString | null;
  max_in_at_slippage: AmountString | null;
  mode: 'SWAP' | 'LP_MINT' | 'LP_REDEEM';
  lp: Record<string, unknown> | null;
  deposits: Array<{ asset_id: number; amount: AmountString }>;
  extra_outputs: Array<{ asset_id: number; amount: AmountString }>;
  router_fee_bps_nominal: number;
  router_fee_bps_effective: number;
  router_fee_amount: AmountString;
  router_fee_amount_undiscounted: AmountString;
  router_fee_asset: number;
  hog_holdings_micro: AmountString | null;
  hog_discount_pct: number | null;
  router_fee_ppm_nominal: number;
  router_fee_ppm_effective: number;
  /** Set on referred quotes. */
  referrer: Address | null;
  /** The referrer's expected share of this swap, in the output asset's base units. */
  referrer_fee_amount: AmountString;
  /** That share in ppm of the gross output: (rate - 500) / 2. */
  referrer_share_ppm: number;
}

export interface UnsignedTxn {
  txn_b64: string;
  description?: string;
}

export interface Build {
  quote_id: string;
  unsigned_group: UnsignedTxn[];
  router_app_id: number;
  group_id_b64: string;
  asset_in: number;
  asset_out: number;
  amount_in: AmountString;
  min_out_at_slippage: AmountString;
  network_fee_microalgo: AmountString;
  leg_count: number;
  n_outers: number;
  n_batches: number;
  cover_fee_strategy: string;
  notes: string[];
  /** Present when the group would fail as it stands; execute() throws for these unless allowWarnings. */
  warnings?: BuildWarning[];
  prefix_simulated: boolean | null;
}

export interface BuildWarning {
  code: 'missing_opt_in' | 'insufficient_balance' | 'min_out_risk' | 'simulate_failed';
  detail: string;
  /** missing_opt_in: the output assets to opt into. */
  assets?: number[];
}

export interface ReferrerStatus {
  referrer: Address;
  router_app_id: number;
  registered: boolean;
  discount_token_id: number;
  discount_unit: AmountString;
  assets: Array<{ asset_id: number; accrued: AmountString; can_receive: boolean }>;
  terms: {
    fee_cap_ppm: number;
    referrer_share_of_excess_pct: number;
    accrual_deposit_microalgo: number;
    first_open_liability_deposit_microalgo: number;
    config_deposit_microalgo: number;
  };
}

export interface ReferrerGroup {
  group_id_b64: string;
  steps: string[];
  network_fee_microalgo: AmountString;
  deposit_microalgo: AmountString;
  unsigned_group: UnsignedTxn[];
}

export interface ReferrerGroups {
  referrer: Address;
  router_app_id: number;
  /**
   * "batch": each group is one deposit + one batch call + reference carriers (dozens of assets per
   * group); "per_asset": a payment + call per asset. Closes are per asset in both.
   */
  group_shape: 'batch' | 'per_asset';
  groups: ReferrerGroup[];
  notes: string[];
  sign_with: string;
}

export interface AssetInfo {
  asset_id: number;
  name: string | null;
  unit_name: string | null;
  decimals: number;
  total: AmountString | null;
  url: string | null;
  creator: Address | null;
  verified: boolean | null;
  price_algo_micro: AmountString | null;
  price_usd_micro: AmountString | null;
  price_algo: string | null;
  price_usd: string | null;
  price_confidence_bps: number;
  is_lp_token: boolean;
  lp_of: Record<string, unknown> | null;
}

export interface PoolInfo {
  pool_id: number;
  dex_kind: number;
  dex_name: string;
  asset_a: number;
  asset_b: number;
  reserve_a_micro: AmountString;
  reserve_b_micro: AmountString;
  fee_bps: number;
  tvl_algo_micro: AmountString | null;
  tvl_usd_micro: AmountString | null;
  tvl_confidence_bps: number;
  spot_price_ab: number;
  spot_price_ba: number;
  lp_asset_id: number | null;
  extra: Record<string, unknown>;
  [k: string]: unknown;
}

export type AssetsPage = { assets: AssetInfo[]; next_cursor: string | null; as_of_round: number };
export type AssetsByIds = { assets: AssetInfo[]; unknown_ids: number[]; next_cursor: null; as_of_round: number };
export type PoolsPage = { pools: PoolInfo[]; next_cursor: string | null; as_of_round: number };
export type Prices = {
  prices: Array<{ asset_id: number; price_algo_micro: AmountString | null; price_usd_micro: AmountString | null; price_algo: string | null; price_usd: string | null; price_confidence_bps: number }>;
  as_of_round: number;
};
export type Tvl = { tvl_algo_micro: AmountString; tvl_usd_micro: AmountString; pool_count: number; active_pool_count: number; priced_pool_count: number; asset_count: number; as_of_round: number };

export interface Health {
  status: string;
  ok: boolean;
  service: string;
  round: number;
  router_app_id: number;
  [k: string]: unknown;
}

// ------------------------------------------------------------------ client

export declare class HogswapClient {
  constructor(opts?: ClientOptions);
  readonly baseUrl: string;
  request(method: 'GET' | 'POST', path: string, o?: { query?: Record<string, unknown>; body?: unknown; limited?: boolean; retryNetwork?: boolean }): Promise<any>;

  health(): Promise<Health>;
  quote(p: SwapQuoteParams): Promise<Quote>;
  quoteLpMint(p: LpMintQuoteParams): Promise<Quote>;
  quoteLpRedeem(p: LpRedeemQuoteParams): Promise<Quote>;
  execute(p: { quoteId: string; userAddress: Address; prefixTxns?: Array<string | Uint8Array>; allowWarnings?: boolean }): Promise<Build>;
  prepareSwap(p: SwapQuoteParams & { sender: Address }): Promise<{ quote: Quote; build: Build; txns: Uint8Array[] }>;

  referrerStatus(referrer: Address): Promise<ReferrerStatus>;
  /** discountTokenId and discountUnit go together (0 and 0 = no discount). */
  referrerSetup(p: { referrer: Address; assets?: IdInput[]; discountTokenId?: IdInput; discountUnit?: AmountInput }): Promise<ReferrerGroups>;
  referrerClaim(p: { referrer: Address; assets?: IdInput[]; close?: boolean; unregister?: boolean }): Promise<ReferrerGroups>;

  assets(o?: { limit?: number; cursor?: string | number; q?: string }): Promise<AssetsPage>;
  assetsByIds(ids: IdInput[]): Promise<AssetsByIds>;
  asset(assetId: IdInput): Promise<AssetInfo>;
  assetPools(assetId: IdInput, o?: { sort?: 'tvl' }): Promise<Record<string, unknown> & { pools: PoolInfo[] }>;
  pools(o?: { limit?: number; cursor?: string | number; kind?: number; assetA?: IdInput; assetB?: IdInput; minTvlAlgoMicro?: AmountInput }): Promise<PoolsPage>;
  pool(poolId: IdInput): Promise<PoolInfo>;
  prices(ids: IdInput[]): Promise<Prices>;
  tvl(): Promise<Tvl>;
  tvlAssets(ids: IdInput[]): Promise<Record<string, unknown>>;
  stammPools(o?: { activeOnly?: boolean; sort?: 'tvl' }): Promise<{ pools: PoolInfo[]; as_of_round: number }>;
  lpToken(lpAssetId: IdInput, o?: { amount?: AmountInput }): Promise<Record<string, unknown>>;
  lpBalance(p: { poolAppId: IdInput; assetId: IdInput; amount: AmountInput; tierIndex?: number }): Promise<Record<string, unknown>>;
  analyticsPrices(): Promise<Record<string, unknown>>;
  iterateAssets(o?: { limit?: number; q?: string }): AsyncGenerator<AssetInfo, void, unknown>;
  iteratePools(o?: { limit?: number; kind?: number; assetA?: IdInput; assetB?: IdInput; minTvlAlgoMicro?: AmountInput }): AsyncGenerator<PoolInfo, void, unknown>;
  blocksStreamUrl(o?: { pools?: IdInput[] }): string;
}

export declare class RateLimiter {
  constructor(cfg: RateLimitConfig, clock?: { now?: () => number; sleep?: (ms: number) => Promise<void> });
  acquire(): Promise<() => void>;
  pause(ms: number): void;
}

// ------------------------------------------------------------------ amounts

export declare function toAmountString(value: AmountInput, name?: string): AmountString;
export declare function toBigIntStrict(value: AmountInput, name?: string): bigint;
export declare function toBigInt(value: string | number | bigint): bigint;
export declare function toBigInt(value: null): null;
export declare function toBigInt(value: undefined): undefined;
export declare function toBigInt(value: string | number | bigint | null | undefined): bigint | null | undefined;
export declare function toId(value: IdInput, name?: string): number;
export declare function formatUnits(amount: AmountInput, decimals: number, opts?: { maxDecimals?: number; trimZeros?: boolean }): string;
export declare function parseUnits(text: string, decimals: number): bigint;
export declare function applySlippage(amount: AmountInput, slippageBps: number): bigint;

// ------------------------------------------------------------------ groups and algod

export interface AlgodOptions {
  algodUrl: string;
  algodToken?: string;
  /** Default "X-Algo-API-Token". */
  algodTokenHeader?: string;
  fetch?: typeof fetch;
}

type GroupLike = { unsigned_group: UnsignedTxn[] } | UnsignedTxn[];

export declare function base64ToBytes(b64: string): Uint8Array;
export declare function bytesToBase64(bytes: Uint8Array): string;
export declare function groupBase64(group: GroupLike): string[];
export declare function groupBytes(group: GroupLike): Uint8Array[];
export declare function assertFullySigned(signed: Array<Uint8Array | null | undefined>, expected: number): Uint8Array[];
export declare function submitSignedGroup(signed: Uint8Array[], opts: AlgodOptions): Promise<{ txId: string }>;
export declare function waitForConfirmation(txId: string, opts: AlgodOptions & { timeoutMs?: number; pollMs?: number }): Promise<Record<string, any>>;
/** What a confirmed swap paid `receiver` in `assetId` (0 = ALGO), read from the swap's last transaction. */
export declare function receivedFromSwap(p: { finalTxId: string; receiver: Address; assetId: number }, opts: AlgodOptions & { timeoutMs?: number; pollMs?: number }): Promise<bigint>;
/** JSON.parse that keeps 16+ digit integers as strings (algod sends amounts as numbers). */
export declare function parseJsonLossless(text: string): any;
export declare function submitAndConfirm(signed: Uint8Array[], opts: AlgodOptions & { timeoutMs?: number; pollMs?: number }): Promise<{ txId: string; confirmedRound: number }>;

// ------------------------------------------------------------------ errors

export declare class HogswapError extends Error {
  status: number;
  detail: unknown;
  body: unknown;
  code: string;
}
export declare class HogswapInputError extends HogswapError {}
export declare class HogswapRateLimitError extends HogswapError {
  retryAfterMs: number;
}
export declare class HogswapUnavailableError extends HogswapError {
  retryAfterMs: number;
}
export declare class HogswapNoRouteError extends HogswapError {}
export declare class HogswapQuoteExpiredError extends HogswapError {}
export declare class HogswapMissingOptInError extends HogswapError {
  assets: number[];
}
export declare class HogswapBuildError extends HogswapError {}
export declare class HogswapSubmitError extends HogswapError {}
export declare function toError(res: { status: number; headers?: { get(name: string): string | null } }, parsed: unknown, text: string, path: string): HogswapError;

// ------------------------------------------------------------------ constants

export declare const DEFAULT_BASE_URL: string;
export declare const ROUTER_APP_ID: number;
export declare const ASSETS: Readonly<{ ALGO: 0; USDC: 31566704; HOG: 3178895177 }>;
export declare const BASE_FEE_PPM: number;
export declare const FEE_PPM_CAP: number;
export declare const RATE_LIMIT: Readonly<RateLimitConfig>;
export declare const QUOTE_TTL_MS: number;
export declare const BUILDS_PER_QUOTE: number;
/** Venue keys for excludeVenues, with descriptions. */
export declare const VENUES: Readonly<Record<VenueKey, string>>;
export type VenueKey =
  | 'stamm' | 'tinyman_v2' | 'pact_cp' | 'pact_stable' | 'pact_weighted' | 'pact_clmm' | 'algofi_cp'
  | 'humble_v2' | 'biatec' | 'folks_lend' | 'xalgo' | 'talgo' | 'dualstake';
export declare const MAX_GROUP_SIZE: 16;
export declare const MAX_REFERRER_ASSETS: 200;

/**
 * Put your own transactions around a HogSwap group, as one atomic group: `before` runs first,
 * `after` runs once the swap has paid out (it can spend up to min_out_at_slippage of the output).
 * At most 16 in total: quote with maxOuterTxns: 16 - before.length - after.length. Pass your
 * algosdk module.
 */
export declare function composeGroup<T = any>(p: { algosdk: any; build: { unsigned_group: UnsignedTxn[] }; before?: Array<T | Uint8Array>; after?: Array<T | Uint8Array> }): T[];
