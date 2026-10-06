import { rpcFetchWithFallback } from "./rpc-fallback";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { storage } from "./storage";
import { getSolPriceUsd } from "./solana";
import { CREDIT_PACKS, getPack, PAYMENT_TOLERANCE_PCT } from "@shared/credit-packs";

const HELIUS_KEY = process.env.HELIUS_API_KEY;
const RPC_URL = HELIUS_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`
  : "https://api.mainnet-beta.solana.com";

export const conn = new Connection(RPC_URL, { commitment: "confirmed", fetch: rpcFetchWithFallback });

// Treasury wallet that receives credit-pack purchases. Re-uses the existing
// PAIF_FEE_VAULT — no extra config required. Verified at module load so a
// missing/invalid value crashes startup loudly instead of silently breaking
// purchase verification later.
function loadTreasury(): PublicKey {
  const raw = process.env.PAIF_FEE_VAULT;
  if (!raw) throw new Error("[credits] PAIF_FEE_VAULT env var is required (treasury wallet for credit purchases).");
  try {
    return new PublicKey(raw);
  } catch {
    throw new Error(`[credits] PAIF_FEE_VAULT="${raw}" is not a valid Solana address.`);
  }
}
const TREASURY = loadTreasury();
console.log(`[credits] credit-pack treasury: ${TREASURY.toBase58()}`);

export const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Convert a USD pack price into lamports at the live SOL/USD rate. Falls back
// to a conservative $100/SOL if the price feed is down so users can still buy
// (worst case they pay slightly more SOL — never less, never zero).
export async function quotePackLamports(packId: string): Promise<{
  pack: ReturnType<typeof getPack>;
  solPriceUsd: number;
  lamports: bigint;
  expiresAtMs: number;
}> {
  const pack = getPack(packId);
  if (!pack) throw new Error(`Unknown credit pack: ${packId}`);
  const livePrice = await getSolPriceUsd();
  const solPriceUsd = livePrice && livePrice > 0 ? livePrice : 100;
  const sol = pack.priceUsd / solPriceUsd;
  // Round up to the nearest 100 lamports so payments are always >= the
  // computed minimum even after floating-point truncation.
  const lamports = BigInt(Math.ceil(sol * LAMPORTS_PER_SOL / 100) * 100);
  // Intent expiry is informational — verify() re-evaluates the lamports at
  // confirm time within a tolerance window, so a slightly stale intent still
  // works.
  return { pack, solPriceUsd, lamports, expiresAtMs: Date.now() + 5 * 60_000 };
}

// Verifies an on-chain SOL transfer to TREASURY and grants credits exactly
// once. Returns the new balance + the matched pack. Throws on any check
// failure with a user-readable message.
export async function verifyAndGrant(args: {
  txSignature: string;
  ownerWallet: string;
  packId: string;
}): Promise<{ balance: number; unlimitedSubwallets: boolean; unlimitedUntil: string | null; maxSubwallets: number; alreadyApplied: boolean }> {
  const { txSignature, ownerWallet, packId } = args;

  if (!SOLANA_ADDRESS_REGEX.test(ownerWallet)) {
    throw new Error("Invalid owner wallet address.");
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]{43,90}$/.test(txSignature)) {
    throw new Error("Invalid transaction signature.");
  }
  const pack = getPack(packId);
  if (!pack) throw new Error(`Unknown credit pack: ${packId}`);

  // Idempotency — if we've already credited this signature, return the
  // current balance without re-applying.
  const existing = await storage.getCreditPurchaseBySignature(txSignature);
  if (existing) {
    if (existing.ownerWallet !== ownerWallet) {
      throw new Error("Transaction already credited to a different wallet.");
    }
    const cur = await storage.getCreditBalance(ownerWallet);
    return { balance: cur.balance, unlimitedSubwallets: cur.unlimitedSubwallets, unlimitedUntil: cur.unlimitedUntil, maxSubwallets: cur.maxSubwallets, alreadyApplied: true };
  }

  // Re-quote at confirm time so a stale intent doesn't lock us into a price
  // that no longer reflects the real SOL/USD rate.
  const quote = await quotePackLamports(packId);
  const minLamports = (quote.lamports * BigInt(100 - PAYMENT_TOLERANCE_PCT)) / BigInt(100);

  // Fetch the parsed transaction. We use jsonParsed so SystemProgram.transfer
  // instructions show up with explicit lamports/source/destination fields.
  const parsed = await conn.getParsedTransaction(txSignature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!parsed) {
    throw new Error(
      "Transaction not found yet — wait a few seconds for confirmation, then try again."
    );
  }
  if (parsed.meta?.err) {
    throw new Error(`Transaction failed on-chain: ${JSON.stringify(parsed.meta.err)}`);
  }

  // Replay protection — block historical-tx reuse. Without this, any past SOL
  // transfer the user ever sent to the treasury (e.g. a tip, an old pack, a
  // refund return) could be replayed here to mint fresh credits. Require the
  // tx to have landed in the last 30 minutes; honest buyers' txs confirm in
  // seconds, so this window is comfortably wide while shutting down the abuse.
  const blockTime = parsed.blockTime ?? 0;
  const ageSec = Math.floor(Date.now() / 1000) - blockTime;
  const MAX_AGE_SEC = 30 * 60;
  if (!blockTime || ageSec > MAX_AGE_SEC) {
    throw new Error(
      `Transaction too old (${Math.floor(ageSec / 60)}m): credit purchases must be confirmed within ${MAX_AGE_SEC / 60} minutes. ` +
      `Send a fresh payment to the treasury and retry.`
    );
  }

  // Walk every instruction (top-level + inner) and sum any SystemProgram
  // transfers whose destination is TREASURY and source is ownerWallet.
  const treasuryB58 = TREASURY.toBase58();
  let totalToTreasury = BigInt(0);
  const allInstructions: any[] = [
    ...parsed.transaction.message.instructions,
    ...((parsed.meta?.innerInstructions ?? []).flatMap(g => g.instructions)),
  ];
  for (const ix of allInstructions) {
    const parsedIx = (ix as any).parsed;
    if (!parsedIx) continue;
    if (parsedIx.type !== "transfer") continue;
    const info = parsedIx.info;
    if (!info) continue;
    if (info.destination !== treasuryB58) continue;
    if (info.source !== ownerWallet) continue;
    const lam = BigInt(info.lamports ?? 0);
    totalToTreasury += lam;
  }

  if (totalToTreasury < minLamports) {
    throw new Error(
      `Insufficient payment: tx sent ${totalToTreasury.toString()} lamports to the treasury, ` +
      `expected at least ${minLamports.toString()} (pack '${pack.label}' @ ~${quote.solPriceUsd.toFixed(2)} USD/SOL).`
    );
  }

  // Grant atomically. The unique constraint on tx_signature in the
  // recordCreditPurchaseAndGrant insert means a concurrent retry will throw
  // here, which we re-translate into "already applied" by re-reading.
  try {
    const out = await storage.recordCreditPurchaseAndGrant({
      ownerWallet,
      packId: pack.id,
      lamportsPaid: totalToTreasury,
      creditsToGrant: pack.credits,
      grantUnlimitedSubwallets: pack.unlimitedSubwallets,
      grantMaxSubwallets: pack.maxSubwallets,
      extendUnlimitedMs: pack.unlimitedDurationMs,
      txSignature,
    });
    return {
      balance: out.balance,
      unlimitedSubwallets: out.unlimitedSubwallets,
      unlimitedUntil: out.unlimitedUntil,
      maxSubwallets: out.maxSubwallets,
      alreadyApplied: false,
    };
  } catch (e: any) {
    if (/duplicate key|unique/i.test(e?.message ?? "")) {
      const cur = await storage.getCreditBalance(ownerWallet);
      return { balance: cur.balance, unlimitedSubwallets: cur.unlimitedSubwallets, unlimitedUntil: cur.unlimitedUntil, maxSubwallets: cur.maxSubwallets, alreadyApplied: true };
    }
    throw e;
  }
}

export function getTreasuryAddress(): string {
  return TREASURY.toBase58();
}

// Verifies an on-chain SystemProgram.transfer signed by `ownerWallet` whose
// destination is `sessionWallet` and treats it as proof of intent to delegate
// that session wallet for hands-free bump signing. This collapses the
// previous two-popup flow (signMessage delegation + fund tx) into a single
// wallet popup: the user funds the session wallet once, and that very tx
// authorizes it.
//
// Security checks (must all pass):
//   1. tx must exist on-chain and have committed without error
//   2. tx must be recent (≤30 min) — blocks replay of historical funding txs
//   3. fee payer / signer must equal ownerWallet (no relayed/sponsored txs)
//   4. tx must contain at least one SystemProgram.transfer where
//      source = ownerWallet AND destination = sessionWallet AND lamports > 0
//
// Returns the matched lamports so callers can decide minimum funding floors.
export async function verifyDelegationFromTx(args: {
  txSignature: string;
  ownerWallet: string;
  sessionWallet: string;
}): Promise<{ lamports: bigint }> {
  const { txSignature, ownerWallet, sessionWallet } = args;

  if (!SOLANA_ADDRESS_REGEX.test(ownerWallet)) {
    throw new Error("Invalid owner wallet address.");
  }
  if (!SOLANA_ADDRESS_REGEX.test(sessionWallet)) {
    throw new Error("Invalid session wallet address.");
  }
  if (ownerWallet === sessionWallet) {
    throw new Error("Owner and session wallet must be different.");
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]{43,90}$/.test(txSignature)) {
    throw new Error("Invalid transaction signature.");
  }

  const parsed = await conn.getParsedTransaction(txSignature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!parsed) {
    throw new Error(
      "Funding transaction not found yet — wait a few seconds for confirmation, then try again.",
    );
  }
  if (parsed.meta?.err) {
    throw new Error(`Funding transaction failed on-chain: ${JSON.stringify(parsed.meta.err)}`);
  }

  // Replay window — block ancient txs being reused as fresh delegations.
  const blockTime = parsed.blockTime ?? 0;
  const ageSec = Math.floor(Date.now() / 1000) - blockTime;
  const MAX_AGE_SEC = 30 * 60;
  if (!blockTime || ageSec > MAX_AGE_SEC) {
    throw new Error(
      `Funding transaction too old (${Math.floor(ageSec / 60)}m): delegation must be derived from a tx confirmed within ${MAX_AGE_SEC / 60} minutes.`,
    );
  }

  // Fee payer must be the owner. The first account in `accountKeys` is the
  // fee payer in v0 messages. We also require it to be a signer.
  const accountKeys = parsed.transaction.message.accountKeys ?? [];
  const feePayer = accountKeys[0];
  if (!feePayer || feePayer.pubkey.toBase58() !== ownerWallet || !feePayer.signer) {
    throw new Error("Funding transaction was not signed by the owner wallet.");
  }

  // Walk every instruction (top-level + inner) and require at least one
  // SystemProgram.transfer matching owner→session.
  const allInstructions: any[] = [
    ...parsed.transaction.message.instructions,
    ...((parsed.meta?.innerInstructions ?? []).flatMap((g) => g.instructions)),
  ];
  let lamportsToSession = BigInt(0);
  for (const ix of allInstructions) {
    const parsedIx = (ix as any).parsed;
    if (!parsedIx) continue;
    if (parsedIx.type !== "transfer") continue;
    const info = parsedIx.info;
    if (!info) continue;
    if (info.source !== ownerWallet) continue;
    if (info.destination !== sessionWallet) continue;
    lamportsToSession += BigInt(info.lamports ?? 0);
  }
  if (lamportsToSession === BigInt(0)) {
    throw new Error(
      "Funding transaction did not transfer SOL from the owner to the session wallet.",
    );
  }
  return { lamports: lamportsToSession };
}

export function listPacks() {
  return CREDIT_PACKS;
}
