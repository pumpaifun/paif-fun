import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ThumbsUp, AlertTriangle, ChevronDown, ChevronUp, ExternalLink, Search, Copy, Check, Info, TrendingUp, Lock, Users, Coins, BarChart3, DollarSign, ArrowUpRight, ArrowDownLeft, Wallet, ArrowRightLeft, ShieldCheck, ShieldAlert, CircleDot, Eye, User, Landmark, RefreshCw, Settings, Zap, FileText, Calendar, Download, Loader2, CheckCircle2, AlertCircle, XCircle, Star, CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { apiRequest } from "@/lib/queryClient";
import { SwapPanel } from "@/components/swap-panel";
import { useActiveChain } from "@/lib/active-chain";
import { CHAINS, type ChainId, EVM_CHAINS, isEvmChain, addressKind } from "@/lib/chains";
import mascotImage from "@assets/D5AFF079-246D-49E0-AA64-454B873751AC_1771641179413.png";
import type {
  CreatorFeeInfo,
  RiskAssessment,
  ScanResult,
  ScanSentiment,
} from "@shared/scan-types";
import { generateAuditPdf, generateAuditCsv, type AuditReportData } from "@/lib/audit-report";
import { useToast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScannerSearch, VerifiedXStockResult } from "@/components/scanner-search";
import {
  addWatchItem,
  isTokenWatched,
  loadWatchlist,
  removeWatchItem,
  saveWatchlist,
} from "@/lib/watchlist";

function BagIcon({ label, percent, delay, color }: { label: string; percent: number; delay: string; color: string }) {
  return (
    <div
      className="flex flex-col items-center gap-2 animate-fadeInUp"
      style={{ animationDelay: delay }}
      data-testid={`bag-${label.toLowerCase().replace(/\s/g, "-")}`}
    >
      <div className={`relative w-20 h-24 sm:w-24 sm:h-28 rounded-xl ${color} flex items-center justify-center shadow-md`}>
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-10 h-4 sm:w-12 sm:h-5 rounded-t-full bg-inherit opacity-80" />
        <span className="text-2xl sm:text-3xl font-bold text-white" data-testid={`text-percent-${label.toLowerCase().replace(/\s/g, "-")}`}>{percent}%</span>
      </div>
      <p className="text-xs sm:text-sm font-semibold text-foreground text-center max-w-[100px]">{label}</p>
    </div>
  );
}

function TrafficLight({ rating }: { rating: "green" | "yellow" | "red" }) {
  const colors = {
    green: { bg: "bg-emerald-500", glow: "shadow-emerald-500/50", label: "Looks Good" },
    yellow: { bg: "bg-yellow-400", glow: "shadow-yellow-400/50", label: "Mixed Signals" },
    red: { bg: "bg-red-500", glow: "shadow-red-500/50", label: "Be Careful" },
  };

  return (
    <div className="flex flex-col items-center gap-3" data-testid="traffic-light">
      <div className="bg-gray-900 rounded-full p-3 sm:p-4 flex flex-col items-center gap-2">
        <div className={`w-10 h-10 sm:w-14 sm:h-14 rounded-full ${rating === "green" ? colors.green.bg : "bg-gray-700"} ${rating === "green" ? "shadow-lg " + colors.green.glow : ""} transition-all`} />
        <div className={`w-10 h-10 sm:w-14 sm:h-14 rounded-full ${rating === "yellow" ? colors.yellow.bg : "bg-gray-700"} ${rating === "yellow" ? "shadow-lg " + colors.yellow.glow : ""} transition-all`} />
        <div className={`w-10 h-10 sm:w-14 sm:h-14 rounded-full ${rating === "red" ? colors.red.bg : "bg-gray-700"} ${rating === "red" ? "shadow-lg " + colors.red.glow : ""} transition-all`} />
      </div>
      <span className="text-lg sm:text-xl font-bold text-foreground" data-testid="text-rating-label">{colors[rating].label}</span>
    </div>
  );
}

function riskBandStyles(band: "low" | "medium" | "high") {
  if (band === "low")
    return { text: "text-emerald-600 dark:text-emerald-400", ring: "border-emerald-500/30", soft: "bg-emerald-50 dark:bg-emerald-950/30", label: "LOW RISK" };
  if (band === "medium")
    return { text: "text-amber-600 dark:text-amber-400", ring: "border-amber-500/30", soft: "bg-amber-50 dark:bg-amber-950/30", label: "MEDIUM RISK" };
  return { text: "text-red-600 dark:text-red-400", ring: "border-red-500/30", soft: "bg-red-50 dark:bg-red-950/30", label: "HIGH RISK" };
}

function riskCategoryHelp(key: string): string | null {
  if (key === "concentration") {
    return "How much of the token is held by the biggest non-pool wallets. Higher concentration means fewer wallets may have more influence on the price.";
  }
  if (key === "movement") {
    return "How much supply is outside known liquidity pools, locked wallets, burn addresses, and the largest holders. This is not proof that tokens were sold or dumped.";
  }
  return null;
}

function AtAGlanceReport({ data }: { data: ScanResult }) {
  const risk = data.risk;
  const simpleCategories = risk?.categories.filter(
    (category) => category.key === "concentration" || category.key === "movement",
  ) ?? [];
  return (
    <section data-testid="section-at-a-glance-report">
      <Card className="p-4 sm:p-5" data-testid="card-simple-risk-profile">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <h3 className="font-bold text-sm">Simple risk profile</h3>
          </div>
          {risk && (
            <span className={`rounded-full px-2 py-1 text-[10px] font-extrabold ${riskBandStyles(risk.band).soft} ${riskBandStyles(risk.band).text}`}>
              {riskBandStyles(risk.band).label}
            </span>
          )}
        </div>
        {data.dataIncomplete && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300" data-testid="simple-risk-incomplete">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            Partial on-chain data — unknown signals are not treated as safe.
          </div>
        )}
        <div className="space-y-2">
          {simpleCategories.length ? simpleCategories.map((category) => {
            const good = category.score < 34;
            const warning = category.score < 67;
            const Icon = good ? CheckCircle2 : warning ? AlertCircle : XCircle;
            const color = good ? "text-emerald-600" : warning ? "text-amber-600" : "text-red-600";
            return (
              <div key={category.key} className="flex items-start gap-2" data-testid={`simple-risk-${category.key}`}>
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
                <div>
                  <div className="flex items-center gap-1">
                    <p className="text-xs font-bold text-foreground">{category.label}</p>
                    {riskCategoryHelp(category.key) && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                            aria-label={`Explain ${category.label}`}
                            data-testid={`help-${category.key}`}
                          >
                            <CircleHelp className="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-xs text-xs leading-relaxed">
                          {riskCategoryHelp(category.key)}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">{category.detail}</p>
                </div>
              </div>
            );
          }) : (
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              A canonical risk assessment is not available for this scan.
            </div>
          )}
        </div>
        <p className="mt-4 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
          This is a quick screening summary, not a guarantee that a token is safe or will make money.
        </p>
      </Card>
    </section>
  );
}

function RiskScoreCard({ risk, onPdf, onCsv }: { risk: RiskAssessment; onPdf: () => void; onCsv: () => void }) {
  const s = riskBandStyles(risk.band);
  const confColor =
    risk.confidence === "high"
      ? "text-emerald-600 dark:text-emerald-400"
      : risk.confidence === "medium"
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";
  return (
    <Card className={`p-4 sm:p-6 border-2 ${s.ring}`} data-testid="card-risk-assessment">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldCheck className={`w-5 h-5 ${s.text}`} />
          <h3 className="font-bold text-base sm:text-lg">Risk &amp; Compliance</h3>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={onPdf} data-testid="button-download-audit-pdf">
            <FileText className="w-3.5 h-3.5" /> Audit PDF
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={onCsv} data-testid="button-download-audit-csv">
            <Download className="w-3.5 h-3.5" /> CSV
          </Button>
        </div>
      </div>

      {risk.sanctioned && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-500/40 p-3 mb-4" data-testid="banner-sanctioned">
          <ShieldAlert className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs">
            <p className="font-bold text-red-600 dark:text-red-400">Sanctions alert</p>
            <p className="text-muted-foreground">An associated wallet matches the bundled OFAC SDN list: {risk.sanctionDetail}</p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 mb-4">
        <div className={`flex flex-col items-center justify-center w-20 h-20 rounded-full ${s.soft} border-2 ${s.ring} flex-shrink-0`}>
          <span className={`text-2xl font-extrabold ${s.text}`} data-testid="text-risk-score">{risk.score}</span>
          <span className="text-[10px] text-muted-foreground">/ 100</span>
        </div>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-lg font-extrabold ${s.text}`} data-testid="text-risk-band">{s.label}</span>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${s.soft} ${s.text}`}>Grade {risk.grade}</span>
          </div>
          <p className={`text-xs mt-1 ${confColor}`} data-testid="text-risk-confidence">Confidence: {risk.confidence}</p>
        </div>
      </div>

      <div className="space-y-2.5 mb-4">
        {risk.categories.filter((c) => c.key === "concentration").map((c) => {
          const cs = c.score < 34 ? "bg-emerald-500" : c.score < 67 ? "bg-amber-500" : "bg-red-500";
          return (
            <div key={c.key} data-testid={`risk-cat-${c.key}`}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium">{c.label}</span>
                <span className="text-muted-foreground">{c.score}/100</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className={`h-full ${cs}`} style={{ width: `${c.score}%` }} />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">{c.detail}</p>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-muted-foreground mt-3">
        This is just how the scanner reads the on-chain data — not financial advice.
      </p>
    </Card>
  );
}

function SentimentPanel({ sentiment }: { sentiment: ScanSentiment }) {
  const buyLeadH1 = sentiment.buysH1 - sentiment.sellsH1;
  const buyLeadM5 = sentiment.buysM5 - sentiment.sellsM5;
  const chartLabel =
    sentiment.chart === "healthy"
      ? { text: "Trend looks intact (higher lows)", color: "bg-emerald-100 text-emerald-700" }
      : sentiment.chart === "blowoff"
        ? { text: "Ran hot — reversal shape", color: "bg-red-100 text-red-700" }
        : sentiment.chart === "accumulation"
          ? { text: "Quiet base on cooled volume", color: "bg-blue-100 text-blue-700" }
          : sentiment.chart === "mixed"
            ? { text: "No clear chart pattern", color: "bg-slate-100 text-slate-700" }
            : null;
  const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
  const pctColor = (n: number) =>
    n > 0 ? "text-emerald-700" : n < 0 ? "text-red-700" : "text-slate-600";
  return (
    <div
      className="mt-4 rounded-xl border border-border bg-card p-4 sm:p-5 text-left"
      data-testid="panel-sentiment"
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <BarChart3 className="w-5 h-5 text-purple-600" />
        <span className="text-lg font-black text-foreground">Live market sentiment</span>
        <span className="text-xs text-muted-foreground">(scanner reading, not financial advice)</span>
      </div>
      <p className="text-base font-medium leading-relaxed text-foreground mb-4" data-testid="text-sentiment-summary">
        {sentiment.summary}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 mb-4">
        <div className="rounded-xl border border-border bg-muted/40 p-4" data-testid="stat-pressure-h1">
          <div className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Last hour</div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs font-bold uppercase text-emerald-700">Buys</div>
              <div className="text-3xl font-black leading-none text-emerald-700">{sentiment.buysH1}</div>
            </div>
            <div>
              <div className="text-xs font-bold uppercase text-red-700">Sells</div>
              <div className="text-3xl font-black leading-none text-red-700">{sentiment.sellsH1}</div>
            </div>
          </div>
          <div className={`mt-3 text-sm font-bold ${buyLeadH1 >= 0 ? "text-emerald-700" : "text-red-700"}`}>
            {buyLeadH1 === 0 ? "Buyers and sellers are even" : buyLeadH1 > 0 ? `${buyLeadH1} more buys` : `${Math.abs(buyLeadH1)} more sells`}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-muted/40 p-4" data-testid="stat-pressure-m5">
          <div className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Last 5 minutes</div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs font-bold uppercase text-emerald-700">Buys</div>
              <div className="text-3xl font-black leading-none text-emerald-700">{sentiment.buysM5}</div>
            </div>
            <div>
              <div className="text-xs font-bold uppercase text-red-700">Sells</div>
              <div className="text-3xl font-black leading-none text-red-700">{sentiment.sellsM5}</div>
            </div>
          </div>
          <div className={`mt-3 text-sm font-bold ${buyLeadM5 >= 0 ? "text-emerald-700" : "text-red-700"}`}>
            {buyLeadM5 === 0 ? "Buyers and sellers are even" : buyLeadM5 > 0 ? `${buyLeadM5} more buys` : `${Math.abs(buyLeadM5)} more sells`}
          </div>
        </div>
      </div>
      <p className="mb-2 text-sm font-bold text-muted-foreground">Price change</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="stat-price-moves">
        {[
          ["5 minutes", sentiment.chgM5],
          ["1 hour", sentiment.chgH1],
          ["6 hours", sentiment.chgH6],
          ["24 hours", sentiment.chgH24],
        ].map(([label, change]) => (
          <div key={String(label)} className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className={`mt-1 text-2xl font-black ${pctColor(Number(change))}`}>{fmtPct(Number(change))}</p>
          </div>
        ))}
      </div>
      {chartLabel && (
        <div className="mt-3 flex items-start gap-2">
          <span
            className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${chartLabel.color}`}
            data-testid="badge-chart-read"
          >
            {chartLabel.text}
          </span>
        </div>
      )}
      {sentiment.chartDetail && (
        <p className="mt-1.5 text-[11px] text-muted-foreground" data-testid="text-chart-detail">
          {sentiment.chartDetail}
        </p>
      )}
    </div>
  );
}

function QuickLinks({ tokenAddress, chain }: { tokenAddress: string; chain: ChainId }) {
  const cfg = CHAINS[chain];
  const links =
    chain === "solana"
      ? [
          { label: "Pump.fun", url: `https://pump.fun/coin/${tokenAddress}`, color: "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" },
          { label: "Solscan", url: `https://solscan.io/token/${tokenAddress}`, color: "bg-blue-100 text-blue-700 hover:bg-blue-200" },
          { label: "Birdeye", url: `https://birdeye.so/token/${tokenAddress}?chain=solana`, color: "bg-orange-100 text-orange-700 hover:bg-orange-200" },
          { label: "DexScreener", url: `https://dexscreener.com/solana/${tokenAddress}`, color: "bg-purple-100 text-purple-700 hover:bg-purple-200" },
        ]
      : [
          ...(chain === "bnb"
            ? [{ label: "four.meme", url: `https://four.meme/token/${tokenAddress}`, color: "bg-yellow-100 text-yellow-700 hover:bg-yellow-200" }]
            : []),
          { label: cfg.explorerName, url: cfg.explorerTokenUrl(tokenAddress), color: "bg-blue-100 text-blue-700 hover:bg-blue-200" },
          { label: "DexScreener", url: `https://dexscreener.com/${cfg.dexscreenerSlug}/${tokenAddress}`, color: "bg-purple-100 text-purple-700 hover:bg-purple-200" },
        ];

  return (
    <div className="flex flex-wrap items-center justify-center gap-2" data-testid="quick-links">
      {links.map((link) => (
        <a
          key={link.label}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${link.color}`}
          data-testid={`link-${link.label.toLowerCase().replace(/\s/g, "-")}`}
        >
          {link.label} <ExternalLink className="w-3 h-3" />
        </a>
      ))}
    </div>
  );
}

function CreatorFeeInsights({ fees, creatorAddress, copyAddress, copiedAddress, shortenAddress, solPriceUsd }: {
  fees: CreatorFeeInfo;
  creatorAddress: string;
  copyAddress: (addr: string) => void;
  copiedAddress: string | null;
  shortenAddress: (addr: string) => string;
  solPriceUsd: number | null;
}) {
  const [showActivity, setShowActivity] = useState(false);
  const [activeTab, setActiveTab] = useState<"creator" | "trading">("creator");

  const formatSol = (val: number) => {
    if (val === 0) return "0";
    if (Math.abs(val) < 0.001) return val.toFixed(6);
    if (Math.abs(val) < 1) return val.toFixed(4);
    return val.toFixed(3);
  };

  const formatUsd = (sol: number) => {
    if (!solPriceUsd) return null;
    const usd = sol * solPriceUsd;
    if (usd < 0.01) return "<$0.01";
    if (usd < 1) return `$${usd.toFixed(2)}`;
    if (usd < 1000) return `$${usd.toFixed(2)}`;
    return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  };

  const walletBadgeIcon = (walletType: string | null) => {
    switch (walletType) {
      case "exchange": return <Landmark className="w-3 h-3" />;
      case "dex": return <RefreshCw className="w-3 h-3" />;
      case "program": return <Settings className="w-3 h-3" />;
      case "protocol": return <FileText className="w-3 h-3" />;
      case "bridge": return <Zap className="w-3 h-3" />;
      default: return <CircleDot className="w-3 h-3" />;
    }
  };

  const walletBadge = (label: string | null, walletType: string | null) => {
    if (!label) return null;
    const colors: Record<string, string> = {
      exchange: "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-950 dark:text-yellow-300 dark:border-yellow-800",
      dex: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800",
      program: "bg-muted text-muted-foreground border-border",
      protocol: "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800",
      bridge: "bg-cyan-100 text-cyan-800 border-cyan-300 dark:bg-cyan-950 dark:text-cyan-300 dark:border-cyan-800",
    };
    return (
      <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${colors[walletType || ""] || "bg-muted text-muted-foreground border-border"}`}>
        {walletBadgeIcon(walletType)} {label}
      </span>
    );
  };

  const netSol = fees.totalSolReceived - fees.totalSolSent;
  const sellCount = fees.tokenSellTransactions.length;
  const totalSellSol = fees.tokenSellTransactions.reduce((sum, tx) => sum + tx.solAmount, 0);
  const distributedTo = fees.distributionRecipientCount || 0;

  const creatorVerdict = () => {
    if (sellCount === 0 && distributedTo > 0 && fees.totalSolSent < 0.1) return { icon: <ShieldCheck className="w-5 h-5 text-emerald-600" />, text: `Creator airdropped tokens to ${distributedTo} wallet${distributedTo > 1 ? "s" : ""} — no sells, no SOL taken back.`, color: "text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950" };
    if (sellCount === 0 && fees.totalSolSent < 0.1) return { icon: <ShieldCheck className="w-5 h-5 text-emerald-600" />, text: "Creator is holding! No sells detected.", color: "text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950" };
    if (sellCount > 0 && totalSellSol > 1) return { icon: <ShieldAlert className="w-5 h-5 text-red-600" />, text: `Creator sold tokens ${sellCount} time${sellCount > 1 ? "s" : ""} for ${formatSol(totalSellSol)} SOL${formatUsd(totalSellSol) ? ` (${formatUsd(totalSellSol)})` : ""}`, color: "text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-950" };
    if (sellCount > 0) return { icon: <AlertTriangle className="w-5 h-5 text-yellow-600" />, text: `Creator made ${sellCount} small sell${sellCount > 1 ? "s" : ""}`, color: "text-yellow-700 bg-yellow-50 dark:text-yellow-300 dark:bg-yellow-950" };
    if (fees.totalSolSent > 1) return { icon: <ArrowUpRight className="w-5 h-5 text-orange-600" />, text: `Creator moved ${formatSol(fees.totalSolSent)} SOL out`, color: "text-orange-700 bg-orange-50 dark:text-orange-300 dark:bg-orange-950" };
    return { icon: <Eye className="w-5 h-5 text-blue-600" />, text: "Some activity detected — take a closer look below", color: "text-blue-700 bg-blue-50 dark:text-blue-300 dark:bg-blue-950" };
  };

  const verdict = creatorVerdict();

  return (
    <section data-testid="section-creator-fees">
      <div className="flex gap-2 mb-3" data-testid="fee-tabs">
        <Button
          onClick={() => setActiveTab("creator")}
          variant={activeTab === "creator" ? "default" : "outline"}
          className="flex-1"
          data-testid="tab-creator-fees"
        >
          <DollarSign className="w-4 h-4 mr-1" /> Creator Fees
        </Button>
        <Button
          onClick={() => setActiveTab("trading")}
          variant={activeTab === "trading" ? "default" : "outline"}
          className="flex-1"
          data-testid="tab-trading-fees"
        >
          <ArrowRightLeft className="w-4 h-4 mr-1" /> Trading Activity
        </Button>
      </div>

      {activeTab === "creator" && (
        <Card className="p-4 sm:p-5 animate-fadeInUp" data-testid="panel-creator-fees">
          <div className={`flex items-start gap-3 p-3 rounded-xl mb-4 ${verdict.color}`} data-testid="creator-verdict">
            <span className="flex-shrink-0">{verdict.icon}</span>
            <div>
              <p className="font-bold text-sm">{verdict.text}</p>
              <p className="text-[11px] mt-0.5 opacity-75">Based on recent on-chain activity</p>
            </div>
          </div>

          <div className="space-y-2.5 mb-4" data-testid="sol-flow-summary">
            <div className="bg-emerald-50 dark:bg-emerald-950/40 rounded-xl p-3" data-testid="stat-money-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ArrowDownLeft className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300">SOL came into this wallet</p>
                </div>
                <div className="text-right">
                  <p className="text-base sm:text-lg font-black text-emerald-700 dark:text-emerald-400">{formatSol(fees.totalSolReceived)} SOL</p>
                  {formatUsd(fees.totalSolReceived) && <p className="text-[11px] font-bold text-emerald-500">{formatUsd(fees.totalSolReceived)}</p>}
                </div>
              </div>
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 ml-6">From selling tokens, trading, or transfers in</p>
            </div>

            <div className="bg-orange-50 dark:bg-orange-950/40 rounded-xl p-3" data-testid="stat-money-out">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ArrowUpRight className="w-4 h-4 text-orange-600 flex-shrink-0" />
                  <p className="text-sm font-bold text-orange-800 dark:text-orange-300">SOL left this wallet</p>
                </div>
                <div className="text-right">
                  <p className="text-base sm:text-lg font-black text-orange-700 dark:text-orange-400">{formatSol(fees.totalSolSent)} SOL</p>
                  {formatUsd(fees.totalSolSent) && <p className="text-[11px] font-bold text-orange-500">{formatUsd(fees.totalSolSent)}</p>}
                </div>
              </div>
              <p className="text-[11px] text-orange-600 dark:text-orange-400 mt-1 ml-6">To exchanges, other wallets, buying tokens, or fees</p>
            </div>

            <div className={`rounded-xl p-3 border-2 ${netSol <= 0 ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800" : "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/40 dark:border-yellow-800"}`} data-testid="stat-net-result">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className={`w-4 h-4 flex-shrink-0 ${netSol <= 0 ? "text-emerald-600" : "text-yellow-600"}`} />
                  <p className={`text-sm font-bold ${netSol <= 0 ? "text-emerald-800" : "text-yellow-800"}`}>{netSol <= 0 ? "Creator took profit" : "Creator is still holding"}</p>
                </div>
                <div className="text-right">
                  <p className={`text-base sm:text-lg font-black ${netSol <= 0 ? "text-emerald-700" : "text-yellow-700"}`}>{formatSol(Math.abs(netSol))} SOL</p>
                  {formatUsd(Math.abs(netSol)) && <p className={`text-[11px] font-bold ${netSol <= 0 ? "text-emerald-500" : "text-yellow-500"}`}>{formatUsd(Math.abs(netSol))}</p>}
                </div>
              </div>
              <p className={`text-[11px] mt-1 ml-6 ${netSol <= 0 ? "text-emerald-600" : "text-yellow-600"}`}>
                {netSol <= 0
                  ? "More SOL left than came in — creator cashed out"
                  : "More SOL came in than left — creator hasn't cashed out yet"}
              </p>
            </div>

            {fees.creatorCurrentSolBalance != null && (
              <div className="bg-purple-50 dark:bg-purple-950/40 rounded-xl p-3 flex items-center justify-between" data-testid="stat-balance">
                <div className="flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-purple-600 flex-shrink-0" />
                  <p className="text-sm font-bold text-purple-800 dark:text-purple-300">Wallet right now</p>
                </div>
                <div className="text-right">
                  <p className="text-base sm:text-lg font-black text-purple-700">{formatSol(fees.creatorCurrentSolBalance)} SOL</p>
                  {formatUsd(fees.creatorCurrentSolBalance) && <p className="text-[11px] font-bold text-purple-500">{formatUsd(fees.creatorCurrentSolBalance)}</p>}
                </div>
              </div>
            )}
          </div>

          {fees.tokenSellTransactions.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-bold text-foreground mb-2 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0" />
                Creator Sold Tokens ({fees.tokenSellTransactions.length} time{fees.tokenSellTransactions.length > 1 ? "s" : ""})
              </h4>
              <div className="space-y-2">
                {fees.tokenSellTransactions.slice(0, 5).map((tx, i) => (
                  <div key={tx.signature} className="flex items-center justify-between text-xs bg-red-50 dark:bg-red-950/40 rounded-xl px-3 py-2.5 border border-red-100 dark:border-red-900" data-testid={`sell-tx-${i}`}>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                      <a href={`https://solscan.io/tx/${tx.signature}`} target="_blank" rel="noopener noreferrer" className="font-mono text-red-600 hover:underline flex items-center gap-1">
                        {tx.signature.slice(0, 8)}... <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <div className="text-right">
                      <span className="font-black text-red-700">{tx.solAmount > 0 ? `${formatSol(tx.solAmount)} SOL` : "Sell"}</span>
                      {tx.solAmount > 0 && formatUsd(tx.solAmount) && <p className="text-[10px] text-red-500 font-semibold">{formatUsd(tx.solAmount)}</p>}
                      {tx.timestamp > 0 && <p className="text-[10px] text-muted-foreground">{new Date(tx.timestamp * 1000).toLocaleDateString()}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {fees.distributionTransactions && fees.distributionTransactions.length > 0 && (
            <div className="mb-4" data-testid="creator-airdrops">
              <h4 className="text-sm font-bold text-foreground mb-2 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 flex-shrink-0" />
                Creator Airdropped Tokens ({distributedTo} wallet{distributedTo > 1 ? "s" : ""})
              </h4>
              <div className="flex items-start gap-2 text-xs bg-emerald-50 dark:bg-emerald-950/40 rounded-xl px-3 py-2.5 border border-emerald-100 dark:border-emerald-900 mb-2">
                <Info className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                <p className="text-emerald-700 dark:text-emerald-300 font-medium">
                  Tokens were sent out with no SOL coming back in the same transaction — classified as a distribution/airdrop, not the creator cashing out. Airdrops are not counted as extraction. (Heuristic: a sale routed to a different wallet could still read as a distribution.)
                </p>
              </div>

              {fees.distributionClassificationDegraded && (
                <div className="flex items-start gap-2 text-xs bg-yellow-50 dark:bg-yellow-950/40 rounded-xl px-3 py-2.5 border border-yellow-200 dark:border-yellow-900 mb-2" data-testid="airdrop-classification-degraded">
                  <AlertTriangle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                  <p className="text-yellow-700 dark:text-yellow-300 font-medium">
                    Couldn't verify where the airdropped tokens went (on-chain lookup failed) — the recipient breakdown below may be missing.
                  </p>
                </div>
              )}

              {fees.distributionDestinations && fees.distributionDestinations.length > 0 && (() => {
                const dests = fees.distributionDestinations;
                const catStyle: Record<string, { chip: string; dot: string; name: string }> = {
                  burn: { chip: "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800", dot: "bg-orange-500", name: "Burned 🔥" },
                  token_contract: { chip: "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800", dot: "bg-purple-500", name: "Token contract address" },
                  liquidity: { chip: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800", dot: "bg-blue-500", name: "Liquidity pool" },
                  locker: { chip: "bg-cyan-100 text-cyan-800 border-cyan-300 dark:bg-cyan-950 dark:text-cyan-300 dark:border-cyan-800", dot: "bg-cyan-500", name: "Locked" },
                  program: { chip: "bg-muted text-muted-foreground border-border", dot: "bg-slate-400", name: "Program-controlled" },
                  wallet: { chip: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800", dot: "bg-emerald-500", name: "Regular wallet" },
                };
                const nonWallet = dests.filter((d) => d.category !== "wallet");
                const walletCount = dests.length - nonWallet.length;
                return (
                  <div className="mb-2" data-testid="airdrop-destinations">
                    <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">
                      Where the biggest airdrops went{fees.distributionRecipientCount > dests.length ? ` (top ${dests.length} of ${fees.distributionRecipientCount} recipients)` : ""}:
                    </p>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {walletCount > 0 && (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${catStyle.wallet.chip}`}>
                          {walletCount} regular wallet{walletCount > 1 ? "s" : ""}
                        </span>
                      )}
                      {Object.entries(
                        nonWallet.reduce<Record<string, number>>((acc, d) => { acc[d.category] = (acc[d.category] || 0) + 1; return acc; }, {}),
                      ).map(([cat, count]) => (
                        <span key={cat} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${catStyle[cat]?.chip || catStyle.program.chip}`}>
                          {count}× {catStyle[cat]?.name || cat}
                        </span>
                      ))}
                    </div>
                    {nonWallet.length > 0 && (
                      <div className="space-y-1.5">
                        {nonWallet.slice(0, 5).map((d, i) => (
                          <div key={d.address} className="flex items-center justify-between text-xs bg-muted/40 rounded-xl px-3 py-2 border border-border" data-testid={`airdrop-dest-${i}`}>
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${catStyle[d.category]?.dot || "bg-slate-400"}`} />
                              <a href={`https://solscan.io/account/${d.address}`} target="_blank" rel="noopener noreferrer" className="font-mono text-foreground hover:underline flex items-center gap-1 truncate">
                                {d.address.slice(0, 6)}...{d.address.slice(-4)} <ExternalLink className="w-3 h-3 flex-shrink-0" />
                              </a>
                            </div>
                            <span className="text-[10px] font-semibold text-muted-foreground ml-2 text-right">{d.label || catStyle[d.category]?.name || d.category}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-1.5">
                      Tokens sent to the burn address are gone for good. Tokens parked at a token-contract address are effectively out of circulation — those addresses normally can't sell, though it's not a provable burn. Heads-up: airdrops passed through middle wallets first can't be traced back here.
                    </p>
                  </div>
                );
              })()}
              <div className="space-y-2">
                {fees.distributionTransactions.slice(0, 5).map((tx, i) => (
                  <div key={tx.signature} className="flex items-center justify-between text-xs bg-muted/40 rounded-xl px-3 py-2.5 border border-border" data-testid={`airdrop-tx-${i}`}>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                      <a href={`https://solscan.io/tx/${tx.signature}`} target="_blank" rel="noopener noreferrer" className="font-mono text-emerald-600 hover:underline flex items-center gap-1">
                        {tx.signature.slice(0, 8)}... <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-foreground">{tx.recipientCount} recipient{tx.recipientCount > 1 ? "s" : ""}</span>
                      {tx.timestamp > 0 && <p className="text-[10px] text-muted-foreground">{new Date(tx.timestamp * 1000).toLocaleDateString()}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {fees.creatorActivity.length > 0 && (
            <>
              <button
                onClick={() => setShowActivity(!showActivity)}
                className="w-full flex items-center justify-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors py-2.5 border-t border-border"
                data-testid="button-toggle-activity"
              >
                {showActivity ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                {showActivity ? "Hide full activity log" : `See full activity log (${fees.creatorActivity.length} actions)`}
              </button>
              {showActivity && (
                <div className="space-y-1.5 mt-2 animate-fadeInUp">
                  {fees.creatorActivity.map((act, i) => {
                    const actDotColor = act.type === "SELL" ? "bg-red-500" : act.type === "BUY" ? "bg-emerald-500" : act.type === "DISTRIBUTE" ? "bg-emerald-500" : act.type === "SEND_SOL" ? "bg-orange-500" : act.type === "RECEIVE_SOL" ? "bg-blue-500" : "bg-gray-400";
                    const actLabel = act.type === "SELL" ? "Sold tokens" : act.type === "BUY" ? "Bought tokens" : act.type === "DISTRIBUTE" ? "Airdropped tokens" : act.type === "SEND_SOL" ? "Sent SOL" : act.type === "RECEIVE_SOL" ? "Received SOL" : act.type;
                    return (
                      <div key={act.signature} className="flex items-center justify-between text-xs py-1.5 px-2 rounded-lg hover:bg-muted/50" data-testid={`activity-row-${i}`}>
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className={`w-2 h-2 rounded-full ${actDotColor} flex-shrink-0`} />
                          <span className="font-semibold text-foreground truncate">{actLabel}</span>
                          <a href={`https://solscan.io/tx/${act.signature}`} target="_blank" rel="noopener noreferrer" className="font-mono text-emerald-600 hover:underline flex items-center gap-0.5 flex-shrink-0">
                            {act.signature.slice(0, 6)}... <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        </div>
                        <div className="text-right flex-shrink-0 ml-2">
                          {act.solAmount > 0 && <span className="font-bold">{formatSol(act.solAmount)} SOL</span>}
                          {act.solAmount > 0 && formatUsd(act.solAmount) && <p className="text-[10px] text-muted-foreground font-semibold">{formatUsd(act.solAmount)}</p>}
                          {act.timestamp > 0 && <p className="text-[10px] text-muted-foreground">{new Date(act.timestamp * 1000).toLocaleDateString()}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {fees.creatorActivity.length === 0 && fees.tokenSellTransactions.length === 0 && (
            <div className="text-center py-4">
              <Info className="w-5 h-5 text-muted-foreground mx-auto mb-1" />
              <p className="text-xs text-muted-foreground font-semibold">No activity detected from this creator yet</p>
            </div>
          )}
        </Card>
      )}

      {activeTab === "trading" && (
        <Card className="p-4 sm:p-5 animate-fadeInUp" data-testid="panel-trading-fees">
          <div className="flex items-start gap-3 p-3 rounded-xl mb-4 bg-blue-50 dark:bg-blue-950/40" data-testid="trading-intro">
            <Search className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-sm text-blue-800 dark:text-blue-300">Follow the money!</p>
              <p className="text-[11px] text-blue-600 dark:text-blue-400 mt-0.5">Where did the creator's SOL go, and where did it come from?</p>
            </div>
          </div>

          {fees.solDestinations.length > 0 && (
            <div className="mb-5">
              <h4 className="text-sm font-bold text-foreground mb-2.5 flex items-center gap-1.5">
                <ArrowUpRight className="w-4 h-4 text-orange-500" /> Where did the money go?
              </h4>
              <div className="space-y-2">
                {fees.solDestinations.slice(0, 8).map((dest, i) => (
                  <div key={dest.address} className="flex items-center justify-between text-xs bg-orange-50/60 dark:bg-orange-950/30 rounded-xl px-3 py-2.5 border border-orange-100 dark:border-orange-900" data-testid={`sol-dest-${i}`}>
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {dest.label ? (
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {walletBadge(dest.label, dest.walletType)}
                        </div>
                      ) : (
                        <User className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      )}
                      <button onClick={() => copyAddress(dest.address)} className="flex items-center gap-1 hover:text-emerald-500 transition-colors font-mono truncate">
                        {dest.label ? <span className="text-[10px] text-muted-foreground">{shortenAddress(dest.address)}</span> : shortenAddress(dest.address)}
                        {copiedAddress === dest.address ? <Check className="w-3 h-3 text-emerald-500 flex-shrink-0" /> : <Copy className="w-3 h-3 opacity-30 flex-shrink-0" />}
                      </button>
                    </div>
                    <div className="text-right flex-shrink-0 ml-2">
                      <span className="font-black text-foreground">{formatSol(dest.amount)} SOL</span>
                      {formatUsd(dest.amount) && <p className="text-[10px] text-muted-foreground font-semibold">{formatUsd(dest.amount)}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {fees.feeWallets.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-bold text-foreground mb-2.5 flex items-center gap-1.5">
                <ArrowDownLeft className="w-4 h-4 text-blue-500" /> Where did the money come from?
              </h4>
              <div className="space-y-2">
                {fees.feeWallets.slice(0, 8).map((fw, i) => (
                  <div key={fw.address} className="flex items-center justify-between text-xs bg-blue-50/60 dark:bg-blue-950/30 rounded-xl px-3 py-2.5 border border-blue-100 dark:border-blue-900" data-testid={`fee-wallet-${i}`}>
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {fw.label ? (
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {walletBadge(fw.label, fw.walletType)}
                        </div>
                      ) : (
                        <User className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      )}
                      <button onClick={() => copyAddress(fw.address)} className="flex items-center gap-1 hover:text-emerald-500 transition-colors font-mono truncate">
                        {fw.label ? <span className="text-[10px] text-muted-foreground">{shortenAddress(fw.address)}</span> : shortenAddress(fw.address)}
                        {copiedAddress === fw.address ? <Check className="w-3 h-3 text-emerald-500 flex-shrink-0" /> : <Copy className="w-3 h-3 opacity-30 flex-shrink-0" />}
                      </button>
                    </div>
                    <div className="text-right flex-shrink-0 ml-2">
                      <span className="font-black text-foreground">{formatSol(fw.totalReceived)} SOL</span>
                      {formatUsd(fw.totalReceived) && <p className="text-[10px] text-muted-foreground font-semibold">{formatUsd(fw.totalReceived)}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {fees.solDestinations.length === 0 && fees.feeWallets.length === 0 && (
            <div className="text-center py-4">
              <Info className="w-5 h-5 text-muted-foreground mx-auto mb-1" />
              <p className="text-xs text-muted-foreground font-semibold">No significant trading flows detected yet</p>
            </div>
          )}
        </Card>
      )}
    </section>
  );
}

// "What would the Swing Bot say?" — runs the bot's live entry check (fixed
// default dials, no bot required) on the scanned token and shows the same
// pass/fail read the bot itself uses before a buy. Pure signal display; the
// buttons just take you to the Swing Bot page.
function SwingBotReadCard({ mint }: { mint: string }) {
  const { data, isFetching, error, refetch } = useQuery<{ symbol: string; wouldBuy: boolean; headline: string; facts: string[] }>({
    queryKey: ["/api/swing-bot/token-check", mint],
    queryFn: async () => {
      const res = await fetch(`/api/swing-bot/token-check/${mint}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Couldn't check the token.");
      return res.json();
    },
    staleTime: 60_000,
    retry: false,
  });
  const [, navigate] = useLocation();
  return (
    <Card className="p-4 sm:p-6" data-testid="card-swing-read">
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-emerald-500" />
          <h3 className="font-bold text-base sm:text-lg">Swing Bot's Read</h3>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => refetch()} disabled={isFetching} data-testid="button-swing-read-refresh">
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} /> Re-check
        </Button>
      </div>
      {isFetching && !data ? (
        <p className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running the bot's live entry check…</p>
      ) : error ? (
        <p className="text-xs text-muted-foreground">Couldn't run the check right now — try again in a minute.</p>
      ) : data ? (
        <div className="space-y-2">
          <div className={`flex items-start gap-2 rounded-lg border p-3 ${data.wouldBuy ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500/40" : "bg-amber-50 dark:bg-amber-950/40 border-amber-500/40"}`} data-testid="banner-swing-verdict">
            {data.wouldBuy ? <ThumbsUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />}
            <p className={`text-xs font-bold ${data.wouldBuy ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>{data.headline}</p>
          </div>
          <ul className="space-y-1">
            {data.facts.map((f, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground" data-testid={`swing-read-fact-${i}`}>
                <CircleDot className="w-3 h-3 flex-shrink-0 mt-0.5 opacity-50" />
                {f}
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-muted-foreground italic">This is the Swing Bot's live entry check with default settings — just how the bot analyzes it, not financial advice.</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" className="text-xs bg-black text-white hover:bg-black/90" onClick={() => navigate(`/swing-bot?watch=${mint}`)} data-testid="button-swing-watch-token">
              <Eye className="w-3.5 h-3.5 mr-1.5" /> Watch in Swing Bot
            </Button>
            <Button size="sm" variant="outline" className="text-xs" onClick={() => navigate("/swing-bot")} data-testid="button-swing-open">
              Open Swing Bot <ArrowUpRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

export default function ScanPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const xstockMint = params.get("xstock") || "";
  const query = params.get("q") || xstockMint;
  const [, setLocation] = useLocation();
  const [vibeVote, setVibeVote] = useState<"fair" | "risky" | null>(null);
  const [showBoring, setShowBoring] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [holderPage, setHolderPage] = useState(0);
  const [watchlist, setWatchlist] = useState(loadWatchlist);
  const { toast } = useToast();
  const holdersPerPage = 25;

  const downloadAudit = (fmt: "pdf" | "csv") => {
    if (!data?.risk) return;
    const payload: AuditReportData = {
      tokenName: data.tokenName,
      tokenSymbol: data.tokenSymbol,
      tokenAddress: data.tokenAddress,
      creatorAddress: data.creatorAddress,
      chainLabel: data.risk.chain,
      totalSupply: data.totalSupply,
      topHolderPercent: data.topHolderPercent,
      reinvestedPercent: data.reinvestedPercent,
      movedElsewherePercent: data.movedElsewherePercent,
      launchDate: data.launchDate,
      launchTimestamp: data.launchTimestamp,
      topHolders: data.topHolders,
      risk: data.risk,
    };
    if (fmt === "pdf") generateAuditPdf(payload);
    else generateAuditCsv(payload);
  };

  const { chainId, chain, setChainId } = useActiveChain();
  // 0x… EVM addresses are identical across BNB / Base / SEI, so we can only tell
  // "this is an EVM token" — NOT which EVM chain it lives on. The user must pick.
  const kind = query ? addressKind(query) : null;
  const activeIsEvm = isEvmChain(chainId);
  const solanaMismatch = kind === "solana" && chainId !== "solana";
  const evmNeedsPick = kind === "evm" && !activeIsEvm;
  const wrongNetwork = solanaMismatch || evmNeedsPick;
  const scanEndpoint = activeIsEvm ? "/api/evm/scan" : "/api/scan";

  const { data, isLoading, error } = useQuery<ScanResult>({
    queryKey: [scanEndpoint, chainId, query],
    queryFn: async () => {
      const body = activeIsEvm ? { query, chainId } : { query };
      const res = await apiRequest("POST", scanEndpoint, body);
      return res.json();
    },
    enabled: !!query && !xstockMint && !wrongNetwork,
  });

  const copyAddress = (address: string) => {
    navigator.clipboard.writeText(address);
    setCopiedAddress(address);
    setTimeout(() => setCopiedAddress(null), 2000);
  };

  const shortenAddress = (address: string) =>
    `${address.slice(0, 6)}...${address.slice(-4)}`;

  const toggleFavorite = () => {
    if (!data?.tokenAddress) return;
    if (chainId !== "solana") {
      toast({
        title: "Watchlist is Solana-only",
        description: "Only Solana tokens can be added to the watchlist.",
        variant: "destructive",
      });
      return;
    }
    const isFavorite = isTokenWatched(watchlist, chainId, data.tokenAddress);
    const next = isFavorite
      ? removeWatchItem(watchlist, chainId, data.tokenAddress)
      : addWatchItem(watchlist, chainId, data.tokenAddress);
    if (next === watchlist) {
      toast({
        title: "Couldn't save this token",
        description: "The scan result does not contain a valid token address for the selected network.",
        variant: "destructive",
      });
      return;
    }
    setWatchlist(next);
    const persisted = saveWatchlist(next);
    toast({
      title: isFavorite ? "Removed from watchlist" : "Added to watchlist",
      description: persisted
        ? isFavorite
          ? `${data.tokenSymbol || data.tokenName} is no longer saved.`
          : `${data.tokenSymbol || data.tokenName} was saved on ${CHAINS[chainId].name}.`
        : "Browser storage is unavailable, so this change will last only for this session.",
    });
  };

  if (!query) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="max-w-lg mx-auto px-4 pt-20 text-center">
          <img src={mascotImage} alt="PAIF mascot" className="w-24 h-24 mx-auto mb-4 object-contain" />
          <h2 className="text-2xl font-bold mb-2">No token to scan</h2>
          <p className="text-muted-foreground mb-6">Go back to the homepage and paste a token contract address, pump.fun URL, or verified xStock.</p>
          <Button onClick={() => setLocation("/")} variant="default" data-testid="button-go-home">
            <ArrowLeft className="w-4 h-4 mr-2" /> Go Home
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center gap-2 mb-6">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/")} data-testid="button-back">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <ScannerSearch
            className="flex-1"
            inputClassName="text-sm"
            buttonClassName="font-bold text-xs"
            placeholder="Token address, link, or verified xStock"
            buttonLabel="SCAN"
            inputTestId="input-new-search"
            buttonTestId="button-new-search"
          />
        </div>

        {xstockMint ? (
          <VerifiedXStockResult mint={xstockMint} />
        ) : solanaMismatch && (
          <Card className="p-6 text-center border-yellow-400/60 bg-yellow-50 dark:bg-yellow-950/30" data-testid="wrong-network-banner">
            <Info className="w-7 h-7 mx-auto mb-2 text-yellow-600" />
            <h2 className="text-lg font-bold mb-1">That's a Solana address</h2>
            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
              You're currently scanning on <span className="font-semibold">{chain.name}</span>, but this looks like a{" "}
              <span className="font-semibold">Solana</span> token. Switch to Solana to scan it.
            </p>
            <Button
              onClick={() => setChainId("solana")}
              variant="default"
              className="font-bold"
              data-testid="button-switch-network"
            >
              Switch to Solana & scan
            </Button>
          </Card>
        )}

        {!xstockMint && evmNeedsPick && (
          <Card className="p-6 text-center border-yellow-400/60 bg-yellow-50 dark:bg-yellow-950/30" data-testid="wrong-network-banner">
            <Info className="w-7 h-7 mx-auto mb-2 text-yellow-600" />
            <h2 className="text-lg font-bold mb-1">Which network is this token on?</h2>
            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
              This looks like an <span className="font-semibold">EVM token</span> (a <span className="font-mono">0x…</span> address).
              The catch: BNB Chain, Base and Sei all share the exact same address format, so we can't tell which one
              it lives on from the address alone. Pick the network you want to scan it on:
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {EVM_CHAINS.map((id) => (
                <Button
                  key={id}
                  onClick={() => setChainId(id)}
                  variant="default"
                  className="font-bold"
                  data-testid={`button-pick-evm-${id}`}
                >
                  Scan on {CHAINS[id].name}
                </Button>
              ))}
            </div>
          </Card>
        )}

        {!xstockMint && !wrongNetwork && isLoading && (
          <div className="text-center py-20" data-testid="loading-state">
            <img src={mascotImage} alt="PAIF scanning" className="w-20 h-20 mx-auto mb-4 object-contain animate-bounce" />
            <h2 className="text-xl font-bold mb-2">Scanning {chain.name}...</h2>
            <p className="text-sm text-muted-foreground">Following the money trail</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">{shortenAddress(query)}</p>
          </div>
        )}

        {!xstockMint && error && (
          <Card className="p-6 text-center" data-testid="error-state">
            <img src={mascotImage} alt="PAIF error" className="w-16 h-16 mx-auto mb-3 object-contain opacity-60" />
            <h2 className="text-lg font-bold mb-2">Oops!</h2>
            <p className="text-sm text-muted-foreground mb-4">{(error as Error).message}</p>
            <Button onClick={() => setLocation("/")} variant="default" data-testid="button-try-again">
              Try Another Token
            </Button>
          </Card>
        )}

        {!xstockMint && data && (
          <div className="space-y-6">
            <section data-testid="section-story">
              <Card className="p-4 sm:p-5 mb-4">
                <div className="flex items-start gap-3">
                  <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-emerald-100 text-sm font-black text-emerald-700 sm:h-14 sm:w-14 dark:bg-emerald-950 dark:text-emerald-300" data-testid="token-logo-fallback">
                    {(data.tokenSymbol || data.tokenName || "?").replace(/^\$/, "").slice(0, 2).toUpperCase()}
                    {data.tokenImage && (
                      <img
                        src={data.tokenImage}
                        alt={data.tokenName}
                        referrerPolicy="no-referrer"
                        className="absolute inset-0 h-full w-full object-cover"
                        data-testid="img-token"
                        onError={(e) => { e.currentTarget.style.display = "none"; }}
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-xl sm:text-2xl font-bold text-foreground leading-tight" data-testid="text-token-name">
                        {data.tokenName}
                      </h2>
                      {data.tokenSymbol && (
                        <span className="text-sm font-semibold text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950 px-2 py-0.5 rounded-full" data-testid="text-token-symbol">
                          ${data.tokenSymbol}
                        </span>
                      )}
                    </div>
                    {data.launchDate && (
                      <p className="text-xs font-medium text-muted-foreground mt-0.5" data-testid="text-launch-date">
                        <Calendar className="w-3 h-3 inline mr-1" />
                        Launched {data.launchTimestamp
                          ? new Date(data.launchTimestamp).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC"
                          : new Date(data.launchDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1" data-testid="text-token-supply">
                      Total Supply: {data.totalSupply.toLocaleString()} tokens
                    </p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-muted-foreground">
                      <button onClick={() => copyAddress(data.tokenAddress)} className="inline-flex items-center gap-1 hover:text-foreground transition-colors font-mono" data-testid="button-copy-address">
                        Contract: {shortenAddress(data.tokenAddress)}
                        {copiedAddress === data.tokenAddress ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                      </button>
                      {data.creatorAddress && (
                        <button onClick={() => copyAddress(data.creatorAddress)} className="inline-flex items-center gap-1 hover:text-foreground transition-colors font-mono" data-testid="button-copy-creator">
                          Creator: {shortenAddress(data.creatorAddress)}
                          {copiedAddress === data.creatorAddress ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {data.risk && (
                      <div className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold ${riskBandStyles(data.risk.band).soft} ${riskBandStyles(data.risk.band).text}`} data-testid="badge-token-risk">
                        {riskBandStyles(data.risk.band).label}
                      </div>
                    )}
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {chainId === "solana" && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={toggleFavorite}
                          aria-pressed={isTokenWatched(watchlist, chainId, data.tokenAddress)}
                          className={isTokenWatched(watchlist, chainId, data.tokenAddress) ? "border-amber-400 text-amber-700 dark:text-amber-300" : ""}
                          data-testid="button-favorite-token"
                        >
                          <Star className={`mr-1 h-4 w-4 ${isTokenWatched(watchlist, chainId, data.tokenAddress) ? "fill-current" : ""}`} />
                          {isTokenWatched(watchlist, chainId, data.tokenAddress) ? "Saved" : "Favorite"}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setLocation("/watchlist")}
                        data-testid="button-view-watchlist"
                      >
                        View Watchlist
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="mt-4 border-t border-border pt-4">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Explore this token</p>
                  <QuickLinks tokenAddress={data.tokenAddress} chain={chainId} />
                </div>
                {data.creatorAddress && (
                  <a
                    href={
                      activeIsEvm
                        ? chain.explorerAddressUrl(data.creatorAddress)
                        : `https://pump.fun/profile/${data.creatorAddress}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4 text-sm font-bold text-emerald-700 transition-colors hover:text-emerald-500 dark:text-emerald-300"
                    data-testid="link-creator-pumpfun"
                  >
                    <span className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4" />
                      {activeIsEvm ? `View creator wallet on ${chain.explorerName}` : "View creator rewards on Pump.fun"}
                    </span>
                    <ExternalLink className="h-4 w-4 shrink-0" />
                  </a>
                )}
                {data.clawPumpCreatorRewards && (
                  <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4" data-testid="clawpump-creator-rewards">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-foreground">Claw Pump creator rewards</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          This token is linked to {data.clawPumpCreatorRewards.agentName}. The agent receives {data.clawPumpCreatorRewards.agentSharePercent}% of eligible Claw Pump earnings.
                        </p>
                      </div>
                      <a
                        href={data.clawPumpCreatorRewards.profileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 hover:underline dark:text-emerald-300"
                      >
                        Open Claw Pump <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-lg bg-background/80 p-3">
                        <p className="text-[11px] text-muted-foreground">Sent to agent</p>
                        <p className="mt-1 text-sm font-black">{data.clawPumpCreatorRewards.totalSentSol.toFixed(4)} SOL</p>
                      </div>
                      <div className="rounded-lg bg-background/80 p-3">
                        <p className="text-[11px] text-muted-foreground">Waiting to be sent</p>
                        <p className="mt-1 text-sm font-black">{data.clawPumpCreatorRewards.totalPendingSol.toFixed(4)} SOL</p>
                      </div>
                      <div className="rounded-lg bg-background/80 p-3">
                        <p className="text-[11px] text-muted-foreground">Total agent earnings</p>
                        <p className="mt-1 text-sm font-black">{data.clawPumpCreatorRewards.totalEarnedSol.toFixed(4)} SOL</p>
                      </div>
                    </div>
                    {data.clawPumpCreatorRewards.totalSentSol === 0 && data.clawPumpCreatorRewards.totalPendingSol === 0 && (
                      <p className="mt-3 text-xs font-medium text-muted-foreground">No creator-reward payout is currently recorded by Claw Pump.</p>
                    )}
                    <div className="mt-3 rounded-lg border border-emerald-500/15 bg-background/70 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Creator-fee destination</p>
                      {data.clawPumpCreatorRewards.rewardDestinationWallet ? (
                        <>
                          <a
                            href={`https://solscan.io/account/${data.clawPumpCreatorRewards.rewardDestinationWallet}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 flex items-center justify-between gap-2 font-mono text-xs font-bold text-foreground hover:text-emerald-600"
                          >
                            <span className="break-all">{data.clawPumpCreatorRewards.rewardDestinationWallet}</span>
                            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                          </a>
                          <p className={`mt-2 text-xs font-bold ${data.clawPumpCreatorRewards.rewardDestinationMatchesAgentWallet ? "text-emerald-600" : "text-amber-600"}`}>
                            {data.clawPumpCreatorRewards.rewardDestinationMatchesAgentWallet
                              ? "This is the same address as the Claw Pump agent wallet."
                              : "This is different from the Claw Pump agent wallet."}
                          </p>
                          {data.clawPumpCreatorRewards.latestDistributionTxHash && (
                            <a
                              href={`https://solscan.io/tx/${data.clawPumpCreatorRewards.latestDistributionTxHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-300"
                            >
                              View latest payout <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </>
                      ) : (
                        <p className="mt-1 text-xs text-muted-foreground">
                          No payout address is recorded yet, so PAIF cannot confirm whether creator fees will use the agent wallet.
                        </p>
                      )}
                    </div>
                    {data.clawPumpCreatorRewards.agentWallet && (
                      <a
                        href={`https://solscan.io/account/${data.clawPumpCreatorRewards.agentWallet}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 flex items-center justify-between gap-2 border-t border-emerald-500/15 pt-3 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <span>Claw Pump agent wallet: <span className="font-mono">{shortenAddress(data.clawPumpCreatorRewards.agentWallet)}</span></span>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                )}
                {data.clawPumpMigratedCreatorRewards && (
                  <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4" data-testid="clawpump-migrated-creator-rewards">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-foreground">Claw Pump migrated creator rewards</p>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                          This token’s Pump.fun creator fees are routed through Claw Pump and paid to its owner wallet.
                        </p>
                        <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
                          This migrated token has no public Claw Pump agent profile.
                        </p>
                      </div>
                      <a
                        href={data.clawPumpMigratedCreatorRewards.tokenUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 hover:underline dark:text-emerald-300"
                      >
                        Open token on Claw Pump <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-lg bg-background/80 p-3">
                        <p className="text-xs text-muted-foreground">Creator fees collected</p>
                        <p className="mt-1 text-lg font-black">{data.clawPumpMigratedCreatorRewards.totalCreatorFeesSol.toFixed(3)} SOL</p>
                      </div>
                      <div className="rounded-lg bg-background/80 p-3">
                        <p className="text-xs text-muted-foreground">Owner earned</p>
                        <p className="mt-1 text-lg font-black">{data.clawPumpMigratedCreatorRewards.totalEarnedSol.toFixed(3)} SOL</p>
                      </div>
                      <div className="rounded-lg bg-background/80 p-3">
                        <p className="text-xs text-muted-foreground">Sent to owner</p>
                        <p className="mt-1 text-lg font-black">{data.clawPumpMigratedCreatorRewards.totalSentSol.toFixed(3)} SOL</p>
                      </div>
                    </div>
                    <div className="mt-3 rounded-lg border border-emerald-500/15 bg-background/70 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Verified creator-fee destination</p>
                      {data.clawPumpMigratedCreatorRewards.rewardDestinationWallet ? (
                        <>
                          <a
                            href={`https://solscan.io/account/${data.clawPumpMigratedCreatorRewards.rewardDestinationWallet}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 flex items-center justify-between gap-2 font-mono text-sm font-bold text-foreground hover:text-emerald-600"
                          >
                            <span className="break-all">{data.clawPumpMigratedCreatorRewards.rewardDestinationWallet}</span>
                            <ExternalLink className="h-4 w-4 shrink-0" />
                          </a>
                          <p className={`mt-2 text-sm font-bold ${data.clawPumpMigratedCreatorRewards.rewardDestinationMatchesCreatorWallet ? "text-emerald-600" : "text-amber-600"}`}>
                            {data.clawPumpMigratedCreatorRewards.rewardDestinationMatchesCreatorWallet
                              ? "Confirmed: this matches the creator wallet found by PAIF."
                              : "Warning: this differs from the creator wallet found by PAIF."}
                          </p>
                        </>
                      ) : (
                        <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
                          Claw Pump reports payouts, but PAIF could not verify the receiving wallet on-chain right now.
                        </p>
                      )}
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {data.clawPumpMigratedCreatorRewards.feeRoutingWallet && (
                        <a
                          href={`https://solscan.io/account/${data.clawPumpMigratedCreatorRewards.feeRoutingWallet}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg border border-border bg-background/70 p-3 hover:border-emerald-500/40"
                        >
                          <span className="flex items-center justify-between gap-2 text-xs font-bold text-muted-foreground">
                            Fee-routing wallet <ExternalLink className="h-3.5 w-3.5" />
                          </span>
                          <span className="mt-1 block font-mono text-sm font-bold text-foreground">
                            {shortenAddress(data.clawPumpMigratedCreatorRewards.feeRoutingWallet)}
                          </span>
                        </a>
                      )}
                      {data.clawPumpMigratedCreatorRewards.otherSplitRecipientWallet && (
                        <a
                          href={`https://solscan.io/account/${data.clawPumpMigratedCreatorRewards.otherSplitRecipientWallet}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg border border-border bg-background/70 p-3 hover:border-emerald-500/40"
                        >
                          <span className="flex items-center justify-between gap-2 text-xs font-bold text-muted-foreground">
                            Other split recipient ({data.clawPumpMigratedCreatorRewards.otherSharePercent ?? "?"}%)
                            <ExternalLink className="h-3.5 w-3.5" />
                          </span>
                          <span className="mt-1 block font-mono text-sm font-bold text-foreground">
                            {shortenAddress(data.clawPumpMigratedCreatorRewards.otherSplitRecipientWallet)}
                          </span>
                        </a>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>{data.clawPumpMigratedCreatorRewards.payoutCount} recorded payouts</span>
                      <span>
                        Creator received {data.clawPumpMigratedCreatorRewards.creatorSharePercent ?? "?"}% in the latest verified payout
                      </span>
                    </div>
                  </div>
                )}
                {chainId === "solana" && !data.clawPumpCreatorRewards && !data.clawPumpMigratedCreatorRewards && (
                  <div
                    className="mt-3 rounded-xl border border-border bg-muted/30 p-4"
                    data-testid="clawpump-cross-reference"
                  >
                    <div className="flex items-start gap-3">
                      <Search className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-bold text-foreground">Claw Pump cross-check</p>
                        {data.clawPumpCrossReference?.status === "not_linked" ? (
                          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                            No Claw Pump agent or creator-reward record was found for this token.
                          </p>
                        ) : (
                          <p className="mt-1 text-sm leading-relaxed text-amber-700 dark:text-amber-300">
                            Claw Pump could not be checked right now. Its reward information may still exist—try scanning again.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </Card>

              <div className="flex items-center justify-center gap-3 mb-2">
                <BarChart3 className="w-6 h-6 sm:w-7 sm:h-7 text-emerald-600" />
                <h2 className="text-lg sm:text-xl font-bold text-foreground">Here's what we found!</h2>
              </div>

              {chainId === "solana" && data.sentiment?.available && (
                <SentimentPanel sentiment={data.sentiment} />
              )}
            </section>

            <AtAGlanceReport data={data} />

            {chainId === "solana" && data.tokenAddress && (
              <section data-testid="section-swing-read">
                <SwingBotReadCard mint={data.tokenAddress} />
              </section>
            )}

            {chainId === "solana" && (
              <section data-testid="section-swap-panel">
                <SwapPanel
                  tokenMint={data.tokenAddress}
                  tokenName={data.tokenName}
                  tokenSymbol={data.tokenSymbol}
                />
              </section>
            )}

            <section data-testid="section-vibe-check">
              <Card className="p-4 sm:p-6 text-center">
                <div className="flex items-center justify-center gap-2 mb-3">
                  <img src={mascotImage} alt="PAIF" className="w-8 h-8 object-contain" />
                  <span className="font-bold text-sm sm:text-base">PAIF says:</span>
                </div>

                {data.dataIncomplete ? (
                  <div>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-3 max-w-md mx-auto" data-testid="text-vibe-message">
                      {activeIsEvm
                        ? `This token lives on ${chain.name} and we're pulling what we can! Deeper money-flow and holder data needs a ${chain.explorerName} API key — once it's configured, PAIF tracks the full story for every ${chain.name} token.`
                        : "This token exists on Solana and we're pulling what we can! We're integrating deeper APIs to show you the full story. Here's what PAIF will track for every token, contingent on the pump.fun hackathon results."}
                    </p>
                    <div className="flex items-center justify-center gap-1.5 text-xs text-yellow-600 bg-yellow-50 dark:text-yellow-400 dark:bg-yellow-950/40 rounded-lg py-2 px-3 mx-auto max-w-sm">
                      <Info className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>Full holder data limited by network — deeper integration coming soon</span>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-4 max-w-md mx-auto" data-testid="text-vibe-message">
                      "{data.ratingExplanation}"
                    </p>
                    <div className="flex items-center justify-center gap-3">
                      <Button
                        variant={vibeVote === "fair" ? "default" : "outline"}
                        onClick={() => setVibeVote("fair")}
                        className={`gap-2 text-sm ${vibeVote === "fair" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}`}
                        data-testid="button-seems-fair"
                      >
                        <ThumbsUp className="w-4 h-4" /> Seems Fair
                      </Button>
                      <Button
                        variant={vibeVote === "risky" ? "default" : "outline"}
                        onClick={() => setVibeVote("risky")}
                        className={`gap-2 text-sm ${vibeVote === "risky" ? "bg-orange-500 hover:bg-orange-600 text-white" : ""}`}
                        data-testid="button-feels-risky"
                      >
                        <AlertTriangle className="w-4 h-4" /> Feels Risky
                      </Button>
                    </div>
                    {vibeVote && (
                      <p className="text-xs text-muted-foreground mt-3 animate-fadeInUp" data-testid="text-vote-thanks">
                        Thanks for your vote! Community vibes help everyone.
                      </p>
                    )}
                  </div>
                )}
              </Card>
            </section>

            {data.risk && (
              <section data-testid="section-risk-assessment">
                <RiskScoreCard
                  risk={data.risk}
                  onPdf={() => downloadAudit("pdf")}
                  onCsv={() => downloadAudit("csv")}
                />
              </section>
            )}

            {!data.dataIncomplete && (
              <>
                <div className="flex items-end justify-center gap-4 sm:gap-8" data-testid="section-bags">
                  <BagIcon label="Top Holder" percent={data.topHolderPercent} delay="0.1s" color="bg-emerald-500" />
                  <BagIcon label="In Liquidity" percent={data.reinvestedPercent} delay="0.3s" color="bg-blue-500" />
                  <BagIcon label="Distributed" percent={data.movedElsewherePercent} delay="0.5s" color="bg-orange-500" />
                </div>

                {data.rating && (
                  <section className="text-center" data-testid="section-traffic-light">
                    <TrafficLight rating={data.rating} />
                    <p className="text-xs text-muted-foreground mt-3 max-w-xs mx-auto">
                      This isn't financial advice — it's a quick snapshot of how the token supply is spread across wallets right now.
                    </p>
                  </section>
                )}

                <section data-testid="section-boring-stuff">
                  <button
                    onClick={() => setShowBoring(!showBoring)}
                    className="w-full flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
                    data-testid="button-toggle-boring"
                  >
                    {showBoring ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    {showBoring ? "Hide the boring stuff" : "Show me the boring stuff →"}
                  </button>

                  {showBoring && (
                    <div className="space-y-4 mt-4 animate-fadeInUp">
                      <Card className="p-4">
                        <h3 className="font-bold text-sm mb-3">Top Holders ({data.topHolders.length})</h3>
                        {data.holderBreakdown &&
                          (data.holderBreakdown.liquidityPercent > 0 ||
                            data.holderBreakdown.lockedPercent > 0 ||
                            data.holderBreakdown.burnedPercent > 0) && (
                            <div className="flex flex-wrap gap-1.5 mb-3" data-testid="holder-breakdown">
                              {data.holderBreakdown.liquidityPercent > 0 && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                                  {data.holderBreakdown.liquidityPercent}% in liquidity
                                </span>
                              )}
                              {data.holderBreakdown.lockedPercent > 0 && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                                  {data.holderBreakdown.lockedPercent}% locked
                                </span>
                              )}
                              {data.holderBreakdown.burnedPercent > 0 && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300">
                                  {data.holderBreakdown.burnedPercent}% burned
                                </span>
                              )}
                            </div>
                          )}
                        <div className="space-y-2">
                          {data.topHolders.length === 0 && (
                            <p className="text-xs text-muted-foreground">No holder data available</p>
                          )}
                          {data.topHolders
                            .slice(holderPage * holdersPerPage, (holderPage + 1) * holdersPerPage)
                            .map((holder, i) => {
                              const rank = holderPage * holdersPerPage + i + 1;
                              return (
                                <div key={holder.address} className="flex items-center justify-between text-xs" data-testid={`holder-row-${rank - 1}`}>
                                  <div className="flex items-center gap-2">
                                    <span className="text-muted-foreground w-6">#{rank}</span>
                                    <button onClick={() => copyAddress(holder.address)} className="flex items-center gap-1 hover:text-emerald-500 transition-colors font-mono">
                                      {shortenAddress(holder.address)}
                                      {copiedAddress === holder.address ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3 opacity-40" />}
                                    </button>
                                    {holder.label && (
                                      <a
                                        href={chain.explorerAddressUrl(holder.address)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold whitespace-nowrap flex items-center gap-0.5 ${
                                          holder.category === "liquidity"
                                            ? "bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-950/40 dark:text-blue-300"
                                            : holder.category === "locker"
                                              ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300"
                                              : holder.category === "burn"
                                                ? "bg-orange-100 text-orange-700 hover:bg-orange-200 dark:bg-orange-950/40 dark:text-orange-300"
                                                : "bg-muted text-muted-foreground"
                                        }`}
                                        data-testid={`holder-label-${rank - 1}`}
                                        title={`View ${holder.label} on ${chain.explorerName}`}
                                      >
                                        {holder.label}
                                        <ExternalLink className="w-2.5 h-2.5" />
                                      </a>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(holder.percent, 100)}%` }} />
                                    </div>
                                    <span className="font-semibold w-8 text-right">{holder.percent}%</span>
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                        {data.topHolders.length > holdersPerPage && (
                          <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                            <span className="text-xs text-muted-foreground">
                              Page {holderPage + 1} of {Math.ceil(data.topHolders.length / holdersPerPage)}
                            </span>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-xs h-7 px-3"
                                onClick={() => setHolderPage(holderPage - 1)}
                                disabled={holderPage === 0}
                                data-testid="button-holders-prev"
                              >
                                Previous
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-xs h-7 px-3"
                                onClick={() => setHolderPage(holderPage + 1)}
                                disabled={(holderPage + 1) * holdersPerPage >= data.topHolders.length}
                                data-testid="button-holders-next"
                              >
                                Next
                              </Button>
                            </div>
                          </div>
                        )}
                      </Card>

                      <Card className="p-4">
                        <h3 className="font-bold text-sm mb-3">Recent Transactions</h3>
                        <div className="space-y-2">
                          {data.recentTransactions.length === 0 && (
                            <p className="text-xs text-muted-foreground">No transaction data available</p>
                          )}
                          {data.recentTransactions.map((tx, i) => (
                            <div key={tx.signature} className="flex items-center justify-between text-xs" data-testid={`tx-row-${i}`}>
                              <a
                                href={chain.explorerTxUrl(tx.signature)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 font-mono text-emerald-600 hover:underline"
                              >
                                {tx.signature.slice(0, 12)}...
                                <ExternalLink className="w-3 h-3" />
                              </a>
                              <span className="text-muted-foreground">
                                {tx.timestamp ? new Date(tx.timestamp * 1000).toLocaleDateString() : "—"}
                              </span>
                            </div>
                          ))}
                        </div>
                      </Card>

                      <Card className="p-4">
                        <h3 className="font-bold text-sm mb-3">Token Details</h3>
                        <div className="space-y-1.5 text-xs">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Name</span>
                            <span className="font-semibold">{data.tokenName}{data.tokenSymbol ? ` (${data.tokenSymbol})` : ""}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Contract</span>
                            <button onClick={() => copyAddress(data.tokenAddress)} className="flex items-center gap-1 font-mono hover:text-emerald-500">
                              {shortenAddress(data.tokenAddress)}
                              {copiedAddress === data.tokenAddress ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3 opacity-40" />}
                            </button>
                          </div>
                          {data.creatorAddress && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Creator</span>
                              <button onClick={() => copyAddress(data.creatorAddress)} className="flex items-center gap-1 font-mono hover:text-emerald-500">
                                {shortenAddress(data.creatorAddress)}
                                {copiedAddress === data.creatorAddress ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3 opacity-40" />}
                              </button>
                            </div>
                          )}
                          {data.topHolderAddress && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Top Holder</span>
                              <button onClick={() => copyAddress(data.topHolderAddress)} className="flex items-center gap-1 font-mono hover:text-emerald-500">
                                {shortenAddress(data.topHolderAddress)}
                                {copiedAddress === data.topHolderAddress ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3 opacity-40" />}
                              </button>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Total Supply</span>
                            <span className="font-mono">{data.totalSupply.toLocaleString()}</span>
                          </div>
                        </div>
                      </Card>
                    </div>
                  )}
                </section>

              </>
            )}
          </div>
        )}

        <Footer />
      </main>
    </div>
  );
}
