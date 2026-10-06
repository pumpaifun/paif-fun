import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from "react";
import { useLocation } from "wouter";
import { Header } from "@/components/header";
import { BotTabs } from "@/components/bot-tabs";
import { Footer } from "@/components/footer";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronUp, ChevronDown, Zap, Clock, CheckCircle2, XCircle, Loader2, AlertTriangle, AlertCircle,
  ExternalLink, StopCircle, Play, Info, Lock, BarChart3,
  ShieldCheck, KeyRound, Wallet as WalletIcon, ArrowDownToLine,
  Eye, EyeOff, Copy, ArrowUpFromLine, ArrowDownToDot,
  History, Users, Shuffle, Layers, Trash2,
  Activity, ArrowUpRight, ArrowDownRight, Radio, X,
} from "lucide-react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { fetchAssetMetadata } from "@/lib/asset-metadata";
import {
  Connection, Keypair, PublicKey, SystemProgram, ComputeBudgetProgram,
  Transaction, VersionedTransaction, TransactionMessage, TransactionInstruction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction, createCloseAccountInstruction,
} from "@solana/spl-token";
import bs58 from "bs58";
import { LoginModal } from "@/components/login-modal";
import { OpenInPhantomBanner } from "@/components/open-in-phantom";
import {
  vaultExists, vaultPublicKey, saveToVault, unlockVault, clearVault,
  sessionVaultUnlockModeStored, sessionVaultSignerPubkey, sessionVaultUnlockMessage,
  saveToVaultWithSignature, unlockVaultWithSignature, migrateSessionVaultToSignature,
  type SessionVaultUnlockMode,
} from "@/lib/session-vault";
import {
  subWalletsExist, subWalletPublicKeys, generateAndSaveSubWallets,
  unlockSubWallets, clearSubWallets, MAX_SUB_WALLETS, MAX_SUB_WALLETS_UNLIMITED,
  subWalletUnlockModeStored, subWalletSignerPubkey, subWalletUnlockMessage,
  generateAndSaveSubWalletsWithSignature, unlockSubWalletsWithSignature,
  migrateVaultToSignature,
  type SubWalletUnlockMode,
} from "@/lib/sub-wallets";
import {
  deriveBumpBotMessage, deriveBumpBotKeys, readDerivedConfig,
  writeDerivedConfig, clearDerivedConfig, MAX_DERIVED_SUBS,
  type DerivedConfig,
} from "@/lib/derived-wallets";
import { CreditBalance } from "@/components/credit-balance";
import { PlatformHoldingsCard } from "@/components/platform-holdings-card";
import { RegenerateGuardDialog, type RegenerateGuardConfig } from "@/components/regenerate-guard-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";

type AmountMode = "fixed" | "range" | "list";
type BotPreset  = "stealth" | "standard" | "aggressive" | "max" | "custom";

interface PresetConfig {
  label: string;
  blurb: string;
  subCount: number;
  amountMode: AmountMode;
  solPerBump?: string;
  solRangeMin?: string;
  solRangeMax?: string;
  solList?: string;
}

// Curated bot configurations. Picking a preset auto-fills sub-wallet count
// and amount-mode settings; "custom" reveals every knob for power users.
const BOT_PRESETS: Record<Exclude<BotPreset, "custom">, PresetConfig> = {
  // Every preset is tuned so its minimum SOL/bump sits at or above
  // PUMPFUN_VISIBILITY_FLOOR_SOL (0.01) — guarantees bumps from any preset
  // appear in pump.fun's public "Latest Trades" feed by default.
  stealth:    { label: "Stealth",    blurb: "1 wallet · 0.01 SOL fixed",         subCount: 1,  amountMode: "fixed", solPerBump: "0.01"   },
  standard:   { label: "Standard",   blurb: "3 wallets · 0.01–0.025 SOL random", subCount: 3,  amountMode: "range", solRangeMin: "0.01",  solRangeMax: "0.025" },
  aggressive: { label: "Aggressive", blurb: "5 wallets · 0.02–0.05 SOL random",  subCount: 5,  amountMode: "range", solRangeMin: "0.02",  solRangeMax: "0.05"  },
  max:        { label: "Max Spread", blurb: "10 wallets · cycling list",         subCount: 10, amountMode: "list",  solList: "0.01, 0.02, 0.05, 0.03, 0.015" },
};

interface BumpHistoryRow {
  id: string;
  ownerWallet: string;
  sessionWallet: string;
  mint: string;
  tokenSymbol: string | null;
  action: "buy" | "sell";
  amountSol: number | null;
  amountTokens: number | null;
  txSignature: string | null;
  status: "success" | "failed";
  errorMessage: string | null;
  createdAt: string;
}

interface BumpHistoryResponse {
  history: BumpHistoryRow[];
  stats: {
    totalBumps: number;
    totalSuccess: number;
    totalFailed: number;
    totalSolSpent: number;
    firstAt: string | null;
    lastAt: string | null;
  };
}

const SOL_PRESETS = [0.005, 0.01, 0.02, 0.05];
// Empirical floor below which pump.fun's "Latest Trades" UI hides bumps from the
// public feed. Bumps below this still execute on-chain and move the bonding
// curve — they just won't be visible to organic traders watching the token page.
const PUMPFUN_VISIBILITY_FLOOR_SOL = 0.01;

// Platform treasury — receives reclaimed rent (~0.00204 SOL per closed token
// account) when sub-wallet/session token accounts are closed during sweeps
// or auto-sells. This is the platform's service fee for renting sub-wallets
// + running the bump infrastructure; disclosed in the sweep dialog so users
// know the rent isn't returning to their own wallet. Same address as the
// 3% swap fee vault. If we ever spin up a dedicated rent treasury, change
// this single constant.
const PLATFORM_RENT_TREASURY = new PublicKey("5x9y9cboqWWkckVmyqheQJyorojZrKvsv9SLjxNmZKNr");

const DELAY_PRESETS = [
  { label: "30s",  secs: 30 },
  { label: "1m",   secs: 60 },
  { label: "5m",   secs: 300 },
  { label: "10m",  secs: 600 },
  { label: "30m",  secs: 1800 },
  { label: "1h",   secs: 3600 },
  { label: "6h",   secs: 21600 },
  { label: "12h",  secs: 43200 },
  { label: "24h",  secs: 86400 },
];

type BumpAction = "buy" | "sell";
type SignMode   = "wallet" | "session";
type BotState   = "idle" | "running" | "stopped";
type BumpStatus = "success" | "failed";

interface BumpLog {
  id: number;
  status: BumpStatus;
  action: BumpAction;
  amount: number;        // SOL for buy, tokens for sell
  txid?: string;
  error?: string;
  timestamp: Date;
  signer?: string;       // base58 pubkey of the wallet that signed this bump
}

function formatCountdown(secs: number) {
  if (secs <= 0) return "0s";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function isPumpToken(addr: string) {
  return addr.toLowerCase().endsWith("pump");
}

function CollapsibleSection({
  title,
  icon,
  testid,
  id,
  className,
  defaultOpen = true,
  bodyClassName = "space-y-3",
  headerExtra,
  children,
}: {
  title: ReactNode;
  icon?: ReactNode;
  testid?: string;
  id?: string;
  className?: string;
  defaultOpen?: boolean;
  bodyClassName?: string;
  headerExtra?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card id={id} data-testid={testid} className={className}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-testid={testid ? `toggle-${testid}` : undefined}
        className="w-full flex items-center gap-2 px-5 py-4 text-left transition-colors hover:bg-muted/30 rounded-t-xl"
      >
        {icon}
        <span className="text-xs font-bold uppercase tracking-wide text-foreground">{title}</span>
        {headerExtra}
        <ChevronDown
          className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {open && <CardContent className={`px-5 pb-5 pt-0 ${bodyClassName}`}>{children}</CardContent>}
    </Card>
  );
}

export default function BumpBotPage() {
  useEffect(() => { window.scrollTo(0, 0); }, []);

  const { publicKey, signTransaction, signMessage, sendTransaction, signAllTransactions, connected } = useWallet();
  const { connection } = useConnection();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [loginOpen, setLoginOpen] = useState(false);

  // ── Trade config ─────────────────────────────────────────────────────────
  const [bumpAction, setBumpAction]       = useState<BumpAction>("buy");
  const [tokenAddress, setTokenAddress]   = useState("");
  const [solPerBump, setSolPerBump]       = useState("0.01");
  const [tokensPerSell, setTokensPerSell] = useState("1000");
  const [delayPreset, setDelayPreset]     = useState(30);
  const [customDelay, setCustomDelay]     = useState({ enabled: false, h: "0", m: "1", s: "0" });
  // Per-bump timing jitter. When enabled, each scheduled delay is multiplied
  // by a uniform random factor in [1 - jitterPct/100, 1 + jitterPct/100],
  // floored at 15s. Defaults ON because a constant interval is the single
  // strongest "this is a bot" signal pump.fun's UI looks for.
  const [jitterEnabled, setJitterEnabled] = useState(true);
  const [jitterPct, setJitterPct]         = useState("30");
  const [maxBumps, setMaxBumps]           = useState("10");
  const [slippage, setSlippage]           = useState("10");

  // ── Variable amount config ───────────────────────────────────────────────
  // "fixed" → use solPerBump every time
  // "range" → uniform random in [solRangeMin, solRangeMax]
  // "list"  → cycle through solList in order, wrap around
  // Sell mode always uses fixed tokensPerSell — variable amounts only apply
  // to buys, where SOL spend is the user-controlled knob.
  // Defaults match the "Standard" preset so a fresh user clicking that tile
  // (or just leaving the default) gets a sensible random-range config.
  const [amountMode, setAmountMode]     = useState<AmountMode>("range");
  const [solRangeMin, setSolRangeMin]   = useState("0.002");
  const [solRangeMax, setSolRangeMax]   = useState("0.005");
  const [solList, setSolList]           = useState("0.005, 0.01, 0.02, 0.015, 0.008");

  // ── Quick-mode presets ───────────────────────────────────────────────────
  // Bundles {sub-wallet count + amount mode + amount values} into one click
  // for users who don't want to think about every knob. "custom" reveals the
  // detailed manual controls (current pre-preset behavior).
  const [botPreset, setBotPreset] = useState<BotPreset>("standard");

  // How many consecutive bumps a single sub-wallet does before the baton passes
  // to the next wallet in the pool. Higher values make each address look more
  // like a real trader doing several trades in a row (less obviously botty);
  // lower values spread activity across more wallets but make rotation patterns
  // easier to fingerprint. Default 6 is a balance — every wallet does ~6 bumps
  // before its neighbour takes over, then the cycle wraps.
  const [bumpsPerWallet, setBumpsPerWallet] = useState("6");

  // When true, pick a random wallet for each bump (avoiding immediate repeats
  // when the pool has 2+ wallets) instead of the deterministic stride above.
  // Random rotation looks much more organic on dex screener / pump.fun's
  // recent-trades feed: instead of "6 buys in a row from wallet A", you get
  // an unpredictable mix that resembles real distinct buyers. Default on.
  const [randomizeWallets, setRandomizeWallets] = useState(true);

  // ── Sign mode ────────────────────────────────────────────────────────────
  // Persist the user's choice so a reload (or HMR) doesn't silently reset to
  // "wallet" mode and hide the Session Wallet card. If they've already set up
  // a session wallet on this device, open in "session" mode so the card and
  // their saved wallet are visible immediately.
  const [signMode, setSignMode] = useState<SignMode>(() => {
    try {
      const stored = localStorage.getItem("paif:bump:signMode");
      if (stored === "wallet" || stored === "session") return stored;
    } catch { /* localStorage unavailable — fall through */ }
    return vaultExists() ? "session" : "wallet";
  });
  useEffect(() => {
    try { localStorage.setItem("paif:bump:signMode", signMode); }
    catch { /* localStorage unavailable — non-fatal */ }
  }, [signMode]);

  // Session wallet state.
  // The keypair lives in memory; if the user opted to "save on this device" we
  // also persist an encrypted copy in localStorage (see lib/session-vault.ts).
  const [sessionKeypair, setSessionKeypair] = useState<Keypair | null>(null);
  const [sessionBalance, setSessionBalance] = useState(0);            // lamports
  const [sessionTokens, setSessionTokens] = useState<number>(0);      // # of token accounts with non-zero balance
  const [sessionFundAmount, setSessionFundAmount] = useState("0.05");
  const [sessionBusy, setSessionBusy] =
    useState<null | "fund" | "sweep" | "refresh" | "generate" | "unlock">(null);
  const [showSessionKey, setShowSessionKey] = useState(false);

  // Vault (encrypted persistence) state
  const [hasVault, setHasVault] = useState<boolean>(() => vaultExists());
  const [savedPubkey, setSavedPubkey] = useState<string | null>(() => vaultPublicKey());
  // Mirror of the sub-wallet signature unlock — same idea applied to the
  // primary SESSION wallet. Existing v1 passphrase vaults stay readable.
  const [sessionVaultMode, setSessionVaultMode] = useState<SessionVaultUnlockMode | null>(
    () => sessionVaultUnlockModeStored()
  );
  const [sessionVaultSigner, setSessionVaultSigner] = useState<string | null>(
    () => sessionVaultSignerPubkey()
  );
  // What mode the user wants when CREATING a new session vault — defaults
  // to "signature" when a wallet is connected (one Phantom tap, no typing).
  const [sessionGenMode, setSessionGenMode] = useState<SessionVaultUnlockMode>("signature");
  // Reveals the passphrase generation form even when a wallet is connected.
  const [showSessionPassphraseGen, setShowSessionPassphraseGen] = useState(false);
  // Migration prompt state for upgrading an existing passphrase-mode session
  // vault to wallet-signature unlock.
  const [sessionMigratePass, setSessionMigratePass] = useState("");
  const [showSessionMigratePrompt, setShowSessionMigratePrompt] = useState(false);
  // Sweep mode — controls what happens to the tokens sitting in the session
  // and sub-wallets when the user wants to "cash out". Three options:
  //  - "transfer"  (default) — SPL-transfer every token to the user's main
  //                wallet so nothing is lost (works even for graduated coins
  //                that we can't sell on the bonding curve), then close empty
  //                token accounts to refund Solana's ~0.002 SOL rent deposit.
  //  - "sell"      — TWAP-style sell each token in N chunks with a delay so
  //                a chunky bag doesn't tank the price on the way out.
  //  - "sol-only"  — sweep just SOL, leave tokens in the session/subs (for
  //                people who want to keep bumping later).
  type SweepMode = "transfer" | "sell" | "sol-only";
  const [sweepMode, setSweepMode] = useState<SweepMode>("transfer");
  // Reusable guard shown before any flow that would destroy a vault key
  // (regenerate session, resize sub-wallets, forget sub-wallets). Holds
  // a config object describing what's at risk + what to do on each path.
  const [regenGuard, setRegenGuard] = useState<RegenerateGuardConfig | null>(null);
  // The 3-option sweep-mode picker is overwhelming for new users. Default to
  // collapsed so the prominent "send everything home" button is the obvious
  // path; power users can expand for sell-to-SOL / SOL-only variants.
  const [sweepAdvancedOpen, setSweepAdvancedOpen] = useState(false);
  // Sell-mode preset and custom knobs. "balanced" is what most users want.
  type TwapPreset = "fast" | "balanced" | "slow" | "custom";
  const [twapPreset, setTwapPreset] = useState<TwapPreset>("balanced");
  const [twapChunks, setTwapChunks] = useState("5");
  const [twapDelaySec, setTwapDelaySec] = useState("30");
  // "Push tokens INTO sub-wallets" form — inverse of sweep. Lets the user
  // hold tokens in their main Phantom wallet (after a transfer-sweep), and
  // later redistribute them across the session + sub-wallets so they can
  // TWAP-sell from many addresses (more organic, less price impact than
  // one giant sell from the main wallet).
  const [distTokenMint, setDistTokenMint] = useState("");
  const [distTokenPercent, setDistTokenPercent] = useState("100");
  // The push-tokens panel is an advanced disbursement flow most users won't
  // touch on every visit. Collapse by default so the surrounding sub-wallet
  // controls aren't drowned out, and so the header button itself acts as
  // clear, prominent signage that the feature exists.
  const [pushTokensExpanded, setPushTokensExpanded] = useState(false);
  // Generation form
  const [persistOnDevice, setPersistOnDevice] = useState(true);
  const [genPass, setGenPass] = useState("");
  const [genPass2, setGenPass2] = useState("");
  // Unlock form
  const [unlockPass, setUnlockPass] = useState("");
  // Dedicated passphrase field for the Sub-wallets card. Kept separate from
  // genPass/unlockPass (which are cleared as soon as the session is created
  // or unlocked) so the Generate button doesn't lock itself out the moment
  // the user finishes session setup.
  const [subPass, setSubPass] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);

  // ── Derived (storage-free) mode ──────────────────────────────────────────
  // Alternative to the encrypted-vault flow: keys are derived from a single
  // Phantom signature on every device. Nothing sensitive is ever stored.
  // See lib/derived-wallets.ts for the crypto + threat-model details.
  const [derivedConfig, setDerivedConfig] = useState<DerivedConfig | null>(
    () => readDerivedConfig(),
  );
  const [derivedBusy, setDerivedBusy] = useState<null | "derive" | "restore" | "resize" | "exit">(null);
  // Default 5 subs for new users — covers most rotation needs without
  // overwhelming the Phantom-signing UI on first run.
  const [derivedSubCountInput, setDerivedSubCountInput] = useState("5");
  // Distinguishes keys loaded via derive vs via legacy vault unlock so we
  // can hide vault-only UI when in derived mode + know what to clear.
  const [inDerivedMode, setInDerivedMode] = useState(false);

  // ── Sub-wallets (additional rotated burners) ─────────────────────────────
  // The primary session wallet is always slot 0. Sub-wallets are extras the
  // bot rotates through to spread activity across multiple addresses.
  // - `subKeypairs` is in-memory only; populated when the user generates new
  //   sub-wallets or unlocks existing ones with the session passphrase.
  // - `subPubkeysFromVault` reads pubkeys from the encrypted bundle so we
  //   can show counts/addresses before unlock.
  const [subKeypairs, setSubKeypairs] = useState<Keypair[]>([]);
  const [subWalletsBusy, setSubWalletsBusy] =
    useState<null | "generate" | "unlock" | "distribute" | "sweep">(null);
  const [subWalletCount, setSubWalletCount] = useState("3");
  const [subPubkeysFromVault, setSubPubkeysFromVault] = useState<string[]>(
    () => subWalletPublicKeys()
  );
  const [hasSubVault, setHasSubVault] = useState<boolean>(() => subWalletsExist());
  // Which unlock mode the stored vault uses ("passphrase" or "signature").
  // null when there is no vault yet — we'll pick a default based on whether a
  // wallet is connected at generate-time.
  const [subVaultMode, setSubVaultMode] = useState<SubWalletUnlockMode | null>(
    () => subWalletUnlockModeStored()
  );
  // Pubkey of the wallet that signed the unlock message for the current vault
  // (signature mode only). Drives the "connect wallet X to unlock" hint.
  const [subVaultSigner, setSubVaultSigner] = useState<string | null>(
    () => subWalletSignerPubkey()
  );
  // Which mode the user wants to use when GENERATING a new vault. Defaults
  // to "signature" when a wallet is connected (one-tap, no typing) and falls
  // back to "passphrase" otherwise.
  const [genMode, setGenMode] = useState<SubWalletUnlockMode>("signature");
  // Whether the user clicked "use a passphrase instead" to reveal the
  // passphrase generation form even when a wallet is connected.
  const [showPassphraseGen, setShowPassphraseGen] = useState(false);
  // Migration UI: when a vault is in passphrase mode and a wallet is
  // connected, we surface a one-time prompt to switch to signature unlock.
  const [migratePass, setMigratePass] = useState("");
  const [showMigratePrompt, setShowMigratePrompt] = useState(false);

  // Main wallet's SPL token holdings — feeds the "push tokens into subs"
  // dropdown. Direct RPC for the balances, then a single Helius DAS
  // `getAssetBatch` call to enrich with symbol + name so users see
  // recognizable tokens (e.g. "PAIF · Pump AI Fun") instead of an
  // intimidating raw mint they have no way to identify.
  type MainTokenHolding = {
    mint: string; amount: string; uiAmount: number; decimals: number;
    // Which token program (SPL v1 vs Token-2022) owns this mint's accounts.
    // Required for distributeTokenToWallets so it can derive ATAs and emit
    // transfer instructions under the correct program — new pump.fun
    // launches mint under Token-2022 and silently fail without this.
    tokenProgram: "spl" | "token-2022";
    symbol?: string; name?: string;
  };
  const { data: mainTokens = [], refetch: refetchMainTokens, isLoading: mainTokensLoading } = useQuery<MainTokenHolding[]>({
    queryKey: ['main-token-holdings', publicKey?.toBase58() ?? ''],
    enabled: !!publicKey,
    staleTime: 30_000,
    queryFn: async () => {
      if (!publicKey) return [];
      try {
        // Query BOTH SPL v1 and Token-2022 — new pump.fun launches mint
        // under Token-2022, legacy ones use SPL v1. Without this, recent
        // buys appear invisible on the holdings list.
        const [splV1, tok22] = await Promise.all([
          connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID }, "confirmed"),
          connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_2022_PROGRAM_ID }, "confirmed"),
        ]);
        const tagAccounts = (accs: any[], tp: "spl" | "token-2022") => accs.map(acc => {
          const info = (acc.account.data as any).parsed?.info;
          return {
            mint: info?.mint as string,
            amount: info?.tokenAmount?.amount as string,
            uiAmount: (info?.tokenAmount?.uiAmount as number) ?? 0,
            decimals: info?.tokenAmount?.decimals as number,
            tokenProgram: tp,
          };
        });
        const holdings: MainTokenHolding[] = [
          ...tagAccounts(splV1.value, "spl"),
          ...tagAccounts(tok22.value, "token-2022"),
        ].filter(t => t.mint && t.amount && t.amount !== "0" && typeof t.decimals === "number");

        if (holdings.length === 0) return holdings;

        // Best-effort metadata enrichment. Failure is non-fatal — user just
        // sees the truncated mint as before. Helius is rate-limited so we
        // batch through the server-side metadata endpoint.
        try {
          const ids = holdings.map(h => h.mint);
          const byMint = await fetchAssetMetadata(ids);
          return holdings.map(h => ({ ...h, ...byMint[h.mint] }));
        } catch {
          return holdings;
        }
      } catch {
        return [];
      }
    },
  });

  // Aggregated token holdings across the WHOLE pool (session wallet + every
  // unlocked sub-wallet). This is the answer to "I ran auto-buy a bunch but
  // I can't see what I'm holding" — the tokens never went to the main
  // wallet, they went to the sub-wallets, so we surface them here.
  // Sub-wallets must be unlocked (subKeypairs populated) — we don't poll
  // public-key-only vaults because users may have many subs they don't
  // want to expose via RPC unless they've opened the pool this session.
  type PoolTokenHolding = {
    mint: string;
    totalAmount: string;       // base units, BigInt-as-string
    totalUiAmount: number;     // already converted, safe for display only
    decimals: number;
    walletCount: number;       // how many wallets in the pool hold this mint
    symbol?: string;
    name?: string;
  };
  const poolPubkeys = useMemo(() => {
    const list: string[] = [];
    if (sessionKeypair) list.push(sessionKeypair.publicKey.toBase58());
    for (const kp of subKeypairs) list.push(kp.publicKey.toBase58());
    return list;
  }, [sessionKeypair, subKeypairs]);
  const { data: poolTokens = [], refetch: refetchPoolTokens, isFetching: poolTokensFetching } = useQuery<PoolTokenHolding[]>({
    queryKey: ['pool-token-holdings', poolPubkeys.join(',')],
    enabled: poolPubkeys.length > 0,
    staleTime: 20_000,
    queryFn: async () => {
      if (poolPubkeys.length === 0) return [];
      // Per-mint accumulator. BigInt math — float drift on 9-decimal mints
      // could mis-display totals by enough to confuse users when sub-wallet
      // count gets large.
      const byMint = new Map<string, { amount: bigint; decimals: number; walletCount: number }>();
      const owners = poolPubkeys.map(p => new PublicKey(p));
      const results = await Promise.allSettled(
        owners.flatMap(owner => [
          connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, "confirmed"),
          connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, "confirmed"),
        ]),
      );
      // We pair results back to owners via index ÷ 2 so per-wallet dedup
      // (one mint counted once even if user has 2 token accounts for it,
      // which can happen) still tracks "wallets holding".
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status !== "fulfilled") continue;
        const ownerIdx = Math.floor(i / 2);
        const seenThisOwner = new Set<string>();
        for (const acc of r.value.value) {
          const info = (acc.account.data as any).parsed?.info;
          const mint = info?.mint as string | undefined;
          const amountStr = info?.tokenAmount?.amount as string | undefined;
          const decimals = info?.tokenAmount?.decimals as number | undefined;
          if (!mint || !amountStr || amountStr === "0" || decimals === undefined) continue;
          const entry = byMint.get(mint) ?? { amount: 0n, decimals, walletCount: 0 };
          entry.amount += BigInt(amountStr);
          if (!seenThisOwner.has(mint + "@" + ownerIdx)) {
            entry.walletCount += 1;
            seenThisOwner.add(mint + "@" + ownerIdx);
          }
          byMint.set(mint, entry);
        }
      }
      const holdings: PoolTokenHolding[] = [];
      for (const [mint, v] of byMint.entries()) {
        const factor = Math.pow(10, v.decimals);
        holdings.push({
          mint,
          totalAmount: v.amount.toString(),
          totalUiAmount: Number(v.amount) / factor,
          decimals: v.decimals,
          walletCount: v.walletCount,
        });
      }
      // Sort by ui amount desc so the biggest bag is on top — matches what
      // a user would scan visually.
      holdings.sort((a, b) => b.totalUiAmount - a.totalUiAmount);
      if (holdings.length === 0) return holdings;

      // Same metadata enrichment as main-token-holdings.
      try {
        const ids = holdings.map(h => h.mint);
        const byId = await fetchAssetMetadata(ids);
        return holdings.map(h => ({ ...h, ...byId[h.mint] }));
      } catch { return holdings; }
    },
  });
  // Per-mint busy state for the pool-holdings action buttons. Mint string =
  // "sell" or "transfer" action in flight; null = idle. Independent from
  // global `subWalletsBusy` so e.g. a "Refresh balances" call doesn't
  // disable the per-row buttons mid-run.
  const [poolMintBusy, setPoolMintBusy] = useState<{ mint: string; action: "sell" | "transfer" } | null>(null);

  const [subBalances, setSubBalances] = useState<Record<string, number>>({}); // pubkey → lamports

  // At-a-glance summary of the sub-wallet pool: how many subs exist on THIS
  // device, how many still hold SOL, how many are empty, and the total SOL
  // sitting across them. Token-account rent isn't summed here (we'd need a
  // per-account count) — the cash-out / regenerate-guard flow surfaces that.
  const subWalletSummary = useMemo(() => {
    const pubs = subKeypairs.length > 0
      ? subKeypairs.map(k => k.publicKey.toBase58())
      : subPubkeysFromVault;
    let funded = 0;
    let totalLamports = 0;
    for (const p of pubs) {
      const l = subBalances[p] ?? 0;
      if (l > 0) funded++;
      totalLamports += l;
    }
    return {
      total: pubs.length,
      funded,
      empty: pubs.length - funded,
      totalSol: totalLamports / LAMPORTS_PER_SOL,
      balancesKnown: Object.keys(subBalances).length > 0,
    };
  }, [subKeypairs, subPubkeysFromVault, subBalances]);

  // Funding amount per sub-wallet when distributing from primary
  const [perSubFundAmount, setPerSubFundAmount] = useState("0.02");
  // Funding mode: "manual" = user types SOL each; "auto" = user gives a max
  // total budget (in SOL) and we split it across the funded subs, leaving a
  // small gas buffer in primary so the distribute tx itself can pay fees.
  // Default to Auto so first-time users get the smart-budget flow.
  const [fundMode, setFundMode] = useState<"manual" | "auto">("auto");
  const [autoTotalBudget, setAutoTotalBudget] = useState("0.1");
  // Manual sub-mode — "fixed" (same SOL each) or "range" (random per sub).
  const [manualMode, setManualMode] = useState<"fixed" | "range">("fixed");
  const [perSubFundMin, setPerSubFundMin] = useState("0.01");
  const [perSubFundMax, setPerSubFundMax] = useState("0.05");
  // Per-sub random allocation in lamports — used by both Auto (split a total
  // budget unevenly) and Manual-Range (each sub gets a random amount in the
  // given window). Stored as state so the preview is stable across renders;
  // re-rolled by the user via "🎲 Re-roll" or auto when budget/N changes.
  const [randomAllocLamports, setRandomAllocLamports] = useState<number[]>([]);
  const [randomAllocSeed, setRandomAllocSeed] = useState(0);

  // Auto-refill: while the bot is running, periodically check sub-wallet
  // balances and top up any that drop below `autoRefillThreshold` from the
  // session wallet. Bounded by `autoRefillHourlyCapSol` so a runaway can't
  // drain the session. Default ON so the "set it and forget it" experience
  // works without the user discovering this knob.
  const [autoRefillEnabled, setAutoRefillEnabled] = useState(true);

  // ── Auto-forward after each buy ────────────────────────────────────────
  // When enabled, every successful buy bump immediately ships the just-
  // bought tokens from the buyer sub/session wallet to one or more user-
  // chosen destinations. Rows are persistent per session. Empty addr =
  // "use the connected wallet" (resolved at fire time). Percents must sum
  // to 100. Up to 3 destinations supported — tx size cap (1232b) easily
  // fits 3 × (idempotent-ATA + transferChecked) so no batching needed.
  //
  // Honest tradeoff disclosed in the UI: every forward links the sub-wallet
  // to the destination on-chain, which partially undoes the "looks like
  // many different traders" benefit of using sub-wallets at all.
  const [autoForwardEnabled, setAutoForwardEnabled] = useState(false);
  const [autoForwardRows, setAutoForwardRows] = useState<Array<{ addr: string; pct: string }>>([
    { addr: "", pct: "100" },
  ]);
  const [autoRefillThreshold, setAutoRefillThreshold] = useState("0.005");
  const [autoRefillHourlyCapSol, setAutoRefillHourlyCapSol] = useState("0.5");
  // Tracks SOL spent on refills inside the current rolling 1-hour window so
  // we can hard-stop when the user's safety cap is hit. Lives in state so
  // the UI can show "Refilled X SOL this hour".
  const [refilledThisHourLamports, setRefilledThisHourLamports] = useState(0);
  const refillWindowStartRef = useRef<number>(Date.now());
  const refillBusyRef = useRef(false);
  // Last time we surfaced a refill-failure toast — throttles error noise so
  // a flapping RPC can't spam the user every 45s. 5-minute cooldown.
  const lastRefillFailToastRef = useRef<number>(0);

  // ── Runtime state ────────────────────────────────────────────────────────
  const [botState, setBotState] = useState<BotState>("idle");
  const [countdown, setCountdown] = useState(0);
  const [bumpCount, setBumpCount] = useState(0);
  const [bumpLog, setBumpLog] = useState<BumpLog[]>([]);
  const [currentlyBumping, setCurrentlyBumping] = useState(false);

  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const bumpIdRef = useRef(0);
  const botStateRef = useRef<BotState>("idle");
  botStateRef.current = botState;
  const bumpLockRef = useRef(false);   // sync re-entrancy gate
  // Tracks which wallet signed the last bump so random-mode can avoid
  // immediate repeats (which would defeat the whole point of randomizing).
  const lastWalletIndexRef = useRef<number>(-1);
  // Monotonic counter that drives BOTH wallet rotation and cycling-list
  // amount selection. Lives in a ref because it must remain authoritative
  // across async timer callbacks (using bumpCount state instead would
  // capture stale values inside long-lived setInterval/setTimeout closures
  // and break rotation).
  const bumpIndexRef = useRef(0);
  // Mutable holder for the latest runNextBump implementation. Updated on
  // every render so timers always invoke the freshest closure (with current
  // amountMode/maxBumps/walletPool/etc.) rather than a stale snapshot.
  const runNextBumpRef = useRef<() => Promise<void>>(async () => {});

  const addLog = useCallback((entry: Omit<BumpLog, "id">) => {
    bumpIdRef.current += 1;
    setBumpLog(prev => [{ ...entry, id: bumpIdRef.current }, ...prev].slice(0, 50));
  }, []);

  // ── Derived values ───────────────────────────────────────────────────────
  const intervalSecs = customDelay.enabled
    ? Math.max(15, (parseInt(customDelay.h) || 0) * 3600 + (parseInt(customDelay.m) || 0) * 60 + (parseInt(customDelay.s) || 0))
    : delayPreset;

  /**
   * Compute the actual delay used to schedule the NEXT bump. When jitter is
   * enabled, multiplies `intervalSecs` by a uniform random factor in the band
   * [1 - p, 1 + p] where p = jitterPct / 100, then floors at 15s so we never
   * undercut the rate-limit safeguard. Called fresh per-bump so two bumps in
   * a row never wait identical amounts.
   */
  function nextDelaySecs(): number {
    if (!jitterEnabled) return intervalSecs;
    const pct = Math.max(0, Math.min(75, parseInt(jitterPct) || 0)) / 100;
    if (pct === 0) return intervalSecs;
    const factor = 1 + (Math.random() * 2 - 1) * pct;
    return Math.max(15, Math.round(intervalSecs * factor));
  }

  const addrValid = tokenAddress.length > 30 && isPumpToken(tokenAddress);
  const amountValid = bumpAction === "buy"
    ? parseFloat(solPerBump) >= 0.001 && parseFloat(solPerBump) <= 10
    : parseFloat(tokensPerSell) > 0;
  const maxValid = parseInt(maxBumps) >= 1 && parseInt(maxBumps) <= 1000;
  const slipNum = Number(slippage);
  const slippageValid = Number.isFinite(slipNum) && slipNum >= 1 && slipNum <= 50;

  const usingSession = signMode === "session";
  // Per-bump cost the session wallet must cover up-front. For buys this is
  //   principal + 4% PAIF platform fee + 1% pump.fun fee + gas headroom.
  // For sells the fees are paid from the SOL credited atomically by the swap,
  // so we only need gas headroom in the session wallet.
  //
  // GAS_HEADROOM covers base sig (5k) + dynamic priority fee (varies with
  // Solana congestion, fetched from /api/network/fee-estimate) + ATA rent
  // buffer. The user's signing wallet pays this on-chain — we do not
  // subsidize. We hold the live estimate in a small piece of state below so
  // congestion spikes immediately raise the per-bump preflight floor and the
  // bot won't try to fire a sub-wallet that's now under-funded.
  const [liveGasHeadroomLamports, setLiveGasHeadroomLamports] = useState<number>(50_000);
  const GAS_HEADROOM_LAMPORTS = Math.max(50_000, liveGasHeadroomLamports);
  const PAIF_TOTAL_BPS = 400;            // 3% DAO + 1% creator (server-enforced)
  const PUMP_BPS = 100;                  // pump.fun bonding-curve fee
  // Solana rejects any transaction that leaves the fee-payer (account index 0)
  // with a NON-ZERO balance below the rent-exempt minimum for a basic system
  // account (~890,880 lamports ≈ 0.00089 SOL). A buy that spends almost the
  // entire wallet strands it in this forbidden "rent-paying" state, so the
  // whole tx fails simulation with "insufficient funds for rent". We reserve
  // this floor (plus a small margin) ON TOP OF principal+fees+gas so the bot
  // never attempts a buy that would drop the signing wallet below exemption.
  // Buys only — sells credit SOL atomically and can't strand the fee-payer.
  const RENT_EXEMPT_RESERVE_LAMPORTS = 900_000;
  const perBumpRequiredLamports = bumpAction === "buy"
    ? Math.ceil((parseFloat(solPerBump) || 0) * 1e9 * (10000 + PAIF_TOTAL_BPS + PUMP_BPS) / 10000) + GAS_HEADROOM_LAMPORTS + RENT_EXEMPT_RESERVE_LAMPORTS
    : GAS_HEADROOM_LAMPORTS;
  const sessionReady = !!sessionKeypair && sessionBalance >= perBumpRequiredLamports;

  // ── Variable-amount validation + helpers ─────────────────────────────────
  // Parse the comma/whitespace separated SOL list into clean numbers.
  const parsedSolList: number[] = solList
    .split(/[,\s]+/)
    .map(s => parseFloat(s.trim()))
    .filter(n => Number.isFinite(n) && n > 0);

  const rangeMinNum = parseFloat(solRangeMin);
  const rangeMaxNum = parseFloat(solRangeMax);

  const amountModeValid = bumpAction === "sell"
    ? true                                            // sell uses fixed tokensPerSell
    : amountMode === "fixed"
      ? parseFloat(solPerBump) >= 0.001 && parseFloat(solPerBump) <= 10
      : amountMode === "range"
        ? rangeMinNum >= 0.001 && rangeMaxNum >= rangeMinNum && rangeMaxNum <= 10
        : parsedSolList.length > 0 && parsedSolList.every(n => n >= 0.001 && n <= 10);

  /** The largest SOL spend the bot might attempt — drives funding gates. */
  const maxBumpSol = bumpAction === "sell" ? 0
    : amountMode === "fixed" ? (parseFloat(solPerBump) || 0)
    : amountMode === "range" ? Math.max(rangeMinNum || 0, rangeMaxNum || 0)
    : parsedSolList.length ? Math.max(...parsedSolList) : 0;

  /** The smallest SOL spend the bot might attempt — drives "is this wallet
   * usable AT ALL" gates. A wallet that can cover the min bump can still be
   * picked by rotation; per-bump preflight will skip it for larger amounts. */
  const minBumpSol = bumpAction === "sell" ? 0
    : amountMode === "fixed" ? (parseFloat(solPerBump) || 0)
    : amountMode === "range" ? Math.min(rangeMinNum || 0, rangeMaxNum || 0)
    : parsedSolList.length ? Math.min(...parsedSolList) : 0;

  /** Worst-case lamports a single sub/primary wallet must hold to attempt the
   *  largest possible bump. Used by the "session wallet ready?" gate. */
  const maxPerBumpRequiredLamports = bumpAction === "buy"
    ? Math.ceil(maxBumpSol * 1e9 * (10000 + PAIF_TOTAL_BPS + PUMP_BPS) / 10000) + GAS_HEADROOM_LAMPORTS + RENT_EXEMPT_RESERVE_LAMPORTS
    : GAS_HEADROOM_LAMPORTS;

  /** Best-case lamports a wallet needs to fire AT LEAST ONE bump (the smallest
   *  amount in the chosen mode). Used by the unfunded-subs warning + the
   *  runtime rotation eligibility filter so wallets with modest funding still
   *  count as usable — the per-bump dice roll handles the rest. */
  const minPerBumpRequiredLamports = bumpAction === "buy"
    ? Math.ceil(minBumpSol * 1e9 * (10000 + PAIF_TOTAL_BPS + PUMP_BPS) / 10000) + GAS_HEADROOM_LAMPORTS + RENT_EXEMPT_RESERVE_LAMPORTS
    : GAS_HEADROOM_LAMPORTS;

  /**
   * Apply a quick-mode preset: bulk-set sub-wallet count + amount config in
   * one batched render. "custom" is a no-op (just unhides the manual controls).
   */
  function applyPreset(preset: BotPreset) {
    setBotPreset(preset);
    if (preset === "custom") return;
    const cfg = BOT_PRESETS[preset];
    setAmountMode(cfg.amountMode);
    if (cfg.solPerBump  !== undefined) setSolPerBump(cfg.solPerBump);
    if (cfg.solRangeMin !== undefined) setSolRangeMin(cfg.solRangeMin);
    if (cfg.solRangeMax !== undefined) setSolRangeMax(cfg.solRangeMax);
    if (cfg.solList     !== undefined) setSolList(cfg.solList);
    setSubWalletCount(String(cfg.subCount));
  }

  /** Returns the SOL amount for a given bump index based on the current mode. */
  function pickAmountSol(bumpIndex: number): number {
    if (amountMode === "fixed") return parseFloat(solPerBump) || 0;
    if (amountMode === "range") {
      const lo = Math.min(rangeMinNum, rangeMaxNum);
      const hi = Math.max(rangeMinNum, rangeMaxNum);
      const r = lo + Math.random() * (hi - lo);
      // Round to 6 decimals to keep lamport math clean
      return Math.round(r * 1e6) / 1e6;
    }
    // list — cycle in order, wrap around
    if (parsedSolList.length === 0) return 0;
    return parsedSolList[bumpIndex % parsedSolList.length];
  }

  /** Pool of signing wallets the bot rotates through. Slot 0 = primary session wallet. */
  const walletPool: Keypair[] = sessionKeypair
    ? [sessionKeypair, ...subKeypairs]
    : [];

  /**
   * Returns which wallet in the pool should sign bump #`bumpIndex`.
   *
   * Two modes:
   *   - Random (default): pick a uniformly-random wallet, but never the same
   *     one we just used (when pool has 2+ wallets). This is what makes the
   *     trades look organic on pump.fun's recent-trades feed and on dex
   *     screener — buys appear from a shuffled mix of distinct wallets
   *     instead of N-in-a-row from the same address.
   *   - Sequential: each wallet handles `bumpsPerWallet` consecutive bumps
   *     before the baton passes. With 3 wallets and bumpsPerWallet=6, bumps
   *     0–5 come from wallet A, 6–11 from wallet B, etc. Set bumpsPerWallet=1
   *     for strict round-robin.
   */
  function pickWalletIndex(
    bumpIndex: number,
    poolSize: number,
    eligibleIdxs?: number[],
  ): number {
    if (poolSize <= 1) return 0;
    if (randomizeWallets) {
      // In random mode, only roll across wallets that actually have enough
      // SOL to pay for the next bump — otherwise the dice keep landing on
      // unfunded subs that just throw "underfunded" errors, and the user
      // sees zero on-chain rotation. If nothing is eligible (caller didn't
      // filter), fall back to the full pool.
      const candidates =
        eligibleIdxs && eligibleIdxs.length > 0
          ? eligibleIdxs
          : Array.from({ length: poolSize }, (_, i) => i);
      const last = lastWalletIndexRef.current;
      // Avoid immediate repeats when there's more than one eligible wallet
      // — that's what makes the rotation visible on dex screener.
      const filtered =
        candidates.length > 1 ? candidates.filter(i => i !== last) : candidates;
      const idx = filtered[Math.floor(Math.random() * filtered.length)];
      lastWalletIndexRef.current = idx;
      return idx;
    }
    const stride = Math.max(1, parseInt(bumpsPerWallet) || 1);
    const idx = Math.floor(bumpIndex / stride) % poolSize;
    lastWalletIndexRef.current = idx;
    return idx;
  }

  /** True when, in session mode, AT LEAST ONE wallet in the rotation pool
   *  (primary session + subs) holds enough lamports to attempt the smallest
   *  bump in the chosen amount mode. Per-bump preflight will skip individual
   *  signers that can't cover that particular dice roll — we just need one
   *  funded wallet to enable the Start button. This means after auto-funding
   *  subs (which can drain the primary near-zero), the bot still launches
   *  because the subs can carry the load. */
  const anyPoolWalletReady =
    sessionBalance >= minPerBumpRequiredLamports
    || subKeypairs.some(kp => (subBalances[kp.publicKey.toBase58()] ?? 0) >= minPerBumpRequiredLamports);
  const sessionReadyVar = !!sessionKeypair && anyPoolWalletReady;

  const canStart = addrValid && amountModeValid && (bumpAction === "sell" ? amountValid : true)
    && maxValid && slippageValid && connected && publicKey
    && (!usingSession || sessionReadyVar);

  // Single source of truth for "why is the Start button disabled" — surfaced
  // BELOW the button (instead of replacing its label) so the user always sees
  // a clear "Start Bumping" CTA + a red note explaining what's missing. The
  // button stays disabled via `canStart`; this is purely diagnostic copy.
  const startBlocker: string | null = (() => {
    if (!connected || !publicKey)      return "Connect Wallet to Start";
    if (!addrValid)                    return "Paste a Pump.fun token address";
    if (!amountModeValid)              return bumpAction === "buy"
                                              ? "Set a valid SOL amount"
                                              : "Set a valid token amount to sell";
    if (bumpAction === "sell" && !amountValid) return "Set tokens-per-sell";
    if (!maxValid)                     return "Set max bumps (1–1000)";
    if (!slippageValid)                return "Set slippage (1–50%)";
    if (usingSession && !sessionKeypair) return hasVault
                                              ? "Unlock session wallet first"
                                              : "Generate session wallet first";
    if (usingSession && !sessionReadyVar) return "Fund session or sub-wallets first";
    return null;
  })();

  // Approx total cost shown in the summary card. With variable modes this is
  // an upper bound (range = max × N, list = max-of-list × N).
  const avgBumpSol = bumpAction === "sell" ? 0
    : amountMode === "fixed" ? (parseFloat(solPerBump) || 0)
    : amountMode === "range" ? ((rangeMinNum + rangeMaxNum) / 2 || 0)
    : parsedSolList.length ? (parsedSolList.reduce((a, b) => a + b, 0) / parsedSolList.length) : 0;
  const totalCost = avgBumpSol * (parseInt(maxBumps) || 0);

  // ── Session wallet helpers ───────────────────────────────────────────────
  const refreshSessionBalance = useCallback(async () => {
    if (!sessionKeypair) return;
    try {
      // Query BOTH SPL v1 and Token-2022 — new pump.fun launches mint
      // under TokenzQd…, so a single-program count silently hides recent
      // buys from the session-wallet status display.
      const countNonZero = (programId: PublicKey) =>
        connection.getParsedTokenAccountsByOwner(sessionKeypair.publicKey, { programId })
          .then(r => r.value.filter(a => {
            const amt = a.account.data.parsed?.info?.tokenAmount?.uiAmount;
            return typeof amt === "number" && amt > 0;
          }).length)
          .catch(() => 0);
      const [bal, splV1, tok22] = await Promise.all([
        connection.getBalance(sessionKeypair.publicKey),
        countNonZero(new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")),
        countNonZero(new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")),
      ]);
      setSessionBalance(bal);
      setSessionTokens(splV1 + tok22);
    } catch { /* ignore */ }
  }, [sessionKeypair, connection]);

  // Refresh session balance on mount + whenever a bump succeeds
  useEffect(() => {
    if (!sessionKeypair) return;
    refreshSessionBalance();
    const t = setInterval(refreshSessionBalance, 15_000);
    return () => clearInterval(t);
  }, [sessionKeypair, refreshSessionBalance]);

  async function generateSession() {
    if (persistOnDevice) {
      if (genPass.length < 6) {
        toast({ title: "Passphrase too short", description: "Use at least 6 characters.", variant: "destructive" });
        return;
      }
      if (genPass !== genPass2) {
        toast({ title: "Passphrases don't match", description: "Re-enter the same passphrase in both fields.", variant: "destructive" });
        return;
      }
    }
    setSessionBusy("generate");
    try {
      const kp = Keypair.generate();
      if (persistOnDevice) {
        await saveToVault(kp.secretKey, kp.publicKey.toBase58(), genPass);
        setHasVault(true);
        setSavedPubkey(kp.publicKey.toBase58());
      }
      setSessionKeypair(kp);
      setSessionBalance(0);
      setShowSessionKey(false);
      setGenPass(""); setGenPass2("");
      toast({
        title: persistOnDevice ? "Session wallet saved on this device" : "Session wallet generated (in-memory only)",
        description: persistOnDevice
          ? "Fund it once. After a refresh, just unlock with your passphrase — no funds lost."
          : "Refreshing this tab destroys the key. Save the private key before you leave.",
      });
    } catch (err: any) {
      toast({ title: "Could not save", description: err?.message || "Vault encryption failed.", variant: "destructive" });
    } finally {
      setSessionBusy(null);
    }
  }

  async function unlockSession() {
    setUnlockError(null);
    if (!unlockPass) {
      setUnlockError("Enter your passphrase");
      return;
    }
    setSessionBusy("unlock");
    try {
      const secret = await unlockVault(unlockPass);
      const kp = Keypair.fromSecretKey(secret);
      setSessionKeypair(kp);
      setSessionBalance(0);
      setShowSessionKey(false);
      setUnlockPass("");
      toast({ title: "Session wallet unlocked", description: "Ready to bump." });
    } catch (err: any) {
      setUnlockError(err?.message || "Wrong passphrase");
    } finally {
      setSessionBusy(null);
    }
  }

  /**
   * Ask the connected wallet to sign the canonical SESSION-vault unlock
   * message. Mirrors the sub-wallet helper but with a different message so
   * a signature collected for one purpose can't unlock the other.
   */
  async function signSessionVaultUnlockMessage(): Promise<{ sig: Uint8Array; signer: string }> {
    if (!publicKey) throw new Error("Connect your wallet first");
    if (!signMessage) throw new Error("Your wallet does not support message signing");
    const signer = publicKey.toBase58();
    const message = sessionVaultUnlockMessage(signer);
    const sig = await signMessage(new TextEncoder().encode(message));
    if (!sig || sig.length !== 64) {
      throw new Error("Wallet returned an unexpected signature (expected 64 bytes)");
    }
    return { sig, signer };
  }

  /**
   * Generate a new session wallet and persist it in SIGNATURE mode. One
   * Phantom tap, no passphrase.
   */
  async function generateSessionWithSignature() {
    if (!publicKey || !signMessage) {
      toast({ title: "Wallet required", description: "Connect your wallet to use one-tap unlock.", variant: "destructive" });
      return;
    }
    setSessionBusy("generate");
    try {
      const { sig, signer } = await signSessionVaultUnlockMessage();
      const kp = Keypair.generate();
      await saveToVaultWithSignature(kp.secretKey, kp.publicKey.toBase58(), sig, signer);
      setHasVault(true);
      setSavedPubkey(kp.publicKey.toBase58());
      setSessionVaultMode("signature");
      setSessionVaultSigner(signer);
      setSessionKeypair(kp);
      setSessionBalance(0);
      setShowSessionKey(false);
      toast({
        title: "Session wallet created",
        description: "Locked with your wallet — no passphrase to remember.",
      });
    } catch (err: any) {
      toast({ title: "Could not save", description: err?.message || "Vault encryption failed.", variant: "destructive" });
    } finally {
      setSessionBusy(null);
    }
  }

  /**
   * Unlock a signature-mode session vault by re-signing the unlock message.
   */
  async function unlockSessionWithSignature() {
    setUnlockError(null);
    if (!publicKey || !signMessage) {
      setUnlockError("Connect the wallet that created this session to unlock");
      return;
    }
    setSessionBusy("unlock");
    try {
      const { sig, signer } = await signSessionVaultUnlockMessage();
      const secret = await unlockVaultWithSignature(sig, signer);
      const kp = Keypair.fromSecretKey(secret);
      setSessionKeypair(kp);
      setSessionBalance(0);
      setShowSessionKey(false);
      toast({ title: "Session wallet unlocked", description: "One tap — ready to bump." });
    } catch (err: any) {
      setUnlockError(err?.message || "Could not unlock with this wallet");
    } finally {
      setSessionBusy(null);
    }
  }

  /**
   * Migrate an existing passphrase session vault to signature mode. User
   * types the passphrase one last time; we re-encrypt under a wallet key.
   * Session pubkey + secret are preserved — balances/tokens unaffected.
   */
  async function migrateSessionToSignature() {
    if (!sessionMigratePass) {
      toast({ title: "Passphrase required", description: "Type your current passphrase to switch unlock modes.", variant: "destructive" });
      return;
    }
    if (!publicKey || !signMessage) {
      toast({ title: "Wallet required", description: "Connect the wallet you want to bind to this session.", variant: "destructive" });
      return;
    }
    setSessionBusy("unlock");
    try {
      const { sig, signer } = await signSessionVaultUnlockMessage();
      await migrateSessionVaultToSignature(sessionMigratePass, sig, signer);
      setSessionVaultMode("signature");
      setSessionVaultSigner(signer);
      setSessionMigratePass("");
      setShowSessionMigratePrompt(false);
      // Also unlock for the user since they've already done the work.
      const secret = await unlockVaultWithSignature(sig, signer);
      const kp = Keypair.fromSecretKey(secret);
      setSessionKeypair(kp);
      setSessionBalance(0);
      toast({ title: "One-tap unlock enabled", description: "Future unlocks just need one Phantom tap." });
    } catch (err: any) {
      toast({ title: "Could not switch unlock mode", description: err?.message || "Unknown error", variant: "destructive" });
    } finally {
      setSessionBusy(null);
    }
  }

  function clearSession() {
    // Hard block while a bump is in flight — the in-flight tx still holds a reference
    // to this keypair; clearing here would orphan funds that land moments later.
    if (currentlyBumping || bumpLockRef.current || isRunning) {
      toast({
        title: "Stop the bot first",
        description: "A bump may still be in flight. Stop the bot and wait for it to finish, then lock.",
        variant: "destructive",
      });
      return;
    }
    // If the wallet has a persisted vault, "Lock" just drops the in-memory key.
    // Funds and tokens are safe — user can unlock again with passphrase.
    if (hasVault) {
      setSessionKeypair(null);
      setSessionBalance(0);
      setSessionTokens(0);
      setShowSessionKey(false);
      toast({
        title: "Locked",
        description: sessionVaultMode === "signature"
          ? "Saved on this device — tap Unlock with Phantom to use again."
          : "Saved on this device — unlock with your passphrase to use again.",
      });
      return;
    }
    // Ephemeral mode: clearing actually destroys the key. Strict guards.
    if (sessionBalance > 10_000) {
      toast({
        title: "Sweep first",
        description: "Session wallet still has SOL. Use Sweep before clearing or you may lose the funds.",
        variant: "destructive",
      });
      return;
    }
    if (sessionTokens > 0) {
      const ok = window.confirm(
        `This session wallet still holds tokens in ${sessionTokens} account(s).\n\n` +
        `Clearing destroys the private key. You will lose access to those tokens unless you ` +
        `export the private key first (use "Reveal private key").\n\nClear anyway?`
      );
      if (!ok) return;
    }
    setSessionKeypair(null);
    setSessionBalance(0);
    setSessionTokens(0);
    setShowSessionKey(false);
  }

  // ── Derived (storage-free) mode helpers ────────────────────────────────
  /**
   * Ask the connected Phantom to sign the canonical bump-bot derive message.
   * Same wallet + same message ⇒ same 64-byte signature ⇒ same derived keys,
   * every time, on any device. We never persist the signature.
   */
  async function signDeriveBumpBotMessage(): Promise<{ sig: Uint8Array; signer: string }> {
    if (!publicKey) throw new Error("Connect your wallet first");
    if (!signMessage) throw new Error("Your wallet does not support message signing");
    const signer = publicKey.toBase58();
    const sig = await signMessage(new TextEncoder().encode(deriveBumpBotMessage(signer)));
    if (!sig || sig.length !== 64) {
      throw new Error("Wallet returned an unexpected signature (expected 64 bytes)");
    }
    return { sig, signer };
  }

  /**
   * First-time derivation OR change-of-sub-count derivation. Asks for one
   * signature, derives session + N subs, loads them straight into memory,
   * and persists the (non-sensitive) descriptor so a reload can show the
   * "tap to restore" affordance.
   *
   * Coexists with the legacy encrypted vault: if a vault exists on this
   * device, we leave it untouched. The user can sweep it separately.
   */
  async function deriveBumpBotWallets(opts: { subCount: number; resizing?: boolean }) {
    if (!publicKey || !signMessage) {
      toast({ title: "Wallet required", description: "Connect Phantom first.", variant: "destructive" });
      return;
    }
    if (currentlyBumping || isRunning) {
      toast({ title: "Stop the bot first", description: "Pause the bot before changing your wallet set.", variant: "destructive" });
      return;
    }
    if (!Number.isInteger(opts.subCount) || opts.subCount < 0 || opts.subCount > MAX_DERIVED_SUBS) {
      toast({ title: "Invalid sub-wallet count", description: `Pick a number between 0 and ${MAX_DERIVED_SUBS}.`, variant: "destructive" });
      return;
    }
    // Signer continuity: if a derived set already exists, the only Phantom
    // allowed to re-derive (e.g. resize) is the one that created it.
    // Without this, swapping Phantoms in the wallet dropdown and tapping
    // "Apply" would silently overwrite the persisted descriptor with a
    // brand-new wallet set — stranding funds in the original derived
    // addresses with no UI affordance pointing back to them.
    const existing = readDerivedConfig();
    if (existing && publicKey.toBase58() !== existing.signer) {
      toast({
        title: "Wrong wallet",
        description: `Your current derived wallets came from ${existing.signer.slice(0,4)}…${existing.signer.slice(-4)}. Connect that Phantom to change the sub-wallet count.`,
        variant: "destructive",
      });
      return;
    }
    setDerivedBusy(opts.resizing ? "resize" : "derive");
    try {
      const { sig, signer } = await signDeriveBumpBotMessage();
      const { session, subs } = await deriveBumpBotKeys(sig, opts.subCount);
      // Load straight into the existing keypair slots — the downstream
      // bumping, sweeping, and holdings code works on Keypair objects and
      // doesn't care whether they came from a vault or a derive.
      setSessionKeypair(session);
      setSubKeypairs(subs);
      setSessionBalance(0);
      setShowSessionKey(false);
      setInDerivedMode(true);
      const cfg = {
        signer,
        subCount: opts.subCount,
        sessionPubkey: session.publicKey.toBase58(),
        subPubkeys: subs.map(k => k.publicKey.toBase58()),
      };
      writeDerivedConfig(cfg);
      setDerivedConfig({ v: 1, createdAt: Date.now(), ...cfg });
      toast({
        title: opts.resizing ? "Sub-wallet count updated" : "Wallets ready",
        description: opts.resizing
          ? `Now using ${opts.subCount} sub-wallet${opts.subCount === 1 ? "" : "s"}.`
          : `Session + ${opts.subCount} sub-wallet${opts.subCount === 1 ? "" : "s"} loaded. Works the same on any device with this Phantom.`,
      });
    } catch (err: any) {
      toast({ title: "Could not derive wallets", description: err?.message || "Signature failed.", variant: "destructive" });
    } finally {
      setDerivedBusy(null);
    }
  }

  /**
   * Reload the derived keypairs after a refresh (config in localStorage but
   * no in-memory keys). Same signature ⇒ same keys ⇒ same addresses.
   * Verifies the derived pubkeys match what we persisted so a corrupted or
   * cross-wallet attempt fails loudly instead of silently loading a
   * different set of wallets.
   */
  async function restoreDerivedWallets() {
    const cfg = readDerivedConfig();
    if (!cfg) {
      toast({ title: "Nothing to restore", description: "No derived-wallet config found.", variant: "destructive" });
      return;
    }
    if (!publicKey || !signMessage) {
      toast({ title: "Wallet required", description: "Connect Phantom to restore your wallets.", variant: "destructive" });
      return;
    }
    if (publicKey.toBase58() !== cfg.signer) {
      toast({
        title: "Wrong wallet",
        description: `These wallets were derived from ${cfg.signer.slice(0,4)}…${cfg.signer.slice(-4)}. Connect that Phantom to restore.`,
        variant: "destructive",
      });
      return;
    }
    setDerivedBusy("restore");
    try {
      const { sig, signer } = await signDeriveBumpBotMessage();
      const { session, subs } = await deriveBumpBotKeys(sig, cfg.subCount);
      // Sanity check: derived pubkeys must match the persisted descriptor.
      // If they don't, we'd be loading a stranger's wallets — bail loudly.
      if (
        session.publicKey.toBase58() !== cfg.sessionPubkey ||
        subs.length !== cfg.subPubkeys.length ||
        subs.some((k, i) => k.publicKey.toBase58() !== cfg.subPubkeys[i])
      ) {
        throw new Error("Derived addresses don't match the saved set — wrong wallet?");
      }
      setSessionKeypair(session);
      setSubKeypairs(subs);
      setSessionBalance(0);
      setShowSessionKey(false);
      setInDerivedMode(true);
      toast({ title: "Wallets restored", description: "Ready to bump." });
    } catch (err: any) {
      toast({ title: "Restore failed", description: err?.message || "Could not derive wallets.", variant: "destructive" });
    } finally {
      setDerivedBusy(null);
    }
  }

  /**
   * Exit derived mode. Clears the in-memory keypairs + the local descriptor.
   * Does NOT touch on-chain funds — the user can always re-derive (same
   * Phantom + same message ⇒ same addresses) to recover anything left in
   * those wallets. We warn loudly via the existing regen-guard pattern if
   * any wallet still has SOL / tokens.
   */
  async function exitDerivedMode() {
    if (currentlyBumping || isRunning) {
      toast({ title: "Stop the bot first", description: "Pause the bot before clearing your wallet set.", variant: "destructive" });
      return;
    }
    const ok = window.confirm(
      "Exit derived mode?\n\n" +
      "Your in-memory wallets will be cleared on this device. Any funds left in them " +
      "are still safe on-chain — connect the same Phantom on any device and tap " +
      "\"Restore\" to get the exact same addresses back.\n\n" +
      "Continue?"
    );
    if (!ok) return;
    setDerivedBusy("exit");
    try {
      clearDerivedConfig();
      setDerivedConfig(null);
      setInDerivedMode(false);
      setSessionKeypair(null);
      setSubKeypairs([]);
      setSessionBalance(0);
      setSessionTokens(0);
      toast({ title: "Exited derived mode", description: "Local keys cleared. Funds are still recoverable from any device." });
    } finally {
      setDerivedBusy(null);
    }
  }

  async function forgetVault() {
    if (currentlyBumping || bumpLockRef.current || isRunning) {
      toast({
        title: "Stop the bot first",
        description: "A bump may still be in flight. Stop the bot and wait for it to finish.",
        variant: "destructive",
      });
      return;
    }
    // Derived mode owns sessionKeypair when active. Letting the legacy
    // forget path zero it out would silently exit derived mode without
    // clearing the persisted descriptor — UI would re-show "Restore" on
    // next render, confusing the user. Force the explicit exit instead.
    if (inDerivedMode) {
      toast({
        title: "You're in derived mode",
        description: "Use \"Exit derived mode\" in the green card above instead of forgetting the legacy vault.",
        variant: "destructive",
      });
      return;
    }

    // Resolve the wallet to inspect: prefer the in-memory keypair, otherwise
    // fall back to the saved pubkey from the vault. Either way, fetch LIVE
    // balances directly from chain — never rely on possibly-stale React state
    // (sessionBalance/Tokens are zeroed when the wallet is locked).
    let pubkey: PublicKey | null = null;
    if (sessionKeypair) {
      pubkey = sessionKeypair.publicKey;
    } else {
      const stored = vaultPublicKey();
      if (stored) {
        try { pubkey = new PublicKey(stored); } catch { pubkey = null; }
      }
    }

    let liveSol = 0;
    let liveTokens = 0;
    let balanceKnown = false;
    if (pubkey) {
      try {
        // Query BOTH classic SPL and Token-2022 — new pump.fun launches
        // mint under TokenzQd…; a single-program query would silently
        // treat a Token-2022-only wallet as empty and bypass the guard.
        // Count ALL token accounts (including zero-balance ones) because
        // every account holds reclaimable rent (~0.00204 SOL) that's
        // permanently locked if the owning key is destroyed.
        const tokenAccountCount = (programId: PublicKey) =>
          connection.getParsedTokenAccountsByOwner(pubkey!, { programId })
            .then(r => r.value.length);
        const [bal, splV1, tok22] = await Promise.all([
          connection.getBalance(pubkey),
          tokenAccountCount(new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")),
          tokenAccountCount(new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")),
        ]);
        liveSol = bal;
        liveTokens = splV1 + tok22;
        balanceKnown = true;
      } catch {
        balanceKnown = false;
      }
    }

    let prompt: string;
    if (!balanceKnown) {
      prompt =
        `Forgetting deletes the encrypted key from this device PERMANENTLY.\n\n` +
        `We could NOT verify the on-chain balance right now (network error). ` +
        `If the wallet still holds SOL or tokens, you will lose them.\n\n` +
        `Recommended: cancel, restore the network, sweep, and try again.\n\n` +
        `Forget anyway?`;
    } else if (liveSol > 10_000 || liveTokens > 0) {
      prompt =
        `Forgetting deletes the encrypted key from this device PERMANENTLY.\n\n` +
        (liveSol > 10_000 ? `• ${(liveSol / LAMPORTS_PER_SOL).toFixed(6)} SOL is still in the session wallet.\n` : "") +
        (liveTokens > 0 ? `• ${liveTokens} token account(s) are still held by it.\n` : "") +
        `\nUnlock and sweep, or export the private key first, or you will permanently lose access.\n\n` +
        `Forget anyway?`;
    } else {
      prompt =
        `Forget the saved session wallet on this device?\n\n` +
        `On-chain balance is empty, so nothing will be lost. You'll need to generate or ` +
        `import a new session wallet next time.`;
    }

    // Inner action: actually destroy the vault + reset state. Called either
    // directly (locked wallet / empty balance) or after the regen-guard
    // dialog resolves.
    const doForget = () => {
      clearVault();
      setHasVault(false);
      setSavedPubkey(null);
      setSessionVaultMode(null);
      setSessionVaultSigner(null);
      setShowSessionMigratePrompt(false);
      setSessionMigratePass("");
      setSessionKeypair(null);
      setSessionBalance(0);
      setSessionTokens(0);
      setShowSessionKey(false);
      toast({ title: "Forgot session wallet", description: "Encrypted key removed from this device." });
    };

    // Two scenarios where the new dialog can't help, so fall back to the
    // legacy text-prompt confirm:
    //   1. Vault is LOCKED (no in-memory keypair) — sweep is impossible
    //      without unlocking first; user must consciously accept the risk.
    //   2. On-chain balance verifiably empty AND known — nothing to lose,
    //      a simple confirm is less friction than a modal.
    const sweepable = !!sessionKeypair && balanceKnown && (liveSol > 10_000 || liveTokens > 0);
    if (!sweepable) {
      if (!window.confirm(prompt)) return;
      doForget();
      return;
    }

    // Funded + unlocked → use the rich dialog with a one-tap sweep.
    // The dialog itself re-verifies balances after onSweep before
    // calling onProceed — that's the safety gate, because sweepSession
    // swallows errors internally and we can't rely on it throwing.
    setRegenGuard({
      title: "Forget this session wallet?",
      subtitle: "The encrypted key will be permanently deleted from this device. Send the funds somewhere safe first.",
      pubkeys: [sessionKeypair!.publicKey.toBase58()],
      sweepAvailable: true,
      onSweep: async () => { await sweepSession("transfer"); },
      onProceed: () => { doForget(); },
    });
  }

  // ── Cross-tab sync ──────────────────────────────────────────────────────
  // localStorage changes from other tabs fire a 'storage' event. Keep
  // hasVault/savedPubkey in sync so this tab doesn't make destructive
  // decisions based on stale knowledge of whether a vault exists.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== "paif:bumpSession:v1" && e.key !== null) return;
      const exists = vaultExists();
      setHasVault(exists);
      setSavedPubkey(vaultPublicKey());
      setSessionVaultMode(sessionVaultUnlockModeStored());
      setSessionVaultSigner(sessionVaultSignerPubkey());
      // If our in-memory key no longer matches the saved pubkey (or the vault
      // was wiped from another tab), drop the in-memory key to avoid signing
      // with a key the user thought they revoked.
      if (sessionKeypair) {
        const inMemPub = sessionKeypair.publicKey.toBase58();
        const savedPub = vaultPublicKey();
        if (!exists || (savedPub && savedPub !== inMemPub)) {
          setSessionKeypair(null);
          setSessionBalance(0);
          setSessionTokens(0);
          setShowSessionKey(false);
          toast({
            title: "Session wallet changed in another tab",
            description: "Your in-memory key was dropped to stay in sync.",
          });
        }
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [sessionKeypair, toast]);

  async function fundSession() {
    if (!sessionKeypair || !publicKey || !sendTransaction) return;
    const sol = parseFloat(sessionFundAmount);
    if (!sol || sol < 0.005) {
      toast({ title: "Amount too small", description: "Fund at least 0.005 SOL to cover bumps + gas.", variant: "destructive" });
      return;
    }

    setSessionBusy("fund");
    try {
      const lamports = Math.round(sol * LAMPORTS_PER_SOL);
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");
      // Build a minimal, modern v0 transfer with explicit ComputeBudget.
      // This is the canonical Solana wallet flow Phantom expects: a single
      // SystemProgram.transfer plus a small priority fee. Using the wallet
      // adapter's `sendTransaction` (instead of our own sign-then-broadcast)
      // lets the wallet route the tx through its own RPC + simulator, which
      // prevents Phantom's "unrecognized RPC / unknown destination" warning
      // and shows the buyer a clean "Send 0.05 SOL" preview screen.
      const ixs = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: BigInt(Math.max(1, feeEst?.microLamportsPerCu ?? 1_000)),
        }),
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey:   sessionKeypair.publicKey,
          lamports,
        }),
      ];
      const msg = new TransactionMessage({
        payerKey: publicKey,
        recentBlockhash: blockhash,
        instructions: ixs,
      }).compileToV0Message();
      const tx = new VersionedTransaction(msg);
      const sig = await sendTransaction(tx, connection, {
        skipPreflight: false,
        maxRetries: 3,
      });
      await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed",
      );
      await refreshSessionBalance();

      // Single-popup UX: derive the delegation from the funding tx itself.
      // The owner just signed an on-chain transfer to this exact session
      // wallet — that's stronger proof of authorization than the legacy
      // signMessage attestation, and it spares the user a second wallet
      // popup. Failure here is non-fatal: the auto-delegation effect below
      // will fall back to the signMessage flow on the next render.
      try {
        const delegateRes = await fetch("/api/bump-history/delegate-from-tx", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ownerWallet:   publicKey.toBase58(),
            sessionWallet: sessionKeypair.publicKey.toBase58(),
            txSignature:   sig,
          }),
        });
        if (delegateRes.ok) {
          // Mark delegated immediately so the auto-delegation useEffect
          // doesn't race and pop a second wallet prompt.
          delegationInFlightRef.current.add(
            `${publicKey.toBase58()}:${sessionKeypair.publicKey.toBase58()}`,
          );
        }
      } catch { /* swallow — fallback path will retry */ }

      toast({ title: "Session wallet funded", description: `${sol} SOL transferred. Bot can now run hands-free.` });
    } catch (err: any) {
      toast({ title: "Funding failed", description: err?.message || "Transaction rejected", variant: "destructive" });
    } finally {
      setSessionBusy(null);
    }
  }

  /**
   * Cash out every SPL token a session/sub wallet still holds: sell each one
   * back to SOL via pump.fun's bonding curve, then close the (now empty) token
   * accounts to reclaim ~0.002 SOL of rent each. The recovered SOL stays in
   * the wallet and gets picked up by the subsequent sweepWallet() call.
   *
   * Failure modes (graceful — never throws):
   * - RPC blip listing token accounts → returns zeros
   * - Token has no liquidity / migrated to Raydium → that one sell fails,
   *   loop continues. User can import the key into Phantom to claim manually.
   * - Close-account batch fails → rent stays locked but SOL still sweeps.
   *
   * Returns counters so the caller can build a useful summary toast.
   */
  async function cashOutTokensFromWallet(
    kp: Keypair,
    opts?: { chunks?: number; delayMs?: number; onlyMint?: string },
  ): Promise<{ sold: number; failed: number; closed: number }> {
    // chunks/delay implement TWAP-style dribble selling so a chunky bag
    // doesn't tank the price on the way out. Default = single-shot for
    // back-compat with internal callers.
    // onlyMint restricts the cash-out to a single mint — used by the
    // per-token "Sell this to SOL" buttons on the pool-holdings panel.
    const chunks = Math.max(1, Math.min(20, Math.floor(opts?.chunks ?? 1)));
    const delayMs = Math.max(0, Math.floor(opts?.delayMs ?? 0));
    const onlyMint = opts?.onlyMint;
    let sold = 0, failed = 0, closed = 0;

    let accounts: any[];
    try {
      const [splV1, tok22] = await Promise.all([
        connection.getParsedTokenAccountsByOwner(kp.publicKey, { programId: TOKEN_PROGRAM_ID }, "confirmed"),
        connection.getParsedTokenAccountsByOwner(kp.publicKey, { programId: TOKEN_2022_PROGRAM_ID }, "confirmed"),
      ]);
      accounts = [...splV1.value, ...tok22.value];
    } catch {
      return { sold: 0, failed: 0, closed: 0 };
    }

    const slipBps = Math.max(100, Math.round((Number(slippage) || 10) * 100));

    for (const acc of accounts) {
      const info = (acc.account.data as any).parsed?.info;
      const mint = info?.mint as string | undefined;
      const amountStr = info?.tokenAmount?.amount as string | undefined; // canonical base units
      const decimals = info?.tokenAmount?.decimals as number | undefined;
      if (!mint || !amountStr || amountStr === "0" || decimals === undefined) continue;
      if (onlyMint && mint !== onlyMint) continue;

      // Split the holding into N roughly-equal chunks. Sized in BigInt off
      // the canonical base-unit string from the RPC so float drift can never
      // make us try to sell more tokens than the wallet holds. Last chunk
      // takes the remainder so the wallet lands at exactly 0.
      const factor = Math.pow(10, decimals);
      const totalBase = BigInt(amountStr);
      const nChunks   = BigInt(chunks);
      const perBase   = totalBase / nChunks;
      let   remaining = totalBase;
      let   chunksOk    = 0;
      let   chunksFailed = false;
      for (let i = 0; i < chunks; i++) {
        const chunkBase = (i === chunks - 1) ? remaining : perBase;
        if (chunkBase <= 0n) continue;
        remaining -= chunkBase;
        // Number() loses precision above 2^53 base units; pump.fun supplies
        // top out at ~1e15 base units so per-chunk values stay well inside
        // the safe-integer range.
        const chunkUi = Number(chunkBase) / factor;
        try {
          // Use the public sell-tx route (no credit consumption) — sweeping
          // shouldn't cost the user a bump credit. If liquidity is gone (e.g.
          // graduated to Raydium) the route will 4xx and we skip this token.
          const r = await fetch("/api/pump/sell-tx", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mint,
              userPublicKey: kp.publicKey.toBase58(),
              tokenAmount: chunkUi,
              decimals,
              slippageBps: slipBps,
            }),
          });
          if (!r.ok) { chunksFailed = true; break; }
          const { transaction: txBase64 } = await r.json();
          if (!txBase64) { chunksFailed = true; break; }

          const txBytes = Uint8Array.from(atob(txBase64), c => c.charCodeAt(0));
          const vtx = VersionedTransaction.deserialize(txBytes);
          vtx.sign([kp]);
          const sig = await connection.sendRawTransaction(vtx.serialize(), {
            skipPreflight: false, maxRetries: 3,
          });
          await connection.confirmTransaction(sig, "confirmed");
          chunksOk++;
          // Pause between chunks so we're not back-to-back-firing on the
          // same mint. Skip the wait after the LAST chunk — no point.
          if (i < chunks - 1 && delayMs > 0) {
            await new Promise(res => setTimeout(res, delayMs));
          }
        } catch {
          chunksFailed = true;
          break;
        }
      }
      // Mutually exclusive accounting — a token is either fully sold OR
      // counted as failed (with residual still in the wallet). Avoids the
      // old double-count where a partial sell incremented both buckets.
      if (chunksFailed) failed++;
      else if (chunksOk > 0) sold++;
    }

    // Close empty ATAs to reclaim rent (≈0.00204 SOL each). Only worth doing
    // if at least one sell landed, otherwise we'd just be paying gas to close
    // accounts that may still have a tiny dust balance.
    if (sold > 0) {
      try {
        // Reparse BOTH token programs so Token-2022 dust ATAs are reclaimed
        // too. Each account must be closed with its own program-id passed
        // into the close instruction or the program will reject it.
        const [splV1Re, tok22Re] = await Promise.all([
          connection.getParsedTokenAccountsByOwner(kp.publicKey, { programId: TOKEN_PROGRAM_ID }, "confirmed"),
          connection.getParsedTokenAccountsByOwner(kp.publicKey, { programId: TOKEN_2022_PROGRAM_ID }, "confirmed"),
        ]);
        const emptyAccounts: { pk: PublicKey; program: PublicKey }[] = [];
        for (const acc of splV1Re.value) {
          if ((acc.account.data as any).parsed?.info?.tokenAmount?.amount === "0") {
            emptyAccounts.push({ pk: new PublicKey(acc.pubkey), program: TOKEN_PROGRAM_ID });
          }
        }
        for (const acc of tok22Re.value) {
          if ((acc.account.data as any).parsed?.info?.tokenAmount?.amount === "0") {
            emptyAccounts.push({ pk: new PublicKey(acc.pubkey), program: TOKEN_2022_PROGRAM_ID });
          }
        }
        // SPL close-account ix is ~3k CU; batch ~12 per tx to stay well under
        // the 200k CU per-tx limit and the 1232-byte raw-tx size cap.
        const BATCH_SIZE = 12;
        for (let i = 0; i < emptyAccounts.length; i += BATCH_SIZE) {
          const chunk = emptyAccounts.slice(i, i + BATCH_SIZE);
          // Rent destination = PLATFORM_RENT_TREASURY (not kp.publicKey).
          // Closing a token account refunds ~0.00204 SOL of rent; routing it
          // to the platform treasury is the service fee for the sub-wallet
          // rental + bump infrastructure. Disclosed in the sweep guard
          // dialog so users see the math up front. The authority is still
          // kp (the only key that can sign for these accounts).
          const ixs = chunk.map(a =>
            createCloseAccountInstruction(a.pk, PLATFORM_RENT_TREASURY, kp.publicKey, [], a.program),
          );
          try {
            const { blockhash } = await connection.getLatestBlockhash("confirmed");
            const msg = new TransactionMessage({
              payerKey: kp.publicKey,
              recentBlockhash: blockhash,
              instructions: ixs,
            }).compileToV0Message();
            const tx = new VersionedTransaction(msg);
            tx.sign([kp]);
            const sig = await connection.sendRawTransaction(tx.serialize(), {
              skipPreflight: false, maxRetries: 3,
            });
            await connection.confirmTransaction(sig, "confirmed");
            closed += chunk.length;
          } catch { /* rent loss is small — best effort only */ }
        }
      } catch { /* ignore — sells already succeeded, that's the main thing */ }
    }

    return { sold, failed, closed };
  }

  /**
   * Move every SPL token a wallet holds OVER to the user's main wallet
   * (no selling — keeps the tokens intact). After all transfers land, close
   * the now-empty source token accounts so Solana refunds the ~0.002 SOL
   * rent each one was holding (that SOL will then get swept along with the
   * rest by the subsequent sweepWallet() call).
   *
   * Works for ANY SPL token — including graduated coins that the pump.fun
   * sell route can't handle — because it never touches a DEX.
   *
   * Failure modes (graceful — never throws):
   * - RPC blip listing token accounts → returns zeros
   * - Single token transfer fails → counted as failed, loop continues
   * - Close-account batch fails → rent stays locked but SOL still sweeps
   */
  async function transferTokensFromWallet(
    kp: Keypair,
    dest: PublicKey,
    opts?: { onlyMint?: string },
  ): Promise<{ transferred: number; failed: number; closed: number }> {
    let transferred = 0, failed = 0, closed = 0;
    const onlyMint = opts?.onlyMint;

    let accounts: any[];
    let programByAccount: Map<string, PublicKey>;
    try {
      const [splV1, tok22] = await Promise.all([
        connection.getParsedTokenAccountsByOwner(kp.publicKey, { programId: TOKEN_PROGRAM_ID }, "confirmed"),
        connection.getParsedTokenAccountsByOwner(kp.publicKey, { programId: TOKEN_2022_PROGRAM_ID }, "confirmed"),
      ]);
      programByAccount = new Map<string, PublicKey>();
      for (const acc of splV1.value) programByAccount.set(acc.pubkey.toBase58(), TOKEN_PROGRAM_ID);
      for (const acc of tok22.value) programByAccount.set(acc.pubkey.toBase58(), TOKEN_2022_PROGRAM_ID);
      accounts = [...splV1.value, ...tok22.value];
    } catch {
      return { transferred: 0, failed: 0, closed: 0 };
    }

    for (const acc of accounts) {
      const info = (acc.account.data as any).parsed?.info;
      const mintStr = info?.mint as string | undefined;
      const amountStr = info?.tokenAmount?.amount as string | undefined; // base units
      const decimals = info?.tokenAmount?.decimals as number | undefined;
      if (!mintStr || !amountStr || amountStr === "0" || decimals === undefined) continue;
      if (onlyMint && mintStr !== onlyMint) continue;

      try {
        const mint = new PublicKey(mintStr);
        const srcAta = new PublicKey(acc.pubkey);
        const tokenProgram = programByAccount.get(acc.pubkey.toBase58()) ?? TOKEN_PROGRAM_ID;
        const destAta = getAssociatedTokenAddressSync(mint, dest, true, tokenProgram);
        const amount = BigInt(amountStr);

        const ixs: TransactionInstruction[] = [
          // Idempotent: if dest ATA already exists this is a no-op (no rent
          // re-charged). If not, kp pays the ~0.002 SOL rent — they get it
          // back when we close the empty src ATA below.
          createAssociatedTokenAccountIdempotentInstruction(
            kp.publicKey, destAta, dest, mint, tokenProgram,
          ),
          createTransferCheckedInstruction(
            srcAta, mint, destAta, kp.publicKey, amount, decimals, [], tokenProgram,
          ),
        ];

        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        const msg = new TransactionMessage({
          payerKey: kp.publicKey, recentBlockhash: blockhash, instructions: ixs,
        }).compileToV0Message();
        const tx = new VersionedTransaction(msg);
        tx.sign([kp]);
        const sig = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false, maxRetries: 3,
        });
        await connection.confirmTransaction(sig, "confirmed");
        transferred++;
      } catch {
        failed++;
      }
    }

    // Close every ATA on the source side that's now empty — refunds rent
    // back to the source wallet (then swept to main next). Both token
    // programs must be reparsed and closed under their own program-id.
    if (transferred > 0) {
      try {
        const [splV1Re, tok22Re] = await Promise.all([
          connection.getParsedTokenAccountsByOwner(kp.publicKey, { programId: TOKEN_PROGRAM_ID }, "confirmed"),
          connection.getParsedTokenAccountsByOwner(kp.publicKey, { programId: TOKEN_2022_PROGRAM_ID }, "confirmed"),
        ]);
        const emptyAccounts: { pk: PublicKey; program: PublicKey }[] = [];
        for (const acc of splV1Re.value) {
          if ((acc.account.data as any).parsed?.info?.tokenAmount?.amount === "0") {
            emptyAccounts.push({ pk: new PublicKey(acc.pubkey), program: TOKEN_PROGRAM_ID });
          }
        }
        for (const acc of tok22Re.value) {
          if ((acc.account.data as any).parsed?.info?.tokenAmount?.amount === "0") {
            emptyAccounts.push({ pk: new PublicKey(acc.pubkey), program: TOKEN_2022_PROGRAM_ID });
          }
        }
        const BATCH_SIZE = 12;
        for (let i = 0; i < emptyAccounts.length; i += BATCH_SIZE) {
          const chunk = emptyAccounts.slice(i, i + BATCH_SIZE);
          // Rent → platform treasury (service fee), authority stays with kp.
          // See the matching comment in cashOutTokensFromWallet for details.
          const ixs = chunk.map(a =>
            createCloseAccountInstruction(a.pk, PLATFORM_RENT_TREASURY, kp.publicKey, [], a.program),
          );
          try {
            const { blockhash } = await connection.getLatestBlockhash("confirmed");
            const msg = new TransactionMessage({
              payerKey: kp.publicKey, recentBlockhash: blockhash, instructions: ixs,
            }).compileToV0Message();
            const tx = new VersionedTransaction(msg);
            tx.sign([kp]);
            const sig = await connection.sendRawTransaction(tx.serialize(), {
              skipPreflight: false, maxRetries: 3,
            });
            await connection.confirmTransaction(sig, "confirmed");
            closed += chunk.length;
          } catch { /* best effort */ }
        }
      } catch { /* ignore */ }
    }

    return { transferred, failed, closed };
  }

  /**
   * Sweep SOL from a single wallet (primary or sub) back to the connected
   * main wallet. Returns the lamports actually swept (0 if balance ≤ fee reserve).
   * Token accounts are NOT swept — use cashOutTokensFromWallet() first if
   * you want their value in SOL form.
   */
  /**
   * Forward the just-bought tokens from a buyer wallet to one or more user-
   * chosen destinations in a single tx. Used by the auto-forward-after-buy
   * feature so users running unattended bump campaigns can have proceeds
   * land in their main wallet (or split across a few addresses) without
   * any manual sweep step.
   *
   * Splits the source ATA's balance by pctBps (sums to 10000). Last
   * destination gets the rounding remainder so we never lose dust.
   *
   * Single tx — 3 destinations × (ATA-idempotent + transferChecked) easily
   * fits inside the 1232-byte cap. No batching needed.
   *
   * Failure modes (returns ok:false, never throws):
   * - Source ATA empty (race with another sweep, or buy failed silently)
   * - All shares rounded to 0 (pcts too small for the amount)
   * - RPC/blockhash/confirmation errors
   */
  /**
   * Read the total token balance an owner holds for a given mint across BOTH
   * SPL v1 and Token-2022 programs. Used to snapshot pre-buy balance so the
   * post-buy auto-forward only ships the delta from THIS buy — never the
   * pre-existing holdings that happen to live in the same sub-wallet.
   * Returns 0n on RPC failure (caller treats as "no delta" → skip forward).
   */
  async function readOwnerMintBalance(owner: PublicKey, mintStr: string): Promise<bigint> {
    try {
      const mint = new PublicKey(mintStr);
      const [v1, v2] = await Promise.all([
        connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID,      mint }, "confirmed").catch(() => ({ value: [] as any[] })),
        connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID, mint }, "confirmed").catch(() => ({ value: [] as any[] })),
      ]);
      let total = 0n;
      for (const accs of [v1.value, v2.value]) {
        for (const acc of accs) {
          const info = (acc.account.data as any).parsed?.info;
          if (info?.mint === mintStr && info?.tokenAmount?.amount) {
            total += BigInt(info.tokenAmount.amount);
          }
        }
      }
      return total;
    } catch { return 0n; }
  }

  async function forwardBoughtTokens(
    kp: Keypair,
    mintStr: string,
    destinations: Array<{ pubkey: PublicKey; pctBps: number }>,
    /**
     * When set, forward exactly this many base units (capped to whatever the
     * source ATA currently holds). Used by the post-buy hook to pass the
     * delta from THIS buy so we don't accidentally sweep pre-existing
     * holdings out of the sub-wallet. When undefined, the full source ATA
     * balance is forwarded (manual-sweep semantics, currently unused).
     */
    amountOverride?: bigint,
  ): Promise<{ ok: boolean; sig?: string; err?: string }> {
    try {
      const mint = new PublicKey(mintStr);
      // New pump.fun launches mint under Token-2022; legacy ones under SPL v1.
      // Query both, pick whichever owns the mint for this kp.
      const [splV1, tok22] = await Promise.all([
        connection.getParsedTokenAccountsByOwner(kp.publicKey, { programId: TOKEN_PROGRAM_ID,      mint }, "confirmed").catch(() => ({ value: [] as any[] })),
        connection.getParsedTokenAccountsByOwner(kp.publicKey, { programId: TOKEN_2022_PROGRAM_ID, mint }, "confirmed").catch(() => ({ value: [] as any[] })),
      ]);
      let srcAta: PublicKey | null = null;
      let tokenProgram: PublicKey = TOKEN_PROGRAM_ID;
      let amount = 0n;
      let decimals = 6;
      const pick = (accs: any[], program: PublicKey) => {
        for (const acc of accs) {
          const info = (acc.account.data as any).parsed?.info;
          if (info?.mint === mintStr && info?.tokenAmount?.amount && info.tokenAmount.amount !== "0") {
            srcAta = new PublicKey(acc.pubkey);
            tokenProgram = program;
            amount = BigInt(info.tokenAmount.amount);
            decimals = info.tokenAmount.decimals;
            return true;
          }
        }
        return false;
      };
      if (!pick(splV1.value, TOKEN_PROGRAM_ID)) pick(tok22.value, TOKEN_2022_PROGRAM_ID);
      if (!srcAta || amount === 0n) return { ok: false, err: "No tokens to forward (ATA empty)" };

      // Cap to amountOverride when provided — keeps pre-existing holdings in
      // the sub-wallet untouched, even if the ATA balance is larger. Capping
      // to current balance also defends against a concurrent forward having
      // already drained part of the delta.
      if (amountOverride !== undefined) {
        amount = amountOverride < amount ? amountOverride : amount;
        if (amount <= 0n) return { ok: false, err: "Forward amount is 0 (buy delta consumed by a concurrent forward)" };
      }

      // Allocate per destination: floor(amount * pctBps / 10000). Last dest
      // gets the rounding remainder so no dust is left behind in the source.
      const shares: bigint[] = destinations.map(d => (amount * BigInt(d.pctBps)) / 10000n);
      const used = shares.reduce((a, b) => a + b, 0n);
      shares[shares.length - 1] += amount - used;

      const ixs: TransactionInstruction[] = [];
      destinations.forEach((d, i) => {
        const share = shares[i];
        if (share === 0n) return;
        const destAta = getAssociatedTokenAddressSync(mint, d.pubkey, true, tokenProgram);
        ixs.push(
          createAssociatedTokenAccountIdempotentInstruction(
            kp.publicKey, destAta, d.pubkey, mint, tokenProgram,
          ),
          createTransferCheckedInstruction(
            srcAta!, mint, destAta, kp.publicKey, share, decimals, [], tokenProgram,
          ),
        );
      });
      if (ixs.length === 0) return { ok: false, err: "All split shares rounded to 0" };

      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const msg = new TransactionMessage({
        payerKey: kp.publicKey, recentBlockhash: blockhash, instructions: ixs,
      }).compileToV0Message();
      const tx = new VersionedTransaction(msg);
      tx.sign([kp]);
      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false, maxRetries: 3,
      });
      await connection.confirmTransaction(sig, "confirmed");
      return { ok: true, sig };
    } catch (err: any) {
      return { ok: false, err: err?.message || "Unknown error" };
    }
  }

  /**
   * Validate auto-forward rows and resolve them to PublicKey + pctBps. Empty
   * addr = use the connected wallet. Returns null when any row is invalid,
   * percents don't sum to 100, or destinations collide.
   */
  function buildForwardDestinations(): Array<{ pubkey: PublicKey; pctBps: number }> | null {
    if (!publicKey) return null;
    const out: Array<{ pubkey: PublicKey; pctBps: number }> = [];
    let totalBps = 0;
    const seen = new Set<string>();
    for (const row of autoForwardRows) {
      const pct = parseFloat(row.pct);
      if (!isFinite(pct) || pct <= 0 || pct > 100) return null;
      const bps = Math.round(pct * 100);
      let pubkey: PublicKey;
      if (!row.addr.trim()) {
        pubkey = publicKey;
      } else {
        try { pubkey = new PublicKey(row.addr.trim()); } catch { return null; }
      }
      const key = pubkey.toBase58();
      if (seen.has(key)) return null;
      seen.add(key);
      out.push({ pubkey, pctBps: bps });
      totalBps += bps;
    }
    if (totalBps !== 10000) return null;
    return out.length ? out : null;
  }

  // Derived: whether the auto-forward rows are currently valid. Drives the
  // red invalid-state note + (effectively) gates the post-buy hook from
  // firing with a misconfigured destination set.
  const autoForwardValid = !!buildForwardDestinations();

  async function sweepWallet(kp: Keypair, dest: PublicKey): Promise<number> {
    const bal = await connection.getBalance(kp.publicKey);
    const FEE_RESERVE = 5_000;
    if (bal <= FEE_RESERVE) return 0;
    const lamports = bal - FEE_RESERVE;
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const ix = SystemProgram.transfer({
      fromPubkey: kp.publicKey,
      toPubkey:   dest,
      lamports,
    });
    const msg = new TransactionMessage({
      payerKey: kp.publicKey,
      recentBlockhash: blockhash,
      instructions: [ix],
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    tx.sign([kp]);
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false, maxRetries: 3,
    });
    await connection.confirmTransaction(sig, "confirmed");
    return lamports;
  }

  /**
   * Sweep primary session wallet only (kept for the main session card).
   * `modeOverride` lets callers force a specific mode (e.g., the prominent
   * "send everything home" button) without depending on the React state
   * being flushed first — `setSweepMode` is async, so reading `sweepMode`
   * from the closure inside this function would race with the click that
   * triggered it.
   */
  async function sweepSession(modeOverride?: SweepMode) {
    if (!sessionKeypair || !publicKey) return;
    if (sessionBusy === "sweep") return; // guard against rapid double-tap
    const mode: SweepMode = modeOverride ?? sweepMode;
    setSessionBusy("sweep");
    try {
      let transferred = 0, sold = 0, failed = 0, closed = 0;
      if (mode === "transfer") {
        const r = await transferTokensFromWallet(sessionKeypair, publicKey);
        transferred = r.transferred; failed = r.failed; closed = r.closed;
      } else if (mode === "sell") {
        const cfg = effectiveTwapConfig();
        const r = await cashOutTokensFromWallet(sessionKeypair, { chunks: cfg.chunks, delayMs: cfg.delaySec * 1000 });
        sold = r.sold; failed = r.failed; closed = r.closed;
      }
      const lamports = await sweepWallet(sessionKeypair, publicKey);
      await refreshSessionBalance();
      if (lamports === 0 && sold === 0 && transferred === 0) {
        toast({
          title: "Nothing to sweep",
          description: mode === "sol-only"
            ? "Session wallet has no SOL."
            : "Session wallet is empty (no SOL or transferable tokens).",
        });
      } else {
        const parts: string[] = [];
        if (transferred > 0) parts.push(`Sent ${transferred} token${transferred !== 1 ? "s" : ""} to your main wallet`);
        if (sold > 0) parts.push(`Sold ${sold} token${sold !== 1 ? "s" : ""} → SOL`);
        if (closed > 0) parts.push(`reclaimed rent from ${closed} empty account${closed !== 1 ? "s" : ""}`);
        if (lamports > 0) parts.push(`returned ${(lamports / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
        if (failed > 0) parts.push(`${failed} token${failed !== 1 ? "s" : ""} skipped`);
        if (mode === "sol-only" && lamports > 0) {
          parts.push("Tokens still live in the session wallet — import the key into Phantom to claim them.");
        }
        toast({
          title: mode === "sol-only" ? "Sweep complete" : "Cash out complete",
          description: parts.join(" · "),
        });
      }
    } catch (err: any) {
      toast({ title: "Sweep failed", description: err?.message || "Could not sweep", variant: "destructive" });
    } finally {
      setSessionBusy(null);
    }
  }

  // ── Sub-wallet helpers ──────────────────────────────────────────────────

  /** Refresh SOL balance for every sub-wallet pubkey we know about. */
  const refreshSubBalances = useCallback(async () => {
    const pubs = subKeypairs.length
      ? subKeypairs.map(k => k.publicKey.toBase58())
      : subPubkeysFromVault;
    if (pubs.length === 0) { setSubBalances({}); return; }
    try {
      const results = await Promise.all(
        pubs.map(p => connection.getBalance(new PublicKey(p)).catch(() => 0))
      );
      const out: Record<string, number> = {};
      pubs.forEach((p, i) => { out[p] = results[i]; });
      setSubBalances(out);
    } catch { /* ignore */ }
  }, [subKeypairs, subPubkeysFromVault, connection]);

  useEffect(() => {
    refreshSubBalances();
    const t = setInterval(refreshSubBalances, 20_000);
    return () => clearInterval(t);
  }, [refreshSubBalances]);

  /**
   * Generate N brand-new sub-wallets and persist them under the SAME passphrase
   * the user already typed for their primary session wallet. The user is
   * implicitly required to have an unlocked session — we never create a new
   * passphrase for sub-wallets, only re-use the session one to keep UX simple.
   */
  async function handleGenerateSubWallets(passphrase: string) {
    const n = parseInt(subWalletCount);
    // The effective cap depends on whether the wallet bought the unlimited
    // pack — we read it from creditInfo (a level above this fn's closure)
    // via effectiveMaxSubWallets, which is also what the input uses.
    if (!n || n < 1 || n > effectiveMaxSubWallets) {
      toast({ title: "Invalid count", description: `Pick between 1 and ${effectiveMaxSubWallets}.`, variant: "destructive" });
      return;
    }
    if (!passphrase || passphrase.length < 6) {
      toast({ title: "Passphrase required", description: "Enter the session passphrase to encrypt sub-wallets.", variant: "destructive" });
      return;
    }
    setSubWalletsBusy("generate");
    try {
      const kps = await generateAndSaveSubWallets(n, passphrase, effectiveMaxSubWallets);
      setSubKeypairs(kps);
      setSubPubkeysFromVault(kps.map(k => k.publicKey.toBase58()));
      setHasSubVault(true);
      toast({ title: "Sub-wallets created", description: `${n} new burner${n > 1 ? "s" : ""} ready. Fund them from your primary session wallet.` });
    } catch (err: any) {
      toast({ title: "Could not create sub-wallets", description: err?.message || "Unknown error", variant: "destructive" });
    } finally {
      setSubWalletsBusy(null);
    }
  }

  async function handleUnlockSubWallets(passphrase: string) {
    if (!passphrase) {
      toast({ title: "Passphrase required", variant: "destructive" });
      return;
    }
    setSubWalletsBusy("unlock");
    try {
      const kps = await unlockSubWallets(passphrase);
      setSubKeypairs(kps);
      toast({ title: "Sub-wallets unlocked", description: `${kps.length} burner${kps.length > 1 ? "s" : ""} loaded into memory.` });
    } catch (err: any) {
      toast({ title: "Unlock failed", description: err?.message || "Wrong passphrase?", variant: "destructive" });
    } finally {
      setSubWalletsBusy(null);
    }
  }

  /**
   * Ask the connected wallet (Phantom etc.) to sign the canonical sub-wallet
   * unlock message. Returns the raw signature bytes — these get fed into
   * PBKDF2 to derive the AES-GCM key. ed25519 signatures are deterministic
   * for a given (key, message), so the same wallet always reproduces the
   * same encryption key without us ever storing the signature.
   */
  async function signSubWalletUnlockMessage(): Promise<{ sig: Uint8Array; signer: string }> {
    if (!publicKey) throw new Error("Connect your wallet first");
    if (!signMessage) throw new Error("Your wallet does not support message signing");
    const signer = publicKey.toBase58();
    const message = subWalletUnlockMessage(signer);
    const sig = await signMessage(new TextEncoder().encode(message));
    if (!sig || sig.length < 32) throw new Error("Wallet returned an empty signature");
    return { sig, signer };
  }

  /**
   * Generate sub-wallets in SIGNATURE mode. User taps once in Phantom to
   * approve the unlock message — no passphrase to type or remember.
   */
  async function handleGenerateSubWalletsWithSignature() {
    const n = parseInt(subWalletCount);
    if (!n || n < 1 || n > effectiveMaxSubWallets) {
      toast({ title: "Invalid count", description: `Pick between 1 and ${effectiveMaxSubWallets}.`, variant: "destructive" });
      return;
    }
    if (!publicKey || !signMessage) {
      toast({ title: "Wallet required", description: "Connect your wallet to use one-tap unlock.", variant: "destructive" });
      return;
    }
    setSubWalletsBusy("generate");
    try {
      const { sig, signer } = await signSubWalletUnlockMessage();
      const kps = await generateAndSaveSubWalletsWithSignature(n, sig, signer, effectiveMaxSubWallets);
      setSubKeypairs(kps);
      setSubPubkeysFromVault(kps.map(k => k.publicKey.toBase58()));
      setHasSubVault(true);
      setSubVaultMode("signature");
      setSubVaultSigner(signer);
      toast({ title: "Sub-wallets created", description: `${n} new burner${n > 1 ? "s" : ""} ready. Unlocked with your wallet — no passphrase needed.` });
    } catch (err: any) {
      toast({ title: "Could not create sub-wallets", description: err?.message || "Unknown error", variant: "destructive" });
    } finally {
      setSubWalletsBusy(null);
    }
  }

  /**
   * Unlock a signature-mode vault by re-signing the unlock message.
   */
  async function handleUnlockSubWalletsWithSignature() {
    if (!publicKey || !signMessage) {
      toast({ title: "Wallet required", description: "Connect the wallet that created these sub-wallets.", variant: "destructive" });
      return;
    }
    setSubWalletsBusy("unlock");
    try {
      const { sig, signer } = await signSubWalletUnlockMessage();
      const kps = await unlockSubWalletsWithSignature(sig, signer);
      setSubKeypairs(kps);
      toast({ title: "Sub-wallets unlocked", description: `${kps.length} burner${kps.length > 1 ? "s" : ""} loaded — one tap, no typing.` });
    } catch (err: any) {
      toast({ title: "Unlock failed", description: err?.message || "Could not unlock", variant: "destructive" });
    } finally {
      setSubWalletsBusy(null);
    }
  }

  /**
   * Migrate an existing passphrase-mode vault to signature mode. User types
   * their passphrase ONE LAST TIME, we decrypt, then re-encrypt under a
   * wallet-signature key. Pubkeys and balances are unaffected.
   */
  async function handleMigrateToSignature() {
    if (!migratePass) {
      toast({ title: "Passphrase required", description: "Type your current passphrase to switch unlock modes.", variant: "destructive" });
      return;
    }
    if (!publicKey || !signMessage) {
      toast({ title: "Wallet required", description: "Connect the wallet you want to bind to your sub-wallets.", variant: "destructive" });
      return;
    }
    setSubWalletsBusy("unlock");
    try {
      const { sig, signer } = await signSubWalletUnlockMessage();
      const kps = await migrateVaultToSignature(migratePass, sig, signer);
      setSubKeypairs(kps);
      setSubVaultMode("signature");
      setSubVaultSigner(signer);
      setMigratePass("");
      setShowMigratePrompt(false);
      toast({ title: "One-tap unlock enabled", description: "Future unlocks just need one Phantom tap — no more typing." });
    } catch (err: any) {
      toast({ title: "Could not switch unlock mode", description: err?.message || "Unknown error", variant: "destructive" });
    } finally {
      setSubWalletsBusy(null);
    }
  }

  /**
   * Distribute SOL from the PRIMARY session wallet to each sub-wallet in a
   * single transaction (no extra wallet popup — primary signs in-browser).
   *
   * Two modes:
   *   - Uniform (default): every sub gets the SAME `perSubFundAmount` SOL.
   *   - Per-sub array: callers pass `customLamports[]` (length = subKeypairs)
   *     to send a DIFFERENT lamport amount to each wallet — used by Auto +
   *     Manual-Range to keep the funding pattern from looking like a bot.
   */
  async function distributeToSubWallets(customLamports?: number[]) {
    if (!sessionKeypair) {
      toast({ title: "No primary session wallet", variant: "destructive" });
      return;
    }
    if (subKeypairs.length === 0) {
      toast({ title: "Sub-wallets locked", description: "Unlock or generate sub-wallets first.", variant: "destructive" });
      return;
    }

    // Build per-sub lamport array — either the caller's custom plan or a
    // uniform split based on `perSubFundAmount`.
    let lamportsArr: number[];
    if (customLamports && customLamports.length === subKeypairs.length) {
      if (customLamports.some(v => v < 1_000_000)) { // <0.001 SOL
        toast({ title: "Amount too small", description: "Each sub-wallet must receive at least 0.001 SOL.", variant: "destructive" });
        return;
      }
      lamportsArr = customLamports.map(v => Math.round(v));
    } else {
      const each = parseFloat(perSubFundAmount);
      if (!each || each < 0.001) {
        toast({ title: "Amount too small", description: "Send at least 0.001 SOL per sub-wallet.", variant: "destructive" });
        return;
      }
      const lamportsEach = Math.round(each * LAMPORTS_PER_SOL);
      lamportsArr = subKeypairs.map(() => lamportsEach);
    }

    const totalLamports = lamportsArr.reduce((a, b) => a + b, 0);
    const totalNeeded = totalLamports + 10_000; // gas
    if (sessionBalance < totalNeeded) {
      toast({
        title: "Primary session wallet underfunded",
        description: `Need ${(totalNeeded / LAMPORTS_PER_SOL).toFixed(4)} SOL, has ${(sessionBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL.`,
        variant: "destructive",
      });
      return;
    }
    setSubWalletsBusy("distribute");
    try {
      const ixs = subKeypairs.map((sk, i) => SystemProgram.transfer({
        fromPubkey: sessionKeypair.publicKey,
        toPubkey:   sk.publicKey,
        lamports:   lamportsArr[i],
      }));
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const msg = new TransactionMessage({
        payerKey: sessionKeypair.publicKey,
        recentBlockhash: blockhash,
        instructions: ixs,
      }).compileToV0Message();
      const tx = new VersionedTransaction(msg);
      tx.sign([sessionKeypair]);
      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false, maxRetries: 3,
      });
      await connection.confirmTransaction(sig, "confirmed");
      await refreshSessionBalance();
      await refreshSubBalances();
      const isVar = customLamports && new Set(lamportsArr).size > 1;
      toast({
        title: "Distributed",
        description: isVar
          ? `${(totalLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL split unevenly across ${subKeypairs.length} sub-wallets.`
          : `${(lamportsArr[0] / LAMPORTS_PER_SOL).toFixed(4)} SOL → each of ${subKeypairs.length} sub-wallet${subKeypairs.length > 1 ? "s" : ""}.`,
      });
    } catch (err: any) {
      toast({ title: "Distribution failed", description: err?.message || "Transaction rejected", variant: "destructive" });
    } finally {
      setSubWalletsBusy(null);
    }
  }

  /**
   * Build a randomized per-sub lamport allocation that sums to ≤ totalSol.
   * Uses random weights in [0.5, 1.5] and normalizes — guarantees variance
   * (no two subs get exactly the same amount) and that every sub receives
   * at least 0.001 SOL. Returns null if the budget is too small for N subs.
   */
  function buildRandomAllocLamports(totalSol: number, n: number): number[] | null {
    if (n <= 0 || totalSol <= 0) return null;
    const minPerSub = 0.001;
    if (totalSol < minPerSub * n) return null;
    // Random weights with meaningful spread (0.5×–1.5× of mean).
    const weights = Array.from({ length: n }, () => 0.5 + Math.random());
    const sumW = weights.reduce((a, b) => a + b, 0);
    const raw = weights.map(w => (w / sumW) * totalSol);
    // Floor to 6 decimals → lamports
    const lamportsArr = raw.map(v => Math.floor(v * 1_000_000) * 1000); // 1e6 SOL → lamports = ×1e3 after floor
    // Bump any sub below 0.001 SOL up to 0.001, deduct the diff from the largest.
    const minLamports = Math.round(minPerSub * LAMPORTS_PER_SOL);
    for (let i = 0; i < lamportsArr.length; i++) {
      if (lamportsArr[i] < minLamports) {
        const deficit = minLamports - lamportsArr[i];
        const maxIdx = lamportsArr.indexOf(Math.max(...lamportsArr));
        if (lamportsArr[maxIdx] - deficit < minLamports) return null;
        lamportsArr[maxIdx] -= deficit;
        lamportsArr[i] = minLamports;
      }
    }
    return lamportsArr;
  }

  /**
   * Build per-sub lamports where each sub gets a uniform-random amount
   * inside [minSol, maxSol]. Used by Manual-Range mode.
   */
  function buildRangeAllocLamports(minSol: number, maxSol: number, n: number): number[] | null {
    if (n <= 0 || minSol <= 0 || maxSol < minSol) return null;
    if (minSol < 0.001) return null;
    return Array.from({ length: n }, () => {
      const r = minSol + Math.random() * (maxSol - minSol);
      return Math.round(r * LAMPORTS_PER_SOL);
    });
  }

  /**
   * One-button "make sub-wallets bumpable RIGHT NOW" — used by the amber
   * unfunded-subs warning. Picks the smartest plan it can given the
   * current primary balance, never refuses if there's enough SOL to cover
   * even minimum amounts. This removes the user's biggest pain point:
   * "I have SOL in primary but the warning button is grayed out."
   */
  async function fundAllUnfundedNow() {
    if (!sessionKeypair || subKeypairs.length === 0) return;
    const GAS_BUFFER_SOL = 0.0005;
    const primarySol = sessionBalance / LAMPORTS_PER_SOL;
    const usableSol = Math.max(0, primarySol - GAS_BUFFER_SOL);
    const n = subKeypairs.length;
    const minTotal = 0.001 * n;
    if (usableSol < minTotal) {
      toast({
        title: "Primary too low to fund subs",
        description: `Need at least ${(minTotal + GAS_BUFFER_SOL).toFixed(4)} SOL in primary, has ${primarySol.toFixed(4)}.`,
        variant: "destructive",
      });
      return;
    }
    // Decide budget: respect user's typed cap if set, else use everything
    // available. Never exceed primary minus gas.
    let budgetSol: number;
    if (fundMode === "auto") {
      const typed = parseFloat(autoTotalBudget) || 0;
      budgetSol = typed > 0 ? Math.min(typed, usableSol) : usableSol;
    } else {
      // Manual mode — use whatever the manual config implies, but cap.
      if (manualMode === "fixed") {
        const each = parseFloat(perSubFundAmount) || 0.02;
        budgetSol = Math.min(each * n, usableSol);
      } else {
        const lo = parseFloat(perSubFundMin) || 0.01;
        const hi = parseFloat(perSubFundMax) || 0.05;
        budgetSol = Math.min(((lo + hi) / 2) * n, usableSol);
      }
    }
    // Always randomize the per-sub split — that's the whole point of the
    // "doesn't look like a bot" funding flow.
    const plan = buildRandomAllocLamports(budgetSol, n);
    if (!plan) {
      toast({ title: "Couldn't build a funding plan", description: "Try the Auto / Manual section directly.", variant: "destructive" });
      return;
    }
    setRandomAllocLamports(plan);
    setRandomAllocSeed(s => s + 1);
    setAutoTotalBudget(budgetSol.toFixed(4));
    await distributeToSubWallets(plan);
  }

  /**
   * Top up any sub-wallets that have dropped below the auto-refill
   * threshold, paying from the session wallet. Each refill amount is
   * randomized in [1.0×, 2.5×] of the threshold so it doesn't look like
   * a script. Respects:
   *   - `autoRefillHourlyCapSol` rolling 1-hour spend cap
   *   - keeps a tiny gas buffer in the session wallet
   *   - skips silently when nothing needs refilling (no toast spam)
   */
  // Live mirrors of state values that the polling refill loop needs to read
  // FRESHLY on every tick. Without these, the setInterval closure captures
  // stale balances + spent-counters and either over-spends or under-detects.
  const sessionBalanceRef = useRef(sessionBalance);
  const subBalancesRef = useRef(subBalances);
  const refilledThisHourRef = useRef(refilledThisHourLamports);
  const sessionKeypairRef = useRef(sessionKeypair);
  const subKeypairsRef = useRef(subKeypairs);
  sessionBalanceRef.current = sessionBalance;
  subBalancesRef.current = subBalances;
  refilledThisHourRef.current = refilledThisHourLamports;
  sessionKeypairRef.current = sessionKeypair;
  subKeypairsRef.current = subKeypairs;

  async function refillUnderfundedSubs(): Promise<void> {
    if (refillBusyRef.current) return;
    const liveSessionKp = sessionKeypairRef.current;
    const liveSubs = subKeypairsRef.current;
    if (!liveSessionKp || liveSubs.length === 0) return;
    const thresholdSol = parseFloat(autoRefillThreshold) || 0;
    const hourlyCapSol = parseFloat(autoRefillHourlyCapSol) || 0;
    if (thresholdSol < 0.001 || hourlyCapSol <= 0) return;

    // Roll the window forward if an hour has passed since we started counting.
    const HOUR_MS = 60 * 60 * 1000;
    if (Date.now() - refillWindowStartRef.current >= HOUR_MS) {
      refillWindowStartRef.current = Date.now();
      setRefilledThisHourLamports(0);
      refilledThisHourRef.current = 0;
    }

    const thresholdLamports = Math.round(thresholdSol * LAMPORTS_PER_SOL);
    const hourlyCapLamports = Math.round(hourlyCapSol * LAMPORTS_PER_SOL);
    const remainingCap = hourlyCapLamports - refilledThisHourRef.current;
    if (remainingCap <= 0) return; // hit safety cap; will reset next hour

    // Build per-sub refill amounts only for the underfunded ones. Read live
    // sub-balance map from the ref so we don't act on a stale snapshot.
    const liveSubBalances = subBalancesRef.current;
    const recipients: { kp: Keypair; lamports: number }[] = [];
    for (const sub of liveSubs) {
      const bal = liveSubBalances[sub.publicKey.toBase58()] ?? 0;
      if (bal >= thresholdLamports) continue;
      // Random multiplier 1.0×–2.5× of threshold for organic-looking funding.
      const mult = 1.0 + Math.random() * 1.5;
      recipients.push({ kp: sub, lamports: Math.round(thresholdLamports * mult) });
    }
    if (recipients.length === 0) return;

    // Cap total against hourly remaining + session balance (keep gas buffer).
    const GAS_BUFFER = 50_000;
    const MIN_PER_RECIPIENT = 1_000_000; // 0.001 SOL — Solana account-rent floor
    const sessionAvailable = Math.max(0, sessionBalanceRef.current - GAS_BUFFER);
    const usable = Math.min(remainingCap, sessionAvailable);
    let total = recipients.reduce((s, r) => s + r.lamports, 0);
    let working = recipients.slice();
    if (total > usable) {
      // Scale every recipient down proportionally, then drop anyone whose
      // share falls below the 0.001-SOL minimum (raising them back up
      // would silently push the total over the cap — exactly what the
      // architect flagged). Re-sum after the drop.
      const scale = usable / total;
      working = working
        .map(r => ({ ...r, lamports: Math.floor(r.lamports * scale) }))
        .filter(r => r.lamports >= MIN_PER_RECIPIENT);
      total = working.reduce((s, r) => s + r.lamports, 0);
    }
    // Hard guard — never exceed the cap or the session balance, even after
    // rounding/floor games. Bail silently if the budget can't satisfy a
    // single recipient at the minimum.
    if (working.length === 0 || total > usable || total > sessionAvailable) return;

    refillBusyRef.current = true;
    try {
      const ixs = working.map(r => SystemProgram.transfer({
        fromPubkey: liveSessionKp.publicKey,
        toPubkey:   r.kp.publicKey,
        lamports:   r.lamports,
      }));
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const msg = new TransactionMessage({
        payerKey: liveSessionKp.publicKey,
        recentBlockhash: blockhash,
        instructions: ixs,
      }).compileToV0Message();
      const tx = new VersionedTransaction(msg);
      tx.sign([liveSessionKp]);
      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false, maxRetries: 2,
      });
      await connection.confirmTransaction(sig, "confirmed");
      setRefilledThisHourLamports(prev => prev + total);
      refilledThisHourRef.current += total;
      void refreshSessionBalance();
      void refreshSubBalances();
      // Surface a tiny toast (not a log entry — BumpLog is reserved for trade
      // events) so the user sees the bot is keeping itself fueled.
      toast({
        title: "Auto-refilled sub-wallets",
        description: `${working.length} wallet${working.length === 1 ? "" : "s"} topped up · ${(total / LAMPORTS_PER_SOL).toFixed(4)} SOL from session`,
      });
    } catch (err: any) {
      // Throttle failure toasts to once every 5 min so a flapping RPC can't
      // spam — but don't go fully silent like before, the user needs to know
      // their bot isn't auto-refilling.
      const now = Date.now();
      if (now - lastRefillFailToastRef.current > 5 * 60 * 1000) {
        lastRefillFailToastRef.current = now;
        toast({
          title: "Auto-refill paused",
          description: err?.message?.slice(0, 120) || "RPC error — will retry on the next cycle.",
          variant: "destructive",
        });
      }
    } finally {
      refillBusyRef.current = false;
    }
  }

  /**
   * While the bot is running with auto-refill ON, poll every 45s and
   * top up any sub-wallets that have dropped below the threshold. The
   * helper itself is idempotent and silently no-ops if nothing needs
   * refilling, so this interval is cheap.
   */
  useEffect(() => {
    if (botState !== "running" || !autoRefillEnabled) return;
    // Fire one immediately so subs that drained mid-run get topped up
    // without waiting a full cycle, then poll every 45s.
    void refillUnderfundedSubs();
    const id = setInterval(() => { void refillUnderfundedSubs(); }, 45_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botState, autoRefillEnabled, autoRefillThreshold, autoRefillHourlyCapSol, subKeypairs.length]);

  /**
   * Auto-clamp the Auto-mode budget when:
   *   - sub count changes (e.g. user resizes pool from 3 → 5)
   *   - primary balance drops below the typed budget
   * Keeps the user from ever staring at a disabled "over balance" button
   * after a perfectly reasonable action.
   */
  useEffect(() => {
    const GAS_BUFFER_SOL = 0.0005;
    const primarySol = sessionBalance / LAMPORTS_PER_SOL;
    const usableSol = Math.max(0, primarySol - GAS_BUFFER_SOL);
    const n = subKeypairs.length;
    if (n === 0 || usableSol <= 0) return;
    const typed = parseFloat(autoTotalBudget) || 0;
    // If typed budget is zero (uninitialized), too small for N subs, or
    // exceeds available primary, snap to the safe ceiling.
    const minTotal = 0.001 * n;
    if (typed === 0 || typed < minTotal || typed > usableSol) {
      const safe = Math.max(minTotal, Math.min(usableSol, typed || usableSol));
      setAutoTotalBudget(safe.toFixed(4));
      setRandomAllocLamports([]); // force fresh roll
    }
  // We intentionally only run this when sub count or primary balance
  // changes — not on every keystroke into autoTotalBudget itself.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subKeypairs.length, sessionBalance]);

  /**
   * On wallet (re)connect, prompt for the one-time trial-claim signature.
   * Quietly skipped if the wallet already has a balance. Also clears any
   * stale consume-auth grant signed under a previous wallet.
   */
  useEffect(() => {
    if (!publicKey) {
      consumeAuthRef.current = null;
      return;
    }
    // Reset cached grant if the wallet that signed it no longer matches.
    if (consumeAuthRef.current && consumeAuthRef.current.ownerWallet !== publicKey.toBase58()) {
      consumeAuthRef.current = null;
    }
    void maybeClaimFreeTrial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey?.toBase58()]);

  /**
   * Sweep ALL wallets (primary session + every unlocked sub-wallet) back to
   * the connected main wallet. Each wallet signs and sends its own transfer
   * — no main-wallet popups required.
   */
  async function sweepAll(modeOverride?: SweepMode) {
    if (!publicKey) return;
    if (subWalletsBusy === "sweep") return; // guard against rapid double-tap
    if (poolMintBusy) {
      toast({ title: "Hold on", description: "A per-token action is already running. Wait for it to finish before sweeping." });
      return;
    }
    if (!sessionKeypair && subKeypairs.length === 0) {
      toast({ title: "Nothing to sweep", description: "No session or sub-wallets loaded." });
      return;
    }
    const mode: SweepMode = modeOverride ?? sweepMode;
    setSubWalletsBusy("sweep");
    let totalLamports = 0;
    let okCount = 0;
    let failCount = 0;
    let totalSold = 0, totalTransferred = 0, totalTokenFailed = 0, totalClosed = 0;
    const twapCfg = effectiveTwapConfig();
    const all = [
      ...(sessionKeypair ? [sessionKeypair] : []),
      ...subKeypairs,
    ];
    for (const kp of all) {
      if (mode === "transfer") {
        try {
          const r = await transferTokensFromWallet(kp, publicKey);
          totalTransferred += r.transferred;
          totalTokenFailed += r.failed;
          totalClosed += r.closed;
        } catch { /* fall through to SOL sweep */ }
      } else if (mode === "sell") {
        try {
          const r = await cashOutTokensFromWallet(kp, { chunks: twapCfg.chunks, delayMs: twapCfg.delaySec * 1000 });
          totalSold += r.sold;
          totalTokenFailed += r.failed;
          totalClosed += r.closed;
        } catch { /* fall through to SOL sweep */ }
      }
      try {
        const got = await sweepWallet(kp, publicKey);
        if (got > 0) { totalLamports += got; okCount++; }
      } catch {
        failCount++;
      }
    }
    await refreshSessionBalance();
    await refreshSubBalances();
    setSubWalletsBusy(null);
    if (totalLamports === 0 && failCount === 0 && totalSold === 0 && totalTransferred === 0) {
      toast({
        title: "Nothing to sweep",
        description: mode === "sol-only"
          ? "All wallets have no SOL."
          : "All wallets are empty (no SOL or movable tokens).",
      });
    } else {
      const parts: string[] = [];
      if (totalTransferred > 0) parts.push(`Sent ${totalTransferred} token${totalTransferred !== 1 ? "s" : ""} to your main wallet`);
      if (totalSold > 0) parts.push(`Sold ${totalSold} token${totalSold !== 1 ? "s" : ""} → SOL`);
      if (totalClosed > 0) parts.push(`reclaimed rent from ${totalClosed} empty account${totalClosed !== 1 ? "s" : ""}`);
      if (totalLamports > 0) parts.push(`returned ${(totalLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL from ${okCount} wallet${okCount !== 1 ? "s" : ""}`);
      if (totalTokenFailed > 0) parts.push(`${totalTokenFailed} token${totalTokenFailed !== 1 ? "s" : ""} skipped`);
      if (failCount > 0) parts.push(`${failCount} sweep${failCount !== 1 ? "s" : ""} failed`);
      toast({
        title: mode === "sol-only" ? "Sweep complete" : "Cash out complete",
        description: parts.join(" · "),
      });
    }
  }

  /**
   * Sell ONE mint across the pool (session + every unlocked sub-wallet)
   * using the existing TWAP cash-out helper. Triggered by the per-token
   * "Sell to SOL" button on the pool-holdings panel.
   *
   * Sweep-SOL-back is intentionally NOT chained here: the user might want
   * to keep firing bumps with their remaining tokens AND keep the SOL in
   * the subs as fuel for future trades. They can still sweep SOL out
   * later via the main sweep section.
   */
  async function sellMintAcrossPool(mint: string) {
    if (subKeypairs.length === 0 && !sessionKeypair) {
      toast({ title: "Nothing to sell", description: "Unlock your sub-wallets first.", variant: "destructive" });
      return;
    }
    if (poolMintBusy || subWalletsBusy) {
      toast({ title: "Hold on", description: "Another wallet action is already running." });
      return;
    }
    setPoolMintBusy({ mint, action: "sell" });
    const twapCfg = effectiveTwapConfig();
    const pool = [
      ...(sessionKeypair ? [sessionKeypair] : []),
      ...subKeypairs,
    ];
    let sold = 0, failed = 0, closed = 0;
    for (const kp of pool) {
      try {
        const r = await cashOutTokensFromWallet(kp, { chunks: twapCfg.chunks, delayMs: twapCfg.delaySec * 1000, onlyMint: mint });
        sold += r.sold;
        failed += r.failed;
        closed += r.closed;
      } catch { /* keep going */ }
    }
    await refreshSubBalances();
    await refetchPoolTokens();
    setPoolMintBusy(null);
    if (sold === 0 && failed === 0) {
      toast({ title: "Nothing to sell", description: "No wallet in the pool held that token." });
    } else {
      const parts: string[] = [];
      if (sold > 0)   parts.push(`Sold ${sold} wallet${sold !== 1 ? "s" : ""}' bag → SOL`);
      if (failed > 0) parts.push(`${failed} skipped (no liquidity / graduated)`);
      if (closed > 0) parts.push(`reclaimed rent from ${closed} empty account${closed !== 1 ? "s" : ""}`);
      toast({ title: "Sold to SOL", description: parts.join(" · ") });
    }
  }

  /**
   * Transfer ONE mint from every pool wallet to the user's main Phantom
   * wallet (no DEX involvement — works for graduated coins too).
   */
  async function transferMintAcrossPool(mint: string) {
    if (!publicKey) {
      toast({ title: "Connect your wallet", description: "Connect your main wallet to receive the tokens.", variant: "destructive" });
      return;
    }
    if (subKeypairs.length === 0 && !sessionKeypair) {
      toast({ title: "Nothing to send", description: "Unlock your sub-wallets first.", variant: "destructive" });
      return;
    }
    if (poolMintBusy || subWalletsBusy) {
      toast({ title: "Hold on", description: "Another wallet action is already running." });
      return;
    }
    setPoolMintBusy({ mint, action: "transfer" });
    const pool = [
      ...(sessionKeypair ? [sessionKeypair] : []),
      ...subKeypairs,
    ];
    let transferred = 0, failed = 0, closed = 0;
    for (const kp of pool) {
      try {
        const r = await transferTokensFromWallet(kp, publicKey, { onlyMint: mint });
        transferred += r.transferred;
        failed += r.failed;
        closed += r.closed;
      } catch { /* keep going */ }
    }
    await refreshSubBalances();
    await refetchPoolTokens();
    await refetchMainTokens();
    setPoolMintBusy(null);
    if (transferred === 0 && failed === 0) {
      toast({ title: "Nothing to send", description: "No wallet in the pool held that token." });
    } else {
      const parts: string[] = [];
      if (transferred > 0) parts.push(`Sent from ${transferred} wallet${transferred !== 1 ? "s" : ""} to your main wallet`);
      if (failed > 0)      parts.push(`${failed} failed`);
      if (closed > 0)      parts.push(`reclaimed rent from ${closed} empty account${closed !== 1 ? "s" : ""}`);
      toast({ title: "Sent to main wallet", description: parts.join(" · ") });
    }
  }

  /**
   * Push tokens FROM the user's main wallet INTO the session + sub-wallets.
   * The inverse of sweep — useful when a user has been holding tokens in
   * their main wallet and now wants to dribble them out through many
   * addresses ("organic" TWAP exit), or simply to keep a permanent bag
   * across the rotation pool for some other strategy.
   *
   * Uses the wallet adapter's signAllTransactions so the user only sees a
   * single Phantom prompt no matter how many destinations are funded.
   * Idempotent ATA creation is paid by the main wallet (~0.002 SOL per
   * brand-new destination ATA — refunded if/when the destination's ATA
   * is later closed by a sweep).
   */
  async function distributeTokenToWallets() {
    if (!publicKey || !signAllTransactions) {
      toast({ title: "Wallet not ready", description: "Connect your main wallet first.", variant: "destructive" });
      return;
    }
    if (poolMintBusy) {
      toast({ title: "Hold on", description: "A per-token action is already running. Wait for it to finish before distributing." });
      return;
    }
    const dests: PublicKey[] = [
      ...(sessionKeypair ? [sessionKeypair.publicKey] : []),
      ...subKeypairs.map(k => k.publicKey),
    ];
    if (dests.length === 0) {
      toast({ title: "No destinations", description: "Generate or unlock sub-wallets first.", variant: "destructive" });
      return;
    }
    const holding = mainTokens.find(t => t.mint === distTokenMint);
    if (!holding) {
      toast({ title: "Pick a token", description: "Select one of your main wallet's tokens to distribute.", variant: "destructive" });
      return;
    }
    const pct = Math.max(1, Math.min(100, parseFloat(distTokenPercent) || 100));
    // Percentage applied in BigInt (× pct/100 with 2-decimal precision via /10000).
    const totalBase = (BigInt(holding.amount) * BigInt(Math.round(pct * 100))) / 10_000n;
    if (totalBase <= 0n) {
      toast({ title: "Nothing to distribute", description: "Selected amount rounds to zero.", variant: "destructive" });
      return;
    }
    const N = BigInt(dests.length);
    const perBase = totalBase / N;
    if (perBase <= 0n) {
      toast({ title: "Amount too small", description: `Need at least ${dests.length} base units to split across the rotation pool.`, variant: "destructive" });
      return;
    }
    setSubWalletsBusy("distribute");
    try {
      const mint = new PublicKey(distTokenMint);
      // Route under the correct token program. mainTokens tags every
      // holding with `tokenProgram` at fetch time — Token-2022 mints
      // would silently fail (wrong ATA derivation + transferChecked
      // program-id) if we hard-coded SPL v1.
      const tokenProgram = holding.tokenProgram === "token-2022" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
      const srcAta = getAssociatedTokenAddressSync(mint, publicKey, true, tokenProgram);
      const amounts = dests.map((_, i) =>
        i === dests.length - 1
          ? totalBase - perBase * BigInt(dests.length - 1) // last takes remainder
          : perBase
      );

      // Batch destinations into chunks small enough to fit in one ~1232-byte
      // tx. Each (idempotent ATA + TransferChecked) pair adds ~10 unique keys
      // and ~80 bytes of data; 5 destinations per tx is comfortably safe.
      const BATCH = 5;
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");
      const txs: VersionedTransaction[] = [];
      for (let i = 0; i < dests.length; i += BATCH) {
        const batchDests = dests.slice(i, i + BATCH);
        const batchAmts  = amounts.slice(i, i + BATCH);
        const ixs: TransactionInstruction[] = [];
        for (let j = 0; j < batchDests.length; j++) {
          const destAta = getAssociatedTokenAddressSync(mint, batchDests[j], true, tokenProgram);
          ixs.push(
            createAssociatedTokenAccountIdempotentInstruction(publicKey, destAta, batchDests[j], mint, tokenProgram),
            createTransferCheckedInstruction(srcAta, mint, destAta, publicKey, batchAmts[j], holding.decimals, [], tokenProgram),
          );
        }
        const msg = new TransactionMessage({
          payerKey: publicKey, recentBlockhash: blockhash, instructions: ixs,
        }).compileToV0Message();
        txs.push(new VersionedTransaction(msg));
      }

      // Single Phantom prompt for the whole batch.
      const signedTxs = await signAllTransactions(txs);
      // Defensive: every wallet adapter we care about preserves order, but
      // the contract isn't airtight in the spec — bail loudly if the wallet
      // returned the wrong number of signed txs.
      if (signedTxs.length !== txs.length) {
        throw new Error(`Wallet returned ${signedTxs.length} signed txs but ${txs.length} were sent for signing`);
      }

      // Broadcast ALL txs first (no per-tx await), then confirm them in
      // parallel against the original blockhash + lastValidBlockHeight.
      // The serial confirm-then-send loop we had before could easily blow
      // past the ~60s blockhash validity window once you get past ~5
      // batches, killing the tail of the fan-out. With ~101 max
      // destinations and BATCH=5 that's up to 21 txs — sequential confirms
      // would have been a guaranteed footgun.
      let okCount = 0, failCount = 0;
      const sendResults = await Promise.allSettled(signedTxs.map(tx =>
        connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false, maxRetries: 3,
        }),
      ));
      const sigs: string[] = [];
      for (const r of sendResults) {
        if (r.status === "fulfilled") sigs.push(r.value);
        else failCount++;
      }
      const confirmResults = await Promise.allSettled(sigs.map(signature =>
        connection.confirmTransaction(
          { signature, blockhash, lastValidBlockHeight },
          "confirmed",
        ),
      ));
      for (const r of confirmResults) {
        if (r.status === "fulfilled" && !r.value.value.err) okCount++;
        else failCount++;
      }
      await refetchMainTokens();
      const totalUi = Number(totalBase) / Math.pow(10, holding.decimals);
      toast({
        title: failCount === 0 ? "Tokens distributed" : "Partially distributed",
        description: `${okCount}/${signedTxs.length} batch${signedTxs.length !== 1 ? "es" : ""} landed · ${totalUi.toLocaleString(undefined, { maximumFractionDigits: 4 })} tokens spread across ${dests.length} wallet${dests.length !== 1 ? "s" : ""}. Switch to "Sell tokens for SOL" sweep mode when you're ready to TWAP-exit.`,
        variant: failCount > 0 ? "destructive" : "default",
      });
    } catch (err: any) {
      toast({ title: "Distribute failed", description: err?.message || "Transaction rejected", variant: "destructive" });
    } finally {
      setSubWalletsBusy(null);
    }
  }

  /**
   * Resolve the active TWAP preset to {chunks, delaySec}. The presets
   * mirror the four UI buttons; "custom" reads the user's own inputs.
   */
  function effectiveTwapConfig(): { chunks: number; delaySec: number } {
    if (twapPreset === "fast")     return { chunks: 3,  delaySec: 10 };
    if (twapPreset === "balanced") return { chunks: 5,  delaySec: 30 };
    if (twapPreset === "slow")     return { chunks: 10, delaySec: 60 };
    // custom — clamp into sane bounds so a stray "999" can't wedge the bot
    const c = Math.max(1, Math.min(20, parseInt(twapChunks, 10) || 1));
    const d = Math.max(0, Math.min(600, parseInt(twapDelaySec, 10) || 0));
    return { chunks: c, delaySec: d };
  }

  function handleClearSubWallets() {
    // Same isolation rule as forgetVault: when derived mode owns
    // subKeypairs, the legacy clear path would zero them out while leaving
    // derivedConfig + inDerivedMode stale. Force the explicit exit.
    if (inDerivedMode) {
      toast({
        title: "You're in derived mode",
        description: "Use \"Exit derived mode\" in the green card above instead of forgetting the legacy sub-wallets.",
        variant: "destructive",
      });
      return;
    }
    const doClear = () => {
      clearSubWallets();
      setSubKeypairs([]);
      setSubPubkeysFromVault([]);
      setHasSubVault(false);
      setSubBalances({});
      setSubVaultMode(null);
      setSubVaultSigner(null);
      setShowMigratePrompt(false);
      setMigratePass("");
      toast({ title: "Sub-wallets cleared" });
    };

    // If subs are locked we can't sweep — fall back to plain confirm. The
    // user has to consciously accept the risk; the platform-holdings panel
    // above is the recovery path for stranded funds.
    if (subKeypairs.length === 0) {
      if (!confirm("Forget sub-wallets on this device? Make sure you've swept their funds first — once cleared, the keys are gone forever.")) return;
      doClear();
      return;
    }

    setRegenGuard({
      title: `Forget ${subKeypairs.length} sub-wallet${subKeypairs.length === 1 ? "" : "s"}?`,
      subtitle: "The encrypted keys will be permanently deleted from this device. Send the funds back to your main wallet first to keep them safe.",
      pubkeys: subKeypairs.map(k => k.publicKey.toBase58()),
      sweepAvailable: true,
      onSweep: async () => { await sweepAll("transfer"); },
      onProceed: () => { doClear(); },
    });
  }

  function copySessionKey() {
    if (!sessionKeypair) return;
    const secret = bs58.encode(sessionKeypair.secretKey);
    navigator.clipboard?.writeText(secret).then(
      () => toast({ title: "Private key copied", description: "Import into Phantom under 'Add wallet → Import private key'." }),
      () => toast({ title: "Copy failed", description: "Reveal the key and copy manually.", variant: "destructive" }),
    );
  }

  /**
   * Tracks which session/sub wallets currently have an in-flight delegation
   * attempt. Prevents duplicate concurrent POSTs (and duplicate main-wallet
   * popups) when the auto-delegation effect re-runs while a popup is open.
   * NOT permanent: cleared in finally so a rejected delegation can be retried
   * the next time the effect runs (e.g., after lock/unlock).
   */
  const delegationInFlightRef = useRef<Set<string>>(new Set());

  /**
   * Cached signed consume-auth grant token. Each bump POST sends this so the
   * server can prove the request really comes from someone authorized to
   * spend the owner's credits (closes the credit-drain DoS where any caller
   * could spam another wallet's address). Format matches server
   * bumpConsumeMessage(): "paif-bump-consume|v1|owner|signer|expiryMs".
   *
   * - In session mode the primary session keypair signs in-memory (no popup).
   * - In wallet mode the owner signs via Phantom signMessage (one popup per
   *   grant lifetime; we use ~50min so a cold start can complete a 1h bot run).
   *
   * Re-issued automatically when the cached token has < 5 minutes remaining.
   */
  const consumeAuthRef = useRef<{
    ownerWallet: string;
    signerWallet: string;
    expiryMs: number;
    signature: string;
  } | null>(null);
  const consumeAuthInFlightRef = useRef<Promise<typeof consumeAuthRef.current> | null>(null);
  const CONSUME_GRANT_TTL_MS = 50 * 60 * 1000;        // sign 50min grants
  const CONSUME_GRANT_REFRESH_MS = 5 * 60 * 1000;     // refresh when <5min left

  /**
   * Returns a fresh-enough consume-auth grant token, signing a new one if
   * cached is missing or near-expiry. Uses primary session keypair when one
   * is available (no popup); falls back to wallet signMessage (one Phantom
   * popup per ~50min) when in wallet mode.
   */
  async function getOrSignConsumeAuth(): Promise<typeof consumeAuthRef.current> {
    if (!publicKey) return null;
    const owner = publicKey.toBase58();
    const cached = consumeAuthRef.current;
    if (
      cached &&
      cached.ownerWallet === owner &&
      cached.expiryMs - Date.now() > CONSUME_GRANT_REFRESH_MS
    ) {
      return cached;
    }
    // Coalesce concurrent callers onto one in-flight signing job so we don't
    // pop multiple Phantom prompts when several bumps fire in quick succession.
    if (consumeAuthInFlightRef.current) return consumeAuthInFlightRef.current;

    const job = (async () => {
      const expiryMs = Date.now() + CONSUME_GRANT_TTL_MS;
      let signerWallet = owner;
      let sigBytes: Uint8Array | null = null;

      // Prefer signing with the primary session keypair (in-memory, no popup).
      const primary = walletPool[0];
      if (primary) {
        signerWallet = primary.publicKey.toBase58();
        const message = `paif-bump-consume|v1|${owner}|${signerWallet}|${expiryMs}`;
        const { ed25519 } = await import("@noble/curves/ed25519");
        const seed = primary.secretKey.slice(0, 32);
        sigBytes = ed25519.sign(new TextEncoder().encode(message), seed);
      } else {
        // Wallet mode: ask the connected wallet to sign via signMessage.
        if (!signMessage) throw new Error("Wallet does not support signMessage");
        const message = `paif-bump-consume|v1|${owner}|${signerWallet}|${expiryMs}`;
        sigBytes = await signMessage(new TextEncoder().encode(message));
      }
      const token = {
        ownerWallet: owner,
        signerWallet,
        expiryMs,
        signature: bs58.encode(sigBytes),
      };
      consumeAuthRef.current = token;
      return token;
    })();
    consumeAuthInFlightRef.current = job;
    try {
      return await job;
    } finally {
      consumeAuthInFlightRef.current = null;
    }
  }

  /**
   * Best-effort POST to /api/credits/claim-trial that grants 5 free trial
   * credits exactly once for a wallet that proves ownership via signMessage.
   * Quietly no-ops if the wallet has already claimed (idempotent on server).
   */
  async function maybeClaimFreeTrial() {
    if (!publicKey || !signMessage) return;
    const owner = publicKey.toBase58();
    try {
      // Skip the popup if the wallet already has a balance — saves friction
      // for returning users.
      const r0 = await fetch(`/api/credits/${owner}`);
      if (r0.ok) {
        const j = await r0.json();
        if (j?.balance > 0) return;
      }
      const nonce = Date.now();
      const message = `paif-claim-trial|v1|${owner}|${nonce}`;
      const sigBytes = await signMessage(new TextEncoder().encode(message));
      await fetch("/api/credits/claim-trial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerWallet: owner, nonce, signature: bs58.encode(sigBytes) }),
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/credits", owner] });
    } catch {
      // User rejected or network glitch — they can still buy a pack on /upgrade.
    }
  }

  /**
   * Ask the connected MAIN wallet (via wallet-adapter signMessage) to sign a
   * "delegate session wallet X to log bump history under me" attestation,
   * then POST it to the server. One popup per (owner, session) pair, ever.
   */
  async function delegateSessionWalletWithMainWallet(sessionPub: string) {
    if (!publicKey || !signMessage) return false;
    const ownerWallet = publicKey.toBase58();
    const nonce = Date.now();
    const msg = `paif-bump-delegate|v1|${ownerWallet}|${sessionPub}|${nonce}`;
    let sigBytes: Uint8Array;
    try {
      sigBytes = await signMessage(new TextEncoder().encode(msg));
    } catch (err: any) {
      // User rejected — surface a friendly toast and bail. The user can
      // retry by re-locking + re-unlocking the session wallet.
      toast({
        title: "History logging not authorized",
        description: "Bumps will still execute, but won't appear in your persistent history until you authorize this session wallet.",
        variant: "destructive",
      });
      return false;
    }
    const r = await fetch("/api/bump-history/delegate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ownerWallet,
        sessionWallet:   sessionPub,
        delegatorWallet: ownerWallet,
        nonce,
        signature: bs58.encode(sigBytes),
      }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
      toast({ title: "Delegation failed", description: err.error || "Could not register session wallet for history.", variant: "destructive" });
      return false;
    }
    return true;
  }

  /**
   * Use an already-delegated keypair (the primary session wallet) to sign a
   * delegation for a sub-wallet. No wallet popup needed.
   */
  async function delegateSubWalletWithSession(parentKp: Keypair, sessionPub: string): Promise<boolean> {
    if (!publicKey) return false;
    const ownerWallet = publicKey.toBase58();
    const nonce = Date.now();
    const msg = `paif-bump-delegate|v1|${ownerWallet}|${sessionPub}|${nonce}`;
    const { ed25519 } = await import("@noble/curves/ed25519");
    const seed = parentKp.secretKey.slice(0, 32);
    const sigBytes = ed25519.sign(new TextEncoder().encode(msg), seed);
    const r = await fetch("/api/bump-history/delegate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ownerWallet,
        sessionWallet:   sessionPub,
        delegatorWallet: parentKp.publicKey.toBase58(),
        nonce,
        signature: bs58.encode(sigBytes),
      }),
    });
    return r.ok;
  }

  /**
   * Auto-ensure delegations exist for the primary + all sub-wallets after
   * the wallet connects / sessions are loaded. The server tells us which
   * sessions are already delegated so we skip the popup on subsequent
   * unlocks. Re-runs when wallet connection or wallet pool changes.
   */
  useEffect(() => {
    if (!publicKey || !sessionKeypair) return;
    let cancelled = false;
    (async () => {
      const ownerWallet = publicKey.toBase58();
      // Pull current server-side delegations for this owner
      let delegated = new Set<string>();
      try {
        const r = await fetch(`/api/bump-history/delegations/${ownerWallet}`);
        if (r.ok) {
          const j = await r.json();
          delegated = new Set((j.delegations || []).map((x: any) => x.sessionWallet));
        }
      } catch { /* offline — skip until next render */ }
      if (cancelled) return;

      // 1. Primary session: the canonical path is now "user clicks Fund →
      // funding tx itself authorizes the session wallet" (single popup). So
      // we DON'T eagerly trigger a signMessage popup here. Two safe fallback
      // cases where we still want the legacy attestation:
      //   (a) the session was already funded externally (sessionBalance > 0)
      //       and the user never clicked Fund, so no funding tx exists to
      //       derive delegation from;
      //   (b) the user is loading a previously-saved session that lost its
      //       delegation row (rare) but already has SOL.
      // In both cases sessionBalance > 0 and delegation is missing — fall
      // back to the signMessage popup so bumping can start.
      const primaryPub = sessionKeypair.publicKey.toBase58();
      const primaryKey = `${ownerWallet}:${primaryPub}`;
      const externallyFunded = sessionBalance > 0;
      if (
        !delegated.has(primaryPub) &&
        !delegationInFlightRef.current.has(primaryKey) &&
        signMessage &&
        externallyFunded
      ) {
        delegationInFlightRef.current.add(primaryKey);
        try {
          const ok = await delegateSessionWalletWithMainWallet(primaryPub);
          if (ok) delegated.add(primaryPub);
        } finally {
          delegationInFlightRef.current.delete(primaryKey);
        }
      }
      if (cancelled || !delegated.has(primaryPub)) return;

      // 2. Sub-wallets: primary signs for each (no popup)
      for (const sub of subKeypairs) {
        const subPub = sub.publicKey.toBase58();
        const subKey = `${ownerWallet}:${subPub}`;
        if (delegated.has(subPub) || delegationInFlightRef.current.has(subKey)) continue;
        delegationInFlightRef.current.add(subKey);
        try {
          const ok = await delegateSubWalletWithSession(sessionKeypair, subPub);
          if (ok) delegated.add(subPub);
        } finally {
          delegationInFlightRef.current.delete(subKey);
        }
        if (cancelled) return;
      }
    })();
    return () => { cancelled = true; };
    // We depend on `sessionBalance > 0` (not the raw value) so the effect
    // re-runs exactly once when external funding flips the session from
    // empty → funded, triggering the signMessage fallback. Using the raw
    // number would re-fire on every 15s balance poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey?.toBase58(), sessionKeypair, subKeypairs, sessionBalance > 0]);

  /**
   * Persist a bump record to the server so the user can see it after logout.
   * Best-effort: history failures never affect the trading flow.
   *
   * The session keypair signs a canonical message binding the record to
   * itself + the owner wallet — this is what the server uses to verify
   * the request actually came from someone holding the session key (rather
   * than an unauthenticated attacker spamming arbitrary records).
   */
  async function logBumpToServer(args: {
    signerKp: Keypair;
    action: BumpAction;
    amountSol: number | null;
    amountTokens: number | null;
    txSignature: string | null;
    status: BumpStatus;
    errorMessage?: string | null;
  }) {
    if (!publicKey) return;
    try {
      const ownerWallet   = publicKey.toBase58();
      const sessionWallet = args.signerKp.publicKey.toBase58();
      const nonce         = Date.now();
      // Canonical message — order MUST match server bumpHistoryMessage()
      const message = [
        "paif-bump-history", "v1",
        ownerWallet, sessionWallet, tokenAddress,
        args.action,
        String(args.amountSol ?? ""),
        String(args.amountTokens ?? ""),
        args.txSignature ?? "",
        args.status,
        String(nonce),
      ].join("|");
      // Sign with the session keypair using @noble/curves ed25519
      const { ed25519 } = await import("@noble/curves/ed25519");
      const msgBytes = new TextEncoder().encode(message);
      // Solana secretKey is 64 bytes (32 seed + 32 pubkey); ed25519.sign needs the 32-byte seed
      const seed = args.signerKp.secretKey.slice(0, 32);
      const sigBytes = ed25519.sign(msgBytes, seed);
      const signature = bs58.encode(sigBytes);
      await fetch("/api/bump-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerWallet,
          sessionWallet,
          mint:          tokenAddress,
          tokenSymbol:   null,
          action:        args.action,
          amountSol:     args.amountSol,
          amountTokens:  args.amountTokens,
          txSignature:   args.txSignature,
          status:        args.status,
          errorMessage:  args.errorMessage ?? null,
          nonce,
          signature,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/bump-history", ownerWallet] });
    } catch {
      /* best-effort */
    }
  }

  // ── Core bump executor ───────────────────────────────────────────────────
  // `bumpIndex` is 0-based and drives BOTH the wallet rotation (each wallet
  // handles `bumpsPerWallet` consecutive bumps via pickWalletIndex) and the
  // cycling list amount mode. The same index is
  // passed into `pickAmountSol` so list mode advances deterministically.
  async function executeBump(bumpIndex: number): Promise<boolean> {
    if (bumpLockRef.current) return false;
    bumpLockRef.current = true;

    setCurrentlyBumping(true);
    if (!slippageValid) {
      bumpLockRef.current = false;
      setCurrentlyBumping(false);
      toast({ title: "Invalid slippage", description: "Slippage must be a number between 1 and 50.", variant: "destructive" });
      return false;
    }
    const slipBps = Math.round(slipNum * 100);

    // ── Credit owner ───────────────────────────────────────────────────────
    // The bump bot consumes one credit per fired bump; the *owner* (main
    // wallet) is the credit authority even when a sub/session wallet signs
    // the actual SOL transfer. We require a connected main wallet so we can
    // attribute the spend — without it there's no balance to debit.
    if (!publicKey) {
      bumpLockRef.current = false;
      setCurrentlyBumping(false);
      toast({
        title: "Connect your main wallet",
        description: "Bump credits are tied to your main wallet — connect Phantom to continue.",
        variant: "destructive",
      });
      setBotState("stopped");
      if (countdownRef.current) clearInterval(countdownRef.current);
      setCountdown(0);
      return false;
    }
    const ownerWalletForCredits = publicKey.toBase58();

    // ── Pick signer ────────────────────────────────────────────────────────
    // In session mode: round-robin through walletPool.
    // In wallet mode:  always sign with the connected user wallet.
    let signerKp: Keypair | null = null;
    let buyerPubkey: PublicKey | null = null;

    if (usingSession) {
      if (walletPool.length === 0) {
        bumpLockRef.current = false;
        setCurrentlyBumping(false);
        toast({ title: "No session wallet", description: "Generate or unlock a session wallet first.", variant: "destructive" });
        return false;
      }
      // Build the list of pool indexes that actually have enough SOL to pay
      // for the upper bound of this bump. The primary session wallet (idx 0)
      // is checked via sessionBalance; sub-wallets via the cached subBalances
      // map (refreshed every 20s). This keeps random rotation from picking
      // wallets that would just throw "underfunded" and create the illusion
      // that rotation isn't happening.
      // Use the MIN bump threshold so a wallet that can cover the smallest
      // amount in the range is considered usable. The per-bump preflight
      // below will still bail out cleanly if this particular dice roll
      // happens to need more than the wallet currently holds.
      const need = minPerBumpRequiredLamports;
      const eligible: number[] = [];
      for (let i = 0; i < walletPool.length; i++) {
        const kp = walletPool[i];
        const bal = i === 0
          ? sessionBalance
          : (subBalances[kp.publicKey.toBase58()] ?? 0);
        if (bal >= need) eligible.push(i);
      }
      // If nothing's funded, fall back to the full pool so the existing
      // per-signer preflight produces a clear underfunded toast instead of
      // us silently doing nothing.
      const pickIdx = pickWalletIndex(
        bumpIndex,
        walletPool.length,
        eligible.length > 0 ? eligible : undefined,
      );
      signerKp = walletPool[pickIdx];
      buyerPubkey = signerKp.publicKey;
    } else {
      buyerPubkey = publicKey;
    }
    if (!buyerPubkey) {
      bumpLockRef.current = false;
      setCurrentlyBumping(false);
      return false;
    }

    let amount = 0;
    let signature: string | null = null;
    // Pre-buy snapshot of the buyer wallet's balance for the target mint.
    // Captured INSIDE the buy branch below before the tx is sent, then used
    // by the post-buy auto-forward hook to compute the delta from THIS buy.
    // Defaulting to 0n means "skip forward" if we never snapshotted (sell,
    // or auto-forward disabled, or RPC blip).
    let preBuyTokenBalance: bigint = 0n;
    let didSnapshotPreBuy = false;

    try {
      // 1. Build transaction on the server
      let endpoint: string;
      let body: any;

      if (bumpAction === "buy") {
        const sol = pickAmountSol(bumpIndex);
        if (!(sol > 0)) throw new Error("Computed bump amount is 0");
        amount = sol;

        // Snapshot the buyer's pre-buy balance for the target mint so the
        // post-buy auto-forward only ships THIS buy's delta and never
        // accidentally drains pre-existing holdings. Skipped when not
        // enabled to avoid the extra RPC on every bump.
        if (autoForwardEnabled && signerKp) {
          preBuyTokenBalance = await readOwnerMintBalance(signerKp.publicKey, tokenAddress);
          didSnapshotPreBuy = true;
        }

        // Per-signer funding preflight. The global sessionReadyVar gate only
        // checks the PRIMARY session wallet; sub-wallets are funded
        // independently and may be empty if the user forgot to distribute.
        // Without this check, an underfunded sub would silently fail every
        // Nth bump in the rotation.
        if (usingSession && signerKp) {
          const need = Math.ceil(sol * LAMPORTS_PER_SOL * (10000 + PAIF_TOTAL_BPS + PUMP_BPS) / 10000)
                     + GAS_HEADROOM_LAMPORTS + RENT_EXEMPT_RESERVE_LAMPORTS;
          let have = 0;
          try {
            have = await connection.getBalance(signerKp.publicKey, "confirmed");
          } catch {
            // RPC failed — let the build/send path surface the real error
            have = need; // assume OK so we don't false-positive on RPC blip
          }
          if (have < need) {
            throw new Error(
              `Sub-wallet ${signerKp.publicKey.toBase58().slice(0,6)}… underfunded: ` +
              `${(have / LAMPORTS_PER_SOL).toFixed(4)} SOL on hand, ` +
              `${(need / LAMPORTS_PER_SOL).toFixed(4)} SOL needed for this ${sol} SOL bump. ` +
              `Use “Distribute from primary” to fund sub-wallets.`
            );
          }
        }

        endpoint = "/api/pump/bump-buy-tx";
        body = {
          mint: tokenAddress,
          userPublicKey: buyerPubkey.toBase58(),
          ownerWallet:   ownerWalletForCredits,
          solLamports: Math.round(sol * LAMPORTS_PER_SOL),
          slippageBps: slipBps,
        };
      } else {
        const tokens = parseFloat(tokensPerSell);
        amount = tokens;
        endpoint = "/api/pump/bump-sell-tx";
        body = {
          mint: tokenAddress,
          userPublicKey: buyerPubkey.toBase58(),
          ownerWallet:   ownerWalletForCredits,
          tokenAmount: tokens,
          decimals: 6,                        // pump.fun standard
          slippageBps: slipBps,
        };
      }

      // Attach the consume-auth grant token. The server requires it to debit
      // credits — without it, anyone could spam the endpoint with a victim's
      // wallet and drain their balance.
      const consumeAuth = await getOrSignConsumeAuth();
      if (!consumeAuth) {
        throw new Error("Could not obtain credit-spend authorization");
      }
      body.auth = {
        signerWallet: consumeAuth.signerWallet,
        expiryMs:     consumeAuth.expiryMs,
        signature:    consumeAuth.signature,
      };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      // Out-of-credits — server is the single source of truth. Auto-stop the
      // bot and bounce the user to /upgrade. No client-side gate before this
      // call so the credit decrement and tx build always happen together.
      if (res.status === 402) {
        setBotState("stopped");
        if (countdownRef.current) clearInterval(countdownRef.current);
        setCountdown(0);
        toast({
          title: "Out of bump credits",
          description: "Bot stopped. Visit /upgrade to top up.",
          variant: "destructive",
        });
        if (publicKey) {
          void queryClient.invalidateQueries({ queryKey: ["/api/credits", publicKey.toBase58()] });
        }
        setLocation("/upgrade");
        throw new Error("Out of bump credits");
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || "Failed to build transaction");
      }
      // Refresh credit-balance badge so the UI shows the new debit.
      if (publicKey) {
        void queryClient.invalidateQueries({ queryKey: ["/api/credits", publicKey.toBase58()] });
      }
      const { transaction: txBase64 } = await res.json();
      if (!txBase64) throw new Error("Server returned no transaction");

      // 2. Deserialise + sign (wallet popup OR session keypair)
      const txBytes = Uint8Array.from(atob(txBase64), c => c.charCodeAt(0));
      let raw: Uint8Array;

      if (usingSession && signerKp) {
        // Sign with in-browser session key — no popup
        const vtx = VersionedTransaction.deserialize(txBytes);
        vtx.sign([signerKp]);
        raw = vtx.serialize();
      } else {
        if (!signTransaction) throw new Error("Wallet missing signTransaction");
        let signedTx: Transaction | VersionedTransaction;
        try {
          const vtx = VersionedTransaction.deserialize(txBytes);
          signedTx = await signTransaction(vtx as any);
        } catch {
          const tx = Transaction.from(txBytes);
          signedTx = await signTransaction(tx as any);
        }
        raw = signedTx instanceof VersionedTransaction
          ? signedTx.serialize()
          : (signedTx as Transaction).serialize();
      }

      // 3. Send + reconcile
      signature = await connection.sendRawTransaction(raw, {
        skipPreflight: false,
        maxRetries: 3,
      });
      try {
        const cr = await connection.confirmTransaction(signature, "confirmed");
        if (cr.value?.err) throw new Error(`On-chain failure: ${JSON.stringify(cr.value.err)}`);
      } catch (confirmErr: any) {
        // Reconcile via signature status before declaring failure
        const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
        const conf = status.value?.confirmationStatus;
        const onchainErr = status.value?.err;
        if ((conf === "confirmed" || conf === "finalized") && onchainErr) {
          throw new Error(`On-chain failure: ${JSON.stringify(onchainErr)}`);
        }
        if (conf !== "confirmed" && conf !== "finalized") {
          throw confirmErr;
        }
      }

      setBumpCount(c => c + 1);
      addLog({
        status: "success",
        action: bumpAction,
        amount,
        txid: signature,
        timestamp: new Date(),
        signer: signerKp ? signerKp.publicKey.toBase58() : buyerPubkey.toBase58(),
      });
      toast({
        title: `${bumpAction === "buy" ? "Buy" : "Sell"} bump #${bumpIndex + 1} sent`,
        description: `${amount} ${bumpAction === "buy" ? "SOL" : "tokens"} · ${signature.slice(0, 12)}…`,
      });
      // Only log to server-side history when a session keypair is available
      // to sign the canonical message (server enforces session-key signature).
      // In wallet mode the user signs each bump in their own wallet anyway
      // and can find the same activity in any Solana explorer.
      if (signerKp) {
        logBumpToServer({
          signerKp,
          action:       bumpAction,
          amountSol:    bumpAction === "buy" ? amount : null,
          amountTokens: bumpAction === "sell" ? amount : null,
          txSignature:  signature,
          status:       "success",
        });
      }
      if (usingSession) refreshSessionBalance();

      // Auto-forward the just-bought tokens off the buyer wallet to user-
      // chosen destination(s). Fire-and-forget — a failure toasts but never
      // blocks the next bump (the bump credit was already burned and the
      // buy already landed; forwarding is gravy on top).
      //
      // CORRECTNESS — only forwards the DELTA from this buy, not the full
      // sub-wallet balance for the mint. Without delta scoping, turning on
      // auto-forward would drain any pre-existing holdings (e.g., earlier
      // unforwarded bumps, manual buys parked in the sub) the moment the
      // next bump lands. The pre-buy snapshot was taken above just before
      // the tx fired; if it didn't run (RPC blip, mode mismatch) we skip
      // the forward entirely rather than guessing.
      if (autoForwardEnabled && bumpAction === "buy" && signerKp && publicKey) {
        const dests = buildForwardDestinations();
        if (!dests) {
          // Surface the silent-skip case — UI shows a red note but the bot
          // would otherwise just keep running with forwarding "on but not
          // doing anything," which is worse than telling the user.
          toast({
            title: "Auto-forward skipped",
            description: "Fix the destination rows — percentages must sum to 100 and addresses must be valid.",
            variant: "destructive",
          });
        } else if (!didSnapshotPreBuy) {
          toast({
            title: "Auto-forward skipped",
            description: "Could not snapshot pre-buy balance — skipping forward to avoid sweeping pre-existing tokens.",
            variant: "destructive",
          });
        } else {
          const sourceKp = signerKp;
          const preBal   = preBuyTokenBalance;
          void (async () => {
            // Re-read post-buy balance; delta = whatever this buy added.
            const postBal = await readOwnerMintBalance(sourceKp.publicKey, tokenAddress);
            const delta   = postBal - preBal;
            if (delta <= 0n) {
              // No delta — either the buy returned 0 tokens (shouldn't happen
              // but defends against on-chain failure that still confirmed),
              // OR a concurrent forward already drained it. Either way,
              // silently skip — toasting would be noise on rapid rotations.
              return;
            }
            const r = await forwardBoughtTokens(sourceKp, tokenAddress, dests, delta);
            if (r.ok && r.sig) {
              toast({
                title: "Auto-forwarded",
                description: `Tokens sent to ${dests.length === 1 ? "main wallet" : `${dests.length} destinations`} · ${r.sig.slice(0, 12)}…`,
              });
            } else {
              toast({
                title: "Auto-forward failed",
                description: r.err ?? "Unknown error",
                variant: "destructive",
              });
            }
          })();
        }
      }
      return true;
    } catch (err: any) {
      const rawMsg = err?.message || "Unknown error";
      // Surface user-rejected wallet popup more clearly
      const friendly = /reject|denied|user/i.test(rawMsg)
        ? "Transaction rejected in wallet"
        : rawMsg;
      const msg = signature ? `${friendly} (sig ${signature.slice(0,12)}…)` : friendly;
      addLog({
        status: "failed",
        action: bumpAction,
        amount,
        error: msg,
        timestamp: new Date(),
        signer: signerKp ? signerKp.publicKey.toBase58() : (buyerPubkey?.toBase58?.() ?? undefined),
      });
      toast({ title: "Bump failed", description: msg, variant: "destructive" });
      if (signerKp) {
        logBumpToServer({
          signerKp,
          action:       bumpAction,
          amountSol:    bumpAction === "buy" ? amount : null,
          amountTokens: bumpAction === "sell" ? amount : null,
          txSignature:  signature,
          status:       "failed",
          errorMessage: msg.slice(0, 500),
        });
      }
      return false;
    } finally {
      setCurrentlyBumping(false);
      bumpLockRef.current = false;
    }
  }

  function startCountdown(secs: number, onDone: () => void) {
    setCountdown(secs);
    let remaining = secs;
    countdownRef.current = setInterval(() => {
      remaining -= 1;
      setCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(countdownRef.current!);
        if (botStateRef.current === "running") onDone();
      }
    }, 1000);
  }

  // The runNextBump implementation is rewritten on every render and stored
  // in `runNextBumpRef`. Timers always invoke `() => runNextBumpRef.current()`
  // so they pick up the freshest closure (correct bumpIndex, walletPool,
  // amount config, etc.) instead of capturing a stale snapshot at the time
  // setInterval/setTimeout was scheduled.
  runNextBumpRef.current = async () => {
    if (botStateRef.current !== "running") return;
    const max = Math.max(1, parseInt(maxBumps) || 0);
    const idx = bumpIndexRef.current;
    if (idx >= max) {
      setBotState("stopped");
      toast({ title: "Bump bot finished", description: `All ${max} bumps completed.` });
      return;
    }
    await executeBump(idx);
    // Advance index regardless of bump success — failed bumps still count
    // toward the requested total AND should rotate to the next wallet so a
    // single underfunded sub doesn't get hit repeatedly.
    bumpIndexRef.current = idx + 1;
    if (botStateRef.current !== "running") return;
    if (bumpIndexRef.current >= max) {
      setBotState("stopped");
      toast({ title: "Bump bot finished", description: `All ${max} bumps completed.` });
      return;
    }
    startCountdown(nextDelaySecs(), () => { void runNextBumpRef.current(); });
  };

  // Risk acknowledgment — shown once per browser session before the bot
  // can start. Persisted in sessionStorage so a refresh re-prompts but
  // navigating between pages doesn't.
  const [riskOpen, setRiskOpen] = useState(false);
  const RISK_ACK_KEY = "paif:bump-risk-ack-v1";
  function hasRiskAck() {
    try { return sessionStorage.getItem(RISK_ACK_KEY) === "1"; } catch { return false; }
  }
  function setRiskAck() {
    try { sessionStorage.setItem(RISK_ACK_KEY, "1"); } catch {}
  }

  function preflightChecks(): boolean {
    if (!connected) { setLoginOpen(true); return false; }
    if (!slippageValid) {
      toast({ title: "Invalid slippage", description: "Slippage must be a number between 1% and 50%.", variant: "destructive" });
      return false;
    }
    if (!amountModeValid) {
      toast({ title: "Invalid amount config", description: "Check your fixed amount, range, or list values.", variant: "destructive" });
      return false;
    }
    if (usingSession && !sessionReadyVar) {
      toast({
        title: "Fund the rotation pool first",
        description: `At least one wallet (session or a sub) needs ${(minPerBumpRequiredLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL to fire the smallest bump. Use the amber Auto-fund button or send SOL to your session wallet.`,
        variant: "destructive",
      });
      return false;
    }
    return true;
  }

  function actuallyStart() {
    bumpIndexRef.current = 0;
    lastWalletIndexRef.current = -1;
    setBotState("running");
    setBumpCount(0);
    setBumpLog([]);
    // Kick off via the ref so the very first bump and all subsequent ones
    // share the same scheduling path and stale-closure-free index.
    setTimeout(() => { void runNextBumpRef.current(); }, 100);
  }

  function handleStart() {
    if (!preflightChecks()) return;
    if (!hasRiskAck()) { setRiskOpen(true); return; }
    actuallyStart();
  }

  function handleRiskAccept() {
    setRiskAck();
    setRiskOpen(false);
    actuallyStart();
  }

  function handleStop() {
    setBotState("stopped");
    if (countdownRef.current) clearInterval(countdownRef.current);
    setCountdown(0);
  }

  function handleReset() {
    setBotState("idle");
    setBumpCount(0);
    setBumpLog([]);
    setCountdown(0);
    if (countdownRef.current) clearInterval(countdownRef.current);
  }

  useEffect(() => () => { if (countdownRef.current) clearInterval(countdownRef.current); }, []);

  // Warn before leaving in two cases:
  //   1. A bump tx is currently in flight (refresh would leave it orphaned in our UI).
  //   2. The session is EPHEMERAL (no encrypted vault on disk) AND holds funds/tokens —
  //      refreshing would destroy the only copy of the key.
  // If a vault exists on this device, the user can simply unlock after refresh, so we
  // don't pester them with a warning.
  useEffect(() => {
    function beforeUnload(e: BeforeUnloadEvent) {
      const ephemeralWithFunds = sessionKeypair && !hasVault &&
        (sessionBalance > 10_000 || sessionTokens > 0);
      if (ephemeralWithFunds || currentlyBumping) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [sessionKeypair, sessionBalance, sessionTokens, currentlyBumping, hasVault]);

  const isRunning = botState === "running";

  // Whether this wallet has the unlimited-subwallets pack. Drives the higher
  // sub-wallet generation cap so the "Unlimited" tier actually unlocks the
  // wider count slider.
  const ownerWalletKey = publicKey?.toBase58() ?? null;
  const { data: creditInfo } = useQuery<{ balance: number; unlimitedSubwallets: boolean; unlimitedUntil: string | null; maxSubwallets: number }>({
    queryKey: ["/api/credits", ownerWalletKey],
    enabled: !!ownerWalletKey,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
  // Server is the source of truth on the per-tier sub-wallet cap. It returns
  // 0 for unknown wallets, MAX_SUB_WALLETS for the free trial, and tier-
  // specific caps for paid wallets. We fall back to the free-trial cap so the
  // UI isn't disabled when credits haven't loaded yet.
  const effectiveMaxSubWallets = (creditInfo?.maxSubwallets ?? 0) > 0
    ? creditInfo!.maxSubwallets
    : MAX_SUB_WALLETS;

  // Live Solana fee estimate so the UI can warn the user when network
  // congestion makes per-bump network fees expensive. The user's session/sub
  // wallet pays these on-chain — we don't subsidize. Refetched every 30s so
  // congestion spikes don't catch the bot under-funded.
  const { data: feeEst } = useQuery<{
    microLamportsPerCu: number; computeUnits: number; priorityLamports: number;
    baseLamports: number; totalLamports: number; totalSol: number; totalUsd: number;
    solPriceUsd: number; congestion: "low"|"medium"|"high"; recommendedPerBumpLamports: number;
  }>({
    queryKey: ["/api/network/fee-estimate"],
    staleTime: 25_000,
    refetchInterval: 30_000,
  });
  // Mirror the live estimate into the headroom state used by perBump preflight
  // so congestion-driven cost changes immediately tighten the funding gate.
  useEffect(() => {
    if (feeEst?.recommendedPerBumpLamports) {
      setLiveGasHeadroomLamports(feeEst.recommendedPerBumpLamports);
    }
  }, [feeEst?.recommendedPerBumpLamports]);
  const isStopped = botState === "stopped" || botState === "idle";
  const sessionAddrShort = sessionKeypair
    ? `${sessionKeypair.publicKey.toBase58().slice(0,4)}…${sessionKeypair.publicKey.toBase58().slice(-4)}`
    : "";
  const savedAddrShort = savedPubkey
    ? `${savedPubkey.slice(0,4)}…${savedPubkey.slice(-4)}`
    : "";

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <BotTabs />

        {/* Page header */}
        <div className="flex items-start gap-3 mb-6">
          <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex-shrink-0">
            <ChevronUp className="w-6 h-6 text-emerald-500" />
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground" data-testid="text-page-title">Pump.fun Bump Bot</h1>
            <p className="text-sm text-muted-foreground">Periodic buys or sells on the bonding curve to keep your token visible</p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <CreditBalance />
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              Beta
            </span>
          </div>
        </div>

        <OpenInPhantomBanner className="mb-6" />

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* ─────────── LEFT: config + status ─────────── */}
          <div className="lg:col-span-3 space-y-4">

            {/* Cross-wallet visibility — surfaces every session wallet the user
                has ever traded from (via server bump_history) plus their CURRENT
                on-chain balance. Critical for users whose old session vaults
                got overwritten in localStorage when they generated new ones —
                without this view, stranded funds in old wallets are invisible. */}
            {publicKey && (
              <PlatformHoldingsCard
                mainWalletPubkey={publicKey.toBase58()}
                unlockedPubkeys={[
                  ...(sessionKeypair ? [sessionKeypair.publicKey.toBase58()] : []),
                  ...subKeypairs.map(k => k.publicKey.toBase58()),
                ]}
                knownPubkeys={[
                  ...(savedPubkey ? [savedPubkey] : []),
                  ...(sessionKeypair ? [sessionKeypair.publicKey.toBase58()] : []),
                  ...subPubkeysFromVault,
                  ...subKeypairs.map(k => k.publicKey.toBase58()),
                ]}
                sessionVaultPubkey={savedPubkey ?? null}
                subVaultPubkeys={[
                  ...subPubkeysFromVault,
                  ...subKeypairs.map(k => k.publicKey.toBase58()),
                ]}
                onUnlockRequest={(pubkey, vault) => {
                  // Jump to the matching unlock card and flash a ring on it
                  // so the user can spot it without scanning. We can't auto-
                  // submit because passphrase mode needs typed input and
                  // signature mode needs a Phantom prompt — the user has
                  // to take the final action themselves.
                  const id = vault === "sub" ? "unlock-sub-wallets-card" : "unlock-session-card";
                  const el = document.getElementById(id);
                  if (el) {
                    el.scrollIntoView({ behavior: "smooth", block: "center" });
                    // Tailwind ring utilities — added then removed so the
                    // flash is one-shot, not sticky. transition-shadow on
                    // the card class makes the fade smooth.
                    const ringClasses = ["ring-4", "ring-emerald-500", "ring-offset-2", "ring-offset-background"];
                    el.classList.add(...ringClasses);
                    setTimeout(() => el.classList.remove(...ringClasses), 2400);
                  }
                  toast({
                    title: vault === "sub" ? "Unlock your sub-wallets" : "Unlock your session wallet",
                    description: "Once unlocked, scroll back up — a per-token cash-out panel appears with Sell to SOL + Send to main wallet buttons.",
                  });
                }}
              />
            )}
            {/* ── Session wallet panel (only when session mode chosen) ── */}
            {usingSession && (
              <CollapsibleSection
                id="unlock-session-card"
                testid="card-session-wallet"
                className="border-amber-300/50 dark:border-amber-700/50 transition-shadow"
                title="Session Wallet"
                icon={<KeyRound className="w-4 h-4 text-amber-500" />}
              >

                  {!sessionKeypair && hasVault ? (
                    /* ── Sub-state: vault exists on this device but not unlocked ── */
                    <>
                      {sessionVaultMode === "signature" ? (
                        /* ── Signature-mode unlock: one Phantom tap ── */
                        <>
                          <p className="text-[11px] text-muted-foreground leading-relaxed">
                            This session wallet is locked with your wallet — one Phantom tap unlocks it.
                            Your funds and tokens are safe; only the in-memory key was cleared.
                          </p>
                          <div className="rounded-lg bg-muted/40 border border-border p-3 space-y-1">
                            <p className="text-[10px] uppercase font-bold text-muted-foreground">Saved address</p>
                            <p className="text-xs font-mono text-foreground" data-testid="text-saved-address">{savedAddrShort}</p>
                            {sessionVaultSigner && (
                              <>
                                <p className="text-[10px] uppercase font-bold text-muted-foreground mt-1.5">Locked with wallet</p>
                                <p className="text-[11px] font-mono text-foreground" data-testid="text-session-vault-signer">
                                  {sessionVaultSigner.slice(0, 6)}…{sessionVaultSigner.slice(-6)}
                                </p>
                              </>
                            )}
                          </div>
                          {sessionVaultSigner && publicKey && publicKey.toBase58() !== sessionVaultSigner && (
                            <p className="text-[11px] text-amber-600 dark:text-amber-400" data-testid="text-wrong-wallet-warning">
                              Connect the wallet shown above to unlock this session.
                            </p>
                          )}
                          {unlockError && (
                            <p className="text-[11px] text-rose-500" data-testid="text-unlock-error">{unlockError}</p>
                          )}
                          <Button
                            onClick={unlockSessionWithSignature}
                            className="w-full bg-black hover:bg-black/90 text-white dark:bg-white dark:hover:bg-white/90 dark:text-black"
                            disabled={
                              !publicKey ||
                              !signMessage ||
                              sessionBusy === "unlock" ||
                              !!(sessionVaultSigner && publicKey && publicKey.toBase58() !== sessionVaultSigner)
                            }
                            data-testid="button-unlock-session-signature"
                          >
                            {sessionBusy === "unlock"
                              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Unlocking…</>
                              : <><Lock className="w-4 h-4 mr-2" /> Unlock with Phantom (one tap)</>}
                          </Button>
                          <button
                            onClick={forgetVault}
                            className="text-[11px] text-muted-foreground hover:text-rose-500 underline"
                            data-testid="button-forget-vault-locked"
                          >
                            Forget saved wallet
                          </button>
                        </>
                      ) : (
                        /* ── Passphrase-mode unlock (legacy v1 or user-chosen) ── */
                        <>
                          <p className="text-[11px] text-muted-foreground leading-relaxed">
                            A saved session wallet was found on this device. Enter your passphrase to unlock it
                            and resume hands-free bumping. Your funds and tokens are safe — only the in-memory
                            key was cleared.
                          </p>
                          <div className="rounded-lg bg-muted/40 border border-border p-3 space-y-1">
                            <p className="text-[10px] uppercase font-bold text-muted-foreground">Saved address</p>
                            <p className="text-xs font-mono text-foreground" data-testid="text-saved-address">{savedAddrShort}</p>
                          </div>

                          {/* Migration banner — only when a wallet is connected and the vault
                              is still in passphrase mode. One typed passphrase + one Phantom
                              tap upgrades to one-tap-forever. */}
                          {publicKey && signMessage && !showSessionMigratePrompt && (
                            <button
                              onClick={() => setShowSessionMigratePrompt(true)}
                              className="w-full text-left text-[11px] rounded-md border border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400 px-2.5 py-2 hover:bg-emerald-500/10"
                              data-testid="button-show-session-migrate-prompt"
                            >
                              ⚡ Switch to one-tap Phantom unlock (no more typing)
                            </button>
                          )}
                          {showSessionMigratePrompt && (
                            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 space-y-2">
                              <p className="text-[11px] text-emerald-700 dark:text-emerald-400 leading-relaxed">
                                Type your current passphrase one last time, then approve one Phantom signature.
                                Your session address and balances stay the same.
                              </p>
                              <Input
                                type="password"
                                placeholder="Current passphrase"
                                value={sessionMigratePass}
                                onChange={e => setSessionMigratePass(e.target.value)}
                                className="text-sm h-9"
                                data-testid="input-session-migrate-passphrase"
                              />
                              <div className="flex gap-2">
                                <Button
                                  onClick={migrateSessionToSignature}
                                  size="sm"
                                  className="flex-1 bg-black hover:bg-black/90 text-white dark:bg-white dark:hover:bg-white/90 dark:text-black"
                                  disabled={!sessionMigratePass || sessionBusy === "unlock"}
                                  data-testid="button-session-migrate-confirm"
                                >
                                  {sessionBusy === "unlock"
                                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Switching…</>
                                    : "Enable one-tap unlock"}
                                </Button>
                                <Button
                                  onClick={() => { setShowSessionMigratePrompt(false); setSessionMigratePass(""); }}
                                  size="sm" variant="outline"
                                  data-testid="button-session-migrate-cancel"
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          )}

                          <div className="space-y-2">
                            <Input
                              type="password"
                              placeholder="Passphrase"
                              value={unlockPass}
                              onChange={e => { setUnlockPass(e.target.value); setUnlockError(null); }}
                              onKeyDown={e => { if (e.key === "Enter") unlockSession(); }}
                              className="text-sm"
                              data-testid="input-unlock-passphrase"
                              autoFocus
                            />
                            {unlockError && (
                              <p className="text-[11px] text-rose-500" data-testid="text-unlock-error">{unlockError}</p>
                            )}
                            <Button onClick={unlockSession}
                              className="w-full bg-black hover:bg-black/90 text-white dark:bg-white dark:hover:bg-white/90 dark:text-black"
                              disabled={!unlockPass || sessionBusy === "unlock"}
                              data-testid="button-unlock-session">
                              {sessionBusy === "unlock"
                                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Unlocking…</>
                                : <><Lock className="w-4 h-4 mr-2" /> Unlock session wallet</>}
                            </Button>
                            <button
                              onClick={forgetVault}
                              className="text-[11px] text-muted-foreground hover:text-rose-500 underline"
                              data-testid="button-forget-vault-locked"
                            >
                              Forgot passphrase? Forget saved wallet
                            </button>
                          </div>
                        </>
                      )}
                    </>
                  ) : !sessionKeypair ? (
                    /* ── Sub-state: no vault yet — generation form ── */
                    <>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        A session wallet is a separate key your browser generates. You sign <b>one</b> transaction
                        to fund it from your main wallet. After that, the bot signs each bump itself — no popups.
                        When you're done, sweep the remaining SOL back to your wallet.
                      </p>

                      {/* Default path when wallet is connected: SIGNATURE mode (one Phantom tap). */}
                      {publicKey && signMessage && persistOnDevice && !showSessionPassphraseGen ? (
                        <>
                          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 space-y-1.5">
                            <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                              ⚡ One-tap unlock (recommended on mobile)
                            </p>
                            <p className="text-[10px] text-muted-foreground leading-snug">
                              We'll ask your wallet to sign a short message. That signature becomes the local
                              encryption key — same wallet, same signature, every time. No passphrase to type
                              or remember. Nothing is moved, no funds are touched by signing.
                            </p>
                          </div>

                          <label className="flex items-start gap-2 cursor-pointer rounded-lg border border-border bg-muted/30 p-2.5" data-testid="label-persist-toggle">
                            <input
                              type="checkbox"
                              checked={persistOnDevice}
                              onChange={e => setPersistOnDevice(e.target.checked)}
                              className="mt-0.5"
                              data-testid="checkbox-persist-on-device"
                            />
                            <div className="flex-1">
                              <p className="text-[11px] font-bold text-foreground">Save on this device (recommended)</p>
                              <p className="text-[10px] text-muted-foreground leading-snug">
                                Stores the encrypted key locally. Survives refresh. Without this, refreshing destroys the wallet.
                              </p>
                            </div>
                          </label>

                          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-[10px] text-amber-700 dark:text-amber-400 space-y-1">
                            <p><b>Honest caveats:</b></p>
                            <ul className="list-disc list-inside space-y-0.5 ml-1">
                              <li>Only fund what you're willing to lose to a stolen device.</li>
                              <li>Tokens bought go to the session wallet — import its key into Phantom to use them elsewhere.</li>
                              <li>We can't sign anything without your unlock — your main wallet stays in Phantom.</li>
                            </ul>
                          </div>

                          <Button
                            onClick={generateSessionWithSignature}
                            className="w-full bg-black hover:bg-black/90 text-white dark:bg-white dark:hover:bg-white/90 dark:text-black"
                            disabled={isRunning || currentlyBumping || sessionBusy === "generate"}
                            data-testid="button-generate-session-signature"
                          >
                            {sessionBusy === "generate"
                              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating…</>
                              : <><KeyRound className="w-4 h-4 mr-2" /> Generate with one Phantom tap</>}
                          </Button>
                        </>
                      ) : (
                        <>
                          {/* Persist toggle */}
                          <div className="rounded-lg border border-border bg-muted/30 p-2.5 space-y-2">
                            <label className="flex items-start gap-2 cursor-pointer" data-testid="label-persist-toggle">
                              <input
                                type="checkbox"
                                checked={persistOnDevice}
                                onChange={e => setPersistOnDevice(e.target.checked)}
                                className="mt-0.5"
                                data-testid="checkbox-persist-on-device"
                              />
                              <div className="flex-1">
                                <p className="text-[11px] font-bold text-foreground">Save on this device (recommended)</p>
                                <p className="text-[10px] text-muted-foreground leading-snug">
                                  Encrypts the key with your passphrase and stores it locally. Survives refresh.
                                  Without this, refreshing destroys the wallet.
                                </p>
                              </div>
                            </label>

                            {persistOnDevice && (
                              <div className="space-y-1.5 pl-5">
                                <Input
                                  type="password"
                                  placeholder="Passphrase (6+ chars)"
                                  value={genPass}
                                  onChange={e => setGenPass(e.target.value)}
                                  className="text-xs h-8"
                                  data-testid="input-gen-passphrase"
                                />
                                <Input
                                  type="password"
                                  placeholder="Confirm passphrase"
                                  value={genPass2}
                                  onChange={e => setGenPass2(e.target.value)}
                                  className="text-xs h-8"
                                  data-testid="input-gen-passphrase-confirm"
                                />
                                <p className="text-[10px] text-muted-foreground">
                                  We never see this passphrase. If you forget it, the saved wallet can't be unlocked
                                  and any unswept funds are lost.
                                </p>
                              </div>
                            )}
                          </div>

                          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-[10px] text-amber-700 dark:text-amber-400 space-y-1">
                            <p><b>Honest caveats:</b></p>
                            <ul className="list-disc list-inside space-y-0.5 ml-1">
                              <li>Only fund what you're willing to lose to a stolen device.</li>
                              <li>Tokens bought go to the session wallet — import its key into Phantom to use them elsewhere.</li>
                              <li>We can't sign anything without your unlock — your main wallet stays in Phantom.</li>
                            </ul>
                          </div>

                          <Button onClick={generateSession}
                            className="w-full bg-black hover:bg-black/90 text-white dark:bg-white dark:hover:bg-white/90 dark:text-black"
                            disabled={isRunning || currentlyBumping || sessionBusy === "generate" ||
                              (persistOnDevice && (genPass.length < 6 || genPass !== genPass2))}
                            data-testid="button-generate-session">
                            {sessionBusy === "generate"
                              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating…</>
                              : <><KeyRound className="w-4 h-4 mr-2" /> Generate session wallet</>}
                          </Button>
                          {publicKey && signMessage && showSessionPassphraseGen && (
                            <button
                              onClick={() => setShowSessionPassphraseGen(false)}
                              className="w-full text-[11px] text-muted-foreground hover:text-foreground underline"
                              data-testid="button-back-to-signature-gen"
                            >
                              ← Back to one-tap Phantom unlock
                            </button>
                          )}
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="rounded-lg bg-muted/40 border border-border p-3 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[10px] uppercase font-bold text-muted-foreground">Address</p>
                            <p className="text-xs font-mono text-foreground" data-testid="text-session-address">{sessionAddrShort}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] uppercase font-bold text-muted-foreground">Balance</p>
                            <p className="text-sm font-bold text-emerald-500" data-testid="text-session-balance">
                              {(sessionBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL
                            </p>
                            {sessionTokens > 0 && (
                              <p className="text-[10px] text-amber-500 font-bold mt-0.5" data-testid="text-session-tokens">
                                + {sessionTokens} token account{sessionTokens === 1 ? "" : "s"}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Live Solana network-gas readout. This is the
                            base-tx + priority fee paid to Solana validators —
                            it is NOT a PAIF charge. We surface it so funders
                            know roughly how much gas headroom to leave; the
                            wording is intentionally explicit so users don't
                            mistake it for a platform fee on top of credits. */}
                        {feeEst && (
                          <div
                            className="flex flex-col gap-0.5 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-[10px] text-muted-foreground"
                            data-testid="banner-network-fee"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold uppercase tracking-wide">
                                Solana network gas
                              </span>
                              <span className="font-mono text-foreground" data-testid="text-network-fee-cost">
                                ~{feeEst.totalSol.toFixed(6)} SOL
                                {feeEst.totalUsd > 0 && ` (~$${feeEst.totalUsd.toFixed(4)})`} / bump
                              </span>
                            </div>
                            <span className="text-[9.5px] leading-tight">
                              Your wallet pays Solana validators directly · PAIF's bot just fires each bump on your request · PAIF takes 0%.
                            </span>
                          </div>
                        )}

                        {/* Fund */}
                        <div className="flex items-center gap-2">
                          <Input type="number" min="0.005" step="0.005"
                            value={sessionFundAmount}
                            onChange={e => setSessionFundAmount(e.target.value)}
                            disabled={isRunning || sessionBusy === "fund"}
                            className="text-sm font-bold w-24" data-testid="input-fund-amount" />
                          <span className="text-[10px] text-muted-foreground">SOL</span>
                          <Button onClick={fundSession} size="sm" disabled={!connected || isRunning || !!sessionBusy}
                            data-testid="button-fund-session" className="ml-auto">
                            {sessionBusy === "fund" ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <ArrowDownToLine className="w-3 h-3 mr-1" />}
                            Fund
                          </Button>
                        </div>

                        {/* Persistence badge */}
                        <div className="flex items-center justify-between gap-2 -mt-1">
                          {hasVault ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400" data-testid="badge-saved-on-device">
                              <ShieldCheck className="w-3 h-3" /> Encrypted on this device
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400" data-testid="badge-ephemeral">
                              <AlertTriangle className="w-3 h-3" /> In-memory only — refresh destroys
                            </span>
                          )}
                        </div>

                        {/* Sweep + utility */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <Button onClick={() => sweepSession()} size="sm"
                            disabled={isRunning || !!sessionBusy || sessionBalance < 6_000}
                            data-testid="button-sweep-session"
                            className="bg-black hover:bg-black/90 text-white dark:bg-white dark:hover:bg-white/90 dark:text-black"
                            title={
                              sweepMode === "transfer" ? "Sends every token (intact) and every SOL from this session wallet to your main Phantom wallet"
                              : sweepMode === "sell" ? "Sells tokens to SOL in chunks, then sends every SOL from this session wallet to your main Phantom wallet"
                              : "Sends every SOL from this session wallet to your main Phantom wallet (tokens stay behind)"
                            }>
                            {sessionBusy === "sweep" ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <ArrowUpFromLine className="w-3 h-3 mr-1" />}
                            {sweepMode === "transfer" ? "Send everything to my main wallet"
                              : sweepMode === "sell" ? "Sell tokens, then send SOL"
                              : "Send SOL only"}
                          </Button>
                          <Button onClick={refreshSessionBalance} size="sm" variant="ghost" data-testid="button-refresh-session">
                            <Loader2 className={`w-3 h-3 mr-1 ${sessionBusy === "refresh" ? "animate-spin" : ""}`} />
                            Refresh
                          </Button>
                          <Button onClick={clearSession} size="sm" variant="ghost"
                            disabled={isRunning || currentlyBumping || !!sessionBusy}
                            data-testid="button-clear-session"
                            className="text-rose-500 hover:text-rose-600"
                            title={
                              isRunning || currentlyBumping
                                ? "Stop the bot and wait for the current bump to settle first"
                                : hasVault
                                  ? "Drops the unlocked key from memory. Encrypted copy stays — unlock later."
                                  : sessionTokens > 0
                                    ? "Wallet holds tokens — export private key first or you'll lose them"
                                    : ""
                            }>
                            {hasVault ? "Lock" : "Clear"}
                          </Button>
                          {hasVault && (
                            <Button onClick={forgetVault} size="sm" variant="ghost"
                              disabled={isRunning || currentlyBumping || !!sessionBusy}
                              data-testid="button-forget-vault"
                              className="text-rose-500 hover:text-rose-600"
                              title="Permanently delete the encrypted key from this device">
                              Forget on this device
                            </Button>
                          )}
                        </div>

                        {/* Export private key */}
                        <div className="pt-2 border-t border-border/50 space-y-2">
                          <button
                            onClick={() => setShowSessionKey(s => !s)}
                            className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                            data-testid="button-toggle-session-key"
                          >
                            {showSessionKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                            {showSessionKey ? "Hide private key" : "Reveal private key (for Phantom import)"}
                          </button>
                          {showSessionKey && (
                            <div className="space-y-1.5">
                              <textarea
                                readOnly
                                value={bs58.encode(sessionKeypair.secretKey)}
                                className="w-full h-16 text-[10px] font-mono p-2 rounded border border-border bg-background resize-none"
                                data-testid="text-session-secret"
                                onFocus={e => e.target.select()}
                              />
                              <Button onClick={copySessionKey} size="sm" variant="outline" className="text-xs"
                                data-testid="button-copy-session-key">
                                <Copy className="w-3 h-3 mr-1" /> Copy
                              </Button>
                              <p className="text-[10px] text-rose-500">
                                Anyone with this string controls the session wallet. Save it somewhere safe, never share.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
              </CollapsibleSection>
            )}

            <CollapsibleSection
              testid="card-bump-config"
              title="Bump Settings"
              icon={<Zap className="w-4 h-4 text-emerald-500" />}
              bodyClassName="space-y-5"
            >

                {/* Quick mode — preset tiles. Picking one bulk-applies sub-wallet
                    count + amount mode + amount values. "Custom" reveals every
                    knob below. */}
                <div>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Quick Mode</p>
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold" data-testid="text-preset-visibility-note">
                      Note: bumps may not yet appear in pump.fun's "Latest Trades" feed
                    </p>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {(Object.keys(BOT_PRESETS) as Array<Exclude<BotPreset, "custom">>).map(k => {
                      const cfg = BOT_PRESETS[k];
                      const active = botPreset === k;
                      const isRecommended = k === "standard";
                      return (
                        <button key={k} onClick={() => applyPreset(k)} disabled={isRunning}
                          data-testid={`button-preset-${k}`}
                          className={`relative p-2.5 rounded-lg border text-left transition-colors ${active ? "border-emerald-500 bg-emerald-500/10" : isRecommended ? "border-emerald-500/50 hover:border-emerald-500" : "border-border hover:border-foreground/40"}`}>
                          {isRecommended && (
                            <span
                              className="absolute -top-2 left-2 px-1.5 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wide bg-emerald-500 text-white"
                              data-testid="badge-preset-recommended">
                              Recommended
                            </span>
                          )}
                          <p className={`text-xs font-bold ${active ? "text-emerald-500" : "text-foreground"}`}>{cfg.label}</p>
                          <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{cfg.blurb}</p>
                        </button>
                      );
                    })}
                    <button onClick={() => applyPreset("custom")} disabled={isRunning}
                      data-testid="button-preset-custom"
                      className={`p-2.5 rounded-lg border text-left transition-colors ${botPreset === "custom" ? "border-emerald-500 bg-emerald-500/10" : "border-border hover:border-foreground/40"}`}>
                      <p className={`text-xs font-bold ${botPreset === "custom" ? "text-emerald-500" : "text-foreground"}`}>Custom</p>
                      <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">Tune every knob yourself</p>
                    </button>
                  </div>
                </div>

                {/* 0. Buy / Sell direction */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">1. Trade Direction</p>
                  <div className="flex gap-2 p-1 rounded-xl bg-muted/40 border border-border w-fit" data-testid="bump-action-switch">
                    <button
                      onClick={() => setBumpAction("buy")}
                      disabled={isRunning}
                      data-testid="button-action-buy"
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${bumpAction === "buy" ? "bg-emerald-500 text-white" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      <ArrowDownToDot className="w-3.5 h-3.5" /> Buy bumps
                    </button>
                    <button
                      onClick={() => setBumpAction("sell")}
                      disabled={isRunning}
                      data-testid="button-action-sell"
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${bumpAction === "sell" ? "bg-rose-500 text-white" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      <ArrowUpFromLine className="w-3.5 h-3.5" /> Sell bumps
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1.5">
                    {bumpAction === "buy"
                      ? "Buys tokens with SOL on each bump."
                      : "Sells tokens for SOL on each bump. You must already hold the token."}
                  </p>
                </div>

                {/* Token */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">2. Pump.fun Token Address</p>
                  <Input
                    placeholder="e.g. 7Qb...mR3vpump"
                    value={tokenAddress}
                    onChange={e => setTokenAddress(e.target.value.trim())}
                    disabled={isRunning}
                    className={`font-mono text-xs ${tokenAddress && !addrValid ? "border-red-400" : ""}`}
                    data-testid="input-token-address"
                  />
                  {tokenAddress && !addrValid && (
                    <p className="text-[11px] text-red-500 mt-1 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {tokenAddress.length <= 30 ? "Address too short" : 'Must be a pump.fun token (address ends in "pump")'}
                    </p>
                  )}
                  {addrValid && (
                    <p className="text-[11px] text-emerald-500 mt-1 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Pump.fun bonding curve token detected
                    </p>
                  )}
                </div>

                {/* Amount */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">
                    3. {bumpAction === "buy" ? "SOL per Bump" : "Tokens per Sell"}
                  </p>
                  {bumpAction === "buy" ? (
                    <>
                      {/* Mode picker — only shown in Custom mode. Presets pin
                          the mode so it just shows the matching value input. */}
                      {botPreset === "custom" && (
                        <div className="flex gap-1.5 mb-3" role="tablist">
                          {([
                            { v: "fixed", label: "Fixed" },
                            { v: "range", label: "Random range" },
                            { v: "list",  label: "Cycling list" },
                          ] as const).map(opt => (
                            <button key={opt.v}
                              onClick={() => setAmountMode(opt.v)}
                              disabled={isRunning}
                              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${amountMode === opt.v ? "border-emerald-500 bg-emerald-500/10 text-emerald-500" : "border-border text-muted-foreground hover:text-foreground"}`}
                              data-testid={`button-amount-mode-${opt.v}`}>
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                      {botPreset !== "custom" && (
                        <p className="text-[11px] text-muted-foreground mb-2">
                          <span className="font-bold text-foreground">{BOT_PRESETS[botPreset].label}</span> preset ·{" "}
                          {amountMode === "fixed" ? "fixed amount" : amountMode === "range" ? "random range" : "cycling list"}
                          {" "}— values below.
                        </p>
                      )}

                      {amountMode === "fixed" && (
                        <>
                          <div className="flex gap-1.5 flex-wrap mb-2">
                            {SOL_PRESETS.map(v => (
                              <button key={v} onClick={() => setSolPerBump(String(v))} disabled={isRunning}
                                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${solPerBump === String(v) ? "border-emerald-500 bg-emerald-500/10 text-emerald-500" : "border-border text-muted-foreground hover:text-foreground"}`}
                                data-testid={`button-sol-preset-${v}`}>{v} SOL</button>
                            ))}
                          </div>
                          <Input
                            type="number" min="0.001" max="10" step="0.0005"
                            value={solPerBump}
                            onChange={e => setSolPerBump(e.target.value)}
                            disabled={isRunning}
                            className="w-36 text-sm font-bold"
                            data-testid="input-sol-per-bump"
                          />
                          <p className="text-[11px] text-muted-foreground mt-1">
                            Minimum 0.001 SOL per bump. <span className="font-bold text-foreground">Use ≥ {PUMPFUN_VISIBILITY_FLOOR_SOL} SOL</span> to appear in pump.fun's public "Latest Trades" feed.
                          </p>
                          {parseFloat(solPerBump) > 0 && parseFloat(solPerBump) < PUMPFUN_VISIBILITY_FLOOR_SOL && (
                            <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-400" data-testid="warn-visibility-fixed">
                              <b>Heads up:</b> bumps below {PUMPFUN_VISIBILITY_FLOOR_SOL} SOL still execute on-chain and move the bonding curve, but pump.fun's UI typically hides them from the public trade feed.
                            </div>
                          )}
                        </>
                      )}

                      {amountMode === "range" && (
                        <>
                          <div className="flex items-center gap-2 text-xs">
                            <Input
                              type="number" min="0.001" max="10" step="0.001"
                              value={solRangeMin}
                              onChange={e => {
                                const v = e.target.value;
                                setSolRangeMin(v);
                                const min = parseFloat(v);
                                const max = parseFloat(solRangeMax);
                                if (Number.isFinite(min) && Number.isFinite(max) && min > max) setSolRangeMax(v);
                              }}
                              disabled={isRunning}
                              className="w-28 text-sm font-bold" data-testid="input-sol-range-min"
                            />
                            <span className="text-muted-foreground">to</span>
                            <Input
                              type="number" min="0.001" max="10" step="0.001"
                              value={solRangeMax}
                              onChange={e => {
                                const v = e.target.value;
                                setSolRangeMax(v);
                                const max = parseFloat(v);
                                const min = parseFloat(solRangeMin);
                                if (Number.isFinite(min) && Number.isFinite(max) && max < min) setSolRangeMin(v);
                              }}
                              disabled={isRunning}
                              className="w-28 text-sm font-bold" data-testid="input-sol-range-max"
                            />
                            <span className="text-muted-foreground">SOL</span>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-1">
                            Each bump picks a uniform random amount in this range — looks more like organic trading.
                          </p>
                          {!amountModeValid && (
                            <p className="text-[11px] text-rose-500 mt-1" data-testid="text-range-error">
                              {!(rangeMinNum >= 0.001)
                                ? "Minimum must be at least 0.001 SOL."
                                : !(rangeMaxNum >= rangeMinNum)
                                  ? "Maximum must be at least the minimum amount."
                                  : "Maximum can't be more than 10 SOL."}
                            </p>
                          )}
                          {parseFloat(solRangeMin) > 0 && parseFloat(solRangeMin) < PUMPFUN_VISIBILITY_FLOOR_SOL && (
                            <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-400" data-testid="warn-visibility-range">
                              <b>Heads up:</b> the range minimum is below {PUMPFUN_VISIBILITY_FLOOR_SOL} SOL — any roll below that floor still executes on-chain but won't show in pump.fun's public "Latest Trades" feed.
                            </div>
                          )}
                        </>
                      )}

                      {amountMode === "list" && (
                        <>
                          <Input
                            type="text"
                            value={solList}
                            onChange={e => setSolList(e.target.value)}
                            disabled={isRunning}
                            placeholder="0.001, 0.003, 0.005"
                            className="w-full max-w-md text-sm font-mono"
                            data-testid="input-sol-list"
                          />
                          <p className="text-[11px] text-muted-foreground mt-1">
                            Comma-separated SOL amounts. Bumps cycle through the list and wrap around
                            {parsedSolList.length > 0 && (
                              <> — {parsedSolList.length} value{parsedSolList.length !== 1 ? "s" : ""} parsed</>
                            )}.
                          </p>
                          {!amountModeValid && (
                            <p className="text-[11px] text-rose-500 mt-1">Each value must be between 0.001 and 10 SOL.</p>
                          )}
                          {parsedSolList.length > 0 && parsedSolList.some(n => n < PUMPFUN_VISIBILITY_FLOOR_SOL) && (
                            <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-400" data-testid="warn-visibility-list">
                              <b>Heads up:</b> {parsedSolList.filter(n => n < PUMPFUN_VISIBILITY_FLOOR_SOL).length} of your {parsedSolList.length} list values are below {PUMPFUN_VISIBILITY_FLOOR_SOL} SOL. Those bumps still execute on-chain but won't show in pump.fun's public "Latest Trades" feed.
                            </div>
                          )}
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <Input
                        type="number" min="1" step="1"
                        value={tokensPerSell}
                        onChange={e => setTokensPerSell(e.target.value)}
                        disabled={isRunning}
                        className="w-44 text-sm font-bold"
                        data-testid="input-tokens-per-sell"
                      />
                      <p className="text-[11px] text-muted-foreground mt-1">Number of tokens to sell each bump.</p>
                    </>
                  )}
                </div>

                {/* Delay */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">4. Delay Between Bumps</p>
                  <div className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-2 text-[11px] leading-snug text-amber-700 dark:text-amber-400" data-testid="notice-browser-open">
                    <strong>Keep this browser tab open</strong> for the whole schedule — this bot runs on your device, so closing it (or sleeping your computer) stops the bumps. Want to set a long timer and walk away completely? Use{" "}
                    <a href="/vaults" className="underline font-bold">Vaults</a> for fully autonomous, server-side trading that runs even with your computer off.
                  </div>
                  <div className="flex gap-1.5 flex-wrap mb-2">
                    {DELAY_PRESETS.map(p => (
                      <button key={p.secs}
                        onClick={() => { setDelayPreset(p.secs); setCustomDelay(c => ({ ...c, enabled: false })); }}
                        disabled={isRunning}
                        className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${!customDelay.enabled && delayPreset === p.secs ? "border-emerald-500 bg-emerald-500/10 text-emerald-500" : "border-border text-muted-foreground hover:text-foreground"}`}
                        data-testid={`button-delay-${p.secs}`}>{p.label}</button>
                    ))}
                    <button
                      onClick={() => setCustomDelay(c => ({ ...c, enabled: !c.enabled }))}
                      disabled={isRunning}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${customDelay.enabled ? "border-emerald-500 bg-emerald-500/10 text-emerald-500" : "border-border text-muted-foreground hover:text-foreground"}`}
                      data-testid="button-delay-custom"
                    >
                      Custom…
                    </button>
                  </div>
                  {customDelay.enabled && (
                    <div className="flex items-center gap-2 text-xs">
                      <Input type="number" min="0" max="48"  value={customDelay.h}
                        onChange={e => setCustomDelay(c => ({ ...c, h: e.target.value }))}
                        disabled={isRunning} className="w-16 text-center" data-testid="input-delay-hours" />
                      <span className="text-muted-foreground">h</span>
                      <Input type="number" min="0" max="59"  value={customDelay.m}
                        onChange={e => setCustomDelay(c => ({ ...c, m: e.target.value }))}
                        disabled={isRunning} className="w-16 text-center" data-testid="input-delay-minutes" />
                      <span className="text-muted-foreground">m</span>
                      <Input type="number" min="0" max="59"  value={customDelay.s}
                        onChange={e => setCustomDelay(c => ({ ...c, s: e.target.value }))}
                        disabled={isRunning} className="w-16 text-center" data-testid="input-delay-seconds" />
                      <span className="text-muted-foreground">s</span>
                      <span className="ml-2 text-[10px] text-muted-foreground">
                        ≈ every {formatCountdown(intervalSecs)} (min 15s)
                      </span>
                    </div>
                  )}
                  {/* Randomize timing — applies whether preset or custom is active */}
                  <div className="mt-2 flex items-center gap-2 flex-wrap rounded-md border border-violet-500/30 bg-violet-500/5 px-2.5 py-1.5"
                       data-testid="panel-jitter">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={jitterEnabled}
                        onChange={e => setJitterEnabled(e.target.checked)}
                        disabled={isRunning}
                        data-testid="checkbox-jitter-enabled"
                      />
                      <span className="text-[11px] font-bold text-foreground">Randomize timing</span>
                    </label>
                    {jitterEnabled && (
                      <>
                        <span className="text-[11px] text-muted-foreground">±</span>
                        <Input type="number" min="0" max="75" step="5"
                          value={jitterPct}
                          onChange={e => setJitterPct(e.target.value)}
                          disabled={isRunning}
                          className="w-14 h-7 text-xs font-bold text-center"
                          data-testid="input-jitter-pct" />
                        <span className="text-[11px] text-muted-foreground">
                          % &nbsp;·&nbsp; each wait lands somewhere in {Math.max(15, Math.round(intervalSecs * (1 - (parseInt(jitterPct) || 0) / 100)))}s–{Math.round(intervalSecs * (1 + (parseInt(jitterPct) || 0) / 100))}s
                        </span>
                      </>
                    )}
                    <span className="basis-full text-[10px] text-muted-foreground/80">
                      Constant intervals are the #1 bot fingerprint pump.fun watches for. Default 30%.
                    </span>
                  </div>
                </div>

                {/* Max bumps */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">5. Number of Bumps</p>
                  <div className="flex items-center gap-3 flex-wrap">
                    <Input type="number" min="1" max="1000" value={maxBumps}
                      onChange={e => setMaxBumps(e.target.value)} disabled={isRunning}
                      className="w-24 text-sm font-bold text-center" data-testid="input-max-bumps" />
                    {bumpAction === "buy" && (
                      <span className="text-xs text-muted-foreground" data-testid="text-total-cost">
                        Token cost ≈ <span className="font-bold text-foreground">{totalCost.toFixed(4)} SOL</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Slippage */}
                <div role="group" aria-labelledby="slippage-label">
                  <p id="slippage-label" className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">6. Slippage Tolerance</p>
                  <div className="flex gap-1.5 flex-wrap items-center">
                    {["3","5","10","15","25"].map(v => {
                      const active = Number(slippage) === Number(v);
                      return (
                        <button key={v} onClick={() => setSlippage(v)} disabled={isRunning}
                          aria-pressed={active}
                          aria-label={`Set slippage to ${v} percent`}
                          className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${active ? "border-emerald-500 bg-emerald-500/10 text-emerald-500" : "border-border text-muted-foreground hover:text-foreground"}`}
                          data-testid={`button-slippage-${v}`}>{v}%</button>
                      );
                    })}
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        min="1"
                        max="50"
                        step="0.5"
                        value={slippage}
                        onChange={e => setSlippage(e.target.value)}
                        disabled={isRunning}
                        aria-label="Custom slippage percentage (1 to 50)"
                        aria-invalid={!slippageValid}
                        className={`text-xs font-bold w-16 h-8 ${!slippageValid ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                        data-testid="input-slippage-custom"
                      />
                      <span className="text-[11px] text-muted-foreground" aria-hidden="true">%</span>
                    </div>
                  </div>
                  {!slippageValid && (
                    <p className="text-[10px] text-red-500 mt-1.5 leading-snug" role="alert" data-testid="text-slippage-error">
                      Slippage must be a number between 1% and 50%.
                    </p>
                  )}
                </div>

                {/* Sign mode */}
                <div className="pt-2 border-t border-border">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">7. How do you want to sign?</p>
                  <p className="text-[10px] text-muted-foreground mb-2 leading-snug">
                    Pick the trade-off you prefer: <b>full control</b> with a popup per bump, or <b>set-and-forget</b> with one popup at the start.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid="sign-mode-switch">
                    <button
                      onClick={() => setSignMode("wallet")}
                      disabled={isRunning || currentlyBumping}
                      data-testid="button-sign-wallet"
                      className={`flex items-start gap-2 p-3 rounded-lg border text-left transition-colors ${signMode === "wallet" ? "border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500/30" : "border-border hover:border-emerald-500/40"}`}
                    >
                      <WalletIcon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${signMode === "wallet" ? "text-emerald-500" : "text-muted-foreground"}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                          <p className="text-[12px] font-bold text-foreground">Manual — sign each bump</p>
                          <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Hands-on</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-snug">
                          Phantom popup pops up <b>every bump</b>. Each on-chain trade shows your <b>main wallet</b> as the signer.
                        </p>
                      </div>
                    </button>
                    <button
                      onClick={() => setSignMode("session")}
                      disabled={isRunning || currentlyBumping}
                      data-testid="button-sign-session"
                      className={`flex items-start gap-2 p-3 rounded-lg border text-left transition-colors ${signMode === "session" ? "border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500/30" : "border-border hover:border-emerald-500/40"}`}
                    >
                      <KeyRound className={`w-4 h-4 mt-0.5 flex-shrink-0 ${signMode === "session" ? "text-emerald-500" : "text-muted-foreground"}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                          <p className="text-[12px] font-bold text-foreground">Auto — session + sub-wallets</p>
                          <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500 text-white">Recommended</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-snug">
                          <b>One popup</b> to fund a session wallet — bot fires every bump after that. On-chain trades rotate through <b>multiple sub-wallets</b>, not your main one.
                        </p>
                      </div>
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1.5 leading-snug">
                    {signMode === "wallet"
                      ? <>You'll see <b>{maxBumps || "N"}</b> Phantom popups. All trades will show <b>your main wallet</b> on Solscan.</>
                      : <>You'll see <b>1</b> Phantom popup (funding). Trades will show your <b>session + sub-wallet</b> addresses on Solscan — your main wallet stays clean.</>
                    }
                  </p>
                </div>

                {/* Auto-refill controls — keeps subs topped up while the bot
                    runs so a long campaign doesn't grind to a halt as wallets
                    drain. Gated by an hourly cap so a runaway can't drain
                    the session. */}
                {usingSession && subKeypairs.length > 0 && (
                  <div className="rounded-md border border-border bg-muted/30 p-2.5 space-y-2" data-testid="panel-auto-refill">
                    <label className="flex items-start gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={autoRefillEnabled}
                        onChange={(e) => setAutoRefillEnabled(e.target.checked)}
                        className="mt-0.5"
                        data-testid="toggle-auto-refill"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold">Keep sub-wallets topped up while bot runs</p>
                        <p className="text-[11px] text-muted-foreground leading-snug">
                          When a sub drops below the threshold, the bot pulls a randomized refill from your <b>session wallet</b> — no popup, no extra signing. Capped per hour so it can't drain you.
                        </p>
                      </div>
                    </label>
                    {autoRefillEnabled && (
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <div>
                          <label className="text-[10px] text-muted-foreground font-semibold uppercase">Refill below</label>
                          <div className="relative">
                            <Input
                              type="number"
                              step="0.001"
                              min="0.001"
                              value={autoRefillThreshold}
                              onChange={(e) => setAutoRefillThreshold(e.target.value)}
                              className="h-8 text-xs pr-10"
                              data-testid="input-refill-threshold"
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">SOL</span>
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground font-semibold uppercase">Max per hour</label>
                          <div className="relative">
                            <Input
                              type="number"
                              step="0.05"
                              min="0.01"
                              value={autoRefillHourlyCapSol}
                              onChange={(e) => setAutoRefillHourlyCapSol(e.target.value)}
                              className="h-8 text-xs pr-12"
                              data-testid="input-refill-hourly-cap"
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">SOL/hr</span>
                          </div>
                        </div>
                      </div>
                    )}
                    {autoRefillEnabled && botState === "running" && (
                      <p className="text-[10px] text-muted-foreground" data-testid="text-refill-spent">
                        Refilled <b>{(refilledThisHourLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL</b> this hour · cap resets every 60 min
                      </p>
                    )}
                  </div>
                )}

                {/* Auto-forward — after every successful buy, send the just-
                    bought tokens out of the buyer sub/session wallet to one
                    or more user-chosen destinations. Only meaningful for
                    BUY bumps (sells produce SOL, which already lives in the
                    buyer wallet). Defaults OFF because the privacy tradeoff
                    isn't right for every user. */}
                {usingSession && bumpAction === "buy" && (
                  <div className="rounded-md border border-border bg-muted/30 p-2.5 space-y-2" data-testid="panel-auto-forward">
                    <label className="flex items-start gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={autoForwardEnabled}
                        onChange={(e) => setAutoForwardEnabled(e.target.checked)}
                        className="mt-0.5"
                        data-testid="toggle-auto-forward"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold">Auto-forward bought tokens after each buy</p>
                        <p className="text-[11px] text-muted-foreground leading-snug">
                          As soon as a bump-buy lands, ship the tokens out of the buyer sub-wallet to one or more destinations. Leave an address blank to send to your <b>connected wallet</b>.
                        </p>
                      </div>
                    </label>
                    {autoForwardEnabled && (
                      <div className="space-y-2 pt-1">
                        {autoForwardRows.map((row, i) => (
                          <div key={i} className="flex items-center gap-1.5" data-testid={`row-forward-${i}`}>
                            <Input
                              placeholder={i === 0 ? "Connected wallet (leave blank)" : "Destination wallet address"}
                              value={row.addr}
                              onChange={(e) => setAutoForwardRows(rs => rs.map((r, j) => j === i ? { ...r, addr: e.target.value } : r))}
                              className="flex-1 h-8 text-xs font-mono"
                              data-testid={`input-forward-addr-${i}`}
                            />
                            <div className="relative w-20 shrink-0">
                              <Input
                                type="number"
                                step="1"
                                min="1"
                                max="100"
                                value={row.pct}
                                onChange={(e) => setAutoForwardRows(rs => rs.map((r, j) => j === i ? { ...r, pct: e.target.value } : r))}
                                className="h-8 text-xs pr-6 text-right"
                                data-testid={`input-forward-pct-${i}`}
                              />
                              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none">%</span>
                            </div>
                            {autoForwardRows.length > 1 && (
                              <button
                                type="button"
                                onClick={() => setAutoForwardRows(rs => rs.filter((_, j) => j !== i))}
                                className="text-muted-foreground hover:text-rose-500 p-1 shrink-0"
                                data-testid={`button-remove-forward-${i}`}
                                aria-label="Remove destination"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                        {autoForwardRows.length < 3 && (
                          <button
                            type="button"
                            onClick={() => setAutoForwardRows(rs => [...rs, { addr: "", pct: "0" }])}
                            className="text-[11px] text-muted-foreground hover:text-foreground underline"
                            data-testid="button-add-forward-destination"
                          >
                            + Add another destination ({3 - autoForwardRows.length} left)
                          </button>
                        )}
                        {!autoForwardValid && (
                          <p className="text-[11px] text-rose-500 dark:text-rose-400" data-testid="text-forward-invalid">
                            ⚠ Percentages must sum to 100, each address must be a valid Solana pubkey (or blank for connected wallet), and no two destinations may match.
                          </p>
                        )}
                        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-[10px] text-amber-700 dark:text-amber-400 space-y-1">
                          <p><b>Honest caveats:</b></p>
                          <ul className="list-disc list-inside space-y-0.5 ml-1">
                            <li>Each forward costs ~0.000005 SOL signature fee + a one-time ~0.002 SOL ATA rent per new (destination, token) combo.</li>
                            <li>Every forward links the buyer sub-wallet to the destination on-chain — anyone reading the chain will see your subs funneling into the same address(es).</li>
                            <li>If a forward fails, the next bump still runs — failures don't refund the bump credit.</li>
                          </ul>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Clarity banner — when everything's set up, show exactly what
                    Start will do so the user doesn't second-guess. The contract
                    address up top is what gets traded; this surfaces that fact
                    next to the action button. */}
                {canStart && isStopped && (
                  <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 flex items-center gap-2" data-testid="banner-ready-to-start">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0 text-xs">
                      <p className="font-bold text-emerald-800 dark:text-emerald-200">
                        Ready to {bumpAction === "buy" ? "buy" : "sell"} <span className="font-mono">{tokenAddress.slice(0, 4)}…{tokenAddress.slice(-4)}</span>
                      </p>
                      <p className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80 leading-snug">
                        {maxBumps || "—"} bumps · {usingSession
                          ? <>{walletPool.length} wallet{walletPool.length === 1 ? "" : "s"} · randomized amounts &amp; timing{autoRefillEnabled ? " · auto-refill on" : ""}</>
                          : <>signs from your main wallet · randomized amounts &amp; timing</>}
                      </p>
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-3 pt-1">
                  {isStopped ? (
                    <Button
                      className="flex-1 font-bold"
                      onClick={handleStart}
                      disabled={!canStart && connected}
                      data-testid="button-start-bump"
                    >
                      <Play className="w-4 h-4 mr-2" />
                      Start Bumping
                    </Button>
                  ) : (
                    <Button variant="destructive" className="flex-1 font-bold" onClick={handleStop} data-testid="button-stop-bump">
                      <StopCircle className="w-4 h-4 mr-2" /> Stop Bot
                    </Button>
                  )}
                  {botState === "stopped" && (
                    <Button variant="outline" onClick={handleReset} data-testid="button-reset-bump">Reset</Button>
                  )}
                </div>
                {isStopped && connected && startBlocker && (
                  <p className="text-[11px] text-rose-500 dark:text-rose-400 text-center font-medium" data-testid="text-start-blocker">
                    ⚠ {startBlocker}
                  </p>
                )}

                {!connected && (
                  <button onClick={() => setLoginOpen(true)}
                    className="w-full text-center text-[11px] text-muted-foreground hover:text-foreground transition-colors py-1"
                    data-testid="link-connect-wallet">
                    Connect a Solana wallet to use the bump bot
                  </button>
                )}
            </CollapsibleSection>

            {/* ── Derived (storage-free) mode card ───────────────────────────
                Top-billed because it solves the "lost laptop = lost funds"
                + "device-locked" problems that the encrypted-vault flow has.
                Three states:
                  1. No config + wallet connected → first-time derive form
                  2. Config in localStorage but in-memory keys NOT loaded
                     (e.g. after a refresh / new device) → "Restore" button
                  3. In-memory keys loaded via derive → active status card
                       with resize + exit controls
                Coexists with the legacy session-wallet card below for users
                with funds parked in existing vaults. Once they sweep + the
                vault is gone, only this card remains. */}
            {usingSession && (() => {
              const derivedActive = inDerivedMode && !!sessionKeypair;
              const needsRestore = !!derivedConfig && !derivedActive;
              const wrongWalletForRestore =
                needsRestore && !!publicKey && publicKey.toBase58() !== derivedConfig!.signer;
              return (
                <CollapsibleSection
                  testid="card-derived-wallets"
                  className="border-emerald-400/60 dark:border-emerald-500/40 bg-emerald-500/[0.03] transition-shadow"
                  title="Any-device wallets (no storage)"
                  icon={<ShieldCheck className="w-4 h-4 text-emerald-500" />}
                  headerExtra={derivedActive && (
                    <span
                      className="ml-2 text-[10px] font-bold uppercase rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 px-2 py-0.5"
                      data-testid="badge-derived-active"
                    >
                      Active
                    </span>
                  )}
                >

                    {derivedActive ? (
                      /* ── State 3: derived wallets loaded into memory ── */
                      <>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          Your session + sub-wallets were derived from your Phantom signature.
                          Nothing sensitive is stored on this device or our servers — connect
                          the same Phantom on any other device and tap "Restore" to get the
                          exact same addresses back.
                        </p>
                        <div className="rounded-lg bg-muted/40 border border-border p-3 space-y-1 text-[11px]">
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">Derived from</span>
                            <span className="font-mono text-foreground" data-testid="text-derived-signer">
                              {derivedConfig!.signer.slice(0, 6)}…{derivedConfig!.signer.slice(-6)}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">Sub-wallets</span>
                            <span className="font-bold text-foreground" data-testid="text-derived-sub-count">
                              {derivedConfig!.subCount}
                            </span>
                          </div>
                        </div>

                        <div className="rounded-lg border border-border bg-muted/20 p-2.5 space-y-2">
                          <p className="text-[11px] font-bold text-foreground">Change sub-wallet count</p>
                          <p className="text-[10px] text-muted-foreground leading-snug">
                            Re-signs once with Phantom. Existing addresses don't change — new ones
                            are appended at the end.
                          </p>
                          <div className="flex gap-2">
                            <Input
                              type="number"
                              min={0}
                              max={MAX_DERIVED_SUBS}
                              value={derivedSubCountInput}
                              onChange={e => setDerivedSubCountInput(e.target.value)}
                              className="text-sm h-9 w-24"
                              data-testid="input-derived-sub-count"
                            />
                            <Button
                              size="sm"
                              onClick={() => {
                                const n = parseInt(derivedSubCountInput, 10);
                                if (!Number.isFinite(n)) {
                                  toast({ title: "Enter a number", variant: "destructive" });
                                  return;
                                }
                                deriveBumpBotWallets({ subCount: n, resizing: true });
                              }}
                              disabled={derivedBusy !== null || isRunning || currentlyBumping}
                              className="bg-black hover:bg-black/90 text-white dark:bg-white dark:hover:bg-white/90 dark:text-black"
                              data-testid="button-resize-derived-subs"
                            >
                              {derivedBusy === "resize"
                                ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />Re-deriving…</>
                                : "Apply"}
                            </Button>
                          </div>
                        </div>

                        <button
                          onClick={exitDerivedMode}
                          disabled={derivedBusy !== null || isRunning || currentlyBumping}
                          className="text-[11px] text-muted-foreground hover:text-rose-500 underline"
                          data-testid="button-exit-derived"
                        >
                          Exit derived mode (clear local keys — funds stay recoverable)
                        </button>
                      </>
                    ) : needsRestore ? (
                      /* ── State 2: config exists, in-memory keys cleared ── */
                      <>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          A derived wallet set exists for this Phantom. Tap to re-sign and
                          load the same {derivedConfig!.subCount} sub-wallet
                          {derivedConfig!.subCount === 1 ? "" : "s"} back into memory.
                        </p>
                        <div className="rounded-lg bg-muted/40 border border-border p-3 space-y-1 text-[11px]">
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">Phantom wallet</span>
                            <span className="font-mono text-foreground">
                              {derivedConfig!.signer.slice(0, 6)}…{derivedConfig!.signer.slice(-6)}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">Session address</span>
                            <span className="font-mono text-foreground" data-testid="text-derived-session-pubkey">
                              {derivedConfig!.sessionPubkey.slice(0, 4)}…{derivedConfig!.sessionPubkey.slice(-4)}
                            </span>
                          </div>
                        </div>
                        {wrongWalletForRestore && (
                          <p className="text-[11px] text-amber-600 dark:text-amber-400" data-testid="text-derived-wrong-wallet">
                            Connect the Phantom shown above to restore.
                          </p>
                        )}
                        <Button
                          onClick={restoreDerivedWallets}
                          disabled={!publicKey || !signMessage || derivedBusy !== null || wrongWalletForRestore}
                          className="w-full bg-black hover:bg-black/90 text-white dark:bg-white dark:hover:bg-white/90 dark:text-black"
                          data-testid="button-restore-derived"
                        >
                          {derivedBusy === "restore"
                            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Restoring…</>
                            : <><KeyRound className="w-4 h-4 mr-2" />Restore with one Phantom tap</>}
                        </Button>
                        <button
                          onClick={exitDerivedMode}
                          disabled={derivedBusy !== null}
                          className="text-[11px] text-muted-foreground hover:text-rose-500 underline"
                          data-testid="button-forget-derived"
                        >
                          Forget this derived set on this device
                        </button>
                      </>
                    ) : (
                      /* ── State 1: no config yet — first-time setup ── */
                      <>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          <b className="text-foreground">Recommended.</b> Your bump-bot wallets are
                          mathematically derived from one Phantom signature. Nothing is stored
                          here or on our servers. If you lose this laptop, just connect the same
                          Phantom on another device and your wallets reappear — same addresses,
                          same funds.
                        </p>
                        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-[10px] text-emerald-700 dark:text-emerald-400 space-y-1">
                          <p><b>Why this is the safest option:</b></p>
                          <ul className="list-disc list-inside space-y-0.5 ml-1">
                            <li>No encrypted vault file to back up or lose.</li>
                            <li>No passphrase to remember or mis-type.</li>
                            <li>Works the same on iPhone, iPad, laptop — anywhere Phantom runs.</li>
                            <li>If our servers vanished, you'd still recover everything.</li>
                          </ul>
                        </div>
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-[10px] text-amber-700 dark:text-amber-400 space-y-1">
                          <p><b>Honest caveat:</b> anyone who tricks you into signing this exact
                          message in another app could derive these wallets. The message is long
                          and labeled — only sign it on paif.fun. Only fund what you'd accept
                          losing to client-side compromise.</p>
                        </div>
                        <div className="rounded-lg border border-border bg-muted/20 p-2.5 space-y-2">
                          <label className="text-[11px] font-bold text-foreground" htmlFor="input-derived-sub-count-initial">
                            How many sub-wallets? (you can change this later)
                          </label>
                          <Input
                            id="input-derived-sub-count-initial"
                            type="number"
                            min={0}
                            max={MAX_DERIVED_SUBS}
                            value={derivedSubCountInput}
                            onChange={e => setDerivedSubCountInput(e.target.value)}
                            className="text-sm h-9 w-24"
                            data-testid="input-derived-sub-count-initial"
                          />
                          <p className="text-[10px] text-muted-foreground leading-snug">
                            5 is plenty for most users. Max {MAX_DERIVED_SUBS}.
                          </p>
                        </div>
                        <Button
                          onClick={() => {
                            const n = parseInt(derivedSubCountInput, 10);
                            if (!Number.isFinite(n)) {
                              toast({ title: "Enter a number", variant: "destructive" });
                              return;
                            }
                            deriveBumpBotWallets({ subCount: n });
                          }}
                          disabled={!publicKey || !signMessage || derivedBusy !== null || isRunning || currentlyBumping}
                          className="w-full bg-black hover:bg-black/90 text-white dark:bg-white dark:hover:bg-white/90 dark:text-black"
                          data-testid="button-derive-wallets"
                        >
                          {derivedBusy === "derive"
                            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Deriving…</>
                            : <><KeyRound className="w-4 h-4 mr-2" />Derive my wallets (one Phantom tap)</>}
                        </Button>
                        {!publicKey && (
                          <p className="text-[11px] text-muted-foreground text-center">
                            Connect your Phantom wallet at the top of the page first.
                          </p>
                        )}
                      </>
                    )}
                </CollapsibleSection>
              );
            })()}


            {/* Nudge: if the session wallet is up but no sub-wallets exist
                yet, prompt the user to set them up. Without rotation, every
                bump comes from the same address and DexScreener flags the
                token as single-maker (the little box icon). */}
            {usingSession && sessionKeypair && !hasSubVault && (
              <div
                className="rounded-lg border border-violet-400/40 bg-violet-500/5 px-4 py-3 flex items-start gap-3"
                data-testid="callout-setup-subs"
              >
                <Users className="w-4 h-4 text-violet-500 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <p className="text-xs font-bold text-foreground">Next: set up sub-wallets ↓</p>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    Bumping from just your session wallet means every trade comes from the same address —
                    DexScreener flags this as single-maker volume (the small box icon). Generate a few
                    sub-wallets below to rotate trades across multiple addresses for organic-looking activity.
                  </p>
                </div>
              </div>
            )}

            {/* Sub-wallets card — only when in session sign mode and a primary
                session wallet exists, so the UI doesn't suggest sub-wallets
                without their parent. */}
            {usingSession && sessionKeypair && (
              <CollapsibleSection
                id="unlock-sub-wallets-card"
                testid="card-sub-wallets"
                className="border-violet-300/50 dark:border-violet-700/50 transition-shadow"
                title="Sub-wallets (rotation pool)"
                icon={<Users className="w-4 h-4 text-violet-500" />}
              >
                  <p className="text-[11px] text-muted-foreground -mt-2">
                    Spread bumps across multiple addresses. The bot rotates through{" "}
                    <span className="font-bold text-foreground">{walletPool.length || 1}</span> wallet{walletPool.length === 1 ? "" : "s"}{" "}
                    {walletPool.length > 1 ? "(primary + sub-wallets)" : "(just primary so far — generate sub-wallets below to enable rotation)"}.
                  </p>

                  {/* At-a-glance pool summary: how many subs exist on this
                      device, how many still hold SOL vs are empty, and the
                      total SOL across them. Balances only known once the pool
                      is unlocked (we don't poll locked vaults). */}
                  {subWalletSummary.total > 0 && (
                    <div
                      className="rounded-md border border-violet-500/20 bg-violet-500/5 px-2.5 py-2"
                      data-testid="panel-sub-wallet-summary"
                    >
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                        <span className="font-bold text-foreground" data-testid="text-sub-summary-total">
                          {subWalletSummary.total} sub-wallet{subWalletSummary.total === 1 ? "" : "s"} in pool
                        </span>
                        {subWalletSummary.balancesKnown ? (
                          <>
                            <span className="text-emerald-500 font-semibold" data-testid="text-sub-summary-funded">
                              {subWalletSummary.funded} funded
                            </span>
                            <span className="text-muted-foreground" data-testid="text-sub-summary-empty">
                              {subWalletSummary.empty} empty
                            </span>
                            <span className="ml-auto font-bold text-emerald-500" data-testid="text-sub-summary-sol">
                              {subWalletSummary.totalSol.toFixed(4)} SOL
                            </span>
                          </>
                        ) : (
                          <span className="ml-auto text-muted-foreground italic" data-testid="text-sub-summary-locked">
                            unlock to see balances
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground/80 mt-1 leading-snug">
                        Only counts sub-wallets stored on this device — subs created elsewhere or under a different vault won't appear here.
                      </p>
                    </div>
                  )}

                  {/* Inline pool-size picker — lets the user switch presets
                      (Stealth / Standard / Aggressive / Max Spread) or set a
                      custom count without scrolling back to the Quick Mode
                      section at the top of the page. Changing the count when
                      subs already exist requires regenerating (and ideally
                      sweeping funds first), so we surface that flow inline. */}
                  {hasSubVault && (
                    <div
                      className="rounded-md border border-violet-500/20 bg-violet-500/5 px-2.5 py-2 space-y-2"
                      data-testid="panel-pool-size"
                    >
                      <p className="text-[11px] text-muted-foreground font-semibold">
                        Pool size · currently <span className="font-bold text-foreground">{subKeypairs.length || subPubkeysFromVault.length}</span> sub-wallet{(subKeypairs.length || subPubkeysFromVault.length) === 1 ? "" : "s"}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {(Object.keys(BOT_PRESETS) as Array<Exclude<BotPreset, "custom">>).map(k => {
                          const cfg = BOT_PRESETS[k];
                          const active = botPreset === k;
                          const overCap = cfg.subCount > effectiveMaxSubWallets;
                          return (
                            <button
                              key={k}
                              type="button"
                              onClick={() => !isRunning && !overCap && applyPreset(k)}
                              disabled={isRunning || !!subWalletsBusy || overCap}
                              title={overCap ? `Needs unlimited tier (>${effectiveMaxSubWallets})` : cfg.blurb}
                              className={`text-[11px] font-bold px-2 py-1 rounded border transition-colors disabled:opacity-50 ${
                                active
                                  ? "border-violet-500 bg-violet-500 text-white"
                                  : "border-border text-muted-foreground hover:border-violet-500 hover:text-foreground"
                              }`}
                              data-testid={`button-pool-preset-${k}`}
                            >
                              {cfg.label} · {cfg.subCount}{overCap ? " 🔒" : ""}
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => !isRunning && setBotPreset("custom")}
                          disabled={isRunning || !!subWalletsBusy}
                          className={`text-[11px] font-bold px-2 py-1 rounded border transition-colors disabled:opacity-50 ${
                            botPreset === "custom"
                              ? "border-violet-500 bg-violet-500 text-white"
                              : "border-border text-muted-foreground hover:border-violet-500 hover:text-foreground"
                          }`}
                          data-testid="button-pool-preset-custom"
                        >
                          Custom
                        </button>
                      </div>

                      {botPreset === "custom" && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] text-muted-foreground">Count</span>
                          <Input
                            type="number" min="1" max={effectiveMaxSubWallets} step="1"
                            value={subWalletCount}
                            onChange={e => setSubWalletCount(e.target.value)}
                            disabled={isRunning || !!subWalletsBusy}
                            className="w-16 h-7 text-xs font-bold text-center"
                            data-testid="input-pool-custom-count"
                          />
                          <span className="text-[10px] text-muted-foreground">
                            (1–{effectiveMaxSubWallets}{creditInfo?.unlimitedSubwallets ? " · unlimited" : ""})
                          </span>
                        </div>
                      )}

                      {/* Resize action: shown only when the requested count
                          differs from the actual unlocked sub count. */}
                      {(() => {
                        const requested = parseInt(subWalletCount) || 0;
                        const current = subKeypairs.length || subPubkeysFromVault.length;
                        if (!requested || requested === current) return null;
                        // Resize honors whatever mode the existing vault uses,
                        // so a signature-mode user doesn't suddenly get asked
                        // for a passphrase mid-flow.
                        const resizeMode = subVaultMode ?? "passphrase";
                        // Open the regen-guard dialog (live balance check +
                        // sweep-to-main offer) before destroying any keys.
                        // The proceed callback re-runs the actual generate
                        // helper, so the existing atomic-overwrite semantics
                        // of generateAndSaveSubWallets stay intact.
                        const openResizeGuard = (proceed: () => void) => {
                          const pubkeys = subKeypairs.length
                            ? subKeypairs.map(k => k.publicKey.toBase58())
                            : subPubkeysFromVault;
                          // sweepAll requires unlocked in-memory keypairs;
                          // when subs are locked it no-ops silently, which
                          // would otherwise let the dialog fall through to
                          // destroy keys after a phantom sweep success.
                          const canSweep = subKeypairs.length > 0;
                          setRegenGuard({
                            title: `Resize pool from ${current} to ${requested}?`,
                            subtitle: canSweep
                              ? `This regenerates every sub-wallet. Send any leftover funds back to your main wallet first to keep them safe.`
                              : `This regenerates every sub-wallet. Unlock your subs first to sweep funds safely, or back up the keys and proceed.`,
                            pubkeys,
                            sweepAvailable: canSweep,
                            onSweep: canSweep
                              ? async () => { await sweepAll("transfer"); }
                              : undefined,
                            onProceed: () => { proceed(); },
                          });
                        };
                        return (
                          <div className="space-y-1.5 pt-1.5 border-t border-violet-500/20">
                            <p className="text-[10px] text-amber-700 dark:text-amber-300 leading-snug">
                              <AlertCircle className="inline w-3 h-3 mr-0.5 -mt-0.5" />
                              Changing pool size <b>regenerates</b> all sub-wallets — your current {current} sub{current === 1 ? "" : "s"} will be replaced. You'll get a chance to sweep funds back to your main wallet first.
                            </p>
                            {resizeMode === "signature" ? (
                              <Button
                                size="sm"
                                onClick={() => {
                                  openResizeGuard(() => {
                                    // Don't destroy the vault up-front — if the user
                                    // cancels the Phantom prompt we'd otherwise lose
                                    // the existing sub-wallets. The generate helper
                                    // overwrites localStorage atomically on success
                                    // and leaves the old vault intact on failure.
                                    setSubBalances({});
                                    handleGenerateSubWalletsWithSignature();
                                  });
                                }}
                                disabled={isRunning || !!subWalletsBusy || !publicKey || !signMessage}
                                className="h-7 text-xs bg-black hover:bg-black/90 text-white w-full"
                                data-testid="button-pool-resize-apply-signature"
                              >
                                {subWalletsBusy === "generate"
                                  ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                  : <KeyRound className="w-3 h-3 mr-1" />}
                                Resize to {requested} (one Phantom tap)
                              </Button>
                            ) : (
                              <div className="flex items-center gap-2">
                                <Input
                                  type="password"
                                  placeholder="Session passphrase"
                                  value={subPass}
                                  onChange={e => setSubPass(e.target.value)}
                                  disabled={isRunning || !!subWalletsBusy}
                                  className="text-xs h-7 flex-1"
                                  data-testid="input-pool-resize-passphrase"
                                  autoComplete="new-password"
                                />
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    // Capture the passphrase BEFORE opening the dialog;
                                    // the input might be cleared by the time the user
                                    // confirms (and reading from state inside the proceed
                                    // callback would race for the same reason).
                                    const pass = subPass;
                                    openResizeGuard(() => {
                                      // Don't destroy the vault up-front — the generate
                                      // helper overwrites localStorage atomically on
                                      // success and leaves the old vault intact on
                                      // failure (e.g. wrong passphrase).
                                      setSubBalances({});
                                      handleGenerateSubWallets(pass);
                                      setSubPass("");
                                    });
                                  }}
                                  disabled={isRunning || !!subWalletsBusy || !subPass}
                                  className="h-7 text-xs bg-violet-600 hover:bg-violet-700 text-white"
                                  data-testid="button-pool-resize-apply"
                                >
                                  {subWalletsBusy === "generate"
                                    ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                    : <Layers className="w-3 h-3 mr-1" />}
                                  Resize to {requested}
                                </Button>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Funding nudge — the #1 reason "randomization isn't working"
                      is that sub-wallets exist but have 0 SOL, so every dice
                      roll lands on an underfunded wallet. This banner makes
                      the fix obvious without the user having to read docs. */}
                  {subKeypairs.length > 0 && (() => {
                    const GAS_BUFFER_SOL = 0.0005;
                    // Use the MIN bump threshold so a wallet with enough SOL
                    // for the smallest possible bump is "funded enough" — the
                    // bot will skip it on bumps it can't cover at runtime.
                    const need = minPerBumpRequiredLamports;
                    const unfunded = subKeypairs.filter(k => (subBalances[k.publicKey.toBase58()] ?? 0) < need);
                    if (unfunded.length === 0) return null;
                    const allUnfunded = unfunded.length === subKeypairs.length;
                    const primarySol = sessionBalance / LAMPORTS_PER_SOL;
                    const usableSol = Math.max(0, primarySol - GAS_BUFFER_SOL);
                    const minTotal = 0.001 * subKeypairs.length;
                    const primaryTooLow = usableSol < minTotal;
                    // What the smart helper will actually send: respect the
                    // user's typed cap if any, else use everything available.
                    const typedCap = fundMode === "auto" ? (parseFloat(autoTotalBudget) || 0) : 0;
                    const willSendSol = typedCap > 0
                      ? Math.min(typedCap, usableSol)
                      : usableSol;
                    return (
                      <div
                        className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs space-y-1.5"
                        data-testid="warn-subs-unfunded"
                      >
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-amber-900 dark:text-amber-200">
                              {allUnfunded
                                ? `All ${unfunded.length} sub-wallet${unfunded.length === 1 ? " is" : "s are"} empty`
                                : `${unfunded.length} of ${subKeypairs.length} sub-wallets need SOL`}
                            </p>
                            <p className="text-[11px] text-amber-800/90 dark:text-amber-200/80 leading-snug">
                              Without funded subs, every bump fires from your primary — so dex screener and pump.fun show all buys from one wallet. Click below to <b>auto-fund from your session wallet</b> (which has <b>{primarySol.toFixed(4)} SOL</b>) — amounts will be randomized per sub so it doesn't look bot-like.
                            </p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          onClick={fundAllUnfundedNow}
                          disabled={isRunning || !!subWalletsBusy || primaryTooLow}
                          data-testid="button-distribute-from-warning"
                          className="w-full bg-amber-600 hover:bg-amber-700 text-white h-8"
                        >
                          {subWalletsBusy === "distribute"
                            ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Distributing…</>
                            : <><Shuffle className="w-3 h-3 mr-1.5" />Auto-fund {subKeypairs.length} sub-wallet{subKeypairs.length === 1 ? "" : "s"} now (~{willSendSol.toFixed(4)} SOL)</>}
                        </Button>
                        {primaryTooLow ? (
                          <p className="text-[10px] text-amber-800/80 dark:text-amber-200/70 leading-snug">
                            Session wallet has {primarySol.toFixed(4)} SOL — needs at least {(minTotal + GAS_BUFFER_SOL).toFixed(4)} SOL for {subKeypairs.length} sub{subKeypairs.length === 1 ? "" : "s"}. Send more SOL to your session wallet first.
                          </p>
                        ) : (
                          <p className="text-[10px] text-amber-800/80 dark:text-amber-200/70 leading-snug">
                            Pulls from session wallet (not your main Phantom wallet) · keeps ~{GAS_BUFFER_SOL} SOL behind for gas · one transaction, no popup.
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  {/* Rotation cadence — only matters when we have >1 wallet */}
                  {walletPool.length > 1 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 flex-wrap rounded-md bg-violet-500/5 border border-violet-500/20 px-2.5 py-2"
                        data-testid="panel-rotation-mode">
                        <span className="text-[11px] text-muted-foreground font-semibold">Wallet rotation</span>
                        <button
                          type="button"
                          onClick={() => !isRunning && setRandomizeWallets(true)}
                          disabled={isRunning}
                          className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                            randomizeWallets
                              ? "bg-violet-500 text-white"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          } disabled:opacity-50`}
                          data-testid="button-rotation-random"
                        >
                          Randomized
                        </button>
                        <button
                          type="button"
                          onClick={() => !isRunning && setRandomizeWallets(false)}
                          disabled={isRunning}
                          className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                            !randomizeWallets
                              ? "bg-violet-500 text-white"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          } disabled:opacity-50`}
                          data-testid="button-rotation-sequential"
                        >
                          Sequential
                        </button>
                        <span className="text-[10px] text-muted-foreground/80 basis-full">
                          {randomizeWallets
                            ? "Each bump picks a random wallet (never the same one twice in a row). Looks like distinct buyers on pump.fun and dex screener — recommended."
                            : "Each wallet does N consecutive bumps before passing the baton. More predictable but easier to fingerprint."}
                        </span>
                      </div>

                      {!randomizeWallets && (
                        <div className="flex items-center gap-2 flex-wrap rounded-md bg-violet-500/5 border border-violet-500/20 px-2.5 py-2"
                          data-testid="panel-bumps-per-wallet">
                          <span className="text-[11px] text-muted-foreground">Each wallet does</span>
                          <Input type="number" min="1" max="50" step="1"
                            value={bumpsPerWallet}
                            onChange={e => setBumpsPerWallet(e.target.value)}
                            disabled={isRunning}
                            className="w-14 h-7 text-xs font-bold text-center"
                            data-testid="input-bumps-per-wallet" />
                          <span className="text-[11px] text-muted-foreground">consecutive bumps before passing to the next wallet.</span>
                          <span className="text-[10px] text-muted-foreground/80 basis-full">
                            Higher feels more organic per address; lower spreads activity faster. Default 6.
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {!hasSubVault && (() => {
                    // Default to signature mode when a wallet is connected
                    // and the user hasn't opted into the passphrase form.
                    const walletReady = !!publicKey && !!signMessage;
                    const useSignature = walletReady && genMode === "signature" && !showPassphraseGen;
                    return (
                      <div className="space-y-2 pt-1">
                        <div className="flex items-center gap-2">
                          {botPreset === "custom" ? (
                            <>
                              <span className="text-[11px] text-muted-foreground">Count</span>
                              <Input type="number" min="1" max={effectiveMaxSubWallets} step="1"
                                value={subWalletCount}
                                onChange={e => setSubWalletCount(e.target.value)}
                                disabled={isRunning || !!subWalletsBusy}
                                className="w-16 text-sm font-bold text-center"
                                data-testid="input-sub-wallet-count" />
                              <span className="text-[11px] text-muted-foreground">
                                (1–{effectiveMaxSubWallets}{creditInfo?.unlimitedSubwallets ? " · unlimited tier" : ""})
                              </span>
                            </>
                          ) : (
                            <span className="text-[11px] text-muted-foreground" data-testid="text-sub-wallet-count-preset">
                              <span className="font-bold text-foreground">{BOT_PRESETS[botPreset].label}</span> preset will generate{" "}
                              <span className="font-bold text-foreground">{subWalletCount}</span> sub-wallet{subWalletCount === "1" ? "" : "s"}
                            </span>
                          )}
                        </div>

                        {useSignature ? (
                          <>
                            <Button
                              onClick={handleGenerateSubWalletsWithSignature}
                              disabled={isRunning || !!subWalletsBusy}
                              className="w-full bg-black hover:bg-black/90 text-white"
                              data-testid="button-generate-sub-wallets-signature"
                            >
                              {subWalletsBusy === "generate"
                                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating…</>
                                : <><KeyRound className="w-4 h-4 mr-2" />Generate with one Phantom tap</>}
                            </Button>
                            <p className="text-[10px] text-muted-foreground leading-snug">
                              Phantom will ask you to sign a short message — that signature becomes the local
                              encryption key for your sub-wallets. Nothing to type, nothing to remember. The
                              signature never leaves your device.
                            </p>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <Input
                                type="password"
                                placeholder="Session passphrase"
                                value={subPass || unlockPass || genPass}
                                onChange={e => setSubPass(e.target.value)}
                                disabled={isRunning || !!subWalletsBusy}
                                className="text-sm flex-1"
                                data-testid="input-sub-wallet-passphrase"
                                autoComplete="new-password"
                              />
                              <Button
                                onClick={() => {
                                  const pass = subPass || unlockPass || genPass;
                                  handleGenerateSubWallets(pass);
                                  setSubPass("");
                                }}
                                size="sm"
                                disabled={isRunning || !!subWalletsBusy || !(subPass || unlockPass || genPass)}
                                data-testid="button-generate-sub-wallets">
                                {subWalletsBusy === "generate" ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Layers className="w-3 h-3 mr-1" />}
                                Generate
                              </Button>
                            </div>
                            <p className="text-[10px] text-muted-foreground">
                              Re-type the same passphrase you used to create the session wallet — sub-wallet keys
                              are encrypted under it so they survive a refresh and only your browser can use them.
                            </p>
                            {walletReady && (
                              <button
                                type="button"
                                onClick={() => { setShowPassphraseGen(false); setGenMode("signature"); }}
                                className="text-[10px] text-muted-foreground hover:text-foreground underline"
                                data-testid="link-use-signature-instead"
                              >
                                Back to one-tap Phantom unlock
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })()}

                  {hasSubVault && subKeypairs.length === 0 && (() => {
                    const mode = subVaultMode ?? "passphrase";
                    const walletReady = !!publicKey && !!signMessage;
                    const connectedPub = publicKey?.toBase58() ?? null;
                    const wrongWallet =
                      mode === "signature" && subVaultSigner && connectedPub && subVaultSigner !== connectedPub;
                    return (
                      <div className="space-y-2 pt-1">
                        {mode === "signature" ? (
                          <>
                            <Button
                              onClick={handleUnlockSubWalletsWithSignature}
                              disabled={!!subWalletsBusy || !walletReady || !!wrongWallet}
                              className="w-full bg-black hover:bg-black/90 text-white disabled:opacity-50"
                              data-testid="button-unlock-sub-wallets-signature"
                            >
                              {subWalletsBusy === "unlock"
                                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Unlocking…</>
                                : <><KeyRound className="w-4 h-4 mr-2" />Unlock {subPubkeysFromVault.length} sub-wallet{subPubkeysFromVault.length !== 1 ? "s" : ""} with Phantom</>}
                            </Button>
                            {!walletReady && (
                              <p className="text-[10px] text-amber-700 dark:text-amber-300 leading-snug" data-testid="text-unlock-need-wallet">
                                Connect the wallet you used to create these sub-wallets to unlock with one tap.
                              </p>
                            )}
                            {wrongWallet && (
                              <p className="text-[10px] text-amber-700 dark:text-amber-300 leading-snug" data-testid="text-unlock-wrong-wallet">
                                These sub-wallets are locked with{" "}
                                <span className="font-mono font-bold">{subVaultSigner!.slice(0, 4)}…{subVaultSigner!.slice(-4)}</span>.
                                Switch to that wallet in Phantom to unlock.
                              </p>
                            )}
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <Input type="password" placeholder="Session passphrase"
                                value={unlockPass}
                                onChange={e => setUnlockPass(e.target.value)}
                                disabled={!!subWalletsBusy}
                                className="text-sm flex-1" data-testid="input-sub-unlock-pass" />
                              <Button
                                onClick={() => handleUnlockSubWallets(unlockPass)}
                                size="sm"
                                disabled={!!subWalletsBusy || !unlockPass}
                                data-testid="button-unlock-sub-wallets">
                                {subWalletsBusy === "unlock" ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <KeyRound className="w-3 h-3 mr-1" />}
                                Unlock {subPubkeysFromVault.length} sub-wallet{subPubkeysFromVault.length !== 1 ? "s" : ""}
                              </Button>
                            </div>
                            {/* Migration prompt — appears once the user is in wallet mode but
                                still on a passphrase vault. Lets them switch to one-tap unlock
                                without losing their sub-wallets. */}
                            {walletReady && !showMigratePrompt && (
                              <button
                                type="button"
                                onClick={() => setShowMigratePrompt(true)}
                                className="text-[10px] text-emerald-700 dark:text-emerald-400 hover:underline font-semibold"
                                data-testid="button-show-migrate-prompt"
                              >
                                ⚡ Switch to one-tap Phantom unlock (no more typing)
                              </button>
                            )}
                            {walletReady && showMigratePrompt && (
                              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2.5 space-y-2"
                                data-testid="panel-migrate-to-signature">
                                <p className="text-[11px] text-foreground leading-snug">
                                  Type your passphrase one last time. We'll re-encrypt your sub-wallets so the
                                  connected wallet ({connectedPub?.slice(0, 4)}…{connectedPub?.slice(-4)})
                                  can unlock them with a single Phantom tap from now on.
                                </p>
                                <Input
                                  type="password"
                                  placeholder="Current passphrase"
                                  value={migratePass}
                                  onChange={e => setMigratePass(e.target.value)}
                                  className="text-sm h-8"
                                  data-testid="input-migrate-passphrase"
                                />
                                <div className="flex items-center gap-2">
                                  <Button
                                    onClick={handleMigrateToSignature}
                                    size="sm"
                                    disabled={!!subWalletsBusy || !migratePass}
                                    className="bg-black hover:bg-black/90 text-white h-8 text-xs flex-1"
                                    data-testid="button-confirm-migrate"
                                  >
                                    {subWalletsBusy === "unlock"
                                      ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Switching…</>
                                      : <>Enable one-tap unlock</>}
                                  </Button>
                                  <Button
                                    onClick={() => { setShowMigratePrompt(false); setMigratePass(""); }}
                                    variant="outline"
                                    size="sm"
                                    className="h-8 text-xs"
                                    data-testid="button-cancel-migrate"
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })()}

                  {/* List of sub-wallet pubkeys + balances */}
                  {(subKeypairs.length > 0 || subPubkeysFromVault.length > 0) && (
                    <div className="space-y-1 pt-1 border-t border-border/50">
                      {(subKeypairs.length > 0 ? subKeypairs.map(k => k.publicKey.toBase58()) : subPubkeysFromVault).map((pub, i) => {
                        const lamports = subBalances[pub] ?? 0;
                        const sol = lamports / LAMPORTS_PER_SOL;
                        return (
                          <div key={pub} className="flex items-center gap-2 text-[11px] font-mono py-1"
                               data-testid={`row-sub-wallet-${i}`}>
                            <span className="text-muted-foreground">#{i + 1}</span>
                            <span className="text-foreground" title={pub}>{pub.slice(0, 6)}…{pub.slice(-4)}</span>
                            <button
                              onClick={() => navigator.clipboard?.writeText(pub).then(() => toast({ title: "Address copied" }))}
                              className="text-muted-foreground hover:text-foreground"
                              data-testid={`button-copy-sub-pubkey-${i}`}>
                              <Copy className="w-3 h-3" />
                            </button>
                            <span className="ml-auto font-bold text-emerald-500" data-testid={`text-sub-balance-${i}`}>
                              {sol.toFixed(4)} SOL
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Distribute + Sweep-all + Forget */}
                  {subKeypairs.length > 0 && (
                    <>
                      <div className="pt-1 border-t border-border/50 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                            Fund each sub-wallet (one-time budget)
                          </p>
                          {/* Mode toggle: Manual ("0.02 SOL each") vs Auto
                              (give a total cap, agent splits + leaves gas). */}
                          <div className="flex gap-0.5 p-0.5 rounded-md bg-muted/40 border border-border" data-testid="fund-mode-switch">
                            <button
                              onClick={() => setFundMode("manual")}
                              disabled={isRunning || !!subWalletsBusy}
                              data-testid="button-fund-mode-manual"
                              className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${fundMode === "manual" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
                            >
                              Manual
                            </button>
                            <button
                              onClick={() => setFundMode("auto")}
                              disabled={isRunning || !!subWalletsBusy}
                              data-testid="button-fund-mode-auto"
                              className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${fundMode === "auto" ? "bg-violet-600 text-white" : "text-muted-foreground hover:text-foreground"}`}
                            >
                              Auto
                            </button>
                          </div>
                        </div>

                        {(() => {
                          const GAS_BUFFER_SOL = 0.0005;
                          const primarySol = sessionBalance / LAMPORTS_PER_SOL;
                          const n = subKeypairs.length;

                          // Compute the active per-sub plan based on the
                          // current mode + inputs. `randomAllocLamports` is
                          // the persisted random plan (so the preview doesn't
                          // shuffle on every keystroke); we recompute it
                          // whenever it doesn't match the current expected
                          // length — a no-op for steady inputs but ensures
                          // the preview is always populated.
                          let plan: number[] | null = null;
                          let isVariable = false;
                          if (fundMode === "auto") {
                            const budgetSol = Math.max(0, parseFloat(autoTotalBudget) || 0);
                            const usableSol = Math.max(0, budgetSol - GAS_BUFFER_SOL);
                            if (randomAllocLamports.length === n && randomAllocSeed > 0) {
                              plan = randomAllocLamports;
                            } else if (n > 0) {
                              plan = buildRandomAllocLamports(usableSol, n);
                            }
                            isVariable = true;
                          } else if (manualMode === "fixed") {
                            const each = parseFloat(perSubFundAmount) || 0;
                            if (each >= 0.001 && n > 0) {
                              const lamportsEach = Math.round(each * LAMPORTS_PER_SOL);
                              plan = Array.from({ length: n }, () => lamportsEach);
                            }
                            isVariable = false;
                          } else {
                            // manual range
                            if (randomAllocLamports.length === n && randomAllocSeed > 0) {
                              plan = randomAllocLamports;
                            } else if (n > 0) {
                              const lo = parseFloat(perSubFundMin) || 0;
                              const hi = parseFloat(perSubFundMax) || 0;
                              plan = buildRangeAllocLamports(lo, hi, n);
                            }
                            isVariable = true;
                          }

                          const totalLamports = plan?.reduce((a, b) => a + b, 0) ?? 0;
                          const totalSol = totalLamports / LAMPORTS_PER_SOL;
                          const overBalance = totalSol + GAS_BUFFER_SOL > primarySol;
                          const planValid = !!plan && plan.every(v => v >= Math.round(0.001 * LAMPORTS_PER_SOL));

                          // Re-roll = generate fresh random plan from current
                          // inputs and pin it via state so the preview chips
                          // are stable until the user changes inputs again.
                          const reroll = () => {
                            let next: number[] | null = null;
                            if (fundMode === "auto") {
                              const budgetSol = Math.max(0, parseFloat(autoTotalBudget) || 0);
                              const usableSol = Math.max(0, budgetSol - GAS_BUFFER_SOL);
                              next = buildRandomAllocLamports(usableSol, n);
                            } else if (manualMode === "range") {
                              const lo = parseFloat(perSubFundMin) || 0;
                              const hi = parseFloat(perSubFundMax) || 0;
                              next = buildRangeAllocLamports(lo, hi, n);
                            }
                            if (next) {
                              setRandomAllocLamports(next);
                              setRandomAllocSeed(s => s + 1);
                            } else {
                              toast({ title: "Can't roll a plan", description: "Inputs invalid — check budget / range / sub count.", variant: "destructive" });
                            }
                          };

                          const fire = () => {
                            if (!planValid || !plan) {
                              toast({ title: "No valid plan yet", description: "Adjust budget/range until every sub gets ≥ 0.001 SOL.", variant: "destructive" });
                              return;
                            }
                            distributeToSubWallets(isVariable ? plan : undefined);
                          };

                          const useAvailable = () => {
                            const v = Math.max(0, primarySol - GAS_BUFFER_SOL);
                            setAutoTotalBudget(v.toFixed(4));
                            setRandomAllocLamports([]); // force reroll on next render
                          };

                          return (
                            <>
                              {fundMode === "auto" && (
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-[10px] text-muted-foreground">Max total</span>
                                  <Input type="number" min="0" step="0.01"
                                    value={autoTotalBudget}
                                    onChange={e => { setAutoTotalBudget(e.target.value); setRandomAllocLamports([]); }}
                                    disabled={isRunning || !!subWalletsBusy}
                                    className="text-sm font-bold w-24"
                                    data-testid="input-auto-total-budget" />
                                  <span className="text-[10px] text-muted-foreground">SOL</span>
                                  <button
                                    type="button"
                                    onClick={useAvailable}
                                    disabled={isRunning || !!subWalletsBusy || primarySol <= GAS_BUFFER_SOL}
                                    className="text-[10px] font-bold text-violet-600 dark:text-violet-400 hover:underline disabled:opacity-40"
                                    data-testid="button-use-primary-balance"
                                  >
                                    Use available ({primarySol.toFixed(4)})
                                  </button>
                                </div>
                              )}

                              {fundMode === "manual" && (
                                <>
                                  <div className="flex gap-1 p-0.5 rounded-md bg-muted/40 border border-border w-fit" data-testid="manual-mode-switch">
                                    <button
                                      onClick={() => setManualMode("fixed")}
                                      disabled={isRunning || !!subWalletsBusy}
                                      data-testid="button-manual-mode-fixed"
                                      className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${manualMode === "fixed" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
                                    >
                                      Fixed each
                                    </button>
                                    <button
                                      onClick={() => { setManualMode("range"); setRandomAllocLamports([]); }}
                                      disabled={isRunning || !!subWalletsBusy}
                                      data-testid="button-manual-mode-range"
                                      className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${manualMode === "range" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
                                    >
                                      Random range
                                    </button>
                                  </div>
                                  {manualMode === "fixed" ? (
                                    <div className="flex items-center gap-2">
                                      <Input type="number" min="0.001" step="0.001"
                                        value={perSubFundAmount}
                                        onChange={e => setPerSubFundAmount(e.target.value)}
                                        disabled={isRunning || !!subWalletsBusy}
                                        className="text-sm font-bold w-24"
                                        data-testid="input-per-sub-fund-amount" />
                                      <span className="text-[10px] text-muted-foreground">SOL each</span>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <Input type="number" min="0.001" step="0.001"
                                        value={perSubFundMin}
                                        onChange={e => { setPerSubFundMin(e.target.value); setRandomAllocLamports([]); }}
                                        disabled={isRunning || !!subWalletsBusy}
                                        className="text-sm font-bold w-20"
                                        data-testid="input-per-sub-fund-min" />
                                      <span className="text-[10px] text-muted-foreground">to</span>
                                      <Input type="number" min="0.001" step="0.001"
                                        value={perSubFundMax}
                                        onChange={e => { setPerSubFundMax(e.target.value); setRandomAllocLamports([]); }}
                                        disabled={isRunning || !!subWalletsBusy}
                                        className="text-sm font-bold w-20"
                                        data-testid="input-per-sub-fund-max" />
                                      <span className="text-[10px] text-muted-foreground">SOL per sub (random)</span>
                                    </div>
                                  )}
                                </>
                              )}

                              {/* Per-sub preview chips — shows exactly what
                                  each wallet will receive before the user
                                  fires the distribute. Critical for "doesn't
                                  look like a bot" peace of mind. */}
                              {plan && plan.length > 0 && (
                                <div className="rounded-md bg-muted/30 border border-border px-2 py-1.5 space-y-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Plan preview</span>
                                    {isVariable && (
                                      <button
                                        type="button"
                                        onClick={reroll}
                                        disabled={isRunning || !!subWalletsBusy}
                                        className="text-[10px] font-bold text-violet-600 dark:text-violet-400 hover:underline disabled:opacity-40"
                                        data-testid="button-reroll-alloc"
                                      >
                                        🎲 Re-roll
                                      </button>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    {plan.map((lp, i) => (
                                      <span
                                        key={i}
                                        className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-background border border-border"
                                        data-testid={`chip-alloc-${i}`}
                                      >
                                        #{i + 1}: {(lp / LAMPORTS_PER_SOL).toFixed(4)}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <div className="flex items-center gap-2">
                                <Button onClick={fire} size="sm"
                                  disabled={isRunning || !!subWalletsBusy || n === 0 || !planValid || overBalance}
                                  data-testid={fundMode === "auto" ? "button-auto-distribute" : "button-distribute-sub-wallets"}
                                  className={`ml-auto ${fundMode === "auto" ? "bg-violet-600 hover:bg-violet-700 text-white" : ""}`}>
                                  {subWalletsBusy === "distribute" ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Shuffle className="w-3 h-3 mr-1" />}
                                  {fundMode === "auto" ? "Auto-distribute" : "Distribute from primary"}
                                </Button>
                              </div>

                              <p className="text-[10px] text-muted-foreground leading-snug">
                                Total to send: <b>{totalSol.toFixed(4)} SOL</b> in one transaction (no wallet popup)
                                {isVariable && <> · amounts <b>randomized per sub</b> so funding doesn't look bot-like</>}
                                {fundMode === "auto" && <> · ~{GAS_BUFFER_SOL} SOL stays in primary for gas</>}.
                              </p>
                              {overBalance && (
                                <p className="text-[10px] text-rose-500 leading-snug">
                                  Plan exceeds primary balance ({primarySol.toFixed(4)} SOL). Lower the budget or top up primary.
                                </p>
                              )}
                              {!planValid && n > 0 && (
                                <p className="text-[10px] text-amber-500 leading-snug">
                                  {fundMode === "auto"
                                    ? `Budget too small to give every sub at least 0.001 SOL — need ≥ ${(0.001 * n + GAS_BUFFER_SOL).toFixed(4)} SOL.`
                                    : "Range invalid — min must be ≥ 0.001 SOL and max ≥ min."}
                                </p>
                              )}
                            </>
                          );
                        })()}

                        <p className="text-[10px] text-muted-foreground leading-snug">
                          This is the <b>funding budget</b> per sub — the wallet's SOL pile to spend over many bumps.
                          {" "}<b>Per-bump amounts are still variable</b> (
                          {amountMode === "fixed"
                            ? <>fixed <b>{solPerBump} SOL</b></>
                            : amountMode === "range"
                              ? <>random <b>{solRangeMin}–{solRangeMax} SOL</b></>
                              : <>cycling list <b>{solList}</b></>
                          }
                          {botPreset !== "custom" && <> · <b>{BOT_PRESETS[botPreset].label}</b> preset</>}
                          ) so each trade looks organic on pump.fun.
                        </p>
                      </div>
                    </>
                  )}

                  {(subKeypairs.length > 0 || hasSubVault) && (
                    <div className="space-y-2 pt-1 border-t border-border/50">
                      {/* POOL TOKEN HOLDINGS — aggregated bag across session
                          + every unlocked sub-wallet. Answers the "I bought
                          a bunch but can't see what I'm holding" question
                          because auto-buys land in subs, not main wallet.
                          Each row has its own per-token actions so the user
                          can sell one specific coin without touching the
                          others (e.g. cash out a graduated bag while
                          keeping PAIF in the pool for more bumps). */}
                      {/* Show whenever we have ANY unlocked wallet (session or
                          subs). Previously gated on `subKeypairs.length > 0`,
                          which silently hid the panel for users who unlocked
                          their session wallet but never created sub-wallets —
                          so tokens bought directly into the session wallet
                          had no UI to sell or transfer from. */}
                      {poolPubkeys.length > 0 && (
                        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5 space-y-2"
                             data-testid="panel-pool-holdings">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                              Tokens held across your pool
                            </p>
                            <button
                              type="button"
                              onClick={() => refetchPoolTokens()}
                              disabled={poolTokensFetching || !!poolMintBusy}
                              className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                              data-testid="button-refresh-pool-holdings"
                            >
                              <Loader2 className={`w-3 h-3 ${poolTokensFetching ? "animate-spin" : ""}`} />
                              Refresh
                            </button>
                          </div>
                          {poolTokens.length === 0 ? (
                            <p className="text-[11px] text-muted-foreground leading-snug" data-testid="text-pool-holdings-empty">
                              {poolTokensFetching
                                ? "Checking sub-wallets…"
                                : "No tokens in your pool yet. After auto-buy fires, the coins you bought will show up here so you can sell or sweep them."}
                            </p>
                          ) : (
                            <div className="space-y-1.5">
                              {poolTokens.map(t => {
                                const isSelling   = poolMintBusy?.mint === t.mint && poolMintBusy?.action === "sell";
                                const isXferring  = poolMintBusy?.mint === t.mint && poolMintBusy?.action === "transfer";
                                const anyBusy     = !!poolMintBusy || !!subWalletsBusy || isRunning;
                                const label       = t.symbol || (t.name ? t.name : `${t.mint.slice(0, 4)}…${t.mint.slice(-4)}`);
                                const subtitle    = t.symbol && t.name ? t.name : (t.symbol ? `${t.mint.slice(0, 4)}…${t.mint.slice(-4)}` : "");
                                // Display amount: humanize big numbers
                                // so we don't show "1,234,567.892345" — 4
                                // sig figs is plenty for a holdings glance.
                                const fmt = (v: number) => {
                                  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
                                  if (v >= 1_000_000)     return `${(v / 1_000_000).toFixed(2)}M`;
                                  if (v >= 1_000)         return `${(v / 1_000).toFixed(2)}K`;
                                  if (v >= 1)             return v.toFixed(2);
                                  return v.toFixed(Math.min(6, t.decimals));
                                };
                                return (
                                  <div key={t.mint}
                                       className="rounded-md bg-background/60 border border-border p-2 space-y-1.5"
                                       data-testid={`row-pool-holding-${t.mint}`}>
                                    <div className="flex items-start gap-2">
                                      <div className="flex-1 min-w-0">
                                        <p className="text-xs font-bold text-foreground truncate" data-testid={`text-pool-symbol-${t.mint}`}>
                                          {label}
                                        </p>
                                        {subtitle && (
                                          <p className="text-[10px] text-muted-foreground truncate font-mono">
                                            {subtitle}
                                          </p>
                                        )}
                                      </div>
                                      <div className="text-right shrink-0">
                                        <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 tabular-nums" data-testid={`text-pool-amount-${t.mint}`}>
                                          {fmt(t.totalUiAmount)}
                                        </p>
                                        <p className="text-[10px] text-muted-foreground">
                                          across {t.walletCount} wallet{t.walletCount !== 1 ? "s" : ""}
                                        </p>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <Button
                                        size="sm"
                                        onClick={() => sellMintAcrossPool(t.mint)}
                                        disabled={anyBusy}
                                        className="h-7 text-[11px] bg-black text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                                        data-testid={`button-sell-mint-${t.mint}`}
                                        title="Sells this token (in TWAP chunks) from every sub-wallet that holds it. SOL stays in the subs."
                                      >
                                        {isSelling
                                          ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Selling…</>
                                          : <>Sell all to SOL (TWAP)</>}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => transferMintAcrossPool(t.mint)}
                                        disabled={anyBusy || !publicKey}
                                        className="h-7 text-[11px]"
                                        data-testid={`button-sweep-mint-${t.mint}`}
                                        title={publicKey
                                          ? "Sends this token from every sub-wallet to your connected main wallet — works for graduated coins too."
                                          : "Connect your main wallet first."}
                                      >
                                        {isXferring
                                          ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Sending…</>
                                          : <>Send to main wallet</>}
                                      </Button>
                                    </div>
                                  </div>
                                );
                              })}
                              <p className="text-[10px] text-muted-foreground leading-snug pt-0.5">
                                These are the tokens your sub-wallets are holding right now. Use the buttons above to act on one token at a time, or use the cash-out section below to sweep everything at once.
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Big primary action — the obvious one-tap answer to
                          "I just want all my money back in my main wallet".
                          Always does the safe `transfer` flow regardless of
                          the advanced picker below, so a user who never
                          opens "Advanced" can never accidentally pick a
                          destructive mode. */}
                      <div className="space-y-2 pt-1">
                        <Button
                          onClick={() => { setSweepMode("transfer"); sweepAll("transfer"); }}
                          disabled={isRunning || !!subWalletsBusy || !!poolMintBusy}
                          className="w-full bg-black hover:bg-black/90 text-white dark:bg-white dark:hover:bg-white/90 dark:text-black font-bold"
                          data-testid="button-cashout-everything"
                        >
                          {subWalletsBusy === "sweep"
                            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending everything home…</>
                            : <><ArrowUpFromLine className="w-4 h-4 mr-2" /> Send everything back to my main wallet</>}
                        </Button>
                        <p className="text-[10px] text-muted-foreground leading-snug text-center px-2">
                          Sends every token (intact) and every SOL from session + sub-wallets to your connected Phantom wallet. Empty token accounts are closed and the rent (~0.002 SOL each) is refunded.
                        </p>
                      </div>

                      {/* Advanced sweep options — collapsed by default. Power
                          users can expand for sell-to-SOL or SOL-only modes
                          plus per-sweep TWAP knobs. */}
                      <button
                        type="button"
                        onClick={() => setSweepAdvancedOpen(v => !v)}
                        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                        data-testid="button-toggle-sweep-advanced"
                        aria-expanded={sweepAdvancedOpen}
                      >
                        <span className="underline">Advanced cash-out options</span>
                        {sweepAdvancedOpen
                          ? <ChevronUp className="w-3.5 h-3.5" />
                          : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>

                      {sweepAdvancedOpen && (<>
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                          When I cash out, my tokens should…
                        </p>
                        {[
                          { id: "transfer" as const, label: "Come back to my wallet as tokens", recommended: true,
                            desc: "Each session + sub-wallet sends its tokens (intact) to your main Phantom wallet, then sweeps the SOL. Works for graduated coins too. Empty token accounts are closed and the ~0.002 SOL rent each one held is refunded with the SOL sweep." },
                          { id: "sell" as const, label: "Be sold for SOL first, then sweep the SOL",
                            desc: "Each token is dribbled out in chunks (TWAP) so a chunky bag doesn't tank the price. Tokens that have graduated to Raydium can't be sold here — switch to the 'tokens to my wallet' option for those." },
                          { id: "sol-only" as const, label: "Stay where they are — sweep SOL only",
                            desc: "Tokens stay in the session + sub-wallets so you can keep bumping later. Only the loose SOL comes back to your main wallet." },
                        ].map(opt => (
                          <label key={opt.id}
                            className={`flex items-start gap-2 cursor-pointer rounded-lg p-2 border transition-colors ${
                              sweepMode === opt.id
                                ? "border-emerald-500/50 bg-emerald-500/5"
                                : "border-border hover:border-emerald-500/30"
                            }`}
                            data-testid={`label-sweep-mode-${opt.id}`}
                          >
                            <input
                              type="radio"
                              name="sweep-mode"
                              checked={sweepMode === opt.id}
                              onChange={() => setSweepMode(opt.id)}
                              disabled={isRunning || !!subWalletsBusy}
                              className="mt-0.5"
                              data-testid={`radio-sweep-mode-${opt.id}`}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] font-bold text-foreground">
                                {opt.label}
                                {opt.recommended && (
                                  <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500 text-white">Recommended</span>
                                )}
                              </p>
                              <p className="text-[10px] text-muted-foreground leading-snug">{opt.desc}</p>
                            </div>
                          </label>
                        ))}
                      </div>

                      {/* TWAP preset bar — only when 'sell' is selected */}
                      {sweepMode === "sell" && (
                        <div className="rounded-lg bg-amber-500/5 border border-amber-500/30 p-2 space-y-2"
                          data-testid="panel-twap-config">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                            Sell pace
                          </p>
                          <div className="grid grid-cols-2 gap-1.5">
                            {([
                              { id: "fast",     label: "Fast",     sub: "3 chunks · 10s gap" },
                              { id: "balanced", label: "Balanced", sub: "5 chunks · 30s gap" },
                              { id: "slow",     label: "Slow",     sub: "10 chunks · 60s gap" },
                              { id: "custom",   label: "Custom",   sub: "you pick" },
                            ] as const).map(p => (
                              <button key={p.id}
                                type="button"
                                onClick={() => setTwapPreset(p.id)}
                                disabled={isRunning || !!subWalletsBusy}
                                className={`text-left rounded-md px-2 py-1.5 border text-[11px] transition-colors ${
                                  twapPreset === p.id
                                    ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                    : "border-border hover:border-amber-500/40"
                                }`}
                                data-testid={`button-twap-${p.id}`}
                              >
                                <div className="font-bold">{p.label}</div>
                                <div className="text-[9px] text-muted-foreground">{p.sub}</div>
                              </button>
                            ))}
                          </div>
                          {twapPreset === "custom" && (
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-[10px] font-bold text-muted-foreground">Chunks per token</label>
                                <Input
                                  type="number" min={1} max={20} value={twapChunks}
                                  onChange={e => setTwapChunks(e.target.value)}
                                  disabled={isRunning || !!subWalletsBusy}
                                  className="h-7 text-xs mt-0.5"
                                  data-testid="input-twap-chunks"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] font-bold text-muted-foreground">Seconds between chunks</label>
                                <Input
                                  type="number" min={0} max={600} value={twapDelaySec}
                                  onChange={e => setTwapDelaySec(e.target.value)}
                                  disabled={isRunning || !!subWalletsBusy}
                                  className="h-7 text-xs mt-0.5"
                                  data-testid="input-twap-delay"
                                />
                              </div>
                            </div>
                          )}
                          {(() => {
                            const cfg = effectiveTwapConfig();
                            const totalSec = (cfg.chunks - 1) * cfg.delaySec;
                            return (
                              <p className="text-[10px] text-amber-700/80 dark:text-amber-300/80 leading-snug">
                                Each token will be sold in <b>{cfg.chunks} chunk{cfg.chunks === 1 ? "" : "s"}</b>
                                {cfg.delaySec > 0 && <> with a <b>{cfg.delaySec}s</b> pause between each</>}
                                {totalSec > 0 && <> · ~{Math.round(totalSec / 60) || `${totalSec}s`}{totalSec >= 60 ? " min" : ""} per token</>}.
                              </p>
                            );
                          })()}
                        </div>
                      )}

                      {/* Mode-specific sweep button — only shown when advanced
                          is expanded, since the prominent "Send everything
                          back" button above already handles the safe default
                          case. */}
                      <Button onClick={() => sweepAll()} size="sm" variant="outline"
                        disabled={isRunning || !!subWalletsBusy || !!poolMintBusy}
                        data-testid="button-sweep-all"
                        className="w-full"
                        title={
                          sweepMode === "transfer" ? "Sends every token (as tokens) and every SOL from session + sub-wallets to your main Phantom wallet"
                          : sweepMode === "sell" ? "Sells all tokens to SOL in chunks, then sends every SOL from session + sub-wallets to your main Phantom wallet"
                          : "Sends every SOL from session + sub-wallets to your main Phantom wallet (tokens stay behind)"
                        }
                      >
                        {subWalletsBusy === "sweep" ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <ArrowUpFromLine className="w-3 h-3 mr-1" />}
                        {sweepMode === "transfer" ? "Send tokens + SOL to my main wallet"
                          : sweepMode === "sell" ? "Sell tokens, then send SOL to my main wallet"
                          : "Send SOL only to my main wallet"}
                      </Button>
                      </>)}

                      <div className="flex items-center gap-2 flex-wrap">
                        <Button onClick={refreshSubBalances} size="sm" variant="ghost"
                          data-testid="button-refresh-sub-balances">
                          <Loader2 className="w-3 h-3 mr-1" />
                          Refresh
                        </Button>
                        {hasSubVault && (
                          <Button onClick={handleClearSubWallets} size="sm" variant="ghost"
                            disabled={isRunning || currentlyBumping || !!subWalletsBusy}
                            className="text-rose-500 hover:text-rose-600 ml-auto"
                            data-testid="button-clear-sub-wallets"
                            title="Permanently delete sub-wallet keys from this device">
                            <Trash2 className="w-3 h-3 mr-1" />
                            Forget sub-wallets
                          </Button>
                        )}
                      </div>

                      {/* Push tokens FROM main wallet INTO subs — inverse of
                          sweep. For users who held a bag in main and now
                          want to TWAP-exit through many addresses. Only
                          shown if subs are unlocked (need their pubkeys).
                          Collapsed-by-default disclosure: the header button
                          stays visible at all times so the feature is
                          discoverable without dominating the panel. */}
                      {(sessionKeypair || subKeypairs.length > 0) && (
                        <div className="rounded-lg bg-sky-500/5 border border-sky-500/30 mt-2"
                          data-testid="panel-push-tokens">
                          <button type="button"
                            onClick={() => setPushTokensExpanded(v => !v)}
                            className="w-full flex items-center justify-between gap-2 px-2.5 py-2 text-left hover:bg-sky-500/10 rounded-lg transition-colors"
                            data-testid="button-toggle-push-tokens"
                            aria-expanded={pushTokensExpanded}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <ArrowUpFromLine className="w-3.5 h-3.5 text-sky-700 dark:text-sky-400 shrink-0" />
                              <p className="text-[11px] font-bold uppercase tracking-wide text-sky-700 dark:text-sky-400 truncate">
                                Push tokens from main → sub-wallets
                              </p>
                            </div>
                            {pushTokensExpanded
                              ? <ChevronUp className="w-4 h-4 text-sky-700 dark:text-sky-400 shrink-0" />
                              : <ChevronDown className="w-4 h-4 text-sky-700 dark:text-sky-400 shrink-0" />}
                          </button>
                          {pushTokensExpanded && (
                          <div className="px-2.5 pb-2 space-y-2 border-t border-sky-500/20 pt-2">
                          <div className="flex items-center justify-end">
                            <button type="button"
                              onClick={() => refetchMainTokens()}
                              disabled={mainTokensLoading || !!subWalletsBusy}
                              className="text-[10px] text-sky-700 dark:text-sky-400 hover:underline disabled:opacity-50"
                              data-testid="button-refresh-main-tokens"
                            >
                              {mainTokensLoading ? "Loading…" : "Refresh holdings"}
                            </button>
                          </div>
                          <p className="text-[10px] text-muted-foreground leading-snug">
                            Splits the chosen token across your session + sub-wallets in one Phantom prompt. Use this when you want to <b>TWAP-sell from many addresses</b> instead of dumping the whole bag from your main wallet — looks more organic and reduces price impact. Each new destination token account costs ~0.002 SOL of rent (refunded when later closed by a sweep).
                          </p>
                          {mainTokens.length === 0 ? (
                            <p className="text-[10px] text-muted-foreground italic">
                              {publicKey
                                ? "No SPL tokens detected in your main wallet."
                                : "Connect your main wallet to see your token holdings."}
                            </p>
                          ) : (
                            <>
                              <div className="grid grid-cols-3 gap-2">
                                <div className="col-span-2">
                                  <label className="text-[10px] font-bold text-muted-foreground">Token</label>
                                  <select
                                    value={distTokenMint}
                                    onChange={e => setDistTokenMint(e.target.value)}
                                    disabled={isRunning || !!subWalletsBusy}
                                    className="w-full h-7 mt-0.5 rounded-md border border-border bg-background px-2 text-xs"
                                    data-testid="select-dist-token"
                                  >
                                    <option value="">— pick a token —</option>
                                    {mainTokens.map(t => {
                                      const label = t.symbol
                                        ? `${t.symbol}${t.name ? ` · ${t.name}` : ""}`
                                        : `${t.mint.slice(0, 4)}…${t.mint.slice(-4)} (unknown token)`;
                                      const balance = t.uiAmount.toLocaleString(undefined, { maximumFractionDigits: 4 });
                                      return (
                                        <option key={t.mint} value={t.mint}>
                                          {label} — {balance}
                                        </option>
                                      );
                                    })}
                                  </select>
                                  {distTokenMint && (
                                    <p className="text-[10px] text-muted-foreground mt-0.5 font-mono break-all"
                                      data-testid="text-dist-token-mint">
                                      mint: {distTokenMint}
                                    </p>
                                  )}
                                </div>
                                <div>
                                  <label className="text-[10px] font-bold text-muted-foreground">% to send</label>
                                  <Input
                                    type="number" min={1} max={100} value={distTokenPercent}
                                    onChange={e => setDistTokenPercent(e.target.value)}
                                    disabled={isRunning || !!subWalletsBusy}
                                    className="h-7 text-xs mt-0.5"
                                    data-testid="input-dist-percent"
                                  />
                                </div>
                              </div>
                              <Button onClick={distributeTokenToWallets} size="sm" variant="outline"
                                disabled={isRunning || !!subWalletsBusy || !!poolMintBusy || !distTokenMint}
                                className="w-full"
                                data-testid="button-distribute-tokens"
                              >
                                {subWalletsBusy === "distribute"
                                  ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                  : <ArrowDownToDot className="w-3 h-3 mr-1" />}
                                Distribute across {1 + subKeypairs.length} wallet{subKeypairs.length === 0 ? "" : "s"}
                              </Button>
                            </>
                          )}
                          </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
              </CollapsibleSection>
            )}

            {/* Live status */}
            {botState !== "idle" && (
              <Card data-testid="card-bump-status">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-4">
                    <div className={`w-2 h-2 rounded-full ${isRunning ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground"}`} />
                    <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      {isRunning ? "Bot Running" : "Bot Stopped"}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="text-center rounded-xl bg-muted/30 py-3">
                      <p className="text-xl font-black text-foreground">{bumpCount}</p>
                      <p className="text-[10px] font-bold text-muted-foreground uppercase">Bumps Done</p>
                    </div>
                    <div className="text-center rounded-xl bg-muted/30 py-3">
                      <p className="text-xl font-black text-foreground">{Math.max(0, parseInt(maxBumps) - bumpCount)}</p>
                      <p className="text-[10px] font-bold text-muted-foreground uppercase">Remaining</p>
                    </div>
                    <div className="text-center rounded-xl bg-muted/30 py-3">
                      <p className={`text-xl font-black ${bumpAction === "buy" ? "text-emerald-500" : "text-rose-500"}`}>
                        {bumpAction === "buy"
                          ? (bumpCount * parseFloat(solPerBump || "0")).toFixed(4)
                          : (bumpCount * parseFloat(tokensPerSell || "0")).toFixed(0)}
                      </p>
                      <p className="text-[10px] font-bold text-muted-foreground uppercase">
                        {bumpAction === "buy" ? "SOL Spent" : "Tokens Sold"}
                      </p>
                    </div>
                  </div>

                  {currentlyBumping ? (
                    <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-3">
                      <Loader2 className="w-4 h-4 text-emerald-500 animate-spin" />
                      <span className="text-sm font-bold text-emerald-500">
                        {usingSession ? "Bumping (auto-signed by session wallet)…" : "Sending bump — approve in wallet…"}
                      </span>
                    </div>
                  ) : isRunning && countdown > 0 ? (
                    <div className="flex items-center gap-2 rounded-xl bg-muted/30 border border-border px-4 py-3">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-bold text-foreground">Next bump in </span>
                      <span className="text-sm font-black text-emerald-500 tabular-nums" data-testid="text-countdown">{formatCountdown(countdown)}</span>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            )}

            {/* Bump log — always visible once a wallet is connected, so users
                know where transaction results will appear before the first
                bump fires. Empty state replaces the list before any bumps. */}
            {connected && (
              <CollapsibleSection
                testid="card-bump-log"
                title="Bump Log"
                headerExtra={bumpLog.length > 0 && (
                  <span className="text-[10px] text-muted-foreground" data-testid="text-bump-log-count">
                    {bumpLog.length} this session
                  </span>
                )}
              >
                  {bumpLog.length === 0 ? (
                    <div
                      className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-4 text-center"
                      data-testid="text-bump-log-empty"
                    >
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        No bumps yet. After you hit <b>Start Bumping</b>, each transaction will appear
                        here with a Solscan link — successes in green, failures in red.
                      </p>
                    </div>
                  ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {bumpLog.map(log => (
                      <div key={log.id}
                        className={`flex items-start gap-2.5 rounded-lg px-3 py-2 text-xs ${log.status === "success" ? "bg-emerald-500/5 border border-emerald-500/10" : "bg-red-500/5 border border-red-500/10"}`}
                        data-testid={`bump-log-${log.id}`}>
                        {log.status === "success"
                          ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
                          : <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />}
                        <div className="flex-1 min-w-0">
                          <span className="font-bold text-foreground">
                            {log.status === "success"
                              ? `${log.action === "buy" ? `${log.amount} SOL bump` : `Sold ${log.amount} tokens`} sent`
                              : "Bump failed"}
                          </span>
                          {log.txid && (
                            <a href={`https://solscan.io/tx/${log.txid}`} target="_blank" rel="noopener noreferrer"
                              className="ml-2 text-blue-500 hover:underline font-mono text-[10px]">
                              {log.txid.slice(0, 12)}… <ExternalLink className="inline w-2.5 h-2.5" />
                            </a>
                          )}
                          {log.signer && (
                            <span
                              className="ml-2 inline-flex items-center gap-1 text-[10px] text-muted-foreground font-mono"
                              title={`Signed by ${log.signer}`}
                              data-testid={`text-bump-signer-${log.id}`}
                            >
                              · from {log.signer.slice(0, 4)}…{log.signer.slice(-4)}
                            </span>
                          )}
                          {log.error && <p className="text-[10px] text-red-500 mt-0.5 truncate">{log.error}</p>}
                        </div>
                        <span className="flex-shrink-0 text-[10px] text-muted-foreground">
                          {log.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </span>
                      </div>
                    ))}
                  </div>
                  )}
              </CollapsibleSection>
            )}

            {/* Live token trades — every buy/sell on this mint, streamed
                via the server's PumpPortal WebSocket. Trades fired by the
                user's own wallets (main + sub-wallets + session) are
                highlighted so they can tell theirs apart from everyone
                else's at a glance. */}
            {addrValid && (
              <LiveTradesCard
                mint={tokenAddress}
                ownWallets={[
                  publicKey?.toBase58(),
                  sessionKeypair?.publicKey.toBase58(),
                  ...subKeypairs.map(k => k.publicKey.toBase58()),
                  ...subPubkeysFromVault,
                ].filter((x): x is string => !!x)}
              />
            )}

            {/* Persistent history — survives logout/refresh because it's
                stored server-side keyed on the connected main wallet. */}
            {connected && publicKey && (
              <BumpHistoryCard ownerWallet={publicKey.toBase58()} />
            )}
          </div>

          {/* ─────────── RIGHT: info panels ─────────── */}
          <div className="lg:col-span-2 space-y-4">

            {/* How it works */}
            <Card>
              <CardContent className="p-5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-3">How It Works</p>
                <ol className="space-y-3">
                  {[
                    ["Pick direction & token", "Buy bumps push the token up the recent-trades list. Sell bumps fire if you already hold tokens."],
                    ["Set amount, interval, count", "Custom intervals up to 24h. Variable SOL or token amounts per bump."],
                    ["Choose signing mode",  "Sign each bump for max safety, or fund a session wallet once for hands-free bumping."],
                    ["Watch the log",         "Every transaction is recorded with a Solscan link. Stop or reset any time."],
                  ].map(([title, detail], i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[11px] font-bold flex items-center justify-center">
                        {i + 1}
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-foreground">{title}</p>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">{detail}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>

            {/* What a bump does */}
            <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-950/20">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Info className="w-4 h-4 text-blue-500 flex-shrink-0" />
                  <p className="text-xs font-bold text-foreground">What does "bumping" do?</p>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Every trade on pump.fun's bonding curve pushes the token to the top of the "Recently Traded" list — giving it more visibility.
                  A buy of 0.001 SOL is the practical minimum. The tokens you receive stay in the buying wallet (your main wallet, or your session wallet).
                </p>
              </CardContent>
            </Card>

            {/* Coming soon */}
            <Card className="border-dashed">
              <CardContent className="p-4">
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-3">Coming Soon</p>
                <div className="space-y-2">
                  {[
                    ["Auto-sell after bump",   "Sell tokens immediately after each buy bump to recover most of your SOL."],
                    ["Multi-token scheduler",  "Queue bumps across multiple tokens simultaneously."],
                  ].map(([feat, desc]) => (
                    <div key={feat as string} className="flex items-start gap-2">
                      <Lock className="w-3 h-3 text-muted-foreground flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-[11px] font-bold text-muted-foreground">{feat}</p>
                        <p className="text-[10px] text-muted-foreground/70">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <Footer />
      </main>

      <LoginModal open={loginOpen} onOpenChange={setLoginOpen} walletOnly />

      <RegenerateGuardDialog
        config={regenGuard}
        onClose={() => setRegenGuard(null)}
      />

      <Dialog open={riskOpen} onOpenChange={setRiskOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-risk-notice">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="w-4 h-4 text-yellow-500" />
              Heads up before we start
            </DialogTitle>
            <DialogDescription className="sr-only">Risk notice for the bump bot</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm leading-relaxed">
            <p>
              Each bump spends <b>real SOL</b> on-chain. Costs depend on the bump
              size you set, network priority fees, and slippage.
            </p>
            <p>
              In <b>Auto mode</b>, your session wallet's funds can be used by
              anyone with access to this browser tab while the bot is running —
              keep the tab on a trusted device and only fund what you'd be
              comfortable losing.
            </p>
            <p>
              Sweep funds back to your main wallet when you're done. We never
              custody your funds; everything stays on-chain in your wallets.
            </p>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2 mt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setRiskOpen(false)}
              data-testid="button-risk-cancel"
            >
              Cancel
            </Button>
            <Button
              className="flex-1 font-bold"
              onClick={handleRiskAccept}
              data-testid="button-risk-accept"
            >
              I understand — start
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Live trades for a single mint. Polls /api/pump-portal/trades/:mint every
 * 3s; the server lazily subscribes to PumpPortal's `subscribeTokenTrade`
 * channel on first poll and auto-unsubscribes after ~90s of inactivity.
 *
 * Trades whose `trader` matches one of `ownWallets` are tagged "you" so the
 * operator can see their own bumps land in the chain feed in real time
 * alongside any organic activity from other traders.
 */
interface LiveTradeRow {
  signature: string;
  mint: string;
  trader: string;
  side: "buy" | "sell";
  solAmount: number;
  tokenAmount: number;
  marketCapSol: number;
  receivedAt: number;
}

function LiveTradesCard({ mint, ownWallets }: { mint: string; ownWallets: string[] }) {
  const ownSet = new Set(ownWallets);
  const { data, isLoading } = useQuery<{ trades: LiveTradeRow[]; mint: string; polledAt: number }>({
    queryKey: ["/api/pump-portal/trades", mint],
    refetchInterval: 3_000,
    enabled: !!mint,
  });

  const trades = data?.trades ?? [];
  const yourCount = trades.filter(t => ownSet.has(t.trader)).length;

  function fmtRel(ms: number): string {
    const diff = Math.max(0, Date.now() - ms);
    const s = Math.floor(diff / 1000);
    if (s < 5) return "just now";
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ago`;
  }

  return (
    <Card data-testid="card-live-trades">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Radio className="w-4 h-4 text-emerald-500 animate-pulse" />
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            Live trades on this token
          </p>
          <span className="ml-auto text-[10px] text-muted-foreground" data-testid="text-live-trades-meta">
            {trades.length === 0 ? "waiting…" : `last ${trades.length}`}
            {yourCount > 0 && (
              <span className="ml-1.5 font-bold text-emerald-500">· {yourCount} yours</span>
            )}
          </span>
        </div>

        {isLoading && trades.length === 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
            <Loader2 className="w-3 h-3 animate-spin" /> Connecting to live feed…
          </div>
        )}

        {!isLoading && trades.length === 0 && (
          <p className="text-[11px] text-muted-foreground py-3" data-testid="text-no-live-trades">
            No trades hitting the chain yet for this token. As soon as anyone
            (you or someone else) buys or sells, it'll show up here within a
            second or two.
          </p>
        )}

        {trades.length > 0 && (
          <div className="space-y-1.5 max-h-72 overflow-y-auto" data-testid="list-live-trades">
            {trades.map(t => {
              const mine = ownSet.has(t.trader);
              const isBuy = t.side === "buy";
              return (
                <div key={t.signature || `${t.trader}-${t.receivedAt}`}
                  className={`flex items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-[11px] border ${
                    mine
                      ? "bg-emerald-500/10 border-emerald-500/40 ring-1 ring-emerald-500/20"
                      : isBuy
                        ? "bg-emerald-500/5 border-emerald-500/10"
                        : "bg-rose-500/5 border-rose-500/10"
                  }`}
                  data-testid={`live-trade-${t.signature || t.trader}`}>
                  {isBuy
                    ? <ArrowUpRight className="w-3 h-3 text-emerald-500 flex-shrink-0 mt-0.5" />
                    : <ArrowDownRight className="w-3 h-3 text-rose-500 flex-shrink-0 mt-0.5" />}
                  <div className="flex-1 min-w-0">
                    <span className={`font-bold ${isBuy ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                      {isBuy ? "BUY" : "SELL"} {t.solAmount > 0 ? `${t.solAmount.toFixed(4)} SOL` : ""}
                    </span>
                    {mine && (
                      <span className="ml-1.5 inline-flex items-center px-1 py-0.5 rounded text-[8px] font-bold uppercase tracking-wide bg-emerald-500 text-white">
                        you
                      </span>
                    )}
                    <a href={`https://solscan.io/account/${t.trader}`} target="_blank" rel="noopener noreferrer"
                      className="ml-1.5 font-mono text-[10px] text-muted-foreground hover:text-foreground hover:underline"
                      title={t.trader}>
                      {t.trader.slice(0, 4)}…{t.trader.slice(-4)}
                    </a>
                    {t.signature && (
                      <a href={`https://solscan.io/tx/${t.signature}`} target="_blank" rel="noopener noreferrer"
                        className="ml-1.5 text-blue-500 hover:underline font-mono text-[10px]">
                        tx <ExternalLink className="inline w-2.5 h-2.5" />
                      </a>
                    )}
                  </div>
                  <span className="flex-shrink-0 text-[10px] text-muted-foreground" title={new Date(t.receivedAt).toLocaleString()}>
                    {fmtRel(t.receivedAt)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Persistent bump history. Reads from `/api/bump-history/:wallet` keyed on
 * the connected MAIN wallet (publicKey) — so the user sees their full record
 * even after logging out and back in, regardless of which session sub-wallet
 * actually signed any individual bump.
 */
function BumpHistoryCard({ ownerWallet }: { ownerWallet: string }) {
  const { data, isLoading, refetch, isRefetching } = useQuery<BumpHistoryResponse>({
    queryKey: ["/api/bump-history", ownerWallet],
    refetchInterval: 30_000,
  });

  const stats = data?.stats;
  const rows = data?.history ?? [];

  function fmtRel(iso: string): string {
    const t = new Date(iso).getTime();
    const diff = Math.max(0, Date.now() - t);
    const m = Math.floor(diff / 60_000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  }

  return (
    <Card data-testid="card-bump-history">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <History className="w-4 h-4 text-blue-500" />
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">All-time history</p>
          <Button onClick={() => refetch()} size="sm" variant="ghost"
            className="ml-auto h-6 px-2"
            disabled={isLoading || isRefetching}
            data-testid="button-refresh-bump-history">
            <Loader2 className={`w-3 h-3 ${isRefetching ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Stats row */}
        {stats && stats.totalBumps > 0 && (
          <div className="grid grid-cols-3 gap-2 mb-3 text-center">
            <div className="rounded-lg border border-border bg-card/50 py-2" data-testid="stat-history-total">
              <p className="text-[9px] uppercase text-muted-foreground font-bold">Total</p>
              <p className="text-sm font-bold text-foreground">{stats.totalBumps}</p>
            </div>
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 py-2" data-testid="stat-history-success">
              <p className="text-[9px] uppercase text-emerald-600 dark:text-emerald-400 font-bold">Success</p>
              <p className="text-sm font-bold text-emerald-500">{stats.totalSuccess}</p>
            </div>
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 py-2" data-testid="stat-history-failed">
              <p className="text-[9px] uppercase text-rose-600 dark:text-rose-400 font-bold">Failed</p>
              <p className="text-sm font-bold text-rose-500">{stats.totalFailed}</p>
            </div>
          </div>
        )}
        {stats && stats.totalSolSpent > 0 && (
          <p className="text-[11px] text-muted-foreground mb-3">
            Lifetime SOL spent on buys: <span className="font-bold text-foreground">{stats.totalSolSpent.toFixed(4)} SOL</span>
          </p>
        )}

        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading history…
          </div>
        )}

        {!isLoading && rows.length === 0 && (
          <p className="text-[11px] text-muted-foreground py-3" data-testid="text-no-history">
            No bumps yet. Run the bot once and your trades will be saved here forever — even after you log out.
          </p>
        )}

        {rows.length > 0 && (
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {rows.map(r => (
              <div key={r.id}
                className={`flex items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-[11px] ${r.status === "success" ? "bg-emerald-500/5 border border-emerald-500/10" : "bg-red-500/5 border border-red-500/10"}`}
                data-testid={`history-row-${r.id}`}>
                {r.status === "success"
                  ? <CheckCircle2 className="w-3 h-3 text-emerald-500 flex-shrink-0 mt-0.5" />
                  : <XCircle className="w-3 h-3 text-red-500 flex-shrink-0 mt-0.5" />}
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-foreground">
                    {r.action === "buy"
                      ? `Buy ${r.amountSol ?? "?"} SOL`
                      : `Sell ${r.amountTokens ?? "?"} tokens`}
                  </span>
                  <span className="ml-2 font-mono text-[10px] text-muted-foreground" title={r.mint}>
                    {r.mint.slice(0, 4)}…{r.mint.slice(-4)}
                  </span>
                  {r.txSignature && (
                    <a href={`https://solscan.io/tx/${r.txSignature}`} target="_blank" rel="noopener noreferrer"
                      className="ml-2 text-blue-500 hover:underline font-mono text-[10px]">
                      {r.txSignature.slice(0, 8)}… <ExternalLink className="inline w-2.5 h-2.5" />
                    </a>
                  )}
                  {r.errorMessage && (
                    <p className="text-[10px] text-red-500 mt-0.5 truncate" title={r.errorMessage}>
                      {r.errorMessage}
                    </p>
                  )}
                </div>
                <span className="flex-shrink-0 text-[10px] text-muted-foreground" title={new Date(r.createdAt).toLocaleString()}>
                  {fmtRel(r.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
