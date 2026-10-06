/**
 * Encrypted local vault for the bump-bot session wallet.
 *
 * Two unlock modes are supported:
 *   1. "passphrase" — user types a passphrase (PBKDF2 → AES-GCM-256).
 *   2. "signature"  — user signs a fixed wallet-bound message with their
 *      connected wallet (e.g. Phantom). ed25519 signatures are deterministic
 *      per (wallet, message), so the same wallet always reproduces the same
 *      key without us ever storing the signature. Friendlier for mobile.
 *
 * Storage layout (localStorage `paif:bumpSession:v1`):
 *   {
 *     v: 1 | 2,
 *     mode?: "passphrase" | "signature",   // absent on legacy v1 → passphrase
 *     signer?: string,                     // base58 pubkey, signature mode only
 *     salt, iv, ct,                        // AES-GCM ciphertext of secret key
 *     pubkey: string,                      // visible before unlock for display
 *     createdAt: number,
 *   }
 *
 * Threat model:
 *   - Tab refresh / restart wiping in-memory key: protected.
 *   - Casual localStorage snooping: protected.
 *   - Active malware / XSS in this app: NOT protected.
 *
 * Always recommend only funding what the user is willing to lose to
 * client-side compromise.
 */

const STORAGE_KEY = "paif:bumpSession:v1";
const PBKDF2_ITERS = 210_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export type SessionVaultUnlockMode = "passphrase" | "signature";

/**
 * Canonical message the user signs to derive the session-wallet encryption
 * key. Bound to the wallet pubkey for clarity in Phantom's UI and to prevent
 * accidental collisions across wallets.
 *
 * IMPORTANT: changing this string breaks every existing signature-mode vault.
 * Bump the version suffix and add a migration path if you ever need to.
 */
export function sessionVaultUnlockMessage(walletPubkey: string): string {
  return [
    "PAIF.fun — Unlock bump-bot session wallet",
    `Wallet: ${walletPubkey}`,
    "Version: 1",
    "",
    "Signing this is safe. It derives the local encryption key for your",
    "browser session wallet and never moves any funds.",
  ].join("\n");
}

interface VaultPayload {
  v: 1 | 2;
  mode?: SessionVaultUnlockMode;
  signer?: string;
  salt: string;
  iv: string;
  ct: string;
  pubkey: string;
  createdAt: number;
}

// ─── encoding helpers ──────────────────────────────────────────────────────
function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKeyFromBytes(rawSecret: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    rawSecret,
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function deriveKeyFromPassphrase(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  return deriveKeyFromBytes(new TextEncoder().encode(passphrase), salt);
}

function readPayload(): VaultPayload | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as VaultPayload;
    if (!p || (p.v !== 1 && p.v !== 2)) return null;
    if (!p.ct || !p.salt || !p.iv) return null;
    return p;
  } catch {
    return null;
  }
}

// ─── public api ────────────────────────────────────────────────────────────
export function vaultExists(): boolean {
  return !!readPayload();
}

export function vaultPublicKey(): string | null {
  return readPayload()?.pubkey ?? null;
}

export function vaultCreatedAt(): number | null {
  return readPayload()?.createdAt ?? null;
}

/**
 * What unlock mode is the current vault using?
 * Returns null if no vault is stored. Legacy v1 vaults (no `mode` field)
 * are reported as "passphrase" — that was the only mode before v2.
 */
export function sessionVaultUnlockModeStored(): SessionVaultUnlockMode | null {
  const p = readPayload();
  if (!p) return null;
  return p.mode ?? "passphrase";
}

/**
 * For signature-mode vaults, the pubkey of the wallet that signed the
 * unlock message at create time. Lets the UI tell users "connect wallet X
 * to unlock" if they connect a different wallet.
 */
export function sessionVaultSignerPubkey(): string | null {
  const p = readPayload();
  if (!p || p.mode !== "signature") return null;
  return p.signer ?? null;
}

async function encryptSecret(
  secretKey: Uint8Array,
  key: CryptoKey,
  iv: Uint8Array,
): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, secretKey),
  );
}

function persist(
  publicKeyBase58: string,
  ct: Uint8Array,
  salt: Uint8Array,
  iv: Uint8Array,
  mode: SessionVaultUnlockMode,
  signer: string | null,
) {
  const payload: VaultPayload = {
    v: 2,
    mode,
    ...(signer ? { signer } : {}),
    salt: toB64(salt),
    iv: toB64(iv),
    ct: toB64(ct),
    pubkey: publicKeyBase58,
    createdAt: Date.now(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export async function saveToVault(
  secretKey: Uint8Array,
  publicKeyBase58: string,
  passphrase: string,
): Promise<void> {
  if (secretKey.length !== 64) throw new Error("Invalid secret key length");
  if (!passphrase || passphrase.length < 6) {
    throw new Error("Passphrase must be at least 6 characters");
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKeyFromPassphrase(passphrase, salt);
  const ct = await encryptSecret(secretKey, key, iv);
  persist(publicKeyBase58, ct, salt, iv, "passphrase", null);
}

/**
 * Save the session secret key encrypted under a wallet-signature key. The
 * caller obtains `signatureBytes` by asking the connected wallet to sign
 * `sessionVaultUnlockMessage(signerPubkey)` via signMessage.
 */
export async function saveToVaultWithSignature(
  secretKey: Uint8Array,
  publicKeyBase58: string,
  signatureBytes: Uint8Array,
  signerPubkey: string,
): Promise<void> {
  if (secretKey.length !== 64) throw new Error("Invalid secret key length");
  if (!signatureBytes || signatureBytes.length !== 64) {
    throw new Error("Wallet signature is missing or malformed (expected 64-byte ed25519 signature)");
  }
  if (!signerPubkey) throw new Error("Signer pubkey is required");
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKeyFromBytes(signatureBytes, salt);
  const ct = await encryptSecret(secretKey, key, iv);
  persist(publicKeyBase58, ct, salt, iv, "signature", signerPubkey);
}

async function decryptSecret(
  payload: VaultPayload,
  key: CryptoKey,
): Promise<Uint8Array> {
  const iv = fromB64(payload.iv);
  const ct = fromB64(payload.ct);
  try {
    const pt = new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct),
    );
    if (pt.length !== 64) throw new Error("Decrypted key has wrong length");
    return pt;
  } catch (err: any) {
    if (err?.message === "Decrypted key has wrong length") throw err;
    throw new Error(
      payload.mode === "signature"
        ? "Wrong wallet — this session was locked with a different wallet"
        : "Wrong passphrase",
    );
  }
}

export async function unlockVault(passphrase: string): Promise<Uint8Array> {
  const p = readPayload();
  if (!p) throw new Error("No saved session wallet found");
  const mode = p.mode ?? "passphrase";
  if (mode !== "passphrase") {
    throw new Error(
      "This session is locked with your wallet, not a passphrase. Use the Phantom unlock button.",
    );
  }
  const salt = fromB64(p.salt);
  const key = await deriveKeyFromPassphrase(passphrase, salt);
  return decryptSecret(p, key);
}

export async function unlockVaultWithSignature(
  signatureBytes: Uint8Array,
  signerPubkey: string,
): Promise<Uint8Array> {
  if (!signatureBytes || signatureBytes.length !== 64) {
    throw new Error("Wallet signature is missing or malformed (expected 64-byte ed25519 signature)");
  }
  const p = readPayload();
  if (!p) throw new Error("No saved session wallet found");
  const mode = p.mode ?? "passphrase";
  if (mode !== "signature") {
    throw new Error(
      "This session is locked with a passphrase. Type your passphrase to unlock.",
    );
  }
  if (p.signer && p.signer !== signerPubkey) {
    throw new Error(
      `This session is locked with ${p.signer.slice(0, 4)}…${p.signer.slice(-4)}. Connect that wallet to unlock.`,
    );
  }
  const salt = fromB64(p.salt);
  const key = await deriveKeyFromBytes(signatureBytes, salt);
  return decryptSecret(p, key);
}

/**
 * One-time migration: take an existing passphrase-encrypted session vault,
 * decrypt with the passphrase, then re-encrypt under a wallet signature.
 * The session pubkey + secret are preserved — balances and tokens are
 * completely unaffected.
 */
export async function migrateSessionVaultToSignature(
  passphrase: string,
  signatureBytes: Uint8Array,
  signerPubkey: string,
): Promise<void> {
  const p = readPayload();
  if (!p) throw new Error("No session vault to migrate");
  if ((p.mode ?? "passphrase") !== "passphrase") {
    throw new Error("Session vault is already in wallet-signature mode");
  }
  if (!signatureBytes || signatureBytes.length !== 64) {
    throw new Error("Wallet signature is missing or malformed (expected 64-byte ed25519 signature)");
  }
  if (!signerPubkey) throw new Error("Signer pubkey is required");
  const secret = await unlockVault(passphrase);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKeyFromBytes(signatureBytes, salt);
  const ct = await encryptSecret(secret, key, iv);
  persist(p.pubkey, ct, salt, iv, "signature", signerPubkey);
}

export function clearVault(): void {
  localStorage.removeItem(STORAGE_KEY);
}
