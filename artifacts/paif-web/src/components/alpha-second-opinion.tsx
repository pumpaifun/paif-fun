import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BrainCircuit, CheckCircle2, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";

export type AlphaSurface = "arcade" | "swing" | "dca" | "sniper";

export interface AlphaEvidence {
  marketDataAt?: number;
  change5m?: number;
  change1h?: number;
  change24h?: number;
  liquidityUsd?: number;
  marketCapUsd?: number;
  volume24h?: number;
  holders?: number;
  ageMins?: number;
  creatorRisk?: "clean" | "high" | "unknown";
  status?: string;
  mode?: string;
  pnlPct?: number;
  trades?: number;
  wins?: number;
  openPositions?: number;
  lossCooldown?: boolean;
  budgetUsedPct?: number;
  completedSlices?: number;
  totalSlices?: number;
  maxAllocationBps?: number;
  slippageBps?: number;
}

interface AlphaReview {
  verdict: "agree" | "caution" | "disagree" | "unavailable";
  confidence: number;
  combinedDecision: string;
  summary: string;
  evidence: string[];
  concerns: string[];
  generatedAt: string;
  advisoryOnly: true;
  reviewKind: "hybrid-ai" | "rules-based-fallback";
  safetyGate: {
    level: "clear" | "verify" | "stop";
    requiresOwnerConfirmation: boolean;
    guidance: string;
    source: "local-deterministic";
  };
}

export function AlphaSecondOpinion({
  surface,
  subjectId,
  subjectLabel,
  primaryDecision,
  primaryVerdict,
  primaryConfidence,
  evidence,
  auto = false,
  className = "",
}: {
  surface: AlphaSurface;
  subjectId: string;
  subjectLabel: string;
  primaryDecision: string;
  primaryVerdict: "positive" | "negative" | "neutral";
  primaryConfidence?: number;
  evidence: AlphaEvidence;
  auto?: boolean;
  className?: string;
}) {
  const query = useQuery<AlphaReview>({
    queryKey: [
      "alpha-second-opinion",
      surface,
      subjectId,
      auto ? primaryDecision : "manual",
      auto ? primaryVerdict : "manual",
      auto ? evidence : null,
    ],
    queryFn: async () => {
      const response = await apiRequest("POST", "/api/paif-alpha/review", {
        surface,
        subjectId,
        subjectLabel,
        primaryDecision,
        primaryVerdict,
        primaryConfidence,
        evidence,
      });
      return response.json();
    },
    enabled: auto,
    staleTime: 30_000,
  });

  const review = query.data;
  const tone = review?.verdict === "agree"
    ? "border-emerald-500/30 bg-emerald-500/[0.07]"
    : review?.verdict === "disagree"
      ? "border-red-500/35 bg-red-500/[0.07]"
      : "border-amber-500/30 bg-amber-500/[0.07]";
  const Icon = review?.verdict === "agree" ? CheckCircle2 : review?.verdict === "disagree" ? ShieldAlert : AlertTriangle;

  return (
    <div className={`rounded-xl border p-3.5 ${review ? tone : "border-violet-500/25 bg-violet-500/[0.06]"} ${className}`} data-testid={`alpha-review-${surface}-${subjectId}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BrainCircuit className="h-4 w-4 text-violet-500" />
          <span className="text-xs font-bold">Alpha PAIF safety review</span>
          {review && (
            <span className="rounded-full border border-violet-500/25 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-500">
              {review.reviewKind === "hybrid-ai" ? "Independent AI + safety gate" : "Safety gate fallback"}
            </span>
          )}
          {review && (
            <span className="rounded-full border border-current/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide">
              {review.verdict} · {review.confidence}/100
            </span>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px]"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
          data-testid={`button-alpha-review-${surface}-${subjectId}`}
        >
          {query.isFetching ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
          {review ? "Review again" : "Get second opinion"}
        </Button>
      </div>

      {query.error && (
        <p className="mt-2 text-xs text-muted-foreground">Alpha is unavailable. The main PAIF decision remains unchanged.</p>
      )}
      {!review && !query.error && !query.isFetching && (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Compare the main PAIF result with an independent, read-only AI opinion protected by PAIF's local safety gate.
        </p>
      )}
      {review && (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="text-xs font-bold">{review.combinedDecision}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{review.summary}</p>
            </div>
          </div>
          {review.concerns.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-[11px] text-muted-foreground">
              {review.concerns.slice(0, 3).map((item) => <li key={item}>{item}</li>)}
            </ul>
          )}
          {review.safetyGate && (
            <div className={`rounded-lg border px-3 py-2 text-[11px] ${
              review.safetyGate.level === "stop"
                ? "border-red-500/30 bg-red-500/[0.06]"
                : review.safetyGate.level === "verify"
                  ? "border-amber-500/30 bg-amber-500/[0.06]"
                  : "border-emerald-500/25 bg-emerald-500/[0.05]"
            }`}>
              <span className="font-bold uppercase tracking-wide">
                PAIF safety gate: {review.safetyGate.level}
              </span>
              <span className="ml-1 text-muted-foreground">— {review.safetyGate.guidance}</span>
            </div>
          )}
          <p className="text-[10px] italic text-muted-foreground">
            Advisory only. Alpha cannot execute, approve, pause, change this tool, or access a PAIF wallet.
          </p>
        </div>
      )}
    </div>
  );
}