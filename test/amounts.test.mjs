import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toAmountString, toBigInt, toBigIntStrict, toId, formatUnits, parseUnits, applySlippage, HogswapInputError } from '../src/index.js';

const BIG = '18446744073709551615'; // 2^64 - 1, a real on-chain supply

test('request amounts: bigint, digit strings and safe integers become exact strings', () => {
  assert.equal(toAmountString(1500000n), '1500000');
  assert.equal(toAmountString(' 42 '), '42');
  assert.equal(toAmountString(7), '7');
  assert.equal(toAmountString(BIG), BIG);
  assert.equal(toAmountString(BigInt(BIG)), BIG);
});

test('request amounts: anything that could lose precision is refused before sending', () => {
  assert.throws(() => toAmountString(2 ** 60), HogswapInputError); // unsafe number
  assert.throws(() => toAmountString(1.5), HogswapInputError);
  assert.throws(() => toAmountString('1.5'), HogswapInputError);
  assert.throws(() => toAmountString('1e6'), HogswapInputError);
  assert.throws(() => toAmountString(-1), HogswapInputError);
  assert.throws(() => toAmountString((1n << 64n).toString()), HogswapInputError);
  assert.throws(() => toAmountString(null), HogswapInputError);
});

test('response amounts parse to exact bigints', () => {
  assert.equal(toBigInt(BIG), 18446744073709551615n);
  assert.equal(toBigInt(null), null);
  assert.equal(toBigInt(undefined), undefined);
  assert.equal(toBigInt(12), 12n);
  assert.throws(() => toBigInt(2 ** 60), HogswapInputError);
  assert.throws(() => toBigInt('abc'), HogswapInputError);
  // Arithmetic stays in BigInt: no mixing errors, no rounding.
  assert.equal(toBigInt(BIG) - toBigInt('1'), 18446744073709551614n);
});

test('formatUnits and parseUnits are exact inverses', () => {
  assert.equal(formatUnits(1234567n, 6), '1.234567');
  assert.equal(formatUnits('5000000', 6), '5');
  assert.equal(formatUnits('5000000', 6, { trimZeros: false }), '5.000000');
  assert.equal(formatUnits(BIG, 6), '18446744073709.551615');
  assert.equal(formatUnits(1999999n, 6, { maxDecimals: 2 }), '1.99'); // truncates, never rounds up
  assert.equal(formatUnits(42n, 0), '42');
  assert.equal(parseUnits('1.5', 6), 1500000n);
  assert.equal(parseUnits('0.000001', 6), 1n);
  assert.equal(parseUnits('18446744073709.551615', 6), BigInt(BIG));
  assert.equal(parseUnits('2.50', 1), 25n); // trailing zeros beyond decimals are fine
  assert.throws(() => parseUnits('0.0000001', 6), HogswapInputError);
  assert.throws(() => parseUnits('1,5', 6), HogswapInputError);
  assert.throws(() => parseUnits('', 6), HogswapInputError);
  for (const s of ['0', '1', '0.1', '123456.654321']) assert.equal(formatUnits(parseUnits(s, 6), 6), s);
});

test('ids and slippage', () => {
  assert.equal(toId('3178895177'), 3178895177);
  assert.equal(toId(31566704n), 31566704);
  assert.throws(() => toId('x'), HogswapInputError);
  assert.equal(applySlippage(1000000n, 50), 995000n);
  assert.equal(applySlippage('999', 50), 994n); // rounds down
  assert.equal(toBigIntStrict('0'), 0n);
});
