import { useMemo, useEffect, useRef } from "react";
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
} from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { CoinbaseWalletAdapter } from "@solana/wallet-adapter-coinbase";
import { TrustWalletAdapter } from "@solana/wallet-adapter-trust";
import { WalletName, WalletReadyState } from "@solana/wallet-adapter-base";
import { isInPhantomBrowser } from "./use-phantom-browser";
import { rpcFetchWithFallback } from "./rpc-fallback";

const QUICKNODE_KEY = import.meta.env.VITE_QUICKNODE_RPC;
const RPC_ENDPOINT = QUICKNODE_KEY
  ? QUICKNODE_KEY
  : "https://api.mainnet-beta.solana.com";

const SESSION_KEY = "wallet_session_at";
const SESSION_HOURS = 24;

function WalletSessionGuard({ children }: { children: React.ReactNode }) {
  const { connected, disconnect } = useWallet();

  useEffect(() => {
    if (connected) {
      localStorage.setItem(SESSION_KEY, Date.now().toString());
    }
  }, [connected]);

  useEffect(() => {
    const stored = localStorage.getItem(SESSION_KEY);
    if (!stored) return;
    const hoursElapsed = (Date.now() - parseInt(stored, 10)) / (1000 * 60 * 60);
    if (hoursElapsed >= SESSION_HOURS) {
      localStorage.removeItem(SESSION_KEY);
      disconnect();
    }
  }, [disconnect]);

  return <>{children}</>;
}

function PhantomBrowserAutoConnect({ children }: { children: React.ReactNode }) {
  const { select, connect, connected, connecting } = useWallet();
  const attempted = useRef(false);

  useEffect(() => {
    if (connected || connecting || attempted.current) return;
    if (!isInPhantomBrowser()) return;

    attempted.current = true;
    select("Phantom" as WalletName);
    setTimeout(() => {
      connect().catch(() => {
        attempted.current = false;
      });
    }, 300);
  }, [connected, connecting, select, connect]);

  return <>{children}</>;
}

// Restores the returning-user experience that global `autoConnect` used to
// provide. We disabled `autoConnect` on the provider because it fired its own
// connect() in the same tick as the login modal's manual connect(), racing the
// adapter's "connect" event and leaving React's `connected` stuck at false
// (modal spins + header shows "Sign In") until a page refresh resynced it.
// Driving connect from exactly one place removes that race; this component
// re-establishes load-time reconnect deterministically: if a wallet was
// selected within the active session window, reselect + connect it once. A
// recently-trusted wallet reconnects silently — nothing pops up unprompted.
function ReconnectOnLoad({ children }: { children: React.ReactNode }) {
  const { select, connect, connected, connecting, wallets } = useWallet();
  const done = useRef(false);

  useEffect(() => {
    if (done.current || connected || connecting) return;
    if (isInPhantomBrowser()) return; // in-app browser handled separately

    const storedName = localStorage.getItem("walletName");
    const sessionAt = localStorage.getItem(SESSION_KEY);
    if (!storedName || !sessionAt) return;
    if ((Date.now() - parseInt(sessionAt, 10)) / (1000 * 60 * 60) >= SESSION_HOURS) return;

    let name: string;
    try {
      name = JSON.parse(storedName);
    } catch {
      name = storedName;
    }
    const target = wallets.find((w) => w.adapter.name === name);
    if (!target) return;
    // Only auto-reconnect a wallet that's actually Installed. A `Loadable`
    // adapter (e.g. mobile Safari) would deep-link redirect to the wallet app
    // on connect() — global autoConnect deliberately skipped that, so we do too.
    if (target.readyState !== WalletReadyState.Installed) {
      return; // not installed/ready — effect retries when `wallets` updates
    }

    done.current = true;
    select(name as WalletName);
    // Do NOT return a cleanup that clears this timer. `select()` changes the
    // wallet context, which re-runs this effect (deps include `connect`, whose
    // identity changes with the adapter) — a cleanup would cancel the pending
    // connect() before it ever fired, stranding the user "selected but never
    // connected" (pages then show "Connect your wallet" until they navigate
    // away and back). The timer is one-shot and run-once-guarded, so leaving
    // it to fire is safe even across unmount.
    setTimeout(() => {
      connect().catch(() => {});
    }, 250);
  }, [wallets, connected, connecting, select, connect]);

  return <>{children}</>;
}

export function SolanaWalletProvider({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new CoinbaseWalletAdapter(),
      new TrustWalletAdapter(),
    ],
    [],
  );

  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT} config={{ commitment: "confirmed", fetch: rpcFetchWithFallback }}>
      <WalletProvider wallets={wallets}>
        <WalletSessionGuard>
          <ReconnectOnLoad>
            <PhantomBrowserAutoConnect>
              {children}
            </PhantomBrowserAutoConnect>
          </ReconnectOnLoad>
        </WalletSessionGuard>
      </WalletProvider>
    </ConnectionProvider>
  );
}
