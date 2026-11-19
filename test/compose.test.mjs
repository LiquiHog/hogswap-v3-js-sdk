import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeGroup, bytesToBase64, HogswapInputError, MAX_GROUP_SIZE, VENUES } from '../src/index.js';

// A stand-in for algosdk: transactions are objects with a name and a group field.
function fakeAlgosdk() {
  const seenGroupsAtAssign = [];
  return {
    seenGroupsAtAssign,
    decodeUnsignedTransaction: (bytes) => ({ name: `swap${bytes[0]}`, group: 'OLD', txID: () => 'x' }),
    assignGroupID(txns) {
      seenGroupsAtAssign.push(txns.map((t) => t.group));
      for (const t of txns) t.group = 'NEW';
      return txns;
    },
  };
}

const build = (n) => ({ unsigned_group: Array.from({ length: n }, (_, i) => ({ txn_b64: bytesToBase64(new Uint8Array([i])) })) });
const mine = (name) => ({ name, group: undefined, txID: () => name });

test('composeGroup puts your transactions first and regroups everything', () => {
  const algosdk = fakeAlgosdk();
  const out = composeGroup({ algosdk, build: build(3), before: [mine('a'), mine('b')] });
  assert.deepEqual(out.map((t) => t.name), ['a', 'b', 'swap0', 'swap1', 'swap2']);
  assert.ok(out.every((t) => t.group === 'NEW'));
  // The old group id is cleared before the new one is computed.
  assert.deepEqual(algosdk.seenGroupsAtAssign[0], [undefined, undefined, undefined, undefined, undefined]);
});

test('composeGroup puts after-transactions behind the swap, and both sides together', () => {
  const out = composeGroup({ algosdk: fakeAlgosdk(), build: build(3), after: [mine('z')] });
  assert.deepEqual(out.map((t) => t.name), ['swap0', 'swap1', 'swap2', 'z']);
  const both = composeGroup({ algosdk: fakeAlgosdk(), build: build(2), before: [mine('a')], after: [mine('z')] });
  assert.deepEqual(both.map((t) => t.name), ['a', 'swap0', 'swap1', 'z']);
  assert.throws(
    () => composeGroup({ algosdk: fakeAlgosdk(), build: build(14), before: [mine('a')], after: [mine('z'), mine('y')] }),
    (e) => e instanceof HogswapInputError && /maxOuterTxns: 13/.test(e.message),
  );
});

test('composeGroup refuses groups over 16 and says how much room to leave', () => {
  assert.throws(
    () => composeGroup({ algosdk: fakeAlgosdk(), build: build(15), before: [mine('a'), mine('b')] }),
    (e) => e instanceof HogswapInputError && /maxOuterTxns: 14/.test(e.message),
  );
  assert.equal(MAX_GROUP_SIZE, 16);
});

test('composeGroup needs algosdk and real transactions', () => {
  assert.throws(() => composeGroup({ build: build(3), before: [mine('a')] }), HogswapInputError);
  assert.throws(() => composeGroup({ algosdk: fakeAlgosdk(), build: build(3), before: [] }), HogswapInputError);
  assert.throws(() => composeGroup({ algosdk: fakeAlgosdk(), build: build(3) }), HogswapInputError);
  assert.throws(() => composeGroup({ algosdk: fakeAlgosdk(), build: build(3), before: [{}] }), HogswapInputError);
});

test('venue keys are listed', () => {
  assert.ok('pact_clmm' in VENUES && 'stamm' in VENUES && 'tinyman_v2' in VENUES);
  assert.equal(Object.keys(VENUES).length, 13);
});
