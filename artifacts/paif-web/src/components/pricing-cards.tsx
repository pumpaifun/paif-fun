import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Copy, Check, Zap, ArrowRight, CheckCircle2 } from "lucide-react";
import { Link } from "wouter";

const features = [
  "Variable amounts — fixed, random range, or cycling list",
  "1–10 sub-wallets with automatic rotation & sweep",
  "Sign once, bump hands-free with an encrypted session wallet",
  "Persistent bump history across sessions",
];

export function PricingCards() {
  return (
    <Card data-testid="card-pricing">
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-1">
          <Zap className="w-4 h-4 text-foreground" />
          <h2 className="text-base font-bold text-foreground" data-testid="text-pricing-title">
            Pump.fun Bump Bot
          </h2>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Automated periodic trades that keep your token visible in the "Recently Traded" feed.
        </p>

        <ul className="space-y-1.5 mb-4">
          {features.map((f, i) => (
            <li
              key={f}
              className="flex items-start gap-2 text-[12px] text-muted-foreground"
              data-testid={`row-feature-${i}`}
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
              <span>{f}</span>
            </li>
          ))}
        </ul>

        <Link
          href="/bump-bot"
          className="flex items-center justify-center gap-1.5 w-full rounded-lg border border-emerald-500/50 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold text-sm py-2.5 transition-colors mb-3"
          data-testid="link-open-bump-bot"
        >
          Open Bump Bot
          <ArrowRight className="w-4 h-4" />
        </Link>

        <Link
          href="/privacy"
          className="text-[10px] text-center text-muted-foreground/60 hover:text-muted-foreground transition-colors block mb-2 underline underline-offset-2"
          data-testid="link-pricing-terms"
        >
          Fee terms & privacy policy
        </Link>

        <a
          href="https://dexscreener.com/solana/4s6lldhkyu1ajzdmwzcf9eh5obovhphc4cnb1ilprqny"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-center font-bold text-foreground mt-1.5 block hover:text-emerald-500 transition-colors underline underline-offset-2 cursor-pointer"
          data-testid="link-paif-dexscreener"
        >
          $PAIF ⧉
        </a>
        <ContractAddress />
      </CardContent>
    </Card>
  );
}

const PAIF_CONTRACT = "HngT3GgmdyEZPmJAu4H84SeoexDb9kccQcZGQxvDpump";

function ContractAddress() {
  const [copied, setCopied] = useState(false);

  const copyContract = () => {
    navigator.clipboard.writeText(PAIF_CONTRACT);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={copyContract}
      className="mt-1 flex items-center justify-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors mx-auto"
      data-testid="button-copy-paif-contract"
    >
      <span className="break-all">{PAIF_CONTRACT}</span>
      {copied ? (
        <Check className="w-3 h-3 text-emerald-500 flex-shrink-0" />
      ) : (
        <Copy className="w-3 h-3 flex-shrink-0" />
      )}
    </button>
  );
}
