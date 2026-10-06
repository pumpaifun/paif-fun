import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Header } from "@/components/header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Rocket, RefreshCw, ExternalLink, Flame, Clock, BarChart3,
  TrendingUp, DollarSign, Zap, ArrowUpRight, Loader2, Sparkles,
} from "lucide-react";

interface Launch {
  mint: string;
  name: string;
  symbol: string;
  icon: string;
  imageUrl?: string;
  url: string;
  priceUsd: string;
  mcap: number;
  volume1h: number;
  volume24h: number;
  change1h: number | null;
  change5m: number | null;
  txns1h: number;
  liquidity: number;
  ageMins: number;
  bondingPct: number;
  graduated: boolean;
}

type SortKey = "newest" | "volume" | "change" | "mcap";
type AgeWindow = "1" | "6" | "24";

const SORT_TABS: Array<{ key: SortKey; label: string; icon: any }> = [
  { key: "newest", label: "Newest",      icon: Clock },
  { key: "volume", label: "Top Volume",  icon: BarChart3 },
  { key: "change", label: "Top Pump",    icon: TrendingUp },
  { key: "mcap",   label: "Top Mcap",    icon: DollarSign },
];

const AGE_WINDOWS: Array<{ key: AgeWindow; label: string }> = [
  { key: "1",  label: "<1h" },
  { key: "6",  label: "<6h" },
  { key: "24", label: "<24h" },
];

function fmtUsd(n: number): string {
  if (!n || !isFinite(n)) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtAge(mins: number): string {
  if (mins < 1)   return "<1m";
  if (mins < 60)  return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function NewLaunchesPage() {
  const [view, setView] = useState<"trending" | "new">(() =>
    new URLSearchParams(window.location.search).get("view") === "trending" ? "trending" : "new"
  );
  const [sort, setSort]         = useState<SortKey>("newest");
  const [ageWin, setAgeWin]     = useState<AgeWindow>("6");

  const queryKey = [view === "trending" ? "/api/trending-tokens" : "/api/new-launches", sort, ageWin] as const;

  const { data, isLoading, isFetching, refetch } = useQuery<Launch[]>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(view === "trending"
        ? "/api/trending-tokens"
        : `/api/new-launches?sort=${sort}&maxAgeHr=${ageWin}`);
      if (!res.ok) throw new Error("Failed to fetch launches");
      return res.json();
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const launches = data ?? [];

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto px-4 py-6 max-w-5xl">
        {/* Page header */}
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              {view === "trending" ? <Flame className="w-5 h-5 text-emerald-500" /> : <Rocket className="w-5 h-5 text-emerald-500" />}
              <h1 className="text-xl font-black text-foreground" data-testid="text-page-title">
                Crypto Leaderboard
              </h1>
              <Badge variant="secondary" className="text-[10px]">pump.fun</Badge>
              <Badge variant="outline" className="text-[10px] text-emerald-600">24/7 market</Badge>
            </div>
            <p className="text-xs text-muted-foreground max-w-xl">
              {view === "trending"
                ? "The Solana tokens trending now, ranked continuously in the same live order as the homepage ticker."
                : "Fresh pump.fun launches, monitored continuously—including weekends and holidays. Sort by recency, momentum, volume, or market cap."}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh-launches"
            className="gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <Card className="mb-4">
          <CardContent className="p-3 space-y-3">
            <div className="flex gap-1.5 flex-wrap">
              <button onClick={() => { setView("trending"); window.history.replaceState(null, "", "/crypto-leaderboard?view=trending"); }} className={`px-3 py-2 rounded-lg text-xs font-bold border transition-colors flex items-center gap-1.5 ${view === "trending" ? "border-emerald-500 bg-emerald-500/10 text-emerald-500" : "border-border text-muted-foreground hover:text-foreground"}`} data-testid="tab-view-trending"><Flame className="w-3.5 h-3.5" /> Trending now</button>
              <button onClick={() => { setView("new"); window.history.replaceState(null, "", "/crypto-leaderboard?view=new"); }} className={`px-3 py-2 rounded-lg text-xs font-bold border transition-colors flex items-center gap-1.5 ${view === "new" ? "border-emerald-500 bg-emerald-500/10 text-emerald-500" : "border-border text-muted-foreground hover:text-foreground"}`} data-testid="tab-view-new"><Rocket className="w-3.5 h-3.5" /> New launches</button>
            </div>
            {view === "new" && <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">
                Sort by
              </p>
              <div className="flex gap-1.5 flex-wrap">
                {SORT_TABS.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setSort(key)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-colors flex items-center gap-1.5
                      ${sort === key
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-500"
                        : "border-border text-muted-foreground hover:text-foreground"}`}
                    data-testid={`tab-sort-${key}`}>
                    <Icon className="w-3 h-3" /> {label}
                  </button>
                ))}
              </div>
            </div>}
            {view === "new" && <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">
                Age window
              </p>
              <div className="flex gap-1.5">
                {AGE_WINDOWS.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setAgeWin(key)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-colors
                      ${ageWin === key
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-500"
                        : "border-border text-muted-foreground hover:text-foreground"}`}
                    data-testid={`tab-age-${key}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>}
          </CardContent>
        </Card>

        {/* Leaderboard */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin mb-2 text-emerald-500" />
            <p className="text-xs font-semibold">Scanning fresh launches…</p>
          </div>
        ) : launches.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Sparkles className="w-10 h-10 text-muted-foreground/40 mb-2" />
              <p className="text-sm font-bold text-muted-foreground" data-testid="text-empty-launches">
                No launches in this window
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">
                Try a wider age window or a different sort.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {launches.map((l, i) => {
              const rank = i + 1;
              const changePositive = l.change1h != null && l.change1h >= 0;
              const isHot = (l.change1h != null && l.change1h >= 25) || l.volume1h >= 10_000;
              const rankBadge =
                rank === 1 ? "bg-yellow-500 text-black"
              : rank === 2 ? "bg-gray-400 text-black"
              : rank === 3 ? "bg-amber-700 text-white"
              : "bg-muted text-muted-foreground";

              return (
                <Card
                  key={l.mint}
                  className="hover-elevate transition-all"
                  data-testid={`card-launch-${l.mint.slice(0, 8)}`}>
                  <CardContent className="p-3">
                    <div className="flex items-start gap-3">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black flex-shrink-0 ${rankBadge}`}>
                        {rank}
                      </div>

                      {l.imageUrl || l.icon ? (
                        <img src={l.imageUrl || l.icon} alt={l.symbol} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                          <span className="text-[11px] font-black text-emerald-500">{l.symbol.slice(0, 2)}</span>
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-foreground truncate" data-testid={`text-launch-name-${i}`}>
                            {l.name}
                          </span>
                          <span className="text-[10px] font-mono text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                            ${l.symbol}
                          </span>
                          {isHot && (
                            <span className="text-[10px] font-bold text-red-500 flex items-center gap-0.5">
                              <Flame className="w-2.5 h-2.5" /> Hot
                            </span>
                          )}
                          {l.graduated && (
                            <span className="text-[10px] font-bold text-emerald-500">Graduated</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-0.5">
                            <Clock className="w-2.5 h-2.5" /> {fmtAge(l.ageMins)} old
                          </span>
                          <span>·</span>
                          <span className="font-mono truncate max-w-[160px]">{l.mint}</span>
                        </div>
                      </div>

                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-black text-foreground" data-testid={`text-launch-mcap-${i}`}>
                          {fmtUsd(l.mcap)}
                        </p>
                        <p className={`text-[11px] font-bold ${changePositive ? "text-emerald-500" : "text-red-500"}`}
                          data-testid={`text-launch-change-${i}`}>
                          {l.change1h == null ? "— 1h" : `${changePositive ? "+" : ""}${l.change1h.toFixed(1)}% 1h`}
                        </p>
                      </div>
                    </div>

                    {/* Stats row */}
                    <div className="grid grid-cols-4 gap-1.5 mt-3">
                      <div className="rounded-md bg-muted/30 py-1.5 px-2 text-center">
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Vol 1h</p>
                        <p className="text-[11px] font-bold text-foreground">{fmtUsd(l.volume1h)}</p>
                      </div>
                      <div className="rounded-md bg-muted/30 py-1.5 px-2 text-center">
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Liq</p>
                        <p className="text-[11px] font-bold text-foreground">{fmtUsd(l.liquidity)}</p>
                      </div>
                      <div className="rounded-md bg-muted/30 py-1.5 px-2 text-center">
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Tx 1h</p>
                        <p className="text-[11px] font-bold text-foreground">{l.txns1h.toLocaleString()}</p>
                      </div>
                      <div className="rounded-md bg-muted/30 py-1.5 px-2 text-center">
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wide">5m</p>
                        <p className={`text-[11px] font-bold ${l.change5m == null || l.change5m >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                          {l.change5m == null ? "—" : `${l.change5m >= 0 ? "+" : ""}${l.change5m.toFixed(1)}%`}
                        </p>
                      </div>
                    </div>

                    {/* Bonding curve */}
                    {view === "new" && <div className="mt-2.5">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wide">
                          Bonding curve
                        </span>
                        <span className="text-[10px] font-bold text-foreground">{l.bondingPct}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            l.bondingPct >= 80 ? "bg-emerald-500" :
                            l.bondingPct >= 50 ? "bg-yellow-500" : "bg-blue-500"
                          }`}
                          style={{ width: `${l.bondingPct}%` }}
                        />
                      </div>
                    </div>}

                    {/* Actions */}
                    <div className="flex gap-2 mt-3">
                      <Link
                        href={`/sniper-bot?mint=${l.mint}`}
                        className="flex-1"
                        data-testid={`button-snipe-${i}`}>
                        <Button size="sm" className="w-full bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5 h-8 text-[11px] font-bold">
                          <Zap className="w-3 h-3" /> Snipe
                        </Button>
                      </Link>
                      <Link
                        href={`/scan?mint=${l.mint}`}
                        className="flex-1"
                        data-testid={`button-scan-${i}`}>
                        <Button size="sm" variant="outline" className="w-full gap-1.5 h-8 text-[11px] font-bold">
                          <BarChart3 className="w-3 h-3" /> Scan
                        </Button>
                      </Link>
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1"
                        data-testid={`link-pumpfun-${i}`}>
                        <Button size="sm" variant="outline" className="w-full gap-1.5 h-8 text-[11px] font-bold">
                          <ExternalLink className="w-3 h-3" /> pump.fun
                        </Button>
                      </a>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {launches.length > 0 && (
          <p className="text-[10px] text-muted-foreground text-center mt-4 flex items-center justify-center gap-1">
            <ArrowUpRight className="w-3 h-3" />
            Auto-refreshes every 60s · Data via DexScreener
          </p>
        )}
      </main>
    </div>
  );
}
