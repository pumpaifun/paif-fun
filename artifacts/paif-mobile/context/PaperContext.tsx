import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchTrendingTokens, type Token } from '@/lib/research';
import { buyAtQuote, initialPaperState, paperSchema, sellAtQuote, type PaperState } from '@/lib/paper';

const STORAGE_KEY = 'paif.android.manual-paper.v1';
type PaperContextValue = {
  state: PaperState; loaded: boolean; error: string | null; busy: boolean;
  buy: (token: Token, chips: number) => Promise<void>;
  sell: (mint: string) => Promise<void>;
  reset: () => Promise<void>;
  retry: () => Promise<void>;
};
const PaperContext = createContext<PaperContextValue | null>(null);

export function PaperProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PaperState>(initialPaperState);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = useRef(state);
  const lock = useRef(false);
  const isLoaded = useRef(false);
  const mounted = useRef(true);

  async function retry() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      const next = stored === null ? initialPaperState() : paperSchema.parse(JSON.parse(stored));
      current.current = next;
      isLoaded.current = true;
      if (mounted.current) { setState(next); setLoaded(true); }
    } catch {
      isLoaded.current = false;
      if (mounted.current) {
        setLoaded(false);
        setError('Your saved practice account could not be read. It has not been overwritten. Retry, or explicitly reset it.');
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void retry();
    return () => { mounted.current = false; };
  }, []);

  async function commit(transform: () => Promise<PaperState>, allowReset = false) {
    if (lock.current) throw new Error('A practice action is already running.');
    if (!isLoaded.current && !allowReset) throw new Error('Load your saved practice account before trading.');
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = paperSchema.parse(await transform());
      // Persist the whole ledger before updating UI; failed writes never consume chips.
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      current.current = next;
      isLoaded.current = true;
      if (mounted.current) { setState(next); setLoaded(true); }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The practice action could not be saved.';
      if (mounted.current) setError(message);
      throw new Error(message);
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function quote(mint: string) {
    // Never settle from a displayed/cache-only quote. Re-read public market data.
    const tokens = await fetchTrendingTokens();
    const token = tokens.find((item) => item.mint === mint);
    if (!token) throw new Error('This token is no longer in the discovery feed. Its saved position is preserved; no trade was made without a verified fresh quote.');
    return token;
  }

  return (
    <PaperContext.Provider value={{
      state, loaded, error, busy, retry,
      buy: (token, chips) => commit(async () => buyAtQuote(current.current, await quote(token.mint), chips)),
      sell: (mint) => commit(async () => sellAtQuote(current.current, await quote(mint))),
      reset: () => commit(async () => initialPaperState(), true),
    }}>
      {children}
    </PaperContext.Provider>
  );
}

export function usePaper() {
  const context = useContext(PaperContext);
  if (!context) throw new Error('PaperProvider is missing.');
  return context;
}
