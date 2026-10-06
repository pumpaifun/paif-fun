import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes/routes";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import { createServer } from "http";
import { startPumpPortal, stopPumpPortal } from "./pump-portal";
import { startAutoStrategyScheduler } from "./auto-strategy";
import { startArbExecutorScheduler } from "./arb-executor";
import { startSwingScheduler } from "./swing-executor";
import { securityHeaders } from "./security";
import { startPumpApiLeaderboard, stopPumpApiLeaderboard } from "./pumpapi-leaderboard";
import { startTokenizedStockCatalog } from "./tokenized-stocks";
import { log } from "./logger";
import { formatApiResponseLog } from "./request-logging";

export { log } from "./logger";

const app = express();
const httpServer = createServer(app);

// Privacy/abuse hardening headers on every response (incl. Referrer-Policy:
// no-referrer so external resources can't learn what a user is viewing).
app.use(securityHeaders);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      log(formatApiResponseLog({
        method: req.method,
        path,
        statusCode: res.statusCode,
        durationMs: duration,
        responseBody: capturedJsonResponse,
      }));
    }
  });

  next();
});

(async () => {
  await setupAuth(app);
  app.get("/api/healthz", (_req, res) => res.json({ status: "ok" }));
  registerAuthRoutes(app);
  await registerRoutes(httpServer, app);
  startPumpPortal();
  startPumpApiLeaderboard();
  startAutoStrategyScheduler();
  startArbExecutorScheduler();
  startSwingScheduler();
  startTokenizedStockCatalog();

  // Graceful shutdown: close the upstream PumpPortal websocket and any
  // pending reconnect timers so the process can exit cleanly without
  // re-opening sockets during teardown.
  const shutdown = async (signal: string) => {
    log(`received ${signal}, shutting down`);
    try { stopPumpPortal(); } catch { /* noop */ }
    try { await stopPumpApiLeaderboard(); } catch { /* noop */ }
    httpServer.close(() => process.exit(0));
    // Hard exit if close hangs (10s).
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT",  () => shutdown("SIGINT"));

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  // The original frontend is served by the separate root web artifact.

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  if (!process.env.PORT) throw new Error("PORT is required");
  const port = parseInt(process.env.PORT, 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
