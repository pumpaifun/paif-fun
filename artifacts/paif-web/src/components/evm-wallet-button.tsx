import { useConnect, useAccount, useDisconnect, useSwitchChain } from "wagmi";
import { Wallet, LogOut, Loader2, ChevronDown, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEvmBalance } from "@/hooks/use-evm-balance";
import { useActiveChain } from "@/lib/active-chain";

function truncate(address: string) {
  return address.slice(0, 6) + "..." + address.slice(-4);
}

export function EvmWalletButton({ compact = false }: { compact?: boolean }) {
  const { connectors, connect, isPending } = useConnect();
  const { isConnected, address, chainId: walletChainId } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { chain } = useActiveChain();
  const { bnbBalance, bnbSymbol, tokens, tokensIncomplete, isLoading } = useEvmBalance();

  const targetChainId = chain.evmChainId;
  const wrongNetwork = isConnected && !!targetChainId && walletChainId !== targetChainId;

  if (!isConnected || !address) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="default"
            size="sm"
            className="font-bold text-xs rounded-md gap-1.5"
            disabled={isPending}
            data-testid="button-evm-connect"
          >
            {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wallet className="w-3.5 h-3.5" />}
            Connect {chain.shortName}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="z-[10000]">
          <DropdownMenuLabel>Connect an EVM wallet</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <div className="px-2 pb-1.5 text-[11px] text-muted-foreground leading-snug max-w-[15rem]">
            One 0x… wallet (MetaMask, Rabbit, etc.) works across every EVM network — including {chain.name}. This is separate from your Solana (Phantom) wallet.
          </div>
          {connectors.length === 0 && (
            <DropdownMenuItem disabled>No wallet detected</DropdownMenuItem>
          )}
          {connectors.map((c) => (
            <DropdownMenuItem
              key={c.uid}
              onClick={() => connect({ connector: c })}
              data-testid={`button-evm-connector-${c.id}`}
            >
              {c.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-muted border border-border hover:bg-muted/80 transition-colors"
          data-testid="button-evm-wallet"
        >
          <Wallet className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" />
          {!compact && <span className="text-xs font-semibold text-foreground">{truncate(address)}</span>}
          {wrongNetwork ? (
            <span className="text-xs font-bold text-amber-500 inline-flex items-center gap-1" data-testid="text-wrong-network">
              <AlertTriangle className="w-3 h-3" /> Wrong network
            </span>
          ) : isLoading ? (
            <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
          ) : bnbBalance !== null ? (
            <span className="text-xs font-bold text-yellow-500" data-testid="text-bnb-balance">
              {bnbBalance.toFixed(4)} {bnbSymbol}
            </span>
          ) : null}
          <ChevronDown className="w-3 h-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[10000] w-64">
        <DropdownMenuLabel className="font-mono text-[11px]">{truncate(address)}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {wrongNetwork && targetChainId && (
          <>
            <div className="px-2 py-1.5">
              <div className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 mb-1.5">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>Your wallet is on a different network. Switch to {chain.name} to scan and trade here.</span>
              </div>
              <Button
                size="sm"
                className="w-full font-bold text-xs"
                disabled={isSwitching}
                onClick={() => switchChain({ chainId: targetChainId as 56 | 8453 | 1329 })}
                data-testid="button-evm-switch-network"
              >
                {isSwitching ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                Switch to {chain.name}
              </Button>
            </div>
            <DropdownMenuSeparator />
          </>
        )}
        <div className="px-2 py-1.5 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{bnbSymbol}</span>
          <span className="font-bold">{bnbBalance !== null ? bnbBalance.toFixed(5) : "—"} {bnbSymbol}</span>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[11px] text-muted-foreground">Token balances</DropdownMenuLabel>
        <div className="max-h-48 overflow-y-auto">
          {tokens.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground" data-testid="text-evm-no-tokens">
              {tokensIncomplete ? "Token data unavailable" : "No token balances"}
            </div>
          ) : (
            tokens.map((t) => (
              <div
                key={t.address}
                className="px-2 py-1.5 flex items-center justify-between text-xs gap-2"
                data-testid={`row-evm-token-${t.address}`}
              >
                <span className="font-semibold truncate">{t.symbol || truncate(t.address)}</span>
                <span className="font-mono text-muted-foreground flex-shrink-0">
                  {t.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                </span>
              </div>
            ))
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => disconnect()} data-testid="button-evm-disconnect">
          <LogOut className="w-4 h-4 mr-2" /> Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
