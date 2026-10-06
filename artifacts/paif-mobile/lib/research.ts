import { useMutation, useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { mintSchema, scanSchema, tokenSchema, type Token, type Weather } from './models';
import { z } from 'zod';
export type { Token, Weather, ScanResult } from './models';

// Legacy PAIF research endpoints are not in the generated client; the assigned
// companion scope permits this narrow public-data adapter. No signed bot routes.
export function apiOrigin(): string {
  if (Platform.OS === 'web') return '';
  const configured = process.env.EXPO_PUBLIC_API_URL ?? Constants.expoConfig?.extra?.apiOrigin;
  if (typeof configured !== 'string' || !/^https:\/\/[^/]+\/?$/.test(configured)) {
    throw new Error('A valid HTTPS PAIF API origin is required in the Android build.');
  }
  return configured.replace(/\/$/, '');
}

async function publicRequest(path: string, signal?: AbortSignal, query?: string): Promise<unknown> {
  const controller = new AbortController();
  const relayAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', relayAbort);
  const timeout = setTimeout(() => controller.abort(), query ? 65_000 : 20_000);
  try {
    const response = await fetch(`${apiOrigin()}${path}`, {
      method: query === undefined ? 'GET' : 'POST',
      headers: query === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: query === undefined ? undefined : JSON.stringify({ query }),
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      throw new Error('The research API did not return data. Check the backend connection.');
    }
    const data = await response.json();
    if (!response.ok) {
      throw new Error(typeof data?.error === 'string' ? data.error : `Research request failed (${response.status}).`);
    }
    return data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Research request timed out or was cancelled. Please retry.');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', relayAbort);
  }
}

export async function fetchTrendingTokens(signal?: AbortSignal): Promise<Token[]> {
  const parsed = z.array(tokenSchema).safeParse(await publicRequest('/api/trending-tokens', signal));
  if (!parsed.success) throw new Error('Token data is incomplete or has an unexpected format. No practice trades were made.');
  return parsed.data;
}

export function useTrendingTokens() {
  return useQuery({
    queryKey: ['mobile', 'trending'],
    queryFn: ({ signal }) => fetchTrendingTokens(signal),
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 1,
  });
}

export function useMarketWeather() {
  return useQuery<Weather>({
    queryKey: ['mobile', 'weather'],
    queryFn: async ({ signal }) => {
      const raw = await publicRequest('/api/swing-bot/market-weather', signal);
      const parsed = z.object({
        available: z.boolean(),
        solUsd: z.number().finite().optional(),
        solChg24: z.number().finite().optional(),
        btcChg24: z.number().finite().optional(),
        nasdaqChg1d: z.number().finite().nullable().optional(),
        mood: z.string().optional(),
        fetchedAt: z.number().finite().optional(),
        facts: z.string().optional(),
      }).safeParse(raw);
      if (!parsed.success) throw new Error('Market weather data is unavailable.');
      return parsed.data;
    },
    refetchInterval: 120_000,
    retry: 1,
  });
}

export function normalizeQuery(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('https://')) {
    let url: URL;
    try { url = new URL(trimmed); } catch { throw new Error('Enter a Solana mint address or a valid Pump.fun link.'); }
    if (!['pump.fun', 'www.pump.fun'].includes(url.hostname)) {
      throw new Error('Only Solana mint addresses and Pump.fun token links are accepted.');
    }
    const mint = url.pathname.split('/').filter(Boolean).at(-1);
    const parsed = mintSchema.safeParse(mint);
    if (!parsed.success) throw new Error('The Pump.fun link does not contain a valid token address.');
    return parsed.data;
  }
  const parsed = mintSchema.safeParse(trimmed);
  if (!parsed.success) throw new Error('Enter a Solana token mint address (32–44 base58 characters).');
  return parsed.data;
}

export function useScanToken() {
  return useMutation({
    mutationFn: async (query: string) => {
      const raw = await publicRequest('/api/scan', undefined, normalizeQuery(query));
      const parsed = scanSchema.safeParse(raw);
      if (!parsed.success) throw new Error('The scan response is incomplete. Unknown evidence must not be treated as safe.');
      return parsed.data;
    },
    retry: false,
  });
}
