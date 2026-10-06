// Full holder snapshot for a Solana token (current / live).
//
// Enumerates EVERY current holder of a mint via Helius getTokenAccounts
// (cursor-paginated), aggregates balances per owner (an owner can hold the
// same mint across several token accounts), then classifies the largest
// holders so liquidity pools / burn / CEX / lockers can be excluded from an
// airdrop target list. Classification is intentionally applied only to the
// top holders: LP pools, burns and exchange wallets are always among the
// largest balances, while dust holders are virtually always real people —
// so we get accurate exclusion without an RPC call per holder.
//
// This is a LIVE snapshot (holders right now). Historical "as of a past
// date" is a separate, heavier feature (replaying transfer history) and is
// deliberately not attempted here.

import { classifyAccounts, type AccountCategory } from "./solana";

const HELIUS_KEY = process.env.HELIUS_API_KEY || "";
const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;

const MAX_PAGES = 60; // 60 x 1000 = up to 60k holders
const PAGE_SIZE = 1000;
const CLASSIFY_TOP = 300; // classify the 300 largest holders for exclusion
const MAX_RETURNED = 12000; // cap response payload size

export type SnapshotHolder = {
  owner: string;
  amount: string; // raw base units, BigInt-safe string
  uiAmount: number;
  pct: number;
  category: AccountCategory;
  label?: string | null;
  eligible: boolean; // true = airdrop target (a real holder, not a pool/burn/cex)
};

export type HolderSnapshot = {
  mint: string;
  decimals: number;
  totalSupply: number;
  totalHolders: number;
  eligibleHolders: number;
  excludedHolders: number;
  truncated: boolean; // hit the page cap — snapshot is partial
  classificationDegraded: boolean; // pool/burn/cex filtering couldn't run reliably
  returned: number; // holders included in `holders` (may be < totalHolders)
  holders: SnapshotHolder[];
  generatedAt: number;
};

const cache = new Map<string, { at: number; data: HolderSnapshot }>();
const CACHE_TTL_MS = 60_000;

async function heliusRpc(method: string, params: any): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(HELIUS_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || "RPC error");
    return data.result;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getHolderSnapshot(mint: string): Promise<HolderSnapshot> {
  const cached = cache.get(mint);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  if (!HELIUS_KEY) {
    throw new Error("Holder snapshots require a Helius API key on the server.");
  }

  // Decimals + total supply.
  const supply = await heliusRpc("getTokenSupply", [mint]);
  const decimals: number = supply?.value?.decimals ?? 0;
  const totalSupply: number = supply?.value?.uiAmount ?? 0;
  const divisor = Math.pow(10, decimals);

  // Page through every holder, summing per owner (BigInt).
  const balances = new Map<string, bigint>();
  let cursor: string | undefined;
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params: any = {
      mint,
      limit: PAGE_SIZE,
      options: { showZeroBalance: false },
    };
    if (cursor) params.cursor = cursor;

    const result = await heliusRpc("getTokenAccounts", params);
    const accounts: any[] = result?.token_accounts || [];
    for (const acc of accounts) {
      const owner: string | undefined = acc.owner;
      if (!owner) continue;
      const amt = BigInt(acc.amount ?? 0);
      if (amt <= 0n) continue;
      balances.set(owner, (balances.get(owner) || 0n) + amt);
    }
    cursor = result?.cursor;
    if (!cursor || accounts.length === 0) break;
    if (page === MAX_PAGES - 1 && cursor) truncated = true;
  }

  // Sort owners by balance desc.
  const sorted = Array.from(balances.entries()).sort((a, b) =>
    b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0,
  );

  // Classify only the largest holders (pools/burns/cex are always big).
  const topOwners = sorted.slice(0, CLASSIFY_TOP).map(([o]) => o);
  let labels = new Map<string, { category: AccountCategory; label?: string | null }>();
  let classificationDegraded = false;
  try {
    labels = await classifyAccounts(mint, topOwners);
  } catch {
    // Classification failed — we cannot reliably exclude pools/burn/cex/lockers,
    // so flag it loudly rather than silently treating everyone as a person.
    classificationDegraded = true;
  }

  const supplyRaw = BigInt(supply?.value?.amount ?? "0");
  const holders: SnapshotHolder[] = sorted.map(([owner, amount]) => {
    const info = labels.get(owner);
    const category: AccountCategory = info?.category || "person";
    const eligible = category === "person";
    const pct =
      supplyRaw > 0n ? Number((amount * 1_000_000n) / supplyRaw) / 10_000 : 0;
    return {
      owner,
      amount: amount.toString(),
      uiAmount: Number(amount) / divisor,
      pct,
      category,
      label: info?.label ?? null,
      eligible,
    };
  });

  const eligibleHolders = holders.filter((h) => h.eligible).length;
  const snapshot: HolderSnapshot = {
    mint,
    decimals,
    totalSupply,
    totalHolders: holders.length,
    eligibleHolders,
    excludedHolders: holders.length - eligibleHolders,
    truncated,
    classificationDegraded,
    returned: Math.min(holders.length, MAX_RETURNED),
    holders: holders.slice(0, MAX_RETURNED),
    generatedAt: Date.now(),
  };

  cache.set(mint, { at: Date.now(), data: snapshot });
  return snapshot;
}
