import type { ClawPumpCreatorRewards, ClawPumpMigratedCreatorRewards } from "@shared/scan-types";
import { rpcFetchWithFallback } from "./rpc-fallback";

const CLAWPUMP_ORIGIN = "https://clawpump.tech";
const CACHE_TTL_MS = 5 * 60_000;
export type ClawPumpRewardLookup = {
  status: "linked" | "not_linked" | "unavailable";
  rewards: ClawPumpCreatorRewards | null;
  migratedRewards: ClawPumpMigratedCreatorRewards | null;
  checkedAt: string;
};
const cache = new Map<string, { expiresAt: number; value: ClawPumpRewardLookup }>();

function finiteAmount(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  return fetch(url, {
    headers: { Accept: "text/html,application/json" },
    signal: AbortSignal.timeout(6_000),
  });
}

function metricFromPage(html: string, label: string): number {
  const pattern = new RegExp(`"div","${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}".{0,800}?"children":"([0-9.]+)"`, "i");
  return finiteAmount(html.match(pattern)?.[1]);
}

type PayoutRoute = {
  feeRoutingWallet: string | null;
  rewardDestinationWallet: string | null;
  otherSplitRecipientWallet: string | null;
  creatorSharePercent: number | null;
  otherSharePercent: number | null;
};

async function payoutRouteFromTransaction(signature: string, expectedAmountSol: number): Promise<PayoutRoute> {
  const emptyRoute: PayoutRoute = {
    feeRoutingWallet: null,
    rewardDestinationWallet: null,
    otherSplitRecipientWallet: null,
    creatorSharePercent: null,
    otherSharePercent: null,
  };
  const primaryRpc = process.env.HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    : "https://api.mainnet-beta.solana.com";
  try {
    const response = await rpcFetchWithFallback(primaryRpc, {
      method: "POST",
      headers: { "content-type": "application/json", "x-rpc-timeout-ms": "20_000" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const json = await response.json() as {
      result?: {
        transaction?: { message?: { accountKeys?: Array<string | { pubkey?: string }> } };
        meta?: { preBalances?: number[]; postBalances?: number[] };
      };
    };
    const keys = json.result?.transaction?.message?.accountKeys || [];
    const pre = json.result?.meta?.preBalances || [];
    const post = json.result?.meta?.postBalances || [];
    const deltas = keys.map((key, index) => ({
      address: typeof key === "string" ? key : key.pubkey || "",
      amountSol: ((post[index] || 0) - (pre[index] || 0)) / 1e9,
    })).filter((entry) => entry.address && Math.abs(entry.amountSol) > 0.000001);
    const positive = deltas.filter((entry) => entry.amountSol > 0);
    const closest = positive.sort(
      (a, b) => Math.abs(a.amountSol - expectedAmountSol) - Math.abs(b.amountSol - expectedAmountSol),
    )[0];
    const tolerance = Math.max(0.0002, expectedAmountSol * 0.03);
    if (!closest || Math.abs(closest.amountSol - expectedAmountSol) > tolerance) return emptyRoute;
    const feeRoutingWallet = deltas
      .filter((entry) => entry.amountSol < 0)
      .sort((a, b) => a.amountSol - b.amountSol)[0]?.address || null;
    const otherRecipient = positive
      .filter((entry) => entry.address !== closest.address)
      .sort((a, b) => b.amountSol - a.amountSol)[0] || null;
    const distributedTotal = positive.reduce((sum, entry) => sum + entry.amountSol, 0);
    return {
      feeRoutingWallet,
      rewardDestinationWallet: closest.address,
      otherSplitRecipientWallet: otherRecipient?.address || null,
      creatorSharePercent: distributedTotal > 0 ? Math.round((closest.amountSol / distributedTotal) * 1000) / 10 : null,
      otherSharePercent: distributedTotal > 0 && otherRecipient
        ? Math.round((otherRecipient.amountSol / distributedTotal) * 1000) / 10
        : null,
    };
  } catch (error) {
    console.warn("[clawpump-rewards] payout transaction unavailable:", error instanceof Error ? error.message : error);
    return emptyRoute;
  }
}

export async function getClawPumpCreatorRewards(mint: string, creatorWallet?: string): Promise<ClawPumpRewardLookup> {
  const checkedAt = new Date().toISOString();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
    return { status: "unavailable", rewards: null, migratedRewards: null, checkedAt };
  }

  const cached = cache.get(mint);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let value: ClawPumpRewardLookup = { status: "unavailable", rewards: null, migratedRewards: null, checkedAt };
  try {
    const tokenResponse = await fetchWithTimeout(`${CLAWPUMP_ORIGIN}/tokens/${encodeURIComponent(mint)}`);
    if (!tokenResponse.ok) throw new Error(`token lookup failed (${tokenResponse.status})`);
    const tokenHtml = (await tokenResponse.text()).replace(/\\"/g, "\"");
    const agentId = tokenHtml.match(/"agentId":"([0-9a-f-]{36})"/i)?.[1];
    if (!agentId) {
      const payoutSection = tokenHtml.slice(tokenHtml.indexOf("Creator fee payouts"));
      const latestDistributionTxHash = payoutSection.match(/https:\/\/solscan\.io\/tx\/([1-9A-HJ-NP-Za-km-z]{64,96})/)?.[1] || null;
      const latestPayoutAmount = finiteAmount(
        payoutSection.match(/"li","0".{0,1000}?"children":"([0-9.]+)"/)?.[1],
      );
      if (payoutSection && latestDistributionTxHash) {
        const payoutRoute = await payoutRouteFromTransaction(latestDistributionTxHash, latestPayoutAmount);
        const payoutCount = Number(payoutSection.match(/Last 5 of ([0-9]+)/i)?.[1] || 0);
        const migratedRewards: ClawPumpMigratedCreatorRewards = {
          tokenUrl: `${CLAWPUMP_ORIGIN}/tokens/${mint}`,
          totalCreatorFeesSol: metricFromPage(payoutSection, "Creator fees"),
          totalEarnedSol: metricFromPage(payoutSection, "Earned"),
          totalSentSol: metricFromPage(payoutSection, "Sent"),
          payoutCount,
          feeRoutingWallet: payoutRoute.feeRoutingWallet,
          rewardDestinationWallet: payoutRoute.rewardDestinationWallet,
          otherSplitRecipientWallet: payoutRoute.otherSplitRecipientWallet,
          creatorSharePercent: payoutRoute.creatorSharePercent,
          otherSharePercent: payoutRoute.otherSharePercent,
          rewardDestinationMatchesCreatorWallet:
            payoutRoute.rewardDestinationWallet && creatorWallet
              ? payoutRoute.rewardDestinationWallet === creatorWallet
              : null,
          latestDistributionTxHash,
          checkedAt,
        };
        value = { status: "linked", rewards: null, migratedRewards, checkedAt };
      } else {
        value = { status: "not_linked", rewards: null, migratedRewards: null, checkedAt };
      }
      cache.set(mint, { expiresAt: Date.now() + CACHE_TTL_MS, value });
      return value;
    }

    const [agentResponse, earningsResponse] = await Promise.all([
      fetchWithTimeout(`${CLAWPUMP_ORIGIN}/agent/${encodeURIComponent(agentId)}`),
      fetchWithTimeout(`${CLAWPUMP_ORIGIN}/api/agents/${encodeURIComponent(agentId)}/earnings`),
    ]);
    if (!agentResponse.ok || !earningsResponse.ok) {
      throw new Error(`agent reward lookup failed (${agentResponse.status}/${earningsResponse.status})`);
    }

    const agentHtml = await agentResponse.text();
    const earnings = await earningsResponse.json() as Record<string, unknown>;
    const agentName = agentHtml.match(/<title>([^<]+?)\s+—\s+Autonomous AI Trading Agent/i)?.[1]?.trim() || "Claw Pump agent";
    const agentWallet = agentHtml.match(/https:\/\/solscan\.io\/account\/([1-9A-HJ-NP-Za-km-z]{32,44})/)?.[1] || null;
    const recentDistributions = Array.isArray(earnings.recentDistributions)
      ? earnings.recentDistributions as Array<Record<string, unknown>>
      : [];
    const latestSentDistribution = recentDistributions.find((distribution) =>
      distribution.status === "sent" &&
      typeof distribution.toWallet === "string" &&
      /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(distribution.toWallet)
    );
    const rewardDestinationWallet = typeof latestSentDistribution?.toWallet === "string"
      ? latestSentDistribution.toWallet
      : null;
    const latestDistributionTxHash =
      typeof latestSentDistribution?.txHash === "string" &&
      /^[1-9A-HJ-NP-Za-km-z]{64,96}$/.test(latestSentDistribution.txHash)
        ? latestSentDistribution.txHash
        : null;

    const rewards: ClawPumpCreatorRewards = {
      agentId,
      agentName,
      agentWallet,
      profileUrl: `${CLAWPUMP_ORIGIN}/agent/${agentId}`,
      tokenUrl: `${CLAWPUMP_ORIGIN}/tokens/${mint}`,
      agentSharePercent: 65,
      totalEarnedSol: finiteAmount(earnings.totalEarned),
      totalSentSol: finiteAmount(earnings.totalSent),
      totalPendingSol: finiteAmount(earnings.totalPending),
      recentDistributionCount: recentDistributions.length,
      rewardDestinationWallet,
      rewardDestinationMatchesAgentWallet:
        rewardDestinationWallet && agentWallet ? rewardDestinationWallet === agentWallet : null,
      latestDistributionTxHash,
      checkedAt,
    };
    value = { status: "linked", rewards, migratedRewards: null, checkedAt };
  } catch (error) {
    console.warn("[clawpump-rewards] lookup unavailable:", error instanceof Error ? error.message : error);
  }

  cache.set(mint, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}