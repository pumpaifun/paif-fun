/**
 * Encrypted bundle of "sub-wallets" the bump bot rotates through.
 *
 * Two unlock modes are supported:
 *   1. "passphrase" — user types a passphrase (PBKDF2 → AES-GCM key).
 *      Original mode, still available as a fallback / advanced option.
 *   2. "signature"  — user signs a fixed message with their connected wallet
 *      (e.g. Phantom). The ed25519 signature is deterministic per
 *      (wallet, message), so the same wallet always reproduces the same key.
 *      One tap, nothing typed — much friendlier for in-app mobile browsers.
 *
 * Storage layout (localStorage `paif:bumpSubWallets:v1`):
 *   {
 *     v: 1 | 2,
 *     mode?: "passphrase" | "signature",   // absent on legacy v1 → passphrase
 *     signer?: string,                     // base58 pubkey, signature mode only
 *     salt, iv, ct,                        // AES-GCM ciphertext
 *     pubkeys: string[],                   // visible before unlock for display
 *     createdAt: number,
 *   }
 *
 * The ciphertext is the concatenation of all secret keys (count × 64 bytes).
 *
 * Threat model:
 *   - Browser refresh / restart: protected (encrypted at rest).
 *   - Casual extension snooping: protected (need passphrase OR a signature
 *     from the matching wallet to read).
 *   - Active malware on the user's machine: NOT protected.
 *   - XSS in this app: NOT protected.
 *
 * Sub-wallets are throwaway "burners"; the user is expected to keep their
 * main wallet for principal storage and only fund sub-wallets with what
 * they're willing to lose to client-side compromise.
 */

import { Keypair } from "@solana/web3.js";

const STORAGE_KEY = "paif:bumpSubWallets:v1";
const PBKDF2_ITERS = 210_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const SECRET_LEN = 64;

// Default cap for free / paid (non-unlimited) tiers. Wallets that have
// purchased the unlimited credit pack get the higher cap below.
export const MAX_SUB_WALLETS = 10;
export const MAX_SUB_WALLETS_UNLIMITED = 100;

export type SubWalletUnlockMode = "passphrase" | "signature";

/**
 * Canonical message the user signs to derive the sub-wallet encryption key.
 * Binding the wallet pubkey into the message makes it self-documenting in
 * Phantom's signing UI and prevents accidental collisions across wallets.
 *
 * IMPORTANT: changing this string breaks every existing signature-mode vault.
 * Bump the version suffix and add a migration path if you ever need to.
 */
export function subWalletUnlockMessage(walletPubkey: string): string {
  return [
    "PAIF.fun — Unlock bump-bot sub-wallets",
    `Wallet: ${walletPubkey}`,
    "Version: 1",
    "",
    "Signing this is safe. It derives the local encryption key for your",
    "burner sub-wallets and never moves any funds.",
  ].join("\n");
}

interface SubWalletPayload {
  v: 1 | 2;
  mode?: SubWalletUnlockMode;
  signer?: string;
  salt: string;
  iv: string;
  ct: string;
  pubkeys: string[];
  createdAt: number;
}

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
    new Uint8Array(rawSecret),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: new Uint8Array(salt), iterations: PBKDF2_ITERS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function deriveKeyFromPassphrase(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  return deriveKeyFromBytes(new TextEncoder().encode(passphrase), salt);
}

function readPayload(): SubWalletPayload | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as SubWalletPayload;
    if (!p || (p.v !== 1 && p.v !== 2)) return null;
    return p;
  } catch {
    return null;
  }
}

export function subWalletsExist(): boolean {
  const p = readPayload();
  return !!(p && Array.isArray(p.pubkeys) && p.pubkeys.length > 0);
}

export function subWalletPublicKeys(): string[] {
  const p = readPayload();
  return Array.isArray(p?.pubkeys) ? p!.pubkeys : [];
}

export function subWalletsCreatedAt(): number | null {
  const p = readPayload();
  return p?.createdAt ?? null;
}

/**
 * What unlock mode is the current vault using?
 * Returns null if no vault is stored. Legacy v1 vaults (no `mode` field) are
 * reported as "passphrase" — that was the only mode before v2.
 */
export function subWalletUnlockModeStored(): SubWalletUnlockMode | null {
  const p = readPayload();
  if (!p) return null;
  return p.mode ?? "passphrase";
}

/**
 * For signature-mode vaults, the pubkey of the wallet that signed the unlock
 * message at create time. Lets the UI tell users "connect wallet X to unlock"
 * if they connect a different wallet. Returns null for passphrase vaults or
 * when no vault exists.
 */
export function subWalletSignerPubkey(): string | null {
  const p = readPayload();
  if (!p || p.mode !== "signature") return null;
  return p.signer ?? null;
}

function persist(
  keypairs: Keypair[],
  ct: Uint8Array,
  salt: Uint8Array,
  iv: Uint8Array,
  mode: SubWalletUnlockMode,
  signer: string | null,
) {
  const payload: SubWalletPayload = {
    v: 2,
    mode,
    ...(signer ? { signer } : {}),
    salt: toB64(salt),
    iv: toB64(iv),
    ct: toB64(ct),
    pubkeys: keypairs.map(k => k.publicKey.toBase58()),
    createdAt: Date.now(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

async function encryptBundle(
  keypairs: Keypair[],
  key: CryptoKey,
  salt: Uint8Array,
  iv: Uint8Array,
): Promise<Uint8Array> {
  const blob = new Uint8Array(keypairs.length * SECRET_LEN);
  for (let i = 0; i < keypairs.length; i++) blob.set(keypairs[i].secretKey, i * SECRET_LEN);
  return new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv) }, key, blob,
  ));
}

function checkCount(count: number, maxCount: number) {
  if (count < 1 || count > maxCount) {
    throw new Error(`Sub-wallet count must be between 1 and ${maxCount}`);
  }
}

/**
 * Generate `count` brand-new keypairs and store them encrypted under the
 * user's PASSPHRASE. Overwrites any existing bundle.
 */
export async function generateAndSaveSubWallets(
  count: number,
  passphrase: string,
  maxCount: number = MAX_SUB_WALLETS,
): Promise<Keypair[]> {
  checkCount(count, maxCount);
  if (!passphrase || passphrase.length < 6) {
    throw new Error("Passphrase must be at least 6 characters");
  }
  const keypairs = Array.from({ length: count }, () => Keypair.generate());
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKeyFromPassphrase(passphrase, salt);
  const ct = await encryptBundle(keypairs, key, salt, iv);
  persist(keypairs, ct, salt, iv, "passphrase", null);
  return keypairs;
}

/**
 * Generate `count` brand-new keypairs and store them encrypted under a key
 * derived from the user's WALLET SIGNATURE of `subWalletUnlockMessage(...)`.
 * The signature is reproducible (ed25519), so re-signing the same message
 * with the same wallet later will regenerate the same key and decrypt.
 *
 * `signatureBytes` should be the raw signature (64 bytes for ed25519).
 */
export async function generateAndSaveSubWalletsWithSignature(
  count: number,
  signatureBytes: Uint8Array,
  signerPubkey: string,
  maxCount: number = MAX_SUB_WALLETS,
): Promise<Keypair[]> {
  checkCount(count, maxCount);
  if (!signatureBytes || signatureBytes.length !== 64) {
    throw new Error("Wallet signature is missing or malformed (expected 64-byte ed25519 signature)");
  }
  if (!signerPubkey) throw new Error("Signer pubkey is required");
  const keypairs = Array.from({ length: count }, () => Keypair.generate());
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKeyFromBytes(signatureBytes, salt);
  const ct = await encryptBundle(keypairs, key, salt, iv);
  persist(keypairs, ct, salt, iv, "signature", signerPubkey);
  return keypairs;
}

async function decryptBundle(
  payload: SubWalletPayload,
  key: CryptoKey,
): Promise<Keypair[]> {
  const iv = fromB64(payload.iv);
  const ct = fromB64(payload.ct);
  let blob: Uint8Array;
  try {
    blob = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(iv) }, key, new Uint8Array(ct),
      ),
    );
  } catch {
    throw new Error(
      payload.mode === "signature"
        ? "Wrong wallet — this vault was locked with a different wallet"
        : "Wrong passphrase",
    );
  }
  if (blob.length === 0 || blob.length % SECRET_LEN !== 0) {
    throw new Error("Sub-wallet bundle is corrupted");
  }
  const count = blob.length / SECRET_LEN;
  const keypairs: Keypair[] = [];
  for (let i = 0; i < count; i++) {
    const sk = blob.slice(i * SECRET_LEN, (i + 1) * SECRET_LEN);
    keypairs.push(Keypair.fromSecretKey(sk));
  }
  return keypairs;
}

export async function unlockSubWallets(passphrase: string): Promise<Keypair[]> {
  const p = readPayload();
  if (!p) return [];
  const mode = p.mode ?? "passphrase";
  if (mode !== "passphrase") {
    throw new Error(
      "This vault is locked with your wallet, not a passphrase. Use the Phantom unlock button.",
    );
  }
  const salt = fromB64(p.salt);
  const key = await deriveKeyFromPassphrase(passphrase, salt);
  return decryptBundle(p, key);
}

export async function unlockSubWalletsWithSignature(
  signatureBytes: Uint8Array,
  signerPubkey: string,
): Promise<Keypair[]> {
  if (!signatureBytes || signatureBytes.length !== 64) {
    throw new Error("Wallet signature is missing or malformed (expected 64-byte ed25519 signature)");
  }
  const p = readPayload();
  if (!p) return [];
  const mode = p.mode ?? "passphrase";
  if (mode !== "signature") {
    throw new Error(
      "This vault is locked with a passphrase. Type your passphrase to unlock.",
    );
  }
  if (p.signer && p.signer !== signerPubkey) {
    throw new Error(
      `These sub-wallets are locked with ${p.signer.slice(0, 4)}…${p.signer.slice(-4)}. Connect that wallet to unlock.`,
    );
  }
  const salt = fromB64(p.salt);
  const key = await deriveKeyFromBytes(signatureBytes, salt);
  return decryptBundle(p, key);
}

/**
 * One-time migration: take an existing passphrase-encrypted vault, decrypt
 * with the passphrase, then re-encrypt under a wallet signature. Pubkeys
 * are preserved — sub-wallets and their balances are unaffected.
 */
export async function migrateVaultToSignature(
  passphrase: string,
  signatureBytes: Uint8Array,
  signerPubkey: string,
): Promise<Keypair[]> {
  const p = readPayload();
  if (!p) throw new Error("No sub-wallet vault to migrate");
  if ((p.mode ?? "passphrase") !== "passphrase") {
    throw new Error("Vault is already in wallet-signature mode");
  }
  if (!signatureBytes || signatureBytes.length !== 64) {
    throw new Error("Wallet signature is missing or malformed (expected 64-byte ed25519 signature)");
  }
  const keypairs = await unlockSubWallets(passphrase);
  if (keypairs.length === 0) throw new Error("Vault decrypted to nothing — aborting migration");
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKeyFromBytes(signatureBytes, salt);
  const ct = await encryptBundle(keypairs, key, salt, iv);
  persist(keypairs, ct, salt, iv, "signature", signerPubkey);
  return keypairs;
}

/**
 * Reverse migration: signature-mode → passphrase-mode. Useful if the user
 * changes their main wallet and wants to recover their sub-wallets by
 * setting a passphrase from the still-unlocked in-memory keypairs.
 */
export async function reEncryptUnderPassphrase(
  keypairs: Keypair[],
  passphrase: string,
): Promise<void> {
  if (!passphrase || passphrase.length < 6) {
    throw new Error("Passphrase must be at least 6 characters");
  }
  if (keypairs.length === 0) throw new Error("No keypairs to re-encrypt");
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKeyFromPassphrase(passphrase, salt);
  const ct = await encryptBundle(keypairs, key, salt, iv);
  persist(keypairs, ct, salt, iv, "passphrase", null);
}

export function clearSubWallets(): void {
  localStorage.removeItem(STORAGE_KEY);
}
