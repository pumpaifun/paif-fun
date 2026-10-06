import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  compareNullableMetricDescending,
  effectiveSourceStatus,
  getUsEquityMarketCalendarStatus,
  getUsEquityMarketSession,
  isUsEquityMarketHoliday,
  joinOndoMarketData,
  loadAllXStocksAssets,
  normalizeOndoMetadata,
  normalizeXStocksAsset,
} from "./tokenized-stocks";

const fixture = async (name: string) =>
  JSON.parse(await readFile(new URL(`./fixtures/tokenized-stocks/${name}`, import.meta.url), "utf8"));

const xStockPages = await fixture("xstocks-pages.json");
const allXStocks = await loadAllXStocksAssets(async (page) => xStockPages[page]);
assert.equal(allXStocks.length, 2, "all advertised xStocks pages must be loaded");
assert.deepEqual(allXStocks.map((asset: any) => normalizeXStocksAsset(asset)?.underlyingTicker), ["AAPL", "TSLA"]);

const persistedMints = new Set(["persisted-issuer-mint"]);
await assert.rejects(
  loadAllXStocksAssets(async (page) => page === 0 ? xStockPages[0] : { nodes: [] }),
  /Invalid xStocks pagination response on page 1/,
  "an incomplete next page must fail the refresh rather than look like an empty final page",
);
assert.deepEqual([...persistedMints], ["persisted-issuer-mint"], "failed pagination must not mutate the last verified snapshot");

const xStock = normalizeXStocksAsset(allXStocks[0]);
assert.equal(xStock?.mint, "So11111111111111111111111111111111111111112");
assert.equal(xStock?.tradingStatus, "available");
assert.equal(normalizeXStocksAsset({ symbol: "FAKEx", deployments: [] }), null, "symbol-only xStocks must be rejected");

const ondoFixture = await fixture("ondo.json");
const ondo = normalizeOndoMetadata(ondoFixture.metadata[0]);
assert.equal(ondo.length, 1);
const ondoMetrics = joinOndoMarketData(ondo[0], ondoFixture.markets, ondoFixture.tickers, new Map([[
  ondo[0].mint,
  { marketCap: 12_345_678, liquidity: null, volume: null, price: null, change: null },
]]), new Date(0));
assert.equal(ondoMetrics.priceUsd, 226.25, "primary market price wins the ticker fallback");
assert.equal(ondoMetrics.marketCapUsd, 12_345_678, "DexScreener token market cap remains distinct from issuer price data");
assert.equal(ondoMetrics.priceChange24hPct, 1.75);
assert.equal(ondoMetrics.volume24hUsd, 125000.5);
assert.equal(ondoMetrics.marketDataObservedAt.toISOString(), "2026-09-01T00:00:00.000Z");
assert.equal(normalizeOndoMetadata({ symbol: "AAPLon", ticker: "AAPL" }).length, 0, "symbol-only Ondo rows must be rejected");

const ranked = [
  { underlyingTicker: "UNKNOWN", liquidityUsd: null },
  { underlyingTicker: "SMALL", liquidityUsd: 10 },
  { underlyingTicker: "LARGE", liquidityUsd: 100 },
].sort((a, b) => compareNullableMetricDescending("liquidityUsd", a, b));
assert.deepEqual(ranked.map((row) => row.underlyingTicker), ["LARGE", "SMALL", "UNKNOWN"]);

const lastSnapshot = [{ mint: "persisted-issuer-mint" }];
const staleStatus = effectiveSourceStatus({
  state: "live",
  itemCount: lastSnapshot.length,
  lastSuccessAt: "2026-09-01T00:00:00.000Z",
  message: null,
}, Date.parse("2026-09-01T00:31:00.000Z"));
assert.equal(staleStatus.state, "stale");
assert.equal(staleStatus.itemCount, 1);
assert.deepEqual(lastSnapshot, [{ mint: "persisted-issuer-mint" }], "staleness must not discard the verified snapshot");

assert.equal(getUsEquityMarketSession(new Date("2026-09-04T15:00:00.000Z")).state, "open");
const fridayClose = getUsEquityMarketSession(new Date("2026-09-04T21:00:00.000Z"));
assert.equal(fridayClose.state, "closed");
assert.equal(fridayClose.nextOpenAt, "2026-09-08T13:30:00.000Z", "Labor Day weekend must count down to Tuesday's opening");
assert.equal(isUsEquityMarketHoliday(2026, 9, 7), true, "Labor Day must be treated as a market holiday");

const carterClosure = getUsEquityMarketSession(new Date("2025-01-09T16:00:00.000Z"));
assert.equal(carterClosure.state, "closed", "the exceptional Carter mourning closure must override recurring rules");
assert.equal(carterClosure.nextOpenAt, "2025-01-10T14:30:00.000Z");
assert.equal(carterClosure.calendarStatus.source, "NYSE and Nasdaq published U.S. market calendars");
assert.equal(getUsEquityMarketCalendarStatus(2099, new Date("2026-09-04T00:00:00.000Z")).state, "unsupported");
assert.equal(getUsEquityMarketSession(new Date("2099-01-02T16:00:00.000Z")).state, "unavailable");
assert.equal(getUsEquityMarketSession(new Date("2027-12-31T16:00:00.000Z")).state, "unavailable", "a stale future calendar must not fall back to regular hours");

assert.equal(
  getUsEquityMarketSession(new Date("2026-11-27T17:59:00.000Z")).state,
  "open",
  "the market remains open immediately before the Black Friday early close",
);
const blackFridayClose = getUsEquityMarketSession(new Date("2026-11-27T18:00:00.000Z"));
assert.equal(blackFridayClose.state, "closed", "Black Friday must close at 1:00 PM Eastern");
assert.equal(
  blackFridayClose.nextOpenAt,
  "2026-11-30T14:30:00.000Z",
  "an early close must count down to the following trading day's opening",
);
assert.equal(
  getUsEquityMarketSession(new Date("2026-11-30T14:30:00.000Z")).state,
  "open",
  "the market must reopen at 9:30 AM Eastern after an early-close weekend",
);
assert.equal(
  getUsEquityMarketSession(new Date("2025-07-03T17:00:00.000Z")).state,
  "closed",
  "a trading-day July 3 must close at 1:00 PM Eastern",
);
assert.equal(
  getUsEquityMarketSession(new Date("2026-12-24T18:00:00.000Z")).state,
  "closed",
  "a trading-day Christmas Eve must close at 1:00 PM Eastern",
);
assert.equal(
  getUsEquityMarketSession(new Date("2026-07-02T16:59:00.000Z")).state,
  "open",
  "the annual calendar keeps the July 2 session open immediately before its early close",
);
assert.equal(
  getUsEquityMarketSession(new Date("2026-07-02T17:00:00.000Z")).state,
  "closed",
  "the annual calendar must capture the July 2 early close before the observed July 4 holiday",
);
assert.equal(
  getUsEquityMarketSession(new Date("2027-07-02T17:00:00.000Z")).state,
  "closed",
  "the Friday before a Monday-observed Independence Day must close at 1:00 PM Eastern",
);
assert.equal(
  getUsEquityMarketSession(new Date("2023-12-22T18:00:00.000Z")).state,
  "closed",
  "the Friday before a Monday Christmas closure must close at 1:00 PM Eastern",
);

console.log("tokenized-stock issuer contract tests passed");