import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { storage } from "./storage";
import { conn, getTreasuryAddress, SOLANA_ADDRESS_REGEX } from "./credits";
import { getSolPriceUsd } from "./solana";
import { ACCESS_PASSES, ACCESS_TRIAL_DURATION_MS, getAccessPass, type AccessPass } from "@shared/access-passes";

const PAYMENT_TOLERANCE_PCT = 5;

export function listAccessPasses(): readonly AccessPass[] {
  return ACCESS_PASSES;
}

export async function quoteAccessPassLamports(passId: string) {
  const pass = getAccessPass(passId);
  if (!pass) throw new Error(`Unknown access pass: ${passId}`);
  const livePrice = (await getSolPriceUsd()) ?? 0;
  const solPriceUsd = livePrice > 0 ? livePrice : 100;
  const lamports = BigInt(Math.ceil((pass.priceUsd / solPriceUsd) * LAMPORTS_PER_SOL / 100) * 100);
  return { pass, solPriceUsd, lamports, expiresAtMs: Date.now() + 5 * 60_000 };
}

export async function verifyAndGrantAccessPass(args: {
  txSignature: string;
  ownerWallet: string;
  passId: string;
}) {
  const { txSignature, ownerWallet, passId } = args;
  if (!SOLANA_ADDRESS_REGEX.test(ownerWallet)) throw new Error("Invalid owner wallet address.");
  if (!/^[1-9A-HJ-NP-Za-km-z]{43,90}$/.test(txSignature)) throw new Error("Invalid transaction signature.");
  const pass = getAccessPass(passId);
  if (!pass) throw new Error(`Unknown access pass: ${passId}`);

  const existing = await storage.getAccessPassPurchaseBySignature(txSignature);
  if (existing) {
    if (existing.ownerWallet !== ownerWallet) throw new Error("Transaction already credited to a different wallet.");
    return { ...(await storage.getAccessPass(ownerWallet)), alreadyApplied: true };
  }

  const quote = await quoteAccessPassLamports(passId);
  const minLamports = (quote.lamports * BigInt(100 - PAYMENT_TOLERANCE_PCT)) / BigInt(100);
  const parsed = await conn.getParsedTransaction(txSignature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!parsed) throw new Error("Transaction not found yet — wait a few seconds, then retry.");
  if (parsed.meta?.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(parsed.meta.err)}`);

  const blockTime = parsed.blockTime ?? 0;
  const ageSec = Math.floor(Date.now() / 1000) - blockTime;
  if (!blockTime || ageSec > 30 * 60) {
    throw new Error("Payment is too old. Access Pass purchases must be confirmed within 30 minutes.");
  }

  let totalToTreasury = BigInt(0);
  const instructions: any[] = [
    ...parsed.transaction.message.instructions,
    ...((parsed.meta?.innerInstructions ?? []).flatMap((group) => group.instructions)),
  ];
  for (const ix of instructions) {
    const parsedIx = ix?.parsed;
    const info = parsedIx?.info;
    if (parsedIx?.type === "transfer" &&
        info?.destination === getTreasuryAddress() &&
        info?.source === ownerWallet) {
      totalToTreasury += BigInt(info.lamports ?? 0);
    }
  }
  if (totalToTreasury < minLamports) {
    throw new Error(
      `Insufficient payment: expected at least ${minLamports.toString()} lamports for the ${pass.label}.`,
    );
  }

  try {
    const out = await storage.recordAccessPassPurchase({
      ownerWallet,
      passId: pass.id,
      lamportsPaid: totalToTreasury,
      durationMs: pass.durationMs,
      txSignature,
    });
    return { ...(await storage.getAccessPass(ownerWallet)), passExpiresAt: out.passExpiresAt, alreadyApplied: false };
  } catch (error: any) {
    if (/duplicate key|unique/i.test(error?.message ?? "")) {
      return { ...(await storage.getAccessPass(ownerWallet)), alreadyApplied: true };
    }
    throw error;
  }
}

export { ACCESS_TRIAL_DURATION_MS };