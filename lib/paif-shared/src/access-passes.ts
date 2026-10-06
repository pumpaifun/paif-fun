// Fixed-duration, one-time access passes. Every pass has the same entitlements;
// only the amount of time changes.

export interface AccessPass {
  id: "day" | "week" | "two-weeks" | "month";
  label: string;
  durationMs: number;
  priceUsd: number;
  badge?: "popular" | "best-value";
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const ACCESS_PASSES: readonly AccessPass[] = [
  { id: "day", label: "Day Pass", durationMs: DAY_MS, priceUsd: 2 },
  { id: "week", label: "Week Pass", durationMs: 7 * DAY_MS, priceUsd: 9.99 },
  { id: "two-weeks", label: "Two-Week Pass", durationMs: 14 * DAY_MS, priceUsd: 12.99, badge: "popular" },
  { id: "month", label: "Month Pass", durationMs: 30 * DAY_MS, priceUsd: 19.99, badge: "best-value" },
] as const;

export const ACCESS_TRIAL_DURATION_MS = 3 * DAY_MS;

export function getAccessPass(id: string): AccessPass | undefined {
  return ACCESS_PASSES.find((pass) => pass.id === id);
}