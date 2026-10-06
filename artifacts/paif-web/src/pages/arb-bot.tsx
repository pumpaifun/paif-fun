import { useEffect, useState } from "react";
import bs58 from "bs58";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
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
  Bot,
  Plus,
  Trash2,
  Copy,
  Pause,
  Play,
  Square,
  Loader2,
  ShieldAlert,
  Beaker,
  Zap,
  TrendingUp,
} from "lucide-react";

const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type Mode = "paper" | "live";
type Status = "awaiting_funds" | "active" | "paused" | "stopped" | "cancelled";

interface ArbStrategy {
  id: string;
  ownerWallet: string;
  workerWallet: string;
  withdrawAddress: string;
  name: string;
  mode: Mode;
  status: Status;
  budgetLamports: string;
  spentLamports: string;
  maxTradeUsd: number;
  minNetEdgeBps: number;
  slippageBps: number;
  targetMode: "auto" | "list";
  targetMints: string[];
  lossStopCount: number;
  consecutiveLosses: number;
  tradesExecuted: number;
  wins: number;
  realizedPnlLamports: string;
  paperPnlMicroUsd: string;
  intervalSeconds: number;
  nextRunAt: string | null;
  createdAt: string;
}

interface ArbExecution {
  id: string;
  mint: string;
  symbol: string;
  buyDex: string;
  sellDex: string;
  tradeSizeUsd: number;
  grossSpreadBps: number;
  estCostBps: number;
  netEdgeBps: number;
  mode: Mode;
  solInLamports: string;
  solOutLamports: string;
  buySig: string | null;
  sellSig: string | null;
  resultMicroUsd: string;
  status: string;
  errorMessage: string | null;
  createdAt: string;
}

const fmtSol = (lamports: string | number) => (Number(lamports) / LAMPORTS_PER_SOL).toFixed(4);
const fmtUsd = (micro: string | number) => {
  const v = Number(micro) / 1e6;
  return `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(2)}`;
};
const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

const statusColor: Record<Status, string> = {
  awaiting_funds: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  active: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  paused: "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30",
  stopped: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  cancelled: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
};

// ─── Read-session token cache (owner signs once; polling doesn't re-prompt) ───
const READ_TOKEN_KEY = (o: string) => `paif:arb-read-token:${o}`;
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

export function ArbBotContent({ embedded = false }: { embedded?: boolean }) {
  const { publicKey, connected, signMessage } = useWallet();
  const { toast } = useToast();
  const owner = connected ? publicKey?.toBase58() ?? null : null;

  const [readToken, setReadToken] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

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
      const message = ["paif-arb-executor", "v1", "read-session", owner, String(nonce)].join("|");
      const signature = bs58.encode(await signMessage(new TextEncoder().encode(message)));
      const res = await apiRequest("POST", "/api/arb-bot/auth", { ownerWallet: owner, nonce, signature });
      const { token } = await res.json();
      storeCachedToken(owner, token);
      setReadToken(token);
      toast({ title: "Unlocked", description: "You can now view and manage your arb bots." });
    } catch (e: any) {
      toast({ title: "Couldn't unlock", description: e.message, variant: "destructive" });
    } finally {
      setUnlocking(false);
    }
  };

  // ─── Builder state ──────────────────────────────────────────────────────────
  const [name, setName] = useState("My Arb Bot");
  const [mode, setMode] = useState<Mode>("paper");
  const [maxTradeUsd, setMaxTradeUsd] = useState("50");
  const [minNetEdgePct, setMinNetEdgePct] = useState("0.5");
  const [slippagePct, setSlippagePct] = useState("1");
  const [targetMode, setTargetMode] = useState<"auto" | "list">("auto");
  const [targetMints, setTargetMints] = useState<string[]>([""]);
  const [budgetSol, setBudgetSol] = useState("0.1");
  const [lossStopCount, setLossStopCount] = useState("3");
  const [intervalSeconds, setIntervalSeconds] = useState("30");

  const listQuery = useQuery<{ strategies: ArbStrategy[] }>({
    queryKey: ["/api/arb-bot/list", owner, readToken],
    enabled: !!owner && !!readToken,
    refetchInterval: 12_000,
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", `/api/arb-bot/list?owner=${owner}`, undefined, {
          "x-arb-token": readToken!,
        });
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
      if (!signMessage) throw new Error("Your wallet can't sign messages — reconnect and try again.");
      const maxUsd = Math.round(Number(maxTradeUsd));
      if (!Number.isFinite(maxUsd) || maxUsd < 5 || maxUsd > 100) {
        throw new Error("Max trade size must be between $5 and $100.");
      }
      const edge = Number(minNetEdgePct);
      if (!Number.isFinite(edge) || edge < 0.1 || edge > 50) {
        throw new Error("Minimum net edge must be between 0.1% and 50%.");
      }
      let cleaned: string[] = [];
      if (targetMode === "list") {
        cleaned = targetMints.map((t) => t.trim()).filter(Boolean);
        if (cleaned.length === 0) throw new Error("Add at least one token mint to watch.");
        for (const t of cleaned) {
          if (!SOL_ADDR.test(t)) throw new Error(`"${shortAddr(t)}" is not a valid mint address.`);
        }
      }
      const payload: any = {
        ownerWallet: owner,
        name: name.trim() || "My Arb Bot",
        mode,
        maxTradeUsd: maxUsd,
        minNetEdgePct: edge,
        slippageBps: Math.round(Number(slippagePct) * 100) || 100,
        targetMode,
        targetMints: targetMode === "list" ? cleaned : undefined,
        lossStopCount: Math.round(Number(lossStopCount)) || 3,
        intervalSeconds: Math.round(Number(intervalSeconds)) || 30,
      };
      if (mode === "live") {
        const b = Number(budgetSol);
        if (!Number.isFinite(b) || b <= 0 || b > 2) throw new Error("Live budget must be between 0 and 2 SOL.");
        payload.budgetSol = b;
      }
      const nonce = Date.now();
      const createMsg = ["paif-arb-executor", "v1", "create", owner, String(nonce)].join("|");
      const signature = bs58.encode(await signMessage(new TextEncoder().encode(createMsg)));
      const res = await apiRequest("POST", "/api/arb-bot/create", { ...payload, nonce, signature });
      return res.json();
    },
    onSuccess: (data: { fundingAddress: string; recommendedFundingSol: number; strategy: ArbStrategy }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/arb-bot/list"] });
      if (data.strategy.mode === "live") {
        toast({
          title: "Live arb bot created",
          description: `Fund the worker wallet with ~${data.recommendedFundingSol.toFixed(3)} SOL, then press Start.`,
        });
      } else {
        toast({ title: "Paper arb bot running", description: "It's scanning now — results appear below as they fill." });
      }
    },
    onError: (e: any) => toast({ title: "Couldn't create bot", description: e.message, variant: "destructive" }),
  });

  const canSee = !!owner && !!readToken;

  return (
      <section className={embedded ? "w-full" : "flex-1 w-full max-w-6xl mx-auto px-4 py-8"}>
        <div className="flex items-center gap-3 mb-2">
          <Bot className="w-7 h-7" />
          <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-page-title">
            {embedded ? "Trade with the Arb Bot" : "Arbitrage Bot"}
          </h2>
        </div>
        <p className="text-muted-foreground max-w-3xl mb-6">
          An autonomous, server-side runner built on the read-only arbitrage scanner. It keeps working
          with your browser closed. <strong>Paper mode</strong> simulates every opportunity with the
          scanner's honest fee + slippage model — zero risk, no funds. <strong>Live mode</strong> trades
          from a dedicated worker wallet you fund; your main wallet only ever receives funds back.
        </p>

        {/* Honesty banner */}
        <Card className="mb-6 border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-4 text-sm text-amber-700 dark:text-amber-300 flex gap-3">
            <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold mb-1">Read this before going live</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>Live arbitrage here is <strong>two separate swaps</strong> (buy on the cheap venue, sell on the dear one) — not atomic. Prices can move between the legs and a "spread" often collapses into fees.</li>
                <li>Jupiter routing narrows to a venue but <strong>can't guarantee the exact pool</strong>. Treat live results as real but imperfect.</li>
                <li>Hard caps protect you: <strong>≤ $100 / trade</strong>, <strong>≤ 2 SOL total budget</strong>, and an <strong>auto-stop</strong> after your chosen number of consecutive losses.</li>
                <li><strong>Paper mode is the recommended way to start.</strong> Prove the economics first.</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        {!owner && (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              Connect your Solana wallet to create and manage arbitrage bots.
            </CardContent>
          </Card>
        )}

        {owner && !readToken && (
          <Card>
            <CardContent className="py-10 text-center space-y-4">
              <p className="text-muted-foreground">Sign a quick message to unlock your arb bots. No transaction, no fee.</p>
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
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Plus className="w-5 h-5" /> New arb bot</CardTitle>
                <CardDescription>Pick a mode, set your risk caps, and launch.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-name" />
                </div>

                <div>
                  <Label>Mode</Label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => setMode("paper")}
                      className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm ${mode === "paper" ? "border-black bg-black text-white" : "border-border"}`}
                      data-testid="button-mode-paper"
                    >
                      <Beaker className="w-4 h-4" /> Paper
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("live")}
                      className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm ${mode === "live" ? "border-black bg-black text-white" : "border-border"}`}
                      data-testid="button-mode-live"
                    >
                      <Zap className="w-4 h-4" /> Live
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="maxTrade">Max trade (USD)</Label>
                    <Input id="maxTrade" type="number" min="5" max="100" value={maxTradeUsd} onChange={(e) => setMaxTradeUsd(e.target.value)} data-testid="input-max-trade" />
                    <p className="text-xs text-muted-foreground mt-1">$5–$100 cap</p>
                  </div>
                  <div>
                    <Label htmlFor="minEdge">Min net edge (%)</Label>
                    <Input id="minEdge" type="number" step="0.1" min="0.1" max="50" value={minNetEdgePct} onChange={(e) => setMinNetEdgePct(e.target.value)} data-testid="input-min-edge" />
                    <p className="text-xs text-muted-foreground mt-1">After all fees</p>
                  </div>
                </div>

                <div>
                  <Label>What to watch</Label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => setTargetMode("auto")}
                      className={`rounded-md border px-3 py-2 text-sm ${targetMode === "auto" ? "border-black bg-black text-white" : "border-border"}`}
                      data-testid="button-target-auto"
                    >
                      Trending tokens
                    </button>
                    <button
                      type="button"
                      onClick={() => setTargetMode("list")}
                      className={`rounded-md border px-3 py-2 text-sm ${targetMode === "list" ? "border-black bg-black text-white" : "border-border"}`}
                      data-testid="button-target-list"
                    >
                      My token list
                    </button>
                  </div>
                </div>

                {targetMode === "list" && (
                  <div className="space-y-2">
                    {targetMints.map((m, i) => (
                      <div key={i} className="flex gap-2">
                        <Input
                          value={m}
                          placeholder="Token mint address"
                          onChange={(e) => setTargetMints((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                          data-testid={`input-mint-${i}`}
                        />
                        {targetMints.length > 1 && (
                          <Button variant="outline" size="icon" onClick={() => setTargetMints((prev) => prev.filter((_, j) => j !== i))} data-testid={`button-remove-mint-${i}`}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                    {targetMints.length < 20 && (
                      <Button variant="outline" size="sm" onClick={() => setTargetMints((prev) => [...prev, ""])} data-testid="button-add-mint">
                        <Plus className="w-4 h-4 mr-1" /> Add token
                      </Button>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="slip">Slippage (%)</Label>
                    <Input id="slip" type="number" step="0.1" min="0.1" max="10" value={slippagePct} onChange={(e) => setSlippagePct(e.target.value)} data-testid="input-slippage" />
                  </div>
                  <div>
                    <Label htmlFor="interval">Scan every (sec)</Label>
                    <Input id="interval" type="number" min="15" max="3600" value={intervalSeconds} onChange={(e) => setIntervalSeconds(e.target.value)} data-testid="input-interval" />
                  </div>
                </div>

                {mode === "live" && (
                  <div className="grid grid-cols-2 gap-3 rounded-md border border-border p-3 bg-muted/30">
                    <div>
                      <Label htmlFor="budget">Budget (SOL)</Label>
                      <Input id="budget" type="number" step="0.01" min="0.002" max="2" value={budgetSol} onChange={(e) => setBudgetSol(e.target.value)} data-testid="input-budget" />
                      <p className="text-xs text-muted-foreground mt-1">Max 2 SOL total principal</p>
                    </div>
                    <div>
                      <Label htmlFor="lossStop">Auto-stop after losses</Label>
                      <Input id="lossStop" type="number" min="1" max="20" value={lossStopCount} onChange={(e) => setLossStopCount(e.target.value)} data-testid="input-loss-stop" />
                      <p className="text-xs text-muted-foreground mt-1">Consecutive losing trades</p>
                    </div>
                  </div>
                )}

                <Button
                  onClick={() => createMut.mutate()}
                  disabled={createMut.isPending}
                  className="w-full bg-black text-white hover:bg-black/90"
                  data-testid="button-create"
                >
                  {createMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  {mode === "live" ? "Create live bot" : "Start paper bot"}
                </Button>
              </CardContent>
            </Card>

            {/* ─── Bot list ─── */}
            <div className="space-y-4">
              {listQuery.isLoading && (
                <Card><CardContent className="py-10 text-center text-muted-foreground"><Loader2 className="w-5 h-5 mx-auto animate-spin" /></CardContent></Card>
              )}
              {listQuery.data && listQuery.data.strategies.length === 0 && (
                <Card><CardContent className="py-10 text-center text-muted-foreground">No arb bots yet. Create one to get started.</CardContent></Card>
              )}
              {listQuery.data?.strategies.map((s) => (
                <BotCard key={s.id} strategy={s} owner={owner!} readToken={readToken!} signMessage={signMessage!} />
              ))}
            </div>
          </div>
        )}
      </section>
  );
}

export default function ArbBotPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <ArbBotContent />
      <Footer />
    </div>
  );
}

function BotCard({
  strategy,
  owner,
  readToken,
  signMessage,
}: {
  strategy: ArbStrategy;
  owner: string;
  readToken: string;
  signMessage: (msg: Uint8Array) => Promise<Uint8Array>;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const detailQuery = useQuery<{ strategy: ArbStrategy; executions: ArbExecution[]; workerWalletBalanceLamports: string | null }>({
    queryKey: ["/api/arb-bot", strategy.id, readToken],
    enabled: !!readToken,
    refetchInterval: 12_000,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/arb-bot/${strategy.id}`, undefined, { "x-arb-token": readToken });
      return res.json();
    },
  });

  const s = detailQuery.data?.strategy ?? strategy;
  const executions = detailQuery.data?.executions ?? [];
  const workerBalance = detailQuery.data?.workerWalletBalanceLamports;

  const action = async (act: "start" | "pause" | "stop") => {
    const nonce = Date.now();
    const message = ["paif-arb-executor", "v1", act, s.id, owner, String(nonce)].join("|");
    const signature = bs58.encode(await signMessage(new TextEncoder().encode(message)));
    return apiRequest("POST", `/api/arb-bot/${s.id}/${act}`, { ownerWallet: owner, nonce, signature });
  };

  const startMut = useMutation({
    mutationFn: () => action("start"),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/arb-bot"] }); queryClient.invalidateQueries({ queryKey: ["/api/arb-bot/list"] }); },
    onError: (e: any) => toast({ title: "Couldn't start", description: e.message, variant: "destructive" }),
  });
  const pauseMut = useMutation({
    mutationFn: () => action("pause"),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/arb-bot"] }); queryClient.invalidateQueries({ queryKey: ["/api/arb-bot/list"] }); },
    onError: (e: any) => toast({ title: "Couldn't pause", description: e.message, variant: "destructive" }),
  });
  const stopMut = useMutation({
    mutationFn: () => action("stop"),
    onSuccess: () => {
      toast({ title: "Stopping", description: s.mode === "live" ? "Sweeping funds back to your wallet…" : "Bot stopped." });
      queryClient.invalidateQueries({ queryKey: ["/api/arb-bot"] });
      queryClient.invalidateQueries({ queryKey: ["/api/arb-bot/list"] });
    },
    onError: (e: any) => toast({ title: "Couldn't stop", description: e.message, variant: "destructive" }),
  });

  const copyWorker = () => {
    navigator.clipboard.writeText(s.workerWallet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const pnl = s.mode === "live"
    ? { label: "Realized P&L", value: `${Number(s.realizedPnlLamports) >= 0 ? "+" : ""}${fmtSol(s.realizedPnlLamports)} SOL`, positive: Number(s.realizedPnlLamports) >= 0 }
    : { label: "Simulated P&L", value: fmtUsd(s.paperPnlMicroUsd), positive: Number(s.paperPnlMicroUsd) >= 0 };
  const winRate = s.tradesExecuted > 0 ? Math.round((s.wins / s.tradesExecuted) * 100) : 0;

  return (
    <Card data-testid={`card-bot-${s.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              {s.mode === "live" ? <Zap className="w-4 h-4" /> : <Beaker className="w-4 h-4" />}
              {s.name}
            </CardTitle>
            <CardDescription>{s.mode === "live" ? "Live" : "Paper"} · {s.targetMode === "auto" ? "Trending" : `${s.targetMints.length} token(s)`} · ${s.maxTradeUsd}/trade · ≥{(s.minNetEdgeBps / 100).toFixed(2)}% edge</CardDescription>
          </div>
          <Badge variant="outline" className={statusColor[s.status]} data-testid={`badge-status-${s.id}`}>{s.status.replace("_", " ")}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-md border border-border p-2">
            <div className={`text-lg font-bold ${pnl.positive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`} data-testid={`text-pnl-${s.id}`}>{pnl.value}</div>
            <div className="text-xs text-muted-foreground">{pnl.label}</div>
          </div>
          <div className="rounded-md border border-border p-2">
            <div className="text-lg font-bold" data-testid={`text-trades-${s.id}`}>{s.tradesExecuted}</div>
            <div className="text-xs text-muted-foreground">Trades</div>
          </div>
          <div className="rounded-md border border-border p-2">
            <div className="text-lg font-bold">{winRate}%</div>
            <div className="text-xs text-muted-foreground">Win rate</div>
          </div>
        </div>

        {s.mode === "live" && (
          <div className="rounded-md border border-border p-3 text-sm space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Worker wallet</span>
              <button className="flex items-center gap-1 font-mono" onClick={copyWorker} data-testid={`button-copy-worker-${s.id}`}>
                {shortAddr(s.workerWallet)} <Copy className="w-3 h-3" /> {copied ? "copied" : ""}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Balance</span>
              <span>{workerBalance == null ? "—" : `${fmtSol(workerBalance)} SOL`}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Budget deployed</span>
              <span>{fmtSol(s.spentLamports)} / {fmtSol(s.budgetLamports)} SOL</span>
            </div>
            {s.status === "awaiting_funds" && (
              <p className="text-xs text-amber-600 dark:text-amber-400 pt-1">Fund the worker wallet from your main wallet, then press Start.</p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {(s.status === "awaiting_funds" || s.status === "paused") && (
            <Button size="sm" onClick={() => startMut.mutate()} disabled={startMut.isPending} className="bg-black text-white hover:bg-black/90" data-testid={`button-start-${s.id}`}>
              {startMut.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Play className="w-4 h-4 mr-1" />} Start
            </Button>
          )}
          {s.status === "active" && (
            <Button size="sm" variant="outline" onClick={() => pauseMut.mutate()} disabled={pauseMut.isPending} data-testid={`button-pause-${s.id}`}>
              {pauseMut.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Pause className="w-4 h-4 mr-1" />} Pause
            </Button>
          )}
          {s.status !== "stopped" && s.status !== "cancelled" && (
            <Button size="sm" variant="outline" onClick={() => stopMut.mutate()} disabled={stopMut.isPending} data-testid={`button-stop-${s.id}`}>
              {stopMut.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Square className="w-4 h-4 mr-1" />} {s.mode === "live" ? "Stop & withdraw" : "Stop"}
            </Button>
          )}
        </div>

        {/* Execution log */}
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold mb-2"><TrendingUp className="w-4 h-4" /> Recent trades</div>
          {executions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No trades yet. The bot only logs when a qualifying opportunity clears your edge floor.</p>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {executions.map((e) => (
                <div key={e.id} className="text-xs rounded border border-border p-2" data-testid={`row-exec-${e.id}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{e.symbol || "—"} {e.buyDex && e.sellDex ? `· ${e.buyDex}→${e.sellDex}` : ""}</span>
                    <span className={Number(e.resultMicroUsd) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                      {e.status === "filled" || e.status === "partial" ? fmtUsd(e.resultMicroUsd) : e.status}
                    </span>
                  </div>
                  <div className="text-muted-foreground flex items-center justify-between mt-0.5">
                    <span>net {(e.netEdgeBps / 100).toFixed(2)}% · {new Date(e.createdAt).toLocaleTimeString()}</span>
                    {e.sellSig && (
                      <a href={`https://solscan.io/tx/${e.sellSig}`} target="_blank" rel="noreferrer" className="underline">tx</a>
                    )}
                  </div>
                  {e.errorMessage && <div className="text-amber-600 dark:text-amber-400 mt-0.5">{e.errorMessage}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
