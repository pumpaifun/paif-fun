import { rpcFetchWithFallback } from "./rpc-fallback";
import {
  Connection,
  PublicKey,
} from "@solana/web3.js";
import { randomBytes } from "crypto";
import bs58 from "bs58";
import { storage } from "./storage";
import { getTreasuryAddress } from "./credits";
import { getSwapQuote, getSwapTransaction, SOL_MINT } from "./jupiter";
import { buildViaPumpPortal, fetchBondingCurve, calcBuyTokens } from "./pump";
import { injectMemoIntoSwap as injectMemo, MEMO_PROGRAM_ID } from "./swap-memo";
import { getAddress } from "viem";
import { buildPancakeBuyTx, verifyPancakeBuyTx, verifyManualPancakeBuy } from "./evm-buyback";

const HELIUS_KEY = process.env.HELIUS_API_KEY;
const RPC_URL = HELIUS_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`
  : "https://api.mainnet-beta.solana.com";
const conn = new Connection(RPC_URL, { commitment: "confirmed", fetch: rpcFetchWithFallback });

// Memo program v2 — see ./swap-memo.ts for the shared instruction-injection
// helper. We attach a memo to every buyback swap so the on-chain tx is bound
// to a server-issued nonce. This nonce is what closes the "attacker reuses
// an unrelated treasury swap signature" hole the architect flagged.
const MEMO_PREFIX = "paifbb:";
const INTENT_TTL_MS = 10 * 60 * 1000; // 10 min — long enough for slow Phantom prompts

function loadPaifMint(): PublicKey {
  const raw = process.env.PAIF_TOKEN_MINT;
  if (!raw) {
    throw new Error(
      "PAIF_TOKEN_MINT is not configured. Set it as a secret to the $PAIF token mint address before executing buybacks.",
    );
  }
  try {
    return new PublicKey(raw);
  } catch {
    throw new Error(`PAIF_TOKEN_MINT="${raw}" is not a valid Solana address.`);
  }
}

export function getPaifMintOrNull(): string | null {
  try { return loadPaifMint().toBase58(); } catch { return null; }
}

// ─── BNB-chain (PancakeSwap) PAIF buyback config ─────────────────────────────
// Mirrors the Solana gating above. The BNB pool stays dormant until BOTH the
// $PAIF BEP-20 contract AND the BNB treasury are configured — same "configure
// the mint before you can build" pattern as Solana's PAIF_TOKEN_MINT.
function loadPaifBnbMint(): string {
  const raw = process.env.PAIF_BNB_TOKEN_MINT;
  if (!raw) {
    throw new Error(
      "PAIF_BNB_TOKEN_MINT is not configured. Set it to the $PAIF BEP-20 contract address before executing BNB buybacks.",
    );
  }
  try { return getAddress(raw); } catch { throw new Error(`PAIF_BNB_TOKEN_MINT="${raw}" is not a valid EVM address.`); }
}
export function getPaifBnbMintOrNull(): string | null {
  try { return loadPaifBnbMint(); } catch { return null; }
}

function loadEvmTreasury(): string {
  const raw = process.env.PAIF_BNB_FEE_VAULT;
  if (!raw) {
    throw new Error(
      "PAIF_BNB_FEE_VAULT is not configured. Set it to the BNB-chain treasury address before executing BNB buybacks.",
    );
  }
  try { return getAddress(raw); } catch { throw new Error(`PAIF_BNB_FEE_VAULT="${raw}" is not a valid EVM address.`); }
}
function getEvmTreasuryOrNull(): string | null {
  try { return loadEvmTreasury(); } catch { return null; }
}

const MAX_BATCH = 200;

export async function listPendingForAdmin(chain: string = "solana"): Promise<{
  chain: string;
  rows: Array<{ id: string; lamportsAllocated: string; createdAt: string }>;
  totalLamports: string;
  treasury: string;
  paifMint: string | null;
}> {
  const isBnb = chain === "bnb";
  const rows = await storage.getPendingBuybackRows(MAX_BATCH, isBnb ? "bnb" : "solana");
  const total = rows.reduce((acc, r) => acc + BigInt(r.lamportsAllocated), 0n);
  return {
    chain: isBnb ? "bnb" : "solana",
    rows,
    totalLamports: total.toString(),
    treasury: isBnb ? (getEvmTreasuryOrNull() ?? "") : getTreasuryAddress(),
    paifMint: isBnb ? getPaifBnbMintOrNull() : getPaifMintOrNull(),
  };
}

// Local alias so the existing call sites stay untouched.
const injectMemoIntoSwap = (b64: string, memo: string) => injectMemo(conn, b64, memo);

export async function buildBuybackSwap(args: {
  rowIds: string[];
  slippageBps?: number;
  chain?: string;
}): Promise<any> {
  const chain = args.chain === "bnb" ? "bnb" : "solana";

  // Server re-derives the lamport total from the database so the client can
  // never inflate the swap value past what's actually pending. (Shared across
  // both chains — the pending rows are already chain-scoped at insert time.)
  const rows = await storage.getBuybackRowsByIds(args.rowIds);
  if (rows.length !== args.rowIds.length) {
    throw new Error("Some row IDs were not found.");
  }
  const nonPending = rows.filter(r => r.status !== "pending");
  if (nonPending.length > 0) {
    throw new Error(`${nonPending.length} row(s) are not pending; refusing to build swap.`);
  }
  const lamports = rows.reduce((acc, r) => acc + BigInt(r.lamportsAllocated), 0n);
  if (lamports <= 0n) throw new Error("No pending allocation to swap.");

  // ─── BNB path: PancakeSwap V2, nonce appended to calldata ─────────────────
  if (chain === "bnb") {
    const tokenOut = loadPaifBnbMint();
    const treasury = loadEvmTreasury();
    const slippageBps = Math.max(10, Math.min(1000, args.slippageBps ?? 100));
    // 16 random bytes → 32 hex chars; fits varchar(32) + passes the execute
    // nonce regex. Kept distinct from Solana's base64url nonce by encoding.
    const nonce = randomBytes(16).toString("hex");
    const tx = await buildPancakeBuyTx({
      tokenOut,
      recipient: treasury,
      valueWei: lamports,
      slippageBps,
      nonceHex: nonce,
    });
    await storage.createBuybackIntent({
      nonce,
      chain: "bnb",
      rowIds: args.rowIds,
      expectedLamports: lamports.toString(),
      treasury,
      ttlMs: INTENT_TTL_MS,
    });
    return {
      chain: "bnb",
      evmTx: { to: tx.to, data: tx.data, value: tx.value },
      nonce,
      quote: {
        inAmountLamports: lamports.toString(),
        outAmountPaifRaw:  tx.expectedOutRaw,
        amountOutMinRaw:   tx.amountOutMinRaw,
        priceImpactPct:    "0",
        slippageBps,
        route: "pancakeswap",
      },
    };
  }

  // ─── Solana path (unchanged) ──────────────────────────────────────────────
  const paifMint = loadPaifMint();
  const treasury = new PublicKey(getTreasuryAddress());
  const amount = Number(lamports);
  const slippageBps = Math.max(10, Math.min(1000, args.slippageBps ?? 100));

  // 16 random bytes → ~22 chars base64url. Plenty of entropy, fits the
  // 32-char varchar comfortably.
  const nonce = randomBytes(16).toString("base64url");
  const memoText = `${MEMO_PREFIX}${nonce}`;

  // Try Jupiter first — works once the token has migrated off the bonding
  // curve to a Raydium pool. While the token is still on Pump.fun's curve
  // Jupiter responds with TOKEN_NOT_TRADABLE; in that case fall back to
  // PumpPortal's trade-local endpoint, which builds against the curve
  // directly. Both paths return v0 transactions paid for by the treasury,
  // so the same memo-injection helper works for both.
  let serializedTx: string;
  let inAmount = lamports.toString();
  let outAmount = "0";
  let priceImpactPct = "0";
  let route: "jupiter" | "pump-portal" = "jupiter";

  try {
    const quote = await getSwapQuote(SOL_MINT, paifMint.toBase58(), amount, slippageBps);
    const swap  = await getSwapTransaction(quote as any, treasury.toBase58());
    serializedTx = await injectMemoIntoSwap(swap.swapTransaction, memoText);
    inAmount = quote.inAmount;
    outAmount = quote.outAmount;
    priceImpactPct = quote.priceImpactPct;
  } catch (jupErr: any) {
    // Fall back to PumpPortal on ANY Jupiter failure (the lite-api returns a
    // confusing variety of errors for bonding-curve tokens — TOKEN_NOT_TRADABLE,
    // COULD_NOT_FIND_ANY_ROUTE, generic 400s, timeouts). If PumpPortal also
    // fails, surface both messages so the admin can diagnose.
    const jupMsg = String(jupErr?.message ?? "Jupiter unavailable");
    console.warn("[buyback] Jupiter failed, trying PumpPortal:", jupMsg);
    const solAmount = amount / 1e9;
    try {
      const pumpTx = await buildViaPumpPortal(
        "buy",
        paifMint.toBase58(),
        treasury.toBase58(),
        solAmount,
        true,
        slippageBps,
      );
      serializedTx = await injectMemoIntoSwap(pumpTx, memoText);
      route = "pump-portal";

      // Best-effort token estimate from the curve so the admin UI shows
      // something useful. Failure here is non-fatal — verification only
      // requires the on-chain PAIF delta to be > 0.
      try {
        const curve = await fetchBondingCurve(paifMint);
        if (!curve.complete) {
          outAmount = calcBuyTokens(curve, BigInt(amount)).toString();
        }
      } catch { /* advisory only */ }
    } catch (pumpErr: any) {
      const pumpMsg = String(pumpErr?.message ?? "PumpPortal unavailable");
      throw new Error(`Couldn't build swap. Jupiter: ${jupMsg}. PumpPortal: ${pumpMsg}.`);
    }
  }

  await storage.createBuybackIntent({
    nonce,
    chain: "solana",
    rowIds: args.rowIds,
    expectedLamports: lamports.toString(),
    treasury: treasury.toBase58(),
    ttlMs: INTENT_TTL_MS,
  });

  return {
    chain: "solana",
    serializedTx,
    nonce,
    quote: {
      inAmountLamports: inAmount,
      outAmountPaifRaw:  outAmount,
      priceImpactPct,
      slippageBps,
      route,
    },
  };
}

// Record a buyback that was performed manually (off-platform). The operator
// pastes the tx signature; we fetch the tx, verify it's a real on-chain swap
// that increased the treasury wallet's PAIF balance, then insert an
// "executed" ledger row with the actual SOL spent. No nonce binding here —
// since there's no intent to consume, we instead refuse duplicates by tx
// signature and require the swap to be (a) signed by the treasury and (b)
// produce > 0 PAIF for the treasury wallet.
export async function recordManualBuyback(args: {
  signature: string;
  chain?: string;
}): Promise<{ id: string; paifReceivedRaw: string; solSpentLamports: string }> {
  const { signature } = args;
  if (args.chain === "bnb") return recordManualBuybackEvm(signature);
  if (!/^[1-9A-HJ-NP-Za-km-z]{43,90}$/.test(signature)) {
    throw new Error("Invalid transaction signature.");
  }

  // Refuse duplicates — same signature, same row.
  const existing = await storage.getBuybackRowByExecutionSignature(signature);
  if (existing) {
    throw new Error("This transaction is already recorded in the ledger.");
  }

  const paifMintB58 = (() => { try { return loadPaifMint().toBase58(); } catch { return null; }})();
  if (!paifMintB58) throw new Error("PAIF_TOKEN_MINT not configured.");

  const treasuryB58 = getTreasuryAddress();

  const parsed = await conn.getParsedTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!parsed) {
    throw new Error("Transaction not found yet — wait a few seconds for confirmation, then retry.");
  }
  if (parsed.meta?.err) {
    throw new Error(`Transaction failed on-chain: ${JSON.stringify(parsed.meta.err)}`);
  }

  // Fee-payer / first signer must be the treasury wallet, otherwise this
  // isn't an operator buyback we can attribute to the pool.
  const accountKeys = parsed.transaction.message.accountKeys ?? [];
  const feePayer = accountKeys[0];
  if (!feePayer || feePayer.pubkey.toBase58() !== treasuryB58 || !feePayer.signer) {
    throw new Error(
      `Transaction was not signed by the treasury wallet (${treasuryB58.slice(0, 8)}…). ` +
      `Manual buybacks must come from the treasury so they're attributable on-chain.`,
    );
  }

  // PAIF delta for treasury must be positive — confirms it's a buy, not a sell/transfer.
  const pre  = parsed.meta?.preTokenBalances  ?? [];
  const post = parsed.meta?.postTokenBalances ?? [];
  const preForTreasury = pre
    .filter(b => b.owner === treasuryB58 && b.mint === paifMintB58)
    .reduce((acc, b) => acc + BigInt(b.uiTokenAmount.amount ?? "0"), 0n);
  const postForTreasury = post
    .filter(b => b.owner === treasuryB58 && b.mint === paifMintB58)
    .reduce((acc, b) => acc + BigInt(b.uiTokenAmount.amount ?? "0"), 0n);
  const paifDelta = postForTreasury - preForTreasury;
  if (paifDelta <= 0n) {
    throw new Error(
      "This transaction did not increase the treasury's $PAIF balance. " +
      "Only on-chain SOL→$PAIF buys can be recorded as manual buybacks.",
    );
  }

  // SOL spent = pre - post for fee payer (already accounts for fees).
  const preBal  = parsed.meta?.preBalances?.[0]  ?? 0;
  const postBal = parsed.meta?.postBalances?.[0] ?? 0;
  const solSpent = BigInt(preBal) - BigInt(postBal);
  if (solSpent <= 0n) {
    throw new Error("Treasury did not spend any SOL in this transaction.");
  }

  const note = JSON.stringify({
    paifReceivedRaw: paifDelta.toString(),
    solSpentLamports: solSpent.toString(),
    paifMint: paifMintB58,
    source: "manual_record",
  });
  const inserted = await storage.recordManualBuyback({
    ownerWallet:   treasuryB58,
    lamportsSpent: solSpent,
    txSignature:   signature,
    notes:         note,
  });

  return {
    id: inserted.id,
    paifReceivedRaw:  paifDelta.toString(),
    solSpentLamports: solSpent.toString(),
  };
}

// BNB twin of recordManualBuyback — verifies a PancakeSwap buy (no nonce) that
// the treasury signed and that increased the treasury's $PAIF (BEP-20) balance.
// Stores wei-spent in the lamports column (just a big-int string) + chain="bnb"
// so the BNB ledger stays separate from Solana's.
async function recordManualBuybackEvm(
  txHash: string,
): Promise<{ id: string; paifReceivedRaw: string; solSpentLamports: string }> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new Error("Invalid BNB transaction hash.");
  }
  const existing = await storage.getBuybackRowByExecutionSignature(txHash);
  if (existing) {
    throw new Error("This transaction is already recorded in the ledger.");
  }
  const tokenOut = loadPaifBnbMint();
  const treasury = loadEvmTreasury();
  const { tokensReceivedRaw, valueWeiSpent } = await verifyManualPancakeBuy({
    txHash,
    treasury,
    tokenOut,
  });
  const note = JSON.stringify({
    paifReceivedRaw: tokensReceivedRaw,
    weiSpent: valueWeiSpent,
    token: tokenOut,
    source: "manual_record",
    chain: "bnb",
  });
  const inserted = await storage.recordManualBuyback({
    ownerWallet:   treasury,
    lamportsSpent: BigInt(valueWeiSpent),
    txSignature:   txHash,
    notes:         note,
    chain:         "bnb",
  });
  return {
    id: inserted.id,
    paifReceivedRaw:  tokensReceivedRaw,
    solSpentLamports: valueWeiSpent,
  };
}

// BNB twin of verifyAndMarkExecuted. The nonce binding lives in the swap
// calldata suffix (not a memo). verifyPancakeBuyTx enforces: treasury signed +
// router call + nonce suffix + value ≥ 98% of intent + token balance increased.
async function verifyAndMarkExecutedEvm(
  txHash: string,
  intent: { nonce: string; rowIds: string[]; expectedLamports: string; treasury: string },
): Promise<{ marked: number; paifReceivedRaw: string; solSpentLamports: string }> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new Error("Invalid BNB transaction hash.");
  }
  const existing = await storage.getBuybackRowByExecutionSignature(txHash);
  if (existing) {
    throw new Error("This signature is already recorded against another ledger row.");
  }
  const tokenOut = loadPaifBnbMint();
  const expected = BigInt(intent.expectedLamports);
  const minRequired = (expected * 98n) / 100n;
  const { tokensReceivedRaw, valueWeiSpent } = await verifyPancakeBuyTx({
    txHash,
    treasury: intent.treasury,
    tokenOut,
    nonceHex: intent.nonce,
    minValueWei: minRequired,
  });
  const note = JSON.stringify({
    paifReceivedRaw: tokensReceivedRaw,
    weiSpent: valueWeiSpent,
    token: tokenOut,
    nonce: intent.nonce,
    chain: "bnb",
  });
  const marked = await storage.consumeIntentAndMarkRows({
    nonce: intent.nonce,
    signature: txHash,
    rowIds: intent.rowIds,
    notes: note,
  });
  return {
    marked,
    paifReceivedRaw:  tokensReceivedRaw,
    solSpentLamports: valueWeiSpent,
  };
}

// Verify a finished SOL→PAIF swap and atomically settle the intent's rows.
//
// Auth model recap: the swap tx must (a) be signed by the treasury wallet,
// (b) contain a memo instruction with our nonce. (b) is the binding that
// stops an unrelated treasury PAIF swap from being replayed against this
// intent. Without the nonce-in-memo check the architect's threat (operator
// does an OTC swap, attacker grabs that signature, calls /execute) would
// land — with it, no other tx can ever satisfy the memo check.
export async function verifyAndMarkExecuted(args: {
  signature: string;
  nonce: string;
}): Promise<{
  marked: number;
  paifReceivedRaw: string;
  solSpentLamports: string;
}> {
  const { signature, nonce } = args;

  if (!/^[A-Za-z0-9_-]{8,32}$/.test(nonce)) {
    throw new Error("Invalid nonce.");
  }

  // 1. Resolve the intent — must exist, not consumed, not expired.
  const intent = await storage.getBuybackIntent(nonce);
  if (!intent) throw new Error("Unknown nonce — intent not found or already cleaned up.");
  if (intent.consumedAt) throw new Error("Intent already consumed.");
  if (new Date(intent.expiresAt).getTime() < Date.now()) {
    throw new Error("Intent expired — rebuild the swap and retry.");
  }

  // Route to the BNB verifier when this intent was created for the BNB chain.
  if (intent.chain === "bnb") {
    return verifyAndMarkExecutedEvm(signature, intent);
  }

  // ─── Solana path (unchanged) ──────────────────────────────────────────────
  if (!/^[1-9A-HJ-NP-Za-km-z]{43,90}$/.test(signature)) {
    throw new Error("Invalid transaction signature.");
  }

  // 2. Defensive idempotency on the ledger side too (matches partial unique
  //    index on buyback_ledger.execution_tx_signature).
  const existing = await storage.getBuybackRowByExecutionSignature(signature);
  if (existing) {
    throw new Error("This signature is already recorded against another ledger row.");
  }

  // 3. Pull the swap tx and run on-chain checks.
  const parsed = await conn.getParsedTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!parsed) {
    throw new Error("Swap transaction not found yet — wait a few seconds for confirmation, then retry.");
  }
  if (parsed.meta?.err) {
    throw new Error(`Swap transaction failed on-chain: ${JSON.stringify(parsed.meta.err)}`);
  }
  const blockTime = parsed.blockTime ?? 0;
  const ageSec = Math.floor(Date.now() / 1000) - blockTime;
  const MAX_AGE_SEC = 60 * 60;
  if (!blockTime || ageSec > MAX_AGE_SEC) {
    throw new Error(
      `Swap transaction too old (${Math.floor(ageSec / 60)}m): execution must be marked within ${MAX_AGE_SEC / 60} minutes.`,
    );
  }

  const treasuryB58 = intent.treasury;
  const accountKeys = parsed.transaction.message.accountKeys ?? [];
  const feePayer = accountKeys[0];
  if (!feePayer || feePayer.pubkey.toBase58() !== treasuryB58 || !feePayer.signer) {
    throw new Error("Swap transaction was not signed by the treasury wallet.");
  }

  // 4. THE BINDING CHECK — a memo instruction whose payload EQUALS our
  //    nonce-stamped marker must be present in the tx. Substring matching
  //    would let attacker-influenced memo blobs collide; equality is the
  //    correct check. Walks top-level + inner instructions and handles both
  //    the parsed shape (RPC labels memo as program="spl-memo") and the raw
  //    shape (programId match + base58-decoded `data`, per Solana JSON-RPC).
  const memoMatch = `${MEMO_PREFIX}${nonce}`;
  const memoPidB58 = MEMO_PROGRAM_ID.toBase58();
  const allIxs: any[] = [
    ...parsed.transaction.message.instructions,
    ...((parsed.meta?.innerInstructions ?? []).flatMap(g => g.instructions)),
  ];
  function programIdToString(ix: any): string | null {
    const pid = ix?.programId;
    if (!pid) return null;
    if (typeof pid === "string") return pid;
    if (typeof pid.toBase58 === "function") return pid.toBase58();
    return null;
  }
  let memoFound = false;
  for (const ix of allIxs) {
    // Parsed shape — RPC labels the memo program as "spl-memo" and the
    // payload sits at .parsed (a plain string).
    if ((ix as any).program === "spl-memo") {
      const payload = typeof (ix as any).parsed === "string"
        ? (ix as any).parsed
        : (ix as any).parsed?.info ?? "";
      if (payload === memoMatch) { memoFound = true; break; }
      continue;
    }
    // Raw shape — compare program ID and base58-decode the `data` field.
    const pidStr = programIdToString(ix);
    if (pidStr === memoPidB58) {
      const dataStr = (ix as any).data ?? "";
      try {
        const decoded = Buffer.from(bs58.decode(dataStr)).toString("utf8");
        if (decoded === memoMatch) { memoFound = true; break; }
      } catch {
        /* malformed data — keep scanning rather than throwing */
      }
    }
  }
  if (!memoFound) {
    throw new Error("Swap transaction does not carry the expected memo binding — refusing to settle.");
  }

  // 5. PAIF balance change for treasury.
  const paifMintB58 = (() => { try { return loadPaifMint().toBase58(); } catch { return null; }})();
  if (!paifMintB58) throw new Error("PAIF_TOKEN_MINT not configured.");
  const pre  = parsed.meta?.preTokenBalances  ?? [];
  const post = parsed.meta?.postTokenBalances ?? [];
  const preForTreasury = pre
    .filter(b => b.owner === treasuryB58 && b.mint === paifMintB58)
    .reduce((acc, b) => acc + BigInt(b.uiTokenAmount.amount ?? "0"), 0n);
  const postForTreasury = post
    .filter(b => b.owner === treasuryB58 && b.mint === paifMintB58)
    .reduce((acc, b) => acc + BigInt(b.uiTokenAmount.amount ?? "0"), 0n);
  const paifDelta = postForTreasury - preForTreasury;
  if (paifDelta <= 0n) {
    throw new Error("Swap did not produce any PAIF for the treasury wallet.");
  }

  // 6. SOL spent must cover ≥98% of intent's expected lamports.
  const preBal  = parsed.meta?.preBalances?.[0]  ?? 0;
  const postBal = parsed.meta?.postBalances?.[0] ?? 0;
  const solSpent = BigInt(preBal) - BigInt(postBal);
  const expected = BigInt(intent.expectedLamports);
  const minRequired = (expected * 98n) / 100n;
  if (solSpent < minRequired) {
    throw new Error(
      `Swap spent ${solSpent.toString()} lamports but intent expected ${expected.toString()} ` +
      `(min ${minRequired.toString()}).`,
    );
  }

  // 7. Consume intent + mark rows in ONE DB transaction so neither side can
  //    half-commit. If either step fails or mark doesn't update every row in
  //    intent.rowIds, the whole transaction rolls back and the operator can
  //    retry. The atomic `consume_at IS NULL` guard inside the consume query
  //    still wins races; this wrapper just makes sure we never burn a nonce
  //    while leaving rows pending.
  const note = JSON.stringify({
    paifReceivedRaw: paifDelta.toString(),
    solSpentLamports: solSpent.toString(),
    paifMint: paifMintB58,
    nonce,
  });
  const marked = await storage.consumeIntentAndMarkRows({
    nonce,
    signature,
    rowIds: intent.rowIds,
    notes: note,
  });
  return {
    marked,
    paifReceivedRaw:  paifDelta.toString(),
    solSpentLamports: solSpent.toString(),
  };
}
