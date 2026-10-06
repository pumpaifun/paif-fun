import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown } from "lucide-react";
import { Link } from "wouter";

interface TrendingToken {
  mint: string;
  symbol: string;
  name: string;
  price: string;
  change1h: number | null;
  icon: string;
}

function TickerItem({ token }: { token: TrendingToken }) {
  const change = token.change1h;
  const isUp = change !== null && change >= 0;
  const priceNum = parseFloat(token.price);
  const priceStr = priceNum < 0.0001
    ? priceNum.toExponential(2)
    : priceNum < 1
    ? priceNum.toPrecision(4)
    : priceNum.toFixed(2);

  return (
    <a
      href={`https://dexscreener.com/solana/${token.mint}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 px-2 sm:px-4 shrink-0 hover:opacity-80 transition-opacity"
      data-testid={`ticker-token-${token.mint}`}
    >
      {token.icon && (
        <img
          src={`https://dd.dexscreener.com/ds-data/tokens/solana/${token.mint}.png?size=lg&key=${token.icon}`}
          alt={token.symbol}
          className="w-4 h-4 rounded-full object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      )}
      <span className="font-semibold text-white text-xs">{token.symbol}</span>
      <span className="text-white/60 text-xs">${priceStr}</span>
      {change !== null && (
        <span className={`text-xs flex items-center gap-0.5 ${isUp ? "text-emerald-400" : "text-red-400"}`}>
          {isUp ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
          {isUp ? "+" : ""}{change.toFixed(1)}%
        </span>
      )}
      <span className="text-white/20 text-xs ml-1">|</span>
    </a>
  );
}

export function TrendingTicker() {
  const { data: tokens = [], isLoading } = useQuery<TrendingToken[]>({
    queryKey: ["/api/trending-tokens"],
    refetchInterval: 5 * 60 * 1000,
    staleTime: 4 * 60 * 1000,
  });

  if (isLoading || tokens.length === 0) {
    return (
      <div className="flex h-8 w-full items-center overflow-hidden border-b border-emerald-800/70 bg-emerald-950">
        <div className="flex items-center gap-6 px-4 animate-pulse">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-3 w-16 bg-white/10 rounded" />
          ))}
        </div>
      </div>
    );
  }

  const doubled = [...tokens, ...tokens];

  return (
    <div
      className="flex h-8 w-full items-center overflow-hidden border-b border-emerald-800/70 bg-emerald-950"
      data-testid="trending-ticker"
    >
      <Link href="/crypto-leaderboard?view=trending" title="Open the crypto trending leaderboard" aria-label="Open the crypto trending leaderboard" className="z-10 flex h-full shrink-0 items-center gap-1.5 border-r border-white/10 bg-emerald-900 px-2 sm:px-3 font-mono text-[10px] font-bold uppercase tracking-[.14em] text-emerald-100 transition-colors hover:bg-emerald-800" data-testid="link-trending-crypto">
        <TrendingUp className="h-3.5 w-3.5" />
        <span className="sm:hidden">24/7</span>
        <span className="hidden sm:inline">Trending crypto · 24/7</span>
      </Link>
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div className="pointer-events-none absolute bottom-0 left-0 top-0 z-10 w-3 bg-gradient-to-r from-emerald-950 to-transparent sm:w-8" />
        <div className="pointer-events-none absolute bottom-0 right-0 top-0 z-10 w-3 bg-gradient-to-l from-emerald-950 to-transparent sm:w-8" />
        <div className="flex items-center animate-ticker whitespace-nowrap">
          {doubled.map((token, i) => (
            <TickerItem key={`${token.mint}-${i}`} token={token} />
          ))}
        </div>
      </div>
    </div>
  );
}
