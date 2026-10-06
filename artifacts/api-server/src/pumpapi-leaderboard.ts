import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import WebSocket from "ws";
import { isKnownPumpApiMint, listKnownPumpApiMints, listRecentObservedMints, savePumpApiLaunch, savePumpApiObservedTrade, upsertPumpApiMarketSnapshot } from "./pumpapi-leaderboard-storage";

const STREAM_URL = "wss://stream.pumpapi.io/";
const REPLAY_ROOT = "https://replay.pumpapi.io";
const ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,128}$/;
const RECONNECT_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
const MAX_FRAME_BYTES = 1_000_000;

export interface ParsedPumpApiLaunch {
  eventKey: string;
  signature: string;
  mint: string;
  creatorWallet: string;
  creatorFeeAddress: string | null;
  poolId: string | null;
  pool: string;
  name: string;
  symbol: string;
  uri: string | null;
  initialBuy: number | null;
  quoteMint: string | null;
  quoteAmount: number | null;
  marketCapQuote: number | null;
  block: number | null;
  launchedAt: Date;
}
export interface ParsedPumpApiTrade {
  eventKey: string; signature: string; mint: string; action: "buy" | "sell";
  poolId: string; pool: string; quoteMint: string; quoteAmount: number; tokenAmount: number; tradedAt: Date;
  volumeMethod: "breakdown_gross"; breakdownCount: number;
}

/** The stream is the single source for the Swing admission cache.  It is
 * deliberately in-memory and short-lived: absence or staleness is unsafe. */
export interface PumpApiPoolSafety {
  mint: string; poolId: string; quoteMint: string; pool: string; poolCreatedBy: string;
  creatorWallet: string; burnedLiquidity: number; poolFeeRate: number;
  poolFeeRateAfterMigration: number | null; mayhemMode: boolean | null; observedAt: number;
}
const SWING_POOL_SAFETY_TTL_MS = 90_000;
const swingPoolSafety = new Map<string, PumpApiPoolSafety>();
const launchCreatorByMint = new Map<string, string>();
const RECENT_LAUNCH_CAP = 200;
const RECENT_LAUNCH_TTL_MS = 10 * 60_000;
const recentLaunches: ParsedPumpApiLaunch[] = [];

function rememberRecentPumpApiLaunch(launch: ParsedPumpApiLaunch) {
  const prior = recentLaunches.findIndex((item) => item.eventKey === launch.eventKey);
  if (prior >= 0) recentLaunches.splice(prior, 1);
  recentLaunches.unshift(launch);
  if (recentLaunches.length > RECENT_LAUNCH_CAP) recentLaunches.length = RECENT_LAUNCH_CAP;
}

/** Primary, in-memory discovery lane for Swing Bot. Historical replay events
 * never enter this ring; only launches received from the live WebSocket do. */
export function getRecentPumpApiLaunches(limit = 100, now = Date.now()): ParsedPumpApiLaunch[] {
  const safeLimit = Math.max(1, Math.min(RECENT_LAUNCH_CAP, Math.floor(limit)));
  return recentLaunches
    .filter((launch) => now - launch.launchedAt.getTime() <= RECENT_LAUNCH_TTL_MS)
    .slice(0, safeLimit);
}

function finiteFraction(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return null;
  return value;
}
function burnedFraction(value: unknown): number | null {
  const numberValue = finiteFraction(value);
  if (numberValue != null) return numberValue;
  if (typeof value !== "string" || !/^(?:0|[1-9]\d?(?:\.\d+)?)%$/.test(value)) return null;
  const percent = Number(value.slice(0, -1));
  return Number.isFinite(percent) && percent <= 100 ? percent / 100 : null;
}
/** Conservative interpretation of contradictory provider guidance: false is
 * required for mayhem and all safety fields must be explicit. */
export function parsePumpApiPoolSafety(value: unknown): PumpApiPoolSafety | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const e = value as Record<string, unknown>;
  // Metadata is security input, not a generic websocket object. It must be
  // bound to an event that already passed timestamp/address/signature parsing.
  const create = parsePumpApiCreateEvent(value);
  const trade = create ? null : parsePumpApiTradeEvent(value);
  if (!create && !trade) return null;
  const mint = boundedString(e.mint, 44), poolId = boundedString(e.poolId, 44);
  const quoteMint = boundedString(e.quoteMint, 44), pool = boundedString(e.pool, 64);
  const created = boundedString(e.poolCreatedBy, 64), creator = boundedString(e.txSigner, 44);
  const burn = burnedFraction(e.burnedLiquidity), fee = finiteFraction(e.poolFeeRate);
  const normalizedPool = pool?.toLowerCase();
  const requiresMigrationFee = normalizedPool === "meteora-launchpad";
  const requiresMayhem = normalizedPool === "pump" || normalizedPool === "pump-amm";
  const migrationFee = e.poolFeeRateAfterMigration == null ? null : finiteFraction(e.poolFeeRateAfterMigration);
  const lockedAfterMigration = e.lockedLiquidityAfterMigration == null ? null : burnedFraction(e.lockedLiquidityAfterMigration);
  const mayhem = e.mayhemMode == null ? null : e.mayhemMode;
  if (!mint || !poolId || !quoteMint || !pool || !created || !creator ||
      !ADDRESS_RE.test(mint) || !ADDRESS_RE.test(poolId) || !ADDRESS_RE.test(quoteMint) ||
      !ADDRESS_RE.test(creator) || burn == null || fee == null ||
      (requiresMigrationFee && migrationFee == null) ||
      (requiresMigrationFee && lockedAfterMigration !== 1) ||
      (e.poolFeeRateAfterMigration != null && migrationFee == null) ||
      (requiresMayhem && typeof mayhem !== "boolean") ||
      (mayhem != null && typeof mayhem !== "boolean") || mayhem === true) return null;
  const normalizedCreator = created.toLowerCase();
  const trusted = (normalizedPool === "pump" || normalizedPool === "pump-amm") && normalizedCreator === "pump"
    || ((normalizedPool === "raydium-launchpad" || normalizedPool === "raydium-cpmm") && normalizedCreator === "raydium-launchpad")
    || ((normalizedPool === "meteora-launchpad" || normalizedPool === "meteora-damm-v1" || normalizedPool === "meteora-damm-v2") && normalizedCreator === "meteora-launchpad");
  // SOL only.  Pump.fun's bonding-curve/Pump AMM model does not use burned LP
  // as the same safety proof as a user-created Raydium/Meteora pool, so its
  // explicit burnedLiquidity value may be 0.  Other pool families still need
  // at least 50% burned liquidity; "burned" is not the same field as "locked".
  // Pump AMM's documented normal migration fee is 1.25%; its fee is not a
  // creator-configurable Meteora rate.  Keep non-Meteora below 2%, while
  // retaining the documented sub-0.1% Meteora limit.
  const protocolManagedPumpPool = normalizedPool === "pump" || normalizedPool === "pump-amm";
  const minimumBurn = protocolManagedPumpPool ? 0 : 0.5;
  if (!trusted || quoteMint !== "So11111111111111111111111111111111111111112" || burn < minimumBurn ||
      fee > 0.02 || (migrationFee != null && migrationFee > 0.01) ||
      (normalizedPool.startsWith("meteora-") && (burn !== 1 || fee >= 0.001 ||
        (requiresMigrationFee && migrationFee! >= 0.001)))) return null;
  return { mint, poolId, quoteMint, pool, poolCreatedBy: created, creatorWallet: creator,
    burnedLiquidity: burn, poolFeeRate: fee, poolFeeRateAfterMigration: migrationFee,
    mayhemMode: mayhem as boolean | null, observedAt: Date.now() };
}
export function rememberPumpApiPoolSafety(value: unknown): void {
  const launch = parsePumpApiCreateEvent(value);
  if (launch) {
    launchCreatorByMint.set(launch.mint, launch.creatorWallet);
    if (launchCreatorByMint.size > 10_000) launchCreatorByMint.delete(launchCreatorByMint.keys().next().value!);
  }
  const safety = parsePumpApiPoolSafety(value);
  if (!safety) return;
  // Buy/sell txSigner is normally the trader.  Only a create event can attest
  // to creator identity; never mistake a trade signer for the pool creator.
  const event = value as Record<string, unknown>;
  if (event.action !== "create") {
    const creator = launchCreatorByMint.get(safety.mint);
    if (!creator) return;
    safety.creatorWallet = creator;
  }
  swingPoolSafety.set(safety.mint, safety);
  if (swingPoolSafety.size > 10_000) swingPoolSafety.delete(swingPoolSafety.keys().next().value!);
}
export function getFreshPumpApiPoolSafety(mint: string, now = Date.now()): PumpApiPoolSafety | null {
  const safety = swingPoolSafety.get(mint);
  return safety && now - safety.observedAt <= SWING_POOL_SAFETY_TTL_MS ? safety : null;
}

function boundedString(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length <= max ? value : null;
}

function optionalFinite(value: unknown): number | null {
  return value == null ? null : typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function hasObservedGraduatedVenue(pairs: unknown[]): boolean {
  return pairs.some((pair) => {
    if (!pair || typeof pair !== "object" || Array.isArray(pair)) return false;
    const dexId = (pair as Record<string, unknown>).dexId;
    return typeof dexId === "string" && dexId.trim() !== "" && dexId.toLowerCase() !== "pumpfun";
  });
}

export function isPumpApiPersistenceDegraded(
  lastSuccess: Date | null,
  lastError: Date | null,
): boolean {
  return !!lastError && (!lastSuccess || lastError >= lastSuccess);
}

/** Strictly accepts PumpApi create events and attributes them to txSigner. */
export function parsePumpApiCreateEvent(value: unknown): ParsedPumpApiLaunch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (event.action !== "create") return null;
  const signature = boundedString(event.signature, 128);
  const mint = boundedString(event.mint, 44);
  const txSigner = boundedString(event.txSigner, 44);
  if (!signature || !SIGNATURE_RE.test(signature) || !mint || !ADDRESS_RE.test(mint) ||
      !txSigner || !ADDRESS_RE.test(txSigner)) return null;
  const timestamp = event.timestamp;
  if (typeof timestamp !== "number" || !Number.isInteger(timestamp) ||
      timestamp < 1_577_836_800_000 || timestamp > Date.now() + 5 * 60_000) return null;
  const creatorFeeAddress = event.creatorFeeAddress == null ? null : boundedString(event.creatorFeeAddress, 44);
  if ((event.creatorFeeAddress != null && creatorFeeAddress === null) ||
      (creatorFeeAddress !== null && !ADDRESS_RE.test(creatorFeeAddress))) return null;
  const pool = boundedString(event.pool, 64);
  if (!pool || !pool.trim()) return null;
  if ((event.poolId != null && boundedString(event.poolId, 128) === null) ||
      (event.name != null && boundedString(event.name, 256) === null) ||
      (event.symbol != null && boundedString(event.symbol, 64) === null) ||
      (event.uri != null && boundedString(event.uri, 2048) === null)) return null;
  const block = event.block == null ? null : event.block;
  if (block !== null && (typeof block !== "number" || !Number.isSafeInteger(block) || block < 0)) return null;
  const initialBuy = optionalFinite(event.initialBuy);
  const quoteAmount = optionalFinite(event.quoteAmount);
  const marketCapQuote = optionalFinite(event.marketCapQuote);
  if ((event.initialBuy != null && initialBuy === null) || (event.quoteAmount != null && quoteAmount === null) ||
      (event.marketCapQuote != null && marketCapQuote === null)) return null;
  const quoteMint = event.quoteMint == null ? null : boundedString(event.quoteMint, 44);
  if (event.quoteMint != null && (!quoteMint || !ADDRESS_RE.test(quoteMint))) return null;
  return {
    eventKey: `${signature}:${mint}`,
    signature,
    mint,
    creatorWallet: txSigner,
    creatorFeeAddress,
    poolId: event.poolId == null ? null : boundedString(event.poolId, 128),
    pool,
    name: boundedString(event.name, 256) ?? "",
    symbol: boundedString(event.symbol, 64) ?? "",
    uri: event.uri == null ? null : boundedString(event.uri, 2048),
    initialBuy,
    quoteMint,
    quoteAmount,
    marketCapQuote,
    block: block as number | null,
    launchedAt: new Date(timestamp),
  };
}

/** Strict trade parser. PumpApi can net the top-level direction and amount, so
 * gross volume comes only from the documented per-trader breakdown. */
export function parsePumpApiTradeEvent(value: unknown): ParsedPumpApiTrade | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (event.action !== "buy" && event.action !== "sell") return null;
  const signature = boundedString(event.signature, 128);
  const mint = boundedString(event.mint, 44);
  const poolId = boundedString(event.poolId, 44);
  const quoteMint = boundedString(event.quoteMint, 44);
  const pool = boundedString(event.pool, 64);
  const txSigner = boundedString(event.txSigner, 44);
  if (!signature || !SIGNATURE_RE.test(signature) || !mint || !ADDRESS_RE.test(mint) ||
      !poolId || !ADDRESS_RE.test(poolId) || !quoteMint || !ADDRESS_RE.test(quoteMint) ||
      !txSigner || !ADDRESS_RE.test(txSigner) || !pool?.trim()) return null;
  const timestamp = event.timestamp;
  if (typeof timestamp !== "number" || !Number.isInteger(timestamp) ||
      timestamp < 1_577_836_800_000 || timestamp > Date.now() + 5 * 60_000) return null;
  if (optionalFinite(event.quoteAmount) === null || optionalFinite(event.tokenAmount) === null) return null;
  // PumpApi top-level amounts can be netted when a transaction contains both
  // directions. Only the documented per-trade breakdown can produce gross
  // buy+sell notional.
  if (!Array.isArray(event.breakdown) || event.breakdown.length < 1 || event.breakdown.length > 256) return null;
  let quoteAmount = 0;
  let tokenAmount = 0;
  for (const item of event.breakdown) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const part = item as Record<string, unknown>;
    const trader = boundedString(part.trader, 44);
    const partQuote = optionalFinite(part.quoteAmount);
    const partToken = optionalFinite(part.tokenAmount);
    if ((part.action !== "buy" && part.action !== "sell") || !trader || !ADDRESS_RE.test(trader) ||
        partQuote === null || partToken === null) return null;
    quoteAmount += partQuote;
    tokenAmount += partToken;
    if (!Number.isFinite(quoteAmount) || !Number.isFinite(tokenAmount)) return null;
  }
  return { eventKey: `${signature}:${mint}:${poolId}`, signature, mint, action: event.action,
    poolId, pool, quoteMint, quoteAmount, tokenAmount, tradedAt: new Date(timestamp),
    volumeMethod: "breakdown_gross", breakdownCount: event.breakdown.length };
}

export interface PumpApiLeaderboardStatus {
  running: boolean;
  connected: boolean;
  lastConnectedAt: string | null;
  lastEventAt: string | null;
  lastLaunchAt: string | null;
  lastPersistedLaunchAt: string | null;
  lastPersistedTradeAt: string | null;
  lastPersistError: string | null;
  lastTradePersistError: string | null;
  reconnectAttempt: number;
  accepted: number;
  duplicates: number;
  malformed: number;
  persistErrors: number;
  tradeAccepted: number;
  tradeDuplicates: number;
  tradePersistErrors: number;
  admissionLookupErrors: number;
  admissionDroppedTrades: number;
  admissionQueueDepth: number;
  queueDepth: number;
  droppedWrites: number;
  lastDroppedAt: string | null;
  persistenceDegraded: boolean;
  message: string | null;
  fresh: boolean;
  replay: {
    state: "disabled" | "running" | "complete" | "partial" | "error";
    requestedHours: number;
    completedHours: string[];
    currentHour: string | null;
    compressedBytes: number;
    decompressedBytes: number;
    maxDecompressedBytes: number | null;
    maxLineBytes: number | null;
    eventsRead: number;
    launchesAccepted: number;
    malformed: number;
    startedAt: string | null;
    finishedAt: string | null;
    maxCompressedBytes: number | null;
    maxEvents: number | null;
    maxMs: number | null;
    error: string | null;
  };
}

let socket: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let inactivityTimer: NodeJS.Timeout | null = null;
let stopped = true;
let reconnectAttempt = 0;
let generation = 0;
let lastConnectedAt: Date | null = null;
let lastEventAt: Date | null = null;
let lastLaunchAt: Date | null = null;
let lastPersistedLaunchAt: Date | null = null;
let lastPersistedTradeAt: Date | null = null;
let lastPersistError: Date | null = null;
let lastTradePersistError: Date | null = null;
let accepted = 0;
let duplicates = 0;
let malformed = 0;
let persistErrors = 0;
let tradeAccepted = 0;
let tradeDuplicates = 0;
let tradePersistErrors = 0;
let admissionLookupErrors = 0;
let admissionDroppedTrades = 0;
let admissionSeedError: Date | null = null;
let pendingAdmissions = 0;
const MAX_PENDING_ADMISSIONS = Math.max(1_000, Math.min(50_000,
  Number(process.env.PUMPAPI_MAX_PENDING_ADMISSIONS) || 10_000));
const MAX_KNOWN_OBSERVED_MINTS = 10_000;
let pendingWrites = 0;
let droppedWrites = 0;
let lastDroppedAt: Date | null = null;
const MAX_PENDING_WRITES = Math.max(1_000, Math.min(50_000,
  Number(process.env.PUMPAPI_MAX_PENDING_WRITES) || 10_000));
const WRITE_LANES = 8;

export function pumpApiWriteLaneIndex(mint: string, laneCount = WRITE_LANES): number {
  // FNV-1a is stable across processes and cheap for bounded Solana addresses.
  let hash = 0x811c9dc5;
  for (let index = 0; index < mint.length; index++) {
    hash ^= mint.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % laneCount;
}

export function createMintOrderedWritePool(laneCount = WRITE_LANES) {
  const tails = Array.from({ length: laneCount }, () => Promise.resolve());
  return {
    enqueue<T>(mint: string, work: () => Promise<T>): Promise<T> {
      const lane = pumpApiWriteLaneIndex(mint, laneCount);
      const run = tails[lane].then(work);
      // The private tail always fulfills, so one rejected write can never
      // poison subsequent work assigned to this mint's lane.
      tails[lane] = run.then(() => undefined, () => undefined);
      return run;
    },
    async drain(): Promise<void> {
      await Promise.all(tails);
    },
  };
}
const writePool = createMintOrderedWritePool();
export function createKnownMintAdmissionCache(
  lookup: (mint: string) => Promise<boolean>,
  options: { positiveCap?: number; negativeCap?: number; negativeTtlMs?: number; inFlightCap?: number } = {},
) {
  const positiveCap = options.positiveCap ?? 10_000;
  const negativeCap = options.negativeCap ?? 10_000;
  const negativeTtlMs = options.negativeTtlMs ?? 30_000;
  const inFlightCap = options.inFlightCap ?? 512;
  const positives = new Set<string>();
  const negatives = new Map<string, number>();
  const inFlight = new Map<string, Promise<boolean>>();
  const trim = <T>(map: Map<string, T> | Set<string>, cap: number) => {
    while (map.size > cap) map.delete(map.keys().next().value!);
  };
  const remember = (mint: string) => {
    negatives.delete(mint);
    positives.delete(mint);
    positives.add(mint);
    trim(positives, positiveCap);
  };
  return {
    remember,
    async resolve(mint: string): Promise<boolean> {
      if (positives.has(mint)) return true;
      const negativeUntil = negatives.get(mint);
      if (negativeUntil && negativeUntil > Date.now()) return false;
      if (negativeUntil) negatives.delete(mint);
      const existing = inFlight.get(mint);
      if (existing) return existing;
      if (inFlight.size >= inFlightCap) throw new Error("mint admission lookup capacity reached");
      const pending = lookup(mint).then((known) => {
        if (known) remember(mint);
        else {
          negatives.set(mint, Date.now() + negativeTtlMs);
          trim(negatives, negativeCap);
        }
        return known;
      }).finally(() => { inFlight.delete(mint); });
      inFlight.set(mint, pending);
      return pending;
    },
    sizes: () => ({ positive: positives.size, negative: negatives.size, inFlight: inFlight.size }),
  };
}
const mintAdmission = createKnownMintAdmissionCache(isKnownPumpApiMint, {
  positiveCap: MAX_KNOWN_OBSERVED_MINTS,
});
function rememberKnownMint(mint: string) { mintAdmission.remember(mint); }
const pendingLaunches = new Map<string, Promise<void>>();
const replay = {
  state: "disabled" as PumpApiLeaderboardStatus["replay"]["state"],
  requestedHours: 0,
  completedHours: [] as string[],
  currentHour: null as string | null,
  compressedBytes: 0,
  decompressedBytes: 0,
  maxDecompressedBytes: null as number | null,
  maxLineBytes: null as number | null,
  eventsRead: 0,
  launchesAccepted: 0,
  malformed: 0,
  startedAt: null as string | null,
  finishedAt: null as string | null,
  maxCompressedBytes: null as number | null,
  maxEvents: null as number | null,
  maxMs: null as number | null,
  error: null as string | null,
};

function enqueueWrite(mint: string, work: () => Promise<void>, label: string): Promise<void> {
  if (pendingWrites >= MAX_PENDING_WRITES) {
    droppedWrites++;
    lastDroppedAt = new Date();
    return Promise.resolve();
  }
  pendingWrites++;
  const task = writePool.enqueue(mint, work)
    .catch((error) => console.error(`[pumpapi-leaderboard] ${label} persist failed:`, error instanceof Error ? error.message : error))
    .finally(() => { pendingWrites--; });
  return task;
}

function persist(launch: ParsedPumpApiLaunch, source: "live" | "replay", ownerGeneration = generation) {
  return enqueueWrite(launch.mint, async () => {
    // A queued write from an old socket/replay must not survive shutdown or a
    // restart. This also prevents a cancelled replay from writing late lines.
    if (stopped || ownerGeneration !== generation) return;
    try {
      const row = await savePumpApiLaunch({ ...launch, source });
      if (stopped || ownerGeneration !== generation) return;
      lastPersistedLaunchAt = launch.launchedAt;
      // Both an insert and an idempotent duplicate prove authoritative DB
      // knowledge of this mint.
      rememberKnownMint(launch.mint);
      if (row) {
        accepted++;
        // The set is solely an admission fast-path.  Bounded eviction never
        // changes DB correctness because storage retains its defensive guard.
        if (source === "replay") replay.launchesAccepted++;
      } else {
        duplicates++;
      }
    } catch (error) {
      persistErrors++;
      lastPersistError = new Date();
      throw error;
    }
  }, "launch");
}
function persistTrade(trade: ParsedPumpApiTrade, source: "live" | "replay", ownerGeneration = generation) {
  // Once launch readiness is resolved, event-key striping lets one hot mint
  // consume all lanes; the atomic unique insert protects rollups.
  return enqueueWrite(trade.eventKey, async () => {
    if (stopped || ownerGeneration !== generation) return;
    try {
      const row = await savePumpApiObservedTrade({ ...trade, source });
      if (stopped || ownerGeneration !== generation) return;
      if (row) {
        tradeAccepted++;
        if (!lastPersistedTradeAt || trade.tradedAt > lastPersistedTradeAt) lastPersistedTradeAt = trade.tradedAt;
      }
      else tradeDuplicates++;
    } catch (error) {
      tradePersistErrors++; persistErrors++; lastTradePersistError = new Date(); throw error;
    }
  }, "trade");
}

export async function waitForPendingLaunch(
  mint: string,
  launches: ReadonlyMap<string, Promise<void>>,
): Promise<void> {
  await launches.get(mint);
}

function trackPendingLaunch(mint: string, promise: Promise<void>) {
  pendingLaunches.set(mint, promise);
  void promise.finally(() => {
    if (pendingLaunches.get(mint) === promise) pendingLaunches.delete(mint);
  });
}

async function admitAndPersistTrade(
  trade: ParsedPumpApiTrade,
  source: "live" | "replay",
  ownerGeneration: number,
) {
  try {
    await waitForPendingLaunch(trade.mint, pendingLaunches);
    const known = await mintAdmission.resolve(trade.mint);
    if (!known || stopped || ownerGeneration !== generation) return;
    await persistTrade(trade, source, ownerGeneration);
  } catch (error) {
    if (stopped || ownerGeneration !== generation) return;
    admissionLookupErrors++;
    admissionDroppedTrades++;
    console.error("[pumpapi-leaderboard] mint admission failed:", error instanceof Error ? error.message : error);
  }
}
function scheduleLiveTradeAdmission(trade: ParsedPumpApiTrade, ownerGeneration: number) {
  if (pendingAdmissions >= MAX_PENDING_ADMISSIONS) {
    admissionDroppedTrades++;
    return;
  }
  pendingAdmissions++;
  void admitAndPersistTrade(trade, "live", ownerGeneration).finally(() => { pendingAdmissions--; });
}

async function seedKnownObservedMints(ownerGeneration: number) {
  try {
    const mints = await listKnownPumpApiMints(MAX_KNOWN_OBSERVED_MINTS);
    if (stopped || ownerGeneration !== generation) return;
    for (const mint of mints) rememberKnownMint(mint);
  } catch (error) {
    // Do not admit global trade flow if the authoritative seed failed.
    admissionSeedError = new Date();
    admissionLookupErrors++;
    console.error("[pumpapi-leaderboard] known mint seed failed:", error instanceof Error ? error.message : error);
  }
}

function scheduleReconnect() {
  if (stopped || reconnectTimer) return;
  const delay = RECONNECT_MS[Math.min(reconnectAttempt++, RECONNECT_MS.length - 1)];
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
  reconnectTimer.unref();
}

function connect() {
  if (stopped || socket) return;
  // generation identifies a start/stop session, not a socket attempt. A
  // reconnect must not cancel that session's seed or replay.
  const mine = generation;
  const candidate = new WebSocket(STREAM_URL, { maxPayload: MAX_FRAME_BYTES });
  socket = candidate;
  candidate.on("open", () => {
    if (mine !== generation) return;
    reconnectAttempt = 0;
    lastConnectedAt = new Date();
    if (inactivityTimer) clearInterval(inactivityTimer);
    inactivityTimer = setInterval(() => {
      if (lastEventAt && Date.now() - lastEventAt.getTime() > 90_000) candidate.terminate();
    }, 30_000);
    inactivityTimer.unref();
  });
  candidate.on("message", (raw) => {
    const rawSize = Array.isArray(raw) ? raw.reduce((sum, part) => sum + part.byteLength, 0) : raw.byteLength;
    if (mine !== generation || rawSize > MAX_FRAME_BYTES) { malformed++; return; }
    lastEventAt = new Date();
    let value: unknown;
    try { value = JSON.parse(Array.isArray(raw) ? Buffer.concat(raw).toString() : raw.toString()); } catch { malformed++; return; }
    rememberPumpApiPoolSafety(value);
    const launch = parsePumpApiCreateEvent(value);
    if (launch) {
      lastLaunchAt = launch.launchedAt;
      rememberRecentPumpApiLaunch(launch);
      const launchWrite = persist(launch, "live", mine);
      trackPendingLaunch(launch.mint, launchWrite);
      return;
    }
    const trade = parsePumpApiTradeEvent(value);
    if (trade) { scheduleLiveTradeAdmission(trade, mine); return; }
    if ((value as any)?.action === "create" || (value as any)?.action === "buy" || (value as any)?.action === "sell") malformed++;
  });
  candidate.on("error", () => candidate.terminate());
  candidate.on("close", () => {
    if (mine !== generation) return;
    if (inactivityTimer) { clearInterval(inactivityTimer); inactivityTimer = null; }
    socket = null;
    scheduleReconnect();
  });
}

function hourKey(date: Date) {
  return date.toISOString().slice(0, 13).replace(/-/g, "/").replace("T", "/");
}

/** Latest archive hour expected to be fully published. Archives describe a
 * completed hour and PumpApi publication trails the wall clock. */
export function latestPublishableReplayHour(now: Date, publicationLagMs: number): Date {
  const lag = Math.max(60_000, Math.min(60 * 60_000, publicationLagMs));
  const shifted = new Date(now.getTime() - lag);
  shifted.setUTCMinutes(0, 0, 0);
  return new Date(shifted.getTime() - 60 * 60_000);
}

function settleBefore(promise: Promise<void>, deadlineAt: number): Promise<boolean> {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), remaining);
    timer.unref();
    promise.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

interface ReplayCaps {
  maxCompressedBytes: number;
  maxDecompressedBytes: number;
  maxLineBytes: number;
  maxEvents: number;
  maxMs: number;
  deadlineAt: number;
}

/** Limits decompressed output before readline can retain an unterminated line. */
export function createReplayOutputLimiter(
  maxBytes: number,
  maxLineBytes: number,
  onCap: (reason: string) => void,
  onBytes?: (bytes: number) => void,
): Transform {
  let outputBytes = 0;
  let lineBytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      outputBytes += chunk.length;
      onBytes?.(chunk.length);
      if (outputBytes > maxBytes) {
        onCap("decompressed byte cap reached");
        callback(new Error("decompressed byte cap reached"));
        return;
      }
      for (let index = 0; index < chunk.length; index++) {
        const byte = chunk[index];
        lineBytes = byte === 0x0a ? 0 : lineBytes + 1;
        if (lineBytes > maxLineBytes) {
          onCap("JSONL line length cap reached");
          callback(new Error("JSONL line length cap reached"));
          return;
        }
      }
      callback(null, chunk);
    },
  });
}

let replayAbort: AbortController | null = null;
let activeReplayChild: ChildProcessWithoutNullStreams | null = null;
let activeReplayStreams: Array<{ destroy(error?: Error): void }> = [];
let activeReplaySettlements: Promise<unknown>[] = [];

export async function cancelReplayResources(resources: {
  controller: AbortController | null;
  child: { killed?: boolean; kill(signal?: NodeJS.Signals): unknown } | null;
  streams: Array<{ destroy(error?: Error): void }>;
  settlements: Promise<unknown>[];
}) {
  resources.controller?.abort();
  for (const stream of resources.streams) stream.destroy();
  if (resources.child && !resources.child.killed) resources.child.kill("SIGKILL");
  await Promise.allSettled(resources.settlements);
}

async function cancelActiveReplay() {
  await cancelReplayResources({
    controller: replayAbort,
    child: activeReplayChild,
    streams: activeReplayStreams,
    settlements: activeReplaySettlements,
  });
  activeReplayStreams = [];
  activeReplaySettlements = [];
  activeReplayChild = null;
  replayAbort = null;
}

function terminateReplayInFlight(controller: AbortController, child: ChildProcessWithoutNullStreams | null) {
  controller.abort();
  // Destroy both sides of both pipelines immediately; awaiting their
  // settlements in replayHour's finally prevents zstd/fetch stragglers.
  for (const stream of activeReplayStreams) stream.destroy();
  child?.kill("SIGKILL");
}

async function replayHour(hour: Date, caps: ReplayCaps, ownerGeneration: number): Promise<boolean> {
  const key = hourKey(hour);
  replay.currentHour = key;
  const controller = replayAbort = new AbortController();
  const remainingMs = caps.deadlineAt - Date.now();
  if (remainingMs <= 0) { replayAbort = null; return false; }
  let child: ChildProcessWithoutNullStreams | null = null;
  let capped = false;
  let capReason = "";
  let input: Readable | null = null;
  const deadline = setTimeout(() => {
    capped = true;
    capReason = "time cap reached";
    terminateReplayInFlight(controller, child);
  }, remainingMs);
  try {
    const response = await fetch(`${REPLAY_ROOT}/${key}.jsonl.zst`, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`replay HTTP ${response.status} for ${key}`);
    child = activeReplayChild = spawn(process.env.ZSTD_BINARY || "zstd", ["-d", "-q", "-c"], { stdio: ["pipe", "pipe", "pipe"] });
    const childExit = new Promise<number | null>((resolve) => child!.once("close", resolve));
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-500); });
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        replay.compressedBytes += chunk.length;
        if (replay.compressedBytes > caps.maxCompressedBytes) {
          capped = true;
          capReason = "compressed byte cap reached";
          terminateReplayInFlight(controller, child);
          callback(new Error(capReason));
        } else callback(null, chunk);
      },
    });
    input = Readable.fromWeb(response.body as any);
    const onOutputCap = (reason: string) => {
      capped = true;
      capReason = reason;
      terminateReplayInFlight(controller, child);
    };
    const outputLimiter = createReplayOutputLimiter(
      caps.maxDecompressedBytes,
      caps.maxLineBytes,
      onOutputCap,
      (bytes) => { replay.decompressedBytes += bytes; },
    );
    activeReplayStreams = [input, limiter, outputLimiter, child.stdin, child.stdout];
    const pipeResult = pipeline(input, limiter, child.stdin)
      .then(() => null, (error: Error) => error);
    const outputResult = pipeline(child.stdout, outputLimiter)
      .then(() => null, (error: Error) => error);
    activeReplaySettlements = [childExit, pipeResult, outputResult];
    const lines = createInterface({ input: outputLimiter, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line) continue;
      replay.eventsRead++;
      if (replay.eventsRead > caps.maxEvents) {
        capped = true;
        capReason = "event cap reached";
        terminateReplayInFlight(controller, child);
        break;
      }
      let value: unknown;
      try { value = JSON.parse(line); } catch { replay.malformed++; continue; }
      const launch = parsePumpApiCreateEvent(value);
      if (launch) {
        const completed = await settleBefore(persist(launch, "replay", ownerGeneration), caps.deadlineAt);
        if (!completed) {
          capped = true;
          capReason = "time cap reached";
          terminateReplayInFlight(controller, child);
          break;
        }
      }
      else {
        const trade = parsePumpApiTradeEvent(value);
        if (trade) {
          const completed = await settleBefore(admitAndPersistTrade(trade, "replay", ownerGeneration), caps.deadlineAt);
          if (!completed) { capped = true; capReason = "time cap reached"; terminateReplayInFlight(controller, child); break; }
        } else if ((value as any)?.action === "create" || (value as any)?.action === "buy" || (value as any)?.action === "sell") replay.malformed++;
      }
    }
    if (capped || controller.signal.aborted || stopped || ownerGeneration !== generation) return false;
    const [code, pipeError, outputError] = await Promise.all([childExit, pipeResult, outputResult]);
    if (pipeError) throw pipeError;
    if (outputError) throw outputError;
    if (code !== 0) throw new Error(`zstd exited ${code}${stderr ? `: ${stderr}` : ""}`);
    replay.completedHours.push(key);
    return true;
  } catch (error) {
    if (capped || controller.signal.aborted || stopped || ownerGeneration !== generation) {
      if (capReason) replay.error = capReason;
      return false;
    }
    throw error;
  } finally {
    clearTimeout(deadline);
    if (controller.signal.aborted || capped || stopped || ownerGeneration !== generation) {
      terminateReplayInFlight(controller, child);
    }
    await Promise.allSettled(activeReplaySettlements);
    activeReplayStreams = [];
    activeReplaySettlements = [];
    if (activeReplayChild === child) activeReplayChild = null;
    if (replayAbort === controller) replayAbort = null;
  }
}

let marketTimer: NodeJS.Timeout | null = null;
let marketRefreshRunning = false;
let marketRefreshController: AbortController | null = null;
let marketRefreshPromise: Promise<void> | null = null;
async function refreshMarketSnapshots() {
  if (marketRefreshRunning || stopped) return;
  marketRefreshRunning = true;
  const ownerGeneration = generation;
  try {
    const mints = await listRecentObservedMints(120);
    for (let i = 0; i < mints.length && !stopped; i += 30) {
      const batch = mints.slice(i, i + 30);
      const controller = marketRefreshController = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000); timeout.unref();
      try {
        const response = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${batch.join(",")}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`DexScreener HTTP ${response.status}`);
        const pairs = await response.json() as Array<any>;
        for (const mint of batch) {
          const matches = Array.isArray(pairs) ? pairs.filter((p) => p?.baseToken?.address === mint) : [];
          const values = matches.map((p) => p?.volume?.h24).filter((v) => typeof v === "number" && Number.isFinite(v) && v >= 0);
          const marketCaps = matches.map((p) => p?.marketCap ?? p?.fdv).filter((v) => typeof v === "number" && Number.isFinite(v) && v >= 0);
          const graduatedObserved = hasObservedGraduatedVenue(matches);
          if (stopped || ownerGeneration !== generation || controller.signal.aborted) return;
          const hasMarketData = values.length > 0 || marketCaps.length > 0;
          await upsertPumpApiMarketSnapshot({
            mint,
            volume24hUsd: values.length ? values.reduce((sum, value) => sum + value, 0) : null,
            currentMarketCapUsd: marketCaps.length ? Math.max(...marketCaps) : null,
            peakMarketCapUsd: marketCaps.length ? Math.max(...marketCaps) : null,
            peakObservedAt: marketCaps.length ? new Date() : null,
            outcomeObservedAt: new Date(),
            graduatedObserved,
            observedAt: hasMarketData ? new Date() : null,
            lastAttemptAt: new Date(),
            failure: hasMarketData ? null : "No valid DexScreener market data",
            pairCount: matches.length,
          });
        }
      } catch (error) {
        for (const mint of batch) {
          if (stopped || ownerGeneration !== generation || controller.signal.aborted) return;
          await upsertPumpApiMarketSnapshot({ mint, volume24hUsd: null, currentMarketCapUsd: null,
          peakMarketCapUsd: null, peakObservedAt: null, outcomeObservedAt: null,
          graduatedObserved: null, observedAt: null,
          lastAttemptAt: new Date(), failure: error instanceof Error ? error.message.slice(0, 500) : "DexScreener request failed", pairCount: 0 });
        }
      } finally { clearTimeout(timeout); }
    }
  } finally { marketRefreshController = null; marketRefreshRunning = false; }
}
function triggerMarketRefresh() {
  if (!marketRefreshRunning) {
    // This is a best-effort enrichment loop. A transient database disconnect
    // must not take down the HTTP server after it has opened port 5000.
    marketRefreshPromise = refreshMarketSnapshots().catch((error) => {
      console.error("[pumpapi] market snapshot refresh skipped:", error instanceof Error ? error.message : error);
    });
  }
}

async function runConfiguredReplay() {
  const ownerGeneration = generation;
  const droppedAtStart = droppedWrites;
  const requested = Math.max(0, Math.min(6, Number.parseInt(process.env.PUMPAPI_REPLAY_HOURS || "0", 10) || 0));
  replay.requestedHours = requested;
  if (!requested) return;
  replay.state = "running";
  const caps: ReplayCaps = {
    maxCompressedBytes: Math.max(1_000_000, Math.min(256_000_000, Number(process.env.PUMPAPI_REPLAY_MAX_BYTES) || 64_000_000)),
    maxDecompressedBytes: Math.max(1_000_000, Math.min(512_000_000, Number(process.env.PUMPAPI_REPLAY_MAX_DECOMPRESSED_BYTES) || 128_000_000)),
    maxLineBytes: Math.max(1_024, Math.min(4_000_000, Number(process.env.PUMPAPI_REPLAY_MAX_LINE_BYTES) || 1_000_000)),
    maxEvents: Math.max(1_000, Math.min(1_000_000, Number(process.env.PUMPAPI_REPLAY_MAX_EVENTS) || 100_000)),
    maxMs: Math.max(5_000, Math.min(120_000, Number(process.env.PUMPAPI_REPLAY_MAX_MS) || 30_000)),
    deadlineAt: 0,
  };
  caps.deadlineAt = Date.now() + caps.maxMs;
  replay.startedAt = new Date().toISOString();
  replay.maxCompressedBytes = caps.maxCompressedBytes;
  replay.maxDecompressedBytes = caps.maxDecompressedBytes;
  replay.maxLineBytes = caps.maxLineBytes;
  replay.maxEvents = caps.maxEvents;
  replay.maxMs = caps.maxMs;
  const publicationLagMs = Math.max(60_000, Math.min(60 * 60_000,
    Number(process.env.PUMPAPI_REPLAY_PUBLICATION_LAG_MS) || 10 * 60_000));
  const latest = latestPublishableReplayHour(new Date(), publicationLagMs);
  try {
    for (let i = requested - 1; i >= 0; i--) {
      if (!await replayHour(new Date(latest.getTime() - i * 3_600_000), caps, ownerGeneration)) {
        replay.state = "partial";
        replay.error ??= "Replay stopped at configured byte, event, or time cap";
        return;
      }
    }
    await writePool.drain();
    if (droppedWrites > droppedAtStart) {
      replay.state = "partial";
      replay.error = "Replay write queue reached its cap; some creator metrics were dropped";
    } else replay.state = "complete";
  } catch (error) {
    replay.state = replay.completedHours.length ? "partial" : "error";
    replay.error = error instanceof Error ? error.message : String(error);
  } finally {
    replay.currentHour = null;
    replay.finishedAt = new Date().toISOString();
  }
}

export function shouldStartReplayAfterSeed(ownerGeneration: number, activeGeneration: number, isStopped: boolean) {
  return !isStopped && ownerGeneration === activeGeneration;
}

export function startPumpApiLeaderboard() {
  if (!stopped) return;
  stopped = false;
  const ownerGeneration = ++generation;
  void seedKnownObservedMints(ownerGeneration).finally(() => {
    if (shouldStartReplayAfterSeed(ownerGeneration, generation, stopped)) {
      connect();
      void runConfiguredReplay();
    }
  });
  triggerMarketRefresh();
  marketTimer = setInterval(triggerMarketRefresh, 60_000);
  marketTimer.unref();
}

export async function stopPumpApiLeaderboard() {
  stopped = true;
  generation++;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (inactivityTimer) { clearInterval(inactivityTimer); inactivityTimer = null; }
  if (marketTimer) { clearInterval(marketTimer); marketTimer = null; }
  marketRefreshController?.abort();
  await marketRefreshPromise?.catch(() => undefined);
  if (socket) {
    socket.removeAllListeners();
    socket.terminate();
    socket = null;
  }
  await cancelActiveReplay();
  await writePool.drain();
}

export function getPumpApiLeaderboardStatus(): PumpApiLeaderboardStatus {
  // A successful launch write cannot mask a later/ongoing trade-write failure.
  const persistenceDegraded = isPumpApiPersistenceDegraded(lastPersistedLaunchAt, lastPersistError) ||
    isPumpApiPersistenceDegraded(lastPersistedTradeAt, lastTradePersistError) || droppedWrites > 0 ||
    admissionLookupErrors > 0 || admissionDroppedTrades > 0 || !!admissionSeedError;
  return {
    running: !stopped,
    connected: socket?.readyState === WebSocket.OPEN,
    lastConnectedAt: lastConnectedAt?.toISOString() ?? null,
    lastEventAt: lastEventAt?.toISOString() ?? null,
    lastLaunchAt: lastLaunchAt?.toISOString() ?? null,
    lastPersistedLaunchAt: lastPersistedLaunchAt?.toISOString() ?? null,
    lastPersistedTradeAt: lastPersistedTradeAt?.toISOString() ?? null,
    lastPersistError: lastPersistError?.toISOString() ?? null,
    lastTradePersistError: lastTradePersistError?.toISOString() ?? null,
    reconnectAttempt,
    accepted,
    duplicates,
    malformed,
    persistErrors,
    tradeAccepted,
    tradeDuplicates,
    tradePersistErrors,
    admissionLookupErrors,
    admissionDroppedTrades,
    admissionQueueDepth: pendingAdmissions,
    queueDepth: pendingWrites,
    droppedWrites,
    lastDroppedAt: lastDroppedAt?.toISOString() ?? null,
    persistenceDegraded,
    message: droppedWrites > 0
      ? "Creator metric writes were dropped at the queue cap; rankings are partial."
      : admissionDroppedTrades > 0
        ? "Creator trade admission lookups failed; rankings are partial."
        : admissionSeedError
          ? "Creator mint cache seeding failed; database fallback is active and coverage may be partial."
      : persistenceDegraded ? "Creator metrics persistence is failing; rankings may be delayed." : replay.error,
    fresh: !!lastPersistedLaunchAt && Date.now() - lastPersistedLaunchAt.getTime() < 60_000 &&
      !persistenceDegraded,
    replay: { ...replay, completedHours: [...replay.completedHours] },
  };
}