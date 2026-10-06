import type { Express } from "express";
import { createAutoStrategySchema } from "@workspace/db";
import { storage } from "./storage";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  generateTradingWallet,
  tryActivateStrategy,
  cancelAndWithdrawStrategy,
  liquidateStrategyNow,
  getSolBalanceLamports,
  isEncryptionConfigured,
  issueReadToken,
  verifyReadToken,
} from "./auto-strategy";

// Public shape — NEVER includes the encrypted key.
function publicStrategy(s: any) {
  return {
    id: s.id,
    ownerWallet: s.ownerWallet,
    tradingWallet: s.tradingWallet,
    withdrawAddress: s.withdrawAddress,
    name: s.name,
    status: s.status,
    walletCount: s.walletCount ?? 1,
    keepFunds: s.keepFunds ?? false,
    // All wallet pubkeys (primary first). NEVER the encrypted keys.
    wallets: [s.tradingWallet, ...((s.extraWallets ?? []) as string[])],
    budgetLamports: s.budgetLamports,
    spentLamports: s.spentLamports,
    tokens: s.tokens,
    allocationsBps: s.allocationsBps,
    mode: s.mode,
    slippageBps: s.slippageBps,
    windowStartAt: s.windowStartAt,
    windowEndAt: s.windowEndAt,
    intervalSeconds: s.intervalSeconds,
    totalSlices: s.totalSlices,
    completedSlices: s.completedSlices,
    buySlices: s.buySlices,
    takeProfitPct: s.takeProfitPct ?? null,
    takeProfitSellBps: s.takeProfitSellBps ?? null,
    takeProfitFiredAt: s.takeProfitFiredAt ?? null,
    nextRunAt: s.nextRunAt,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Destructive/lifecycle actions must be authorized by an ed25519 signature from
// the owner wallet — body-provided ownerWallet alone is spoofable. Mirrors the
// app's existing bump-history / redemption signed-message pattern.
const ACTION_SIG_MAX_AGE_MS = 5 * 60 * 1000;

// Defense-in-depth replay protection: a verified signature is single-use within
// its freshness window. A captured request can't be replayed even before the
// nonce expires. Bounded + self-pruning so it can't grow unbounded.
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

function autoStrategyActionMessage(d: {
  action: string; strategyId: string; ownerWallet: string; nonce: number;
}): Uint8Array {
  const msg = ["paif-auto-strategy", "v1", d.action, d.strategyId, d.ownerWallet, String(d.nonce)].join("|");
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

// Returns null on success, or an HTTP error tuple to send.
async function authorizeAction(
  action: string,
  strategy: { id: string; ownerWallet: string },
  body: any,
): Promise<{ code: number; error: string } | null> {
  const { ownerWallet, nonce, signature } = body ?? {};
  if (ownerWallet !== strategy.ownerWallet) {
    return { code: 403, error: "Owner wallet mismatch." };
  }
  if (typeof nonce !== "number" || typeof signature !== "string") {
    return { code: 401, error: "Signed authorization required." };
  }
  if (Math.abs(Date.now() - nonce) > ACTION_SIG_MAX_AGE_MS) {
    return { code: 401, error: "Authorization expired — please retry." };
  }
  const ok = await verifyEd25519(
    strategy.ownerWallet,
    signature,
    autoStrategyActionMessage({ action, strategyId: strategy.id, ownerWallet: strategy.ownerWallet, nonce }),
  );
  if (!ok) return { code: 401, error: "Invalid signature — must be signed by the owner wallet." };
  if (!consumeSignature(signature)) {
    return { code: 401, error: "This authorization was already used — please retry." };
  }
  return null;
}

// Canonical message the owner signs to create a strategy under their wallet.
function autoStrategyCreateMessage(d: { ownerWallet: string; nonce: number }): Uint8Array {
  return new TextEncoder().encode(
    ["paif-auto-strategy", "v1", "create", d.ownerWallet, String(d.nonce)].join("|"),
  );
}

// Canonical message the owner signs ONCE to mint a short-lived read-session
// token (authorizes polling reads without a popup per request).
function readSessionMessage(d: { ownerWallet: string; nonce: number }): Uint8Array {
  return new TextEncoder().encode(
    ["paif-auto-strategy", "v1", "read-session", d.ownerWallet, String(d.nonce)].join("|"),
  );
}

// Pull the read token from the X-Auto-Strategy-Token header and resolve its
// owner wallet, or null if missing/invalid/expired.
function readTokenOwner(req: any): string | null {
  const token = req.headers["x-auto-strategy-token"];
  if (typeof token !== "string" || !token) return null;
  return verifyReadToken(token);
}

export function registerAutoStrategyRoutes(app: Express): void {
  // Create a strategy. Generates a budget-only trading wallet server-side and
  // returns its address so the user can fund it from their main wallet.
  app.post("/api/auto-strategy/create", async (req, res) => {
    if (!isEncryptionConfigured()) {
      return res.status(503).json({
        error: "The automated strategy bot isn't fully configured yet. Please try again shortly.",
      });
    }
    const parsed = createAutoStrategySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
    }
    const d = parsed.data;
    // Owner-auth: creating a strategy binds a server-held trading wallet to an
    // owner. Require a fresh owner-signed message so callers can't create
    // strategies impersonating arbitrary wallets.
    {
      const { nonce, signature } = req.body ?? {};
      if (typeof nonce !== "number" || typeof signature !== "string") {
        return res.status(401).json({ error: "Signed authorization required." });
      }
      if (Math.abs(Date.now() - nonce) > ACTION_SIG_MAX_AGE_MS) {
        return res.status(401).json({ error: "Authorization expired — please retry." });
      }
      const ok = await verifyEd25519(
        d.ownerWallet,
        signature,
        autoStrategyCreateMessage({ ownerWallet: d.ownerWallet, nonce }),
      );
      if (!ok) return res.status(401).json({ error: "Invalid signature — must be signed by the owner wallet." });
      if (!consumeSignature(signature)) {
        return res.status(401).json({ error: "This authorization was already used — please retry." });
      }
    }
    try {
      const budgetLamports = BigInt(Math.round(d.budgetSol * LAMPORTS_PER_SOL));
      if (budgetLamports < 1_000_000n) {
        return res.status(400).json({ error: "Budget must be at least 0.001 SOL." });
      }

      // Schedule maths: evenly-spaced slices across the window.
      const tradesPerDay = d.tradesPerDay ?? 6;
      const desired = Math.round((tradesPerDay * d.windowHours) / 24);
      let totalSlices = Math.max(2, Math.min(240, desired || 2));
      let buySlices: number;
      if (d.mode === "dca") {
        buySlices = totalSlices; // accumulate only
      } else if (d.mode === "volume") {
        // Volume mode alternates buy (even slice) / sell (odd slice) round-trips
        // by slice parity — buySlices here is bookkeeping only. Force an even
        // count so the run ends on a sell (position returns flat).
        if (totalSlices < 2) totalSlices = 2;
        if (totalSlices % 2 !== 0) totalSlices += 1;
        if (totalSlices > 240) totalSlices = 240;
        buySlices = totalSlices / 2;
      } else {
        buySlices = Math.max(1, Math.floor(totalSlices * 0.6));
        if (totalSlices - buySlices < 1) totalSlices = buySlices + 1; // guarantee ≥1 sell slice
      }

      const windowStartAt = new Date();
      const windowEndAt = new Date(windowStartAt.getTime() + d.windowHours * 3600 * 1000);
      const intervalSeconds = Math.max(30, Math.floor((d.windowHours * 3600) / totalSlices));

      // Generate the primary (funding) wallet + any rotation wallets. The user
      // funds ONLY the primary; the bot auto-splits to the extras on Start.
      const walletCount = Math.max(1, Math.min(10, d.walletCount ?? 1));
      const primary = generateTradingWallet();
      const extras = Array.from({ length: walletCount - 1 }, () => generateTradingWallet());

      const strategy = await storage.createAutoStrategy({
        ownerWallet: d.ownerWallet,
        tradingWallet: primary.pubkey,
        encryptedKey: primary.encryptedKey,
        withdrawAddress: d.ownerWallet, // funds can ONLY ever return to the owner
        name: d.name ?? "My Strategy",
        budgetLamports: budgetLamports.toString(),
        tokens: d.tokens,
        allocationsBps: d.allocationsBps,
        mode: d.mode,
        slippageBps: d.slippageBps ?? 100,
        windowStartAt,
        windowEndAt,
        intervalSeconds,
        totalSlices,
        buySlices,
        walletCount,
        extraWallets: extras.map((e) => e.pubkey),
        extraEncryptedKeys: extras.map((e) => e.encryptedKey),
        keepFunds: d.keepFunds ?? false,
        // Take-profit is opt-in and requires BOTH the profit target and the
        // sell size; a partial pair is treated as "off".
        takeProfitPct:
          d.takeProfitPct != null && d.takeProfitSellPct != null ? d.takeProfitPct : null,
        takeProfitSellBps:
          d.takeProfitPct != null && d.takeProfitSellPct != null ? d.takeProfitSellPct * 100 : null,
      });

      // Recommend funding budget + a buffer for swap/network fees + a per-wallet
      // reserve and the on-chain transfer fees of splitting into the extras + the
      // one-time 0.002 SOL platform setup fee per EXTRA rotation wallet.
      const recommendedFundingLamports =
        (budgetLamports * 106n) / 100n + 10_000n + BigInt(walletCount) * 10_000n +
        BigInt(walletCount - 1) * 2_000_000n;
      res.json({
        strategy: publicStrategy(strategy),
        fundingAddress: primary.pubkey,
        recommendedFundingSol: Number(recommendedFundingLamports) / LAMPORTS_PER_SOL,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to create strategy" });
    }
  });

  // Mint a read-session token. Owner signs once; token authorizes polling reads
  // for READ_TOKEN_TTL_MS without further popups.
  app.post("/api/auto-strategy/auth", async (req, res) => {
    if (!isEncryptionConfigured()) {
      return res.status(503).json({ error: "Automated strategies are not enabled yet." });
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
      res.json({ token: issueReadToken(ownerWallet) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to authorize" });
    }
  });

  // List a wallet's strategies. Read-token gated: token owner must match.
  app.get("/api/auto-strategy/list", async (req, res) => {
    const owner = String(req.query.owner ?? "");
    if (!SOLANA_ADDRESS_REGEX.test(owner)) {
      return res.status(400).json({ error: "A valid owner wallet is required." });
    }
    if (readTokenOwner(req) !== owner) {
      return res.status(401).json({ error: "Unlock with your wallet to view strategies." });
    }
    try {
      const rows = await storage.listAutoStrategiesByOwner(owner);
      res.json({ strategies: rows.map(publicStrategy) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to list strategies" });
    }
  });

  // Strategy detail + execution log + live trading-wallet SOL balance.
  // Read-token gated: token owner must own this strategy.
  app.get("/api/auto-strategy/:id", async (req, res) => {
    try {
      const s = await storage.getAutoStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Strategy not found." });
      if (readTokenOwner(req) !== s.ownerWallet) {
        return res.status(401).json({ error: "Unlock with your wallet to view this strategy." });
      }
      const pubkeys = [s.tradingWallet, ...((s.extraWallets ?? []) as string[])];
      const [executions, balances] = await Promise.all([
        storage.listAutoStrategyExecutions(s.id, 100),
        Promise.all(pubkeys.map((p) => getSolBalanceLamports(p).catch(() => null))),
      ]);
      res.json({
        strategy: publicStrategy(s),
        executions,
        // Primary-wallet balance kept for back-compat; full list for multi-wallet.
        tradingWalletBalanceLamports: balances[0] === null ? null : balances[0]!.toString(),
        walletBalancesLamports: balances.map((b) => (b === null ? null : b.toString())),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to load strategy" });
    }
  });

  // Start / resume — activates once the wallet is funded. Owner-gated.
  app.post("/api/auto-strategy/:id/start", async (req, res) => {
    try {
      const s = await storage.getAutoStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Strategy not found." });
      const authErr = await authorizeAction("start", s, req.body);
      if (authErr) return res.status(authErr.code).json({ error: authErr.error });
      const updated = await tryActivateStrategy(s.id);
      res.json({ strategy: publicStrategy(updated) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to start strategy" });
    }
  });

  // Pause an active strategy (no trades until resumed). Owner-gated.
  app.post("/api/auto-strategy/:id/pause", async (req, res) => {
    try {
      const s = await storage.getAutoStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Strategy not found." });
      const authErr = await authorizeAction("pause", s, req.body);
      if (authErr) return res.status(authErr.code).json({ error: authErr.error });
      if (s.status !== "active") {
        return res.status(400).json({ error: `Strategy is ${s.status}, not active.` });
      }
      const updated = await storage.updateAutoStrategy(s.id, { status: "paused", nextRunAt: null });
      res.json({ strategy: publicStrategy(updated) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to pause strategy" });
    }
  });

  // Cancel + sweep everything back to the owner's main wallet. Owner-gated.
  // Note: funds can ONLY ever go to withdrawAddress (= the owner wallet fixed at
  // creation), so even a spoofed caller cannot redirect funds — worst case is
  // triggering an early sweep to the rightful owner.
  app.post("/api/auto-strategy/:id/cancel", async (req, res) => {
    try {
      const s = await storage.getAutoStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Strategy not found." });
      const authErr = await authorizeAction("cancel", s, req.body);
      if (authErr) return res.status(authErr.code).json({ error: authErr.error });
      await cancelAndWithdrawStrategy(s.id);
      const fresh = await storage.getAutoStrategy(s.id);
      res.json({ strategy: publicStrategy(fresh) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to cancel strategy" });
    }
  });

  // Manual "sell everything now" — liquidate all positions to SOL and sweep the
  // proceeds back to the owner's main wallet, then stop the strategy. Owner-gated.
  // Like cancel, funds can ONLY ever return to withdrawAddress (the owner wallet
  // fixed at creation). Liquidation makes several on-chain sells + a sweep that
  // can exceed the request timeout, so we flip status + kick it off and return;
  // the UI polls the execution log + status for progress.
  app.post("/api/auto-strategy/:id/sell-now", async (req, res) => {
    try {
      const s = await storage.getAutoStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Strategy not found." });
      const authErr = await authorizeAction("sell-now", s, req.body);
      if (authErr) return res.status(authErr.code).json({ error: authErr.error });
      if (s.status === "cancelled") {
        return res.status(400).json({ error: "Strategy is already cancelled." });
      }
      void liquidateStrategyNow(s.id).catch((e) =>
        console.error(`[auto-strategy] sell-now failed for ${s.id}:`, e?.message ?? e),
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to sell" });
    }
  });
}
