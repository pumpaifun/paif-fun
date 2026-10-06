import {
  isValidSolanaAddress,
  type ChainId,
} from "@/lib/chains";

export const WATCHLIST_STORAGE_KEY = "paif-watchlist-v1";

export type WatchItem = {
  chainId: "solana";
  address: string;
  addedAt: number;
};

let sessionWatchlist: WatchItem[] | null = null;

export function sameWatchToken(
  item: WatchItem,
  chainId: ChainId,
  address: string,
): boolean {
  return chainId === "solana" && item.address === address.trim();
}

export function loadWatchlist(): WatchItem[] {
  if (sessionWatchlist) return [...sessionWatchlist];
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(WATCHLIST_STORAGE_KEY);
    if (!raw) {
      sessionWatchlist = [];
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      sessionWatchlist = [];
      return [];
    }

    const normalized: WatchItem[] = [];
    for (const candidate of parsed) {
      if (
        !candidate ||
        typeof candidate !== "object" ||
        !("chainId" in candidate) ||
        candidate.chainId !== "solana" ||
        !("address" in candidate) ||
        typeof candidate.address !== "string"
      ) {
        continue;
      }
      const address = candidate.address.trim();
      if (!isValidSolanaAddress(address)) continue;
      if (normalized.some((item) => sameWatchToken(item, "solana", address))) continue;
      normalized.push({
        chainId: "solana",
        address,
        addedAt:
          "addedAt" in candidate &&
          typeof candidate.addedAt === "number" &&
          Number.isFinite(candidate.addedAt)
            ? candidate.addedAt
            : Date.now(),
      });
    }
    sessionWatchlist = normalized;
    return [...normalized];
  } catch {
    sessionWatchlist = [];
    return [];
  }
}

export function saveWatchlist(items: WatchItem[]): boolean {
  const solanaItems = items.filter(
    (item) => item.chainId === "solana" && isValidSolanaAddress(item.address),
  );
  sessionWatchlist = [...solanaItems];
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(solanaItems));
    return true;
  } catch {
    return false;
  }
}

export function isTokenWatched(
  items: WatchItem[],
  chainId: ChainId,
  address: string,
): boolean {
  return items.some((item) => sameWatchToken(item, chainId, address));
}

export function addWatchItem(
  items: WatchItem[],
  chainId: ChainId,
  address: string,
): WatchItem[] {
  const normalizedAddress = address.trim();
  if (
    chainId !== "solana" ||
    !isValidSolanaAddress(normalizedAddress) ||
    isTokenWatched(items, chainId, normalizedAddress)
  ) {
    return items;
  }
  return [{ chainId: "solana", address: normalizedAddress, addedAt: Date.now() }, ...items];
}

export function removeWatchItem(
  items: WatchItem[],
  chainId: ChainId,
  address: string,
): WatchItem[] {
  return items.filter((item) => !sameWatchToken(item, chainId, address));
}