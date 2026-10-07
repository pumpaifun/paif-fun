import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Check, Gamepad2, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { Header, navItems } from "@/components/header";
import { Footer } from "@/components/footer";
import { MarketWeatherCard } from "@/components/market-weather-card";
import { ScannerSearch } from "@/components/scanner-search";
import { TrendingTicker } from "@/components/trending-ticker";
import { TrendingXStocksTicker } from "@/components/trending-xstocks-ticker";
import mascotImage from "@assets/D5AFF079-246D-49E0-AA64-454B873751AC_1771641179413.png";
import pumpApiLion from "@assets/pumpapi-lion-transparent.png";

function MarketChart() {
  const { data: weather } = useQuery<{
    available: boolean;
    solChg24?: number;
    nasdaqChg1d?: number | null;
    mood?: "red" | "green" | "mixed";
  }>({
    queryKey: ["/api/swing-bot/market-weather"],
    refetchInterval: 2 * 60 * 1000,
  });
  // The card shows Solana and Nasdaq, so the artwork must follow those same
  // visible numbers. The broader mood also includes Bitcoin and uses ±2%
  // thresholds, which can say "mixed" even while both displayed markets fall.
  const solIsDown = weather?.available && Number.isFinite(weather.solChg24) && weather.solChg24! < 0;
  const nasdaqIsKnown = weather?.available && Number.isFinite(weather.nasdaqChg1d);
  const nasdaqIsDown = nasdaqIsKnown && weather.nasdaqChg1d! < 0;
  const isNegative = Boolean(solIsDown && (!nasdaqIsKnown || nasdaqIsDown));
  const chartColor = isNegative ? "#ef6262" : "#50d890";
  const barColor = isNegative ? "#f27a7a" : "#61dfa0";
  const linePath = isNegative
    ? "M0 40 C56 60 66 34 112 86 S180 64 224 118 S286 94 324 152 S377 124 417 180 S483 148 518 204 S585 180 640 238"
    : "M0 220 C56 200 66 226 112 182 S180 205 224 154 S286 180 324 112 S377 145 417 92 S483 124 518 60 S585 83 640 22";
  const fillPath = `${linePath} V260 H0Z`;
  const bars = isNegative
    ? [{x:55,y:22,h:44},{x:118,y:27,h:68},{x:181,y:60,h:31},{x:244,y:76,h:64,arm:true},{x:307,y:104,h:28},{x:370,y:99,h:75},{x:433,y:103,h:35,arm:true,noWick:true},{x:496,y:146,h:70,mascot:true},{x:559,y:150,h:34,arm:true,noWick:true}]
    : [{x:55,y:194,h:44},{x:118,y:165,h:68},{x:181,y:169,h:31},{x:244,y:126,h:64,arm:true},{x:307,y:128,h:28},{x:370,y:86,h:75},{x:433,y:76,h:35,arm:true,noWick:true},{x:496,y:44,h:70,mascot:true},{x:559,y:32,h:34,arm:true,noWick:true}];
  return (
    <div className="relative overflow-hidden rounded-[1.35rem] border border-border bg-card p-4 shadow-xl shadow-emerald-950/10 dark:border-emerald-400/20 dark:bg-[hsl(157_29%_10%)] dark:shadow-2xl dark:shadow-emerald-950/20 sm:p-6" data-testid="home-market-chart">
      <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(hsl(151_73%_43%/.35)_1px,transparent_1px),linear-gradient(90deg,hsl(151_73%_43%/.35)_1px,transparent_1px)] [background-size:44px_44px] dark:opacity-20" />
      <svg className="relative h-48 w-full sm:h-64" viewBox="0 0 640 260" fill="none" aria-label={`Simulated ${isNegative ? "downward" : "upward"} Solana market chart`}>
        <path d={linePath} stroke={chartColor} strokeWidth="4" />
        <path d={fillPath} fill="url(#chartFill)" opacity=".28" />
        {bars.map((bar, i) => {
          const bodyHeight = bar.h * (bar.mascot ? .88 : bar.arm ? .62 : .55);
          const isArm = bar.arm === true;
          return (
            <g key={i}>
              {!bar.noWick && <line x1={bar.x} x2={bar.x} y1={bar.mascot ? bar.y : bar.y - (isArm ? 12 : 16)} y2={bar.y + (isArm ? bodyHeight + 9 : bar.h)} stroke={barColor} strokeWidth={bar.mascot || isArm ? 4 : 3}/>}
              <rect x={bar.x - (bar.mascot || isArm ? 9 : 7)} y={bar.y} width={bar.mascot || isArm ? 18 : 14} height={bodyHeight} fill={barColor} rx={bar.mascot || isArm ? 6 : 2}/>
            </g>
          );
        })}
        <defs><linearGradient id="chartFill" x1="320" y1="20" x2="320" y2="260" gradientUnits="userSpaceOnUse"><stop stopColor={chartColor}/><stop offset="1" stopColor={chartColor} stopOpacity="0"/></linearGradient></defs>
      </svg>
      <div className="relative z-10 mt-2 flex h-20 items-end gap-2 sm:h-24">
        <div className="min-w-0 flex-1 overflow-hidden" data-testid="home-market-weather">
          <div className="w-full max-w-xl sm:w-[28rem]">
            <MarketWeatherCard embedded />
          </div>
        </div>
        <img src={mascotImage} alt="PAIF candle mascot" className="h-20 w-16 object-contain object-bottom sm:h-24 sm:w-20" data-testid="img-mascot" />
      </div>
    </div>
  );
}

function HomeExploreLinks() {
  return (
    <nav className="mx-auto mt-6 max-w-3xl border-t border-border pt-5 text-center" aria-label="Explore PAIF">
      <p className="font-mono text-xs font-bold uppercase tracking-[.16em] text-muted-foreground">Explore</p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
        <Link href="/tokenized-stocks?view=trending" className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-700 underline underline-offset-4 dark:text-emerald-300" data-testid="home-xstocks-link">Tokenized stocks <ArrowUpRight className="h-3.5 w-3.5"/></Link>
        <Link href="/creators" className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-700 underline underline-offset-4 dark:text-emerald-300" data-testid="home-creator-activity-link">Creator activity <ArrowUpRight className="h-3.5 w-3.5"/></Link>
        <Link href="/crypto-leaderboard?view=trending" className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-700 underline underline-offset-4 dark:text-emerald-300" data-testid="link-home-new-launches">Crypto Leaderboard <ArrowUpRight className="h-3.5 w-3.5"/></Link>
      </div>
    </nav>
  );
}

export default function Home() {
  return (
    <div className="home-page min-h-[100dvh] bg-background text-foreground">
      <Header />
      <div className="sticky top-14 z-[9998] shadow-sm" data-testid="home-sticky-trending">
        <TrendingTicker />
        <TrendingXStocksTicker />
      </div>
      <main className="overflow-hidden">
        <section className="relative border-b border-border bg-background dark:bg-[hsl(157_29%_10%)] sm:bg-transparent">
          <div className="absolute inset-x-0 top-0 h-56 bg-[radial-gradient(ellipse_at_top,hsl(151_73%_43%/.18),transparent_70%)]" />
           <div className="relative z-10 mx-auto grid max-w-6xl min-w-0 gap-8 px-4 py-10 sm:gap-10 sm:px-6 sm:py-12 lg:grid-cols-[.95fr_1.05fr] lg:items-center lg:gap-12 lg:py-20">
             <div id="scanner" className="order-2 min-w-0 lg:order-2 lg:pl-2">
                 <h1 className="max-w-lg font-serif text-5xl font-bold leading-[.96] tracking-[-.055em] text-foreground dark:text-white sm:text-6xl md:text-[3rem]" data-testid="text-hero-title">Trade smarter,<br/><span>not harder.</span></h1>
                 <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground" data-testid="text-home-positioning">
                     Built for traders navigating the Solana network. Let PAIF scan new launches, study creator activity, and save you time with autonomous bots that follow the rules you choose.
                 </p>
                <div className="mt-8 max-w-xl">
                    <p className="font-mono text-base uppercase tracking-[.16em] text-emerald-700 dark:text-emerald-300">Token scanner</p>
                    <h2 className="mt-2 font-serif text-3xl font-bold tracking-tight sm:text-4xl">Check a token before you trade</h2>
                     <p className="mt-2 text-base leading-relaxed text-muted-foreground">Scan a Solana token, paste its pump.fun URL, or look up an issuer-verified Solana xStock.</p>
                     <label className="mb-2 mt-5 block text-base font-bold text-muted-foreground">Token contract address, pump.fun URL, or verified xStock</label>
                   <ScannerSearch
                     inputClassName="h-11"
                     buttonClassName="h-11 px-5 font-bold"
                      placeholder="Paste a contract address, pump.fun URL, or verified xStock"
                   />
                </div>
            </div>
              <div className="order-1 min-w-0 lg:order-1">
                 <p className="relative z-10 mb-3 text-center font-mono text-lg font-black uppercase tracking-[.14em] text-emerald-700 dark:text-emerald-300 sm:text-2xl lg:text-3xl" data-testid="text-brand-meaning">
                 PAIF · PUMP AI FUN
               </p>
               <MarketChart />
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Link
                    href="/tokenized-stocks"
                    className="group flex min-h-12 items-center justify-between rounded-xl border border-border bg-card/80 px-4 py-3 text-sm font-bold text-foreground transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/5"
                    data-testid="link-home-xstock-leaderboard"
                  >
                    <span>xStock Leaderboard</span>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-emerald-600 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  </Link>
                  <Link
                    href="/crypto-leaderboard?view=trending"
                    className="group flex min-h-12 items-center justify-between rounded-xl border border-border bg-card/80 px-4 py-3 text-sm font-bold text-foreground transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/5"
                    data-testid="link-home-crypto-leaderboard"
                  >
                    <span>Crypto Leaderboard</span>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-emerald-600 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  </Link>
                </div>
             </div>
          </div>
        </section>
          <section className="mx-auto max-w-6xl px-4 pb-3 pt-8 sm:px-6 md:pt-10">
           <div className="relative overflow-hidden rounded-[1.35rem] border border-border bg-card p-6 sm:p-8">
             <div className="absolute -left-20 -top-24 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />
             <div className="relative grid gap-7 md:grid-cols-[1fr_auto] md:items-center">
               <div>
                   <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-600/20 bg-emerald-500/10 px-3 py-1.5 font-mono text-sm font-medium uppercase tracking-[.15em] text-emerald-700 dark:text-emerald-300">
                   <ShieldCheck className="h-3.5 w-3.5" /> Swing Bot
                 </div>
                 <h2 className="font-serif text-3xl font-bold tracking-tight sm:text-4xl">Automated swing trading</h2>
                    <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground"><strong className="text-foreground">Swing Bot</strong> scans the Solana blockchain for tokens with active trading and price movement, then applies your strategy to identify potential swing trades.</p>
                 <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-muted-foreground">
                   <span className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-emerald-600"/>Non-custodial</span>
                   <span className="flex items-center gap-1.5"><Zap className="h-4 w-4 text-emerald-600"/>Built for Solana</span>
                 </div>
               </div>
               <Link href="/swing-bot" className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-bold text-primary-foreground transition-transform hover:-translate-y-0.5">
                 Start the Swing Bot <ArrowUpRight className="h-4 w-4"/>
               </Link>
             </div>
           </div>
         </section>
        <section className="mx-auto max-w-6xl px-4 py-3 sm:px-6">
          <div className="relative overflow-hidden rounded-[1.35rem] border border-border bg-card p-6 sm:p-8">
            <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl" />
            <div className="relative grid gap-7 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-600/20 bg-emerald-500/10 px-3 py-1.5 font-mono text-sm font-medium uppercase tracking-[.15em] text-emerald-700 dark:text-emerald-300">
                  <Gamepad2 className="h-3.5 w-3.5" /> Arcade PAIF
                </div>
                <h2 className="font-serif text-3xl font-bold tracking-tight sm:text-4xl">Play the market arcade</h2>
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  Compare visible market lanes, ring the bell on your pick, and see which lane Alpha PAIF considers strongest.
                </p>
                <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-muted-foreground">
                  <span className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-emerald-600" />Paper mode available</span>
                  <span className="flex items-center gap-1.5"><Check className="h-4 w-4 text-emerald-600" />Alpha lane review</span>
                </div>
              </div>
              <Link href="/paif-invaders" className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-bold text-primary-foreground transition-transform hover:-translate-y-0.5" data-testid="link-home-arcade-paif">
                Open Arcade PAIF <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>
        <section className="mx-auto max-w-6xl px-4 pb-10 pt-3 sm:px-6">
          <div className="relative overflow-hidden rounded-[1.35rem] border border-border bg-card p-6 text-foreground shadow-sm dark:border-emerald-400/20 dark:bg-[hsl(157_29%_10%)] dark:text-emerald-50 sm:p-8">
            <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-emerald-400/10 blur-3xl" />
            <div className="relative grid gap-7 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-600/20 bg-emerald-500/10 px-3 py-1.5 font-mono text-sm font-medium uppercase tracking-[.15em] text-emerald-700 dark:border-emerald-300/20 dark:text-emerald-300">
                  <Zap className="h-3.5 w-3.5" /> Sniper Bot
                </div>
                  <h2 className="font-serif text-3xl font-bold tracking-tight sm:text-4xl">Buy new launches</h2>
                 <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground dark:text-emerald-50/65">Monitor live Solana launches, apply your filters, and execute trades yourself or with the autonomous Sniper Bot.</p>
                <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-muted-foreground dark:text-emerald-100/70">
                  <span className="flex items-center gap-1.5"><Check className="h-4 w-4 text-emerald-500 dark:text-emerald-400"/>Live launch feed</span>
                  <span className="flex items-center gap-1.5"><Check className="h-4 w-4 text-emerald-500 dark:text-emerald-400"/>Custom risk filters</span>
                  <span className="flex items-center gap-1.5"><Check className="h-4 w-4 text-emerald-500 dark:text-emerald-400"/>Manual or automated scanning</span>
                </div>
              </div>
              <Link href="/sniper-bot" className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-emerald-400 px-5 text-sm font-bold text-emerald-950 transition-transform hover:-translate-y-0.5" data-testid="link-home-sniper-bot">
                Explore Sniper Bot <ArrowUpRight className="h-4 w-4"/>
              </Link>
            </div>
          </div>
        </section>
          <section className="mx-auto max-w-6xl px-4 py-14 text-center sm:px-6"><Sparkles className="mx-auto h-5 w-5 text-emerald-600"/><h2 className="mt-4 font-serif text-3xl font-bold tracking-tight sm:text-4xl">A smarter way to trade.</h2><p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">PAIF assists by monitoring the market and executing your strategy autonomously.</p><div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-3"><Link href="/swing-bot" className="inline-flex items-center gap-2 text-sm font-bold text-emerald-700 underline underline-offset-4 dark:text-emerald-300">Start the Swing Bot <ArrowUpRight className="h-4 w-4"/></Link><Link href="/sniper-bot" className="inline-flex items-center gap-2 text-sm font-bold text-emerald-700 underline underline-offset-4 dark:text-emerald-300">Start the Sniper Bot <ArrowUpRight className="h-4 w-4"/></Link><Link href="/vaults" className="inline-flex items-center gap-2 text-sm font-bold text-emerald-700 underline underline-offset-4 dark:text-emerald-300">Start the Autonomous DCA Bot <ArrowUpRight className="h-4 w-4"/></Link></div><HomeExploreLinks /></section>
        <section className="mx-auto max-w-6xl px-4 sm:px-6" aria-labelledby="partners-heading">
          <div className="flex flex-col gap-3 border-y border-border py-3 sm:flex-row sm:items-center sm:gap-6">
            <div className="shrink-0 sm:w-40">
              <p className="font-mono text-sm font-medium uppercase tracking-[.18em] text-muted-foreground">Ecosystem</p>
              <h2 id="partners-heading" className="mt-1 text-sm font-bold text-foreground">Official partners</h2>
            </div>
            <div className="min-w-0 flex-1" role="list">
            <a
              href="https://pumpapi.io"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f47721] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              data-testid="link-partner-pumpapi"
              role="listitem"
              aria-label="Visit PumpAPI, official ecosystem partner (opens in a new tab)"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#f47721]/10">
                <img src={pumpApiLion} alt="" className="h-12 w-12 max-w-none object-contain" />
              </span>
              <span className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-4">
                <span className="block text-base font-extrabold text-foreground">PumpAPI</span>
                <span className="block text-sm leading-relaxed text-muted-foreground">Market intelligence meets dependable launch infrastructure for faster, clearer Solana decisions.</span>
              </span>
              <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[#f47721]" aria-hidden="true" />
            </a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}