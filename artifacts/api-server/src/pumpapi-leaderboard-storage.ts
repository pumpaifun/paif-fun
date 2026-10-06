import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import {
  pumpApiCreatorLaunches, pumpApiMarketSnapshots, pumpApiObservedTrades,
  pumpApiMintHourlyVolumes, pumpApiMintTradeTotals,
  type InsertPumpApiCreatorLaunch, type InsertPumpApiMarketSnapshot,
  type InsertPumpApiObservedTrade, type PumpApiCreatorLaunch, type PumpApiObservedTrade,
} from "@workspace/db";

export type CreatorLeaderboardSort = "newest" | "launches" | "observedEvents" | "activity" | "graduationRate" | "marketCap" | "currentMarketCap" | "volume24h" | "volume12h" | "volumeTotal";
export type CreatorLeaderboardDirection = "asc" | "desc";

export async function savePumpApiLaunch(launch: InsertPumpApiCreatorLaunch): Promise<PumpApiCreatorLaunch | undefined> {
  const [inserted] = await db.insert(pumpApiCreatorLaunches).values(launch)
    .onConflictDoNothing({ target: pumpApiCreatorLaunches.eventKey }).returning();
  // Replay can safely backfill quote currency for launch rows saved before
  // that field was tracked, without changing attribution or counting a
  // duplicate event as newly accepted.
  if (!inserted && launch.quoteMint) {
    await db.update(pumpApiCreatorLaunches)
      .set({ quoteMint: launch.quoteMint })
      .where(and(
        eq(pumpApiCreatorLaunches.eventKey, launch.eventKey),
        isNull(pumpApiCreatorLaunches.quoteMint),
      ));
  }
  return inserted;
}

/** A trade is retained only if its mint was already observed as a creator launch. */
export async function savePumpApiObservedTrade(trade: InsertPumpApiObservedTrade): Promise<PumpApiObservedTrade | undefined> {
  const known = await db.select({ mint: pumpApiCreatorLaunches.mint })
    .from(pumpApiCreatorLaunches).where(eq(pumpApiCreatorLaunches.mint, trade.mint)).limit(1);
  if (!known.length) return undefined;
  return db.transaction(async (tx) => {
    const [inserted] = await tx.insert(pumpApiObservedTrades).values(trade)
      // Either deterministic identity may establish that replay/live already
      // retained this fact: event_key or signature+mint+pool+action.
      .onConflictDoNothing().returning();
    if (!inserted) return undefined;
    // Legacy top-level/net rows intentionally have no method and remain raw
    // facts only; they must never enter gross-volume aggregates.
    if (trade.volumeMethod !== "breakdown_gross") return inserted;
    const isSol = trade.quoteMint === "So11111111111111111111111111111111111111112";
    const grossTradeCount = trade.breakdownCount ?? 0;
    await tx.insert(pumpApiMintTradeTotals).values({
      mint: trade.mint,
      solGrossQuoteAmount: isSol ? trade.quoteAmount : null,
      solGrossTradeCount: isSol ? grossTradeCount : 0,
      unsupportedTradeCount: isSol ? 0 : grossTradeCount,
      updatedAt: trade.tradedAt,
    }).onConflictDoUpdate({
      target: pumpApiMintTradeTotals.mint,
      set: {
        solGrossQuoteAmount: isSol
          ? sql`coalesce(${pumpApiMintTradeTotals.solGrossQuoteAmount}, 0::double precision) + ${trade.quoteAmount}`
          : pumpApiMintTradeTotals.solGrossQuoteAmount,
        solGrossTradeCount: isSol
          ? sql`${pumpApiMintTradeTotals.solGrossTradeCount} + ${grossTradeCount}`
          : pumpApiMintTradeTotals.solGrossTradeCount,
        unsupportedTradeCount: !isSol
          ? sql`${pumpApiMintTradeTotals.unsupportedTradeCount} + ${grossTradeCount}`
          : pumpApiMintTradeTotals.unsupportedTradeCount,
        updatedAt: sql`greatest(${pumpApiMintTradeTotals.updatedAt}, ${trade.tradedAt})`,
      },
    });
    if (isSol) {
      const hour = new Date(Math.floor(trade.tradedAt.getTime() / 3_600_000) * 3_600_000);
      await tx.insert(pumpApiMintHourlyVolumes).values({
        mint: trade.mint, hour, solGrossQuoteAmount: trade.quoteAmount,
        solGrossTradeCount: grossTradeCount, updatedAt: trade.tradedAt,
      }).onConflictDoUpdate({
        target: [pumpApiMintHourlyVolumes.mint, pumpApiMintHourlyVolumes.hour],
        set: {
          solGrossQuoteAmount: sql`${pumpApiMintHourlyVolumes.solGrossQuoteAmount} + ${trade.quoteAmount}`,
          solGrossTradeCount: sql`${pumpApiMintHourlyVolumes.solGrossTradeCount} + ${grossTradeCount}`,
          updatedAt: sql`greatest(${pumpApiMintHourlyVolumes.updatedAt}, ${trade.tradedAt})`,
        },
      });
    }
    return inserted;
  });
}

export async function upsertPumpApiMarketSnapshot(snapshot: InsertPumpApiMarketSnapshot) {
  await db.insert(pumpApiMarketSnapshots).values(snapshot).onConflictDoUpdate({
    target: pumpApiMarketSnapshots.mint,
    set: {
      // A failed/empty attempt is metadata, not a measured zero.  Preserve the
      // prior successful observation until a later successful replacement.
      // Successful Dex responses replace the snapshot atomically, including
      // null fields. Failed attempts preserve the entire last successful row,
      // so one newly measured metric cannot make another stale metric look new.
      volume24hUsd: sql`case when excluded.observed_at is not null then excluded.volume_24h_usd else ${pumpApiMarketSnapshots.volume24hUsd} end`,
      currentMarketCapUsd: sql`case when excluded.observed_at is not null then excluded.current_market_cap_usd else ${pumpApiMarketSnapshots.currentMarketCapUsd} end`,
      peakMarketCapUsd: sql`case
        when excluded.observed_at is null or excluded.current_market_cap_usd is null then ${pumpApiMarketSnapshots.peakMarketCapUsd}
        when ${pumpApiMarketSnapshots.peakMarketCapUsd} is null then excluded.current_market_cap_usd
        else greatest(${pumpApiMarketSnapshots.peakMarketCapUsd}, excluded.current_market_cap_usd)
      end`,
      peakObservedAt: sql`case
        when excluded.observed_at is not null and excluded.current_market_cap_usd is not null
          and (${pumpApiMarketSnapshots.peakMarketCapUsd} is null or excluded.current_market_cap_usd > ${pumpApiMarketSnapshots.peakMarketCapUsd})
        then excluded.observed_at else ${pumpApiMarketSnapshots.peakObservedAt}
      end`,
      outcomeObservedAt: sql`coalesce(excluded.outcome_observed_at, ${pumpApiMarketSnapshots.outcomeObservedAt})`,
      // Graduation is a lifetime observed fact. Once true, a transient response
      // with only the bonding-curve pair (or no pair) must never downgrade it.
      graduatedObserved: sql`case
        when ${pumpApiMarketSnapshots.graduatedObserved} is true or excluded.graduated_observed is true then true
        when excluded.outcome_observed_at is not null then false
        else ${pumpApiMarketSnapshots.graduatedObserved}
      end`,
      observedAt: sql`coalesce(excluded.observed_at, ${pumpApiMarketSnapshots.observedAt})`,
      lastAttemptAt: snapshot.lastAttemptAt,
      failure: snapshot.failure,
      pairCount: sql`case when excluded.observed_at is not null then excluded.pair_count else ${pumpApiMarketSnapshots.pairCount} end`,
    },
  });
}

export async function listRecentObservedMints(limit = 120): Promise<string[]> {
  const result = await db.execute(sql`
    SELECT mint FROM (
      SELECT DISTINCT ON (mint) mint, launched_at
      FROM pumpapi_creator_launches ORDER BY mint, launched_at DESC, event_key DESC
    ) latest ORDER BY launched_at DESC, mint ASC LIMIT ${limit}`);
  return ((result as any).rows ?? result).map((row: any) => row.mint);
}
export async function listKnownPumpApiMints(limit = 10_000): Promise<string[]> {
  return listRecentObservedMints(limit);
}
export async function isKnownPumpApiMint(mint: string): Promise<boolean> {
  const row = await db.select({ mint: pumpApiCreatorLaunches.mint })
    .from(pumpApiCreatorLaunches).where(eq(pumpApiCreatorLaunches.mint, mint)).limit(1);
  return row.length > 0;
}

const sortColumn: Record<CreatorLeaderboardSort, string> = {
  newest: "last_launch_at",
  launches: "launches",
  observedEvents: "observed_events",
  activity: "activity",
  graduationRate: "graduated_launch_rate",
  marketCap: "best_observed_peak_market_cap_usd",
  currentMarketCap: "current_market_cap_usd",
  volume24h: "volume_24h_usd",
  volume12h: "observed_volume_12h_quote",
  volumeTotal: "observed_volume_total_quote",
};

export async function listPumpApiCreatorLeaderboard(
  sort: CreatorLeaderboardSort,
  limit: number,
  direction: CreatorLeaderboardDirection = "desc",
  creatorWallets?: string[],
) {
  // DISTINCT ON establishes the explicit ownership rule for duplicate mint
  // launches. Every trade and market observation can therefore count once.
  const order = sql.raw(`${sortColumn[sort]} ${direction === "asc" ? "ASC" : "DESC"} NULLS LAST, last_launch_at DESC NULLS LAST, creator_wallet ASC`);
  const walletFilter = creatorWallets?.length
    ? sql`WHERE creator_wallet IN (${sql.join(creatorWallets.map((wallet) => sql`${wallet}`), sql`, `)})`
    : sql``;
  const result = await db.execute(sql`
    WITH event_counts AS (
      SELECT creator_wallet, count(*)::int observed_events
      FROM pumpapi_creator_launches GROUP BY creator_wallet
    ), canonical AS (
      SELECT DISTINCT ON (mint) mint, creator_wallet, launched_at, market_cap_quote, quote_mint
      FROM pumpapi_creator_launches
      ORDER BY mint, launched_at ASC, event_key ASC
    ), hourly AS (
      SELECT mint, sum(sol_gross_quote_amount) AS volume_12h
      FROM pumpapi_mint_hourly_volumes
      WHERE hour >= date_trunc('hour', now()) - interval '11 hours'
      GROUP BY mint
    ), trade_rollup AS (
      SELECT c.creator_wallet, c.mint,
        coalesce(t.sol_gross_trade_count, 0)::int AS trade_count,
        coalesce(t.unsupported_trade_count, 0)::int AS unsupported_trade_count,
        h.volume_12h, t.sol_gross_quote_amount AS volume_total
      FROM canonical c
      LEFT JOIN pumpapi_mint_trade_totals t ON t.mint = c.mint
      LEFT JOIN hourly h ON h.mint = c.mint
    ), creator_launches AS (
      SELECT creator_wallet, count(*)::int launches,
        count(*) FILTER (WHERE launched_at >= now() - interval '72 hours')::int activity,
        max(launched_at) last_launch_at,
        max(market_cap_quote) FILTER (WHERE quote_mint = 'So11111111111111111111111111111111111111112') max_launch_market_cap_quote
       FROM canonical GROUP BY creator_wallet
    ), metrics AS (
      SELECT cl.creator_wallet, ec.observed_events, cl.launches, cl.activity, cl.last_launch_at, cl.max_launch_market_cap_quote,
        count(c.mint)::int observed_token_count,
        count(ms.mint) FILTER (WHERE ms.outcome_observed_at IS NOT NULL)::int outcome_covered_tokens,
        count(ms.mint) FILTER (WHERE ms.outcome_observed_at IS NOT NULL AND ms.graduated_observed IS TRUE)::int graduated_launch_count,
        count(ms.mint) FILTER (WHERE ms.outcome_observed_at IS NOT NULL AND ms.graduated_observed IS TRUE)::double precision
          / nullif(count(ms.mint) FILTER (WHERE ms.outcome_observed_at IS NOT NULL), 0) AS graduated_launch_rate,
        max(ms.peak_market_cap_usd) AS best_observed_peak_market_cap_usd,
        count(ms.mint) FILTER (WHERE ms.volume_24h_usd IS NOT NULL AND ms.observed_at >= now() - interval '10 minutes')::int volume_24h_covered_tokens,
        count(ms.mint) FILTER (WHERE ms.current_market_cap_usd IS NOT NULL AND ms.observed_at >= now() - interval '10 minutes')::int current_market_cap_covered_tokens,
        sum(ms.volume_24h_usd) FILTER (WHERE ms.observed_at >= now() - interval '10 minutes') AS volume_24h_usd,
        sum(ms.current_market_cap_usd) FILTER (WHERE ms.observed_at >= now() - interval '10 minutes') AS current_market_cap_usd,
        max(ms.observed_at) FILTER (WHERE ms.observed_at >= now() - interval '10 minutes') AS volume_24h_observed_at,
        sum(tr.volume_12h) AS observed_volume_12h_quote,
        sum(tr.volume_total) AS observed_volume_total_quote,
        coalesce(sum(tr.trade_count), 0)::int observed_trade_count,
        coalesce(sum(tr.unsupported_trade_count), 0)::int unsupported_observed_trade_count
      FROM creator_launches cl
      JOIN event_counts ec ON ec.creator_wallet = cl.creator_wallet
      LEFT JOIN canonical c ON c.creator_wallet = cl.creator_wallet
      LEFT JOIN trade_rollup tr ON tr.creator_wallet = c.creator_wallet AND tr.mint = c.mint
      LEFT JOIN pumpapi_market_snapshots ms ON ms.mint = c.mint
      GROUP BY cl.creator_wallet, ec.observed_events, cl.launches, cl.activity, cl.last_launch_at, cl.max_launch_market_cap_quote
    ) SELECT * FROM metrics ${walletFilter} ORDER BY ${order} LIMIT ${limit}`);
  const rows = (result as any).rows ?? result;
  const wallets = rows.map((row: any) => row.creator_wallet);
  const tokenResult = wallets.length ? await db.execute(sql`
    WITH canonical AS (
      SELECT DISTINCT ON (mint) mint, creator_wallet, name, symbol, launched_at
      FROM pumpapi_creator_launches
      ORDER BY mint, launched_at ASC, event_key ASC
    )
    SELECT c.creator_wallet, c.mint, c.name, c.symbol, c.launched_at,
      ms.peak_market_cap_usd, ms.peak_observed_at,
      case when ms.outcome_observed_at is null then null else ms.graduated_observed end AS graduated,
      row_number() over (partition by c.creator_wallet order by c.launched_at desc, c.mint) AS latest_rank,
      row_number() over (partition by c.creator_wallet order by ms.peak_market_cap_usd desc nulls last, c.launched_at desc, c.mint) AS best_rank
    FROM canonical c
    LEFT JOIN pumpapi_market_snapshots ms ON ms.mint = c.mint
    WHERE c.creator_wallet IN (${sql.join(wallets.map((wallet: string) => sql`${wallet}`), sql`, `)})
    `) : { rows: [] };
  const tokens = (tokenResult as any).rows ?? tokenResult;
  const latestByCreator = new Map(tokens.filter((r: any) => Number(r.latest_rank) === 1).map((r: any) => [r.creator_wallet, {
    mint: r.mint,
    name: r.name,
    symbol: r.symbol,
    hasDexPair: r.graduated == null ? undefined : Boolean(r.graduated),
  }]));
  const bestByCreator = new Map(tokens.filter((r: any) => Number(r.best_rank) === 1 && r.peak_market_cap_usd != null).map((r: any) => [r.creator_wallet, {
    mint: r.mint, name: r.name, symbol: r.symbol,
    peakMarketCapUsd: Number(r.peak_market_cap_usd),
    peakObservedAt: r.peak_observed_at ? new Date(r.peak_observed_at).toISOString() : null,
    hasDexPair: r.graduated == null ? undefined : Boolean(r.graduated),
  }]));
  return rows.map((r: any) => ({
    creatorWallet: r.creator_wallet, observedEventCount: Number(r.observed_events),
    launches: Number(r.launches), activity: Number(r.activity),
    lastLaunchAt: new Date(r.last_launch_at).toISOString(), latestToken: latestByCreator.get(r.creator_wallet) ?? null,
    bestObservedToken: bestByCreator.get(r.creator_wallet) ?? null,
    graduatedLaunchCount: Number(r.graduated_launch_count),
    outcomeCoveredTokens: Number(r.outcome_covered_tokens),
    graduatedLaunchRate: Number(r.outcome_covered_tokens) > 0
      ? Number(r.graduated_launch_count) / Number(r.outcome_covered_tokens) : null,
    maxLaunchMarketCapQuote: r.max_launch_market_cap_quote == null ? null : Number(r.max_launch_market_cap_quote),
    maxLaunchMarketCapCurrency: r.max_launch_market_cap_quote == null ? null : "SOL",
    volume24hUsd: r.volume_24h_usd == null ? null : Number(r.volume_24h_usd),
    currentMarketCapUsd: r.current_market_cap_usd == null ? null : Number(r.current_market_cap_usd),
    currentMarketCapCoveredTokens: Number(r.current_market_cap_covered_tokens),
    volume24hCoveredTokens: Number(r.volume_24h_covered_tokens), observedTokenCount: Number(r.observed_token_count),
    volume24hObservedAt: r.volume_24h_observed_at ? new Date(r.volume_24h_observed_at).toISOString() : null,
    observedVolume12hQuote: r.observed_volume_12h_quote == null ? null : Number(r.observed_volume_12h_quote),
    observedVolumeTotalQuote: r.observed_volume_total_quote == null ? null : Number(r.observed_volume_total_quote),
    observedVolumeQuoteCurrency: "SOL",
    observedTradeCount: Number(r.observed_trade_count),
    observedGrossTradeCount: Number(r.observed_trade_count),
    unsupportedObservedTradeCount: Number(r.unsupported_observed_trade_count),
    partial: Number(r.outcome_covered_tokens) < Number(r.observed_token_count) ||
      Number(r.volume_24h_covered_tokens) < Number(r.observed_token_count) ||
      Number(r.current_market_cap_covered_tokens) < Number(r.observed_token_count),
  }));
}

export async function listPumpApiCreatorHistory(creatorWallet: string, limit: number) {
  return db.select().from(pumpApiCreatorLaunches).where(eq(pumpApiCreatorLaunches.creatorWallet, creatorWallet))
    .orderBy(desc(pumpApiCreatorLaunches.launchedAt)).limit(limit);
}

export async function listRecentPumpApiObservedTrades(limit = 100, since = new Date(Date.now() - 15 * 60 * 1000)) {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const rows = await db.execute(sql`
    SELECT t.id, t.event_key, t.signature, t.mint, t.action, t.pool, t.quote_mint,
      t.quote_amount, t.token_amount, t.breakdown_count, t.traded_at,
      c.name, c.symbol
    FROM pumpapi_observed_trades t
    LEFT JOIN LATERAL (
      SELECT name, symbol
      FROM pumpapi_creator_launches
      WHERE mint = t.mint
      ORDER BY launched_at ASC, event_key ASC
      LIMIT 1
    ) c ON true
    WHERE t.traded_at >= ${since}
      AND t.quote_mint = 'So11111111111111111111111111111111111111112'
    ORDER BY t.traded_at DESC, t.id DESC
    LIMIT ${safeLimit}
  `);
  return ((rows as any).rows ?? rows).map((row: any) => ({
    id: row.id,
    eventKey: row.event_key,
    signature: row.signature,
    mint: row.mint,
    action: row.action === "sell" ? "sell" : "buy",
    pool: row.pool,
    quoteMint: row.quote_mint,
    quoteAmount: Number(row.quote_amount),
    tokenAmount: Number(row.token_amount),
    breakdownCount: Number(row.breakdown_count ?? 0),
    tradedAt: new Date(row.traded_at).toISOString(),
    name: row.name ?? null,
    symbol: row.symbol ?? null,
  }));
}

export async function listPumpApiCreatorTokenContributions(creatorWallet: string) {
  const rows = await db.execute(sql`
    WITH canonical AS (
      SELECT DISTINCT ON (mint) mint, creator_wallet, name, symbol, market_cap_quote, quote_mint
      FROM pumpapi_creator_launches ORDER BY mint, launched_at, event_key
    ), hourly AS (
      SELECT mint, sum(sol_gross_quote_amount) AS volume_12h
      FROM pumpapi_mint_hourly_volumes
      WHERE hour >= date_trunc('hour', now()) - interval '11 hours'
      GROUP BY mint
    )
    SELECT c.mint, max(c.name) AS name, max(c.symbol) AS symbol,
      coalesce(t.sol_gross_trade_count, 0)::int AS observed_trade_count,
      coalesce(t.unsupported_trade_count, 0)::int AS unsupported_observed_trade_count,
      h.volume_12h AS observed_volume_12h_quote,
      t.sol_gross_quote_amount AS observed_volume_total_quote,
      max(c.market_cap_quote) FILTER (WHERE c.quote_mint = 'So11111111111111111111111111111111111111112') AS launch_market_cap_quote,
      max(ms.volume_24h_usd) FILTER (WHERE ms.observed_at >= now() - interval '10 minutes') AS volume_24h_usd,
      max(ms.current_market_cap_usd) FILTER (WHERE ms.observed_at >= now() - interval '10 minutes') AS current_market_cap_usd,
      bool_or(coalesce(ms.pair_count, 0) > 0) AS has_dex_pair,
      bool_or(ms.graduated_observed IS TRUE) AS graduated_observed,
      max(ms.peak_market_cap_usd) AS peak_market_cap_usd,
      max(ms.peak_observed_at) AS peak_observed_at,
      bool_or(ms.outcome_observed_at IS NOT NULL) AS outcome_observed,
      max(ms.observed_at) FILTER (WHERE ms.observed_at >= now() - interval '10 minutes') AS volume_24h_observed_at
    FROM canonical c LEFT JOIN pumpapi_mint_trade_totals t ON t.mint=c.mint
    LEFT JOIN hourly h ON h.mint=c.mint
    LEFT JOIN pumpapi_market_snapshots ms ON ms.mint=c.mint
    WHERE c.creator_wallet=${creatorWallet}
    GROUP BY c.mint, c.market_cap_quote, c.quote_mint, t.sol_gross_trade_count,
      t.unsupported_trade_count, t.sol_gross_quote_amount, h.volume_12h`);
  return ((rows as any).rows ?? rows).map((r: any) => ({ mint: r.mint, name: r.name, symbol: r.symbol,
    observedTradeCount: Number(r.observed_trade_count),
    observedGrossTradeCount: Number(r.observed_trade_count),
    observedVolume12hQuote: r.observed_volume_12h_quote == null ? null : Number(r.observed_volume_12h_quote),
    observedVolumeTotalQuote: r.observed_volume_total_quote == null ? null : Number(r.observed_volume_total_quote),
    observedVolumeQuoteCurrency: "SOL", unsupportedObservedTradeCount: Number(r.unsupported_observed_trade_count),
    launchMarketCapQuote: r.launch_market_cap_quote == null ? null : Number(r.launch_market_cap_quote), launchMarketCapCurrency: r.launch_market_cap_quote == null ? null : "SOL",
    volume24hUsd: r.volume_24h_usd == null ? null : Number(r.volume_24h_usd),
    currentMarketCapUsd: r.current_market_cap_usd == null ? null : Number(r.current_market_cap_usd),
    hasDexPair: r.outcome_observed ? Boolean(r.has_dex_pair) : undefined,
    graduated: r.outcome_observed ? Boolean(r.graduated_observed) : null,
    peakMarketCapUsd: r.peak_market_cap_usd == null ? null : Number(r.peak_market_cap_usd),
    peakObservedAt: r.peak_observed_at ? new Date(r.peak_observed_at).toISOString() : null,
    volume24hObservedAt: r.volume_24h_observed_at ? new Date(r.volume_24h_observed_at).toISOString() : null }));
}

export async function getPumpApiCreatorSummary(creatorWallet: string) {
  const activitySince = new Date(Date.now() - 72 * 60 * 60 * 1000);
  const [row] = await db.select({ launchCount: sql<number>`count(*)::int`, activityCount: sql<number>`count(*) filter (where ${pumpApiCreatorLaunches.launchedAt} >= ${activitySince})::int` })
    .from(pumpApiCreatorLaunches).where(eq(pumpApiCreatorLaunches.creatorWallet, creatorWallet));
  return { launchCount: Number(row?.launchCount ?? 0), activityCount: Number(row?.activityCount ?? 0) };
}