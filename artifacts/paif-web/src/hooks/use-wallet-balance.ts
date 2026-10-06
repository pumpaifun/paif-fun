import { useState, useEffect, useCallback, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

export interface TokenBalance {
  mint: string;
  symbol: string;
  name: string;
  balance: number;
  decimals: number;
  uiAmount: number;
}

export interface WalletBalanceState {
  solBalance: number | null;
  tokenBalances: TokenBalance[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const REFRESH_INTERVAL_MS = 30_000;
const MAX_RETRIES = 3;

async function withRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < retries - 1) {
        await new Promise((res) => setTimeout(res, 600 * (i + 1)));
      }
    }
  }
  throw lastErr;
}

export function useWalletBalance(): WalletBalanceState {
  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();

  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [tokenBalances, setTokenBalances] = useState<TokenBalance[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef(false);

  const fetchBalances = useCallback(async () => {
    if (!publicKey || !connected) {
      setSolBalance(null);
      setTokenBalances([]);
      return;
    }

    setIsLoading(true);
    setError(null);
    abortRef.current = false;

    try {
      console.log("[wallet-balance] Fetching for:", publicKey.toBase58());

      // Direct RPC first; if the wallet's in-app browser can't reach it
      // (network blips / rate limits), fall back to PAIF's own server so the
      // header balance never silently disappears.
      const lamports = await withRetry(() => connection.getBalance(publicKey, "confirmed")).catch(async () => {
        const r = await fetch(`/api/sol-balance/${publicKey.toBase58()}`);
        if (!r.ok) throw new Error("Balance lookup failed");
        const j = await r.json();
        if (typeof j?.lamports !== "number") throw new Error("Balance lookup failed");
        return j.lamports as number;
      });
      if (abortRef.current) return;
      const sol = lamports / 1e9;
      console.log("[wallet-balance] SOL:", sol);
      setSolBalance(sol);

      const [tokenAccounts, token2022Accounts] = await Promise.allSettled([
        withRetry(() =>
          connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID }, "confirmed")
        ),
        withRetry(() =>
          connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_2022_PROGRAM_ID }, "confirmed")
        ),
      ]);

      if (abortRef.current) return;

      const allAccounts = [
        ...(tokenAccounts.status === "fulfilled" ? tokenAccounts.value.value : []),
        ...(token2022Accounts.status === "fulfilled" ? token2022Accounts.value.value : []),
      ];

      const tokens: TokenBalance[] = allAccounts
        .map((account) => {
          const info = account.account.data.parsed?.info;
          if (!info) return null;
          const mint: string = info.mint;
          const decimals: number = info.tokenAmount?.decimals ?? 0;
          const uiAmount: number = info.tokenAmount?.uiAmount ?? 0;
          const balance: number = parseInt(info.tokenAmount?.amount ?? "0", 10);
          if (uiAmount <= 0) return null;
          return {
            mint,
            symbol: "",
            name: mint.slice(0, 6) + "...",
            balance,
            decimals,
            uiAmount,
          };
        })
        .filter((t): t is TokenBalance => t !== null)
        .sort((a, b) => b.uiAmount - a.uiAmount);

      console.log("[wallet-balance] Tokens:", tokens.length);
      setTokenBalances(tokens);
    } catch (err: any) {
      console.error("[wallet-balance] Error:", err);
      if (!abortRef.current) {
        setError(err.message || "Failed to fetch balances");
      }
    } finally {
      if (!abortRef.current) setIsLoading(false);
    }
  }, [publicKey?.toBase58(), connected, connection]);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    abortRef.current = false;

    if (connected && publicKey) {
      fetchBalances();
      intervalRef.current = setInterval(fetchBalances, REFRESH_INTERVAL_MS);
    } else {
      abortRef.current = true;
      setSolBalance(null);
      setTokenBalances([]);
      setError(null);
      setIsLoading(false);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      abortRef.current = true;
    };
  }, [connected, publicKey?.toBase58()]);

  return { solBalance, tokenBalances, isLoading, error, refresh: fetchBalances };
}
