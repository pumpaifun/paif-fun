import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type MessageAccountKeys,
} from "@solana/web3.js";

/** Native SOL is the only quote asset this adapter permits. */
export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const PUMPAPI_URL = "https://api.pumpapi.io";
export const MAX_PRIORITY_FEE_LAMPORTS = BigInt(200_000); // deliberately below PumpApi's Jito split threshold
export const MAX_RESPONSE_BYTES = 12_288;
export const MAX_TRANSACTION_BYTES = 10_240;
export const MAX_INSTRUCTIONS = 32;
export const MAX_ACCOUNT_KEYS = 96;
export const MAX_ADDRESS_LOOKUPS = 8;
const MIN_REQUEST_GAP_MS = 300;
const PUMPAPI_TRADE_FEE_BPS = BigInt(25); // documented 0.25%
const BPS_DENOMINATOR = BigInt(10_000);
const MAX_COMPUTE_UNITS = BigInt(400_000);
const MICRO_LAMPORTS_PER_LAMPORT = BigInt(1_000_000);
const PUMPAPI_FEE_RECIPIENT = new PublicKey("pump22QQQnff5qmAxW7yg6VEKU3C7Mj8C4TDaXJZt9Q");
const WRAPPED_SOL_MINT = new PublicKey(SOL_MINT);
const ALLOWED_SWAP_PROGRAMS = new Set([
  ComputeBudgetProgram.programId.toBase58(),
  SystemProgram.programId.toBase58(),
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
  ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", // Pump.fun
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", // PumpSwap
  "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C", // Raydium CPMM
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", // Meteora DLMM
  "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG", // Meteora DAMM v2
]);

export type PumpAction = "buy" | "sell";
export interface PumpApiTradeInput {
  publicKey: string;
  action: PumpAction;
  mint: string;
  /** A safety-validated pool is always pinned; never let the provider choose one. */
  poolId: string;
  /** Swing Bot is SOL-only, including when valuing an unsigned transaction. */
  quoteMint: string;
  /** Lamports for buys; base-token raw units for sells. */
  amountRaw: bigint;
  /** Base-token decimals for sells (ignored for buys). */
  tokenDecimals: number;
  /** Exact provider-independent output floor, in raw output units. */
  minimumOutputRaw: bigint;
  /** Reference output used only to cap PumpApi's documented service fee. */
  expectedOutputRaw: bigint;
  /** Base-token decimals on buys; 9 (SOL) on sells. */
  outputDecimals: number;
  slippage: number;
  priorityFeeLamports?: bigint;
}
export interface PumpApiLocalTransaction {
  transactionBase64: string;
  action: PumpAction;
  mint: string;
  amount: string;
  priorityFeeLamports: bigint;
  recentBlockhash: string;
  accountKeyCount: number;
  instructionCount: number;
}
export interface PumpApiRoundTripInput {
  publicKey: string; mint: string; poolId: string; quoteMint: string;
  amountRaw: bigint; tokenDecimals: number; slippage: number;
  /** Omitted only for fresh-wallet pre-buy round trips. */
  sellAmountRaw?: bigint;
}

let queueTail: Promise<void> = Promise.resolve();
let lastRequestAt = 0;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("PumpApi timeout"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error("PumpApi timeout"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Converts an unsigned raw token amount without ever passing through Number. */
export function rawAmountToDecimal(amount: bigint, decimals: number): string {
  if (amount < BigInt(0) || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error("Invalid token amount");
  }
  if (decimals === 0) return amount.toString();
  const value = amount.toString().padStart(decimals + 1, "0");
  const whole = value.slice(0, -decimals);
  const fraction = value.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/** Builds the intentionally small local-transaction request allowlist. */
export function buildPumpApiRequest(input: PumpApiTradeInput): Record<string, string | number> {
  if (input.action !== "buy" && input.action !== "sell") throw new Error("Invalid action");
  new PublicKey(input.publicKey);
  const mint = new PublicKey(input.mint);
  const poolId = new PublicKey(input.poolId);
  const quoteMint = new PublicKey(input.quoteMint);
  if (poolId.equals(mint) || quoteMint.toBase58() !== SOL_MINT) throw new Error("Invalid pinned pool");
  if (mint.toBase58() === SOL_MINT || input.amountRaw <= BigInt(0)) throw new Error("Invalid trade amount");
  if (input.minimumOutputRaw <= BigInt(0) || input.expectedOutputRaw < input.minimumOutputRaw) {
    throw new Error("Invalid trade bounds");
  }
  if (!Number.isFinite(input.slippage) || input.slippage <= 0 || input.slippage > 100) throw new Error("Invalid slippage");
  const priority = input.priorityFeeLamports ?? BigInt(0);
  if (priority < BigInt(0)) throw new Error("Invalid priority fee");
  const amount = input.action === "buy"
    ? rawAmountToDecimal(input.amountRaw, 9)
    : rawAmountToDecimal(input.amountRaw, input.tokenDecimals);
  const request: Record<string, string | number> = {
    publicKey: input.publicKey,
    action: input.action,
    mint: input.mint,
    poolId: input.poolId,
    quoteMint: input.quoteMint,
    amount,
    denominatedInQuote: input.action === "buy" ? "true" : "false",
    slippage: input.slippage,
    priorityFee: rawAmountToDecimal(priority > MAX_PRIORITY_FEE_LAMPORTS ? MAX_PRIORITY_FEE_LAMPORTS : priority, 9),
  };
  if (input.action === "buy") {
    request.maxQuoteAmountIn = rawAmountToDecimal(input.amountRaw, 9);
    request.minBaseAmountOut = rawAmountToDecimal(input.minimumOutputRaw, input.outputDecimals);
  } else {
    request.maxBaseAmountIn = rawAmountToDecimal(input.amountRaw, input.tokenDecimals);
    request.minQuoteAmountOut = rawAmountToDecimal(input.minimumOutputRaw, 9);
  }
  return request;
}

/** Strict Actions-local body.  The provider gets one public address only; both
 * actions are pinned to the same SOL pool and the second action consumes only
 * the tokens created by the first (`100%` is safe only for a zero pre-balance). */
export function buildPumpApiRoundTripRequest(input: PumpApiRoundTripInput): Record<string, unknown> {
  const buy = buildPumpApiRequest({ ...input, action: "buy", minimumOutputRaw: 1n,
    expectedOutputRaw: 1n, outputDecimals: input.tokenDecimals, priorityFeeLamports: 0n });
  const sell: Record<string, string | number> = {
    publicKey: input.publicKey, action: "sell", mint: input.mint, poolId: input.poolId, quoteMint: input.quoteMint,
    amount: input.sellAmountRaw == null ? "100%" : rawAmountToDecimal(input.sellAmountRaw, input.tokenDecimals),
    denominatedInQuote: "false", slippage: input.slippage, priorityFee: "0",
  };
  return { actions: [buy, sell] };
}
function validateRoundTripInstructionPolicy(tx: VersionedTransaction, publicKey: string): void {
  // Actions may contain two trusted AMM CPIs and two documented provider-fee
  // transfers. Do not reuse the single-swap exact-transfer checker, but keep a
  // deliberately narrower explicit policy for an unsigned simulation payload.
  const owner = new PublicKey(publicKey);
  const keys = tx.message.staticAccountKeys;
  let systemTransfers = 0;
  for (const ix of tx.message.compiledInstructions) {
    const program = keys[ix.programIdIndex];
    if (!program || !ALLOWED_SWAP_PROGRAMS.has(program.toBase58())) throw new Error("Unexpected Actions transaction program");
    if (program.equals(SystemProgram.programId)) {
      const data = Buffer.from(ix.data);
      if (data.length !== 12 || data.readUInt32LE(0) !== 2 || ix.accountKeyIndexes.length < 2) {
        throw new Error("Unexpected Actions system instruction");
      }
      const source = keys[ix.accountKeyIndexes[0]], destination = keys[ix.accountKeyIndexes[1]];
      const ownerWsol = PublicKey.findProgramAddressSync(
        [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), WRAPPED_SOL_MINT.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID,
      )[0];
      if (!source?.equals(owner) || !destination || (!destination.equals(ownerWsol) && !destination.equals(PUMPAPI_FEE_RECIPIENT))) {
        throw new Error("Unexpected Actions system transfer");
      }
      if (++systemTransfers > 6) throw new Error("Too many Actions system transfers");
    }
    if (program.equals(TOKEN_PROGRAM_ID) || program.equals(TOKEN_2022_PROGRAM_ID)) {
      const tag = ix.data[0];
      if (tag !== 9 && tag !== 17) throw new Error("Unexpected Actions token instruction");
    }
  }
  if (systemTransfers < 2) throw new Error("Actions transaction missing swap funding");
}

/** Fetches an unsigned atomic buy/sell Actions transaction. It intentionally
 * performs only structural validation here; callers must simulate it and may
 * never sign/broadcast it. */
export async function getPumpApiRoundTripTransaction(
  input: PumpApiRoundTripInput,
  options: { fetchFn?: typeof fetch; timeoutMs?: number } = {},
): Promise<string> {
  const body = buildPumpApiRoundTripRequest(input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    await pace(controller.signal);
    const response = await (options.fetchFn ?? fetch)(PUMPAPI_URL, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal,
    });
    if (!response.ok) throw new Error(`PumpApi Actions failed (${response.status})`);
    const bytes = await readPumpApiResponse(response);
    const tx = parsePumpApiTransaction(bytes, input.publicKey);
    validateRoundTripInstructionPolicy(tx, input.publicKey);
    // Exact route anchors must be present before an untrusted Actions payload is
    // allowed to reach public-RPC simulation.
    const keys = tx.message.staticAccountKeys;
    for (const key of [input.mint, input.poolId, input.quoteMint]) {
      if (!keys.some((x) => x.equals(new PublicKey(key)))) throw new Error("Actions transaction missing pinned account");
    }
    return Buffer.from(bytes).toString("base64");
  } finally { clearTimeout(timer); }
}

async function pace(signal: AbortSignal): Promise<void> {
  const turn = queueTail.then(async () => {
    const delay = Math.max(0, lastRequestAt + MIN_REQUEST_GAP_MS - Date.now());
    if (delay) await sleep(delay);
    if (signal.aborted) throw new Error("PumpApi timeout");
    lastRequestAt = Date.now();
  });
  queueTail = turn.catch(() => {});
  await turn;
}

export async function readPumpApiResponse(response: Response, maxBytes = MAX_RESPONSE_BYTES): Promise<Uint8Array> {
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new Error("PumpApi response too large");
  // PumpApi currently labels successful binary VersionedTransaction responses
  // as application/json, so the body bytes — not Content-Type — are authoritative.
  if (!response.body) throw new Error("PumpApi response missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("PumpApi response too large");
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (!size || bytes[0] === 0x7b || bytes[0] === 0x5b) throw new Error("PumpApi returned JSON");
  return bytes;
}

/** Deserializes one canonical binary transaction and checks signer-independent bounds. */
export function parsePumpApiTransaction(bytes: Uint8Array, suppliedPublicKey: string): VersionedTransaction {
  if (!bytes.length || bytes.length > MAX_TRANSACTION_BYTES) throw new Error("Invalid transaction size");
  let tx: VersionedTransaction;
  try { tx = VersionedTransaction.deserialize(bytes); } catch { throw new Error("Invalid PumpApi transaction"); }
  // Deserialize is permissive about trailing bytes; canonical reserialization makes
  // a concatenated/multiple transaction response unambiguously invalid.
  const canonical = tx.serialize();
  if (canonical.length !== bytes.length || !canonical.every((v, i) => v === bytes[i])) throw new Error("Invalid transaction payload");
  const message = tx.message;
  if (message.header.numRequiredSignatures !== 1 || tx.signatures.length !== 1) throw new Error("Unexpected transaction signer");
  const payer = message.staticAccountKeys[0];
  let requested: PublicKey;
  try { requested = new PublicKey(suppliedPublicKey); } catch { throw new Error("Invalid public key"); }
  if (!payer?.equals(requested)) throw new Error("Unexpected transaction signer");
  try { new PublicKey(message.recentBlockhash); } catch { throw new Error("Invalid recent blockhash"); }
  if (message.compiledInstructions.length > MAX_INSTRUCTIONS || message.staticAccountKeys.length > MAX_ACCOUNT_KEYS ||
      message.addressTableLookups.length > MAX_ADDRESS_LOOKUPS) throw new Error("Transaction exceeds limits");
  return tx;
}

function accountAt(keys: MessageAccountKeys, index: number): PublicKey {
  const key = keys.get(index);
  if (!key) throw new Error("Invalid transaction account index");
  return key;
}

function validateInstructionPolicy(
  tx: VersionedTransaction,
  keys: MessageAccountKeys,
  input: PumpApiTradeInput,
): void {
  const owner = new PublicKey(input.publicKey);
  const ownerWrappedSolAta = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), WRAPPED_SOL_MINT.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
  let computeUnitLimit: bigint | null = null;
  let computeUnitPrice: bigint | null = null;
  let sawBuyInputTransfer = false;
  let sawProviderFeeTransfer = false;
  for (const instruction of tx.message.compiledInstructions) {
    const program = accountAt(keys, instruction.programIdIndex);
    const programId = program.toBase58();
    if (!ALLOWED_SWAP_PROGRAMS.has(programId)) throw new Error("Unexpected transaction program");

    if (program.equals(ComputeBudgetProgram.programId)) {
      const data = Buffer.from(instruction.data);
      if (data[0] === 2 && data.length === 5 && computeUnitLimit == null) {
        computeUnitLimit = BigInt(data.readUInt32LE(1));
        if (computeUnitLimit <= BigInt(0) || computeUnitLimit > MAX_COMPUTE_UNITS) {
          throw new Error("Compute unit limit exceeds trade policy");
        }
      } else if (data[0] === 3 && data.length === 9 && computeUnitPrice == null) {
        computeUnitPrice = data.readBigUInt64LE(1);
      } else {
        throw new Error("Unexpected compute budget instruction");
      }
    }

    if (program.equals(SystemProgram.programId)) {
      const data = Buffer.from(instruction.data);
      if (data.length !== 12 || data.readUInt32LE(0) !== 2 || instruction.accountKeyIndexes.length < 2) {
        throw new Error("Unexpected system instruction");
      }
      const source = accountAt(keys, instruction.accountKeyIndexes[0]);
      const destination = accountAt(keys, instruction.accountKeyIndexes[1]);
      if (!source.equals(owner)) {
        throw new Error("Unexpected system transfer source");
      }
      const lamports = data.readBigUInt64LE(4);
      const documentedFee = input.action === "buy"
        ? (input.amountRaw * PUMPAPI_TRADE_FEE_BPS) / BPS_DENOMINATOR
        : (input.expectedOutputRaw * PUMPAPI_TRADE_FEE_BPS + BPS_DENOMINATOR - BigInt(1)) / BPS_DENOMINATOR;
      const maximumSellFee = documentedFee + BigInt(1_000);

      if (
        input.action === "buy"
        && destination.equals(ownerWrappedSolAta)
        && lamports === input.amountRaw
        && !sawBuyInputTransfer
      ) {
        sawBuyInputTransfer = true;
      } else if (
        destination.equals(PUMPAPI_FEE_RECIPIENT)
        && !sawProviderFeeTransfer
        && (
          (input.action === "buy" && (lamports === documentedFee || lamports === documentedFee + BigInt(1)))
          || (input.action === "sell" && lamports <= maximumSellFee)
        )
      ) {
        sawProviderFeeTransfer = true;
      } else {
        throw new Error("Unexpected system transfer recipient or amount");
      }
    }

    if (program.equals(TOKEN_PROGRAM_ID) || program.equals(TOKEN_2022_PROGRAM_ID)) {
      // PumpApi's top-level token instructions only need CloseAccount and
      // SyncNative. Actual AMM token movement happens inside the trusted swap
      // program. Reject top-level Transfer/Approve/Burn instructions outright.
      const tag = instruction.data[0];
      if (tag !== 9 && tag !== 17) throw new Error("Unexpected token instruction");
    }
  }

  if (computeUnitLimit == null || computeUnitPrice == null) throw new Error("Missing compute budget bounds");
  const priorityFee = (computeUnitLimit * computeUnitPrice + MICRO_LAMPORTS_PER_LAMPORT - BigInt(1))
    / MICRO_LAMPORTS_PER_LAMPORT;
  const configuredPriorityFee = input.priorityFeeLamports ?? BigInt(100_000);
  const requestedPriorityFee = configuredPriorityFee < BigInt(0)
    ? BigInt(0)
    : configuredPriorityFee > MAX_PRIORITY_FEE_LAMPORTS
      ? MAX_PRIORITY_FEE_LAMPORTS
      : configuredPriorityFee;
  if (priorityFee > requestedPriorityFee) throw new Error("Priority fee exceeds trade policy");
}

export function validatePumpApiInstructionPolicy(
  tx: VersionedTransaction,
  input: PumpApiTradeInput,
  addressLookupTableAccounts: AddressLookupTableAccount[] = [],
): void {
  const keys = tx.message.getAccountKeys({ addressLookupTableAccounts });
  validateInstructionPolicy(tx, keys, input);
}

async function resolveAndValidateContext(
  tx: VersionedTransaction,
  connection: Connection,
  mint: PublicKey,
  input: PumpApiTradeInput,
): Promise<number> {
  const lookups: AddressLookupTableAccount[] = [];
  for (const lookup of tx.message.addressTableLookups) {
    const result = await connection.getAddressLookupTable(lookup.accountKey);
    if (!result.value) throw new Error("Missing address lookup table");
    lookups.push(result.value);
  }
  let keys: ReturnType<typeof tx.message.getAccountKeys>;
  try { keys = tx.message.getAccountKeys({ addressLookupTableAccounts: lookups }); }
  catch { throw new Error("Invalid address lookup table"); }
  if (keys.length > MAX_ACCOUNT_KEYS) throw new Error("Transaction exceeds limits");
  const has = (key: PublicKey) => Array.from({ length: keys.length }, (_, i) => keys.get(i)).some((x) => x?.equals(key) ?? false);
  const poolId = new PublicKey(input.poolId);
  const quoteMint = new PublicKey(input.quoteMint);
  if (!has(mint) || !has(poolId) || !has(quoteMint) || !has(SystemProgram.programId) ||
      (!has(TOKEN_PROGRAM_ID) && !has(TOKEN_2022_PROGRAM_ID))) {
    throw new Error("Missing expected transaction accounts");
  }
  const mintInfo = await connection.getAccountInfo(mint);
  if (!mintInfo || (!mintInfo.owner.equals(TOKEN_PROGRAM_ID) && !mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID))) {
    throw new Error("Invalid token mint");
  }
  // A route may touch pool vaults, but it must never gain write access to an
  // unrelated token account owned by the signing worker. Inspect bounded
  // writable keys on-chain rather than trusting program allowlisting alone.
  const writable: PublicKey[] = [];
  for (let index = 0; index < keys.length; index++) {
    try {
      if (tx.message.isAccountWritable(index)) writable.push(accountAt(keys, index));
    } catch { throw new Error("Uninspectable writable transaction account"); }
  }
  if (writable.length > 48) throw new Error("Too many writable transaction accounts");
  const infos = await connection.getMultipleAccountsInfo(writable, "confirmed");
  const owner = new PublicKey(input.publicKey);
  for (let index = 0; index < infos.length; index++) {
    const account = infos[index];
    if (!account || (!account.owner.equals(TOKEN_PROGRAM_ID) && !account.owner.equals(TOKEN_2022_PROGRAM_ID))) continue;
    // SPL token account layout: mint [0..32), owner [32..64). Mint accounts
    // are shorter and do not have an owner at offset 32, so leave them alone.
    if (account.data.length < 72) continue;
    const accountMint = new PublicKey(account.data.subarray(0, 32));
    const tokenOwner = new PublicKey(account.data.subarray(32, 64));
    if (tokenOwner.equals(owner) && !accountMint.equals(mint) && !accountMint.equals(WRAPPED_SOL_MINT)) {
      throw new Error("Transaction may modify an unrelated owner token account");
    }
  }
  validatePumpApiInstructionPolicy(tx, input, lookups);
  return keys.length;
}

export async function getPumpApiLocalTransaction(
  input: PumpApiTradeInput,
  options: { connection?: Connection; fetchFn?: typeof fetch; timeoutMs?: number } = {},
): Promise<PumpApiLocalTransaction> {
  const body = buildPumpApiRequest(input);
  const timeoutMs = options.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const fetchFn = options.fetchFn ?? fetch;
  let lastError: Error | undefined;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await sleep(250 * attempt);
      try {
        await pace(controller.signal);
        const response = await fetchFn(PUMPAPI_URL, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal,
        });
        if (!response.ok) {
          if (response.status === 429 || response.status >= 500) { lastError = new Error(`PumpApi failed (${response.status})`); continue; }
          throw new Error(`PumpApi failed (${response.status})`);
        }
        const bytes = await readPumpApiResponse(response);
        const tx = parsePumpApiTransaction(bytes, input.publicKey);
        const connection = options.connection ?? new Connection("https://api.mainnet-beta.solana.com", "confirmed");
        const accountKeyCount = await withAbort(resolveAndValidateContext(tx, connection, new PublicKey(input.mint), input), controller.signal);
        const requestedPriority = input.priorityFeeLamports ?? BigInt(0);
        const priorityFeeLamports = requestedPriority > MAX_PRIORITY_FEE_LAMPORTS ? MAX_PRIORITY_FEE_LAMPORTS : requestedPriority;
        return { transactionBase64: Buffer.from(bytes).toString("base64"), action: input.action, mint: input.mint,
          amount: body.amount as string, priorityFeeLamports,
          recentBlockhash: tx.message.recentBlockhash, accountKeyCount, instructionCount: tx.message.compiledInstructions.length };
      } catch (error) {
        if (controller.signal.aborted) throw new Error("PumpApi timeout");
        if (error instanceof Error && /^PumpApi failed \((429|5\d\d)\)$/.test(error.message)) { lastError = error; continue; }
        throw error;
      }
    }
    throw lastError ?? new Error("PumpApi unavailable");
  } finally { clearTimeout(timer); }
}