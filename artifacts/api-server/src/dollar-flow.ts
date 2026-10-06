// ─── Dollar-weighted buy/sell flow (Helius, cached, fail-soft) ───────────────
// DexScreener's public API only exposes buy/sell transaction COUNTS — it does
// NOT split the dollar volume into buy-$ vs sell-$ (that split exists only on
// their website). Counts lie exactly when it matters: 2,656 tiny buys can be
// dwarfed by 2,850 bigger sells (the user's RAKO case — buyer count healthy,
// but more DOLLARS leaving than entering while price bled −27%/24h).
//
// This module computes the real split from the chain: it pulls the most recent
// parsed SWAP transactions for a pool from Helius, classifies each swap as a
// buy or sell of the tracked mint, and sums the SOL-leg dollar value on each
// side. It is a SAMPLE of the newest flow (up to 100 swaps), which is exactly
// the window trading decisions care about.
//
// Contract (mirrors the swing bot's core invariant): missing data is returned
// as null and must NEVER be treated as a signal by callers — flow only ever
// ADDS information when it is actually known. Calls are cached and budgeted so
// the Helius key never gets saturated by the scanner.
import { getSolPriceUsd } from "./solana";

export interface DollarFlow {
  // Whole fetched sample (newest ≤100 swaps).
  buyUsd: number;
  sellUsd: number;
  buys: number;
  sells: number;
  // How far back the sample reaches, in seconds (newest→oldest).
  spanSec: number;
  // Sums restricted to the last 5 minutes (may equal the totals when the
  // sample is younger than 5 minutes).
  buyUsd5m: number;
  sellUsd5m: number;
  swaps5m: number;
}

const WSOL_MINT = "So11111111111111111111111111111111111111112";

const flowCache = new Map<string, { at: number; flow: DollarFlow | null }>();
const FLOW_TTL_MS = 90_000;

// Budget: stay far under Helius free-tier limits even when scanner + exit
// checks overlap. Over budget → stale cache or null (fail-soft everywhere).
let windowStart = 0;
let windowCalls = 0;
const MAX_CALLS_PER_MIN = 15;

function budgetOk(): boolean {
  const now = Date.now();
  if (now - windowStart >= 60_000) { windowStart = now; windowCalls = 0; }
  if (windowCalls >= MAX_CALLS_PER_MIN) return false;
  windowCalls++;
  return true;
}

/**
 * Dollar-weighted flow for one pool. `pairAddress` is the pool, `mint` the
 * traded token. Returns null when unknowable right now (no key, over budget,
 * API error, unparseable swaps, no SOL price) — callers must treat null as
 * "no information", never as a buy or sell signal.
 */
export async function getDollarFlow(pairAddress: string, mint: string): Promise<DollarFlow | null> {
  const key = process.env.HELIUS_API_KEY;
  if (!key || !pairAddress) return null;

  const cached = flowCache.get(pairAddress);
  if (cached && Date.now() - cached.at < FLOW_TTL_MS) return cached.flow;
  // Over budget with an EXPIRED cache → null ("unknown"), never the stale
  // value: a minutes-old bullish read must not veto a protective exit, and a
  // stale bearish read must not block a fresh buy.
  if (!budgetOk()) return null;

  let flow: DollarFlow | null = null;
  try {
    const solUsd = await getSolPriceUsd();
    if (!solUsd || solUsd <= 0) throw new Error("no SOL price");
    const res = await fetch(
      `https://api.helius.xyz/v0/addresses/${pairAddress}/transactions?api-key=${key}&type=SWAP&limit=100`,
      { signal: AbortSignal.timeout(12_000) },
    );
    if (!res.ok) throw new Error(`helius ${res.status}`);
    const txs: any[] = await res.json();
    if (Array.isArray(txs) && txs.length > 0) {
      const nowSec = Math.floor(Date.now() / 1000);
      let buyUsd = 0, sellUsd = 0, buys = 0, sells = 0;
      let buyUsd5m = 0, sellUsd5m = 0, swaps5m = 0;
      let oldest = nowSec;
      for (const tx of txs) {
        if (tx?.transactionError) continue;
        const ts = Number(tx?.timestamp) || 0;
        if (ts > 0 && ts < oldest) oldest = ts;
        // Direction relative to the POOL, from tokenTransfers (Helius parses
        // these for every DEX source, while events.swap is only populated for
        // some): our token flowing OUT of the pool = someone BOUGHT it; our
        // token flowing IN = someone SOLD it. The SOL/wSOL leg moving the
        // opposite way prices the swap in dollars. A tx with token flow both
        // ways (routed arb) or no SOL leg is skipped, not guessed.
        let tokenOut = 0, tokenIn = 0, solInSol = 0, solOutSol = 0;
        for (const t of tx?.tokenTransfers || []) {
          const from = t?.fromUserAccount, to = t?.toUserAccount;
          const amt = Number(t?.tokenAmount) || 0;
          if (amt <= 0) continue;
          if (t?.mint === mint) {
            if (from === pairAddress) tokenOut += amt;
            else if (to === pairAddress) tokenIn += amt;
          } else if (t?.mint === WSOL_MINT) {
            if (to === pairAddress) solInSol += amt;
            else if (from === pairAddress) solOutSol += amt;
          }
        }
        for (const n of tx?.nativeTransfers || []) {
          const amt = (Number(n?.amount) || 0) / 1e9;
          if (amt <= 0) continue;
          if (n?.toUserAccount === pairAddress) solInSol += amt;
          else if (n?.fromUserAccount === pairAddress) solOutSol += amt;
        }
        const isBuy = tokenOut > 0 && tokenIn === 0 && solInSol > 0;
        const isSell = tokenIn > 0 && tokenOut === 0 && solOutSol > 0;
        if (isBuy === isSell) continue; // ambiguous or not a swap on this pool
        const usd = (isBuy ? solInSol : solOutSol) * solUsd;
        if (!Number.isFinite(usd) || usd <= 0) continue;
        const in5m = ts > 0 && nowSec - ts <= 300;
        if (isBuy) { buyUsd += usd; buys++; if (in5m) { buyUsd5m += usd; swaps5m++; } }
        else { sellUsd += usd; sells++; if (in5m) { sellUsd5m += usd; swaps5m++; } }
      }
      if (buys + sells > 0) {
        flow = { buyUsd, sellUsd, buys, sells, spanSec: Math.max(0, nowSec - oldest), buyUsd5m, sellUsd5m, swaps5m };
      }
    }
  } catch {
    flow = null; // unknowable this tick — never a signal
  }
  flowCache.set(pairAddress, { at: Date.now(), flow });
  return flow;
}

// Interpretation helpers — one place defines what "big money is leaving /
// arriving" means so entry and exit rules can't drift apart.
const MIN_SAMPLE_USD = 2_000;   // ignore dust-level tape
const MIN_SAMPLE_SWAPS = 8;     // ignore tiny samples
const DOMINANCE_RATIO = 1.5;    // one side must carry 1.5× the dollars

/** True when real dollars are clearly EXITING (sell-$ ≥ 1.5× buy-$ on a meaningful sample). */
export function dollarsLeaving(f: DollarFlow | null): boolean {
  if (!f) return false;
  const total = f.buyUsd + f.sellUsd;
  if (total < MIN_SAMPLE_USD || f.buys + f.sells < MIN_SAMPLE_SWAPS) return false;
  return f.sellUsd >= f.buyUsd * DOMINANCE_RATIO;
}

/** True when real dollars are clearly ENTERING (buy-$ ≥ 1.5× sell-$ on a meaningful sample). */
export function dollarsArriving(f: DollarFlow | null): boolean {
  if (!f) return false;
  const total = f.buyUsd + f.sellUsd;
  if (total < MIN_SAMPLE_USD || f.buys + f.sells < MIN_SAMPLE_SWAPS) return false;
  return f.buyUsd >= f.sellUsd * DOMINANCE_RATIO;
}

/** Human-readable "$160k in vs $162k out over the last Xm" fragment for events. */
export function flowLabel(f: DollarFlow): string {
  const fmt = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`;
  const mins = Math.max(1, Math.round(f.spanSec / 60));
  return `${fmt(f.buyUsd)} bought vs ${fmt(f.sellUsd)} sold over the last ${mins}m (${f.buys} buys / ${f.sells} sells)`;
}
