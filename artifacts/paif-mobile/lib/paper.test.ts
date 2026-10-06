import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buyAtQuote, initialPaperState, isFreshQuote, paperSchema, sellAtQuote } from './paper';
import { tokenSchema, type Token } from './models';
import { ed25519 } from '@noble/curves/ed25519';
import { verifyWalletPayload } from './wallet-proof';

const now = Date.parse('2026-10-05T12:00:00Z');
const token: Token = {
  mint: 'So11111111111111111111111111111111111111112',
  symbol: 'TEST', name: 'Unit test quote', price: '2',
  marketDataAt: new Date(now).toISOString(),
  change1h: null, change5m: null, mcap: null, volume1h: null,
  volume24h: null, liquidity: null, txns1h: null,
};

test('a simulated round trip settles chips and realized return without a wallet', () => {
  const initial = initialPaperState();
  const bought = buyAtQuote(initial, token, 100, now);
  assert.equal(initial.cash, 10_000);
  assert.equal(bought.cash, 9900);
  assert.equal(bought.positions[0].tokenUnits, 50);
  const sold = sellAtQuote(bought, { ...token, price: '3' }, now);
  assert.equal(sold.cash, 10_050);
  assert.equal(sold.positions.length, 0);
  assert.equal(sold.trades[0].profit, 50);
  assert.throws(() => sellAtQuote(sold, token, now), /already closed/);
});

test('additional entries consolidate cost basis without inventing gains', () => {
  const first = buyAtQuote(initialPaperState(), token, 100, now);
  const second = buyAtQuote(first, { ...token, price: '4' }, 100, now);
  assert.equal(second.positions.length, 1);
  assert.equal(second.positions[0].tokenUnits, 75);
  assert.equal(second.positions[0].chipsInvested, 200);
  const sold = sellAtQuote(second, { ...token, price: '4' }, now);
  assert.equal(sold.trades[0].profit, 100);
  assert.equal(sold.cash, 10_100);
});

test('stale, future, missing, zero, NaN and negative prices cannot buy or sell', () => {
  const bought = buyAtQuote(initialPaperState(), token, 100, now);
  const invalidQuotes = [
    { ...token, marketDataAt: new Date(now - 120_001).toISOString() },
    { ...token, marketDataAt: new Date(now + 1).toISOString() },
    { ...token, marketDataAt: null },
    { ...token, price: '0' }, { ...token, price: '-1' },
    { ...token, price: 'NaN' }, { ...token, price: 'Infinity' },
  ];
  for (const quote of invalidQuotes) {
    assert.equal(isFreshQuote(quote, now), false);
    assert.throws(() => buyAtQuote(bought, quote, 1, now));
    assert.throws(() => sellAtQuote(bought, quote, now));
  }
  assert.equal(bought.cash, 9900);
  assert.equal(bought.positions.length, 1);
});

test('invalid/over-budget amounts and numeric overflow do not mutate the ledger', () => {
  const state = initialPaperState();
  for (const amount of [0, -1, Infinity, NaN, 10_001]) assert.throws(() => buyAtQuote(state, token, amount, now));
  assert.throws(() => buyAtQuote(state, { ...token, price: '5e-324' }, 100, now), /valid simulated position/);
  assert.deepEqual(state, initialPaperState());
});

test('persistence round trips all positions and settled history and rejects corruption', () => {
  const saved = sellAtQuote(buyAtQuote(initialPaperState(), token, 75, now), token, now);
  assert.deepEqual(paperSchema.parse(JSON.parse(JSON.stringify(saved))), saved);
  assert.throws(() => paperSchema.parse({ ...saved, cash: -1 }));
  assert.throws(() => paperSchema.parse({ ...saved, trades: [saved.trades[0], saved.trades[0]] }));
  assert.throws(() => paperSchema.parse({ ...saved, version: 0 }));
});

test('missing movement/liquidity stay unknown rather than silently becoming zero', () => {
  const parsed = tokenSchema.parse({ mint: token.mint, symbol: 'TEST', name: 'Test', price: '2' });
  assert.equal(parsed.marketDataAt, null);
  assert.equal(parsed.change1h, null);
  assert.equal(parsed.liquidity, null);
});

test('the MWA message payload is verified against exact bytes and selected public key', () => {
  // Deterministic fixture only, not a stored/user wallet or a production key.
  const privateKey = new Uint8Array(32).fill(7);
  const publicKey = ed25519.getPublicKey(privateKey);
  const message = new TextEncoder().encode('PAIF test message — no transfers');
  const signature = ed25519.sign(message, privateKey);
  const payload = new Uint8Array(message.length + signature.length);
  payload.set(message); payload.set(signature, message.length);
  assert.ok(verifyWalletPayload(payload, message, publicKey));
  const changed = new Uint8Array(payload); changed[0] ^= 1;
  assert.throws(() => verifyWalletPayload(changed, message, publicKey), /different message/);
  assert.throws(() => verifyWalletPayload(signature, message, publicKey), /format/);
  assert.throws(() => verifyWalletPayload(payload, message, ed25519.getPublicKey(new Uint8Array(32).fill(8))), /did not match/);
});
