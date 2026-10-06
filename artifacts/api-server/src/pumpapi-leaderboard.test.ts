import assert from "node:assert/strict";
import {
  cancelReplayResources,
  createMintOrderedWritePool,
  createKnownMintAdmissionCache,
  createReplayOutputLimiter,
  isPumpApiPersistenceDegraded,
  parsePumpApiCreateEvent,
  parsePumpApiTradeEvent,
  parsePumpApiPoolSafety,
  rememberPumpApiPoolSafety,
  getFreshPumpApiPoolSafety,
  hasObservedGraduatedVenue,
  latestPublishableReplayHour,
  pumpApiWriteLaneIndex,
  shouldStartReplayAfterSeed,
  waitForPendingLaunch,
} from "./pumpapi-leaderboard";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const signature = "3mGAAs4CkM86s3bN8Jkt2EZRGf7ZVkbgNk2pV3STrEof8nCdFg5kqWdFyohp23uFVwierCvdeuXBzy3QDwNdaX4L";
const mint = "AvxohnS3SSJRfw4h9u2am5DTRrNv9HY5je7EdqpVSA2i";
const signer = "3dxmSSoSbLpmyZZTJhGP4w9DUPLCrMyyUNpb6eL8e3Rf";
const feeAddress = "YubQzu18FDqJRyNfG8JqHmsdbxhnoQqcKUHBdUkN6tP";
const event = {
  action: "create",
  signature,
  mint,
  txSigner: signer,
  creatorFeeAddress: feeAddress,
  pool: "pump",
  timestamp: Date.now() - 1_000,
};

const parsed = parsePumpApiCreateEvent(event);
assert.ok(parsed);
assert.equal(parsed.creatorWallet, signer, "launch attribution must use txSigner");
assert.equal(parsed.creatorFeeAddress, feeAddress, "fee address must remain separate");
assert.equal(parsed.eventKey, `${signature}:${mint}`);
assert.equal(parsePumpApiCreateEvent({ ...event, action: "buy" }), null);
assert.equal(parsePumpApiCreateEvent({ ...event, txSigner: feeAddress, mint: "not-base58" }), null);
assert.equal(parsePumpApiCreateEvent({ ...event, timestamp: "yesterday" }), null);
assert.equal(parsePumpApiCreateEvent({ ...event, signature: "" }), null);
const trade = {
  action: "buy", signature, mint, poolId: signer, pool: "pump",
  quoteMint: "So11111111111111111111111111111111111111112", txSigner: feeAddress,
  tokenAmount: 12.5, quoteAmount: 0.42, timestamp: Date.now() - 1_000,
  breakdown: [
    { action: "buy", trader: signer, tokenAmount: 10, quoteAmount: 0.5 },
    { action: "sell", trader: feeAddress, tokenAmount: 8, quoteAmount: 0.4 },
  ],
};
const poolSafetyEvent = {
  ...trade, pool: "raydium-cpmm", poolCreatedBy: "raydium-launchpad",
  burnedLiquidity: 0.8, poolFeeRate: 0.0025, poolFeeRateAfterMigration: 0.0025, mayhemMode: false,
};
assert.ok(parsePumpApiPoolSafety(poolSafetyEvent), "trusted complete metadata is admitted");
assert.equal(parsePumpApiPoolSafety({ ...poolSafetyEvent, signature: "forged" }), null, "unsigned/malformed metadata cannot seed cache");
assert.ok(parsePumpApiPoolSafety({ ...poolSafetyEvent, pool: "pump-amm", poolCreatedBy: "pump", poolFeeRate: 0.0125, mayhemMode: false }), "documented Pump AMM fee is admitted");
assert.equal(parsePumpApiPoolSafety({ ...poolSafetyEvent, mayhemMode: true }), null, "mayhem is rejected");
assert.equal(parsePumpApiPoolSafety({ ...poolSafetyEvent, burnedLiquidity: 0 }), null, "unburned liquidity is rejected");
assert.ok(parsePumpApiPoolSafety({
  ...poolSafetyEvent,
  pool: "pump-amm",
  poolCreatedBy: "pump",
  burnedLiquidity: 0,
  poolFeeRate: 0.0125,
  mayhemMode: false,
}), "Pump AMM does not require burned LP proof");
assert.equal(parsePumpApiPoolSafety({ ...poolSafetyEvent, poolCreatedBy: "custom" }), null, "custom origin is rejected");
assert.ok(parsePumpApiPoolSafety({ ...poolSafetyEvent, poolFeeRateAfterMigration: undefined }), "migration fee is not applicable to Raydium");
assert.equal(parsePumpApiPoolSafety({ ...poolSafetyEvent, pool: "meteora-launchpad", poolCreatedBy: "meteora-launchpad", poolFeeRateAfterMigration: undefined }), null, "Meteora launchpad requires future fee");
rememberPumpApiPoolSafety({ ...event, poolId: signer, quoteMint: "So11111111111111111111111111111111111111112" });
rememberPumpApiPoolSafety(poolSafetyEvent);
assert.equal(getFreshPumpApiPoolSafety(mint)?.poolId, signer);
assert.equal(getFreshPumpApiPoolSafety(mint, Date.now() + 91_000), null, "stale metadata fails closed");
const parsedTrade = parsePumpApiTradeEvent(trade);
assert.ok(parsedTrade);
assert.equal(parsedTrade.eventKey, `${signature}:${mint}:${signer}`);
assert.equal(parsedTrade.quoteAmount, 0.9, "mixed breakdown must use gross quote not top-level net");
assert.equal(parsedTrade.tokenAmount, 18);
assert.equal(parsedTrade.volumeMethod, "breakdown_gross");
assert.equal(parsedTrade.breakdownCount, 2);
assert.equal(parsePumpApiTradeEvent({ ...trade, action: "sell" })?.eventKey, `${signature}:${mint}:${signer}`);
assert.equal(parsePumpApiTradeEvent({ ...trade, quoteAmount: -1 }), null);
assert.equal(parsePumpApiTradeEvent({ ...trade, tokenAmount: undefined }), null);
assert.equal(parsePumpApiTradeEvent({ ...trade, breakdown: undefined }), null);
assert.equal(parsePumpApiTradeEvent({ ...trade, breakdown: [{ action: "buy", trader: "bad", tokenAmount: 1, quoteAmount: 1 }] }), null);
assert.equal(parsePumpApiTradeEvent({ ...trade, breakdown: Array.from({ length: 257 }, () => trade.breakdown[0]) }), null);
assert.equal(parsePumpApiTradeEvent({ ...trade, breakdown: [{ ...trade.breakdown[0], quoteAmount: -1 }] }), null);
assert.equal(parsePumpApiTradeEvent({ ...trade, poolId: "bad" }), null);
assert.equal(parsePumpApiTradeEvent({ ...trade, timestamp: "now" }), null);
assert.equal(hasObservedGraduatedVenue([{ dexId: "pumpfun" }]), false, "bonding-curve pair is not graduation");
assert.equal(hasObservedGraduatedVenue([{ dexId: "pumpfun" }, { dexId: "pumpswap" }]), true, "migrated DEX venue proves graduation");
assert.equal(hasObservedGraduatedVenue([{ pairAddress: signer }, null]), false, "missing venue metadata cannot prove graduation");
// The deterministic key is deliberately source-independent: live/replay
// observations of the same PumpApi aggregate conflict on one database row.
assert.equal(parsePumpApiTradeEvent(trade)?.eventKey, parsePumpApiTradeEvent({ ...trade })?.eventKey);
assert.equal(shouldStartReplayAfterSeed(7, 7, false), true, "active seeded session starts replay");
assert.equal(shouldStartReplayAfterSeed(7, 8, false), false, "stale seed cannot start replay after restart");
assert.equal(shouldStartReplayAfterSeed(7, 7, true), false, "shutdown cancels seeded replay start");

assert.equal(pumpApiWriteLaneIndex(mint), pumpApiWriteLaneIndex(mint), "lane selection is deterministic");
assert.ok(pumpApiWriteLaneIndex(mint) >= 0 && pumpApiWriteLaneIndex(mint) < 8);
const hotMintLanes = new Set(Array.from({ length: 64 }, (_, index) =>
  pumpApiWriteLaneIndex(`${signature}:${mint}:${signer}:${index}`)));
assert.ok(hotMintLanes.size > 1, "distinct events for one hot mint distribute across lanes");
const orderedPool = createMintOrderedWritePool(8);
const order: string[] = [];
let releaseFirst!: () => void;
const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
const firstWrite = orderedPool.enqueue(mint, async () => { order.push("first:start"); await firstGate; order.push("first:end"); });
const secondWrite = orderedPool.enqueue(mint, async () => { order.push("second"); });
await Promise.resolve();
assert.deepEqual(order, ["first:start"], "same-mint writes cannot overtake");
releaseFirst();
await Promise.all([firstWrite, secondWrite]);
assert.deepEqual(order, ["first:start", "first:end", "second"]);
await assert.rejects(orderedPool.enqueue(mint, async () => { throw new Error("expected lane failure"); }));
await orderedPool.enqueue(mint, async () => { order.push("after-rejection"); });
assert.equal(order.at(-1), "after-rejection", "a rejected lane write cannot poison its tail");
await orderedPool.drain();

let readinessRelease!: () => void;
let readinessPassed = false;
const readiness = new Promise<void>((resolve) => { readinessRelease = resolve; });
const readinessWait = waitForPendingLaunch(mint, new Map([[mint, readiness]])).then(() => { readinessPassed = true; });
await Promise.resolve();
assert.equal(readinessPassed, false, "trade admission waits for pending create persistence");
readinessRelease();
await readinessWait;
assert.equal(readinessPassed, true);

let trueLookups = 0;
const positiveCache = createKnownMintAdmissionCache(async () => { trueLookups++; return true; }, { positiveCap: 2 });
assert.equal(await positiveCache.resolve("known"), true);
assert.equal(await positiveCache.resolve("known"), true);
assert.equal(trueLookups, 1, "positive cache avoids repeated DB lookups");
positiveCache.remember("second");
positiveCache.remember("third");
assert.equal(positiveCache.sizes().positive, 2, "positive cache remains bounded");

let falseLookups = 0;
const negativeCache = createKnownMintAdmissionCache(async () => { falseLookups++; return false; }, { negativeCap: 2, negativeTtlMs: 60_000 });
assert.equal(await negativeCache.resolve("unknown"), false);
assert.equal(await negativeCache.resolve("unknown"), false);
assert.equal(falseLookups, 1, "TTL negative cache avoids repeated DB lookups");

let lookupRelease!: (known: boolean) => void;
let dedupedLookups = 0;
const lookupGate = new Promise<boolean>((resolve) => { lookupRelease = resolve; });
const dedupedCache = createKnownMintAdmissionCache(async () => { dedupedLookups++; return lookupGate; }, { inFlightCap: 2 });
const lookupA = dedupedCache.resolve("same");
const lookupB = dedupedCache.resolve("same");
assert.equal(dedupedCache.sizes().inFlight, 1);
lookupRelease(true);
assert.deepEqual(await Promise.all([lookupA, lookupB]), [true, true]);
assert.equal(dedupedLookups, 1, "concurrent cache misses dedupe by mint");
assert.equal(dedupedCache.sizes().inFlight, 0, "in-flight lookup cleans up after settlement");

const errorCache = createKnownMintAdmissionCache(async () => { throw new Error("lookup failed"); });
await assert.rejects(errorCache.resolve("error"));
assert.equal(errorCache.sizes().inFlight, 0, "failed lookup also cleans up");

assert.equal(
  latestPublishableReplayHour(new Date("2026-01-01T17:00:00.000Z"), 10 * 60_000).toISOString(),
  "2026-01-01T15:00:00.000Z",
);
assert.equal(
  latestPublishableReplayHour(new Date("2026-01-01T17:15:00.000Z"), 10 * 60_000).toISOString(),
  "2026-01-01T16:00:00.000Z",
);

async function limiterFails(chunks: string[], maxBytes: number, maxLineBytes: number, expected: string) {
  let reason = "";
  await assert.rejects(
    pipeline(Readable.from(chunks), createReplayOutputLimiter(maxBytes, maxLineBytes, (value) => { reason = value; })),
  );
  assert.equal(reason, expected);
}
await limiterFails(["12345", "67890"], 8, 100, "decompressed byte cap reached");
await limiterFails(["x".repeat(32)], 100, 16, "JSONL line length cap reached");
await limiterFails(["short\n", "still-too-long-line\n"], 100, 16, "JSONL line length cap reached");

const past = new Date(Date.now() - 1000);
const now = new Date();
assert.equal(isPumpApiPersistenceDegraded(null, now), true);
assert.equal(isPumpApiPersistenceDegraded(now, past), false);
assert.equal(isPumpApiPersistenceDegraded(past, now), true);

const controller = new AbortController();
let destroyed = false;
let killed = false;
let settled = false;
await cancelReplayResources({
  controller,
  child: { killed: false, kill: () => { killed = true; } },
  streams: [{ destroy: () => { destroyed = true; } }],
  settlements: [Promise.resolve().then(() => { settled = true; })],
});
assert.equal(controller.signal.aborted, true);
assert.equal(destroyed, true);
assert.equal(killed, true);
assert.equal(settled, true);

console.log("pumpapi leaderboard parser tests passed");