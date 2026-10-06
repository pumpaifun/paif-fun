import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, real, doublePrecision, timestamp, integer, uniqueIndex, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export * from "./models/auth";

export const vaults = pgTable("vaults", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  walletAddress: text("wallet_address").notNull().unique(),
  name: text("name").notNull().default("My Vault"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertVaultSchema = createInsertSchema(vaults).omit({ id: true, createdAt: true });
export type InsertVault = z.infer<typeof insertVaultSchema>;
export type Vault = typeof vaults.$inferSelect;

export const vaultStrategies = pgTable("vault_strategies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vaultId: varchar("vault_id").notNull(),
  strategyType: text("strategy_type").notNull(),
  allocation: real("allocation").notNull().default(0),
  isActive: boolean("is_active").notNull().default(false),
  mode: text("mode").notNull().default("live"),
});

export const insertVaultStrategySchema = createInsertSchema(vaultStrategies).omit({ id: true });
export type InsertVaultStrategy = z.infer<typeof insertVaultStrategySchema>;
export type VaultStrategy = typeof vaultStrategies.$inferSelect;

export const vaultSettings = pgTable("vault_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vaultId: varchar("vault_id").notNull().unique(),
  maxAllocPerTrade: real("max_alloc_per_trade").default(0.5),
  maxDailySpend: real("max_daily_spend").default(5.0),
  stopLossPercent: real("stop_loss_percent").default(50),
  stopLossEnabled: boolean("stop_loss_enabled").notNull().default(false),
  takeProfitPercent: real("take_profit_percent").default(200),
  takeProfitEnabled: boolean("take_profit_enabled").notNull().default(false),
  allowedTokens: text("allowed_tokens").array().default(sql`'{}'::text[]`),
  copyTradeWallets: text("copy_trade_wallets").array().default(sql`'{}'::text[]`),
});

export const insertVaultSettingsSchema = createInsertSchema(vaultSettings).omit({ id: true });
export type InsertVaultSettings = z.infer<typeof insertVaultSettingsSchema>;
export type VaultSettings = typeof vaultSettings.$inferSelect;

export const vaultPositions = pgTable("vault_positions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vaultId: varchar("vault_id").notNull(),
  strategyType: text("strategy_type").notNull(),
  tokenMint: text("token_mint").notNull(),
  tokenName: text("token_name").notNull(),
  tokenSymbol: text("token_symbol").notNull(),
  tokenImage: text("token_image"),
  entryAmountSol: real("entry_amount_sol").notNull(),
  entryTokenAmount: real("entry_token_amount"),
  entryPrice: real("entry_price"),
  mode: text("mode").notNull().default("paper"),
  status: text("status").notNull().default("open"),
  txSignature: text("tx_signature"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  closedAt: timestamp("closed_at"),
});

export const insertVaultPositionSchema = createInsertSchema(vaultPositions).omit({ id: true, createdAt: true, closedAt: true });
export type InsertVaultPosition = z.infer<typeof insertVaultPositionSchema>;
export type VaultPosition = typeof vaultPositions.$inferSelect;

export const STRATEGY_TYPES = ["copy_trade", "meme", "ai_momentum", "long_hold"] as const;
export type StrategyType = typeof STRATEGY_TYPES[number];

export const swapHistory = pgTable("swap_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  walletAddress: text("wallet_address").notNull(),
  fromSymbol: text("from_symbol").notNull(),
  toSymbol: text("to_symbol").notNull(),
  fromAmount: text("from_amount").notNull(),
  toAmount: text("to_amount").notNull(),
  txSignature: text("tx_signature").notNull(),
  status: text("status").notNull().default("success"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSwapHistorySchema = createInsertSchema(swapHistory).omit({ id: true, createdAt: true });
export type InsertSwapHistory = z.infer<typeof insertSwapHistorySchema>;
export type SwapHistoryItem = typeof swapHistory.$inferSelect;

// Durable single-use authorization receipts for wallet-attributed community
// writes. A primary key makes replay protection work across processes/restarts.
export const walletWriteReceipts = pgTable("wallet_write_receipts", {
  signature: text("signature").primaryKey(),
  purpose: text("purpose").notNull(),
  walletAddress: text("wallet_address").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// PumpApi's creator leaderboard is intentionally backed by an append-only,
// idempotent launch fact table. `creatorWallet` is the transaction signer;
// creatorFeeAddress is a separate protocol field and must never be substituted
// for the signer when attributing a launch.
export const pumpApiCreatorLaunches = pgTable("pumpapi_creator_launches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventKey: text("event_key").notNull().unique(),
  signature: text("signature").notNull(),
  mint: text("mint").notNull(),
  creatorWallet: text("creator_wallet").notNull(),
  creatorFeeAddress: text("creator_fee_address"),
  poolId: text("pool_id"),
  pool: text("pool").notNull(),
  name: text("name").notNull().default(""),
  symbol: text("symbol").notNull().default(""),
  uri: text("uri"),
  initialBuy: real("initial_buy"),
  quoteMint: text("quote_mint"),
  quoteAmount: real("quote_amount"),
  marketCapQuote: real("market_cap_quote"),
  block: integer("block"),
  launchedAt: timestamp("launched_at").notNull(),
  source: text("source").notNull(),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
}, (t) => ({
  signatureMint: uniqueIndex("uniq_pumpapi_launch_signature_mint").on(t.signature, t.mint),
  byCreator: index("idx_pumpapi_launch_creator").on(t.creatorWallet, t.launchedAt),
  byLaunched: index("idx_pumpapi_launch_launched").on(t.launchedAt),
  canonicalMint: index("idx_pumpapi_launch_canonical_mint").on(t.mint, t.launchedAt, t.eventKey),
}));
export type PumpApiCreatorLaunch = typeof pumpApiCreatorLaunches.$inferSelect;
export type InsertPumpApiCreatorLaunch = typeof pumpApiCreatorLaunches.$inferInsert;

// Trade facts are kept independently of a creator.  This makes the ownership
// rule deterministic when a mint has duplicate create observations: reporting
// always assigns it to the earliest observed launch.
export const pumpApiObservedTrades = pgTable("pumpapi_observed_trades", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventKey: text("event_key").notNull().unique(),
  signature: text("signature").notNull(),
  mint: text("mint").notNull(),
  action: text("action").notNull(),
  poolId: text("pool_id"),
  pool: text("pool").notNull(),
  quoteMint: text("quote_mint").notNull(),
  quoteAmount: doublePrecision("quote_amount").notNull(),
  tokenAmount: doublePrecision("token_amount").notNull(),
  volumeMethod: text("volume_method"),
  breakdownCount: integer("breakdown_count"),
  tradedAt: timestamp("traded_at").notNull(),
  source: text("source").notNull(),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
}, (t) => ({
  signatureEvent: uniqueIndex("uniq_pumpapi_trade_signature_event").on(t.signature, t.mint, t.poolId, t.action),
  byMintTime: index("idx_pumpapi_trade_mint_time").on(t.mint, t.tradedAt),
  byTime: index("idx_pumpapi_trade_time").on(t.tradedAt),
}));
export type PumpApiObservedTrade = typeof pumpApiObservedTrades.$inferSelect;
export type InsertPumpApiObservedTrade = typeof pumpApiObservedTrades.$inferInsert;

// Compact idempotently-maintained aggregates. Raw trade facts remain the
// audit source, while leaderboard polling never scans their lifetime history.
export const pumpApiMintTradeTotals = pgTable("pumpapi_mint_trade_totals", {
  mint: text("mint").primaryKey(),
  solGrossQuoteAmount: doublePrecision("sol_gross_quote_amount"),
  solGrossTradeCount: integer("sol_gross_trade_count").notNull().default(0),
  unsupportedTradeCount: integer("unsupported_trade_count").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull(),
}, (t) => ({
  byUpdated: index("idx_pumpapi_mint_trade_totals_updated").on(t.updatedAt),
}));

export const pumpApiMintHourlyVolumes = pgTable("pumpapi_mint_hourly_volumes", {
  mint: text("mint").notNull(),
  hour: timestamp("hour").notNull(),
  solGrossQuoteAmount: doublePrecision("sol_gross_quote_amount").notNull(),
  solGrossTradeCount: integer("sol_gross_trade_count").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull(),
}, (t) => ({
  mintHour: uniqueIndex("uniq_pumpapi_mint_hourly_volume").on(t.mint, t.hour),
  byHour: index("idx_pumpapi_mint_hourly_volume_hour").on(t.hour),
}));

// One current server-side DexScreener observation per recently observed mint.
// Failed reads are recorded too, so null market values are never presented as
// a measured zero.
export const pumpApiMarketSnapshots = pgTable("pumpapi_market_snapshots", {
  mint: text("mint").primaryKey(),
  volume24hUsd: real("volume_24h_usd"),
  currentMarketCapUsd: real("current_market_cap_usd"),
  // Highest market cap returned by any successful observation. This is an
  // observed high, not an all-time high: gaps in polling remain disclosed.
  peakMarketCapUsd: real("peak_market_cap_usd"),
  peakObservedAt: timestamp("peak_observed_at"),
  // Set after any successful DexScreener response, including an empty pair
  // result. A request failure leaves this null, so unknown is never "not graduated".
  outcomeObservedAt: timestamp("outcome_observed_at"),
  // Null means no successful outcome check. False means only a pump.fun
  // bonding-curve venue was observed; true means a migrated DEX venue existed.
  graduatedObserved: boolean("graduated_observed"),
  observedAt: timestamp("observed_at"),
  lastAttemptAt: timestamp("last_attempt_at").notNull(),
  failure: text("failure"),
  pairCount: integer("pair_count").notNull().default(0),
}, (t) => ({
  byObserved: index("idx_pumpapi_market_snapshot_observed").on(t.observedAt),
}));
export type PumpApiMarketSnapshot = typeof pumpApiMarketSnapshots.$inferSelect;
export type InsertPumpApiMarketSnapshot = typeof pumpApiMarketSnapshots.$inferInsert;

// Verified tokenized-stock identity is keyed by the exact Solana mint published
// by the issuer. Symbol-only discoveries are never admitted to this table.
export const tokenizedStockCatalog = pgTable("tokenized_stock_catalog", {
  issuer: text("issuer").notNull(),
  mint: text("mint").notNull(),
  issuerAssetId: text("issuer_asset_id").notNull(),
  name: text("name").notNull(),
  tokenSymbol: text("token_symbol").notNull(),
  underlyingTicker: text("underlying_ticker").notNull(),
  instrumentType: text("instrument_type"),
  logoUrl: text("logo_url"),
  tradingStatus: text("trading_status").notNull(),
  availabilityLabel: text("availability_label").notNull(),
  priceUsd: doublePrecision("price_usd"),
  marketCapUsd: doublePrecision("market_cap_usd"),
  liquidityUsd: doublePrecision("liquidity_usd"),
  volume24hUsd: doublePrecision("volume_24h_usd"),
  priceChange24hPct: doublePrecision("price_change_24h_pct"),
  marketDataObservedAt: timestamp("market_data_observed_at"),
  issuerCatalogObservedAt: timestamp("issuer_catalog_observed_at").notNull(),
  lastAttemptAt: timestamp("last_attempt_at").notNull(),
  marketDataSource: text("market_data_source"),
  failure: text("failure"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  issuerMint: uniqueIndex("uniq_tokenized_stock_issuer_mint").on(t.issuer, t.mint),
  byMint: index("idx_tokenized_stock_mint").on(t.mint),
  byIssuerTicker: index("idx_tokenized_stock_issuer_ticker").on(t.issuer, t.underlyingTicker),
  byLiquidity: index("idx_tokenized_stock_liquidity").on(t.liquidityUsd),
  byVolume: index("idx_tokenized_stock_volume_24h").on(t.volume24hUsd),
}));
export type TokenizedStockCatalogRow = typeof tokenizedStockCatalog.$inferSelect;
export type InsertTokenizedStockCatalogRow = typeof tokenizedStockCatalog.$inferInsert;

export const bumpHistory = pgTable("bump_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerWallet: text("owner_wallet").notNull(),
  sessionWallet: text("session_wallet").notNull(),
  mint: text("mint").notNull(),
  tokenSymbol: text("token_symbol"),
  action: text("action").notNull(),
  amountSol: real("amount_sol"),
  amountTokens: real("amount_tokens"),
  txSignature: text("tx_signature"),
  status: text("status").notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  byOwner: index("idx_bump_history_owner").on(t.ownerWallet, t.createdAt),
}));

export const insertBumpHistorySchema = createInsertSchema(bumpHistory).omit({ id: true, createdAt: true });
export type InsertBumpHistory = z.infer<typeof insertBumpHistorySchema>;
export type BumpHistoryItem = typeof bumpHistory.$inferSelect;

// Owner→session-wallet delegation. The user's MAIN wallet signs a one-time
// message authorizing a session wallet to log bump history on its behalf.
// Sub-wallets are delegated transitively by an already-delegated session
// wallet (no extra main-wallet popup). Server checks (ownerWallet,
// sessionWallet) is present here before accepting any history POST — this is
// what closes the cross-wallet history-poisoning hole.
export const bumpHistoryDelegations = pgTable("bump_history_delegations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerWallet: text("owner_wallet").notNull(),
  sessionWallet: text("session_wallet").notNull(),
  // Wallet that produced `signature` — either ownerWallet itself, or a
  // session wallet that already has its own delegation under this owner.
  delegatorWallet: text("delegator_wallet").notNull(),
  signature: text("signature").notNull(),  // base58-encoded ed25519 sig
  nonce: text("nonce").notNull(),          // millis-since-epoch as string (avoids JS bigint issues)
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  byOwnerSession: uniqueIndex("uniq_bump_delegations_owner_session").on(t.ownerWallet, t.sessionWallet),
  byOwner: index("idx_bump_delegations_owner").on(t.ownerWallet),
}));

export const insertBumpDelegationSchema = createInsertSchema(bumpHistoryDelegations).omit({ id: true, createdAt: true });
export type InsertBumpDelegation = z.infer<typeof insertBumpDelegationSchema>;
export type BumpDelegation = typeof bumpHistoryDelegations.$inferSelect;

export const comments = pgTable("comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parentCommentId: varchar("parent_comment_id"),
  walletAddress: text("wallet_address").notNull(),
  displayName: text("display_name").notNull(),
  message: text("message").notNull(),
  category: text("category").default("question").notNull(),
  taggedMint: text("tagged_mint"),
  upvotes: integer("upvotes").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  byParent: index("idx_comments_parent_created").on(t.parentCommentId, t.createdAt),
}));

export const insertCommentSchema = createInsertSchema(comments).omit({ id: true, createdAt: true });
export type InsertComment = z.infer<typeof insertCommentSchema>;
export type Comment = typeof comments.$inferSelect;

// Rejected community posts are retained only while a moderator reviews them.
// `blockedMessage` is cleared when the appeal is resolved; an approved message
// is copied into `comments` inside the same database transaction.
export const communityAppeals = pgTable("community_appeals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  requesterWallet: text("requester_wallet").notNull(),
  displayName: text("display_name").notNull(),
  blockedMessage: text("blocked_message"),
  category: text("category").notNull(),
  appealReason: text("appeal_reason").notNull(),
  status: text("status").notNull().default("pending"),
  moderatorNote: text("moderator_note"),
  resolvedBy: text("resolved_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
}, (t) => ({
  byStatusCreated: index("idx_community_appeals_status_created").on(t.status, t.createdAt),
  byRequesterCreated: index("idx_community_appeals_requester_created").on(t.requesterWallet, t.createdAt),
}));

export const insertCommunityAppealSchema = createInsertSchema(communityAppeals).omit({
  id: true,
  createdAt: true,
  resolvedAt: true,
});
export type InsertCommunityAppeal = z.infer<typeof insertCommunityAppealSchema>;
export type CommunityAppeal = typeof communityAppeals.$inferSelect;

// ─── Bump credits (off-chain subscription/credit-pack model) ─────────────────
// Replaces the legacy on-chain platform fee. Each main wallet has a balance of
// "bump credits" — one credit consumed per fired bump. Credits are purchased
// up front in fixed packs (see shared/credit-packs.ts) by sending SOL to the
// platform treasury wallet. New wallets get a small free trial grant on first
// read (see storage.getCreditBalance).
export const bumpCredits = pgTable("bump_credits", {
  ownerWallet: text("owner_wallet").primaryKey(),
  balance: integer("balance").notNull().default(0),
  unlimitedSubwallets: boolean("unlimited_subwallets").notNull().default(false),
  // When set and in the future, ALL bumps fire without consuming the credit
  // balance. Set by purchasing a time-based unlimited pack (e.g. 48h
  // unlimited). Stacks additively on re-purchase.
  unlimitedUntil: timestamp("unlimited_until"),
  // Hard cap on how many bump-bot sub-wallets this owner may register. Set
  // from the highest credit pack the owner has ever bought (see
  // CREDIT_PACKS[].maxSubwallets); free-trial wallets get a small starter
  // cap. Server-enforced in the delegation grant route so the limit can't be
  // bypassed client-side.
  maxSubwallets: integer("max_subwallets").notNull().default(3),
  freeGranted: boolean("free_granted").notNull().default(false),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type BumpCredits = typeof bumpCredits.$inferSelect;

// Audit trail for credit purchases. Each row corresponds to a verified
// on-chain SOL payment to the treasury that granted credits to ownerWallet.
// txSignature is unique so a replayed payment can't double-credit a wallet.
export const bumpCreditPurchases = pgTable("bump_credit_purchases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerWallet: text("owner_wallet").notNull(),
  packId: text("pack_id").notNull(),
  lamportsPaid: text("lamports_paid").notNull(),  // text to avoid JS bigint issues
  creditsGranted: integer("credits_granted").notNull(),
  unlimitedSubwalletsGranted: boolean("unlimited_subwallets_granted").notNull().default(false),
  txSignature: text("tx_signature").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  byOwner: index("idx_bump_credit_purchases_owner").on(t.ownerWallet, t.createdAt),
}));
export type BumpCreditPurchase = typeof bumpCreditPurchases.$inferSelect;

// ─── Shared Access Passes ────────────────────────────────────────────────────
// A pass unlocks the same paper/automated-tool entitlements for a fixed period.
// The trial and paid window share one row so a wallet cannot claim a separate
// trial per tool.
export const accessPasses = pgTable("access_passes", {
  ownerWallet: text("owner_wallet").primaryKey(),
  trialStartedAt: timestamp("trial_started_at"),
  passExpiresAt: timestamp("pass_expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type AccessPassRecord = typeof accessPasses.$inferSelect;

export const accessPassPurchases = pgTable("access_pass_purchases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerWallet: text("owner_wallet").notNull(),
  passId: text("pass_id").notNull(),
  lamportsPaid: text("lamports_paid").notNull(),
  durationMs: text("duration_ms").notNull(),
  txSignature: text("tx_signature").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  byOwner: index("idx_access_pass_purchases_owner").on(t.ownerWallet, t.createdAt),
}));
export type AccessPassPurchase = typeof accessPassPurchases.$inferSelect;

// ─── Buyback Pool ledger ────────────────────────────────────────────────────
// Every credit purchase writes one row here recording the slice of revenue
// allocated to the $PAIF buyback program. Rows start as "pending" — a
// scheduled job (or manual operator action) later swaps the SOL for $PAIF
// and marks the row "executed" with the on-chain swap signature. Designed
// so the public /buyback page can render verifiable totals without exposing
// any owner-level data beyond what already lives in bumpCreditPurchases.
export const buybackLedger = pgTable("buyback_ledger", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Which chain this row settled on. "solana" (default — every legacy/credit
  // -purchase row) keeps the well-tested Solana PAIF pool isolated; "bnb"
  // rows are PancakeSwap buybacks. Stats/pending/recent queries ALWAYS filter
  // by this so the two chains can never bleed into each other's totals.
  chain: text("chain").notNull().default("solana"),
  // Which revenue event triggered this allocation. Currently only
  // "credit_purchase"; future sources (e.g. "points_redeem", "premium_signal")
  // can be added without schema changes.
  sourceType: text("source_type").notNull(),
  // Loose pointer into the source table — stored as text so we can reference
  // any future source type without a hard FK that locks the schema down.
  sourceId: text("source_id").notNull(),
  // Audit copy of who paid (helps reconcile with bumpCreditPurchases). NOT
  // shown in the public /buyback page.
  ownerWallet: text("owner_wallet").notNull(),
  // Gross lamports the user paid in the source event.
  lamportsRevenue: text("lamports_revenue").notNull(),
  // Allocation rate in basis points (3000 = 30%). Snapshotted per row so
  // changing the program rate later doesn't retroactively rewrite history.
  allocationBps: integer("allocation_bps").notNull().default(3000),
  // floor(lamportsRevenue * allocationBps / 10000), as text to avoid bigint
  // serialisation pain.
  lamportsAllocated: text("lamports_allocated").notNull(),
  // "pending" → owed to the pool, not yet swapped into $PAIF.
  // "executed" → swap settled; executionTxSignature points at the swap tx.
  // "skipped" → operator chose not to execute (e.g. dust, refunded purchase).
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  executedAt: timestamp("executed_at"),
  executionTxSignature: text("execution_tx_signature"),
  notes: text("notes"),
}, (t) => ({
  byCreated: index("idx_buyback_ledger_created").on(t.createdAt),
  byStatus: index("idx_buyback_ledger_status").on(t.status, t.createdAt),
  // NOTE: deliberately NO unique index on execution_tx_signature — one swap
  // settles N pending rows so the same signature legitimately appears on
  // every row in a batch. Idempotency / replay-safety is enforced by the
  // intent layer (`buyback_execution_intents.consumed_at`) plus the
  // `status = 'pending'` guard inside markBuybackRowsExecuted.
  byExecSig: index("idx_buyback_ledger_exec_sig").on(t.executionTxSignature),
}));
export type BuybackLedgerEntry = typeof buybackLedger.$inferSelect;

// ─── Buyback execution intents ──────────────────────────────────────────────
// Server-issued nonces that bind a specific admin "build swap" call to the
// exact (rowIds, lamports) it represents. The on-chain swap MUST carry the
// nonce in a Memo instruction; the execute endpoint refuses any signature
// whose memo doesn't match an unconsumed, unexpired intent. This closes the
// "treasury did an unrelated swap, attacker reuses that signature" hole.
export const buybackExecutionIntents = pgTable("buyback_execution_intents", {
  // Short base58 nonce embedded in the on-chain memo (Solana) or appended to
  // the swap calldata as a hex suffix (BNB/EVM). Primary key + carried by the
  // client, so we don't need a separate UUID.
  nonce: varchar("nonce", { length: 32 }).primaryKey(),
  // "solana" | "bnb" — selects the verification path at execute time.
  chain: text("chain").notNull().default("solana"),
  rowIds: text("row_ids").array().notNull(),
  expectedLamports: text("expected_lamports").notNull(),
  treasury: text("treasury").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  consumedAt: timestamp("consumed_at"),
  consumedTxSignature: text("consumed_tx_signature"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  byExpires: index("idx_buyback_intents_expires").on(t.expiresAt),
}));

// ─── Community buybacks (multi-tenant MVP) ──────────────────────────────────
// Any wallet can register their own token + treasury for a transparent
// buyback ledger. Spoof-resistance is enforced ON RECORD, not on create:
// the only thing that can ever populate a tenant's ledger is an on-chain
// transaction signed by THAT tenant's declared treasury wallet which
// increased the treasury's balance of THAT tenant's declared mint. Anyone
// claiming a treasury they don't control simply can't ever post a row.
export const communityBuybacks = pgTable("community_buybacks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Which chain this tenant's token + treasury live on. A tenant is
  // single-chain: every entry/intent inherits it. "solana" (default) keeps
  // legacy tenants untouched; "bnb" tenants swap via PancakeSwap.
  chain: text("chain").notNull().default("solana"),
  // URL-friendly identifier, derived from the symbol but uniqueness-enforced.
  // Lowercase alphanumeric + hyphens, 2-32 chars.
  slug: varchar("slug", { length: 32 }).notNull().unique(),
  // Wallet that submitted the registration. Used as a soft "owner" for the
  // admin view; no special privileges beyond visual highlighting because
  // signature-based on-chain auth is what gates the ledger writes.
  ownerWallet: text("owner_wallet").notNull(),
  tokenMint: text("token_mint").notNull().unique(),
  tokenSymbol: text("token_symbol").notNull(),
  tokenName: text("token_name").notNull(),
  // Wallet that signs on-chain buybacks. Each ledger row must be signed by
  // this exact pubkey or it's rejected.
  treasuryWallet: text("treasury_wallet").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  byOwner: index("idx_cb_owner").on(t.ownerWallet),
  byCreated: index("idx_cb_created").on(t.createdAt),
}));
export type CommunityBuyback = typeof communityBuybacks.$inferSelect;

// One row per recorded on-chain buyback by a community tenant. We deliberately
// keep this separate from the PAIF `buyback_ledger` so the well-tested PAIF
// queries can never accidentally surface a tenant row (or vice versa).
export const communityBuybackEntries = pgTable("community_buyback_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  // Inherited from the tenant. Stored per-row so a ledger export is
  // self-describing without a join.
  chain: text("chain").notNull().default("solana"),
  // Always "manual_buyback" for MVP (treasury wallet recorded an on-chain
  // SOL→token swap). Future "auto_sweep" entries would land here too.
  sourceType: text("source_type").notNull().default("manual_buyback"),
  // SOL spent on the swap, in lamports (text to dodge bigint serialization).
  lamportsSpent: text("lamports_spent").notNull(),
  // Tokens received by the treasury, as raw atoms (text, since some tokens
  // have 9+ decimals and amounts can exceed Number safety).
  tokensReceivedRaw: text("tokens_received_raw").notNull(),
  // The on-chain swap signature. UNIQUE so the same tx can never be
  // double-recorded.
  txSignature: text("tx_signature").notNull().unique(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  byTenant: index("idx_cb_entries_tenant").on(t.tenantId, t.createdAt),
}));
export type CommunityBuybackEntry = typeof communityBuybackEntries.$inferSelect;

// Per-tenant execution intent table. Mirrors `buybackExecutionIntents` but
// scoped to a community tenant. The treasury must sign a swap that carries
// our nonce in a memo + increases the tenant mint's balance, and we mark
// the intent consumed atomically when the entry is recorded.
export const communityBuybackIntents = pgTable("community_buyback_intents", {
  nonce: varchar("nonce", { length: 32 }).primaryKey(),
  tenantId: varchar("tenant_id").notNull(),
  // "solana" | "bnb" — selects the verification path at execute time.
  chain: text("chain").notNull().default("solana"),
  treasury: text("treasury").notNull(),
  tokenMint: text("token_mint").notNull(),
  expectedLamports: text("expected_lamports").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  consumedAt: timestamp("consumed_at"),
  consumedTxSignature: text("consumed_tx_signature"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  byTenant: index("idx_cb_intents_tenant").on(t.tenantId, t.createdAt),
  byExpires: index("idx_cb_intents_expires").on(t.expiresAt),
}));
export type CommunityBuybackIntent = typeof communityBuybackIntents.$inferSelect;

export const insertCommunityBuybackSchema = createInsertSchema(communityBuybacks)
  .omit({ id: true, createdAt: true })
  .extend({
    chain: z.enum(["solana", "bnb"]).default("solana"),
    slug: z.string()
      .min(2)
      .max(32)
      .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Slug must be lowercase letters, numbers, and hyphens (no leading/trailing hyphen)."),
    tokenSymbol: z.string().min(1).max(16),
    tokenName: z.string().min(1).max(64),
    description: z.string().max(280).optional().nullable(),
  });
export type InsertCommunityBuyback = z.infer<typeof insertCommunityBuybackSchema>;

// ─── Automated Strategy Bot (Solana) ────────────────────────────────────────
// Budget + time-window, hands-free auto buy AND sell. Runs on a SERVER
// scheduler so it keeps trading with the browser closed — the deliberate,
// scoped exception to PAIF's "keys never leave the browser" rule.
//
// CUSTODY MODEL: the user's MAIN wallet is never exposed. Instead a dedicated
// budget-only "trading wallet" is generated server-side, its secret key is
// stored ENCRYPTED at rest (AES-256-GCM, key from AUTO_STRATEGY_ENCRYPTION_KEY),
// and it can only ever hold the funded budget. The user funds it from their
// main wallet; the bot trades with it for the window; remaining funds sweep
// back to `withdrawAddress` (the user's main wallet) on cancel/complete.
//
// Hard rails: budget cap (spentLamports can never exceed budgetLamports),
// time-box (windowEndAt), and revocable at any time (status → cancelled).
export const AUTO_STRATEGY_STATUSES = ["awaiting_funds", "active", "paused", "completed", "cancelled"] as const;
export type AutoStrategyStatus = typeof AUTO_STRATEGY_STATUSES[number];
export const AUTO_STRATEGY_MODES = ["dca", "trade", "volume"] as const;
export type AutoStrategyMode = typeof AUTO_STRATEGY_MODES[number];

export const autoStrategies = pgTable("auto_strategies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // User's main wallet — withdrawal destination + bump-credit owner. NEVER
  // used to sign anything; recorded so we know where to sweep funds back to.
  ownerWallet: text("owner_wallet").notNull(),
  // Pubkey of the server-managed, budget-only trading wallet.
  tradingWallet: text("trading_wallet").notNull().unique(),
  // AES-256-GCM encrypted secret key of the trading wallet (iv:tag:cipher b64).
  encryptedKey: text("encrypted_key").notNull(),
  // Where remaining funds sweep on cancel/complete. Defaults to ownerWallet.
  withdrawAddress: text("withdraw_address").notNull(),
  name: text("name").notNull().default("My Strategy"),
  status: text("status").notNull().default("awaiting_funds"),
  // Total SOL (lamports, text) the bot is allowed to spend on buys.
  budgetLamports: text("budget_lamports").notNull(),
  // Running total actually spent on buys. Server-enforced cap.
  spentLamports: text("spent_lamports").notNull().default("0"),
  // Mints to trade + per-mint allocation in basis points (sums to 10000).
  tokens: text("tokens").array().notNull(),
  allocationsBps: integer("allocations_bps").array().notNull(),
  // "dca" = accumulate only (buys). "trade" = buy in first phase, auto-sell
  // back to SOL in the final phase.
  mode: text("mode").notNull().default("dca"),
  slippageBps: integer("slippage_bps").notNull().default(100),
  windowStartAt: timestamp("window_start_at").notNull(),
  windowEndAt: timestamp("window_end_at").notNull(),
  // Even spacing between slices; nextRunAt is the wall-clock of the next slice.
  intervalSeconds: integer("interval_seconds").notNull(),
  totalSlices: integer("total_slices").notNull(),
  completedSlices: integer("completed_slices").notNull().default(0),
  // How many of totalSlices are buy slices (the rest are sell slices in trade
  // mode; in dca mode buySlices === totalSlices).
  buySlices: integer("buy_slices").notNull(),
  // Multi-wallet rotation: the bot can spread trades across several budget-only
  // wallets so buys appear to come from different addresses. `tradingWallet` /
  // `encryptedKey` above are wallet #0 (and the single funding address the user
  // tops up); these arrays hold the additional rotation wallets. Invariant:
  // walletCount === 1 + extraWallets.length === 1 + extraEncryptedKeys.length.
  walletCount: integer("wallet_count").notNull().default(1),
  extraWallets: text("extra_wallets").array().notNull().default(sql`'{}'::text[]`),
  extraEncryptedKeys: text("extra_encrypted_keys").array().notNull().default(sql`'{}'::text[]`),
  // Timestamp the primary wallet's balance was split across the rotation wallets
  // (happens once, on first activation). Null = not yet distributed; on resume we
  // skip re-splitting so funds aren't reshuffled mid-run.
  distributedAt: timestamp("distributed_at"),
  // One-time flat platform setup fee (per extra rotation wallet) was collected
  // into the treasury. Gated separately from distributedAt so a retried Start
  // after a partial-split failure never double-charges the fee.
  setupFeePaidAt: timestamp("setup_fee_paid_at"),
  // When true, a naturally-completed strategy LEAVES funds in the rotation
  // wallets instead of sweeping them back to the main wallet — so active traders
  // can refill and reuse them. Explicit cancel still sweeps everything out.
  keepFunds: boolean("keep_funds").notNull().default(false),
  // ── Take-profit (optional, one-shot auto-sell) ──
  // When the live SOL value of the strategy's holdings is up `takeProfitPct`
  // percent vs `spentLamports` (buy principal), the bot sells `takeProfitSellBps`
  // (basis points) of each position back to SOL. Null = no take-profit set.
  takeProfitPct: integer("take_profit_pct"),
  takeProfitSellBps: integer("take_profit_sell_bps"),
  // Set the moment the trigger fires — one-shot guard so it can't re-fire on
  // every 20s scheduler tick.
  takeProfitFiredAt: timestamp("take_profit_fired_at"),
  nextRunAt: timestamp("next_run_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  byOwner: index("idx_auto_strategies_owner").on(t.ownerWallet, t.createdAt),
  byStatusNextRun: index("idx_auto_strategies_status_next").on(t.status, t.nextRunAt),
}));
export type AutoStrategy = typeof autoStrategies.$inferSelect;

export const autoStrategyExecutions = pgTable("auto_strategy_executions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  strategyId: varchar("strategy_id").notNull(),
  tokenMint: text("token_mint").notNull(),
  // "buy" | "sell" | "withdraw"
  action: text("action").notNull(),
  // For buy: lamports spent. For sell/withdraw: lamports received. Text to
  // dodge bigint serialization.
  amountLamports: text("amount_lamports").notNull().default("0"),
  // Raw token atoms bought/sold (text).
  tokenAmount: text("token_amount").notNull().default("0"),
  txSignature: text("tx_signature"),
  // "success" | "failed"
  status: text("status").notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  byStrategy: index("idx_auto_strategy_exec_strategy").on(t.strategyId, t.createdAt),
}));
export type AutoStrategyExecution = typeof autoStrategyExecutions.$inferSelect;

// Client-facing creation payload. Most operational fields (trading wallet,
// encrypted key, slice schedule) are computed server-side, so this only
// captures user intent. Validated again in the route.
export const createAutoStrategySchema = z.object({
  ownerWallet: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid wallet address"),
  name: z.string().min(1).max(64).optional(),
  budgetSol: z.number().positive().max(1000),
  windowHours: z.number().int().min(1).max(720),
  tokens: z.array(z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)).min(1).max(10),
  allocationsBps: z.array(z.number().int().min(0).max(10000)).min(1).max(10),
  mode: z.enum(AUTO_STRATEGY_MODES),
  slippageBps: z.number().int().min(10).max(2000).optional(),
  tradesPerDay: z.number().int().min(1).max(48).optional(),
  // How many budget-only wallets to rotate trades across (1 = single wallet).
  walletCount: z.number().int().min(1).max(10).optional(),
  // Leave funds in the rotation wallets when the strategy completes (vs sweep).
  keepFunds: z.boolean().optional(),
  // Optional take-profit: auto-sell `takeProfitSellPct`% of holdings once the
  // position is up `takeProfitPct`%. Both must be present together.
  takeProfitPct: z.number().int().min(1).max(100000).optional(),
  takeProfitSellPct: z.number().int().min(1).max(100).optional(),
}).refine((d) => d.tokens.length === d.allocationsBps.length, {
  message: "tokens and allocationsBps length must match",
}).refine((d) => d.allocationsBps.reduce((a, b) => a + b, 0) === 10000, {
  message: "allocationsBps must sum to 10000",
}).refine((d) => !(d.mode === "volume" && (d.takeProfitPct != null || d.takeProfitSellPct != null)), {
  message: "take-profit is not supported in volume mode (positions return flat each cycle)",
});
export type CreateAutoStrategyInput = z.infer<typeof createAutoStrategySchema>;

// ─── Telegram shill bot ──────────────────────────────────────────────────────
// Destinations the bot posts hype to (groups, channels, DMs). chatId is the
// Telegram chat id ("-1001234567890") or a public "@channelusername".
export const telegramDestinations = pgTable("telegram_destinations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  chatId: text("chat_id").notNull().unique(),
  label: text("label").notNull().default(""),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const insertTelegramDestinationSchema = createInsertSchema(telegramDestinations)
  .omit({ id: true, createdAt: true })
  .extend({
    chatId: z.string().trim().min(2).max(128),
    label: z.string().trim().max(80).optional().default(""),
  });
export type InsertTelegramDestination = z.infer<typeof insertTelegramDestinationSchema>;
export type TelegramDestination = typeof telegramDestinations.$inferSelect;

// Log of every shill blast — feeds the history view and (later) automation
// de-duplication / rate-limiting.
export const telegramPosts = pgTable("telegram_posts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // "platform" | "trending" | "custom"
  kind: text("kind").notNull(),
  // "ai" | "template"
  copyMode: text("copy_mode").notNull().default("template"),
  content: text("content").notNull(),
  // Mint of the token being shilled, when applicable.
  tokenMint: text("token_mint"),
  tokenSymbol: text("token_symbol"),
  // Friendly labels of the chats it went to.
  targets: text("targets").array().notNull().default(sql`ARRAY[]::text[]`),
  sentCount: integer("sent_count").notNull().default(0),
  failCount: integer("fail_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  byCreated: index("idx_telegram_posts_created").on(t.createdAt),
}));
export type TelegramPost = typeof telegramPosts.$inferSelect;

export const TELEGRAM_SHILL_KINDS = ["platform", "trending", "custom"] as const;
export type TelegramShillKind = (typeof TELEGRAM_SHILL_KINDS)[number];

// ─── Arbitrage executor (autonomous, server-side) ────────────────────────────
// Sibling of the Auto Strategy Bot: a server-run bot that watches the read-only
// cross-pool arb scanner and (in live mode) executes trades from a dedicated,
// budget-only worker wallet — so it keeps running with the browser closed.
// PAPER mode (default) never touches chain: it simulates every opportunity with
// the scanner's honest cost model and logs would-be P&L. LIVE mode is opt-in and
// hard-capped. The user's MAIN wallet is never used to sign; it only funds the
// worker wallet, and funds can ONLY ever sweep back to withdrawAddress.
export const arbStrategies = pgTable("arb_strategies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // User's main wallet — withdrawal destination + owner. NEVER used to sign.
  ownerWallet: text("owner_wallet").notNull(),
  // Pubkey of the server-managed, budget-only worker wallet.
  workerWallet: text("worker_wallet").notNull().unique(),
  // AES-256-GCM encrypted secret key of the worker wallet (iv:tag:cipher b64).
  encryptedKey: text("encrypted_key").notNull(),
  // Funds sweep here on stop/cancel. Fixed to ownerWallet at creation.
  withdrawAddress: text("withdraw_address").notNull(),
  name: text("name").notNull().default("My Arb Bot"),
  // "paper" = simulate only (no chain, no funds). "live" = real trades.
  mode: text("mode").notNull().default("paper"),
  // awaiting_funds | active | paused | cancelled | stopped
  status: text("status").notNull().default("active"),
  // Live only: total SOL (lamports, text) allowed to be deployed as trade
  // principal, and running total actually deployed. Hard server-enforced cap.
  budgetLamports: text("budget_lamports").notNull().default("0"),
  spentLamports: text("spent_lamports").notNull().default("0"),
  // Per-trade size cap in whole USD (also the paper trade size).
  maxTradeUsd: integer("max_trade_usd").notNull().default(50),
  // Minimum net edge (after fees + slippage) required to fire, in basis points.
  minNetEdgeBps: integer("min_net_edge_bps").notNull().default(50),
  slippageBps: integer("slippage_bps").notNull().default(100),
  // "auto" = scan trending tokens. "list" = only the mints in targetMints.
  targetMode: text("target_mode").notNull().default("auto"),
  targetMints: text("target_mints").array().notNull().default(sql`'{}'::text[]`),
  // Auto-stop after this many consecutive losing LIVE trades (safety brake).
  lossStopCount: integer("loss_stop_count").notNull().default(3),
  consecutiveLosses: integer("consecutive_losses").notNull().default(0),
  tradesExecuted: integer("trades_executed").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  // Live realized net P&L in lamports (signed, text). Paper P&L in micro-USD
  // (signed, text: USD × 1e6) so we don't need a live SOL price to simulate.
  realizedPnlLamports: text("realized_pnl_lamports").notNull().default("0"),
  paperPnlMicroUsd: text("paper_pnl_micro_usd").notNull().default("0"),
  // How often the bot scans/acts.
  intervalSeconds: integer("interval_seconds").notNull().default(30),
  nextRunAt: timestamp("next_run_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  byOwner: index("idx_arb_strategies_owner").on(t.ownerWallet, t.createdAt),
  byStatusNextRun: index("idx_arb_strategies_status_next").on(t.status, t.nextRunAt),
}));
export type ArbStrategy = typeof arbStrategies.$inferSelect;

export const arbExecutions = pgTable("arb_executions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  strategyId: varchar("strategy_id").notNull(),
  mint: text("mint").notNull(),
  symbol: text("symbol").notNull().default(""),
  buyDex: text("buy_dex").notNull().default(""),
  sellDex: text("sell_dex").notNull().default(""),
  // Trade size (whole USD) and the scanner's numbers at decision time (bps).
  tradeSizeUsd: integer("trade_size_usd").notNull().default(0),
  grossSpreadBps: integer("gross_spread_bps").notNull().default(0),
  estCostBps: integer("est_cost_bps").notNull().default(0),
  netEdgeBps: integer("net_edge_bps").notNull().default(0),
  mode: text("mode").notNull().default("paper"),
  // Live only.
  solInLamports: text("sol_in_lamports").notNull().default("0"),
  solOutLamports: text("sol_out_lamports").notNull().default("0"),
  buySig: text("buy_sig"),
  sellSig: text("sell_sig"),
  // Realized (live) / simulated (paper) result in micro-USD (signed, USD × 1e6).
  resultMicroUsd: text("result_micro_usd").notNull().default("0"),
  // filled | skipped | failed | partial
  status: text("status").notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  byStrategy: index("idx_arb_exec_strategy").on(t.strategyId, t.createdAt),
}));
export type ArbExecution = typeof arbExecutions.$inferSelect;

export const ARB_STRATEGY_MODES = ["paper", "live"] as const;
export type ArbStrategyMode = (typeof ARB_STRATEGY_MODES)[number];

// Client-facing creation payload. Worker wallet + encrypted key are generated
// server-side. Validated again in the route. Hard caps live here as the first
// line of defense: max $100/trade and max 2 SOL total live budget.
export const createArbStrategySchema = z.object({
  ownerWallet: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid wallet address"),
  name: z.string().min(1).max(64).optional(),
  mode: z.enum(ARB_STRATEGY_MODES),
  maxTradeUsd: z.number().int().min(5).max(100),
  minNetEdgePct: z.number().min(0.1).max(50),
  slippageBps: z.number().int().min(10).max(1000).optional(),
  targetMode: z.enum(["auto", "list"]),
  targetMints: z.array(z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)).max(20).optional(),
  // Live only: total SOL the bot may deploy as trade principal. Hard cap 2 SOL.
  budgetSol: z.number().positive().max(2).optional(),
  lossStopCount: z.number().int().min(1).max(20).optional(),
  intervalSeconds: z.number().int().min(15).max(3600).optional(),
}).refine((d) => d.targetMode !== "list" || (d.targetMints && d.targetMints.length > 0), {
  message: "Pick at least one token to watch in list mode.",
}).refine((d) => d.mode !== "live" || (d.budgetSol != null && d.budgetSol > 0), {
  message: "Live mode needs a funding budget.",
});
export type CreateArbStrategyInput = z.infer<typeof createArbStrategySchema>;

// ─── Swing Bot (autonomous swing trader) ─────────────────────────────────────
// Scans for momentum tokens, buys, rides winners with a trailing stop, cuts
// losers with a stop-loss, exits on volume fade, compounds proceeds, repeats
// until the run window ends. Paper mode simulates executable PumpApi transactions
// (price impact included); live mode trades from a dedicated worker wallet
// using the same custody model as the arb executor.
export const swingStrategies = pgTable("swing_strategies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerWallet: text("owner_wallet").notNull(),
  workerWallet: text("worker_wallet").notNull(),
  encryptedKey: text("encrypted_key").notNull(),
  // Multi-sub-wallet DCA (watch + Long ride): the user picks how many trading
  // wallets the bot spreads the deposit across (1 = classic single wallet).
  // Wallet 0 is workerWallet/encryptedKey; wallets 1..N-1 live in the arrays
  // below (same AES-256-GCM-at-rest custody model). extraEncryptedKeys must
  // NEVER leave the server (publicStrategy strips it).
  subWalletCount: integer("sub_wallet_count").notNull().default(1),
  extraWallets: text("extra_wallets").array().notNull().default(sql`'{}'::text[]`),
  extraEncryptedKeys: text("extra_encrypted_keys").array().notNull().default(sql`'{}'::text[]`),
  withdrawAddress: text("withdraw_address").notNull(),
  name: text("name").notNull(),
  // Owner can star bots so their preferred configurations sort to the top of
  // the list (people run several bots with different settings).
  favorite: boolean("favorite").notNull().default(false),
  mode: text("mode").notNull().default("paper"), // "paper" | "live"
  // "crypto" | "stocks". Stocks are paper-only and always use a verified
  // catalog mint; the default preserves every existing strategy.
  universe: text("universe").notNull().default("crypto"),
  // "quick" = classic short swings (tight trail, 48h holds).
  // "ride"  = hold-long-and-forget: wide trail, 7-day holds, exit is led by
  //           the VOLUME signal — hold while buyers keep showing up, sell
  //           when 1h volume collapses vs entry (the sell-off tell).
  // "dip"   = contrarian dip buyer: on red days it buys ESTABLISHED tokens
  //           (pair ≥ 6 days old) that dropped WITH the market, then holds
  //           for the recovery with ride-style exits (sell-off tells, soft
  //           time-stop). The opposite of chasing momentum.
  // "coil"  = accumulation / coiled-spring: buys an ESTABLISHED token that
  //           already ran, pulled back, and is now consolidating QUIETLY (5m
  //           flat, tight base holding on cooled volume) — the base, NOT the
  //           spike. Smart ~3% stop (a calm base only drops 3% if it truly
  //           breaks), then rides the next pop with ride-style buyer-led exits.
  style: text("style").notNull().default("quick"),
  // Watch mode ("babysitter"): when set, the bot skips scanning entirely —
  // it buys THIS token with the full bankroll, then runs the normal exit
  // engine (stop-loss, trailing profit lock, seller/volume tells) on it.
  // Single-shot: once the position closes, the run completes and (live)
  // funds sweep home. NULL = normal scanning bot.
  targetMint: text("target_mint"),
  // Watch mode only: when true the bot does NOT buy on its own — it waits for
  // the owner to press "Buy now" (owner-signed), then babysits the exit as
  // usual. False = classic auto-buy on the first funded tick.
  manualBuy: boolean("manual_buy").notNull().default(false),
  // Watch mode only: comeback re-entry. When true, a closed position does NOT
  // complete the run — the bot keeps watching the token for the rest of the
  // run window and buys back in ONLY on positive comeback evidence (buyers
  // retake the tape + active volume). Hard brakes: max 3 buys per run, stops
  // re-entering after 2 losing round trips in a row. False = classic
  // single-shot (close → complete → sweep home).
  reentry: boolean("reentry").notNull().default(false),
  // "Ask me first" mode (scanning bots only): when true the bot hunts and
  // scores tokens EXACTLY as it does now but does NOT buy on its own — each
  // qualifying pick is filed as a pending buy signal (swingBuySignals) for the
  // owner to approve (buys at the current price via the normal safety-guarded
  // path) or dismiss. False = classic auto-buy. Watch/targetMint bots ignore
  // this — they already have their own manualBuy flag.
  requireApproval: boolean("require_approval").notNull().default(false),
  // awaiting_funds | active | paused | stopped | completed
  status: text("status").notNull().default("awaiting_funds"),
  // Set every time the bot is restarted from stopped/completed (window still
  // open). Watch-mode single-shot / re-entry logic only counts positions
  // opened AFTER this timestamp — a restart begins a fresh run instead of
  // instantly re-completing on the previous run's closed positions.
  restartedAt: timestamp("restarted_at"),
  budgetLamports: text("budget_lamports").notNull(),
  // Paper: the virtual SOL bankroll (compounds as trades close).
  // Live: informational only — the wallet balance is the truth.
  paperBankrollLamports: text("paper_bankroll_lamports").notNull().default("0"),
  windowEndAt: timestamp("window_end_at").notNull(),
  // Unlimited run: no scheduled end — the bot runs until the user stops it.
  // windowEndAt still holds a far-future sentinel so every existing
  // window-end check works unchanged; this flag drives the UI ("no timer").
  unlimitedWindow: boolean("unlimited_window").notNull().default(false),
  // Lifetime "time in market" clock. activeMsTotal accumulates ONLY while the
  // bot is actually running (ms, stored as text — a year of ms overflows
  // int4). activeSince marks when the current active stretch began; NULL
  // whenever the bot is paused/stopped/completed. Display total =
  // activeMsTotal + (activeSince ? now - activeSince : 0).
  activeMsTotal: text("active_ms_total").notNull().default("0"),
  activeSince: timestamp("active_since"),
  // "Judgment" knobs — sensible auto defaults; advanced users may override.
  maxPositions: integer("max_positions").notNull().default(3),
  // DCA stacking: when true, slots may be filled with additional buys of a
  // token the bot ALREADY holds if it keeps scoring strongest — each tranche
  // is its own position with its own cost basis, stop, and trailing exit.
  allowStacking: boolean("allow_stacking").notNull().default(false),
  // Hot-run protection override: by default, when a pick shows the "extended
  // hot run" shape (a token already up big for many hours straight with buyers
  // piling in — the staircase that can rug in one candle, the USOH case), the
  // bot only invests 25% of the intended slice, protecting the other 75%.
  // When true the owner explicitly accepts the rug risk and buys full size.
  hotStreakFullSize: boolean("hot_streak_full_size").notNull().default(false),
  // Minimum token age (hours) before the bot may buy — the owner's rug-risk
  // dial. 0 = "Be wild" (fresh launches allowed), presets up the ladder
  // (6h/12h/24h/48h/72h/4d/5d/7d/10d) or a custom value. NULL = legacy
  // default (the 6h floor that existed before this dial). Unknown pool age is
  // ALWAYS a no-buy regardless of this setting — a guard can't protect what
  // it can't verify. Style-specific floors (ride 6h, dip 6d) still apply on
  // top: the effective minimum is whichever is higher.
  minPoolAgeHours: integer("min_pool_age_hours"),
  // "Buy again" stars: mints from closed trades the owner explicitly wants
  // back into. The hunt watches these (re-entry cooldown waived — the star IS
  // permission) but every entry judgment and safety guard still applies.
  // A mint is removed automatically once the bot buys it again.
  rebuyMints: text("rebuy_mints").array().notNull().default(sql`'{}'::text[]`),
  // "Never buy again" blocklist: mints the owner explicitly banned (a token
  // they got burned on and don't want touched). A blocked mint is NEVER bought
  // by ANY path — auto scan, comeback, manual "Buy now", buy-more or swap — and
  // is force-removed from rebuyMints so it can't be watched and blocked at once.
  blockedMints: text("blocked_mints").array().notNull().default(sql`'{}'::text[]`),
  // Optional quick take-profit: when set, a position is sold the moment its
  // quoted exit value is up this % — banks small wins fast (scalp style)
  // instead of waiting for the trailing stop to arm. NULL = off (default).
  takeProfitPct: real("take_profit_pct"),
  // Conservative profit-taking (quick scan style only): bank a small win the
  // moment it appears (~+4%) UNLESS the tape shows a real runner (buyers clearly
  // in control) — then let it ride. Also tightens the stop to −3% and never lets
  // a recovered position slip back below breakeven. OFF by default.
  conservativeProfit: boolean("conservative_profit").notNull().default(false),
  // "Never sell at a loss" (owner opt-in): while a position sits at or below
  // breakeven, EVERY loss-side exit is held — stop-loss, early cuts, volume
  // fade, time-stop, even the rug/drain guard. The bot only sells once the
  // trade is in real profit. The owner explicitly accepts that a rug or slow
  // bleed can ride toward zero with nothing to stop it. OFF by default.
  neverSellAtLoss: boolean("never_sell_at_loss").notNull().default(false),
  // What to do with a position that is STILL below breakeven when the run
  // ends (window end or a manual stop):
  //   "sell"        → sell it anyway so the run fully wraps up (default)
  //   "send_tokens" → never sell red: transfer the tokens themselves to the
  //                   owner's wallet (closes as tokens_sent_home, live only)
  redEndBehavior: text("red_end_behavior").notNull().default("sell"),
  // Momentum cycle (opt-in, Long ride + Watch long holds only): sell EARLY the
  // moment the fast tape flips sell-heavy on a proven-up position — bank into
  // strength before a real drop — then let the comeback path re-buy the dip and
  // cycle. Ride scan bots also auto-watch the token they profited on so the SAME
  // token can be re-bought. Never applies the tight quick stops. OFF by default.
  momentumCycle: boolean("momentum_cycle").notNull().default(false),
  // Runner rotation (opt-in, multi-position SCAN styles only): when the bot is
  // fully deployed (holding its max positions) and a clearly-stronger mover
  // appears, sell the WEAKEST position that is currently in PROFIT to fund the
  // new one, and add the just-sold token to the watchlist as a priority re-buy.
  // Never sells a loser to chase. OFF by default.
  rotateToRunners: boolean("rotate_to_runners").notNull().default(false),
  stopLossPct: real("stop_loss_pct").notNull().default(4.5),
  // Owner-chosen stop-loss room (quick scan style only). NULL = the bot's
  // smart default: a tight ~4.5% scalp stop with automatic wider cushions for
  // proven climbers. When set (3/8/12/20/25), THIS becomes the firm stop line —
  // the owner explicitly trades tighter loss control for more room on runners.
  // The early-cut and crash-cut safety tiers scale to half the chosen room so
  // they can't silently defeat it.
  stopRoomPct: integer("stop_room_pct"),
  // Sell-off safety cut (only meaningful when stopRoomPct is set). The owner's
  // stop room is normally ABSOLUTE — but with this ON (default), a genuine
  // one-way sell-off (sellers overwhelming buyers on a real sample AND the 5m
  // candle in freefall, on both the 5m tape and the hour) cuts the loss before
  // the full room is spent. Ordinary volatility (two-way churn, buyers still
  // active) NEVER triggers it — those are the reversal candidates the owner
  // widened the room for. OFF = the owner's room is the only loss-side line.
  sellOffCutEnabled: boolean("sell_off_cut_enabled").notNull().default(true),
  // Winner room (quick scan style only). NULL = smart default: keep at least
  // 60% of the best gain (fast bank — the safest choice). When set (40–90),
  // a green trade may give back up to (100−keep)% of its peak before the bot
  // banks it — lower keep = more room for a HAPPYCAT-style monster to develop,
  // at the cost of handing back more profit on the winners that fade.
  winnerKeepPct: integer("winner_keep_pct"),
  // Profit set-aside ("bank the win"): on every trade that closes in profit,
  // this % of the NET profit (after the platform fee) is taken out of the
  // trading bankroll so it can never be re-risked. 0 = compound everything.
  // Paper: tracked virtually in bankedLamports. Live: sent on-chain to the
  // creation-time withdrawAddress right after the profitable close (fail-soft:
  // if the transfer fails the SOL stays in the worker wallet and keeps
  // trading — never blocks a close).
  profitSkimPct: integer("profit_skim_pct").notNull().default(50),
  // Lifetime total set aside this way (lamports, as text).
  bankedLamports: text("banked_lamports").notNull().default("0"),
  // Quick style enforces in-and-out caps at judgment time regardless of these
  // stored values: trail arms ≤ +12%, giveback ≤ 8%, hold ≤ 24h.
  trailArmPct: real("trail_arm_pct").notNull().default(12),
  trailPct: real("trail_pct").notNull().default(8),
  maxHoldHours: integer("max_hold_hours").notNull().default(24),
  minLiquidityUsd: real("min_liquidity_usd").notNull().default(20000),
  slippageBps: integer("slippage_bps").notNull().default(150),
  lossStopCount: integer("loss_stop_count").notNull().default(4),
  consecutiveLosses: integer("consecutive_losses").notNull().default(0),
  // Loss brake cool-off: after lossStopCount straight losses the bot does NOT
  // stop — it pauses NEW buys until this time while still managing open
  // positions (exits keep running). Streak resets when the cool-off starts;
  // another full streak triggers another cool-off. Null = not cooling off.
  lossCooldownUntil: timestamp("loss_cooldown_until"),
  tradesExecuted: integer("trades_executed").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  realizedPnlLamports: text("realized_pnl_lamports").notNull().default("0"),
  // Platform fees collected so far (lamports): the deposit fee once at
  // first start; on sells only when the trade closes in profit (capped at
  // the profit itself). No per-buy fees.
  feesPaidLamports: text("fees_paid_lamports").notNull().default("0"),
  // Locked platform fee tier in basis points, set once at creation from the
  // deposit's USD value: 160 (1.6%) default · 130 (1.3%) at $10,000+ ·
  // 100 (1.0%) at $20,000+. NULL = legacy rows → treated as 160. Locked at
  // create time so a mid-run SOL price move never changes the user's deal.
  feeBps: integer("fee_bps"),
  nextRunAt: timestamp("next_run_at"),
  // Heartbeat: stamped on every completed check pass so the UI can prove the
  // bot is alive ("checked Xs ago — scanned N tokens, none qualified") instead
  // of leaving the user staring at a silent "active" badge.
  lastScanAt: timestamp("last_scan_at"),
  lastScanNote: text("last_scan_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type SwingStrategy = typeof swingStrategies.$inferSelect;

export const swingPositions = pgTable("swing_positions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  strategyId: varchar("strategy_id").notNull(),
  mint: text("mint").notNull(),
  symbol: text("symbol").notNull(),
  tokenName: text("token_name"),
  status: text("status").notNull().default("open"), // "pending_buy" | "open" | "closed"
  mode: text("mode").notNull(), // "paper" | "live" (frozen at open)
  // Which sub-wallet holds this tranche's tokens: 0 = the primary worker
  // wallet, i = extraWallets[i-1]. Sells and sweeps must sign with THIS
  // wallet's key (closePosition also re-resolves by actual balance as a
  // never-stuck backstop). Paper positions are always 0.
  walletIndex: integer("wallet_index").notNull().default(0),
  solInLamports: text("sol_in_lamports").notNull(),
  tokenAmountRaw: text("token_amount_raw").notNull(),
  decimals: integer("decimals").notNull().default(6),
  // Peak quoted exit value (lamports) — drives the trailing stop.
  highWaterLamports: text("high_water_lamports").notNull(),
  // Last quoted exit value (lamports) — for live P&L display.
  lastValueLamports: text("last_value_lamports").notNull(),
  entryVolumeH1Usd: real("entry_volume_h1_usd").notNull().default(0),
  entryLiquidityUsd: real("entry_liquidity_usd").notNull().default(0),
  // Token USD price at buy and at sell — display only, for the user's "show
  // the price when we bought and sold" ask. Nullable: old positions and
  // API-miss closes have none.
  entryPriceUsd: real("entry_price_usd"),
  // TRUE per-token fill price in USD, derived from the on-chain amounts
  // (SOL actually spent ÷ tokens actually received, × SOL/USD at entry).
  // entryPriceUsd is the CHART price at pick time — on a thin/fast pool the
  // real fill can be several % worse (pool fee + the buy's own price push);
  // showing only the chart price made positions look wrongly red vs the chart.
  entryFillPriceUsd: real("entry_fill_price_usd"),
  exitPriceUsd: real("exit_price_usd"),
  // Pool the bot actually bought from — the rug guard's liquidity check is
  // pinned to THIS pair so a transient alternate pair in the API response
  // can never trigger a false emergency exit.
  entryPairAddress: text("entry_pair_address"),
  // Exact PumpApi route vetted before entry.  Exits must never depend on the
  // short-lived stream cache being available again.
  entryPumpPoolId: text("entry_pump_pool_id"),
  entryPumpQuoteMint: text("entry_pump_quote_mint"),
  // Who triggered this buy: "auto" = the bot's own scanner picked it, "manual"
  // = the owner tapped Buy now / Buy again. NULL = opened before this was
  // tracked, so the bot-vs-you split honestly leaves it out. Set once at open.
  entryTrigger: text("entry_trigger"),
  // True when the size guard shrank this buy to fit the pool (the wanted slice
  // would have pushed the price past the impact limit). A reduced entry may
  // earn ONE same-token top-up tranche later — even at max positions 1 — but
  // only under the proven-winner stacking rules (30 min spacing + combined
  // up ≥ +5%). NULL/false = full-size entry, no special treatment.
  entryReduced: boolean("entry_reduced").default(false),
  // Owner-controlled per-position pause for every automatic exit rule. Manual
  // Sell and explicit/end-of-run liquidation remain available so funds cannot
  // be stranded by a forgotten toggle.
  manualHold: boolean("manual_hold").notNull().default(false),
  entrySig: text("entry_sig"),
  // Blockhash signed into a pending buy. Together with signature status this
  // lets reconciliation prove a never-landed transaction has expired.
  entryPumpBlockhash: text("entry_pump_blockhash"),
  exitSig: text("exit_sig"),
  solOutLamports: text("sol_out_lamports"),
  // take_profit | chart_signal | stop_loss | trailing_stop | liquidity_drained | volume_fade | max_hold | window_end | manual_stop
  exitReason: text("exit_reason"),
  openedAt: timestamp("opened_at").defaultNow().notNull(),
  closedAt: timestamp("closed_at"),
}, (t) => ({
  byStrategy: index("idx_swing_pos_strategy").on(t.strategyId, t.openedAt),
}));
export type SwingPosition = typeof swingPositions.$inferSelect;

// Decision/audit feed: why the bot bought, sold, skipped, or errored.
export const swingEvents = pgTable("swing_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  strategyId: varchar("strategy_id").notNull(),
  positionId: varchar("position_id"),
  kind: text("kind").notNull(), // buy | sell | skip | info | error
  mint: text("mint"),
  symbol: text("symbol"),
  detail: text("detail").notNull(),
  solLamports: text("sol_lamports"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  byStrategy: index("idx_swing_events_strategy").on(t.strategyId, t.createdAt),
}));
export type SwingEvent = typeof swingEvents.$inferSelect;

// "Ask me first" pending buy signals: when a scanning bot runs with
// requireApproval on, it files each qualifying pick here INSTEAD of buying.
// The owner approves (which buys at the current price through the same
// safety-guarded path a manual "Buy now" uses) or dismisses it.
export const swingBuySignals = pgTable("swing_buy_signals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  strategyId: varchar("strategy_id").notNull(),
  mint: text("mint").notNull(),
  symbol: text("symbol").notNull(),
  // Plain-language reason the bot flagged it (the same entry rationale it would
  // have logged on an auto buy) so the owner can judge before approving.
  reason: text("reason").notNull(),
  // pending | approved | dismissed | expired
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  byStrategy: index("idx_swing_signals_strategy").on(t.strategyId, t.status),
}));
export type SwingBuySignal = typeof swingBuySignals.$inferSelect;

// Saved settings presets ("my favorite settings"): a named snapshot of one
// scanning bot's user-tunable knobs, owned by a wallet, starrable, and
// applicable later to any scanning bot of the SAME style. Snapshots are taken
// server-side from a real strategy (so every value already passed the settings
// endpoint's validation) — the client never supplies raw knob values here.
export const swingPresets = pgTable("swing_presets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerWallet: text("owner_wallet").notNull(),
  name: text("name").notNull(),
  starred: boolean("starred").notNull().default(false),
  // Style the snapshot came from — presets only apply to same-style bots
  // (quick-only knobs like stop room / winner room are meaningless elsewhere).
  style: text("style").notNull(),
  // Knob snapshot (whitelisted keys only; see swing-routes SWING_PRESET_KEYS).
  settings: jsonb("settings").notNull(),
  // Where it was saved from — display only ("from My Swing Bot").
  sourceStrategyName: text("source_strategy_name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  byOwner: index("idx_swing_presets_owner").on(t.ownerWallet, t.createdAt),
}));
export type SwingPreset = typeof swingPresets.$inferSelect;
export type InsertSwingPreset = typeof swingPresets.$inferInsert;

// Durable, non-custodial performance summary retained when a finished bot is
// deleted. This preserves learning/history without retaining worker keys,
// token positions, signatures, or the detailed decision feed.
export const swingPerformanceHistory = pgTable("swing_performance_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  strategyId: varchar("strategy_id").notNull().unique(),
  ownerWallet: text("owner_wallet").notNull(),
  name: text("name").notNull(),
  mode: text("mode").notNull(),
  style: text("style").notNull(),
  settings: jsonb("settings").notNull(),
  trades: integer("trades").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  realizedPnlLamports: text("realized_pnl_lamports").notNull().default("0"),
  botCreatedAt: timestamp("bot_created_at").notNull(),
  archivedAt: timestamp("archived_at").defaultNow().notNull(),
}, (t) => ({
  byOwner: index("idx_swing_perf_history_owner").on(t.ownerWallet, t.archivedAt),
}));
export type SwingPerformanceHistory = typeof swingPerformanceHistory.$inferSelect;

export const SWING_MODES = ["paper", "live"] as const;
export type SwingMode = (typeof SWING_MODES)[number];
export const SWING_STYLES = ["quick", "ride", "dip", "coil"] as const;
export type SwingStyle = (typeof SWING_STYLES)[number];

// Hard caps: live DEPOSIT ≤ 10 SOL (profits never capped), paper bankroll ≤ 10
// virtual SOL, run window 12h–30 days.
export const createSwingStrategySchema = z.object({
  ownerWallet: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid wallet address"),
  name: z.string().min(1).max(64).optional(),
  mode: z.enum(SWING_MODES),
  universe: z.enum(["crypto", "stocks"]).optional(),
  style: z.enum(SWING_STYLES).optional(),
  // Watch mode: babysit ONE specific token instead of scanning.
  targetMint: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid token address").optional(),
  // Watch mode only: wait for the owner's "Buy now" instead of auto-buying.
  manualBuy: z.boolean().optional(),
  // Watch mode only: buy back in on a proven comeback instead of completing.
  reentry: z.boolean().optional(),
  budgetSol: z.number().positive().max(10),
  // Multi-sub-wallet DCA (watch + Long ride only): spread the deposit across
  // this many trading wallets; buys/sells go tranche by tranche. 1 = classic.
  subWalletCount: z.number().int().min(1).max(25).optional(),
  windowHours: z.number().int().min(12).max(720),
  // Unlimited run: no scheduled end — windowHours is ignored when true.
  unlimitedWindow: z.boolean().optional(),
  // Advanced overrides — omitted = auto judgment defaults.
  maxPositions: z.number().int().min(1).max(10).optional(),
  allowStacking: z.boolean().optional(),
  hotStreakFullSize: z.boolean().optional(),
  // Minimum token age in hours before buying (0 = fresh launches allowed,
  // up to 720h = 30 days). Omitted = the 24h default for new bots.
  minPoolAgeHours: z.number().int().min(0).max(720).optional(),
  // "Ask me first" (scanning bots only): file each pick for owner approval
  // instead of auto-buying.
  requireApproval: z.boolean().optional(),
  takeProfitPct: z.number().min(3).max(500).optional(),
  conservativeProfit: z.boolean().optional(),
  // "Never sell at a loss": hold every loss-side exit until the trade is green.
  neverSellAtLoss: z.boolean().optional(),
  // Run-end fate of a still-red position: sell anyway, or send the tokens home.
  redEndBehavior: z.enum(["sell", "send_tokens"]).optional(),
  momentumCycle: z.boolean().optional(),
  rotateToRunners: z.boolean().optional(),
  stopLossPct: z.number().min(3).max(50).optional(),
  // Owner-chosen stop-loss room (quick scan only): preset widths, or omit for
  // the smart default (~4.5% cut with automatic climber cushions).
  stopRoomPct: z.number().int().min(2).max(50).nullable().optional(),
  // Sell-off safety cut (default ON): with a chosen stop room, a genuine
  // one-way sell-off still cuts early; plain volatility never does.
  sellOffCutEnabled: z.boolean().optional(),
  // Winner room: % of the best gain a green trade must keep (40–90); omit/null
  // for the smart default (keep 60% — fast bank, safest).
  winnerKeepPct: z.number().int().min(40).max(90).nullable().optional(),
  trailArmPct: z.number().min(5).max(200).optional(),
  trailPct: z.number().min(5).max(50).optional(),
  // Legacy clients may still send this field, but creation derives the stored
  // value from windowHours so one position cannot have a separate timer.
  maxHoldHours: z.number().int().min(6).max(720).optional(),
  minLiquidityUsd: z.number().min(5000).max(1000000).optional(),
  slippageBps: z.number().int().min(50).max(1000).optional(),
  lossStopCount: z.number().int().min(1).max(20).optional(),
  // Profit set-aside: keep this share of each net win out of the trading
  // bankroll. Shared with the live bot editor.
  profitSkimPct: z.number().int().min(0).max(100).optional(),
}).refine((d) => d.mode !== "live" || d.budgetSol <= 10, {
  message: "Live deposits are capped at 10 SOL for now — profits are never capped and compound freely.",
}).refine((d) => d.universe !== "stocks" || d.mode === "paper", {
  message: "Tokenized Stocks Swing Bots are paper-only.",
});
export type CreateSwingStrategyInput = z.infer<typeof createSwingStrategySchema>;
