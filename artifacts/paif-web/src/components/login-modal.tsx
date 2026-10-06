import { useState, useCallback, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Mail, Wallet, ArrowLeft, Bell, Bot, Shield, Zap, Target, TrendingUp, Loader2, ExternalLink, AlertCircle } from "lucide-react";
import { SiGoogle } from "react-icons/si";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState, WalletName } from "@solana/wallet-adapter-base";
import { isInPhantomBrowser } from "@/lib/use-phantom-browser";

const WALLET_META: Record<string, { bg: string; label: string; initial: string; installUrl: string }> = {
  "Phantom":        { bg: "bg-purple-600",   label: "Phantom",        initial: "P",   installUrl: "https://phantom.app/download" },
  "Solflare":       { bg: "bg-orange-500",   label: "Solflare",       initial: "S",   installUrl: "https://solflare.com/download" },
  "Coinbase Wallet":{ bg: "bg-blue-600",     label: "Coinbase Wallet",initial: "C",   installUrl: "https://www.coinbase.com/wallet/downloads" },
  "Trust Wallet":   { bg: "bg-sky-500",      label: "Trust Wallet",   initial: "T",   installUrl: "https://trustwallet.com/download" },
};

type View = "choose" | "email" | "wallet";

interface LoginModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  walletOnly?: boolean;
}

export function LoginModal({ open, onOpenChange, walletOnly }: LoginModalProps) {
  const [view, setView] = useState<View>(walletOnly ? "wallet" : "choose");
  const [connectingWallet, setConnectingWallet] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  // Two-phase connect: store the wallet name the user clicked, run select()
  // synchronously, then let an effect watch for the selection to actually
  // land before firing connect(). Doing select() and connect() back-to-back
  // races the wallet-adapter context updater and silently no-ops.
  const [pendingConnect, setPendingConnect] = useState<string | null>(null);
  const { select, connect, connected, connecting, wallet, wallets } = useWallet();
  const inPhantomBrowser = isInPhantomBrowser();

  useEffect(() => {
    if (open) {
      setView(walletOnly ? "wallet" : "choose");
      setConnectError(null);
    }
  }, [open, walletOnly]);

  // Close on success. We also accept the adapter's own connected flag as a
  // fallback in case the context `connected` state lags behind the adapter.
  useEffect(() => {
    if ((connected || wallet?.adapter.connected) && open) {
      setConnectingWallet(null);
      setPendingConnect(null);
      onOpenChange(false);
    }
  }, [connected, wallet, open, onOpenChange]);

  // Safety net: never let the connect spinner hang indefinitely. If nothing
  // has connected within the timeout, clear the spinner so the user can retry
  // instead of being stranded.
  useEffect(() => {
    if (!connectingWallet) return;
    const t = setTimeout(() => {
      if (!connected && !wallet?.adapter.connected) {
        setConnectError("That took longer than expected — please try connecting again.");
        setConnectingWallet(null);
        setPendingConnect(null);
      }
    }, 60000);
    return () => clearTimeout(t);
  }, [connectingWallet, connected, wallet]);

  // Phase 2 of the connect handshake: as soon as the wallet-adapter context
  // reports the selection we asked for has landed, fire the actual connect().
  // This avoids the classic adapter race where select() + immediate connect()
  // calls connect on the *previous* (or null) adapter and dies silently.
  useEffect(() => {
    if (!pendingConnect) return;
    if (connected || connecting) return;
    if (!wallet || wallet.adapter.name !== pendingConnect) return;

    let cancelled = false;
    (async () => {
      try {
        // Use the context connect() (not wallet.adapter.connect()) so the
        // WalletProvider stays the single source of truth. Calling the raw
        // adapter directly bypasses the provider's connect coordination and,
        // with autoConnect enabled, leaves the adapter connected while the
        // React `connected` state never flips — so the UI spins "Connecting…"
        // until a page refresh (eager reconnect) resyncs it.
        await connect();
      } catch (err: any) {
        if (cancelled) return;
        const msg: string = err?.message ?? String(err ?? "");
        // Already connected/connecting (e.g. autoConnect won the race) is a
        // success, not an error — let the `connected` effect close the modal.
        if (/already/i.test(msg) || wallet.adapter.connected) {
          return;
        }
        // User-rejection (code 4001 in most wallets) is normal — treat it
        // as a quiet cancel rather than a scary error.
        const isUserReject =
          /reject|denied|cancel|user/i.test(msg) || err?.code === 4001;
        if (!isUserReject) {
          setConnectError(msg || `Couldn't connect to ${pendingConnect}.`);
        }
        setConnectingWallet(null);
        setPendingConnect(null);
      }
    })();
    return () => { cancelled = true; };
  }, [pendingConnect, wallet, connected, connecting, connect]);

  const handleWalletConnect = useCallback((walletName: string) => {
    setConnectError(null);
    const adapter = wallets.find(
      (w) => w.adapter.name.toLowerCase() === walletName.toLowerCase()
    );
    if (!adapter) {
      setConnectError(`${walletName} adapter isn't loaded — try reloading the page.`);
      return;
    }
    setConnectingWallet(adapter.adapter.name);
    setPendingConnect(adapter.adapter.name);
    select(adapter.adapter.name);
  }, [wallets, select]);

  const handlePhantomBrowserConnect = useCallback(() => {
    setConnectError(null);
    setConnectingWallet("Phantom");
    setPendingConnect("Phantom");
    select("Phantom" as WalletName);
  }, [select]);

  function handleClose(val: boolean) {
    if (!val) {
      setView("choose");
      setConnectingWallet(null);
      setPendingConnect(null);
      setConnectError(null);
    }
    onOpenChange(val);
  }

  function handleEmailLogin() {
    window.location.href = "/api/login";
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md" data-testid="dialog-login">

        {inPhantomBrowser && (
          <>
            <DialogHeader>
              <DialogTitle className="text-center text-lg font-bold" data-testid="text-phantom-browser-title">
                Connect Your Wallet
              </DialogTitle>
              <p className="text-center text-sm text-muted-foreground mt-1">
                You're in the Phantom browser — tap below to connect
              </p>
            </DialogHeader>
            <div className="mt-4">
              <Button
                className="w-full h-14 justify-start gap-3 font-bold bg-purple-600 hover:bg-purple-700 text-white"
                disabled={connectingWallet !== null}
                onClick={handlePhantomBrowserConnect}
                data-testid="button-connect-phantom-browser"
              >
                <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
                  {connectingWallet === "Phantom"
                    ? <Loader2 className="w-5 h-5 text-white animate-spin" />
                    : <span className="text-white font-black text-base">P</span>
                  }
                </div>
                <div className="text-left">
                  <div className="text-sm font-bold">
                    {connectingWallet === "Phantom" ? "Connecting…" : "Connect Phantom"}
                  </div>
                  <div className="text-[11px] font-normal opacity-80">Approve in your Phantom wallet</div>
                </div>
              </Button>
            </div>
            {connectError && (
              <div
                className="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                data-testid="text-connect-error-phantom"
              >
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span className="leading-snug">{connectError}</span>
              </div>
            )}
            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-[11px] text-center text-muted-foreground">
                Your keys stay in Phantom — PAIF never holds funds
              </p>
            </div>
          </>
        )}

        {!inPhantomBrowser && view === "choose" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-center text-lg font-bold" data-testid="text-login-title">
                Welcome to PAIF.fun
              </DialogTitle>
              <p className="text-center text-sm text-muted-foreground mt-1">
                Choose how you'd like to sign in
              </p>
            </DialogHeader>

            <div className="flex flex-col gap-3 mt-4">
              <button
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors text-left"
                onClick={() => setView("email")}
                data-testid="button-choose-email"
              >
                <div className="w-9 h-9 rounded-full bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                  <Mail className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-foreground">Sign in with Google</div>
                  <div className="text-xs text-muted-foreground leading-snug">Use your email account for card payments and saved access</div>
                </div>
              </button>

              <button
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors text-left"
                onClick={() => setView("wallet")}
                data-testid="button-choose-wallet"
              >
                <div className="w-9 h-9 rounded-full bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                  <Wallet className="w-4 h-4 text-purple-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-foreground">Connect Wallet</div>
                  <div className="text-xs text-muted-foreground leading-snug">Swap, predict, trade — stay anonymous</div>
                </div>
              </button>
            </div>

            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
                You can always connect a wallet later after signing in with email, or add email after connecting your wallet.
              </p>
            </div>
          </>
        )}

        {!inPhantomBrowser && view === "email" && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-md"
                  onClick={() => setView("choose")}
                  data-testid="button-back-to-choose"
                >
                  <ArrowLeft className="w-4 h-4" />
                </Button>
                <DialogTitle className="text-lg font-bold" data-testid="text-email-login-title">
                  Sign In with Google
                </DialogTitle>
              </div>
            </DialogHeader>

            <div className="flex flex-col gap-3 mt-4">
              <Button
                className="w-full h-12 justify-start gap-3 font-semibold bg-white hover:bg-gray-50 text-gray-800 border border-gray-200"
                onClick={handleEmailLogin}
                data-testid="button-sign-in-google"
              >
                <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center flex-shrink-0 border border-gray-100">
                  <SiGoogle className="w-4 h-4" />
                </div>
                <span className="text-sm">Continue with Google</span>
              </Button>
            </div>

            <div className="mt-3 pt-3 border-t border-border space-y-2">
              <p className="text-[11px] text-muted-foreground font-semibold mb-2">What you'll get:</p>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Bell className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                <span>Push & email notifications when tracked wallets move</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Target className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                <span>Community feed — post, comment, engage</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                <span>Track new launches hitting market cap targets</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Shield className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                <span>Track any wallet or token without connecting your own</span>
              </div>
            </div>
          </>
        )}

        {!inPhantomBrowser && view === "wallet" && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                {!walletOnly && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-md"
                    onClick={() => setView("choose")}
                    data-testid="button-back-to-choose-from-wallet"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                )}
                <DialogTitle className="text-lg font-bold" data-testid="text-wallet-login-title">
                  Connect Wallet
                </DialogTitle>
              </div>
              {walletOnly && (
                <p className="text-[11px] text-muted-foreground mt-1.5 leading-snug" data-testid="text-wallet-only-explainer">
                  This action runs on the Solana blockchain — it must be signed by a real wallet. Email or Google sign-in can't sign on-chain transactions, so a wallet is required here.
                </p>
              )}
            </DialogHeader>

            <div className="flex flex-col gap-2.5 mt-4">
              {wallets.map((w) => {
                const name = w.adapter.name;
                const meta = WALLET_META[name];
                if (!meta) return null;
                const isInstalled = w.readyState === WalletReadyState.Installed ||
                  w.readyState === WalletReadyState.Loadable;
                const isConnecting = connectingWallet === name;

                if (!isInstalled) {
                  return (
                    <a
                      key={name}
                      href={meta.installUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 h-12 rounded-md border border-border px-3 opacity-60 hover:opacity-80 transition-opacity"
                      data-testid={`link-install-${name.toLowerCase().replace(/\s/g, "-")}`}
                    >
                      <div className={`w-8 h-8 rounded-full ${meta.bg} flex items-center justify-center flex-shrink-0`}>
                        <span className="text-white font-bold text-xs">{meta.initial}</span>
                      </div>
                      <span className="text-sm font-semibold text-foreground flex-1">{meta.label}</span>
                      <span className="text-[10px] text-muted-foreground font-medium">Not installed</span>
                      <ExternalLink className="w-3 h-3 text-muted-foreground" />
                    </a>
                  );
                }

                return (
                  <Button
                    key={name}
                    variant="outline"
                    className="w-full h-12 justify-start gap-3 font-semibold"
                    disabled={connectingWallet !== null}
                    onClick={() => handleWalletConnect(name)}
                    data-testid={`button-connect-${name.toLowerCase().replace(/\s/g, "-")}`}
                  >
                    <div className={`w-8 h-8 rounded-full ${meta.bg} flex items-center justify-center flex-shrink-0`}>
                      {isConnecting
                        ? <Loader2 className="w-4 h-4 text-white animate-spin" />
                        : <span className="text-white font-bold text-xs">{meta.initial}</span>
                      }
                    </div>
                    <span className="text-sm">
                      {isConnecting ? "Connecting…" : meta.label}
                    </span>
                    <span className="ml-auto text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                      Detected
                    </span>
                  </Button>
                );
              })}

              <p className="text-[10px] text-center text-muted-foreground pt-1">
                Wallets marked "Not installed" will open their download page.
              </p>

              {connectError && (
                <div
                  className="mt-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                  data-testid="text-connect-error"
                >
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span className="leading-snug">{connectError}</span>
                </div>
              )}
            </div>

            <div className="mt-3 pt-3 border-t border-border space-y-2">
              <p className="text-[11px] text-muted-foreground font-semibold mb-2">What you'll get with wallet:</p>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Wallet className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
                <span>Swap tokens, predict, and trade directly</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Bell className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
                <span>Track wallets, tokens, market caps & get notified</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Shield className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
                <span>Stay fully anonymous — no email required</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Bot className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
                <span>AI agent trading — auto-execute when wallets move</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Zap className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
                <span>Set custom triggers — market cap targets, whale alerts, more</span>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
