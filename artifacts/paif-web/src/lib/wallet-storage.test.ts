import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import { deriveBumpBotKeys } from "./derived-wallets";
import { saveToVaultWithSignature, unlockVault, unlockVaultWithSignature } from "./session-vault";
import { unlockSubWallets } from "./sub-wallets";

// Synthetic, unfunded fixtures only. Never obtain signatures from a real wallet.
const records = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => records.set(key, value),
    removeItem: (key: string) => records.delete(key),
  },
});
const fixtureWallet = Keypair.fromSeed(new Uint8Array(32).fill(7));
const passphrase = "synthetic-fixture-only";
const signatureBacking = new Uint8Array(80).map((_, i) => i);
const signature = signatureBacking.subarray(8, 72);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

function legacyPayload(raw: Uint8Array, plaintext: Uint8Array) {
  const salt = new Uint8Array(16).fill(3);
  const iv = new Uint8Array(12).fill(4);
  const key = pbkdf2Sync(raw, salt, 210_000, 32, "sha256");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct), createdAt: 1 };
}

test("derived wallets retain the existing SHA-256 domains with offset input views", async () => {
  const result = await deriveBumpBotKeys(signature, 2);
  const expected = (suffix: string) => Keypair.fromSeed(
    createHash("sha256").update(signature).update(suffix).digest(),
  ).publicKey.toBase58();
  assert.equal(result.session.publicKey.toBase58(), expected("|session-wallet|v1"));
  assert.deepEqual(result.subs.map(k => k.publicKey.toBase58()), [
    expected("|sub-wallet-0|v1"), expected("|sub-wallet-1|v1"),
  ]);
});

test("legacy session and sub-wallet vaults still decrypt and reject a wrong passphrase", async () => {
  const raw = new TextEncoder().encode(passphrase);
  const payload = legacyPayload(raw, fixtureWallet.secretKey);
  records.set("paif:bumpSession:v1", JSON.stringify({
    ...payload, pubkey: fixtureWallet.publicKey.toBase58(),
  }));
  assert.deepEqual(await unlockVault(passphrase), fixtureWallet.secretKey);
  await assert.rejects(unlockVault("incorrect-fixture-passphrase"), /Wrong passphrase/);
  records.set("paif:bumpSubWallets:v1", JSON.stringify({
    ...payload, pubkeys: [fixtureWallet.publicKey.toBase58()],
  }));
  const keys = await unlockSubWallets(passphrase);
  assert.deepEqual(keys[0].secretKey, fixtureWallet.secretKey);
});

test("signature vaults preserve byte-for-byte encryption compatibility and owner checks", async () => {
  const owner = fixtureWallet.publicKey.toBase58();
  const old = legacyPayload(signature, fixtureWallet.secretKey);
  records.set("paif:bumpSession:v1", JSON.stringify({
    ...old, v: 2, mode: "signature", signer: owner, pubkey: owner,
  }));
  assert.deepEqual(await unlockVaultWithSignature(signature, owner), fixtureWallet.secretKey);
  await assert.rejects(unlockVaultWithSignature(signature, "different-owner"));
  await saveToVaultWithSignature(fixtureWallet.secretKey, owner, signature, owner);
  const saved = JSON.parse(records.get("paif:bumpSession:v1")!);
  const key = pbkdf2Sync(signature, Buffer.from(saved.salt, "base64"), 210_000, 32, "sha256");
  const ct = Buffer.from(saved.ct, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(saved.iv, "base64"));
  decipher.setAuthTag(ct.subarray(-16));
  const plaintext = Buffer.concat([decipher.update(ct.subarray(0, -16)), decipher.final()]);
  assert.deepEqual(new Uint8Array(plaintext), fixtureWallet.secretKey);
  assert.deepEqual(await unlockVaultWithSignature(signature, owner), fixtureWallet.secretKey);
});
