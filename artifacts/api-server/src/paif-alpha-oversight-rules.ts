import type { AlphaOversightEvidence } from "@workspace/api-zod";
import { z } from "zod";

export const briefAuthorizationSchema = z.object({
  nonce: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  signature: z.string().min(80).max(100),
}).strict();

export function oversightMessage(action: "request" | "history", owner: string, nonce: number) {
  return new TextEncoder().encode(["paif-alpha-oversight", "v1", action, owner, String(nonce)].join("|"));
}

export function buildOversightBrief(evidence: AlphaOversightEvidence[]) {
  const degraded = evidence.filter((item) => item.status === "degraded");
  const unknown = evidence.filter((item) => item.status === "unknown");
  return {
    advisoryOnly: true as const,
    engine: "rules-based-fallback" as const,
    confidence: Math.max(10, 75 - unknown.length * 15 - degraded.length * 10),
    riskLevel: degraded.length ? "high" as const : unknown.length ? "medium" as const : "low" as const,
    recommendation: degraded.length
      ? `Owner review needed: investigate ${degraded.map((item) => item.area).join(", ")} evidence before relying on it. This brief does not change bots or authorize any financial action.`
      : unknown.length
        ? `Verify missing ${unknown.map((item) => item.area).join(", ")} evidence before drawing platform-wide conclusions. Observed receipts and Paper results do not prove live payment or trading reliability.`
        : "No degraded signal was found in this bounded snapshot. Continue owner-led monitoring; this is not approval to trade, transfer, publish, or change settings.",
    evidence,
  };
}
