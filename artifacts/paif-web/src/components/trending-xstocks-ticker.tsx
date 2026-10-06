import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, TrendingDown, TrendingUp } from "lucide-react";
import { Link } from "wouter";

interface TrendingXStock {
  mint: string;
  name: string;
  tokenSymbol: string;
  underlyingTicker: string;
  logoUrl?: string | null;
  tradingStatus: string;
  priceUsd: number | null;
  priceChange24hPct: number | null;
  verifiedMint: true;
}

interface TrendingXStocksResponse {
  assets: TrendingXStock[];
  status?: {
    marketSession?: {
      state: "open" | "closed" | "unavailable";
      nextOpenAt: string | null;
      timeZone: string;
      calendarStatus?: {
        message: string;
      };
    };
  };
}

function formatPrice(value: number) {
  if (value < 0.01) return `$${value.toPrecision(3)}`;
  if (value < 100) return `$${value.toFixed(2)}`;
  return `$${Math.round(value).toLocaleString()}`;
}

function XStockItem({ asset }: { asset: TrendingXStock }) {
  const change = asset.priceChange24hPct;
  const isUp = change != null && change >= 0;
  return (
    <Link
      href={`/scan?xstock=${encodeURIComponent(asset.mint)}`}
      title={`${asset.name} · verified xStock`}
      className="inline-flex shrink-0 items-center gap-1.5 px-2 sm:px-4 text-xs transition-opacity hover:opacity-75"
      data-testid={`ticker-xstock-${asset.mint}`}
    >
      {asset.logoUrl ? (
        <img
          src={asset.logoUrl}
          alt=""
          className="h-4 w-4 rounded-full object-cover"
          onError={(event) => { (event.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        <BadgeCheck className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-300" />
      )}
      <span className="font-bold text-foreground">{asset.underlyingTicker || asset.tokenSymbol}</span>
      <span className="text-muted-foreground">{formatPrice(asset.priceUsd!)}</span>
      {change != null && (
        <span className={`flex items-center gap-0.5 ${isUp ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-300"}`}>
          {isUp ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
          {isUp ? "+" : ""}{change.toFixed(1)}%
        </span>
      )}
      <span className="ml-1 text-muted-foreground/40">|</span>
    </Link>
  );
}

export function TrendingXStocksTicker() {
  const { data, isLoading } = useQuery<TrendingXStocksResponse>({
    queryKey: ["/api/tokenized-stocks", "homepage-trending-xstocks"],
    queryFn: async () => {
      const response = await fetch("/api/tokenized-stocks?issuer=xStocks&sort=priceChange24h&pageSize=12");
      if (!response.ok) throw new Error("The verified xStocks feed could not be loaded.");
      return response.json();
    },
    staleTime: 45_000,
    refetchInterval: (query) =>
      query.state.data?.status?.marketSession?.state === "closed" ? 5 * 60_000 : 60_000,
  });

  const assets = (data?.assets ?? []).filter((asset) =>
    asset.verifiedMint &&
    asset.tradingStatus !== "halted" &&
    asset.priceUsd != null &&
    Number.isFinite(asset.priceUsd) &&
    asset.priceUsd > 0,
  ).slice(0, 8);

  return (
    <div
      className="w-full border-b border-emerald-200 bg-emerald-50/90 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-50"
      data-testid="trending-xstocks-ticker"
    >
      <div className="flex h-8 items-center overflow-hidden">
        <Link
          href="/tokenized-stocks?view=trending"
          className="group z-10 flex h-full shrink-0 items-center gap-1.5 border-r border-emerald-700 bg-emerald-100 px-2 font-mono text-[10px] font-bold uppercase tracking-[.14em] text-emerald-800 transition-colors hover:bg-emerald-200 sm:px-3 dark:border-white/10 dark:bg-emerald-900 dark:text-emerald-100 dark:hover:bg-emerald-800"
          data-testid="link-trending-xstocks"
        >
          <BadgeCheck className="h-3.5 w-3.5 text-emerald-600 transition-colors group-hover:text-emerald-800 dark:text-emerald-200 dark:group-hover:text-white" />
          <span className="sm:hidden">xStocks</span>
          <span className="hidden sm:inline">Trending xStocks</span>
        </Link>
        <div className="relative min-w-0 flex-1 overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 z-10 w-3 bg-gradient-to-r from-emerald-50 to-transparent pointer-events-none sm:w-8 dark:from-emerald-950/80" />
          <div className="absolute right-0 top-0 bottom-0 z-10 w-3 bg-gradient-to-l from-emerald-50 to-transparent pointer-events-none sm:w-8 dark:from-emerald-950/80" />
          {isLoading ? (
            <div className="flex items-center gap-8 px-4">
              {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-3 w-20 animate-pulse rounded bg-emerald-200/70 dark:bg-emerald-800/60" />)}
            </div>
          ) : assets.length === 0 ? (
            <div className="px-4 text-xs text-muted-foreground">Verified stock prices are updating…</div>
          ) : (
            <div className="flex items-center animate-ticker whitespace-nowrap">
              {[...assets, ...assets].map((asset, index) => (
                <XStockItem key={`${asset.mint}-${index}`} asset={asset} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}