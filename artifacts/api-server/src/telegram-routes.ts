import type { Express, Request } from "express";
import { storage } from "./storage";
import { getTreasuryAddress } from "./credits";
import {
  isTelegramConfigured,
  getBotInfo,
  sendShill,
  generateShillCopy,
  type CopyMode,
  type ShillKind,
  type ShillToken,
} from "./telegram";
import { TELEGRAM_SHILL_KINDS } from "@workspace/db";

// Treasury-signed authorization. Mirrors the app's existing signed-message
// pattern (auto-strategy / bump delegation): the treasury wallet signs a
// canonical, nonce-bound message; the server verifies the ed25519 signature,
// freshness, and single-use replay guard. Posting to Telegram and editing the
// destination list are treasury-only actions.
const SIG_MAX_AGE_MS = 5 * 60 * 1000;

const usedSignatures = new Map<string, number>();
function consumeSignature(sig: string): boolean {
  const now = Date.now();
  if (usedSignatures.size > 2000) {
    usedSignatures.forEach((exp, k) => { if (exp < now) usedSignatures.delete(k); });
  }
  const existing = usedSignatures.get(sig);
  if (existing && existing > now) return false;
  usedSignatures.set(sig, now + SIG_MAX_AGE_MS);
  return true;
}

function actionMessage(action: string, treasury: string, nonce: number): Uint8Array {
  return new TextEncoder().encode(["paif-telegram", "v1", action, treasury, String(nonce)].join("|"));
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

// Returns null on success, or an error tuple to send back.
async function authorize(action: string, body: any): Promise<{ code: number; error: string } | null> {
  const treasury = getTreasuryAddress();
  const { nonce, signature } = body ?? {};
  if (typeof nonce !== "number" || typeof signature !== "string") {
    return { code: 401, error: "Signed authorization required." };
  }
  if (Math.abs(Date.now() - nonce) > SIG_MAX_AGE_MS) {
    return { code: 401, error: "Authorization expired — please retry." };
  }
  const ok = await verifyEd25519(treasury, signature, actionMessage(action, treasury, nonce));
  if (!ok) return { code: 401, error: "Invalid signature — must be signed by the treasury wallet." };
  if (!consumeSignature(signature)) {
    return { code: 401, error: "This authorization was already used — please retry." };
  }
  return null;
}

function noStore(res: any) {
  res.set("Cache-Control", "no-store");
}

function parseToken(raw: any): ShillToken | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const t: ShillToken = {};
  if (typeof raw.symbol === "string") t.symbol = raw.symbol.slice(0, 32);
  if (typeof raw.name === "string") t.name = raw.name.slice(0, 64);
  if (typeof raw.mint === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(raw.mint)) t.mint = raw.mint;
  if (typeof raw.price === "number" && Number.isFinite(raw.price)) t.price = raw.price;
  if (typeof raw.change1h === "number" && Number.isFinite(raw.change1h)) t.change1h = raw.change1h;
  return t;
}

function parseKind(raw: any): ShillKind | null {
  return TELEGRAM_SHILL_KINDS.includes(raw) ? (raw as ShillKind) : null;
}

export function registerTelegramRoutes(app: Express) {
  // Status — is the bot wired up, and which wallet may operate it.
  app.get("/api/telegram/admin/status", async (_req: Request, res) => {
    noStore(res);
    const configured = isTelegramConfigured();
    let botUsername: string | null = null;
    let botError: string | null = null;
    if (configured) {
      const info = await getBotInfo();
      if (info.ok) botUsername = info.result.username;
      else botError = info.error;
    }
    res.json({ configured, botUsername, botError, treasury: getTreasuryAddress() });
  });

  // List destinations (not sensitive — chat ids are not secrets).
  app.get("/api/telegram/admin/destinations", async (_req: Request, res) => {
    noStore(res);
    res.json({ destinations: await storage.listTelegramDestinations() });
  });

  // Recent post history.
  app.get("/api/telegram/admin/posts", async (_req: Request, res) => {
    noStore(res);
    res.json({ posts: await storage.listTelegramPosts(25) });
  });

  // Preview copy — returns text only, no side effects. Template generation is
  // free string formatting and stays open; AI generation hits a paid external
  // API (Perplexity) so it requires a treasury signature to prevent anonymous
  // cost-amplification abuse.
  app.post("/api/telegram/admin/generate", async (req: Request, res) => {
    noStore(res);
    const kind = parseKind(req.body?.kind);
    if (!kind) return res.status(400).json({ error: "Invalid shill kind." });
    const mode: CopyMode = req.body?.copyMode === "ai" ? "ai" : "template";
    const token = parseToken(req.body?.token);
    if ((kind === "trending" || kind === "custom") && !token?.mint) {
      return res.status(400).json({ error: "A valid token mint is required for this shill type." });
    }
    if (mode === "ai") {
      const authErr = await authorize("generate", req.body);
      if (authErr) return res.status(authErr.code).json({ error: authErr.error });
    }
    const { content, usedMode } = await generateShillCopy(kind, mode, token);
    res.json({ content, usedMode });
  });

  // Add / upsert a destination — treasury-signed.
  app.post("/api/telegram/admin/destinations", async (req: Request, res) => {
    noStore(res);
    const authErr = await authorize("add-destination", req.body);
    if (authErr) return res.status(authErr.code).json({ error: authErr.error });
    const chatId = typeof req.body?.chatId === "string" ? req.body.chatId.trim() : "";
    const label = typeof req.body?.label === "string" ? req.body.label.trim().slice(0, 80) : "";
    if (chatId.length < 2 || chatId.length > 128) {
      return res.status(400).json({ error: "Enter a valid chat id or @username." });
    }
    const row = await storage.addTelegramDestination({ chatId, label, enabled: true });
    res.json({ destination: row });
  });

  // Toggle a destination on/off — treasury-signed.
  app.post("/api/telegram/admin/destinations/toggle", async (req: Request, res) => {
    noStore(res);
    const authErr = await authorize("toggle-destination", req.body);
    if (authErr) return res.status(authErr.code).json({ error: authErr.error });
    const id = typeof req.body?.id === "string" ? req.body.id : "";
    const enabled = !!req.body?.enabled;
    if (!id) return res.status(400).json({ error: "Missing destination id." });
    const row = await storage.setTelegramDestinationEnabled(id, enabled);
    if (!row) return res.status(404).json({ error: "Destination not found." });
    res.json({ destination: row });
  });

  // Remove a destination — treasury-signed.
  app.post("/api/telegram/admin/destinations/remove", async (req: Request, res) => {
    noStore(res);
    const authErr = await authorize("remove-destination", req.body);
    if (authErr) return res.status(authErr.code).json({ error: authErr.error });
    const id = typeof req.body?.id === "string" ? req.body.id : "";
    if (!id) return res.status(400).json({ error: "Missing destination id." });
    await storage.deleteTelegramDestination(id);
    res.json({ ok: true });
  });

  // Blast a shill to the selected destinations — treasury-signed.
  app.post("/api/telegram/admin/send", async (req: Request, res) => {
    noStore(res);
    const authErr = await authorize("send", req.body);
    if (authErr) return res.status(authErr.code).json({ error: authErr.error });

    if (!isTelegramConfigured()) {
      return res.status(400).json({ error: "Telegram bot token is not configured." });
    }

    const kind = parseKind(req.body?.kind) ?? "platform";
    const copyMode: CopyMode = req.body?.copyMode === "ai" ? "ai" : "template";
    const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
    const token = parseToken(req.body?.token);
    const destinationIds: string[] = Array.isArray(req.body?.destinationIds)
      ? req.body.destinationIds.filter((x: any) => typeof x === "string")
      : [];

    if (content.length < 1) return res.status(400).json({ error: "Message is empty." });
    if (content.length > 4096) return res.status(400).json({ error: "Message exceeds 4096 characters." });
    if (destinationIds.length === 0) return res.status(400).json({ error: "Select at least one destination." });

    const all = await storage.listTelegramDestinations();
    const selected = all.filter((d) => destinationIds.includes(d.id) && d.enabled);
    if (selected.length === 0) {
      return res.status(400).json({ error: "No enabled destinations matched your selection." });
    }

    const results: { id: string; label: string; ok: boolean; error?: string }[] = [];
    for (const dest of selected) {
      const r = await sendShill(dest.chatId, content);
      results.push({
        id: dest.id,
        label: dest.label || dest.chatId,
        ok: r.ok,
        error: r.ok ? undefined : r.error,
      });
    }

    const sentCount = results.filter((r) => r.ok).length;
    const failCount = results.length - sentCount;

    await storage.logTelegramPost({
      kind,
      copyMode,
      content,
      tokenMint: token?.mint ?? null,
      tokenSymbol: token?.symbol ?? null,
      targets: selected.map((d) => d.label || d.chatId),
      sentCount,
      failCount,
    });

    res.json({ sentCount, failCount, results });
  });
}
