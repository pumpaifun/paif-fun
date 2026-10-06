import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { isValidSolanaAddress } from "@/lib/chains";
import { Star, Plus, Trash2, LineChart, Loader2, TrendingUp, TrendingDown, Search, ScanLine } from "lucide-react";
import {
  addWatchItem,
  isTokenWatched,
  loadWatchlist,
  removeWatchItem,
  saveWatchlist,
  type WatchItem,
} from "@/lib/watchlist";

type Guidance = {
  found: boolean;
  symbol: string | null;
  name: string | null;
  priceUsd: number | null;
  change24h: number | null;
  liquidityUsd: number | null;
  volume24h: number | null;
  dexId: string | null;
  url: string | null;
};

function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 5)}…${a.slice(-4)}` : a;
}

function fmtPrice(p: number | null): string {
  if (p == null) return "—";
  if (p >= 1) return `$${p.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (p >= 0.01) return `$${p.toFixed(4)}`;
  if (p >= 0.0001) return `$${p.toFixed(6)}`;
  return `$${p.toExponential(2)}`;
}

function fmtCompact(n: number | null): string {
  if (n == null) return "—";
  return `$${new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n)}`;
}

// Plain-language read of pool depth — facts, never advice.
function caution(g: Guidance): { note: string; tone: string } {
  const liq = g.liquidityUsd;
  if (liq == null) {
    return { note: "No pool depth reported yet.", tone: "text-muted-foreground" };
  }
  if (liq < 10_000) {
    return {
      note: `Very thin pool (${fmtCompact(liq)}). Tiny trades swing the price and selling can be near-impossible — treat as very high risk.`,
      tone: "text-red-600 dark:text-red-400",
    };
  }
  if (liq < 50_000) {
    return {
      note: `Thin pool (${fmtCompact(liq)}). Prices move fast and selling any real size is hard.`,
      tone: "text-amber-600 dark:text-amber-400",
    };
  }
  if (liq < 250_000) {
    return { note: `Moderate pool (${fmtCompact(liq)}).`, tone: "text-blue-600 dark:text-blue-400" };
  }
  return { note: `Deep pool (${fmtCompact(liq)}).`, tone: "text-emerald-600 dark:text-emerald-400" };
}

function WatchCard({ item, onRemove }: { item: WatchItem; onRemove: () => void }) {
  const q = useQuery<Guidance>({
    queryKey: ["/api/watchlist/token", item.address],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/watchlist/token?address=${encodeURIComponent(item.address)}`,
      );
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const g = q.data;
  const chartUrl = g?.url ?? `https://dexscreener.com/solana/${item.address}`;
  const c = g?.found ? caution(g) : null;
  const up = (g?.change24h ?? 0) >= 0;

  return (
    <Card data-testid={`card-watch-${item.address}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold truncate" data-testid={`text-watch-name-${item.address}`}>
                {q.isLoading ? "Loading…" : g?.found ? g.symbol || g.name || shortAddr(item.address) : shortAddr(item.address)}
              </span>
              <span className="text-[10px] font-medium rounded-full border border-border px-2 py-0.5">SOL</span>
            </div>
            {g?.found && g.name && g.symbol && g.name !== g.symbol && (
              <p className="text-xs text-muted-foreground truncate">{g.name}</p>
            )}
            <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{shortAddr(item.address)}</p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 text-muted-foreground shrink-0"
            onClick={onRemove}
            aria-label="Remove from watchlist"
            data-testid={`button-remove-${item.address}`}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>

        {q.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Getting the latest numbers…
          </div>
        ) : q.isError ? (
          <p className="text-sm text-amber-600 dark:text-amber-400">Couldn't reach the price feed — it'll retry automatically.</p>
        ) : !g?.found ? (
          <p className="text-sm text-muted-foreground">
            No Solana trading pool was found yet. The token may be brand new or not listed on a supported market.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md border border-border p-2">
                <div className="text-sm font-bold" data-testid={`text-price-${item.address}`}>{fmtPrice(g.priceUsd)}</div>
                <div className="text-[10px] text-muted-foreground">Price</div>
              </div>
              <div className="rounded-md border border-border p-2">
                <div className={`text-sm font-bold flex items-center justify-center gap-0.5 ${up ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`} data-testid={`text-change-${item.address}`}>
                  {g.change24h == null ? "—" : (<>{up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}{up ? "+" : ""}{g.change24h.toFixed(1)}%</>)}
                </div>
                <div className="text-[10px] text-muted-foreground">24h</div>
              </div>
              <div className="rounded-md border border-border p-2">
                <div className="text-sm font-bold" data-testid={`text-liq-${item.address}`}>{fmtCompact(g.liquidityUsd)}</div>
                <div className="text-[10px] text-muted-foreground">Pool</div>
              </div>
            </div>
            {c && <p className={`text-xs ${c.tone}`} data-testid={`text-caution-${item.address}`}>{c.note} <span className="text-muted-foreground">Just how we read the data — not financial advice.</span></p>}
          </>
        )}

        <div className="flex flex-wrap gap-2">
          <Link href={`/scan?q=${encodeURIComponent(item.address)}`}>
            <Button size="sm" className="h-8 bg-black text-white hover:bg-black/90" data-testid={`button-scan-${item.address}`}>
              <ScanLine className="w-4 h-4 mr-1" /> Full scan
            </Button>
          </Link>
          <a href={chartUrl} target="_blank" rel="noreferrer">
            <Button size="sm" variant="outline" className="h-8" data-testid={`button-chart-${item.address}`}>
              <LineChart className="w-4 h-4 mr-1" /> Chart
            </Button>
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

export default function WatchlistPage() {
  const { toast } = useToast();
  const [items, setItems] = useState<WatchItem[]>(loadWatchlist);
  const [addr, setAddr] = useState("");

  useEffect(() => {
    document.title = "Solana Token Watchlist | PAIF.fun";
  }, []);

  useEffect(() => {
    saveWatchlist(items);
  }, [items]);

  const add = () => {
    const a = addr.trim();
    if (!a) return;
    if (!isValidSolanaAddress(a)) {
      toast({
        title: "That doesn't look like a Solana token address",
        description: "Paste a valid Solana token contract address.",
        variant: "destructive",
      });
      return;
    }
    if (isTokenWatched(items, "solana", a)) {
      toast({ title: "Already on your watchlist", description: "This token is already saved." });
      setAddr("");
      return;
    }
    const next = addWatchItem(items, "solana", a);
    const persisted = saveWatchlist(next);
    setItems(next);
    setAddr("");
    toast({
      title: "Added to watchlist",
      description: persisted
        ? "Saved on Solana."
        : "Browser storage is unavailable, so this token is saved only while the app remains open.",
    });
  };

  const remove = (item: WatchItem) => {
    setItems((prev) => removeWatchItem(prev, item.chainId, item.address));
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-2">
          <Star className="w-7 h-7 fill-amber-400 text-amber-400" />
          <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-page-title">Watchlist</h1>
        </div>
        <p className="text-muted-foreground mb-6">
          Search any Solana token and save it here. Each saved token shows a quick read —
          price, 24h move, and how deep its pool is — plus a one-tap full scan. Your list is saved on this device.
        </p>

        <Card className="mb-6">
          <CardContent className="p-4 space-y-3">
            <div>
              <label htmlFor="watchlist-token-address" className="text-sm font-medium mb-1 block">
                Solana token contract address
              </label>
              <div className="flex gap-2">
                <Input
                  id="watchlist-token-address"
                  value={addr}
                  onChange={(e) => setAddr(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") add(); }}
                  placeholder="Paste a Solana token address…"
                  className="text-sm"
                  data-testid="input-address"
                />
                <Button className="bg-black text-white hover:bg-black/90 shrink-0" onClick={add} data-testid="button-add">
                  <Plus className="w-4 h-4 mr-1" /> Add
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {items.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Search className="w-8 h-8 mx-auto mb-2 opacity-40" />
              Nothing saved yet. Paste a token address above to start your watchlist.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <WatchCard key={item.address} item={item} onRemove={() => remove(item)} />
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
