import { z } from 'zod';
import { apiOrigin } from './research';
import { botActionMessage, botReadSessionMessage } from './bot-control-messages';

export type BotKind = 'swing' | 'auto';
export type BotAction = 'start' | 'pause' | 'stop' | 'cancel' | 'sell-now';

const strategySchema = z.object({
  id: z.string().min(1),
  name: z.string().optional().default('My bot'),
  mode: z.string().optional().default('paper'),
  status: z.string().optional().default('unknown'),
  style: z.string().optional(),
  budgetSol: z.number().optional(),
  budgetLamports: z.string().optional(),
  workerWallet: z.string().optional(),
  tradingWallet: z.string().optional(),
  nextRunAt: z.string().nullable().optional(),
}).passthrough();

export type BotSummary = z.infer<typeof strategySchema>;

function tokenHeader(kind: BotKind): string {
  return kind === 'swing' ? 'X-Swing-Token' : 'X-Auto-Strategy-Token';
}

function basePath(kind: BotKind): string {
  return kind === 'swing' ? '/api/swing-bot' : '/api/auto-strategy';
}

async function apiRequest(
  path: string,
  options: RequestInit = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(`${apiOrigin()}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    credentials: 'omit',
    cache: 'no-store',
  });
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) {
    throw new Error('The PAIF bot service returned an unreadable response.');
  }
  const data = await response.json();
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : `Bot request failed (${response.status}).`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('The PAIF bot service returned an invalid response.');
  }
  return data as Record<string, unknown>;
}

export async function createBotReadToken(
  kind: BotKind,
  ownerWallet: string,
  signMessage: (message: string) => Promise<string>,
): Promise<string> {
  const nonce = Date.now();
  const signature = await signMessage(botReadSessionMessage(kind, ownerWallet, nonce));
  const result = await apiRequest(`${basePath(kind)}/auth`, {
    method: 'POST',
    body: JSON.stringify({ ownerWallet, nonce, signature }),
  });
  if (typeof result.token !== 'string' || !result.token) {
    throw new Error('The bot service did not issue a read-session token.');
  }
  return result.token;
}

export async function listOwnerBots(
  kind: BotKind,
  ownerWallet: string,
  token: string,
): Promise<BotSummary[]> {
  const query = new URLSearchParams({ owner: ownerWallet });
  const result = await apiRequest(`${basePath(kind)}/list?${query}`, {
    headers: { [tokenHeader(kind)]: token },
  });
  const parsed = z.object({ strategies: z.array(strategySchema) }).safeParse(result);
  if (!parsed.success) throw new Error('The bot list response is incomplete or invalid.');
  return parsed.data.strategies;
}

export async function getOwnerBotDetails(
  kind: BotKind,
  id: string,
  token: string,
): Promise<Record<string, unknown>> {
  return apiRequest(`${basePath(kind)}/${encodeURIComponent(id)}`, {
    headers: { [tokenHeader(kind)]: token },
  });
}

export async function submitOwnerBotAction(
  kind: BotKind,
  action: BotAction,
  strategy: Pick<BotSummary, 'id'>,
  ownerWallet: string,
  signMessage: (message: string) => Promise<string>,
): Promise<void> {
  if (kind === 'swing' && !['start', 'pause', 'stop'].includes(action)) {
    throw new Error('This action is not available for Swing Bots.');
  }
  if (kind === 'auto' && !['start', 'pause', 'cancel', 'sell-now'].includes(action)) {
    throw new Error('This action is not available for automated strategies.');
  }
  const nonce = Date.now();
  const signature = await signMessage(botActionMessage(kind, action, strategy.id, ownerWallet, nonce));
  await apiRequest(`${basePath(kind)}/${encodeURIComponent(strategy.id)}/${action}`, {
    method: 'POST',
    body: JSON.stringify({ ownerWallet, nonce, signature }),
  });
}
