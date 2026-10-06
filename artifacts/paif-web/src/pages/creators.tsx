import { FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Clock3,
  Copy,
  DatabaseZap,
  ExternalLink,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Star,
  Waves,
} from "lucide-react";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type SortMode =
  | "newest"
  | "observedEvents"
  | "launches"
  | "activity"
  | "graduationRate"
  | "marketCap"
  | "currentMarketCap"
  | "volume24h"
  | "volume12h"
  | "volumeTotal";
type Direction = "asc" | "desc";
type StreamState =
  "connecting" | "live" | "reconnecting" | "stale" | "error" | "disabled";
type StreamStatus = {
  state: StreamState;
  lastSuccessAt?: string | number | null;
  lastPersistedGrossTradeAt?: string | number | null;
  message?: string | null;
  replayCoverage?: number | null;
  replayProgress?: number | null;
  partial?: boolean;
};
type Creator = {
  wallet: string;
  launchCount: number;
  observedEventCount?: number;
  latestLaunchAt?: string | number | null;
  activityCount: number;
  historyCoverage?: number | null;
  latestToken?: {
    mint: string;
    name?: string | null;
    symbol?: string | null;
    hasDexPair?: boolean;
  } | null;
  bestObservedToken?: {
    mint: string;
    name?: string | null;
    symbol?: string | null;
    peakMarketCapUsd: number;
    peakObservedAt?: string | null;
    hasDexPair?: boolean;
  } | null;
  graduatedLaunchCount?: number;
  graduatedLaunchRate?: number | null;
  outcomeCoveredTokens?: number;
  maxLaunchMarketCapQuote?: number | null;
  maxLaunchMarketCapCurrency?: string | null;
  currentMarketCapUsd?: number | null;
  currentMarketCapCoveredTokens?: number;
  volume24hUsd?: number | null;
  volume24hCoveredTokens?: number;
  observedTokenCount?: number;
  volume24hObservedAt?: string | null;
  observedVolume12hQuote?: number | null;
  observedVolumeTotalQuote?: number | null;
  observedVolumeQuoteCurrency?: string;
  observedTradeCount?: number;
  unsupportedObservedTradeCount?: number;
  hasDexPair?: boolean;
  partial?: boolean;
};
type Launch = {
  eventKey: string;
  mint: string;
  name?: string | null;
  symbol?: string | null;
  launchWallet: string;
  signature: string;
  pool?: string | null;
  timestamp: string | number;
  source?: string | null;
  launchMarketCapQuote?: number | null;
  launchMarketCapCurrency?: string | null;
  currentMarketCapUsd?: number | null;
  volume24hUsd?: number | null;
  observedVolume12hQuote?: number | null;
  observedVolumeTotalQuote?: number | null;
  observedVolumeQuoteCurrency?: string;
  unsupportedObservedTradeCount?: number;
  hasDexPair?: boolean;
  graduated?: boolean | null;
  peakMarketCapUsd?: number | null;
  peakObservedAt?: string | null;
};
type LeaderboardResponse = { creators: Creator[]; status?: StreamStatus };
type DetailResponse = {
  creator: Creator;
  launches: Launch[];
  status?: StreamStatus;
};
type TokenScanResult = {
  tokenAddress: string;
  tokenName?: string | null;
  tokenSymbol?: string | null;
  creatorAddress?: string | null;
};

const sortOptions: Array<{ value: SortMode; label: string; caption: string }> = [
  { value: "newest", label: "Latest Activity", caption: "Recently observed" },
  { value: "observedEvents", label: "Observed Events", caption: "All retained create events" },
  { value: "launches", label: "Observed Launches", caption: "Unique observed token launches" },
];
const headers: Array<{ value: SortMode; label: string }> = [
  { value: "newest", label: "Latest Activity" },
  { value: "observedEvents", label: "Events" },
  { value: "launches", label: "Launches" },
  { value: "activity", label: "72h" },
  { value: "graduationRate", label: "Graduated / Covered" },
  { value: "marketCap", label: "Best Observed Token" },
  { value: "currentMarketCap", label: "Total Current MCap (USD)" },
  { value: "volume24h", label: "24 Hour Volume" },
  { value: "volume12h", label: "12 Hour Volume" },
  { value: "volumeTotal", label: "Total Volume" },
];
function compact(value: string, start = 5, end = 4) {
  return value.length > start + end + 2
    ? `${value.slice(0, start)}…${value.slice(-end)}`
    : value;
}
function tokenChart(mint: string, hasDexPair?: boolean) {
  return hasDexPair
    ? { href: `https://dexscreener.com/solana/${mint}`, label: "DexScreener Chart" }
    : { href: `https://pump.fun/coin/${mint}`, label: "Pump.fun Chart" };
}
function dateFrom(value?: string | number | null) {
  if (!value) return null;
  const d = new Date(
    typeof value === "number" && value < 10_000_000_000 ? value * 1000 : value,
  );
  return Number.isNaN(d.valueOf()) ? null : d;
}
function relativeDate(value?: string | number | null) {
  const d = dateFrom(value);
  if (!d) return "Not available";
  const s = Math.max(0, Math.round((Date.now() - d.valueOf()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function compactNumber(value?: number | null, currency = "") {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  const a = Math.abs(value);
  const suffix = a >= 1e9 ? "B" : a >= 1e6 ? "M" : a >= 1e3 ? "K" : "";
  const divisor =
    suffix === "B" ? 1e9 : suffix === "M" ? 1e6 : suffix === "K" ? 1e3 : 1;
  return `${currency}${(value / divisor).toLocaleString(undefined, { maximumFractionDigits: suffix || a >= 100 ? 1 : 2 })}${suffix}`;
}

function percentage(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value))
    return null;
  return Math.min(100, Math.max(0, value <= 1 ? value * 100 : value));
}
async function request<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok)
    throw new Error(`Could not load creator intelligence (${r.status})`);
  return r.json();
}
async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Could not scan token (${r.status})`);
  return r.json();
}
function StatusPill({ status }: { status?: StreamStatus }) {
  const state = status?.state ?? "connecting";
  const labels: Record<StreamState, string> = {
    connecting: "Connecting",
    live: "Live",
    reconnecting: "Reconnecting",
    stale: "Delayed",
    error: "Feed issue",
    disabled: "Feed paused",
  };
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[.13em] text-emerald-700 dark:text-emerald-300">
      <span
        className={`h-1.5 w-1.5 rounded-full ${state === "live" ? "animate-pulse bg-emerald-500" : "bg-current"}`}
      />
      {labels[state]}
    </span>
  );
}
function CopyMint({ mint, onCopied }: { mint: string; onCopied: () => void }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    await navigator.clipboard?.writeText(mint);
    setDone(true);
    onCopied();
    window.setTimeout(() => setDone(false), 1400);
  };
  return (
    <button
      type="button"
      onClick={copy}
      title="Copy full mint"
      aria-label="Copy full mint"
      className="inline-flex items-center gap-1 rounded px-1 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-300"
    >
      {done ? (
        <Check className="h-3 w-3 text-emerald-600" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
      {done ? "Copied" : compact(mint, 7, 6)}
    </button>
  );
}
function Metrics({ launch }: { launch: Launch }) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-muted-foreground sm:grid-cols-6">
      <span>
        Current{" "}
        <b className="text-foreground">
          {compactNumber(launch.currentMarketCapUsd, "$")}
        </b>
      </span>
      <span>
        Observed peak{" "}
        <b className="text-foreground">
          {compactNumber(launch.peakMarketCapUsd, "$")}
        </b>
      </span>
      <span>
        Outcome{" "}
        <b className="text-foreground">
          {launch.graduated == null ? "Not observed" : launch.graduated ? "Graduated" : "Not graduated"}
        </b>
      </span>
      <span>
        24h{" "}
        <b className="text-foreground">
          {compactNumber(launch.volume24hUsd, "$")}
        </b>
      </span>
      <span>
        12 Hour Volume{" "}
        <b className="text-foreground">
          {compactNumber(launch.observedVolume12hQuote)}{" "}
          {launch.observedVolumeQuoteCurrency || "SOL"}
        </b>
      </span>
      <span>
        Total{" "}
        <b className="text-foreground">
          {compactNumber(launch.observedVolumeTotalQuote)}{" "}
          {launch.observedVolumeQuoteCurrency || "SOL"}
        </b>
      </span>
    </div>
  );
}
function History({
  wallet,
  onCopied,
}: {
  wallet: string;
  onCopied: () => void;
}) {
  const q = useQuery<DetailResponse>({
    queryKey: ["/api/creators", wallet],
    queryFn: () => request(`/api/creators/${encodeURIComponent(wallet)}`),
    refetchInterval: 4500,
    staleTime: 3000,
  });
  const launches = q.data?.launches ?? [];
  const bestPeak = Math.max(...launches.map((launch) => launch.peakMarketCapUsd ?? -1));
  return (
    <div
      className="border-t border-emerald-900/10 bg-emerald-500/[.035] px-3 py-3 dark:border-emerald-100/10 sm:px-5"
      data-testid={`creator-history-${wallet}`}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DatabaseZap className="h-3.5 w-3.5 text-emerald-600" />
          <p className="text-xs font-extrabold">Observed launch history</p>
          {q.data?.status?.partial && (
            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
              Partial history
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => q.refetch()}
          disabled={q.isFetching}
          className="h-7 text-[10px]"
        >
          <RefreshCw
            className={`mr-1 h-3 w-3 ${q.isFetching ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>
      {q.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      )}
      {q.isError && (
        <div className="flex justify-between rounded border border-red-500/20 p-3 text-xs">
          History temporarily unavailable.
          <Button
            variant="outline"
            size="sm"
            onClick={() => q.refetch()}
            className="h-7"
          >
            Try again
          </Button>
        </div>
      )}
      {!q.isLoading && !q.isError && launches.length === 0 && (
        <p className="rounded border border-dashed p-4 text-center text-xs text-muted-foreground">
          No launches are available for this observed history.
        </p>
      )}
      {!q.isLoading && !q.isError && (
        <div className="space-y-1.5">
          {launches.map((l) => (
            <div
              key={l.eventKey}
              className="rounded-lg border border-emerald-900/10 bg-card px-3 py-2.5 dark:border-emerald-100/10"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-extrabold">
                    {l.name || "Unnamed token"}{" "}
                    {l.symbol && (
                      <span className="font-mono text-emerald-700">
                        ${l.symbol}
                      </span>
                    )}
                    {l.peakMarketCapUsd != null && l.peakMarketCapUsd === bestPeak && (
                      <span className="ml-2 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">
                        Creator high
                      </span>
                    )}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                    <CopyMint mint={l.mint} onCopied={onCopied} />
                    <span className="text-[10px] text-muted-foreground">
                      <Clock3 className="mr-1 inline h-3 w-3" />
                      {relativeDate(l.timestamp)}
                    </span>
                    {l.source && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase">
                        {l.source}
                      </span>
                    )}
                  </div>
                  <Metrics launch={l} />
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <a
                    href={tokenChart(l.mint, l.hasDexPair).href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-7 items-center gap-1 rounded border border-emerald-600/25 px-2 text-[10px] font-bold text-emerald-700 hover:bg-emerald-500/10"
                  >
                    {tokenChart(l.mint, l.hasDexPair).label} <ArrowUpRight className="h-3 w-3" />
                  </a>
                  <Link
                    href={`/scan?q=${encodeURIComponent(l.mint)}`}
                    className="inline-flex h-7 items-center rounded border border-emerald-600/25 px-2 text-[10px] font-bold text-emerald-700 hover:bg-emerald-500/10"
                  >
                    Scanner
                  </Link>
                  <a
                    href={`https://solscan.io/tx/${l.signature}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-7 items-center gap-1 rounded border px-2 text-[10px] font-bold text-muted-foreground hover:bg-muted"
                  >
                    Solscan <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function CreatorRow({
  creator,
  rank,
  open,
  toggle,
  favorite,
  onFavorite,
  onCopied,
}: {
  creator: Creator;
  rank: number;
  open: boolean;
  toggle: () => void;
  favorite: boolean;
  onFavorite: () => void;
  onCopied: () => void;
}) {
  const token = creator.bestObservedToken ?? creator.latestToken;
  return (
    <article
      className="overflow-hidden border-b border-border/70 bg-card/70 transition-colors hover:bg-emerald-500/[.025]"
      data-testid={`creator-row-${creator.wallet}`}
    >
      <div className="grid grid-cols-[28px_minmax(0,1fr)_28px_32px] items-center gap-2 px-3 py-2.5 sm:grid-cols-[28px_minmax(140px,1.1fr)_minmax(145px,1fr)_60px_60px_60px_100px_105px_105px_105px_105px_28px_72px] sm:px-4">
        <span className="font-mono text-xs text-muted-foreground">
          {String(rank).padStart(2, "0")}
        </span>
        <div className="hidden min-w-0 sm:block">
          <p
            className="truncate font-mono text-xs font-bold"
            title={creator.wallet}
          >
            {compact(creator.wallet, 7, 6)}
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            <Clock3 className="mr-1 inline h-3 w-3" />
            {relativeDate(creator.latestLaunchAt)}
          </p>
        </div>
        <div className="hidden min-w-0 sm:block">
          <p className="truncate text-xs font-extrabold">
            {token?.name || "No token label"}
          </p>
          <div className="flex items-center gap-1">
            <span className="font-mono text-[10px] text-emerald-700 dark:text-emerald-300">
              {token?.symbol ? `$${token.symbol}` : ""}
            </span>
            {token?.mint && <CopyMint mint={token.mint} onCopied={onCopied} />}
            {token?.mint && (
              <a
                href={tokenChart(token.mint, token.hasDexPair).href}
                target="_blank"
                rel="noreferrer"
                title={`Open token on ${token.hasDexPair ? "DexScreener" : "Pump.fun"}`}
                aria-label="Open token chart"
                className="inline-flex items-center rounded p-0.5 text-emerald-700 hover:bg-emerald-500/10"
              >
                <ArrowUpRight className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
        <div className="min-w-0 sm:hidden">
          <p
            className="truncate font-mono text-xs font-bold"
            title={creator.wallet}
          >
            {compact(creator.wallet, 7, 6)}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {token?.name || "No token label"}{" "}
            {token?.symbol ? `· $${token.symbol}` : ""}
          </p>
        </div>
        <span className="hidden text-right font-mono text-xs tabular-nums sm:block">
          {(creator.observedEventCount ?? creator.launchCount).toLocaleString()}
        </span>
        <span className="hidden text-right font-mono text-xs tabular-nums sm:block">
          {creator.launchCount.toLocaleString()}
        </span>
        <span className="hidden text-right font-mono text-xs tabular-nums sm:block">
          {creator.activityCount.toLocaleString()}
        </span>
        <span className="hidden text-right font-mono text-xs tabular-nums sm:block">
          {creator.outcomeCoveredTokens
            ? `${creator.graduatedLaunchCount ?? 0}/${creator.outcomeCoveredTokens} (${((creator.graduatedLaunchRate ?? 0) * 100).toFixed(0)}%)`
            : "—"}
        </span>
        <span
          className="hidden text-right font-mono text-xs tabular-nums sm:block"
          title={creator.bestObservedToken?.mint || "No observed market-cap high"}
        >
          {creator.bestObservedToken
            ? `${creator.bestObservedToken.symbol ? `$${creator.bestObservedToken.symbol} ` : ""}${compactNumber(creator.bestObservedToken.peakMarketCapUsd, "$")}`
            : "—"}
        </span>
        <span className="hidden text-right font-mono text-xs tabular-nums sm:block">
          {compactNumber(creator.currentMarketCapUsd, "$")}
          {creator.currentMarketCapCoveredTokens !== undefined && creator.observedTokenCount !== undefined && (
            <small className={`ml-1 text-[8px] ${creator.currentMarketCapCoveredTokens < creator.observedTokenCount ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`} title="Tokens with a fresh current market-cap measurement">
              {creator.currentMarketCapCoveredTokens}/{creator.observedTokenCount}
              {creator.currentMarketCapCoveredTokens < creator.observedTokenCount ? " partial" : ""}
            </small>
          )}
        </span>
        <span className="hidden text-right font-mono text-xs tabular-nums sm:block">
          {compactNumber(creator.volume24hUsd, "$")}
          {creator.volume24hCoveredTokens !== undefined && creator.observedTokenCount !== undefined && (
            <small className={`ml-1 text-[8px] ${creator.volume24hCoveredTokens < creator.observedTokenCount ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`} title="Tokens with a fresh 24-hour volume measurement">
              {creator.volume24hCoveredTokens}/{creator.observedTokenCount}
              {creator.volume24hCoveredTokens < creator.observedTokenCount ? " partial" : ""}
            </small>
          )}
        </span>
        <span className="hidden text-right font-mono text-xs tabular-nums sm:block">
          {compactNumber(creator.observedVolume12hQuote)}
        </span>
        <span className="hidden text-right font-mono text-xs tabular-nums sm:block">
          {compactNumber(creator.observedVolumeTotalQuote)}
        </span>
        <button
          type="button"
          onClick={onFavorite}
          aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={favorite}
          className={`rounded p-1 transition-transform active:scale-90 ${favorite ? "text-emerald-500" : "text-muted-foreground hover:text-emerald-600"}`}
        >
          <Star className={`h-4 w-4 ${favorite ? "fill-current" : ""}`} />
        </button>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label={open ? "Collapse history" : "Expand history"}
          className="inline-flex h-7 items-center justify-center gap-1 rounded border border-emerald-600/25 px-1.5 text-[10px] font-bold text-emerald-700 hover:bg-emerald-500/10"
        >
          {open ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1 px-3 pb-2 text-[10px] text-muted-foreground sm:hidden">
        <span>
          Best observed:{" "}
          <b className="text-foreground">
            {creator.bestObservedToken
              ? `${creator.bestObservedToken.symbol ? `$${creator.bestObservedToken.symbol} · ` : ""}${compactNumber(creator.bestObservedToken.peakMarketCapUsd, "$")}`
              : "—"}
          </b>
        </span>
        <span>
          Graduated:{" "}
          <b className="text-foreground">
            {creator.outcomeCoveredTokens
              ? `${creator.graduatedLaunchCount ?? 0}/${creator.outcomeCoveredTokens} (${((creator.graduatedLaunchRate ?? 0) * 100).toFixed(0)}%)`
              : "Not observed"}
          </b>
        </span>
        <span>
          Current:{" "}
          <b className="text-foreground">
            {compactNumber(creator.currentMarketCapUsd, "$")}
          </b>
          {creator.currentMarketCapCoveredTokens !== undefined && creator.observedTokenCount !== undefined && (
            <small className={creator.currentMarketCapCoveredTokens < creator.observedTokenCount ? "ml-1 text-amber-600 dark:text-amber-400" : "ml-1"}>
              ({creator.currentMarketCapCoveredTokens}/{creator.observedTokenCount}{creator.currentMarketCapCoveredTokens < creator.observedTokenCount ? " partial" : ""})
            </small>
          )}
        </span>
        <span>
          24h:{" "}
          <b className="text-foreground">
            {compactNumber(creator.volume24hUsd, "$")}
          </b>
          {creator.volume24hCoveredTokens !== undefined && creator.observedTokenCount !== undefined && (
            <small className={creator.volume24hCoveredTokens < creator.observedTokenCount ? "ml-1 text-amber-600 dark:text-amber-400" : "ml-1"}>
              ({creator.volume24hCoveredTokens}/{creator.observedTokenCount}{creator.volume24hCoveredTokens < creator.observedTokenCount ? " partial" : ""})
            </small>
          )}
        </span>
        <span>
          12 Hour / Total Volume:{" "}
          <b className="text-foreground">
            {compactNumber(creator.observedVolume12hQuote)} /{" "}
            {compactNumber(creator.observedVolumeTotalQuote)}
          </b>
        </span>
      </div>
      {open && <History wallet={creator.wallet} onCopied={onCopied} />}
    </article>
  );
}

export default function CreatorsPage() {
  const MAX_FAVORITES = 100;
  const [sort, setSort] = useState<SortMode>("launches");
  const [direction, setDirection] = useState<Direction>("desc");
  const [tab, setTab] = useState<"leaderboard" | "favorites">("leaderboard");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [favorites, setFavorites] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [tokenMint, setTokenMint] = useState("");
  const [inputError, setInputError] = useState("");
  useEffect(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem("paif.creatorFavorites") || "[]");
      const normalized = Array.from(new Set(
        (Array.isArray(parsed) ? parsed : []).filter(
          (wallet): wallet is string => typeof wallet === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet),
        ),
      )).slice(0, MAX_FAVORITES);
      localStorage.setItem("paif.creatorFavorites", JSON.stringify(normalized));
      setFavorites(normalized);
    } catch {
      setFavorites([]);
    }
  }, []);
  const flash = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 1800);
  };
  const toggleFavorite = (wallet: string) =>
    setFavorites((current) => {
      if (!current.includes(wallet) && current.length >= MAX_FAVORITES) {
        flash(`Favorites are limited to ${MAX_FAVORITES} creators`);
        return current;
      }
      const next = current.includes(wallet)
        ? current.filter((w) => w !== wallet)
        : [...current, wallet];
      localStorage.setItem("paif.creatorFavorites", JSON.stringify(next));
      return next;
    });
  const toggleOpen = (wallet: string) =>
    setOpen((current) => {
      const next = new Set(current);
      next.has(wallet) ? next.delete(wallet) : next.add(wallet);
      return next;
    });
  const favoriteWallets = tab === "favorites" ? favorites.join(",") : "";
  const q = useQuery<LeaderboardResponse>({
    queryKey: ["/api/creators", sort, direction, favoriteWallets],
    queryFn: () => request(`/api/creators?sort=${sort}&direction=${direction}${favoriteWallets ? `&wallets=${encodeURIComponent(favoriteWallets)}` : ""}`),
    refetchInterval: 4500,
    staleTime: 3000,
  });
  const creators = q.data?.creators ?? [];
  const visible = tab === "favorites" ? creators.filter((c) => favorites.includes(c.wallet)) : creators;
  const status = q.data?.status;
  const coverage = percentage(status?.replayCoverage ?? status?.replayProgress);
  const isLimited = Boolean(
    status?.partial ||
    status?.state === "stale" ||
    (coverage !== null && coverage < 100),
  );
  const tokenScan = useQuery<TokenScanResult>({
    queryKey: ["creator-token-scan", tokenMint],
    queryFn: () => post("/api/scan", { query: tokenMint }),
    enabled: Boolean(tokenMint),
    retry: false,
  });
  const creatorWallet = tokenScan.data?.creatorAddress || "";
  const submitToken = (e: FormEvent) => {
    e.preventDefault();
    const mint = tokenInput.trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
      setInputError("Enter a valid Solana token contract address.");
      return;
    }
    setInputError("");
    setTokenMint(mint);
  };
  const setRanking = (value: SortMode) => {
    if (sort === value) setDirection((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSort(value);
      setDirection("desc");
    }
  };
  const sortLabel = useMemo(
    () => headers.find((h) => h.value === sort)?.label || "Launches",
    [sort],
  );
  const copied = () => {
    flash("Mint copied");
  };
  return (
    <div className="min-h-[100dvh] bg-background">
      <Header />
      <main className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_at_68%_0%,hsl(151_73%_43%/.15),transparent_64%)]" />
        <div className="relative mx-auto max-w-[1500px] px-3 py-7 sm:px-6 sm:py-10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-3 flex items-center gap-2">
                <Waves className="h-4 w-4 text-emerald-600" />
                <span className="font-mono text-[10px] font-bold uppercase tracking-[.17em] text-emerald-700">
                  Creator intelligence
                </span>
              </div>
              <h1 className="font-serif text-4xl font-bold leading-[.94] tracking-[-.045em] text-white sm:text-6xl">
                Watch the wallets
                <br />
                <span>behind the launches.</span>
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
                 A live record of token creators and launches observed by PAIF.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <StatusPill status={status} />
              <p className="text-right text-[10px] text-muted-foreground">
                {status?.lastSuccessAt
                  ? `Last launch update ${relativeDate(status.lastSuccessAt)}`
                  : "Waiting for a successful launch update"}
              </p>
            </div>
          </div>
          {isLimited && (
            <div className="mt-5 flex gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[.07] p-3 text-xs">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="font-bold">Observed history may be limited</p>
                <p className="mt-0.5 leading-relaxed text-muted-foreground">
                  {status?.message ||
                    `${coverage !== null ? `${coverage.toFixed(0)}% replay coverage is currently reported. ` : ""}Sparse or partial history cannot establish a creator’s safety or intent.`}
                </p>
              </div>
            </div>
          )}
          <section className="mt-7 rounded-2xl border border-emerald-600/20 bg-card/80 p-4 shadow-[0_16px_42px_hsl(156_35%_16%/.05)]">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-emerald-600" />
               <p className="text-sm font-extrabold">Search by token contract</p>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
               Paste a Solana token contract address to identify its linked
               creator wallet and compare the observed launch history.
            </p>
            <form
              onSubmit={submitToken}
              className="mt-3 flex flex-col gap-2 sm:flex-row"
            >
              <input
                value={tokenInput}
                onChange={(e) => {
                  setTokenInput(e.target.value);
                  setInputError("");
                }}
                 placeholder="Solana token contract address"
                 aria-label="Solana token contract address"
                className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 font-mono text-xs outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/15"
              />
              <Button
                type="submit"
                disabled={tokenScan.isFetching}
                className="h-9 gap-2 bg-emerald-700 text-emerald-50 hover:bg-emerald-800"
              >
                <Search className="h-4 w-4" />
                 {tokenScan.isFetching ? "Searching…" : "Search creator"}
              </Button>
            </form>
            {inputError && (
              <p className="mt-2 text-xs text-red-600">{inputError}</p>
            )}
            {tokenScan.isError && (
              <p className="mt-2 text-xs text-red-600">
                The token scan failed.
              </p>
            )}
            {tokenScan.data && (
              <div className="mt-3 rounded-lg border border-emerald-600/20 bg-emerald-500/[.045] p-3 text-xs">
                <b>{tokenScan.data.tokenName || "Unnamed token"}</b>{" "}
                <CopyMint
                  mint={tokenScan.data.tokenAddress}
                  onCopied={copied}
                />
                {creatorWallet ? (
                  <p className="mt-2 border-t border-emerald-900/10 pt-2 font-mono">
                    Creator {creatorWallet}
                  </p>
                ) : (
                  <p className="mt-2 border-t border-emerald-900/10 pt-2 text-muted-foreground">
                    The scanner could not identify a creator wallet.
                  </p>
                )}
                <Link
                  href={`/scan?q=${encodeURIComponent(tokenMint)}`}
                  className="mt-2 inline-flex items-center gap-1 font-bold text-emerald-700"
                >
                  Full scan <ArrowUpRight className="h-3 w-3" />
                </Link>
              </div>
            )}
          </section>
          <section className="mt-7 overflow-hidden rounded-2xl border border-emerald-900/10 bg-card/70 shadow-[0_20px_50px_hsl(156_35%_16%/.06)]">
            <div className="border-b border-border/70 p-3 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-extrabold">
                      Creator leaderboard
                    </p>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {visible.length} shown
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Observed data refreshes every 4.5 seconds. Missing metrics
                    are not interpreted as zero.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className="flex rounded-lg border border-border/60 bg-muted p-1"
                    role="tablist"
                  >
                    <button
                      onClick={() => setTab("leaderboard")}
                      role="tab"
                      aria-selected={tab === "leaderboard"}
                      className={`rounded px-3 py-1.5 text-[11px] font-bold ${tab === "leaderboard" ? "bg-emerald-700 text-emerald-50" : "text-muted-foreground"}`}
                    >
                      Leaderboard
                    </button>
                    <button
                      onClick={() => setTab("favorites")}
                      role="tab"
                      aria-selected={tab === "favorites"}
                      className={`rounded px-3 py-1.5 text-[11px] font-bold ${tab === "favorites" ? "bg-emerald-700 text-emerald-50" : "text-muted-foreground"}`}
                    >
                      Favorites{" "}
                      {favorites.length ? `· ${favorites.length}` : ""}
                    </button>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => q.refetch()}
                    disabled={q.isFetching}
                    className="h-8 gap-1.5 text-xs"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${q.isFetching ? "animate-spin" : ""}`}
                    />
                    Refresh
                  </Button>
                </div>
              </div>
              <div className="mt-3 flex max-w-full gap-1 overflow-x-auto pb-1">
                {sortOptions.map((o) => (
                  <button
                    key={o.value}
                    onClick={() => setRanking(o.value)}
                    title={o.caption}
                    className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-[10px] font-bold transition-colors ${sort === o.value ? "bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-300" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                  >
                    {o.label}
                    {sort === o.value &&
                      (direction === "desc" ? (
                        <ArrowDown className="ml-1 inline h-3 w-3" />
                      ) : (
                        <ArrowUp className="ml-1 inline h-3 w-3" />
                      ))}
                  </button>
                ))}
              </div>
              <p className="mt-2 rounded bg-muted/60 px-3 py-2 text-[11px] text-muted-foreground">
                <span className="font-bold text-emerald-700">
                  {sortLabel}{" "}
                  {direction === "desc" ? "descending" : "ascending"}.
                </span>{" "}
                Best observed token is the token with the highest market cap
                captured during PAIF’s observation window. Graduation rate uses
                only launches with observed outcomes; uncovered history is excluded,
                not counted as zero. Current MCap totals fresh USD observations across
                that creator's tracked tokens. These are observations, not
                safety or performance predictions.
              </p>
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <div className="min-w-[1260px]">
                <div className="grid grid-cols-[28px_minmax(140px,1.1fr)_minmax(145px,1fr)_60px_60px_60px_100px_105px_105px_105px_105px_28px_72px] gap-2 border-b border-border/70 bg-muted/35 px-4 py-2 text-[9px] font-bold uppercase tracking-[.1em] text-muted-foreground">
                  <span>#</span>
                  <span>Creator wallet</span>
                  <span>Best observed / latest</span>
                  {headers.slice(1).map((h) => (
                    <button
                      key={h.value}
                      onClick={() => setRanking(h.value)}
                      className={sort === h.value ? "text-emerald-600" : ""}
                    >
                      {h.label}{" "}
                      {sort === h.value
                        ? direction === "desc"
                          ? "↓"
                          : "↑"
                        : ""}
                    </button>
                  ))}
                  <span />
                  <span>History</span>
                </div>
                {q.isLoading && (
                  <div className="space-y-1 p-3">
                    {[1, 2, 3, 4].map((n) => (
                      <Skeleton key={n} className="h-12 w-full" />
                    ))}
                  </div>
                )}
                {q.isError && (
                  <div className="p-12 text-center">
                    <AlertTriangle className="mx-auto h-7 w-7 text-red-500" />
                    <p className="mt-2 text-sm font-bold">
                      The creator feed could not load.
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => q.refetch()}
                      className="mt-4"
                    >
                      Try again
                    </Button>
                  </div>
                )}
                {!q.isLoading &&
                  !q.isError &&
                  visible.map((c, i) => (
                    <CreatorRow
                      key={c.wallet}
                      creator={c}
                      rank={i + 1}
                      open={open.has(c.wallet)}
                      toggle={() => toggleOpen(c.wallet)}
                      favorite={favorites.includes(c.wallet)}
                      onFavorite={() => toggleFavorite(c.wallet)}
                      onCopied={copied}
                    />
                  ))}
              </div>
            </div>
            <div className="sm:hidden">
              {q.isLoading && (
                <div className="space-y-2 p-3">
                  {[1, 2, 3].map((n) => (
                    <Skeleton key={n} className="h-28 w-full" />
                  ))}
                </div>
              )}
              {q.isError && (
                <div className="p-10 text-center text-sm">
                  Feed unavailable{" "}
                  <Button
                    variant="outline"
                    onClick={() => q.refetch()}
                    className="mt-3"
                  >
                    Try again
                  </Button>
                </div>
              )}
              {!q.isLoading &&
                !q.isError &&
                visible.map((c, i) => (
                  <CreatorRow
                    key={c.wallet}
                    creator={c}
                    rank={i + 1}
                    open={open.has(c.wallet)}
                    toggle={() => toggleOpen(c.wallet)}
                    favorite={favorites.includes(c.wallet)}
                    onFavorite={() => toggleFavorite(c.wallet)}
                    onCopied={copied}
                  />
                ))}
            </div>
            {!q.isLoading && !q.isError && visible.length === 0 && (
              <div className="p-14 text-center">
                <Sparkles className="mx-auto h-7 w-7 text-emerald-600/60" />
                <p className="mt-3 text-sm font-bold">
                  {tab === "favorites"
                    ? "No favorite creators yet."
                    : "No creator history has been observed yet."}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Star a creator to keep its wallet close.
                </p>
              </div>
            )}
          </section>
          <div className="mt-4 flex items-start gap-2 px-1 text-[10px] leading-relaxed text-muted-foreground">
            <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
            PAIF records observed activity only; sparse or partial history
            cannot establish a creator’s safety or intent.
          </div>
        </div>
      </main>
      {toast && (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full border border-emerald-500/30 bg-card px-3 py-2 text-xs font-bold text-emerald-700 shadow-lg"
        >
          {toast}
        </div>
      )}
      <Footer />
    </div>
  );
}
