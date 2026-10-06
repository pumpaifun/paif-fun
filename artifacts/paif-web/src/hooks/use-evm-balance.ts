import { useAccount, useBalance } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { useActiveChain } from "@/lib/active-chain";

export interface EvmWalletInfo {
  walletAddress: string;
  bnbBalance: number;
  bnbPriceUsd: number | null;
  nativeSymbol?: string;
  tokens: { address: string; symbol: string; name: string; balance: number; decimals: number }[];
  tokensIncomplete: boolean;
}

/**
 * Chain-aware EVM balance hook for the connected wallet.
 * - Native balance comes straight from wagmi/viem (no API key needed) and
 *   reflects whatever EVM chain the wallet is currently on.
 * - Token holdings come from the server (explorer-derived); they degrade
 *   gracefully to an empty list when no data provider key is configured.
 */
export function useEvmBalance() {
  const { address, isConnected } = useAccount();
  const { chainId: activeChainId } = useActiveChain();

  const native = useBalance({
    address,
    query: { enabled: isConnected && !!address },
  });

  const walletInfo = useQuery<EvmWalletInfo>({
    queryKey: ["/api/evm/wallet", address, activeChainId],
    enabled: isConnected && !!address,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await fetch(`/api/evm/wallet/${address}?chainId=${activeChainId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
  });

  const bnbBalance = native.data
    ? Number(formatUnits(native.data.value, native.data.decimals))
    : walletInfo.data?.bnbBalance ?? null;

  return {
    address: address ?? null,
    isConnected,
    bnbBalance,
    bnbSymbol: native.data?.symbol ?? walletInfo.data?.nativeSymbol ?? "ETH",
    bnbPriceUsd: walletInfo.data?.bnbPriceUsd ?? null,
    tokens: walletInfo.data?.tokens ?? [],
    tokensIncomplete: walletInfo.data?.tokensIncomplete ?? false,
    isLoading: native.isLoading || walletInfo.isLoading,
    error: native.error || walletInfo.error,
    refresh: () => {
      native.refetch();
      walletInfo.refetch();
    },
  };
}
