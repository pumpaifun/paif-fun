import { Connection, PublicKey, type ParsedAccountData } from '@solana/web3.js';
import { z } from 'zod';
import { apiOrigin } from './research';
export { formatRawAmount, toRawTokenAmount } from './trading-amounts';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
const connection = new Connection(MAINNET_RPC, 'confirmed');

const quoteSchema = z.object({
  inputMint: z.string(),
  inAmount: z.string().regex(/^\d+$/),
  outputMint: z.string(),
  outAmount: z.string().regex(/^\d+$/),
  otherAmountThreshold: z.string().regex(/^\d+$/),
  priceImpactPct: z.string(),
  routePlan: z.array(z.object({
    swapInfo: z.object({ label: z.string().optional() }).passthrough(),
  }).passthrough()).default([]),
}).passthrough();

export type JupiterQuote = z.infer<typeof quoteSchema>;
export type TradeSide = 'buy' | 'sell';
export interface LiveTradeQuote {
  provider: 'Pump.fun' | 'Jupiter';
  side: TradeSide;
  mint: string;
  decimals: number;
  inputAmount: number;
  expectedOutput: string;
  minimumOutput: string;
  slippageBps: number;
  createdAt: number;
  jupiter?: JupiterQuote;
  route: string[];
  priceImpactPct?: string;
}
export interface WalletTokenSnapshot {
  decimals: number;
  tokenAmount: string;
  solLamports: number;
}

async function readMintDecimals(mint: PublicKey): Promise<number> {
  const result = await connection.getParsedAccountInfo(mint, 'confirmed');
  const data = result.value?.data;
  if (!data || !('parsed' in data)) throw new Error('Could not read this token mint on Solana mainnet.');
  const parsed = data as ParsedAccountData;
  const decimals = Number((parsed.parsed.info as { decimals?: unknown })?.decimals);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error('The token returned invalid decimal information. Trading is disabled.');
  }
  return decimals;
}

export async function loadWalletTokenSnapshot(
  ownerAddress: string,
  mintAddress: string,
): Promise<WalletTokenSnapshot> {
  const owner = new PublicKey(ownerAddress);
  const mint = new PublicKey(mintAddress);
  const [decimals, solLamports, accounts] = await Promise.all([
    readMintDecimals(mint),
    connection.getBalance(owner, 'confirmed'),
    connection.getParsedTokenAccountsByOwner(owner, { mint }, 'confirmed'),
  ]);
  let tokenAmount = 0n;
  for (const account of accounts.value) {
    const raw = (account.account.data as ParsedAccountData).parsed.info
      .tokenAmount?.amount;
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
      throw new Error('A token account returned an unreadable balance. Trading is disabled.');
    }
    tokenAmount += BigInt(raw);
  }
  return { decimals, tokenAmount: tokenAmount.toString(), solLamports };
}

async function postApiJson(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`${apiOrigin()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'omit',
    cache: 'no-store',
    signal,
  });
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error('The PAIF trading API did not return a valid response.');
  }
  const data = await response.json();
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : `Trade request failed (${response.status}).`);
  }
  return data;
}

export async function requestJupiterQuote(
  mint: string,
  side: TradeSide,
  rawAmount: number,
  slippageBps = 150,
): Promise<JupiterQuote> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 75_000);
  try {
    const raw = await postApiJson('/api/swap/quote', {
      inputMint: side === 'buy' ? SOL_MINT : mint,
      outputMint: side === 'buy' ? mint : SOL_MINT,
      amount: rawAmount,
      slippageBps,
    }, controller.signal);
    const parsed = quoteSchema.safeParse(raw);
    if (!parsed.success) throw new Error('The swap quote is incomplete. No transaction was created.');
    if (
      parsed.data.inputMint !== (side === 'buy' ? SOL_MINT : mint)
      || parsed.data.outputMint !== (side === 'buy' ? mint : SOL_MINT)
    ) {
      throw new Error('The quote returned a different token pair. No transaction was created.');
    }
    return parsed.data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The quote request timed out. No transaction was created.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function postTradeJson(path: string, body: unknown): Promise<Record<string, unknown>> {
  const raw = await postApiJson(path, body);
  const parsed = z.record(z.string(), z.unknown()).safeParse(raw);
  if (!parsed.success) throw new Error('The transaction builder returned an invalid response.');
  return parsed.data;
}

export async function requestLiveTradeQuote(
  mint: string,
  side: TradeSide,
  inputAmount: number,
  rawAmount: number,
  decimals: number,
  slippageBps = 150,
): Promise<LiveTradeQuote> {
  if (mint.toLowerCase().endsWith('pump')) {
    const params = new URLSearchParams({
      mint,
      action: side,
      amount: String(side === 'buy' ? rawAmount : inputAmount),
      decimals: String(decimals),
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(`${apiOrigin()}/api/pump/quote?${params.toString()}`, {
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      });
      const data = await response.json();
      if (response.ok) {
        const expected = side === 'buy' ? data?.tokensOut : data?.solOut;
        if (typeof expected !== 'string' || !/^\d+$/.test(expected) || BigInt(expected) <= 0n) {
          throw new Error('The Pump.fun quote is incomplete. No transaction was created.');
        }
        const minimumOutput = (BigInt(expected) * BigInt(10_000 - slippageBps) / 10_000n).toString();
        return {
          provider: 'Pump.fun',
          side,
          mint,
          decimals,
          inputAmount,
          expectedOutput: expected,
          minimumOutput,
          slippageBps,
          createdAt: Date.now(),
          route: ['Pump.fun bonding curve'],
        };
      }
      const message = typeof data?.error === 'string' ? data.error : `Pump.fun quote failed (${response.status}).`;
      if (!/PUMP_GRADUATED|graduated/i.test(message)) throw new Error(message);
    } catch (error) {
      if (controller.signal.aborted) throw new Error('The Pump.fun quote timed out. No transaction was created.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  const jupiter = await requestJupiterQuote(mint, side, rawAmount, slippageBps);
  return {
    provider: 'Jupiter',
    side,
    mint,
    decimals,
    inputAmount,
    expectedOutput: side === 'buy' ? jupiter.outAmount : jupiter.outAmount,
    minimumOutput: jupiter.otherAmountThreshold,
    slippageBps,
    createdAt: Date.now(),
    jupiter,
    route: Array.from(new Set(jupiter.routePlan.map((leg) => leg.swapInfo.label).filter((label): label is string => !!label))),
    priceImpactPct: jupiter.priceImpactPct,
  };
}

export async function requestLiveTradeTransaction(
  quote: LiveTradeQuote,
  ownerAddress: string,
  rawAmount: number,
): Promise<string> {
  if (quote.createdAt + 90_000 < Date.now()) {
    throw new Error('This quote has expired. Request a new quote before signing.');
  }
  if (quote.provider === 'Pump.fun') {
    const path = quote.side === 'buy' ? '/api/pump/buy-tx' : '/api/pump/sell-tx';
    const payload = quote.side === 'buy'
      ? { mint: quote.mint, userPublicKey: ownerAddress, solLamports: rawAmount, slippageBps: quote.slippageBps }
      : { mint: quote.mint, userPublicKey: ownerAddress, tokenAmount: quote.inputAmount, decimals: quote.decimals, slippageBps: quote.slippageBps };
    const transaction = await postTradeJson(path, payload);
    if (typeof transaction.transaction !== 'string' || !transaction.transaction) {
      throw new Error('The Pump.fun transaction builder returned no transaction.');
    }
    return transaction.transaction;
  }
  if (!quote.jupiter) throw new Error('The Jupiter quote is missing. Request a fresh quote before signing.');
  const transaction = await postTradeJson('/api/swap/transaction', {
    quoteResponse: quote.jupiter,
    userPublicKey: ownerAddress,
  });
  if (typeof transaction.swapTransaction !== 'string' || !transaction.swapTransaction) {
    throw new Error('The Jupiter transaction builder returned no transaction.');
  }
  return transaction.swapTransaction;
}

export async function waitForTransaction(signature: string): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const status = result.value[0];
    if (status?.err) throw new Error(`The transaction failed on-chain: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return true;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return false;
}

