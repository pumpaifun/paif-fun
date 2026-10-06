import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUp,
  Bell,
  Check,
  Gem,
  Gauge,
  Info,
  RotateCcw,
  Sparkles,
  Target,
  Ticket,
  Trophy,
  Zap,
} from 'lucide-react';

type Token = {
  symbol: string;
  name: string;
  move: number;
  hue: string;
};

const POSITIVE_READ: Token = {
  symbol: 'NOVA',
  name: 'Nova Mesh',
  move: 6.2,
  hue: '#17a887',
};

const CONTEXT_SIGNALS: Token[] = [
  { symbol: 'KITE', name: 'Kite Protocol', move: 4.7, hue: '#ef9b42' },
  { symbol: 'AXIS', name: 'Axis Garden', move: 3.3, hue: '#4b9bc0' },
  { symbol: 'MINT', name: 'Mintline', move: -1.4, hue: '#d36876' },
  { symbol: 'VOLT', name: 'Volt Arcade', move: -2.6, hue: '#c6555b' },
];

const TARGET_ZONE = { start: 57, end: 70 };

function scoreForPosition(position: number) {
  if (position >= TARGET_ZONE.start && position <= TARGET_ZONE.end) return 120;
  if (position >= 47 && position <= 80) return 72;
  return 28;
}

function MeterTick({ label, top, strong = false }: { label: string; top: string; strong?: boolean }) {
  return (
    <div className="absolute left-0 flex w-full -translate-y-1/2 items-center gap-2" style={{ top }}>
      <span className={`h-px w-3 ${strong ? 'bg-[#ffefb0]' : 'bg-[#d4a36c]/55'}`} />
      <span className={`font-mono text-[9px] uppercase tracking-[0.14em] ${strong ? 'font-bold text-[#fff4c9]' : 'text-[#d4a36c]'}`}>
        {label}
      </span>
    </div>
  );
}

export function HighStrikerSkillHit() {
  const [position, setPosition] = useState(18);
  const [direction, setDirection] = useState(1);
  const [isRinging, setIsRinging] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [score, setScore] = useState(2480);
  const [streak, setStreak] = useState(3);
  const [tickets, setTickets] = useState(42);
  const [gems, setGems] = useState(1320);
  const [lastHit, setLastHit] = useState<number | null>(null);
  const [message, setMessage] = useState('Watch the light. Ring when it reaches the gold stripe.');

  useEffect(() => {
    if (isRinging) return undefined;
    const timer = window.setInterval(() => {
      setPosition((current) => {
        const next = current + direction * 1.45;
        if (next >= 92) {
          setDirection(-1);
          return 92;
        }
        if (next <= 8) {
          setDirection(1);
          return 8;
        }
        return next;
      });
    }, 28);
    return () => window.clearInterval(timer);
  }, [direction, isRinging]);

  const accuracy = useMemo(() => scoreForPosition(position), [position]);
  const inGold = position >= TARGET_ZONE.start && position <= TARGET_ZONE.end;

  function ringBell() {
    if (isRinging) return;
    const hit = scoreForPosition(position);
    setIsRinging(true);
    setLastHit(hit);
    setAttempts((current) => current + 1);
    setScore((current) => current + hit);
    setTickets((current) => current + (hit >= 120 ? 3 : 1));
    setGems((current) => current + (hit >= 120 ? 24 : 8));
    setStreak((current) => (hit >= 72 ? current + 1 : 0));
    setMessage(
      hit >= 120
        ? 'Bullseye timing. The bell is a paper-game score, not a trade.'
        : hit >= 72
          ? 'Nice read. Try to land the light inside the gold stripe next round.'
          : 'The light slipped past. Reset the meter and take another learning shot.',
    );
  }

  function resetAttempt() {
    setIsRinging(false);
    setPosition(18);
    setDirection(1);
    setLastHit(null);
    setMessage('Watch the light. Ring when it reaches the gold stripe.');
  }

  return (
    <main className="min-h-[100dvh] overflow-hidden bg-[#f5e6c4] text-[#2b1e27] selection:bg-[#ffcf5a] selection:text-[#2b1e27]">
      <style>{`
        @keyframes arcade-flicker { 0%, 100% { opacity: .78; } 50% { opacity: 1; } }
        @keyframes light-pulse { 0%, 100% { transform: translateX(-50%) scale(1); } 50% { transform: translateX(-50%) scale(1.13); } }
        @keyframes ring-burst { 0% { transform: translate(-50%, -50%) scale(.3); opacity: .85; } 100% { transform: translate(-50%, -50%) scale(1.8); opacity: 0; } }
        @keyframes ticket-shuffle { 0%, 100% { transform: rotate(-3deg) translateY(0); } 50% { transform: rotate(3deg) translateY(-3px); } }
        @keyframes marquee-in { from { transform: translateX(18px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        .arcade-dots { background-image: radial-gradient(#5d2947 0.8px, transparent 0.8px); background-size: 13px 13px; }
        .arcade-stripes { background-image: repeating-linear-gradient(135deg, rgba(255,255,255,.13) 0 9px, transparent 9px 18px); }
      `}</style>

      <div className="mx-auto max-w-[1240px] px-4 pb-10 sm:px-8 lg:px-10">
        <header className="flex flex-col gap-5 border-b-2 border-[#d29b5f] py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="relative flex h-12 w-12 rotate-[-4deg] items-center justify-center rounded-[14px] border-2 border-[#2b1e27] bg-[#ffcf5a] shadow-[4px_4px_0_#2b1e27]">
              <Target size={25} strokeWidth={2.8} />
              <span className="absolute -right-2 -top-2 rounded-full border-2 border-[#2b1e27] bg-[#ef6d5e] px-1.5 py-0.5 font-mono text-[7px] font-bold text-[#fff4c9]">07</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-['Bricolage_Grotesque'] text-[25px] font-extrabold tracking-[-0.08em]">PAIF INVADERS</span>
                <span className="hidden rounded-full border border-[#8d5571] bg-[#fff1ca] px-2 py-1 font-mono text-[8px] font-bold uppercase tracking-[0.13em] text-[#76425d] sm:inline">skill hit</span>
              </div>
              <p className="mt-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-[#845368]">market learning arcade · paper play only</p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <div className="flex items-center gap-2 rounded-xl border-2 border-[#d29b5f] bg-[#fff1ca] px-3 py-2 shadow-[2px_2px_0_#d29b5f]">
              <Ticket size={16} className="text-[#ef6d5e]" />
              <span className="font-mono text-[13px] font-bold">{tickets}</span>
              <span className="font-mono text-[8px] font-bold uppercase tracking-[0.1em] text-[#845368]">tickets</span>
            </div>
            <div className="flex items-center gap-2 rounded-xl border-2 border-[#d29b5f] bg-[#fff1ca] px-3 py-2 shadow-[2px_2px_0_#d29b5f]">
              <Gem size={16} className="text-[#17a887]" />
              <span className="font-mono text-[13px] font-bold">{gems.toLocaleString()}</span>
              <span className="font-mono text-[8px] font-bold uppercase tracking-[0.1em] text-[#845368]">gems</span>
            </div>
          </div>
        </header>

        <section className="relative grid gap-8 py-8 lg:grid-cols-[1fr_310px] lg:items-end lg:py-11">
          <div className="relative z-10">
            <div className="mb-4 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[#b8544e]">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ef6d5e] shadow-[0_0_0_4px_#ef6d5e33]" />
              round {attempts + 1} · one light · one ring
            </div>
            <h1 className="max-w-[750px] font-['Bricolage_Grotesque'] text-[clamp(3.2rem,8vw,6.8rem)] font-extrabold leading-[0.82] tracking-[-0.09em] text-[#36202d]">
              Hit the <span className="relative inline-block text-[#b8544e]">high mark<span className="absolute -bottom-2 left-1 right-0 h-2 -rotate-2 rounded-full bg-[#ffcf5a]" /></span>.
            </h1>
            <p className="mt-6 max-w-[610px] text-[15px] leading-6 text-[#69475b] sm:text-[17px]">
              PAIF highlights one positive read. Your job is only timing: watch the light climb the striker and ring for a paper score. No Up-versus-Down pick. No order. Just a satisfying learning round.
            </p>
          </div>

          <div className="relative overflow-hidden rounded-[24px] border-2 border-[#5d2947] bg-[#5d2947] p-5 text-[#fff1ca] shadow-[7px_7px_0_#d29b5f]">
            <div className="arcade-stripes pointer-events-none absolute inset-0 opacity-30" />
            <div className="relative">
              <div className="flex items-center justify-between border-b border-[#b87583]/50 pb-3">
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-[#ffcf5a]">paper scoreboard</span>
                <Trophy size={17} className="text-[#ffcf5a]" />
              </div>
              <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-[#e4b8ab]">total XP</p>
              <p className="mt-1 font-['Bricolage_Grotesque'] text-5xl font-extrabold tracking-[-0.08em]">{score.toLocaleString()}</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-[#b87583]/50 bg-[#421f38] px-3 py-2">
                  <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-[#e4b8ab]">streak</p>
                  <p className="mt-1 font-mono text-xl font-bold text-[#ffcf5a]">{streak} <span className="text-[9px] text-[#e4b8ab]">hits</span></p>
                </div>
                <div className="rounded-xl border border-[#b87583]/50 bg-[#421f38] px-3 py-2">
                  <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-[#e4b8ab]">last hit</p>
                  <p className="mt-1 font-mono text-xl font-bold text-[#8be5ca]">{lastHit ?? '—'} <span className="text-[9px] text-[#e4b8ab]">{lastHit ? 'XP' : 'ready'}</span></p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_285px]">
          <div className="relative overflow-hidden rounded-[28px] border-2 border-[#5d2947] bg-[#713552] p-4 shadow-[8px_8px_0_#d29b5f] sm:p-6">
            <div className="arcade-dots pointer-events-none absolute inset-0 opacity-20" />
            <div className="relative">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#c9828f]/60 pb-4">
                <div>
                  <p className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.17em] text-[#ffcf5a]">
                    <Gauge size={14} /> high-striker meter
                  </p>
                  <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[#e9b5ac]">land the moving light in the gold stripe</p>
                </div>
                <div className={`rounded-full border px-3 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] ${inGold ? 'border-[#8be5ca] bg-[#8be5ca]/15 text-[#bdf8e4]' : 'border-[#c9828f] text-[#f1c1b4]'}`}>
                  {isRinging ? 'attempt frozen' : inGold ? 'bullseye window' : 'light is moving'}
                </div>
              </div>

              <div className="mt-6 grid gap-5 sm:grid-cols-[1fr_150px] sm:items-center">
                <div className="relative h-[410px] rounded-[20px] border-2 border-[#c9828f] bg-[#421f38] p-5 shadow-inner">
                  <div className="absolute inset-x-5 top-5 flex items-center justify-between">
                    <span className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[#ffcf5a]">bell tower 01</span>
                    <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[#e9b5ac]"><Zap size={12} /> live read</span>
                  </div>
                  <div className="absolute bottom-6 left-1/2 h-[320px] w-[110px] -translate-x-1/2 rounded-full border-2 border-[#c9828f] bg-[#5d2947] p-2">
                    <div className="relative h-full overflow-hidden rounded-full border border-[#e0a1a2]/60 bg-[#2f1b2a]">
                      <div className="absolute inset-x-0 bg-[#f1b849]/25" style={{ top: `${100 - TARGET_ZONE.end}%`, height: `${TARGET_ZONE.end - TARGET_ZONE.start}%` }} />
                      <div className="absolute inset-x-2 h-1 rounded-full bg-[#ffcf5a] shadow-[0_0_12px_#ffcf5a]" style={{ top: `${100 - TARGET_ZONE.end}%` }} />
                      <div className="absolute inset-x-2 h-1 rounded-full bg-[#ffcf5a] shadow-[0_0_12px_#ffcf5a]" style={{ top: `${100 - TARGET_ZONE.start}%` }} />
                      <MeterTick label="top" top="7%" />
                      <MeterTick label="gold" top={`${100 - (TARGET_ZONE.start + TARGET_ZONE.end) / 2}%`} strong />
                      <MeterTick label="start" top="93%" />
                      <div
                        className="absolute left-1/2 h-8 w-8 -translate-x-1/2 rounded-full border-4 border-[#fff3c2] bg-[#8be5ca] shadow-[0_0_0_5px_#17a88755,0_0_22px_#8be5ca]"
                        style={{ bottom: `${position}%`, animation: isRinging ? 'light-pulse 900ms ease-in-out infinite' : undefined }}
                      />
                      {isRinging && (
                        <span className="absolute left-1/2 top-[42%] h-20 w-20 rounded-full border-2 border-[#ffcf5a]" style={{ animation: 'ring-burst 850ms ease-out forwards' }} />
                      )}
                    </div>
                  </div>
                  <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[#c9828f] bg-[#713552] px-3 py-1 font-mono text-[8px] font-bold uppercase tracking-[0.14em] text-[#ffcf5a]">
                    <ArrowUp size={12} /> timing lane
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="rounded-2xl border border-[#c9828f]/80 bg-[#5d2947] p-4">
                    <p className="font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-[#e9b5ac]">selected read</p>
                    <div className="mt-3 flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-[#2b1e27] bg-[#8be5ca] text-[#2b1e27] shadow-[3px_3px_0_#2b1e27]">
                        <Sparkles size={20} />
                      </div>
                      <div>
                        <p className="font-['Bricolage_Grotesque'] text-2xl font-extrabold tracking-[-0.06em] text-[#fff4c9]">{POSITIVE_READ.symbol}</p>
                        <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#8be5ca]">+{POSITIVE_READ.move.toFixed(1)}% positive</p>
                      </div>
                    </div>
                    <p className="mt-3 text-[11px] leading-5 text-[#f1c1b4]">PAIF picked the strongest positive read in this snapshot. You do not choose a direction.</p>
                  </div>
                  <div className="rounded-2xl border border-[#ffcf5a]/70 bg-[#ffcf5a] p-4 text-[#2b1e27]">
                    <p className="flex items-center gap-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em]"><Bell size={14} /> your one move</p>
                    <p className="mt-2 font-['Bricolage_Grotesque'] text-xl font-extrabold leading-tight tracking-[-0.05em]">Freeze the light. Ring the bell.</p>
                    <button
                      type="button"
                      onClick={ringBell}
                      disabled={isRinging}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-[#2b1e27] bg-[#ef6d5e] px-3 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-[#fff4c9] shadow-[0_4px_0_#2b1e27] transition-transform hover:-translate-y-0.5 active:translate-y-1 active:shadow-none disabled:cursor-not-allowed disabled:bg-[#d59c86] disabled:shadow-none"
                    >
                      <Bell size={16} /> {isRinging ? 'Bell rung' : 'Ring the bell'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-5 flex min-h-12 items-center justify-between gap-3 rounded-xl border border-[#c9828f]/70 bg-[#421f38] px-4 py-3">
                <p aria-live="polite" className="flex items-center gap-2 font-mono text-[10px] leading-4 text-[#f1c1b4]">
                  {isRinging ? <Check size={15} className="shrink-0 text-[#8be5ca]" /> : <Info size={15} className="shrink-0 text-[#ffcf5a]" />}
                  {message}
                </p>
                {isRinging && (
                  <button type="button" onClick={resetAttempt} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[#c9828f] px-2.5 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.11em] text-[#ffcf5a] transition hover:bg-[#713552]">
                    <RotateCcw size={13} /> reset
                  </button>
                )}
              </div>
            </div>
          </div>

          <aside className="space-y-5">
            <div className="rounded-[22px] border-2 border-[#d29b5f] bg-[#fff1ca] p-5 shadow-[5px_5px_0_#d29b5f]">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-[#845368]">positive read</p>
                <span className="rounded-full bg-[#8be5ca] px-2 py-1 font-mono text-[8px] font-bold uppercase tracking-[0.1em] text-[#2b1e27]">highlighted</span>
              </div>
              <p className="mt-4 font-['Bricolage_Grotesque'] text-3xl font-extrabold tracking-[-0.07em] text-[#36202d]">{POSITIVE_READ.name}</p>
              <div className="mt-4 flex items-end justify-between border-t border-[#d29b5f]/60 pt-3">
                <span className="font-mono text-[9px] uppercase tracking-[0.13em] text-[#845368]">snapshot movement</span>
                <span className="font-mono text-2xl font-bold text-[#17a887]">+{POSITIVE_READ.move.toFixed(1)}%</span>
              </div>
              <p className="mt-3 text-[11px] leading-5 text-[#69475b]">A learning prompt, not a forecast. The result only changes your arcade score.</p>
            </div>

            <div className="rounded-[22px] border-2 border-[#d29b5f] bg-[#f8d786] p-5 shadow-[5px_5px_0_#d29b5f]">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-[#76425d]">signal shelf</p>
                <span className="font-mono text-[8px] font-bold uppercase tracking-[0.1em] text-[#a65a54]">context only</span>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-[#69475b]">Other moves stay on the board for comparison. They are not selectable.</p>
              <div className="mt-4 space-y-2">
                {CONTEXT_SIGNALS.map((token) => (
                  <div key={token.symbol} className="flex items-center justify-between rounded-xl border border-[#c98e5c]/60 bg-[#fff1ca]/65 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: token.hue }} />
                      <span className="font-mono text-[10px] font-bold text-[#36202d]">{token.symbol}</span>
                    </div>
                    <span className={`font-mono text-[10px] font-bold ${token.move > 0 ? 'text-[#338d78]' : 'text-[#b8544e]'}`}>{token.move > 0 ? '+' : ''}{token.move.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative overflow-hidden rounded-[22px] border-2 border-[#d29b5f] bg-[#ef6d5e] p-5 text-[#fff1ca] shadow-[5px_5px_0_#d29b5f]">
              <div className="relative">
                <p className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.15em]"><Ticket size={15} /> treasure cart</p>
                <p className="mt-3 font-['Bricolage_Grotesque'] text-3xl font-extrabold tracking-[-0.07em]">+{isRinging ? (accuracy >= 120 ? 24 : 8) : 0} gems</p>
                <p className="mt-1 text-[11px] leading-5 text-[#ffe4bd]">Paper treasure for this round. Nothing here can be wagered or redeemed.</p>
              </div>
              <span className="pointer-events-none absolute -bottom-5 -right-2 h-24 w-24 rounded-full border-[12px] border-[#ffcf5a]/30" />
            </div>
          </aside>
        </section>

        <footer className="mt-8 flex flex-col gap-3 border-t-2 border-[#d29b5f] pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-[#845368]">
            <span className="flex items-center gap-1.5"><Check size={12} className="text-[#17a887]" /> paper score only</span>
            <span className="flex items-center gap-1.5"><Gauge size={12} className="text-[#ef6d5e]" /> no trade controls</span>
            <span className="flex items-center gap-1.5"><Sparkles size={12} className="text-[#b8544e]" /> learn the signal</span>
          </div>
          <p className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-[#a65a54]">PAIF arcade · play the read, keep the receipt</p>
        </footer>
      </div>
    </main>
  );
}

export default HighStrikerSkillHit;