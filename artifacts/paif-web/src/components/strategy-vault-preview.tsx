import { Card, CardContent } from "@/components/ui/card";
import { Bot, Wallet, ArrowRight, Clock, Repeat, TrendingUp, Shield } from "lucide-react";
import { Link } from "wouter";

const features = [
  { name: "DCA — accumulate over time", icon: Clock, color: "text-emerald-500" },
  { name: "Trade — auto buy & sell", icon: Repeat, color: "text-blue-500" },
  { name: "Runs 24/7, browser closed", icon: TrendingUp, color: "text-violet-500" },
];

export function StrategyVaultPreview() {
  return (
    <Card data-testid="card-strategy-vault-preview">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-emerald-500" />
            <h2 className="text-base font-bold text-foreground" data-testid="text-vault-preview-title">
              Autonomous
            </h2>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Shield className="w-3 h-3" />
            <span>Non-Custodial</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Set a budget and a time window — the bot buys (and optionally sells) hands-free, even with
          your browser closed.
        </p>

        <div className="flex items-center justify-center gap-2 mb-3 rounded-lg border border-border bg-muted/20 p-2.5">
          <div className="flex items-center gap-1.5">
            <Wallet className="w-3.5 h-3.5 text-foreground" />
            <span className="text-[10px] font-bold text-foreground">Your Wallet</span>
          </div>
          <ArrowRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
          <div className="flex items-center gap-1.5">
            <Bot className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-[10px] font-bold text-foreground">Trading Bot</span>
          </div>
          <ArrowRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
          <span className="text-[10px] font-bold text-foreground">Scheduled Trades</span>
        </div>

        <div className="space-y-1.5">
          {features.map((s, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-md border border-border/50 px-2.5 py-1.5 text-xs"
              data-testid={`vault-preview-feature-${i}`}
            >
              <s.icon className={`w-3.5 h-3.5 ${s.color}`} />
              <span className="font-semibold text-foreground">{s.name}</span>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between mt-3">
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-500">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
          </span>
          <Link
            href="/vaults"
            className="flex items-center gap-1 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
            data-testid="link-vaults-page"
          >
            Open Autonomous Bot <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
