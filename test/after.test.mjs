import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HogswapClient, HogswapMissingOptInError, HogswapBuildError, receivedFromSwap, parseJsonLossless } from '../src/index.js';

const ADDR = 'AEBAGBAFAYDQQCIKBMGA2DQPCAIREEYUCULBOGAZDINRYHI6D4QDTYK3BA';
const reply = (body) => async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body), json: async () => body });
const client = (body) => new HogswapClient({ fetch: reply(body), rateLimit: false, retries: 0 });
const build = (extra) => ({ quote_id: 'q', unsigned_group: [{ txn_b64: 'AQID' }], notes: [], ...extra });

test('execute throws for a group that would fail as it stands', async () => {
  await assert.rejects(
    client(build({ warnings: [{ code: 'missing_opt_in', detail: 'not opted in', assets: [31566704] }] })).execute({ quoteId: 'q', userAddress: ADDR }),
    (e) => e instanceof HogswapMissingOptInError && e.assets[0] === 31566704,
  );
  await assert.rejects(
    client(build({ warnings: [{ code: 'insufficient_balance', detail: 'cannot fund' }] })).execute({ quoteId: 'q', userAddress: ADDR }),
    (e) => e instanceof HogswapBuildError && e.code === 'insufficient_balance',
  );
});

test('execute returns the build with allowWarnings, a min_out warning, or an unsimulated prefix', async () => {
  const w = { warnings: [{ code: 'missing_opt_in', detail: 'x', assets: [1] }] };
  assert.equal((await client(build(w)).execute({ quoteId: 'q', userAddress: ADDR, allowWarnings: true })).warnings.length, 1);
  assert.equal((await client(build({ ...w, prefix_simulated: false })).execute({ quoteId: 'q', userAddress: ADDR })).quote_id, 'q');
  const risk = await client(build({ warnings: [{ code: 'min_out_risk', detail: 'moving' }] })).execute({ quoteId: 'q', userAddress: ADDR });
  assert.equal(risk.warnings[0].code, 'min_out_risk');
  assert.equal((await client(build({})).execute({ quoteId: 'q', userAddress: ADDR })).quote_id, 'q');
});

test('algod JSON is read without losing large amounts', () => {
  const v = parseJsonLossless('{"confirmed-round": 67101808, "aamt": 18446744073709551615, "list": [1, 12345678901234567890]}');
  assert.equal(v['confirmed-round'], 67101808);
  assert.equal(BigInt(v.aamt), 18446744073709551615n);
  assert.equal(BigInt(v.list[1]), 12345678901234567890n);
});

test('receivedFromSwap sums what the router paid the receiver, at any depth', async () => {
  const USER = ADDR;
  const ROUTER = '3YE4E2HHDKJZDJ4TT6KYLYEDM4RGH7T2GQ7UXD2Y3VDIQ5MVRL2UUKFY6M';
  const info = `{"confirmed-round": 5, "inner-txns": [
    {"txn": {"txn": {"type": "appl"}}, "inner-txns": [{"txn": {"txn": {"type": "axfer", "arcv": "${ROUTER}", "aamt": 999, "xaid": 31566704}}}]},
    {"txn": {"txn": {"type": "axfer", "arcv": "${USER}", "aamt": 18446744073709551615, "xaid": 31566704}}},
    {"txn": {"txn": {"type": "pay", "rcv": "${USER}", "amt": 7}}}
  ]}`;
  const f = async () => ({ ok: true, status: 200, text: async () => info, json: async () => JSON.parse(info) });
  const opts = { algodUrl: 'https://node.example', fetch: f, pollMs: 1 };
  assert.equal(await receivedFromSwap({ finalTxId: 'T', receiver: USER, assetId: 31566704 }, opts), 18446744073709551615n);
  assert.equal(await receivedFromSwap({ finalTxId: 'T', receiver: USER, assetId: 0 }, opts), 7n);
});
