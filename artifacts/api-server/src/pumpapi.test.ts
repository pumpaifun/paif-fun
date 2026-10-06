import assert from "node:assert/strict";
import { getAssociatedTokenAddressSync, NATIVE_MINT } from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { buildPumpApiRequest, buildPumpApiRoundTripRequest, parsePumpApiTransaction, rawAmountToDecimal, readPumpApiResponse, validatePumpApiInstructionPolicy } from "./pumpapi";

assert.equal(rawAmountToDecimal(1234567890123456789n, 9), "1234567890.123456789");
assert.equal(rawAmountToDecimal(1000n, 3), "1");
const request = buildPumpApiRequest({
  publicKey: Keypair.generate().publicKey.toBase58(),
  action: "buy",
  mint: Keypair.generate().publicKey.toBase58(),
  poolId: Keypair.generate().publicKey.toBase58(),
  quoteMint: "So11111111111111111111111111111111111111112",
  amountRaw: 1_000_000n,
  tokenDecimals: 6,
  minimumOutputRaw: 10_000n,
  expectedOutputRaw: 11_000n,
  outputDecimals: 6,
  slippage: 5,
  priorityFeeLamports: 999999n,
});
assert.deepEqual(Object.keys(request).sort(), ["action", "amount", "denominatedInQuote", "maxQuoteAmountIn", "minBaseAmountOut", "mint", "poolId", "priorityFee", "publicKey", "quoteMint", "slippage"]);
assert.equal("privateKey" in request || "apiKey" in request, false, "local request allowlist never leaks secrets");
assert.equal(request.maxQuoteAmountIn, "0.001");
assert.equal(request.minBaseAmountOut, "0.01");
const roundTrip = buildPumpApiRoundTripRequest({
  publicKey: request.publicKey as string, mint: request.mint as string, poolId: request.poolId as string,
  quoteMint: request.quoteMint as string, amountRaw: 1_000_000n, tokenDecimals: 6, slippage: 5,
});
assert.deepEqual(Object.keys(roundTrip).sort(), ["actions"]);
assert.equal(JSON.stringify(roundTrip).includes("privateKey"), false);
assert.equal(JSON.stringify(roundTrip).includes("apiKey"), false);
assert.equal((roundTrip.actions as any[])[1].amount, "100%");
const exactRoundTrip = buildPumpApiRoundTripRequest({
  publicKey: request.publicKey as string, mint: request.mint as string, poolId: request.poolId as string,
  quoteMint: request.quoteMint as string, amountRaw: 1_000_000n, tokenDecimals: 6, slippage: 5,
  sellAmountRaw: 12_345_678n,
});
assert.equal((exactRoundTrip.actions as any[])[1].amount, "12.345678");

const payer = Keypair.generate();
const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })] }).compileToV0Message());
const bytes = tx.serialize();
assert.throws(() => parsePumpApiTransaction(new Uint8Array([123, 125]), payer.publicKey.toBase58()));
assert.throws(() => parsePumpApiTransaction(new Uint8Array([...bytes, ...bytes]), payer.publicKey.toBase58()));
assert.throws(() => parsePumpApiTransaction(bytes, Keypair.generate().publicKey.toBase58()));
await assert.rejects(() => readPumpApiResponse(new Response(new Uint8Array(20), { headers: { "content-length": "20" } }), 10));
await assert.rejects(() => readPumpApiResponse(new Response('{"not":"a tx"}', { headers: { "content-type": "application/json" } })));

const policyOwner = Keypair.generate();
const policyInput = {
  publicKey: policyOwner.publicKey.toBase58(),
  action: "buy" as const,
  mint: Keypair.generate().publicKey.toBase58(),
  poolId: Keypair.generate().publicKey.toBase58(),
  quoteMint: "So11111111111111111111111111111111111111112",
  amountRaw: 1_000_000n,
  tokenDecimals: 6,
  minimumOutputRaw: 10_000n,
  expectedOutputRaw: 11_000n,
  outputDecimals: 6,
  slippage: 1,
  priorityFeeLamports: 100_000n,
};
function policyTransaction(microLamports: bigint, feeRecipient: PublicKey): VersionedTransaction {
  return new VersionedTransaction(new TransactionMessage({
    payerKey: policyOwner.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
      SystemProgram.transfer({
        fromPubkey: policyOwner.publicKey,
        toPubkey: getAssociatedTokenAddressSync(NATIVE_MINT, policyOwner.publicKey),
        lamports: 1_000_000,
      }),
      SystemProgram.transfer({
        fromPubkey: policyOwner.publicKey,
        toPubkey: feeRecipient,
        lamports: 2_500,
      }),
    ],
  }).compileToV0Message());
}
const pumpApiFeeRecipient = new PublicKey("pump22QQQnff5qmAxW7yg6VEKU3C7Mj8C4TDaXJZt9Q");
assert.doesNotThrow(() => validatePumpApiInstructionPolicy(policyTransaction(400_000n, pumpApiFeeRecipient), policyInput));
assert.throws(() => validatePumpApiInstructionPolicy(policyTransaction(4_000_000n, pumpApiFeeRecipient), policyInput), /Priority fee/);
assert.throws(() => validatePumpApiInstructionPolicy(policyTransaction(400_000n, Keypair.generate().publicKey), policyInput), /recipient or amount/);
console.log("pumpapi tests passed");