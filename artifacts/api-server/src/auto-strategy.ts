// ─── Automated Strategy Bot — server-side execution engine + scheduler ───────
//
// This is the deliberate, tightly-scoped exception to PAIF's "keys never leave
// the browser" rule: an automated, budget-capped, time-boxed bot must keep
// trading while the user's browser is closed, which is impossible with a
// purely client-signed model. The user's MAIN wallet is never touched. Instead
// we generate a dedicated, budget-only "trading wallet" whose secret key lives
// ONLY here, encrypted at rest (AES-256-GCM). The user funds it from their main
// wallet; the bot trades with it inside hard rails (budget cap, time window,
// revocable any time); leftover assets sweep back to the user's main wallet.
//
// Reused infra: pump.ts buildBuy/SellTransaction (PAIF fee auto-injected +
// PumpPortal/manual routing), jupiter.ts for graduated tokens. Credit gating
// mirrors the bump bot (one bump-credit burned per executed slice).

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
import { buildBuyTransaction, buildSellTransaction, fetchBondingCurve, calcSellSol } from "./pump";
import { getSwapQuote, getSwapTransaction, SOL_MINT } from "./jupiter";
import type { AutoStrategy } from "@workspace/db";

const HELIUS_KEY = process.env.HELIUS_API_KEY;
const RPC_URL = HELIUS_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`
  : "https://api.mainnet-beta.solana.com";
const conn = new Connection(RPC_URL, { commitment: "confirmed", fetch: rpcFetchWithFallback });

// Leave this much SOL in the trading wallet at all times to cover the network
// fee + priority fee of the *next* transaction. 2x a typical 5k-lamport fee.
const FEE_RESERVE_LAMPORTS = 10_000n;
// Don't bother moving sub-dust amounts (transfer would cost more than it moves).
const DUST_LAMPORTS = 5_000n;
// Minimum a single buy slice must be worth, or we skip it (a sub-dust swap just
// burns fees). 0.001 SOL.
const MIN_BUY_LAMPORTS = 1_000_000n;

// Platform treasury — receives the one-time per-extra-wallet setup fee. Same
// address as the swap-fee / rent treasury used elsewhere; overridable via env.
const PLATFORM_TREASURY = new PublicKey(
  process.env.PAIF_FEE_VAULT || "5x9y9cboqWWkckVmyqheQJyorojZrKvsv9SLjxNmZKNr",
);
// Flat one-time platform fee charged per EXTRA rotation wallet at first
// activation (the primary wallet is free). 0.002 SOL — roughly the on-chain ATA
// rent the platform would otherwise reclaim on close, but collected upfront so
// it applies even when the user keeps the wallets open and refills them.
const WALLET_SETUP_FEE_LAMPORTS = 2_000_000n;

// ─── Encryption at rest (AES-256-GCM) ────────────────────────────────────────
// Key is lazy-loaded so the app still boots without the secret; we fail CLOSED
// at create/execute time instead. Format: ivB64:tagB64:cipherB64.
export function isEncryptionConfigured(): boolean {
  return !!process.env.AUTO_STRATEGY_ENCRYPTION_KEY;
}

function getEncryptionKey(): Buffer {
  const raw = process.env.AUTO_STRATEGY_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "AUTO_STRATEGY_ENCRYPTION_KEY is not configured. The automated strategy bot " +
      "cannot generate or operate trading wallets without it.",
    );
  }
  // Normalize any passphrase/length to a stable 32-byte key.
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

// ─── Read-session tokens ────────────────────────────────────────────────────
// Reads (list/detail) expose private strategy config, execution history, and
// live trading-wallet balances, so they must be owner-gated too. Asking the
// wallet to sign on every 10s poll is unusable, so the owner signs ONCE to mint
// a short-lived HMAC token (keyed off the same server secret) which then
// authorizes polling. Stateless: no server-side session store needed.
const READ_TOKEN_TTL_MS = 30 * 60 * 1000;

export function issueReadToken(ownerWallet: string, ttlMs: number = READ_TOKEN_TTL_MS): string {
  const exp = Date.now() + ttlMs;
  const payload = `${ownerWallet}.${exp}`;
  const mac = createHmac("sha256", getEncryptionKey()).update(payload).digest("base64url");
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${mac}`;
}

// Returns the token's owner wallet when valid + unexpired, else null.
export function verifyReadToken(token: string): string | null {
  try {
    const [payloadB64, mac] = token.split(".");
    if (!payloadB64 || !mac) return null;
    const payload = Buffer.from(payloadB64, "base64url").toString("utf8");
    const expected = createHmac("sha256", getEncryptionKey()).update(payload).digest("base64url");
    const macBuf = Buffer.from(mac);
    const expBuf = Buffer.from(expected);
    if (macBuf.length !== expBuf.length || !timingSafeEqual(macBuf, expBuf)) return null;
    const [ownerWallet, expStr] = payload.split(".");
    if (!ownerWallet || !expStr || Date.now() > Number(expStr)) return null;
    return ownerWallet;
  } catch {
    return null;
  }
}

// Generate a fresh trading wallet. Returns the public key (safe to store/show)
// and the encrypted secret key (opaque blob). The plaintext key only ever
// exists transiently inside this function.
export function generateTradingWallet(): { pubkey: string; encryptedKey: string } {
  const kp = Keypair.generate();
  const secret = bs58.encode(kp.secretKey);
  const encryptedKey = encryptSecret(secret);
  return { pubkey: kp.publicKey.toBase58(), encryptedKey };
}

function loadKeypair(encryptedKey: string): Keypair {
  const secret = decryptSecret(encryptedKey);
  return Keypair.fromSecretKey(bs58.decode(secret));
}

// Load every trading keypair for a strategy: wallet #0 (encryptedKey) plus any
// rotation wallets in extraEncryptedKeys. Order is stable so the slice
// round-robin (sliceIndex % length) maps to the same wallet each tick.
function loadAllKeypairs(s: AutoStrategy): Keypair[] {
  const blobs = [s.encryptedKey, ...((s.extraEncryptedKeys ?? []) as string[])];
  return blobs.map(loadKeypair);
}

// Public pubkeys for every wallet in a strategy (wallet #0 + rotation wallets).
function allWalletPubkeys(s: AutoStrategy): string[] {
  return [s.tradingWallet, ...((s.extraWallets ?? []) as string[])];
}

// ─── On-chain helpers ────────────────────────────────────────────────────────
export async function getSolBalanceLamports(pubkey: string): Promise<bigint> {
  const lamports = await conn.getBalance(new PublicKey(pubkey), "confirmed");
  return BigInt(lamports);
}

// Sum of SOL across several wallets; per-wallet RPC failures count as 0 so one
// flaky read never blocks an activation.
async function getTotalBalanceLamports(pubkeys: string[]): Promise<bigint> {
  let total = 0n;
  for (const p of pubkeys) {
    total += await getSolBalanceLamports(p).catch(() => 0n);
  }
  return total;
}

interface TokenHolding {
  mint: string;
  amountRaw: bigint;
  decimals: number;
  programId: PublicKey;
  ata: PublicKey;
}

// Reads every SPL token account (both Token and Token-2022 programs — pump.fun
// launches use both) held by `owner`. When includeEmpty is true, zero-balance
// accounts are returned too so the sweep can close them and reclaim their rent
// (~0.002 SOL each) — otherwise that rent is stranded forever.
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
      const mint = info.mint as string;
      const decimals = Number(info.tokenAmount?.decimals ?? 0);
      holdings.push({
        mint,
        amountRaw,
        decimals,
        programId,
        // Use the real account pubkey rather than re-deriving — handles the rare
        // case where the holding sits in a non-canonical account.
        ata: pubkey,
      });
    }
  }
  return holdings;
}

async function getMintDecimals(mint: string): Promise<number> {
  const info = await conn.getParsedAccountInfo(new PublicKey(mint), "confirmed");
  const dec = (info.value?.data as any)?.parsed?.info?.decimals;
  return typeof dec === "number" ? dec : 6;
}

// Sign a base64 VersionedTransaction with `kp`, broadcast, and wait for
// confirmation. Returns the signature.
async function signSendConfirm(b64: string, kp: Keypair): Promise<string> {
  const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
  tx.sign([kp]);
  const sig = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  const latest = await conn.getLatestBlockhash("confirmed");
  const result = await conn.confirmTransaction(
    { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    "confirmed",
  );
  if (result.value.err) {
    throw new Error(`Transaction failed on-chain: ${JSON.stringify(result.value.err)}`);
  }
  return sig;
}

// ─── Trade primitives (pump.fun first, Jupiter fallback for graduated) ────────
async function executeBuy(
  kp: Keypair,
  mint: string,
  solLamports: bigint,
  slippageBps: number,
): Promise<{ signature: string; tokenAmountRaw: string }> {
  const userAddr = kp.publicKey.toBase58();
  try {
    const built = await buildBuyTransaction(mint, userAddr, Number(solLamports), slippageBps);
    const signature = await signSendConfirm(built.transaction, kp);
    return { signature, tokenAmountRaw: built.tokensOut };
  } catch (e: any) {
    if (!String(e?.message ?? "").toLowerCase().includes("graduated")) throw e;
    // Graduated → trade on Jupiter (SOL → token).
    const quote = await getSwapQuote(SOL_MINT, mint, Number(solLamports), slippageBps);
    const swap = await getSwapTransaction(quote as any, userAddr);
    const signature = await signSendConfirm(swap.swapTransaction, kp);
    return { signature, tokenAmountRaw: quote.outAmount ?? "0" };
  }
}

async function executeSell(
  kp: Keypair,
  mint: string,
  tokenAmountRaw: bigint,
  decimals: number,
  slippageBps: number,
): Promise<{ signature: string; solOut: string }> {
  const userAddr = kp.publicKey.toBase58();
  const uiAmount = Number(tokenAmountRaw) / Math.pow(10, decimals);
  try {
    const built = await buildSellTransaction(mint, userAddr, uiAmount, decimals, slippageBps);
    const signature = await signSendConfirm(built.transaction, kp);
    return { signature, solOut: built.solOut };
  } catch (e: any) {
    if (!String(e?.message ?? "").toLowerCase().includes("graduated")) throw e;
    // Graduated → Jupiter (token → SOL). Uses the raw token amount directly.
    const quote = await getSwapQuote(mint, SOL_MINT, Number(tokenAmountRaw), slippageBps);
    const swap = await getSwapTransaction(quote as any, userAddr);
    const signature = await signSendConfirm(swap.swapTransaction, kp);
    return { signature, solOut: quote.outAmount ?? "0" };
  }
}

// ─── Activation: flip awaiting_funds → active once the wallet is funded ───────
// Returns the strategy if it became (or already was) active, else throws with a
// user-readable reason.
export async function tryActivateStrategy(id: string): Promise<AutoStrategy> {
  const s = await storage.getAutoStrategy(id);
  if (!s) throw new Error("Strategy not found.");
  if (s.status === "active") return s;
  if (s.status !== "awaiting_funds" && s.status !== "paused") {
    throw new Error(`Strategy is ${s.status} and cannot be started.`);
  }
  // First activation of a multi-wallet strategy: funds all sit in the primary
  // wallet (the only address the user funds), so check it there, split across the
  // rotation wallets, and mark distributed. On resume, funds are already spread —
  // check the combined total instead.
  const needsDistribution = ((s.extraWallets ?? []).length > 0) && !s.distributedAt;
  const balance = needsDistribution
    ? await getSolBalanceLamports(s.tradingWallet)
    : await getTotalBalanceLamports(allWalletPubkeys(s));
  // Need at least one min-buy plus a fee reserve to do anything useful.
  if (balance < MIN_BUY_LAMPORTS + FEE_RESERVE_LAMPORTS) {
    throw new Error(
      `Trading wallet only holds ${(Number(balance) / LAMPORTS_PER_SOL).toFixed(4)} SOL. ` +
      `Fund it from your main wallet first.`,
    );
  }
  if (needsDistribution) {
    // Collect the one-time platform setup fee BEFORE splitting. The slot is
    // claimed ATOMICALLY (compare-and-set setupFeePaidAt where null) so two
    // concurrent Start requests can't both charge the treasury, and a retried
    // Start (distributedAt still null after a partial split) skips re-charging.
    // Fee comes out of the primary wallet the user funded, into the treasury.
    if (!s.setupFeePaidAt) {
      const claimed = await storage.claimAutoStrategySetupFee(s.id);
      // claimed === false means the fee was already handled (prior attempt or a
      // concurrent activation) — don't charge again. Only the winner charges.
      if (claimed) {
        const result = await collectSetupFee(s);
        if (result === "failed_safe") {
          // Tx never broadcast — release the claim so a later Start can retry.
          await storage.updateAutoStrategy(id, { setupFeePaidAt: null });
          throw new Error(
            "Couldn't collect the wallet setup fee. Make sure the funding wallet " +
            "has enough SOL, then press Start again.",
          );
        }
        if (result === "failed_uncertain") {
          // Tx broadcast but unconfirmed — keep the claim (no double charge) and
          // stop activation; the user can press Start again to continue. If the
          // fee landed, the next Start skips it; if not, it's a rare platform loss.
          throw new Error(
            "The setup fee was submitted but not yet confirmed. Wait a moment, " +
            "then press Start again to continue — you won't be charged twice.",
          );
        }
      }
    }
    const allFunded = await distributeFundsToWallets(s);
    // Only mark distributed once EVERY rotation wallet is funded. If a split tx
    // failed, leave distributedAt null so the next Start retries the shortfall
    // (idempotent) instead of locking the strategy active with empty wallets that
    // would silently no-op every slice. Don't activate on a partial split.
    if (!allFunded) {
      throw new Error(
        "Couldn't fund all rotation wallets (a split transfer failed). " +
        "Press Start again to retry — already-funded wallets are skipped.",
      );
    }
    await storage.updateAutoStrategy(id, { distributedAt: new Date() });
  }
  const updated = await storage.updateAutoStrategy(id, {
    status: "active",
    nextRunAt: new Date(),
  });
  if (!updated) throw new Error("Failed to activate strategy.");
  return updated;
}

// Split the primary wallet's balance evenly across all rotation wallets. Runs
// once, at first activation of a multi-wallet strategy. Each transfer is its own
// confirmed tx; a failure is logged but doesn't abort the rest (the slice engine
// and final sweep both tolerate uneven per-wallet balances). On-chain this links
// the rotation wallets to the primary — disclosed in the UI as the cost of the
// "fund once" convenience.
// Returns true only if every rotation wallet ended up funded to the target share
// (so the caller can decide whether to mark the strategy distributed). Idempotent
// and self-correcting: the per-wallet target is derived from the COMBINED balance
// across primary + extras (funds only move between these wallets, so the combined
// total is stable across retries), and each extra is topped up only by its
// shortfall. A retry after a partial failure therefore skips already-funded
// wallets and funds just the ones still short.
async function distributeFundsToWallets(s: AutoStrategy): Promise<boolean> {
  const extras = (s.extraWallets ?? []) as string[];
  if (extras.length === 0) return true;
  const primaryKp = loadKeypair(s.encryptedKey);
  const perTransferFee = 5_000n;
  // Combined across all wallets so the target is stable on retries.
  const combinedTotal = await getTotalBalanceLamports(allWalletPubkeys(s));
  const distributable = combinedTotal - FEE_RESERVE_LAMPORTS - perTransferFee * BigInt(extras.length);
  if (distributable <= 0n) return false;
  // Even split across ALL wallets (primary keeps its share + the remainder).
  const perWallet = distributable / BigInt(extras.length + 1);
  if (perWallet < DUST_LAMPORTS) return false; // too little to be worth splitting
  let allFunded = true;
  for (const pub of extras) {
    try {
      // Skip / top-up: only move the shortfall so retries don't double-fund.
      const have = await getSolBalanceLamports(pub);
      if (have >= perWallet) continue;
      const shortfall = perWallet - have;
      if (shortfall < DUST_LAMPORTS) continue; // close enough; don't burn a fee
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: primaryKp.publicKey,
          toPubkey: new PublicKey(pub),
          lamports: Number(shortfall),
        }),
      );
      const latest = await conn.getLatestBlockhash("confirmed");
      tx.recentBlockhash = latest.blockhash;
      tx.feePayer = primaryKp.publicKey;
      tx.sign(primaryKp);
      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
      await conn.confirmTransaction({ signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, "confirmed");
    } catch (e: any) {
      allFunded = false;
      await storage.addAutoStrategyExecution({
        strategyId: s.id, tokenMint: SOL_MINT, action: "split",
        amountLamports: perWallet.toString(), tokenAmount: "0",
        txSignature: null, status: "failed",
        errorMessage: "Wallet funding split failed: " + String(e?.message ?? e).slice(0, 250),
      });
    }
  }
  return allFunded;
}

// Outcome of a setup-fee charge attempt:
//  - "ok": confirmed on-chain.
//  - "failed_safe": tx NEVER broadcast (build/sign/send threw) — safe to release
//    the claim so a later Start can retry without risk of a double charge.
//  - "failed_uncertain": tx WAS broadcast but confirmation didn't land. The
//    transfer may or may not have settled, so we must NOT release the claim or
//    retry (that could charge the treasury twice). The signature is logged for
//    manual reconciliation.
type SetupFeeResult = "ok" | "failed_safe" | "failed_uncertain";

// Collect the one-time platform setup fee (flat per EXTRA rotation wallet) from
// the primary wallet into the treasury. Caller has already atomically claimed
// the fee slot (setupFeePaidAt stamped), so this just performs the transfer.
async function collectSetupFee(s: AutoStrategy): Promise<SetupFeeResult> {
  const extras = (s.extraWallets ?? []) as string[];
  if (extras.length === 0) return "ok";
  const fee = WALLET_SETUP_FEE_LAMPORTS * BigInt(extras.length);
  if (fee <= 0n) return "ok";
  let sig: string;
  try {
    const primaryKp = loadKeypair(s.encryptedKey);
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: primaryKp.publicKey,
        toPubkey: PLATFORM_TREASURY,
        lamports: Number(fee),
      }),
    );
    const latest = await conn.getLatestBlockhash("confirmed");
    tx.recentBlockhash = latest.blockhash;
    tx.feePayer = primaryKp.publicKey;
    tx.sign(primaryKp);
    sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    // Confirm separately: a failure here means the tx may have landed.
    try {
      await conn.confirmTransaction({ signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, "confirmed");
    } catch (confirmErr: any) {
      await storage.addAutoStrategyExecution({
        strategyId: s.id, tokenMint: SOL_MINT, action: "setup_fee",
        amountLamports: fee.toString(), tokenAmount: "0",
        txSignature: sig, status: "failed",
        errorMessage: "Setup fee broadcast but not confirmed (no retry): " + String(confirmErr?.message ?? confirmErr).slice(0, 200),
      });
      return "failed_uncertain";
    }
    await storage.addAutoStrategyExecution({
      strategyId: s.id, tokenMint: SOL_MINT, action: "setup_fee",
      amountLamports: fee.toString(), tokenAmount: "0",
      txSignature: sig, status: "success", errorMessage: null,
    });
    return "ok";
  } catch (e: any) {
    // Never broadcast — safe to release and retry later.
    await storage.addAutoStrategyExecution({
      strategyId: s.id, tokenMint: SOL_MINT, action: "setup_fee",
      amountLamports: fee.toString(), tokenAmount: "0",
      txSignature: null, status: "failed",
      errorMessage: "Wallet setup fee failed: " + String(e?.message ?? e).slice(0, 250),
    });
    return "failed_safe";
  }
}

// ─── Sweep everything back to the user's main wallet ─────────────────────────
// Moves all SPL positions (both programs, closing the empty accounts to reclaim
// rent for the user) and all but a tiny fee reserve of SOL to withdrawAddress.
async function sweepAllToWithdraw(s: AutoStrategy, kp: Keypair): Promise<void> {
  const owner = kp.publicKey;
  const dest = new PublicKey(s.withdrawAddress);

  // 1. Token positions — one tx per account keeps each well under the size
  // limit. includeEmpty: also close zero-balance accounts so their ~0.002 SOL
  // rent isn't stranded.
  const holdings = await getTokenHoldings(owner, true);
  for (const h of holdings) {
    try {
      const tx = new Transaction();
      // Only move tokens when there's a non-zero balance; empty accounts are
      // just closed for their rent.
      if (h.amountRaw > 0n) {
        const destAta = getAssociatedTokenAddressSync(new PublicKey(h.mint), dest, true, h.programId);
        tx.add(createAssociatedTokenAccountIdempotentInstruction(owner, destAta, dest, new PublicKey(h.mint), h.programId));
        tx.add(createTransferCheckedInstruction(h.ata, new PublicKey(h.mint), destAta, owner, h.amountRaw, h.decimals, [], h.programId));
      }
      // Reclaim the account rent for the user — rent lamports go to dest, close
      // authority stays with the trading wallet (non-custodial-safe).
      tx.add(createCloseAccountInstruction(h.ata, dest, owner, [], h.programId));
      const latest = await conn.getLatestBlockhash("confirmed");
      tx.recentBlockhash = latest.blockhash;
      tx.feePayer = owner;
      tx.sign(kp);
      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
      await conn.confirmTransaction({ signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, "confirmed");
      await storage.addAutoStrategyExecution({
        strategyId: s.id, tokenMint: h.mint, action: "withdraw",
        amountLamports: "0", tokenAmount: h.amountRaw.toString(),
        txSignature: sig, status: "success", errorMessage: null,
      });
    } catch (e: any) {
      await storage.addAutoStrategyExecution({
        strategyId: s.id, tokenMint: h.mint, action: "withdraw",
        amountLamports: "0", tokenAmount: h.amountRaw.toString(),
        txSignature: null, status: "failed", errorMessage: String(e?.message ?? e).slice(0, 300),
      });
    }
  }

  // 2. Remaining SOL minus a one-tx fee reserve.
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
      await storage.addAutoStrategyExecution({
        strategyId: s.id, tokenMint: SOL_MINT, action: "withdraw",
        amountLamports: sendable.toString(), tokenAmount: "0",
        txSignature: sig, status: "success", errorMessage: null,
      });
    }
  } catch (e: any) {
    await storage.addAutoStrategyExecution({
      strategyId: s.id, tokenMint: SOL_MINT, action: "withdraw",
      amountLamports: "0", tokenAmount: "0",
      txSignature: null, status: "failed", errorMessage: String(e?.message ?? e).slice(0, 300),
    });
  }
}

// Public: user-initiated cancel + withdraw. Idempotent-ish (re-running on an
// already-cancelled strategy just re-sweeps any residue).
export async function cancelAndWithdrawStrategy(id: string): Promise<void> {
  const s = await storage.getAutoStrategy(id);
  if (!s) throw new Error("Strategy not found.");
  await storage.updateAutoStrategy(id, { status: "cancelled", nextRunAt: null });
  await sweepStrategyWallets(s);
}

// ─── Sell primitives (manual exit + take-profit) ─────────────────────────────
// Best-effort SOL valuation of `amountRaw` of `mint`. Pump.fun bonding-curve
// price first (works PRE-graduation, which Jupiter can't route), then Jupiter
// for graduated tokens. Returns 0 when neither can price it (caller skips it).
async function quoteTokenValueLamports(
  mint: string,
  amountRaw: bigint,
  slippageBps: number,
): Promise<bigint> {
  if (amountRaw <= 0n) return 0n;
  try {
    const curve = await fetchBondingCurve(new PublicKey(mint));
    if (curve && !curve.complete) {
      const out = calcSellSol(curve, amountRaw);
      if (out > 0n) return out;
    }
  } catch {
    // Not a pump curve / graduated / RPC hiccup — fall through to Jupiter.
  }
  try {
    const quote = await getSwapQuote(mint, SOL_MINT, Number(amountRaw), slippageBps);
    return BigInt(quote.outAmount ?? "0");
  } catch {
    return 0n;
  }
}

// Sell `sellBps` (basis points, 10000 = 100%) of every strategy-mint position
// held across all wallets, back to SOL. Records each sell (success or failure)
// to the execution log. Returns nothing — callers decide whether to sweep.
async function sellPositions(s: AutoStrategy, sellBps: bigint): Promise<void> {
  const strategyMints = new Set(s.tokens);
  for (const kp of loadAllKeypairs(s)) {
    let holdings: TokenHolding[] = [];
    try {
      holdings = await getTokenHoldings(kp.publicKey);
    } catch {
      continue;
    }
    for (const h of holdings) {
      if (!strategyMints.has(h.mint) || h.amountRaw <= 0n) continue;
      const toSell = sellBps >= 10000n ? h.amountRaw : (h.amountRaw * sellBps) / 10000n;
      if (toSell <= 0n) continue;
      try {
        const { signature, solOut } = await executeSell(kp, h.mint, toSell, h.decimals, s.slippageBps);
        await storage.addAutoStrategyExecution({
          strategyId: s.id, tokenMint: h.mint, action: "sell",
          amountLamports: solOut, tokenAmount: toSell.toString(),
          txSignature: signature, status: "success", errorMessage: null,
        });
      } catch (e: any) {
        await storage.addAutoStrategyExecution({
          strategyId: s.id, tokenMint: h.mint, action: "sell",
          amountLamports: "0", tokenAmount: toSell.toString(),
          txSignature: null, status: "failed", errorMessage: String(e?.message ?? e).slice(0, 300),
        });
      }
    }
  }
}

// Public: user-initiated MANUAL "sell everything now" — liquidate ALL positions
// to SOL and sweep the proceeds back to the owner's main wallet, then stop the
// strategy. Distinct from cancel (which returns tokens UN-sold). The status flip
// runs first so the scheduler stops placing new buys mid-liquidation.
export async function liquidateStrategyNow(id: string): Promise<void> {
  // Claim the per-strategy lock the scheduler uses so a double-tap on "sell
  // everything now" (or an overlap with an in-flight slice / take-profit) can't
  // launch two liquidations at once — that would double-spend fees on failing txs.
  if (inFlight.has(id)) throw new Error("This strategy is already selling — give it a moment.");
  inFlight.add(id);
  try {
    const s = await storage.getAutoStrategy(id);
    if (!s) throw new Error("Strategy not found.");
    await storage.updateAutoStrategy(id, { status: "cancelled", nextRunAt: null });
    await sellPositions(s, 10000n);
    // Sweep SOL proceeds + any unsold token remainder + reclaim account rent.
    await sweepStrategyWallets(s);
  } finally {
    inFlight.delete(id);
  }
}

// Take-profit check (one-shot, price-triggered). Fires when the live SOL value
// of the strategy's holdings is up `takeProfitPct`% vs `spentLamports` (buy
// principal). Marks takeProfitFiredAt BEFORE selling so a slow sell can't be
// re-triggered on the next 20s tick (guards against double-firing).
async function checkTakeProfit(snapshot: AutoStrategy): Promise<void> {
  const s = await storage.getAutoStrategy(snapshot.id);
  if (!s || s.status !== "active") return;
  if (s.takeProfitFiredAt) return;
  if (s.takeProfitPct == null || s.takeProfitSellBps == null) return;

  const invested = BigInt(s.spentLamports);
  if (invested <= 0n) return; // nothing bought yet → no basis to measure profit

  // Aggregate held amount per strategy mint across all wallets.
  const strategyMints = new Set(s.tokens);
  const perMint = new Map<string, bigint>();
  for (const pk of allWalletPubkeys(s)) {
    let holdings: TokenHolding[] = [];
    try {
      holdings = await getTokenHoldings(new PublicKey(pk));
    } catch {
      continue;
    }
    for (const h of holdings) {
      if (!strategyMints.has(h.mint) || h.amountRaw <= 0n) continue;
      perMint.set(h.mint, (perMint.get(h.mint) ?? 0n) + h.amountRaw);
    }
  }
  if (perMint.size === 0) return;

  // Value the whole position in SOL.
  let value = 0n;
  for (const [mint, amount] of Array.from(perMint.entries())) {
    value += await quoteTokenValueLamports(mint, amount, s.slippageBps);
  }
  if (value <= 0n) return;

  const target = (invested * BigInt(100 + s.takeProfitPct)) / 100n;
  if (value < target) return;

  // Claim the one-shot fire slot ATOMICALLY at the DB (conditional update where
  // takeProfitFiredAt is null). Only the winner proceeds — this is the true
  // double-fire guard even under a multi-instance deploy; the inFlight lock is
  // just a same-process fast path.
  const claimed = await storage.claimTakeProfitFire(s.id);
  if (!claimed) return;
  await sellPositions(s, BigInt(s.takeProfitSellBps));

  // Selling the whole position realizes the profit — sweep it home and stop the
  // strategy. Partial take-profit leaves the rest running.
  if (s.takeProfitSellBps >= 10000) {
    await storage.updateAutoStrategy(s.id, { status: "completed", nextRunAt: null });
    await sweepStrategyWallets(s);
  }
}

// ─── Slice execution + finalization ──────────────────────────────────────────
// Sweep every wallet (primary + rotation) back to the owner's main wallet.
async function sweepStrategyWallets(s: AutoStrategy): Promise<void> {
  for (const kp of loadAllKeypairs(s)) {
    await sweepAllToWithdraw(s, kp);
  }
}

async function finalizeStrategy(s: AutoStrategy, finalStatus: "completed"): Promise<void> {
  await storage.updateAutoStrategy(s.id, { status: finalStatus, nextRunAt: null });
  // Volume mode must ALWAYS finish flat. The window can expire (or the final
  // slice land) right after a buy but before its paired sell — leaving open
  // token exposure that contradicts "returns flat each cycle". Force-liquidate
  // every strategy position before finishing, even when keepFunds is on
  // (keepFunds then only keeps the resulting SOL parked, never open positions).
  if (s.mode === "volume") {
    await sellPositions(s, 10000n);
  }
  // keepFunds: leave everything parked in the rotation wallets so the user can
  // refill and reuse them. They can still pull out anytime via Cancel & withdraw
  // (which always sweeps). Default: sweep all assets back to the main wallet.
  if (s.keepFunds) return;
  await sweepStrategyWallets(s);
}

async function processStrategyTick(snapshot: AutoStrategy): Promise<void> {
  // Re-read fresh from the DB: the snapshot from getDueAutoStrategies may be
  // stale (e.g. the owner cancelled/paused between fetch and execution). This
  // closes the cancel→tick race so we never place a trade on a strategy that's
  // no longer active.
  const s = await storage.getAutoStrategy(snapshot.id);
  if (!s || s.status !== "active") return;
  const now = new Date();

  // Time-box / completion gate.
  if (now >= new Date(s.windowEndAt) || s.completedSlices >= s.totalSlices) {
    await finalizeStrategy(s, "completed");
    return;
  }

  // Credit gate — one bump-credit per executed slice, mirroring the bump bot.
  const credit = await storage.decrementCredit(s.ownerWallet);
  if (!credit.ok) {
    await storage.addAutoStrategyExecution({
      strategyId: s.id, tokenMint: "", action: "buy",
      amountLamports: "0", tokenAmount: "0", txSignature: null,
      status: "failed", errorMessage: "Out of bump credits — strategy paused. Top up and resume.",
    });
    await storage.updateAutoStrategy(s.id, { status: "paused", nextRunAt: null });
    return;
  }

  // Round-robin the wallet used for THIS slice across all rotation wallets so
  // buys spread over several addresses. Deterministic: slice N always uses wallet
  // N % walletCount. The sell phase rotates the same way; any tokens a wallet
  // doesn't fully liquidate are returned by the final all-wallet sweep.
  const wallets = loadAllKeypairs(s);
  const sliceIndex = s.completedSlices;
  const isVolume = s.mode === "volume";
  // Volume mode alternates buy (even slice) / sell (odd slice). The buy and its
  // paired sell MUST run on the same wallet so the sell finds what the buy just
  // bought — so rotate wallets per cycle (2 slices), not per slice.
  const walletIdx = isVolume
    ? Math.floor(sliceIndex / 2) % wallets.length
    : sliceIndex % wallets.length;
  const kp = wallets[walletIdx];
  const isBuyPhase = isVolume ? sliceIndex % 2 === 0 : sliceIndex < s.buySlices;
  const slippageBps = s.slippageBps;
  // BUDGET ACCOUNTING: spentLamports tracks swap *principal* (the SOL routed
  // into buys), not network/PAIF fees layered on top. The true hard ceiling on
  // outflow is the trading wallet's own balance — the user funds it with exactly
  // what they're willing to risk, and `spendable` below clamps every buy to that
  // balance minus a fee reserve, so actual SOL leaving can never exceed what was
  // funded regardless of fees. The budget cap is therefore a principal-volume
  // limit, and the wallet balance is the absolute cap.
  let spentThisSlice = 0n;

  if (isBuyPhase) {
    let sliceBudget: bigint;
    if (isVolume) {
      // Volume mode RECYCLES the same principal: each buy re-deploys up to the
      // full budget and its paired sell returns it. Cumulative spend is NOT the
      // cap here (that would stop after one cycle) — the wallet balance clamp
      // below is the real hard ceiling, and it winds down naturally as per-cycle
      // fees bleed it, so total outflow can still never exceed what was funded.
      sliceBudget = BigInt(s.budgetLamports);
    } else {
      const budget = BigInt(s.budgetLamports);
      const alreadySpent = BigInt(s.spentLamports);
      const remaining = budget > alreadySpent ? budget - alreadySpent : 0n;
      const isLastBuy = sliceIndex === s.buySlices - 1;
      // Even split across buy slices; the final buy slice spends the remainder so
      // rounding never strands budget.
      sliceBudget = isLastBuy ? remaining : budget / BigInt(s.buySlices);
      if (sliceBudget > remaining) sliceBudget = remaining;
    }

    // Never exceed what's actually in the wallet (minus fee reserve).
    const balance = await getSolBalanceLamports(kp.publicKey.toBase58());
    const spendable = balance > FEE_RESERVE_LAMPORTS ? balance - FEE_RESERVE_LAMPORTS : 0n;
    if (sliceBudget > spendable) sliceBudget = spendable;

    if (sliceBudget >= MIN_BUY_LAMPORTS) {
      for (let i = 0; i < s.tokens.length; i++) {
        const mint = s.tokens[i];
        const bps = BigInt(s.allocationsBps[i] ?? 0);
        const amount = (sliceBudget * bps) / 10000n;
        if (amount < MIN_BUY_LAMPORTS) continue;
        try {
          const { signature, tokenAmountRaw } = await executeBuy(kp, mint, amount, slippageBps);
          spentThisSlice += amount;
          await storage.addAutoStrategyExecution({
            strategyId: s.id, tokenMint: mint, action: "buy",
            amountLamports: amount.toString(), tokenAmount: tokenAmountRaw,
            txSignature: signature, status: "success", errorMessage: null,
          });
        } catch (e: any) {
          await storage.addAutoStrategyExecution({
            strategyId: s.id, tokenMint: mint, action: "buy",
            amountLamports: amount.toString(), tokenAmount: "0",
            txSignature: null, status: "failed", errorMessage: String(e?.message ?? e).slice(0, 300),
          });
        }
      }
    }
  } else {
    // Sell phase. Trade mode liquidates a fair fraction of each held position
    // (final sell slice sells whatever remains). Volume mode dumps the ENTIRE
    // position each cycle so the wallet returns flat and the principal is freed
    // to fund the next buy cycle.
    const sellSlicesTotal = s.totalSlices - s.buySlices;
    const sellIdx = sliceIndex - s.buySlices;
    const remainingSellSlices = BigInt(Math.max(1, sellSlicesTotal - sellIdx));
    const isLastSell = sellIdx === sellSlicesTotal - 1;
    const holdings = await getTokenHoldings(kp.publicKey);
    const strategyMints = new Set(s.tokens);
    for (const h of holdings) {
      if (!strategyMints.has(h.mint)) continue;
      const toSell = isVolume || isLastSell ? h.amountRaw : h.amountRaw / remainingSellSlices;
      if (toSell <= 0n) continue;
      try {
        const { signature, solOut } = await executeSell(kp, h.mint, toSell, h.decimals, slippageBps);
        await storage.addAutoStrategyExecution({
          strategyId: s.id, tokenMint: h.mint, action: "sell",
          amountLamports: solOut, tokenAmount: toSell.toString(),
          txSignature: signature, status: "success", errorMessage: null,
        });
      } catch (e: any) {
        await storage.addAutoStrategyExecution({
          strategyId: s.id, tokenMint: h.mint, action: "sell",
          amountLamports: "0", tokenAmount: toSell.toString(),
          txSignature: null, status: "failed", errorMessage: String(e?.message ?? e).slice(0, 300),
        });
      }
    }
  }

  // Advance the schedule.
  const newSpent = (BigInt(s.spentLamports) + spentThisSlice).toString();
  const completed = s.completedSlices + 1;
  if (completed >= s.totalSlices) {
    const fresh = await storage.updateAutoStrategy(s.id, { spentLamports: newSpent, completedSlices: completed });
    if (fresh) await finalizeStrategy(fresh, "completed");
  } else {
    // Jitter each gap ±40% around the base interval so trades don't land on a
    // robotic fixed cadence — more organic, harder to fingerprint. Never below
    // 30s, never past the window end.
    const factor = 1 + (Math.random() * 2 - 1) * 0.4; // 0.6 … 1.4
    const gap = Math.max(30, Math.round(s.intervalSeconds * factor));
    let next = new Date(now.getTime() + gap * 1000);
    const end = new Date(s.windowEndAt);
    if (next > end) next = end;
    await storage.updateAutoStrategy(s.id, {
      spentLamports: newSpent,
      completedSlices: completed,
      nextRunAt: next,
    });
  }
}

// ─── Scheduler ───────────────────────────────────────────────────────────────
let schedulerStarted = false;
const inFlight = new Set<string>();
const TICK_MS = 20_000;

async function tick(): Promise<void> {
  if (!isEncryptionConfigured()) return; // Nothing can run without the key.
  let due: AutoStrategy[] = [];
  try {
    due = await storage.getDueAutoStrategies(new Date());
  } catch (e: any) {
    console.error("[auto-strategy] failed to fetch due strategies:", e?.message ?? e);
    return;
  }
  for (const s of due) {
    if (inFlight.has(s.id)) continue;
    inFlight.add(s.id);
    // Fire-and-forget per strategy so a slow RPC on one doesn't stall others.
    processStrategyTick(s)
      .catch((e) => console.error(`[auto-strategy] tick failed for ${s.id}:`, e?.message ?? e))
      .finally(() => inFlight.delete(s.id));
  }

  // Take-profit scan — independent of the slice schedule so the trigger reacts
  // to price every tick, not just at slice boundaries. Shares the per-strategy
  // inFlight lock so a take-profit sell can never run concurrently with a slice
  // (or another take-profit pass) on the same strategy.
  let armed: AutoStrategy[] = [];
  try {
    armed = await storage.getArmedTakeProfitStrategies();
  } catch (e: any) {
    console.error("[auto-strategy] failed to fetch take-profit strategies:", e?.message ?? e);
    return;
  }
  for (const s of armed) {
    if (inFlight.has(s.id)) continue;
    inFlight.add(s.id);
    checkTakeProfit(s)
      .catch((e) => console.error(`[auto-strategy] take-profit failed for ${s.id}:`, e?.message ?? e))
      .finally(() => inFlight.delete(s.id));
  }
}

export function startAutoStrategyScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  if (!isEncryptionConfigured()) {
    console.warn(
      "[auto-strategy] AUTO_STRATEGY_ENCRYPTION_KEY not set — scheduler idle. " +
      "Set the secret to enable the automated strategy bot.",
    );
  } else {
    console.log("[auto-strategy] scheduler started (tick every 20s).");
  }
  setInterval(() => { void tick(); }, TICK_MS);
}
