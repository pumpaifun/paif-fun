const HIGH_FREQUENCY_PATHS = new Set([
  "/api/sniper/live-launches",
  "/api/pumpapi/creators",
  "/api/pumpapi/status",
  "/api/creators",
  "/api/tokenized-stocks",
]);

export function isSensitiveApiPath(path: string): boolean {
  return path === "/api/community-appeals" || path.startsWith("/api/community-appeals/");
}

export function formatApiResponseLog(args: {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  responseBody?: Record<string, unknown>;
}): string {
  const isHighFrequencyPath = HIGH_FREQUENCY_PATHS.has(args.path)
    || args.path.startsWith("/api/pump-portal/trades/");
  let logLine = `${args.method} ${args.path} ${args.statusCode} in ${args.durationMs}ms`;
  if (args.responseBody && !isHighFrequencyPath && !isSensitiveApiPath(args.path)) {
    logLine += ` :: ${JSON.stringify(args.responseBody)}`;
  }
  return logLine;
}