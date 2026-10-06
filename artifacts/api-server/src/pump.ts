import { rpcFetchWithFallback } from "./rpc-fallback";
import {
  PublicKey,
  TransactionInstruction,
  AccountMeta,
  VersionedTransaction,
  TransactionMessage,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  AddressLookupTableAccount,
} from "@solana/web3.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const PUMP_PROGRAM_ID   = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const TOKEN_PROGRAM_ID  = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
// CRITICAL: this MUST be the canonical Associated Token Program ID. A typo
// here means (1) `getATA` derives the wrong PDA so the buy/sell instruction
// passes nonexistent ATA addresses, and (2) the CreateIdempotent ix invokes
// a program ID that doesn't exist → "Attempt to load program that does not exist".
// Phantom's simulator catches the failure and slaps an "unsafe" warning on
// the tx in manual signing mode. Verify against @solana/spl-token's
// ASSOCIATED_TOKEN_PROGRAM_ID before changing.
const ASSOC_TOKEN_PROG  = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
// SPL Token-2022 program. Newer pump.fun tokens (post-v2 launchpad) are
// minted under Token-2022 rather than SPL Token v1. The token_program slot
// in buy/sell, the ATA derivation seeds, and the CreateIdempotent inner
// invocation all need to match the actual mint's owner — detected at runtime.
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

// Pump.fun's new fee program — split out from the main pump program as part
// of their v2 upgrade. The fee_config PDA is owned by THIS program, not by
// the main pump program. Required in every buy/sell since the v2 IDL.
const PUMP_FEE_PROGRAM_ID = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");

// Anchor instruction discriminators (sha256("global:{name}")[0:8])
const BUY_DISC  = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
const SELL_DISC = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);

// Manual-builder kill switch. OPT-IN until trailing[0] remaining_account
// derivation is solved (see "Pump.fun trade-feed visibility" gotcha in replit.md).
// Build produces a valid v2 tx that passes account resolution but the pump
// program rejects with Anchor 6062 BuybackFeeRecipientMissing — meaning users
// would sign failing txs if this ran by default. Set PUMP_ENABLE_MANUAL=1 to
// re-enable for testing/dev (PumpPortal is the safe default in production).
const MANUAL_BUILDER_ENABLED = process.env.PUMP_ENABLE_MANUAL === "1";
if (MANUAL_BUILDER_ENABLED) {
  console.warn("[pump] ⚠ PUMP_ENABLE_MANUAL=1 — manual top-level pump.fun route ENABLED. " +
    "Known issue: trailing remaining_account[0] derivation unknown → on-chain Anchor 6062. " +
    "Users may sign txs that fail on-chain. Unset PUMP_ENABLE_MANUAL to restore safe default.");
} else {
  console.log("[pump] manual route disabled (default) — routing via PumpPortal");
}

const PUMP_FEE_BPS = 100n; // 1% — pump.fun bonding-curve fee (third party, deducted at swap)

// ─── PAIF platform fees (sent to DAO/treasury + creator wallet) ───────────────
// Fail-CLOSED config: invalid/missing vaults or BPS values throw at module load
// so a misconfigured server never builds fee-less trades. The whitepaper
// commits to "no swap executes without the platform fee" — this enforces it.
function parseBpsEnv(name: string, fallback: number): bigint {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return BigInt(fallback);
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 10000) {
    throw new Error(`[pump] ${name}="${raw}" is not a valid basis-point value (0-10000). Refusing to start.`);
  }
  return BigInt(Math.round(n));
}
function parseVaultEnv(name: string, required: boolean): PublicKey | null {
  const raw = process.env[name];
  if (!raw) {
    if (required) throw new Error(`[pump] ${name} env var is required but not set. Refusing to start.`);
    return null;
  }
  let pk: PublicKey;
  try {
    pk = new PublicKey(raw);
  } catch {
    throw new Error(`[pump] ${name}="${raw}" is not a valid Solana address. Refusing to start.`);
  }
  if (!PublicKey.isOnCurve(pk.toBuffer())) {
    // Off-curve addresses (token mints, PDAs) cannot sign or be safely treated
    // as a System wallet. Refusing prevents permanent loss of fee revenue.
    throw new Error(`[pump] ${name}="${raw}" is off-curve (likely a token mint or PDA). Refusing to start.`);
  }
  return pk;
}
const PAIF_FEE_BPS       = parseBpsEnv("PAIF_FEE_BPS", 300);     // default 3% DAO/treasury
const PAIF_CREATOR_BPS   = parseBpsEnv("PAIF_CREATOR_BPS", 100); // default 1% creator
// Sanity invariant: combined platform fee must leave the user with most of their
// trade. Cap at 20% (2000 bps) — well above the 4% target — to prevent a typo
// like PAIF_FEE_BPS=3000 (30%) from quietly draining users.
if (PAIF_FEE_BPS + PAIF_CREATOR_BPS > 2000n) {
  throw new Error(`[pump] PAIF_FEE_BPS+PAIF_CREATOR_BPS=${PAIF_FEE_BPS + PAIF_CREATOR_BPS} exceeds 2000 (20%) safety cap. Refusing to start.`);
}
// Vaults are required iff the corresponding BPS > 0. Fee-disabled deployments
// (BPS=0) do not need a vault address; non-zero BPS without a vault is a misconfig.
const PAIF_FEE_VAULT     = parseVaultEnv("PAIF_FEE_VAULT",     PAIF_FEE_BPS > 0n);
const PAIF_CREATOR_VAULT = parseVaultEnv("PAIF_CREATOR_VAULT", PAIF_CREATOR_BPS > 0n);

if (PAIF_FEE_VAULT)     console.log(`[pump] PAIF DAO fee active: ${Number(PAIF_FEE_BPS)/100}% → ${PAIF_FEE_VAULT.toBase58()}`);
else                    console.log(`[pump] PAIF DAO fee disabled (PAIF_FEE_BPS=0).`);
if (PAIF_CREATOR_VAULT) console.log(`[pump] PAIF creator fee active: ${Number(PAIF_CREATOR_BPS)/100}% → ${PAIF_CREATOR_VAULT.toBase58()}`);
else                    console.log(`[pump] PAIF creator fee disabled (PAIF_CREATOR_BPS=0).`);

export const PAIF_TOTAL_FEE_BPS = Number(PAIF_FEE_BPS + PAIF_CREATOR_BPS);

export interface PaifFeeBreakdown {
  daoBps: number;
  daoLamports: string;
  daoVault: string | null;
  creatorBps: number;
  creatorLamports: string;
  creatorVault: string | null;
  totalBps: number;
  totalLamports: string;
}

function computePaifFees(baseSolLamports: bigint): {
  transfers: { recipient: PublicKey; lamports: bigint }[];
  breakdown: PaifFeeBreakdown;
} {
  const daoLamports     = PAIF_FEE_VAULT     ? (baseSolLamports * PAIF_FEE_BPS) / 10000n     : 0n;
  const creatorLamports = PAIF_CREATOR_VAULT ? (baseSolLamports * PAIF_CREATOR_BPS) / 10000n : 0n;
  const transfers: { recipient: PublicKey; lamports: bigint }[] = [];
  if (PAIF_FEE_VAULT     && daoLamports     > 0n) transfers.push({ recipient: PAIF_FEE_VAULT,     lamports: daoLamports });
  if (PAIF_CREATOR_VAULT && creatorLamports > 0n) transfers.push({ recipient: PAIF_CREATOR_VAULT, lamports: creatorLamports });
  return {
    transfers,
    breakdown: {
      daoBps: Number(PAIF_FEE_BPS),
      daoLamports: daoLamports.toString(),
      daoVault: PAIF_FEE_VAULT?.toBase58() ?? null,
      creatorBps: Number(PAIF_CREATOR_BPS),
      creatorLamports: creatorLamports.toString(),
      creatorVault: PAIF_CREATOR_VAULT?.toBase58() ?? null,
      totalBps: Number(PAIF_FEE_BPS) + Number(PAIF_CREATOR_BPS),
      totalLamports: (daoLamports + creatorLamports).toString(),
    },
  };
}

// Append SystemProgram.transfer instructions to a base64-serialized v0
// VersionedTransaction (typically returned from PumpPortal). Decompiles the
// message, appends the fee transfers, recompiles. Throws (does NOT silently
// drop fees) if the original tx uses LUTs we can't resolve — better to fail the
// trade than to silently lose platform revenue.
async function injectFeeTransfers(
  b64Tx: string,
  payer: PublicKey,
  transfers: { recipient: PublicKey; lamports: bigint }[],
): Promise<string> {
  if (transfers.length === 0) return b64Tx;

  const vtx = VersionedTransaction.deserialize(Buffer.from(b64Tx, "base64"));

  let lookupTables: AddressLookupTableAccount[] = [];
  if (vtx.message.addressTableLookups && vtx.message.addressTableLookups.length > 0) {
    lookupTables = await Promise.all(
      vtx.message.addressTableLookups.map(async (l) => {
        const info = await rpc("getAccountInfo", [l.accountKey.toBase58(), { encoding: "base64" }]);
        if (!info?.value?.data) throw new Error(`Lookup table ${l.accountKey.toBase58()} not found`);
        const data = Buffer.from(info.value.data[0], "base64");
        return new AddressLookupTableAccount({
          key: l.accountKey,
          state: AddressLookupTableAccount.deserialize(data),
        });
      }),
    );
  }

  const message = TransactionMessage.decompile(vtx.message, { addressLookupTableAccounts: lookupTables });
  for (const t of transfers) {
    message.instructions.push(
      SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: t.recipient,
        lamports: Number(t.lamports),
      }),
    );
  }
  const newMsg = message.compileToV0Message(lookupTables);
  return Buffer.from(new VersionedTransaction(newMsg).serialize()).toString("base64");
}

// ─── RPC helper ───────────────────────────────────────────────────────────────
const HELIUS_KEY = process.env.HELIUS_API_KEY;
const RPC_URL = HELIUS_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`
  : "https://api.mainnet-beta.solana.com";

async function rpc(method: string, params: any[]): Promise<any> {
  const res = await rpcFetchWithFallback(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`RPC ${method}: ${json.error.message}`);
  return json.result;
}

// ─── PDA / ATA helpers ────────────────────────────────────────────────────────
function getBondingCurvePDA(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.toBuffer()],
    PUMP_PROGRAM_ID
  );
  return pda;
}

function getGlobalPDA(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from("global")], PUMP_PROGRAM_ID);
  return pda;
}

function getEventAuthorityPDA(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM_ID
  );
  return pda;
}

function getATA(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey = TOKEN_PROGRAM_ID): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ASSOC_TOKEN_PROG
  );
  return ata;
}

// Detect which token program owns a given mint (SPL v1 vs Token-2022).
// New pump.fun launches mint under Token-2022; legacy tokens still use SPL v1.
// Cached per process since a mint's owner doesn't change.
const _tokenProgramCache = new Map<string, PublicKey>();
async function detectTokenProgram(mint: PublicKey): Promise<PublicKey> {
  const key = mint.toBase58();
  const cached = _tokenProgramCache.get(key);
  if (cached) return cached;
  const info = await rpc("getAccountInfo", [key, { encoding: "base64" }]);
  if (!info?.value?.owner) throw new Error(`Mint ${key} not found`);
  const owner = new PublicKey(info.value.owner);
  if (!owner.equals(TOKEN_PROGRAM_ID) && !owner.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error(`Mint ${key} is owned by unexpected program ${owner.toBase58()}`);
  }
  _tokenProgramCache.set(key, owner);
  return owner;
}

// New v2-IDL PDAs (extracted from on-chain Anchor IDL at AYgC53tU…69xRs).
function getCreatorVaultPDA(creator: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), creator.toBuffer()],
    PUMP_PROGRAM_ID
  );
  return pda;
}
function getGlobalVolumeAccumulatorPDA(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_volume_accumulator")],
    PUMP_PROGRAM_ID
  );
  return pda;
}
function getUserVolumeAccumulatorPDA(user: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_volume_accumulator"), user.toBuffer()],
    PUMP_PROGRAM_ID
  );
  return pda;
}
// fee_config is a PDA owned by the pump fee_program (not the main pump program).
// Seeds: ["fee_config", PUMP_PROGRAM_ID_BYTES]. Deterministic constant across all txs.
function getFeeConfigPDA(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("fee_config"), PUMP_PROGRAM_ID.toBuffer()],
    PUMP_FEE_PROGRAM_ID
  );
  return pda;
}

// ─── Bonding curve data ───────────────────────────────────────────────────────
export interface BondingCurve {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
  creator: PublicKey; // v2 field — required to derive creator_vault PDA
}

export async function fetchBondingCurve(mint: PublicKey): Promise<BondingCurve> {
  const pda = getBondingCurvePDA(mint);
  const result = await rpc("getAccountInfo", [
    pda.toBase58(),
    { encoding: "base64" },
  ]);
  if (!result?.value?.data) throw new Error("Bonding curve account not found for this token");

  const raw = Buffer.from(result.value.data[0], "base64");
  // v2 layout: 8-byte disc + 5×u64 + bool(complete) + pubkey(creator) + bool + bool + pubkey
  // We only need fields through `creator` (offset 49..81). Anything shorter is the old v1 layout.
  if (raw.length < 49) throw new Error("Bonding curve account data too short");
  const hasCreator = raw.length >= 81;
  return {
    virtualTokenReserves: raw.readBigUInt64LE(8),
    virtualSolReserves:   raw.readBigUInt64LE(16),
    realTokenReserves:    raw.readBigUInt64LE(24),
    realSolReserves:      raw.readBigUInt64LE(32),
    tokenTotalSupply:     raw.readBigUInt64LE(40),
    complete:             raw[48] === 1,
    // Fall back to mint as creator for legacy v1 curves — manual builder will
    // then fail PDA resolution and we'll fall back to PumpPortal (no regression).
    creator:              hasCreator ? new PublicKey(raw.subarray(49, 81)) : mint,
  };
}

// Cache the active pump fee_recipient. The global account has both a
// singular `fee_recipient: pubkey` (offset 41 after 8-byte disc + 1-byte
// `initialized` + 32-byte authority) and a `fee_recipients: [pubkey; 7]`
// array. Real-world buys observed on-chain rotate through the array, but the
// program accepts ANY recipient from the active list. We read the singular
// field once on first use and cache for the process lifetime.
// Cache both the active fee_recipient and the buyback_fee_recipients array.
// The v2 pump program requires a buyback_fee_recipient as a trailing
// remaining_account (Anchor error 6062 BuybackFeeRecipientMissing otherwise).
// The array is at Borsh offset 741 in the global account:
//   8 disc + 1 init + 32 auth + 32 fee_recipient + 5×u64 (40) + 32 withdraw_auth
//   + 1 enable_migrate + 2×u64 (16) + 7×pubkey (224 fee_recipients)
//   + 2×pubkey (64) + 1 create_v2 + 2×pubkey (64) + 1 mayhem
//   + 7×pubkey (224 reserved_fee_recipients) + 1 is_cashback_enabled
//   = 741 → buyback_fee_recipients[0..7]
interface GlobalState { feeRecipient: PublicKey; buybackFeeRecipients: PublicKey[]; }
let _globalCache: GlobalState | null = null;
let _globalPromise: Promise<GlobalState> | null = null;
async function getGlobalState(): Promise<GlobalState> {
  if (_globalCache) return _globalCache;
  if (_globalPromise) return _globalPromise;
  _globalPromise = (async () => {
    const result = await rpc("getAccountInfo", [getGlobalPDA().toBase58(), { encoding: "base64" }]);
    if (!result?.value?.data) throw new Error("Global account not found");
    const raw = Buffer.from(result.value.data[0], "base64");
    if (raw.length < 741 + 32) throw new Error("Global account too short for buyback recipients");
    const feeRecipient = new PublicKey(raw.subarray(41, 73));
    const buyback: PublicKey[] = [];
    for (let i = 0; i < 8; i++) {
      const off = 741 + i * 32;
      const pk = new PublicKey(raw.subarray(off, off + 32));
      if (!pk.equals(PublicKey.default)) buyback.push(pk);
    }
    if (buyback.length === 0) throw new Error("No buyback_fee_recipients found in global account");
    _globalCache = { feeRecipient, buybackFeeRecipients: buyback };
    return _globalCache;
  })();
  try { return await _globalPromise; }
  finally { _globalPromise = null; }
}
async function getActiveFeeRecipient(): Promise<PublicKey> {
  return (await getGlobalState()).feeRecipient;
}
async function getActiveBuybackFeeRecipient(): Promise<PublicKey> {
  // Round-robin not necessary — program accepts any recipient from the list.
  // Use the first non-zero entry for determinism.
  return (await getGlobalState()).buybackFeeRecipients[0];
}

// ─── Quote math ───────────────────────────────────────────────────────────────
// How many tokens do you get for `solLamports` of SOL?
export function calcBuyTokens(curve: BondingCurve, solLamports: bigint): bigint {
  // 1% pump.fun fee is deducted from SOL before bonding curve
  const netSol = (solLamports * (10000n - PUMP_FEE_BPS)) / 10000n;
  const tokens = (curve.virtualTokenReserves * netSol) / (curve.virtualSolReserves + netSol);
  return tokens;
}

// How many SOL lamports do you get for `tokenAmount` tokens?
export function calcSellSol(curve: BondingCurve, tokenAmount: bigint): bigint {
  const solOut = (curve.virtualSolReserves * tokenAmount) / (curve.virtualTokenReserves + tokenAmount);
  // Deduct 1% fee from SOL received
  const netSol = (solOut * (10000n - PUMP_FEE_BPS)) / 10000n;
  return netSol;
}

// ─── Instruction builders (v2 IDL — 16 accounts buy, 14 accounts sell) ────────
// Rebuilt against pump.fun's on-chain Anchor IDL fetched from program-derived
// account AYgC53tU5BbP2NAnv5nConJxAdpQZctvmZK88pu69xRs. Notable v2 additions:
//   • creator_vault PDA (seeds: ["creator-vault", bonding_curve.creator])
//   • global_volume_accumulator PDA (deterministic, one per program)
//   • user_volume_accumulator PDA (seeds: ["user_volume_accumulator", user])
//   • fee_config PDA owned by the new pump fee_program (pfeeUxB6jk…)
//   • fee_program account (pfeeUxB6jk…)
// Real txs observed on-chain include 2 trailing remaining_accounts that are
// per-tx variable (referral / cashback?) — not in the IDL, may be optional.
// We ship the IDL-strict 16-account version; if the program rejects, the
// PumpPortal fallback in buildBuyTransaction catches the error (no regression).
function buildBuyInstruction(
  mint: PublicKey,
  user: PublicKey,
  creator: PublicKey,
  feeRecipient: PublicKey,
  tokenProgram: PublicKey,
  buybackFeeRecipient: PublicKey,
  tokenAmount: bigint,
  maxSolCost: bigint
): TransactionInstruction {
  const bondingCurve      = getBondingCurvePDA(mint);
  const assocBondingCurve = getATA(bondingCurve, mint, tokenProgram);
  const assocUser         = getATA(user, mint, tokenProgram);

  // 8-disc + 8-amount + 8-max_sol_cost + 1-track_volume (OptionBool = struct{bool} = 1 byte)
  const data = Buffer.alloc(25);
  BUY_DISC.copy(data, 0);
  data.writeBigUInt64LE(tokenAmount, 8);
  data.writeBigUInt64LE(maxSolCost, 16);
  data[24] = 1; // track_volume = true (enables user volume rewards)

  const keys: AccountMeta[] = [
    { pubkey: getGlobalPDA(),                  isSigner: false, isWritable: false }, // [0]  global
    { pubkey: feeRecipient,                    isSigner: false, isWritable: true  }, // [1]  fee_recipient
    { pubkey: mint,                            isSigner: false, isWritable: false }, // [2]  mint
    { pubkey: bondingCurve,                    isSigner: false, isWritable: true  }, // [3]  bonding_curve
    { pubkey: assocBondingCurve,               isSigner: false, isWritable: true  }, // [4]  associated_bonding_curve
    { pubkey: assocUser,                       isSigner: false, isWritable: true  }, // [5]  associated_user
    { pubkey: user,                            isSigner: true,  isWritable: true  }, // [6]  user
    { pubkey: SystemProgram.programId,         isSigner: false, isWritable: false }, // [7]  system_program
    { pubkey: tokenProgram,                    isSigner: false, isWritable: false }, // [8]  token_program (dynamic: SPL v1 or Token-2022)
    { pubkey: getCreatorVaultPDA(creator),     isSigner: false, isWritable: true  }, // [9]  creator_vault (NEW)
    { pubkey: getEventAuthorityPDA(),          isSigner: false, isWritable: false }, // [10] event_authority
    { pubkey: PUMP_PROGRAM_ID,                 isSigner: false, isWritable: false }, // [11] program
    { pubkey: getGlobalVolumeAccumulatorPDA(), isSigner: false, isWritable: false }, // [12] global_volume_accumulator (NEW)
    { pubkey: getUserVolumeAccumulatorPDA(user), isSigner: false, isWritable: true }, // [13] user_volume_accumulator (NEW)
    { pubkey: getFeeConfigPDA(),               isSigner: false, isWritable: false }, // [14] fee_config (NEW)
    { pubkey: PUMP_FEE_PROGRAM_ID,             isSigner: false, isWritable: false }, // [15] fee_program (NEW)
    // Trailing remaining_account required by v2 program (Anchor 6062 BuybackFeeRecipientMissing otherwise).
    // Sourced from global.buyback_fee_recipients[]. Program accepts any non-zero entry.
    { pubkey: buybackFeeRecipient,             isSigner: false, isWritable: true  }, // [16] buyback_fee_recipient (remaining_account)
  ];

  return new TransactionInstruction({ programId: PUMP_PROGRAM_ID, keys, data });
}

function buildSellInstruction(
  mint: PublicKey,
  user: PublicKey,
  creator: PublicKey,
  feeRecipient: PublicKey,
  tokenProgram: PublicKey,
  buybackFeeRecipient: PublicKey,
  tokenAmount: bigint,
  minSolOutput: bigint
): TransactionInstruction {
  const bondingCurve      = getBondingCurvePDA(mint);
  const assocBondingCurve = getATA(bondingCurve, mint, tokenProgram);
  const assocUser         = getATA(user, mint, tokenProgram);

  const data = Buffer.alloc(24);
  SELL_DISC.copy(data, 0);
  data.writeBigUInt64LE(tokenAmount, 8);
  data.writeBigUInt64LE(minSolOutput, 16);

  // Sell has 14 accounts (no global_volume_accumulator / user_volume_accumulator).
  // Ordering per IDL: creator_vault is at [8] (BEFORE token_program), not at [9].
  const keys: AccountMeta[] = [
    { pubkey: getGlobalPDA(),              isSigner: false, isWritable: false }, // [0]  global
    { pubkey: feeRecipient,                isSigner: false, isWritable: true  }, // [1]  fee_recipient
    { pubkey: mint,                        isSigner: false, isWritable: false }, // [2]  mint
    { pubkey: bondingCurve,                isSigner: false, isWritable: true  }, // [3]  bonding_curve
    { pubkey: assocBondingCurve,           isSigner: false, isWritable: true  }, // [4]  associated_bonding_curve
    { pubkey: assocUser,                   isSigner: false, isWritable: true  }, // [5]  associated_user
    { pubkey: user,                        isSigner: true,  isWritable: true  }, // [6]  user
    { pubkey: SystemProgram.programId,     isSigner: false, isWritable: false }, // [7]  system_program
    { pubkey: getCreatorVaultPDA(creator), isSigner: false, isWritable: true  }, // [8]  creator_vault (NEW)
    { pubkey: tokenProgram,                isSigner: false, isWritable: false }, // [9]  token_program (dynamic)
    { pubkey: getEventAuthorityPDA(),      isSigner: false, isWritable: false }, // [10] event_authority
    { pubkey: PUMP_PROGRAM_ID,             isSigner: false, isWritable: false }, // [11] program
    { pubkey: getFeeConfigPDA(),           isSigner: false, isWritable: false }, // [12] fee_config (NEW)
    { pubkey: PUMP_FEE_PROGRAM_ID,         isSigner: false, isWritable: false }, // [13] fee_program (NEW)
    // Trailing remaining_account required by v2 program (Anchor 6062 BuybackFeeRecipientMissing).
    { pubkey: buybackFeeRecipient,         isSigner: false, isWritable: true  }, // [14] buyback_fee_recipient (remaining_account)
  ];

  return new TransactionInstruction({ programId: PUMP_PROGRAM_ID, keys, data });
}

// ─── Manual transaction builders (top-level pump.fun program invocations) ─────
// These produce a v0 VersionedTransaction with the buy/sell call as the
// top-level instruction so pump.fun's indexer credits it to the "Latest
// Trades" UI feed. Callers should treat any thrown error as "try PumpPortal".
async function buildManualBuyTransaction(
  mint: PublicKey,
  user: PublicKey,
  curve: BondingCurve,
  solLamports: bigint,
  slippageBps: number,
): Promise<string> {
  // Compute expected tokens out and apply slippage → maxSolCost = solLamports.
  // The instruction takes (tokenAmount_to_receive, max_sol_cost) so the
  // user is requesting exactly `tokensExpected` tokens for at most `solLamports` SOL.
  const tokensExpected = calcBuyTokens(curve, solLamports);
  // Apply downside slippage to token count (we accept fewer tokens if curve moves against us).
  const minTokens = (tokensExpected * BigInt(10000 - slippageBps)) / 10000n;
  if (minTokens <= 0n) throw new Error("Manual buy: token amount underflow after slippage");

  const [feeRecipient, buybackRecipient, tokenProgram] = await Promise.all([
    getActiveFeeRecipient(),
    getActiveBuybackFeeRecipient(),
    detectTokenProgram(mint),
  ]);
  const { buildComputeBudgetInstructions } = await import("./network-fees");
  const computeIxs = await buildComputeBudgetInstructions();

  const ixs: TransactionInstruction[] = [
    ...computeIxs,
    buildCreateAtaInstruction(user, user, mint, tokenProgram), // idempotent — no-op if exists
    buildBuyInstruction(mint, user, curve.creator, feeRecipient, tokenProgram, buybackRecipient, minTokens, solLamports),
  ];

  const { value: { blockhash } } = await rpc("getLatestBlockhash", [{ commitment: "finalized" }]);
  const message = new TransactionMessage({
    payerKey: user,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message([]);
  return Buffer.from(new VersionedTransaction(message).serialize()).toString("base64");
}

async function buildManualSellTransaction(
  mint: PublicKey,
  user: PublicKey,
  curve: BondingCurve,
  tokenRawAmount: bigint,
  slippageBps: number,
): Promise<string> {
  const solExpected = calcSellSol(curve, tokenRawAmount);
  const minSolOutput = (solExpected * BigInt(10000 - slippageBps)) / 10000n;
  if (minSolOutput <= 0n) throw new Error("Manual sell: SOL output underflow after slippage");

  const [feeRecipient, buybackRecipient, tokenProgram] = await Promise.all([
    getActiveFeeRecipient(),
    getActiveBuybackFeeRecipient(),
    detectTokenProgram(mint),
  ]);
  const { buildComputeBudgetInstructions } = await import("./network-fees");
  const computeIxs = await buildComputeBudgetInstructions();

  const ixs: TransactionInstruction[] = [
    ...computeIxs,
    buildSellInstruction(mint, user, curve.creator, feeRecipient, tokenProgram, buybackRecipient, tokenRawAmount, minSolOutput),
  ];

  const { value: { blockhash } } = await rpc("getLatestBlockhash", [{ commitment: "finalized" }]);
  const message = new TransactionMessage({
    payerKey: user,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message([]);
  return Buffer.from(new VersionedTransaction(message).serialize()).toString("base64");
}

// ─── ATA create-idempotent instruction ────────────────────────────────────────
// Uses instruction variant [1] = CreateIdempotent — silently no-ops if ATA exists.
function buildCreateAtaInstruction(
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey = TOKEN_PROGRAM_ID,
): TransactionInstruction {
  const ata = getATA(owner, mint, tokenProgram);
  return new TransactionInstruction({
    programId: ASSOC_TOKEN_PROG,
    keys: [
      { pubkey: payer,                    isSigner: true,  isWritable: true  },
      { pubkey: ata,                       isSigner: false, isWritable: true  },
      { pubkey: owner,                     isSigner: false, isWritable: false },
      { pubkey: mint,                      isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,   isSigner: false, isWritable: false },
      { pubkey: tokenProgram,              isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]), // 1 = CreateIdempotent
  });
}

// ─── PumpPortal trade API (primary path — no API key required) ────────────────
const PUMPPORTAL_URL = "https://pumpportal.fun/api/trade-local";

export async function buildViaPumpPortal(
  action: "buy" | "sell",
  mintAddress: string,
  userAddress: string,
  amount: number,          // SOL for buy, token UI amount for sell
  denominatedInSol: boolean,
  slippageBps: number,
): Promise<string> {        // returns base64 transaction
  const slippagePercent = slippageBps / 100;
  // Dynamic priority fee — tracks current Solana congestion via
  // getRecentPrioritizationFees (see server/network-fees.ts). The user's
  // signing wallet pays it; we never subsidize. Falls back to a low floor
  // when the RPC call fails, which is still strictly higher than the old
  // hardcoded 0.00001 SOL during congestion events.
  const { getPriorityFeeSolForPumpPortal } = await import("./network-fees");
  const priorityFeeSol = await getPriorityFeeSolForPumpPortal();
  const res = await fetch(PUMPPORTAL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicKey: userAddress,
      action,
      mint: mintAddress,
      amount,
      denominatedInSol: denominatedInSol ? "true" : "false",
      slippage: slippagePercent,
      priorityFee: priorityFeeSol,
      pool: "pump",
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`PumpPortal: ${errText}`);
  }
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength < 10) throw new Error("PumpPortal returned empty transaction");
  return Buffer.from(bytes).toString("base64");
}

// ─── Transaction builders (return base64 serialized VersionedTransaction) ─────
export async function buildBuyTransaction(
  mintAddress: string,
  userAddress: string,
  solLamports: number,
  slippageBps: number
): Promise<{ transaction: string; tokensOut: string; solIn: string; paifFees: PaifFeeBreakdown }> {
  const user = new PublicKey(userAddress);
  const solAmount = solLamports / 1e9;
  // Fee base = the SOL the user is spending on the swap. Fees are added on TOP
  // (user's session wallet pays solLamports + fees + gas). For sells we use the
  // expected SOL output as the base, taken from the post-sell SOL credit.
  const { transfers: feeTransfers, breakdown: paifFees } = computePaifFees(BigInt(solLamports));

  const mint = new PublicKey(mintAddress);
  // Fetch curve up front — needed for both the manual builder (creator_vault
  // derivation, quote math) and as a graduation gate for the PumpPortal path.
  let curve: BondingCurve | null = null;
  try {
    curve = await fetchBondingCurve(mint);
    if (curve.complete) throw new Error("This token has already graduated from pump.fun and can be traded on Jupiter.");
  } catch (e: any) {
    if (e?.message?.includes("graduated")) throw e;
    // Curve fetch failed for non-graduation reasons (RPC hiccup) — skip manual,
    // let PumpPortal try.
    curve = null;
  }

  // Manual-first path: ship the swap as a TOP-LEVEL pump.fun program
  // invocation so pump.fun's indexer credits it to "Latest Trades". On any
  // error fall back to PumpPortal (the previous reliable path). This is the
  // post-IDL-refresh rebuild — see buildBuyInstruction comments for details.
  let transaction: string | null = null;
  let route: "manual" | "pumpportal" = "pumpportal";
  if (MANUAL_BUILDER_ENABLED && curve) {
    try {
      transaction = await buildManualBuyTransaction(mint, user, curve, BigInt(solLamports), slippageBps);
      route = "manual";
    } catch (err: any) {
      console.log(`[pump] manual buy build failed for ${mintAddress}, falling back to PumpPortal: ${err?.message ?? err}`);
      transaction = null;
    }
  }
  if (!transaction) {
    transaction = await buildViaPumpPortal("buy", mintAddress, userAddress, solAmount, true, slippageBps);
  }
  transaction = await injectFeeTransfers(transaction, user, feeTransfers);
  console.log(`[pump] buy ${mintAddress} route=${route}`);

  const tokensOut = curve ? calcBuyTokens(curve, BigInt(solLamports)).toString() : "0";
  return { transaction, tokensOut, solIn: solLamports.toString(), paifFees };
}

export async function buildSellTransaction(
  mintAddress: string,
  userAddress: string,
  tokenAmount: number,
  decimals: number,
  slippageBps: number
): Promise<{ transaction: string; solOut: string; tokensIn: string; paifFees: PaifFeeBreakdown }> {
  const mint = new PublicKey(mintAddress);
  const user = new PublicKey(userAddress);

  // Quote the SOL output up front so we know what the fee base is.
  // Fee base = expected SOL output (calcSellSol), NOT minSolOutput, so users
  // can't reduce platform fees by raising slippage. Feasibility is preserved:
  // even at the worst-case 50% slippage hit the user still receives
  //   minSolOutput = solOutEst * (1 - slippage) ≥ solOutEst * 0.50
  // which always exceeds the 4% fee taken from solOutEst, since 0.50 > 0.04.
  // FAIL-CLOSED: if we can't quote, we refuse to build the transaction rather
  // than build a fee-less sell.
  let curve: BondingCurve;
  let solOutEst: bigint;
  const tokenRaw = BigInt(Math.floor(tokenAmount * Math.pow(10, decimals)));
  try {
    curve = await fetchBondingCurve(mint);
    if (curve.complete) throw new Error("This token has already graduated from pump.fun and can be traded on Jupiter.");
    solOutEst = calcSellSol(curve, tokenRaw);
    if (solOutEst <= 0n) throw new Error("Amount too small to receive any SOL.");
  } catch (e: any) {
    if (e?.message?.includes("graduated")) throw e;
    throw new Error(`Sell quote failed (cannot compute platform fee): ${e?.message ?? "unknown error"}`);
  }
  const { transfers: feeTransfers, breakdown: paifFees } = computePaifFees(solOutEst);

  // Manual-first, PumpPortal fallback — same shape as buildBuyTransaction.
  let transaction: string | null = null;
  let route: "manual" | "pumpportal" = "pumpportal";
  if (MANUAL_BUILDER_ENABLED) {
    try {
      transaction = await buildManualSellTransaction(mint, user, curve, tokenRaw, slippageBps);
      route = "manual";
    } catch (err: any) {
      console.log(`[pump] manual sell build failed for ${mintAddress}, falling back to PumpPortal: ${err?.message ?? err}`);
      transaction = null;
    }
  }
  if (!transaction) {
    transaction = await buildViaPumpPortal("sell", mintAddress, userAddress, tokenAmount, false, slippageBps);
  }
  transaction = await injectFeeTransfers(transaction, user, feeTransfers);
  console.log(`[pump] sell ${mintAddress} route=${route}`);

  const tokensIn = tokenRaw.toString();
  return { transaction, solOut: solOutEst.toString(), tokensIn, paifFees };
}

// ─── Price / quote (no transaction, just numbers) ─────────────────────────────
// Special error code so the frontend knows to re-route to Jupiter instead.
export const PUMP_GRADUATED_ERROR = "PUMP_GRADUATED";

export async function getPumpQuote(
  mintAddress: string,
  action: "buy" | "sell",
  amountLamportsOrTokens: number,
  decimals: number
): Promise<{
  tokensOut?: string;
  solOut?: string;
  pricePerToken: string;
  marketCapSol: string;
  complete: boolean;
}> {
  const curve = await fetchBondingCurve(new PublicKey(mintAddress));

  // If bonding curve is complete the token has graduated to Raydium/Jupiter.
  // Signal this clearly so callers can fall back to Jupiter routing.
  if (curve.complete) {
    throw new Error(PUMP_GRADUATED_ERROR);
  }

  const pricePerToken = Number(curve.virtualSolReserves) / Number(curve.virtualTokenReserves);
  const marketCapSol = (Number(curve.tokenTotalSupply) * pricePerToken) / 1e9;

  if (action === "buy") {
    const tokensOut = calcBuyTokens(curve, BigInt(amountLamportsOrTokens));
    return {
      tokensOut: tokensOut.toString(),
      pricePerToken: pricePerToken.toFixed(12),
      marketCapSol: marketCapSol.toFixed(4),
      complete: false,
    };
  } else {
    const tokenRaw = BigInt(Math.floor(amountLamportsOrTokens * Math.pow(10, decimals)));
    const solOut = calcSellSol(curve, tokenRaw);
    return {
      solOut: solOut.toString(),
      pricePerToken: pricePerToken.toFixed(12),
      marketCapSol: marketCapSol.toFixed(4),
      complete: false,
    };
  }
}
