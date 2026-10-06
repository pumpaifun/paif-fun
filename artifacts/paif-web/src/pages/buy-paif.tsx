import { useState } from "react";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, Check, Copy, ExternalLink, Info, ShoppingCart, ShieldCheck } from "lucide-react";

const PAIF_MINT = "HngT3GgmdyEZPmJAu4H84SeoexDb9kccQcZGQxvDpump";
const PUMPFUN_URL = `https://pump.fun/coin/${PAIF_MINT}`;
const JUPITER_URL = `https://jup.ag/swap/SOL-${PAIF_MINT}`;
const DEXSCREENER_URL = `https://dexscreener.com/solana/${PAIF_MINT}`;
const SOLSCAN_URL = `https://solscan.io/token/${PAIF_MINT}`;
const APP_SWAP_URL = `/swap?outputMint=${encodeURIComponent(PAIF_MINT)}`;

const blackBtn =
  "bg-black hover:bg-black/90 text-white dark:bg-white dark:hover:bg-white/90 dark:text-black";

function OptionCard({
  title,
  description,
  children,
  recommended = false,
  testId,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  recommended?: boolean;
  testId: string;
}) {
  return (
    <Card className={recommended ? "border-emerald-500/60 shadow-sm" : ""} data-testid={testId}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <h2 className="text-base font-bold text-foreground">{title}</h2>
            {recommended && (
              <span className="inline-block mt-1 text-[10px] uppercase tracking-wide font-bold text-emerald-600 dark:text-emerald-400">
                Recommended
              </span>
            )}
          </div>
          {recommended && <ShieldCheck className="w-5 h-5 text-emerald-500 flex-shrink-0" />}
        </div>
        <p className="text-sm text-muted-foreground mb-4">{description}</p>
        {children}
      </CardContent>
    </Card>
  );
}

export default function BuyPaifPage() {
  const [copied, setCopied] = useState(false);

  const copyMint = async () => {
    try {
      await navigator.clipboard.writeText(PAIF_MINT);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center gap-2 mb-1">
          <ShoppingCart className="w-6 h-6 text-emerald-500" />
          <h1 className="text-2xl font-black text-foreground" data-testid="text-buypaif-title">
            Buy $PAIF
          </h1>
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          Choose where to buy, or open the PAIF swap directly inside this app.
        </p>

        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 mb-5 text-[13px] text-muted-foreground">
          <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-500" />
          <p data-testid="text-buypaif-explainer">
            $PAIF is a Solana token. Pump.fun is the official route shown here, while Jupiter
            availability can change as liquidity moves between venues. Always verify the contract
            address below before buying.
          </p>
        </div>

        <section className="grid gap-4 md:grid-cols-2" aria-label="Ways to buy PAIF">
          <OptionCard
            title="Buy inside PAIF"
            description="Connect your Solana wallet and swap SOL for PAIF without leaving the app. The swap opens with PAIF already selected."
            recommended
            testId="step-1"
          >
            <Button asChild className="w-full" data-testid="link-buy-in-app">
              <a href={APP_SWAP_URL}>
                Open PAIF Swap <ArrowRight className="w-4 h-4 ml-1.5" />
              </a>
            </Button>
            <p className="text-[11px] text-muted-foreground mt-2">
              The live route is selected automatically when you request a quote.
            </p>
          </OptionCard>

          <OptionCard
            title="Buy on pump.fun"
            description="Use the official $PAIF page on pump.fun and connect your Solana wallet there."
            testId="step-2"
          >
            <Button asChild className={`${blackBtn} w-full`} data-testid="link-buy-pumpfun">
              <a href={PUMPFUN_URL} target="_blank" rel="noopener noreferrer">
                Buy on pump.fun <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
              </a>
            </Button>
          </OptionCard>
        </section>

        <Card className="mt-4">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-base font-bold text-foreground">Other market links</h2>
              <span className="text-[11px] text-muted-foreground">availability may vary</span>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Jupiter may show a route when current PAIF liquidity supports it. Use these links only
              after checking that the token and contract address match.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm" data-testid="link-buy-jupiter">
                <a href={JUPITER_URL} target="_blank" rel="noopener noreferrer">
                  Try Jupiter <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
                </a>
              </Button>
              <Button asChild variant="outline" size="sm" data-testid="link-verify-dexscreener">
                <a href={DEXSCREENER_URL} target="_blank" rel="noopener noreferrer">
                  DexScreener <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
                </a>
              </Button>
              <Button asChild variant="outline" size="sm" data-testid="link-verify-solscan">
                <a href={SOLSCAN_URL} target="_blank" rel="noopener noreferrer">
                  Solscan <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardContent className="p-5">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div>
                <h2 className="text-base font-bold text-foreground">PAIF contract address</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Solana mint — use this to verify the token</p>
              </div>
              <ShieldCheck className="w-5 h-5 text-emerald-500 flex-shrink-0" />
            </div>
            <button
              onClick={copyMint}
              className="w-full flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-left hover:bg-muted/70 transition-colors"
              data-testid="button-copy-mint"
              aria-label="Copy PAIF contract address"
            >
              <span className="font-mono text-[11px] text-foreground break-all">{PAIF_MINT}</span>
              {copied ? (
                <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />
              ) : (
                <Copy className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              )}
            </button>
            <p className="text-[11px] text-muted-foreground mt-2">
              Never buy a token based on the name alone. Match this address on the venue you use.
            </p>
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
}