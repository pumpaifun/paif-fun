import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Header } from "@/components/header";
import { LoginModal } from "@/components/login-modal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ACCESS_PASSES, type AccessPass } from "@shared/access-passes";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import bs58 from "bs58";
import { Check, Clock3, CreditCard, Loader2, Sparkles, WalletCards } from "lucide-react";

interface PassStatus {
  trialStartedAt: string | null;
  passExpiresAt: string | null;
  active: boolean;
  trialActive: boolean;
  paidActive: boolean;
}

interface PassResponse {
  passes: AccessPass[];
  treasury: string;
  trialDurationMs: number;
}

function remainingLabel(until: string | null): string {
  if (!until) return "";
  const ms = new Date(until).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  return days > 0 ? `${days}d ${hours}h left` : `${Math.max(1, hours)}h left`;
}

export default function UpgradePage() {
  const { publicKey, signTransaction, signMessage, connected } = useWallet();
  const { connection } = useConnection();
  const { toast } = useToast();
  const { isAuthenticated: isEmailAuth } = useAuth();
  const queryClient = useQueryClient();
  const wallet = connected ? publicKey?.toBase58() ?? null : null;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);

  const { data } = useQuery<PassResponse>({
    queryKey: ["/api/access-passes"],
    staleTime: 5 * 60_000,
  });
  const { data: walletStatus } = useQuery<PassStatus>({
    queryKey: ["/api/access-pass", wallet],
    enabled: !!wallet,
  });
  const { data: accountStatus } = useQuery<PassStatus>({
    queryKey: ["/api/access-pass-account"],
    enabled: isEmailAuth,
  });
  const status = accountStatus?.active ? accountStatus : walletStatus ?? accountStatus;
  const passes = useMemo(() => data?.passes ?? ACCESS_PASSES, [data?.passes]);
  const activeUntil = status?.paidActive ? status.passExpiresAt :
    status?.trialActive && status.trialStartedAt
      ? new Date(new Date(status.trialStartedAt).getTime() + 3 * 86_400_000).toISOString()
      : null;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cardStatus = params.get("card");
    const sessionId = params.get("session_id");
    if (cardStatus === "cancelled") {
      toast({ title: "Card checkout cancelled", description: "No charge was applied." });
      window.history.replaceState({}, "", "/upgrade");
      return;
    }
    if (cardStatus !== "success" || !sessionId) return;
    setBusyId("card-confirm");
    apiRequest("POST", "/api/access-pass/card-confirm", { sessionId })
      .then((response) => response.json())
      .then(async (result) => {
        await Promise.all([
          wallet ? queryClient.invalidateQueries({ queryKey: ["/api/access-pass", wallet] }) : Promise.resolve(),
          isEmailAuth ? queryClient.invalidateQueries({ queryKey: ["/api/access-pass-account"] }) : Promise.resolve(),
        ]);
        toast({
          title: result.alreadyApplied ? "Card payment already applied" : "Access Pass activated",
          description: wallet
            ? `${remainingLabel(result.passExpiresAt) || "Your pass is active"}`
            : isEmailAuth
              ? `${remainingLabel(result.passExpiresAt) || "Your pass is active"}`
              : "Sign in with the same account used at checkout to see your active pass.",
        });
      })
      .catch((err: any) => {
        toast({ title: "Could not verify card payment", description: err?.message ?? "Please retry.", variant: "destructive" });
      })
      .finally(() => {
        setBusyId(null);
        window.history.replaceState({}, "", "/upgrade");
      });
  }, [isEmailAuth, queryClient, toast, wallet]);

  async function startTrial() {
    setBusyId("trial");
    try {
      if (isEmailAuth) {
        await apiRequest("POST", "/api/access-pass/claim-trial-account", {});
        await queryClient.invalidateQueries({ queryKey: ["/api/access-pass-account"] });
      } else {
        if (!publicKey || !signMessage || !wallet) {
          setConnectOpen(true);
          return;
        }
        const nonce = Date.now();
        const message = new TextEncoder().encode(["paif-access-trial", "v1", wallet, String(nonce)].join("|"));
        const signature = await signMessage(message);
        await apiRequest("POST", "/api/access-pass/claim-trial", {
          ownerWallet: wallet,
          nonce,
          signature: bs58.encode(signature),
        });
        await queryClient.invalidateQueries({ queryKey: ["/api/access-pass", wallet] });
      }
      toast({ title: "Your 3-day trial is active", description: "All PAIF tools are unlocked for three days." });
    } catch (err: any) {
      toast({ title: "Could not start trial", description: err?.message ?? "Please try again.", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function handleBuy(pass: AccessPass) {
    if (!publicKey || !signTransaction || !wallet) {
      toast({ title: "Connect a wallet first", variant: "destructive" });
      return;
    }
    setBusyId(pass.id);
    try {
      const intent = await apiRequest("POST", "/api/access-pass/intent", { passId: pass.id }).then((r) => r.json());
      const tx = new Transaction().add(SystemProgram.transfer({
        fromPubkey: publicKey,
        toPubkey: new PublicKey(intent.treasury),
        lamports: Number(BigInt(intent.lamports)),
      }));
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      const signed = await signTransaction(tx);
      const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
      const result = await apiRequest("POST", "/api/access-pass/verify", {
        txSignature: signature,
        ownerWallet: wallet,
        passId: pass.id,
      }).then((r) => r.json());
      await queryClient.invalidateQueries({ queryKey: ["/api/access-pass", wallet] });
      toast({
        title: result.alreadyApplied ? "Pass already applied" : `${pass.label} activated`,
        description: `${pass.priceUsd.toFixed(2)} USD · ${remainingLabel(result.passExpiresAt) || "active"}`,
      });
    } catch (err: any) {
      toast({ title: "Could not complete purchase", description: err?.message ?? "Please try again.", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function handleCardBuy(pass: AccessPass) {
    if (!isEmailAuth && (!publicKey || !signMessage || !wallet)) {
      setConnectOpen(true);
      return;
    }
    setBusyId(`${pass.id}:card`);
    try {
      let checkoutBody: Record<string, unknown> = { passId: pass.id };
      if (!isEmailAuth && publicKey && signMessage && wallet) {
        const nonce = Date.now();
        const message = new TextEncoder().encode(["paif-access-card", "v1", wallet, pass.id, String(nonce)].join("|"));
        const signature = await signMessage(message);
        checkoutBody = {
          ...checkoutBody,
          ownerWallet: wallet,
          nonce,
          signature: bs58.encode(signature),
        };
      }
      const result = await apiRequest("POST", "/api/access-pass/card-checkout", {
        ...checkoutBody,
      }).then((response) => response.json());
      window.location.assign(result.url);
    } catch (err: any) {
      setBusyId(null);
      toast({ title: "Could not open card checkout", description: err?.message ?? "Please try again.", variant: "destructive" });
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main className="container mx-auto max-w-6xl px-4 py-10">
        <div className="mb-10 text-center">
          <h1 className="text-3xl md:text-4xl font-bold mb-3" data-testid="heading-upgrade">Access Passes</h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
             One pass unlocks all eligible PAIF website tools. Every pass has the same access — only the duration changes.
          </p>
          <p className="text-xs text-muted-foreground mt-2">Live trading stays separate and carries a 1.6% platform fee on profitable trades only.</p>
          {wallet && status?.active && (
            <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-1.5 text-sm font-semibold text-emerald-500">
              <Clock3 className="h-4 w-4" />
              {status.paidActive ? "Access Pass" : "Trial"} · {remainingLabel(activeUntil)}
            </div>
          )}
        </div>

        <Card className="mb-8 border-primary/30 bg-primary/5">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-5">
            <div>
               <h2 className="font-bold">Try the Access Pass experience free for 3 days</h2>
                <p className="text-sm text-muted-foreground">Connect your wallet to claim the one-time trial. It applies across the same eligible website tools.</p>
            </div>
              <Button onClick={() => (connected || isEmailAuth) ? startTrial() : setConnectOpen(true)} disabled={!!busyId || !!status?.trialStartedAt || !!status?.paidActive} data-testid="button-start-access-trial">
              {busyId === "trial" ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Starting…</> :
                !(connected || isEmailAuth) ? "Sign in or connect" : status?.trialStartedAt ? "Trial already used" : "Start 3-day trial"}
            </Button>
          </div>
        </Card>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {passes.map((pass) => {
            const solBusy = busyId === pass.id;
            const cardBusy = busyId === `${pass.id}:card`;
            return (
              <Card key={pass.id} className={`relative flex flex-col p-5 ${pass.badge ? "border-primary/60 ring-1 ring-primary/30" : ""}`} data-testid={`card-access-pass-${pass.id}`}>
                {pass.badge && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground">{pass.badge === "best-value" ? "Best value" : "Popular"}</span>}
                <div className="mb-3 flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  <h3 className="text-lg font-semibold">{pass.label}</h3>
                </div>
                <div className="mb-1 text-3xl font-bold" data-testid={`text-access-pass-price-${pass.id}`}>${pass.priceUsd.toFixed(2)}</div>
                <div className="text-sm text-muted-foreground mb-4">{pass.durationMs / 86_400_000} {pass.durationMs === 86_400_000 ? "day" : "days"} of full access</div>
                <ul className="text-xs text-muted-foreground space-y-2 mb-5 flex-1">
                  {["Paper trading and autonomous tools", "Saved scans and activity history", "All eligible PAIF website tools", "One-time payment — no subscription"].map((feature) => (
                    <li key={feature} className="flex items-start gap-1.5"><Check className="w-3 h-3 text-emerald-500 mt-0.5 flex-shrink-0" /><span>{feature}</span></li>
                  ))}
                </ul>
                <Button className="mt-auto w-full" onClick={() => (connected || isEmailAuth) ? handleCardBuy(pass) : setConnectOpen(true)} disabled={!!busyId} data-testid={`button-card-access-pass-${pass.id}`}>
                  {cardBusy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Opening…</> : <><CreditCard className="h-4 w-4 mr-2" />{!(connected || isEmailAuth) ? "Sign in for card" : "Pay with card"}</>}
                </Button>
                <Button variant="outline" className="mt-2 w-full" onClick={() => connected ? handleBuy(pass) : setConnectOpen(true)} disabled={!!busyId} data-testid={`button-buy-access-pass-${pass.id}`}>
                  {solBusy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processing…</> : <><WalletCards className="h-4 w-4 mr-2" />{!connected ? "Connect for SOL" : "Pay with SOL"}</>}
                </Button>
              </Card>
            );
          })}
        </div>
        <p className="text-center text-xs text-muted-foreground mt-8">
          Pay by credit/debit card in USD or by SOL at the live quote. Access windows stack when you buy before expiry.
        </p>
      </main>
        <LoginModal open={connectOpen} onOpenChange={setConnectOpen} />
    </div>
  );
}