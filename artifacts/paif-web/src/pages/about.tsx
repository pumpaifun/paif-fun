import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Link } from "wouter";
import {
  Sparkles,
  Search,
  ShieldCheck,
  Bot,
  TrendingUp,
  Repeat,
  KeyRound,
  Target,
  ArrowRight,
  Zap,
} from "lucide-react";

const CONTACT_EMAIL = "paif@paif.fun";

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500 shrink-0">
          {icon}
        </div>
        <h2 className="text-base font-bold text-foreground">{title}</h2>
      </div>
      <div className="text-sm text-muted-foreground leading-relaxed space-y-3 pl-10">
        {children}
      </div>
    </section>
  );
}

const tools = [
  {
    icon: <Search className="w-4 h-4" />,
    title: "Post-launch money-flow scanner",
    desc: "See what happens after a token launches — creator fees, wallet behavior, sniper bots, and big money moves, in real time.",
    href: "/scan",
  },
  {
    icon: <ShieldCheck className="w-4 h-4" />,
    title: "Risk scoring & compliance audit",
    desc: "A unified 0–100 risk model with sanctions screening and an exportable audit report, so you can judge a token before you ape in.",
    href: "/scan",
  },
  {
    icon: <Bot className="w-4 h-4" />,
    title: "Sniper & bump bots",
    desc: "Wallet-connected Solana trading automation — manual, auto-scan, and live-launch modes, with multi-wallet rotation.",
    href: "/sniper-bot",
  },
  {
    icon: <TrendingUp className="w-4 h-4" />,
    title: "Autonomous DCA Bot",
    desc: "Set rules once and let an autonomous strategy run — paper or live — through dedicated wallets funded with the amount you choose.",
    href: "/vaults",
  },
  {
    icon: <Zap className="w-4 h-4" />,
    title: "Swing Bot",
    desc: "Trade with bot-found signals, paper-trade verified tokenized stocks, or watch one token with clear guardrails.",
    href: "/swing-bot",
  },
  {
    icon: <Repeat className="w-4 h-4" />,
    title: "PAIF Buybacks",
    desc: "Track PAIF's transparent, on-chain buyback pool and its published ledger.",
    href: "/buyback",
  },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <div className="mb-10">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 bg-emerald-500/10 px-2.5 py-1 rounded-full mb-3">
            <Sparkles className="w-3 h-3" /> About
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">
            Financial tools for on-chain traders
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            <strong className="text-foreground">PAIF.fun</strong> (Pump AI Fun) is
            a transparency and trading toolkit for the memecoin era. Most launches
            tell you the story right up to the buy — we focus on everything that
            happens <em>after</em>: where the money actually goes, who's moving it,
            and whether a token is worth your risk.
          </p>
        </div>

        <Section icon={<Sparkles className="w-4 h-4" />} title="What we build">
          <p>
            We're not a chat app or a hype feed — that ground is well covered. Our
            edge is the <strong className="text-foreground">financial tooling</strong>:
            the data, automation, and risk checks that help traders make better
            decisions.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 not-prose">
            {tools.map((tool) => (
              <Link
                key={tool.title}
                href={tool.href}
                className="group block rounded-xl border border-border bg-card p-4 hover:border-emerald-500/50 transition-colors"
                data-testid={`link-about-tool-${tool.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500 shrink-0">
                    {tool.icon}
                  </span>
                  <h3 className="text-sm font-bold text-foreground leading-tight">
                    {tool.title}
                  </h3>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {tool.desc}
                </p>
              </Link>
            ))}
          </div>
        </Section>

        <Section icon={<KeyRound className="w-4 h-4" />} title="Wallet-authorized by design">
          <p>
            You connect your Solana wallet to authorize setup and wallet-signed
            actions. PAIF never receives your connected wallet's private key.
            Autonomous bots use dedicated strategy wallets funded only with the
            amount you choose, then execute within the rules you configure.
          </p>
        </Section>

        <Section icon={<Target className="w-4 h-4" />} title="Where we're headed">
          <p>
            We're heads-down building real financial tools people actually use —
            deepening the scanner, risk scoring, and automation for Solana and the
            Pump.fun ecosystem. If you have ideas or want to partner, reach out at{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-emerald-500 hover:text-emerald-400 font-semibold underline underline-offset-2"
              data-testid="link-about-contact"
            >
              {CONTACT_EMAIL}
            </a>
            .
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Link
              href="/scan"
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground text-background px-4 py-2 text-xs font-bold hover:opacity-90 transition-opacity"
              data-testid="link-about-cta-scan"
            >
              Scan a token <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <Link
              href="/whitepaper"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-xs font-bold text-foreground hover:bg-muted transition-colors"
              data-testid="link-about-cta-whitepaper"
            >
              Read the whitepaper
            </Link>
          </div>
        </Section>
      </main>
      <Footer />
    </div>
  );
}
