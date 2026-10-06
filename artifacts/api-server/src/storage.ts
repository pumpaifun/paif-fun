import { eq, ne, and, desc, asc, lt, lte, gte, inArray, isNull, isNotNull, sql as drizzleSql } from "drizzle-orm";
import { db } from "./db";
import {
  type Vault, type InsertVault,
  type VaultStrategy, type InsertVaultStrategy,
  type VaultSettings, type InsertVaultSettings,
  type VaultPosition, type InsertVaultPosition,
  type Comment, type InsertComment,
  type CommunityAppeal, type InsertCommunityAppeal,
  type SwapHistoryItem, type InsertSwapHistory,
  type BumpHistoryItem, type InsertBumpHistory,
  type BumpDelegation, type InsertBumpDelegation,
  type BumpCredits, type BumpCreditPurchase, type AccessPassPurchase,
  vaults, vaultStrategies, vaultSettings, vaultPositions,
  comments, communityAppeals, swapHistory, walletWriteReceipts, bumpHistory, bumpHistoryDelegations,
  bumpCredits, bumpCreditPurchases, accessPasses, accessPassPurchases, buybackLedger, buybackExecutionIntents,
  communityBuybacks, communityBuybackEntries, communityBuybackIntents,
  type CommunityBuyback, type CommunityBuybackEntry,
  autoStrategies, autoStrategyExecutions,
  type AutoStrategy, type AutoStrategyExecution,
  arbStrategies, arbExecutions,
  type ArbStrategy, type ArbExecution,
  swingStrategies, swingPositions, swingEvents, swingBuySignals, swingPresets, swingPerformanceHistory,
  type SwingStrategy, type SwingPosition, type SwingEvent, type SwingBuySignal,
  type SwingPreset, type InsertSwingPreset,
  telegramDestinations, telegramPosts,
  type TelegramDestination, type InsertTelegramDestination, type TelegramPost,
  STRATEGY_TYPES,
} from "@workspace/db";
import { FREE_TRIAL_CREDITS, FREE_TRIAL_MAX_SUBWALLETS, ABSOLUTE_MAX_SUBWALLETS, BUYBACK_ALLOCATION_BPS } from "@shared/credit-packs";

export interface IStorage {
  getVaultById(id: string): Promise<Vault | undefined>;
  getVaultByWallet(walletAddress: string): Promise<Vault | undefined>;
  createVault(data: InsertVault): Promise<Vault>;

  getStrategies(vaultId: string): Promise<VaultStrategy[]>;
  upsertStrategies(vaultId: string, strategies: Partial<InsertVaultStrategy>[]): Promise<VaultStrategy[]>;

  getSettings(vaultId: string): Promise<VaultSettings | undefined>;
  upsertSettings(vaultId: string, settings: Partial<InsertVaultSettings>): Promise<VaultSettings>;

  getPositions(vaultId: string): Promise<VaultPosition[]>;
  createPosition(data: InsertVaultPosition): Promise<VaultPosition>;
  closePosition(positionId: string): Promise<VaultPosition | undefined>;

  getComments(limit?: number): Promise<Comment[]>;
  getComment(id: string): Promise<Comment | undefined>;
  createComment(data: InsertComment): Promise<Comment>;
  upvoteComment(id: string): Promise<Comment | undefined>;
  createCommunityAppeal(data: InsertCommunityAppeal): Promise<CommunityAppeal>;
  getPendingCommunityAppeals(limit?: number): Promise<CommunityAppeal[]>;
  getCommunityAppealsByRequester(
    requesterWallet: string,
    limit?: number,
  ): Promise<Array<Pick<CommunityAppeal, "id" | "category" | "status" | "moderatorNote" | "createdAt" | "resolvedAt">>>;
  resolveCommunityAppeal(args: {
    id: string;
    status: "approved" | "declined";
    moderatorNote?: string | null;
    resolvedBy: string;
  }): Promise<{ appeal: CommunityAppeal; publishedComment?: Comment } | undefined>;
  consumeWalletWriteSignature(signature: string, purpose: string, walletAddress: string): Promise<boolean>;

  getSwapHistory(walletAddress: string, limit?: number): Promise<SwapHistoryItem[]>;
  saveSwapHistory(data: InsertSwapHistory): Promise<SwapHistoryItem>;
  getRecentSwaps(limit?: number): Promise<SwapHistoryItem[]>;
  getTrendingTokens(): Promise<{
    mint: string; symbol: string; name: string; image: string | null;
    chats: number; bumps: number; score: number;
  }[]>;

  getBumpHistory(ownerWallet: string, limit?: number): Promise<BumpHistoryItem[]>;
  saveBumpHistory(data: InsertBumpHistory): Promise<BumpHistoryItem>;
  getBumpHistoryStats(ownerWallet: string): Promise<{ totalBumps: number; totalSuccess: number; totalFailed: number; totalSolSpent: number; firstAt: string | null; lastAt: string | null }>;
  getDistinctSessionWalletsForOwner(ownerWallet: string): Promise<{ sessionWallet: string; bumpCount: number; firstAt: string; lastAt: string }[]>;
  getBumpDelegation(ownerWallet: string, sessionWallet: string): Promise<BumpDelegation | undefined>;
  saveBumpDelegation(data: InsertBumpDelegation): Promise<BumpDelegation>;
  getOwnerBumpDelegations(ownerWallet: string): Promise<BumpDelegation[]>;

  getCreditBalance(ownerWallet: string): Promise<{ balance: number; unlimitedSubwallets: boolean; unlimitedUntil: string | null; maxSubwallets: number }>;
  claimFreeTrial(ownerWallet: string): Promise<{ balance: number; unlimitedSubwallets: boolean; unlimitedUntil: string | null; maxSubwallets: number; granted: boolean }>;
  decrementCredit(ownerWallet: string): Promise<{ ok: boolean; balance: number; unlimitedActive: boolean }>;

  recordCreditPurchaseAndGrant(args: {
    ownerWallet: string;
    packId: string;
    lamportsPaid: bigint;
    creditsToGrant: number;
    grantUnlimitedSubwallets: boolean;
    grantMaxSubwallets: number;
    extendUnlimitedMs?: number;
    txSignature: string;
  }): Promise<{ purchase: BumpCreditPurchase; balance: number; unlimitedSubwallets: boolean; unlimitedUntil: string | null; maxSubwallets: number }>;
  getCreditPurchaseBySignature(txSignature: string): Promise<BumpCreditPurchase | undefined>;
  getAccessPass(ownerWallet: string): Promise<{
    trialStartedAt: string | null;
    passExpiresAt: string | null;
    active: boolean;
    trialActive: boolean;
    paidActive: boolean;
  }>;
  startAccessTrial(ownerWallet: string): Promise<{
    trialStartedAt: string | null;
    passExpiresAt: string | null;
    active: boolean;
    trialActive: boolean;
    paidActive: boolean;
    granted: boolean;
  }>;
  getAccessPassPurchaseBySignature(txSignature: string): Promise<AccessPassPurchase | undefined>;
  recordAccessPassPurchase(args: {
    ownerWallet: string;
    passId: string;
    lamportsPaid: bigint;
    durationMs: number;
    txSignature: string;
  }): Promise<{ purchase: AccessPassPurchase; passExpiresAt: string }>;

  // ─── Buyback Pool ledger ──────────────────────────────────────────────────
  // Aggregated stats for the public /buyback page. Numeric totals returned
  // as strings to preserve full lamport precision past 2^53.
  getBuybackStats(chain?: string): Promise<{
    entryCount: number;
    totalRevenueLamports: string;
    totalAllocatedLamports: string;
    totalPendingLamports: string;
    totalExecutedLamports: string;
    firstAt: string | null;
    lastAt: string | null;
  }>;
  // Most recent ledger rows for the public table (no owner wallet exposed).
  getRecentBuybackEntries(limit: number, chain?: string): Promise<Array<{
    id: string;
    sourceType: string;
    lamportsRevenue: string;
    allocationBps: number;
    lamportsAllocated: string;
    status: string;
    createdAt: string;
    executedAt: string | null;
    executionTxSignature: string | null;
  }>>;
  // Pending rows for the admin one-click swap flow. Limited to keep batched
  // executions sized for the 1232-byte Jupiter tx envelope.
  getPendingBuybackRows(limit: number): Promise<Array<{
    id: string;
    lamportsAllocated: string;
    createdAt: string;
  }>>;
  // Resolve a candidate set of row IDs (used to validate the sum that an
  // admin claims to be settling). Returns rows in arbitrary order.
  getBuybackRowsByIds(ids: string[]): Promise<Array<{
    id: string;
    lamportsAllocated: string;
    status: string;
  }>>;
  // Idempotency lookup — refuse to mark twice with the same swap tx.
  getBuybackRowByExecutionSignature(signature: string): Promise<{ id: string } | undefined>;
  // Insert an "executed" ledger row for a buyback that was performed manually
  // (off-platform, e.g. operator OTC swap). lamportsRevenue is set to 0 since
  // there's no source revenue event behind it; lamportsAllocated is the SOL
  // actually spent on-chain. Returns the new row's id.
  recordManualBuyback(args: {
    ownerWallet: string;
    lamportsSpent: bigint;
    txSignature: string;
    notes?: string;
  }): Promise<{ id: string }>;
  // Atomically flip rows from "pending" to "executed". Returns rows actually
  // updated (so retries that race a competing admin click are visible).
  markBuybackRowsExecuted(ids: string[], txSignature: string, notes?: string): Promise<number>;
  // ─── Buyback execution intents (nonce binding) ───────────────────────────
  createBuybackIntent(intent: {
    nonce: string;
    rowIds: string[];
    expectedLamports: string;
    treasury: string;
    ttlMs: number;
  }): Promise<void>;
  getBuybackIntent(nonce: string): Promise<{
    nonce: string;
    rowIds: string[];
    expectedLamports: string;
    treasury: string;
    expiresAt: string;
    consumedAt: string | null;
  } | undefined>;
  // Atomic consume: WHERE consumed_at IS NULL — caller must check
  // affected rows > 0 to detect race losses.
  consumeBuybackIntent(nonce: string, signature: string): Promise<boolean>;
  // Single-transaction settlement: consumes the intent AND marks ALL rows
  // executed atomically. Rolls back unless every rowId in `rowIds` was
  // updated (so a race or partial mark surfaces as an error, never a
  // half-applied buyback). Returns the row count actually marked.
  consumeIntentAndMarkRows(args: {
    nonce: string;
    signature: string;
    rowIds: string[];
    notes: string;
  }): Promise<number>;

  // ─── Community buybacks (multi-tenant) ───────────────────────────────────
  createCommunityBuyback(data: {
    slug: string;
    ownerWallet: string;
    tokenMint: string;
    tokenSymbol: string;
    tokenName: string;
    treasuryWallet: string;
    description: string | null;
  }): Promise<CommunityBuyback>;
  listCommunityBuybacks(limit?: number): Promise<Array<CommunityBuyback & {
    entryCount: number;
    totalLamportsSpent: string;
    lastAt: string | null;
  }>>;
  getCommunityBuybackBySlug(slug: string): Promise<CommunityBuyback | undefined>;
  getCommunityBuybackByMint(mint: string): Promise<CommunityBuyback | undefined>;
  getCommunityBuybackEntryBySignature(signature: string): Promise<{ id: string } | undefined>;
  recordCommunityManualBuyback(data: {
    tenantId: string;
    lamportsSpent: string;
    tokensReceivedRaw: string;
    txSignature: string;
    notes: string;
  }): Promise<{ id: string }>;
  getCommunityBuybackStats(tenantId: string): Promise<{
    entryCount: number;
    totalLamportsSpent: string;
    totalTokensReceivedRaw: string;
    firstAt: string | null;
    lastAt: string | null;
  }>;
  getCommunityBuybackEntries(tenantId: string, limit?: number): Promise<CommunityBuybackEntry[]>;

  // Per-tenant execution intents (for one-click executable buybacks).
  createCommunityBuybackIntent(intent: {
    nonce: string;
    tenantId: string;
    treasury: string;
    tokenMint: string;
    expectedLamports: string;
    ttlMs: number;
  }): Promise<void>;
  getCommunityBuybackIntent(nonce: string): Promise<{
    nonce: string;
    tenantId: string;
    treasury: string;
    tokenMint: string;
    expectedLamports: string;
    expiresAt: string;
    consumedAt: string | null;
  } | undefined>;
  consumeCommunityIntentAndRecord(args: {
    nonce: string;
    tenantId: string;
    txSignature: string;
    lamportsSpent: string;
    tokensReceivedRaw: string;
    notes: string;
  }): Promise<{ id: string }>;

  // ─── Automated Strategy Bot ──────────────────────────────────────────────
  createAutoStrategy(data: {
    ownerWallet: string;
    tradingWallet: string;
    encryptedKey: string;
    withdrawAddress: string;
    name: string;
    budgetLamports: string;
    tokens: string[];
    allocationsBps: number[];
    mode: string;
    slippageBps: number;
    windowStartAt: Date;
    windowEndAt: Date;
    intervalSeconds: number;
    totalSlices: number;
    buySlices: number;
    walletCount?: number;
    extraWallets?: string[];
    extraEncryptedKeys?: string[];
    keepFunds?: boolean;
  }): Promise<AutoStrategy>;
  getAutoStrategy(id: string): Promise<AutoStrategy | undefined>;
  listAutoStrategiesByOwner(ownerWallet: string): Promise<AutoStrategy[]>;
  // Active strategies whose next slice is due (nextRunAt <= now). Drives the
  // server scheduler tick.
  getDueAutoStrategies(now: Date): Promise<AutoStrategy[]>;
  // Active strategies with a take-profit target set that hasn't fired yet.
  // Scanned every tick independently of the slice schedule so the trigger is
  // responsive to price rather than waiting for the next slice.
  getArmedTakeProfitStrategies(): Promise<AutoStrategy[]>;
  claimTakeProfitFire(id: string): Promise<boolean>;
  updateAutoStrategy(id: string, patch: Partial<{
    status: string;
    spentLamports: string;
    completedSlices: number;
    nextRunAt: Date | null;
    encryptedKey: string;
    distributedAt: Date | null;
    setupFeePaidAt: Date | null;
    takeProfitFiredAt: Date | null;
  }>): Promise<AutoStrategy | undefined>;
  // Atomically claim the one-time setup-fee slot: stamps setupFeePaidAt only if
  // it is currently null. Returns true if THIS call won the claim (so it must
  // charge), false if it was already claimed. Closes the concurrent-double-charge
  // race on Start since the treasury fee is non-recoverable.
  claimAutoStrategySetupFee(id: string): Promise<boolean>;
  addAutoStrategyExecution(data: {
    strategyId: string;
    tokenMint: string;
    action: string;
    amountLamports: string;
    tokenAmount: string;
    txSignature: string | null;
    status: string;
    errorMessage: string | null;
  }): Promise<AutoStrategyExecution>;
  listAutoStrategyExecutions(strategyId: string, limit?: number): Promise<AutoStrategyExecution[]>;

  // Arbitrage executor
  createArbStrategy(data: {
    ownerWallet: string;
    workerWallet: string;
    encryptedKey: string;
    withdrawAddress: string;
    name: string;
    mode: string;
    status: string;
    budgetLamports: string;
    maxTradeUsd: number;
    minNetEdgeBps: number;
    slippageBps: number;
    targetMode: string;
    targetMints: string[];
    lossStopCount: number;
    intervalSeconds: number;
    nextRunAt: Date | null;
  }): Promise<ArbStrategy>;
  getArbStrategy(id: string): Promise<ArbStrategy | undefined>;
  listArbStrategiesByOwner(ownerWallet: string): Promise<ArbStrategy[]>;
  getDueArbStrategies(now: Date): Promise<ArbStrategy[]>;
  updateArbStrategy(id: string, patch: Partial<{
    status: string;
    spentLamports: string;
    consecutiveLosses: number;
    tradesExecuted: number;
    wins: number;
    realizedPnlLamports: string;
    paperPnlMicroUsd: string;
    nextRunAt: Date | null;
  }>): Promise<ArbStrategy | undefined>;
  addArbExecution(data: {
    strategyId: string;
    mint: string;
    symbol: string;
    buyDex: string;
    sellDex: string;
    tradeSizeUsd: number;
    grossSpreadBps: number;
    estCostBps: number;
    netEdgeBps: number;
    mode: string;
    solInLamports: string;
    solOutLamports: string;
    buySig: string | null;
    sellSig: string | null;
    resultMicroUsd: string;
    status: string;
    errorMessage: string | null;
  }): Promise<ArbExecution>;
  listArbExecutions(strategyId: string, limit?: number): Promise<ArbExecution[]>;

  // Swing bot
  createSwingStrategy(data: {
    ownerWallet: string;
    workerWallet: string;
    encryptedKey: string;
    subWalletCount?: number;
    extraWallets?: string[];
    extraEncryptedKeys?: string[];
    withdrawAddress: string;
    name: string;
    mode: string;
    universe?: string;
    style: string;
    targetMint: string | null;
    manualBuy?: boolean;
    reentry?: boolean;
    status: string;
    budgetLamports: string;
    paperBankrollLamports: string;
    windowEndAt: Date;
    unlimitedWindow?: boolean;
    activeSince?: Date | null;
    maxPositions: number;
    allowStacking: boolean;
    hotStreakFullSize?: boolean;
    minPoolAgeHours?: number | null;
    requireApproval?: boolean;
    takeProfitPct: number | null;
    conservativeProfit?: boolean;
    neverSellAtLoss?: boolean;
    redEndBehavior?: string;
    momentumCycle?: boolean;
    rotateToRunners?: boolean;
    stopLossPct: number;
    stopRoomPct?: number | null;
    sellOffCutEnabled?: boolean;
    winnerKeepPct?: number | null;
    profitSkimPct?: number;
    trailArmPct: number;
    trailPct: number;
    maxHoldHours: number;
    minLiquidityUsd: number;
    slippageBps: number;
    lossStopCount: number;
    feeBps?: number | null;
    nextRunAt: Date | null;
  }): Promise<SwingStrategy>;
  getSwingStrategy(id: string): Promise<SwingStrategy | undefined>;
  listSwingStrategiesByOwner(ownerWallet: string): Promise<SwingStrategy[]>;
  getDueSwingStrategies(now: Date): Promise<SwingStrategy[]>;
  listActiveSwingStrategies(): Promise<SwingStrategy[]>;
  listSwingStrategiesNeedingLiquidation(): Promise<SwingStrategy[]>;
  listRecentlyStoppedLiveSwingStrategies(since: Date): Promise<SwingStrategy[]>;
  listSwingPerformance(ownerWallet?: string): Promise<Array<{
    strategyId: string; ownerWallet: string; name: string; mode: string; style: string;
    status: string; settings: Record<string, unknown>; trades: number; wins: number;
    realizedPnlLamports: string; createdAt: Date; archived: boolean;
  }>>;
  updateSwingStrategy(id: string, patch: Partial<{
    status: string;
    paperBankrollLamports: string;
    bankedLamports: string;
    consecutiveLosses: number;
    tradesExecuted: number;
    wins: number;
    realizedPnlLamports: string;
    feesPaidLamports: string;
    nextRunAt: Date | null;
    lastScanAt: Date | null;
    lastScanNote: string | null;
    maxPositions: number;
    allowStacking: boolean;
    requireApproval: boolean;
    conservativeProfit: boolean;
    neverSellAtLoss: boolean;
    redEndBehavior: string;
    takeProfitPct: number | null;
    stopRoomPct: number | null;
    windowEndAt: Date;
    unlimitedWindow: boolean;
    activeMsTotal: string;
    activeSince: Date | null;
    restartedAt: Date | null;
    budgetLamports: string;
    lossCooldownUntil: Date | null;
    rebuyMints: string[];
    blockedMints: string[];
    hotStreakFullSize: boolean;
    minPoolAgeHours: number | null;
    minLiquidityUsd: number;
    sellOffCutEnabled: boolean;
    winnerKeepPct: number | null;
    profitSkimPct: number;
    name: string;
    favorite: boolean;
  }>): Promise<SwingStrategy | undefined>;
  createSwingPosition(data: {
    strategyId: string;
    mint: string;
    symbol: string;
    tokenName: string | null;
    mode: string;
    walletIndex?: number;
    solInLamports: string;
    tokenAmountRaw: string;
    decimals: number;
    highWaterLamports: string;
    lastValueLamports: string;
    entryVolumeH1Usd: number;
    entryLiquidityUsd: number;
    entryPriceUsd: number | null;
    entryFillPriceUsd?: number | null;
    entryPairAddress: string | null;
    entryPumpPoolId: string | null;
    entryPumpQuoteMint: string | null;
    entryPumpBlockhash: string | null;
    entryTrigger?: string | null;
    entryReduced?: boolean;
    entrySig: string | null;
  }): Promise<SwingPosition | undefined>;
  // Atomic create: takes a per-(strategy,mint) advisory lock, re-checks for an
  // existing OPEN position of the same mint inside the transaction, and only
  // then inserts. Returns undefined if one already exists — closes the
  // duplicate-buy race between overlapping server processes.
  createSwingPositionIfNoOpenMint(data: Parameters<IStorage["createSwingPosition"]>[0]): Promise<SwingPosition | undefined>;
  // Spend the one-time top-up ticket: clears entry_reduced on every OPEN
  // position of this mint so a reduced entry can never ladder a second
  // top-up (lifetime one-top-up-per-lineage invariant).
  clearSwingEntryReduced(strategyId: string, mint: string): Promise<void>;
  updateSwingPosition(id: string, patch: Partial<{
    status: string;
    tokenAmountRaw: string;
    highWaterLamports: string;
    lastValueLamports: string;
    exitSig: string | null;
    solOutLamports: string;
    exitReason: string;
    exitPriceUsd: number | null;
    entryPumpPoolId: string | null;
    entryPumpQuoteMint: string | null;
    entryPumpBlockhash: string | null;
    manualHold: boolean;
    closedAt: Date;
  }>): Promise<SwingPosition | undefined>;
  // Atomic close: only succeeds if the row is still "open" (compare-and-set in
  // SQL). Returns undefined when another process already closed it — callers
  // MUST skip stats/events in that case or P&L gets double-counted.
  // Single-winner historical repair: applies only if the position is closed
  // AND still shows zero proceeds. Returns true only for the process whose
  // UPDATE actually claimed the row (deploy overlap runs two processes).
  repairSwingPositionSolOut(id: string, solOutLamports: string, exitSig: string): Promise<boolean>;
  closeSwingPositionIfOpen(id: string, patch: Partial<{
    status: string;
    lastValueLamports: string;
    exitSig: string | null;
    solOutLamports: string;
    exitReason: string;
    exitPriceUsd: number | null;
    entryPumpPoolId: string | null;
    entryPumpQuoteMint: string | null;
    closedAt: Date;
  }>): Promise<SwingPosition | undefined>;
  listSwingPositions(strategyId: string, status?: string): Promise<SwingPosition[]>;
  addSwingEvent(data: {
    strategyId: string;
    positionId: string | null;
    kind: string;
    mint: string | null;
    symbol: string | null;
    detail: string;
    solLamports: string | null;
  }): Promise<SwingEvent>;
  listSwingEvents(strategyId: string, limit?: number): Promise<SwingEvent[]>;
  listSwingSkims(strategyId: string, limit?: number): Promise<SwingEvent[]>;
  // Buy-signal queue. "pending" is owner approval; "planned" is an internal
  // paper-stock candidate awaiting the next regular U.S. market open.
  createSwingBuySignalIfNonePending(data: {
    strategyId: string;
    mint: string;
    symbol: string;
    reason: string;
    status?: string;
  }): Promise<SwingBuySignal | undefined>;
  listSwingBuySignals(strategyId: string, status?: string): Promise<SwingBuySignal[]>;
  getSwingBuySignal(id: string): Promise<SwingBuySignal | undefined>;
  updateSwingBuySignalStatus(id: string, status: string): Promise<void>;
  expireStaleSwingBuySignals(strategyId: string, olderThan: Date): Promise<void>;
  deleteSwingStrategy(id: string): Promise<void>;
  // Saved settings presets ("my favorite settings").
  createSwingPreset(data: InsertSwingPreset): Promise<SwingPreset>;
  listSwingPresetsByOwner(ownerWallet: string): Promise<SwingPreset[]>;
  getSwingPreset(id: string): Promise<SwingPreset | undefined>;
  updateSwingPreset(id: string, patch: Partial<Pick<SwingPreset, "name" | "starred">>): Promise<SwingPreset | undefined>;
  deleteSwingPreset(id: string): Promise<void>;

  // Telegram shill bot
  listTelegramDestinations(): Promise<TelegramDestination[]>;
  addTelegramDestination(data: InsertTelegramDestination): Promise<TelegramDestination>;
  setTelegramDestinationEnabled(id: string, enabled: boolean): Promise<TelegramDestination | undefined>;
  deleteTelegramDestination(id: string): Promise<void>;
  logTelegramPost(data: {
    kind: string;
    copyMode: string;
    content: string;
    tokenMint: string | null;
    tokenSymbol: string | null;
    targets: string[];
    sentCount: number;
    failCount: number;
  }): Promise<TelegramPost>;
  listTelegramPosts(limit?: number): Promise<TelegramPost[]>;
}

export class DatabaseStorage implements IStorage {
  async getVaultById(id: string): Promise<Vault | undefined> {
    const [vault] = await db.select().from(vaults).where(eq(vaults.id, id));
    return vault;
  }

  async getVaultByWallet(walletAddress: string): Promise<Vault | undefined> {
    const [vault] = await db.select().from(vaults).where(eq(vaults.walletAddress, walletAddress));
    return vault;
  }

  async createVault(data: InsertVault): Promise<Vault> {
    const [vault] = await db.insert(vaults).values(data).returning();

    const strategyDefaults = STRATEGY_TYPES.map((type) => ({
      vaultId: vault.id,
      strategyType: type,
      allocation: 0,
      isActive: false,
      mode: "live" as const,
    }));
    await db.insert(vaultStrategies).values(strategyDefaults);

    await db.insert(vaultSettings).values({ vaultId: vault.id });

    return vault;
  }

  async getStrategies(vaultId: string): Promise<VaultStrategy[]> {
    return db.select().from(vaultStrategies).where(eq(vaultStrategies.vaultId, vaultId));
  }

  async upsertStrategies(vaultId: string, updates: Partial<InsertVaultStrategy>[]): Promise<VaultStrategy[]> {
    for (const update of updates) {
      if (!update.strategyType) continue;
      await db
        .update(vaultStrategies)
        .set({
          ...(update.allocation !== undefined && { allocation: update.allocation }),
          ...(update.isActive !== undefined && { isActive: update.isActive }),
          ...(update.mode !== undefined && { mode: update.mode }),
        })
        .where(
          and(
            eq(vaultStrategies.vaultId, vaultId),
            eq(vaultStrategies.strategyType, update.strategyType),
          )
        );
    }
    return this.getStrategies(vaultId);
  }

  async getSettings(vaultId: string): Promise<VaultSettings | undefined> {
    const [settings] = await db.select().from(vaultSettings).where(eq(vaultSettings.vaultId, vaultId));
    return settings;
  }

  async upsertSettings(vaultId: string, updates: Partial<InsertVaultSettings>): Promise<VaultSettings> {
    const existing = await this.getSettings(vaultId);
    if (existing) {
      const [updated] = await db
        .update(vaultSettings)
        .set(updates)
        .where(eq(vaultSettings.vaultId, vaultId))
        .returning();
      return updated;
    }
    const [created] = await db
      .insert(vaultSettings)
      .values({ vaultId, ...updates })
      .returning();
    return created;
  }

  async getPositions(vaultId: string): Promise<VaultPosition[]> {
    return db
      .select()
      .from(vaultPositions)
      .where(eq(vaultPositions.vaultId, vaultId))
      .orderBy(desc(vaultPositions.createdAt));
  }

  async createPosition(data: InsertVaultPosition): Promise<VaultPosition> {
    const [position] = await db.insert(vaultPositions).values(data).returning();
    return position;
  }

  async closePosition(positionId: string): Promise<VaultPosition | undefined> {
    const [updated] = await db
      .update(vaultPositions)
      .set({ status: "closed", closedAt: new Date() })
      .where(eq(vaultPositions.id, positionId))
      .returning();
    return updated;
  }

  async getComments(limit = 50): Promise<Comment[]> {
    const posts = await db
      .select()
      .from(comments)
      .where(isNull(comments.parentCommentId))
      .orderBy(desc(comments.createdAt))
      .limit(limit);
    if (posts.length === 0) return posts;

    const replies = await db
      .select()
      .from(comments)
      .where(inArray(comments.parentCommentId, posts.map((post) => post.id)))
      .orderBy(asc(comments.createdAt));

    return [...posts, ...replies];
  }

  async getComment(id: string): Promise<Comment | undefined> {
    const [comment] = await db
      .select()
      .from(comments)
      .where(eq(comments.id, id))
      .limit(1);
    return comment;
  }

  async createComment(data: InsertComment): Promise<Comment> {
    const [comment] = await db.insert(comments).values(data).returning();
    return comment;
  }

  async upvoteComment(id: string): Promise<Comment | undefined> {
    const [updated] = await db
      .update(comments)
      .set({ upvotes: drizzleSql`${comments.upvotes} + 1` })
      .where(eq(comments.id, id))
      .returning();
    return updated;
  }

  async createCommunityAppeal(data: InsertCommunityAppeal): Promise<CommunityAppeal> {
    const [appeal] = await db.insert(communityAppeals).values(data).returning();
    return appeal;
  }

  async getPendingCommunityAppeals(limit = 50): Promise<CommunityAppeal[]> {
    return db
      .select()
      .from(communityAppeals)
      .where(eq(communityAppeals.status, "pending"))
      .orderBy(asc(communityAppeals.createdAt))
      .limit(limit);
  }

  async getCommunityAppealsByRequester(
    requesterWallet: string,
    limit = 20,
  ): Promise<Array<Pick<CommunityAppeal, "id" | "category" | "status" | "moderatorNote" | "createdAt" | "resolvedAt">>> {
    return db
      .select({
        id: communityAppeals.id,
        category: communityAppeals.category,
        status: communityAppeals.status,
        moderatorNote: communityAppeals.moderatorNote,
        createdAt: communityAppeals.createdAt,
        resolvedAt: communityAppeals.resolvedAt,
      })
      .from(communityAppeals)
      .where(eq(communityAppeals.requesterWallet, requesterWallet))
      .orderBy(desc(communityAppeals.createdAt))
      .limit(limit);
  }

  async resolveCommunityAppeal(args: {
    id: string;
    status: "approved" | "declined";
    moderatorNote?: string | null;
    resolvedBy: string;
  }): Promise<{ appeal: CommunityAppeal; publishedComment?: Comment } | undefined> {
    return db.transaction(async (tx) => {
      const [appeal] = await tx
        .select()
        .from(communityAppeals)
        .where(and(eq(communityAppeals.id, args.id), eq(communityAppeals.status, "pending")))
        .for("update");
      if (!appeal) return undefined;

      let publishedComment: Comment | undefined;
      if (args.status === "approved" && appeal.blockedMessage) {
        const [comment] = await tx.insert(comments).values({
          walletAddress: appeal.requesterWallet,
          displayName: appeal.displayName,
          message: appeal.blockedMessage,
          category: appeal.category,
        }).returning();
        publishedComment = comment;
      }

      const [resolved] = await tx
        .update(communityAppeals)
        .set({
          status: args.status,
          moderatorNote: args.moderatorNote ?? null,
          resolvedBy: args.resolvedBy,
          resolvedAt: new Date(),
          blockedMessage: null,
        })
        .where(eq(communityAppeals.id, args.id))
        .returning();
      return { appeal: resolved, publishedComment };
    });
  }

  async consumeWalletWriteSignature(signature: string, purpose: string, walletAddress: string): Promise<boolean> {
    const inserted = await db
      .insert(walletWriteReceipts)
      .values({ signature, purpose, walletAddress })
      .onConflictDoNothing()
      .returning({ signature: walletWriteReceipts.signature });
    return inserted.length === 1;
  }

  async getSwapHistory(walletAddress: string, limit = 50): Promise<SwapHistoryItem[]> {
    return db
      .select()
      .from(swapHistory)
      .where(eq(swapHistory.walletAddress, walletAddress))
      .orderBy(desc(swapHistory.createdAt))
      .limit(limit);
  }

  async saveSwapHistory(data: InsertSwapHistory): Promise<SwapHistoryItem> {
    const [item] = await db.insert(swapHistory).values(data).returning();
    return item;
  }

  async getRecentSwaps(limit = 1000): Promise<SwapHistoryItem[]> {
    return db
      .select()
      .from(swapHistory)
      .where(eq(swapHistory.status, "success"))
      .orderBy(desc(swapHistory.createdAt))
      .limit(limit);
  }

  async getTrendingTokens(): Promise<{
    mint: string; symbol: string; name: string; image: string | null;
    chats: number; bumps: number; score: number;
  }[]> {
    const [chatRows, bumpRows] = await Promise.all([
      db
        .select({ mint: comments.taggedMint, c: drizzleSql<number>`count(*)::int` })
        .from(comments)
        .groupBy(comments.taggedMint),
      db
        .select({
          mint: bumpHistory.mint,
          c: drizzleSql<number>`count(*)::int`,
          symbol: drizzleSql<string | null>`max(${bumpHistory.tokenSymbol})`,
        })
        .from(bumpHistory)
        .where(eq(bumpHistory.status, "success"))
        .groupBy(bumpHistory.mint),
    ]);

    type Agg = { mint: string; symbol: string; name: string; image: string | null; chats: number; bumps: number };
    const map = new Map<string, Agg>();
    const isValidMint = (m: string | null | undefined): m is string =>
      !!m && m !== "NONE" && m.length >= 32;
    const get = (mint: string): Agg => {
      let a = map.get(mint);
      if (!a) {
        a = { mint, symbol: "", name: "", image: null, chats: 0, bumps: 0 };
        map.set(mint, a);
      }
      return a;
    };

    for (const r of chatRows) {
      if (!isValidMint(r.mint)) continue;
      get(r.mint).chats += Number(r.c) || 0;
    }
    for (const r of bumpRows) {
      if (!isValidMint(r.mint)) continue;
      const a = get(r.mint);
      a.bumps += Number(r.c) || 0;
      if (!a.symbol && r.symbol) a.symbol = r.symbol;
    }

    return Array.from(map.values())
      .map((a) => ({ ...a, score: a.chats * 2 + a.bumps }))
      .filter((a) => a.score > 0)
      .sort((x, y) => y.score - x.score)
      .slice(0, 30);
  }

  async getBumpHistory(ownerWallet: string, limit = 200): Promise<BumpHistoryItem[]> {
    return db
      .select()
      .from(bumpHistory)
      .where(eq(bumpHistory.ownerWallet, ownerWallet))
      .orderBy(desc(bumpHistory.createdAt))
      .limit(limit);
  }

  async saveBumpHistory(data: InsertBumpHistory): Promise<BumpHistoryItem> {
    const [item] = await db.insert(bumpHistory).values(data).returning();
    return item;
  }

  async getBumpDelegation(ownerWallet: string, sessionWallet: string): Promise<BumpDelegation | undefined> {
    const [row] = await db
      .select()
      .from(bumpHistoryDelegations)
      .where(and(
        eq(bumpHistoryDelegations.ownerWallet, ownerWallet),
        eq(bumpHistoryDelegations.sessionWallet, sessionWallet),
      ))
      .limit(1);
    return row;
  }

  async saveBumpDelegation(data: InsertBumpDelegation): Promise<BumpDelegation> {
    // Idempotent: re-attesting the same (owner, session) pair just updates the
    // signature/nonce/delegator fields rather than failing the unique index.
    const [row] = await db
      .insert(bumpHistoryDelegations)
      .values(data)
      .onConflictDoUpdate({
        target: [bumpHistoryDelegations.ownerWallet, bumpHistoryDelegations.sessionWallet],
        set: {
          delegatorWallet: data.delegatorWallet,
          signature:       data.signature,
          nonce:           data.nonce,
        },
      })
      .returning();
    return row;
  }

  // Atomically count distinct sub-wallets under an owner and insert/upsert the
  // requested delegation in a single serializable transaction. This is the
  // fail-closed, race-safe replacement for "count then insert" in the route
  // layer — two concurrent requests on the same owner can no longer both pass
  // the cap check and double-insert. Returns `{ row }` on success or
  // `{ exceeded: true, cap, currentCount }` if adding this sub would exceed
  // `maxSubwallets`. Re-attesting an already-registered (owner, session) pair
  // is always allowed and does not consume a cap slot.
  async saveBumpDelegationWithCap(
    data: InsertBumpDelegation,
    maxSubwallets: number,
  ): Promise<
    | { row: BumpDelegation; exceeded?: false }
    | { exceeded: true; cap: number; currentCount: number }
  > {
    return db.transaction(async (tx) => {
      // Lock all rows for this owner so concurrent inserts serialize.
      const existing = await tx
        .select()
        .from(bumpHistoryDelegations)
        .where(eq(bumpHistoryDelegations.ownerWallet, data.ownerWallet))
        .for("update");

      const isAlreadyRegistered = existing.some(
        (r) => r.sessionWallet === data.sessionWallet,
      );
      const distinctSubs = new Set(
        existing
          .map((r) => r.sessionWallet)
          .filter((w) => w !== data.ownerWallet),
      );

      if (!isAlreadyRegistered) {
        const wouldBeCount =
          distinctSubs.size +
          (data.sessionWallet !== data.ownerWallet ? 1 : 0);
        if (wouldBeCount > maxSubwallets) {
          return {
            exceeded: true as const,
            cap: maxSubwallets,
            currentCount: distinctSubs.size,
          };
        }
      }

      const [row] = await tx
        .insert(bumpHistoryDelegations)
        .values(data)
        .onConflictDoUpdate({
          target: [
            bumpHistoryDelegations.ownerWallet,
            bumpHistoryDelegations.sessionWallet,
          ],
          set: {
            delegatorWallet: data.delegatorWallet,
            signature: data.signature,
            nonce: data.nonce,
          },
        })
        .returning();
      return { row };
    });
  }

  async getOwnerBumpDelegations(ownerWallet: string): Promise<BumpDelegation[]> {
    return db
      .select()
      .from(bumpHistoryDelegations)
      .where(eq(bumpHistoryDelegations.ownerWallet, ownerWallet));
  }

  // Pure read of the wallet's bump-credit balance. Never creates a row — the
  // free trial must be claimed explicitly via claimFreeTrial() (which is gated
  // by an owner signature in the route layer). Without this separation, an
  // unauthenticated GET could be sprayed across millions of addresses to mint
  // trial credits.
  async getCreditBalance(ownerWallet: string): Promise<{ balance: number; unlimitedSubwallets: boolean; unlimitedUntil: string | null; maxSubwallets: number }> {
    const [existing] = await db
      .select()
      .from(bumpCredits)
      .where(eq(bumpCredits.ownerWallet, ownerWallet))
      .limit(1);
    if (!existing) return { balance: 0, unlimitedSubwallets: false, unlimitedUntil: null, maxSubwallets: 0 };
    const until = existing.unlimitedUntil;
    const untilIso = until ? new Date(until).toISOString() : null;
    const unlimitedActive = !!until && new Date(until).getTime() > Date.now();
    // Effective unlimited-subwallets = stored flag OR active time-window.
    // While an unlimited window is active, also lift the sub-wallet cap to
    // the absolute ceiling so 48h-Unlimited buyers always get the full 50
    // even if they previously sat on a lower stored cap.
    const effectiveMax = unlimitedActive
      ? Math.max(existing.maxSubwallets, ABSOLUTE_MAX_SUBWALLETS)
      : existing.maxSubwallets;
    return {
      balance: existing.balance,
      unlimitedSubwallets: existing.unlimitedSubwallets || unlimitedActive,
      unlimitedUntil: untilIso,
      maxSubwallets: effectiveMax,
    };
  }

  // Grants FREE_TRIAL_CREDITS to a wallet exactly once (the unique
  // constraint on owner_wallet + free_granted=true makes a replay a no-op).
  // The route layer must verify ed25519 ownership before calling this.
  async claimFreeTrial(ownerWallet: string): Promise<{ balance: number; unlimitedSubwallets: boolean; unlimitedUntil: string | null; maxSubwallets: number; granted: boolean }> {
    const [row] = await db
      .insert(bumpCredits)
      .values({
        ownerWallet,
        balance: FREE_TRIAL_CREDITS,
        unlimitedSubwallets: false,
        maxSubwallets: FREE_TRIAL_MAX_SUBWALLETS,
        freeGranted: true,
      })
      .onConflictDoNothing({ target: bumpCredits.ownerWallet })
      .returning();
    if (row) return { balance: row.balance, unlimitedSubwallets: row.unlimitedSubwallets, unlimitedUntil: null, maxSubwallets: row.maxSubwallets, granted: true };
    const cur = await this.getCreditBalance(ownerWallet);
    return { ...cur, granted: false };
  }

  // Atomically debit one bump. Two paths in a single SQL statement:
  //  (a) if unlimited_until > NOW(), the bump is "free" (no balance change),
  //  (b) otherwise decrement balance by 1 if balance > 0.
  // Single UPDATE … WHERE … RETURNING means concurrent bump fires cannot
  // both succeed when only one credit is left. Returns whether the call was
  // satisfied by an active unlimited window so the bot can show the right UI.
  async decrementCredit(ownerWallet: string): Promise<{ ok: boolean; balance: number; unlimitedActive: boolean }> {
    const result = await db.execute(drizzleSql`
      UPDATE bump_credits
         SET balance    = CASE
                            WHEN unlimited_until IS NOT NULL AND unlimited_until > NOW()
                              THEN balance
                            ELSE balance - 1
                          END,
             updated_at = NOW()
       WHERE owner_wallet = ${ownerWallet}
         AND ( (unlimited_until IS NOT NULL AND unlimited_until > NOW())
               OR balance > 0 )
       RETURNING balance,
                 (unlimited_until IS NOT NULL AND unlimited_until > NOW()) AS unlimited_active
    `);
    const row: any = (result as any).rows?.[0];
    if (row) {
      return {
        ok: true,
        balance: Number(row.balance),
        unlimitedActive: row.unlimited_active === true || row.unlimited_active === "t" || row.unlimited_active === "true",
      };
    }
    const current = await this.getCreditBalance(ownerWallet);
    return { ok: false, balance: current.balance, unlimitedActive: false };
  }

  async getAccessPass(ownerWallet: string) {
    const [row] = await db.select().from(accessPasses)
      .where(eq(accessPasses.ownerWallet, ownerWallet)).limit(1);
    const trialStartedAt = row?.trialStartedAt ? new Date(row.trialStartedAt).toISOString() : null;
    const passExpiresAt = row?.passExpiresAt ? new Date(row.passExpiresAt).toISOString() : null;
    const now = Date.now();
    const trialActive = !!row?.trialStartedAt &&
      new Date(row.trialStartedAt).getTime() + 3 * 24 * 60 * 60 * 1000 > now;
    const paidActive = !!row?.passExpiresAt && new Date(row.passExpiresAt).getTime() > now;
    return { trialStartedAt, passExpiresAt, active: trialActive || paidActive, trialActive, paidActive };
  }

  async startAccessTrial(ownerWallet: string) {
    const [row] = await db.insert(accessPasses).values({
      ownerWallet,
      trialStartedAt: new Date(),
    }).onConflictDoNothing({ target: accessPasses.ownerWallet }).returning();
    const current = await this.getAccessPass(ownerWallet);
    return { ...current, granted: !!row };
  }

  async getAccessPassPurchaseBySignature(txSignature: string) {
    const [row] = await db.select().from(accessPassPurchases)
      .where(eq(accessPassPurchases.txSignature, txSignature)).limit(1);
    return row;
  }

  async recordAccessPassPurchase(args: {
    ownerWallet: string;
    passId: string;
    lamportsPaid: bigint;
    durationMs: number;
    txSignature: string;
  }) {
    return db.transaction(async (tx) => {
      const [purchase] = await tx.insert(accessPassPurchases).values({
        ownerWallet: args.ownerWallet,
        passId: args.passId,
        lamportsPaid: args.lamportsPaid.toString(),
        durationMs: String(args.durationMs),
        txSignature: args.txSignature,
      }).returning();
      const seconds = Math.floor(args.durationMs / 1000);
      const [updated] = await tx.insert(accessPasses).values({
        ownerWallet: args.ownerWallet,
        passExpiresAt: new Date(Date.now() + args.durationMs),
      }).onConflictDoUpdate({
        target: accessPasses.ownerWallet,
        set: {
          passExpiresAt: drizzleSql`GREATEST(NOW(), COALESCE(${accessPasses.passExpiresAt}, NOW())) + (${seconds} || ' seconds')::interval`,
          updatedAt: new Date(),
        },
      }).returning();
      return {
        purchase,
        passExpiresAt: updated.passExpiresAt
          ? new Date(updated.passExpiresAt).toISOString()
          : new Date(Date.now() + args.durationMs).toISOString(),
      };
    });
  }

  async getBuybackStats(chain: string = "solana"): Promise<{
    entryCount: number;
    totalRevenueLamports: string;
    totalAllocatedLamports: string;
    totalPendingLamports: string;
    totalExecutedLamports: string;
    firstAt: string | null;
    lastAt: string | null;
  }> {
    // Single round-trip aggregate. Lamport columns are TEXT (to dodge JS
    // bigint precision loss) so we cast to NUMERIC server-side, sum, then
    // hand back strings — preserves precision past 2^53.
    const result = await db.execute<{
      entry_count: string;
      total_revenue: string | null;
      total_allocated: string | null;
      total_pending: string | null;
      total_executed: string | null;
      first_at: Date | null;
      last_at: Date | null;
    }>(drizzleSql`
      SELECT
        COUNT(*)::text                                                                   AS entry_count,
        COALESCE(SUM(lamports_revenue::numeric), 0)::text                                AS total_revenue,
        COALESCE(SUM(lamports_allocated::numeric), 0)::text                              AS total_allocated,
        COALESCE(SUM(CASE WHEN status = 'pending'  THEN lamports_allocated::numeric ELSE 0 END), 0)::text AS total_pending,
        COALESCE(SUM(CASE WHEN status = 'executed' THEN lamports_allocated::numeric ELSE 0 END), 0)::text AS total_executed,
        MIN(created_at)                                                                  AS first_at,
        MAX(created_at)                                                                  AS last_at
      FROM buyback_ledger
      WHERE chain = ${chain}
    `);
    // db.execute returns { rows: [...] } in neon-serverless / pg drivers.
    // Fall back to treating result as iterable for older driver shapes.
    const row = (result as any)?.rows?.[0] ?? (Array.isArray(result) ? result[0] : undefined);
    return {
      entryCount:             parseInt(row?.entry_count ?? "0", 10),
      totalRevenueLamports:   row?.total_revenue   ?? "0",
      totalAllocatedLamports: row?.total_allocated ?? "0",
      totalPendingLamports:   row?.total_pending   ?? "0",
      totalExecutedLamports:  row?.total_executed  ?? "0",
      firstAt: row?.first_at ? new Date(row.first_at).toISOString() : null,
      lastAt:  row?.last_at  ? new Date(row.last_at).toISOString()  : null,
    };
  }

  async getPendingBuybackRows(limit: number, chain: string = "solana") {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit) || 200));
    const rows = await db
      .select({
        id:                buybackLedger.id,
        lamportsAllocated: buybackLedger.lamportsAllocated,
        createdAt:         buybackLedger.createdAt,
      })
      .from(buybackLedger)
      .where(and(
        eq(buybackLedger.status, "pending"),
        eq(buybackLedger.chain, chain),
      ))
      .orderBy(buybackLedger.createdAt) // oldest-first so FIFO settlement
      .limit(safeLimit);
    return rows.map(r => ({
      id: r.id,
      lamportsAllocated: r.lamportsAllocated,
      createdAt: new Date(r.createdAt).toISOString(),
    }));
  }

  async getBuybackRowsByIds(ids: string[]) {
    if (!ids.length) return [];
    // Use drizzle's `inArray` instead of a raw `ANY(${ids}::text[])` cast.
    // The raw cast was triggering "malformed array literal" in production
    // because the pg driver was serializing the JS array as a bare string
    // rather than a Postgres array. inArray expands to a parameterised
    // IN ($1, $2, ...) clause that all driver versions handle identically.
    const rows = await db
      .select({
        id:                buybackLedger.id,
        lamportsAllocated: buybackLedger.lamportsAllocated,
        status:            buybackLedger.status,
      })
      .from(buybackLedger)
      .where(inArray(buybackLedger.id, ids));
    return rows.map(r => ({
      id: r.id,
      lamportsAllocated: r.lamportsAllocated,
      status: r.status,
    }));
  }

  async getBuybackRowByExecutionSignature(signature: string) {
    const rows = await db
      .select({ id: buybackLedger.id })
      .from(buybackLedger)
      .where(eq(buybackLedger.executionTxSignature, signature))
      .limit(1);
    return rows[0];
  }

  async recordManualBuyback(args: {
    ownerWallet: string;
    lamportsSpent: bigint;
    txSignature: string;
    notes?: string;
    chain?: string;
  }) {
    const [row] = await db
      .insert(buybackLedger)
      .values({
        chain:                args.chain ?? "solana",
        sourceType:           "manual_buyback",
        sourceId:             args.txSignature,
        ownerWallet:          args.ownerWallet,
        lamportsRevenue:      "0",
        allocationBps:        0,
        lamportsAllocated:    args.lamportsSpent.toString(),
        status:               "executed",
        executedAt:           new Date(),
        executionTxSignature: args.txSignature,
        notes:                args.notes ?? null,
      })
      .returning({ id: buybackLedger.id });
    return row;
  }

  async markBuybackRowsExecuted(ids: string[], txSignature: string, notes?: string) {
    if (!ids.length) return 0;
    // Single UPDATE so all rows flip atomically. The `status = 'pending'`
    // guard prevents two concurrent admin clicks from each marking the same
    // rows (whichever lands second updates 0 rows and we surface that to
    // the caller).
    // Use drizzle's update + inArray (avoids the "malformed array literal"
    // error the raw `ANY(${ids}::text[])` form produced under some pg drivers).
    const updated = await db
      .update(buybackLedger)
      .set({
        status:               "executed",
        executedAt:           new Date(),
        executionTxSignature: txSignature,
        ...(notes !== undefined ? { notes } : {}),
      })
      .where(and(
        inArray(buybackLedger.id, ids),
        eq(buybackLedger.status, "pending"),
      ))
      .returning({ id: buybackLedger.id });
    return updated.length;
  }

  async createBuybackIntent(intent: {
    nonce: string;
    rowIds: string[];
    expectedLamports: string;
    treasury: string;
    ttlMs: number;
    chain?: string;
  }): Promise<void> {
    await db.insert(buybackExecutionIntents).values({
      nonce: intent.nonce,
      chain: intent.chain ?? "solana",
      rowIds: intent.rowIds,
      expectedLamports: intent.expectedLamports,
      treasury: intent.treasury,
      expiresAt: new Date(Date.now() + intent.ttlMs),
    });
  }

  async getBuybackIntent(nonce: string) {
    const rows = await db
      .select()
      .from(buybackExecutionIntents)
      .where(eq(buybackExecutionIntents.nonce, nonce))
      .limit(1);
    const r = rows[0];
    if (!r) return undefined;
    return {
      nonce: r.nonce,
      chain: r.chain,
      rowIds: r.rowIds,
      expectedLamports: r.expectedLamports,
      treasury: r.treasury,
      expiresAt: new Date(r.expiresAt).toISOString(),
      consumedAt: r.consumedAt ? new Date(r.consumedAt).toISOString() : null,
    };
  }

  async consumeBuybackIntent(nonce: string, signature: string): Promise<boolean> {
    // Atomic single UPDATE — guards against double-consume by the same
    // operator clicking twice or by a race with /execute retries.
    const result = await db.execute<{ nonce: string }>(drizzleSql`
      UPDATE buyback_execution_intents
      SET consumed_at = NOW(),
          consumed_tx_signature = ${signature}
      WHERE nonce = ${nonce}
        AND consumed_at IS NULL
      RETURNING nonce
    `);
    const updated = (result as any)?.rows ?? (Array.isArray(result) ? result : []);
    return updated.length > 0;
  }

  async consumeIntentAndMarkRows(args: {
    nonce: string;
    signature: string;
    rowIds: string[];
    notes: string;
  }): Promise<number> {
    const { nonce, signature, rowIds, notes } = args;
    if (!rowIds.length) throw new Error("consumeIntentAndMarkRows: rowIds is empty");
    return await db.transaction(async (tx) => {
      // Atomic intent consume (race-safe via the `consumed_at IS NULL` guard).
      const consumeRes = await tx.execute<{ nonce: string }>(drizzleSql`
        UPDATE buyback_execution_intents
        SET consumed_at = NOW(),
            consumed_tx_signature = ${signature}
        WHERE nonce = ${nonce}
          AND consumed_at IS NULL
        RETURNING nonce
      `);
      const consumed = ((consumeRes as any)?.rows ?? []).length > 0;
      if (!consumed) {
        throw new Error("Intent was consumed by a concurrent request.");
      }
      // Mark every ledger row executed. Returning rows let us assert that we
      // actually updated each rowId; anything less means a row flipped state
      // between intent creation and execute and we must roll back.
      // Use drizzle's update + inArray (the raw `ANY(${rowIds}::text[])`
      // cast was throwing "malformed array literal" under some pg drivers).
      const markRes = await tx
        .update(buybackLedger)
        .set({
          status:               "executed",
          executedAt:           new Date(),
          executionTxSignature: signature,
          notes,
        })
        .where(and(
          inArray(buybackLedger.id, rowIds),
          eq(buybackLedger.status, "pending"),
        ))
        .returning({ id: buybackLedger.id });
      const marked = markRes.length;
      if (marked !== rowIds.length) {
        throw new Error(
          `Expected to mark ${rowIds.length} rows, only marked ${marked} — rolling back. ` +
          `One or more rows were already executed or removed.`,
        );
      }
      return marked;
    });
  }

  async getRecentBuybackEntries(limit: number, chain: string = "solana") {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit) || 25));
    const rows = await db
      .select({
        id:                   buybackLedger.id,
        sourceType:           buybackLedger.sourceType,
        lamportsRevenue:      buybackLedger.lamportsRevenue,
        allocationBps:        buybackLedger.allocationBps,
        lamportsAllocated:    buybackLedger.lamportsAllocated,
        status:               buybackLedger.status,
        createdAt:            buybackLedger.createdAt,
        executedAt:           buybackLedger.executedAt,
        executionTxSignature: buybackLedger.executionTxSignature,
      })
      .from(buybackLedger)
      .where(eq(buybackLedger.chain, chain))
      .orderBy(desc(buybackLedger.createdAt))
      .limit(safeLimit);
    return rows.map(r => ({
      id:                   r.id,
      sourceType:           r.sourceType,
      lamportsRevenue:      r.lamportsRevenue,
      allocationBps:        r.allocationBps,
      lamportsAllocated:    r.lamportsAllocated,
      status:               r.status,
      createdAt:            new Date(r.createdAt).toISOString(),
      executedAt:           r.executedAt ? new Date(r.executedAt).toISOString() : null,
      executionTxSignature: r.executionTxSignature,
    }));
  }

  async getCreditPurchaseBySignature(txSignature: string): Promise<BumpCreditPurchase | undefined> {
    const [row] = await db
      .select()
      .from(bumpCreditPurchases)
      .where(eq(bumpCreditPurchases.txSignature, txSignature))
      .limit(1);
    return row;
  }

  // Records the purchase row + grants credits in a single transaction. The
  // unique constraint on tx_signature makes this idempotent even under retry
  // — a second call with the same signature throws and we leave the balance
  // untouched.
  async recordCreditPurchaseAndGrant(args: {
    ownerWallet: string;
    packId: string;
    lamportsPaid: bigint;
    creditsToGrant: number;
    grantUnlimitedSubwallets: boolean;
    grantMaxSubwallets: number;
    extendUnlimitedMs?: number;
    txSignature: string;
  }): Promise<{ purchase: BumpCreditPurchase; balance: number; unlimitedSubwallets: boolean; unlimitedUntil: string | null; maxSubwallets: number }> {
    return db.transaction(async (tx) => {
      const [purchase] = await tx
        .insert(bumpCreditPurchases)
        .values({
          ownerWallet:                 args.ownerWallet,
          packId:                      args.packId,
          lamportsPaid:                args.lamportsPaid.toString(),
          creditsGranted:              args.creditsToGrant,
          unlimitedSubwalletsGranted:  args.grantUnlimitedSubwallets,
          txSignature:                 args.txSignature,
        })
        .returning();

      // Record the buyback allocation slice in the same transaction so the
      // public /buyback ledger is always perfectly in sync with revenue —
      // no row in bump_credit_purchases without its companion row here.
      const allocationBps = BUYBACK_ALLOCATION_BPS;
      const allocatedLamports = (args.lamportsPaid * BigInt(allocationBps)) / BigInt(10_000);
      await tx.insert(buybackLedger).values({
        sourceType:        "credit_purchase",
        sourceId:          purchase.id,
        ownerWallet:       args.ownerWallet,
        lamportsRevenue:   args.lamportsPaid.toString(),
        allocationBps,
        lamportsAllocated: allocatedLamports.toString(),
        status:            "pending",
      });
      // Extend the unlimited window: GREATEST(now, current expiry) + interval.
      // Stacks correctly when buying back-to-back during an active window.
      const extendMs = args.extendUnlimitedMs ?? 0;
      const seconds = Math.floor(extendMs / 1000);
      const unlimitedUntilExpr = extendMs > 0
        ? drizzleSql`GREATEST(NOW(), COALESCE(${bumpCredits.unlimitedUntil}, NOW())) + (${seconds} || ' seconds')::interval`
        : bumpCredits.unlimitedUntil;
      const [updated] = await tx
        .insert(bumpCredits)
        .values({
          ownerWallet:           args.ownerWallet,
          balance:               args.creditsToGrant,
          unlimitedSubwallets:   args.grantUnlimitedSubwallets,
          maxSubwallets:         args.grantMaxSubwallets,
          // For brand-new rows we patch unlimited_until below — drizzle
          // .values() can't take a SQL expression here.
          freeGranted:           true,
        })
        .onConflictDoUpdate({
          target: bumpCredits.ownerWallet,
          set: {
            balance:             drizzleSql`${bumpCredits.balance} + ${args.creditsToGrant}`,
            unlimitedSubwallets: drizzleSql`${bumpCredits.unlimitedSubwallets} OR ${args.grantUnlimitedSubwallets}`,
            // Always take the higher of (current cap, this pack's cap) — buying
            // a smaller pack after a bigger one must NOT downgrade entitlement.
            maxSubwallets:       drizzleSql`GREATEST(${bumpCredits.maxSubwallets}, ${args.grantMaxSubwallets})`,
            unlimitedUntil:      unlimitedUntilExpr,
            updatedAt:           drizzleSql`NOW()`,
          },
        })
        .returning();
      // First-purchase patch: if the row was just inserted (no prior unlimited
      // expiry) and the pack carries an unlimited window, set it now. Same tx,
      // so still atomic.
      let finalRow = updated;
      if (extendMs > 0 && updated.unlimitedUntil === null) {
        const [patched] = await tx
          .update(bumpCredits)
          .set({
            unlimitedUntil: drizzleSql`NOW() + (${seconds} || ' seconds')::interval` as any,
            updatedAt:      drizzleSql`NOW()`,
          })
          .where(eq(bumpCredits.ownerWallet, args.ownerWallet))
          .returning();
        finalRow = patched;
      }
      const untilIso = finalRow.unlimitedUntil ? new Date(finalRow.unlimitedUntil).toISOString() : null;
      const unlimitedActive = !!finalRow.unlimitedUntil && new Date(finalRow.unlimitedUntil).getTime() > Date.now();
      const effectiveMax = unlimitedActive
        ? Math.max(finalRow.maxSubwallets, ABSOLUTE_MAX_SUBWALLETS)
        : finalRow.maxSubwallets;
      return {
        purchase,
        balance:             finalRow.balance,
        unlimitedSubwallets: finalRow.unlimitedSubwallets || unlimitedActive,
        unlimitedUntil:      untilIso,
        maxSubwallets:       effectiveMax,
      };
    });
  }

  /**
   * Return every distinct session wallet pubkey that has ever signed a bump
   * trade under this main wallet, with per-wallet activity stats. Used by
   * the bump-bot "Platform Holdings" panel so users can see EVERY wallet
   * they've ever traded from — even old session wallets whose encrypted
   * keys have been overwritten on this device by a later regenerate.
   *
   * Note: bumpCount counts ALL bumps (success + failed). The frontend
   * pairs each pubkey with an on-chain balance lookup; even if the local
   * key is gone, a non-zero on-chain balance lets the user know funds
   * exist there (recoverable only by importing the key from a backup).
   */
  async getDistinctSessionWalletsForOwner(ownerWallet: string) {
    const result = await db.execute(drizzleSql`
      SELECT session_wallet,
             COUNT(*)::int     AS bump_count,
             MIN(created_at)   AS first_at,
             MAX(created_at)   AS last_at
      FROM bump_history
      WHERE owner_wallet = ${ownerWallet}
      GROUP BY session_wallet
      ORDER BY MAX(created_at) DESC
    `);
    const rows: any[] = (result as any).rows ?? [];
    return rows.map(r => ({
      sessionWallet: String(r.session_wallet),
      bumpCount:     Number(r.bump_count ?? 0),
      firstAt:       new Date(r.first_at).toISOString(),
      lastAt:        new Date(r.last_at).toISOString(),
    }));
  }

  async getBumpHistoryStats(ownerWallet: string) {
    const result = await db.execute(drizzleSql`
      SELECT
        COUNT(*)::int                                                  AS total,
        COUNT(*) FILTER (WHERE status = 'success')::int                AS success,
        COUNT(*) FILTER (WHERE status = 'failed')::int                 AS failed,
        COALESCE(SUM(amount_sol) FILTER (WHERE status = 'success'), 0) AS sol_spent,
        MIN(created_at) AS first_at,
        MAX(created_at) AS last_at
      FROM bump_history
      WHERE owner_wallet = ${ownerWallet}
    `);
    const row: any = (result as any).rows?.[0] ?? {};
    return {
      totalBumps:    Number(row.total ?? 0),
      totalSuccess:  Number(row.success ?? 0),
      totalFailed:   Number(row.failed ?? 0),
      totalSolSpent: Number(row.sol_spent ?? 0),
      firstAt:       row.first_at ? new Date(row.first_at).toISOString() : null,
      lastAt:        row.last_at  ? new Date(row.last_at).toISOString()  : null,
    };
  }

  // ─── Community buybacks (multi-tenant) ───────────────────────────────────
  async createCommunityBuyback(data: {
    chain?: string;
    slug: string;
    ownerWallet: string;
    tokenMint: string;
    tokenSymbol: string;
    tokenName: string;
    treasuryWallet: string;
    description: string | null;
  }): Promise<CommunityBuyback> {
    const [row] = await db.insert(communityBuybacks).values({
      ...data,
      chain: data.chain ?? "solana",
    }).returning();
    return row;
  }

  async listCommunityBuybacks(limit = 50) {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit) || 50));
    // LEFT JOIN-style aggregate so brand-new tenants with zero entries still
    // appear (entry_count = 0). Lamport sum stays in NUMERIC server-side then
    // returned as text to preserve precision past 2^53.
    const result = await db.execute<{
      id: string;
      slug: string;
      owner_wallet: string;
      token_mint: string;
      token_symbol: string;
      token_name: string;
      treasury_wallet: string;
      description: string | null;
      created_at: Date;
      entry_count: string;
      total_lamports_spent: string;
      last_at: Date | null;
    }>(drizzleSql`
      SELECT
        t.id, t.chain, t.slug, t.owner_wallet, t.token_mint, t.token_symbol, t.token_name,
        t.treasury_wallet, t.description, t.created_at,
        COALESCE(COUNT(e.id), 0)::text                                AS entry_count,
        COALESCE(SUM(e.lamports_spent::numeric), 0)::text             AS total_lamports_spent,
        MAX(e.created_at)                                             AS last_at
      FROM community_buybacks t
      LEFT JOIN community_buyback_entries e ON e.tenant_id = t.id
      GROUP BY t.id
      ORDER BY t.created_at DESC
      LIMIT ${safeLimit}
    `);
    const rows = (result as any)?.rows ?? (Array.isArray(result) ? result : []);
    return rows.map((r: any) => ({
      id: r.id,
      chain: r.chain ?? "solana",
      slug: r.slug,
      ownerWallet: r.owner_wallet,
      tokenMint: r.token_mint,
      tokenSymbol: r.token_symbol,
      tokenName: r.token_name,
      treasuryWallet: r.treasury_wallet,
      description: r.description,
      createdAt: new Date(r.created_at),
      entryCount: parseInt(r.entry_count ?? "0", 10),
      totalLamportsSpent: r.total_lamports_spent ?? "0",
      lastAt: r.last_at ? new Date(r.last_at).toISOString() : null,
    }));
  }

  async getCommunityBuybackBySlug(slug: string) {
    const [row] = await db.select().from(communityBuybacks).where(eq(communityBuybacks.slug, slug)).limit(1);
    return row;
  }

  async getCommunityBuybackByMint(mint: string) {
    const [row] = await db.select().from(communityBuybacks).where(eq(communityBuybacks.tokenMint, mint)).limit(1);
    return row;
  }

  async getCommunityBuybackEntryBySignature(signature: string) {
    const [row] = await db
      .select({ id: communityBuybackEntries.id })
      .from(communityBuybackEntries)
      .where(eq(communityBuybackEntries.txSignature, signature))
      .limit(1);
    return row;
  }

  async recordCommunityManualBuyback(data: {
    tenantId: string;
    lamportsSpent: string;
    tokensReceivedRaw: string;
    txSignature: string;
    notes: string;
    chain?: string;
  }) {
    const [row] = await db
      .insert(communityBuybackEntries)
      .values({
        tenantId: data.tenantId,
        chain: data.chain ?? "solana",
        sourceType: "manual_buyback",
        lamportsSpent: data.lamportsSpent,
        tokensReceivedRaw: data.tokensReceivedRaw,
        txSignature: data.txSignature,
        notes: data.notes,
      })
      .returning({ id: communityBuybackEntries.id });
    return row;
  }

  async getCommunityBuybackStats(tenantId: string) {
    // Lamport / token sums: text columns cast to numeric server-side, summed,
    // returned as text — preserves precision past 2^53 the same way the PAIF
    // ledger stats do.
    const result = await db.execute<{
      entry_count: string;
      total_lamports_spent: string;
      total_tokens_received: string;
      first_at: Date | null;
      last_at: Date | null;
    }>(drizzleSql`
      SELECT
        COUNT(*)::text                                            AS entry_count,
        COALESCE(SUM(lamports_spent::numeric), 0)::text           AS total_lamports_spent,
        COALESCE(SUM(tokens_received_raw::numeric), 0)::text      AS total_tokens_received,
        MIN(created_at)                                           AS first_at,
        MAX(created_at)                                           AS last_at
      FROM community_buyback_entries
      WHERE tenant_id = ${tenantId}
    `);
    const row = (result as any)?.rows?.[0] ?? (Array.isArray(result) ? result[0] : undefined);
    return {
      entryCount: parseInt(row?.entry_count ?? "0", 10),
      totalLamportsSpent: row?.total_lamports_spent ?? "0",
      totalTokensReceivedRaw: row?.total_tokens_received ?? "0",
      firstAt: row?.first_at ? new Date(row.first_at).toISOString() : null,
      lastAt:  row?.last_at  ? new Date(row.last_at).toISOString()  : null,
    };
  }

  async getCommunityBuybackEntries(tenantId: string, limit = 25) {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit) || 25));
    return await db
      .select()
      .from(communityBuybackEntries)
      .where(eq(communityBuybackEntries.tenantId, tenantId))
      .orderBy(desc(communityBuybackEntries.createdAt))
      .limit(safeLimit);
  }

  async createCommunityBuybackIntent(intent: {
    nonce: string;
    tenantId: string;
    treasury: string;
    tokenMint: string;
    expectedLamports: string;
    ttlMs: number;
    chain?: string;
  }): Promise<void> {
    await db.insert(communityBuybackIntents).values({
      nonce: intent.nonce,
      tenantId: intent.tenantId,
      chain: intent.chain ?? "solana",
      treasury: intent.treasury,
      tokenMint: intent.tokenMint,
      expectedLamports: intent.expectedLamports,
      expiresAt: new Date(Date.now() + intent.ttlMs),
    });
  }

  async getCommunityBuybackIntent(nonce: string) {
    const rows = await db
      .select()
      .from(communityBuybackIntents)
      .where(eq(communityBuybackIntents.nonce, nonce))
      .limit(1);
    const r = rows[0];
    if (!r) return undefined;
    return {
      nonce: r.nonce,
      tenantId: r.tenantId,
      chain: r.chain,
      treasury: r.treasury,
      tokenMint: r.tokenMint,
      expectedLamports: r.expectedLamports,
      expiresAt: new Date(r.expiresAt).toISOString(),
      consumedAt: r.consumedAt ? new Date(r.consumedAt).toISOString() : null,
    };
  }

  async consumeCommunityIntentAndRecord(args: {
    nonce: string;
    tenantId: string;
    txSignature: string;
    lamportsSpent: string;
    tokensReceivedRaw: string;
    notes: string;
    chain?: string;
  }): Promise<{ id: string }> {
    const { nonce, tenantId, txSignature, lamportsSpent, tokensReceivedRaw, notes } = args;
    return await db.transaction(async (tx) => {
      const consumeRes = await tx.execute<{ nonce: string }>(drizzleSql`
        UPDATE community_buyback_intents
        SET consumed_at = NOW(),
            consumed_tx_signature = ${txSignature}
        WHERE nonce = ${nonce}
          AND consumed_at IS NULL
        RETURNING nonce
      `);
      const consumed = ((consumeRes as any)?.rows ?? []).length > 0;
      if (!consumed) {
        throw new Error("Intent was already consumed by a concurrent request.");
      }
      const [row] = await tx
        .insert(communityBuybackEntries)
        .values({
          tenantId,
          chain: args.chain ?? "solana",
          sourceType: "executed_swap",
          lamportsSpent,
          tokensReceivedRaw,
          txSignature,
          notes,
        })
        .returning({ id: communityBuybackEntries.id });
      return row;
    });
  }

  // ─── Automated Strategy Bot ──────────────────────────────────────────────
  async createAutoStrategy(data: {
    ownerWallet: string;
    tradingWallet: string;
    encryptedKey: string;
    withdrawAddress: string;
    name: string;
    budgetLamports: string;
    tokens: string[];
    allocationsBps: number[];
    mode: string;
    slippageBps: number;
    windowStartAt: Date;
    windowEndAt: Date;
    intervalSeconds: number;
    totalSlices: number;
    buySlices: number;
    walletCount?: number;
    extraWallets?: string[];
    extraEncryptedKeys?: string[];
    keepFunds?: boolean;
    takeProfitPct?: number | null;
    takeProfitSellBps?: number | null;
  }): Promise<AutoStrategy> {
    const [row] = await db.insert(autoStrategies).values({
      ownerWallet: data.ownerWallet,
      tradingWallet: data.tradingWallet,
      encryptedKey: data.encryptedKey,
      withdrawAddress: data.withdrawAddress,
      name: data.name,
      status: "awaiting_funds",
      budgetLamports: data.budgetLamports,
      spentLamports: "0",
      tokens: data.tokens,
      allocationsBps: data.allocationsBps,
      mode: data.mode,
      slippageBps: data.slippageBps,
      windowStartAt: data.windowStartAt,
      windowEndAt: data.windowEndAt,
      intervalSeconds: data.intervalSeconds,
      totalSlices: data.totalSlices,
      buySlices: data.buySlices,
      completedSlices: 0,
      walletCount: data.walletCount ?? 1,
      extraWallets: data.extraWallets ?? [],
      extraEncryptedKeys: data.extraEncryptedKeys ?? [],
      keepFunds: data.keepFunds ?? false,
      takeProfitPct: data.takeProfitPct ?? null,
      takeProfitSellBps: data.takeProfitSellBps ?? null,
    }).returning();
    return row;
  }

  async getAutoStrategy(id: string): Promise<AutoStrategy | undefined> {
    const [row] = await db.select().from(autoStrategies).where(eq(autoStrategies.id, id)).limit(1);
    return row;
  }

  async listAutoStrategiesByOwner(ownerWallet: string): Promise<AutoStrategy[]> {
    return await db
      .select()
      .from(autoStrategies)
      .where(eq(autoStrategies.ownerWallet, ownerWallet))
      .orderBy(desc(autoStrategies.createdAt));
  }

  async getDueAutoStrategies(now: Date): Promise<AutoStrategy[]> {
    return await db
      .select()
      .from(autoStrategies)
      .where(and(
        eq(autoStrategies.status, "active"),
        lte(autoStrategies.nextRunAt, now),
      ))
      .orderBy(asc(autoStrategies.nextRunAt))
      .limit(25);
  }

  async getArmedTakeProfitStrategies(): Promise<AutoStrategy[]> {
    return await db
      .select()
      .from(autoStrategies)
      .where(and(
        eq(autoStrategies.status, "active"),
        isNotNull(autoStrategies.takeProfitPct),
        isNull(autoStrategies.takeProfitFiredAt),
      ))
      .limit(50);
  }

  async updateAutoStrategy(id: string, patch: Partial<{
    status: string;
    spentLamports: string;
    completedSlices: number;
    nextRunAt: Date | null;
    encryptedKey: string;
    distributedAt: Date | null;
    setupFeePaidAt: Date | null;
    takeProfitFiredAt: Date | null;
  }>): Promise<AutoStrategy | undefined> {
    const [row] = await db
      .update(autoStrategies)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(autoStrategies.id, id))
      .returning();
    return row;
  }

  async claimAutoStrategySetupFee(id: string): Promise<boolean> {
    const rows = await db
      .update(autoStrategies)
      .set({ setupFeePaidAt: new Date(), updatedAt: new Date() })
      .where(and(eq(autoStrategies.id, id), isNull(autoStrategies.setupFeePaidAt)))
      .returning({ id: autoStrategies.id });
    return rows.length > 0;
  }

  // Atomic one-shot take-profit claim: sets takeProfitFiredAt only if it's still
  // null. Returns true to exactly ONE caller — the winner. Prevents a double-fire
  // if two ticks (or a multi-instance deploy) ever race the same strategy.
  async claimTakeProfitFire(id: string): Promise<boolean> {
    const rows = await db
      .update(autoStrategies)
      .set({ takeProfitFiredAt: new Date(), updatedAt: new Date() })
      .where(and(eq(autoStrategies.id, id), isNull(autoStrategies.takeProfitFiredAt)))
      .returning({ id: autoStrategies.id });
    return rows.length > 0;
  }

  async addAutoStrategyExecution(data: {
    strategyId: string;
    tokenMint: string;
    action: string;
    amountLamports: string;
    tokenAmount: string;
    txSignature: string | null;
    status: string;
    errorMessage: string | null;
  }): Promise<AutoStrategyExecution> {
    const [row] = await db.insert(autoStrategyExecutions).values(data).returning();
    return row;
  }

  async listAutoStrategyExecutions(strategyId: string, limit = 100): Promise<AutoStrategyExecution[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit) || 100));
    return await db
      .select()
      .from(autoStrategyExecutions)
      .where(eq(autoStrategyExecutions.strategyId, strategyId))
      .orderBy(desc(autoStrategyExecutions.createdAt))
      .limit(safeLimit);
  }

  // ─── Arbitrage executor ────────────────────────────────────────────────────
  async createArbStrategy(data: {
    ownerWallet: string;
    workerWallet: string;
    encryptedKey: string;
    withdrawAddress: string;
    name: string;
    mode: string;
    status: string;
    budgetLamports: string;
    maxTradeUsd: number;
    minNetEdgeBps: number;
    slippageBps: number;
    targetMode: string;
    targetMints: string[];
    lossStopCount: number;
    intervalSeconds: number;
    nextRunAt: Date | null;
  }): Promise<ArbStrategy> {
    const [row] = await db.insert(arbStrategies).values(data).returning();
    return row;
  }

  async getArbStrategy(id: string): Promise<ArbStrategy | undefined> {
    const [row] = await db.select().from(arbStrategies).where(eq(arbStrategies.id, id)).limit(1);
    return row;
  }

  async listArbStrategiesByOwner(ownerWallet: string): Promise<ArbStrategy[]> {
    return await db
      .select()
      .from(arbStrategies)
      .where(eq(arbStrategies.ownerWallet, ownerWallet))
      .orderBy(desc(arbStrategies.createdAt));
  }

  async getDueArbStrategies(now: Date): Promise<ArbStrategy[]> {
    return await db
      .select()
      .from(arbStrategies)
      .where(and(eq(arbStrategies.status, "active"), lte(arbStrategies.nextRunAt, now)))
      .orderBy(asc(arbStrategies.nextRunAt))
      .limit(50);
  }

  async updateArbStrategy(id: string, patch: Partial<{
    status: string;
    spentLamports: string;
    consecutiveLosses: number;
    tradesExecuted: number;
    wins: number;
    realizedPnlLamports: string;
    paperPnlMicroUsd: string;
    nextRunAt: Date | null;
  }>): Promise<ArbStrategy | undefined> {
    const [row] = await db
      .update(arbStrategies)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(arbStrategies.id, id))
      .returning();
    return row;
  }

  async addArbExecution(data: {
    strategyId: string;
    mint: string;
    symbol: string;
    buyDex: string;
    sellDex: string;
    tradeSizeUsd: number;
    grossSpreadBps: number;
    estCostBps: number;
    netEdgeBps: number;
    mode: string;
    solInLamports: string;
    solOutLamports: string;
    buySig: string | null;
    sellSig: string | null;
    resultMicroUsd: string;
    status: string;
    errorMessage: string | null;
  }): Promise<ArbExecution> {
    const [row] = await db.insert(arbExecutions).values(data).returning();
    return row;
  }

  async listArbExecutions(strategyId: string, limit = 100): Promise<ArbExecution[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit) || 100));
    return await db
      .select()
      .from(arbExecutions)
      .where(eq(arbExecutions.strategyId, strategyId))
      .orderBy(desc(arbExecutions.createdAt))
      .limit(safeLimit);
  }

  // ─── Swing bot ──────────────────────────────────────────────────────────────
  async createSwingStrategy(data: {
    ownerWallet: string;
    workerWallet: string;
    encryptedKey: string;
    subWalletCount?: number;
    extraWallets?: string[];
    extraEncryptedKeys?: string[];
    withdrawAddress: string;
    name: string;
    mode: string;
    universe?: string;
    style: string;
    targetMint: string | null;
    manualBuy?: boolean;
    reentry?: boolean;
    status: string;
    budgetLamports: string;
    paperBankrollLamports: string;
    windowEndAt: Date;
    unlimitedWindow?: boolean;
    activeSince?: Date | null;
    maxPositions: number;
    allowStacking: boolean;
    hotStreakFullSize?: boolean;
    minPoolAgeHours?: number | null;
    requireApproval?: boolean;
    takeProfitPct: number | null;
    conservativeProfit?: boolean;
    neverSellAtLoss?: boolean;
    redEndBehavior?: string;
    momentumCycle?: boolean;
    rotateToRunners?: boolean;
    stopLossPct: number;
    stopRoomPct?: number | null;
    sellOffCutEnabled?: boolean;
    winnerKeepPct?: number | null;
    profitSkimPct?: number;
    trailArmPct: number;
    trailPct: number;
    maxHoldHours: number;
    minLiquidityUsd: number;
    slippageBps: number;
    lossStopCount: number;
    feeBps?: number | null;
    nextRunAt: Date | null;
  }): Promise<SwingStrategy> {
    const [row] = await db.insert(swingStrategies).values(data).returning();
    return row;
  }

  async getSwingStrategy(id: string): Promise<SwingStrategy | undefined> {
    const [row] = await db.select().from(swingStrategies).where(eq(swingStrategies.id, id)).limit(1);
    return row;
  }

  async listSwingStrategiesByOwner(ownerWallet: string): Promise<SwingStrategy[]> {
    return await db
      .select()
      .from(swingStrategies)
      .where(eq(swingStrategies.ownerWallet, ownerWallet))
      .orderBy(desc(swingStrategies.createdAt));
  }

  async getDueSwingStrategies(now: Date): Promise<SwingStrategy[]> {
    return await db
      .select()
      .from(swingStrategies)
      .where(and(eq(swingStrategies.status, "active"), lte(swingStrategies.nextRunAt, now)))
      .orderBy(asc(swingStrategies.nextRunAt))
      .limit(50);
  }

  // All currently-active strategies — used once at boot to reconcile the
  // lifetime active-time clock after downtime.
  async listActiveSwingStrategies(): Promise<SwingStrategy[]> {
    return await db
      .select()
      .from(swingStrategies)
      .where(eq(swingStrategies.status, "active"));
  }

  // Stopped/completed strategies that STILL hold open positions — a stop's
  // liquidation was interrupted (server restart mid-withdraw) and must resume.
  async listSwingStrategiesNeedingLiquidation(): Promise<SwingStrategy[]> {
    const rows = await db
      .selectDistinct({ strategy: swingStrategies })
      .from(swingStrategies)
      .innerJoin(swingPositions, eq(swingPositions.strategyId, swingStrategies.id))
      .where(and(
        inArray(swingStrategies.status, ["stopped", "completed"]),
        eq(swingPositions.status, "open"),
      ))
      .limit(20);
    return rows.map((r) => r.strategy);
  }

  // Recently stopped/completed LIVE strategies — checked once per boot for a
  // stranded worker-wallet balance (positions sold but the sweep was lost).
  async listRecentlyStoppedLiveSwingStrategies(since: Date): Promise<SwingStrategy[]> {
    return await db
      .select()
      .from(swingStrategies)
      .where(and(
        eq(swingStrategies.mode, "live"),
        inArray(swingStrategies.status, ["stopped", "completed"]),
        gte(swingStrategies.updatedAt, since),
      ))
      .orderBy(desc(swingStrategies.updatedAt))
      .limit(20);
  }

  async listSwingPerformance(ownerWallet?: string): Promise<Array<{
    strategyId: string; ownerWallet: string; name: string; mode: string; style: string;
    status: string; settings: Record<string, unknown>; trades: number; wins: number;
    realizedPnlLamports: string; createdAt: Date; archived: boolean;
  }>> {
    const ownerFilter = ownerWallet
      ? drizzleSql`WHERE owner_wallet = ${ownerWallet}`
      : drizzleSql``;
    const result = await db.execute<{
      strategy_id: string; owner_wallet: string; name: string; mode: string; style: string;
      status: string; settings: Record<string, unknown>; trades: number; wins: number;
      realized_pnl_lamports: string; created_at: Date; archived: boolean;
    }>(drizzleSql`
      WITH current_performance AS (
        SELECT s.id AS strategy_id, s.owner_wallet, s.name, s.mode, s.style, s.status,
          jsonb_build_object(
            'universe', COALESCE(s.universe, 'crypto'),
            'botKind', CASE WHEN s.target_mint IS NULL THEN 'scan' ELSE 'watch' END,
            'maxPositions', s.max_positions,
            'allowStacking', s.allow_stacking,
            'hotStreakFullSize', s.hot_streak_full_size,
            'minPoolAgeHours', s.min_pool_age_hours,
            'requireApproval', s.require_approval,
            'takeProfitPct', s.take_profit_pct,
            'conservativeProfit', s.conservative_profit,
            'neverSellAtLoss', s.never_sell_at_loss,
            'redEndBehavior', s.red_end_behavior,
            'stopLossPct', s.stop_loss_pct,
            'stopRoomPct', s.stop_room_pct,
            'sellOffCutEnabled', s.sell_off_cut_enabled,
            'winnerKeepPct', s.winner_keep_pct,
            'profitSkimPct', s.profit_skim_pct,
            'trailArmPct', s.trail_arm_pct,
            'trailPct', s.trail_pct,
            'maxHoldHours', s.max_hold_hours,
            'minLiquidityUsd', s.min_liquidity_usd,
            'slippageBps', s.slippage_bps,
            'lossStopCount', s.loss_stop_count
          ) AS settings,
          COUNT(p.id) FILTER (
            WHERE p.status = 'closed' AND p.sol_out_lamports IS NOT NULL
              AND COALESCE(p.exit_reason, '') <> 'tokens_sent_home'
          )::int AS trades,
          COUNT(p.id) FILTER (
            WHERE p.status = 'closed' AND p.sol_out_lamports IS NOT NULL
              AND COALESCE(p.exit_reason, '') <> 'tokens_sent_home'
              AND p.sol_out_lamports::numeric > p.sol_in_lamports::numeric
          )::int AS wins,
          COALESCE(SUM(p.sol_out_lamports::numeric - p.sol_in_lamports::numeric) FILTER (
            WHERE p.status = 'closed' AND p.sol_out_lamports IS NOT NULL
              AND COALESCE(p.exit_reason, '') <> 'tokens_sent_home'
          ), 0)::text AS realized_pnl_lamports,
          s.created_at, false AS archived
        FROM swing_strategies s
        LEFT JOIN swing_positions p ON p.strategy_id = s.id
        GROUP BY s.id
      ), all_performance AS (
        SELECT * FROM current_performance
        UNION ALL
        SELECT strategy_id, owner_wallet, name, mode, style, 'deleted' AS status,
          settings, trades, wins, realized_pnl_lamports, bot_created_at AS created_at,
          true AS archived
        FROM swing_performance_history
      )
      SELECT * FROM all_performance
      ${ownerFilter}
      ORDER BY created_at DESC
    `);
    return result.rows.map((r) => ({
      strategyId: r.strategy_id,
      ownerWallet: r.owner_wallet,
      name: r.name,
      mode: r.mode,
      style: r.style,
      status: r.status,
      settings: r.settings,
      trades: Number(r.trades),
      wins: Number(r.wins),
      realizedPnlLamports: String(r.realized_pnl_lamports),
      createdAt: new Date(r.created_at),
      archived: Boolean(r.archived),
    }));
  }

  async updateSwingStrategy(id: string, patch: Partial<{
    status: string;
    paperBankrollLamports: string;
    bankedLamports: string;
    consecutiveLosses: number;
    tradesExecuted: number;
    wins: number;
    realizedPnlLamports: string;
    feesPaidLamports: string;
    nextRunAt: Date | null;
    lastScanAt: Date | null;
    lastScanNote: string | null;
    maxPositions: number;
    allowStacking: boolean;
    requireApproval: boolean;
    conservativeProfit: boolean;
    neverSellAtLoss: boolean;
    redEndBehavior: string;
    takeProfitPct: number | null;
    stopRoomPct: number | null;
    windowEndAt: Date;
    unlimitedWindow: boolean;
    activeMsTotal: string;
    activeSince: Date | null;
    restartedAt: Date | null;
    budgetLamports: string;
    lossCooldownUntil: Date | null;
    rebuyMints: string[];
    blockedMints: string[];
    hotStreakFullSize: boolean;
    minPoolAgeHours: number | null;
    minLiquidityUsd: number;
    sellOffCutEnabled: boolean;
    winnerKeepPct: number | null;
    profitSkimPct: number;
    name: string;
    favorite: boolean;
  }>): Promise<SwingStrategy | undefined> {
    // "deleting" is a durable terminal claim. Once set, no concurrent worker
    // may restart, pause, stop, or complete the strategy back into another
    // lifecycle state while settlement and archival are in progress.
    const where = patch.status && patch.status !== "deleting"
      ? and(eq(swingStrategies.id, id), ne(swingStrategies.status, "deleting"))
      : eq(swingStrategies.id, id);
    const [row] = await db
      .update(swingStrategies)
      .set({ ...patch, updatedAt: new Date() })
      .where(where)
      .returning();
    return row;
  }

  async createSwingPosition(data: {
    strategyId: string;
    mint: string;
    symbol: string;
    tokenName: string | null;
    mode: string;
    walletIndex?: number;
    solInLamports: string;
    tokenAmountRaw: string;
    decimals: number;
    highWaterLamports: string;
    lastValueLamports: string;
    entryVolumeH1Usd: number;
    entryLiquidityUsd: number;
    entryPriceUsd: number | null;
    entryFillPriceUsd?: number | null;
    entryPairAddress: string | null;
    entryPumpPoolId: string | null;
    entryPumpQuoteMint: string | null;
    entryPumpBlockhash: string | null;
    entryTrigger?: string | null;
    entryReduced?: boolean;
    entrySig: string | null;
  }): Promise<SwingPosition | undefined> {
    return await db.transaction(async (tx) => {
      // Lock the strategy row across all server processes. Stop/delete updates
      // this same row first, so an in-flight buy either commits before the stop
      // (and is then liquidated) or observes non-active and cannot insert.
      const [strategy] = await tx
        .select({ status: swingStrategies.status })
        .from(swingStrategies)
        .where(eq(swingStrategies.id, data.strategyId))
        .limit(1)
        .for("update");
      if (!strategy || strategy.status !== "active") return undefined;
      const [row] = await tx.insert(swingPositions).values(data).returning();
      return row;
    });
  }

  async createSwingPositionIfNoOpenMint(data: Parameters<IStorage["createSwingPosition"]>[0]): Promise<SwingPosition | undefined> {
    return await db.transaction(async (tx) => {
      const [strategy] = await tx
        .select({ status: swingStrategies.status })
        .from(swingStrategies)
        .where(eq(swingStrategies.id, data.strategyId))
        .limit(1)
        .for("update");
      if (!strategy || strategy.status !== "active") return undefined;
      // Advisory xact lock serializes concurrent creates for the same
      // (strategy, mint) pair across ALL server processes sharing this DB —
      // the lock releases automatically when the transaction ends.
      await tx.execute(drizzleSql`SELECT pg_advisory_xact_lock(hashtext(${data.strategyId + ":" + data.mint}))`);
      const existing = await tx
        .select({ id: swingPositions.id })
        .from(swingPositions)
        .where(and(
          eq(swingPositions.strategyId, data.strategyId),
          eq(swingPositions.mint, data.mint),
          inArray(swingPositions.status, ["open", "pending_buy"]),
        ))
        .limit(1);
      if (existing.length > 0) return undefined;
      const [row] = await tx.insert(swingPositions).values(data).returning();
      return row;
    });
  }

  async clearSwingEntryReduced(strategyId: string, mint: string): Promise<void> {
    await db.update(swingPositions)
      .set({ entryReduced: false })
      .where(and(
        eq(swingPositions.strategyId, strategyId),
        eq(swingPositions.mint, mint),
        eq(swingPositions.status, "open"),
      ));
  }

  async updateSwingPosition(id: string, patch: Partial<{
    status: string;
    tokenAmountRaw: string;
    highWaterLamports: string;
    lastValueLamports: string;
    exitSig: string | null;
    solOutLamports: string;
    exitReason: string;
    exitPriceUsd: number | null;
    entryPumpPoolId: string | null;
    entryPumpQuoteMint: string | null;
    entryPumpBlockhash: string | null;
    manualHold: boolean;
    closedAt: Date;
  }>): Promise<SwingPosition | undefined> {
    const [row] = await db
      .update(swingPositions)
      .set(patch)
      .where(eq(swingPositions.id, id))
      .returning();
    return row;
  }

  async repairSwingPositionSolOut(id: string, solOutLamports: string, exitSig: string): Promise<boolean> {
    const rows = await db
      .update(swingPositions)
      .set({ solOutLamports, lastValueLamports: solOutLamports, exitSig })
      .where(and(
        eq(swingPositions.id, id),
        eq(swingPositions.status, "closed"),
        eq(swingPositions.solOutLamports, "0"),
      ))
      .returning();
    return rows.length === 1;
  }

  async closeSwingPositionIfOpen(id: string, patch: Partial<{
    status: string;
    lastValueLamports: string;
    exitSig: string | null;
    solOutLamports: string;
    exitReason: string;
    exitPriceUsd: number | null;
    closedAt: Date;
  }>): Promise<SwingPosition | undefined> {
    const [row] = await db
      .update(swingPositions)
      .set(patch)
      .where(and(eq(swingPositions.id, id), inArray(swingPositions.status, ["open", "pending_buy"])))
      .returning();
    return row;
  }

  async listSwingPositions(strategyId: string, status?: string): Promise<SwingPosition[]> {
    const cond = status
      ? and(eq(swingPositions.strategyId, strategyId), eq(swingPositions.status, status))
      : eq(swingPositions.strategyId, strategyId);
    return await db
      .select()
      .from(swingPositions)
      .where(cond)
      .orderBy(desc(swingPositions.openedAt))
      .limit(500);
  }

  async addSwingEvent(data: {
    strategyId: string;
    positionId: string | null;
    kind: string;
    mint: string | null;
    symbol: string | null;
    detail: string;
    solLamports: string | null;
  }): Promise<SwingEvent> {
    const [row] = await db.insert(swingEvents).values(data).returning();
    return row;
  }

  async listSwingEvents(strategyId: string, limit = 100): Promise<SwingEvent[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit) || 100));
    return await db
      .select()
      .from(swingEvents)
      .where(eq(swingEvents.strategyId, strategyId))
      .orderBy(desc(swingEvents.createdAt))
      .limit(safeLimit);
  }

  // Dedicated set-aside ledger: skim events only, so the record can't be
  // pushed out of view by chatty skip/info events in the main feed.
  async listSwingSkims(strategyId: string, limit = 200): Promise<SwingEvent[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit) || 200));
    return await db
      .select()
      .from(swingEvents)
      .where(and(eq(swingEvents.strategyId, strategyId), eq(swingEvents.kind, "skim")))
      .orderBy(desc(swingEvents.createdAt))
      .limit(safeLimit);
  }

  // Buy-signal queue. Creation is guarded so a given mint can only have one
  // signal of the requested status at a time. The executor runs under the
  // per-strategy lock, so a plain check-then-insert is race-safe here.
  async createSwingBuySignalIfNonePending(data: {
    strategyId: string;
    mint: string;
    symbol: string;
    reason: string;
    status?: string;
  }): Promise<SwingBuySignal | undefined> {
    const status = data.status ?? "pending";
    const [existing] = await db
      .select()
      .from(swingBuySignals)
      .where(and(
        eq(swingBuySignals.strategyId, data.strategyId),
        eq(swingBuySignals.mint, data.mint),
        eq(swingBuySignals.status, status),
      ))
      .limit(1);
    if (existing) return undefined;
    const [row] = await db.insert(swingBuySignals).values({ ...data, status }).returning();
    return row;
  }

  async listSwingBuySignals(strategyId: string, status?: string): Promise<SwingBuySignal[]> {
    const cond = status
      ? and(eq(swingBuySignals.strategyId, strategyId), eq(swingBuySignals.status, status))
      : eq(swingBuySignals.strategyId, strategyId);
    return await db
      .select()
      .from(swingBuySignals)
      .where(cond)
      .orderBy(desc(swingBuySignals.createdAt))
      .limit(200);
  }

  async getSwingBuySignal(id: string): Promise<SwingBuySignal | undefined> {
    const [row] = await db.select().from(swingBuySignals).where(eq(swingBuySignals.id, id)).limit(1);
    return row;
  }

  async updateSwingBuySignalStatus(id: string, status: string): Promise<void> {
    await db.update(swingBuySignals).set({ status }).where(eq(swingBuySignals.id, id));
  }

  async expireStaleSwingBuySignals(strategyId: string, olderThan: Date): Promise<void> {
    await db
      .update(swingBuySignals)
      .set({ status: "expired" })
      .where(and(
        eq(swingBuySignals.strategyId, strategyId),
        eq(swingBuySignals.status, "pending"),
        lt(swingBuySignals.createdAt, olderThan),
      ));
  }

  async deleteSwingStrategy(id: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.execute(drizzleSql`
        INSERT INTO swing_performance_history (
          strategy_id, owner_wallet, name, mode, style, settings, trades, wins,
          realized_pnl_lamports, bot_created_at
        )
        SELECT s.id, s.owner_wallet, s.name, s.mode, s.style,
          jsonb_build_object(
            'universe', COALESCE(s.universe, 'crypto'),
            'botKind', CASE WHEN s.target_mint IS NULL THEN 'scan' ELSE 'watch' END,
            'maxPositions', s.max_positions,
            'allowStacking', s.allow_stacking,
            'hotStreakFullSize', s.hot_streak_full_size,
            'minPoolAgeHours', s.min_pool_age_hours,
            'requireApproval', s.require_approval,
            'takeProfitPct', s.take_profit_pct,
            'conservativeProfit', s.conservative_profit,
            'neverSellAtLoss', s.never_sell_at_loss,
            'redEndBehavior', s.red_end_behavior,
            'stopLossPct', s.stop_loss_pct,
            'stopRoomPct', s.stop_room_pct,
            'sellOffCutEnabled', s.sell_off_cut_enabled,
            'winnerKeepPct', s.winner_keep_pct,
            'profitSkimPct', s.profit_skim_pct,
            'trailArmPct', s.trail_arm_pct,
            'trailPct', s.trail_pct,
            'maxHoldHours', s.max_hold_hours,
            'minLiquidityUsd', s.min_liquidity_usd,
            'slippageBps', s.slippage_bps,
            'lossStopCount', s.loss_stop_count
          ),
          COUNT(p.id) FILTER (
            WHERE p.status = 'closed' AND p.sol_out_lamports IS NOT NULL
              AND COALESCE(p.exit_reason, '') <> 'tokens_sent_home'
          )::int,
          COUNT(p.id) FILTER (
            WHERE p.status = 'closed' AND p.sol_out_lamports IS NOT NULL
              AND COALESCE(p.exit_reason, '') <> 'tokens_sent_home'
              AND p.sol_out_lamports::numeric > p.sol_in_lamports::numeric
          )::int,
          COALESCE(SUM(p.sol_out_lamports::numeric - p.sol_in_lamports::numeric) FILTER (
            WHERE p.status = 'closed' AND p.sol_out_lamports IS NOT NULL
              AND COALESCE(p.exit_reason, '') <> 'tokens_sent_home'
          ), 0)::text,
          s.created_at
        FROM swing_strategies s
        LEFT JOIN swing_positions p ON p.strategy_id = s.id
        WHERE s.id = ${id}
        GROUP BY s.id
        ON CONFLICT (strategy_id) DO NOTHING
      `);
      await tx.delete(swingBuySignals).where(eq(swingBuySignals.strategyId, id));
      await tx.delete(swingEvents).where(eq(swingEvents.strategyId, id));
      await tx.delete(swingPositions).where(eq(swingPositions.strategyId, id));
      await tx.delete(swingStrategies).where(eq(swingStrategies.id, id));
    });
  }

  // ─── Swing settings presets ("my favorite settings") ─────────────────────
  async createSwingPreset(data: InsertSwingPreset): Promise<SwingPreset> {
    const [row] = await db.insert(swingPresets).values(data).returning();
    return row;
  }

  async listSwingPresetsByOwner(ownerWallet: string): Promise<SwingPreset[]> {
    return await db
      .select()
      .from(swingPresets)
      .where(eq(swingPresets.ownerWallet, ownerWallet))
      .orderBy(desc(swingPresets.starred), desc(swingPresets.createdAt))
      .limit(100);
  }

  async getSwingPreset(id: string): Promise<SwingPreset | undefined> {
    const [row] = await db.select().from(swingPresets).where(eq(swingPresets.id, id));
    return row;
  }

  async updateSwingPreset(id: string, patch: Partial<Pick<SwingPreset, "name" | "starred">>): Promise<SwingPreset | undefined> {
    const [row] = await db.update(swingPresets).set(patch).where(eq(swingPresets.id, id)).returning();
    return row;
  }

  async deleteSwingPreset(id: string): Promise<void> {
    await db.delete(swingPresets).where(eq(swingPresets.id, id));
  }

  // ─── Telegram shill bot ──────────────────────────────────────────────────
  async listTelegramDestinations(): Promise<TelegramDestination[]> {
    return await db.select().from(telegramDestinations).orderBy(asc(telegramDestinations.createdAt));
  }

  async addTelegramDestination(data: InsertTelegramDestination): Promise<TelegramDestination> {
    const [row] = await db
      .insert(telegramDestinations)
      .values({ chatId: data.chatId, label: data.label ?? "", enabled: data.enabled ?? true })
      .onConflictDoUpdate({
        target: telegramDestinations.chatId,
        set: { label: data.label ?? "", enabled: data.enabled ?? true },
      })
      .returning();
    return row;
  }

  async setTelegramDestinationEnabled(id: string, enabled: boolean): Promise<TelegramDestination | undefined> {
    const [row] = await db
      .update(telegramDestinations)
      .set({ enabled })
      .where(eq(telegramDestinations.id, id))
      .returning();
    return row;
  }

  async deleteTelegramDestination(id: string): Promise<void> {
    await db.delete(telegramDestinations).where(eq(telegramDestinations.id, id));
  }

  async logTelegramPost(data: {
    kind: string;
    copyMode: string;
    content: string;
    tokenMint: string | null;
    tokenSymbol: string | null;
    targets: string[];
    sentCount: number;
    failCount: number;
  }): Promise<TelegramPost> {
    const [row] = await db.insert(telegramPosts).values(data).returning();
    return row;
  }

  async listTelegramPosts(limit = 25): Promise<TelegramPost[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit) || 25));
    return await db
      .select()
      .from(telegramPosts)
      .orderBy(desc(telegramPosts.createdAt))
      .limit(safeLimit);
  }
}

export const storage = new DatabaseStorage();
