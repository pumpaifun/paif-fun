import type { Express, Request, Response } from "express";
import { and, asc, desc, eq, gt, ilike, or, sql } from "drizzle-orm";
import { db } from "./db";
import { tokenizedStockCatalog, type InsertTokenizedStockCatalogRow } from "@workspace/db";
import { clientIp, rateLimit } from "./security";

const XSTOCKS_API = "https://api.xstocks.fi/api/v2";
const ONDO_API = "https://api.gm.ondo.finance/v1";
const DEXSCREENER_API = "https://api.dexscreener.com/latest/dex/tokens";
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const REFRESH_MS = 2 * 60_000;
const MARKET_STALE_MS = 30 * 60_000;
const SOURCE_STALE_MS = 30 * 60_000;
const FETCH_TIMEOUT_MS = 12_000;
const EASTERN_TIME_ZONE = "America/New_York";

export type TokenizedStockIssuer = "xStocks" | "Ondo";
export type TokenizedStockSort = "availability" | "liquidity" | "volume24h" | "priceChange24h";

type NormalizedAsset = Omit<InsertTokenizedStockCatalogRow, "updatedAt">;
export type UsEquityMarketSession = {
  state: "open" | "closed" | "unavailable";
  nextOpenAt: string | null;
  timeZone: typeof EASTERN_TIME_ZONE;
  calendarStatus: UsEquityMarketCalendarStatus;
};
export type UsEquityMarketCalendarStatus = {
  state: "current" | "historical" | "stale" | "unsupported";
  year: number;
  source: string | null;
  lastUpdatedAt: string | null;
  message: string;
};
export type SourceStatus = {
  state: "live" | "stale" | "error" | "unconfigured";
  itemCount: number;
  lastSuccessAt: string | null;
  message: string | null;
};

const sourceStatus: Record<TokenizedStockIssuer, SourceStatus> = {
  xStocks: { state: "stale", itemCount: 0, lastSuccessAt: null, message: "Waiting for the first issuer catalog refresh." },
  Ondo: {
    state: process.env.ONDO_API_KEY ? "stale" : "unconfigured",
    itemCount: 0,
    lastSuccessAt: null,
    message: process.env.ONDO_API_KEY ? "Waiting for the first issuer catalog refresh." : "Ondo's official API requires an ONDO_API_KEY.",
  },
};

let refreshPromise: Promise<void> | null = null;
let lastRefreshStartedAt = 0;
let refreshTimer: NodeJS.Timeout | null = null;

const easternFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: EASTERN_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const CALENDAR_SOURCE = "NYSE and Nasdaq published U.S. market calendars";
const CALENDAR_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1_000;
type AnnualUsEquityCalendar = {
  lastUpdatedAt: string;
  fullClosures: readonly string[];
  earlyCloses: readonly string[];
};

// This is intentionally an in-process, reviewed snapshot. It keeps request-time
// market availability independent of an exchange website or another upstream
// API. The recurring rules below cover the common schedule; these annual
// entries are the explicit exchange exceptions and the dates most likely to be
// changed when an annual calendar is amended (including observed-holiday
// adjacency).
const US_EQUITY_ANNUAL_CALENDARS: Readonly<Record<number, AnnualUsEquityCalendar>> = {
  2023: {
    lastUpdatedAt: "2023-01-03T00:00:00.000Z",
    fullClosures: [],
    earlyCloses: ["2023-07-03", "2023-11-24", "2023-12-22"],
  },
  2024: {
    lastUpdatedAt: "2024-01-03T00:00:00.000Z",
    fullClosures: [],
    earlyCloses: ["2024-07-03", "2024-11-29", "2024-12-24"],
  },
  2025: {
    lastUpdatedAt: "2025-01-03T00:00:00.000Z",
    // National Day of Mourning for former President Jimmy Carter.
    fullClosures: ["2025-01-09"],
    earlyCloses: ["2025-07-03", "2025-11-28", "2025-12-24"],
  },
  2026: {
    lastUpdatedAt: "2026-01-05T00:00:00.000Z",
    fullClosures: [],
    // July 2 is the early close before the Friday, July 3 observed holiday.
    earlyCloses: ["2026-07-02", "2026-11-27", "2026-12-24"],
  },
  2027: {
    lastUpdatedAt: "2026-09-01T00:00:00.000Z",
    fullClosures: [],
    // December 23 is the early close before the Friday, December 24 observed
    // Christmas holiday.
    earlyCloses: ["2027-07-02", "2027-11-26", "2027-12-23"],
  },
};

function easternParts(date: Date) {
  const values = Object.fromEntries(
    easternFormatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    weekday: values.weekday,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function observedFixedHoliday(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  if (weekday === 6) date.setUTCDate(date.getUTCDate() - 1);
  if (weekday === 0) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function nthWeekday(year: number, month: number, weekday: number, occurrence: number): string {
  const date = new Date(Date.UTC(year, month - 1, 1));
  date.setUTCDate(1 + ((weekday - date.getUTCDay() + 7) % 7) + (occurrence - 1) * 7);
  return date.toISOString().slice(0, 10);
}

function lastWeekday(year: number, month: number, weekday: number): string {
  const date = new Date(Date.UTC(year, month, 0));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() - weekday + 7) % 7));
  return date.toISOString().slice(0, 10);
}

function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

export function isUsEquityMarketHoliday(year: number, month: number, day: number): boolean {
  const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const annualCalendar = US_EQUITY_ANNUAL_CALENDARS[year];
  if (annualCalendar?.fullClosures.includes(key)) return true;
  const goodFriday = easterSunday(year);
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  return new Set([
    observedFixedHoliday(year, 1, 1),
    observedFixedHoliday(year + 1, 1, 1),
    nthWeekday(year, 1, 1, 3),
    nthWeekday(year, 2, 1, 3),
    goodFriday.toISOString().slice(0, 10),
    lastWeekday(year, 5, 1),
    observedFixedHoliday(year, 6, 19),
    observedFixedHoliday(year, 7, 4),
    nthWeekday(year, 9, 1, 1),
    nthWeekday(year, 11, 4, 4),
    observedFixedHoliday(year, 12, 25),
  ]).has(key);
}

export function getUsEquityMarketCalendarStatus(
  year: number,
  now = new Date(),
): UsEquityMarketCalendarStatus {
  const annualCalendar = US_EQUITY_ANNUAL_CALENDARS[year];
  if (!annualCalendar) {
    return {
      state: "unsupported",
      year,
      source: null,
      lastUpdatedAt: null,
      message: `The U.S. equity calendar for ${year} is not loaded; stock availability is paused rather than assuming regular hours.`,
    };
  }

  const currentYear = easternParts(now).year;
  const lastUpdatedAt = new Date(annualCalendar.lastUpdatedAt);
  const stale = year >= currentYear &&
    (!Number.isFinite(lastUpdatedAt.getTime()) || now.getTime() - lastUpdatedAt.getTime() > CALENDAR_MAX_AGE_MS);
  if (stale) {
    return {
      state: "stale",
      year,
      source: CALENDAR_SOURCE,
      lastUpdatedAt: annualCalendar.lastUpdatedAt,
      message: `The U.S. equity calendar for ${year} is stale; stock availability is paused until the annual exchange schedule is reviewed.`,
    };
  }

  return {
    state: year < currentYear ? "historical" : "current",
    year,
    source: CALENDAR_SOURCE,
    lastUpdatedAt: annualCalendar.lastUpdatedAt,
    message: "The annual U.S. equity session calendar is loaded locally.",
  };
}

function easternLocalToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let guess = desiredAsUtc;
  for (let attempt = 0; attempt < 2; attempt++) {
    const parts = easternParts(new Date(guess));
    const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    guess += desiredAsUtc - representedAsUtc;
  }
  return new Date(guess);
}

function isTradingDay(year: number, month: number, day: number): boolean {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday >= 1 && weekday <= 5 && !isUsEquityMarketHoliday(year, month, day);
}

function isUsEquityEarlyClose(year: number, month: number, day: number): boolean {
  if (!isTradingDay(year, month, day)) return false;

  const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const annualCalendar = US_EQUITY_ANNUAL_CALENDARS[year];
  if (annualCalendar?.earlyCloses.includes(key)) return true;
  const thanksgiving = nthWeekday(year, 11, 4, 4);
  const dayAfterThanksgiving = new Date(`${thanksgiving}T00:00:00.000Z`);
  dayAfterThanksgiving.setUTCDate(dayAfterThanksgiving.getUTCDate() + 1);

  const earlyCloseBeforeFixedHoliday = (holidayMonth: number, holidayDay: number): string | null => {
    const holiday = new Date(Date.UTC(year, holidayMonth - 1, holidayDay));
    const weekday = holiday.getUTCDay();
    if (weekday === 6) return null;
    holiday.setUTCDate(holiday.getUTCDate() - (weekday === 0 ? 2 : weekday === 1 ? 3 : 1));
    return holiday.toISOString().slice(0, 10);
  };

  return key === dayAfterThanksgiving.toISOString().slice(0, 10)
    || key === earlyCloseBeforeFixedHoliday(7, 4)
    || key === earlyCloseBeforeFixedHoliday(12, 25);
}

export function getUsEquityMarketSession(now = new Date()): UsEquityMarketSession {
  const current = easternParts(now);
  const calendarStatus = getUsEquityMarketCalendarStatus(current.year, now);
  if (calendarStatus.state === "unsupported" || calendarStatus.state === "stale") {
    return {
      state: "unavailable",
      nextOpenAt: null,
      timeZone: EASTERN_TIME_ZONE,
      calendarStatus,
    };
  }
  const minutes = current.hour * 60 + current.minute;
  const tradingDay = isTradingDay(current.year, current.month, current.day);
  const closeMinutes = isUsEquityEarlyClose(current.year, current.month, current.day)
    ? 13 * 60
    : 16 * 60;
  if (tradingDay && minutes >= 9 * 60 + 30 && minutes < closeMinutes) {
    return { state: "open", nextOpenAt: null, timeZone: EASTERN_TIME_ZONE, calendarStatus };
  }

  let candidate = new Date(Date.UTC(current.year, current.month - 1, current.day));
  if (tradingDay && minutes < 9 * 60 + 30) {
    return {
      state: "closed",
      nextOpenAt: easternLocalToUtc(current.year, current.month, current.day, 9, 30).toISOString(),
      timeZone: EASTERN_TIME_ZONE,
      calendarStatus,
    };
  }
  for (let daysAhead = 0; daysAhead < 370; daysAhead++) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
    const candidateYear = candidate.getUTCFullYear();
    const candidateCalendarStatus = getUsEquityMarketCalendarStatus(candidateYear, now);
    if (candidateCalendarStatus.state === "unsupported" || candidateCalendarStatus.state === "stale") {
      return {
        state: "unavailable",
        nextOpenAt: null,
        timeZone: EASTERN_TIME_ZONE,
        calendarStatus: candidateCalendarStatus,
      };
    }
    if (!isTradingDay(candidateYear, candidate.getUTCMonth() + 1, candidate.getUTCDate())) continue;
    return {
      state: "closed",
      nextOpenAt: easternLocalToUtc(
        candidateYear,
        candidate.getUTCMonth() + 1,
        candidate.getUTCDate(),
        9,
        30,
      ).toISOString(),
      timeZone: EASTERN_TIME_ZONE,
      calendarStatus,
    };
  }
  return {
    state: "unavailable",
    nextOpenAt: null,
    timeZone: EASTERN_TIME_ZONE,
    calendarStatus: {
      state: "unsupported",
      year: candidate.getUTCFullYear(),
      source: null,
      lastUpdatedAt: null,
      message: "No supported U.S. equity session was found in the calendar horizon; stock availability is paused.",
    },
  };
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(number) ? number : null;
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function mapLimit<T, R>(values: T[], concurrency: number, mapper: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await mapper(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function normalizeXStocksAsset(asset: any, catalogObservedAt = new Date()): NormalizedAsset | null {
  const deployment = Array.isArray(asset?.deployments)
    ? asset.deployments.find((entry: any) => entry?.network === "Solana" && SOLANA_ADDRESS.test(String(entry?.address || "")))
    : null;
  if (!deployment) return null;
  const mint = String(deployment.address);
  const halted = Boolean(asset?.isTradingHalted || asset?.trading?.isTradingHalted);
  const openNow = Boolean(asset?.trading?.openNow);
  const tradingStatus = halted ? "halted" : openNow ? "available" : "closed";
  return {
    issuer: "xStocks",
    mint,
    issuerAssetId: String(asset.id || asset.symbol || mint),
    name: String(asset.name || asset.symbol || "xStock"),
    tokenSymbol: String(asset.symbol || ""),
    underlyingTicker: String(asset?.underlying?.symbol || asset?.underlyingSymbol || ""),
    instrumentType: asset?.underlying?.type ? String(asset.underlying.type) : null,
    logoUrl: asset?.logo ? String(asset.logo) : null,
    tradingStatus,
    availabilityLabel: halted ? "Issuer trading halted" : openNow ? "Issuer market open" : "Issuer market closed",
    priceUsd: null,
    liquidityUsd: null,
    volume24hUsd: null,
    priceChange24hPct: null,
    marketDataObservedAt: null,
    issuerCatalogObservedAt: catalogObservedAt,
    lastAttemptAt: catalogObservedAt,
    marketDataSource: null,
    failure: null,
  };
}

export function normalizeOndoMetadata(asset: any, catalogObservedAt = new Date()): NormalizedAsset[] {
  if (!Array.isArray(asset?.addresses)) return [];
  return asset.addresses.flatMap((deployment: any) => {
    const chain = String(deployment?.networkChainId || "").toLowerCase();
    const mint = String(deployment?.address || "");
    if (!chain.includes("solana") || !SOLANA_ADDRESS.test(mint)) return [];
    return [{
      issuer: "Ondo" as const,
      mint,
      issuerAssetId: String(asset.symbol || mint),
      name: String(asset.displayName || asset.underlyingName || asset.symbol || "Ondo tokenized stock"),
      tokenSymbol: String(asset.symbol || ""),
      underlyingTicker: String(asset.ticker || ""),
      instrumentType: asset?.tags?.instrumentType ? String(asset.tags.instrumentType) : null,
      logoUrl: asset?.logoURI ? String(asset.logoURI) : null,
      tradingStatus: "available",
      availabilityLabel: "Subject to Ondo eligibility and jurisdiction restrictions",
      priceUsd: null,
      liquidityUsd: null,
      volume24hUsd: null,
      priceChange24hPct: null,
      marketDataObservedAt: null,
      issuerCatalogObservedAt: catalogObservedAt,
      lastAttemptAt: catalogObservedAt,
      marketDataSource: null,
      failure: null,
    }];
  });
}

export async function loadAllXStocksAssets(
  fetchPage: (page: number) => Promise<any> = (page) =>
    fetchJson(`${XSTOCKS_API}/public/assets?network=Solana&page=${page}&pageSize=100`),
): Promise<any[]> {
  const assets: any[] = [];
  for (let page = 0; page < 100; page++) {
    const payload = await fetchPage(page);
    if (!payload || !Array.isArray(payload.nodes) || !payload.page || typeof payload.page.hasNextPage !== "boolean") {
      throw new Error(`Invalid xStocks pagination response on page ${page}`);
    }
    const nodes = payload.nodes;
    assets.push(...nodes);
    if (!payload?.page?.hasNextPage) return assets;
  }
  throw new Error("xStocks catalog exceeded the pagination safety bound");
}

type MarketMetrics = {
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange24hPct: number | null;
  marketDataObservedAt: Date;
  marketDataSource: string;
};

export function joinOndoMarketData(
  row: Pick<NormalizedAsset, "tokenSymbol" | "mint">,
  markets: any[],
  tickers: any[],
  dexByMint: Map<string, { marketCap: number | null; liquidity: number | null; volume: number | null; price: number | null; change: number | null }>,
  observedAt: Date,
): MarketMetrics {
  const market = markets.find((entry: any) => String(entry?.primaryMarket?.symbol || "") === row.tokenSymbol);
  const ticker = tickers.find((entry: any) => String(entry?.baseCurrency || "") === row.tokenSymbol);
  const dex = dexByMint.get(row.mint);
  const timestamp = finiteNumber(market?.timestamp);
  return {
    priceUsd: finiteNumber(market?.primaryMarket?.price) ?? finiteNumber(ticker?.lastPrice) ?? dex?.price ?? null,
    marketCapUsd: dex?.marketCap ?? null,
    priceChange24hPct: finiteNumber(market?.primaryMarket?.priceChangePct24h) ?? dex?.change ?? null,
    volume24hUsd: finiteNumber(ticker?.targetVolume) ?? dex?.volume ?? null,
    liquidityUsd: dex?.liquidity ?? null,
    marketDataObservedAt: timestamp ? new Date(timestamp) : observedAt,
    marketDataSource: dex ? "Ondo market data + DexScreener Solana markets" : "Ondo market data",
  };
}

async function getDexMarketByMint(mints: string[]): Promise<Map<string, { marketCap: number | null; liquidity: number | null; volume: number | null; price: number | null; change: number | null }>> {
  const result = new Map<string, { marketCap: number | null; liquidity: number | null; volume: number | null; price: number | null; change: number | null }>();
  const chunks: string[][] = [];
  for (let index = 0; index < mints.length; index += 30) chunks.push(mints.slice(index, index + 30));
  await mapLimit(chunks, 3, async (chunk) => {
    try {
      const payload = await fetchJson(`${DEXSCREENER_API}/${chunk.join(",")}`);
      const pairs = Array.isArray(payload?.pairs) ? payload.pairs : [];
      for (const mint of chunk) {
        const mintPairs = pairs.filter((pair: any) =>
          pair?.chainId === "solana" &&
          (pair?.baseToken?.address === mint || pair?.quoteToken?.address === mint));
        if (!mintPairs.length) continue;
        const best = mintPairs.sort((a: any, b: any) =>
          (finiteNumber(b?.liquidity?.usd) ?? -1) - (finiteNumber(a?.liquidity?.usd) ?? -1))[0];
        const isBase = best?.baseToken?.address === mint;
        result.set(mint, {
          marketCap: isBase ? finiteNumber(best?.marketCap) : null,
          liquidity: finiteNumber(best?.liquidity?.usd),
          volume: finiteNumber(best?.volume?.h24),
          price: isBase ? finiteNumber(best?.priceUsd) : null,
          change: isBase ? finiteNumber(best?.priceChange?.h24) : null,
        });
      }
    } catch {
      // An issuer-verified row remains useful when secondary market coverage is unavailable.
    }
  });
  return result;
}

async function upsertIssuerRows(issuer: TokenizedStockIssuer, rows: NormalizedAsset[]): Promise<void> {
  if (!rows.length) throw new Error(`No issuer-verified Solana mints returned by ${issuer}`);
  await db.insert(tokenizedStockCatalog).values(rows).onConflictDoUpdate({
      target: [tokenizedStockCatalog.issuer, tokenizedStockCatalog.mint],
      set: {
        issuerAssetId: sql`excluded.issuer_asset_id`,
        name: sql`excluded.name`,
        tokenSymbol: sql`excluded.token_symbol`,
        underlyingTicker: sql`excluded.underlying_ticker`,
        instrumentType: sql`excluded.instrument_type`,
        logoUrl: sql`excluded.logo_url`,
        tradingStatus: sql`excluded.trading_status`,
        availabilityLabel: sql`excluded.availability_label`,
        priceUsd: sql`coalesce(excluded.price_usd, ${tokenizedStockCatalog.priceUsd})`,
        marketCapUsd: sql`coalesce(excluded.market_cap_usd, ${tokenizedStockCatalog.marketCapUsd})`,
        liquidityUsd: sql`coalesce(excluded.liquidity_usd, ${tokenizedStockCatalog.liquidityUsd})`,
        volume24hUsd: sql`coalesce(excluded.volume_24h_usd, ${tokenizedStockCatalog.volume24hUsd})`,
        priceChange24hPct: sql`coalesce(excluded.price_change_24h_pct, ${tokenizedStockCatalog.priceChange24hPct})`,
        marketDataObservedAt: sql`coalesce(excluded.market_data_observed_at, ${tokenizedStockCatalog.marketDataObservedAt})`,
        issuerCatalogObservedAt: sql`excluded.issuer_catalog_observed_at`,
        lastAttemptAt: sql`excluded.last_attempt_at`,
        marketDataSource: sql`coalesce(excluded.market_data_source, ${tokenizedStockCatalog.marketDataSource})`,
        failure: sql`excluded.failure`,
        updatedAt: new Date(),
      },
    });
}

async function refreshXStocks(): Promise<void> {
  const observedAt = new Date();
  try {
    const assets = await loadAllXStocksAssets();
    const rows = assets.map((asset) => normalizeXStocksAsset(asset, observedAt)).filter((row): row is NormalizedAsset => row !== null);
    const marketSession = getUsEquityMarketSession(observedAt);
    const marketByMint = marketSession.state === "open"
      ? await getDexMarketByMint(rows.map((row) => row.mint))
      : new Map<string, { marketCap: number | null; liquidity: number | null; volume: number | null; price: number | null; change: number | null }>();
    rows.forEach((row) => {
      const market = marketByMint.get(row.mint);
      row.priceUsd = market?.price ?? null;
       row.marketCapUsd = market?.marketCap ?? null;
      row.liquidityUsd = market?.liquidity ?? null;
      row.volume24hUsd = market?.volume ?? null;
      row.priceChange24hPct = market?.change ?? null;
      row.marketDataObservedAt = market ? observedAt : null;
      row.marketDataSource = market ? "DexScreener Solana markets" : null;
      row.failure = marketSession.state === "unavailable"
        ? marketSession.calendarStatus.message
        : marketSession.state === "closed"
        ? "Underlying U.S. market closed — showing the last market snapshot"
        : row.marketDataObservedAt ? null : "Market data unavailable";
    });
    await upsertIssuerRows("xStocks", rows);
    sourceStatus.xStocks = { state: "live", itemCount: rows.length, lastSuccessAt: observedAt.toISOString(), message: null };
  } catch (error) {
    sourceStatus.xStocks = { ...sourceStatus.xStocks, state: "error", message: error instanceof Error ? error.message : "xStocks refresh failed" };
  }
}

async function refreshOndo(): Promise<void> {
  const apiKey = process.env.ONDO_API_KEY;
  if (!apiKey) {
    sourceStatus.Ondo = { ...sourceStatus.Ondo, state: "unconfigured", message: "Ondo's official API requires an ONDO_API_KEY." };
    return;
  }
  const observedAt = new Date();
  try {
    const headers = { "x-api-key": apiKey };
    const [metadata, markets, tickers] = await Promise.all([
      fetchJson(`${ONDO_API}/assets/all/metadata`, headers),
      fetchJson(`${ONDO_API}/assets/all/market`, headers),
      fetchJson(`${ONDO_API}/tickers`, headers),
    ]);
    const rows = (Array.isArray(metadata) ? metadata : []).flatMap((asset) => normalizeOndoMetadata(asset, observedAt));
    const marketRows = Array.isArray(markets) ? markets : [];
    const tickerRows = Array.isArray(tickers) ? tickers : [];
    const dexByMint = await getDexMarketByMint(rows.map((row) => row.mint));
    rows.forEach((row) => {
      Object.assign(row, joinOndoMarketData(row, marketRows, tickerRows, dexByMint, observedAt));
      row.failure = null;
    });
    await upsertIssuerRows("Ondo", rows);
    sourceStatus.Ondo = { state: "live", itemCount: rows.length, lastSuccessAt: observedAt.toISOString(), message: null };
  } catch (error) {
    sourceStatus.Ondo = { ...sourceStatus.Ondo, state: "error", message: error instanceof Error ? error.message : "Ondo refresh failed" };
  }
}

export async function refreshTokenizedStocks(force = false): Promise<void> {
  if (refreshPromise) return refreshPromise;
  if (!force && Date.now() - lastRefreshStartedAt < REFRESH_MS) return;
  lastRefreshStartedAt = Date.now();
  refreshPromise = Promise.all([refreshXStocks(), refreshOndo()]).then(() => undefined).finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export function startTokenizedStockCatalog(): void {
  void refreshTokenizedStocks(false).catch((error) => {
    console.error("[tokenized-stocks] startup refresh failed:", error instanceof Error ? error.message : error);
  });
  if (!refreshTimer) {
    refreshTimer = setInterval(() => void refreshTokenizedStocks(true), REFRESH_MS);
    refreshTimer.unref();
  }
}

function availabilityRank(status: string): number {
  return status === "available" ? 3 : status === "closed" ? 2 : status === "halted" ? 0 : 1;
}

export function compareNullableMetricDescending(
  metric: "liquidityUsd" | "volume24hUsd" | "priceChange24hPct",
  a: Record<string, any>,
  b: Record<string, any>,
): number {
  const aValue = finiteNumber(a[metric]);
  const bValue = finiteNumber(b[metric]);
  if (aValue === null && bValue === null) return String(a.underlyingTicker || "").localeCompare(String(b.underlyingTicker || ""));
  if (aValue === null) return 1;
  if (bValue === null) return -1;
  return bValue - aValue || String(a.underlyingTicker || "").localeCompare(String(b.underlyingTicker || ""));
}

export function effectiveSourceStatus(status: SourceStatus, now = Date.now()): SourceStatus {
  const stale = status.lastSuccessAt !== null && now - new Date(status.lastSuccessAt).getTime() > SOURCE_STALE_MS;
  return stale && status.state === "live"
    ? { ...status, state: "stale", message: "Issuer refresh is delayed." }
    : { ...status };
}

export async function listTokenizedStocks(
  sort: TokenizedStockSort,
  issuer?: TokenizedStockIssuer,
  limit = 100,
  offset = 0,
) {
  const order = sort === "liquidity" ? sql`${tokenizedStockCatalog.liquidityUsd} DESC NULLS LAST`
    : sort === "volume24h" ? sql`${tokenizedStockCatalog.volume24hUsd} DESC NULLS LAST`
    : sort === "priceChange24h" ? sql`${tokenizedStockCatalog.priceChange24hPct} DESC NULLS LAST`
    : asc(tokenizedStockCatalog.underlyingTicker);
  const rows = await db.select().from(tokenizedStockCatalog)
    .where(issuer ? eq(tokenizedStockCatalog.issuer, issuer) : undefined)
    .orderBy(order, asc(tokenizedStockCatalog.underlyingTicker), asc(tokenizedStockCatalog.mint))
    .limit(limit)
    .offset(offset);
  const now = Date.now();
  const marketSession = getUsEquityMarketSession(new Date(now));
  const mapped = rows.map((row) => {
    const marketObservedAt = row.marketDataObservedAt?.getTime() ?? null;
    const marketDataStale = marketSession.state === "open" &&
      (marketObservedAt === null || now - marketObservedAt > MARKET_STALE_MS);
    return {
      ...row,
      verifiedMint: true,
      network: "Solana",
      priceUnit: "USD per token",
      liquidityUnit: "USD",
      volumeUnit: "USD / 24h",
      marketDataStale,
      rankScore: availabilityRank(row.tradingStatus),
    };
  });
  if (sort === "availability") {
    mapped.sort((a, b) =>
      b.rankScore - a.rankScore ||
      (b.liquidityUsd ?? -1) - (a.liquidityUsd ?? -1) ||
      a.underlyingTicker.localeCompare(b.underlyingTicker));
  }
  return mapped;
}

export async function getVerifiedTokenizedStockCatalogEntry(mint: string) {
  if (!SOLANA_ADDRESS.test(mint)) return null;
  const [row] = await db.select().from(tokenizedStockCatalog)
    .where(eq(tokenizedStockCatalog.mint, mint))
    .limit(1);
  return row ?? null;
}

export async function getVerifiedTokenizedStock(mint: string) {
  const row = await getVerifiedTokenizedStockCatalogEntry(mint);
  if (!row || row.tradingStatus === "halted" || !row.priceUsd || row.priceUsd <= 0) return null;
  return row;
}

export async function searchVerifiedXStocks(query: string, limit = 8) {
  const term = query.trim().slice(0, 40);
  if (!term) return [];
  const contains = `%${term}%`;
  const startsWith = `${term}%`;
  return db.select().from(tokenizedStockCatalog)
    .where(and(
      eq(tokenizedStockCatalog.issuer, "xStocks"),
      or(
        ilike(tokenizedStockCatalog.tokenSymbol, startsWith),
        ilike(tokenizedStockCatalog.underlyingTicker, startsWith),
        ilike(tokenizedStockCatalog.name, contains),
      ),
    ))
    .orderBy(
      sql`CASE
        WHEN lower(${tokenizedStockCatalog.tokenSymbol}) = lower(${term}) THEN 0
        WHEN lower(${tokenizedStockCatalog.underlyingTicker}) = lower(${term}) THEN 1
        WHEN lower(${tokenizedStockCatalog.name}) = lower(${term}) THEN 2
        ELSE 3
      END`,
      asc(tokenizedStockCatalog.tokenSymbol),
    )
    .limit(Math.max(1, Math.min(10, limit)));
}

export async function listVerifiedXStocksForSwingScan(limit = 24, includeMarketClosed = false) {
  return db.select().from(tokenizedStockCatalog)
    .where(and(
      eq(tokenizedStockCatalog.issuer, "xStocks"),
      includeMarketClosed
        ? or(
            eq(tokenizedStockCatalog.tradingStatus, "available"),
            eq(tokenizedStockCatalog.tradingStatus, "closed"),
          )
        : eq(tokenizedStockCatalog.tradingStatus, "available"),
      gt(tokenizedStockCatalog.priceUsd, 0),
    ))
    .orderBy(
      desc(tokenizedStockCatalog.priceChange24hPct),
      desc(tokenizedStockCatalog.volume24hUsd),
      desc(tokenizedStockCatalog.liquidityUsd),
    )
    .limit(Math.max(1, Math.min(50, limit)));
}

export function registerTokenizedStockRoutes(app: Express) {
  const allowRead = (req: Request, res: Response) => {
    if (rateLimit(`tokenized-stocks:${clientIp(req)}`, 120, 60_000)) return true;
    res.status(429).json({ error: "Too many tokenized-stock catalog requests" });
    return false;
  };
  app.get("/api/tokenized-stocks/search", async (req, res) => {
    if (!allowRead(req, res)) return;
    const query = String(req.query.q || "").trim();
    if (!query || query.length > 40 || !/^[A-Za-z0-9 .&_-]+$/.test(query)) {
      return res.status(400).json({ error: "Enter a valid xStock symbol or name." });
    }
    try {
      void refreshTokenizedStocks(false);
      const assets = await searchVerifiedXStocks(query);
      res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
      res.json({ assets });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to search verified xStocks" });
    }
  });
  app.get("/api/tokenized-stocks/verified/:mint", async (req, res) => {
    if (!allowRead(req, res)) return;
    const asset = await getVerifiedTokenizedStockCatalogEntry(String(req.params.mint || ""));
    if (!asset) return res.status(404).json({ error: "Verified xStock not found." });
    const observedAt = asset.marketDataObservedAt?.getTime() ?? null;
    const marketSession = getUsEquityMarketSession();
    res.json({
      ...asset,
      verifiedMint: true,
      network: "Solana",
      marketDataStale: marketSession.state === "open" &&
        (observedAt === null || Date.now() - observedAt > MARKET_STALE_MS),
      marketSession,
    });
  });
  app.get("/api/tokenized-stocks", async (req, res) => {
    if (!allowRead(req, res)) return;
    const sort = String(req.query.sort || "availability") as TokenizedStockSort;
    const issuer = req.query.issuer ? String(req.query.issuer) as TokenizedStockIssuer : undefined;
    if (!["availability", "liquidity", "volume24h", "priceChange24h"].includes(sort)) {
      return res.status(400).json({ error: "Invalid tokenized-stock sort" });
    }
    if (issuer && !["xStocks", "Ondo"].includes(issuer)) {
      return res.status(400).json({ error: "Invalid tokenized-stock issuer" });
    }
    const page = Math.max(0, Math.min(10_000, Number.parseInt(String(req.query.page || "0"), 10) || 0));
    const pageSize = Math.max(1, Math.min(100, Number.parseInt(String(req.query.pageSize || "100"), 10) || 100));
    try {
      // Serve the last verified snapshot immediately; issuer refreshes happen
      // out of band so a cold upstream cannot turn a read-only page into a
      // minute-long request.
      void refreshTokenizedStocks(false);
      const [assets, counts] = await Promise.all([
        listTokenizedStocks(sort, issuer, pageSize, page * pageSize),
        db.select({ issuer: tokenizedStockCatalog.issuer, count: sql<number>`count(*)::int` })
          .from(tokenizedStockCatalog)
          .groupBy(tokenizedStockCatalog.issuer),
      ]);
      for (const source of ["xStocks", "Ondo"] as const) {
        sourceStatus[source].itemCount = counts.find((row) => row.issuer === source)?.count ?? 0;
      }
      const effectiveSources = Object.fromEntries(Object.entries(sourceStatus).map(([name, status]) => {
        return [name, effectiveSourceStatus(status)];
      })) as Record<TokenizedStockIssuer, SourceStatus>;
      const partial = Object.values(effectiveSources).some((status) => status.state !== "live");
      const catalogCount = issuer
        ? counts.find((row) => row.issuer === issuer)?.count ?? 0
        : counts.reduce((sum, row) => sum + row.count, 0);
      res.set("Cache-Control", "public, max-age=20, stale-while-revalidate=60");
      res.json({
        assets,
        status: {
          partial,
          readOnly: true,
          sources: effectiveSources,
          catalogCount,
          page,
          pageSize,
          hasNextPage: (page + 1) * pageSize < catalogCount,
          generatedAt: new Date().toISOString(),
          marketSession: getUsEquityMarketSession(),
          disclosure: "Discovery data only. Rankings are not investment advice. Availability depends on issuer eligibility and jurisdiction rules.",
        },
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load tokenized-stock catalog" });
    }
  });
}