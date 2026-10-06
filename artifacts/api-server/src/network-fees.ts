import { rpcFetchWithFallback } from "./rpc-fallback";
import { Connection, PublicKey, LAMPORTS_PER_SOL, ComputeBudgetProgram, type TransactionInstruction } from "@solana/web3.js";
import { getSolPriceUsd } from "./solana";

const HELIUS_KEY = process.env.HELIUS_API_KEY;
const RPC_URL = HELIUS_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`
  : "https://api.mainnet-beta.solana.com";

const conn = new Connection(RPC_URL, { commitment: "confirmed", fetch: rpcFetchWithFallback });

const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

const BASE_SIGNATURE_LAMPORTS = 5_000;
const COMPUTE_UNITS_PER_BUMP = 200_000;
const MIN_PRIORITY_MICRO_LAMPORTS = 1_000;
const MAX_PRIORITY_MICRO_LAMPORTS = 1_500_000;
const HARD_CAP_LAMPORTS_PER_BUMP = 1_000_000;

interface FeeEstimate {
  microLamportsPerCu: number;
  computeUnits: number;
  priorityLamports: number;
  baseLamports: number;
  totalLamports: number;
  totalSol: number;
  congestion: "low" | "medium" | "high";
  fetchedAt: number;
}

let cache: FeeEstimate | null = null;
const CACHE_TTL_MS = 30_000;

async function fetchPriorityFeeMicroLamportsPerCu(): Promise<number> {
  try {
    const samples = await conn.getRecentPrioritizationFees({ lockedWritableAccounts: [PUMP_PROGRAM_ID] });
    if (!samples?.length) return MIN_PRIORITY_MICRO_LAMPORTS;
    const fees = samples.map(s => s.prioritizationFee).filter(f => f > 0).sort((a, b) => a - b);
    if (!fees.length) return MIN_PRIORITY_MICRO_LAMPORTS;
    const p75 = fees[Math.floor(fees.length * 0.75)] ?? fees[fees.length - 1];
    return Math.min(MAX_PRIORITY_MICRO_LAMPORTS, Math.max(MIN_PRIORITY_MICRO_LAMPORTS, p75));
  } catch (e: any) {
    console.warn("[network-fees] getRecentPrioritizationFees failed, using floor:", e?.message);
    return MIN_PRIORITY_MICRO_LAMPORTS;
  }
}

export async function getNetworkFeeEstimate(): Promise<FeeEstimate> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache;

  const microLamportsPerCu = await fetchPriorityFeeMicroLamportsPerCu();
  // priority lamports = microLamportsPerCu * computeUnits / 1e6
  const priorityLamports = Math.ceil((microLamportsPerCu * COMPUTE_UNITS_PER_BUMP) / 1_000_000);
  const totalRaw = BASE_SIGNATURE_LAMPORTS + priorityLamports;
  const totalLamports = Math.min(HARD_CAP_LAMPORTS_PER_BUMP, totalRaw);
  const totalSol = totalLamports / LAMPORTS_PER_SOL;
  const congestion: "low" | "medium" | "high" =
    microLamportsPerCu >= 200_000 ? "high"
    : microLamportsPerCu >= 25_000  ? "medium"
    :                                  "low";
  cache = {
    microLamportsPerCu,
    computeUnits: COMPUTE_UNITS_PER_BUMP,
    priorityLamports,
    baseLamports: BASE_SIGNATURE_LAMPORTS,
    totalLamports,
    totalSol,
    congestion,
    fetchedAt: now,
  };
  return cache;
}

// Returns the priority fee value to pass to PumpPortal's `priorityFee` field
// (denominated in SOL). Matches the same dynamic estimate so the user, not us,
// pays whatever Solana congestion costs.
export async function getPriorityFeeSolForPumpPortal(): Promise<number> {
  const est = await getNetworkFeeEstimate();
  return est.priorityLamports / LAMPORTS_PER_SOL;
}

// Returns ComputeBudget instructions to prepend to the manual fallback so
// that path also pays the dynamic priority fee.
export async function buildComputeBudgetInstructions(): Promise<TransactionInstruction[]> {
  const est = await getNetworkFeeEstimate();
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: est.computeUnits }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: est.microLamportsPerCu }),
  ];
}

// Public payload returned by /api/network/fee-estimate. Adds USD context so
// the bump-bot UI can render "≈ $X per bump at current congestion".
export async function getPublicNetworkFeeEstimate() {
  const est = await getNetworkFeeEstimate();
  const solPriceUsd = (await getSolPriceUsd()) || 0;
  const totalUsd = solPriceUsd > 0 ? est.totalSol * solPriceUsd : 0;
  return {
    microLamportsPerCu: est.microLamportsPerCu,
    computeUnits: est.computeUnits,
    priorityLamports: est.priorityLamports,
    baseLamports: est.baseLamports,
    totalLamports: est.totalLamports,
    totalSol: est.totalSol,
    totalUsd,
    solPriceUsd,
    congestion: est.congestion,
    fetchedAt: est.fetchedAt,
    // Recommended minimum SOL each sub-wallet should hold to safely fire one
    // bump under current congestion. Doubles the network estimate to leave
    // slack for slippage / bonding-curve drift.
    recommendedPerBumpLamports: Math.ceil(est.totalLamports * 2),
  };
}
