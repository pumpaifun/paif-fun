import { rpcFetchWithFallback } from "../rpc-fallback";
import type { Express } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import { storage } from "../storage";
import { scanToken, searchWallet, detectWalletClusters } from "../solana";
import { getClawPumpCreatorRewards } from "../clawpump-rewards";
import { scanEvmToken, getEvmWalletInfo, getFourMemeLaunches, detectEvmWalletClusters } from "../evm";
import { getSwapQuote, getSwapTransaction, getSplitQuotes } from "../jupiter";
import { getPumpQuote, buildBuyTransaction, buildSellTransaction } from "../pump";
import { scanTokenArb, scanNetworkArb } from "../arbitrage";
import { getHolderSnapshot } from "../holders";
import { registerAutoStrategyRoutes } from "../auto-strategy-routes";
import { registerArbExecutorRoutes } from "../arb-executor-routes";
import { registerSwingRoutes } from "../swing-routes";
import { registerTelegramRoutes } from "../telegram-routes";
import { registerTokenizedStockRoutes } from "../tokenized-stocks";
import { moderateCommunityPost, sanitizeUserText, rateLimit, globalRateLimit, clientIp, requireModeratorUser } from "../security";
import {
  authorizeCommunityAppealSignature,
  communityAppealReadSignatureMessage,
  verifyCommunityAppealSignature,
} from "../community-appeal-security";
import { isAuthenticated } from "../replit_integrations/auth/replitAuth";
import { BUYBACK_ALLOCATION_BPS, BUYBACK_POOL_NAME, BUYBACK_POOL_BLURB } from "@shared/credit-packs";
import {
  getPumpApiCreatorSummary,
  listPumpApiCreatorTokenContributions,
  listPumpApiCreatorHistory,
  listPumpApiCreatorLeaderboard,
  listRecentPumpApiObservedTrades,
  type CreatorLeaderboardSort,
} from "../pumpapi-leaderboard-storage";
import { getPumpApiLeaderboardStatus, getRecentPumpApiLaunches, isPumpApiPersistenceDegraded } from "../pumpapi-leaderboard";
import { registerPaifAlphaRoutes } from "../paif-alpha";

const solanaAddressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const evmAddressRegex = /^0x[a-fA-F0-9]{40}$/;

const assetMetadataSchema = z.object({
  ids: z.array(z.string().regex(solanaAddressRegex, "Invalid Solana address")).min(1).max(200),
});
let assetMetadataInFlight = 0;

const swapQuoteSchema = z.object({
  inputMint: z.string().regex(solanaAddressRegex, "Invalid Solana address"),
  outputMint: z.string().regex(solanaAddressRegex, "Invalid Solana address"),
  amount: z.number().positive(),
  slippageBps: z.number().int().min(0).max(10000).optional(),
});

const swapTransactionSchema = z.object({
  quoteResponse: z.record(z.unknown()),
  userPublicKey: z.string().regex(solanaAddressRegex, "Invalid Solana address"),
});

const splitQuotesSchema = z.object({
  inputMint: z.string().regex(solanaAddressRegex, "Invalid Solana address"),
  outputMint: z.string().regex(solanaAddressRegex, "Invalid Solana address"),
  totalAmount: z.number().positive(),
  splitCount: z.number().int().min(1).max(24),
  slippageBps: z.number().int().min(0).max(10000).optional(),
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Bounds concurrent wallet-cluster detections (each fans out into many RPC
  // calls); excess requests get a 429 instead of saturating the RPC provider.
  const MAX_CLUSTER_JOBS = 3;
  let clusterJobsInFlight = 0;

  registerAutoStrategyRoutes(app);
  registerArbExecutorRoutes(app);
  registerSwingRoutes(app);
  registerTelegramRoutes(app);
  registerTokenizedStockRoutes(app);
  registerPaifAlphaRoutes(app);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // These public polling endpoints can otherwise be used to force repeated
  // aggregate scans. `clientIp` is only used as an in-memory limiter key and
  // is never emitted to logs or responses.
  const allowCreatorRead = (req: any, res: any) => {
    if (rateLimit(`pumpapi-creators:${clientIp(req)}`, 120, 60_000)) return true;
    res.status(429).json({ error: "Too many creator leaderboard requests" });
    return false;
  };

  // Persistent PumpApi creator launches. These endpoints are intentionally
  // cheap database reads so clients can poll every few seconds.
  app.get("/api/pumpapi/creators", async (req, res) => {
    if (!allowCreatorRead(req, res)) return;
    const sort = String(req.query.sort || "launches") as CreatorLeaderboardSort;
    const direction = String(req.query.direction || "desc");
    if (!["newest", "launches", "observedEvents", "activity", "graduationRate", "marketCap", "currentMarketCap", "volume24h", "volume12h", "volumeTotal"].includes(sort) || !["asc", "desc"].includes(direction)) {
      return res.status(400).json({ error: "Invalid creator ranking sort or direction" });
    }
    const limit = Math.max(1, Math.min(100, Number.parseInt(String(req.query.limit || "50"), 10) || 50));
    try {
      res.set("Cache-Control", "public, max-age=3, stale-while-revalidate=5");
      res.json({ creators: await listPumpApiCreatorLeaderboard(sort, limit, direction as "asc" | "desc"), status: getPumpApiLeaderboardStatus() });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load creator leaderboard" });
    }
  });

  app.get("/api/pumpapi/creators/:wallet/launches", async (req, res) => {
    if (!allowCreatorRead(req, res)) return;
    const wallet = String(req.params.wallet || "");
    if (!solanaAddressRegex.test(wallet)) return res.status(400).json({ error: "Invalid creator wallet" });
    const limit = Math.max(1, Math.min(200, Number.parseInt(String(req.query.limit || "50"), 10) || 50));
    try {
      res.set("Cache-Control", "public, max-age=3, stale-while-revalidate=5");
      const [launches, contributions] = await Promise.all([
        listPumpApiCreatorHistory(wallet, limit), listPumpApiCreatorTokenContributions(wallet),
      ]);
      const byMint = new Map(contributions.map((row: any) => [row.mint, row]));
      res.json({ launches: launches.map((launch) => ({ ...launch, ...(byMint.get(launch.mint) ?? {}) })) });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load creator history" });
    }
  });

  app.get("/api/pumpapi/status", (req, res) => {
    if (!allowCreatorRead(req, res)) return;
    res.set("Cache-Control", "no-store");
    res.json(getPumpApiLeaderboardStatus());
  });

  // Stable client-facing aliases used by the focused Creators page.
  const creatorClientStatus = () => {
    const status = getPumpApiLeaderboardStatus();
    const writesDegraded = status.persistenceDegraded || isPumpApiPersistenceDegraded(
      status.lastPersistedLaunchAt ? new Date(status.lastPersistedLaunchAt) : null,
      status.lastPersistError ? new Date(status.lastPersistError) : null,
    );
    const state = !status.running ? "disabled"
      : writesDegraded ? "error"
      : status.connected ? (status.fresh ? "live" : "stale")
      : status.reconnectAttempt > 0 ? "reconnecting"
      : status.persistErrors > 0 ? "error"
      : "connecting";
    return {
      state,
      lastEventAt: status.lastEventAt,
      lastSuccessAt: status.lastPersistedLaunchAt,
      lastPersistedGrossTradeAt: status.lastPersistedTradeAt,
      queueDepth: status.queueDepth,
      droppedWrites: status.droppedWrites,
      lastDroppedAt: status.lastDroppedAt,
      admissionLookupErrors: status.admissionLookupErrors,
      admissionDroppedTrades: status.admissionDroppedTrades,
      admissionQueueDepth: status.admissionQueueDepth,
      message: status.message ?? (writesDegraded ? "Creator metrics persistence is failing; rankings may be delayed." : null),
      // A capped replay can still ingest many useful launches, but we cannot
      // infer what percentage of an hourly archive those rows represent.
      // Only report numeric coverage when every requested hour completed.
      replayCoverage: status.replay.state === "complete" ? 1 : null,
      partial: status.replay.state === "partial" || status.replay.state === "error" ||
        status.droppedWrites > 0 || status.admissionDroppedTrades > 0 || status.admissionLookupErrors > 0,
    };
  };

  app.get("/api/creators", async (req, res) => {
    if (!allowCreatorRead(req, res)) return;
    const sort = String(req.query.sort || "launches") as CreatorLeaderboardSort;
    const direction = String(req.query.direction || "desc");
    if (!["newest", "launches", "observedEvents", "activity", "graduationRate", "marketCap", "currentMarketCap", "volume24h", "volume12h", "volumeTotal"].includes(sort) || !["asc", "desc"].includes(direction)) {
      return res.status(400).json({ error: "Invalid creator ranking sort or direction" });
    }
    const requestedWallets = String(req.query.wallets || "").split(",").filter(Boolean);
    if (requestedWallets.length > 100 || requestedWallets.some((wallet) => !solanaAddressRegex.test(wallet))) {
      return res.status(400).json({ error: "wallets must contain at most 100 valid Solana creator addresses" });
    }
    try {
      const rows = await listPumpApiCreatorLeaderboard(
        sort,
        100,
        direction as "asc" | "desc",
        requestedWallets.length ? requestedWallets : undefined,
      );
      res.set("Cache-Control", "public, max-age=3, stale-while-revalidate=5");
      res.json({
        creators: rows.map((row: any) => ({
          wallet: row.creatorWallet,
          launchCount: row.launches,
          observedEventCount: row.observedEventCount,
          activityCount: row.activity,
          latestLaunchAt: row.lastLaunchAt,
          latestToken: row.latestToken,
          bestObservedToken: row.bestObservedToken,
          graduatedLaunchCount: row.graduatedLaunchCount,
          graduatedLaunchRate: row.graduatedLaunchRate,
          outcomeCoveredTokens: row.outcomeCoveredTokens,
          maxLaunchMarketCapQuote: row.maxLaunchMarketCapQuote,
          maxLaunchMarketCapCurrency: row.maxLaunchMarketCapCurrency,
          currentMarketCapUsd: row.currentMarketCapUsd,
          currentMarketCapCoveredTokens: row.currentMarketCapCoveredTokens,
          volume24hUsd: row.volume24hUsd,
          volume24hCoveredTokens: row.volume24hCoveredTokens,
          observedTokenCount: row.observedTokenCount,
          volume24hObservedAt: row.volume24hObservedAt,
          observedVolume12hQuote: row.observedVolume12hQuote,
          observedVolumeTotalQuote: row.observedVolumeTotalQuote,
          observedVolumeQuoteCurrency: row.observedVolumeQuoteCurrency,
          observedTradeCount: row.observedTradeCount,
          observedGrossTradeCount: row.observedGrossTradeCount,
          unsupportedObservedTradeCount: row.unsupportedObservedTradeCount,
          partial: row.partial,
        })),
        status: creatorClientStatus(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load creator leaderboard" });
    }
  });

  app.get("/api/creators/:wallet", async (req, res) => {
    if (!allowCreatorRead(req, res)) return;
    const wallet = String(req.params.wallet || "");
    if (!solanaAddressRegex.test(wallet)) return res.status(400).json({ error: "Invalid creator wallet" });
    try {
      const [launches, summary, contributions] = await Promise.all([
        listPumpApiCreatorHistory(wallet, 200),
        getPumpApiCreatorSummary(wallet),
        listPumpApiCreatorTokenContributions(wallet),
      ]);
      const contributionByMint = new Map(contributions.map((row: any) => [row.mint, row]));
      res.set("Cache-Control", "public, max-age=3, stale-while-revalidate=5");
      res.json({
        creator: {
          wallet,
          launchCount: summary.launchCount,
          activityCount: summary.activityCount,
          latestLaunchAt: launches[0]?.launchedAt ?? null,
          latestToken: launches[0] ? { mint: launches[0].mint, name: launches[0].name, symbol: launches[0].symbol } : null,
        },
        launches: launches.map((row) => ({
          eventKey: row.eventKey,
          mint: row.mint,
          name: row.name,
          symbol: row.symbol,
          launchWallet: row.creatorWallet,
          creatorFeeAddress: row.creatorFeeAddress,
          signature: row.signature,
          pool: row.pool,
          timestamp: row.launchedAt,
          source: row.source,
          ...(contributionByMint.get(row.mint) ?? {}),
        })),
        status: creatorClientStatus(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load creator history" });
    }
  });

  // Server-side SOL balance fallback: wallet in-app browsers sometimes can't
  // reach the Solana RPC directly (network blips / rate limits), which used to
  // silently blank the header balance. Public read of a public fact, but
  // rate-limited per IP to keep it from being farmed.
  const balanceHits = new Map<string, { n: number; t: number }>();
  app.get("/api/sol-balance/:address", async (req, res) => {
    const address = String(req.params.address || "").trim();
    if (!solanaAddressRegex.test(address)) {
      return res.status(400).json({ error: "Invalid Solana address" });
    }
    const ip = req.ip || "?";
    const now = Date.now();
    const hit = balanceHits.get(ip);
    if (hit && now - hit.t < 60_000) {
      if (hit.n >= 30) return res.status(429).json({ error: "Too many requests" });
      hit.n++;
    } else {
      if (balanceHits.size > 5000) balanceHits.clear();
      balanceHits.set(ip, { n: 1, t: now });
    }
    try {
      const key = process.env.HELIUS_API_KEY;
      const rpc = key ? `https://mainnet.helius-rpc.com/?api-key=${key}` : "https://api.mainnet-beta.solana.com";
      const r = await rpcFetchWithFallback(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address, { commitment: "confirmed" }] }),
      });
      const j: any = await r.json();
      const lamports = j?.result?.value;
      if (typeof lamports !== "number") throw new Error(j?.error?.message || "RPC error");
      res.json({ lamports });
    } catch (e: any) {
      res.status(502).json({ error: e?.message || "Balance lookup failed" });
    }
  });

  app.post("/api/solana/asset-metadata", async (req, res) => {
    if (!rateLimit(`asset-metadata:${clientIp(req)}`, 20, 60_000)) {
      return res.status(429).json({ error: "Too many requests" });
    }
    const parsed = assetMetadataSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid asset IDs" });

    const key = process.env.HELIUS_API_KEY;
    if (!key) return res.status(503).json({ error: "Asset metadata is unavailable" });
    if (!globalRateLimit("asset-metadata", 200, 60_000) || assetMetadataInFlight >= 8) {
      return res.status(429).json({ error: "Asset metadata is busy" });
    }

    assetMetadataInFlight += 1;
    try {
      const upstream = await fetch(`https://mainnet.helius-rpc.com/?api-key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "asset-metadata",
          method: "getAssetBatch",
          params: { ids: parsed.data.ids },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!upstream.ok) throw new Error(`Helius returned ${upstream.status}`);
      const json: any = await upstream.json();
      if (json.error) throw new Error(json.error.message || "Helius RPC error");

      const assets: Record<string, { symbol?: string; name?: string }> = {};
      for (const asset of json.result ?? []) {
        if (!asset?.id || !parsed.data.ids.includes(asset.id)) continue;
        const symbol = asset.token_info?.symbol || asset.content?.metadata?.symbol;
        const name = asset.content?.metadata?.name;
        assets[asset.id] = {
          ...(typeof symbol === "string" ? { symbol } : {}),
          ...(typeof name === "string" ? { name } : {}),
        };
      }
      res.json({ assets });
    } catch (error: any) {
      res.status(502).json({ error: error?.message || "Asset metadata lookup failed" });
    } finally {
      assetMetadataInFlight -= 1;
    }
  });

  // Lightweight Solana watchlist guidance — price / 24h change / liquidity for
  // one token, sourced from DexScreener (public, no key).
  // Deliberately light: the full risk report lives on the scanner. Facts only.
  app.get("/api/watchlist/token", async (req, res) => {
    const chainId = String(req.query.chainId || "").toLowerCase();
    const address = String(req.query.address || "").trim();
    if (chainId && chainId !== "solana") {
      return res.status(400).json({ error: "Watchlist supports Solana tokens only." });
    }
    if (!address) return res.status(400).json({ error: "A token address is required." });
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      return res.status(400).json({ error: "That doesn't look like a valid Solana token address." });
    }
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 7000);
      const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`, { signal: controller.signal });
      clearTimeout(t);
      const data = await r.json();
      const pairs = (data?.pairs || []).filter((p: any) => p.chainId === "solana");
      if (pairs.length === 0) {
        return res.json({ found: false });
      }
      // Deepest pool is the most representative price.
      pairs.sort((a: any, b: any) => (Number(b?.liquidity?.usd) || 0) - (Number(a?.liquidity?.usd) || 0));
      const best = pairs[0];
      res.json({
        found: true,
        symbol: best?.baseToken?.symbol ?? null,
        name: best?.baseToken?.name ?? null,
        priceUsd: best?.priceUsd ? Number(best.priceUsd) : null,
        change24h: Number.isFinite(Number(best?.priceChange?.h24)) ? Number(best.priceChange.h24) : null,
        liquidityUsd: Number.isFinite(Number(best?.liquidity?.usd)) ? Number(best.liquidity.usd) : null,
        volume24h: Number.isFinite(Number(best?.volume?.h24)) ? Number(best.volume.h24) : null,
        dexId: best?.dexId ?? null,
        url: best?.url ?? null,
      });
    } catch {
      res.status(503).json({ error: "Couldn't reach the price feed. Try again in a moment." });
    }
  });

  app.post("/api/scan", async (req, res) => {
    const { query } = req.body;
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "A token address or Pump.fun link is required" });
    }

    try {
      const result = await scanToken(query.trim());
      const clawPumpLookup = await getClawPumpCreatorRewards(result.tokenAddress, result.creatorAddress);
      res.json({
        ...result,
        clawPumpCreatorRewards: clawPumpLookup.rewards,
        clawPumpMigratedCreatorRewards: clawPumpLookup.migratedRewards,
        clawPumpCrossReference: {
          status: clawPumpLookup.status,
          checkedAt: clawPumpLookup.checkedAt,
        },
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to scan token" });
    }
  });

  app.get("/api/clusters/:mint", async (req, res) => {
    const mint = (req.params.mint || "").trim();
    // Cheaply reject junk before spending any RPC: Solana mints are base58,
    // 32-44 chars. This stops attackers fanning out over garbage strings.
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
      return res.status(400).json({ error: "A valid token mint is required" });
    }
    // Cluster detection fans out into many RPC calls per cache-miss, so it's an
    // expensive unauth endpoint. Throttle per-IP and globally, and cap how many
    // detections run at once (a fresh mint each time would bypass the per-mint
    // cache otherwise).
    if (
      !rateLimit(`clusters-ip:${clientIp(req)}`, 10, 60_000) ||
      !globalRateLimit("clusters", 60, 60_000)
    ) {
      return res.status(429).json({ error: "Too many cluster scans — please slow down." });
    }
    if (clusterJobsInFlight >= MAX_CLUSTER_JOBS) {
      return res.status(429).json({ error: "Cluster analysis is busy right now — try again shortly." });
    }
    clusterJobsInFlight++;
    try {
      const result = await detectWalletClusters(mint);
      res.set("Cache-Control", "no-store");
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to analyze wallet clusters" });
    } finally {
      clusterJobsInFlight--;
    }
  });

  app.get("/api/evm/clusters/:address", async (req, res) => {
    const address = (req.params.address || "").trim();
    const chainId = req.query.chainId;
    // EVM addresses are 20-byte hex (0x + 40 hex chars). Reject junk before any RPC.
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({ error: "A valid token address is required" });
    }
    if (!isEvmChainId(chainId)) {
      return res.status(400).json({ error: "A valid EVM chain is required" });
    }
    // Same cost-amplification guards as the Solana cluster route: this is public
    // and each cache-miss fans out into many RPC calls.
    if (
      !rateLimit(`clusters-ip:${clientIp(req)}`, 10, 60_000) ||
      !globalRateLimit("clusters", 60, 60_000)
    ) {
      return res.status(429).json({ error: "Too many cluster scans — please slow down." });
    }
    if (clusterJobsInFlight >= MAX_CLUSTER_JOBS) {
      return res.status(429).json({ error: "Cluster analysis is busy right now — try again shortly." });
    }
    clusterJobsInFlight++;
    try {
      const result = await detectEvmWalletClusters(address, chainId);
      res.set("Cache-Control", "no-store");
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to analyze wallet clusters" });
    } finally {
      clusterJobsInFlight--;
    }
  });

  app.get("/api/wallet/:address", async (req, res) => {
    const { address } = req.params;
    if (!address || typeof address !== "string") {
      return res.status(400).json({ error: "A wallet address is required" });
    }

    try {
      const result = await searchWallet(address.trim());
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to look up wallet" });
    }
  });

  // EVM addresses are identical across BNB/Base/SEI, so the caller MUST tell us
  // which chain. Never silently default — a wrong default scans the wrong chain.
  const isEvmChainId = (v: unknown): v is "bnb" | "base" | "sei" =>
    v === "bnb" || v === "base" || v === "sei";

  app.post("/api/evm/scan", async (req, res) => {
    const { query, chainId } = req.body;
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "An EVM token address is required" });
    }
    if (!isEvmChainId(chainId)) {
      return res.status(400).json({ error: "Choose an EVM network (BNB Chain, Base, or Sei) to scan this token." });
    }
    try {
      const result = await scanEvmToken(query.trim(), chainId);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to scan token" });
    }
  });

  app.get("/api/evm/wallet/:address", async (req, res) => {
    const { address } = req.params;
    const chainId = req.query.chainId;
    if (!address || !evmAddressRegex.test(address.trim())) {
      return res.status(400).json({ error: "A valid EVM wallet address (0x…) is required" });
    }
    if (!isEvmChainId(chainId)) {
      return res.status(400).json({ error: "A valid EVM network (BNB Chain, Base, or Sei) is required" });
    }
    try {
      const result = await getEvmWalletInfo(address.trim(), chainId);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to look up wallet" });
    }
  });

  app.get("/api/evm/launches", async (req, res) => {
    const chainId = typeof req.query.chainId === "string" ? req.query.chainId : undefined;
    try {
      const result = await getFourMemeLaunches(chainId);
      res.json(result);
    } catch (err: any) {
      res.status(200).json({ launches: [], available: false });
    }
  });

  app.post("/api/swap/quote", async (req, res) => {
    const parsed = swapQuoteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
    }

    try {
      const { inputMint, outputMint, amount, slippageBps } = parsed.data;
      const quote = await getSwapQuote(inputMint, outputMint, amount, slippageBps);
      res.json(quote);
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to get swap quote" });
    }
  });

  app.post("/api/swap/transaction", async (req, res) => {
    const parsed = swapTransactionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
    }

    try {
      const { quoteResponse, userPublicKey } = parsed.data;
      const result = await getSwapTransaction(quoteResponse, userPublicKey);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to get swap transaction" });
    }
  });

  app.post("/api/swap/split-quotes", async (req, res) => {
    const parsed = splitQuotesSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
    }

    try {
      const { inputMint, outputMint, totalAmount, splitCount, slippageBps } = parsed.data;
      const quotes = await getSplitQuotes(inputMint, outputMint, totalAmount, splitCount, slippageBps);
      res.json(quotes);
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to get split quotes" });
    }
  });

  // --- pump.fun bonding curve routes ---

  app.get("/api/pump/quote", async (req, res) => {
    const { mint, action, amount, decimals } = req.query as Record<string, string>;
    if (!mint || !action || !amount) {
      return res.status(400).json({ error: "mint, action and amount are required" });
    }
    if (action !== "buy" && action !== "sell") {
      return res.status(400).json({ error: "action must be buy or sell" });
    }
    try {
      const result = await getPumpQuote(mint, action as "buy" | "sell", Number(amount), Number(decimals ?? 6));
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to get pump quote" });
    }
  });

  app.post("/api/pump/buy-tx", async (req, res) => {
    const { mint, userPublicKey, solLamports, slippageBps } = req.body;
    if (!mint || !userPublicKey || !solLamports) {
      return res.status(400).json({ error: "mint, userPublicKey and solLamports are required" });
    }
    try {
      const result = await buildBuyTransaction(mint, userPublicKey, Number(solLamports), Number(slippageBps ?? 100));
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to build buy transaction" });
    }
  });

  app.post("/api/pump/sell-tx", async (req, res) => {
    const { mint, userPublicKey, tokenAmount, decimals, slippageBps } = req.body;
    if (!mint || !userPublicKey || !tokenAmount) {
      return res.status(400).json({ error: "mint, userPublicKey and tokenAmount are required" });
    }
    try {
      const result = await buildSellTransaction(mint, userPublicKey, Number(tokenAmount), Number(decimals ?? 6), Number(slippageBps ?? 100));
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to build sell transaction" });
    }
  });

  // ─── Bump variants ─────────────────────────────────────────────────────────
  // Same shape as /api/pump/{buy,sell}-tx but the server atomically consumes
  // ONE bump credit BEFORE building the transaction. This is the ONLY path the
  // bump bot uses — the credit gate cannot be bypassed by a tampered client
  // (no tx without a burned credit). On 402 the bot stops and prompts the
  // user to top up at /upgrade.
  //
  // ownerWallet is the *authority* whose credits are consumed. The auth block
  // is a long-lived consume-auth grant (rolling ~1h window) signed by either
  // the owner itself or a session/sub wallet that has a delegation row under
  // the owner — without that binding anyone could spam this endpoint with a
  // victim's wallet and drain their credits. One signed token covers many
  // bumps so wallet-mode users don't get a Phantom popup per fire. The 24h
  // sanity cap on expiryMs limits the blast radius of a stolen token.
  const CONSUME_GRANT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const bumpConsumeAuthSchema = z.object({
    signerWallet: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
    expiryMs:     z.number().int().positive(),
    signature:    z.string().min(64).max(128),
  });

  function bumpConsumeMessage(d: {
    ownerWallet: string; signerWallet: string; expiryMs: number;
  }): Uint8Array {
    const msg = [
      "paif-bump-consume", "v1",
      d.ownerWallet, d.signerWallet, String(d.expiryMs),
    ].join("|");
    return new TextEncoder().encode(msg);
  }

  async function authorizeBumpConsume(args: {
    ownerWallet: string;
    userPublicKey: string;
    auth: { signerWallet: string; expiryMs: number; signature: string };
    res: any;
  }): Promise<boolean> {
    const { ownerWallet, userPublicKey, auth, res } = args;
    const ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    if (!ADDR_RE.test(ownerWallet)) {
      res.status(400).json({ error: "Invalid ownerWallet" });
      return false;
    }
    if (!ADDR_RE.test(userPublicKey)) {
      res.status(400).json({ error: "Invalid userPublicKey" });
      return false;
    }
    const now = Date.now();
    if (auth.expiryMs <= now) {
      res.status(401).json({ error: "Auth token expired" });
      return false;
    }
    if (auth.expiryMs - now > CONSUME_GRANT_MAX_AGE_MS) {
      res.status(401).json({ error: "Auth token validity exceeds 24h cap" });
      return false;
    }
    const msgBytes = bumpConsumeMessage({
      ownerWallet, signerWallet: auth.signerWallet, expiryMs: auth.expiryMs,
    });
    const sigOk = await verifyEd25519(auth.signerWallet, auth.signature, msgBytes);
    if (!sigOk) {
      res.status(401).json({ error: "Invalid auth signature" });
      return false;
    }
    // The signer of the grant must be authorized to spend owner's credits
    // (owner itself OR a delegated session/sub wallet).
    if (auth.signerWallet !== ownerWallet) {
      const delegation = await storage.getBumpDelegation(ownerWallet, auth.signerWallet);
      if (!delegation) {
        res.status(403).json({ error: "Signer wallet not authorized for this owner" });
        return false;
      }
    }
    // ALSO bind the trade tx signer (userPublicKey) to the owner. Without
    // this, an attacker who Sybil-farms trial credits could spend them to
    // fund a trade signed by an unrelated funded wallet. Trial credits can
    // only be spent on trades signed by the owner or wallets the owner has
    // explicitly delegated — which makes Sybil farming visible (delegation
    // rows) and forces an extra signed delegation step per attack chain.
    if (userPublicKey !== ownerWallet) {
      const tradeDelegation = await storage.getBumpDelegation(ownerWallet, userPublicKey);
      if (!tradeDelegation) {
        res.status(403).json({ error: "Trade signer (userPublicKey) not authorized for this owner" });
        return false;
      }
    }
    const out = await storage.decrementCredit(ownerWallet);
    if (!out.ok) {
      res.status(402).json({ error: "Out of bump credits", balance: out.balance });
      return false;
    }
    return true;
  }

  app.post("/api/pump/bump-buy-tx", async (req, res) => {
    const { mint, userPublicKey, ownerWallet, solLamports, slippageBps, auth } = req.body;
    if (!mint || !userPublicKey || !ownerWallet || !solLamports) {
      return res.status(400).json({ error: "mint, userPublicKey, ownerWallet and solLamports are required" });
    }
    const authParse = bumpConsumeAuthSchema.safeParse(auth);
    if (!authParse.success) {
      return res.status(400).json({ error: authParse.error.issues[0]?.message || "Missing auth" });
    }
    const ok = await authorizeBumpConsume({
      ownerWallet: String(ownerWallet),
      userPublicKey: String(userPublicKey),
      auth: authParse.data, res,
    });
    if (!ok) return;
    try {
      const result = await buildBuyTransaction(mint, userPublicKey, Number(solLamports), Number(slippageBps ?? 100));
      res.json(result);
    } catch (err: any) {
      // Credit already burned — intentional ("charge upfront, no refund on
      // tx failure" per product spec). User pays for the attempt.
      res.status(400).json({ error: err.message || "Failed to build buy transaction" });
    }
  });

  app.post("/api/pump/bump-sell-tx", async (req, res) => {
    const { mint, userPublicKey, ownerWallet, tokenAmount, decimals, slippageBps, auth } = req.body;
    if (!mint || !userPublicKey || !ownerWallet || !tokenAmount) {
      return res.status(400).json({ error: "mint, userPublicKey, ownerWallet and tokenAmount are required" });
    }
    const authParse = bumpConsumeAuthSchema.safeParse(auth);
    if (!authParse.success) {
      return res.status(400).json({ error: authParse.error.issues[0]?.message || "Missing auth" });
    }
    const ok = await authorizeBumpConsume({
      ownerWallet: String(ownerWallet),
      userPublicKey: String(userPublicKey),
      auth: authParse.data, res,
    });
    if (!ok) return;
    try {
      const result = await buildSellTransaction(mint, userPublicKey, Number(tokenAmount), Number(decimals ?? 6), Number(slippageBps ?? 100));
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to build sell transaction" });
    }
  });

  // --- Legacy vault routes ---
  // This unused API trusted a caller-controlled wallet header and exposed or
  // mutated private strategy state. The actively used strategy products have
  // their own signed owner-bound APIs, so fail closed instead of preserving an
  // unsafe parallel access-control system.
  const legacyVaultRetired = (_req: unknown, res: any) =>
    res.status(410).json({ error: "Legacy vault API retired" });
  app.get("/api/vaults/:walletAddress", legacyVaultRetired);
  app.post("/api/vaults", legacyVaultRetired);
  app.patch("/api/vaults/:id/strategies", legacyVaultRetired);
  app.patch("/api/vaults/:id/settings", legacyVaultRetired);
  app.post("/api/vaults/:id/positions", legacyVaultRetired);
  app.get("/api/vaults/:id/positions", legacyVaultRetired);
  app.patch("/api/vaults/positions/:positionId", legacyVaultRetired);

  // --- Comment routes ---

  const commentCreateSchema = z.object({
    walletAddress: z.string().refine(
      value => solanaAddressRegex.test(value) || /^replit:[A-Za-z0-9_-]+$/.test(value),
      "Invalid wallet address",
    ),
    displayName: z.string().min(1).max(30),
    message: z.string().min(1).max(500),
    category: z.enum(["question", "idea", "discussion"]).default("question"),
    taggedMint: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid contract address").optional(),
    parentCommentId: z.string().min(1).max(100).optional(),
    nonce: z.number().int().positive().optional(),
    signature: z.string().min(64).max(128).optional(),
  });

  const communityAppealSchema = z.object({
    walletAddress: z.string().refine(
      value => solanaAddressRegex.test(value) || /^replit:[A-Za-z0-9_-]+$/.test(value),
      "Invalid wallet address",
    ),
    displayName: z.string().min(1).max(30),
    message: z.string().min(1).max(500),
    category: z.enum(["question", "idea", "discussion"]),
    appealReason: z.string().min(1).max(1000),
    nonce: z.number().int().positive().optional(),
    signature: z.string().min(64).max(128).optional(),
  });

  const requireModerator = (req: any, res: any): boolean => {
    return requireModeratorUser(req.user, (status, body) => {
      res.status(status).json(body);
    });
  };

  app.get("/api/comments", async (_req, res) => {
    try {
      const list = await storage.getComments(50);
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to get comments" });
    }
  });

  app.post("/api/comments/:id/upvote", async (req, res) => {
    if (!rateLimit(`upvote-ip:${clientIp(req)}`, 30, 60_000)) {
      return res.status(429).json({ error: "Too many upvotes — please slow down." });
    }
    try {
      const updated = await storage.upvoteComment(req.params.id);
      if (!updated) return res.status(404).json({ error: "Comment not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to upvote" });
    }
  });

  app.post("/api/comments", async (req: any, res) => {
    const parsed = commentCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
    }

    const sessionUserId = (req.user as any)?.id;
    const isSessionAuth = sessionUserId && parsed.data.walletAddress === `replit:${sessionUserId}`;
    if (!isSessionAuth) {
      const { nonce, signature } = parsed.data;
      if (!solanaAddressRegex.test(parsed.data.walletAddress) || !nonce || !signature) {
        return res.status(401).json({ error: "Wallet signature required" });
      }
      if (Math.abs(Date.now() - nonce) > 5 * 60_000) {
        return res.status(401).json({ error: "Authorization expired" });
      }
      const message = [
        "paif-comment", "v1", parsed.data.walletAddress, parsed.data.displayName,
        parsed.data.message, parsed.data.category, parsed.data.taggedMint ?? "", String(nonce),
      ].join("|");
      const replyMessage = parsed.data.parentCommentId
        ? [
            "paif-comment", "v1", parsed.data.walletAddress, parsed.data.displayName,
            parsed.data.message, parsed.data.category, parsed.data.taggedMint ?? "",
            parsed.data.parentCommentId, String(nonce),
          ].join("|")
        : message;
      if (!await verifyEd25519(parsed.data.walletAddress, signature, new TextEncoder().encode(replyMessage))) {
        return res.status(401).json({ error: "Invalid wallet signature" });
      }
      if (
        !rateLimit(`comment:${parsed.data.walletAddress}`, 10, 60_000) ||
        !rateLimit(`comment-ip:${clientIp(req)}`, 20, 60_000)
      ) {
        return res.status(429).json({ error: "You're posting too fast — please wait a moment." });
      }
      if (!await storage.consumeWalletWriteSignature(signature, "comment", parsed.data.walletAddress)) {
        return res.status(401).json({ error: "Authorization already used" });
      }
    }

    // Session-authenticated comments still need the same write throttle.
    if (isSessionAuth && (
      !rateLimit(`comment:${parsed.data.walletAddress}`, 10, 60_000) ||
      !rateLimit(`comment-ip:${clientIp(req)}`, 20, 60_000)
    )) {
      return res.status(429).json({ error: "You're posting too fast — please wait a moment." });
    }

    const message = sanitizeUserText(parsed.data.message);
    if (!message) return res.status(400).json({ error: "Message cannot be empty" });
    const displayName = sanitizeUserText(parsed.data.displayName) || "anon";
    const moderation = moderateCommunityPost(displayName, message);
    if (!moderation.allowed) {
      return res.status(422).json({ error: moderation.reason });
    }

    try {
      if (parsed.data.parentCommentId) {
        const parent = await storage.getComment(parsed.data.parentCommentId);
        if (!parent) return res.status(404).json({ error: "Community post not found" });
        if (parent.parentCommentId) {
          return res.status(400).json({ error: "Replies must be posted to a community post." });
        }
      }

      const comment = await storage.createComment({
        parentCommentId: parsed.data.parentCommentId,
        walletAddress: parsed.data.walletAddress,
        displayName,
        message,
        category: parsed.data.category,
        taggedMint: parsed.data.taggedMint,
      });
      res.json(comment);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to create comment" });
    }
  });

  // An appeal is intentionally separate from comment creation. Submitting one
  // never publishes the rejected text; only an authenticated moderator can
  // later approve it.
  app.post("/api/community-appeals", async (req: any, res) => {
    const parsed = communityAppealSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid appeal" });
    }

    const sessionUserId = req.user?.id;
    const isSessionAuth = sessionUserId && parsed.data.walletAddress === `replit:${sessionUserId}`;
    const message = sanitizeUserText(parsed.data.message);
    const displayName = sanitizeUserText(parsed.data.displayName) || "anon";
    const appealReason = sanitizeUserText(parsed.data.appealReason);
    if (!message || !appealReason) {
      return res.status(400).json({ error: "Appeal details cannot be empty" });
    }

    if (!isSessionAuth) {
      const { nonce, signature } = parsed.data;
      if (!solanaAddressRegex.test(parsed.data.walletAddress) || !nonce || !signature) {
        return res.status(401).json({ error: "Wallet signature required" });
      }
      const authorization = await authorizeCommunityAppealSignature({
        fields: {
          walletAddress: parsed.data.walletAddress,
          displayName,
          message,
          category: parsed.data.category,
          appealReason,
        },
        nonce,
        signature,
        consumeSignature: (usedSignature, purpose, walletAddress) =>
          storage.consumeWalletWriteSignature(usedSignature, purpose, walletAddress),
      });
      if (!authorization.ok) return res.status(401).json({ error: authorization.error });
    }

    if (
      !rateLimit(`community-appeal:${parsed.data.walletAddress}`, 3, 60 * 60_000) ||
      !rateLimit(`community-appeal-ip:${clientIp(req)}`, 10, 60 * 60_000)
    ) {
      return res.status(429).json({ error: "You've sent too many appeals. Please try again later." });
    }

    try {
      const appeal = await storage.createCommunityAppeal({
        requesterWallet: parsed.data.walletAddress,
        displayName,
        blockedMessage: message,
        category: parsed.data.category,
        appealReason,
      });
      res.status(201).json({
        id: appeal.id,
        status: appeal.status,
        appeal: {
          id: appeal.id,
          category: appeal.category,
          status: appeal.status,
          moderatorNote: null,
          createdAt: appeal.createdAt,
          resolvedAt: null,
        },
        message: "Your request was sent for moderator review. The post remains unpublished.",
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to submit appeal" });
    }
  });

  app.get("/api/community-appeals", isAuthenticated, async (req: any, res) => {
    if (!requireModerator(req, res)) return;
    try {
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.json(await storage.getPendingCommunityAppeals(50));
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to load appeals" });
    }
  });

  app.post("/api/community-appeals/mine", async (req: any, res) => {
    const parsed = z.object({
      walletAddress: z.string().refine(
        value => solanaAddressRegex.test(value) || /^replit:[A-Za-z0-9_-]+$/.test(value),
        "Invalid member identity",
      ),
      nonce: z.number().int().positive().optional(),
      signature: z.string().min(64).max(128).optional(),
    }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid status request" });
    }

    const sessionUserId = req.user?.id;
    const isSessionAuth = sessionUserId && parsed.data.walletAddress === `replit:${sessionUserId}`;
    if (!isSessionAuth) {
      const { nonce, signature } = parsed.data;
      if (!solanaAddressRegex.test(parsed.data.walletAddress) || !nonce || !signature) {
        return res.status(401).json({ error: "Wallet signature required" });
      }
      if (Math.abs(Date.now() - nonce) > 5 * 60_000) {
        return res.status(401).json({ error: "Authorization expired" });
      }
      if (!await verifyCommunityAppealSignature(
        parsed.data.walletAddress,
        signature,
        communityAppealReadSignatureMessage(parsed.data.walletAddress, nonce),
      )) {
        return res.status(401).json({ error: "Invalid wallet signature" });
      }
      if (!await storage.consumeWalletWriteSignature(signature, "community-appeals-read", parsed.data.walletAddress)) {
        return res.status(401).json({ error: "Authorization already used" });
      }
    }

    if (
      !rateLimit(`community-appeals-read:${parsed.data.walletAddress}`, 20, 60_000) ||
      !rateLimit(`community-appeals-read-ip:${clientIp(req)}`, 40, 60_000)
    ) {
      return res.status(429).json({ error: "Too many status checks. Please wait a moment." });
    }

    try {
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.json(await storage.getCommunityAppealsByRequester(parsed.data.walletAddress, 20));
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to load review requests" });
    }
  });

  app.post("/api/community-appeals/:id/resolve", isAuthenticated, async (req: any, res) => {
    if (!requireModerator(req, res)) return;
    const parsed = z.object({
      status: z.enum(["approved", "declined"]),
      moderatorNote: z.string().max(1000).optional(),
    }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid resolution" });
    }
    const moderatorNote = parsed.data.moderatorNote === undefined
      ? undefined
      : sanitizeUserText(parsed.data.moderatorNote);
    try {
      const result = await storage.resolveCommunityAppeal({
        id: req.params.id,
        status: parsed.data.status,
        moderatorNote,
        resolvedBy: String(req.user.id),
      });
      if (!result) return res.status(404).json({ error: "Pending appeal not found" });
      res.json({
        id: result.appeal.id,
        status: result.appeal.status,
        publishedCommentId: result.publishedComment?.id ?? null,
        message: result.publishedComment
          ? "Appeal approved and the post was published."
          : "Appeal declined and its blocked text was discarded.",
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to resolve appeal" });
    }
  });

  // --- Whale Watch: top active wallets aggregated from in-app swap history ---
  app.get("/api/whales", async (_req, res) => {
    // Historical rows were client-authored and cannot be retroactively
    // distinguished from forged records. Do not publish rankings from them.
    res.set("Cache-Control", "no-store");
    res.json({ whales: [], generatedAt: Date.now() });
  });

  // --- Arbitrage opportunity scanner (read-only; never signs or holds keys) ---
  app.get("/api/arbitrage/scan/:mint", async (req, res) => {
    if (
      !rateLimit(`arb-ip:${clientIp(req)}`, 20, 60_000) ||
      !globalRateLimit("arb", 120, 60_000)
    ) {
      return res.status(429).json({ error: "Too many requests, slow down." });
    }
    const { mint } = req.params;
    if (!solanaAddressRegex.test(mint)) {
      return res.status(400).json({ error: "Invalid Solana token address" });
    }
    const size = Math.min(Math.max(Number(req.query.size) || 50, 1), 100000);
    try {
      const result = await scanTokenArb(mint, size);
      res.set("Cache-Control", "no-store");
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Arbitrage scan failed" });
    }
  });

  app.get("/api/arbitrage/network", async (req, res) => {
    if (
      !rateLimit(`arb-net-ip:${clientIp(req)}`, 6, 60_000) ||
      !globalRateLimit("arb-net", 30, 60_000)
    ) {
      return res.status(429).json({ error: "Too many requests, slow down." });
    }
    const size = Math.min(Math.max(Number(req.query.size) || 50, 1), 100000);
    try {
      const results = await scanNetworkArb(size);
      res.set("Cache-Control", "no-store");
      res.json(results);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Network arbitrage scan failed" });
    }
  });

  // --- Holder snapshot (live). Read-only; enumerates current holders of a mint
  //     for airdrop targeting / CSV export. Never signs or holds keys. ---
  app.get("/api/holders/snapshot/:mint", async (req, res) => {
    if (
      !rateLimit(`holders-ip:${clientIp(req)}`, 12, 60_000) ||
      !globalRateLimit("holders", 60, 60_000)
    ) {
      return res.status(429).json({ error: "Too many requests, slow down." });
    }
    const { mint } = req.params;
    if (!solanaAddressRegex.test(mint)) {
      return res.status(400).json({ error: "Invalid Solana token address" });
    }
    try {
      const result = await getHolderSnapshot(mint);
      res.set("Cache-Control", "no-store");
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Holder snapshot failed" });
    }
  });

  app.get("/api/trending", async (_req, res) => {
    try {
      const tokens = await storage.getTrendingTokens();
      res.set("Cache-Control", "no-store");
      res.json({ tokens, generatedAt: Date.now() });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to load trending" });
    }
  });

  // --- Live trades for a single mint via PumpPortal WS ---
  // Lazily subscribes server-side on first poll; the subscription is
  // refcounted by last-polled timestamp and auto-reaped after ~90s of
  // inactivity to keep upstream subscriptions bounded.
  // Query: ?since=<unix-ms> returns only trades newer than that timestamp,
  // ?limit=N caps the response (default 50, max 100).
  const PUMP_TRADES_IP_LIMIT = 60;
  const PUMP_TRADES_GLOBAL_LIMIT = 600;
  const PUMP_TRADES_RATE_WINDOW_MS = 60_000;
  let pumpTradesGlobal = { count: 0, resetAt: 0 };
  app.get("/api/pump-portal/trades/:mint", async (req, res) => {
    try {
      const { ensureTokenTradeSubscription, getRecentTrades } = await import("../pump-portal");
      const mint = String(req.params.mint || "").trim();
      if (!solanaAddressRegex.test(mint)) {
        return res.status(400).json({ error: "Invalid mint address" });
      }
      const now = Date.now();
      if (now >= pumpTradesGlobal.resetAt) {
        pumpTradesGlobal = { count: 0, resetAt: now + PUMP_TRADES_RATE_WINDOW_MS };
      }
      if (!rateLimit(`pump-trades:${clientIp(req)}`, PUMP_TRADES_IP_LIMIT, PUMP_TRADES_RATE_WINDOW_MS)) {
        res.set("Retry-After", "60");
        return res.status(429).json({ error: "Too many live trade requests — try again shortly." });
      }
      if (++pumpTradesGlobal.count > PUMP_TRADES_GLOBAL_LIMIT) {
        res.set("Retry-After", "60");
        return res.status(429).json({ error: "Live trade service is busy — try again shortly." });
      }
      const since = req.query.since ? Number(req.query.since) : undefined;
      const limit = req.query.limit ? Math.max(1, Math.min(parseInt(String(req.query.limit), 10) || 50, 100)) : 50;
      if (!ensureTokenTradeSubscription(mint)) {
        res.set("Retry-After", "30");
        return res.status(503).json({ error: "Live trade subscription capacity reached — try again shortly." });
      }
      const trades = getRecentTrades(mint, Number.isFinite(since as number) ? since : undefined, limit);
      res.json({ trades, mint, polledAt: Date.now() });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to fetch live trades" });
    }
  });

  // --- Sniper Live Launches: real-time pump.fun new tokens via PumpPortal WS ---
  // The server keeps a persistent WebSocket open to PumpPortal and buffers the
  // last ~100 launches. This endpoint exposes that buffer so the UI can poll
  // it (every 2-3s is plenty — the buffer is updated in real time server-side).
  app.get("/api/sniper/live-launches", async (req, res) => {
    try {
      const { getRecentLaunches, getRecentMigrations, getPumpPortalStatus } = await import("../pump-portal");
      // Two-stage validation:
      //   1. Strict reject (HTTP 400) for params that were *provided* but are
      //      not finite or are negative — these are clear caller bugs.
      //   2. Clamp valid-but-extreme values (e.g. limit=99999 → 100) as
      //      defense-in-depth so a future bypass can't blow up the payload.
      const parseNum = (raw: unknown, name: string, parse: (s: string) => number) => {
        if (raw === undefined || raw === "") return null;
        const n = parse(String(raw));
        if (!Number.isFinite(n) || n < 0) {
          throw new Error(`Invalid query param '${name}': ${String(raw)}`);
        }
        return n;
      };

      let limit = 50, minSolBuy = 0, maxAgeMs = 0;
      try {
        limit     = parseNum(req.query.limit,     "limit",     (s) => parseInt(s, 10))   ?? 50;
        minSolBuy = parseNum(req.query.minSolBuy, "minSolBuy", parseFloat)                ?? 0;
        maxAgeMs  = parseNum(req.query.maxAgeMs,  "maxAgeMs",  (s) => parseInt(s, 10))   ?? 0;
      } catch (validationErr: any) {
        return res.status(400).json({ error: validationErr.message });
      }
      // Defense-in-depth clamp.
      limit = Math.max(1, Math.min(limit, 100));
      const includeMigrations = req.query.includeMigrations === "true";
      const now = Date.now();

      let launches = getRecentLaunches(limit);
      if (minSolBuy > 0)  launches = launches.filter(l => l.initialBuySol >= minSolBuy);
      if (maxAgeMs > 0)   launches = launches.filter(l => (now - l.receivedAt) <= maxAgeMs);

      res.json({
        status: getPumpPortalStatus(),
        launches,
        migrations: includeMigrations ? getRecentMigrations(limit) : undefined,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch live launches" });
    }
  });

  // --- Sniper Auto Scan: filter pump.fun new tokens by user criteria ---
  app.get("/api/sniper/scan", async (req, res) => {
    try {
      const minVolume   = parseFloat((req.query.minVolume   as string) || "0");
      const maxMcap     = parseFloat((req.query.maxMcap     as string) || "999999999");
      const minHolders  = parseInt  ((req.query.minHolders  as string) || "0", 10);
      const maxAgeMins  = parseInt  ((req.query.maxAgeMins  as string) || "99999", 10);
      const minChange1h = parseFloat((req.query.minChange1h as string) || "-999");
      const cleanOnly   = (req.query.creatorRisk as string) === "clean";

      // 1. Fetch latest token profiles from DexScreener
      const profilesRes = await fetch("https://api.dexscreener.com/token-profiles/latest/v1");
      if (!profilesRes.ok) return res.json([]);
      const profiles: any[] = await profilesRes.json();

      // 2. Keep only Solana pump.fun tokens
      const pumpProfiles = profiles
        .filter((t: any) => t.chainId === "solana" && t.tokenAddress?.toLowerCase().endsWith("pump"))
        .slice(0, 40);

      if (pumpProfiles.length === 0) return res.json([]);

      // 3. Fetch pair data for each and apply filters
      const results: any[] = [];
      await Promise.allSettled(
        pumpProfiles.map(async (profile: any) => {
          try {
            const pairRes = await fetch(
              `https://api.dexscreener.com/latest/dex/tokens/${profile.tokenAddress}`
            );
            if (!pairRes.ok) return;
            const pd = await pairRes.json();
            const pair = (pd.pairs || []).find(
              (p: any) => p.baseToken?.address?.toLowerCase() === profile.tokenAddress.toLowerCase()
            ) || pd.pairs?.[0];
            if (!pair) return;

            const volume24h = parseFloat(pair.volume?.h24 || "0");
            const mcap      = parseFloat(pair.fdv || pair.marketCap || "0");
            const holders   = parseInt(pair.info?.holders || "0", 10);
            const change1h  = parseFloat(pair.priceChange?.h1 || "0");
            const pairAge   = pair.pairCreatedAt
              ? Math.floor((Date.now() - pair.pairCreatedAt) / 60000)
              : 9999;

            // Simulate creator risk: flag tokens where dev wallet score indicates risk
            // (using simple heuristic: tokens with very high volume but few holders = risky)
            const creatorRiskLevel = (volume24h > 50000 && holders < 30) ? "high" : "clean";
            if (cleanOnly && creatorRiskLevel === "high") return;

            // Apply filters
            if (volume24h < minVolume)   return;
            if (mcap > maxMcap)          return;
            if (holders < minHolders)    return;
            if (pairAge > maxAgeMins)    return;
            if (change1h < minChange1h)  return;

            // Simulate bonding curve progress (0-100%)
            const bondingPct = Math.min(99, Math.max(1,
              Math.round((mcap / 69000) * 100)
            ));

            results.push({
              mint:          profile.tokenAddress,
              name:          pair.baseToken?.name || profile.description || "Unknown",
              symbol:        pair.baseToken?.symbol || "???",
              price:         pair.priceUsd || "0",
              volume24h,
              mcap,
              holders,
              change1h,
              pairAge,
              bondingPct,
              creatorRisk:   creatorRiskLevel,
              icon:          profile.icon || pair.info?.imageUrl || "",
              url:           profile.url || `https://pump.fun/${profile.tokenAddress}`,
            });
          } catch { /* ignore individual token errors */ }
        })
      );

      // Sort by volume descending
      results.sort((a, b) => b.volume24h - a.volume24h);
      res.json(results.slice(0, 25));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- New Launches leaderboard: latest pump.fun pairs sorted by recency / momentum ---
  // Cached & rate-limit safe: 30s TTL on enriched data, bounded concurrency, per-fetch timeouts.
  const NEW_LAUNCHES_CACHE_MS = 30_000;
  const NEW_LAUNCHES_FETCH_TIMEOUT = 6_000;
  const NEW_LAUNCHES_CONCURRENCY = 8;
  let newLaunchesCache: { ts: number; data: any[] } | null = null;
  let newLaunchesInflight: Promise<any[]> | null = null;

  async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      return await fetch(url, { signal: ctl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadNewLaunchesEnriched(): Promise<any[]> {
    const now = Date.now();
    if (newLaunchesCache && now - newLaunchesCache.ts < NEW_LAUNCHES_CACHE_MS) {
      return newLaunchesCache.data;
    }
    if (newLaunchesInflight) return newLaunchesInflight;

    newLaunchesInflight = (async () => {
      try {
        const profilesRes = await fetchWithTimeout(
          "https://api.dexscreener.com/token-profiles/latest/v1",
          NEW_LAUNCHES_FETCH_TIMEOUT,
        );
        if (!profilesRes.ok) {
          // Serve stale cache on upstream errors if available
          return newLaunchesCache?.data ?? [];
        }
        const profiles: any[] = await profilesRes.json();
        const pumpProfiles = profiles
          .filter((t: any) => t.chainId === "solana" && t.tokenAddress?.toLowerCase().endsWith("pump"))
          .slice(0, 40);
        if (pumpProfiles.length === 0) return newLaunchesCache?.data ?? [];

        // Bounded concurrency worker pool
        const launches: any[] = [];
        let cursor = 0;
        const worker = async () => {
          while (cursor < pumpProfiles.length) {
            const i = cursor++;
            const profile = pumpProfiles[i];
            try {
              const pairRes = await fetchWithTimeout(
                `https://api.dexscreener.com/latest/dex/tokens/${profile.tokenAddress}`,
                NEW_LAUNCHES_FETCH_TIMEOUT,
              );
              if (!pairRes.ok) continue;
              const pd = await pairRes.json();
              const pair = (pd.pairs || []).find(
                (p: any) => p.baseToken?.address?.toLowerCase() === profile.tokenAddress.toLowerCase()
              ) || pd.pairs?.[0];
              if (!pair) continue;

              const createdAt = pair.pairCreatedAt || 0;
              const volume24h = parseFloat(pair.volume?.h24 || "0");
              const volume1h  = parseFloat(pair.volume?.h1  || "0");
              const mcap      = parseFloat(pair.fdv || pair.marketCap || "0");
              const change1h  = parseFloat(pair.priceChange?.h1 || "0");
              const change5m  = parseFloat(pair.priceChange?.m5 || "0");
              const txns1h    = (pair.txns?.h1?.buys || 0) + (pair.txns?.h1?.sells || 0);
              const liquidity = parseFloat(pair.liquidity?.usd || "0");
              const ageMins   = createdAt ? Math.floor((Date.now() - createdAt) / 60000) : 9999;
              const bondingPct = Math.min(99, Math.max(1, Math.round((mcap / 69000) * 100)));

              launches.push({
                mint:        profile.tokenAddress,
                name:        pair.baseToken?.name || profile.description || "Unknown",
                symbol:      pair.baseToken?.symbol || "???",
                icon:        profile.icon || pair.info?.imageUrl || "",
                url:         profile.url || `https://pump.fun/${profile.tokenAddress}`,
                priceUsd:    pair.priceUsd || "0",
                mcap,
                volume1h,
                volume24h,
                change1h,
                change5m,
               buys1h:      Number(pair.txns?.h1?.buys || 0),
               sells1h:     Number(pair.txns?.h1?.sells || 0),
                txns1h,
                liquidity,
                ageMins,
                createdAt,
                bondingPct,
                graduated:   bondingPct >= 99,
              });
            } catch { /* skip individual errors / aborts */ }
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(NEW_LAUNCHES_CONCURRENCY, pumpProfiles.length) }, worker)
        );

        newLaunchesCache = { ts: Date.now(), data: launches };
        return launches;
      } catch {
        // On total failure, serve stale cache rather than 500
        return newLaunchesCache?.data ?? [];
      } finally {
        newLaunchesInflight = null;
      }
    })();

    return newLaunchesInflight;
  }

  // --- Premium Signals: live evidence feed built from the streams already
  //     running for New Launches, Sniper, and Creator Activity. This is a
  //     read-only event feed; it never recommends or executes a trade. ---
  app.get("/api/premium-signals", async (req, res) => {
    if (
      !rateLimit(`premium-signals:${clientIp(req)}`, 30, 60_000) ||
      !globalRateLimit("premium-signals", 300, 60_000)
    ) {
      return res.status(429).json({ error: "Too many signal requests, slow down." });
    }

    try {
      const { getRecentLaunches, getPumpPortalStatus } = await import("../pump-portal");
      const now = Date.now();
      const [marketLaunches, creators, observedTrades] = await Promise.all([
        loadNewLaunchesEnriched(),
        listPumpApiCreatorLeaderboard("newest", 25, "desc"),
        listRecentPumpApiObservedTrades(100),
      ]);

      const liveLaunches = getRecentLaunches(40)
        .filter((launch) => now - launch.receivedAt <= 6 * 60 * 60 * 1000);

      type Signal = {
        id: string;
        kind: "launch" | "trade" | "volume" | "risk" | "creator";
        title: string;
        summary: string;
        evidence: string;
        severity: "info" | "watch" | "high";
        occurredAt: string;
        source: string;
        mint?: string;
        symbol?: string;
        href?: string;
      };
      const signals: Signal[] = [];
      const seen = new Set<string>();
      const addSignal = (signal: Signal) => {
        if (seen.has(signal.id)) return;
        seen.add(signal.id);
        signals.push(signal);
      };

      for (const launch of liveLaunches.slice(0, 12)) {
        addSignal({
          id: `launch:${launch.signature || launch.mint}`,
          kind: "launch",
          title: `${launch.symbol || launch.name || "New token"} launched`,
          summary: `${launch.name || launch.symbol || "A new Pump.fun token"} was observed on the live launch stream.`,
          evidence: `${launch.initialBuySol.toFixed(2)} SOL initial buy · ${launch.marketCapSol.toFixed(1)} SOL market cap · ${launch.pool} pool`,
          severity: "info",
          occurredAt: new Date(launch.receivedAt).toISOString(),
          source: "PumpPortal live launch stream",
          mint: launch.mint,
          symbol: launch.symbol,
          href: `/scan?mint=${encodeURIComponent(launch.mint)}`,
        });
      }

      for (const trade of observedTrades.filter((trade: any) => trade.quoteAmount >= 3).slice(0, 12)) {
        addSignal({
          id: `trade:${trade.eventKey}`,
          kind: "trade",
          title: `Large trade activity · $${trade.symbol || trade.name || "token"}`,
          summary: `A decoded PumpAPI trade event crossed the large-activity threshold on a tracked launch.`,
          evidence: `${trade.action === "sell" ? "Reported sell" : "Reported buy"} · ${trade.quoteAmount.toFixed(2)} SOL gross · ${trade.breakdownCount} trade${trade.breakdownCount === 1 ? "" : "s"} in the event`,
          severity: trade.action === "sell" ? "watch" : "info",
          occurredAt: trade.tradedAt,
          source: "PumpAPI observed trade stream",
          mint: trade.mint,
          symbol: trade.symbol ?? undefined,
          href: `/scan?mint=${encodeURIComponent(trade.mint)}`,
        });
      }

      for (const launch of marketLaunches
        .filter((item: any) => item.volume1h >= 25_000 && item.txns1h >= 100)
        .sort((a: any, b: any) => b.volume1h - a.volume1h)
        .slice(0, 6)) {
        const ageHours = Math.max(1 / 60, Number(launch.ageMins || 1) / 60);
        const volumePerHour = launch.volume1h / ageHours;
        addSignal({
          id: `volume:${launch.mint}:${Math.floor(Date.now() / 30_000)}`,
          kind: "volume",
          title: `Unusual volume · $${launch.symbol}`,
          summary: `${launch.txns1h.toLocaleString()} transactions were observed in the latest one-hour window.`,
          evidence: `$${Math.round(launch.volume1h).toLocaleString()} 1h volume · ${volumePerHour >= 100_000 ? "high" : "elevated"} for its age · ${launch.change1h >= 0 ? "+" : ""}${launch.change1h.toFixed(1)}% 1h`,
          severity: "watch",
          occurredAt: new Date(now).toISOString(),
          source: "DEXScreener market snapshot",
          mint: launch.mint,
          symbol: launch.symbol,
          href: `/scan?mint=${encodeURIComponent(launch.mint)}`,
        });
      }

      for (const launch of marketLaunches
        .filter((item: any) => item.liquidity < 5_000 && (item.change1h <= -20 || item.sells1h > item.buys1h * 1.5))
        .sort((a: any, b: any) => a.liquidity - b.liquidity)
        .slice(0, 6)) {
        addSignal({
          id: `risk:${launch.mint}:${Math.floor(Date.now() / 30_000)}`,
          kind: "risk",
          title: `Risk watch · $${launch.symbol}`,
          summary: "Market evidence shows thin liquidity alongside a sharp move or sell-heavy activity.",
          evidence: `$${Math.round(launch.liquidity).toLocaleString()} liquidity · ${launch.change1h.toFixed(1)}% 1h · ${launch.buys1h} buys / ${launch.sells1h} sells`,
          severity: "high",
          occurredAt: new Date(now).toISOString(),
          source: "DEXScreener market snapshot",
          mint: launch.mint,
          symbol: launch.symbol,
          href: `/scan?mint=${encodeURIComponent(launch.mint)}`,
        });
      }

      for (const creator of creators.filter((item: any) => now - Date.parse(item.lastLaunchAt) <= 60 * 60 * 1000).slice(0, 6)) {
        const token = creator.latestToken?.symbol || creator.latestToken?.name || "token";
        addSignal({
          id: `creator:${creator.creatorWallet}:${creator.lastLaunchAt}`,
          kind: "creator",
          title: `Creator activity · $${token}`,
          summary: `A tracked creator wallet launched a token in the last hour.`,
          evidence: `${creator.launches.toLocaleString()} launches observed · ${creator.graduatedLaunchCount} graduated · ${creator.creatorWallet.slice(0, 5)}…${creator.creatorWallet.slice(-4)}`,
          severity: creator.graduatedLaunchCount > 0 ? "watch" : "info",
          occurredAt: creator.lastLaunchAt,
          source: "PumpAPI creator stream",
          mint: creator.latestToken?.mint,
          symbol: creator.latestToken?.symbol,
          href: `/creators?wallet=${encodeURIComponent(creator.creatorWallet)}`,
        });
      }

      signals.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
      const pumpApiStatus = getPumpApiLeaderboardStatus();
      const pumpPortalStatus = getPumpPortalStatus();
      const sourceStates = [
        {
          id: "pumpportal",
          label: "PumpPortal launch stream",
          state: pumpPortalStatus.connected ? "live" : "offline",
          detail: pumpPortalStatus.connected ? "Connected" : "Reconnecting",
        },
        {
          id: "dexscreener",
          label: "DEX market snapshots",
          state: marketLaunches.length > 0 ? "live" : "unavailable",
          detail: marketLaunches.length > 0 ? "Fresh market data" : "No market data",
        },
        {
          id: "pumpapi",
          label: "PumpAPI creator + trade stream",
          state: pumpApiStatus.connected ? (pumpApiStatus.persistenceDegraded ? "partial" : "live") : "offline",
          detail: pumpApiStatus.persistenceDegraded ? "Live, with partial persistence" : pumpApiStatus.connected ? "Connected" : "Reconnecting",
        },
      ];

      res.set("Cache-Control", "public, max-age=10, stale-while-revalidate=20");
      res.json({
        generatedAt: new Date(now).toISOString(),
        signals: signals.slice(0, 40),
        sources: sourceStates,
        partial: sourceStates.some((source) => source.state === "partial" || source.state === "offline" || source.state === "unavailable"),
        message: signals.length > 0
          ? `${signals.length} evidence event${signals.length === 1 ? "" : "s"} observed from live sources.`
          : "Live sources are connected; waiting for a qualifying evidence event.",
      });
    } catch (err: any) {
      res.status(502).json({ error: err?.message || "Premium signal sources are unavailable" });
    }
  });

  app.get("/api/new-launches", async (req, res) => {
    const sort     = ((req.query.sort as string) || "newest").toLowerCase();   // newest | volume | change | mcap
    const maxAgeHr = parseFloat((req.query.maxAgeHr as string) || "24");
    try {
      const all = await loadNewLaunchesEnriched();
      const cutoffMs = Date.now() - maxAgeHr * 60 * 60 * 1000;
      const filtered = all.filter((l: any) => !l.createdAt || l.createdAt >= cutoffMs);

      switch (sort) {
        case "volume":  filtered.sort((a, b) => b.volume1h  - a.volume1h);  break;
        case "change":  filtered.sort((a, b) => b.change1h  - a.change1h);  break;
        case "mcap":    filtered.sort((a, b) => b.mcap      - a.mcap);      break;
        case "newest":
        default:        filtered.sort((a, b) => a.ageMins   - b.ageMins);   break;
      }

      res.set("Cache-Control", "public, max-age=15");
      res.json(filtered.slice(0, 50));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Trending tokens (PumpAPI discovery + DexScreener/Jupiter enrichment) ---
  let trendingTokensCache: { at: number; tokens: any[] } | null = null;
  const TRENDING_TOKENS_CACHE_MS = 20_000;
  const ARCADE_MIN_MARKET_CAP_USD = 50_000;
  const ARCADE_MIN_LIQUIDITY_USD = 10_000;
  const ARCADE_MIN_TXNS_1H = 10;
  app.get("/api/trending-tokens", async (_req, res) => {
    try {
      if (trendingTokensCache && Date.now() - trendingTokensCache.at < TRENDING_TOKENS_CACHE_MS) {
        res.set("Cache-Control", "public, max-age=10, stale-while-revalidate=20");
        return res.json(trendingTokensCache.tokens);
      }

      let solBoosts: any[] = [];
      try {
        const boostRes = await fetch("https://api.dexscreener.com/token-boosts/top/v1", {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(8_000),
        });
        if (boostRes.ok) {
          const boosts: any[] = await boostRes.json();
          solBoosts = boosts.filter((token: any) => token.chainId === "solana").slice(0, 30);
        }
      } catch {
        // PumpAPI live launches can still supply candidates when boosts are unavailable.
      }

      const pumpApiCandidates = getRecentPumpApiLaunches(30).map((launch) => ({
        chainId: "solana",
        tokenAddress: launch.mint,
        pumpApiName: launch.name,
        pumpApiSymbol: launch.symbol,
      }));
      const interleavedCandidates = Array.from(
        { length: Math.max(pumpApiCandidates.length, solBoosts.length) },
        (_, index) => [pumpApiCandidates[index], solBoosts[index]],
      ).flat().filter(Boolean);
      const candidates = Array.from(
        new Map(
          interleavedCandidates
            .filter((token: any) => solanaAddressRegex.test(String(token.tokenAddress ?? "")))
            .map((token: any) => [String(token.tokenAddress), token]),
        ).values(),
      ).slice(0, 30);

      const results = await Promise.all(
        candidates.map(async (token: any) => {
          try {
            const pairRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token.tokenAddress}`, {
              headers: { accept: "application/json" },
              signal: AbortSignal.timeout(8_000),
            });
            if (!pairRes.ok) return;
            const pairData = await pairRes.json();
            const pair = (pairData.pairs || []).find(
              (p: any) => p.baseToken?.address?.toLowerCase() === token.tokenAddress.toLowerCase()
            ) || pairData.pairs?.[0];
            if (!pair) return null;
            const buys1h = Number(pair.txns?.h1?.buys ?? 0);
            const sells1h = Number(pair.txns?.h1?.sells ?? 0);
            return {
              mint: token.tokenAddress,
              symbol: pair.baseToken?.symbol || token.pumpApiSymbol || "???",
              name: pair.baseToken?.name || token.pumpApiName || "",
              price: pair.priceUsd || "0",
              marketDataAt: new Date().toISOString(),
              change1h: pair.priceChange?.h1 ?? null,
              change5m: Number(pair.priceChange?.m5 ?? 0),
              mcap: Number(pair.marketCap ?? pair.fdv ?? 0),
              volume1h: Number(pair.volume?.h1 ?? 0),
              volume24h: Number(pair.volume?.h24 ?? 0),
              txns1h: buys1h + sells1h,
              liquidity: Number(pair.liquidity?.usd ?? 0),
              ageMins: pair.pairCreatedAt ? Math.max(0, Math.round((Date.now() - Number(pair.pairCreatedAt)) / 60_000)) : 0,
              bondingPct: 0,
              graduated: String(pair.dexId ?? "").toLowerCase() !== "pumpfun",
              url: pair.url || `https://dexscreener.com/solana/${token.tokenAddress}`,
              icon: token.icon || "",
              imageUrl: pair.info?.imageUrl || (token.icon
                ? `https://dd.dexscreener.com/ds-data/tokens/solana/${token.tokenAddress}.png?size=lg&key=${token.icon}`
                : ""),
            };
          } catch { return null; }
        })
      );

      const primaryTokens = results.filter((token: any) => (
        token &&
        token.mcap >= ARCADE_MIN_MARKET_CAP_USD &&
        token.liquidity >= ARCADE_MIN_LIQUIDITY_USD &&
        token.txns1h >= ARCADE_MIN_TXNS_1H
      ));
      const tokenByMint = new Map(primaryTokens.map((token: any) => [token.mint, token]));

      if (tokenByMint.size < 8) {
        try {
          const jupiterRes = await fetch("https://lite-api.jup.ag/tokens/v2/toptraded/1h?limit=30", {
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(8_000),
          });
          if (jupiterRes.ok) {
            const jupiterTokens: any[] = await jupiterRes.json();
            for (const token of jupiterTokens) {
              if (tokenByMint.size >= 20) break;
              const mint = String(token.id ?? "");
              const tags = Array.isArray(token.tags) ? token.tags.map((tag: unknown) => String(tag).toLowerCase()) : [];
              const isStock = tags.some((tag: string) => (
                tag === "stocks" ||
                tag === "xstocks" ||
                tag === "equities" ||
                tag === "prestocks" ||
                tag === "pre-ipo"
              ));
              const stats5m = token.stats5m ?? {};
              const stats1h = token.stats1h ?? {};
              const stats24h = token.stats24h ?? {};
              const mcap = Number(token.mcap ?? token.fdv ?? 0);
              const liquidity = Number(token.liquidity ?? 0);
              const txns1h = Number(stats1h.numBuys ?? 0) + Number(stats1h.numSells ?? 0);
              if (
                !token.isVerified ||
                isStock ||
                !solanaAddressRegex.test(mint) ||
                tokenByMint.has(mint) ||
                mcap < ARCADE_MIN_MARKET_CAP_USD ||
                liquidity < ARCADE_MIN_LIQUIDITY_USD ||
                txns1h < ARCADE_MIN_TXNS_1H
              ) continue;
              const createdAt = Date.parse(String(token.firstPool?.createdAt ?? token.createdAt ?? ""));
              tokenByMint.set(mint, {
                mint,
                symbol: String(token.symbol ?? "???"),
                name: String(token.name ?? ""),
                price: Number(token.usdPrice ?? 0),
                marketDataAt: new Date().toISOString(),
                change1h: Number.isFinite(Number(stats1h.priceChange)) ? Number(stats1h.priceChange) : null,
                change5m: Number.isFinite(Number(stats5m.priceChange)) ? Number(stats5m.priceChange) : null,
                mcap,
                volume1h: Number(stats1h.buyVolume ?? 0) + Number(stats1h.sellVolume ?? 0),
                volume24h: Number(stats24h.buyVolume ?? 0) + Number(stats24h.sellVolume ?? 0),
                txns1h,
                liquidity,
                ageMins: Number.isFinite(createdAt) ? Math.max(0, Math.round((Date.now() - createdAt) / 60_000)) : 0,
                bondingPct: 0,
                graduated: true,
                url: `https://dexscreener.com/solana/${mint}`,
                icon: "",
                imageUrl: typeof token.icon === "string" ? token.icon : "",
              });
            }
          }
        } catch {
          // The primary PumpAPI + DexScreener lanes remain usable without backfill.
        }
      }

      const tokens = Array.from(tokenByMint.values()).slice(0, 20);
      trendingTokensCache = { at: Date.now(), tokens };
      res.set("Cache-Control", "public, max-age=10, stale-while-revalidate=20");
      res.json(tokens);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Swap history routes ---
  // Client-declared swap facts cannot be safely bound to a specific route leg
  // in a composable Solana transaction. Fail closed until history is derived
  // from a trusted server-side execution receipt.
  app.post("/api/swap-history", (_req, res) => {
    res.status(410).json({ error: "Client-authored swap history retired" });
  });

  app.get("/api/swap-history/:wallet", (_req, res) => {
    res.status(410).json({ error: "Legacy swap history retired" });
  });

  // ── Bump bot history ────────────────────────────────────────────────────
  // Persists every bump (success + failure) so users can see their full
  // trading history after logging out and back in. Keyed by ownerWallet
  // (the user's main wallet — not the session sub-wallet that signed).
  //
  // SECURITY MODEL
  // POST is authenticated via an Ed25519 signature from the SESSION wallet
  // over a canonical message that binds the (owner, session, mint, action,
  // amount, txSignature, status, nonce). This means only an entity that
  // controls the session keypair can write records — random unauthenticated
  // clients cannot poison anyone's history. The nonce must be within 5
  // minutes of server time to prevent replay.
  //
  // GET is currently public-by-wallet because Solana addresses and on-chain
  // history are already public; explorers like Solscan expose this trivially.
  // The trade-off is privacy: linking a user's main wallet to their session
  // sub-wallets via this endpoint is mildly easier than scraping the chain.
  // Acceptable for v1 — a delegation/auth-cookie hardening is tracked as
  // future work.
  const HISTORY_NONCE_MAX_AGE_MS = 5 * 60 * 1000;
  const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const TX_SIG_RE      = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

  const bumpHistorySchema = z.object({
    ownerWallet:   z.string().regex(SOLANA_ADDR_RE, "Invalid owner wallet"),
    sessionWallet: z.string().regex(SOLANA_ADDR_RE, "Invalid session wallet"),
    mint:          z.string().regex(SOLANA_ADDR_RE, "Invalid mint"),
    tokenSymbol:   z.string().max(32).optional().nullable(),
    action:        z.enum(["buy", "sell"]),
    amountSol:     z.number().nonnegative().nullable().optional(),
    amountTokens:  z.number().nonnegative().nullable().optional(),
    txSignature:   z.string().regex(TX_SIG_RE).nullable().optional()
                     .or(z.literal("")).transform(v => v === "" ? null : v),
    status:        z.enum(["success", "failed"]),
    errorMessage:  z.string().max(500).nullable().optional(),
    nonce:         z.number().int().positive(),
    signature:     z.string().min(64).max(128),  // base58-encoded 64-byte sig
  });

  /** Canonical message bytes the session wallet signs. Order MUST match the
   *  client in client/src/pages/bump-bot.tsx → logBumpToServer. */
  function bumpHistoryMessage(d: {
    ownerWallet: string; sessionWallet: string; mint: string;
    action: "buy"|"sell"; amountSol: number | null | undefined;
    amountTokens: number | null | undefined; txSignature: string | null;
    status: "success"|"failed"; nonce: number;
  }): Uint8Array {
    const msg = [
      "paif-bump-history", "v1",
      d.ownerWallet, d.sessionWallet, d.mint,
      d.action,
      String(d.amountSol ?? ""),
      String(d.amountTokens ?? ""),
      d.txSignature ?? "",
      d.status,
      String(d.nonce),
    ].join("|");
    return new TextEncoder().encode(msg);
  }

  /** Canonical message a delegator signs to authorize a session wallet to
   *  log bump history under an owner. MUST match the client. */
  function bumpDelegateMessage(d: {
    ownerWallet: string; sessionWallet: string; nonce: number;
  }): Uint8Array {
    const msg = [
      "paif-bump-delegate", "v1",
      d.ownerWallet, d.sessionWallet, String(d.nonce),
    ].join("|");
    return new TextEncoder().encode(msg);
  }

  async function verifyEd25519(pubkeyB58: string, sigB58: string, msgBytes: Uint8Array): Promise<boolean> {
    try {
      const { ed25519 } = await import("@noble/curves/ed25519");
      const bs58lib = (await import("bs58")).default;
      const pub = bs58lib.decode(pubkeyB58);
      const sig = bs58lib.decode(sigB58);
      if (pub.length !== 32 || sig.length !== 64) return false;
      return ed25519.verify(sig, msgBytes, pub);
    } catch {
      return false;
    }
  }

  app.post("/api/bump-history", async (req, res) => {
    const parsed = bumpHistorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
    }
    const d = parsed.data;
    // Replay protection
    const drift = Math.abs(Date.now() - d.nonce);
    if (drift > HISTORY_NONCE_MAX_AGE_MS) {
      return res.status(401).json({ error: "Nonce expired or clock skew too large" });
    }
    // Ed25519 signature: prove the request was made by someone holding the
    // session keypair (factor 1).
    const msgBytes = bumpHistoryMessage({
      ownerWallet:   d.ownerWallet,
      sessionWallet: d.sessionWallet,
      mint:          d.mint,
      action:        d.action,
      amountSol:     d.amountSol ?? null,
      amountTokens:  d.amountTokens ?? null,
      txSignature:   d.txSignature ?? null,
      status:        d.status,
      nonce:         d.nonce,
    });
    const sigOk = await verifyEd25519(d.sessionWallet, d.signature, msgBytes);
    if (!sigOk) return res.status(401).json({ error: "Invalid signature" });
    // Delegation binding: prove the session wallet is authorized to log
    // history under this owner (factor 2 — closes the IDOR/poisoning hole).
    const delegation = await storage.getBumpDelegation(d.ownerWallet, d.sessionWallet);
    if (!delegation) {
      return res.status(403).json({ error: "Session wallet not authorized for this owner. Re-generate or unlock your session wallet." });
    }
    try {
      const item = await storage.saveBumpHistory({
        ownerWallet:   d.ownerWallet,
        sessionWallet: d.sessionWallet,
        mint:          d.mint,
        tokenSymbol:   d.tokenSymbol ?? null,
        action:        d.action,
        amountSol:     d.amountSol ?? null,
        amountTokens:  d.amountTokens ?? null,
        txSignature:   d.txSignature ?? null,
        status:        d.status,
        errorMessage:  d.errorMessage ?? null,
      });
      res.json(item);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to save bump history" });
    }
  });

  // ── Bump-history delegation ────────────────────────────────────────────
  // The user's MAIN wallet signs a one-time message authorizing a session
  // wallet to log bump history under it. Sub-wallets are then delegated
  // transitively by an already-delegated session wallet (no main-wallet
  // popup needed). Without this binding, an attacker could sign valid
  // session-key signatures and attribute records to any victim wallet.
  const bumpDelegationSchema = z.object({
    ownerWallet:     z.string().regex(SOLANA_ADDR_RE),
    sessionWallet:   z.string().regex(SOLANA_ADDR_RE),
    delegatorWallet: z.string().regex(SOLANA_ADDR_RE),
    nonce:           z.number().int().positive(),
    signature:       z.string().min(64).max(128),
  });

  app.post("/api/bump-history/delegate", async (req, res) => {
    const parsed = bumpDelegationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
    }
    const d = parsed.data;
    if (Math.abs(Date.now() - d.nonce) > HISTORY_NONCE_MAX_AGE_MS) {
      return res.status(401).json({ error: "Nonce expired" });
    }
    // Verify the delegator actually signed the canonical attestation
    const msgBytes = bumpDelegateMessage({
      ownerWallet:   d.ownerWallet,
      sessionWallet: d.sessionWallet,
      nonce:         d.nonce,
    });
    const ok = await verifyEd25519(d.delegatorWallet, d.signature, msgBytes);
    if (!ok) return res.status(401).json({ error: "Invalid delegator signature" });
    // The delegator must be EITHER the owner itself, OR a session wallet
    // that already has a delegation under this owner (chain-of-trust). This
    // lets the primary session wallet authorize sub-wallets without forcing
    // a fresh main-wallet popup for each sub.
    if (d.delegatorWallet !== d.ownerWallet) {
      const parent = await storage.getBumpDelegation(d.ownerWallet, d.delegatorWallet);
      if (!parent) {
        return res.status(403).json({ error: "Delegator is not authorized for this owner" });
      }
    }
    // Enforce the per-tier sub-wallet cap purchased via credit packs.
    // Count + insert run inside a single serializable DB transaction in
    // `saveBumpDelegationWithCap` so two concurrent registrations on the same
    // owner cannot both pass the cap check and oversubscribe. Re-registering
    // the same sessionWallet is always allowed (it doesn't grow the set).
    // The owner wallet itself never counts against the cap. We deliberately
    // fail CLOSED on errors here — a DB hiccup must not let a paying tier be
    // bypassed and must not silently double-grant sub-wallets above the
    // purchased entitlement.
    let cap: number;
    try {
      const credit = await storage.getCreditBalance(d.ownerWallet);
      cap = credit.maxSubwallets;
    } catch (err: any) {
      console.error("[bump-delegate] failed to read credit balance for cap check:", err?.message);
      return res.status(503).json({ error: "Sub-wallet cap check unavailable. Please retry." });
    }
    try {
      const result = await storage.saveBumpDelegationWithCap({
        ownerWallet:     d.ownerWallet,
        sessionWallet:   d.sessionWallet,
        delegatorWallet: d.delegatorWallet,
        signature:       d.signature,
        nonce:           String(d.nonce),
      }, cap);
      if ("exceeded" in result && result.exceeded) {
        return res.status(402).json({
          error: `Sub-wallet cap reached for your tier (max ${result.cap}). Upgrade your credit pack on /upgrade to add more sub-wallets.`,
          code: "SUBWALLET_CAP_EXCEEDED",
          cap: result.cap,
          currentCount: result.currentCount,
        });
      }
      res.json(result.row);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to save delegation" });
    }
  });

  // POST /api/bump-history/delegate-from-tx — single-popup delegation flow.
  // Instead of asking the owner to sign a separate `signMessage` attestation,
  // the funding transaction itself proves the owner authorized the session
  // wallet (the tx is signed by the owner and transfers SOL to the session
  // address). The server fetches the tx, validates signer + transfer
  // direction + age, and writes the delegation row using the same atomic
  // cap-enforcing storage path used by the message-based route.
  const delegateFromTxSchema = z.object({
    ownerWallet:   z.string().regex(SOLANA_ADDR_RE),
    sessionWallet: z.string().regex(SOLANA_ADDR_RE),
    txSignature:   z.string().min(43).max(128),
  });
  app.post("/api/bump-history/delegate-from-tx", async (req, res) => {
    const parsed = delegateFromTxSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
    }
    const { ownerWallet, sessionWallet, txSignature } = parsed.data;
    // Lazy-load to keep the heavy credits module out of the cold-start path
    // for unrelated requests.
    const { verifyDelegationFromTx } = await import("../credits");
    try {
      await verifyDelegationFromTx({ txSignature, ownerWallet, sessionWallet });
    } catch (err: any) {
      return res.status(400).json({ error: err?.message || "Funding tx verification failed" });
    }
    let cap: number;
    try {
      const credit = await storage.getCreditBalance(ownerWallet);
      cap = credit.maxSubwallets;
    } catch (err: any) {
      console.error("[delegate-from-tx] failed to read credit balance for cap check:", err?.message);
      return res.status(503).json({ error: "Sub-wallet cap check unavailable. Please retry." });
    }
    try {
      const result = await storage.saveBumpDelegationWithCap({
        ownerWallet,
        sessionWallet,
        // Delegator is the owner — they signed the funding tx.
        delegatorWallet: ownerWallet,
        // The on-chain tx signature is durable proof; we store it where the
        // message-based path stores its signMessage signature so downstream
        // audit tools have a single field to check.
        signature:       txSignature,
        // Re-use the tx slot (millis-since-epoch is fine; routes only read it
        // for staleness checks, not as a unique key).
        nonce:           String(Date.now()),
      }, cap);
      if ("exceeded" in result && result.exceeded) {
        return res.status(402).json({
          error: `Sub-wallet cap reached for your tier (max ${result.cap}). Upgrade your credit pack on /upgrade to add more sub-wallets.`,
          code: "SUBWALLET_CAP_EXCEEDED",
          cap: result.cap,
          currentCount: result.currentCount,
        });
      }
      res.json(result.row);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to save delegation" });
    }
  });

  // Lets the client check which session wallets are already delegated under
  // an owner (so it doesn't trigger a duplicate main-wallet popup on unlock).
  app.get("/api/bump-history/delegations/:wallet", async (req, res) => {
    if (!SOLANA_ADDR_RE.test(req.params.wallet)) {
      return res.status(400).json({ error: "Invalid wallet" });
    }
    try {
      const rows = await storage.getOwnerBumpDelegations(req.params.wallet);
      res.json({ delegations: rows.map(r => ({
        sessionWallet: r.sessionWallet,
        delegatorWallet: r.delegatorWallet,
        createdAt: r.createdAt,
      })) });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to load delegations" });
    }
  });

  /**
   * List every session wallet this main wallet has ever traded from.
   * Powers the "Platform Holdings" panel — lets users see (and possibly
   * recover from) wallets whose encrypted keys are no longer on this
   * device (overwritten by a later regenerate-session-wallet flow).
   * Read-only; no auth needed (the pubkey list is non-sensitive — anyone
   * could enumerate the same info from the on-chain tx history of the
   * main wallet).
   */
  app.get("/api/bump-history/:wallet/session-wallets", async (req, res) => {
    if (!SOLANA_ADDR_RE.test(req.params.wallet)) {
      return res.status(400).json({ error: "Invalid wallet" });
    }
    try {
      const wallets = await storage.getDistinctSessionWalletsForOwner(req.params.wallet);
      res.setHeader("Cache-Control", "no-store");
      res.json({ wallets });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to load platform wallets" });
    }
  });

  app.get("/api/bump-history/:wallet", async (req, res) => {
    if (!SOLANA_ADDR_RE.test(req.params.wallet)) {
      return res.status(400).json({ error: "Invalid wallet" });
    }
    try {
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "200")) || 200, 1), 500);
      const [history, stats] = await Promise.all([
        storage.getBumpHistory(req.params.wallet, limit),
        storage.getBumpHistoryStats(req.params.wallet),
      ]);
      res.json({ history, stats });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to get bump history" });
    }
  });

  // ─── Credit packs (off-chain bump-bot subscription model) ───────────────────
  // Replaces the old on-chain platform fee. Each main wallet has a balance of
  // bump credits — one consumed per fired bump. Packs are bought by sending a
  // single clean SOL transfer to the treasury (no Phantom warning).
  const { listPacks, quotePackLamports, verifyAndGrant, verifyDelegationFromTx, getTreasuryAddress } =
    await import("../credits");
  const {
    listAccessPasses,
    quoteAccessPassLamports,
    verifyAndGrantAccessPass,
    ACCESS_TRIAL_DURATION_MS,
  } = await import("../access-passes");

  app.get("/api/access-passes", (_req, res) => {
    res.json({ passes: listAccessPasses(), treasury: getTreasuryAddress(), trialDurationMs: ACCESS_TRIAL_DURATION_MS });
  });

  app.get("/api/access-pass/:wallet", async (req, res) => {
    if (!SOLANA_ADDR_RE.test(req.params.wallet)) {
      return res.status(400).json({ error: "Invalid wallet" });
    }
    try {
      res.json(await storage.getAccessPass(req.params.wallet));
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to read Access Pass status" });
    }
  });

  const accountAccessOwner = (userId: unknown) => `account:${String(userId ?? "")}`;

  app.get("/api/access-pass-account", isAuthenticated, async (req, res) => {
    try {
      res.json(await storage.getAccessPass(accountAccessOwner((req.user as any)?.id)));
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to read Access Pass status" });
    }
  });

  const accessTrialSchema = z.object({
    ownerWallet: z.string().regex(SOLANA_ADDR_RE),
    nonce: z.number().int().positive(),
    signature: z.string().min(64).max(128),
  });
  app.post("/api/access-pass/claim-trial", async (req, res) => {
    const parsed = accessTrialSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid trial claim" });
    const d = parsed.data;
    if (Math.abs(Date.now() - d.nonce) > HISTORY_NONCE_MAX_AGE_MS) {
      return res.status(401).json({ error: "Trial claim expired — please retry." });
    }
    const ok = await verifyEd25519(
      d.ownerWallet,
      d.signature,
      new TextEncoder().encode(["paif-access-trial", "v1", d.ownerWallet, String(d.nonce)].join("|")),
    );
    if (!ok) return res.status(401).json({ error: "Invalid wallet signature" });
    try {
      res.json(await storage.startAccessTrial(d.ownerWallet));
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to start trial" });
    }
  });

  app.post("/api/access-pass/claim-trial-account", isAuthenticated, async (req, res) => {
    try {
      res.json(await storage.startAccessTrial(accountAccessOwner((req.user as any)?.id)));
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to start trial" });
    }
  });

  app.post("/api/access-pass/intent", async (req, res) => {
    try {
      const q = await quoteAccessPassLamports(String(req.body?.passId ?? ""));
      res.json({
        passId: q.pass.id,
        label: q.pass.label,
        priceUsd: q.pass.priceUsd,
        durationMs: q.pass.durationMs,
        solPriceUsd: q.solPriceUsd,
        lamports: q.lamports.toString(),
        treasury: getTreasuryAddress(),
        expiresAtMs: q.expiresAtMs,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to quote Access Pass" });
    }
  });

  app.post("/api/access-pass/verify", async (req, res) => {
    try {
      res.json(await verifyAndGrantAccessPass({
        txSignature: String(req.body?.txSignature ?? ""),
        ownerWallet: String(req.body?.ownerWallet ?? ""),
        passId: String(req.body?.passId ?? ""),
      }));
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Access Pass verification failed" });
    }
  });

  const walletCardCheckoutSchema = z.object({
    ownerWallet: z.string().regex(SOLANA_ADDR_RE),
    passId: z.string().min(1).max(32),
    nonce: z.number().int().positive(),
    signature: z.string().min(64).max(128),
  });
  const cardPassSchema = z.object({
    passId: z.string().min(1).max(32),
  });
  app.post("/api/access-pass/card-checkout", async (req, res) => {
    const passParsed = cardPassSchema.safeParse(req.body);
    if (!passParsed.success) return res.status(400).json({ error: "Invalid card checkout request" });

    let accessOwner: string;
    let customerEmail: string | null = null;
    if (req.isAuthenticated() && (req.user as any)?.id) {
      accessOwner = accountAccessOwner((req.user as any).id);
      customerEmail = typeof (req.user as any)?.email === "string" ? (req.user as any).email : null;
    } else {
      const parsed = walletCardCheckoutSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(401).json({ error: "Sign in with email or connect a wallet to continue." });
      }
      const d = parsed.data;
      if (Math.abs(Date.now() - d.nonce) > HISTORY_NONCE_MAX_AGE_MS) {
        return res.status(401).json({ error: "Card checkout request expired — please retry." });
      }
      const ok = await verifyEd25519(
        d.ownerWallet,
        d.signature,
        new TextEncoder().encode(["paif-access-card", "v1", d.ownerWallet, d.passId, String(d.nonce)].join("|")),
      );
      if (!ok) return res.status(401).json({ error: "Invalid wallet signature" });
      accessOwner = d.ownerWallet;
    }
    try {
      const { createCardAccessPassCheckout } = await import("../stripe-access-passes");
      const configuredDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
      const returnBaseUrl = configuredDomain
        ? `https://${configuredDomain}`
        : `${req.protocol}://${req.get("host")}`;
      res.json(await createCardAccessPassCheckout({
        accessOwner,
        passId: passParsed.data.passId,
        returnBaseUrl,
        customerEmail,
      }));
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Could not start card checkout" });
    }
  });

  app.post("/api/access-pass/card-confirm", async (req, res) => {
    try {
      const { confirmCardAccessPassCheckout } = await import("../stripe-access-passes");
      res.json(await confirmCardAccessPassCheckout(String(req.body?.sessionId ?? "")));
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Card payment verification failed" });
    }
  });

  app.get("/api/credits/packs", (_req, res) => {
    res.json({ packs: listPacks(), treasury: getTreasuryAddress() });
  });

  // GET /api/network/fee-estimate — current Solana congestion + recommended
  // per-bump funding so the bump-bot UI can transparently show the user how
  // much they need to top up sub-wallets at this exact moment. The user's
  // own session/sub-wallet pays this on-chain — we don't subsidize fees.
  app.get("/api/network/fee-estimate", async (_req, res) => {
    try {
      const { getPublicNetworkFeeEstimate } = await import("../network-fees");
      const est = await getPublicNetworkFeeEstimate();
      res.json(est);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch fee estimate" });
    }
  });

  app.get("/api/credits/:wallet", async (req, res) => {
    if (!SOLANA_ADDR_RE.test(req.params.wallet)) {
      return res.status(400).json({ error: "Invalid wallet" });
    }
    try {
      // Pure read; never grants trial credits. Unknown wallets return 0.
      const bal = await storage.getCreditBalance(req.params.wallet);
      res.json(bal);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to read credit balance" });
    }
  });

  // POST /api/credits/claim-trial — grant FREE_TRIAL_CREDITS exactly once for
  // a wallet that proves ownership via an ed25519 signature. Without this gate
  // an attacker could spray GET /api/credits/:wallet to mint trial credits for
  // millions of synthetic addresses and then debit them via the bump bot.
  function claimTrialMessage(d: { ownerWallet: string; nonce: number }): Uint8Array {
    return new TextEncoder().encode(
      ["paif-claim-trial", "v1", d.ownerWallet, String(d.nonce)].join("|")
    );
  }
  const claimTrialSchema = z.object({
    ownerWallet: z.string().regex(SOLANA_ADDR_RE),
    nonce:       z.number().int().positive(),
    signature:   z.string().min(64).max(128),
  });
  app.post("/api/credits/claim-trial", async (req, res) => {
    const parsed = claimTrialSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
    }
    const d = parsed.data;
    if (Math.abs(Date.now() - d.nonce) > HISTORY_NONCE_MAX_AGE_MS) {
      return res.status(401).json({ error: "Nonce expired or clock skew too large" });
    }
    const sigOk = await verifyEd25519(
      d.ownerWallet, d.signature, claimTrialMessage({ ownerWallet: d.ownerWallet, nonce: d.nonce }),
    );
    if (!sigOk) return res.status(401).json({ error: "Invalid signature" });
    try {
      const out = await storage.claimFreeTrial(d.ownerWallet);
      res.json(out);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to claim trial" });
    }
  });

  // POST /api/credits/intent — quote how much SOL the user must pay for a pack
  // at the current SOL/USD rate. The quote is informational; verify() re-quotes
  // at confirmation time within a tolerance band so a slightly-stale intent
  // still settles.
  app.post("/api/credits/intent", async (req, res) => {
    const packId = String(req.body?.packId ?? "");
    try {
      const q = await quotePackLamports(packId);
      res.json({
        packId:              q.pack!.id,
        priceUsd:            q.pack!.priceUsd,
        credits:             q.pack!.credits,
        unlimitedSubwallets: q.pack!.unlimitedSubwallets,
        unlimitedDurationMs: q.pack!.unlimitedDurationMs ?? null,
        solPriceUsd:         q.solPriceUsd,
        lamports:            q.lamports.toString(),
        treasury:            getTreasuryAddress(),
        expiresAtMs:         q.expiresAtMs,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to quote pack" });
    }
  });

  // POST /api/credits/verify — verify the on-chain payment and grant credits.
  // Idempotent on txSignature.
  app.post("/api/credits/verify", async (req, res) => {
    const txSignature = String(req.body?.txSignature ?? "");
    const ownerWallet = String(req.body?.ownerWallet ?? "");
    const packId      = String(req.body?.packId ?? "");
    try {
      const out = await verifyAndGrant({ txSignature, ownerWallet, packId });
      res.json(out);
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Verification failed" });
    }
  });

  // NOTE: there is intentionally no unauthenticated POST /api/credits/consume
  // endpoint. The only debit path is /api/pump/bump-{buy,sell}-tx, which
  // requires a signed consume-auth token and a delegation binding (or owner
  // self-signature). Without that, anyone could spam this endpoint with a
  // victim's wallet and drain their credits.

  // ─── Buyback Pool — admin one-click swap ─────────────────────────────────
  // No explicit auth gate: writes are protected cryptographically — only the
  // treasury keypair holder can produce a swap tx signed by the treasury,
  // and the execute endpoint refuses any signature whose fee-payer/signer
  // isn't the treasury wallet. Reads expose nothing not already public on
  // /api/buyback/stats.
  const { listPendingForAdmin, buildBuybackSwap, verifyAndMarkExecuted, recordManualBuyback } =
    await import("../buyback-admin");

  app.get("/api/buyback/admin/pending", async (req, res) => {
    try {
      // No browser/CDN caching — admin must always see live state.
      res.setHeader("Cache-Control", "no-store, max-age=0");
      const chain = req.query.chain === "bnb" ? "bnb" : "solana";
      const data = await listPendingForAdmin(chain);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load pending rows" });
    }
  });

  app.post("/api/buyback/admin/build-swap", async (req, res) => {
    try {
      const { rowIds, slippageBps, chain } = req.body || {};
      if (!Array.isArray(rowIds) || rowIds.length === 0) {
        return res.status(400).json({ error: "rowIds[] required" });
      }
      // buildBuybackSwap re-derives lamports from the DB (never trusts the
      // client) AND issues a server-bound nonce embedded in the swap's memo.
      const out = await buildBuybackSwap({ rowIds, slippageBps, chain: chain === "bnb" ? "bnb" : "solana" });
      res.json(out);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "Failed to build swap" });
    }
  });

  app.post("/api/buyback/admin/record-manual", async (req, res) => {
    try {
      const { signature, chain } = req.body || {};
      if (typeof signature !== "string") {
        return res.status(400).json({ error: "signature (string) required" });
      }
      const out = await recordManualBuyback({ signature, chain: chain === "bnb" ? "bnb" : "solana" });
      res.json(out);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "Failed to record manual buyback" });
    }
  });

  app.post("/api/buyback/admin/execute", async (req, res) => {
    try {
      const { signature, nonce } = req.body || {};
      if (typeof signature !== "string" || typeof nonce !== "string") {
        return res.status(400).json({ error: "signature (string) and nonce (string) required" });
      }
      const out = await verifyAndMarkExecuted({ signature, nonce });
      res.json(out);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "Failed to mark executed" });
    }
  });

  app.all(/^\/api\/community-buybacks(?:\/.*)?$/, (_req, res) => {
    res.status(404).json({ error: "Community Buybacks has been removed." });
  });

  // ─── Buyback Pool — public, read-only ─────────────────────────────────────
  // No auth: this endpoint exists specifically to be verifiable by anyone.
  // Owner wallets are NOT exposed; only the ledger's revenue/allocation/
  // status fields plus aggregate totals.
  app.get("/api/buyback/stats", async (req, res) => {
    try {
      // No browser/CDN caching — public ledger must always reflect live DB
      // state, otherwise users see stale "pending" totals long after we've
      // executed (or after a DB reset).
      res.setHeader("Cache-Control", "no-store, max-age=0");
      const chain = req.query.chain === "bnb" ? "bnb" : "solana";
      const [stats, recent] = await Promise.all([
        storage.getBuybackStats(chain),
        storage.getRecentBuybackEntries(25, chain),
      ]);
      res.json({
        pool: {
          name:           BUYBACK_POOL_NAME,
          blurb:          BUYBACK_POOL_BLURB,
          allocationBps:  BUYBACK_ALLOCATION_BPS,
          treasury:       getTreasuryAddress(),
          // Status is "tracking" until the first executed swap lands.
          // Frontend uses this to render the "tracking only — buybacks not
          // yet active" banner without hard-coding the date.
          phase:          stats.totalExecutedLamports === "0" ? "tracking" : "active",
        },
        stats,
        recent,
        fetchedAt: Date.now(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load buyback stats" });
    }
  });

  return httpServer;
}
