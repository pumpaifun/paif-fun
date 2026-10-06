import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Lock, Vote, Clock, Shield, Users, Rocket, Target, Coins, BarChart3, PiggyBank, ArrowRight, ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";

// Compact mirror of the lamport→SOL helper used on /buyback. Inputs arrive as
// strings (preserved bigint precision) so we go through BigInt before any
// floating-point math.
function lamportsToSolDisplay(lamportsStr: string | undefined): string {
  if (!lamportsStr) return "0 SOL";
  try {
    const lamports = BigInt(lamportsStr);
    const whole = Number(lamports / BigInt(1_000_000_000));
    const frac = Number(lamports % BigInt(1_000_000_000)) / 1_000_000_000;
    const sol = whole + frac;
    if (sol === 0) return "0 SOL";
    if (sol < 0.001) return `${sol.toFixed(6)} SOL`;
    if (sol < 1) return `${sol.toFixed(4)} SOL`;
    return `${sol.toFixed(3)} SOL`;
  } catch {
    return "0 SOL";
  }
}

interface BuybackSummary {
  pool: { allocationBps: number; phase: "tracking" | "active" };
  stats: {
    entryCount: number;
    totalRevenueLamports: string;
    totalAllocatedLamports: string;
    totalPendingLamports: string;
    totalExecutedLamports: string;
  };
}

const PAIF_MINT = "HngT3GgmdyEZPmJAu4H84SeoexDb9kccQcZGQxvDpump";
const PAIF_SOLSCAN_URL = `https://solscan.io/token/${PAIF_MINT}`;
const PAIF_LOCK_CONTRACT = "CAfAjyUPfkV8KcgW6bd1EFDgYX6k42e2v8PPpzqdDr87";
const PAIF_LOCK_URL = `https://app.streamflow.finance/contract/solana/mainnet/${PAIF_LOCK_CONTRACT}`;
const PAIF_LOCK_RECIPIENT = "5x9y9cboqWWkckVmyqheQJyorojZrKvsv9SLjxNmZKNr";
const PAIF_LOCK_TRANSACTION = "3LqES7A8gUeMAtZ4e4b4oGLnVdoWsYA1uaBr6ssRFkMW5jNVfGD88soM6yHpaBw76onCQ7brbWyfoybdU9GvFhv3";

const treasuryAssets = [
  {
    category: "PAIF",
    role: "Governance token",
    color: "bg-emerald-500",
    chartColor: "#10b981",
    icon: Users,
    details: [
      "Community proposals and voting",
      "Approved ecosystem incentives",
      "Buybacks held or used by policy",
    ],
    note: "PAIF governs the DAO; it is not the only treasury asset.",
  },
  {
    category: "SOL",
    role: "Operations buffer",
    color: "bg-blue-500",
    chartColor: "#3b82f6",
    icon: Shield,
    details: [
      "Network fees and account rent",
      "Solana-native operations",
      "Liquidity and integrations when approved",
    ],
    note: "Keep enough for operations, not the entire treasury.",
  },
  {
    category: "USDC",
    role: "Stable reserve",
    color: "bg-purple-500",
    chartColor: "#a855f7",
    icon: Rocket,
    details: [
      "Predictable runway and budgets",
      "Audits, contributors, and grants",
      "Lower exposure to SOL price swings",
    ],
    note: "Preferred stable asset for the DAO treasury.",
  },
  {
    category: "USDT",
    role: "Optional stable asset",
    color: "bg-orange-500",
    chartColor: "#f97316",
    icon: Target,
    details: [
      "Not required to create the DAO",
      "Only add when a venue or partner needs it",
      "Never treated as a promised allocation",
    ],
    note: "USDC comes first; USDT is optional rather than necessary.",
  },
];

function BuybackSummaryCard() {
  const { data, isLoading } = useQuery<BuybackSummary>({
    queryKey: ["/api/buyback/stats"],
    refetchInterval: 60_000,
  });
  const pct = ((data?.pool.allocationBps ?? 3000) / 100).toFixed(0);
  const phase = data?.pool.phase ?? "tracking";

  return (
    <Card className="mb-6" data-testid="card-dao-buyback-summary">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2">
            <PiggyBank className="w-4 h-4 text-emerald-500" />
            <h2 className="text-base font-bold text-foreground">Community Buyback Pool</h2>
            {phase === "tracking" ? (
              <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-500 text-[11px]" data-testid="badge-dao-buyback-phase">
                <Clock className="w-2.5 h-2.5 mr-1" /> Tracking · Week 1
              </Badge>
            ) : (
              <Badge className="bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 text-[11px]" data-testid="badge-dao-buyback-phase">
                Active
              </Badge>
            )}
          </div>
          <Link
            href="/buyback"
            className="text-xs font-medium text-emerald-600 hover:text-emerald-700 inline-flex items-center gap-1"
            data-testid="link-dao-buyback-full"
          >
            View full ledger <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          Up to {pct}% of platform revenue is allocated to the buyback pool, tracked transparently and executed
          periodically. Splits {phase === "active" ? "" : "(once active) "}50% treasury hold · 25% burn · 25% rewards.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MiniStat
            label="Revenue tracked"
            value={isLoading ? null : lamportsToSolDisplay(data?.stats.totalRevenueLamports)}
            sub={`${data?.stats.entryCount ?? 0} purchase${data?.stats.entryCount === 1 ? "" : "s"}`}
            testId="stat-dao-buyback-revenue"
          />
          <MiniStat
            label="Allocated"
            value={isLoading ? null : lamportsToSolDisplay(data?.stats.totalAllocatedLamports)}
            sub={`${pct}% of revenue`}
            testId="stat-dao-buyback-allocated"
            accent="emerald"
          />
          <MiniStat
            label="Pending"
            value={isLoading ? null : lamportsToSolDisplay(data?.stats.totalPendingLamports)}
            sub="Awaiting swap"
            testId="stat-dao-buyback-pending"
            accent="amber"
          />
          <MiniStat
            label="Executed"
            value={isLoading ? null : lamportsToSolDisplay(data?.stats.totalExecutedLamports)}
            sub="Swapped to $PAIF"
            testId="stat-dao-buyback-executed"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function MiniStat({
  label, value, sub, testId, accent,
}: {
  label: string;
  value: string | null;
  sub: string;
  testId: string;
  accent?: "emerald" | "amber";
}) {
  const accentClass =
    accent === "emerald" ? "text-emerald-500" :
    accent === "amber"   ? "text-amber-500"   :
    "text-foreground";
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2.5" data-testid={testId}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
      {value === null ? (
        <Skeleton className="h-5 w-16" />
      ) : (
        <p className={`text-lg font-bold tabular-nums leading-tight ${accentClass}`} data-testid={`${testId}-value`}>
          {value}
        </p>
      )}
      <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>
    </div>
  );
}

export default function DaoPage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Vote className="w-6 h-6 text-emerald-500" />
            <h1 className="text-3xl sm:text-4xl font-bold text-foreground" data-testid="text-dao-title">
              $PAIF DAO
            </h1>
          </div>
          <p className="text-sm sm:text-base text-muted-foreground max-w-xl mx-auto" data-testid="text-dao-subtitle">
            PAIF launched through pump.fun and is currently in its transparent bootstrap phase. The community governance plan below shows how control will move on-chain when the DAO is ready.
          </p>
        </div>

        <Card className="mb-6 border-amber-200 bg-amber-50/50" data-testid="card-dao-maturity">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Target className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                  <h2 className="text-sm font-bold text-foreground mb-1.5">DAO Activation Milestone</h2>
                <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                   The DAO is not active yet. Before community voting, PAIF will separate the DAO, creator, buyback, and operating funds into transparent on-chain destinations and move the DAO treasury into a 3-of-5 Squads multisig. Any PAIF lock or vesting amount will only be shown here after the tokens are actually held by a verifiable lock or treasury address.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6" data-testid="card-dao-supply">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="w-4 h-4 text-foreground" />
                <h2 className="text-base font-bold text-foreground">PAIF Launch Supply</h2>
            </div>
            <p className="text-3xl sm:text-4xl font-bold text-foreground mt-2" data-testid="text-total-supply">
                1,000,000,000 <span className="text-emerald-500">$PAIF</span>
            </p>

            <div className="rounded-lg border border-amber-200 bg-amber-50/60 dark:border-amber-500/20 dark:bg-amber-500/5 p-4 mt-5">
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                This is the launch supply, not a promise that fixed percentages are already held by a treasury,
                team, or DAO. PAIF was launched through pump.fun with no presale or private allocation. Current
                balances, holders, and any future locks should be verified from on-chain addresses.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6 border-emerald-500/25" data-testid="card-dao-tokenomics-verification">
          <CardContent className="p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10">
                  <Lock className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Tokenomics & Supply Lock Verification</h2>
                  <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                    This section records verifiable on-chain facts only. The public Streamflow contract and finalized Solana transaction below can be independently checked.
                  </p>
                </div>
              </div>
              <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600">
                Lock verified
              </Badge>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-border bg-muted/20 p-4">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Launch supply</p>
                <p className="mt-1 text-lg font-bold text-foreground">1,000,000,000 PAIF</p>
                <p className="mt-1 text-xs text-muted-foreground">Pump.fun launch · no presale stated</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 p-4">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Verified locked supply</p>
                <p className="mt-1 text-lg font-bold text-emerald-600">262,000,000 PAIF</p>
                <p className="mt-1 text-xs text-muted-foreground">26.2% of the 1 billion launch supply</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 p-4">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Lock provider</p>
                <p className="mt-1 text-lg font-bold text-foreground">Streamflow</p>
                <p className="mt-1 text-xs text-muted-foreground">Immutable · cannot be canceled or transferred</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 p-4">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Authority status</p>
                <a href={PAIF_SOLSCAN_URL} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm font-bold text-emerald-600 hover:text-emerald-700">
                  Verify on Solscan <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <p className="mt-1 text-xs text-muted-foreground">Check mint and freeze authorities directly</p>
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.03] p-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Streamflow proof</p>
                  <a href={PAIF_LOCK_URL} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-emerald-600 hover:text-emerald-700">
                    Open verified contract <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Locked amount</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">262,000,000 PAIF</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Supply percentage</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">26.2% of launch supply</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Unlock date</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">December 6, 2026 · 1:00 AM GMT-4</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Unlock recipient</p>
                  <a href={`https://solscan.io/account/${PAIF_LOCK_RECIPIENT}`} target="_blank" rel="noopener noreferrer" className="mt-1 block break-all text-sm font-semibold text-emerald-600 hover:text-emerald-700">
                    {PAIF_LOCK_RECIPIENT}
                  </a>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Creation transaction</p>
                  <a href={`https://solscan.io/tx/${PAIF_LOCK_TRANSACTION}`} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-emerald-600 hover:text-emerald-700">
                    View finalized transaction <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
              <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
                Streamflow reports this contract as immutable and non-cancelable. The website displays the public proof but cannot shorten, cancel, transfer, or override the on-chain lock.
              </p>
              <a href={PAIF_LOCK_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600 hover:text-emerald-700">
                Open lock proof <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </CardContent>
        </Card>

        <BuybackSummaryCard />

        <Card className="mb-8" data-testid="card-dao-treasury-assets">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-1">
              <Coins className="w-4 h-4 text-emerald-500" />
              <h2 className="text-xl font-bold text-foreground">Future Treasury Asset Policy</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-5">
              The DAO does not need every asset on day one. PAIF is for governance, SOL keeps the treasury operational,
              and USDC provides a stable reserve. USDT is optional and will only be added for a clear operational reason.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {treasuryAssets.map((item) => (
                <Card key={item.category} className="border-border/80" data-testid={`card-dao-asset-${item.category.toLowerCase()}`}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-8 h-8 rounded-lg ${item.color} flex items-center justify-center`}>
                    <item.icon className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-foreground leading-tight">{item.category}</h3>
                    <p className="text-xs text-muted-foreground">{item.role}</p>
                  </div>
                </div>

                <ul className="space-y-1 mb-2">
                  {item.details.map((detail) => (
                    <li key={detail} className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <span className={`w-1 h-1 rounded-full ${item.color} flex-shrink-0`} />
                      {detail}
                    </li>
                  ))}
                </ul>

                <p className="text-xs font-medium text-foreground/80 italic">{item.note}</p>
              </CardContent>
            </Card>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          {[
            {
              title: "Separate the money first",
              icon: Shield,
              color: "bg-blue-500",
              text: "Create separate DAO, creator, buyback, and operating destinations. The DAO should never rely on a single mixed wallet to explain who controls what.",
            },
            {
              title: "Protect the treasury",
              icon: Lock,
              color: "bg-purple-500",
              text: "Move DAO funds into a 3-of-5 Squads multisig before full community governance. No one signer should be able to spend the treasury alone.",
            },
            {
              title: "Let PAIF holders govern",
              icon: Vote,
              color: "bg-emerald-500",
              text: "Use SPL Governance-compatible infrastructure with proposal thresholds, quorum, vote periods, execution delays, delegation, and documented emergency rules.",
            },
            {
              title: "Assess MetaDAO later",
              icon: BarChart3,
              color: "bg-orange-500",
              text: "MetaDAO may be considered for high-impact decision markets after PAIF has enough liquidity. It is not a Solana Foundation certification and PAIF should not be relaunched just to use it.",
            },
          ].map((item) => (
            <Card key={item.title} data-testid={`card-dao-plan-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-8 h-8 rounded-lg ${item.color} flex items-center justify-center`}>
                    <item.icon className="w-4 h-4 text-white" />
                  </div>
                  <h3 className="text-sm font-bold text-foreground">{item.title}</h3>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{item.text}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Vote className="w-5 h-5 text-emerald-500" />
            <h2 className="text-xl font-bold text-foreground" data-testid="text-governance-preview-title">What Governance Will Look Like</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-5">
            When the DAO activates, $PAIF holders will vote on proposals, track treasury spending, and monitor real vesting or lock contracts — all transparent, all on-chain.
          </p>

          <Card className="mb-4" data-testid="card-dao-proposals">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Vote className="w-4 h-4 text-foreground" />
                <h3 className="text-base font-bold text-foreground">Proposals</h3>
              </div>
              <div className="rounded-lg border border-dashed border-border p-6 text-center">
                <Vote className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm font-semibold text-foreground mb-1">No proposals yet</p>
                  <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                   After the DAO activates, $PAIF holders will create and vote on proposals here — like treasury spending, partnerships, buybacks, grants, and community initiatives.
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <Card data-testid="card-dao-treasury">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Shield className="w-4 h-4 text-blue-500" />
                  <h3 className="text-base font-bold text-foreground">Treasury Dashboard</h3>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center py-2 border-b border-border">
                    <span className="text-sm text-muted-foreground">DAO vault</span>
                    <span className="text-sm font-bold text-foreground">Not activated</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-border">
                    <span className="text-sm text-muted-foreground">Community control</span>
                    <span className="text-sm font-bold text-emerald-600">Future vote</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-border">
                    <span className="text-sm text-muted-foreground">Verified locks</span>
                    <span className="text-sm font-bold text-orange-500">None recorded</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-muted-foreground">Asset mix</span>
                    <span className="text-sm font-bold text-foreground">PAIF · SOL · USDC</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-dao-vesting">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="w-4 h-4 text-purple-500" />
                  <h3 className="text-base font-bold text-foreground">Vesting Tracker</h3>
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">DAO multisig</span>
                    <span className="font-semibold text-foreground">Planned 3-of-5</span>
                    </div>
                    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-purple-500 rounded-full" style={{ width: "0%" }} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">Before full community voting</p>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">Community voting</span>
                    <span className="font-semibold text-foreground">Future PAIF governance</span>
                    </div>
                    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: "0%" }} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">Proposal, quorum, vote, and delay rules</p>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">MetaDAO option</span>
                    <span className="font-semibold text-foreground">Assess later</span>
                    </div>
                    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-pink-500 rounded-full" style={{ width: "0%" }} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">Only after sufficient PAIF liquidity</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="mb-4" data-testid="card-dao-spending">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Coins className="w-4 h-4 text-orange-500" />
                <h3 className="text-base font-bold text-foreground">Recent Treasury Activity</h3>
              </div>
              <div className="rounded-lg border border-dashed border-border p-6 text-center">
                <Coins className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm font-semibold text-foreground mb-1">No activity yet</p>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  Treasury transactions will appear here once the DAO activates and funds start moving.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="text-center text-xs text-muted-foreground pb-6">
          <p>Contract: <a href="https://dexscreener.com/solana/4s6lldhkyu1ajzdmwzcf9eh5obovhphc4cnb1ilprqny" target="_blank" rel="noopener noreferrer" className="font-mono text-foreground hover:text-emerald-600 underline underline-offset-2 transition-colors">{PAIF_MINT}</a></p>
          <p className="mt-1">Built by PAIF.fun — Transparency for the community.</p>
        </div>

        <Footer />
      </main>
    </div>
  );
}
