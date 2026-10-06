import { TurboModuleRegistry } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { z } from 'zod';
import { verifyWalletPayload } from './wallet-proof';
import type { WalletAccount, WalletProof } from './wallet-adapter';

export type { WalletAccount, WalletProof } from './wallet-adapter';
export const supported = TurboModuleRegistry.get('SolanaMobileWalletAdapter') !== null;
const KEY = 'paif.mwa.authorization.v1';
const metadataSchema = z.object({
  authToken: z.string().min(1),
  base64Address: z.string().min(1),
  address: z.string().min(32).max(44),
});

function identity() {
  const uri = Constants.expoConfig?.extra?.walletIdentityUri;
  if (typeof uri !== 'string' || !/^https:\/\/[^/]+\/?$/.test(uri)) {
    throw new Error('This Android build is missing its verified PAIF wallet identity.');
  }
  return { name: 'PAIF.fun', uri, icon: 'favicon.png' };
}

async function sdk() {
  if (!supported) {
    throw new Error('Native wallet support is unavailable in Expo Go. Install the custom Android APK with Mobile Wallet Adapter included.');
  }
  // Import only after detecting the native bridge. The SDK enforces its native
  // module on import; static imports would crash Expo Go before the UI could load.
  return import('@solana-mobile/mobile-wallet-adapter-protocol-web3js');
}

async function metadata() {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try { return metadataSchema.parse(JSON.parse(raw)); }
  catch {
    await SecureStore.deleteItemAsync(KEY);
    throw new Error('Saved wallet authorization could not be read. It was cleared; connect again.');
  }
}

function friendly(cause: unknown): Error {
  const error = cause as { code?: string | number; message?: string };
  if (error.code === 'ERROR_WALLET_NOT_FOUND') return new Error('No compatible Android wallet was found. Install a Mobile Wallet Adapter wallet and retry.');
  if (error.code === 'ERROR_ASSOCIATION_CANCELLED' || error.code === -3) return new Error('The wallet request was cancelled or the signature was declined. Nothing was sent.');
  if (error.code === -1) return new Error('Wallet authorization was declined or expired. Connect again to approve a new session.');
  if (error.code === 'ERROR_SESSION_TIMEOUT') return new Error('The wallet did not respond in time. Open the wallet, then retry.');
  return new Error(error.message || 'The native wallet request failed. Nothing was sent.');
}

export async function connectWallet(): Promise<WalletAccount> {
  try {
    const { transact } = await sdk();
    const prior = await metadata();
    return await transact(async (wallet) => {
      const authorization = await wallet.authorize({
        chain: 'solana:mainnet', identity: identity(), auth_token: prior?.authToken,
      });
      const account = authorization.accounts[0];
      if (!account) throw new Error('The wallet did not authorize an account.');
      const publicKey = Buffer.from(account.address, 'base64');
      if (publicKey.length !== 32) throw new Error('The wallet returned an invalid Solana account.');
      const address = bs58.encode(publicKey);
      await SecureStore.setItemAsync(KEY, JSON.stringify({
        authToken: authorization.auth_token, base64Address: account.address, address,
      }));
      return { address };
    });
  } catch (cause) {
    if ((cause as { code?: number }).code === -1) await SecureStore.deleteItemAsync(KEY);
    throw friendly(cause);
  }
}

export async function disconnectWallet(): Promise<void> {
  let failure: unknown;
  try {
    const prior = await metadata();
    if (prior) {
      const { transact } = await sdk();
      await transact((wallet) => wallet.deauthorize({ auth_token: prior.authToken }));
    }
  } catch (cause) { failure = cause; }
  finally { await SecureStore.deleteItemAsync(KEY); }
  if (failure) throw new Error(`Disconnected locally, but wallet revocation failed: ${friendly(failure).message}`);
}

export async function signWalletDemo(expectedAddress: string): Promise<WalletProof> {
  try {
    const { transact } = await sdk();
    const prior = await metadata();
    if (!prior || prior.address !== expectedAddress) throw new Error('The wallet authorization changed. Connect again before signing.');
    return await transact(async (wallet) => {
      const authorization = await wallet.authorize({
        chain: 'solana:mainnet', identity: identity(), auth_token: prior.authToken,
      });
      const account = authorization.accounts.find((item) => item.address === prior.base64Address);
      if (!account) throw new Error('The authorized wallet account changed. Reconnect before signing.');
      const message = [
        'PAIF.fun Android — message signing demonstration',
        `Wallet: ${expectedAddress}`,
        `Issued at: ${new Date().toISOString()}`,
        `Request: ${Date.now()}-${Math.random().toString(36).slice(2)}`,
        'This signature demonstrates local wallet ownership only.',
        'It does not authorize a trade, transfer funds, unlock paid tools, or sign into the PAIF backend.',
      ].join('\n');
      const bytes = new Uint8Array(Buffer.from(message, 'utf8'));
      const payloads = await wallet.signMessages({ addresses: [account.address], payloads: [bytes] });
      if (payloads.length !== 1) throw new Error('The wallet returned an unexpected number of signed messages.');
      const signature = verifyWalletPayload(payloads[0], bytes, new Uint8Array(Buffer.from(account.address, 'base64')));
      await SecureStore.setItemAsync(KEY, JSON.stringify({ ...prior, authToken: authorization.auth_token }));
      return { message, signature, verified: true, address: expectedAddress };
    });
  } catch (cause) {
    if ((cause as { code?: number }).code === -1) await SecureStore.deleteItemAsync(KEY);
    throw friendly(cause);
  }
}
