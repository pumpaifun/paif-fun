import { z } from 'zod';

export interface SwingSetupDraft {
  name: string;
  mode: 'paper' | 'live';
  kind: 'scan' | 'watch';
  targetMint: string;
  budgetSol: string;
  windowHours: string;
  maxPositions: string;
  minLiquidityUsd: string;
  minPoolAgeHours: string;
  requireApproval: boolean;
  takeProfitPct: string;
  profitSkimPct: string;
  lossStopCount: string;
  style: 'quick' | 'ride' | 'dip' | 'coil';
  stopRoomPct: string;
  winnerKeepPct: string;
  neverSellAtLoss: boolean;
  redEndBehavior: 'sell' | 'send_tokens';
  allowStacking: boolean;
  hotStreakFullSize: boolean;
  unlimitedWindow: boolean;
  reentry: boolean;
  watchHoldLong: boolean;
}

export function defaultSwingDraft(): SwingSetupDraft {
  return {
    name: 'My Paper Bot', mode: 'paper', kind: 'scan', targetMint: '',
    budgetSol: '0.1', windowHours: '24', maxPositions: '3',
    minLiquidityUsd: '40000', minPoolAgeHours: '24', requireApproval: true,
    takeProfitPct: '', profitSkimPct: '50', lossStopCount: '4',
    style: 'quick', stopRoomPct: '', winnerKeepPct: '', neverSellAtLoss: false,
    redEndBehavior: 'sell', allowStacking: false, hotStreakFullSize: false,
    unlimitedWindow: false, reentry: false, watchHoldLong: false,
  };
}

function numberInRange(value: string, min: number, max: number, integer = false): boolean {
  if (!/^\d+(?:\.\d+)?$/.test(value.trim())) return false;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isInteger(n));
}

export function validateSwingDraft(d: SwingSetupDraft, editing = false): string | null {
  if (!['paper', 'live'].includes(d.mode) || !['scan', 'watch'].includes(d.kind)) return 'Choose a valid mode and bot type.';
  if (!d.name.trim() || d.name.trim().length > 40) return 'Use a bot name with 1–40 characters.';
  if (typeof d.requireApproval !== 'boolean') return 'Choose whether the bot should ask before buying.';
  if (!['quick', 'ride', 'dip', 'coil'].includes(d.style)) return 'The saved trading style is not supported.';
  if (['neverSellAtLoss', 'allowStacking', 'hotStreakFullSize', 'unlimitedWindow', 'reentry', 'watchHoldLong']
    .some((key) => typeof d[key as keyof SwingSetupDraft] !== 'boolean')) return 'Choose valid automation options.';
  if (!['sell', 'send_tokens'].includes(d.redEndBehavior)) return 'Choose what happens to a losing position when the run ends.';
  if (!editing) {
    if (!numberInRange(d.budgetSol, 0.01, 10)) return 'Budget must be between 0.01 and 10 SOL.';
    if (!d.unlimitedWindow && !numberInRange(d.windowHours, 12, 720, true)) return 'Run time must be 12–720 whole hours.';
    if (d.kind === 'watch' && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(d.targetMint.trim())) return 'Enter a valid Solana token mint for the watch bot.';
  }
  if (!numberInRange(d.maxPositions, 1, 10, true)) return 'Choose 1–10 whole position slots.';
  if (d.kind === 'scan') {
    if (!numberInRange(d.minLiquidityUsd, 5000, 1_000_000)) return 'Pool size must be $5,000–$1,000,000.';
    if (!numberInRange(d.minPoolAgeHours, 0, 720, true)) return 'Token age must be 0–720 whole hours.';
    if (d.style === 'quick') {
      if (d.stopRoomPct.trim() && !numberInRange(d.stopRoomPct, 2, 50, true)) return 'Loss room must be 2–50 whole percent, or Automatic.';
      if (d.winnerKeepPct.trim() && !numberInRange(d.winnerKeepPct, 40, 90, true)) return 'Winner protection must be 40–90 whole percent, or Automatic.';
    }
  }
  if (d.takeProfitPct.trim() && !numberInRange(d.takeProfitPct, 3, 500, true)) return 'Profit target must be 3–500 whole percent, or Automatic.';
  if (!numberInRange(d.profitSkimPct, 0, 100, true)) return 'Profit set-aside must be 0–100 whole percent.';
  if (!numberInRange(d.lossStopCount, 1, 20, true)) return 'Cool off after 1–20 losses.';
  return null;
}

export function swingSettingsPayload(d: SwingSetupDraft) {
  const error = validateSwingDraft(d, true);
  if (error) throw new Error(error);
  return {
    name: d.name.trim(),
    maxPositions: d.kind === 'watch' ? 1 : Number(d.maxPositions),
    takeProfitPct: d.takeProfitPct.trim() ? Number(d.takeProfitPct) : null,
    profitSkimPct: Number(d.profitSkimPct),
    lossStopCount: Number(d.lossStopCount),
    neverSellAtLoss: d.neverSellAtLoss,
    redEndBehavior: d.redEndBehavior,
    ...(d.kind === 'scan' ? {
      minLiquidityUsd: Number(d.minLiquidityUsd),
      minPoolAgeHours: Number(d.minPoolAgeHours),
      requireApproval: d.requireApproval,
      allowStacking: d.allowStacking,
      hotStreakFullSize: d.hotStreakFullSize,
      ...(d.style === 'quick' ? {
        stopRoomPct: d.stopRoomPct.trim() ? Number(d.stopRoomPct) : null,
        winnerKeepPct: d.winnerKeepPct.trim() ? Number(d.winnerKeepPct) : null,
      } : {}),
    } : {}),
  };
}

export function swingCreatePayload(d: SwingSetupDraft) {
  const error = validateSwingDraft(d);
  if (error) throw new Error(error);
  const { takeProfitPct, ...settings } = swingSettingsPayload(d);
  return {
    ...settings, mode: d.mode, universe: 'crypto' as const,
    style: d.kind === 'watch' && d.watchHoldLong ? 'ride' as const : 'quick' as const,
    budgetSol: Number(d.budgetSol),
    // The API still requires a bounded per-holding window even when the
    // overall run has no scheduled end. Never submit a hidden invalid field.
    windowHours: d.unlimitedWindow ? 24 : Number(d.windowHours),
    unlimitedWindow: d.unlimitedWindow,
    ...(takeProfitPct === null ? {} : { takeProfitPct }),
    ...(d.kind === 'watch' ? {
      targetMint: d.targetMint.trim(), manualBuy: false, reentry: d.reentry,
      allowStacking: false,
    } : {}),
  };
}

const savedBotSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), mode: z.enum(['paper', 'live']),
  universe: z.enum(['crypto', 'stocks']).optional(),
  status: z.string().min(1), targetMint: z.string().nullable(),
  budgetLamports: z.string().regex(/^\d+$/),
  maxPositions: z.number().int(), minLiquidityUsd: z.number(),
  minPoolAgeHours: z.number().int().nullable(), requireApproval: z.boolean(),
  takeProfitPct: z.number().nullable(), profitSkimPct: z.number().int(),
  lossStopCount: z.number().int(),
  style: z.enum(['quick', 'ride', 'dip', 'coil']),
  stopRoomPct: z.number().nullable(), winnerKeepPct: z.number().nullable(),
  neverSellAtLoss: z.boolean(), redEndBehavior: z.enum(['sell', 'send_tokens']),
  allowStacking: z.boolean(), hotStreakFullSize: z.boolean(),
  unlimitedWindow: z.boolean(), reentry: z.boolean(),
});

export function draftFromBot(raw: Record<string, unknown>): SwingSetupDraft {
  const parsed = savedBotSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Saved bot settings are incomplete. Refresh before editing; nothing has been replaced.');
  const b = parsed.data;
  if (b.universe === 'stocks') throw new Error('Tokenized-stock settings are managed on PAIF.fun. This Android editor currently supports crypto bots.');
  const budget = BigInt(b.budgetLamports);
  const draft: SwingSetupDraft = {
    name: b.name, mode: b.mode, kind: b.targetMint ? 'watch' : 'scan', targetMint: b.targetMint ?? '',
    budgetSol: `${budget / 1_000_000_000n}.${(budget % 1_000_000_000n).toString().padStart(9, '0')}`,
    windowHours: '24', maxPositions: String(b.maxPositions),
    minLiquidityUsd: String(b.minLiquidityUsd), minPoolAgeHours: String(b.minPoolAgeHours ?? 24),
    requireApproval: b.requireApproval, takeProfitPct: b.takeProfitPct === null ? '' : String(b.takeProfitPct),
    profitSkimPct: String(b.profitSkimPct), lossStopCount: String(b.lossStopCount),
    style: b.style, stopRoomPct: b.stopRoomPct === null ? '' : String(b.stopRoomPct),
    winnerKeepPct: b.winnerKeepPct === null ? '' : String(b.winnerKeepPct),
    neverSellAtLoss: b.neverSellAtLoss, redEndBehavior: b.redEndBehavior,
    allowStacking: b.allowStacking, hotStreakFullSize: b.hotStreakFullSize,
    unlimitedWindow: b.unlimitedWindow, reentry: b.reentry,
    // This creation-only choice is intentionally not inferred from a saved
    // watch bot's style: both tight and long watch bots persist style "ride".
    watchHoldLong: false,
  };
  // Show a legacy fractional/out-of-range choice as saved, with validation in
  // the editor. Never round it or replace it silently just to load the form.
  return draft;
}

export function swingCreateMessage(owner: string, nonce: number): string {
  return `paif-swing|v1|create|${owner}|${nonce}`;
}

export function swingSettingsMessage(id: string, owner: string, nonce: number): string {
  return `paif-swing|v1|settings|${id}|${owner}|${nonce}`;
}

export function swingSignalMessage(id: string, signalId: string, action: 'approve' | 'dismiss', owner: string, nonce: number): string {
  return `paif-swing|v1|${action}:${signalId}|${id}|${owner}|${nonce}`;
}
