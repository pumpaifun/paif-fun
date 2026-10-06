import assert from "node:assert/strict";
import bs58 from "bs58";
import {
  ensureTokenTradeSubscription,
  getPumpPortalStatus,
  MAX_TOKEN_TRADE_SUBSCRIPTIONS,
  stopPumpPortal,
} from "./pump-portal";

function mintFor(index: number): string {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(index + 1, 28);
  return bs58.encode(bytes);
}

const originalNow = Date.now;
try {
  let now = originalNow();
  Date.now = () => now;
  for (let i = 0; i < MAX_TOKEN_TRADE_SUBSCRIPTIONS; i++) {
    assert.equal(ensureTokenTradeSubscription(mintFor(i)), true);
  }
  assert.equal(getPumpPortalStatus().activeTokenTradeSubscriptions, MAX_TOKEN_TRADE_SUBSCRIPTIONS);
  assert.equal(
    ensureTokenTradeSubscription(mintFor(MAX_TOKEN_TRADE_SUBSCRIPTIONS)),
    false,
    "new mints must be rejected at the global subscription cap",
  );
  assert.equal(
    ensureTokenTradeSubscription(mintFor(0)),
    true,
    "an existing subscription must remain refreshable at the cap",
  );
  assert.equal(getPumpPortalStatus().activeTokenTradeSubscriptions, MAX_TOKEN_TRADE_SUBSCRIPTIONS);
  now += 90_001;
  assert.equal(
    ensureTokenTradeSubscription(mintFor(MAX_TOKEN_TRADE_SUBSCRIPTIONS)),
    true,
    "expired subscriptions must be reaped before enforcing the cap",
  );
  assert.equal(getPumpPortalStatus().activeTokenTradeSubscriptions, 1);
} finally {
  Date.now = originalNow;
  stopPumpPortal();
}

console.log("pump-portal subscription admission tests passed");