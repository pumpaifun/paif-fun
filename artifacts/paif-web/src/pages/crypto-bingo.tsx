import { useState, useMemo, useEffect, useCallback } from "react";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dices, RotateCcw, Info, Shuffle, Trophy, Sparkles,
  Rocket, AlertTriangle, Landmark, Flame, Coins, PiggyBank, LineChart,
} from "lucide-react";

type BingoCell = { label: string; tip: string };

type Deck = {
  id: string;
  name: string;
  tagline: string;
  icon: typeof Rocket;
  /** Tailwind text color for the deck accent. */
  accent: string;
  /** Tailwind classes applied to a checked cell that sits on a winning line. */
  lineClass: string;
  /** Center free-space cell. */
  free: BingoCell;
  /** Themed cell pool (>= 24). buildBoard shuffles and takes 24 around the free space. */
  cells: BingoCell[];
  /** Headline shown when the player completes a line. */
  bingoTitle: string;
};

// ── Decks ────────────────────────────────────────────────────────────────────

const MOON: BingoCell[] = [
  { label: "To the moon 🚀", tip: "The price is ripping straight up — everyone's calling for the moon." },
  { label: "Wen lambo", tip: "The classic 'when do I get rich?' chant during a green run." },
  { label: "Diamond hands 💎", tip: "Holders refusing to sell no matter how violent the candles." },
  { label: "Aped in", tip: "Bought aggressively without much research because it was pumping." },
  { label: "Did a 2x", tip: "The price doubled from where it was being watched." },
  { label: "Did a 10x", tip: "A tenfold move — the dream entry everyone screenshots." },
  { label: "New ATH", tip: "A fresh all-time-high print on the chart." },
  { label: "Paper hands sold", tip: "Weak holders panic-sold right before another leg up." },
  { label: "FOMO kicked in", tip: "Fear of missing out drags in a wave of late buyers." },
  { label: "Whale bought", tip: "A large wallet scooped a big bag and moved the chart." },
  { label: "Trending #1", tip: "The token hit the top of a trending list and got eyeballs." },
  { label: "Graduated 🎓", tip: "The bonding curve filled and it migrated to a real DEX pool." },
  { label: "Influencer shilled", tip: "A big account posted the ticker and volume spiked." },
  { label: "Green wall", tip: "A solid run of green candles with barely a wick." },
  { label: "Bought the dip", tip: "Someone caught the pullback before the next push." },
  { label: "HODL gang", tip: "The community rallying to hold and not sell." },
  { label: "Volume exploded", tip: "Trading volume multiplied in minutes — real attention arrived." },
  { label: "CT noticed", tip: "Crypto Twitter started posting about it en masse." },
  { label: "Mcap > $1M", tip: "Market cap crossed the seven-figure milestone." },
  { label: "TG going crazy", tip: "The Telegram chat is a wall of rockets and gm's." },
  { label: "Number go up", tip: "The only fundamental that matters in a pump — NGU." },
  { label: "Floor rising", tip: "The price keeps setting higher lows — a climbing floor." },
  { label: "Snipers in profit", tip: "Early bots that bought block-zero are deep in the green." },
  { label: "Send it 🫡", tip: "The rally cry to keep buying and push it higher." },
];

const RUG: BingoCell[] = [
  { label: "Creator bridged fees", tip: "Dev moved trading fees to a CEX or another chain — taking money off the table." },
  { label: "Liquidity pulled", tip: "The LP was removed, so holders can no longer sell at a fair price." },
  { label: "Snipers dumped", tip: "Bots that bought in block 0 sold into early buyers." },
  { label: "Telegram deleted", tip: "The community channel vanished — classic exit move." },
  { label: "Website offline", tip: "The project site is down or was never real." },
  { label: "Dev sold 100%", tip: "The creator wallet dumped its entire bag." },
  { label: "Top 10 hold >50%", tip: "A handful of wallets control most of the supply." },
  { label: "No locked LP", tip: "Liquidity isn't locked, so it can be pulled at any moment." },
  { label: "Fake renounce", tip: "\"Ownership renounced\" but a hidden authority remains." },
  { label: "Twitter deleted", tip: "The official account was wiped after launch." },
  { label: "Paid shillers only", tip: "All the hype comes from paid callers, not real holders." },
  { label: "Mint authority live", tip: "Dev can still mint new tokens and dilute you." },
  { label: "Anon dev, no doxx", tip: "No identifiable team — zero accountability if it rugs." },
  { label: "Honeypot", tip: "You can buy but the contract blocks selling." },
  { label: "Copy-paste contract", tip: "Code is a clone of a known scam template." },
  { label: "Fake volume bots", tip: "Wash trading inflates volume to look alive." },
  { label: "Team tokens unlocked", tip: "Team allocation has no vesting — instant dump risk." },
  { label: "Sudden 90% dump", tip: "Price collapsed in minutes on heavy sell pressure." },
  { label: "Discord nuked", tip: "Server deleted or members banned to hide the exit." },
  { label: "1 CEX funded whales", tip: "Top wallets were all funded from the same withdrawal — investigate the shared source." },
  { label: "Roadmap = emojis", tip: "No real plan, just rocket and moon emojis." },
  { label: "LP under 5 SOL", tip: "Liquidity is so thin one sell tanks the chart." },
  { label: "Copies a trend", tip: "Name/ticker rides a hot coin to bait searchers." },
  { label: "Reused rug wallet", tip: "Creator wallet is tied to previous rugs." },
];

const GOVSEC: BingoCell[] = [
  { label: "SEC lawsuit filed", tip: "The regulator formally sues a project or exchange." },
  { label: "Gensler tweet", tip: "The SEC chair posts something that moves the market." },
  { label: "'It's a security'", tip: "The line every project dreads hearing about its token." },
  { label: "Howey test cited", tip: "The legal test used to decide if something is a security." },
  { label: "Subpoena issued", tip: "A legal demand for documents or testimony lands." },
  { label: "Wells notice", tip: "A heads-up from the SEC that charges may be coming." },
  { label: "Congress hearing", tip: "Lawmakers grill crypto execs on live TV." },
  { label: "ETF delayed", tip: "A spot ETF decision gets pushed back again." },
  { label: "ETF approved", tip: "A spot ETF finally gets the green light." },
  { label: "Exchange delisting", tip: "A token gets pulled from a major exchange." },
  { label: "KYC required", tip: "New 'know your customer' rules tighten access." },
  { label: "Stablecoin bill", tip: "Legislation aimed specifically at stablecoins." },
  { label: "CBDC mentioned", tip: "A central-bank digital currency makes headlines." },
  { label: "Treasury crackdown", tip: "The Treasury department targets a crypto activity." },
  { label: "Tax form drops", tip: "New reporting forms or rules for crypto gains." },
  { label: "Mixer sanctioned", tip: "A privacy tool gets added to a sanctions list." },
  { label: "Travel rule", tip: "Rules forcing identity sharing on transfers." },
  { label: "'Not legal advice'", tip: "The disclaimer everyone slaps on regulatory takes." },
  { label: "Banned in a country", tip: "A nation outlaws trading or mining outright." },
  { label: "OFAC list", tip: "An address or entity gets sanctioned." },
  { label: "MiCA compliance", tip: "Europe's crypto framework comes up again." },
  { label: "Investigation opened", tip: "A regulator confirms it's probing a firm." },
  { label: "Settlement reached", tip: "A project pays a fine to make charges go away." },
  { label: "'Regulatory clarity'", tip: "The thing everyone asks for and never quite gets." },
];

const DEGEN: BingoCell[] = [
  { label: "Bought the top", tip: "Aped in at the exact local high. It happens to everyone." },
  { label: "Sold the bottom", tip: "Panic-sold at the lowest point right before the bounce." },
  { label: "Liquidated 💀", tip: "A leveraged position got wiped out by a wick." },
  { label: "Revenge trade", tip: "Trying to win back a loss with a bigger, dumber bet." },
  { label: "100x leverage", tip: "Maximum leverage — one tick away from zero." },
  { label: "Gm gm ☀️", tip: "The daily 'good morning' ritual of crypto chats." },
  { label: "Ngmi", tip: "'Not gonna make it' — the self-aware degen lament." },
  { label: "Wagmi", tip: "'We're all gonna make it' — peak copium optimism." },
  { label: "Rugged again", tip: "Another token exit-scammed the holders." },
  { label: "Fat-finger order", tip: "Typo'd the amount or price on a trade." },
  { label: "Chasing the pump", tip: "Buying green candles after the move already happened." },
  { label: "Held to zero", tip: "Diamond-handed a coin all the way down to nothing." },
  { label: "Aped rent money", tip: "Bet funds that absolutely should not have been bet." },
  { label: "Slippage 99%", tip: "Got a brutal fill on a thin, illiquid token." },
  { label: "MEV sandwiched", tip: "A bot front-and-back-ran the trade for profit." },
  { label: "Gas > trade", tip: "Paid more in network fees than the trade was worth." },
  { label: "Wrong network", tip: "Sent funds on a chain the receiver can't access." },
  { label: "Seed phrase lost", tip: "The recovery words are gone — and so are the funds." },
  { label: "Scam DM clicked", tip: "Fell for a 'support' message draining the wallet." },
  { label: "Fake airdrop", tip: "Connected to a malicious 'claim' site." },
  { label: "Copium overdose", tip: "Inventing reasons a dead bag will recover." },
  { label: "Down bad 📉", tip: "Portfolio is deep red and the cope is strong." },
  { label: "Touch grass (never)", tip: "Promised to log off, opened the charts again." },
  { label: "One more trade", tip: "The famous last words before the next blow-up." },
];

const PUMPFUN: BingoCell[] = [
  { label: "Dev sniped own coin", tip: "The creator bought their own launch in block zero." },
  { label: "Curve filled", tip: "The bonding curve hit 100% and triggered migration." },
  { label: "Migrated to DEX", tip: "Graduated off the launchpad onto a real liquidity pool." },
  { label: "Coordinated buys", tip: "Several wallets bought in a tight window — timing alone does not prove coordination." },
  { label: "Same-block buys", tip: "Multiple buys landed in one block — timing alone does not prove a bundle." },
  { label: "Streamer launched", tip: "A live streamer spun up a coin on camera." },
  { label: "Same dev, 5th try", tip: "The creator has launched (and dumped) many before." },
  { label: "Comment bots", tip: "The chat is full of copy-paste bot hype." },
  { label: "Ticker copied trend", tip: "Name rides whatever's hot to bait searches." },
  { label: "100 holders fast", tip: "Holder count spiked suspiciously quickly." },
  { label: "King of the hill", tip: "Briefly topped the launchpad's featured slot." },
  { label: "Insta-dumped", tip: "Pumped and dumped within the first few minutes." },
  { label: "AI-gen meme", tip: "The branding is obviously machine-generated." },
  { label: "Fake volume", tip: "Wash trades make it look more alive than it is." },
  { label: "Telegram CTO", tip: "'Community takeover' after the dev disappeared." },
  { label: "Dev replied in chat", tip: "Rare sighting — the creator actually showed up." },
  { label: "Whale exit wave", tip: "Several large wallets sold together into holders." },
  { label: "Reused old logo", tip: "Recycled art from a previous failed launch." },
  { label: "Pump then dump", tip: "The textbook two-act memecoin tragedy." },
  { label: "10 SOL liquidity", tip: "Liquidity so thin a single sell nukes the chart." },
  { label: "Animal mascot", tip: "Yet another cat/dog/frog memecoin." },
  { label: "Politician coin", tip: "A coin riding a politician's name or face." },
  { label: "Slow rug", tip: "A gradual bleed-out instead of a single pull." },
  { label: "Graduated & dumped", tip: "Migrated to a DEX, then the dev cashed out." },
];

const LOAN: BingoCell[] = [
  { label: "Checked credit score", tip: "Know your number before you borrow — it decides the rate you're offered." },
  { label: "Paid card in full", tip: "Clearing the whole balance every month means you owe zero interest." },
  { label: "Under 30% utilization", tip: "Keeping balances below 30% of your limit lifts your credit score." },
  { label: "On-time, every time", tip: "Payment history is the single biggest factor in your credit score." },
  { label: "Built emergency fund", tip: "3–6 months of expenses saved so you never borrow for a surprise." },
  { label: "Shopped for rates", tip: "Comparing a few lenders can save thousands over a loan's life." },
  { label: "Read the APR", tip: "APR is the true yearly cost — fees included — not just the headline rate." },
  { label: "Fixed vs variable", tip: "Fixed locks your rate for good; variable can climb with the market." },
  { label: "20% down payment", tip: "Putting 20% down on a home avoids costly mortgage insurance (PMI)." },
  { label: "Avoided PMI", tip: "PMI is an extra monthly fee you pay until you reach 20% equity." },
  { label: "Extra to principal", tip: "Paying extra straight to principal shrinks both the loan and the interest." },
  { label: "Biweekly payments", tip: "Half-payments every two weeks add up to one extra full payment a year." },
  { label: "Refinanced lower", tip: "Refinancing to a lower rate can cut years off a mortgage." },
  { label: "Picked 15-yr term", tip: "A shorter term means higher payments but far less total interest." },
  { label: "No prepay penalty", tip: "Confirm you can pay early without a fee before you ever sign." },
  { label: "Snowball / avalanche", tip: "Two proven debt plans: smallest balance first, or highest rate first." },
  { label: "Killed a credit card", tip: "Paid off and closed a high-interest balance for good." },
  { label: "DTI under 36%", tip: "Lenders favor a debt-to-income ratio below 36%." },
  { label: "Got pre-approved", tip: "A written pre-approval shows sellers you're a serious buyer." },
  { label: "Read the fine print", tip: "Origination fees, balloon payments, and clauses hide in the details." },
  { label: "Auto-pay set up", tip: "Automating payments protects your perfect on-time streak." },
  { label: "Mortgage-free 🎉", tip: "The house is fully paid off — no more payments, ever." },
  { label: "Interest works for you", tip: "Once compound interest is on your side, savings grow on their own." },
  { label: "Said no to a loan", tip: "The cheapest debt is the one you never took on." },
  // — Interest-rate literacy —
  { label: "Interest rate vs APR", tip: "The rate is the base cost; APR folds in fees for the true yearly cost." },
  { label: "Saw total interest", tip: "A loan's real cost is the principal PLUS every dollar of interest over its life." },
  { label: "Lower rate, less paid", tip: "Even 1% off a rate can save thousands across a long loan." },
  { label: "Locked the rate", tip: "Locking a mortgage rate protects you if rates climb before closing." },
  { label: "Read the amortization", tip: "Early payments are mostly interest; later ones mostly principal." },
  { label: "Compared total cost", tip: "A smaller monthly payment can still cost more if the term is longer." },
  { label: "Better score, lower rate", tip: "A higher credit score unlocks a cheaper interest rate." },
];

const INVEST: BingoCell[] = [
  { label: "Diversified portfolio", tip: "Spreading money across many assets means no single one can sink you." },
  { label: "Dollar-cost averaging", tip: "Investing a fixed amount on a schedule smooths out the market's ups and downs." },
  { label: "Bought an index fund", tip: "One fund can hold hundreds of stocks — instant diversification, low fees." },
  { label: "Read an earnings report", tip: "Quarterly results show how a company is actually performing." },
  { label: "Checked the P/E ratio", tip: "Price-to-earnings hints whether a stock is cheap or pricey vs its profits." },
  { label: "Set a stop-loss", tip: "An automatic sell order that caps how much a trade can lose." },
  { label: "Time in the market", tip: "Staying invested usually beats trying to time the perfect entry and exit." },
  { label: "Held through a dip", tip: "Markets fall and recover; panic-selling just locks in the loss." },
  { label: "Reinvested dividends", tip: "Putting payouts back in buys more shares and compounds your returns." },
  { label: "Knew the spread", tip: "In forex the gap between buy and sell price is your built-in cost." },
  { label: "Major currency pair", tip: "EUR/USD and friends are the most-traded, tightest-spread forex pairs." },
  { label: "Used a demo account", tip: "Practice with fake money before you risk real funds." },
  { label: "Risked only 1–2%", tip: "Pros risk a tiny slice of capital per trade to survive losing streaks." },
  { label: "Bull vs bear market", tip: "A bull market trends up; a bear market is down 20% or more." },
  { label: "Blue-chip stock", tip: "Large, established companies with a long, steady track record." },
  { label: "ETF over one stock", tip: "A basket fund spreads risk a single ticker simply can't." },
  { label: "Avoided the leverage trap", tip: "Borrowed money magnifies your losses just as much as your gains." },
  { label: "Compounding kicked in", tip: "Returns earning returns is the real engine of long-term wealth." },
  { label: "Ignored the hype", tip: "Hot tips from social media are how most beginners get burned." },
  { label: "Rebalanced portfolio", tip: "Resetting to your target mix locks in gains and keeps risk in check." },
  { label: "Long-term gains", tip: "Holding over a year often means a lower tax rate on profits." },
  { label: "Emergency fund first", tip: "Invest only money you won't need soon — cash cushion comes first." },
  { label: "Knew your risk profile", tip: "Match investments to how much swing you can actually stomach." },
  { label: "Pip moved your way", tip: "A pip is the smallest forex price move — and the unit of your P&L." },
  // — Crypto —
  { label: "Bitcoin halving", tip: "Every ~4 years BTC's new supply is cut in half — a key crypto cycle event." },
  { label: "Not your keys, not your coins", tip: "If you don't hold the private keys, you don't truly control the crypto." },
  { label: "Cold wallet storage", tip: "Keeping crypto offline shields it from exchange hacks." },
  { label: "Stablecoin parked", tip: "Holding value in a dollar-pegged coin to sit out the volatility." },
  { label: "Judged by market cap", tip: "Coin price means little without supply — compare market caps, not prices." },
  { label: "Earned staking yield", tip: "Locking crypto to help secure a network and earn rewards." },
  // — Money market & cash —
  { label: "Money market fund", tip: "A low-risk fund of short-term debt that parks cash for a modest yield." },
  { label: "High-yield savings", tip: "A savings account paying far more interest than a standard one." },
  { label: "Treasury bills", tip: "Short-term government debt — among the safest places to hold cash." },
  { label: "CD ladder", tip: "Staggering certificates of deposit so cash frees up at regular intervals." },
  { label: "Beat inflation", tip: "Aim for returns above inflation so your money keeps its real value." },
  { label: "Kept it liquid", tip: "Liquidity is how fast you can turn an asset into cash without a loss." },
];

const DECKS: Deck[] = [
  {
    id: "moon",
    name: "Moon Bingo",
    tagline: "Tap each hype signal as the chart sends. Line them up and you've got liftoff.",
    icon: Rocket,
    accent: "text-violet-500",
    lineClass: "bg-violet-500 text-white border-violet-500",
    free: { label: "Wen lambo 🏎️", tip: "Free space — there's always someone asking wen lambo." },
    cells: MOON,
    bingoTitle: "🚀 MOON BINGO — liftoff!",
  },
  {
    id: "rug",
    name: "Rug Bingo",
    tagline: "Tap every red flag you spot on a token. A full line is a funny — and useful — warning.",
    icon: AlertTriangle,
    accent: "text-red-500",
    lineClass: "bg-red-500 text-white border-red-500",
    free: { label: "Anon dev team 🥷", tip: "Free space — because there's always an anon dev somewhere." },
    cells: RUG,
    bingoTitle: "🚨 RUG BINGO — get out!",
  },
  {
    id: "govsec",
    name: "Gov / SEC Bingo",
    tagline: "Tap each regulatory headline as it drops. Line them up for peak 'this is fine' energy.",
    icon: Landmark,
    accent: "text-blue-500",
    lineClass: "bg-blue-500 text-white border-blue-500",
    free: { label: "'Not legal advice' ⚖️", tip: "Free space — the disclaimer on every regulatory hot take." },
    cells: GOVSEC,
    bingoTitle: "⚖️ GOV/SEC BINGO — regulated!",
  },
  {
    id: "degen",
    name: "Degen Bingo",
    tagline: "Tap each degen moment you've lived through. A full line means it's time to touch grass.",
    icon: Flame,
    accent: "text-orange-500",
    lineClass: "bg-orange-500 text-white border-orange-500",
    free: { label: "One more trade 🎰", tip: "Free space — the famous last words of every degen." },
    cells: DEGEN,
    bingoTitle: "🔥 DEGEN BINGO — touch grass!",
  },
  {
    id: "pumpfun",
    name: "Pump.fun Bingo",
    tagline: "Tap each launchpad cliché you spot. Line them up — you've seen this movie before.",
    icon: Coins,
    accent: "text-emerald-500",
    lineClass: "bg-emerald-500 text-white border-emerald-500",
    free: { label: "Animal mascot 🐸", tip: "Free space — there is always another animal memecoin." },
    cells: PUMPFUN,
    bingoTitle: "🎰 PUMP.FUN BINGO — seen it!",
  },
  {
    id: "loan",
    name: "Loan Bingo",
    tagline: "Learn smart-money moves the fun way. Tap each habit you've nailed — a full line is real financial health.",
    icon: PiggyBank,
    accent: "text-teal-500",
    lineClass: "bg-teal-500 text-white border-teal-500",
    free: { label: "Paid yourself first 💰", tip: "Free space — saving before you spend is money rule number one." },
    cells: LOAN,
    bingoTitle: "🏠 LOAN BINGO — debt-free!",
  },
  {
    id: "invest",
    name: "Invest Bingo",
    tagline: "Stocks, crypto, forex, money markets — tap each investing principle you've put into practice. A full line is a solid foundation.",
    icon: LineChart,
    accent: "text-indigo-500",
    lineClass: "bg-indigo-500 text-white border-indigo-500",
    free: { label: "Buy low, sell high 📈", tip: "Free space — easy to say, famously hard to do." },
    cells: INVEST,
    bingoTitle: "📈 INVEST BINGO — compounding!",
  },
];

const FREE_INDEX = 12;

// All winning lines (rows, columns, diagonals) as index arrays.
const LINES: number[][] = (() => {
  const lines: number[][] = [];
  for (let r = 0; r < 5; r++) lines.push([0, 1, 2, 3, 4].map((c) => r * 5 + c));
  for (let c = 0; c < 5; c++) lines.push([0, 1, 2, 3, 4].map((r) => r * 5 + c));
  lines.push([0, 6, 12, 18, 24]);
  lines.push([4, 8, 12, 16, 20]);
  return lines;
})();

const WINS_KEY = "paif:bingo:wins";

function readWins(): Record<string, number> {
  try {
    const raw = localStorage.getItem(WINS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    // Keep only finite, non-negative integer counts — guards against a
    // tampered or corrupted localStorage value producing NaN badges.
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
        clean[k] = Math.floor(v);
      }
    }
    return clean;
  } catch {
    return {};
  }
}

// Fisher–Yates shuffle on a copy.
function shuffled<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Build a 25-cell board: shuffle the deck pool, take 24, insert free at center.
function buildBoard(deck: Deck): BingoCell[] {
  const picked = shuffled(deck.cells).slice(0, 24);
  const out: BingoCell[] = [];
  let src = 0;
  for (let i = 0; i < 25; i++) {
    if (i === FREE_INDEX) out.push(deck.free);
    else out.push(picked[src++]);
  }
  return out;
}

const usd0 = (v: number) =>
  v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = (v: number) =>
  v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

// Live "what does interest really cost?" demo shown under the Loan deck.
// Standard amortized-loan math: fixed monthly payment over n months.
function LoanInterestCalculator() {
  const [amount, setAmount] = useState(20000);
  const [apr, setApr] = useState(7);
  const [years, setYears] = useState(5);

  const r = useMemo(() => {
    const P = Number.isFinite(amount) ? Math.max(0, amount) : 0;
    const rate = Number.isFinite(apr) ? Math.max(0, apr) : 0;
    const yrs = Number.isFinite(years) ? Math.max(0, years) : 0;
    const n = Math.max(1, Math.round(yrs * 12));
    const m = rate / 100 / 12;
    const monthly = m === 0 ? P / n : (P * m * Math.pow(1 + m, n)) / (Math.pow(1 + m, n) - 1);
    const totalPaid = monthly * n;
    const totalInterest = Math.max(0, totalPaid - P);
    const interestPct = P > 0 ? (totalInterest / P) * 100 : 0;
    return { P, n, monthly, totalPaid, totalInterest, interestPct, rate, yrs };
  }, [amount, apr, years]);

  const fields: { label: string; value: number; set: (n: number) => void; suffix?: string; step?: number; id: string }[] = [
    { label: "Loan amount", value: amount, set: setAmount, suffix: "$", step: 1000, id: "amount" },
    { label: "Interest (APR)", value: apr, set: setApr, suffix: "%", step: 0.25, id: "apr" },
    { label: "Term (years)", value: years, set: setYears, suffix: "yr", step: 1, id: "years" },
  ];

  const stats: { label: string; value: string; accent?: boolean; testid: string }[] = [
    { label: "You borrow", value: usd0(r.P), testid: "stat-borrow" },
    { label: "You repay", value: usd0(r.totalPaid), accent: true, testid: "stat-repay" },
    { label: "Paid in interest", value: usd0(r.totalInterest), accent: true, testid: "stat-interest" },
    { label: "Monthly payment", value: usd2(r.monthly), testid: "stat-monthly" },
  ];

  return (
    <Card className="mb-4 border-teal-500/40" data-testid="card-loan-calculator">
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 mb-1">
          <PiggyBank className="w-4 h-4 text-teal-500" />
          <span className="text-sm font-bold text-teal-500">See what interest really costs</span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Change the numbers and watch how much extra you repay on top of what you borrow.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-4">
          {fields.map((f) => (
            <label key={f.id} className="block">
              <span className="text-[11px] font-semibold text-muted-foreground">{f.label}</span>
              <div className="mt-1 flex items-center rounded-md border border-border bg-background focus-within:border-teal-500">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={f.step}
                  value={Number.isFinite(f.value) ? f.value : ""}
                  onChange={(e) => f.set(e.target.valueAsNumber)}
                  className="w-full bg-transparent px-2.5 py-1.5 text-sm font-bold text-foreground outline-none"
                  data-testid={`input-loan-${f.id}`}
                />
                <span className="px-2 text-xs font-bold text-muted-foreground">{f.suffix}</span>
              </div>
            </label>
          ))}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {stats.map((s) => (
            <div
              key={s.testid}
              className={[
                "rounded-lg border p-2.5",
                s.accent ? "border-teal-500/40 bg-teal-500/5" : "border-border bg-card",
              ].join(" ")}
            >
              <p className="text-[10px] font-semibold text-muted-foreground leading-tight">{s.label}</p>
              <p
                className={["text-sm font-black leading-tight mt-0.5", s.accent ? "text-teal-500" : "text-foreground"].join(" ")}
                data-testid={`text-loan-${s.testid}`}
              >
                {s.value}
              </p>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground mt-3" data-testid="text-loan-summary">
          On a {usd0(r.P)} loan at {r.rate}% over {r.yrs} years, you'd
          repay <span className="font-bold text-foreground">{usd0(r.totalPaid)}</span> — that's{" "}
          <span className="font-bold text-teal-500">{usd0(r.totalInterest)}</span> ({r.interestPct.toFixed(0)}% of what you
          borrowed) in interest. A lower rate or shorter term shrinks that number fast.
        </p>
        <p className="text-[10px] text-muted-foreground/70 mt-2">
          Estimate for learning only — real loans add fees and may compound differently. Not financial advice.
        </p>
      </CardContent>
    </Card>
  );
}

export default function CryptoBingoPage({ initialDeck, embedded = false }: { initialDeck?: string; embedded?: boolean }) {
  const startIndex = Math.max(0, DECKS.findIndex((d) => d.id === initialDeck));
  const [deckIndex, setDeckIndex] = useState(startIndex);
  const deck = DECKS[deckIndex];

  const [board, setBoard] = useState<BingoCell[]>(() => buildBoard(DECKS[startIndex]));
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [activeInfo, setActiveInfo] = useState<number | null>(null);
  const [wins, setWins] = useState<Record<string, number>>(() => readWins());
  const [hadBingo, setHadBingo] = useState(false);

  const isChecked = (i: number) => i === FREE_INDEX || checked.has(i);

  const newCard = useCallback((d: Deck) => {
    setBoard(buildBoard(d));
    setChecked(new Set());
    setActiveInfo(null);
    setHadBingo(false);
  }, []);

  function selectDeck(i: number) {
    if (i === deckIndex) return;
    setDeckIndex(i);
    newCard(DECKS[i]);
  }

  function handleCellClick(i: number) {
    setActiveInfo(i);
    if (i === FREE_INDEX) return;
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  const completedLines = useMemo(
    () => LINES.filter((line) => line.every((i) => isChecked(i))),
    [checked],
  );
  const hasBingo = completedLines.length > 0;
  const litCells = useMemo(() => new Set(completedLines.flat()), [completedLines]);
  const markedCount = checked.size;

  // Record a win the moment the player crosses from no-bingo → bingo.
  useEffect(() => {
    if (hasBingo && !hadBingo) {
      setHadBingo(true);
      setWins((prev) => {
        const next = { ...prev, [deck.id]: (prev[deck.id] ?? 0) + 1 };
        try { localStorage.setItem(WINS_KEY, JSON.stringify(next)); } catch { /* non-fatal */ }
        return next;
      });
    } else if (!hasBingo && hadBingo) {
      // Player unchecked back below a line — let the next completion count again.
      setHadBingo(false);
    }
  }, [hasBingo, hadBingo, deck.id]);

  const totalWins = useMemo(
    () => DECKS.reduce((s, d) => s + (wins[d.id] ?? 0), 0),
    [wins],
  );

  const content = (
    <>
        {/* Title */}
        <div className="flex items-center gap-2 mb-1">
          <Dices className="w-6 h-6 text-emerald-500" />
          <h1 className="text-2xl font-black text-foreground" data-testid="text-bingo-title">
            Crypto Slang Bingo
          </h1>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Pick a deck, then tap each square as it happens live. Complete any line — row, column, or
          diagonal — and it's <span className="font-bold text-foreground">Bingo</span>. For fun, not financial advice.
        </p>

        {/* Deck picker */}
        <div className="flex flex-wrap gap-2 mb-4" data-testid="deck-picker">
          {DECKS.map((d, i) => {
            const DeckIcon = d.icon;
            const on = i === deckIndex;
            const winCount = wins[d.id] ?? 0;
            return (
              <button
                key={d.id}
                onClick={() => selectDeck(i)}
                aria-pressed={on}
                className={[
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold transition-colors",
                  on
                    ? "bg-foreground text-background border-foreground"
                    : "bg-card text-foreground border-border hover:border-foreground/40",
                ].join(" ")}
                data-testid={`button-deck-${d.id}`}
              >
                <DeckIcon className={`w-3.5 h-3.5 ${on ? "" : d.accent}`} />
                {d.name}
                {winCount > 0 && (
                  <span
                    className={[
                      "ml-0.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full text-[9px]",
                      on ? "bg-background/20 text-background" : "bg-muted text-muted-foreground",
                    ].join(" ")}
                    data-testid={`badge-deck-wins-${d.id}`}
                  >
                    {winCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Deck header / status */}
        <Card className="mb-4">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="flex items-center gap-1.5 text-sm font-bold">
                <deck.icon className={`w-4 h-4 ${deck.accent}`} />
                <span className={deck.accent} data-testid="text-deck-name">{deck.name}</span>
              </span>
              <span className="flex items-center gap-3">
                <span className="flex items-center gap-1 text-xs font-bold text-muted-foreground" data-testid="text-total-wins">
                  <Trophy className="w-3.5 h-3.5 text-amber-500" /> {totalWins} win{totalWins !== 1 ? "s" : ""}
                </span>
                <span className="text-xs font-bold text-muted-foreground" data-testid="text-bingo-count">
                  {markedCount} marked
                </span>
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{deck.tagline}</p>
          </CardContent>
        </Card>

        {/* Loan deck: live interest calculator */}
        {deck.id === "loan" && <LoanInterestCalculator />}

        {/* Board */}
        <div className="grid grid-cols-5 gap-1.5 sm:gap-2 mb-4" data-testid="bingo-board">
          {board.map((cell, i) => {
            const on = isChecked(i);
            const inLine = litCells.has(i);
            const isFree = i === FREE_INDEX;
            return (
              <button
                key={i}
                onClick={() => handleCellClick(i)}
                title={cell.tip}
                aria-pressed={isFree ? undefined : on}
                aria-label={`${cell.label}${isFree ? " (free space)" : on ? " — marked" : ""}`}
                className={[
                  "aspect-square rounded-lg border p-1 sm:p-1.5 flex items-center justify-center text-center transition-colors select-none",
                  "text-[8px] sm:text-[10px] leading-tight font-semibold",
                  isFree
                    ? "bg-emerald-500 text-white border-emerald-500 cursor-default"
                    : on
                    ? inLine
                      ? deck.lineClass
                      : "bg-foreground text-background border-foreground"
                    : "bg-card text-foreground border-border hover:border-foreground/40",
                ].join(" ")}
                data-testid={`bingo-cell-${i}`}
              >
                {cell.label}
              </button>
            );
          })}
        </div>

        {/* Active cell explainer (tap-accessible on mobile) */}
        <Card className="mb-4" data-testid="card-bingo-info">
          <CardContent className="p-3 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
            {activeInfo === null ? (
              <p className="text-xs text-muted-foreground">
                Tap any square to mark it and learn what it means.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                <span className="font-bold text-foreground">{board[activeInfo].label}:</span>{" "}
                {board[activeInfo].tip}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 mb-5">
          <Button
            variant="outline"
            size="sm"
            className="font-bold gap-1.5 flex-shrink-0"
            onClick={() => { setChecked(new Set()); setActiveInfo(null); setHadBingo(false); }}
            disabled={markedCount === 0}
            data-testid="button-bingo-reset"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </Button>
          <Button
            variant="default"
            size="sm"
            className="font-bold gap-1.5 flex-shrink-0"
            onClick={() => newCard(deck)}
            data-testid="button-bingo-newcard"
          >
            <Shuffle className="w-3.5 h-3.5" /> New card
          </Button>
        </div>

        {/* Bingo callout */}
        {hasBingo && (
          <Card className="mb-5 border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20" data-testid="callout-bingo">
            <CardContent className="p-4 flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-black text-foreground" data-testid="text-bingo-win">{deck.bingoTitle}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  You completed {completedLines.length} line{completedLines.length !== 1 ? "s" : ""} on the {deck.name} card.
                  Hit <span className="font-semibold text-foreground">New card</span> for a fresh shuffle, or switch decks above.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Footer note */}
        <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-4 py-3" data-testid="note-bingo-disclaimer">
          <Info className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Crypto Slang Bingo is for fun and education — a memorable way to learn the language and warning signs of
            the market. It is not financial advice and not a live scan of any specific token. Wins are tracked only on
            this device. Always do your own research and use the <span className="font-semibold text-foreground">scanner</span> for real on-chain data.
          </p>
        </div>
    </>
  );

  return (
    <div className={embedded ? "mt-10 border-t border-border pt-8" : "min-h-screen bg-background"}>
      {!embedded && <Header />}
      {embedded ? (
        <section id="bingo" className="max-w-2xl mx-auto px-0 sm:px-2">
          {content}
        </section>
      ) : (
        <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
          {content}
        </main>
      )}
      {!embedded && <Footer />}
    </div>
  );
}
