import { ed25519 } from '@noble/curves/ed25519';
import { Buffer } from 'buffer';

// MWA sign_messages returns the exact message bytes with signature(s) appended.
// This companion requests one message from one account and permits no extras.
export function verifyWalletPayload(payload: Uint8Array, message: Uint8Array, publicKey: Uint8Array): string {
  if (publicKey.length !== 32 || payload.length !== message.length + 64) {
    throw new Error('The wallet returned an unexpected signed-message format.');
  }
  for (let i = 0; i < message.length; i++) {
    if (payload[i] !== message[i]) throw new Error('The wallet signed a different message. Verification failed.');
  }
  const signature = payload.slice(message.length);
  if (!ed25519.verify(signature, message, publicKey)) {
    throw new Error('The wallet signature did not match the connected account.');
  }
  return Buffer.from(signature).toString('base64');
}
