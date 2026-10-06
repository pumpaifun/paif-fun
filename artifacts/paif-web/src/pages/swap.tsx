import { useState, useEffect, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowDownUp, ChevronDown, Search, X, Loader2, ExternalLink, AlertTriangle, Zap, RefreshCw, Home, CheckCircle2 } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { LoginModal } from "@/components/login-modal";
import { MoonPayModal } from "@/components/moonpay-modal";
import { OpenInPhantomBanner } from "@/components/open-in-phantom";

interface JupToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
}

const SOL: JupToken = {
  address: "So11111111111111111111111111111111111111112",
  symbol: "SOL", name: "Solana", decimals: 9,
  logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
};
const USDC: JupToken = {
  address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  symbol: "USDC", name: "USD Coin", decimals: 6,
  logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
};
const PAIF: JupToken = {
  address: "HngT3GgmdyEZPmJAu4H84SeoexDb9kccQcZGQxvDpump",
  symbol: "PAIF", name: "Pump AI Fun", decimals: 6,
};

const isPumpToken = (addr: string) => addr.toLowerCase().endsWith("pump");

const POPULAR: JupToken[] = [
  SOL, USDC,
  { address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", name: "Bonk", decimals: 5, logoURI: "https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I" },
  { address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", symbol: "WIF", name: "dogwifhat", decimals: 6, logoURI: "https://bafkreibk3covs5ltyqxa272uodhculbgn2ponwikpvh3rrhh4hdzfmtrai.ipfs.nftstorage.link/" },
  { address: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", symbol: "POPCAT", name: "Popcat", decimals: 9 },
  { address: "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v", symbol: "JUP", name: "Jupiter", decimals: 6 },
  { address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", name: "Tether USD", decimals: 6 },
  { address: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", symbol: "mSOL", name: "Marinade SOL", decimals: 9 },
];

const IS_MINT = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.trim());
const QUICK_EXPIRY = [
  { label: "15m",      value: "15m" },
  { label: "1 hr",     value: "1h" },
  { label: "1 day",    value: "1d" },
  { label: "1 wk",     value: "1w" },
  { label: "Custom",   value: "custom" },
  { label: "No expiry",value: "none" },
];

function TokenLogo({ token, size = 8 }: { token: JupToken; size?: number }) {
  const [err, setErr] = useState(false);
  const cls = `w-${size} h-${size} rounded-full border border-border object-cover flex-shrink-0`;
  if (token.logoURI && !err)
    return <img src={token.logoURI} alt={token.symbol} className={cls} onError={() => setErr(true)} />;
  return (
    <div className={`w-${size} h-${size} rounded-full bg-muted flex items-center justify-center text-[10px] font-bold border border-border flex-shrink-0`}>
      {token.symbol.slice(0, 2)}
    </div>
  );
}

function TokenPicker({
  open, onClose, onSelect, exclude,
}: { open: boolean; onClose: () => void; onSelect: (t: JupToken) => void; exclude?: string; }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<JupToken[]>([]);
  const [allTokens, setAllTokens] = useState<JupToken[]>([]);
  const [contractToken, setContractToken] = useState<JupToken | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("https://tokens.jup.ag/tokens?tags=verified")
      .then((r) => r.json())
      .then((d: JupToken[]) => setAllTokens(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) { setQuery(""); setResults([]); setContractToken(null); }
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); setContractToken(null); return; }

    if (IS_MINT(q)) {
      const known = POPULAR.find((t) => t.address === q) || allTokens.find((t) => t.address === q);
      if (known) { setContractToken(known); setResults([]); return; }
      setLookingUp(true);
      fetch(`https://tokens.jup.ag/token/${q}`)
        .then((r) => r.ok ? r.json() : null)
        .then((d) => setContractToken(d?.address ? { address: d.address, symbol: d.symbol || "?", name: d.name || "Unknown", decimals: d.decimals ?? 6, logoURI: d.logoURI } : { address: q, symbol: "?", name: "Unknown Token", decimals: 6 }))
        .catch(() => setContractToken({ address: q, symbol: "?", name: "Unknown Token", decimals: 6 }))
        .finally(() => setLookingUp(false));
      return;
    }

    setContractToken(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const lower = q.toLowerCase();
      setResults(allTokens.filter((t) => t.symbol.toLowerCase().includes(lower) || t.name.toLowerCase().includes(lower)).slice(0, 10));
    }, 200);
  }, [query, allTokens]);

  const pick = (t: JupToken) => { if (t.address !== exclude) { onSelect(t); onClose(); } };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm p-0 gap-0" data-testid="dialog-token-picker">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="text-base font-bold">Select token</DialogTitle>
        </DialogHeader>
        <div className="px-4 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              autoFocus
              className="pl-9"
              placeholder="Search name, symbol, or paste address…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="input-token-picker-search"
            />
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {!query.trim() && (
            <div className="px-4 pb-3">
              <p className="text-[11px] font-semibold text-muted-foreground mb-2">Popular tokens</p>
              <div className="grid grid-cols-4 gap-1.5">
                {POPULAR.filter((t) => t.address !== exclude).map((t) => (
                  <button key={t.address} onClick={() => pick(t)}
                    className="flex flex-col items-center gap-1 p-2 rounded-lg border border-border hover:bg-muted transition-colors"
                    data-testid={`button-popular-${t.symbol}`}>
                    <TokenLogo token={t} size={8} />
                    <span className="text-[11px] font-bold text-foreground">{t.symbol}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {lookingUp && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {contractToken && (
            <button onClick={() => pick(contractToken)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors text-left"
              data-testid="button-use-contract">
              <TokenLogo token={contractToken} size={9} />
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground">{contractToken.symbol}</p>
                <p className="text-[11px] text-muted-foreground">{contractToken.name}</p>
                <p className="text-[10px] font-mono text-muted-foreground">{contractToken.address.slice(0, 8)}…{contractToken.address.slice(-6)}</p>
              </div>
            </button>
          )}

          {results.map((t) => (
            <button key={t.address} onClick={() => pick(t)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition-colors text-left"
              data-testid={`button-result-${t.symbol}`}>
              <TokenLogo token={t} size={9} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-foreground">{t.symbol}</p>
                <p className="text-[11px] text-muted-foreground truncate">{t.name}</p>
              </div>
              <p className="text-[10px] font-mono text-muted-foreground flex-shrink-0">{t.address.slice(0, 6)}…{t.address.slice(-4)}</p>
            </button>
          ))}

          {query.trim() && !contractToken && results.length === 0 && !lookingUp && (
            <p className="text-xs text-muted-foreground text-center py-6">No tokens found</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function SwapPage() {
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();
  const { solBalance, tokenBalances, isLoading: balanceLoading, refresh: refreshBalance } = useWalletBalance();
  const walletKey = publicKey?.toBase58() ?? null;

  const [loginOpen, setLoginOpen] = useState(false);
  const [moonpayOpen, setMoonpayOpen] = useState(false);
  const [mode, setMode] = useState<"swap" | "limit">("swap");
  const [fromToken, setFromToken] = useState<JupToken>(SOL);
  const [toToken, setToToken] = useState<JupToken>(() => {
    if (typeof window !== "undefined") {
      const outputMint = new URLSearchParams(window.location.search).get("outputMint");
      if (outputMint === PAIF.address) return PAIF;
    }
    return USDC;
  });
  const [fromAmount, setFromAmount] = useState("");
  const [pickerFor, setPickerFor] = useState<"from" | "to" | null>(null);

  const [limitMode, setLimitMode] = useState<"sell" | "buy">("sell");
  const [limitNoTarget, setLimitNoTarget] = useState(false);
  const [limitInputType, setLimitInputType] = useState<"price" | "percent">("price");
  const [limitPrice, setLimitPrice] = useState("");
  const [limitPercent, setLimitPercent] = useState("");
  const [limitExpiry, setLimitExpiry] = useState("1d");
  const [customDays, setCustomDays] = useState("0");
  const [customHours, setCustomHours] = useState("1");
  const [customMinutes, setCustomMinutes] = useState("30");

  const [slippageBps, setSlippageBps] = useState(100);
  const [showSlippage, setShowSlippage] = useState(false);

  const [quoteData, setQuoteData] = useState<any>(null);
  const [pumpQuoteData, setPumpQuoteData] = useState<{
    tokensOut?: string; solOut?: string;
    pricePerToken: string; marketCapSol: string;
    complete: boolean; action: "buy" | "sell";
  } | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [swapLoading, setSwapLoading] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [swapSuccess, setSwapSuccess] = useState(false);
  const [swapSuccessTxId, setSwapSuccessTxId] = useState<string | null>(null);
  const [swapErrorTxId, setSwapErrorTxId] = useState<string | null>(null);
  // true when a pump.fun token was detected as graduated and auto-routed to Jupiter
  const [pumpGraduatedRouted, setPumpGraduatedRouted] = useState(false);

  const [solPrice, setSolPrice] = useState<number | null>(null);
  const [tokenPrice, setTokenPrice] = useState<number | null>(null);
  const [userCurrency, setUserCurrency] = useState("USD");
  const [forexRate, setForexRate] = useState(1);

  useEffect(() => {
    const locale = navigator.language || "en-US";
    const lang = locale.toLowerCase();
    let currency = "USD";
    if (lang.startsWith("en-gb")) currency = "GBP";
    else if (lang.startsWith("en-au")) currency = "AUD";
    else if (lang.startsWith("en-ca")) currency = "CAD";
    else if (lang.startsWith("ja")) currency = "JPY";
    else if (lang.startsWith("ko")) currency = "KRW";
    else if (lang.startsWith("zh")) currency = "CNY";
    else if (["de", "fr", "it", "es", "pt", "nl", "fi", "el", "sk", "sl", "lv", "lt", "et", "mt"].some((c) => lang.startsWith(c))) currency = "EUR";
    setUserCurrency(currency);
    if (currency !== "USD") {
      fetch(`https://api.frankfurter.app/latest?from=USD&to=${currency}`)
        .then((r) => r.json())
        .then((d) => { if (d?.rates?.[currency]) setForexRate(d.rates[currency]); })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    fetch("https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112")
      .then((r) => r.json())
      .then((d) => {
        const p = d?.["So11111111111111111111111111111111111111112"]?.usdPrice;
        if (typeof p === "number" && p > 0) setSolPrice(p);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const mint = fromToken.address === SOL.address ? toToken.address : fromToken.address;
    if (mint === SOL.address) { setTokenPrice(null); return; }
    fetch(`https://lite-api.jup.ag/price/v3?ids=${mint}`)
      .then((r) => r.json())
      .then((d) => {
        const p = d?.[mint]?.usdPrice;
        if (typeof p === "number" && p > 0) setTokenPrice(p);
      })
      .catch(() => {});
  }, [fromToken.address, toToken.address]);

  const fromDecimalMult = Math.pow(10, fromToken.decimals);
  const toDecimalMult = Math.pow(10, toToken.decimals);

  const fromBalance = fromToken.address === SOL.address
    ? solBalance ?? 0
    : tokenBalances.find((t) => t.mint === fromToken.address)?.uiAmount ?? 0;

  const formatLocal = (usd: number) => {
    try {
      return new Intl.NumberFormat(navigator.language || "en-US", { style: "currency", currency: userCurrency, maximumFractionDigits: 2 }).format(usd * forexRate);
    } catch { return `$${usd.toFixed(2)}`; }
  };

  const fromUsd = (() => {
    const n = parseFloat(fromAmount);
    if (!n || isNaN(n)) return null;
    if (fromToken.address === SOL.address && solPrice) return formatLocal(n * solPrice);
    if (tokenPrice) return formatLocal(n * tokenPrice);
    return null;
  })();

  const PUMP_DECIMALS = 6;

  const toAmountDisplay = (() => {
    if (pumpQuoteData) {
      if (pumpQuoteData.action === "buy" && pumpQuoteData.tokensOut) {
        return (Number(pumpQuoteData.tokensOut) / Math.pow(10, PUMP_DECIMALS))
          .toLocaleString(undefined, { maximumFractionDigits: 6 });
      }
      if (pumpQuoteData.action === "sell" && pumpQuoteData.solOut) {
        return (Number(pumpQuoteData.solOut) / 1e9)
          .toLocaleString(undefined, { maximumFractionDigits: 6 });
      }
    }
    if (!quoteData) return "0";
    const raw = parseInt(quoteData.outAmount, 10);
    return (raw / toDecimalMult).toLocaleString(undefined, { maximumFractionDigits: 6 });
  })();

  const toUsd = (() => {
    if (pumpQuoteData?.action === "sell" && pumpQuoteData.solOut && solPrice) {
      return formatLocal((Number(pumpQuoteData.solOut) / 1e9) * solPrice);
    }
    if (!quoteData || !solPrice) return null;
    const raw = parseInt(quoteData.outAmount, 10);
    const n = raw / toDecimalMult;
    if (toToken.address === SOL.address && solPrice) return formatLocal(n * solPrice);
    return null;
  })();

  const handleMax = () => {
    if (fromToken.address === SOL.address) {
      setFromAmount(Math.max(0, (solBalance ?? 0) - 0.005).toFixed(4));
    } else {
      setFromAmount(fromBalance.toString());
    }
    setQuoteData(null);
  };

  const swapDirection = () => {
    setFromToken(toToken);
    setToToken(fromToken);
    setFromAmount("");
    setQuoteData(null);
    setPumpQuoteData(null);
    setQuoteError(null);
  };

  // Detect which token is the pump.fun bonding-curve token (if any)
  const pumpMint = isPumpToken(toToken.address) ? toToken.address
    : isPumpToken(fromToken.address) ? fromToken.address
    : null;
  // buy = spending SOL to get pump token; sell = spending pump token to get SOL
  const pumpAction: "buy" | "sell" = isPumpToken(toToken.address) ? "buy" : "sell";

  const handleGetQuote = useCallback(async () => {
    const n = parseFloat(fromAmount);
    if (!n || n <= 0) return;
    setQuoteLoading(true);
    setQuoteError(null);
    setQuoteData(null);
    setPumpQuoteData(null);
    setPumpGraduatedRouted(false);
    setSwapSuccess(false);
    setSwapSuccessTxId(null);
    setSwapErrorTxId(null);

    // Helper: fetch a Jupiter quote for the current from/to tokens
    const fetchJupiterQuote = async () => {
      const lamports = Math.floor(n * fromDecimalMult);
      const res = await apiRequest("POST", "/api/swap/quote", {
        inputMint: fromToken.address,
        outputMint: toToken.address,
        amount: lamports,
        slippageBps,
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setQuoteData(data);
    };

    try {
      if (pumpMint) {
        // pump.fun bonding curve flow
        let amount: number;
        if (pumpAction === "buy") {
          amount = Math.floor(n * 1e9); // SOL lamports
        } else {
          amount = n; // token UI amount (decimals handled server-side)
        }
        const params = new URLSearchParams({
          mint: pumpMint, action: pumpAction,
          amount: amount.toString(), decimals: PUMP_DECIMALS.toString(),
        });
        const res = await fetch(`/api/pump/quote?${params}`);
        const data = await res.json();
        if (data.error) {
          // Token has graduated from pump.fun → auto-route through Jupiter
          if (data.error === "PUMP_GRADUATED" || data.error.toLowerCase().includes("graduated")) {
            setPumpGraduatedRouted(true);
            await fetchJupiterQuote();
            return;
          }
          throw new Error(data.error);
        }
        setPumpQuoteData({ ...data, action: pumpAction });
      } else {
        // Jupiter flow
        await fetchJupiterQuote();
      }
    } catch (err: any) {
      setQuoteError(err.message || "Failed to get quote");
    } finally {
      setQuoteLoading(false);
    }
  }, [fromAmount, fromToken, toToken, slippageBps, fromDecimalMult, pumpMint, pumpAction]);

  // Keep a stable ref to handleGetQuote so the debounce effect always calls the latest version
  const handleGetQuoteRef = useRef(handleGetQuote);
  useEffect(() => { handleGetQuoteRef.current = handleGetQuote; }, [handleGetQuote]);

  // Auto-quote whenever the amount, tokens, slippage, or mode changes (debounced 700ms)
  const autoQuoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (mode !== "swap") return;
    if (autoQuoteTimerRef.current) clearTimeout(autoQuoteTimerRef.current);
    // Clear stale state immediately so UI reflects the change right away
    setQuoteData(null);
    setPumpQuoteData(null);
    setPumpGraduatedRouted(false);
    setQuoteError(null);
    setSwapSuccess(false);
    setSwapSuccessTxId(null);
    setSwapError(null);
    setSwapErrorTxId(null);
    if (!fromAmount || parseFloat(fromAmount) <= 0) return;
    autoQuoteTimerRef.current = setTimeout(() => {
      handleGetQuoteRef.current();
    }, 700);
    return () => { if (autoQuoteTimerRef.current) clearTimeout(autoQuoteTimerRef.current); };
  }, [fromAmount, fromToken.address, toToken.address, slippageBps, mode]);

  const handleSwap = useCallback(async () => {
    if (!publicKey || !signTransaction || !connected) return;
    if (!quoteData && !pumpQuoteData) return;
    setSwapLoading(true);
    setSwapError(null);
    setSwapSuccess(false);
    setSwapSuccessTxId(null);
    setSwapErrorTxId(null);
    try {
      const { VersionedTransaction } = await import("@solana/web3.js");
      let serializedTx: string;

      if (pumpQuoteData && pumpMint) {
        // pump.fun bonding curve flow
        const n = parseFloat(fromAmount);
        let txRes: Response;
        if (pumpAction === "buy") {
          txRes = await apiRequest("POST", "/api/pump/buy-tx", {
            mint: pumpMint,
            userPublicKey: publicKey.toBase58(),
            solLamports: Math.floor(n * 1e9),
            slippageBps,
          });
        } else {
          txRes = await apiRequest("POST", "/api/pump/sell-tx", {
            mint: pumpMint,
            userPublicKey: publicKey.toBase58(),
            tokenAmount: n,
            decimals: PUMP_DECIMALS,
            slippageBps,
          });
        }
        const txData = await txRes.json();
        if (txData.error) throw new Error(txData.error);
        serializedTx = txData.transaction;
      } else {
        // Jupiter flow
        const txRes = await apiRequest("POST", "/api/swap/transaction", {
          quoteResponse: quoteData,
          userPublicKey: publicKey.toBase58(),
        });
        const txData = await txRes.json();
        serializedTx = txData.swapTransaction;
      }

      const txBuf = Buffer.from(serializedTx, "base64");
      const transaction = VersionedTransaction.deserialize(txBuf);
      const signed = await signTransaction(transaction as any);

      // Fetch latest blockhash for expiry-aware confirmation
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      const txId = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true, maxRetries: 3 });

      // Confirm with expiry detection — this will throw if the tx expires or is rejected
      const confirmation = await connection.confirmTransaction(
        { signature: txId, blockhash, lastValidBlockHeight },
        "confirmed"
      );

      if (confirmation.value.err) {
        // Parse the on-chain error to give a specific message
        const errJson = JSON.stringify(confirmation.value.err);
        // 6001 = Jupiter SlippageToleranceExceeded; 6002 = pump.fun AMM
        // slippage revert; 1771/0x1771 = Raydium slippage. These all mean the
        // price moved past tolerance during signing — NOT a fee shortfall.
        // Match the exact Custom code so unrelated codes (e.g. 16002) don't
        // get misclassified as slippage.
        const isSlippage =
          /"Custom":(6001|6002|1771)\b/.test(errJson) ||
          errJson.includes("0x1771") ||
          errJson.includes("SlippageTolerance");
        const msg = isSlippage
          ? "Price moved past your slippage while you were signing — the extra wallet warning screen adds a few seconds, which is enough to slip on a low-liquidity token. Raise slippage to 3% or 5% and try again."
          : `The swap reverted on-chain — usually the route changed or the price moved during signing. Refresh the quote and retry with higher slippage. (${errJson})`;
        setSwapErrorTxId(txId);
        throw new Error(msg);
      }

      setSwapSuccessTxId(txId);
      setSwapSuccess(true);
      setQuoteData(null);
      setPumpQuoteData(null);
      setFromAmount("");
      refreshBalance();
    } catch (err: any) {
      const msg = err.message || "Swap failed";
      setSwapError(msg);
    } finally {
      setSwapLoading(false);
    }
  }, [publicKey, signTransaction, connected, connection, quoteData, pumpQuoteData, pumpMint, pumpAction, fromAmount, fromToken, toToken, slippageBps, refreshBalance, walletKey, swapErrorTxId]);

  const priceImpact = quoteData ? parseFloat(quoteData.priceImpactPct || "0") : 0;

  const hasPumpToken = isPumpToken(fromToken.address) || isPumpToken(toToken.address);

  // Convert raw API error messages into human-readable explanations
  const friendlyError = (msg: string): { text: string; link?: string } => {
    if (msg.includes("TOKEN_NOT_TRADABLE") || msg.includes("not tradable")) {
      return {
        text: "This token trades through pump.fun's bonding curve and can't be routed through Jupiter's API yet. Use Phantom's built-in swap or trade directly on pump.fun.",
        link: `https://pump.fun/coin/${isPumpToken(toToken.address) ? toToken.address : fromToken.address}`,
      };
    }
    if (msg.includes("COULD_NOT_FIND_ANY_ROUTE") || msg.includes("No routes")) {
      return { text: "No swap route found between these two tokens. Try a different pair or check back later." };
    }
    if (msg.includes("INSUFFICIENT_LIQUIDITY") || msg.includes("insufficient liquidity")) {
      return { text: "Not enough liquidity to fill this swap. Try a smaller amount." };
    }
    if (msg.includes("400") || msg.includes("quote failed")) {
      // Try to extract the inner errorCode
      const codeMatch = msg.match(/"errorCode":"([^"]+)"/);
      if (codeMatch) return { text: `Jupiter error: ${codeMatch[1].replace(/_/g, " ").toLowerCase()}` };
    }
    return { text: msg };
  };

  // Limit order computed values (hoisted out of JSX to avoid IIFE syntax issues)
  const limitRefPrice = fromToken.address === SOL.address ? solPrice : tokenPrice;
  const isLimitPerc = limitInputType === "percent";
  const limitPercSigns = limitMode === "sell"
    ? [{ label: "Market", pct: 0 }, { label: "+1%", pct: 1 }, { label: "+5%", pct: 5 }, { label: "+10%", pct: 10 }]
    : [{ label: "Market", pct: 0 }, { label: "−1%", pct: -1 }, { label: "−5%", pct: -5 }, { label: "−10%", pct: -10 }];
  const applyLimitPreset = (pct: number) => {
    if (isLimitPerc) {
      setLimitPercent(pct === 0 ? "" : Math.abs(pct).toString());
    } else if (limitRefPrice) {
      const target = pct === 0 ? limitRefPrice : limitRefPrice * (1 + pct / 100);
      setLimitPrice(target.toFixed(6).replace(/\.?0+$/, ""));
    }
  };
  const limitHasTarget = limitNoTarget || (isLimitPerc ? !!limitPercent : !!limitPrice);
  const limitBtnLabel = limitMode === "sell"
    ? (limitNoTarget ? "Market Sell at Expiry" : "Place Limit Sell")
    : (limitNoTarget ? "Market Buy at Expiry" : "Place Limit Buy");
  const limitBtnColor = limitMode === "sell" ? "bg-red-500 hover:bg-red-400" : "bg-emerald-600 hover:bg-emerald-500";

  const expiryLabel = (() => {
    if (limitExpiry === "15m")  return "15 minutes";
    if (limitExpiry === "1h")   return "1 hour";
    if (limitExpiry === "1d")   return "1 day";
    if (limitExpiry === "1w")   return "1 week";
    if (limitExpiry === "none") return "No expiry";
    if (limitExpiry === "custom") {
      const d = parseInt(customDays,    10) || 0;
      const h = parseInt(customHours,   10) || 0;
      const m = parseInt(customMinutes, 10) || 0;
      const parts: string[] = [];
      if (d > 0) parts.push(`${d}d`);
      if (h > 0) parts.push(`${h}h`);
      if (m > 0) parts.push(`${m}m`);
      return parts.length ? parts.join(" ") : "0m";
    }
    return "";
  })();

  return (
    <div className="max-w-md mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4">
        <Link href="/">
          <button className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground" data-testid="button-swap-home">
            <Home className="w-4 h-4" />
          </button>
        </Link>
        <ArrowDownUp className="w-5 h-5 text-emerald-500" />
        <h1 className="text-xl font-bold text-foreground" data-testid="text-swap-page-title">Swap</h1>
      </div>

      <OpenInPhantomBanner className="mb-4" />

      {/* Mode tabs */}
      <div className="flex rounded-lg border border-border overflow-hidden mb-4" data-testid="swap-mode-tabs">
        {(["swap", "limit"] as const).map((m) => (
          <button key={m} onClick={() => { setMode(m); setQuoteData(null); setQuoteError(null); }}
            className={`flex-1 py-2 text-sm font-bold capitalize transition-colors ${mode === m ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
            data-testid={`button-mode-${m}`}>
            {m === "limit" ? "Limit" : "Swap"}
          </button>
        ))}
        <button
          onClick={() => setMoonpayOpen(true)}
          className="flex-1 py-2 text-sm font-bold transition-colors text-muted-foreground hover:text-foreground border-l border-border"
          data-testid="button-mode-buy"
        >
          Buy
        </button>
      </div>

      <div className="space-y-1">
        {/* FROM box */}
        <div className="rounded-xl border border-border bg-muted/30 p-4" data-testid="box-sell">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-muted-foreground">Sell</span>
            {connected && (
              <button onClick={handleMax}
                className="text-[11px] text-emerald-500 font-bold hover:text-emerald-400 transition-colors"
                data-testid="button-max">
                Balance: {balanceLoading ? "…" : fromBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })} · Max
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <input
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={fromAmount}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "" || /^\d*\.?\d*$/.test(v)) {
                  setFromAmount(v);
                  setSwapError(null);
                  setSwapErrorTxId(null);
                }
              }}
              className="flex-1 bg-transparent text-3xl font-bold text-foreground outline-none min-w-0 placeholder:text-muted-foreground/40"
              data-testid="input-from-amount"
            />
            <button onClick={() => setPickerFor("from")}
              className="flex items-center gap-1.5 bg-background border border-border rounded-full px-3 py-1.5 hover:border-foreground/40 transition-colors flex-shrink-0"
              data-testid="button-pick-from-token">
              <TokenLogo token={fromToken} size={5} />
              <span className="text-sm font-bold text-foreground">{fromToken.symbol}</span>
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
          <div className="mt-1.5 min-h-[18px]" data-testid="text-from-usd">
            {fromUsd
              ? <p className="text-sm font-semibold text-muted-foreground">≈ {fromUsd} <span className="text-[10px] font-normal">{userCurrency}</span></p>
              : <p className="text-sm text-muted-foreground/30">≈ {userCurrency} 0.00</p>
            }
          </div>
        </div>

        {/* Direction swap button */}
        <div className="flex justify-center -my-0.5 relative z-10">
          <button onClick={swapDirection}
            className="bg-background border-2 border-border rounded-lg p-1.5 hover:border-foreground/40 transition-colors"
            data-testid="button-swap-direction">
            <ArrowDownUp className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* TO box */}
        <div className="rounded-xl border border-border bg-muted/30 p-4" data-testid="box-buy">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-muted-foreground">Buy</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className={`text-3xl font-bold ${(quoteData || pumpQuoteData) ? "text-foreground" : "text-muted-foreground/40"}`}
                data-testid="text-to-amount">
                {toAmountDisplay}
              </p>
            </div>
            <button onClick={() => setPickerFor("to")}
              className="flex items-center gap-1.5 bg-background border border-border rounded-full px-3 py-1.5 hover:border-foreground/40 transition-colors flex-shrink-0"
              data-testid="button-pick-to-token">
              <TokenLogo token={toToken} size={5} />
              <span className="text-sm font-bold text-foreground">{toToken.symbol}</span>
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
          <div className="mt-1.5 min-h-[18px]" data-testid="text-to-usd">
            {toUsd
              ? <p className="text-sm font-semibold text-muted-foreground">≈ {toUsd} <span className="text-[10px] font-normal">{userCurrency}</span></p>
              : quoteData ? null : <p className="text-sm text-muted-foreground/30">≈ {userCurrency} 0.00</p>
            }
          </div>
          {quoteData && priceImpact > 1 && (
            <p className={`text-[11px] mt-1 font-semibold ${priceImpact > 5 ? "text-red-500" : "text-amber-500"}`}>
              Price impact: {priceImpact.toFixed(2)}%
            </p>
          )}
        </div>

        {/* Limit / Stop section */}
        {mode === "limit" && (
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
            {/* Sell / Buy sub-tabs */}
            <div className="flex rounded-lg border border-border overflow-hidden" data-testid="limit-mode-tabs">
              {(["sell", "buy"] as const).map((m) => (
                <button key={m} onClick={() => { setLimitMode(m); setLimitPrice(""); setLimitPercent(""); }}
                  className={`flex-1 py-1.5 text-xs font-bold capitalize transition-colors ${limitMode === m ? (m === "sell" ? "bg-red-500/90 text-white" : "bg-emerald-500/90 text-white") : "text-muted-foreground hover:text-foreground"}`}
                  data-testid={`button-limit-mode-${m}`}>
                  {m === "sell" ? "Limit Sell" : "Limit Buy"}
                </button>
              ))}
            </div>

            {/* Trigger price */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-muted-foreground">Price target</p>
                <div className="flex rounded-md border border-border overflow-hidden text-[11px] font-bold">
                  <button onClick={() => { setLimitNoTarget(false); }}
                    className={`px-2.5 py-0.5 transition-colors ${!limitNoTarget ? "bg-foreground text-background" : "text-muted-foreground"}`}
                    data-testid="button-limit-has-target">Set price</button>
                  <button onClick={() => { setLimitNoTarget(true); setLimitPrice(""); setLimitPercent(""); }}
                    className={`px-2.5 py-0.5 transition-colors ${limitNoTarget ? "bg-foreground text-background" : "text-muted-foreground"}`}
                    data-testid="button-limit-no-target">Time only</button>
                </div>
              </div>

              {limitNoTarget ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2.5 text-center">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    No price target — will {limitMode === "sell" ? "sell" : "buy"} at <span className="font-semibold text-foreground">market price</span> when the timer expires.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] text-muted-foreground">
                      {limitMode === "sell" ? "Sell" : "Buy"} when 1{" "}
                      <span className="text-foreground font-bold">{fromToken.symbol}</span>{" "}
                      {limitMode === "sell" ? "rises to" : "drops to"}
                    </p>
                    <div className="flex rounded-md border border-border overflow-hidden text-[11px] font-bold">
                      <button onClick={() => setLimitInputType("price")}
                        className={`px-2 py-0.5 transition-colors ${limitInputType === "price" ? "bg-foreground text-background" : "text-muted-foreground"}`}
                        data-testid="button-limit-type-price">$</button>
                      <button onClick={() => setLimitInputType("percent")}
                        className={`px-2 py-0.5 transition-colors ${limitInputType === "percent" ? "bg-foreground text-background" : "text-muted-foreground"}`}
                        data-testid="button-limit-type-percent">%</button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isLimitPerc ? (
                      <>
                        <div className="flex items-center gap-1 flex-1 bg-background border border-border rounded-lg px-3 py-2">
                          <span className="text-sm font-bold text-muted-foreground">{limitMode === "sell" ? "+" : "−"}</span>
                          <input type="text" inputMode="decimal" placeholder="0"
                            value={limitPercent}
                            onChange={(e) => { const v = e.target.value; if (v === "" || /^\d*\.?\d*$/.test(v)) setLimitPercent(v); }}
                            className="flex-1 bg-transparent text-sm font-bold text-foreground outline-none"
                            data-testid="input-limit-percent" />
                          <span className="text-sm font-bold text-muted-foreground">%</span>
                        </div>
                        {limitRefPrice && limitPercent && (
                          <span className="text-[11px] text-muted-foreground flex-shrink-0">
                            ≈ ${(limitRefPrice * (1 + (limitMode === "sell" ? 1 : -1) * parseFloat(limitPercent) / 100)).toFixed(4)}
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-1 flex-1 bg-background border border-border rounded-lg px-3 py-2">
                          <span className="text-sm font-bold text-muted-foreground">$</span>
                          <input type="text" inputMode="decimal" placeholder="0.00"
                            value={limitPrice}
                            onChange={(e) => { const v = e.target.value; if (v === "" || /^\d*\.?\d*$/.test(v)) setLimitPrice(v); }}
                            className="flex-1 bg-transparent text-sm font-bold text-foreground outline-none"
                            data-testid="input-limit-price" />
                        </div>
                        <span className="text-xs font-bold text-muted-foreground flex-shrink-0">{toToken.symbol}</span>
                      </>
                    )}
                  </div>

                  {limitRefPrice && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Market price: ${limitRefPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                    </p>
                  )}

                  <div className="flex gap-1.5 mt-2 flex-wrap">
                    {limitPercSigns.map(({ label, pct }) => (
                      <button key={label} onClick={() => applyLimitPreset(pct)}
                        className="px-2.5 py-1 text-[11px] font-bold rounded-full border border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground transition-colors"
                        data-testid={`button-limit-preset-${label.replace(/[^a-z0-9]/gi, "")}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Expiry */}
            <div>
              {/* Header row: label + selected duration badge */}
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-muted-foreground">Order expiry</p>
                {expiryLabel && (
                  <span className="inline-flex items-center bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px] font-bold rounded-full px-2.5 py-0.5"
                    data-testid="text-expiry-summary">
                    {expiryLabel}
                  </span>
                )}
              </div>

              {/* Preset buttons */}
              <div className="flex gap-1.5 flex-wrap">
                {QUICK_EXPIRY.map((e) => (
                  <button key={e.value}
                    onClick={() => setLimitExpiry(e.value)}
                    className={`px-3 py-1.5 text-[11px] font-bold rounded-lg border transition-colors ${limitExpiry === e.value ? "border-emerald-500 bg-emerald-500/10 text-emerald-500" : "border-border text-muted-foreground hover:text-foreground"}`}
                    data-testid={`button-expiry-${e.value}`}>
                    {e.label}
                  </button>
                ))}
              </div>

              {/* Custom duration — simple reliable inputs */}
              {limitExpiry === "custom" && (
                <div className="mt-3 rounded-xl border border-border bg-muted/20 p-3" data-testid="custom-expiry-inputs">
                  <div className="flex items-end gap-2">
                    <div className="flex flex-col items-center gap-1 flex-1">
                      <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Days</label>
                      <input
                        type="number" min="0" max="365"
                        value={customDays}
                        onChange={(e) => setCustomDays(e.target.value)}
                        className="w-full text-center text-base font-bold bg-background border border-border rounded-lg py-2 outline-none focus:border-emerald-500 transition-colors"
                        data-testid="input-custom-days"
                      />
                    </div>
                    <div className="flex flex-col items-center gap-1 flex-1">
                      <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Hours</label>
                      <input
                        type="number" min="0" max="23"
                        value={customHours}
                        onChange={(e) => setCustomHours(e.target.value)}
                        className="w-full text-center text-base font-bold bg-background border border-border rounded-lg py-2 outline-none focus:border-emerald-500 transition-colors"
                        data-testid="input-custom-hours"
                      />
                    </div>
                    <div className="flex flex-col items-center gap-1 flex-1">
                      <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Minutes</label>
                      <input
                        type="number" min="0" max="59" step="5"
                        value={customMinutes}
                        onChange={(e) => setCustomMinutes(e.target.value)}
                        className="w-full text-center text-base font-bold bg-background border border-border rounded-lg py-2 outline-none focus:border-emerald-500 transition-colors"
                        data-testid="input-custom-minutes"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground text-center mt-2">
                    Order expires in: <span className="font-semibold text-foreground">{expiryLabel || "0m"}</span>
                  </p>
                </div>
              )}

              {/* Sell before expiry note */}
              {limitExpiry !== "none" && (
                <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 mt-2">
                  <span className="shrink-0 mt-0.5">💡</span>
                  <span>You can sell your position at any time before expiry by placing a regular swap — you're never locked in.</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Slippage */}
        <div className="px-1">
          <button onClick={() => setShowSlippage(!showSlippage)}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-toggle-slippage">
            Slippage: {slippageBps / 100}% ▾
          </button>
          {showSlippage && (
            <div className="flex gap-1.5 mt-2">
              {[50, 100, 300, 500].map((bps) => (
                <button key={bps}
                  onClick={() => { setSlippageBps(bps); setShowSlippage(false); }}
                  className={`px-3 py-1 text-[11px] font-bold rounded-md border transition-colors ${slippageBps === bps ? "border-emerald-500 bg-emerald-500/10 text-emerald-500" : "border-border text-muted-foreground"}`}
                  data-testid={`button-slippage-${bps}`}>
                  {bps / 100}%
                </button>
              ))}
            </div>
          )}
          {hasPumpToken && slippageBps < 300 && (
            <p className="text-[11px] text-amber-500 mt-1.5" data-testid="text-slippage-hint">
              Low-liquidity pump.fun token — set slippage to 3% or higher so the swap doesn't revert.
            </p>
          )}
        </div>

        {/* Quote info */}
        {quoteData && !swapSuccess && (
          <div className="rounded-lg bg-muted/40 border border-border px-3 py-2 text-[11px] text-muted-foreground space-y-0.5">
            <div className="flex justify-between">
              <span>Rate</span>
              <span className="text-foreground font-semibold">
                1 {fromToken.symbol} = {(parseInt(quoteData.outAmount) / toDecimalMult / parseFloat(fromAmount)).toLocaleString(undefined, { maximumFractionDigits: 6 })} {toToken.symbol}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Route</span>
              <span className="text-foreground font-semibold">{quoteData.routePlan?.[0]?.swapInfo?.label || "Jupiter"}</span>
            </div>
          </div>
        )}

        {/* Errors / Success */}
        {quoteError && (() => {
          const { text, link } = friendlyError(quoteError);
          return (
            <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2.5 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-destructive flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-destructive">{text}</p>
              </div>
              {link && (
                <a href={link} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-orange-500 hover:bg-orange-400 text-white text-[12px] font-bold transition-colors"
                  data-testid="link-trade-pumpfun-quote-error">
                  <ExternalLink className="w-3.5 h-3.5" />
                  Trade this token on pump.fun ↗
                </a>
              )}
            </div>
          );
        })()}
        {/* pump.fun bonding curve info badge when pump token is selected */}
        {pumpMint && !quoteError && !swapError && mode === "swap" && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-emerald-500/8 border border-emerald-500/20 px-3 py-2" data-testid="banner-pump-info">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] font-bold text-emerald-500 bg-emerald-500/15 rounded-full px-2 py-0.5 shrink-0">pump.fun</span>
              <p className="text-[11px] text-muted-foreground truncate">
                Bonding curve token — trades directly on pump.fun.
              </p>
            </div>
            <a
              href={`https://pump.fun/coin/${pumpMint}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline underline-offset-2 shrink-0 flex items-center gap-0.5"
              data-testid="link-open-pumpfun"
            >
              Open ↗
            </a>
          </div>
        )}

        {swapError && (() => {
          const { text, link } = friendlyError(swapError);
          const isSlippageErr = swapError.includes("Slippage exceeded") || swapError.includes("slippage");
          return (
            <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2.5 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-destructive flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-destructive">{text}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {isSlippageErr && slippageBps < 500 && (
                  <button
                    onClick={() => { setSlippageBps(500); setSwapError(null); setSwapErrorTxId(null); setQuoteData(null); setPumpQuoteData(null); }}
                    className="text-[11px] font-bold text-destructive border border-destructive/40 rounded-md px-2.5 py-1 hover:bg-destructive/10 transition-colors"
                    data-testid="button-retry-higher-slippage">
                    Retry with 5% slippage
                  </button>
                )}
                {swapErrorTxId && (
                  <a href={`https://solscan.io/tx/${swapErrorTxId}`} target="_blank" rel="noopener noreferrer"
                    className="text-[11px] text-destructive underline underline-offset-2">
                    View failed tx on Solscan ↗
                  </a>
                )}
                {link && (
                  <a href={link} target="_blank" rel="noopener noreferrer"
                    className="text-[11px] font-bold text-destructive underline underline-offset-2">
                    Trade on pump.fun ↗
                  </a>
                )}
              </div>
              {pumpMint && !link && (
                <a
                  href={`https://pump.fun/coin/${pumpMint}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-orange-500 hover:bg-orange-400 text-white text-[12px] font-bold transition-colors"
                  data-testid="link-fallback-pumpfun-swap-error"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Trade this token on pump.fun ↗
                </a>
              )}
            </div>
          );
        })()}
        {swapSuccess && (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/40 px-4 py-3 text-center space-y-2">
            <div className="flex items-center justify-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-bold text-sm">
              <CheckCircle2 className="w-4 h-4" />
              Swap confirmed on-chain!
            </div>
            {swapSuccessTxId && (
              <>
                <p className="text-[10px] text-muted-foreground font-mono truncate px-2">
                  {swapSuccessTxId.slice(0, 20)}…{swapSuccessTxId.slice(-12)}
                </p>
                <a
                  href={`https://solscan.io/tx/${swapSuccessTxId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 underline underline-offset-2 hover:text-emerald-500 transition-colors"
                  data-testid="link-swap-success-solscan"
                >
                  View transaction on Solscan <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </>
            )}
          </div>
        )}

        {/* Main action button */}
        {!connected ? (
          <Button className="w-full font-bold py-6 text-base" size="lg"
            onClick={() => setLoginOpen(true)}
            data-testid="button-connect-wallet">
            Connect wallet
          </Button>
        ) : mode === "limit" ? (
          <div className="space-y-2">
            <Button className={`w-full font-bold py-6 text-base ${limitBtnColor}`} size="lg"
              disabled={!fromAmount || !limitHasTarget}
              data-testid="button-place-limit-order">
              {limitBtnLabel}
            </Button>
            <p className="text-[10px] text-muted-foreground text-center">
              Limit orders via Jupiter on-chain program — launching soon
            </p>
          </div>
        ) : (!quoteData && !pumpQuoteData) ? (
          <Button className="w-full font-bold py-6 text-base" size="lg"
            onClick={handleGetQuote}
            disabled={quoteLoading || !fromAmount || parseFloat(fromAmount) <= 0}
            data-testid="button-get-quote">
            {quoteLoading
              ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Getting quote…</>
              : pumpMint
                ? <><Zap className="w-4 h-4 mr-2" />Get pump.fun Quote</>
                : <><Zap className="w-4 h-4 mr-2" />Get Quote</>}
          </Button>
        ) : (
          <div className="space-y-2">
            <Button className="w-full font-bold py-6 text-base bg-emerald-600 hover:bg-emerald-500" size="lg"
              onClick={handleSwap}
              disabled={swapLoading}
              data-testid="button-swap-now">
              {swapLoading
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Swapping…</>
                : pumpQuoteData
                  ? `${pumpAction === "buy" ? "Buy" : "Sell"} on pump.fun`
                  : "Swap Now"}
            </Button>
            <button onClick={() => { setQuoteData(null); setPumpQuoteData(null); setSwapError(null); setSwapErrorTxId(null); setSwapSuccess(false); setSwapSuccessTxId(null); }}
              className="w-full text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-cancel-quote">
              ← Change amount
            </button>
          </div>
        )}

        {/* Explorer */}
        <div className="flex justify-center pt-1">
          <a href={`https://solscan.io/token/${toToken.address}`}
            target="_blank" rel="noopener noreferrer"
            className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            data-testid="link-token-solscan">
            View {toToken.symbol} on Solscan <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      <TokenPicker
        open={pickerFor !== null}
        onClose={() => setPickerFor(null)}
        onSelect={(t) => {
          if (pickerFor === "from") setFromToken(t);
          else setToToken(t);
          setFromAmount("");
          setQuoteData(null);
        }}
        exclude={pickerFor === "from" ? toToken.address : fromToken.address}
      />
      <LoginModal open={loginOpen} onOpenChange={setLoginOpen} walletOnly />
      <MoonPayModal open={moonpayOpen} onOpenChange={setMoonpayOpen} />
    </div>
  );
}
