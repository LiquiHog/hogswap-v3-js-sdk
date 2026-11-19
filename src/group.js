import { HogswapInputError, HogswapSubmitError } from './errors.js';

/*
 * Helpers for the unsigned groups that /execute, /referrer/setup and /referrer/claim return.
 * HogSwap never signs or sends anything: your user's wallet signs, and you submit the signed
 * group to an algod node you choose. These helpers need no Algorand SDK.
 */

/**
 * Base64 to bytes, in browsers and Node 18+.
 * @param {string} b64
 * @returns {Uint8Array}
 */
export function base64ToBytes(b64) {
  if (typeof b64 !== 'string') throw new HogswapInputError('expected a base64 string');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Bytes to base64, in browsers and Node 18+.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, /** @type {any} */ (bytes.subarray(i, i + chunk)));
  }
  return btoa(bin);
}

/**
 * The transactions of an unsigned group, as base64 strings, in order. Accepts an /execute
 * response, one group from a referrer response, or the `unsigned_group` array itself.
 *
 * @param {{unsigned_group: Array<{txn_b64: string}>} | Array<{txn_b64: string}>} group
 * @returns {string[]}
 */
export function groupBase64(group) {
  const list = Array.isArray(group) ? group : group?.unsigned_group;
  if (!Array.isArray(list) || list.length === 0) throw new HogswapInputError('expected an unsigned group (unsigned_group: [{txn_b64}])');
  return list.map((t, i) => {
    if (typeof t?.txn_b64 !== 'string') throw new HogswapInputError(`unsigned_group[${i}] has no txn_b64`);
    return t.txn_b64;
  });
}

/**
 * The transactions of an unsigned group as msgpack bytes, ready for wallets that take bytes
 * (use-wallet's signTransactions, Lute, algosdk.decodeUnsignedTransaction).
 *
 * @param {{unsigned_group: Array<{txn_b64: string}>} | Array<{txn_b64: string}>} group
 * @returns {Uint8Array[]}
 */
export function groupBytes(group) {
  return groupBase64(group).map(base64ToBytes);
}

/**
 * Check a wallet's signing result before submitting: one signed transaction per transaction in
 * the group, none missing. Returns the list typed as Uint8Array[].
 *
 * @param {Array<Uint8Array | null | undefined>} signed
 * @param {number} expected the group's length
 * @returns {Uint8Array[]}
 */
export function assertFullySigned(signed, expected) {
  if (!Array.isArray(signed) || signed.length !== expected) {
    throw new HogswapInputError(`expected ${expected} signed transactions, got ${Array.isArray(signed) ? signed.length : typeof signed}`);
  }
  signed.forEach((s, i) => {
    if (!(s instanceof Uint8Array) || s.length === 0) {
      throw new HogswapInputError(`transaction ${i} was not signed (the wallet returned nothing for it)`);
    }
  });
  return /** @type {Uint8Array[]} */ (signed);
}

/**
 * @typedef {object} AlgodOptions
 * @property {string} algodUrl e.g. "https://mainnet-api.algonode.cloud" or your own node
 * @property {string} [algodToken] sent in `algodTokenHeader` when set
 * @property {string} [algodTokenHeader] default "X-Algo-API-Token"
 * @property {typeof fetch} [fetch]
 */

function algod(opts) {
  if (!opts || typeof opts.algodUrl !== 'string' || !opts.algodUrl) throw new HogswapInputError('algodUrl is required');
  const f = opts.fetch ?? globalThis.fetch;
  if (typeof f !== 'function') throw new HogswapInputError('no fetch available; pass opts.fetch');
  const headers = {};
  if (opts.algodToken) headers[opts.algodTokenHeader ?? 'X-Algo-API-Token'] = opts.algodToken;
  return { base: opts.algodUrl.replace(/\/+$/, ''), f, headers };
}

/**
 * algod sends amounts as plain JSON numbers, which JavaScript rounds above 2^53 - 1. Integers
 * with 16 or more digits are read as strings instead (algod's JSON has no floats), so amounts stay
 * exact: wrap them in BigInt().
 * @param {string} text
 * @returns {any}
 */
export function parseJsonLossless(text) {
  return JSON.parse(text.replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,\]}])/g, '$1"$2"'));
}

/**
 * Submit a fully signed group to an algod node, as one atomic group.
 *
 * @param {Uint8Array[]} signed every transaction of the group, signed, in order
 * @param {AlgodOptions} opts
 * @returns {Promise<{txId: string}>} the first transaction's id
 */
export async function submitSignedGroup(signed, opts) {
  const { base, f, headers } = algod(opts);
  assertFullySigned(signed, signed?.length ?? 0);
  const total = signed.reduce((n, s) => n + s.length, 0);
  const body = new Uint8Array(total);
  let off = 0;
  for (const s of signed) {
    body.set(s, off);
    off += s.length;
  }
  let res;
  try {
    res = await f(`${base}/v2/transactions`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-binary' }, body });
  } catch (cause) {
    throw new HogswapSubmitError(`could not reach algod at ${base}`, { cause, code: 'network' });
  }
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (!res.ok) {
    const message = parsed?.message ?? text.slice(0, 300);
    throw new HogswapSubmitError(`algod refused the group (HTTP ${res.status}): ${message}`, { status: res.status, body: parsed ?? text });
  }
  if (!parsed?.txId) throw new HogswapSubmitError('algod accepted the group but returned no txId', { status: res.status, body: parsed ?? text });
  return { txId: parsed.txId };
}

/**
 * Wait until a transaction is confirmed. Polls /v2/transactions/pending/{txId}, which every algod
 * and most hosted nodes allow. Throws if the node reports a pool error or the wait times out.
 *
 * @param {string} txId
 * @param {AlgodOptions & {timeoutMs?: number, pollMs?: number}} opts default 30 s, polling every 1 s
 * @returns {Promise<Record<string, any>>} the pending-transaction record, with `confirmed-round`
 */
export async function waitForConfirmation(txId, opts) {
  const { base, f, headers } = algod(opts);
  const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
  const pollMs = opts.pollMs ?? 1000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await f(`${base}/v2/transactions/pending/${encodeURIComponent(txId)}?format=json`, { headers });
      if (res.ok) {
        const info = parseJsonLossless(await res.text());
        if (info['confirmed-round'] > 0) return info;
        if (info['pool-error']) throw new HogswapSubmitError(`transaction ${txId} was rejected: ${info['pool-error']}`, { body: info, code: 'pool_error' });
      } else if (res.status !== 404 && res.status !== 429) {
        lastError = new HogswapSubmitError(`algod returned HTTP ${res.status} while waiting for ${txId}`, { status: res.status });
      }
    } catch (e) {
      if (e instanceof HogswapSubmitError && e.code === 'pool_error') throw e;
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new HogswapSubmitError(`transaction ${txId} not confirmed within ${opts.timeoutMs ?? 30_000} ms`, { code: 'timeout', cause: lastError });
}

/**
 * What a confirmed swap actually paid `receiver` in `assetId` (0 = ALGO), read from the router's
 * final transaction. Use it to size a follow-up action exactly (see docs/AFTER-SWAP.md).
 *
 * `finalTxId` is the id of the swap group's LAST transaction. With algosdk:
 * `algosdk.decodeUnsignedTransaction(groupBytes(build).at(-1)).txID()`.
 * Call it soon after confirmation: nodes keep confirmed transactions in this view for a while,
 * not forever.
 *
 * @param {{finalTxId: string, receiver: string, assetId: number}} p
 * @param {AlgodOptions & {timeoutMs?: number, pollMs?: number}} opts
 * @returns {Promise<bigint>} base units received
 */
export async function receivedFromSwap(p, opts) {
  const info = await waitForConfirmation(p.finalTxId, opts);
  let total = 0n;
  const walk = (node) => {
    for (const it of node?.['inner-txns'] ?? []) {
      const t = it?.txn?.txn ?? {};
      if (p.assetId === 0 && t.type === 'pay' && t.rcv === p.receiver) total += BigInt(t.amt ?? 0);
      if (p.assetId !== 0 && t.type === 'axfer' && t.arcv === p.receiver && Number(t.xaid) === p.assetId) total += BigInt(t.aamt ?? 0);
      walk(it);
    }
  };
  walk(info);
  return total;
}

/**
 * Submit a signed group and wait for it to confirm.
 * @param {Uint8Array[]} signed
 * @param {AlgodOptions & {timeoutMs?: number, pollMs?: number}} opts
 * @returns {Promise<{txId: string, confirmedRound: number}>}
 */
export async function submitAndConfirm(signed, opts) {
  const { txId } = await submitSignedGroup(signed, opts);
  const info = await waitForConfirmation(txId, opts);
  return { txId, confirmedRound: info['confirmed-round'] };
}
