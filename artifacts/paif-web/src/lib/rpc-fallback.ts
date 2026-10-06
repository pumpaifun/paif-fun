// Backup line to Solana for the browser: if Helius hits its plan cap (429
// "max usage reached") or is unreachable, retry the same request against the
// free public Solana RPC so buys, top-offs, and balances slow down instead
// of failing. Cushion, not cure — the public line has its own limits.
const PUBLIC_RPC = "https://api.mainnet-beta.solana.com";

export const rpcFetchWithFallback: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  const isPublic = url.startsWith(PUBLIC_RPC);

  // Body-safe, signal-free copy for the retry: a Request body can only be
  // read once, and a timed-out primary call leaves an aborted signal that
  // would instantly kill the fallback if reused.
  let retryInit: RequestInit;
  if (typeof Request !== "undefined" && input instanceof Request) {
    const req = input.clone();
    retryInit = {
      method: req.method,
      headers: req.headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.text(),
    };
  } else {
    retryInit = { method: init?.method, headers: init?.headers, body: init?.body };
  }
  try {
    retryInit.signal = AbortSignal.timeout(15_000);
  } catch {
    // Older browsers without AbortSignal.timeout: retry without a timeout.
  }

  try {
    const res = await fetch(input, init);
    // 429 = plan throttled; 403 = credits fully exhausted / key blocked.
    if (isPublic || (res.status !== 429 && res.status !== 403)) return res;
  } catch (e) {
    if (isPublic) throw e;
  }
  return fetch(PUBLIC_RPC, retryInit);
};
