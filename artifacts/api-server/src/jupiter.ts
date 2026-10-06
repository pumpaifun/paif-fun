const JUPITER_API_BASE = "https://lite-api.jup.ag/swap/v1";

// ─── Global Jupiter throttle ─────────────────────────────────────────────────
// The free (lite) Jupiter tier rate-limits per IP, and EVERY caller in this
// app shares that budget: swing bots, the arb executor, auto-strategy,
// buybacks, and user-facing manual sells. When schedulers saturated the limit,
// a user's "Sell now" collided with 429s over and over ("it won't sell!").
// All quote/swap calls now pass through one queue with a minimum gap between
// requests, so we stay under the limit instead of stampeding it. A manual
// sell waits ~a second behind a scanner call instead of failing instantly.
const MIN_GAP_MS = 1_100; // lite tier ≈ 1 req/sec per IP
let lastCallAt = 0;
let queueTail: Promise<void> = Promise.resolve();
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queueTail.then(async () => {
    const wait = lastCallAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
  });
  // The tail only tracks the pacing step (never the caller's fetch result),
  // so one failed request can't poison the queue.
  queueTail = run.catch(() => {});
  return run.then(fn);
}
export const SOL_MINT = "So11111111111111111111111111111111111111112";

export interface JupiterQuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: {
    swapInfo: {
      ammKey: string;
      label: string;
      inputMint: string;
      outputMint: string;
      inAmount: string;
      outAmount: string;
      feeAmount: string;
      feeMint: string;
    };
    percent: number;
  }[];
  contextSlot?: number;
  timeTaken?: number;
}

export async function getSwapQuote(
  inputMint: string,
  outputMint: string,
  amount: number | string,
  slippageBps: number = 50,
  // Optional best-effort DEX restriction (comma-separated Jupiter labels, e.g.
  // "Raydium"). Used by the arb executor to try to route a leg through a
  // specific venue. Jupiter matches by label and may still pick a different
  // pool on the same DEX — this is an approximation, not a guarantee.
  dexes?: string,
  // User-triggered paper buys should wait through a longer provider quota
  // window than background scanners. This does not bypass route safety or
  // fabricate a fill; it only gives the real quote endpoint time to recover.
  requestClass: "background" | "interactive" = "background",
): Promise<JupiterQuoteResponse> {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amount.toString(),
    slippageBps: slippageBps.toString(),
  });
  if (dexes) params.set("dexes", dexes);
  // Fewer hops = fewer token accounts to rent-create in the swap tx. Multi-hop
  // routes through obscure intermediate tokens added ~0.002 SOL rent each and
  // pushed full-wallet buys past the reserved headroom (simulated 0x1).
  params.set("restrictIntermediateTokens", "true");

  // Rate-limit patience: the lite (free-tier) Jupiter API 429s under our own
  // scanner load, and an instant failure here surfaced to users as "sell won't
  // go through" — the manual sell kept colliding with scheduler price calls on
  // every retry. On 429 we now wait briefly (honoring Retry-After when sane)
  // and try again instead of failing the whole trade on a transient limit.
  const maxAttempts = requestClass === "interactive" ? 5 : 3;
  let lastErr: Error | null = null;
  let retryAfterMs = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const configuredDelay = INTERACTIVE_RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      const delay = Math.max(configuredDelay, retryAfterMs);
      await new Promise((r) => setTimeout(r, delay + Math.floor(Math.random() * 500)));
    }
    // The abort signal must stay armed through the BODY read too — clearing the
    // timeout right after the headers arrive left res.json()/res.text() unbounded,
    // and one stalled body read could hang a bot's tick (and everything queued
    // behind its lock, including a user's withdraw) forever.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await throttled(() => fetch(`${JUPITER_API_BASE}/quote?${params.toString()}`, {
        signal: controller.signal,
      }));
      if (!res.ok) {
        const errorText = await res.text().catch(() => "Unknown error");
        const err = new Error(`Jupiter quote failed (${res.status}): ${errorText}`);
        if (res.status === 429) {
          lastErr = err;
          retryAfterMs = retryAfterHeaderMs(res.headers.get("retry-after"));
          continue;
        }
        throw err;
      }
      return await res.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastErr ?? new Error("Jupiter quote failed: rate limited");
}

// Backoff before retry #1 and retry #2 (plus up to 500ms random jitter so
// concurrent callers don't re-collide in lockstep).
const RETRY_DELAYS_MS = [1500, 4000];
const INTERACTIVE_RETRY_DELAYS_MS = [1500, 4000, 8000, 12000];

export function retryAfterHeaderMs(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(30_000, Math.ceil(seconds * 1000));
  const dateMs = Date.parse(value);
  if (!Number.isFinite(dateMs)) return 0;
  return Math.min(30_000, Math.max(0, dateMs - now));
}

export async function getSwapTransaction(
  quoteResponse: Record<string, unknown>,
  userPublicKey: string
): Promise<{ swapTransaction: string }> {
  // Same 429 patience as getSwapQuote: a transient rate limit must not kill
  // the trade after we already have a good quote.
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1] + Math.floor(Math.random() * 500)));
    }
  // Same rule as getSwapQuote: the timeout must cover the body read as well.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await throttled(() => fetch(`${JUPITER_API_BASE}/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        // CAPPED priority fee. "auto" let Jupiter attach multi-mSOL tips during
        // congestion; a full-wallet buy (manual Buy now spends all spendable)
        // then simulated with token error 0x1 "insufficient funds" — the wrap +
        // ATA rents + tip exceeded the fixed 0.008 SOL headroom, and every
        // retry failed the same way. 2 mSOL still lands fast, and together
        // with ~0.004 ATA rents + base fee it always fits inside the headroom.
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: { maxLamports: 2_000_000, priorityLevel: "high" },
        },
      }),
      signal: controller.signal,
    }));
    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      const err = new Error(`Jupiter swap transaction failed (${res.status}): ${errorText}`);
      if (res.status === 429) { lastErr = err; continue; }
      throw err;
    }
    const data = await res.json();
    return { swapTransaction: data.swapTransaction };
  } finally {
    clearTimeout(timeoutId);
  }
  }
  throw lastErr ?? new Error("Jupiter swap transaction failed: rate limited");
}

export async function getSplitQuotes(
  inputMint: string,
  outputMint: string,
  totalAmount: number,
  splitCount: number,
  slippageBps: number = 50
): Promise<JupiterQuoteResponse[]> {
  if (splitCount < 1 || splitCount > 24) {
    throw new Error("Split count must be between 1 and 24");
  }

  const perSplitAmount = Math.floor(totalAmount / splitCount);
  if (perSplitAmount <= 0) {
    throw new Error("Total amount too small to split into the requested number of orders");
  }

  const quotePromises: Promise<JupiterQuoteResponse>[] = [];
  for (let i = 0; i < splitCount; i++) {
    const amount = i === splitCount - 1
      ? totalAmount - perSplitAmount * (splitCount - 1)
      : perSplitAmount;
    quotePromises.push(getSwapQuote(inputMint, outputMint, amount, slippageBps));
  }

  return Promise.all(quotePromises);
}
