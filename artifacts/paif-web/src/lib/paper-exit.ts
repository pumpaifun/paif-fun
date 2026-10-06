export interface PaperExitToken {
  price: string | number;
  marketDataAt?: string | null;
  change5m: number | null;
  change1h: number | null;
}

export interface PaperPosition {
  chipsInvested: number;
  tokenUnits: number;
  buyCount: number;
}

export interface PaperExitRead {
  status: "Hold" | "Watch closely" | "Exit signal";
  explanation: string;
  tone: "hold" | "watch" | "exit";
}

export type PaperExitStatus = PaperExitRead["status"];

export const PAPER_MARKET_FRESH_MS = 90_000;

function formatMove(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function getPaperExitRead(
  token: PaperExitToken,
  position: PaperPosition,
  now = Date.now(),
): PaperExitRead {
  const currentPrice = Number(token.price);
  const averageEntry = position.chipsInvested / position.tokenUnits;
  const marketDataAt = Date.parse(token.marketDataAt ?? "");
  const fiveMinute = Number(token.change5m);
  const hourly = Number(token.change1h);
  const hasFreshMarketData = Number.isFinite(marketDataAt)
    && now - marketDataAt >= 0
    && now - marketDataAt <= PAPER_MARKET_FRESH_MS;
  const hasCompleteMovement = token.change5m !== null
    && token.change1h !== null
    && Number.isFinite(fiveMinute)
    && Number.isFinite(hourly);

  if (
    !hasFreshMarketData
    || !hasCompleteMovement
    || !Number.isFinite(currentPrice)
    || currentPrice <= 0
    || !Number.isFinite(averageEntry)
    || averageEntry <= 0
  ) {
    return {
      status: "Watch closely",
      tone: "watch",
      explanation: "Fresh market evidence is incomplete. This is not an Exit signal.",
    };
  }

  const profitLossPercent = ((currentPrice - averageEntry) / averageEntry) * 100;
  const lossBreakingLower = profitLossPercent <= -12 && fiveMinute <= -2 && hourly <= -5;
  const gainReversing = profitLossPercent >= 8 && fiveMinute <= -3 && hourly <= 0;
  if (lossBreakingLower || gainReversing) {
    return {
      status: "Exit signal",
      tone: "exit",
      explanation: lossBreakingLower
        ? `The position is ${Math.abs(profitLossPercent).toFixed(1)}% below entry and both live movement windows are falling.`
        : `The position is ${profitLossPercent.toFixed(1)}% above entry, but the live move is reversing.`,
    };
  }

  const underPressure = profitLossPercent <= -6 || fiveMinute <= -2 || hourly <= -5;
  const choppyGain = profitLossPercent >= 5 && fiveMinute < 0;
  if (underPressure || choppyGain) {
    return {
      status: "Watch closely",
      tone: "watch",
      explanation: `Entry return is ${profitLossPercent >= 0 ? "+" : ""}${profitLossPercent.toFixed(1)}%; short moves are ${formatMove(fiveMinute)} / ${formatMove(hourly)}.`,
    };
  }

  return {
    status: "Hold",
    tone: "hold",
    explanation: `Entry return is ${profitLossPercent >= 0 ? "+" : ""}${profitLossPercent.toFixed(1)}% with no confirmed exit pattern in the live move.`,
  };
}

export function hasFreshPaperExitEvidence(
  token: PaperExitToken,
  position: PaperPosition,
  now = Date.now(),
) {
  const marketDataAt = Date.parse(token.marketDataAt ?? "");
  const currentPrice = Number(token.price);
  const averageEntry = position.chipsInvested / position.tokenUnits;
  return Number.isFinite(marketDataAt)
    && now - marketDataAt >= 0
    && now - marketDataAt <= PAPER_MARKET_FRESH_MS
    && token.change5m !== null
    && token.change1h !== null
    && Number.isFinite(Number(token.change5m))
    && Number.isFinite(Number(token.change1h))
    && Number.isFinite(currentPrice)
    && currentPrice > 0
    && Number.isFinite(averageEntry)
    && averageEntry > 0;
}