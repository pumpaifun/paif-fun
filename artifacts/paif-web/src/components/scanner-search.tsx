import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Landmark,
  Loader2,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export interface VerifiedXStock {
  issuer: "xStocks";
  mint: string;
  name: string;
  tokenSymbol: string;
  underlyingTicker: string;
  logoUrl: string | null;
  tradingStatus: string;
  availabilityLabel: string;
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange24hPct: number | null;
  marketDataObservedAt: string | null;
  marketDataSource: string | null;
  marketDataStale?: boolean;
  verifiedMint?: boolean;
  network?: string;
}

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SYMBOL_OR_NAME = /^[A-Za-z0-9 .&_-]+$/;

async function fetchXStockMatches(query: string): Promise<VerifiedXStock[]> {
  const response = await fetch(`/api/tokenized-stocks/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) return [];
  const body = await response.json();
  return Array.isArray(body.assets) ? body.assets : [];
}

async function isVerifiedXStockMint(mint: string): Promise<boolean> {
  const response = await fetch(`/api/tokenized-stocks/verified/${encodeURIComponent(mint)}`);
  return response.ok;
}

export function ScannerSearch({
  className = "",
  inputClassName = "",
  buttonClassName = "",
  placeholder = "Paste a contract address, pump.fun URL, or verified xStock",
  buttonLabel = "Scan",
  inputTestId = "input-token-search",
  buttonTestId = "button-show-me",
}: {
  className?: string;
  inputClassName?: string;
  buttonClassName?: string;
  placeholder?: string;
  buttonLabel?: string;
  inputTestId?: string;
  buttonTestId?: string;
}) {
  const [, setLocation] = useLocation();
  const [value, setValue] = useState("");
  const [debouncedValue, setDebouncedValue] = useState("");
  const [showChooser, setShowChooser] = useState(false);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value.trim()), 180);
    return () => clearTimeout(timer);
  }, [value]);

  const resemblesSymbol = (
    debouncedValue.length >= 2
    && debouncedValue.length <= 40
    && SYMBOL_OR_NAME.test(debouncedValue)
    && !SOLANA_ADDRESS.test(debouncedValue)
  );

  const { data: matches = [], isFetching } = useQuery({
    queryKey: ["/api/tokenized-stocks/search", debouncedValue],
    queryFn: () => fetchXStockMatches(debouncedValue),
    enabled: resemblesSymbol,
    staleTime: 60_000,
  });

  useEffect(() => {
    setShowChooser(resemblesSymbol && matches.length > 0);
  }, [matches, resemblesSymbol]);

  function chooseXStock(asset: VerifiedXStock) {
    setShowChooser(false);
    setLocation(`/scan?xstock=${encodeURIComponent(asset.mint)}`);
  }

  async function submit() {
    const input = value.trim();
    if (!input || resolving) return;

    const exactMatches = matches.filter((asset) => (
      asset.tokenSymbol.toLowerCase() === input.toLowerCase()
      || asset.underlyingTicker.toLowerCase() === input.toLowerCase()
      || asset.name.toLowerCase() === input.toLowerCase()
    ));
    if (resemblesSymbol && exactMatches.length === 1) {
      chooseXStock(exactMatches[0]);
      return;
    }
    if (resemblesSymbol && matches.length > 0) {
      setShowChooser(true);
      return;
    }

    setResolving(true);
    try {
      if (SOLANA_ADDRESS.test(input) && await isVerifiedXStockMint(input)) {
        setLocation(`/scan?xstock=${encodeURIComponent(input)}`);
      } else {
        setLocation(`/scan?q=${encodeURIComponent(input)}`);
      }
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className={`relative ${className}`}>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onFocus={() => matches.length > 0 && setShowChooser(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder={placeholder}
            className={`pl-9 ${inputClassName}`}
            data-testid={inputTestId}
            autoComplete="off"
          />
          {isFetching && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
        <Button
          onClick={() => void submit()}
          disabled={!value.trim() || resolving}
          className={buttonClassName}
          data-testid={buttonTestId}
        >
          {resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : buttonLabel}
        </Button>
      </div>

      {showChooser && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-border bg-popover shadow-xl" data-testid="xstock-search-chooser">
          <div className="border-b border-border bg-emerald-500/5 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-black text-foreground">
              <Landmark className="h-4 w-4 text-emerald-600" />
              Search verified xStocks
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Symbols are matched only to issuer-verified Solana mints.
            </p>
          </div>
          <div className="max-h-72 overflow-y-auto p-1.5">
            {matches.map((asset) => (
              <button
                key={asset.mint}
                type="button"
                onClick={() => chooseXStock(asset)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted"
                data-testid={`xstock-choice-${asset.tokenSymbol}`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-emerald-500/10">
                  {asset.logoUrl
                    ? <img src={asset.logoUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                    : <Activity className="h-4 w-4 text-emerald-600" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-foreground">{asset.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {asset.tokenSymbol} · Solana · {asset.issuer}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">
                  {asset.tradingStatus === "available" ? "Open" : asset.tradingStatus === "halted" ? "Halted" : "Closed"}
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-emerald-600" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function money(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Unavailable";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

function observed(value: string | null): string {
  if (!value) return "No recent observation";
  return new Date(value).toLocaleString();
}

export function VerifiedXStockResult({ mint }: { mint: string }) {
  const { data, isLoading, error } = useQuery<VerifiedXStock>({
    queryKey: ["/api/tokenized-stocks/verified", mint],
    queryFn: async () => {
      const response = await fetch(`/api/tokenized-stocks/verified/${encodeURIComponent(mint)}`);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "This verified xStock is currently unavailable.");
      }
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="py-20 text-center" data-testid="xstock-loading">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-emerald-600" />
        <h2 className="mt-4 text-xl font-bold">Loading verified xStock...</h2>
        <p className="mt-1 text-sm text-muted-foreground">Checking the issuer catalog and latest market observation</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="p-8 text-center" data-testid="xstock-error">
        <AlertCircle className="mx-auto h-9 w-9 text-amber-500" />
        <h2 className="mt-3 text-xl font-bold">Verified xStock unavailable</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{(error as Error)?.message}</p>
        <Link href="/tokenized-stocks">
          <Button className="mt-5">Browse verified xStocks</Button>
        </Link>
      </Card>
    );
  }

  const change = data.priceChange24hPct;
  return (
    <div className="space-y-6" data-testid="xstock-scan-result">
      <Card className="overflow-hidden border-emerald-500/30">
        <div className="border-b border-emerald-500/20 bg-emerald-500/5 p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm">
              {data.logoUrl
                ? <img src={data.logoUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                : <Landmark className="h-6 w-6 text-emerald-600" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-black text-white">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Verified xStock
                </span>
                <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-bold text-muted-foreground">Solana</span>
                <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-bold text-muted-foreground">{data.issuer}</span>
              </div>
              <h1 className="mt-3 text-2xl font-black text-foreground sm:text-3xl">{data.name}</h1>
              <p className="mt-1 text-sm font-bold text-emerald-700 dark:text-emerald-300">
                {data.tokenSymbol}{data.underlyingTicker ? ` · underlying ${data.underlyingTicker}` : ""}
              </p>
              <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{data.mint}</p>
            </div>
            <div className="rounded-xl border border-border bg-background px-4 py-3 text-left sm:text-right">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Issuer status</p>
              <p className="mt-1 text-sm font-black text-foreground">{data.availabilityLabel}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-px bg-border sm:grid-cols-4">
          {[
            ["Observed price", money(data.priceUsd)],
            ["24h change", change === null ? "Unavailable" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`],
            ["DEX liquidity", money(data.liquidityUsd)],
            ["24h volume", money(data.volume24hUsd)],
          ].map(([label, value]) => (
            <div key={label} className="bg-card p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
              <p className="mt-1 text-lg font-black text-foreground">{value}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            <h2 className="font-black text-foreground">What verification means</h2>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            This mint was matched against the official xStocks issuer catalog. The symbol was used only to find the asset;
            the Solana mint above is its identity.
          </p>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Verification does not guarantee price, liquidity, availability, or investment performance.
          </p>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-emerald-600" />
            <h2 className="font-black text-foreground">Data freshness</h2>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{observed(data.marketDataObservedAt)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.marketDataSource || "Secondary market data is currently unavailable."}
          </p>
          {data.marketDataStale && (
            <p className="mt-3 rounded-lg bg-amber-500/10 p-2.5 text-xs font-semibold text-amber-800 dark:text-amber-200">
              Market data may be delayed. Do not treat the displayed price as an executable quote.
            </p>
          )}
        </Card>
      </div>

      <Card className="border-blue-500/20 bg-blue-500/5 p-5">
        <h2 className="font-black text-foreground">Tokenized-stock notice</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Tokenized stocks are different from ordinary crypto tokens. Eligibility, jurisdiction, issuer controls,
          market hours, liquidity, and provider rules may apply. PAIF.fun currently supports tokenized stocks for
          discovery and paper-strategy practice—not live execution.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`/swing-bot?stock=${encodeURIComponent(data.mint)}`}>
            <Button className="font-bold">Practice in Paper mode</Button>
          </Link>
          <Link href="/tokenized-stocks">
            <Button variant="outline" className="font-bold">Browse verified xStocks</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}