export class UnknownBotOutcomeError extends Error {
  constructor() {
    super('The result could not be confirmed. Refresh your bots and inspect the saved state before retrying; the server may already have accepted this request.');
    this.name = 'UnknownBotOutcomeError';
  }
}

/** Signed mutations are sent exactly once. An abort cannot undo server work. */
export async function sendBotMutationOnce<T>(
  request: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 25_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await request(controller.signal);
  } catch (cause) {
    const status = (cause as { status?: number })?.status;
    const data = (cause as { data?: { error?: string } })?.data;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      throw new Error(typeof data?.error === 'string' ? data.error : (cause instanceof Error ? cause.message : 'The bot request was rejected.'));
    }
    throw new UnknownBotOutcomeError();
  } finally {
    clearTimeout(timer);
  }
}
