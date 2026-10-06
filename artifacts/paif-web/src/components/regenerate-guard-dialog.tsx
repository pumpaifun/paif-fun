import { useState, useEffect, useMemo, useCallback } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, ArrowDownToLine, Trash2, RefreshCw } from "lucide-react";

const PAIF_MINT = "HngT3GgmdyEZPmJAu4H84SeoexDb9kccQcZGQxvDpump";
/**
 * Minimum SOL we consider "rent-exempt noise" — under this we treat the
 * account as empty for guardrail purposes. Matches the FEE_RESERVE used
 * by sweepWallet() in bump-bot.tsx (5_000) doubled to give a safety
 * margin: sweep leaves 5_000 behind, so a successful sweep will report
 * roughly that much remaining and we must not flag it as "still funded".
 */
const SWEEP_DUST_LAMPORTS = 10_000;

/**
 * Bounded-concurrency parallel map — same helper as platform-holdings-card.tsx.
 * Each pubkey costs 3 RPC calls (SOL + SPL v1 + Token-2022); fanning out
 * 50+ wallets at once triggers public-RPC throttling, which then surfaces
 * as silent "looks empty, safe to delete" — exactly what this dialog
 * exists to prevent.
 */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

type WalletBalance = {
  pubkey: string;
  sol: number;             // ui SOL (lamports / 1e9)
  solLamports: number;     // raw lamports — used for dust-threshold logic
  paifUi: number;
  otherTokenCount: number;        // token accounts holding >0 of a non-PAIF mint
  emptyTokenAccountCount: number; // token accounts with amount===0 (rent still
                                  // locked; closing them refunds the rent)
  error?: string;
};

export interface RegenerateGuardConfig {
  /** Headline — what action is the user about to take? */
  title: string;
  /** One-line explanation of why it's dangerous. */
  subtitle: string;
  /** Pubkeys whose private keys will be lost after `onProceed`. */
  pubkeys: string[];
  /**
   * Whether the parent can actually perform a sweep (i.e., it holds the
   * unlocked keypairs). When false the "Send to main wallet" button is
   * hidden — there's no point offering an action that would silently
   * no-op. Resize-while-subs-locked sets this to false.
   */
  sweepAvailable: boolean;
  /**
   * Perform the sweep. The dialog will RE-VERIFY on-chain balances after
   * this resolves and only call onProceed if everything's actually empty.
   * Required when sweepAvailable=true. Existing sweepSession/sweepAll
   * swallow errors internally, so we cannot rely on this throwing —
   * verification happens on-chain afterwards.
   */
  onSweep?: () => Promise<void>;
  /** Destroy keys / regenerate. Called after a verified sweep, or directly
   *  when the user picks "regenerate anyway". */
  onProceed: () => Promise<void> | void;
}

interface Props {
  config: RegenerateGuardConfig | null;
  onClose: () => void;
}

/**
 * Reusable confirm dialog shown BEFORE any flow that would destroy a
 * vault key (regenerate session, resize sub-wallets, forget sub-wallets).
 *
 * Fetches LIVE on-chain balances for every affected pubkey and offers
 * two clear, mutually exclusive escape hatches:
 *
 *   1. "Send everything to my main Phantom wallet first"  (primary, black)
 *      — calls onSweep, RE-VERIFIES balances on-chain, only proceeds if
 *      the sweep actually emptied the wallets. If anything remains the
 *      dialog shows a sweep-failed banner with retry / proceed-anyway.
 *
 *   2. "I've backed up the private key — regenerate anyway"  (destructive)
 *      — for users who already have a backup or genuinely want to abandon
 *      the funds.
 *
 * If on-chain balances are all zero on first load, the dialog shows a
 * single "Regenerate now" button.
 *
 * Errored balance lookups are surfaced explicitly — silently collapsing
 * to "empty" would defeat the entire purpose of the guardrail.
 */
export function RegenerateGuardDialog({ config, onClose }: Props) {
  const open = !!config;
  const { connection } = useConnection();
  const [busy, setBusy] = useState<"sweep" | "verify" | "proceed" | null>(null);
  const [balances, setBalances] = useState<WalletBalance[] | null>(null);
  const [loadingBalances, setLoadingBalances] = useState(false);
  // If a sweep "completed" but on-chain re-check still shows funds, we
  // surface that explicitly here instead of falling through to destroy
  // the keys. Set by handleSweep, cleared on retry/cancel/new config.
  const [sweepIncomplete, setSweepIncomplete] = useState(false);

  // Reusable balance-fetch fn so we can re-run it after a sweep without
  // duplicating the RPC logic.
  const fetchBalances = useCallback(async (pubkeys: string[]): Promise<WalletBalance[]> => {
    return mapWithConcurrency(pubkeys, 5, async pk => {
      try {
        const owner = new PublicKey(pk);
        const [solLamports, splV1, tok22] = await Promise.all([
          connection.getBalance(owner, "confirmed"),
          connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, "confirmed"),
          connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, "confirmed"),
        ]);
        let paifUi = 0;
        let otherTokenCount = 0;
        let emptyTokenAccountCount = 0;
        for (const acc of [...splV1.value, ...tok22.value]) {
          const info = (acc.account.data as any).parsed?.info;
          const mint = info?.mint as string | undefined;
          const amountStr = info?.tokenAmount?.amount as string | undefined;
          const decimals = info?.tokenAmount?.decimals as number | undefined;
          if (!mint || !amountStr || decimals === undefined) continue;
          if (amountStr === "0") {
            // Zero-balance token account — still holds ~0.00204 SOL of
            // rent that's only reclaimable by closing the account with
            // the owning key. Destroying the key locks that rent forever.
            emptyTokenAccountCount++;
            continue;
          }
          if (mint === PAIF_MINT) {
            paifUi += Number(BigInt(amountStr)) / Math.pow(10, decimals);
          } else {
            otherTokenCount++;
          }
        }
        return {
          pubkey: pk,
          sol: solLamports / LAMPORTS_PER_SOL,
          solLamports,
          paifUi,
          otherTokenCount,
          emptyTokenAccountCount,
        };
      } catch (err: any) {
        return {
          pubkey: pk, sol: 0, solLamports: 0, paifUi: 0,
          otherTokenCount: 0, emptyTokenAccountCount: 0,
          error: String(err?.message ?? err ?? "RPC error"),
        };
      }
    });
  }, [connection]);

  // Reset state when the dialog opens for a new config.
  useEffect(() => {
    if (!config) return;
    setBusy(null);
    setBalances(null);
    setSweepIncomplete(false);
    setLoadingBalances(true);
    let cancelled = false;
    (async () => {
      const results = await fetchBalances(config.pubkeys);
      if (!cancelled) {
        setBalances(results);
        setLoadingBalances(false);
      }
    })();
    return () => { cancelled = true; };
  }, [config, fetchBalances]);

  const totals = useMemo(() => {
    if (!balances) return { sol: 0, paif: 0, otherTokens: 0, emptyAccts: 0, errored: 0, anyAtRisk: false };
    let sol = 0, paif = 0, otherTokens = 0, emptyAccts = 0, errored = 0;
    let anyAtRisk = false;
    for (const b of balances) {
      if (b.error) { errored++; anyAtRisk = true; continue; }
      sol += b.sol;
      paif += b.paifUi;
      otherTokens += b.otherTokenCount;
      emptyAccts += b.emptyTokenAccountCount;
      if (
        b.solLamports > SWEEP_DUST_LAMPORTS ||
        b.paifUi > 0 ||
        b.otherTokenCount > 0 ||
        b.emptyTokenAccountCount > 0
      ) {
        anyAtRisk = true;
      }
    }
    return { sol, paif, otherTokens, emptyAccts, errored, anyAtRisk };
  }, [balances]);

  async function handleSweep() {
    if (!config || !config.onSweep) return;
    setBusy("sweep");
    setSweepIncomplete(false);
    try {
      // Step 1: run the sweep. Note: the underlying sweepSession/sweepAll
      // CATCH their own errors and toast — they do not throw — so we
      // CANNOT trust a successful resolution here. The real source of
      // truth is the post-sweep balance re-check below.
      await config.onSweep();

      // Step 2: re-check balances on-chain. This is the critical safety
      // gate: if anything remains, we surface that and refuse to call
      // onProceed (which would destroy the keys).
      setBusy("verify");
      const fresh = await fetchBalances(config.pubkeys);
      setBalances(fresh);

      let stillHasFunds = false;
      for (const b of fresh) {
        // Errored re-check is treated as "still has funds" — we won't
        // destroy keys on a guess. User can retry or pick proceed-anyway.
        if (b.error) { stillHasFunds = true; break; }
        if (
          b.solLamports > SWEEP_DUST_LAMPORTS ||
          b.paifUi > 0 ||
          b.otherTokenCount > 0 ||
          // Empty token accounts still hold reclaimable rent. A clean
          // sweep closes them (sweepWallet's `closed` counter); if any
          // remain, the sweep didn't finish.
          b.emptyTokenAccountCount > 0
        ) {
          stillHasFunds = true; break;
        }
      }

      if (stillHasFunds) {
        setSweepIncomplete(true);
        setBusy(null);
        return;
      }

      // Step 3: verified clear → safe to destroy keys.
      setBusy("proceed");
      await config.onProceed();
      onClose();
    } catch {
      setBusy(null);
    }
  }

  async function handleProceedAnyway() {
    if (!config) return;
    setBusy("proceed");
    try {
      await config.onProceed();
      onClose();
    } catch {
      setBusy(null);
    }
  }

  const sweepBtnVisible = !!config?.sweepAvailable && !!config?.onSweep && totals.anyAtRisk;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v && !busy) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="dialog-regenerate-guard">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
            {config?.title ?? "Are you sure?"}
          </DialogTitle>
          <DialogDescription>{config?.subtitle}</DialogDescription>
        </DialogHeader>

        {loadingBalances && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Checking what these wallets currently hold on-chain…
          </div>
        )}

        {!loadingBalances && balances && (
          <>
            {sweepIncomplete && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/40 p-3 space-y-1"
                data-testid="block-sweep-incomplete">
                <p className="text-xs font-bold text-red-700 dark:text-red-300">
                  The sweep didn't clear everything.
                </p>
                <p className="text-[11px] text-red-700/90 dark:text-red-300/90 leading-snug">
                  Some funds are still in these wallets on-chain. Your keys have NOT been deleted. Try the sweep again, or back up the private key and choose "regenerate anyway".
                </p>
              </div>
            )}

            {totals.anyAtRisk ? (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/40 p-3 space-y-1.5"
                data-testid="block-at-risk">
                <p className="text-xs font-bold text-amber-700 dark:text-amber-300">
                  {sweepIncomplete ? "Still in these wallets:" : "You'll lose access to:"}
                </p>
                <ul className="text-[12px] text-foreground space-y-0.5 ml-1">
                  {totals.paif > 0 && (
                    <li data-testid="text-at-risk-paif">
                      • <b>{totals.paif.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b> PAIF
                    </li>
                  )}
                  {totals.sol > 0 && (
                    <li data-testid="text-at-risk-sol">
                      • <b>{totals.sol.toFixed(4)}</b> SOL
                    </li>
                  )}
                  {totals.otherTokens > 0 && (
                    <li data-testid="text-at-risk-other">
                      • {totals.otherTokens} other token{totals.otherTokens !== 1 ? "s" : ""}
                    </li>
                  )}
                  {totals.emptyAccts > 0 && (
                    <li data-testid="text-at-risk-empty-accts">
                      • {totals.emptyAccts} empty token account{totals.emptyAccts !== 1 ? "s" : ""} (~{(totals.emptyAccts * 0.00204).toFixed(4)} SOL of rent — closes during sweep and goes to the platform treasury as the sub-wallet rental fee)
                    </li>
                  )}
                  {totals.errored > 0 && (
                    <li className="text-slate-700 dark:text-slate-300" data-testid="text-at-risk-errored">
                      • Couldn't check {totals.errored} wallet{totals.errored !== 1 ? "s" : ""} (RPC error) — could be holding funds
                    </li>
                  )}
                </ul>
                {!sweepIncomplete && (
                  <p className="text-[11px] text-amber-700/90 dark:text-amber-300/90 leading-snug pt-1">
                    Once you regenerate, the encrypted key for {config!.pubkeys.length === 1 ? "this wallet" : `these ${config!.pubkeys.length} wallets`} is gone from this device. Any funds left behind are only recoverable if you exported the private key first.
                  </p>
                )}
                {!sweepIncomplete && !config!.sweepAvailable && (
                  <p className="text-[11px] text-amber-800 dark:text-amber-200 leading-snug pt-1 font-medium" data-testid="text-locked-warning">
                    These wallets are locked — unlock them first to sweep funds back to your main wallet automatically.
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/40 p-3"
                data-testid="block-empty">
                <p className="text-xs text-emerald-700 dark:text-emerald-300">
                  These wallets are empty on-chain. Safe to regenerate — nothing will be lost.
                </p>
              </div>
            )}

            <div className="space-y-2 pt-1">
              {sweepBtnVisible && (
                <Button
                  onClick={handleSweep}
                  disabled={!!busy}
                  className="w-full bg-black hover:bg-black/90 text-white h-11 font-bold"
                  data-testid="button-sweep-then-regenerate"
                >
                  {busy === "sweep"
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending to your main wallet…</>
                    : busy === "verify"
                      ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Verifying on-chain…</>
                      : sweepIncomplete
                        ? <><RefreshCw className="w-4 h-4 mr-2" />Try the sweep again</>
                        : <><ArrowDownToLine className="w-4 h-4 mr-2" />Send everything to my main wallet first</>}
                </Button>
              )}
              <Button
                onClick={handleProceedAnyway}
                disabled={!!busy}
                variant={totals.anyAtRisk ? "outline" : "default"}
                className={totals.anyAtRisk
                  ? "w-full h-10 border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
                  : "w-full bg-black hover:bg-black/90 text-white h-11 font-bold"}
                data-testid="button-proceed-anyway"
              >
                {busy === "proceed"
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Regenerating…</>
                  : totals.anyAtRisk
                    ? <><Trash2 className="w-4 h-4 mr-2" />I've backed up the key — regenerate anyway</>
                    : "Regenerate now"}
              </Button>
              {totals.anyAtRisk && sweepBtnVisible && !sweepIncomplete && (
                <p className="text-[10px] text-muted-foreground text-center leading-snug pt-1">
                  Prefer to keep the funds inside the platform? Send them to your main wallet first, then re-fund the new wallets from there.
                </p>
              )}
            </div>
          </>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={!!busy}
            data-testid="button-cancel-regenerate"
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
