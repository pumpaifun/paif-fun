import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { useActiveChain } from "@/lib/active-chain";
import { isEvmChain } from "@/lib/chains";
import { GitCompareArrows, Plus, X, Loader2, AlertTriangle } from "lucide-react";

interface ScanResult {
  tokenAddress: string;
  tokenName: string;
  tokenSymbol: string;
  tokenImage: string;
  topHolderPercent: number;
  reinvestedPercent: number;
  movedElsewherePercent: number;
  rating: "green" | "yellow" | "red" | null;
  ratingExplanation: string;
  dataIncomplete: boolean;
  launchDate: string | null;
}

const MAX_TOKENS = 4;

const RATING_META: Record<string, { label: string; dot: string; text: string }> = {
  green: { label: "Looks Good", dot: "bg-emerald-500", text: "text-emerald-500" },
  yellow: { label: "Mixed Signals", dot: "bg-yellow-400", text: "text-yellow-500" },
  red: { label: "Be Careful", dot: "bg-red-500", text: "text-red-500" },
};

function MetricRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-border/60 last:border-0">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-xs font-semibold text-foreground text-right">{children}</span>
    </div>
  );
}

function CompareColumn({ query, chainId }: { query: string; chainId: string }) {
  const isEvm = isEvmChain(chainId as any);
  const endpoint = isEvm ? "/api/evm/scan" : "/api/scan";

  const { data, isLoading, isError } = useQuery<ScanResult>({
    queryKey: [endpoint, chainId, query],
    queryFn: async () => {
      const body = isEvm ? { query, chainId } : { query };
      const res = await apiRequest("POST", endpoint, body);
      return res.json();
    },
    enabled: !!query,
  });

  return (
    <Card className="min-w-[220px] flex-1" data-testid={`compare-col-${query}`}>
      <CardContent className="p-4">
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-xs">Scanning…</span>
          </div>
        )}
        {isError && (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-red-500 text-center">
            <AlertTriangle className="w-5 h-5" />
            <span className="text-xs">Couldn't scan this token. Check the address.</span>
          </div>
        )}
        {data && (
          <>
            <div className="flex items-center gap-2 mb-3">
              {data.tokenImage ? (
                <img
                  src={data.tokenImage}
                  alt={data.tokenSymbol}
                  referrerPolicy="no-referrer"
                  className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-muted flex-shrink-0" />
              )}
              <div className="min-w-0">
                <p className="font-bold text-foreground text-sm truncate" data-testid={`text-compare-name-${query}`}>
                  {data.tokenName || "Unknown"}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">${data.tokenSymbol || "?"}</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 mb-3">
              {data.rating ? (
                <>
                  <span className={`w-2.5 h-2.5 rounded-full ${RATING_META[data.rating].dot}`} />
                  <span className={`text-xs font-bold ${RATING_META[data.rating].text}`}>
                    {RATING_META[data.rating].label}
                  </span>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">No rating</span>
              )}
            </div>

            <MetricRow label="Top holder">{data.topHolderPercent}%</MetricRow>
            <MetricRow label="Reinvested">{data.reinvestedPercent}%</MetricRow>
            <MetricRow label="Moved elsewhere">{data.movedElsewherePercent}%</MetricRow>
            <MetricRow label="Launch date">{data.launchDate || "—"}</MetricRow>

            {data.dataIncomplete && (
              <p className="text-[10px] text-yellow-500 mt-2">Partial data — some metrics may be incomplete.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function ComparePage() {
  const { chainId } = useActiveChain();
  const [inputs, setInputs] = useState<string[]>(["", ""]);
  const [committed, setCommitted] = useState<string[]>([]);

  const setInput = (i: number, v: string) =>
    setInputs((prev) => prev.map((x, idx) => (idx === i ? v : x)));

  const addInput = () => setInputs((prev) => (prev.length >= MAX_TOKENS ? prev : [...prev, ""]));
  const removeInput = (i: number) =>
    setInputs((prev) => (prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i)));

  const compare = () => setCommitted(inputs.map((s) => s.trim()).filter(Boolean));

  const canCompare = inputs.filter((s) => s.trim()).length >= 2;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center gap-2 mb-1">
          <GitCompareArrows className="w-6 h-6 text-emerald-500" />
          <h1 className="text-2xl font-black text-foreground" data-testid="text-compare-title">
            Token Comparison
          </h1>
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          Scan two or more tokens at once and see their key safety metrics side by side. Paste a token
          address or link for each — uses the same on-chain scan as the main scanner.
        </p>

        {/* Inputs */}
        <Card className="mb-5">
          <CardContent className="p-4 space-y-2.5">
            {inputs.map((val, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={val}
                  onChange={(e) => setInput(i, e.target.value)}
                  placeholder={`Token ${i + 1} — address or link`}
                  data-testid={`input-compare-${i}`}
                />
                {inputs.length > 2 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeInput(i)}
                    aria-label="Remove token"
                    data-testid={`button-remove-compare-${i}`}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ))}
            <div className="flex items-center justify-between gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={addInput}
                disabled={inputs.length >= MAX_TOKENS}
                className="font-semibold gap-1.5"
                data-testid="button-add-compare"
              >
                <Plus className="w-3.5 h-3.5" /> Add token
              </Button>
              <Button
                size="sm"
                onClick={compare}
                disabled={!canCompare}
                className="font-bold"
                data-testid="button-compare"
              >
                Compare
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        {committed.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm" data-testid="compare-empty">
            Add at least two tokens and hit Compare to see them side by side.
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2" data-testid="compare-results">
            {committed.map((q, i) => (
              <CompareColumn key={`${q}-${i}`} query={q} chainId={chainId} />
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
