// ─── Swing Bot routes — owner-gated, mirrors the arb-executor pattern ────────
// Writes are ed25519-signed by the owner wallet (namespace paif-swing|v1) with
// single-use nonces; reads use a short-lived HMAC token in x-swing-token.
// publicStrategy NEVER returns the encrypted worker key.

import type { Express } from "express";
import { createHmac } from "node:crypto";
import { createSwingStrategySchema } from "@workspace/db";
import { storage } from "./storage";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getMarketWeather } from "./market-weather";
import {
  generateSwingWorkerWallet,
  tryActivateSwingStrategy,
  pauseSwingStrategy,
  stopAndWithdrawSwingStrategy,
  manualSellSwingPosition,
  manualBuyMoreSwingPosition,
  manualSwapSwingPosition,
  manualBuyMintNow,
  approveBuySignal,
  dismissBuySignal,
  assessBuyNow,
  scannerTokenCheck,
  getCandles,
  manualBuyWatchToken,
  getSwingSolBalance,
  workerHoldsTokens,
  runUnderStrategyLock,
  stopSettleAndDeletePaperSwingStrategy,
  isSwingConfigured,
  issueSwingReadToken,
  verifySwingReadToken,
  getTokenStats,
  SWING_HARD_MAX_BUDGET_LAMPORTS,
  swingTierFeeBps,
  generateExtraSwingWallets,
  SWING_MAX_SUB_WALLETS,
} from "./swing-executor";
import { getSolPriceUsd } from "./arb-executor";
import { getVerifiedTokenizedStock } from "./tokenized-stocks";

const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ACTION_SIG_MAX_AGE_MS = 5 * 60 * 1000;
const GUEST_TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;
// "Unlimited" run sentinel: ~100 years out. All window-end checks compare
// against windowEndAt, so a far-future date simply never triggers them.
const UNLIMITED_WINDOW_MS = 100 * 365 * 24 * 3600_000;

function publicStrategy(s: any) {
  const smartScan = !s.targetMint && s.universe !== "stocks";
  return {
    id: s.id,
    ownerWallet: s.ownerWallet,
    workerWallet: s.workerWallet,
    // Sub-wallet PUBLIC keys only — encrypted keys never leave the server.
    subWalletCount: s.subWalletCount ?? 1,
    extraWallets: s.extraWallets ?? [],
    feeBps: s.feeBps ?? 160,
    withdrawAddress: s.withdrawAddress,
    name: s.name,
    favorite: s.favorite ?? false,
    mode: s.mode,
    universe: s.universe ?? "crypto",
    // Crypto scanners now use one combined Smart mix. Normalize legacy stored
    // style values at the API boundary so creation/settings never expose the
    // retired single-pattern choice.
    style: !s.targetMint && s.universe !== "stocks" ? "quick" : (s.style ?? "quick"),
    targetMint: s.targetMint ?? null,
    manualBuy: s.manualBuy ?? false,
    reentry: s.reentry ?? false,
    requireApproval: s.requireApproval ?? false,
    rebuyMints: s.rebuyMints ?? [],
    blockedMints: s.blockedMints ?? [],
    status: s.status,
    restartedAt: s.restartedAt ?? null,
    budgetLamports: s.budgetLamports,
    paperBankrollLamports: s.paperBankrollLamports,
    windowEndAt: s.windowEndAt,
    unlimitedWindow: s.unlimitedWindow ?? false,
    activeMsTotal: s.activeMsTotal ?? "0",
    activeSince: s.activeSince ?? null,
    maxPositions: s.maxPositions,
    allowStacking: s.allowStacking,
    hotStreakFullSize: s.hotStreakFullSize ?? false,
    minPoolAgeHours: s.minPoolAgeHours ?? null,
    // Fixed scanner targets are owner-selected settings and must round-trip to
    // the UI; null alone means the adaptive automatic small-win plan.
    takeProfitPct: s.takeProfitPct ?? null,
    // Legacy scanner rows may still have steady-wins stored. Smart mix no longer
    // exposes or uses that reactive preset; null stopRoom means adaptive exits.
    conservativeProfit: smartScan ? false : (s.conservativeProfit ?? false),
    neverSellAtLoss: s.neverSellAtLoss ?? false,
    redEndBehavior: s.redEndBehavior ?? "sell",
    momentumCycle: s.momentumCycle ?? false,
    rotateToRunners: smartScan ? true : (s.rotateToRunners ?? false),
    stopLossPct: s.stopLossPct,
    stopRoomPct: s.stopRoomPct ?? null,
    sellOffCutEnabled: smartScan ? false : (s.sellOffCutEnabled ?? false),
    winnerKeepPct: s.winnerKeepPct ?? null,
    profitSkimPct: s.profitSkimPct ?? 50,
    bankedLamports: s.bankedLamports ?? "0",
    trailArmPct: s.trailArmPct,
    trailPct: s.trailPct,
    maxHoldHours: s.maxHoldHours,
    minLiquidityUsd: s.minLiquidityUsd,
    slippageBps: s.slippageBps,
    lossStopCount: s.lossStopCount,
    consecutiveLosses: s.consecutiveLosses,
    lossCooldownUntil: s.lossCooldownUntil ?? null,
    tradesExecuted: s.tradesExecuted,
    wins: s.wins,
    realizedPnlLamports: s.realizedPnlLamports,
    feesPaidLamports: s.feesPaidLamports ?? "0",
    nextRunAt: s.nextRunAt,
    lastScanAt: s.lastScanAt ?? null,
    lastScanNote: s.lastScanNote ?? null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export const publicSwingStrategy = publicStrategy;

export function takeProfitSettingsPatch(
  currentTakeProfitPct: number | null,
  requestedTakeProfitPct: unknown,
): { patch: { takeProfitPct?: number | null }; change?: string; error?: string } {
  if (requestedTakeProfitPct === undefined) return { patch: {} };
  if (requestedTakeProfitPct === null) {
    return currentTakeProfitPct === null
      ? { patch: {} }
      : {
          patch: { takeProfitPct: null },
          change: "Auto-sell target turned OFF — the bot no longer banks at a fixed profit; it rides its normal exits instead.",
        };
  }
  const takeProfitPct = Math.round(Number(requestedTakeProfitPct));
  if (!Number.isFinite(takeProfitPct) || takeProfitPct < 3 || takeProfitPct > 500) {
    return { patch: {}, error: "Auto-sell target must be a whole number between 3 and 500%." };
  }
  return takeProfitPct === currentTakeProfitPct
    ? { patch: {} }
    : {
        patch: { takeProfitPct },
        change: `Auto-sell target set to +${takeProfitPct}% — the bot now banks the win the moment a trade is up ${takeProfitPct}%. Applies to open positions right away (any position already past +${takeProfitPct}% is sold on the next check).`,
      };
}

const usedSignatures = new Map<string, number>();
function consumeSignature(sig: string): boolean {
  const now = Date.now();
  if (usedSignatures.size > 2000) {
    usedSignatures.forEach((exp, k) => {
      if (exp < now) usedSignatures.delete(k);
    });
  }
  const existing = usedSignatures.get(sig);
  if (existing && existing > now) return false;
  usedSignatures.set(sig, now + ACTION_SIG_MAX_AGE_MS);
  return true;
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

function actionMessage(d: { action: string; strategyId: string; ownerWallet: string; nonce: number }): Uint8Array {
  return new TextEncoder().encode(
    ["paif-swing", "v1", d.action, d.strategyId, d.ownerWallet, String(d.nonce)].join("|"),
  );
}
function createMessage(d: { ownerWallet: string; nonce: number }): Uint8Array {
  return new TextEncoder().encode(
    ["paif-swing", "v1", "create", d.ownerWallet, String(d.nonce)].join("|"),
  );
}
function readSessionMessage(d: { ownerWallet: string; nonce: number }): Uint8Array {
  return new TextEncoder().encode(
    ["paif-swing", "v1", "read-session", d.ownerWallet, String(d.nonce)].join("|"),
  );
}

async function authorizeAction(
  action: string,
  strategy: { id: string; ownerWallet: string; mode?: string },
  body: any,
): Promise<{ code: number; error: string } | null> {
  if (body?.guestToken !== undefined) {
    const guestOwner = guestOwnerFromToken(body.guestToken);
    if (!guestOwner) return { code: 401, error: "This guest session is invalid. Refresh and try again." };
    if (strategy.mode === "live") return { code: 403, error: "Guest access is limited to paper bots." };
    if (guestOwner !== strategy.ownerWallet) return { code: 403, error: "This paper bot belongs to another browser." };
    return null;
  }
  const { ownerWallet, nonce, signature } = body ?? {};
  if (ownerWallet !== strategy.ownerWallet) return { code: 403, error: "Owner wallet mismatch." };
  if (typeof nonce !== "number" || typeof signature !== "string") {
    return { code: 401, error: "Signed authorization required." };
  }
  if (Math.abs(Date.now() - nonce) > ACTION_SIG_MAX_AGE_MS) {
    return { code: 401, error: "Authorization expired — please retry." };
  }
  const ok = await verifyEd25519(
    strategy.ownerWallet,
    signature,
    actionMessage({ action, strategyId: strategy.id, ownerWallet: strategy.ownerWallet, nonce }),
  );
  if (!ok) return { code: 401, error: "Invalid signature — must be signed by the owner wallet." };
  if (!consumeSignature(signature)) return { code: 401, error: "This authorization was already used — please retry." };
  return null;
}

function readTokenOwner(req: any): string | null {
  const token = req.headers["x-swing-token"];
  if (typeof token !== "string" || !token) return null;
  return verifySwingReadToken(token);
}

function guestOwnerFromToken(token: unknown): string | null {
  if (typeof token !== "string" || !GUEST_TOKEN_REGEX.test(token)) return null;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const seed = createHmac("sha256", secret).update(`paif-swing-guest|v1|${token}`).digest();
  return Keypair.fromSeed(seed).publicKey.toBase58();
}

function guestTokenFromRequest(req: any): string | null {
  const token = req.headers["x-swing-guest"];
  return typeof token === "string" ? token : null;
}

function authorizedReadOwner(req: any): string | null {
  const guestToken = guestTokenFromRequest(req);
  if (guestToken) return guestOwnerFromToken(guestToken);
  return readTokenOwner(req);
}

type PerformanceRow = Awaited<ReturnType<typeof storage.listSwingPerformance>>[number];

function aggregatePerformance(rows: PerformanceRow[]) {
  const groups = new Map<string, {
    style: string; settings: Record<string, unknown>; bots: number;
    trades: number; wins: number; pnl: bigint; paperBots: number; liveBots: number;
  }>();
  for (const row of rows) {
    // Crypto recommendations and the public crypto leaderboard must never be
    // trained by tokenized-stock paper results. Stock performance remains
    // visible to its owner through personal history.
    if (row.trades <= 0 || row.settings.botKind !== "scan" || row.settings.universe === "stocks") continue;
    const key = `${row.style}|${JSON.stringify(row.settings)}`;
    const group = groups.get(key) ?? {
      style: row.style, settings: row.settings, bots: 0,
      trades: 0, wins: 0, pnl: 0n, paperBots: 0, liveBots: 0,
    };
    group.bots += 1;
    group.trades += row.trades;
    group.wins += row.wins;
    group.pnl += BigInt(row.realizedPnlLamports || "0");
    if (row.mode === "live") group.liveBots += 1;
    else group.paperBots += 1;
    groups.set(key, group);
  }
  return [...groups.values()].map((g) => ({
    style: g.style,
    settings: g.settings,
    bots: g.bots,
    trades: g.trades,
    wins: g.wins,
    winRate: g.trades ? Math.round((g.wins / g.trades) * 1000) / 10 : 0,
    realizedPnlLamports: g.pnl.toString(),
    paperBots: g.paperBots,
    liveBots: g.liveBots,
  }));
}

export function registerSwingRoutes(app: Express): void {
  // Create a swing bot. Worker wallet generated server-side.
  app.post("/api/swing-bot/create", async (req, res) => {
    if (!isSwingConfigured()) {
      return res.status(503).json({ error: "The swing bot isn't fully configured yet." });
    }
    const guestToken = guestTokenFromRequest(req);
    const guestOwner = guestToken ? guestOwnerFromToken(guestToken) : null;
    if (guestToken && !guestOwner) {
      return res.status(401).json({ error: "This guest session is invalid. Refresh and try again." });
    }
    if (guestOwner && req.body?.mode !== "paper") {
      return res.status(403).json({ error: "Guest access is limited to paper bots. Connect a wallet to go live." });
    }
    const parsed = createSwingStrategySchema.safeParse(
      guestOwner ? { ...req.body, ownerWallet: guestOwner, mode: "paper" } : req.body,
    );
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
    }
    const d = parsed.data;
    if (d.mode === "paper" && !guestOwner) {
      const access = await storage.getAccessPass(d.ownerWallet);
      if (!access.active) {
        return res.status(402).json({
          error: "Paper Swing Bot requires an active Access Pass or your one-time 3-day trial.",
          code: "ACCESS_PASS_REQUIRED",
        });
      }
    }
    if (!guestOwner) {
      const { nonce, signature } = req.body ?? {};
      if (typeof nonce !== "number" || typeof signature !== "string") {
        return res.status(401).json({ error: "Signed authorization required." });
      }
      if (Math.abs(Date.now() - nonce) > ACTION_SIG_MAX_AGE_MS) {
        return res.status(401).json({ error: "Authorization expired — please retry." });
      }
      const ok = await verifyEd25519(d.ownerWallet, signature, createMessage({ ownerWallet: d.ownerWallet, nonce }));
      if (!ok) return res.status(401).json({ error: "Invalid signature — must be signed by the owner wallet." });
      if (!consumeSignature(signature)) {
        return res.status(401).json({ error: "This authorization was already used — please retry." });
      }
    }
    try {
      let budgetLamports = BigInt(Math.round(d.budgetSol * LAMPORTS_PER_SOL));
      if (d.mode === "live" && budgetLamports > SWING_HARD_MAX_BUDGET_LAMPORTS) {
        budgetLamports = SWING_HARD_MAX_BUDGET_LAMPORTS;
      }
      if (budgetLamports < 10_000_000n) {
        return res.status(400).json({ error: "Budget must be at least 0.01 SOL for swing trading to clear fees." });
      }
      // Watch mode: verify the chosen token actually has a live market BEFORE
      // creating anything — a typo'd mint would otherwise sit retrying forever.
      const watch = !!d.targetMint;
      let watchSymbol: string | null = null;
      const stock = d.universe === "stocks" && watch
        ? await getVerifiedTokenizedStock(d.targetMint ?? "")
        : null;
      if (d.universe === "stocks" && watch && !stock) {
        return res.status(400).json({ error: "Choose a verified stock with an available market price." });
      }
      if (watch) {
        const stats = await getTokenStats(d.targetMint!);
        if (!stats || stats.priceUsd <= 0) {
          return res.status(400).json({ error: d.universe === "stocks"
            ? "This verified stock does not have a usable market price right now. Pick another stock and try again."
            : "Couldn't find a live market for that token address — double-check the mint (copy it from the scanner or DexScreener)." });
        }
        watchSymbol = stock?.tokenSymbol || stats.symbol;
      }
      const worker = generateSwingWorkerWallet();
      // Watch mode runs as "ride" so the seller-takeover and volume-collapse
      // exit tells apply — that's the "knows when to sell" the user asked for.
      // Scanning bots always use the combined Smart mix. The persisted "quick"
      // value is retained for schema compatibility; it no longer means the bot
      // only searches for rising-now entries.
      const style = d.universe === "stocks" ? "ride" : watch ? "ride" : "quick";
      // PER-USER loyalty fee tier locked ONCE at create time from the owner's
      // TOTAL live deposits across every bot: 1.6% Standard, 1.3% Premium at
      // $10k+, 1% VIP at $25k+. Paper deposits are virtual and never count
      // toward the real-money total, but a new paper bot still inherits the
      // tier the owner's live deposits already earned (paper mirrors the real
      // deal). Price lookup fails soft to the 1.6% default (getSolPriceUsd
      // returns 0 when unknown) — a pricing API hiccup must never block bot
      // creation or hand out a discount.
      // Basis = each live strategy's CONFIGURED budget (budgetLamports), not its
      // live funded balance — a "deposit" is the amount the user committed.
      // Concurrency caveat (accepted): this read isn't transactional, so two
      // simultaneous creates for one owner could both see the pre-create total
      // and lock a slightly LOWER tier. It fails user-unfavorable (never an
      // unearned discount) and self-heals on the next bot — not worth an
      // owner-scoped DB lock for a sub-second, non-harmful edge.
      let feeBps = 160;
      try {
        const solUsd = await getSolPriceUsd();
        if (solUsd > 0) {
          const existing = await storage.listSwingStrategiesByOwner(d.ownerWallet);
          let totalLamports = existing
            .filter((s) => s.mode === "live")
            .reduce((sum, s) => sum + BigInt(s.budgetLamports), 0n);
          if (d.mode === "live") totalLamports += budgetLamports;
          const totalUsd = (Number(totalLamports) / LAMPORTS_PER_SOL) * solUsd;
          feeBps = swingTierFeeBps(totalUsd);
        }
      } catch {
        // keep the 1.6% default
      }
      // Multi-sub-wallet DCA: watch bots + Long ride only (the styles that
      // hold ONE conviction token and benefit from averaging in/out). Other
      // styles stay single-wallet no matter what the client sends.
      const dcaEligible = watch || style === "ride";
      const subWalletCount = dcaEligible
        ? Math.max(1, Math.min(d.subWalletCount ?? 1, SWING_MAX_SUB_WALLETS))
        : 1;
      // Live: generate the extra worker wallets now (same AES-256-GCM custody
      // as the primary). Paper simulates tranches without real extra wallets.
      const extras = d.mode === "live" && subWalletCount > 1
        ? generateExtraSwingWallets(subWalletCount - 1)
        : { pubkeys: [], encryptedKeys: [] };
      // Watch + "Hold it long": the client sends style "ride" alongside
      // targetMint when the user flips the hold-long toggle — they want
      // ride's wide-runner numbers on their own token (trail arms at +60%,
      // gives back 30%) instead of the tight babysit protection. The stored
      // style is "ride" in both cases (the seller-takeover exit tells always
      // apply); only the default knobs differ.
      const watchLong = watch && d.style === "ride";
      const status = d.mode === "live" ? "awaiting_funds" : "active";
      // Unlimited run: windowEndAt gets a far-future sentinel (100 years) so
      // every existing window-end check works unchanged; the flag drives the UI.
      const unlimited = d.unlimitedWindow === true;
      const windowEndAt = unlimited
        ? new Date(Date.now() + UNLIMITED_WINDOW_MS)
        : new Date(Date.now() + d.windowHours * 3600_000);
      const feePctText = `${(feeBps / 100).toFixed(1).replace(/\.0$/, "")}%`;
      const paperFeeLamports = d.mode === "paper"
        ? (budgetLamports * BigInt(feeBps)) / 10_000n
        : 0n;

      const strategy = await storage.createSwingStrategy({
        ownerWallet: d.ownerWallet,
        workerWallet: worker.pubkey,
        encryptedKey: worker.encryptedKey,
        subWalletCount,
        extraWallets: extras.pubkeys,
        extraEncryptedKeys: extras.encryptedKeys,
        feeBps,
        withdrawAddress: d.ownerWallet,
        name: d.name ?? (d.universe === "stocks"
          ? (watch ? `Watch ${watchSymbol}` : "xStocks Momentum Bot")
          : watch ? `Watch ${watchSymbol}` : d.mode === "live" ? "Live Swing Bot" : "Paper Swing Bot"),
        mode: d.mode,
        universe: d.universe ?? "crypto",
        style,
        targetMint: d.targetMint ?? null,
        // Manual buy + comeback re-entry only make sense in watch mode — a
        // scanning bot picks its own entries and re-buys via cooldowns.
        manualBuy: watch ? (d.manualBuy ?? false) : false,
        reentry: watch ? (d.reentry ?? false) : false,
        // "Ask me first" only applies to a scanning bot — a watch bot already
        // has its own manual-buy flag.
        // New scanners default to owner approval so a person can inspect the
        // pick and chart before any buy. Existing bots keep their stored value.
        requireApproval: watch ? false : (d.requireApproval ?? true),
        status,
        budgetLamports: budgetLamports.toString(),
        paperBankrollLamports: d.mode === "paper" ? (budgetLamports - paperFeeLamports).toString() : "0",
        windowEndAt,
        unlimitedWindow: unlimited,
        // Paper starts active immediately — its lifetime clock starts now.
        // Live starts the clock when the bot first activates.
        activeSince: status === "active" ? new Date() : null,
        // Watch mode is single-position by definition.
        // Scanning bots start with three positions. The performance endpoint
        // may recommend another value, but always keeps learned defaults in
        // the user-requested two-to-four position range.
        maxPositions: watch ? 1 : (d.maxPositions ?? 3),
        allowStacking: watch ? false : (d.allowStacking ?? false),
         hotStreakFullSize: watch ? false : (d.hotStreakFullSize ?? false),
        // Minimum-age dial (scanning bots): 0 = "Be wild" (fresh launches
        // allowed) up to 720h. New-bot default is 24h — a full day of history
        // filters most quick rugs while still catching young runners. Watch
        // mode targets one owner-chosen token, so the dial doesn't apply
        // (null = engine's legacy floor for its judge calls).
        minPoolAgeHours: watch ? null : Math.max(0, Math.min(720, Math.round(d.minPoolAgeHours ?? 24))),
        // Null keeps the adaptive Smart mix. Any owner-entered target applies
        // to scanners, watch bots, and verified-stock paper bots.
        takeProfitPct: d.takeProfitPct ?? null,
        // Smart mix is patient and evidence-led by default. The old steady-wins
        // preset used a reactive −3% stop and is retired for scanner creation.
        conservativeProfit: false,
        // Recovery hold is owner-controlled for every bot style. The executor
        // still keeps its firm emergency and confirmed-breakdown backstops.
        neverSellAtLoss: d.neverSellAtLoss ?? false,
        // Run-end fate of a still-red position: sell anyway (default) or send
        // the tokens themselves home instead of ever selling below cost.
        redEndBehavior: d.redEndBehavior === "send_tokens" ? "send_tokens" : "sell",
        // Momentum cycle only makes sense on LONG holds — Watch with "Hold it
        // long" on (watchLong), or the Long ride scan style. A tight babysit
        // watch bot is single-shot by design (it also persists style "ride"),
        // so gate on watchLong — NOT the persisted style — to keep it out.
        // Normalize to false everywhere else so the persisted config never lies.
        momentumCycle: (watchLong || (!watch && style === "ride")) ? (d.momentumCycle ?? false) : false,
        // Runner rotation only makes sense for a multi-position SCAN bot (it
        // rotates capital between HELD names) — never for a single-position
        // watch bot. Normalize to false for watch so the persisted config
        // never lies.
        rotateToRunners: !watch && d.universe !== "stocks",
        // Watch defaults (user's runner protection): stop-loss 15% before the
        // run starts; the profit lock arms at +15% and gives back at most 20%
        // from the peak — a runner can never round-trip back to your entry.
        // "ride" = hold-long defaults: wider stop, much wider trail, week-long
        // holds — the volume-collapse signal (in the engine) leads the exit.
        // "dip" = contrarian recovery play: entries are already down hard, so
        // the stop is wider (20%) to survive the wobble near the bottom; the
        // profit lock arms at +40% and gives back 20% — recovery bounces are
        // usually one big leg, not a slow grind.
        stopLossPct: d.stopLossPct ?? (watch ? 15 : 4.5),
        // Owner-chosen stop room only applies to the quick scan style (the
        // engine ignores it everywhere else) — normalize to null elsewhere so
        // the persisted config never lies. Whitelist of preset widths only.
        stopRoomPct: !watch && style === "quick" && Number.isFinite(Number(d.stopRoomPct)) && Number(d.stopRoomPct) >= 2 && Number(d.stopRoomPct) <= 50 ? Math.round(Number(d.stopRoomPct)) : null,
        // A chosen percentage is absolute by default. Owners can separately
        // opt into the evidence-based sell-off cut if they want it.
        sellOffCutEnabled: typeof d.sellOffCutEnabled === "boolean" ? d.sellOffCutEnabled : false,
        // Winner room only applies to the quick scan style; null = smart
        // default (keep 60% of the best gain — the fast-bank safest choice).
        winnerKeepPct: !watch && style === "quick" && Number.isFinite(Number(d.winnerKeepPct)) && Number(d.winnerKeepPct) >= 40 && Number(d.winnerKeepPct) <= 90 ? Math.round(Number(d.winnerKeepPct)) : null,
         // Keep the set-aside choice from creation in the same persisted field
         // that the running-bot editor updates.
         profitSkimPct: Number.isFinite(Number(d.profitSkimPct)) && Number(d.profitSkimPct) >= 0 && Number(d.profitSkimPct) <= 100
           ? Math.round(Number(d.profitSkimPct))
           : 50,
        // Quick = in-and-out: profit lock arms at +12%, gives back 8%, 24h max
        // hold (the engine also caps quick at these values at judgment time).
        trailArmPct: d.trailArmPct ?? (watch ? (watchLong ? 60 : 15) : 12),
        trailPct: d.trailPct ?? (watch ? (watchLong ? 30 : 20) : 8),
        // A position's time limit follows the bot's run duration. Unlimited
        // strategies ignore this stored value in the executor.
        maxHoldHours: d.windowHours,
        // Default = the RECOMMENDED setup (user's own live data, July 2026:
        // $100k+ pools had the best win rate ~34% vs 19-25% below). Watch bots
        // keep the low floor — they trade one token the owner already chose.
        minLiquidityUsd: d.minLiquidityUsd ?? (watch ? 20000 : 40000),
        slippageBps: d.slippageBps ?? 150,
        lossStopCount: d.lossStopCount ?? 4,
        nextRunAt: status === "active" ? new Date() : null,
      });

      let created = strategy;
      if (d.mode === "paper" && paperFeeLamports > 0n) {
        created = await storage.updateSwingStrategy(strategy.id, {
          feesPaidLamports: paperFeeLamports.toString(),
        }) ?? strategy;
        await storage.addSwingEvent({
          strategyId: created.id,
          positionId: null,
          kind: "info",
          mint: null,
          symbol: null,
          detail: `Paper platform fee applied: ${feePctText} of the starting bankroll (${(Number(paperFeeLamports) / LAMPORTS_PER_SOL).toFixed(5)} SOL), matching live-mode accounting.`,
          solLamports: paperFeeLamports.toString(),
        });
      }

      // Recommended funding = budget + 0.008 SOL buy headroom PER trading
      // wallet (wSOL + token account rents plus priority fees — without it,
      // a wallet funded to exactly the budget can never clear buy simulation).
      const recommendedFundingLamports = budgetLamports + 8_000_000n * BigInt(subWalletCount);
      res.json({
        strategy: publicStrategy(created),
        fundingAddress: worker.pubkey,
        recommendedFundingSol: d.mode === "live" ? Number(recommendedFundingLamports) / LAMPORTS_PER_SOL : 0,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to create swing bot" });
    }
  });

  // Token preview for watch mode — public read, served from the executor's
  // 60s stats cache so repeat lookups of the same mint can't hammer
  // DexScreener. On top of the cache: per-IP + global rate limits, because
  // random high-cardinality mints would each miss the cache and force an
  // outbound call.
  const previewIpHits = new Map<string, { count: number; resetAt: number }>();
  let previewGlobal = { count: 0, resetAt: 0 };
  const PREVIEW_IP_LIMIT = 30; // per IP per minute
  const PREVIEW_GLOBAL_LIMIT = 300; // across all IPs per minute
  // Market weather — plain FACTS about the broad market (BTC + SOL 24h), no
  // advice. Public + safe: the module caches 5 min server-side, so this can't
  // be used to hammer CoinGecko.
  app.get("/api/swing-bot/market-weather", async (_req, res) => {
    const w = await getMarketWeather();
    if (!w) return res.status(200).json({ available: false });
    res.json({ available: true, ...w });
  });

  app.get("/api/swing-bot/token-preview/:mint", async (req, res) => {
    const now = Date.now();
    if (now >= previewGlobal.resetAt) previewGlobal = { count: 0, resetAt: now + 60_000 };
    if (++previewGlobal.count > PREVIEW_GLOBAL_LIMIT) {
      return res.status(429).json({ error: "Too many lookups right now — try again in a minute." });
    }
    const ip = (String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()) || req.socket.remoteAddress || "?";
    if (previewIpHits.size > 5000) {
      previewIpHits.forEach((v, k) => { if (now >= v.resetAt) previewIpHits.delete(k); });
    }
    const hit = previewIpHits.get(ip);
    if (!hit || now >= hit.resetAt) {
      previewIpHits.set(ip, { count: 1, resetAt: now + 60_000 });
    } else if (++hit.count > PREVIEW_IP_LIMIT) {
      return res.status(429).json({ error: "Too many lookups — try again in a minute." });
    }
    const mint = String(req.params.mint || "");
    if (!SOLANA_ADDRESS_REGEX.test(mint)) {
      return res.status(400).json({ error: "That doesn't look like a Solana token address." });
    }
    try {
      const s = await getTokenStats(mint);
      if (!s || s.priceUsd <= 0) {
        return res.status(404).json({ error: "No live market found for that token address." });
      }
      res.json({
        mint: s.mint,
        symbol: s.symbol,
        name: s.name,
        priceUsd: s.priceUsd,
        liquidityUsd: s.liquidityUsd,
        volH1Usd: s.volH1Usd,
        chgH1: s.chgH1,
        chgH24: s.chgH24,
        buysH1: s.buysH1,
        sellsH1: s.sellsH1,
      });
    } catch {
      res.status(502).json({ error: "Couldn't reach market data right now — try again in a moment." });
    }
  });

  // Batch token names — one lookup for a whole watchlist so the UI can show the
  // token NAME/symbol instead of a raw contract address. Read-only, cached
  // server-side by getTokenStats, and rate-limited on the same counters as the
  // single preview. Bounded to a sane number of mints per call.
  app.get("/api/swing-bot/token-names", async (req, res) => {
    const now = Date.now();
    if (now >= previewGlobal.resetAt) previewGlobal = { count: 0, resetAt: now + 60_000 };
    if (++previewGlobal.count > PREVIEW_GLOBAL_LIMIT) {
      return res.status(429).json({ error: "Too many lookups right now — try again in a minute." });
    }
    const ip = (String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()) || req.socket.remoteAddress || "?";
    if (previewIpHits.size > 5000) {
      previewIpHits.forEach((v, k) => { if (now >= v.resetAt) previewIpHits.delete(k); });
    }
    const hit = previewIpHits.get(ip);
    if (!hit || now >= hit.resetAt) {
      previewIpHits.set(ip, { count: 1, resetAt: now + 60_000 });
    } else if (++hit.count > PREVIEW_IP_LIMIT) {
      return res.status(429).json({ error: "Too many lookups — try again in a minute." });
    }
    const raw = String((req.query.mints as string) || "");
    const mints = Array.from(new Set(raw.split(",").map((m) => m.trim()).filter((m) => SOLANA_ADDRESS_REGEX.test(m)))).slice(0, 30);
    const out: Record<string, { symbol: string; name: string | null }> = {};
    await Promise.all(mints.map(async (mint) => {
      try {
        const st = await getTokenStats(mint);
        if (st && st.priceUsd > 0) out[mint] = { symbol: st.symbol, name: st.name };
      } catch { /* fail-soft: a missing name just falls back to the address */ }
    }));
    res.json(out);
  });

  // Mint a read-session token (owner signs once).
  app.post("/api/swing-bot/auth", async (req, res) => {
    if (!isSwingConfigured()) {
      return res.status(503).json({ error: "The swing bot is not enabled yet." });
    }
    try {
      const { ownerWallet, nonce, signature } = req.body ?? {};
      if (!SOLANA_ADDRESS_REGEX.test(String(ownerWallet ?? ""))) {
        return res.status(400).json({ error: "A valid owner wallet is required." });
      }
      if (typeof nonce !== "number" || typeof signature !== "string") {
        return res.status(401).json({ error: "Signed authorization required." });
      }
      if (Math.abs(Date.now() - nonce) > ACTION_SIG_MAX_AGE_MS) {
        return res.status(401).json({ error: "Authorization expired — please retry." });
      }
      const ok = await verifyEd25519(ownerWallet, signature, readSessionMessage({ ownerWallet, nonce }));
      if (!ok) return res.status(401).json({ error: "Invalid signature." });
      res.json({ token: issueSwingReadToken(ownerWallet) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to authorize" });
    }
  });

  // List a wallet's swing bots. Read-token gated.
  app.get("/api/swing-bot/list", async (req, res) => {
    const guestOwner = guestOwnerFromToken(guestTokenFromRequest(req));
    const owner = guestOwner ?? String(req.query.owner ?? "");
    if (!SOLANA_ADDRESS_REGEX.test(owner)) {
      return res.status(400).json({ error: "A valid owner wallet is required." });
    }
    if (authorizedReadOwner(req) !== owner) {
      return res.status(401).json({ error: "Unlock this session to view your swing bots." });
    }
    try {
      const rows = await storage.listSwingStrategiesByOwner(owner);
      res.json({ strategies: rows.map(publicStrategy) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to list swing bots" });
    }
  });

  // Community performance is aggregate-only: no owner, bot name, wallet, or
  // trade details ever leave this endpoint. A recommendation needs at least
  // ten settled trades and positive net P&L so one lucky trade—or a high
  // win-rate strategy whose occasional losses erase its gains—cannot become
  // the default.
  app.get("/api/swing-bot/performance/defaults", async (_req, res) => {
    try {
      const groups = aggregatePerformance(await storage.listSwingPerformance());
      const qualified = groups.filter((g) => g.trades >= 10);
      const profitable = qualified.filter((g) => BigInt(g.realizedPnlLamports) > 0n);
      const byWinRate = [...profitable]
        .sort((a, b) => b.winRate - a.winRate || b.trades - a.trades);
      const byWins = [...qualified]
        .sort((a, b) => b.wins - a.wins || b.trades - a.trades || b.winRate - a.winRate);
      const byProfit = [...profitable]
        .sort((a, b) => {
          const aPnl = BigInt(a.realizedPnlLamports);
          const bPnl = BigInt(b.realizedPnlLamports);
          return aPnl === bPnl ? b.trades - a.trades : (bPnl > aPnl ? 1 : -1);
        });
      const fallback = {
        style: "quick",
        settings: {
          botKind: "scan", maxPositions: 3, allowStacking: false,
          hotStreakFullSize: false, minPoolAgeHours: 24, requireApproval: true,
          takeProfitPct: null, conservativeProfit: false, neverSellAtLoss: false,
          redEndBehavior: "sell", stopLossPct: 4.5, stopRoomPct: null,
          sellOffCutEnabled: false, winnerKeepPct: null, profitSkimPct: 50,
          trailArmPct: 12, trailPct: 8, maxHoldHours: 24,
          minLiquidityUsd: 40000, slippageBps: 150, lossStopCount: 4,
        },
        bots: 0, trades: 0, wins: 0, winRate: 0, realizedPnlLamports: "0",
        paperBots: 0, liveBots: 0,
      };
      const best = byWinRate[0] ?? fallback;
      res.json({
        minimumTrades: 10,
        recommendationAvailable: byWinRate.length > 0,
        recommended: {
          ...best,
          settings: {
            ...best.settings,
            maxPositions: Math.max(2, Math.min(4, Number(best.settings.maxPositions) || 3)),
          },
        },
        // Kept for older clients; the richer anonymous leaderboard below
        // powers the three rankings on the Swing Bot page.
        leaders: byWinRate.slice(0, 5),
        leaderboard: {
          bestWinRate: byWinRate.slice(0, 10),
          mostWins: byWins.slice(0, 10),
          mostProfitable: byProfit.slice(0, 10),
        },
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to calculate Swing Bot defaults" });
    }
  });

  // Owner-only lifetime history. Deleted bots appear from the durable summary
  // table; existing bots are calculated from their settled positions.
  app.get("/api/swing-bot/performance/history", async (req, res) => {
    const guestOwner = guestOwnerFromToken(guestTokenFromRequest(req));
    const owner = guestOwner ?? String(req.query.owner ?? "");
    if (!SOLANA_ADDRESS_REGEX.test(owner)) {
      return res.status(400).json({ error: "A valid owner wallet is required." });
    }
    if (authorizedReadOwner(req) !== owner) {
      return res.status(401).json({ error: "Unlock this session to view your bot history." });
    }
    try {
      const rows = (await storage.listSwingPerformance(owner))
        .filter((r) => r.trades > 0)
        .map((r) => ({
          strategyId: r.strategyId,
          name: r.name,
          mode: r.mode,
          style: r.style,
          status: r.status,
          settings: r.settings,
          trades: r.trades,
          wins: r.wins,
          winRate: Math.round((r.wins / r.trades) * 1000) / 10,
          realizedPnlLamports: r.realizedPnlLamports,
          createdAt: r.createdAt,
          archived: r.archived,
        }))
        .sort((a, b) =>
          b.winRate - a.winRate
          || Number(BigInt(b.realizedPnlLamports) - BigInt(a.realizedPnlLamports))
          || b.trades - a.trades
        );
      const totalTrades = rows.reduce((n, r) => n + r.trades, 0);
      const totalWins = rows.reduce((n, r) => n + r.wins, 0);
      res.json({
        summary: {
          bots: rows.length,
          trades: totalTrades,
          wins: totalWins,
          winRate: totalTrades ? Math.round((totalWins / totalTrades) * 1000) / 10 : 0,
        },
        bestBots: rows.slice(0, 10),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to load Swing Bot history" });
    }
  });

  // Detail: strategy + positions + decision feed + worker balance. Read-token gated.
  app.get("/api/swing-bot/:id", async (req, res) => {
    try {
      const s = await storage.getSwingStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Swing bot not found." });
      if (authorizedReadOwner(req) !== s.ownerWallet) {
        return res.status(401).json({ error: "Unlock this session to view this swing bot." });
      }
      const [positions, events, skims, buySignals, balance] = await Promise.all([
        storage.listSwingPositions(s.id),
        storage.listSwingEvents(s.id, 100),
        storage.listSwingSkims(s.id, 200),
        storage.listSwingBuySignals(s.id, "pending"),
        s.mode === "live" ? getSwingSolBalance(s.workerWallet).catch(() => null) : Promise.resolve(null),
      ]);
      res.json({
        strategy: publicStrategy(s),
        positions,
        events,
        skims,
        buySignals,
        workerWalletBalanceLamports: balance === null ? null : balance.toString(),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to load swing bot" });
    }
  });

  // Start / resume. Owner-gated.
  app.post("/api/swing-bot/:id/start", async (req, res) => {
    try {
      const s = await storage.getSwingStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Swing bot not found." });
      const authErr = await authorizeAction("start", s, req.body);
      if (authErr) return res.status(authErr.code).json({ error: authErr.error });
      const updated = await tryActivateSwingStrategy(s.id);
      res.json({ strategy: publicStrategy(updated) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to start swing bot" });
    }
  });

  // Pause (positions stay open, no new buys, exits also pause — said in UI). Owner-gated.
  app.post("/api/swing-bot/:id/pause", async (req, res) => {
    try {
      const s = await storage.getSwingStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Swing bot not found." });
      const authErr = await authorizeAction("pause", s, req.body);
      if (authErr) return res.status(authErr.code).json({ error: authErr.error });
      if (s.status !== "active") return res.status(400).json({ error: `Swing bot is ${s.status}, not active.` });
      const updated = await pauseSwingStrategy(s.id);
      res.json({ strategy: publicStrategy(updated) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to pause swing bot" });
    }
  });

  // Adjust settings on an existing bot. Owner-gated. Only maxPositions for
  // now — it's safe to change at any time (it only affects FUTURE buys; open
  // positions above a lowered cap simply run to their normal exits).
  app.post("/api/swing-bot/:id/settings", async (req, res) => {
    try {
      const s = await storage.getSwingStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Swing bot not found." });
      const authErr = await authorizeAction("settings", s, req.body);
      if (authErr) return res.status(authErr.code).json({ error: authErr.error });
      const body = req.body ?? {};
      const patch: { maxPositions?: number; allowStacking?: boolean; hotStreakFullSize?: boolean; minPoolAgeHours?: number; requireApproval?: boolean; minLiquidityUsd?: number; conservativeProfit?: boolean; neverSellAtLoss?: boolean; redEndBehavior?: string; takeProfitPct?: number | null; stopRoomPct?: number | null; profitSkimPct?: number; sellOffCutEnabled?: boolean; winnerKeepPct?: number | null; lossStopCount?: number; name?: string; favorite?: boolean } = {};
      const changes: string[] = [];
      // Rename — cosmetic only, so it's allowed in any status (people run
      // several bots with different settings and need to tell them apart).
      if (body.name !== undefined) {
        if (typeof body.name !== "string" || body.name.trim().length === 0 || body.name.trim().length > 40) {
          return res.status(400).json({ error: "Name must be 1–40 characters." });
        }
        const trimmed = body.name.trim();
        if (trimmed !== s.name) {
          patch.name = trimmed;
          changes.push(`Renamed this bot from “${s.name}” to “${trimmed}”.`);
        }
      }
      // Favorite star — cosmetic only (sorts the bot to the top of your list).
      if (body.favorite !== undefined) {
        if (typeof body.favorite !== "boolean") {
          return res.status(400).json({ error: "favorite must be true or false." });
        }
        if (body.favorite !== (s as any).favorite) {
          patch.favorite = body.favorite;
        }
      }
      if (body.requireApproval !== undefined) {
        if (typeof body.requireApproval !== "boolean") {
          return res.status(400).json({ error: "Ask-me-first must be true or false." });
        }
        if (s.targetMint) {
          return res.status(400).json({ error: "Ask-me-first is only available on a scanning bot." });
        }
        if (body.requireApproval !== s.requireApproval) {
          patch.requireApproval = body.requireApproval;
          changes.push(body.requireApproval
            ? "Ask-me-first turned ON — the bot still hunts and scores tokens exactly as before, but instead of buying it now files each pick for your OK. Approve to buy at the current price, or dismiss it. Open positions keep running their normal exits."
            : "Ask-me-first turned OFF — the bot is back to buying its picks automatically the moment they qualify.");
        }
      }
      if (body.minLiquidityUsd !== undefined && !s.targetMint) {
        const raw = Number(body.minLiquidityUsd);
        if (!Number.isFinite(raw) || raw < 5000 || raw > 1_000_000) {
          return res.status(400).json({ error: "Min liquidity must be a number between $5,000 and $1,000,000." });
        }
        const rounded = Math.round(raw);
        if (rounded !== s.minLiquidityUsd) {
          patch.minLiquidityUsd = rounded;
          changes.push(`Caution level changed — from now on the bot only buys tokens with at least $${rounded.toLocaleString()} in their pool (on live money, pools under $40k only qualify when the token shows strong, sustained buying). Positions already open just run to their normal exits.`);
        }
      }
      if (body.maxPositions !== undefined) {
        const raw = Number(body.maxPositions);
        if (!Number.isInteger(raw) || raw < 1 || raw > 10) {
          return res.status(400).json({ error: "Positions must be a whole number between 1 and 10." });
        }
        if (raw !== s.maxPositions) {
          patch.maxPositions = raw;
          changes.push(`Max positions changed from ${s.maxPositions} to ${raw} — future buys split the budget ${raw} way${raw === 1 ? "" : "s"}; positions already open just run to their normal exits.`);
        }
      }
      if (body.allowStacking !== undefined) {
        if (typeof body.allowStacking !== "boolean") {
          return res.status(400).json({ error: "allowStacking must be true or false." });
        }
        if (body.allowStacking !== s.allowStacking) {
          patch.allowStacking = body.allowStacking;
          changes.push(body.allowStacking
            ? "DCA stacking turned ON — if the token it already holds keeps scoring strongest, the bot may use a free slot to buy MORE of it (each tranche with its own stop and exit)."
            : "DCA stacking turned OFF — every slot must be a different token from now on. Existing tranches just run to their normal exits.");
        }
      }
      if (body.minPoolAgeHours !== undefined) {
        if (s.targetMint) {
          return res.status(400).json({ error: "The minimum-age dial only applies to a scanning bot." });
        }
        const raw = Number(body.minPoolAgeHours);
        if (!Number.isInteger(raw) || raw < 0 || raw > 720) {
          return res.status(400).json({ error: "Minimum token age must be a whole number of hours between 0 and 720 (30 days)." });
        }
        if (raw !== (s.minPoolAgeHours ?? 24)) {
          patch.minPoolAgeHours = raw;
          const label = raw === 0 ? "Be wild (fresh launches allowed)" : raw >= 96 ? `${Math.round(raw / 24)} days` : `${raw} hours`;
          changes.push(raw === 0
            ? `Minimum token age set to Be wild — the bot may now buy tokens the moment they launch. Highest reward potential and the highest rug risk: a token with no history has proven nothing. Tokens whose age can't be verified are still skipped.`
            : `Minimum token age set to ${label} — from now on the bot only buys tokens that have already traded for at least ${label}. Older tokens have survived longer and rug less often, but no age fully removes the risk (you saw an 8-hour token pull). Open positions just run their normal exits.`);
        }
      }
      if (body.hotStreakFullSize !== undefined) {
        if (typeof body.hotStreakFullSize !== "boolean") {
          return res.status(400).json({ error: "hotStreakFullSize must be true or false." });
        }
        if (s.targetMint) {
          return res.status(400).json({ error: "Hot-run sizing only applies to a scanning bot." });
        }
        if (body.hotStreakFullSize !== (s.hotStreakFullSize ?? false)) {
          patch.hotStreakFullSize = body.hotStreakFullSize;
          changes.push(body.hotStreakFullSize
            ? "Full size on hot runs turned ON — when the bot buys a token that has already climbed big for many hours straight (the long staircase pattern), it now invests the FULL slice. You're accepting the risk that this pattern can end in a one-candle rug that takes the whole slice."
            : "Full size on hot runs turned OFF — back to the protective default: on long-staircase tokens the bot only invests a quarter of the slice, keeping the other 75% out of the rug's reach.");
        }
      }
      if (body.conservativeProfit !== undefined) {
        if (typeof body.conservativeProfit !== "boolean") {
          return res.status(400).json({ error: "Steady-wins must be true or false." });
        }
        if (s.targetMint || s.style !== "quick") {
          return res.status(400).json({ error: "Steady-wins mode is only available on a Quick-swing scanner bot." });
        }
        if (body.conservativeProfit !== s.conservativeProfit) {
          patch.conservativeProfit = body.conservativeProfit;
          if (body.conservativeProfit && s.stopRoomPct !== null) {
            patch.stopRoomPct = null;
          }
          changes.push(body.conservativeProfit
            ? "Steady-wins mode turned ON — the bot now banks a small win (around +4%) the moment it appears, UNLESS buyers are clearly still piling in, in which case it lets that one keep riding for more. It also tightens the loss cut to −3% and, once a trade goes green, the goal is to take profits before it falls back into the red (a sudden crash can still move faster than any exit). Applies to open positions right away."
            : "Steady-wins mode turned OFF — the bot goes back to letting winners run on the trailing stop instead of banking small wins early.");
        }
      }
      if (body.neverSellAtLoss !== undefined) {
        if (typeof body.neverSellAtLoss !== "boolean") {
          return res.status(400).json({ error: "Never-sell-at-a-loss must be true or false." });
        }
        if (body.neverSellAtLoss !== (s.neverSellAtLoss ?? false)) {
          patch.neverSellAtLoss = body.neverSellAtLoss;
          changes.push(body.neverSellAtLoss
            ? "Recovery hold turned ON — underwater trades get more room instead of using the normal tight stop, but this is not an unlimited hold. The bot still exits if short and hourly evidence confirm the decline is continuing, if liquidity drains, or at a firm −12% maximum-loss backstop. A fast rug can still fill below that level. Applies to open positions right away."
            : "Recovery hold turned OFF — the normal loss protections (stop-loss, early cuts, rug guard, time-stop) are back on for every position, including ones currently underwater.");
        }
      }
      if (body.redEndBehavior !== undefined) {
        if (body.redEndBehavior !== "sell" && body.redEndBehavior !== "send_tokens") {
          return res.status(400).json({ error: "End-of-run choice must be 'sell' or 'send_tokens'." });
        }
        if (body.redEndBehavior !== (s.redEndBehavior ?? "sell")) {
          patch.redEndBehavior = body.redEndBehavior;
          changes.push(body.redEndBehavior === "send_tokens"
            ? "End-of-run choice changed — when the run ends (timer or your stop) while a position is still below what you paid, the bot now sends you the tokens themselves instead of selling at a loss. You'll hold the token in your own wallet and can sell whenever you like; it won't count in the bot's P&L since it never sold. (Paper bots have no real tokens, so paper positions still close normally.)"
            : "End-of-run choice changed — when the run ends, every position is sold and only SOL comes home, even if a position is still underwater. The run always fully wraps up on its own.");
        }
      }
      if (body.takeProfitPct !== undefined) {
        const target = takeProfitSettingsPatch(s.takeProfitPct, body.takeProfitPct);
        if (target.error) return res.status(400).json({ error: target.error });
        Object.assign(patch, target.patch);
        if (target.change) changes.push(target.change);
      }
      if (body.stopRoomPct !== undefined) {
        if (s.targetMint || s.style !== "quick") {
          return res.status(400).json({ error: "Stop-loss room is only available on a Quick-swing scanner bot." });
        }
        if (body.stopRoomPct === null) {
          if (s.stopRoomPct !== null) {
            patch.stopRoomPct = null;
            if (!s.targetMint && s.universe !== "stocks") patch.conservativeProfit = false;
            changes.push("Loss protection set back to Automatic — the bot now reads live volume, liquidity, buyer/seller pressure, volatility, and accumulation before deciding how much room this position has.");
          }
        } else {
          const room = Math.round(Number(body.stopRoomPct));
          if (!Number.isFinite(room) || room < 2 || room > 50) {
            return res.status(400).json({ error: "Stop-loss room must be a whole number between 2 and 50 percent (or Smart default)." });
          }
          if (room !== s.stopRoomPct) {
            patch.stopRoomPct = room;
            if (s.conservativeProfit) patch.conservativeProfit = false;
            patch.sellOffCutEnabled = false;
            changes.push(room === 3
              ? "Stop-loss room set to −3% — the tightest cut: any trade down 3% is sold immediately, with no automatic recovery room. Keeps every loss tiny, but normal wiggles will stop you out more often. Applies to open positions right away."
              : `Stop-loss room set to −${room}% — the bot now uses your chosen percentage instead of Automatic market reading. Your number is the loss line unless you separately turn on the optional sell-off safety cut. More room can catch reversals, but each losing trade can cost up to ${room}% of its stake. Applies to open positions right away.`);
          }
        }
      }
      if (body.winnerKeepPct !== undefined) {
        if (s.targetMint || s.style !== "quick") {
          return res.status(400).json({ error: "Winner room is only available on a Quick-swing scanner bot." });
        }
        if (body.winnerKeepPct === null) {
          if (s.winnerKeepPct !== null) {
            patch.winnerKeepPct = null;
            changes.push("Winner room set back to the default — green trades bank fast again, keeping at least 60% of their best gain (the safest choice).");
          }
        } else {
          const keep = Math.round(Number(body.winnerKeepPct));
          if (!Number.isFinite(keep) || keep < 40 || keep > 90) {
            return res.status(400).json({ error: "Winner room must keep between 40 and 90 percent of the best gain (or the default)." });
          }
          if (keep !== s.winnerKeepPct) {
            patch.winnerKeepPct = keep;
            changes.push(keep === 40
              ? "Runner mode turned ON — the routine +3% small-win sale is disabled and green trades get the widest room to develop a larger second leg. Confirmed reversals, liquidity danger, and loss protection still apply. Applies to open positions right away."
              : keep >= 60
              ? `Winner room changed — green trades now bank once they'd keep ${keep}% of their best gain. Tighter than-or-equal-to the default: wins are banked ${keep > 60 ? "even faster" : "at the default pace"}, and the occasional monster runner will be sold early. Applies to open positions right away.`
              : `Winner room changed — a green trade may now give back up to ${100 - keep}% of its peak before the bot banks it (keeps ${keep}%). More room for a big runner to develop its second leg, but winners that fade hand back more profit. Applies to open positions right away.`);
          }
        }
      }
      if (body.sellOffCutEnabled !== undefined) {
        if (typeof body.sellOffCutEnabled !== "boolean") {
          return res.status(400).json({ error: "Sell-off safety cut must be true or false." });
        }
        if (body.sellOffCutEnabled !== (s.sellOffCutEnabled ?? false)) {
          patch.sellOffCutEnabled = body.sellOffCutEnabled;
          changes.push(body.sellOffCutEnabled
            ? "Sell-off safety cut turned ON — your stop room still absorbs normal volatility (up-down churn with buyers active is left alone to reverse), but if a genuine one-way wave of sellers hits — sellers overwhelming buyers on both the 5-minute tape AND the full hour, with the candle in freefall — the bot cuts the loss early instead of riding the crash to your full stop room. Applies to open positions right away."
            : "Sell-off safety cut turned OFF — your stop room is now the only loss-side line, even during a heavy one-way sell-off. A crashing token will ride all the way to your chosen stop before selling.");
        }
      }
      if (body.profitSkimPct !== undefined) {
        const pct = Math.round(Number(body.profitSkimPct));
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
          return res.status(400).json({ error: "Profit set-aside must be a whole number between 0 and 100 percent." });
        }
        if (pct !== (s.profitSkimPct ?? 50)) {
          patch.profitSkimPct = pct;
          changes.push(pct === 0
            ? "Profit set-aside turned OFF — every win now stays in the trading bankroll and compounds into the next trade."
            : `Profit set-aside changed to ${pct}% — from now on, ${pct}% of every winning trade's profit is taken out of the trading bankroll${s.mode === "live" ? " and sent to your withdraw wallet" : " and tracked as set aside (paper)"}; the rest keeps compounding. Applies to future closes.`);
        }
      }
      if (body.lossStopCount !== undefined) {
        const count = Math.round(Number(body.lossStopCount));
        if (!Number.isFinite(count) || count < 1 || count > 20) {
          return res.status(400).json({ error: "Loss cool-off count must be a whole number between 1 and 20." });
        }
        if (count !== s.lossStopCount) {
          patch.lossStopCount = count;
          changes.push(`Loss cool-off changed to ${count} straight loss${count === 1 ? "" : "es"} — after that many losing trades, new buys pause for 30 minutes while open positions keep their normal protection.`);
        }
      }
      if (Object.keys(patch).length === 0) return res.json({ strategy: publicStrategy(s) });
      const updated = await storage.updateSwingStrategy(s.id, patch);
      if (!updated) return res.status(500).json({ error: "Failed to update settings." });
      for (const detail of changes) {
        await storage.addSwingEvent({
          strategyId: s.id, positionId: null, kind: "info", mint: null, symbol: null,
          detail, solLamports: null,
        }).catch(() => {});
      }
      res.json({ strategy: publicStrategy(updated) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to update settings" });
    }
  });

  // Change the run timer on an existing bot. Owner-gated. Two shapes:
  //   { unlimitedWindow: true }            → no scheduled end (runs until stopped)
  //   { windowHours: 12..720 }             → new end = NOW + windowHours
  // Safe at any time: the window end only decides when the bot wraps up and
  // sweeps home — every exit rule, loss brake, and the deposit cap are
  // untouched. Shortening below "now" is rejected by the 12h floor, so a
  // timer change can never trigger an instant surprise liquidation.
  app.post("/api/swing-bot/:id/window", async (req, res) => {
    try {
      const s = await storage.getSwingStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Swing bot not found." });
      const authErr = await authorizeAction("window", s, req.body);
      if (authErr) return res.status(authErr.code).json({ error: authErr.error });
      if (s.status === "completed" || s.status === "stopped") {
        return res.status(400).json({ error: "This bot has finished — restart it first, then set the new timer." });
      }
      const body = req.body ?? {};
      let patch: { windowEndAt: Date; unlimitedWindow: boolean; maxHoldHours?: number };
      let detail: string;
      if (body.unlimitedWindow === true) {
        if (s.unlimitedWindow) return res.json({ strategy: publicStrategy(s) });
        patch = { windowEndAt: new Date(Date.now() + UNLIMITED_WINDOW_MS), unlimitedWindow: true };
        detail = "Timer removed — this bot now runs with no end date, until you stop it. The lifetime clock keeps counting your active time; all safety brakes stay on.";
      } else {
        const hours = Number(body.windowHours);
        if (!Number.isInteger(hours) || hours < 12 || hours > 720) {
          return res.status(400).json({ error: "Timer must be a whole number of hours between 12 and 720 (30 days)." });
        }
        patch = { windowEndAt: new Date(Date.now() + hours * 3600_000), unlimitedWindow: false, maxHoldHours: hours };
        const days = hours / 24;
        detail = `Timer changed — the run now ends in ${days >= 1 ? `${Math.round(days * 10) / 10} day${days >= 2 ? "s" : ""}` : `${hours} hours`} from now${s.unlimitedWindow ? " (was unlimited)" : ""}. When it ends, positions close and funds sweep home as usual.`;
      }
      const updated = await storage.updateSwingStrategy(s.id, patch);
      if (!updated) return res.status(500).json({ error: "Failed to change the timer." });
      await storage.addSwingEvent({
        strategyId: s.id, positionId: null, kind: "info", mint: null, symbol: null,
        detail, solLamports: null,
      }).catch(() => {});
      res.json({ strategy: publicStrategy(updated) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to change the timer" });
    }
  });

  // Top off a RUNNING bot with more SOL. Owner-gated. For live bots the
  // client sends the SOL to the worker wallet FIRST (the executor sizes buys
  // off the real wallet balance, so new money is picked up automatically on
  // the very next entry) and then calls this to record the deposit — keeping
  // the "SOL in" number and P&L math honest. For paper bots this simply adds
  // virtual SOL to the bankroll. Total deposits stay under the 10 SOL cap;
  // profits remain uncapped as always. No fee on top-ups (the 1.6% deposit
  // fee is charged once, at first start — in the user's favor here).
  app.post("/api/swing-bot/:id/topup", async (req, res) => {
    try {
      const s = await storage.getSwingStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Swing bot not found." });
      const authErr = await authorizeAction("topup", s, req.body);
      if (authErr) return res.status(authErr.code).json({ error: authErr.error });
      if (s.status !== "active" && s.status !== "paused") {
        return res.status(400).json({ error: "Top-ups are for running bots — use the funding box to fund a bot that hasn't started." });
      }
      const addSol = Number(req.body?.addSol);
      if (!Number.isFinite(addSol) || addSol < 0.01 || addSol > 10) {
        return res.status(400).json({ error: "Top-up must be between 0.01 and 10 SOL." });
      }
      const addLamports = BigInt(Math.round(addSol * LAMPORTS_PER_SOL));
      const newBudget = BigInt(s.budgetLamports) + addLamports;
      if (newBudget > SWING_HARD_MAX_BUDGET_LAMPORTS) {
        const room = Number(SWING_HARD_MAX_BUDGET_LAMPORTS - BigInt(s.budgetLamports)) / LAMPORTS_PER_SOL;
        return res.status(400).json({
          error: room > 0.01
            ? `That would put total deposits over the 10 SOL cap — you can add up to ${room.toFixed(4)} SOL more. (Profits are never capped.)`
            : "This bot is already at the 10 SOL deposit cap. Profits are never capped — winnings keep compounding.",
        });
      }
      const patch: Record<string, string> = { budgetLamports: newBudget.toString() };
      if (s.mode === "paper") {
        patch.paperBankrollLamports = (BigInt(s.paperBankrollLamports) + addLamports).toString();
      }
      const updated = await storage.updateSwingStrategy(s.id, patch);
      if (!updated) return res.status(500).json({ error: "Failed to record the top-up." });
      await storage.addSwingEvent({
        strategyId: s.id, positionId: null, kind: "info", mint: null, symbol: null,
        detail: s.mode === "live"
          ? `Top-up: +${addSol} SOL added to the trading wallet. The bot folds it in automatically — free cash is split across the open slots on the very next buys. No fee on top-ups.`
          : `Top-up: +${addSol} SOL added to the paper bankroll — the bot puts it to work on the next buys.`,
        solLamports: addLamports.toString(),
      }).catch(() => {});
      res.json({ strategy: publicStrategy(updated) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to top up" });
    }
  });

  // Stop = sell everything + (live) sweep every lamport back to the owner.
  app.post("/api/swing-bot/:id/stop", async (req, res) => {
    try {
      const s = await storage.getSwingStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Swing bot not found." });
      const authErr = await authorizeAction("stop", s, req.body);
      if (authErr) return res.status(authErr.code).json({ error: authErr.error });
      // Status flips instantly. If open positions remain, liquidation runs in
      // the background (can take minutes). If NONE remain (a pure withdraw),
      // the call awaits the actual SOL sweep so the response — and the event
      // feed — reflect the real outcome, not a fire-and-forget.
      const updated = await stopAndWithdrawSwingStrategy(s.id);
      res.json({ ok: true, strategy: updated ? publicStrategy(updated) : null });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to stop swing bot" });
    }
  });

  // Manual "Buy now" on a manual-buy watch bot. Owner-gated. Single-shot —
  // the executor refuses if the bot ever bought before, and runs the buy
  // under the strategy lock so it can't race the tick or a Stop.
  app.post("/api/swing-bot/:id/buy", async (req, res) => {
    try {
      const s = await storage.getSwingStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Swing bot not found." });
      const authErr = await authorizeAction("buy", s, req.body);
      if (authErr) return res.status(authErr.code).json({ error: authErr.error });
      const result = await manualBuyWatchToken(s.id);
      res.json({ ok: true, symbol: result.symbol });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to buy" });
    }
  });

  // Manual "Sell now" on a single open position. Owner-gated. The bot keeps
  // running (quick/ride keep trading with the returned SOL); a watch bot's
  // single-shot wrap-up then sweeps everything home automatically.
  app.post("/api/swing-bot/:id/sell", async (req, res) => {
    try {
      const s = await storage.getSwingStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Swing bot not found." });
      const positionId = typeof req.body?.positionId === "string" ? req.body.positionId : "";
      if (!positionId) return res.status(400).json({ error: "positionId required." });
      // The signed action string embeds the positionId so the authorization is
      // cryptographically bound to this exact position, not just "some sell".
      const authErr = await authorizeAction(`sell:${positionId}`, s, req.body);
      if (authErr) return res.status(authErr.code).json({ error: authErr.error });
      await manualSellSwingPosition(s.id, positionId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to sell position" });
    }
  });

  // Manual "Buy more" of a token the bot already holds. Owner-gated; the
  // signed action string embeds the positionId so approval is bound to this
  // exact position. Puts all free SOL into a fresh tranche of that mint.
  app.post("/api/swing-bot/:id/buymore", async (req, res) => {
    try {
      const s = await storage.getSwingStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Swing bot not found." });
      const positionId = typeof req.body?.positionId === "string" ? req.body.positionId : "";
      if (!positionId) return res.status(400).json({ error: "positionId required." });
      const authErr = await authorizeAction(`buymore:${positionId}`, s, req.body);
      if (authErr) return res.status(authErr.code).json({ error: authErr.error });
      const result = await manualBuyMoreSwingPosition(s.id, positionId);
      res.json({ ok: true, symbol: result.symbol, sol: result.sol });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to buy more" });
    }
  });

  // Per-position "Don't sell yet". This pauses every automatic exit for the
  // selected open tranche until the owner turns it off. The signed action
  // includes both the position and desired state so it cannot be replayed as
  // the opposite choice.
  app.post("/api/swing-bot/:id/position-hold", async (req, res) => {
    try {
      const s = await storage.getSwingStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Swing bot not found." });
      const positionId = typeof req.body?.positionId === "string" ? req.body.positionId : "";
      const hold = req.body?.hold;
      if (!positionId) return res.status(400).json({ error: "positionId required." });
      if (typeof hold !== "boolean") return res.status(400).json({ error: "hold must be true or false." });
      const authErr = await authorizeAction(`positionhold:${positionId}:${hold ? "on" : "off"}`, s, req.body);
      if (authErr) return res.status(authErr.code).json({ error: authErr.error });
      const position = (await storage.listSwingPositions(s.id, "open")).find((p) => p.id === positionId);
      if (!position) return res.status(400).json({ error: "That position is already closed." });
      const updated = await storage.updateSwingPosition(position.id, { manualHold: hold });
      if (!updated) return res.status(500).json({ error: "Couldn't update the hold switch." });
      await storage.addSwingEvent({
        strategyId: s.id,
        positionId: position.id,
        kind: "info",
        mint: position.mint,
        symbol: position.symbol,
        detail: hold
          ? `Don't sell yet turned ON for ${position.symbol} — automatic exits are paused for this position. Sell now, stopping the bot, or the run timer ending can still close it.`
          : `Don't sell yet turned OFF for ${position.symbol} — the bot's normal exit protection is active again.`,
        solLamports: null,
      }).catch(() => {});
      res.json({ ok: true, position: updated });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to update Don't sell yet" });
    }
  });

  // Manual "Swap": sell one open position, then put the freed cash into
  // another held token. Owner-gated; the signed action string embeds BOTH
  // position ids so approval is bound to this exact pair. Sell-first; if the
  // follow-up buy is declined the sale stands and the error says so.
  app.post("/api/swing-bot/:id/swap", async (req, res) => {
    try {
      const s = await storage.getSwingStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Swing bot not found." });
      const sellPositionId = typeof req.body?.sellPositionId === "string" ? req.body.sellPositionId : "";
      const buyPositionId = typeof req.body?.buyPositionId === "string" ? req.body.buyPositionId : "";
      if (!sellPositionId || !buyPositionId) return res.status(400).json({ error: "sellPositionId and buyPositionId required." });
      const authErr = await authorizeAction(`swap:${sellPositionId}:${buyPositionId}`, s, req.body);
      if (authErr) return res.status(authErr.code).json({ error: authErr.error });
      const result = await manualSwapSwingPosition(s.id, sellPositionId, buyPositionId);
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to swap" });
    }
  });

  // Manual "Buy now" on a mint from a closed trade (the immediate flavor of
  // "Buy again"). Owner-gated; the signed action string embeds the mint so
  // approval is bound to it. Entry judgment and re-entry cooldown are
  // skipped (user's explicit choice); openPosition safety guards remain.
  app.post("/api/swing-bot/:id/buy-mint-now", async (req, res) => {
    try {
      const s = await storage.getSwingStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Swing bot not found." });
      const mint = typeof req.body?.mint === "string" ? req.body.mint : "";
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return res.status(400).json({ error: "Valid mint required." });
      const authErr = await authorizeAction(`buymintnow:${mint}`, s, req.body);
      if (authErr) return res.status(authErr.code).json({ error: authErr.error });
      const result = await manualBuyMintNow(s.id, mint);
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to buy" });
    }
  });

  // "Ask me first": approve a pending suggestion the bot filed instead of
  // auto-buying. Owner-gated; the signed action string embeds the signalId so
  // approval is bound to this exact suggestion. Buys at the CURRENT price
  // through the same safety-guarded path as a manual "Buy now".
  app.post("/api/swing-bot/:id/signal/:signalId/approve", async (req, res) => {
    try {
      const s = await storage.getSwingStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Swing bot not found." });
      const signalId = req.params.signalId;
      const authErr = await authorizeAction(`approve:${signalId}`, s, req.body);
      if (authErr) return res.status(authErr.code).json({ error: authErr.error });
      const result = await approveBuySignal(s.id, signalId);
      res.json({ ok: true, symbol: result.symbol });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to approve" });
    }
  });

  // "Ask me first": dismiss a pending suggestion (no buy). Owner-gated; the
  // signed action string embeds the signalId.
  app.post("/api/swing-bot/:id/signal/:signalId/dismiss", async (req, res) => {
    try {
      const s = await storage.getSwingStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Swing bot not found." });
      const signalId = req.params.signalId;
      const authErr = await authorizeAction(`dismiss:${signalId}`, s, req.body);
      if (authErr) return res.status(authErr.code).json({ error: authErr.error });
      await dismissBuySignal(s.id, signalId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to dismiss" });
    }
  });

  // "Would the bot buy this right now?" — the pre-buy warning behind the
  // manual "Buy now" button. Read-only (no keys touched, no secrets returned,
  // nothing changed), but it exposes strategy-derived signal, so it's gated by
  // the SAME owner read-token as every other swing read (`x-swing-token`). The
  // auth check runs BEFORE assessBuyNow so an unauthenticated caller can't use
  // error differences to probe which mints this bot has traded.
  // Scanner-page integration: "what would the Swing Bot say about this token
  // right now?" — PUBLIC read. Bound to no bot, reads no trade history, uses
  // fixed default dials. Rate-limited per IP because it fans out to
  // DexScreener (which is itself cached ~60s inside getTokenStats).
  const scannerCheckHits = new Map<string, { count: number; windowStart: number }>();
  app.get("/api/swing-bot/token-check/:mint", async (req, res) => {
    try {
      const mint = req.params.mint;
      if (!SOLANA_ADDRESS_REGEX.test(mint)) return res.status(400).json({ error: "Valid mint required." });
      const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || req.socket.remoteAddress || "?";
      const now = Date.now();
      const hit = scannerCheckHits.get(ip);
      if (!hit || now - hit.windowStart > 60_000) {
        scannerCheckHits.set(ip, { count: 1, windowStart: now });
      } else if (++hit.count > 20) {
        return res.status(429).json({ error: "Slow down a little — try again in a minute." });
      }
      if (scannerCheckHits.size > 5000) scannerCheckHits.clear();
      const result = await scannerTokenCheck(mint);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Couldn't check the token." });
    }
  });

  // In-app candle chart for a watched token. Same owner read-token gate as
  // buy-now-check (the watchlist itself is strategy-derived data). Returns
  // 5-minute OHLCV candles (~2h) from the executor's cached GeckoTerminal
  // fetch — null candles just means "no chart right now", never an error.
  app.get("/api/swing-bot/:id/watch-chart/:mint", async (req, res) => {
    try {
      const s = await storage.getSwingStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Swing bot not found." });
      if (authorizedReadOwner(req) !== s.ownerWallet) {
        return res.status(401).json({ error: "Unlock with your wallet to see this chart." });
      }
      const mint = req.params.mint;
      if (!SOLANA_ADDRESS_REGEX.test(mint)) return res.status(400).json({ error: "Valid mint required." });
      const stats = await getTokenStats(mint);
      if (!stats?.pairAddress) return res.json({ symbol: stats?.symbol ?? mint.slice(0, 4), candles: null });
      const candles = await getCandles(stats.pairAddress);
      res.json({ symbol: stats.symbol, candles });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Couldn't load the chart." });
    }
  });

  app.get("/api/swing-bot/:id/buy-now-check/:mint", async (req, res) => {
    try {
      const s = await storage.getSwingStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Swing bot not found." });
      if (authorizedReadOwner(req) !== s.ownerWallet) {
        return res.status(401).json({ error: "Unlock with your wallet to check this token." });
      }
      const mint = req.params.mint;
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return res.status(400).json({ error: "Valid mint required." });
      const result = await assessBuyNow(s.id, mint);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Couldn't check the token." });
    }
  });

  // Toggle a "Buy again" star on a mint from a closed trade. Owner-gated;
  // the signed action string embeds the mint so approval is bound to it.
  // Starred mints join the bot's scan (re-entry cooldown waived) but every
  // entry judgment and safety guard still applies before any buy.
  app.post("/api/swing-bot/:id/rebuy", async (req, res) => {
    try {
      const s = await storage.getSwingStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Swing bot not found." });
      const mint = typeof req.body?.mint === "string" ? req.body.mint : "";
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return res.status(400).json({ error: "Valid mint required." });
      const authErr = await authorizeAction(`rebuy:${mint}`, s, req.body);
      if (authErr) return res.status(authErr.code).json({ error: authErr.error });
      const cur = s.rebuyMints ?? [];
      const starred = cur.includes(mint);
      // A mint can't be watched AND banned. Refuse to star a blocked mint so the
      // persisted state matches the product rule (blocking already clears stars).
      if (!starred && (s.blockedMints ?? []).includes(mint)) {
        return res.status(400).json({ error: "This token is on your Never-buy list — tap 'Allow again' first if you want to watch it." });
      }
      // Never report "starred" without persisting: at the cap, refuse loudly
      // instead of silently dropping the mint (false confirmation).
      if (!starred && cur.length >= 20) {
        return res.status(400).json({ error: "Buy again list is full (20 tokens) — un-star one first." });
      }
      const next = starred ? cur.filter((m: string) => m !== mint) : [...cur, mint];
      const updated = await storage.updateSwingStrategy(s.id, { rebuyMints: next });
      res.json({ ok: true, starred: !starred, strategy: publicStrategy(updated) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to update Buy again" });
    }
  });

  // Toggle a "Never buy again" block on a mint. Owner-gated; the signed action
  // string embeds the mint so approval is bound to it. Blocking also force-clears
  // any "Buy again" star on the same mint — a token can't be watched AND banned.
  // A blocked mint is refused by EVERY buy path (enforced in openPosition + the
  // hunt), so this is the owner's hard "don't touch this one" switch.
  app.post("/api/swing-bot/:id/block", async (req, res) => {
    try {
      const s = await storage.getSwingStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Swing bot not found." });
      const mint = typeof req.body?.mint === "string" ? req.body.mint : "";
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return res.status(400).json({ error: "Valid mint required." });
      const authErr = await authorizeAction(`block:${mint}`, s, req.body);
      if (authErr) return res.status(authErr.code).json({ error: authErr.error });
      const cur = s.blockedMints ?? [];
      const blocked = cur.includes(mint);
      // Never report "blocked" without persisting: at the cap, refuse loudly
      // instead of silently dropping the mint (false confirmation).
      if (!blocked && cur.length >= 100) {
        return res.status(400).json({ error: "Never-buy list is full (100 tokens) — allow one back first." });
      }
      const next = blocked ? cur.filter((m: string) => m !== mint) : [...cur, mint];
      // Blocking wins over watching: drop any star on this mint so it can't be
      // both watched and banned (openPosition would refuse the buy anyway).
      const nextRebuy = blocked ? (s.rebuyMints ?? []) : (s.rebuyMints ?? []).filter((m: string) => m !== mint);
      const updated = await storage.updateSwingStrategy(s.id, { blockedMints: next, rebuyMints: nextRebuy });
      res.json({ ok: true, blocked: !blocked, strategy: publicStrategy(updated) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to update Never buy" });
    }
  });

  // Delete a bot permanently. Owner-gated. Refuses while the bot is active,
  // holds open positions, or (live) still has SOL in its worker wallet —
  // deletion destroys the record of the worker key, so funds must be out first.
  // ── Saved settings presets ("my favorite settings") ───────────────────────
  // Snapshot is taken SERVER-SIDE from a real strategy, so every value already
  // passed the settings endpoint's validation — the client never supplies raw
  // knob values. Presets apply only to scanning bots of the SAME style.
  const SWING_PRESET_KEYS = [
    "maxPositions", "allowStacking", "hotStreakFullSize", "minPoolAgeHours",
    "requireApproval", "minLiquidityUsd", "conservativeProfit", "neverSellAtLoss",
    "redEndBehavior", "takeProfitPct", "stopRoomPct", "winnerKeepPct",
    "sellOffCutEnabled", "profitSkimPct",
  ] as const;

  // Save the bot's CURRENT knobs as a named preset. Owner-signed.
  app.post("/api/swing-bot/:id/save-preset", async (req, res) => {
    try {
      const s = await storage.getSwingStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Swing bot not found." });
      const authErr = await authorizeAction("save-preset", s, req.body);
      if (authErr) return res.status(authErr.code).json({ error: authErr.error });
      if (s.targetMint) return res.status(400).json({ error: "Presets are for scanning bots — this bot watches a single token." });
      const name = String(req.body?.name ?? "").trim();
      if (!name || name.length > 48) return res.status(400).json({ error: "Give the preset a name (up to 48 characters)." });
      const existing = await storage.listSwingPresetsByOwner(s.ownerWallet);
      if (existing.length >= 20) return res.status(400).json({ error: "You already have 20 presets — delete one to save another." });
      if (existing.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
        return res.status(400).json({ error: "You already have a preset with that name." });
      }
      const settings: Record<string, unknown> = {};
      for (const k of SWING_PRESET_KEYS) settings[k] = (s as any)[k] ?? null;
      const preset = await storage.createSwingPreset({
        ownerWallet: s.ownerWallet, name, style: s.style, settings,
        sourceStrategyName: s.name, starred: Boolean(req.body?.starred) || false,
      });
      res.json({ preset });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to save preset" });
    }
  });

  // List my presets. Read-token gated (same as bot list).
  app.get("/api/swing-presets/list", async (req, res) => {
    const owner = String(req.query.owner ?? "");
    if (!SOLANA_ADDRESS_REGEX.test(owner)) return res.status(400).json({ error: "A valid owner wallet is required." });
    if (authorizedReadOwner(req) !== owner) return res.status(401).json({ error: "Unlock this session to view your presets." });
    try {
      res.json({ presets: await storage.listSwingPresetsByOwner(owner) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to list presets" });
    }
  });

  // Star/unstar or rename a preset. Owner-signed (presetId rides in the
  // strategyId slot of the signed message — same replay/nonce protection).
  app.post("/api/swing-presets/:presetId/update", async (req, res) => {
    try {
      const p = await storage.getSwingPreset(req.params.presetId);
      if (!p) return res.status(404).json({ error: "Preset not found." });
      const authErr = await authorizeAction("preset-update", { id: p.id, ownerWallet: p.ownerWallet }, req.body);
      if (authErr) return res.status(authErr.code).json({ error: authErr.error });
      const patch: { name?: string; starred?: boolean } = {};
      if (req.body?.starred !== undefined) {
        if (typeof req.body.starred !== "boolean") return res.status(400).json({ error: "starred must be true or false." });
        patch.starred = req.body.starred;
      }
      if (req.body?.name !== undefined) {
        const name = String(req.body.name).trim();
        if (!name || name.length > 48) return res.status(400).json({ error: "Preset name must be 1–48 characters." });
        patch.name = name;
      }
      if (Object.keys(patch).length === 0) return res.json({ preset: p });
      const updated = await storage.updateSwingPreset(p.id, patch);
      res.json({ preset: updated ?? p });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to update preset" });
    }
  });

  // Delete a preset. Owner-signed.
  app.post("/api/swing-presets/:presetId/delete", async (req, res) => {
    try {
      const p = await storage.getSwingPreset(req.params.presetId);
      if (!p) return res.status(404).json({ error: "Preset not found." });
      const authErr = await authorizeAction("preset-delete", { id: p.id, ownerWallet: p.ownerWallet }, req.body);
      if (authErr) return res.status(authErr.code).json({ error: authErr.error });
      await storage.deleteSwingPreset(p.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to delete preset" });
    }
  });

  // Apply a preset's knobs to a bot. Owner-signed against the TARGET bot.
  // Same-style scanning bots only; knobs are whitelisted; mode/budget/style
  // are never touched. Values were validated when the source bot set them.
  app.post("/api/swing-bot/:id/apply-preset", async (req, res) => {
    try {
      const s = await storage.getSwingStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Swing bot not found." });
      const authErr = await authorizeAction("apply-preset", s, req.body);
      if (authErr) return res.status(authErr.code).json({ error: authErr.error });
      const p = await storage.getSwingPreset(String(req.body?.presetId ?? ""));
      if (!p || p.ownerWallet !== s.ownerWallet) return res.status(404).json({ error: "Preset not found." });
      if (s.targetMint) return res.status(400).json({ error: "Presets apply to scanning bots — this bot watches a single token." });
      if (p.style !== s.style) {
        return res.status(400).json({ error: `This preset was saved from a ${p.style}-style bot — it can only be applied to a ${p.style}-style bot.` });
      }
      const snap = (p.settings ?? {}) as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const k of SWING_PRESET_KEYS) {
        if (k in snap && snap[k] !== (s as any)[k]) patch[k] = snap[k];
      }
      const updated = Object.keys(patch).length > 0 ? await storage.updateSwingStrategy(s.id, patch) : s;
      if (!updated) return res.status(500).json({ error: "Failed to apply preset." });
      await storage.addSwingEvent({
        strategyId: s.id, positionId: null, kind: "info", mint: null, symbol: null,
        detail: `Applied your saved preset "${p.name}" — ${Object.keys(patch).length} setting${Object.keys(patch).length === 1 ? "" : "s"} changed. Open positions keep running; new rules apply from the next check.`,
        solLamports: null,
      }).catch(() => {});
      res.json({ strategy: publicStrategy(updated) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to apply preset" });
    }
  });

  app.post("/api/swing-bot/:id/delete", async (req, res) => {
    try {
      const s = await storage.getSwingStrategy(req.params.id);
      if (!s) return res.json({ ok: true });
      const authErr = await authorizeAction("delete", s, req.body);
      if (authErr) return res.status(authErr.code).json({ error: authErr.error });
      if (s.mode === "paper") {
        await stopSettleAndDeletePaperSwingStrategy(s.id);
        return res.json({ ok: true });
      }
      if (s.status === "active") {
        return res.status(400).json({ error: "Stop the bot before deleting it." });
      }
      const open = await storage.listSwingPositions(s.id, "open");
      if (open.length > 0) {
        return res.status(400).json({ error: "This bot still has open positions. Press Stop & withdraw first." });
      }
      if (s.mode === "live") {
        let balance: bigint;
        let holdsTokens: boolean;
        try {
          [balance, holdsTokens] = await Promise.all([
            getSwingSolBalance(s.workerWallet),
            workerHoldsTokens(s.workerWallet),
          ]);
        } catch {
          // Fail-safe: never delete blind. Deleting destroys the worker key,
          // so "couldn't check" must never be treated as "empty".
          return res.status(400).json({
            error: "Couldn't verify the bot's wallet is empty — please try again in a moment.",
          });
        }
        // 20_000 lamports (0.00002 SOL) = same dust threshold the UI uses.
        if (balance > 20_000n) {
          return res.status(400).json({
            error: "This bot's wallet still holds SOL. Press Withdraw again to get it back before deleting.",
          });
        }
        if (holdsTokens) {
          return res.status(400).json({
            error: "This bot's wallet still holds tokens. Press Withdraw again to send them back before deleting.",
          });
        }
      }
      // Serialize with the scheduler/liquidation lock so we never delete the
      // row (and its worker key) while a sweep is still running on it. Status
      // is re-read under the lock in case the bot was restarted meanwhile.
      const refused = await runUnderStrategyLock(s.id, async () => {
        const fresh = await storage.getSwingStrategy(s.id);
        if (!fresh) return null; // already gone — treat as success
        if (fresh.status === "active") return "Stop the bot before deleting it.";
        await storage.deleteSwingStrategy(s.id);
        return null;
      });
      if (refused) return res.status(400).json({ error: refused });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to delete swing bot" });
    }
  });
}
