import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, CheckCircle2, ChevronDown, CircleHelp, Clock3, ExternalLink, Info, Layers3, RefreshCw, ShieldCheck, SlidersHorizontal, TrendingDown, TrendingUp, Wifi, XCircle } from "lucide-react";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";

type SortKey = "trending" | "availability" | "liquidity" | "volume24h" | "priceChange24h";
interface TokenizedAsset {
  issuer: string;
  mint: string;
  issuerAssetId: string;
  name: string;
  tokenSymbol: string;
  underlyingTicker: string;
  instrumentType: string;
  logoUrl?: string;
  tradingStatus: string;
  availabilityLabel: string;
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange24hPct: number | null;
  marketDataObservedAt?: string | null;
  issuerCatalogObservedAt?: string | null;
  marketDataSource?: string | null;
  failure?: string | null;
  verifiedMint: true;
  network: "Solana";
  priceUnit: "USD per token";
  liquidityUnit: "USD";
  volumeUnit: "USD / 24h";
  marketDataStale: boolean;
}

interface SourceStatus {
  state: "live" | "stale" | "error" | "unconfigured";
  itemCount: number;
  lastSuccessAt?: string | null;
  message?: string | null;
}

interface CatalogResponse {
  assets: TokenizedAsset[];
  status: {
    partial: boolean;
    readOnly: boolean;
    sources: { xStocks: SourceStatus; Ondo: SourceStatus };
    catalogCount: number;
    page: number;
    pageSize: number;
    hasNextPage: boolean;
    generatedAt?: string;
    disclosure?: string;
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

const sortOptions: { key: SortKey; label: string; detail: string; icon: typeof Activity }[] = [
  { key: "trending", label: "Trending", detail: "biggest movers first", icon: TrendingUp },
  { key: "availability", label: "Market status", detail: "open markets first", icon: Layers3 },
  { key: "liquidity", label: "Liquidity", detail: "deepest USD markets first", icon: ShieldCheck },
  { key: "volume24h", label: "24h volume", detail: "highest traded volume first", icon: Activity },
  { key: "priceChange24h", label: "Price change", detail: "biggest 24h moves first", icon: TrendingUp },
];

function compactUsd(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}m`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(value < 10 ? 2 : 0)}`;
}

function percent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function ago(iso?: string | null) {
  if (!iso) return "time unavailable";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

function StatusMark({ state }: { state: SourceStatus["state"] }) {
  if (state === "live") return <span className="inline-flex items-center gap-1 text-[#18794e] dark:text-[#78d7a1]"><CheckCircle2 className="h-3.5 w-3.5" /> Live</span>;
  if (state === "stale") return <span className="inline-flex items-center gap-1 text-[#a15c00] dark:text-[#e8b56a]"><Clock3 className="h-3.5 w-3.5" /> Stale</span>;
  if (state === "error") return <span className="inline-flex items-center gap-1 text-[#b34234] dark:text-[#f09a8e]"><XCircle className="h-3.5 w-3.5" /> Error</span>;
  return <span className="inline-flex items-center gap-1 text-muted-foreground"><CircleHelp className="h-3.5 w-3.5" /> Not configured</span>;
}

function AssetLogo({ asset }: { asset: TokenizedAsset }) {
  const [failed, setFailed] = useState(false);
  return asset.logoUrl && !failed ? (
    <img src={asset.logoUrl} alt="" onError={() => setFailed(true)} className="h-10 w-10 rounded-xl object-cover ring-1 ring-border/70" />
  ) : (
    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#dcebe3] font-mono text-[11px] font-bold text-[#126247] ring-1 ring-[#b9d9ca] dark:bg-[#244638] dark:text-[#bce8cb] dark:ring-[#477b61]">
      {(asset.tokenSymbol || asset.underlyingTicker || "?").replace("$", "").slice(0, 3)}
    </div>
  );
}

export default function TokenizedStocksPage() {
  const [sort, setSort] = useState<SortKey>(() =>
    new URLSearchParams(window.location.search).get("view") === "trending" ? "trending" : "liquidity"
  );
  const [page, setPage] = useState(0);
  const [showMethodology, setShowMethodology] = useState(false);
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, []);
  const queryKey = useMemo(() => ["/api/tokenized-stocks", sort, page] as const, [sort, page]);

  const { data, error, isLoading, isFetching, refetch } = useQuery<CatalogResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ sort: sort === "trending" ? "priceChange24h" : sort, page: String(page), pageSize: "100" });
      params.set("issuer", "xStocks");
      const response = await fetch(`/api/tokenized-stocks?${params.toString()}`);
      if (!response.ok) throw new Error("The catalog could not be loaded.");
      return response.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const assets = data?.assets ?? [];
  const statuses = data?.status?.sources;
  const marketSession = data?.status?.marketSession;

  return (
    <div className="min-h-[100dvh] bg-[#f4f7f3] text-[#17362b] dark:bg-[#102019] dark:text-[#eef6ed]">
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:px-8">
        <section className="relative overflow-hidden rounded-[1.35rem] border border-[#c9ded2] bg-[#e5f1e9] px-5 py-6 shadow-[0_18px_45px_rgba(34,86,61,0.07)] dark:border-[#2d5142] dark:bg-[#18352a] dark:shadow-[0_18px_45px_rgba(0,0,0,0.18)] sm:px-8 sm:py-8">
          <div className="pointer-events-none absolute -right-10 -top-24 h-64 w-64 rounded-full border-[28px] border-[#c9e2d2]/70 dark:border-[#2b604b]/70" />
           <div className="relative max-w-5xl">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Badge className="rounded-full border border-[#a8cfb7] bg-[#d3e9da] px-2.5 py-1 font-mono text-xs uppercase tracking-[0.16em] text-[#126247] hover:bg-[#d3e9da] dark:border-[#4c8668] dark:bg-[#28513e] dark:text-[#c5edd2] dark:hover:bg-[#28513e]">Solana / read-only</Badge>
              <span className="inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-[0.14em] text-[#47705d] dark:text-[#a2c7ae]"><Wifi className="h-3 w-3" /> Discovery terminal</span>
            </div>
            <h1 className="max-w-4xl font-sans text-3xl font-extrabold tracking-[-0.045em] text-[#14382b] dark:text-[#eff8ef] sm:text-5xl">Verified tokenized stocks on Solana.</h1>
             <div className="mt-3 space-y-1 font-mono text-xs text-[#47705d] dark:text-[#a2c7ae]">
               <p>Mint verified · Solana · USD per token</p>
               <p>Market source: DexScreener Solana markets</p>
             </div>
            <div className="mt-6 flex flex-wrap items-center gap-3 text-sm font-semibold text-[#37624d] dark:text-[#b4d8c0]">
              <span className="inline-flex items-center gap-1.5"><StatusMark state={statuses?.xStocks?.state ?? "unconfigured"} /> {statuses?.xStocks?.itemCount ?? 0} catalog items</span>
            </div>
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-4 flex justify-end">
             <div className="flex flex-wrap items-center gap-2">
               <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2 border-[#cbdcd0] bg-[#fbfcf8] text-sm font-bold dark:border-[#3b5a4c] dark:bg-[#162a22] dark:text-[#e5f2e7] dark:hover:bg-[#213c30]" data-testid="button-refresh-tokenized-stocks"><RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh</Button>
            </div>
          </div>

          <div className="mb-4 flex items-center gap-3 overflow-x-auto pb-1 lg:gap-4">
            <SlidersHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
              {sortOptions.map(({ key, label, detail, icon: Icon }) => <button key={key} onClick={() => { setSort(key); setPage(0); }} className={`flex min-w-[190px] shrink-0 items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all lg:min-w-0 lg:flex-1 lg:shrink ${sort === key ? "border-[#8bbfa1] bg-[#e4f1e8] text-[#126247] shadow-sm dark:border-[#5d9b78] dark:bg-[#204435] dark:text-[#c9f0d5]" : "border-[#d7e1da] bg-[#fbfcf8] text-muted-foreground hover:border-[#b9d0c0] dark:border-[#2d4d40] dark:bg-[#162a22] dark:hover:border-[#4a725c]"}`} data-testid={`sort-${key}`}><Icon className="h-4 w-4 shrink-0" /><span><span className="block text-sm font-bold">{label}</span><span className="block font-mono text-sm opacity-70">{detail}</span></span>{sort === key && <ChevronDown className="ml-auto h-4 w-4 shrink-0" />}</button>)}
          </div>

           {error && <Card className="border-[#ebc9c2] bg-[#fff8f6] shadow-none dark:border-[#633b35] dark:bg-[#2c1e1b]"><CardContent className="flex flex-col items-start gap-3 p-8 sm:flex-row sm:items-center"><XCircle className="h-6 w-6 text-[#b34234] dark:text-[#f09a8e]" /><div className="flex-1"><p className="font-bold">Catalog unavailable</p><p className="mt-1 text-sm text-muted-foreground">The discovery feed did not respond. No cached ranking is being shown.</p></div><Button variant="outline" size="sm" onClick={() => refetch()} className="border-[#d8b7b0] dark:border-[#70453d] dark:bg-[#2c1e1b]">Try again</Button></CardContent></Card>}
            {marketSession?.state === "unavailable" && <Card className="mb-4 border-[#e5c58d] bg-[#fff9ec] shadow-none dark:border-[#6b512b] dark:bg-[#302719]"><CardContent className="flex items-start gap-3 p-4 text-sm text-[#765218] dark:text-[#f0ca81]"><Clock3 className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="font-bold">Stock schedule unavailable</p><p className="mt-1">{marketSession.calendarStatus?.message || "The annual U.S. equity calendar could not be verified. Prices are shown as last observations and practice stock activity is paused."}</p></div></CardContent></Card>}
           {isLoading && <div className="space-y-2">{[1, 2, 3, 4].map((item) => <div key={item} className="h-[116px] animate-pulse rounded-2xl border border-[#dfe8e0] bg-[#fbfcf8] dark:border-[#2d4d40] dark:bg-[#162a22]" />)}</div>}
           {!isLoading && !error && assets.length === 0 && <Card className="border-dashed border-[#c8d9cc] bg-[#fbfcf8] shadow-none dark:border-[#3b5b49] dark:bg-[#162a22]"><CardContent className="flex flex-col items-center justify-center px-5 py-16 text-center"><Layers3 className="h-8 w-8 text-[#8bb59d] dark:text-[#6cae88]" /><p className="mt-3 font-bold">No verified assets in this view</p><p className="mt-1 max-w-sm text-sm leading-5 text-muted-foreground">Try another issuer or ranking. Empty results are kept explicit rather than filled with estimates.</p></CardContent></Card>}
          <div className="space-y-2">
            {!isLoading && assets.map((asset, index) => {
              const change = asset.priceChange24hPct ?? 0;
              return <Card key={asset.mint} className="group border-[#d7e1da] bg-[#fbfcf8] shadow-none transition-all duration-200 hover:-translate-y-0.5 hover:border-[#a8cbb3] hover:shadow-[0_10px_25px_rgba(34,86,61,0.07)] dark:border-[#2d4d40] dark:bg-[#162a22] dark:hover:border-[#56866a] dark:hover:shadow-[0_10px_25px_rgba(0,0,0,0.18)]" data-testid={`asset-row-${asset.mint.slice(0, 8)}`}>
                <CardContent className="p-4 sm:p-5">
                   <div className="grid gap-4 lg:grid-cols-[minmax(220px,1.35fr)_repeat(5,minmax(82px,0.65fr))_auto] lg:items-center">
                     <div className="flex min-w-0 items-center gap-3"><span className="w-5 shrink-0 font-mono text-sm text-muted-foreground">{String(index + 1).padStart(2, "0")}</span><AssetLogo asset={asset} /><div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-sm font-extrabold">{asset.name}</p><Badge variant="outline" className="shrink-0 border-[#b9d9ca] bg-[#eff7f0] px-1.5 py-0 text-xs text-[#18794e] dark:border-[#4d8164] dark:bg-[#244638] dark:text-[#bce8cb]">{asset.issuer}</Badge></div><p className="mt-1 font-mono text-sm text-muted-foreground">{asset.underlyingTicker} · {asset.instrumentType} · {asset.availabilityLabel}</p></div></div>
                     <div><p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Price / token</p><p className="mt-1 text-sm font-bold">{compactUsd(asset.priceUsd)}</p><p className="font-mono text-xs text-muted-foreground">USD</p></div>
                      <div><p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Token market cap</p><p className="mt-1 text-sm font-bold">{compactUsd(asset.marketCapUsd)}</p><p className="font-mono text-xs text-muted-foreground">USD</p></div>
                     <div><p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Liquidity</p><p className="mt-1 text-sm font-bold">{compactUsd(asset.liquidityUsd)}</p><p className="font-mono text-xs text-muted-foreground">USD</p></div>
                     <div><p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Volume / 24h</p><p className="mt-1 text-sm font-bold">{compactUsd(asset.volume24hUsd)}</p><p className="font-mono text-xs text-muted-foreground">USD / 24h</p></div>
                     <div><p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">24h move</p><p className={`mt-1 inline-flex items-center gap-1 text-sm font-bold ${change >= 0 ? "text-[#18794e] dark:text-[#78d7a1]" : "text-[#b34234] dark:text-[#f09a8e]"}`}>{change >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}{percent(asset.priceChange24hPct)}</p><p className="font-mono text-xs text-muted-foreground">{asset.marketDataStale ? "delayed" : "observed"}</p></div>
                     <div className="flex items-center justify-between gap-3 lg:justify-end">
                       <div className="text-right"><p className={`font-mono text-sm ${asset.marketDataStale ? "text-[#a15c00] dark:text-[#e8b56a]" : "text-muted-foreground"}`}>{asset.marketDataStale ? "Market data stale" : ago(asset.marketDataObservedAt)}</p><p className="mt-1 text-sm text-muted-foreground">{asset.tradingStatus}</p></div>
                       <div className="flex gap-1.5">
                         <Link href={`/swing-bot?stock=${encodeURIComponent(asset.mint)}`} className="inline-flex h-8 items-center rounded-lg bg-[#18794e] px-2.5 text-sm font-bold text-white transition-colors hover:bg-[#12633f]" data-testid={`button-paper-stock-${asset.mint.slice(0, 8)}`}>
                           Practice
                         </Link>
                          <a href={`https://dexscreener.com/solana/${asset.mint}`} target="_blank" rel="noreferrer" aria-label={`Open ${asset.tokenSymbol} market chart on DexScreener`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#cbdcd0] px-2.5 text-sm font-bold text-[#276349] transition-colors hover:bg-[#e5f1e9] dark:border-[#3b5a4c] dark:text-[#a9dabe] dark:hover:bg-[#214737]" data-testid={`button-chart-stock-${asset.mint.slice(0, 8)}`}><Activity className="h-3 w-3" /> Chart</a>
                         <a href={`https://solscan.io/token/${asset.mint}`} target="_blank" rel="noreferrer" aria-label={`View verified ${asset.tokenSymbol} mint on Solscan`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#cbdcd0] px-2.5 text-sm font-bold text-[#276349] transition-colors hover:bg-[#e5f1e9] dark:border-[#3b5a4c] dark:text-[#a9dabe] dark:hover:bg-[#214737]"><ExternalLink className="h-3 w-3" /> Mint</a>
                       </div>
                     </div>
                  </div>
                    {asset.failure && <div className="mt-3 border-t border-[#e3ebe4] pt-2 font-mono text-xs text-[#a15c00] dark:border-[#2d4d40] dark:text-[#e8b56a]">{asset.failure}</div>}
                </CardContent>
              </Card>;
            })}
          </div>
          {!isLoading && !error && data && data.status.catalogCount > data.status.pageSize && (
            <div className="mt-5 flex items-center justify-between rounded-xl border border-[#d7e1da] bg-[#fbfcf8] px-4 py-3 dark:border-[#2d4d40] dark:bg-[#162a22]">
              <p className="font-mono text-sm text-muted-foreground">
                Showing {page * data.status.pageSize + 1}–{Math.min((page + 1) * data.status.pageSize, data.status.catalogCount)} of {data.status.catalogCount}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0 || isFetching} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</Button>
                <Button variant="outline" size="sm" disabled={!data.status.hasNextPage || isFetching} onClick={() => setPage((value) => value + 1)}>Next</Button>
              </div>
            </div>
          )}
        </section>

        <section className="mt-8 overflow-hidden rounded-2xl border border-[#d7e1da] bg-[#edf4ee] dark:border-[#2d4d40] dark:bg-[#193329]">
          <button onClick={() => setShowMethodology(!showMethodology)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left" data-testid="button-toggle-methodology"><span className="flex items-center gap-2 text-sm font-bold"><Info className="h-4 w-4 text-[#18794e] dark:text-[#78d7a1]" /> How to read this surface</span><ChevronDown className={`h-4 w-4 transition-transform ${showMethodology ? "rotate-180" : ""}`} /></button>
          {showMethodology && <div className="grid gap-4 border-t border-[#d7e1da] px-5 py-5 text-sm leading-5 text-[#4b6b57] dark:border-[#2d4d40] dark:text-[#b4d2bd] sm:grid-cols-3"><p><strong className="text-[#17362b] dark:text-[#e9f6e9]">Verified is narrow.</strong> It means the returned mint was verified by its issuer catalog. It does not guarantee liquidity, redemption, or eligibility.</p><p><strong className="text-[#17362b] dark:text-[#e9f6e9]">Time matters.</strong> Prices, liquidity, and volume are observations. A stale marker means the market feed is older than the catalog’s freshness threshold.</p><p><strong className="text-[#17362b] dark:text-[#e9f6e9]">Discovery, not advice.</strong> This is a read-only ranking surface. Availability can vary by jurisdiction, venue, and issuer restrictions.</p></div>}
        </section>
        <p className="mt-5 text-center font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Rankings are discovery data, not investment advice · Generated {data?.status?.generatedAt ? ago(data.status.generatedAt) : "when feed responds"}</p>
      </main>
      <Footer />
    </div>
  );
}