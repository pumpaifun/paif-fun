// Telegram shill bot — Bot API helper + hype-copy generation.
//
// Uses a BotFather bot token (TELEGRAM_BOT_TOKEN). No OAuth, no client SDK:
// the Telegram Bot API is plain HTTPS. The bot must be added to each target
// group/channel as a member (and as an admin for channels) before it can post.

const API_BASE = "https://api.telegram.org";

export function getBotToken(): string | null {
  const raw = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  return raw.length > 0 ? raw : null;
}

export function isTelegramConfigured(): boolean {
  return getBotToken() !== null;
}

type TgResult<T> = { ok: true; result: T } | { ok: false; error: string };

async function callBotApi<T = any>(method: string, body?: Record<string, unknown>): Promise<TgResult<T>> {
  const token = getBotToken();
  if (!token) return { ok: false, error: "Telegram bot token is not configured." };
  try {
    const res = await fetch(`${API_BASE}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const json = (await res.json().catch(() => null)) as any;
    if (!json || json.ok !== true) {
      const desc = json?.description || `Telegram API ${method} failed (HTTP ${res.status})`;
      return { ok: false, error: String(desc) };
    }
    return { ok: true, result: json.result as T };
  } catch (e: any) {
    return { ok: false, error: e?.message || `Telegram API ${method} request failed` };
  }
}

export interface BotInfo {
  id: number;
  username: string;
  firstName: string;
}

export async function getBotInfo(): Promise<TgResult<BotInfo>> {
  const r = await callBotApi<any>("getMe");
  if (!r.ok) return r;
  return {
    ok: true,
    result: { id: r.result.id, username: r.result.username, firstName: r.result.first_name },
  };
}

// Send one message. Telegram caps text at 4096 chars; we trim defensively.
export async function sendShill(chatId: string, text: string): Promise<TgResult<{ messageId: number }>> {
  const trimmed = text.length > 4096 ? text.slice(0, 4093) + "…" : text;
  const r = await callBotApi<any>("sendMessage", {
    chat_id: chatId,
    text: trimmed,
    parse_mode: "HTML",
    disable_web_page_preview: false,
    link_preview_options: { is_disabled: false },
  });
  if (!r.ok) return r;
  return { ok: true, result: { messageId: r.result.message_id } };
}

// ─── Hype copy generation ────────────────────────────────────────────────────

export type CopyMode = "ai" | "template";
export type ShillKind = "platform" | "trending" | "custom";

export interface ShillToken {
  symbol?: string;
  name?: string;
  mint?: string;
  price?: number;
  change1h?: number;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

const SITE = "https://paif.fun";

function fmtPrice(p?: number): string {
  if (typeof p !== "number" || !Number.isFinite(p) || p <= 0) return "";
  if (p < 0.000001) return `$${p.toExponential(2)}`;
  if (p < 1) return `$${p.toPrecision(3)}`;
  return `$${p.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
}

function fmtChange(c?: number): string {
  if (typeof c !== "number" || !Number.isFinite(c)) return "";
  const sign = c >= 0 ? "+" : "";
  return `${sign}${c.toFixed(1)}%`;
}

// Hand-written template copy. Each kind has several variants for variety.
function templateCopy(kind: ShillKind, token?: ShillToken): string {
  if (kind === "platform") {
    return pick([
      `🚀 <b>PAIF.fun</b> is how degens stay alive.\n\nScan any Pump.fun token, x-ray the holders, follow the money AFTER launch. Snipe, bump, and run multi-wallet rotations — all non-custodial. Your keys never leave your browser. 🔑\n\n👉 ${SITE}`,
      `🔥 Stop aping blind.\n\n<b>PAIF.fun</b> shows you wallet distribution, whale behavior, and post-launch money flow on every Solana token. Built-in sniper + bump bot. $PAIF holders eat. 🍽️\n\n👉 ${SITE}`,
      `📡 The Pump.fun scanner the snipers don't want you to have.\n\n<b>PAIF.fun</b> — distribution analysis, live launch tracking, multi-wallet bump rotation, and community buybacks. 100% non-custodial.\n\nGet in 👉 ${SITE}`,
    ]);
  }
  if (kind === "trending" || kind === "custom") {
    const sym = token?.symbol ? `$${token.symbol.replace(/^\$/, "")}` : "this token";
    const name = token?.name ? ` (${token.name})` : "";
    const price = fmtPrice(token?.price);
    const change = fmtChange(token?.change1h);
    const stats = [price && `💵 ${price}`, change && `📈 ${change} (1h)`].filter(Boolean).join("   ");
    const scanLink = token?.mint ? `\n\n🔍 Scan it: ${SITE}/scan?mint=${token.mint}` : `\n\n🔍 ${SITE}`;
    return pick([
      `🚨 <b>${sym}</b>${name} is moving.\n${stats ? stats + "\n" : ""}\nDon't ape blind — pull the holder map and money flow first.${scanLink}`,
      `👀 Eyes on <b>${sym}</b>${name}.\n${stats ? stats + "\n" : ""}\nCheck the distribution before it sends. PAIF scans it in seconds.${scanLink}`,
      `🔥 <b>${sym}</b>${name} heating up.\n${stats ? stats + "\n" : ""}\nWhales loading or exit liquidity? Find out before you click buy.${scanLink}`,
    ]);
  }
  return `🚀 PAIF.fun — scan any Solana token before you ape. ${SITE}`;
}

// AI copy via Perplexity (reuses the existing PERPLEXITY_API_KEY). Returns null
// on any failure so callers can fall back to templates.
async function aiCopy(kind: ShillKind, token?: ShillToken): Promise<string | null> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return null;

  let subject: string;
  if (kind === "platform") {
    subject =
      "PAIF.fun — a non-custodial Pump.fun / Solana token scanner with holder-distribution analysis, " +
      "post-launch money-flow tracking, a browser sniper bot, a multi-wallet bump bot, and community buybacks. " +
      "Its token is $PAIF.";
  } else {
    const parts = [
      token?.symbol && `ticker $${token.symbol.replace(/^\$/, "")}`,
      token?.name && `name "${token.name}"`,
      typeof token?.price === "number" && `price ${fmtPrice(token.price)}`,
      typeof token?.change1h === "number" && `1h change ${fmtChange(token.change1h)}`,
    ].filter(Boolean).join(", ");
    subject =
      `a Solana memecoin (${parts || "details unknown"}). Encourage people to scan its holder distribution ` +
      `and money flow on PAIF.fun before buying, and include the scan link.`;
  }

  const scanLink = token?.mint ? `${SITE}/scan?mint=${token.mint}` : SITE;
  const prompt =
    `Write ONE short, high-energy crypto Telegram hype message (max 60 words) shilling ${subject} ` +
    `Use 2-4 relevant emojis, a punchy hook, and end with this link: ${scanLink}. ` +
    `Do NOT invent prices, returns, or guarantees. Do NOT use markdown headers. Output only the message text.`;

  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          {
            role: "system",
            content:
              "You are a crypto community hype writer. You write punchy, exciting Telegram shill posts. " +
              "Never promise gains or financial returns. Never fabricate numbers. Keep it under 60 words.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 220,
        temperature: 0.9,
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    const text = json?.choices?.[0]?.message?.content?.trim();
    if (!text || typeof text !== "string") return null;
    // Strip surrounding quotes/markdown the model sometimes adds.
    return text.replace(/^["'`]+|["'`]+$/g, "").trim();
  } catch {
    return null;
  }
}

// Generate shill copy. AI mode falls back to templates if Perplexity is
// unavailable or errors, so the admin always gets usable text.
export async function generateShillCopy(
  kind: ShillKind,
  mode: CopyMode,
  token?: ShillToken,
): Promise<{ content: string; usedMode: CopyMode }> {
  if (mode === "ai") {
    const ai = await aiCopy(kind, token);
    if (ai) return { content: ai, usedMode: "ai" };
    return { content: templateCopy(kind, token), usedMode: "template" };
  }
  return { content: templateCopy(kind, token), usedMode: "template" };
}
