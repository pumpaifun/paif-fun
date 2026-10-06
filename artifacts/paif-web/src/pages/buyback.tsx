import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useWallet } from "@solana/wallet-adapter-react";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink, ShieldCheck, Clock, Zap } from "lucide-react";
import { BUYBACK_AUTO_SWEEP_THRESHOLD_LAMPORTS } from "@shared/credit-packs";

// Lamports → SOL with up to 4 decimals. Inputs arrive as strings (preserves
// >2^53 precision); we convert via BigInt then bisect to a small float for
// display only. Treasury totals will stay well inside Number range for years
// since one bump is ~0.0005 SOL of revenue, but the input shape keeps us safe
// if that ever changes.
function lamportsToSol(lamportsStr: string): number {
  try {
    const lamports = BigInt(lamportsStr || "0");
    const whole = Number(lamports / BigInt(1_000_000_000));
    const frac = Number(lamports % BigInt(1_000_000_000)) / 1_000_000_000;
    return whole + frac;
  } catch {
    return 0;
  }
}

function formatSol(lamportsStr: string): string {
  const sol = lamportsToSol(lamportsStr);
  if (sol === 0) return "0 SOL";
  if (sol < 0.001) return `${sol.toFixed(6)} SOL`;
  if (sol < 1) return `${sol.toFixed(4)} SOL`;
  return `${sol.toFixed(3)} SOL`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

interface BuybackEntry {
  id: string;
  sourceType: string;
  lamportsRevenue: string;
  allocationBps: number;
  lamportsAllocated: string;
  status: string;
  createdAt: string;
  executedAt: string | null;
  executionTxSignature: string | null;
}

interface BuybackResponse {
  pool: {
    name: string;
    blurb: string;
    allocationBps: number;
    treasury: string;
    phase: "tracking" | "active";
  };
  stats: {
    entryCount: number;
    totalRevenueLamports: string;
    totalAllocatedLamports: string;
    totalPendingLamports: string;
    totalExecutedLamports: string;
    firstAt: string | null;
    lastAt: string | null;
  };
  recent: BuybackEntry[];
  fetchedAt: number;
}

export default function BuybackPage() {
  useEffect(() => {
    document.title = "Community Buyback Pool — PAIF.fun";
    const meta = document.querySelector('meta[name="description"]');
    const desc = "Track every dollar of platform revenue allocated to the $PAIF community buyback pool — fully transparent, on-chain verifiable, executed periodically.";
    if (meta) meta.setAttribute("content", desc);
    else {
      const m = document.createElement("meta");
      m.name = "description";
      m.content = desc;
      document.head.appendChild(m);
    }
  }, []);

  const { data, isLoading, isError } = useQuery<BuybackResponse>({
    queryKey: ["/api/buyback/stats"],
    refetchInterval: 30_000,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  // Treasury-only "execute" shortcut. Compares the connected wallet's pubkey
  // against the treasury address returned by the public /api/buyback/stats
  // endpoint — purely a UX shortcut, the real authorization happens server-
  // side on the admin endpoints (signature must come from the treasury key).
  const { publicKey, connected } = useWallet();
  const connectedWallet = connected ? publicKey?.toBase58() ?? null : null;
  const isTreasury =
    !!connectedWallet && !!data?.pool.treasury && connectedWallet === data.pool.treasury;
  const pendingLamports = BigInt(data?.stats.totalPendingLamports ?? "0");
  const hasPending = pendingLamports > BigInt(0);
  const sweepReady = pendingLamports >= BUYBACK_AUTO_SWEEP_THRESHOLD_LAMPORTS;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-10 max-w-6xl">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="mb-10">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight" data-testid="text-buyback-title">
              $PAIF Buyback Pool
            </h1>
            {data?.pool.phase === "tracking" ? (
              <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-400" data-testid="badge-buyback-phase">
                <Clock className="w-3 h-3 mr-1" /> Tracking · Week 1
              </Badge>
            ) : data?.pool.phase === "active" ? (
              <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" data-testid="badge-buyback-phase">
                Active
              </Badge>
            ) : null}
          </div>
          <p className="text-base md:text-lg text-muted-foreground max-w-3xl" data-testid="text-buyback-blurb">
            {data?.pool.blurb ??
              "Up to 30% of platform revenue is allocated to the buyback pool, tracked transparently and used to buy $PAIF on-chain. What happens to the $PAIF after the buyback — how much is held, burned, or returned to the community — is still being decided together with the community."}
          </p>
          {data?.pool.phase === "tracking" && (
            <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-100/90" data-testid="banner-tracking-only">
              <strong className="text-amber-300">Tracking-only phase.</strong> Every credit purchase is being
              recorded against the pool right now. The first on-chain swap will be executed once we cross the
              traction threshold, and this banner will flip to <em>Active</em>.
            </div>
          )}
          {isTreasury && (
            <div
              className={
                "mt-4 rounded-lg border p-4 flex flex-wrap items-center justify-between gap-3 " +
                (sweepReady
                  ? "border-emerald-400/60 bg-emerald-500/15 ring-1 ring-emerald-400/40"
                  : "border-emerald-500/30 bg-emerald-500/5")
              }
              data-testid="banner-admin-shortcut"
            >
              <div className="text-sm text-emerald-100/90">
                {sweepReady ? (
                  <>
                    <strong className="text-emerald-300">Auto-sweep threshold reached.</strong>{" "}
                    Pool holds <span className="font-mono">{formatSol(data?.stats.totalPendingLamports ?? "0")}</span>
                    {" "}pending (≥ {formatSol(BUYBACK_AUTO_SWEEP_THRESHOLD_LAMPORTS.toString())}). Execute when you're ready.
                  </>
                ) : hasPending ? (
                  <>
                    <strong className="text-emerald-300">Treasury wallet detected.</strong>{" "}
                    Pool holds <span className="font-mono">{formatSol(data?.stats.totalPendingLamports ?? "0")}</span> pending —
                    auto-sweep alert fires at <span className="font-mono">{formatSol(BUYBACK_AUTO_SWEEP_THRESHOLD_LAMPORTS.toString())}</span>.
                  </>
                ) : (
                  <>
                    <strong className="text-emerald-300">Treasury wallet detected.</strong>{" "}
                    No pending allocation right now. You'll be alerted here once the pool crosses{" "}
                    <span className="font-mono">{formatSol(BUYBACK_AUTO_SWEEP_THRESHOLD_LAMPORTS.toString())}</span> pending.
                  </>
                )}
              </div>
              <Link href="/admin/buyback">
                <Button
                  size="sm"
                  className="bg-emerald-500 hover:bg-emerald-600 text-black font-semibold"
                  data-testid="button-open-admin-buyback"
                >
                  <Zap className="w-4 h-4 mr-1.5" />
                  Open execution panel
                </Button>
              </Link>
            </div>
          )}
        </section>

        {/* ── Stat tiles ───────────────────────────────────────────────── */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          <StatTile
            label="Total revenue tracked"
            value={isLoading ? null : formatSol(data?.stats.totalRevenueLamports ?? "0")}
            sub={`${data?.stats.entryCount ?? 0} purchase${data?.stats.entryCount === 1 ? "" : "s"}`}
            testId="stat-total-revenue"
          />
          <StatTile
            label="Allocated to pool"
            value={isLoading ? null : formatSol(data?.stats.totalAllocatedLamports ?? "0")}
            sub={`${((data?.pool.allocationBps ?? 3000) / 100).toFixed(0)}% of revenue`}
            testId="stat-total-allocated"
            accent="emerald"
          />
          <StatTile
            label="Pending buyback"
            value={isLoading ? null : formatSol(data?.stats.totalPendingLamports ?? "0")}
            sub="Awaiting execution"
            testId="stat-pending"
            accent="amber"
          />
          <StatTile
            label="Already executed"
            value={isLoading ? null : formatSol(data?.stats.totalExecutedLamports ?? "0")}
            sub="Swapped to $PAIF"
            testId="stat-executed"
          />
        </section>

        {/* ── What happens after each buyback ──────────────────────────── */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-2" data-testid="text-allocation-heading">What happens to the $PAIF</h2>
          <p className="text-sm text-muted-foreground max-w-3xl" data-testid="text-allocation-subheading">
            Every executed buyback puts $PAIF into the project treasury. How those tokens are eventually used —
            held, burned, or returned to holders — will be defined in the upcoming white paper with community input.
            Until then, all bought-back $PAIF simply accumulates in the treasury and is fully traceable on-chain.
          </p>
        </section>

        {/* ── Recent ledger entries ────────────────────────────────────── */}
        <section className="mb-10">
          <div className="flex items-end justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold" data-testid="text-ledger-heading">Recent allocations</h2>
              <p className="text-sm text-muted-foreground">Most recent 25 entries · auto-refreshes every 30s</p>
            </div>
            {data?.pool.treasury && (
              <a
                href={`https://solscan.io/account/${data.pool.treasury}`}
                target="_blank"
                rel="noreferrer"
                className="hidden sm:inline-flex items-center text-xs text-muted-foreground hover:text-foreground gap-1"
                data-testid="link-treasury-solscan"
              >
                <ShieldCheck className="w-3.5 h-3.5" /> Treasury on Solscan <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-6 space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : isError ? (
                <div className="p-6 text-sm text-destructive" data-testid="text-ledger-error">
                  Couldn't load the ledger right now. Please refresh.
                </div>
              ) : !data || data.recent.length === 0 ? (
                <div className="p-10 text-center" data-testid="text-ledger-empty">
                  <p className="text-sm text-muted-foreground">
                    No allocations yet. The first credit purchase will land here.
                  </p>
                  <Link href="/upgrade">
                    <Button className="mt-4" data-testid="button-go-upgrade">View credit packs</Button>
                  </Link>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-muted-foreground border-b border-border">
                      <tr>
                        <th className="text-left font-medium px-4 py-3">When</th>
                        <th className="text-left font-medium px-4 py-3">Row ID</th>
                        <th className="text-left font-medium px-4 py-3">Source</th>
                        <th className="text-right font-medium px-4 py-3">Revenue</th>
                        <th className="text-right font-medium px-4 py-3">Rate</th>
                        <th className="text-right font-medium px-4 py-3">Allocated</th>
                        <th className="text-left font-medium px-4 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent.map((e) => (
                        <tr
                          key={e.id}
                          className="border-b border-border/50 last:border-0 hover-elevate"
                          data-testid={`row-buyback-${e.id}`}
                        >
                          <td className="px-4 py-3 text-muted-foreground" data-testid={`text-when-${e.id}`}>
                            {formatRelative(e.createdAt)}
                          </td>
                          <td
                            className="px-4 py-3 font-mono text-xs uppercase text-muted-foreground"
                            title={e.id}
                            data-testid={`text-rowid-${e.id}`}
                          >
                            {e.id.slice(0, 8)}…
                          </td>
                          <td className="px-4 py-3" data-testid={`text-source-${e.id}`}>
                            {e.sourceType === "credit_purchase"
                              ? "Credit purchase"
                              : e.sourceType === "manual_buyback"
                                ? "Manual buyback"
                                : e.sourceType}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums" data-testid={`text-revenue-${e.id}`}>
                            {formatSol(e.lamportsRevenue)}
                          </td>
                          <td className="px-4 py-3 text-right text-muted-foreground" data-testid={`text-bps-${e.id}`}>
                            {(e.allocationBps / 100).toFixed(0)}%
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums font-medium text-emerald-400" data-testid={`text-allocated-${e.id}`}>
                            {formatSol(e.lamportsAllocated)}
                          </td>
                          <td className="px-4 py-3" data-testid={`text-status-${e.id}`}>
                            {e.status === "executed" ? (
                              <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                Executed
                              </Badge>
                            ) : e.status === "skipped" ? (
                              <Badge variant="outline" className="text-muted-foreground">Skipped</Badge>
                            ) : (
                              <Badge variant="outline" className="border-amber-500/40 text-amber-400">
                                Pending
                              </Badge>
                            )}
                            {e.executionTxSignature && (
                              <a
                                href={`https://solscan.io/tx/${e.executionTxSignature}`}
                                target="_blank"
                                rel="noreferrer"
                                className="ml-2 inline-flex items-center text-xs text-muted-foreground hover:text-foreground gap-1"
                                data-testid={`link-tx-${e.id}`}
                              >
                                tx <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* ── How it works ────────────────────────────────────────────── */}
        <section className="mb-12">
          <Card>
            <CardHeader>
              <CardTitle data-testid="text-how-heading">How the pool works</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-3">
              <p>
                <strong className="text-foreground">1. Revenue lands on-chain.</strong> Every credit pack is paid in
                SOL directly to the treasury wallet. The transaction is verified before any credits are granted, so
                the ledger can never get ahead of real revenue.
              </p>
              <p>
                <strong className="text-foreground">2. Allocation is recorded immediately.</strong> In the same
                database transaction that grants your credits, we write a buyback ledger row capturing the lamports
                paid, the allocation rate snapshot, and the resulting pool contribution.
              </p>
              <p>
                <strong className="text-foreground">3. Buybacks execute periodically.</strong> Pending allocations
                are batched and swapped into $PAIF on a regular cadence. Each executed row links to the on-chain
                swap transaction so anyone can audit the flow end-to-end.
              </p>
              <p className="pt-2 text-xs">
                Treasury wallet: <code className="font-mono text-foreground" data-testid="text-treasury-address">{data?.pool.treasury ?? "—"}</code>
              </p>
            </CardContent>
          </Card>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function StatTile({
  label, value, sub, testId, accent,
}: {
  label: string;
  value: string | null;
  sub: string;
  testId: string;
  accent?: "emerald" | "amber";
}) {
  const accentClass =
    accent === "emerald" ? "text-emerald-400" :
    accent === "amber"   ? "text-amber-400"   :
    "text-foreground";
  return (
    <Card data-testid={testId}>
      <CardContent className="p-5">
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{label}</p>
        {value === null ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <p className={`text-2xl font-bold tabular-nums ${accentClass}`} data-testid={`${testId}-value`}>
            {value}
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-1">{sub}</p>
      </CardContent>
    </Card>
  );
}

