type AppealSignatureFields = {
  walletAddress: string;
  displayName: string;
  message: string;
  category: string;
  appealReason: string;
};

type AppealAuthorizationResult =
  | { ok: true }
  | { ok: false; error: "Authorization expired" | "Invalid wallet signature" | "Authorization already used" };

export function communityAppealSignatureMessage(
  fields: AppealSignatureFields,
  nonce: number,
): Uint8Array {
  return new TextEncoder().encode([
    "paif-community-appeal",
    "v1",
    fields.walletAddress,
    fields.displayName,
    fields.message,
    fields.category,
    fields.appealReason,
    String(nonce),
  ].join("|"));
}

export function communityAppealReadSignatureMessage(walletAddress: string, nonce: number): Uint8Array {
  return new TextEncoder().encode([
    "paif-community-appeals-read",
    "v1",
    walletAddress,
    String(nonce),
  ].join("|"));
}

export async function verifyCommunityAppealSignature(
  walletAddress: string,
  signature: string,
  message: Uint8Array,
): Promise<boolean> {
  try {
    const { ed25519 } = await import("@noble/curves/ed25519");
    const bs58 = (await import("bs58")).default;
    const publicKey = bs58.decode(walletAddress);
    const signatureBytes = bs58.decode(signature);
    if (publicKey.length !== 32 || signatureBytes.length !== 64) return false;
    return ed25519.verify(signatureBytes, message, publicKey);
  } catch {
    return false;
  }
}

export async function authorizeCommunityAppealSignature(args: {
  fields: AppealSignatureFields;
  nonce: number;
  signature: string;
  consumeSignature: (signature: string, purpose: string, walletAddress: string) => Promise<boolean>;
  now?: number;
}): Promise<AppealAuthorizationResult> {
  if (Math.abs((args.now ?? Date.now()) - args.nonce) > 5 * 60_000) {
    return { ok: false, error: "Authorization expired" };
  }
  const valid = await verifyCommunityAppealSignature(
    args.fields.walletAddress,
    args.signature,
    communityAppealSignatureMessage(args.fields, args.nonce),
  );
  if (!valid) return { ok: false, error: "Invalid wallet signature" };
  if (!await args.consumeSignature(args.signature, "community-appeal", args.fields.walletAddress)) {
    return { ok: false, error: "Authorization already used" };
  }
  return { ok: true };
}