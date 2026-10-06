// ─── Swing Bot — autonomous swing-trading engine ─────────────────────────────
//
// The bot the user asked for: give it a bankroll and a run window, and it
// hunts for momentum tokens, buys, rides winners, cuts losers, and compounds
// proceeds into the next opportunity — no per-trade input. Its "judgment" is
// an honest, deterministic rule set (not a black box):
//
//   ENTRY — a candidate must clear ALL of:
//     • real liquidity (≥ minLiquidityUsd, default $20k)
//     • activity accelerating (1h volume running ≥1.5× its 24h hourly pace)
//     • positive-but-not-parabolic momentum (+1h up, but < +80% — don't buy
//       the top of a spike; not actively dumping on the 5m candle)
//     • genuine trading interest (24h volume ≥ half the pool depth)
//   EXIT — first rule to trip wins:
//     • stop-loss: quoted exit value ≤ entry − stopLossPct
//     • trailing stop: after the position is up trailArmPct, sell if it gives
//       back trailPct from its peak (lets 2×–5× runners run, banks the swing)
//     • volume fade: in profit and 1h volume has dried to <35% of entry-time
//       volume → take the money before the crowd leaves
//     • max hold: follows the bot's finite run window; disabled for Unlimited
//     • window end: everything liquidates when the run finishes
//
//   Valuations simulate executable key-free PumpApi local transactions for the
//   exact position size, so price impact and fees are inside every number shown.
//   LIVE swaps use PumpApi LOCAL transactions: only the worker public key leaves
//   PAIF; transaction validation, simulation, signing and broadcasting stay here.
//
// PAPER (default): identical logic, virtual bankroll, zero risk. The honest
// way to answer "what would it do with $100 for 5 days?".
// LIVE (opt-in, capped 2 SOL): dedicated worker wallet, same custody model as
// the arb executor — main wallet only funds it; sweeps only to the owner.

import { rpcFetchWithFallback } from "./rpc-fallback";
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  createCloseAccountInstruction,
} from "@solana/spl-token";
import { createCipheriv, createDecipheriv, randomBytes, createHash, createHmac, timingSafeEqual } from "crypto";
import bs58 from "bs58";
import { storage } from "./storage";
import { getMarketWeather } from "./market-weather";
import { getDollarFlow, dollarsLeaving, dollarsArriving, flowLabel, type DollarFlow } from "./dollar-flow";
import { getSwapQuote, getSwapTransaction, SOL_MINT, type JupiterQuoteResponse } from "./jupiter";
import { getRecentLaunches } from "./pump-portal";
import { getPumpApiLocalTransaction, getPumpApiRoundTripTransaction, parsePumpApiTransaction, validatePumpApiInstructionPolicy, MAX_PRIORITY_FEE_LAMPORTS } from "./pumpapi";
import { getFreshPumpApiPoolSafety, getRecentPumpApiLaunches, type PumpApiPoolSafety } from "./pumpapi-leaderboard";
import type { SwingStrategy, SwingPosition, SwingBuySignal, TokenizedStockCatalogRow } from "@workspace/db";
import { getUsEquityMarketSession, listVerifiedXStocksForSwingScan } from "./tokenized-stocks";

// Swing Bot intentionally does not consume the Helius key. PumpApi local
// transactions plus public Solana RPC keep this path account/key free.
const RPC_URL = "https://api.mainnet-beta.solana.com";
const conn = new Connection(RPC_URL, { commitment: "confirmed", fetch: rpcFetchWithFallback });

const FEE_RESERVE_LAMPORTS = 10_000n;
const DUST_LAMPORTS = 5_000n;
const MIN_TRADE_LAMPORTS = 2_000_000n; // 0.002 SOL — smaller just burns fees
// LIVE buy sizing must leave real headroom in the wallet, not just tx-fee
// dust: a PumpApi local buy can need the wSOL temp account rent
// (~0.00204 SOL, refunded in-tx but required upfront), the token ATA rent
// (~0.00204 SOL, locked until the sweep closes it), plus priority fees.
// User-hit prod bug: reserving only 10k lamports made EVERY watch-mode buy
// fail simulation with "custom program error: 0x1" (insufficient funds) —
// the bot retried forever and never bought. 0.008 SOL covers both rents plus
// a generous priority-fee margin; whatever isn't consumed sweeps home at the
// end of the run.
// 0.015 SOL per wallet. Was 0.008, which a Token-2022 buy (fomo man) blew past
// by a hair: up to 3 token-account rents (~0.006) + capped 0.002 tip + fees
// ≈ 0.0081 — every attempt failed simulation with 0x1 "insufficient funds"
// while the wallet looked funded. The cushion must cover the WORST route.
const LIVE_BUY_HEADROOM_LAMPORTS = 15_000_000n;

// ─── Platform fee — "we earn when you earn" ──────────────────────────────────
// Fees are deferred until a trade closes profitably. A winning round trip pays
// the locked rate on both the buy principal and sell proceeds; losing trades
// pay no platform fee. Each DCA/multi-wallet tranche settles independently.
// Fee-collection failures always fail in the USER's favor: trading still
// proceeds; the platform just isn't paid.
const SWING_FEE_BPS = 160n;
const MIN_FEE_TRANSFER_LAMPORTS = 10_000n; // dust fees are skipped (user's favor)
const SWING_FEE_VAULT = new PublicKey(
  process.env.PAIF_FEE_VAULT || "5x9y9cboqWWkckVmyqheQJyorojZrKvsv9SLjxNmZKNr",
);

// Investor loyalty tiers keyed on the owner's TOTAL live deposits (USD) across
// every bot, not a single bot: 1.6% Standard, 1.3% Premium at $10,000+, 1.0%
// VIP at $25,000+. The resulting tier is locked into strategy.feeBps ONCE at
// create time — a mid-run SOL price move never changes the user's deal.
// Unknown/zero price fails soft to the 1.6% default.
export function swingTierFeeBps(totalDepositUsd: number): number {
  if (!Number.isFinite(totalDepositUsd) || totalDepositUsd <= 0) return Number(SWING_FEE_BPS);
  if (totalDepositUsd >= 25_000) return 100;
  if (totalDepositUsd >= 10_000) return 130;
  return Number(SWING_FEE_BPS);
}

// The locked per-bot fee rate. NULL/garbage (legacy rows) → 1.6% default;
// sane range enforced so a corrupt row can never mean a 0% or 50% fee.
function feeBpsOf(s: SwingStrategy): bigint {
  const b = s.feeBps;
  return b != null && b >= 100 && b <= 1_000 ? BigInt(b) : SWING_FEE_BPS;
}

// "1.6%" / "1.3%" / "1%" — for user-facing copy.
function feePctLabel(s: SwingStrategy): string {
  const pct = Number(feeBpsOf(s)) / 100;
  return `${pct.toFixed(1).replace(/\.0$/, "")}%`;
}

function profitableRoundTripFeeLamports(gross: bigint, solIn: bigint, s: SwingStrategy): bigint {
  if (gross <= solIn) return 0n;
  const fee = ((gross + solIn) * feeBpsOf(s)) / 10_000n;
  const profit = gross - solIn;
  return fee < profit ? fee : profit;
}

function depositFeeLamports(size: bigint, s: SwingStrategy): bigint {
  return (size * feeBpsOf(s)) / 10_000n;
}

async function ensurePaperDepositFee(s: SwingStrategy): Promise<SwingStrategy> {
  if (s.mode !== "paper" || BigInt(s.feesPaidLamports ?? "0") > 0n || s.tradesExecuted > 0) return s;
  const budget = BigInt(s.budgetLamports);
  const bankroll = BigInt(s.paperBankrollLamports);
  const fee = depositFeeLamports(budget, s);
  if (fee <= 0n || bankroll !== budget) return s;
  const updated = await storage.updateSwingStrategy(s.id, {
    paperBankrollLamports: (bankroll - fee).toString(),
    feesPaidLamports: fee.toString(),
  });
  if (!updated) return s;
  await storage.addSwingEvent({
    strategyId: s.id, positionId: null, kind: "info", mint: null, symbol: null,
    detail: `Paper platform fee applied: ${feePctLabel(s)} of the starting bankroll (${(Number(fee) / LAMPORTS_PER_SOL).toFixed(5)} SOL), matching live-mode accounting.`,
    solLamports: fee.toString(),
  }).catch(() => {});
  return updated;
}

async function transferFeeToVault(kp: Keypair, lamports: bigint): Promise<boolean> {
  if (lamports < MIN_FEE_TRANSFER_LAMPORTS) return false;
  try {
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: SWING_FEE_VAULT, lamports: Number(lamports) }),
    );
    const latest = await withDeadline(conn.getLatestBlockhash("confirmed"), 15_000, "getLatestBlockhash");
    tx.recentBlockhash = latest.blockhash;
    tx.feePayer = kp.publicKey;
    tx.sign(kp);
    const sig = await withDeadline(conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 }), 45_000, "sendRawTransaction");
    await withDeadline(conn.confirmTransaction({ signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, "confirmed"), 90_000, "confirmTransaction");
    return true;
  } catch {
    return false; // user keeps the fee — never block or retry-loop a trade over it
  }
}

// Profit set-aside ("bank the win"). Returns how many lamports of a winning
// close's NET profit get taken out of the trading bankroll (0n when the trade
// lost, the setting is 0%, or the skim would be dust).
function skimLamports(realized: bigint, s: SwingStrategy): bigint {
  const pct = BigInt(Math.min(100, Math.max(0, s.profitSkimPct ?? 50)));
  if (realized <= 0n || pct <= 0n) return 0n;
  const skim = (realized * pct) / 100n;
  return skim >= MIN_FEE_TRANSFER_LAMPORTS ? skim : 0n;
}

// Live set-aside: send the skim from the selling wallet straight to the
// creation-time withdrawAddress. Fail-soft — a failed transfer never blocks a
// close; the SOL simply stays in the worker wallet and keeps trading.
async function transferSkimToOwner(kp: Keypair, withdrawAddress: string, lamports: bigint): Promise<boolean> {
  if (lamports < MIN_FEE_TRANSFER_LAMPORTS) return false;
  try {
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(withdrawAddress), lamports: Number(lamports) }),
    );
    const latest = await withDeadline(conn.getLatestBlockhash("confirmed"), 15_000, "getLatestBlockhash");
    tx.recentBlockhash = latest.blockhash;
    tx.feePayer = kp.publicKey;
    tx.sign(kp);
    const sig = await withDeadline(conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 }), 45_000, "sendRawTransaction");
    await withDeadline(conn.confirmTransaction({ signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, "confirmed"), 90_000, "confirmTransaction");
    return true;
  } catch {
    return false;
  }
}

async function recordFeesPaid(strategyId: string, lamports: bigint): Promise<void> {
  if (lamports <= 0n) return;
  const fresh = await storage.getSwingStrategy(strategyId);
  if (!fresh) return;
  await storage.updateSwingStrategy(strategyId, {
    feesPaidLamports: (BigInt(fresh.feesPaidLamports ?? "0") + lamports).toString(),
  });
}

export const SWING_HARD_MAX_BUDGET_LAMPORTS = 10n * BigInt(LAMPORTS_PER_SOL); // live DEPOSIT cap — profits are never capped and compound freely
// Re-entry cooldowns after exiting a token. "Sell smart, buy back in": a
// PROFITABLE exit only blocks re-entry for 1h — if the token is still running
// and re-passes every entry filter, the bot can ride it again. A LOSS (or a
// tokens-sent-home sweep) blocks it for 6h — that token proved dangerous.
const REENTRY_COOLDOWN_WIN_MS = 60 * 60 * 1000;
// "Ask me first" pending suggestions go stale after an hour — a pick the bot
// liked 60 min ago is no longer a "buy now" call. Stale ones flip to expired
// and drop off the panel (approving always buys at the CURRENT price anyway).
const APPROVAL_SIGNAL_TTL_MS = 60 * 60 * 1000;
// Smart scanners do not use an arbitrary wait after a profitable exit. The
// exited mint remains under review and can re-enter as soon as the detailed
// exit-price gate below proves either a dip has turned or a renewed run has
// unusually strong support. Loss cooldown is untouched — losing tokens stay
// benched so "buy the dip" never becomes automatic revenge trading.
const REENTRY_COOLDOWN_WIN_QUICK_MS = 0;
const REENTRY_COOLDOWN_LOSS_MS = 6 * 60 * 60 * 1000;
// A starred token's comeback lane normally bypasses the post-exit cooldown
// ("the star IS permission"). But after a LOSS exit on that same mint, even a
// starred token must wait this long before a comeback re-buy — the SOLdiers
// churn (July 2026): stopped out −4.6%, comeback-rebought 19 minutes later,
// stopped out −4.6% again. The star is permission to watch, not to revenge-buy.
const LOSS_COMEBACK_BLOCK_MS = 60 * 60 * 1000;

// Mints whose LATEST closed exit was a loss inside LOSS_COMEBACK_BLOCK_MS.
// "Latest" matters: a loss followed by a clean win on the same mint clears the
// brake — only the most recent exit per mint is judged.
function computeRecentLossExits(positions: SwingPosition[]): Set<string> {
  const latestByMint = new Map<string, SwingPosition>();
  for (const p of positions) {
    if (p.status !== "closed" || !p.closedAt) continue;
    const prev = latestByMint.get(p.mint);
    if (!prev || new Date(p.closedAt).getTime() > new Date(prev.closedAt!).getTime()) {
      latestByMint.set(p.mint, p);
    }
  }
  const out = new Set<string>();
  for (const [mint, p] of Array.from(latestByMint.entries())) {
    if (Date.now() - new Date(p.closedAt!).getTime() >= LOSS_COMEBACK_BLOCK_MS) continue;
    const wasLoss = p.exitReason === "tokens_sent_home"
      || BigInt(p.solOutLamports ?? "0") <= BigInt(p.solInLamports);
    if (wasLoss) out.add(mint);
  }
  return out;
}

// "Don't chase your own exit" (user's UPTOBER case, July 2026): the bot banked
// +22% on a trailing stop, then re-bought the SAME token 23 minutes later at a
// HIGHER price once the short quick-win cooldown lapsed and momentum still
// screened well — paying a premium for a token it just owned cheaper, right
// after a big run. For this window after a WINNING exit, that mint's re-buy
// gets a detailed re-scan keyed to our exit price (see the two-mode gate in
// findEntryCandidate): at/below the exit needs a clean fresh tape; above the
// exit needs extra-strong proof the run is fresh, not stale.
const EXIT_CHASE_BLOCK_MS = 6 * 60 * 60 * 1000;
// Latest closed WIN per mint inside the window, keyed to its exit price.
// Only the most recent exit per mint is judged (a later loss supersedes it —
// the loss cooldown handles that mint instead). Missing exit price = no
// ceiling (never invent a number to block a trade on).
export function computeExitChaseCeilings(positions: SwingPosition[]): Map<string, number> {
  const latestByMint = new Map<string, SwingPosition>();
  for (const p of positions) {
    if (p.status !== "closed" || !p.closedAt) continue;
    const prev = latestByMint.get(p.mint);
    if (!prev || new Date(p.closedAt).getTime() > new Date(prev.closedAt!).getTime()) {
      latestByMint.set(p.mint, p);
    }
  }
  const out = new Map<string, number>();
  for (const [mint, p] of Array.from(latestByMint.entries())) {
    if (Date.now() - new Date(p.closedAt!).getTime() >= EXIT_CHASE_BLOCK_MS) continue;
    const wasWin = p.exitReason !== "tokens_sent_home"
      && BigInt(p.solOutLamports ?? "0") > BigInt(p.solInLamports);
    const exitPrice = p.exitPriceUsd != null && p.exitPriceUsd > 0 ? p.exitPriceUsd : null;
    if (wasWin && exitPrice != null) out.set(mint, exitPrice);
  }
  return out;
}

// ─── Encryption at rest — shares AUTO_STRATEGY_ENCRYPTION_KEY ────────────────
export function isSwingConfigured(): boolean {
  return !!process.env.AUTO_STRATEGY_ENCRYPTION_KEY;
}

function getEncryptionKey(): Buffer {
  const raw = process.env.AUTO_STRATEGY_ENCRYPTION_KEY;
  if (!raw) throw new Error("AUTO_STRATEGY_ENCRYPTION_KEY is not configured — the swing bot cannot operate worker wallets.");
  return createHash("sha256").update(raw, "utf8").digest();
}

function encryptSecret(plain: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

function decryptSecret(blob: string): string {
  const key = getEncryptionKey();
  const [ivB64, tagB64, dataB64] = blob.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed encrypted key.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

export function generateSwingWorkerWallet(): { pubkey: string; encryptedKey: string } {
  const kp = Keypair.generate();
  return { pubkey: kp.publicKey.toBase58(), encryptedKey: encryptSecret(bs58.encode(kp.secretKey)) };
}

function loadKeypair(encryptedKey: string): Keypair {
  return Keypair.fromSecretKey(bs58.decode(decryptSecret(encryptedKey)));
}

// ─── Multi-sub-wallet DCA ────────────────────────────────────────────────────
// Watch + Long ride bots can spread the deposit across up to 25 worker wallets
// (same AES-256-GCM custody). Wallet 0 = workerWallet/encryptedKey; wallet i
// (i ≥ 1) = extraWallets[i-1]/extraEncryptedKeys[i-1]. Every buy records its
// walletIndex on the position; sells/sweeps sign with THAT wallet.
export const SWING_MAX_SUB_WALLETS = 25;

export function generateExtraSwingWallets(count: number): { pubkeys: string[]; encryptedKeys: string[] } {
  const pubkeys: string[] = [];
  const encryptedKeys: string[] = [];
  for (let i = 0; i < count; i++) {
    const w = generateSwingWorkerWallet();
    pubkeys.push(w.pubkey);
    encryptedKeys.push(w.encryptedKey);
  }
  return { pubkeys, encryptedKeys };
}

// How many REAL wallets this live bot can sign with (never more than exist —
// a legacy row with subWalletCount > generated wallets degrades to what's there).
function walletCount(s: SwingStrategy): number {
  const wanted = Math.max(1, Math.min(s.subWalletCount ?? 1, SWING_MAX_SUB_WALLETS));
  return Math.min(wanted, 1 + (s.extraWallets?.length ?? 0));
}

// How many DCA tranches the bot trades in. Paper has no real extra wallets
// (nothing to sign), but MUST honor the chosen count so paper results
// honestly predict live tranche-by-tranche behavior.
function dcaTrancheCount(s: SwingStrategy): number {
  const wanted = Math.max(1, Math.min(s.subWalletCount ?? 1, SWING_MAX_SUB_WALLETS));
  return s.mode === "paper" ? wanted : walletCount(s);
}

function walletPubkeyAt(s: SwingStrategy, idx: number): string {
  if (idx <= 0) return s.workerWallet;
  const pk = s.extraWallets?.[idx - 1];
  if (!pk) throw new Error(`Sub-wallet ${idx} not found for this bot.`);
  return pk;
}

function walletKeypairAt(s: SwingStrategy, idx: number): Keypair {
  if (idx <= 0) return loadKeypair(s.encryptedKey);
  const ek = s.extraEncryptedKeys?.[idx - 1];
  if (!ek) throw new Error(`Sub-wallet ${idx} key not found for this bot.`);
  return loadKeypair(ek);
}

// Per-wallet SOL balances. Each wallet keeps its OWN buy headroom (each pays
// its own wSOL/ATA rents + priority fees), so combined spendable is the sum
// of per-wallet spendables — never (total − one headroom).
async function walletBalances(s: SwingStrategy): Promise<{ idx: number; balance: bigint; spendable: bigint }[]> {
  const out: { idx: number; balance: bigint; spendable: bigint }[] = [];
  for (let i = 0; i < walletCount(s); i++) {
    const balance = await getSwingSolBalance(walletPubkeyAt(s, i));
    out.push({
      idx: i,
      balance,
      spendable: balance > LIVE_BUY_HEADROOM_LAMPORTS ? balance - LIVE_BUY_HEADROOM_LAMPORTS : 0n,
    });
  }
  return out;
}

async function combinedSpendable(s: SwingStrategy): Promise<bigint> {
  const ws = await walletBalances(s);
  return ws.reduce((a, w) => a + w.spendable, 0n);
}

// Buy wallet = the richest spendable balance. Self-balancing (each buy drains
// the fullest wallet next) and tolerant of an uneven or failed distribution —
// the bot still trades with whatever landed where.
async function pickBuyWallet(s: SwingStrategy): Promise<{ idx: number; kp: Keypair; spendable: bigint }> {
  const ws = await walletBalances(s);
  ws.sort((a, b) => (b.spendable > a.spendable ? 1 : b.spendable < a.spendable ? -1 : a.idx - b.idx));
  const top = ws[0];
  return { idx: top.idx, kp: walletKeypairAt(s, top.idx), spendable: top.spendable };
}

// ── DCA pacing (multi-wallet watch bots) ────────────────────────────────────
// IN: tranches enter ~20 min apart so the entry price averages over time.
// OUT: when the exit engine says sell, tranches leave ~90s apart (one per
// pass) instead of market-dumping the whole bag in one tick — EXCEPT for
// emergencies, where every tranche exits immediately: pacing must never hold
// a position through a rug or a hard stop.
const DCA_TRANCHE_SPACING_MS = 20 * 60 * 1000;
const DCA_EXIT_SPACING_MS = 90_000;
const IMMEDIATE_EXIT_REASONS = new Set([
  "stop_loss", "liquidity_drained", "window_end", "manual_stop", "rug", "dust_hold",
]);

// True → skip selling THIS tranche this pass (another just sold, or one sold
// < 90s ago). Fail-OPEN on a DB error: a storage hiccup must never block an
// exit — worst case the tranches sell together, which is only the old behavior.
async function shouldDeferTrancheExit(
  s: SwingStrategy,
  p: SwingPosition,
  reason: string,
  closedThisPass: Set<string>,
): Promise<boolean> {
  if (dcaTrancheCount(s) <= 1 || !s.targetMint || p.mint !== s.targetMint) return false;
  if (IMMEDIATE_EXIT_REASONS.has(reason)) return false;
  if (closedThisPass.has(p.mint)) return true; // one tranche per pass
  try {
    const closed = await storage.listSwingPositions(s.id, "closed");
    const lastClose = closed
      .filter((x) => x.mint === p.mint && x.closedAt)
      .reduce((m, x) => Math.max(m, new Date(x.closedAt!).getTime()), 0);
    return lastClose > 0 && Date.now() - lastClose < DCA_EXIT_SPACING_MS;
  } catch {
    return false;
  }
}

// ─── Read-session tokens (namespaced "swing") ────────────────────────────────
const READ_TOKEN_TTL_MS = 30 * 60 * 1000;

export function issueSwingReadToken(ownerWallet: string, ttlMs: number = READ_TOKEN_TTL_MS): string {
  const exp = Date.now() + ttlMs;
  const payload = `swing.${ownerWallet}.${exp}`;
  const mac = createHmac("sha256", getEncryptionKey()).update(payload).digest("base64url");
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${mac}`;
}

export function verifySwingReadToken(token: string): string | null {
  try {
    const [payloadB64, mac] = token.split(".");
    if (!payloadB64 || !mac) return null;
    const payload = Buffer.from(payloadB64, "base64url").toString("utf8");
    const expected = createHmac("sha256", getEncryptionKey()).update(payload).digest("base64url");
    const macBuf = Buffer.from(mac);
    const expBuf = Buffer.from(expected);
    if (macBuf.length !== expBuf.length || !timingSafeEqual(macBuf, expBuf)) return null;
    const [ns, ownerWallet, expStr] = payload.split(".");
    if (ns !== "swing" || !ownerWallet || !expStr || Date.now() > Number(expStr)) return null;
    return ownerWallet;
  } catch {
    return null;
  }
}

// ─── On-chain helpers ────────────────────────────────────────────────────────
// Every external await in the tick path MUST have a deadline. A single call
// that never settles freezes that bot forever: the tick's in-flight guard and
// per-strategy lock only release when the pass finishes.
function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export async function getSwingSolBalance(pubkey: string): Promise<bigint> {
  return BigInt(await withDeadline(
    conn.getBalance(new PublicKey(pubkey), "confirmed"),
    15_000,
    "getBalance",
  ));
}

interface TokenHolding {
  mint: string;
  amountRaw: bigint;
  decimals: number;
  programId: PublicKey;
  ata: PublicKey;
}

async function getTokenHoldings(owner: PublicKey, includeEmpty = false): Promise<TokenHolding[]> {
  const holdings: TokenHolding[] = [];
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    let res;
    try {
      res = await withDeadline(conn.getParsedTokenAccountsByOwner(owner, { programId }, "confirmed"), 20_000, "getParsedTokenAccountsByOwner");
    } catch {
      continue;
    }
    for (const { pubkey, account } of res.value) {
      const info = (account.data as any)?.parsed?.info;
      if (!info) continue;
      const amountRaw = BigInt(info.tokenAmount?.amount ?? "0");
      if (amountRaw <= 0n && !includeEmpty) continue;
      holdings.push({
        mint: info.mint as string,
        amountRaw,
        decimals: Number(info.tokenAmount?.decimals ?? 0),
        programId,
        ata: pubkey,
      });
    }
  }
  return holdings;
}

// Delete-guard check: does the worker wallet hold ANY tokens (either token
// program)? Unlike getTokenHoldings, this THROWS on RPC failure — a delete
// guard must never mistake "couldn't check" for "empty".
export async function workerHoldsTokens(pubkey: string): Promise<boolean> {
  const owner = new PublicKey(pubkey);
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const res = await withDeadline(conn.getParsedTokenAccountsByOwner(owner, { programId }, "confirmed"), 20_000, "getParsedTokenAccountsByOwner");
    for (const { account } of res.value) {
      const amountRaw = BigInt((account.data as any)?.parsed?.info?.tokenAmount?.amount ?? "0");
      if (amountRaw > 0n) return true;
    }
  }
  return false;
}

async function readMintBalance(owner: PublicKey, mint: string): Promise<{ amountRaw: bigint; decimals: number }> {
  const holdings = await getTokenHoldings(owner);
  const matching = holdings.filter((x) => x.mint === mint);
  return {
    amountRaw: matching.reduce((sum, h) => sum + h.amountRaw, 0n),
    decimals: matching[0]?.decimals ?? 0,
  };
}

async function readMintDecimals(mint: string): Promise<number> {
  const info = await withDeadline(conn.getParsedAccountInfo(new PublicKey(mint), "confirmed"), 20_000, "getParsedAccountInfo");
  const decimals = (info.value?.data as any)?.parsed?.info?.decimals;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error("Couldn't verify token decimals.");
  return decimals;
}

async function readMintSnapshotStrict(owner: PublicKey, mint: string): Promise<{
  amountRaw: bigint;
  decimals: number;
  accounts: Array<{ pubkey: PublicKey; amountRaw: bigint }>;
}> {
  const accounts: Array<{ pubkey: PublicKey; amountRaw: bigint }> = [];
  let decimals = 0;
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const response = await withDeadline(
      conn.getParsedTokenAccountsByOwner(owner, { programId }, "confirmed"),
      20_000,
      "getParsedTokenAccountsByOwner",
    );
    for (const item of response.value) {
      const info = (item.account.data as any)?.parsed?.info;
      if (info?.mint !== mint) continue;
      const amountRaw = BigInt(info.tokenAmount?.amount ?? "0");
      decimals = Number(info.tokenAmount?.decimals ?? decimals);
      accounts.push({ pubkey: item.pubkey, amountRaw });
    }
  }
  if (accounts.length > 12) throw new Error("Too many token accounts to validate this trade safely.");
  return { amountRaw: accounts.reduce((sum, account) => sum + account.amountRaw, 0n), decimals, accounts };
}

async function signSendConfirm(
  b64: string, kp: Keypair,
  onSigned?: (sig: string, recentBlockhash: string) => Promise<void>,
  onSent?: (sig: string) => Promise<void>,
): Promise<string> {
  const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
  tx.sign([kp]);
  const expectedSig = bs58.encode(tx.signatures[0]);
  // Durable intent must exist before any broadcast. Persistence failure is a
  // hard stop and is deliberately not swallowed.
  if (onSigned) await onSigned(expectedSig, tx.message.recentBlockhash);
  const sig = await withDeadline(conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 }), 45_000, "sendRawTransaction");
  // Let the caller persist the signature BEFORE we wait on confirmation — if
  // the process dies or the confirm poll times out, the sent sig must not be
  // lost (user-hit bug: a sell landed, its sig was never saved, and the next
  // tick booked a -100% full loss on a trade that actually returned ~94%).
  if (sig !== expectedSig) throw new Error("RPC returned an unexpected transaction signature");
  if (onSent) await onSent(sig);
  // Poll the signature's own status — never confirm against a fresher blockhash
  // (the local transaction carries its own; racing expiry yields false negatives that
  // corrupt P&L accounting).
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const { value } = await withDeadline(conn.getSignatureStatuses([sig]), 15_000, "getSignatureStatuses");
    const st = value[0];
    if (st) {
      if (st.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(st.err)}`);
      if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") return sig;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Transaction not confirmed within 60s (it may still land — check the worker wallet).");
}

const PUMP_TRADE_FEE_BPS = 25n;
const BPS_DENOMINATOR = 10_000n;

function simulatedTokenAmount(account: any): bigint {
  if (!account || !Array.isArray(account.data) || typeof account.data[0] !== "string") return 0n;
  const data = Buffer.from(account.data[0], "base64");
  // Both SPL Token and Token-2022 accounts keep the canonical amount at byte 64.
  if (data.length < 72) return 0n;
  return data.readBigUInt64LE(64);
}

interface ExecutablePumpQuote { outputRaw: bigint; tokenDecimals: number; ownerSolDelta: bigint; }
function pinnedPositionPool(p: SwingPosition): PumpApiPoolSafety | null {
  const poolId = (p as any).entryPumpPoolId as string | null;
  const quoteMint = (p as any).entryPumpQuoteMint as string | null;
  if (!poolId || quoteMint !== SOL_MINT) return null;
  return { mint: p.mint, poolId, quoteMint, pool: "entry-pinned", poolCreatedBy: "entry-pinned",
    creatorWallet: "entry-pinned", burnedLiquidity: 1, poolFeeRate: 0, poolFeeRateAfterMigration: null,
    mayhemMode: null, observedAt: 0 };
}
async function exitPoolForPosition(p: SwingPosition): Promise<PumpApiPoolSafety | null> {
  const pinned = pinnedPositionPool(p);
  if (pinned) return pinned;
  const fresh = getFreshPumpApiPoolSafety(p.mint);
  if (fresh) {
    await storage.updateSwingPosition(p.id, {
      entryPumpPoolId: fresh.poolId, entryPumpQuoteMint: fresh.quoteMint,
    } as any).catch(() => {});
    return fresh;
  }
  try {
    const legacy = p.entryPairAddress ? new PublicKey(p.entryPairAddress).toBase58() : null;
    if (!legacy) return null;
    return { mint: p.mint, poolId: legacy, quoteMint: SOL_MINT, pool: "legacy-entry-pair",
      poolCreatedBy: "legacy", creatorWallet: "legacy", burnedLiquidity: 0,
      poolFeeRate: 0, poolFeeRateAfterMigration: null, mayhemMode: null, observedAt: 0 };
  } catch { return null; }
}
export function executableOutputFloor(outputRaw: bigint, slippageBps: number): bigint {
  const bps = Math.max(0, Math.min(1_000, Math.floor(slippageBps)));
  return ((outputRaw * BigInt(10_000 - bps)) / 10_000n) || 1n;
}
export function executableImpactPct(fullOut: bigint, fullIn: bigint, smallOut: bigint, smallIn: bigint): number {
  if (fullOut <= 0n || fullIn <= 0n || smallOut <= 0n || smallIn <= 0n) return Infinity;
  const fullUnit = fullOut * smallIn;
  const smallUnit = smallOut * fullIn;
  if (smallUnit <= fullUnit) return 0;
  return Number(((smallUnit - fullUnit) * 10_000n) / smallUnit) / 100;
}

/** Paper cannot fabricate an account balance for public-RPC simulation. A
 * configured PAIF quote worker is therefore an explicit, read-only fixture: it
 * is never signed or sent, needs SOL for entry simulations, and must not hold
 * candidate tokens used by the atomic sell-back check. */
function paperQuoteWallet(): string {
  const wallet = process.env.PUMPAPI_PAPER_QUOTE_WALLET;
  if (!wallet) throw new Error("Paper executable quotes require PUMPAPI_PAPER_QUOTE_WALLET: a funded public wallet used only with RPC simulateTransaction (never signed or spent).");
  return new PublicKey(wallet).toBase58();
}
export function pendingBuyDecision(
  signature: "success" | "failed" | "missing" | "unknown",
  blockhashValid: boolean | null,
): "keep" | "buy_failed" | "buy_expired" {
  if (signature === "failed") return "buy_failed";
  if (signature !== "missing") return "keep";
  return blockhashValid === false ? "buy_expired" : "keep";
}

/** Builds an unsigned, pool-pinned local transaction and simulates it on the
 * public RPC.  This is intentionally the only valuation primitive used by
 * Swing: no spot-price or aggregator quote can make a token appear sellable. */
async function simulateExecutablePumpQuote(
  action: "buy" | "sell", publicKey: string, mint: string, amountRaw: bigint,
  tokenDecimals: number, slippageBps: number, pool: PumpApiPoolSafety,
): Promise<ExecutablePumpQuote> {
  if (pool.mint !== mint || pool.quoteMint !== SOL_MINT) throw new Error("Pinned pool metadata does not match trade");
  const built = await getPumpApiLocalTransaction({
    publicKey, action, mint, poolId: pool.poolId, quoteMint: pool.quoteMint, amountRaw, tokenDecimals,
    // A quote transaction is never sent. Tiny absolute bounds let RPC execution
    // reveal the route result; real sends are rebuilt with its measured floor.
    minimumOutputRaw: 1n, expectedOutputRaw: action === "buy" ? 1n : 1_000n * BigInt(LAMPORTS_PER_SOL),
    outputDecimals: action === "buy" ? tokenDecimals : 9,
    slippage: Math.max(0.5, Math.min(10, slippageBps / 100)), priorityFeeLamports: 0n,
  }, { connection: conn });
  const tx = VersionedTransaction.deserialize(Buffer.from(built.transactionBase64, "base64"));
  const owner = new PublicKey(publicKey);
  const preToken = action === "buy" ? await readMintSnapshotStrict(owner, mint) : null;
  const addresses = [owner.toBase58()];
  if (action === "buy") {
    addresses.push(getAssociatedTokenAddressSync(new PublicKey(mint), owner, false, TOKEN_PROGRAM_ID).toBase58());
    addresses.push(getAssociatedTokenAddressSync(new PublicKey(mint), owner, false, TOKEN_2022_PROGRAM_ID).toBase58());
  }
  const simulation = await withDeadline(conn.simulateTransaction(tx, {
    commitment: "confirmed", sigVerify: false, accounts: { encoding: "base64", addresses },
  }), 30_000, "simulateTransaction");
  if (simulation.value.err || !simulation.value.accounts?.[0]) throw new Error(`PumpApi simulation failed${simulation.value.err ? `: ${JSON.stringify(simulation.value.err)}` : ""}`);
  const preOwnerSol = BigInt(await withDeadline(conn.getBalance(owner, "confirmed"), 15_000, "getBalance"));
  const ownerSolDelta = BigInt(simulation.value.accounts[0].lamports) - preOwnerSol;
  if (action === "sell") {
    const out = ownerSolDelta;
    if (out <= 0n) throw new Error("PumpApi sell simulation returned no SOL");
    return { outputRaw: out, tokenDecimals, ownerSolDelta };
  }
  const out = simulation.value.accounts.slice(1).reduce((sum, account) => sum + simulatedTokenAmount(account), 0n)
    - (preToken?.amountRaw ?? 0n);
  if (out <= 0n) throw new Error("PumpApi buy simulation returned no tokens");
  return { outputRaw: out, tokenDecimals, ownerSolDelta };
}

async function simulatePaperHolderSell(p: SwingPosition, pool: PumpApiPoolSafety, slippageBps: number): Promise<bigint> {
  const wanted = BigInt(p.tokenAmountRaw);
  const fixtureText = paperQuoteWallet();
  const fixture = new PublicKey(fixtureText);
  const largest = await withDeadline(conn.getTokenLargestAccounts(new PublicKey(p.mint), "confirmed"), 20_000, "getTokenLargestAccounts");
  for (const candidate of largest.value.slice(0, 12)) {
    if (BigInt(candidate.amount) < wanted) continue;
    try {
      const info = await withDeadline(conn.getParsedAccountInfo(candidate.address, "confirmed"), 15_000, "getParsedAccountInfo");
      const ownerText = (info.value?.data as any)?.parsed?.info?.owner;
      if (typeof ownerText !== "string") continue;
      const owner = new PublicKey(ownerText);
      if (!PublicKey.isOnCurve(owner.toBytes())) continue;
      const sol = await withDeadline(conn.getBalance(owner, "confirmed"), 15_000, "getBalance");
      if (sol < 1_000_000) continue;
      const tokenProgram = info.value?.owner;
      if (!tokenProgram?.equals(TOKEN_PROGRAM_ID) && !tokenProgram?.equals(TOKEN_2022_PROGRAM_ID)) continue;
      // PumpApi sees only PAIF's configured public simulation fixture. Locally,
      // adapt the unsigned simulation-only transaction to current holder state.
      const built = await getPumpApiLocalTransaction({
        publicKey: fixtureText, action: "sell", mint: p.mint, poolId: pool.poolId,
        quoteMint: pool.quoteMint, amountRaw: wanted, tokenDecimals: p.decimals,
        minimumOutputRaw: 1n, expectedOutputRaw: 1_000n * BigInt(LAMPORTS_PER_SOL),
        outputDecimals: 9, slippage: Math.max(0.5, Math.min(10, slippageBps / 100)),
        priorityFeeLamports: 0n,
      }, { connection: conn });
      const original = Buffer.from(built.transactionBase64, "base64");
      const tx = parsePumpApiTransaction(original, fixtureText);
      const fixtureAta = getAssociatedTokenAddressSync(new PublicKey(p.mint), fixture, false, tokenProgram);
      const ataIndexes = tx.message.staticAccountKeys
        .map((key, index) => key.equals(fixtureAta) ? index : -1).filter((index) => index >= 0);
      if (ataIndexes.length !== 1 || !tx.message.staticAccountKeys[0]?.equals(fixture)) {
        throw new Error("Paper sell transaction requires lookup-only or ambiguous owner keys");
      }
      tx.message.staticAccountKeys[0] = owner;
      tx.message.staticAccountKeys[ataIndexes[0]] = candidate.address;
      parsePumpApiTransaction(tx.serialize(), owner.toBase58());
      validatePumpApiInstructionPolicy(tx, {
        publicKey: owner.toBase58(), action: "sell", mint: p.mint, poolId: pool.poolId,
        quoteMint: pool.quoteMint, amountRaw: wanted, tokenDecimals: p.decimals,
        minimumOutputRaw: 1n, expectedOutputRaw: 1_000n * BigInt(LAMPORTS_PER_SOL),
        outputDecimals: 9, slippage: Math.max(0.5, Math.min(10, slippageBps / 100)),
        priorityFeeLamports: 0n,
      });
      const simulation = await withDeadline(conn.simulateTransaction(tx, {
        commitment: "confirmed", sigVerify: false,
        accounts: { encoding: "base64", addresses: [owner.toBase58()] },
      }), 30_000, "simulateTransaction");
      if (simulation.value.err || !simulation.value.accounts?.[0]) throw new Error("Adapted paper sell simulation failed");
      const out = BigInt(simulation.value.accounts[0].lamports) - BigInt(sol);
      if (out <= 0n) throw new Error("Adapted paper sell returned no SOL");
      return out;
    } catch {
      // A whale can be a PDA, close its account, or fail this route between
      // reads. Continue through a bounded public candidate set.
    }
  }
  throw new Error("No on-curve funded holder can simulate this exact paper sell");
}

async function buildValidatedPumpSwap(
  action: "buy" | "sell",
  kp: Keypair,
  mint: string,
  amountRaw: bigint,
  tokenDecimals: number,
  slippageBps: number,
  minimumExpectedOutRaw: bigint,
  expectedOutRaw: bigint,
  pool: PumpApiPoolSafety,
): Promise<string> {
  const owner = kp.publicKey;
  const mintKey = new PublicKey(mint);
  const preSol = BigInt(await withDeadline(conn.getBalance(owner, "confirmed"), 20_000, "getBalance"));
  const preToken = await readMintSnapshotStrict(owner, mint);
  const allOwnerTokens = await getTokenHoldings(owner, true);
  if (allOwnerTokens.length > 24) throw new Error("Too many owner token accounts to simulate trade safely.");
  const built = await getPumpApiLocalTransaction({
    publicKey: owner.toBase58(),
    action,
    mint,
    poolId: pool.poolId,
    quoteMint: pool.quoteMint,
    amountRaw,
    tokenDecimals,
    minimumOutputRaw: minimumExpectedOutRaw,
    expectedOutputRaw: expectedOutRaw,
    outputDecimals: action === "buy" ? tokenDecimals : 9,
    slippage: Math.max(0.5, Math.min(10, slippageBps / 100)),
    priorityFeeLamports: MAX_PRIORITY_FEE_LAMPORTS,
  }, { connection: conn });

  const tx = VersionedTransaction.deserialize(Buffer.from(built.transactionBase64, "base64"));
  tx.sign([kp]);
  const standardAta = getAssociatedTokenAddressSync(mintKey, owner, false, TOKEN_PROGRAM_ID);
  const token2022Ata = getAssociatedTokenAddressSync(mintKey, owner, false, TOKEN_2022_PROGRAM_ID);
  const tokenAddresses = [...preToken.accounts.map((account) => account.pubkey), standardAta, token2022Ata]
    .filter((key, index, all) => all.findIndex((candidate) => candidate.equals(key)) === index);
  const intendedAddressCount = tokenAddresses.length;
  for (const holding of allOwnerTokens) {
    if (!tokenAddresses.some((key) => key.equals(holding.ata))) tokenAddresses.push(holding.ata);
  }
  const simulation = await withDeadline(conn.simulateTransaction(tx, {
    commitment: "confirmed",
    sigVerify: true,
    accounts: {
      encoding: "base64",
      addresses: [owner.toBase58(), ...tokenAddresses.map((address) => address.toBase58())],
    },
  }), 30_000, "simulateTransaction");
  if (simulation.value.err) {
    throw new Error(`PumpApi transaction simulation failed: ${JSON.stringify(simulation.value.err)}`);
  }
  const accounts = simulation.value.accounts;
  if (!accounts || accounts.length !== tokenAddresses.length + 1 || !accounts[0]) {
    throw new Error("PumpApi transaction simulation returned no account state");
  }
  const postSol = BigInt(accounts[0].lamports);
  const postToken = accounts.slice(1, intendedAddressCount + 1).reduce((sum, account) => sum + simulatedTokenAmount(account), 0n);
  // Every pre-existing unrelated worker account was explicitly requested in
  // simulation. Any mutation is hostile, even if the program ID was allowed.
  for (let index = intendedAddressCount; index < tokenAddresses.length; index++) {
    const before = allOwnerTokens.find((h) => h.ata.equals(tokenAddresses[index]))?.amountRaw ?? 0n;
    if (simulatedTokenAmount(accounts[index + 1]) !== before) {
      throw new Error("PumpApi simulation changed an unrelated owner token account");
    }
  }
  const fee = await withDeadline(conn.getFeeForMessage(tx.message, "confirmed"), 20_000, "getFeeForMessage");
  if (fee.value == null) throw new Error("Couldn't verify PumpApi transaction fee");
  const networkFee = BigInt(fee.value);
  const existing = new Set(allOwnerTokens.map((account) => account.ata.toBase58()));
  const newTokenAccountRent = accounts.slice(1, intendedAddressCount + 1).reduce((sum, account, index) => {
    if (!account || existing.has(tokenAddresses[index].toBase58())) return sum;
    return sum + BigInt(account.lamports);
  }, 0n);

  if (action === "buy") {
    const tokenOut = postToken - preToken.amountRaw;
    const solSpent = preSol > postSol ? preSol - postSol : 0n;
    if (tokenOut <= 0n) throw new Error("PumpApi buy simulation returned no tokens");
    if (tokenOut < minimumExpectedOutRaw) {
      throw new Error("PumpApi buy route is materially worse than the executable quote");
    }
    const providerFee = (amountRaw * PUMP_TRADE_FEE_BPS + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
    const maximumSpend = amountRaw + providerFee + networkFee + newTokenAccountRent + 10_000n;
    if (solSpent < amountRaw || solSpent > maximumSpend) {
      throw new Error("PumpApi buy transaction exceeds the approved spend");
    }
  } else {
    const tokenSpent = preToken.amountRaw > postToken ? preToken.amountRaw - postToken : 0n;
    const solOut = postSol > preSol ? postSol - preSol : 0n;
    if (tokenSpent !== amountRaw) throw new Error("PumpApi sell transaction spends an unexpected token amount");
    if (solOut <= 0n) throw new Error("PumpApi sell simulation returned no SOL");
    const providerFee = (minimumExpectedOutRaw * PUMP_TRADE_FEE_BPS + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
    const minimumNetOut = minimumExpectedOutRaw > providerFee + networkFee
      ? minimumExpectedOutRaw - providerFee - networkFee
      : 0n;
    if (solOut < minimumNetOut) {
      throw new Error("PumpApi sell route is materially worse than the executable quote");
    }
  }
  const blockhashValid = await withDeadline(conn.isBlockhashValid(tx.message.recentBlockhash, {
    commitment: "confirmed",
  }), 15_000, "isBlockhashValid");
  if (!blockhashValid.value) throw new Error("PumpApi transaction expired before signing");
  return built.transactionBase64;
}

function isUnsubmittedBlockhashError(error: unknown): boolean {
  return /blockhash|expired before signing|transaction expired/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

async function executeValidatedPumpSwap(
  action: "buy" | "sell",
  kp: Keypair,
  mint: string,
  amountRaw: bigint,
  tokenDecimals: number,
  slippageBps: number,
  minimumExpectedOutRaw: bigint,
  expectedOutRaw: bigint,
  pool: PumpApiPoolSafety,
  onSigned?: (signature: string, recentBlockhash: string) => Promise<void>,
  onSent?: (signature: string) => Promise<void>,
): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let submitted = false;
    try {
      const transaction = await buildValidatedPumpSwap(
        action,
        kp,
        mint,
        amountRaw,
        tokenDecimals,
        slippageBps,
        minimumExpectedOutRaw,
        expectedOutRaw,
        pool,
      );
      return await signSendConfirm(transaction, kp, onSigned, async (signature) => {
        submitted = true;
        if (onSent) await onSent(signature);
      });
    } catch (error) {
      // A stale unsigned transaction is safe to replace only when no signature
      // was returned by sendRawTransaction. Once submitted, existing signature
      // recovery owns the outcome and we must never create a second trade.
      if (!submitted && attempt === 0 && isUnsubmittedBlockhashError(error)) continue;
      throw error;
    }
  }
  throw new Error("PumpApi transaction expired twice before submission");
}

// ─── Market data (DexScreener, cached) ───────────────────────────────────────
interface CandidateStats {
  mint: string;
  symbol: string;
  name: string | null;
  priceUsd: number;
  // Quote-token (SOL) price per token — lets us derive SOL/USD at entry
  // (priceUsd / priceNative) to compute the TRUE on-chain fill price.
  priceNative: number;
  liquidityUsd: number;
  liquidityKnown: boolean;
  volH1Usd: number;
  volH1Known: boolean;
  volH24Usd: number;
  chgM5: number;
  // Distinguish "flat 5m" from "field missing" — count-based sell tells gated
  // on chgM5 <= 0 must never treat a partial payload as bearish confirmation.
  chgM5Known: boolean;
  chgH1: number;
  chgH6: number;
  chgH24: number;
  pairCreatedAt: number | null;
  buysH1: number;
  sellsH1: number;
  buysM5: number;
  sellsM5: number;
  pairAddress: string | null;
}

const SOLANA_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// TRUE per-token fill price in USD from the actual amounts that moved:
// (SOL spent ÷ tokens received) × SOL/USD at entry (derived from the pick's
// priceUsd/priceNative pair). The chart price at pick time understates what a
// buy on a thin/fast pool really paid (pool fee + the buy's own price push) —
// user-hit case: SalaryCat filled ~10% above the printed chart price, so the
// position showed red while the chart sat above the printed entry.
// Returns null when any input is missing — never fabricate a price.
function computeFillPriceUsd(
  pick: { priceUsd: number; priceNative: number },
  solSpentLamports: bigint,
  tokensRaw: bigint,
  decimals: number,
): number | null {
  if (!(pick.priceUsd > 0) || !(pick.priceNative > 0)) return null;
  if (solSpentLamports <= 0n || tokensRaw <= 0n) return null;
  const solUsd = pick.priceUsd / pick.priceNative;
  const tokensUi = Number(tokensRaw) / 10 ** (decimals || 6);
  if (!Number.isFinite(solUsd) || solUsd <= 0 || tokensUi <= 0) return null;
  const fill = ((Number(solSpentLamports) / LAMPORTS_PER_SOL) * solUsd) / tokensUi;
  return Number.isFinite(fill) && fill > 0 ? fill : null;
}

function bestSolanaPair(pairs: any[]): any | null {
  const sol = (pairs || []).filter((p) => p?.chainId === "solana");
  if (sol.length === 0) return null;
  return sol.sort((a, b) => (Number(b?.liquidity?.usd) || 0) - (Number(a?.liquidity?.usd) || 0))[0];
}

function pairToStats(mint: string, p: any): CandidateStats | null {
  if (!p) return null;
  return {
    mint,
    symbol: String(p?.baseToken?.symbol ?? "?").slice(0, 16),
    name: p?.baseToken?.name ? String(p.baseToken.name).slice(0, 64) : null,
    priceUsd: Number(p?.priceUsd) || 0,
    priceNative: Number(p?.priceNative) || 0,
    liquidityUsd: Number(p?.liquidity?.usd) || 0,
    liquidityKnown: p?.liquidity?.usd != null && Number.isFinite(Number(p.liquidity.usd)),
    volH1Usd: Number(p?.volume?.h1) || 0,
    // Distinguish "no volume" from "field missing in this response" — exit
    // rules must never treat a partial API payload as a volume collapse.
    volH1Known: p?.volume?.h1 != null && Number.isFinite(Number(p.volume.h1)),
    volH24Usd: Number(p?.volume?.h24) || 0,
    chgM5: Number(p?.priceChange?.m5) || 0,
    chgM5Known: p?.priceChange?.m5 != null && Number.isFinite(Number(p.priceChange.m5)),
    chgH1: Number(p?.priceChange?.h1) || 0,
    chgH6: Number(p?.priceChange?.h6) || 0,
    chgH24: Number(p?.priceChange?.h24) || 0,
    pairCreatedAt: p?.pairCreatedAt ? Number(p.pairCreatedAt) : null,
    buysH1: Number(p?.txns?.h1?.buys) || 0,
    sellsH1: Number(p?.txns?.h1?.sells) || 0,
    buysM5: Number(p?.txns?.m5?.buys) || 0,
    sellsM5: Number(p?.txns?.m5?.sells) || 0,
    pairAddress: typeof p?.pairAddress === "string" && p.pairAddress.length > 0 ? p.pairAddress : null,
  };
}

// ─── Candle chart reading (GeckoTerminal, cached) ────────────────────────────
// Real 5-minute OHLCV candles for pools the bot HOLDS — lets exit judgment see
// chart SHAPE (blow-off tops, trend structure), not just DexScreener's summary
// numbers. Key-free public API; cached hard and fetched only for open
// positions, so the call volume stays tiny.
interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }

const candleCache = new Map<string, { at: number; candles: Candle[] | null }>();
const CANDLES_TTL_MS = 120_000;

// Global request budget: GeckoTerminal free tier allows ~30 calls/min. Stay
// well under it — when the budget is spent, return stale cache or null
// (fail-soft; chart reading is additive everywhere).
let geckoWindowStart = 0;
let geckoWindowCalls = 0;
const GECKO_MAX_PER_MIN = 20;

function geckoBudgetOk(): boolean {
  const now = Date.now();
  if (now - geckoWindowStart >= 60_000) { geckoWindowStart = now; geckoWindowCalls = 0; }
  if (geckoWindowCalls >= GECKO_MAX_PER_MIN) return false;
  geckoWindowCalls++;
  return true;
}

export async function getCandles(pairAddress: string): Promise<Candle[] | null> {
  const hit = candleCache.get(pairAddress);
  if (hit && Date.now() - hit.at < CANDLES_TTL_MS) return hit.candles;
  if (!geckoBudgetOk()) return hit?.candles ?? null; // budget spent — stale-or-null, never an error
  let candles: Candle[] | null = null;
  try {
    const res = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pairAddress}/ohlcv/minute?aggregate=5&limit=24`,
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) },
    );
    if (res.ok) {
      const data = await res.json();
      const list: any[] = data?.data?.attributes?.ohlcv_list ?? [];
      const parsed = list
        .map((row) => ({
          t: Number(row?.[0]) || 0, o: Number(row?.[1]) || 0, h: Number(row?.[2]) || 0,
          l: Number(row?.[3]) || 0, c: Number(row?.[4]) || 0, v: Number(row?.[5]) || 0,
        }))
        .filter((k) => k.o > 0 && k.c > 0)
        .sort((a, b) => a.t - b.t); // oldest → newest
      if (parsed.length > 0) candles = parsed;
    }
  } catch {
    // treat as unknown — chart reading is additive, never required
  }
  candleCache.set(pairAddress, { at: Date.now(), candles });
  if (candleCache.size > 200) {
    const cutoff = Date.now() - CANDLES_TTL_MS;
    candleCache.forEach((v, k) => { if (v.at < cutoff) candleCache.delete(k); });
  }
  return candles;
}

interface ChartRead {
  blowoff: boolean;      // ran too hot + reversal shape + buying climax fading = crash risk
  healthy: boolean;      // higher lows + mostly green = trend intact, likely keeps running
  accumulation: boolean; // tight, calm range holding a base on cooled volume = coiled spring
  detail: string;
}

// Conservative pattern read. Missing/thin data returns null — and null is
// NEVER a sell signal (same invariant as the volume checks). Blow-off needs
// POSITIVE evidence on all three tells before it fires.
export function readChart(candles: Candle[] | null): ChartRead | null {
  if (!candles || candles.length < 12) return null;
  const last12 = candles.slice(-12); // last hour of 5m candles
  const latest = last12[last12.length - 1];
  const prev = last12[last12.length - 2];
  const runPct = last12[0].c > 0 ? ((latest.c - last12[0].c) / last12[0].c) * 100 : 0;

  // Reversal shape: a decisive red candle, or long upper wicks (buyers pushed
  // it up inside the candle but it closed well below the high — sellers won).
  const upperWickHeavy = (k: Candle) => {
    const body = Math.abs(k.c - k.o);
    const wick = k.h - Math.max(k.c, k.o);
    return body > 0 ? wick >= body * 1.5 : wick > 0;
  };
  const decisiveRed = latest.c < latest.o && (latest.o - latest.c) / latest.o >= 0.02;
  const reversal = decisiveRed || upperWickHeavy(latest) || upperWickHeavy(prev);

  // Volume climax: the run peaked on huge volume earlier in the hour and the
  // latest candle's volume has faded to half or less — buyers exhausted.
  const vols = last12.map((k) => k.v);
  const peakVol = Math.max(...vols);
  const peakIdx = vols.indexOf(peakVol);
  const climaxFading = peakVol > 0 && peakIdx < last12.length - 1 && latest.v <= peakVol * 0.5;

  const blowoff = runPct >= 25 && reversal && climaxFading;

  // Healthy trend: stair-stepping up — higher lows across the last 6 candles
  // and most candles closing green. The classic "it keeps running" structure.
  const l6 = candles.slice(-6);
  const greens = l6.filter((k) => k.c >= k.o).length;
  const higherLows = l6[5].l >= l6[2].l && l6[2].l >= l6[0].l;
  const healthy = greens >= 4 && higherLows && !blowoff;

  // Accumulation / coiled-spring base: the "ran up, pulled back, now going
  // quiet" picture the coil style hunts. Three tells, ALL required (positive
  // evidence only — thin data already returned null above):
  //   1. TIGHT range — the last 6 candles span ≤ 8% high-to-low vs the average
  //      close (price has stopped swinging; it's coiling, not trending).
  //   2. HOLDING the base — the most recent candle's low is at/above the range
  //      low and its close is inside the range (the base isn't breaking down).
  //   3. VOLUME COOLED — the latest candle traded ≤ 70% of the hour's peak
  //      volume but is still > 0 (interest has calmed but the token is alive).
  // Never an accumulation call during a blow-off.
  const rangeHigh6 = Math.max(...l6.map((k) => k.h));
  const rangeLow6 = Math.min(...l6.map((k) => k.l));
  const avgClose6 = l6.reduce((sum, k) => sum + k.c, 0) / l6.length;
  const tightRange = avgClose6 > 0 && (rangeHigh6 - rangeLow6) / avgClose6 <= 0.08;
  const holdingBase = rangeLow6 > 0 && latest.l >= rangeLow6 * 0.99 && latest.c >= rangeLow6;
  const volumeCooled = peakVol > 0 && latest.v > 0 && latest.v <= peakVol * 0.7;
  const accumulation = tightRange && holdingBase && volumeCooled && !blowoff;

  const detail = blowoff
    ? `chart: +${runPct.toFixed(0)}% run in the last hour, reversal candle shape, and buying volume fading from its climax`
    : accumulation
      ? "chart: tight, quiet range holding a base on cooled volume — coiled-spring accumulation"
      : healthy
        ? "chart: higher lows and mostly green candles — uptrend intact"
        : "chart: no clear pattern";
  return { blowoff, healthy, accumulation, detail };
}

// Per-mint pairs with a short cache (serves stats derivation, exit-rule
// volume checks, AND the rug guard's entry-pool liquidity lookups).
const statsCache = new Map<string, { at: number; pairs: any[] | null }>();
const STATS_TTL_MS = 60_000;

// Raw Solana pairs for a mint. null = fetch failed (unknown); [] = DexScreener
// answered but lists no Solana pairs. forceFresh bypasses the cache — used by
// the rug guard to CONFIRM a drain on an independent sample before selling.
async function fetchSolanaPairs(mint: string, opts?: { forceFresh?: boolean }): Promise<any[] | null> {
  const hit = statsCache.get(mint);
  if (!opts?.forceFresh && hit && Date.now() - hit.at < STATS_TTL_MS) return hit.pairs;
  let pairs: any[] | null = null;
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json();
      pairs = (Array.isArray(data?.pairs) ? data.pairs : []).filter((p: any) => p?.chainId === "solana");
    }
  } catch {
    // treat as unknown
  }
  statsCache.set(mint, { at: Date.now(), pairs });
  if (statsCache.size > 500) {
    const cutoff = Date.now() - STATS_TTL_MS;
    statsCache.forEach((v, k) => { if (v.at < cutoff) statsCache.delete(k); });
  }
  return pairs;
}

export async function getTokenStats(mint: string, opts?: { forceFresh?: boolean }): Promise<CandidateStats | null> {
  const pairs = await fetchSolanaPairs(mint, opts);
  return pairs == null ? null : pairToStats(mint, bestSolanaPair(pairs));
}

// Manual button presses can afford a short wait for a transient DexScreener
// miss. Background scans must stay cheap, so this retry lane is deliberately
// used only by interactive buys. A successful stats lookup is still only the
// first gate: openPosition must obtain executable buy and reverse-sell routes.
async function getInteractiveTokenStats(mint: string): Promise<CandidateStats | null> {
  const delays = [0, 400, 1_000];
  for (const delayMs of delays) {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const stats = await getTokenStats(mint, { forceFresh: true });
    if (stats && stats.priceUsd > 0) return stats;
  }
  return null;
}

export const MANUAL_PAPER_REBUY_PROVIDER_ERROR =
  "The live market-data provider couldn't return a usable token price after several tries. Your wallet connection is not needed for paper mode, and no paper money moved — please try again shortly.";

export async function executeManualRebuyAttempt<T>(options: {
  mint: string;
  loadStats: (mint: string, opts: { forceFresh: true }) => Promise<T | null>;
  usablePrice: (stats: T) => number;
  open: (stats: T) => Promise<boolean>;
  retryDelaysMs?: readonly number[];
  sleep?: (delayMs: number) => Promise<void>;
}): Promise<{ stats: T; bought: boolean }> {
  const delays = options.retryDelaysMs ?? [0, 400, 1_000];
  const sleep = options.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  for (const delayMs of delays) {
    if (delayMs > 0) await sleep(delayMs);
    const stats = await options.loadStats(options.mint, { forceFresh: true });
    if (stats && options.usablePrice(stats) > 0) {
      return { stats, bought: await options.open(stats) };
    }
  }
  throw new Error(MANUAL_PAPER_REBUY_PROVIDER_ERROR);
}

// Cache-only peek — never hits the network. The fast lane (10s) uses this so
// the runner-exception/reversal tape checks in judgeExit see the same data the
// slow lane fetched, without spending the shared DexScreener budget. Cache
// cold or stale → null, which judgeExit treats as "unknown tape": the trail
// stays TIGHT (safe default) and no tape-based sell can fire.
function peekTokenStats(mint: string): CandidateStats | null {
  const hit = statsCache.get(mint);
  if (!hit || Date.now() - hit.at >= STATS_TTL_MS || hit.pairs == null) return null;
  return pairToStats(mint, bestSolanaPair(hit.pairs));
}

// ─── Rug guard (liquidity-drain emergency exit) ─────────────────────────────
// Born from a real incident: GRVT's pool went from $20k+ at entry to ~$15 —
// the position became unsellable before any price-based stop could react.
// Liquidity is the earlier, more honest tell (an executable quote can look fine
// until the pool is empty). Safeguards against false positives (architect):
//   • the check is PINNED to the pool the bot actually bought from
//     (entryPairAddress) — a transient alternate/smaller pair in the API
//     response can never trigger it; if the entry pool is missing from the
//     response, that's UNKNOWN, never a signal;
//   • it fires only on a SEVERE collapse (< 10% of entry liquidity, floor
//     $1k) — a deep-but-tradable dip doesn't count;
//   • it must be CONFIRMED by a second, cache-bypassed fetch a few seconds
//     later — one bad API sample must never dump a healthy position.
const DRAIN_FLOOR_ABS_USD = 1_000;
const DRAIN_FLOOR_FRAC = 0.10; // < 10% of entry liquidity = drained
const DRAIN_CONFIRM_DELAY_MS = 3_000;

function pairLiquidityUsd(pairs: any[] | null, entryPairAddress: string | null): number | null {
  if (pairs == null) return null; // fetch failed — unknown
  const pool = entryPairAddress
    ? pairs.find((p) => p?.pairAddress === entryPairAddress)
    : bestSolanaPair(pairs); // legacy positions opened before the pool was recorded
  if (!pool) return null; // entry pool absent from this response — unknown, not a signal
  const v = pool?.liquidity?.usd;
  return v != null && Number.isFinite(Number(v)) ? Number(v) : null;
}

async function checkLiquidityDrain(p: SwingPosition): Promise<string | null> {
  if (p.entryLiquidityUsd <= 0) return null; // no baseline recorded — can't judge
  const floor = Math.max(DRAIN_FLOOR_ABS_USD, p.entryLiquidityUsd * DRAIN_FLOOR_FRAC);
  const first = pairLiquidityUsd(await fetchSolanaPairs(p.mint), p.entryPairAddress);
  if (first == null || first >= floor) return null;
  await new Promise((r) => setTimeout(r, DRAIN_CONFIRM_DELAY_MS));
  const second = pairLiquidityUsd(await fetchSolanaPairs(p.mint, { forceFresh: true }), p.entryPairAddress);
  if (second == null || second >= floor) return null;
  return `EMERGENCY EXIT — pool liquidity collapsed to $${Math.round(second).toLocaleString()} (was $${Math.round(p.entryLiquidityUsd).toLocaleString()} at entry, trigger below $${Math.round(floor).toLocaleString()}). This looks like a rug pull; selling immediately for whatever is recoverable.`;
}

// Universe of candidate mints. Sources (all free, all best-effort):
//   - DexScreener boosted tokens + latest profiles (paid-attention tokens)
//   - GeckoTerminal trending pools (what the market is actually trading NOW)
//   - GeckoTerminal top pools by 24h volume (established movers)
//   - GeckoTerminal newest pools (fresh launches — quick style only ever
//     buys them if they pass every entry check; ride style age-gates them out)
// Every candidate still has to pass the full entry bar (momentum, accelerating
// volume, real liquidity, buy pressure, chart check) — a wider net changes how
// many tokens get LOOKED AT, never how picky the bot is.
let universeCache: { at: number; mints: string[] } | null = null;
const UNIVERSE_TTL_MS = 120_000;

export function mergeLiveCandidateMints(
  pumpApiMints: string[],
  pumpPortalMints: string[],
  cachedMarketMints: string[],
  cap = 180,
): string[] {
  return Array.from(new Set([...pumpApiMints, ...pumpPortalMints, ...cachedMarketMints]))
    .slice(0, Math.max(1, Math.floor(cap)));
}

// Majors/stables that dominate "top volume" lists but are never swing targets.
const UNIVERSE_EXCLUDE = new Set([
  "So11111111111111111111111111111111111111112", // WSOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

async function getCandidateUniverse(): Promise<string[]> {
  // PumpAPI is the primary live discovery lane. Read it before consulting the
  // slower market-source cache so a just-streamed launch cannot wait behind the
  // two-minute DexScreener/Gecko refresh interval. PumpPortal remains a free,
  // independent fallback for Pump.fun launch coverage.
  const pumpApiMints = getRecentPumpApiLaunches(100)
    .map((launch) => launch.mint)
    .filter((mint) => SOLANA_ADDR.test(mint));
  const pumpPortalMints = getRecentLaunches(100)
    .map((launch) => launch.mint)
    .filter((mint) => SOLANA_ADDR.test(mint));
  const liveMints = mergeLiveCandidateMints(pumpApiMints, pumpPortalMints, []);
  if (universeCache && Date.now() - universeCache.at < UNIVERSE_TTL_MS) {
    return mergeLiveCandidateMints(pumpApiMints, pumpPortalMints, universeCache.mints);
  }
  const mints = new Set<string>(liveMints);
  // Live discovery is not an admission gate: normal liquidity, momentum,
  // volume, age, chart, pool-safety and sellability checks still decide
  // whether a streamed launch is worth buying.
  const pullDexscreener = async (url: string) => {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return;
      const data = await res.json();
      for (const item of Array.isArray(data) ? data : []) {
        if (item?.chainId === "solana" && typeof item?.tokenAddress === "string" && SOLANA_ADDR.test(item.tokenAddress)) {
          mints.add(item.tokenAddress);
        }
      }
    } catch {
      // best-effort source
    }
  };
  const pullGecko = async (url: string) => {
    if (!geckoBudgetOk()) return; // shares the global GeckoTerminal budget with candle fetches
    try {
      const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return;
      const data = await res.json();
      for (const pool of Array.isArray(data?.data) ? data.data : []) {
        for (const side of ["base_token", "quote_token"]) {
          const id = pool?.relationships?.[side]?.data?.id;
          if (typeof id === "string" && id.startsWith("solana_")) {
            const mint = id.slice("solana_".length);
            if (SOLANA_ADDR.test(mint)) mints.add(mint);
          }
        }
      }
    } catch {
      // best-effort source
    }
  };
  await Promise.all([
    pullDexscreener("https://api.dexscreener.com/token-boosts/top/v1"),
    pullDexscreener("https://api.dexscreener.com/token-boosts/latest/v1"),
    pullDexscreener("https://api.dexscreener.com/token-profiles/latest/v1"),
    pullGecko("https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=1"),
    pullGecko("https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=2"),
    // Hot-right-now trending (1h window) — catches tokens that just started
    // moving, the ones the owner sees on DexScreener's trending page before
    // the 24h lists pick them up. Best-effort like every other source.
    pullGecko("https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=1&duration=1h"),
    pullGecko("https://api.geckoterminal.com/api/v2/networks/solana/pools?page=1&sort=h24_volume_usd_desc"),
    pullGecko("https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1"),
  ]);
  UNIVERSE_EXCLUDE.forEach((m) => mints.delete(m));
  // Cap keeps a scan pass bounded; bumped from 150 when the 1h-trending source
  // was added so the fresh names don't get crowded out by the 24h lists.
  const list = Array.from(mints).slice(0, 180);
  // NEVER cache an empty universe: all sources failing at once (common right
  // after a deploy restart — cold connections, transient rate limits) would
  // otherwise freeze "Scanned 0 tokens" in place for the full TTL. Serve the
  // last good list if we have one and retry the fetch on the next pass.
  if (list.length === 0) {
    console.warn("[swing] candidate universe came back EMPTY — all sources failed this pass; retrying next tick");
    return universeCache?.mints ?? [];
  }
  universeCache = { at: Date.now(), mints: list };
  return list;
}

// ─── Entry judgment ──────────────────────────────────────────────────────────
interface ScoredCandidate extends CandidateStats {
  score: number;
  chartNote?: string;
  // Scanning bots evaluate every supported setup for every token. This records
  // which setup actually won for the candidate so the buy explanation and
  // finalist chart requirements stay honest.
  entrySetup?: "rising" | "trend" | "recovery" | "quiet" | "comeback" | "breakout";
  entryWhy?: string;
  // Set when the pick got in on an elevated 5m candle via the momentum/breakout
  // path — the finalist chart check must CONFIRM a real higher-lows staircase
  // before buying (a lone spike has no such structure). Pure comeback picks are
  // never flagged: their whole point is catching the turn before "healthy".
  needsStaircaseChart?: boolean;
}

function judgeStockEntry(stats: CandidateStats, minLiquidityUsd: number): { ok: boolean; why: string } {
  if (stats.priceUsd <= 0) return { ok: false, why: "no usable price" };
  if (stats.liquidityUsd < Math.max(20_000, minLiquidityUsd)) {
    return { ok: false, why: "the market is too small to enter and leave cleanly" };
  }
  if (stats.volH24Usd < 10_000) return { ok: false, why: "not enough trading today" };
  if (stats.chgH1 < 0.1) return { ok: false, why: `not moving up this hour (${stats.chgH1.toFixed(2)}%)` };
  if (stats.chgH1 > 8) return { ok: false, why: `already jumped ${stats.chgH1.toFixed(1)}% this hour — too late to chase` };
  if (stats.chgM5 < -0.75) return { ok: false, why: "falling during the last five minutes" };
  if (stats.chgM5 > 2.5) return { ok: false, why: "jumping too quickly during the last five minutes" };
  if (stats.chgH24 < -3) return { ok: false, why: "still down too much today" };
  if (stats.chgH24 > 20) return { ok: false, why: "already ran too far today" };
  const trades = stats.buysH1 + stats.sellsH1;
  if (trades >= 10 && stats.sellsH1 > stats.buysH1 * 1.5) {
    return { ok: false, why: "sellers are much busier than buyers" };
  }
  return {
    ok: true,
    why: `rising ${stats.chgH1.toFixed(2)}% this hour, with enough trading and room to move`,
  };
}

function scoreStockCandidate(stats: CandidateStats): number {
  const steadyHour = Math.min(Math.max(stats.chgH1, 0), 5) * 8;
  const dayTrend = Math.min(Math.max(stats.chgH24, 0), 10) * 1.5;
  const sixHourTrend = Math.min(Math.max(stats.chgH6, 0), 10) * 2;
  const calmFiveMinutes = stats.chgM5 >= -0.25 && stats.chgM5 <= 1 ? 8 : 0;
  const liquidity = Math.min(stats.liquidityUsd / 500_000, 5);
  const volume = Math.min(stats.volH24Usd / 250_000, 5);
  return steadyHour + dayTrend + sixHourTrend + calmFiveMinutes + liquidity + volume;
}

async function findStockEntryCandidate(
  s: SwingStrategy,
  excludedMints: Set<string>,
  recentlyExited: Set<string>,
): Promise<{ pick: ScoredCandidate | null; considered: number }> {
  const catalog = await listVerifiedXStocksForSwingScan(24);
  const eligible = catalog.filter((asset) =>
    !excludedMints.has(asset.mint) &&
    !recentlyExited.has(asset.mint) &&
    !(s.blockedMints ?? []).includes(asset.mint));
  const byMint = new Map(catalog.map((asset) => [asset.mint, asset]));
  const picks: ScoredCandidate[] = [];
  let considered = 0;
  const concurrency = 4;
  for (let i = 0; i < eligible.length; i += concurrency) {
    const statsBatch = await Promise.all(eligible.slice(i, i + concurrency).map((asset) => getTokenStats(asset.mint)));
    for (const stats of statsBatch) {
      if (!stats) continue;
      considered++;
      const verdict = judgeStockEntry(stats, s.minLiquidityUsd);
      if (!verdict.ok) continue;
      const asset = byMint.get(stats.mint);
      picks.push({
        ...stats,
        symbol: asset?.tokenSymbol || stats.symbol,
        name: asset?.name || stats.name,
        score: scoreStockCandidate(stats),
      });
    }
  }
  picks.sort((a, b) => b.score - a.score || b.liquidityUsd - a.liquidityUsd);
  return { pick: picks[0] ?? null, considered };
}

async function findClosedMarketStockPlanCandidate(
  s: SwingStrategy,
  excludedMints: Set<string>,
  recentlyExited: Set<string>,
) {
  const catalog = await listVerifiedXStocksForSwingScan(24, true);
  return rankClosedMarketStockPlans(
    catalog,
    s.minLiquidityUsd,
    excludedMints,
    recentlyExited,
    new Set(s.blockedMints ?? []),
  )[0] ?? null;
}

export function rankClosedMarketStockPlans(
  catalog: TokenizedStockCatalogRow[],
  minLiquidityUsd: number,
  excludedMints = new Set<string>(),
  recentlyExited = new Set<string>(),
  blockedMints = new Set<string>(),
  now = Date.now(),
) {
  const maxSnapshotAgeMs = 5 * 24 * 60 * 60 * 1000;
  return catalog
    .filter((asset) =>
      !excludedMints.has(asset.mint) &&
      !recentlyExited.has(asset.mint) &&
      !blockedMints.has(asset.mint) &&
      asset.marketDataObservedAt != null &&
      now - new Date(asset.marketDataObservedAt).getTime() <= maxSnapshotAgeMs &&
      (asset.priceChange24hPct ?? 0) > 0.1 &&
      (asset.priceChange24hPct ?? 0) <= 20 &&
      (asset.liquidityUsd ?? 0) >= Math.max(20_000, minLiquidityUsd) &&
      (asset.volume24hUsd ?? 0) >= 10_000)
    .sort((a, b) => {
      const score = (asset: typeof a) =>
        Math.min(asset.priceChange24hPct ?? 0, 10) * 2 +
        Math.min((asset.liquidityUsd ?? 0) / 500_000, 5) +
        Math.min((asset.volume24hUsd ?? 0) / 250_000, 5);
      return score(b) - score(a);
    });
}

function stockEntryWhyText(pick: CandidateStats): string {
  return `verified xStock with steady momentum: up ${pick.chgH1.toFixed(2)}% this hour and ${pick.chgH24.toFixed(2)}% today, without a last-minute spike`;
}

// A buyer-led 5m step that's part of a broader hourly climb — the "staircase"
// the owner wants bought ("steady 5-min steps, that's where the money is"), NOT
// a lone vertical spike. ONE canonical test, shared by judgeEntry (to allow an
// elevated 5m past the anti-chase ceiling) and scoreCandidate (to not penalize
// it and give it a small edge). The single step is capped at
// ENTRY_STAIRCASE_M5_MAX, and the hour's gain must be spread across multiple
// candles (chgH1 well above this one step) with buyers leading on a real sample.
// The finalist chart check still requires a confirmed higher-lows staircase
// before any elevated-5m pick is actually bought.
// Extended hot run — the OTHER staircase: a token that has ALREADY climbed big
// for many hours straight with buyers overwhelmingly leading the tape (the
// USOH shape: 10 hours of identical green steps, buys 15-to-1). That pattern
// pays most entries and wipes out the LAST one when the team pulls — and no
// chart signal separates the two in advance. Default protection: buy only 25%
// of the intended slice on these picks (hotStreakFullSize=false), protecting
// the other 75% of the bankroll from the one-candle rug. The owner may
// explicitly accept full size via the settings switch.
const HOT_RUN_H6_PCT = 40;   // already up ≥40% over 6h…
const HOT_RUN_H24_PCT = 80;  // …and ≥80% over 24h = a long one-way climb
const HOT_RUN_BUY_LEAD = 1.5; // buyers lead sellers ≥1.5× on the hour
const HOT_RUN_MIN_TX_H1 = 30; // on a real sample, not a ghost tape
const HOT_RUN_SIZE_DIVISOR = 4n; // invest 1/4, protect 3/4
function isExtendedHotRun(s: CandidateStats): boolean {
  const txH1 = s.buysH1 + s.sellsH1;
  return s.chgH6 >= HOT_RUN_H6_PCT
    && s.chgH24 >= HOT_RUN_H24_PCT
    && s.chgH1 > 0
    && txH1 >= HOT_RUN_MIN_TX_H1
    && s.buysH1 > s.sellsH1 * HOT_RUN_BUY_LEAD;
}

function isStaircaseStep(s: CandidateStats): boolean {
  const txM5 = s.buysM5 + s.sellsM5;
  return s.chgM5 > 3
    && s.chgM5 <= ENTRY_STAIRCASE_M5_MAX
    && s.chgH1 >= s.chgM5 * ENTRY_STAIRCASE_H1_SPREAD
    && txM5 >= 8 && s.buysM5 > s.sellsM5;
}

// Plain-language age: hours through 72h ("24h", "72h"), days from 4 days on
// (matches the UI preset labels the owner picked).
function fmtAgeH(h: number): string {
  return h >= 96 ? `${Math.round(h / 24)} days` : `${h}h`;
}

// Default minimum token age for the dial: 24 hours. The old 6h floor proved
// too thin — the user watched 6–8h-old tokens rug — so bots that never chose
// a dial value (NULL) now get a full day of history, same as new bots.
const DEFAULT_MIN_POOL_AGE_H = 24;
// "Be wild" reuses a few conservative launch filters from Sniper, but only
// widens the paper scan lane. Rug, liquidity, route, honeypot, anti-chase, and
// live-money safety gates remain in force.
const WILD_LAUNCH_MIN_AGE_MIN = 10;
const WILD_LAUNCH_MAX_AGE_H = 6;
const WILD_LAUNCH_MIN_VOL_24H_USD = 500;
const WILD_LAUNCH_MIN_H1_PCT = 5;
const WILD_LAUNCH_MIN_VOL_TO_LIQ = 0.05;

// Owner's rug-risk age dial: the strategy's chosen minimum token age in hours
// (0 = "Be wild", fresh launches allowed). NULL = never chose → the 24h
// default. Unknown age is ALWAYS a no-buy regardless of the setting.
// Style floors sit ON TOP of the dial — the effective minimum is whichever is
// higher: ride never holds long on a sub-6h launch (its whole premise is a
// proven tape), and dip needs ~6 days of history by definition (judgeEntry
// also enforces dip's 144h inside its own branch). Centralized here so EVERY
// lane — momentum, breakout, live gate — uses the same number and a low dial
// can never sneak a fresh launch through a side door.
function effMinPoolAgeH(s: { minPoolAgeHours?: number | null; style?: string | null }): number {
  const dial = s.minPoolAgeHours ?? DEFAULT_MIN_POOL_AGE_H;
  const styleFloor = s.style === "ride" ? 6 : s.style === "dip" ? 144 : 0;
  return Math.max(dial, styleFloor);
}

function judgeEntry(stats: CandidateStats, minLiquidityUsd: number, style: string = "quick", live: boolean = false, minAgeH: number = LIVE_MIN_POOL_AGE_H): { ok: boolean; why: string } {
  const wildLaunch = !live && style === "quick" && minAgeH === 0;
  if (stats.priceUsd <= 0) return { ok: false, why: "no price" };
  // Live money respects the owner's liquidity setting, with an explicit $10k
  // minimum floor. The other live entry and pool-safety gates still apply.
  const effMinLiq = live ? Math.max(minLiquidityUsd, liveLiqFloorUsd(stats, style)) : minLiquidityUsd;
  if (stats.liquidityUsd < effMinLiq) return { ok: false, why: `liquidity $${Math.round(stats.liquidityUsd).toLocaleString()} below ${live ? "live-safety " : ""}floor of $${Math.round(effMinLiq).toLocaleString()}` };
  // Established pools only, on EVERY style, in EVERY mode. A pool minutes-to-
  // hours old can rug before the first exit check runs (the MOGTROLL case: fresh
  // pool, real-looking momentum, drained; the DOW case: 4h-old pool passed
  // paper's old 45-min floor and rugged −98% — paper must mirror live's rule
  // or it lies about what live would do). Unknown age = no buy — a rug guard
  // can't protect what it can't verify.
  {
    const ageHall = stats.pairCreatedAt ? (Date.now() - stats.pairCreatedAt) / 3600_000 : null;
    if (ageHall == null) return { ok: false, why: "pool age unknown — the bot only buys tokens with a verifiable trading history" };
    if (ageHall < minAgeH) return { ok: false, why: `pool only ${ageHall.toFixed(1)}h old — your minimum-age dial requires at least ${fmtAgeH(minAgeH)} of history — this lowers rug risk, but no setting removes it` };
  }
  // Dip style is the OPPOSITE of momentum: buy an ESTABLISHED token that is
  // down hard with the market, not a fresh token going up. It has its own
  // gate set and returns here — none of the momentum rules below apply.
  if (style === "dip") {
    // Established only (user's ask: ~6 days minimum, "if they haven't
    // rugged"). Unknown age = no entry — a long recovery hold needs proof.
    const ageH = stats.pairCreatedAt ? (Date.now() - stats.pairCreatedAt) / 3600_000 : null;
    if (ageH == null || ageH < 144) return { ok: false, why: "needs at least 6 days of market history for a dip buy" };
    // A real dip, not a collapse: down 12–70% on the day. Beyond −70% the
    // odds it's a rug/death spiral outweigh the discount.
    if (stats.chgH24 > -12) return { ok: false, why: `only ${stats.chgH24.toFixed(0)}% down on the day — not a real dip` };
    if (stats.chgH24 < -70) return { ok: false, why: `down ${Math.abs(stats.chgH24).toFixed(0)}% in 24h — that's a collapse, not a dip` };
    // Don't catch a falling knife: the 5m candle must have stopped dumping.
    if (stats.chgM5 < -5) return { ok: false, why: "still actively dumping on the 5m — waiting for it to stabilize" };
    if (stats.chgM5 > 15) return { ok: false, why: "5m candle going vertical — the bounce already left without us" };
    // "Some of them just keep dipping" (user's ask): a token still bleeding
    // hard THIS hour hasn't found its bottom — the 24h discount alone is not
    // enough. Wait for the hourly candle to flatten out.
    if (stats.chgH1 < -10) return { ok: false, why: `still falling this hour (${stats.chgH1.toFixed(0)}% in 1h) — the dip hasn't finished dipping` };
    // Bounce confirmation: with a real 5m sample, buyers must not still be
    // getting run over. Sell-heavy last-5-minutes = the knife is still moving.
    const txM5dip = stats.buysM5 + stats.sellsM5;
    if (txM5dip >= 8 && stats.sellsM5 > stats.buysM5) {
      return { ok: false, why: `last 5 minutes still sell-heavy (${stats.sellsM5} sells vs ${stats.buysM5} buys) — waiting for buyers to step back in` };
    }
    // The token must still be ALIVE: real trading continuing through the dip.
    if (stats.volH1Usd < 2000) return { ok: false, why: "trading has gone quiet — a dip with no buyers is just a decline" };
    // Some sell dominance is expected mid-dip, but a 2:1 avalanche means the
    // exodus is still in progress.
    const txH1dip = stats.buysH1 + stats.sellsH1;
    if (txH1dip >= 20 && stats.sellsH1 > stats.buysH1 * 2) {
      return { ok: false, why: `sellers still rushing out (${stats.sellsH1} sells vs ${stats.buysH1} buys in 1h)` };
    }
    return { ok: true, why: `established token (${Math.round(ageH / 24)}d old) down ${Math.abs(stats.chgH24).toFixed(0)}% on the day, still liquid and trading — buying the dip` };
  }
  // Coil / accumulation style: the "ran up, pulled back, now going quiet and
  // coiling" setup — the OPPOSITE of chasing a spike. It buys the calm base
  // AFTER a move (not the move itself), so it enters cheap and rides the next
  // pop instead of buying the top and bleeding. Its own gate set; returns here.
  if (style === "coil") {
    // Needs real prior history — accumulation only means something after a move.
    const ageH = stats.pairCreatedAt ? (Date.now() - stats.pairCreatedAt) / 3600_000 : null;
    if (ageH == null || ageH < COIL_MIN_POOL_AGE_H) return { ok: false, why: `needs at least ${COIL_MIN_POOL_AGE_H}h of history — a base only counts after a real prior move` };
    // Prior strength: it must have actually run at some point (net up on the
    // day), not be a flat-lined dead coin that merely looks "calm".
    if (stats.chgH24 < COIL_MIN_PRIOR_H24_PCT) return { ok: false, why: `no real prior run (${stats.chgH24.toFixed(0)}% on the day) — a coil is a base after a MOVE, not a flat dead coin` };
    // Not another blow-off top dressed up as a base: a token up huge on the day
    // that's "consolidating" is more likely distributing than accumulating.
    if (stats.chgH24 > COIL_MAX_PRIOR_H24_PCT) return { ok: false, why: `already up ${stats.chgH24.toFixed(0)}% on the day — too extended to call this a base rather than a top` };
    // NOT currently spiking and NOT breaking down — it must be genuinely quiet
    // this hour. A spike means we'd be chasing; a slide means the base is failing.
    if (stats.chgH1 > COIL_MAX_H1_PCT) return { ok: false, why: `spiking +${stats.chgH1.toFixed(0)}% this hour — that's a pop to chase, not a quiet base` };
    if (stats.chgH1 < COIL_MIN_H1_PCT) return { ok: false, why: `dropping ${stats.chgH1.toFixed(0)}% this hour — the base is breaking down, not holding` };
    // Consolidating RIGHT NOW: the 5m candle must be flat/quiet. This is the
    // core "coiled spring" tell — price has stopped moving in either direction.
    if (stats.chgM5 < -2 || stats.chgM5 > 2) return { ok: false, why: `5m is still moving (${stats.chgM5.toFixed(1)}%) — waiting for it to go quiet and coil before buying` };
    // Buyers must not be getting dumped on: on a real 5m sample, sellers can't
    // be running the tape (that's the base cracking, not accumulating).
    const txM5coil = stats.buysM5 + stats.sellsM5;
    if (txM5coil >= 8 && stats.sellsM5 > stats.buysM5 * 1.2) {
      return { ok: false, why: `last 5 minutes turning sell-heavy (${stats.sellsM5} sells vs ${stats.buysM5} buys) — the base is starting to crack` };
    }
    // Still alive: a base with no trading is just a dead chart.
    if (stats.volH1Usd < 2000) return { ok: false, why: "trading has gone quiet to nothing — a base needs to still be alive" };
    // PREVIOUS HIGH VOLUME (user's ask): the base only means something if the
    // token was genuinely BUSY before it went quiet. 24h volume must be at least
    // half the pool depth — a coin that was always quiet is dead, not coiling.
    if (stats.liquidityUsd > 0 && stats.volH24Usd < stats.liquidityUsd * COIL_MIN_VOL_TO_LIQ) {
      return { ok: false, why: `not enough prior volume ($${Math.round(stats.volH24Usd).toLocaleString()} traded in 24h vs a $${Math.round(stats.liquidityUsd).toLocaleString()} pool) — a coil is a BUSY coin gone quiet, not one nobody trades` };
    }
    // COMMUNITY BEHAVIOR (user's ask): the crowd must be coming BACK to the base,
    // not walking away. On a real 1h sample buyers should at least match sellers
    // — the accumulation tell is interest returning while the price stays calm.
    const txH1coil = stats.buysH1 + stats.sellsH1;
    if (txH1coil >= 20 && stats.sellsH1 > stats.buysH1) {
      return { ok: false, why: `still more sellers than buyers this hour (${stats.sellsH1} sells vs ${stats.buysH1} buys) — waiting for the crowd to come back to the base` };
    }
    // The chart-confirmation step (finalists) requires a real accumulation
    // pattern too — this gate is the fast filter, the candles are the proof.
    return { ok: true, why: `ran +${stats.chgH24.toFixed(0)}% on the day, still busy ($${Math.round(stats.volH24Usd).toLocaleString()} 24h vol) and now coiling quietly with buyers holding (5m ${stats.chgM5.toFixed(1)}%, ${ageH >= 24 ? Math.round(ageH / 24) + "d" : Math.round(ageH) + "h"} old) — buying the base, not the spike` };
  }
  // Blow-off / parabolic guard (momentum styles): a token that has ALREADY
  // run enormously (huge 6h or 24h gain) and is now rolling over on the short
  // timeframe is a top being distributed, not an entry. This is the "bought
  // right at the peak of a vertical run and it dumped" case — pure protection,
  // applies to quick and ride alike. Positive-run evidence required, so a
  // normal mover is untouched.
  const bigRun = stats.chgH24 >= 150 || stats.chgH6 >= 100;
  if (bigRun && (stats.chgM5 < 0 || stats.chgH1 < 0)) {
    const ran = Math.round(Math.max(stats.chgH24, stats.chgH6));
    return { ok: false, why: `already ran +${ran}% and now rolling over — the bot would not enter here` };
  }
  // LATE-STAGE guard (user's ask): look past just 5m/1h at the bigger picture.
  // A token that has already run a solid amount over 6h/24h, and no longer has
  // buyers clearly pushing it on the 5m, is late in its move — buying here is
  // buying the top after the volume already did its work. Buyers STILL piling in
  // on a real 5m sample = a live staircase, so that case is allowed to continue.
  // Only BLOCK on positive top evidence: a REAL 5m sample (≥8 txns) showing
  // buyers no longer pushing (price not stepping up, or sellers matching them).
  // A tape too thin to read = unknown, NOT a top — let the downstream volume/
  // accel, 1h buy-lead and anti-chase gates decide, rather than auto-rejecting a
  // thin-but-valid setup (same "need a sample before blocking" rule used below).
  const alreadyRan = stats.chgH6 >= LATE_STAGE_H6_PCT || stats.chgH24 >= LATE_STAGE_H24_PCT;
  const m5Sample = stats.buysM5 + stats.sellsM5;
  const buyersStillPushing = stats.buysM5 >= stats.sellsM5 && stats.chgM5 >= ENTRY_CLIMB_MIN_M5_PCT;
  if (alreadyRan && m5Sample >= 8 && !buyersStillPushing) {
    const ran = Math.round(Math.max(stats.chgH6, stats.chgH24));
    return { ok: false, why: `already ran +${ran}% over the last several hours and buyers aren't clearly pushing it right now — that's late in the run, waiting for a fresher setup instead of buying the top` };
  }
  // Late-stage entries also need the FULL HOUR on the buyers' side, not just a
  // hot 5-minute window (July 2026: world.xyz bought at 6h +57% / 24h +85% on a
  // brief 5m push while sellers led the hour 211 vs 208 — stopped out minutes
  // later). After a big run, a marginal sell lead IS the distribution.
  if (alreadyRan && stats.buysH1 + stats.sellsH1 >= 20 && stats.sellsH1 >= stats.buysH1) {
    const ran = Math.round(Math.max(stats.chgH6, stats.chgH24));
    return { ok: false, why: `already ran +${ran}% and sellers match or outnumber buyers over the full hour (${stats.sellsH1} sells vs ${stats.buysH1} buys) — late in the run with the crowd cashing out` };
  }
  const hourlyPace = stats.volH24Usd / 24;
  if (wildLaunch) {
    const ageH = stats.pairCreatedAt ? (Date.now() - stats.pairCreatedAt) / 3600_000 : null;
    if (ageH == null || ageH < WILD_LAUNCH_MIN_AGE_MIN / 60) {
      return { ok: false, why: "launch is under 10 minutes old — waiting for an initial trading sample" };
    }
    if (ageH > WILD_LAUNCH_MAX_AGE_H) {
      return { ok: false, why: "launch is past the wild-launch window — use a normal age setting" };
    }
    if (stats.volH24Usd < WILD_LAUNCH_MIN_VOL_24H_USD) {
      return { ok: false, why: `launch volume is only $${Math.round(stats.volH24Usd).toLocaleString()} — needs at least $${WILD_LAUNCH_MIN_VOL_24H_USD.toLocaleString()}` };
    }
    if (stats.chgH1 < WILD_LAUNCH_MIN_H1_PCT) {
      return { ok: false, why: `launch momentum is ${stats.chgH1.toFixed(1)}% in 1h — needs at least +${WILD_LAUNCH_MIN_H1_PCT}%` };
    }
  }
  if (!wildLaunch && stats.volH1Usd < 3000) return { ok: false, why: "1h volume too thin" };
  // Volume must also be alive RELATIVE to pool size (July 2026: three.ws lost
  // twice on $6k hourly volume against a $219k pool — above the flat floor but
  // dead for that pool; a stop-loss can't fire cleanly in a market that thin).
  const minVolToLiq = wildLaunch ? WILD_LAUNCH_MIN_VOL_TO_LIQ : ENTRY_MIN_VOL_TO_LIQ_H1;
  if (stats.liquidityUsd > 0 && stats.volH1Usd < stats.liquidityUsd * minVolToLiq) {
    return { ok: false, why: `1h volume ($${Math.round(stats.volH1Usd).toLocaleString()}) too quiet for a $${Math.round(stats.liquidityUsd).toLocaleString()} pool — the market's asleep, a move here has nothing behind it` };
  }
  // A buyer-led climber gets the lower acceleration bar (volume just has to keep
  // pace, not surge) — on a real step-climb price moves first and volume follows
  // a beat later. Positive evidence only: price rising now AND over the hour,
  // with buyers leading a real 5m sample. Anything else uses the strict 1.5x bar.
  const buyerLedClimb =
    stats.chgM5 >= ENTRY_CLIMB_MIN_M5_PCT && stats.chgH1 >= MIN_QUICK_H1_MOMENTUM_PCT &&
    stats.buysM5 + stats.sellsM5 >= 8 && stats.buysM5 >= stats.sellsM5;
  const accelMult = buyerLedClimb ? ENTRY_CLIMB_ACCEL_MULT : ENTRY_ACCEL_MULT;
  if (!wildLaunch && hourlyPace > 0 && stats.volH1Usd < hourlyPace * accelMult) return { ok: false, why: "volume not accelerating" };
  if (!wildLaunch && stats.chgH1 < MIN_QUICK_H1_MOMENTUM_PCT) return { ok: false, why: `weak 1h momentum (${stats.chgH1.toFixed(1)}%) — needs a real move, not a nearly-flat token` };
  if (stats.chgH1 > ENTRY_MAX_H1_PCT) return { ok: false, why: "already spiked +" + Math.round(stats.chgH1) + "% in 1h — too late, that's chasing the top" };
  if (stats.chgM5 < ENTRY_MIN_M5_PCT) return { ok: false, why: `5m still sliding (${stats.chgM5.toFixed(1)}%) — waiting for it to steady before buying` };
  if (stats.chgM5 > ENTRY_MAX_M5_PCT) {
    // A hot 5m candle is USUALLY a chase — but a STAIRCASE climber (steady
    // buyer-led 5-min steps, "that's where the money is") isn't a lone spike.
    // Let an elevated 5m through to the chart check ONLY when it's one step of a
    // broader climb: buyers lead this 5m on a real sample, the hour's gain is
    // spread across multiple candles (chgH1 well above this single step), and
    // the step isn't an absurd single candle. The finalist chart check then
    // REQUIRES a confirmed higher-lows staircase before it actually buys.
    if (!isStaircaseStep(stats)) return { ok: false, why: `5m candle already popped +${stats.chgM5.toFixed(1)}% — that's the spike, waiting for a pullback instead of chasing it (the "bought right as it popped, down 5% a minute later" trap)` };
  }
  if (stats.volH24Usd < stats.liquidityUsd * (wildLaunch ? WILD_LAUNCH_MIN_VOL_TO_LIQ : 0.5)) return { ok: false, why: "24h volume weak vs pool depth" };
  // Buy pressure: don't step in front of a distribution. If there's a real
  // sample of trades and sellers clearly outnumber buyers, skip.
  const txH1 = stats.buysH1 + stats.sellsH1;
  // Pickier (July 2026, user "way more losses than wins"): buyers must LEAD at
  // entry, not merely stay under a 1.3× sell ratio. Most live losses were
  // "bought a token that was already being distributed"; requiring buys ≥ sells
  // on a real trade sample cuts those. Below the sample floor the volume/accel
  // gates above carry the decision.
  // A CLEAR 1h sell lead is distribution — block it. But a MARGINAL sell-count
  // lead is not, when the token is provably climbing RIGHT NOW: rising price is
  // the dollar-weighted buy/sell signal we can't read from counts alone (price
  // only climbs when buy $ > sell $), so a few extra sell prints while price
  // steps up is profit-taking into strength, not a top being dumped. climbingNow
  // = 5m green with buyers leading a real 5m sample; it widens the tolerated 1h
  // sell-count ratio to ENTRY_SELL_LEAD_MAX_RATIO, else the strict buys≥sells bar.
  // Ride (long holds) NEVER gets the sell-count tolerance — a longer hold needs
  // buyers clearly in control at all sample sizes, not merely a marginal lead.
  // Count lead is preferred proof, but a STRONGLY green 5m with sellers ahead
  // on count means the buyers are simply bigger (few whales vs many dust
  // sells) — price direction is the dollar-weighted tiebreak. The higher +3%
  // bar without count lead guards against a single wick faking a climb.
  const climbingNow =
    stats.buysM5 + stats.sellsM5 >= 8 &&
    (stats.buysM5 >= stats.sellsM5
      ? stats.chgM5 >= ENTRY_CLIMB_MIN_M5_PCT
      : stats.chgM5 >= 3);
  const sellLeadRatio = climbingNow && style !== "ride" ? ENTRY_SELL_LEAD_MAX_RATIO : 1;
  if (txH1 >= ENTRY_BUY_LEAD_MIN_TXNS && stats.sellsH1 > stats.buysH1 * sellLeadRatio) {
    return { ok: false, why: `sellers outnumber buyers (${stats.sellsH1} sells vs ${stats.buysH1} buys in 1h) — not stepping in front of that` };
  }
  // Quick style: a modest age floor. The wider universe now includes a
  // brand-new-pools feed — a pool minutes old can rug before the first exit
  // check runs. QUICK_MIN_POOL_AGE_MIN is enough to see real trading history
  // without missing the move. Unknown age stays allowed for quick (DexScreener
  // sometimes omits pairCreatedAt on legit tokens); ride requires proof below.
  if (!wildLaunch && style !== "ride" && stats.pairCreatedAt) {
    const ageMin = (Date.now() - stats.pairCreatedAt) / 60_000;
    if (ageMin < QUICK_MIN_POOL_AGE_MIN) return { ok: false, why: `pool only ${Math.max(1, Math.round(ageMin))}m old — too fresh, rug risk` };
  }
  if (style === "ride") {
    // Long holds need survivors, not fresh launches — a token minutes old can
    // rug before the first exit check matters.
    const ageH = stats.pairCreatedAt ? (Date.now() - stats.pairCreatedAt) / 3600_000 : null;
    if (ageH == null || ageH < 6) return { ok: false, why: "too new to trust for a long hold — rug risk" };
    // For a ride, buyers must be clearly in control at entry.
    if (txH1 >= 20 && stats.buysH1 < stats.sellsH1) return { ok: false, why: "buy pressure not leading — not a ride entry" };
  }
  return { ok: true, why: "momentum + accelerating volume + real liquidity" };
}

// Watchlist-only breakout entry. The owner starred this mint and asked for it
// to be bought on a real move (+5%+ on the hour), even when the strict scan bar
// (volume must be accelerating, 5m capped at +6%) would hold off. This is the
// looser, momentum-first path — but it is NOT a blank check: every protection
// that stops us buying a top still runs here. Only ever called for watched
// mints; the general universe keeps the stricter judgeEntry bar.
function judgeWatchlistBreakout(
  stats: CandidateStats,
  minLiquidityUsd: number,
  live: boolean,
  minAgeH: number = LIVE_MIN_POOL_AGE_H,
): { yes: boolean; why: string } {
  if (stats.priceUsd <= 0) return { yes: false, why: "no price" };
  // Same liquidity floor as a normal entry (live uses the higher safety floor).
  const effMinLiq = live ? Math.max(minLiquidityUsd, liveLiqFloorUsd(stats, "quick")) : minLiquidityUsd;
  if (stats.liquidityUsd < effMinLiq) {
    return { yes: false, why: `liquidity $${Math.round(stats.liquidityUsd).toLocaleString()} below ${live ? "live-safety " : ""}floor of $${Math.round(effMinLiq).toLocaleString()}` };
  }
  // No money — paper OR live — enters a pool too new (or unknown age) to have
  // survived. Identical rug guard to judgeEntry; paper mirrors live so its
  // results stay honest about what live would do.
  {
    const ageH = stats.pairCreatedAt ? (Date.now() - stats.pairCreatedAt) / 3600_000 : null;
    if (ageH == null) return { yes: false, why: "pool age unknown — the bot only buys tokens with a verifiable trading history" };
    if (ageH < minAgeH) return { yes: false, why: `pool only ${ageH.toFixed(1)}h old — your minimum-age dial requires at least ${fmtAgeH(minAgeH)} of history — this lowers rug risk, but no setting removes it` };
  }
  // Blow-off / parabolic guard STAYS — a starred token that already ran huge and
  // is now rolling over is a top being distributed, not an entry. This is the
  // single most important protection and it is never waived.
  const bigRun = stats.chgH24 >= 150 || stats.chgH6 >= 100;
  if (bigRun && (stats.chgM5 < 0 || stats.chgH1 < 0)) {
    const ran = Math.round(Math.max(stats.chgH24, stats.chgH6));
    return { yes: false, why: `already ran +${ran}% and now rolling over — the bot would not enter here` };
  }
  // The move itself: a clear +5%+ hour is what the owner asked to act on.
  if (stats.chgH1 < WATCH_BREAKOUT_H1_PCT) {
    return { yes: false, why: `only +${stats.chgH1.toFixed(1)}% on the hour — waiting for a clearer +${WATCH_BREAKOUT_H1_PCT}% move` };
  }
  // Still don't buy a move that's already largely over (same 1h ceiling as scan).
  if (stats.chgH1 > ENTRY_MAX_H1_PCT) {
    return { yes: false, why: `already +${Math.round(stats.chgH1)}% in 1h — too late, that's chasing the top` };
  }
  // Not actively dumping on the 5m, and not a truly vertical candle. The 5m
  // ceiling is relaxed vs the scan (WATCH_BREAKOUT_M5_MAX vs ENTRY_MAX_M5_PCT)
  // so an ordinary green move isn't rejected — but a vertical blow-off still is.
  if (stats.chgM5 < ENTRY_MIN_M5_PCT) {
    return { yes: false, why: `5m still sliding (${stats.chgM5.toFixed(1)}%) — waiting for it to steady` };
  }
  if (stats.chgM5 > WATCH_BREAKOUT_M5_MAX) {
    return { yes: false, why: `5m candle going vertical (+${stats.chgM5.toFixed(1)}%) — not chasing a vertical spike even on a starred token` };
  }
  // Buyers must at least be leading on a real trade sample — never step in front
  // of a token being distributed, starred or not.
  const txH1 = stats.buysH1 + stats.sellsH1;
  if (txH1 >= ENTRY_BUY_LEAD_MIN_TXNS && stats.sellsH1 > stats.buysH1) {
    // Dollar-weighted tiebreak: counts say sellers, but if the hour AND the 5m
    // are both green, buy dollars are beating sell dollars (many dust sells vs
    // fewer bigger buys). Tolerate a modest count lead in that case — a heavy
    // 1.3×+ seller count still blocks even a green chart.
    const dollarsSayBuyers = stats.chgH1 > 0 && stats.chgM5 >= ENTRY_CLIMB_MIN_M5_PCT;
    if (!dollarsSayBuyers || stats.sellsH1 > stats.buysH1 * 1.3) {
      return { yes: false, why: `sellers outnumber buyers (${stats.sellsH1} sells vs ${stats.buysH1} buys in 1h)${dollarsSayBuyers ? " by too much even for a rising chart" : " and the chart isn't rising to say the buyers are bigger"} — not stepping in front of that` };
    }
  }
  // Same thin-tape floor as the scan (see three.ws note in judgeEntry): a star
  // doesn't make a dead market safe — a stop-loss can't fire cleanly in it.
  if (stats.liquidityUsd > 0 && stats.volH1Usd < stats.liquidityUsd * ENTRY_MIN_VOL_TO_LIQ_H1) {
    return { yes: false, why: `1h volume ($${Math.round(stats.volH1Usd).toLocaleString()}) too quiet for a $${Math.round(stats.liquidityUsd).toLocaleString()} pool — the market's asleep, starred or not` };
  }
  // Same late-stage hour-lead rule as the scan: after a big run, even an EQUAL
  // seller count over the full hour is the crowd cashing out — a star doesn't
  // change that (the strict check above only catches sellers strictly ahead).
  if ((stats.chgH6 >= LATE_STAGE_H6_PCT || stats.chgH24 >= LATE_STAGE_H24_PCT) && txH1 >= 20 && stats.sellsH1 >= stats.buysH1) {
    const ran = Math.round(Math.max(stats.chgH6, stats.chgH24));
    return { yes: false, why: `already ran +${ran}% and sellers match buyers over the full hour — late in the run with the crowd cashing out` };
  }
  return { yes: true, why: `starred token up +${stats.chgH1.toFixed(1)}% on the hour with buyers leading — entering on the move (your watchlist breakout)` };
}

// Honest buy-log reason: report the lane the pick ACTUALLY entered through.
// Scan picks can enter via three lanes (strict momentum, watched-token
// comeback, watched-token breakout). The old log re-ran only the strict
// judgeEntry and pasted its text — for a comeback/breakout pick that text was
// a REJECTION ("the bot would not enter here") stapled onto a "Bought" line.
// Re-run all three judges on the same stats and use whichever one said yes.
function entryWhyText(pick: ScoredCandidate | CandidateStats, s: { minLiquidityUsd: number; style: string; minPoolAgeHours?: number | null }, live: boolean): string {
  if ("entryWhy" in pick && pick.entryWhy) {
    const label = pick.entrySetup === "trend" ? "a strong long trend"
      : pick.entrySetup === "recovery" ? "a price recovery"
      : pick.entrySetup === "quiet" ? "a quiet token starting to move"
      : pick.entrySetup === "comeback" ? "a watched-token comeback"
      : pick.entrySetup === "breakout" ? "a watchlist breakout"
      : "rising now";
    return `Smart mix chose ${label}: ${pick.entryWhy}`;
  }
  const j = judgeEntry(pick, s.minLiquidityUsd, s.style, live, effMinPoolAgeH(s));
  if (j.ok) return j.why;
  const b = judgeWatchlistBreakout(pick, s.minLiquidityUsd, live, effMinPoolAgeH(s));
  if (b.yes) return b.why;
  const c = judgeComeback(pick);
  if (c.yes) return `your starred token turning back up — ${c.note} — buying the comeback`;
  // None of the judges pass on the stats we have NOW (they moved since the
  // scan decision). Say that plainly instead of pasting a rejection.
  return "picked by the scan a moment ago; conditions have shifted slightly since — the exit rules (stop-loss, profit lock, sell-off tells) take it from here";
}

function scoreCandidate(s: CandidateStats): number {
  const accel = s.volH24Usd > 0 ? Math.min(s.volH1Usd / (s.volH24Usd / 24), 10) : 0;
  const momentum = Math.min(Math.max(s.chgH1, 0), 50); // cap so a near-spike doesn't dominate
  const liq = Math.min(s.liquidityUsd / 100_000, 3);
  // Prefer buying the pullback, not the local top: 1h trend up but the 5m
  // candle flat-to-slightly-red is the best entry shape. Penalize chasing a
  // green 5m spike — that's exactly the "bought right before it dipped" case.
  const pullback = s.chgM5 >= -5 && s.chgM5 <= 3 ? 5 : 0;
  // Penalize chasing from the top of the pullback sweet-spot up (was >8, but
  // entries now hard-cap at ENTRY_MAX_M5_PCT=6, so a >8 penalty let the scorer
  // still rank a near-ceiling spike as the winner — only for judgeEntry to
  // reject it and lose the pick. Start the penalty at +3 so calm bases win.
  // A hot 5m is a chase UNLESS buyers clearly lead it AND the hour shows a
  // broader climb (staircase) — then the elevated 5m is a real step, not a lone
  // spike, so we don't penalize it and give a small edge so it can reach the
  // chart-confirmation finalists (user: "steady 5-min steps, that's where the
  // money is"). Same test as judgeEntry's staircase allowance; the finalist
  // chart check still requires a confirmed higher-lows staircase before buying.
  const staircaseStep = isStaircaseStep(s);
  const chasePenalty = s.chgM5 > 3 && !staircaseStep ? (s.chgM5 - 3) * 0.6 : 0;
  const staircaseBonus = staircaseStep ? 4 : 0;
  // Buy-pressure bonus: more buyers than sellers is the healthiest signal we
  // have from a public feed. Capped so it can't dominate.
  const txH1 = s.buysH1 + s.sellsH1;
  const buyPressure = txH1 >= 20 ? Math.min(s.buysH1 / Math.max(s.sellsH1, 1), 3) * 2 : 0;
  // LATE-STAGE penalty (user: prefer a modest, still-early riser over something
  // that already ran way up — "volume can mean it already popped"). The more it
  // has already run over the BIGGER windows (6h weighted heaviest, 24h half),
  // the more likely we're late, so dock the score. Capped so it reorders picks
  // without nuking an otherwise-strong candidate.
  const priorRun = Math.max(s.chgH6, s.chgH24 * 0.5);
  const lateStagePenalty = priorRun > 30 ? Math.min((priorRun - 30) * 0.15, 8) : 0;
  // MODEST-RISER bonus (user: "scan for risers between 3–5% that are going up
  // and down and grinding higher"). A healthy early mover — a real 1h move that
  // hasn't already run away on the 6h — is exactly that shape; give it an edge.
  const modestRiser = s.chgH1 >= 3 && s.chgH1 <= 15 && s.chgH6 < 40 ? 3 : 0;
  return accel * 3 + momentum * 0.5 + liq * 2 + pullback + buyPressure + staircaseBonus + modestRiser - chasePenalty - lateStagePenalty;
}

// Dip-style scoring — the mirror image of momentum scoring: a deeper (but
// survivable) discount scores higher, deep liquidity matters more (we're
// holding through a recovery), and early signs of buyers returning are the
// best tell that the bottom is in. On a market-wide red day every dip
// candidate gets a flat bonus: a token falling WITH Bitcoin/Solana is more
// likely a market-driven dip than a token-specific problem. Weather unknown
// (API down) = no bonus, never a blocker.
function scoreDipCandidate(s: CandidateStats, marketRed: boolean): number {
  const discount = Math.min(Math.abs(Math.min(s.chgH24, 0)), 60); // 12–70 by the entry gate
  const liq = Math.min(s.liquidityUsd / 100_000, 5);
  const txM5 = s.buysM5 + s.sellsM5;
  const buyersReturning = txM5 >= 8 && s.buysM5 > s.sellsM5 ? 5 : 0;
  const stabilized = s.chgM5 >= -2 && s.chgM5 <= 5 ? 3 : 0;
  const marketBonus = marketRed ? 5 : 0;
  return discount * 0.4 + liq * 2 + buyersReturning + stabilized + marketBonus;
}

// Coil-style scoring — reward the calmest, tightest bases with the best prior
// run behind them. The quieter the 5m (nearer flat), the more "coiled" it is;
// prior 24h strength shows there's real interest to pop again; deep liquidity
// lets us exit the pop cleanly; buyers quietly stepping back in on the 5m is
// the earliest tell the spring is about to release.
function scoreCoilCandidate(s: CandidateStats): number {
  const priorStrength = Math.min(Math.max(s.chgH24, 0), 50);
  const calm = Math.abs(s.chgM5) <= 1 ? 5 : Math.abs(s.chgM5) <= 2 ? 2 : 0;
  const liq = Math.min(s.liquidityUsd / 100_000, 3);
  const txM5 = s.buysM5 + s.sellsM5;
  const buyersReturning = txM5 >= 8 && s.buysM5 > s.sellsM5 ? 4 : 0;
  return priorStrength * 0.4 + calm + liq * 2 + buyersReturning;
}

async function findEntryCandidate(
  s: SwingStrategy,
  openMints: Set<string>,
  recentlyExited: Set<string>,
  heldMints: Set<string> = new Set(),
  rebuyMints: Set<string> = new Set(),
  // Top-up mode: restrict the hunt to EXACTLY these mints (a reduced-entry
  // position earning its second helping). The mints are force-joined to the
  // universe (the feeds may not list them this pass) but every entry gate —
  // momentum judgment, scoring, chart check, rug/honeypot guards — still
  // applies: a top-up must look like a good buy RIGHT NOW, not just "we
  // already own it".
  onlyMints?: Set<string>,
  // Mints whose LAST exit was a loss within LOSS_COMEBACK_BLOCK_MS: the
  // starred-token comeback lane is held off for these (see constant above).
  recentLossExits: Set<string> = new Set(),
  // Mint → exit price of the latest WINNING close inside EXIT_CHASE_BLOCK_MS:
  // re-buys of that mint get the detailed two-mode re-scan below on EVERY
  // entry path (momentum, comeback, breakout) — clean tape required at/below
  // the exit price, extra-strong momentum proof required above it.
  exitChaseCeilings: Map<string, number> = new Map(),
): Promise<{ pick: ScoredCandidate | null; considered: number }> {
  const universe = await getCandidateUniverse();
  // "Buy again" stars + auto-watched mints join the scan even when the feeds
  // don't list them. During a mint's post-exit cooldown they may re-enter ONLY
  // on a real comeback (a dip that turns — judgeComeback); the momentum gate is
  // held off until the cooldown lapses so a just-sold winner isn't re-bought at
  // the top. Everything else (entry judgment, scoring, chart check, rug/honeypot
  // guards) still applies: watched means WATCHED, not insta-bought.
  const blocked = new Set(s.blockedMints ?? []);
  // Recent winning exits remain in the candidate set even if a temporary dip
  // drops them out of the public trending feeds. The exit-price gate below is
  // still mandatory, so this is ongoing observation rather than an auto-buy.
  const merged = Array.from(new Set([
    ...Array.from(rebuyMints),
    ...Array.from(onlyMints ?? []),
    ...Array.from(exitChaseCeilings.keys()),
    ...universe,
  ]));
  // "Never buy again" is the strongest owner signal — a blocked mint is dropped
  // from the hunt entirely, ahead of every other gate (openPosition backstops it
  // too, but filtering here saves a stats fetch and keeps it out of scoring).
  const fresh = merged.filter((m) => (!onlyMints || onlyMints.has(m)) && !blocked.has(m) && !openMints.has(m) && (rebuyMints.has(m) || !recentlyExited.has(m)));
  const picks: ScoredCandidate[] = [];
  // Every scanning bot evaluates recovery candidates too, so fetch the cached
  // market weather once per pass. Unknown weather is neutral, never a blocker.
  const marketRed = (await getMarketWeather())?.mood === "red";
  // Bounded concurrency — DexScreener is a public API.
  const CONCURRENCY = 5;
  for (let i = 0; i < fresh.length; i += CONCURRENCY) {
    const batch = fresh.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((m) => getTokenStats(m)));
    for (const stats of results) {
      if (!stats) continue;
      const isWatched = rebuyMints.has(stats.mint);
      // Don't chase our own exit (the UPTOBER lesson) — but scan in detail
      // instead of a blunt price wall. For a token we sold at a WIN recently:
      //   • At/below our exit price (a pullback): still re-scan the tape —
      //     buyers must at least match sellers on the fresh 5-min window and
      //     the 5-min candle must not be red. A pullback that's still being
      //     sold into is a falling knife, not a re-entry.
      //   • Above our exit price: only with EXTRA-STRONG proof the run is
      //     fresh, not stale — a real buyer surge (1.5× sellers, decent
      //     sample), a clearly rising 5-min candle, and strong 1h volume.
      //     Missing candle/volume data can't count as proof (entries may be
      //     strict on missing data; only EXITS must never treat it as a signal).
      const chaseCeiling = exitChaseCeilings.get(stats.mint);
      if (chaseCeiling != null) {
        const m5Sample = stats.buysM5 + stats.sellsM5;
        if (stats.priceUsd > chaseCeiling) {
          const buyerSurge = m5Sample >= 8 && stats.buysM5 >= stats.sellsM5 * 1.5;
          const risingM5 = stats.chgM5Known && stats.chgM5 >= 3;
          const strongVol = stats.volH1Known && stats.volH1Usd >= stats.liquidityUsd;
          if (!(buyerSurge && risingM5 && strongVol)) continue;
        } else {
          // At or below our exit, require a confirmed turn rather than merely
          // the absence of red. This lets the scanner buy a dip immediately
          // when buyers return without rebuying the same fading top.
          if (!judgeComeback(stats).yes) continue;
        }
      }
      // Comeback re-entry (user's CASH AT ask — "we sold for a small profit, it
      // dipped, then was about to run again so I bought more and it ran"): a
      // watched token may re-enter the moment buyers clearly step back in
      // (judgeComeback), EVEN IF the strict momentum gate isn't met — a dip
      // that's turning up has flat/negative 1h change by definition, so
      // judgeEntry alone would miss exactly the re-buy the user wants. Watched
      // mints + non-dip styles only (dip has its own bottom-fishing gate).
      const cb = isWatched && !recentLossExits.has(stats.mint) ? judgeComeback(stats) : null;
      const comebackOk = cb?.yes === true;
      // SAFER half of the ask: while a watched mint is still inside its
      // post-exit cooldown (it was JUST sold — see recentlyExited), the plain
      // momentum gate is held off. A just-sold WINNER therefore can't be
      // re-bought at/near the top on the very next tick — only a genuine
      // comeback (dip that turns) re-buys that soon. Once the cooldown lapses
      // the mint competes on momentum like any other name. Non-watched mints
      // in cooldown are already filtered out above, so this only bites watched.
      const inCooldown = isWatched && recentlyExited.has(stats.mint);
      const configuredMinAge = s.minPoolAgeHours ?? DEFAULT_MIN_POOL_AGE_H;
      const setupChecks = !inCooldown ? [
        {
          setup: "rising" as const,
          verdict: judgeEntry(stats, s.minLiquidityUsd, "quick", s.mode === "live", configuredMinAge),
          score: scoreCandidate(stats),
        },
        {
          setup: "trend" as const,
          verdict: judgeEntry(stats, s.minLiquidityUsd, "ride", s.mode === "live", configuredMinAge),
          score: scoreCandidate(stats) + 2,
        },
        {
          setup: "recovery" as const,
          verdict: judgeEntry(stats, s.minLiquidityUsd, "dip", s.mode === "live", configuredMinAge),
          score: scoreDipCandidate(stats, marketRed),
        },
        {
          setup: "quiet" as const,
          verdict: judgeEntry(stats, s.minLiquidityUsd, "coil", s.mode === "live", configuredMinAge),
          score: scoreCoilCandidate(stats),
        },
      ].filter((candidate) => candidate.verdict.ok) : [];
      setupChecks.sort((a, b) => b.score - a.score);
      const selectedSetup = setupChecks[0] ?? null;
      const momentumOk = selectedSetup != null;
      // Watchlist breakout (owner ask: "when a starred token moves +5%,
      // especially in our watchlist, consider buying and entering"). Looser,
      // momentum-first path — ONLY for watched mints, ONLY out of cooldown, and
      // ONLY on momentum styles (dip/coil have their own contrarian gates). All
      // safety guards still run inside judgeWatchlistBreakout, and the finalist
      // chart check below still refuses a blow-off top.
      const breakout = isWatched && !inCooldown
        ? judgeWatchlistBreakout(stats, s.minLiquidityUsd, s.mode === "live", effMinPoolAgeH(s))
        : null;
      const breakoutOk = breakout?.yes === true;
      if (momentumOk || comebackOk || breakoutOk) {
        let score = selectedSetup?.score ?? scoreCandidate(stats);
        // Stacking discount: a token we already hold must beat fresh
        // alternatives by a clear margin to win another slot — otherwise
        // diversify (user's "why didn't it scan for other tokens?" ask).
        if (heldMints.has(stats.mint)) score *= STACK_SCORE_DISCOUNT;
        // Buy-back preference: a watched token acting on a fresh comeback OR a
        // +5% breakout gets a modest edge so the bot picks the runner the owner
        // starred over a random new name ("buy more when it's about to run").
        else if (comebackOk || breakoutOk) score += REBUY_COMEBACK_BONUS;
        // If this pick got in on an elevated 5m candle via momentum/breakout, it
        // must PROVE a real staircase on the candles before we buy (enforced in
        // the finalist loop). A pure comeback (dip-turn) is exempt — its whole
        // point is catching the turn before the chart reads "healthy".
        const entrySetup = comebackOk ? "comeback" as const
          : breakoutOk ? "breakout" as const
          : selectedSetup?.setup;
        const entryWhy = comebackOk ? cb!.note
          : breakoutOk ? breakout!.why
          : selectedSetup?.verdict.why;
        const needsStaircaseChart =
          stats.chgM5 > ENTRY_MAX_M5_PCT &&
          (entrySetup === "rising" || entrySetup === "trend" || entrySetup === "breakout");
        picks.push({ ...stats, score, needsStaircaseChart, entrySetup, entryWhy });
      } else if (inCooldown) {
        // Transparency (the owner will ask "why didn't it buy back in?"): a
        // just-sold watched token is waiting for a dip-turn, not chasing the top.
        await addSkipEventDeduped(s.id, stats.mint, stats.symbol, "await_comeback",
          `Watching ${stats.symbol} for a buy-back — sold recently, giving it time to dip and for buyers to step back in before re-entering (not chasing the top).`);
      } else if (breakout && !breakout.yes) {
        // Transparency for the +5% breakout ask: a starred token that isn't
        // being bought right now says exactly what it's waiting for (e.g. only
        // +2% on the hour, 5m still sliding, sellers leading, or too vertical).
        await addSkipEventDeduped(s.id, stats.mint, stats.symbol, "watch_breakout_wait",
          `Watching ${stats.symbol} for a buy-in — ${breakout.why}.`);
      }
    }
    if (picks.length >= 8) break; // enough to choose from
  }
  if (picks.length === 0) return { pick: null, considered: fresh.length };
  picks.sort((a, b) => b.score - a.score);

  // Chart confirmation on the finalists (top 3 only — one cached candle fetch
  // each). Two rules:
  //   1. Never buy INTO a blow-off top — if the candles show the crash-risk
  //      pattern right now, pass on it.
  //   2. Crashed tokens must PROVE the turnaround: if it's down hard on the
  //      24h (≤ −40%), only buy when the candles show a bottomed, stair-
  //      stepping recovery (higher lows + green candles). No chart data on a
  //      crashed token = no buy — entering needs positive evidence, unlike
  //      exits where missing data must never force a sell.
  let chartChecks = 0;
  for (const cand of picks) {
    // Rug gate FIRST (result is cached, so this is cheap): a rug-risky token
    // that keeps winning the scoring must NOT burn the whole pass — skip it
    // here and give the next-best candidate its shot. Without this, one
    // popular-but-unsafe token (top score every minute, then rug-skipped in
    // openPosition) blocks all other buys indefinitely. openPosition keeps
    // its own identical guard as defense in depth (watch mode calls it
    // directly).
    const safety = await checkTokenSafety(cand.mint);
    // Live money requires a POSITIVE safety pass (LP verified locked, mint+freeze
    // revoked). Unknown (RugCheck slow/down) is no longer good enough for live —
    // it was an "unknown = allow" buy that got rugged. Paper keeps the looser
    // gate so the scanner still surfaces the full opportunity set.
    const safetyBlocked = s.mode === "live" ? !(safety?.ok) : (safety != null && !safety.ok);
    if (safetyBlocked) {
      const why = safety?.why ?? "couldn't verify the liquidity is locked and mint/freeze are revoked right now";
      await addSkipEventDeduped(s.id, cand.mint, cand.symbol, "rug_enabler",
        `Rug-risk guard: skipped ${cand.symbol} — ${why}${s.mode === "live" ? " (live mode only buys verified-safe tokens)" : ""}. Moving on to the next-best candidate.`);
      continue;
    }
    // Candle budget: chart-confirm at most 3 finalists per pass (one cached
    // candle fetch each). Rug-blocked tokens above don't count against this.
    if (chartChecks >= 3) break;
    chartChecks++;
    const chart = cand.pairAddress ? readChart(await getCandles(cand.pairAddress)) : null;
    if (chart?.blowoff) {
      await addSkipEventDeduped(s.id, cand.mint, cand.symbol, "blowoff",
        `Passed on ${cand.symbol} — ${chart.detail}. Not buying into a blow-off top.`);
      continue;
    }
    // Staircase confirmation: a pick that got in on an elevated 5m candle is
    // only bought when the candles CONFIRM a real higher-lows stair-step. No
    // chart data or no staircase = it was a lone spike, not a climb — skip it.
    // (Positive evidence required, exactly like a crashed token must prove a
    // recovery. Pure comeback picks aren't flagged, so this never touches them.)
    if (cand.needsStaircaseChart && !chart?.healthy) {
      await addSkipEventDeduped(s.id, cand.mint, cand.symbol, "spike_unconfirmed",
        `Passed on ${cand.symbol} — it popped +${cand.chgM5.toFixed(1)}% on the 5m but the candles don't confirm a steady higher-lows climb yet. Waiting for a real staircase, not chasing a single spike.`);
      continue;
    }
    const crashedPct = cand.chgH24 <= -40 ? Math.abs(cand.chgH24) : null;
    if (crashedPct != null && !chart?.healthy) {
      await addSkipEventDeduped(s.id, cand.mint, cand.symbol, "crashed_unproven",
        `Passed on ${cand.symbol} — down ${crashedPct.toFixed(0)}% over 24h and the chart isn't showing recovery structure yet (need higher lows + green candles returning).`);
      continue;
    }
    // Coil style requires POSITIVE proof of a real accumulation base on the
    // candles (tight quiet range, holding, cooled volume) — the stats gate is
    // fast but the chart is the proof. No candle data = no coil buy (entering
    // needs positive evidence, exactly like a crashed token needs "healthy").
    // A "coiled-spring base" only means something after a RUN — a quiet base on
    // a token that's down on BOTH the 6h and the 24h is a fade going sideways,
    // not accumulation (July 2026: HBULL bought as a coil at 6h −13% / 24h −8%,
    // cut for a loss 40 minutes later). Coil style has its own prior-run gate;
    // this backstops the momentum styles whose chart check flags accumulation.
    if (cand.entrySetup !== "quiet" && cand.entrySetup !== "recovery" && chart?.accumulation && !chart?.healthy && cand.chgH6 < 0 && cand.chgH24 < 0) {
      await addSkipEventDeduped(s.id, cand.mint, cand.symbol, "base_no_prior_run",
        `Passed on ${cand.symbol} — it's sitting in a quiet base but it's DOWN over both 6h (${cand.chgH6.toFixed(1)}%) and 24h (${cand.chgH24.toFixed(1)}%). A spring needs a prior run to coil from; this is just a fading chart moving sideways.`);
      continue;
    }
    if (cand.entrySetup === "quiet" && !chart?.accumulation) {
      await addSkipEventDeduped(s.id, cand.mint, cand.symbol, "no_coil_base",
        `Passed on ${cand.symbol} — the candles don't show a real coiled base yet (need a tight, quiet range holding on cooled volume). Waiting for a proper accumulation shape instead of guessing.`);
      continue;
    }
    const chartNote = crashedPct != null
      ? ` Recovery entry: down ${crashedPct.toFixed(0)}% over 24h but the chart is showing recovery structure — higher lows and green candles returning.`
      : chart?.accumulation
        ? " Chart: coiled-spring base — tight, quiet range holding on cooled volume."
        : chart?.healthy
          ? " Chart: uptrend intact (higher lows, mostly green candles)."
          : "";
    return { pick: { ...cand, chartNote }, considered: fresh.length };
  }
  return { pick: null, considered: fresh.length };
}

// Skip-event dedup: the same token can stay a top-3 finalist for hours while
// the entry loop re-checks every minute — without dedup that floods the
// activity feed. One event per strategy+token+reason per hour is plenty.
const skipEventDedup = new Map<string, number>();
const SKIP_DEDUP_MS = 60 * 60 * 1000;

async function addSkipEventDeduped(strategyId: string, mint: string, symbol: string, reason: string, detail: string): Promise<void> {
  const key = `${strategyId}:${mint}:${reason}`;
  const last = skipEventDedup.get(key);
  if (last && Date.now() - last < SKIP_DEDUP_MS) return;
  skipEventDedup.set(key, Date.now());
  if (skipEventDedup.size > 1000) {
    const cutoff = Date.now() - SKIP_DEDUP_MS;
    skipEventDedup.forEach((v, k) => { if (v < cutoff) skipEventDedup.delete(k); });
  }
  await storage.addSwingEvent({ strategyId, positionId: null, kind: "skip", mint, symbol, detail, solLamports: null });
}

// ─── Position valuation (PumpAPI when pinned, Jupiter fallback otherwise) ─────
async function quotePositionValue(p: SwingPosition, slippageBps: number): Promise<bigint | null> {
  try {
    const amt = BigInt(p.tokenAmountRaw);
    if (amt <= 0n) return 0n;
    const pool = pinnedPositionPool(p);
    if (pool) {
      try {
        const strategy = await storage.getSwingStrategy(p.strategyId);
        if (strategy) {
          const owner = walletPubkeyAt(strategy, (p as any).walletIndex ?? 0);
          return p.mode === "paper"
            ? await simulatePaperHolderSell(p, pool, slippageBps)
            : (await simulateExecutablePumpQuote("sell", owner, p.mint, amt, p.decimals, slippageBps, pool)).outputRaw;
        }
      } catch {
        // A PumpAPI-specific simulation failure must not erase the original
        // multi-protocol valuation path.
      }
    }
    const quote = await getSwapQuote(p.mint, SOL_MINT, amt.toString(), slippageBps);
    return BigInt(quote.outAmount ?? "0");
  } catch {
    return null; // unquotable this tick — don't panic-sell on missing data
  }
}

// ─── Exit judgment ───────────────────────────────────────────────────────────
// Flash-wick stop reprieve: remembers the moment we first let a quick-scan
// position slip past its tight stop on a suspected 1-second wick (the live sell
// quote stabbed deep red, but the 5m tape was still healthy). The NEXT check
// confirms — if it's still/again below the stop it sells; if it recovered, the
// entry is cleared. Bounds the extra downside to ~one check. Keyed by pos id.
const stopWickDeferrals = new Map<string, number>();
// A small winning trade gets one full-tick breathing check before adaptive
// profit-taking can close it. This prevents a single temporary pause from
// selling a token that is about to resume its run.
const adaptiveTakeStalls = new Map<string, number>();

export function judgeExit(
  s: SwingStrategy,
  p: SwingPosition,
  valueLamports: bigint,
  highWater: bigint,
  stats: CandidateStats | null,
  chart: ChartRead | null,
  // Flash-wick reprieve is a FULL-TICK-only decision — it needs fresh DexScreener
  // tape to justify holding through a stop breach. The fast-lane guard runs on
  // cached (possibly stale) peek stats, so it passes false: on a real stop
  // breach the fast lane always sells now and never reads/writes the deferral
  // map (no stale-data cross-path coupling with the full tick).
  allowWickDefer: boolean = true,
  // Dollar-weighted buy/sell flow from the chain (null = unknown this tick —
  // NEVER a signal). Counts can lie: many small buys vs fewer BIG sells looks
  // buyer-led by count while real dollars drain out (the RAKO case). When flow
  // is known it both ADDS a sell tell (dollars clearly leaving while the
  // candle isn't green) and PROTECTS a hold (dollars clearly arriving beats a
  // scary-looking sell-count lead).
  flow: DollarFlow | null = null,
): { sell: boolean; reason: string; detail: string } {
  // Style selection is retired for crypto scanners. Older rows may still carry
  // ride/dip/coil, but every scanning position now uses the same adaptive,
  // per-buy Smart mix protection. Watch bots and xStocks retain their dedicated
  // behavior.
  if (!s.targetMint && s.universe !== "stocks") {
    // Null means the scanner uses its adaptive tape-driven profit exit. An
    // owner-entered fixed target remains explicit and is honored below.
    s = {
      ...s,
      style: "quick",
      // Legacy rows may still say steady-wins. Automatic Smart mix now uses a
      // patient evidence-led loss policy; an owner percentage remains explicit.
      conservativeProfit: false,
    };
  }
  // null = unknown this tick (missing/partial API data) — never a sell signal.
  const currentVolH1 = stats && stats.volH1Known ? stats.volH1Usd : null;
  const solIn = BigInt(p.solInLamports);
  const pnlPct = solIn > 0n ? (Number(valueLamports - solIn) / Number(solIn)) * 100 : 0;
  const peakPctNow = solIn > 0n ? (Number(highWater - solIn) / Number(solIn)) * 100 : 0;
  // Conservative profit-taking mode (opt-in, quick scan only): bank small wins
  // fast unless it's turning into a runner, tighten the stop to −3%, and never
  // let a recovered position slip back below breakeven. See constants block.
  const conservative = s.style === "quick" && !s.targetMint && s.conservativeProfit;

  // Recovery hold (legacy field name: neverSellAtLoss): ordinary red exits are
  // deferred to give a position time to recover, but it is NOT an unlimited
  // promise to hold toward zero. A firm max-loss backstop always wins, and a
  // lower evidence-based cut wins when both the short and hourly tapes confirm
  // that the decline is continuing. Unknown/thin tape cannot trigger the
  // evidence cut; the executable quote itself can still trigger the hard cap.
  if (s.neverSellAtLoss && pnlPct <= 0) {
    stopWickDeferrals.delete(p.id);
    const emergency = neverSellEmergencyExit(
      pnlPct,
      stats?.chgM5Known === true,
      stats?.chgM5 ?? 0,
      stats?.buysM5 ?? 0,
      stats?.sellsM5 ?? 0,
      stats?.buysH1 ?? 0,
      stats?.sellsH1 ?? 0,
      dollarsLeaving(flow),
    );
    if (emergency === "max_loss") {
      return {
        sell: true,
        reason: "emergency_max_loss",
        detail: `Down ${Math.abs(pnlPct).toFixed(1)}% — the recovery hold reached its firm −${NEVER_SELL_MAX_LOSS_PCT}% emergency limit. Closing before the position can ride toward zero.`,
      };
    }
    if (emergency === "confirmed_decline") {
      return {
        sell: true,
        reason: "emergency_decline",
        detail: `Down ${Math.abs(pnlPct).toFixed(1)}% and still deteriorating — sellers control both the 5-minute and hourly tape while price keeps falling. Ending the recovery hold early instead of waiting for −${NEVER_SELL_MAX_LOSS_PCT}%.`,
      };
    }
    return {
      sell: false, reason: "",
      detail: `${pnlPct < 0 ? `Down ${Math.abs(pnlPct).toFixed(1)}%` : "At breakeven"} — recovery hold is ON. Holding while there is no confirmed continuing decline; emergency exits remain armed.`,
    };
  }

  // "Positive signs it will go back up" (user's reprieve rule): buyers are
  // visibly stepping back in on the fast tape RIGHT NOW — a real 5m sample,
  // buys leading sells, and a green 5m candle. The breakeven guards below use
  // this as the ONE reason to hold a fading former-winner instead of locking
  // it at breakeven. null/unknown tape = no positive sign = protect the win.
  // (Selling here locks ~breakeven — no loss — so, unlike every loss-side exit,
  // acting on unknown tape is the safe choice, not a gamble.)
  const buyersReturning =
    stats != null && stats.buysM5 + stats.sellsM5 >= 8 && stats.buysM5 > stats.sellsM5 && stats.chgM5 > 0;

  // Quick scan-mode caps the stop at −8% no matter the stored knob (same
  // silent-cap pattern as the 12/8 trail below): with wins banked in the
  // +3–5% range, a −10 stop that fills at −12 lets ONE loser eat four
  // winners — the loss ceiling must match the win size. Watch mode and
  // other styles honor the stored knob.
  // Two-tier healthy-climber cushion (quick scan). A normal pullback shouldn't
  // shake a genuine buyer-led climber out of the −4.5% scalp stop. Positive
  // evidence only: null stats = normal tight stop (never wider).
  //  • PROVEN climber — the LONGER trend is provably still up (6h AND 24h green)
  //    and buyers haven't fled (no hourly or 5m sell avalanche). Earns the full
  //    −12% cushion AND skips the early-cut / crash-cut (it has earned trust).
  //  • FRESH climber — a stair-stepper whose 6h/24h haven't caught up yet (the
  //    Loom case): the HOUR is up with buyers leading a real hour sample. Keyed
  //    on the HOUR tape so it survives a single red 5m pullback candle. Gets a
  //    MIDDLE −8% stop (not the full −12%) and does NOT skip the crash cut — a
  //    real avalanche still cuts it fast. Disqualified only by a sustained HOUR
  //    sell avalanche, never by a lone 5m candle.
  const hourSellAvalanche =
    stats != null && stats.buysH1 + stats.sellsH1 >= 20 && stats.sellsH1 > stats.buysH1 * 1.5;
  const provenClimb =
    s.style === "quick" && !s.targetMint && stats != null &&
    stats.chgH6 > 0 && stats.chgH24 > 0 && !hourSellAvalanche &&
    !(stats.buysM5 + stats.sellsM5 >= 8 && stats.sellsM5 > stats.buysM5 * 1.5);
  // Fresh-climber admission also needs the 5m to NOT be actively rolling over.
  // The hour gate alone can be green while the current 5m is already diving —
  // granting −8% room there (with early-cut disabled) would let a real fade
  // bleed to −8% instead of cutting near −4/−5. Allow the wider room only if
  // the 5m isn't diving, OR it is diving but buyers still match on a real 5m
  // sample (a healthy pullback being absorbed, not a dump).
  const fresh5mHolding =
    stats != null &&
    (stats.chgM5 > -3 || (stats.buysM5 + stats.sellsM5 >= 8 && stats.sellsM5 <= stats.buysM5));
  const freshClimb =
    s.style === "quick" && !s.targetMint && stats != null && !provenClimb &&
    stats.chgH1 > 0 &&
    stats.buysH1 + stats.sellsH1 >= FRESH_CLIMB_MIN_TXNS &&
    stats.buysH1 >= stats.sellsH1 && !hourSellAvalanche && fresh5mHolding;
  // A market trend can help the bot choose a token, but it cannot grant wider
  // loss room by itself. Extra room must be earned by THIS position after entry.
  // This prevents a bot buying late in an old trend, barely going green, then
  // holding to −8/−12% because the token's 6h/24h chart still looked positive.
  const earnedClimbRoom = peakPctNow >= HOLD_CLIMB_MIN_PEAK_PCT;
  const healthyClimb = provenClimb && earnedClimbRoom;
  const anyClimb = (provenClimb || freshClimb) && earnedClimbRoom;
  // Coil style buys a CALM base (5m flat within ±2%), so a −3% move IS the
  // base breaking — that's the "smart" stop the user asked for: it doesn't
  // shake out on normal wiggles (there are none in a tight base), it only
  // fires when the coil actually fails. Capped at COIL_STOP_PCT no matter the
  // stored knob, same silent-cap pattern as quick. Coil is NOT capQuick, so it
  // never gets the twitchy fast-fail/early-cut sub-cuts — just this one clean
  // line under the base plus the trail/reversal exits once the pop is running.
  // Owner-chosen stop room (quick scan, opt-in): when set, THIS is the firm
  // stop line — it replaces the tight 4.5% scalp cap AND the automatic climber
  // cushions (the owner explicitly bought room for runners; layering cushions
  // on top would double it). Steady-wins (conservative) keeps its own tight
  // stop — banking small wins with a 20% loss line makes no sense, and the UI
  // says the two don't combine.
  const ownerRoom =
    s.style === "quick" && !s.targetMint && !conservative && s.stopRoomPct != null
      ? Math.min(Math.max(s.stopRoomPct, 2), 50)
      : null;
  const automaticLoss = automaticLossPolicy({
    entryLiquidityUsd: Number(p.entryLiquidityUsd) || 0,
    entryVolumeH1Usd: Number(p.entryVolumeH1Usd) || 0,
    peakPct: peakPctNow,
    stats: stats ? {
      liquidityUsd: stats.liquidityUsd,
      liquidityKnown: stats.liquidityKnown,
      volH1Usd: stats.volH1Usd,
      volH1Known: stats.volH1Known,
      chgM5: stats.chgM5,
      chgM5Known: stats.chgM5Known,
      buysM5: stats.buysM5,
      sellsM5: stats.sellsM5,
      buysH1: stats.buysH1,
      sellsH1: stats.sellsH1,
    } : null,
    chartHealthy: chart?.healthy === true,
    chartAccumulation: chart?.accumulation === true,
    provenClimb,
    freshClimb,
    dollarOutflowConfirmed: dollarsLeaving(flow),
  });
  const effStopPct =
    s.style === "quick" && !s.targetMint
      ? conservative
        // Steady-wins exception (user's Hoppy case): a PROVEN climber — 6h AND
        // 24h provably green with buyers not fleeing — earns a middle −8%
        // cushion instead of the firm −3. Positive evidence only; the moment
        // the tape shows a sell avalanche the climb flag flips false on that
        // tick and the tight −3 re-arms. Fresh (hour-only) climbers do NOT
        // qualify — steady-wins gives room only to the strongest pattern.
        ? provenClimb ? CONSERVATIVE_CLIMB_STOP_PCT : CONSERVATIVE_STOP_PCT
        : ownerRoom != null
          // An owner percentage is the line they chose. Automatic must never
          // silently widen it because the token looks like a climber.
          ? ownerRoom
          : automaticLoss.stopPct
      : s.style === "coil" && !s.targetMint
        ? Math.min(s.stopLossPct, COIL_STOP_PCT)
        : s.stopLossPct;
  const stopLossVerdict = () => ({ sell: true, reason: "stop_loss", detail: s.style === "coil" && !s.targetMint
    ? `Down ${pnlPct.toFixed(1)}% — the base broke, cutting it here (smart stop at −${effStopPct}%).`
    : `Down ${pnlPct.toFixed(1)}% — cutting the loss (stop at −${effStopPct}%).` });
  if (pnlPct <= -effStopPct) {
    if (!allowWickDefer) {
      // Fast lane (stale peek tape): a real stop breach always sells now, and
      // never touches the deferral map — the full tick owns that state.
      return stopLossVerdict();
    }
    // Flash-wick reprieve — full tick only, tight quick-scan scalp stop only.
    // An owner-chosen wide room doesn't need it (a wick deep enough to breach
    // −20% is not a wick).
    const quickScalp = s.style === "quick" && !s.targetMint && !conservative && !anyClimb && ownerRoom == null;
    const flashWickHealthy =
      quickScalp && !automaticLoss.confirmedBreakdown && stats != null &&
      stats.chgM5 > FLASH_WICK_MIN_M5 &&
      stats.buysM5 + stats.sellsM5 >= FLASH_WICK_MIN_TXNS &&
      stats.buysM5 >= stats.sellsM5 &&
      p.entryLiquidityUsd > 0 && stats.liquidityUsd >= p.entryLiquidityUsd * FLASH_WICK_MIN_LIQ_FRAC;
    const nowMs = Date.now();
    const deferredAt = stopWickDeferrals.get(p.id);
    const alreadyWaited = deferredAt != null && nowMs - deferredAt < FLASH_WICK_DEFER_MS;
    if (flashWickHealthy && !alreadyWaited) {
      // First stab past the stop on a still-healthy tape — hold ONE check. Fall
      // through (do NOT return): the crash cut / early cut below stay armed so a
      // genuine fast dump the health check missed still gets cut this same tick.
      // Prune stale keys opportunistically so the map can't grow unbounded even
      // if some close path ever skips its cleanup.
      if (stopWickDeferrals.size > 500) {
        for (const [k, t] of Array.from(stopWickDeferrals.entries())) {
          if (nowMs - t >= FLASH_WICK_DEFER_MS) stopWickDeferrals.delete(k);
        }
      }
      stopWickDeferrals.set(p.id, nowMs);
    } else {
      stopWickDeferrals.delete(p.id);
      return stopLossVerdict();
    }
  } else if (allowWickDefer && stopWickDeferrals.has(p.id)) {
    // Recovered back above the stop — clear the pending reprieve so a later,
    // separate drop earns its own fresh one-check confirmation.
    stopWickDeferrals.delete(p.id);
  }

  // Quick take-profit (optional, scalp style): bank the win the moment the
  // target is hit — no waiting for the trailing stop to arm. pnlPct is based
  // on a REAL sell quote, so fees/impact are already in the number.
  if (s.takeProfitPct != null && pnlPct >= s.takeProfitPct) {
    return {
      sell: true, reason: "take_profit",
      detail: `Hit the +${s.takeProfitPct}% take-profit target — banking +${pnlPct.toFixed(1)}%.`,
    };
  }

  // Chart pattern: blow-off top. The candles show a vertical run into a
  // reversal shape with buying volume fading from its climax — the classic
  // "about to crash any minute" picture. Only fires when the position is in
  // real profit (> fees), and only on POSITIVE candle evidence — missing
  // chart data can never trigger this.
  if (chart?.blowoff && pnlPct >= 4) {
    return {
      sell: true, reason: "chart_signal",
      detail: `Blow-off top forming (${chart.detail}) — banking +${pnlPct.toFixed(1)}% before the drop.`,
    };
  }

  // Quick style is DEFINED as in-and-out: the profit lock arms early (+12%)
  // and gives back little (8% off the peak), no matter what the stored knobs
  // say — older strategies were created with 25/20 defaults and sat on big
  // winners watching them bleed back (user's complaint). Anyone who wants
  // loose trails and long holds should use the "ride" style — that's what
  // it's for. Watch mode (targetMint) is exempt from the caps — the user
  // chose the token AND the knobs deliberately; honor them as stored.
  const capQuick = s.style === "quick" && !s.targetMint;

  // Reversal tell (quick scan, in profit): sellers clearly flipped the 5m tape
  // — sell NOW regardless of any trail/protect floor. Positive evidence only.
  // Dollar-flow reversal tell (quick + momentum-cycle, in profit): the chain
  // says real dollars are clearly LEAVING (sell-$ ≥ 1.5× buy-$ on a meaningful
  // sample) and the candle has stopped rising — sell even if the buy/sell
  // COUNTS still look balanced. This is the RAKO shape: hundreds of small buys
  // masking bigger sells. Positive evidence only; flow=null never fires.
  if ((capQuick || (s.momentumCycle && (s.style === "ride" || !!s.targetMint)))
      && pnlPct >= REVERSAL_MIN_PROFIT_PCT && dollarsLeaving(flow)
      && stats != null && stats.chgM5Known && stats.chgM5 <= 0) {
    return {
      sell: true, reason: "big_money_selling",
      detail: `Real dollars are leaving — ${flowLabel(flow!)} — even though the buyer count looks healthy, and the price has stopped rising (5m ${stats.chgM5.toFixed(1)}%). Banking +${pnlPct.toFixed(1)}% before the bigger sellers finish.`,
    };
  }

  if (capQuick && pnlPct >= REVERSAL_MIN_PROFIT_PCT && stats != null) {
    const txM5 = stats.buysM5 + stats.sellsM5;
    // chgM5 <= 0 gate: a sell-count lead on a candle that is STILL GREEN means
    // the buyers are bigger (dollars beat counts) — don't bank into a rise.
    // dollarsArriving veto: when the chain PROVES the buyers carry more
    // dollars, a scary sell-count lead is noise — hold.
    if (txM5 >= 8 && stats.sellsM5 > stats.buysM5 * 1.5 && stats.chgM5Known && stats.chgM5 <= 0 && !dollarsArriving(flow)) {
      return {
        sell: true, reason: "sellers_took_over",
        detail: `Sellers flipped the tape (${stats.sellsM5} sells vs ${stats.buysM5} buys in 5m, candle ${stats.chgM5.toFixed(1)}%) — selling immediately at +${pnlPct.toFixed(1)}% instead of waiting for the trail floor.`,
      };
    }
  }

  // Momentum-shift early sell (opt-in, Long ride + Watch long holds only): the
  // user's "the minute it notices a shift, boom it sells — it doesn't have to
  // drop a ton" rule. On a PROVEN-up long hold, sell the instant the fast 5m
  // tape flips clearly sell-heavy — EARLIER than the double-confirmed
  // sellers_took_over tell below (which waits for the 1h tape too) — so it banks
  // into strength before the real drop. The comeback path then re-buys the dip
  // and cycles the same token. Positive tape evidence only: null stats (unknown
  // this tick) is NEVER a sell signal — core invariant. Deliberately does NOT
  // touch the wide long-hold stop or add any tight quick take-profit.
  const momentumCycle = s.momentumCycle && (s.style === "ride" || !!s.targetMint);
  if (momentumCycle && pnlPct >= REVERSAL_MIN_PROFIT_PCT && stats != null) {
    const txM5 = stats.buysM5 + stats.sellsM5;
    // Same dollar-weighted gate: only fire once the candle has actually
    // stopped rising — a green 5m with a sell-count lead is bigger buyers.
    if (txM5 >= 8 && stats.sellsM5 > stats.buysM5 * 1.5 && stats.chgM5Known && stats.chgM5 <= 0 && !dollarsArriving(flow)) {
      return {
        sell: true, reason: "momentum_shift",
        detail: `Momentum is shifting — ${stats.sellsM5} sells vs ${stats.buysM5} buys in the last 5 minutes and the price has stopped rising (5m ${stats.chgM5.toFixed(1)}%). Banking +${pnlPct.toFixed(1)}% into strength; if it dips and buyers step back in, it re-buys and rides the next leg.`,
      };
    }
  }

  // Runner exception: buyers still clearly in control right now (real 5m
  // sample, buys leading, green 5m) on a trade that has already proven itself
  // (peak ≥ +15%). While this holds, the trail/protect floors below get to
  // bend — but never past 15% off the peak, and never through the breakeven
  // guard. null stats = false: unknown tape never loosens the grip.
  const buyersInControl = capQuick && buyersReturning;
  const givebackPct = highWater > 0n ? (Number(highWater - valueLamports) / Number(highWater)) * 100 : 0;
  const runnerHold =
    buyersInControl && peakPctNow >= RUNNER_MIN_PEAK_PCT && givebackPct < RUNNER_MAX_GIVEBACK_PCT;

  // Let a +3% winner keep running only while fresh short-term and hourly
  // evidence agree that it is still rising. Unknown tape never earns this
  // exception, and it disappears as soon as price or buyer pressure fades.
  const clearRisingSignal =
    capQuick &&
    stats != null &&
    stats.chgM5Known &&
    stats.chgM5 > 0 &&
    stats.chgH1 > 0 &&
    stats.chgH6 > 0 &&
    stats.buysM5 >= stats.sellsM5 &&
    stats.buysH1 >= stats.sellsH1;
  // Small-win first: the owner prefers taking a repeatable executable +3%
  // instead of letting a modest winner round-trip into a loss. Clear rising
  // evidence is the exception; once that evidence fades, bank the gain.
  // The explicit Runner choice (keep 40% of the best gain) skips the routine
  // +3% bank so the position can attempt a larger second leg. Confirmed
  // reversals, loss protection, liquidity safety, and emergency exits remain.
  const smallWin = capQuick && usesAutomaticSmallWinPlan(s.takeProfitPct, s.winnerKeepPct)
    ? automaticSmallWinDecision(peakPctNow, pnlPct, clearRisingSignal)
    : null;
  if (smallWin === "take") {
    return {
      sell: true,
      reason: "small_win_take",
      detail: `Reached a real executable +${pnlPct.toFixed(1)}% — banking the small win now instead of risking a round trip into loss. The bot keeps watching ${p.symbol} and can re-buy only after a fresh comeback or unusually strong continuation.`,
    };
  }
  if (smallWin === "protect") {
    return {
      sell: true,
      reason: "small_win_protect",
      detail: `Peaked at +${peakPctNow.toFixed(1)}% and only ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}% remains — protecting the former winner before it falls further. The bot keeps watching ${p.symbol} for a confirmed re-entry.`,
    };
  }

  // Adaptive quick-profit guard (default, quick scan): a 12% trail arm is a
  // BACKUP ceiling, not a promise that every setup can reach 12%. When a trade
  // has already shown a small gain and the current tape stalls, require two
  // separate full-tick confirmations before banking it. A healthy longer-term
  // climb also gets more room, because a temporary 5m pause can precede a run.
  const posAgeMs = Date.now() - new Date(p.openedAt).getTime();
  const realShortTape = stats != null && stats.buysM5 + stats.sellsM5 >= ADAPTIVE_MIN_M5_TXNS;
  const shortTapeStalled =
    realShortTape && stats!.chgM5Known && stats!.chgM5 <= 0 &&
    stats!.sellsM5 >= stats!.buysM5 && !dollarsArriving(flow);
  const runnerCouldContinue =
    stats != null && stats.chgH1 > 0 && stats.chgH6 > 0 && stats.buysH1 >= stats.sellsH1;
  let adaptiveTakeConfirmed = false;
  // Only the full tick owns this confirmation state. The 10s fast lane uses
  // cached tape and must not start or advance a stall confirmation.
  if (allowWickDefer) {
    if (shortTapeStalled && !runnerCouldContinue) {
      const stalledAt = adaptiveTakeStalls.get(p.id);
      const now = Date.now();
      if (stalledAt != null && now - stalledAt >= ADAPTIVE_STALL_CONFIRM_MS) {
        adaptiveTakeConfirmed = true;
      } else if (stalledAt == null) {
        adaptiveTakeStalls.set(p.id, now);
      }
    } else {
      adaptiveTakeStalls.delete(p.id);
    }
  }
  // Automatic recovery hold: once a red trade works back above its executable
  // buy-in, do not let an already-confirmed reversal drift it red again. The
  // same two full-tick stall confirmations used by adaptive profit-taking keep
  // one noisy candle from firing this exit. This also safely handles a setup
  // that never went red but only produced a tiny, now-fading edge.
  if (
    capQuick && ownerRoom == null &&
    pnlPct >= 0 && adaptiveTakeConfirmed && !runnerCouldContinue
  ) {
    return {
      sell: true,
      reason: "recovery_reversal",
      detail: `The trade recovered to ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%, but the continuation signals have now reversed on two checks. Banking the recovery instead of letting it fall red again.`,
    };
  }
  if (
    capQuick && peakPctNow >= ADAPTIVE_SMALL_EDGE_PEAK_PCT &&
    pnlPct >= ADAPTIVE_SMALL_EDGE_MIN_PROFIT_PCT && adaptiveTakeConfirmed
  ) {
    return {
      sell: true,
      reason: "adaptive_take",
      detail: `The setup offered a smaller move (best +${peakPctNow.toFixed(1)}%) and the 5-minute tape has stalled — banking +${pnlPct.toFixed(1)}% instead of waiting for +12%.`,
    };
  }

  // Matching downside rule: if the setup never produces even a +2% gain, has
  // had time to develop, and the same real short tape confirms weakness, cut a
  // modest loss before the normal −4.5% stop. Missing/thin tape never triggers
  // this; a confirmed climber is exempt.
  if (
    capQuick && ownerRoom == null && (!anyClimb || automaticLoss.confirmedBreakdown) &&
    posAgeMs >= ADAPTIVE_WEAK_SETUP_MIN_AGE_MS &&
    peakPctNow < ADAPTIVE_SMALL_EDGE_PEAK_PCT &&
    pnlPct <= ADAPTIVE_WEAK_SETUP_LOSS_PCT && shortTapeStalled &&
    automaticLoss.confirmedBreakdown &&
    !automaticLoss.accumulating && !automaticLoss.activeVolatility
  ) {
    return {
      sell: true,
      reason: "adaptive_cut",
      detail: `This setup never developed (best +${peakPctNow.toFixed(1)}%) and sellers now control the short tape — cutting at ${pnlPct.toFixed(1)}% instead of waiting for the full −${effStopPct}% stop.`,
    };
  }

  // Conservative profit-taking (opt-in): the user's "up 3–5% in a tight spot —
  // just take it, UNLESS it's turning into a runner" rule. Bank the small win at
  // +4% the moment we have it, but only when we can actually SEE the tape and it
  // is NOT showing a runner (buyers clearly in control right now). If it IS
  // running, skip the take and let the trail/runner rules ride it toward the
  // bigger move. Missing tape data (stats == null) is NEVER a sell signal — same
  // invariant as every other exit here — so a blind +4% take can't fire and
  // bank us right before a run we couldn't see; the breakeven ratchet (armed at
  // +1.5%) still protects the win if it fades on a later tick.
  if (conservative && pnlPct >= CONSERVATIVE_TAKE_PCT && stats != null && !buyersInControl) {
    return {
      sell: true, reason: "conservative_take",
      detail: `Up +${pnlPct.toFixed(1)}% and the tape isn't showing a runner — banking the small win (conservative mode). It goes back in the scan pool, so a re-buy is possible if it dips and still scores.`,
    };
  }

  const effArmPct = capQuick ? Math.min(s.trailArmPct, 12) : s.trailArmPct;
  let effTrailPct = capQuick ? Math.min(s.trailPct, 8) : s.trailPct;
  // Peak-scaled trail (quick scan only): the bigger the win, the tighter the
  // grip. An 8% give-back off a +15% peak is proportionate; off a +80% peak
  // it hands back ~15 points of profit (user's case: peaked ~+80, filled in
  // the low 60s). Small winners keep room to develop, big winners get locked
  // down: peak ≥ +50% trails at 5%, ≥ +25% at 6%, below that the normal 8%.
  if (capQuick && solIn > 0n) {
    const peakPctSoFar = (Number(highWater - solIn) / Number(solIn)) * 100;
    if (peakPctSoFar >= 50) effTrailPct = Math.min(effTrailPct, 5);
    else if (peakPctSoFar >= 25) effTrailPct = Math.min(effTrailPct, 6);
  }
  // WINNER ROOM dial (quick scan, owner-chosen). NULL = the defaults above
  // (fast bank — keep ≥60% of the peak, the safest choice). When set, the
  // owner explicitly picked how much of the best gain a green trade must keep;
  // the trail giveback is derived from the SAME number so the two win-side
  // exits can't contradict each other (a lower keep% is meaningless if the 8%
  // trail still banks first — the HAPPYCAT +8.7%-then-+207% lesson).
  const winnerKeep = capQuick && s.winnerKeepPct != null
    ? Math.min(90, Math.max(40, s.winnerKeepPct))
    : null;
  if (winnerKeep != null && solIn > 0n) {
    const peakPctSoFar = (Number(highWater - solIn) / Number(solIn)) * 100;
    if (peakPctSoFar > 0) {
      // Giveback allowed from the top ≈ (100−keep)% of the peak, bounded so a
      // huge runner can never give back more than 30% of value in one slide.
      effTrailPct = Math.min(30, Math.max(2, (peakPctSoFar * (100 - winnerKeep)) / 100));
    }
  }
  const armAt = solIn + (solIn * BigInt(Math.round(effArmPct * 100))) / 10_000n;
  if (highWater >= armAt) {
    const trailFloor = highWater - (highWater * BigInt(Math.round(effTrailPct * 100))) / 10_000n;
    if (valueLamports <= trailFloor && !runnerHold) {
      const peakPct = solIn > 0n ? (Number(highWater - solIn) / Number(solIn)) * 100 : 0;
      return {
        sell: true, reason: "trailing_stop",
        detail: `Peaked at +${peakPct.toFixed(0)}%, gave back ${givebackPct.toFixed(1)}% from the top — banking +${pnlPct.toFixed(1)}%.`,
      };
    }
  }

  // Profit protect — once a quick trade has been up +10%, keep at least 60% of
  // the best gain. Below +10% only the breakeven guard defends (floor +1.5%),
  // so small winners keep running; once armed, peak +12% sells at ~+7.2% on the
  // way down. Floor scales with the peak so winners still run;
  // pnlPct comes from a real sell quote, so fees/impact are already in it.
  if (capQuick && solIn > 0n) {
    const peakPct = (Number(highWater - solIn) / Number(solIn)) * 100;
    if (peakPct >= PROFIT_PROTECT_ARM_PCT) {
      const keepRatio = winnerKeep != null ? winnerKeep / 100 : PROFIT_PROTECT_KEEP_RATIO;
      const floorPct = peakPct * keepRatio;
      if (pnlPct <= floorPct && !runnerHold) {
        return {
          sell: true, reason: "profit_protect",
          detail: `Peaked at +${peakPct.toFixed(1)}% and started dropping — banking +${pnlPct.toFixed(1)}% (keeps at least ${Math.round(keepRatio * 100)}% of the best gain${winnerKeep != null ? ", your winner-room setting" : ""}). The token goes back in the scan pool — if it dips and still scores strongest, the bot can buy back in.`,
        };
      }
    }
  }

  // Breakeven guard — never let a decent winner turn into a loser. Fires in
  // the gap the trailing stop leaves open: peak reached BREAKEVEN_ARM_PCT but
  // never the +12% arm, then faded back to (or below) BREAKEVEN_FLOOR_PCT.
  // Uses the same highWater the trailing stop uses, so it protects positions
  // opened BEFORE this rule existed too. Quick style, scan mode only.
  if (capQuick && solIn > 0n) {
    const peakPct = (Number(highWater - solIn) / Number(solIn)) * 100;
    // Conservative mode arms the ratchet MUCH earlier (peak +1.5%, floor 0%):
    // "once it recovers above my price, don't let it go red again." Normal quick
    // mode waits for a decent +5% winner before protecting breakeven.
    const armPct = conservative ? CONSERVATIVE_BREAKEVEN_ARM_PCT : BREAKEVEN_ARM_PCT;
    const floorPct = conservative ? CONSERVATIVE_BREAKEVEN_FLOOR_PCT : BREAKEVEN_FLOOR_PCT;
    // Reprieve: if buyers are visibly stepping back in right now, hold — the
    // user's "unless there are positive signs it'll go back up" escape. If it
    // keeps dropping the −4.5% hard stop still catches it.
    // Second reprieve (holding-after-climb): a position that PROVED a real climb
    // (peak ≥ HOLD_CLIMB_MIN_PEAK_PCT) and whose tape is HOLDING — buyers at
    // least matching sellers on a real 5m sample, 5m not dropping harder than
    // HOLD_CLIMB_MAX_DIP_M5 — is not banked at breakeven; it gets room to resume
    // the staircase down to the −4.5% stop. A declining tape (sellers lead /
    // sharp red 5m) fails this test, so a genuine fade is still banked here.
    // Steady-wins coherence (same July 2026 ask as the −8 climber stop): a
    // PROVEN climber in conservative mode also gets this reprieve — otherwise
    // the ratchet banks it at ~0 on a gentle pullback before the −8 cushion
    // ever matters. The tape test below stays strict (real 5m sample, buyers
    // at least matching, no sharp red 5m), so a genuine dump is still banked.
    const holdingAfterClimb =
      (!conservative || provenClimb) && stats != null &&
      // Let a healthy winner breathe while it is still green, but never use
      // this reprieve to carry a former winner into a loss. A sudden market
      // jump can still produce a slightly red executable quote.
      pnlPct >= 0 &&
      // Lowered the arm to +2% for a proven/fresh climber (was a flat +5%) so a
      // small stair-stepper like Loom (peaked +2.3%, buyers still leading) isn't
      // banked red on a normal pullback. A NON-climber still needs the old +5%
      // peak. Either way the tape must be real and buyer-led with no sharp red 5m.
      peakPct >= (anyClimb ? HOLD_CLIMB_MIN_ARM_PCT : HOLD_CLIMB_MIN_PEAK_PCT) &&
      stats.buysM5 + stats.sellsM5 >= 8 &&
      stats.sellsM5 <= stats.buysM5 &&
      stats.chgM5 >= HOLD_CLIMB_MAX_DIP_M5;
    // Owner-chosen stop room consistency (the BUNKEE case): when the owner
    // explicitly bought a wide room (−20%), the breakeven guard must NOT sell
    // a former winner RED — that silently defeats the room exactly like the
    // old −4 early cut did. With ownerRoom set, the guard only banks while
    // the trade is still at/above breakeven; once red, the position rides on
    // the owner's room (the scaled early/crash cuts and the stop still apply).
    const automaticRecoveryHold = capQuick && ownerRoom == null;
    const redBankBlocked = (ownerRoom != null || automaticRecoveryHold) && pnlPct < 0;
    if (
      peakPct >= armPct && pnlPct <= floorPct &&
      !buyersReturning && !holdingAfterClimb && !redBankBlocked &&
      !automaticRecoveryHold
    ) {
      return {
        sell: true, reason: "breakeven_guard",
        detail: pnlPct >= 0
          ? `Was up +${peakPct.toFixed(1)}% and fading — locking the small win at +${pnlPct.toFixed(1)}% instead of letting a winner turn into a loss.`
          : `Was up +${peakPct.toFixed(1)}% but slipped to ${pnlPct.toFixed(1)}% — selling now rather than riding a former winner down to the stop-loss.`,
      };
    }
  }

  // Early cut — a quick trade that never worked doesn't get to ride to the
  // full stop-loss. Fast tier: 5+ minutes old, never above +1%, down 3%+.
  // Slow tier: 20+ minutes old, never above +2%, down 4%+. Either way the
  // entry thesis is dead — take a fraction of the stop damage. Reprieve only
  // on positive evidence that buyers are stepping in right now.
  if (capQuick && solIn > 0n) {
    const peakPct = (Number(highWater - solIn) / Number(solIn)) * 100;
    // The −3% fast-fail tier was REMOVED (user: "cutting the loss at −3 doesn't
    // make sense") — a fresh trade now gets room instead of being cut at −3% in
    // its first 5 minutes. Only the slow-bleed tier remains: 20+ min old, never
    // rose above +2%, and down 4%+ = a genuinely dead trade. Reprieve still
    // needs POSITIVE evidence of buyers stepping in right now.
    // Owner-chosen stop room is ABSOLUTE (July 2026: the half-room scaling
    // still sold FOMO at −13 inside a −20 room, right before a reversal).
    // With ownerRoom set, the early cut is fully disabled — the owner's number
    // is the only loss-side line. Smart-default bots keep the early cut.
    const slowBleed =
      ownerRoom == null &&
      posAgeMs >= EARLY_CUT_MIN_AGE_MS &&
      peakPct < EARLY_CUT_PEAK_PCT &&
      pnlPct <= EARLY_CUT_LOSS_PCT &&
      automaticLoss.confirmedBreakdown &&
      !automaticLoss.accumulating &&
      !automaticLoss.activeVolatility;
    // A confirmed climber (proven OR fresh: trend up, buyers not fleeing) rides
    // to its wider stop cushion instead of being early-cut at −4% — that's the
    // whole point of the cushion. If the tape turns into a real sell-off the
    // climb flags flip false on that tick and the early cut re-arms.
    if (slowBleed && (!anyClimb || automaticLoss.confirmedBreakdown)) {
      if (!buyersReturning) {
        return {
          sell: true, reason: "early_cut",
          detail: `This trade never worked — ${Math.round(posAgeMs / 60_000)} minutes in, it never got above +${peakPct.toFixed(1)}% and is now ${pnlPct.toFixed(1)}%. Cutting it here instead of riding it down to the −${effStopPct}% stop.`,
        };
      }
    }
  }

  // Crash cut — react to the slope, not just the line. Down 6%+ with the tape
  // actively dumping means the −10 stop will fill at −15/−26 by the time the
  // next check sees it (user's AVAJAK case). Requires POSITIVE evidence of
  // dumping; missing data never triggers it. Exempts a confirmed healthy
  // climber so a sharp-but-orderly pullback (no sell avalanche, longer trend
  // still up) rides to the −12% cushion; a genuine avalanche flips healthyClimb
  // false and re-arms this cut.
  // Owner-chosen stop room is ABSOLUTE (July 2026: half-room crash cut sold
  // FOMO at −14.6 inside a −20 room, right before a reversal). With ownerRoom
  // set, the crash cut is fully disabled — the owner's number is the only
  // loss-side line. Smart-default bots keep the crash cut.
  if (
    capQuick && solIn > 0n && ownerRoom == null &&
    pnlPct <= CRASH_CUT_LOSS_PCT && (!healthyClimb || automaticLoss.confirmedBreakdown) &&
    automaticLoss.confirmedBreakdown && !automaticLoss.accumulating
  ) {
    const dumping =
      stats != null &&
      (stats.chgM5 <= CRASH_CUT_CHG_M5 ||
        (stats.buysM5 + stats.sellsM5 >= 8 && stats.sellsM5 > stats.buysM5 * 1.5));
    if (dumping) {
      return {
        sell: true, reason: "momentum_stop",
        detail: `Down ${pnlPct.toFixed(1)}% and the selling is accelerating (5m: ${stats!.chgM5.toFixed(1)}%, ${stats!.sellsM5} sells vs ${stats!.buysM5} buys) — getting out now instead of waiting for the −${effStopPct}% stop to fill even lower.`,
      };
    }
  }

  // Dip/coil get never-round-trip-a-win protection with more wobble room than
  // quick (arm +8): a bounce that caught a real move must bank it, not ride the
  // second leg down. Floor is now breakeven (0%) with the buyers-returning
  // reprieve, same as quick.
  // Ride now shares this guard too (user: "once a token is above 0, don't let
  // it drop below unless there are positive signs it'll recover"). Because ride
  // is a hold-long style, the reprieve does the heavy lifting: a ride winner
  // that fades back to breakeven is only sold when buyers have ALSO left the
  // tape — fully consistent with ride's "buyers lead the exit" philosophy.
  if ((s.style === "dip" || s.style === "coil" || s.style === "ride") && !s.targetMint && solIn > 0n) {
    const peakPct = (Number(highWater - solIn) / Number(solIn)) * 100;
    if (peakPct >= DIP_BREAKEVEN_ARM_PCT && pnlPct <= DIP_BREAKEVEN_FLOOR_PCT && !buyersReturning) {
      return {
        sell: true, reason: "breakeven_guard",
        detail: pnlPct >= 0
          ? `The bounce reached +${peakPct.toFixed(1)}% and is fading — banking +${pnlPct.toFixed(1)}% instead of letting the recovery turn back into a loss.`
          : `The bounce reached +${peakPct.toFixed(1)}% but slipped to ${pnlPct.toFixed(1)}% — selling now rather than riding the second leg down.`,
      };
    }
  }

  if (s.style === "ride" || s.style === "dip" || s.style === "coil") {
    // Long-ride + dip + coil styles: BUYERS lead the exit, not the clock. Hold through dips
    // as long as buy pressure is intact; exit on either of the sell-off tells:
    // (1) sellers clearly take over the tape, (2) 1h volume collapses.
    const buys = stats ? stats.buysH1 : null;
    const sells = stats ? stats.sellsH1 : null;
    // The hour alone is a STALE signal: one old sell burst can skew it 1.5:1
    // long after buyers are back in control (July 2026: Mr Loody sold at +4.1%
    // on an hour-skewed tape, then kept running). "Let it ride" means the exit
    // needs sellers dominating RIGHT NOW with the price actually falling —
    // same positive-evidence bar as the sell-off safety cut.
    if (
      buys != null && sells != null && buys + sells >= 30 &&
      sells > buys * 1.5 &&
      stats!.sellsM5 + stats!.buysM5 >= 8 &&
      stats!.sellsM5 >= stats!.buysM5 * 1.5 &&
      stats!.chgM5 <= -2
    ) {
      return {
        sell: true, reason: "sellers_took_over",
        detail: `Sell pressure took over — ${sells} sells vs ${buys} buys in the last hour, the 5m tape is sell-dominated (${stats!.sellsM5} vs ${stats!.buysM5}) and the candle is falling (${stats!.chgM5.toFixed(1)}%). Exiting at ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}% before the dump deepens.`,
      };
    }
    if (currentVolH1 != null && p.entryVolumeH1Usd > 0 && currentVolH1 < p.entryVolumeH1Usd * 0.3) {
      const volPct = Math.round((currentVolH1 / p.entryVolumeH1Usd) * 100);
      return {
        sell: true, reason: "volume_fade",
        detail: `Buyers left — 1h volume collapsed to ${volPct}% of what it was at entry ($${Math.round(currentVolH1).toLocaleString()} vs $${Math.round(p.entryVolumeH1Usd).toLocaleString()}). Exiting at ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}% before the sell-off.`,
      };
    }
  } else if (pnlPct > 8 && currentVolH1 != null && p.entryVolumeH1Usd > 0 && currentVolH1 < p.entryVolumeH1Usd * 0.35) {
    return {
      sell: true, reason: "volume_fade",
      detail: `In profit +${pnlPct.toFixed(1)}% but 1h volume dried up (${Math.round(currentVolH1).toLocaleString()} vs ${Math.round(p.entryVolumeH1Usd).toLocaleString()} at entry) — taking it.`,
    };
  }

  // A position shares the bot's run timer instead of having a second,
  // user-configured clock. Unlimited bots have no time-based position exit;
  // their market, stop-loss, and profit-protection exits still apply.
  const effMaxHoldHours = effectivePositionMaxHoldHours(
    s.unlimitedWindow,
    capQuick && ownerRoom == null,
    s.maxHoldHours,
  );
  const ageMs = Date.now() - new Date(p.openedAt).getTime();
  if (ageMs > effMaxHoldHours * 3600_000) {
    // Ride style: the time-stop is SOFT — if buyers are still clearly in
    // control right now (real sample, buys leading, volume holding up), keep
    // riding. The position is never on a clock while the tape stays healthy;
    // only the strategy's own run window is a hard end. Needs positive
    // evidence to extend — unknown/missing data at the cap means sell.
    if (s.style === "ride" || s.style === "dip" || s.style === "coil") {
      const tapeHealthy =
        stats != null &&
        stats.buysH1 + stats.sellsH1 >= 20 &&
        stats.buysH1 > stats.sellsH1 &&
        stats.volH1Known && p.entryVolumeH1Usd > 0 && stats.volH1Usd >= p.entryVolumeH1Usd * 0.5;
      if (tapeHealthy) return { sell: false, reason: "", detail: "" };
    } else if (chart?.healthy && pnlPct > 0) {
      // Quick style: the time-stop bends (never breaks) for a chart that is
      // STILL stair-stepping up while the position is in profit — "if it
      // keeps running, we need to know" (user's ask). Needs positive candle
      // evidence; missing chart data means the clock wins as before.
      return { sell: false, reason: "", detail: "" };
    } else if (ownerRoom != null && pnlPct < 0) {
      // Owner-chosen stop room is ABSOLUTE (July 2026): the time-stop must not
      // sell a red trade inside the owner's room either — only the owner's stop
      // line (or the run's end) closes a red position. Green stale positions
      // still time out normally.
      return { sell: false, reason: "", detail: "" };
    }
    return { sell: true, reason: "max_hold", detail: `Held ${Math.round(ageMs / 3600_000)}h (max ${effMaxHoldHours}h)${s.style === "ride" || s.style === "dip" || s.style === "coil" ? " and buyers are no longer clearly in control" : ""} — time-stop at ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%.` };
  }

  return { sell: false, reason: "", detail: "" };
}

// ─── Trade execution ─────────────────────────────────────────────────────────
// Final cancellation guard: a Stop flips status OUTSIDE the strategy lock, so
// a tick already past its status check could still be buying. Re-read right
// before committing money — a stopped/paused strategy must never open a
// position, no matter how far along the buy path the tick was.
async function stillActive(strategyId: string): Promise<boolean> {
  const fresh = await storage.getSwingStrategy(strategyId);
  return fresh?.status === "active";
}

// Fresh "Never buy again" check — reads the DB, NOT the caller's strategy
// snapshot, so a block toggled WHILE a tick/manual buy is already in flight is
// still honored before any money moves (the /block endpoint updates the DB
// independently of the per-strategy lock).
async function isMintBlocked(strategyId: string, mint: string): Promise<boolean> {
  const fresh = await storage.getSwingStrategy(strategyId);
  return (fresh?.blockedMints ?? []).includes(mint);
}

// Duplicate-buy guard: without stacking, the same mint must never be bought
// twice. The tick's candidate filter already excludes open mints, but two
// overlapping server processes (deploy rollover) can each pass that check —
// re-read right before committing money (user-hit bug: CATCOIN bought twice
// 14 seconds apart).
async function alreadyHoldsMint(s: SwingStrategy, mint: string): Promise<boolean> {
  const occupied = await storage.listSwingPositions(s.id);
  if (occupied.some((p) => p.mint === mint && p.status === "pending_buy")) return true;
  if (s.allowStacking) return false;
  const open = occupied.filter((p) => p.status === "open");
  const held = open.filter((x) => x.mint === mint).length;
  // Multi-wallet DCA on the watched token: up to one open tranche per
  // sub-wallet — "already holding" only once every tranche is filled.
  if (s.targetMint === mint && dcaTrancheCount(s) > 1) return held >= dcaTrancheCount(s);
  return held > 0;
}

// ─── Honeypot guard ──────────────────────────────────────────────────────────
// Before ANY buy (paper or live), simulate a REAL reverse route: "if I
// bought these tokens, could I sell them back right now, and how much SOL
// would come back?" Two failure shapes:
//   • no sell route at all → classic honeypot (buys allowed, sells blocked)
//   • sell route exists but returns far too little → extreme sell tax / trap
// A healthy token round-trips at ~95-98% (two swaps of fees+impact). We only
// block below 70% — a margin wide enough that thin-but-honest pools pass while
// 30%+ sell taxes don't. This is a point-in-time check: a contract can turn
// hostile AFTER entry, which is what the every-minute real-sell-quote
// valuation catches (a token that becomes unsellable quotes null and the
// never-stuck sweep sends the raw tokens home).
const HONEYPOT_MIN_ROUNDTRIP = 0.70;

// ─── Entry price-impact guard ────────────────────────────────────────────────
// A buy that moves the price N% starts the trade ~N% underwater — with quick
// swing profit locks arming at +6–12%, a 2%+ self-inflicted haircut kills the
// trade before it starts. This bites exactly when the money gets big relative
// to the pool (the "$1000 into a thin pool" trap): small slices sail through,
// oversized slices get skipped with a plain-language explanation. Scan picks
// only — watch mode is the user's own explicit token choice with the full
// budget, and a hard block there would strand the run in a retry loop.
const MAX_ENTRY_IMPACT_PCT = 2;

// Entry pickiness (quick/ride momentum path, July 2026 — user "way more losses
// than wins"): raise the bar so fewer weak setups get bought. Real 1h momentum
// (not a nearly-flat token), the 5m must have steadied (not still sliding),
// buyers must lead on a real trade sample, and a quick buy needs a bit more
// pool age. Dip has its own separate gate set and is unaffected.
const MIN_QUICK_H1_MOMENTUM_PCT = 3;
const ENTRY_MIN_M5_PCT = -3;
const ENTRY_BUY_LEAD_MIN_TXNS = 15;
const QUICK_MIN_POOL_AGE_MIN = 45;
// Volume-acceleration bar (July 2026, user re: Loom "it didn't buy because
// volume didn't pick up — but when it's just 5% up, volume might not pick up
// YET"). Normally 1h volume must be surging vs the 24h average pace
// (ENTRY_ACCEL_MULT). A buyer-led climber gets a lower bar (ENTRY_CLIMB_ACCEL_MULT
// = just keep pace) because on a real step-climb the price moves FIRST and volume
// confirms a beat later. The $3k absolute 1h-volume floor still applies, so this
// never buys a move on dead/fake volume — it only stops rejecting an early climb.
const ENTRY_ACCEL_MULT = 1.5;
const ENTRY_CLIMB_ACCEL_MULT = 1.0;
// A "climb" needs a REAL 5m up-move, not a 0.x% flicker — a bare chgM5>0 could be
// a dead-cat bounce inside ongoing distribution. Require at least this 5m gain
// before the relaxed volume/sell-lead bars apply.
const ENTRY_CLIMB_MIN_M5_PCT = 1;
// Buy-lead tolerance (July 2026, user: "more SELLERS than buyers doesn't mean
// anything when buyers are still bigger in %"). We only have trade COUNTS from
// DexScreener, not per-side $ volume — but a RISING price IS the dollar-weighted
// signal (price only climbs when buy $ > sell $). So when a token is provably
// climbing right now, a MARGINAL 1h sell-count lead (≤ this ratio) is treated as
// profit-taking into strength, not distribution, and does not veto the entry. A
// clearer sell lead still blocks it.
const ENTRY_SELL_LEAD_MAX_RATIO = 1.3;
// ANTI-CHASE ceilings (quick/ride momentum path, July 2026 — user: "I keep
// jumping in and it's down 5–8% a minute later"). The single biggest cause of
// those instant losses is buying a coin RIGHT as it popped. Two hard ceilings:
//   • 5m already up more than ENTRY_MAX_M5_PCT = the spike is in progress —
//     that's the chase. Wait for it to steady (the pullback shape scores best).
//   • 1h already up more than ENTRY_MAX_H1_PCT = the move is largely over —
//     late entries buy the top. Tightened from the old loose 15%/80% ceilings.
// Real early momentum (3–6% on the 5m, up to +50% on the 1h) still passes.
const ENTRY_MAX_M5_PCT = 6;
const ENTRY_MAX_H1_PCT = 50;
// LATE-STAGE run guard (July 2026 — user: "we're not buying in until volume
// picks up way more and it's near the top; volume doesn't always mean it's
// about to pop — sometimes it means it already did"). The parabolic guard above
// only catches EXTREME runs (+150%/24h, +100%/6h) that are already rolling over.
// This milder guard catches the MODEST top: a token that has already run a solid
// amount over the BIGGER windows (6h/24h) — look past just 5m/1h — and no longer
// has buyers clearly pushing it on the 5m. That volume is the move ENDING, not
// starting, so we don't buy it high. A token that ran up but STILL has buyers
// piling in on a real 5m sample is a live staircase and is allowed through.
const LATE_STAGE_H6_PCT = 50;
const LATE_STAGE_H24_PCT = 120;
// Momentum entries: hourly volume must be at least this fraction of pool depth
// (see the three.ws note in judgeEntry — thin tape can't carry a move or an
// exit). Coil-style has its own volume rules; this applies to the quick/ride
// momentum path only.
const ENTRY_MIN_VOL_TO_LIQ_H1 = 0.05;
// WATCHLIST breakout (July 2026 — user: "when a starred token moves +5%,
// especially in our watchlist, we need to consider buying and entering"). A
// token the owner personally starred gets a looser, momentum-first entry: a
// clear +5%+ hourly move with buyers leading is enough to enter, even without
// the strict volume-acceleration confirmation the general scan requires. This is
// deliberately more aggressive than the auto-scan bar, and ONLY applies to the
// handful of mints the owner starred — NOT the whole universe. Every safety
// guard still holds: liquidity floor, live pool-age, the blow-off/parabolic
// guard, buyers-must-lead, rug/honeypot, and the finalist chart check (which
// still refuses a blow-off top). The 5m ceiling is relaxed vs the scan
// (WATCH_BREAKOUT_M5_MAX) so a normal green move isn't rejected, but a truly
// vertical candle is still passed on.
const WATCH_BREAKOUT_H1_PCT = 5;
const WATCH_BREAKOUT_M5_MAX = 12;
// LAST LOOK (live buys): the entry decision is made on scanner stats that can
// be up to STATS_TTL_MS old, and rug/safety checks + quote building add more
// seconds. A token can complete a 1–5 minute spike inside that window — the
// gates passed on pre-spike data, but the money would move at the tip (user-
// hit: several live picks bought a short spike top and all pulled back).
// So the instant before real money moves, re-read FRESH stats and refuse when:
//   • price has already run more than LAST_LOOK_MAX_RUN_PCT above the price
//     the decision was made at (we'd be paying the spike, not the setup), or
//   • the fresh 5m candle is now past the vertical ceiling (blow-off in
//     progress).
// Unknown fresh stats = proceed (the scan already provided positive evidence;
// a DexScreener hiccup must not starve every entry).
const LAST_LOOK_MAX_RUN_PCT = 5;
const LAST_LOOK_MAX_M5_PCT = 15;
// STAIRCASE entry (July 2026 — user: "Loom wasn't one straight spike, it went
// up in 5-minute steps and that's where the money is"). A single hot 5m candle
// is normally a chase, but a token climbing in steady buyer-led steps is the
// best momentum there is. When the 5m is above the anti-chase ceiling we let it
// through ONLY if it's part of a broader climb (chgH1 well above this one step,
// by ENTRY_STAIRCASE_H1_SPREAD) with buyers leading — AND the finalist chart
// check then REQUIRES a confirmed higher-lows staircase (readChart.healthy)
// before buying. A lone vertical candle (flat hour + one spike) fails the spread
// test; a spike that rolls over fails the chart's blow-off guard.
// ENTRY_STAIRCASE_M5_MAX caps how big a single step we'll ever consider.
const ENTRY_STAIRCASE_M5_MAX = 12;
const ENTRY_STAIRCASE_H1_SPREAD = 1.3;
// COIL / accumulation style gates (July 2026 — user's "buy the quiet base, not
// the spike" ask). Needs a real prior run (COIL_MIN_PRIOR_H24_PCT) but not a
// blow-off (COIL_MAX_PRIOR_H24_PCT); must be quiet THIS hour (1h within the
// [MIN,MAX] band) — not spiking (chase) and not sliding (base breaking). The
// 5m ±2% flat check and the candle accumulation proof live in the entry/chart
// code. COIL_STOP_PCT is the "smart" stop: because the base is calm, −3% is a
// genuine break, not a wiggle — one clean line, no twitchy sub-cuts.
const COIL_MIN_POOL_AGE_H = 12;
const COIL_MIN_PRIOR_H24_PCT = 5;
const COIL_MAX_PRIOR_H24_PCT = 100;
const COIL_MAX_H1_PCT = 15;
const COIL_MIN_H1_PCT = -15;
const COIL_STOP_PCT = 3;
// Coil "previous high volume" gate: the base only counts if the token was
// genuinely BUSY before going quiet — 24h volume at least half the pool depth
// (same "real trading interest" heuristic the finalist chart uses). A quiet
// coin that was ALSO always quiet is dead, not coiling.
const COIL_MIN_VOL_TO_LIQ = 0.5;
// ── Conservative profit-taking (quick scan style, opt-in) ──
// User's ask: "up 3–5% and it's just sitting in a tight spot — take the profit;
// but if it's turning into a runner, let it go." Small wins bank fast so the
// −3% losses we cut don't out-weigh them; the runner check keeps the upside.
const CONSERVATIVE_TAKE_PCT = 4; // bank at +4% unless the tape says runner
const CONSERVATIVE_STOP_PCT = 3; // "don't even drop below 3%"
// Steady-wins climber exception (user's Hoppy case, July 2026): the bot bought
// a genuine climber, the firm −3 stop cut it on a routine pullback, and the
// token kept running. A PROVEN climber (6h AND 24h green, no sell avalanche —
// the same strict tier that earns −12 in normal mode) gets a MIDDLE −8 cushion
// under steady-wins: room to breathe, but still tighter than normal mode
// because steady-wins banks small wins and must keep losses in the same league.
const CONSERVATIVE_CLIMB_STOP_PCT = 8;
// Ratchet: once it has shown even a small green (+1.5% peak), never let it slip
// back below breakeven — "it dipped, recovered above my price, don't go red again."
const CONSERVATIVE_BREAKEVEN_ARM_PCT = 1.5;
const CONSERVATIVE_BREAKEVEN_FLOOR_PCT = 0;
  // ── LIVE entry gates (post-MOGTROLL-rug, July 2026) ──
  // Real money still clears a higher bar than paper: a pool with enough depth,
// an established (not brand-new) pool on EVERY style, a POSITIVE rug-check pass
// (unknown is no longer good enough for live — the rug was an "unknown = allow"
// buy), and smaller slices so one rug can't take a big chunk. Paper keeps the
// looser gates so the scanner still surfaces the full opportunity set to study.
  // Live can now use the owner's selected liquidity setting down to $10k. This
  // is a real-money trade-off, not a bypass: pool age, positive rug checks,
  // honeypot/route checks, volume, momentum, chart, last-look, and impact guards
  // still run. The $10k option is intentionally explicit as the riskiest tier.
  const LIVE_MIN_LIQUIDITY_USD = 10_000;
const LIVE_MIN_POOL_AGE_H = 6;

  // Effective live liquidity floor. The strategy setting can remain more
  // conservative, but no live candidate may go below the explicit $10k floor.
  function liveLiqFloorUsd(_stats: CandidateStats, _style: string): number {
    return LIVE_MIN_LIQUIDITY_USD;
}

// BREAKEVEN GUARD (quick style, scan mode): the #1 rule of successful swing
// traders — never let a decent winner turn into a loser. Once a position has
// been up at least BREAKEVEN_ARM_PCT at any point, the worst acceptable
// outcome becomes a tiny locked win, not a loss: if profit fades back to
// BREAKEVEN_FLOOR_PCT (or below — including red), sell immediately. The
// trailing stop only arms at +12%, so a +7% winner had NO floor under it and
// could bleed all the way to the −10% stop (user's VINE case). Floor is
// +1.5%, not 0, so the exit still clears fees. Ride style is exempt on
// purpose — tolerating givebacks is its whole philosophy.
// PROFIT PROTECT (quick style, scan mode): a ratchet on top of the breakeven
// guard. Raised the arm 6 → 10 (July 2026, user "let winners run"): the old
// +6% arm was banking modest winners at ~+3–4% (20 of them averaged +3.3% in
// live data) before they could develop, while the trades that reached the +12%
// trailing stop averaged +16.5%. Now a small winner keeps running under only
// the breakeven guard (which still guarantees it can't round-trip into a loss,
// floor +1.5%); once the peak reaches +10% this ratchet keeps at least 60% of
// the best gain on the way down. The floor rises with the peak, so a runner
// keeps running. Pairs with the short quick-style win cooldown: after banking,
// the token goes back into the scan pool and can be re-bought after a dip if it
// scores strongest again (entry scoring is pullback-aware).
const PROFIT_PROTECT_ARM_PCT = 10;
const PROFIT_PROTECT_KEEP_RATIO = 0.6;
// BREAKEVEN GUARD (quick scan): the user's core rule — "once a token is above
// my price, don't let it drop back below unless there are positive signs it'll
// recover." Arms as soon as the position has been up a real +2% (small enough
// to catch nearly every green trade, big enough not to churn on entry noise),
// floor at breakeven (0%). The reprieve (buyersReturning) is the "positive
// signs" escape: while buyers are visibly stepping back in, hold; otherwise
// lock it at ~breakeven rather than let a winner slide into a loss.
const BREAKEVEN_ARM_PCT = 2;
const BREAKEVEN_FLOOR_PCT = 0;
// AUTO PROFIT TAKING is adaptive rather than a hard +12% wait. Once a quick
// setup has shown a real but small edge, a positively confirmed stall banks it;
// if it never develops and the same tape turns weak, downside is cut early.
// Both paths require a real five-minute sample and known candle direction.
const ADAPTIVE_MIN_M5_TXNS = 8;
const ADAPTIVE_SMALL_EDGE_PEAK_PCT = 2;
const ADAPTIVE_SMALL_EDGE_MIN_PROFIT_PCT = 0.5;
const ADAPTIVE_STALL_CONFIRM_MS = 60_000;
const ADAPTIVE_WEAK_SETUP_MIN_AGE_MS = 30 * 60_000;
const ADAPTIVE_WEAK_SETUP_LOSS_PCT = -8;
// Automatic quick scanners now favor repeatable small wins over hoping every
// green trade becomes a runner. The decision uses executable position value,
// not the chart headline: bank as soon as the net paper/live sell quote reaches
// +3%. If a fast move jumps over that check and then fades, protect the former
// winner once only +0.5% remains. A profitable close is automatically watched
// by the six-hour exit-price re-entry lane, which requires a fresh comeback or
// unusually strong continuation before buying the mint again.
const AUTOMATIC_SMALL_WIN_TAKE_PCT = 3;
const AUTOMATIC_SMALL_WIN_FLOOR_PCT = 0.5;

export function automaticSmallWinDecision(
  peakPct: number,
  pnlPct: number,
  clearRisingSignal = false,
): "take" | "protect" | null {
  if (!Number.isFinite(peakPct) || !Number.isFinite(pnlPct) || peakPct < AUTOMATIC_SMALL_WIN_TAKE_PCT) {
    return null;
  }
  return pnlPct >= AUTOMATIC_SMALL_WIN_TAKE_PCT && !clearRisingSignal
    ? "take"
    : pnlPct <= AUTOMATIC_SMALL_WIN_FLOOR_PCT
      ? "protect"
      : null;
}

export function usesAutomaticSmallWinPlan(
  takeProfitPct: number | null,
  winnerKeepPct: number | null,
): boolean {
  return takeProfitPct == null && winnerKeepPct !== 40;
}
const NEVER_SELL_MAX_LOSS_PCT = 12;
const NEVER_SELL_DECLINE_ARM_PCT = 8;
const NEVER_SELL_DECLINE_MIN_M5_TXNS = 8;
const NEVER_SELL_DECLINE_MIN_H1_TXNS = 30;

export function neverSellEmergencyExit(
  pnlPct: number,
  chgM5Known: boolean,
  chgM5: number,
  buysM5: number,
  sellsM5: number,
  buysH1: number,
  sellsH1: number,
  dollarOutflowConfirmed: boolean,
): "max_loss" | "confirmed_decline" | null {
  if (pnlPct <= -NEVER_SELL_MAX_LOSS_PCT) return "max_loss";
  if (pnlPct > -NEVER_SELL_DECLINE_ARM_PCT || !chgM5Known || chgM5 > -3) return null;

  const realM5 = buysM5 + sellsM5 >= NEVER_SELL_DECLINE_MIN_M5_TXNS;
  const realH1 = buysH1 + sellsH1 >= NEVER_SELL_DECLINE_MIN_H1_TXNS;
  const shortSellersControl = realM5 && sellsM5 > buysM5 * 1.5;
  const hourSellersControl = realH1 && sellsH1 > buysH1 * 1.5;
  return shortSellersControl && (hourSellersControl || dollarOutflowConfirmed)
    ? "confirmed_decline"
    : null;
}
// HOLDING-AFTER-CLIMB reprieve (July 2026, user: "if it went UP ~5% and is
// HOLDING WELL — not declining — don't bank me at breakeven the second it dips;
// give it room to resume the staircase; only cut it if it really drops or turns
// down"). When a position has PROVEN a real climb since we bought it (peak ≥
// HOLD_CLIMB_MIN_PEAK_PCT) AND the tape is still holding — buyers at least
// matching sellers on a real 5m sample and the 5m not dropping harder than
// HOLD_CLIMB_MAX_DIP_M5 — the breakeven guard holds instead of banking at ~0%.
// The normal −4.5% quick stop and the crash cut remain the backstops, so a
// genuine fade (sellers lead / sharp red 5m) flips this false and exits right
// away. Bounded extra risk: ~breakeven down to −4.5% (the "drops ~5%, then
// booted" the user explicitly accepts). Conservative mode is exempt (that mode
// is deliberately "bank at breakeven"). Not applied to fresh non-climbers.
const HOLD_CLIMB_MIN_PEAK_PCT = 5;
const HOLD_CLIMB_MAX_DIP_M5 = -2;
// Dip style gets its own, slightly wider breakeven guard (user's ask: "I just
// don't want a whole section to be on a big loss all the time"): a dip
// recovery that has been up +8% must never round-trip into a loss — if it
// fades back to +2%, bank the win. Wider than quick's 5/1.5 because dips
// wobble near the bottom; a +5% arm would sell healthy recoveries mid-wobble.
// Ride stays exempt — it's the only style meant to sit through give-backs.
const DIP_BREAKEVEN_ARM_PCT = 8;
// Floor lowered 2 → 0: same rule as quick now — a recovery that has been up
// +8% must not round-trip below breakeven UNLESS buyers are stepping back in
// (the shared reprieve). Ride shares this guard too (see judgeExit).
const DIP_BREAKEVEN_FLOOR_PCT = 0;
// EARLY CUT (quick style, scan mode): a trade that never worked shouldn't be
// allowed to bleed all the way to the stop (user's ANSEM case: peaked
// +1.4%, drifted to −10 with no floor). If a position is at least 20 minutes
// old, NEVER rose above +2%, and is now down 4%+, the thesis is dead — cut it
// at roughly half the stop-loss damage. One reprieve: if buyers are visibly
// stepping in right now (real 5m sample, buys leading, green 5m), give it a
// chance — but that needs POSITIVE evidence; missing data doesn't stay the cut
// (the cut is triggered by a real sell quote, not by missing data).
const EARLY_CUT_MIN_AGE_MS = 30 * 60_000;
const EARLY_CUT_PEAK_PCT = 2;
const EARLY_CUT_LOSS_PCT = -8;
// FAST-FAIL −3% tier REMOVED (July 2026, user: "cutting the loss at −3 doesn't
// make sense"). A fresh buy now gets room to develop before it ever goes green
// — it is no longer cut at −3% in the first 5 minutes. The real loss limit is
// still the −4.5% hard stop, and the 20-minute slow-bleed tier above still
// cleans up a genuinely dead trade (never rose +2%, down 4%+ after 20 min).
// LOSS-BRAKE COOL-OFF: after lossStopCount straight losses the bot blocks new
// buys for this long instead of stopping the run (repeatable forever).
const LOSS_COOLDOWN_MS = 30 * 60_000;
// CRASH CUT (quick style, scan mode): the stop-loss is a line, but a crash is
// a slope — user's AVAJAK filled at −26% and ALONSEM at −13.9% against a −10%
// stop because the token was falling faster than the ~20s check cadence. If
// the position is already down 5%+ AND the live tape shows ACTIVE dumping
// (5m candle down 4%+ or sellers outnumbering buyers 1.5:1 on a real sample),
// don't wait for the stop line — by the time the quote crosses it, the fill is
// far worse. Positive evidence only: missing stats never trigger this (the
// plain stop-loss still catches the true crossing).
const CRASH_CUT_LOSS_PCT = -8;
const CRASH_CUT_CHG_M5 = -4;
// FLASH-WICK STOP REPRIEVE (quick scan, July 2026 — user's CASHCAT case: "it
// dropped in 1 second and rose again higher, how did we get cut?"). A thin
// token can print one deep sell — the live quote stabs past the −4.5% stop —
// and recover within the same ~20s check window. When the instantaneous quote
// is below the stop BUT the 5m tape is still healthy (not in freefall, buyers
// still matching sellers, pool not drained), the stop waits ONE more check to
// confirm instead of dumping at the bottom of the wick. If it's a real
// breakdown the tape isn't healthy → it sells now, and the crash cut below is
// left fully armed (the reprieve falls THROUGH, it never returns "hold"). Only
// the tight scalp stop gets this (climbers already have room; conservative
// mode wants its fast bank). Positive evidence only: missing tape = no
// reprieve = normal stop. Bounds extra downside to ~one check.
const FLASH_WICK_DEFER_MS = 90_000;
const FLASH_WICK_MIN_M5 = -3;
const FLASH_WICK_MIN_TXNS = 5;
const FLASH_WICK_MIN_LIQ_FRAC = 0.7;
// QUICK-SCAN STOP CAP: hard ceiling on the per-trade loss for quick scan
// bots, regardless of the stored stopLossPct knob (older bots were created
// with 10). Wins in this style bank at +3–5%; the max loss must be the same
// order of magnitude or the math can't work. Tightened 8 → 4.5 (user's ask,
// July 2026: "when a token is in the accumulation zone about to pop it barely
// dips — if it drops 4%+ that's a bad sign, cut at ~4.5 rather than wreck at
// 8"). At a ~50% win rate, +3.5 avg win vs −4.5 max loss keeps expectancy
// workable while capping the damage of a downtrend entry. The −3 fast-fail
// and −4 early-cut tiers (with buyer-reprieve) still catch losers earlier;
// this is the firm no-reprieve line. Same silent-cap pattern as the
// quick-style 12/8 trail caps.
const QUICK_SCAN_MAX_STOP_PCT = 4.5;
// HEALTHY-CLIMBER CUSHION (quick scan, user's ask July 2026: "give the ones
// that are clearly stair-stepping up more room — the tight stop kept shaking
// me out of climbers right before they doubled", e.g. BatCat). When the tape
// PROVES the longer trend is still up (6h AND 24h green) and buyers haven't
// fled (no hourly or 5m sell avalanche), a healthy pullback gets a −12% stop
// instead of the −4.5% scalp stop. Positive evidence required every check:
// null/stale data = normal tight stop, never wider (the runner-exception rule).
const HEALTHY_CLIMB_STOP_PCT = 12;
// FRESH-CLIMBER MIDDLE STOP (quick scan, July 2026 — the Loom case). A token
// whose HOUR is up with buyers leading a real hour sample, but whose 6h/24h
// haven't caught up yet, is a stair-stepper the −4.5% scalp stop keeps shaking
// out right before the next step. It gets a MIDDLE −8% stop — enough room to
// survive a normal pullback, but NOT the full −12% of a proven climber (stops
// already gap toward −8% on thin tokens, so a wider line just books a bigger
// loss on the ones that don't recover). It also still faces the crash cut, so a
// real avalanche cuts it fast rather than riding to −8%.
const FRESH_CLIMB_STOP_PCT = 8;
// Minimum HOUR trade count for the fresh-climber tape to count — a real sample,
// not two prints. Below this the token stays on the normal tight −4.5% stop.
const FRESH_CLIMB_MIN_TXNS = 20;

// AUTOMATIC LOSS POLICY (Smart mix): a scanner buy was made for a reason, so a
// plain red quote is not itself a sell signal. Healthy/unknown pullbacks can
// stay open until the bot expires, bounded by a catastrophic −20% ceiling.
// Positive proof that the thesis failed (liquidity damage, severe volume death,
// or coordinated dumping) arms the earlier −8% override.
const AUTOMATIC_BREAKDOWN_EXIT_PCT = 8;
const AUTOMATIC_EMERGENCY_STOP_PCT = 20;

interface AutomaticLossPolicyInput {
  entryLiquidityUsd: number;
  entryVolumeH1Usd: number;
  peakPct: number;
  stats: {
    liquidityUsd: number;
    liquidityKnown: boolean;
    volH1Usd: number;
    volH1Known: boolean;
    chgM5: number;
    chgM5Known: boolean;
    buysM5: number;
    sellsM5: number;
    buysH1: number;
    sellsH1: number;
  } | null;
  chartHealthy: boolean;
  chartAccumulation: boolean;
  provenClimb: boolean;
  freshClimb: boolean;
  dollarOutflowConfirmed: boolean;
}

export function automaticLossPolicy(input: AutomaticLossPolicyInput): {
  stopPct: number;
  confirmedBreakdown: boolean;
  accumulating: boolean;
  activeVolatility: boolean;
} {
  const st = input.stats;
  if (!st) {
    return {
      stopPct: AUTOMATIC_EMERGENCY_STOP_PCT,
      confirmedBreakdown: false,
      accumulating: false,
      activeVolatility: false,
    };
  }

  const m5Trades = st.buysM5 + st.sellsM5;
  const h1Trades = st.buysH1 + st.sellsH1;
  const realM5 = m5Trades >= 8;
  const realH1 = h1Trades >= 30;
  const liquidityHolding =
    !st.liquidityKnown ||
    input.entryLiquidityUsd <= 0 ||
    st.liquidityUsd >= input.entryLiquidityUsd * 0.7;
  const oneWaySellWave =
    realM5 && st.chgM5Known && st.chgM5 <= -5 && st.sellsM5 >= st.buysM5 * 2;
  const hourSellersControl = realH1 && st.sellsH1 > st.buysH1 * 1.3;
  const volumeCollapsed =
    st.volH1Known &&
    input.entryVolumeH1Usd > 0 &&
    st.volH1Usd < input.entryVolumeH1Usd * 0.25 &&
    st.volH1Usd < Math.max(5_000, st.liquidityUsd * 0.1);
  const confirmedBreakdown =
    (st.liquidityKnown && !liquidityHolding) ||
    (oneWaySellWave && (hourSellersControl || input.dollarOutflowConfirmed)) ||
    volumeCollapsed;

  const volumeAlive =
    st.volH1Known &&
    st.volH1Usd >= Math.max(2_000, input.entryVolumeH1Usd * 0.25);
  const buyersAbsorbing =
    realM5 &&
    st.chgM5Known &&
    st.chgM5 >= -5 &&
    st.buysM5 >= st.sellsM5 * 0.75;
  const accumulating =
    input.chartAccumulation &&
    liquidityHolding &&
    !confirmedBreakdown &&
    volumeAlive;
  const activeVolatility =
    liquidityHolding &&
    !confirmedBreakdown &&
    realH1 &&
    buyersAbsorbing &&
    st.volH1Known &&
    st.liquidityUsd > 0 &&
    st.volH1Usd >= Math.max(5_000, st.liquidityUsd * 0.35);

  const stopPct = confirmedBreakdown
    ? AUTOMATIC_BREAKDOWN_EXIT_PCT
    : AUTOMATIC_EMERGENCY_STOP_PCT;

  return { stopPct, confirmedBreakdown, accumulating, activeVolatility };
}
// Lowered breakeven-reprieve arm for a proven/fresh climber (was a flat +5%):
// a small stair-stepper that peaked only ~+2% and is still buyer-led shouldn't
// be banked red on a normal pullback. Non-climbers keep the +5% arm.
const HOLD_CLIMB_MIN_ARM_PCT = 2;
// RUNNER EXCEPTION (quick scan): a token that is clearly still running — real
// 5m sample, buyers leading, green candle — gets to breathe through a normal
// 12–15% pullback instead of being trailed out (user missed a second +100%
// leg because a healthy breather hit the tight trail). Requires POSITIVE tape
// evidence every check: missing/stale data = normal tight trail, never wider.
// Hard limits regardless of tape: giveback ≥ 15% off the peak always sells,
// and the breakeven guard below still refuses to let a winner become a loser.
// The flip side of the deal: the moment the 5m tape turns clearly sell-heavy
// while in profit, sell IMMEDIATELY — no waiting for any % floor (user: "when
// there's a shift indicating a reverse, sell regardless").
const RUNNER_MIN_PEAK_PCT = 15;
const RUNNER_MAX_GIVEBACK_PCT = 15;
const REVERSAL_MIN_PROFIT_PCT = 5;
// STACKING DISCIPLINE (scan bots with DCA stacking on): adding a tranche to a
// token we already hold must be EARNED, not automatic. Before this rule the
// scanner didn't exclude held mints at all with stacking on — the same token
// could win a free slot 30 seconds after the first buy (user's ANSEM double
// buy), which is doubling risk on an unproven position, not DCA. Now a held
// mint is only eligible for another tranche when (1) the last buy of that
// mint is ≥ 30 minutes old AND (2) the combined open tranches are up ≥ +5% —
// "add to proven winners only." On top of that, held mints carry a scoring
// discount so a fresh token wins the slot unless the held one is clearly
// stronger (user's VINE ask: "why didn't it first scan for other tokens?").
const STACK_MIN_SPACING_MS = 30 * 60_000;
const STACK_MIN_PROFIT_PCT = 5;
const STACK_SCORE_DISCOUNT = 0.8;
// Buy-back comeback preference (July 2026, user's CASH AT ask): a recently-sold
// token on the watch list that is now showing a fresh comeback (buyers back on
// the 5m) gets a modest scoring edge so the bot re-buys the runner it knows
// over a random fresh name. Bounded so it can't override the rug/chart gates.
const REBUY_COMEBACK_BONUS = 4;
// RUNNER ROTATION (opt-in, multi-position scan bots). When fully deployed, sell
// the weakest position that is currently in PROFIT to fund a clearly-stronger
// new mover. Guardrails so it can't churn the book on fees:
//   • Only rotate OUT of a position up at least this much (locks a real gain
//     after fees — NEVER sells a loser to chase).
const ROTATE_MIN_PROFIT_PCT = 3;
//   • The new mover must beat the weakest held name by BOTH a ratio and an
//     absolute margin on the same momentum score — a marginal edge never fires.
const ROTATE_SCORE_RATIO = 1.6;
const ROTATE_SCORE_MIN_MARGIN = 12;
//   • At most one rotation per strategy per this window (in-memory; resets on
//     restart, which only ever makes it MORE conservative).
const ROTATE_COOLDOWN_MS = 30 * 60_000;
const rotationLastAt = new Map<string, number>();
function quoteImpactPct(q: unknown): number {
  const value = parseFloat(String((q as any)?.priceImpactPct ?? "0"));
  return Number.isFinite(value) ? value : 0;
}
async function checkSellable(
  mint: string,
  tokensOutRaw: bigint,
  tokenDecimals: number,
  solInLamports: bigint,
  slippageBps: number,
  publicKey: string,
  pool: PumpApiPoolSafety | null,
): Promise<{ ok: boolean; why: string; hasRoute: boolean }> {
  // hasRoute distinguishes the TWO failure shapes a caller must treat
  // differently: a token with NO sell route (back=0 / quote failed) is a true
  // trap — guaranteed loss, never overridable. A token that HAS a route but a
  // low round-trip is sellable; you'd just eat slippage/tax at this size — a
  // knowable risk a manual "Proceed anyway" is allowed to accept.
  try {
    // Preserve the original multi-protocol route check when PumpAPI has not
    // observed this mint recently. PumpAPI metadata is useful evidence, but it
    // must not make every Raydium/Meteora/Pump.fun candidate disappear.
    if (!pool) {
      const quote = await getSwapQuote(mint, SOL_MINT, tokensOutRaw.toString(), slippageBps);
      const back = BigInt(quote.outAmount ?? "0");
      if (back <= 0n) return { ok: false, why: "sell route quoted 0 SOL back", hasRoute: false };
      const ratio = Number(back) / Number(solInLamports);
      if (ratio < HONEYPOT_MIN_ROUNDTRIP) {
        return { ok: false, why: `selling right back would only return ${(ratio * 100).toFixed(0)}% — looks like a heavy sell tax or trap`, hasRoute: true };
      }
      return { ok: true, why: `sell-back check passed (${(ratio * 100).toFixed(0)}% round-trip)`, hasRoute: true };
    }
    // An independent sell simulation against a wallet without the newly bought
    // tokens is not evidence of sellability. Actions executes both legs in one
    // simulated transaction; `100%` is only permitted after proving zero
    // existing target balance so it cannot sell unrelated user holdings.
    const owner = new PublicKey(publicKey);
    const existing = await readMintSnapshotStrict(owner, mint);
    if (existing.amountRaw !== 0n) {
      return { ok: false, why: "atomic sell-back requires a quote wallet with zero existing target-token balance", hasRoute: false };
    }
    const preSol = BigInt(await withDeadline(conn.getBalance(owner, "confirmed"), 15_000, "getBalance"));
    const b64 = await getPumpApiRoundTripTransaction({
      publicKey, mint, poolId: pool.poolId, quoteMint: pool.quoteMint,
      amountRaw: solInLamports, tokenDecimals, slippage: Math.max(0.5, Math.min(10, slippageBps / 100)),
    });
    const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
    const simulation = await withDeadline(conn.simulateTransaction(tx, {
      commitment: "confirmed", sigVerify: false,
      accounts: { encoding: "base64", addresses: [publicKey] },
    }), 30_000, "simulateTransaction");
    if (simulation.value.err || !simulation.value.accounts?.[0]) {
      throw new Error(`atomic PumpApi Actions simulation failed${simulation.value.err ? `: ${JSON.stringify(simulation.value.err)}` : ""}`);
    }
    const postSol = BigInt(simulation.value.accounts[0].lamports);
    // This delta includes both provider fees, network fee, rent creation and
    // its refund. A non-positive result is an unexecutable round trip.
    const netDelta = postSol - preSol;
    const back = solInLamports + netDelta;
    if (back <= 0n) return { ok: false, why: "sell route quoted 0 SOL back", hasRoute: false };
    const ratio = Number(back) / Number(solInLamports);
    if (ratio < HONEYPOT_MIN_ROUNDTRIP) {
      return { ok: false, why: `selling right back would only return ${(ratio * 100).toFixed(0)}% — looks like a heavy sell tax or trap`, hasRoute: true };
    }
    return { ok: true, why: `sell-back check passed (${(ratio * 100).toFixed(0)}% round-trip)`, hasRoute: true };
  } catch (e: any) {
    return { ok: false, why: `no sell route found (${String(e?.message ?? e).slice(0, 80)})`, hasRoute: false };
  }
}

// ─── Liquidity-lock / authority gate (user's "should we even buy if the
// liquidity isn't locked?" ask, after the GRVT rug) ─────────────────────────
// Before ANY buy, ask RugCheck (free public API) about the token's structural
// rug enablers. We block ONLY on danger-level findings of the three classic
// rug mechanisms:
//   • LP largely unlocked  → the dev can pull the pool (exactly how GRVT died:
//     RugCheck showed "Large Amount of LP Unlocked: 100%" at danger level)
//   • freeze authority live → the dev can freeze your tokens (can't ever sell)
//   • mint authority live   → the dev can print more supply into your position
// Calibrated against live candidates: healthy pump.fun graduates do NOT carry
// these flags, so this doesn't starve the bot. Fail-soft: RugCheck down or
// slow = UNKNOWN = allow (the honeypot sell-back check and the post-entry rug
// guard remain) — an external scoring API being offline must never halt the
// bot. Point-in-time like the honeypot guard.
const RUGCHECK_TTL_MS = 10 * 60_000;
// Unknown (API down/slow) is cached only briefly — a transient RugCheck
// outage must not blind the gate for 10 minutes (architect-caught).
const RUGCHECK_UNKNOWN_TTL_MS = 45_000;
const rugcheckCache = new Map<string, { at: number; verdict: { ok: boolean; why: string } | null }>();
const RUG_ENABLER_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /lp unlocked/i, label: "liquidity is NOT locked" },
  { re: /freeze authority/i, label: "dev can freeze your tokens" },
  { re: /mint authority/i, label: "dev can mint unlimited new supply" },
];
async function checkTokenSafety(mint: string): Promise<{ ok: boolean; why: string } | null> {
  const hit = rugcheckCache.get(mint);
  if (hit && Date.now() - hit.at < (hit.verdict == null ? RUGCHECK_UNKNOWN_TTL_MS : RUGCHECK_TTL_MS)) {
    return hit.verdict;
  }
  let verdict: { ok: boolean; why: string } | null = null;
  try {
    const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const data: any = await res.json();
      const risks: any[] = Array.isArray(data?.risks) ? data.risks : [];
      const hits: string[] = [];
      for (const r of risks) {
        if (String(r?.level).toLowerCase() !== "danger") continue;
        const name = String(r?.name ?? "");
        const match = RUG_ENABLER_PATTERNS.find((p) => p.re.test(name));
        if (match) hits.push(`${match.label}${r?.value ? ` (${r.value})` : ""}`);
      }
      verdict = hits.length > 0
        ? { ok: false, why: hits.join("; ") }
        : { ok: true, why: "no LP-lock or authority red flags" };
    }
  } catch {
    // unknown — fail-soft
  }
  rugcheckCache.set(mint, { at: Date.now(), verdict });
  if (rugcheckCache.size > 500) {
    const cutoff = Date.now() - RUGCHECK_TTL_MS;
    rugcheckCache.forEach((v, k) => { if (v.at < cutoff) rugcheckCache.delete(k); });
  }
  // Transfer-tax gate (user's ask: "5% in + 5% out means we're down 10 before
  // it moves"). On Solana a token tax is a Token-2022 transfer-fee written
  // into the mint itself — readable directly on-chain, no third party.
  // Classic SPL tokens (all pump.fun launches) cannot carry one. Cap: 3% per
  // side (MAX_TRANSFER_TAX_BPS); wins bank at +3–5%, so anything above that
  // eats the whole edge on the round trip. A tax verdict only ADDS a block —
  // it never upgrades an unknown rugcheck to "ok". Fail-soft on RPC errors
  // (the honeypot sell-back check still catches heavy sell taxes downstream).
  // (Not written into rugcheckCache — tax has its own cache; mixing the two
  // signals under one key would couple their freshness, architect-caught.)
  const tax = await checkTransferTax(mint);
  if (tax != null && tax.bps > MAX_TRANSFER_TAX_BPS) {
    return {
      ok: false,
      why: `token charges a ${(tax.bps / 100).toFixed(1)}% transfer tax each way (limit ${(MAX_TRANSFER_TAX_BPS / 100).toFixed(0)}%) — a round trip loses ${(tax.bps / 50).toFixed(1)}% before the price even moves`,
    };
  }
  return verdict;
}

// Reads the Token-2022 transfer-fee config straight from the mint account.
// Returns { bps } (0 for classic SPL / no fee extension) or null when the RPC
// read failed (unknown — caller fails soft). Uses the HIGHER of the current
// and pending fee so a scheduled fee hike can't sneak a token past the gate.
const MAX_TRANSFER_TAX_BPS = 300; // 3% per side
const transferTaxCache = new Map<string, { at: number; bps: number | null }>();
const TRANSFER_TAX_TTL_MS = 30 * 60_000; // fee config changes are rare
async function checkTransferTax(mint: string): Promise<{ bps: number } | null> {
  const hit = transferTaxCache.get(mint);
  if (hit && Date.now() - hit.at < (hit.bps == null ? RUGCHECK_UNKNOWN_TTL_MS : TRANSFER_TAX_TTL_MS)) {
    return hit.bps == null ? null : { bps: hit.bps };
  }
  let bps: number | null = null;
  try {
    const info = await withDeadline(
      conn.getParsedAccountInfo(new PublicKey(mint), "confirmed"),
      10_000, "transfer-tax mint read",
    );
    const val: any = info?.value;
    if (val) {
      if (!val.owner?.equals?.(TOKEN_2022_PROGRAM_ID)) {
        bps = 0; // classic SPL mint — cannot carry a transfer fee
      } else {
        const parsed = (val.data as any)?.parsed;
        const extensions: any[] = parsed?.info?.extensions ?? [];
        if (!Array.isArray(parsed?.info?.extensions)) {
          console.warn(`[swing] transfer-tax read: unexpected parsed shape for token-2022 mint ${mint.slice(0, 8)}… — treating fee as 0`);
        }
        const feeExt = extensions.find((e: any) => e?.extension === "transferFeeConfig");
        if (!feeExt) {
          bps = 0;
        } else {
          const st = feeExt.state ?? {};
          const older = Number(st?.olderTransferFee?.transferFeeBasisPoints ?? 0) || 0;
          const newer = Number(st?.newerTransferFee?.transferFeeBasisPoints ?? 0) || 0;
          bps = Math.max(older, newer);
        }
      }
    }
  } catch {
    // unknown — fail-soft
  }
  transferTaxCache.set(mint, { at: Date.now(), bps });
  if (transferTaxCache.size > 500) {
    const cutoff = Date.now() - TRANSFER_TAX_TTL_MS;
    transferTaxCache.forEach((v, k) => { if (v.at < cutoff) transferTaxCache.delete(k); });
  }
  return bps == null ? null : { bps };
}

async function reconcilePendingBuys(s: SwingStrategy): Promise<void> {
  const pending = (await storage.listSwingPositions(s.id)).filter((p) => p.status === "pending_buy");
  for (const p of pending) {
    if (!p.entrySig) {
      if (Date.now() - new Date(p.openedAt).getTime() > 10 * 60_000) {
        const balance = await readMintBalance(new PublicKey(walletPubkeyAt(s, p.walletIndex)), p.mint).catch(() => null);
        await addSkipEventDeduped(s.id, p.mint, p.symbol, "pending_buy_operator_review",
          balance && balance.amountRaw > 0n
            ? "Legacy pending buy has no durable signature and the wallet holds this token. It remains locked for operator reconciliation; no duplicate buy will be sent."
            : "Legacy pending buy has no durable signature. It remains conservatively locked because pre-fix send outcome cannot be proven; operator reconciliation is required.");
      }
      continue;
    }
    const outcome = await recoverBuyFill(p.entrySig, walletPubkeyAt(s, p.walletIndex), p.mint);
    if (outcome.state === "unavailable") {
      if (!p.entryPumpBlockhash) continue;
      // Parsed transaction indexing can lag signature status. Success always
      // stays pending for metadata retry; only status=null plus a proven-expired
      // blockhash proves this signed transaction can no longer land.
      try {
        const statuses = await withDeadline(
          conn.getSignatureStatuses([p.entrySig], { searchTransactionHistory: true }),
          15_000, "getSignatureStatuses",
        );
        const status = statuses.value[0];
        if (status?.err) {
          await storage.closeSwingPositionIfOpen(p.id, {
            status: "closed", solOutLamports: "0", exitReason: "buy_failed", closedAt: new Date(),
          });
          continue;
        }
        if (status) continue;
        const validity = await withDeadline(
          conn.isBlockhashValid(p.entryPumpBlockhash, { commitment: "confirmed" }),
          15_000, "isBlockhashValid",
        );
        if (!validity.value) {
          await storage.closeSwingPositionIfOpen(p.id, {
            status: "closed", solOutLamports: "0", exitReason: "buy_expired", closedAt: new Date(),
          });
        }
      } catch {
        // Any RPC error/unknown retains the duplicate guard.
      }
      continue;
    }
    if (outcome.state === "failed") {
      await storage.closeSwingPositionIfOpen(p.id, {
        status: "closed", solOutLamports: "0", exitReason: "buy_failed", closedAt: new Date(),
      });
      continue;
    }
    const fill = outcome.fill;
    await storage.updateSwingPosition(p.id, {
      status: "open", tokenAmountRaw: fill.tokensRaw.toString(),
      solInLamports: fill.solSpentLamports.toString(), decimals: fill.decimals,
      highWaterLamports: fill.solSpentLamports.toString(), lastValueLamports: fill.solSpentLamports.toString(),
    } as any);
  }
}

// Returns true only when a position was actually opened — callers (watch mode
// heartbeat note) must not claim "Bought" on a skipped/failed buy.
async function openPosition(s: SwingStrategy, pick: ScoredCandidate, sizeLamports: bigint, entryMode: "auto" | "manual" = "auto", opts: { topUp?: boolean; slippageRetry?: boolean } = {}): Promise<boolean> {
  // topUp: a deliberate same-token second tranche (reduced-entry top-up or DCA
  // stacking) — the "already holding" duplicate guard is skipped ON PURPOSE.
  // The scheduler only sets it after the proven-winner rules passed (30 min
  // spacing + combined up ≥ +5%).
  const topUp = opts.topUp === true;
  await reconcilePendingBuys(s);
  if (!(await stillActive(s.id))) return false;
  if (!topUp && (await alreadyHoldsMint(s, pick.mint))) return false;
  // "Never buy again" backstop — the single choke point EVERY buy path funnels
  // through (auto scan, manual "Buy now", buy-more, swap, watch/comeback). The
  // owner banned this mint, so nothing may buy it, no matter how it got here.
  // Fresh DB read (not the caller snapshot) so a block toggled mid-tick sticks.
  if (await isMintBlocked(s.id, pick.mint)) {
    await addSkipEventDeduped(s.id, pick.mint, pick.symbol, "blocked",
      `Skipped ${pick.symbol} — you told the bot to never buy this token again. Tap "Allow again" on it to lift the block.`);
    return false;
  }
  // PumpAPI is a fast, valuable evidence source, but not the only protocol or
  // route the Swing Bot understands. When this short-lived metadata is absent,
  // preserve the original Jupiter-backed multi-protocol path instead of
  // silently eliminating an otherwise valid entry.
  const pinnedPool = getFreshPumpApiPoolSafety(pick.mint);
  // Liquidity-lock / authority gate — covers paper, live AND watch mode. Live
  // money requires a POSITIVE pass (unknown = block); paper stays fail-soft so
  // the scanner still surfaces the full opportunity set to study.
  // Issuer-backed xStocks intentionally retain mint/freeze controls, so the
  // meme-token "developer can mint/freeze" heuristic would reject every real
  // catalog asset. Stock bots are paper-only and their trust boundary is the
  // verified issuer catalog used by findStockEntryCandidate / create validation.
  // Crypto and all live-money paths keep the original safety check unchanged.
  const verifiedStockPaper = s.universe === "stocks" && s.mode === "paper";
  const safety = verifiedStockPaper ? null : await checkTokenSafety(pick.mint);
  // A manual "Buy now / Proceed anyway" is a deliberate owner override: the FOMO
  // panel already spelled out the risks and the owner chose to buy anyway. So
  // the recent MAX-SAFETY entry gates (rug-flag strictness, the live liquidity
  // floor, the min pool age, and the price-impact size guard) do NOT apply to a
  // manual buy. The honeypot sell-back WALL below is the ONLY remaining stop, and
  // it now blocks a manual buy ONLY when the token has NO sell route at all (a
  // guaranteed trap). A poor round-trip (sellable, just slippage/tax at this
  // size) IS overridable — a knowable risk the owner can accept. Auto-scanner
  // buys keep every gate.
  const manualOverride = entryMode === "manual";
  const safetyBlocked = verifiedStockPaper
    ? false
    : manualOverride ? false : (s.mode === "live" ? !(safety?.ok) : (safety != null && !safety.ok));
  if (safetyBlocked) {
    const why = safety?.why ?? "couldn't verify the liquidity is locked and mint/freeze are revoked right now";
    await addSkipEventDeduped(s.id, pick.mint, pick.symbol, "rug_enabler",
      `Rug-risk guard: skipped ${pick.symbol} — ${why}${s.mode === "live" ? " (live mode only buys verified-safe tokens)" : ""}. Not buying tokens the dev can still rug.`);
    return false;
  }
  // Max-safety LIVE entry gates at the single buy choke point — so manual "Buy
  // now", watch/targetMint mode, DCA stacking and the swap route ALL inherit the
  // same deep-pool + established-age standard the auto-scanner uses. Safety-only
  // (pool depth + age), NOT momentum/timing: a manual buy still skips entry
  // TIMING on purpose, but real money never enters a shallow or brand-new pool a
  // rug can drain (the MOGTROLL case). Paper is untouched.
  if (s.mode === "live" && !manualOverride) {
    const effMinLiq = Math.max(s.minLiquidityUsd, liveLiqFloorUsd(pick, s.style));
    // Fail CLOSED on a malformed candidate: a non-finite liquidity number must
    // never slip past a `< floor` comparison (NaN < x is false). Current callers
    // all build pick from real getTokenStats, but real money never rides on that.
    if (!Number.isFinite(pick.liquidityUsd) || pick.liquidityUsd < effMinLiq) {
      const liqLabel = Number.isFinite(pick.liquidityUsd) ? `$${Math.round(pick.liquidityUsd).toLocaleString()}` : "unknown";
      await addSkipEventDeduped(s.id, pick.mint, pick.symbol, "rug_enabler",
        `Live-safety guard: skipped ${pick.symbol} — pool liquidity ${liqLabel} is below the $${Math.round(effMinLiq).toLocaleString()} live floor (too easy to drain).`);
      return false;
    }
    const minAgeHlive = effMinPoolAgeH(s);
    const ageHlive = pick.pairCreatedAt ? (Date.now() - pick.pairCreatedAt) / 3600_000 : null;
    if (ageHlive == null || ageHlive < minAgeHlive) {
      await addSkipEventDeduped(s.id, pick.mint, pick.symbol, "rug_enabler",
        `Live-safety guard: skipped ${pick.symbol} — ${ageHlive == null ? "pool age can't be verified" : `pool is only ${ageHlive.toFixed(1)}h old`}; your minimum-age dial requires at least ${fmtAgeH(minAgeHlive)} of history — this lowers rug risk, but no setting removes it.`);
      return false;
    }
  }
  // Dollar-flow entry gate (auto entries only, paper + live so paper stays an
  // honest preview): buy/sell COUNTS can look buyer-led while the real DOLLARS
  // drain out (many small buys vs fewer big sells — the RAKO case). When the
  // chain's dollar-weighted flow is known and clearly sell-dominant, don't
  // enter. Fail-soft: unknown flow (null) never blocks — the count-based
  // pressure gates in judgeEntry already ran.
  if (!verifiedStockPaper && !manualOverride && !topUp && pick.pairAddress) {
    const entryFlow = await getDollarFlow(pick.pairAddress, pick.mint);
    if (dollarsLeaving(entryFlow)) {
      await addSkipEventDeduped(s.id, pick.mint, pick.symbol, "dollar_outflow",
        `Passed on ${pick.symbol} — the buyer COUNT looks healthy, but the real dollars are leaving: ${flowLabel(entryFlow!)}. Small buys masking bigger sells is a distribution pattern, not a rally.`);
      return false;
    }
  }
  // Hot-run 25% sizing guard (auto scan entries only — a manual "Buy now" is a
  // deliberate owner override, watch mode has its own single-token contract,
  // and a top-up already passed the proven-winner rules on an open position).
  // When the pick shows the extended-hot-run staircase shape, invest only a
  // quarter of the intended slice unless the owner flipped the full-size
  // switch. If a quarter would fall below the tradable minimum, buy the
  // minimum instead (never MORE than the intended size).
  if (!s.targetMint && !manualOverride && !topUp && !s.hotStreakFullSize && isExtendedHotRun(pick)) {
    let capped = sizeLamports / HOT_RUN_SIZE_DIVISOR;
    if (capped < MIN_TRADE_LAMPORTS) capped = MIN_TRADE_LAMPORTS > sizeLamports ? sizeLamports : MIN_TRADE_LAMPORTS;
    if (capped < sizeLamports) {
      await storage.addSwingEvent({
        strategyId: s.id, positionId: null, kind: "info", mint: pick.mint, symbol: pick.symbol,
        detail: `Hot-run protection: ${pick.symbol} has already climbed +${pick.chgH6.toFixed(0)}% in 6h / +${pick.chgH24.toFixed(0)}% in 24h with buyers piling in — the long staircase shape that pays most entries but can rug in one candle. Buying a quarter slice (${(Number(capped) / LAMPORTS_PER_SOL).toFixed(4)} SOL instead of ${(Number(sizeLamports) / LAMPORTS_PER_SOL).toFixed(4)} SOL) to protect the other 75%. Flip "Full size on hot runs" in settings to override.`,
        solLamports: null,
      });
      sizeLamports = capped;
    }
  }
  if (s.mode === "paper") {
    // No per-buy fee — the platform fee is taken once from the deposit at
    // start. The full size swaps into tokens.
    let swapLamports = sizeLamports;
    // Real buy quote for the exact size — price impact included.
    let tokensOut = 0n;
    let paperOwner = "";
    if (pinnedPool) {
      try { paperOwner = paperQuoteWallet(); } catch {
        // The original Jupiter paper path does not need a funded quote fixture.
        // Fall through to it rather than freezing paper trading.
        paperOwner = "";
      }
    }
    let decimals = await readMintDecimals(pick.mint);
    let entryImpact = 0;
    let jupiterQuote: JupiterQuoteResponse | null = null;
    try {
      if (pinnedPool && paperOwner) {
        tokensOut = (await simulateExecutablePumpQuote("buy", paperOwner, pick.mint, swapLamports, decimals, s.slippageBps, pinnedPool)).outputRaw;
        if (!s.targetMint && !manualOverride && swapLamports >= MIN_TRADE_LAMPORTS * 2n) {
          const half = swapLamports / 2n;
          const halfOut = (await simulateExecutablePumpQuote("buy", paperOwner, pick.mint, half, decimals, s.slippageBps, pinnedPool)).outputRaw;
          entryImpact = executableImpactPct(tokensOut, swapLamports, halfOut, half);
        }
      } else {
        jupiterQuote = await getSwapQuote(
          SOL_MINT,
          pick.mint,
          swapLamports.toString(),
          s.slippageBps,
          undefined,
          manualOverride ? "interactive" : "background",
        );
        tokensOut = BigInt(jupiterQuote.outAmount ?? "0");
        entryImpact = quoteImpactPct(jupiterQuote);
      }
    } catch (e: any) {
      await storage.addSwingEvent({
        strategyId: s.id, positionId: null, kind: "skip", mint: pick.mint, symbol: pick.symbol,
        detail: `Wanted to buy ${pick.symbol} but couldn't get a route quote — skipped. ${String(e?.message ?? e).slice(0, 120)}`,
        solLamports: null,
      });
      return false;
    }
    if (tokensOut <= 0n) return false;

    // Shrink-to-fit: when the wanted slice would move the price past the
    // impact limit, don't walk away from a good pick — try half, then a
    // quarter. If a smaller slice fits (and is still a tradable size), buy
    // THAT and mark the position "reduced entry": it may earn ONE same-token
    // top-up later under the proven-winner rules (30 min + up ≥ +5%).
    let entryReduced = false;
    if (!s.targetMint && !manualOverride && entryImpact > MAX_ENTRY_IMPACT_PCT) {
      let fitted = false;
      for (const frac of [2n, 4n]) {
        const trySize = sizeLamports / frac;
        if (trySize < MIN_TRADE_LAMPORTS) break;
        try {
          const quote2 = pinnedPool && paperOwner
            ? null
            : await getSwapQuote(
              SOL_MINT,
              pick.mint,
              trySize.toString(),
              s.slippageBps,
              undefined,
              manualOverride ? "interactive" : "background",
            );
          const out2 = pinnedPool && paperOwner
            ? (await simulateExecutablePumpQuote("buy", paperOwner, pick.mint, trySize, decimals, s.slippageBps, pinnedPool)).outputRaw
            : BigInt(quote2?.outAmount ?? "0");
          const imp2 = quote2 ? quoteImpactPct(quote2) : 0;
          if (imp2 <= MAX_ENTRY_IMPACT_PCT && out2 > 0n) {
            swapLamports = trySize;
            tokensOut = out2;
            jupiterQuote = quote2;
            entryImpact = imp2;
            entryReduced = true;
            fitted = true;
            break;
          }
        } catch {
          break; // quote hiccup mid-shrink — fall through to the honest skip
        }
      }
      if (!fitted) {
        await addSkipEventDeduped(s.id, pick.mint, pick.symbol, "impact_guard",
          `Size guard: skipped ${pick.symbol} — buying ${(Number(sizeLamports) / LAMPORTS_PER_SOL).toFixed(3)} SOL of it would push its price up ${entryImpact.toFixed(1)}% (limit ${MAX_ENTRY_IMPACT_PCT}%), and even a quarter-size slice didn't fit this pool. Not starting a trade that far underwater.`);
        return false;
      }
    }
    // A top-up tranche NEVER carries the reduced marker itself — the one-time
    // top-up ticket must not renew (no endless ladder of "second helpings").
    if (topUp) entryReduced = false;

    const sellable = await checkSellable(pick.mint, tokensOut, decimals, swapLamports, s.slippageBps, paperOwner, pinnedPool);
    if (!sellable.ok) {
      // A manual "Buy now / Proceed anyway" MAY accept a poor round-trip (there
      // IS a sell route, you'd just lose slippage/tax at this size — a risk the
      // owner knowingly chose). It can NEVER override a token with no sell route
      // at all (hasRoute=false) — that's a guaranteed trap, not a knowable risk.
      if (manualOverride && sellable.hasRoute) {
        await storage.addSwingEvent({
          strategyId: s.id, positionId: null, kind: "info", mint: pick.mint, symbol: pick.symbol,
          detail: `Proceed anyway — you chose to buy ${pick.symbol} despite the sell-back check (${sellable.why}). Buying at your request; the stop-loss and exit rules still run.`,
          solLamports: null,
        });
      } else {
        await addSkipEventDeduped(s.id, pick.mint, pick.symbol, "honeypot_guard",
          `Honeypot guard: skipped ${pick.symbol} — ${sellable.why}. Never buying what we can't sell.`);
        return false;
      }
    }

    const bankroll = BigInt(s.paperBankrollLamports);
    if (bankroll < swapLamports) return false;
    if (!(await stillActive(s.id))) return false; // no post-stop buys, even simulated
    const paperPos = {
      strategyId: s.id, mint: pick.mint, symbol: pick.symbol, tokenName: pick.name,
      mode: "paper",
      solInLamports: swapLamports.toString(),
      tokenAmountRaw: tokensOut.toString(),
      decimals,
      highWaterLamports: swapLamports.toString(),
      lastValueLamports: swapLamports.toString(),
      entryVolumeH1Usd: pick.volH1Usd,
      entryLiquidityUsd: pick.liquidityUsd,
      entryPriceUsd: pick.priceUsd > 0 ? pick.priceUsd : null,
      // xStocks' deepest pair is commonly USDC-quoted, while
      // computeFillPriceUsd derives SOL/USD from a SOL-quoted pair. Preserve
      // the observed USD price rather than displaying a false 100x-low fill.
      entryFillPriceUsd: s.universe === "stocks"
        ? null
        : computeFillPriceUsd(pick, swapLamports, tokensOut, decimals),
      entryPairAddress: pick.pairAddress,
      entryPumpPoolId: pinnedPool?.poolId ?? null,
      entryPumpQuoteMint: pinnedPool?.quoteMint ?? null,
      entryPumpBlockhash: null,
      entryTrigger: entryMode,
      entryReduced,
      entrySig: null,
    };
    // Without stacking, the insert itself is the duplicate guard — atomic
    // across overlapping server processes (advisory-locked check-then-insert).
    // Watch DCA tranches NEED multiple open positions of the same mint, so
    // they use the plain insert (alreadyHoldsMint above caps tranche count;
    // worst case a process race adds one extra tranche from the same bankroll).
    // A reduced-entry top-up is the same shape: a deliberate second tranche.
    const dcaWatchBuy = s.targetMint === pick.mint && dcaTrancheCount(s) > 1;
    const pos = s.allowStacking || dcaWatchBuy || topUp
      ? await storage.createSwingPosition(paperPos)
      : await storage.createSwingPositionIfNoOpenMint(paperPos);
    if (!pos) return false; // another process just bought this mint — skip, no double buy
    // Spend the top-up ticket: once a second tranche books, no open tranche
    // of this mint keeps the reduced marker — one top-up per lineage, ever.
    if (topUp) await storage.clearSwingEntryReduced(s.id, pick.mint).catch(() => {});
    await storage.updateSwingStrategy(s.id, { paperBankrollLamports: (bankroll - swapLamports).toString() });
    const reducedNote = entryReduced
      ? ` The pool couldn't absorb the full ${(Number(sizeLamports) / LAMPORTS_PER_SOL).toFixed(3)} SOL without moving the price too much, so the bot bought a smaller ${(Number(swapLamports) / LAMPORTS_PER_SOL).toFixed(3)} SOL slice that fits. If this token proves itself (up 5%+ after 30+ minutes), the bot may add a second helping.`
      : "";
    await storage.addSwingEvent({
      strategyId: s.id, positionId: pos.id, kind: "buy", mint: pick.mint, symbol: pick.symbol,
      detail: `Bought ${pick.symbol} — ${s.universe === "stocks" ? stockEntryWhyText(pick) : s.targetMint ? "your chosen token; the bot now babysits the exit (stop-loss, profit lock, sell-off tells)" : entryMode === "manual" ? "you tapped Buy now, so the bot's entry timing was skipped on purpose — it now manages the exit (stop-loss, profit lock, sell-off tells)" : entryWhyText(pick, s, false)}. Liquidity $${Math.round(pick.liquidityUsd).toLocaleString()}, 1h vol $${Math.round(pick.volH1Usd).toLocaleString()}, 1h ${pick.chgH1 >= 0 ? "+" : ""}${pick.chgH1.toFixed(1)}% / 6h ${pick.chgH6 >= 0 ? "+" : ""}${pick.chgH6.toFixed(1)}% / 24h ${pick.chgH24 >= 0 ? "+" : ""}${pick.chgH24.toFixed(1)}%, ${pick.buysH1} buys / ${pick.sellsH1} sells (1h).${pick.chartNote ?? ""}${reducedNote}`,
      solLamports: swapLamports.toString(),
    });
    if (s.style === "quick" && !s.targetMint) markStrategyHot(s.id);
    return true;
  }

  // LIVE — buy from the sub-wallet with the most spendable SOL (wallet 0 is
  // the only wallet when subWalletCount is 1, so single-wallet bots behave
  // exactly as before). The buy is capped at THAT wallet's spendable.
  const buyWallet = await pickBuyWallet(s);
  const kp = buyWallet.kp;
  const owner = kp.publicKey;
  const spendable = buyWallet.spendable;
  const solIn = sizeLamports > spendable ? spendable : sizeLamports;
  if (solIn < MIN_TRADE_LAMPORTS) return false;

  // No per-buy fee — the platform fee was taken once from the deposit at
  // start. The full trade size swaps into tokens.
  let swapLamports = solIn;
  let entryReduced = false;

  try {
    const preTok = await readMintBalance(owner, pick.mint);
    const mintDecimals = preTok.decimals || await readMintDecimals(pick.mint);
    let buyQuote: JupiterQuoteResponse | null = null;
    let expectedTokens: bigint;
    if (pinnedPool) {
      expectedTokens = (await simulateExecutablePumpQuote("buy", owner.toBase58(), pick.mint, swapLamports, mintDecimals, s.slippageBps, pinnedPool)).outputRaw;
    } else {
      buyQuote = await getSwapQuote(SOL_MINT, pick.mint, swapLamports.toString(), s.slippageBps);
      expectedTokens = BigInt(buyQuote.outAmount ?? "0");
    }
    if (expectedTokens <= 0n) throw new Error("Buy quote returned 0 tokens.");
    let liveImpact = buyQuote ? quoteImpactPct(buyQuote) : 0;
    if (pinnedPool && !s.targetMint && !manualOverride && swapLamports >= MIN_TRADE_LAMPORTS * 2n) {
      const half = swapLamports / 2n;
      const halfOut = (await simulateExecutablePumpQuote("buy", owner.toBase58(), pick.mint, half, mintDecimals, s.slippageBps, pinnedPool)).outputRaw;
      liveImpact = executableImpactPct(expectedTokens, swapLamports, halfOut, half);
    }
    // Shrink-to-fit (live): when the wanted slice would move the price past
    // the impact limit, try half, then a quarter, before giving up. A smaller
    // slice that fits gets bought and marked "reduced entry" — it may earn ONE
    // same-token top-up later under the proven-winner rules (30 min + ≥ +5%).
    // (A top-up tranche never carries the marker itself — set false below.)
    if (!s.targetMint && !manualOverride && liveImpact > MAX_ENTRY_IMPACT_PCT) {
      let fitted = false;
      for (const frac of [2n, 4n]) {
        const trySize = solIn / frac;
        if (trySize < MIN_TRADE_LAMPORTS) break;
        try {
          const quote2 = pinnedPool
            ? null
            : await getSwapQuote(SOL_MINT, pick.mint, trySize.toString(), s.slippageBps);
          const out2 = pinnedPool
            ? (await simulateExecutablePumpQuote("buy", owner.toBase58(), pick.mint, trySize, mintDecimals, s.slippageBps, pinnedPool)).outputRaw
            : BigInt(quote2?.outAmount ?? "0");
          const imp2 = quote2 ? quoteImpactPct(quote2) : 0;
          if (imp2 <= MAX_ENTRY_IMPACT_PCT && out2 > 0n) {
            expectedTokens = out2;
            liveImpact = imp2;
            swapLamports = trySize;
            buyQuote = quote2;
            entryReduced = true;
            fitted = true;
            break;
          }
        } catch {
          break; // quote hiccup mid-shrink — fall through to the honest skip
        }
      }
      if (!fitted) {
        await addSkipEventDeduped(s.id, pick.mint, pick.symbol, "impact_guard",
          `Size guard: skipped ${pick.symbol} — buying ${(Number(solIn) / LAMPORTS_PER_SOL).toFixed(3)} SOL of it would push its price up ${liveImpact.toFixed(1)}% (limit ${MAX_ENTRY_IMPACT_PCT}%), and even a quarter-size slice didn't fit this pool. Not starting a trade that far underwater.`);
        return false;
      }
    }
    if (topUp) entryReduced = false;
    const sellable = await checkSellable(pick.mint, expectedTokens, mintDecimals, swapLamports, s.slippageBps, owner.toBase58(), pinnedPool);
    if (!sellable.ok) {
      // A manual "Buy now / Proceed anyway" MAY accept a poor round-trip (there
      // IS a sell route, you'd just lose slippage/tax at this size — a risk the
      // owner knowingly chose). It can NEVER override a token with no sell route
      // at all (hasRoute=false) — that's a guaranteed trap, not a knowable risk.
      if (manualOverride && sellable.hasRoute) {
        await storage.addSwingEvent({
          strategyId: s.id, positionId: null, kind: "info", mint: pick.mint, symbol: pick.symbol,
          detail: `Proceed anyway — you chose to buy ${pick.symbol} with real money despite the sell-back check (${sellable.why}). Buying at your request; the stop-loss and exit rules still run.`,
          solLamports: null,
        });
      } else {
        await addSkipEventDeduped(s.id, pick.mint, pick.symbol, "honeypot_guard",
          `Honeypot guard: skipped ${pick.symbol} — ${sellable.why}. Never buying what we can't sell.`);
        return false;
      }
    }
    // LAST LOOK — the scan decision can be a minute old and the checks above
    // add more seconds; a token can finish a short spike in that window. Re-read
    // FRESH stats now and refuse to pay a price that already ran past the setup.
    // Chosen-token watch bots and manual "Buy now" skip this on purpose (the
    // owner picked the timing); unknown fresh stats proceed (the scan already
    // gave positive evidence — a data hiccup must not starve every entry).
    if (!s.targetMint && !manualOverride) {
      const freshPairs = await fetchSolanaPairs(pick.mint, { forceFresh: true }).catch(() => null);
      const freshStats = freshPairs == null ? null : pairToStats(pick.mint, bestSolanaPair(freshPairs));
      if (freshStats && freshStats.priceUsd > 0 && pick.priceUsd > 0) {
        const runPct = (freshStats.priceUsd / pick.priceUsd - 1) * 100;
        if (runPct > LAST_LOOK_MAX_RUN_PCT) {
          await addSkipEventDeduped(s.id, pick.mint, pick.symbol, "last_look_spike",
            `Last-second check: skipped ${pick.symbol} — its price ran +${runPct.toFixed(1)}% between the scan and the buy (a short spike was in progress). Buying that pays the tip of the spike, not the setup. It stays in the running for a calmer entry.`);
          return false;
        }
        if (freshStats.chgM5 > LAST_LOOK_MAX_M5_PCT) {
          await addSkipEventDeduped(s.id, pick.mint, pick.symbol, "last_look_spike",
            `Last-second check: skipped ${pick.symbol} — its 5-minute candle went vertical (+${freshStats.chgM5.toFixed(1)}%) right before the buy. Not chasing a spike in progress.`);
          return false;
        }
      }
    }
    // Last check before real money moves — quote/tx building above takes long
    // enough that a Stop could have landed meanwhile, or a concurrent process
    // could have bought this same mint.
    if (!(await stillActive(s.id))) return false;
    if (!topUp && (await alreadyHoldsMint(s, pick.mint))) return false;
    // Re-check the "Never buy again" ban here too: quote/tx building above takes
    // seconds, so a block toggled meanwhile must still stop real money moving.
    if (await isMintBlocked(s.id, pick.mint)) {
      await addSkipEventDeduped(s.id, pick.mint, pick.symbol, "blocked",
        `Skipped ${pick.symbol} — you blocked this token just before the buy went through. Nothing was bought. Tap "Allow again" to lift the block.`);
      return false;
    }
    // PumpApi LOCAL mode receives only the public key and returns unsigned
    // bytes. Validate the exact trade by simulation before signing anything.
    // Capture the signature the moment the tx is SENT (mirrors the sell path)
    // — if confirmation times out, the buy may STILL have landed, and booking
    // "Buy failed" without checking the chain strands real tokens untracked.
    const pendingData = {
      strategyId: s.id, mint: pick.mint, symbol: pick.symbol, tokenName: pick.name, mode: "live",
      walletIndex: buyWallet.idx, status: "pending_buy", solInLamports: swapLamports.toString(),
      tokenAmountRaw: "0", decimals: mintDecimals, highWaterLamports: swapLamports.toString(),
      lastValueLamports: swapLamports.toString(), entryVolumeH1Usd: pick.volH1Usd,
      entryLiquidityUsd: pick.liquidityUsd, entryPriceUsd: pick.priceUsd > 0 ? pick.priceUsd : null,
      entryFillPriceUsd: null, entryPairAddress: pick.pairAddress,
      entryPumpPoolId: pinnedPool?.poolId ?? null, entryPumpQuoteMint: pinnedPool?.quoteMint ?? null,
      entryPumpBlockhash: null,
      entryTrigger: entryMode, entryReduced, entrySig: null,
    };
    const pendingPos = topUp || s.allowStacking
      ? await storage.createSwingPosition(pendingData)
      : await storage.createSwingPositionIfNoOpenMint(pendingData);
    if (!pendingPos) return false;
    let signedSig: string | null = null;
    let sentSig: string | null = null;
    let sig: string;
    let bought: bigint;
    let boughtDecimals: number;
    let costBasis: bigint;
    try {
      const persistSignedBuy = async (x: string, recentBlockhash: string) => {
        const updated = await storage.updateSwingPosition(pendingPos.id, {
          exitSig: null, entrySig: x, entryPumpBlockhash: recentBlockhash,
        } as any);
        if (!updated) throw new Error("Could not persist signed pending buy");
        signedSig = x;
      };
      if (pinnedPool) {
        sig = await executeValidatedPumpSwap(
          "buy",
          kp,
          pick.mint,
          swapLamports,
          mintDecimals,
          s.slippageBps,
          executableOutputFloor(expectedTokens, s.slippageBps),
          expectedTokens,
          pinnedPool,
          persistSignedBuy,
          async (x) => { sentSig = x; },
        );
      } else {
        const currentQuote = buyQuote ?? await getSwapQuote(SOL_MINT, pick.mint, swapLamports.toString(), s.slippageBps);
        const built = await getSwapTransaction(currentQuote as unknown as Record<string, unknown>, owner.toBase58());
        sig = await signSendConfirm(
          built.swapTransaction,
          kp,
          persistSignedBuy,
          async (x) => { sentSig = x; },
        );
      }
      const outcome = await recoverBuyFill(sig, owner.toBase58(), pick.mint);
      if (outcome.state !== "filled") throw new Error("Buy confirmed but exact on-chain fill metadata is not readable yet.");
      const fill = outcome.fill;
      bought = fill.tokensRaw;
      boughtDecimals = fill.decimals;
      costBasis = fill.solSpentLamports;
    } catch (e: any) {
      if (!signedSig) {
        await storage.closeSwingPositionIfOpen(pendingPos.id, {
          status: "closed", solOutLamports: "0", exitReason: "buy_not_submitted", closedAt: new Date(),
        });
        throw e;
      }
      // Sent but unconfirmed: ask the chain before declaring failure.
      const recoverySig = sentSig ?? signedSig;
      const outcome = await recoverBuyFill(recoverySig, owner.toBase58(), pick.mint);
      if (outcome.state !== "filled") {
        if (outcome.state === "failed") {
          await storage.closeSwingPositionIfOpen(pendingPos.id, {
            status: "closed", solOutLamports: "0", exitReason: "buy_failed", closedAt: new Date(),
          });
          throw new Error(`Buy ${recoverySig} failed on-chain; pending intent released.`);
        }
        await storage.addSwingEvent({
          strategyId: s.id, positionId: pendingPos.id, kind: "info", mint: pick.mint, symbol: pick.symbol,
          detail: `Signed buy ${recoverySig}${sentSig ? " was submitted" : " has an ambiguous RPC send outcome"}; exact chain metadata is not readable yet. It remains pending and blocks duplicate buys until reconciliation proves the result.`,
          solLamports: swapLamports.toString(),
        }).catch(() => {});
        return false;
      }
      const fill = outcome.fill;
      sig = recoverySig;
      bought = fill.tokensRaw;
      boughtDecimals = fill.decimals;
      costBasis = fill.solSpentLamports;
      await storage.addSwingEvent({
        strategyId: s.id, positionId: null, kind: "info", mint: pick.mint, symbol: pick.symbol,
        detail: `The network was slow to confirm the ${pick.symbol} buy, but the bot double-checked the chain and the buy DID land — recovered it with the exact on-chain amounts (${(Number(costBasis) / LAMPORTS_PER_SOL).toFixed(4)} SOL spent). The trade is tracked normally, stop-loss and all.`,
        solLamports: costBasis.toString(),
      }).catch(() => {});
    }
    // Atomic create (DB advisory lock + open-mint re-check) — same dedupe as
    // the orphan adopter, so two overlapping processes can't both book an open
    // position for the same mint. A top-up is a DELIBERATE second tranche of a
    // held mint, so it uses the plain insert (the scheduler's per-strategy run
    // lock is the concurrency guard there, same as watch DCA tranches).
    const livePos = {
      strategyId: s.id, mint: pick.mint, symbol: pick.symbol, tokenName: pick.name,
      mode: "live",
      walletIndex: buyWallet.idx,
      solInLamports: costBasis.toString(),
      tokenAmountRaw: bought.toString(),
      decimals: boughtDecimals,
      highWaterLamports: costBasis.toString(),
      lastValueLamports: costBasis.toString(),
      entryVolumeH1Usd: pick.volH1Usd,
      entryLiquidityUsd: pick.liquidityUsd,
      entryPriceUsd: pick.priceUsd > 0 ? pick.priceUsd : null,
      entryFillPriceUsd: computeFillPriceUsd(pick, costBasis, bought, boughtDecimals),
      entryPairAddress: pick.pairAddress,
      entryPumpPoolId: pinnedPool?.poolId ?? null,
      entryPumpQuoteMint: pinnedPool?.quoteMint ?? null,
      entryPumpBlockhash: null,
      entryTrigger: entryMode,
      entryReduced,
      entrySig: sig,
    };
    // allowStacking (manual Buy more / Buy now / swap set it call-scoped) and
    // watch-bot DCA tranches are DELIBERATE second tranches of a held mint —
    // they must use the plain insert, exactly like the paper path above. The
    // live path missing allowStacking here was a real user-hit bug: Buy more
    // spent the SOL, then the no-open-mint guard refused the row and the
    // tranche sat untracked (no box, no stop) until orphan adoption.
    const pos = await storage.updateSwingPosition(pendingPos.id, { ...livePos, status: "open" } as any);
    if (!pos) throw new Error("Pending buy row disappeared during reconciliation");
    // Spend the top-up ticket: once the second tranche books, no open tranche
    // of this mint keeps the reduced marker — one top-up per lineage, ever.
    if (topUp) await storage.clearSwingEntryReduced(s.id, pick.mint).catch(() => {});
    const liveReducedNote = entryReduced
      ? ` The pool couldn't absorb the full ${(Number(solIn) / LAMPORTS_PER_SOL).toFixed(3)} SOL without moving the price too much, so the bot bought a smaller ${(Number(costBasis) / LAMPORTS_PER_SOL).toFixed(3)} SOL slice that fits. If this token proves itself (up 5%+ after 30+ minutes), the bot may add a second helping.`
      : "";
    await storage.addSwingEvent({
      strategyId: s.id, positionId: pos.id, kind: "buy", mint: pick.mint, symbol: pick.symbol,
      detail: `Bought ${pick.symbol} — ${s.targetMint ? "your chosen token; the bot now babysits the exit (stop-loss, profit lock, sell-off tells)" : entryMode === "manual" ? "you tapped Buy now, so the bot's entry timing was skipped on purpose — it now manages the exit (stop-loss, profit lock, sell-off tells)" : entryWhyText(pick, s, true)}. Liquidity $${Math.round(pick.liquidityUsd).toLocaleString()}, 1h vol $${Math.round(pick.volH1Usd).toLocaleString()}, 1h ${pick.chgH1 >= 0 ? "+" : ""}${pick.chgH1.toFixed(1)}% / 6h ${pick.chgH6 >= 0 ? "+" : ""}${pick.chgH6.toFixed(1)}% / 24h ${pick.chgH24 >= 0 ? "+" : ""}${pick.chgH24.toFixed(1)}%, ${pick.buysH1} buys / ${pick.sellsH1} sells (1h).${pick.chartNote ?? ""}${liveReducedNote}`,
      solLamports: costBasis.toString(),
    });
    if (s.style === "quick" && !s.targetMint) markStrategyHot(s.id);
    return true;
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    // Manual-buy slippage retry (user-hit, July 2026: "Proceed anyway" buys on
    // fast pump.fun tokens died with 0x1771 / Custom 6001 — the price moved
    // more than the tolerance while the tx was in flight, and the user read
    // the failure as "it won't let me buy"). The OWNER already chose to buy;
    // one retry with a wider (but still capped) tolerance honors that choice.
    // Auto-scanner buys never retry — a moving price is a reason NOT to enter.
    const slippageHit = /0x1771|Custom["\s:]*6001|slippage/i.test(msg);
    if (manualOverride && slippageHit && !opts.slippageRetry) {
      const bumpedBps = Math.min(Math.max(s.slippageBps * 3, 300), 1000); // ≤10%
      await storage.addSwingEvent({
        strategyId: s.id, positionId: null, kind: "info", mint: pick.mint, symbol: pick.symbol,
        detail: `The ${pick.symbol} price moved mid-trade (slippage limit hit) — since you chose this buy, retrying once with more price-move room (up to ${(bumpedBps / 100).toFixed(1)}%). No money moved on the failed attempt.`,
        solLamports: null,
      }).catch(() => {});
      return openPosition({ ...s, slippageBps: bumpedBps }, pick, sizeLamports, entryMode, { ...opts, slippageRetry: true });
    }
    await storage.addSwingEvent({
      strategyId: s.id, positionId: null, kind: "error", mint: pick.mint, symbol: pick.symbol,
      detail: `Buy failed: ${msg.slice(0, 200)}`,
      solLamports: null,
    });
    return false;
  }
}

// First-sighting timestamps for positions whose tokens weren't in the worker
// wallet — a full loss is only booked after a grace period AND an atomic
// still-open check, so a concurrent close (deploy overlap) can't be
// misrecorded as a -100% rug.
const zeroBalanceSeen = new Map<string, number>();
const ZERO_BALANCE_GRACE_MS = 60_000;

// Positions worth almost nothing are NOT market-sold ("sell for scraps") —
// the book closes as a full loss but the tokens stay in the worker wallet and
// go home to the owner in the end-of-run sweep, in case the token revives.
const DUST_HOLD_LAMPORTS = 1_000_000n; // 0.001 SOL

// A BUY whose confirmation timed out may still have landed (user-hit prod
// bug: RPC said "failed to get signature status: Request timeout", the bot
// booked "Buy failed" — but the tx HAD landed, leaving ~0.39 SOL of tokens
// sitting untracked in the worker wallet with no stop-loss). Given the sent
// signature, poll the chain for up to ~90s (the blockhash validity window)
// and return the ACTUAL fill — SOL spent and tokens received — or null only
// once the chain definitively shows failure/expiry.
async function recoverBuyFill(
  sig: string,
  owner: string,
  mint: string,
): Promise<
  | { state: "filled"; fill: { solSpentLamports: bigint; tokensRaw: bigint; decimals: number } }
  | { state: "failed" }
  | { state: "unavailable" }
> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const tx = await withDeadline(
        conn.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0 }),
        20_000, "getParsedTransaction",
      );
      if (tx) {
        if (tx.meta?.err) return { state: "failed" };
        const keys = tx.transaction.message.accountKeys.map((k: any) =>
          typeof k === "string" ? k : (k.pubkey?.toBase58 ? k.pubkey.toBase58() : String(k.pubkey ?? k)));
        const i = keys.indexOf(owner);
        if (i < 0 || !tx.meta) return { state: "failed" };
        const solDelta = BigInt(tx.meta.preBalances[i]) - BigInt(tx.meta.postBalances[i]);
        const preTok = (tx.meta.preTokenBalances ?? []).find((b: any) => b.mint === mint && b.owner === owner);
        const postTok = (tx.meta.postTokenBalances ?? []).find((b: any) => b.mint === mint && b.owner === owner);
        const gained = BigInt(postTok?.uiTokenAmount?.amount ?? "0") - BigInt(preTok?.uiTokenAmount?.amount ?? "0");
        if (gained <= 0n || solDelta <= 0n) return { state: "failed" };
        return { state: "filled", fill: { solSpentLamports: solDelta, tokensRaw: gained, decimals: Number(postTok?.uiTokenAmount?.decimals ?? 6) } };
      }
    } catch {
      // RPC hiccup — keep polling until the deadline
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  return { state: "unavailable" };
}

// A sell whose confirmation timed out may still have landed. Given the sent
// signature, read the transaction from the chain and return the worker
// wallet's actual SOL gain (the honest proceeds), or null if the tx failed,
// never landed, or can't be read right now.
// A READABLE tx with a net-zero-or-negative wallet delta (a dust sell whose
// proceeds didn't cover the tx fee) is still an answer — 0n, not null — so
// callers never fall back to the contaminated balance-delta math for it.
async function recoverSellProceeds(sig: string, owner: string): Promise<bigint | null> {
  try {
    const tx = await withDeadline(
      conn.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0 }),
      20_000, "getParsedTransaction",
    );
    if (!tx || tx.meta?.err) return null;
    const keys = tx.transaction.message.accountKeys.map((k: any) =>
      typeof k === "string" ? k : (k.pubkey?.toBase58 ? k.pubkey.toBase58() : String(k.pubkey ?? k)));
    const i = keys.indexOf(owner);
    if (i < 0 || !tx.meta) return null;
    const delta = BigInt(tx.meta.postBalances[i]) - BigInt(tx.meta.preBalances[i]);
    return delta > 0n ? delta : 0n;
  } catch {
    return null;
  }
}

// Momentum-cycle auto-watch: when a Long ride SCAN bot with momentumCycle on
// books a WIN, keep that mint on the re-entry watch list so the comeback path
// can re-buy the SAME token on its next dip-turn and cycle it. Scoped strictly
// to this opt-in flag so the manual-only watch list default (user's ask) is
// preserved for every other bot. Watch mode already re-buys its own targetMint,
// so it needs nothing here. De-duped and capped at 20.
function momentumCyclePatch(fresh: SwingStrategy, mint: string, won: boolean): { rebuyMints?: string[] } {
  if (!won || !fresh.momentumCycle || fresh.targetMint || fresh.style !== "ride") return {};
  const cur = fresh.rebuyMints ?? [];
  if (cur.includes(mint) || cur.length >= 20) return {};
  return { rebuyMints: [...cur, mint] };
}

export function manualHoldBlocksAutomaticClose(
  manualHold: boolean,
  reason: string,
  inLiquidation = false,
): boolean {
  return manualHold && reason !== "manual_sell" && !inLiquidation;
}

async function closePosition(
  s: SwingStrategy,
  p: SwingPosition,
  reason: string,
  detail: string,
  opts?: { inLiquidation?: boolean; paperFallbackValueLamports?: bigint },
): Promise<void> {
  // Idempotency guard — re-read live state so a stale snapshot (e.g. a stop
  // racing a tick) can never double-close a position or double-count P&L.
  stopWickDeferrals.delete(p.id); // any exit path clears the flash-wick reprieve
  adaptiveTakeStalls.delete(p.id);
  const current = (await storage.listSwingPositions(p.strategyId, "open")).find((x) => x.id === p.id);
  if (!current) {
    zeroBalanceSeen.delete(p.id); // closed elsewhere — drop any pending timer
    return;
  }
  // "Don't sell yet" is checked at the final close choke point so every
  // automatic route—including fast stops, reversals, rotation and liquidity
  // alarms—obeys it. Explicit Sell and whole-run liquidation are user/end-run
  // actions and intentionally remain able to close the position.
  if (manualHoldBlocksAutomaticClose(current.manualHold, reason, opts?.inLiquidation === true)) return;
  p = current;

  const solIn = BigInt(p.solInLamports);

  // Token USD price at close — cached-first so we don't add a network call to
  // the hot close path; null when the API has nothing (display shows a dash).
  const exitStats = peekTokenStats(p.mint) ?? (await getTokenStats(p.mint).catch(() => null));
  const exitPriceUsd = exitStats && exitStats.priceUsd > 0 ? exitStats.priceUsd : null;

  if (p.mode === "paper") {
    const value = (await quotePositionValue(p, s.slippageBps)) ?? opts?.paperFallbackValueLamports ?? null;
    if (value == null) throw new Error("Paper close requires a fresh executable PumpApi sell simulation.");
    const gross = value;
    // Winning paper trades pay the round-trip fee; losing trades pay none.
    const sellFee = profitableRoundTripFeeLamports(gross, solIn, s);
    const solOut = gross - sellFee;
    // Atomic close — if another process closed it first, skip stats entirely.
    const claimed = await storage.closeSwingPositionIfOpen(p.id, {
      status: "closed",
      solOutLamports: solOut.toString(),
      lastValueLamports: solOut.toString(),
      exitReason: reason,
      exitPriceUsd,
      closedAt: new Date(),
    });
    if (!claimed) return;
    const fresh = await storage.getSwingStrategy(s.id);
    if (!fresh) return;
    const realized = solOut - solIn;
    const won = realized > 0n;
    // Profit set-aside: skim the configured % of the net win OUT of the
    // trading bankroll so it can never be re-risked (paper: tracked in
    // bankedLamports; the rest compounds as before).
    const skim = skimLamports(realized, fresh);
    await storage.updateSwingStrategy(s.id, {
      paperBankrollLamports: (BigInt(fresh.paperBankrollLamports) + solOut - skim).toString(),
      bankedLamports: (BigInt(fresh.bankedLamports ?? "0") + skim).toString(),
      realizedPnlLamports: (BigInt(fresh.realizedPnlLamports) + realized).toString(),
      tradesExecuted: fresh.tradesExecuted + 1,
      wins: fresh.wins + (won ? 1 : 0),
      consecutiveLosses: won ? 0 : fresh.consecutiveLosses + 1,
      ...momentumCyclePatch(fresh, p.mint, won),
    });
    await recordFeesPaid(s.id, sellFee);
    await storage.addSwingEvent({
      strategyId: s.id, positionId: p.id, kind: "sell", mint: p.mint, symbol: p.symbol,
      detail: (sellFee > 0n ? `${detail} Platform fee ${(Number(sellFee) / LAMPORTS_PER_SOL).toFixed(5)} SOL (winning round trip only).` : detail)
        + (skim > 0n ? ` Set aside ${(Number(skim) / LAMPORTS_PER_SOL).toFixed(4)} SOL of the win (${fresh.profitSkimPct ?? 50}% profit set-aside) — out of the trading bankroll.` : ""),
      solLamports: solOut.toString(),
    });
    if (skim > 0n) {
      // Ledger entry only — money is already booked above. Fail-soft: a
      // failed telemetry write must never surface as a failed close.
      await storage.addSwingEvent({
        strategyId: s.id, positionId: p.id, kind: "skim", mint: p.mint, symbol: p.symbol,
        detail: `Set aside ${(Number(skim) / LAMPORTS_PER_SOL).toFixed(4)} SOL — ${fresh.profitSkimPct ?? 50}% of the ${p.symbol ?? "token"} win, moved out of the paper trading bankroll.`,
        solLamports: skim.toString(),
      }).catch(() => {});
    }
    return;
  }

  // LIVE — sell this tranche's tokens (capped at what the wallet holds).
  // Sign with the sub-wallet that bought this tranche (walletIndex). If that
  // wallet shows EMPTY and the bot has other sub-wallets, re-resolve by actual
  // balance first — a mis-recorded index must never turn into a false full-loss
  // booking (never-stuck backstop). If NO wallet holds the tokens, we keep the
  // recorded wallet so the existing zero-balance grace/recovery logic runs
  // unchanged.
  let kp = walletKeypairAt(s, p.walletIndex ?? 0);
  let owner = kp.publicKey;
  if (walletCount(s) > 1) {
    try {
      const here = await readMintBalance(owner, p.mint);
      if (here.amountRaw <= 0n) {
        for (let i = 0; i < walletCount(s); i++) {
          if (i === (p.walletIndex ?? 0)) continue;
          const other = await readMintBalance(new PublicKey(walletPubkeyAt(s, i)), p.mint);
          if (other.amountRaw > 0n) {
            kp = walletKeypairAt(s, i);
            owner = kp.publicKey;
            break;
          }
        }
      }
    } catch {
      // fall through with the recorded wallet — the normal path handles errors
    }
  }
  try {
    const held = await readMintBalance(owner, p.mint);
    // Sell only THIS tranche's tokens. With DCA stacking, other open tranches
    // can share the same mint — selling the full wallet balance would
    // liquidate their tokens too and strand them as phantom positions.
    const trancheRaw = BigInt(p.tokenAmountRaw);
    const sellRaw = held.amountRaw < trancheRaw ? held.amountRaw : trancheRaw;
    if (sellRaw <= 0n) {
      // A sell we SENT earlier may have landed even though its confirmation
      // timed out — the sent signature is persisted before confirming, so
      // check the chain FIRST. Booking a full loss on a sale that actually
      // went through lies about the outcome (user-hit: Jotchua sold for
      // ~94% of cost, got recorded as -100%).
      if (p.exitSig) {
        const recovered = await recoverSellProceeds(p.exitSig, owner.toBase58());
        if (recovered != null) {
          const claimedRec = await storage.closeSwingPositionIfOpen(p.id, {
            status: "closed",
            solOutLamports: recovered.toString(),
            lastValueLamports: recovered.toString(),
            exitReason: reason,
            exitPriceUsd,
            closedAt: new Date(),
          });
          zeroBalanceSeen.delete(p.id);
          if (!claimedRec) return;
          const freshRec = await storage.getSwingStrategy(s.id);
          if (freshRec) {
            const realized = recovered - solIn;
            const won = realized > 0n;
            await storage.updateSwingStrategy(s.id, {
              realizedPnlLamports: (BigInt(freshRec.realizedPnlLamports) + realized).toString(),
              tradesExecuted: freshRec.tradesExecuted + 1,
              wins: freshRec.wins + (won ? 1 : 0),
              consecutiveLosses: won ? 0 : freshRec.consecutiveLosses + 1,
              ...momentumCyclePatch(freshRec, p.mint, won),
            });
            // No sell fee here even on a win — the confirmation was lost, so
            // charging later would risk double-charging; fee failures always
            // land in the user's favor.
            await storage.addSwingEvent({
              strategyId: s.id, positionId: p.id, kind: "sell", mint: p.mint, symbol: p.symbol,
              detail: `${p.symbol} sale DID go through earlier (the confirmation was just slow) — recovered the real result from the blockchain: ${(Number(recovered) / LAMPORTS_PER_SOL).toFixed(4)} SOL back.`,
              solLamports: recovered.toString(),
            });
          }
          return;
        }
      }
      // During a liquidation/withdraw retry, a zero balance most likely means
      // an EARLIER sweep already sent these tokens home to the owner — the
      // reconcile loop after sweepAllToOwner books that honestly as
      // "tokens_sent_home". Booking a full loss here would be false.
      if (opts?.inLiquidation) return;
      // A zero balance can also mean a CONCURRENT close (e.g. old + new server
      // process overlapping during a deploy) just sold these very tokens and
      // hasn't committed its bookkeeping yet. Booking an instant full loss in
      // that window double-counts the loss and lies about the outcome
      // (user-hit bug: a real -27.8% sale got overwritten as -100%). So the
      // first zero sighting only starts a grace timer; the loss is booked only
      // if the position is STILL open (atomic check) on a later tick.
      const firstSeen = zeroBalanceSeen.get(p.id);
      if (firstSeen == null) {
        zeroBalanceSeen.set(p.id, Date.now());
        return;
      }
      if (Date.now() - firstSeen < ZERO_BALANCE_GRACE_MS) return;
      const claimedZero = await storage.closeSwingPositionIfOpen(p.id, {
        status: "closed", solOutLamports: "0", lastValueLamports: "0", exitReason: reason, closedAt: new Date(),
      });
      zeroBalanceSeen.delete(p.id);
      if (!claimedZero) return; // someone else closed it properly — not a loss
      // Genuinely gone (dusted away, rugged to a zero route, moved out).
      // Record honestly as a full loss so strategy stats and the loss brake
      // stay truthful — never silently drop the trade.
      const freshZero = await storage.getSwingStrategy(s.id);
      if (freshZero) {
        await storage.updateSwingStrategy(s.id, {
          realizedPnlLamports: (BigInt(freshZero.realizedPnlLamports) - solIn).toString(),
          tradesExecuted: freshZero.tradesExecuted + 1,
          consecutiveLosses: freshZero.consecutiveLosses + 1,
        });
        await storage.addSwingEvent({
          strategyId: s.id, positionId: p.id, kind: "error", mint: p.mint, symbol: p.symbol,
          detail: `Worker wallet held no ${p.symbol} tokens when closing (checked twice) — recorded as a full loss of ${(Number(solIn) / LAMPORTS_PER_SOL).toFixed(4)} SOL.`,
          solLamports: "0",
        });
      }
      return;
    }
    zeroBalanceSeen.delete(p.id);

    // Dust exception (user's ask): when the position is worth almost nothing,
    // selling gets ~nothing back anyway. Book the loss honestly, but KEEP the
    // tokens — the end-of-run sweep sends them to the owner's wallet, so if
    // the token ever revives the user still holds it.
    const lastVal = BigInt(p.lastValueLamports);
    if (lastVal <= DUST_HOLD_LAMPORTS && lastVal < solIn) {
      const claimedDust = await storage.closeSwingPositionIfOpen(p.id, {
        status: "closed", solOutLamports: "0", exitReason: "dust_hold", closedAt: new Date(),
      });
      if (!claimedDust) return;
      const freshDust = await storage.getSwingStrategy(s.id);
      if (freshDust) {
        await storage.updateSwingStrategy(s.id, {
          realizedPnlLamports: (BigInt(freshDust.realizedPnlLamports) - solIn).toString(),
          tradesExecuted: freshDust.tradesExecuted + 1,
          consecutiveLosses: freshDust.consecutiveLosses + 1,
        });
        await storage.addSwingEvent({
          strategyId: s.id, positionId: p.id, kind: "sell", mint: p.mint, symbol: p.symbol,
          detail: `${p.symbol} is worth almost nothing (~${(Number(lastVal) / LAMPORTS_PER_SOL).toFixed(5)} SOL) — not selling for scraps. Counted as a full loss, but the tokens stay in the worker wallet and will be sent to your wallet when the run ends, in case it ever comes back.`,
          solLamports: "0",
        });
      }
      return;
    }

    const preBal = await getSwingSolBalance(owner.toBase58());
    const pinnedPool = pinnedPositionPool(p);
    const persistSignedSell = async (signedSig: string) => {
        const updated = await storage.updateSwingPosition(p.id, { exitSig: signedSig });
        if (!updated) throw new Error("Could not persist signed sell before broadcast");
    };
    let sig: string;
    if (pinnedPool) {
      const sellQuote = await simulateExecutablePumpQuote("sell", owner.toBase58(), p.mint, sellRaw, held.decimals, s.slippageBps, pinnedPool);
      sig = await executeValidatedPumpSwap(
        "sell",
        kp,
        p.mint,
        sellRaw,
        held.decimals,
        s.slippageBps,
        executableOutputFloor(sellQuote.outputRaw, s.slippageBps),
        sellQuote.outputRaw,
        pinnedPool,
        persistSignedSell,
      );
    } else {
      // Positions opened through the original multi-protocol lane must also be
      // sellable through that lane; PumpAPI metadata is never required later
      // to release the user's funds.
      const quote = await getSwapQuote(p.mint, SOL_MINT, sellRaw.toString(), s.slippageBps);
      const built = await getSwapTransaction(quote as unknown as Record<string, unknown>, owner.toBase58());
      sig = await signSendConfirm(built.swapTransaction, kp, persistSignedSell);
    }
    // The confirmed TRANSACTION is the source of truth for what the sale
    // actually returned (the wallet's exact SOL delta inside that one tx).
    // The old primary — wallet balance before vs after — silently lies when
    // ANYTHING else touches the wallet in the same seconds (a concurrent buy
    // understates the proceeds → a winning trade books as a loss; user-hit:
    // "the chart is higher than my entry but it closed negative", and the
    // understated books also made cash-out totals disagree with the wallet).
    // Retry briefly because a tx isn't always queryable the instant it
    // confirms; the balance delta is the LAST-resort fallback only.
    let gross = 0n;
    let txReadable = false;
    for (let attempt = 0; attempt < 4 && !txReadable; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 2_000));
      const fromChain = await recoverSellProceeds(sig, owner.toBase58());
      if (fromChain != null) { gross = fromChain; txReadable = true; }
    }
    if (!txReadable) {
      // Tx meta unreadable after retries — fall back to the balance delta
      // (better than booking 0; the Hoppy case booked a +5.6% win as -100%).
      const postBal = await getSwingSolBalance(owner.toBase58());
      if (postBal > preBal) gross = postBal - preBal;
      console.log(
        `[swing] could not read tx meta for confirmed sell ${sig} (${p.symbol}) — ` +
        (gross > 0n ? `falling back to balance delta ${gross} lamports` : `balance fallback ALSO empty, booking 0`),
      );
    }
    // Atomic close FIRST — if a concurrent process already closed the book
    // (deploy overlap), do NOT count stats again and do NOT charge a fee.
    // The sale's SOL is in the worker wallet either way, so the money itself
    // is never lost.
    const claimed = await storage.closeSwingPositionIfOpen(p.id, {
      status: "closed",
      exitSig: sig,
      solOutLamports: gross.toString(),
      lastValueLamports: gross.toString(),
      exitReason: reason,
      exitPriceUsd,
      closedAt: new Date(),
    });
    if (!claimed) {
      await storage.addSwingEvent({
        strategyId: s.id, positionId: p.id, kind: "info", mint: p.mint, symbol: p.symbol,
        detail: `Sold ${p.symbol} for ${(Number(gross) / LAMPORTS_PER_SOL).toFixed(4)} SOL but the trade was already recorded as closed — proceeds are safe in the worker wallet; not double-counted.`,
        solLamports: gross.toString(),
      }).catch(() => {});
      return;
    }
    // Charge the round-trip fee only after WE won the close. A losing trade
    // pays nothing; if the transfer fails the user keeps the fee.
    const sellFeeWanted = profitableRoundTripFeeLamports(gross, solIn, s);
    let sellFee = 0n;
    if (sellFeeWanted > 0n && (await transferFeeToVault(kp, sellFeeWanted))) {
      sellFee = sellFeeWanted;
      await recordFeesPaid(s.id, sellFee);
    }
    const solOut = gross - sellFee;
    if (sellFee > 0n) {
      await storage.updateSwingPosition(p.id, {
        solOutLamports: solOut.toString(),
        lastValueLamports: solOut.toString(),
      });
    }
    const fresh = await storage.getSwingStrategy(s.id);
    if (!fresh) return;
    const realized = solOut - solIn;
    const won = realized > 0n;
    const consecutiveLosses = won ? 0 : fresh.consecutiveLosses + 1;
    // Profit set-aside (live): send the configured % of the net win from the
    // selling wallet straight to the owner's withdraw wallet, so it can never
    // be re-risked. Fail-soft — if the transfer doesn't land, the SOL simply
    // stays in the worker wallet and keeps trading; banked only counts what
    // provably left.
    let skimSent = 0n;
    const skimWanted = skimLamports(realized, fresh);
    if (skimWanted > 0n && (await transferSkimToOwner(kp, fresh.withdrawAddress, skimWanted))) {
      skimSent = skimWanted; // booked below in the SAME stats write — one update, no drift
    }
    // Watch list ("Watching for a re-entry") is MANUAL-ONLY (user's ask, July
    // 2026: "what goes up in the watch list I want to choose what I put up
    // there"). The bot no longer auto-adds a sold token after an exit — tokens
    // enter the watch list ONLY when the user taps the "Buy again" star (the
    // rebuy endpoint). The ONE exception is the opt-in momentum cycle: a Long
    // ride bot with that toggle on re-watches a token it just PROFITED on so it
    // can re-buy the dip and cycle (see momentumCyclePatch). Off by default, so
    // the manual-only rule still holds for every bot that hasn't opted in.
    await storage.updateSwingStrategy(s.id, {
      realizedPnlLamports: (BigInt(fresh.realizedPnlLamports) + realized).toString(),
      bankedLamports: (BigInt(fresh.bankedLamports ?? "0") + skimSent).toString(),
      tradesExecuted: fresh.tradesExecuted + 1,
      wins: fresh.wins + (won ? 1 : 0),
      consecutiveLosses,
      ...momentumCyclePatch(fresh, p.mint, won),
    });
    await storage.addSwingEvent({
      strategyId: s.id, positionId: p.id, kind: "sell", mint: p.mint, symbol: p.symbol,
      detail: (sellFee > 0n ? `${detail} Platform fee ${(Number(sellFee) / LAMPORTS_PER_SOL).toFixed(5)} SOL (winning round trip only).` : detail)
        + (skimSent > 0n ? ` Set aside ${(Number(skimSent) / LAMPORTS_PER_SOL).toFixed(4)} SOL of the win (${fresh.profitSkimPct ?? 50}% profit set-aside) — sent to your withdraw wallet.` : ""),
      solLamports: solOut.toString(),
    });
    if (skimSent > 0n) {
      // Ledger entry only — money already sent + booked above. Fail-soft so a
      // failed telemetry write can't be misreported as a failed sell by the
      // surrounding live-branch catch.
      await storage.addSwingEvent({
        strategyId: s.id, positionId: p.id, kind: "skim", mint: p.mint, symbol: p.symbol,
        detail: `Set aside ${(Number(skimSent) / LAMPORTS_PER_SOL).toFixed(4)} SOL — ${fresh.profitSkimPct ?? 50}% of the ${p.symbol ?? "token"} win, sent to your withdraw wallet (${fresh.withdrawAddress.slice(0, 4)}…${fresh.withdrawAddress.slice(-4)}).`,
        solLamports: skimSent.toString(),
      }).catch(() => {});
    }
    // Loss brake — COOL OFF, don't kill the run (user's ask, July 2026: "if
    // the market is bleeding, pause 30 minutes and try again — don't stop a
    // bot someone wants running for a month"). After lossStopCount straight
    // losses: block NEW buys for LOSS_COOLDOWN_MS while open positions keep
    // being managed (stops/trails still fire — the bot stays active), reset
    // the streak, and announce it. If conditions are still bad after the
    // cool-off, the next full streak triggers another cool-off — the brake
    // repeats forever instead of ending the run.
    // Watch bots skip the brake: they are single-shot by design, and the watch
    // branch in processSwingTick completes + sweeps on the very next tick.
    if (!fresh.targetMint && consecutiveLosses >= fresh.lossStopCount) {
      const mins = Math.round(LOSS_COOLDOWN_MS / 60_000);
      await storage.addSwingEvent({
        strategyId: s.id, positionId: null, kind: "info", mint: null, symbol: null,
        detail: `${consecutiveLosses} losing trades in a row — cooling off for ${mins} minutes. No new buys until then; any open positions keep their stop-losses and exits. If the market is still bleeding after the break, another losing streak just triggers another ${mins}-minute cool-off — the bot never quits the run on its own.`,
        solLamports: null,
      });
      await storage.updateSwingStrategy(s.id, {
        lossCooldownUntil: new Date(Date.now() + LOSS_COOLDOWN_MS),
        consecutiveLosses: 0,
      });
    }
  } catch (e: any) {
    await storage.addSwingEvent({
      strategyId: s.id, positionId: p.id, kind: "error", mint: p.mint, symbol: p.symbol,
      detail: `Sell failed (will retry next check): ${String(e?.message ?? e).slice(0, 200)}`,
      solLamports: null,
    });
  }
}

// ─── Per-strategy serialization ──────────────────────────────────────────────
// A manual stop and a scheduler tick must never mutate the same strategy at
// the same time — chain them so whoever comes second waits.
const strategyLocks = new Map<string, Promise<unknown>>();
// Safety valve: every legitimate operation under the lock carries its own
// network deadlines, so a healthy pass ALWAYS settles within a few minutes.
// If the previous holder is still "running" after this long, it is by
// definition leaked (a hung await that slipped past every timeout) — waiting
// longer would strand the user's withdraw behind it forever, which is exactly
// what happened in production. After the cap the next operation barges in;
// the leaked promise (if it ever wakes) re-reads status and finds it stale.
const LOCK_WAIT_CAP_MS = 15 * 60_000;
function withStrategyLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = strategyLocks.get(id) ?? Promise.resolve();
  const prevSettled = prev.then(() => {}, () => {});
  const waitCapped = Promise.race([
    prevSettled,
    new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        console.error(`[swing] strategy lock for ${id} held > ${LOCK_WAIT_CAP_MS / 60000} min — assuming leaked, proceeding.`);
        resolve();
      }, LOCK_WAIT_CAP_MS);
      // Don't keep the process alive just for the cap timer.
      if (typeof t === "object" && "unref" in t) t.unref();
      prevSettled.finally(() => clearTimeout(t));
    }),
  ]);
  const run = waitCapped.then(fn);
  strategyLocks.set(id, run.catch(() => {}));
  return run;
}

// Used by the delete route: waits for any in-flight liquidation/sweep on this
// strategy to finish before the row (and its encrypted worker key) is removed.
export function runUnderStrategyLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  return withStrategyLock(id, fn);
}

// ─── Liquidate everything + (live) sweep back to owner ──────────────────────
// GUARANTEE: the user is never left stuck holding a token in the worker
// wallet. If a sell fails, the sweep sends the raw tokens themselves to the
// owner's wallet — either way, everything goes home.
export async function liquidateAndSweep(s: SwingStrategy, reason: string): Promise<void> {
  const open = await storage.listSwingPositions(s.id, "open");
  // Owner's end-of-run choice for still-red positions: with "send_tokens",
  // a LIVE position below cost is never sold — we skip its sell here, the
  // sweep below moves the tokens themselves to the owner's wallet, and the
  // reconcile loop then closes it honestly as tokens_sent_home. Paper bots
  // have no real tokens, so paper positions always close normally.
  const sendRedHome = s.mode === "live" && (s.redEndBehavior ?? "sell") === "send_tokens";
  for (const p of open) {
    // Red/green must be judged on a FRESH executable quote, not the persisted
    // lastValueLamports (which can be stale-green while the live price is
    // red). Quote unavailable = can't prove profit = treat as red and send
    // the tokens home (fail-safe toward "never sell red").
    let isRed = false;
    if (sendRedHome) {
      const freshValue = await quotePositionValue(p, s.slippageBps).catch(() => null);
      isRed = freshValue == null || freshValue <= BigInt(p.solInLamports);
    }
    if (sendRedHome && isRed) {
      await storage.addSwingEvent({
        strategyId: s.id, positionId: p.id, kind: "info", mint: p.mint, symbol: p.symbol,
        detail: `${p.symbol} is still below what you paid — per your end-of-run choice, sending you the tokens themselves instead of selling at a loss.`,
        solLamports: null,
      }).catch(() => {});
      continue;
    }
    await closePosition(s, p, reason, `Run ended — closing ${p.symbol}.`, { inLiquidation: true }).catch(() => {});
  }
  if (s.mode === "live") {
    try {
      // Sweep EVERY sub-wallet home — SOL and stray tokens alike. Results are
      // aggregated so the user sees one honest total (plus per-wallet errors).
      const nWallets = walletCount(s);
      let sweptTotal = 0n;
      const solSigs: string[] = [];
      const solErrors: string[] = [];
      const tokenErrors: string[] = [];
      for (let i = 0; i < nWallets; i++) {
        const kpI = walletKeypairAt(s, i);
        const sweep = await sweepAllToOwner(s, kpI);
        sweptTotal += sweep.sweptLamports;
        if (sweep.sweptLamports > 0n && sweep.solSig) solSigs.push(sweep.solSig);
        if (sweep.solError) solErrors.push(nWallets > 1 ? `wallet ${i + 1}: ${sweep.solError}` : sweep.solError);
        tokenErrors.push(...sweep.tokenErrors);
      }
      if (sweptTotal > 0n && solSigs.length > 0) {
        await storage.addSwingEvent({
          strategyId: s.id, positionId: null, kind: "info", mint: null, symbol: null,
          detail: `Sent ${(Number(sweptTotal) / LAMPORTS_PER_SOL).toFixed(4)} SOL back to your wallet (${s.withdrawAddress.slice(0, 4)}…${s.withdrawAddress.slice(-4)})${nWallets > 1 ? ` from ${solSigs.length} trading wallet${solSigs.length === 1 ? "" : "s"}` : ""}. Tx: ${solSigs.join(", ")}`,
          solLamports: sweptTotal.toString(),
        });
      }
      for (const se of solErrors) {
        await storage.addSwingEvent({
          strategyId: s.id, positionId: null, kind: "error", mint: null, symbol: null,
          detail: `Couldn't send the SOL back to your wallet after 3 tries — nothing is lost, it's still in the bot's worker wallet. Press "Withdraw again" to retry. (${se})`,
          solLamports: null,
        });
      }
      for (const te of tokenErrors) {
        await storage.addSwingEvent({
          strategyId: s.id, positionId: null, kind: "error", mint: null, symbol: null,
          detail: `Couldn't transfer a token home yet — still in the worker wallet, press "Withdraw again" to retry. (${te})`,
          solLamports: null,
        });
      }
      // Reconcile positions whose sell failed: if the sweep moved the tokens
      // home, close the book honestly at the last quoted value. "Moved home"
      // must mean NO sub-wallet still holds the mint — checking only one
      // wallet could close a tranche whose tokens still sit in another.
      const leftovers = await storage.listSwingPositions(s.id, "open");
      for (const p of leftovers.filter((x) => x.mode === "live")) {
        try {
          let stillHeldRaw = 0n;
          for (let i = 0; i < nWallets && stillHeldRaw <= 0n; i++) {
            const b = await readMintBalance(new PublicKey(walletPubkeyAt(s, i)), p.mint);
            stillHeldRaw += b.amountRaw;
          }
          if (stillHeldRaw <= 0n) {
            const lastValue = BigInt(p.lastValueLamports);
            // Settled IN KIND, not in SOL — the position closes with the last
            // honest quote as a display estimate, but strategy P&L / trades /
            // wins are deliberately NOT touched: no on-chain sell happened,
            // so booking mark-to-model value as realized profit would lie.
            const claimedHome = await storage.closeSwingPositionIfOpen(p.id, {
              status: "closed", solOutLamports: lastValue.toString(),
              exitReason: "tokens_sent_home", closedAt: new Date(),
            });
            if (!claimedHome) continue;
            await storage.addSwingEvent({
              strategyId: s.id, positionId: p.id, kind: "sell", mint: p.mint, symbol: p.symbol,
              detail: `Couldn't sell ${p.symbol} on any route — sent the tokens themselves to your wallet instead (last quoted value ~${(Number(lastValue) / LAMPORTS_PER_SOL).toFixed(4)} SOL). You hold them now and can sell whenever you like. Not counted in the bot's P&L since it never sold for SOL.`,
              solLamports: lastValue.toString(),
            });
          } else {
            await storage.addSwingEvent({
              strategyId: s.id, positionId: p.id, kind: "error", mint: p.mint, symbol: p.symbol,
              detail: `Couldn't sell OR transfer ${p.symbol} yet — tokens are still in the worker wallet. Press "Stop & withdraw" again to retry; nothing is lost.`,
              solLamports: null,
            });
          }
        } catch {
          // leave the position open — a later withdraw retry picks it up
        }
      }
    } catch (e: any) {
      console.error(`[swing] sweep failed for ${s.id}:`, e?.message ?? e);
      await storage.addSwingEvent({
        strategyId: s.id, positionId: null, kind: "error", mint: null, symbol: null,
        detail: `Sweeping funds home hit a snag — nothing is lost, everything is still in the bot's worker wallet. Press "Withdraw again" to retry. (${String(e?.message ?? e).slice(0, 160)})`,
        solLamports: null,
      }).catch(() => {});
    }
  }
}

// Send a legacy Transaction and confirm by polling ITS OWN signature status
// (never a fresher blockhash — false "expired" negatives corrupt accounting).
async function sendLegacyTxConfirmed(tx: Transaction, kp: Keypair): Promise<string> {
  const latest = await withDeadline(conn.getLatestBlockhash("confirmed"), 15_000, "getLatestBlockhash");
  tx.recentBlockhash = latest.blockhash;
  tx.feePayer = kp.publicKey;
  tx.sign(kp);
  const sig = await withDeadline(conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 }), 45_000, "sendRawTransaction");
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const { value } = await withDeadline(conn.getSignatureStatuses([sig]), 15_000, "getSignatureStatuses");
    const st = value[0];
    if (st) {
      if (st.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(st.err)}`);
      if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") return sig;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Transaction not confirmed within 60s (it may still land — check the wallet).");
}

interface SweepResult {
  sweptLamports: bigint;   // SOL actually sent home (0n if nothing to send or send failed)
  solSig: string | null;   // tx signature of the SOL transfer, if it landed
  solError: string | null; // why the SOL transfer failed, if it did
  tokenErrors: string[];   // per-token transfer failures (symbol/mint + reason)
}

async function sweepAllToOwner(s: SwingStrategy, kp: Keypair): Promise<SweepResult> {
  const owner = kp.publicKey;
  const dest = new PublicKey(s.withdrawAddress);
  const result: SweepResult = { sweptLamports: 0n, solSig: null, solError: null, tokenErrors: [] };

  const holdings = await getTokenHoldings(owner, true);
  for (const h of holdings) {
    try {
      const tx = new Transaction();
      if (h.amountRaw > 0n) {
        const destAta = getAssociatedTokenAddressSync(new PublicKey(h.mint), dest, true, h.programId);
        tx.add(createAssociatedTokenAccountIdempotentInstruction(owner, destAta, dest, new PublicKey(h.mint), h.programId));
        tx.add(createTransferCheckedInstruction(h.ata, new PublicKey(h.mint), destAta, owner, h.amountRaw, h.decimals, [], h.programId));
      }
      tx.add(createCloseAccountInstruction(h.ata, dest, owner, [], h.programId));
      await sendLegacyTxConfirmed(tx, kp);
    } catch (e: any) {
      // Recorded, retried automatically below is not possible per-token here —
      // a later "Withdraw again" picks these up. But never silently.
      result.tokenErrors.push(`${h.mint.slice(0, 6)}…: ${String(e?.message ?? e).slice(0, 120)}`);
      console.error(`[swing] token sweep failed for ${s.id} mint ${h.mint}:`, e?.message ?? e);
    }
  }

  // SOL sweep — retry up to 3 times (public RPCs rate-limit sporadically).
  // Drain to EXACTLY zero: a system account may end a transaction at 0 lamports
  // or at ≥ the rent-exempt minimum (~0.00089 SOL) — anything in between fails
  // simulation with "insufficient funds for rent". So we send balance minus
  // only the 5000-lamport tx fee, leaving the worker wallet empty.
  const TX_FEE_LAMPORTS = 5_000n; // base fee, 1 signature, no priority fee
  let lastErr: any = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const balance = await getSwingSolBalance(owner.toBase58());
      const sendable = balance - TX_FEE_LAMPORTS;
      if (sendable <= DUST_LAMPORTS) return result; // nothing meaningful left — done
      const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: owner, toPubkey: dest, lamports: Number(sendable) }),
      );
      const sig = await sendLegacyTxConfirmed(tx, kp);
      result.sweptLamports = sendable;
      result.solSig = sig;
      return result;
    } catch (e: any) {
      lastErr = e;
      console.error(`[swing] SOL sweep attempt ${attempt}/3 failed for ${s.id}:`, e?.message ?? e);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2500 * attempt));
    }
  }
  result.solError = String(lastErr?.message ?? lastErr).slice(0, 160);
  return result;
}

// ─── Multi-wallet deposit distribution ───────────────────────────────────────
// Split the (post-fee) bankroll evenly across the sub-wallets. Idempotent
// shortfall top-up (auto-strategy pattern): each pass only sends what a
// wallet is MISSING vs its fair share, so a re-run after a partial failure
// never double-funds. Transfers come from the primary wallet (the deposit
// lands there) and the primary always keeps its own share.
const MIN_DISTRIBUTE_LAMPORTS = 5_000_000n; // don't shuffle dust between wallets
async function distributeSwingFunds(s: SwingStrategy): Promise<void> {
  const n = walletCount(s);
  if (n <= 1) return;
  const ws = await walletBalances(s);
  const total = ws.reduce((a, w) => a + w.balance, 0n);
  const share = total / BigInt(n);
  const kp0 = loadKeypair(s.encryptedKey);
  let primaryLeft = ws[0].balance;
  let moved = 0n;
  let funded = 0;
  for (let i = 1; i < n; i++) {
    const shortfall = share - ws[i].balance;
    if (shortfall < MIN_DISTRIBUTE_LAMPORTS) continue;
    // Never drain the primary below ITS fair share — it trades too.
    const available = primaryLeft > share + FEE_RESERVE_LAMPORTS ? primaryLeft - share - FEE_RESERVE_LAMPORTS : 0n;
    const send = shortfall < available ? shortfall : available;
    if (send < MIN_DISTRIBUTE_LAMPORTS) continue;
    try {
      const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: kp0.publicKey, toPubkey: new PublicKey(walletPubkeyAt(s, i)), lamports: Number(send) }),
      );
      await sendLegacyTxConfirmed(tx, kp0);
      primaryLeft -= send;
      moved += send;
      funded++;
    } catch (e: any) {
      // Tolerated: the buy picker self-balances around whatever landed where.
      console.error(`[swing] distribute to sub-wallet ${i} failed for ${s.id}:`, e?.message ?? e);
    }
  }
  if (moved > 0n) {
    await storage.addSwingEvent({
      strategyId: s.id, positionId: null, kind: "info", mint: null, symbol: null,
      detail: `Spread your deposit across ${n} trading wallets (moved ${(Number(moved) / LAMPORTS_PER_SOL).toFixed(4)} SOL into ${funded} sub-wallet${funded === 1 ? "" : "s"}) — buys and sells now go tranche by tranche.`,
      solLamports: moved.toString(),
    }).catch(() => {});
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────
// Activation runs under the strategy lock and re-reads status inside it:
// the one-time deposit fee must be charged exactly once even if the user
// double-taps Start (two concurrent /start calls would otherwise both see
// awaiting_funds and both collect the fee).
export async function tryActivateSwingStrategy(id: string): Promise<SwingStrategy> {
  return withStrategyLock(id, async () => {
    const s = await storage.getSwingStrategy(id);
    if (!s) throw new Error("Swing bot not found.");
    if (s.status === "active") return s;
    if (s.status !== "awaiting_funds" && s.status !== "paused" && s.status !== "stopped" && s.status !== "completed") {
      throw new Error(`Swing bot is ${s.status} and cannot be started.`);
    }
    // Restart of a stopped/completed bot: allowed only while the run window
    // is still open. No new deposit fee — that's charged once, on the first
    // start. (Watch bots complete mid-window after their single round trip;
    // restarting begins a FRESH run — see restartedAt below.)
    const isRestart = s.status === "stopped" || s.status === "completed";
    if (isRestart && new Date(s.windowEndAt).getTime() <= Date.now()) {
      throw new Error("This bot's run window has ended — create a new bot to keep trading.");
    }
    const firstStart = s.status === "awaiting_funds";
    if (s.mode === "live") {
      // Combined balance across ALL sub-wallets — on first start the deposit
      // sits in the primary wallet; on later starts funds may be spread out.
      const balances = await walletBalances(s);
      const balance = balances.reduce((a, w) => a + w.balance, 0n);
      const nWallets = walletCount(s);
      const pct = feePctLabel(s);
      const fee = firstStart ? depositFeeLamports(balance, s) : 0n;
      // The wallet must remain tradable after the one-time platform fee and
      // after reserving network headroom for every sub-wallet.
      // Every sub-wallet needs its own buy headroom (rents + priority fees).
      if (balance < MIN_TRADE_LAMPORTS + LIVE_BUY_HEADROOM_LAMPORTS * BigInt(nWallets) + fee) {
        throw new Error(
          `Worker wallet${nWallets > 1 ? "s" : ""} only hold${nWallets > 1 ? "" : "s"} ${(Number(balance) / LAMPORTS_PER_SOL).toFixed(4)} SOL — not enough to trade after the one-time ${pct} platform fee. Fund it from your main wallet first.`,
        );
      }
      if (firstStart) {
        const kp = loadKeypair(s.encryptedKey);
        const collected = await transferFeeToVault(kp, fee);
        if (collected) await recordFeesPaid(id, fee);
        await storage.addSwingEvent({
          strategyId: id, positionId: null, kind: "info", mint: null, symbol: null,
          detail: collected
            ? `Platform fee collected: ${pct} of your deposit (${(Number(fee) / LAMPORTS_PER_SOL).toFixed(5)} SOL), one time.`
            : `Platform deposit fee (${(Number(fee) / LAMPORTS_PER_SOL).toFixed(5)} SOL) couldn't be collected — waived in your favor.`,
          solLamports: collected ? fee.toString() : null,
        }).catch(() => {});
      }
      // Multi-wallet: spread the (post-fee) bankroll across the sub-wallets.
      // Failure is tolerated — the buy picker trades with whatever landed
      // where, so an uneven split can never strand the bot.
      if (nWallets > 1) {
        await distributeSwingFunds(s).catch(async (e: any) => {
          await storage.addSwingEvent({
            strategyId: id, positionId: null, kind: "info", mint: null, symbol: null,
            detail: `Couldn't finish spreading the deposit across all ${nWallets} trading wallets yet — the bot still trades normally with what each wallet holds. (${String(e?.message ?? e).slice(0, 120)})`,
            solLamports: null,
          }).catch(() => {});
        });
      }
    }
    // A restart begins a FRESH run: stamp restartedAt so watch-mode logic
    // only counts positions from this run (otherwise the tick would see the
    // old closed position and instantly re-complete), and reset the
    // consecutive-loss brake — the user consciously chose to go again.
    const updated = await storage.updateSwingStrategy(id, {
      status: "active",
      nextRunAt: new Date(),
      // Lifetime clock: start (or resume) the active stretch. If a stray
      // activeSince survived a crash, keep the earlier stamp — never
      // double-count by resetting an in-flight stretch.
      ...(s.activeSince ? {} : { activeSince: new Date() }),
      ...(isRestart ? { restartedAt: new Date(), consecutiveLosses: 0 } : {}),
    });
    if (!updated) throw new Error("Failed to start swing bot.");
    if (isRestart) {
      await storage.addSwingEvent({
        strategyId: id, positionId: null, kind: "info", mint: null, symbol: null,
        detail: s.targetMint
          ? "Bot restarted — fresh run on your token. No new fees; your one-time deposit fee was already paid."
          : "Bot restarted — hunting for entries again. No new fees; your one-time deposit fee was already paid.",
        solLamports: null,
      }).catch(() => {});
    }
    return updated;
  });
}

// Lifetime "time in market" clock: fold the current active stretch into
// activeMsTotal and clear activeSince. Called on EVERY transition out of
// "active" (pause, stop, complete). Idempotent: no
// activeSince = nothing to fold in.
function accrueActiveTime(s: Pick<SwingStrategy, "activeSince" | "activeMsTotal">): { activeMsTotal: string; activeSince: null } | {} {
  if (!s.activeSince) return {};
  const stretch = Math.max(0, Date.now() - new Date(s.activeSince).getTime());
  const total = BigInt(s.activeMsTotal || "0") + BigInt(stretch);
  return { activeMsTotal: total.toString(), activeSince: null };
}

export async function pauseSwingStrategy(id: string): Promise<SwingStrategy | undefined> {
  const s = await storage.getSwingStrategy(id);
  return storage.updateSwingStrategy(id, { status: "paused", nextRunAt: null, ...(s ? accrueActiveTime(s) : {}) });
}

// Stop = liquidate all open positions + (live) sweep everything to the owner.
// The status flip happens IMMEDIATELY and outside the lock: ticks re-read
// status under the lock and abort when it isn't "active", so flipping first
// halts new buys instantly even mid-tick. Only the liquidation itself is
// serialized behind the lock (it must not race an in-flight buy/sell).
// Previously the flip was ALSO queued behind the lock — a stop pressed during
// a slow tick sat invisible for minutes and was lost entirely if the server
// restarted while queued.
export async function stopAndWithdrawSwingStrategy(id: string): Promise<SwingStrategy | undefined> {
  const s = await storage.getSwingStrategy(id);
  if (!s) return undefined;
  const updated = await storage.updateSwingStrategy(id, { status: "stopped", nextRunAt: null, ...accrueActiveTime(s) });
  await storage.addSwingEvent({
    strategyId: id, positionId: null, kind: "info", mint: null, symbol: null,
    detail: s.mode === "live"
      ? "Stop received — selling every open position and sweeping all funds back to your wallet. This can take a minute or two; if anything is left afterwards, press \"Withdraw again\"."
      : "Stop received — closing paper positions and finishing up.",
    solLamports: null,
  });
  const liquidation = withStrategyLock(id, () => liquidateAndSweep({ ...s, status: "stopped" }, "manual_stop")).catch(async (e) => {
    console.error(`[swing] stop liquidation failed for ${id}:`, e?.message ?? e);
    await storage.addSwingEvent({
      strategyId: id, positionId: null, kind: "error", mint: null, symbol: null,
      detail: `Selling/sweeping hit a snag — nothing is lost. Press "Withdraw again" to retry. (${String(e?.message ?? e).slice(0, 160)})`,
      solLamports: null,
    }).catch(() => {});
  });
  // If there are no open positions this is a PURE withdraw (one SOL transfer,
  // seconds not minutes) — await it so the user's button press reflects the
  // real outcome instead of firing into the void. With open positions the
  // liquidation can take minutes, so it stays in the background as before.
  // The await is CAPPED at 60s: if the sweep is stuck queued behind a hung
  // tick, the HTTP response must still return — the sweep keeps running in
  // the background and the periodic stranded-balance check is the backstop.
  if (s.mode === "live") {
    const stillOpen = await storage.listSwingPositions(id, "open");
    if (stillOpen.length === 0) {
      await Promise.race([liquidation, new Promise((r) => setTimeout(r, 60_000))]);
    }
  }
  return updated;
}

// Paper-only destructive cleanup. Stop first so no new scheduler work can
// start, then serialize settlement and deletion behind the strategy lock.
// Never erase the audit trail while a position is still open: a failed quote
// leaves the stopped bot intact so the owner can retry safely.
export async function stopSettleAndDeletePaperSwingStrategy(id: string): Promise<void> {
  const existing = await storage.getSwingStrategy(id);
  if (!existing) return;
  if (existing.mode !== "paper") throw new Error("Automatic close-and-delete is available only for paper bots.");

  await storage.updateSwingStrategy(id, {
    status: "deleting",
    nextRunAt: null,
    ...accrueActiveTime(existing),
  });

  await withStrategyLock(id, async () => {
    const fresh = await storage.getSwingStrategy(id);
    if (!fresh) return;
    if (fresh.mode !== "paper") throw new Error("Automatic close-and-delete is available only for paper bots.");
    if (fresh.status !== "deleting") {
      throw new Error("The paper bot could not be claimed for deletion. Please try again.");
    }

    await storage.addSwingEvent({
      strategyId: id, positionId: null, kind: "info", mint: null, symbol: null,
      detail: "Delete confirmed — stopping the paper bot and closing every open practice position before removing it.",
      solLamports: null,
    }).catch(() => {});

    await liquidateAndSweep({ ...fresh, status: "stopped" }, "manual_stop");
    const remaining = await storage.listSwingPositions(id, "open");
    if (remaining.length > 0) {
      throw new Error("One or more paper positions could not be closed right now. The bot is locked from further trading and was not deleted, so nothing was lost. Please try delete again shortly.");
    }
    await storage.deleteSwingStrategy(id);
  });
}

// Manual "Sell now": the user decides to exit a position before the bot's
// rules do. Runs under the strategy lock so it can never race a tick's own
// exit judgment (the idempotent close guard inside closePosition makes a
// simultaneous rule-based exit harmless anyway). For watch-mode bots the
// existing single-shot wrap-up then completes the run and sweeps everything
// home on the next tick — the user's cash-out needs no extra step.
export async function manualSellSwingPosition(strategyId: string, positionId: string): Promise<void> {
  return withStrategyLock(strategyId, async () => {
    const s = await storage.getSwingStrategy(strategyId);
    if (!s) throw new Error("Swing bot not found.");
    const positions = await storage.listSwingPositions(strategyId, "open");
    const p = positions.find((x) => x.id === positionId);
    if (!p) throw new Error("That position is already closed.");
    await closePosition(s, p, "manual_sell",
      `You pressed Sell — selling ${p.symbol} at market now instead of waiting for the bot's exit rules.`);
  });
}

// Manual "Buy more" on a token the bot already holds (user-directed add-on,
// July 2026 — "one's running, the others are stagnant, I want more of the
// runner"). Puts ALL free cash into another tranche of that mint. Entry
// judgment is deliberately skipped (the user chose), but the rug-risk,
// honeypot, and impact guards inside openPosition still apply — a manual
// conviction buy never bypasses safety. The tranche gets its own cost basis,
// stop, and trail, exactly like DCA stacking.
export async function manualBuyMoreSwingPosition(strategyId: string, positionId: string): Promise<{ symbol: string; sol: number }> {
  return withStrategyLock(strategyId, async () => {
    const s = await storage.getSwingStrategy(strategyId);
    if (!s) throw new Error("Swing bot not found.");
    if (s.status !== "active") throw new Error("The bot has to be running to buy more — press Start first.");
    const positions = await storage.listSwingPositions(strategyId, "open");
    const p = positions.find((x) => x.id === positionId);
    if (!p) throw new Error("That position is already closed.");
    let free: bigint;
    if (s.mode === "paper") {
      free = BigInt(s.paperBankrollLamports);
    } else {
      free = await combinedSpendable(s); // all sub-wallets, each minus its headroom
    }
    if (free < MIN_TRADE_LAMPORTS) {
      throw new Error("Not enough free SOL for another buy — sell a stagnant position first (its SOL frees up right away) or top up.");
    }
    const stats = await getInteractiveTokenStats(p.mint);
    if (!stats) throw new Error(`The live market-data provider couldn't return a usable price for ${p.symbol} after several tries. Your wallet connection is not needed for paper mode, and no paper money moved — please try again shortly.`);
    const pick = { ...stats, score: 0 };
    // allowStacking=true just for this call: bypasses the held-mint exclusion
    // (that's the whole point of Buy more) without touching stored settings.
    const bought = await openPosition({ ...s, allowStacking: true }, pick, free, "manual");
    if (!bought) {
      const why = await lastBuyFailureDetail(s.id, p.mint);
      throw new Error(why ? `The buy didn't go through. ${why}` : `The buy didn't go through — the activity feed shows the exact reason. No money moved, so it's safe to try again.`);
    }
    // openPosition already committed the tranche, deducted the paper bankroll,
    // and wrote the canonical buy event. This extra explanatory note must not
    // turn a successful buy into an error response if event storage hiccups.
    await storage.addSwingEvent({
      strategyId: s.id, positionId: null, kind: "info", mint: p.mint, symbol: p.symbol,
      detail: `You pressed Buy more — added ${(Number(free) / LAMPORTS_PER_SOL).toFixed(4)} SOL to ${p.symbol} as a fresh tranche with its own stop and exit rules.`,
      solLamports: free.toString(),
    }).catch((err) => {
      console.warn(`[swing] buy-more note failed after ${p.symbol} tranche committed:`, err);
    });
    return { symbol: p.symbol, sol: Number(free) / LAMPORTS_PER_SOL };
  });
}

// Truthful manual-buy failures (user-hit, July 2026): the generic "a safety
// guard declined it OR the swap failed on-chain" toast blamed the rug guard
// for what was actually a slippage failure — false information. openPosition
// already writes the exact reason to the activity feed; surface THAT event's
// wording in the error instead of guessing at causes.
async function lastBuyFailureDetail(strategyId: string, mint: string): Promise<string | null> {
  try {
    const events = await storage.listSwingEvents(strategyId, 25);
    const ev = events.find((x) =>
      x.mint === mint && (x.kind === "skip" || x.kind === "error") &&
      Date.now() - new Date(x.createdAt as any).getTime() < 2 * 60_000);
    return ev?.detail ?? null;
  } catch {
    return null;
  }
}

// Manual "Buy now" on a previously-traded mint (from a closed trade's "Buy
// again" — the user wants back in immediately instead of waiting for the
// bot's entry judgment). Puts ALL free cash into the mint right away. Entry
// judgment and re-entry cooldown are deliberately skipped (the user chose),
// but rug-risk, honeypot, and impact guards inside openPosition still apply.
export async function manualBuyMintNow(strategyId: string, mint: string): Promise<{ symbol: string; sol: number }> {
  return withStrategyLock(strategyId, async () => {
    const s = await storage.getSwingStrategy(strategyId);
    if (!s) throw new Error("Swing bot not found.");
    if (s.status !== "active") throw new Error("The bot has to be running to buy — press Start first.");
    // Scope guard: single-token watch bots are excluded entirely (below); the
    // qualifying-mint check follows.
    if (s.targetMint) throw new Error("This bot watches one specific token — Buy again doesn't apply here.");
    // Scope: a mint qualifies if the bot has traded it before (a closed position
    // exists) OR the owner explicitly added it to the watchlist (rebuyMints, set
    // via the owner-signed rebuy action). Either way the owner opted in; the buy
    // itself still passes every openPosition safety guard below.
    const closed = await storage.listSwingPositions(strategyId, "closed");
    const watched = new Set(s.rebuyMints ?? []);
    if (!closed.some((x) => x.mint === mint) && !watched.has(mint)) {
      throw new Error("Buy now only works on tokens this bot has traded before or that you've added to its watchlist.");
    }
    let free: bigint;
    if (s.mode === "paper") {
      free = BigInt(s.paperBankrollLamports);
    } else {
      free = await combinedSpendable(s); // all sub-wallets, each minus its headroom
    }
    if (free < MIN_TRADE_LAMPORTS) {
      throw new Error("Not enough free SOL for a buy — sell a position first (its SOL frees up right away) or top up.");
    }
    const attempt = await executeManualRebuyAttempt({
      mint,
      loadStats: getTokenStats,
      usablePrice: (stats) => stats.priceUsd,
      // allowStacking=true call-scoped: bypasses the held-mint exclusion in case
      // a tranche is already open, without touching stored settings.
      open: (stats) => openPosition({ ...s, allowStacking: true }, { ...stats, score: 0 }, free, "manual"),
    });
    const { stats, bought } = attempt;
    if (!bought) {
      const why = await lastBuyFailureDetail(s.id, mint);
      throw new Error(why ? `The buy didn't go through. ${why}` : "The buy didn't go through — the activity feed shows the exact reason. No money moved, so it's safe to try again.");
    }
    await storage.addSwingEvent({
      strategyId: s.id, positionId: null, kind: "info", mint, symbol: stats.symbol,
      detail: `You pressed Buy now — put ${(Number(free) / LAMPORTS_PER_SOL).toFixed(4)} SOL back into ${stats.symbol} right away, with its own stop and exit rules.`,
      solLamports: free.toString(),
    });
    return { symbol: stats.symbol, sol: Number(free) / LAMPORTS_PER_SOL };
  });
}

// "Ask me first" — the owner approves a pending suggestion the bot filed
// instead of auto-buying. Runs under the strategy lock so it can't race the
// tick or a Stop, and buys through the SAME safety-guarded openPosition path a
// manual "Buy now" uses (buys at the CURRENT price). The signal only flips to
// "approved" AFTER a position actually opens — a declined buy leaves it pending
// so the owner can retry.
export async function approveBuySignal(strategyId: string, signalId: string): Promise<{ symbol: string }> {
  return withStrategyLock(strategyId, async () => {
    const s = await storage.getSwingStrategy(strategyId);
    if (!s) throw new Error("Swing bot not found.");
    if (s.status !== "active") throw new Error("The bot has to be running to buy — press Start first.");
    const sig = await storage.getSwingBuySignal(signalId);
    if (!sig || sig.strategyId !== strategyId) throw new Error("That suggestion is no longer available.");
    if (sig.status !== "pending") throw new Error("That suggestion was already handled.");
    if ((s.blockedMints ?? []).includes(sig.mint)) {
      await storage.updateSwingBuySignalStatus(signalId, "dismissed");
      throw new Error("That token is on your Never-buy list — the suggestion was cleared.");
    }
    if (s.universe === "stocks" && getUsEquityMarketSession().state === "closed") {
      throw new Error("The U.S. market is closed. This stock suggestion will be checked again after the market reopens; no paper cash was spent.");
    }
    let free: bigint;
    if (s.mode === "paper") {
      free = BigInt(s.paperBankrollLamports);
    } else {
      free = await combinedSpendable(s); // all sub-wallets, each minus its headroom
    }
    if (free < MIN_TRADE_LAMPORTS) {
      throw new Error("Not enough free SOL for a buy — sell a position first (its SOL frees up right away) or top up.");
    }
    const stats = await getTokenStats(sig.mint, { forceFresh: true });
    if (!stats || stats.priceUsd <= 0) throw new Error("Couldn't fetch live market data for that token right now — try again in a minute.");
    if (s.universe === "stocks") {
      const verdict = judgeStockEntry(stats, s.minLiquidityUsd);
      if (!verdict.ok) {
        await storage.updateSwingBuySignalStatus(signalId, "expired");
        await storage.addSwingEvent({
          strategyId: s.id,
          positionId: null,
          kind: "info",
          mint: sig.mint,
          symbol: sig.symbol,
          detail: `The ${sig.symbol} approval signal was rechecked and expired: ${verdict.why}. No paper cash was spent; the bot kept scanning.`,
          solLamports: null,
        });
        throw new Error(`The signal changed before approval: ${verdict.why}. No paper buy was made, and the bot is continuing to scan.`);
      }
    }
    // allowStacking=true call-scoped: bypasses the held-mint exclusion in case
    // a tranche is already open, without touching stored settings.
    const bought = await openPosition({ ...s, allowStacking: true }, { ...stats, score: 0 }, free, "manual");
    if (!bought) {
      const why = await lastBuyFailureDetail(s.id, sig.mint);
      throw new Error(why ? `The buy didn't go through. ${why} The suggestion stays so you can try again.` : "The buy didn't go through — the activity feed shows the exact reason. The suggestion stays so you can try again.");
    }
    await storage.updateSwingBuySignalStatus(signalId, "approved");
    await storage.addSwingEvent({
      strategyId: s.id, positionId: null, kind: "info", mint: sig.mint, symbol: stats.symbol,
      detail: `You approved the bot's pick — bought ${(Number(free) / LAMPORTS_PER_SOL).toFixed(4)} SOL of ${stats.symbol} at the current price, with its own stop and exit rules.`,
      solLamports: free.toString(),
    });
    return { symbol: stats.symbol };
  });
}

// "Ask me first" — the owner dismisses a pending suggestion (no buy). Runs
// under the SAME strategy lock as approveBuySignal so a concurrent approve and
// dismiss can never interleave (a dismiss either lands fully before an approve
// starts, or after it finishes — it can't cancel an in-flight buy). Safe to
// call on an already-handled signal (no-op).
export async function dismissBuySignal(strategyId: string, signalId: string): Promise<void> {
  return withStrategyLock(strategyId, async () => {
    const sig = await storage.getSwingBuySignal(signalId);
    if (!sig || sig.strategyId !== strategyId) throw new Error("That suggestion is no longer available.");
    if (sig.status === "pending") await storage.updateSwingBuySignalStatus(signalId, "dismissed");
  });
}

// "Would the bot buy this right now?" — the pre-buy warning behind the manual
// "Buy now" button (user's FOMO-brake ask: "I needed to know WHY it wasn't
// buying before I bought it and lost it all again"). Returns plain-language
// FACTS only + the bot's own one-line entry verdict — never advice ("we can't
// tell you what to do, but here's what we see"). Read-only: touches no keys,
// returns no secrets, changes nothing. Scoped to mints this bot has traded,
// mirroring manualBuyMintNow so the endpoint can't be used to fetch arbitrary
// tokens.
export async function assessBuyNow(
  strategyId: string,
  mint: string,
): Promise<{ symbol: string; wouldBuy: boolean; headline: string; facts: string[] }> {
  const s = await storage.getSwingStrategy(strategyId);
  if (!s) throw new Error("Swing bot not found.");
  if (s.targetMint) throw new Error("This bot watches one specific token — Buy again doesn't apply here.");
  // Same scope as manualBuyMintNow: traded-before OR owner-added to the watchlist.
  const closed = await storage.listSwingPositions(strategyId, "closed");
  const watched = new Set(s.rebuyMints ?? []);
  if (!closed.some((x) => x.mint === mint) && !watched.has(mint)) {
    throw new Error("Buy now only works on tokens this bot has traded before or that you've added to its watchlist.");
  }
  const stats = await getTokenStats(mint);
  if (!stats || stats.priceUsd <= 0) {
    return {
      symbol: mint.slice(0, 4),
      wouldBuy: false,
      headline: "No live market data for this token right now.",
      facts: ["The bot can't see current price or trading, so it wouldn't buy blind. Try again in a minute."],
    };
  }
  const verdict = judgeEntry(stats, s.minLiquidityUsd, s.style, s.mode === "live", effMinPoolAgeH(s));
  const facts: string[] = [];
  const txH1 = stats.buysH1 + stats.sellsH1;
  const txM5 = stats.buysM5 + stats.sellsM5;
  // Sell-off tells first — this is the exact "it's dumping and I'm about to
  // buy the drop" moment the user got wrecked on.
  if (txH1 >= 10 && stats.sellsH1 > stats.buysH1) {
    facts.push(`More sellers than buyers this hour: ${stats.sellsH1} sells vs ${stats.buysH1} buys.`);
  }
  if (txM5 >= 6 && stats.sellsM5 > stats.buysM5) {
    facts.push(`Still selling in the last 5 minutes: ${stats.sellsM5} sells vs ${stats.buysM5} buys.`);
  }
  if (stats.chgM5 < -2) facts.push(`Price is dropping right now — ${stats.chgM5.toFixed(1)}% in the last 5 minutes.`);
  else if (stats.chgM5 > 15) facts.push(`Price just shot straight up (${stats.chgM5.toFixed(0)}% in 5 min) — the bot reads that as chasing, not entering.`);
  if (stats.chgH1 < -5) facts.push(`Down ${Math.abs(stats.chgH1).toFixed(0)}% in the last hour.`);
  if (stats.chgH24 < -25) facts.push(`Down ${Math.abs(stats.chgH24).toFixed(0)}% over the last 24 hours.`);
  if (stats.liquidityUsd < s.minLiquidityUsd) {
    facts.push(`Thin liquidity pool: $${Math.round(stats.liquidityUsd).toLocaleString()} — easy to get stuck.`);
  }
  // Always attach the bot's own one-line reason so the user sees exactly what
  // the auto-scanner is weighing.
  facts.push(`The bot's read: ${verdict.why}.`);
  // Honesty: this is the ENTRY-SIGNAL check (judgeEntry) on the live tape — it
  // is NOT a promise the auto-scanner would fire this instant (re-entry
  // cooldown, loss cool-off, and downstream rug/impact guards can still hold it
  // back). Word it as "entry check", never "the bot will buy".
  const headline = verdict.ok
    ? `${stats.symbol} passes the bot's entry check right now — but that's the signal, not a guarantee.`
    : `Heads up — ${stats.symbol} FAILS the bot's entry check right now.`;
  return { symbol: stats.symbol, wouldBuy: verdict.ok, headline, facts };
}

// Scanner-page "what would the Swing Bot say?" — the same entry check, run on
// an ARBITRARY mint with a fixed default profile (paper defaults: $20k
// liquidity floor, quick style, standard pool-age minimum). It is bound to no
// strategy, reads no trade history, and touches no keys — safe as a public
// read. Honesty rule carries over: this is the entry-signal check on the live
// tape, not a promise any bot would buy.
export async function scannerTokenCheck(
  mint: string,
): Promise<{ symbol: string; wouldBuy: boolean; headline: string; facts: string[] }> {
  const stats = await getTokenStats(mint);
  if (!stats || stats.priceUsd <= 0) {
    return {
      symbol: mint.slice(0, 4),
      wouldBuy: false,
      headline: "No live market data for this token right now.",
      facts: ["The bot can't see current price or trading, so it wouldn't buy blind. Try again in a minute."],
    };
  }
  const minLiq = 20000;
  const verdict = judgeEntry(stats, minLiq, "quick", false);
  const facts: string[] = [];
  const txH1 = stats.buysH1 + stats.sellsH1;
  const txM5 = stats.buysM5 + stats.sellsM5;
  if (txH1 >= 10 && stats.sellsH1 > stats.buysH1) {
    facts.push(`More sellers than buyers this hour: ${stats.sellsH1} sells vs ${stats.buysH1} buys.`);
  } else if (txH1 >= 10 && stats.buysH1 > stats.sellsH1) {
    facts.push(`More buyers than sellers this hour: ${stats.buysH1} buys vs ${stats.sellsH1} sells.`);
  }
  if (txM5 >= 6 && stats.sellsM5 > stats.buysM5) {
    facts.push(`Still selling in the last 5 minutes: ${stats.sellsM5} sells vs ${stats.buysM5} buys.`);
  }
  if (stats.chgM5 < -2) facts.push(`Price is dropping right now — ${stats.chgM5.toFixed(1)}% in the last 5 minutes.`);
  else if (stats.chgM5 > 15) facts.push(`Price just shot straight up (${stats.chgM5.toFixed(0)}% in 5 min) — the bot reads that as chasing, not entering.`);
  if (stats.chgH1 < -5) facts.push(`Down ${Math.abs(stats.chgH1).toFixed(0)}% in the last hour.`);
  if (stats.chgH24 < -25) facts.push(`Down ${Math.abs(stats.chgH24).toFixed(0)}% over the last 24 hours.`);
  if (stats.liquidityUsd < minLiq) {
    facts.push(`Thin liquidity pool: $${Math.round(stats.liquidityUsd).toLocaleString()} — easy to get stuck.`);
  }
  facts.push(`The bot's read: ${verdict.why}.`);
  const headline = verdict.ok
    ? `${stats.symbol} passes the Swing Bot's entry check right now — that's the signal, not a guarantee.`
    : `${stats.symbol} fails the Swing Bot's entry check right now.`;
  return { symbol: stats.symbol, wouldBuy: verdict.ok, headline, facts };
}

// Manual "Swap": sell one position, then put the freed cash (plus any other
// free SOL) into another held token as a fresh tranche — the user's "all my
// money is deployed but THIS one is running" move, without hand-timing two
// separate taps. Sell first; the buy only happens if the cash actually
// landed. If the buy is then declined (rug/honeypot/impact guard or no
// market data), the sale is NOT undone — the error says so and the cash
// simply stays free for the bot's normal hunting.
export async function manualSwapSwingPosition(
  strategyId: string, sellPositionId: string, buyPositionId: string,
): Promise<{ soldSymbol: string; boughtSymbol: string }> {
  return withStrategyLock(strategyId, async () => {
    const s = await storage.getSwingStrategy(strategyId);
    if (!s) throw new Error("Swing bot not found.");
    if (s.status !== "active") throw new Error("The bot has to be running to swap — press Start first.");
    if (sellPositionId === buyPositionId) throw new Error("Pick two different positions to swap.");
    const positions = await storage.listSwingPositions(strategyId, "open");
    const sellP = positions.find((x) => x.id === sellPositionId);
    const buyP = positions.find((x) => x.id === buyPositionId);
    if (!sellP) throw new Error("The position you want to sell is already closed.");
    if (!buyP) throw new Error("The position you want to add to is already closed.");
    if (sellP.mint === buyP.mint) throw new Error("Those two positions are the same token — nothing to swap.");

    await closePosition(s, sellP, "manual_sell",
      `You pressed Swap — selling ${sellP.symbol} to buy more ${buyP.symbol}.`);

    // Re-read: the sale just changed the paper bankroll / live balance.
    const s2 = await storage.getSwingStrategy(strategyId);
    if (!s2) throw new Error("Swing bot not found.");
    let free: bigint;
    if (s2.mode === "paper") {
      free = BigInt(s2.paperBankrollLamports);
    } else {
      free = await combinedSpendable(s2); // all sub-wallets, each minus its headroom
    }
    if (free < MIN_TRADE_LAMPORTS) {
      throw new Error(`${sellP.symbol} was sold, but the proceeds are too small for another buy — the cash stays in the session wallet.`);
    }
    const stats = await getTokenStats(buyP.mint);
    if (!stats) {
      throw new Error(`${sellP.symbol} was sold, but live market data for ${buyP.symbol} isn't available right now — the cash stays free; tap Buy more in a minute.`);
    }
    // allowStacking=true just for this call (same as Buy more): the held-mint
    // exclusion is bypassed, but rug-risk, honeypot, and impact guards inside
    // openPosition still apply — a conviction buy never bypasses safety.
    const bought = await openPosition({ ...s2, allowStacking: true }, { ...stats, score: 0 }, free, "manual");
    if (!bought) {
      const why = await lastBuyFailureDetail(s2.id, buyP.mint);
      throw new Error(why ? `${sellP.symbol} was sold, but the ${buyP.symbol} buy didn't go through. ${why} The cash stays free.` : `${sellP.symbol} was sold, but the ${buyP.symbol} buy didn't go through — see the activity feed. The cash stays free.`);
    }
    await storage.addSwingEvent({
      strategyId: s.id, positionId: null, kind: "info", mint: buyP.mint, symbol: buyP.symbol,
      detail: `Swap complete — sold ${sellP.symbol} and put ${(Number(free) / LAMPORTS_PER_SOL).toFixed(4)} SOL into ${buyP.symbol} as a fresh tranche with its own stop and exit rules.`,
      solLamports: free.toString(),
    });
    return { soldSymbol: sellP.symbol, boughtSymbol: buyP.symbol };
  });
}

// One watch-mode buy attempt: full bankroll into the target token. Shared by
// the auto-buy tick and the owner's manual "Buy now". Caller must hold the
// strategy lock (the tick already does; manualBuyWatchToken takes it).
async function attemptWatchBuy(fresh: SwingStrategy, entryMode: "auto" | "manual" = "auto"): Promise<{ bought: boolean; note: string; symbol?: string }> {
  let bankroll: bigint;
  if (fresh.mode === "paper") {
    bankroll = BigInt(fresh.paperBankrollLamports);
  } else {
    bankroll = await combinedSpendable(fresh);
  }
  if (bankroll < MIN_TRADE_LAMPORTS) {
    return { bought: false, note: "Waiting for enough funds to buy your token — checking every minute." };
  }
  // Multi-wallet DCA-in: ONE tranche per call — the remaining bankroll is
  // spread evenly over the tranches still to fill, so entries average in
  // over time instead of one all-in buy.
  const tranches = dcaTrancheCount(fresh);
  let sizeLamports = bankroll;
  let trancheNo = 1;
  if (tranches > 1) {
    const openTranches = (await storage.listSwingPositions(fresh.id, "open")).filter((p) => p.mint === fresh.targetMint).length;
    const remaining = tranches - openTranches;
    if (remaining <= 0) {
      return { bought: false, note: "All DCA tranches are filled — managing the exits now." };
    }
    trancheNo = openTranches + 1;
    sizeLamports = bankroll / BigInt(remaining);
    if (sizeLamports < MIN_TRADE_LAMPORTS) sizeLamports = bankroll; // too small to split — use what's left
  }
  const stats = await getTokenStats(fresh.targetMint!);
  if (!stats || stats.priceUsd <= 0) {
    await addSkipEventDeduped(fresh.id, fresh.targetMint!, fresh.targetMint!.slice(0, 6) + "…", "watch_no_data",
      "Can't find live market data for your chosen token yet — retrying every tick until it shows up.");
    return { bought: false, note: "No live market data for your token yet — retrying every minute." };
  }
  const bought = await openPosition(fresh, { ...stats, score: 0, chartNote: "" }, sizeLamports, entryMode);
  return {
    bought,
    symbol: stats.symbol,
    note: bought
      ? (tranches > 1
        ? `Bought ${stats.symbol} — DCA tranche ${trancheNo} of ${tranches} (${(Number(sizeLamports) / LAMPORTS_PER_SOL).toFixed(4)} SOL). Next tranche in ~20 min.`
        : `Bought ${stats.symbol} — babysitting the exit from here.`)
      : `Held off buying ${stats.symbol} this check — see the activity feed for why. Trying again next minute.`,
  };
}

// ── Watch-mode comeback re-entry (opt-in, `reentry` flag) ────────────────
// "Sell smart, buy back in on the dip that turns" for a hand-picked token
// (user's CASH AT ask). The dip-turn timing is judgeComeback (buyers retake
// the tape); the brakes below are the "safer" half of the ask:
//   • MAX_BUYS — a churn ceiling per run, raised 3 → 12 so a real runner can
//     be ridden through many pullbacks; it is NOT meant to stop a winner.
//   • LOSS_STOP — the actual "coin is dying" auto-stop: 2 losing round trips
//     in a row ends the run, so conviction never turns into feeding a rug.
//   • COOLDOWN — a short pause after each exit so it never re-buys the same dump.
// A tokens_sent_home settlement (sell failed, raw tokens swept to the owner)
// always ends the run — the SOL never came back, nothing left to re-enter with.
const WATCH_REENTRY_MAX_BUYS = 12;
const WATCH_REENTRY_COOLDOWN_MS = 10 * 60 * 1000;
const WATCH_REENTRY_LOSS_STOP = 2;

// Positions belonging to the CURRENT run. A bot restarted from
// stopped/completed (window still open) stamps `restartedAt`; older
// positions are history from a previous run and must not make watch-mode
// logic instantly re-complete or count against re-entry brakes.
function currentRunPositions(s: SwingStrategy, all: SwingPosition[]): SwingPosition[] {
  if (!s.restartedAt) return all;
  const cutoff = new Date(s.restartedAt).getTime();
  return all.filter((p) => new Date(p.openedAt).getTime() >= cutoff);
}

// Decide whether a reentry watch bot may keep going after a close.
// done=true → wrap up (with a plain-language reason); waitNote → cooling
// down this tick; neither → brakes clear, a re-buy may be attempted.
function judgeWatchReentry(
  s: SwingStrategy,
  allPositions: SwingPosition[],
): { done: boolean; doneReason?: string; waitNote?: string } {
  if (allPositions.some((p) => p.exitReason === "tokens_sent_home")) {
    return { done: true, doneReason: "tokens were sent home in kind — nothing left to re-enter with" };
  }
  // With multi-wallet DCA every tranche counts as a "buy", so the churn
  // ceiling scales with the tranche count — same number of ROUNDS either way.
  const maxBuys = WATCH_REENTRY_MAX_BUYS * dcaTrancheCount(s);
  if (allPositions.length >= maxBuys) {
    return { done: true, doneReason: `used all ${maxBuys} buys for this run` };
  }
  if (s.consecutiveLosses >= WATCH_REENTRY_LOSS_STOP) {
    return { done: true, doneReason: `${WATCH_REENTRY_LOSS_STOP} losing trades in a row — stopping the bleed` };
  }
  const lastClose = allPositions.reduce((max, p) => {
    const t = p.closedAt ? new Date(p.closedAt).getTime() : 0;
    return t > max ? t : max;
  }, 0);
  const since = Date.now() - lastClose;
  if (lastClose > 0 && since < WATCH_REENTRY_COOLDOWN_MS) {
    const minsLeft = Math.ceil((WATCH_REENTRY_COOLDOWN_MS - since) / 60_000);
    return { done: false, waitNote: `Sold — cooling down ${minsLeft} more min before considering a buy-back (avoids re-buying the same dump).` };
  }
  return { done: false };
}

// Positive comeback evidence — ALL must hold. Missing/unknown market data is
// NEVER a buy signal (same invariant direction as entries elsewhere: buys
// need positive proof, exits never fire on missing data).
function judgeComeback(stats: CandidateStats | null): { yes: boolean; note: string } {
  if (!stats || stats.priceUsd <= 0) return { yes: false, note: "No live market data this check." };
  const txnsM5 = stats.buysM5 + stats.sellsM5;
  const txnsH1 = stats.buysH1 + stats.sellsH1;
  if (txnsM5 < 8) return { yes: false, note: "Tape is quiet right now." };
  if (stats.buysM5 <= stats.sellsM5) return { yes: false, note: "Sellers still lead the last 5 minutes." };
  if (txnsH1 >= 20 && stats.buysH1 <= stats.sellsH1) return { yes: false, note: "Buyers haven't retaken the hour yet." };
  if (stats.chgM5 <= 0) return { yes: false, note: "Price isn't turning up yet." };
  if (stats.chgM5 > 15) return { yes: false, note: "Move is too vertical to chase — waiting for a calmer entry." };
  // Same thin-tape floor as every other entry lane: a comeback in a market
  // that's asleep relative to its pool depth has nothing behind it.
  if (stats.liquidityUsd > 0 && stats.volH1Usd < stats.liquidityUsd * ENTRY_MIN_VOL_TO_LIQ_H1) {
    return { yes: false, note: "Trading is too quiet for this pool's size — a real comeback needs volume behind it." };
  }
  return { yes: true, note: `buyers back in charge (${stats.buysM5} buys vs ${stats.sellsM5} sells in 5m, +${stats.chgM5.toFixed(1)}%)` };
}

// Owner pressed "Buy now" on a manual-buy watch bot. Runs under the strategy
// lock so it can never race the tick or a concurrent Stop. Single-shot: once
// the bot has EVER bought (open or closed), a second manual buy is refused —
// unless `reentry` is on, in which case a re-buy is allowed while the
// re-entry brakes (max buys, loss stop, cooldown) still allow it.
export async function manualBuyWatchToken(strategyId: string): Promise<{ symbol: string }> {
  return withStrategyLock(strategyId, async () => {
    const s = await storage.getSwingStrategy(strategyId);
    if (!s) throw new Error("Swing bot not found.");
    if (!s.targetMint) throw new Error("This bot isn't a watch bot — it picks tokens on its own.");
    if (!s.manualBuy) throw new Error("This bot buys automatically — the manual Buy button isn't for it.");
    if (s.status !== "active") throw new Error(`Bot is ${s.status} — press Start first, then Buy.`);
    // Run-window contract: never open a trade after the window has ended,
    // even if the completing tick hasn't fired yet.
    if (new Date(s.windowEndAt).getTime() <= Date.now()) {
      throw new Error("This bot's run window has ended — it's wrapping up and sweeping funds home. Start a new bot to buy.");
    }
    const all = await storage.listSwingPositions(s.id);
    const openNow = all.filter((p) => p.status === "open").length;
    const tranches = dcaTrancheCount(s);
    if (openNow >= tranches) {
      throw new Error(tranches > 1
        ? "All DCA tranches are filled — sell first if you want to buy again."
        : "This bot is already holding the token — sell first if you want out.");
    }
    const run = currentRunPositions(s, all);
    // While tranches remain open, another Buy just fills the next tranche.
    // The single-shot / re-entry brakes only apply to a FRESH round (nothing
    // currently open).
    if (run.length > 0 && openNow === 0) {
      if (!s.reentry) throw new Error("This bot already bought its token — watch bots make one buy per run.");
      const verdict = judgeWatchReentry(s, run);
      if (verdict.done) throw new Error(`No more buy-backs this run: ${verdict.doneReason}.`);
      if (verdict.waitNote) throw new Error(verdict.waitNote);
    }
    const attempt = await attemptWatchBuy(s, "manual");
    if (!attempt.bought) {
      // Surface the real reason instead of a silent no-op — the activity
      // feed has the detail (honeypot guard, no route, not enough funds…).
      throw new Error(`Buy didn't go through: ${attempt.note}`);
    }
    const symbol = attempt.symbol ?? "your token";
    await storage.updateSwingStrategy(s.id, { lastScanAt: new Date(), lastScanNote: `Bought ${symbol} on your signal — babysitting the exit from here.` });
    return { symbol };
  });
}

// "Still scanning, nothing qualified" heartbeat — at most one every 10 min
// per strategy (user's ask: 30 min felt like the bot was asleep) while still
// keeping the feed readable.
const scanIdleLastLogged = new Map<string, number>();
const SCAN_IDLE_LOG_MS = 10 * 60 * 1000;

async function addScanIdleEvent(strategyId: string, considered: number, sizeLamports: bigint, style: string = "quick"): Promise<void> {
  const last = scanIdleLastLogged.get(strategyId);
  if (last && Date.now() - last < SCAN_IDLE_LOG_MS) return;
  scanIdleLastLogged.set(strategyId, Date.now());
  if (scanIdleLastLogged.size > 500) {
    const cutoff = Date.now() - SCAN_IDLE_LOG_MS;
    scanIdleLastLogged.forEach((v, k) => { if (v < cutoff) scanIdleLastLogged.delete(k); });
  }
  await storage.addSwingEvent({
    strategyId, positionId: null, kind: "info", mint: null, symbol: null,
    detail: style === "dip"
      ? `Still hunting — scanned ${considered} candidates this pass and none met the dip-buy bar (established ≥6 days, down 12–70% on the day, stopped falling, still liquid and trading). Your ${(Number(sizeLamports) / LAMPORTS_PER_SOL).toFixed(4)} SOL free cash stays safe until something qualifies. Checking every minute.`
      : `Still hunting — scanned ${considered} candidates this pass and none met the entry bar (momentum + accelerating volume + real liquidity + chart check). Your ${(Number(sizeLamports) / LAMPORTS_PER_SOL).toFixed(4)} SOL free cash stays safe until something qualifies. Checking every minute.`,
    solLamports: null,
  }).catch(() => {});
}

// ─── Per-strategy tick ───────────────────────────────────────────────────────
// 30s base + the 20s scheduler tick granularity = checks land every ~30-40s.
// Faster than this buys little: DexScreener stats are cached 60s (exit tells
// would just re-read the same data) and it would double-spend the shared API
// budgets. The executable PumpApi sell simulation IS fresh every pass — stops/trailing react
// on this cadence.
const CHECK_INTERVAL_SECONDS = 30;

// ─── Hot watch (fast lane) ───────────────────────────────────────────────────
// The 30-40s cadence is where profits leak on fast movers: user's ANSUM peaked
// ~+19% with a floor near +10, yet filled at +1.6% because the whole dump
// happened between two checks (same failure shape as AVAJAK's −26% stop fill).
// Quick scan positions that are ARMED (peak ≥ profit-protect arm) or NEAR THE
// STOP (pnl ≤ −3%) get a fast lane: every 10s, re-simulate (PumpApi only — no
// DexScreener/candles, so no shared-budget spend) and act on PRICE-FLOOR rules
// alone. judgeExit gets cache-only stats (peekTokenStats — the slow lane's
// 60s DexScreener cache, never a fresh fetch) and chart = null: this lets the
// runner exception and the quick sellers_took_over reversal tell work on the
// same data the full tick saw, while a cold/stale cache degrades safely to
// the tight price floors. Anything needing FRESH market data (early_cut,
// momentum_stop, max_hold's healthy-chart extension, volume reads) is filtered
// by the whitelist below and left to the full tick — the fast lane must never
// make a WORSE-informed version of those calls (e.g. quick's 24h max-hold
// bends on a healthy chart; with chart=null the clock would win wrongly).
// Race-safety: runs under the same withStrategyLock as ticks/stops, and
// closePosition's CAS makes any residual overlap a harmless no-op.
const FAST_GUARD_MS = 10_000;
const HOT_TTL_MS = 3 * 60_000; // re-earned every full tick while still hot
const HOT_LOSS_PCT = -3;
// A fresh buy is the highest-risk window: a pump.fun token can gap 8-13% in a
// single 20s full-tick, so the stop "fires" but at -8% instead of -4.5%. Keep
// every just-opened position in the 10s fast lane (hard price-floor enforced
// there) for its first minutes so the stop actually catches the drop near the
// cap — regardless of whether it's down 3% yet. User-hit: live buy-ins were
// selling at -8%+ though the 4.5% stop was "applying".
const FRESH_HOT_WINDOW_MS = 5 * 60_000;
const FAST_GUARD_MAX_QUOTES = 12; // PumpApi simulation budget cap per pass
const FAST_LANE_REASONS = new Set(["stop_loss", "take_profit", "small_win_take", "small_win_protect", "trailing_stop", "profit_protect", "breakeven_guard", "sellers_took_over", "momentum_shift"]);
const AUTOMATIC_FAST_EMERGENCY_STOP_PCT = 20;
const hotStrategies = new Map<string, number>(); // strategyId -> hot-until
const fastGuardBusy = new Set<string>();

export function automaticFastStopMustSell(pnlPct: number): boolean {
  return Number.isFinite(pnlPct) && pnlPct <= -AUTOMATIC_FAST_EMERGENCY_STOP_PCT;
}

export function effectivePositionMaxHoldHours(
  unlimitedWindow: boolean,
  automaticRecoveryHold: boolean,
  configuredHours: number,
): number {
  return unlimitedWindow || automaticRecoveryHold
    ? Number.POSITIVE_INFINITY
    : configuredHours;
}

// Put a strategy's positions in the 10s fast lane immediately (called right
// after a buy lands so the fresh position is watched from the first seconds,
// not only once the next 20s tick sees it).
function markStrategyHot(id: string): void {
  hotStrategies.set(id, Date.now() + HOT_TTL_MS);
}

function markHotIfNeeded(s: SwingStrategy, p: SwingPosition, value: bigint, high: bigint): void {
  if (s.targetMint || s.universe === "stocks") return; // fast lane is crypto scan only
  const solIn = BigInt(p.solInLamports);
  if (solIn <= 0n) return;
  const pnlPct = (Number(value - solIn) / Number(solIn)) * 100;
  const peakPct = (Number(high - solIn) / Number(solIn)) * 100;
  const freshMs = Date.now() - new Date(p.openedAt).getTime();
  // Once a trade has earned breakeven protection, keep it in the 10-second
  // lane so a fade is caught near entry rather than several percent below it.
  if (peakPct >= BREAKEVEN_ARM_PCT || pnlPct <= HOT_LOSS_PCT || freshMs < FRESH_HOT_WINDOW_MS) {
    hotStrategies.set(s.id, Date.now() + HOT_TTL_MS);
  }
}

async function fastGuardPass(): Promise<void> {
  if (!isSwingConfigured() || hotStrategies.size === 0) return;
  let quotesLeft = FAST_GUARD_MAX_QUOTES;
  for (const [id, hotUntil] of Array.from(hotStrategies.entries())) {
    if (hotUntil < Date.now()) { hotStrategies.delete(id); continue; }
    if (quotesLeft <= 0) break;
    if (fastGuardBusy.has(id) || inFlightBusy(id)) continue; // full tick or fast pass already on it
    fastGuardBusy.add(id);
    // Sequential on purpose: the quote budget is then exact, and a 10s pass
    // never floods the per-strategy lock queues (architect suggestion).
    await withStrategyLock(id, async () => {
      const s = await storage.getSwingStrategy(id);
      if (!s || s.status !== "active") { hotStrategies.delete(id); return; }
      const open = await storage.listSwingPositions(id, "open");
      if (open.length === 0) { hotStrategies.delete(id); return; }
      const closedThisPass = new Set<string>();
      for (const p of open) {
        if (quotesLeft-- <= 0) break;
        const value = await quotePositionValue(p, s.slippageBps);
        if (value == null) continue; // unquotable — never guess in the fast lane
        let high = BigInt(p.highWaterLamports);
        if (value > high) high = value;
        await storage.updateSwingPosition(p.id, {
          lastValueLamports: value.toString(),
          highWaterLamports: high.toString(),
        });
        p.lastValueLamports = value.toString();
        p.highWaterLamports = high.toString();
        const verdict = judgeExit(s, p, value, high, peekTokenStats(p.mint), null, false);
        if (verdict.sell && FAST_LANE_REASONS.has(verdict.reason)) {
          // Automatic scanner stops must use the fresh volume/liquidity/chart
          // read in the full tick. The fast lane has only a price quote plus
          // stale cached tape, so letting it fire the stop recreates the exact
          // "sold the wick, then it recovered" behavior Automatic is meant to
          // avoid. Owner-selected fixed percentages remain immediate.
          if (
            verdict.reason === "stop_loss" &&
            !s.targetMint &&
            s.universe !== "stocks" &&
            s.stopRoomPct == null
          ) {
            const solIn = BigInt(p.solInLamports);
            const fastPnlPct = solIn > 0n ? (Number(value - solIn) / Number(solIn)) * 100 : 0;
            // Ordinary crossings wait for a full fresh evidence read, but a
            // rapid plunge can never run beyond Automatic's widest 15% room.
            if (!automaticFastStopMustSell(fastPnlPct)) continue;
          }
          // DCA-out pacing: non-emergency exits leave one tranche at a time.
          if (await shouldDeferTrancheExit(s, p, verdict.reason, closedThisPass)) continue;
          await closePosition(s, p, verdict.reason, verdict.detail);
          closedThisPass.add(p.mint);
        }
      }
    })
      .catch((e) => console.error(`[swing] fast guard failed for ${id}:`, e?.message ?? e))
      .finally(() => fastGuardBusy.delete(id));
  }
}

async function processSwingTick(s: SwingStrategy): Promise<void> {
  s = await ensurePaperDepositFee(s);
  const advance = async (note?: string) => {
    const fresh = await storage.getSwingStrategy(s.id);
    if (!fresh || fresh.status !== "active") return; // don't resurrect a stopped bot
    await storage.updateSwingStrategy(s.id, {
      nextRunAt: new Date(Date.now() + CHECK_INTERVAL_SECONDS * 1000),
      // Heartbeat for the UI: prove this pass ran and say what it did.
      lastScanAt: new Date(),
      ...(note ? { lastScanNote: note } : {}),
    });
  };

  // Window over → liquidate, sweep, complete.
  if (new Date(s.windowEndAt).getTime() <= Date.now()) {
    await storage.updateSwingStrategy(s.id, { status: "completed", nextRunAt: null, ...accrueActiveTime(s) });
    await liquidateAndSweep(s, "window_end");
    await storage.addSwingEvent({
      strategyId: s.id, positionId: null, kind: "info", mint: null, symbol: null,
      detail: s.mode === "live"
        ? "Run window finished. All positions closed and funds returned to your wallet."
        : "Run window finished. All paper positions closed — final results are in.",
      solLamports: null,
    });
    return;
  }

  // First pass on a fresh bot: stamp the heartbeat IMMEDIATELY, before any
  // market-data work. The first full scan can take minutes (public APIs,
  // sequential batches) — without this the UI shows "waiting for the first
  // check-in" the whole time and looks frozen even when everything is fine.
  if (!s.lastScanAt) {
    await storage.updateSwingStrategy(s.id, {
      lastScanAt: new Date(),
      lastScanNote: "First check-in — sizing up the market now. The first full scan can take a few minutes.",
    });
  }

  const open = await storage.listSwingPositions(s.id, "open");

  // 1) Manage open positions: revalue, ratchet high-water, judge exits.
  const closedThisPass = new Set<string>();
  for (const p of open) {
    // RUG GUARD runs FIRST — before the sell simulation. In a real drain PumpApi
    // often has NO route, which makes the position unquotable; the old
    // "unquotable → skip this tick" guard would then skip every exit check
    // exactly when reacting matters most. The drain check needs no quote.
    const drainDetail = await checkLiquidityDrain(p);
    if (drainDetail) {
      // A confirmed liquidity drain always overrides recovery hold. For paper,
      // no executable route after a drain is itself the honest zero-value
      // outcome; otherwise an unquotable rug would stay open forever.
      await closePosition(s, p, "liquidity_drained", drainDetail, {
        paperFallbackValueLamports: 0n,
      });
      continue;
    }
    const value = await quotePositionValue(p, s.slippageBps);
    if (value == null) continue; // unquotable this tick — skip, don't guess
    let high = BigInt(p.highWaterLamports);
    if (value > high) high = value;
    await storage.updateSwingPosition(p.id, {
      lastValueLamports: value.toString(),
      highWaterLamports: high.toString(),
    });
    // Keep the in-memory snapshot in sync — closePosition's dust-hold check
    // reads p.lastValueLamports and must see THIS tick's quote, not last tick's.
    p.lastValueLamports = value.toString();
    p.highWaterLamports = high.toString();
    // Recovery and breakdown decisions must use a fresh held-position sample,
    // not the scanner's up-to-one-minute cache.
    const stats = await getTokenStats(p.mint, { forceFresh: true });
    // Chart read (cached candles) — additive evidence for the exit judgment.
    const chart = stats?.pairAddress ? readChart(await getCandles(stats.pairAddress)) : null;
    // Dollar-weighted flow (cached, fail-soft null) — lets the exit judgment
    // see WHOSE money is bigger, not just how many wallets clicked. Fetched
    // only for HELD positions on the full tick, so call volume stays tiny.
    const flow = stats?.pairAddress ? await getDollarFlow(stats.pairAddress, p.mint) : null;
    const verdict = judgeExit(s, p, value, high, stats, chart, true, flow);
    if (verdict.sell) {
      // DCA-out pacing: non-emergency exits leave one tranche per pass
      // (~90s apart) — emergencies (stop-loss, drain, rug) all go at once.
      if (await shouldDeferTrancheExit(s, p, verdict.reason, closedThisPass)) continue;
      await closePosition(s, p, verdict.reason, verdict.detail);
      closedThisPass.add(p.mint);
      continue;
    }
    // Still open — armed winners and near-stop positions earn fast-lane
    // watching (10s re-quotes) until the next full tick re-evaluates.
    markHotIfNeeded(s, p, value, high);
  }

  // 2) Look for a new entry if there's a free slot + bankroll.
  const fresh = await storage.getSwingStrategy(s.id);
  if (!fresh || fresh.status !== "active") return;
  const openNow = await storage.listSwingPositions(s.id, "open");

  // ── Watch mode (targetMint): babysit ONE chosen token ──
  // Buy it with the full bankroll, run the normal exit engine on it, and
  // when the position closes (any reason) the job is done — complete the
  // run and (live) sweep everything home. No scanning. Exception: with
  // `reentry` on, a close does NOT complete the run — the bot keeps watching
  // for a proven comeback (buyers retake the tape + active volume) and may
  // buy back in, bounded by hard brakes (max buys, consecutive-loss stop).
  if (fresh.targetMint) {
    if (openNow.length > 0) {
      // Multi-wallet DCA-in: while tranches remain unfilled, keep averaging
      // in — the next tranche buys only after the spacing gap since the
      // newest buy. Auto bots only; manual-buy bots fill tranches with the
      // owner's "Buy now" taps instead.
      const tranches = dcaTrancheCount(fresh);
      if (!fresh.manualBuy && openNow.length < tranches) {
        const newestBuyAt = Math.max(...openNow.map((p) => new Date(p.openedAt).getTime()));
        const sinceLastBuy = Date.now() - newestBuyAt;
        if (sinceLastBuy >= DCA_TRANCHE_SPACING_MS) {
          const attempt = await attemptWatchBuy(fresh);
          await advance(attempt.bought ? attempt.note : `Holding ${openNow.length} of ${tranches} DCA tranches — ${attempt.note}`);
          return;
        }
        const minsLeft = Math.ceil((DCA_TRANCHE_SPACING_MS - sinceLastBuy) / 60_000);
        let dcaNote = `Holding ${openNow.length} of ${tranches} DCA tranches — next buy-in check in ~${minsLeft} min. Exit rules run on every tranche meanwhile.`;
        const weather = await getMarketWeather();
        if (weather?.mood === "red") dcaNote += ` FYI: ${weather.facts}`;
        await advance(dcaNote);
        return;
      }
      // holding — exits handled above. On a market-wide red day, add plain
      // FACTS (never advice): when everything is falling together, the user
      // should know it's the whole market, not just their token.
      let holdNote = tranches > 1
        ? `Holding all ${tranches} DCA tranches — checking the exit rules (stop-loss, profit lock, sell-off tells) every minute. Exits go tranche by tranche too.`
        : "Holding your token — checking the exit rules (stop-loss, profit lock, sell-off tells) every minute.";
      const weather = await getMarketWeather();
      if (weather?.mood === "red") holdNote += ` FYI: ${weather.facts}`;
      await advance(holdNote);
      return;
    }
    if (fresh.universe === "stocks" && getUsEquityMarketSession().state === "closed") {
      await advance("U.S. market closed — your chosen xStock is still being watched, but no new paper buy will happen until fresh market-open data is available.");
      return;
    }
    const allPositions = currentRunPositions(fresh, await storage.listSwingPositions(fresh.id));
    const everBought = allPositions.length > 0;
    if (everBought) {
      // Position(s) closed. Re-entry keeps the run alive ONLY while every
      // brake allows it; anything else wraps up exactly like single-shot.
      const verdict = fresh.reentry ? judgeWatchReentry(fresh, allPositions) : null;
      if (!verdict || verdict.done) {
        await storage.updateSwingStrategy(fresh.id, { status: "completed", nextRunAt: null, ...accrueActiveTime(fresh) });
        await liquidateAndSweep(fresh, "window_end");
        const why = verdict?.doneReason ? ` (${verdict.doneReason})` : "";
        await storage.addSwingEvent({
          strategyId: fresh.id, positionId: null, kind: "info", mint: fresh.targetMint, symbol: null,
          detail: fresh.mode === "live"
            ? `Watch complete${why} — funds are on their way back to your wallet.`
            : `Watch complete${why} — final paper results are in.`,
          solLamports: null,
        });
        return;
      }
      if (verdict.waitNote) {
        // Cooling down after the last exit — no re-buy yet.
        await advance(verdict.waitNote);
        return;
      }
      // Brakes clear. Manual-buy bots re-arm and wait for the owner again;
      // auto bots re-buy ONLY on positive comeback evidence.
      if (fresh.manualBuy) {
        await advance("Sold — armed again and watching. Press \"Buy now\" if you want back in before the window ends.");
        return;
      }
      const stats = await getTokenStats(fresh.targetMint);
      const comeback = judgeComeback(stats);
      if (!comeback.yes) {
        await advance(`Sold — still watching for a real comeback before buying back in. ${comeback.note}`);
        return;
      }
      const attempt = await attemptWatchBuy(fresh);
      await advance(attempt.bought ? `Comeback spotted (${comeback.note}) — bought back in. ${attempt.note}` : attempt.note);
      return;
    }
    // Manual-buy watch bot: NEVER buys on its own — it sits armed until the
    // owner presses "Buy now" (which runs manualBuyWatchToken under this same
    // lock). Exits are still fully automatic once the position exists.
    if (fresh.manualBuy) {
      await advance("Armed and waiting for you — press \"Buy now\" on this card when you want in. Exits run automatically after that.");
      return;
    }
    // Not bought yet — buy the chosen token now (retries every tick until
    // market data + a route exist; missing data is never a silent stop).
    const attempt = await attemptWatchBuy(fresh);
    await advance(attempt.note);
    return;
  }

  let scanNote = openNow.length > 0
    ? `All ${openNow.length} position${openNow.length === 1 ? "" : "s"} being managed — watching the exit rules every minute.`
    : "Checked in — waiting for funds or a free slot.";
  // Loss-brake cool-off: no NEW buys while it's active — but everything else
  // in this pass (exit checks above, heartbeat below) keeps running.
  const coolMsLeft = fresh.lossCooldownUntil
    ? new Date(fresh.lossCooldownUntil).getTime() - Date.now()
    : 0;
  if (coolMsLeft > 0) {
    const minsLeft = Math.ceil(coolMsLeft / 60_000);
    scanNote = openNow.length > 0
      ? `Cooling off after a losing streak — ${minsLeft} more min before new buys. The ${openNow.length} open position${openNow.length === 1 ? "" : "s"} keep${openNow.length === 1 ? "s" : ""} full exit protection meanwhile.`
      : `Cooling off after a losing streak — ${minsLeft} more min before the bot hunts again. Your cash sits safe until then.`;
    await advance(scanNote);
    return;
  }
  // Bankroll first — the live position count adapts to it (below).
  // Live counts ALL sub-wallets (each with its own headroom) so a spread
  // deposit still reads as one bankroll.
  let bankroll: bigint;
  if (fresh.mode === "paper") {
    bankroll = BigInt(fresh.paperBankrollLamports);
  } else {
    bankroll = await combinedSpendable(fresh);
  }
  // Respect the owner's chosen position count EXACTLY (user's explicit ask:
  // "1 position = put all my SOL into one token"). The old forced 5-way spread
  // is gone — the owner now owns the concentration/rug tradeoff via the
  // position-count slider. We still clamp DOWN to what the bankroll can
  // actually split above the tradable minimum, so a tiny deposit deploys
  // instead of freezing on an impossible split. (Paper already used the raw
  // count.) The per-buy impact guard + the single-wallet spendable cap in
  // openPosition remain the natural brakes on an oversized all-in buy.
  let effMaxPositions = fresh.maxPositions;
  if (fresh.mode === "live") {
    const maxTradableSplit = Math.max(1, Number(bankroll / MIN_TRADE_LAMPORTS));
    effMaxPositions = Math.min(fresh.maxPositions, maxTradableSplit);
  }
  // Reduced-entry top-up: a position whose buy was shrunk to fit the pool may
  // earn ONE same-token second tranche even when all slots are full (the
  // owner's ask: "don't lose the pick just because the slice was too big").
  // Gated by the SAME proven-winner rules as DCA stacking — ≥ 30 min since the
  // last buy of that mint AND the combined tranches up ≥ +5% — checked below.
  // Not for "ask me first" bots (approval flow keeps its own slot accounting).
  const mayTopUp = !fresh.targetMint && !fresh.requireApproval
    && openNow.some((p) => p.entryReduced === true)
    && bankroll >= MIN_TRADE_LAMPORTS;
  if (openNow.length < effMaxPositions || mayTopUp) {
    // Cooldown set: don't chase a token we just exited. Winners get a short
    // cooldown (re-entry allowed if it re-passes all entry filters); losses
    // and swept-home positions get the long one.
    const all = await storage.listSwingPositions(s.id);
    const recentlyExited = new Set(
      all.filter((p) => {
        if (p.status !== "closed" || !p.closedAt) return false;
        const sinceClose = Date.now() - new Date(p.closedAt).getTime();
        const wasWin =
          p.exitReason !== "stop_loss" &&
          p.exitReason !== "tokens_sent_home" &&
          BigInt(p.solOutLamports ?? "0") > BigInt(p.solInLamports);
        const winCooldownMs =
          fresh.style === "quick" ? REENTRY_COOLDOWN_WIN_QUICK_MS : REENTRY_COOLDOWN_WIN_MS;
        return sinceClose < (wasWin ? winCooldownMs : REENTRY_COOLDOWN_LOSS_MS);
      }).map((p) => p.mint),
    );
    // Loss brake for the starred-token comeback lane: a mint whose LATEST exit
    // was a loss within the last hour may not comeback-rebuy, star or no star.
    const recentLossExits = computeRecentLossExits(all);
    const openMints = new Set(openNow.map((p) => p.mint));
    // DCA stacking: when enabled, a held token may win a free slot again —
    // but only when it has EARNED it: the last buy of that mint must be ≥ 30
    // minutes old AND the combined open tranches must be up ≥ +5% right now.
    // "Add to proven winners only" — never double an unproven position
    // (user's ANSEM case: same token bought twice 37 seconds apart, both
    // tranches bled to the stop). Unproven held mints are excluded exactly
    // like non-stacking mode. Each tranche keeps its own cost basis and exits.
    // Mints that may take a reduced-entry top-up right now (proven + spaced,
    // one top-up max — never an endless ladder of tranches).
    const reducedTopUpMints = new Set<string>();
    const excludeMints = new Set<string>();
    {
      const byMint = new Map<string, typeof openNow>();
      for (const p of openNow) {
        const arr = byMint.get(p.mint) ?? [];
        arr.push(p);
        byMint.set(p.mint, arr);
      }
      for (const [mint, tranches] of Array.from(byMint.entries())) {
        const hasReduced = tranches.some((p) => p.entryReduced === true);
        // A held mint may win another slot ONLY via DCA stacking (owner opted
        // in) or via a reduced entry earning its single top-up — and the
        // top-up route needs mayTopUp too (never for "ask me first" bots or
        // watch mode, whose buy paths can't book a second tranche). Everything
        // else stays excluded exactly as before.
        const stackable = fresh.allowStacking || (hasReduced && tranches.length < 2 && mayTopUp);
        if (!stackable) {
          excludeMints.add(mint);
          continue;
        }
        const newestBuyAt = Math.max(...tranches.map((p) => new Date(p.openedAt).getTime()));
        const totalIn = tranches.reduce((a, p) => a + BigInt(p.solInLamports), 0n);
        const totalNow = tranches.reduce((a, p) => a + BigInt(p.lastValueLamports ?? p.solInLamports), 0n);
        const spaced = Date.now() - newestBuyAt >= STACK_MIN_SPACING_MS;
        const provenWinner = totalIn > 0n && totalNow >= totalIn + (totalIn * BigInt(STACK_MIN_PROFIT_PCT)) / 100n;
        if (!(spaced && provenWinner)) excludeMints.add(mint);
        else if (!fresh.allowStacking && mayTopUp) reducedTopUpMints.add(mint);
      }
    }
    // Bonus-slot mode: slots are EXACTLY full, but a reduced-entry position
    // earned its top-up — allow ONE extra tranche, restricted to exactly
    // those mints. Strict equality caps the whole book at maxPositions + 1:
    // once any bonus tranche exists (openNow > cap), no further bonus opens,
    // even if a second reduced mint qualifies later.
    const bonusTopUp = openNow.length === effMaxPositions && reducedTopUpMints.size > 0;

    // Sizing: split the CURRENT bankroll across remaining slots (compounds).
    // In bonus-slot mode the whole free bankroll (the part the reduced buy
    // left unspent) is the top-up budget; the impact guard shrinks it again
    // if the pool still can't take it.
    const slots = bonusTopUp ? 1n : BigInt(effMaxPositions - openNow.length);
    const size = slots > 0n ? bankroll / slots : 0n;

    if (size >= MIN_TRADE_LAMPORTS) {
      const rebuySet = new Set((fresh.rebuyMints ?? []).filter((m) => !openMints.has(m)));
      // Automatic paper tokenized-stock bots can prepare during closed hours
      // from the final preserved underlying-market snapshot. This is a PLAN,
      // never a stale-price fill: no paper bankroll moves until the first open
      // tick re-fetches live data and passes the normal entry + execution path.
      if (fresh.mode === "paper" && fresh.universe === "stocks" && !fresh.requireApproval) {
        const marketSession = getUsEquityMarketSession();
        const plannedSignals = await storage.listSwingBuySignals(fresh.id, "planned");
        for (const signal of plannedSignals) excludeMints.add(signal.mint);

        if (marketSession.state === "unavailable") {
          scanNote = `Stock schedule unavailable — ${marketSession.calendarStatus.message} No practice cash is spent.`;
          await advance(scanNote);
          return;
        }

        if (marketSession.state === "closed") {
          const planRoom = Math.max(0, effMaxPositions - openNow.length - plannedSignals.length);
          if (planRoom > 0) {
            const plan = await findClosedMarketStockPlanCandidate(fresh, excludeMints, recentlyExited);
            if (plan) {
              const observed = plan.marketDataObservedAt
                ? new Date(plan.marketDataObservedAt).toISOString()
                : "the last available close";
              const created = await storage.createSwingBuySignalIfNonePending({
                strategyId: fresh.id,
                mint: plan.mint,
                symbol: plan.tokenSymbol,
                status: "planned",
                reason: `Closing snapshot (${observed}): ${plan.underlyingTicker} finished up ${(plan.priceChange24hPct ?? 0).toFixed(2)}%, with $${Math.round(plan.liquidityUsd ?? 0).toLocaleString()} token liquidity and $${Math.round(plan.volume24hUsd ?? 0).toLocaleString()} daily volume.`,
              });
              if (created) {
                await storage.addSwingEvent({
                  strategyId: fresh.id, positionId: null, kind: "info", mint: plan.mint, symbol: plan.tokenSymbol,
                  detail: `Planned ${plan.tokenSymbol} for the next U.S. market open using the final closing snapshot. No practice cash has been spent. The bot will recheck the live setup before buying.`,
                  solLamports: null,
                });
              }
            }
          }
          const queued = await storage.listSwingBuySignals(fresh.id, "planned");
          scanNote = queued.length > 0
            ? `Market closed — ${queued.length} stock pick${queued.length === 1 ? "" : "s"} planned for the open. No practice cash is spent until each setup passes a fresh opening check.`
            : "Market closed — checked the final stock signals, but none were strong enough to plan for the open. Practice cash stays safe.";
          await advance(scanNote);
          return;
        }

        const plan = plannedSignals[0];
        if (plan) {
          const stats = await getTokenStats(plan.mint, { forceFresh: true });
          const verdict = stats ? judgeStockEntry(stats, fresh.minLiquidityUsd) : { ok: false, why: "fresh opening data is not ready" };
          if (!stats || !verdict.ok) {
            await storage.updateSwingBuySignalStatus(plan.id, "expired");
            await storage.addSwingEvent({
              strategyId: fresh.id, positionId: null, kind: "info", mint: plan.mint, symbol: plan.symbol,
              detail: `Skipped the planned ${plan.symbol} buy at the open: ${verdict.why}. No practice cash was spent.`,
              solLamports: null,
            });
            await advance(`Opening check skipped planned ${plan.symbol}: ${verdict.why}. Looking again next minute.`);
            return;
          }
          const pick: ScoredCandidate = { ...stats, score: scoreStockCandidate(stats) };
          const bought = await openPosition(fresh, pick, size, "auto", { topUp: openMints.has(pick.mint) });
          await storage.updateSwingBuySignalStatus(plan.id, bought ? "approved" : "expired");
          await advance(bought
            ? `Opening check confirmed planned ${plan.symbol} — bought it with the normal paper fill and exit rules.`
            : `Opening check held off planned ${plan.symbol} — see the activity feed for why.`);
          return;
        }
      }
      if (fresh.mode === "paper" && fresh.universe === "stocks" && fresh.requireApproval
          && getUsEquityMarketSession().state === "closed") {
        await advance("U.S. market closed — Ask me first will resume scanning after the open, so every approval starts from a fresh stock signal. No practice cash was spent.");
        return;
      }
      // "Ask me first" mode: the bot hunts and scores EXACTLY as usual but
      // files each pick for the owner's OK instead of buying. Prune stale
      // suggestions, never re-suggest a mint already waiting, and never queue
      // more suggestions than there are free slots.
      let pendingSignals: SwingBuySignal[] = [];
      if (fresh.requireApproval) {
        await storage.expireStaleSwingBuySignals(fresh.id, new Date(Date.now() - APPROVAL_SIGNAL_TTL_MS)).catch(() => {});
        pendingSignals = await storage.listSwingBuySignals(fresh.id, "pending");
        for (const sig of pendingSignals) excludeMints.add(sig.mint);
      }
      const approvalRoom = !fresh.requireApproval || openNow.length + pendingSignals.length < effMaxPositions;
      if (fresh.requireApproval && !approvalRoom) {
        scanNote = `Ask me first: ${pendingSignals.length} pick${pendingSignals.length === 1 ? "" : "s"} waiting for your OK — approve or dismiss to make room for the next one.`;
      } else {
      const { pick, considered } = fresh.universe === "stocks"
        ? await findStockEntryCandidate(fresh, excludeMints, recentlyExited)
        : await findEntryCandidate(
          fresh, excludeMints, recentlyExited,
          (fresh.allowStacking || reducedTopUpMints.size > 0) ? openMints : new Set(),
          rebuySet,
          bonusTopUp ? reducedTopUpMints : undefined,
          recentLossExits,
          computeExitChaseCeilings(all),
        );
      if (pick) {
        if (fresh.requireApproval) {
          // Don't buy — file the pick as a pending suggestion. The reason
          // mirrors the rationale an auto buy would log, so the owner can
          // judge before approving (which buys at the CURRENT price).
          const why = judgeEntry(pick, fresh.minLiquidityUsd, fresh.style, fresh.mode === "live", effMinPoolAgeH(fresh)).why;
          const created = await storage.createSwingBuySignalIfNonePending({
            strategyId: fresh.id, mint: pick.mint, symbol: pick.symbol, reason: why,
          });
          if (created) {
            await storage.addSwingEvent({
              strategyId: fresh.id, positionId: null, kind: "info", mint: pick.mint, symbol: pick.symbol,
              detail: `Ask me first: the bot found ${pick.symbol} and is waiting for your OK. Tap Approve to buy it at the current price (with its normal stop and exit rules), or Dismiss to skip it. ${why}`,
              solLamports: null,
            });
          }
          scanNote = `Found ${pick.symbol} — waiting for your OK (Ask me first is on).`;
        } else {
        // openPosition can still decline (rug-risk guard, honeypot guard, no
        // route). Only claim "bought" when a position actually opened —
        // otherwise the status line lies while the activity feed says "skipped".
        // A pick of a mint we already hold is a deliberate second tranche
        // (reduced-entry top-up or DCA stacking) — tell openPosition so its
        // duplicate-buy guard doesn't veto it.
        const bought = await openPosition(fresh, pick, size, "auto", { topUp: openMints.has(pick.mint) });
        // A fulfilled "Buy again" star clears itself — otherwise the bot
        // would keep re-buying the same token after every exit forever.
        if (bought && rebuySet.has(pick.mint)) {
          const cur = await storage.getSwingStrategy(fresh.id);
          if (cur) {
            await storage.updateSwingStrategy(fresh.id, {
              rebuyMints: (cur.rebuyMints ?? []).filter((m) => m !== pick.mint),
            });
            await storage.addSwingEvent({
              strategyId: fresh.id, positionId: null, kind: "info", mint: pick.mint, symbol: pick.symbol,
              detail: `Your "Buy again" star on ${pick.symbol} is fulfilled — bought back in at a good entry. The star is cleared; star it again anytime.`,
              solLamports: null,
            });
          }
        }
        scanNote = bought
          ? `Just bought ${pick.symbol} — managing the exit from here.`
          : `Held off buying ${pick.symbol} this check — see the activity feed for why.`;
        }
      } else {
        // Visibility heartbeat (throttled): free cash sitting idle looks like
        // the bot froze — say out loud that it scanned and chose to wait.
        if (considered === 0) {
          // Nothing to judge — the outside token feeds returned nothing this
          // pass (or every candidate is held/cooling down). Say THAT, not
          // "none met the entry bar", which reads like the bot gave up.
          scanNote = fresh.universe === "stocks"
            ? "The verified xStocks list had no usable live market data this pass — trying again next minute. Your practice cash stays safe."
            : "Token feeds returned nothing this pass — retrying every minute. Your free cash stays safe.";
        } else {
          await addScanIdleEvent(fresh.id, considered, size, fresh.style);
          scanNote = fresh.universe === "stocks"
            ? `Checked ${considered} verified xStocks — none had a safe, steady upward move yet. Your practice cash stays safe.`
            : fresh.style === "dip"
            ? `Scanned ${considered} tokens — none met the dip-buy bar; your free cash stays safe.`
            : `Scanned ${considered} tokens — none met the entry bar; your free cash stays safe.`;
        }
      }
      }
    } else if (openNow.length > 0) {
      // We may have entered this branch only because a reduced entry LOOKED
      // top-up-eligible but didn't pass the proven-winner gates this pass
      // (slots actually full, size = 0). Runner-rotation must still get its
      // turn — entering the top-up check must never suppress rotation.
      if (fresh.universe !== "stocks" && !fresh.targetMint && openNow.length >= effMaxPositions) {
        const rotNote = await maybeRotateIntoRunner(fresh, openNow);
        scanNote = rotNote
          ?? `Holding ${openNow.length} position${openNow.length === 1 ? "" : "s"} — watching for a much stronger mover to rotate into.`;
      } else {
        scanNote = `Bankroll fully deployed across ${openNow.length} position${openNow.length === 1 ? "" : "s"} — managing exits every minute.`;
      }
    }
  } else if (fresh.universe !== "stocks" && !fresh.targetMint && openNow.length > 0) {
    // Fully deployed (holding the max positions). Normally we'd just manage
    // exits, but runner-rotation (opt-in) may sell the weakest position that's
    // still in profit to free cash for a clearly-stronger new mover.
    const rotNote = await maybeRotateIntoRunner(fresh, openNow);
    scanNote = rotNote
      ?? `Holding ${openNow.length} position${openNow.length === 1 ? "" : "s"} — watching for a much stronger mover to rotate into.`;
  }

  await advance(scanNote);
}

// ─── Scheduler ───────────────────────────────────────────────────────────────
let schedulerStarted = false;
// id → pass start time. A plain "is it running?" set turned out to be a trap:
// if a pass ever leaks (a hung await that slipped past every deadline), the
// entry never clears and the scheduler skips that bot FOREVER — a frozen bot
// that never scans, never buys, never heartbeats, until the process restarts.
// That happened in production. Timestamping each entry lets the tick evict a
// pass that has been "running" longer than the lock-wait cap and start fresh.
const inFlight = new Map<string, number>();
const IN_FLIGHT_STALE_MS = LOCK_WAIT_CAP_MS; // same 15-min "it leaked" verdict as the lock
const SLOW_PASS_WARN_MS = 90_000;

// Returns true when the bot is genuinely busy; evicts + logs when the entry is
// stale so the caller can proceed. Eviction touches ONLY the in-flight map —
// the strategyLocks chain is left alone on purpose: the replacement pass
// queues behind the leaked promise like any other waiter and relies on the
// lock's own 15-minute barge-in cap. Slower to recover (up to ~30 min total),
// but it never bypasses waiters that already captured the previous promise,
// so the single-writer guarantee holds exactly as designed.
function inFlightBusy(id: string): boolean {
  const started = inFlight.get(id);
  if (started === undefined) return false;
  if (Date.now() - started < IN_FLIGHT_STALE_MS) return true;
  console.error(`[swing] pass for ${id} stuck in-flight > ${IN_FLIGHT_STALE_MS / 60000} min — evicting stale entry; a fresh pass will queue behind the lock's barge-in cap.`);
  inFlight.delete(id);
  return false;
}

// Clear our own entry ONLY — if a leaked pass wakes up long after eviction,
// its cleanup must not erase the entry of the healthy pass that replaced it.
function inFlightDone(id: string, myStart: number): void {
  if (inFlight.get(id) === myStart) inFlight.delete(id);
  const dur = Date.now() - myStart;
  if (dur > SLOW_PASS_WARN_MS) console.warn(`[swing] slow pass for ${id}: ${Math.round(dur / 1000)}s`);
}
const TICK_MS = 20_000;

// ─── Interrupted-withdraw recovery ───────────────────────────────────────────
// A "Stop & withdraw" flips status instantly but runs the actual selling +
// sweeping in the background. If the server restarts mid-withdraw (a deploy,
// a crash), that background work is lost — and a stopped bot is invisible to
// the normal tick. These two recovery paths make the withdraw survive
// restarts instead of depending on the user pressing "Withdraw again":
//   1) every tick: any stopped/completed bot that still has OPEN positions
//      gets its liquidation resumed (throttled per bot);
//   2) once per boot: recently stopped/completed LIVE bots with no open
//      positions get one balance check — if SOL is stranded in the worker
//      wallet (positions sold but the sweep was lost), it's swept home.
const liquidationResumeLast = new Map<string, number>();
const LIQUIDATION_RESUME_GAP_MS = 3 * 60_000;
const resumeAnnounced = new Set<string>();

async function resumeInterruptedLiquidations(): Promise<void> {
  let stuck: SwingStrategy[] = [];
  try {
    stuck = await storage.listSwingStrategiesNeedingLiquidation();
  } catch (e: any) {
    console.error("[swing] failed to fetch bots needing liquidation:", e?.message ?? e);
    return;
  }
  for (const s of stuck) {
    const last = liquidationResumeLast.get(s.id);
    if (last && Date.now() - last < LIQUIDATION_RESUME_GAP_MS) continue;
    liquidationResumeLast.set(s.id, Date.now());
    if (inFlightBusy(s.id)) continue;
    const myStart = Date.now();
    inFlight.set(s.id, myStart);
    withStrategyLock(s.id, async () => {
      // Re-read under the lock — a restart (stopped → active) must win.
      const fresh = await storage.getSwingStrategy(s.id);
      if (!fresh || (fresh.status !== "stopped" && fresh.status !== "completed")) return;
      const open = await storage.listSwingPositions(s.id, "open");
      if (open.length === 0) return;
      if (!resumeAnnounced.has(s.id)) {
        resumeAnnounced.add(s.id);
        await storage.addSwingEvent({
          strategyId: s.id, positionId: null, kind: "info", mint: null, symbol: null,
          detail: "Your withdraw was interrupted (the server restarted mid-way) — resuming automatically: selling what's left and sweeping all funds back to your wallet.",
          solLamports: null,
        }).catch(() => {});
      }
      await liquidateAndSweep(fresh, fresh.status === "completed" ? "window_end" : "manual_stop");
    })
      .catch((e) => console.error(`[swing] liquidation resume failed for ${s.id}:`, e?.message ?? e))
      .finally(() => inFlightDone(s.id, myStart));
  }
}

// Runs at boot AND periodically: a "withdrawn" that leaves SOL in the worker
// wallet must self-heal without the user noticing, no matter how the first
// sweep died (server restart, hung tick, lost background promise).
const STRANDED_SWEEP_GAP_MS = 5 * 60_000;
let strandedSweepLastRun = 0;
async function sweepStrandedBalances(): Promise<void> {
  let recent: SwingStrategy[] = [];
  try {
    recent = await storage.listRecentlyStoppedLiveSwingStrategies(new Date(Date.now() - 48 * 3600_000));
  } catch (e: any) {
    console.error("[swing] stranded sweep check failed to list bots:", e?.message ?? e);
    return;
  }
  for (const s of recent) {
    try {
      const open = await storage.listSwingPositions(s.id, "open");
      if (open.length > 0) continue; // the tick-based resume path owns these
      // Check ALL sub-wallets — an interrupted withdraw can leave SOL in any
      // of them, and liquidateAndSweep already drains every wallet.
      const ws = await walletBalances(s);
      const balance = ws.reduce((a, w) => a + w.balance, 0n);
      if (balance <= 20_000n * BigInt(ws.length)) continue; // dust — nothing worth sweeping
      await withStrategyLock(s.id, async () => {
        const fresh = await storage.getSwingStrategy(s.id);
        if (!fresh || (fresh.status !== "stopped" && fresh.status !== "completed")) return;
        await storage.addSwingEvent({
          strategyId: s.id, positionId: null, kind: "info", mint: null, symbol: null,
          detail: `Found ${(Number(balance) / LAMPORTS_PER_SOL).toFixed(4)} SOL still in the bot's wallet after an interrupted withdraw — sending it back to your wallet now.`,
          solLamports: null,
        }).catch(() => {});
        await liquidateAndSweep(fresh, fresh.status === "completed" ? "window_end" : "manual_stop");
      });
    } catch (e: any) {
      console.error(`[swing] boot sweep failed for ${s.id}:`, e?.message ?? e);
    }
  }
}

// ─── Orphan-buy adoption ─────────────────────────────────────────────────────
// Backstop for the recoverBuyFill path: if the process died (deploy, crash)
// before the in-flight recovery could finish, a landed buy can still be
// missing its position row — real tokens sitting in the worker wallet with no
// stop-loss and no display. This pass finds them by asking the CHAIN, not the
// books: any token the wallet holds with no open position, whose funding tx
// shows OUR wallet spending real SOL to receive it, is adopted as a tracked
// position with the exact on-chain cost basis. Spam-airdrop tokens are
// naturally excluded (no SOL was spent), dust-hold leftovers are excluded
// (their funding tx is already a known entrySig).
const ORPHAN_ADOPT_GAP_MS = 5 * 60_000;
const ORPHAN_ADOPT_WINDOW_MS = 48 * 3600_000;
const ORPHAN_ADOPT_MIN_SPEND_LAMPORTS = 3_000_000n; // 0.003 SOL — below this it's rent/fee noise, not a buy
const ORPHAN_ADOPT_MAX_TX_PARSES = 8;
let orphanAdoptLastRun = 0;
async function adoptOrphanBuys(): Promise<void> {
  let active: SwingStrategy[] = [];
  try {
    active = (await storage.listActiveSwingStrategies()).filter((s) => s.mode === "live");
  } catch (e: any) {
    console.error("[swing] orphan adopt failed to list bots:", e?.message ?? e);
    return;
  }
  for (const s of active) {
    if (inFlightBusy(s.id)) continue;
    try {
      const all = await storage.listSwingPositions(s.id);
      const openMints = new Set(all.filter((p) => p.status === "open").map((p) => p.mint));
      const knownSigs = new Set<string>();
      for (const p of all) {
        if (p.entrySig) knownSigs.add(p.entrySig);
        if (p.exitSig) knownSigs.add(p.exitSig);
      }
      for (let idx = 0; idx < walletCount(s); idx++) {
        const ownerStr = walletPubkeyAt(s, idx);
        const owner = new PublicKey(ownerStr);
        const holdings = (await getTokenHoldings(owner)).filter(
          (h) => h.amountRaw > 0n && h.mint !== SOL_MINT && !openMints.has(h.mint),
        );
        if (holdings.length === 0) continue;
        const wanted = new Set(holdings.map((h) => h.mint));
        const sigs = await withDeadline(
          conn.getSignaturesForAddress(owner, { limit: 25 }),
          20_000, "getSignaturesForAddress",
        );
        let parses = 0;
        for (const si of sigs) {
          if (wanted.size === 0 || parses >= ORPHAN_ADOPT_MAX_TX_PARSES) break;
          if (si.err || knownSigs.has(si.signature)) continue;
          if (!si.blockTime || Date.now() - si.blockTime * 1000 > ORPHAN_ADOPT_WINDOW_MS) continue;
          parses++;
          let tx;
          try {
            tx = await withDeadline(
              conn.getParsedTransaction(si.signature, { maxSupportedTransactionVersion: 0 }),
              20_000, "getParsedTransaction",
            );
          } catch { continue; }
          if (!tx?.meta || tx.meta.err) continue;
          const keys = tx.transaction.message.accountKeys.map((k: any) =>
            typeof k === "string" ? k : (k.pubkey?.toBase58 ? k.pubkey.toBase58() : String(k.pubkey ?? k)));
          const i = keys.indexOf(ownerStr);
          if (i < 0) continue;
          const solSpent = BigInt(tx.meta.preBalances[i]) - BigInt(tx.meta.postBalances[i]);
          if (solSpent < ORPHAN_ADOPT_MIN_SPEND_LAMPORTS) continue; // airdrop/fee noise — not our buy
          for (const mint of Array.from(wanted)) {
            const preTok = (tx.meta.preTokenBalances ?? []).find((b: any) => b.mint === mint && b.owner === ownerStr);
            const postTok = (tx.meta.postTokenBalances ?? []).find((b: any) => b.mint === mint && b.owner === ownerStr);
            const gained = BigInt(postTok?.uiTokenAmount?.amount ?? "0") - BigInt(preTok?.uiTokenAmount?.amount ?? "0");
            if (gained <= 0n) continue;
            const holding = holdings.find((h) => h.mint === mint)!;
            wanted.delete(mint);
            // Book what THIS tx bought, not the whole wallet balance — the
            // wallet could already hold some of this mint from elsewhere.
            const adoptAmount = gained < holding.amountRaw ? gained : holding.amountRaw;
            const stats = await getTokenStats(mint).catch(() => null);
            const symbol = stats?.symbol ?? `${mint.slice(0, 4)}…`;
            await withStrategyLock(s.id, async () => {
              const fresh = await storage.getSwingStrategy(s.id);
              if (!fresh || fresh.status !== "active") return;
              const pos = await storage.createSwingPositionIfNoOpenMint({
                strategyId: s.id, mint, symbol, tokenName: stats?.name ?? null,
                mode: "live",
                walletIndex: idx,
                solInLamports: solSpent.toString(),
                tokenAmountRaw: adoptAmount.toString(),
                decimals: holding.decimals,
                highWaterLamports: solSpent.toString(),
                lastValueLamports: solSpent.toString(),
                entryVolumeH1Usd: stats?.volH1Usd ?? 0,
                entryLiquidityUsd: stats?.liquidityUsd ?? 0,
                entryPriceUsd: stats && stats.priceUsd > 0 ? stats.priceUsd : null,
                entryPairAddress: stats?.pairAddress ?? null,
                // An orphan predates durable PumpApi pinning; do not invent a
                // route. It remains recoverable but valuation/sell fails closed.
                entryPumpPoolId: null,
                entryPumpQuoteMint: null,
                entryPumpBlockhash: null,
                entryTrigger: "auto",
                entrySig: si.signature,
              });
              if (!pos) return; // raced with another adopter/buyer — already tracked
              await storage.addSwingEvent({
                strategyId: s.id, positionId: pos.id, kind: "buy", mint, symbol,
                detail: `Recovered a ${symbol} buy that the network confirmed late — the app first showed it as failed, but the chain shows ${(Number(solSpent) / LAMPORTS_PER_SOL).toFixed(4)} SOL was spent and the tokens arrived. It's now tracked as a normal trade: stop-loss, profit rules, everything.`,
                solLamports: solSpent.toString(),
              });
            });
          }
        }
      }
    } catch (e: any) {
      console.error(`[swing] orphan adopt failed for ${s.id}:`, e?.message ?? e);
    }
  }
}

// Runner rotation (opt-in). Called only when the bot is fully deployed (holding
// its max positions). Sells the WEAKEST position that is currently in profit to
// free cash for a clearly-stronger new mover, and adds the just-sold token to
// the priority re-buy watchlist. NEVER sells a position at a loss to chase.
// Returns a status note if it rotated, else null.
async function maybeRotateIntoRunner(
  s: SwingStrategy,
  openNow: SwingPosition[],
): Promise<string | null> {
  const last = rotationLastAt.get(s.id) ?? 0;
  if (Date.now() - last < ROTATE_COOLDOWN_MS) return null;

  const openMints = new Set(openNow.map((p) => p.mint));
  // Strongest buyable new mover — exclude held names and names still cooling off
  // after a recent exit (same rules as the normal buy hunt).
  const all = await storage.listSwingPositions(s.id);
  const recentlyExited = new Set(
    all.filter((p) => {
      if (p.status !== "closed" || !p.closedAt) return false;
      const sinceClose = Date.now() - new Date(p.closedAt).getTime();
      const wasWin =
        p.exitReason !== "stop_loss" && p.exitReason !== "tokens_sent_home" &&
        BigInt(p.solOutLamports ?? "0") > BigInt(p.solInLamports);
      const winCooldownMs =
        s.style === "quick" ? REENTRY_COOLDOWN_WIN_QUICK_MS : REENTRY_COOLDOWN_WIN_MS;
      return sinceClose < (wasWin ? winCooldownMs : REENTRY_COOLDOWN_LOSS_MS);
    }).map((p) => p.mint),
  );
  const rebuySet = new Set((s.rebuyMints ?? []).filter((m) => !openMints.has(m)));
  const recentLossExits = computeRecentLossExits(all);
  const { pick } = await findEntryCandidate(s, openMints, recentlyExited, new Set(), rebuySet, undefined, recentLossExits, computeExitChaseCeilings(all));
  if (!pick) return null;
  // Score the candidate on the momentum scale so held vs candidate compare like
  // for like (pick extends CandidateStats, so scoreCandidate applies directly).
  const candidateScore = scoreCandidate(pick);

  // Weakest HELD position that is currently in REAL profit — never a loser.
  let weakest: { p: SwingPosition; score: number } | null = null;
  for (const p of openNow) {
    const solInL = BigInt(p.solInLamports);
    if (solInL <= 0n) continue;
    const valueL = BigInt(p.lastValueLamports ?? p.solInLamports);
    const pnl = (Number(valueL - solInL) / Number(solInL)) * 100;
    if (pnl < ROTATE_MIN_PROFIT_PCT) continue; // only rotate out of a winner
    const st = peekTokenStats(p.mint) ?? (await getTokenStats(p.mint).catch(() => null));
    if (!st) continue; // can't score it → never sell blind here
    // Never rotate out of a live runner merely because another token's static
    // score is higher. A real, buyer-led green 5m tape is positive evidence the
    // held token still has another leg; keep it and wait for an actual fade.
    const heldTxM5 = st.buysM5 + st.sellsM5;
    const heldStillRunning =
      heldTxM5 >= ADAPTIVE_MIN_M5_TXNS && st.chgM5Known &&
      st.chgM5 > 0 && st.buysM5 > st.sellsM5;
    if (heldStillRunning) continue;
    const score = scoreCandidate(st);
    if (!weakest || score < weakest.score) weakest = { p, score };
  }
  if (!weakest) return null; // nothing profitable to rotate out of
  if (weakest.p.mint === pick.mint) return null;

  // Fire only when the new mover is CLEARLY stronger on BOTH tests.
  if (
    !(candidateScore >= weakest.score * ROTATE_SCORE_RATIO &&
      candidateScore - weakest.score >= ROTATE_SCORE_MIN_MARGIN)
  ) {
    return null;
  }

  // "Never sell a loser" — the screen above used the last recorded value, which
  // can be stale. Re-check the chosen position against a FRESH executable PumpApi
  // quote for its exact size right before selling. If it's no longer genuinely in
  // profit, abort (a market wobble must never turn a rotation into a real loss).
  // If the quote can't be fetched (API flaky), keep the position — never sell
  // blind on a rotation.
  const solInL = BigInt(weakest.p.solInLamports);
  const freshVal = await quotePositionValue(weakest.p, s.slippageBps);
  if (freshVal == null) return null;
  const freshPnl = (Number(freshVal - solInL) / Number(solInL)) * 100;
  if (freshPnl < ROTATE_MIN_PROFIT_PCT) return null;

  const soldSym = weakest.p.symbol;
  const soldMint = weakest.p.mint;
  const soldId = weakest.p.id;
  await closePosition(
    s, weakest.p, "rotate_to_runner",
    `Rotating into a stronger mover: ${soldSym} is your weakest position that's still in profit, and ${pick.symbol} is showing much stronger momentum right now. Banking ${soldSym} to free up cash for it. ${soldSym} is added to your "Buy again" watchlist — if it sets up again, the bot can buy it back.`,
  );
  // closePosition fail-softs in LIVE mode: a failed sell leaves the position
  // OPEN and returns without throwing. Confirm the position actually closed
  // before we treat this as a rotation — otherwise we'd start the cooldown, add
  // a rebuy mint, and tell the user "rotated" when nothing sold.
  const stillOpen = (await storage.listSwingPositions(s.id, "open")).some((x) => x.id === soldId);
  if (stillOpen) return null; // sell didn't go through — no state changes, retry next tick

  rotationLastAt.set(s.id, Date.now());
  // Add the just-sold token to the priority re-buy watchlist (user's ask).
  const cur = await storage.getSwingStrategy(s.id);
  if (cur) {
    const existing = cur.rebuyMints ?? [];
    if (!existing.includes(soldMint)) {
      await storage.updateSwingStrategy(s.id, { rebuyMints: [...existing, soldMint] });
    }
  }
  return `Rotated out of ${soldSym} into stronger momentum — the freed cash buys the stronger mover on the next check.`;
}

async function tick(): Promise<void> {
  if (!isSwingConfigured()) return;
  // Hygiene: drop stale zero-balance timers for positions that were closed by
  // other paths and never revisited (a live entry gets acted on within the
  // grace window; anything older than 10 minutes is orphaned).
  const staleCutoff = Date.now() - 10 * 60_000;
  zeroBalanceSeen.forEach((firstSeen, id) => {
    if (firstSeen < staleCutoff) zeroBalanceSeen.delete(id);
  });
  let due: SwingStrategy[] = [];
  try {
    due = await storage.getDueSwingStrategies(new Date());
  } catch (e: any) {
    console.error("[swing] failed to fetch due bots:", e?.message ?? e);
    return;
  }
  for (const s of due) {
    if (inFlightBusy(s.id)) continue;
    const myStart = Date.now();
    inFlight.set(s.id, myStart);
    withStrategyLock(s.id, async () => {
      // Re-read under the lock — a stop that got in first must win.
      const fresh = await storage.getSwingStrategy(s.id);
      if (!fresh || fresh.status !== "active") return;
      // NOTE: no pass-level abort here on purpose. Killing a pass that is
      // still running would break the single-writer guarantee (a new pass
      // could double-buy/double-sell while the old one is mid-trade). Instead,
      // EVERY external await inside the pass carries its own deadline
      // (withDeadline / AbortSignal.timeout), so a healthy pass always settles
      // on its own. The ONLY exception is the 15-minute stale-entry eviction
      // in inFlightBusy — the same "it leaked" verdict as the lock-wait cap —
      // because a leaked pass would otherwise freeze this bot forever.
      await processSwingTick(fresh);
    })
      .catch((e) => console.error(`[swing] tick failed for ${s.id}:`, e?.message ?? e))
      .finally(() => inFlightDone(s.id, myStart));
  }
  // Withdraws interrupted by a restart must finish on their own — never
  // depend on the user noticing and pressing "Withdraw again".
  await resumeInterruptedLiquidations();
  // Periodic backstop for SOL stranded after a lost sweep (throttled; the
  // per-bot dust check inside keeps it cheap when there's nothing to do).
  if (Date.now() - strandedSweepLastRun >= STRANDED_SWEEP_GAP_MS) {
    strandedSweepLastRun = Date.now();
    await sweepStrandedBalances().catch((e) => console.error("[swing] stranded sweep failed:", e?.message ?? e));
  }
  // Backstop for buys that landed on-chain but lost their position row (a
  // confirm timeout + process death) — adopt them from the chain so real
  // tokens are never left untracked without a stop-loss.
  if (Date.now() - orphanAdoptLastRun >= ORPHAN_ADOPT_GAP_MS) {
    orphanAdoptLastRun = Date.now();
    await adoptOrphanBuys().catch((e) => console.error("[swing] orphan adopt failed:", e?.message ?? e));
  }
}

// Boot reconciliation for the lifetime active-time clock: if the server was
// down while a bot's status stayed "active", the open activeSince stretch
// would otherwise silently include the downtime. Credit time only up to the
// last proven-alive moment (lastScanAt heartbeat + one tick of grace), then
// restart the stretch from now. The clock must count time the bot actually
// ran — never server outages.
async function reconcileActiveClocks(): Promise<void> {
  const active = await storage.listActiveSwingStrategies();
  for (const stale of active) {
    // Re-read UNDER the strategy lock so we can't clobber a concurrent
    // lifecycle transition (pause/stop accrual) with stale numbers, and skip
    // anything that is no longer active by the time we get to it.
    await withStrategyLock(stale.id, async () => {
      const s = await storage.getSwingStrategy(stale.id);
      if (!s || s.status !== "active") return;
      if (!s.activeSince) {
        // Active but no stretch open (legacy row from before the clock
        // existed) — start counting from now.
        await storage.updateSwingStrategy(s.id, { activeSince: new Date() });
        return;
      }
      const now = Date.now();
      const started = new Date(s.activeSince).getTime();
      const heartbeat = s.lastScanAt ? new Date(s.lastScanAt).getTime() + 90_000 : started;
      const cutoff = Math.min(now, Math.max(started, heartbeat));
      const stretch = Math.max(0, cutoff - started);
      await storage.updateSwingStrategy(s.id, {
        activeMsTotal: (BigInt(s.activeMsTotal || "0") + BigInt(stretch)).toString(),
        activeSince: new Date(),
      });
    }).catch(() => {});
  }
}

// One-time data repair (July 2026): a Jotchua sell landed on-chain (sig
// 3jR4YVTu…, worker received 963,399,518 lamports) but its confirmation was
// missed and the trade was booked as a -100% full loss two minutes later.
// The sent signature was never persisted back then, so the position can't
// self-heal via recoverSellProceeds — correct the specific record instead.
// Idempotent: only applies while the position still shows 0 SOL out.
const JOTCHUA_REPAIR_POSITION_ID = "922505ef-c763-4b7e-866d-51e8daf02de7";
const JOTCHUA_REPAIR_SOL_OUT = 963399518n; // on-chain worker SOL delta
const JOTCHUA_REPAIR_SIG = "3jR4YVTugf2PneWt4SbWh6QXEEEKpoa5hbBgnGfpU4u9GRsuYs6GVmM3Eh8cjrXBUDmMhHf45zx5zpAaFWB9jGVA";
async function repairMisbookedJotchua(): Promise<void> {
  try {
    const all = await storage.listSwingPositions("619b6fb1-ccc1-4921-8ddb-b9e7340d6727");
    const p = all.find((x) => x.id === JOTCHUA_REPAIR_POSITION_ID);
    if (!p || p.status !== "closed" || p.solOutLamports !== "0") return; // wrong env or already repaired
    const s = await storage.getSwingStrategy(p.strategyId);
    if (!s) return;
    // Single-winner CAS: the UPDATE only succeeds while sol_out is still 0,
    // so two overlapping processes (deploy overlap) can't both add the P&L.
    const claimed = await storage.repairSwingPositionSolOut(
      p.id, JOTCHUA_REPAIR_SOL_OUT.toString(), JOTCHUA_REPAIR_SIG,
    );
    if (!claimed) return;
    const fresh = await storage.getSwingStrategy(s.id);
    if (!fresh) return;
    await storage.updateSwingStrategy(s.id, {
      realizedPnlLamports: (BigInt(fresh.realizedPnlLamports) + JOTCHUA_REPAIR_SOL_OUT).toString(),
    });
    await storage.addSwingEvent({
      strategyId: s.id, positionId: p.id, kind: "info", mint: p.mint, symbol: p.symbol,
      detail: `Corrected the record: the Jotchua sale DID go through on-chain for ${(Number(JOTCHUA_REPAIR_SOL_OUT) / LAMPORTS_PER_SOL).toFixed(4)} SOL (a -5.8% trade, not -100%). The confirmation was missed at the time; totals now reflect the real result.`,
      solLamports: JOTCHUA_REPAIR_SOL_OUT.toString(),
    });
    console.log("[swing] repaired misbooked Jotchua position");
  } catch (e: any) {
    console.error("[swing] Jotchua repair failed:", e?.message ?? e);
  }
}

// Second one-time repair (July 12, 2026): a Hoppy conservative_take DID sell
// on-chain (sig 3t2e6nPB…, worker received 409,388,594 lamports = +5.6%), but
// the post-sale balance read hit a lagging RPC node, saw no change, and the
// win was booked as a -100% full loss. The false loss also advanced the
// losing-streak counter and helped trip the loss-brake cool-off. Corrects the
// record, adds back the P&L and the win, and recomputes the TRUE streak from
// the closed history. Idempotent via the same sol_out=0 CAS as Jotchua.
const HOPPY_REPAIR_POSITION_ID = "13ecb25d-03ad-409e-8666-ca10584242f8";
const HOPPY_REPAIR_SOL_OUT = 409388594n; // on-chain worker SOL delta (verified)
const HOPPY_REPAIR_SIG = "3t2e6nPBqTbmByAfkgLYrtbiBjNY3dMZ346SMqrySygyTSd6ArrParHRrFjpDkhMSPoQEuW6BEBdVqoFF9LMuJZY";
async function repairMisbookedHoppy(): Promise<void> {
  try {
    const all = await storage.listSwingPositions("619b6fb1-ccc1-4921-8ddb-b9e7340d6727");
    const p = all.find((x) => x.id === HOPPY_REPAIR_POSITION_ID);
    if (!p || p.status !== "closed" || p.solOutLamports !== "0") return; // wrong env or already repaired
    const s = await storage.getSwingStrategy(p.strategyId);
    if (!s) return;
    // Single-winner CAS: only succeeds while sol_out is still 0.
    const claimed = await storage.repairSwingPositionSolOut(
      p.id, HOPPY_REPAIR_SOL_OUT.toString(), HOPPY_REPAIR_SIG,
    );
    if (!claimed) return;
    const fresh = await storage.getSwingStrategy(s.id);
    if (!fresh) return;
    // TRUE streak: walk the closed history newest-first (repaired value now
    // included) and count losses until the first win. min() with the live
    // counter so the repair can only shrink a streak, never inflate one.
    const closed = (await storage.listSwingPositions(s.id, "closed"))
      .filter((x) => x.closedAt != null)
      .sort((a, b) => new Date(b.closedAt as any).getTime() - new Date(a.closedAt as any).getTime());
    let streak = 0;
    for (const x of closed) {
      // In-kind / non-realized exits don't move the live streak counter, so
      // they must not count as losses in the recompute either.
      if (x.exitReason === "tokens_sent_home" || x.exitReason === "dust_hold") continue;
      if (BigInt(x.solOutLamports ?? "0") > BigInt(x.solInLamports)) break;
      streak++;
    }
    await storage.updateSwingStrategy(s.id, {
      realizedPnlLamports: (BigInt(fresh.realizedPnlLamports) + HOPPY_REPAIR_SOL_OUT).toString(),
      wins: fresh.wins + 1,
      consecutiveLosses: Math.min(fresh.consecutiveLosses, streak),
    });
    await storage.addSwingEvent({
      strategyId: s.id, positionId: p.id, kind: "info", mint: p.mint, symbol: p.symbol,
      detail: `Corrected the record: the Hoppy sale at 10:50 DID go through on-chain for ${(Number(HOPPY_REPAIR_SOL_OUT) / LAMPORTS_PER_SOL).toFixed(4)} SOL — a +5.6% WIN, not a -100% loss. A lagging balance read booked it wrong. Totals, win count, and the losing-streak counter now reflect the real result. No fee was charged on this win.`,
      solLamports: HOPPY_REPAIR_SOL_OUT.toString(),
    });
    console.log("[swing] repaired misbooked Hoppy position");
  } catch (e: any) {
    console.error("[swing] Hoppy repair failed:", e?.message ?? e);
  }
}

export function startSwingScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  if (!isSwingConfigured()) {
    console.warn("[swing] AUTO_STRATEGY_ENCRYPTION_KEY not set — scheduler idle.");
  } else {
    console.log("[swing] scheduler started (tick every 20s).");
    // One-shot recovery pass shortly after boot: sweep home any SOL stranded
    // by a withdraw the previous process never finished.
    setTimeout(() => { void sweepStrandedBalances(); }, 15_000);
  }
  // One-shot historical data correction (no-op outside production data).
  setTimeout(() => { void repairMisbookedJotchua(); }, 10_000);
  setTimeout(() => { void repairMisbookedHoppy(); }, 12_000);
  // Reconcile the lifetime clocks BEFORE the first tick can run — the ticks
  // start only after reconciliation finishes (or fails), so a tick's own
  // accrual can never interleave with the boot pass. A reconcile failure
  // must never keep the trading engine down.
  reconcileActiveClocks()
    .catch((e) => console.error("[swing] clock reconcile failed:", e?.message ?? e))
    .finally(() => {
      setInterval(() => { void tick(); }, TICK_MS);
      // Hot-watch fast lane: 10s price-floor checks for armed/near-stop quick
      // positions — the pass itself is a no-op when nothing is hot. Also
      // gated behind the boot reconcile: a fast-lane sell can trip the
      // loss-brake cool-off, so it must not interleave with the
      // reconciliation pass either.
      setInterval(() => { void fastGuardPass(); }, FAST_GUARD_MS);
    });
}
