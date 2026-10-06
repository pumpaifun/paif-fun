import { useMemo, useState } from 'react';
import {
  Bell,
  Check,
  ChevronRight,
  CircleHelp,
  Gem,
  LockKeyhole,
  Sparkles,
  Star,
  Ticket,
  Trophy,
} from 'lucide-react';

type Read = {
  symbol: string;
  name: string;
  color: string;
  move: string;
  note: string;
  texture: string;
};

const READS: Read[] = [
  {
    symbol: 'NOVA',
    name: 'Nova Mesh',
    color: '#ff685d',
    move: '+6.2%',
    note: 'brightest read in this snapshot',
    texture: 'linear-gradient(135deg, #ff8a70, #f64f64)',
  },
  {
    symbol: 'KITE',
    name: 'Kite Protocol',
    color: '#3ec7b6',
    move: '+4.7%',
    note: 'a steady lift in the scan',
    texture: 'linear-gradient(135deg, #64e2c9, #26a999)',
  },
  {
    symbol: 'AXIS',
    name: 'Axis Garden',
    color: '#efb83f',
    move: '+3.3%',
    note: 'a patient positive signal',
    texture: 'linear-gradient(135deg, #ffd76b, #e7a62b)',
  },
];

const MUTED_READS = [
  { symbol: 'MINT', move: '−1.4%', color: '#a9a2a0' },
  { symbol: 'VOLT', move: '−2.6%', color: '#b5aaaa' },
  { symbol: 'FLUX', move: '−3.8%', color: '#c0b4b0' },
];

function TicketStack({ count }: { count: number }) {
  return (
    <div className="relative flex h-14 w-20 items-center justify-center" aria-label={`${count} paper tickets`}>
      <div className="absolute left-1 top-3 h-9 w-16 -rotate-6 rounded-md border-2 border-[#e7a62b] bg-[#ffd76b]" />
      <div className="absolute left-2 top-2 h-9 w-16 rotate-3 rounded-md border-2 border-[#e7a62b] bg-[#ffe59a]" />
      <div className="relative flex h-9 w-16 items-center justify-center rounded-md border-2 border-[#d99422] bg-[#fff0ba] font-['Space_Mono'] text-[11px] font-bold tracking-[-.06em] text-[#703a27]">
        <span>{count}</span>
        <span className="ml-1 text-[8px] uppercase tracking-[.08em]">tix</span>
      </div>
    </div>
  );
}

function Chest({ progress }: { progress: number }) {
  const opened = progress >= 100;
  return (
    <div className="relative h-[124px] w-[148px]" aria-label={`${progress}% treasure chest progress`}>
      <div className="absolute bottom-1 left-2 right-2 h-[70px] rounded-[18px_18px_12px_12px] border-[3px] border-[#753e2f] bg-[#e96f56] shadow-[0_6px_0_#9a4635]">
        <div className="absolute inset-x-3 top-4 h-2 rounded-full bg-[#f5a34c]/70" />
        <div className="absolute left-1/2 top-1/2 h-7 w-5 -translate-x-1/2 -translate-y-1/2 rounded-b-md border-2 border-[#71382b] bg-[#f7c451]" />
        <div className="absolute bottom-3 left-3 h-2 w-8 rounded-full bg-[#c65148]/70" />
        <div className="absolute bottom-3 right-3 h-2 w-8 rounded-full bg-[#c65148]/70" />
      </div>
      <div
        className={`absolute left-0 top-3 h-12 w-[148px] origin-bottom rounded-[16px_16px_7px_7px] border-[3px] border-[#753e2f] bg-[#f28a5d] shadow-[0_5px_0_#b54b3d] transition-transform duration-500 ${opened ? '-rotate-12' : 'rotate-0'}`}
      >
        <div className="absolute left-1/2 top-3 h-5 w-5 -translate-x-1/2 rounded-md border-2 border-[#71382b] bg-[#f7c451]" />
        <div className="absolute left-4 top-3 h-2 w-9 rounded-full bg-[#ffad69]/80" />
        <div className="absolute right-4 top-3 h-2 w-7 rounded-full bg-[#ffad69]/80" />
      </div>
      {opened && (
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 font-['Bricolage_Grotesque'] text-lg font-extrabold text-[#d55e46]">
          OPEN!
        </div>
      )}
    </div>
  );
}

function StreakPath({ round }: { round: number }) {
  const stops = ['START', '2', '3', '4', '5', '6', '7'];
  const current = Math.min(round - 1, stops.length - 1);
  return (
    <div className="relative mt-5 px-1">
      <div className="absolute left-4 right-4 top-[15px] h-1 rounded-full bg-[#e4cfb8]" />
      <div className="absolute left-4 top-[15px] h-1 rounded-full bg-[#ff685d] transition-all duration-500" style={{ width: `calc(${Math.min(100, (current / (stops.length - 1)) * 100)}% - 8px)` }} />
      <div className="relative flex items-start justify-between">
        {stops.map((stop, index) => {
          const reached = index <= current;
          const isCurrent = index === current;
          return (
            <div key={stop} className="flex w-9 flex-col items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full border-[3px] text-[9px] font-bold transition-all duration-300 ${
                  reached
                    ? 'border-[#ff685d] bg-[#ff685d] text-[#fff7e9] shadow-[0_3px_0_#c44842]'
                    : 'border-[#e4cfb8] bg-[#fff7e9] text-[#af9889]'
                } ${isCurrent ? 'scale-110 ring-4 ring-[#ff685d]/15' : ''}`}
              >
                {index === 0 ? <Star size={12} fill="currentColor" /> : reached ? <Check size={13} strokeWidth={3} /> : stop}
              </div>
              <span className={`font-['Space_Mono'] text-[8px] uppercase tracking-[.08em] ${isCurrent ? 'font-bold text-[#9c443b]' : 'text-[#af9889]'}`}>
                {isCurrent ? 'here' : stop}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PrizeRun() {
  const [round, setRound] = useState(1);
  const [tickets, setTickets] = useState(48);
  const [gems, setGems] = useState(7);
  const [xp, setXp] = useState(320);
  const [streak, setStreak] = useState(1);
  const [rung, setRung] = useState(false);
  const [showLesson, setShowLesson] = useState(false);
  const [message, setMessage] = useState('The bell is ready. One ring reveals the round.');

  const read = useMemo(() => READS[(round - 1) % READS.length], [round]);
  const chestProgress = Math.min(100, 28 + (tickets - 48) * 1.45);
  const nextChest = Math.max(0, Math.ceil((100 - chestProgress) / 1.45));

  function ringBell() {
    setRung(true);
    setTickets((value) => value + 6);
    setGems((value) => value + 1);
    setXp((value) => value + 24);
    setStreak((value) => value + 1);
    setRound((value) => value + 1);
    setMessage(`${read.symbol} rang the bell. +6 paper tickets, +1 paper gem, +24 XP. The signal can still be wrong.`);
    window.setTimeout(() => setRung(false), 900);
  }

  return (
    <main className="min-h-[100dvh] overflow-hidden bg-[#fff7e9] text-[#402b32] selection:bg-[#ffcf54] selection:text-[#402b32]">
      <style>{`
        @keyframes ticketDrift { 0%,100% { transform: translateY(0) rotate(-3deg) } 50% { transform: translateY(-7px) rotate(2deg) } }
        @keyframes bellJolt { 0%,100% { transform: rotate(0) } 25% { transform: rotate(-12deg) } 75% { transform: rotate(12deg) } }
        @keyframes ringBurst { 0% { transform: scale(.55); opacity: .8 } 100% { transform: scale(1.5); opacity: 0 } }
        @keyframes rewardPop { 0% { transform: translateY(8px) scale(.8); opacity: 0 } 35% { transform: translateY(-3px) scale(1.05); opacity: 1 } 100% { transform: translateY(-22px) scale(1); opacity: 0 } }
        .prize-stripe { background-image: repeating-linear-gradient(135deg, transparent 0 12px, rgba(255,255,255,.2) 12px 20px); }
        .paper-speckle { background-image: radial-gradient(rgba(102,61,50,.08) .8px, transparent .8px); background-size: 7px 7px; }
      `}</style>
      <div className="paper-speckle pointer-events-none fixed inset-0 opacity-40" />
      <div className="relative mx-auto max-w-[1180px] px-4 pb-10 sm:px-7 lg:px-10">
        <header className="flex flex-col gap-5 border-b-2 border-[#eddcc5] py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 rotate-[-5deg] items-center justify-center rounded-[13px] border-[3px] border-[#402b32] bg-[#ffcf54] text-[#402b32] shadow-[3px_4px_0_#e8a53f]">
              <Bell size={23} strokeWidth={2.7} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-['Bricolage_Grotesque'] text-xl font-extrabold tracking-[-.07em]">PAIF</span>
                <span className="rounded-full bg-[#402b32] px-2.5 py-1 font-['Space_Mono'] text-[8px] font-bold uppercase tracking-[.12em] text-[#fff0ba]">Prize Run</span>
              </div>
              <p className="mt-1 font-['Space_Mono'] text-[8px] uppercase tracking-[.14em] text-[#a1776c]">Learning arcade · paper rewards only</p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <div className="flex items-center gap-2 rounded-full border-2 border-[#efd9b8] bg-[#fffdf7] px-3 py-2 shadow-[0_2px_0_#e9d5bd]">
              <Ticket size={15} className="text-[#e7a62b]" />
              <span className="font-['Space_Mono'] text-[11px] font-bold text-[#74453b]">{tickets}</span>
              <span className="font-['Space_Mono'] text-[8px] uppercase tracking-[.1em] text-[#b18d79]">tickets</span>
            </div>
            <div className="flex items-center gap-2 rounded-full border-2 border-[#efd9b8] bg-[#fffdf7] px-3 py-2 shadow-[0_2px_0_#e9d5bd]">
              <Gem size={15} className="text-[#26a999]" />
              <span className="font-['Space_Mono'] text-[11px] font-bold text-[#74453b]">{gems}</span>
              <span className="font-['Space_Mono'] text-[8px] uppercase tracking-[.1em] text-[#b18d79]">gems</span>
            </div>
          </div>
        </header>

        <section className="grid gap-8 py-8 lg:grid-cols-[1fr_330px] lg:items-end lg:gap-12 lg:py-11">
          <div>
            <div className="mb-4 flex items-center gap-2 font-['Space_Mono'] text-[10px] font-bold uppercase tracking-[.16em] text-[#d55e46]">
              <span className="h-2 w-2 rounded-full bg-[#ff685d] shadow-[0_0_0_4px_#ff685d1c]" />
              Round {round} · the next tiny lesson
            </div>
            <h1 className="max-w-[710px] font-['Bricolage_Grotesque'] text-[clamp(3.3rem,8vw,6.7rem)] font-extrabold leading-[.86] tracking-[-.09em] text-[#402b32]">
              Ring once.
              <br />
              <span className="text-[#ef9e2f]">Learn a little.</span>
            </h1>
            <p className="mt-6 max-w-[590px] text-[15px] leading-7 text-[#775c59] sm:text-base">
              PAIF picks the strongest positive read in the current snapshot. You ring the bell, collect a small paper reward, and keep your place on the path. No picks between up and down. No trade is made.
            </p>
          </div>
          <div className="relative rounded-[24px] border-2 border-[#efcfaa] bg-[#fffdf7] p-5 shadow-[0_7px_0_#efd9bd]">
            <div className="flex items-center justify-between">
              <p className="font-['Space_Mono'] text-[9px] font-bold uppercase tracking-[.16em] text-[#a1776c]">Paper score</p>
              <Trophy size={19} className="text-[#e7a62b]" />
            </div>
            <p className="mt-2 font-['Bricolage_Grotesque'] text-4xl font-extrabold tracking-[-.08em] text-[#402b32]">{xp.toLocaleString()} <span className="font-['Space_Mono'] text-[12px] tracking-normal text-[#d55e46]">XP</span></p>
            <div className="mt-4 flex items-center gap-2 text-[#d55e46]">
              <Sparkles size={15} />
              <span className="font-['Space_Mono'] text-[10px] font-bold uppercase tracking-[.1em]">{streak} bell streak</span>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border-[3px] border-[#402b32] bg-[#f9e4c4] p-4 shadow-[0_9px_0_#d9ad85] sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-['Space_Mono'] text-[10px] font-bold uppercase tracking-[.16em] text-[#b84f43]">Your streak path</p>
              <h2 className="mt-1 font-['Bricolage_Grotesque'] text-2xl font-extrabold tracking-[-.06em] text-[#402b32]">Small steps, real practice.</h2>
            </div>
            <div className="rounded-full bg-[#fff5df] px-3 py-2 font-['Space_Mono'] text-[9px] font-bold uppercase tracking-[.12em] text-[#9d6d5d]">
              {Math.min(100, Math.round(((round - 1) / 6) * 100))}% of first chest
            </div>
          </div>
          <StreakPath round={round} />
        </section>

        <section className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_330px] lg:items-start">
          <div className="overflow-hidden rounded-[28px] border-[3px] border-[#402b32] bg-[#fffdf7] shadow-[0_9px_0_#edd9bd]">
            <div className="prize-stripe flex items-center justify-between border-b-2 border-[#efd9bd] bg-[#ffcf54] px-5 py-3">
              <span className="font-['Space_Mono'] text-[9px] font-bold uppercase tracking-[.15em] text-[#70402f]">The bell lane</span>
              <span className="flex items-center gap-1.5 font-['Space_Mono'] text-[9px] uppercase tracking-[.12em] text-[#70402f]"><LockKeyhole size={12} /> paper mode</span>
            </div>
            <div className="p-5 sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-['Space_Mono'] text-[10px] font-bold uppercase tracking-[.13em] text-[#b18d79]">PAIF's positive read</p>
                  <h2 className="mt-2 font-['Bricolage_Grotesque'] text-4xl font-extrabold tracking-[-.08em] text-[#402b32]">{read.name}</h2>
                  <p className="mt-1 font-['Space_Mono'] text-[10px] uppercase tracking-[.12em] text-[#a1776c]">{read.symbol} · {read.move} · {read.note}</p>
                </div>
                <div className="rounded-[15px] border-2 border-[#b8e5d7] bg-[#e8faf3] px-3 py-2 text-right">
                  <p className="font-['Space_Mono'] text-[8px] uppercase tracking-[.13em] text-[#3c8b7f]">Read strength</p>
                  <p className="mt-1 font-['Bricolage_Grotesque'] text-2xl font-extrabold tracking-[-.06em] text-[#218b7d]">bright</p>
                </div>
              </div>
              <div className="relative mt-7 flex items-center gap-4 rounded-[20px] border-2 border-[#f0dcc2] bg-[#fff8ec] p-4">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[19px] border-[3px] border-[#402b32] text-xl font-extrabold text-[#fff7e9] shadow-[4px_5px_0_#d5b183]" style={{ background: read.texture }}>
                  {read.symbol.slice(0, 2)}
                </div>
                <div className="min-w-0">
                  <p className="font-['Space_Mono'] text-[9px] font-bold uppercase tracking-[.15em] text-[#d55e46]">A best current read, not a promise</p>
                  <p className="mt-2 text-[13px] leading-5 text-[#775c59]">This is a learning prompt based on one snapshot. The read may be stale, incomplete, or wrong. Your reward is always paper-only.</p>
                </div>
              </div>
              <div className="relative">
                {rung && (
                  <>
                    <div className="pointer-events-none absolute left-1/2 top-3 h-28 w-28 -translate-x-1/2 rounded-full border-[3px] border-[#ff685d]" style={{ animation: 'ringBurst 800ms ease-out forwards' }} />
                    <div className="pointer-events-none absolute right-8 top-0 font-['Space_Mono'] text-[11px] font-bold text-[#d55e46]" style={{ animation: 'rewardPop 900ms ease-out forwards' }}>+6 TIX</div>
                  </>
                )}
                <button
                  type="button"
                  onClick={ringBell}
                  className="mt-5 flex w-full items-center justify-center gap-3 rounded-[17px] border-[3px] border-[#402b32] bg-[#ff685d] px-4 py-4 font-['Space_Mono'] text-[11px] font-bold uppercase tracking-[.12em] text-[#fff7e9] shadow-[0_6px_0_#b94440] transition-transform duration-150 hover:-translate-y-0.5 hover:bg-[#f45b55] active:translate-y-1 active:shadow-[0_2px_0_#b94440]"
                >
                  <Bell size={18} style={{ animation: rung ? 'bellJolt .45s ease-in-out' : undefined }} />
                  Ring the bell for this round
                  <ChevronRight size={17} />
                </button>
              </div>
              <p aria-live="polite" className="mt-4 text-center font-['Space_Mono'] text-[9px] leading-4 text-[#9b7770]">{message}</p>
            </div>
          </div>

          <aside className="space-y-5">
            <div className="rounded-[25px] border-[3px] border-[#402b32] bg-[#f5d8a9] p-5 shadow-[0_7px_0_#d6af82]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-['Space_Mono'] text-[10px] font-bold uppercase tracking-[.15em] text-[#9b4c3e]">Treasure ahead</p>
                  <h2 className="mt-1 font-['Bricolage_Grotesque'] text-2xl font-extrabold tracking-[-.07em] text-[#402b32]">Chest {Math.round(chestProgress)}% ready</h2>
                </div>
                <TicketStack count={tickets} />
              </div>
              <div className="mt-1 flex justify-center"><Chest progress={chestProgress} /></div>
              <div className="h-3 overflow-hidden rounded-full border-2 border-[#9f604a] bg-[#fbe9c9]">
                <div className="h-full rounded-full bg-[#3ec7b6] transition-all duration-500" style={{ width: `${chestProgress}%` }} />
              </div>
              <p className="mt-3 text-[12px] leading-5 text-[#80584c]">{nextChest > 0 ? `${nextChest} more paper tickets opens this practice chest.` : 'The practice chest is ready to open.'}</p>
              <div className="mt-4 flex items-center gap-2 rounded-xl bg-[#fff0c9]/70 px-3 py-2 font-['Space_Mono'] text-[9px] uppercase tracking-[.08em] text-[#9b634c]">
                <Gem size={14} className="text-[#218b7d]" /> +1 paper gem every ring
              </div>
            </div>

            <div className="rounded-[25px] border-2 border-[#efd9bd] bg-[#fffdf7] p-5">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-2 font-['Space_Mono'] text-[10px] font-bold uppercase tracking-[.14em] text-[#a1776c]"><CircleHelp size={14} className="text-[#d55e46]" /> Quiet context</p>
                <button type="button" onClick={() => setShowLesson((value) => !value)} aria-expanded={showLesson} className="rounded-full p-1.5 text-[#a1776c] transition-colors hover:bg-[#f9ead7] hover:text-[#d55e46]">
                  <ChevronRight size={15} className={`transition-transform duration-200 ${showLesson ? 'rotate-90' : ''}`} />
                </button>
              </div>
              <div className="mt-4 flex gap-2">
                {MUTED_READS.map((muted) => (
                  <div key={muted.symbol} className="flex-1 rounded-xl border border-[#eadfd6] bg-[#fbf8f3] p-2.5 opacity-75">
                    <p className="font-['Space_Mono'] text-[9px] font-bold text-[#8f7772]">{muted.symbol}</p>
                    <p className="mt-1 font-['Space_Mono'] text-[10px]" style={{ color: muted.color }}>{muted.move}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] leading-5 text-[#9b7770]">These reads are shown as context only. There is nothing to select here.</p>
              {showLesson && <p className="mt-3 border-t border-[#f0e2d4] pt-3 text-[11px] leading-5 text-[#a1776c]">The game spotlights one positive read so practice stays simple. A negative signal is not a challenge to chase; it is just part of the picture.</p>}
            </div>
          </aside>
        </section>

        <footer className="mt-9 flex flex-col gap-3 border-t-2 border-[#eddcc5] pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-['Space_Mono'] text-[8px] font-bold uppercase tracking-[.12em] text-[#a1776c]">
            <span className="flex items-center gap-1.5"><Ticket size={12} className="text-[#e7a62b]" /> Paper tickets only</span>
            <span className="flex items-center gap-1.5"><LockKeyhole size={12} /> No wallet</span>
            <span className="flex items-center gap-1.5"><Check size={12} className="text-[#218b7d]" /> No order placed</span>
          </div>
          <p className="font-['Space_Mono'] text-[8px] uppercase tracking-[.1em] text-[#b18d79]">Signals can be wrong · play to learn</p>
        </footer>
      </div>
    </main>
  );
}

export default PrizeRun;