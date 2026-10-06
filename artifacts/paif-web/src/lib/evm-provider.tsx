import { ReactNode } from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { bsc, base, sei } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";

const wcProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined;
const bscRpcUrl = (import.meta.env.VITE_BSC_RPC_URL as string | undefined) || undefined;
const baseRpcUrl = (import.meta.env.VITE_BASE_RPC_URL as string | undefined) || undefined;
const seiRpcUrl = (import.meta.env.VITE_SEI_RPC_URL as string | undefined) || undefined;

const connectors = [
  injected({ shimDisconnect: true }),
  ...(wcProjectId
    ? [
        walletConnect({
          projectId: wcProjectId,
          showQrModal: true,
          metadata: {
            name: "PAIF.fun",
            description: "Crypto token scanner for Pump.fun and four.meme tokens",
            url: "https://paif.fun",
            icons: [],
          },
        }),
      ]
    : []),
];

export const wagmiConfig = createConfig({
  chains: [bsc, base, sei],
  connectors,
  transports: {
    [bsc.id]: http(bscRpcUrl),
    [base.id]: http(baseRpcUrl),
    [sei.id]: http(seiRpcUrl),
  },
  ssr: false,
});

export function EvmWalletProvider({ children }: { children: ReactNode }) {
  return <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>;
}

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
