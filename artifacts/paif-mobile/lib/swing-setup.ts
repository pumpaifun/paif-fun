import {
  createMobileSwingBot, updateMobileSwingSettings, respondMobileSwingSignal, setBaseUrl,
  type MobileSwingCreated,
} from '@workspace/api-client-react';
import { apiOrigin } from './research';
import { sendBotMutationOnce } from './bot-mutation-request';
import {
  swingCreateMessage, swingSettingsMessage, swingSignalMessage,
  swingCreatePayload, swingSettingsPayload, type SwingSetupDraft,
} from './swing-setup-model';

export { defaultSwingDraft, draftFromBot, validateSwingDraft } from './swing-setup-model';
export type { SwingSetupDraft } from './swing-setup-model';

type Signer = (message: string) => Promise<string>;

function validateOwner(owner: string) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(owner)) throw new Error('Connect the bot owner’s Android wallet first.');
}

async function sendOnce<T>(request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  setBaseUrl(apiOrigin());
  return sendBotMutationOnce(request);
}

export async function createOwnerSwingBot(draft: SwingSetupDraft, owner: string, signMessage: Signer): Promise<MobileSwingCreated> {
  validateOwner(owner);
  const payload = swingCreatePayload(draft);
  const nonce = Date.now();
  const signature = await signMessage(swingCreateMessage(owner, nonce));
  return sendOnce(async (signal) => {
    const result = await createMobileSwingBot({ ...payload, ownerWallet: owner, nonce, signature }, { signal, credentials: 'omit', cache: 'no-store' });
    if (!result?.strategy?.id || typeof result.strategy.name !== 'string' || typeof result.strategy.status !== 'string' ||
        result.strategy.mode !== draft.mode || !result.fundingAddress || !Number.isFinite(result.recommendedFundingSol)) {
      throw new Error('Incomplete creation response.');
    }
    return result;
  });
}

export async function saveOwnerSwingSettings(id: string, draft: SwingSetupDraft, owner: string, signMessage: Signer) {
  validateOwner(owner);
  if (!id) throw new Error('Choose a bot first.');
  const payload = swingSettingsPayload(draft);
  const nonce = Date.now();
  const signature = await signMessage(swingSettingsMessage(id, owner, nonce));
  return sendOnce(async (signal) => {
    const result = await updateMobileSwingSettings(id, { ...payload, ownerWallet: owner, nonce, signature }, { signal, credentials: 'omit', cache: 'no-store' });
    if (result?.strategy?.id !== id || typeof result.strategy.name !== 'string') throw new Error('Incomplete settings response.');
    return result;
  });
}

export async function respondOwnerSwingSignal(id: string, signalId: string, action: 'approve' | 'dismiss', owner: string, signMessage: Signer) {
  validateOwner(owner);
  if (!id || !signalId || !['approve', 'dismiss'].includes(action)) throw new Error('Choose a valid pending suggestion.');
  const nonce = Date.now();
  const signature = await signMessage(swingSignalMessage(id, signalId, action, owner, nonce));
  return sendOnce((signal) => respondMobileSwingSignal(id, signalId, action, { ownerWallet: owner, nonce, signature }, { signal, credentials: 'omit', cache: 'no-store' }));
}
