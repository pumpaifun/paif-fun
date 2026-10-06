export type ChainId = "solana" | "bnb" | "base" | "sei";

export interface ChainConfig {
  id: ChainId;
  name: string;
  shortName: string;
  kind: "solana" | "evm";
  /** Numeric EVM chain id (only present for EVM chains). */
  evmChainId?: number;
  nativeSymbol: string;
  explorerName: string;
  explorerTxUrl: (hash: string) => string;
  explorerAddressUrl: (address: string) => string;
  explorerTokenUrl: (address: string) => string;
  dexscreenerSlug: string;
  launchFeedName: string;
  launchFeedUrl: string;
}

export const CHAINS: Record<ChainId, ChainConfig> = {
  solana: {
    id: "solana",
    name: "Solana",
    shortName: "SOL",
    kind: "solana",
    nativeSymbol: "SOL",
    explorerName: "Solscan",
    explorerTxUrl: (hash) => `https://solscan.io/tx/${hash}`,
    explorerAddressUrl: (address) => `https://solscan.io/account/${address}`,
    explorerTokenUrl: (address) => `https://solscan.io/token/${address}`,
    dexscreenerSlug: "solana",
    launchFeedName: "Pump.fun",
    launchFeedUrl: "https://pump.fun",
  },
  bnb: {
    id: "bnb",
    name: "BNB Chain",
    shortName: "BNB",
    kind: "evm",
    evmChainId: 56,
    nativeSymbol: "BNB",
    explorerName: "BscScan",
    explorerTxUrl: (hash) => `https://bscscan.com/tx/${hash}`,
    explorerAddressUrl: (address) => `https://bscscan.com/address/${address}`,
    explorerTokenUrl: (address) => `https://bscscan.com/token/${address}`,
    dexscreenerSlug: "bsc",
    launchFeedName: "four.meme",
    launchFeedUrl: "https://four.meme",
  },
  base: {
    id: "base",
    name: "Base",
    shortName: "BASE",
    kind: "evm",
    evmChainId: 8453,
    nativeSymbol: "ETH",
    explorerName: "BaseScan",
    explorerTxUrl: (hash) => `https://basescan.org/tx/${hash}`,
    explorerAddressUrl: (address) => `https://basescan.org/address/${address}`,
    explorerTokenUrl: (address) => `https://basescan.org/token/${address}`,
    dexscreenerSlug: "base",
    launchFeedName: "DexScreener",
    launchFeedUrl: "https://dexscreener.com/base",
  },
  sei: {
    id: "sei",
    name: "Sei",
    shortName: "SEI",
    kind: "evm",
    evmChainId: 1329,
    nativeSymbol: "SEI",
    explorerName: "Seitrace",
    explorerTxUrl: (hash) => `https://seitrace.com/tx/${hash}?chain=pacific-1`,
    explorerAddressUrl: (address) => `https://seitrace.com/address/${address}?chain=pacific-1`,
    explorerTokenUrl: (address) => `https://seitrace.com/token/${address}?chain=pacific-1`,
    dexscreenerSlug: "seiv2",
    launchFeedName: "DexScreener",
    launchFeedUrl: "https://dexscreener.com/sei",
  },
};

export const DEFAULT_CHAIN: ChainId = "solana";

/** All chain ids in display order. */
export const CHAIN_ORDER: ChainId[] = ["solana", "bnb", "base", "sei"];

/** EVM chains only, in display order. */
export const EVM_CHAINS: ChainId[] = CHAIN_ORDER.filter((id) => CHAINS[id].kind === "evm");

export function isChainId(value: unknown): value is ChainId {
  return typeof value === "string" && value in CHAINS;
}

export function isEvmChain(chain: ChainId): boolean {
  return CHAINS[chain].kind === "evm";
}

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_RE = /^0x[a-fA-F0-9]{40}$/;

export function isValidSolanaAddress(address: string): boolean {
  return BASE58_RE.test(address.trim());
}

export function isValidEvmAddress(address: string): boolean {
  return EVM_RE.test(address.trim());
}

export function isValidAddressForChain(address: string, chain: ChainId): boolean {
  const a = address.trim();
  return CHAINS[chain].kind === "evm" ? isValidEvmAddress(a) : isValidSolanaAddress(a);
}

export type AddressKind = "solana" | "evm" | null;

/**
 * Classify a raw address/string as Solana vs EVM — but NOT which specific EVM
 * chain. Ethereum, BNB, Base and SEI all share the identical 0x… address
 * format, so a 0x address is inherently ambiguous: the user must choose which
 * EVM network to scan it on. Returns null when it can't be classified at all
 * (e.g. an empty or malformed string).
 */
export function addressKind(raw: string): AddressKind {
  const a = raw.trim();
  if (isValidEvmAddress(a)) return "evm";
  if (isValidSolanaAddress(a)) return "solana";
  if (/pump\.fun/i.test(a)) return "solana";
  if (/four\.meme/i.test(a)) return "evm";
  return null;
}
