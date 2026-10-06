import { z } from 'zod';
import type { Token } from './models';
import { mintSchema } from './models';

export const PAPER_STARTING_CHIPS = 10_000;
export const PAPER_QUOTE_MAX_AGE_MS = 120_000;
const positive = z.number().finite().positive();
const date = z.string().refine((value) => Number.isFinite(Date.parse(value)));
export const positionSchema = z.object({
  id: z.string().min(1), mint: mintSchema, symbol: z.string(), name: z.string(),
  tokenUnits: positive, chipsInvested: positive, openedAt: date,
});
const tradeSchema = z.object({
  id: z.string().min(1), mint: mintSchema, symbol: z.string(),
  side: z.enum(['buy', 'sell']), chips: positive, price: positive,
  tokenUnits: positive, at: date, profit: z.number().finite().optional(),
});
export const paperSchema = z.object({
  version: z.literal(1),
  cash: z.number().finite().nonnegative(),
  positions: z.array(positionSchema),
  trades: z.array(tradeSchema),
}).superRefine((state, ctx) => {
  if (new Set(state.positions.map((position) => position.mint)).size !== state.positions.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate practice positions.' });
  }
  if (new Set(state.trades.map((trade) => trade.id)).size !== state.trades.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate practice trades.' });
  }
});
export type PaperPosition = z.infer<typeof positionSchema>;
export type PaperTrade = z.infer<typeof tradeSchema>;
export type PaperState = z.infer<typeof paperSchema>;
export const initialPaperState = (): PaperState => ({ version: 1, cash: PAPER_STARTING_CHIPS, positions: [], trades: [] });

export function quoteProblem(token: Token, now = Date.now()): string | null {
  const price = Number(token.price);
  if (!Number.isFinite(price) || price <= 0) return 'No valid positive price is available.';
  const observed = Date.parse(token.marketDataAt ?? '');
  if (!Number.isFinite(observed)) return 'The price has no observation time. Refresh before practising.';
  if (observed > now) return 'The price timestamp is in the future. Check the device clock.';
  if (now - observed > PAPER_QUOTE_MAX_AGE_MS) return 'This price is more than two minutes old. Refresh before practising.';
  return null;
}
export function isFreshQuote(token: Token, now = Date.now()): boolean {
  return quoteProblem(token, now) === null;
}

function makeId() { return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`; }

export function buyAtQuote(state: PaperState, token: Token, chips: number, now = Date.now()): PaperState {
  paperSchema.parse(state);
  const reason = quoteProblem(token, now);
  if (reason) throw new Error(reason);
  if (!Number.isFinite(chips) || chips <= 0 || chips > state.cash) {
    throw new Error('Enter a positive number of practice chips within your available balance.');
  }
  const price = Number(token.price);
  const units = chips / price;
  if (!Number.isFinite(units) || units <= 0) throw new Error('This price cannot produce a valid simulated position.');
  const previous = state.positions.find((position) => position.mint === token.mint);
  const at = new Date(now).toISOString();
  const position: PaperPosition = {
    id: previous?.id ?? makeId(), mint: token.mint, symbol: token.symbol, name: token.name,
    tokenUnits: (previous?.tokenUnits ?? 0) + units,
    chipsInvested: (previous?.chipsInvested ?? 0) + chips,
    openedAt: previous?.openedAt ?? at,
  };
  return paperSchema.parse({
    ...state, cash: state.cash - chips,
    positions: [...state.positions.filter((item) => item.mint !== token.mint), position],
    trades: [{ id: makeId(), mint: token.mint, symbol: token.symbol, side: 'buy', chips, price, tokenUnits: units, at }, ...state.trades],
  });
}

export function sellAtQuote(state: PaperState, token: Token, now = Date.now()): PaperState {
  paperSchema.parse(state);
  const reason = quoteProblem(token, now);
  if (reason) throw new Error(reason);
  const position = state.positions.find((item) => item.mint === token.mint);
  if (!position) throw new Error('This practice position is already closed or does not exist.');
  const price = Number(token.price);
  const chips = position.tokenUnits * price;
  if (!Number.isFinite(chips) || chips <= 0) throw new Error('This quote cannot settle the simulated position.');
  return paperSchema.parse({
    ...state, cash: state.cash + chips,
    positions: state.positions.filter((item) => item.mint !== token.mint),
    trades: [{
      id: makeId(), mint: token.mint, symbol: position.symbol, side: 'sell',
      chips, price, tokenUnits: position.tokenUnits, at: new Date(now).toISOString(),
      profit: chips - position.chipsInvested,
    }, ...state.trades],
  });
}
