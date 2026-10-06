import { useEffect, useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { AlphaSecondOpinion } from "@/components/alpha-second-opinion";
import { SniperBotForm } from "@/components/sniper-bot-preview";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Rocket, Zap, ShieldCheck, Clock, ScanLine, Filter, RefreshCw,
  ChevronRight, ExternalLink, TrendingUp, AlertTriangle, CheckCircle2,
  Users, DollarSign, BarChart3, Loader2, Play, StopCircle, Target,
  Globe, Layers, MousePointerClick, WalletCards,
} from "lucide-react";

// ─── types ────────────────────────────────────────────────────────────────────
interface ScanToken {
  mint: string;
  name: string;
  symbol: string;
  price: string;
  volume24h: number;
  mcap: number;
  holders: number;
  change1h: number;
  pairAge: number;          // minutes since listing
  bondingPct: number;       // 0-100 bonding curve progress
  creatorRisk: "clean" | "high";
  icon: string;
  url: string;
}

interface ScanFilters {
  minVolume: string;
  maxMcap: string;
  minHolders: string;
  maxAgeMins: string;
  minChange1h: string;
  creatorRisk: "all" | "clean";
  autoSnipe: boolean;
}

// Strategy presets — picking one bulk-fills the filter values so a user
// can go from "I want X" → scan in one click instead of tuning six knobs.
type SniperPreset = "safe" | "moonshot" | "volume" | "custom";

interface SniperPresetConfig {
  label: string;
  blurb: string;
  filters: ScanFilters;
}

// Preset values are intentionally chosen to match the existing chip-button
// values in FilterPanel so picking a preset always lights up a visible chip
// (no invisible filter state).
const SNIPER_PRESETS: Record<Exclude<SniperPreset, "custom">, SniperPresetConfig> = {
  safe: {
    label: "Safe Bets",
    blurb: "Established holders, no rug history",
    filters: {
      minVolume: "5000", maxMcap: "500000", minHolders: "50",
      maxAgeMins: "360", minChange1h: "0", creatorRisk: "clean", autoSnipe: false,
    },
  },
  moonshot: {
    label: "Moonshot",
    blurb: "Brand-new launches, low cap, momentum",
    filters: {
      minVolume: "500", maxMcap: "50000", minHolders: "10",
      maxAgeMins: "30", minChange1h: "5", creatorRisk: "all", autoSnipe: true,
    },
  },
  volume: {
    label: "Volume Surge",
    blurb: "High 24h volume, mid-cap territory",
    filters: {
      minVolume: "10000", maxMcap: "500000", minHolders: "25",
      maxAgeMins: "360", minChange1h: "0", creatorRisk: "clean", autoSnipe: false,
    },
  },
};

// ─── helpers ──────────────────────────────────────────────────────────────────
function fmtUsd(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
function fmtAge(mins: number) {
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `${mins}m`;
}

// ─── Filter panel ─────────────────────────────────────────────────────────────
// Default values match the "Safe Bets" preset so a fresh user has a sensible
// starting filter set even before clicking any preset tile. Spread to avoid
// sharing the same object reference as SNIPER_PRESETS.safe.filters.
const DEFAULT_FILTERS: ScanFilters = { ...SNIPER_PRESETS.safe.filters };

function FilterPanel({
  filters, setFilters, onScan, scanning, preset, applyPreset,
}: {
  filters: ScanFilters;
  setFilters: (f: ScanFilters) => void;
  onScan: () => void;
  scanning: boolean;
  preset: SniperPreset;
  applyPreset: (p: SniperPreset) => void;
}) {
  // Manually editing any filter switches the preset back to "Custom" so the
  // active strategy badge never lies about what's currently configured.
  const set = (k: keyof ScanFilters, v: any) => {
    setFilters({ ...filters, [k]: v });
    if (preset !== "custom") applyPreset("custom");
  };

  return (
    <div className="space-y-4">
      {/* Strategy presets — one click fills every filter below. "Custom" lets
          the user keep editing without losing their current values. */}
      <div>
        <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground block mb-1.5">
          Quick Strategy
        </label>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(SNIPER_PRESETS) as Array<Exclude<SniperPreset, "custom">>).map(k => {
            const cfg = SNIPER_PRESETS[k];
            const active = preset === k;
            return (
              <button key={k} onClick={() => applyPreset(k)}
                data-testid={`button-sniper-preset-${k}`}
                className={`p-2.5 rounded-lg border text-left transition-colors ${active ? "border-emerald-500 bg-emerald-500/10" : "border-border hover:border-foreground/40"}`}>
                <p className={`text-xs font-bold ${active ? "text-emerald-500" : "text-foreground"}`}>{cfg.label}</p>
                <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{cfg.blurb}</p>
              </button>
            );
          })}
          <button onClick={() => applyPreset("custom")}
            data-testid="button-sniper-preset-custom"
            className={`p-2.5 rounded-lg border text-left transition-colors col-span-2 ${preset === "custom" ? "border-emerald-500 bg-emerald-500/10" : "border-border hover:border-foreground/40"}`}>
            <p className={`text-xs font-bold ${preset === "custom" ? "text-emerald-500" : "text-foreground"}`}>Custom</p>
            <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">Tune every filter yourself</p>
          </button>
        </div>
      </div>

      {/* Volume */}
      <div>
        <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground block mb-1">
          Min 24h Volume (USD)
        </label>
        <div className="flex gap-1.5 flex-wrap mb-2">
          {["0","500","1000","5000","10000"].map(v => (
            <button key={v}
              onClick={() => set("minVolume", v)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors
                ${filters.minVolume === v
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-500"
                  : "border-border text-muted-foreground hover:text-foreground"}`}
              data-testid={`filter-vol-${v}`}>
              {v === "0" ? "Any" : `$${parseInt(v).toLocaleString()}`}
            </button>
          ))}
        </div>
        <Input type="number" min="0" value={filters.minVolume}
          onChange={e => set("minVolume", e.target.value)}
          className="text-sm w-36" data-testid="input-min-volume" placeholder="Custom…" />
      </div>

      {/* Max Market Cap */}
      <div>
        <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground block mb-1">
          Max Market Cap (USD)
        </label>
        <div className="flex gap-1.5 flex-wrap mb-2">
          {[["50K","50000"],["100K","100000"],["500K","500000"],["1M","1000000"],["Any","999999999"]].map(([label,val]) => (
            <button key={val}
              onClick={() => set("maxMcap", val)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors
                ${filters.maxMcap === val
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-500"
                  : "border-border text-muted-foreground hover:text-foreground"}`}
              data-testid={`filter-mcap-${label}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Min Holders */}
      <div>
        <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground block mb-1">
          Min Holders
        </label>
        <div className="flex gap-1.5 flex-wrap mb-2">
          {["0","10","25","50","100","250"].map(v => (
            <button key={v}
              onClick={() => set("minHolders", v)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors
                ${filters.minHolders === v
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-500"
                  : "border-border text-muted-foreground hover:text-foreground"}`}
              data-testid={`filter-holders-${v}`}>
              {v === "0" ? "Any" : v}
            </button>
          ))}
        </div>
      </div>

      {/* Max Age */}
      <div>
        <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground block mb-1">
          Include tokens up to this age
        </label>
        <div className="flex gap-1.5 flex-wrap mb-2">
          {[["15m","15"],["30m","30"],["1h","60"],["2h","120"],["6h","360"],["Any","99999"]].map(([label,val]) => (
            <button key={val}
              onClick={() => set("maxAgeMins", val)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors
                ${filters.maxAgeMins === val
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-500"
                  : "border-border text-muted-foreground hover:text-foreground"}`}
              data-testid={`filter-age-${label}`}>
              {label}
            </button>
          ))}
        </div>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          This is not a waiting period. A 30m setting can show a qualifying token immediately, from launch until it is 30 minutes old.
        </p>
      </div>

      {/* Min 1h Change */}
      <div>
        <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground block mb-1">
          Min 1h Price Change
        </label>
        <div className="flex gap-1.5 flex-wrap">
          {[["Any","-999"],["0%","0"],["+5%","5"],["+10%","10"],["+25%","25"],["+50%","50"]].map(([label,val]) => (
            <button key={val}
              onClick={() => set("minChange1h", val)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors
                ${filters.minChange1h === val
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-500"
                  : "border-border text-muted-foreground hover:text-foreground"}`}
              data-testid={`filter-change-${label}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Creator Risk */}
      <div>
        <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground block mb-1">
          Creator Risk
        </label>
        <div className="flex gap-1.5">
          {(["all","clean"] as const).map(v => (
            <button key={v}
              onClick={() => set("creatorRisk", v)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-colors
                ${filters.creatorRisk === v
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-500"
                  : "border-border text-muted-foreground hover:text-foreground"}`}
              data-testid={`filter-risk-${v}`}>
              {v === "all" ? "All Creators" : "Clean Only"}
            </button>
          ))}
        </div>
      </div>

      {/* Auto-Snipe toggle */}
      <div className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
        <div>
          <p className="text-xs font-bold text-foreground">Load first strong match</p>
          <p className="text-[10px] text-muted-foreground">Opens the highest-match token in Buy now. You still review and approve the wallet transaction.</p>
        </div>
        <button
          onClick={() => set("autoSnipe", !filters.autoSnipe)}
          className={`w-10 h-6 rounded-full transition-colors flex-shrink-0 relative ${filters.autoSnipe ? "bg-emerald-500" : "bg-muted"}`}
          data-testid="toggle-auto-snipe">
          <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${filters.autoSnipe ? "translate-x-5" : "translate-x-1"}`} />
        </button>
      </div>

      <Button className="w-full font-bold" onClick={onScan} disabled={scanning}
        data-testid="button-run-scan">
        {scanning
          ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Scanning…</>
          : <><ScanLine className="w-4 h-4 mr-2" /> Run Scan</>}
      </Button>
    </div>
  );
}

// ─── Scan result card ─────────────────────────────────────────────────────────
function ScanResultCard({ token, onSnipe }: { token: ScanToken; onSnipe: (mint: string) => void }) {
  const changePositive = token.change1h >= 0;
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3"
      data-testid={`scan-result-${token.mint.slice(0, 8)}`}>
      {/* Header row */}
      <div className="flex items-start gap-3">
        {token.icon
          ? <img src={token.icon} alt={token.symbol} className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
          : <div className="w-9 h-9 rounded-full bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-black text-emerald-500">{token.symbol.slice(0,2)}</span>
            </div>
        }
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-foreground text-sm truncate">{token.name}</span>
            <span className="text-[10px] text-muted-foreground font-mono bg-muted/50 px-1.5 py-0.5 rounded">
              ${token.symbol}
            </span>
            {token.creatorRisk === "clean"
              ? <span className="text-[10px] font-bold text-emerald-500 flex items-center gap-0.5">
                  <CheckCircle2 className="w-2.5 h-2.5" /> Clean
                </span>
              : <span className="text-[10px] font-bold text-red-500 flex items-center gap-0.5">
                  <AlertTriangle className="w-2.5 h-2.5" /> Risky
                </span>
            }
          </div>
          <p className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">{token.mint}</p>
        </div>
        <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
          <span className="text-xs font-black text-foreground">${parseFloat(token.price).toFixed(8)}</span>
          <span className={`text-[11px] font-bold ${changePositive ? "text-emerald-500" : "text-red-500"}`}>
            {changePositive ? "+" : ""}{token.change1h.toFixed(1)}% 1h
          </span>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { icon: BarChart3, label: "Vol 24h", value: fmtUsd(token.volume24h) },
          { icon: DollarSign, label: "Mkt Cap", value: fmtUsd(token.mcap) },
          { icon: Users, label: "Holders", value: token.holders > 0 ? token.holders.toLocaleString() : "—" },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="rounded-lg bg-muted/30 py-2">
            <Icon className="w-3 h-3 text-muted-foreground mx-auto mb-0.5" />
            <p className="text-[10px] text-muted-foreground">{label}</p>
            <p className="text-[11px] font-bold text-foreground">{value}</p>
          </div>
        ))}
      </div>

      {/* Bonding curve bar */}
      <div>
        <div className="flex justify-between items-center mb-1">
          <span className="text-[10px] font-bold text-muted-foreground">Bonding Curve</span>
          <span className="text-[10px] font-bold text-foreground">{token.bondingPct}%</span>
        </div>
        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              token.bondingPct >= 80 ? "bg-emerald-400" :
              token.bondingPct >= 50 ? "bg-yellow-400" : "bg-blue-400"
            }`}
            style={{ width: `${token.bondingPct}%` }}
          />
        </div>
        <p className="text-[9px] text-muted-foreground mt-0.5">
          {token.bondingPct >= 80 ? "Near graduation — high snipe priority" :
           token.bondingPct >= 50 ? "Halfway to Raydium" : "Early stage token"}
          {" · "}Age: {fmtAge(token.pairAge)}
        </p>
      </div>

      <AlphaSecondOpinion
        surface="sniper"
        subjectId={token.mint}
        subjectLabel={token.symbol}
        primaryDecision={token.creatorRisk === "clean" && token.change1h >= 0 ? "Candidate passed the current scan" : "Candidate needs caution"}
        primaryVerdict={token.creatorRisk === "clean" && token.change1h >= 0 ? "positive" : "negative"}
        evidence={{
          change1h: token.change1h,
          marketCapUsd: token.mcap,
          volume24h: token.volume24h,
          holders: token.holders,
          ageMins: token.pairAge,
          creatorRisk: token.creatorRisk,
        }}
      />

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={() => onSnipe(token.mint)}
          className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors flex items-center justify-center gap-1.5"
          data-testid={`button-snipe-${token.mint.slice(0, 8)}`}>
          <Rocket className="w-3.5 h-3.5" /> Snipe This Token
        </button>
        <a href={token.url} target="_blank" rel="noopener noreferrer"
          className="px-3 py-2 rounded-xl border border-border text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          data-testid={`link-pumpfun-${token.mint.slice(0, 8)}`}>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
const FEATURES = [
  { icon: MousePointerClick, title: "No Telegram needed",   desc: "Works right in your browser — no bots to add, no tokens to buy, no setup." },
  { icon: WalletCards,       title: "Your wallet, your keys", desc: "Executes directly from your connected Solana wallet. Non-custodial." },
  { icon: ShieldCheck,       title: "One-shot safety",       desc: "Bot fires once then disarms — no runaway buys or runaway fees." },
  { icon: Globe,             title: "Built for Pump.fun",     desc: "Tracks live Pump.fun launches and graduation events on Solana." },
  { icon: Zap,               title: "Millisecond execution", desc: "Detects graduation events on-chain and fires before the crowd." },
  { icon: Clock,             title: "Auto scan mode",        desc: "Continuously filters new launches by volume, market cap, and creator risk." },
];

// ─── Live Launches view ──────────────────────────────────────────────────────
// Polls the server's PumpPortal buffer every 3 seconds. The actual real-time
// firehose runs server-side (one persistent WebSocket); we just sample its
// ring buffer here so every browser tab doesn't need its own WS connection.
interface LiveLaunch {
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
interface LiveLaunchesResponse {
  status: { connected: boolean; lastConnectedAt: number | null; bufferedLaunches: number };
  launches: LiveLaunch[];
}

function timeAgo(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function LiveLaunchesView({
  onSnipe,
  confirmedMints,
}: {
  onSnipe: (mint: string) => void;
  confirmedMints?: ReadonlySet<string>;
}) {
  const [minSolBuy, setMinSolBuy] = useState<string>("0");
  const [maxAgeMins, setMaxAgeMins] = useState<string>("30");

  const qs = new URLSearchParams({
    limit: "50",
    minSolBuy: minSolBuy,
    maxAgeMs: String(Math.max(0, parseInt(maxAgeMins, 10) || 0) * 60_000),
  }).toString();

  const { data, isLoading, error } = useQuery<LiveLaunchesResponse>({
    queryKey: ["/api/sniper/live-launches", minSolBuy, maxAgeMins],
    queryFn: async () => {
      const r = await fetch(`/api/sniper/live-launches?${qs}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
  });

  const connected = !!data?.status.connected;
  const launches = Array.from(
    new Map((data?.launches ?? []).map((launch) => [launch.mint, launch])).values(),
  ).sort(
    (a, b) => Number(confirmedMints?.has(b.mint)) - Number(confirmedMints?.has(a.mint)),
  );

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
      {/* Filter sidebar */}
      <div className="lg:col-span-1">
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="w-4 h-4 text-emerald-500" />
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Live Filters</p>
            </div>

            <div className="mb-4">
              <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground block mb-1">
                Min Initial Buy (SOL)
              </label>
              <div className="flex gap-1.5 flex-wrap mb-2">
                {["0","0.5","1","2","5"].map(v => (
                  <button key={v}
                    onClick={() => setMinSolBuy(v)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${minSolBuy === v ? "border-emerald-500 bg-emerald-500/10 text-emerald-500" : "border-border text-muted-foreground hover:text-foreground"}`}
                    data-testid={`filter-live-solbuy-${v}`}>
                    {v === "0" ? "Any" : `${v} SOL`}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-4">
              <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground block mb-1">
                Max Age
              </label>
              <div className="flex gap-1.5 flex-wrap mb-2">
                {[["1m","1"],["5m","5"],["10m","10"],["30m","30"],["1h","60"]].map(([label, v]) => (
                  <button key={v}
                    onClick={() => setMaxAgeMins(v)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${maxAgeMins === v ? "border-emerald-500 bg-emerald-500/10 text-emerald-500" : "border-border text-muted-foreground hover:text-foreground"}`}
                    data-testid={`filter-live-age-${label}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-muted/20 p-3 mt-4">
              <div className="flex items-center gap-2 mb-1">
                <span className={`relative flex h-2 w-2`}>
                  {connected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${connected ? "bg-emerald-500" : "bg-red-500"}`} />
                </span>
                <p className="text-[10px] font-bold text-foreground" data-testid="text-pumpportal-status">
                  {connected ? "PumpPortal connected" : "Disconnected — reconnecting…"}
                </p>
              </div>
              <p className="text-[10px] text-muted-foreground">
                {data?.status.bufferedLaunches ?? 0} launches in buffer · refreshes every 3s
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                30m means “up to 30 minutes old.” New launches appear immediately.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Live feed */}
      <div className="lg:col-span-3">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs font-bold text-foreground" data-testid="text-live-launches-count">
              {isLoading ? "Connecting to PumpPortal…" : `${launches.length} live launch${launches.length !== 1 ? "es" : ""}`}
            </p>
            <p className="text-[10px] text-muted-foreground">Immediate candidates from the live feed. Buy now is available without waiting for a 30-minute confirmation window.</p>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 mb-3">
            <p className="text-xs font-bold text-red-400 mb-1">Failed to fetch live launches</p>
            <p className="text-[11px] text-red-400/80">{(error as Error).message}</p>
          </div>
        )}

        {!isLoading && launches.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground border border-dashed rounded-2xl">
            <Zap className="w-8 h-8 text-muted-foreground/50" />
            <p className="text-sm font-bold">No launches in window</p>
            <p className="text-[11px] text-center max-w-xs">
              {connected
                ? "Waiting for the next pump.fun launch matching your filters. New tokens appear here within seconds."
                : "Connecting to PumpPortal — first launches will appear once the stream is live (usually <10s)."}
            </p>
          </div>
        )}

        {launches.length > 0 && (
          <div className="space-y-2">
            {launches.map(l => {
              const confirmed = confirmedMints?.has(l.mint) ?? false;
              return (
              <Card key={l.signature || l.mint} className={`transition-colors ${confirmed ? "border-emerald-500/60 bg-emerald-500/5" : "border-border hover:border-emerald-500/40"}`} data-testid={`card-live-launch-${l.mint}`}>
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-bold text-foreground truncate" data-testid={`text-live-symbol-${l.mint}`}>
                        ${l.symbol || "?"}
                      </p>
                      <span className="text-[10px] text-muted-foreground truncate">{l.name || "Unnamed"}</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/30">
                        {timeAgo(l.receivedAt)}
                      </span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${confirmed ? "border border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" : "border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>
                        {confirmed ? "Strong match" : "Early signal"}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                      <span><DollarSign className="w-2.5 h-2.5 inline" /> {l.initialBuySol.toFixed(3)} SOL initial buy</span>
                      <span><BarChart3 className="w-2.5 h-2.5 inline" /> {l.marketCapSol.toFixed(2)} SOL mcap</span>
                      <a href={`https://pump.fun/${l.mint}`} target="_blank" rel="noopener noreferrer"
                        className="text-emerald-500 hover:text-emerald-400 inline-flex items-center gap-0.5"
                        data-testid={`link-pumpfun-${l.mint}`}>
                        pump.fun <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </div>
                  </div>
                  <Button size="sm" onClick={() => onSnipe(l.mint)}
                    className="bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold"
                    data-testid={`button-snipe-live-${l.mint}`}>
                    <Target className="w-3 h-3 mr-1" /> Buy now
                  </Button>
                </CardContent>
              </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SniperBotPage() {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  // Pre-fillable mint for the manual sniper form. Seeded from ?mint= URL
  // param, then mutated by handleSnipe / auto-snipe to push scan results
  // straight into the manual form so users don't have to copy/paste.
  const [initialMint, setInitialMint] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get("mint") || "";
    } catch { return ""; }
  });
  const [mode, setMode] = useState<"manual" | "scan">("scan");

  // Scan state
  const [sniperPreset, setSniperPreset] = useState<SniperPreset>("safe");
  const [filters, setFilters] = useState<ScanFilters>(() => ({ ...DEFAULT_FILTERS }));
  const [scanEnabled, setScanEnabled] = useState(false);
  const [scanTokens, setScanTokens] = useState<ScanToken[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState<ScanFilters>(() => ({ ...DEFAULT_FILTERS }));
  // Loading the first strong match fires AT MOST ONCE per scan run (per click
  // of "Run Scan"),
  // not on every 30s refetch. This prevents the page from yanking the user
  // back to Manual mode every time a new top match appears.
  const autoPinnedThisRunRef = useRef<boolean>(false);

  /** Bulk-apply a strategy preset to the filter form. */
  function applyPreset(p: SniperPreset) {
    setSniperPreset(p);
    if (p === "custom") return;
    setFilters({ ...SNIPER_PRESETS[p].filters });
  }

  // Build query string from active filters
  const scanQS = new URLSearchParams({
    minVolume:   activeFilters.minVolume,
    maxMcap:     activeFilters.maxMcap,
    minHolders:  activeFilters.minHolders,
    maxAgeMins:  activeFilters.maxAgeMins,
    minChange1h: activeFilters.minChange1h,
    creatorRisk: activeFilters.creatorRisk,
  }).toString();

  const { data: scanData, isFetching: scanFetching, refetch: reFetch } = useQuery<ScanToken[]>({
    queryKey: ["/api/sniper/scan", scanQS],
    queryFn: async () => {
      const res = await fetch(`/api/sniper/scan?${scanQS}`);
      if (!res.ok) throw new Error("Scan failed");
      return res.json();
    },
    enabled: scanEnabled,
    refetchInterval: scanEnabled ? 30_000 : false,
    staleTime: 25_000,
  });

  useEffect(() => {
    if (scanData) {
      setScanTokens(scanData);
      setScanError(null);
    }
  }, [scanData]);

  function handleRunScan() {
    setActiveFilters({ ...filters });
    setScanEnabled(true);
    setScanTokens([]);
    setScanError(null);
    // Each "Run Scan" click starts a fresh auto-pin window — even if the same
    // top mint reappears, this run is allowed to fire once.
    autoPinnedThisRunRef.current = false;
    setTimeout(() => reFetch(), 50);
  }

  function handleStopScan() {
    setScanEnabled(false);
    setScanTokens([]);
    autoPinnedThisRunRef.current = false;
  }

  function handleSnipe(mint: string) {
    // Push the scan-result mint into the manual sniper form via initialMint
    // (SniperBotForm watches that prop in a useEffect). User still confirms
    // the buy by clicking Buy in the form — we never silently move funds.
    setInitialMint(mint);
    setMode("manual");
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast({
      title: "Token loaded",
      description: `${mint.slice(0, 6)}…${mint.slice(-4)} pinned in manual form. Review settings, then click Buy.`,
    });
  }

  // First-strong-match wiring: fires AT MOST ONCE per scan run. The first non-empty
  // result set after clicking "Run Scan" auto-pins the top match into the
  // manual form. Subsequent 30s refetches do NOT re-yank the user — they
  // can still review the running scan list. To re-arm, click Run Scan again.
  useEffect(() => {
    if (!activeFilters.autoSnipe || !scanEnabled) return;
    if (autoPinnedThisRunRef.current) return;
    const top = scanTokens[0];
    if (!top?.mint) return;
    autoPinnedThisRunRef.current = true;
    handleSnipe(top.mint);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanTokens, activeFilters.autoSnipe, scanEnabled]);

  const isScanning = scanEnabled && scanFetching;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">

        {/* Page header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <Rocket className="w-6 h-6 text-emerald-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Sniper Bot</h1>
            <p className="text-sm text-muted-foreground">Browser-based. Non-custodial. No Telegram required.</p>
          </div>
          <span className="ml-auto text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400"
            data-testid="badge-hackathon">
            Hackathon 2026 Q1
          </span>
        </div>

        {/* Chain selector */}
        <div className="flex items-center gap-2 mb-5">
          <div className="flex gap-1 p-1 rounded-xl bg-muted/50 border border-border" data-testid="tabs-chain">
            <div
              className="flex items-center gap-1.5 rounded-lg bg-background px-3 py-1.5 text-xs font-bold text-foreground shadow-sm"
              data-testid="tab-chain-solana"
            >
              <img src="https://cryptologos.cc/logos/solana-sol-logo.png" alt="SOL" className="w-3.5 h-3.5 rounded-full" />
              Solana
              <span className="text-[9px] font-bold bg-emerald-500 text-white px-1.5 py-0.5 rounded-full">LIVE</span>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground hidden sm:block">
            Sniping pump.fun graduated tokens on Solana
          </p>
        </div>

        {/* One manual path and one combined discovery path. The discovery view
            keeps immediate live launches beside the richer confirmed scan so
            users do not have to choose between speed and stronger signals. */}
        <div className="flex gap-1 p-1 rounded-xl bg-muted/50 border border-border w-fit mb-6" data-testid="tabs-sniper-mode">
          <button
            onClick={() => setMode("manual")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-colors ${mode === "manual" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            data-testid="tab-manual">
            <Target className="w-3.5 h-3.5" /> Manual Snipe
          </button>
          <button
            onClick={() => setMode("scan")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-colors ${mode === "scan" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            data-testid="tab-auto-scan">
            <ScanLine className="w-3.5 h-3.5" /> Launch Signals
          </button>
        </div>

        {/* ── MANUAL MODE ── */}
        {mode === "manual" && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-2">
              <div className="rounded-2xl border border-border bg-card p-5 space-y-1" data-testid="panel-sniper-config">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-3">Configure Bot</p>
                <SniperBotForm compact={false} initialToken={initialMint} />
              </div>
            </div>

            <div className="lg:col-span-3 flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {FEATURES.map(({ icon: Icon, title, desc }) => (
                  <div key={title} className="rounded-xl border border-border bg-muted/30 p-4">
                    <Icon className="w-5 h-5 text-emerald-500 mb-2" />
                    <p className="text-sm font-bold text-foreground mb-1">{title}</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{desc}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-border bg-card p-5">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-3">How it works</p>
                <ol className="space-y-3">
                  {[
                    ["Paste a token address", "Enter the mint address of the pump.fun token you want to snipe."],
                    ["Set your buy amount", "Choose how much SOL to spend and your slippage tolerance."],
                    ["Pick priority fee", "Higher fee = faster execution. Ultra is recommended for hot launches."],
                    ["Arm the bot", "The bot watches for the token's graduation event and fires instantly."],
                  ].map(([step, detail], i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[11px] font-bold flex items-center justify-center">
                        {i + 1}
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-foreground">{step}</p>
                        <p className="text-[11px] text-muted-foreground">{detail}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-[11px] text-blue-600 dark:text-blue-400 leading-relaxed">
                <strong>Tip:</strong> Don't know which token to snipe? Switch to{" "}
                <button onClick={() => setMode("scan")} className="underline font-bold hover:text-blue-500">
                  Launch Signals
                </button>{" "}
                to see launches immediately and confirm stronger matches with volume, market cap, holder, momentum, and creator filters.
              </div>

              <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 text-[11px] text-yellow-600 dark:text-yellow-400 leading-relaxed">
                <strong>Risk notice:</strong> Sniping newly launched tokens carries significant risk. Tokens may be rugged, illiquid, or have extreme volatility. Never snipe with more than you're willing to lose.
              </div>
            </div>
          </div>
        )}

        {/* ── AUTO SCAN MODE ── */}
        {mode === "scan" && (
          <div className="space-y-8">
            <section aria-labelledby="instant-launches-heading">
              <div className="mb-3">
                <p id="instant-launches-heading" className="text-sm font-bold text-foreground">1. Fresh launches — act immediately</p>
                <p className="text-[11px] text-muted-foreground">The fast feed appears first so a short run is not missed. These are early candidates, not fully confirmed signals.</p>
              </div>
              <LiveLaunchesView onSnipe={handleSnipe} confirmedMints={new Set(scanTokens.map((token) => token.mint))} />
            </section>

            <section aria-labelledby="confirmed-signals-heading">
              <div className="mb-3">
                <p id="confirmed-signals-heading" className="text-sm font-bold text-foreground">2. Stronger signal scan</p>
                <p className="text-[11px] text-muted-foreground">Use richer market and creator checks when enough data exists. A 30m age choice never delays a match—it only excludes older tokens.</p>
              </div>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            {/* Filter panel */}
            <div className="lg:col-span-2">
              <Card data-testid="panel-scan-filters">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Filter className="w-4 h-4 text-emerald-500" />
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Scan Filters</p>
                  </div>
                  <FilterPanel
                    filters={filters}
                    setFilters={setFilters}
                    onScan={handleRunScan}
                    scanning={isScanning}
                    preset={sniperPreset}
                    applyPreset={applyPreset}
                  />
                </CardContent>
              </Card>
            </div>

            {/* Results panel */}
            <div className="lg:col-span-3">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs font-bold text-foreground">
                    {scanEnabled
                      ? isScanning
                        ? "Scanning pump.fun…"
                        : `${scanTokens.length} matching token${scanTokens.length !== 1 ? "s" : ""} found`
                      : "Set filters and run scan"}
                  </p>
                  {scanEnabled && !isScanning && (
                    <p className="text-[10px] text-muted-foreground">Auto-refreshes every 30s</p>
                  )}
                </div>
                {scanEnabled && (
                  <button onClick={handleStopScan}
                    className="text-[11px] text-muted-foreground hover:text-red-400 transition-colors flex items-center gap-1"
                    data-testid="button-stop-scan">
                    <StopCircle className="w-3.5 h-3.5" /> Stop
                  </button>
                )}
              </div>

              {/* Loading state */}
              {isScanning && scanTokens.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
                  <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                  <p className="text-sm font-bold">Scanning pump.fun tokens…</p>
                  <p className="text-[11px]">Fetching latest launches and applying your filters</p>
                </div>
              )}

              {/* Empty state */}
              {scanEnabled && !isScanning && scanTokens.length === 0 && !scanError && (
                <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground border border-dashed rounded-2xl">
                  <ScanLine className="w-8 h-8 text-muted-foreground/50" />
                  <p className="text-sm font-bold">No tokens match your filters</p>
                  <p className="text-[11px] text-center max-w-xs">
                    Try loosening your criteria — lower the min volume, increase max market cap, or extend the age window.
                  </p>
                  <button onClick={handleRunScan}
                    className="text-xs text-emerald-500 underline font-bold hover:text-emerald-400"
                    data-testid="button-retry-scan">Retry with current filters</button>
                </div>
              )}

              {/* Idle state */}
              {!scanEnabled && (
                <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground border border-dashed rounded-2xl">
                  <Filter className="w-8 h-8 text-muted-foreground/50" />
                  <p className="text-sm font-bold">Configure filters and run a scan</p>
                  <p className="text-[11px] text-center max-w-xs">
                    Set your volume, market cap, holder, age, and risk criteria on the left, then hit <strong>Run Scan</strong>.
                  </p>
                </div>
              )}

              {/* Results */}
              {scanTokens.length > 0 && (
                <div className="space-y-3">
                  {/* First strong match loaded banner */}
                  {activeFilters.autoSnipe && (
                    <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-2.5 flex items-center gap-2">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                      </span>
                      <span className="text-xs font-bold text-emerald-400">
                        First strong match loaded — {scanTokens[0]?.symbol} is ready in Buy now (review and approve)
                      </span>
                    </div>
                  )}
                  {scanTokens.map(token => (
                    <ScanResultCard key={token.mint} token={token} onSnipe={handleSnipe} />
                  ))}
                </div>
              )}

              {/* What the filters do */}
              {!scanEnabled && (
                <div className="mt-4 rounded-xl border border-border bg-muted/20 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-3">What each filter does</p>
                  <div className="space-y-2">
                    {[
                      ["Min 24h Volume", "Only show tokens actively being traded. Higher volume = more interest."],
                      ["Max Market Cap", "Keep it early-stage. Smaller cap = more upside potential (and more risk)."],
                      ["Min Holders", "Filter out tokens concentrated in few wallets — early sign of a rug."],
                      ["Include tokens up to this age", "This caps how old a result may be; it never makes the scanner wait before showing a match."],
                      ["Min 1h Change", "Only surface tokens already showing momentum in the last hour."],
                      ["Creator Risk", "Clean only hides tokens from wallets with prior rug history."],
                    ].map(([label, desc]) => (
                      <div key={label as string} className="flex items-start gap-2">
                        <ChevronRight className="w-3 h-3 text-emerald-500 flex-shrink-0 mt-0.5" />
                        <div>
                          <span className="text-[11px] font-bold text-foreground">{label}: </span>
                          <span className="text-[11px] text-muted-foreground">{desc}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
              </div>
            </section>
          </div>
        )}

      </main>
      <Footer />
    </div>
  );
}
