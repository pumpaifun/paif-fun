import { rpcFetchWithFallback } from "./rpc-fallback";
import type {
  CreatorFeeInfo,
  RiskAssessment,
  ScanHolderCategory,
  ScanResult,
  ScanSentiment,
} from "@shared/scan-types";
import { getTokenStats, getCandles, readChart } from "./swing-executor";
import { computeRiskAssessment } from "./risk-score";
import { fetchBondingCurve } from "./pump";
import { PublicKey } from "@solana/web3.js";

const HELIUS_KEY = process.env.HELIUS_API_KEY;
const RPC_URL = HELIUS_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`
  : "https://api.mainnet-beta.solana.com";
const solanaAddressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const SCAN_TIMEOUT_MS = HELIUS_KEY ? 45000 : 15000;

const KNOWN_WALLETS: Record<string, { label: string; type: "exchange" | "dex" | "program" | "protocol" | "bridge" | "wallet" }> = {
  "5tzFkiKscjHK98YRqE4zuT4r9MBnTVbRYQ1f4y4rPMbi": { label: "Binance", type: "exchange" },
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM": { label: "Binance", type: "exchange" },
  "2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S": { label: "Binance", type: "exchange" },
  "H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS": { label: "Coinbase", type: "exchange" },
  "GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE": { label: "Coinbase", type: "exchange" },
  "2AQdpHJ2JpcEgPiATUXjQxA8QMAHgQDnVDP6m2zqXf5H": { label: "Coinbase", type: "exchange" },
  "u6PJ8DtQuPFnfmwHbGFULQ4u4EgjDiyYKjVEsynXq2w": { label: "Kraken", type: "exchange" },
  "FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiWB7t": { label: "Kraken", type: "exchange" },
  "4wBqpZM9msxygHhgtongT2iVRJMmCpxEhUzMPaFLrRG3": { label: "OKX", type: "exchange" },
  "6mcA1uCgSE3eBkbLtjbRe6PTY3cYrNwP3oWZAKo3GWXV": { label: "OKX", type: "exchange" },
  "ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ": { label: "Bybit", type: "exchange" },
  "AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2": { label: "Bybit", type: "exchange" },
  "CEzN7mqP9xoxn2HdyW6fjEJ73t7qaX9Rp2zyS6hb3iEu": { label: "Gate.io", type: "exchange" },
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": { label: "Raydium", type: "dex" },
  "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1": { label: "Raydium", type: "dex" },
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK": { label: "Raydium CLMM", type: "dex" },
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4": { label: "Jupiter", type: "dex" },
  "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB": { label: "Jupiter V4", type: "dex" },
  "jupoNjAxXgZ4rjzxzPMP4oxduvQsQtZzyknqvzYNrNu": { label: "Jupiter Limit", type: "dex" },
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P": { label: "Pump.fun", type: "dex" },
  "39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg": { label: "Pump.fun Fee", type: "protocol" },
  "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM": { label: "Pump.fun Fee", type: "protocol" },
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc": { label: "Orca", type: "dex" },
  "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP": { label: "Orca", type: "dex" },
  "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX": { label: "OpenBook", type: "dex" },
  "11111111111111111111111111111111": { label: "System Program", type: "program" },
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA": { label: "Token Program", type: "program" },
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL": { label: "ATA Program", type: "program" },
  "ComputeBudget111111111111111111111111111111": { label: "Compute Budget", type: "program" },
  "wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb": { label: "Wormhole", type: "bridge" },
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263": { label: "BONK", type: "protocol" },
};

function labelWallet(address: string): { label: string; type: string } | null {
  const known = KNOWN_WALLETS[address];
  if (known) return known;
  return null;
}

// ---- Account classification -------------------------------------------------
// A token "holder" is often NOT a person. The pump.fun bonding curve, an AMM
// liquidity pool, a vesting/lock contract, or a burn address all show up in the
// top-holder list — but counting them as "one wallet hoarding the supply" makes
// healthy tokens look dangerous. We classify each top holder by the PROGRAM that
// owns its account so we can exclude liquidity/locks/burns from concentration
// risk and surface locked/burned supply as the favorable signals they are.

export type AccountCategory = ScanHolderCategory;
export interface AccountLabel {
  category: AccountCategory;
  label: string | null;
}

const BURN_ADDRESSES = new Set<string>([
  "1nc1nerator11111111111111111111111111111111",
]);

// Program ID -> what an account OWNED by that program represents when it holds tokens.
const PROGRAM_CATEGORY: Record<string, { category: "liquidity" | "locker"; label: string }> = {
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P": { category: "liquidity", label: "Pump.fun Bonding Curve" },
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA": { category: "liquidity", label: "PumpSwap Pool" },
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": { category: "liquidity", label: "Raydium Pool" },
  "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C": { category: "liquidity", label: "Raydium Pool" },
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK": { category: "liquidity", label: "Raydium Pool" },
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc": { category: "liquidity", label: "Orca Pool" },
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo": { category: "liquidity", label: "Meteora Pool" },
  "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB": { category: "liquidity", label: "Meteora Pool" },
  "24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi": { category: "liquidity", label: "Meteora Vault" },
  "strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m": { category: "locker", label: "Streamflow Lock" },
  "LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn": { category: "locker", label: "Jupiter Lock" },
};

const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

// pump.fun bonding curve is a deterministic PDA — derive it so the #1 holder of a
// pump token is labeled even if the owner-program lookup is rate-limited.
function pumpBondingCurve(mint: string): string | null {
  try {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()],
      new PublicKey(PUMP_PROGRAM_ID),
    );
    return pda.toBase58();
  } catch {
    return null;
  }
}

// Some lockers (notably Streamflow on Token-2022) hold tokens in an escrow token
// account whose authority is ITSELF — a self-owned PDA. The token program owns every
// token account, so the owner-program hop can never reveal the locker. The reliable
// signal is the account's CREATION transaction: the program that initialized the
// escrow. Bounded — only called for the handful of self-owned escrows per token.
async function identifyEscrowProgram(account: string): Promise<AccountLabel | null> {
  try {
    const sigs = await rpcCall("getSignaturesForAddress", [account, { limit: 1000 }]);
    if (!Array.isArray(sigs) || sigs.length === 0) return null;
    const oldest = sigs[sigs.length - 1]?.signature;
    if (!oldest) return null;
    const tx = await rpcCall("getTransaction", [
      oldest,
      { maxSupportedTransactionVersion: 0, encoding: "jsonParsed" },
    ]);
    const programs = new Set<string>();
    const ixs = tx?.transaction?.message?.instructions || [];
    for (const ix of ixs) if (ix?.programId) programs.add(ix.programId);
    for (const l of tx?.meta?.logMessages || []) {
      const m = /Program (\w+) invoke/.exec(l);
      if (m) programs.add(m[1]);
    }
    for (const p of programs) {
      const pc = PROGRAM_CATEGORY[p];
      if (pc && pc.category === "locker") return { category: "locker", label: pc.label };
    }
    return null;
  } catch {
    return null;
  }
}

// Resolve each address to a category. Cheap: known maps + a single
// getMultipleAccounts batch (≤100/call) reading each account's owner program.
export async function classifyAccounts(
  mint: string,
  addresses: string[],
): Promise<Map<string, AccountLabel>> {
  const out = new Map<string, AccountLabel>();
  const bondingCurve = pumpBondingCurve(mint);

  for (const a of addresses) {
    if (out.has(a)) continue;
    if (BURN_ADDRESSES.has(a)) {
      out.set(a, { category: "burn", label: "Burn Address" });
      continue;
    }
    if (bondingCurve && a === bondingCurve) {
      out.set(a, { category: "liquidity", label: "Pump.fun Bonding Curve" });
      continue;
    }
    const k = KNOWN_WALLETS[a];
    if (k) {
      out.set(a, {
        category: k.type === "exchange" ? "cex" : k.type === "dex" ? "liquidity" : "person",
        label: k.label,
      });
    }
  }

  // classifyByOwnerProgram: given account addresses, read each account's owner
  // program via getMultipleAccounts and map to a category. Returns, for any
  // address that turned out to be an SPL/Token-2022 *token account*, the wallet
  // authority that owns it (bytes 32..64 of token-account data) so the caller can
  // resolve one more hop. This matters for the getTokenLargestAccounts fallback,
  // which hands us token-account addresses (owner = token program) rather than
  // the holder wallets the Helius path provides.
  const resolveOwners = async (
    targets: string[],
  ): Promise<Map<string, string>> => {
    const tokenAccountAuthority = new Map<string, string>();
    for (let i = 0; i < targets.length; i += 100) {
      const chunk = targets.slice(i, i + 100);
      let res: any;
      try {
        res = await rpcCall("getMultipleAccounts", [chunk, { encoding: "base64" }]);
      } catch {
        continue;
      }
      const vals: any[] = res?.value || [];
      chunk.forEach((addr, j) => {
        const acc = vals[j];
        if (!acc) return; // uninitialized — treat as person below
        const owner = acc.owner as string;
        if (owner === TOKEN_PROGRAM_ID || owner === TOKEN_2022_PROGRAM_ID) {
          // This is a token account, not a wallet. Extract its authority so we
          // can classify the wallet/program that actually controls the balance.
          try {
            const raw = Buffer.from(acc.data?.[0] || "", "base64");
            if (raw.length >= 64) {
              const authority = new PublicKey(raw.subarray(32, 64)).toBase58();
              tokenAccountAuthority.set(addr, authority);
            }
          } catch {}
          return;
        }
        const pc = PROGRAM_CATEGORY[owner];
        if (pc) {
          out.set(addr, { category: pc.category, label: pc.label });
          return;
        }
        const ko = KNOWN_WALLETS[owner];
        if (ko && ko.type === "dex") {
          out.set(addr, { category: "liquidity", label: ko.label });
        }
      });
    }
    return tokenAccountAuthority;
  };

  const unresolved = addresses.filter((a) => !out.has(a));
  const tokenAccountAuthority = await resolveOwners(unresolved);

  // Second hop: for token accounts, classify by their authority. First try the
  // known maps (bonding curve / burn / CEX / DEX), then read the authority's
  // owner program.
  const authorityToAccounts = new Map<string, string[]>();
  for (const [acct, authority] of tokenAccountAuthority) {
    if (BURN_ADDRESSES.has(authority)) {
      out.set(acct, { category: "burn", label: "Burn Address" });
      continue;
    }
    if (bondingCurve && authority === bondingCurve) {
      out.set(acct, { category: "liquidity", label: "Pump.fun Bonding Curve" });
      continue;
    }
    const k = KNOWN_WALLETS[authority];
    if (k) {
      out.set(acct, {
        category: k.type === "exchange" ? "cex" : k.type === "dex" ? "liquidity" : "person",
        label: k.label,
      });
      continue;
    }
    const list = authorityToAccounts.get(authority) || [];
    list.push(acct);
    authorityToAccounts.set(authority, list);
  }

  if (authorityToAccounts.size > 0) {
    const authorities = Array.from(authorityToAccounts.keys());
    const authOut = new Map<string, AccountLabel>();
    // Temporarily classify authorities into a side map by reusing the same
    // owner-program lookup (authorities are wallets/PDAs, never token accounts).
    for (let i = 0; i < authorities.length; i += 100) {
      const chunk = authorities.slice(i, i + 100);
      let res: any;
      try {
        res = await rpcCall("getMultipleAccounts", [chunk, { encoding: "base64" }]);
      } catch {
        continue;
      }
      const vals: any[] = res?.value || [];
      chunk.forEach((authority, j) => {
        const acc = vals[j];
        if (!acc) return;
        const owner = acc.owner as string;
        const pc = PROGRAM_CATEGORY[owner];
        if (pc) {
          authOut.set(authority, { category: pc.category, label: pc.label });
          return;
        }
        const ko = KNOWN_WALLETS[owner];
        if (ko && ko.type === "dex") {
          authOut.set(authority, { category: "liquidity", label: ko.label });
        }
      });
    }
    for (const [authority, accts] of authorityToAccounts) {
      const lab = authOut.get(authority);
      if (lab) for (const acct of accts) out.set(acct, lab);
    }
  }

  // Self-owned token accounts (authority === account) are program-controlled escrows,
  // never a person's wallet. This is how Streamflow Token-2022 locks appear. Confirm
  // the locker via the creation transaction (bounded to a few accounts, low concurrency).
  const selfOwnedEscrows = Array.from(tokenAccountAuthority.entries())
    .filter(([acct, authority]) => acct === authority && !out.has(acct))
    .map(([acct]) => acct)
    .slice(0, 8);
  for (let i = 0; i < selfOwnedEscrows.length; i += 3) {
    const batch = selfOwnedEscrows.slice(i, i + 3);
    const labs = await Promise.all(batch.map((a) => identifyEscrowProgram(a)));
    batch.forEach((a, j) => {
      // A self-owned token account is program-controlled — never a person's whale.
      // If we can't confirm the specific locker (e.g. RPC failure), still keep it out
      // of person concentration with a clearly-unverified escrow label rather than
      // letting it fall through to "person" and re-inflate concentration risk.
      out.set(a, labs[j] || { category: "locker", label: "Program Escrow (unverified)" });
    });
  }

  for (const a of addresses) {
    if (!out.has(a)) out.set(a, { category: "person", label: null });
  }
  return out;
}

function extractTokenAddress(query: string): string {
  const pumpFunMatch = query.match(/pump\.fun\/(?:coin\/)?([A-Za-z0-9]{32,50})/);
  if (pumpFunMatch) return pumpFunMatch[1];

  const solscanMatch = query.match(/solscan\.io\/token\/([A-Za-z0-9]{32,50})/);
  if (solscanMatch) return solscanMatch[1];

  const cleaned = query.trim();
  if (/^[A-HJ-NP-Za-km-z1-9]{32,50}$/.test(cleaned)) {
    return cleaned;
  }

  throw new Error("Could not find a valid Solana token address. Please paste a Pump.fun link or token contract address.");
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${label} took longer than ${ms}ms`)), ms)
    ),
  ]);
}

async function rpcCall(
  method: string,
  params: any[],
  options?: { timeoutMs?: number; maxAttempts?: number },
): Promise<any> {
  const maxRetries = options?.maxAttempts ?? 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const perRequestTimeout = options?.timeoutMs ?? (HELIUS_KEY ? 15000 : 8000);
      const timeoutId = setTimeout(() => controller.abort(), perRequestTimeout);

      const res = await rpcFetchWithFallback(RPC_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(options?.timeoutMs ? { "x-rpc-timeout-ms": String(options.timeoutMs) } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.status === 429) {
        if (attempt < maxRetries - 1) {
          const wait = 2000 * (attempt + 1);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        throw new Error("RATE_LIMITED");
      }

      const data = await res.json();
      if (data.error) {
        if (data.error.code === 429 || (data.error.message && data.error.message.includes("Too many"))) {
          if (attempt < maxRetries - 1) {
            const wait = 2000 * (attempt + 1);
            await new Promise((r) => setTimeout(r, wait));
            continue;
          }
          throw new Error("RATE_LIMITED");
        }
        throw new Error(data.error.message || "RPC error");
      }
      return data.result;
    } catch (err: any) {
      if (err.name === "AbortError") {
        if (attempt < maxRetries - 1) continue;
        throw new Error("RATE_LIMITED");
      }
      if (err.message === "RATE_LIMITED") {
        if (attempt < maxRetries - 1) {
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
      }
      if (attempt === maxRetries - 1) throw err;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw new Error("Max retries exceeded");
}

async function getTokenMetadata(mintAddress: string): Promise<{ name: string; symbol: string; creator: string; image: string }> {
  const fallback = {
    name: "",
    symbol: "",
    creator: "",
    image: "",
  };

  if (HELIUS_KEY) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getAsset",
          params: { id: mintAddress },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (data.result) {
        const r = data.result;
        const content = r.content || {};
        const metadata = content.metadata || {};
        const links = content.links || {};
        const authorities = r.authorities || [];
        const creators = r.creators || [];
        const heliusCreator = creators.length > 0 ? creators[0].address : (authorities.length > 0 ? authorities[0].address : "");
        fallback.name = metadata.name || "";
        fallback.symbol = metadata.symbol || "";
        fallback.image = links.image || content.json_uri || "";
        fallback.creator = heliusCreator;
      }
    } catch (err: any) {
      console.log("Helius getAsset failed, trying fallback:", err?.message);
    }
  }

  if (!fallback.creator) {
    try {
      const accountInfo = await rpcCall("getAccountInfo", [
        mintAddress,
        { encoding: "jsonParsed" },
      ]);
      if (accountInfo?.value?.data?.parsed?.info) {
        const info = accountInfo.value.data.parsed.info;
        fallback.creator = info.mintAuthority || info.freezeAuthority || "";
      }
    } catch (err: any) {
      console.log("Mint account info fallback failed:", err?.message);
    }
  }

  if (!fallback.creator) {
    try {
      const controller2 = new AbortController();
      const timeoutId2 = setTimeout(() => controller2.abort(), 8000);
      const pumpRes = await fetch(`https://frontend-api-v3.pump.fun/coins/${mintAddress}`, {
        signal: controller2.signal,
      });
      clearTimeout(timeoutId2);
      if (pumpRes.ok) {
        const pumpData = await pumpRes.json();
        if (pumpData.creator) {
          fallback.creator = pumpData.creator;
          if (!fallback.name && pumpData.name) fallback.name = pumpData.name;
          if (!fallback.symbol && pumpData.symbol) fallback.symbol = pumpData.symbol;
          if (!fallback.image && pumpData.image_uri) fallback.image = pumpData.image_uri;
        }
      }
    } catch (err: any) {
      console.log("Pump.fun API creator lookup failed:", err?.message);
    }
  }

  return fallback;
}

async function getTokenInfo(mintAddress: string) {
  let supply: any;
  try {
    supply = await rpcCall("getTokenSupply", [mintAddress]);
  } catch (err: any) {
    if (err?.message === "RATE_LIMITED" || err?.message?.includes("429")) {
      throw new Error("The Solana network is busy right now. Please try again in a few seconds.");
    }
    throw new Error("Could not fetch token info. The token address may be invalid or the token may not exist.");
  }

  let holders: { address: string; amount: number }[] = [];
  const decimals = supply.value?.decimals || 0;
  // True when we could only get holders from the unsorted Helius fallback AND it
  // hit its page limit — i.e. we're looking at an arbitrary truncated slice that
  // can miss whales/pools. Callers force the scan to low-confidence so we never
  // emit a confident verdict on a low-quality holder sample.
  let holdersLowConfidence = false;

  // Primary: getTokenLargestAccounts returns the 20 LARGEST accounts by balance —
  // exactly what concentration / liquidity-pool / burn detection depends on. The
  // Helius getTokenAccounts endpoint does NOT sort by balance, so a limit:50 page
  // is 50 arbitrary (usually dust) accounts that silently miss the AMM pool and
  // whales on any token with >50 holders — that was the root of the "everything
  // reads 0%" bug on established / graduated tokens.
  try {
    if (!HELIUS_KEY) await new Promise((r) => setTimeout(r, 1500));
    const largest = await rpcCall("getTokenLargestAccounts", [mintAddress]);
    const accts = largest?.value || [];
    if (accts.length > 0) {
      // Second hop: getTokenLargestAccounts returns TOKEN-ACCOUNT addresses, but
      // every downstream step (classification, clustering, money-flow) needs the
      // OWNER authority so pools / lockers / people resolve to the right category.
      const taAddrs = accts.map((a: any) => a.address);
      const ownerOf: Record<string, string> = {};
      try {
        const info = await rpcCall("getMultipleAccounts", [taAddrs, { encoding: "jsonParsed" }]);
        (info?.value || []).forEach((acc: any, i: number) => {
          const owner = acc?.data?.parsed?.info?.owner;
          if (owner) ownerOf[taAddrs[i]] = owner;
        });
      } catch (err: any) {
        console.log("owner-resolution hop failed:", err?.message);
      }
      holders = accts
        .map((a: any) => ({
          address: ownerOf[a.address] || a.address,
          amount: a.uiAmount ?? Number(a.amount || 0) / Math.pow(10, decimals),
        }))
        .filter((h: { amount: number }) => h.amount > 0);
      holders.sort((a, b) => b.amount - a.amount);
    }
  } catch (err: any) {
    console.log("getTokenLargestAccounts failed, falling back:", err?.message);
  }

  // Fallback: Helius getTokenAccounts page (unsorted, but better than nothing if
  // largestAccounts is unavailable / rate-limited).
  if (holders.length === 0 && HELIUS_KEY) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTokenAccounts",
          params: {
            mint: mintAddress,
            limit: 50,
            options: { showZeroBalance: false },
          },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      const accts = data.result?.token_accounts || [];
      if (accts.length > 0) {
        holders = accts.map((acc: any) => ({
          address: acc.owner || acc.address,
          amount: (acc.amount || 0) / Math.pow(10, decimals),
        }));
        holders.sort((a, b) => b.amount - a.amount);
        // Only flag low-confidence when the page was truncated. If fewer than the
        // limit came back, this IS the complete holder set (small token) and,
        // now sorted, it's just as trustworthy as getTokenLargestAccounts.
        if (accts.length >= 50) holdersLowConfidence = true;
      }
    } catch (err: any) {
      console.log("Helius getTokenAccounts fallback failed:", err?.message);
    }
  }

  // Consolidate by resolved owner: one wallet can hold across multiple token
  // accounts. Without summing, a whale split across two accounts understates the
  // headline top-holder concentration (and can hide a majority holder entirely).
  if (holders.length > 0) {
    const byOwner = new Map<string, number>();
    for (const h of holders) byOwner.set(h.address, (byOwner.get(h.address) || 0) + h.amount);
    holders = Array.from(byOwner, ([address, amount]) => ({ address, amount }));
    holders.sort((a, b) => b.amount - a.amount);
  }

  return {
    supply: supply.value.uiAmount || 0,
    decimals: supply.value.decimals,
    holders,
    holdersLowConfidence,
  };
}

// ---- Wallet-cluster detection (bubble map) ----------------------------------
// We approximate "linked wallets that move together" by their FIRST SOL funder.
// pump.fun snipers/bundlers are almost always funded from a single source
// wallet, so top holders that share a funder are very likely one operator.
// This is an APPROXIMATION: accurate for freshly-launched tokens (new wallets
// with short histories) and degrades for established tokens whose holders have
// long, noisy histories. Cost is bounded (top N holders, capped paging,
// bounded concurrency) and results are cached per mint.

export type WalletClusterMember = {
  address: string;
  percent: number; // precise (2dp), NOT the rounded-to-int holder percent
  funder: string | null;
  label?: string | null;
  category?: AccountCategory;
};

export type WalletCluster = {
  funder: string;
  members: WalletClusterMember[];
  totalPercent: number;
};

export type WalletClusterResult = {
  mint: string;
  analyzed: number; // holders whose funder we resolved
  totalHolders: number;
  clusters: WalletCluster[]; // groups of >=2 holders sharing a funder
  singles: WalletClusterMember[]; // holders with no shared funder
  largestClusterPercent: number;
  note: string;
  generatedAt: number;
};

const clusterCache = new Map<string, { at: number; data: WalletClusterResult }>();
const CLUSTER_TTL_MS = 5 * 60 * 1000;

async function getWalletFunder(address: string): Promise<string | null> {
  // Page back to the oldest signatures (cap 2 pages = 2000 sigs) — for a fresh
  // wallet its very first transaction is its funding tx.
  let before: string | undefined;
  let oldest: any[] = [];
  for (let page = 0; page < 2; page++) {
    const params: any[] = [address, { limit: 1000 }];
    if (before) params[1].before = before;
    let sigs: any[];
    try {
      sigs = await rpcCall("getSignaturesForAddress", params);
    } catch {
      return null;
    }
    if (!sigs || sigs.length === 0) break;
    oldest = sigs;
    before = sigs[sigs.length - 1].signature;
    if (sigs.length < 1000) break;
  }
  if (oldest.length === 0) return null;

  const firstSig = oldest[oldest.length - 1].signature;
  let tx: any;
  try {
    tx = await rpcCall("getTransaction", [
      firstSig,
      { maxSupportedTransactionVersion: 0, encoding: "jsonParsed" },
    ]);
  } catch {
    return null;
  }
  if (!tx) return null;

  // Prefer an explicit System transfer whose destination is our address.
  const instrs: any[] = tx.transaction?.message?.instructions || [];
  const inner: any[] = (tx.meta?.innerInstructions || []).flatMap(
    (g: any) => g.instructions || [],
  );
  for (const ix of [...instrs, ...inner]) {
    const p = ix?.parsed;
    if (p && p.type === "transfer" && ix.program === "system") {
      const i = p.info || {};
      if (i.destination === address && i.source && i.source !== address) {
        return i.source as string;
      }
    }
  }

  // Fallback: balance-delta — the account (not ours) that lost the most SOL
  // while ours gained is the likely funder.
  try {
    const keys: any[] = tx.transaction?.message?.accountKeys || [];
    const pre: number[] = tx.meta?.preBalances || [];
    const post: number[] = tx.meta?.postBalances || [];
    const names = keys.map((k: any) => (typeof k === "string" ? k : k.pubkey));
    const myIdx = names.indexOf(address);
    if (myIdx >= 0 && (post[myIdx] || 0) > (pre[myIdx] || 0)) {
      let best: { addr: string; drop: number } | null = null;
      for (let i = 0; i < names.length; i++) {
        if (names[i] === address) continue;
        const drop = (pre[i] || 0) - (post[i] || 0);
        if (drop > 0 && (!best || drop > best.drop)) best = { addr: names[i], drop };
      }
      if (best) return best.addr;
    }
  } catch {}

  return null;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await fn(items[cur]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

export async function detectWalletClusters(
  mintAddress: string,
): Promise<WalletClusterResult> {
  const cached = clusterCache.get(mintAddress);
  if (cached && Date.now() - cached.at < CLUSTER_TTL_MS) return cached.data;

  const info = await getTokenInfo(mintAddress);
  const supply = info.supply || 0;
  const topAll = info.holders.slice(0, 25);
  const pct = (amt: number) => (supply > 0 ? (amt / supply) * 100 : 0);

  // Exclude liquidity pools / lockers / burns — they are not coordinated snipers,
  // and bundling them produced fake "Cluster A controls 90%" results.
  let clsLabels = new Map<string, AccountLabel>();
  try {
    clsLabels = await classifyAccounts(mintAddress, topAll.map((h) => h.address));
  } catch {}
  const top = topAll.filter((h) => {
    const cat = clsLabels.get(h.address)?.category ?? "person";
    return cat === "person" || cat === "cex";
  });

  const members = await mapWithConcurrency(top, 5, async (h) => {
    const funder = await getWalletFunder(h.address);
    const lab = clsLabels.get(h.address);
    return {
      address: h.address,
      percent: Math.round(pct(h.amount) * 100) / 100,
      funder,
      label: lab?.label ?? null,
      category: lab?.category ?? "person",
    } as WalletClusterMember;
  });

  const analyzed = members.filter((m) => m.funder).length;
  const groups = new Map<string, WalletClusterMember[]>();
  for (const m of members) {
    if (!m.funder) continue;
    const arr = groups.get(m.funder) || [];
    arr.push(m);
    groups.set(m.funder, arr);
  }

  const clusters: WalletCluster[] = [];
  Array.from(groups.entries()).forEach(([funder, mem]) => {
    if (mem.length < 2) return;
    const totalPercent =
      Math.round(mem.reduce((s: number, x: WalletClusterMember) => s + x.percent, 0) * 100) / 100;
    clusters.push({ funder, members: mem, totalPercent });
  });
  clusters.sort((a, b) => b.totalPercent - a.totalPercent);

  const clusteredAddrs = new Set(
    clusters.flatMap((c) => c.members.map((m) => m.address)),
  );
  const singles = members.filter((m) => !clusteredAddrs.has(m.address));

  const largestClusterPercent = clusters.length > 0 ? clusters[0].totalPercent : 0;
  const note =
    analyzed === 0
      ? "Couldn't resolve funding sources right now (RPC limited, or these holders have long transaction histories). Linkage unavailable for this token."
      : "Wallets are grouped by their first SOL funder — a strong signal for bundles/snipers run by a single operator. Accurate for fresh launches; approximate for older tokens.";

  const data: WalletClusterResult = {
    mint: mintAddress,
    analyzed,
    totalHolders: info.holders.length,
    clusters,
    singles,
    largestClusterPercent,
    note,
    generatedAt: Date.now(),
  };
  clusterCache.set(mintAddress, { at: Date.now(), data });
  return data;
}

// Earliest pair-creation time (ms) DexScreener has seen for this mint across all
// its Solana pairs. Single fast call, and it carries time-of-day. For a migrated
// token this can be the later pool, so callers cross-check it against the on-chain
// first transaction and keep whichever is EARLIER.
async function getDexPairCreatedAt(mint: string): Promise<number | null> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
      signal: controller.signal,
    });
    clearTimeout(t);
    const data = await res.json();
    const pairs = (data?.pairs || []).filter((p: any) => p.chainId === "solana");
    let earliest: number | null = null;
    for (const p of pairs) {
      const c = Number(p?.pairCreatedAt);
      if (Number.isFinite(c) && c > 0) earliest = earliest === null ? c : Math.min(earliest, c);
    }
    return earliest;
  } catch {
    return null;
  }
}

// Returns the token's launch/first-activity time with full time-of-day precision.
// On-chain: pages back through signatures to the OLDEST transaction (the mint
// creation = the true launch). Robustness fixes over the old version:
//   - keeps the earliest *valid* blockTime (a null blockTime never wipes it),
//   - pages up to 10k sigs instead of 5k.
// If the token is busier than the page cap, the on-chain value is only a recent
// lower bound, so we also read DexScreener's pairCreatedAt and take the EARLIER of
// the two — which self-corrects popular tokens that used to report a too-recent date.
async function getTokenLaunchInfo(
  address: string,
): Promise<{ date: string; timestamp: number } | null> {
  let onChainMs: number | null = null;
  try {
    let lastSig: string | undefined;
    let oldestValid: number | null = null;
    for (let i = 0; i < 10; i++) {
      const params: any = [address, { limit: 1000 }];
      if (lastSig) params[1].before = lastSig;
      const sigs = await rpcCall("getSignaturesForAddress", params);
      if (!sigs || sigs.length === 0) break;
      for (let j = sigs.length - 1; j >= 0; j--) {
        const bt = sigs[j].blockTime;
        if (bt) {
          oldestValid = oldestValid === null ? bt : Math.min(oldestValid, bt);
          break;
        }
      }
      lastSig = sigs[sigs.length - 1].signature;
      if (sigs.length < 1000) break;
    }
    if (oldestValid) onChainMs = oldestValid * 1000;
  } catch {}

  const dexMs = await getDexPairCreatedAt(address);

  // Reject implausible candidates before taking the earliest, so a garbage value
  // (e.g. a 0/epoch or pre-Solana timestamp from a noisy indexer) can't win min()
  // and report a wildly wrong "launched years ago" date.
  const MIN_PLAUSIBLE_MS = Date.UTC(2020, 0, 1); // Solana mainnet-beta era
  const MAX_PLAUSIBLE_MS = Date.now() + 24 * 60 * 60 * 1000;
  const candidates = [onChainMs, dexMs].filter(
    (x): x is number => typeof x === "number" && x >= MIN_PLAUSIBLE_MS && x <= MAX_PLAUSIBLE_MS,
  );
  if (candidates.length === 0) return null;
  const ts = Math.min(...candidates);
  return { date: new Date(ts).toISOString().split("T")[0], timestamp: ts };
}

async function getRecentSignatures(address: string, limit = 10) {
  try {
    const sigs = await rpcCall("getSignaturesForAddress", [
      address,
      { limit },
    ]);
    return sigs || [];
  } catch {
    return [];
  }
}

function analyzeMoneyFlow(
  holders: { address: string; amount: number }[],
  totalSupply: number,
) {
  if (totalSupply === 0 || holders.length === 0) {
    return {
      topHolderPercent: 0,
      reinvestedPercent: 0,
      movedElsewherePercent: 0,
      dataIncomplete: holders.length === 0,
    };
  }

  const topHolder = holders[0];
  const topHolderPercent = Math.round((topHolder.amount / totalSupply) * 100);

  const totalHeld = holders.reduce((sum, h) => sum + h.amount, 0);
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
  topHolderPercent: number,
  reinvestedPercent: number,
  dataIncomplete: boolean,
): { rating: "green" | "yellow" | "red" | null; explanation: string } {
  if (dataIncomplete) {
    return {
      rating: null,
      explanation:
        "We couldn't load full holder data right now. The token exists on Solana, but we need more data to give a rating. Try scanning again in a moment.",
    };
  }

  const keptAndReinvested = topHolderPercent + reinvestedPercent;

  if (keptAndReinvested >= 50) {
    return {
      rating: "green",
      explanation:
        "A large share of the supply sits in liquidity or a few top wallets. For a new pump.fun token this usually means it's still on the bonding curve; otherwise it can signal strong holders or centralization — worth watching.",
    };
  }

  if (keptAndReinvested >= 25) {
    return {
      rating: "yellow",
      explanation:
        "The supply is somewhat spread out. Mixed signals — some concentration but not extreme.",
    };
  }

  return {
    rating: "red",
    explanation:
      "The supply is widely distributed with small top holders. This could be natural or could mean early wallets have sold.",
  };
}

// Below this much SOL back in the same tx, a token-out is treated as an airdrop /
// distribution rather than a sale (covers dust + ATA-rent noise, not real proceeds).
const SELL_SOL_DUST = 0.005;

async function getCreatorFeeData(creatorAddress: string, tokenMint: string): Promise<CreatorFeeInfo | null> {
  if (!HELIUS_KEY || !creatorAddress) return null;

  const result: CreatorFeeInfo = {
    totalSolReceived: 0,
    totalSolSent: 0,
    totalTokensSold: 0,
    tokenSellTransactions: [],
    totalTokensDistributed: 0,
    distributionRecipientCount: 0,
    distributionTransactions: [],
    distributionDestinations: [],
    distributionClassificationDegraded: false,
    solDestinations: [],
    creatorCurrentSolBalance: null,
    feeWallets: [],
    tradingFeesTotal: 0,
    creatorActivity: [],
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const url = `https://api-mainnet.helius-rpc.com/v0/addresses/${creatorAddress}/transactions?api-key=${HELIUS_KEY}&limit=50`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.log("Helius enhanced tx API failed:", res.status);
      return null;
    }

    const transactions: any[] = await res.json();
    const destMap = new Map<string, number>();
    const feeMap = new Map<string, number>();
    const distributionRecipients = new Set<string>();
    const distributionAmounts = new Map<string, number>(); // recipient -> tokens received via airdrop

    for (const tx of transactions) {
      const timestamp = tx.timestamp || 0;
      const sig = tx.signature || "";
      const desc = tx.description || "";
      const txType = tx.type || "UNKNOWN";

      const nativeTransfers = tx.nativeTransfers || [];
      for (const nt of nativeTransfers) {
        const amount = (nt.amount || 0) / 1e9;
        if (nt.toUserAccount === creatorAddress) {
          result.totalSolReceived += amount;
          if (nt.fromUserAccount) {
            feeMap.set(nt.fromUserAccount, (feeMap.get(nt.fromUserAccount) || 0) + amount);
          }
        }
        if (nt.fromUserAccount === creatorAddress && nt.toUserAccount) {
          result.totalSolSent += amount;
          destMap.set(nt.toUserAccount, (destMap.get(nt.toUserAccount) || 0) + amount);
        }
      }

      const tokenTransfers = tx.tokenTransfers || [];
      // Collect this tx's token-out: how much left the creator and to which wallets.
      let tokensOut = 0;
      const outRecipients = new Set<string>();
      const txRecipientAmounts = new Map<string, number>();
      for (const tt of tokenTransfers) {
        if (tt.fromUserAccount === creatorAddress && tt.mint === tokenMint) {
          tokensOut += tt.tokenAmount || 0;
          if (tt.toUserAccount) {
            outRecipients.add(tt.toUserAccount);
            txRecipientAmounts.set(tt.toUserAccount, (txRecipientAmounts.get(tt.toUserAccount) || 0) + (tt.tokenAmount || 0));
          }
        }
      }
      // SOL that came back to the creator in the SAME tx = sale proceeds. A real
      // sell returns SOL; an airdrop/distribution returns ~nothing.
      let sellSolAmount = 0;
      for (const nt of nativeTransfers) {
        if (nt.toUserAccount === creatorAddress) {
          sellSolAmount += (nt.amount || 0) / 1e9;
        }
      }
      const isSell = tokensOut > 0 && sellSolAmount > SELL_SOL_DUST;
      const isDistribution = tokensOut > 0 && !isSell;
      if (isSell) {
        result.totalTokensSold += tokensOut;
        result.tokenSellTransactions.push({
          signature: sig,
          solAmount: Math.round(sellSolAmount * 1000) / 1000,
          timestamp,
          description: desc || "Token sell",
        });
      } else if (isDistribution) {
        result.totalTokensDistributed += tokensOut;
        for (const r of outRecipients) distributionRecipients.add(r);
        for (const [r, amt] of txRecipientAmounts) {
          distributionAmounts.set(r, (distributionAmounts.get(r) || 0) + amt);
        }
        result.distributionTransactions.push({
          signature: sig,
          recipientCount: outRecipients.size,
          timestamp,
          description: desc || "Token distribution / airdrop",
        });
      }

      const solInvolved = nativeTransfers.reduce((sum: number, nt: any) => {
        if (nt.toUserAccount === creatorAddress) {
          return sum + (nt.amount || 0) / 1e9;
        }
        if (nt.fromUserAccount === creatorAddress) {
          return sum + (nt.amount || 0) / 1e9;
        }
        return sum;
      }, 0);

      if (solInvolved > 0 || tokenTransfers.some((tt: any) => tt.fromUserAccount === creatorAddress || tt.toUserAccount === creatorAddress)) {
        let actType = txType;
        if (isSell) actType = "SELL";
        else if (isDistribution) actType = "DISTRIBUTE";
        else if (tokenTransfers.some((tt: any) => tt.toUserAccount === creatorAddress && tt.mint === tokenMint)) actType = "BUY";
        else if (nativeTransfers.some((nt: any) => nt.fromUserAccount === creatorAddress)) actType = "SEND_SOL";
        else if (nativeTransfers.some((nt: any) => nt.toUserAccount === creatorAddress)) actType = "RECEIVE_SOL";

        result.creatorActivity.push({
          signature: sig,
          type: actType,
          description: desc || actType,
          solAmount: Math.round(solInvolved * 1000000) / 1000000,
          timestamp,
        });
      }
    }

    result.solDestinations = Array.from(destMap.entries())
      .map(([address, amount]) => {
        const known = labelWallet(address);
        return { address, amount: Math.round(amount * 1000000) / 1000000, label: known?.label || null, walletType: known?.type || null };
      })
      .filter(d => d.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);

    result.feeWallets = Array.from(feeMap.entries())
      .map(([address, totalReceived]) => {
        const known = labelWallet(address);
        return { address, totalReceived: Math.round(totalReceived * 1000000) / 1000000, label: known?.label || null, walletType: known?.type || null };
      })
      .filter(f => f.totalReceived > 0)
      .sort((a, b) => b.totalReceived - a.totalReceived)
      .slice(0, 10);

    result.totalSolReceived = Math.round(result.totalSolReceived * 1000000) / 1000000;
    result.totalSolSent = Math.round(result.totalSolSent * 1000000) / 1000000;
    result.tradingFeesTotal = Math.round(result.totalSolReceived * 1000000) / 1000000;

    result.creatorActivity.sort((a, b) => b.timestamp - a.timestamp);
    result.creatorActivity = result.creatorActivity.slice(0, 20);
    result.tokenSellTransactions.sort((a, b) => b.timestamp - a.timestamp);

    result.distributionRecipientCount = distributionRecipients.size;
    result.distributionTransactions.sort((a, b) => b.timestamp - a.timestamp);
    result.distributionTransactions = result.distributionTransactions.slice(0, 10);

    // Classify WHERE the airdropped tokens went (top recipients by amount, one
    // bounded RPC call). A recipient can be: a burn address, a token contract /
    // mint address (tokens sent there can never be sold by anyone), a liquidity
    // pool, a locker, a program-controlled account, or a normal wallet.
    if (distributionAmounts.size > 0) {
      const topRecipients = Array.from(distributionAmounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20);
      try {
        const SYSTEM_PROGRAM = "11111111111111111111111111111111";
        const accounts = await rpcCall("getMultipleAccounts", [
          topRecipients.map(([addr]) => addr),
          { encoding: "base64" },
        ]);
        const infos: any[] = accounts?.value || [];
        result.distributionDestinations = topRecipients.map(([addr, amount], i) => {
          const info = infos[i];
          const known = labelWallet(addr);
          let category: CreatorFeeInfo["distributionDestinations"][number]["category"] = "wallet";
          let label: string | null = known?.label || null;
          if (BURN_ADDRESSES.has(addr)) {
            // Only the incinerator gets permanence language — provably gone.
            category = "burn"; label = label || "Burn address";
          } else if (info && PROGRAM_CATEGORY[info.owner]) {
            const pc = PROGRAM_CATEGORY[info.owner];
            category = pc.category; label = label || pc.label;
          } else if (info && (info.owner === TOKEN_PROGRAM_ID || info.owner === TOKEN_2022_PROGRAM_ID)) {
            // The recipient address IS itself a mint or token account. Tokens
            // parked under such an owner are effectively out of circulation
            // (these addresses normally can't sign), but it's NOT provably
            // unsellable — a keypair-created mint/token account could still
            // sign. Copy stays "effectively", never "never".
            const size = typeof info.space === "number"
              ? info.space
              : (Array.isArray(info.data) && info.data[0] ? Buffer.from(info.data[0], "base64").length : 0);
            category = "token_contract";
            label = label || (size === 82 ? "Token mint address — effectively out of circulation" : "Token contract address — effectively out of circulation");
          } else if (info?.executable) {
            // An executable account is a program (smart contract), not a token
            // sink — don't claim the tokens are locked/unsellable.
            category = "program"; label = label || "Smart contract (program)";
          } else if (info && info.owner !== SYSTEM_PROGRAM) {
            category = "program"; label = label || "Program-controlled account";
          }
          // info == null → never-funded address → fresh wallet (common for airdrops).
          return { address: addr, amount: Math.round(amount), category, label };
        });
      } catch (err: any) {
        console.log("Airdrop destination classification failed:", err?.message);
        result.distributionClassificationDegraded = true;
      }
    }

  } catch (err: any) {
    console.log("Creator fee data fetch failed:", err?.message);
    return null;
  }

  try {
    const balance = await rpcCall("getBalance", [creatorAddress]);
    if (balance?.value != null) {
      result.creatorCurrentSolBalance = Math.round((balance.value / 1e9) * 1000) / 1000;
    }
  } catch {
  }

  return result;
}

let cachedSolPrice: { price: number; timestamp: number } | null = null;

export async function getSolPriceUsd(): Promise<number | null> {
  if (cachedSolPrice && Date.now() - cachedSolPrice.timestamp < 60000) {
    return cachedSolPrice.price;
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      if (data?.solana?.usd) {
        cachedSolPrice = { price: data.solana.usd, timestamp: Date.now() };
        return data.solana.usd;
      }
    }
  } catch (err: any) {
    console.log("SOL price fetch failed:", err?.message);
  }
  return cachedSolPrice?.price || null;
}

export interface WalletSearchResult {
  walletAddress: string;
  solBalance: number;
  solPriceUsd: number | null;
  tokenHoldings: {
    mintAddress: string;
    name: string;
    symbol: string;
    image: string;
    balance: number;
    decimals: number;
  }[];
}

export async function searchWallet(address: string): Promise<WalletSearchResult> {
  const cleaned = address.trim();
  if (!/^[A-HJ-NP-Za-km-z1-9]{32,50}$/.test(cleaned)) {
    throw new Error("Please enter a valid Solana wallet address.");
  }

  let solBalance = 0;
  try {
    const balResult = await rpcCall("getBalance", [cleaned]);
    solBalance = (balResult?.value || 0) / 1e9;
  } catch {}

  let tokenHoldings: WalletSearchResult["tokenHoldings"] = [];

  if (HELIUS_KEY) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getAssetsByOwner",
          params: {
            ownerAddress: cleaned,
            page: 1,
            limit: 100,
            displayOptions: { showFungible: true, showNativeBalance: false },
          },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (data.result?.items) {
        for (const item of data.result.items) {
          if (item.interface !== "FungibleToken" && item.interface !== "FungibleAsset") continue;
          const tokenInfo = item.token_info;
          if (!tokenInfo || !tokenInfo.balance || tokenInfo.balance === 0) continue;
          const content = item.content || {};
          const metadata = content.metadata || {};
          const links = content.links || {};
          const decimals = tokenInfo.decimals || 0;
          const rawBalance = tokenInfo.balance || 0;
          tokenHoldings.push({
            mintAddress: item.id,
            name: metadata.name || "Unknown Token",
            symbol: metadata.symbol || "",
            image: links.image || "",
            balance: rawBalance / Math.pow(10, decimals),
            decimals,
          });
        }
        tokenHoldings.sort((a, b) => b.balance - a.balance);
      }
    } catch (err: any) {
      console.log("Helius getAssetsByOwner failed:", err?.message);
    }
  } else {
    try {
      const tokenAccounts = await rpcCall("getTokenAccountsByOwner", [
        cleaned,
        { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
        { encoding: "jsonParsed" },
      ]);
      if (tokenAccounts?.value) {
        for (const acct of tokenAccounts.value) {
          const info = acct.account?.data?.parsed?.info;
          if (!info || !info.tokenAmount || info.tokenAmount.uiAmount === 0) continue;
          tokenHoldings.push({
            mintAddress: info.mint,
            name: "Unknown Token",
            symbol: "",
            image: "",
            balance: info.tokenAmount.uiAmount || 0,
            decimals: info.tokenAmount.decimals || 0,
          });
        }
        tokenHoldings.sort((a, b) => b.balance - a.balance);
      }
    } catch (err: any) {
      console.log("getTokenAccountsByOwner failed:", err?.message);
    }
  }

  let solPriceUsd: number | null = null;
  try { solPriceUsd = await getSolPriceUsd(); } catch {}

  return {
    walletAddress: cleaned,
    solBalance,
    solPriceUsd,
    tokenHoldings,
  };
}

// Real USD liquidity from DexScreener. For graduated tokens the % of supply in
// the pool is tiny, so pool depth in dollars is the honest liquidity signal.
// Best-effort: any failure returns null and the scanner falls back to supply-%.
async function getDexLiquidityUsd(mint: string): Promise<number | null> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
      signal: controller.signal,
    });
    clearTimeout(t);
    const data = await res.json();
    const pairs = (data?.pairs || []).filter((p: any) => p.chainId === "solana");
    if (pairs.length === 0) return null;
    const best = pairs.sort(
      (a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
    )[0];
    const usd = Number(best?.liquidity?.usd);
    return Number.isFinite(usd) ? usd : null;
  } catch {
    return null;
  }
}

export async function scanToken(query: string): Promise<ScanResult> {
  const tokenAddress = extractTokenAddress(query);

  const [tokenInfo, metadata] = await withTimeout(
    Promise.all([
      getTokenInfo(tokenAddress),
      getTokenMetadata(tokenAddress),
    ]),
    SCAN_TIMEOUT_MS,
    "token scan"
  ).catch((err) => {
    if (err.message.includes("Timeout")) {
      throw new Error("Scan took too long. The Solana network may be congested. Please try again.");
    }
    throw err;
  });

  const flow = analyzeMoneyFlow(tokenInfo.holders, tokenInfo.supply);
  const { dataIncomplete: flowDataIncomplete } = flow;

  // Classify the top holders so liquidity pools / lockers / burns aren't mistaken
  // for a person hoarding the supply (the whole point of accuracy here).
  const supply = tokenInfo.supply || 0;
  const pctOf = (amt: number) => (supply > 0 ? (amt / supply) * 100 : 0);
  const topRaw = tokenInfo.holders.slice(0, 50);
  let labels = new Map<string, AccountLabel>();
  try {
    labels = await classifyAccounts(tokenAddress, topRaw.map((h) => h.address));
  } catch (err: any) {
    console.log("classifyAccounts failed:", err?.message);
  }

  const topHolders = topRaw.map((h: { address: string; amount: number }) => {
    const lab = labels.get(h.address);
    return {
      address: h.address,
      percent: Math.round(pctOf(h.amount)),
      label: lab?.label ?? null,
      category: lab?.category ?? "person",
    };
  });

  // Buckets: liquidity (pool/curve/dex) and locked are EXPECTED/favorable; burns
  // are removed supply. Only "person"/"cex" wallets count toward concentration.
  let liquidityPercent = 0;
  let lockedPercent = 0;
  let burnedPercent = 0;
  const realHolders: { address: string; percent: number }[] = [];
  for (const h of topRaw) {
    const cat = labels.get(h.address)?.category ?? "person";
    const p = pctOf(h.amount);
    if (cat === "liquidity" || cat === "dex") liquidityPercent += p;
    else if (cat === "locker") lockedPercent += p;
    else if (cat === "burn") burnedPercent += p;
    else realHolders.push({ address: h.address, percent: p });
  }
  realHolders.sort((a, b) => b.percent - a.percent);

  const realTopHolderPercent = realHolders.length > 0 ? Math.round(realHolders[0].percent) : 0;
  const realTopHolders = realHolders.map((h) => ({ address: h.address, percent: Math.round(h.percent) }));

  // Same-day / still-bonding pump.fun tokens park most of their supply in the
  // bonding curve, which the holder enumeration usually doesn't surface. Read the
  // curve directly so liquidity isn't reported as 0% and the missing supply isn't
  // fabricated into a phantom "100% moved out". Skips graduated / non-pump tokens.
  let curveLiquidityPercent = 0;
  try {
    const curve = await fetchBondingCurve(new PublicKey(tokenAddress));
    if (curve && !curve.complete && curve.tokenTotalSupply > 0n) {
      curveLiquidityPercent = Math.max(
        0,
        Math.min(100, (Number(curve.realTokenReserves) / Number(curve.tokenTotalSupply)) * 100),
      );
    }
  } catch {
    // Not a pump.fun token, already graduated, or curve unreadable — leave at 0.
  }
  // Dedup: if the curve's account was already classified among the holders, don't
  // count it twice — take the larger of the two liquidity readings.
  if (curveLiquidityPercent > liquidityPercent) liquidityPercent = curveLiquidityPercent;

  const realHoldersSum = realHolders.reduce((s, h) => s + h.percent, 0);
  // Liquidity depth reflects real pool/curve supply. No fabricated fallback — an
  // undetectable pool honestly reads as 0% and is caught by the completeness guard.
  const reinvestedPercent = Math.round(liquidityPercent);
  const topHolderPercent = realTopHolderPercent;
  const topHolderAddress = realHolders.length > 0 ? realHolders[0].address : "";

  const holderBreakdown = {
    liquidityPercent: Math.round(liquidityPercent),
    lockedPercent: Math.round(lockedPercent),
    burnedPercent: Math.round(burnedPercent),
    realTopHolderPercent,
  };

  // "Moved elsewhere" = supply circulating outside a pool/curve, lock, or burn.
  // This is real distribution — NOT the old `100 − topHolder − guessed liquidity`
  // value that turned any well-spread (or unreadable) token into a phantom 100%
  // outflow.
  const movedElsewherePercent = Math.max(
    0,
    Math.min(100, Math.round(100 - liquidityPercent - lockedPercent - burnedPercent - realHoldersSum)),
  );

  // Data-completeness guard: we're only truly blind when the holder read FAILED —
  // i.e. we recovered no real holders AND no pool/lock/burn supply at all. A low
  // coverage sum on its own is NOT blindness: a widely-distributed token (e.g.
  // BONK) genuinely holds most of its supply in a long tail beyond the top ~20,
  // and that low top-holder concentration is the honest, favorable signal — not a
  // reason to suppress the verdict. Enumeration now uses getTokenLargestAccounts
  // (true largest-by-balance), so a small top holder means small, not unreadable.
  const holderReadFailed =
    realHolders.length === 0 &&
    liquidityPercent + lockedPercent + burnedPercent === 0;
  // A truncated unsorted fallback sample can miss whales/pools — never emit a
  // confident verdict on it. Fall to low confidence / no rating instead.
  const dataIncomplete =
    flowDataIncomplete || holderReadFailed || !!tokenInfo.holdersLowConfidence;

  const { explanation } = calculateRating(
    topHolderPercent,
    reinvestedPercent,
    dataIncomplete,
  );

  let recentTxs: ScanResult["recentTransactions"] = [];
  if (!dataIncomplete) {
    try {
      if (!HELIUS_KEY) await new Promise((r) => setTimeout(r, 1000));
      const signatures = await getRecentSignatures(tokenAddress, 10);
      recentTxs = signatures.slice(0, 10).map((sig: any) => ({
        signature: sig.signature,
        type: sig.memo ? "memo" : "transfer",
        amount: 0,
        timestamp: sig.blockTime || 0,
      }));
    } catch {
    }
  }

  const displayName = metadata.name || `Token ${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}`;
  const displaySymbol = metadata.symbol || "";

  let creatorFees: CreatorFeeInfo | null = null;
  if (metadata.creator) {
    try {
      creatorFees = await getCreatorFeeData(metadata.creator, tokenAddress);
    } catch (err: any) {
      console.log("Creator fee fetch failed:", err?.message);
    }
  }

  let solPriceUsd: number | null = null;
  try {
    solPriceUsd = await getSolPriceUsd();
  } catch {}

  let launchDate: string | null = null;
  let launchTimestamp: number | null = null;
  try {
    const info = await getTokenLaunchInfo(tokenAddress);
    if (info) {
      launchDate = info.date;
      launchTimestamp = info.timestamp;
    }
  } catch {}

  let liquidityUsd: number | null = null;
  try {
    liquidityUsd = await getDexLiquidityUsd(tokenAddress);
  } catch {}

  const risk = computeRiskAssessment(
    {
      topHolderPercent,
      reinvestedPercent,
      movedElsewherePercent,
      dataIncomplete,
      topHolders: realTopHolders,
      creatorAddress: metadata.creator || "",
      topHolderAddress,
      creatorFees,
      lockedPercent: holderBreakdown.lockedPercent,
      liquidityPoolPercent: holderBreakdown.liquidityPercent,
      burnedPercent: holderBreakdown.burnedPercent,
      liquidityUsd,
    },
    "solana",
  );

  // Traffic light must agree with the risk model. The old calculateRating mapped
  // "top holder + liquidity ≥ 50%" → green, which lit GREEN on a token where one
  // wallet holds the majority (concentration is a risk, not a safety signal) and
  // RED on healthily-distributed tokens. Derive the light from the risk band so
  // the headline light, the grade, and the flags can never contradict each other.
  const rating: "green" | "yellow" | "red" | null = dataIncomplete
    ? null
    : risk.band === "low"
      ? "green"
      : risk.band === "medium"
        ? "yellow"
        : "red";
  const ratingExplanation = dataIncomplete
    ? explanation
    : risk.band === "high"
      ? "High risk on the factors we can measure — see the breakdown below (concentration, liquidity, creator, or movement). Treat with caution."
      : risk.band === "medium"
        ? "Mixed signals — some elevated risk factors. Read the risk breakdown below before trusting it."
        : "Lower risk on the factors we can measure. Always do your own research.";

  // Live market sentiment (facts only, fail-soft). Reuses the swing bot's tape
  // reader: buy/sell pressure + recent moves from DexScreener, plus a
  // conservative chart-pattern read. Any failure → sentiment stays null and the
  // rest of the scan is unaffected.
  let sentiment: ScanSentiment | null = null;
  try {
    const st = await getTokenStats(tokenAddress);
    if (st) {
      let chart: ScanSentiment["chart"] = null;
      let chartDetail: string | null = null;
      if (st.pairAddress) {
        try {
          const read = readChart(await getCandles(st.pairAddress));
          if (read) {
            chart = read.blowoff
              ? "blowoff"
              : read.healthy
                ? "healthy"
                : read.accumulation
                  ? "accumulation"
                  : "mixed";
            chartDetail = read.detail;
          }
        } catch {}
      }
      const h1Lead = st.buysH1 - st.sellsH1;
      const pressure =
        h1Lead > 0
          ? `Buyers ahead of sellers in the last hour (${st.buysH1} buys vs ${st.sellsH1} sells)`
          : h1Lead < 0
            ? `Sellers ahead of buyers in the last hour (${st.sellsH1} sells vs ${st.buysH1} buys)`
            : `Buyers and sellers roughly even in the last hour`;
      const move =
        st.chgM5 >= 1
          ? `price up ${st.chgM5.toFixed(1)}% in the last 5 min`
          : st.chgM5 <= -1
            ? `price down ${Math.abs(st.chgM5).toFixed(1)}% in the last 5 min`
            : `price flat over the last 5 min`;
      sentiment = {
        available: true,
        buysH1: st.buysH1,
        sellsH1: st.sellsH1,
        buysM5: st.buysM5,
        sellsM5: st.sellsM5,
        chgM5: st.chgM5,
        chgH1: st.chgH1,
        chgH6: st.chgH6,
        chgH24: st.chgH24,
        volH1Usd: st.volH1Usd,
        volH1Known: st.volH1Known,
        chart,
        chartDetail,
        summary: `${pressure}; ${move}.`,
      };
    }
  } catch {}

  return {
    tokenAddress,
    tokenName: displayName,
    tokenSymbol: displaySymbol,
    creatorAddress: metadata.creator || "",
    tokenImage: metadata.image || "",
    topHolderAddress,
    totalSupply: tokenInfo.supply,
    topHolderPercent,
    reinvestedPercent,
    movedElsewherePercent,
    rating,
    ratingExplanation,
    dataIncomplete,
    topHolders,
    holderBreakdown,
    recentTransactions: recentTxs,
    creatorFees,
    solPriceUsd,
    launchDate,
    launchTimestamp,
    risk,
    sentiment,
  };
}
