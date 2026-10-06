import { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowDownRight,
  ArrowUp,
  ArrowUpRight,
  Bell,
  Check,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Gem,
  Info,
  Lightbulb,
  LockKeyhole,
  RefreshCw,
  Sparkles,
  Target,
  Ticket,
  Trophy,
} from 'lucide-react';

type Phase = 'find' | 'pick' | 'ring' | 'reward';

type Token = {
  symbol: string;
  name: string;
  price: string;
  move: number;
  volume: string;
  liquidity: string;
  tone: string;
  badge: string;
  station: string;
};

const TOKENS: Token[] = [
  { symbol: 'NOVA', name: 'Nova Mesh', price: '$1.84', move: 6.2, volume: '$2.8M', liquidity: '$486K', tone: '#d8ff5a', badge: 'HOT READ', station: 'Star lift' },
  { symbol: 'KITE', name: 'Kite Protocol', price: '$2.09', move: 4.7, volume: '$1.9M', liquidity: '$318K', tone: '#ffca57', badge: 'RISING', station: 'Sky line' },
  { symbol: 'AXIS', name: 'Axis Garden', price: '$5.03', move: 3.3, volume: '$1.1M', liquidity: '$274K', tone: '#66e0d0', badge: 'STEADY', station: 'Garden gate' },
  { symbol: 'ORB', name: 'Orbit Link', price: '$4.16', move: 2.1, volume: '$824K', liquidity: '$191K', tone: '#82bbff', badge: 'WATCH', station: 'Orbit post' },
  { symbol: 'LUME', name: 'Lume Core', price: '$3.27', move: 1.6, volume: '$593K', liquidity: '$153K', tone: '#e49bf3', badge: 'QUIET', station: 'Glow booth' },
  { symbol: 'SORA', name: 'Sora Field', price: '$0.98', move: 0.8, volume: '$418K', liquidity: '$124K', tone: '#9ec8ff', badge: 'FLAT', station: 'Low tide' },
  { symbol: 'MINT', name: 'Mintline', price: '$0.46', move: -1.4, volume: '$506K', liquidity: '$142K', tone: '#f39eb9', badge: 'SOFT', station: 'Quiet bell' },
  { symbol: 'VOLT', name: 'Volt Arcade', price: '$1.22', move: -2.6, volume: '$790K', liquidity: '$207K', tone: '#ff8f7a', badge: 'SLIPPING', station: 'Power dip' },
  { symbol: 'FLUX', name: 'Flux Harbor', price: '$0.72', move: -3.8, volume: '$1.4M', liquidity: '$261K', tone: '#ff806b', badge: 'WEAK', station: 'Harbor drop' },
];

function PhaseRail({ phase }: { phase: Phase }) {
  const phases: { key: Phase; number: string; label: string; icon: typeof Target }[] = [
    { key: 'find', number: '01', label: 'Find a lane', icon: Target },
    { key: 'pick', number: '02', label: 'Pick positive', icon: Check },
    { key: 'ring', number: '03', label: 'Ring once', icon: Bell },
    { key: 'reward', number: '04', label: 'Collect paper', icon: Ticket },
  ];
  const activeIndex = phases.findIndex((item) => item.key === phase);

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {phases.map((item, index) => {
        const Icon = item.icon;
        const complete = index < activeIndex;
        const active = item.key === phase;
        return (
          <div
            key={item.key}
            className={`relative flex items-center gap-2 rounded-xl border px-3 py-2.5 transition ${
              active
                ? 'border-[#d8ff5a] bg-[#d8ff5a]/10 text-[#f6f0d5]'
                : complete
                  ? 'border-[#ffca57]/50 bg-[#ffca57]/[0.07] text-[#ffca57]'
                  : 'border-[#5c493b] bg-[#211b18] text-[#8f7c65]'
            }`}
          >
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border font-mono text-[9px] font-bold ${active ? 'border-[#d8ff5a] bg-[#d8ff5a] text-[#17130f]' : 'border-current'}`}>
              {complete ? <Check size={13} /> : <Icon size={13} />}
            </span>
            <span>
              <span className="block font-mono text-[8px] uppercase tracking-[.16em] opacity-70">{item.number}</span>
              <span className="block text-[11px] font-semibold leading-4">{item.label}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Mascot({ phase, selected }: { phase: Phase; selected: Token }) {
  const lines: Record<Phase, string> = {
    find: 'Look across the stations. Find a lane that is climbing.',
    pick: `Good eye. Pick ${selected.symbol}, or choose another positive lane.`,
    ring: `Your lane is ready. Ring ${selected.symbol} once to start the round.`,
    reward: `That bell was heard. Take the paper reward and keep your read honest.`,
  };
  return (
    <div className="relative flex items-center gap-3 overflow-hidden rounded-2xl border border-[#765d45] bg-[#33261e] px-4 py-3 shadow-[0_5px_0_#17110e]">
      <div className="absolute -right-8 -top-10 h-28 w-28 rounded-full bg-[#ffca57]/10 blur-2xl" />
      <div className="relative h-14 w-14 shrink-0">
        <div className={`absolute left-2 top-1 h-11 w-10 rounded-[45%_45%_38%_38%] border-2 border-[#785827] bg-[#d8ff5a] shadow-[3px_4px_0_#806e27] ${phase === 'reward' ? 'animate-[mascotJump_.7s_ease-out]' : 'animate-[mascotBob_2.2s_ease-in-out_infinite]'}`}>
          <span className="absolute left-2.5 top-3 h-1.5 w-1.5 rounded-full bg-[#17130f]" />
          <span className="absolute right-2.5 top-3 h-1.5 w-1.5 rounded-full bg-[#17130f]" />
          <span className={`absolute left-1/2 top-6 h-1 -translate-x-1/2 rounded-full bg-[#ff806b] ${phase === 'reward' ? 'w-5' : 'w-3'}`} />
          <span className={`absolute -top-3 left-1/2 h-3 w-1 -translate-x-1/2 rounded-full ${phase === 'ring' || phase === 'reward' ? 'bg-[#ffca57]' : 'bg-[#8ca93e]'}`} />
        </div>
        <span className="absolute bottom-0 left-0 rounded-full bg-[#ff8f7a] px-1.5 py-1 font-mono text-[7px] font-bold text-[#231713]">HOST</span>
      </div>
      <div className="relative min-w-0">
        <p className="font-mono text-[9px] font-bold uppercase tracking-[.18em] text-[#ffca57]">Arcade PAIF says</p>
        <p className="mt-1 text-[12px] leading-5 text-[#f2dbad]">{lines[phase]}</p>
      </div>
      <span className="ml-auto hidden shrink-0 rounded-lg border border-[#ffca57]/40 bg-[#ffca57]/[0.08] px-2 py-1 font-mono text-[8px] uppercase tracking-[.12em] text-[#ffca57] sm:block">
        {phase === 'find' ? 'Scanning' : phase === 'pick' ? 'Choice open' : phase === 'ring' ? 'Bell ready' : 'Receipt ready'}
      </span>
    </div>
  );
}

function Meter({
  token,
  lane,
  selected,
  best,
  rung,
  onAction,
}: {
  token: Token;
  lane: number;
  selected: boolean;
  best: boolean;
  rung: boolean;
  onAction: () => void;
}) {
  const positive = token.move >= 0;
  const height = positive ? Math.max(8, Math.min(62, (Math.abs(token.move) / 6.2) * 62)) : Math.max(8, Math.min(28, (Math.abs(token.move) / 6.2) * 28));
  const candleColor = positive ? '#b8f05a' : '#ff6d62';
  return (
    <div className={`group relative flex min-w-[124px] flex-1 flex-col items-center rounded-2xl border px-2 pb-3 pt-3 text-left transition duration-200 ${rung ? 'animate-[laneBump_.5s_ease-out]' : ''} ${selected ? 'border-[#f7edc8] bg-[#342f24] shadow-[0_8px_0_#17120e,0_0_0_2px_rgba(216,255,90,.7)] -translate-y-1' : best ? 'border-[#d8ff5a]/70 bg-[#282c1d] shadow-[0_5px_0_#17120e]' : 'border-[#5e4a39] bg-[#201d1b] hover:border-[#d8ff5a]/60'}`}>
      <div className="flex w-full items-center justify-between gap-1">
        <span className="flex items-center gap-1.5 font-mono text-[10px] font-bold tracking-[.14em] text-[#f7edc8]"><span className="text-[8px] text-[#806b51]">0{lane}</span>{token.symbol}</span>
        {best && positive ? <span className="rounded-full bg-[#d8ff5a] px-1.5 py-0.5 font-mono text-[7px] font-black tracking-[.08em] text-[#231713]">BEST READ</span> : rung ? <span className="rounded-full bg-[#ffca57] px-1.5 py-0.5 font-mono text-[7px] font-black tracking-[.08em] text-[#231713]">RUNG</span> : selected ? <Check size={12} className="text-[#d8ff5a]" /> : null}
      </div>
      <span className="mt-1 w-full truncate font-sans text-[9px] text-[#aa9a84]">{token.station} / {token.name}</span>
      <span className="relative mt-3 h-[300px] w-full overflow-hidden rounded-xl border border-[#6c553f] bg-[#171615]">
        <span className="absolute inset-x-0 top-[68%] border-t-2 border-dashed border-[#e9c96e]/80" />
        <span className="absolute left-1 top-[calc(68%-10px)] font-mono text-[7px] text-[#9e8a6f]">0</span>
        <span className={`absolute left-1/2 w-[38px] -translate-x-1/2 transition-all duration-500 ${positive ? 'bottom-[32%] rounded-t-[10px]' : 'top-[68%] rounded-b-[10px]'}`} style={{ height: `${height}%`, background: candleColor, boxShadow: selected ? `0 0 16px ${candleColor}66` : 'none' }}>
          <span className="absolute inset-x-1 top-2 h-1 rounded-full bg-[#fff8de]/75" />
          <span className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1" aria-hidden="true">
            <span className="flex gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#292019]" /><span className="h-1.5 w-1.5 rounded-full bg-[#292019]" /></span>
            <span className={`h-1 w-3 rounded-full ${positive ? 'bg-[#292019]' : 'bg-[#6b241f]'}`} />
          </span>
        </span>
        {positive ? <ArrowUp size={13} className="absolute right-1.5 top-2 text-[#d8ff5a]" /> : <ArrowDown size={13} className="absolute right-1.5 bottom-2 text-[#ff806b]" />}
        <span className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[11px] font-bold ${positive ? 'bottom-[calc(32%+12px)] text-[#d8ff5a]' : 'top-[calc(68%+12px)] text-[#ff9a82]'}`}>{positive ? '+' : ''}{token.move.toFixed(1)}%</span>
      </span>
      <span className="mt-2 font-mono text-[10px] font-bold text-[#f7edc8]">{token.price}</span>
      <span className="mt-1 rounded-full px-2 py-0.5 font-mono text-[7px] tracking-[.12em]" style={{ color: token.tone, backgroundColor: `${token.tone}18` }}>{token.badge}</span>
      <button
        type="button"
        onClick={onAction}
        disabled={!positive}
        aria-label={positive ? `Pick ${token.symbol}, the ${token.move.toFixed(1)} percent positive lane` : `Skip ${token.symbol}, negative lane`}
        className={`mt-3 flex w-full items-center justify-center gap-1 rounded-lg border py-2.5 font-mono text-[8px] font-bold uppercase tracking-[.1em] transition ${positive ? selected ? 'border-[#b8f05a] bg-[#b8f05a]/15 text-[#b8f05a]' : 'border-[#5e4a39] text-[#aa9a84] hover:border-[#b8f05a]/60 hover:text-[#b8f05a]' : 'cursor-not-allowed border-[#5e4a39]/70 text-[#806b51]'}`}
      >
        {positive ? <Target size={12} /> : <ArrowDownRight size={12} />} {positive ? selected ? 'Lane picked' : 'Pick this lane' : 'Context only'}
      </button>
    </div>
  );
}

export function HighStrikerLanes() {
  const [selectedSymbol, setSelectedSymbol] = useState('NOVA');
  const [score, setScore] = useState(2480);
  const [round, setRound] = useState(7);
  const [streak, setStreak] = useState(3);
  const [bellRung, setBellRung] = useState(false);
  const [lastRungSymbol, setLastRungSymbol] = useState<string | null>(null);
  const [treasure, setTreasure] = useState(1320);
  const [cashedOut, setCashedOut] = useState(false);
  const [feedback, setFeedback] = useState('The board is ready. Find the lane with an upward read.');
  const [showEvidence, setShowEvidence] = useState(false);
  const [phase, setPhase] = useState<Phase>('find');
  const selected = useMemo(() => TOKENS.find((token) => token.symbol === selectedSymbol) ?? TOKENS[0], [selectedSymbol]);
  const bestSymbol = useMemo(() => TOKENS.reduce((best, token) => token.move > best.move ? token : best, TOKENS[0]).symbol, []);

  function selectSignal(token: Token) {
    if (token.move < 0) return;
    setSelectedSymbol(token.symbol);
    setBellRung(false);
    setPhase('ring');
    setFeedback(`${token.symbol} is picked. You can ring this lane, or compare another positive lane first.`);
  }

  function ringSelected() {
    if (selected.move < 0) {
      setFeedback(`${selected.symbol} is context only in this scan. Pick a positive lane to ring.`);
      setPhase('pick');
      return;
    }
    const points = 35;
    setScore((current) => current + points);
    setRound((current) => current + 1);
    setStreak((current) => current + 1);
    setBellRung(true);
    setLastRungSymbol(selected.symbol);
    setTreasure((current) => current + 20);
    setCashedOut(false);
    setPhase('reward');
    setFeedback(`${selected.symbol} rang. The receipt shows +${points} paper XP and +20 paper gems.`);
  }

  function nextRound() {
    setBellRung(false);
    setLastRungSymbol(null);
    setPhase('find');
    setFeedback('New round, same simple loop. Find a lane with an upward read.');
  }

  return (
    <main className="min-h-[100dvh] overflow-hidden bg-[#15110f] text-[#f7edc8] selection:bg-[#d8ff5a] selection:text-[#18140f]">
      <style>{`
        @keyframes chime { 0%,100% { transform: rotate(0) } 50% { transform: rotate(8deg) } }
        @keyframes mascotBob { 0%,100% { transform: translateY(0) rotate(-2deg) } 50% { transform: translateY(-5px) rotate(2deg) } }
        @keyframes mascotJump { 0% { transform: translateY(0) scale(1) } 45% { transform: translateY(-12px) scale(1.06) } 100% { transform: translateY(0) scale(1) } }
        @keyframes bellFlash { 0% { transform: scale(.65); opacity: .9 } 100% { transform: scale(1.7); opacity: 0 } }
        @keyframes laneBump { 0%,100% { transform: translateY(0) } 40% { transform: translateY(-7px) rotate(-1deg) } 75% { transform: translateY(1px) rotate(1deg) } }
        .striker-grain { background-image: radial-gradient(rgba(247,237,200,.09) .7px, transparent .7px); background-size: 5px 5px; }
        .striker-checker { background-image: linear-gradient(135deg, rgba(255,255,255,.025) 25%, transparent 25%, transparent 50%, rgba(255,255,255,.025) 50%, rgba(255,255,255,.025) 75%, transparent 75%); background-size: 18px 18px; }
      `}</style>
      <div className="mx-auto max-w-[1440px] px-4 pb-10 sm:px-7 lg:px-10">
        <header className="flex flex-col gap-5 border-b border-[#584535] py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-[#d8ff5a] bg-[#d8ff5a] text-[#18140f] shadow-[4px_4px_0_#806e27]"><Target size={24} /></div>
            <div><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xl font-bold tracking-[-.1em]">ARCADE PAIF</span><span className="rounded border border-[#806b51] px-2 py-1 font-mono text-[8px] uppercase tracking-[.15em] text-[#c1ad90]">Ring to Win</span></div><p className="mt-1 font-mono text-[9px] uppercase tracking-[.17em] text-[#a89478]">Market learning attraction / station 07</p></div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-lg border border-[#765d45] bg-[#211b18] px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[.12em] text-[#d8ff5a]"><LockKeyhole size={13} /> Paper play / execution off</div>
            <button type="button" onClick={() => { setPhase('find'); setBellRung(false); setFeedback('Fresh demo snapshot loaded. Find the lane with an upward read.'); }} aria-label="Refresh token scan" className="rounded-lg border border-[#765d45] bg-[#211b18] p-2.5 text-[#c1ad90] hover:border-[#d8ff5a] hover:text-[#d8ff5a]"><RefreshCw size={16} /></button>
          </div>
        </header>

        <section className="relative overflow-hidden py-8 lg:py-10">
          <div className="pointer-events-none absolute -right-20 -top-32 h-72 w-72 rounded-full bg-[#ff8f7a]/10 blur-3xl" />
          <div className="relative grid gap-7 lg:grid-cols-[1fr_330px] lg:items-end">
            <div><div className="mb-4 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[.22em] text-[#d8ff5a]"><span className="h-px w-9 bg-[#d8ff5a]" /> Station 07 / round {round}</div><h1 className="max-w-3xl font-mono text-4xl font-bold leading-[.94] tracking-[-.09em] sm:text-6xl lg:text-7xl">Find the lift.<br /><span className="text-[#ffca57]">Ring the bell.</span></h1><p className="mt-5 max-w-xl text-sm leading-6 text-[#c1ad90] sm:text-base">A paper-only arcade round hosted by PAIF. Compare the lanes, pick one positive read, and make one ring. The board teaches the move; it never places a trade.</p></div>
            <div className="flex items-center gap-4 border-l-2 border-[#d8ff5a]/60 pl-4"><Trophy size={24} className="text-[#ffca57]" /><div><p className="font-mono text-[9px] uppercase tracking-[.16em] text-[#a89478]">Paper score</p><p className="mt-1 font-mono text-3xl font-bold tracking-[-.07em]">{score.toLocaleString()} <span className="text-sm text-[#d8ff5a]">XP</span></p><p className="mt-1 font-mono text-[9px] uppercase tracking-[.14em] text-[#ffca57]">{streak > 1 ? `${streak} bell streak` : 'Start a streak'}</p></div></div>
          </div>
        </section>

        <section className="mb-6"><PhaseRail phase={phase} /></section>

        <section className="striker-checker relative overflow-hidden rounded-[24px] border-2 border-[#765d45] bg-[#2a211d] p-3 shadow-[0_16px_0_#0d0b0a,0_26px_55px_rgba(0,0,0,.28)] sm:p-5">
          <div className="striker-grain pointer-events-none absolute inset-0 opacity-50" />
          <div className="relative">
            <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center"><Mascot phase={phase} selected={selected} /><div className="rounded-xl border border-[#765d45] bg-[#1b1715] px-3 py-3 text-center font-mono text-[8px] uppercase tracking-[.13em] text-[#a89478]"><span className="text-[#d8ff5a]">Upward lanes can be picked</span><br /><span className="text-[#806b51]">Downward lanes stay context-only</span></div></div>
            <div className="mb-4 flex flex-col gap-3 rounded-xl border border-[#765d45] bg-[#1b1715] px-3 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.14em] text-[#d2bd9b]"><Sparkles size={13} className="text-[#ffca57]" /> Choose a station on the board</div><div className="flex items-center gap-3 font-mono text-[8px] uppercase tracking-[.13em] text-[#a89478]"><span className="text-[#d8ff5a]">positive read</span><span className="text-[#806b51]">·</span><span className="text-[#ffca57]">paper reward</span><span className="hidden text-[#a89478] sm:inline">/ 1h snapshot</span></div></div>
            <div className="flex gap-2 overflow-x-auto pb-3 sm:gap-3">{TOKENS.map((token, index) => <Meter key={token.symbol} token={token} lane={index + 1} selected={token.symbol === selectedSymbol} best={token.symbol === bestSymbol} rung={token.symbol === lastRungSymbol} onAction={() => selectSignal(token)} />)}</div>
            <div className="mt-2 flex items-center justify-center gap-2 font-mono text-[8px] uppercase tracking-[.16em] text-[#a89478]"><ArrowUpRight size={13} className="text-[#d8ff5a]" /> lift <span className="mx-1 h-px w-16 bg-[#806b51]" /> neutral line <span className="mx-1 h-px w-16 bg-[#806b51]" /> pressure <ArrowDownRight size={13} className="text-[#ff8f7a]" /></div>
          </div>
        </section>

        <section className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-2xl border border-[#765d45] bg-[#211b18] p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-[.17em] text-[#ffca57]">{phase === 'reward' ? 'Round result' : 'Your selected station'}</p><h2 className="mt-2 font-mono text-3xl font-bold tracking-[-.08em]">{selected.name}</h2><p className="mt-1 font-mono text-[10px] uppercase tracking-[.12em] text-[#a89478]">{selected.symbol} / {selected.move > 0 ? '+' : ''}{selected.move.toFixed(1)}% · {selected.station}</p></div><div className="rounded-lg border border-[#765d45] bg-[#2c211c] px-3 py-2 text-right"><p className="font-mono text-[8px] uppercase tracking-[.14em] text-[#a89478]">Current read</p><p className="mt-1 font-mono text-lg font-bold text-[#d8ff5a]">{Math.round(Math.max(0, selected.move) / 6.2 * 100)} / 100</p></div></div>
            <div className="mt-5 rounded-xl border border-[#d8ff5a]/30 bg-[#d8ff5a]/[0.05] p-3"><p className="font-mono text-[9px] uppercase tracking-[.14em] text-[#d8ff5a]">PAIF host note</p><p className="mt-1 text-[12px] leading-5 text-[#d8e7ae]">{selected.symbol === bestSymbol ? 'This is the highest-confidence positive read in this snapshot. It is a best current read, not a promise.' : 'This lane is positive in the snapshot. You are free to choose it even when another lane has the strongest current read.'}</p></div>
            <button type="button" onClick={ringSelected} disabled={selected.move < 0 || phase === 'find' || phase === 'pick'} className={`mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-4 font-mono text-[10px] font-bold uppercase tracking-[.17em] shadow-[0_4px_0_#806e27] transition hover:-translate-y-0.5 active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-45 ${phase === 'reward' ? 'bg-[#ffca57] text-[#231713]' : 'bg-[#d8ff5a] text-[#17130f]'}`}><Bell size={16} style={{ animation: phase === 'ring' ? 'chime 1.8s ease-in-out infinite' : 'none' }} /> {phase === 'reward' ? 'Round rang — see receipt' : phase === 'ring' ? `Ring ${selected.symbol} once` : 'Pick a positive lane above'} <ChevronRight size={15} /></button>
            {phase === 'reward' ? <button type="button" onClick={nextRound} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[#765d45] bg-[#2b241f] px-4 py-3 font-mono text-[9px] font-bold uppercase tracking-[.14em] text-[#f7edc8] hover:border-[#d8ff5a] hover:text-[#d8ff5a]"><RefreshCw size={13} /> Start next round</button> : null}
            <p aria-live="polite" className="mt-3 text-center font-mono text-[9px] leading-4 text-[#c1ad90]">{feedback}</p>
          </div>
          <aside className="space-y-4">
            <div className={`relative overflow-hidden rounded-2xl border border-[#ffca57]/40 bg-[#2b2419] p-4 ${bellRung ? 'ring-2 ring-[#d8ff5a]/70' : ''}`}>
              {bellRung && <span className="pointer-events-none absolute left-1/2 top-5 h-16 w-16 -translate-x-1/2 rounded-full border-2 border-[#d8ff5a]/70" style={{ animation: 'bellFlash 700ms ease-out forwards' }} />}
              <div className="flex items-center gap-3"><Bell size={22} className={`shrink-0 text-[#ffca57] ${bellRung ? 'animate-[chime_.5s_ease-in-out_2]' : ''}`} /><div><p className="font-mono text-[10px] font-bold uppercase tracking-[.16em] text-[#ffca57]">{bellRung ? 'Bell heard' : 'Bell status'}</p><p className="mt-1 text-[12px] leading-5 text-[#f2dbad]">{bellRung ? `${lastRungSymbol} rang. Your paper receipt is ready below.` : 'Choose a positive lane, then ring once.'}</p></div></div>
            </div>
            {phase === 'reward' && <div className="rounded-2xl border border-[#ffca57]/50 bg-[#261d16] p-5 shadow-[0_5px_0_#17110e]"><div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.16em] text-[#ffca57]"><ClipboardList size={14} /> Paper receipt</div><div className="mt-4 border-y border-dashed border-[#806b51] py-3 font-mono text-[10px] text-[#d6c39c]"><div className="flex justify-between"><span>station</span><span className="text-[#f7edc8]">{lastRungSymbol}</span></div><div className="mt-2 flex justify-between"><span>bell streak</span><span className="text-[#ffca57]">{streak}</span></div><div className="mt-2 flex justify-between"><span>paper XP</span><span className="text-[#d8ff5a]">+35</span></div><div className="mt-2 flex justify-between"><span>paper gems</span><span className="text-[#d8ff5a]">+20</span></div></div><p className="mt-3 text-[11px] leading-5 text-[#d6c39c]">A learning result only. No wallet, order, or cash value is involved.</p></div>}
            <div className="rounded-2xl border border-[#66e0d0]/30 bg-[#182321] p-5"><div className="flex items-center justify-between"><p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.16em] text-[#66e0d0]"><Lightbulb size={14} /> Evidence drawer</p><button type="button" onClick={() => setShowEvidence((open) => !open)} aria-expanded={showEvidence} className="rounded-md p-1 text-[#a6d6ce] hover:bg-[#66e0d0]/10"><CircleHelp size={15} /></button></div><p className="mt-3 text-sm leading-5 text-[#d3e7dc]">The board compares movement so you can practice reading direction. Inspect the details when you want them; the game stays about one clear choice.</p>{showEvidence && <div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-lg border border-[#31514d] bg-[#10201e] p-3"><p className="font-mono text-[8px] uppercase text-[#8bbab1]">1h volume</p><p className="mt-1 font-mono text-sm font-bold text-[#d3e7dc]">{selected.volume}</p></div><div className="rounded-lg border border-[#31514d] bg-[#10201e] p-3"><p className="font-mono text-[8px] uppercase text-[#8bbab1]">Liquidity</p><p className="mt-1 font-mono text-sm font-bold text-[#d3e7dc]">{selected.liquidity}</p></div><p className="col-span-2 border-t border-[#31514d] pt-3 text-[11px] leading-5 text-[#a6d6ce]"><Info size={12} className="mr-1 inline" /> Snapshot evidence can be stale, incomplete, or wrong. It never promises an outcome.</p></div>}</div>
            <div className="rounded-2xl border border-[#ffca57]/30 bg-[#2b2419] p-5"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.16em] text-[#ffca57]"><Gem size={14} /> Paper treasure chest</div><span className="font-mono text-[9px] uppercase tracking-[.12em] text-[#d8ff5a]">no cash value</span></div><p className="mt-3 font-mono text-2xl font-bold text-[#f7edc8]">{treasure.toLocaleString()} <span className="text-xs text-[#ffca57]">gems</span></p><div className="mt-3 h-3 overflow-hidden rounded-full bg-[#171615]"><div className="h-full rounded-full bg-gradient-to-r from-[#ffca57] via-[#d8ff5a] to-[#fff2a6]" style={{ width: `${Math.min(100, treasure / 30)}%` }} /></div><button type="button" onClick={() => { if (treasure > 0) { setCashedOut(true); setFeedback(`Paper chest opened: ${treasure.toLocaleString()} gems collected for the arcade tally.`); setTreasure(0); } }} disabled={treasure === 0} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-[#ffca57]/50 bg-[#ffca57]/10 px-3 py-3 font-mono text-[9px] font-bold uppercase tracking-[.14em] text-[#ffca57] transition hover:bg-[#ffca57]/20 disabled:cursor-not-allowed disabled:opacity-40"><Gem size={14} /> {cashedOut ? 'Chest opened — keep playing' : 'Open paper chest'}</button><p className="mt-3 text-[11px] leading-5 text-[#d6c39c]">Tickets, gems, XP, and streaks are arcade progress only. They stay on paper.</p></div>
          </aside>
        </section>

        <footer className="mt-8 flex flex-col gap-3 border-t border-[#584535] pt-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[9px] uppercase tracking-[.13em] text-[#a89478]"><span className="flex items-center gap-1.5"><Ticket size={12} /> Paper score only</span><span className="flex items-center gap-1.5"><LockKeyhole size={12} /> No wallet connected</span><span className="flex items-center gap-1.5"><RefreshCw size={12} /> Static scan snapshot</span></div><span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.13em] text-[#806b51]"><ArrowDownRight size={12} /> Learn the move, keep the receipt</span></footer>
      </div>
    </main>
  );
}

export default HighStrikerLanes;