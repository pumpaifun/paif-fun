import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { ArbBotContent } from "@/pages/arb-bot";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  ArrowRightLeft,
  ExternalLink,
  TrendingUp,
  AlertTriangle,
  ShieldCheck,
  Info,
  Loader2,
  Bot,
  Eye,
} from "lucide-react";

interface ArbPool {
  dex: string;
  pairAddress: string;
  priceUsd: number;
  liquidityUsd: number;
  url: string;
  legFeePct: number;
  impactPct: number;
}
interface ArbOpportunity {
  mint: string;
  symbol: string;
  name: string;
  icon: string;
  poolCount: number;
  tradeSizeUsd: number;
  buyPool: ArbPool | null;
  sellPool: ArbPool | null;
  grossSpreadPct: number;
  estCostPct: number;
  netEdgePct: number;
  estProfitUsd: number;
  executable: boolean;
  warnings: string[];
}

function fmtUsd(v: number) {
  if (!isFinite(v)) return "$0";
  const abs = Math.abs(v);
  if (abs >= 1000) return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (abs >= 1) return `$${v.toFixed(2)}`;
  if (abs === 0) return "$0";
  return `$${v.toPrecision(3)}`;
}
function fmtPrice(v: number) {
  if (v >= 1) return `$${v.toFixed(4)}`;
  return `$${v.toPrecision(4)}`;
}
function fmtPct(v: number) {
  return `${v >= 0 ? "" : "-"}${Math.abs(v).toFixed(2)}%`;
}

function OpportunityCard({ o }: { o: ArbOpportunity }) {
  const positive = o.netEdgePct > 0;
  return (
    <Card
      className="border-2"
      data-testid={`arb-card-${o.mint}`}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {o.icon ? (
            <img src={o.icon} alt="" className="w-7 h-7 rounded-full" />
          ) : (
            <div className="w-7 h-7 rounded-full bg-muted" />
          )}
          <div className="min-w-0">
            <div className="font-bold leading-tight truncate" data-testid={`arb-symbol-${o.mint}`}>
              {o.symbol || "???"}
            </div>
            <div className="text-[11px] text-muted-foreground truncate max-w-[160px]">
              {o.name}
            </div>
          </div>
          <div className="ml-auto text-right">
            <div
              className={`text-lg font-black tabular-nums ${
                positive ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
              }`}
              data-testid={`arb-netedge-${o.mint}`}
            >
              {fmtPct(o.netEdgePct)}
            </div>
            <div className="text-[10px] text-muted-foreground -mt-0.5">net edge</div>
          </div>
        </div>

        {o.poolCount < 2 || !o.buyPool || !o.sellPool ? (
          <div className="text-xs text-muted-foreground flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>{o.warnings[0] || "No cross-pool opportunity."}</span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <a
                href={o.buyPool.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border p-2 hover:bg-muted/50 transition-colors"
                data-testid={`arb-buypool-${o.mint}`}
              >
                <div className="text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                  Buy on {o.buyPool.dex} <ExternalLink className="w-2.5 h-2.5" />
                </div>
                <div className="font-mono font-semibold">{fmtPrice(o.buyPool.priceUsd)}</div>
                <div className="text-[10px] text-muted-foreground">
                  liq {fmtUsd(o.buyPool.liquidityUsd)}
                </div>
              </a>
              <a
                href={o.sellPool.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border p-2 hover:bg-muted/50 transition-colors"
                data-testid={`arb-sellpool-${o.mint}`}
              >
                <div className="text-[10px] uppercase tracking-wide text-blue-600 dark:text-blue-400 font-bold flex items-center gap-1">
                  Sell on {o.sellPool.dex} <ExternalLink className="w-2.5 h-2.5" />
                </div>
                <div className="font-mono font-semibold">{fmtPrice(o.sellPool.priceUsd)}</div>
                <div className="text-[10px] text-muted-foreground">
                  liq {fmtUsd(o.sellPool.liquidityUsd)}
                </div>
              </a>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
              <div className="rounded-lg bg-muted/50 p-1.5">
                <div className="font-bold tabular-nums">{fmtPct(o.grossSpreadPct)}</div>
                <div className="text-[9px] text-muted-foreground">gross spread</div>
              </div>
              <div className="rounded-lg bg-muted/50 p-1.5">
                <div className="font-bold tabular-nums">−{o.estCostPct.toFixed(2)}%</div>
                <div className="text-[9px] text-muted-foreground">est. cost</div>
              </div>
              <div className="rounded-lg bg-muted/50 p-1.5">
                <div
                  className={`font-bold tabular-nums ${
                    positive ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"
                  }`}
                  data-testid={`arb-profit-${o.mint}`}
                >
                  {fmtUsd(o.estProfitUsd)}
                </div>
                <div className="text-[9px] text-muted-foreground">
                  on {fmtUsd(o.tradeSizeUsd)}
                </div>
              </div>
            </div>

            {o.warnings.length > 0 && (
              <div className="space-y-1">
                {o.warnings.map((w, i) => (
                  <div
                    key={i}
                    className="text-[11px] text-amber-700 dark:text-amber-400 flex items-start gap-1.5"
                  >
                    <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function ArbitragePage() {
  const [view, setView] = useState<"scanner" | "bot">(() =>
    new URLSearchParams(window.location.search).get("mode") === "bot" ? "bot" : "scanner",
  );
  const [mint, setMint] = useState("");
  const [size, setSize] = useState(50);
  const [scanKey, setScanKey] = useState<{ mode: "token" | "network"; mint: string; size: number } | null>(
    null,
  );

  const isTokenScan = scanKey?.mode === "token";
  const isNetworkScan = scanKey?.mode === "network";

  const tokenQuery = useQuery<ArbOpportunity>({
    queryKey: ["/api/arbitrage/scan", scanKey?.mint, scanKey?.size],
    queryFn: async () => {
      const res = await fetch(
        `/api/arbitrage/scan/${scanKey!.mint}?size=${scanKey!.size}`,
      );
      if (!res.ok) throw new Error((await res.json()).error || "Scan failed");
      return res.json();
    },
    enabled: isTokenScan && !!scanKey?.mint,
  });

  const networkQuery = useQuery<ArbOpportunity[]>({
    queryKey: ["/api/arbitrage/network", scanKey?.size],
    queryFn: async () => {
      const res = await fetch(`/api/arbitrage/network?size=${scanKey!.size}`);
      if (!res.ok) throw new Error((await res.json()).error || "Scan failed");
      return res.json();
    },
    enabled: isNetworkScan,
  });

  const runTokenScan = () => {
    const m = mint.trim();
    if (m) setScanKey({ mode: "token", mint: m, size });
  };
  const runNetworkScan = () => setScanKey({ mode: "network", mint: "", size });

  const loading = tokenQuery.isFetching || networkQuery.isFetching;
  const networkResults = networkQuery.data ?? [];
  const changeView = (next: "scanner" | "bot") => {
    setView(next);
    window.history.replaceState(
      null,
      "",
      next === "bot" ? "/arbitrage?mode=bot" : "/arbitrage",
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className={`flex-1 w-full mx-auto px-4 py-6 ${view === "bot" ? "max-w-6xl" : "max-w-3xl"}`}>
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <ArrowRightLeft className="w-7 h-7" />
            <h1 className="text-3xl font-black" data-testid="text-arbitrage-page-title">
              Arbitrage
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Find price gaps across Solana pools, then choose whether to research
            them yourself or let an automated strategy trade qualifying opportunities.
          </p>
        </div>

        <div
          className="mb-7 grid grid-cols-2 gap-1 rounded-xl border border-border bg-muted/50 p-1"
          role="tablist"
          aria-label="Arbitrage mode"
        >
          <button
            type="button"
            role="tab"
            aria-selected={view === "scanner"}
            onClick={() => changeView("scanner")}
            className={`flex items-center justify-center gap-2 rounded-lg px-3 py-3 text-sm font-bold transition-all ${
              view === "scanner"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid="tab-arbitrage-scanner"
          >
            <Eye className="h-4 w-4" />
            Read-only scanner
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "bot"}
            onClick={() => changeView("bot")}
            className={`flex items-center justify-center gap-2 rounded-lg px-3 py-3 text-sm font-bold transition-all ${
              view === "bot"
                ? "bg-emerald-700 text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid="tab-arbitrage-bot"
          >
            <Bot className="h-4 w-4" />
            Arb Bot
          </button>
        </div>

        {view === "scanner" ? (
          <section role="tabpanel" aria-label="Read-only arbitrage scanner">
        <div className="flex items-center gap-2 mb-1">
          <ArrowRightLeft className="w-6 h-6" />
          <h2 className="text-2xl font-black" data-testid="text-arb-title">
            Read-only scanner
          </h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Finds the same token priced differently across Solana pools, then subtracts
          fees &amp; slippage to show the edge you could actually keep. Read-only — it
          never touches your wallet.
        </p>

        <Card className="mb-4">
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={mint}
                  onChange={(e) => setMint(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runTokenScan()}
                  placeholder="Paste a Solana token address"
                  className="w-full pl-9 pr-3 py-2 rounded-lg border bg-background text-sm font-mono"
                  data-testid="input-arb-mint"
                />
              </div>
              <div className="flex items-center gap-1 rounded-lg border px-2 py-1">
                <span className="text-xs text-muted-foreground">$</span>
                <input
                  type="number"
                  value={size}
                  min={1}
                  onChange={(e) => setSize(Math.max(1, Number(e.target.value) || 1))}
                  className="w-16 bg-transparent text-sm text-right outline-none"
                  data-testid="input-arb-size"
                  title="Trade size in USD"
                />
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={runTokenScan}
                disabled={!mint.trim() || loading}
                className="flex-1 bg-black text-white py-2 rounded-lg text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
                data-testid="button-scan-token"
              >
                {isTokenScan && loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
                Scan this token
              </button>
              <button
                onClick={runNetworkScan}
                disabled={loading}
                className="flex-1 bg-black text-white py-2 rounded-lg text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
                data-testid="button-scan-network"
              >
                {isNetworkScan && loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <TrendingUp className="w-4 h-4" />
                )}
                Scan trending tokens
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Honesty banner */}
        <div className="mb-4 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 text-[11px] text-amber-800 dark:text-amber-300 flex items-start gap-2">
          <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            Estimates only, not financial advice. Real spreads close in seconds and are
            usually captured by professional bots. Slippage is approximated from pool
            depth and can be worse in practice. A positive edge here is a lead to verify,
            not a guarantee of profit.
          </span>
        </div>

        {/* Results */}
        {loading && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-28 w-full rounded-xl" />
            ))}
          </div>
        )}

        {!loading && isTokenScan && tokenQuery.isError && (
          <div className="text-sm text-red-500" data-testid="text-arb-error">
            {(tokenQuery.error as Error)?.message || "Scan failed."}
          </div>
        )}
        {!loading && isTokenScan && tokenQuery.data && (
          <OpportunityCard o={tokenQuery.data} />
        )}

        {!loading && isNetworkScan && networkQuery.isError && (
          <div className="text-sm text-red-500">
            {(networkQuery.error as Error)?.message || "Scan failed."}
          </div>
        )}
        {!loading && isNetworkScan && networkQuery.data && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="w-3.5 h-3.5" />
              Scanned {networkResults.length} tokens with 2+ pools, ranked by net edge.
            </div>
            {networkResults.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No multi-pool tokens found in the current trending set. Try again shortly.
              </div>
            ) : (
              networkResults.map((o) => <OpportunityCard key={o.mint} o={o} />)
            )}
          </div>
        )}

        {!scanKey && !loading && (
          <div className="text-center text-sm text-muted-foreground py-10">
            Enter a token or scan trending tokens to find cross-pool price gaps.
          </div>
        )}
          </section>
        ) : (
          <section role="tabpanel" aria-label="Arbitrage trading bot">
            <ArbBotContent embedded />
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
}
