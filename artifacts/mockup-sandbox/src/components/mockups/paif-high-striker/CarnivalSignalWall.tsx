import { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bell,
  Check,
  ChevronRight,
  CircleHelp,
  Eye,
  Flag,
  Gauge,
  Info,
  LockKeyhole,
  Radio,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  WalletCards,
  Zap,
} from 'lucide-react';

type Direction = 'up' | 'down' | 'hold';
type Mode = 'paper' | 'live';

type Candidate = {
  symbol: string;
  name: string;
  price: string;
  move: number;
  hour: number;
  volume: string;
  liquidity: string;
  tone: string;
  note: string;
};

const candidates: Candidate[] = [
  { symbol: 'NOVA', name: 'Nova Mesh', price: '$1.84', move: 6.2, hour: 4.8, volume: '$2.4M', liquidity: '$680K', tone: '#d7f85b', note: 'Buy pressure is outpacing the daily rhythm.' },
  { symbol: 'FLUX', name: 'Flux Harbor', price: '$0.72', move: -3.8, hour: -2.7, volume: '$1.1M', liquidity: '$410K', tone: '#ff826c', note: 'Selling pressure is steady across the last hour.' },
  { symbol: 'ORB', name: 'Orbit Link', price: '$4.16', move: 2.1, hour: 1.3, volume: '$780K', liquidity: '$1.2M', tone: '#67d9ee', note: 'A liquid move, but momentum is cooling.' },
  { symbol: 'KITE', name: 'Kite Protocol', price: '$2.09', move: 4.7, hour: 3.9, volume: '$1.8M', liquidity: '$520K', tone: '#ffd15a', note: 'Activity is lively with a clean upward slope.' },
  { symbol: 'HUSH', name: 'Hush Relay', price: '$0.31', move: -5.1, hour: -4.2, volume: '$920K', liquidity: '$295K', tone: '#f49bcf', note: 'Downward movement is strong, but liquidity is thinner.' },
  { symbol: 'LUME', name: 'Lume Core', price: '$3.27', move: 1.6, hour: 0.4, volume: '$540K', liquidity: '$890K', tone: '#9ee878', note: 'The signal is quiet; there is no clear edge yet.' },
];

function movementLabel(move: number) {
  return `${move >= 0 ? '+' : ''}${move.toFixed(1)}%`;
}

function signalFor(candidate: Candidate): Direction {
  if (candidate.hour >= 3.5 && candidate.move > 3) return 'up';
  if (candidate.hour <= -2.5 && candidate.move < -3) return 'down';
  return 'hold';
}

function directionLabel(direction: Direction) {
  return direction === 'up' ? 'Up' : direction === 'down' ? 'Down' : 'Hold';
}

export function CarnivalSignalWall() {
  const [selectedSymbol, setSelectedSymbol] = useState('NOVA');
  const [call, setCall] = useState<Direction>('up');
  const [mode, setMode] = useState<Mode>('paper');
  const [score, setScore] = useState(1240);
  const [round, setRound] = useState(7);
  const [result, setResult] = useState<'idle' | 'hit' | 'miss'>('idle');
  const [showEvidence, setShowEvidence] = useState(true);
  const [notice, setNotice] = useState('Choose a candidate, make your call, then strike.');

  const selected = useMemo(
    () => candidates.find((candidate) => candidate.symbol === selectedSymbol) ?? candidates[0],
    [selectedSymbol],
  );
  const signal = signalFor(selected);
  const strikerPosition = result === 'hit' ? 92 : result === 'miss' ? 43 : Math.min(78, Math.max(22, 50 + selected.move * 3));
  const isPaper = mode === 'paper';

  function chooseCandidate(candidate: Candidate) {
    setSelectedSymbol(candidate.symbol);
    setCall(signalFor(candidate));
    setResult('idle');
    setNotice(`${candidate.symbol} is on the machine. Read the receipt before you strike.`);
  }

  function strike() {
    if (!isPaper) {
      setNotice('Live mode is a visual prototype. Wallet connection and real-money execution are inactive.');
      return;
    }
    const aligned = call === signal;
    const points = aligned ? 120 : call === 'hold' ? 30 : -40;
    setScore((current) => Math.max(0, current + points));
    setRound((current) => current + 1);
    setResult(aligned ? 'hit' : 'miss');
    setNotice(aligned ? `${selected.symbol} bell hit. +${points} XP for reading the evidence.` : `${selected.symbol} missed the bell. ${points} XP — reset and try the next round.`);
  }

  function resetRound() {
    setResult('idle');
    setCall('hold');
    setNotice('New round ready. Pick the signal that earns your attention.');
  }

  return (
    <main className="min-h-[100dvh] overflow-hidden bg-[#17121b] text-[#fff4df] selection:bg-[#d7f85b] selection:text-[#17121b]">
      <style>{`
        @keyframes wall-flicker { 0%, 100% { opacity: .72; } 50% { opacity: 1; } }
        @keyframes wall-bounce { 0% { transform: translateY(0); } 45% { transform: translateY(-9px); } 100% { transform: translateY(0); } }
        @keyframes wall-climb { from { height: 0%; } to { height: var(--climb); } }
        @keyframes wall-flash { 0% { opacity: 0; transform: scale(.7); } 35% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(1.18); } }
        .wall-checker { background-image: linear-gradient(135deg, rgba(255,244,223,.045) 25%, transparent 25%), linear-gradient(225deg, rgba(255,244,223,.045) 25%, transparent 25%), linear-gradient(45deg, rgba(255,244,223,.045) 25%, transparent 25%), linear-gradient(315deg, rgba(255,244,223,.045) 25%, transparent 25%); background-position: 12px 0, 12px 0, 0 0, 0 0; background-size: 24px 24px; background-repeat: repeat; }
        .wall-lamp { animation: wall-flicker 1.9s ease-in-out infinite; }
      `}</style>

      <div className="mx-auto w-full max-w-[1420px] px-4 pb-10 sm:px-7 lg:px-10">
        <header className="flex flex-col gap-4 border-b border-[#fff4df]/10 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-[14px] border-2 border-[#17121b] bg-[#d7f85b] text-[#17121b] shadow-[4px_4px_0_#f28a65]"><Target size={24} strokeWidth={2.8} /></div>
            <div>
              <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xl font-black tracking-[-.08em]">PAIF</span><span className="rounded-full border border-[#fff4df]/20 px-2 py-1 font-mono text-[9px] uppercase tracking-[.16em] text-[#cdbca9]">Carnival Signal Wall</span></div>
              <p className="mt-1 font-mono text-[9px] uppercase tracking-[.2em] text-[#9f8e9a]">Read the move. Ring the bell.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex rounded-xl border border-[#fff4df]/15 bg-[#241b29] p-1" aria-label="Execution mode">
              <button type="button" onClick={() => setMode('paper')} aria-pressed={isPaper} className={`flex items-center gap-2 rounded-lg px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[.12em] transition ${isPaper ? 'bg-[#d7f85b] text-[#17121b]' : 'text-[#9f8e9a] hover:text-[#fff4df]'}`}><WalletCards size={13} /> Paper</button>
              <button type="button" onClick={() => setMode('live')} aria-pressed={!isPaper} className={`flex items-center gap-2 rounded-lg px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[.12em] transition ${!isPaper ? 'bg-[#ff826c] text-[#17121b]' : 'text-[#9f8e9a] hover:text-[#fff4df]'}`}><Radio size={13} /> Live</button>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-[#ffd15a]/25 bg-[#ffd15a]/[.08] px-3 py-2"><Trophy size={15} className="text-[#ffd15a]" /><span className="font-mono text-sm font-bold">{score.toLocaleString()} <span className="text-[10px] text-[#ffd15a]">XP</span></span></div>
          </div>
        </header>

        <section className="relative py-9 lg:py-12">
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-[#ff826c]/10 blur-3xl" />
          <div className="relative flex flex-col justify-between gap-7 lg:flex-row lg:items-end">
            <div className="max-w-3xl">
              <div className="mb-4 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[.22em] text-[#d7f85b]"><span className="h-px w-8 bg-[#d7f85b]" /> Booth 04 / trending scan</div>
              <h1 className="font-mono text-4xl font-black leading-[.94] tracking-[-.09em] sm:text-6xl lg:text-7xl">Pick a signal.<br /><span className="text-[#ff826c]">Ring the bell.</span></h1>
              <p className="mt-5 max-w-xl text-sm leading-6 text-[#cdbca9] sm:text-base">One token. One simple call. The high striker turns percentage movement into a quick market-reading habit.</p>
            </div>
            <div className="flex items-center gap-3 border-l-2 border-[#d7f85b]/50 pl-4">
              <Gauge size={24} className="text-[#d7f85b]" />
              <div><p className="font-mono text-[10px] uppercase tracking-[.17em] text-[#9f8e9a]">Paper round</p><p className="mt-1 font-mono text-2xl font-black tracking-[-.06em]">#{round.toString().padStart(2, '0')} <span className="text-sm text-[#d7f85b]">in play</span></p></div>
            </div>
          </div>
        </section>

        <div className={`mb-5 flex items-start gap-3 rounded-xl border p-3 ${isPaper ? 'border-[#d7f85b]/25 bg-[#d7f85b]/[.06]' : 'border-[#ff826c]/50 bg-[#ff826c]/[.1]'}`}>
          {isPaper ? <ShieldCheck size={17} className="mt-0.5 shrink-0 text-[#d7f85b]" /> : <LockKeyhole size={17} className="mt-0.5 shrink-0 text-[#ff826c]" />}
          <p className="text-xs leading-5 text-[#ddcdbb]"><strong className={isPaper ? 'text-[#d7f85b]' : 'text-[#ff826c]'}>{isPaper ? 'PAPER MODE' : 'LIVE MODE — VISUAL PROTOTYPE ONLY'}</strong> · {isPaper ? 'XP is pretend, wallets stay out, and no order can be placed.' : 'Wallet connection and real-money execution are not active. This mode cannot trade, wager, or move funds.'}</p>
        </div>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div><p className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-[.18em]"><span className="wall-lamp h-2 w-2 rounded-full bg-[#ff826c]" /> Featured machine</p><p className="mt-1 font-mono text-[9px] uppercase tracking-[.14em] text-[#9f8e9a]">Vertical position follows the selected token's 1h move</p></div>
              <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.14em] text-[#9f8e9a]"><ArrowUp size={13} className="text-[#d7f85b]" /> lift <span className="text-[#5f5361]">/</span> pressure <ArrowDown size={13} className="text-[#ff826c]" /></div>
            </div>
            <div className="wall-checker relative overflow-hidden rounded-[26px] border-2 border-[#513548] bg-[#281d2d] p-3 shadow-[0_22px_0_#110d15,0_34px_60px_rgba(0,0,0,.26)] sm:p-6">
              <div className="relative overflow-hidden rounded-[18px] border border-[#fff4df]/10 bg-[#1b1721] px-3 pb-7 pt-5 sm:px-8">
                <div className="absolute inset-x-0 top-0 h-1 bg-[#d7f85b]" />
                <div className="flex items-center justify-between border-b border-[#fff4df]/10 pb-4"><div><p className="font-mono text-[10px] uppercase tracking-[.2em] text-[#ffd15a]">High striker / {selected.symbol}</p><p className="mt-1 font-mono text-xs text-[#9f8e9a]">{selected.name} · {selected.price}</p></div><div className="flex items-center gap-1.5 rounded-full border border-[#d7f85b]/25 bg-[#d7f85b]/[.08] px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[.12em] text-[#d7f85b]"><Eye size={12} /> signal view</div></div>
                <div className="relative mx-auto mt-6 h-[380px] max-w-[700px] sm:h-[440px]">
                  <div className="absolute left-1/2 top-0 h-full w-[104px] -translate-x-1/2 border-x-2 border-[#816171]/60 bg-[#201922] sm:w-[140px]" />
                  {[0, 1, 2, 3, 4].map((index) => <div key={index} className="absolute left-1/2 flex w-[82%] -translate-x-1/2 items-center gap-3" style={{ top: `${14 + index * 19}%` }}><span className="w-7 text-right font-mono text-[8px] text-[#705e6c]">{index === 0 ? 'BELL' : `${(4 - index) * 2}%`}</span><div className="h-px flex-1 border-t border-dashed border-[#fff4df]/10" /><span className="w-7 font-mono text-[8px] text-[#705e6c]">{index === 0 ? 'TOP' : ''}</span></div>)}
                  <div className="absolute bottom-0 left-1/2 h-[86%] w-8 -translate-x-1/2 rounded-t-full bg-[#332533] shadow-inner"><div className="absolute bottom-0 left-1/2 w-2 -translate-x-1/2 rounded-full bg-[#ff826c]" style={{ height: `${strikerPosition}%`, transition: 'height 650ms cubic-bezier(.22,1,.36,1)', boxShadow: '0 0 20px rgba(255,130,108,.35)' }} /><div className="absolute bottom-0 left-1/2 h-4 w-20 -translate-x-1/2 rounded-full border border-[#ff826c]/50 bg-[#ff826c]/20" /></div>
                  <div className="absolute left-1/2 -translate-x-1/2" style={{ bottom: `calc(${strikerPosition * .86}% - 10px)`, transition: 'bottom 650ms cubic-bezier(.22,1,.36,1)', animation: result === 'hit' ? 'wall-bounce 550ms ease-out' : undefined }}><div className="relative flex h-16 w-28 items-center justify-center rounded-[14px] border-2 border-[#fff4df] bg-[#ff826c] font-mono text-lg font-black text-[#17121b] shadow-[5px_5px_0_#8c443f]">{selected.symbol}<span className="absolute -right-3 -top-3 flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#17121b] bg-[#ffd15a]"><Zap size={14} /></span></div></div>
                  <div className="absolute left-1/2 top-[-13px] flex -translate-x-1/2 items-center gap-2 rounded-full border-2 border-[#ffd15a] bg-[#423324] px-4 py-2 text-[#ffd15a] shadow-[0_4px_0_#17121b]"><Bell size={17} /><span className="font-mono text-[10px] font-black uppercase tracking-[.18em]">Strike</span></div>
                  {result !== 'idle' && <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><div className={`rounded-full border-2 px-5 py-3 font-mono text-lg font-black uppercase tracking-[.16em] ${result === 'hit' ? 'border-[#d7f85b] bg-[#d7f85b] text-[#17121b]' : 'border-[#ff826c] bg-[#ff826c] text-[#17121b]'}`} style={{ animation: 'wall-flash 700ms ease-out both' }}>{result === 'hit' ? 'Bell hit' : 'Keep reading'}</div></div>}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#fff4df]/10 pt-4"><div className="flex items-center gap-2 font-mono text-[10px] text-[#9f8e9a]"><Flag size={13} className="text-[#ffd15a]" /> 1h movement <strong style={{ color: selected.tone }}>{movementLabel(selected.move)}</strong></div><div className="font-mono text-[9px] uppercase tracking-[.13em] text-[#705e6c]">Illustrative game feedback</div></div>
              </div>
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-[#fff4df]/12 bg-[#241b29] p-5">
              <div className="flex items-start justify-between"><div><p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.17em] text-[#ffd15a]"><Sparkles size={13} /> Make your call</p><h2 className="mt-2 font-mono text-3xl font-black tracking-[-.08em]">{directionLabel(call)}</h2></div><div className="rounded-full border border-[#ffd15a]/30 bg-[#ffd15a]/10 p-2 text-[#ffd15a]"><Zap size={17} /></div></div>
              <div className="mt-5 grid grid-cols-3 gap-2">
                {(['up', 'down', 'hold'] as Direction[]).map((direction) => <button key={direction} type="button" onClick={() => { setCall(direction); setResult('idle'); }} aria-pressed={call === direction} className={`flex flex-col items-center gap-2 rounded-xl border py-3 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d7f85b] ${call === direction ? (direction === 'up' ? 'border-[#d7f85b] bg-[#d7f85b]/10 text-[#d7f85b]' : direction === 'down' ? 'border-[#ff826c] bg-[#ff826c]/10 text-[#ff826c]' : 'border-[#67d9ee] bg-[#67d9ee]/10 text-[#67d9ee]') : 'border-[#fff4df]/10 text-[#9f8e9a] hover:border-[#fff4df]/30 hover:text-[#fff4df]'}`}>{direction === 'up' ? <ArrowUp size={18} /> : direction === 'down' ? <ArrowDown size={18} /> : <span className="text-lg leading-none">—</span>}<span className="font-mono text-[9px] font-bold uppercase tracking-[.12em]">{directionLabel(direction)}</span></button>)}
              </div>
              <button type="button" onClick={strike} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#d7f85b] px-4 py-3.5 font-mono text-[10px] font-black uppercase tracking-[.17em] text-[#17121b] shadow-[0_4px_0_#6f7e2f] transition hover:-translate-y-0.5 hover:bg-[#e2ff82] active:translate-y-0 active:shadow-none"><Bell size={15} /> Strike the bell <ChevronRight size={15} /></button>
              <button type="button" onClick={resetRound} className="mx-auto mt-3 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[.13em] text-[#9f8e9a] transition hover:text-[#fff4df]"><RotateCcw size={12} /> Reset call</button>
              <p className="mt-3 text-center font-mono text-[9px] leading-4 text-[#9f8e9a]" aria-live="polite">{notice}</p>
            </div>

            <div className="rounded-2xl border border-[#fff4df]/12 bg-[#241b29] p-5">
              <button type="button" onClick={() => setShowEvidence((open) => !open)} aria-expanded={showEvidence} className="flex w-full items-center justify-between text-left"><span className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[.17em]"><Info size={14} className="text-[#67d9ee]" /> Plain evidence</span><span className="font-mono text-[9px] text-[#9f8e9a]">{showEvidence ? 'Hide' : 'Show'}</span></button>
              {showEvidence && <div className="mt-4 space-y-3"><p className="text-xs leading-5 text-[#cdbca9]">{selected.note}</p><div className="grid grid-cols-2 gap-2">{[['5m move', movementLabel(selected.move)], ['1h move', movementLabel(selected.hour)], ['1h volume', selected.volume], ['Liquidity', selected.liquidity]].map(([label, value]) => <div key={label} className="rounded-lg border border-[#fff4df]/10 bg-[#1b1721] p-3"><p className="font-mono text-[9px] uppercase tracking-[.1em] text-[#705e6c]">{label}</p><p className="mt-1 font-mono text-sm font-bold" style={{ color: label.includes('move') ? selected.tone : '#fff4df' }}>{value}</p></div>)}</div><p className="flex gap-2 border-t border-[#fff4df]/10 pt-3 text-[10px] leading-4 text-[#9f8e9a]"><CircleHelp size={13} className="mt-0.5 shrink-0 text-[#ffd15a]" /> Evidence is descriptive, not a forecast. It can be wrong.</p></div>}
            </div>

            <div className="rounded-2xl border border-[#d7f85b]/20 bg-[#d7f85b]/[.06] p-4"><p className="flex gap-2 text-[11px] leading-5 text-[#cdbca9]"><Check size={15} className="mt-0.5 shrink-0 text-[#d7f85b]" /> Score measures how well your call matched the round's simple signal. It is not profit, a return, or a trading result.</p></div>
          </aside>
        </section>

        <section className="mt-9">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3"><div><p className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-[.18em]"><span className="h-2 w-2 rounded-full bg-[#67d9ee]" /> Waiting line</p><p className="mt-1 font-mono text-[9px] uppercase tracking-[.14em] text-[#9f8e9a]">Tap a candidate to bring it to the machine</p></div><span className="font-mono text-[9px] uppercase tracking-[.14em] text-[#705e6c]">Trending scan · static demo evidence</span></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {candidates.map((candidate, index) => <button key={candidate.symbol} type="button" onClick={() => chooseCandidate(candidate)} aria-pressed={selected.symbol === candidate.symbol} className={`group relative overflow-hidden rounded-2xl border p-4 text-left transition hover:-translate-y-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d7f85b] ${selected.symbol === candidate.symbol ? 'border-[#d7f85b] bg-[#342c28] shadow-[0_5px_0_#6f7e2f]' : 'border-[#fff4df]/12 bg-[#241b29] hover:border-[#fff4df]/30'}`}><div className="absolute right-0 top-0 h-20 w-20 rounded-bl-full opacity-10" style={{ background: candidate.tone }} /><div className="relative flex items-start justify-between gap-3"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl border" style={{ borderColor: `${candidate.tone}66`, background: `${candidate.tone}14`, color: candidate.tone }}><span className="font-mono text-[10px] font-black">{candidate.symbol.slice(0, 2)}</span></span><div><p className="font-mono text-sm font-black tracking-[.04em]">{candidate.symbol}</p><p className="mt-1 text-[10px] text-[#9f8e9a]">{candidate.name}</p></div></div><span className="font-mono text-sm font-black" style={{ color: candidate.tone }}>{movementLabel(candidate.move)}</span></div><div className="relative mt-4 flex items-center justify-between border-t border-[#fff4df]/10 pt-3"><span className="font-mono text-[9px] uppercase tracking-[.1em] text-[#705e6c]">Price {candidate.price}</span><span className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-[.1em] text-[#9f8e9a]">{selected.symbol === candidate.symbol ? 'On machine' : 'Choose'} <ChevronRight size={12} /></span></div><span className="absolute left-0 top-0 h-full w-1" style={{ background: candidate.tone }} /><span className="sr-only">Candidate {index + 1}</span></button>)}
          </div>
        </section>

        <footer className="mt-9 flex flex-col gap-3 border-t border-[#fff4df]/10 pt-5 text-[9px] uppercase tracking-[.14em] text-[#705e6c] sm:flex-row sm:items-center sm:justify-between"><div className="flex flex-wrap items-center gap-x-4 gap-y-2"><span className="flex items-center gap-1.5"><WalletCards size={12} /> No wallet needed</span><span className="flex items-center gap-1.5"><ShieldCheck size={12} /> Paper XP only</span><span className="flex items-center gap-1.5"><Radio size={12} /> Scan refresh: static demo</span></div><span className="flex items-center gap-1.5"><Sparkles size={12} className="text-[#ffd15a]" /> Learn the move, not the hype</span></footer>
      </div>
    </main>
  );
}

export default CarnivalSignalWall;