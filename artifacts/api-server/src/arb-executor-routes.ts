import type { Express } from "express";
import { createArbStrategySchema } from "@workspace/db";
import { storage } from "./storage";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  generateWorkerWallet,
  tryActivateArbStrategy,
  pauseArbStrategy,
  stopAndWithdrawArbStrategy,
  getSolBalanceLamports,
  isEncryptionConfigured,
  issueReadToken,
  verifyReadToken,
  HARD_MAX_TRADE_USD,
  HARD_MAX_BUDGET_LAMPORTS,
} from "./arb-executor";

const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ACTION_SIG_MAX_AGE_MS = 5 * 60 * 1000;

// Public shape — NEVER includes the encrypted key.
function publicStrategy(s: any) {
  return {
    id: s.id,
    ownerWallet: s.ownerWallet,
    workerWallet: s.workerWallet,
    withdrawAddress: s.withdrawAddress,
    name: s.name,
    mode: s.mode,
    status: s.status,
    budgetLamports: s.budgetLamports,
    spentLamports: s.spentLamports,
    maxTradeUsd: s.maxTradeUsd,
    minNetEdgeBps: s.minNetEdgeBps,
    slippageBps: s.slippageBps,
    targetMode: s.targetMode,
    targetMints: s.targetMints ?? [],
    lossStopCount: s.lossStopCount,
    consecutiveLosses: s.consecutiveLosses,
    tradesExecuted: s.tradesExecuted,
    wins: s.wins,
    realizedPnlLamports: s.realizedPnlLamports,
    paperPnlMicroUsd: s.paperPnlMicroUsd,
    intervalSeconds: s.intervalSeconds,
    nextRunAt: s.nextRunAt,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

// Defense-in-depth replay protection: a verified signature is single-use within
// its freshness window.
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
    ["paif-arb-executor", "v1", d.action, d.strategyId, d.ownerWallet, String(d.nonce)].join("|"),
  );
}
function createMessage(d: { ownerWallet: string; nonce: number }): Uint8Array {
  return new TextEncoder().encode(
    ["paif-arb-executor", "v1", "create", d.ownerWallet, String(d.nonce)].join("|"),
  );
}
function readSessionMessage(d: { ownerWallet: string; nonce: number }): Uint8Array {
  return new TextEncoder().encode(
    ["paif-arb-executor", "v1", "read-session", d.ownerWallet, String(d.nonce)].join("|"),
  );
}

// Returns null on success, or an HTTP error tuple to send.
async function authorizeAction(
  action: string,
  strategy: { id: string; ownerWallet: string },
  body: any,
): Promise<{ code: number; error: string } | null> {
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
  const token = req.headers["x-arb-token"];
  if (typeof token !== "string" || !token) return null;
  return verifyReadToken(token);
}

export function registerArbExecutorRoutes(app: Express): void {
  // Create an arb bot. Generates a budget-only worker wallet server-side.
  app.post("/api/arb-bot/create", async (req, res) => {
    if (!isEncryptionConfigured()) {
      return res.status(503).json({ error: "The arbitrage executor isn't fully configured yet." });
    }
    const parsed = createArbStrategySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
    }
    const d = parsed.data;
    if (d.mode === "paper") {
      const access = await storage.getAccessPass(d.ownerWallet);
      if (!access.active) {
        return res.status(402).json({
          error: "Paper arbitrage requires an active Access Pass or your one-time 3-day trial.",
          code: "ACCESS_PASS_REQUIRED",
        });
      }
    }
    {
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
      // Hard caps (belt + suspenders over the zod schema).
      const maxTradeUsd = Math.min(d.maxTradeUsd, HARD_MAX_TRADE_USD);
      let budgetLamports = 0n;
      if (d.mode === "live") {
        budgetLamports = BigInt(Math.round((d.budgetSol ?? 0) * LAMPORTS_PER_SOL));
        if (budgetLamports > HARD_MAX_BUDGET_LAMPORTS) budgetLamports = HARD_MAX_BUDGET_LAMPORTS;
        if (budgetLamports < 2_000_000n) {
          return res.status(400).json({ error: "Live budget must be at least 0.002 SOL." });
        }
      }
      const minNetEdgeBps = Math.round(d.minNetEdgePct * 100);
      const worker = generateWorkerWallet();
      // Paper bots start running immediately; live bots wait for funding.
      const status = d.mode === "live" ? "awaiting_funds" : "active";

      const strategy = await storage.createArbStrategy({
        ownerWallet: d.ownerWallet,
        workerWallet: worker.pubkey,
        encryptedKey: worker.encryptedKey,
        withdrawAddress: d.ownerWallet,
        name: d.name ?? (d.mode === "live" ? "Live Arb Bot" : "Paper Arb Bot"),
        mode: d.mode,
        status,
        budgetLamports: budgetLamports.toString(),
        maxTradeUsd,
        minNetEdgeBps,
        slippageBps: d.slippageBps ?? 100,
        targetMode: d.targetMode,
        targetMints: d.targetMode === "list" ? (d.targetMints ?? []) : [],
        lossStopCount: d.lossStopCount ?? 3,
        intervalSeconds: d.intervalSeconds ?? 30,
        nextRunAt: status === "active" ? new Date() : null,
      });

      // Recommend budget + a fee buffer + reserve for live funding.
      const recommendedFundingLamports = budgetLamports + budgetLamports / 20n + 10_000n;
      res.json({
        strategy: publicStrategy(strategy),
        fundingAddress: worker.pubkey,
        recommendedFundingSol: d.mode === "live" ? Number(recommendedFundingLamports) / LAMPORTS_PER_SOL : 0,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to create arb bot" });
    }
  });

  // Mint a read-session token (owner signs once).
  app.post("/api/arb-bot/auth", async (req, res) => {
    if (!isEncryptionConfigured()) {
      return res.status(503).json({ error: "The arbitrage executor is not enabled yet." });
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

  // List a wallet's arb bots. Read-token gated.
  app.get("/api/arb-bot/list", async (req, res) => {
    const owner = String(req.query.owner ?? "");
    if (!SOLANA_ADDRESS_REGEX.test(owner)) {
      return res.status(400).json({ error: "A valid owner wallet is required." });
    }
    if (readTokenOwner(req) !== owner) {
      return res.status(401).json({ error: "Unlock with your wallet to view your arb bots." });
    }
    try {
      const rows = await storage.listArbStrategiesByOwner(owner);
      res.json({ strategies: rows.map(publicStrategy) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to list arb bots" });
    }
  });

  // Detail + execution log + live worker-wallet SOL balance. Read-token gated.
  app.get("/api/arb-bot/:id", async (req, res) => {
    try {
      const s = await storage.getArbStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Arb bot not found." });
      if (readTokenOwner(req) !== s.ownerWallet) {
        return res.status(401).json({ error: "Unlock with your wallet to view this arb bot." });
      }
      const [executions, balance] = await Promise.all([
        storage.listArbExecutions(s.id, 100),
        getSolBalanceLamports(s.workerWallet).catch(() => null),
      ]);
      res.json({
        strategy: publicStrategy(s),
        executions,
        workerWalletBalanceLamports: balance === null ? null : balance.toString(),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to load arb bot" });
    }
  });

  // Start / resume. Owner-gated.
  app.post("/api/arb-bot/:id/start", async (req, res) => {
    try {
      const s = await storage.getArbStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Arb bot not found." });
      const authErr = await authorizeAction("start", s, req.body);
      if (authErr) return res.status(authErr.code).json({ error: authErr.error });
      const updated = await tryActivateArbStrategy(s.id);
      res.json({ strategy: publicStrategy(updated) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to start arb bot" });
    }
  });

  // Pause. Owner-gated.
  app.post("/api/arb-bot/:id/pause", async (req, res) => {
    try {
      const s = await storage.getArbStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Arb bot not found." });
      const authErr = await authorizeAction("pause", s, req.body);
      if (authErr) return res.status(authErr.code).json({ error: authErr.error });
      if (s.status !== "active") return res.status(400).json({ error: `Arb bot is ${s.status}, not active.` });
      const updated = await pauseArbStrategy(s.id);
      res.json({ strategy: publicStrategy(updated) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to pause arb bot" });
    }
  });

  // Stop + sweep funds back to the owner (live). Owner-gated. Funds can ONLY
  // ever go to withdrawAddress (the owner wallet fixed at creation).
  app.post("/api/arb-bot/:id/stop", async (req, res) => {
    try {
      const s = await storage.getArbStrategy(req.params.id);
      if (!s) return res.status(404).json({ error: "Arb bot not found." });
      const authErr = await authorizeAction("stop", s, req.body);
      if (authErr) return res.status(authErr.code).json({ error: authErr.error });
      void stopAndWithdrawArbStrategy(s.id).catch((e) =>
        console.error(`[arb-executor] stop failed for ${s.id}:`, e?.message ?? e),
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to stop arb bot" });
    }
  });
}
