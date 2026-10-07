/**
 * Wallet-derived (storage-free) bump-bot keys.
 *
 * Instead of generating random session/sub-wallet keypairs and persisting
 * them encrypted in localStorage (see `session-vault.ts` / `sub-wallets.ts`),
 * this module **derives** the keypairs deterministically from a single
 * Phantom signature:
 *
 *     session_seed = SHA-256( sig || "|session-wallet|v1" )
 *     sub_seed[i]  = SHA-256( sig || "|sub-wallet-" || i || "|v1" )
 *     keypair      = Keypair.fromSeed(seed)
 *
 * Properties this gives us:
 *   - **Zero storage** of anything sensitive. No vault file on the device,
 *     no encrypted blob on a server. Lost laptop ≠ lost funds.
 *   - **Any device**: connect the same Phantom wallet anywhere, sign once,
 *     same keypairs reappear. Same threat profile as a Phantom seed phrase
 *     (one layer down).
 *   - **No passphrase to remember.** One Phantom tap = unlock.
 *
 * Threat model (read carefully):
 *   - Anyone who ever obtains a signature of `deriveMessage(pubkey)` from
 *     this Phantom wallet can derive these exact bump-bot wallets. The
 *     canonical message is long, app-specific, and contains a stark warning
 *     so a phishing site would have to talk the user past obvious red
 *     flags. Still: only fund what you'd accept losing to client-side
 *     compromise of either this app OR any other site that gets the user
 *     to sign this exact message.
 *   - The derive message is intentionally distinct from the existing
 *     session-vault / sub-wallets unlock messages — a signature collected
 *     for one purpose cannot derive the other.
 *
 * Only a tiny non-sensitive descriptor is persisted in localStorage so the
 * UI can render addresses + a "tap to restore" button after a reload
 * without re-prompting Phantom on every page load.
 */
import { Keypair } from "@solana/web3.js";

const DERIVE_VERSION = "v1";
const PERSIST_KEY = "paif:derived:v1";

export const MAX_DERIVED_SUBS = 20;

/**
 * The exact bytes the user signs. Phantom will show this in its signing UI;
 * the long explicit warning is part of the safety story.
 *
 * IMPORTANT: changing this string changes every derived keypair. Bump the
 * version suffix and ship a migration path before doing so.
 */
export function deriveBumpBotMessage(walletPubkey: string): string {
  return [
    "PAIF.fun — Derive my bump-bot wallets",
    `Wallet: ${walletPubkey}`,
    `Version: ${DERIVE_VERSION}`,
    "",
    "WARNING: This signature mathematically generates every bump-bot",
    "session and sub-wallet linked to your Phantom. Sign ONLY on the",
    "official paif.fun site. Anyone who obtains this signature can drain",
    "those wallets. Signing does not by itself move any funds.",
  ].join("\n");
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Given a 64-byte ed25519 signature over `deriveBumpBotMessage(walletPubkey)`,
 * deterministically derive the session keypair + `subCount` sub-wallets.
 */
export async function deriveBumpBotKeys(
  signatureBytes: Uint8Array,
  subCount: number,
): Promise<{ session: Keypair; subs: Keypair[] }> {
  if (!signatureBytes || signatureBytes.length !== 64) {
    throw new Error("Wallet signature must be exactly 64 bytes");
  }
  if (!Number.isInteger(subCount) || subCount < 0 || subCount > MAX_DERIVED_SUBS) {
    throw new Error(`Sub-wallet count must be an integer between 0 and ${MAX_DERIVED_SUBS}`);
  }
  const enc = new TextEncoder();
  const sessionSeed = await sha256(
    concat(signatureBytes, enc.encode(`|session-wallet|${DERIVE_VERSION}`)),
  );
  const session = Keypair.fromSeed(sessionSeed);
  const subs: Keypair[] = [];
  for (let i = 0; i < subCount; i++) {
    const subSeed = await sha256(
      concat(signatureBytes, enc.encode(`|sub-wallet-${i}|${DERIVE_VERSION}`)),
    );
    subs.push(Keypair.fromSeed(subSeed));
  }
  return { session, subs };
}

/**
 * Non-sensitive descriptor we keep in localStorage so a fresh page load
 * can show "you have a derived wallet set, tap to restore" without forcing
 * the user to remember whether they ever set up derived mode. Contains
 * only public information.
 */
export interface DerivedConfig {
  v: 1;
  signer: string;            // base58 pubkey of the Phantom wallet that signed
  subCount: number;          // how many sub-wallets to derive
  sessionPubkey: string;     // derived session pubkey (for display + Platform Holdings)
  subPubkeys: string[];      // derived sub pubkeys (display + holdings checks)
  createdAt: number;
}

export function readDerivedConfig(): DerivedConfig | null {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as DerivedConfig;
    if (
      p?.v !== 1 ||
      typeof p.signer !== "string" ||
      typeof p.sessionPubkey !== "string" ||
      !Array.isArray(p.subPubkeys) ||
      !Number.isInteger(p.subCount)
    ) {
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

export function writeDerivedConfig(c: Omit<DerivedConfig, "v" | "createdAt">): void {
  const payload: DerivedConfig = { v: 1, createdAt: Date.now(), ...c };
  localStorage.setItem(PERSIST_KEY, JSON.stringify(payload));
}

export function clearDerivedConfig(): void {
  localStorage.removeItem(PERSIST_KEY);
}
