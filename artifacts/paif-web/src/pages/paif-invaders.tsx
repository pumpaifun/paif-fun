import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Bell,
  Check,
  Database,
  Gem,
  HelpCircle,
  ExternalLink,
  Loader2,
  LockKeyhole,
  RefreshCw,
  Sparkles,
  Star,
  Ticket,
  Trophy,
  WalletCards,
} from "lucide-react";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { LoginModal } from "@/components/login-modal";
import { useAuth } from "@/hooks/use-auth";
import { AlphaSecondOpinion } from "@/components/alpha-second-opinion";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  getPaperExitRead,
  hasFreshPaperExitEvidence,
  type PaperExitStatus,
  type PaperPosition,
} from "@/lib/paper-exit";

interface TrendingToken {
  mint: string;
  symbol: string;
  name: string;
  price: string | number;
  marketDataAt?: string | null;
  change5m: number | null;
  change1h: number | null;
  change24h?: number | null;
  volume1h: number | null;
  volume24h: number | null;
  txns1h: number | null;
  liquidity: number | null;
  mcap: number | null;
  ageMins: number | null;
}

interface ColumnToken extends TrendingToken {
  lane: number;
  tone: string;
}

interface ColumnRead {
  positive: boolean;
  confidence: number;
  explanation: string;
  evidence: string[];
}
interface AlphaLanePick {
  pick: { mint: string; symbol: string; lane: number; score: number };
  recommendation: "ring" | "watch" | "avoid";
  confidence: number;
  agreesWithUser: boolean | null;
  headline: string;
  summary: string;
  evidence: string[];
  concerns: string[];
  generatedAt: string;
  advisoryOnly: true;
  reviewKind: "lineup-safety-ranking";
}
interface AccessPassStatus {
  trialStartedAt: string | null;
  passExpiresAt: string | null;
  active: boolean;
  trialActive: boolean;
  paidActive: boolean;
}

function isTrendingToken(value: unknown): value is TrendingToken {
  if (!value || typeof value !== "object") return false;
  const token = value as Partial<TrendingToken>;
  return typeof token.mint === "string" && typeof token.symbol === "string" && typeof token.name === "string";
}

function readFavoriteSnapshots() {
  try {
    const saved = JSON.parse(localStorage.getItem("paif.invaders.favoriteSnapshots") ?? "{}");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return new Map<string, TrendingToken>();
    return new Map(
      Object.entries(saved).flatMap(([mint, token]) => (
        isTrendingToken(token) ? [[mint, token] as [string, TrendingToken]] : []
      )),
    );
  } catch {
    return new Map<string, TrendingToken>();
  }
}

const COLUMN_COLORS = [
  "#b7f55f",
  "#ffd15b",
  "#62dbff",
  "#ff9bda",
  "#9ab8ff",
  "#66e0d0",
  "#ff9f89",
  "#ff806b",
  "#d688ff",
  "#8db5c7",
];
const HOME_CHART_GREEN = "#50d890";
const HOME_CHART_GREEN_BAR = "#61dfa0";
const HOME_CHART_RED = "#ef6262";
const ROUND_AMOUNTS = [10, 25, 50, 100];
const PAPER_TRIAL_DURATION_MS = 3 * 24 * 60 * 60 * 1_000;
const PAPER_TRIAL_STORAGE_KEY = "paif.invaders.paperTrialStartedAt";
const PAPER_POSITIONS_STORAGE_KEY = "paif.invaders.paperPositions";
const PAPER_AUTO_EXIT_STORAGE_KEY = "paif.invaders.paperAutoExitMints";
const PAPER_RESULTS_STORAGE_KEY = "paif.invaders.paperResults";

interface PaperResults {
  wins: number;
  closed: number;
  realizedProfitLoss: number;
}

function readPaperResults(): PaperResults {
  try {
    const saved = JSON.parse(localStorage.getItem(PAPER_RESULTS_STORAGE_KEY) ?? "{}") as Partial<PaperResults>;
    const wins = Math.max(0, Math.floor(Number(saved.wins) || 0));
    const closed = Math.max(wins, Math.floor(Number(saved.closed) || 0));
    const realizedProfitLoss = Number.isFinite(Number(saved.realizedProfitLoss))
      ? Number(saved.realizedProfitLoss)
      : 0;
    return { wins, closed, realizedProfitLoss };
  } catch {
    return { wins: 0, closed: 0, realizedProfitLoss: 0 };
  }
}

function readPaperAutoExitMints(): Set<string> {
  try {
    const saved = JSON.parse(localStorage.getItem(PAPER_AUTO_EXIT_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(saved)) return new Set<string>();
    return new Set(saved.filter((mint): mint is string => typeof mint === "string" && mint.length > 0));
  } catch {
    return new Set<string>();
  }
}

function readPaperPositions(): Record<string, PaperPosition> {
  try {
    const saved = JSON.parse(localStorage.getItem(PAPER_POSITIONS_STORAGE_KEY) ?? "{}");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    return Object.fromEntries(
      Object.entries(saved).flatMap(([mint, value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const position = value as Partial<PaperPosition>;
        return Number.isFinite(position.chipsInvested)
          && Number.isFinite(position.tokenUnits)
          && Number.isFinite(position.buyCount)
          && Number(position.chipsInvested) > 0
          && Number(position.tokenUnits) > 0
          && Number(position.buyCount) > 0
          ? [[mint, {
              chipsInvested: Number(position.chipsInvested),
              tokenUnits: Number(position.tokenUnits),
              buyCount: Number(position.buyCount),
            }]]
          : [];
      }),
    );
  } catch {
    return {};
  }
}

function asNumber(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatPrice(value: number | string) {
  const price = asNumber(value);
  if (price <= 0) return "—";
  if (price < 0.0001) return `$${price.toExponential(2)}`;
  if (price < 1) return `$${price.toPrecision(4)}`;
  return `$${price.toFixed(2)}`;
}

function compactMoney(value: number | null | undefined) {
  const amount = asNumber(value);
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return amount > 0 ? `$${Math.round(amount)}` : "—";
}

function compactTokenAmount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 10_000 ? 2 : 4,
  }).format(value);
}

function formatMove(value: number | string | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const move = Number(value);
  return `${move >= 0 ? "+" : ""}${move.toFixed(1)}%`;
}

function formatAge(ageMins: number | null | undefined) {
  const minutes = asNumber(ageMins);
  if (minutes <= 0) return "—";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1_440)}d`;
}

function getPaperMarkToMarket(token: ColumnToken, position: PaperPosition) {
  const currentPrice = asNumber(token.price);
  const currentValue = currentPrice > 0 ? position.tokenUnits * currentPrice : 0;
  const profitLoss = currentValue - position.chipsInvested;
  const profitLossPercent = position.chipsInvested > 0
    ? (profitLoss / position.chipsInvested) * 100
    : 0;

  return {
    currentPrice,
    currentValue,
    profitLoss,
    profitLossPercent,
    positive: profitLoss >= 0,
  };
}

function getColumnRead(token: TrendingToken): ColumnRead {
  const fiveMinute = asNumber(token.change5m);
  const hourly = asNumber(token.change1h);
  const hourlyVolume = asNumber(token.volume1h);
  const dailyVolume = asNumber(token.volume24h);
  const liquidity = asNumber(token.liquidity);
  const transactions = asNumber(token.txns1h);
  const hourlyPace = dailyVolume > 0 ? dailyVolume / 24 : 0;
  const activityAccelerating = hourlyPace > 0 && hourlyVolume >= hourlyPace * 1.25;
  const hasFiveMinute = token.change5m !== null && token.change5m !== undefined && Number.isFinite(Number(token.change5m));
  const shortTermStable = !hasFiveMinute || fiveMinute >= -1.5;
  const aligned = fiveMinute >= 0 && hourly > 0;
  const liquidEnough = liquidity >= 25_000;
  const activeEnough = transactions >= 20;
  const positive = hourly > 0 && hourly < 100 && shortTermStable;
  const confidence = Math.min(
    88,
    44 +
      (hourly > 0 ? 8 : 0) +
      (aligned ? 10 : 0) +
      (activityAccelerating ? 9 : 0) +
      (liquidEnough ? 8 : 0) +
      (activeEnough ? 5 : 0),
  );

  return {
    positive,
    confidence,
    explanation: positive
      ? "This lane has a positive hourly move with a stable or rising 5-minute read. It is a current read, not a promise."
      : "This lane's latest read is flat or falling. You can still choose it as a paper buy-the-dip idea, but red does not automatically mean cheap.",
    evidence: [
      `${formatMove(token.change1h)} over 1 hour`,
      `${formatMove(token.change5m)} over 5 minutes`,
      `${compactMoney(liquidity)} liquidity`,
    ],
  };
}
function TokenColumn({
  token,
  best,
  selected,
  rung,
  paperPosition,
  favorite,
  paperAmount,
  onFavorite,
  onRing,
}: {
  token: ColumnToken;
  best: boolean;
  selected: boolean;
  rung: boolean;
  paperPosition?: PaperPosition;
  favorite: boolean;
  paperAmount: number;
  onFavorite: () => void;
  onRing: () => void;
}) {
  const move = asNumber(token.change1h);
  const read = getColumnRead(token);
  const positiveHeight = Math.max(24, Math.min(150, Math.abs(move) * 4));
  const negativeHeight = Math.max(20, Math.min(82, Math.abs(move) * 2.5));
  const candleColor = read.positive ? HOME_CHART_GREEN_BAR : HOME_CHART_RED;
  const activePosition = Boolean(paperPosition);
  const markToMarket = paperPosition ? getPaperMarkToMarket(token, paperPosition) : null;
  const hasCurrentPrice = markToMarket !== null && markToMarket.currentPrice > 0;

  return (
    <article
      className={`relative flex min-w-0 flex-col rounded-[22px] border p-3 transition duration-300 ${
        activePosition
          ? "border-[#61dfa0] bg-[#10271c] shadow-[0_8px_0_#07100d,0_0_0_2px_rgba(97,223,160,.5),0_0_25px_rgba(80,216,144,.22)]"
          : selected
          ? "border-[#50d890] bg-[#14251f] shadow-[0_8px_0_#07100d,0_0_0_2px_rgba(80,216,144,.35)] -translate-y-1"
          : "border-[#2b4d40] bg-[#101d18] hover:border-[#50d890]/60"
      } ${rung ? "animate-[laneBump_.5s_ease-out]" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#a49382]">
          {String(token.lane).padStart(2, "0")}
        </p>
        <button
          type="button"
          onClick={onFavorite}
          aria-label={favorite ? `Remove ${token.symbol} from favorites` : `Add ${token.symbol} to favorites`}
          aria-pressed={favorite}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition sm:h-7 sm:w-7 ${
            favorite
              ? "border-[#ffd15b]/70 bg-[#ffd15b]/15 text-[#ffd15b]"
              : "border-[#315c4a] bg-[#0b1712] text-[#6f8e80] hover:border-[#ffd15b]/60 hover:text-[#ffd15b]"
          }`}
        >
          <Star size={13} fill={favorite ? "currentColor" : "none"} />
        </button>
      </div>

      <p className="mt-1 break-words font-mono text-base font-black leading-tight tracking-[-0.02em] text-white">{token.symbol}</p>
      <p className="mt-1 truncate text-xs font-semibold text-[#d6e8e0]">{token.name}</p>
      <div className="mt-2 flex min-h-5 flex-wrap items-center gap-1.5">
        {activePosition && (
          <span
            className="rounded-full border border-[#61dfa0] bg-[#50d890] px-2 py-1 font-mono text-[9px] font-black tracking-[0.1em] text-[#07130e] shadow-[0_0_12px_rgba(80,216,144,.55)]"
            aria-label={`Active Paper position in ${token.symbol}`}
          >
            ACTIVE
          </span>
        )}
        {rung ? (
          <span className="rounded-full bg-[#ffd15b] px-2 py-1 font-mono text-[9px] font-black tracking-[0.08em] text-[#21170b]">
            RUNG
          </span>
        ) : best && !activePosition ? (
          <span className="rounded-full bg-[#50d890] px-2 py-1 font-mono text-[9px] font-black tracking-[0.08em] text-[#10150c]">
            MOMENTUM
          </span>
        ) : null}
      </div>

      {paperPosition && markToMarket && (
        <div
          className="mt-2 space-y-1 rounded-xl border border-[#50d890]/30 bg-[#07130e]/80 px-2 py-2 font-mono"
          aria-label={`${token.symbol} Paper chips`}
        >
          <div className="flex items-center justify-between gap-1 text-[10px] sm:text-[9px]">
            <span className="text-[#b8cec4]">You put in</span>
            <strong className="truncate text-right text-[#f8f3df]">{paperPosition.chipsInvested.toFixed(1)} chips</strong>
          </div>
          <div className="flex items-center justify-between gap-1 text-[10px] sm:text-[9px]">
            <span className="text-[#b8cec4]">Worth now</span>
            <strong className="truncate text-right text-[#f8f3df]">
              {hasCurrentPrice ? `${markToMarket.currentValue.toFixed(1)} chips` : "Price updating"}
            </strong>
          </div>
          <div className="flex items-center justify-between gap-1 border-t border-[#28483b] pt-1 text-[10px] sm:text-[9px]">
            <span className="text-[#b8cec4]">
              {!hasCurrentPrice
                ? "Change"
                : markToMarket.profitLoss > 0
                  ? "You're up"
                  : markToMarket.profitLoss < 0
                    ? "You're down"
                    : "No change"}
            </span>
            <strong className={`truncate text-right ${
              !hasCurrentPrice
                ? "text-[#9cb8ac]"
                : markToMarket.profitLoss > 0
                  ? "text-[#61dfa0]"
                  : markToMarket.profitLoss < 0
                    ? "text-[#ef6262]"
                    : "text-[#f8f3df]"
            }`}>
              {hasCurrentPrice ? `${Math.abs(markToMarket.profitLoss).toFixed(1)} chips` : "Updating"}
            </strong>
          </div>
        </div>
      )}

      <div data-testid="lane-meter" className="relative mt-3 h-[160px] overflow-hidden rounded-[16px] border border-[#28483b] bg-[#09120f] sm:h-[320px]">
        <div className="absolute inset-x-0 top-[68%] border-t-2 border-dashed border-[#d4b566]/65" />
        <span className="absolute left-2 top-[calc(68%-18px)] font-mono text-[9px] uppercase tracking-[0.1em] text-[#a49382]">
          neutral
        </span>
        <div
          className={`absolute left-1/2 w-12 -translate-x-1/2 border border-black/20 transition-all duration-700 ${
            read.positive ? "bottom-[32%] rounded-t-xl" : "top-[68%] rounded-b-xl"
          }`}
          style={{
            height: `${((read.positive ? positiveHeight : negativeHeight) / 320) * 100}%`,
            background: candleColor,
            boxShadow: selected ? `0 0 24px ${candleColor}66` : undefined,
          }}
        >
          <span className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 sm:gap-2">
            <span className="flex gap-2">
              <span className="h-1 w-1 rounded-full bg-[#17120f] sm:h-1.5 sm:w-1.5" />
              <span className="h-1 w-1 rounded-full bg-[#17120f] sm:h-1.5 sm:w-1.5" />
            </span>
            <span className={`h-1 w-4 rounded-full ${read.positive ? "bg-[#17120f]" : "bg-[#711f1b]"}`} />
          </span>
        </div>
        <div className={`absolute right-2 z-20 flex items-center gap-1 rounded-full border px-2 py-1 font-mono text-[10px] font-bold backdrop-blur ${read.positive ? "top-3 border-[#50d890]/35 bg-[#07130e]/90 text-[#50d890]" : "bottom-3 border-[#ef6262]/35 bg-[#170b0b]/90 text-[#ef6262]"}`}>
          {read.positive ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
          {move >= 0 ? "+" : ""}{move.toFixed(1)}%
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 font-mono 2xl:grid-cols-4">
        <div>
          <p className="text-[9px] uppercase tracking-[0.1em] text-[#a49382]">Price</p>
          <p className="mt-1 truncate text-[11px] font-bold text-[#f8f3df]">{formatPrice(token.price)}</p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-[0.1em] text-[#a49382]">MCap</p>
          <p className="mt-1 truncate text-[11px] font-bold text-[#f8f3df]">{compactMoney(token.mcap)}</p>
        </div>
        <div className="text-right">
          <p className="text-[9px] uppercase tracking-[0.1em] text-[#a49382]">Read</p>
          <p className={`mt-1 text-[11px] font-bold ${read.positive ? "text-[#50d890]" : "text-[#ef6262]"}`}>
            {read.positive ? `${read.confidence}/100` : "DIP IDEA"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[9px] uppercase tracking-[0.1em] text-[#a49382]">Age</p>
          <p className="mt-1 truncate text-[11px] font-bold text-[#f8f3df]">{formatAge(token.ageMins)}</p>
        </div>
      </div>
      <a
        href={`https://dexscreener.com/solana/${token.mint}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 flex items-center justify-center gap-1.5 rounded-full border border-[#2b4d40] bg-[#0b1712] px-2 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-[#b8cec4] transition hover:border-[#50d890] hover:text-[#61dfa0]"
        aria-label={`Open live chart for ${token.symbol}`}
      >
        <BarChart3 size={12} /> Live chart <ExternalLink size={10} />
      </a>

      <div className="mt-auto flex flex-col items-center pt-4">
        <button
          type="button"
          onClick={onRing}
          aria-label={`Tap bell to add ${paperAmount}${paperPosition ? " more" : ""} Paper chips to ${token.symbol}`}
          data-testid={`ring-lane-${token.symbol}`}
          className={`flex h-14 w-14 items-center justify-center rounded-full border-2 font-mono text-[8px] font-black uppercase tracking-[0.08em] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f8f3df] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1c1917] ${
            selected
              ? "border-[#f8f3df] bg-[#61dfa0] text-[#07130e] shadow-[0_5px_0_#24734d,0_0_28px_rgba(80,216,144,.6)] hover:-translate-y-0.5 active:translate-y-1 active:shadow-none"
              : "border-[#50d890] bg-[#50d890] text-[#07130e] shadow-[0_5px_0_#24734d,0_0_18px_rgba(80,216,144,.35)] hover:-translate-y-0.5 hover:bg-[#61dfa0] hover:shadow-[0_5px_0_#24734d,0_0_28px_rgba(80,216,144,.6)] active:translate-y-1 active:shadow-none"
          }`}
        >
          <Bell size={19} />
        </button>
         <span className="mt-2 text-center font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[#61dfa0]">
           {rung
             ? `${paperAmount} chips added!`
             : paperPosition
               ? `Add ${paperAmount} more chips`
               : `Add ${paperAmount} chips`}
        </span>
      </div>
    </article>
  );
}

function PaperHoldings({
  holdings,
  onSell,
  autoExitMints,
  onAutoExitChange,
}: {
  holdings: Array<{ token: ColumnToken; position: PaperPosition }>;
  onSell: (token: ColumnToken) => void;
  autoExitMints: Set<string>;
  onAutoExitChange: (token: ColumnToken, enabled: boolean) => void;
}) {
  const [expandedSignals, setExpandedSignals] = useState<Set<string>>(() => new Set());
  const [expandedAutoExitHelp, setExpandedAutoExitHelp] = useState<Set<string>>(() => new Set());

  return (
    <section className="mt-2 rounded-2xl border-2 border-[#50d890]/45 bg-[#08140f] shadow-[0_8px_0_#050b08]" aria-labelledby="paper-holdings-title">
      <div className="flex flex-col gap-3 border-b border-[#294a3d] px-4 py-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p id="paper-holdings-title" className="font-mono text-[11px] font-black uppercase tracking-[0.16em] text-[#61dfa0]">
            Open Paper holdings
          </p>
          <p className="mt-1 text-xs text-[#b8cec4]">
            Live mark-to-market details. Stop any position now at the displayed price; no bot signal required.
          </p>
          <p className="mt-1 text-[10px] text-[#8fa99b]">
            Bot signals are informational, simulated, and not guaranteed.
          </p>
        </div>
        <span className="w-fit rounded-full border border-[#50d890]/35 bg-[#50d890]/10 px-2.5 py-1 font-mono text-[9px] font-black uppercase tracking-[0.12em] text-[#61dfa0]">
          {holdings.length} {holdings.length === 1 ? "position" : "positions"} open
        </span>
      </div>

      {holdings.length > 0 ? (
        <div>
          <div>
            <div className="hidden grid-cols-[1.2fr_1fr_.9fr_1fr_1fr_.9fr_1.35fr_152px] gap-3 border-b border-[#294a3d] px-4 py-2.5 font-mono text-[9px] font-black uppercase tracking-[0.1em] text-[#8fa99b] md:grid">
              <span>Token</span>
              <span>Quantity</span>
              <span>Invested</span>
              <span>Average entry</span>
              <span>Current value</span>
              <span>P / L</span>
              <span>Bot opinion</span>
              <span className="text-right">Immediate exit</span>
            </div>
            <div className="divide-y divide-[#203a30]">
              {holdings.map(({ token, position }) => {
                const markToMarket = getPaperMarkToMarket(token, position);
                const { currentPrice, currentValue, profitLoss, profitLossPercent, positive } = markToMarket;
                const averageEntry = position.chipsInvested / position.tokenUnits;
                const exitRead = getPaperExitRead(token, position);
                const signalStyle = exitRead.tone === "hold"
                  ? "border-[#50d890]/45 bg-[#50d890]/10 text-[#61dfa0]"
                  : exitRead.tone === "exit"
                    ? "border-[#ef6262]/60 bg-[#ef6262]/15 text-[#ff9b8d]"
                    : "border-[#ffd15b]/50 bg-[#ffd15b]/10 text-[#ffd15b]";

                return (
                    <div key={token.mint} className="grid grid-cols-1 gap-2 border-b border-[#203a30] px-4 py-4 transition last:border-b-0 hover:bg-[#10251b] md:grid-cols-[1.2fr_1fr_.9fr_1fr_1fr_.9fr_1.35fr_152px] md:items-center md:gap-3 md:border-b-0 md:py-3">
                    <div className="flex min-w-0 items-center justify-between gap-3 md:block">
                      <p className="truncate font-mono text-sm font-black text-[#f8f3df]">{token.symbol}</p>
                      <p className="truncate text-[10px] text-[#9cb8ac]">{token.name} · {position.buyCount} {position.buyCount === 1 ? "buy" : "buys"}</p>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 border-t border-[#203a30]/70 pt-2 md:block md:border-0 md:pt-0">
                      <span className="font-mono text-[9px] font-black uppercase tracking-[0.1em] text-[#8fa99b] md:hidden">Quantity</span>
                      <p className="font-mono text-xs font-black text-[#f8f3df]">{compactTokenAmount(position.tokenUnits)}</p>
                      <p className="mt-0.5 text-[9px] uppercase tracking-[0.08em] text-[#809b8d]">tokens</p>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 border-t border-[#203a30]/70 pt-2 md:block md:border-0 md:pt-0">
                      <span className="font-mono text-[9px] font-black uppercase tracking-[0.1em] text-[#8fa99b] md:hidden">Invested</span>
                      <p className="font-mono text-xs font-black text-[#f8f3df]">{position.chipsInvested.toFixed(1)}</p>
                      <p className="mt-0.5 text-[9px] uppercase tracking-[0.08em] text-[#809b8d]">chips</p>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 border-t border-[#203a30]/70 pt-2 md:block md:border-0 md:pt-0">
                      <span className="font-mono text-[9px] font-black uppercase tracking-[0.1em] text-[#8fa99b] md:hidden">Average entry</span>
                      <p className="font-mono text-xs font-black text-[#f8f3df]">{formatPrice(averageEntry)}</p>
                      <p className="mt-0.5 text-[9px] uppercase tracking-[0.08em] text-[#809b8d]">per token</p>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 border-t border-[#203a30]/70 pt-2 md:block md:border-0 md:pt-0">
                      <span className="font-mono text-[9px] font-black uppercase tracking-[0.1em] text-[#8fa99b] md:hidden">Current value</span>
                      <p className="font-mono text-xs font-black text-[#f8f3df]">{currentValue.toFixed(1)}</p>
                      <p className="mt-0.5 font-mono text-[9px] text-[#809b8d]">@ {formatPrice(currentPrice)}</p>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 border-t border-[#203a30]/70 pt-2 md:block md:border-0 md:pt-0">
                      <span className="font-mono text-[9px] font-black uppercase tracking-[0.1em] text-[#8fa99b] md:hidden">P / L</span>
                      <p className={`font-mono text-xs font-black ${positive ? "text-[#61dfa0]" : "text-[#ef6262]"}`}>
                        {positive ? "+" : ""}{profitLoss.toFixed(1)} chips
                      </p>
                      <p className={`mt-0.5 font-mono text-[10px] font-black ${positive ? "text-[#61dfa0]" : "text-[#ef6262]"}`}>
                        {positive ? "+" : ""}{profitLossPercent.toFixed(1)}%
                      </p>
                    </div>
                    <div className="border-t border-[#203a30]/70 pt-2 md:border-0 md:pt-0">
                      <span className="font-mono text-[9px] font-black uppercase tracking-[0.1em] text-[#8fa99b] md:hidden">Bot opinion</span>
                       <span className="group relative inline-flex">
                         <button
                           type="button"
                           title={exitRead.explanation}
                           aria-label={`${exitRead.status} for ${token.symbol}. Activate to ${expandedSignals.has(token.mint) ? "hide" : "show"} explanation.`}
                           aria-expanded={expandedSignals.has(token.mint)}
                           onClick={() => setExpandedSignals((current) => {
                             const next = new Set(current);
                             if (next.has(token.mint)) next.delete(token.mint);
                             else next.add(token.mint);
                             return next;
                           })}
                           className={`mt-1 inline-flex rounded-full border px-2.5 py-1.5 font-mono text-[11px] font-black uppercase tracking-[0.08em] transition hover:brightness-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f8f3df] md:mt-0 ${signalStyle}`}
                         >
                           {exitRead.status}
                         </button>
                         <span
                           role="tooltip"
                           className="pointer-events-none absolute bottom-[calc(100%+8px)] left-0 z-30 hidden w-56 rounded-lg border border-[#315c4a] bg-[#07130e] p-2 text-[10px] font-normal normal-case leading-4 text-[#d6e8e0] shadow-[0_8px_20px_rgba(0,0,0,.35)] group-hover:block group-focus-within:block"
                         >
                           {exitRead.explanation}
                         </span>
                       </span>
                       {expandedSignals.has(token.mint) && (
                         <p className="mt-1 text-[10px] leading-4 text-[#b8cec4]">{exitRead.explanation}</p>
                       )}
                       <div className="mt-2 flex items-start gap-2 text-[9px] leading-3.5 text-[#9cb8ac]">
                         <button
                           type="button"
                           role="switch"
                           aria-checked={autoExitMints.has(token.mint)}
                           aria-label={`${token.symbol} Auto-exit ${autoExitMints.has(token.mint) ? "ON" : "OFF"}`}
                           onClick={() => onAutoExitChange(token, !autoExitMints.has(token.mint))}
                           className={`relative mt-0.5 inline-flex h-6 min-w-[4.75rem] shrink-0 items-center justify-center rounded-full border p-0.5 font-mono text-[9px] font-black uppercase tracking-[0.05em] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f8f3df] ${
                             autoExitMints.has(token.mint)
                               ? "border-[#61dfa0] bg-[#50d890] text-[#07130e]"
                               : "border-[#416252] bg-[#102019] text-[#9cb8ac]"
                           }`}
                         >
                           <span>
                             {autoExitMints.has(token.mint) ? "ON" : "OFF"}
                           </span>
                           <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-[#f8f3df] shadow-sm transition-transform ${autoExitMints.has(token.mint) ? "right-0.5" : "left-0.5"}`} />
                         </button>
                         <span className="min-w-0">
                           <span className="flex items-center gap-1.5 font-mono font-black uppercase tracking-[0.06em] text-[#d6e8e0]">
                             Auto-exit {autoExitMints.has(token.mint) ? "ON" : "OFF"}
                             <span className="group/help relative inline-flex">
                               <button
                                 type="button"
                                 aria-label={`Explain Auto-exit for ${token.symbol}`}
                                 aria-expanded={expandedAutoExitHelp.has(token.mint)}
                                 onClick={() => setExpandedAutoExitHelp((current) => {
                                   const next = new Set(current);
                                   if (next.has(token.mint)) next.delete(token.mint);
                                   else next.add(token.mint);
                                   return next;
                                 })}
                                 className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[#416252] text-[#9cb8ac] transition hover:border-[#61dfa0] hover:text-[#61dfa0] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f8f3df]"
                               >
                                 <HelpCircle size={11} />
                               </button>
                               <span
                                 role="tooltip"
                                 className="pointer-events-none absolute bottom-[calc(100%+7px)] left-1/2 z-30 hidden w-56 -translate-x-1/2 rounded-lg border border-[#315c4a] bg-[#07130e] p-2 font-sans text-[10px] font-normal normal-case leading-4 tracking-normal text-[#d6e8e0] shadow-[0_8px_20px_rgba(0,0,0,.35)] group-hover/help:block group-focus-within/help:block"
                               >
                                 When on, the bot may close this simulated Paper position only after a fresh Exit signal. Turn it off to keep every exit manual.
                               </span>
                             </span>
                           </span>
                           {expandedAutoExitHelp.has(token.mint) && (
                             <span className="mt-1 block text-[10px] leading-4 text-[#b8cec4]">
                               When on, the bot may close this simulated Paper position only after a fresh Exit signal. Turn it off to keep every exit manual.
                             </span>
                           )}
                         </span>
                       </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onSell(token)}
                      className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-[#ef6262]/80 bg-[#ef6262]/15 px-2.5 py-3 font-mono text-[10px] font-black uppercase tracking-[0.07em] text-[#ffb0a3] transition hover:border-[#ff8b7c] hover:bg-[#ef6262]/30 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ffd15b] active:translate-y-px md:mt-0 md:px-2.5 md:py-2.5"
                      aria-label={`Stop and exit ${token.symbol} now at the displayed price`}
                    >
                      <span className="h-2 w-2 rounded-sm bg-[#ef6262]" />
                      Stop / exit now
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="px-4 py-5 text-xs text-[#9cb8ac]">
          No open Paper holdings. Ring a lane to start tracking a simulated position here.
        </div>
      )}
    </section>
  );
}

function FavoriteTokenCard({ token, onRemove }: { token: TrendingToken; onRemove: () => void }) {
  const move = asNumber(token.change1h);
  const read = getColumnRead(token);

  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-[#294a3d] bg-[#102019] p-3">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${read.positive ? "bg-[#50d890]/15 text-[#50d890]" : "bg-[#ef6262]/15 text-[#ef6262]"}`}>
        {read.positive ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[11px] font-black text-[#f8f3df]">{token.symbol}</p>
        <p className="truncate text-[9px] text-[#9c8e80]">{token.name}</p>
        <p className={`mt-1 font-mono text-[9px] font-bold ${read.positive ? "text-[#50d890]" : "text-[#ef6262]"}`}>
          {formatMove(move)} · {compactMoney(token.mcap)}
        </p>
      </div>
      <a
        href={`https://dexscreener.com/solana/${token.mint}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open live chart for favorite ${token.symbol}`}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#315c4a] bg-[#0b1712] text-[#9cb8ac] transition hover:border-[#50d890] hover:text-[#61dfa0]"
      >
        <ExternalLink size={13} />
      </a>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${token.symbol} from favorites`}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#ffd15b]/40 bg-[#ffd15b]/10 text-[#ffd15b] transition hover:border-[#ef6262] hover:text-[#ef6262]"
      >
        <Star size={13} fill="currentColor" />
      </button>
    </div>
  );
}

export default function PaifInvadersPage() {
  const { isAuthenticated: isEmailAuth } = useAuth();
  const { publicKey, connected } = useWallet();
  const { toast } = useToast();
  const wallet = connected ? publicKey?.toBase58() ?? null : null;
  const [gameMode, setGameMode] = useState<"paper" | "live">("paper");
  const [selectedMint, setSelectedMint] = useState("");
  const [lastRungMint, setLastRungMint] = useState("");
  const [round, setRound] = useState(1);
  const [streak, setStreak] = useState(0);
  const [tickets, setTickets] = useState(0);
  const [gems, setGems] = useState(0);
  const [paperResults, setPaperResults] = useState<PaperResults>(readPaperResults);
  const [openStatHelp, setOpenStatHelp] = useState<string | null>(null);
  const [paperAmount, setPaperAmount] = useState(25);
  const [paperPositions, setPaperPositions] = useState<Record<string, PaperPosition>>(readPaperPositions);
  const [autoExitMints, setAutoExitMints] = useState<Set<string>>(readPaperAutoExitMints);
  const [connectOpen, setConnectOpen] = useState(false);
  const [paperTrialStartedAt, setPaperTrialStartedAt] = useState<number | null>(() => {
    try {
      const stored = Number(localStorage.getItem(PAPER_TRIAL_STORAGE_KEY));
      return Number.isFinite(stored) && stored > 0 ? stored : null;
    } catch {
      return null;
    }
  });
  const [favoriteMints, setFavoriteMints] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("paif.invaders.favorites") ?? "[]");
      return Array.isArray(saved) ? saved.filter((mint): mint is string => typeof mint === "string") : [];
    } catch {
      return [];
    }
  });
  const laneOrderRef = useRef<string[]>([]);
  const favoriteSnapshotsRef = useRef(readFavoriteSnapshots());
  const priorPaperExitStatusesRef = useRef(new Map<string, PaperExitStatus>());
  const autoClosedMintsRef = useRef(new Set<string>());
  const [score, setScore] = useState(() => {
    try {
      return Math.max(0, Number(localStorage.getItem("paif.invaders.score")) || 0);
    } catch {
      return 0;
    }
  });

  useEffect(() => {
    document.title = "Ring Bell to Rise | PAIF.fun";
  }, []);

  const tokenQuery = useQuery<TrendingToken[]>({
    queryKey: ["/api/trending-tokens"],
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
  const accessQuery = useQuery<AccessPassStatus>({
    queryKey: ["/api/access-pass", wallet],
    enabled: !!wallet,
  });
  const accountAccessQuery = useQuery<AccessPassStatus>({
    queryKey: ["/api/access-pass-account"],
    enabled: isEmailAuth,
  });
  const accessStatus = accountAccessQuery.data?.active ? accountAccessQuery.data : accessQuery.data;
  const browserTrialActive = paperTrialStartedAt !== null
    && paperTrialStartedAt + PAPER_TRIAL_DURATION_MS > Date.now();
  const signedInAccessActive = !!accessStatus?.active && (!!wallet || isEmailAuth);
  const paperAccessActive = browserTrialActive || signedInAccessActive;
  const paperTrialExpired = paperTrialStartedAt !== null && !browserTrialActive;

  useEffect(() => {
    for (const token of tokenQuery.data ?? []) {
      favoriteSnapshotsRef.current.set(token.mint, token);
    }
    const snapshots: Record<string, TrendingToken> = {};
    for (const mint of new Set([...favoriteMints, ...Object.keys(paperPositions)])) {
      const token = favoriteSnapshotsRef.current.get(mint);
      if (token) snapshots[mint] = token;
    }
    try {
      localStorage.setItem("paif.invaders.favoriteSnapshots", JSON.stringify(snapshots));
    } catch {
      // Favorites remain usable for this session when storage is unavailable.
    }
  }, [favoriteMints, paperPositions, tokenQuery.data]);

  const columnTokens = useMemo<ColumnToken[]>(() => {
    const currentTokens = tokenQuery.data ?? [];
    const currentMints = new Set(currentTokens.map((token) => token.mint));
    const retainedFavorites = favoriteMints
      .map((mint) => favoriteSnapshotsRef.current.get(mint))
      .filter((token): token is TrendingToken => !!token && !currentMints.has(token.mint));
    const retainedPositions = Object.keys(paperPositions)
      .map((mint) => favoriteSnapshotsRef.current.get(mint))
      .filter((token): token is TrendingToken => !!token && !currentMints.has(token.mint));
    const retainedSelection = selectedMint && !currentMints.has(selectedMint)
      ? favoriteSnapshotsRef.current.get(selectedMint)
      : undefined;
    const sourceTokens = [
      ...currentTokens,
      ...retainedFavorites,
      ...retainedPositions,
      ...(retainedSelection ? [retainedSelection] : []),
    ];
    const byMint = new Map(sourceTokens.map((token) => [token.mint, token]));
    const sourceMints = sourceTokens.map((token) => token.mint);
    const priorOrder = laneOrderRef.current;
    const seen = new Set<string>();
    laneOrderRef.current = [
      ...Object.keys(paperPositions),
      ...favoriteMints,
      ...priorOrder,
      ...sourceMints,
    ].filter((mint) => {
      if (!byMint.has(mint) || seen.has(mint)) return false;
      seen.add(mint);
      return true;
    });
    const visibleMints = laneOrderRef.current.slice(0, 8);
    if (selectedMint && byMint.has(selectedMint) && !visibleMints.includes(selectedMint)) {
      visibleMints[visibleMints.length === 8 ? 7 : visibleMints.length] = selectedMint;
    }
    return visibleMints.flatMap((mint, index) => {
      const token = byMint.get(mint);
      return token
        ? [{
            ...token,
            lane: index + 1,
            tone: COLUMN_COLORS[index % COLUMN_COLORS.length],
          }]
        : [];
    });
  }, [favoriteMints, paperPositions, selectedMint, tokenQuery.data]);

  const favoriteTokens = useMemo(() => {
    const currentByMint = new Map((tokenQuery.data ?? []).map((token) => [token.mint, token]));
    return favoriteMints.flatMap((mint) => {
      const token = currentByMint.get(mint) ?? favoriteSnapshotsRef.current.get(mint);
      return token ? [token] : [];
    });
  }, [favoriteMints, tokenQuery.data]);

  const paperHoldings = useMemo(
    () => columnTokens.flatMap((token) => {
      const position = paperPositions[token.mint];
      return position ? [{ token, position }] : [];
    }),
    [columnTokens, paperPositions],
  );

  function persistAutoExitMints(next: Set<string>) {
    try {
      localStorage.setItem(PAPER_AUTO_EXIT_STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      // The preference remains active for this browser session.
    }
  }

  function setAutoExit(token: ColumnToken, enabled: boolean) {
    setAutoExitMints((current) => {
      const next = new Set(current);
      if (enabled) next.add(token.mint);
      else next.delete(token.mint);
      persistAutoExitMints(next);
      return next;
    });
  }

  useEffect(() => {
    const openMints = new Set(paperHoldings.map(({ token }) => token.mint));
    for (const mint of priorPaperExitStatusesRef.current.keys()) {
      if (!openMints.has(mint)) priorPaperExitStatusesRef.current.delete(mint);
    }

    const now = Date.now();
    for (const { token, position } of paperHoldings) {
      if (!hasFreshPaperExitEvidence(token, position, now)) continue;

      const nextStatus = getPaperExitRead(token, position, now).status;
      const priorStatus = priorPaperExitStatusesRef.current.get(token.mint);
      if (priorStatus && priorStatus !== "Exit signal" && nextStatus === "Exit signal") {
        toast({
          title: `Exit signal changed · ${token.symbol}`,
          description: "This fresh bot signal is informational and not guaranteed. Stop / exit now remains your manual choice in Open Paper holdings.",
          variant: "destructive",
        });
      }
      priorPaperExitStatusesRef.current.set(token.mint, nextStatus);
    }
  }, [paperHoldings, toast]);

  useEffect(() => {
    const now = Date.now();
    for (const { token, position } of paperHoldings) {
      if (!autoExitMints.has(token.mint) || autoClosedMintsRef.current.has(token.mint)) continue;
      if (!hasFreshPaperExitEvidence(token, position, now)) continue;
      if (getPaperExitRead(token, position, now).status !== "Exit signal") continue;
      autoClosedMintsRef.current.add(token.mint);
      sellPaperPosition(token, true);
    }
  }, [autoExitMints, paperHoldings]);

  const bestPositive = useMemo(() => {
    return columnTokens
      .filter((token) => getColumnRead(token).positive)
      .sort((left, right) => getColumnRead(right).confidence - getColumnRead(left).confidence)[0];
  }, [columnTokens]);
  const bestPositiveMints = useMemo(() => {
    if (!bestPositive) return new Set<string>();
    const highestConfidence = getColumnRead(bestPositive).confidence;
    return new Set(
      columnTokens
        .filter((token) => {
          const read = getColumnRead(token);
          return read.positive && read.confidence >= highestConfidence - 5;
        })
        .map((token) => token.mint),
    );
  }, [bestPositive, columnTokens]);

  useEffect(() => {
    if (!selectedMint && bestPositive) setSelectedMint(bestPositive.mint);
    if (selectedMint && !columnTokens.some((token) => token.mint === selectedMint) && bestPositive) {
      setSelectedMint(bestPositive.mint);
    }
  }, [bestPositive, columnTokens, selectedMint]);

  const selected = columnTokens.find((token) => token.mint === selectedMint) ?? bestPositive;
  const selectedRead = selected ? getColumnRead(selected) : null;
  const alphaLaneCandidates = useMemo(() => columnTokens.map((token) => ({
    mint: token.mint,
    symbol: token.symbol,
    lane: token.lane,
    marketDataAt: token.marketDataAt ? new Date(token.marketDataAt).getTime() : undefined,
    change5m: token.change5m ?? undefined,
    change1h: token.change1h ?? undefined,
    change24h: token.change24h ?? undefined,
    liquidityUsd: token.liquidity ?? undefined,
    marketCapUsd: token.mcap ?? undefined,
    volume24h: token.volume24h ?? undefined,
    ageMins: token.ageMins ?? undefined,
  })), [columnTokens]);
  const alphaLanePick = useQuery<AlphaLanePick>({
    queryKey: ["alpha-lane-pick", selectedMint || "none", alphaLaneCandidates],
    queryFn: async () => {
      const response = await apiRequest("POST", "/api/paif-alpha/lane-pick", {
        selectedMint: selectedMint || undefined,
        candidates: alphaLaneCandidates,
      });
      return response.json();
    },
    enabled: alphaLaneCandidates.length > 0,
    staleTime: 30_000,
  });

  function toggleFavorite(mint: string) {
    setFavoriteMints((current) => {
      const next = current.includes(mint) ? current.filter((item) => item !== mint) : [...current, mint];
      const snapshots: Record<string, TrendingToken> = {};
      for (const favoriteMint of next) {
        const token = favoriteSnapshotsRef.current.get(favoriteMint);
        if (token) snapshots[favoriteMint] = token;
      }
      try {
        localStorage.setItem("paif.invaders.favorites", JSON.stringify(next));
        localStorage.setItem("paif.invaders.favoriteSnapshots", JSON.stringify(snapshots));
      } catch {
        // Favorites remain usable for this session when storage is unavailable.
      }
      return next;
    });
  }

  function ringLane(token: ColumnToken) {
    if (gameMode === "live") {
      toast({
        title: "Live mode is not active yet",
        description: "Funded rounds stay locked until the trading and recovery safety rules are approved.",
      });
      return;
    }
    if (paperTrialStartedAt === null && !signedInAccessActive) {
      const startedAt = Date.now();
      setPaperTrialStartedAt(startedAt);
      try {
        localStorage.setItem(PAPER_TRIAL_STORAGE_KEY, String(startedAt));
      } catch {
        // The trial remains active for this browser session when storage is unavailable.
      }
      toast({
        title: "Your free 3-day Paper trial has started",
        description: "No wallet is needed. Paper chips have no cash value.",
      });
    } else if (!paperAccessActive) {
      toast({
        title: "Your free Paper trial has ended",
        description: "Connect a wallet and choose an Access Pass to keep playing.",
        variant: "destructive",
      });
      return;
    }
    const read = getColumnRead(token);
    const currentPrice = asNumber(token.price);
    if (currentPrice <= 0) {
      toast({
        title: "Price unavailable",
        description: "This Paper buy pauses until a valid live price returns.",
        variant: "destructive",
      });
      return;
    }
    const points = (read.positive ? Math.max(20, Math.round(read.confidence / 2)) : 20) + Math.round(paperAmount / 10);
    const nextScore = score + points;
    setSelectedMint(token.mint);
    setLastRungMint(token.mint);
    setRound((current) => current + 1);
    setStreak((current) => current + 1);
    setTickets((current) => current + 1);
    setGems((current) => current + 12);
    setScore(nextScore);
    setPaperPositions((current) => {
      const next = {
        ...current,
        [token.mint]: {
          chipsInvested: (current[token.mint]?.chipsInvested ?? 0) + paperAmount,
          tokenUnits: (current[token.mint]?.tokenUnits ?? 0) + (paperAmount / currentPrice),
          buyCount: (current[token.mint]?.buyCount ?? 0) + 1,
        },
      };
      try {
        localStorage.setItem(PAPER_POSITIONS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Paper positions remain usable for this browser session.
      }
      return next;
    });
    try {
      localStorage.setItem("paif.invaders.score", String(nextScore));
    } catch {
      // Paper progress remains usable for this session when storage is unavailable.
    }
    toast({
      title: `${paperAmount} Paper chips added to ${token.symbol}`,
      description: paperPositions[token.mint]
        ? "Your average buy-in and live profit/loss were updated."
        : "Your Paper position is now tracking live profit or loss.",
    });
  }

  function sellPaperPosition(token: ColumnToken, automatic = false) {
    const position = paperPositions[token.mint];
    const currentPrice = asNumber(token.price);
    if (!position || currentPrice <= 0) {
      toast({
        title: "Position cannot be closed",
        description: "A current displayed price is required before selling Paper chips.",
        variant: "destructive",
      });
      return;
    }
    const proceeds = position.tokenUnits * currentPrice;
    const realizedProfitLoss = proceeds - position.chipsInvested;
    setPaperResults((current) => {
      const next = {
        wins: current.wins + (realizedProfitLoss > 0 ? 1 : 0),
        closed: current.closed + 1,
        realizedProfitLoss: current.realizedProfitLoss + realizedProfitLoss,
      };
      try {
        localStorage.setItem(PAPER_RESULTS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Win rate remains accurate for this browser session when storage is unavailable.
      }
      return next;
    });
    setPaperPositions((current) => {
      const next = { ...current };
      delete next[token.mint];
      try {
        localStorage.setItem(PAPER_POSITIONS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // The closed position remains closed for this browser session.
      }
      return next;
    });
    autoClosedMintsRef.current.delete(token.mint);
    setAutoExitMints((current) => {
      if (!current.has(token.mint)) return current;
      const next = new Set(current);
      next.delete(token.mint);
      persistAutoExitMints(next);
      return next;
    });
    setSelectedMint(token.mint);
    toast({
      title: automatic ? `Auto-exit closed · ${token.symbol}` : `Paper position closed · ${token.symbol}`,
      description: `${automatic ? "Fresh Exit signal auto-closed this Paper position. " : ""}Realized ${realizedProfitLoss >= 0 ? "+" : ""}${realizedProfitLoss.toFixed(1)} chips P/L from ${position.chipsInvested.toFixed(0)} chips invested. You can buy again.`,
    });
  }

  return (
    <div className="min-h-screen bg-[#091510] text-[#f2faf6]">
      <Header />
      <style>{`
        @keyframes laneBump { 0%, 100% { transform: translateY(-4px); } 45% { transform: translateY(-13px) scale(1.015); } }
        @keyframes hostBob { 0%, 100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-5px) rotate(2deg); } }
        @keyframes ticketPop { 0% { opacity: 0; transform: translateY(8px) scale(.85); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
        .arcade-grain { background-image: radial-gradient(rgba(248,243,223,.08) .7px, transparent .7px); background-size: 5px 5px; }
        .arcade-stripes { background-image: repeating-linear-gradient(135deg, rgba(255,255,255,.025) 0 9px, transparent 9px 18px); }
      `}</style>

      <main className="mx-auto w-full max-w-[1540px] px-4 pb-10 sm:px-7 lg:px-10">
        <section className="relative overflow-hidden pb-5 pt-6 lg:pb-7 lg:pt-8">
          <div className="pointer-events-none absolute -right-24 -top-20 h-72 w-72 rounded-full bg-[#50d890]/10 blur-3xl" />
          <div className="relative flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-[#50d890]">
                <span className="h-px w-8 bg-[#50d890]" /> Arcade PAIF
              </div>
                <h1 className="font-mono text-4xl font-black leading-[0.92] tracking-[-0.07em] sm:text-5xl lg:text-[3.25rem]">
                  Ring Bell to Rise
              </h1>
                <p className="mt-5 max-w-2xl text-sm leading-6 text-[#e4f1eb]">
                  Compare the live lanes, open the real token chart, and ring a rising lane or a red buy-the-dip idea.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[
                {
                  label: "Paper XP",
                  value: score.toLocaleString(),
                  icon: Trophy,
                  color: HOME_CHART_GREEN,
                  help: "Your game score. Ringing a Paper bell adds XP based on the lane read and chip amount. XP has no cash value.",
                },
                {
                  label: paperResults.closed > 0 ? `Win rate · ${paperResults.wins}/${paperResults.closed}` : "Win rate · no trades yet",
                  value: paperResults.closed > 0 ? `${Math.round((paperResults.wins / paperResults.closed) * 100)}%` : "—",
                  icon: Activity,
                  color: HOME_CHART_GREEN,
                  help: "Profitable closed Paper positions divided by all closed Paper positions. Open positions do not count.",
                },
                {
                  label: "Overall Paper P/L",
                  value: `${paperResults.realizedProfitLoss >= 0 ? "+" : ""}${paperResults.realizedProfitLoss.toFixed(1)}`,
                  icon: BarChart3,
                  color: paperResults.realizedProfitLoss >= 0 ? HOME_CHART_GREEN : HOME_CHART_RED,
                  help: "Your combined realized profit or loss from closed Paper positions in this browser. Open-position gains and losses are not included.",
                },
                {
                  label: "Tickets",
                  value: tickets,
                  icon: Ticket,
                  color: "#ffd15b",
                  help: "You earn one game ticket each time you ring a Paper bell. Tickets currently have no cash value and do not unlock paid access.",
                },
                {
                  label: "Gems",
                  value: gems,
                  icon: Gem,
                  color: "#62dbff",
                  help: "You earn 12 game gems each time you ring a Paper bell. Gems fill the reward-chest meter but have no cash value.",
                },
              ].map((stat) => (
                <div key={stat.label} className="relative min-w-[100px] rounded-xl border border-[#294a3d] bg-[#102019] p-3 shadow-[0_4px_0_#050b08]">
                  <button
                    type="button"
                    aria-label={`Explain ${stat.label}`}
                    aria-expanded={openStatHelp === stat.label}
                    onClick={() => setOpenStatHelp((current) => current === stat.label ? null : stat.label)}
                    className="rounded-full p-1 -m-1 transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f8f3df]"
                  >
                    <stat.icon size={14} style={{ color: stat.color }} />
                  </button>
                  <p className="mt-2 font-mono text-lg font-black">{stat.value}</p>
                  <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-[#a49382]">{stat.label}</p>
                  {openStatHelp === stat.label && (
                    <div className="absolute right-0 top-[calc(100%+8px)] z-40 w-64 rounded-xl border border-[#315c4a] bg-[#07130e] p-3 text-xs leading-5 text-[#d6e8e0] shadow-[0_12px_30px_rgba(0,0,0,.5)]">
                      {stat.help}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="arcade-stripes relative overflow-hidden rounded-[28px] border-2 border-[#315c4a] bg-[#102019] p-3 shadow-[0_16px_0_#050b08,0_28px_60px_rgba(0,0,0,.35)] sm:p-5">
          <div className="arcade-grain pointer-events-none absolute inset-0 opacity-50" />
          <div className="relative">
            <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-[#294a3d] bg-[#0b1712] p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="relative h-14 w-14 shrink-0">
                  <div className="absolute left-2 top-1 h-11 w-10 rounded-[45%_45%_38%_38%] border-2 border-[#27734e] bg-[#50d890] shadow-[3px_4px_0_#17452f]" style={{ animation: "hostBob 2.2s ease-in-out infinite" }}>
                    <span className="absolute left-2.5 top-3 h-1.5 w-1.5 rounded-full bg-[#17130f]" />
                    <span className="absolute right-2.5 top-3 h-1.5 w-1.5 rounded-full bg-[#17130f]" />
                    <span className="absolute left-1/2 top-6 h-1 w-4 -translate-x-1/2 rounded-full bg-[#ef6262]" />
                    <span className="absolute -top-3 left-1/2 h-3 w-1 -translate-x-1/2 rounded-full bg-[#ffd15b]" />
                  </div>
                </div>
                <div className={`grid min-w-0 flex-1 gap-2 ${gems > 0 ? "grid-cols-3" : "grid-cols-2"}`}>
                  {[
                    { step: "1", label: "Pick lane" },
                    { step: "2", label: "Ring bell" },
                    ...(gems > 0 ? [{ step: "3", label: "Get reward" }] : []),
                  ].map(({ step, label }) => (
                    <div key={step} className="rounded-xl border border-[#294a3d] bg-[#102019] px-2 py-2 font-mono">
                      <span className="text-sm font-black text-[#50d890]">{step}.</span>
                      <span className="ml-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-[#dcebe4]">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
                 <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[10px] font-black uppercase tracking-[0.14em] text-[#f2faf6]">Round mode</span>
                  <div className={`flex rounded-2xl border p-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em] ${gameMode === "live" ? "border-[#50d890]/80 bg-[#0d2419] shadow-[0_0_18px_rgba(80,216,144,.18)]" : "border-[#50d890]/60 bg-[#07110d]"}`} role="group" aria-label="Game mode">
                    <button
                      type="button"
                      onClick={() => setGameMode("paper")}
                      aria-pressed={gameMode === "paper"}
                       className={`rounded-xl px-3 py-2 transition ${gameMode === "paper" ? "bg-[#50d890] text-[#07130e]" : "text-[#9cb8ac] hover:text-[#61dfa0]"}`}
                    >
                       Paper · simulated
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setGameMode("live");
                        if (!wallet) setConnectOpen(true);
                      }}
                      aria-pressed={gameMode === "live"}
                      data-testid="button-arcade-live-mode"
                       className={`rounded-xl px-3 py-2 transition ${gameMode === "live" ? "bg-[#50d890] text-[#07130e] shadow-[0_0_16px_rgba(80,216,144,.42)]" : "text-[#9cb8ac] hover:text-[#61dfa0]"}`}
                    >
                       Live SOL
                    </button>
                     <span className={`rounded-xl px-3 py-2 ${gameMode === "live" ? "font-bold text-[#61dfa0]" : "text-[#9cb8ac]"}`}>
                      {gameMode === "live"
                        ? wallet ? "Wallet connected · trades locked" : "Connect wallet"
                        : signedInAccessActive
                          ? accessStatus?.paidActive ? "Pass active" : "Account trial active"
                          : browserTrialActive
                            ? "Free trial active"
                            : paperTrialExpired ? "Pass needed" : "3 free days"}
                    </span>
                </div>
                <button type="button" onClick={() => tokenQuery.refetch()} aria-label="Refresh market lanes" className="rounded-full border border-[#604f40] bg-[#241d18] p-2.5 text-[#baa992] transition hover:border-[#b7f55f] hover:text-[#b7f55f]">
                  <RefreshCw size={15} className={tokenQuery.isFetching ? "animate-spin" : ""} />
                </button>
              </div>
            </div>

              <div className="relative z-10 mb-4 flex flex-col gap-3 rounded-2xl border border-[#294a3d] bg-[#0b1712] px-3 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                   <p className="font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-[#50d890]">
                     {gameMode === "live"
                       ? "Live SOL mode · funded trades locked"
                       : signedInAccessActive
                          ? accessStatus?.paidActive ? "Access Pass active" : "Account trial active"
                         : browserTrialActive
                           ? "Free Paper trial active"
                           : paperTrialExpired ? "Free Paper trial ended" : "3 free days of Paper play"}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[#b8cec4]">
                      {gameMode === "live"
                        ? "This is the real-SOL market view. Wallet connection is available, but no funded order can execute yet."
                       : paperTrialExpired && !signedInAccessActive
                          ? "Sign in or connect a wallet and choose an Access Pass to continue."
                          : paperTrialStartedAt === null && !signedInAccessActive
                           ? "No wallet needed · your trial starts when you ring your first lane."
                           : "Paper chips are virtual · no cash value."}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                   {gameMode === "live" && !wallet ? (
                     <button
                       type="button"
                       onClick={() => setConnectOpen(true)}
                       data-testid="button-arcade-live-connect-wallet"
                       className="relative z-20 rounded-full border border-[#61dfa0] bg-[#50d890] px-4 py-2 font-mono text-[10px] font-black uppercase tracking-[0.08em] text-[#07130e] shadow-[0_0_18px_rgba(80,216,144,.42)] transition hover:bg-[#61dfa0] hover:shadow-[0_0_24px_rgba(80,216,144,.62)]"
                     >
                       Connect wallet for Live
                     </button>
                   ) : gameMode === "live" && wallet ? (
                     <span className="rounded-full border border-[#50d890]/35 bg-[#50d890]/10 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-[#61dfa0]">
                       Wallet connected · Live locked
                     </span>
                   ) : gameMode === "paper" && paperTrialExpired && !wallet ? (
                    <button
                      type="button"
                      onClick={() => setConnectOpen(true)}
                      data-testid="button-arcade-connect-wallet"
                      className="relative z-20 rounded-full bg-[#50d890] px-4 py-2 font-mono text-[10px] font-black uppercase tracking-[0.08em] text-[#07130e] transition hover:bg-[#61dfa0]"
                    >
                       Connect for a pass
                    </button>
                   ) : gameMode === "paper" && paperTrialExpired && !paperAccessActive ? (
                    <a href="/upgrade" className="rounded-full bg-[#ffd15b] px-4 py-2 font-mono text-[10px] font-black uppercase tracking-[0.08em] text-[#21170b]">
                      View passes
                    </a>
                  ) : null}
                    {gameMode === "paper" ? <div className="flex items-center gap-1.5" role="group" aria-label="Choose how many chips each bell adds">
                      <span className="mr-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#c8bca8]">Chips per bell</span>
                    {ROUND_AMOUNTS.map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => setPaperAmount(amount)}
                        aria-pressed={paperAmount === amount}
                        aria-label={`Each bell adds ${amount} Paper chips`}
                         className={`rounded-full border px-3 py-2 font-mono text-[11px] font-bold transition ${
                          paperAmount === amount
                            ? "border-[#50d890] bg-[#50d890] text-[#07130e]"
                            : "border-[#315c4a] bg-[#102019] text-[#9cb8ac] hover:border-[#50d890] hover:text-[#61dfa0]"
                        }`}
                      >
                        {amount}
                      </button>
                    ))}
                     <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#7f9b8e]">chips</span>
                   </div> : wallet ? (
                     <span className="rounded-full border border-[#ffd15b]/35 bg-[#ffd15b]/10 px-3 py-2 font-mono text-[8px] font-bold uppercase tracking-[0.12em] text-[#ffd15b]">
                       No funded trades yet
                     </span>
                   ) : null}
                </div>
              </div>

            <div className="mb-3 flex items-center justify-between gap-3 px-1">
               <p className="flex flex-wrap items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-[#d9cdbb]">
                 <Activity size={13} className="text-[#50d890]" /> Live Solana crypto lanes / established activity
                 <span className="rounded-full border border-[#50d890]/40 bg-[#50d890]/10 px-2 py-0.5 text-[8px] text-[#61dfa0]">24/7 market</span>
              </p>
              <p className="hidden font-mono text-[10px] uppercase tracking-[0.08em] text-[#91ad9f] sm:block">
                Green = rising · red = possible dip · both can be rung
              </p>
            </div>

            {tokenQuery.isLoading ? (
              <div className="flex min-h-[520px] items-center justify-center rounded-2xl border border-[#604f40] bg-[#171310] text-[#b8aa99]">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading live lanes…
              </div>
            ) : tokenQuery.isError || columnTokens.length === 0 ? (
              <div className="flex min-h-[520px] flex-col items-center justify-center gap-3 rounded-2xl border border-[#604f40] bg-[#171310] px-6 text-center text-[#b8aa99]">
                <RefreshCw className="h-6 w-6 text-[#ef6262]" />
                <p>Live market lanes are unavailable right now. Paper rounds pause until the evidence returns.</p>
                <button type="button" onClick={() => tokenQuery.refetch()} className="rounded-full border border-[#b7f55f]/50 px-4 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[#b7f55f]">
                  Try again
                </button>
              </div>
            ) : (
                <div id="live-lanes" className="grid grid-cols-2 gap-3 px-1 pb-4 pt-2 sm:grid-cols-3 lg:grid-cols-8">
                {columnTokens.map((token) => (
                  <TokenColumn
                    key={token.mint}
                    token={token}
                    best={bestPositiveMints.has(token.mint)}
                    selected={token.mint === selectedMint}
                    rung={token.mint === lastRungMint}
                    paperPosition={paperPositions[token.mint]}
                    favorite={favoriteMints.includes(token.mint)}
                    paperAmount={paperAmount}
                    onFavorite={() => toggleFavorite(token.mint)}
                    onRing={() => ringLane(token)}
                  />
                ))}
              </div>
            )}

              {alphaLanePick.data && (
                <section className={`mb-5 rounded-2xl border p-4 ${
                  alphaLanePick.data.recommendation === "ring"
                    ? "border-violet-400/35 bg-violet-500/[0.09]"
                    : alphaLanePick.data.recommendation === "watch"
                      ? "border-amber-400/35 bg-amber-500/[0.07]"
                      : "border-red-400/35 bg-red-500/[0.07]"
                }`} data-testid="alpha-lane-pick">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div>
                      <p className="flex items-center gap-2 font-mono text-[9px] font-black uppercase tracking-[0.16em] text-violet-400">
                        <Sparkles size={13} /> PAIF Alpha compares all lanes
                      </p>
                      <h3 className="mt-2 font-mono text-lg font-black text-[#f0eadf]">{alphaLanePick.data.headline}</h3>
                      <p className="mt-1 text-[11px] leading-5 text-[#b8aa99]">{alphaLanePick.data.summary}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedMint(alphaLanePick.data.pick.mint)}
                      className="shrink-0 rounded-full border border-violet-400/40 bg-violet-500/10 px-4 py-2 font-mono text-[9px] font-black uppercase tracking-[0.1em] text-violet-300 transition hover:bg-violet-500/20"
                      data-testid="button-show-alpha-lane"
                    >
                      Show Lane {alphaLanePick.data.pick.lane}
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full border border-white/10 px-2.5 py-1 font-mono text-[8px] font-bold uppercase text-[#d9cdbb]">
                      Alpha score {alphaLanePick.data.pick.score}/100
                    </span>
                    <span className="rounded-full border border-white/10 px-2.5 py-1 font-mono text-[8px] font-bold uppercase text-[#d9cdbb]">
                      Confidence {alphaLanePick.data.confidence}/100
                    </span>
                    <span className={`rounded-full border px-2.5 py-1 font-mono text-[8px] font-bold uppercase ${
                      alphaLanePick.data.agreesWithUser
                        ? "border-[#50d890]/30 text-[#61dfa0]"
                        : "border-[#ffd15b]/30 text-[#ffd15b]"
                    }`}>
                      {alphaLanePick.data.agreesWithUser ? "Matches your lane" : "Different from your lane"}
                    </span>
                  </div>
                  {(alphaLanePick.data.evidence[0] || alphaLanePick.data.concerns[0]) && (
                    <p className="mt-3 text-[10px] text-[#9cb8ac]">
                      {alphaLanePick.data.evidence[0] ?? alphaLanePick.data.concerns[0]}
                    </p>
                  )}
                  <p className="mt-2 font-mono text-[8px] uppercase tracking-[0.1em] text-[#806e5d]">
                    Guidance only · showing Alpha's lane does not ring it
                  </p>
                </section>
              )}

              <PaperHoldings
                holdings={paperHoldings}
                onSell={sellPaperPosition}
                autoExitMints={autoExitMints}
                onAutoExitChange={setAutoExit}
              />

              <section id="favorites" className="mt-5 rounded-2xl border border-[#ffd15b]/30 bg-[#171910] p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="flex items-center gap-2 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-[#ffd15b]">
                      <Star size={13} fill="currentColor" /> My favorites
                    </p>
                    <p className="mt-1 text-[10px] text-[#b8aa99]">
                      {favoriteTokens.length > 0 ? "Your saved lanes stay here even when they rotate out of the live board." : "Star any lane to keep it in your personal list."}
                    </p>
                  </div>
                  <span className="rounded-full border border-[#604f40] bg-[#241d18] px-2.5 py-1 font-mono text-[8px] font-bold uppercase tracking-[0.12em] text-[#ffd15b]">
                    {favoriteTokens.length} saved
                  </span>
                </div>
                {favoriteTokens.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                    {favoriteTokens.map((token) => (
                      <FavoriteTokenCard key={token.mint} token={token} onRemove={() => toggleFavorite(token.mint)} />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-[#604f40] bg-[#0b1712] px-4 py-3 text-[11px] text-[#9c8e80]">
                    Your favorites will appear here with a chart shortcut and current market read.
                  </div>
                )}
              </section>
          </div>
        </section>

        <section className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-2xl border border-[#294a3d] bg-[#0f1d18] p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-[#50d890]">
                  {selected && bestPositiveMints.has(selected.mint) ? "Momentum read" : "Your rung lane"}
                </p>
                <h2 className="mt-2 font-mono text-3xl font-black tracking-[-0.07em]">{selected?.name ?? "Waiting for lanes"}</h2>
                <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.13em] text-[#8f7d6a]">
                   {selected ? `${selected.symbol} · ${formatMove(selected.change1h)} over 1 hour · ${formatAge(selected.ageMins)} old` : "No current snapshot"}
                </p>
              </div>
              {selectedRead && (
                <div className="rounded-xl border border-[#604f40] bg-[#241d18] px-4 py-3 text-right">
                  <p className="font-mono text-[8px] uppercase tracking-[0.13em] text-[#8f7d6a]">{selectedRead.positive ? "Rising read" : "Dip read"}</p>
                  <p className={`mt-1 font-mono text-xl font-black ${selectedRead.positive ? "text-[#50d890]" : "text-[#ef6262]"}`}>
                    {selectedRead.positive ? `${selectedRead.confidence}/100` : "CHECK CHART"}
                  </p>
                </div>
              )}
            </div>
            {selectedRead && (
              <>
                <p className="mt-5 rounded-xl border border-[#50d890]/20 bg-[#50d890]/[0.05] p-3 text-[12px] leading-5 text-[#d7e3bc]">
                  {selectedRead.explanation}
                </p>
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  {selectedRead.evidence.map((item) => (
                    <div key={item} className="rounded-xl border border-[#493c33] bg-[#14110f] p-3 font-mono text-[9px] text-[#b8aa99]">{item}</div>
                  ))}
                </div>
                {selected && (
                  <AlphaSecondOpinion
                    surface="arcade"
                    subjectId={selected.mint}
                    subjectLabel={selected.symbol}
                    primaryDecision={selectedRead.positive ? "Ring this rising lane" : "Check chart before ringing"}
                    primaryVerdict={selectedRead.positive ? "positive" : "negative"}
                    primaryConfidence={selectedRead.confidence}
                    evidence={{
                      marketDataAt: selected.marketDataAt ? new Date(selected.marketDataAt).getTime() : undefined,
                      change5m: selected.change5m ?? undefined,
                      change1h: selected.change1h ?? undefined,
                      change24h: selected.change24h ?? undefined,
                      liquidityUsd: selected.liquidity ?? undefined,
                      marketCapUsd: selected.mcap ?? undefined,
                      volume24h: selected.volume24h ?? undefined,
                      ageMins: selected.ageMins ?? undefined,
                      mode: "paper",
                    }}
                    auto
                    className="mt-4 border-violet-400/30 bg-violet-500/[0.08]"
                  />
                )}
              </>
            )}
          </div>

          <aside className="rounded-2xl border border-[#ffd15b]/30 bg-[#102019] p-5">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-[#ffd15b]">
                <Gem size={14} /> Paper treasure
              </p>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-[#315c4a] bg-[#091510] px-2 py-1 font-mono text-[8px] font-bold uppercase tracking-[0.12em] text-[#9cb8ac]">Round {round}</span>
                <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-[#50d890]">No cash value</span>
              </div>
            </div>
             <p className="mt-4 font-mono text-3xl font-black">{gems} <span className="text-xs text-[#ffd15b]">gems</span></p>
             <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[#8f7d6a]">Next round: {paperAmount} paper chips</p>
            <div className="mt-3 h-3 overflow-hidden rounded-full border border-[#604f40] bg-[#100d0b]">
              <div className="h-full rounded-full bg-gradient-to-r from-[#ff806b] via-[#ffd15b] to-[#b7f55f] transition-all duration-500" style={{ width: `${Math.min(100, gems)}%` }} />
            </div>
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-[#604f40] bg-[#171310] p-3">
              {lastRungMint ? <Check size={16} className="shrink-0 text-[#b7f55f]" /> : <LockKeyhole size={16} className="shrink-0 text-[#8f7d6a]" />}
              <p className="text-[11px] leading-5 text-[#c8bca8]">
                {lastRungMint ? "Paper reward collected. Ring another positive lane to keep the streak moving." : "Ring a positive lane to start filling the chest."}
              </p>
            </div>
          </aside>
        </section>

        <div className="mt-8 flex flex-col gap-4 border-t border-[#4b3d33] pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[#806e5d]">
             <span className="flex items-center gap-1.5"><Database size={12} /> Live Solana crypto snapshot</span>
             <span className="flex items-center gap-1.5"><WalletCards size={12} /> Wallet only needed for an Access Pass</span>
              <span className="flex items-center gap-1.5"><Bell size={12} /> Paper positions · browser saved · no real trades</span>
          </div>
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#806e5d]">A current read can still be wrong</span>
        </div>
      </main>
      <div className="[&_*]:border-white/10 [&_*]:text-[#806e5d]">
        <Footer />
      </div>
      <LoginModal open={connectOpen} onOpenChange={setConnectOpen} walletOnly />
    </div>
  );
}
