import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Wallet, Copy, Check, ExternalLink, Coins, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { useLocation } from "wouter";

interface TokenHolding {
  mintAddress: string;
  name: string;
  symbol: string;
  image: string;
  balance: number;
  decimals: number;
}

interface WalletData {
  walletAddress: string;
  solBalance: number;
  solPriceUsd: number | null;
  tokenHoldings: TokenHolding[];
}

function shortenAddress(addr: string) {
  if (!addr || addr.length < 12) return addr;
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(2) + "K";
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.0001) return n.toFixed(4);
  return n.toFixed(6);
}

export default function WalletsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeWallet, setActiveWallet] = useState<string | null>(null);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [, setLocation] = useLocation();

  const { data, isLoading, error } = useQuery<WalletData, Error>({
    queryKey: [`/api/wallet/${activeWallet}`],
    enabled: !!activeWallet,
    retry: 1,
  });

  const handleSearch = () => {
    const q = searchQuery.trim();
    if (q) setActiveWallet(q);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  const copyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr);
    setCopiedAddress(addr);
    setTimeout(() => setCopiedAddress(null), 2000);
  };

  const formatUsd = (sol: number, price: number | null) => {
    if (!price) return null;
    const usd = sol * price;
    if (usd >= 1000) return "$" + usd.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (usd >= 1) return "$" + usd.toFixed(2);
    return "$" + usd.toFixed(4);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Wallet className="w-5 h-5 text-emerald-500" />
            <h1 className="text-xl font-bold text-foreground" data-testid="text-wallets-title">Wallet Search</h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Enter any Solana wallet address to see its SOL balance and token holdings
          </p>
        </div>

        <div className="flex gap-2 mb-6">
          <Input
            placeholder="Paste a Solana wallet address..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 text-sm"
            data-testid="input-wallet-search"
          />
          <Button onClick={handleSearch} disabled={!searchQuery.trim() || isLoading} data-testid="button-wallet-search">
            <Search className="w-4 h-4 mr-1.5" />
            Search
          </Button>
        </div>

        {isLoading && (
          <Card className="p-8 text-center" data-testid="wallet-loading">
            <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Looking up wallet...</p>
          </Card>
        )}

        {error && !isLoading && (
          <Card className="p-6 text-center border-red-200" data-testid="wallet-error">
            <p className="text-sm text-red-600 font-medium">{(error as any)?.message || "Failed to look up wallet"}</p>
          </Card>
        )}

        {data && !isLoading && (
          <div className="space-y-4" data-testid="wallet-results">
            <Card className="p-4 sm:p-5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Wallet Address</p>
                  <button
                    onClick={() => copyAddress(data.walletAddress)}
                    className="flex items-center gap-1.5 text-sm font-mono font-semibold hover:text-emerald-500 transition-colors"
                    data-testid="button-copy-wallet"
                  >
                    {shortenAddress(data.walletAddress)}
                    {copiedAddress === data.walletAddress ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground mb-0.5">SOL Balance</p>
                  <p className="text-lg font-bold text-foreground" data-testid="text-sol-balance">{data.solBalance.toFixed(4)} SOL</p>
                  {data.solPriceUsd && (
                    <p className="text-xs text-muted-foreground font-semibold" data-testid="text-sol-usd">
                      {formatUsd(data.solBalance, data.solPriceUsd)}
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-border">
                <a
                  href={`https://solscan.io/account/${data.walletAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline"
                  data-testid="link-solscan-wallet"
                >
                  View on Solscan <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </Card>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <Coins className="w-4 h-4 text-emerald-500" />
                <h2 className="text-sm font-bold text-foreground" data-testid="text-holdings-title">
                  Token Holdings ({data.tokenHoldings.length})
                </h2>
              </div>

              {data.tokenHoldings.length === 0 ? (
                <Card className="p-6 text-center" data-testid="text-no-holdings">
                  <p className="text-sm text-muted-foreground">No token holdings found for this wallet</p>
                </Card>
              ) : (
                <div className="space-y-2">
                  {data.tokenHoldings.map((token, i) => (
                    <Card key={token.mintAddress} className="p-3 sm:p-4 hover:border-emerald-200 transition-colors" data-testid={`card-token-${i}`}>
                      <div className="flex items-center gap-3">
                        {token.image ? (
                          <img
                            src={token.image}
                            alt={token.name}
                            className="w-8 h-8 rounded-full bg-muted object-cover flex-shrink-0"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                            <Coins className="w-4 h-4 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-semibold text-foreground truncate">{token.name}</span>
                            {token.symbol && (
                              <span className="text-xs text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0">
                                ${token.symbol}
                              </span>
                            )}
                          </div>
                          <button
                            onClick={() => copyAddress(token.mintAddress)}
                            className="flex items-center gap-1 text-[11px] text-muted-foreground font-mono hover:text-emerald-500 transition-colors mt-0.5"
                            data-testid={`button-copy-mint-${i}`}
                          >
                            {shortenAddress(token.mintAddress)}
                            {copiedAddress === token.mintAddress ? <Check className="w-2.5 h-2.5 text-emerald-500" /> : <Copy className="w-2.5 h-2.5" />}
                          </button>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-bold text-foreground">{formatNumber(token.balance)}</p>
                          <button
                            onClick={() => setLocation(`/scan?q=${token.mintAddress}`)}
                            className="flex items-center gap-0.5 text-[11px] text-emerald-600 hover:underline mt-0.5"
                            data-testid={`button-scan-token-${i}`}
                          >
                            Scan <ArrowRight className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <Footer />
      </main>
    </div>
  );
}
