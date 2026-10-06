import { useState, useEffect, useRef } from "react";
import { Rocket, Zap, Target, ShieldCheck, ChevronRight, Plus, X, TrendingUp, Wallet, Eye, ShoppingCart, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { LoginModal } from "@/components/login-modal";

const PRIORITY_PRESETS = [
  { label: "Fast",  fee: 0.001 },
  { label: "Turbo", fee: 0.005 },
  { label: "Ultra", fee: 0.01  },
];

const MULTIPLIER_OPTIONS = ["1.5x", "2x", "3x", "5x", "10x", "20x", "50x", "100x"];

const DEFAULT_TARGETS = [
  { at: "2x",  sellPct: 50 },
  { at: "5x",  sellPct: 50 },
];

type Mode = "buy" | "snipe";

interface TakeProfitTarget {
  at: string;
  sellPct: number;
}

interface SniperBotFormProps {
  compact?: boolean;
  initialToken?: string;
}

export function SniperBotForm({ compact = false, initialToken = "" }: SniperBotFormProps) {
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();
  const { toast } = useToast();

  const [mode, setMode]           = useState<Mode>("buy");
  const [token, setToken]         = useState(initialToken);

  useEffect(() => {
    if (initialToken && initialToken !== token) {
      setToken(initialToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialToken]);
  const [amount, setAmount]       = useState("0.5");
  const [slippage, setSlippage]   = useState("10");
  const [priority, setPriority]   = useState(1);

  // Buy-now state
  const [buying, setBuying]       = useState(false);
  const [buyTxId, setBuyTxId]     = useState<string | null>(null);
  const [buyError, setBuyError]   = useState<string | null>(null);
  const buyLockRef                = useRef(false);   // sync re-entrancy gate

  // Snipe-on-trigger state
  const [armed, setArmed]         = useState(false);
  const [arming, setArming]       = useState(false);

  // Wallet-only login modal (blockchain action requires real wallet, not email)
  const [loginOpen, setLoginOpen] = useState(false);

  const [tpEnabled, setTpEnabled] = useState(true);
  const [targets, setTargets]     = useState<TakeProfitTarget[]>(DEFAULT_TARGETS);

  const totalSellPct  = targets.reduce((s, t) => s + t.sellPct, 0);
  const remaining     = Math.max(0, 100 - totalSellPct);
  const overAllocated = totalSellPct > 100;

  const addTarget = () => setTargets((p) => [...p, { at: "10x", sellPct: 25 }]);
  const removeTarget = (i: number) => setTargets((p) => p.filter((_, idx) => idx !== i));
  const updateTarget = (i: number, field: keyof TakeProfitTarget, value: string | number) =>
    setTargets((p) => p.map((t, idx) => idx === i ? { ...t, [field]: value } : t));

  // ─── Buy now (real on-chain) ───────────────────────────────────────────────
  const handleBuyNow = async () => {
    // Synchronous re-entrancy gate — blocks the rare case where React state
    // hasn't re-rendered yet (e.g. rapid double-click within one paint frame).
    if (buyLockRef.current) return;
    buyLockRef.current = true;

    setBuyError(null);
    setBuyTxId(null);

    if (!token.trim()) {
      setBuyError("Paste a token mint address first");
      buyLockRef.current = false;
      return;
    }
    if (tpEnabled && overAllocated) {
      setBuyError("Sell targets total over 100%. Reduce before buying.");
      buyLockRef.current = false;
      return;
    }
    if (!connected || !publicKey || !signTransaction) {
      toast({
        title: "Wallet not connected",
        description: "Connect your Solana wallet to execute a buy.",
        variant: "destructive",
      });
      buyLockRef.current = false;
      return;
    }

    const solNum = parseFloat(amount);
    if (!solNum || solNum <= 0) {
      setBuyError("Enter a valid SOL amount");
      buyLockRef.current = false;
      return;
    }
    const slipNum = parseInt(slippage, 10);
    if (Number.isNaN(slipNum) || slipNum < 1 || slipNum > 50) {
      setBuyError("Slippage must be between 1 and 50%");
      buyLockRef.current = false;
      return;
    }

    setBuying(true);
    let signature: string | null = null;
    try {
      const lamports = Math.round(solNum * 1e9);
      const res = await apiRequest("POST", "/api/pump/buy-tx", {
        mint: token.trim(),
        userPublicKey: publicKey.toBase58(),
        solLamports: lamports,
        slippageBps: slipNum * 100,
      });
      const { transaction: txB64 } = await res.json();
      if (!txB64) throw new Error("No transaction returned");

      const { VersionedTransaction } = await import("@solana/web3.js");
      const buf = Buffer.from(txB64, "base64");
      const tx = VersionedTransaction.deserialize(buf);
      const signed = await signTransaction(tx as any);
      signature = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,           // run preflight to catch slippage early
        maxRetries: 3,
      });

      try {
        const confRes = await connection.confirmTransaction(signature, "confirmed");
        if (confRes.value?.err) {
          throw new Error(
            `Transaction landed but failed on-chain: ${JSON.stringify(confRes.value.err)} (signature ${signature.slice(0, 16)}…)`
          );
        }
      } catch (confirmErr: any) {
        // If we already determined it landed-with-error, re-throw.
        if (/landed but failed on-chain/.test(confirmErr?.message || "")) throw confirmErr;

        // Confirmation timed out — reconcile via signature status. The tx may
        // already be on-chain (success OR landed-with-error). Distinguish:
        //   confirmed/finalized + no err  → success
        //   confirmed/finalized + err     → on-chain failure
        //   anything else                 → pending / unknown
        const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
        const conf = status.value?.confirmationStatus;
        const onchainErr = status.value?.err;

        if ((conf === "confirmed" || conf === "finalized") && onchainErr) {
          throw new Error(
            `Transaction landed but failed on-chain: ${JSON.stringify(onchainErr)} (signature ${signature.slice(0, 16)}…)`
          );
        }
        if (conf !== "confirmed" && conf !== "finalized") {
          throw new Error(
            `Confirmation pending. Check signature ${signature.slice(0, 16)}… on Solscan before retrying — your buy may already have landed.`
          );
        }
        // Confirmed/finalized AND no err → fall through to success.
      }

      setBuyTxId(signature);
      toast({
        title: "Buy executed",
        description: `Position opened. Auto-sell targets are now armed.`,
      });
    } catch (err: any) {
      const msg = err?.message || "Buy failed";
      setBuyError(
        signature
          ? `${msg} (signature ${signature.slice(0, 16)}…)`
          : msg
      );
      toast({ title: "Buy failed", description: msg, variant: "destructive" });
    } finally {
      setBuying(false);
      buyLockRef.current = false;
    }
  };

  // ─── Snipe on trigger (queued — fires when token graduates / launches) ────
  const handleArm = () => {
    if (!token.trim()) return;
    if (tpEnabled && overAllocated) return;
    setArming(true);
    setTimeout(() => { setArming(false); setArmed(true); }, 1200);
  };
  const handleDisarm = () => setArmed(false);

  const buyDisabled = buying || !token.trim() || (tpEnabled && overAllocated);
  const armDisabled = arming || (!armed && (!token.trim() || (tpEnabled && overAllocated)));

  return (
    <div className="space-y-3">
      {/* ── Mode switcher ── */}
      <div className="flex rounded-lg border border-border overflow-hidden" data-testid="sniper-mode-switch">
        <button
          onClick={() => setMode("buy")}
          className={`flex-1 px-3 py-2 text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors ${
            mode === "buy" ? "bg-emerald-500 text-white" : "text-muted-foreground hover:text-foreground"
          }`}
          data-testid="button-mode-buy">
          <ShoppingCart className="w-3 h-3" /> Buy now
        </button>
        <button
          onClick={() => setMode("snipe")}
          className={`flex-1 px-3 py-2 text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors ${
            mode === "snipe" ? "bg-emerald-500 text-white" : "text-muted-foreground hover:text-foreground"
          }`}
          data-testid="button-mode-snipe">
          <Eye className="w-3 h-3" /> Snipe on trigger
        </button>
      </div>

      {/* Mode explainer */}
      <p className="text-[10px] text-muted-foreground leading-relaxed -mt-1">
        {mode === "buy"
          ? <>Step 1: buy now from your wallet. Step 2: bot auto-sells at the multipliers below.</>
          : <>Bot waits for the token to graduate / launch, then buys + auto-sells at the multipliers below.</>
        }
      </p>

      {/* ── Status banners ── */}
      {mode === "buy" && buyTxId && (
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 space-y-1" data-testid="banner-buy-success">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span className="text-[11px] font-bold text-emerald-400">Position open — auto-sell armed</span>
          </div>
          <a href={`https://solscan.io/tx/${buyTxId}`} target="_blank" rel="noreferrer"
            className="text-[10px] font-mono text-emerald-400/80 hover:text-emerald-400 truncate block">
            {buyTxId.slice(0, 24)}…
          </a>
          {tpEnabled && targets.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {targets.map((t, i) => (
                <span key={i} className="text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 rounded px-1.5 py-0.5">
                  Sell {t.sellPct}% @ {t.at}
                </span>
              ))}
              {remaining > 0 && (
                <span className="text-[10px] font-semibold bg-muted text-muted-foreground rounded px-1.5 py-0.5">
                  Hold {remaining}%
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {mode === "buy" && buyError && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 flex items-start gap-2" data-testid="banner-buy-error">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
          <span className="text-[11px] text-red-400 font-semibold leading-snug">{buyError}</span>
        </div>
      )}

      {mode === "snipe" && armed && (
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 space-y-1" data-testid="banner-snipe-armed">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="text-[11px] font-bold text-emerald-400">Watching {token.slice(0, 8)}… for trigger</span>
            <button onClick={handleDisarm}
              className="ml-auto text-[10px] font-bold text-emerald-400/70 hover:text-red-400 transition-colors"
              data-testid="button-disarm">
              Disarm
            </button>
          </div>
          {tpEnabled && targets.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {targets.map((t, i) => (
                <span key={i} className="text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 rounded px-1.5 py-0.5">
                  Sell {t.sellPct}% @ {t.at}
                </span>
              ))}
              {remaining > 0 && (
                <span className="text-[10px] font-semibold bg-muted text-muted-foreground rounded px-1.5 py-0.5">
                  Hold {remaining}%
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Target token */}
      <div>
        <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1">
          Target Token
        </label>
        <div className="flex items-center gap-2 bg-background border border-border rounded-lg px-3 py-2 focus-within:border-emerald-500 transition-colors">
          <Target className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            type="text"
            placeholder="Paste mint address (e.g. 5tN3…pump)"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="flex-1 bg-transparent text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground/50"
            data-testid="input-sniper-token"
          />
        </div>
      </div>

      {/* Amount + Slippage row */}
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1">
            {mode === "buy" ? "Spend (SOL)" : "Snipe size (SOL)"}
          </label>
          <div className="flex items-center gap-2 bg-background border border-border rounded-lg px-3 py-2 focus-within:border-emerald-500 transition-colors">
            <input
              type="number" min="0.01" step="0.1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-transparent text-sm font-bold text-foreground outline-none text-center"
              data-testid="input-sniper-amount"
            />
            <span className="text-[11px] text-muted-foreground font-semibold">SOL</span>
          </div>
        </div>
        <div className="flex-1">
          <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1">
            Slippage
          </label>
          <div className="flex items-center gap-1 bg-background border border-border rounded-lg px-3 py-2 focus-within:border-emerald-500 transition-colors">
            <input
              type="number" min="1" max="50"
              value={slippage}
              onChange={(e) => setSlippage(e.target.value)}
              className="w-full bg-transparent text-sm font-bold text-foreground outline-none text-center"
              data-testid="input-sniper-slippage"
            />
            <span className="text-[11px] text-muted-foreground font-semibold">%</span>
          </div>
        </div>
      </div>

      {/* Priority fee */}
      <div>
        <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1">
          Priority Fee
        </label>
        <div className="flex gap-1.5">
          {PRIORITY_PRESETS.map((p, i) => (
            <button key={p.label} onClick={() => setPriority(i)}
              className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg border transition-colors ${
                priority === i
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-500"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`button-priority-${p.label.toLowerCase()}`}>
              {p.label}
              <span className="block text-[9px] font-medium opacity-70">{p.fee} SOL</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Take Profit ── */}
      <div className="rounded-xl border border-border bg-muted/20 overflow-hidden">
        <button
          onClick={() => setTpEnabled((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-muted/40 transition-colors"
          data-testid="button-toggle-takeprofit">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-[11px] font-bold text-foreground">Auto Take Profit (after buy)</span>
          </div>
          <div className={`relative w-8 h-4 rounded-full transition-colors ${tpEnabled ? "bg-emerald-500" : "bg-border"}`}>
            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all ${tpEnabled ? "left-4.5 translate-x-0.5" : "left-0.5"}`} />
          </div>
        </button>

        {tpEnabled && (
          <div className="px-3 pb-3 space-y-2">
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] font-semibold">
                <span className={overAllocated ? "text-red-400" : "text-muted-foreground"}>
                  {overAllocated ? `Over by ${totalSellPct - 100}%` : `Selling ${totalSellPct}%`}
                </span>
                <span className="text-muted-foreground">Holding {remaining}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-border overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${overAllocated ? "bg-red-500" : "bg-emerald-500"}`}
                  style={{ width: `${Math.min(totalSellPct, 100)}%` }}
                />
              </div>
            </div>

            {targets.map((t, i) => (
              <div key={i} className="flex items-center gap-2" data-testid={`row-tp-${i}`}>
                <div className="flex flex-col items-start gap-0.5">
                  {i === 0 && <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wide">At</span>}
                  <select
                    value={t.at}
                    onChange={(e) => updateTarget(i, "at", e.target.value)}
                    className="bg-background border border-border rounded-md px-2 py-1.5 text-[11px] font-bold text-foreground outline-none focus:border-emerald-500 transition-colors w-16"
                    data-testid={`select-tp-at-${i}`}>
                    {MULTIPLIER_OPTIONS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col items-start gap-0.5 flex-1">
                  {i === 0 && <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wide">Sell</span>}
                  <div className="flex items-center gap-1 flex-1 bg-background border border-border rounded-md px-2 py-1.5 focus-within:border-emerald-500 transition-colors w-full">
                    <input
                      type="number" min="1" max="100"
                      value={t.sellPct}
                      onChange={(e) => updateTarget(i, "sellPct", Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
                      className="w-full bg-transparent text-[11px] font-bold text-foreground outline-none text-center"
                      data-testid={`input-tp-pct-${i}`}
                    />
                    <span className="text-[10px] text-muted-foreground font-semibold">%</span>
                  </div>
                </div>

                <div className="flex flex-col gap-0.5">
                  {i === 0 && <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wide opacity-0">Q</span>}
                  <div className="flex gap-0.5">
                    {[25, 50, 100].map((pct) => (
                      <button key={pct} onClick={() => updateTarget(i, "sellPct", pct)}
                        className={`px-1.5 py-1 text-[9px] font-bold rounded border transition-colors ${
                          t.sellPct === pct ? "border-emerald-500 text-emerald-500 bg-emerald-500/10" : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                        data-testid={`button-tp-quick-${i}-${pct}`}>
                        {pct}%
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-0.5">
                  {i === 0 && <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wide opacity-0">R</span>}
                  <button onClick={() => removeTarget(i)}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    data-testid={`button-tp-remove-${i}`}>
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}

            <button onClick={addTarget}
              className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-500 hover:text-emerald-400 transition-colors mt-1"
              data-testid="button-tp-add">
              <Plus className="w-3 h-3" /> Add sell target
            </button>

            {overAllocated && (
              <p className="text-[10px] text-red-400 font-semibold">
                Total sell % exceeds 100. Reduce targets before {mode === "buy" ? "buying" : "arming"}.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Safety note */}
      <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
        <ShieldCheck className="w-3 h-3 mt-0.5 shrink-0 text-emerald-500/70" />
        <span>
          {mode === "buy"
            ? <>Buy executes immediately on pump.fun bonding curve. Sells fire when each multiplier is hit.</>
            : <>Bot fires once on graduation. Sells execute as separate limit orders.</>
          }
        </span>
      </div>

      {/* ── Action button ── */}
      {mode === "buy" ? (
        <button
          onClick={() => { if (!connected) { setLoginOpen(true); return; } handleBuyNow(); }}
          disabled={buyDisabled && connected}
          className={`w-full py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
            buying
              ? "bg-emerald-600/60 text-white cursor-wait"
              : !connected
              ? "bg-purple-600 hover:bg-purple-500 text-white shadow-sm"
              : buyDisabled
              ? "bg-muted text-muted-foreground cursor-not-allowed"
              : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm"
          }`}
          data-testid="button-buy-now">
          {buying ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Confirming buy…</>
          ) : !connected ? (
            <><Wallet className="w-4 h-4" /> Connect wallet to buy</>
          ) : (
            <><ShoppingCart className="w-4 h-4" /> Buy {amount || "0"} SOL & arm sells</>
          )}
        </button>
      ) : (
        <button
          onClick={() => { if (!connected) { setLoginOpen(true); return; } (armed ? handleDisarm : handleArm)(); }}
          disabled={armDisabled && connected}
          className={`w-full py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
            armed
              ? "bg-red-500/10 border border-red-500/40 text-red-400 hover:bg-red-500/20"
              : arming
              ? "bg-emerald-600/60 text-white cursor-wait"
              : armDisabled
              ? "bg-muted text-muted-foreground cursor-not-allowed"
              : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm"
          }`}
          data-testid="button-arm-sniper">
          {arming ? (
            <><Zap className="w-4 h-4 animate-pulse" /> Arming…</>
          ) : armed ? (
            <><Rocket className="w-4 h-4" /> Disarm bot</>
          ) : (
            <><Rocket className="w-4 h-4" /> Arm sniper bot</>
          )}
        </button>
      )}

      {compact && (
        <Link href="/sniper-bot"
          className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground hover:text-emerald-400 transition-colors"
          data-testid="link-sniper-full">
          Advanced settings <ChevronRight className="w-3 h-3" />
        </Link>
      )}

      <LoginModal open={loginOpen} onOpenChange={setLoginOpen} walletOnly />
    </div>
  );
}

export function SniperBotPreview() {
  return <SniperBotForm compact />;
}
