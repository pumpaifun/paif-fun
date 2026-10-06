import { ReplitConnectors } from "@replit/connectors-sdk";
import { getAccessPass } from "@shared/access-passes";
import { storage } from "./storage";

const connectors = new ReplitConnectors();

async function stripeRequest<T>(
  path: string,
  options?: { method?: string; body?: URLSearchParams; idempotencyKey?: string },
): Promise<T> {
  const response = await connectors.proxy("stripe", path, {
    method: options?.method ?? "GET",
    body: options?.body,
    headers: {
      ...(options?.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(options?.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
    },
  });
  const payload = await response.json() as any;
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Stripe request failed (${response.status}).`);
  }
  return payload as T;
}

async function getAccessPassPrice(passId: string): Promise<string> {
  const pass = getAccessPass(passId);
  if (!pass) throw new Error(`Unknown access pass: ${passId}`);
  const product = await stripeRequest<{ id: string }>("/v1/products", {
    method: "POST",
    idempotencyKey: `paif-access-product-${pass.id}-v1`,
    body: new URLSearchParams({
      name: `PAIF ${pass.label}`,
      description: `${pass.durationMs / 86_400_000} days of access to eligible PAIF paper tools.`,
      "metadata[paif_pass_id]": pass.id,
    }),
  });
  const price = await stripeRequest<{ id: string }>("/v1/prices", {
    method: "POST",
    idempotencyKey: `paif-access-price-${pass.id}-${Math.round(pass.priceUsd * 100)}-v1`,
    body: new URLSearchParams({
      product: product.id,
      unit_amount: String(Math.round(pass.priceUsd * 100)),
      currency: "usd",
      "metadata[paif_pass_id]": pass.id,
    }),
  });
  return price.id;
}

export async function createCardAccessPassCheckout(args: {
  accessOwner: string;
  passId: string;
  returnBaseUrl: string;
  customerEmail?: string | null;
}) {
  const pass = getAccessPass(args.passId);
  if (!pass) throw new Error(`Unknown access pass: ${args.passId}`);
  const priceId = await getAccessPassPrice(pass.id);
  const body = new URLSearchParams({
    mode: "payment",
    "payment_method_types[0]": "card",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: `${args.returnBaseUrl}/upgrade?card=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${args.returnBaseUrl}/upgrade?card=cancelled`,
    "metadata[paif_access_owner]": args.accessOwner,
    "metadata[paif_pass_id]": pass.id,
    "metadata[duration_ms]": String(pass.durationMs),
  });
  if (args.customerEmail) {
    body.set("customer_email", args.customerEmail);
  }
  const session = await stripeRequest<{ id: string; url: string | null }>("/v1/checkout/sessions", {
    method: "POST",
    body,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return { url: session.url };
}

export async function confirmCardAccessPassCheckout(sessionId: string) {
  if (!/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(sessionId)) {
    throw new Error("Invalid Stripe Checkout Session.");
  }
  const session = await stripeRequest<{
    id: string;
    created: number;
    payment_status: string;
    status: string;
    mode: string;
    currency: string | null;
    amount_total: number | null;
    metadata: Record<string, string>;
  }>(`/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
  const accessOwner = session.metadata?.paif_access_owner ?? session.metadata?.owner_wallet ?? "";
  const passId = session.metadata?.paif_pass_id ?? "";
  const pass = getAccessPass(passId);
  const validWalletOwner = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(accessOwner);
  const validAccountOwner = /^account:[A-Za-z0-9_-]{1,128}$/.test(accessOwner);
  if (!pass || (!validWalletOwner && !validAccountOwner)) {
    throw new Error("Checkout metadata is invalid.");
  }
  if (session.mode !== "payment" || session.status !== "complete" || session.payment_status !== "paid") {
    throw new Error("Card payment is not complete.");
  }
  if (session.currency !== "usd" || session.amount_total !== Math.round(pass.priceUsd * 100)) {
    throw new Error("Card payment amount does not match the selected pass.");
  }
  if (!session.created || Date.now() / 1000 - session.created > 24 * 60 * 60) {
    throw new Error("This checkout is too old to apply automatically.");
  }

  const paymentReference = `stripe:${session.id}`;
  const existing = await storage.getAccessPassPurchaseBySignature(paymentReference);
  if (existing) {
    if (existing.ownerWallet !== accessOwner) throw new Error("Checkout was already credited to another account.");
    return { ...(await storage.getAccessPass(accessOwner)), alreadyApplied: true };
  }
  try {
    const out = await storage.recordAccessPassPurchase({
      ownerWallet: accessOwner,
      passId: pass.id,
      lamportsPaid: 0n,
      durationMs: pass.durationMs,
      txSignature: paymentReference,
    });
    return {
      ...(await storage.getAccessPass(accessOwner)),
      passExpiresAt: out.passExpiresAt,
      alreadyApplied: false,
    };
  } catch (error: any) {
    if (/duplicate key|unique/i.test(error?.message ?? "")) {
      return { ...(await storage.getAccessPass(accessOwner)), alreadyApplied: true };
    }
    throw error;
  }
}