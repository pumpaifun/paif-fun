import type {
  RiskAssessment,
  RiskCategory,
  RiskFlag,
  RiskBand,
  RiskConfidence,
} from "@shared/scan-types";
import { screenSanctions, sanctionsCoverage } from "./ofac-sanctions";

export interface RiskInput {
  topHolderPercent: number;
  reinvestedPercent: number;
  movedElsewherePercent: number;
  dataIncomplete: boolean;
  topHolders: { address: string; percent: number }[];
  creatorAddress: string;
  topHolderAddress: string;
  creatorFees: {
    totalSolReceived: number;
    totalSolSent: number;
    solDestinations: { address: string; amount?: number }[];
    feeWallets: { address: string }[];
    distributionRecipientCount?: number;
    tokenSellTransactions?: { solAmount: number }[];
  } | null;
  // Supply held by non-person accounts — excluded from concentration so liquidity
  // pools / lockers / burns don't read as one wallet hoarding the supply.
  lockedPercent?: number;
  liquidityPoolPercent?: number;
  burnedPercent?: number;
  // Real pool depth in USD (DexScreener). For graduated tokens the supply-in-pool
  // % is naturally tiny, so this is the honest liquidity signal when available.
  liquidityUsd?: number | null;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

function gradeFromScore(score: number): string {
  if (score <= 20) return "A";
  if (score <= 40) return "B";
  if (score <= 60) return "C";
  if (score <= 80) return "D";
  return "F";
}

function bandFromScore(score: number): RiskBand {
  if (score < 34) return "low";
  if (score < 67) return "medium";
  return "high";
}

export function computeRiskAssessment(input: RiskInput, chain: string): RiskAssessment {
  const top5 = input.topHolders
    .slice(0, 5)
    .reduce((s, h) => s + (h.percent || 0), 0);

  const concentrationScore = clamp(Math.max(input.topHolderPercent * 1.4, top5));
  // Liquidity health: for graduated tokens the % of supply sitting in the pool is
  // naturally tiny, so real USD pool depth (when known) is the honest signal. Fall
  // back to supply-% only when USD liquidity is unavailable.
  const liqUsd = input.liquidityUsd;
  const liquidityScore =
    liqUsd != null
      ? liqUsd >= 100_000
        ? 5
        : liqUsd >= 25_000
          ? 25
          : liqUsd >= 5_000
            ? 55
            : 90
      : clamp(100 - input.reinvestedPercent);

  const locked = Math.round(input.lockedPercent || 0);
  const pool = Math.round(input.liquidityPoolPercent || 0);
  const burned = Math.round(input.burnedPercent || 0);
  const excludedParts: string[] = [];
  if (pool > 0) excludedParts.push(`${pool}% liquidity`);
  if (locked > 0) excludedParts.push(`${locked}% locked`);
  if (burned > 0) excludedParts.push(`${burned}% burned`);
  const exclusionNote = excludedParts.length
    ? ` Excludes ${excludedParts.join(", ")} (not counted as a person's holdings).`
    : "";

  let creatorScore = 0;
  let creatorDetail = "No notable creator fee extraction detected.";
  let creatorIsExtracting = false;
  let soldSol = 0;
  if (input.creatorFees) {
    const cf = input.creatorFees;
    // Only SOL destinations carrying real value count as extraction. Airdrops
    // create many dust/ATA-rent transfers to fresh wallets — those are NOT the
    // creator cashing out, so they must not inflate the extraction score.
    const AIRDROP_DUST_SOL = 0.01;
    const meaningfulDests = (cf.solDestinations || []).filter((d) => (d.amount || 0) > AIRDROP_DUST_SOL);
    const hops = meaningfulDests.length + (cf.feeWallets?.length || 0);
    const sent = cf.totalSolSent || 0;
    const distributed = cf.distributionRecipientCount || 0;
    soldSol = (cf.tokenSellTransactions || []).reduce((s, t) => s + (t.solAmount || 0), 0);

    creatorScore = clamp(Math.min(hops * 12, 60) + Math.min(sent * 2, 40));
    creatorIsExtracting = creatorScore >= 50 || soldSol > 0.05;

    // Note airdrops separately so they never read as the extraction driver.
    const airdropNote = distributed > 0
      ? ` Separately sent tokens to ${distributed} wallet(s) with no same-tx SOL back — classified as a distribution/airdrop, not counted as extraction.`
      : "";

    if (!creatorIsExtracting && distributed > 0) {
      // Distribution-dominant with no meaningful sell-back or SOL movement = airdrop.
      creatorDetail = `Creator sent tokens to ${distributed} wallet(s) with no same-tx SOL received back — classified as a distribution/airdrop, not extraction. No notable cash-out detected.`;
    } else if (soldSol > 0.05) {
      creatorDetail = `Creator sold ~${soldSol.toFixed(2)} SOL of tokens and moved ~${sent.toFixed(2)} SOL across ${hops} destination(s).${airdropNote}`;
    } else {
      creatorDetail = `Creator collected ~${(cf.totalSolReceived || 0).toFixed(2)} SOL and moved ~${sent.toFixed(2)} SOL across ${hops} destination(s).${airdropNote}`;
    }
  }

  // Outflow / dump risk should reflect ACTUAL selling, not wide distribution. A
  // token held by many small wallets is not inherently dumping — only elevate the
  // score when there's real sell-back evidence or active creator extraction.
  const hasDumpEvidence = soldSol > 0.05 || creatorIsExtracting;
  const movementScore = hasDumpEvidence
    ? clamp(Math.max(input.movedElsewherePercent, 60))
    : clamp(Math.min(input.movedElsewherePercent, 20));
  const movementDetail = hasDumpEvidence
    ? `${input.movedElsewherePercent.toFixed(1)}% of supply circulates outside liquidity, with on-chain sell activity detected.`
    : `${input.movedElsewherePercent.toFixed(1)}% of supply circulates outside liquidity — wide distribution, no dumping detected.`;

  const categories: RiskCategory[] = [
    {
      key: "concentration",
      label: "Holder Concentration",
      score: Math.round(concentrationScore),
      weight: 0.3,
      detail: `Top non-liquidity holder ${input.topHolderPercent.toFixed(1)}%, top 5 ~${top5.toFixed(1)}%.${exclusionNote}`,
    },
    {
      key: "liquidity",
      label: "Liquidity Depth",
      score: Math.round(liquidityScore),
      weight: 0.2,
      detail:
        liqUsd != null
          ? `~$${Math.round(liqUsd).toLocaleString()} in the liquidity pool${pool > 0 ? ` (${pool}% of supply)` : ""}.`
          : pool > 0
            ? `${pool}% of supply sits in a liquidity pool.`
            : `${input.reinvestedPercent.toFixed(1)}% of supply sits in liquidity.`,
    },
    {
      key: "movement",
      label: "Outflow / Dump Risk",
      score: Math.round(movementScore),
      weight: 0.25,
      detail: movementDetail,
    },
    {
      key: "creator",
      label: "Creator Behaviour",
      score: Math.round(creatorScore),
      weight: 0.15,
      detail: creatorDetail,
    },
  ];

  const addresses = [
    input.creatorAddress,
    input.topHolderAddress,
    ...input.topHolders.map((h) => h.address),
    ...(input.creatorFees?.solDestinations || []).map((d) => d.address),
    ...(input.creatorFees?.feeWallets || []).map((w) => w.address),
  ].filter(Boolean);
  const sanction = screenSanctions(addresses);
  const coverage = sanctionsCoverage(chain);

  categories.push({
    key: "compliance",
    label: "Sanctions / Compliance",
    score: sanction.sanctioned ? 100 : 0,
    weight: 0.1,
    detail: sanction.sanctioned
      ? `Match against bundled OFAC SDN crypto list: ${sanction.matches.join(", ")}.`
      : coverage.available
        ? "No associated address matched the bundled OFAC SDN crypto list (static subset)."
        : coverage.note,
  });

  let score = Math.round(categories.reduce((s, c) => s + c.score * c.weight, 0));
  if (sanction.sanctioned) score = Math.max(score, 90);
  score = clamp(score);

  const flags: RiskFlag[] = [];
  if (sanction.sanctioned) {
    flags.push({
      severity: "critical",
      label: "Sanctioned address detected",
      detail: `One or more associated wallets appear on the bundled OFAC SDN crypto list (${sanction.matches.join(", ")}).`,
    });
  }
  if (input.topHolderPercent >= 50) {
    flags.push({
      severity: "critical",
      label: "Extreme holder concentration",
      detail: `A single wallet controls ${input.topHolderPercent.toFixed(1)}% of supply.`,
    });
  } else if (input.topHolderPercent >= 25) {
    flags.push({
      severity: "warning",
      label: "High holder concentration",
      detail: `Top holder controls ${input.topHolderPercent.toFixed(1)}% of supply.`,
    });
  }
  const liquidityThin = liqUsd != null ? liqUsd < 5_000 : input.reinvestedPercent < 10;
  if (liquidityThin && !input.dataIncomplete) {
    flags.push({
      severity: "warning",
      label: "Thin liquidity",
      detail:
        liqUsd != null
          ? `Only ~$${Math.round(liqUsd).toLocaleString()} of liquidity — price may be easy to move.`
          : `Only ${input.reinvestedPercent.toFixed(1)}% of supply is in liquidity — price may be easy to move.`,
    });
  }
  if (input.movedElsewherePercent >= 50 && hasDumpEvidence) {
    flags.push({
      severity: "warning",
      label: "Large outflows",
      detail: `${input.movedElsewherePercent.toFixed(1)}% of supply is circulating outside liquidity, and on-chain selling was detected.`,
    });
  }
  if (creatorIsExtracting) {
    flags.push({ severity: "warning", label: "Active creator extraction", detail: creatorDetail });
  }
  if (locked >= 5) {
    flags.push({
      severity: "info",
      label: "Supply locked",
      detail: `${locked}% of supply is held in a lock/vesting contract — it can't be dumped while locked. This is generally favorable.`,
    });
  }
  if (burned >= 5) {
    flags.push({
      severity: "info",
      label: "Supply burned",
      detail: `${burned}% of supply has been sent to a burn address and removed from circulation. This is generally favorable.`,
    });
  }
  if (!sanction.sanctioned && !coverage.available) {
    flags.push({ severity: "info", label: "Sanctions coverage limited", detail: coverage.note });
  }

  const confidence: RiskConfidence = input.dataIncomplete
    ? "low"
    : chain.toLowerCase() === "solana"
      ? "high"
      : "medium";
  if (input.dataIncomplete) {
    flags.push({
      severity: "info",
      label: "Incomplete data",
      detail: "Full holder/flow data could not be loaded; score confidence is reduced.",
    });
  } else if (confidence === "medium") {
    flags.push({
      severity: "info",
      label: "Approximated data",
      detail: `${chain} holder data is approximated from recent on-chain activity; treat as directional.`,
    });
  }

  return {
    score,
    band: bandFromScore(score),
    grade: gradeFromScore(score),
    confidence,
    categories,
    flags,
    sanctioned: sanction.sanctioned,
    sanctionDetail: sanction.sanctioned ? sanction.matches.join(", ") : null,
    sanctionsCoverage: coverage.available ? "partial-static" : "unavailable",
    generatedAt: new Date().toISOString(),
    chain,
  };
}
