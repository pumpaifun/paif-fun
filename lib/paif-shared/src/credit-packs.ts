// Credit packs sold to power the bump bot. Pricing is fixed in USD; the SOL
// equivalent is computed at purchase-intent time using the live SOL/USD price
// feed. Keep this file the single source of truth on both client and server.

export interface CreditPack {
  id: string;
  priceUsd: number;
  credits: number;
  unlimitedSubwallets: boolean;
  // When set, buying this pack also grants a time-based unlimited-bump window
  // of this duration. Bumps fired inside the window do not consume credits at
  // all; once expired, the wallet falls back to its per-credit balance. Stacks
  // additively if purchased while a window is already active.
  unlimitedDurationMs?: number;
  // Maximum number of bump-bot sub-wallets the buyer may register under their
  // owner wallet. Higher tiers unlock more parallel rotation. The bigger of
  // the buyer's existing cap and this value is what we keep on the row, so
  // upgrading never silently downgrades a previously-purchased entitlement.
  maxSubwallets: number;
  label: string;
  // Optional UX hint shown on the upgrade page.
  badge?: "popular" | "best-value" | "premium" | null;
}

const HOUR_MS = 60 * 60 * 1000;

// Sub-wallet caps before any purchase (free-trial ceiling). Server-enforced at
// delegation-registration time, also surfaced to the UI so the generator knob
// hard-locks at the right number.
export const FREE_TRIAL_MAX_SUBWALLETS = 3;
export const ABSOLUTE_MAX_SUBWALLETS = 100;

export const CREDIT_PACKS: readonly CreditPack[] = [
  { id: "starter",      priceUsd: 1.99,  credits: 30,   unlimitedSubwallets: false, maxSubwallets: 5,  label: "Starter",       badge: null },
  { id: "casual",       priceUsd: 5.99,  credits: 100,  unlimitedSubwallets: false, maxSubwallets: 10, label: "Casual",        badge: null },
  { id: "regular",      priceUsd: 9.99,  credits: 300,  unlimitedSubwallets: false, maxSubwallets: 20, label: "Regular",       badge: "popular" },
  { id: "power",        priceUsd: 14.99, credits: 1000, unlimitedSubwallets: false, maxSubwallets: 30, label: "Power",         badge: null },
  { id: "unlimited",    priceUsd: 19.99, credits: 2000, unlimitedSubwallets: true,  maxSubwallets: 100, label: "Unlimited",     badge: "best-value" },
  { id: "unlimited7d",  priceUsd: 29.99, credits: 0,    unlimitedSubwallets: true,  maxSubwallets: 100, unlimitedDurationMs: 7 * 24 * HOUR_MS, label: "7 Day Unlimited", badge: "premium" },
] as const;

export function getPack(id: string): CreditPack | undefined {
  return CREDIT_PACKS.find(p => p.id === id);
}

// Free credits granted to a wallet on first read so users can try the bot
// before paying. Tuned low to keep abuse minimal while still letting honest
// users see the bot fire end-to-end.
export const FREE_TRIAL_CREDITS = 5;

// ─── Buyback Pool allocation ────────────────────────────────────────────────
// Share of every credit purchase set aside for the $PAIF buyback program,
// expressed in basis points (3000 = 30%). The allocation is recorded in the
// buyback_ledger table at purchase time and remains "pending" until a swap
// is executed. Snapshot per-row so changing this constant later doesn't
// rewrite historical allocations.
export const BUYBACK_ALLOCATION_BPS = 3000;

// Public-facing label & blurb describing the pool. Shipped as constants so
// the same copy is used by the API response, the public /buyback page, and
// any future on-chain announcement script.
export const BUYBACK_POOL_NAME = "Community Buyback Pool";
export const BUYBACK_POOL_BLURB =
  "Up to 30% of platform revenue is allocated to the buyback pool, tracked transparently and used to buy $PAIF on-chain. " +
  "What happens to the $PAIF after the buyback — how much is held, burned, or returned to the community — is still being decided together with the community.";

// Auto-sweep threshold: once the buyback pool's pending lamports cross this
// number, the treasury wallet sees a "Ready to execute" highlight on both the
// public /buyback page and the /admin/buyback panel. The server does NOT
// auto-sign — execution is still a one-click manual action so the treasury
// private key never has to live on the server. Tweak via the constant below
// (no env var required); 0.05 SOL = 50_000_000 lamports is the default.
export const BUYBACK_AUTO_SWEEP_THRESHOLD_LAMPORTS = 50_000_000n;

// Tolerance allowed between the lamports the server quoted at intent time and
// the lamports actually paid on-chain. SOL/USD can drift a few percent in the
// minute between intent generation and tx confirmation; we accept up to 5%
// underpayment so a falling SOL price doesn't unfairly reject honest buyers.
export const PAYMENT_TOLERANCE_PCT = 5;
