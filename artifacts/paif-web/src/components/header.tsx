import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, Sun, Moon, ArrowLeft, Gamepad2, LogOut, Wallet, User, Settings, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";
import { LoginModal } from "@/components/login-modal";
import { ProfileSetupModal } from "@/components/profile-setup-modal";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAuth } from "@/hooks/use-auth";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { useActiveChain } from "@/lib/active-chain";
import { isEvmChain } from "@/lib/chains";
import { NetworkSwitcher } from "@/components/network-switcher";
import { EvmWalletButton } from "@/components/evm-wallet-button";

// Routes where the user must connect a real wallet (on-chain signing required).
// On these pages the Sign In button skips the email/Google chooser and opens
// the wallet picker directly — email accounts can't sign on-chain transactions
// so offering email here is misleading.
const WALLET_REQUIRED_ROUTES = [
  "/bump-bot",
  "/swap",
  "/sniper-bot",
  "/upgrade",
  "/wallets",
  "/vaults",
];

// "Home" stays first; everything else is alphabetical.
export const navItems = [
  { label: "Home", href: "/", description: "Your starting point for the PAIF toolkit." },
  { label: "About", href: "/about", description: "Why PAIF exists and what it is building." },
  { label: "Access Passes", href: "/upgrade", description: "Compare pass durations and start the paper-tools trial." },
  { label: "Autonomous DCA Bot", href: "/vaults", description: "Schedule disciplined, wallet-isolated accumulation." },
  { label: "Buy PAIF", href: "/buy-paif", description: "Find PAIF markets and purchase routes." },
  { label: "Compare", href: "/compare", description: "Compare PAIF tools before choosing a workflow." },
  { label: "Token Creators Activity", href: "/creators", description: "Review creator histories, activity, and favorites." },
  { label: "DAO", href: "/dao", description: "See the community treasury and governance direction." },
  { label: "Forum", href: "/forum", description: "Discuss launches, research, and trading lessons." },
  { label: "Learn Crypto", href: "/learn", description: "Build practical crypto knowledge without the jargon." },
  { label: "Crypto Leaderboard", href: "/crypto-leaderboard?view=trending", description: "See trending Solana tokens and newly discovered launches." },
  { label: "PAIF Buyback", href: "/buyback", description: "Follow the buyback treasury and verified activity." },
  { label: "Alpha PAIF", href: "/paif-alpha", description: "See PAIF's connected supervisory intelligence and safety boundaries." },
  { label: "Arcade PAIF", href: "/paif-invaders", description: "Ring positive market lanes in a simple paper-only arcade." },
  { label: "Sniper Bot", href: "/sniper-bot", description: "Filter new launches before deciding whether to act." },
  { label: "Swap", href: "/swap", description: "Execute supported token swaps from your wallet." },
  { label: "Swing Bot", href: "/swing-bot", description: "Run paper or live strategies, or watch a token with explicit guardrails." },
  { label: "xStocks Leaderboard", href: "/tokenized-stocks", description: "Compare verified xStocks instruments on Solana." },
  { label: "Wallet Search", href: "/wallets", description: "Search a Solana wallet and inspect its holdings." },
  { label: "Watchlist", href: "/watchlist", description: "Keep Solana tokens you want to revisit." },
  { label: "Whitepaper", href: "/whitepaper", description: "Read the product thesis, model, and roadmap." },
];

function truncateAddress(address: string) {
  return address.slice(0, 4) + "..." + address.slice(-4);
}

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [location] = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { publicKey, connected, disconnect } = useWallet();
  const { user: authUser, isAuthenticated: isEmailAuth, logout: emailLogout } = useAuth();
  const { solBalance, isLoading: balanceLoading, error: balanceError, refresh: refreshBalance } = useWalletBalance();
  const { chainId } = useActiveChain();
  const isEvm = isEvmChain(chainId);

  const isSignedIn = (connected && publicKey) || isEmailAuth;
  const requiresWallet = WALLET_REQUIRED_ROUTES.includes(location);

  // Auto-open profile setup for new email users who don't have a username yet
  useEffect(() => {
    if (isEmailAuth && authUser && !authUser.username && !authUser.firstName) {
      const timer = setTimeout(() => setProfileOpen(true), 1500);
      return () => clearTimeout(timer);
    }
  }, [isEmailAuth, authUser]);

  const displayName = authUser?.username
    ? "@" + authUser.username
    : authUser?.firstName || authUser?.email?.split("@")[0] || "Account";

  return (
    <>
      <header className="sticky top-0 z-[9999] bg-background/90 backdrop-blur-lg border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-x-2 sm:gap-x-4 min-h-14">
            <div className="hidden md:flex items-center gap-2 flex-shrink-0">
              <Button
                variant="default"
                size="icon"
                className="h-9 w-9 rounded-md"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                data-testid="button-desktop-menu"
                aria-label="Toggle navigation menu"
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </Button>
              <Link href="/">
                <span
                  className="text-xl font-extrabold tracking-tight text-foreground cursor-pointer"
                  data-testid="link-logo-desktop"
                >
                  PAIF<span className="text-emerald-500">.fun</span>
                </span>
              </Link>
            </div>

            <div className="md:hidden flex items-center gap-1.5 flex-shrink-0">
              <Button
                size="icon"
                variant="default"
                className="h-9 w-9"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                data-testid="button-mobile-menu"
                aria-label="Toggle navigation menu"
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </Button>
              <Link href="/">
                <span
                  className="text-lg sm:text-xl font-extrabold tracking-tight text-foreground cursor-pointer"
                  data-testid="link-logo"
                >
                  PAIF<span className="text-emerald-500">.fun</span>
                </span>
              </Link>
            </div>

            <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
              {location !== "/paif-alpha" && (
                <Link
                  href="/paif-invaders"
                  className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-2.5 text-xs font-bold transition-colors ${
                    location === "/paif-invaders"
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-emerald-500/35 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400"
                  }`}
                  aria-label="Open Arcade PAIF"
                  title="Open Arcade PAIF"
                  data-testid="link-header-arcade"
                >
                  <Gamepad2 className="h-4 w-4" />
                  <span className="hidden sm:inline">Arcade</span>
                </Link>
              )}
              {location !== "/" && (
                <Link
                  href="/"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted/60 text-foreground transition-colors hover:bg-muted"
                  aria-label="Go to home"
                  title="Go to home"
                  data-testid="link-header-home"
                >
                  <ArrowLeft className="w-4 h-4" />
                </Link>
              )}
              <Button
                variant="default"
                size="icon"
                className="h-8 w-8 rounded-md"
                onClick={toggleTheme}
                data-testid="button-theme-toggle"
              >
                {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
              </Button>
              <NetworkSwitcher className="hidden md:inline-flex" />
              <div className="hidden md:flex items-center gap-2">
                {isEvm ? (
                  <EvmWalletButton />
                ) : connected && publicKey ? (
                  <>
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-muted border border-border" data-testid="text-wallet-address">
                      <Wallet className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                      <span className="text-xs font-semibold text-foreground">{truncateAddress(publicKey.toBase58())}</span>
                      {balanceLoading ? (
                        <Loader2 className="w-3 h-3 animate-spin text-muted-foreground ml-1" data-testid="icon-balance-loading" />
                      ) : balanceError ? (
                        <button onClick={refreshBalance} title="Retry balance" className="ml-1 text-muted-foreground hover:text-foreground transition-colors" data-testid="button-refresh-balance">
                          <RefreshCw className="w-3 h-3" />
                        </button>
                      ) : solBalance !== null ? (
                        <span className="text-xs font-bold text-emerald-500 ml-1" data-testid="text-sol-balance">
                          {solBalance.toFixed(4)} SOL
                        </span>
                      ) : null}
                    </div>
                    <Button
                      variant="default"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => disconnect()}
                      data-testid="button-disconnect-wallet"
                    >
                      <LogOut className="w-4 h-4" />
                    </Button>
                  </>
                ) : isEmailAuth && authUser ? (
                  <>
                    <button
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-muted border border-border hover:bg-muted/80 transition-colors"
                      onClick={() => setProfileOpen(true)}
                      data-testid="text-user-email"
                    >
                      <User className="w-3.5 h-3.5 text-emerald-500" />
                      <span className="text-xs font-semibold text-foreground">{displayName}</span>
                      <Settings className="w-3 h-3 text-muted-foreground" />
                    </button>
                    <Button
                      variant="default"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => emailLogout()}
                      data-testid="button-email-logout"
                    >
                      <LogOut className="w-4 h-4" />
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="default"
                    size="sm"
                    className="font-bold text-xs rounded-md"
                    onClick={() => setLoginOpen(true)}
                    data-testid="button-login"
                  >
                    Sign In
                  </Button>
                )}
              </div>

              <NetworkSwitcher className="md:hidden" />

              {!isEvm && connected && publicKey && (
                <div className="md:hidden flex items-center gap-1 px-1.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30" data-testid="text-mobile-wallet-indicator">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                  {solBalance !== null ? (
                    <span className="text-[10px] font-bold text-emerald-500 whitespace-nowrap">{solBalance.toFixed(2)} SOL</span>
                  ) : balanceLoading ? (
                    <Loader2 className="w-3 h-3 animate-spin text-emerald-500" data-testid="icon-mobile-balance-loading" />
                  ) : (
                    <button onClick={refreshBalance} title="Retry balance" className="text-emerald-500" data-testid="button-mobile-indicator-refresh">
                      <RefreshCw className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}

            </div>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="hidden md:block border-t border-border bg-background" data-testid="nav-desktop-menu">
            <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 grid grid-cols-4 lg:grid-cols-6 gap-1.5">
              {navItems.map((item) => {
                const isActive = item.href.includes("?")
                  ? location === item.href.split("?")[0] && window.location.search === "?" + item.href.split("?")[1]
                  : location === item.href;

                return (
                  <Link key={item.href} href={item.href}>
                    <Button
                      variant={isActive ? "default" : "ghost"}
                      size="sm"
                      className="w-full justify-start font-semibold text-xs"
                      onClick={() => setMobileMenuOpen(false)}
                      data-testid={`link-desktop-nav-${item.label.toLowerCase().replace(/\s/g, "-")}`}
                    >
                      {item.label}
                    </Button>
                  </Link>
                );
              })}
            </nav>
          </div>
        )}

        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border bg-background max-h-[calc(100dvh-3.5rem)] overflow-y-auto overscroll-contain">
            <nav className="px-4 py-3 space-y-1" data-testid="nav-mobile">
              {navItems.map((item) => {
                const isActive = location === item.href;

                return (
                  <Link key={item.href} href={item.href}>
                    <Button
                      variant={isActive ? "default" : "ghost"}
                      className="w-full justify-start font-semibold text-sm"
                      onClick={() => setMobileMenuOpen(false)}
                      data-testid={`link-mobile-nav-${item.label.toLowerCase().replace(/\s/g, "-")}`}
                    >
                      {item.label}
                    </Button>
                  </Link>
                );
              })}
              <div className="pt-2 pb-1">
                {isEvm ? (
                  <EvmWalletButton />
                ) : connected && publicKey ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-muted border border-border" data-testid="text-mobile-wallet-address">
                      <Wallet className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                      <span className="text-xs font-semibold text-foreground">{truncateAddress(publicKey.toBase58())}</span>
                      {balanceLoading ? (
                        <Loader2 className="w-3 h-3 animate-spin text-muted-foreground ml-1" />
                      ) : balanceError ? (
                        <button onClick={refreshBalance} className="ml-1 text-muted-foreground" data-testid="button-mobile-refresh-balance">
                          <RefreshCw className="w-3 h-3" />
                        </button>
                      ) : solBalance !== null ? (
                        <span className="text-xs font-bold text-emerald-500 ml-1" data-testid="text-mobile-sol-balance">
                          {solBalance.toFixed(4)} SOL
                        </span>
                      ) : null}
                    </div>
                    <Button
                      variant="default"
                      size="icon"
                      onClick={() => { disconnect(); setMobileMenuOpen(false); }}
                      data-testid="button-mobile-disconnect-wallet"
                    >
                      <LogOut className="w-4 h-4" />
                    </Button>
                  </div>
                ) : isEmailAuth && authUser ? (
                  <div className="flex items-center gap-2">
                    <button
                      className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-muted border border-border"
                      onClick={() => { setMobileMenuOpen(false); setProfileOpen(true); }}
                      data-testid="text-mobile-user-email"
                    >
                      <User className="w-3.5 h-3.5 text-emerald-500" />
                      <span className="text-xs font-semibold text-foreground">{displayName}</span>
                    </button>
                    <Button
                      variant="default"
                      size="icon"
                      onClick={() => { emailLogout(); setMobileMenuOpen(false); }}
                      data-testid="button-mobile-email-logout"
                    >
                      <LogOut className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="default"
                    className="w-full font-bold"
                    onClick={() => { setMobileMenuOpen(false); setLoginOpen(true); }}
                    data-testid="button-mobile-login"
                  >
                    Sign In
                  </Button>
                )}
              </div>
            </nav>
          </div>
        )}
      </header>

      <LoginModal open={loginOpen} onOpenChange={setLoginOpen} walletOnly={requiresWallet} />
      <ProfileSetupModal open={profileOpen} onOpenChange={setProfileOpen} />
    </>
  );
}
