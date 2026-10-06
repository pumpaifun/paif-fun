import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Home, FileText, ChevronRight, ExternalLink, ArrowUp } from "lucide-react";

const SECTIONS = [
  { id: "abstract",       label: "Abstract" },
  { id: "problem",        label: "1. Problem Statement" },
  { id: "solution",       label: "2. The PAIF Solution" },
  { id: "features",       label: "3. Core Features" },
  { id: "technology",     label: "4. Technology & Architecture" },
  { id: "tokenomics",     label: "5. Tokenomics" },
  { id: "fees",           label: "6. Fee Structure & Treasury" },
  { id: "roadmap",        label: "7. Roadmap" },
  { id: "dao",            label: "8. Community & Governance" },
  { id: "disclaimer",     label: "Disclaimer" },
];

function SectionAnchor({ id }: { id: string }) {
  return <span id={id} className="block" style={{ scrollMarginTop: "80px" }} />;
}

export default function WhitepaperPage() {
  const [activeSection, setActiveSection] = useState("abstract");
  const [showBackToTop, setShowBackToTop] = useState(false);

  useEffect(() => {
    document.title = "PAIF Whitepaper — AI-Powered Solana DeFi Intelligence";
  }, []);

  useEffect(() => {
    const onScroll = () => {
      setShowBackToTop(window.scrollY > 600);
      for (const s of [...SECTIONS].reverse()) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= 120) {
          setActiveSection(s.id);
          break;
        }
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <div className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/">
            <button className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground" data-testid="button-whitepaper-home">
              <Home className="w-4 h-4" />
            </button>
          </Link>
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-emerald-500" />
            <span className="font-bold text-sm text-foreground">PAIF Whitepaper</span>
          </div>
          <span className="ml-auto text-[10px] font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">v1.2 — 2026</span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-10 flex gap-10">

        {/* Sticky ToC sidebar */}
        <aside className="hidden lg:block w-56 flex-shrink-0">
          <div className="sticky top-20">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Contents</p>
            <nav className="space-y-0.5" data-testid="whitepaper-toc">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => scrollTo(s.id)}
                  className={`w-full text-left text-xs px-2.5 py-1.5 rounded-md transition-colors font-medium ${
                    activeSection === s.id
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                  data-testid={`toc-link-${s.id}`}
                >
                  {s.label}
                </button>
              ))}
            </nav>

            <div className="mt-6 pt-4 border-t border-border space-y-2">
              <a
                href="https://x.com/PAIFaiFUN"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                data-testid="link-whitepaper-twitter"
              >
                <ExternalLink className="w-3 h-3" /> @PAIFaiFUN
              </a>
              <a
                href="https://t.me/paifaifun"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                data-testid="link-whitepaper-telegram"
              >
                <ExternalLink className="w-3 h-3" /> Telegram
              </a>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 max-w-3xl" data-testid="whitepaper-content">

          {/* Hero */}
          <div className="mb-12">
            <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-1 mb-4">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">Official Whitepaper</span>
            </div>
            <h1 className="text-4xl font-black text-foreground leading-tight mb-3" data-testid="text-whitepaper-title">
              PAIF
            </h1>
            <p className="text-xl text-muted-foreground font-medium mb-2">
               Solana Trading Intelligence & Automation
            </p>
            <p className="text-sm text-muted-foreground">
                 Version 1.2 &nbsp;·&nbsp; Updated September 2026 &nbsp;·&nbsp; paif.fun
            </p>
          </div>

          {/* Abstract */}
          <SectionAnchor id="abstract" />
          <section className="mb-12">
            <h2 className="text-2xl font-black text-foreground mb-4">Abstract</h2>
            <div className="rounded-xl border border-border bg-muted/30 p-5 mb-6">
              <p className="text-sm text-muted-foreground leading-relaxed">
                 PAIF (Pump AI Fun) is a Solana-first trading intelligence and automation platform. It brings together token scanning, creator and wallet analysis, Swing Bot automation, Launch Signals, budget-capped DCA, Trade and Volume strategies, arbitrage research, and verified tokenized-stock discovery in one interface. PAIF is designed to help traders make better decisions without hiding uncertainty: paper mode, explicit custody boundaries, wallet-authorized actions, and visible data limitations remain central to the product.
              </p>
            </div>
          </section>

          {/* Problem */}
          <SectionAnchor id="problem" />
          <section className="mb-12">
            <h2 className="text-2xl font-black text-foreground mb-2">1. Problem Statement</h2>
            <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
              The Solana ecosystem — particularly the pump.fun launchpad — has experienced explosive growth, with thousands of new tokens launching daily. This environment presents significant challenges for participants:
            </p>
            <div className="space-y-4">
              {[
                {
                  title: "Limited Market Context",
                  body: "The pace and volume of new launches make it difficult for any trader to build a complete picture quickly. Useful context is spread across market data, creator history, holder distribution, and wallet activity.",
                },
                {
                  title: "Unclear Project Longevity",
                  body: "Tokens launch with a wide range of goals, scopes, and expected lifespans. Some are experiments or short-term community projects, while others aim to grow over time; the launch alone does not always make that distinction clear.",
                },
                {
                  title: "Fragmented Tooling",
                  body: "Traders currently rely on a disjointed combination of DexScreener, BullX, Telegram bots, on-chain explorers, and manual wallet tracking. The lack of a unified platform creates friction, delays, and missed opportunities.",
                },
                 {
                   title: "The Decision-to-Execution Gap",
                   body: "Finding an asset is only the first step. A longer-term thesis on an established network asset such as SOL calls for a different time horizon than a short-term swing on a newly launched token. Traders need tools that make the intended horizon, entry and exit rules, and risk controls explicit instead of treating every position the same.",
                 },
              ].map((p) => (
                <div key={p.title} className="rounded-lg border border-border p-4">
                  <h3 className="text-sm font-bold text-foreground mb-1">{p.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{p.body}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Solution */}
          <SectionAnchor id="solution" />
          <section className="mb-12">
            <h2 className="text-2xl font-black text-foreground mb-2">2. The PAIF Solution</h2>
            <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
               PAIF addresses each of these challenges through a cohesive, Solana-first platform that combines on-chain data aggregation, creator and wallet analysis, paper-first automation, and user-signed execution.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
              {[
                { label: "Near-real-time multi-source scanning", emoji: "🔍" },
                { label: "Creator wallet risk scoring", emoji: "🛡️" },
                 { label: "Swing Bot with Watch My Token", emoji: "📈" },
                  { label: "Launch Signals with fresh-launch filters", emoji: "⚡" },
                 { label: "PumpAPI and Jupiter execution routing", emoji: "🔄" },
                  { label: "DCA, Trade and Volume automation", emoji: "🏦" },
                  { label: "Arbitrage research and paper-first execution", emoji: "↔️" },
                 { label: "Creator activity & wallet analysis", emoji: "👁️" },
                 { label: "Verified tokenized-stock discovery", emoji: "🏛️" },
                 { label: "Solana wallet-signed execution", emoji: "🔐" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2.5 rounded-lg bg-muted/40 border border-border px-3 py-2.5">
                  <span className="text-base">{item.emoji}</span>
                  <span className="text-xs font-medium text-foreground">{item.label}</span>
                </div>
              ))}
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              By consolidating these capabilities into a single platform, PAIF eliminates the need for traders to context-switch between multiple tools, reducing latency and improving decision quality at every stage of the trading lifecycle.
            </p>
          </section>

          {/* Features */}
          <SectionAnchor id="features" />
          <section className="mb-12">
            <h2 className="text-2xl font-black text-foreground mb-6">3. Core Features</h2>

            <div className="space-y-8">

              <div>
                <h3 className="text-base font-bold text-foreground mb-2 flex items-center gap-2">
                  <span className="w-6 h-6 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs font-black flex items-center justify-center">3.1</span>
                  Token Scanner
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  The PAIF Token Scanner accepts any Solana token address or pump.fun link and returns a comprehensive intelligence report in seconds. Output includes current market cap, bonding curve progress, holder distribution, creator wallet history, top holder concentration, and a composite risk score. Sources vary by feature: PumpAPI supplies live launch, trade, migration, pool, liquidity, and replay events; market data comes from sources such as DexScreener and GeckoTerminal; and targeted account, holder, transaction, and metadata verification uses Solana RPC and Helius when configured. Missing evidence is labeled rather than guessed.
                </p>
              </div>

              <div>
                <h3 className="text-base font-bold text-foreground mb-2 flex items-center gap-2">
                  <span className="w-6 h-6 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs font-black flex items-center justify-center">3.2</span>
                  Wallet Intelligence
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                   PAIF provides a public, read-only view of Solana wallets, including SOL balances, SPL token holdings, transaction history, and address-level context where available. Wallet Search is designed for checking a specific address. Unknown wallets are labeled as unknown rather than guessed.
                </p>
              </div>

              <div>
                <h3 className="text-base font-bold text-foreground mb-2 flex items-center gap-2">
                   <span className="w-6 h-6 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs font-black flex items-center justify-center">3.3</span>
                   Swing Bot &amp; Watch My Token
                 </h3>
                 <p className="text-sm text-muted-foreground leading-relaxed">
                    Swing Bot is PAIF's primary position-management tool. Its scanner can select qualifying Solana tokens automatically or wait for owner approval, while Watch My Token manages a user-selected asset. Paper and live crypto modes share visible position, liquidity, loss-cooldown, profit-protection, and recovery controls. Verified xStocks are available through a separate paper-only simulation with automatic or owner-approved entries. Live strategies use isolated, user-funded worker wallets; the bot follows configured rules and available market evidence rather than promising a result.
                 </p>
               </div>

               <div>
                 <h3 className="text-base font-bold text-foreground mb-2 flex items-center gap-2">
                   <span className="w-6 h-6 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs font-black flex items-center justify-center">3.4</span>
                   Swap and Execution Routing
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                   PAIF uses feature-specific execution routes rather than one universal swap provider. The manual Swap interface uses Jupiter for aggregated quotes and serialized transactions where supported. Swing Bot and automated strategy paths use PumpAPI-first transaction construction for supported Pump.fun, PumpSwap, Raydium and Meteora pools, with independent validation before an isolated worker wallet signs; Jupiter can provide a route for graduated or otherwise supported fallback assets. PumpPortal is used as a redundant event stream and for limited compatibility paths, not presented as the primary execution router. Route availability, latency and transaction landing are never guaranteed.
                </p>
              </div>

              <div>
                <h3 className="text-base font-bold text-foreground mb-2 flex items-center gap-2">
                   <span className="w-6 h-6 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs font-black flex items-center justify-center">3.5</span>
                   Launch Signals
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                   Launch Signals consolidates fresh-token discovery into one flow. Provider WebSocket streams surface new launches quickly, then independent market and safety sources add volume, market cap, holder, age, price-movement and creator-risk context. Users can apply presets or tune the age window and other filters. This is best-effort near-real-time monitoring—not a promise of first-block capture—and provider, RPC or network delay can affect when a launch becomes visible or actionable.
                </p>
              </div>

              <div>
                <h3 className="text-base font-bold text-foreground mb-2 flex items-center gap-2">
                   <span className="w-6 h-6 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs font-black flex items-center justify-center">3.6</span>
                   DCA, Trade and Volume Automation
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                   The former Bump Bot is retired because current routed trades do not reliably appear in pump.fun's own bump feed. PAIF does not claim that its automation can maintain a token's placement there. The current Autonomous DCA Bot instead provides three budget-capped, time-boxed modes: Accumulate makes spaced purchases over time; Trade performs buy-then-sell activity; and Volume alternates real buys and sells so activity can appear on the price chart and services such as DexScreener. Volume cycles return the strategy toward a flat token position, but still incur provider, venue, network and slippage costs.
                </p>
              </div>

              <div>
                <h3 className="text-base font-bold text-foreground mb-2 flex items-center gap-2">
                   <span className="w-6 h-6 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs font-black flex items-center justify-center">3.7</span>
                    Arbitrage Scanner and Bot
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                    PAIF's arbitrage scanner compares supported Solana pools and normalizes base- and quote-side prices to identify potential cross-pool spreads. The autonomous executor is paper-first and requires explicit configuration before any live behavior. Quotes can move before execution, fees and price impact can erase a displayed spread, and no opportunity or profit is guaranteed.
                </p>
              </div>

              <div>
                <h3 className="text-base font-bold text-foreground mb-2 flex items-center gap-2">
                   <span className="w-6 h-6 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs font-black flex items-center justify-center">3.8</span>
                   Creator Activity
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                   Creator Activity brings together launch history, market-cap and volume context, creator-wallet scans, and creator leaderboards. It is intended to add context to a new token without treating historical behavior as proof of future outcomes. Favorites and token history help users revisit research over time.
                 </p>
               </div>

               <div>
                 <h3 className="text-base font-bold text-foreground mb-2 flex items-center gap-2">
                   <span className="w-6 h-6 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs font-black flex items-center justify-center">3.9</span>
                   Verified Tokenized-Stock Discovery
                 </h3>
                 <p className="text-sm text-muted-foreground leading-relaxed">
                   The Tokenized Stocks page is a verified, Solana-based discovery surface for tokenized equity markets. It is read-only and paper-only: PAIF helps users explore available markets and their supporting issuer information, but does not represent tokenized stocks as native equities or execute live stock trades. An Access Pass unlocks the platform's eligible tools, including the xStocks paper-trading simulation; it does not purchase or provide ownership of stocks or tokenized securities. Simulated balances, fills, and results are hypothetical, are not investment advice, and do not guarantee future performance.
                 </p>
               </div>

               <div>
                 <h3 className="text-base font-bold text-foreground mb-2 flex items-center gap-2">
                   <span className="w-6 h-6 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs font-black flex items-center justify-center">3.10</span>
                   Watchlist
                 </h3>
                 <p className="text-sm text-muted-foreground leading-relaxed">
                   Watchlist saves Solana token addresses locally on the user's device and provides a lightweight view of price, 24-hour movement, and pool depth. It is a revisit tool, not a replacement for the full Scanner report.
                 </p>
               </div>

               <div>
                 <h3 className="text-base font-bold text-foreground mb-2 flex items-center gap-2">
                   <span className="w-6 h-6 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs font-black flex items-center justify-center">3.11</span>
                   Community Forum
                 </h3>
                 <p className="text-sm text-muted-foreground leading-relaxed">
                   The PAIF Community Forum is an optional user-generated space for commentary, questions, and token analysis. It is intentionally presented as an early community area: when there are no real posts, PAIF shows an honest empty state rather than simulated activity.
                </p>
              </div>

            </div>
          </section>

          {/* Technology */}
          <SectionAnchor id="technology" />
          <section className="mb-12">
            <h2 className="text-2xl font-black text-foreground mb-4">4. Technology & Architecture</h2>
            <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
              PAIF is a full-stack web application built on Solana, combining multiple RPC, market-data, execution, and community services. Each feature uses the narrowest suitable provider and treats unavailable data as incomplete rather than silently inventing certainty.
            </p>

            <h3 className="text-base font-bold text-foreground mb-2">Provider Boundaries</h3>
            <p className="text-sm text-muted-foreground leading-relaxed mb-5">
              PumpAPI is the primary source for continuous launch, trade, migration, pool, liquidity and replay events and for validated transaction construction on supported Solana pools. PumpPortal provides redundant live-event coverage and limited compatibility support. Jupiter provides aggregated manual swap quotes and selected fallback execution routes. DexScreener, GeckoTerminal and CoinGecko provide market context where applicable. Solana RPC supplies on-chain truth, while Helius is reserved for targeted account, holder, transaction, metadata and priority-fee verification when configured. No single provider is treated as complete or authoritative for every feature.
            </p>

            <h3 className="text-base font-bold text-foreground mb-2">Wallet and Worker-Wallet Security Model</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Browser-signed and manual features keep the user's main-wallet private key on their device and return transactions for approval in wallets such as Phantom or Solflare. Live autonomous Swing and DCA strategies use a separate, strategy-specific worker wallet generated by the server. Its private key is encrypted at rest, the owner funds and authorizes that isolated wallet, and the server signs subsequent strategy transactions until the strategy stops or its funds are swept back to the recorded owner address. This limited-custody model enables unattended execution but introduces server, encryption-key, provider, and smart-contract risk; users should fund only the amount they are prepared to risk.
            </p>
          </section>

          {/* Tokenomics */}
          <SectionAnchor id="tokenomics" />
          <section className="mb-12">
            <h2 className="text-2xl font-black text-foreground mb-4">5. Tokenomics</h2>

            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 mb-6">
              <div className="flex flex-wrap gap-6 mb-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Token</p>
                  <p className="text-lg font-black text-foreground">$PAIF</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Chain</p>
                  <p className="text-lg font-black text-foreground">Solana</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Launch Platform</p>
                  <p className="text-lg font-black text-foreground">pump.fun</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Supply</p>
                  <p className="text-lg font-black text-foreground">1,000,000,000</p>
                </div>
              </div>
              <a
                href="https://pump.fun/coin/HngT3GgmdyEZPmJAu4H84SeoexDb9kccQcZGQxvDpump"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline underline-offset-2"
                data-testid="link-whitepaper-pumpfun"
              >
                <ExternalLink className="w-3 h-3" />
                View on pump.fun
              </a>
            </div>

             <h3 className="text-base font-bold text-foreground mb-3">Platform Access &amp; $PAIF Role</h3>
            <div className="space-y-3 mb-6">
              {[
                  { label: "Access Passes", desc: "Premium access is shared at the wallet level rather than gated by a $PAIF holding threshold. Pass options are $2 for one day, $9.99 for one week, $12.99 for two weeks, or $19.99 for one month, with a one-time three-day trial for eligible wallets. A pass grants access to eligible tools; it does not purchase an asset, provide ownership, or enable live tokenized-stock execution." },
                 { label: "$PAIF Ecosystem Role", desc: "$PAIF is the platform's ecosystem token and is intended to support future participation and governance. Core research surfaces are not presented as dependent on holding a specific token balance." },
                 { label: "Governance Direction", desc: "Future governance may allow $PAIF holders to participate in protocol upgrades, fee parameters, feature prioritization, and treasury allocation once the governance infrastructure is deployed." },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border border-border p-4">
                  <h4 className="text-xs font-bold text-foreground mb-1">{item.label}</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-4">
              <p className="text-xs text-yellow-700 dark:text-yellow-400 leading-relaxed">
                <span className="font-bold">Note:</span> $PAIF launched via pump.fun with no pre-sale, no team allocation, and no VC round. The team holds tokens purchased on the open market alongside community members. The token contract is immutable.
              </p>
            </div>
          </section>

          {/* Fee Structure */}
          <SectionAnchor id="fees" />
          <section className="mb-12">
            <h2 className="text-2xl font-black text-foreground mb-2">6. Fee Structure & Treasury</h2>
            <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
               PAIF separates platform fees from provider, venue and Solana network costs. Fees are
               product- and route-specific; the platform does not claim that every Jupiter, PumpAPI
               or launch-discovery action carries the same PAIF charge. Where a user-signed transaction
               includes a PAIF fee, its amount and recipient are visible in the transaction before
               approval. Live autonomous bots use isolated, server-managed worker wallets and therefore
               follow a separate limited-custody fee and accounting path while those wallets are funded.
            </p>

            <h3 className="text-base font-bold text-foreground mb-3">Per-Trade Fee Breakdown</h3>
            <div className="rounded-xl border border-border overflow-hidden mb-6" data-testid="card-whitepaper-fees">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="text-left p-3 font-bold">Recipient</th>
                    <th className="text-right p-3 font-bold">Rate</th>
                    <th className="text-left p-3 font-bold">Purpose</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr>
                    <td className="p-3 font-bold text-foreground">PAIF Platform Fee</td>
                    <td className="p-3 text-right font-mono font-bold text-emerald-500">Product-specific</td>
                    <td className="p-3 text-muted-foreground">Only applies on paths that explicitly disclose it. Current recipients and amounts are deployment- and product-specific; planned DAO control is not yet active.</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-bold text-foreground">Provider / Venue Fee</td>
                    <td className="p-3 text-right font-mono">Route-dependent</td>
                    <td className="p-3 text-muted-foreground">Depends on the active Pump.fun, PumpSwap, Raydium, Meteora or Jupiter route. PumpAPI-built trades currently include its documented 0.25% provider fee. These charges are not PAIF treasury revenue.</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-bold text-foreground">Solana Network Fee</td>
                    <td className="p-3 text-right font-mono">Variable</td>
                    <td className="p-3 text-muted-foreground">Base transaction cost varies with signatures and account operations and is paid to the network, not PAIF.</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-bold text-foreground">Priority Fee</td>
                    <td className="p-3 text-right font-mono">Dynamic estimate</td>
                    <td className="p-3 text-muted-foreground">A bounded, route-dependent network estimate used to improve inclusion during congestion. It is not PAIF revenue.</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-bold text-foreground">User-Set Slippage</td>
                    <td className="p-3 text-right font-mono">1–50%</td>
                    <td className="p-3 text-muted-foreground">Maximum acceptable price movement during execution, configured by the user per session. Unused slippage is not charged — it's a ceiling, not a fee.</td>
                  </tr>
                </tbody>
                <tfoot className="bg-emerald-500/5 border-t-2 border-emerald-500/30">
                  <tr>
                    <td className="p-3 font-black text-foreground">Applicable Costs</td>
                    <td className="p-3 text-right font-mono font-black text-emerald-500">Shown by product or route</td>
                    <td className="p-3 text-xs text-muted-foreground">User-signed paths expose the transaction before approval. Autonomous strategies disclose their separate fee rules and use their worker wallet for execution.</td>
                  </tr>
                </tfoot>
              </table>
            </div>
             <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 mb-6">
                <h3 className="text-base font-bold text-foreground mb-2">Automated Bot Fees</h3>
               <p className="text-sm text-muted-foreground leading-relaxed">
                   Swing Bot locks a platform rate from its displayed deposit tier—currently
                  <strong className="text-foreground"> 1.0% to 1.6%</strong>, with 1.6% as the default
                   when no higher tier is established. Paper mode deducts the applicable amount from the
                   simulated starting bankroll. Live Swing fees are deferred to profitable round trips;
                   losing closes pay no platform fee, the fee cannot exceed the profit, and collection
                   failure proceeds in the user's favor. Autonomous DCA strategies may charge a one-time
                   0.002 SOL setup fee for each additional rotation wallet. Product fees remain separate
                   from Access Pass pricing and from provider, venue and network costs.
               </p>
             </div>

             <h3 className="text-base font-bold text-foreground mb-3">Fee Recipients &amp; Roadmap to Decentralization</h3>
            <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-4 mb-4">
              <p className="text-xs text-yellow-700 dark:text-yellow-400 leading-relaxed mb-2">
                 <span className="font-bold">Current state (interim):</span> applicable platform fees route to configured on-chain recipients and are publicly auditable after settlement. A manual, user-signed path exposes included transfers before approval. Autonomous strategies instead sign through their isolated worker wallets and disclose their accounting rules in-product. Current recipients are not yet controlled by an active DAO.
              </p>
              <p className="text-xs text-yellow-700 dark:text-yellow-400 leading-relaxed">
                 <span className="font-bold">Target state:</span> move eligible community-treasury control toward multisignature and, later, on-chain governance subject to security review, community agreement and implementation. The exact voting, quorum and signer design is not live and may change.
              </p>
            </div>

            <h3 className="text-base font-bold text-foreground mb-3">How Fees Are Collected (Technical)</h3>
            <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
              For applicable manual paths, PAIF requests or constructs an unsigned Solana transaction and
              the connected wallet signs it. For live autonomous Swing and DCA strategies, the isolated
              strategy worker signs transactions after the owner has authorized and funded that worker.
              PumpAPI-built transactions are restricted to approved Solana programs and validated for
              expected inputs, output protection, compute limits and fee recipients before submission.
              Jupiter transactions remain subject to the quoted route and normal wallet review.
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              PAIF platform fees, PumpAPI provider fees, venue charges, priority fees and Solana base fees
              are distinct costs. A successful signature proves transaction inclusion, not a guaranteed
              profit or ideal execution price. Any future community vote over eligible PAIF fee parameters
              depends on governance infrastructure that has not yet launched.
            </p>
          </section>

          {/* Roadmap */}
          <SectionAnchor id="roadmap" />
          <section className="mb-12">
            <h2 className="text-2xl font-black text-foreground mb-6">7. Roadmap</h2>

            <div className="relative space-y-0">
              {[
                {
                  phase: "Phase 1",
                  title: "Foundation",
                  status: "complete",
                  quarter: "Q1 2026",
                  items: [
                    "Token Scanner with creator risk scoring",
                    "Solana Wallet Search",
                    "Jupiter-based manual swap routing",
                    "PumpAPI-first execution for supported pools, with validated fallback routes",
                    "Launch Signals with fresh-launch presets and filters",
                    "Token Scanner with multi-source market and on-chain evidence",
                    "Pump.fun Hackathon 2026 Q1 submission",
                  ],
                },
                {
                  phase: "Phase 2",
                  title: "Trading Automation & Intelligence",
                  status: "active",
                  quarter: "Q2 2026",
                  items: [
                    "Swing Bot with Watch My Token mode",
                    "Autonomous DCA, Trade, and Volume strategy modes",
                    "Creator Activity history, leaderboards, and wallet scans",
                    "Verified Solana tokenized-stock discovery",
                    "Paper-only xStocks Swing Bot simulation",
                    "Paper-first arbitrage scanning and execution tools",
                    "Wallet-level Access Passes and one-time trial",
                    "Evidence definitions integrated into Learn Crypto and product tools",
                    "Mobile-optimized trading and research workflows",
                  ],
                },
                {
                  phase: "Phase 3",
                  title: "Governance & Ecosystem",
                  status: "upcoming",
                  quarter: "Q3–Q4 2026",
                  items: [
                    "DAO on-chain voting with $PAIF token",
                    "Community treasury deployment",
                    "API access tier for developers",
                    "Partner integrations with data providers and launch platforms",
                    "Expanded Solana market coverage as verified sources become available",
                  ],
                },
              ].map((phase, i) => (
                <div key={phase.phase} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-black flex-shrink-0 ${
                      phase.status === "complete"
                        ? "bg-emerald-500 border-emerald-500 text-white"
                        : phase.status === "active"
                        ? "bg-background border-emerald-500 text-emerald-500"
                        : "bg-background border-border text-muted-foreground"
                    }`}>
                      {i + 1}
                    </div>
                    {i < 2 && <div className="w-0.5 flex-1 bg-border my-1" />}
                  </div>
                  <div className={`pb-8 flex-1 ${i === 2 ? "pb-0" : ""}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-muted-foreground">{phase.phase}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        phase.status === "complete"
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          : phase.status === "active"
                          ? "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                          : "bg-muted text-muted-foreground"
                      }`}>
                        {phase.status === "complete" ? "Complete" : phase.status === "active" ? "In Progress" : "Upcoming"}
                      </span>
                      <span className="text-[10px] text-muted-foreground ml-auto">{phase.quarter}</span>
                    </div>
                    <h3 className="text-base font-bold text-foreground mb-3">{phase.title}</h3>
                    <ul className="space-y-1.5">
                      {phase.items.map((item) => (
                        <li key={item} className="flex items-start gap-2">
                          <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                            phase.status === "complete" ? "bg-emerald-500" : phase.status === "active" ? "bg-blue-500" : "bg-muted-foreground/40"
                          }`} />
                          <span className="text-sm text-muted-foreground">{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* DAO */}
          <SectionAnchor id="dao" />
          <section className="mb-12">
            <h2 className="text-2xl font-black text-foreground mb-4">8. Community & Governance</h2>
            <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
              PAIF is developing community-governance tools, but an on-chain DAO is not active today. Current discussion can inform product direction; binding proposal, voting, treasury and execution rules require separate implementation and security review.
            </p>
            <div className="space-y-4">
              {[
                {
                  title: "Proposal System",
                  desc: "A future proposal system may let eligible community members suggest fee changes, feature priorities, treasury spending, or protocol upgrades. Eligibility rules and proposal powers are not yet live.",
                },
                {
                  title: "On-Chain Voting",
                  desc: "On-chain voting, token weighting, snapshots, voting periods and quorum rules remain design goals rather than active platform guarantees.",
                },
                {
                  title: "Community Treasury",
                  desc: "A future community-controlled treasury may support approved ecosystem work. Current fee recipients are configured operationally and are not yet governed by binding DAO votes.",
                },
                {
                  title: "Current Phase",
                  desc: "Governance is currently limited to non-binding community discussion in the Forum and Telegram. No fixed launch date or final governance design is guaranteed.",
                },
              ].map((item) => (
                <div key={item.title} className="rounded-lg border border-border p-4">
                  <h3 className="text-sm font-bold text-foreground mb-1">{item.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Disclaimer */}
          <SectionAnchor id="disclaimer" />
          <section className="mb-12">
            <h2 className="text-2xl font-black text-foreground mb-4">Disclaimer</h2>
            <div className="rounded-xl border border-border bg-muted/30 p-5 space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                This whitepaper is for informational purposes only and does not constitute financial, investment, tax or legal advice or a solicitation to buy or sell any asset. $PAIF is the platform's ecosystem token; this document does not make a legal classification or guarantee future utility, access rights or governance powers.
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Cryptocurrency and DeFi investments are highly speculative and carry significant risk of loss. Past performance of any token, trading strategy, or platform feature is not indicative of future results. Users should conduct their own research and consult a qualified financial advisor before making any investment decisions.
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                The PAIF platform is in active development. Features described in the roadmap are subject to change. Data and execution depend on third parties including PumpAPI, PumpPortal, Jupiter, Helius, Solana RPC providers, DexScreener, GeckoTerminal, CoinGecko, and MoonPay. Their roles differ by feature, and a free data tier does not imply fee-free execution. Streams, APIs and terms may change, lag, disconnect, become incomplete, impose quotas, or stop being available. PAIF does not guarantee first-block delivery, complete coverage, uninterrupted uptime, quote accuracy, or transaction landing.
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Manual and browser-wallet transactions require explicit user approval. Live autonomous bots instead operate isolated, user-funded worker wallets whose private keys are encrypted on the server and whose trades do not require a separate wallet prompt each time. Users retain the recorded withdrawal destination but accept limited-custody, key-management, provider, market, and smart-contract risks while funds remain in a worker wallet. PAIF cannot reverse, refund, or recover confirmed on-chain transactions.
              </p>
            </div>
          </section>

          {/* Footer row */}
          <div className="border-t border-border pt-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-bold text-foreground">PAIF — paif.fun</p>
              <p className="text-[11px] text-muted-foreground">© 2026 PAIF. All rights reserved.</p>
            </div>
            <div className="flex gap-3">
              <a href="https://x.com/PAIFaiFUN" target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline" data-testid="link-footer-twitter">X / Twitter</a>
              <a href="https://t.me/paifaifun" target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline" data-testid="link-footer-telegram">Telegram</a>
              <Link href="/privacy" className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline" data-testid="link-footer-privacy-wp">Privacy</Link>
            </div>
          </div>

        </main>
      </div>

      {/* Back to top */}
      {showBackToTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-6 right-6 w-9 h-9 rounded-full bg-foreground text-background flex items-center justify-center shadow-lg hover:opacity-80 transition-opacity z-50"
          data-testid="button-back-to-top"
        >
          <ArrowUp className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
