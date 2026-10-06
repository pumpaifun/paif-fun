import bs58 from "bs58";

export async function signWalletWrite(
  signMessage: ((message: Uint8Array) => Promise<Uint8Array>) | undefined,
  namespace: string,
  fields: Array<string | number>,
): Promise<{ nonce: number; signature: string }> {
  if (!signMessage) {
    throw new Error("Your wallet cannot sign messages. Reconnect it and try again.");
  }
  const nonce = Date.now();
  const message = [namespace, "v1", ...fields.map(String), String(nonce)].join("|");
  const signature = bs58.encode(await signMessage(new TextEncoder().encode(message)));
  return { nonce, signature };
}