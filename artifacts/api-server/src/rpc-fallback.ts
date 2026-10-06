// Backup line to Solana: every server module talks to the network through
// Helius. When Helius hits its plan cap it answers 429 "max usage reached"
// and EVERYTHING fails at once (blockhashes, balances, sends). This custom
// fetch retries the exact same request against the free public Solana RPC,
// so user-facing actions degrade to "slower" instead of failing outright.
// The public line is a cushion, not a cure — it has its own (stricter)
// rate limits. The real fix for sustained load is a bigger Helius plan.
const PUBLIC_RPC = "https://api.mainnet-beta.solana.com";

let lastFallbackLog = 0;
function logFallback(reason: string) {
  const now = Date.now();
  if (now - lastFallbackLog > 30_000) {
    lastFallbackLog = now;
    console.warn(`[rpc-fallback] ${reason} — retrying on public Solana RPC (upgrade Helius plan to avoid this)`);
  }
}

export const rpcFetchWithFallback: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  const isPublic = url.startsWith(PUBLIC_RPC);
  const requestHeaders = new Headers(
    typeof Request !== "undefined" && input instanceof Request ? input.headers : init?.headers,
  );
  const requestedTimeout = Number(requestHeaders.get("x-rpc-timeout-ms"));
  requestHeaders.delete("x-rpc-timeout-ms");
  const fallbackTimeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout >= 1000 && requestedTimeout <= 60_000
    ? requestedTimeout
    : 15_000;

  // Build a body-safe, signal-free copy of the request up front so the
  // fallback still works when (a) the caller passed a Request object whose
  // body can only be read once, or (b) the primary call was aborted/timed
  // out — reusing the caller's (now-aborted) AbortSignal would instantly
  // kill the retry.
  let retryInit: RequestInit;
  if (typeof Request !== "undefined" && input instanceof Request) {
    const req = input.clone();
    retryInit = {
      method: req.method,
      headers: requestHeaders,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.text(),
    };
  } else {
    retryInit = { method: init?.method, headers: requestHeaders, body: init?.body };
  }
  retryInit.signal = AbortSignal.timeout(fallbackTimeoutMs);

  try {
    const res = await fetch(input, init);
    // 429 = plan throttled; 403 = credits fully exhausted / key blocked.
    if (isPublic || (res.status !== 429 && res.status !== 403)) return res;
    logFallback(`Helius ${res.status} (${res.status === 403 ? "access forbidden — credits exhausted" : "max usage reached"})`);
  } catch (e) {
    if (isPublic) throw e;
    logFallback("Helius unreachable");
  }
  return fetch(PUBLIC_RPC, retryInit);
};
