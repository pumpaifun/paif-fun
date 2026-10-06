import React, { createContext, useContext, useRef, useState } from 'react';
import {
  connectWallet, disconnectWallet, signWalletDemo, supported, type WalletProof,
} from '@/lib/wallet-adapter';

interface WalletContextValue {
  address: string | null; busy: boolean; error: string | null; proof: WalletProof | null;
  supported: boolean; connect(): Promise<void>; disconnect(): Promise<void>; signDemo(): Promise<void>;
  clearError(): void;
}
const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proof, setProof] = useState<WalletProof | null>(null);
  const lock = useRef(false);

  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try { await action(); } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Wallet request failed. Nothing was signed or sent.');
    } finally { lock.current = false; setBusy(false); }
  }

  return (
    <WalletContext.Provider value={{
      address, busy, error, proof, supported, clearError: () => setError(null),
      connect: () => run(async () => {
        const account = await connectWallet();
        setAddress(account.address);
        setProof(null);
      }),
      disconnect: () => run(async () => {
        try { await disconnectWallet(); }
        finally { setAddress(null); setProof(null); }
      }),
      signDemo: () => run(async () => {
        if (!address) throw new Error('Connect your wallet before requesting a message signature.');
        setProof(null);
        const result = await signWalletDemo(address);
        if (result.address !== address) throw new Error('The wallet account changed. Reconnect before signing.');
        setProof(result);
      }),
    }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error('WalletProvider is missing.');
  return context;
}
