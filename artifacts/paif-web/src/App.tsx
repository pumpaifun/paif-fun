import { useEffect } from "react";
import { Switch, Route, useLocation, Router as WouterRouter } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import { SolanaWalletProvider } from "@/lib/wallet-provider";
import { ChainProvider } from "@/lib/active-chain";
import { EvmWalletProvider } from "@/lib/evm-provider";
import Home from "@/pages/home";
import ScanPage from "@/pages/scan";
import ArbitragePage from "@/pages/arbitrage";
import SwapPage from "@/pages/swap";
import DaoPage from "@/pages/dao";
import WalletsPage from "@/pages/wallets";
import ForumPage from "@/pages/forum";
import LearnPage from "@/pages/learn";
import ComparePage from "@/pages/compare";
import WatchlistPage from "@/pages/watchlist";
import BuyPaifPage from "@/pages/buy-paif";
import SniperBotPage from "@/pages/sniper-bot";
import NewLaunchesPage from "@/pages/new-launches";
import BumpBotPage from "@/pages/bump-bot";
import UpgradePage from "@/pages/upgrade";
import BuybackPage from "@/pages/buyback";
import AdminBuybackPage from "@/pages/admin-buyback";
import TelegramBotPage from "@/pages/telegram-bot";
import StrategyVaultsPage from "@/pages/strategy-vaults";
import SwingBotPage from "@/pages/swing-bot";
import PrivacyPage from "@/pages/privacy";
import WhitepaperPage from "@/pages/whitepaper";
import AboutPage from "@/pages/about";
import CreatorsPage from "@/pages/creators";
import TokenizedStocksPage from "@/pages/tokenized-stocks";
import PaifInvadersPage from "@/pages/paif-invaders";
import PaifAlphaPage from "@/pages/paif-alpha";
import NotFound from "@/pages/not-found";

function TokenReportRedirect() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate("/scan");
  }, [navigate]);
  return null;
}

function ArbBotRedirect() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate("/arbitrage?mode=bot");
  }, [navigate]);
  return null;
}

function ScrollToTop() {
  const [location] = useLocation();
  const navigationKey = `${location}${window.location.search}`;

  useEffect(() => {
    if (window.location.hash) return;
    window.scrollTo(0, 0);
  }, [navigationKey]);

  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/scan" component={ScanPage} />
      <Route path="/arbitrage" component={ArbitragePage} />
      <Route path="/arb-bot" component={ArbBotRedirect} />
      <Route path="/swing-bot" component={SwingBotPage} />
      <Route path="/paif-invaders" component={PaifInvadersPage} />
      <Route path="/paif-alpha" component={PaifAlphaPage} />
      <Route path="/swap" component={SwapPage} />
      <Route path="/dao" component={DaoPage} />
      <Route path="/wallets" component={WalletsPage} />
      <Route path="/forum" component={ForumPage} />
      <Route path="/crypto-bingo" component={() => <LearnPage />} />
      <Route path="/rug-bingo" component={() => <LearnPage initialBingoDeck="rug" />} />
      <Route path="/loan-bingo" component={() => <LearnPage initialBingoDeck="loan" />} />
      <Route path="/invest-bingo" component={() => <LearnPage initialBingoDeck="invest" />} />
      <Route path="/learn" component={() => <LearnPage />} />
      <Route path="/compare" component={ComparePage} />
      <Route path="/creators" component={CreatorsPage} />
      <Route path="/tokenized-stocks" component={TokenizedStocksPage} />
      <Route path="/roadmap" component={TokenReportRedirect} />
      <Route path="/watchlist" component={WatchlistPage} />
      <Route path="/buy-paif" component={BuyPaifPage} />
      <Route path="/premium-signals" component={UpgradePage} />
      <Route path="/sniper-bot" component={SniperBotPage} />
      <Route path="/new-launches" component={NewLaunchesPage} />
      <Route path="/crypto-leaderboard" component={NewLaunchesPage} />
      <Route path="/bump-bot" component={BumpBotPage} />
      <Route path="/upgrade" component={UpgradePage} />
      <Route path="/buyback" component={BuybackPage} />
      <Route path="/admin/buyback" component={AdminBuybackPage} />
      <Route path="/admin/telegram" component={TelegramBotPage} />
      <Route path="/vaults" component={StrategyVaultsPage} />
      <Route path="/privacy" component={PrivacyPage} />
      <Route path="/whitepaper" component={WhitepaperPage} />
      <Route path="/about" component={AboutPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ChainProvider>
      <ThemeProvider>
        <SolanaWalletProvider>
          <QueryClientProvider client={queryClient}>
            <EvmWalletProvider>
              <TooltipProvider>
                <Toaster />
                <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                  <ScrollToTop />
                  <Router />
                </WouterRouter>
              </TooltipProvider>
            </EvmWalletProvider>
          </QueryClientProvider>
        </SolanaWalletProvider>
      </ThemeProvider>
    </ChainProvider>
  );
}

export default App;
