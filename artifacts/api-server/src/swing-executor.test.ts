import assert from "node:assert/strict";
import {
  automaticLossPolicy,
  automaticSmallWinDecision,
  usesAutomaticSmallWinPlan,
  automaticFastStopMustSell,
  computeExitChaseCeilings,
  effectivePositionMaxHoldHours,
  executeManualRebuyAttempt,
  executableImpactPct,
  executableOutputFloor,
  MANUAL_PAPER_REBUY_PROVIDER_ERROR,
  mergeLiveCandidateMints,
  manualHoldBlocksAutomaticClose,
  neverSellEmergencyExit,
  pendingBuyDecision,
  rankClosedMarketStockPlans,
  judgeExit,
} from "./swing-executor";
import { retryAfterHeaderMs } from "./jupiter";
import { publicSwingStrategy, takeProfitSettingsPatch } from "./swing-routes";
import { createSwingStrategySchema } from "@workspace/db";

// Floors are raw-unit integer math: they preserve configured slippage rather
// than the former effectively-zero `quote - 1` bound.
assert.equal(executableOutputFloor(1_000_000n, 500), 950_000n);
assert.equal(executableOutputFloor(19n, 333), 18n);
assert.equal(executableOutputFloor(1n, 1_000), 1n, "a positive raw floor is required by PumpApi");
assert.equal(executableImpactPct(900n, 100n, 490n, 50n), 8.16);
assert.equal(executableImpactPct(1_000n, 100n, 500n, 50n), 0);
assert.equal(executableImpactPct(0n, 100n, 1n, 1n), Infinity, "missing executable output is never low impact");
assert.deepEqual(
  mergeLiveCandidateMints(["pump-new"], ["portal-new", "pump-new"], ["cached-old"], 3),
  ["pump-new", "portal-new", "cached-old"],
  "fresh PumpAPI launches lead and survive while the market-source cache is warm",
);
assert.equal(pendingBuyDecision("success", false), "keep", "indexed success wins over blockhash age");
assert.equal(pendingBuyDecision("failed", true), "buy_failed");
assert.equal(pendingBuyDecision("missing", false), "buy_expired");
assert.equal(pendingBuyDecision("missing", null), "keep");
assert.equal(pendingBuyDecision("unknown", false), "keep");
assert.equal(automaticSmallWinDecision(2.99, 2.99), null, "a sub-3% move keeps running");
assert.equal(automaticSmallWinDecision(3, 3), "take", "a real executable +3% banks immediately");
assert.equal(automaticSmallWinDecision(3, 3, true), null, "a +3% winner keeps running while short and hourly signals clearly rise");
assert.equal(automaticSmallWinDecision(4, 1.2), null, "a banked-size winner gets a little room before its floor");
assert.equal(automaticSmallWinDecision(4, 0.5), "protect", "a +4% peak cannot round-trip below the small-win floor");
assert.equal(usesAutomaticSmallWinPlan(null, null), true, "Automatic keeps the routine small-win plan");
assert.equal(usesAutomaticSmallWinPlan(7, null), false, "a fixed profit target replaces the routine small-win plan");
assert.equal(usesAutomaticSmallWinPlan(null, 40), false, "Runner mode disables the routine +3% small-win plan");

const fixedTargetCreate = createSwingStrategySchema.parse({
  ownerWallet: "11111111111111111111111111111111",
  mode: "paper",
  budgetSol: 1,
  windowHours: 24,
  takeProfitPct: 25,
});
const fixedTargetStored = {
  ...fixedTargetCreate,
  id: "fixed-target",
  universe: "crypto",
  targetMint: null,
  takeProfitPct: fixedTargetCreate.takeProfitPct ?? null,
};
assert.equal(publicSwingStrategy(fixedTargetStored).takeProfitPct, 25, "create API serialization returns the scanner's fixed target");
assert.equal(publicSwingStrategy({ ...fixedTargetStored }).takeProfitPct, 25, "detail API serialization returns the saved fixed target");
const targetUpdate = takeProfitSettingsPatch(25, 40);
assert.deepEqual(targetUpdate.patch, { takeProfitPct: 40 }, "updating a fixed target produces the persisted settings patch");
assert.equal(
  publicSwingStrategy({ ...fixedTargetStored, ...targetUpdate.patch }).takeProfitPct,
  40,
  "the updated target round-trips through the API serializer",
);
const targetClear = takeProfitSettingsPatch(40, null);
assert.deepEqual(targetClear.patch, { takeProfitPct: null }, "clearing a fixed target persists null");
assert.equal(
  publicSwingStrategy({ ...fixedTargetStored, ...targetUpdate.patch, ...targetClear.patch }).takeProfitPct,
  null,
  "the cleared target round-trips as automatic mode",
);

const exitStrategy = {
  style: "quick",
  universe: "crypto",
  targetMint: null,
  takeProfitPct: 25,
  winnerKeepPct: null,
  conservativeProfit: false,
  neverSellAtLoss: false,
  stopRoomPct: null,
  stopLossPct: 4.5,
  trailArmPct: 12,
  trailPct: 8,
  momentumCycle: false,
} as any;
const exitPosition = {
  id: "profit-target-position",
  symbol: "TARGET",
  solInLamports: "1000000",
  entryLiquidityUsd: 100_000,
  entryVolumeH1Usd: 50_000,
  openedAt: new Date(),
} as any;
const neutralStats = {
  liquidityUsd: 100_000,
  liquidityKnown: true,
  volH1Usd: 50_000,
  volH1Known: true,
  chgM5: 0,
  chgM5Known: true,
  chgH1: 0,
  chgH6: 0,
  chgH24: 0,
  buysM5: 5,
  sellsM5: 5,
  buysH1: 20,
  sellsH1: 20,
} as any;
assert.equal(
  judgeExit(exitStrategy, exitPosition, 1_030_000n, 1_040_000n, neutralStats, null, false).sell,
  false,
  "a fixed target disables automatic small-win take and protect exits below that target",
);
assert.equal(
  judgeExit(exitStrategy, exitPosition, 750_000n, 1_000_000n, neutralStats, null, false).reason,
  "stop_loss",
  "stop-loss can close a fixed-target position before the target",
);
assert.equal(
  judgeExit(
    exitStrategy,
    exitPosition,
    1_060_000n,
    1_060_000n,
    { ...neutralStats, chgM5: -1, buysM5: 3, sellsM5: 8 },
    null,
    false,
  ).reason,
  "sellers_took_over",
  "a confirmed reversal can close a fixed-target position before the target",
);
assert.equal(
  judgeExit({ ...exitStrategy, takeProfitPct: null }, exitPosition, 1_030_000n, 1_030_000n, neutralStats, null, false).reason,
  "small_win_take",
  "automatic mode retains the adaptive executable +3% take",
);
assert.equal(manualHoldBlocksAutomaticClose(true, "stop_loss"), true, "Don't sell yet blocks an automatic loss exit");
assert.equal(manualHoldBlocksAutomaticClose(true, "liquidity_drained"), true, "Don't sell yet blocks an automatic rug/liquidity exit");
assert.equal(manualHoldBlocksAutomaticClose(true, "manual_sell"), false, "the owner's explicit Sell now still works");
assert.equal(manualHoldBlocksAutomaticClose(true, "window_end", true), false, "whole-run liquidation still settles the position");
assert.equal(manualHoldBlocksAutomaticClose(false, "stop_loss"), false, "turning the switch off restores automatic exits");
assert.equal(retryAfterHeaderMs("12", 0), 12_000, "Jupiter retry-after seconds are honored");
assert.equal(retryAfterHeaderMs("120", 0), 30_000, "provider retry windows are bounded");
assert.equal(retryAfterHeaderMs("not-a-date", 0), 0, "malformed retry-after is ignored");

const rebuyStats = { symbol: "REBUY", priceUsd: 0.25 };
let transientCalls = 0;
let paperBankroll = 1_000_000;
let walletConnectionChecks = 0;
const recoveredRebuy = await executeManualRebuyAttempt({
  mint: "rebuy-mint",
  retryDelaysMs: [0, 1],
  sleep: async () => {},
  loadStats: async (_mint, opts) => {
    assert.deepEqual(opts, { forceFresh: true }, "every interactive retry bypasses stale market-data cache");
    transientCalls += 1;
    return transientCalls === 1 ? null : rebuyStats;
  },
  usablePrice: (stats) => stats.priceUsd,
  open: async (stats) => {
    assert.equal(stats, rebuyStats);
    paperBankroll -= 250_000;
    return true;
  },
});
assert.equal(recoveredRebuy.bought, true, "a transient provider miss recovers and continues the paper rebuy");
assert.equal(transientCalls, 2, "the provider is retried after a temporary miss");
assert.equal(paperBankroll, 750_000, "paper bankroll changes only after the executable buy opens");
assert.equal(walletConnectionChecks, 0, "paper rebuy recovery does not require a wallet connection");

paperBankroll = 1_000_000;
let exhaustedCalls = 0;
await assert.rejects(
  executeManualRebuyAttempt({
    mint: "rebuy-mint",
    retryDelaysMs: [0, 1, 2],
    sleep: async () => {},
    loadStats: async () => {
      exhaustedCalls += 1;
      return null;
    },
    usablePrice: (stats: typeof rebuyStats) => stats.priceUsd,
    open: async () => {
      paperBankroll -= 250_000;
      return true;
    },
  }),
  (error: Error) => error.message === MANUAL_PAPER_REBUY_PROVIDER_ERROR,
  "exhausted retries return the clear provider error",
);
assert.equal(exhaustedCalls, 3);
assert.equal(paperBankroll, 1_000_000, "provider failure neither creates a position nor changes paper bankroll");

for (const missingRoute of ["buy", "reverse-sell"] as const) {
  paperBankroll = 1_000_000;
  let positionsCreated = 0;
  const routeRejected = await executeManualRebuyAttempt({
    mint: "rebuy-mint",
    retryDelaysMs: [0],
    loadStats: async () => rebuyStats,
    usablePrice: (stats) => stats.priceUsd,
    open: async () => {
      const buyRoute = missingRoute !== "buy";
      const reverseSellRoute = missingRoute !== "reverse-sell";
      if (!buyRoute || !reverseSellRoute) return false;
      positionsCreated += 1;
      paperBankroll -= 250_000;
      return true;
    },
  });
  assert.equal(routeRejected.bought, false, `a missing ${missingRoute} route still blocks the rebuy`);
  assert.equal(positionsCreated, 0, `a missing ${missingRoute} route creates no position`);
  assert.equal(paperBankroll, 1_000_000, `a missing ${missingRoute} route leaves paper bankroll untouched`);
}

const reentryNow = new Date();
const priorWinningExit = {
  id: "win",
  mint: "mos",
  status: "closed",
  closedAt: reentryNow,
  exitReason: "small_win_take",
  exitPriceUsd: 1.23,
  solInLamports: "100",
  solOutLamports: "103",
} as any;
assert.equal(
  computeExitChaseCeilings([priorWinningExit]).get("mos"),
  1.23,
  "a banked small winner stays in the guarded re-entry watch lane",
);
assert.equal(
  computeExitChaseCeilings([
    priorWinningExit,
    {
      ...priorWinningExit,
      id: "later-loss",
      closedAt: new Date(reentryNow.getTime() + 1),
      exitReason: "stop_loss",
      solOutLamports: "95",
    },
  ]).has("mos"),
  false,
  "a later loss supersedes the winning re-entry lane",
);

const closingSnapshotBase = {
  issuer: "xStocks",
  issuerAssetId: "issuer-id",
  name: "Example Stock",
  tokenSymbol: "EXx",
  underlyingTicker: "EX",
  instrumentType: "stock",
  logoUrl: null,
  tradingStatus: "closed",
  availabilityLabel: "Market closed",
  priceUsd: 100,
  marketCapUsd: null,
  liquidityUsd: 100_000,
  volume24hUsd: 50_000,
  priceChange24hPct: 2,
  marketDataObservedAt: new Date("2026-09-04T20:00:00.000Z"),
  issuerCatalogObservedAt: new Date("2026-09-04T20:00:00.000Z"),
  lastAttemptAt: new Date("2026-09-04T20:00:00.000Z"),
  marketDataSource: "issuer",
  failure: null,
  updatedAt: new Date("2026-09-04T20:00:00.000Z"),
};
const closingPlans = rankClosedMarketStockPlans([
  { ...closingSnapshotBase, mint: "strong", tokenSymbol: "STRx", underlyingTicker: "STR", priceChange24hPct: 4 },
  { ...closingSnapshotBase, mint: "steady", tokenSymbol: "STEx", underlyingTicker: "STE", priceChange24hPct: 2 },
  { ...closingSnapshotBase, mint: "down", tokenSymbol: "DWNx", underlyingTicker: "DWN", priceChange24hPct: -1 },
  { ...closingSnapshotBase, mint: "thin", tokenSymbol: "THNx", underlyingTicker: "THN", liquidityUsd: 5_000 },
  { ...closingSnapshotBase, mint: "stale", tokenSymbol: "OLDx", underlyingTicker: "OLD", marketDataObservedAt: new Date("2026-08-01T20:00:00.000Z") },
], 20_000, new Set(), new Set(), new Set(), new Date("2026-09-05T12:00:00.000Z").getTime());
assert.deepEqual(
  closingPlans.map((asset) => asset.mint),
  ["strong", "steady"],
  "closed-market planning uses only recent, liquid, positive closing snapshots and ranks the strongest first",
);
assert.equal(neverSellEmergencyExit(-12, false, 0, 0, 0, 0, 0, false), "max_loss");
assert.equal(
  neverSellEmergencyExit(-11.9, false, 0, 0, 0, 0, 0, false),
  null,
  "the firm recovery ceiling must not trigger early",
);
assert.equal(
  neverSellEmergencyExit(-9, true, -5, 3, 8, 10, 15, false),
  null,
  "hourly sellers must clearly control the tape unless dollar outflow confirms the decline",
);
assert.equal(neverSellEmergencyExit(-9, true, -5, 3, 8, 10, 21, false), "confirmed_decline");
assert.equal(
  neverSellEmergencyExit(-9, false, -10, 1, 20, 1, 40, true),
  null,
  "unknown candle direction is never an evidence-based sell signal",
);
assert.equal(
  neverSellEmergencyExit(-7.9, true, -10, 1, 20, 1, 40, true),
  null,
  "ordinary drawdowns retain recovery room above the emergency decline arm",
);

const market = {
  liquidityUsd: 100_000,
  liquidityKnown: true,
  volH1Usd: 20_000,
  volH1Known: true,
  chgM5: -1,
  chgM5Known: true,
  buysM5: 5,
  sellsM5: 4,
  buysH1: 18,
  sellsH1: 16,
};
const automaticBase = {
  entryLiquidityUsd: 100_000,
  entryVolumeH1Usd: 40_000,
  peakPct: 0,
  stats: market,
  chartHealthy: false,
  chartAccumulation: false,
  provenClimb: false,
  freshClimb: false,
  dollarOutflowConfirmed: false,
};

assert.equal(automaticLossPolicy(automaticBase).stopPct, 20, "ordinary automatic positions hold through pullbacks");
assert.equal(
  automaticLossPolicy({ ...automaticBase, chartAccumulation: true }).stopPct,
  20,
  "confirmed accumulation keeps recovery-hold room",
);
assert.equal(
  automaticLossPolicy({
    ...automaticBase,
    stats: { ...market, volH1Usd: 50_000, buysH1: 35, sellsH1: 25, buysM5: 8, sellsM5: 6 },
  }).stopPct,
  20,
  "active two-way volatility keeps recovery-hold room",
);
const sellerBreakdown = automaticLossPolicy({
  ...automaticBase,
  chartAccumulation: true,
  stats: {
    ...market,
    chgM5: -9,
    buysM5: 3,
    sellsM5: 20,
    buysH1: 12,
    sellsH1: 45,
  },
});
assert.equal(sellerBreakdown.confirmedBreakdown, true, "short and hourly seller control confirms failure");
assert.equal(sellerBreakdown.accumulating, false, "a confirmed sell wave cannot masquerade as accumulation");
assert.equal(sellerBreakdown.stopPct, 8, "confirmed failure arms the earlier override");
assert.equal(
  automaticLossPolicy({ ...automaticBase, provenClimb: true, stats: { ...market, liquidityUsd: 60_000 } }).stopPct,
  8,
  "a proven climber loses its wide room after confirmed liquidity loss",
);
assert.equal(
  automaticLossPolicy({
    ...automaticBase,
    stats: { ...market, liquidityUsd: 0, liquidityKnown: false },
  }).confirmedBreakdown,
  false,
  "missing liquidity is unknown, never a breakdown",
);

const deadVolumeStats = {
  ...market,
  volH1Usd: 4_000,
  chgM5: -4,
  buysM5: 3,
  sellsM5: 10,
};
const deadVolume = automaticLossPolicy({
  ...automaticBase,
  entryVolumeH1Usd: 100_000,
  stats: deadVolumeStats,
});
assert.equal(deadVolume.confirmedBreakdown, true, "validated severe volume collapse confirms failure");
assert.equal(
  automaticLossPolicy({
    ...automaticBase,
    entryVolumeH1Usd: 100_000,
    provenClimb: true,
    stats: deadVolumeStats,
  }).stopPct,
  8,
  "a proven climber loses its wide room after severe volume collapse",
);
assert.equal(
  automaticLossPolicy({
    ...automaticBase,
    entryVolumeH1Usd: 100_000,
    chartAccumulation: true,
    stats: deadVolumeStats,
  }).accumulating,
  false,
  "severe volume collapse revokes an apparent accumulation signal",
);
assert.equal(automaticFastStopMustSell(-19.9), false, "ordinary automatic pullbacks wait for fresh evidence");
assert.equal(automaticFastStopMustSell(-20), true, "the fast lane enforces the catastrophic emergency ceiling");
assert.equal(
  effectivePositionMaxHoldHours(false, true, 24),
  Infinity,
  "Automatic positions use the bot expiry rather than a legacy position timer",
);
assert.equal(
  effectivePositionMaxHoldHours(false, false, 24),
  24,
  "fixed-stop and non-Automatic positions retain their configured timer",
);

console.log("swing executor helper tests passed");