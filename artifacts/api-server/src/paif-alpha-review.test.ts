import assert from "node:assert/strict";
import { buildLanePick, buildRulesReview, mergeModelReview, type AlphaReviewInput } from "./paif-alpha-review";

const safeInput: AlphaReviewInput = {
  surface: "arcade",
  subjectId: "test",
  subjectLabel: "TEST",
  primaryDecision: "Ring this rising lane",
  primaryVerdict: "positive",
  primaryConfidence: 75,
  evidence: {
    marketDataAt: 1_000_000,
    change5m: 1,
    change1h: 8,
    liquidityUsd: 30_000,
    volume24h: 20_000,
    holders: 150,
  },
};

const safe = buildRulesReview(safeInput, 1_030_000);
assert.equal(safe.verdict, "agree");
assert.equal(safe.safetyGate.level, "clear");

const lowLiquidity = buildRulesReview({
  ...safeInput,
  evidence: { ...safeInput.evidence, liquidityUsd: 2_000 },
}, 1_030_000);
assert.equal(lowLiquidity.safetyGate.level, "stop");

const attemptedUpgrade = mergeModelReview(lowLiquidity, {
  verdict: "agree",
  confidence: 99,
  summary: "The model likes the setup.",
  evidence: ["Momentum is positive."],
  concerns: [],
}, safeInput);
assert.equal(attemptedUpgrade.safetyGate.level, "stop");
assert.notEqual(attemptedUpgrade.verdict, "agree");

const modelDowngrade = mergeModelReview(safe, {
  verdict: "disagree",
  confidence: 70,
  summary: "The model sees unresolved risk.",
  evidence: [],
  concerns: ["The evidence is not broad enough."],
}, safeInput);
assert.equal(modelDowngrade.verdict, "disagree");
assert.equal(modelDowngrade.safetyGate.level, "verify");

const lanePick = buildLanePick({
  selectedMint: "riskier",
  candidates: [
    {
      mint: "safer",
      symbol: "SAFE",
      lane: 1,
      marketDataAt: 1_000_000,
      change5m: 2,
      change1h: 12,
      liquidityUsd: 50_000,
      marketCapUsd: 200_000,
      volume24h: 80_000,
      ageMins: 120,
    },
    {
      mint: "riskier",
      symbol: "RISK",
      lane: 2,
      marketDataAt: 1_000_000,
      change5m: 30,
      change1h: 120,
      liquidityUsd: 4_000,
      marketCapUsd: 2_000_000,
      volume24h: 100_000,
      ageMins: 5,
    },
  ],
}, 1_030_000);
assert.equal(lanePick.pick.mint, "safer");
assert.equal(lanePick.recommendation, "ring");
assert.equal(lanePick.agreesWithUser, false);

console.log("PAIF Alpha safety-gate tests passed");