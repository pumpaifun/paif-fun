import { createPublicClient, http, erc20Abi, getAddress, formatUnits, parseAbiItem, type Chain, type PublicClient } from "viem";
import { bsc, base, sei } from "viem/chains";
import type { ScanResult, CreatorFeeInfo } from "@shared/scan-types";
import { computeRiskAssessment } from "./risk-score";

// ---------------------------------------------------------------------------
// Per-chain config
//
// EVM addresses (0x…) are identical across BNB / Base / SEI, so the chain a
// token lives on is NOT derivable from the address — the caller must tell us
// which chain to scan. Everything below is parameterised by that chain id.
// ---------------------------------------------------------------------------
export type EvmChainKey = "bnb" | "base" | "sei";

interface EvmChainCfg {
  key: EvmChainKey;
  numericId: number;
  viemChain: Chain;
  rpcUrl: string;
  logRpcUrl: string;
  logChunk: bigint;
  dexscreenerSlug: string;
  nativeSymbol: string;
  coingeckoNativeId: string;
  label: string;
}

const CHAIN_CFGS: Record<EvmChainKey, EvmChainCfg> = {
  bnb: {
    key: "bnb",
    numericId: 56,
    viemChain: bsc,
    rpcUrl: process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org",
    // Default bsc-dataseed nodes reject wide getLogs ranges; publicnode allows ~20k-block spans.
    logRpcUrl: process.env.BSC_LOG_RPC_URL || "https://bsc-rpc.publicnode.com",
    logChunk: 20000n,
    dexscreenerSlug: "bsc",
    nativeSymbol: "BNB",
    coingeckoNativeId: "binancecoin",
    label: "BNB Chain",
  },
  base: {
    key: "base",
    numericId: 8453,
    viemChain: base,
    rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
    logRpcUrl: process.env.BASE_LOG_RPC_URL || "https://base-rpc.publicnode.com",
    logChunk: 10000n,
    dexscreenerSlug: "base",
    nativeSymbol: "ETH",
    coingeckoNativeId: "ethereum",
    label: "Base",
  },
  sei: {
    key: "sei",
    numericId: 1329,
    viemChain: sei,
    rpcUrl: process.env.SEI_RPC_URL || "https://evm-rpc.sei-apis.com",
    logRpcUrl: process.env.SEI_LOG_RPC_URL || "https://sei-evm-rpc.publicnode.com",
    logChunk: 10000n,
    dexscreenerSlug: "seiv2",
    nativeSymbol: "SEI",
    coingeckoNativeId: "sei-network",
    label: "Sei",
  },
};

export function normalizeEvmChainKey(chainId?: string | null): EvmChainKey {
  if (chainId === "base" || chainId === "sei" || chainId === "bnb") return chainId;
  return "bnb";
}

const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";
// Etherscan V2 multichain endpoint. The chainid param selects the chain.
const ETHERSCAN_V2_BASE = "https://api.etherscan.io/v2/api";

const EVM_RE = /^0x[a-fA-F0-9]{40}$/;

// Addresses we never count as "real" holders for distribution purposes.
const BURN_ADDRESSES = new Set(
  [
    "0x0000000000000000000000000000000000000000",
    "0x000000000000000000000000000000000000dead",
  ].map((a) => a.toLowerCase()),
);

// Well-known infrastructure addresses, used to label money flow (BSC-centric;
// harmless no-ops on other chains).
const KNOWN_WALLETS: Record<string, { label: string; type: string }> = {
  "0x10ed43c718714eb63d5aa57b78b54704e256024e": { label: "PancakeSwap Router v2", type: "dex" },
  "0x13f4ea83d0bd40e75c8222255bc855a974568dd4": { label: "PancakeSwap Router v3", type: "dex" },
  "0x1a0a18ac4becddbd6389559687d1a73d8927e416": { label: "PancakeSwap Router", type: "dex" },
  "0xca143ce32fe78f1f7019d7d551a6402fc5350c73": { label: "PancakeSwap Factory", type: "dex" },
  "0x0ed7e52944161450477ee417de9cd3a859b14fd0": { label: "PancakeSwap", type: "dex" },
  "0x000000000000000000000000000000000000dead": { label: "Burn Address", type: "program" },
  "0x0000000000000000000000000000000000000000": { label: "Null Address", type: "program" },
  "0x5a52e96bacdabb82fd05763e25335261b270efcb": { label: "Binance Hot Wallet", type: "exchange" },
  "0x8894e0a0c962cb723c1976a4421c95949be2d4e3": { label: "Binance Hot Wallet", type: "exchange" },
  "0xf977814e90da44bfa03b6295a0616a897441acec": { label: "Binance Cold Wallet", type: "exchange" },
};

function labelFor(address: string): { label: string | null; walletType: string | null } {
  const known = KNOWN_WALLETS[address.toLowerCase()];
  return known ? { label: known.label, walletType: known.type } : { label: null, walletType: null };
}

export function hasEvmDataProvider(): boolean {
  return !!ETHERSCAN_API_KEY;
}

export function isEvmAddress(value: string): boolean {
  return EVM_RE.test(value.trim());
}

export function extractEvmTokenAddress(query: string): string {
  const q = query.trim();
  const scanMatch = q.match(/(?:bscscan|basescan|seitrace|etherscan)\.(?:com|org|io)\/(?:token|address)\/(0x[a-fA-F0-9]{40})/i);
  if (scanMatch) return getAddress(scanMatch[1]);
  const dexMatch = q.match(/dexscreener\.com\/[a-z0-9]+\/(0x[a-fA-F0-9]{40})/i);
  if (dexMatch) return getAddress(dexMatch[1]);
  const fourMatch = q.match(/four\.meme\/[^/]*\/?(0x[a-fA-F0-9]{40})/i);
  if (fourMatch) return getAddress(fourMatch[1]);
  const bare = q.match(/(0x[a-fA-F0-9]{40})/);
  if (bare) return getAddress(bare[1]);
  throw new Error(
    "Could not find a valid EVM token address. Please paste a contract address (0x…) or an explorer/DexScreener link.",
  );
}

// ---------------------------------------------------------------------------
// Per-chain viem clients (memoised)
// ---------------------------------------------------------------------------
interface ChainCtx {
  cfg: EvmChainCfg;
  publicClient: PublicClient;
  // A separate client pointed at a public RPC that permits wide eth_getLogs
  // ranges (default chain RPCs often reject getLogs). Powers the key-free
  // money-flow + holder approximation path.
  logClient: PublicClient;
}

const ctxCache = new Map<EvmChainKey, ChainCtx>();

function getCtx(chainId?: string | null): ChainCtx {
  const key = normalizeEvmChainKey(chainId);
  let ctx = ctxCache.get(key);
  if (!ctx) {
    const cfg = CHAIN_CFGS[key];
    ctx = {
      cfg,
      publicClient: createPublicClient({ chain: cfg.viemChain, transport: http(cfg.rpcUrl, { timeout: 12_000 }) }),
      logClient: createPublicClient({ chain: cfg.viemChain, transport: http(cfg.logRpcUrl, { timeout: 15_000 }) }),
    };
    ctxCache.set(key, ctx);
  }
  return ctx;
}

// Public viem client for a given EVM chain (defaults to BNB Chain, which is the
// only chain the buyback/PancakeSwap helpers in evm-buyback.ts operate on).
// Used by the EVM buyback primitives to readContract / getTransactionReceipt.
export function getEvmClient(chainId: string | null = "bnb"): PublicClient {
  return getCtx(chainId).publicClient;
}

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

interface Erc20Meta {
  name: string;
  symbol: string;
  decimals: number;
  totalSupplyRaw: bigint;
}

async function getErc20Meta(ctx: ChainCtx, token: `0x${string}`): Promise<Erc20Meta> {
  const { publicClient } = ctx;
  const [name, symbol, decimals, totalSupply] = await Promise.all([
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "name" }).catch(() => ""),
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }).catch(() => ""),
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }).catch(() => 18),
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" }).catch(() => 0n),
  ]);
  return {
    name: name as string,
    symbol: symbol as string,
    decimals: Number(decimals),
    totalSupplyRaw: totalSupply as bigint,
  };
}

async function getNativeBalance(ctx: ChainCtx, address: `0x${string}`): Promise<number> {
  const wei = await ctx.publicClient.getBalance({ address });
  return Number(formatUnits(wei, 18));
}

async function getErc20Balance(ctx: ChainCtx, token: `0x${string}`, owner: `0x${string}`, decimals: number): Promise<number> {
  const raw = (await ctx.publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
  })) as bigint;
  return Number(formatUnits(raw, decimals));
}

// ---------------------------------------------------------------------------
// Etherscan V2 helpers (requires a paid key for most chains; optional)
// ---------------------------------------------------------------------------
async function etherscan(ctx: ChainCtx, params: Record<string, string>): Promise<any> {
  if (!ETHERSCAN_API_KEY) throw new Error("ETHERSCAN_API_KEY not configured");
  const url = new URL(ETHERSCAN_V2_BASE);
  url.searchParams.set("chainid", String(ctx.cfg.numericId));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apikey", ETHERSCAN_API_KEY);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    const data = await res.json();
    if (data.status === "0" && typeof data.result === "string" && /rate limit|Max .* rate|Invalid API Key/i.test(data.result)) {
      throw new Error(`Etherscan: ${data.result}`);
    }
    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

interface TokenTransfer {
  from: string;
  to: string;
  value: string;
  timeStamp: string;
  hash: string;
  tokenDecimal: string;
}

async function getTokenTransfers(ctx: ChainCtx, token: string, offset = 10000): Promise<TokenTransfer[]> {
  const data = await etherscan(ctx, {
    module: "account",
    action: "tokentx",
    contractaddress: token,
    page: "1",
    offset: String(offset),
    sort: "asc",
  });
  return Array.isArray(data.result) ? (data.result as TokenTransfer[]) : [];
}

async function getContractCreator(ctx: ChainCtx, token: string): Promise<string | null> {
  try {
    const data = await etherscan(ctx, {
      module: "contract",
      action: "getcontractcreation",
      contractaddresses: token,
    });
    if (Array.isArray(data.result) && data.result[0]?.contractCreator) {
      return getAddress(data.result[0].contractCreator);
    }
  } catch {}
  return null;
}

interface NativeTx {
  from: string;
  to: string;
  value: string;
  timeStamp: string;
  hash: string;
  isError: string;
}

async function getNativeTxList(ctx: ChainCtx, address: string, offset = 50): Promise<NativeTx[]> {
  const data = await etherscan(ctx, {
    module: "account",
    action: "txlist",
    address,
    page: "1",
    offset: String(offset),
    sort: "desc",
  });
  return Array.isArray(data.result) ? (data.result as NativeTx[]) : [];
}

// ---------------------------------------------------------------------------
// Holder derivation (approximate, from transfer events)
// ---------------------------------------------------------------------------
function deriveHoldersFromTransfers(
  transfers: TokenTransfer[],
  decimals: number,
): { holders: { address: string; amount: number }[]; capped: boolean } {
  const balances = new Map<string, bigint>();
  for (const t of transfers) {
    let v: bigint;
    try {
      v = BigInt(t.value);
    } catch {
      continue;
    }
    const from = t.from.toLowerCase();
    const to = t.to.toLowerCase();
    if (!BURN_ADDRESSES.has(from)) balances.set(from, (balances.get(from) || 0n) - v);
    if (!BURN_ADDRESSES.has(to)) balances.set(to, (balances.get(to) || 0n) + v);
  }

  const holders = Array.from(balances.entries())
    .filter(([addr, bal]) => bal > 0n && !BURN_ADDRESSES.has(addr))
    .map(([addr, bal]) => ({ address: getAddress(addr), amount: Number(formatUnits(bal, decimals)) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 50);

  const capped = transfers.length >= 10000;
  return { holders, capped };
}

// ---------------------------------------------------------------------------
// Money flow (mirror of the Solana analyzer, in human-readable units)
// ---------------------------------------------------------------------------
function analyzeMoneyFlow(holders: { address: string; amount: number }[], totalSupply: number) {
  if (totalSupply === 0 || holders.length === 0) {
    return { topHolderPercent: 0, reinvestedPercent: 0, movedElsewherePercent: 0, dataIncomplete: holders.length === 0 };
  }
  const topHolderPercent = Math.round((holders[0].amount / totalSupply) * 100);
  const totalHeld = holders.reduce((s, h) => s + h.amount, 0);
  const topHoldersPercent = Math.round((totalHeld / totalSupply) * 100);
  const liquidityPercent = Math.max(0, Math.min(40, Math.round(topHoldersPercent * 0.3)));
  const movedPercent = Math.max(0, 100 - topHolderPercent - liquidityPercent);
  return {
    topHolderPercent: Math.min(topHolderPercent, 100),
    reinvestedPercent: Math.min(liquidityPercent, 100),
    movedElsewherePercent: Math.min(movedPercent, 100),
    dataIncomplete: false,
  };
}

function calculateRating(
  ctx: ChainCtx,
  topHolderPercent: number,
  reinvestedPercent: number,
  dataIncomplete: boolean,
): { rating: "green" | "yellow" | "red" | null; explanation: string } {
  if (dataIncomplete) {
    return {
      rating: null,
      explanation: `We couldn't load full holder data right now. The token exists on ${ctx.cfg.label}, but we need more data to give a rating. Try scanning again in a moment.`,
    };
  }
  const keptAndReinvested = topHolderPercent + reinvestedPercent;
  if (keptAndReinvested >= 50) {
    return {
      rating: "green",
      explanation:
        "Most of the supply is concentrated in top wallets. This could mean strong holders or centralization — worth watching.",
    };
  }
  if (keptAndReinvested >= 25) {
    return {
      rating: "yellow",
      explanation: "The supply is somewhat spread out. Mixed signals — some concentration but not extreme.",
    };
  }
  return {
    rating: "red",
    explanation:
      "The supply is widely distributed with small top holders. This could be natural or could mean early wallets have sold.",
  };
}

// ---------------------------------------------------------------------------
// Prices (DexScreener + CoinGecko, no keys required)
// ---------------------------------------------------------------------------
async function getNativePriceUsd(ctx: ChainCtx): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ctx.cfg.coingeckoNativeId}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(8000) },
    );
    const data = await res.json();
    const p = data?.[ctx.cfg.coingeckoNativeId]?.usd;
    return typeof p === "number" ? p : null;
  } catch {
    return null;
  }
}

interface DexInfo {
  imageUrl: string;
  priceUsd: number | null;
  pairCreatedAt: number | null;
}

async function getDexScreenerInfo(ctx: ChainCtx, token: string): Promise<DexInfo> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token}`, {
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
    const pair = pairs.find((p: any) => p.chainId === ctx.cfg.dexscreenerSlug) || pairs[0];
    return {
      imageUrl: pair?.info?.imageUrl || "",
      priceUsd: pair?.priceUsd ? Number(pair.priceUsd) : null,
      pairCreatedAt: pair?.pairCreatedAt ? Number(pair.pairCreatedAt) : null,
    };
  } catch {
    return { imageUrl: "", priceUsd: null, pairCreatedAt: null };
  }
}

// ---------------------------------------------------------------------------
// Creator money flow (native in/out, analogous to creator-fee data)
// ---------------------------------------------------------------------------
async function getCreatorFlow(ctx: ChainCtx, creator: string): Promise<CreatorFeeInfo | null> {
  if (!ETHERSCAN_API_KEY || !creator) return null;
  try {
    const txs = await getNativeTxList(ctx, creator, 50);
    if (txs.length === 0) return null;

    const sym = ctx.cfg.nativeSymbol;
    const creatorLc = creator.toLowerCase();
    let totalReceived = 0;
    let totalSent = 0;
    const destinations = new Map<string, number>();
    const sources = new Map<string, number>();
    const activity: CreatorFeeInfo["creatorActivity"] = [];

    for (const tx of txs) {
      const valueNative = Number(formatUnits(BigInt(tx.value || "0"), 18));
      const ts = Number(tx.timeStamp) || 0;
      const isOut = tx.from.toLowerCase() === creatorLc;
      const counterparty = isOut ? tx.to : tx.from;
      if (valueNative > 0) {
        if (isOut) {
          totalSent += valueNative;
          if (counterparty) destinations.set(counterparty, (destinations.get(counterparty) || 0) + valueNative);
        } else {
          totalReceived += valueNative;
          if (counterparty) sources.set(counterparty, (sources.get(counterparty) || 0) + valueNative);
        }
      }
      if (activity.length < 25) {
        activity.push({
          signature: tx.hash,
          type: isOut ? "send" : "receive",
          description: `${isOut ? "Sent" : "Received"} ${valueNative.toFixed(4)} ${sym} ${isOut ? "to" : "from"} ${counterparty?.slice(0, 8)}…`,
          solAmount: valueNative,
          timestamp: ts,
        });
      }
    }

    const solDestinations = Array.from(destinations.entries())
      .map(([address, amount]) => ({ address, amount, ...labelFor(address) }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);

    const feeWallets = Array.from(sources.entries())
      .map(([address, totalReceived]) => ({ address, totalReceived, ...labelFor(address) }))
      .sort((a, b) => b.totalReceived - a.totalReceived)
      .slice(0, 10);

    let creatorCurrentSolBalance: number | null = null;
    try {
      creatorCurrentSolBalance = await getNativeBalance(ctx, getAddress(creator));
    } catch {}

    return {
      totalSolReceived: totalReceived,
      totalSolSent: totalSent,
      totalTokensSold: 0,
      tokenSellTransactions: [],
      totalTokensDistributed: 0,
      distributionRecipientCount: 0,
      distributionTransactions: [],
      distributionDestinations: [],
      distributionClassificationDegraded: false,
      solDestinations,
      creatorCurrentSolBalance,
      feeWallets,
      tradingFeesTotal: 0,
      creatorActivity: activity,
    };
  } catch (err: any) {
    console.log("EVM creator flow failed:", err?.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Key-free money flow via public RPC (eth_getLogs of Transfer events)
//
// Because EVM exposes no holder-enumeration RPC, "top holders" are
// approximated: we collect addresses active in the recent window and read their
// live balanceOf, then rank by actual current balance. Accurate for
// freshly-launched tokens (the target use case); a recent-activity
// approximation for established tokens.
// ---------------------------------------------------------------------------
interface RpcTransfer {
  from: string;
  to: string;
  value: bigint;
  blockNumber: bigint;
  hash: string;
}

async function getTransferLogsViaRpc(
  ctx: ChainCtx,
  token: `0x${string}`,
  opts: { maxChunks?: number; maxLogs?: number } = {},
): Promise<RpcTransfer[]> {
  const chunk = ctx.cfg.logChunk;
  const maxChunks = opts.maxChunks ?? 6;
  const maxLogs = opts.maxLogs ?? 6000;

  const head = await ctx.logClient.getBlockNumber();
  let to = head;
  let collected: RpcTransfer[] = [];

  for (let i = 0; i < maxChunks && collected.length < maxLogs; i++) {
    const from = to > chunk ? to - chunk : 0n;
    try {
      const logs = await ctx.logClient.getLogs({ address: token, event: TRANSFER_EVENT, fromBlock: from, toBlock: to });
      const mapped: RpcTransfer[] = logs.map((l) => ({
        from: String((l.args as any).from || "").toLowerCase(),
        to: String((l.args as any).to || "").toLowerCase(),
        value: ((l.args as any).value ?? 0n) as bigint,
        blockNumber: l.blockNumber ?? 0n,
        hash: l.transactionHash ?? "",
      }));
      collected = mapped.concat(collected);
    } catch {
      // Skip a chunk the RPC refuses; keep what we have.
    }
    if (from === 0n) break;
    to = from - 1n;
  }
  return collected;
}

async function blockTimestamps(ctx: ChainCtx, blocks: bigint[]): Promise<Map<string, number>> {
  const unique = Array.from(new Set(blocks.map((b) => b.toString()))).slice(0, 12);
  const out = new Map<string, number>();
  await Promise.all(
    unique.map(async (bn) => {
      try {
        const blk = await ctx.logClient.getBlock({ blockNumber: BigInt(bn) });
        out.set(bn, Number(blk.timestamp));
      } catch {}
    }),
  );
  return out;
}

async function deriveTopHoldersViaBalanceOf(
  ctx: ChainCtx,
  token: `0x${string}`,
  decimals: number,
  transfers: RpcTransfer[],
): Promise<{ address: string; amount: number }[]> {
  const activity = new Map<string, number>();
  for (const t of transfers) {
    if (!BURN_ADDRESSES.has(t.from)) activity.set(t.from, (activity.get(t.from) || 0) + 1);
    if (!BURN_ADDRESSES.has(t.to)) activity.set(t.to, (activity.get(t.to) || 0) + 1);
  }
  const candidates = Array.from(activity.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 60)
    .map(([addr]) => addr);

  const balances = await Promise.all(
    candidates.map(async (addr) => {
      try {
        const bal = await getErc20Balance(ctx, token, getAddress(addr) as `0x${string}`, decimals);
        return bal > 0 ? { address: getAddress(addr), amount: bal } : null;
      } catch {
        return null;
      }
    }),
  );

  return balances
    .filter((b): b is NonNullable<typeof b> => b !== null)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 50);
}

interface RpcMoneyFlow {
  holders: { address: string; amount: number }[];
  recentTransactions: ScanResult["recentTransactions"];
  launchDate: string | null;
}

async function getMoneyFlowViaRpc(ctx: ChainCtx, token: `0x${string}`, decimals: number): Promise<RpcMoneyFlow | null> {
  const transfers = await getTransferLogsViaRpc(ctx, token);
  if (transfers.length === 0) return null;

  const holders = await deriveTopHoldersViaBalanceOf(ctx, token, decimals, transfers);

  const last = transfers.slice(-10).reverse();
  const tsMap = await blockTimestamps(ctx, last.map((t) => t.blockNumber));
  const recentTransactions: ScanResult["recentTransactions"] = last.map((t) => ({
    signature: t.hash,
    type: "transfer",
    amount: Number(formatUnits(t.value, decimals)),
    timestamp: tsMap.get(t.blockNumber.toString()) || 0,
  }));

  return { holders, recentTransactions, launchDate: null };
}

// ---------------------------------------------------------------------------
// Wallet-cluster detection (EVM)
//
// EVM has no SOL-funder concept, but the token's own Transfer graph (already
// fetched key-free via eth_getLogs) tells us who FIRST sent each top holder the
// token. Many wallets sharing one non-infra source is the same "one operator
// distributed to a swarm" signal we use on Solana — strong for bundles/snipers.
// JSON shape matches the Solana WalletClusterResult so the frontend reuses one
// component.
// ---------------------------------------------------------------------------
export type EvmWalletClusterMember = { address: string; percent: number; funder: string | null };
export type EvmWalletCluster = { funder: string; members: EvmWalletClusterMember[]; totalPercent: number };
export type EvmWalletClusterResult = {
  mint: string;
  analyzed: number;
  totalHolders: number;
  clusters: EvmWalletCluster[];
  singles: EvmWalletClusterMember[];
  largestClusterPercent: number;
  linkageQuality: "low" | "medium" | "high";
  note: string;
  generatedAt: number;
};

const evmClusterCache = new Map<string, { at: number; data: EvmWalletClusterResult }>();
const EVM_CLUSTER_TTL_MS = 5 * 60 * 1000;

export async function detectEvmWalletClusters(
  query: string,
  chainId?: string | null,
): Promise<EvmWalletClusterResult> {
  const ctx = getCtx(chainId);
  const token = extractEvmTokenAddress(query).toLowerCase() as `0x${string}`;
  const cacheKey = `${normalizeEvmChainKey(chainId)}:${token}`;
  const cached = evmClusterCache.get(cacheKey);
  if (cached && Date.now() - cached.at < EVM_CLUSTER_TTL_MS) return cached.data;

  const meta = await getErc20Meta(ctx, token);
  const supply = Number(formatUnits(meta.totalSupplyRaw, meta.decimals));
  const transfers = await getTransferLogsViaRpc(ctx, token);

  // Sources we never treat as a "linking" funder. Critically, on EVM a normal
  // buyer's FIRST token source is the DEX pair/pool contract, not a personal
  // funder — so a static known-address list (BSC-centric, and empty for
  // Base/Sei) is NOT enough. We additionally detect pool/router/CEX nodes from
  // the transfer graph: infrastructure both SENDS to many distinct wallets (buys)
  // AND RECEIVES from many distinct wallets (sells) — high bidirectional degree.
  // A genuine bundler operator sends to many sub-wallets but receives back from
  // few, so it keeps a low in-degree and is correctly NOT excluded.
  const outDeg = new Map<string, Set<string>>();
  const inDeg = new Map<string, Set<string>>();
  for (const t of transfers) {
    (outDeg.get(t.from) ?? outDeg.set(t.from, new Set()).get(t.from)!).add(t.to);
    (inDeg.get(t.to) ?? inDeg.set(t.to, new Set()).get(t.to)!).add(t.from);
  }
  const DEGREE_INFRA_THRESHOLD = 5;
  const infra = new Set<string>([...BURN_ADDRESSES, ...Object.keys(KNOWN_WALLETS), token]);
  for (const addr of outDeg.keys()) {
    if (
      (outDeg.get(addr)?.size ?? 0) >= DEGREE_INFRA_THRESHOLD &&
      (inDeg.get(addr)?.size ?? 0) >= DEGREE_INFRA_THRESHOLD
    ) {
      infra.add(addr);
    }
  }

  // Earliest inbound transfer per holder = who first handed them this token.
  const firstSource = new Map<string, { from: string; block: bigint }>();
  for (const t of transfers) {
    const prev = firstSource.get(t.to);
    if (!prev || t.blockNumber < prev.block) {
      firstSource.set(t.to, { from: t.from, block: t.blockNumber });
    }
  }

  const holders = await deriveTopHoldersViaBalanceOf(ctx, token, meta.decimals, transfers);
  const top = holders.slice(0, 25);
  const pct = (amt: number) => (supply > 0 ? (amt / supply) * 100 : 0);

  const members: EvmWalletClusterMember[] = top.map((h) => {
    const src = firstSource.get(h.address.toLowerCase());
    const funder = src && !infra.has(src.from) ? src.from : null;
    return { address: h.address, percent: Math.round(pct(h.amount) * 100) / 100, funder };
  });

  const analyzed = members.filter((m) => m.funder).length;
  const groups = new Map<string, EvmWalletClusterMember[]>();
  for (const m of members) {
    if (!m.funder) continue;
    const arr = groups.get(m.funder) || [];
    arr.push(m);
    groups.set(m.funder, arr);
  }

  const clusters: EvmWalletCluster[] = [];
  Array.from(groups.entries()).forEach(([funder, mem]) => {
    if (mem.length < 2) return;
    const totalPercent = Math.round(mem.reduce((s, x) => s + x.percent, 0) * 100) / 100;
    clusters.push({ funder, members: mem, totalPercent });
  });
  clusters.sort((a, b) => b.totalPercent - a.totalPercent);

  const clusteredAddrs = new Set(clusters.flatMap((c) => c.members.map((m) => m.address)));
  const singles = members.filter((m) => !clusteredAddrs.has(m.address));
  const largestClusterPercent = clusters.length > 0 ? clusters[0].totalPercent : 0;

  // Confidence is driven by how much of the holder set we could trace AND
  // whether we even have a meaningful transfer graph. EVM holders are an
  // approximation from recent activity, and pool/infra exclusion is best-effort,
  // so we never claim "high" without solid coverage.
  const traceRatio = top.length > 0 ? analyzed / top.length : 0;
  const linkageQuality: EvmWalletClusterResult["linkageQuality"] =
    transfers.length === 0 || top.length === 0
      ? "low"
      : traceRatio >= 0.6
        ? "high"
        : traceRatio >= 0.3
          ? "medium"
          : "low";

  const note =
    transfers.length === 0
      ? "Couldn't read this token's transfer history right now (public RPC limited). Linkage unavailable."
      : analyzed === 0
        ? "Top holders appear to have bought directly from the DEX pool or were funded independently, so no shared-source links were found."
        : "Wallets are grouped by who first sent them this token. We try to filter out the DEX pool and other shared infrastructure automatically (best-effort, not guaranteed), so treat this as an approximate signal — most reliable for fresh launches with few hops.";

  const data: EvmWalletClusterResult = {
    mint: token,
    analyzed,
    totalHolders: holders.length,
    clusters,
    singles,
    largestClusterPercent,
    linkageQuality,
    note,
    generatedAt: Date.now(),
  };
  evmClusterCache.set(cacheKey, { at: Date.now(), data });
  return data;
}

// ---------------------------------------------------------------------------
// Main scan
// ---------------------------------------------------------------------------
export async function scanEvmToken(query: string, chainId?: string | null): Promise<ScanResult> {
  const ctx = getCtx(chainId);
  const tokenAddress = extractEvmTokenAddress(query) as `0x${string}`;

  const meta = await getErc20Meta(ctx, tokenAddress).catch(() => {
    throw new Error(`Could not read this contract on ${ctx.cfg.label}. Make sure it is a valid ${ctx.cfg.label} token address.`);
  });

  const totalSupply = Number(formatUnits(meta.totalSupplyRaw, meta.decimals));

  const [dex, nativePriceUsd, creator] = await Promise.all([
    getDexScreenerInfo(ctx, tokenAddress),
    getNativePriceUsd(ctx),
    getContractCreator(ctx, tokenAddress),
  ]);

  let holders: { address: string; amount: number }[] = [];
  let dataIncomplete = false;
  let launchDate: string | null = null;
  let launchTimestamp: number | null = null;
  let recentTransactions: ScanResult["recentTransactions"] = [];

  // Primary path: Etherscan token-transfer history (requires a paid plan for
  // most chains). If a key is present and returns data, prefer it.
  let gotEtherscanData = false;
  if (ETHERSCAN_API_KEY) {
    try {
      const transfers = await getTokenTransfers(ctx, tokenAddress, 10000);
      if (transfers.length > 0) {
        const derived = deriveHoldersFromTransfers(transfers, meta.decimals);
        holders = derived.holders;
        const first = transfers[0];
        if (first?.timeStamp) {
          launchTimestamp = Number(first.timeStamp) * 1000;
          launchDate = new Date(launchTimestamp).toISOString().slice(0, 10);
        }
        recentTransactions = transfers
          .slice(-10)
          .reverse()
          .map((t) => ({
            signature: t.hash,
            type: "transfer",
            amount: Number(formatUnits(BigInt(t.value || "0"), Number(t.tokenDecimal) || meta.decimals)),
            timestamp: Number(t.timeStamp) || 0,
          }));
        gotEtherscanData = true;
      }
    } catch (err: any) {
      console.log("EVM transfer fetch (Etherscan) failed:", err?.message);
    }
  }

  // Fallback (default): key-free money-flow via public RPC getLogs.
  if (!gotEtherscanData) {
    try {
      const flow = await getMoneyFlowViaRpc(ctx, tokenAddress, meta.decimals);
      if (flow && flow.holders.length > 0) {
        holders = flow.holders;
        recentTransactions = flow.recentTransactions;
        if (flow.launchDate) launchDate = flow.launchDate;
      } else {
        dataIncomplete = true;
      }
    } catch (err: any) {
      console.log("EVM transfer fetch (RPC) failed:", err?.message);
      dataIncomplete = true;
    }
  }

  // Prefer DexScreener's pair-creation time as the launch date when available
  // (carries time-of-day). Keep the EARLIER of it and any on-chain first-transfer
  // time, so an established token's later pool can't mask the real launch. Guard
  // against implausible indexer values (pre-2015 / far future) before min().
  const MIN_PLAUSIBLE_MS = Date.UTC(2015, 0, 1);
  const MAX_PLAUSIBLE_MS = Date.now() + 24 * 60 * 60 * 1000;
  if (dex.pairCreatedAt && dex.pairCreatedAt >= MIN_PLAUSIBLE_MS && dex.pairCreatedAt <= MAX_PLAUSIBLE_MS) {
    launchTimestamp = launchTimestamp === null ? dex.pairCreatedAt : Math.min(launchTimestamp, dex.pairCreatedAt);
    launchDate = new Date(launchTimestamp).toISOString().slice(0, 10);
  }

  const { topHolderPercent, reinvestedPercent, movedElsewherePercent, dataIncomplete: flowIncomplete } =
    analyzeMoneyFlow(holders, totalSupply);
  dataIncomplete = dataIncomplete || flowIncomplete;

  const { rating, explanation } = calculateRating(ctx, topHolderPercent, reinvestedPercent, dataIncomplete);

  const topHolders = holders.map((h) => ({
    address: h.address,
    percent: totalSupply > 0 ? Math.round((h.amount / totalSupply) * 100) : 0,
  }));

  let creatorFees: CreatorFeeInfo | null = null;
  if (creator) {
    creatorFees = await getCreatorFlow(ctx, creator);
  }

  const displayName =
    meta.name || `Token ${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}`;

  const risk = computeRiskAssessment(
    {
      topHolderPercent,
      reinvestedPercent,
      movedElsewherePercent,
      dataIncomplete,
      topHolders,
      creatorAddress: creator || "",
      topHolderAddress: holders.length > 0 ? holders[0].address : "",
      creatorFees,
    },
    ctx.cfg.label || "EVM",
  );

  return {
    tokenAddress,
    tokenName: displayName,
    tokenSymbol: meta.symbol || "",
    creatorAddress: creator || "",
    tokenImage: dex.imageUrl || "",
    topHolderAddress: holders.length > 0 ? holders[0].address : "",
    totalSupply,
    topHolderPercent,
    reinvestedPercent,
    movedElsewherePercent,
    rating,
    ratingExplanation: explanation,
    dataIncomplete,
    topHolders,
    recentTransactions,
    creatorFees,
    solPriceUsd: nativePriceUsd,
    launchDate,
    launchTimestamp,
    risk,
    sentiment: null,
  };
}

// ---------------------------------------------------------------------------
// Wallet balances (native + ERC-20 holdings)
// ---------------------------------------------------------------------------
export interface EvmWalletInfo {
  walletAddress: string;
  bnbBalance: number;
  bnbPriceUsd: number | null;
  nativeSymbol: string;
  tokens: { address: string; symbol: string; name: string; balance: number; decimals: number }[];
  tokensIncomplete: boolean;
}

export async function getEvmWalletInfo(address: string, chainId?: string | null): Promise<EvmWalletInfo> {
  const ctx = getCtx(chainId);
  const owner = getAddress(address);
  const [nativeBalance, nativePriceUsd] = await Promise.all([
    getNativeBalance(ctx, owner).catch(() => 0),
    getNativePriceUsd(ctx),
  ]);

  let tokens: EvmWalletInfo["tokens"] = [];
  let tokensIncomplete = !ETHERSCAN_API_KEY;

  if (ETHERSCAN_API_KEY) {
    try {
      const data = await etherscan(ctx, {
        module: "account",
        action: "tokentx",
        address: owner,
        page: "1",
        offset: "2000",
        sort: "desc",
      });
      const txs: any[] = Array.isArray(data.result) ? data.result : [];
      const seen = new Map<string, { symbol: string; name: string; decimals: number }>();
      for (const t of txs) {
        const ca = (t.contractAddress || "").toLowerCase();
        if (ca && !seen.has(ca)) {
          seen.set(ca, {
            symbol: t.tokenSymbol || "",
            name: t.tokenName || "",
            decimals: Number(t.tokenDecimal) || 18,
          });
        }
        if (seen.size >= 30) break;
      }
      const entries = Array.from(seen.entries());
      const results = await Promise.all(
        entries.map(async ([ca, info]) => {
          try {
            const bal = await getErc20Balance(ctx, getAddress(ca) as `0x${string}`, owner, info.decimals);
            if (bal > 0) return { address: getAddress(ca), symbol: info.symbol, name: info.name, balance: bal, decimals: info.decimals };
          } catch {}
          return null;
        }),
      );
      tokens = results.filter((r): r is NonNullable<typeof r> => r !== null).sort((a, b) => b.balance - a.balance);
    } catch (err: any) {
      console.log("EVM wallet token fetch failed:", err?.message);
      tokensIncomplete = true;
    }
  }

  return { walletAddress: owner, bnbBalance: nativeBalance, bnbPriceUsd: nativePriceUsd, nativeSymbol: ctx.cfg.nativeSymbol, tokens, tokensIncomplete };
}

// ---------------------------------------------------------------------------
// four.meme launch feed (BNB-only, best-effort, defensive)
// ---------------------------------------------------------------------------
export interface EvmLaunch {
  address: string;
  name: string;
  symbol: string;
  image: string;
  createdAt: number | null;
}

export async function getFourMemeLaunches(chainId?: string | null): Promise<{ launches: EvmLaunch[]; available: boolean }> {
  // four.meme is a BNB Chain launchpad; there's no equivalent feed for other chains.
  if (normalizeEvmChainKey(chainId) !== "bnb") return { launches: [], available: false };
  try {
    const res = await fetch(
      "https://four.meme/meme-api/v1/private/token/query?orderBy=Newest&listType=All&pageIndex=1&pageSize=24&symbol=&labels=",
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return { launches: [], available: false };
    const data = await res.json();
    const list: any[] = data?.data || data?.list || [];
    if (!Array.isArray(list) || list.length === 0) return { launches: [], available: false };
    const launches: EvmLaunch[] = list
      .map((t: any) => {
        const address = t.address || t.tokenAddress || t.contractAddress || "";
        return {
          address: typeof address === "string" ? address : "",
          name: t.name || t.tokenName || "",
          symbol: t.symbol || t.tokenSymbol || "",
          image: t.image || t.logo || t.icon || "",
          createdAt: t.createTime ? Number(t.createTime) : t.createdAt ? Number(t.createdAt) : null,
        };
      })
      .filter((l) => EVM_RE.test(l.address));
    return { launches, available: launches.length > 0 };
  } catch {
    return { launches: [], available: false };
  }
}
