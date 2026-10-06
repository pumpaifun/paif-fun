// ─── Market weather (facts only, never advice) ──────────────────────────────
// A tiny, heavily-cached read of the broad market: Solana and Nasdaq Composite
// changes. Crypto prices come from CoinGecko; Nasdaq is read from Yahoo's
// public chart endpoint. Used two ways:
//   1. Shown to users as plain FACTS ("Solana −5% and Nasdaq −1% today"). Never
//      a recommendation.
//   2. The dip-buyer style gives candidates a score BONUS on market-red days
//      (a token down WITH the market is more likely a market-driven dip than
//      a token-specific problem). Weather unknown = neutral — an external API
//      being down must never change what the bot is allowed to do.
// Fail-soft: on fetch failure we serve the last good reading for up to 30
// minutes, then null. Callers must treat null as "unknown", never as "calm".

export interface MarketWeather {
  btcUsd: number;
  btcChg24: number;
  solUsd: number;
  solChg24: number;
  nasdaqChg1d: number | null;
  mood: "red" | "green" | "mixed";
  facts: string;
  fetchedAt: number;
}

const CACHE_MS = 5 * 60 * 1000;
const STALE_OK_MS = 30 * 60 * 1000;

let cached: MarketWeather | null = null;
let lastAttempt = 0;

function moodOf(btcChg24: number, solChg24: number): MarketWeather["mood"] {
  if (btcChg24 <= -2 && solChg24 <= -2) return "red";
  if (btcChg24 >= 2 && solChg24 >= 2) return "green";
  return "mixed";
}

function fmtChg(n: number): string {
  return `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}%`;
}

function factsOf(w: Omit<MarketWeather, "facts">): string {
  const nasdaq = w.nasdaqChg1d === null
    ? ""
    : ` Nasdaq Composite ${fmtChg(w.nasdaqChg1d)} over the last trading day.`;
  const base = `Solana ${fmtChg(w.solChg24)} over the last 24h.${nasdaq}`;
  if (w.mood === "red") return `${base} The whole market is red right now — most tokens fall together on days like this.`;
  if (w.mood === "green") return `${base} The broad market is green right now.`;
  return base;
}

async function getNasdaqChange(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/%5EIXIC?range=5d&interval=1d&events=history",
      { signal: AbortSignal.timeout(8_000), headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    const result = data?.chart?.result?.[0];
    const closes = Array.isArray(result?.indicators?.quote?.[0]?.close)
      ? result.indicators.quote[0].close.filter((value: unknown) => Number.isFinite(Number(value))).map(Number)
      : [];
    const previousClose = Number(result?.meta?.chartPreviousClose);
    const latestClose = closes.at(-1);
    const priorClose = closes.length > 1 ? closes.at(-2) : previousClose;
    if (!Number.isFinite(latestClose) || !Number.isFinite(priorClose) || priorClose <= 0) return null;
    return ((latestClose - priorClose) / priorClose) * 100;
  } catch {
    return null;
  }
}

export async function getMarketWeather(): Promise<MarketWeather | null> {
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_MS) return cached;
  // Don't hammer CoinGecko while it's failing — one attempt per minute.
  if (now - lastAttempt < 60_000) {
    return cached && now - cached.fetchedAt < STALE_OK_MS ? cached : null;
  }
  lastAttempt = now;
  try {
    const [res, nasdaqChg1d] = await Promise.all([
      fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,solana&vs_currencies=usd&include_24hr_change=true",
      { signal: AbortSignal.timeout(8_000) },
      ),
      getNasdaqChange(),
    ]);
    if (!res.ok) throw new Error(`coingecko ${res.status}`);
    const data: any = await res.json();
    const btcUsd = Number(data?.bitcoin?.usd);
    const btcChg24 = Number(data?.bitcoin?.usd_24h_change);
    const solUsd = Number(data?.solana?.usd);
    const solChg24 = Number(data?.solana?.usd_24h_change);
    if (![btcUsd, btcChg24, solUsd, solChg24].every(Number.isFinite)) throw new Error("coingecko shape changed");
    const partial = { btcUsd, btcChg24, solUsd, solChg24, nasdaqChg1d, mood: moodOf(btcChg24, solChg24), fetchedAt: now };
    cached = { ...partial, facts: factsOf(partial) };
    return cached;
  } catch {
    return cached && now - cached.fetchedAt < STALE_OK_MS ? cached : null;
  }
}
