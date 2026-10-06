import { useState } from "react";
import { Link } from "wouter";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import CryptoBingoPage from "@/pages/crypto-bingo";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  GraduationCap,
  ChevronDown,
  Bot,
  ShieldAlert,
  Coins,
  Droplets,
  Users,
  Search,
  Dices,
  Activity,
  TrendingUp,
  BarChart3,
  Zap,
} from "lucide-react";

type Guide = {
  id: string;
  icon: typeof Bot;
  title: string;
  summary: string;
  body: string[];
};

const GUIDES: Guide[] = [
  {
    id: "sniper-bot",
    icon: Bot,
    title: "What is a sniper bot?",
    summary: "Software that auto-buys a token the instant it launches.",
    body: [
      "A sniper bot watches for a brand-new token and buys it in the very first block — often before any human can react.",
      "Snipers aim to get in at the lowest possible price, then sell to the wave of buyers that arrives seconds later.",
      "When you see a token spike and dump in the first minute, snipers dumping on early buyers is usually why.",
      "On PAIF you can run your own sniper in manual, auto-scan, or live-launch modes — but always understand a token before aping in.",
    ],
  },
  {
    id: "spot-rug",
    icon: ShieldAlert,
    title: "How to spot a rug",
    summary: "The warning signs that a token is built to steal your money.",
    body: [
      "A 'rug pull' is when the creator drains value and leaves holders with worthless tokens.",
      "Red flags: a tiny number of wallets hold most of the supply, liquidity isn't locked, the dev wallet sells everything, or the team is fully anonymous.",
      "Social red flags: Telegram/Discord deleted, website offline, or hype that comes only from paid callers.",
        "Use the scanner to check holder concentration and creator behavior — and try the Rug Bingo deck below to learn the patterns in a fun way.",
    ],
  },
  {
    id: "creator-fees",
    icon: Coins,
    title: "What creator fees mean",
    summary: "How token creators earn — and how that can be abused.",
    body: [
      "On platforms like pump.fun, the token creator can earn a cut of trading activity (creator fees).",
      "Earning fees isn't bad on its own — it's how legit builders fund a project.",
      "It becomes a warning sign when the creator immediately bridges or cashes out those fees instead of reinvesting.",
      "PAIF's scanner traces where creator fees go (reinvested vs. moved elsewhere) so you can judge intent.",
    ],
  },
  {
    id: "read-liquidity",
    icon: Droplets,
    title: "How to read liquidity",
    summary: "Why the size and lock status of the pool matter.",
    body: [
      "Liquidity is the pool of funds that lets people buy and sell a token. Thin liquidity means even small sells crash the price.",
      "'Locked' liquidity means the creator can't suddenly pull the pool — a key safety signal.",
      "Very low liquidity (a few SOL) plus an unlocked pool is a classic setup for an instant rug.",
      "Healthy, growing, locked liquidity is a sign a token has staying power.",
    ],
  },
  {
    id: "holder-concentration",
    icon: Users,
    title: "Why holder concentration matters",
    summary: "A few whales holding everything is a danger sign.",
    body: [
      "If the top 10 wallets hold most of the supply, those few people control the price.",
      "When one whale sells, the price can collapse before you have a chance to exit.",
      "Healthy tokens spread supply across many independent holders.",
      "The scanner shows top-holder percentage and the full holder list so you can gauge the risk.",
    ],
  },
];

const SIGNAL_GUIDES: Guide[] = [
  {
    id: "signal-creator-activity",
    icon: Activity,
    title: "Creator activity",
    summary: "Observed launches and market activity linked to a creator wallet.",
    body: [
      "PAIF connects observed token launches with the creator wallet attributed by the available source data.",
      "Launch count, graduation history, market cap, and volume add context, but they do not prove a creator's intent or predict how a new token will perform.",
      "Creator history can be partial when an upstream source is delayed or does not cover an older launch.",
    ],
  },
  {
    id: "signal-large-trades",
    icon: TrendingUp,
    title: "Large trade activity",
    summary: "A trade event crossed an observed size threshold.",
    body: [
      "A large-trade event means the decoded gross trade amount crossed the configured threshold in the observed market stream.",
      "It does not mean the trade is a recommendation, and a provider may summarize or net the apparent buy and sell direction.",
      "Use the event as a reason to inspect the token, pool, and wallet evidence rather than as a reason to copy the trade.",
    ],
  },
  {
    id: "signal-volume-spikes",
    icon: BarChart3,
    title: "Unusual volume",
    summary: "Recent trading activity rose above its nearby baseline.",
    body: [
      "A volume spike compares a recent activity window with the token's recent baseline.",
      "Volume may be split across pools, delayed by a provider, or influenced by repeated trading. A spike shows attention, not price direction.",
    ],
  },
  {
    id: "signal-risk-patterns",
    icon: ShieldAlert,
    title: "Risk patterns",
    summary: "Several observable conditions suggest that closer review is needed.",
    body: [
      "PAIF can combine liquidity changes, sell pressure, creator history, holder evidence, and route availability into a risk observation.",
      "No risk model can guarantee that a token is safe. Missing evidence lowers confidence and should be shown as unknown rather than treated as a pass.",
    ],
  },
  {
    id: "signal-new-launches",
    icon: Zap,
    title: "New launch signals",
    summary: "A fresh Solana launch matched the selected research filters.",
    body: [
      "New-launch filters can use age, liquidity, volume, momentum, holder evidence, and observed creator history.",
      "Fresh tokens have limited history and can change quickly. A match is a prompt for further research, not a prediction or automatic buy recommendation.",
      "PAIF draws these observations from sources such as PumpAPI, PumpPortal, DexScreener, and public Solana RPC data; availability and timing can vary by source.",
    ],
  },
];

export default function LearnPage({ initialBingoDeck }: { initialBingoDeck?: string } = {}) {
  const [open, setOpen] = useState<string | null>(GUIDES[0].id);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center gap-2 mb-1">
          <GraduationCap className="w-6 h-6 text-emerald-500" />
          <h1 className="text-2xl font-black text-foreground" data-testid="text-learn-title">
            Learn Crypto
          </h1>
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          Short, plain-English guides for beginners. Understand the basics before you trade — it's the
          single best way to avoid getting rekt.
        </p>

        <Card className="mb-5 border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
              <Dices className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-foreground text-sm">Learn through play</p>
              <p className="text-xs text-muted-foreground">
                Pick a Bingo deck below, tap a square, and learn the crypto term or warning sign behind it.
              </p>
            </div>
            <a href="#bingo">
              <Button size="sm" variant="outline" className="font-bold gap-1.5 whitespace-nowrap" data-testid="button-jump-to-bingo">
                <Dices className="w-3.5 h-3.5" /> Play to learn
              </Button>
            </a>
          </CardContent>
        </Card>

        <div className="space-y-2.5">
          {GUIDES.map((g) => {
            const Icon = g.icon;
            const isOpen = open === g.id;
            return (
              <Card key={g.id} data-testid={`guide-${g.id}`}>
                <button
                  onClick={() => setOpen(isOpen ? null : g.id)}
                  className="w-full text-left"
                  aria-expanded={isOpen}
                  data-testid={`button-guide-${g.id}`}
                >
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-4.5 h-4.5 text-emerald-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-foreground text-sm">{g.title}</p>
                      <p className="text-xs text-muted-foreground truncate">{g.summary}</p>
                    </div>
                    <ChevronDown
                      className={`w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    />
                  </CardContent>
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 pt-0 space-y-2" data-testid={`guide-body-${g.id}`}>
                    {g.body.map((p, i) => (
                      <p key={i} className="text-sm text-muted-foreground leading-relaxed">
                        {p}
                      </p>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>

          <section className="mt-8" aria-labelledby="signal-learning-heading">
            <h2 id="signal-learning-heading" className="text-xl font-black text-foreground">
              How to read PAIF signals
            </h2>
            <p className="mt-1 mb-4 text-sm leading-relaxed text-muted-foreground">
              Signals are evidence events, not trade recommendations. Open each definition to see what it means and where its limits are.
            </p>
            <div className="space-y-2.5">
              {SIGNAL_GUIDES.map((g) => {
                const Icon = g.icon;
                const isOpen = open === g.id;
                return (
                  <Card key={g.id} data-testid={`guide-${g.id}`}>
                    <button
                      onClick={() => setOpen(isOpen ? null : g.id)}
                      className="w-full text-left"
                      aria-expanded={isOpen}
                      data-testid={`button-guide-${g.id}`}
                    >
                      <CardContent className="p-4 flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                          <Icon className="w-4.5 h-4.5 text-emerald-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-foreground text-sm">{g.title}</p>
                          <p className="text-xs text-muted-foreground truncate">{g.summary}</p>
                        </div>
                        <ChevronDown
                          className={`w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                        />
                      </CardContent>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 pt-0 space-y-2" data-testid={`guide-body-${g.id}`}>
                        {g.body.map((p, i) => (
                          <p key={i} className="text-sm text-muted-foreground leading-relaxed">
                            {p}
                          </p>
                        ))}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </section>

        <Card className="mt-6">
          <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="flex-1">
              <p className="font-bold text-foreground text-sm">Ready to put it into practice?</p>
              <p className="text-xs text-muted-foreground">
                Scan a real token, or test your rug-spotting skills.
              </p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Link href="/">
                <Button size="sm" className="font-bold gap-1.5" data-testid="button-learn-scan">
                  <Search className="w-3.5 h-3.5" /> Scan a token
                </Button>
              </Link>
              <a href="#bingo">
                <Button size="sm" variant="outline" className="font-bold gap-1.5" data-testid="button-learn-bingo">
                  <Dices className="w-3.5 h-3.5" /> Play to learn
                </Button>
              </a>
            </div>
          </CardContent>
        </Card>

        <CryptoBingoPage embedded initialDeck={initialBingoDeck} />
      </main>
      <Footer />
    </div>
  );
}
