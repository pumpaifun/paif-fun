import assert from "node:assert/strict";
import {
  getPaperExitRead,
  PAPER_MARKET_FRESH_MS,
  type PaperExitToken,
  type PaperPosition,
} from "./paper-exit";

const NOW = Date.parse("2026-09-08T12:00:00.000Z");
const position: PaperPosition = { chipsInvested: 100, tokenUnits: 100, buyCount: 1 };
const token = (overrides: Partial<PaperExitToken> = {}): PaperExitToken => ({
  price: 1,
  marketDataAt: new Date(NOW).toISOString(),
  change5m: 0,
  change1h: 0,
  ...overrides,
});
const status = (
  overrides: Partial<PaperExitToken> = {},
  positionOverrides: Partial<PaperPosition> = {},
) => getPaperExitRead(token(overrides), { ...position, ...positionOverrides }, NOW).status;

assert.equal(status(), "Hold", "a flat, valid position should remain Hold");
assert.equal(status({ price: 0.94 }), "Watch closely", "the -6% pressure boundary should be watched");
assert.equal(status({ price: 1.05, change5m: -0.01 }), "Watch closely", "a choppy +5% gain should be watched");

assert.equal(
  status({ price: 0.88, change5m: -2, change1h: -5 }),
  "Exit signal",
  "the exact loss, 5-minute, and hourly boundaries should trigger a loss Exit",
);
assert.notEqual(status({ price: 0.880001, change5m: -2, change1h: -5 }), "Exit signal");
assert.notEqual(status({ price: 0.88, change5m: -1.999, change1h: -5 }), "Exit signal");
assert.notEqual(status({ price: 0.88, change5m: -2, change1h: -4.999 }), "Exit signal");

assert.equal(
  status({ price: 1.08, change5m: -3, change1h: 0 }),
  "Exit signal",
  "the exact gain, reversal, and hourly boundaries should trigger a gain-reversal Exit",
);
assert.notEqual(status({ price: 1.079999, change5m: -3, change1h: 0 }), "Exit signal");
assert.notEqual(status({ price: 1.08, change5m: -2.999, change1h: 0 }), "Exit signal");
assert.notEqual(status({ price: 1.08, change5m: -3, change1h: 0.001 }), "Exit signal");

assert.equal(
  status({ marketDataAt: new Date(NOW - PAPER_MARKET_FRESH_MS).toISOString() }),
  "Hold",
  "market evidence exactly 90 seconds old remains fresh",
);

const unsafeTokens: Array<[string, Partial<PaperExitToken>]> = [
  ["stale timestamp", { marketDataAt: new Date(NOW - PAPER_MARKET_FRESH_MS - 1).toISOString() }],
  ["future timestamp", { marketDataAt: new Date(NOW + 1).toISOString() }],
  ["invalid timestamp", { marketDataAt: "not-a-date" }],
  ["missing 5-minute movement", { change5m: null }],
  ["missing hourly movement", { change1h: null }],
  ["invalid 5-minute movement", { change5m: Number.NaN }],
  ["invalid hourly movement", { change1h: Number.POSITIVE_INFINITY }],
  ["zero price", { price: 0 }],
  ["negative price", { price: -1 }],
  ["invalid price", { price: "not-a-price" }],
  ["infinite price", { price: Number.POSITIVE_INFINITY }],
];

for (const [name, overrides] of unsafeTokens) {
  assert.equal(
    status({ price: 0.5, change5m: -10, change1h: -10, ...overrides }),
    "Watch closely",
    `${name} must refuse an apparent loss Exit`,
  );
}

const unsafePositions: Array<[string, Partial<PaperPosition>]> = [
  ["zero invested chips", { chipsInvested: 0 }],
  ["negative invested chips", { chipsInvested: -1 }],
  ["invalid invested chips", { chipsInvested: Number.NaN }],
  ["zero token units", { tokenUnits: 0 }],
  ["negative token units", { tokenUnits: -1 }],
  ["invalid token units", { tokenUnits: Number.NaN }],
  ["infinite token units", { tokenUnits: Number.POSITIVE_INFINITY }],
];

for (const [name, overrides] of unsafePositions) {
  assert.equal(
    status({ price: 0.5, change5m: -10, change1h: -10 }, overrides),
    "Watch closely",
    `${name} must refuse an apparent loss Exit`,
  );
}

console.log("paper exit recommendation tests passed");