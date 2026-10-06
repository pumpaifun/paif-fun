import { useEffect, useState } from "react";
import bs58 from "bs58";
import { Header } from "@/components/header";
import { BotTabs } from "@/components/bot-tabs";
import { AlphaSecondOpinion } from "@/components/alpha-second-opinion";
import { Footer } from "@/components/footer";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Shield,
  Plus,
  Trash2,
  Copy,
  Wallet,
  Pause,
  Play,
  X,
  Loader2,
  ArrowDownToLine,
  TrendingUp,
  ChevronDown,
} from "lucide-react";

const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

interface Strategy {
  id: string;
  ownerWallet: string;
  tradingWallet: string;
  withdrawAddress: string;
  name: string;
  status: "awaiting_funds" | "active" | "paused" | "completed" | "cancelled";
  walletCount?: number;
  keepFunds?: boolean;
  wallets?: string[];
  budgetLamports: string;
  spentLamports: string;
  tokens: string[];
  allocationsBps: number[];
  mode: "dca" | "trade" | "volume";
  slippageBps: number;
  windowStartAt: string;
  windowEndAt: string;
  intervalSeconds: number;
  totalSlices: number;
  completedSlices: number;
  buySlices: number;
  takeProfitPct?: number | null;
  takeProfitSellBps?: number | null;
  takeProfitFiredAt?: string | null;
  nextRunAt: string | null;
  createdAt: string;
}

interface Execution {
  id: string;
  tokenMint: string;
  action: string;
  amountLamports: string;
  tokenAmount: string;
  txSignature: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
}

const fmtSol = (lamports: string | number) =>
  (Number(lamports) / LAMPORTS_PER_SOL).toFixed(4);
const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

const statusColor: Record<Strategy["status"], string> = {
  awaiting_funds: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  active: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  paused: "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30",
  completed: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  cancelled: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
};

// ─── Read-session token cache ─────────────────────────────────────────────
// Reads (list/detail) are owner-gated server-side. The owner signs once to mint
// a short-lived token; we cache it (per wallet) so polling doesn't re-prompt.
const READ_TOKEN_KEY = (o: string) => `paif:as-read-token:${o}`;
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
    // Server TTL is 30 min; cache a touch under that so we refresh before expiry.
    localStorage.setItem(READ_TOKEN_KEY(owner), JSON.stringify({ token, exp: Date.now() + 28 * 60_000 }));
  } catch {}
}
function clearCachedToken(owner: string) {
  try {
    localStorage.removeItem(READ_TOKEN_KEY(owner));
  } catch {}
}

export default function StrategyVaultsPage() {
  const { publicKey, connected, sendTransaction, signMessage } = useWallet();
  const { connection } = useConnection();
  const { toast } = useToast();
  const owner = connected ? publicKey?.toBase58() ?? null : null;

  const [readToken, setReadToken] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Pick up a cached, unexpired token whenever the connected wallet changes.
  useEffect(() => {
    setReadToken(owner ? loadCachedToken(owner) : null);
  }, [owner]);

  // Forget the token (e.g. after a 401) so the unlock prompt reappears.
  const forgetToken = () => {
    if (owner) clearCachedToken(owner);
    setReadToken(null);
  };

  // Sign once to mint a read-session token authorizing list/detail polling.
  const unlock = async () => {
    if (!owner || !signMessage) {
      toast({ title: "Connect a wallet that can sign messages", variant: "destructive" });
      return;
    }
    setUnlocking(true);
    try {
      const nonce = Date.now();
      const message = ["paif-auto-strategy", "v1", "read-session", owner, String(nonce)].join("|");
      const signature = bs58.encode(await signMessage(new TextEncoder().encode(message)));
      const res = await apiRequest("POST", "/api/auto-strategy/auth", { ownerWallet: owner, nonce, signature });
      const { token } = await res.json();
      storeCachedToken(owner, token);
      setReadToken(token);
      toast({ title: "Unlocked", description: "You can now view and manage your strategies." });
    } catch (e: any) {
      toast({ title: "Couldn't unlock", description: e.message, variant: "destructive" });
    } finally {
      setUnlocking(false);
    }
  };

  // ─── Builder state ────────────────────────────────────────────────────────
  const [name, setName] = useState("My Strategy");
  const [budgetSol, setBudgetSol] = useState("0.1");
  const [windowHours, setWindowHours] = useState("24");
  const [tradesPerDay, setTradesPerDay] = useState("8");
  const [mode, setMode] = useState<"dca" | "trade" | "volume">("dca");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [slippagePct, setSlippagePct] = useState("1");
  const [walletCount, setWalletCount] = useState("1");
  const [keepFunds, setKeepFunds] = useState(false);
  const [takeProfitEnabled, setTakeProfitEnabled] = useState(false);
  const [takeProfitPct, setTakeProfitPct] = useState("50");
  const [takeProfitSellPct, setTakeProfitSellPct] = useState("100");
  const [tokens, setTokens] = useState<string[]>([""]);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const strategiesQuery = useQuery<{ strategies: Strategy[] }>({
    queryKey: ["/api/auto-strategy/list", owner, readToken],
    enabled: !!owner && !!readToken,
    refetchInterval: 15_000,
    queryFn: async () => {
      try {
        const res = await apiRequest(
          "GET",
          `/api/auto-strategy/list?owner=${owner}`,
          undefined,
          { "x-auto-strategy-token": readToken! },
        );
        return res.json();
      } catch (e: any) {
        if (String(e?.message ?? "").startsWith("401")) forgetToken();
        throw e;
      }
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      if (!owner) throw new Error("Connect your wallet first.");
      const cleaned = tokens.map((t) => t.trim()).filter(Boolean);
      if (cleaned.length === 0) throw new Error("Add at least one token mint.");
      for (const t of cleaned) {
        if (!SOL_ADDR.test(t)) throw new Error(`"${shortAddr(t)}" is not a valid mint address.`);
      }
      // Equal split across tokens; last token absorbs the rounding remainder so
      // allocations always sum to exactly 10000 bps.
      const per = Math.floor(10000 / cleaned.length);
      const alloc = cleaned.map((_, i) =>
        i === cleaned.length - 1 ? 10000 - per * (cleaned.length - 1) : per,
      );
      if (!signMessage) throw new Error("Your wallet can't sign messages — reconnect and try again.");
      // Owner-auth: sign the create so the server binds the new trading wallet to
      // a wallet we actually control (no impersonation).
      const nonce = Date.now();
      const createMsg = ["paif-auto-strategy", "v1", "create", owner, String(nonce)].join("|");
      const signature = bs58.encode(await signMessage(new TextEncoder().encode(createMsg)));
      const res = await apiRequest("POST", "/api/auto-strategy/create", {
        ownerWallet: owner,
        name: name.trim() || "My Strategy",
        budgetSol: parseFloat(budgetSol),
        windowHours: parseInt(windowHours, 10),
        tradesPerDay: parseInt(tradesPerDay, 10),
        mode,
        slippageBps: Math.round(parseFloat(slippagePct) * 100),
        walletCount: Math.max(1, Math.min(10, parseInt(walletCount, 10) || 1)),
        keepFunds,
        tokens: cleaned,
        allocationsBps: alloc,
        // Take-profit is optional — only send when the user turned it on, and
        // never for Volume mode (position stays flat, so there's nothing to TP).
        takeProfitPct:
          takeProfitEnabled && mode !== "volume" ? Math.max(1, parseInt(takeProfitPct, 10) || 0) : undefined,
        takeProfitSellPct:
          takeProfitEnabled && mode !== "volume"
            ? Math.max(1, Math.min(100, parseInt(takeProfitSellPct, 10) || 0))
            : undefined,
        nonce,
        signature,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setCreatedId(data.strategy.id);
      queryClient.invalidateQueries({ queryKey: ["/api/auto-strategy/list", owner] });
      // The new strategy's card (funding + monitoring) is read-token gated, so
      // unlock right away if we don't already have a token — the user needs it
      // to fund and watch the strategy they just created.
      if (!readToken) unlock();
      toast({
        title: "Strategy created",
        description: `Fund the trading wallet with ~${data.recommendedFundingSol.toFixed(4)} SOL to start.`,
      });
    },
    onError: (e: any) =>
      toast({ title: "Couldn't create strategy", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <BotTabs />
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground" data-testid="text-page-title">
            Autonomous DCA Bot
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Set a budget and a time window. The bot buys (and optionally sells) hands-free —
            even with your browser closed.
          </p>
        </div>

        {/* Custody disclosure — security-first, this is the core trust contract */}
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="w-5 h-5 text-emerald-500" />
              How your funds stay safe
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-1.5">
            <p>• Your <strong className="text-foreground">main wallet is never connected to the bot</strong> and never signs a trade.</p>
            <p>• We generate a separate, <strong className="text-foreground">budget-only trading wallet</strong>. You fund it with exactly what you're willing to risk.</p>
            <p>• The bot can only spend up to your budget, only within your time window, and you can <strong className="text-foreground">cancel and withdraw at any moment</strong>.</p>
            <p>• Leftover SOL and tokens always sweep back to <strong className="text-foreground">your main wallet</strong> — funds can go nowhere else.</p>
          </CardContent>
        </Card>

        {!owner && (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              <Wallet className="w-8 h-8 mx-auto mb-3 opacity-60" />
              Connect your wallet to create and manage strategies.
            </CardContent>
          </Card>
        )}

        {owner && (
          <div className="grid lg:grid-cols-2 gap-6">
            {/* ─── Builder ─────────────────────────────────────────────── */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">New strategy</CardTitle>
                <CardDescription>Budget-capped, time-boxed, fully revocable.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* How much */}
                <div className="space-y-1.5">
                  <Label htmlFor="budget">How much to spend (SOL)</Label>
                  <Input
                    id="budget"
                    type="number"
                    min="0.001"
                    step="0.01"
                    value={budgetSol}
                    onChange={(e) => setBudgetSol(e.target.value)}
                    data-testid="input-budget"
                  />
                </div>

                {/* Over what period */}
                <div className="space-y-1.5">
                  <Label>Over what period</Label>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: "12h", hours: "12" },
                      { label: "1 day", hours: "24" },
                      { label: "3 days", hours: "72" },
                      { label: "1 week", hours: "168" },
                    ].map((p) => (
                      <button
                        key={p.hours}
                        type="button"
                        onClick={() => setWindowHours(p.hours)}
                        className={`rounded-md border px-2 py-2 text-sm font-medium transition-colors ${
                          windowHours === p.hours
                            ? "border-emerald-500 bg-emerald-500/10 text-foreground"
                            : "border-border text-muted-foreground hover-elevate"
                        }`}
                        data-testid={`button-period-${p.hours}`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* How active */}
                <div className="space-y-1.5">
                  <Label>How active</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: "Chill", sub: "~3 / day", tpd: "3" },
                      { label: "Normal", sub: "~8 / day", tpd: "8" },
                      { label: "Active", sub: "~20 / day", tpd: "20" },
                    ].map((a) => (
                      <button
                        key={a.tpd}
                        type="button"
                        onClick={() => setTradesPerDay(a.tpd)}
                        className={`rounded-md border px-2 py-2 text-center transition-colors ${
                          tradesPerDay === a.tpd
                            ? "border-emerald-500 bg-emerald-500/10"
                            : "border-border hover-elevate"
                        }`}
                        data-testid={`button-activity-${a.tpd}`}
                      >
                        <div className="text-sm font-medium text-foreground">{a.label}</div>
                        <div className="text-[11px] text-muted-foreground">{a.sub}</div>
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Trades are spaced at <strong className="text-foreground">random intervals</strong> across your
                    period, so it never runs like clockwork.
                  </p>
                </div>

                {/* What should it do */}
                <div className="space-y-1.5">
                  <Label>What should it do</Label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setMode("dca")}
                      className={`rounded-md border px-2 py-2 text-center transition-colors ${
                        mode === "dca"
                          ? "border-emerald-500 bg-emerald-500/10"
                          : "border-border hover-elevate"
                      }`}
                      data-testid="button-mode-dca"
                    >
                      <div className="text-sm font-medium text-foreground">Accumulate</div>
                      <div className="text-[11px] text-muted-foreground">Buy over time</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("volume")}
                      className={`rounded-md border px-2 py-2 text-center transition-colors ${
                        mode === "volume"
                          ? "border-emerald-500 bg-emerald-500/10"
                          : "border-border hover-elevate"
                      }`}
                      data-testid="button-mode-volume"
                    >
                      <div className="text-sm font-medium text-foreground">Volume</div>
                      <div className="text-[11px] text-muted-foreground">Buy &amp; sell cycles</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("trade")}
                      className={`rounded-md border px-2 py-2 text-center transition-colors ${
                        mode === "trade"
                          ? "border-emerald-500 bg-emerald-500/10"
                          : "border-border hover-elevate"
                      }`}
                      data-testid="button-mode-trade"
                    >
                      <div className="text-sm font-medium text-foreground">Trade</div>
                      <div className="text-[11px] text-muted-foreground">Buy then sell</div>
                    </button>
                  </div>
                  {mode === "volume" && (
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      Cycles real buys and sells to <strong className="text-foreground">keep volume on the
                      chart</strong> (shows on the price chart &amp; DexScreener). Your position returns to flat
                      each cycle — you only pay trading fees. Note: these trades{" "}
                      <strong className="text-foreground">won't appear in pump.fun's own bump feed</strong>.
                    </p>
                  )}
                </div>

                {/* Spread across wallets */}
                <div className="space-y-1.5">
                  <Label htmlFor="wallets">Spread across wallets</Label>
                  <Input
                    id="wallets"
                    type="number"
                    min="1"
                    max="10"
                    step="1"
                    value={walletCount}
                    onChange={(e) => setWalletCount(e.target.value)}
                    data-testid="input-wallet-count"
                  />
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Rotates trades across this many budget-only wallets so buys don't all come from one
                    address. <strong className="text-foreground">You fund just the first wallet</strong> with
                    your full budget — on Start, the bot auto-splits it across the rest. The split happens
                    on-chain, so the wallets stay linkable to each other.
                    {parseInt(walletCount, 10) > 1 && (
                      <> A one-time setup fee of <strong className="text-foreground">0.002 SOL per extra
                      wallet</strong> ({((Math.max(1, Math.min(10, parseInt(walletCount, 10) || 1)) - 1) * 0.002).toFixed(3)} SOL
                      total) is charged when you Start.</>
                    )}
                  </p>
                </div>

                {/* Advanced options (collapsed by default to keep it simple) */}
                <div className="rounded-md border border-border">
                  <button
                    type="button"
                    onClick={() => setShowAdvanced((v) => !v)}
                    className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium hover-elevate"
                    data-testid="button-toggle-advanced"
                  >
                    <span>Advanced options</span>
                    <ChevronDown
                      className={`w-4 h-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
                    />
                  </button>
                  {showAdvanced && (
                    <div className="space-y-4 border-t border-border p-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="name">Name</Label>
                        <Input
                          id="name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          data-testid="input-name"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="slip">Slippage (%)</Label>
                        <Input
                          id="slip"
                          type="number"
                          min="0.1"
                          max="20"
                          step="0.1"
                          value={slippagePct}
                          onChange={(e) => setSlippagePct(e.target.value)}
                          data-testid="input-slippage"
                        />
                      </div>

                      <label
                        className="flex items-start gap-2.5 rounded-md border border-border p-3 cursor-pointer hover-elevate"
                        data-testid="toggle-keep-funds"
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 accent-emerald-500"
                          checked={keepFunds}
                          onChange={(e) => setKeepFunds(e.target.checked)}
                          data-testid="checkbox-keep-funds"
                        />
                        <span className="text-[11px] leading-snug text-muted-foreground">
                          <strong className="text-foreground">Leave funds in the rotation wallets when finished.</strong>{" "}
                          By default, everything sweeps back to your main wallet when the strategy completes.
                          Turn this on to keep the balances parked in the trading wallets so you can refill
                          and reuse them. You can still pull everything out anytime with Cancel &amp; withdraw.
                        </span>
                      </label>

                      {/* Take-profit doesn't apply to Volume mode (position stays flat). */}
                      {mode !== "volume" && (
                        <div className="space-y-2 rounded-md border border-border p-3">
                          <label className="flex items-start gap-2.5 cursor-pointer" data-testid="toggle-take-profit">
                            <input
                              type="checkbox"
                              className="mt-0.5 h-4 w-4 accent-emerald-500"
                              checked={takeProfitEnabled}
                              onChange={(e) => setTakeProfitEnabled(e.target.checked)}
                              data-testid="checkbox-take-profit"
                            />
                            <span className="text-sm">
                              <span className="font-medium text-foreground flex items-center gap-1.5">
                                <TrendingUp className="w-4 h-4 text-emerald-500" /> Auto take-profit
                              </span>
                              <span className="text-[11px] leading-snug text-muted-foreground">
                                Automatically sell when your position hits a profit target — hands-free.
                              </span>
                            </span>
                          </label>
                          {takeProfitEnabled && (
                            <>
                              <div className="grid grid-cols-2 gap-3 pt-1">
                                <div className="space-y-1.5">
                                  <Label htmlFor="tp-sell">Sell (%)</Label>
                                  <Input
                                    id="tp-sell"
                                    type="number"
                                    min="1"
                                    max="100"
                                    step="1"
                                    value={takeProfitSellPct}
                                    onChange={(e) => setTakeProfitSellPct(e.target.value)}
                                    data-testid="input-take-profit-sell"
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <Label htmlFor="tp-gain">When up (%)</Label>
                                  <Input
                                    id="tp-gain"
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={takeProfitPct}
                                    onChange={(e) => setTakeProfitPct(e.target.value)}
                                    data-testid="input-take-profit-gain"
                                  />
                                </div>
                              </div>
                              <p className="text-[11px] leading-snug text-muted-foreground">
                                Sell <strong className="text-foreground">{Math.max(1, Math.min(100, parseInt(takeProfitSellPct, 10) || 0))}%</strong> of
                                your tokens once the position is up{" "}
                                <strong className="text-foreground">{Math.max(1, parseInt(takeProfitPct, 10) || 0)}%</strong> vs
                                what the bot spent. Fires once. Selling 100% returns everything to your main
                                wallet and stops the strategy. You can always sell manually anytime below.
                              </p>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Tokens {tokens.filter((t) => t.trim()).length > 1 && "(budget split evenly)"}</Label>
                  {tokens.map((t, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        placeholder="Token mint address"
                        value={t}
                        onChange={(e) =>
                          setTokens((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))
                        }
                        data-testid={`input-token-${i}`}
                      />
                      {tokens.length > 1 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => setTokens((prev) => prev.filter((_, j) => j !== i))}
                          data-testid={`button-remove-token-${i}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {tokens.length < 10 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setTokens((prev) => [...prev, ""])}
                      data-testid="button-add-token"
                    >
                      <Plus className="w-4 h-4 mr-1" /> Add token (diversify)
                    </Button>
                  )}
                </div>

                <Button
                  className="w-full bg-black text-white hover:bg-black/90"
                  onClick={() => createMut.mutate()}
                  disabled={createMut.isPending}
                  data-testid="button-create-strategy"
                >
                  {createMut.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : null}
                  Create strategy
                </Button>
              </CardContent>
            </Card>

            {/* ─── Active strategies ───────────────────────────────────── */}
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-foreground">Your strategies</h2>
              {!readToken && (
                <Card>
                  <CardContent className="py-8 text-center space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Your strategies, trade history, and wallet balances are private. Sign a
                      message to unlock them — no transaction, no fees.
                    </p>
                    <Button
                      onClick={unlock}
                      disabled={unlocking}
                      className="bg-black text-white hover:bg-black/90"
                      data-testid="button-unlock-strategies"
                    >
                      {unlocking ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                      Unlock my strategies
                    </Button>
                  </CardContent>
                </Card>
              )}
              {readToken && strategiesQuery.isLoading && (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    <Loader2 className="w-5 h-5 mx-auto animate-spin" />
                  </CardContent>
                </Card>
              )}
              {readToken && strategiesQuery.data?.strategies.length === 0 && (
                <Card>
                  <CardContent className="py-8 text-center text-sm text-muted-foreground">
                    No strategies yet. Create one to get started.
                  </CardContent>
                </Card>
              )}
              {readToken &&
                strategiesQuery.data?.strategies.map((s) => (
                  <StrategyCard
                    key={s.id}
                    strategy={s}
                    owner={owner}
                    defaultOpen={s.id === createdId}
                    sendTransaction={sendTransaction}
                    connection={connection}
                    publicKey={publicKey}
                    readToken={readToken}
                    onAuthExpired={forgetToken}
                  />
                ))}
            </div>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}

// ─── Individual strategy card (funding + monitoring + controls) ──────────────
function StrategyCard({
  strategy,
  owner,
  defaultOpen,
  sendTransaction,
  connection,
  publicKey,
  readToken,
  onAuthExpired,
}: {
  strategy: Strategy;
  owner: string;
  defaultOpen: boolean;
  sendTransaction: any;
  connection: any;
  publicKey: PublicKey | null;
  readToken: string;
  onAuthExpired: () => void;
}) {
  const { toast } = useToast();
  const { signMessage } = useWallet();
  const [open, setOpen] = useState(defaultOpen);
  const [fundAmount, setFundAmount] = useState("");
  const [funding, setFunding] = useState(false);

  // Lifecycle actions (start/pause/cancel) are gated server-side by an ed25519
  // signature from the owner wallet — body-provided ownerWallet alone is
  // spoofable. Build the canonical message, sign it with the connected wallet,
  // and hand the server {ownerWallet, nonce, signature} to authorize.
  const signAction = async (action: "start" | "pause" | "cancel" | "sell-now") => {
    if (!signMessage) throw new Error("Your wallet can't sign messages — reconnect and try again.");
    const nonce = Date.now();
    const message = ["paif-auto-strategy", "v1", action, strategy.id, owner, String(nonce)].join("|");
    const signature = bs58.encode(await signMessage(new TextEncoder().encode(message)));
    return { ownerWallet: owner, nonce, signature };
  };

  const detailQuery = useQuery<{
    strategy: Strategy;
    executions: Execution[];
    tradingWalletBalanceLamports: string | null;
    walletBalancesLamports?: (string | null)[];
  }>({
    queryKey: ["/api/auto-strategy", strategy.id, readToken],
    enabled: open,
    refetchInterval: open ? 10_000 : false,
    queryFn: async () => {
      try {
        const res = await apiRequest(
          "GET",
          `/api/auto-strategy/${strategy.id}`,
          undefined,
          { "x-auto-strategy-token": readToken },
        );
        return res.json();
      } catch (e: any) {
        if (String(e?.message ?? "").startsWith("401")) onAuthExpired();
        throw e;
      }
    },
  });

  const s = detailQuery.data?.strategy ?? strategy;
  const balance = detailQuery.data?.tradingWalletBalanceLamports;
  const executions = detailQuery.data?.executions ?? [];
  // All wallets (primary first) + their live balances, when multi-wallet.
  const wallets = s.wallets && s.wallets.length > 0 ? s.wallets : [s.tradingWallet];
  const walletBalances = detailQuery.data?.walletBalancesLamports;

  const budgetUsedPct = Math.min(
    100,
    (Number(s.spentLamports) / Math.max(1, Number(s.budgetLamports))) * 100,
  );
  const sliceProgressPct = Math.min(100, (s.completedSlices / Math.max(1, s.totalSlices)) * 100);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/auto-strategy", strategy.id] });
    queryClient.invalidateQueries({ queryKey: ["/api/auto-strategy/list", owner] });
  };

  const startMut = useMutation({
    mutationFn: async () => {
      const body = await signAction("start");
      const res = await apiRequest("POST", `/api/auto-strategy/${strategy.id}/start`, body);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Strategy started", description: "The bot is now trading on schedule." });
    },
    onError: (e: any) => toast({ title: "Couldn't start", description: e.message, variant: "destructive" }),
  });

  const pauseMut = useMutation({
    mutationFn: async () => {
      const body = await signAction("pause");
      const res = await apiRequest("POST", `/api/auto-strategy/${strategy.id}/pause`, body);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Paused" });
    },
    onError: (e: any) => toast({ title: "Couldn't pause", description: e.message, variant: "destructive" }),
  });

  const cancelMut = useMutation({
    mutationFn: async () => {
      const body = await signAction("cancel");
      const res = await apiRequest("POST", `/api/auto-strategy/${strategy.id}/cancel`, body);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Cancelled & swept", description: "Remaining funds are heading back to your main wallet." });
    },
    onError: (e: any) => toast({ title: "Couldn't cancel", description: e.message, variant: "destructive" }),
  });

  const sellNowMut = useMutation({
    mutationFn: async () => {
      const body = await signAction("sell-now");
      const res = await apiRequest("POST", `/api/auto-strategy/${strategy.id}/sell-now`, body);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({
        title: "Selling everything now",
        description: "Your tokens are being sold to SOL and returned to your main wallet. Watch the activity log below.",
      });
    },
    onError: (e: any) => toast({ title: "Couldn't sell", description: e.message, variant: "destructive" }),
  });

  const fundWallet = async () => {
    if (!publicKey || !sendTransaction) {
      toast({ title: "Connect your wallet", variant: "destructive" });
      return;
    }
    const sol = parseFloat(fundAmount);
    if (!sol || sol <= 0) {
      toast({ title: "Enter an amount", variant: "destructive" });
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
          toPubkey: new PublicKey(s.tradingWallet),
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
      toast({ title: "Funded", description: `Sent ${sol} SOL to the trading wallet.` });
      setFundAmount("");
      invalidate();
    } catch (e: any) {
      toast({ title: "Funding failed", description: e.message, variant: "destructive" });
    } finally {
      setFunding(false);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied" });
  };

  return (
    <Card data-testid={`card-strategy-${s.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              {s.name}
              <Badge variant="outline" className={statusColor[s.status]} data-testid={`status-${s.id}`}>
                {s.status.replace("_", " ")}
              </Badge>
            </CardTitle>
            <CardDescription className="mt-1">
              {s.mode === "dca"
                ? "Accumulate"
                : s.mode === "volume"
                  ? "Volume · buy/sell cycles"
                  : "Trade · buy then sell"} ·{" "}
              {fmtSol(s.budgetLamports)} SOL budget · {s.tokens.length} token
              {s.tokens.length > 1 ? "s" : ""}
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)} data-testid={`button-toggle-${s.id}`}>
            {open ? "Hide" : "Manage"}
          </Button>
        </div>
      </CardHeader>

      {open && (
        <CardContent className="space-y-4">
          {/* Progress */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Budget spent</span>
              <span data-testid={`text-spent-${s.id}`}>
                {fmtSol(s.spentLamports)} / {fmtSol(s.budgetLamports)} SOL
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-emerald-500" style={{ width: `${budgetUsedPct}%` }} />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground pt-1">
              <span>Slices done</span>
              <span data-testid={`text-slices-${s.id}`}>
                {s.completedSlices} / {s.totalSlices}
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-blue-500" style={{ width: `${sliceProgressPct}%` }} />
            </div>
          </div>

          <AlphaSecondOpinion
            surface="dca"
            subjectId={s.id}
            subjectLabel="this DCA strategy"
            primaryDecision={s.status === "active" ? "Continue scheduled accumulation" : `Strategy is ${s.status.replace("_", " ")}`}
            primaryVerdict={s.status === "active" ? "positive" : "neutral"}
            evidence={{
              status: s.status,
              mode: s.mode,
              budgetUsedPct,
              completedSlices: s.completedSlices,
              totalSlices: s.totalSlices,
              maxAllocationBps: Math.max(...s.allocationsBps, 0),
              slippageBps: s.slippageBps,
            }}
          />

          {/* Trading wallet(s) */}
          <div className="rounded-md border border-border p-3 space-y-2 text-sm">
            {wallets.length > 1 ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Trading wallets ({wallets.length})</span>
                  <span className="text-[11px] text-muted-foreground">Fund the first one only</span>
                </div>
                {wallets.map((w, i) => {
                  const b = walletBalances?.[i];
                  return (
                    <div key={w} className="flex items-center justify-between gap-2">
                      <button
                        className="flex items-center gap-1 font-mono text-xs hover:underline"
                        onClick={() => copy(w)}
                        data-testid={`button-copy-wallet-${s.id}-${i}`}
                      >
                        <span className="text-muted-foreground">{i === 0 ? "#1 (fund)" : `#${i + 1}`}</span>
                        {shortAddr(w)} <Copy className="w-3 h-3" />
                      </button>
                      <span data-testid={`text-balance-${s.id}-${i}`}>
                        {b === null || b === undefined ? "—" : `${fmtSol(b)} SOL`}
                      </span>
                    </div>
                  );
                })}
              </>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Trading wallet</span>
                  <button
                    className="flex items-center gap-1 font-mono text-xs hover:underline"
                    onClick={() => copy(s.tradingWallet)}
                    data-testid={`button-copy-wallet-${s.id}`}
                  >
                    {shortAddr(s.tradingWallet)} <Copy className="w-3 h-3" />
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Balance</span>
                  <span data-testid={`text-balance-${s.id}`}>
                    {balance === null || balance === undefined ? "—" : `${fmtSol(balance)} SOL`}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Funding (when fundable) */}
          {(s.status === "awaiting_funds" || s.status === "paused" || s.status === "active") && (
            <div className="flex gap-2">
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="Amount in SOL"
                value={fundAmount}
                onChange={(e) => setFundAmount(e.target.value)}
                data-testid={`input-fund-${s.id}`}
              />
              <Button
                variant="outline"
                onClick={fundWallet}
                disabled={funding}
                data-testid={`button-fund-${s.id}`}
              >
                {funding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4 mr-1" />}
                Fund
              </Button>
            </div>
          )}

          {/* Take-profit status */}
          {s.takeProfitPct != null && s.takeProfitSellBps != null && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm flex items-start gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
              <div>
                <span className="text-foreground font-medium" data-testid={`text-take-profit-${s.id}`}>
                  Take-profit: sell {Math.round(s.takeProfitSellBps / 100)}% when up {s.takeProfitPct}%
                </span>
                <div className="text-[11px] text-muted-foreground">
                  {s.takeProfitFiredAt
                    ? `Triggered ${new Date(s.takeProfitFiredAt).toLocaleString()}.`
                    : "Armed — the bot checks the price every ~20 seconds."}
                </div>
              </div>
            </div>
          )}

          {/* Controls */}
          <div className="flex flex-wrap gap-2">
            {(s.status === "active" || s.status === "paused") && (
              <Button
                variant="outline"
                className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                onClick={() => {
                  if (
                    window.confirm(
                      "Sell ALL tokens in this strategy to SOL now and return everything to your main wallet? This stops the strategy.",
                    )
                  ) {
                    sellNowMut.mutate();
                  }
                }}
                disabled={sellNowMut.isPending}
                data-testid={`button-sell-now-${s.id}`}
              >
                {sellNowMut.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <TrendingUp className="w-4 h-4 mr-1" />}
                Sell everything now
              </Button>
            )}
            {(s.status === "awaiting_funds" || s.status === "paused") && (
              <Button
                className="bg-black text-white hover:bg-black/90"
                onClick={() => startMut.mutate()}
                disabled={startMut.isPending}
                data-testid={`button-start-${s.id}`}
              >
                {startMut.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Play className="w-4 h-4 mr-1" />}
                {s.status === "paused" ? "Resume" : "Start"}
              </Button>
            )}
            {s.status === "active" && (
              <Button variant="outline" onClick={() => pauseMut.mutate()} disabled={pauseMut.isPending} data-testid={`button-pause-${s.id}`}>
                {pauseMut.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Pause className="w-4 h-4 mr-1" />}
                Pause
              </Button>
            )}
            {s.status !== "cancelled" && s.status !== "completed" && (
              <Button
                variant="outline"
                className="text-red-600 dark:text-red-400 border-red-500/40"
                onClick={() => cancelMut.mutate()}
                disabled={cancelMut.isPending}
                data-testid={`button-cancel-${s.id}`}
              >
                {cancelMut.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <X className="w-4 h-4 mr-1" />}
                Cancel & withdraw
              </Button>
            )}
            {(s.status === "completed" || s.status === "cancelled") && (
              <Button
                variant="outline"
                onClick={() => cancelMut.mutate()}
                disabled={cancelMut.isPending}
                data-testid={`button-sweep-${s.id}`}
              >
                {cancelMut.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ArrowDownToLine className="w-4 h-4 mr-1" />}
                Sweep residue to main wallet
              </Button>
            )}
          </div>

          {/* Execution log */}
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">Activity</div>
            {executions.length === 0 && (
              <p className="text-xs text-muted-foreground">No trades yet.</p>
            )}
            <div className="max-h-56 overflow-y-auto space-y-1.5">
              {executions.map((ex) => (
                <div
                  key={ex.id}
                  className="flex items-center justify-between gap-2 rounded border border-border px-2.5 py-1.5 text-xs"
                  data-testid={`row-execution-${ex.id}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge
                      variant="outline"
                      className={
                        ex.status === "success"
                          ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                          : "border-red-500/40 text-red-600 dark:text-red-400"
                      }
                    >
                      {ex.action}
                    </Badge>
                    <span className="text-muted-foreground truncate">
                      {ex.tokenMint && ex.tokenMint.length > 12 ? shortAddr(ex.tokenMint) : ex.tokenMint || "—"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {ex.status === "failed" ? (
                      <span className="text-red-500 truncate max-w-[140px]" title={ex.errorMessage ?? ""}>
                        {ex.errorMessage ?? "failed"}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {Number(ex.amountLamports) > 0 ? `${fmtSol(ex.amountLamports)} SOL` : ""}
                      </span>
                    )}
                    {ex.txSignature && (
                      <a
                        href={`https://solscan.io/tx/${ex.txSignature}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-500 hover:underline"
                      >
                        view
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
