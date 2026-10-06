// ─── Arbitrage Executor — autonomous, server-side runner ─────────────────────
//
// Sibling of the Auto Strategy Bot. It watches the read-only cross-pool arb
// scanner (server/arbitrage.ts) and acts on qualifying opportunities WITHOUT the
// browser open. Two modes:
//
//   • PAPER (default, safe): never touches the chain. Every tick it scans for the
//     best net-edge opportunity and, if it clears the user's floor, records a
//     simulated fill using the scanner's own honest cost model (LP fees + price
//     impact + network fee already subtracted). Proves the economics with zero
//     risk. Paper is intentionally OPTIMISTIC in one way: it assumes the quoted
//     spread is fully fillable at that instant — real fills race other bots.
//
//   • LIVE (opt-in, hard-capped): executes a SEQUENTIAL (non-atomic) round trip
//     from a dedicated, budget-only worker wallet — buy the token on the cheap
//     venue, sell it on the dear venue, both routed through Jupiter with a
//     best-effort per-leg DEX restriction. HONEST LIMITATION: Jupiter is an
//     aggregator; the `dexes` filter narrows to a venue but can't pin the exact
//     pool, and the two legs are separate transactions, so price can move between
//     them. True atomic arb needs a custom on-chain program. Live is therefore
//     genuinely risky and guarded by: a per-trade USD cap (≤ $100), a total SOL
//     budget cap (≤ 2 SOL), and an auto-stop after N consecutive losing trades.
//
// The user's MAIN wallet is NEVER used to sign — it only funds the worker wallet,
// and funds can ONLY ever sweep back to withdrawAddress (fixed to the owner).

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
import { getSwapQuote, getSwapTransaction, SOL_MINT } from "./jupiter";
import { scanTokenArb, scanNetworkArb, type ArbOpportunity } from "./arbitrage";
import type { ArbStrategy } from "@workspace/db";

const HELIUS_KEY = process.env.HELIUS_API_KEY;
const RPC_URL = HELIUS_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`
  : "https://api.mainnet-beta.solana.com";
const conn = new Connection(RPC_URL, { commitment: "confirmed", fetch: rpcFetchWithFallback });

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// Leave this much SOL for the next tx fee. Dust below this isn't worth moving.
const FEE_RESERVE_LAMPORTS = 10_000n;
const DUST_LAMPORTS = 5_000n;
// Never fire a live buy smaller than this — a sub-dust swap just burns fees.
const MIN_TRADE_LAMPORTS = 2_000_000n; // 0.002 SOL

// Absolute server-side ceilings (the schema also caps these; belt + suspenders).
export const HARD_MAX_TRADE_USD = 100;
export const HARD_MAX_BUDGET_LAMPORTS = 2n * BigInt(LAMPORTS_PER_SOL);

// ─── Encryption at rest (AES-256-GCM) — shares AUTO_STRATEGY_ENCRYPTION_KEY ───
export function isEncryptionConfigured(): boolean {
  return !!process.env.AUTO_STRATEGY_ENCRYPTION_KEY;
}

function getEncryptionKey(): Buffer {
  const raw = process.env.AUTO_STRATEGY_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "AUTO_STRATEGY_ENCRYPTION_KEY is not configured. The arbitrage executor " +
      "cannot generate or operate worker wallets without it.",
    );
  }
  return createHash("sha256").update(raw, "utf8").digest();
}

function encryptSecret(plain: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

function decryptSecret(blob: string): string {
  const key = getEncryptionKey();
  const [ivB64, tagB64, dataB64] = blob.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed encrypted key.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

// ─── Read-session tokens (owner-gated polling without a popup per request) ────
const READ_TOKEN_TTL_MS = 30 * 60 * 1000;

export function issueReadToken(ownerWallet: string, ttlMs: number = READ_TOKEN_TTL_MS): string {
  const exp = Date.now() + ttlMs;
  // Namespaced so an arb read token can't be confused with an auto-strategy one.
  const payload = `arb.${ownerWallet}.${exp}`;
  const mac = createHmac("sha256", getEncryptionKey()).update(payload).digest("base64url");
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${mac}`;
}

export function verifyReadToken(token: string): string | null {
  try {
    const [payloadB64, mac] = token.split(".");
    if (!payloadB64 || !mac) return null;
    const payload = Buffer.from(payloadB64, "base64url").toString("utf8");
    const expected = createHmac("sha256", getEncryptionKey()).update(payload).digest("base64url");
    const macBuf = Buffer.from(mac);
    const expBuf = Buffer.from(expected);
    if (macBuf.length !== expBuf.length || !timingSafeEqual(macBuf, expBuf)) return null;
    const [ns, ownerWallet, expStr] = payload.split(".");
    if (ns !== "arb" || !ownerWallet || !expStr || Date.now() > Number(expStr)) return null;
    return ownerWallet;
  } catch {
    return null;
  }
}

export function generateWorkerWallet(): { pubkey: string; encryptedKey: string } {
  const kp = Keypair.generate();
  const secret = bs58.encode(kp.secretKey);
  return { pubkey: kp.publicKey.toBase58(), encryptedKey: encryptSecret(secret) };
}

function loadKeypair(encryptedKey: string): Keypair {
  return Keypair.fromSecretKey(bs58.decode(decryptSecret(encryptedKey)));
}

// ─── On-chain helpers ────────────────────────────────────────────────────────
export async function getSolBalanceLamports(pubkey: string): Promise<bigint> {
  return BigInt(await conn.getBalance(new PublicKey(pubkey), "confirmed"));
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
      res = await conn.getParsedTokenAccountsByOwner(owner, { programId }, "confirmed");
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

async function readMintBalance(owner: PublicKey, mint: string): Promise<{ amountRaw: bigint; decimals: number }> {
  const holdings = await getTokenHoldings(owner);
  const h = holdings.find((x) => x.mint === mint);
  return { amountRaw: h?.amountRaw ?? 0n, decimals: h?.decimals ?? 0 };
}

async function signSendConfirm(b64: string, kp: Keypair): Promise<string> {
  const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
  tx.sign([kp]);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  // Confirm by polling the signature's own status — NOT by confirming against a
  // freshly-fetched blockhash. The Jupiter tx carries its own (older) blockhash;
  // confirming with a newer one races expiry and yields false negatives that
  // would mark a landed swap as "failed" and corrupt P&L / budget accounting.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const { value } = await conn.getSignatureStatuses([sig]);
    const st = value[0];
    if (st) {
      if (st.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(st.err)}`);
      if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") return sig;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Transaction not confirmed within 60s (it may still land — check the worker wallet).");
}

// ─── SOL price (for USD ↔ lamports conversion in live mode) ──────────────────
let solPriceCache: { at: number; usd: number } | null = null;
const SOL_PRICE_TTL_MS = 30_000;
export async function getSolPriceUsd(): Promise<number> {
  if (solPriceCache && Date.now() - solPriceCache.at < SOL_PRICE_TTL_MS) return solPriceCache.usd;
  try {
    // 1 SOL → USDC via Jupiter; USDC has 6 decimals.
    const q = await getSwapQuote(SOL_MINT, USDC_MINT, LAMPORTS_PER_SOL, 50);
    const usd = Number(q.outAmount ?? "0") / 1e6;
    if (usd > 0) solPriceCache = { at: Date.now(), usd };
  } catch {
    // keep last good value
  }
  return solPriceCache?.usd ?? 0;
}

// DexScreener dexId → best-effort Jupiter route label. Jupiter matches labels
// loosely; an unknown DEX just goes unrestricted for that leg (documented).
const DEX_LABELS: Record<string, string> = {
  raydium: "Raydium",
  orca: "Orca",
  meteora: "Meteora",
  meteoradlmm: "Meteora DLMM",
  pumpswap: "Pump.fun Amm",
  pump: "Pump.fun",
  lifinity: "Lifinity V2",
  phoenix: "Phoenix",
  fluxbeam: "FluxBeam",
};
function dexLabel(dexId: string): string | undefined {
  return DEX_LABELS[(dexId || "").toLowerCase()];
}

// ─── Opportunity selection ───────────────────────────────────────────────────
// Best qualifying opportunity for a strategy, or null. Uses the strategy's
// per-trade USD size so cost/impact estimates match what we'd actually trade.
async function findBestOpportunity(s: ArbStrategy): Promise<ArbOpportunity | null> {
  const size = Math.min(s.maxTradeUsd, HARD_MAX_TRADE_USD);
  let candidates: ArbOpportunity[] = [];
  if (s.targetMode === "list") {
    const mints = (s.targetMints ?? []) as string[];
    const results = await Promise.all(mints.map((m) => scanTokenArb(m, size).catch(() => null)));
    candidates = results.filter((r): r is ArbOpportunity => !!r && r.poolCount >= 2);
  } else {
    candidates = await scanNetworkArb(size).catch(() => []);
  }
  if (candidates.length === 0) return null;
  const best = candidates.sort((a, b) => b.netEdgePct - a.netEdgePct)[0];
  return best && best.executable ? best : null;
}

// ─── Live sequential round-trip ──────────────────────────────────────────────
// Buy the token on the cheap venue, then sell it on the dear venue. Returns the
// realized net lamports (post - pre balance across the whole round trip) and the
// execution record fields. Non-atomic: if leg 2 fails we hold the token (swept
// on stop). Every SOL that leaves is bounded by the wallet balance + budget.
async function executeLiveArb(s: ArbStrategy, opp: ArbOpportunity): Promise<void> {
  const kp = loadKeypair(s.encryptedKey);
  const owner = kp.publicKey;
  const slippage = s.slippageBps;
  const solPrice = await getSolPriceUsd();

  const budget = BigInt(s.budgetLamports);
  const spent = BigInt(s.spentLamports);
  const budgetRemaining = budget > spent ? budget - spent : 0n;

  // Desired trade size in lamports from the USD cap, clamped to budget + wallet.
  let solIn = solPrice > 0
    ? BigInt(Math.floor((Math.min(s.maxTradeUsd, HARD_MAX_TRADE_USD) / solPrice) * LAMPORTS_PER_SOL))
    : 0n;
  if (solIn > budgetRemaining) solIn = budgetRemaining;
  const balance = await getSolBalanceLamports(owner.toBase58());
  const spendable = balance > FEE_RESERVE_LAMPORTS ? balance - FEE_RESERVE_LAMPORTS : 0n;
  if (solIn > spendable) solIn = spendable;

  if (solIn < MIN_TRADE_LAMPORTS) {
    await storage.addArbExecution({
      strategyId: s.id, mint: opp.mint, symbol: opp.symbol,
      buyDex: opp.buyPool?.dex ?? "", sellDex: opp.sellPool?.dex ?? "",
      tradeSizeUsd: s.maxTradeUsd,
      grossSpreadBps: Math.round(opp.grossSpreadPct * 100),
      estCostBps: Math.round(opp.estCostPct * 100),
      netEdgeBps: Math.round(opp.netEdgePct * 100),
      mode: "live", solInLamports: "0", solOutLamports: "0",
      buySig: null, sellSig: null, resultMicroUsd: "0",
      status: "skipped",
      errorMessage: "Worker wallet balance too low for a live trade — fund it or lower the trade size.",
    });
    return;
  }

  const preBalance = await getSolBalanceLamports(owner.toBase58());
  const buyLabel = dexLabel(opp.buyPool?.dex ?? "");
  const sellLabel = dexLabel(opp.sellPool?.dex ?? "");
  let buySig: string | null = null;
  let sellSig: string | null = null;

  // Leg 1 — SOL → token on the cheap venue.
  let boughtRaw = 0n;
  let decimals = 0;
  try {
    const preTok = await readMintBalance(owner, opp.mint);
    const quote = await getSwapQuote(SOL_MINT, opp.mint, Number(solIn), slippage, buyLabel);
    const swap = await getSwapTransaction(quote as any, owner.toBase58());
    buySig = await signSendConfirm(swap.swapTransaction, kp);
    const postTok = await readMintBalance(owner, opp.mint);
    boughtRaw = postTok.amountRaw - preTok.amountRaw;
    decimals = postTok.decimals || preTok.decimals;
  } catch (e: any) {
    // A build/send failure deploys ~no funds; only count what actually left the
    // wallet (fees, or a false-negative confirm that still landed) toward budget.
    const cur = await getSolBalanceLamports(owner.toBase58());
    const actualSpent = preBalance > cur ? preBalance - cur : 0n;
    await recordLiveResult(s, opp, solIn, -actualSpent, actualSpent, buySig, null, "failed",
      "Buy leg failed: " + String(e?.message ?? e).slice(0, 220));
    return;
  }
  if (boughtRaw <= 0n) {
    const cur = await getSolBalanceLamports(owner.toBase58());
    const actualSpent = preBalance > cur ? preBalance - cur : 0n;
    await recordLiveResult(s, opp, solIn, -actualSpent, actualSpent, buySig, null, "failed",
      "Buy leg confirmed but no tokens received (route returned nothing).");
    return;
  }

  // Leg 2 — token → SOL on the dear venue.
  try {
    const quote = await getSwapQuote(opp.mint, SOL_MINT, Number(boughtRaw), slippage, sellLabel);
    const swap = await getSwapTransaction(quote as any, owner.toBase58());
    sellSig = await signSendConfirm(swap.swapTransaction, kp);
  } catch (e: any) {
    // Non-atomic reality: we bought but couldn't sell. We now hold the token; it
    // stays in the worker wallet and is swept on stop/cancel. Count as a loss.
    const postBalance = await getSolBalanceLamports(owner.toBase58());
    const realized = postBalance - preBalance; // negative (we spent SOL, hold token)
    const actualSpent = realized < 0n ? -realized : 0n;
    await recordLiveResult(s, opp, solIn, realized, actualSpent, buySig, null, "partial",
      "Sell leg failed — holding the token; it will be returned on stop. " + String(e?.message ?? e).slice(0, 160));
    return;
  }

  const postBalance = await getSolBalanceLamports(owner.toBase58());
  const realized = postBalance - preBalance; // net lamports across both legs
  // Budget tracks net principal consumed: a winning round-trip returns everything
  // (spends 0 toward the cap); a losing one consumes the net loss.
  const actualSpent = realized < 0n ? -realized : 0n;
  await recordLiveResult(s, opp, solIn, realized, actualSpent, buySig, sellSig,
    realized > 0n ? "filled" : "partial", null);
}

// Persist a live result + roll up the strategy aggregates (budget, P&L, win/loss
// streak). Trips the consecutive-loss auto-stop when the brake threshold is hit.
async function recordLiveResult(
  s: ArbStrategy, opp: ArbOpportunity, solIn: bigint, realizedLamports: bigint,
  actualSpentLamports: bigint,
  buySig: string | null, sellSig: string | null, status: string, errorMessage: string | null,
): Promise<void> {
  const solPrice = await getSolPriceUsd();
  const resultMicroUsd = BigInt(Math.round((Number(realizedLamports) / LAMPORTS_PER_SOL) * solPrice * 1e6));
  await storage.addArbExecution({
    strategyId: s.id, mint: opp.mint, symbol: opp.symbol,
    buyDex: opp.buyPool?.dex ?? "", sellDex: opp.sellPool?.dex ?? "",
    tradeSizeUsd: s.maxTradeUsd,
    grossSpreadBps: Math.round(opp.grossSpreadPct * 100),
    estCostBps: Math.round(opp.estCostPct * 100),
    netEdgeBps: Math.round(opp.netEdgePct * 100),
    mode: "live",
    solInLamports: solIn.toString(),
    solOutLamports: (solIn + realizedLamports > 0n ? solIn + realizedLamports : 0n).toString(),
    buySig, sellSig,
    resultMicroUsd: resultMicroUsd.toString(),
    status, errorMessage,
  });

  const fresh = await storage.getArbStrategy(s.id);
  if (!fresh) return;
  const won = realizedLamports > 0n;
  // Roll up ACTUAL on-chain spend (net principal consumed), never the intended
  // trade size — a failed build must not burn budget it never deployed.
  const newSpent = (BigInt(fresh.spentLamports) + actualSpentLamports).toString();
  const newPnl = (BigInt(fresh.realizedPnlLamports) + realizedLamports).toString();
  const consecutiveLosses = won ? 0 : fresh.consecutiveLosses + 1;
  await storage.updateArbStrategy(s.id, {
    spentLamports: newSpent,
    realizedPnlLamports: newPnl,
    tradesExecuted: fresh.tradesExecuted + 1,
    wins: fresh.wins + (won ? 1 : 0),
    consecutiveLosses,
  });

  if (consecutiveLosses >= fresh.lossStopCount) {
    await storage.addArbExecution({
      strategyId: s.id, mint: "", symbol: "", buyDex: "", sellDex: "",
      tradeSizeUsd: 0, grossSpreadBps: 0, estCostBps: 0, netEdgeBps: 0,
      mode: "live", solInLamports: "0", solOutLamports: "0",
      buySig: null, sellSig: null, resultMicroUsd: "0", status: "failed",
      errorMessage: `Auto-stopped after ${consecutiveLosses} consecutive losing trades. Funds swept back to your wallet.`,
    });
    await storage.updateArbStrategy(s.id, { status: "stopped", nextRunAt: null });
    await sweepAllToWithdraw(fresh, loadKeypair(fresh.encryptedKey));
  }
}

// ─── Paper simulation ─────────────────────────────────────────────────────────
async function simulatePaperArb(s: ArbStrategy, opp: ArbOpportunity): Promise<void> {
  // Scanner already nets out fees + impact; estProfitUsd is the honest expected
  // keep for this trade size. Paper assumes it's fully fillable this instant.
  const resultMicroUsd = BigInt(Math.round(opp.estProfitUsd * 1e6));
  await storage.addArbExecution({
    strategyId: s.id, mint: opp.mint, symbol: opp.symbol,
    buyDex: opp.buyPool?.dex ?? "", sellDex: opp.sellPool?.dex ?? "",
    tradeSizeUsd: s.maxTradeUsd,
    grossSpreadBps: Math.round(opp.grossSpreadPct * 100),
    estCostBps: Math.round(opp.estCostPct * 100),
    netEdgeBps: Math.round(opp.netEdgePct * 100),
    mode: "paper", solInLamports: "0", solOutLamports: "0",
    buySig: null, sellSig: null,
    resultMicroUsd: resultMicroUsd.toString(),
    status: "filled", errorMessage: null,
  });
  const fresh = await storage.getArbStrategy(s.id);
  if (!fresh) return;
  const won = resultMicroUsd > 0n;
  await storage.updateArbStrategy(s.id, {
    paperPnlMicroUsd: (BigInt(fresh.paperPnlMicroUsd) + resultMicroUsd).toString(),
    tradesExecuted: fresh.tradesExecuted + 1,
    wins: fresh.wins + (won ? 1 : 0),
  });
}

// ─── Sweep worker wallet back to the owner ───────────────────────────────────
async function sweepAllToWithdraw(s: ArbStrategy, kp: Keypair): Promise<void> {
  const owner = kp.publicKey;
  const dest = new PublicKey(s.withdrawAddress);

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
      const latest = await conn.getLatestBlockhash("confirmed");
      tx.recentBlockhash = latest.blockhash;
      tx.feePayer = owner;
      tx.sign(kp);
      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
      await conn.confirmTransaction({ signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, "confirmed");
    } catch {
      // best-effort; leftover positions can be swept again on a later stop/cancel
    }
  }

  try {
    const balance = await getSolBalanceLamports(owner.toBase58());
    const sendable = balance - FEE_RESERVE_LAMPORTS;
    if (sendable > DUST_LAMPORTS) {
      const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: owner, toPubkey: dest, lamports: Number(sendable) }),
      );
      const latest = await conn.getLatestBlockhash("confirmed");
      tx.recentBlockhash = latest.blockhash;
      tx.feePayer = owner;
      tx.sign(kp);
      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
      await conn.confirmTransaction({ signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, "confirmed");
    }
  } catch {
    // best-effort
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────
export async function tryActivateArbStrategy(id: string): Promise<ArbStrategy> {
  const s = await storage.getArbStrategy(id);
  if (!s) throw new Error("Arb bot not found.");
  if (s.status === "active") return s;
  if (s.status !== "awaiting_funds" && s.status !== "paused") {
    throw new Error(`Arb bot is ${s.status} and cannot be started.`);
  }
  // Live mode needs the worker wallet funded before it can trade.
  if (s.mode === "live") {
    const balance = await getSolBalanceLamports(s.workerWallet);
    if (balance < MIN_TRADE_LAMPORTS + FEE_RESERVE_LAMPORTS) {
      throw new Error(
        `Worker wallet only holds ${(Number(balance) / LAMPORTS_PER_SOL).toFixed(4)} SOL. ` +
        `Fund it from your main wallet first.`,
      );
    }
  }
  const updated = await storage.updateArbStrategy(id, { status: "active", nextRunAt: new Date() });
  if (!updated) throw new Error("Failed to start arb bot.");
  return updated;
}

export async function pauseArbStrategy(id: string): Promise<ArbStrategy | undefined> {
  return storage.updateArbStrategy(id, { status: "paused", nextRunAt: null });
}

// Stop + sweep everything back to the owner's main wallet. Idempotent-ish.
export async function stopAndWithdrawArbStrategy(id: string): Promise<void> {
  const s = await storage.getArbStrategy(id);
  if (!s) throw new Error("Arb bot not found.");
  await storage.updateArbStrategy(id, { status: "stopped", nextRunAt: null });
  if (s.mode === "live") {
    await sweepAllToWithdraw(s, loadKeypair(s.encryptedKey));
  }
}

// ─── Tick ─────────────────────────────────────────────────────────────────────
async function processArbTick(snapshot: ArbStrategy): Promise<void> {
  const s = await storage.getArbStrategy(snapshot.id);
  if (!s || s.status !== "active") return;
  const now = new Date();

  // Live budget exhausted → nothing left to deploy; stop + sweep.
  if (s.mode === "live" && BigInt(s.spentLamports) >= BigInt(s.budgetLamports)) {
    await storage.updateArbStrategy(s.id, { status: "stopped", nextRunAt: null });
    await sweepAllToWithdraw(s, loadKeypair(s.encryptedKey));
    return;
  }

  const advance = async () => {
    // Re-read status: a live trade may have auto-stopped (loss brake / budget
    // exhausted) or the user may have paused/stopped mid-tick. Don't resurrect
    // nextRunAt on a strategy that's no longer active.
    const cur = await storage.getArbStrategy(s.id);
    if (!cur || cur.status !== "active") return;
    await storage.updateArbStrategy(s.id, {
      nextRunAt: new Date(now.getTime() + s.intervalSeconds * 1000),
    });
  };

  let opp: ArbOpportunity | null = null;
  try {
    opp = await findBestOpportunity(s);
  } catch {
    await advance();
    return;
  }

  // No qualifying opportunity, or it doesn't clear the user's net-edge floor.
  if (!opp || Math.round(opp.netEdgePct * 100) < s.minNetEdgeBps) {
    await advance();
    return;
  }

  try {
    if (s.mode === "paper") {
      await simulatePaperArb(s, opp);
    } else {
      await executeLiveArb(s, opp);
    }
  } catch (e: any) {
    console.error(`[arb-executor] trade failed for ${s.id}:`, e?.message ?? e);
  }
  await advance();
}

// ─── Scheduler ──────────────────────────────────────────────────────────────
let schedulerStarted = false;
const inFlight = new Set<string>();
const TICK_MS = 20_000;

async function tick(): Promise<void> {
  if (!isEncryptionConfigured()) return;
  let due: ArbStrategy[] = [];
  try {
    due = await storage.getDueArbStrategies(new Date());
  } catch (e: any) {
    console.error("[arb-executor] failed to fetch due bots:", e?.message ?? e);
    return;
  }
  for (const s of due) {
    if (inFlight.has(s.id)) continue;
    inFlight.add(s.id);
    processArbTick(s)
      .catch((e) => console.error(`[arb-executor] tick failed for ${s.id}:`, e?.message ?? e))
      .finally(() => inFlight.delete(s.id));
  }
}

export function startArbExecutorScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  if (!isEncryptionConfigured()) {
    console.warn(
      "[arb-executor] AUTO_STRATEGY_ENCRYPTION_KEY not set — scheduler idle. " +
      "Set the secret to enable the arbitrage executor.",
    );
  } else {
    console.log("[arb-executor] scheduler started (tick every 20s).");
  }
  setInterval(() => { void tick(); }, TICK_MS);
}
