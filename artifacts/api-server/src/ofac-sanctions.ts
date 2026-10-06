// Bundled subset of the U.S. Treasury OFAC SDN list of sanctioned digital-currency
// addresses. This is a static seed for screening — for production-grade compliance
// it should be synced periodically against the live OFAC SDN feed.
// EVM addresses are stored lowercased; Solana addresses are stored verbatim (base58
// is case-sensitive).

const SANCTIONED_EVM: Set<string> = new Set(
  [
    // Tornado Cash (OFAC SDN, Aug 2022) — representative sample
    "0x8589427373d6d84e98730d7795d8f6f8731fda16",
    "0x722122df12d4e14e13ac3b6895a86e84145b6967",
    "0xdd4c48c0b24039969fc16d1cdf626eab821d3384",
    "0xd90e2f925da726b50c4ed8d0fb90ad053324f31b",
    "0xd96f2b1c14db8458374d9aca76e26c3d18364307",
    "0x4736dcf1b7a3d580672cce6e7c65cd5cc9cfba9d",
    "0xfd8610d20aa15b7b2e3be39b396a1bc3516c7144",
    "0x07687e702b410fa43f4cb4af7fa097918ffd2730",
    "0x23773e65ed146a459791799d01336db287f25334",
    "0x910cbd523d972eb0a6f4cae4618ad62622b39dbf",
    "0xa160cdab225685da1d56aa342ad8841c3b53f291",
  ].map((a) => a.toLowerCase()),
);

const SANCTIONED_SOLANA: Set<string> = new Set([
  // Placeholder for OFAC-listed Solana addresses; populate from live SDN feed.
]);

export interface SanctionScreenResult {
  sanctioned: boolean;
  matches: string[];
}

// Reports how much sanctions coverage exists for a given chain so callers can
// avoid implying a clean compliance pass when the bundled dataset is empty.
export function sanctionsCoverage(chain: string): { available: boolean; note: string } {
  const isSolana = chain.toLowerCase() === "solana";
  if (isSolana) {
    return SANCTIONED_SOLANA.size > 0
      ? { available: true, note: "Static bundled OFAC SDN subset (Solana)." }
      : {
          available: false,
          note: "No Solana OFAC SDN dataset is bundled — sanctions screening is unavailable on Solana. This is NOT a compliance pass.",
        };
  }
  return SANCTIONED_EVM.size > 0
    ? { available: true, note: "Static bundled OFAC SDN subset (EVM)." }
    : {
        available: false,
        note: "No EVM OFAC SDN dataset is bundled — sanctions screening is unavailable. This is NOT a compliance pass.",
      };
}

export function screenSanctions(addresses: string[]): SanctionScreenResult {
  const matches: string[] = [];
  for (const raw of addresses) {
    if (!raw) continue;
    const addr = raw.trim();
    if (addr.startsWith("0x")) {
      if (SANCTIONED_EVM.has(addr.toLowerCase())) matches.push(addr);
    } else {
      if (SANCTIONED_SOLANA.has(addr)) matches.push(addr);
    }
  }
  const unique = Array.from(new Set(matches));
  return { sanctioned: unique.length > 0, matches: unique };
}
