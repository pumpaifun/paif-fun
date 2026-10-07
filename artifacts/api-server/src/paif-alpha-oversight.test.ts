import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Express } from "express";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { briefAuthorizationSchema, buildOversightBrief, oversightMessage } from "./paif-alpha-oversight-rules";
import type { AlphaOversightEvidence } from "@workspace/api-zod";

const observed = (area: AlphaOversightEvidence["area"]): AlphaOversightEvidence => ({
  area, source: "Test fixture", status: "observed", observedAt: new Date(),
  facts: ["Bounded evidence"], limitations: [],
});
const evidence = (["market", "paper", "payments", "release"] as const).map(observed);
assert.equal(buildOversightBrief(evidence).riskLevel, "low");
assert.equal(buildOversightBrief(evidence).advisoryOnly, true);
const incomplete = evidence.map((item) => ({ ...item, status: "unknown" as const }));
assert.equal(buildOversightBrief(incomplete).confidence, 15);
assert.equal(buildOversightBrief(incomplete).riskLevel, "medium");
const degraded = [{ ...evidence[0], status: "degraded" as const }, ...incomplete.slice(1)];
assert.equal(buildOversightBrief(degraded).riskLevel, "high");
assert.match(buildOversightBrief(degraded).recommendation, /market/);
assert.equal(briefAuthorizationSchema.safeParse({ nonce: Date.now(), signature: "x".repeat(88), message: "transfer" }).success, false);
assert.notDeepEqual(oversightMessage("request", "owner", 123), oversightMessage("history", "owner", 123));

// An ephemeral test-only treasury; no real owner key or network agent turn.
const privateKey = randomBytes(32);
const owner = bs58.encode(ed25519.getPublicKey(privateKey));
process.env.PAIF_FEE_VAULT = owner;
const { registerAlphaOversightRoutes } = await import("./paif-alpha-oversight");
const { storage } = await import("./storage");
const { db } = await import("./db");
const handlers = new Map<string, (req: any, res: any) => Promise<unknown>>();
const app = {
  get: (path: string, handler: any) => handlers.set(`GET ${path}`, handler),
  post: (path: string, handler: any) => handlers.set(`POST ${path}`, handler),
} as unknown as Express;
registerAlphaOversightRoutes(app);

const receipts = new Set<string>();
let consumed = 0;
storage.consumeWalletWriteSignature = async (signature: string) => {
  consumed++;
  if (receipts.has(signature)) return false;
  receipts.add(signature);
  return true;
};
let saved: any[] = [];
let failSave = false;
let failReads = false;
(db as any).transaction = async (callback: any) => {
  if (failReads) throw new Error("test bounded evidence outage");
  let calls = 0;
  return callback({ execute: async () => {
    calls++;
    return calls === 1 ? {} : { rows: [{ trades: 12, wins: 8, net: "1000000000" }] };
  } });
};
(db as any).insert = () => ({
  values: (value: any) => ({
    returning: async () => {
      if (failSave) throw new Error("test save outage");
      const row = { ...value, id: `brief-${saved.length}`, generatedAt: new Date() };
      saved.push(row);
      return [row];
    },
  }),
});
(db as any).select = () => ({
  from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => saved.slice(-20).reverse() }) }) }),
});

const authorise = (action: "request" | "history", nonce = Date.now(), key = privateKey) => ({
  nonce, signature: bs58.encode(ed25519.sign(oversightMessage(action, owner, nonce), key)),
});
async function call(action: "request" | "history", body: unknown) {
  let status = 200;
  let payload: any;
  const res = {
    set: () => res,
    status: (code: number) => { status = code; return res; },
    json: (value: any) => { payload = value; return res; },
  };
  const path = action === "request" ? "/api/paif-alpha/briefs" : "/api/paif-alpha/briefs/history";
  await handlers.get(`POST ${path}`)!({ body, log: { error: () => {} } }, res);
  return { status, payload };
}

const originalFetch = globalThis.fetch;
let upstreamCalls = 0;
globalThis.fetch = async () => { upstreamCalls++; throw new Error("Oversight must not call remote agents"); };
try {
  assert.equal((await call("request", {})).status, 400);
  assert.equal((await call("request", { ...authorise("request"), instructions: "trade" })).status, 400);
  assert.equal((await call("request", authorise("request", Date.now(), randomBytes(32)))).status, 401);
  assert.equal((await call("request", authorise("request", Date.now() - 360_000))).status, 401);
  assert.equal((await call("request", authorise("request", Date.now() + 360_000))).status, 401);
  assert.equal((await call("history", authorise("request"))).status, 401);
  assert.equal(consumed, 0, "Unauthorised input never reaches durable writes");

  const signed = authorise("request");
  const brief = await call("request", signed);
  assert.equal(brief.status, 201);
  assert.equal(brief.payload.advisoryOnly, true);
  assert.equal(brief.payload.engine, "rules-based-fallback");
  assert.equal(brief.payload.evidence.length, 4);
  assert.equal("ownerWallet" in brief.payload, false);
  assert.equal(saved.length, 1);
  assert.equal((await call("request", signed)).status, 409);
  assert.equal((await call("request", authorise("request", Date.now() + 1))).status, 429);
  const history = await call("history", authorise("history"));
  assert.equal(history.status, 200);
  assert.equal(history.payload[0].id, brief.payload.id);

  // Advance the clock without sleeping to cover degraded reads and failed saves.
  const actualNow = Date.now;
  Date.now = () => actualNow() + 65_000;
  try {
    failReads = true;
    failSave = true;
    const failed = await call("request", authorise("request"));
    assert.equal(failed.status, 503);
    assert.equal(saved.length, 1, "Never report an unsaved brief as success");
    failSave = false;
    Date.now = () => actualNow() + 130_000;
    const partial = await call("request", authorise("request"));
    assert.equal(partial.status, 201);
    assert.equal(partial.payload.evidence.find((item: any) => item.area === "paper").status, "unknown");
    assert.equal(partial.payload.evidence.find((item: any) => item.area === "payments").status, "unknown");
  } finally {
    Date.now = actualNow;
  }
  assert.equal(upstreamCalls, 0, "Oversight has no Claw Pump writes or other agent calls");
} finally {
  globalThis.fetch = originalFetch;
}
console.log("Alpha oversight authorization, replay, evidence, history, and failure contracts passed.");
process.exit(0);
