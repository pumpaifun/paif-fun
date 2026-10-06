import { useState, useCallback, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ArrowDownUp,
  Loader2,
  Wallet,
  AlertTriangle,
  Split,
  ChevronDown,
  ChevronUp,
  Zap,
  RefreshCw,
} from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { apiRequest } from "@/lib/queryClient";
import { useWalletBalance } from "@/hooks/use-wallet-balance";

const SOL_MINT = "So11111111111111111111111111111111111111112";

const SLIPPAGE_OPTIONS = [
  { label: "0.5%", value: 50 },
  { label: "1%", value: 100 },
  { label: "3%", value: 300 },
];

const SPLIT_OPTIONS = [2, 4, 8, 12, 24];

interface SwapPanelProps {
  tokenMint: string;
  tokenName?: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
}

export function SwapPanel({ tokenMint, tokenName, tokenSymbol, tokenDecimals = 6 }: SwapPanelProps) {
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();
  const { solBalance, tokenBalances, isLoading: balanceLoading, error: balanceError, refresh: refreshBalance } = useWalletBalance();

  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(100);
  const [customSlippage, setCustomSlippage] = useState("");
  const [showCustomSlippage, setShowCustomSlippage] = useState(false);
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitCount, setSplitCount] = useState(4);
  const [showAdvanced, setShowAdvanced] = useState(false);
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
    else if (["de", "fr", "it", "es", "pt", "nl", "fi", "el", "sk", "sl", "lv", "lt", "et", "mt"].some((c) => lang.startsWith(c)))
      currency = "EUR";
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
        const price = d?.["So11111111111111111111111111111111111111112"]?.usdPrice;
        if (typeof price === "number" && price > 0) setSolPrice(price);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!tokenMint || tokenMint === SOL_MINT) { setTokenPrice(null); return; }
    fetch(`https://lite-api.jup.ag/price/v3?ids=${tokenMint}`)
      .then((r) => r.json())
      .then((d) => {
        const price = d?.[tokenMint]?.usdPrice;
        if (typeof price === "number" && price > 0) setTokenPrice(price);
      })
      .catch(() => {});
  }, [tokenMint]);

  const tokenBalance = tokenBalances.find((t) => t.mint === tokenMint);
  const spendBalance = mode === "buy" ? (solBalance ?? 0) : (tokenBalance?.uiAmount ?? 0);
  const spendSymbol = mode === "buy" ? "SOL" : (tokenSymbol || "tokens");

  const handleMax = () => {
    if (mode === "buy") {
      const maxSol = Math.max(0, (solBalance ?? 0) - 0.005);
      setAmount(maxSol.toFixed(4));
    } else {
      setAmount((tokenBalance?.uiAmount ?? 0).toString());
    }
  };

  const localEquivalent = (() => {
    const n = parseFloat(amount);
    if (!n || isNaN(n) || n <= 0) return null;
    let usdValue: number | null = null;
    if (mode === "buy" && solPrice) usdValue = n * solPrice;
    else if (mode === "sell" && tokenPrice) usdValue = n * tokenPrice;
    else if (mode === "sell" && tokenMint === SOL_MINT && solPrice) usdValue = n * solPrice;
    if (usdValue === null) return null;
    const converted = usdValue * forexRate;
    try {
      return new Intl.NumberFormat(navigator.language || "en-US", {
        style: "currency",
        currency: userCurrency,
        maximumFractionDigits: 2,
      }).format(converted);
    } catch {
      return `$${converted.toFixed(2)}`;
    }
  })();

  const [quoteData, setQuoteData] = useState<any>(null);
  const [splitQuotes, setSplitQuotes] = useState<any[] | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [swapLoading, setSwapLoading] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [swapSuccess, setSwapSuccess] = useState(false);
  const [completedSwaps, setCompletedSwaps] = useState(0);
  const [totalSwaps, setTotalSwaps] = useState(0);

  const tokenDecimalMultiplier = Math.pow(10, tokenDecimals);

  const displaySymbol = tokenSymbol || "Token";

  const effectiveSlippage = showCustomSlippage && customSlippage
    ? Math.round(parseFloat(customSlippage) * 100)
    : slippageBps;

  const handleGetQuote = useCallback(async () => {
    if (!amount || parseFloat(amount) <= 0) return;

    setQuoteLoading(true);
    setQuoteError(null);
    setQuoteData(null);
    setSplitQuotes(null);
    setSwapSuccess(false);
    setSwapError(null);

    try {
      const inputMint = mode === "buy" ? SOL_MINT : tokenMint;
      const outputMint = mode === "buy" ? tokenMint : SOL_MINT;

      const lamports = mode === "buy"
        ? Math.floor(parseFloat(amount) * 1e9)
        : Math.floor(parseFloat(amount) * tokenDecimalMultiplier);

      if (splitEnabled) {
        const res = await apiRequest("POST", "/api/swap/split-quotes", {
          inputMint,
          outputMint,
          totalAmount: lamports,
          splitCount,
          slippageBps: effectiveSlippage,
        });
        const data = await res.json();
        setSplitQuotes(data);
      } else {
        const res = await apiRequest("POST", "/api/swap/quote", {
          inputMint,
          outputMint,
          amount: lamports,
          slippageBps: effectiveSlippage,
        });
        const data = await res.json();
        setQuoteData(data);
      }
    } catch (err: any) {
      setQuoteError(err.message || "Failed to get quote");
    } finally {
      setQuoteLoading(false);
    }
  }, [amount, mode, tokenMint, splitEnabled, splitCount, effectiveSlippage]);

  const handleSwap = useCallback(async () => {
    if (!publicKey || !signTransaction || !connected) return;

    const quotesToProcess = splitQuotes || (quoteData ? [quoteData] : []);
    if (quotesToProcess.length === 0) return;

    setSwapLoading(true);
    setSwapError(null);
    setSwapSuccess(false);
    setCompletedSwaps(0);
    setTotalSwaps(quotesToProcess.length);

    let completed = 0;
    try {
      for (const quote of quotesToProcess) {
        const txRes = await apiRequest("POST", "/api/swap/transaction", {
          quoteResponse: quote,
          userPublicKey: publicKey.toBase58(),
        });
        const { swapTransaction } = await txRes.json();

        const { VersionedTransaction } = await import("@solana/web3.js");
        const txBuf = Buffer.from(swapTransaction, "base64");
        const transaction = VersionedTransaction.deserialize(txBuf);

        const signed = await signTransaction(transaction as any);
        const txId = await connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: true,
          maxRetries: 3,
        });
        await connection.confirmTransaction(txId, "confirmed");
        completed++;
        setCompletedSwaps(completed);
      }
      setSwapSuccess(true);
      setQuoteData(null);
      setSplitQuotes(null);
    } catch (err: any) {
      if (completed > 0 && quotesToProcess.length > 1) {
        setSwapError(`${completed}/${quotesToProcess.length} orders completed. Order ${completed + 1} failed: ${err.message || "Unknown error"}. Do NOT retry — completed orders already executed.`);
      } else {
        setSwapError(err.message || "Swap failed");
      }
    } finally {
      setSwapLoading(false);
    }
  }, [publicKey, signTransaction, connected, connection, quoteData, splitQuotes]);

  const hasQuote = quoteData || (splitQuotes && splitQuotes.length > 0);

  function formatOutput(outAmount: string, isSol: boolean) {
    const val = parseInt(outAmount, 10);
    if (isSol) return (val / 1e9).toFixed(6);
    return (val / tokenDecimalMultiplier).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  return (
    <Card data-testid="card-swap-panel">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <ArrowDownUp className="w-4 h-4 text-emerald-500" />
            <h3 className="text-sm font-bold text-foreground" data-testid="text-swap-title">
              Swap
            </h3>
          </div>
          {tokenName && (
            <Badge variant="secondary" className="text-[10px]" data-testid="badge-swap-token">
              {displaySymbol}
            </Badge>
          )}
        </div>

        <div className="flex rounded-md border border-border overflow-visible mb-3">
          <button
            className={`flex-1 text-xs font-bold py-2 transition-colors ${
              mode === "buy"
                ? "bg-emerald-500 text-white"
                : "text-muted-foreground"
            }`}
            onClick={() => { setMode("buy"); setQuoteData(null); setSplitQuotes(null); }}
            data-testid="button-swap-buy"
          >
            Buy
          </button>
          <button
            className={`flex-1 text-xs font-bold py-2 transition-colors ${
              mode === "sell"
                ? "bg-red-500 text-white"
                : "text-muted-foreground"
            }`}
            onClick={() => { setMode("sell"); setQuoteData(null); setSplitQuotes(null); }}
            data-testid="button-swap-sell"
          >
            Sell
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-semibold text-muted-foreground">
                {mode === "buy" ? "Amount (SOL)" : `Amount (${displaySymbol})`}
              </label>
              {connected && (
                <span className="flex items-center gap-1">
                  {balanceLoading ? (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Loader2 className="w-2.5 h-2.5 animate-spin" /> Loading balance…
                    </span>
                  ) : balanceError ? (
                    <button
                      type="button"
                      onClick={refreshBalance}
                      className="text-[10px] text-destructive hover:text-foreground flex items-center gap-1 transition-colors"
                      data-testid="button-swap-retry-balance"
                    >
                      <RefreshCw className="w-2.5 h-2.5" /> Retry balance
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleMax}
                      className="text-[10px] font-bold text-emerald-500 hover:text-emerald-400 transition-colors"
                      data-testid="button-swap-max"
                    >
                      Balance: {spendBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })} {spendSymbol} · Max
                    </button>
                  )}
                </span>
              )}
            </div>
            <Input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => {
                const val = e.target.value;
                if (val === "" || /^\d*\.?\d*$/.test(val)) setAmount(val);
              }}
              data-testid="input-swap-amount"
            />
            {localEquivalent && (
              <p className="text-[10px] text-muted-foreground mt-0.5" data-testid="text-swap-usd-equivalent">
                ≈ {localEquivalent}
              </p>
            )}
          </div>

          <div>
            <label className="text-[11px] font-semibold text-muted-foreground mb-1.5 block">
              Slippage
            </label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {SLIPPAGE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`px-2.5 py-1 text-[11px] font-bold rounded-md border transition-colors ${
                    !showCustomSlippage && slippageBps === opt.value
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "border-border text-muted-foreground"
                  }`}
                  onClick={() => { setSlippageBps(opt.value); setShowCustomSlippage(false); }}
                  data-testid={`button-slippage-${opt.value}`}
                >
                  {opt.label}
                </button>
              ))}
              <button
                className={`px-2.5 py-1 text-[11px] font-bold rounded-md border transition-colors ${
                  showCustomSlippage
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "border-border text-muted-foreground"
                }`}
                onClick={() => setShowCustomSlippage(!showCustomSlippage)}
                data-testid="button-slippage-custom"
              >
                Custom
              </button>
            </div>
            {showCustomSlippage && (
              <div className="mt-1.5 flex items-center gap-1.5">
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 2.5"
                  value={customSlippage}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "" || /^\d*\.?\d*$/.test(val)) setCustomSlippage(val);
                  }}
                  className="max-w-[120px]"
                  data-testid="input-custom-slippage"
                />
                <span className="text-[11px] text-muted-foreground">%</span>
              </div>
            )}
          </div>

          <button
            className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground"
            onClick={() => setShowAdvanced(!showAdvanced)}
            data-testid="button-toggle-advanced"
          >
            {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Advanced
          </button>

          {showAdvanced && (
            <div className="space-y-2 pl-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Split className="w-3 h-3 text-muted-foreground" />
                  <span className="text-[11px] font-semibold text-muted-foreground">Order Splitting</span>
                </div>
                <button
                  className={`relative w-8 h-[18px] rounded-full transition-colors ${
                    splitEnabled ? "bg-emerald-500" : "bg-muted"
                  }`}
                  onClick={() => setSplitEnabled(!splitEnabled)}
                  data-testid="button-toggle-split"
                >
                  <span
                    className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform ${
                      splitEnabled ? "left-[16px]" : "left-[2px]"
                    }`}
                  />
                </button>
              </div>

              {splitEnabled && (
                <div>
                  <label className="text-[10px] text-muted-foreground mb-1 block">
                    Split into
                  </label>
                  <div className="flex items-center gap-1 flex-wrap">
                    {SPLIT_OPTIONS.map((n) => (
                      <button
                        key={n}
                        className={`px-2 py-0.5 text-[10px] font-bold rounded-md border transition-colors ${
                          splitCount === n
                            ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "border-border text-muted-foreground"
                        }`}
                        onClick={() => setSplitCount(n)}
                        data-testid={`button-split-${n}`}
                      >
                        {n}x
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {!connected ? (
            <div className="flex items-center gap-2 py-2.5 px-3 rounded-md border border-border bg-muted/30 text-xs text-muted-foreground" data-testid="text-connect-wallet-prompt">
              <Wallet className="w-3.5 h-3.5 flex-shrink-0" />
              <span>Connect your wallet to swap</span>
            </div>
          ) : (
            <Button
              className="w-full font-bold"
              disabled={!amount || parseFloat(amount) <= 0 || quoteLoading}
              onClick={handleGetQuote}
              data-testid="button-get-quote"
            >
              {quoteLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                  Getting Quote...
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5 mr-1.5" />
                  Get Quote
                </>
              )}
            </Button>
          )}

          {quoteError && (
            <div className="flex items-start gap-2 py-2 px-3 rounded-md border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20 text-xs text-red-600 dark:text-red-400" data-testid="text-quote-error">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>{quoteError}</span>
            </div>
          )}

          {quoteData && !splitQuotes && (
            <div className="space-y-2 p-3 rounded-md border border-border bg-muted/20" data-testid="div-quote-result">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">Estimated Output</span>
                <span className="font-bold text-foreground" data-testid="text-estimated-output">
                  {formatOutput(quoteData.outAmount, mode === "sell")}
                  {" "}{mode === "sell" ? "SOL" : displaySymbol}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">Price Impact</span>
                <span
                  className={`font-semibold ${
                    parseFloat(quoteData.priceImpactPct) > 5
                      ? "text-red-500"
                      : parseFloat(quoteData.priceImpactPct) > 1
                      ? "text-amber-500"
                      : "text-emerald-500"
                  }`}
                  data-testid="text-price-impact"
                >
                  {parseFloat(quoteData.priceImpactPct).toFixed(2)}%
                </span>
              </div>
              {quoteData.routePlan && quoteData.routePlan.length > 0 && (
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">Route</span>
                  <span className="text-foreground font-medium" data-testid="text-route">
                    {quoteData.routePlan.map((r: any) => r.swapInfo.label).join(" → ")}
                  </span>
                </div>
              )}

              <Button
                className="w-full font-bold mt-1"
                disabled={swapLoading}
                onClick={handleSwap}
                data-testid="button-swap-execute"
              >
                {swapLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    Swapping...
                  </>
                ) : (
                  <>
                    <ArrowDownUp className="w-3.5 h-3.5 mr-1.5" />
                    Swap
                  </>
                )}
              </Button>
            </div>
          )}

          {splitQuotes && splitQuotes.length > 0 && (
            <div className="space-y-2 p-3 rounded-md border border-border bg-muted/20" data-testid="div-split-quote-result">
              <div className="text-xs font-bold text-foreground mb-1">
                Split into {splitQuotes.length} orders
              </div>
              {splitQuotes.map((q: any, i: number) => (
                <div key={i} className="flex items-center justify-between gap-2 text-[11px] py-1 border-b border-border/50 last:border-0">
                  <span className="text-muted-foreground">Order {i + 1}</span>
                  <span className="font-semibold text-foreground" data-testid={`text-split-output-${i}`}>
                    {formatOutput(q.outAmount, mode === "sell")}
                    {" "}{mode === "sell" ? "SOL" : displaySymbol}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between gap-2 text-xs pt-1">
                <span className="text-muted-foreground">Total Est. Output</span>
                <span className="font-bold text-foreground" data-testid="text-split-total-output">
                  {formatOutput(
                    splitQuotes.reduce((sum: number, q: any) => sum + parseInt(q.outAmount, 10), 0).toString(),
                    mode === "sell"
                  )}
                  {" "}{mode === "sell" ? "SOL" : displaySymbol}
                </span>
              </div>

              <Button
                className="w-full font-bold mt-1"
                disabled={swapLoading}
                onClick={handleSwap}
                data-testid="button-swap-execute-split"
              >
                {swapLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    {completedSwaps > 0 ? `Swap ${completedSwaps + 1}/${totalSwaps}...` : `Executing ${splitQuotes.length} Swaps...`}
                  </>
                ) : (
                  <>
                    <ArrowDownUp className="w-3.5 h-3.5 mr-1.5" />
                    Execute {splitQuotes.length} Swaps
                  </>
                )}
              </Button>
            </div>
          )}

          {swapError && (
            <div className="flex items-start gap-2 py-2 px-3 rounded-md border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20 text-xs text-red-600 dark:text-red-400" data-testid="text-swap-error">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>{swapError}</span>
            </div>
          )}

          {swapSuccess && (
            <div className="py-2 px-3 rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 text-xs text-emerald-600 dark:text-emerald-400 font-semibold" data-testid="text-swap-success">
              Swap completed successfully!
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
