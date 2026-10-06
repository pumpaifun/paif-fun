import WebSocket from "ws";
import { log } from "./logger";

const PUMP_PORTAL_WS = "wss://pumpportal.fun/api/data";
const RING_SIZE = 100;
const RECONNECT_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
const HEARTBEAT_INTERVAL_MS = 25_000;   // Send a ping every 25s
const INACTIVITY_TIMEOUT_MS = 60_000;   // Treat connection dead if no frames for 60s

export interface LiveLaunch {
  mint: string;
  signature: string;
  creator: string;
  name: string;
  symbol: string;
  uri?: string;
  initialBuySol: number;
  marketCapSol: number;
  pool: string;
  receivedAt: number;
}

export interface LiveMigration {
  mint: string;
  signature: string;
  pool: string;
  receivedAt: number;
}

const launches: LiveLaunch[] = [];
const migrations: LiveMigration[] = [];

// ── Per-token trade subscriptions ────────────────────────────────────────
// Lazily subscribe to a mint when the UI starts polling for it; auto-
// unsubscribe after TOKEN_SUB_TTL_MS of inactivity to keep the upstream
// subscription set bounded.
export interface LiveTrade {
  signature: string;
  mint: string;
  trader: string;
  side: "buy" | "sell";
  solAmount: number;
  tokenAmount: number;
  marketCapSol: number;
  receivedAt: number;
}

const TOKEN_RING_SIZE = 100;
const TOKEN_SUB_TTL_MS = 90_000;            // unsub if no polls for 90s
const TOKEN_GC_INTERVAL_MS = 30_000;
export const MAX_TOKEN_TRADE_SUBSCRIPTIONS = 128;
const tokenTradeBuffers   = new Map<string, LiveTrade[]>();
const tokenLastPolledAt   = new Map<string, number>();
const tokenSubscribed     = new Set<string>();
let tokenGcTimer: NodeJS.Timeout | null = null;

let ws: WebSocket | null = null;
let reconnectAttempt = 0;
let reconnectTimer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let inactivityTimer: NodeJS.Timeout | null = null;
let lastConnectedAt: number | null = null;
let stopped = false;

function pushRing<T>(buf: T[], item: T) {
  buf.unshift(item);
  if (buf.length > RING_SIZE) buf.length = RING_SIZE;
}

function clearTimers() {
  if (heartbeatTimer)   { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  if (inactivityTimer)  { clearTimeout(inactivityTimer); inactivityTimer = null; }
}

function bumpInactivityTimer() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => {
    log(`no frames for ${INACTIVITY_TIMEOUT_MS}ms — terminating socket to force reconnect`, "pump-portal");
    forceCloseAndReconnect();
  }, INACTIVITY_TIMEOUT_MS);
}

function forceCloseAndReconnect() {
  clearTimers();
  if (ws) {
    try { ws.terminate(); } catch { /* noop */ }
    ws = null;
  }
  if (!stopped) scheduleReconnect();
}

function handleMessage(raw: WebSocket.RawData) {
  bumpInactivityTimer();
  try {
    const msg = JSON.parse(raw.toString());
    if (msg?.errors || msg?.message) {
      log(`pump-portal message: ${JSON.stringify(msg).slice(0, 200)}`, "pump-portal");
      return;
    }
    if (msg?.txType === "create" && msg?.mint) {
      pushRing(launches, {
        mint: String(msg.mint),
        signature: String(msg.signature ?? ""),
        creator: String(msg.traderPublicKey ?? ""),
        name: String(msg.name ?? ""),
        symbol: String(msg.symbol ?? ""),
        uri: msg.uri ? String(msg.uri) : undefined,
        initialBuySol: Number(msg.solAmount ?? 0),
        marketCapSol: Number(msg.marketCapSol ?? 0),
        pool: String(msg.pool ?? "pump"),
        receivedAt: Date.now(),
      });
      return;
    }
    if (msg?.txType === "migrate" && msg?.mint) {
      pushRing(migrations, {
        mint: String(msg.mint),
        signature: String(msg.signature ?? ""),
        pool: String(msg.pool ?? "raydium"),
        receivedAt: Date.now(),
      });
      return;
    }
    if ((msg?.txType === "buy" || msg?.txType === "sell") && msg?.mint) {
      const mint = String(msg.mint);
      // Never admit buffer keys from unsolicited/malformed upstream frames.
      // Subscription admission is exclusively controlled by the bounded path
      // in ensureTokenTradeSubscription.
      if (!tokenSubscribed.has(mint)) return;
      let buf = tokenTradeBuffers.get(mint);
      if (!buf) { buf = []; tokenTradeBuffers.set(mint, buf); }
      buf.unshift({
        signature: String(msg.signature ?? ""),
        mint,
        trader: String(msg.traderPublicKey ?? ""),
        side: msg.txType === "buy" ? "buy" : "sell",
        solAmount: Number(msg.solAmount ?? 0),
        tokenAmount: Number(msg.tokenAmount ?? 0),
        marketCapSol: Number(msg.marketCapSol ?? 0),
        receivedAt: Date.now(),
      });
      if (buf.length > TOKEN_RING_SIZE) buf.length = TOKEN_RING_SIZE;
      return;
    }
  } catch {
    // Bad JSON or unexpected payload — ignore individual frames.
  }
}

function scheduleReconnect() {
  if (reconnectTimer || stopped) return;
  const delay = RECONNECT_BACKOFF_MS[Math.min(reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)];
  reconnectAttempt += 1;
  log(`reconnect in ${delay}ms (attempt ${reconnectAttempt})`, "pump-portal");
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!stopped) connect();
  }, delay);
}

function connect() {
  if (stopped) return;
  try {
    ws = new WebSocket(PUMP_PORTAL_WS);
  } catch (err: any) {
    log(`construct failed: ${err?.message ?? err}`, "pump-portal");
    scheduleReconnect();
    return;
  }

  ws.on("open", () => {
    lastConnectedAt = Date.now();
    reconnectAttempt = 0;
    log("connected — subscribing to new tokens + migrations", "pump-portal");
    try {
      ws!.send(JSON.stringify({ method: "subscribeNewToken" }));
      ws!.send(JSON.stringify({ method: "subscribeMigration" }));
      // Re-subscribe to any token-trade channels that were active before
      // the reconnect so the UI's live trade feed survives WS hiccups.
      const mints = Array.from(tokenSubscribed);
      if (mints.length > 0) {
        ws!.send(JSON.stringify({ method: "subscribeTokenTrade", keys: mints }));
        log(`re-subscribed to ${mints.length} token trade channel(s)`, "pump-portal");
      }
    } catch (err: any) {
      log(`subscribe failed: ${err?.message ?? err}`, "pump-portal");
    }
    // Heartbeat: send pings so PumpPortal knows we're alive and we can detect
    // half-open sockets via missed pongs (handled by the inactivity timer).
    bumpInactivityTimer();
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        try { ws.ping(); } catch { /* noop */ }
      }
    }, HEARTBEAT_INTERVAL_MS);
  });

  ws.on("message", handleMessage);

  // Pong frames refresh inactivity even if no data messages are flowing.
  ws.on("pong", () => bumpInactivityTimer());

  ws.on("error", (err: Error) => {
    log(`ws error: ${err.message} — forcing reconnect`, "pump-portal");
    // Treat error as recoverable: tear down and reconnect rather than waiting
    // for a 'close' that may never arrive on some failure modes.
    forceCloseAndReconnect();
  });

  ws.on("close", (code: number, reason: Buffer) => {
    log(`ws closed code=${code} reason=${reason.toString().slice(0, 100)}`, "pump-portal");
    clearTimers();
    ws = null;
    if (!stopped) scheduleReconnect();
  });
}

export function startPumpPortal() {
  if (ws || stopped) return;
  log("starting websocket client", "pump-portal");
  connect();
  if (!tokenGcTimer) {
    tokenGcTimer = setInterval(reapStaleTokenSubscriptions, TOKEN_GC_INTERVAL_MS);
  }
}

/**
 * Idempotent: ensure we're subscribed to trade events for `mint`. The first
 * call sends a `subscribeTokenTrade` frame upstream; subsequent calls just
 * refresh the last-polled timestamp so the GC won't reap it. The UI invokes
 * this on every poll of /api/pump-portal/trades/:mint.
 */
export function ensureTokenTradeSubscription(mint: string): boolean {
  const now = Date.now();
  if (tokenSubscribed.has(mint)) {
    tokenLastPolledAt.set(mint, now);
    return true;
  }
  // Reap before checking the cap so expired entries cannot unnecessarily
  // block legitimate callers between scheduled GC ticks.
  reapStaleTokenSubscriptions(now);
  if (tokenSubscribed.size >= MAX_TOKEN_TRADE_SUBSCRIPTIONS) return false;

  tokenLastPolledAt.set(mint, now);
  tokenSubscribed.add(mint);
  if (!tokenTradeBuffers.has(mint)) tokenTradeBuffers.set(mint, []);
  if (ws?.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [mint] }));
    } catch (err: any) {
      log(`subscribeTokenTrade failed for ${mint}: ${err?.message ?? err}`, "pump-portal");
    }
  }
  // If the WS isn't open yet, the on('open') handler re-subs all tracked mints.
  return true;
}

export function getRecentTrades(mint: string, sinceMs?: number, limit = 50): LiveTrade[] {
  const buf = tokenTradeBuffers.get(mint) ?? [];
  const cap = Math.max(1, Math.min(limit, TOKEN_RING_SIZE));
  if (sinceMs && sinceMs > 0) {
    return buf.filter(t => t.receivedAt > sinceMs).slice(0, cap);
  }
  return buf.slice(0, cap);
}

function reapStaleTokenSubscriptions(now = Date.now()) {
  const stale: string[] = [];
  for (const [mint, ts] of tokenLastPolledAt.entries()) {
    if (now - ts > TOKEN_SUB_TTL_MS) stale.push(mint);
  }
  if (stale.length === 0) return;
  for (const mint of stale) {
    tokenSubscribed.delete(mint);
    tokenLastPolledAt.delete(mint);
    tokenTradeBuffers.delete(mint);
  }
  if (ws?.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ method: "unsubscribeTokenTrade", keys: stale }));
      log(`unsubscribed from ${stale.length} idle token trade channel(s)`, "pump-portal");
    } catch (err: any) {
      log(`unsubscribeTokenTrade failed: ${err?.message ?? err}`, "pump-portal");
    }
  }
}

export function stopPumpPortal() {
  stopped = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (tokenGcTimer) { clearInterval(tokenGcTimer); tokenGcTimer = null; }
  tokenSubscribed.clear();
  tokenLastPolledAt.clear();
  tokenTradeBuffers.clear();
  clearTimers();
  if (ws) {
    try { ws.removeAllListeners(); } catch { /* noop */ }
    try { ws.terminate(); } catch { /* noop */ }
    ws = null;
  }
  log("stopped", "pump-portal");
}

export function getRecentLaunches(limit = 50): LiveLaunch[] {
  const safe = Math.max(1, Math.min(limit, RING_SIZE));
  return launches.slice(0, Math.min(safe, launches.length));
}

export function getRecentMigrations(limit = 50): LiveMigration[] {
  const safe = Math.max(1, Math.min(limit, RING_SIZE));
  return migrations.slice(0, Math.min(safe, migrations.length));
}

export function getPumpPortalStatus() {
  return {
    connected: ws?.readyState === WebSocket.OPEN,
    lastConnectedAt,
    reconnectAttempt,
    bufferedLaunches: launches.length,
    bufferedMigrations: migrations.length,
    activeTokenTradeSubscriptions: tokenSubscribed.size,
    maxTokenTradeSubscriptions: MAX_TOKEN_TRADE_SUBSCRIPTIONS,
  };
}
