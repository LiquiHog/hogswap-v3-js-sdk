import { HogswapInputError } from './errors.js';

/*
 * Token amounts on Algorand are unsigned 64-bit integers in base units. Many real balances and
 * supplies are larger than JavaScript numbers can hold exactly (above 2^53 - 1), so:
 *  - the API sends every quantity as a decimal string;
 *  - this SDK sends every quantity as a decimal string;
 *  - do arithmetic with BigInt, never Number, and never mix the two in one expression.
 */

const UINT64_MAX = (1n << 64n) - 1n;
const DIGITS = /^[0-9]+$/;

/**
 * A base-unit amount for a request: a bigint, a string of digits, or a safe non-negative integer
 * number. Returns the decimal string the API expects. Throws HogswapInputError otherwise, so a
 * rounded or fractional number can never reach the API.
 *
 * @param {bigint | string | number} value
 * @param {string} [name] used in the error message
 * @returns {string}
 */
export function toAmountString(value, name = 'amount') {
  return toBigIntStrict(value, name).toString();
}

/**
 * The same checks as toAmountString, returning a bigint.
 * @param {bigint | string | number} value
 * @param {string} [name]
 * @returns {bigint}
 */
export function toBigIntStrict(value, name = 'amount') {
  let v;
  if (typeof value === 'bigint') {
    v = value;
  } else if (typeof value === 'string') {
    const s = value.trim();
    if (!DIGITS.test(s)) throw new HogswapInputError(`${name} must be a whole number of base units, got "${value}"`);
    v = BigInt(s);
  } else if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new HogswapInputError(`${name} must be a whole number of base units, got ${value}`);
    if (!Number.isSafeInteger(value)) {
      throw new HogswapInputError(`${name} ${value} is too large for a JavaScript number to hold exactly; pass a bigint or a string`);
    }
    v = BigInt(value);
  } else {
    throw new HogswapInputError(`${name} must be a bigint, a string of digits or a safe integer`);
  }
  if (v < 0n) throw new HogswapInputError(`${name} must not be negative`);
  if (v > UINT64_MAX) throw new HogswapInputError(`${name} exceeds the largest Algorand amount (2^64 - 1)`);
  return v;
}

/**
 * Parse an amount from an API response (a decimal string) into a bigint. Null and undefined pass
 * through, so optional fields stay optional.
 *
 * @template {string | number | bigint | null | undefined} T
 * @param {T} value
 * @returns {T extends null ? null : T extends undefined ? undefined : bigint}
 */
export function toBigInt(value) {
  if (value === null || value === undefined) return /** @type {any} */ (value);
  if (typeof value === 'bigint') return /** @type {any} */ (value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new HogswapInputError(`${value} is not a safe integer; the API sends large amounts as strings`);
    return /** @type {any} */ (BigInt(value));
  }
  const s = String(value).trim();
  if (!/^-?[0-9]+$/.test(s)) throw new HogswapInputError(`"${value}" is not an integer amount`);
  return /** @type {any} */ (BigInt(s));
}

/**
 * An asset or app id for a request. Ids are well within the safe-integer range today, and the
 * API takes them as JSON numbers.
 *
 * @param {number | bigint | string} value
 * @param {string} [name]
 * @returns {number}
 */
export function toId(value, name = 'id') {
  const v = toBigIntStrict(value, name);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new HogswapInputError(`${name} ${v} is out of range`);
  return Number(v);
}

/**
 * Base units to a human-readable decimal string, without floating point.
 * formatUnits(1234567n, 6) === '1.234567'; formatUnits('5000000', 6) === '5'.
 *
 * @param {bigint | string | number} amount base units
 * @param {number} decimals the asset's decimals (0-19)
 * @param {{maxDecimals?: number, trimZeros?: boolean}} [opts] maxDecimals truncates (never rounds up)
 * @returns {string}
 */
export function formatUnits(amount, decimals, opts = {}) {
  checkDecimals(decimals);
  let v = toBigInt(/** @type {any} */ (amount));
  const negative = v < 0n;
  if (negative) v = -v;
  const base = 10n ** BigInt(decimals);
  const whole = (v / base).toString();
  let frac = decimals === 0 ? '' : (v % base).toString().padStart(decimals, '0');
  if (opts.maxDecimals !== undefined && opts.maxDecimals < frac.length) frac = frac.slice(0, Math.max(0, opts.maxDecimals));
  if (opts.trimZeros !== false) frac = frac.replace(/0+$/, '');
  return (negative ? '-' : '') + whole + (frac ? `.${frac}` : '');
}

/**
 * A human-readable decimal string to base units, exactly. parseUnits('1.5', 6) === 1500000n.
 * Throws if the text has more decimal places than the asset allows.
 *
 * @param {string} text e.g. "12.5"
 * @param {number} decimals the asset's decimals (0-19)
 * @returns {bigint}
 */
export function parseUnits(text, decimals) {
  checkDecimals(decimals);
  const s = String(text).trim().replace(/_/g, '');
  const m = /^([0-9]*)(?:\.([0-9]*))?$/.exec(s);
  if (!m || (m[1] === '' && (m[2] ?? '') === '')) throw new HogswapInputError(`"${text}" is not a decimal amount`);
  const frac = m[2] ?? '';
  if (frac.replace(/0+$/, '').length > decimals) {
    throw new HogswapInputError(`"${text}" has more than ${decimals} decimal places`);
  }
  const v = BigInt((m[1] || '0') + frac.padEnd(decimals, '0').slice(0, decimals));
  if (v > UINT64_MAX) throw new HogswapInputError(`"${text}" exceeds the largest Algorand amount`);
  return v;
}

/**
 * The amount left after slippage, rounded down. (A quote's min_out_at_slippage applies the
 * slippage to `expected_out_robust`, a slightly conservative `expected_out`.)
 * @param {bigint | string | number} amount
 * @param {number} slippageBps 1-5000
 * @returns {bigint}
 */
export function applySlippage(amount, slippageBps) {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10000) {
    throw new HogswapInputError('slippageBps must be an integer 0-10000');
  }
  return (toBigInt(/** @type {any} */ (amount)) * BigInt(10000 - slippageBps)) / 10000n;
}

function checkDecimals(decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 19) {
    throw new HogswapInputError('decimals must be an integer 0-19');
  }
}
