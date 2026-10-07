import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sendBotMutationOnce, UnknownBotOutcomeError } from './bot-mutation-request';
import { createMobileSwingBot, updateMobileSwingSettings, respondMobileSwingSignal, setBaseUrl } from '@workspace/api-client-react';
import {
  defaultSwingDraft, validateSwingDraft, draftFromBot, swingCreatePayload, swingSettingsPayload,
  swingCreateMessage, swingSettingsMessage, swingSignalMessage,
} from './swing-setup-model';

test('creation defaults are paper with owner approval and no stacking', () => {
  const d = defaultSwingDraft();
  assert.equal(validateSwingDraft(d), null);
  const p = swingCreatePayload(d);
  assert.equal(p.mode, 'paper');
  assert.equal(p.requireApproval, true);
  assert.equal(p.allowStacking, false);
  assert.equal('takeProfitPct' in p, false);
  assert.equal('targetMint' in p, false);
});

test('all numeric controls reject empty, nonfinite, fractional integers and out-of-range values', () => {
  const cases = {
    budgetSol: ['', 'NaN', '1e2', '0', '10.01', '0.009'],
    windowHours: ['', '11', '721', '12.5'],
    maxPositions: ['', '0', '11', '1.5'],
    minLiquidityUsd: ['', '4999', '1000001', 'Infinity'],
    minPoolAgeHours: ['', '-1', '721', '0.5'],
    takeProfitPct: ['2', '501', '3.5', 'NaN'],
    profitSkimPct: ['', '-1', '101', '4.5'],
    lossStopCount: ['', '0', '21', '2.5'],
    stopRoomPct: ['1', '51', '3.5', 'NaN', 'Infinity'],
    winnerKeepPct: ['39', '91', '60.5', 'NaN', 'Infinity'],
  };
  for (const [key, values] of Object.entries(cases)) {
    for (const value of values) assert.ok(validateSwingDraft({ ...defaultSwingDraft(), [key]: value }), `${key}: ${value}`);
  }
  assert.ok(validateSwingDraft({ ...defaultSwingDraft(), name: ' ' }));
  assert.ok(validateSwingDraft({ ...defaultSwingDraft(), name: 'x'.repeat(41) }));
});

test('explicit live creation retains bounds and watch-only payload omits scanner controls', () => {
  const d = { ...defaultSwingDraft(), mode: 'live' as const, kind: 'watch' as const, targetMint: 'So11111111111111111111111111111111111111112', takeProfitPct: '10' };
  const p = swingCreatePayload(d);
  assert.equal(p.mode, 'live');
  assert.equal(p.targetMint, d.targetMint);
  assert.equal(p.takeProfitPct, 10);
  assert.equal('requireApproval' in p, false);
  assert.equal('minPoolAgeHours' in p, false);
  assert.ok(validateSwingDraft({ ...d, targetMint: 'wrong' }));
});

test('settings omit immutable fields and clear profit target with null', () => {
  const p = swingSettingsPayload({ ...defaultSwingDraft(), mode: 'live', budgetSol: '', windowHours: '' });
  assert.equal(p.takeProfitPct, null);
  for (const k of ['budgetSol', 'mode', 'windowHours', 'targetMint', 'universe', 'style', 'unlimitedWindow', 'reentry', 'watchHoldLong', 'manualBuy']) assert.equal(k in p, false);
  assert.equal(p.stopRoomPct, null);
  assert.equal(p.winnerKeepPct, null);
});

const saved = {
  id: 'bot-1', name: 'Saved', mode: 'paper', status: 'active', universe: 'crypto', targetMint: null,
  budgetLamports: '100000000', maxPositions: 2, minLiquidityUsd: 60000, minPoolAgeHours: 48,
  requireApproval: false, takeProfitPct: 17, profitSkimPct: 70, lossStopCount: 6,
  style: 'quick', stopRoomPct: null, winnerKeepPct: null, neverSellAtLoss: false,
  redEndBehavior: 'sell', allowStacking: false, hotStreakFullSize: false,
  unlimitedWindow: false, reentry: false,
};
test('valid server settings round trip without replacing owner choices', () => {
  const d = draftFromBot(saved);
  assert.equal(d.takeProfitPct, '17');
  assert.equal(d.requireApproval, false);
  assert.deepEqual(swingSettingsPayload(d), {
    name: 'Saved', maxPositions: 2, takeProfitPct: 17, profitSkimPct: 70, lossStopCount: 6,
    minLiquidityUsd: 60000, minPoolAgeHours: 48, requireApproval: false,
    stopRoomPct: null, winnerKeepPct: null, neverSellAtLoss: false,
    redEndBehavior: 'sell', allowStacking: false, hotStreakFullSize: false,
  });
});

test('failed/incomplete or unsupported settings never fall back to a new draft', () => {
  assert.throws(() => draftFromBot({}), /incomplete/);
  assert.throws(() => draftFromBot({ ...saved, universe: 'stocks' }), /Tokenized-stock/);
  assert.throws(() => draftFromBot({ ...saved, profitSkimPct: undefined }), /incomplete/);
});

test('legacy fractional targets stay visible and must be explicitly corrected before saving', () => {
  const draft = draftFromBot({ ...saved, takeProfitPct: 17.5 });
  assert.equal(draft.takeProfitPct, '17.5');
  assert.ok(validateSwingDraft(draft, true));
  assert.throws(() => swingSettingsPayload(draft), /whole percent/);
});

test('automation choices round trip and automatic protection explicitly clears overrides', () => {
  const d = draftFromBot({
    ...saved, stopRoomPct: 13, winnerKeepPct: 71, neverSellAtLoss: true,
    redEndBehavior: 'send_tokens', allowStacking: true, hotStreakFullSize: true,
    unlimitedWindow: true,
  });
  assert.equal(validateSwingDraft(d, true), null);
  const p = swingSettingsPayload(d);
  assert.equal(p.stopRoomPct, 13);
  assert.equal(p.winnerKeepPct, 71);
  assert.equal(p.neverSellAtLoss, true);
  assert.equal(p.redEndBehavior, 'send_tokens');
  assert.equal(p.allowStacking, true);
  assert.equal(p.hotStreakFullSize, true);
  assert.equal(d.unlimitedWindow, true);
  const automatic = swingSettingsPayload({ ...d, stopRoomPct: '', winnerKeepPct: '' });
  assert.equal(automatic.stopRoomPct, null);
  assert.equal(automatic.winnerKeepPct, null);
});

test('watch creation enables repeat entries and long protection without scanner-only settings', () => {
  const d = {
    ...defaultSwingDraft(), kind: 'watch' as const,
    targetMint: 'So11111111111111111111111111111111111111112',
    reentry: true, watchHoldLong: true, unlimitedWindow: true,
    allowStacking: true, hotStreakFullSize: true, stopRoomPct: '8', winnerKeepPct: '75',
  };
  const p = swingCreatePayload(d);
  assert.equal(p.style, 'ride');
  assert.equal(p.reentry, true);
  assert.equal(p.unlimitedWindow, true);
  assert.equal(p.manualBuy, false);
  assert.equal(p.maxPositions, 1);
  assert.equal(p.allowStacking, false);
  for (const key of ['stopRoomPct', 'winnerKeepPct', 'hotStreakFullSize', 'requireApproval']) assert.equal(key in p, false);
  assert.equal(swingCreatePayload({ ...d, watchHoldLong: false }).style, 'quick');
});

test('legacy non-smart scanners do not send ignored protection overrides', () => {
  const d = draftFromBot({ ...saved, style: 'ride', stopRoomPct: 8, winnerKeepPct: 75 });
  const p = swingSettingsPayload(d);
  assert.equal('style' in p, false);
  assert.equal('stopRoomPct' in p, false);
  assert.equal('winnerKeepPct' in p, false);
});

test('an unlimited run cannot be blocked by a hidden invalid scheduled-window field', () => {
  const d = { ...defaultSwingDraft(), unlimitedWindow: true, windowHours: '' };
  assert.equal(validateSwingDraft(d), null);
  assert.equal(swingCreatePayload(d).windowHours, 24);
  assert.equal(swingCreatePayload(d).unlimitedWindow, true);
  assert.ok(validateSwingDraft({ ...d, unlimitedWindow: false }));
});

test('invalid automation choices and incomplete saved choices cannot silently reset protection', () => {
  assert.ok(validateSwingDraft({ ...defaultSwingDraft(), redEndBehavior: 'other' as never }));
  assert.ok(validateSwingDraft({ ...defaultSwingDraft(), neverSellAtLoss: 'true' as never }));
  assert.throws(() => draftFromBot({ ...saved, stopRoomPct: undefined }), /incomplete/);
  assert.throws(() => draftFromBot({ ...saved, winnerKeepPct: undefined }), /incomplete/);
});

test('signature protocol binds creation to owner and settings/signals to precise actions', () => {
  assert.equal(swingCreateMessage('owner', 123), 'paif-swing|v1|create|owner|123');
  assert.equal(swingSettingsMessage('id', 'owner', 123), 'paif-swing|v1|settings|id|owner|123');
  assert.equal(swingSignalMessage('id', 'sig1', 'approve', 'owner', 123), 'paif-swing|v1|approve:sig1|id|owner|123');
  assert.notEqual(swingSignalMessage('id', 'sig1', 'approve', 'owner', 123), swingSignalMessage('id', 'sig1', 'dismiss', 'owner', 123));
  assert.notEqual(swingSignalMessage('id', 'sig1', 'approve', 'owner', 123), swingSignalMessage('id', 'sig2', 'approve', 'owner', 123));
});

test('generated requests carry owner signatures and never include immutable fields in settings', async () => {
  const originalFetch = globalThis.fetch;
  const requests: { url: string; body: Record<string, unknown>; credentials?: RequestCredentials }[] = [];
  setBaseUrl('https://api.test');
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)), credentials: init?.credentials });
    return new Response(JSON.stringify({ strategy: { id: 'bot-1', name: 'Saved', mode: 'paper', status: 'active' }, fundingAddress: 'public-address', recommendedFundingSol: 0, ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const authorization = { ownerWallet: 'owner', nonce: 123, signature: 'signed-proof' };
    const options = { credentials: 'omit' as const, cache: 'no-store' as const };
    await createMobileSwingBot({ ...swingCreatePayload(defaultSwingDraft()), ...authorization }, options);
    await updateMobileSwingSettings('bot-1', { ...swingSettingsPayload(defaultSwingDraft()), ...authorization }, options);
    await respondMobileSwingSignal('bot-1', 'pick-1', 'approve', authorization, options);
    assert.deepEqual(requests.map((r) => r.url), ['https://api.test/api/swing-bot/create', 'https://api.test/api/swing-bot/bot-1/settings', 'https://api.test/api/swing-bot/bot-1/signal/pick-1/approve']);
    for (const r of requests) {
      assert.equal(r.body.ownerWallet, 'owner');
      assert.equal(r.body.signature, 'signed-proof');
      assert.equal(r.body.nonce, 123);
      assert.equal(r.credentials, 'omit');
    }
    assert.equal(requests[0].body.mode, 'paper');
    assert.equal('mode' in requests[1].body, false);
    assert.equal(requests[1].body.takeProfitPct, null);
  } finally {
    globalThis.fetch = originalFetch;
    setBaseUrl(null);
  }
});

test('network, malformed-response and server errors are unknown outcomes, never retried', async () => {
  for (const cause of [new Error('Network failed'), new SyntaxError('Malformed JSON'), { status: 503 }]) {
    let calls = 0;
    await assert.rejects(() => sendBotMutationOnce(async () => { calls++; throw cause; }), UnknownBotOutcomeError);
    assert.equal(calls, 1);
  }
});

test('entitlement denial stays an actionable error without retrying or bypassing access', async () => {
  let calls = 0;
  await assert.rejects(() => sendBotMutationOnce(async () => {
    calls++;
    throw { status: 402, data: { error: 'Paper Swing Bot requires an active Access Pass or your one-time 3-day trial.' } };
  }), /Access Pass/);
  assert.equal(calls, 1);
});

test('timeout aborts one request and warns that work may already have committed', async () => {
  let calls = 0;
  await assert.rejects(() => sendBotMutationOnce((signal) => {
    calls++;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted'))));
  }, 5), /Refresh your bots/);
  assert.equal(calls, 1);
});
