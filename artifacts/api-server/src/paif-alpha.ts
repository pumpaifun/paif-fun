import type { Express } from "express";
import { z } from "zod";
import { storage } from "./storage";
import { getTreasuryAddress, SOLANA_ADDRESS_REGEX } from "./credits";
import {
  addStatelessModelReview,
  alphaLanePickInputSchema,
  alphaReviewInputSchema,
  buildLanePick,
  buildRulesReview,
} from "./paif-alpha-review";

const CLAWPUMP_BASE_URL = "https://clawpump.tech/api/v1";
const TRANSFER_SIG_MAX_AGE_MS = 5 * 60 * 1000;
const transferSchema = z.object({
  asset: z.enum(["SOL", "USDC"]),
  amount: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/).max(24),
  destination: z.string().regex(SOLANA_ADDRESS_REGEX),
  nonce: z.number().int(),
  signature: z.string().min(80).max(100),
}).strict();
let statusCache: { expiresAt: number; value: unknown } | null = null;
const reviewLimits = new Map<string, { windowAt: number; count: number }>();
let globalReviewLimit = { windowAt: Date.now(), count: 0 };

async function clawPumpGet(path: string) {
  const apiKey = process.env.CLAWPUMP_API_KEY;
  if (!apiKey) throw new Error("PAIF Alpha is not configured.");
  const response = await fetch(`${CLAWPUMP_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await response.json() as any;
  if (!response.ok) throw new Error(payload?.error || `Claw Pump request failed (${response.status}).`);
  return payload;
}

async function clawPumpPost(path: string, body: unknown) {
  const apiKey = process.env.CLAWPUMP_API_KEY;
  if (!apiKey) throw new Error("PAIF Alpha is not configured.");
  const response = await fetch(`${CLAWPUMP_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(125_000),
  });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    const error = new Error(payload?.error || `Claw Pump request failed (${response.status}).`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload;
}

function transferMessage(d: {
  asset: "SOL" | "USDC";
  amount: string;
  destination: string;
  treasury: string;
  nonce: number;
}): Uint8Array {
  return new TextEncoder().encode([
    "paif-claw-transfer",
    "v1",
    d.asset,
    d.amount,
    d.destination,
    d.treasury,
    String(d.nonce),
  ].join("|"));
}

async function verifyTransferSignature(
  treasury: string,
  signature: string,
  message: Uint8Array,
): Promise<boolean> {
  try {
    const { ed25519 } = await import("@noble/curves/ed25519");
    const bs58 = (await import("bs58")).default;
    const publicKey = bs58.decode(treasury);
    const decodedSignature = bs58.decode(signature);
    return publicKey.length === 32 &&
      decodedSignature.length === 64 &&
      ed25519.verify(decodedSignature, message, publicKey);
  } catch {
    return false;
  }
}

async function getAlphaStatus() {
  if (statusCache && statusCache.expiresAt > Date.now()) return statusCache.value;
  const agentId = process.env.CLAWPUMP_AGENT_ID;
  if (!agentId) throw new Error("PAIF Alpha agent ID is not configured.");
  const [agentPayload, skillsPayload] = await Promise.all([
    clawPumpGet(`/agents/${encodeURIComponent(agentId)}`),
    clawPumpGet("/skills"),
  ]);
  const agent = agentPayload.agent ?? agentPayload;
  const skillCatalog = skillsPayload.skills ?? [];
  const descriptions = new Map(skillCatalog.map((skill: any) => [skill.slug, skill.description]));
  const value = {
    id: agent.id,
    name: agent.name,
    status: agent.status,
    model: agent.model,
    walletAddress: agent.walletAddress ?? agent.wallet_address,
    isPublic: Boolean(agent.isPublic ?? agent.is_public),
    skills: (agent.skills ?? []).map((slug: string) => ({
      slug,
      description: descriptions.get(slug) ?? "Claw Pump agent capability",
      transactionCapable: ["trading", "perps", "private-transfers", "wallet", "sniper", "token-sniper", "skill-management"].includes(slug),
    })),
    operatingMode: "Monitoring and advisory only",
    reviewEngine: "Independent second opinion + PAIF safety checks",
    clawTurnsEnabled: false,
    transferTurnsEnabled: (agent.skills ?? []).includes("private-transfers") || (agent.skills ?? []).includes("wallet-ops"),
    transferAuthority: getTreasuryAddress(),
    safeguards: [
      "Alpha only reviews the market and bot details shown in PAIF",
      "Alpha cannot place trades or change your bot settings",
      "PAIF bots can still follow the settings you approved",
      "Alpha cannot access your wallet or move your funds",
      "A separate treasury-signed action can move SOL or USDC already held by the Claw Pump agent",
      "Alpha cannot publish, withdraw, or change wallet controls",
      "You make the final decision on every Alpha recommendation",
    ],
    checkedAt: new Date().toISOString(),
  };
  statusCache = { expiresAt: Date.now() + 20_000, value };
  return value;
}

export function registerPaifAlphaRoutes(app: Express) {
  const consumeReviewLimit = (req: any, res: any) => {
    const now = Date.now();
    if (now - globalReviewLimit.windowAt >= 60_000) globalReviewLimit = { windowAt: now, count: 0 };
    const clientKey = req.ip || "unknown";
    const prior = reviewLimits.get(clientKey);
    const clientLimit = !prior || now - prior.windowAt >= 60_000 ? { windowAt: now, count: 0 } : prior;
    if (globalReviewLimit.count >= 300 || clientLimit.count >= 60) {
      res.status(429).json({ error: "Alpha review limit reached. Try again shortly." });
      return false;
    }
    globalReviewLimit.count += 1;
    clientLimit.count += 1;
    reviewLimits.set(clientKey, clientLimit);
    if (reviewLimits.size > 1_000) {
      for (const [key, value] of reviewLimits) if (now - value.windowAt >= 60_000) reviewLimits.delete(key);
    }
    return true;
  };

  app.get("/api/paif-alpha/status", async (_req, res) => {
    try {
      res.json(await getAlphaStatus());
    } catch (error: any) {
      res.status(503).json({
        error: error?.message || "PAIF Alpha status is unavailable.",
        status: "unavailable",
        checkedAt: new Date().toISOString(),
      });
    }
  });

  app.post("/api/paif-alpha/review", async (req, res) => {
    if (!consumeReviewLimit(req, res)) return;
    const parsed = alphaReviewInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid bounded review evidence." });
    const input = parsed.data;
    const rulesReview = buildRulesReview(input);
    res.json(await addStatelessModelReview(input, rulesReview));
  });

  app.post("/api/paif-alpha/lane-pick", (req, res) => {
    if (!consumeReviewLimit(req, res)) return;
    const parsed = alphaLanePickInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid bounded lane evidence." });
    res.json(buildLanePick(parsed.data));
  });

  app.post("/api/paif-alpha/private-transfer", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const parsed = transferSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid private-transfer request." });

    const input = parsed.data;
    const amount = Number(input.amount);
    const maximum = input.asset === "SOL" ? 5 : 1_000;
    if (!Number.isFinite(amount) || amount <= 0 || amount > maximum) {
      return res.status(400).json({ error: `${input.asset} amount must be greater than zero and no more than ${maximum}.` });
    }
    if (Math.abs(Date.now() - input.nonce) > TRANSFER_SIG_MAX_AGE_MS) {
      return res.status(401).json({ error: "Transfer authorization expired. Review and sign it again." });
    }

    const treasury = getTreasuryAddress();
    const verified = await verifyTransferSignature(
      treasury,
      input.signature,
      transferMessage({ ...input, treasury }),
    );
    if (!verified) {
      return res.status(401).json({ error: "Invalid signature. The PAIF treasury wallet must authorize this transfer." });
    }

    // Consume before the non-idempotent upstream call. A timeout has an
    // uncertain outcome and must never be retried with the same authorization.
    const consumed = await storage.consumeWalletWriteSignature(
      input.signature,
      "claw-private-transfer",
      treasury,
    );
    if (!consumed) {
      return res.status(409).json({ error: "This transfer authorization was already used. Check Claw Pump and Solscan before doing anything else." });
    }

    const agentId = process.env.CLAWPUMP_AGENT_ID;
    if (!agentId) return res.status(503).json({ error: "PAIF Alpha agent ID is not configured." });
    const message = [
      "Use the agent_send tool exactly once.",
      `Send exactly ${input.amount} ${input.asset} to ${input.destination}.`,
      "Do not change the asset, amount, or destination.",
      "Do not use any other tool and do not retry if the transfer fails.",
      "If the destination is not whitelisted or the transfer cannot be completed, take no alternative action and report the failure.",
    ].join(" ");

    try {
      const payload = await clawPumpPost(`/agents/${encodeURIComponent(agentId)}/chat`, {
        message,
        temperature: 0,
      });
      return res.json({
        submitted: true,
        outcome: "reported",
        content: typeof payload?.content === "string" ? payload.content.slice(0, 2_000) : "Claw Pump completed the agent turn.",
        destination: input.destination,
        asset: input.asset,
        amount: input.amount,
      });
    } catch (error: any) {
      const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
      return res.status(timedOut ? 504 : (error?.status === 402 ? 402 : 502)).json({
        error: timedOut
          ? "Claw Pump did not answer before the timeout. The transfer outcome is uncertain. Check the Claw Pump dashboard and Solscan; do not submit it again blindly."
          : (error?.message || "Claw Pump could not run the private transfer."),
        outcome: timedOut ? "uncertain" : "not_confirmed",
      });
    }
  });
}