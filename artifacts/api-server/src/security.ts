import type { Request, Response, NextFunction } from "express";

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
// Applied to every response. The most privacy-relevant one is Referrer-Policy:
// "no-referrer" stops any third-party resource (e.g. a token image hosted on an
// external CDN) from learning which page / token a user is viewing.
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=()",
  );
  next();
}

// ---------------------------------------------------------------------------
// Image URL hardening — anti tracking-pixel / IP harvesting
// ---------------------------------------------------------------------------
// A user-supplied image URL that other users' browsers load would leak each
// viewer's IP address (and, without the header above, their referrer) to
// whatever host serves it — the classic "tracking pixel" deanonymisation trick.
// We only accept https images and reject loopback / private-network / internal
// hosts. Non-http(s) schemes (data:, javascript:, etc.) are rejected too.
export function sanitizeImageUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim();
  if (!s || s.length > 2048) return undefined;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return undefined;
  }
  if (u.protocol !== "https:") return undefined;
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "[::1]" ||
    host.startsWith("[fc") ||
    host.startsWith("[fd")
  ) {
    return undefined;
  }
  return u.toString();
}

// ---------------------------------------------------------------------------
// User text sanitiser
// ---------------------------------------------------------------------------
// React escapes HTML on render, so this is defense in depth: strip control
// characters, zero-width characters, and bidirectional overrides that are used
// to spoof display names or hide/scramble content.
export function sanitizeUserText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, "")
    .trim();
}

// Moderator access is deliberately fail-closed. Keep this separate from
// public post moderation so a moderator's UI cannot accidentally become a
// privilege check based on a client-supplied flag.
export function isModeratorUser(user: unknown): boolean {
  const email = typeof (user as any)?.email === "string"
    ? (user as any).email.trim().toLowerCase()
    : "";
  if (!email) return false;
  const allowlist = (process.env.MODERATOR_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(email);
}

export function requireModeratorUser(
  user: unknown,
  deny: (status: number, body: { error: string }) => void,
): boolean {
  if (isModeratorUser(user)) return true;
  deny(403, { error: "Moderator access required" });
  return false;
}

// ---------------------------------------------------------------------------
// Community post moderation
// ---------------------------------------------------------------------------
// This check is deliberately deterministic and stateless. It examines only
// the sanitized post currently being submitted; it does not log, persist, or
// use request metadata. The public reasons below describe the community rule
// without revealing which phrase or URL triggered the check.
export type CommunityPostModerationResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: string;
    };

const COMMUNITY_MODERATION_REASONS = {
  spam: "This post was not published because community posts should be useful and not repetitive advertising or mass solicitation.",
  seedPhrase: "This post was not published because community posts must never ask for seed phrases, private keys, or wallet recovery details.",
  impersonation: "This post was not published because community posts must not impersonate PAIF.fun, wallet providers, or moderators.",
  link: "This post was not published because community posts must not include unsafe or misleading links.",
} as const;

const REQUEST_WORDS =
  "(?:send|share|post|drop|give|dm|message|provide|reveal|tell|submit|enter|paste|type|input|reply with|respond with)";
const SENSITIVE_WALLET_DETAILS =
  "(?:seed\\s*phrase|recovery\\s*(?:phrase|words?)|secret\\s*phrase|mnemonic(?:\\s*(?:phrase|words?))?|private\\s*key|secret\\s*key|wallet\\s*(?:phrase|words?)|(?:12|24)\\s*words?)";

function normalizeModerationText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function containsSeedPhraseRequest(text: string): boolean {
  const normalized = normalizeModerationText(text);
  if (!normalized) return false;

  // Safety advice such as "never share your seed phrase" is allowed. A
  // negated request is not a request for another member's credentials.
  const protectiveAdvice = new RegExp(
    `\\b(?:never|dont|do not|should not|shouldnt|avoid)\\b.{0,25}\\b${REQUEST_WORDS}\\b.{0,60}\\b${SENSITIVE_WALLET_DETAILS}\\b`,
  );
  if (protectiveAdvice.test(normalized)) return false;

  const requestBeforeDetail = new RegExp(
    `\\b${REQUEST_WORDS}\\b.{0,80}\\b${SENSITIVE_WALLET_DETAILS}\\b`,
  );
  const detailBeforeRequest = new RegExp(
    `\\b${SENSITIVE_WALLET_DETAILS}\\b.{0,80}\\b${REQUEST_WORDS}\\b`,
  );
  return requestBeforeDetail.test(normalized) || detailBeforeRequest.test(normalized);
}

const PROTECTED_IDENTITIES =
  "(?:paif(?:\\s+fun)?|phantom|solflare|jupiter|pump(?:\\s+fun)?|replit)";
const OFFICIAL_ROLES =
  "(?:support|admin|moderator|team|staff|official|helpdesk|security|developer)";

function isImpersonation(displayName: string, message: string): boolean {
  const normalizedName = normalizeModerationText(displayName);
  const normalizedMessage = normalizeModerationText(message);
  const protectedName = new RegExp(`\\b${PROTECTED_IDENTITIES}\\s+${OFFICIAL_ROLES}\\b`);
  if (protectedName.test(normalizedName)) return true;

  const identityClaim = new RegExp(
    `\\b(?:i am|this is|we are|you are speaking with|from|official)\\b.{0,30}\\b${PROTECTED_IDENTITIES}\\b.{0,20}\\b${OFFICIAL_ROLES}\\b`,
  );
  return identityClaim.test(normalizedMessage);
}

function extractLinks(text: string): string[] {
  return (text.match(/\b(?:https?:\/\/|www\.)[^\s<>()]+/gi) ?? [])
    .map((link) => link.replace(/[.,!?;:'"\]}]+$/g, ""))
    .filter(Boolean);
}

function isUnsafeLink(link: string): boolean {
  if (/^(?:javascript|data|vbscript|file):/i.test(link)) return true;

  const candidate = link.startsWith("www.") ? `https://${link}` : link;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return true;
  }

  if (url.protocol !== "https:" || url.username || url.password) return true;

  const host = url.hostname.toLowerCase();
  const isIpv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
  const isPrivateHost =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "0.0.0.0" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.startsWith("[");
  if (isIpv4 || isPrivateHost || host.includes("xn--")) return true;

  const pathAndQuery = `${host}${url.pathname}${url.search}`.toLowerCase();
  const decodedPathAndQuery = (() => {
    try {
      return decodeURIComponent(pathAndQuery);
    } catch {
      return pathAndQuery;
    }
  })();
  const scamLinkTerms =
    /\b(?:airdrop|free[-_ ]?tokens?|token[-_ ]?giveaway|drain|seed[-_ ]?phrase|private[-_ ]?key|connect[-_ ]?wallet|wallet[-_ ]?(?:verify|connect|sync)|verify[-_ ]?(?:wallet|account)|recover[-_ ]?wallet)\b/;
  if (scamLinkTerms.test(decodedPathAndQuery)) return true;

  const knownShortener = /^(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|cutt\.ly|shorturl\.at)$/;
  if (knownShortener.test(host)) return true;

  const officialHosts = [
    ["paif.fun", "paif"],
    ["phantom.app", "phantom"],
    ["solflare.com", "solflare"],
    ["jup.ag", "jupiter"],
    ["jupiter.ag", "jupiter"],
    ["pump.fun", "pump"],
    ["replit.com", "replit"],
    ["replit.dev", "replit"],
  ] as const;
  for (const [officialHost, identity] of officialHosts) {
    if (host.includes(identity) && host !== officialHost && !host.endsWith(`.${officialHost}`)) {
      return true;
    }
  }
  return false;
}

function isRepetitiveSpam(text: string): boolean {
  const words = normalizeModerationText(text).split(/\s+/).filter(Boolean);
  if (words.length < 6) return false;
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  let highestCount = 0;
  counts.forEach((count) => {
    highestCount = Math.max(highestCount, count);
  });
  if (highestCount >= 5 && highestCount / words.length >= 0.45) return true;
  return /\b([a-z0-9]{2,})(?:\s+\1){2,}\b/i.test(words.join(" "));
}

function isPromotionalSpam(text: string): boolean {
  const normalized = normalizeModerationText(text);
  const strongSolicitation =
    /\b(?:guaranteed|risk free|riskfree|double your|free tokens?|buy now|act now|limited time|dm me for|contact me for|join my (?:telegram|whatsapp|discord)|send (?:me )?(?:sol|crypto|funds?|money)|passive income)\b/.test(
      normalized,
    );
  if (strongSolicitation) return true;

  const financialOffer = /\b(?:profit|returns?|signals?|investment|presale|airdrop|giveaway)\b/.test(normalized);
  const contactRequest = /\b(?:dm|message|contact|join|follow)\s+(?:me|us|my|our)\b/.test(normalized);
  const fundsRequest = /\b(?:send|deposit|transfer)\s+(?:sol|crypto|funds?|money)\b/.test(normalized);
  return (financialOffer && (contactRequest || fundsRequest)) || (contactRequest && fundsRequest);
}

export function moderateCommunityPost(
  displayName: string,
  message: string,
): CommunityPostModerationResult {
  if (containsSeedPhraseRequest(`${displayName}\n${message}`)) {
    return { allowed: false, reason: COMMUNITY_MODERATION_REASONS.seedPhrase };
  }
  if (isImpersonation(displayName, message)) {
    return { allowed: false, reason: COMMUNITY_MODERATION_REASONS.impersonation };
  }

  const links = extractLinks(message);
  if (links.length > 2 || links.some(isUnsafeLink) || /(?:javascript|data|vbscript|file):/i.test(message)) {
    return { allowed: false, reason: COMMUNITY_MODERATION_REASONS.link };
  }
  if (isRepetitiveSpam(message) || isPromotionalSpam(message)) {
    return { allowed: false, reason: COMMUNITY_MODERATION_REASONS.spam };
  }
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Lightweight in-memory rate limiter
// ---------------------------------------------------------------------------
// Fixed-window limiter keyed by an arbitrary string (we key social writes by
// the authenticated wallet so it can't be bypassed by spoofing a header IP).
// In-memory is sufficient for abuse throttling on a single instance.
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const globalBuckets = new Map<string, Bucket>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    if (!b && buckets.size >= 10_000) {
      const oldest = buckets.keys().next().value;
      if (oldest) buckets.delete(oldest);
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count += 1;
  return true;
}

// Global budgets use trusted, code-defined keys and live separately from
// attacker-influenced identity buckets, so identity churn cannot evict and
// reset an upstream quota guard.
export function globalRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = globalBuckets.get(key);
  if (!b || now >= b.resetAt) {
    globalBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count += 1;
  return true;
}

// Best-effort client IP for rate-limit bucketing ONLY. Used transiently as a
// limiter key (never stored, never returned to clients) so that rotating a
// spoofable wallet/identity field can't evade abuse throttling. Reads the
// right-most x-forwarded-for entry appended by the Replit proxy, else the
// socket. A caller can forge values to the left, but not the proxy-appended hop.
export function clientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length) {
    const last = xff.split(",").at(-1)?.trim();
    if (last) return last;
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

const cleanup = setInterval(() => {
  const now = Date.now();
  buckets.forEach((b, k) => {
    if (now >= b.resetAt) buckets.delete(k);
  });
  globalBuckets.forEach((b, k) => {
    if (now >= b.resetAt) globalBuckets.delete(k);
  });
}, 60_000);
cleanup.unref?.();
