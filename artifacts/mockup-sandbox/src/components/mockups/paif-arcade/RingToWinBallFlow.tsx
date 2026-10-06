import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Bell,
  Check,
  Clock3,
  Info,
  Package,
  RotateCcw,
  ScanLine,
  Sparkles,
  Star,
  Target,
  Ticket,
  Trophy,
} from 'lucide-react';

type RoundState = 'moving' | 'frozen';

const RING_START = 64;
const RING_END = 82;
const RING_CENTER = (RING_START + RING_END) / 2;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getRingCopy(distance: number) {
  if (distance <= 4) {
    return {
      title: 'Bell-ringer!',
      subtitle: 'You landed right in the ring zone.',
      points: 55,
      tickets: 4,
      tone: 'bullseye',
    };
  }
  if (distance <= 11) {
    return {
      title: 'Nice ring!',
      subtitle: 'Close timing earns a paper ticket.',
      points: 32,
      tickets: 2,
      tone: 'close',
    };
  }
  return {
    title: 'Good try!',
    subtitle: 'Watch the lane, then take another swing.',
    points: 14,
    tickets: 1,
    tone: 'try',
  };
}

function TicketBurst({ burstKey }: { burstKey: number }) {
  if (!burstKey) return null;

  return (
    <div key={burstKey} className="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-hidden="true">
      {['-left-1 top-1', 'left-1/4 -top-1', 'right-1/4 top-0', '-right-1 top-4', 'left-1/2 bottom-1'].map((position, index) => (
        <span
          key={`${burstKey}-${index}`}
          className={`absolute ${position} flex h-7 w-12 items-center justify-center rounded-sm border-2 border-[#793c28] bg-[#f7c85b] font-mono text-[8px] font-black text-[#713b27] shadow-[2px_2px_0_#9e6b28]`}
          style={{
            animation: `ticketFly${index} 820ms cubic-bezier(.2,.8,.2,1) forwards`,
            animationDelay: `${index * 35}ms`,
          }}
        >
          +TICKET
        </span>
      ))}
    </div>
  );
}

function BellMachine({ ringing }: { ringing: boolean }) {
  return (
    <div className="relative flex h-[154px] w-[142px] shrink-0 items-end justify-center" aria-label={ringing ? 'Bell is ringing' : 'Carnival bell'}>
      {ringing && (
        <span
          className="absolute left-1/2 top-2 h-28 w-28 -translate-x-1/2 rounded-full border-4 border-[#ffe18a]/75"
          style={{ animation: 'bellWave 780ms ease-out forwards' }}
          aria-hidden="true"
        />
      )}
      <div className={`absolute top-1 h-7 w-7 rounded-full border-4 border-[#7b4327] bg-[#f7c85b] shadow-[3px_3px_0_#8e5b22] ${ringing ? 'animate-[bellBob_480ms_ease-in-out_2]' : ''}`} />
      <div className={`relative z-10 h-[92px] w-[112px] origin-bottom rounded-[48%_48%_22%_22%] border-4 border-[#713c27] bg-gradient-to-b from-[#f9db78] via-[#e4a744] to-[#af672c] shadow-[7px_8px_0_#6a3425] ${ringing ? 'animate-[bellShake_440ms_ease-in-out_2]' : ''}`}>
        <div className="absolute left-1/2 top-5 h-6 w-14 -translate-x-1/2 rounded-full border-2 border-[#ffe9a1]/80 bg-[#f6c860]/75" />
        <div className="absolute bottom-4 left-1/2 h-3 w-20 -translate-x-1/2 rounded-full bg-[#8a4c27]" />
        <div className="absolute bottom-[-11px] left-1/2 h-6 w-6 -translate-x-1/2 rounded-full border-3 border-[#713c27] bg-[#f6bd4c] shadow-[2px_2px_0_#7c4528]" />
      </div>
      <div className="absolute bottom-0 h-3 w-[140px] rounded-full border-2 border-[#633527] bg-[#8e4729] shadow-[0_5px_0_#43251e]" />
    </div>
  );
}

export function RingToWinBallFlow() {
  const [roundState, setRoundState] = useState<RoundState>('moving');
  const [ballPosition, setBallPosition] = useState(18);
  const [direction, setDirection] = useState(1);
  const [round, setRound] = useState(12);
  const [xp, setXp] = useState(386);
  const [tickets, setTickets] = useState(18);
  const [chestProgress, setChestProgress] = useState(64);
  const [result, setResult] = useState<ReturnType<typeof getRingCopy> | null>(null);
  const [feedback, setFeedback] = useState('The ball is moving. Wait for the gold ring, then press Ring it.');
  const [burstKey, setBurstKey] = useState(0);
  const [snapshotAge, setSnapshotAge] = useState(2);
  const directionRef = useRef(direction);

  useEffect(() => {
    directionRef.current = direction;
  }, [direction]);

  useEffect(() => {
    if (roundState !== 'moving') return;

    const motionTimer = window.setInterval(() => {
      setBallPosition((position) => {
        const next = position + directionRef.current * 1.15;
        if (next >= 100) {
          setDirection(-1);
          return 100;
        }
        if (next <= 0) {
          setDirection(1);
          return 0;
        }
        return next;
      });
    }, 42);

    return () => window.clearInterval(motionTimer);
  }, [roundState]);

  useEffect(() => {
    const ageTimer = window.setInterval(() => setSnapshotAge((age) => (age >= 4 ? 0 : age + 1)), 60000);
    return () => window.clearInterval(ageTimer);
  }, []);

  function ringBall() {
    if (roundState === 'frozen') return;
    const distance = Math.abs(ballPosition - RING_CENTER);
    const nextResult = getRingCopy(distance);
    setRoundState('frozen');
    setResult(nextResult);
    setXp((value) => value + nextResult.points);
    setTickets((value) => value + nextResult.tickets);
    setChestProgress((value) => clamp(value + nextResult.tickets * 2, 0, 100));
    setBurstKey((value) => value + 1);
    setFeedback(`${nextResult.title} ${nextResult.subtitle}`);
  }

  function nextRound() {
    setRound((value) => value + 1);
    setBallPosition(Math.round(10 + Math.random() * 28));
    setDirection(1);
    setRoundState('moving');
    setResult(null);
    setBurstKey(0);
    setFeedback('New round. Watch the ball and ring when it crosses the gold zone.');
  }

  const moving = roundState === 'moving';
  const ballColor = result?.tone === 'bullseye' ? '#d9ff58' : result?.tone === 'close' ? '#ffd36a' : '#ff8e78';

  return (
    <main className="min-h-[100dvh] overflow-hidden bg-[#302021] text-[#fff1cb] selection:bg-[#d9ff58] selection:text-[#302021]">
      <style>{`
        @keyframes marquee { from { transform: translateX(0) } to { transform: translateX(-50%) } }
        @keyframes bellWave { 0% { transform: translateX(-50%) scale(.45); opacity: .9 } 100% { transform: translateX(-50%) scale(1.5); opacity: 0 } }
        @keyframes bellShake { 0%,100% { transform: rotate(0deg) } 25% { transform: rotate(-7deg) } 75% { transform: rotate(7deg) } }
        @keyframes bellBob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(4px) } }
        @keyframes ticketFly0 { 0% { transform: translate(50px, 74px) rotate(0); opacity: 0 } 20% { opacity: 1 } 100% { transform: translate(-14px, -42px) rotate(-24deg); opacity: 0 } }
        @keyframes ticketFly1 { 0% { transform: translate(52px, 72px) rotate(0); opacity: 0 } 20% { opacity: 1 } 100% { transform: translate(18px, -60px) rotate(18deg); opacity: 0 } }
        @keyframes ticketFly2 { 0% { transform: translate(44px, 70px) rotate(0); opacity: 0 } 20% { opacity: 1 } 100% { transform: translate(44px, -50px) rotate(31deg); opacity: 0 } }
        @keyframes ticketFly3 { 0% { transform: translate(50px, 72px) rotate(0); opacity: 0 } 20% { opacity: 1 } 100% { transform: translate(80px, -30px) rotate(-18deg); opacity: 0 } }
        @keyframes ticketFly4 { 0% { transform: translate(46px, 66px) rotate(0); opacity: 0 } 20% { opacity: 1 } 100% { transform: translate(44px, 22px) rotate(26deg); opacity: 0 } }
        @keyframes floatSign { 0%,100% { transform: rotate(-1deg) translateY(0) } 50% { transform: rotate(1deg) translateY(-3px) } }
        @keyframes glowPulse { 0%,100% { opacity: .7 } 50% { opacity: 1 } }
        .arcade-grain { background-image: radial-gradient(rgba(255,241,203,.15) .7px, transparent .7px); background-size: 5px 5px; }
        .arcade-stripes { background-image: repeating-linear-gradient(135deg, rgba(255,255,255,.045) 0 11px, transparent 11px 22px); }
      `}</style>

      <div className="mx-auto max-w-[1200px] px-4 pb-10 sm:px-7 lg:px-10">
        <header className="flex flex-col gap-5 border-b-2 border-[#7d4835] py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border-3 border-[#713c27] bg-[#d9ff58] text-[#302021] shadow-[4px_5px_0_#9e6b28]">
              <Target size={25} strokeWidth={2.6} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-['Space_Mono'] text-xl font-black tracking-[-.12em]">PAIF</span>
                <span className="rounded-full border border-[#d8a84e] bg-[#553028] px-2 py-1 font-['Space_Mono'] text-[8px] font-bold uppercase tracking-[.14em] text-[#ffd36a]">Invaders arcade</span>
              </div>
              <p className="mt-1 font-['Space_Mono'] text-[9px] uppercase tracking-[.16em] text-[#d6aa8e]">Ring to Win / station 12</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-xl border-2 border-[#7d4835] bg-[#442827] px-3 py-2">
              <p className="font-['Space_Mono'] text-[8px] uppercase tracking-[.13em] text-[#d6aa8e]">Paper XP</p>
              <p className="mt-0.5 font-['Space_Mono'] text-lg font-black text-[#d9ff58]">{xp.toLocaleString()}</p>
            </div>
            <div className="rounded-xl border-2 border-[#7d4835] bg-[#442827] px-3 py-2">
              <p className="font-['Space_Mono'] text-[8px] uppercase tracking-[.13em] text-[#d6aa8e]">Tickets</p>
              <p className="mt-0.5 flex items-center gap-1 font-['Space_Mono'] text-lg font-black text-[#ffd36a]"><Ticket size={15} />{tickets}</p>
            </div>
          </div>
        </header>

        <section className="relative overflow-hidden py-8 sm:py-10">
          <div className="pointer-events-none absolute -right-24 top-0 h-72 w-72 rounded-full bg-[#ff8e78]/20 blur-3xl" />
          <div className="relative grid gap-7 lg:grid-cols-[1fr_300px] lg:items-end">
            <div>
              <div className="mb-4 flex items-center gap-2 font-['Space_Mono'] text-[10px] font-bold uppercase tracking-[.2em] text-[#d9ff58]">
                <span className="h-2 w-2 rounded-full bg-[#ff8e78] shadow-[0_0_0_4px_#ff8e7828]" /> Round {round} / one button game
              </div>
              <h1 className="max-w-2xl font-['Bricolage_Grotesque'] text-5xl font-black leading-[.9] tracking-[-.08em] text-[#fff1cb] sm:text-7xl">
                Ring the ball.<br /><span className="text-[#ffd36a]">Catch the bell.</span>
              </h1>
              <p className="mt-5 max-w-xl text-[15px] leading-6 text-[#e4bea0] sm:text-base">
                PAIF has one positive read ready. The ball is your arcade timing object — not a price chart. Wait for the gold ring zone and press once.
              </p>
            </div>
            <div className="relative rounded-2xl border-2 border-[#d6a64f] bg-[#5a3329] p-4 shadow-[6px_7px_0_#6c3528]" style={{ animation: 'floatSign 3.5s ease-in-out infinite' }}>
              <div className="absolute -left-3 top-5 h-5 w-5 rounded-full border-2 border-[#d6a64f] bg-[#302021]" />
              <div className="absolute -right-3 top-5 h-5 w-5 rounded-full border-2 border-[#d6a64f] bg-[#302021]" />
              <p className="flex items-center gap-2 font-['Space_Mono'] text-[9px] font-bold uppercase tracking-[.16em] text-[#ffd36a]"><ScanLine size={14} /> PAIF latest snapshot</p>
              <p className="mt-2 font-['Bricolage_Grotesque'] text-2xl font-black tracking-[-.04em]">Nova Mesh</p>
              <p className="mt-1 font-['Space_Mono'] text-xs font-bold text-[#d9ff58]">+6.2% positive read</p>
              <div className="mt-3 flex items-center justify-between border-t border-[#d6a64f]/40 pt-3 font-['Space_Mono'] text-[8px] uppercase tracking-[.1em] text-[#e4bea0]">
                <span className="flex items-center gap-1"><Clock3 size={11} /> Age {snapshotAge}m</span>
                <span>Next scan in {Math.max(1, 5 - snapshotAge)}m</span>
              </div>
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden rounded-[26px] border-4 border-[#713c27] bg-[#61352c] p-3 shadow-[0_13px_0_#4a2723,0_24px_50px_rgba(18,11,13,.3)] sm:p-5">
          <div className="arcade-stripes absolute inset-0 opacity-50" />
          <div className="arcade-grain pointer-events-none absolute inset-0 opacity-30" />
          <div className="relative">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-[#c4873d] bg-[#3f2825] px-3 py-3">
              <div>
                <p className="flex items-center gap-2 font-['Space_Mono'] text-[10px] font-black uppercase tracking-[.16em] text-[#fff1cb]"><Activity size={14} className="text-[#d9ff58]" /> Timing lane</p>
                <p className="mt-1 font-['Space_Mono'] text-[8px] uppercase tracking-[.11em] text-[#d6aa8e]">{moving ? 'Ball moving — choose your moment' : 'Ball frozen — round result shown below'}</p>
              </div>
              <span className={`rounded-full border px-3 py-1.5 font-['Space_Mono'] text-[8px] font-black uppercase tracking-[.12em] ${moving ? 'border-[#d9ff58]/50 bg-[#d9ff58]/10 text-[#d9ff58]' : 'border-[#ffd36a]/60 bg-[#ffd36a]/10 text-[#ffd36a]'}`}>
                {moving ? 'Ready / moving' : 'Frozen result'}
              </span>
            </div>

            <div className="relative mt-5 rounded-2xl border-2 border-[#713c27] bg-[#2c2222] px-3 pb-7 pt-10 sm:px-8">
              <div className="absolute left-3 right-3 top-3 flex justify-between font-['Space_Mono'] text-[8px] font-bold uppercase tracking-[.12em] text-[#a87863] sm:left-8 sm:right-8">
                <span>Start</span><span>Ring zone</span><span>End</span>
              </div>
              <div className="relative h-28 rounded-full border-4 border-[#512c29] bg-[#1f1b1d] shadow-[inset_0_5px_0_#161315] sm:h-32">
                <div className="absolute inset-y-0 left-[64%] w-[18%] border-x-4 border-[#d6a64f] bg-[#ffd36a]/25 shadow-[0_0_22px_#ffd36a55]">
                  <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center font-['Space_Mono'] text-[9px] font-black uppercase tracking-[.14em] text-[#ffe7a1]">Ring it</div>
                </div>
                <div className="absolute inset-y-0 left-[5%] right-[5%]">
                  <div
                    className="absolute top-1/2 flex h-[62px] w-[62px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-4 border-[#713c27] bg-[#ff8e78] shadow-[5px_6px_0_#713c27,0_0_20px_#ff8e7866] transition-[left] duration-75 ease-linear sm:h-[70px] sm:w-[70px]"
                    style={{ left: `${ballPosition}%`, backgroundColor: moving ? '#ff8e78' : ballColor }}
                    aria-label={`Arcade ball at ${Math.round(ballPosition)} percent of the lane`}
                  >
                    <span className="h-4 w-4 rounded-full border-2 border-[#fff1cb]/80 bg-[#ffd36a]" />
                    <span className="absolute left-1/2 top-1/2 h-[72px] w-[72px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#ff8e78]/20" />
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between font-['Space_Mono'] text-[8px] uppercase tracking-[.12em] text-[#a87863]">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#ff8e78]" /> Moving game object</span>
                <span className="flex items-center gap-1 text-[#ffd36a]"><span className="h-2 w-2 rounded-full bg-[#ffd36a]" /> Gold timing zone</span>
              </div>
            </div>

            <div className="relative mt-5 grid gap-5 md:grid-cols-[1fr_270px] md:items-center">
              <div className="relative min-h-[168px] overflow-hidden rounded-2xl border-2 border-[#bd793a] bg-[#472a27] p-4 sm:p-5">
                <TicketBurst burstKey={burstKey} />
                <div className="relative z-10 flex items-center gap-4">
                  <BellMachine ringing={!moving} />
                  <div className="min-w-0">
                    <p className="font-['Space_Mono'] text-[9px] font-black uppercase tracking-[.17em] text-[#ffd36a]">{moving ? 'Your turn' : 'Round ticket'}</p>
                    <p className="mt-2 font-['Bricolage_Grotesque'] text-3xl font-black leading-none tracking-[-.07em] text-[#fff1cb]">{result?.title ?? 'Ready when you are'}</p>
                    <p className="mt-2 max-w-[300px] text-xs leading-5 text-[#e4bea0]">{result?.subtitle ?? 'One obvious move: wait for the gold zone, then ring the bell.'}</p>
                  </div>
                </div>
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={moving ? ringBall : nextRound}
                  className={`group flex min-h-[74px] w-full items-center justify-center gap-3 rounded-2xl border-4 border-[#713c27] px-4 py-4 font-['Space_Mono'] text-[12px] font-black uppercase tracking-[.13em] shadow-[0_7px_0_#8e5b22] transition-transform hover:-translate-y-0.5 active:translate-y-1 active:shadow-[0_2px_0_#8e5b22] ${moving ? 'bg-[#d9ff58] text-[#302021]' : 'bg-[#ffd36a] text-[#302021]'}`}
                  aria-label={moving ? 'Ring the bell now' : 'Start the next round'}
                >
                  {moving ? <Bell size={21} className="transition-transform group-hover:rotate-12" /> : <RotateCcw size={21} />}
                  {moving ? 'Ring it' : 'Next round'}
                  <ArrowRight size={18} />
                </button>
                <p className="mt-3 text-center font-['Space_Mono'] text-[9px] uppercase tracking-[.1em] text-[#e4bea0]" aria-live="polite">{feedback}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
          <div className="rounded-2xl border-2 border-[#7d4835] bg-[#442827] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 font-['Space_Mono'] text-[10px] font-black uppercase tracking-[.15em] text-[#d9ff58]"><Star size={14} /> One current positive read</p>
                <h2 className="mt-3 font-['Bricolage_Grotesque'] text-3xl font-black tracking-[-.06em]">Nova Mesh</h2>
                <p className="mt-1 font-['Space_Mono'] text-[10px] uppercase tracking-[.12em] text-[#d6aa8e]">PAIF snapshot / +6.2% movement</p>
              </div>
              <div className="rounded-xl border border-[#b87b3c] bg-[#54302a] px-3 py-2 text-right">
                <p className="font-['Space_Mono'] text-[8px] uppercase tracking-[.1em] text-[#d6aa8e]">Read status</p>
                <p className="mt-1 flex items-center gap-1 font-['Space_Mono'] text-[10px] font-black text-[#d9ff58]"><Check size={13} /> Current</p>
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="rounded-xl border border-[#6f493b] bg-[#342425] p-3">
                <p className="flex items-center gap-2 font-['Space_Mono'] text-[8px] font-bold uppercase tracking-[.12em] text-[#ffd36a]"><Info size={13} /> Keep the meanings separate</p>
                <p className="mt-2 text-[12px] leading-5 text-[#e4bea0]">The snapshot tells you what PAIF read most recently. The moving ball only tests your timing. It does not redraw, predict, or stream market prices.</p>
              </div>
              <div className="rounded-xl border border-[#6f493b] bg-[#342425] px-4 py-3 sm:min-w-[176px]">
                <p className="font-['Space_Mono'] text-[8px] uppercase tracking-[.1em] text-[#d6aa8e]">Production cadence</p>
                <p className="mt-1 flex items-center gap-2 font-['Space_Mono'] text-sm font-black text-[#ffd36a]"><Clock3 size={15} /> Every 5 minutes</p>
              </div>
            </div>
            <div className="mt-4 flex items-start gap-2 border-t border-[#6f493b] pt-4 text-[11px] leading-5 text-[#bb8d76]">
              <Activity size={14} className="mt-0.5 shrink-0 text-[#ff8e78]" />
              <span>Small background context only: Mintline −1.4% · Volt Arcade −2.6% · Flux Harbor −3.8%. These reads are not selectable.</span>
            </div>
          </div>

          <div className="rounded-2xl border-2 border-[#7d4835] bg-[#442827] p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 font-['Space_Mono'] text-[10px] font-black uppercase tracking-[.15em] text-[#ffd36a]"><Package size={15} /> Treasure chest</p>
              <span className="rounded-full bg-[#d9ff58]/10 px-2 py-1 font-['Space_Mono'] text-[8px] font-bold uppercase tracking-[.12em] text-[#d9ff58]">paper only</span>
            </div>
            <div className="mt-4 flex items-end justify-between">
              <div>
                <p className="font-['Bricolage_Grotesque'] text-4xl font-black tracking-[-.08em]">{chestProgress}<span className="text-xl text-[#d6aa8e]">%</span></p>
                <p className="mt-1 font-['Space_Mono'] text-[9px] uppercase tracking-[.1em] text-[#d6aa8e]">to the next chest</p>
              </div>
              <Trophy size={34} className="text-[#ffd36a]" />
            </div>
            <div className="mt-4 h-4 overflow-hidden rounded-full border-2 border-[#713c27] bg-[#2b2021] p-0.5">
              <div className="h-full rounded-full bg-gradient-to-r from-[#ff8e78] via-[#ffd36a] to-[#d9ff58] transition-[width] duration-500" style={{ width: `${chestProgress}%` }} />
            </div>
            <p className="mt-4 flex items-start gap-2 text-[11px] leading-5 text-[#e4bea0]"><Sparkles size={14} className="mt-0.5 shrink-0 text-[#ffd36a]" />Land in the ring to add paper tickets and move the chest closer. No cash, wallet, wager, or redemption here.</p>
          </div>
        </section>

        <footer className="mt-8 flex flex-col gap-3 border-t-2 border-[#7d4835] pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-['Space_Mono'] text-[9px] font-bold uppercase tracking-[.12em] text-[#bb8d76]">
            <span className="flex items-center gap-1.5"><Ticket size={12} /> Paper tickets + XP</span>
            <span className="flex items-center gap-1.5"><Clock3 size={12} /> Snapshot refresh: 5 min</span>
          </div>
          <span className="font-['Space_Mono'] text-[9px] font-bold uppercase tracking-[.12em] text-[#d9ff58]">Learn the read. Play the moment.</span>
        </footer>
      </div>
    </main>
  );
}

export default RingToWinBallFlow;