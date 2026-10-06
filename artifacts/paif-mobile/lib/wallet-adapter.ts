export interface WalletAccount { address: string }
export interface WalletProof { message: string; signature: string; verified: boolean; address: string }
export const supported = false;
const unavailable = () => new Error('Mobile Wallet Adapter needs an Android custom build and a compatible wallet. Browser previews and Expo Go cannot connect a native wallet.');
export async function connectWallet(): Promise<WalletAccount> { throw unavailable(); }
export async function disconnectWallet(): Promise<void> { throw unavailable(); }
export async function signWalletDemo(_address: string): Promise<WalletProof> { throw unavailable(); }
