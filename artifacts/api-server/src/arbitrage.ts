// Read-only arbitrage OPPORTUNITY scanner.
//
// This never signs, holds keys, or executes a trade. It compares the SAME token's
// price across every Solana liquidity pool DexScreener knows about, then subtracts a
// realistic round-trip cost (per-leg LP fee + price impact estimated from pool depth +
// network fee) so the "spread" you see is the spread you could actually keep. Most
// gross spreads net out to ~0 after costs — that honesty is the whole point.

const DEX_FEE_PCT: Record<string, number> = {
  raydium: 0.25,
  orca: 0.3,
  meteora: 0.2,
  pumpswap: 0.25,
  pump: 1.0,
  lifinity: 0.2,
  fluxbeam: 1.0,
  phoenix: 0.05,
};

const MIN_POOL_LIQUIDITY_USD = 500;

export interface ArbPool {
  dex: string;
  pairAddress: string;
  priceUsd: number;
  liquidityUsd: number;
  url: string;
  legFeePct: number;
  impactPct: number;
}

export interface ArbOpportunity {
  mint: string;
  symbol: string;
  name: string;
  icon: string;
  poolCount: number;
  tradeSizeUsd: number;
  buyPool: ArbPool | null;
  sellPool: ArbPool | null;
  grossSpreadPct: number;
  estCostPct: number;
  netEdgePct: number;
  estProfitUsd: number;
  executable: boolean;
  warnings: string[];
}

function dexFee(dexId: string): number {
  const key = (dexId || "").toLowerCase();
  return DEX_FEE_PCT[key] ?? 0.3;
}

// Rough price-impact estimate: a trade of `size` against a pool of `liquidity`.
// Real AMM impact depends on the curve + reserves split, but size/liquidity is a
// conservative, honest first-order approximation from the data DexScreener gives us.
function estimateImpactPct(tradeSizeUsd: number, liquidityUsd: number): number {
  if (!liquidityUsd || liquidityUsd <= 0) return 100;
  return Math.min((tradeSizeUsd / liquidityUsd) * 100, 100);
}

async function fetchPairs(mint: string): Promise<any[]> {
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.pairs) ? data.pairs : [];
  } catch {
    return [];
  }
}

export async function scanTokenArb(
  mint: string,
  tradeSizeUsd = 50,
): Promise<ArbOpportunity> {
  const rawPairs = await fetchPairs(mint);

  const meta = {
    symbol:
      rawPairs.find((p) => p.baseToken?.address?.toLowerCase() === mint.toLowerCase())
        ?.baseToken?.symbol ||
      rawPairs[0]?.baseToken?.symbol ||
      "???",
    name:
      rawPairs.find((p) => p.baseToken?.address?.toLowerCase() === mint.toLowerCase())
        ?.baseToken?.name ||
      rawPairs[0]?.baseToken?.name ||
      "",
    icon:
      rawPairs.find((p) => p.info?.imageUrl)?.info?.imageUrl || "",
  };

  const lowerMint = mint.toLowerCase();
  const pools = rawPairs
    .filter(
      (p) =>
        p.chainId === "solana" &&
        p.priceUsd &&
        (p.liquidity?.usd ?? 0) >= MIN_POOL_LIQUIDITY_USD &&
        (p.baseToken?.address?.toLowerCase() === lowerMint ||
          p.quoteToken?.address?.toLowerCase() === lowerMint),
    )
    .map((p): ArbPool | null => {
      // DexScreener's priceUsd is always the BASE token's USD price. When our token
      // is the QUOTE side, derive its USD price from priceNative (quote per base):
      // ourUsd = baseUsd / (quote-per-base). Otherwise price comparisons mix units.
      const isBase = p.baseToken?.address?.toLowerCase() === lowerMint;
      let priceUsd: number;
      if (isBase) {
        priceUsd = parseFloat(p.priceUsd);
      } else {
        const baseUsd = parseFloat(p.priceUsd);
        const native = parseFloat(p.priceNative);
        priceUsd = native > 0 ? baseUsd / native : 0;
      }
      const liquidityUsd = p.liquidity?.usd ?? 0;
      return {
        dex: p.dexId || "unknown",
        pairAddress: p.pairAddress,
        priceUsd,
        liquidityUsd,
        url: p.url || `https://dexscreener.com/solana/${p.pairAddress}`,
        legFeePct: dexFee(p.dexId),
        impactPct: estimateImpactPct(tradeSizeUsd, liquidityUsd),
      };
    })
    .filter((p): p is ArbPool => !!p && p.priceUsd > 0);

  const warnings: string[] = [];
  const base: ArbOpportunity = {
    mint,
    ...meta,
    poolCount: pools.length,
    tradeSizeUsd,
    buyPool: null,
    sellPool: null,
    grossSpreadPct: 0,
    estCostPct: 0,
    netEdgePct: 0,
    estProfitUsd: 0,
    executable: false,
    warnings,
  };

  if (pools.length < 2) {
    if (pools.length === 1) {
      warnings.push("Only one liquidity pool found — cross-pool arbitrage needs at least two.");
    } else if (rawPairs.length > 0) {
      warnings.push(
        "This token trades on a single pool / bonding curve — no cross-pool arbitrage is possible.",
      );
    } else {
      warnings.push("No Solana liquidity pools found for this token.");
    }
    return base;
  }

  const sorted = [...pools].sort((a, b) => a.priceUsd - b.priceUsd);
  const buyPool = sorted[0]; // cheapest = where you buy
  const sellPool = sorted[sorted.length - 1]; // dearest = where you sell

  const grossSpreadPct =
    ((sellPool.priceUsd - buyPool.priceUsd) / buyPool.priceUsd) * 100;

  // Round-trip cost: LP fee on each leg + price impact on each leg + a small flat
  // network/priority allowance expressed as a % of the trade size.
  const networkFeeUsd = 0.03;
  const networkFeePct = (networkFeeUsd / tradeSizeUsd) * 100;
  const estCostPct =
    buyPool.legFeePct +
    sellPool.legFeePct +
    buyPool.impactPct +
    sellPool.impactPct +
    networkFeePct;

  const netEdgePct = grossSpreadPct - estCostPct;
  const estProfitUsd = (tradeSizeUsd * netEdgePct) / 100;

  if (buyPool.liquidityUsd < 2000 || sellPool.liquidityUsd < 2000) {
    warnings.push(
      "Thin liquidity — real slippage will likely exceed the estimate and can erase the edge.",
    );
  }
  if (netEdgePct <= 0) {
    warnings.push(
      "After fees and slippage this spread is not profitable — informational only.",
    );
  }

  return {
    ...base,
    buyPool,
    sellPool,
    grossSpreadPct,
    estCostPct,
    netEdgePct,
    estProfitUsd,
    executable: netEdgePct > 0 && buyPool.pairAddress !== sellPool.pairAddress,
    warnings,
  };
}

async function trendingMints(): Promise<string[]> {
  try {
    const res = await fetch("https://api.dexscreener.com/token-boosts/top/v1", {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const boosts: any[] = await res.json();
    return boosts
      .filter((t) => t.chainId === "solana" && t.tokenAddress)
      .slice(0, 25)
      .map((t) => t.tokenAddress);
  } catch {
    return [];
  }
}

// Short-TTL cache keyed by trade size collapses repeated fan-out (the scan is the
// same for every caller within the window since it reads public market data).
const networkCache = new Map<number, { at: number; data: ArbOpportunity[] }>();
const NETWORK_CACHE_TTL_MS = 30_000;
const NETWORK_SCAN_BUDGET_MS = 25_000;

// Scan a batch of currently-active tokens and rank by net edge. Bounded concurrency
// so we don't hammer the public DexScreener endpoint, an overall time budget so
// upstream stalls can't hold the request open, and a short TTL cache.
export async function scanNetworkArb(tradeSizeUsd = 50): Promise<ArbOpportunity[]> {
  const cached = networkCache.get(tradeSizeUsd);
  if (cached && Date.now() - cached.at < NETWORK_CACHE_TTL_MS) return cached.data;

  const deadline = Date.now() + NETWORK_SCAN_BUDGET_MS;
  const mints = await trendingMints();
  const out: ArbOpportunity[] = [];
  const CONCURRENCY = 5;
  for (let i = 0; i < mints.length; i += CONCURRENCY) {
    if (Date.now() >= deadline) break; // return partial results rather than stall
    const batch = mints.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((m) => scanTokenArb(m, tradeSizeUsd).catch(() => null)),
    );
    for (const r of results) if (r && r.poolCount >= 2) out.push(r);
  }
  const sorted = out.sort((a, b) => b.netEdgePct - a.netEdgePct);
  networkCache.set(tradeSizeUsd, { at: Date.now(), data: sorted });
  return sorted;
}
