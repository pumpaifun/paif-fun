import type { Express } from "express";
import type { AlphaOversightEvidence } from "@workspace/api-zod";
import { desc, eq, sql } from "drizzle-orm";
import { alphaOversightBriefs } from "@workspace/db/schema";
import { db } from "./db";
import { getTreasuryAddress } from "./credits";
import { storage } from "./storage";
import { getPumpApiLeaderboardStatus } from "./pumpapi-leaderboard";
import { briefAuthorizationSchema, buildOversightBrief, oversightMessage } from "./paif-alpha-oversight-rules";

const startedAt = new Date().toISOString();
let briefInFlight = false;
let nextBriefAt = 0;

async function collectOversightEvidence(): Promise<AlphaOversightEvidence[]> {
  const observedAt = new Date();
  const market = getPumpApiLeaderboardStatus();
  const evidence: AlphaOversightEvidence[] = [{
    area: "market",
    source: "PAIF PumpAPI stream status",
    status: market.connected && market.fresh && !market.persistenceDegraded ? "observed" : "degraded",
    observedAt,
    facts: [
      `Stream connected: ${market.connected}; fresh: ${market.fresh}.`,
      `Last stream event: ${market.lastEventAt ?? "not observed"}.`,
      `Persistence degraded: ${market.persistenceDegraded}; queue depth: ${market.queueDepth}.`,
      `Dropped writes: ${market.droppedWrites}; trade persistence errors: ${market.tradePersistErrors}.`,
    ],
    limitations: ["Covers the PumpAPI stream only, not every market provider or token quote."],
  }];

  // Aggregate fixed, server-owned windows. Never select worker keys, wallet
  // identities, token labels, arbitrary messages, or client-authored evidence.
  const [paper, payments] = await Promise.allSettled([
    db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '5000ms'`);
      return tx.execute(sql`
        SELECT count(*)::int AS trades,
          count(*) FILTER (WHERE sol_out_lamports::numeric > sol_in_lamports::numeric)::int AS wins,
          coalesce(sum(sol_out_lamports::numeric - sol_in_lamports::numeric), 0)::text AS net
        FROM swing_positions
        WHERE mode = 'paper' AND status = 'closed'
          AND sol_out_lamports IS NOT NULL AND closed_at >= now() - interval '7 days'`);
    }),
    db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '5000ms'`);
      return tx.execute(sql`
        SELECT 'access_pass' AS kind, count(*)::int AS purchases, max(created_at) AS latest
          FROM access_pass_purchases WHERE created_at >= now() - interval '24 hours'
        UNION ALL
        SELECT 'bot_credits' AS kind, count(*)::int AS purchases, max(created_at) AS latest
          FROM bump_credit_purchases WHERE created_at >= now() - interval '24 hours'`);
    }),
  ]);

  if (paper.status === "fulfilled") {
    const row = paper.value.rows[0] as { trades: number; wins: number; net: string };
    const netSol = Number(row.net) / 1e9;
    evidence.push({
      area: "paper", source: "PAIF settled Paper Swing positions, last 7 days", observedAt,
      status: !Number.isFinite(netSol) ? "unknown" : netSol < 0 ? "degraded" : row.trades < 10 ? "unknown" : "observed",
      facts: [`Settled trades: ${row.trades}; wins: ${row.wins}.`,
        `Recorded exit proceeds minus entry cost: ${Number.isFinite(netSol) ? netSol.toFixed(6) + " simulated SOL" : "unavailable"}.`],
      limitations: ["Paper only; no open-position valuation or live performance.",
        "Not a complete fee-adjusted portfolio return; excludes deleted strategies and other bot types.",
        ...(row.trades < 10 ? ["Fewer than 10 settled trades: insufficient performance history."] : [])],
    });
  } else {
    evidence.push({ area: "paper", source: "PAIF settled Paper Swing positions", observedAt,
      status: "unknown", facts: [], limitations: ["The bounded database read failed; no performance conclusion is available."] });
  }

  evidence.push({
    area: "payments", source: "PAIF verified purchase receipts, last 24 hours", observedAt,
    status: "unknown",
    facts: payments.status === "fulfilled" ? payments.value.rows.map((row: any) =>
      `${row.kind}: ${row.purchases} verified purchases; latest: ${row.latest ? new Date(row.latest).toISOString() : "none"}.`) : [],
    limitations: payments.status === "fulfilled"
      ? ["Verified receipts are observed, but failed or pending payments are not tracked here.",
        "No end-to-end payment probe was run; zero purchases does not prove a failure or a healthy checkout."]
      : ["The bounded receipt read failed; payment health is unknown."],
  });
  evidence.push({
    area: "release", source: "Current PAIF API process", observedAt, status: "unknown",
    facts: [`Current API process initialized at ${startedAt}; request served at ${observedAt}.`],
    limitations: ["No trusted release-validation receipt is connected to this process.",
      "Serving a request does not prove deployment, build, or contract checks passed."],
  });
  return evidence;
}

function publicBrief(row: typeof alphaOversightBriefs.$inferSelect) {
  const { ownerWallet: _owner, ...brief } = row;
  return brief;
}

export function registerAlphaOversightRoutes(app: Express) {
  app.get("/api/paif-alpha/oversight", (_req, res) => {
    res.set("Cache-Control", "no-store").json({
      ownerWallet: getTreasuryAddress(), advisoryOnly: true, engine: "rules-based-fallback",
    });
  });
  for (const action of ["request", "history"] as const) {
    const path = action === "request" ? "/api/paif-alpha/briefs" : "/api/paif-alpha/briefs/history";
    app.post(path, async (req, res) => {
      res.set("Cache-Control", "no-store");
      const parsed = briefAuthorizationSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Only a signed oversight request is accepted; instructions and evidence are not accepted." });
      const { nonce, signature } = parsed.data;
      if (Math.abs(Date.now() - nonce) > 5 * 60_000) return res.status(401).json({ error: "Owner authorization expired. Sign a new request." });
      const owner = getTreasuryAddress();
      const { ed25519 } = await import("@noble/curves/ed25519");
      const bs58 = (await import("bs58")).default;
      let verified = false;
      try {
        verified = ed25519.verify(bs58.decode(signature), oversightMessage(action, owner, nonce), bs58.decode(owner));
      } catch { /* Malformed signatures fail closed. */ }
      if (!verified) return res.status(401).json({ error: "The PAIF owner treasury wallet must sign this request." });
      try {
        if (!await storage.consumeWalletWriteSignature(signature, `alpha-oversight-${action}`, owner)) {
          return res.status(409).json({ error: "This authorization was already used. Sign a new request." });
        }
        if (action === "history") {
          const rows = await db.select().from(alphaOversightBriefs)
            .where(eq(alphaOversightBriefs.ownerWallet, owner))
            .orderBy(desc(alphaOversightBriefs.generatedAt), desc(alphaOversightBriefs.id)).limit(20);
          return res.json(rows.map(publicBrief));
        }
        if (briefInFlight || Date.now() < nextBriefAt) {
          return res.status(429).json({ error: "Wait one minute between briefs. Sign a new request when ready." });
        }
        briefInFlight = true;
        nextBriefAt = Date.now() + 60_000;
        try {
          const result = buildOversightBrief(await collectOversightEvidence());
          const [row] = await db.insert(alphaOversightBriefs).values({ ownerWallet: owner, ...result }).returning();
          return res.status(201).json(publicBrief(row));
        } finally {
          briefInFlight = false;
        }
      } catch (error) {
        req.log.error({ err: error }, "Alpha oversight storage failed");
        return res.status(503).json({ error: "Brief storage is unavailable. No agent action was attempted; reload signed history before requesting another brief." });
      }
    });
  }
}
