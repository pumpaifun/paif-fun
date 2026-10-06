import { useActiveChain } from "@/lib/active-chain";
import { CHAINS } from "@/lib/chains";

// Demo-day surface: keep the story entirely on Solana. Other chain adapters
// remain in the codebase for later phases but are not advertised in the header.
const ORDER = ["solana"] as const;

export function NetworkSwitcher({ className = "" }: { className?: string }) {
  const { chainId, setChainId } = useActiveChain();

  return (
    <div
      className={`inline-flex items-center rounded-md border border-border bg-muted p-0.5 ${className}`}
      data-testid="network-switcher"
    >
      {ORDER.map((id) => {
        const active = chainId === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setChainId(id)}
            aria-pressed={active}
            className={`px-1 sm:px-2.5 py-1 rounded text-[10px] sm:text-[11px] font-bold tracking-wide transition-colors ${
              active
                ? "bg-black text-white dark:bg-white dark:text-black"
                : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid={`button-network-${id}`}
          >
            {CHAINS[id].shortName}
          </button>
        );
      })}
    </div>
  );
}
