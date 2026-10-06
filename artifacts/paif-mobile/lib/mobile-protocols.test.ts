import assert from 'node:assert/strict';
import { test } from 'node:test';
import { botActionMessage, botReadSessionMessage } from './bot-control-messages';
import { formatRawAmount, toRawTokenAmount } from './trading-amounts';

test('live-trade amounts convert to safe integer base units and round down', () => {
  assert.equal(toRawTokenAmount('0.05', 9), 50_000_000);
  assert.equal(toRawTokenAmount('1.23456789', 6), 1_234_567);
  assert.throws(() => toRawTokenAmount('1e2', 9), /valid amount/);
  assert.throws(() => toRawTokenAmount('-1', 9), /valid amount/);
  assert.throws(() => toRawTokenAmount('0', 9), /above zero/);
  assert.throws(() => toRawTokenAmount('0.0000000001', 9), /too small/);
});

test('base-unit output formatting preserves token precision without floating-point math', () => {
  assert.equal(formatRawAmount('123456789', 6), '123.456789');
  assert.equal(formatRawAmount('1000000000', 9), '1');
  assert.equal(formatRawAmount('123456789123456789', 18), '0.123456');
});

test('read-session messages match the server protocols for each bot family', () => {
  assert.equal(botReadSessionMessage('swing', 'Owner111', 123), 'paif-swing|v1|read-session|Owner111|123');
  assert.equal(botReadSessionMessage('auto', 'Owner111', 123), 'paif-auto-strategy|v1|read-session|Owner111|123');
});

test('lifecycle signatures bind the action, strategy id, owner, and nonce', () => {
  assert.equal(
    botActionMessage('swing', 'stop', 'strategy-1', 'Owner111', 123),
    'paif-swing|v1|stop|strategy-1|Owner111|123',
  );
  assert.equal(
    botActionMessage('auto', 'sell-now', 'strategy-2', 'Owner111', 456),
    'paif-auto-strategy|v1|sell-now|strategy-2|Owner111|456',
  );
  assert.notEqual(
    botActionMessage('auto', 'cancel', 'strategy-2', 'Owner111', 456),
    botActionMessage('auto', 'sell-now', 'strategy-2', 'Owner111', 456),
  );
});
