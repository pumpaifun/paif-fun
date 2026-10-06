import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  CircleHelp,
  Flame,
  Gem,
  LockKeyhole,
  RotateCcw,
  Sparkles,
  Ticket,
  VolumeX,
} from 'lucide-react';

type Signal = {
  symbol: string;
  name: string;
  color: string;
  soft: string;
  move: number;
  volume: string;
  note: string;
};

const SIGNALS: Signal[] = [
  { symbol: 'NOVA', name: 'Nova Mesh', color: '#d9f06e', soft: '#eef8bd', move: 6.2, volume: '$2.8M', note: 'Strongest lift in this snapshot' },
  { symbol: 'KITE', name: 'Kite Protocol', color: '#ff9b66', soft: '#ffe0c9', move: 4.7, volume: '$1.9M', note: 'Climbing with steady activity' },
  { symbol: 'AXIS', name: 'Axis Garden', color: '#71d9d0', soft: '#d3f3ee', move: 3.3, volume: '$1.1M', note: 'Positive, measured movement' },
  { symbol: 'ORB', name: 'Orbit Link', color: '#a7baff', soft: '#e0e5ff', move: 2.1, volume: '$824K', note: 'Small lift, worth watching' },
  { symbol: 'LUME', name: 'Lume Core', color: '#f0a7db', soft: '#f8dcf0', move: 1.6, volume: '$593K', note: 'Quietly moving upward' },
  { symbol: 'MINT', name: 'Mintline', color: '#ef91ae', soft: '#f9d8e3', move: -1.4, volume: '$506K', note: 'Negative context only' },
  { symbol: 'VOLT', name: 'Volt Arcade', color: '#ed786f', soft: '#f8d0cc', move: -2.6, volume: '$790K', note: 'Negative context only' },
];

const REEL_SYMBOLS = ['NOVA', 'KITE', 'AXIS', 'ORB', 'LUME', 'MINT', 'VOLT', 'PAIF', 'NOVA'];

function SignalDot({ signal, active }: { signal: Signal; active?: boolean }) {
  return (
    <span
      className={`inline-flex h-8 min-w-8 items-center justify-center rounded-[10px] border-2 px-1.5 font-mono text-[9px] font-black tracking-[-.04em] transition ${
        active ? 'scale-110 border-[#37194f] shadow-[2px_3px_0_#37194f]' : 'border-[#5d456c]/20'
      }`}
      style={{ background: signal.soft, color: '#37194f' }}
    >
      {signal.symbol}
    </span>
  );
}

export function LuckyBellReel() {
  const best = useMemo(() => SIGNALS.reduce((top, signal) => (signal.move > top.move ? signal : top), SIGNALS[0]), []);
  const [spinning, setSpinning] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [round, setRound] = useState(12);
  const [xp, setXp] = useState(1840);
  const [tickets, setTickets] = useState(18);
  const [gems, setGems] = useState(420);
  const [streak, setStreak] = useState(4);
  const [showEvidence, setShowEvidence] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  function ringBell() {
    if (spinning) return;
    setSpinning(true);
    setRevealed(false);
    setShowEvidence(false);
    timerRef.current = setTimeout(() => {
      setSpinning(false);
      setRevealed(true);
      setRound((current) => current + 1);
      setXp((current) => current + 35);
      setTickets((current) => current + 1);
      setGems((current) => current + 12);
      setStreak((current) => current + 1);
    }, 1650);
  }

  function resetRun() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setSpinning(false);
    setRevealed(false);
    setRound(12);
    setXp(1840);
    setTickets(18);
    setGems(420);
    setStreak(4);
    setShowEvidence(false);
  }

  return (
    <main className="paif-reel relative min-h-[100dvh] overflow-hidden bg-[#f5e7d2] text-[#37194f] selection:bg-[#ff795f] selection:text-[#fff8ed]">
      <style>{`
        @keyframes reelSpin { 0% { transform: translateY(0); } 100% { transform: translateY(-62%); } }
        @keyframes reelSettle { 0% { transform: translateY(-18px) rotate(-2deg); } 55% { transform: translateY(5px) rotate(1deg); } 100% { transform: translateY(0) rotate(0); } }
        @keyframes ringBell { 0%, 100% { transform: rotate(0deg); } 18% { transform: rotate(13deg); } 36% { transform: rotate(-12deg); } 54% { transform: rotate(8deg); } 72% { transform: rotate(-5deg); } }
        @keyframes popIn { 0% { opacity: 0; transform: translateY(12px) scale(.94); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes confetti { 0% { transform: translateY(8px) scale(.4) rotate(0); opacity: 0; } 30% { opacity: 1; } 100% { transform: translateY(-54px) scale(1) rotate(170deg); opacity: 0; } }
        @keyframes ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @keyframes littleBob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
        .paif-reel::before { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: .22; background-image: radial-gradient(#7d557d 0.7px, transparent 0.7px); background-size: 7px 7px; mix-blend-mode: multiply; }
        .reel-spinning { animation: reelSpin 1.45s cubic-bezier(.2,.78,.25,1) forwards; }
        .reel-settle { animation: reelSettle .55s cubic-bezier(.2,.8,.2,1) both; }
        .reward-pop { animation: popIn .55s cubic-bezier(.2,.9,.2,1) both; }
        .ringing { animation: ringBell .65s ease-in-out; transform-origin: 50% 20%; }
        .marquee-track { animation: ticker 28s linear infinite; }
        .little-bob { animation: littleBob 2.2s ease-in-out infinite; }
      `}</style>

      <div className="relative mx-auto max-w-[1240px] px-4 pb-10 sm:px-7 lg:px-10">
        <header className="flex flex-col gap-5 border-b-2 border-[#37194f]/15 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="relative flex h-12 w-12 rotate-[-4deg] items-center justify-center rounded-[15px] border-2 border-[#37194f] bg-[#ff795f] shadow-[4px_5px_0_#37194f]">
              <Bell size={24} strokeWidth={2.6} />
              <span className="absolute -right-1 -top-2 h-3 w-3 rounded-full border-2 border-[#37194f] bg-[#d9f06e]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xl font-black tracking-[-.12em]">PAIF</span>
                <span className="rounded-full border border-[#37194f]/25 bg-[#fff8ed]/60 px-2.5 py-1 font-mono text-[8px] font-bold uppercase tracking-[.18em]">Invaders arcade</span>
              </div>
              <p className="mt-1 font-mono text-[9px] font-bold uppercase tracking-[.18em] text-[#745477]">Lucky bell reel / station 12</p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <div className="flex items-center gap-2 rounded-full border-2 border-[#37194f]/20 bg-[#fff8ed]/65 px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[.12em] text-[#745477]">
              <VolumeX size={13} /> Soundless play
            </div>
            <button type="button" onClick={resetRun} aria-label="Reset paper run" className="rounded-full border-2 border-[#37194f]/20 bg-[#fff8ed]/65 p-2.5 text-[#37194f] transition hover:-rotate-12 hover:bg-[#fff8ed]">
              <RotateCcw size={15} />
            </button>
          </div>
        </header>

        <section className="grid gap-8 py-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-end lg:py-11">
          <div>
            <div className="mb-4 flex items-center gap-2 font-mono text-[10px] font-black uppercase tracking-[.2em] text-[#d34f54]">
              <span className="h-2.5 w-2.5 rounded-full bg-[#d34f54] shadow-[0_0_0_4px_#d34f5425]" /> Paper round {round}
            </div>
            <h1 className="max-w-3xl font-['Bricolage_Grotesque'] text-[clamp(3.6rem,10vw,8.8rem)] font-black leading-[.8] tracking-[-.095em] text-[#37194f]">
              Ring the<br /><span className="text-[#d34f54]">read.</span>
            </h1>
            <p className="mt-6 max-w-xl text-[15px] leading-6 text-[#5e456c] sm:text-base">
              One button. One best current signal. PAIF loads the strongest positive read, spins the reel, and hands you a tiny paper reward for paying attention.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[9px] font-bold uppercase tracking-[.13em] text-[#745477]">
              <span className="flex items-center gap-1.5"><LockKeyhole size={12} /> Learning only</span>
              <span className="flex items-center gap-1.5"><Activity size={12} /> Snapshot refreshed 32s ago</span>
              <span className="flex items-center gap-1.5"><Sparkles size={12} /> No trades or wallets</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-[18px] border-2 border-[#37194f] bg-[#ffca57] p-3 shadow-[3px_4px_0_#37194f]">
              <Ticket size={17} />
              <p className="mt-4 font-mono text-xl font-black">{tickets}</p>
              <p className="mt-1 font-mono text-[8px] font-bold uppercase tracking-[.12em]">Tickets</p>
            </div>
            <div className="translate-y-2 rounded-[18px] border-2 border-[#37194f] bg-[#d9f06e] p-3 shadow-[3px_4px_0_#37194f]">
              <Gem size={17} />
              <p className="mt-4 font-mono text-xl font-black">{gems}</p>
              <p className="mt-1 font-mono text-[8px] font-bold uppercase tracking-[.12em]">Gems</p>
            </div>
            <div className="rounded-[18px] border-2 border-[#37194f] bg-[#a7baff] p-3 shadow-[3px_4px_0_#37194f]">
              <Flame size={17} />
              <p className="mt-4 font-mono text-xl font-black">{streak}</p>
              <p className="mt-1 font-mono text-[8px] font-bold uppercase tracking-[.12em]">Streak</p>
            </div>
          </div>
        </section>

        <div className="overflow-hidden rounded-full border-2 border-[#37194f] bg-[#fff8ed] py-2.5 shadow-[3px_4px_0_#37194f]">
          <div className="marquee-track flex w-max items-center gap-7 whitespace-nowrap font-mono text-[9px] font-bold uppercase tracking-[.16em] text-[#745477]">
            {[...SIGNALS, ...SIGNALS].map((signal, index) => (
              <span className="flex items-center gap-2" key={`${signal.symbol}-${index}`}>
                <span className="h-2 w-2 rounded-full" style={{ background: signal.color }} />
                {signal.symbol} <strong className={signal.move > 0 ? 'text-[#31856f]' : 'text-[#d34f54]'}>{signal.move > 0 ? '+' : ''}{signal.move.toFixed(1)}%</strong>
              </span>
            ))}
          </div>
        </div>

        <section className="relative mt-6 overflow-hidden rounded-[30px] border-2 border-[#37194f] bg-[#ff795f] p-3 shadow-[7px_8px_0_#37194f] sm:p-5">
          <div className="pointer-events-none absolute -right-10 -top-12 h-48 w-48 rounded-full border-[26px] border-[#ffca57]/50" />
          <div className="pointer-events-none absolute -bottom-20 left-1/3 h-44 w-44 rounded-full border-[22px] border-[#d9f06e]/45" />
          <div className="relative grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="rounded-[22px] border-2 border-[#37194f] bg-[#fff8ed] p-4 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="flex items-center gap-2 font-mono text-[10px] font-black uppercase tracking-[.17em] text-[#d34f54]"><Sparkles size={14} /> Auto-loaded best read</p>
                  <h2 className="mt-2 font-['Bricolage_Grotesque'] text-3xl font-black tracking-[-.07em] sm:text-4xl">{best.name}</h2>
                  <p className="mt-1 font-mono text-[10px] font-bold uppercase tracking-[.13em] text-[#745477]">{best.symbol} · positive movement {best.move > 0 ? '+' : ''}{best.move.toFixed(1)}%</p>
                </div>
                <div className="rounded-xl border-2 border-[#37194f]/15 bg-[#f5e7d2] px-3 py-2 text-right">
                  <p className="font-mono text-[8px] font-bold uppercase tracking-[.13em] text-[#745477]">Read strength</p>
                  <p className="mt-1 font-mono text-2xl font-black">{Math.round((best.move / 6.2) * 100)}<span className="text-sm">/100</span></p>
                </div>
              </div>

              <div className="relative mx-auto mt-5 max-w-[520px] rounded-[23px] border-2 border-[#37194f] bg-[#37194f] p-3 shadow-[4px_5px_0_#c84f4b]">
                <div className="absolute left-1/2 top-[-11px] z-10 h-5 w-5 -translate-x-1/2 rotate-45 border-l-2 border-t-2 border-[#37194f] bg-[#ffca57]" />
                <div className="absolute bottom-[-11px] left-1/2 z-10 h-5 w-5 -translate-x-1/2 rotate-45 border-b-2 border-r-2 border-[#37194f] bg-[#ffca57]" />
                <div className="flex items-center justify-between border-b border-[#fff8ed]/20 px-2 pb-2 font-mono text-[8px] font-bold uppercase tracking-[.16em] text-[#f8d8ba]">
                  <span>Signal reel</span><span>{spinning ? 'Reading...' : revealed ? 'Read landed' : 'Ready when you are'}</span>
                </div>
                <div className="relative mt-3 h-[142px] overflow-hidden rounded-[15px] border-2 border-[#745477] bg-[#5b2d66]">
                  <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-[#37194f] to-transparent opacity-80" />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-t from-[#37194f] to-transparent opacity-80" />
                  <div className="absolute inset-x-0 top-1/2 z-20 h-12 -translate-y-1/2 border-y-2 border-[#ffca57] bg-[#ffca57]/10" />
                  <div className={`relative flex flex-col items-center gap-2 py-0 ${spinning ? 'reel-spinning' : revealed ? 'reel-settle' : ''}`}>
                    {[...REEL_SYMBOLS, ...REEL_SYMBOLS].map((symbol, index) => {
                      const signal = SIGNALS.find((item) => item.symbol === symbol) ?? best;
                      return <div className="flex h-[58px] items-center gap-3 font-mono text-2xl font-black tracking-[-.1em] text-[#fff8ed]" key={`${symbol}-${index}`}><SignalDot signal={signal} active={!spinning && revealed && symbol === best.symbol && index > 7} /> <span>{symbol}</span></div>;
                    })}
                  </div>
                  <span className="absolute left-3 top-1/2 z-30 -translate-y-1/2 font-mono text-[8px] font-black uppercase tracking-[.12em] text-[#ffca57] [writing-mode:vertical-rl]">land here</span>
                </div>
              </div>

              <div className="mt-5 flex flex-col items-center">
                <button
                  type="button"
                  onClick={ringBell}
                  disabled={spinning}
                  className="group relative flex w-full max-w-[390px] items-center justify-center gap-3 rounded-[18px] border-2 border-[#37194f] bg-[#d9f06e] px-5 py-4 font-mono text-[13px] font-black uppercase tracking-[.13em] text-[#37194f] shadow-[0_6px_0_#37194f] transition hover:-translate-y-1 hover:bg-[#eef8bd] active:translate-y-1 active:shadow-[0_2px_0_#37194f] disabled:cursor-wait disabled:opacity-80"
                >
                  <Bell size={21} className={spinning ? 'ringing' : 'transition group-hover:rotate-[-10deg]'} />
                  {spinning ? 'Reel is reading' : 'Ring the bell'}
                  <span className="absolute -right-2 -top-2 rounded-full border-2 border-[#37194f] bg-[#ffca57] px-2 py-1 font-mono text-[8px] tracking-[.08em] shadow-[2px_2px_0_#37194f]">FREE PLAY</span>
                </button>
                <p className="mt-3 text-center font-mono text-[9px] font-bold uppercase tracking-[.12em] text-[#745477]">No choice between up or down · just notice the read</p>
              </div>

              {revealed && (
                <div className="reward-pop relative mx-auto mt-5 max-w-[390px] rounded-[16px] border-2 border-[#37194f] bg-[#ffca57] p-4 text-center shadow-[3px_4px_0_#37194f]">
                  <span className="pointer-events-none absolute left-[18%] top-2 h-2 w-2 rounded-full bg-[#d34f54]" style={{ animation: 'confetti .85s ease-out both' }} />
                  <span className="pointer-events-none absolute right-[18%] top-2 h-2 w-2 rounded-full bg-[#71d9d0]" style={{ animation: 'confetti .95s .08s ease-out both' }} />
                  <p className="font-mono text-[10px] font-black uppercase tracking-[.17em]">Bell landed on {best.symbol}</p>
                  <p className="mt-1 font-['Bricolage_Grotesque'] text-2xl font-black tracking-[-.05em]">+35 paper XP · +1 ticket</p>
                  <p className="mt-1 text-[11px] text-[#5e456c]">A tiny receipt for showing up. The read can still be wrong.</p>
                </div>
              )}
            </div>

            <aside className="flex flex-col gap-4">
              <div className="little-bob rounded-[22px] border-2 border-[#37194f] bg-[#ffca57] p-5 shadow-[3px_4px_0_#37194f]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] font-black uppercase tracking-[.16em]">PAIF's read</p>
                    <p className="mt-3 font-['Bricolage_Grotesque'] text-2xl font-black leading-[.95] tracking-[-.06em]">Look for lift,<br />not a promise.</p>
                  </div>
                  <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-[17px] border-2 border-[#37194f] bg-[#d9f06e] shadow-[3px_3px_0_#37194f]">
                    <span className="absolute left-3 top-4 h-2 w-2 rounded-full bg-[#37194f]" /><span className="absolute right-3 top-4 h-2 w-2 rounded-full bg-[#37194f]" /><span className="absolute bottom-3 left-1/2 h-1 w-5 -translate-x-1/2 rounded-full bg-[#d34f54]" />
                  </div>
                </div>
                <p className="mt-4 border-t border-[#37194f]/20 pt-3 text-[12px] leading-5 text-[#5e456c]">The reel is preloaded from the strongest positive movement in this demo snapshot. It is a learning prompt, never an outcome.</p>
              </div>

              <div className="rounded-[22px] border-2 border-[#37194f] bg-[#fff8ed] p-5 shadow-[3px_4px_0_#37194f]">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-2 font-mono text-[10px] font-black uppercase tracking-[.16em]"><Activity size={14} /> Around the reel</p>
                  <button type="button" onClick={() => setShowEvidence((open) => !open)} aria-expanded={showEvidence} className="rounded-lg p-1.5 text-[#745477] transition hover:bg-[#f5e7d2] hover:text-[#37194f]"><CircleHelp size={16} /></button>
                </div>
                <div className="mt-4 space-y-2">
                  {SIGNALS.filter((signal) => signal.move > 0 && signal.symbol !== best.symbol).slice(0, 3).map((signal) => (
                    <div className="flex items-center justify-between rounded-xl border border-[#37194f]/10 bg-[#f5e7d2]/70 px-2.5 py-2" key={signal.symbol}>
                      <div className="flex items-center gap-2"><SignalDot signal={signal} /><span className="font-mono text-[9px] font-black">{signal.name}</span></div>
                      <span className="font-mono text-[10px] font-black text-[#31856f]">+{signal.move.toFixed(1)}%</span>
                    </div>
                  ))}
                  {SIGNALS.filter((signal) => signal.move < 0).map((signal) => (
                    <div className="flex items-center justify-between rounded-xl border border-[#d34f54]/15 bg-[#f9d8e3]/40 px-2.5 py-2 opacity-75" key={signal.symbol} aria-label={`${signal.name}, negative context, not selectable`}>
                      <div className="flex items-center gap-2"><SignalDot signal={signal} /><span className="font-mono text-[9px] font-black text-[#745477]">{signal.name}</span></div>
                      <span className="flex items-center gap-1 font-mono text-[10px] font-black text-[#d34f54]"><ArrowDownRight size={12} />{signal.move.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
                {showEvidence && <p className="mt-4 border-t border-[#37194f]/15 pt-3 text-[11px] leading-5 text-[#745477]">Negative signals stay here as context only. Nothing on this board is a forecast, a trade instruction, or a guarantee.</p>}
              </div>

              <div className="rounded-[22px] border-2 border-[#37194f] bg-[#71d9d0] p-5 shadow-[3px_4px_0_#37194f]">
                <p className="flex items-center gap-2 font-mono text-[10px] font-black uppercase tracking-[.16em]"><Ticket size={14} /> Paper progress</p>
                <div className="mt-3 flex items-end justify-between"><span className="font-['Bricolage_Grotesque'] text-3xl font-black tracking-[-.08em]">{xp.toLocaleString()}</span><span className="font-mono text-[9px] font-black uppercase tracking-[.12em]">XP</span></div>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full border-2 border-[#37194f] bg-[#fff8ed]/65"><div className="h-full rounded-full bg-[#d34f54] transition-all duration-500" style={{ width: `${Math.min(100, (xp % 2500) / 25)}%` }} /></div>
                <p className="mt-3 text-[11px] leading-5 text-[#315e62]">Collect paper XP, tickets, gems, and streaks. They stay inside this arcade.</p>
              </div>
            </aside>
          </div>
        </section>

        <footer className="flex flex-col gap-3 border-t-2 border-[#37194f]/15 py-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 font-mono text-[9px] font-bold uppercase tracking-[.14em] text-[#745477]"><ArrowUpRight size={13} className="text-[#31856f]" /> Movement is a lesson, not a promise.</p>
          <p className="font-mono text-[9px] font-bold uppercase tracking-[.14em] text-[#745477]">PAIF arcade · paper play only</p>
        </footer>
      </div>
    </main>
  );
}

export default LuckyBellReel;