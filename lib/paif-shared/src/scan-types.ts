export type RiskBand = "low" | "medium" | "high";
export type RiskConfidence = "high" | "medium" | "low";
export type RiskSeverity = "info" | "warning" | "critical";

export interface RiskCategory {
  key: string;
  label: string;
  score: number;
  weight: number;
  detail: string;
}

export interface RiskFlag {
  severity: RiskSeverity;
  label: string;
  detail: string;
}

// Live market sentiment — FACTS ONLY, never advice. Everything here is a plain
// readout of what the tape is doing right now (buy vs sell pressure, recent
// price moves, and a conservative chart-pattern read). Missing data is stated
// as unknown, never as a signal. Additive to the scan; if it fails to load the
// scan still returns everything else.
export interface ScanSentiment {
  available: boolean;
  buysH1: number;
  sellsH1: number;
  buysM5: number;
  sellsM5: number;
  chgM5: number;
  chgH1: number;
  chgH6: number;
  chgH24: number;
  volH1Usd: number;
  volH1Known: boolean;
  // Conservative chart read (only set when there's enough candle data):
  //   healthy = higher lows, trend intact · blowoff = ran hot, reversal shape
  //   accumulation = tight base on cooled volume · mixed = no clear pattern
  chart: "healthy" | "blowoff" | "accumulation" | "mixed" | null;
  chartDetail: string | null;
  // One-line plain-language factual summary (e.g. "Buyers ahead of sellers in
  // the last hour; price up 4% in 5 minutes"). Never a buy/sell recommendation.
  summary: string;
}

export interface RiskAssessment {
  score: number;
  band: RiskBand;
  grade: string;
  confidence: RiskConfidence;
  categories: RiskCategory[];
  flags: RiskFlag[];
  sanctioned: boolean;
  sanctionDetail: string | null;
  sanctionsCoverage: string;
  generatedAt: string;
  chain: string;
}

export type ScanHolderCategory =
  | "person"
  | "liquidity"
  | "locker"
  | "burn"
  | "cex"
  | "dex";

export interface CreatorFeeInfo {
  totalSolReceived: number;
  totalSolSent: number;
  totalTokensSold: number;
  tokenSellTransactions: {
    signature: string;
    solAmount: number;
    timestamp: number;
    description: string;
  }[];
  // Airdrop / distribution heuristic: token-out transfers where no meaningful
  // native coin came back are distributions, not sells.
  totalTokensDistributed: number;
  distributionRecipientCount: number;
  distributionTransactions: {
    signature: string;
    recipientCount: number;
    timestamp: number;
    description: string;
  }[];
  distributionDestinations: {
    address: string;
    amount: number;
    category: "wallet" | "burn" | "token_contract" | "liquidity" | "locker" | "program";
    label: string | null;
  }[];
  distributionClassificationDegraded: boolean;
  solDestinations: {
    address: string;
    amount: number;
    label: string | null;
    walletType: string | null;
  }[];
  creatorCurrentSolBalance: number | null;
  feeWallets: {
    address: string;
    totalReceived: number;
    label: string | null;
    walletType: string | null;
  }[];
  tradingFeesTotal: number;
  creatorActivity: {
    signature: string;
    type: string;
    description: string;
    solAmount: number;
    timestamp: number;
  }[];
}

export interface ClawPumpCreatorRewards {
  agentId: string;
  agentName: string;
  agentWallet: string | null;
  profileUrl: string;
  tokenUrl: string;
  agentSharePercent: number;
  totalEarnedSol: number;
  totalSentSol: number;
  totalPendingSol: number;
  recentDistributionCount: number;
  rewardDestinationWallet: string | null;
  rewardDestinationMatchesAgentWallet: boolean | null;
  latestDistributionTxHash: string | null;
  checkedAt: string;
}

export interface ClawPumpMigratedCreatorRewards {
  tokenUrl: string;
  totalCreatorFeesSol: number;
  totalEarnedSol: number;
  totalSentSol: number;
  payoutCount: number;
  feeRoutingWallet: string | null;
  rewardDestinationWallet: string | null;
  otherSplitRecipientWallet: string | null;
  creatorSharePercent: number | null;
  otherSharePercent: number | null;
  rewardDestinationMatchesCreatorWallet: boolean | null;
  latestDistributionTxHash: string | null;
  checkedAt: string;
}

export interface ClawPumpCrossReference {
  status: "linked" | "not_linked" | "unavailable";
  checkedAt: string;
}

export interface ScanResult {
  tokenAddress: string;
  tokenName: string;
  tokenSymbol: string;
  creatorAddress: string;
  tokenImage: string;
  topHolderAddress: string;
  totalSupply: number;
  topHolderPercent: number;
  reinvestedPercent: number;
  movedElsewherePercent: number;
  rating: "green" | "yellow" | "red" | null;
  ratingExplanation: string;
  dataIncomplete: boolean;
  topHolders: {
    address: string;
    percent: number;
    label?: string | null;
    category?: ScanHolderCategory;
  }[];
  // Solana can classify supply held by pools, lockers, and burn addresses.
  // EVM scanners do not currently provide an equivalent breakdown.
  holderBreakdown?: {
    liquidityPercent: number;
    lockedPercent: number;
    burnedPercent: number;
    realTopHolderPercent: number;
  };
  recentTransactions: {
    signature: string;
    type: string;
    amount: number;
    timestamp: number;
  }[];
  creatorFees: CreatorFeeInfo | null;
  clawPumpCreatorRewards?: ClawPumpCreatorRewards | null;
  clawPumpMigratedCreatorRewards?: ClawPumpMigratedCreatorRewards | null;
  clawPumpCrossReference?: ClawPumpCrossReference;
  solPriceUsd: number | null;
  launchDate: string | null;
  launchTimestamp: number | null;
  risk: RiskAssessment | null;
  sentiment: ScanSentiment | null;
}
