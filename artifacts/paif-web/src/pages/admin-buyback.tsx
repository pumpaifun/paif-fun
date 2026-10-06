import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useAccount } from "wagmi";
import { sendTransaction as evmSendTransaction, waitForTransactionReceipt } from "@wagmi/core";
import { VersionedTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { AlertTriangle, ArrowRightLeft, ExternalLink, Loader2, ShieldCheck, Wallet, CheckCircle2 } from "lucide-react";
import { BUYBACK_AUTO_SWEEP_THRESHOLD_LAMPORTS } from "@shared/credit-packs";
import { wagmiConfig } from "@/lib/evm-provider";
import { CHAINS, type ChainId } from "@/lib/chains";

interface PendingResponse {
  rows: Array<{ id: string; lamportsAllocated: string; createdAt: string }>;
  totalLamports: string;
  treasury: string;
  paifMint: string | null;
}

interface BuildSwapResponse {
  serializedTx?: string;
  evmTx?: { to: string; data: string; value: string };
  nonce: string;
  quote: {
    inAmountLamports: string;
    outAmountPaifRaw: string;
    priceImpactPct: string;
    slippageBps: number;
  };
}

// Native-unit divisor differs per chain: Solana lamports = 1e9, BNB wei = 1e18.
function toNative(s: string, chain: ChainId): number {
  try {
    const raw = BigInt(s || "0");
    const div = chain === "bnb" ? 1_000_000_000_000_000_000n : 1_000_000_000n;
    return Number(raw / div) + Number(raw % div) / Number(div);
  } catch { return 0; }
}
function fmtNative(s: string, chain: ChainId = "solana"): string {
  const sym = CHAINS[chain].nativeSymbol;
  const v = toNative(s, chain);
  if (v === 0) return `0 ${sym}`;
  if (v < 0.001) return `${v.toFixed(6)} ${sym}`;
  if (v < 1) return `${v.toFixed(4)} ${sym}`;
  return `${v.toFixed(3)} ${sym}`;
}

export default function AdminBuybackPage() {
  const { publicKey, signTransaction, sendTransaction, connected } = useWallet();
  const { connection } = useConnection();
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [chain, setChain] = useState<ChainId>("solana");
  const isBnb = chain === "bnb";
  const cfg = CHAINS[chain];
  const walletConnected = isBnb ? evmConnected : connected;
  const wallet = isBnb
    ? (evmConnected ? evmAddress ?? null : null)
    : (connected ? publicKey?.toBase58() ?? null : null);
  const addrEq = (a: string | null, b: string | null) =>
    !!a && !!b && (isBnb ? a.toLowerCase() === b.toLowerCase() : a === b);

  // UI shows slippage as a percentage (e.g. 1 = 1%). Internally Jupiter wants
  // basis points (100 bps = 1%), so we convert at submit time.
  const [slippagePct, setSlippagePct] = useState<number>(1);
  const slippageBps = Math.max(10, Math.min(1000, Math.round(slippagePct * 100)));
  const [busy, setBusy] = useState<"idle" | "building" | "signing" | "confirming" | "marking">("idle");
  const [manualSig, setManualSig] = useState<string>("");
  const [recording, setRecording] = useState<boolean>(false);

  useEffect(() => {
    document.title = "Admin · Execute Buyback — PAIF.fun";
  }, []);

  const { data, isLoading, isError } = useQuery<PendingResponse>({
    queryKey: ["/api/buyback/admin/pending", chain],
    queryFn: async () => {
      const r = await fetch(`/api/buyback/admin/pending?chain=${chain}`, { credentials: "include" });
      if (!r.ok) throw new Error("pending fetch failed");
      return r.json();
    },
    refetchInterval: 10_000,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
  });

  const isTreasury = addrEq(wallet, data?.treasury ?? null);
  const totalSol   = useMemo(() => toNative(data?.totalLamports ?? "0", chain), [data?.totalLamports, chain]);
  const rowIds     = useMemo(() => data?.rows.map(r => r.id) ?? [], [data?.rows]);
  const canExecute = isTreasury && rowIds.length > 0 && !!data?.paifMint && busy === "idle";
  const sweepReady = (() => {
    try { return BigInt(data?.totalLamports ?? "0") >= BUYBACK_AUTO_SWEEP_THRESHOLD_LAMPORTS; }
    catch { return false; }
  })();

  async function handleExecute() {
    if (isBnb) { await handleExecuteBnb(); return; }
    if (!publicKey || !sendTransaction || !signTransaction) {
      toast({ title: "Wallet not ready", variant: "destructive" });
      return;
    }
    if (!isTreasury || rowIds.length === 0) return;
    try {
      // 1. Server builds the SOL→PAIF Jupiter swap tx for the treasury.
      setBusy("building");
      const build = (await apiRequest("POST", "/api/buyback/admin/build-swap", {
        rowIds, slippageBps, chain,
      }).then(r => r.json())) as BuildSwapResponse;

      // 2. Deserialize, sign with treasury wallet, send to network.
      const tx = VersionedTransaction.deserialize(
        Uint8Array.from(atob(build.serializedTx!), c => c.charCodeAt(0)),
      );
      setBusy("signing");
      const sig = await sendTransaction(tx, connection, { skipPreflight: false, maxRetries: 3 });

      toast({ title: "Swap submitted", description: `Confirming ${sig.slice(0, 8)}…` });

      // 3. Confirm against the blockhash *baked into the tx* (not a fresh
      //    one — using a fresh blockhash for confirm is a classic footgun
      //    that produces false-negative timeouts when the network is slow).
      setBusy("confirming");
      const txBlockhash = tx.message.recentBlockhash;
      const { lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      await connection.confirmTransaction(
        { signature: sig, blockhash: txBlockhash, lastValidBlockHeight },
        "confirmed",
      );

      // 4. Server verifies on-chain (signer == treasury, memo nonce matches,
      //    PAIF received, SOL spent ≥ 98% of intent) and atomically marks
      //    rows executed.
      setBusy("marking");
      const result = await apiRequest("POST", "/api/buyback/admin/execute", {
        signature: sig,
        nonce: build.nonce,
      }).then(r => r.json());

      const paifUi = Number(BigInt(result.paifReceivedRaw)) / 1; // raw amount
      toast({
        title: `Buyback executed · ${result.marked} rows`,
        description: `Received ${paifUi.toLocaleString()} $PAIF (raw units)`,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/buyback/admin/pending"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/buyback/stats"] }),
      ]);
    } catch (err: any) {
      const raw = err?.message || "Unknown error";
      // Stale cache: page is showing rows that have already been settled or
      // wiped. Force a fresh pull so the user sees the real pending state.
      const isStale = /not found|not pending|Unknown nonce/i.test(raw);
      if (isStale) {
        await queryClient.invalidateQueries({ queryKey: ["/api/buyback/admin/pending"] });
      }
      toast({
        title: "Buyback failed",
        description: isStale
          ? "The pending list was out of date — refreshed. Check the new totals and retry if needed."
          : raw,
        variant: "destructive",
      });
    } finally {
      setBusy("idle");
    }
  }

  // BNB twin: server builds a PancakeSwap V2 swap tx (BNB→PAIF) with a nonce
  // hex-suffixed onto the calldata; wagmi sends + waits; server verifies.
  async function handleExecuteBnb() {
    if (!evmAddress) {
      toast({ title: "Wallet not ready", variant: "destructive" });
      return;
    }
    if (!isTreasury || rowIds.length === 0) return;
    try {
      setBusy("building");
      const build = (await apiRequest("POST", "/api/buyback/admin/build-swap", {
        rowIds, slippageBps, chain,
      }).then(r => r.json())) as BuildSwapResponse;

      if (!build.evmTx) throw new Error("Server did not return an EVM transaction");

      setBusy("signing");
      const hash = await evmSendTransaction(wagmiConfig, {
        to: build.evmTx.to as `0x${string}`,
        data: build.evmTx.data as `0x${string}`,
        value: BigInt(build.evmTx.value),
      });

      toast({ title: "Swap submitted", description: `Confirming ${hash.slice(0, 10)}…` });

      setBusy("confirming");
      const receipt = await waitForTransactionReceipt(wagmiConfig, { hash });
      if (receipt.status !== "success") throw new Error(`Swap reverted on-chain — ${hash.slice(0, 10)}…`);

      setBusy("marking");
      const result = await apiRequest("POST", "/api/buyback/admin/execute", {
        signature: hash,
        nonce: build.nonce,
      }).then(r => r.json());

      toast({
        title: `Buyback executed · ${result.marked} rows`,
        description: `Received ${Number(result.paifReceivedRaw).toLocaleString()} $PAIF (raw units)`,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/buyback/admin/pending"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/buyback/stats"] }),
      ]);
    } catch (err: any) {
      toast({
        title: "Buyback failed",
        description: err?.shortMessage || err?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy("idle");
    }
  }

  // Record an off-platform buyback (operator did the swap manually from the
  // treasury wallet). Server fetches the tx, validates it produced PAIF for
  // the treasury, and inserts an "executed" ledger row.
  async function handleRecordManual() {
    const sig = manualSig.trim();
    if (!sig) {
      toast({ title: "Paste a transaction signature first", variant: "destructive" });
      return;
    }
    try {
      setRecording(true);
      const result = await apiRequest("POST", "/api/buyback/admin/record-manual", {
        signature: sig, chain,
      }).then(r => r.json());
      toast({
        title: "Manual buyback recorded",
        description: `Row ${result.id.slice(0, 8)}… · spent ${fmtNative(result.solSpentLamports, chain)}`,
      });
      setManualSig("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/buyback/admin/pending"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/buyback/stats"] }),
      ]);
    } catch (err: any) {
      toast({
        title: "Couldn't record buyback",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setRecording(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-10 max-w-4xl">
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
            <h1 className="text-2xl md:text-3xl font-bold" data-testid="heading-admin-buyback">
              Execute community buyback
            </h1>
          </div>
          <p className="text-muted-foreground text-sm md:text-base">
            One-click flow: connect with the treasury wallet, sign a single swap,
            and the matching pending ledger rows are marked executed automatically.
          </p>
        </div>

        {/* Chain selector */}
        <div className="flex gap-2 mb-6" data-testid="chain-toggle">
          {(["solana", "bnb"] as ChainId[]).map((c) => (
            <Button
              key={c}
              type="button"
              variant={chain === c ? "default" : "outline"}
              className={chain === c ? "bg-black text-white hover:bg-neutral-900" : ""}
              onClick={() => setChain(c)}
              data-testid={`button-chain-${c}`}
            >
              {CHAINS[c].name}
            </Button>
          ))}
        </div>

        {/* Eligibility / wallet status */}
        <Card className="mb-6" data-testid="card-eligibility">
          <CardContent className="p-5 space-y-3 text-sm">
            <Row label="Connected wallet" value={wallet ?? "— not connected —"} />
            <Row label="Treasury wallet" value={data?.treasury ?? "—"} />
            <Row
              label={isBnb ? "$PAIF contract" : "$PAIF mint"}
              value={data?.paifMint ?? `Not configured (set ${isBnb ? "PAIF_BNB_TOKEN_MINT" : "PAIF_TOKEN_MINT"} secret)`}
              tone={data?.paifMint ? "ok" : "warn"}
            />
            <Row label="Pending rows"   value={`${data?.rows.length ?? 0}`} />
            <Row label="Pending total"  value={fmtNative(data?.totalLamports ?? "0", chain)} tone="emerald" />
            <Row
              label="Auto-sweep threshold"
              value={`${fmtNative(BUYBACK_AUTO_SWEEP_THRESHOLD_LAMPORTS.toString(), chain)} pending`}
            />
            {sweepReady ? (
              <div
                className="flex items-start gap-2 rounded-md border border-emerald-400/50 bg-emerald-500/15 p-3 text-emerald-200 ring-1 ring-emerald-400/30"
                data-testid="banner-sweep-ready"
              >
                <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>
                  <strong>Threshold reached.</strong> Pool is ready for an auto-sweep buyback. Connect the
                  treasury wallet and click Execute.
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground" data-testid="text-sweep-progress">
                Pool fills as users buy credit packs. You'll see a green "Threshold reached" banner here
                once pending crosses {fmtNative(BUYBACK_AUTO_SWEEP_THRESHOLD_LAMPORTS.toString(), chain)}.
              </div>
            )}
            {!isTreasury && wallet && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200" data-testid="warn-wrong-wallet">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>
                  This wallet is not the treasury. Disconnect and reconnect with the treasury
                  wallet to perform a buyback.
                </div>
              </div>
            )}
            {!data?.paifMint && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200" data-testid="warn-no-mint">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>
                  Set the <code className="font-mono">{isBnb ? "PAIF_BNB_TOKEN_MINT" : "PAIF_TOKEN_MINT"}</code> secret on the server
                  before you can execute any swaps.
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Action panel */}
        <Card data-testid="card-action">
          <CardHeader>
            <CardTitle className="text-lg">Swap settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <label className="text-sm text-muted-foreground w-32">Slippage</label>
              <div className="relative w-32">
                <Input
                  type="number"
                  min={0.1} max={10} step={0.1}
                  value={slippagePct}
                  onChange={e => {
                    const v = Number(e.target.value);
                    setSlippagePct(Number.isFinite(v) ? Math.max(0.1, Math.min(10, v)) : 1);
                  }}
                  className="pr-8"
                  data-testid="input-slippage"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
              </div>
              <span className="text-xs text-muted-foreground">
                Default 1% — protects against price moves while you sign. ({slippageBps} bps)
              </span>
            </div>

            <Button
              size="lg"
              className="w-full"
              disabled={!canExecute}
              onClick={handleExecute}
              data-testid="button-execute-buyback"
            >
              {busy === "building" ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Building swap…</>)
              : busy === "signing"   ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sign in wallet…</>)
              : busy === "confirming"? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Confirming on-chain…</>)
              : busy === "marking"   ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Marking executed…</>)
              : !walletConnected     ? (<><Wallet className="h-4 w-4 mr-2" /> Connect treasury wallet</>)
              : !isTreasury          ? "Connect with the treasury wallet"
              : !data?.paifMint      ? `Configure ${isBnb ? "PAIF_BNB_TOKEN_MINT" : "PAIF_TOKEN_MINT"} first`
              : rowIds.length === 0  ? "Nothing pending to execute"
              : (<><ArrowRightLeft className="h-4 w-4 mr-2" /> Swap {fmtNative(data?.totalLamports ?? "0", chain)} → $PAIF & mark {rowIds.length} row{rowIds.length === 1 ? "" : "s"} executed</>)}
            </Button>
            <p className="text-xs text-muted-foreground">
              Single wallet prompt. The server verifies the on-chain swap, confirms it
              spent at least 98% of the pending {cfg.nativeSymbol}, and only then flips the rows from
              <em> pending</em> to <em>executed</em>.
            </p>
          </CardContent>
        </Card>

        {/* Pending row preview */}
        <Card className="mt-6" data-testid="card-pending-list">
          <CardHeader>
            <CardTitle className="text-lg">Pending rows ({data?.rows.length ?? 0})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-3">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : isError ? (
              <div className="p-6 text-sm text-destructive">Couldn't load pending rows.</div>
            ) : !data || data.rows.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Nothing pending — every recorded allocation has been executed. 🎉
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground border-b border-border">
                    <tr>
                      <th className="text-left font-medium px-4 py-2">When</th>
                      <th className="text-left font-medium px-4 py-2">Row ID</th>
                      <th className="text-right font-medium px-4 py-2">Allocated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map(r => (
                      <tr key={r.id} className="border-b border-border/40 last:border-0" data-testid={`row-pending-${r.id}`}>
                        <td className="px-4 py-2 text-muted-foreground">
                          {new Date(r.createdAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{r.id.slice(0, 8)}…</td>
                        <td className="px-4 py-2 text-right tabular-nums text-emerald-400">
                          {fmtNative(r.lamportsAllocated, chain)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Record an off-platform / manual buyback */}
        <Card className="mt-6" data-testid="card-record-manual">
          <CardHeader>
            <CardTitle className="text-lg">Record a manual buyback</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Did you buy $PAIF directly from the treasury wallet (e.g. {isBnb ? "PancakeSwap, OTC" : "Jupiter, Phantom swap, OTC"})?
              Paste the {isBnb ? "transaction hash" : "transaction signature"} here so it shows up in the public ledger as an
              executed buyback. The server will fetch the tx, confirm it was signed by the treasury
              and produced $PAIF, then add it as an "Executed (manual)" row.
            </p>
            <Input
              type="text"
              placeholder={isBnb ? "BNB transaction hash (e.g. 0x…)" : "Solana transaction signature (e.g. 5Kj…)"}
              value={manualSig}
              onChange={e => setManualSig(e.target.value)}
              className="font-mono text-xs"
              data-testid="input-manual-signature"
              spellCheck={false}
            />
            <Button
              onClick={handleRecordManual}
              disabled={recording || !manualSig.trim()}
              variant="outline"
              data-testid="button-record-manual"
            >
              {recording
                ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Verifying on-chain…</>)
                : "Record manual buyback"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Requires: tx signed by treasury, treasury's $PAIF balance increased, signature not already recorded.
              Wallet connection is not required for this step — verification is purely on-chain.
            </p>
          </CardContent>
        </Card>

        {data?.treasury && (
          <p className="mt-6 text-center text-xs text-muted-foreground">
            <a
              href={cfg.explorerAddressUrl(data.treasury)}
              target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground"
              data-testid="link-treasury-solscan"
            >
              View treasury on {cfg.explorerName} <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        )}
      </main>
      <Footer />
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "emerald" }) {
  const cls =
    tone === "ok"      ? "text-emerald-400" :
    tone === "warn"    ? "text-amber-400"   :
    tone === "emerald" ? "text-emerald-400 font-semibold tabular-nums" :
    "text-foreground";
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono text-xs sm:text-sm break-all text-right ${cls}`}>{value}</span>
    </div>
  );
}
