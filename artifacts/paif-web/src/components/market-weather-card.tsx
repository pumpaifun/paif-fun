import { useQuery } from "@tanstack/react-query";
import { Activity, TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";

type MarketWeatherResponse = {
  available: boolean;
  btcUsd?: number;
  btcChg24?: number;
  solUsd?: number;
  solChg24?: number;
  nasdaqChg1d?: number | null;
  mood?: "red" | "green" | "mixed";
  facts?: string;
};

export function MarketWeatherCard({ embedded = false }: { embedded?: boolean }) {
  const { data: weatherRes } = useQuery<MarketWeatherResponse>({
    queryKey: ["/api/swing-bot/market-weather"],
    refetchInterval: 2 * 60 * 1000,
  });

  const weather = weatherRes?.available && weatherRes.mood &&
    Number.isFinite(weatherRes.solChg24)
    ? { mood: weatherRes.mood, solChg24: weatherRes.solChg24!, nasdaqChg1d: weatherRes.nasdaqChg1d ?? null }
    : null;

  if (!weather) return null;

  const formatChange = (change: number) => `${change >= 0 ? "+" : "−"}${Math.abs(change).toFixed(1)}%`;
  const metricArrow = (change: number, testId: string) => change >= 0
    ? <TrendingUp className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" data-testid={testId} />
    : <TrendingDown className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" data-testid={testId} />;
  const tone = weather.mood === "red"
    ? "border-red-500/40 bg-red-500/5"
    : weather.mood === "green"
      ? "border-emerald-500/40 bg-emerald-500/5"
      : "border-border";
  const displayTone = embedded
    ? `${tone} bg-background/85 shadow-sm backdrop-blur-sm`
    : tone;

  return (
    <Card className={displayTone} data-testid="card-market-weather">
      <div className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <span className="flex items-center gap-2 font-semibold"><Activity className="h-5 w-5 shrink-0 text-muted-foreground" />Market weather</span>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-bold" data-testid="text-market-weather" aria-label="Solana and Nasdaq Composite changes">
          <span className="inline-flex items-center gap-1">{metricArrow(weather.solChg24, "icon-market-weather-solana")}Solana {formatChange(weather.solChg24)} <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">24h</span></span>
          {weather.nasdaqChg1d !== null && Number.isFinite(weather.nasdaqChg1d) && (
            <span className="inline-flex items-center gap-1">{metricArrow(weather.nasdaqChg1d, "icon-market-weather-nasdaq")}Nasdaq {formatChange(weather.nasdaqChg1d)} <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">1D</span></span>
          )}
        </p>
      </div>
    </Card>
  );
}