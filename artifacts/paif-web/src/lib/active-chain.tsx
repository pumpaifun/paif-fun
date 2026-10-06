import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { CHAINS, DEFAULT_CHAIN, isChainId, type ChainId, type ChainConfig } from "./chains";

const STORAGE_KEY = "paif:chain";

interface ActiveChainContextValue {
  chainId: ChainId;
  chain: ChainConfig;
  setChainId: (id: ChainId) => void;
}

const ActiveChainContext = createContext<ActiveChainContextValue | null>(null);

function readStoredChain(): ChainId {
  if (typeof window === "undefined") return DEFAULT_CHAIN;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isChainId(stored)) return stored;
  } catch {}
  return DEFAULT_CHAIN;
}

export function ChainProvider({ children }: { children: ReactNode }) {
  const [chainId, setChainIdState] = useState<ChainId>(readStoredChain);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, chainId);
    } catch {}
  }, [chainId]);

  const setChainId = (id: ChainId) => setChainIdState(id);

  return (
    <ActiveChainContext.Provider value={{ chainId, chain: CHAINS[chainId], setChainId }}>
      {children}
    </ActiveChainContext.Provider>
  );
}

export function useActiveChain(): ActiveChainContextValue {
  const ctx = useContext(ActiveChainContext);
  if (!ctx) {
    throw new Error("useActiveChain must be used within a ChainProvider");
  }
  return ctx;
}
