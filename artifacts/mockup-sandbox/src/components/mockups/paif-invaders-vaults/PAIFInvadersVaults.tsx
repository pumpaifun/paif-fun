import { useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  BarChart3,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  Crosshair,
  Database,
  Fingerprint,
  Gauge,
  Info,
  LockKeyhole,
  Orbit,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  Vault,
  WalletCards,
  Waves,
  X,
  Zap,
} from 'lucide-react';

type View = 'arena' | 'vaults';
type Action = 'up' | 'down' | 'hold';
type Choice = 'bank' | 'boost';

type Token = {
  symbol: string;
  name: string;
  price: string;
  move: string;
  direction: 'up' | 'down';
  x: number;
  y: number;
  tone: string;
  accent: string;
};

const tokens: Token[] = [
  { symbol: 'NOVA', name: 'Nova Mesh', price: '$1.84', move: '+6.2%', direction: 'up', x: 12, y: 22, tone: '#b7f55f', accent: '#5d7022' },
  { symbol: 'FLUX', name: 'Flux Harbor', price: '$0.72', move: '-3.8%', direction: 'down', x: 34, y: 14, tone: '#ff806b', accent: '#71352c' },
  { symbol: 'ORB', name: 'Orbit Link', price: '$4.16', move: '+2.1%', direction: 'up', x: 57, y: 24, tone: '#62dbff', accent: '#1d5f76' },
  { symbol: 'MINT', name: 'Mintline', price: '$0.46', move: '-1.4%', direction: 'down', x: 79, y: 15, tone: '#ff9bda', accent: '#713c60' },
  { symbol: 'KITE', name: 'Kite Protocol', price: '$2.09', move: '+4.7%', direction: 'up', x: 88, y: 41, tone: '#ffd15b', accent: '#715c20' },
  { symbol: 'HUSH', name: 'Hush Relay', price: '$0.31', move: '-5.1%', direction: 'down', x: 67, y: 52, tone: '#ff806b', accent: '#71352c' },
  { symbol: 'LUME', name: 'Lume Core', price: '$3.27', move: '+1.6%', direction: 'up', x: 39, y: 48, tone: '#b7f55f', accent: '#5d7022' },
  { symbol: 'SORA', name: 'Sora Field', price: '$0.98', move: '+0.8%', direction: 'up', x: 16, y: 58, tone: '#62dbff', accent: '#1d5f76' },
  { symbol: 'VOLT', name: 'Volt Arcade', price: '$1.22', move: '-2.6%', direction: 'down', x: 28, y: 79, tone: '#ff9bda', accent: '#713c60' },
  { symbol: 'AXIS', name: 'Axis Garden', price: '$5.03', move: '+3.3%', direction: 'up', x: 60, y: 78, tone: '#ffd15b', accent: '#715c20' },
];

const schedule = [
  { label: 'Community reserve', amount: '18.4%', date: 'Unlocks 14 Feb 2027', tone: 'lime' },
  { label: 'Builder rewards', amount: '7.6%', date: 'Cliff 30 Sep 2026', tone: 'pink' },
  { label: 'Liquidity buffer', amount: '4.0%', date: 'Unlocks 01 Jun 2028', tone: 'cyan' },
];

function TokenNode({ token, selected, onSelect }: { token: Token; selected: boolean; onSelect: () => void }) {
  const Icon = token.direction === 'up' ? ArrowUpRight : ArrowDownRight;
  return (
    <button
      type="button"
      aria-label={`Select ${token.symbol}`}
      onClick={onSelect}
      className={`absolute -translate-x-1/2 -translate-y-1/2 text-left transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b7f55f] focus-visible:ring-offset-2 focus-visible:ring-offset-[#10151d] ${
        selected ? 'z-20 scale-110' : 'z-10 hover:z-20 hover:scale-105'
      }`}
      style={{ left: `${token.x}%`, top: `${token.y}%`, animation: `paifFloat ${3.8 + (token.x % 3) * 0.4}s ease-in-out infinite`, animationDelay: `${(token.y % 4) * -0.55}s` }}
    >
      <span
        className={`block w-[102px] rounded-[18px] border p-2 shadow-[0_10px_26px_rgba(0,0,0,0.22)] backdrop-blur-md sm:w-[116px] ${
          selected ? 'border-[#f8f3df] bg-[#26313b]' : 'border-white/10 bg-[#18222c]/95'
        }`}
        style={selected ? { boxShadow: `0 0 0 2px ${token.tone}, 0 12px 34px rgba(0,0,0,.35)` } : undefined}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="font-['Space_Mono'] text-[10px] font-bold tracking-[0.15em] text-[#f8f3df]">{token.symbol}</span>
          <span className="rounded-full p-1" style={{ background: `${token.tone}22`, color: token.tone }}>
            <Icon size={12} strokeWidth={2.5} />
          </span>
        </span>
        <span className="mt-1 block font-['Space_Mono'] text-[10px] text-[#8d9aa5]">{token.price}</span>
        <span className="mt-1 block font-['Space_Mono'] text-[10px] font-bold" style={{ color: token.tone }}>{token.move}</span>
      </span>
    </button>
  );
}

function TinyBars({ color }: { color: string }) {
  return (
    <span className="flex h-7 items-end gap-[3px]" aria-hidden="true">
      {[32, 48, 27, 60, 44, 77, 52, 68, 84, 58, 92].map((height, index) => (
        <span key={index} className="w-[3px] rounded-t-sm" style={{ height: `${height}%`, background: color, opacity: 0.45 + index / 24 }} />
      ))}
    </span>
  );
}

export function PAIFInvadersVaults() {
  const [view, setView] = useState<View>('arena');
  const [selectedSymbol, setSelectedSymbol] = useState('NOVA');
  const [action, setAction] = useState<Action>('up');
  const [choice, setChoice] = useState<Choice>('bank');
  const [round, setRound] = useState(3);
  const [score, setScore] = useState(2480);
  const [notice, setNotice] = useState('Pick a token node to start your paper round.');
  const [proofOpen, setProofOpen] = useState(false);

  const selected = useMemo(() => tokens.find((token) => token.symbol === selectedSymbol) ?? tokens[0], [selectedSymbol]);
  const projected = choice === 'boost' ? 184 : 92;

  const lockIn = () => {
    setRound((current) => current + 1);
    setScore((current) => current + projected);
    setNotice(`${selected.symbol} call logged in paper mode. No order was placed.`);
  };

  return (
    <main className="min-h-[100dvh] overflow-hidden bg-[#0c1118] text-[#f8f3df] selection:bg-[#b7f55f] selection:text-[#11160e]">
      <style>{`
        @keyframes paifFloat { 0%, 100% { transform: translate(-50%, -50%) translateY(0); } 50% { transform: translate(-50%, -50%) translateY(-7px); } }
        @keyframes paifScan { 0% { transform: translateY(-140%); opacity: 0; } 12%, 82% { opacity: .38; } 100% { transform: translateY(580%); opacity: 0; } }
        @keyframes paifPulse { 0%, 100% { transform: scale(.96); opacity: .6; } 50% { transform: scale(1); opacity: 1; } }
        .paif-grid { background-image: linear-gradient(rgba(129, 166, 181, .09) 1px, transparent 1px), linear-gradient(90deg, rgba(129, 166, 181, .09) 1px, transparent 1px); background-size: 42px 42px; }
        .paif-noise { background-image: radial-gradient(rgba(248,243,223,.11) .7px, transparent .7px); background-size: 5px 5px; }
      `}</style>

      <div className="mx-auto w-full max-w-[1500px] px-4 pb-10 sm:px-7 lg:px-10">
        <header className="flex items-center justify-between border-b border-white/10 py-5">
          <div className="flex items-center gap-3">
            <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-[#b7f55f]/50 bg-[#b7f55f] text-[#11160e] shadow-[3px_3px_0_#49651d]">
              <Orbit size={25} strokeWidth={2.4} />
              <span className="absolute bottom-[5px] right-[5px] h-1.5 w-1.5 rounded-full bg-[#ff806b]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-['Space_Mono'] text-xl font-bold tracking-[-0.08em]">PAIF</span>
                <span className="rounded border border-white/15 px-1.5 py-0.5 font-['Space_Mono'] text-[8px] font-bold uppercase tracking-[0.16em] text-[#9ba7ae]">Arcade protocol</span>
              </div>
              <p className="mt-0.5 font-['Space_Mono'] text-[9px] uppercase tracking-[0.2em] text-[#72818b]">Learn the move. Keep the receipt.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-full border border-[#b7f55f]/25 bg-[#b7f55f]/[0.07] px-3 py-2 sm:flex">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#b7f55f]" />
              <span className="font-['Space_Mono'] text-[9px] uppercase tracking-[0.18em] text-[#b7f55f]">Paper mode</span>
            </div>
            <button type="button" onClick={() => setNotice('Demo data refresh queued — the board is intentionally offline.')} className="rounded-lg border border-white/10 bg-[#141d26] p-2.5 text-[#9ba7ae] transition hover:border-[#62dbff]/50 hover:text-[#62dbff]" aria-label="Refresh demo data">
              <RefreshCw size={16} />
            </button>
            <button type="button" onClick={() => setNotice('Profile controls are part of the next concept pass.')} className="flex h-9 w-9 items-center justify-center rounded-full border border-[#ff9bda]/40 bg-[#3b283b] font-['Space_Mono'] text-xs font-bold text-[#ffbce6]" aria-label="Open profile">MK</button>
          </div>
        </header>

        <section className="relative overflow-hidden pb-9 pt-10 lg:pb-12 lg:pt-14">
          <div className="pointer-events-none absolute -right-28 top-0 h-80 w-80 rounded-full bg-[#d8ff67]/[0.08] blur-3xl" />
          <div className="pointer-events-none absolute left-1/3 top-10 h-56 w-56 rounded-full bg-[#58d6ee]/[0.06] blur-3xl" />
          <div className="relative flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 flex items-center gap-2 font-['Space_Mono'] text-[10px] font-bold uppercase tracking-[0.22em] text-[#b7f55f]">
                <span className="h-px w-8 bg-[#b7f55f]" />
                Station 07 / training deck
              </div>
              <h1 className="max-w-2xl font-['Space_Mono'] text-4xl font-bold leading-[0.98] tracking-[-0.08em] text-[#f8f3df] sm:text-6xl lg:text-7xl">Market literacy,<br /><span className="text-[#ff806b]">in play.</span></h1>
              <p className="mt-5 max-w-xl text-sm leading-6 text-[#9ba7ae] sm:text-base">Read the board, make a call, see what happened. PAIF turns market mechanics into a transparent arcade round — never a promise, never a real-money bet.</p>
            </div>
            <div className="flex max-w-sm items-center gap-3 border-l border-[#b7f55f]/40 pl-4">
              <Gauge className="shrink-0 text-[#b7f55f]" size={23} />
              <div>
                <p className="font-['Space_Mono'] text-[10px] uppercase tracking-[0.18em] text-[#72818b]">Your paper score</p>
                <p className="mt-1 font-['Space_Mono'] text-3xl font-bold tracking-[-0.08em] text-[#f8f3df]">{score.toLocaleString()} <span className="text-sm text-[#b7f55f]">XP</span></p>
              </div>
              <div className="ml-auto flex flex-col items-end gap-1 text-right">
                <Trophy size={15} className="text-[#ffd15b]" />
                <span className="font-['Space_Mono'] text-[9px] text-[#72818b]">ROUND {round}</span>
              </div>
            </div>
          </div>
        </section>

        <div className="mb-6 flex max-w-[460px] rounded-xl border border-white/10 bg-[#111a23] p-1">
          <button type="button" onClick={() => setView('arena')} className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-3 font-['Space_Mono'] text-[10px] font-bold uppercase tracking-[0.15em] transition ${view === 'arena' ? 'bg-[#b7f55f] text-[#11160e] shadow-[0_4px_0_#49651d]' : 'text-[#72818b] hover:text-[#f8f3df]'}`}>
            <Crosshair size={14} /> Invaders arena
          </button>
          <button type="button" onClick={() => setView('vaults')} className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-3 font-['Space_Mono'] text-[10px] font-bold uppercase tracking-[0.15em] transition ${view === 'vaults' ? 'bg-[#62dbff] text-[#0b1a22] shadow-[0_4px_0_#24667a]' : 'text-[#72818b] hover:text-[#f8f3df]'}`}>
            <Vault size={14} /> Vaults readout
          </button>
        </div>

        {view === 'arena' ? (
          <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
                <div>
                  <p className="flex items-center gap-2 font-['Space_Mono'] text-xs font-bold uppercase tracking-[0.18em] text-[#f8f3df]"><span className="h-2 w-2 rounded-full bg-[#ff806b]" /> Live board / round {round}</p>
                  <p className="mt-1 font-['Space_Mono'] text-[9px] uppercase tracking-[0.14em] text-[#72818b]">10 demo nodes · 90 second read window</p>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#111a23] px-3 py-2">
                  <Play size={12} className="text-[#b7f55f]" />
                  <span className="font-['Space_Mono'] text-[9px] uppercase tracking-[0.15em] text-[#9ba7ae]">Board moving</span>
                  <span className="ml-1 h-1.5 w-1.5 animate-pulse rounded-full bg-[#b7f55f]" />
                </div>
              </div>
              <div className="paif-grid paif-noise relative aspect-[1.45/1] min-h-[460px] overflow-hidden rounded-2xl border border-[#31414c] bg-[#111a23] shadow-[0_24px_60px_rgba(0,0,0,0.26)] sm:min-h-[530px]">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-[#b7f55f]/[0.045] to-transparent" />
                <div className="pointer-events-none absolute inset-x-0 top-0 h-1/3 border-b border-[#b7f55f]/[0.14]" />
                <div className="pointer-events-none absolute inset-x-0 top-1/3 border-b border-dashed border-[#62dbff]/[0.12]" />
                <div className="pointer-events-none absolute inset-x-0 top-2/3 border-b border-dashed border-[#ff806b]/[0.12]" />
                <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-md border border-white/10 bg-[#0c1118]/70 px-2 py-1.5 font-['Space_Mono'] text-[8px] uppercase tracking-[0.12em] text-[#72818b]"><Activity size={11} className="text-[#b7f55f]" /> Signal field / demo telemetry</div>
                <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-2 font-['Space_Mono'] text-[8px] uppercase tracking-[0.12em] text-[#72818b]"><span className="h-1.5 w-1.5 rounded-full bg-[#ff806b]" /> - pressure <span className="h-1.5 w-1.5 rounded-full bg-[#b7f55f]" /> + lift</div>
                <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-[#b7f55f]/50 to-transparent" style={{ animation: 'paifScan 5.4s linear infinite' }} />
                {tokens.map((token) => <TokenNode key={token.symbol} token={token} selected={token.symbol === selectedSymbol} onSelect={() => { setSelectedSymbol(token.symbol); setNotice(`${token.symbol} selected. Choose a direction, then lock your paper call.`); }} />)}
                <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 font-['Space_Mono'] text-[8px] uppercase tracking-[0.14em] text-[#5f707b]"><Pause size={10} /> Auto movement is illustrative</div>
                <div className="pointer-events-none absolute bottom-3 right-3 rounded border border-[#b7f55f]/25 bg-[#b7f55f]/[0.07] px-2 py-1 font-['Space_Mono'] text-[8px] uppercase tracking-[0.14em] text-[#b7f55f]">Read before you react</div>
              </div>
            </div>

            <aside className="flex flex-col gap-4">
              <div className="rounded-2xl border border-[#ff806b]/25 bg-[#171c24] p-5 shadow-[0_18px_45px_rgba(0,0,0,.2)]">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="flex items-center gap-2 font-['Space_Mono'] text-[10px] uppercase tracking-[0.17em] text-[#ff806b]"><Sparkles size={13} /> Bot call / {selected.symbol}</p>
                    <h2 className="mt-3 font-['Space_Mono'] text-3xl font-bold tracking-[-0.08em] text-[#f8f3df]">{selected.direction === 'up' ? 'UP' : 'DOWN'} <span className="text-xl text-[#72818b]">lean</span></h2>
                  </div>
                  <div className="rounded-full border border-[#ff806b]/40 bg-[#ff806b]/10 p-2 text-[#ff806b]"><Zap size={17} /></div>
                </div>
                <div className="mt-5 flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#27313a]"><div className="h-full rounded-full bg-[#ff806b]" style={{ width: selected.direction === 'up' ? '62%' : '57%' }} /></div>
                  <span className="font-['Space_Mono'] text-xs font-bold text-[#ff806b]">{selected.direction === 'up' ? '62' : '57'}%</span>
                </div>
                <p className="mt-3 flex gap-2 text-[11px] leading-5 text-[#9ba7ae]"><CircleHelp size={14} className="mt-0.5 shrink-0 text-[#ffd15b]" /> This is a noisy practice signal, not a forecast. It can be wrong.</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#111a23] p-5">
                <div className="flex items-center justify-between">
                  <p className="font-['Space_Mono'] text-[10px] font-bold uppercase tracking-[0.17em] text-[#f8f3df]">Your paper call</p>
                  <span className="font-['Space_Mono'] text-[9px] text-[#72818b]">{selected.symbol} / {selected.price}</span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {(['up', 'down', 'hold'] as Action[]).map((item) => {
                    const Icon = item === 'up' ? ArrowUpRight : item === 'down' ? ArrowDownRight : Pause;
                    const label = item === 'up' ? 'Up' : item === 'down' ? 'Down' : 'Hold';
                    return <button key={item} type="button" onClick={() => setAction(item)} className={`flex flex-col items-center gap-2 rounded-xl border py-3 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b7f55f] ${action === item ? (item === 'up' ? 'border-[#b7f55f] bg-[#b7f55f]/10 text-[#b7f55f]' : item === 'down' ? 'border-[#ff806b] bg-[#ff806b]/10 text-[#ff806b]' : 'border-[#62dbff] bg-[#62dbff]/10 text-[#62dbff]') : 'border-white/10 text-[#72818b] hover:border-white/30 hover:text-[#f8f3df]'}`}><Icon size={18} /><span className="font-['Space_Mono'] text-[9px] uppercase tracking-[0.12em]">{label}</span></button>;
                  })}
                </div>
                <div className="mt-4 border-t border-white/10 pt-4">
                  <p className="mb-2 font-['Space_Mono'] text-[9px] uppercase tracking-[0.14em] text-[#72818b]">After the call</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setChoice('bank')} className={`rounded-lg border px-3 py-3 text-left transition ${choice === 'bank' ? 'border-[#ffd15b] bg-[#ffd15b]/10' : 'border-white/10 hover:border-white/30'}`}><Banknote size={15} className={choice === 'bank' ? 'text-[#ffd15b]' : 'text-[#72818b]'} /><span className="mt-2 block font-['Space_Mono'] text-[10px] font-bold text-[#f8f3df]">Bank it</span><span className="mt-1 block text-[10px] text-[#72818b]">Keep +92 XP</span></button>
                    <button type="button" onClick={() => setChoice('boost')} className={`rounded-lg border px-3 py-3 text-left transition ${choice === 'boost' ? 'border-[#ff9bda] bg-[#ff9bda]/10' : 'border-white/10 hover:border-white/30'}`}><Zap size={15} className={choice === 'boost' ? 'text-[#ff9bda]' : 'text-[#72818b]'} /><span className="mt-2 block font-['Space_Mono'] text-[10px] font-bold text-[#f8f3df]">Boost it</span><span className="mt-1 block text-[10px] text-[#72818b]">Risk +184 XP</span></button>
                  </div>
                </div>
                <button type="button" onClick={lockIn} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#b7f55f] px-4 py-3.5 font-['Space_Mono'] text-[10px] font-bold uppercase tracking-[0.17em] text-[#11160e] shadow-[0_4px_0_#49651d] transition hover:-translate-y-0.5 hover:bg-[#cbff7a] active:translate-y-0 active:shadow-none"><Target size={15} /> Lock paper call <ChevronRight size={15} /></button>
                <p className="mt-3 text-center font-['Space_Mono'] text-[9px] text-[#72818b]">{notice}</p>
              </div>
            </aside>
          </section>
        ) : (
          <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 space-y-5">
              <div className="relative overflow-hidden rounded-2xl border border-[#62dbff]/25 bg-[#111d27] p-6 sm:p-8">
                <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full border border-[#62dbff]/15" />
                <div className="pointer-events-none absolute -right-7 -top-7 h-40 w-40 rounded-full border border-[#62dbff]/15" />
                <div className="relative flex flex-col justify-between gap-8 md:flex-row md:items-end">
                  <div className="max-w-xl">
                    <p className="flex items-center gap-2 font-['Space_Mono'] text-[10px] uppercase tracking-[0.17em] text-[#62dbff]"><LockKeyhole size={14} /> Vaults / transparency surface</p>
                    <h2 className="mt-5 font-['Space_Mono'] text-3xl font-bold leading-none tracking-[-0.08em] sm:text-5xl">Know what is<br /><span className="text-[#62dbff]">behind the door.</span></h2>
                    <p className="mt-5 max-w-lg text-sm leading-6 text-[#9ba7ae]">A plain-language view of supply that is shown as locked, scheduled, and verifiable. This is read-only concept data — not a claim about a live token.</p>
                  </div>
                  <div className="rounded-xl border border-[#62dbff]/25 bg-[#07131b]/60 p-4 md:min-w-[210px]">
                    <p className="font-['Space_Mono'] text-[9px] uppercase tracking-[0.16em] text-[#72818b]">Preview supply</p>
                    <p className="mt-2 font-['Space_Mono'] text-2xl font-bold tracking-[-0.08em] text-[#f8f3df]">84,000,000 <span className="text-xs text-[#62dbff]">PAIF</span></p>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#243441]"><div className="h-full w-[68%] rounded-full bg-[#62dbff]" /></div>
                    <div className="mt-2 flex justify-between font-['Space_Mono'] text-[9px] text-[#72818b]"><span>68% shown locked</span><span>read-only</span></div>
                  </div>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  { label: 'Locked now', value: '57,120,000', sub: '68.0% of concept supply', icon: LockKeyhole, color: '#62dbff' },
                  { label: 'Next unlock', value: '14 Feb 2027', sub: 'Community reserve', icon: Clock3, color: '#b7f55f' },
                  { label: 'Proof status', value: 'Readable', sub: 'Explorer-ready hash', icon: ShieldCheck, color: '#ffd15b' },
                ].map((stat) => <div key={stat.label} className="rounded-2xl border border-white/10 bg-[#111a23] p-5"><stat.icon size={18} style={{ color: stat.color }} /><p className="mt-5 font-['Space_Mono'] text-[9px] uppercase tracking-[0.16em] text-[#72818b]">{stat.label}</p><p className="mt-2 font-['Space_Mono'] text-xl font-bold tracking-[-0.06em] text-[#f8f3df]">{stat.value}</p><p className="mt-1 text-[11px] text-[#72818b]">{stat.sub}</p></div>)}
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#111a23] p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><p className="font-['Space_Mono'] text-[10px] uppercase tracking-[0.17em] text-[#b7f55f]">Unlock map</p><h3 className="mt-2 font-['Space_Mono'] text-xl font-bold tracking-[-0.06em]">Who gets what, and when</h3></div>
                  <span className="rounded-full border border-white/10 px-3 py-1.5 font-['Space_Mono'] text-[9px] uppercase tracking-[0.13em] text-[#72818b]">3 schedules</span>
                </div>
                <div className="mt-5 space-y-3">{schedule.map((item) => { const color = item.tone === 'lime' ? '#b7f55f' : item.tone === 'pink' ? '#ff9bda' : '#62dbff'; return <div key={item.label} className="grid grid-cols-[1fr_auto] items-center gap-4 rounded-xl border border-white/10 bg-[#0c141c] p-3 sm:grid-cols-[1fr_130px_150px]"><div className="flex items-center gap-3"><span className="h-8 w-1 rounded-full" style={{ background: color }} /><div><p className="font-['Space_Mono'] text-[11px] font-bold text-[#f8f3df]">{item.label}</p><p className="mt-1 text-[10px] text-[#72818b]">Beneficiary group / concept</p></div></div><span className="font-['Space_Mono'] text-xs font-bold" style={{ color }}>{item.amount}</span><span className="col-span-2 flex items-center gap-1.5 font-['Space_Mono'] text-[9px] text-[#72818b] sm:col-span-1 sm:justify-end"><Clock3 size={12} /> {item.date}</span></div>; })}</div>
              </div>
            </div>

            <aside className="space-y-4">
              <div className="rounded-2xl border border-[#ffd15b]/25 bg-[#171c24] p-5">
                <div className="flex items-center justify-between"><p className="font-['Space_Mono'] text-[10px] uppercase tracking-[0.17em] text-[#ffd15b]">On-chain proof</p><Fingerprint size={18} className="text-[#ffd15b]" /></div>
                <div className="mt-4 rounded-xl border border-white/10 bg-[#0c1118] p-3"><p className="break-all font-['Space_Mono'] text-[10px] leading-5 text-[#9ba7ae]">0x91f4...7a2e<br />vault-readout/paif-demo-07</p></div>
                <button type="button" onClick={() => setProofOpen((open) => !open)} className="mt-3 flex w-full items-center justify-between rounded-lg border border-white/10 px-3 py-2.5 font-['Space_Mono'] text-[9px] uppercase tracking-[0.14em] text-[#f8f3df] transition hover:border-[#ffd15b]/50"><span>{proofOpen ? 'Hide proof notes' : 'Explain this proof'}</span>{proofOpen ? <X size={14} /> : <ChevronRight size={14} />}</button>
                {proofOpen && <p className="mt-3 text-[11px] leading-5 text-[#9ba7ae]">A future implementation would point to a public chain explorer and independently verifiable lock contract. This preview intentionally uses a sample identifier.</p>}
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#111a23] p-5">
                <p className="font-['Space_Mono'] text-[10px] uppercase tracking-[0.17em] text-[#62dbff]">Beneficiaries, in plain view</p>
                <div className="mt-4 space-y-3">
                  {[['Community reserve', '18.4%', '#b7f55f'], ['Builder rewards', '7.6%', '#ff9bda'], ['Liquidity buffer', '4.0%', '#62dbff'], ['Circulating preview', '32.0%', '#ffd15b']].map(([label, value, color]) => <div key={label} className="flex items-center justify-between"><span className="flex items-center gap-2 text-xs text-[#9ba7ae]"><span className="h-2 w-2 rounded-full" style={{ background: color }} />{label}</span><span className="font-['Space_Mono'] text-[10px] font-bold text-[#f8f3df]">{value}</span></div>)}
                </div>
                <div className="mt-5 border-t border-white/10 pt-4"><p className="flex gap-2 text-[11px] leading-5 text-[#72818b]"><Info size={14} className="shrink-0 text-[#62dbff]" /> No “locked” badge means no promise. Read the schedule and verify the proof.</p></div>
              </div>
              <button type="button" onClick={() => setNotice('Vault view is read-only preview data.')} className="flex w-full items-center justify-between rounded-xl border border-[#b7f55f]/30 bg-[#b7f55f]/[0.06] p-4 text-left transition hover:bg-[#b7f55f]/[0.11]"><span><span className="block font-['Space_Mono'] text-[10px] font-bold uppercase tracking-[0.14em] text-[#b7f55f]">Trust is a feature</span><span className="mt-1 block text-[11px] text-[#9ba7ae]">See the receipt before the reward.</span></span><ArrowUpRight size={17} className="text-[#b7f55f]" /></button>
            </aside>
          </section>
        )}

        <footer className="mt-8 flex flex-col gap-4 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-['Space_Mono'] text-[9px] uppercase tracking-[0.14em] text-[#72818b]"><span className="flex items-center gap-1.5"><Database size={12} /> Demo data only</span><span className="flex items-center gap-1.5"><WalletCards size={12} /> No wallet connected</span><span className="flex items-center gap-1.5"><Code2 size={12} /> Concept v0.1</span></div>
          <div className="flex items-center gap-2 font-['Space_Mono'] text-[9px] uppercase tracking-[0.14em] text-[#5f707b]"><Waves size={12} className="text-[#62dbff]" /> Learn the system, not the hype</div>
        </footer>
      </div>
    </main>
  );
}

export default PAIFInvadersVaults;