import type { BotAction, BotKind } from './bot-control';

export function botReadSessionMessage(kind: BotKind, ownerWallet: string, nonce: number): string {
  const prefix = kind === 'swing' ? 'paif-swing' : 'paif-auto-strategy';
  return `${prefix}|v1|read-session|${ownerWallet}|${nonce}`;
}

export function botActionMessage(
  kind: BotKind,
  action: BotAction,
  strategyId: string,
  ownerWallet: string,
  nonce: number,
): string {
  const prefix = kind === 'swing' ? 'paif-swing' : 'paif-auto-strategy';
  return `${prefix}|v1|${action}|${strategyId}|${ownerWallet}|${nonce}`;
}
