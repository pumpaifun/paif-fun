// ─── EVM (BNB Chain) buyback primitives ──────────────────────────────────────
// LOW-LEVEL, namespace-agnostic helpers shared by BOTH the PAIF admin pool
// (server/buyback-admin.ts) and the multi-tenant community buybacks
// This file is the EVM twin of swap-memo.ts:
// it knows how to BUILD a PancakeSwap V2 buy and how to VERIFY a broadcast
// one. It must NOT contain any PAIF-vs-community namespace logic, intent-table
// access, or credit accounting — those live in the two caller modules and are
// deliberately never shared.
//
// Anti-replay model (mirrors the Solana memo-nonce, adapted to EVM):
//   • treasury signed         — tx.from === declared treasury
//   • on-chain nonce binding  — server nonce is appended as a hex suffix to
//                               the swap calldata; verify checks input endsWith
//   • token balance increased — sum ERC-20 Transfer logs (token → treasury)
//   • native BNB spent ≥ intent — tx.value >= the intent's expected wei
import { encodeFunctionData, getAddress, parseAbi } from "viem";
import { getEvmClient } from "./evm";

// PancakeSwap V2 router (BNB Chain mainnet) + Wrapped BNB.
export const PANCAKE_ROUTER = getAddress("0x10ED43C718714eb63d5aA57B78B54704E256024E");
export const WBNB = getAddress("0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c");

// keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const ROUTER_ABI = parseAbi([
  "function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] path, address to, uint deadline) payable",
]);

const DEFAULT_MAX_AGE_SEC = 60 * 60; // 1h — a buyback must be recorded promptly.

function normalizeNonce(nonceHex: string): string {
  const n = nonceHex.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{8,40}$/.test(n)) {
    throw new Error("Invalid EVM nonce — expected 8-40 hex chars.");
  }
  return n;
}

// Sum every ERC-20 Transfer(token → `to`) in a receipt. Returns raw atoms.
function sumTransfersTo(receipt: any, token: string, to: string): bigint {
  const tokenAddr = getAddress(token).toLowerCase();
  const toTopic = "0x" + getAddress(to).toLowerCase().slice(2).padStart(64, "0");
  let sum = 0n;
  for (const log of receipt?.logs ?? []) {
    if (String(log.address).toLowerCase() !== tokenAddr) continue;
    const topics: string[] = log.topics ?? [];
    if ((topics[0] ?? "").toLowerCase() !== TRANSFER_TOPIC) continue;
    if (topics.length < 3) continue;
    if ((topics[2] ?? "").toLowerCase() !== toTopic) continue;
    try { sum += BigInt(log.data); } catch { /* skip malformed */ }
  }
  return sum;
}

// Build a PancakeSwap V2 "buy token with native BNB" transaction. The caller
// (PAIF or community module) supplies a server-issued nonce; we quote
// getAmountsOut, apply slippage, encode the swap, then APPEND the nonce hex to
// the calldata so the broadcast tx is provably bound to this exact intent.
export async function buildPancakeBuyTx(args: {
  tokenOut: string;
  recipient: string;
  valueWei: bigint;
  slippageBps: number;
  nonceHex: string;
}): Promise<{
  to: string;
  data: string;
  value: string;
  amountOutMinRaw: string;
  expectedOutRaw: string;
}> {
  const client = getEvmClient();
  const tokenOut = getAddress(args.tokenOut);
  const recipient = getAddress(args.recipient);
  const nonce = normalizeNonce(args.nonceHex);
  if (args.valueWei <= 0n) throw new Error("BNB amount must be greater than zero.");
  const path = [WBNB, tokenOut];

  let expectedOut: bigint;
  try {
    const amounts = (await client.readContract({
      address: PANCAKE_ROUTER,
      abi: ROUTER_ABI,
      functionName: "getAmountsOut",
      args: [args.valueWei, path],
    })) as bigint[];
    expectedOut = amounts[amounts.length - 1];
  } catch (e: any) {
    throw new Error(`No PancakeSwap V2 route for this token: ${e?.shortMessage || e?.message || e}`);
  }
  if (expectedOut <= 0n) {
    throw new Error("PancakeSwap returned a zero quote — token may lack BNB liquidity.");
  }

  const slippage = BigInt(Math.max(10, Math.min(2000, Math.round(args.slippageBps))));
  const amountOutMin = (expectedOut * (10000n - slippage)) / 10000n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);

  const data = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens",
    args: [amountOutMin, path, recipient, deadline],
  });
  const dataWithNonce = (data + nonce) as `0x${string}`;

  return {
    to: PANCAKE_ROUTER,
    data: dataWithNonce,
    value: args.valueWei.toString(),
    amountOutMinRaw: amountOutMin.toString(),
    expectedOutRaw: expectedOut.toString(),
  };
}

// Verify a broadcast, nonce-bound PancakeSwap buy. Enforces ALL four rules:
// treasury signed + router call + nonce suffix + value ≥ intent + token in.
export async function verifyPancakeBuyTx(args: {
  txHash: string;
  treasury: string;
  tokenOut: string;
  nonceHex: string;
  minValueWei: bigint;
  maxAgeSec?: number;
}): Promise<{ tokensReceivedRaw: string; valueWeiSpent: string }> {
  const client = getEvmClient();
  const hash = args.txHash as `0x${string}`;
  const treasury = getAddress(args.treasury);
  const nonce = normalizeNonce(args.nonceHex);

  const tx = await client.getTransaction({ hash }).catch(() => null);
  if (!tx) throw new Error("Transaction not found yet — wait for confirmation, then retry.");
  if (!tx.from || getAddress(tx.from) !== treasury) {
    throw new Error("Swap was not signed by the declared treasury wallet.");
  }
  if (!tx.to || getAddress(tx.to) !== PANCAKE_ROUTER) {
    throw new Error("Swap did not call the PancakeSwap V2 router.");
  }
  if (!String(tx.input).toLowerCase().endsWith(nonce)) {
    throw new Error("Swap is missing the required on-chain nonce binding — refusing to record.");
  }
  if (tx.value < args.minValueWei) {
    throw new Error(`Swap spent ${tx.value} wei but the intent expected at least ${args.minValueWei}.`);
  }

  const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
  if (!receipt) throw new Error("Receipt not available yet — wait for confirmation, then retry.");
  if (receipt.status !== "success") throw new Error("Swap failed on-chain (reverted).");

  const maxAge = args.maxAgeSec ?? DEFAULT_MAX_AGE_SEC;
  try {
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    const ageSec = Math.floor(Date.now() / 1000) - Number(block.timestamp);
    if (ageSec > maxAge) {
      throw new Error(`Swap is too old (${Math.floor(ageSec / 60)}m) — must be recorded within ${Math.floor(maxAge / 60)}m.`);
    }
  } catch (e: any) {
    if (/too old/.test(String(e?.message))) throw e;
    // Block fetch failed for an unrelated reason — don't block recording on it.
  }

  const received = sumTransfersTo(receipt, args.tokenOut, treasury);
  if (received <= 0n) throw new Error("Swap did not increase the treasury's token balance.");

  return { tokensReceivedRaw: received.toString(), valueWeiSpent: tx.value.toString() };
}

// Verify an arbitrary, manually-pasted buyback (no server nonce). Looser than
// the nonce-bound path — used by the "record a buyback" form. Still proves the
// declared treasury signed it, it succeeded, native BNB was spent, and the
// declared token landed in the treasury.
export async function verifyManualPancakeBuy(args: {
  txHash: string;
  treasury: string;
  tokenOut: string;
}): Promise<{ tokensReceivedRaw: string; valueWeiSpent: string }> {
  const client = getEvmClient();
  const hash = args.txHash as `0x${string}`;
  const treasury = getAddress(args.treasury);

  const tx = await client.getTransaction({ hash }).catch(() => null);
  if (!tx) throw new Error("Transaction not found — make sure it's confirmed on BNB Chain.");
  if (!tx.from || getAddress(tx.from) !== treasury) {
    throw new Error("Transaction was not signed by the declared treasury wallet.");
  }
  if (tx.value <= 0n) {
    throw new Error("Transaction spent no native BNB — a buyback must spend BNB.");
  }

  const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
  if (!receipt) throw new Error("Receipt not available — make sure the tx is confirmed.");
  if (receipt.status !== "success") throw new Error("Transaction failed on-chain (reverted).");

  const received = sumTransfersTo(receipt, args.tokenOut, treasury);
  if (received <= 0n) {
    throw new Error("Transaction did not increase the treasury's balance of the declared token.");
  }

  return { tokensReceivedRaw: received.toString(), valueWeiSpent: tx.value.toString() };
}
