export function toRawTokenAmount(amountText: string, decimals: number): number {
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(amountText.trim())) {
    throw new Error('Enter a valid amount using digits and a decimal point.');
  }
  const amount = Number(amountText);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter an amount above zero.');
  const raw = Math.floor(amount * 10 ** decimals);
  if (!Number.isSafeInteger(raw) || raw <= 0) {
    throw new Error('That amount is too small or too large for a safe quote.');
  }
  return raw;
}

export function formatRawAmount(raw: string, decimals: number, places = 6): string {
  const value = BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, '0')
    .slice(0, Math.min(decimals, places)).replace(/0+$/, '');
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
}
