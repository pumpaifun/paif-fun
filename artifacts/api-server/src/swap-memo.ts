import {
  Connection,
  PublicKey,
  TransactionMessage,
  TransactionInstruction,
  VersionedTransaction,
  AddressLookupTableAccount,
} from "@solana/web3.js";

export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export async function injectMemoIntoSwap(
  conn: Connection,
  b64SwapTx: string,
  memoText: string,
): Promise<string> {
  const tx = VersionedTransaction.deserialize(Buffer.from(b64SwapTx, "base64"));
  const altKeys = tx.message.addressTableLookups.map(l => l.accountKey);
  const altAccounts: AddressLookupTableAccount[] = await Promise.all(
    altKeys.map(async key => {
      const r = await conn.getAddressLookupTable(key);
      if (!r.value) {
        throw new Error(`Failed to resolve address lookup table ${key.toBase58()}`);
      }
      return r.value;
    }),
  );
  const decompiled = TransactionMessage.decompile(tx.message, {
    addressLookupTableAccounts: altAccounts,
  });
  decompiled.instructions.push(new TransactionInstruction({
    keys: [],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memoText, "utf8"),
  }));
  const newMsg = decompiled.compileToV0Message(altAccounts);
  return Buffer.from(new VersionedTransaction(newMsg).serialize()).toString("base64");
}
