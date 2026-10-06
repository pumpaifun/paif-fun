import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, ChevronDown, ChevronUp, ShieldCheck, AlertTriangle, Copy, ExternalLink, KeyRound } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const PAIF_MINT = "HngT3GgmdyEZPmJAu4H84SeoexDb9kccQcZGQxvDpump";

type HistoricalWallet = {
  sessionWallet: string;
  bumpCount: number;
  firstAt: string;
  lastAt: string;
};

type WalletBalance = {
  pubkey: string;
  sol: number;
  tokens: { mint: string; amount: bigint; decimals: number }[];
  /** True if RPC failed for this wallet. We MUST NOT show "Empty" in that
   *  case — silently rendering zero would hide stranded funds, defeating
   *  the entire purpose of this panel. */
  error?: string;
};

/**
 * Bounded-concurrency parallel map. Solana public RPC throttles aggressive
 * fan-out (each historical wallet costs 3 RPC calls: SOL + SPL v1 + Token-2022),
 * so a user with 50 historical wallets would burst 150 requests and trigger
 * 429s, which then surface as silent "empty wallet" rows. Limiting to 5 in
 * flight at a time keeps total latency reasonable while staying well under
 * any single-endpoint rate limit.
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

interface Props {
  mainWalletPubkey: string;
  /** Pubkeys whose private keys are currently unlocked on this device. */
  unlockedPubkeys: string[];
  /** Pubkeys whose encrypted vaults exist on this device (locked or unlocked). */
  knownPubkeys: string[];
  /** The session-vault pubkey (if any) — used to decide whether a locked
   *  row's unlock prompt should jump to the session-unlock card or the
   *  sub-wallet unlock card. */
  sessionVaultPubkey?: string | null;
  /** Pubkeys present in the sub-wallet vault (locked or unlocked). Same
   *  routing role as `sessionVaultPubkey`. */
  subVaultPubkeys?: string[];
  /** Called when the user taps "Unlock to move these funds" on a locked
   *  row. The parent handles scrolling to + flashing the right unlock
   *  card. Receives the row pubkey + which vault it lives in. */
  onUnlockRequest?: (pubkey: string, vault: "session" | "sub") => void;
}

/**
 * "Platform Holdings" card — shows every session wallet this main wallet
 * has ever traded from (per server-side bump_history) and their CURRENT
 * on-chain balance. Critically, this surfaces funds sitting in OLD
 * session wallets whose encrypted keys have been overwritten on this
 * device — without this view a user can lose track of stranded funds
 * after generating a new session wallet.
 *
 * Each row is tagged with one of three statuses:
 *  - "Unlocked here" — key is loaded in memory right now; can move funds
 *  - "Locked vault on this device" — key is on this device but vault
 *    not unlocked; unlock it to move funds
 *  - "Key not on this device" — key was overwritten or generated on
 *    another device. Funds are only recoverable by importing the
 *    private key into Phantom from a backup (if one exists).
 */
export function PlatformHoldingsCard({
  mainWalletPubkey,
  unlockedPubkeys,
  knownPubkeys,
  sessionVaultPubkey,
  subVaultPubkeys = [],
  onUnlockRequest,
}: Props) {
  const { connection } = useConnection();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [expandedPubkey, setExpandedPubkey] = useState<string | null>(null);

  // ── Server history: every session wallet ever used by this owner ────────
  const historyQuery = useQuery<{ wallets: HistoricalWallet[] }>({
    queryKey: ["/api/bump-history", mainWalletPubkey, "session-wallets"],
    enabled: !!mainWalletPubkey,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  const historicalWallets = historyQuery.data?.wallets ?? [];

  // ── On-chain balance lookup for each historical wallet ──────────────────
  // We fan out one balance query per pubkey, in parallel. Results are
  // cached by react-query so re-renders don't re-fetch. If a pubkey has
  // no on-chain account (never received funds) we still report SOL=0,
  // no tokens.
  const balancesQuery = useQuery<WalletBalance[]>({
    queryKey: ["platform-holdings-balances", mainWalletPubkey, historicalWallets.map(w => w.sessionWallet).sort().join(",")],
    enabled: historicalWallets.length > 0,
    refetchOnWindowFocus: false,
    staleTime: 15_000,
    queryFn: async () => {
      // Bounded concurrency — see mapWithConcurrency() comment for why.
      // Per-wallet RPC failures must surface as an explicit `error` rather
      // than being collapsed into "empty wallet", otherwise stranded funds
      // can be silently hidden the moment the RPC throttles us.
      return mapWithConcurrency(historicalWallets, 5, async w => {
        try {
          const owner = new PublicKey(w.sessionWallet);
          const [solLamports, splV1, tok22] = await Promise.all([
            connection.getBalance(owner, "confirmed"),
            connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, "confirmed"),
            connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, "confirmed"),
          ]);
          const byMint = new Map<string, { amount: bigint; decimals: number }>();
          for (const acc of [...splV1.value, ...tok22.value]) {
            const info = (acc.account.data as any).parsed?.info;
            const mint = info?.mint as string | undefined;
            const amountStr = info?.tokenAmount?.amount as string | undefined;
            const decimals = info?.tokenAmount?.decimals as number | undefined;
            if (!mint || !amountStr || amountStr === "0" || decimals === undefined) continue;
            const prev = byMint.get(mint) ?? { amount: 0n, decimals };
            prev.amount += BigInt(amountStr);
            byMint.set(mint, prev);
          }
          return {
            pubkey: w.sessionWallet,
            sol: solLamports / LAMPORTS_PER_SOL,
            tokens: Array.from(byMint.entries()).map(([mint, v]) => ({ mint, ...v })),
          };
        } catch (err: any) {
          return {
            pubkey: w.sessionWallet,
            sol: 0,
            tokens: [],
            error: String(err?.message ?? err ?? "RPC error"),
          };
        }
      });
    },
  });

  const balances = balancesQuery.data ?? [];

  // ── Aggregate totals ────────────────────────────────────────────────────
  const totals = useMemo(() => {
    let totalSol = 0;
    let paifAmount = 0n;
    let paifDecimals = 6;
    const otherTokensByMint = new Map<string, { amount: bigint; decimals: number }>();
    let walletsWithBalance = 0;
    let strandedWallets = 0;
    let strandedSol = 0;
    let strandedPaif = 0n;
    let erroredWallets = 0;
    const knownSet = new Set(knownPubkeys);
    for (const b of balances) {
      // CRITICAL: a wallet whose RPC fetch failed is NOT empty — it's unknown.
      // Excluding it from totals + stranded-counts ensures we never display
      // a confident "all wallets empty" that hides funds the next refresh
      // would reveal. The errored count is surfaced separately in the UI.
      if (b.error) { erroredWallets++; continue; }
      totalSol += b.sol;
      const isStranded = !knownSet.has(b.pubkey);
      const hasBalance = b.sol > 0 || b.tokens.length > 0;
      if (hasBalance) walletsWithBalance++;
      if (isStranded && hasBalance) {
        strandedWallets++;
        strandedSol += b.sol;
      }
      for (const t of b.tokens) {
        if (t.mint === PAIF_MINT) {
          paifAmount += t.amount;
          paifDecimals = t.decimals;
          if (isStranded) strandedPaif += t.amount;
        } else {
          const prev = otherTokensByMint.get(t.mint) ?? { amount: 0n, decimals: t.decimals };
          prev.amount += t.amount;
          otherTokensByMint.set(t.mint, prev);
        }
      }
    }
    return {
      totalSol,
      paifAmount,
      paifDecimals,
      paifUi: Number(paifAmount) / Math.pow(10, paifDecimals),
      otherTokenCount: otherTokensByMint.size,
      walletsWithBalance,
      strandedWallets,
      strandedSol,
      strandedPaifUi: Number(strandedPaif) / Math.pow(10, paifDecimals),
      erroredWallets,
    };
  }, [balances, knownPubkeys]);

  const loading = historyQuery.isLoading || balancesQuery.isLoading;

  // Don't render anything if user has never bumped — nothing to show.
  if (!loading && historicalWallets.length === 0) return null;

  function statusFor(pubkey: string): "unlocked" | "locked" | "stranded" {
    if (unlockedPubkeys.includes(pubkey)) return "unlocked";
    if (knownPubkeys.includes(pubkey)) return "locked";
    return "stranded";
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied", description: text.slice(0, 6) + "…" + text.slice(-6) });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  }

  return (
    <Card data-testid="card-platform-holdings" className="border-emerald-300/50 dark:border-emerald-700/50">
      <CardContent className="p-5 space-y-3">
        {/* Header — always-visible summary line + chevron */}
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="w-full flex items-center justify-between gap-3 text-left"
          data-testid="button-toggle-platform-holdings"
          aria-expanded={expanded}
        >
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
              Your platform holdings
            </p>
            <h3 className="text-lg font-bold text-foreground mt-0.5">
              {loading ? "Checking every wallet you've used…"
                : totals.paifUi > 0
                  ? <>You're holding <span className="text-emerald-600 dark:text-emerald-400">{totals.paifUi.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span> PAIF on the platform</>
                  : totals.totalSol > 0 || totals.otherTokenCount > 0
                    ? <>Funds detected across {totals.walletsWithBalance} wallet{totals.walletsWithBalance !== 1 ? "s" : ""}</>
                    : "All your platform wallets are empty"}
            </h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Across <b>{historicalWallets.length}</b> wallet{historicalWallets.length !== 1 ? "s" : ""} you've ever traded from
              {totals.totalSol > 0 && <> · <b>{totals.totalSol.toFixed(4)}</b> SOL total</>}
              {totals.otherTokenCount > 0 && <> · {totals.otherTokenCount} other token{totals.otherTokenCount !== 1 ? "s" : ""}</>}
            </p>
          </div>
          {loading
            ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />
            : (expanded ? <ChevronUp className="w-5 h-5 text-muted-foreground shrink-0" /> : <ChevronDown className="w-5 h-5 text-muted-foreground shrink-0" />)}
        </button>

        {/* Errored-wallet warning — when RPC fails for any wallet, we MUST
            tell the user it's an "unknown" state, not collapse to "empty".
            Otherwise stranded funds could be hidden until next refresh. */}
        {!loading && totals.erroredWallets > 0 && (
          <div className="rounded-lg bg-slate-500/10 border border-slate-500/40 p-3 flex items-start gap-2"
            data-testid="alert-errored-wallets">
            <AlertTriangle className="w-4 h-4 text-slate-600 dark:text-slate-300 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                Couldn't check {totals.erroredWallets} wallet{totals.erroredWallets !== 1 ? "s" : ""} — RPC error
              </p>
              <p className="text-[11px] text-slate-700/90 dark:text-slate-300/90 leading-snug mt-0.5">
                These balances are NOT included in the totals above. Tap "Retry" to try again — Solana RPC sometimes throttles when checking many wallets at once.
              </p>
              <button
                type="button"
                onClick={() => balancesQuery.refetch()}
                disabled={balancesQuery.isFetching}
                className="mt-1.5 text-[11px] font-bold underline text-slate-800 dark:text-slate-100 disabled:opacity-50"
                data-testid="button-retry-balances"
              >
                {balancesQuery.isFetching ? "Retrying…" : "Retry balance check"}
              </button>
            </div>
          </div>
        )}

        {/* Stranded-funds warning — shown OUTSIDE the disclosure because
            it's urgent. Old session wallets with on-chain balance but
            no key on this device → user needs to recover from backup. */}
        {!loading && totals.strandedWallets > 0 && (
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/40 p-3 space-y-1.5"
            data-testid="alert-stranded-funds">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-amber-700 dark:text-amber-300">
                  {totals.strandedWallets} old wallet{totals.strandedWallets !== 1 ? "s" : ""} still hold{totals.strandedWallets === 1 ? "s" : ""} funds you can't move from here
                </p>
                <p className="text-[11px] text-amber-700/90 dark:text-amber-300/90 leading-snug mt-0.5">
                  {totals.strandedPaifUi > 0 && <><b>{totals.strandedPaifUi.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b> PAIF</>}
                  {totals.strandedPaifUi > 0 && totals.strandedSol > 0 && " + "}
                  {totals.strandedSol > 0 && <><b>{totals.strandedSol.toFixed(4)}</b> SOL</>}
                  {" "}sit in session wallets you used before generating a new one. To recover them, you need the private key from the device/browser where they were created — import it into Phantom. If you never exported the key and don't have that device, these funds are unreachable.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Per-wallet breakdown */}
        {expanded && !loading && (
          <div className="space-y-1.5 pt-1" data-testid="list-platform-wallets">
            {historicalWallets.map(w => {
              const balance = balances.find(b => b.pubkey === w.sessionWallet);
              const status = statusFor(w.sessionWallet);
              const paifToken = balance?.tokens.find(t => t.mint === PAIF_MINT);
              const paifUi = paifToken ? Number(paifToken.amount) / Math.pow(10, paifToken.decimals) : 0;
              const isExpanded = expandedPubkey === w.sessionWallet;
              const hasAnyBalance = !balance?.error && ((balance?.sol ?? 0) > 0 || (balance?.tokens.length ?? 0) > 0);
              return (
                <div key={w.sessionWallet}
                  className={`rounded-lg border p-2.5 ${
                    status === "stranded" && hasAnyBalance
                      ? "border-amber-500/40 bg-amber-500/5"
                      : "border-border"
                  }`}
                  data-testid={`row-wallet-${w.sessionWallet}`}
                >
                  <button type="button"
                    onClick={() => setExpandedPubkey(p => p === w.sessionWallet ? null : w.sessionWallet)}
                    className="w-full flex items-center justify-between gap-2 text-left"
                    data-testid={`button-toggle-wallet-${w.sessionWallet}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <code className="text-[11px] font-mono text-foreground">
                          {w.sessionWallet.slice(0, 6)}…{w.sessionWallet.slice(-6)}
                        </code>
                        {status === "unlocked" && (
                          <span className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                            <ShieldCheck className="w-2.5 h-2.5" /> Unlocked here
                          </span>
                        )}
                        {status === "locked" && (
                          <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30">
                            Locked vault on this device
                          </span>
                        )}
                        {status === "stranded" && (
                          <span className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                            <AlertTriangle className="w-2.5 h-2.5" /> Key not on this device
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {w.bumpCount} bump{w.bumpCount !== 1 ? "s" : ""} · last {new Date(w.lastAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      {balance ? (
                        balance.error ? (
                          <p className="text-[11px] font-bold text-slate-600 dark:text-slate-400" data-testid={`text-error-${w.sessionWallet}`}>
                            Check failed
                          </p>
                        ) : (
                          <>
                            {paifUi > 0 && (
                              <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400" data-testid={`text-paif-${w.sessionWallet}`}>
                                {paifUi.toLocaleString(undefined, { maximumFractionDigits: 2 })} PAIF
                              </p>
                            )}
                            {balance.sol > 0 && (
                              <p className="text-[11px] text-muted-foreground" data-testid={`text-sol-${w.sessionWallet}`}>
                                {balance.sol.toFixed(4)} SOL
                              </p>
                            )}
                            {!hasAnyBalance && (
                              <p className="text-[11px] text-muted-foreground">Empty</p>
                            )}
                          </>
                        )
                      ) : (
                        <Loader2 className="w-3 h-3 animate-spin text-muted-foreground inline" />
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="mt-2 pt-2 border-t border-border/50 space-y-1.5">
                      <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                        <code className="font-mono text-muted-foreground break-all">{w.sessionWallet}</code>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => copy(w.sessionWallet)}
                          className="text-[10px] underline text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                          data-testid={`button-copy-${w.sessionWallet}`}
                        >
                          <Copy className="w-3 h-3" /> Copy address
                        </button>
                        <a
                          href={`https://solscan.io/account/${w.sessionWallet}`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-[10px] underline text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                          data-testid={`link-solscan-${w.sessionWallet}`}
                        >
                          <ExternalLink className="w-3 h-3" /> Solscan
                        </a>
                      </div>
                      {balance && balance.tokens.length > 0 && (
                        <div className="space-y-0.5">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">All tokens</p>
                          {balance.tokens.map(t => (
                            <div key={t.mint} className="flex items-center justify-between text-[10px]">
                              <code className="font-mono text-muted-foreground">
                                {t.mint === PAIF_MINT ? "PAIF" : `${t.mint.slice(0, 4)}…${t.mint.slice(-4)}`}
                              </code>
                              <span className="font-bold">
                                {(Number(t.amount) / Math.pow(10, t.decimals)).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {status === "stranded" && hasAnyBalance && (
                        <p className="text-[10px] text-amber-700 dark:text-amber-300 leading-snug">
                          To move these funds: find a backup of this wallet's private key, then "Import private key" into Phantom. If you never exported it, they're unreachable from here.
                        </p>
                      )}
                      {status === "locked" && (
                        <div className="space-y-1.5">
                          <p className="text-[10px] text-sky-700 dark:text-sky-300 leading-snug">
                            {hasAnyBalance
                              ? "These funds are on this device but the vault is locked. Unlock it, then you can sell to SOL or send to your main wallet."
                              : "Vault is locked on this device. Unlock if you want to use this wallet again."}
                          </p>
                          {onUnlockRequest && (
                            <button
                              type="button"
                              onClick={() => {
                                // Route to the right unlock card. A pubkey
                                // can ONLY live in one vault at a time
                                // (session and sub-wallets never share
                                // keys), so this is unambiguous.
                                const inSub = subVaultPubkeys.includes(w.sessionWallet);
                                const isSession = sessionVaultPubkey === w.sessionWallet;
                                onUnlockRequest(
                                  w.sessionWallet,
                                  inSub && !isSession ? "sub" : "session",
                                );
                              }}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-black text-white dark:bg-white dark:text-black text-[11px] font-bold hover:opacity-90"
                              data-testid={`button-unlock-from-row-${w.sessionWallet}`}
                            >
                              <KeyRound className="w-3 h-3" />
                              Unlock to move these funds
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {expanded && !loading && historicalWallets.length === 0 && (
          <p className="text-[11px] text-muted-foreground text-center py-3">
            No past trades found for this main wallet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
