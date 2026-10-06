import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { Activity, Bot, BrainCircuit, ExternalLink, Loader2, LockKeyhole, RefreshCw, Send, ShieldCheck, WalletCards } from "lucide-react";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface AlphaStatus {
  id: string;
  name: string;
  status: string;
  model: string;
  walletAddress: string;
  isPublic: boolean;
  skills: Array<{ slug: string; description: string; transactionCapable: boolean }>;
  operatingMode: string;
  reviewEngine: string;
  clawTurnsEnabled: boolean;
  transferTurnsEnabled: boolean;
  transferAuthority: string;
  safeguards: string[];
  checkedAt: string;
}

const oversightAreas = [
  ["Market intelligence", "Review market momentum, liquidity, wallet activity, and token risk evidence."],
  ["PAIF bots", "Compare Paper and Live behavior while keeping Swing, Sniper, and Arcade execution isolated."],
  ["Platform health", "Watch data providers, schedulers, payments, and release checks for degraded behavior."],
  ["Decision support", "Explain evidence, confidence, and risk before recommending an action."],
];

export default function PaifAlphaPage() {
  const { publicKey, connected, signMessage } = useWallet();
  const { toast } = useToast();
  const [asset, setAsset] = useState<"SOL" | "USDC">("SOL");
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const query = useQuery<AlphaStatus>({
    queryKey: ["/api/paif-alpha/status"],
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
  const alpha = query.data;
  const isRunning = alpha?.status === "running";
  const wallet = connected ? publicKey?.toBase58() ?? null : null;
  const isTransferAuthority = !!wallet && wallet === alpha?.transferAuthority;
  const transfer = useMutation({
    mutationFn: async () => {
      if (!alpha?.transferAuthority || !signMessage) throw new Error("Connect the PAIF treasury wallet first.");
      const cleanAmount = amount.trim();
      const cleanDestination = destination.trim();
      if (confirmation !== "TRANSFER") throw new Error('Type "TRANSFER" to confirm.');
      const nonce = Date.now();
      const message = [
        "paif-claw-transfer",
        "v1",
        asset,
        cleanAmount,
        cleanDestination,
        alpha.transferAuthority,
        String(nonce),
      ].join("|");
      const signature = bs58.encode(await signMessage(new TextEncoder().encode(message)));
      const response = await apiRequest("POST", "/api/paif-alpha/private-transfer", {
        asset,
        amount: cleanAmount,
        destination: cleanDestination,
        nonce,
        signature,
      });
      return response.json() as Promise<{ content: string }>;
    },
    onSuccess: (result) => {
      setConfirmation("");
      toast({ title: "Claw Pump responded", description: result.content });
    },
    onError: (error: Error) => {
      toast({ title: "Private transfer not confirmed", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <section className="overflow-hidden rounded-3xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 via-background to-cyan-500/5 p-6 sm:p-9">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div className="max-w-3xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-500">
                <BrainCircuit className="h-4 w-4" /> PAIF supervisory intelligence
              </div>
              <h1 className="text-4xl font-black tracking-tight sm:text-5xl">Alpha PAIF</h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
                A second intelligence layer for PAIF that monitors evidence, challenges weak signals, and recommends safer decisions without silently taking control of funds.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>
                <RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
                Refresh status
              </Button>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-3">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <Bot className="h-5 w-5 text-emerald-500" />
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${isRunning ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500"}`}>
                {query.isLoading ? "Checking…" : alpha?.status ?? "Unavailable"}
              </span>
            </div>
            <p className="mt-4 text-xl font-bold">{alpha?.name ?? "PAIF Alpha"}</p>
            <p className="mt-1 text-sm text-muted-foreground">{alpha?.operatingMode ?? "Status unavailable"}</p>
          </Card>
          <Card className="p-5">
            <WalletCards className="h-5 w-5 text-cyan-500" />
            <p className="mt-4 text-sm font-semibold">Agent wallet</p>
            <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{alpha?.walletAddress ?? "Unavailable"}</p>
          </Card>
          <Card className="p-5">
            <Activity className="h-5 w-5 text-violet-500" />
            <p className="mt-4 text-sm font-semibold">Claw Pump connection</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {alpha ? alpha.reviewEngine : query.error ? "Connection unavailable" : "Checking connection…"}
            </p>
          </Card>
        </section>

        {query.error && (
          <Card className="mt-6 border-destructive/40 bg-destructive/5 p-5 text-sm text-destructive">
            Alpha PAIF could not reach Claw Pump. No automated action was attempted.
          </Card>
        )}

        <section className="mt-8 grid gap-6 lg:grid-cols-[1.15fr_.85fr]">
          <Card className="p-6">
            <h2 className="flex items-center gap-2 text-xl font-bold"><BrainCircuit className="h-5 w-5 text-emerald-500" /> Oversight mission</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {oversightAreas.map(([title, description]) => (
                <div key={title} className="rounded-xl border bg-muted/20 p-4">
                  <h3 className="font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-6">
            <h2 className="flex items-center gap-2 text-xl font-bold"><ShieldCheck className="h-5 w-5 text-emerald-500" /> Safety boundary</h2>
            <div className="mt-5 space-y-3">
              {(alpha?.safeguards ?? ["Loading safeguards…"]).map((item) => (
                <div key={item} className="flex gap-3 rounded-xl border border-emerald-500/15 bg-emerald-500/5 p-3 text-sm">
                  <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </Card>
        </section>

        <Card className="mt-8 p-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-xl font-bold">Connected capabilities</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Alpha uses these capabilities to support its reviews. It cannot place trades, move user funds, or change PAIF bot settings.
              </p>
            </div>
            <a href="https://clawpump.tech/dashboard" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-500 hover:underline">
              Open Claw Pump <ExternalLink className="h-4 w-4" />
            </a>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(alpha?.skills ?? []).map((skill) => (
              <div key={skill.slug} className="rounded-xl border p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-mono text-sm font-bold">{skill.slug}</p>
                  {skill.transactionCapable && <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-500">Claw only</span>}
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{skill.description}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="mt-8 border-amber-500/25 p-6" data-testid="claw-private-transfer">
          <div className="flex items-start gap-3">
            <Send className="mt-1 h-5 w-5 shrink-0 text-amber-500" />
            <div>
              <h2 className="text-xl font-bold">Claw Pump private transfer</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                Explicitly send SOL or USDC already held by the Claw Pump agent. This never runs from an Alpha review and does not replace PAIF bot recovery. Bot tokens and worker-wallet funds still return directly to their recorded owner wallet.
              </p>
            </div>
          </div>
          {!alpha?.transferTurnsEnabled ? (
            <p className="mt-5 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm">
              The connected agent does not currently report the private-transfer capability.
            </p>
          ) : !isTransferAuthority ? (
            <p className="mt-5 rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
              Connect the PAIF treasury wallet to use this owner-only action.
            </p>
          ) : (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="claw-transfer-asset">Asset</Label>
                <div className="mt-2 flex gap-2">
                  {(["SOL", "USDC"] as const).map((value) => (
                    <Button key={value} type="button" variant={asset === value ? "default" : "outline"} onClick={() => setAsset(value)}>
                      {value}
                    </Button>
                  ))}
                </div>
              </div>
              <div>
                <Label htmlFor="claw-transfer-amount">Amount</Label>
                <Input id="claw-transfer-amount" className="mt-2" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={asset === "SOL" ? "0.10" : "25.00"} />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="claw-transfer-destination">Whitelisted Solana destination</Label>
                <Input id="claw-transfer-destination" className="mt-2 font-mono text-xs" value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="Solana wallet address" />
              </div>
              <div className="md:col-span-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                <p className="text-sm font-semibold">Final confirmation</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Claw Pump requires the destination to be whitelisted. The agent turn is non-idempotent: if it times out, check Claw Pump and Solscan before considering another transfer.
                </p>
                <Input className="mt-3 max-w-xs" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder='Type "TRANSFER"' />
                <Button className="mt-3" disabled={transfer.isPending || confirmation !== "TRANSFER" || !amount.trim() || !destination.trim()} onClick={() => transfer.mutate()}>
                  {transfer.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                  Sign and send with Claw Pump
                </Button>
              </div>
            </div>
          )}
        </Card>
      </main>
      <Footer />
    </div>
  );
}