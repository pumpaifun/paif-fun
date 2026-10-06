import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MessageSquare, ThumbsUp, Reply, Fish, Gem, Zap, Crown, Star, Shield, Rocket, Handshake, Lock } from "lucide-react";
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

const userBadges: Record<string, { label: string; color: string; icon: typeof Fish }> = {
  "whale-watcher": { label: "Whale Watcher", color: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800", icon: Fish },
  "diamond-hands": { label: "Diamond Hands", color: "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800", icon: Gem },
  "early-degen": { label: "Early Degen", color: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800", icon: Zap },
  "alpha-caller": { label: "Alpha Caller", color: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800", icon: Crown },
  "og-scanner": { label: "OG Scanner", color: "bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-950 dark:text-pink-300 dark:border-pink-800", icon: Star },
  "safe-trader": { label: "Safe Trader", color: "bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-950 dark:text-cyan-300 dark:border-cyan-800", icon: Shield },
};

function getBadgeColor(badge: string) {
  switch (badge) {
    case "verified": return "bg-emerald-500";
    case "new": return "bg-blue-500";
    case "hot": return "bg-orange-500";
    case "warning": return "bg-red-500";
    default: return "bg-gray-500";
  }
}

function getSentimentColor(sentiment?: string) {
  switch (sentiment) {
    case "bullish": return "text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950";
    case "bearish": return "text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-950";
    default: return "text-muted-foreground bg-muted";
  }
}

function getSentimentLabel(sentiment?: string) {
  switch (sentiment) {
    case "bullish": return "Bullish";
    case "bearish": return "Bearish";
    default: return "Neutral";
  }
}

interface CommentItem {
  name: string;
  badge: string;
  time: string;
  comment: string;
  token: string;
  likes: number;
  replies: number;
  userBadge?: string;
  sentiment?: "bullish" | "bearish" | "neutral";
}

const homepageComments: CommentItem[] = [
  { name: "pumpdotfun_og", badge: "verified", time: "1m ago", comment: "DOGE2 dev wallet hasn't sold since launch. That's rare on pump.fun. Watching closely.", token: "DOGE2", likes: 34, replies: 7, userBadge: "diamond-hands", sentiment: "bullish" },
  { name: "rugsniffer", badge: "warning", time: "3m ago", comment: "Top 5 wallets on RUGPULL were all funded from the same source. Stay the hell away.", token: "RUGPULL", likes: 52, replies: 12, userBadge: "safe-trader", sentiment: "bearish" },
  { name: "solana_maxi", badge: "verified", time: "4m ago", comment: "MOONSHOT just hit Raydium migration. Volume going crazy rn", token: "MOONSHOT", likes: 28, replies: 5, userBadge: "alpha-caller", sentiment: "bullish" },
  { name: "degenTrader42", badge: "hot", time: "6m ago", comment: "Got in PEPEKID at $2K mcap. Already 10x. Holy shit LFG", token: "PEPEKID", likes: 19, replies: 3, userBadge: "early-degen", sentiment: "bullish" },
  { name: "feeWatcher", badge: "verified", time: "8m ago", comment: "GIGA creator collected 12 SOL in fees then moved it all to Binance. What the hell man.", token: "GIGA", likes: 41, replies: 9, userBadge: "whale-watcher", sentiment: "bearish" },
  { name: "newbie_sol", badge: "new", time: "10m ago", comment: "Can someone explain what creator fees mean? Is DOGE2 safe to buy?", token: "DOGE2", likes: 8, replies: 14, sentiment: "neutral" },
  { name: "onchain_detective", badge: "verified", time: "16m ago", comment: "Just traced MOONSHOT creator wallet. They launched 3 tokens before — all rugged under 100K. Be warned.", token: "MOONSHOT", likes: 67, replies: 21, userBadge: "og-scanner", sentiment: "bearish" },
  { name: "pumpChad", badge: "verified", time: "22m ago", comment: "PEPEKID community is actually building. Website, TG group, merch. Rare for pump.fun.", token: "PEPEKID", likes: 31, replies: 8, userBadge: "diamond-hands", sentiment: "bullish" },
  { name: "whale_spotter", badge: "verified", time: "26m ago", comment: "Whale wallet just dumped 200 SOL worth of RUGPULL. Price tanking hard. Damn.", token: "RUGPULL", likes: 44, replies: 16, userBadge: "whale-watcher", sentiment: "bearish" },
  { name: "alphaLeaker", badge: "hot", time: "33m ago", comment: "New token launching in 10 mins from the same creator as DOGE2. Could be big.", token: "DOGE2", likes: 56, replies: 19, userBadge: "alpha-caller", sentiment: "bullish" },
  { name: "rugDetector", badge: "warning", time: "45m ago", comment: "PSA: RUGPULL creator has already launched a new token. Same damn wallet. Don't fall for that bullshit twice.", token: "RUGPULL", likes: 72, replies: 25, userBadge: "og-scanner", sentiment: "bearish" },
  { name: "chartLord", badge: "verified", time: "50m ago", comment: "XVZ forming a cup and handle on the 5min. If it breaks 50K mcap we're flying", token: "XVZ", likes: 22, replies: 4, userBadge: "alpha-caller", sentiment: "bullish" },
];

export function HomepageComments() {
  return (
    <Card className="relative overflow-hidden" data-testid="card-homepage-comments">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <MessageSquare className="w-5 h-5 text-foreground" />
          <h2 className="text-base font-bold text-foreground" data-testid="text-comments-title">
            Community Comments
          </h2>
          <span className="text-xs text-muted-foreground ml-1">on Pump.fun Tokens</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 opacity-50 select-none pointer-events-none" aria-hidden="true">
          {homepageComments.map((item, index) => (
            <div
              key={index}
              className="rounded-lg border border-border bg-muted/50 p-2.5"
              data-testid={`homepage-comment-${index}`}
            >
              <div className="flex items-start gap-2">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-muted flex items-center justify-center">
                  <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold text-sm text-foreground">{item.name}</span>
                    <span className={`w-1.5 h-1.5 rounded-full ${getBadgeColor(item.badge)}`} />
                    {item.userBadge && (() => {
                      const b = userBadges[item.userBadge];
                      if (!b) return null;
                      const Icon = b.icon;
                      return (
                        <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${b.color}`}>
                          <Icon className="w-2.5 h-2.5" /> {b.label}
                        </span>
                      );
                    })()}
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${getSentimentColor(item.sentiment)}`}>
                      {getSentimentLabel(item.sentiment)}
                    </span>
                    <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">{item.time}</span>
                  </div>
                  <p className="text-sm text-foreground leading-snug mt-1">{censorText(item.comment)}</p>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
                      <img src={pumpIcon} alt="" className="w-3 h-3" />
                      {item.token}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <ThumbsUp className="w-3 h-3" /> {item.likes}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Reply className="w-3 h-3" /> {item.replies}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none" data-testid="overlay-comments-partnership">
          <div className="bg-card/92 backdrop-blur-sm rounded-2xl border border-border shadow-lg p-5 sm:p-6 mx-4 max-w-sm text-center pointer-events-auto">
            <div className="flex justify-center mb-3">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <Handshake className="w-6 h-6 text-muted-foreground" />
              </div>
            </div>
            <h3 className="text-sm font-bold text-foreground mb-1.5">Pump.fun Comment Integration</h3>
            <p className="text-xs text-muted-foreground leading-relaxed mb-3">
              Pulling token-specific comments and chats directly from Pump.fun — contingent on
              <span className="font-semibold text-foreground"> Pump.fun Hackathon 2026 Q1</span> results and approval by the Pump.fun team.
            </p>
            <div className="flex items-center justify-center gap-1.5 text-[11px] font-semibold text-emerald-600 mb-1">
              <Rocket className="w-3 h-3" />
              <span>PAIF Community Chat is Live Now →</span>
            </div>
            <a
              href="/forum"
              className="inline-block text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
            >
              Go to Community Chat
            </a>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-4 opacity-40 pointer-events-none">
          <Input
            type="text"
            placeholder="Add a comment about any token..."
            className="flex-1 text-sm"
            data-testid="input-homepage-comment"
            disabled
          />
          <Button variant="default" size="sm" className="font-bold rounded-md" data-testid="button-homepage-comment" disabled>
            Comment
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
