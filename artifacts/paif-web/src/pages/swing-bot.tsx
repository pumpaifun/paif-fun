import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import bs58 from "bs58";
import { Header } from "@/components/header";
import { LoginModal } from "@/components/login-modal";
import { AlphaSecondOpinion } from "@/components/alpha-second-opinion";
import { Footer } from "@/components/footer";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isValidSolanaAddress } from "@/lib/chains";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Waves,
  Plus,
  Check,
  Copy,
  Pause,
  Play,
  Square,
  Loader2,
  ShieldAlert,
  Beaker,
  Zap,
  TrendingUp,
  TrendingDown,
  Activity,
  ChevronDown,
  ChevronUp,
  Clock,
  Wallet,
  LineChart,
  Trash2,
  CheckCircle2,
  Circle,
  Star,
  Ban,
  PiggyBank,
  Pencil,
  CircleHelp,
} from "lucide-react";

const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type Mode = "paper" | "live";
type TradingUniverse = "crypto" | "stocks";
type Style = "quick" | "ride" | "dip" | "coil";
const STYLE_LABEL: Record<Style, string> = {
  quick: "Scanner",
  ride: "Adaptive",
  dip: "Adaptive",
  coil: "Adaptive",
};
const POSITION_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
const PROFIT_SKIM_OPTIONS = [0, 25, 50, 75, 100] as const;
const LIQUIDITY_OPTIONS: ReadonlyArray<{ value: number; label: string; recommended?: boolean }> = [
  { value: 10_000, label: "$10K+" },
  { value: 25_000, label: "$25K+" },
  { value: 40_000, label: "$40K+", recommended: true },
  { value: 100_000, label: "$100K+" },
  { value: 250_000, label: "$250K+" },
  { value: 500_000, label: "$500K+" },
];
const STOP_ROOM_OPTIONS = [
  { value: null, label: "Automatic", detail: "adjusts with the position" },
  { value: 3, label: "−3%", detail: "tightest — cuts fast" },
  { value: 5, label: "−5%", detail: "balanced protection" },
  { value: 8, label: "−8%", detail: "more recovery room" },
  { value: 12, label: "−12%", detail: "wide — riskier" },
] as const;
const WINNER_KEEP_OPTIONS = [
  { value: null, label: "Automatic", detail: "adjusts to the token" },
  { value: 75, label: "Keep 75%", detail: "protects gains faster" },
  { value: 60, label: "Keep 60%", detail: "balanced protection" },
  { value: 50, label: "Keep 50%", detail: "more room for runners" },
  { value: 40, label: "Runner", detail: "skips the routine +3% take; widest room" },
] as const;
const LOSS_COOLDOWN_OPTIONS = [2, 3, 4, 5, 6] as const;
type Status = "awaiting_funds" | "active" | "paused" | "stopped" | "completed" | "deleting";

interface SwingStrategy {
  id: string;
  ownerWallet: string;
  workerWallet: string;
  withdrawAddress: string;
  name: string;
  favorite: boolean;
  mode: Mode;
  universe?: TradingUniverse;
  style: Style;
  targetMint: string | null;
  manualBuy: boolean;
  reentry: boolean;
  requireApproval: boolean;
  status: Status;
  restartedAt: string | null;
  budgetLamports: string;
  subWalletCount?: number;
  paperBankrollLamports: string;
  windowEndAt: string;
  unlimitedWindow: boolean;
  activeMsTotal: string;
  activeSince: string | null;
  maxPositions: number;
  allowStacking: boolean;
  hotStreakFullSize: boolean;
  minPoolAgeHours: number | null;
  rebuyMints: string[];
  blockedMints: string[];
  takeProfitPct: number | null;
  conservativeProfit: boolean;
  neverSellAtLoss: boolean;
  redEndBehavior: "sell" | "send_tokens";
  stopLossPct: number;
  stopRoomPct: number | null;
  sellOffCutEnabled: boolean;
  winnerKeepPct: number | null;
  profitSkimPct: number;
  bankedLamports: string;
  trailArmPct: number;
  trailPct: number;
  maxHoldHours: number;
  minLiquidityUsd: number;
  slippageBps: number;
  lossStopCount: number;
  consecutiveLosses: number;
  lossCooldownUntil: string | null;
  tradesExecuted: number;
  wins: number;
  realizedPnlLamports: string;
  feesPaidLamports: string;
  feeBps: number;
  nextRunAt: string | null;
  lastScanAt: string | null;
  lastScanNote: string | null;
  createdAt: string;
}

// A saved "favorite settings" snapshot — named, starrable, applyable to any
// scanning bot of the same style.
interface SwingPresetRow {
  id: string;
  ownerWallet: string;
  name: string;
  starred: boolean;
  style: Style;
  settings: Record<string, unknown>;
  sourceStrategyName: string | null;
  createdAt: string;
}

interface SwingPerformanceBot {
  strategyId: string;
  name: string;
  mode: Mode;
  style: Style;
  status: string;
  settings: Record<string, unknown>;
  trades: number;
  wins: number;
  winRate: number;
  realizedPnlLamports: string;
  createdAt: string;
  archived: boolean;
}

interface SwingPerformanceHistory {
  summary: { bots: number; trades: number; wins: number; winRate: number };
  bestBots: SwingPerformanceBot[];
}

interface SwingDefaultPerformance {
  minimumTrades: number;
  recommendationAvailable: boolean;
  recommended: CommunityLeaderboardEntry;
  leaderboard: {
    bestWinRate: CommunityLeaderboardEntry[];
    mostWins: CommunityLeaderboardEntry[];
    mostProfitable: CommunityLeaderboardEntry[];
  };
}

interface CommunityLeaderboardEntry {
  style: Style;
  settings: Record<string, unknown>;
  bots: number;
  trades: number;
  wins: number;
  winRate: number;
  realizedPnlLamports: string;
  paperBots: number;
  liveBots: number;
}

interface TokenizedStockAsset {
  mint: string;
  name: string;
  tokenSymbol: string;
  underlyingTicker: string;
  issuer: string;
  tradingStatus: string;
  availabilityLabel: string;
  priceUsd: number | null;
  liquidityUsd: number | null;
  marketDataStale: boolean;
}

interface SwingPosition {
  id: string;
  mint: string;
  symbol: string;
  tokenName: string | null;
  mode: Mode;
  status: "open" | "closed";
  solInLamports: string;
  tokenAmountRaw: string;
  decimals: number;
  highWaterLamports: string;
  lastValueLamports: string;
  entryPriceUsd: number | null;
  entryFillPriceUsd: number | null;
  exitPriceUsd: number | null;
  entrySig: string | null;
  exitSig: string | null;
  solOutLamports: string | null;
  exitReason: string | null;
  entryTrigger: "auto" | "manual" | null;
  manualHold: boolean;
  openedAt: string;
  closedAt: string | null;
}

interface SwingEvent {
  id: string;
  kind: string;
  mint: string | null;
  symbol: string | null;
  detail: string;
  solLamports: string | null;
  createdAt: string;
}

// "Ask me first": a pick the bot filed for the owner's OK instead of buying.
interface SwingBuySignal {
  id: string;
  strategyId: string;
  mint: string;
  symbol: string;
  reason: string;
  status: "pending" | "approved" | "dismissed" | "expired";
  createdAt: string;
}

const fmtSol = (lamports: string | number) => (Number(lamports) / LAMPORTS_PER_SOL).toFixed(4);
// Token USD price — handles sub-cent tokens (e.g. $0.00001641) with 4 significant
// figures; returns null so callers can hide the field when no price was recorded.
const fmtPrice = (v?: number | null): string | null => {
  if (v == null || !isFinite(v) || v <= 0) return null;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  return `$${Number(v.toPrecision(4)).toString()}`;
};

// How many positions to split a budget into: bigger deposit → more positions
// (more spread-out risk) while keeping each slice a meaningful size.
const suggestPositionsFor = (solBudget: number): number => {
  const b = solBudget;
  if (!b || b <= 0) return 3;
  if (b <= 0.1) return 1;
  if (b <= 0.3) return 2;
  if (b <= 0.6) return 3;
  if (b <= 1) return 4;
  if (b <= 1.5) return 5;
  if (b <= 2.5) return 6;
  if (b <= 4) return 7;
  if (b <= 6) return 8;
  if (b <= 8) return 9;
  return 10;
};
const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

const GUEST_TOKEN_KEY = "paif.swing.guest.v1";
function loadOrCreateGuestToken(): string {
  try {
    const saved = window.localStorage.getItem(GUEST_TOKEN_KEY);
    if (saved && /^[A-Za-z0-9_-]{43}$/.test(saved)) return saved;
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    const token = window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    window.localStorage.setItem(GUEST_TOKEN_KEY, token);
    return token;
  } catch {
    throw new Error("Guest paper mode needs browser storage. Enable it and refresh.");
  }
}

// Force chart links to open in a genuinely NEW window/tab. Wallet in-app
// browsers (Phantom etc.) sometimes ignore target="_blank" on plain links and
// replace the current page; an explicit window.open is respected far more
// reliably. Falls back to normal navigation only if the popup was blocked.
const openNewWindow = (e: React.MouseEvent, url: string) => {
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (w) e.preventDefault();
};

// One-tap "copy the contract address" button — shows on every token row
// (watchlist, open, closed) so it's easy to paste the mint into a wallet,
// another browser, or a chart site.
function CopyMintButton({ mint, testId }: { mint: string; testId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="flex items-center gap-0.5 text-muted-foreground underline font-normal"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(mint);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      title="Copy the token's contract address"
      data-testid={testId}
    >
      {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
      {copied ? "copied" : "copy CA"}
    </button>
  );
}

const statusColor: Record<Status, string> = {
  awaiting_funds: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  active: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  paused: "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30",
  stopped: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  completed: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30",
  deleting: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
};

// Minimum-token-age dial presets (hours). "Be wild" = 0 = fresh launches allowed.
const MIN_AGE_PRESETS = [
  { label: "Just launched", value: "0" },
  { label: "6+ hours", value: "6" },
  { label: "12+ hours", value: "12" },
  { label: "24+ hours", value: "24" },
  { label: "48+ hours", value: "48" },
  { label: "72+ hours", value: "72" },
  { label: "4+ days", value: "96" },
  { label: "5+ days", value: "120" },
  { label: "7+ days", value: "168" },
  { label: "10+ days", value: "240" },
  { label: "Custom", value: "custom" },
];

const WINDOW_PRESETS = [
  { label: "12 hours", hours: 12 },
  { label: "1 day", hours: 24 },
  { label: "3 days", hours: 72 },
  { label: "1 week", hours: 168 },
  { label: "2 weeks", hours: 336 },
  { label: "1 month", hours: 720 },
];

// ─── Read-session token cache (owner signs once; polling doesn't re-prompt) ───
const READ_TOKEN_KEY = (o: string) => `paif:swing-read-token:${o}`;
function loadCachedToken(owner: string): string | null {
  try {
    const raw = localStorage.getItem(READ_TOKEN_KEY(owner));
    if (!raw) return null;
    const { token, exp } = JSON.parse(raw);
    if (!token || typeof exp !== "number" || Date.now() > exp) return null;
    return token as string;
  } catch {
    return null;
  }
}
function storeCachedToken(owner: string, token: string) {
  try {
    localStorage.setItem(READ_TOKEN_KEY(owner), JSON.stringify({ token, exp: Date.now() + 28 * 60_000 }));
  } catch {}
}
function clearCachedToken(owner: string) {
  try {
    localStorage.removeItem(READ_TOKEN_KEY(owner));
  } catch {}
}

// Lifetime "time in market": total ms the bot has actually been running,
// across every pause/restart. Server accrues on transitions; while active we
// add the live stretch locally so the clock ticks in real time.
function activeTimeMs(s: { activeMsTotal: string; activeSince: string | null; status: Status }): number {
  const base = Number(s.activeMsTotal || "0");
  if (s.status === "active" && s.activeSince) {
    return base + Math.max(0, Date.now() - new Date(s.activeSince).getTime());
  }
  return base;
}
function fmtActiveTime(ms: number): string {
  if (ms < 60_000) return "under a minute";
  const mins = Math.floor(ms / 60_000);
  const days = Math.floor(mins / 1440);
  const months = Math.floor(days / 30);
  const parts: string[] = [];
  if (months > 0) parts.push(`${months} month${months === 1 ? "" : "s"}`);
  const remDays = days - months * 30;
  if (remDays > 0) parts.push(`${remDays} day${remDays === 1 ? "" : "s"}`);
  const h = Math.floor((mins % 1440) / 60);
  if (h > 0 && months === 0) parts.push(`${h}h`);
  const m = mins % 60;
  if (m > 0 && days === 0) parts.push(`${m}m`);
  return parts.join(" ") || "under a minute";
}

function timeLeft(endIso: string): string {
  const ms = new Date(endIso).getTime() - Date.now();
  if (ms <= 0) return "ended";
  const h = Math.floor(ms / 3600_000);
  if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h left`;
  const m = Math.floor((ms % 3600_000) / 60_000);
  return `${h}h ${m}m left`;
}

function SettingHelp({
  title,
  help,
  htmlFor,
  className,
  testId,
}: {
  title: ReactNode;
  help: ReactNode;
  htmlFor?: string;
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const titleNode = htmlFor
    ? <Label htmlFor={htmlFor} className={className}>{title}</Label>
    : <span className={className ?? "text-sm font-medium"}>{title}</span>;
  return (
    <>
      <div className="flex items-center gap-1.5">
        {titleNode}
        <button
          type="button"
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${typeof title === "string" ? title : "Setting"} help`}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          data-testid={testId}
        >
          <CircleHelp className="h-4 w-4" />
        </button>
      </div>
      {open && (
        <div className="mt-1 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground" role="note">
          {help}
        </div>
      )}
    </>
  );
}

// Collapsible section wrapper — a Card whose whole body folds away when you tap
// its header. Additive only: defaults open so nothing changes until tapped.
function CollapsibleCard({
  title,
  icon,
  description,
  defaultOpen = true,
  persistKey,
  className,
  headerClassName,
  contentClassName,
  testId,
  id,
  children,
}: {
  title: ReactNode;
  icon?: ReactNode;
  description?: ReactNode;
  defaultOpen?: boolean;
  persistKey?: string;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  testId?: string;
  id?: string;
  children: ReactNode;
}) {
  // When persistKey is set, remember the open/collapsed choice across page
  // visits and wallet re-connects (in-memory state alone resets to defaultOpen
  // every time the page remounts — the "always re-opens" bug the user hit).
  const [open, setOpen] = useState(() => {
    if (persistKey && typeof window !== "undefined") {
      try {
        const saved = window.localStorage.getItem(persistKey);
        if (saved === "0") return false;
        if (saved === "1") return true;
      } catch {
        // Safari private mode can throw on localStorage — just use the default.
      }
    }
    return defaultOpen;
  });
  const setOpenPersist = (next: boolean) => {
    setOpen(next);
    if (persistKey && typeof window !== "undefined") {
      try {
        window.localStorage.setItem(persistKey, next ? "1" : "0");
      } catch {
        // Private-mode write blocked — the fold still works for this session.
      }
    }
  };
  return (
    <Card id={id} className={className} data-testid={testId}>
      <Collapsible open={open} onOpenChange={setOpenPersist}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={`w-full flex items-start justify-between gap-2 px-6 py-4 text-left ${headerClassName ?? ""}`}
            data-testid={testId ? `toggle-${testId}` : undefined}
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2 font-semibold">{icon}{title}</span>
              {description && <span className="block text-sm text-muted-foreground font-normal mt-0.5">{description}</span>}
            </span>
            {open
              ? <ChevronUp className="w-5 h-5 shrink-0 text-muted-foreground mt-0.5" />
              : <ChevronDown className="w-5 h-5 shrink-0 text-muted-foreground mt-0.5" />}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className={contentClassName ?? "px-6 pb-6"}>{children}</div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

export default function SwingBotPage() {
  const { publicKey, connected, signMessage } = useWallet();
  const { toast } = useToast();
  const owner = connected ? publicKey?.toBase58() ?? null : null;
  const [guestToken] = useState(loadOrCreateGuestToken);

  const [readToken, setReadToken] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);

  useEffect(() => {
    if (owner) setReadToken(loadCachedToken(owner));
    else setReadToken(null);
  }, [owner]);

  const forgetToken = () => {
    if (owner) clearCachedToken(owner);
    setReadToken(null);
  };

  const unlock = async () => {
    if (!owner || !signMessage) {
      toast({ title: "Connect your wallet", description: "Connect a wallet that can sign messages.", variant: "destructive" });
      return;
    }
    setUnlocking(true);
    try {
      const nonce = Date.now();
      const message = ["paif-swing", "v1", "read-session", owner, String(nonce)].join("|");
      const signature = bs58.encode(await signMessage(new TextEncoder().encode(message)));
      const res = await apiRequest("POST", "/api/swing-bot/auth", { ownerWallet: owner, nonce, signature });
      const { token } = await res.json();
      storeCachedToken(owner, token);
      setReadToken(token);
      toast({ title: "Unlocked", description: "You can now view and manage your swing bots." });
    } catch (e: any) {
      toast({ title: "Couldn't unlock", description: e.message, variant: "destructive" });
    } finally {
      setUnlocking(false);
    }
  };

  // ─── Builder state ──────────────────────────────────────────────────────────
  const initialStockMint = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("stock") ?? "" : "";
  const [universe, setUniverse] = useState<TradingUniverse>(initialStockMint ? "stocks" : "crypto");
  const [selectedStockMint, setSelectedStockMint] = useState(initialStockMint);
  const [stockBotKind, setStockBotKind] = useState<"scan" | "single">(initialStockMint ? "single" : "scan");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<Mode>("paper");
  const [budgetSol, setBudgetSol] = useState("");
  const [subWallets, setSubWallets] = useState(1);
  const [customWallets, setCustomWallets] = useState(false);
  const [windowHours, setWindowHours] = useState(72);
  // Unlimited run: no scheduled end — the bot goes until stopped by hand.
  const [unlimitedRun, setUnlimitedRun] = useState(false);
  const [style, setStyle] = useState<Style>("quick");
  // "scan" = the bot hunts tokens itself. "watch" = babysitter mode: the user
  // pastes ONE token mint, the bot buys it with the whole budget and manages
  // the exit (single round trip, then the run completes).
  const [botKind, setBotKind] = useState<"scan" | "watch">("scan");
  const [watchMint, setWatchMint] = useState("");
  // Watch mode: false = buy automatically on the first funded check (default);
  // true = sit armed and wait for the owner's "Buy now" press.
  const [watchManualBuy, setWatchManualBuy] = useState(false);
  // Watch mode: keep the run alive after a sell and buy back in on a proven
  // comeback (buyers retake the tape) instead of completing. Default off.
  const [watchReentry, setWatchReentry] = useState(false);
  // Watch mode: false = tight babysit protection (default); true = "Hold it
  // long" — ride's wide-runner numbers on the user's own token (trail arms at
  // +60%, gives back 30%, holds while buyers dominate).
  const [watchHoldLong, setWatchHoldLong] = useState(false);
  // Creation uses the same behavior controls as the live bot editor. Keep the
  // panel open by default so users see the rules they are about to run.
  const [showAdvanced, setShowAdvanced] = useState(true);
  const [maxPositions, setMaxPositions] = useState("3");
  // Auto-suggest how many positions to split the budget into: bigger deposit
  // → more positions (more spread-out risk), keeping each slice a meaningful
  // size (~0.2–0.75 SOL). The suggestion auto-applies as the budget changes
  // UNTIL the user taps a number themselves — their choice always wins.
  const [positionsTouched, setPositionsTouched] = useState(false);
  const suggestedPositions = useMemo(() => suggestPositionsFor(Number(budgetSol)), [budgetSol]);
  useEffect(() => {
    if (!positionsTouched) {
      const suggested = Math.max(2, Math.min(4, suggestedPositions));
      const scansSeveral = universe === "stocks" ? stockBotKind === "scan" : botKind === "scan";
      setMaxPositions(scansSeveral ? String(suggested) : "1");
    }
  }, [suggestedPositions, positionsTouched, universe, stockBotKind, botKind, style]);
  const [hotStreakFullSize, setHotStreakFullSize] = useState(false);
  const [minAgeChoice, setMinAgeChoice] = useState("24"); // hours, "custom" for free entry
  const [minAgeCustom, setMinAgeCustom] = useState("");
  const minAgeHoursValue = (): number => {
    const raw = minAgeChoice === "custom" ? Number(minAgeCustom) : Number(minAgeChoice);
    if (!Number.isFinite(raw) || raw < 0) return 24;
    return Math.min(720, Math.round(raw));
  };
  // "Ask me first" (scan bots): the bot hunts and scores exactly as usual but
  // files each pick for the owner's OK instead of buying. New scanners default
  // on so the owner can inspect the chart before approving the first buy.
  const [requireApproval, setRequireApproval] = useState(true);
  const [takeProfitPct, setTakeProfitPct] = useState("");
  const [stopLossPct, setStopLossPct] = useState("4.5");
  const [trailArmPct, setTrailArmPct] = useState("12");
  const [trailPct, setTrailPct] = useState("8");
  // "Profit taking" preset (scan + quick swing only): Auto adapts to the live
  // tape and uses +12%/8% only as its backup trailing ceiling; "6" and "9"
  // explicitly arm the backup lock earlier.
  const [profitTaking, setProfitTaking] = useState<"auto" | "6" | "9">("auto");
  const [conservativeProfit, setConservativeProfit] = useState(false);
  const [profitSkimPct, setProfitSkimPct] = useState("50");
  // Defaults OFF (user's July 2026 call: holding every red bag is too risky
  // as a default) — the smart-default stop (~ −4 to −5%) is the loss cap.
  const [neverSellAtLoss, setNeverSellAtLoss] = useState(false);
  const [redEndBehavior, setRedEndBehavior] = useState<"sell" | "send_tokens">("send_tokens");
  const [momentumCycle, setMomentumCycle] = useState(false);
  const [rotateToRunners, setRotateToRunners] = useState(false);
  const PROFIT_PRESETS: Record<"6" | "9", { arm: number; giveback: number }> = {
    "6": { arm: 6, giveback: 5 },
    "9": { arm: 9, giveback: 6 },
  };
  const applyProfitTaking = (next: "auto" | "6" | "9") => {
    setProfitTaking(next);
    if (next === "auto") {
      setTrailArmPct("12");
      setTrailPct("8");
    } else {
      setTrailArmPct(String(PROFIT_PRESETS[next].arm));
      setTrailPct(String(PROFIT_PRESETS[next].giveback));
    }
  };
  const [minLiquidityUsd, setMinLiquidityUsd] = useState("40000");
  const [lossStopCount, setLossStopCount] = useState("4");
  const [stopRoomPct, setStopRoomPct] = useState<number | null>(null);
  const [sellOffCutEnabled, setSellOffCutEnabled] = useState(false);
  const [winnerKeepPct, setWinnerKeepPct] = useState<number | null>(null);
  const [createCustomStopRoom, setCreateCustomStopRoom] = useState("");
  const [createCustomWinnerKeep, setCreateCustomWinnerKeep] = useState("");
  const [stockExitMode, setStockExitMode] = useState<"automatic" | "custom">("automatic");

  // Switching style resets the advanced knobs to that style's defaults, so an
  // open "Advanced options" panel can't silently send quick-style numbers on
  // a long-ride bot (or vice versa).
  const applyStyle = (next: Style) => {
    setStyle(next);
    setProfitTaking("auto");
    setStopRoomPct(null);
    setSellOffCutEnabled(false);
    setWinnerKeepPct(null);
    if (next === "ride") {
      setStopLossPct("15"); setTrailArmPct("60"); setTrailPct("30");
    } else if (next === "dip") {
      setStopLossPct("20"); setTrailArmPct("40"); setTrailPct("20");
    } else if (next === "coil") {
      setStopLossPct("3"); setTrailArmPct("10"); setTrailPct("10");
    } else {
      setStopLossPct("4.5"); setTrailArmPct("12"); setTrailPct("8");
    }
  };

  // Switching bot kind resets the advanced knobs to that kind's defaults —
  // watch mode uses the runner-protection numbers (15% stop, lock at +15%,
  // give back at most 20% from the peak).
  const applyWatchKnobs = (holdLong: boolean) => {
    // Tight babysit (default) vs "Hold it long" = ride's wide-runner numbers.
    if (holdLong) {
      setStopLossPct("15"); setTrailArmPct("60"); setTrailPct("30");
    } else {
      setStopLossPct("15"); setTrailArmPct("15"); setTrailPct("20");
    }
  };
  const applyBotKind = (next: "scan" | "watch") => {
    setBotKind(next);
    if (next === "watch") {
      setProfitTaking("auto");
      applyWatchKnobs(watchHoldLong);
    } else {
      // Scanning bots always use Smart mix; there is no single-pattern choice.
      applyStyle("quick");
    }
  };
  const applyWatchHoldLong = (next: boolean) => {
    setWatchHoldLong(next);
    applyWatchKnobs(next);
  };

  const watchMintTrim = watchMint.trim();
  const watchMintValid = SOL_ADDR.test(watchMintTrim);
  const previewQuery = useQuery<{
    mint: string; symbol: string; name: string; priceUsd: number; liquidityUsd: number;
    volH1Usd: number; chgH1: number; chgH24: number; buysH1: number; sellsH1: number;
  }>({
    queryKey: ["/api/swing-bot/token-preview", watchMintTrim],
    enabled: botKind === "watch" && watchMintValid,
    retry: false,
    refetchInterval: 60_000,
  });

  // Hide-finished toggle — persisted so it survives refreshes. Finished =
  // stopped or completed; anything with funds still shows a balance inside
  // its card, so hiding never makes money invisible for good.
  const [showFinished, setShowFinished] = useState<boolean>(() => {
    try { return localStorage.getItem("swing.showFinished") !== "0"; } catch { return true; }
  });
  const toggleShowFinished = () => {
    setShowFinished((v) => {
      try { localStorage.setItem("swing.showFinished", v ? "0" : "1"); } catch {}
      return !v;
    });
  };

  // Guided flow after creating a live bot: jump the page straight to the new
  // bot's card so the user isn't left staring at the form wondering what's
  // next (the card itself then lights up the Fund → Start buttons in order).
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);

  const listQuery = useQuery<{ strategies: SwingStrategy[] }>({
    queryKey: ["/api/swing-bot/list", owner ?? "guest", owner ? readToken : guestToken],
    enabled: owner ? !!readToken : !!guestToken,
    refetchInterval: 15_000,
    queryFn: async () => {
      try {
        const res = await apiRequest(
          "GET",
          owner ? `/api/swing-bot/list?owner=${owner}` : "/api/swing-bot/list",
          undefined,
          owner ? { "x-swing-token": readToken! } : { "x-swing-guest": guestToken },
        );
        return res.json();
      } catch (e: any) {
        if (String(e?.message ?? "").startsWith("401")) forgetToken();
        throw e;
      }
    },
  });
  const canSee = owner ? !!readToken : !!guestToken;

  const defaultsQuery = useQuery<SwingDefaultPerformance>({
    queryKey: ["/api/swing-bot/performance/defaults"],
    staleTime: 5 * 60_000,
  });
  const stockCatalogQuery = useQuery<{
    assets: TokenizedStockAsset[];
    status?: {
      marketSession?: {
        state: "open" | "closed";
        nextOpenAt: string | null;
        timeZone: string;
      };
    };
  }>({
    queryKey: ["/api/tokenized-stocks", "swing-picker"],
    enabled: universe === "stocks",
    queryFn: async () => {
      const response = await fetch("/api/tokenized-stocks?sort=liquidity&pageSize=100");
      if (!response.ok) throw new Error("The verified stock list could not be loaded.");
      return response.json();
    },
    staleTime: 5 * 60_000,
  });
  const selectedStockQuery = useQuery<TokenizedStockAsset>({
    queryKey: ["/api/tokenized-stocks/verified", initialStockMint],
    enabled: universe === "stocks" && Boolean(initialStockMint),
    queryFn: async () => {
      const response = await fetch(`/api/tokenized-stocks/verified/${encodeURIComponent(initialStockMint)}`);
      if (!response.ok) throw new Error("That stock is not available for paper practice right now.");
      return response.json();
    },
    staleTime: 5 * 60_000,
  });
  const baseStockChoices = (stockCatalogQuery.data?.assets ?? []).filter((asset) =>
    asset.tradingStatus !== "halted" && asset.priceUsd != null && asset.priceUsd > 0);
  const stockChoices = selectedStockQuery.data && !baseStockChoices.some((asset) => asset.mint === selectedStockQuery.data!.mint)
    ? [selectedStockQuery.data, ...baseStockChoices]
    : baseStockChoices;
  useEffect(() => {
    if (universe === "stocks" && !selectedStockMint && stockChoices[0]) {
      setSelectedStockMint(stockChoices[0].mint);
    }
  }, [universe, selectedStockMint, stockChoices]);
  const [leaderboardTab, setLeaderboardTab] = useState<"bestWinRate" | "mostWins" | "mostProfitable">("bestWinRate");
  const appliedPerformanceDefaults = useRef(false);
  useEffect(() => {
    if (appliedPerformanceDefaults.current || !defaultsQuery.data?.recommendationAvailable) return;
    const rec = defaultsQuery.data.recommended;
    const x = rec.settings;
    appliedPerformanceDefaults.current = true;
    // Performance history may contain legacy single-style bots, but creation
    // now always uses the combined Smart mix.
    setStyle("quick");
    setMaxPositions(String(Math.max(2, Math.min(4, Number(x.maxPositions) || 3))));
    setPositionsTouched(true);
    setHotStreakFullSize(Boolean(x.hotStreakFullSize));
    setMinAgeChoice(String(Number(x.minPoolAgeHours) || 0));
    setRequireApproval(Boolean(x.requireApproval));
    setTakeProfitPct(x.takeProfitPct == null ? "" : String(x.takeProfitPct));
    setConservativeProfit(Boolean(x.conservativeProfit));
    setNeverSellAtLoss(Boolean(x.neverSellAtLoss));
    setRedEndBehavior(x.redEndBehavior === "send_tokens" ? "send_tokens" : "sell");
    setStopLossPct(String(Number(x.stopLossPct) || 4.5));
    setStopRoomPct(x.stopRoomPct == null ? null : Number(x.stopRoomPct));
    setSellOffCutEnabled(x.sellOffCutEnabled === true);
    setWinnerKeepPct(x.winnerKeepPct == null ? null : Number(x.winnerKeepPct));
    setProfitSkimPct(String(Number(x.profitSkimPct) || 0));
    setTrailArmPct(String(Number(x.trailArmPct) || 12));
    setTrailPct(String(Number(x.trailPct) || 8));
    setMinLiquidityUsd(String(Number(x.minLiquidityUsd) || 40000));
    setLossStopCount(String(Number(x.lossStopCount) || 4));
  }, [defaultsQuery.data]);

  const useSettingsForNewBot = (settings: Record<string, unknown>, sourceLabel: string) => {
    const stockSettings = settings.universe === "stocks";
    setUniverse(stockSettings ? "stocks" : "crypto");
    if (stockSettings) {
      setMode("paper");
      setStockBotKind(settings.botKind === "watch" ? "single" : "scan");
      setStockExitMode(settings.takeProfitPct == null ? "automatic" : "custom");
    } else {
      setBotKind(settings.botKind === "watch" ? "watch" : "scan");
      setStyle("quick");
    }
    setMaxPositions(String(Math.max(1, Math.min(10, Number(settings.maxPositions) || 3))));
    setPositionsTouched(true);
    setHotStreakFullSize(Boolean(settings.hotStreakFullSize));
    setMinAgeChoice(String(Number(settings.minPoolAgeHours) || 0));
    setRequireApproval(Boolean(settings.requireApproval));
    setTakeProfitPct(settings.takeProfitPct == null ? "" : String(settings.takeProfitPct));
    setConservativeProfit(Boolean(settings.conservativeProfit));
    setNeverSellAtLoss(Boolean(settings.neverSellAtLoss));
    setRedEndBehavior(settings.redEndBehavior === "send_tokens" ? "send_tokens" : "sell");
    setStopLossPct(String(Number(settings.stopLossPct) || (stockSettings ? 10 : 4.5)));
    setStopRoomPct(settings.stopRoomPct == null ? null : Number(settings.stopRoomPct));
    setSellOffCutEnabled(settings.sellOffCutEnabled === true);
    setWinnerKeepPct(settings.winnerKeepPct == null ? null : Number(settings.winnerKeepPct));
    setProfitSkimPct(String(Number(settings.profitSkimPct) || 0));
    setTrailArmPct(String(Number(settings.trailArmPct) || (stockSettings ? 10 : 12)));
    setTrailPct(String(Number(settings.trailPct) || 8));
    setMinLiquidityUsd(String(Number(settings.minLiquidityUsd) || 40000));
    setLossStopCount(String(Number(settings.lossStopCount) || 4));
    setShowAdvanced(true);
    requestAnimationFrame(() => {
      const builder = document.getElementById("swing-new-bot");
      const closedToggle = builder?.querySelector<HTMLButtonElement>('button[data-state="closed"]');
      if (closedToggle) closedToggle.click();
      requestAnimationFrame(() => builder?.scrollIntoView({ behavior: "smooth", block: "start" }));
    });
    toast({
      title: "Settings copied to a new bot",
      description: `${sourceLabel} is loaded into the setup form. Choose your own mode, bankroll, timer and token before creating it.`,
    });
  };

  const performanceQuery = useQuery<SwingPerformanceHistory>({
    queryKey: ["/api/swing-bot/performance/history", owner ?? "guest", owner ? readToken : guestToken],
    enabled: canSee,
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        owner ? `/api/swing-bot/performance/history?owner=${owner}` : "/api/swing-bot/performance/history",
        undefined,
        owner ? { "x-swing-token": readToken! } : { "x-swing-guest": guestToken },
      );
      return res.json();
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      if (mode === "live" && !owner) throw new Error("Connect your wallet to create a live bot. Paper mode is free to try without one.");
      if (mode === "live" && !signMessage) throw new Error("Your wallet can't sign messages — reconnect and try again.");
      const b = Number(budgetSol);
      if (!Number.isFinite(b) || b <= 0) throw new Error("Enter a budget in SOL.");
      if (b > 10) throw new Error("Deposits are capped at 10 SOL for now — profits are never capped.");

      const payload: any = {
        ownerWallet: owner ?? undefined,
        name: name.trim() || undefined,
        mode,
        universe,
        style: botKind === "scan" ? "quick" : style,
        budgetSol: b,
        windowHours,
        unlimitedWindow: unlimitedRun,
      };
      // These two live on the MAIN form now — always send them, regardless of
      // whether the Advanced panel was ever opened.
      payload.maxPositions = Math.round(Number(maxPositions)) || 3;
      // New bots keep one distinct token per slot. Adding more bankroll to a
      // running bot remains available as its own separate action.
      payload.allowStacking = false;
      payload.hotStreakFullSize = hotStreakFullSize;
      payload.profitSkimPct = Math.max(0, Math.min(100, Math.round(Number(profitSkimPct) || 0)));
      payload.stopRoomPct = stopRoomPct;
      payload.sellOffCutEnabled = sellOffCutEnabled;
      payload.winnerKeepPct = winnerKeepPct;
      if (universe === "stocks") {
        payload.mode = "paper";
        payload.manualBuy = false;
        payload.reentry = stockBotKind === "single";
        payload.maxPositions = stockBotKind === "single" ? 1 : Math.max(1, Math.min(10, Math.round(Number(maxPositions)) || 3));
        payload.allowStacking = false;
        payload.style = "ride";
        payload.stopLossPct = Math.max(3, Math.min(50, Number(stopLossPct) || 10));
        payload.trailArmPct = Math.max(5, Math.min(200, Number(trailArmPct) || 10));
        payload.trailPct = Math.max(5, Math.min(50, Number(trailPct) || 8));
        if (stockBotKind === "single") {
          const stock = stockChoices.find((asset) => asset.mint === selectedStockMint);
          if (!stock) throw new Error("Choose a verified stock first.");
          payload.targetMint = stock.mint;
          if (!name.trim()) payload.name = `${stock.underlyingTicker || stock.tokenSymbol} Paper Bot`;
        } else if (!name.trim()) {
          payload.name = "xStocks Momentum Bot";
        }
      } else if (botKind === "watch") {
        const m = watchMint.trim();
        if (!SOL_ADDR.test(m)) throw new Error("Paste the token's mint address first.");
        payload.targetMint = m;
        payload.manualBuy = watchManualBuy;
        payload.reentry = watchReentry;
        payload.maxPositions = 1;
        payload.allowStacking = false;
        // "Hold it long" rides the server's watch-long defaults by sending
        // style "ride"; otherwise the server applies tight babysit numbers.
        if (watchHoldLong) payload.style = "ride";
        else delete payload.style;
        // Let the server auto-name it "Watch SYMBOL" unless the user typed
        // their own name.
        if (!name.trim()) delete payload.name;
      }
      if (showAdvanced) {
        const tp = Number(takeProfitPct);
        if (takeProfitPct.trim() !== "" && Number.isFinite(tp) && tp >= 3) payload.takeProfitPct = Math.min(tp, 500);
        // Blank/invalid Advanced fields fall back to the defaults of the
        // CURRENT setup — watch mode must not inherit scan-style numbers.
        const watch = botKind === "watch" || universe === "stocks";
        payload.stopLossPct = Number(stopLossPct) || (watch ? 15 : style === "ride" ? 15 : style === "dip" ? 20 : style === "coil" ? 3 : 8);
        payload.trailArmPct = Number(trailArmPct) || (watch ? (watchHoldLong ? 60 : 15) : style === "ride" ? 60 : style === "dip" ? 40 : style === "coil" ? 10 : 12);
        payload.trailPct = Number(trailPct) || (watch ? (watchHoldLong ? 30 : 20) : style === "ride" ? 30 : style === "dip" ? 20 : style === "coil" ? 10 : 8);
        payload.minLiquidityUsd = Number(minLiquidityUsd) || 40000;
        payload.lossStopCount = Math.round(Number(lossStopCount)) || 4;
      }
      if (universe === "crypto" && botKind === "scan") {
        // Automatic scanner exits read the position's live volume, liquidity,
        // buyer/seller balance, and chart shape. A chosen percentage replaces
        // that adaptive loss room with the owner's explicit limit.
        payload.conservativeProfit = false;
        payload.neverSellAtLoss = neverSellAtLoss;
        payload.redEndBehavior = mode === "live" ? redEndBehavior : "sell";
        payload.rotateToRunners = true;
      } else {
        payload.neverSellAtLoss = neverSellAtLoss;
        payload.redEndBehavior = mode === "live" ? redEndBehavior : "sell";
      }
      if (universe === "crypto" && ((botKind === "scan" && style === "ride") || (botKind === "watch" && watchHoldLong))) payload.momentumCycle = momentumCycle;
      if ((universe === "crypto" && botKind === "scan") || (universe === "stocks" && stockBotKind === "scan")) payload.requireApproval = requireApproval;
      if (universe === "crypto" && botKind === "scan") payload.minPoolAgeHours = minAgeHoursValue();
      // Multi-wallet DCA: watch bots + Long ride only (server enforces the
      // same gate — other styles are always single-wallet).
      if (botKind === "watch" || (botKind === "scan" && style === "ride")) payload.subWalletCount = subWallets;
      let res: Response;
      if (!owner) {
        res = await apiRequest("POST", "/api/swing-bot/create", payload, { "x-swing-guest": guestToken });
      } else {
        if (!signMessage) throw new Error("Your wallet can't sign messages — reconnect and try again.");
        const nonce = Date.now();
        const createMsg = ["paif-swing", "v1", "create", owner, String(nonce)].join("|");
        const signature = bs58.encode(await signMessage(new TextEncoder().encode(createMsg)));
        res = await apiRequest("POST", "/api/swing-bot/create", { ...payload, nonce, signature });
      }
      return res.json();
    },
    onSuccess: (data: { fundingAddress: string; recommendedFundingSol: number; strategy: SwingStrategy }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/swing-bot/list"] });
      if (data.strategy.mode === "live") {
        setJustCreatedId(data.strategy.id);
        toast({
          title: "Live swing bot created",
          description: `Fund the worker wallet with ~${data.recommendedFundingSol.toFixed(3)} SOL, then press Start.`,
        });
      } else {
        const acceptedBudgetSol = Number(data.strategy.budgetLamports) / LAMPORTS_PER_SOL;
        const startingPaperCashSol = Number(data.strategy.paperBankrollLamports) / LAMPORTS_PER_SOL;
        toast(data.strategy.universe === "stocks"
          ? {
              title: "Stock practice bot running",
              description: `Accepted ${acceptedBudgetSol.toFixed(3)} virtual SOL; ${startingPaperCashSol.toFixed(3)} remains after the startup fee. No practice cash is spent until a stock is actually bought.`,
            }
          : { title: "Paper swing bot running", description: "It's hunting now — buys, sells, and reasons appear below." });
      }
    },
    onError: (e: any) => toast({ title: "Couldn't create bot", description: e.message, variant: "destructive" }),
  });

  const resetCreateBotSettings = () => {
    setMaxPositions(botKind === "scan" && style === "quick" ? "1" : String(suggestedPositions));
    setPositionsTouched(false);
    setHotStreakFullSize(false);
    setProfitSkimPct("50");
    setStopRoomPct(null);
    setSellOffCutEnabled(false);
    setWinnerKeepPct(null);
    setMinAgeChoice("24");
    setMinAgeCustom("");
    setRequireApproval(true);
    setMinLiquidityUsd("40000");
    setConservativeProfit(false);
    setTakeProfitPct("");
    setProfitTaking("auto");
    setNeverSellAtLoss(false);
    setRedEndBehavior("sell");
    setRotateToRunners(false);
    setMomentumCycle(false);
  };

  // Scroll to the just-created bot's card once it appears in the list.
  useEffect(() => {
    if (!justCreatedId) return;
    // Fallback: if the card never mounts (list fetch fails, etc), drop the
    // pending scroll after 30s so it can't fire on some much later render.
    const bail = setTimeout(() => setJustCreatedId(null), 30_000);
    const exists = (listQuery.data?.strategies ?? []).some((s) => s.id === justCreatedId);
    if (exists) {
      const el = document.querySelector(`[data-testid="card-bot-${justCreatedId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        setJustCreatedId(null);
      }
    }
    return () => clearTimeout(bail);
  }, [justCreatedId, listQuery.data]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-8 overflow-x-hidden">
        <div className="flex items-center gap-3 mb-2">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"><Waves className="w-5 h-5" /></div>
          <div><p className="font-mono text-[10px] uppercase tracking-[.16em] text-emerald-700 dark:text-emerald-300">Solana automation</p><h1 className="font-serif text-3xl font-bold tracking-tight md:text-4xl" data-testid="text-page-title">Swing Bot</h1></div>
        </div>
        <p className="text-muted-foreground w-full max-w-5xl mb-6">
          Choose a market or token, then run in paper mode or move to live SOL when you are comfortable.
        </p>

        {/* Honesty banner */}
        <CollapsibleCard
          title="Read this before going live"
          icon={<ShieldAlert className="w-5 h-5 shrink-0" />}
          defaultOpen={false}
          className="mb-6 border-amber-500/40 bg-amber-500/5"
          headerClassName="text-amber-700 dark:text-amber-300"
          contentClassName="px-6 pb-4 text-sm text-amber-700 dark:text-amber-300"
        >
              <ul className="list-disc pl-4 space-y-1">
                <li>The bot's "judgment" is a transparent rule set — momentum + accelerating volume to enter; stop-loss, trailing stop, volume-fade, and time-stop to exit, plus a <strong>rug-risk check before every buy</strong> (skips tokens whose liquidity isn't locked or where the dev can still freeze/mint) and a <strong>rug guard after</strong>: if the pool's liquidity collapses versus entry, it sells immediately for whatever is left. <strong>No rule set wins in every market.</strong> Choppy or bleeding markets will produce losses — and a fast rug can still outrun any bot.</li>
                <li>Every valuation uses a <strong>real Jupiter sell quote for your exact position size</strong> — price impact and fees are already in the numbers you see.</li>
                <li>Guardrails protect you: <strong>a stop-loss on every position</strong>, an automatic <strong>30-minute buying cool-off</strong> after consecutive losses (open positions stay protected; the run never quits on its own), and a 10 SOL deposit cap (profits are never capped — winnings compound freely).</li>
                <li><strong>You're never left stuck holding a token.</strong> Stop & withdraw sells everything; if a token can't be sold on any route, the tokens themselves are sent to your wallet instead.</li>
                 <li><strong>Platform fee — we earn when you earn:</strong> a one-time <strong>1.6% startup fee</strong> is deducted from the paper bankroll or collected when live trading starts. Profitable closes can also pay the locked rate on that winning round trip; losing trades pay no close fee, and no fee can turn a win into a loss.</li>
                <li><strong>Start in paper mode.</strong> Let it run a few days and judge the results before risking a single lamport.</li>
              </ul>
        </CollapsibleCard>

        <LoginModal open={connectOpen} onOpenChange={setConnectOpen} walletOnly />

        {owner && !readToken && (
          <Card>
            <CardContent className="py-10 text-center space-y-4">
              <p className="text-muted-foreground">Sign a quick message to unlock your swing bots. No transaction, no fee.</p>
              <Button onClick={unlock} disabled={unlocking} className="bg-black text-white hover:bg-black/90" data-testid="button-unlock">
                {unlocking ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Unlock with wallet
              </Button>
            </CardContent>
          </Card>
        )}

        {canSee && (
          <div className="grid lg:grid-cols-2 gap-6">
            {/* ─── Builder ─── */}
            <CollapsibleCard
              className="self-start"
              id="swing-new-bot"
              title="New swing bot"
              icon={<Plus className="w-5 h-5" />}
               description="Choose your setup, then tune the same bot settings you can edit while it runs."
              contentClassName="px-6 pb-6 space-y-4"
              persistKey="swing:new-bot-open"
            >
                <div>
                  <SettingHelp
                    title="Mode"
                    help={mode === "paper"
                      ? "Paper mode uses a virtual bankroll with real market quotes and does not risk SOL."
                      : "Live mode trades real SOL from a dedicated worker wallet. Deposits are capped at 10 SOL."}
                    testId="help-mode"
                  />
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => setMode("paper")}
                      className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm ${mode === "paper" ? "border-emerald-600 bg-emerald-600 text-white" : "border-border"}`}
                      data-testid="button-mode-paper"
                    >
                      <Beaker className="w-4 h-4" /> Paper
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMode("live");
                        setUniverse("crypto");
                      }}
                      className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm ${mode === "live" ? "border-emerald-600 bg-emerald-600 text-white" : "border-border"}`}
                      data-testid="button-mode-live"
                    >
                      <Zap className="w-4 h-4" /> Live
                    </button>
                  </div>
                </div>

                <div>
                  <SettingHelp
                    title="Market"
                    help="Solana crypto markets run 24 hours a day, 7 days a week, including weekends and holidays. Tokenized stocks follow U.S. stock-market hours."
                    testId="help-market"
                  />
                   <div className="mt-1 grid grid-cols-2 gap-2" role="group" aria-label="Trading market">
                     <button
                      type="button"
                      onClick={() => setUniverse("crypto")}
                      aria-pressed={universe === "crypto"}
                      className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-sm font-semibold transition-colors ${universe === "crypto" ? "border-emerald-600 bg-emerald-600 text-white" : "border-border hover:bg-muted"}`}
                      data-testid="button-universe-crypto"
                    >
                      <Activity className="h-4 w-4" /> Crypto
                     </button>
                    <button
                      type="button"
                       disabled={mode === "live"}
                      onClick={() => {
                        setUniverse("stocks");
                        setMode("paper");
                         setStockExitMode("automatic");
                        setStopLossPct("10");
                        setTrailArmPct("10");
                        setTrailPct("8");
                      }}
                      aria-pressed={universe === "stocks"}
                       title={mode === "live" ? "Tokenized Stocks are available in Paper mode only." : undefined}
                       className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-sm font-semibold transition-colors ${universe === "stocks" ? "border-emerald-600 bg-emerald-600 text-white" : "border-border hover:bg-muted"} ${mode === "live" ? "cursor-not-allowed opacity-50" : ""}`}
                      data-testid="button-universe-stocks"
                    >
                      <LineChart className="h-4 w-4" /> Tokenized Stocks
                    </button>
                  </div>
                   <p className="mt-1 text-xs text-muted-foreground">
                     {universe === "crypto"
                       ? `Crypto runs 24/7, including weekends and holidays. ${mode === "live" ? "Live mode is active for crypto." : "Paper and Live modes are available."}`
                       : "Tokenized Stocks are Paper mode only and follow U.S. stock-market hours."}
                   </p>
                </div>

                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
                  <SettingHelp
                    title={universe === "stocks" || mode === "paper" ? "Virtual paper bankroll (SOL)" : "Trading amount (SOL)"}
                    htmlFor="budget"
                    help={universe === "stocks"
                      ? "Practice money only. No SOL or real stock is purchased. This is the virtual starting bankroll used to show paper returns and profit."
                      : mode === "paper"
                        ? "Practice money only. No SOL is purchased. This gives bankroll return and profit figures a consistent starting point; win rate is based only on settled trades."
                        : "The maximum real SOL budget for this bot. Live funds move through its isolated worker wallet."}
                    testId="help-budget"
                  />
                  <Input
                    id="budget"
                    type="number"
                    step="0.1"
                    min="0.01"
                    max="10"
                    value={budgetSol}
                    onChange={(e) => setBudgetSol(e.target.value)}
                    placeholder="Enter amount up to 10 SOL"
                    data-testid="input-budget"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {universe === "stocks"
                      ? Number(budgetSol) > 0
                        ? `${Number(budgetSol).toFixed(3)} virtual SOL − ${(Number(budgetSol) * 0.016).toFixed(3)} startup fee = ${(Number(budgetSol) * 0.984).toFixed(3)} virtual SOL starting cash. No real SOL or stock is spent.`
                        : "Paper only — no real SOL or stock is spent."
                      : mode === "paper"
                        ? "Paper only — no real SOL is spent."
                        : "Up to 10 SOL for this live bot."}
                  </p>
                </div>

                {universe === "crypto" ? (
                  <>
                <div>
                  <SettingHelp
                    title="What should it trade?"
                    help={botKind === "scan"
                      ? "Hunt for me scans Solana and acts on qualifying setups."
                      : "Watch My Token lets you choose one token while the bot manages its entry and exit rules."}
                    testId="help-bot-kind"
                  />
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => applyBotKind("scan")}
                       className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${botKind === "scan" ? "border-emerald-600 bg-emerald-600 text-white" : "border-border hover:bg-muted"}`}
                      data-testid="button-kind-scan"
                    >
                      <Activity className="w-4 h-4" /> Hunt for me
                    </button>
                    <button
                      type="button"
                      onClick={() => applyBotKind("watch")}
                       className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${botKind === "watch" ? "border-emerald-600 bg-emerald-600 text-white" : "border-border hover:bg-muted"}`}
                      data-testid="button-kind-watch"
                    >
                      <LineChart className="w-4 h-4" /> Watch my token
                    </button>
                  </div>
                </div>

                {botKind === "watch" && (
                  <div>
                    <Label htmlFor="watchMint">Token address (mint)</Label>
                    <Input
                      id="watchMint"
                      value={watchMint}
                      onChange={(e) => setWatchMint(e.target.value)}
                      placeholder="Paste the token's mint address"
                      className="font-mono text-xs"
                      data-testid="input-watch-mint"
                    />
                    {watchMintTrim !== "" && !watchMintValid && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1" data-testid="text-watch-mint-invalid">That doesn't look like a Solana token address yet.</p>
                    )}
                    {previewQuery.isLoading && (
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Looking up the token…</p>
                    )}
                    {previewQuery.isError && watchMintValid && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1" data-testid="text-watch-preview-error">No live market found for that address — double-check it (copy the mint from the scanner or DexScreener).</p>
                    )}
                    {previewQuery.data && (
                      <div className="rounded-md border border-border p-2 mt-2 text-sm" data-testid="panel-watch-preview">
                        <p className="font-semibold">{previewQuery.data.symbol}{previewQuery.data.name ? ` — ${previewQuery.data.name}` : ""}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Price ${previewQuery.data.priceUsd < 0.01 ? previewQuery.data.priceUsd.toPrecision(3) : previewQuery.data.priceUsd.toFixed(4)} · Liquidity ${Math.round(previewQuery.data.liquidityUsd).toLocaleString()} · 1h vol ${Math.round(previewQuery.data.volH1Usd).toLocaleString()} · 1h {previewQuery.data.chgH1 >= 0 ? "+" : ""}{previewQuery.data.chgH1.toFixed(1)}% · {previewQuery.data.buysH1} buys / {previewQuery.data.sellsH1} sells (1h)
                        </p>
                      </div>
                    )}
                    <SettingHelp
                      title="Watch rules"
                      help={watchHoldLong
                        ? <>A <strong>15% stop-loss</strong> protects the entry. The profit lock arms at <strong>+60%</strong> and allows up to a 30% pullback from the peak. Buyer and seller pressure decides the exit.</>
                        : <>A <strong>15% stop-loss</strong> protects the entry. The profit lock arms at <strong>+15%</strong> and allows up to a 20% pullback from the peak. Seller pressure or fading volume can also trigger an exit.</>}
                      testId="help-watch-rules"
                    />
                    <div className="flex items-start justify-between gap-3 rounded-md border border-border p-2 mt-3 text-sm">
                      <div>
                        <SettingHelp
                          title="Hold it long"
                          help={watchHoldLong
                            ? "On: the profit lock waits for +60% and permits a 30% pullback from the peak while buyers remain in control."
                            : "Off: the profit lock arms at +15% and permits a 20% pullback from the peak for tighter protection."}
                          testId="help-watch-hold-long"
                        />
                      </div>
                      <Switch
                        checked={watchHoldLong}
                        onCheckedChange={applyWatchHoldLong}
                        data-testid="switch-watch-hold-long"
                      />
                    </div>

                    {watchHoldLong && (
                      <div
                        className="mt-2 flex items-start gap-2 cursor-pointer rounded-md border border-border p-2"
                        data-testid="label-momentum-cycle-watch"
                      >
                        <input
                          type="checkbox"
                          checked={momentumCycle}
                          onChange={(e) => setMomentumCycle(e.target.checked)}
                          className="mt-0.5"
                          aria-label="Sell the shift, re-buy the dip"
                          data-testid="checkbox-momentum-cycle-watch"
                        />
                        <span className="text-xs">
                          <SettingHelp
                            title="Sell the shift, re-buy the dip"
                            help="Banks gains when sellers take over the five-minute tape, then watches for buyers to return before re-entering. This can trade more often in choppy markets."
                            testId="help-watch-momentum-cycle"
                          />
                        </span>
                      </div>
                    )}

                    <div className="flex items-start justify-between gap-3 rounded-md border border-border p-2 mt-2 text-sm">
                      <div>
                        <SettingHelp
                          title="Wait for my signal to buy"
                          help={watchManualBuy
                            ? "The bot waits for you to press Buy now; after that it manages the exit."
                            : "When off, the bot buys automatically after it is funded and started."}
                          testId="help-watch-manual-buy"
                        />
                      </div>
                      <Switch
                        checked={watchManualBuy}
                        onCheckedChange={setWatchManualBuy}
                        data-testid="switch-manual-buy"
                      />
                    </div>

                    <div className="flex items-start justify-between gap-3 rounded-md border border-border p-2 mt-2 text-sm">
                      <div>
                        <SettingHelp
                          title="Buy back in on a comeback"
                          help={watchReentry
                            ? "After selling, the bot can re-enter when buyers clearly return. It is limited to three buys, a ten-minute cooldown, and two consecutive losses."
                            : "When off, the run completes after one buy and one sell."}
                          testId="help-watch-reentry"
                        />
                      </div>
                      <Switch
                        checked={watchReentry}
                        onCheckedChange={setWatchReentry}
                        data-testid="switch-reentry"
                      />
                    </div>
                  </div>
                )}

                {showAdvanced && <div>
                    <Label htmlFor="name">Name your bot <span className="font-normal text-muted-foreground">(optional)</span></Label>
                    <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name your bot" data-testid="input-name" />
                </div>}

                {botKind === "scan" && (
                  <>
                  {showAdvanced && botKind === "scan" && style === "ride" && (
                    <label
                      className="mt-3 flex items-start gap-2 cursor-pointer"
                      data-testid="label-momentum-cycle"
                    >
                      <input
                        type="checkbox"
                        checked={momentumCycle}
                        onChange={(e) => setMomentumCycle(e.target.checked)}
                        className="mt-0.5"
                        data-testid="checkbox-momentum-cycle"
                      />
                      <span className="text-xs">
                        <strong>Sell the shift, re-buy the dip</strong>
                        <span className="block text-[11px] text-muted-foreground mt-0.5">
                          Rides a winner through normal pullbacks, but the moment sellers flip the last-5-minute tape it banks the gain into strength — before a real drop, without waiting for a big sell-off. Then it keeps watching that same token and buys back in when buyers return, cycling it. Still keeps your wide long-hold protection — it does NOT add a tight loss cut. Heads-up: it trades more often, so in a choppy, sideways market the extra buy/sell fees can eat into gains — best when a token is genuinely trending.
                        </span>
                      </span>
                    </label>
                  )}
                  </>
                )}

                <div>
                  <SettingHelp
                    title="How long should the bot run?"
                    help={unlimitedRun
                      ? "Unlimited has no end date, and no separate holding-time limit. Market and safety exits still apply until you stop the bot."
                      : "This timer also sets the longest one trade may stay open. When it ends, positions close and live funds return to your wallet. You can change or remove it later."}
                    testId="help-run-window"
                  />
                  <div className="grid grid-cols-3 sm:grid-cols-7 gap-2 mt-1">
                    {WINDOW_PRESETS.map((p) => (
                      <button
                        key={p.hours}
                        type="button"
                        onClick={() => { setWindowHours(p.hours); setUnlimitedRun(false); }}
                        className={`rounded-md border px-2 py-2 text-xs ${!unlimitedRun && windowHours === p.hours ? "border-black bg-black text-white" : "border-border"}`}
                        data-testid={`button-window-${p.hours}`}
                      >
                        {p.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setUnlimitedRun(true)}
                      className={`rounded-md border px-2 py-2 text-xs ${unlimitedRun ? "border-black bg-black text-white" : "border-border"}`}
                      data-testid="button-window-unlimited"
                    >
                      Unlimited
                    </button>
                  </div>
                </div>

                {showAdvanced && (
                  <div className="rounded-md border border-border p-3 text-sm">
                    <SettingHelp
                      title="Set aside part of each win"
                      help={<>After a winning trade, this share of profit leaves the trading bankroll so it cannot be lost on the next trade. {mode === "live" ? "Live funds go to your withdrawal wallet." : "Paper mode tracks the amount virtually."}</>}
                      testId="help-profit-skim"
                    />
                    <div className="flex flex-wrap items-center gap-1 mt-2">
                      {PROFIT_SKIM_OPTIONS.map((pct) => (
                        <Button
                          key={pct}
                          type="button"
                          size="sm"
                          variant={Number(profitSkimPct) === pct ? "default" : "outline"}
                          className={`h-8 px-3 ${Number(profitSkimPct) === pct ? "bg-black text-white hover:bg-black/90" : ""}`}
                          onClick={() => setProfitSkimPct(String(pct))}
                          data-testid={`button-create-skim-${pct}`}
                        >
                          {pct}%{pct === 50 ? " (default)" : ""}
                        </Button>
                      ))}
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        placeholder="Custom %"
                        value={!PROFIT_SKIM_OPTIONS.includes(Number(profitSkimPct) as typeof PROFIT_SKIM_OPTIONS[number]) ? profitSkimPct : ""}
                        onChange={(e) => setProfitSkimPct(e.target.value)}
                        className="h-8 w-24 text-xs"
                        data-testid="input-create-skim-custom"
                      />
                    </div>
                  </div>
                )}

                {showAdvanced && (botKind === "watch" || (botKind === "scan" && style === "ride")) && (
                <div>
                  <SettingHelp
                     title="How many smaller buys should it use?"
                    help={subWallets === 1
                      ? "One wallet buys and sells the whole budget in one transaction sequence."
                      : `One deposit is spread across ${subWallets} wallets and entered in steps to reduce reliance on one entry price. Emergency exits still close at once.`}
                    testId="help-trading-wallets"
                  />
                  <div className="grid grid-cols-5 gap-2 mt-1">
                    {[1, 5, 10, 15, 20, 25].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => { setCustomWallets(false); setSubWallets(n); }}
                        className={`rounded-md border px-2 py-2 text-xs ${!customWallets && subWallets === n ? "border-black bg-black text-white" : "border-border"}`}
                        data-testid={`button-sub-wallets-${n}`}
                      >
                        {n}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setCustomWallets(true)}
                      className={`rounded-md border px-2 py-2 text-xs ${customWallets ? "border-black bg-black text-white" : "border-border"}`}
                      data-testid="button-sub-wallets-custom"
                    >
                      Custom
                    </button>
                  </div>
                  {customWallets && (
                    <div className="mt-2">
                      <Input
                        type="number"
                        min={1}
                        max={25}
                        value={subWallets}
                        onChange={(e) => setSubWallets(Math.max(1, Math.min(25, Math.floor(Number(e.target.value) || 1))))}
                        className="w-24"
                        data-testid="input-sub-wallets-custom"
                      />
                      <p className="text-xs text-muted-foreground mt-1">Type any number of wallets from 1 to 25.</p>
                    </div>
                  )}
                </div>
                )}

                {showAdvanced && botKind === "scan" && (
                <div>
                  <SettingHelp
                    title="How many tokens can it hold at once?"
                    help="More positions create smaller slices and spread exposure across more picks. Fewer positions place more of the budget in each pick."
                    testId="help-max-positions"
                  />
                  <div className="grid grid-cols-5 gap-2 mt-1">
                    {POSITION_OPTIONS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => { setPositionsTouched(true); setMaxPositions(String(n)); }}
                        className={`relative rounded-md border px-2 py-2 text-xs ${Math.round(Number(maxPositions)) === n ? "border-black bg-black text-white" : "border-border"}`}
                        data-testid={`button-max-positions-${n}`}
                      >
                        {n}
                        {n === suggestedPositions && (
                          <span className={`absolute -top-1.5 left-1/2 -translate-x-1/2 rounded-full px-1 text-[8px] leading-3 ${Math.round(Number(maxPositions)) === n ? "bg-black text-white border border-white/40" : "bg-muted text-muted-foreground border border-border"}`}>
                            pick
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                  {(() => {
                    const b = Number(budgetSol);
                    const slots = Math.round(Number(maxPositions)) || 3;
                    if (b > 0 && slots > 0 && b / slots < 0.002) {
                      return (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1" data-testid="text-max-positions-warning">
                          With {b} SOL split {slots} ways, each slice is under the 0.002 SOL minimum trade — the bot won't open new positions. Use fewer positions or a bigger budget.
                        </p>
                      );
                    }
                    return (
                      <p className="text-xs text-muted-foreground mt-1" data-testid="text-positions-guidance">
                        {b > 0 && slots > 0 ? (
                          <>
                            For {b} SOL we suggest <strong>{suggestedPositions} position{suggestedPositions === 1 ? "" : "s"}</strong> (~{(b / suggestedPositions).toFixed(3)} SOL each){slots !== suggestedPositions ? ` — you've picked ${slots} (~${(b / slots).toFixed(3)} SOL each)` : ""}. More positions = smaller slices, more spread-out risk. Fewer = bigger bets on the bot's top picks.
                          </>
                        ) : (
                          <>More positions = smaller slices, more spread-out risk. Fewer = bigger bets on the bot's top picks.</>
                        )}
                      </p>
                    );
                  })()}
                </div>
                )}

                 {showAdvanced && botKind === "scan" && (
                 <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
                   <div>
                     <SettingHelp
                       title="Ask me first before buying"
                       htmlFor="requireApproval"
                       help="When enabled, the bot still finds and scores candidates but waits for you to approve or dismiss each new buy."
                       testId="help-require-approval"
                     />
                   </div>
                   <Switch id="requireApproval" checked={requireApproval} onCheckedChange={setRequireApproval} data-testid="switch-require-approval" />
                 </div>
                 )}

                 {showAdvanced && botKind === "scan" && (
                 <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3 text-sm">
                   <div>
                      <SettingHelp
                        title="Use the full amount on tokens already rising fast"
                        htmlFor="hotStreakFullSize"
                        help="Safer default: the bot uses only one quarter of the normal amount when a token has already climbed quickly. Turn this on to use the full amount and accept a much larger loss if the rise suddenly reverses."
                        testId="help-hot-run-size"
                      />
                   </div>
                   <Switch id="hotStreakFullSize" checked={hotStreakFullSize} onCheckedChange={setHotStreakFullSize} data-testid="switch-hot-run-full-size" />
                 </div>
                 )}

                {showAdvanced && botKind === "scan" && (
                <div className="rounded-md border border-border p-3">
                   <Label className="mb-1 block">Token age</Label>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {MIN_AGE_PRESETS.map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => setMinAgeChoice(p.value)}
                        className={`rounded-md border px-2 py-1.5 text-xs ${minAgeChoice === p.value ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground"}`}
                        data-testid={`button-min-age-${p.value}`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  {minAgeChoice === "custom" && (
                    <div className="flex items-center gap-2 mt-2">
                      <Input
                        type="number"
                        min={0}
                        max={720}
                        value={minAgeCustom}
                        onChange={(e) => setMinAgeCustom(e.target.value)}
                        placeholder="hours (0–720)"
                        className="w-40"
                        data-testid="input-min-age-custom"
                      />
                      <span className="text-xs text-muted-foreground">hours (720 = 30 days)</span>
                    </div>
                  )}
                </div>
                )}

                {botKind === "scan" && (
                  <div>
                    <SettingHelp
                      title="Liquidity pools"
                      help={<>This is the minimum amount available in the market for people to buy and sell. More pool money usually makes it easier to sell near the price shown. Less pool money finds more tokens, but prices can move sharply and exits can be harder. $40K+ is the default.</>}
                      testId="help-liquidity-pools"
                    />
                    <div className="grid grid-cols-2 gap-2 mt-1">
                      {LIQUIDITY_OPTIONS.map((p) => (
                        <button
                          key={p.value}
                          type="button"
                          onClick={() => setMinLiquidityUsd(String(p.value))}
                          className={`rounded-md border px-2 py-2 text-xs ${Number(minLiquidityUsd) === p.value ? "border-black bg-black text-white" : "border-border"}`}
                          data-testid={`button-careful-${p.value}`}
                        >
                          <span className="block font-semibold">{p.label}{p.recommended ? " · Default" : ""}</span>
                        </button>
                      ))}
                    </div>
                    <Input
                      type="number"
                      min="5000"
                      max="1000000"
                      step="1000"
                      placeholder="Custom $ (5,000–1,000,000)"
                      value={LIQUIDITY_OPTIONS.some((p) => p.value === Number(minLiquidityUsd)) ? "" : minLiquidityUsd}
                      onChange={(event) => setMinLiquidityUsd(event.target.value)}
                      className="mt-2 h-8 text-xs"
                      data-testid="input-create-liquidity-custom"
                    />
                  </div>
                )}

                {!showAdvanced && (
                  <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3" data-testid="new-bot-summary">
                    <p className="text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Your setup</p>
                    <p className="mt-1 text-sm font-semibold">
                  {botKind === "scan" ? "Scanner" : STYLE_LABEL[style]} · ${Math.round(Number(minLiquidityUsd) / 1000)}K+ pools · {botKind === "scan" ? `${maxPositions} tokens at once` : "one chosen token"} · {unlimitedRun ? "Unlimited" : WINDOW_PRESETS.find((p) => p.hours === windowHours)?.label}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">Automatic profit protection is on. You can start now or inspect every rule first.</p>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <button
                    type="button"
                    className="flex items-center gap-1 text-sm text-muted-foreground"
                    onClick={() => setShowAdvanced((v) => !v)}
                    data-testid="button-toggle-advanced"
                  >
                    {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                     Optional bot controls
                  </button>
                </div>

                  {showAdvanced && (
                    <div className="space-y-3 rounded-md border border-border p-3 bg-muted/30" data-testid="panel-create-bot-settings">
                     <div className="flex items-center justify-between gap-2">
                       <div>
                           <SettingHelp title="Optional controls" help="Automatic mode banks a real executable +3% on quick scanner trades, then keeps watching that token for a confirmed re-entry. It also adjusts loss protection using the trade's price movement, volume, and buyer activity. Change these only if you want to override that behavior." testId="help-exact-bot-settings" />
                       </div>
                       <Button
                         type="button"
                         size="sm"
                         variant="outline"
                         className="h-8 shrink-0 text-xs"
                         onClick={resetCreateBotSettings}
                         data-testid="button-create-reset-settings"
                       >
                          Use automatic settings
                       </Button>
                     </div>
                      {botKind !== "scan" && <div>
                        <SettingHelp title="Sell after reaching this profit" help="Example: 10% tells the bot to sell when a trade reaches about 10% profit. Automatic uses price movement and buyer activity instead." testId="help-take-profit-target" />
                       <div className="flex flex-wrap items-center gap-1 mt-2">
                         {[
                            { value: null, label: "Automatic" },
                           { value: 5, label: "5%" },
                           { value: 10, label: "10%" },
                           { value: 20, label: "20%" },
                         ].map((p) => (
                           <Button
                             key={p.label}
                             type="button"
                             size="sm"
                             variant={(p.value === null ? takeProfitPct === "" : Number(takeProfitPct) === p.value) ? "default" : "outline"}
                             className={`h-8 px-3 ${(p.value === null ? takeProfitPct === "" : Number(takeProfitPct) === p.value) ? "bg-black text-white hover:bg-black/90" : ""}`}
                             onClick={() => setTakeProfitPct(p.value === null ? "" : String(p.value))}
                             data-testid={`button-create-take-profit-${p.value ?? "off"}`}
                           >
                             {p.label}
                           </Button>
                         ))}
                          <div className="relative w-24">
                            <Input
                              id="takeProfit"
                              type="number"
                              min="3"
                              max="500"
                              placeholder="Custom"
                              value={[5, 10, 20].includes(Number(takeProfitPct)) ? "" : takeProfitPct}
                              onChange={(e) => setTakeProfitPct(e.target.value)}
                              className="h-8 pr-7 text-xs"
                              data-testid="input-take-profit"
                            />
                            <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs font-bold text-muted-foreground">%</span>
                          </div>
                       </div>
                      </div>}
                     {botKind === "scan" && style === "quick" && (
                       <div className="space-y-3 rounded-md border border-border p-3">
                          <div>
                            <SettingHelp title="When should it bank a profit?" help="Automatic usually banks a real executable +3% when the rise is no longer clearly continuing. Choose your own percentage to sell immediately when the executable profit reaches that target." testId="help-small-win-target" />
                            <div className="mt-2 flex flex-wrap items-center gap-1">
                              {[
                                { value: "", label: "Automatic" },
                                { value: "3", label: "+3%" },
                                { value: "5", label: "+5%" },
                                { value: "10", label: "+10%" },
                              ].map((option) => (
                                <Button
                                  key={option.label}
                                  type="button"
                                  size="sm"
                                  variant={takeProfitPct === option.value ? "default" : "outline"}
                                  className={`h-8 px-3 ${takeProfitPct === option.value ? "bg-black text-white hover:bg-black/90" : ""}`}
                                  onClick={() => {
                                    setTakeProfitPct(option.value);
                                    if (option.value !== "" && winnerKeepPct === 40) setWinnerKeepPct(null);
                                  }}
                                  data-testid={`button-create-small-win-${option.value || "automatic"}`}
                                >
                                  {option.label}
                                </Button>
                              ))}
                              <div className="relative w-28">
                                <Input
                                  type="number"
                                  min="3"
                                  max="500"
                                  step="1"
                                  placeholder="Custom"
                                  value={["", "3", "5", "10"].includes(takeProfitPct) ? "" : takeProfitPct}
                                  onChange={(e) => {
                                    setTakeProfitPct(e.target.value);
                                    if (e.target.value !== "" && winnerKeepPct === 40) setWinnerKeepPct(null);
                                  }}
                                  className="h-8 pr-7 text-xs"
                                  data-testid="input-create-small-win-custom"
                                />
                                <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs font-bold text-muted-foreground">%</span>
                              </div>
                            </div>
                          </div>
                         <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm" data-testid="automatic-small-win-plan">
                            <strong>{winnerKeepPct === 40 ? "Runner mode" : takeProfitPct === "" ? "Automatic small-win plan" : `Your +${takeProfitPct}% profit target`}</strong>
                           <p className="mt-1 text-xs text-muted-foreground">
                              {winnerKeepPct === 40
                                ? "The routine +3% small-win sale is off. The bot gives a winner its widest room to develop, while confirmed reversals, liquidity danger, and loss protection still apply."
                                : takeProfitPct === ""
                                ? "The bot banks a real +3% sell quote unless fresh short-term and hourly signals clearly keep rising. Strong continuation can run; when that signal fades, it banks the gain before risking a loss, then watches the token for six hours before any re-entry."
                                : `The bot sells when a real executable quote reaches +${takeProfitPct}%. This fixed target overrides the automatic small-win timing.`}
                           </p>
                         </div>
                         <div>
                            <SettingHelp title="How far may a trade fall?" help="Automatic protection adjusts to this trade's own behavior. It starts cautious, gives a proven climber more breathing room, and still exits when the evidence turns bad. A fixed percentage overrides that adjustment." testId="help-stop-room" />
                         <div className="flex flex-wrap gap-1 mt-2">
                            {STOP_ROOM_OPTIONS.map((p) => (
                             <Button
                               key={p.label}
                               type="button"
                               size="sm"
                               variant={stopRoomPct === p.value ? "default" : "outline"}
                               className={`h-8 px-3 ${stopRoomPct === p.value ? "bg-black text-white hover:bg-black/90" : ""}`}
                                onClick={() => {
                                  setStopRoomPct(p.value);
                                  if (p.value !== null) setConservativeProfit(false);
                                }}
                               data-testid={`button-create-stop-room-${p.value ?? "smart"}`}
                             >
                               <span className="block font-semibold">{p.label}</span>
                               <span className="block opacity-70">{p.detail}</span>
                             </Button>
                            ))}
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                min="2"
                                max="50"
                                step="1"
                                placeholder="Custom %"
                                value={createCustomStopRoom}
                                onChange={(e) => setCreateCustomStopRoom(e.target.value)}
                                className="h-8 w-24 text-xs"
                                data-testid="input-create-stop-room-custom"
                              />
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 px-2 text-xs"
                                disabled={createCustomStopRoom.trim() === "" || !Number.isFinite(Number(createCustomStopRoom)) || Number(createCustomStopRoom) < 2 || Number(createCustomStopRoom) > 50}
                                onClick={() => { setStopRoomPct(Math.round(Number(createCustomStopRoom))); setConservativeProfit(false); setCreateCustomStopRoom(""); }}
                                data-testid="button-create-stop-room-custom"
                              >
                                Set
                              </Button>
                            </div>
                          </div>
                          </div>
                       </div>
                     )}
                     {botKind === "scan" && style === "quick" && (
                       <div className="rounded-md border border-border p-3">
                            <SettingHelp title="How much of the best gain should it keep?" help="If a trade rises and then falls, this sets how much of its best gain the bot protects. Automatic adjusts to the strength of each token instead of forcing one percentage on every move." testId="help-winner-protection" />
                          <div className="flex flex-wrap gap-1 mt-2">
                            {WINNER_KEEP_OPTIONS.map((p) => (
                             <Button
                               key={p.label}
                               type="button"
                               size="sm"
                               variant={winnerKeepPct === p.value ? "default" : "outline"}
                               className={`h-8 px-3 ${winnerKeepPct === p.value ? "bg-black text-white hover:bg-black/90" : ""}`}
                                onClick={() => {
                                  setWinnerKeepPct(p.value);
                                  if (p.value === 40) setTakeProfitPct("");
                                }}
                               data-testid={`button-create-winner-room-${p.value ?? "smart"}`}
                             >
                               <span className="block font-semibold">{p.label}</span>
                               <span className="block opacity-70">{p.detail}</span>
                             </Button>
                            ))}
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                min="40"
                                max="90"
                                step="1"
                                placeholder="Custom %"
                                value={createCustomWinnerKeep}
                                onChange={(e) => setCreateCustomWinnerKeep(e.target.value)}
                                className="h-8 w-24 text-xs"
                                data-testid="input-create-winner-room-custom"
                              />
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 px-2 text-xs"
                                disabled={createCustomWinnerKeep.trim() === "" || !Number.isFinite(Number(createCustomWinnerKeep)) || Number(createCustomWinnerKeep) < 40 || Number(createCustomWinnerKeep) > 90}
                                onClick={() => {
                                  const keep = Math.round(Number(createCustomWinnerKeep));
                                  setWinnerKeepPct(keep);
                                  if (keep === 40) setTakeProfitPct("");
                                  setCreateCustomWinnerKeep("");
                                }}
                                data-testid="button-create-winner-room-custom"
                              >
                                Set
                              </Button>
                            </div>
                          </div>
                        </div>
                       )}
                       <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
                         <div>
                           <SettingHelp
                             title="Never sell at a loss — recovery hold"
                             help="Keeps an ordinary red trade open to give it time to recover. It can still sell at the firm −12% emergency limit, if liquidity collapses, or when both short-term and hourly evidence confirm the decline is continuing."
                             testId="help-create-never-sell-loss"
                           />
                         </div>
                         <Switch
                           checked={neverSellAtLoss}
                           onCheckedChange={setNeverSellAtLoss}
                           data-testid="switch-create-never-sell-loss"
                         />
                       </div>
                      {mode === "live" && (
                        <div className="rounded-md border border-border p-3">
                          <SettingHelp
                            title="When the bot expires"
                            help="Choose what happens to a token that is still below what you paid when the run ends. Winning positions are sold and their SOL is returned either way."
                            testId="help-red-end-behavior"
                          />
                          <div className="flex flex-wrap gap-1 mt-2">
                            {[
                              { value: "sell" as const, label: "Sell all tokens" },
                              { value: "send_tokens" as const, label: "Send losing tokens to my wallet" },
                            ].map((p) => (
                              <Button
                                key={p.value}
                                type="button"
                                size="sm"
                                variant={redEndBehavior === p.value ? "default" : "outline"}
                                className={`h-8 px-3 ${redEndBehavior === p.value ? "bg-black text-white hover:bg-black/90" : ""}`}
                                onClick={() => setRedEndBehavior(p.value)}
                                data-testid={`button-red-end-${p.value}`}
                              >
                                {p.label}
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}
                     {botKind !== "scan" && <>
                     <div>
                       <SettingHelp title="How much loss is too much?" htmlFor="stopLoss" help="Example: choose 10%. If $10 falls near $9, the bot tries to sell so the loss does not keep growing." testId="help-stop-loss" />
                       <div className="relative mt-1">
                          <Input id="stopLoss" type="number" min="3" max="50" value={stopLossPct} onChange={(e) => setStopLossPct(e.target.value)} className="pr-9" data-testid="input-stop-loss" />
                          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-bold text-muted-foreground">%</span>
                       </div>
                    </div>
                    <div>
                         <SettingHelp title="When should it protect a win?" htmlFor="trailArm" help="Choose 10% and the bot starts protecting profit after the trade is up 10%." testId="help-trail-arm" />
                       <div className="relative mt-1">
                          <Input id="trailArm" type="number" min="5" max="200" value={trailArmPct} onChange={(e) => setTrailArmPct(e.target.value)} className="pr-9" data-testid="input-trail-arm" />
                          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-bold text-muted-foreground">%</span>
                       </div>
                    </div>
                    <div>
                         <SettingHelp title="How far can a winner fall?" htmlFor="trail" help="After profit protection starts, this is how far the trade may fall from its best price before the bot sells. Smaller means protect the win sooner." testId="help-trail-giveback" />
                       <div className="relative mt-1">
                          <Input id="trail" type="number" min="5" max="50" value={trailPct} onChange={(e) => setTrailPct(e.target.value)} className="pr-9" data-testid="input-trail" />
                          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-bold text-muted-foreground">%</span>
                       </div>
                    </div>
                     </>}
                    <div>
                       <SettingHelp title="Pause buying after this many losses" htmlFor="lossStop" help="After this many losing trades in a row, the bot waits 30 minutes before buying again. It keeps protecting trades already open, and the bot does not shut down." testId="help-loss-cooloff" />
                        <div className="mt-2 flex flex-wrap items-center gap-1">
                          {LOSS_COOLDOWN_OPTIONS.map((count) => (
                            <Button
                              key={count}
                              type="button"
                              size="sm"
                              variant={Number(lossStopCount) === count ? "default" : "outline"}
                              className={`h-8 px-3 ${Number(lossStopCount) === count ? "bg-black text-white hover:bg-black/90" : ""}`}
                              onClick={() => setLossStopCount(String(count))}
                              data-testid={`button-create-loss-cooldown-${count}`}
                            >
                              {count}{count === 4 ? " (default)" : ""}
                            </Button>
                          ))}
                          <Input
                            id="lossStop"
                            type="number"
                            min="1"
                            max="20"
                            value={LOSS_COOLDOWN_OPTIONS.includes(Number(lossStopCount) as typeof LOSS_COOLDOWN_OPTIONS[number]) ? "" : lossStopCount}
                            onChange={(event) => setLossStopCount(event.target.value)}
                            placeholder="Custom"
                            className="h-8 w-24 text-xs"
                            data-testid="input-loss-stop"
                          />
                       </div>
                    </div>
                  </div>
                )}

                <Button
                  onClick={() => createMut.mutate()}
                  disabled={createMut.isPending}
                   className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
                  data-testid="button-create"
                >
                  {createMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  {botKind === "watch"
                    ? (mode === "live" ? "Create live watch bot" : "Start paper watch")
                    : (mode === "live" ? "Create live bot" : "Start paper bot")}
                </Button>
                 <div className="sticky bottom-3 z-20 -mx-2 mt-3 rounded-xl border border-emerald-500/30 bg-background/95 p-2 backdrop-blur md:hidden">
                   <Button
                     onClick={() => createMut.mutate()}
                     disabled={createMut.isPending}
                     className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
                     data-testid="button-create-sticky"
                   >
                     {createMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                     {mode === "live" ? "Create live bot" : "Start paper bot"}
                   </Button>
                 </div>
                  </>
                ) : (
                  <div className="space-y-4" data-testid="panel-tokenized-stocks-setup">
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
                      <div className="flex items-center gap-2">
                        <Badge className="bg-emerald-600 text-white">Paper only</Badge>
                        <span className="text-sm font-semibold">Tokenized Stocks Swing Bot</span>
                       </div>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Practice with pretend money using real market prices. You do not buy a real stock or spend real SOL.
                      </p>
                    </div>

                    {stockCatalogQuery.data?.status?.marketSession && (
                      <div
                        className={`rounded-md border p-3 text-sm ${
                          stockCatalogQuery.data.status.marketSession.state === "open"
                            ? "border-emerald-500/40 bg-emerald-500/5"
                            : "border-amber-500/40 bg-amber-500/5"
                        }`}
                        data-testid="stock-market-session"
                      >
                        <strong>
                          U.S. market {stockCatalogQuery.data.status.marketSession.state === "open" ? "open" : "closed"}
                        </strong>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {stockCatalogQuery.data.status.marketSession.state === "open"
                            ? "The bot uses fresh market data before every paper entry."
                            : `You can set the bot up now. Automatic scans may plan from the final closing snapshot, but no paper cash is spent until a fresh opening check${stockCatalogQuery.data.status.marketSession.nextOpenAt ? ` after ${new Date(stockCatalogQuery.data.status.marketSession.nextOpenAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}. “Ask me first” and one-stock bots wait for the market to reopen.`}
                        </p>
                      </div>
                    )}

                    <div>
                      <Label htmlFor="stock-name">Name your bot <span className="font-normal text-muted-foreground">(optional)</span></Label>
                      <Input
                        id="stock-name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder={stockBotKind === "scan" ? "xStocks Momentum Bot" : "My stock paper bot"}
                        data-testid="input-stock-name"
                      />
                    </div>

                    <div>
                      <SettingHelp
                        title="How long should the bot run?"
                        help={unlimitedRun
                          ? "Unlimited has no end date. Market-hour and safety rules still apply until you stop the bot."
                          : "The timer controls how long this paper bot keeps scanning or watching. Closed-market waiting time still counts, so choose Unlimited if you do not want a weekend or holiday to use up the run."}
                        testId="help-stock-run-window"
                      />
                      <div className="mt-2 grid grid-cols-3 sm:grid-cols-7 gap-2">
                        {WINDOW_PRESETS.map((preset) => (
                          <button
                            key={preset.hours}
                            type="button"
                            onClick={() => { setWindowHours(preset.hours); setUnlimitedRun(false); }}
                            className={`rounded-md border px-2 py-2 text-xs ${!unlimitedRun && windowHours === preset.hours ? "border-black bg-black text-white" : "border-border"}`}
                            data-testid={`button-stock-window-${preset.hours}`}
                          >
                            {preset.label}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => setUnlimitedRun(true)}
                          className={`rounded-md border px-2 py-2 text-xs ${unlimitedRun ? "border-black bg-black text-white" : "border-border"}`}
                          data-testid="button-stock-window-unlimited"
                        >
                          Unlimited
                        </button>
                      </div>
                    </div>

                    <div>
                      <SettingHelp
                        title="What should the bot watch?"
                        help="Let it compare the verified xStocks list and pick the strongest steady mover, or choose one stock yourself."
                        testId="help-stock-bot-kind"
                      />
                      <div className="mt-1 grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => setStockBotKind("scan")} className={`rounded-md border p-3 text-left text-sm ${stockBotKind === "scan" ? "border-emerald-600 bg-emerald-500/10" : "border-border"}`} data-testid="button-stock-scan">
                          <strong className="block">Scan xStocks</strong>
                          <span className="mt-1 block text-xs text-muted-foreground">Find momentum across verified xStocks</span>
                        </button>
                        <button type="button" onClick={() => setStockBotKind("single")} className={`rounded-md border p-3 text-left text-sm ${stockBotKind === "single" ? "border-emerald-600 bg-emerald-500/10" : "border-border"}`} data-testid="button-stock-single">
                          <strong className="block">One xStock</strong>
                          <span className="mt-1 block text-xs text-muted-foreground">You choose which one</span>
                        </button>
                      </div>
                    </div>

                    {stockBotKind === "single" && <div>
                      <SettingHelp
                        title="Which stock should the bot practice with?"
                        help="Pick one stock from our verified list. Verified means we checked that its Solana token address came from the issuer—not from a random person."
                        testId="help-stock-picker"
                      />
                      {stockCatalogQuery.isLoading ? (
                        <div className="mt-1 flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" /> Loading the verified stock list…
                        </div>
                      ) : stockChoices.length > 0 ? (
                        <>
                          <select
                            value={selectedStockMint}
                            onChange={(event) => setSelectedStockMint(event.target.value)}
                            className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                            data-testid="select-stock-paper-asset"
                          >
                            {stockChoices.map((asset) => (
                              <option key={asset.mint} value={asset.mint}>
                                {asset.underlyingTicker || asset.tokenSymbol} — {asset.name} · ${asset.priceUsd?.toLocaleString()}
                              </option>
                            ))}
                          </select>
                          {(() => {
                            const stock = stockChoices.find((asset) => asset.mint === selectedStockMint);
                            return stock ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {stock.issuer} verified · About ${stock.priceUsd?.toLocaleString()} per token
                                {stock.marketDataStale ? " · The displayed catalog price may be delayed; the bot checks the market again before acting." : ""}
                              </p>
                            ) : null;
                          })()}
                        </>
                      ) : (
                        <p className="mt-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300">
                          No verified stocks with a usable price are available right now. Try Refresh on the Tokenized Stocks page.
                        </p>
                      )}
                    </div>}

                    {stockBotKind === "scan" && (
                      <>
                        <div className="rounded-md border border-border p-3">
                          <SettingHelp
                            title="How many stocks can it hold at once?"
                            help="More positions spread the pretend bankroll across more picks. Fewer positions put a larger paper amount behind each qualifying stock."
                            testId="help-stock-max-positions"
                          />
                          <div className="mt-2 grid grid-cols-5 gap-2">
                            {POSITION_OPTIONS.map((count) => (
                              <button
                                key={count}
                                type="button"
                                onClick={() => { setPositionsTouched(true); setMaxPositions(String(count)); }}
                                className={`rounded-md border px-2 py-2 text-xs ${Number(maxPositions) === count ? "border-black bg-black text-white" : "border-border"}`}
                                data-testid={`button-stock-positions-${count}`}
                              >
                                {count}
                              </button>
                            ))}
                          </div>
                          {Number(budgetSol) > 0 && Number(maxPositions) > 0 && (
                            <p className="mt-2 text-xs text-muted-foreground" data-testid="stock-position-size-preview">
                              About {(Number(budgetSol) / Number(maxPositions)).toFixed(2)} virtual SOL per position before simulated fees, if all {maxPositions} slots fill.
                            </p>
                          )}
                        </div>

                        <div className="rounded-md border border-border p-3">
                          <SettingHelp
                            title="How should it buy?"
                            help="Automatic buys a qualifying paper setup after checking fresh market data. Ask me first finds the same setup but waits for your approval."
                            testId="help-stock-approval"
                          />
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setRequireApproval(false)}
                              className={`rounded-md border p-3 text-left text-sm ${!requireApproval ? "border-black bg-black text-white" : "border-border"}`}
                              data-testid="button-stock-buy-automatic"
                            >
                              <strong className="block">Automatic</strong>
                              <span className="mt-1 block text-xs opacity-70">Buy when every check passes</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setRequireApproval(true)}
                              className={`rounded-md border p-3 text-left text-sm ${requireApproval ? "border-black bg-black text-white" : "border-border"}`}
                              data-testid="button-stock-buy-approval"
                            >
                              <strong className="block">Ask me first</strong>
                              <span className="mt-1 block text-xs opacity-70">Wait for my approval</span>
                            </button>
                          </div>
                        </div>

                        <div className="rounded-md border border-border p-3">
                          <SettingHelp
                            title="Minimum token liquidity"
                            help="The stock itself is verified, but its token market still needs enough liquidity for a useful paper fill. The same $40K default used by the crypto paper scanner applies."
                            testId="help-stock-liquidity"
                          />
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            {LIQUIDITY_OPTIONS.map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => setMinLiquidityUsd(String(option.value))}
                                className={`rounded-md border px-2 py-2 text-xs ${Number(minLiquidityUsd) === option.value ? "border-black bg-black text-white" : "border-border"}`}
                                data-testid={`button-stock-liquidity-${option.value}`}
                              >
                                <span className="block font-semibold">{option.label}{option.recommended ? " · Default" : ""}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}

                    <div className="rounded-lg border p-4">
                      <SettingHelp
                        title="Exit protection"
                        help="Automatic uses stock momentum and confirmed reversals, with a 10% emergency loss limit and a backup profit lock. Customize only if you want fixed backup percentages."
                        testId="help-stock-exit-mode"
                      />
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setStockExitMode("automatic");
                            setStopLossPct("10");
                            setTrailArmPct("10");
                            setTrailPct("8");
                            setTakeProfitPct("");
                          }}
                          className={`rounded-md border p-3 text-left text-sm ${stockExitMode === "automatic" ? "border-black bg-black text-white" : "border-border"}`}
                          data-testid="button-stock-exit-automatic"
                        >
                          <strong className="block">Automatic</strong>
                          <span className="mt-1 block text-xs opacity-70">Recommended stock protection</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setStockExitMode("custom")}
                          className={`rounded-md border p-3 text-left text-sm ${stockExitMode === "custom" ? "border-black bg-black text-white" : "border-border"}`}
                          data-testid="button-stock-exit-custom"
                        >
                          <strong className="block">Customize</strong>
                          <span className="mt-1 block text-xs opacity-70">Set backup percentages</span>
                        </button>
                      </div>
                      {stockExitMode === "custom" && <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <div>
                          <SettingHelp
                            title="How much loss is too much?"
                            help="If you start with $10 and it falls by 10%, the bot closes the practice trade near $9. This helps stop one bad trade from getting much worse."
                            testId="help-stock-stop"
                          />
                          <div className="mt-1 flex items-center gap-2">
                            <Input type="number" min="3" max="50" value={stopLossPct} onChange={(e) => setStopLossPct(e.target.value)} data-testid="input-stock-stop" />
                            <span className="text-sm font-bold">%</span>
                          </div>
                        </div>
                        <div>
                          <SettingHelp
                            title="When should it start protecting a win?"
                            help="This is sometimes called “trail arm.” If you choose 10%, the bot waits until the trade is up 10% before it starts protecting the profit."
                            testId="help-stock-trail-arm"
                          />
                          <div className="mt-1 flex items-center gap-2">
                            <Input type="number" min="5" max="200" value={trailArmPct} onChange={(e) => setTrailArmPct(e.target.value)} data-testid="input-stock-trail-arm" />
                            <span className="text-sm font-bold">%</span>
                          </div>
                        </div>
                        <div>
                          <SettingHelp
                            title="How far can a winner fall?"
                            help="After the bot starts protecting a win, this says how much the price may fall from its best point. Example: it reaches $12, then falls 8% from that best price—the bot closes the practice trade."
                            testId="help-stock-trail"
                          />
                          <div className="mt-1 flex items-center gap-2">
                            <Input type="number" min="5" max="50" value={trailPct} onChange={(e) => setTrailPct(e.target.value)} data-testid="input-stock-trail" />
                            <span className="text-sm font-bold">%</span>
                          </div>
                        </div>
                        <div>
                          <SettingHelp
                            title="Sell at a fixed profit"
                            help="Leave this blank to let the bot use automatic reversal and profit-lock exits. Entering a number sells as soon as that gain is reached."
                            testId="help-stock-take-profit"
                          />
                          <div className="mt-1 flex items-center gap-2">
                            <Input type="number" min="3" max="500" value={takeProfitPct} onChange={(e) => setTakeProfitPct(e.target.value)} placeholder="Automatic" data-testid="input-stock-take-profit" />
                            <span className="text-sm font-bold">%</span>
                          </div>
                        </div>
                      </div>}
                    </div>

                    <div className="rounded-md border border-border p-3">
                      <SettingHelp
                        title="Set aside part of each win"
                        help="This share of each paper profit is tracked outside the bot's trading bankroll. The same choices apply to crypto paper bots."
                        testId="help-stock-profit-skim"
                      />
                      <div className="mt-2 flex flex-wrap gap-1">
                        {PROFIT_SKIM_OPTIONS.map((pct) => (
                          <Button key={pct} type="button" size="sm" variant={Number(profitSkimPct) === pct ? "default" : "outline"} onClick={() => setProfitSkimPct(String(pct))}>
                            {pct}%{pct === 50 ? " (default)" : ""}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-md border border-border p-3">
                      <SettingHelp
                        title="Pause buying after this many losses"
                        help="After this many losing paper trades in a row, new stock buys pause for 30 minutes. Existing positions keep their normal protection."
                        testId="help-stock-loss-cooloff"
                      />
                      <div className="mt-2 flex flex-wrap gap-1">
                        {LOSS_COOLDOWN_OPTIONS.map((count) => (
                          <Button key={count} type="button" size="sm" variant={Number(lossStopCount) === count ? "default" : "outline"} onClick={() => setLossStopCount(String(count))}>
                            {count}{count === 4 ? " (default)" : ""}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
                      <SettingHelp
                        title="Hold losses for recovery"
                        help="Gives an ordinary red paper position more time, but still exits on confirmed continued decline or the emergency loss backstop."
                        testId="help-stock-recovery-hold"
                      />
                      <Switch checked={neverSellAtLoss} onCheckedChange={setNeverSellAtLoss} data-testid="switch-stock-recovery-hold" />
                    </div>

                    <div className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
                      <strong className="text-foreground">What happens next?</strong> {stockBotKind === "scan"
                        ? "The bot compares verified xStocks every minute. It waits for a steady upward move with enough trading, avoids sudden spikes, and makes a pretend buy only when a stock passes every check."
                        : "The bot watches the verified stock, makes pretend buys and sells, and shows why it acted. It keeps watching for another practice trade until you stop it or its timer ends."}
                    </div>

                    <Button
                      type="button"
                      onClick={() => createMut.mutate()}
                      disabled={createMut.isPending || (stockBotKind === "single" && (stockChoices.length === 0 || !selectedStockMint))}
                      className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
                      data-testid="button-start-stock-paper-bot"
                    >
                      {createMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Beaker className="mr-2 h-4 w-4" />}
                      {stockBotKind === "scan" ? "Start xStocks momentum scan" : "Start practice stock bot"}
                    </Button>
                    <p className="text-center text-[11px] text-muted-foreground">
                      {Number(budgetSol) > 0
                        ? `Will start with ${Number(budgetSol).toFixed(3)} virtual SOL, less the ${(Number(budgetSol) * 0.016).toFixed(3)} startup fee. Paper practice only.`
                        : "Paper practice only. No real stock or token is purchased."}
                    </p>
                  </div>
                )}
            </CollapsibleCard>

            {/* ─── Bot list ─── */}
            <div className="space-y-4">
              <CollapsibleCard
                title="Top crypto settings & win rates"
                icon={<Star className="h-5 w-5" />}
                defaultOpen={false}
                persistKey="swing:top-settings-open"
                contentClassName="px-6 pb-5 space-y-4"
              >
                <div>
                  <p className="text-sm text-muted-foreground">
                    Anonymous crypto results grouped by matching settings across settled Paper and Live scanning bots. Wallets, owners, bot names, and individual trades are never shown.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    A setup needs at least {defaultsQuery.data?.minimumTrades ?? 10} settled trades to rank. Best win rate also requires positive realized P&amp;L. Tokenized-stock paper results stay separate until there is enough history for their own ranking.
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="Leaderboard ranking">
                  {([
                    ["bestWinRate", "Best win rate"],
                    ["mostWins", "Most wins"],
                    ["mostProfitable", "Most profitable"],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={leaderboardTab === key}
                      onClick={() => setLeaderboardTab(key)}
                      className={`rounded-md px-2 py-2 text-xs font-medium transition-colors ${leaderboardTab === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                      data-testid={`button-leaderboard-${key}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {defaultsQuery.isLoading ? (
                  <div className="py-6 text-center text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
                ) : (defaultsQuery.data?.leaderboard?.[leaderboardTab]?.length ?? 0) === 0 ? (
                  <div className="rounded-md border border-dashed p-5 text-center">
                    <p className="font-medium">The leaderboard is live and waiting for enough results</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Top settings appear after a matching Paper or Live setup reaches {defaultsQuery.data?.minimumTrades ?? 10} settled trades. Ranked rows will show its style, positions, liquidity rule, exit rules, wins, win rate, and total P&amp;L.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {defaultsQuery.data!.leaderboard[leaderboardTab].slice(0, 5).map((entry, index) => {
                      const pnlSol = Number(entry.realizedPnlLamports) / LAMPORTS_PER_SOL;
                      const modeLabel = entry.liveBots > 0 && entry.paperBots > 0
                        ? `${entry.liveBots} live · ${entry.paperBots} paper`
                        : entry.liveBots > 0 ? `${entry.liveBots} live` : `${entry.paperBots} paper`;
                      const stop = Number(entry.settings.stopRoomPct ?? entry.settings.stopLossPct) || 0;
                      return (
                        <div key={`${entry.style}-${JSON.stringify(entry.settings)}`} className="rounded-lg border p-3" data-testid={`leaderboard-row-${leaderboardTab}-${index + 1}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-start gap-3">
                              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${index === 0 ? "bg-amber-500/20 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}>{index + 1}</span>
                              <div className="min-w-0">
                                <strong className="block">{STYLE_LABEL[entry.style] ?? entry.style}</strong>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {entry.bots} bot{entry.bots === 1 ? "" : "s"} · {modeLabel} · {entry.trades} settled trades
                                </p>
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <strong className="block text-emerald-600 dark:text-emerald-400">
                                {leaderboardTab === "mostWins"
                                  ? `${entry.wins} wins`
                                  : leaderboardTab === "mostProfitable"
                                    ? `${pnlSol >= 0 ? "+" : ""}${pnlSol.toFixed(4)} SOL`
                                    : `${entry.winRate}%`}
                              </strong>
                              <span className="text-[11px] text-muted-foreground">{entry.wins}/{entry.trades} wins · {entry.winRate}%</span>
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                            <span className="rounded bg-muted px-2 py-1">{Number(entry.settings.maxPositions) || 1} positions</span>
                            <span className="rounded bg-muted px-2 py-1">${Math.round(Number(entry.settings.minLiquidityUsd) || 0).toLocaleString()}+ liquidity</span>
                            <span className="rounded bg-muted px-2 py-1">{entry.settings.neverSellAtLoss ? "Recovery hold" : `−${stop}% stop`}</span>
                            <span className="rounded bg-muted px-2 py-1">{entry.settings.takeProfitPct == null ? "Runner-based exits" : `+${Number(entry.settings.takeProfitPct)}% target`}</span>
                            <span className={`rounded px-2 py-1 ${pnlSol >= 0 ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-red-500/10 text-red-700 dark:text-red-300"}`}>
                              {pnlSol >= 0 ? "+" : ""}{pnlSol.toFixed(4)} SOL total
                            </span>
                          </div>
                           <Button
                             type="button"
                             size="sm"
                             variant="outline"
                             className="mt-3 h-8 text-xs"
                             onClick={() => useSettingsForNewBot(entry.settings, `The #${index + 1} ${leaderboardTab === "bestWinRate" ? "win-rate" : leaderboardTab === "mostWins" ? "most-wins" : "profit"} setup`)}
                             data-testid={`button-use-leaderboard-settings-${leaderboardTab}-${index + 1}`}
                           >
                             <Copy className="mr-1.5 h-3.5 w-3.5" /> Use for new bot
                           </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CollapsibleCard>

              {performanceQuery.data && performanceQuery.data.summary.trades > 0 && (
                <CollapsibleCard
                  title="My performance history"
                  icon={<TrendingUp className="h-5 w-5" />}
                  defaultOpen={false}
                  contentClassName="px-6 pb-5 space-y-3"
                >
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-md border p-2"><strong className="block text-lg">{performanceQuery.data.summary.winRate}%</strong><span className="text-xs text-muted-foreground">win rate</span></div>
                    <div className="rounded-md border p-2"><strong className="block text-lg">{performanceQuery.data.summary.wins}/{performanceQuery.data.summary.trades}</strong><span className="text-xs text-muted-foreground">wins</span></div>
                    <div className="rounded-md border p-2"><strong className="block text-lg">{performanceQuery.data.summary.bots}</strong><span className="text-xs text-muted-foreground">bots tracked</span></div>
                  </div>
                  <p className="text-xs text-muted-foreground">Your best settled bots and their final settings remain here even after you delete the detailed bot record.</p>
                  <div className="space-y-2">
                    {performanceQuery.data.bestBots.slice(0, 5).map((bot) => (
                      <div key={`${bot.strategyId}-${bot.archived}`} className="rounded-md border p-3 text-sm" data-testid={`performance-bot-${bot.strategyId}`}>
                        <div className="flex items-center justify-between gap-3">
                          <strong>{bot.name}</strong>
                          <div className="flex items-center gap-2">
                            <span className={bot.winRate >= 50 ? "font-bold text-emerald-600" : "font-bold"}>{bot.winRate}% wins</span>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              onClick={() => useSettingsForNewBot(bot.settings, bot.name)}
                              data-testid={`button-use-history-settings-${bot.strategyId}`}
                            >
                              <Copy className="mr-1 h-3 w-3" /> New bot
                            </Button>
                          </div>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {bot.mode === "live" ? "Live" : "Paper"} · {STYLE_LABEL[bot.style]} · {bot.wins}/{bot.trades} wins · {bot.archived ? "deleted bot summary" : bot.status}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {Number(bot.settings.maxPositions) || 1} positions · ${Math.round(Number(bot.settings.minLiquidityUsd) || 0).toLocaleString()}+ liquidity · {bot.settings.neverSellAtLoss ? "recovery hold" : `−${Number(bot.settings.stopRoomPct ?? bot.settings.stopLossPct) || 0}% stop`}
                        </p>
                      </div>
                    ))}
                  </div>
                </CollapsibleCard>
              )}
              {listQuery.isLoading && (
                <Card><CardContent className="py-10 text-center text-muted-foreground"><Loader2 className="w-5 h-5 mx-auto animate-spin" /></CardContent></Card>
              )}
              {listQuery.data && listQuery.data.strategies.length === 0 && (
                <Card><CardContent className="py-10 text-center text-muted-foreground">No swing bots yet. Start a paper bot and watch it work.</CardContent></Card>
              )}
              {(() => {
                const all = listQuery.data?.strategies ?? [];
                const isFinished = (s: SwingStrategy) => s.status === "stopped" || s.status === "completed";
                // Favorites float to the top within each group.
                const favFirst = (a: SwingStrategy, b: SwingStrategy) => Number(b.favorite) - Number(a.favorite);
                const active = all.filter((s) => !isFinished(s)).sort(favFirst);
                const finished = all.filter(isFinished).sort(favFirst);
                return (
                  <>
                    {active.map((s) => (
                      <BotCard key={s.id} strategy={s} owner={owner ?? s.ownerWallet} readToken={(owner ? readToken : guestToken)!} signMessage={signMessage ?? undefined} guestToken={owner ? undefined : guestToken} />
                    ))}
                    {finished.length > 0 && (
                      <button
                        type="button"
                        onClick={toggleShowFinished}
                        className="w-full flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                        data-testid="button-toggle-finished"
                      >
                        {showFinished ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        {showFinished ? `Hide finished bots (${finished.length})` : `Show finished bots (${finished.length})`}
                      </button>
                    )}
                    {showFinished && finished.map((s) => (
                      <BotCard key={s.id} strategy={s} owner={owner ?? s.ownerWallet} readToken={(owner ? readToken : guestToken)!} signMessage={signMessage ?? undefined} guestToken={owner ? undefined : guestToken} />
                    ))}
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}

// SOL you'd actually pocket if an OPEN position sold right now — nets out the
// profit-only platform fee (charged only on profit, capped at the profit),
// mirroring the server's sellFeeLamports so the live number matches what you
// actually get when it closes. Losing positions pay no fee.
function netOpenValueLamports(value: number, solIn: number, feeBps: number): number {
  if (value <= solIn) return value;
  const fee = Math.min((value * feeBps) / 10_000, value - solIn);
  return value - fee;
}

function posPnlPct(p: SwingPosition, feeBps = 160): number {
  const solIn = Number(p.solInLamports);
  if (solIn <= 0) return 0;
  // Closed = the exact on-chain result (sol_out already has any fee removed).
  if (p.status === "closed") return ((Number(p.solOutLamports ?? 0) - solIn) / solIn) * 100;
  // Open = live estimate, shown AFTER the profit-only fee so it lines up with
  // the number you'll actually realize at close (no surprise drop on sale).
  const net = netOpenValueLamports(Number(p.lastValueLamports), solIn, feeBps);
  return ((net - solIn) / solIn) * 100;
}

const EXIT_LABEL: Record<string, string> = {
  take_profit: "take-profit",
  chart_signal: "chart signal (blow-off top)",
  stop_loss: "stop-loss",
  trailing_stop: "trailing stop",
  breakeven_guard: "breakeven guard",
  conservative_take: "banked the small win (steady-wins mode)",
  rotate_to_runner: "rotated into a stronger mover",
  adaptive_take: "adaptive profit take",
  adaptive_cut: "adaptive weak-setup cut",
  profit_protect: "profit protect (kept most of the win)",
  early_cut: "early cut (trade never worked)",
  momentum_stop: "crash cut (got out before the full stop)",
  liquidity_drained: "rug pull — emergency exit",
  volume_fade: "volume fade",
  sellers_took_over: "sellers took over",
  max_hold: "time-stop",
  window_end: "run ended",
  manual_stop: "stopped",
  manual_sell: "you sold manually",
  tokens_sent_home: "tokens sent to your wallet",
  dust_hold: "kept tokens (worth ~0, not sold)",
};

function BotCard({
  strategy,
  owner,
  readToken,
  signMessage,
  guestToken,
}: {
  strategy: SwingStrategy;
  owner: string;
  readToken: string;
  signMessage?: (msg: Uint8Array) => Promise<Uint8Array>;
  guestToken?: string;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [cardOpen, setCardOpen] = useState(true);
  // Seed from a ?watch=<mint> deep link (the scanner page's "Watch in Swing
  // Bot" button) — prefills the paste box; the owner still taps Add.
  const [watchAddr, setWatchAddr] = useState(() => {
    try {
      const m = new URLSearchParams(window.location.search).get("watch") ?? "";
      return isValidSolanaAddress(m) ? m : "";
    } catch { return ""; }
  });
  const [fundAmount, setFundAmount] = useState(() =>
    ((Number(strategy.budgetLamports) * 1.05 + 8_000_000) / LAMPORTS_PER_SOL).toFixed(4),
  );
  const [funding, setFunding] = useState(false);
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const detailQuery = useQuery<{
    strategy: SwingStrategy;
    positions: SwingPosition[];
    events: SwingEvent[];
    skims: SwingEvent[];
    buySignals: SwingBuySignal[];
    workerWalletBalanceLamports: string | null;
  }>({
    queryKey: ["/api/swing-bot", strategy.id, readToken],
    enabled: !!readToken,
    refetchInterval: 15_000,
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/swing-bot/${strategy.id}`,
        undefined,
        guestToken ? { "x-swing-guest": guestToken } : { "x-swing-token": readToken },
      );
      return res.json();
    },
  });

  const s = detailQuery.data?.strategy ?? strategy;
  const positions = detailQuery.data?.positions ?? [];
  const events = detailQuery.data?.events ?? [];
  const skims = detailQuery.data?.skims ?? [];
  const buySignals = detailQuery.data?.buySignals ?? [];
  const workerBalance = detailQuery.data?.workerWalletBalanceLamports;

  const openPositions = positions.filter((p) => p.status === "open");
  const closedPositions = positions.filter((p) => p.status === "closed");

  // Watchlist token names: resolve the real NAME/symbol for each watched mint so
  // the list shows "ANSUM" instead of a raw contract address. One batched,
  // cached lookup; falls back to the address if a name can't be found.
  const watchedMints = s.rebuyMints ?? [];
  const watchNamesQuery = useQuery<Record<string, { symbol: string; name: string | null }>>({
    queryKey: ["/api/swing-bot/token-names", [...watchedMints].sort().join(",")],
    enabled: watchedMints.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/swing-bot/token-names?mints=${encodeURIComponent(watchedMints.join(","))}`);
      return res.json();
    },
  });
  const watchNames = watchNamesQuery.data ?? {};
  // Positions from the CURRENT run only — a restarted bot's older positions
  // are history and must not hide the Buy-now panel (mirrors the server's
  // restartedAt run scoping).
  const runPositions = s.restartedAt
    ? positions.filter((p) => new Date(p.openedAt).getTime() >= new Date(s.restartedAt!).getTime())
    : positions;

  const actionAuthorization = async (act: string) => {
    if (guestToken) return { guestToken };
    if (!signMessage) throw new Error("Reconnect your wallet and try again.");
    const nonce = Date.now();
    const message = ["paif-swing", "v1", act, s.id, owner, String(nonce)].join("|");
    const signature = bs58.encode(await signMessage(new TextEncoder().encode(message)));
    return { ownerWallet: owner, nonce, signature };
  };

  const action = async (act: "start" | "pause" | "stop" | "delete" | "settings" | "buy" | "topup" | "window" | "save-preset" | "apply-preset", extra?: Record<string, unknown>) => {
    const authorization = await actionAuthorization(act);
    return apiRequest("POST", `/api/swing-bot/${s.id}/${act}`, { ...extra, ...authorization });
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/swing-bot"] });
    queryClient.invalidateQueries({ queryKey: ["/api/swing-bot/list"] });
  };

  const startMut = useMutation({
    mutationFn: () => action("start"),
    onSuccess: invalidate,
    onError: (e: any) => toast({ title: "Couldn't start", description: e.message, variant: "destructive" }),
  });
  const pauseMut = useMutation({
    mutationFn: () => action("pause"),
    onSuccess: invalidate,
    onError: (e: any) => toast({ title: "Couldn't pause", description: e.message, variant: "destructive" }),
  });
  const stopMut = useMutation({
    mutationFn: () => action("stop"),
    onSuccess: () => {
      toast({ title: "Stopping", description: s.mode === "live" ? "Selling positions and sweeping funds back to your wallet…" : "Selling paper positions and finishing up…" });
      invalidate();
    },
    onError: (e: any) => toast({ title: "Couldn't stop", description: e.message, variant: "destructive" }),
  });
  const settingsMut = useMutation({
    mutationFn: (patch: { maxPositions?: number; hotStreakFullSize?: boolean; minPoolAgeHours?: number; requireApproval?: boolean; minLiquidityUsd?: number; conservativeProfit?: boolean; neverSellAtLoss?: boolean; redEndBehavior?: "sell" | "send_tokens"; takeProfitPct?: number | null; stopRoomPct?: number | null; profitSkimPct?: number; sellOffCutEnabled?: boolean; winnerKeepPct?: number | null; lossStopCount?: number; name?: string; favorite?: boolean }) => action("settings", patch),
    onSuccess: () => {
      toast({ title: "Settings updated", description: "Saved — see the bot's notes below for exactly what changed and when it takes effect." });
      invalidate();
    },
    onError: (e: any) => toast({ title: "Couldn't update", description: e.message, variant: "destructive" }),
  });
  // ── Saved settings presets ("my favorite settings") ────────────────────────
  const presetsQuery = useQuery<{ presets: SwingPresetRow[] }>({
    queryKey: ["/api/swing-presets/list", owner, readToken],
    enabled: !!owner && !!readToken,
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/swing-presets/list?owner=${owner}`,
        undefined,
        guestToken ? { "x-swing-guest": guestToken } : { "x-swing-token": readToken },
      );
      return res.json();
    },
  });
  const myPresets = presetsQuery.data?.presets ?? [];
  const samePresets = myPresets.filter((p) => p.style === s.style);
  const [presetName, setPresetName] = useState("");
  const invalidatePresets = () => queryClient.invalidateQueries({ queryKey: ["/api/swing-presets/list"] });
  // Star/delete sign against the PRESET id (rides in the strategy slot of the
  // same signed-message format — same nonce/replay protection).
  const presetAction = async (act: "preset-update" | "preset-delete", presetId: string, extra?: Record<string, unknown>) => {
    if (guestToken) {
      const path = act === "preset-update" ? "update" : "delete";
      return apiRequest("POST", `/api/swing-presets/${presetId}/${path}`, { ...extra, guestToken });
    }
    if (!signMessage) throw new Error("Reconnect your wallet and try again.");
    const nonce = Date.now();
    const message = ["paif-swing", "v1", act, presetId, owner, String(nonce)].join("|");
    const signature = bs58.encode(await signMessage(new TextEncoder().encode(message)));
    const path = act === "preset-update" ? "update" : "delete";
    return apiRequest("POST", `/api/swing-presets/${presetId}/${path}`, { ...extra, ownerWallet: owner, nonce, signature });
  };
  const savePresetMut = useMutation({
    mutationFn: (name: string) => action("save-preset", { name }),
    onSuccess: () => {
      setPresetName("");
      toast({ title: "Preset saved", description: "These settings are memorized — you can apply them to any bot of the same style, now or later." });
      invalidatePresets();
    },
    onError: (e: any) => toast({ title: "Couldn't save preset", description: e.message, variant: "destructive" }),
  });
  const applyPresetMut = useMutation({
    mutationFn: (presetId: string) => action("apply-preset", { presetId }),
    onSuccess: () => {
      toast({ title: "Preset applied", description: "Settings updated — see the bot's notes below for what changed." });
      invalidate();
    },
    onError: (e: any) => toast({ title: "Couldn't apply preset", description: e.message, variant: "destructive" }),
  });
  const starPresetMut = useMutation({
    mutationFn: (p: { id: string; starred: boolean }) => presetAction("preset-update", p.id, { starred: p.starred }),
    onSuccess: invalidatePresets,
    onError: (e: any) => toast({ title: "Couldn't update preset", description: e.message, variant: "destructive" }),
  });
  const deletePresetMut = useMutation({
    mutationFn: (presetId: string) => presetAction("preset-delete", presetId),
    onSuccess: () => { toast({ title: "Preset deleted" }); invalidatePresets(); },
    onError: (e: any) => toast({ title: "Couldn't delete preset", description: e.message, variant: "destructive" }),
  });
  // Change the run timer while the bot is live (or set it unlimited).
  const [showTimerEdit, setShowTimerEdit] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const windowMut = useMutation({
    mutationFn: (patch: { windowHours?: number; unlimitedWindow?: boolean }) => action("window", patch),
    onSuccess: (_res, patch) => {
      setShowTimerEdit(false);
      toast({
        title: "Timer updated",
        description: patch.unlimitedWindow
          ? "No end date now — the bot runs until you stop it."
          : "New countdown started from right now.",
      });
      invalidate();
    },
    onError: (e: any) => toast({ title: "Couldn't change timer", description: e.message, variant: "destructive" }),
  });
  // Manual "Sell now" on one position. Two-tap confirm (first tap arms it).
  const [confirmSellId, setConfirmSellId] = useState<string | null>(null);
  const sellMut = useMutation({
    // Signs "sell:<positionId>" so the approval is bound to this exact position.
    mutationFn: async (positionId: string) => {
      const authorization = await actionAuthorization(`sell:${positionId}`);
      return apiRequest("POST", `/api/swing-bot/${s.id}/sell`, { positionId, ...authorization });
    },
    onSuccess: () => {
      setConfirmSellId(null);
      toast({ title: "Selling now", description: "Selling at market price. Watch the activity feed for the result." });
      invalidate();
    },
    onError: (e: any) => {
      setConfirmSellId(null);
      toast({ title: "Couldn't sell", description: e.message, variant: "destructive" });
    },
  });
  // "Ask me first": approve a pending suggestion (buys at the current price) or
  // dismiss it. Each signs "approve:<signalId>" / "dismiss:<signalId>" so the
  // owner's approval is bound to that exact suggestion.
  const approveSignalMut = useMutation({
    mutationFn: async (signalId: string) => {
      const authorization = await actionAuthorization(`approve:${signalId}`);
      return apiRequest("POST", `/api/swing-bot/${s.id}/signal/${signalId}/approve`, authorization);
    },
    onSuccess: async (res) => {
      const data = await res.json().catch(() => ({}) as any);
      toast({ title: `Buying ${data?.symbol ?? "token"}`, description: "Buying at the current price with its own stop-loss and exit rules. Watch the activity feed for the result." });
      invalidate();
    },
    onError: (e: any) => toast({ title: "Couldn't buy", description: e.message, variant: "destructive" }),
  });
  const dismissSignalMut = useMutation({
    mutationFn: async (signalId: string) => {
      const authorization = await actionAuthorization(`dismiss:${signalId}`);
      return apiRequest("POST", `/api/swing-bot/${s.id}/signal/${signalId}/dismiss`, authorization);
    },
    onSuccess: () => {
      toast({ title: "Skipped", description: "That pick was dismissed — no buy." });
      invalidate();
    },
    onError: (e: any) => toast({ title: "Couldn't dismiss", description: e.message, variant: "destructive" }),
  });
  // Manual "Buy more" of a token the bot already holds. Two-tap confirm.
  // Puts ALL free SOL into a fresh tranche of that token with its own rules.
  const [confirmBuyMoreId, setConfirmBuyMoreId] = useState<string | null>(null);
  const buyMoreMut = useMutation({
    // Signs "buymore:<positionId>" so the approval is bound to this exact position.
    mutationFn: async (positionId: string) => {
      const authorization = await actionAuthorization(`buymore:${positionId}`);
      return apiRequest("POST", `/api/swing-bot/${s.id}/buymore`, { positionId, ...authorization });
    },
    onSuccess: async (res) => {
      setConfirmBuyMoreId(null);
      const data = await res.json().catch(() => ({}) as any);
      toast({ title: `Bought more ${data?.symbol ?? ""}`, description: `${typeof data?.sol === "number" ? `Put ${data.sol.toFixed(4)} SOL in — it` : "It"} shows up below as its own box with its own stop-loss and exit rules.` });
      invalidate();
      detailQuery.refetch();
    },
    onError: (e: any) => {
      setConfirmBuyMoreId(null);
      toast({ title: "Couldn't buy more", description: e.message, variant: "destructive" });
    },
  });
  const positionHoldMut = useMutation({
    mutationFn: async ({ positionId, hold }: { positionId: string; hold: boolean }) => {
      const authorization = await actionAuthorization(`positionhold:${positionId}:${hold ? "on" : "off"}`);
      return apiRequest("POST", `/api/swing-bot/${s.id}/position-hold`, {
        positionId,
        hold,
        ...authorization,
      });
    },
    onSuccess: (_res, { hold }) => {
      toast({
        title: hold ? "Don't sell yet is on" : "Automatic selling is back on",
        description: hold
          ? "The bot will keep this position open until you turn the switch off, sell it yourself, stop the bot, or its timer ends."
          : "The bot will use its normal stop, profit and reversal rules again.",
      });
      invalidate();
      detailQuery.refetch();
    },
    onError: (e: any) => {
      toast({ title: "Couldn't change the hold", description: e.message, variant: "destructive" });
    },
  });
  // Manual "Swap": sell one position, then buy more of another with the
  // freed cash — one tap instead of hand-timing Sell + Buy more.
  const swapMut = useMutation({
    // Signs "swap:<sellId>:<buyId>" so approval is bound to this exact pair.
    mutationFn: async (ids: { sellPositionId: string; buyPositionId: string }) => {
      const authorization = await actionAuthorization(`swap:${ids.sellPositionId}:${ids.buyPositionId}`);
      return apiRequest("POST", `/api/swing-bot/${s.id}/swap`, { ...ids, ...authorization });
    },
    onSuccess: async (res) => {
      setConfirmBuyMoreId(null);
      const data = await res.json().catch(() => ({}) as any);
      toast({ title: `Swapped into ${data?.boughtSymbol ?? "your token"}`, description: `Sold ${data?.soldSymbol ?? "the other position"} and added the cash as a fresh slice with its own stop and exit rules.` });
      invalidate();
      detailQuery.refetch();
    },
    onError: (e: any) => {
      setConfirmBuyMoreId(null);
      toast({ title: "Swap didn't finish", description: e.message, variant: "destructive" });
    },
  });
  // "Buy again" star on a closed trade: the bot watches that token and buys
  // back in when the entry looks good (all safety guards still apply).
  const rebuyMut = useMutation({
    // Signs "rebuy:<mint>" so the approval is bound to this exact token.
    mutationFn: async (mint: string) => {
      const authorization = await actionAuthorization(`rebuy:${mint}`);
      return apiRequest("POST", `/api/swing-bot/${s.id}/rebuy`, { mint, ...authorization });
    },
    onSuccess: async (res) => {
      const data = await res.json().catch(() => ({}) as any);
      toast(data?.starred
        ? { title: "Watching for a re-entry", description: "The bot will buy this token again when the entry looks good — all safety checks still apply." }
        : { title: "Star removed", description: "The bot is no longer watching this token for a re-entry." });
      invalidate();
    },
    onError: (e: any) => toast({ title: "Couldn't update Buy again", description: e.message, variant: "destructive" }),
  });
  // "Never buy again": bans a token from every buy path. Signs "block:<mint>"
  // so approval is bound to this exact token.
  const blockMut = useMutation({
    mutationFn: async (mint: string) => {
      const authorization = await actionAuthorization(`block:${mint}`);
      return apiRequest("POST", `/api/swing-bot/${s.id}/block`, { mint, ...authorization });
    },
    onSuccess: async (res) => {
      const data = await res.json().catch(() => ({}) as any);
      toast(data?.blocked
        ? { title: "Blocked — never buying this again", description: "The bot will never buy this token, on any path. Change your mind anytime with 'Allow again'." }
        : { title: "Block lifted", description: "The bot may consider this token again — all the usual entry checks apply." });
      invalidate();
    },
    onError: (e: any) => toast({ title: "Couldn't update Never buy", description: e.message, variant: "destructive" }),
  });
  // "Buy again → Buy now": immediate re-buy of a closed trade's token with
  // all free cash, instead of waiting for the bot's entry judgment.
  const [confirmRebuyId, setConfirmRebuyId] = useState<string | null>(null);
  // FOMO-brake: before a manual "Buy now" fires, we ask the server what the
  // bot itself sees right now (sell-off? falling? thin liquidity?) and show
  // those FACTS so the owner can wait or proceed with eyes open.
  // surface tells the two panels apart (the same mint can live in BOTH the
  // closed-trades list AND the watch list) so a check run in one place never
  // renders its facts panel in the other.
  const [assessResult, setAssessResult] = useState<{ mint: string; surface: "watch" | "closed"; symbol: string; wouldBuy: boolean; headline: string; facts: string[] } | null>(null);
  const assessMut = useMutation({
    mutationFn: async ({ mint }: { mint: string; surface: "watch" | "closed" }) => {
      const res = await apiRequest(
        "GET",
        `/api/swing-bot/${s.id}/buy-now-check/${mint}`,
        undefined,
        guestToken ? { "x-swing-guest": guestToken } : { "x-swing-token": readToken },
      );
      return { data: await res.json() };
    },
    onSuccess: ({ data }, { mint, surface }) => setAssessResult({ mint, surface, ...data }),
    onError: (e: any) => toast({ title: "Couldn't check the token", description: e.message, variant: "destructive" }),
  });
  const buyMintNowMut = useMutation({
    // Signs "buymintnow:<mint>" so approval is bound to this exact token.
    mutationFn: async (mint: string) => {
      const authorization = await actionAuthorization(`buymintnow:${mint}`);
      return apiRequest("POST", `/api/swing-bot/${s.id}/buy-mint-now`, { mint, ...authorization });
    },
    onSuccess: async (res) => {
      setConfirmRebuyId(null);
      setAssessResult(null);
      const data = await res.json().catch(() => ({}) as any);
      toast({ title: `Bought ${data?.symbol ?? "the token"}`, description: `${typeof data?.sol === "number" ? `Put ${data.sol.toFixed(4)} SOL in — it` : "It"} shows up under Open positions as its own box; the bot handles the exit from here.` });
      invalidate();
      detailQuery.refetch();
    },
    onError: (e: any) => {
      setConfirmRebuyId(null);
      setAssessResult(null);
      toast({ title: "Couldn't buy", description: e.message, variant: "destructive" });
    },
  });
  // Add an arbitrary token (by address) to this bot's watchlist. Reuses the same
  // owner-signed rebuy toggle, so buying it later still runs every safety check.
  const addWatch = () => {
    const m = watchAddr.trim();
    if (!m) return;
    if (!isValidSolanaAddress(m)) {
      toast({ title: "That doesn't look like a Solana token address", description: "Paste the token's contract address (a long string of letters and numbers).", variant: "destructive" });
      return;
    }
    if ((s.rebuyMints ?? []).includes(m)) {
      toast({ title: "Already on the watchlist", description: "This token is already being watched." });
      setWatchAddr("");
      return;
    }
    rebuyMut.mutate(m);
    setWatchAddr("");
  };

  // Manual "Buy now" for a manual-buy watch bot. Two-tap confirm.
  const [confirmBuy, setConfirmBuy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const buyMut = useMutation({
    mutationFn: () => action("buy"),
    onSuccess: async (res) => {
      setConfirmBuy(false);
      const data = await res.json().catch(() => ({}) as any);
      toast({ title: `Bought ${data?.symbol ?? "your token"}`, description: "The bot babysits the exit from here — stop-loss, profit lock, and sell-off tells all run automatically." });
      invalidate();
    },
    onError: (e: any) => {
      setConfirmBuy(false);
      toast({ title: "Couldn't buy", description: e.message, variant: "destructive" });
    },
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteMut = useMutation({
    mutationFn: () => action("delete"),
    onSuccess: () => {
      toast({ title: "Bot deleted", description: "The detailed record is gone. Its result remains in My performance history." });
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["/api/swing-bot/performance/history"] });
    },
    onError: (e: any) => {
      setConfirmDelete(false);
      toast({ title: "Couldn't delete", description: e.message, variant: "destructive" });
    },
  });

  const copyWorker = () => {
    navigator.clipboard.writeText(s.workerWallet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Recommended funding = budget + 0.008 SOL buy headroom
  // (token-account rents + priority fees — matches the server's reserve).
  const recommendedSol = (Number(s.budgetLamports) * 1.05 + 8_000_000) / LAMPORTS_PER_SOL;
  const windowEnded = new Date(s.windowEndAt).getTime() <= Date.now();
  // A stopped OR completed bot can be funded + restarted while its run
  // window is still open — a restart begins a fresh run (watch bots get to
  // buy again; fees remain deferred until profitable closes).
  const canRestart = (s.status === "stopped" || s.status === "completed") && !windowEnded;

  const fundWorker = async () => {
    if (!publicKey || !sendTransaction) {
      toast({ title: "Connect your wallet first", variant: "destructive" });
      return;
    }
    const sol = parseFloat(fundAmount);
    if (!sol || sol <= 0) {
      toast({ title: "Enter an amount", description: `Suggested: ${recommendedSol.toFixed(4)} SOL`, variant: "destructive" });
      return;
    }
    setFunding(true);
    try {
      const lamports = Math.round(sol * LAMPORTS_PER_SOL);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      const ixs = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: BigInt(1_000) }),
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(s.workerWallet),
          lamports,
        }),
      ];
      const msg = new TransactionMessage({
        payerKey: publicKey,
        recentBlockhash: blockhash,
        instructions: ixs,
      }).compileToV0Message();
      const tx = new VersionedTransaction(msg);
      const sig = await sendTransaction(tx, connection, { skipPreflight: false, maxRetries: 3 });
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      toast({
        title: "Funded",
        description: canRestart
          ? `Sent ${sol} SOL to the bot's trading wallet. Press Restart bot right away — a finished bot auto-returns idle funds to your wallet after a few minutes.`
          : `Sent ${sol} SOL to the bot's trading wallet. Press Start when ready.`,
      });
      setFundAmount("");
      invalidate();
      detailQuery.refetch();
    } catch (e: any) {
      toast({ title: "Funding failed", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setFunding(false);
    }
  };

  // Top off a RUNNING bot with more SOL. Live: the SOL is sent to the worker
  // wallet FIRST (the bot sizes buys off the real balance, so new money is
  // picked up on the very next buys), THEN recorded so the "SOL in" number
  // and P&L stay honest. Paper: just records — virtual SOL. Total deposits
  // stay under the 10 SOL cap; profits are never capped.
  const [topUpAmount, setTopUpAmount] = useState("");
  // Custom values for the settings dials (user: presets are fine as defaults,
  // but never limit the choice — every dial takes a typed number too).
  const [customSkim, setCustomSkim] = useState("");
  const [customLiq, setCustomLiq] = useState("");
  const [customStop, setCustomStop] = useState("");
  const [customLossStop, setCustomLossStop] = useState("");
  const [customTp, setCustomTp] = useState("");
  const [customWinner, setCustomWinner] = useState("");
  const [toppingUp, setToppingUp] = useState(false);
  // If the SOL transfer landed but the bookkeeping call failed, the retry
  // must NOT send SOL again — it only redoes the recording. The amount is
  // pinned here the moment the transfer confirms.
  const [pendingRecordSol, setPendingRecordSol] = useState<number | null>(null);
  // recordOnly: the user already sent SOL straight to the worker wallet (a
  // direct wallet-to-wallet send outside the Add funds button). The bot has
  // been trading that money all along — this just fixes the "SOL deposited"
  // baseline so the totals up top are accurate. No SOL moves.
  const topOff = async (recordOnly = false) => {
    const sol = pendingRecordSol ?? parseFloat(topUpAmount);
    if (!sol || sol <= 0) {
      toast({ title: "Enter an amount", description: "How much SOL do you want to add?", variant: "destructive" });
      return;
    }
    const room = (10 * LAMPORTS_PER_SOL - Number(s.budgetLamports)) / LAMPORTS_PER_SOL;
    if (sol > room + 1e-9) {
      toast({ title: "Over the 10 SOL deposit cap", description: room > 0.01 ? `You can add up to ${room.toFixed(4)} SOL more. (Profits are never capped.)` : "This bot is already at the cap — profits still compound with no limit.", variant: "destructive" });
      return;
    }
    setToppingUp(true);
    let solLanded = pendingRecordSol != null;
    try {
      if (s.mode === "live" && pendingRecordSol == null && !recordOnly) {
        if (!publicKey || !sendTransaction) {
          toast({ title: "Connect your wallet first", variant: "destructive" });
          return;
        }
        const lamports = Math.round(sol * LAMPORTS_PER_SOL);
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
        const ixs = [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: BigInt(1_000) }),
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: new PublicKey(s.workerWallet),
            lamports,
          }),
        ];
        const msg = new TransactionMessage({ payerKey: publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
        const sig = await sendTransaction(new VersionedTransaction(msg), connection, { skipPreflight: false, maxRetries: 3 });
        await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
        // SOL has landed — from here on a retry must only redo the recording.
        setPendingRecordSol(sol);
        solLanded = true;
      }
      await action("topup", { addSol: sol });
      setPendingRecordSol(null);
      toast({
        title: recordOnly ? "Deposit recorded" : "Topped off",
        description: recordOnly
          ? `Recorded ${sol} SOL you sent directly — "SOL deposited" and your profit math now include it. No SOL was moved.`
          : s.mode === "live"
            ? `Added ${sol} SOL. The bot folds it in automatically — no restart needed. No fee on top-ups.`
            : `Added ${sol} SOL to the paper bankroll.`,
      });
      setTopUpAmount("");
      invalidate();
      detailQuery.refetch();
    } catch (e: any) {
      toast({
        title: "Top-off failed",
        description: solLanded && s.mode === "live"
          ? `Your ${sol} SOL already arrived and the bot WILL trade it — only the bookkeeping didn't save. Tap "Add funds" again to finish recording (it won't send SOL twice). ${e?.message ?? ""}`
          : (e?.message ?? String(e)),
        variant: "destructive",
      });
    } finally {
      setToppingUp(false);
    }
  };

  // Bankroll = free cash + current value of open positions.
  const freeCash = s.mode === "paper"
    ? Number(s.paperBankrollLamports)
    : (workerBalance != null ? Number(workerBalance) : null);
  const openValue = openPositions.reduce((sum, p) => sum + Number(p.lastValueLamports), 0);
  const budget = Number(s.budgetLamports);
  // SOL that went into positions that settled IN KIND (tokens sent home, not
  // sold for SOL). Deliberately kept out of Closed P&L — no sale happened —
  // but the user must still SEE that this money left as SOL and came back as
  // tokens (usually a rug: the tokens are likely worthless).
  const inKindCostLamports = closedPositions
    .filter((p) => p.exitReason === "tokens_sent_home")
    .reduce((sum, p) => sum + Number(p.solInLamports), 0);
  // Once a live run is over and the wallet was swept home, the wallet shows 0
  // — but that 0 is NOT a loss, the money is back in the user's own wallet.
  // Show the final SOL result (budget + realized P&L, minus any principal
  // that came back in kind as tokens) instead of a scary -100%.
  const sweptHome = s.mode === "live"
    && (s.status === "completed" || s.status === "stopped")
    && openPositions.length === 0
    && workerBalance != null && Number(workerBalance) <= 20_000;
  // Profit set-aside: SOL skimmed off winning trades. It left the trading
  // bankroll (paper: virtual pot; live: sent to the withdraw wallet) but it is
  // still the user's money — count it in the total so the % stays honest.
  const bankedLamports = Number(s.bankedLamports ?? "0");
  const totalValue = sweptHome
    ? Math.max(0, budget + Number(s.realizedPnlLamports) - inKindCostLamports)
    : (freeCash != null ? freeCash + openValue + bankedLamports : null);
  const totalPnlPct = totalValue != null && budget > 0 ? ((totalValue - budget) / budget) * 100 : null;

  const pnlLamports = Number(s.realizedPnlLamports);

  // Bot-vs-you split: separate the trades the bot's scanner chose from the ones
  // you hand-picked with "Buy now" / "Buy again", so a losing streak of your
  // own picks doesn't make the bot's record look worse than it is. Only trades
  // with a recorded trigger count — older ones (entryTrigger null) sit in an
  // "earlier" note. tokens_sent_home never sold for SOL, so it's excluded.
  const splitReal = (trades: SwingPosition[]) => {
    const settled = trades.filter((p) => p.exitReason !== "tokens_sent_home" && p.solOutLamports != null);
    const net = settled.reduce((sum, p) => sum + (Number(p.solOutLamports) - Number(p.solInLamports)), 0);
    const wins = settled.filter((p) => Number(p.solOutLamports) - Number(p.solInLamports) > 0).length;
    return { count: settled.length, wins, net, winRate: settled.length > 0 ? Math.round((wins / settled.length) * 1_000) / 10 : 0 };
  };
  const botStats = splitReal(closedPositions.filter((p) => p.entryTrigger === "auto"));
  const yourStats = splitReal(closedPositions.filter((p) => p.entryTrigger === "manual"));
  const overallStats = splitReal(closedPositions);
  const untrackedCount = closedPositions.filter((p) => p.entryTrigger == null && p.exitReason !== "tokens_sent_home").length;
  const showSplit = botStats.count + yourStats.count > 0;

  // Guided setup flow (new live bots): light up the ONE button the user
  // should press next in the mascot's neon green — first "Fund from wallet",
  // then, once the wallet actually holds the budget, "Start".
  // Start lights up once the wallet holds enough to actually TRADE, not the
  // full budget — the server accepts any balance that clears the minimum
  // trade + per-wallet buy headroom.
  // The budget is a CAP, not a requirement: someone who set a 1 SOL budget
  // but funds 0.3 can start right away and trade the 0.3.
  const minStartLamports = Math.min(
    Number(s.budgetLamports),
    15_000_000 * Math.max(1, s.subWalletCount ?? 1),
  );
  const needsFunding = s.mode === "live" && s.status === "awaiting_funds"
    && (workerBalance == null || Number(workerBalance) < minStartLamports);
  const readyToStart = s.mode === "live" && s.status === "awaiting_funds"
    && workerBalance != null && Number(workerBalance) >= minStartLamports;
  const NEON = "bg-[#2eff7b] text-black hover:bg-[#2eff7b]/90 shadow-[0_0_16px_rgba(46,255,123,0.7)] animate-pulse font-semibold";

  // Guided setup checklist (live bots, before the run starts): every style —
  // Quick swing, Long ride, Dip buyer, Watch — shows the same steps lighting
  // up green as they complete, matching the neon-lit buttons below.
  const awaitingManualBuy =
    s.mode === "live" && s.status === "active" && !!s.targetMint && s.manualBuy
    && openPositions.length === 0 && runPositions.length === 0;
  const setupSteps: { label: string; done: boolean }[] | null =
    s.mode === "live" && s.status === "awaiting_funds"
      ? [
          { label: "Bot created", done: true },
          { label: "Fund the wallet", done: !needsFunding },
          { label: "Press Start", done: false },
          ...(s.targetMint && s.manualBuy ? [{ label: "Press Buy now", done: false }] : []),
        ]
      : awaitingManualBuy
        ? [
            { label: "Bot created", done: true },
            { label: "Fund the wallet", done: true },
            { label: "Press Start", done: true },
            { label: "Press Buy now", done: false },
          ]
        : null;

  return (
    <Card data-testid={`card-bot-${s.id}`}>
      <Collapsible open={cardOpen} onOpenChange={setCardOpen}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              {s.mode === "live" ? <Zap className="w-4 h-4" /> : <Beaker className="w-4 h-4" />}
              {renaming ? (
                <span className="flex items-center gap-1">
                  <Input
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    maxLength={40}
                    className="h-7 w-44 text-sm"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && renameDraft.trim()) {
                        settingsMut.mutate({ name: renameDraft.trim() });
                        setRenaming(false);
                      }
                      if (e.key === "Escape") setRenaming(false);
                    }}
                    data-testid={`input-rename-${s.id}`}
                  />
                  <Button
                    size="sm" variant="ghost" className="h-7 px-2"
                    disabled={settingsMut.isPending || !renameDraft.trim()}
                    onClick={() => { settingsMut.mutate({ name: renameDraft.trim() }); setRenaming(false); }}
                    data-testid={`button-rename-save-${s.id}`}
                  >Save</Button>
                </span>
              ) : (
                <>
                  {s.name}
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    title="Rename this bot"
                    onClick={() => { setRenameDraft(s.name); setRenaming(true); }}
                    data-testid={`button-rename-${s.id}`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
              <button
                type="button"
                className={s.favorite ? "text-yellow-500" : "text-muted-foreground hover:text-yellow-500"}
                title={s.favorite ? "Unfavorite — drops back into normal order" : "Favorite — pins this bot to the top of your list"}
                disabled={settingsMut.isPending}
                onClick={() => settingsMut.mutate({ favorite: !s.favorite })}
                data-testid={`button-favorite-${s.id}`}
              >
                <Star className={`w-4 h-4 ${s.favorite ? "fill-current" : ""}`} />
              </button>
            </CardTitle>
            <CardDescription className="flex items-center gap-2 flex-wrap">
              <span>{s.universe === "stocks" ? (s.targetMint ? "xStock practice bot" : "xStocks practice bot") : s.mode === "live" ? "Live" : "Paper"} · {s.universe === "stocks" ? (s.targetMint ? "one verified xStock" : "scans verified xStocks for momentum") : s.targetMint ? (s.trailArmPct >= 60 ? "Watch · hold long" : "Watch mode") : STYLE_LABEL[s.style]} · {fmtSol(s.budgetLamports)} {s.universe === "stocks" ? "virtual SOL" : "SOL deposited"} · {s.targetMint ? "one token, full budget" : `up to ${s.maxPositions} tokens at once`}{s.takeProfitPct != null ? ` · sells at +${s.takeProfitPct}%` : ""}{s.stopRoomPct != null && s.style === "quick" && !s.targetMint ? ` · allows about −${s.stopRoomPct}%` : ""}{s.neverSellAtLoss ? " · Recovery hold (−12% emergency limit)" : ""}</span>
              <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {s.unlimitedWindow ? "no timer — runs until you stop it" : timeLeft(s.windowEndAt)}</span>
              <span className="flex items-center gap-1" data-testid={`text-active-time-${s.id}`}><Waves className="w-3 h-3" /> active {fmtActiveTime(activeTimeMs(s))}</span>
              {(s.status === "active" || s.status === "paused" || s.status === "awaiting_funds") && (
                <button
                  type="button"
                  className="underline text-xs text-muted-foreground"
                  onClick={() => setShowTimerEdit((v) => !v)}
                  data-testid={`button-edit-timer-${s.id}`}
                >
                  {showTimerEdit ? "close" : "change timer"}
                </button>
              )}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="outline" className={statusColor[s.status]} data-testid={`badge-status-${s.id}`}>{s.status.replace("_", " ")}</Badge>
            <CollapsibleTrigger asChild>
              <button type="button" className="text-muted-foreground" aria-label={cardOpen ? "Collapse bot" : "Expand bot"} data-testid={`toggle-bot-${s.id}`}>
                {cardOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
              </button>
            </CollapsibleTrigger>
          </div>
        </div>
      </CardHeader>
      <CollapsibleContent>
      <CardContent className="space-y-4">
        {setupSteps && (
          <div className="flex items-center gap-1 flex-wrap rounded-md border border-border p-2 text-xs" data-testid={`panel-setup-steps-${s.id}`}>
            {setupSteps.map((step, i) => {
              const current = !step.done && setupSteps.slice(0, i).every((p) => p.done);
              return (
                <div key={step.label} className="flex items-center gap-1">
                  {i > 0 && <span className="text-muted-foreground/50 mx-0.5">→</span>}
                  <span
                    className={`flex items-center gap-1 rounded-full px-2 py-0.5 border ${
                      step.done
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : current
                          ? "border-[#2eff7b] bg-[#2eff7b]/15 text-emerald-700 dark:text-[#2eff7b] font-semibold shadow-[0_0_10px_rgba(46,255,123,0.5)]"
                          : "border-border text-muted-foreground"
                    }`}
                    data-testid={`step-${s.id}-${i}`}
                  >
                    {step.done ? <CheckCircle2 className="w-3 h-3" /> : current ? <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#2eff7b] opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-[#2eff7b]" /></span> : <Circle className="w-3 h-3" />}
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <AlphaSecondOpinion
          surface="swing"
          subjectId={s.id}
          subjectLabel="this Swing Bot"
          primaryDecision={s.status === "active" ? "Continue monitoring this run" : `Bot is ${s.status.replace("_", " ")}`}
          primaryVerdict={s.status === "active" ? "positive" : "neutral"}
          evidence={{
            status: s.status,
            mode: s.mode,
            pnlPct: totalPnlPct ?? undefined,
            trades: s.tradesExecuted,
            wins: s.wins,
            openPositions: openPositions.length,
            lossCooldown: !!s.lossCooldownUntil && new Date(s.lossCooldownUntil).getTime() > Date.now(),
          }}
        />
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-md border border-border p-2">
            <div className={`text-lg font-bold ${totalPnlPct == null ? "" : totalPnlPct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`} data-testid={`text-bankroll-${s.id}`}>
              {totalValue == null ? "—" : `${fmtSol(totalValue)} SOL`}
            </div>
            <div className="text-xs text-muted-foreground">
              {sweptHome ? "Sent back to your wallet" : s.mode === "paper" ? "Total paper value" : "Bankroll"} {totalPnlPct == null ? "" : `(${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(1)}%)`}
            </div>
            {s.mode === "paper" && !sweptHome && freeCash != null && (
              <div className="mt-0.5 text-[10px] text-muted-foreground" data-testid={`text-paper-value-breakdown-${s.id}`}>
                {fmtSol(freeCash)} free cash + {fmtSol(openValue)} in open positions
              </div>
            )}
            {!sweptHome && bankedLamports > 0 && (
              <div className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5" data-testid={`text-banked-${s.id}`}>
                incl. {fmtSol(bankedLamports)} SOL set aside{s.mode === "live" ? " (sent to your wallet)" : ""}
              </div>
            )}
          </div>
          <div className="rounded-md border border-border p-2">
            <div className={`text-lg font-bold ${pnlLamports >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`} data-testid={`text-pnl-${s.id}`}>
              {pnlLamports >= 0 ? "+" : ""}{fmtSol(pnlLamports)}
            </div>
            <div className="text-xs text-muted-foreground">Closed P&L (SOL)</div>
            {inKindCostLamports > 0 && (
              <div className="text-[10px] text-red-600 dark:text-red-400 mt-0.5" data-testid={`text-inkind-${s.id}`}>
                −{fmtSol(inKindCostLamports)} SOL more went into tokens sent back unsold
              </div>
            )}
          </div>
          <div className="rounded-md border border-border p-2">
            <div className="text-lg font-bold" data-testid={`text-win-rate-${s.id}`}>
              {overallStats.count > 0 ? `${overallStats.winRate}%` : "—"}
            </div>
            <div className="text-xs text-muted-foreground">
              Closed-trade win rate
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              {overallStats.count > 0
                ? `${overallStats.wins} of ${overallStats.count} closed trades won · count, not total profit`
                : "No closed trades yet"}
            </div>
          </div>
        </div>

        {showTimerEdit && (
          <div className="rounded-md border border-border p-3 space-y-2" data-testid={`panel-timer-${s.id}`}>
            <div className="text-sm font-medium">Change the run timer</div>
            <p className="text-xs text-muted-foreground">
              Picking a time starts a fresh countdown from right now — when it ends, positions close and (live) funds return to your wallet. Unlimited removes the end date entirely; everything else (stops, loss brake, your lifetime clock) stays exactly the same.
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-7 gap-2">
              {WINDOW_PRESETS.map((p) => (
                <button
                  key={p.hours}
                  type="button"
                  disabled={windowMut.isPending}
                  onClick={() => windowMut.mutate({ windowHours: p.hours })}
                  className="rounded-md border border-border px-2 py-2 text-xs hover:border-black disabled:opacity-50"
                  data-testid={`button-timer-${p.hours}-${s.id}`}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                disabled={windowMut.isPending || s.unlimitedWindow}
                onClick={() => windowMut.mutate({ unlimitedWindow: true })}
                className={`rounded-md border px-2 py-2 text-xs disabled:opacity-50 ${s.unlimitedWindow ? "border-black bg-black text-white" : "border-border hover:border-black"}`}
                data-testid={`button-timer-unlimited-${s.id}`}
              >
                {s.unlimitedWindow ? "Unlimited ✓" : "Unlimited"}
              </button>
            </div>
            {windowMut.isPending && <p className="text-xs text-muted-foreground">Sign the message in your wallet to confirm…</p>}
          </div>
        )}

        {s.status === "active" && (() => {
          const ageMs = s.lastScanAt ? Date.now() - new Date(s.lastScanAt).getTime() : null;
          // 5 min grace over the 60s cadence: heavy passes (multiple sells,
          // slow RPC confirmations) can legitimately take a few minutes —
          // don't cry wolf with an amber warning during honest work.
          const stale = ageMs == null || ageMs > 5 * 60_000;
          // Phone-sleep false alarm guard: when the device sleeps, the page
          // stops fetching — on wake the FIRST render still shows the
          // pre-sleep snapshot, which looks like the SERVER went quiet when
          // really the PHONE did. Only blame the server if the data we're
          // judging was fetched recently; otherwise say we're catching up.
          const fetchAgeMs = detailQuery.dataUpdatedAt ? Date.now() - detailQuery.dataUpdatedAt : null;
          const dataIsFresh = fetchAgeMs != null && fetchAgeMs < 45_000;
          // ageMs != null: a bot that never checked in keeps the honest
          // "waiting for the first check-in" copy instead.
          const catchingUp = stale && ageMs != null && !dataIsFresh;
          const ageText = ageMs == null ? null : ageMs < 60_000 ? `${Math.max(1, Math.round(ageMs / 1000))}s ago` : `${Math.round(ageMs / 60_000)} min ago`;
          const tone = catchingUp
            ? "border-border bg-muted/30 text-muted-foreground"
            : stale
              ? "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400"
              : "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400";
          return (
            <div
              className={`flex items-start gap-2 rounded-md border p-2 text-xs ${tone}`}
              data-testid={`text-heartbeat-${s.id}`}
            >
              <span className="relative flex h-2 w-2 mt-1 shrink-0">
                {!stale && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60" />}
                <span className={`relative inline-flex rounded-full h-2 w-2 ${catchingUp ? "bg-muted-foreground" : stale ? "bg-amber-500" : "bg-emerald-500"}`} />
              </span>
              <span>
                {catchingUp
                  ? "Reconnecting — your phone or browser was asleep, not the bot. It kept running on the server; fresh numbers arrive in a few seconds."
                  : stale
                    ? ageText
                      ? `No check-in for ${ageText.replace(" ago", "")} — the server may be updating; the bot resumes on its own. If this lasts more than ~10 minutes, use Stop & withdraw.`
                      : "Waiting for the first check-in — should appear within a minute of starting."
                    : <>Alive — checked {ageText}.{s.lastScanNote ? ` ${s.lastScanNote}` : ""}</>}
              </span>
            </div>
          );
        })()}

        <p className="text-[11px] text-muted-foreground" data-testid={`text-fees-${s.id}`}>
           Platform fee: {s.mode === "paper" ? "1.6% startup fee deducted" : "1.6% startup fee collected when started"} · profitable closes may pay the locked rate too · losing trades pay zero. Paid so far: {fmtSol(Number(s.feesPaidLamports ?? "0"))} SOL.
        </p>

        {s.targetMint && s.manualBuy && s.status === "active" && openPositions.length === 0 && (runPositions.length === 0 || s.reentry) && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm flex-wrap" data-testid={`panel-manual-buy-${s.id}`}>
            <div className="min-w-0">
              <p className="font-medium">Waiting for your signal</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {runPositions.length === 0
                  ? "This bot won't buy until you press the button. Once you do, it puts the whole budget in and handles the exit automatically."
                  : "Sold and re-armed. Press the button if you want back in — there's a 10-minute cooldown after each sell, and the bot quits after 2 losing trades in a row."}
              </p>
            </div>
            {confirmBuy ? (
              <div className="flex items-center gap-1 shrink-0">
                <Button size="sm" className="h-8 bg-black text-white hover:bg-black/90" onClick={() => buyMut.mutate()} disabled={buyMut.isPending} data-testid={`button-confirm-buy-${s.id}`}>
                  {buyMut.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null} Yes, buy now
                </Button>
                <Button size="sm" variant="outline" className="h-8" onClick={() => setConfirmBuy(false)} disabled={buyMut.isPending} data-testid={`button-cancel-buy-${s.id}`}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button size="sm" className="h-8 shrink-0 bg-black text-white hover:bg-black/90" onClick={() => setConfirmBuy(true)} disabled={buyMut.isPending} data-testid={`button-buy-now-${s.id}`}>
                Buy now
              </Button>
            )}
          </div>
        )}

        {s.status !== "completed" && (
          <button
            type="button"
            onClick={() => setShowSettings((v) => !v)}
            className="flex w-full items-center justify-between rounded-md border border-border p-2 text-sm"
            data-testid={`button-toggle-settings-${s.id}`}
          >
            <span className="text-muted-foreground">Bot settings{showSettings ? "" : " — tap to open"}</span>
            {showSettings ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>
        )}

        {showSettings && (s.status === "active" || s.status === "paused") && (
          <div className="rounded-md border border-border p-2 text-sm space-y-2" data-testid={`panel-topup-${s.id}`}>
            <div>
              <span className="text-muted-foreground">Top off (add more SOL mid-run)</span>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {s.mode === "live"
                  ? "Optional: add SOL from your wallet while the bot runs — it splits the new cash across your free slots on the very next buys. Total deposits stay under 10 SOL; profits are never capped. No fee on top-ups."
                  : "Optional: add virtual SOL to the paper bankroll while it runs."}
              </p>
            </div>
            <div className="flex gap-2">
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="SOL to add"
                value={topUpAmount}
                onChange={(e) => setTopUpAmount(e.target.value)}
                className="h-9 text-sm"
                data-testid={`input-topup-amount-${s.id}`}
              />
              <Button
                size="sm"
                className="h-9 shrink-0 bg-black text-white hover:bg-black/90"
                onClick={() => topOff()}
                disabled={toppingUp}
                data-testid={`button-topup-${s.id}`}
              >
                {toppingUp ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Wallet className="w-4 h-4 mr-1" />}
                {toppingUp ? "Adding…" : "Add funds"}
              </Button>
            </div>
            {s.mode === "live" && (
              <p className="text-[11px] text-muted-foreground">
                Already sent SOL straight to the worker wallet from your own wallet? The bot is trading it, but "SOL deposited" up top doesn't know about it — type the amount above and tap{" "}
                <button
                  type="button"
                  className="underline font-medium disabled:opacity-60"
                  onClick={() => topOff(true)}
                  disabled={toppingUp}
                  data-testid={`button-record-deposit-${s.id}`}
                >
                  Record it (no SOL moves)
                </button>{" "}
                so your totals and profit % are accurate.
              </p>
            )}
          </div>
        )}

        {showSettings && s.status !== "completed" && !s.targetMint && (
          <div className="rounded-md border border-border p-3 text-sm">
            <SettingHelp
              title="How many tokens can it hold at once?"
              help="More positions create smaller slices and spread exposure across more picks. Changing this affects future buys only."
              testId={`help-positions-${s.id}`}
            />
            <div className="mt-2 grid grid-cols-5 gap-2">
              {POSITION_OPTIONS.map((count) => (
                <button
                  key={count}
                  type="button"
                  disabled={settingsMut.isPending || s.maxPositions === count}
                  onClick={() => settingsMut.mutate({ maxPositions: count })}
                  className={`rounded-md border px-2 py-2 text-xs disabled:opacity-60 ${s.maxPositions === count ? "border-black bg-black text-white" : "border-border"}`}
                  data-testid={`button-positions-${s.id}-${count}`}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>
        )}

        {showSettings && s.status !== "completed" && !s.targetMint && s.universe !== "stocks" && (
          <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3 text-sm">
            <div>
              <SettingHelp
                title="Use the full amount on tokens already rising fast"
                help="Safer default: the bot uses only one quarter of its normal amount when a token has already climbed quickly. Turn this on to use the full amount and accept a much larger loss if the rise suddenly reverses."
                testId={`help-hot-run-${s.id}`}
              />
            </div>
            <Switch
              checked={s.hotStreakFullSize}
              disabled={settingsMut.isPending}
              onCheckedChange={(v) => settingsMut.mutate({ hotStreakFullSize: v })}
              data-testid={`switch-hot-run-full-size-${s.id}`}
            />
          </div>
        )}

        {showSettings && s.status !== "completed" && !s.targetMint && s.universe !== "stocks" && (
          <div className="rounded-md border border-border p-3 text-sm">
             <Label className="mb-1 block">Token age</Label>
            <select
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              value={String(s.minPoolAgeHours ?? 24)}
              disabled={settingsMut.isPending}
              onChange={(e) => settingsMut.mutate({ minPoolAgeHours: Number(e.target.value) })}
              data-testid={`select-min-age-${s.id}`}
            >
              {MIN_AGE_PRESETS.filter((p) => p.value !== "custom").map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
              {![0, 6, 12, 24, 48, 72, 96, 120, 168, 240].includes(s.minPoolAgeHours ?? 24) && (
                <option value={String(s.minPoolAgeHours)}>
                  {(s.minPoolAgeHours ?? 24) >= 96 ? `${Math.round((s.minPoolAgeHours ?? 24) / 24)}+ days` : `${s.minPoolAgeHours}+ hours`} (custom)
                </option>
              )}
            </select>
          </div>
        )}

        {showSettings && s.status !== "completed" && !s.targetMint && (
          <div className="flex items-start justify-between gap-3 rounded-md border border-border p-2 text-sm">
            <div>
              <SettingHelp
                title="Ask me first before buying"
                help="When enabled, the bot still finds and scores candidates but waits for you to approve or dismiss each new buy. Open positions are unaffected."
                testId={`help-approval-${s.id}`}
              />
            </div>
            <Switch
              checked={s.requireApproval}
              disabled={settingsMut.isPending}
              onCheckedChange={(v) => settingsMut.mutate({ requireApproval: v })}
              data-testid={`switch-require-approval-${s.id}`}
            />
          </div>
        )}

        {showSettings && s.status !== "completed" && (
          <div className="rounded-md border border-border p-3 text-sm">
            <SettingHelp
              title="Set aside part of each win"
              help={<>After every winning trade, this share of profit leaves the trading bankroll. {s.mode === "live" ? "Live funds go directly to your withdrawal wallet." : "Paper mode tracks the amount virtually."} A 0% setting keeps all profit in the bankroll.</>}
              testId={`help-skim-${s.id}`}
            />
            <div className="flex flex-wrap items-center gap-1 mt-2">
              {PROFIT_SKIM_OPTIONS.map((pct) => (
                <Button
                  key={pct}
                  size="sm"
                  variant={(s.profitSkimPct ?? 50) === pct ? "default" : "outline"}
                  className={`h-8 px-3 ${(s.profitSkimPct ?? 50) === pct ? "bg-black text-white hover:bg-black/90" : ""}`}
                  onClick={() => settingsMut.mutate({ profitSkimPct: pct })}
                  disabled={settingsMut.isPending || (s.profitSkimPct ?? 50) === pct}
                  data-testid={`button-skim-${pct}-${s.id}`}
                >
                  {pct}%{pct === 50 ? " (default)" : ""}
                </Button>
              ))}
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  placeholder="Custom %"
                  value={customSkim}
                  onChange={(e) => setCustomSkim(e.target.value)}
                  className="h-8 w-24 text-xs"
                  data-testid={`input-skim-custom-${s.id}`}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-2 text-xs"
                  disabled={settingsMut.isPending || customSkim.trim() === "" || !Number.isFinite(Number(customSkim)) || Number(customSkim) < 0 || Number(customSkim) > 100}
                  onClick={() => { settingsMut.mutate({ profitSkimPct: Math.round(Number(customSkim)) }); setCustomSkim(""); }}
                  data-testid={`button-skim-custom-${s.id}`}
                >
                  Set
                </Button>
              </div>
            </div>
          </div>
        )}

        {showSettings && s.status !== "completed" && (
          <div className="rounded-md border border-border p-3 text-sm">
            <SettingHelp
              title="Pause buying after this many losses"
              help="After this many losing trades in a row, the bot waits 30 minutes before buying again. It keeps protecting trades already open, and the bot does not shut down."
              testId={`help-loss-cooloff-${s.id}`}
            />
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {LOSS_COOLDOWN_OPTIONS.map((count) => (
                <Button
                  key={count}
                  size="sm"
                  variant={s.lossStopCount === count ? "default" : "outline"}
                  className={`h-8 px-3 ${s.lossStopCount === count ? "bg-black text-white hover:bg-black/90" : ""}`}
                  disabled={settingsMut.isPending || s.lossStopCount === count}
                  onClick={() => settingsMut.mutate({ lossStopCount: count })}
                  data-testid={`button-loss-cooldown-${s.id}-${count}`}
                >
                  {count}{count === 4 ? " (default)" : ""}
                </Button>
              ))}
              <Input
                type="number"
                min="1"
                max="20"
                value={customLossStop}
                onChange={(event) => setCustomLossStop(event.target.value)}
                placeholder="Custom"
                className="h-8 w-24 text-xs"
                data-testid={`input-loss-cooldown-${s.id}`}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2 text-xs"
                disabled={settingsMut.isPending || customLossStop.trim() === "" || !Number.isInteger(Number(customLossStop)) || Number(customLossStop) < 1 || Number(customLossStop) > 20}
                onClick={() => {
                  settingsMut.mutate({ lossStopCount: Number(customLossStop) });
                  setCustomLossStop("");
                }}
                data-testid={`button-loss-cooldown-custom-${s.id}`}
              >
                Set
              </Button>
            </div>
          </div>
        )}

        {showSettings && s.status !== "completed" && s.universe === "stocks" && (
          <div className="rounded-md border border-border p-3 text-sm">
            <SettingHelp
              title="Profit exit"
              help="Automatic lets the bot use stock momentum, confirmed reversals, and its backup trailing protection. A fixed target closes the paper trade as soon as that gain is reached."
              testId={`help-stock-profit-exit-${s.id}`}
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              {[
                { value: null, label: "Automatic", detail: "read the stock's movement" },
                { value: 5, label: "+5%", detail: "bank smaller wins sooner" },
                { value: 10, label: "+10%", detail: "balanced fixed target" },
                { value: 20, label: "+20%", detail: "wait for a larger move" },
              ].map((option) => (
                <button
                  key={option.label}
                  type="button"
                  disabled={settingsMut.isPending || s.takeProfitPct === option.value}
                  onClick={() => settingsMut.mutate({ takeProfitPct: option.value })}
                  className={`rounded-md border px-2 py-2 text-left text-xs disabled:opacity-60 ${s.takeProfitPct === option.value ? "border-black bg-black text-white" : "border-border"}`}
                  data-testid={`button-stock-profit-exit-${s.id}-${option.value ?? "automatic"}`}
                >
                  <span className="block font-semibold">{option.label}</span>
                  <span className="block opacity-70">{option.detail}</span>
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-1">
              <Input
                type="number"
                min="3"
                max="500"
                step="1"
                placeholder="Custom profit %"
                value={customTp}
                onChange={(e) => setCustomTp(e.target.value)}
                className="h-8 flex-1 text-xs"
                data-testid={`input-stock-profit-custom-${s.id}`}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2 text-xs"
                disabled={settingsMut.isPending || customTp.trim() === "" || !Number.isFinite(Number(customTp)) || Number(customTp) < 3 || Number(customTp) > 500}
                onClick={() => { settingsMut.mutate({ takeProfitPct: Math.round(Number(customTp)) }); setCustomTp(""); }}
                data-testid={`button-stock-profit-custom-${s.id}`}
              >
                Set
              </Button>
            </div>
          </div>
        )}

        {showSettings && s.status !== "completed" && !s.targetMint && (
          <div className="rounded-md border border-border p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <SettingHelp
                title="Liquidity pools"
                help={<>This is the minimum amount available in the market for people to buy and sell. More pool money usually makes it easier to sell near the price shown. Less pool money finds more tokens, but prices can move sharply and exits can be harder. $40K+ is the default.</>}
                testId={`help-liquidity-${s.id}`}
              />
              <button
                type="button"
                disabled={settingsMut.isPending}
                onClick={() => {
                  const patch: { minLiquidityUsd?: number; stopRoomPct?: number | null; conservativeProfit?: boolean; takeProfitPct?: number | null; maxPositions?: number } = {};
                  if (s.minLiquidityUsd !== 40000) patch.minLiquidityUsd = 40000;
                  if (s.style === "quick" && s.stopRoomPct != null) patch.stopRoomPct = null;
                  if (s.style === "quick" && s.conservativeProfit) patch.conservativeProfit = false;
                  if (s.style === "quick" && s.takeProfitPct != null) patch.takeProfitPct = null;
                  if (s.style === "quick" && s.maxPositions !== 1) patch.maxPositions = 1;
                  if (Object.keys(patch).length > 0) settingsMut.mutate(patch);
                }}
                className="shrink-0 rounded-md border border-border px-2 py-1 text-[10px] font-medium disabled:opacity-60"
                data-testid={`button-use-recommended-${s.id}`}
              >
                Reset defaults
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {LIQUIDITY_OPTIONS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  disabled={settingsMut.isPending}
                  onClick={() => { if (p.value !== s.minLiquidityUsd) settingsMut.mutate({ minLiquidityUsd: p.value }); }}
                  className={`rounded-md border px-2 py-2 text-xs disabled:opacity-60 ${s.minLiquidityUsd === p.value ? "border-black bg-black text-white" : "border-border"}`}
                  data-testid={`button-careful-${s.id}-${p.value}`}
                >
                  <span className="block font-semibold">{p.label}{p.recommended ? " · Default" : ""}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 mt-2">
              <Input
                type="number"
                min="5000"
                max="1000000"
                step="1000"
                placeholder="Custom $ (5,000–1,000,000)"
                value={customLiq}
                onChange={(e) => setCustomLiq(e.target.value)}
                className="h-8 flex-1 text-xs"
                data-testid={`input-liq-custom-${s.id}`}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2 text-xs"
                disabled={settingsMut.isPending || customLiq.trim() === "" || !Number.isFinite(Number(customLiq)) || Number(customLiq) < 5000 || Number(customLiq) > 1000000}
                onClick={() => { settingsMut.mutate({ minLiquidityUsd: Math.round(Number(customLiq)) }); setCustomLiq(""); }}
                data-testid={`button-liq-custom-${s.id}`}
              >
                Set
              </Button>
            </div>
            {settingsMut.isPending && <p className="text-[11px] text-muted-foreground mt-1">Sign the message in your wallet to confirm the change…</p>}
          </div>
        )}

        {showSettings && s.status !== "completed" && (
          <div className="rounded-md border border-border p-3 text-sm space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <SettingHelp title="Never sell at a loss — recovery hold" help="Gives an ordinary red trade more time instead of using the normal tight stop. The bot still exits when both short and hourly evidence confirm continued decline, when liquidity drains, or at a firm −12% maximum-loss backstop. A fast rug can still fill below that level." testId={`help-never-sell-${s.id}`} />
              </div>
              <Switch
                checked={s.neverSellAtLoss ?? false}
                disabled={settingsMut.isPending}
                onCheckedChange={(v) => settingsMut.mutate({ neverSellAtLoss: v })}
                data-testid={`switch-never-sell-loss-${s.id}`}
              />
            </div>
            {s.mode === "live" && <div>
              <SettingHelp title="If the run ends while a trade is still underwater" help="Choose whether a live bot sends unsold tokens to your wallet or sells them when the run timer ends. Paper positions always close virtually." testId={`help-red-end-${s.id}`} />
              <div className="grid grid-cols-2 gap-2 mt-1">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={settingsMut.isPending}
                    onClick={() => { if ((s.redEndBehavior ?? "sell") !== "send_tokens") settingsMut.mutate({ redEndBehavior: "send_tokens" }); }}
                    className={`flex-1 rounded-md border px-2 py-2 text-xs text-left disabled:opacity-60 ${(s.redEndBehavior ?? "sell") === "send_tokens" ? "border-black bg-black text-white" : "border-border"}`}
                    data-testid={`button-redend-send-${s.id}`}
                  >
                    <span className="block font-semibold">Send me the tokens</span>
                  </button>
                  <SettingHelp
                    title="Send me the tokens"
                    help="Never sells red at the end — the tokens go to your wallet and you decide when to sell. Live bots only; paper just closes."
                    testId={`help-red-end-send-${s.id}`}
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={settingsMut.isPending}
                    onClick={() => { if ((s.redEndBehavior ?? "sell") !== "sell") settingsMut.mutate({ redEndBehavior: "sell" }); }}
                    className={`flex-1 rounded-md border px-2 py-2 text-xs text-left disabled:opacity-60 ${(s.redEndBehavior ?? "sell") === "sell" ? "border-black bg-black text-white" : "border-border"}`}
                    data-testid={`button-redend-sell-${s.id}`}
                  >
                    <span className="block font-semibold">Sell it anyway</span>
                  </button>
                  <SettingHelp
                    title="Sell it anyway"
                    help="The run always fully wraps up on its own — only SOL comes home, even at a loss."
                    testId={`help-red-end-sell-${s.id}`}
                  />
                </div>
              </div>
            </div>}
          </div>
        )}
        {showSettings && s.status !== "completed" && !s.targetMint && (
          <div className="rounded-md border border-border p-3 text-sm space-y-3">
            {s.style === "quick" && (
              <div>
                <div className="mb-3">
                  <SettingHelp title="When should it bank a profit?" help="Automatic usually banks a real executable +3% when the rise stops clearly continuing. A fixed target sells immediately when the executable profit reaches your percentage, including positions already open." testId={`help-profit-target-${s.id}`} />
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    {[
                      { value: null, label: "Automatic" },
                      { value: 3, label: "+3%" },
                      { value: 5, label: "+5%" },
                      { value: 10, label: "+10%" },
                    ].map((option) => (
                      <Button
                        key={option.label}
                        size="sm"
                        variant={s.takeProfitPct === option.value ? "default" : "outline"}
                        className={`h-8 px-3 ${s.takeProfitPct === option.value ? "bg-black text-white hover:bg-black/90" : ""}`}
                        disabled={settingsMut.isPending || s.takeProfitPct === option.value}
                        onClick={() => settingsMut.mutate({
                          takeProfitPct: option.value,
                          ...(option.value !== null && s.winnerKeepPct === 40 ? { winnerKeepPct: null } : {}),
                        })}
                        data-testid={`button-profit-target-${s.id}-${option.value ?? "automatic"}`}
                      >
                        {option.label}
                      </Button>
                    ))}
                    <Input
                      type="number"
                      min="3"
                      max="500"
                      step="1"
                      placeholder="Custom %"
                      value={customTp}
                      onChange={(e) => setCustomTp(e.target.value)}
                      className="h-8 w-24 text-xs"
                      data-testid={`input-profit-target-custom-${s.id}`}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2 text-xs"
                      disabled={settingsMut.isPending || customTp.trim() === "" || !Number.isFinite(Number(customTp)) || Number(customTp) < 3 || Number(customTp) > 500}
                      onClick={() => {
                        settingsMut.mutate({
                          takeProfitPct: Math.round(Number(customTp)),
                          ...(s.winnerKeepPct === 40 ? { winnerKeepPct: null } : {}),
                        });
                        setCustomTp("");
                      }}
                      data-testid={`button-profit-target-custom-${s.id}`}
                    >
                      Set
                    </Button>
                  </div>
                </div>
                <div className="mb-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3" data-testid={`automatic-small-win-plan-${s.id}`}>
                  <strong>{s.winnerKeepPct === 40 ? "Runner mode" : s.takeProfitPct == null ? "Automatic small-win plan" : `Your +${s.takeProfitPct}% profit target`}</strong>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {s.winnerKeepPct === 40
                      ? "The routine +3% small-win sale is off. The bot gives a winner its widest room to develop, while confirmed reversals, liquidity danger, and loss protection still apply."
                      : s.takeProfitPct == null
                      ? "Banks a real executable +3% unless fresh short-term and hourly signals clearly keep rising. A strong continuation can run, but once that signal fades the bot protects the gain before it turns into a loss. The sold token stays on a guarded six-hour re-entry watch and must prove a comeback before the bot buys it again."
                      : `Sells when a real executable quote reaches +${s.takeProfitPct}%. This fixed target overrides the automatic small-win timing.`}
                  </p>
                </div>
                 <SettingHelp title="How far may a trade fall?" help={<>Automatic protection adjusts to the position's own behavior. It starts cautious, gives a proven climber more room, and exits when the evidence turns bad. Choose a percentage only if you want to override that adjustment.</>} testId={`help-stop-room-${s.id}`} />
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {STOP_ROOM_OPTIONS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      disabled={settingsMut.isPending}
                      onClick={() => {
                        if (p.value !== s.stopRoomPct) {
                          settingsMut.mutate({
                            stopRoomPct: p.value,
                            ...(p.value !== null ? { conservativeProfit: false } : {}),
                          });
                        }
                      }}
                      className={`rounded-md border px-2 py-2 text-xs disabled:opacity-60 ${s.stopRoomPct === p.value ? "border-black bg-black text-white" : "border-border"}`}
                      data-testid={`button-stoproom-${s.id}-${p.label}`}
                    >
                      <span className="block font-semibold">{p.label}</span>
                      <span className="block opacity-70">{p.detail}</span>
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1 mt-2">
                  <Input
                    type="number"
                    min="2"
                    max="50"
                    step="1"
                    placeholder="Custom % (2–50)"
                    value={customStop}
                    onChange={(e) => setCustomStop(e.target.value)}
                    className="h-8 flex-1 text-xs"
                    data-testid={`input-stoproom-custom-${s.id}`}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-2 text-xs"
                    disabled={settingsMut.isPending || customStop.trim() === "" || !Number.isFinite(Number(customStop)) || Number(customStop) < 2 || Number(customStop) > 50}
                    onClick={() => {
                      settingsMut.mutate({
                        stopRoomPct: Math.round(Number(customStop)),
                        conservativeProfit: false,
                      });
                      setCustomStop("");
                    }}
                    data-testid={`button-stoproom-custom-${s.id}`}
                  >
                    Set
                  </Button>
                </div>
                {settingsMut.isPending && <p className="text-[11px] text-muted-foreground mt-1">Sign the message in your wallet to confirm the change…</p>}
                <div className="mt-3">
                  <SettingHelp title="How much of the best gain should it keep?" help="Automatic adjusts to the strength of each token. Choosing a percentage protects that fixed share of the best gain; a smaller share gives runners more room but may hand back more profit." testId={`help-winner-room-${s.id}`} />
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    {WINNER_KEEP_OPTIONS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        disabled={settingsMut.isPending}
                        onClick={() => {
                          if (p.value !== s.winnerKeepPct) {
                            settingsMut.mutate({
                              winnerKeepPct: p.value,
                              ...(p.value === 40 && s.takeProfitPct != null ? { takeProfitPct: null } : {}),
                            });
                          }
                        }}
                        className={`rounded-md border px-2 py-2 text-xs disabled:opacity-60 ${s.winnerKeepPct === p.value ? "border-black bg-black text-white" : "border-border"}`}
                        data-testid={`button-winnerroom-${s.id}-${p.label}`}
                      >
                        <span className="block font-semibold">{p.label}</span>
                        <span className="block opacity-70">{p.detail}</span>
                      </button>
                    ))}
                  </div>
                   <div className="mt-2 flex items-center gap-1">
                     <Input
                       type="number"
                       min="40"
                       max="90"
                       step="1"
                       placeholder="Custom %"
                       value={customWinner}
                       onChange={(e) => setCustomWinner(e.target.value)}
                       className="h-8 flex-1 text-xs"
                       data-testid={`input-winnerroom-custom-${s.id}`}
                     />
                     <Button
                       size="sm"
                       variant="outline"
                       className="h-8 px-2 text-xs"
                       disabled={settingsMut.isPending || customWinner.trim() === "" || !Number.isFinite(Number(customWinner)) || Number(customWinner) < 40 || Number(customWinner) > 90}
                       onClick={() => {
                         const keep = Math.round(Number(customWinner));
                         settingsMut.mutate({
                           winnerKeepPct: keep,
                           ...(keep === 40 && s.takeProfitPct != null ? { takeProfitPct: null } : {}),
                         });
                         setCustomWinner("");
                       }}
                       data-testid={`button-winnerroom-custom-${s.id}`}
                     >
                       Set
                     </Button>
                   </div>
                  {settingsMut.isPending && <p className="text-[11px] text-muted-foreground mt-1">Sign the message in your wallet to confirm the change…</p>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Saved settings presets — memorize the dials you're liking, name
            them, star the favorite, and apply them to another bot later. */}
        {showSettings && s.status !== "completed" && !s.targetMint && (
          <div className="rounded-md border border-border p-2 text-sm space-y-3" data-testid={`presets-section-${s.id}`}>
            <div>
              <span className="text-muted-foreground">My favorite settings</span>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Liking how this bot is dialed in? Save a named snapshot of every setting above. You can apply a saved preset to any {STYLE_LABEL[s.style] ?? s.style} bot — including new ones — and star the one you trust most.
              </p>
            </div>
            <div className="flex gap-2">
              <Input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder={`Name these settings (e.g. "Steady grinder")`}
                maxLength={48}
                className="h-8 text-xs"
                data-testid={`input-preset-name-${s.id}`}
              />
              <Button
                size="sm"
                className="h-8 px-3 shrink-0"
                disabled={!presetName.trim() || savePresetMut.isPending}
                onClick={() => savePresetMut.mutate(presetName.trim())}
                data-testid={`button-save-preset-${s.id}`}
              >
                Save current
              </Button>
            </div>
            {myPresets.length > 0 && (
              <div className="space-y-1.5">
                {myPresets.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5" data-testid={`preset-row-${p.id}`}>
                    <button
                      type="button"
                      title={p.starred ? "Unstar" : "Star as favorite"}
                      disabled={starPresetMut.isPending}
                      onClick={() => starPresetMut.mutate({ id: p.id, starred: !p.starred })}
                      data-testid={`button-star-preset-${p.id}`}
                    >
                      <Star className={`w-4 h-4 ${p.starred ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{p.name}</span>
                      <span className="block text-[10px] text-muted-foreground truncate">
                        {STYLE_LABEL[p.style] ?? p.style}{p.sourceStrategyName ? ` · from ${p.sourceStrategyName}` : ""}
                      </span>
                    </div>
                    {p.style === s.style ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs shrink-0"
                        disabled={applyPresetMut.isPending}
                        onClick={() => applyPresetMut.mutate(p.id)}
                        data-testid={`button-apply-preset-${p.id}`}
                      >
                        Apply here
                      </Button>
                    ) : (
                      <span className="text-[10px] text-muted-foreground shrink-0">other style</span>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs shrink-0 text-muted-foreground"
                      disabled={deletePresetMut.isPending}
                      onClick={() => deletePresetMut.mutate(p.id)}
                      data-testid={`button-delete-preset-${p.id}`}
                    >
                      Delete
                    </Button>
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground">
                  Applying a preset changes only the dials above — never the bot's budget, live/paper mode, or style. The bot's notes will list exactly what changed.
                </p>
              </div>
            )}
          </div>
        )}

        {s.mode === "live" && (
          <div className="rounded-md border border-border p-3 text-sm space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Worker wallet</span>
              <button className="flex items-center gap-1 font-mono" onClick={copyWorker} data-testid={`button-copy-worker-${s.id}`}>
                {shortAddr(s.workerWallet)} <Copy className="w-3 h-3" /> {copied ? "copied" : ""}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Free SOL <span className="text-[10px]">(cash waiting to be invested)</span></span>
              <span>{workerBalance == null ? "—" : `${fmtSol(workerBalance)} SOL`}</span>
            </div>
            {(s.status === "awaiting_funds" || canRestart) && (
              <div className="pt-2 space-y-2">
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {s.status === "awaiting_funds"
                    ? `Fund the bot's trading wallet, then press Start. Suggested: ${recommendedSol.toFixed(4)} SOL (your budget + a little for swap fees).`
                    : workerBalance != null && Number(workerBalance) >= 10_000_000
                       ? `The bot's wallet already has ${fmtSol(workerBalance)} SOL to trade with — just press Restart bot. Top up below only if you want a bigger bankroll.`
                       : "To go again, top up the bot's wallet below, then press Restart bot right away (a finished bot auto-returns idle funds to your wallet after a few minutes)."}
                </p>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder={`${recommendedSol.toFixed(4)}`}
                    value={fundAmount}
                    onChange={(e) => setFundAmount(e.target.value)}
                    className="h-9 text-sm"
                    data-testid={`input-fund-amount-${s.id}`}
                  />
                  <Button
                    size="sm"
                    className={`h-9 shrink-0 ${needsFunding ? NEON : "bg-black text-white hover:bg-black/90"}`}
                    onClick={fundWorker}
                    disabled={funding}
                    data-testid={`button-fund-${s.id}`}
                  >
                    {funding ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Wallet className="w-4 h-4 mr-1" />}
                    {funding ? "Sending…" : "Fund from wallet"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {(s.status === "awaiting_funds" || s.status === "paused" || canRestart) && (
            <Button size="sm" onClick={() => startMut.mutate()} disabled={startMut.isPending} className={readyToStart ? NEON : "bg-black text-white hover:bg-black/90"} data-testid={`button-start-${s.id}`}>
              {startMut.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Play className="w-4 h-4 mr-1" />} {canRestart ? "Restart bot" : "Start"}
            </Button>
          )}
          {s.status === "active" && (
            <Button size="sm" variant="outline" onClick={() => pauseMut.mutate()} disabled={pauseMut.isPending} data-testid={`button-pause-${s.id}`}>
              {pauseMut.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Pause className="w-4 h-4 mr-1" />} Pause
            </Button>
          )}
          {s.status !== "stopped" && s.status !== "completed" && (
            <Button size="sm" variant="outline" onClick={() => stopMut.mutate()} disabled={stopMut.isPending} data-testid={`button-stop-${s.id}`}>
              {stopMut.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Square className="w-4 h-4 mr-1" />} {s.mode === "live" ? "Stop & withdraw" : "Stop"}
            </Button>
          )}
          {s.mode === "live" && (s.status === "stopped" || s.status === "completed") && (openPositions.length > 0 || (workerBalance != null && Number(workerBalance) > 20_000)) && (
            <Button size="sm" variant="outline" onClick={() => stopMut.mutate()} disabled={stopMut.isPending} data-testid={`button-withdraw-again-${s.id}`}>
              {stopMut.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Square className="w-4 h-4 mr-1" />} Withdraw again
            </Button>
          )}
        </div>
        {s.status === "paused" && (
          <p className="text-xs text-amber-600 dark:text-amber-400">Paused = fully asleep: no new buys AND no exit checks. Stop-losses will not fire while paused.</p>
        )}
        {s.status === "active" && s.lossCooldownUntil && new Date(s.lossCooldownUntil).getTime() > Date.now() && (
          <p className="text-xs text-amber-600 dark:text-amber-400" data-testid={`text-cooldown-${s.id}`}>
            Cooling off after a losing streak — no new buys until {new Date(s.lossCooldownUntil).toLocaleTimeString()}. Open positions keep full exit protection; the run itself never stops on its own.
          </p>
        )}

        {/* Watching list — starred tokens front and center, no scrolling */}
        {!s.targetMint && (
          <div className="rounded border border-amber-400 bg-amber-50 dark:bg-amber-950/40 p-2" data-testid="section-watching">
            <div className="flex items-center gap-1.5 text-sm font-semibold mb-1.5 text-amber-700 dark:text-amber-400">
              <Star className="w-4 h-4 fill-amber-400 text-amber-400" /> Watching for a re-entry
            </div>
            {/* Search any token by address, add it to this watchlist, then buy it below. */}
            <div className="flex gap-1.5 mb-2">
              <Input
                value={watchAddr}
                onChange={(e) => setWatchAddr(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addWatch(); }}
                placeholder="Paste a Solana token address to watch…"
                className="h-7 text-[11px]"
                data-testid={`input-watch-add-${s.id}`}
              />
              <Button size="sm" className="h-7 px-2 text-[11px] font-semibold bg-black text-white hover:bg-black/90 shrink-0" onClick={addWatch} disabled={rebuyMut.isPending} data-testid={`button-watch-add-${s.id}`}>
                <Plus className="w-3 h-3 mr-1" /> Add
              </Button>
            </div>
            {(s.rebuyMints ?? []).length === 0 ? (
              <p className="text-[11px] text-muted-foreground" data-testid={`text-watch-empty-${s.id}`}>No tokens on the watchlist yet. Paste an address above to watch one — then tap "Buy now" when you want in. Every buy still runs the full safety check first.</p>
            ) : (
            <div className="space-y-1">
              {(s.rebuyMints ?? []).map((mint) => {
                const meta = watchNames[mint];
                const known = closedPositions.find((c) => c.mint === mint);
                const sym = (meta?.name || meta?.symbol || known?.symbol || (mint.slice(0, 4) + "…" + mint.slice(-4))).slice(0, 32);
                return (
                  <div key={mint} className="flex flex-wrap items-center justify-between gap-1.5 text-xs" data-testid={`row-watching-${mint}`}>
                    <span className="font-medium flex flex-wrap items-center gap-2 min-w-0">
                      {sym}
                      <a
                        href={`https://dexscreener.com/solana/${mint}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => openNewWindow(e, `https://dexscreener.com/solana/${mint}`)}
                        className="flex items-center gap-0.5 text-muted-foreground underline font-normal"
                        data-testid={`link-chart-watching-${mint}`}
                      >
                        <LineChart className="w-3 h-3" /> chart
                      </a>
                      <CopyMintButton mint={mint} testId={`button-copy-watching-${mint}`} />
                    </span>
                    <span className="flex flex-wrap items-center justify-end gap-1">
                      {(() => {
                        const buying = buyMintNowMut.isPending && buyMintNowMut.variables === mint;
                        const stopping = rebuyMut.isPending && rebuyMut.variables === mint;
                        const assessing = assessMut.isPending && assessMut.variables?.mint === mint && assessMut.variables?.surface === "watch";
                        const busy = buying || stopping || assessing;
                        // FOMO-brake: "Buy now" first shows WHY the bot hasn't
                        // re-bought this watched token (the live tape facts), then
                        // Wait / Proceed. The wallet signature only opens on Proceed.
                        if (assessResult?.mint === mint && assessResult.surface === "watch") {
                          return (
                            <span className="flex flex-wrap items-center gap-1">
                              <span className={`w-full text-[11px] font-semibold ${assessResult.wouldBuy ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`} data-testid={`text-watching-buycheck-headline-${mint}`}>
                                {assessResult.headline}
                              </span>
                              <ul className="w-full text-[10px] text-muted-foreground list-disc pl-4 space-y-0.5" data-testid={`list-watching-buycheck-facts-${mint}`}>
                                {assessResult.facts.map((f, i) => <li key={i}>{f}</li>)}
                              </ul>
                              <span className="w-full text-[9px] text-muted-foreground italic">This is just how the bot analyzes it — not financial advice. The decision is always yours.</span>
                              <Button size="sm" variant="ghost" className="w-full h-7 px-2 text-[11px] font-semibold border border-border" onClick={() => setAssessResult(null)} disabled={buying} data-testid={`button-watching-buycheck-wait-${mint}`}>
                                Stop, don't buy
                              </Button>
                              <Button size="sm" className="w-full h-7 px-2 text-[11px] font-semibold bg-amber-300 text-black hover:bg-amber-200 border border-amber-500" onClick={() => buyMintNowMut.mutate(mint)} disabled={buying} data-testid={`button-watching-buycheck-proceed-${mint}`}>
                                {buying ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null} Proceed anyway
                              </Button>
                            </span>
                          );
                        }
                        return (
                          <>
                            <Button size="sm" className="h-6 px-2 text-[11px] font-semibold bg-lime-400 text-black hover:bg-lime-300 border border-lime-500" onClick={() => assessMut.mutate({ mint, surface: "watch" })} disabled={busy} data-testid={`button-watching-buynow-${mint}`}>
                              {assessing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null} Buy now
                            </Button>
                            <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] font-normal" onClick={() => rebuyMut.mutate(mint)} disabled={busy} data-testid={`button-watching-stop-${mint}`}>
                              Stop watching
                            </Button>
                          </>
                        );
                      })()}
                    </span>
                  </div>
                );
              })}
            </div>
            )}
          </div>
        )}

        {/* Never-buy list — the tokens the owner banned; one tap to allow back */}
        {!s.targetMint && (s.blockedMints ?? []).length > 0 && (
          <div className="rounded border border-red-400 bg-red-50 dark:bg-red-950/40 p-2" data-testid="section-blocked">
            <div className="flex items-center gap-1.5 text-sm font-semibold mb-1.5 text-red-700 dark:text-red-400">
              <Ban className="w-4 h-4" /> Never buying these
            </div>
            <div className="space-y-1">
              {(s.blockedMints ?? []).map((mint) => {
                const known = closedPositions.find((c) => c.mint === mint);
                const sym = known?.symbol ?? mint.slice(0, 4) + "…" + mint.slice(-4);
                return (
                  <div key={mint} className="flex flex-wrap items-center justify-between gap-1.5 text-xs" data-testid={`row-blocked-${mint}`}>
                    <span className="font-medium flex flex-wrap items-center gap-2 min-w-0">
                      {sym}
                      <a href={`https://dexscreener.com/solana/${mint}`} target="_blank" rel="noreferrer" onClick={(e) => openNewWindow(e, `https://dexscreener.com/solana/${mint}`)} className="flex items-center gap-0.5 text-muted-foreground underline font-normal" data-testid={`link-chart-blocked-${mint}`}>
                        <LineChart className="w-3 h-3" /> chart
                      </a>
                    </span>
                    <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] font-normal border-red-400 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40" onClick={() => blockMut.mutate(mint)} disabled={blockMut.isPending} data-testid={`button-blocked-allow-${mint}`}>
                      Allow again
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* "Ask me first": picks waiting for the owner's OK */}
        {s.requireApproval && buySignals.length > 0 && (
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold mb-1"><Activity className="w-4 h-4" /> Waiting for your OK</div>
            <p className="text-[11px] text-muted-foreground mb-2">
              The bot found these and is holding off. Approving buys the token at the current price — check the chart first if you like.
            </p>
            <div className="space-y-1">
              {buySignals.map((sig) => {
                const busy = approveSignalMut.isPending || dismissSignalMut.isPending;
                return (
                  <div key={sig.id} className="text-xs rounded border border-border p-2 space-y-2" data-testid={`row-signal-${sig.id}`}>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold" data-testid={`text-signal-symbol-${sig.id}`}>{sig.symbol || "Token"}</span>
                        <a
                          href={`https://dexscreener.com/solana/${sig.mint}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => openNewWindow(e, `https://dexscreener.com/solana/${sig.mint}`)}
                          className="flex items-center gap-0.5 text-muted-foreground underline font-normal"
                          data-testid={`link-chart-signal-${sig.id}`}
                        >
                          View chart ↗
                        </a>
                      </div>
                      <div className="text-muted-foreground break-all">{sig.mint}</div>
                      {sig.reason && <div className="text-muted-foreground mt-1">{sig.reason}</div>}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="bg-black text-white hover:bg-black/90"
                        disabled={busy}
                        onClick={() => approveSignalMut.mutate(sig.id)}
                        data-testid={`button-approve-signal-${sig.id}`}
                      >
                        {approveSignalMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Approve — buy now"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => dismissSignalMut.mutate(sig.id)}
                        data-testid={`button-dismiss-signal-${sig.id}`}
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Open positions */}
        {openPositions.length > 0 && (
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold mb-2"><TrendingUp className="w-4 h-4" /> Open positions</div>
            <div className="space-y-1">
              {openPositions.map((p) => {
                const pnl = posPnlPct(p, s.feeBps);
                const nowNet = netOpenValueLamports(Number(p.lastValueLamports), Number(p.solInLamports), s.feeBps);
                // Same token bought more than once (Buy more / DCA): number the
                // tranches by buy time so "1st buy" vs "2nd buy" is obvious.
                const sameMint = openPositions.filter((x) => x.mint === p.mint);
                const buyIndex = sameMint.length > 1
                  ? [...sameMint].sort((a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime()).findIndex((x) => x.id === p.id) + 1
                  : 0;
                const ordinal = buyIndex === 1 ? "1st" : buyIndex === 2 ? "2nd" : buyIndex === 3 ? "3rd" : `${buyIndex}th`;
                return (
                  <div key={p.id} className="text-xs rounded border border-border p-2" data-testid={`row-position-${p.id}`}>
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="flex flex-wrap items-center gap-2 min-w-0">
                        <a href={`https://solscan.io/token/${p.mint}`} target="_blank" rel="noreferrer" className="font-medium underline">{p.symbol}</a>
                        {buyIndex > 0 && (
                          <span className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground" data-testid={`badge-tranche-${p.id}`}>{ordinal} buy</span>
                        )}
                        <a href={`https://dexscreener.com/solana/${p.mint}`} target="_blank" rel="noreferrer" onClick={(e) => openNewWindow(e, `https://dexscreener.com/solana/${p.mint}`)} className="flex items-center gap-0.5 text-muted-foreground underline" data-testid={`link-chart-${p.id}`}>
                          <LineChart className="w-3 h-3" /> chart
                        </a>
                        <CopyMintButton mint={p.mint} testId={`button-copy-open-${p.id}`} />
                      </span>
                      <span className={pnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                        {pnl >= 0 ? "+" : ""}{pnl.toFixed(1)}%
                      </span>
                    </div>
                    <div className="text-muted-foreground flex items-center justify-between mt-0.5">
                      <span>{fmtSol(p.solInLamports)} SOL in · now {fmtSol(nowNet)} SOL{pnl > 0 ? " after fee" : ""}{fmtPrice(p.entryFillPriceUsd ?? p.entryPriceUsd) ? ` · your fill ${fmtPrice(p.entryFillPriceUsd ?? p.entryPriceUsd)}` : ""}{p.entryFillPriceUsd != null && p.entryPriceUsd != null && p.entryFillPriceUsd > p.entryPriceUsd * 1.01 ? ` (chart was ${fmtPrice(p.entryPriceUsd)} — thin pools fill above the chart)` : ""}</span>
                      <span>{new Date(p.openedAt).toLocaleString()}</span>
                    </div>
                    {pnl < 0 && pnl > -8 && (
                      <div className="text-[10px] text-muted-foreground/80 mt-0.5" data-testid={`text-entry-cost-${p.id}`}>
                        A small red number right after buying is normal — it's the buy fee + the spread to get in, and it's bigger when the pool's liquidity is thin (your buy nudges the price up, so a sell right back would be lower). It's the cost of entry, not the bot losing money — it clears once the price rises past what you paid.
                      </div>
                    )}
                    <div className={`mt-2 flex items-start justify-between gap-3 rounded-md border p-2 ${p.manualHold ? "border-amber-500/50 bg-amber-500/10" : "border-border"}`}>
                      <div>
                        <div className="text-xs font-semibold">Don't sell yet</div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground">
                          {p.manualHold
                            ? "Forced hold is on. Stop-losses, profit-taking, reversals and rug/liquidity exits are paused for this position."
                            : "Turn on to pause every automatic exit for this position."}
                        </div>
                        {p.manualHold && (
                          <div className="mt-1 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                            Sell now still works. Stopping the bot or reaching its run timer also closes it.
                          </div>
                        )}
                      </div>
                      <Switch
                        checked={!!p.manualHold}
                        onCheckedChange={(hold) => positionHoldMut.mutate({ positionId: p.id, hold })}
                        disabled={positionHoldMut.isPending}
                        aria-label={`Don't sell ${p.symbol} yet`}
                        data-testid={`switch-position-hold-${p.id}`}
                      />
                    </div>
                    <div className="flex justify-end gap-1.5 mt-1.5 flex-wrap">
                      {confirmSellId === p.id ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-muted-foreground">Sell {p.symbol} at market now?</span>
                          <Button size="sm" className="h-6 px-2 text-[11px] bg-black text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/80" onClick={() => sellMut.mutate(p.id)} disabled={sellMut.isPending} data-testid={`button-confirm-sell-${p.id}`}>
                            {sellMut.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null} Yes, sell
                          </Button>
                          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => setConfirmSellId(null)} disabled={sellMut.isPending} data-testid={`button-cancel-sell-${p.id}`}>
                            Keep it
                          </Button>
                        </div>
                      ) : confirmBuyMoreId === p.id ? (
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <span className="text-[11px] text-muted-foreground">Put all free SOL into {p.symbol}?</span>
                          <Button size="sm" className="h-6 px-2 text-[11px] bg-black text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/80" onClick={() => buyMoreMut.mutate(p.id)} disabled={buyMoreMut.isPending || swapMut.isPending} data-testid={`button-confirm-buymore-${p.id}`}>
                            {buyMoreMut.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null} Yes, buy more
                          </Button>
                          {openPositions.filter((o) => o.id !== p.id && o.mint !== p.mint).map((o) => (
                            <Button key={o.id} size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => swapMut.mutate({ sellPositionId: o.id, buyPositionId: p.id })} disabled={buyMoreMut.isPending || swapMut.isPending} data-testid={`button-swap-${o.id}-${p.id}`}>
                              {swapMut.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null} Sell {o.symbol} → fund it
                            </Button>
                          ))}
                          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => setConfirmBuyMoreId(null)} disabled={buyMoreMut.isPending || swapMut.isPending} data-testid={`button-cancel-buymore-${p.id}`}>
                            Never mind
                          </Button>
                        </div>
                      ) : (
                        <>
                          {s.status === "active" && !s.targetMint && (
                            <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => { setConfirmSellId(null); setConfirmBuyMoreId(p.id); }} disabled={buyMoreMut.isPending || sellMut.isPending} data-testid={`button-buy-more-${p.id}`}>
                              Buy more
                            </Button>
                          )}
                          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => { setConfirmBuyMoreId(null); setConfirmSellId(p.id); }} disabled={sellMut.isPending || buyMoreMut.isPending} data-testid={`button-sell-now-${p.id}`}>
                            Sell now
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Bot vs you split */}
        {showSplit && (
          <div data-testid="panel-bot-vs-you">
            <div className="text-sm font-semibold mb-2">Who picked what</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded border border-border p-2" data-testid="stat-bot-picks">
                <div className="text-xs text-muted-foreground">Bot's picks</div>
                <div className="text-sm font-semibold" data-testid="text-bot-picks-count">{botStats.count} trade{botStats.count === 1 ? "" : "s"} · {botStats.count > 0 ? `${botStats.winRate}% win` : "—"}</div>
                <div className={`text-sm font-bold ${botStats.net >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`} data-testid="text-bot-picks-net">
                  {botStats.net >= 0 ? "+" : ""}{(botStats.net / 1e9).toFixed(3)} SOL
                </div>
              </div>
              <div className="rounded border border-border p-2" data-testid="stat-your-picks">
                <div className="text-xs text-muted-foreground">Your picks (Buy now)</div>
                <div className="text-sm font-semibold" data-testid="text-your-picks-count">{yourStats.count} trade{yourStats.count === 1 ? "" : "s"} · {yourStats.count > 0 ? `${yourStats.winRate}% win` : "—"}</div>
                <div className={`text-sm font-bold ${yourStats.net >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`} data-testid="text-your-picks-net">
                  {yourStats.net >= 0 ? "+" : ""}{(yourStats.net / 1e9).toFixed(3)} SOL
                </div>
              </div>
            </div>
            {untrackedCount > 0 && (
              <p className="text-[11px] text-muted-foreground mt-1" data-testid="text-untracked-note">
                {untrackedCount} earlier trade{untrackedCount === 1 ? "" : "s"} aren't split — the bot only started labeling who picks each trade from now on.
              </p>
            )}
          </div>
        )}

        {/* Closed trades */}
        {closedPositions.length > 0 && (
          <div>
            <div className="text-sm font-semibold mb-1">Closed trades</div>
            <p className="text-[11px] text-muted-foreground mb-2" data-testid="text-closed-trades-note">
              The % and the second $ price are your real result — worked out from the actual SOL that went in and came back on-chain (fees and the cost of trading in a thin pool included; tap "tx" to verify). The first $ price is the market quote at buy time.
            </p>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {closedPositions.map((p) => {
                const pnl = posPnlPct(p, s.feeBps);
                // Settled in kind: no SOL sale happened, so a % based on the
                // last quote (often a stale pre-rug number) would be a lie.
                const inKind = p.exitReason === "tokens_sent_home";
                return (
                  <div key={p.id} className="text-xs rounded border border-border p-2" data-testid={`row-closed-${p.id}`}>
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="font-medium flex flex-wrap items-center gap-2 min-w-0">
                        {p.symbol} · {p.exitReason === "breakeven_guard"
                          ? (pnl >= 0 ? "breakeven guard (kept the win)" : "breakeven guard (cut a fading trade)")
                          : (EXIT_LABEL[p.exitReason ?? ""] ?? p.exitReason)}
                        <a href={`https://dexscreener.com/solana/${p.mint}`} target="_blank" rel="noreferrer" onClick={(e) => openNewWindow(e, `https://dexscreener.com/solana/${p.mint}`)} className="flex items-center gap-0.5 text-muted-foreground underline font-normal" data-testid={`link-chart-closed-${p.id}`}>
                          <LineChart className="w-3 h-3" /> chart
                        </a>
                        <CopyMintButton mint={p.mint} testId={`button-copy-closed-${p.id}`} />
                        {p.entryTrigger && (
                          <span className={`text-[10px] px-1 rounded font-normal ${p.entryTrigger === "manual" ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-muted text-muted-foreground"}`} data-testid={`badge-picker-${p.id}`}>
                            {p.entryTrigger === "manual" ? "your pick" : "bot"}
                          </span>
                        )}
                        {!s.targetMint && (
                          confirmRebuyId === p.id ? (
                            <span className="flex flex-wrap items-center gap-1">
                              <span className="w-full text-[10px] text-muted-foreground" data-testid={`text-rebuy-help-${p.id}`}>Add this token to your watchlist up top — that's where the "Buy now" button lives when you're ready to buy it again.</span>
                              <Button size="sm" className="w-full h-7 px-2 text-[11px] font-semibold bg-lime-400 text-black hover:bg-lime-300 border border-lime-500" onClick={() => { setConfirmRebuyId(null); rebuyMut.mutate(p.mint); }} disabled={rebuyMut.isPending} data-testid={`button-rebuy-watch-${p.id}`}>
                                {(s.rebuyMints ?? []).includes(p.mint)
                                  ? <><Star className="w-3 h-3 mr-1 fill-black" /> Remove from watchlist</>
                                  : <><Plus className="w-3 h-3 mr-1" /> Add to watchlist</>}
                              </Button>
                              <Button size="sm" variant="outline" className="w-full h-7 px-2 text-[11px] font-semibold border-red-400 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40" onClick={() => { setConfirmRebuyId(null); blockMut.mutate(p.mint); }} disabled={rebuyMut.isPending || blockMut.isPending} data-testid={`button-block-${p.id}`}>
                                <Ban className="w-3 h-3 mr-1" /> Never buy this again
                              </Button>
                              <Button size="sm" variant="ghost" className="w-full h-6 px-1.5 text-[11px] font-normal" onClick={() => setConfirmRebuyId(null)} disabled={rebuyMut.isPending || blockMut.isPending} data-testid={`button-rebuy-cancel-${p.id}`}>
                                Cancel
                              </Button>
                            </span>
                          ) : (s.blockedMints ?? []).includes(p.mint) ? (
                            <Button
                              size="sm"
                              variant="outline"
                              title="You blocked this token — the bot will never buy it. Tap to allow it again."
                              className="h-6 px-2 text-[11px] font-normal border-red-400 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                              onClick={() => blockMut.mutate(p.mint)}
                              disabled={blockMut.isPending}
                              data-testid={`button-unblock-${p.id}`}
                            >
                              <Ban className="w-3 h-3 mr-1" /> Blocked · Allow again
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              title={(s.rebuyMints ?? []).includes(p.mint) ? "In your watchlist up top — tap to manage or to buy it from there" : "Add this token to your watchlist so you can buy it from up top"}
                              className={`h-6 px-2 text-[11px] font-semibold ${(s.rebuyMints ?? []).includes(p.mint) ? "bg-amber-300 text-black hover:bg-amber-200 border border-amber-500" : "bg-lime-400 text-black hover:bg-lime-300 border border-lime-500"}`}
                              onClick={() => setConfirmRebuyId(p.id)}
                              disabled={rebuyMut.isPending}
                              data-testid={`button-rebuy-${p.id}`}
                            >
                              {(s.rebuyMints ?? []).includes(p.mint)
                                ? <><Star className="w-3 h-3 mr-1 fill-black" /> In watchlist</>
                                : <><Plus className="w-3 h-3 mr-1" /> Watchlist</>}
                            </Button>
                          )
                        )}
                      </span>
                      {inKind ? (
                        <span className="text-red-600 dark:text-red-400">not sold — you hold the tokens</span>
                      ) : (
                        <span className={pnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                          {pnl >= 0 ? "+" : ""}{pnl.toFixed(1)}%
                        </span>
                      )}
                    </div>
                    <div className="text-muted-foreground flex items-center justify-between mt-0.5">
                      {/* The sell price shown is the EFFECTIVE fill — entry quote scaled by
                          the actual on-chain SOL ratio — so the price pair always agrees
                          with the % (a raw market quote can look near-breakeven while the
                          real result, after spread/impact/fees, is not — user-hit confusion). */}
                      <span>{inKind ? `${fmtSol(p.solInLamports)} SOL in → tokens sent to your wallet` : `${fmtSol(p.solInLamports)} → ${fmtSol(p.solOutLamports ?? 0)} SOL`}{(() => {
                        const entry = fmtPrice(p.entryPriceUsd);
                        if (!entry) return "";
                        const solIn = Number(p.solInLamports);
                        const solOut = Number(p.solOutLamports ?? 0);
                        const eff = !inKind && solIn > 0 && solOut > 0 && p.entryPriceUsd
                          ? fmtPrice(p.entryPriceUsd * (solOut / solIn))
                          : null;
                        return ` · ${entry}${eff ? ` → ${eff} (your actual result per token)` : ""}`;
                      })()}</span>
                      <span className="flex flex-wrap items-center gap-2">
                        {p.closedAt && <span data-testid={`text-closed-time-${p.id}`}>{new Date(p.closedAt).toLocaleString()}</span>}
                        {p.exitSig && (
                          <a href={`https://solscan.io/tx/${p.exitSig}`} target="_blank" rel="noreferrer" className="underline">tx</a>
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Set-aside record: every profit skim, in one easy-to-read place. */}
        {(skims.length > 0 || BigInt(s.bankedLamports ?? "0") > 0n) && (
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 text-sm font-semibold"><PiggyBank className="w-4 h-4" /> Set-aside record</div>
              <span className="text-xs font-semibold" data-testid={`text-banked-total-${s.id}`}>
                Total: {(Number(BigInt(s.bankedLamports ?? "0")) / LAMPORTS_PER_SOL).toFixed(4)} SOL
              </span>
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              {s.mode === "live"
                ? "After each winning trade, this share of the profit was sent back to your withdraw wallet — out of the bot's reach."
                : "After each winning paper trade, this share of the profit was moved out of the trading bankroll — it can't be re-risked."}
            </p>
            {skims.length === 0 ? (
              <p className="text-xs text-muted-foreground">No individual entries yet — new set-asides will be listed here from now on.</p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {skims.map((e) => (
                  <div key={e.id} className="text-xs rounded border border-border p-2 flex items-center justify-between gap-2" data-testid={`row-skim-${e.id}`}>
                    <span className="break-words [overflow-wrap:anywhere]">
                      <span className="font-semibold">{e.symbol ?? "—"}</span>
                      {e.solLamports ? ` · +${(Number(BigInt(e.solLamports)) / LAMPORTS_PER_SOL).toFixed(4)} SOL` : ""}
                    </span>
                    <span className="text-muted-foreground whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Decision feed */}
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold mb-2"><Activity className="w-4 h-4" /> What it's thinking</div>
          {events.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing yet. Every buy, sell, and skip shows up here with the reason.</p>
          ) : (
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {events.map((e) => (
                <div key={e.id} className="text-xs rounded border border-border p-2" data-testid={`row-event-${e.id}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={
                      e.kind === "buy" ? "font-semibold text-emerald-600 dark:text-emerald-400"
                        : e.kind === "sell" ? "font-semibold text-blue-600 dark:text-blue-400"
                        : e.kind === "error" ? "font-semibold text-red-600 dark:text-red-400"
                        : "font-semibold text-muted-foreground"
                    }>
                      {e.kind.toUpperCase()}{e.symbol ? ` · ${e.symbol}` : ""}
                    </span>
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        {e.kind === "skip" && e.mint && (
                          <a
                            href={`https://dexscreener.com/solana/${e.mint}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(event) => openNewWindow(event, `https://dexscreener.com/solana/${e.mint}`)}
                            className="inline-flex items-center gap-0.5 text-muted-foreground underline font-normal"
                            data-testid={`link-chart-event-${e.id}`}
                            aria-label={`Open ${e.symbol ?? "token"} chart`}
                          >
                            <LineChart className="w-3 h-3" /> chart
                          </a>
                        )}
                        <span className="text-muted-foreground">{new Date(e.createdAt).toLocaleTimeString()}</span>
                      </div>
                  </div>
                  <p className="text-muted-foreground mt-0.5 break-words [overflow-wrap:anywhere]">{e.detail}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {(s.status === "stopped" || s.status === "completed") && !s.targetMint && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm space-y-2" data-testid={`finished-save-panel-${s.id}`}>
            <div>
              <strong>Keep this setup</strong>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Rename the bot with the pencil above, save these settings for another bot, or delete the detailed record. Its win-rate summary remains in your performance history.
              </p>
            </div>
            <div className="flex gap-2">
              <Input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="Name these settings"
                maxLength={48}
                className="h-8 text-xs"
                data-testid={`input-finished-preset-name-${s.id}`}
              />
              <Button
                size="sm"
                className="h-8 shrink-0"
                disabled={!presetName.trim() || savePresetMut.isPending}
                onClick={() => savePresetMut.mutate(presetName.trim())}
                data-testid={`button-finished-save-preset-${s.id}`}
              >
                Save settings
              </Button>
            </div>
          </div>
        )}

        {/* Danger zone — deliberately at the very bottom, far from Withdraw. */}
        {(s.mode === "paper" || s.status !== "active") && (
          <div className="pt-3 border-t border-border space-y-2">
            {confirmDelete ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => deleteMut.mutate()}
                  disabled={deleteMut.isPending}
                  data-testid={`button-confirm-delete-${s.id}`}
                >
                  {deleteMut.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1" />}
                  {deleteMut.isPending
                    ? (s.mode === "paper" ? "Closing positions…" : "Deleting…")
                    : (s.mode === "paper" && s.status === "active" ? "Yes, stop, close & delete" : "Yes, delete forever")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleteMut.isPending} data-testid={`button-cancel-delete-${s.id}`}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="text-red-600 dark:text-red-400"
                onClick={() => setConfirmDelete(true)}
                data-testid={`button-delete-${s.id}`}
              >
                <Trash2 className="w-4 h-4 mr-1" /> Delete this bot
              </Button>
            )}
            {confirmDelete && (
              <p className="text-xs text-red-600 dark:text-red-400" data-testid={`text-delete-warning-${s.id}`}>
                {s.mode === "paper"
                  ? "This stops the bot, closes every open paper position at a verified executable value, then permanently removes its detailed activity. If any position cannot be settled, deletion is cancelled and the bot stays safely locked from trading so you can retry. Its result remains in My performance history."
                  : "This removes the bot and its history permanently. The server double-checks the bot's wallet is empty first — it will refuse if any SOL or tokens are still inside."}
              </p>
            )}
          </div>
        )}
      </CardContent>
      </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
