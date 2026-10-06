import { useState, useRef, useEffect, useMemo } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MessageCircle, Wallet, TrendingUp, Search, Flame, Fish, AlertTriangle,
  Rocket, Dumbbell, Globe, BarChart3, ExternalLink, Lock, Handshake,
  ChevronUp, Award, Gem, Shield, Zap, Crown, Star, ArrowUpRight,
  ArrowDownLeft, Coins, Activity, MessageSquare, Send, User, Info, Mail,
  ArrowRight
} from "lucide-react";
import { LoginModal } from "@/components/login-modal";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAuth } from "@/hooks/use-auth";
import type { Comment } from "@shared/schema";
import { signWalletWrite } from "@/lib/wallet-write-auth";
import pumpIcon from "@assets/IMG_1141_1771646019152.png";

const censorWords = [
  "fuck", "fucking", "fucked", "shit", "shitty", "shitting",
  "damn", "damned", "ass", "asshole", "bitch", "bitches",
  "crap", "crappy", "hell", "wtf", "stfu", "lmao", "bullshit"
];

function censorText(text: string): string {
  let result = text;
  for (const word of censorWords) {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    result = result.replace(regex, (match) => {
      if (match.length <= 2) return match;
      return match[0] + "*".repeat(match.length - 2) + match[match.length - 1];
    });
  }
  return result;
}

const userBadges: Record<string, { label: string; color: string; icon: typeof Award }> = {
  "whale-watcher": { label: "Whale Watcher", color: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800", icon: Fish },
  "diamond-hands": { label: "Diamond Hands", color: "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800", icon: Gem },
  "early-degen": { label: "Early Degen", color: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800", icon: Zap },
  "alpha-caller": { label: "Alpha Caller", color: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800", icon: Crown },
  "og-scanner": { label: "OG Scanner", color: "bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-950 dark:text-pink-300 dark:border-pink-800", icon: Star },
  "safe-trader": { label: "Safe Trader", color: "bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-950 dark:text-cyan-300 dark:border-cyan-800", icon: Shield },
};

type FeedSource = "pump.fun" | "paif.fun";

interface UnifiedFeedItem {
  name: string;
  badge: string;
  time: string;
  message: string;
  icon: string;
  source: FeedSource;
  token?: string;
  tokenAddress?: string;
  userBadge?: string;
  upvotes?: number;
  kind: "chat" | "comment";
  sortMinutes: number;
}

const mockPumpFunItems: UnifiedFeedItem[] = [
  { name: "bagHunter99", badge: "verified", time: "1m ago", message: "LFG this is going to Raydium easy 🚀🚀", icon: "rocket", source: "pump.fun", token: "DOGE2", tokenAddress: "Hx4...9kPz", userBadge: "diamond-hands", upvotes: 24, kind: "chat", sortMinutes: 1 },
  { name: "pumpWatcher", badge: "new", time: "3m ago", message: "when moon? been holding since 5k mcap lol", icon: "comment", source: "pump.fun", token: "PEPEKID", tokenAddress: "7Qb...mR3v", upvotes: 8, kind: "chat", sortMinutes: 3 },
  { name: "cryptoKing22", badge: "verified", time: "4m ago", message: "just aped in, community looks legit on tg", icon: "comment", source: "pump.fun", token: "MOONSHOT", tokenAddress: "9Ym...pL2x", userBadge: "alpha-caller", upvotes: 41, kind: "chat", sortMinutes: 4 },
  { name: "solDegen", badge: "hot", time: "6m ago", message: "dev replied in the chat, actually responds unlike most devs", icon: "comment", source: "pump.fun", token: "XVZ", tokenAddress: "3Fp...wK8j", upvotes: 19, kind: "chat", sortMinutes: 6 },
  { name: "moonChaser", badge: "verified", time: "8m ago", message: "buying every dip til this hits 1M mcap", icon: "fire", source: "pump.fun", token: "DOGE2", tokenAddress: "Hx4...9kPz", userBadge: "diamond-hands", upvotes: 17, kind: "chat", sortMinutes: 8 },
  { name: "degenTrader42", badge: "new", time: "11m ago", message: "who else is in this? tg link?", icon: "comment", source: "pump.fun", token: "PEPEKID", tokenAddress: "7Qb...mR3v", upvotes: 5, kind: "chat", sortMinutes: 11 },
  { name: "rugsniffer", badge: "warning", time: "15m ago", message: "be careful, same dev wallet pattern as last week's rug", icon: "alert", source: "pump.fun", token: "RUGPULL", tokenAddress: "2Kd...xP1m", userBadge: "safe-trader", upvotes: 52, kind: "chat", sortMinutes: 15 },
  { name: "pumpChad", badge: "verified", time: "20m ago", message: "1000x from here easy, this community is actually building", icon: "rocket", source: "pump.fun", token: "MOONSHOT", tokenAddress: "9Ym...pL2x", userBadge: "og-scanner", upvotes: 31, kind: "chat", sortMinutes: 20 },
  { name: "alphaLeaker", badge: "hot", time: "25m ago", message: "insider here, dev dropping a big update tonight. hold tight", icon: "fire", source: "pump.fun", token: "XVZ", tokenAddress: "3Fp...wK8j", userBadge: "alpha-caller", upvotes: 63, kind: "chat", sortMinutes: 25 },
  { name: "newbie_sol", badge: "new", time: "28m ago", message: "is this still early? just found out about it", icon: "comment", source: "pump.fun", token: "DOGE2", tokenAddress: "Hx4...9kPz", upvotes: 4, kind: "chat", sortMinutes: 28 },
];

function getBadgeColor(badge: string) {
  switch (badge) {
    case "verified": return "bg-emerald-500";
    case "new": return "bg-blue-500";
    case "hot": return "bg-orange-500";
    case "warning": return "bg-red-500";
    default: return "bg-gray-500";
  }
}

function getIcon(icon: string) {
  const cls = "w-4 h-4 text-muted-foreground";
  switch (icon) {
    case "wallet": return <Wallet className={cls} />;
    case "chart": return <BarChart3 className={cls} />;
    case "search": return <Search className={cls} />;
    case "fire": return <Flame className={cls} />;
    case "whale": return <Fish className={cls} />;
    case "alert": return <AlertTriangle className={cls} />;
    case "rocket": return <Rocket className={cls} />;
    case "muscle": return <Dumbbell className={cls} />;
    case "activity": return <Globe className={cls} />;
    case "comment": return <MessageSquare className={cls} />;
    default: return <MessageCircle className={cls} />;
  }
}

function MockPumpFunCard({ item, index }: { item: UnifiedFeedItem; index: number }) {
  return (
    <div
      className="flex items-start gap-2.5 rounded-lg p-2.5 bg-muted/40 border border-border/60 opacity-70"
      data-testid={`feed-mock-${index}`}
    >
      <div className="flex flex-col items-center gap-0.5 flex-shrink-0 pt-1">
        <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/60" />
        <span className="text-[10px] font-bold text-muted-foreground">{item.upvotes || 0}</span>
      </div>
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-muted flex items-center justify-center">
        {getIcon(item.icon)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-bold text-sm text-foreground">{item.name}</span>
          <span className={`w-1.5 h-1.5 rounded-full ${getBadgeColor(item.badge)}`} />
          {item.userBadge && <UserBadgeTag badgeKey={item.userBadge} />}
          <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">{item.time}</span>
        </div>
        <p className="text-sm text-foreground leading-snug mt-0.5">{censorText(item.message)}</p>
        <div className="flex items-center justify-between mt-1">
          {item.token ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600">
              <img src={pumpIcon} alt="" className="w-3 h-3" />
              {item.token}
              <ExternalLink className="w-2.5 h-2.5" />
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <img src={pumpIcon} alt="" className="w-3 h-3" />
              pump.fun
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

interface UpstreamItem {
  type: "launch" | "creator-move" | "whale-entry" | "liquidity" | "fee-collect";
  token: string;
  tokenAddress: string;
  time: string;
  minutesAgo: number;
  detail: string;
  solAmount?: number;
  walletLabel?: string;
  activityScore: number;
}

function fmtMinutesAgo(m: number): string {
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  if (m < 10080) return `${Math.floor(m / 1440)}d ago`;
  if (m < 43200) return `${Math.floor(m / 10080)}w ago`;
  return `${Math.floor(m / 43200)}mo ago`;
}

const RAW_UPSTREAM: Omit<UpstreamItem, "time">[] = [
  { type: "whale-entry",   token: "PEPEKID",  tokenAddress: "7Qb...mR3v", minutesAgo: 2,    detail: "Whale bought 3.1% of supply",                    solAmount: 180,  activityScore: 94 },
  { type: "launch",        token: "MOONDOGE",  tokenAddress: "2Nd...kP4v", minutesAgo: 5,    detail: "Token launched on Pump.fun",                      solAmount: 0.5,  activityScore: 41 },
  { type: "creator-move",  token: "DOGE2",     tokenAddress: "Hx4...9kPz", minutesAgo: 8,    detail: "Creator moved 45 SOL to Binance hot wallet",      solAmount: 45,   walletLabel: "Binance", activityScore: 87 },
  { type: "fee-collect",   token: "GIGA",      tokenAddress: "5Rn...tQ4d", minutesAgo: 14,   detail: "Creator collected 12 SOL in trading fees",        solAmount: 12,   activityScore: 56 },
  { type: "liquidity",     token: "MOONSHOT",  tokenAddress: "9Ym...pL2x", minutesAgo: 22,   detail: "85 SOL added to Raydium liquidity pool",          solAmount: 85,   activityScore: 73 },
  { type: "creator-move",  token: "MOONSHOT",  tokenAddress: "9Ym...pL2x", minutesAgo: 31,   detail: "Creator sold 8% of total holdings",               solAmount: 32,   activityScore: 79 },
  { type: "whale-entry",   token: "SOLCAT",    tokenAddress: "8Fg...nL1c", minutesAgo: 44,   detail: "Whale accumulated 4.2% of supply in 3 txns",      solAmount: 220,  activityScore: 96 },
  { type: "launch",        token: "RUGPULL",   tokenAddress: "2Kd...xP1m", minutesAgo: 55,   detail: "Token launched — creator wallet flagged",         solAmount: 0.5,  activityScore: 62 },
  { type: "fee-collect",   token: "BONKCAT",   tokenAddress: "3Xr...vQ2z", minutesAgo: 78,   detail: "Creator collected 8.5 SOL in fees",               solAmount: 8.5,  activityScore: 48 },
  { type: "liquidity",     token: "DOGE2",     tokenAddress: "Hx4...9kPz", minutesAgo: 95,   detail: "130 SOL added to bonding curve",                  solAmount: 130,  activityScore: 85 },
  { type: "creator-move",  token: "PEPE3",     tokenAddress: "6Lm...bH9s", minutesAgo: 118,  detail: "Creator moved 22 SOL to exchange wallet",         solAmount: 22,   walletLabel: "Coinbase", activityScore: 71 },
  { type: "whale-entry",   token: "GIGA",      tokenAddress: "5Rn...tQ4d", minutesAgo: 145,  detail: "Whale entry: 1.9% of supply bought",              solAmount: 95,   activityScore: 83 },
  { type: "launch",        token: "CATCOIN",   tokenAddress: "1Jw...mX5t", minutesAgo: 198,  detail: "New token launched on Pump.fun",                  solAmount: 0.5,  activityScore: 37 },
  { type: "fee-collect",   token: "MOONSHOT",  tokenAddress: "9Ym...pL2x", minutesAgo: 230,  detail: "25 SOL fee collection by dev wallet",             solAmount: 25,   activityScore: 67 },
  { type: "liquidity",     token: "BONKCAT",   tokenAddress: "3Xr...vQ2z", minutesAgo: 285,  detail: "Token graduated — 212 SOL locked on Raydium",    solAmount: 212,  activityScore: 99 },
  { type: "creator-move",  token: "DOGE2",     tokenAddress: "Hx4...9kPz", minutesAgo: 340,  detail: "Creator bought back 12 SOL worth of tokens",      solAmount: 12,   activityScore: 58 },
  { type: "whale-entry",   token: "PEPEKID",   tokenAddress: "7Qb...mR3v", minutesAgo: 420,  detail: "Whale exited 2.4% of supply — 160 SOL out",      solAmount: 160,  activityScore: 91 },
  { type: "launch",        token: "SOLDOG",    tokenAddress: "9Kp...rV3w", minutesAgo: 480,  detail: "Token launched — same creator as MOONSHOT",       solAmount: 0.5,  activityScore: 74 },
  { type: "fee-collect",   token: "RUGPULL",   tokenAddress: "2Kd...xP1m", minutesAgo: 560,  detail: "Creator drained 38 SOL then went silent",         solAmount: 38,   activityScore: 88 },
  { type: "liquidity",     token: "PEPE3",     tokenAddress: "6Lm...bH9s", minutesAgo: 650,  detail: "90 SOL added to Raydium pool",                    solAmount: 90,   activityScore: 70 },
  { type: "creator-move",  token: "GIGA",      tokenAddress: "5Rn...tQ4d", minutesAgo: 820,  detail: "Creator bridged 60 SOL to ETH via Wormhole",      solAmount: 60,   walletLabel: "Wormhole", activityScore: 82 },
  { type: "whale-entry",   token: "SOLCAT",    tokenAddress: "8Fg...nL1c", minutesAgo: 1020, detail: "Several large wallets bought 5% of supply",         solAmount: 280,  activityScore: 97 },
  { type: "launch",        token: "ELONPUMP",  tokenAddress: "4Bq...kT6y", minutesAgo: 1440, detail: "New token launched with 12 SOL initial buy",      solAmount: 12,   activityScore: 53 },
  { type: "fee-collect",   token: "MOONSHOT",  tokenAddress: "9Ym...pL2x", minutesAgo: 1800, detail: "Total fees collected: 44 SOL this week",          solAmount: 44,   activityScore: 65 },
  { type: "liquidity",     token: "BONKCAT",   tokenAddress: "3Xr...vQ2z", minutesAgo: 2880, detail: "175 SOL locked in liquidity by community",        solAmount: 175,  activityScore: 78 },
  { type: "creator-move",  token: "CATCOIN",   tokenAddress: "1Jw...mX5t", minutesAgo: 4320, detail: "Creator wallet added 20 SOL — bullish signal",    solAmount: 20,   activityScore: 61 },
  { type: "whale-entry",   token: "ELONPUMP",  tokenAddress: "4Bq...kT6y", minutesAgo: 7200, detail: "Large wallets hold 9.3% of supply",                 solAmount: 420,  activityScore: 95 },
  { type: "launch",        token: "SUPERDOG",  tokenAddress: "5Ck...wR2m", minutesAgo: 14400,detail: "Token launched — 1,200 holders in first 24h",     solAmount: 0.5,  activityScore: 84 },
  { type: "fee-collect",   token: "PEPE3",     tokenAddress: "6Lm...bH9s", minutesAgo: 21600,detail: "Dev collected 72 SOL in fees month-to-date",      solAmount: 72,   activityScore: 77 },
  { type: "liquidity",     token: "GIGA",      tokenAddress: "5Rn...tQ4d", minutesAgo: 43200,detail: "350 SOL Raydium pool — all-time high liquidity",  solAmount: 350,  activityScore: 93 },
];
const UPSTREAM_ITEMS: UpstreamItem[] = RAW_UPSTREAM.map(item => ({ ...item, time: fmtMinutesAgo(item.minutesAgo) }));

type UpstreamTimeFilter = "1h" | "6h" | "12h" | "1d" | "1w" | "1M" | "all";

const UPSTREAM_FILTERS: { key: UpstreamTimeFilter; label: string; minutes: number }[] = [
  { key: "1h",  label: "1h",    minutes: 60 },
  { key: "6h",  label: "6h",    minutes: 360 },
  { key: "12h", label: "12h",   minutes: 720 },
  { key: "1d",  label: "1d",    minutes: 1440 },
  { key: "1w",  label: "1w",    minutes: 10080 },
  { key: "1M",  label: "1M",    minutes: 43200 },
  { key: "all", label: "All",   minutes: Infinity },
];

function getUpstreamIcon(type: UpstreamItem["type"]) {
  const cls = "w-4 h-4";
  switch (type) {
    case "launch": return <Rocket className={`${cls} text-emerald-500`} />;
    case "creator-move": return <ArrowUpRight className={`${cls} text-orange-500`} />;
    case "whale-entry": return <Fish className={`${cls} text-blue-500`} />;
    case "liquidity": return <Coins className={`${cls} text-purple-500`} />;
    case "fee-collect": return <ArrowDownLeft className={`${cls} text-yellow-600`} />;
    default: return <Activity className={`${cls} text-muted-foreground`} />;
  }
}

function getUpstreamColor(type: UpstreamItem["type"]) {
  switch (type) {
    case "launch": return "bg-emerald-50 border-emerald-100 dark:bg-emerald-950/40 dark:border-emerald-900";
    case "creator-move": return "bg-orange-50 border-orange-100 dark:bg-orange-950/40 dark:border-orange-900";
    case "whale-entry": return "bg-blue-50 border-blue-100 dark:bg-blue-950/40 dark:border-blue-900";
    case "liquidity": return "bg-purple-50 border-purple-100 dark:bg-purple-950/40 dark:border-purple-900";
    case "fee-collect": return "bg-yellow-50 border-yellow-100 dark:bg-yellow-950/40 dark:border-yellow-900";
    default: return "bg-muted/50 border-border";
  }
}

function getUpstreamLabel(type: UpstreamItem["type"]) {
  switch (type) {
    case "launch": return "Launch";
    case "creator-move": return "Creator Move";
    case "whale-entry": return "Whale Entry";
    case "liquidity": return "Liquidity";
    case "fee-collect": return "Fee Collected";
    default: return type;
  }
}

function UserBadgeTag({ badgeKey }: { badgeKey: string }) {
  const badge = userBadges[badgeKey];
  if (!badge) return null;
  const Icon = badge.icon;
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${badge.color}`} data-testid={`badge-${badgeKey}`}>
      <Icon className="w-2.5 h-2.5" /> {badge.label}
    </span>
  );
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function truncateWallet(addr: string) {
  if (addr.startsWith("replit:")) return "Email user";
  return addr.slice(0, 4) + "..." + addr.slice(-4);
}

function RealCommentCard({ comment, onUpvote }: { comment: Comment; onUpvote: (id: string) => void }) {
  const isEmailUser = comment.walletAddress.startsWith("replit:");
  return (
    <div
      className="flex items-start gap-2.5 rounded-lg p-2.5 bg-emerald-500/5 border border-emerald-500/10"
      data-testid={`comment-${comment.id}`}
    >
      {/* Upvote column */}
      <div className="flex flex-col items-center gap-0.5 flex-shrink-0 pt-1">
        <button
          onClick={() => onUpvote(comment.id)}
          className="group flex flex-col items-center gap-0 hover:text-emerald-500 transition-colors text-muted-foreground"
          data-testid={`button-upvote-${comment.id}`}
          title="Upstream this post"
        >
          <ChevronUp className="w-4 h-4 group-hover:text-emerald-500" />
          <span className="text-[10px] font-bold leading-none">{comment.upvotes}</span>
        </button>
      </div>

      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center">
        {isEmailUser
          ? <User className="w-3.5 h-3.5 text-emerald-600" />
          : <Wallet className="w-3.5 h-3.5 text-emerald-600" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-bold text-sm text-foreground">{comment.displayName}</span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-500/10 px-1.5 py-0.5 rounded">PAIF</span>
          <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">{timeAgo(new Date(comment.createdAt))}</span>
        </div>
        <p className="text-sm text-foreground leading-snug mt-0.5">{censorText(comment.message)}</p>
        <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
          {isEmailUser ? "Email user" : truncateWallet(comment.walletAddress)}
        </p>
      </div>
    </div>
  );
}

export function LiveFeed() {
  const [chatInput, setChatInput] = useState("");
  const [customName, setCustomName] = useState("");
  const [view, setView] = useState<"forum" | "live" | "upstream">("forum");
  const [upstreamFilter, setUpstreamFilter] = useState<UpstreamTimeFilter>("6h");
  const [loginOpen, setLoginOpen] = useState(false);
  const feedEndRef = useRef<HTMLDivElement>(null);
  const { publicKey, connected, signMessage } = useWallet();
  const { user: authUser, isAuthenticated: isEmailAuth } = useAuth();

  const isSignedIn = (connected && publicKey) || isEmailAuth;

  const profileName = authUser?.username
    ? "@" + authUser.username
    : authUser?.firstName || (publicKey ? truncateWallet(publicKey.toBase58()) : "");

  const { data: comments = [], isLoading } = useQuery<Comment[]>({
    queryKey: ["/api/comments"],
    refetchInterval: 8000,
  });

  const upvoteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/comments/${id}/upvote`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/comments"] });
    },
  });

  const postMutation = useMutation({
    mutationFn: async (data: { walletAddress: string; displayName: string; message: string }) => {
      let body: typeof data & { nonce?: number; signature?: string } = data;
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(data.walletAddress)) {
        const auth = await signWalletWrite(signMessage ?? undefined, "paif-comment", [
          data.walletAddress, data.displayName, data.message, "",
        ]);
        body = { ...data, ...auth };
      }
      const res = await apiRequest("POST", "/api/comments", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/comments"] });
      setChatInput("");
    },
  });

  const filteredUpstream = (() => {
    const filterCfg = UPSTREAM_FILTERS.find(f => f.key === upstreamFilter)!;
    return UPSTREAM_ITEMS
      .filter(item => item.minutesAgo <= filterCfg.minutes)
      .sort((a, b) => b.activityScore - a.activityScore);
  })();

  const forumTopPosts = useMemo(
    () => [...comments].sort((a, b) => b.upvotes - a.upvotes).slice(0, 8),
    [comments],
  );

  function handlePost() {
    if (!chatInput.trim() || !isSignedIn) return;

    let walletAddr: string;
    let name: string;

    if (connected && publicKey) {
      walletAddr = publicKey.toBase58();
      name = customName.trim() || profileName || truncateWallet(walletAddr);
    } else if (authUser) {
      walletAddr = `replit:${authUser.id}`;
      name = customName.trim() || profileName || authUser.email?.split("@")[0] || "Member";
    } else {
      return;
    }

    postMutation.mutate({
      walletAddress: walletAddr,
      displayName: name,
      message: chatInput.trim(),
    });
  }

  return (
    <Card className="h-full" data-testid="card-live-feed">
      <CardContent className="p-4 flex flex-col h-full">

        {/* Header */}
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
          <h2 className="text-base font-bold text-foreground" data-testid="text-live-feed-title">Community Forum & Chat</h2>
          <span className="text-[10px] font-bold text-emerald-600 bg-emerald-500/10 px-1.5 py-0.5 rounded ml-auto flex-shrink-0">
            {comments.length} post{comments.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* View toggle */}
        <div className="flex flex-wrap gap-1.5 mb-3" data-testid="feed-view-tabs">
          <button
            onClick={() => setView("forum")}
            className={`flex items-center gap-1.5 px-3 py-1.5 md:px-4 md:py-2 rounded-full text-xs md:text-sm font-bold transition-colors md:border ${view === "forum" ? "bg-primary text-primary-foreground md:border-primary" : "bg-muted text-muted-foreground hover:bg-muted/80 md:border-border"}`}
            data-testid="tab-forum"
          >
            <MessageSquare className="w-3.5 h-3.5" /> Forum
          </button>
          <button
            onClick={() => setView("live")}
            className={`flex items-center gap-1.5 px-3 py-1.5 md:px-4 md:py-2 rounded-full text-xs md:text-sm font-bold transition-colors md:border ${view === "live" ? "bg-primary text-primary-foreground md:border-primary" : "bg-muted text-muted-foreground hover:bg-muted/80 md:border-border"}`}
            data-testid="tab-live-feed"
          >
            <MessageCircle className="w-3.5 h-3.5" /> Chat
          </button>
          <button
            onClick={() => setView("upstream")}
            className={`flex items-center gap-1.5 px-3 py-1.5 md:px-4 md:py-2 rounded-full text-xs md:text-sm font-bold transition-colors md:border ${view === "upstream" ? "bg-primary text-primary-foreground md:border-primary" : "bg-muted text-muted-foreground hover:bg-muted/80 md:border-border"}`}
            data-testid="tab-upstream"
          >
            <TrendingUp className="w-3.5 h-3.5" /> Upstream
          </button>
        </div>

        {/* Forum (top posts) */}
        {view === "forum" && (
          <div className="flex-1 flex flex-col min-h-0">
            <p className="text-xs text-muted-foreground mb-3">
              Share alpha, ask questions, and vote up the best calls.
            </p>
            <div className="flex-1 space-y-2 overflow-y-auto mb-3 pr-1 max-h-[520px] md:max-h-none md:min-h-0" data-testid="forum-feed-list">
              {isLoading ? (
                [0, 1, 2].map((i) => (
                  <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" data-testid={`skeleton-forum-${i}`} />
                ))
              ) : forumTopPosts.length === 0 ? (
                <div className="text-center py-4 text-sm text-muted-foreground" data-testid="text-forum-empty">
                  <MessageSquare className="w-7 h-7 mx-auto mb-2 opacity-40" />
                  <p className="font-semibold">No posts yet</p>
                  <p className="text-xs mt-1">Be the first to share alpha.</p>
                </div>
              ) : forumTopPosts.map((c) => {
                const isEmailUser = c.walletAddress.startsWith("replit:");
                return (
                  <div
                    key={c.id}
                    className="flex items-start gap-2.5 rounded-lg p-2.5 bg-muted/40 border border-border hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors"
                    data-testid={`forum-comment-${c.id}`}
                  >
                    <button
                      onClick={() => upvoteMutation.mutate(c.id)}
                      className="group flex flex-col items-center flex-shrink-0 pt-0.5 hover:text-emerald-500 transition-colors text-muted-foreground"
                      data-testid={`button-forum-upvote-${c.id}`}
                      title="Upvote this post"
                    >
                      <ChevronUp className="w-4 h-4 group-hover:text-emerald-500" />
                      <span className="text-[11px] font-bold leading-none">{c.upvotes}</span>
                    </button>

                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-500/15 flex items-center justify-center mt-0.5">
                      {isEmailUser
                        ? <User className="w-3.5 h-3.5 text-emerald-600" />
                        : <Wallet className="w-3.5 h-3.5 text-emerald-600" />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-xs text-foreground truncate">{c.displayName}</span>
                        <span className="text-[10px] text-muted-foreground ml-auto flex-shrink-0">
                          {timeAgo(new Date(c.createdAt))}
                        </span>
                      </div>
                      <p className="text-xs text-foreground leading-snug mt-0.5 break-words line-clamp-2">
                        {censorText(c.message)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            <Link
              href="/forum"
              className="mt-auto flex items-center justify-center gap-1.5 w-full rounded-lg bg-foreground text-background py-2 text-xs font-bold hover:opacity-90 transition-opacity"
              data-testid="link-forum-view-all"
            >
              Open the forum
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}

        {/* Live chat messages */}
        {view === "live" && (
          <>
            <div className="flex-1 space-y-2 overflow-y-auto mb-3 pr-1 max-h-[520px] md:max-h-none md:min-h-0">
              {isLoading && (
                <div className="text-center py-4 text-sm text-muted-foreground">Loading messages...</div>
              )}

              {/* Real PAIF community posts */}
              {comments.map((comment) => (
                <RealCommentCard key={comment.id} comment={comment} onUpvote={(id) => upvoteMutation.mutate(id)} />
              ))}

              {comments.length === 0 && !isLoading && (
                <div className="text-center py-4 text-sm text-muted-foreground">
                  <MessageSquare className="w-7 h-7 mx-auto mb-2 opacity-40" />
                  <p className="font-semibold">No PAIF messages yet</p>
                  <p className="text-xs mt-1">Sign in and be the first to post!</p>
                </div>
              )}

              {/* Divider: pump.fun sample stream */}
              <div className="flex items-center gap-2 py-1.5">
                <div className="flex-1 h-px bg-border" />
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <img src={pumpIcon} alt="" className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">pump.fun integration — showing samples</span>
                </div>
                <div className="flex-1 h-px bg-border" />
              </div>

              {/* label above orange notice */}
              <p className="text-[11px] text-muted-foreground leading-relaxed px-0.5">
                Showing live comment and chat samples from pump.fun
              </p>

              {/* pump.fun integration notice inline */}
              <div className="flex items-start gap-2 rounded-lg border border-amber-200/60 dark:border-amber-800/60 bg-amber-50/30 dark:bg-amber-950/10 px-3 py-2" data-testid="inline-pumpfun-notice">
                <Handshake className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Pump.fun integration contingent upon approval and pump.fun hackathon results.
                </p>
              </div>

              {/* Mock pump.fun chat items */}
              {mockPumpFunItems.map((item, index) => (
                <MockPumpFunCard key={`mock-${index}`} item={item} index={index} />
              ))}

              <div ref={feedEndRef} />
            </div>

            {/* Post input */}
            {isSignedIn ? (
              <div className="space-y-2 mt-auto border-t border-border pt-3">
                {!profileName && (
                  <Input
                    type="text"
                    placeholder="Display name (optional)"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    className="text-xs h-8"
                    maxLength={30}
                    data-testid="input-custom-name"
                  />
                )}
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                    {connected ? <Wallet className="w-3.5 h-3.5 text-emerald-600" /> : <User className="w-3.5 h-3.5 text-emerald-600" />}
                  </div>
                  <Input
                    type="text"
                    placeholder={profileName ? `Post as ${profileName}...` : "Say something..."}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handlePost()}
                    className="flex-1 text-sm"
                    maxLength={500}
                    data-testid="input-chat"
                  />
                  <Button
                    variant="default"
                    size="sm"
                    className="font-bold rounded-md px-3"
                    onClick={handlePost}
                    disabled={!chatInput.trim() || postMutation.isPending}
                    data-testid="button-post"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
                {postMutation.isError && (
                  <p className="text-xs text-red-500" data-testid="text-post-error">
                    Failed to post. Try again.
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-auto border-t border-border pt-3 space-y-2">
                <p className="text-xs text-muted-foreground text-center">Sign in to post in the community chat</p>
                <div className="flex gap-2">
                  <Button
                    className="flex-1 h-9 text-xs font-semibold gap-1.5"
                    onClick={() => setLoginOpen(true)}
                    data-testid="button-live-signin-email"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    Sign In / Create Account
                  </Button>
                  <Button
                    variant="outline"
                    className="h-9 text-xs font-semibold gap-1.5 px-3"
                    onClick={() => setLoginOpen(true)}
                    data-testid="button-live-signin-wallet"
                  >
                    <Wallet className="w-3.5 h-3.5" />
                    Wallet
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Upstream feed */}
        {view === "upstream" && (
          <div className="flex-1 flex flex-col gap-2 min-h-0">
            {/* Time filter pills */}
            <div className="flex gap-1 flex-wrap" data-testid="upstream-time-filters">
              {UPSTREAM_FILTERS.map(f => (
                <button
                  key={f.key}
                  onClick={() => setUpstreamFilter(f.key)}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-bold border transition-colors ${upstreamFilter === f.key ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:border-foreground/40"}`}
                  data-testid={`button-upstream-filter-${f.key}`}
                >
                  {f.label}
                </button>
              ))}
              <span className="ml-auto text-[10px] text-muted-foreground self-center">
                {filteredUpstream.length} event{filteredUpstream.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Partnership disclaimer */}
            <div className="flex items-start gap-1.5 rounded-lg border border-amber-200/60 dark:border-amber-800/60 bg-amber-50/30 dark:bg-amber-950/10 px-2.5 py-1.5">
              <Handshake className="w-3 h-3 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Sample data — live upstream feed pending Pump.fun Hackathon 2026 Q1 results.
              </p>
            </div>

            {/* Sorted upstream items */}
            <div className="space-y-1.5 overflow-y-auto max-h-[420px] md:max-h-none md:flex-1 md:min-h-0 pr-1" data-testid="upstream-feed-list">
              {filteredUpstream.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Activity className="w-6 h-6 mx-auto mb-2 opacity-40" />
                  <p className="text-sm font-medium">No activity in this window</p>
                </div>
              ) : filteredUpstream.map((item, index) => (
                // Match the Live Chat row treatment exactly (subtle emerald
                // tint, neutral border, same upvote column on the left) so
                // both tabs feel like one unified feed instead of two
                // visually competing sections.
                <div
                  key={index}
                  className="flex items-start gap-2.5 rounded-lg p-2.5 bg-emerald-500/5 border border-emerald-500/10"
                  data-testid={`upstream-item-${index}`}
                >
                  {/* Upvote column — mirrors RealCommentCard */}
                  <div className="flex flex-col items-center gap-0.5 flex-shrink-0 pt-1">
                    <ChevronUp className="w-4 h-4 text-muted-foreground" />
                    <span className="text-[10px] font-bold text-muted-foreground leading-none">{item.activityScore}</span>
                  </div>
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    {getUpstreamIcon(item.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-sm text-foreground">{getUpstreamLabel(item.type)}</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-600 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                        <img src={pumpIcon} alt="" className="w-3 h-3" />
                        {item.token}
                      </span>
                      <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">{item.time}</span>
                    </div>
                    <p className="text-sm text-foreground leading-snug mt-0.5">{item.detail}</p>
                    {item.solAmount != null && (
                      <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                        {item.solAmount} SOL{item.walletLabel ? ` · ${item.walletLabel}` : ""}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </CardContent>

      <LoginModal open={loginOpen} onOpenChange={setLoginOpen} />
    </Card>
  );
}
