import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { useWallet } from '@/context/WalletContext';
import { useColors } from '@/hooks/useColors';
import { Body, Btn, Card, Eyebrow, F, Notice, useNow } from '@/components/ui';
import {
  loadWalletTokenSnapshot,
  requestLiveTradeQuote,
  requestLiveTradeTransaction,
  waitForTransaction,
  type LiveTradeQuote,
  type TradeSide,
} from '@/lib/live-trading';
import { formatRawAmount, toRawTokenAmount } from '@/lib/trading-amounts';

const SLIPPAGE_BPS = 150;
const SOL_RESERVE_LAMPORTS = 10_000_000;

function formatSol(lamports: number): string {
  return (lamports / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function LiveTradePanel({ mint, symbol }: { mint: string; symbol: string }) {
  const c = useColors();
  const now = useNow();
  const wallet = useWallet();
  const [side, setSide] = useState<TradeSide>('buy');
  const [amount, setAmount] = useState('0.05');
  const [quoteState, setQuoteState] = useState<{ quote: LiveTradeQuote; rawAmount: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const snapshot = useQuery({
    queryKey: ['mobile', 'live-trade-balance', wallet.address, mint],
    queryFn: () => loadWalletTokenSnapshot(wallet.address!, mint),
    enabled: wallet.supported && !!wallet.address && mint.length >= 32,
    staleTime: 15_000,
    retry: false,
  });

  const resetQuote = (nextSide: TradeSide, nextAmount: string) => {
    wallet.clearError();
    setSide(nextSide);
    setAmount(nextAmount);
    setQuoteState(null);
    setError(null);
    setMessage(null);
    setSignature(null);
  };

  const requestQuote = async () => {
    wallet.clearError();
    setError(null);
    setMessage(null);
    setSignature(null);
    try {
      if (!wallet.address) throw new Error('Connect your Solana wallet first.');
      if (!snapshot.data) throw new Error('Wallet balances are not verified yet. Refresh them and try again.');
      const rawAmount = toRawTokenAmount(amount, side === 'buy' ? 9 : snapshot.data.decimals);
      if (side === 'buy') {
        if (BigInt(rawAmount) + BigInt(SOL_RESERVE_LAMPORTS) > BigInt(snapshot.data.solLamports)) {
          throw new Error('That buy would leave less than 0.01 SOL for fees. Lower the amount and request a new quote.');
        }
      } else if (BigInt(rawAmount) > BigInt(snapshot.data.tokenAmount)) {
        throw new Error('That sell is larger than the token balance verified for this wallet.');
      }
      const quote = await requestLiveTradeQuote(
        mint,
        side,
        Number(formatRawAmount(String(rawAmount), side === 'buy' ? 9 : snapshot.data.decimals, 18)),
        rawAmount,
        snapshot.data.decimals,
        SLIPPAGE_BPS,
      );
      setQuoteState({ quote, rawAmount });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The quote failed. Nothing was sent.');
    }
  };

  const sendTrade = async () => {
    const selected = quoteState;
    if (!selected || !wallet.address) return;
    setError(null);
    setMessage(null);
    setSignature(null);
    wallet.clearError();
    setBusy(true);
    try {
      const serialized = await requestLiveTradeTransaction(
        selected.quote,
        wallet.address,
        selected.rawAmount,
      );
      const txSignature = await wallet.sendTransaction(serialized);
      setSignature(txSignature);
      setMessage('The wallet sent this transaction. Checking Solana for confirmation…');
      let confirmed = false;
      try {
        confirmed = await waitForTransaction(txSignature);
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : '';
        setMessage(reason.startsWith('The transaction failed on-chain:')
          ? `${reason} Check the transaction before trying again.`
          : 'The wallet returned a signature, but confirmation could not be checked. Check the transaction before trying again.');
        return;
      }
      if (confirmed) {
        setMessage('Confirmed on Solana mainnet.');
        setQuoteState(null);
        const refreshed = await snapshot.refetch();
        if (refreshed.isError) {
          setMessage('Confirmed on Solana mainnet, but wallet balances could not be refreshed. Refresh them before another trade.');
        }
      } else {
        setMessage('Still waiting for Solana confirmation. Check the transaction before trying again; do not resubmit while its status is unknown.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The trade was not completed.');
    } finally {
      setBusy(false);
    }
  };

  if (!wallet.supported) {
    return (
      <Card style={{ gap: 8 }}>
        <Eyebrow>Real buy / sell</Eyebrow>
        <Notice title="Android wallet required" body="Live trades need the custom Android build and a Mobile Wallet Adapter wallet. The browser preview and Expo Go cannot send transactions." />
      </Card>
    );
  }

  const canSell = !!snapshot.data && BigInt(snapshot.data.tokenAmount) > 0n;
  const outputDecimals = side === 'buy' ? (snapshot.data?.decimals ?? 0) : 9;
  const quoteExpired = !!quoteState && quoteState.quote.createdAt + 90_000 < now;

  return (
    <Card style={{ gap: 12 }}>
      <Eyebrow>Real buy / sell · Solana mainnet</Eyebrow>
      <Body>Each trade requests a live Pump.fun or Jupiter quote. The transaction is not sent until you approve it in your wallet.</Body>

      {!wallet.address ? (
        <Btn label="Connect Android wallet" onPress={() => { void wallet.connect(); }} busy={wallet.busy} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['buy', 'sell'] as const).map((choice) => {
              const selected = side === choice;
              return (
                <Pressable
                  key={choice}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  testID={`live-trade-${choice}`}
                  onPress={() => resetQuote(choice, choice === 'buy' ? '0.05' : '')}
                  style={{
                    flex: 1,
                    minHeight: 42,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: selected ? c.primary : c.border,
                    backgroundColor: selected ? c.secondary : c.background,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontFamily: F.bodyBold, color: c.foreground }}>{choice === 'buy' ? `Buy ${symbol}` : `Sell ${symbol}`}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Body>Connected wallet SOL</Body>
            <Text style={{ fontFamily: F.monoMd, color: c.foreground }}>
              {snapshot.data ? `${formatSol(snapshot.data.solLamports)} SOL` : snapshot.isPending ? 'Checking…' : 'Unavailable'}
            </Text>
          </View>
          {side === 'sell' ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Body>Token balance</Body>
              <Text style={{ fontFamily: F.monoMd, color: c.foreground }}>
                {snapshot.data ? formatRawAmount(snapshot.data.tokenAmount, snapshot.data.decimals) : 'Unavailable'}
              </Text>
            </View>
          ) : null}

          <TextInput
            testID="live-trade-amount"
            value={amount}
            onChangeText={(value) => {
              setAmount(value);
              setQuoteState(null);
              setError(null);
              setMessage(null);
              setSignature(null);
            }}
            keyboardType="decimal-pad"
            placeholder={side === 'buy' ? 'SOL amount' : 'Token amount'}
            placeholderTextColor={c.mutedForeground}
            style={{
              borderWidth: 1,
              borderColor: c.input,
              borderRadius: 12,
              paddingHorizontal: 14,
              height: 48,
              fontFamily: F.monoMd,
              fontSize: 17,
              color: c.foreground,
              backgroundColor: c.background,
            }}
          />
          {side === 'buy' ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[0.05, 0.1, 0.25].map((preset) => (
                <Pressable
                  key={preset}
                  testID={`live-buy-${preset}`}
                  onPress={() => resetQuote('buy', String(preset))}
                  style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.secondary }}
                >
                  <Text style={{ fontFamily: F.monoMd, color: c.foreground, fontSize: 12 }}>{preset} SOL</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[25, 50, 100].map((percent) => (
                <Pressable
                  key={percent}
                  testID={`live-sell-${percent}`}
                  disabled={!canSell}
                  onPress={() => {
                    if (!snapshot.data) return;
                    const raw = BigInt(snapshot.data.tokenAmount) * BigInt(percent) / 100n;
                    resetQuote('sell', formatRawAmount(raw.toString(), snapshot.data.decimals));
                  }}
                  style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.secondary, opacity: canSell ? 1 : 0.5 }}
                >
                  <Text style={{ fontFamily: F.monoMd, color: c.foreground, fontSize: 12 }}>{percent}%</Text>
                </Pressable>
              ))}
            </View>
          )}

          {snapshot.isError ? (
            <Notice tone="error" title="Wallet balance check failed" body={snapshot.error instanceof Error ? snapshot.error.message : 'The wallet balance could not be verified.'} actionLabel="Retry balance check" onAction={() => { void snapshot.refetch(); }} />
          ) : null}
          {wallet.error ? <Notice tone="error" title="Wallet request failed" body={wallet.error} /> : null}
          {error ? <Notice tone="error" testID="live-trade-error" title="Trade not sent" body={error} /> : null}
          {message ? (
            <Card style={{ gap: 6, padding: 12 }}>
              <Body>{message}</Body>
              {signature ? <Text selectable style={{ fontFamily: F.mono, fontSize: 11, color: c.mutedForeground }}>{signature}</Text> : null}
              {signature ? <Text accessibilityRole="link" onPress={() => {
                void Linking.openURL(`https://explorer.solana.com/tx/${encodeURIComponent(signature)}`);
              }} style={{ color: c.primary, fontFamily: F.bodyBold }}>View on Solana Explorer</Text> : null}
            </Card>
          ) : null}

          {quoteState ? (
            <Card style={{ gap: 8, padding: 12 }}>
              <Text style={{ fontFamily: F.bodyBold, color: c.foreground }}>{quoteState.quote.provider} quote for {quoteState.quote.side} {symbol}</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                <Body>Estimated receive</Body>
                <Text style={{ fontFamily: F.monoMd, color: c.foreground }}>
                  {formatRawAmount(quoteState.quote.expectedOutput, outputDecimals)} {side === 'buy' ? symbol : 'SOL'}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                <Body>Minimum receive</Body>
                <Text style={{ fontFamily: F.monoMd, color: c.foreground }}>
                  {formatRawAmount(quoteState.quote.minimumOutput, outputDecimals)} {side === 'buy' ? symbol : 'SOL'}
                </Text>
              </View>
              <Body style={{ fontSize: 12 }}>Slippage limit: {(quoteState.quote.slippageBps / 100).toFixed(2)}%. The wallet will show the transaction for your approval.</Body>
              {quoteState.quote.route.length ? <Body style={{ fontSize: 12 }}>Route: {quoteState.quote.route.join(' → ')}</Body> : null}
              {quoteState.quote.priceImpactPct ? <Body style={{ fontSize: 12 }}>Jupiter quote price impact: {quoteState.quote.priceImpactPct}</Body> : null}
              {quoteExpired ? <Notice tone="error" title="Quote expired" body="Request a fresh quote before opening the wallet." /> : null}
              <Btn
                testID="button-live-trade-send"
                label={side === 'buy' ? `Review ${amount} SOL buy in wallet` : `Review ${amount} ${symbol} sell in wallet`}
                onPress={() => { void sendTrade(); }}
                busy={busy || wallet.busy}
                disabled={quoteExpired || snapshot.isError}
              />
            </Card>
          ) : null}

          <Btn
            testID="button-live-trade-quote"
            label="Get live quote"
            variant="outline"
            onPress={() => { void requestQuote(); }}
            busy={snapshot.isPending || busy}
            disabled={!snapshot.data || wallet.busy || !amount.trim() || (side === 'sell' && !canSell)}
          />
          <Btn
            label="Refresh wallet balances"
            variant="outline"
            onPress={() => { setQuoteState(null); void snapshot.refetch(); }}
            disabled={snapshot.isPending || wallet.busy}
          />
          <Body style={{ fontSize: 11 }}>
            Quotes are not guaranteed fills. A wallet-approved transaction may still fail or land at a different price. Ungraduated Pump.fun tokens use their bonding-curve route; graduated tokens use Jupiter. Never resubmit while a previous transaction's status is unknown.
          </Body>
        </>
      )}
    </Card>
  );
}
