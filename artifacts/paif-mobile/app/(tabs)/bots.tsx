import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Header, Body, Btn, Card, Eyebrow, F, Notice } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { useWallet } from '@/context/WalletContext';
import {
  createBotReadToken,
  getOwnerBotDetails,
  listOwnerBots,
  submitOwnerBotAction,
  type BotAction,
  type BotKind,
  type BotSummary,
} from '@/lib/bot-control';
import { respondOwnerSwingSignal } from '@/lib/swing-setup';

function formatLamports(raw?: string): string {
  if (!raw || !/^\d+$/.test(raw)) return '—';
  const value = BigInt(raw);
  const whole = value / 1_000_000_000n;
  const fraction = (value % 1_000_000_000n).toString().padStart(9, '0').slice(0, 4).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction} SOL` : `${whole} SOL`;
}

function budgetFor(bot: BotSummary): string {
  return bot.budgetLamports ? formatLamports(bot.budgetLamports)
    : typeof bot.budgetSol === 'number' ? `${bot.budgetSol.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL`
      : 'not reported';
}

function statusLabel(status: string): string {
  return status.replaceAll('_', ' ');
}

function detailKey(kind: BotKind, id: string): string {
  return `${kind}:${id}`;
}

export default function BotsScreen() {
  const c = useColors();
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const [swingToken, setSwingToken] = useState<string | null>(null);
  const [autoToken, setAutoToken] = useState<string | null>(null);
  const [swingAuthEpoch, setSwingAuthEpoch] = useState(0);
  const [autoAuthEpoch, setAutoAuthEpoch] = useState(0);
  const [unlocking, setUnlocking] = useState<BotKind | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, Record<string, unknown>>>({});
  const [detailsLoading, setDetailsLoading] = useState<string | null>(null);
  const priorOwner = useRef(wallet.address);
  const ownerSession = useRef({ owner: wallet.address, epoch: 0 });
  const actionInFlight = useRef(false);
  if (ownerSession.current.owner !== wallet.address) {
    ownerSession.current = { owner: wallet.address, epoch: ownerSession.current.epoch + 1 };
  }
  const controlsBusy = wallet.busy || !!actionKey || !!unlocking;

  useFocusEffect(useCallback(() => {
    // Returning from settings must not retain stale pending suggestions.
    setDetails({});
    void queryClient.invalidateQueries({ queryKey: ['mobile', 'swing-bots', wallet.address] });
  }, [queryClient, wallet.address]));

  useEffect(() => {
    if (priorOwner.current !== wallet.address) {
      setSwingToken(null);
      setAutoToken(null);
      setDetails({});
      setError(null);
      setNotice(null);
      priorOwner.current = wallet.address;
    }
  }, [wallet.address]);

  const swing = useQuery({
    queryKey: ['mobile', 'swing-bots', wallet.address, swingAuthEpoch],
    queryFn: () => listOwnerBots('swing', wallet.address!, swingToken!),
    enabled: !!wallet.address && !!swingToken,
    staleTime: 15_000,
    retry: false,
  });
  const auto = useQuery({
    queryKey: ['mobile', 'auto-strategies', wallet.address, autoAuthEpoch],
    queryFn: () => listOwnerBots('auto', wallet.address!, autoToken!),
    enabled: !!wallet.address && !!autoToken,
    staleTime: 15_000,
    retry: false,
  });

  const unlock = async (kind: BotKind) => {
    if (!wallet.address || controlsBusy) return;
    const session = ownerSession.current;
    wallet.clearError();
    setError(null);
    setNotice(null);
    setUnlocking(kind);
    try {
      const token = await createBotReadToken(kind, wallet.address, wallet.signMessage);
      if (ownerSession.current !== session) return;
      if (kind === 'swing') {
        setSwingToken(token);
        setSwingAuthEpoch((epoch) => epoch + 1);
      } else {
        setAutoToken(token);
        setAutoAuthEpoch((epoch) => epoch + 1);
      }
    } catch (cause) {
      if (ownerSession.current === session) setError(cause instanceof Error ? cause.message : 'The bot list could not be unlocked.');
    } finally {
      setUnlocking(null);
    }
  };

  const perform = async (kind: BotKind, bot: BotSummary, action: BotAction) => {
    if (!wallet.address || actionInFlight.current) return;
    const session = ownerSession.current;
    const token = kind === 'swing' ? swingToken : autoToken;
    const key = detailKey(kind, bot.id);
    if (!token) {
      setError('Unlock this bot list before sending an action.');
      return;
    }
    actionInFlight.current = true;
    setError(null);
    setNotice(null);
    wallet.clearError();
    setActionKey(key);
    try {
      await submitOwnerBotAction(kind, action, bot, wallet.address, wallet.signMessage);
      if (ownerSession.current !== session) return;
      const success = action === 'sell-now'
        ? 'Sell-everything request accepted. The server is processing it; refresh for updated status.'
        : action === 'stop' || action === 'cancel'
          ? 'Stop/withdraw request accepted. Refresh to see the latest bot status and balances.'
          : action === 'pause'
            ? 'Bot paused.'
            : 'Start request accepted.';
      setNotice(success);
      await queryClient.invalidateQueries({
        queryKey: ['mobile', kind === 'swing' ? 'swing-bots' : 'auto-strategies', wallet.address],
      });
    } catch (cause) {
      if (ownerSession.current === session) setError(cause instanceof Error ? cause.message : 'The signed bot action failed.');
    } finally {
      actionInFlight.current = false;
      setActionKey(null);
    }
  };

  const confirmAction = (kind: BotKind, bot: BotSummary, action: BotAction) => {
    if (controlsBusy) return;
    const session = ownerSession.current;
    let title = 'Confirm bot action';
    let message = 'Your connected owner wallet will sign a one-time authorization for this action.';
    let confirmLabel = 'Sign authorization';
    let destructive = false;
    if (action === 'start') {
      const live = kind === 'auto' || bot.mode === 'live';
      title = live ? 'Start live trading?' : 'Start this paper bot?';
      message = live
        ? 'This lets the server-run bot begin real trades from its funded worker wallet. Your connected wallet signs the start authorization; it does not transfer funds in this step.'
        : 'This starts the paper bot. It uses simulated funds and does not send transactions.';
      confirmLabel = live ? 'Authorize live start' : 'Start paper bot';
    } else if (action === 'pause') {
      title = 'Pause this bot?';
      message = kind === 'swing'
        ? 'A Swing Bot pause also pauses exits. Open positions stay open and may remain exposed while paused.'
        : 'The strategy will stop scheduling trades until you start it again.';
      confirmLabel = 'Authorize pause';
    } else if (action === 'stop') {
      title = 'Stop, sell positions, and return funds?';
      message = 'A Swing Bot stop closes open positions and sweeps available funds from its worker wallet back to the owner. This can take time and includes real on-chain sales for a live bot.';
      confirmLabel = 'Authorize stop';
      destructive = true;
    } else if (action === 'cancel') {
      title = 'Cancel and withdraw this strategy?';
      message = 'This stops the strategy and requests withdrawal of available worker-wallet funds to the owner wallet fixed when it was created. This does not use your connected wallet as a new withdrawal destination.';
      confirmLabel = 'Authorize cancel';
      destructive = true;
    } else if (action === 'sell-now') {
      title = 'Sell everything and return funds?';
      message = 'The server will try to liquidate all open positions, then sweep proceeds back to the owner wallet fixed when this strategy was created. This is a real, on-chain action and may take time.';
      confirmLabel = 'Authorize sell everything';
      destructive = true;
    }
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: confirmLabel,
        style: destructive ? 'destructive' : 'default',
        onPress: () => { if (ownerSession.current === session) void perform(kind, bot, action); },
      },
    ]);
  };

  const respondSignal = (bot: BotSummary, signal: Record<string, unknown>, action: 'approve' | 'dismiss') => {
    const signalId = typeof signal.id === 'string' ? signal.id : null;
    const symbol = typeof signal.symbol === 'string' ? signal.symbol : 'this token';
    if (!signalId || !wallet.address || controlsBusy || actionInFlight.current) return;
    const owner = wallet.address;
    const session = ownerSession.current;
    const approve = action === 'approve';
    const live = bot.mode === 'live';
    Alert.alert(
      approve ? `Approve buying ${symbol}?` : `Dismiss ${symbol}?`,
      approve
        ? `${live ? 'This can trigger a REAL on-chain buy from the bot worker wallet at the current price. Real money can be lost and fees apply.' : 'This triggers a simulated paper buy at the current price.'} Your wallet signs this approval.`
        : 'The bot will not buy this suggestion. Your wallet signs this dismissal.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: approve ? (live ? 'Authorize real buy' : 'Approve paper buy') : 'Dismiss',
          style: approve && live ? 'destructive' : 'default',
          onPress: () => {
            if (ownerSession.current !== session || actionInFlight.current) return;
            actionInFlight.current = true;
            const key = detailKey('swing', bot.id);
            setActionKey(`signal:${signalId}`);
            setError(null); setNotice(null);
            void (async () => {
              try {
                await respondOwnerSwingSignal(bot.id, signalId, action, owner, wallet.signMessage);
                if (ownerSession.current !== session) return;
                setNotice(approve ? 'Approval accepted. Refresh for the resulting position.' : 'Suggestion dismissed.');
                const token = swingToken;
                if (token) {
                  const data = await getOwnerBotDetails('swing', bot.id, token);
                  if (ownerSession.current !== session) return;
                  setDetails((old) => (old[key] ? { ...old, [key]: data } : old));
                }
                await queryClient.invalidateQueries({ queryKey: ['mobile', 'swing-bots', owner] });
              } catch (cause) {
                if (ownerSession.current !== session) return;
                setError(cause instanceof Error ? cause.message : 'The signal response failed.');
                if (cause instanceof Error && /result could not be confirmed/.test(cause.message)) setDetails({});
              } finally {
                actionInFlight.current = false;
                setActionKey(null);
              }
            })();
          },
        },
      ],
    );
  };

  const toggleDetails = async (kind: BotKind, bot: BotSummary) => {
    const session = ownerSession.current;
    const key = detailKey(kind, bot.id);
    if (details[key]) {
      setDetails((old) => {
        const next = { ...old };
        delete next[key];
        return next;
      });
      return;
    }
    const token = kind === 'swing' ? swingToken : autoToken;
    if (!token) return;
    setDetailsLoading(key);
    setError(null);
    try {
      const data = await getOwnerBotDetails(kind, bot.id, token);
      if (ownerSession.current !== session) return;
      setDetails((old) => ({ ...old, [key]: data }));
    } catch (cause) {
      if (ownerSession.current === session) setError(cause instanceof Error ? cause.message : 'Bot details could not be loaded.');
    } finally {
      setDetailsLoading(null);
    }
  };

  const renderBots = (kind: BotKind, bots: BotSummary[]) => (
    bots.length === 0
      ? <Notice tone="info" title="No bots for this wallet" body={kind === 'swing' ? 'Open Swing above to set up a paper or live crypto bot on Android.' : 'Scheduled auto-strategy creation is still on the PAIF.fun website. Existing strategies can be controlled here.'} />
      : bots.map((bot) => {
        const key = detailKey(kind, bot.id);
        const active = bot.status === 'active';
        const stopped = ['stopped', 'cancelled', 'completed', 'failed'].includes(bot.status);
        const detailsData = details[key];
        const positions = Array.isArray(detailsData?.positions) ? detailsData.positions : [];
        const executions = Array.isArray(detailsData?.executions) ? detailsData.executions : [];
        const workerBalance = typeof detailsData?.workerWalletBalanceLamports === 'string'
          ? formatLamports(detailsData.workerWalletBalanceLamports)
          : Array.isArray(detailsData?.walletBalancesLamports)
            ? detailsData.walletBalancesLamports.map((b) => formatLamports(typeof b === 'string' ? b : undefined)).join(' · ')
            : null;
        return (
          <Card key={bot.id} style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
              <View style={{ flex: 1, gap: 3 }}>
                <Text numberOfLines={1} style={{ fontFamily: F.head, color: c.foreground, fontSize: 19 }}>{bot.name}</Text>
                <Body>{bot.mode.toUpperCase()} · {statusLabel(bot.status)}{bot.style ? ` · ${bot.style}` : ''}</Body>
              </View>
              <Text style={{ fontFamily: F.monoMd, fontSize: 12, color: c.mutedForeground }}>{budgetFor(bot)}</Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Btn testID={`${kind}-${bot.id}-details`} label={detailsData ? 'Hide details' : 'Details'} variant="outline" busy={detailsLoading === key} onPress={() => { void toggleDetails(kind, bot); }} />
              {!active && !stopped ? <Btn testID={`${kind}-${bot.id}-start`} label="Start" onPress={() => confirmAction(kind, bot, 'start')} busy={actionKey === key} /> : null}
              {active ? <Btn testID={`${kind}-${bot.id}-pause`} label="Pause" variant="outline" onPress={() => confirmAction(kind, bot, 'pause')} busy={actionKey === key} /> : null}
              {kind === 'swing' && bot.universe !== 'stocks' ? <Btn testID={`swing-${bot.id}-settings`} label="Settings" variant="outline" disabled={controlsBusy} onPress={() => router.push({ pathname: '/bot-setup', params: { id: bot.id } })} /> : null}
              {!stopped && kind === 'swing' ? <Btn testID={`${kind}-${bot.id}-stop`} label="Stop + return funds" variant="outline" onPress={() => confirmAction(kind, bot, 'stop')} busy={actionKey === key} /> : null}
              {!stopped && kind === 'auto' ? (
                <>
                  <Btn testID={`${kind}-${bot.id}-cancel`} label="Cancel + withdraw" variant="outline" onPress={() => confirmAction(kind, bot, 'cancel')} busy={actionKey === key} />
                  <Btn testID={`${kind}-${bot.id}-sell-now`} label="Sell everything" variant="outline" onPress={() => confirmAction(kind, bot, 'sell-now')} busy={actionKey === key} />
                </>
              ) : null}
            </View>
            {detailsData ? (
              <View style={{ gap: 4, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 8 }}>
                {workerBalance ? <Body>Worker-wallet SOL: {workerBalance}</Body> : null}
                {kind === 'swing' ? <Body>Positions: {positions.length} · Recent decisions: {Array.isArray(detailsData.events) ? detailsData.events.length : 0}</Body> : null}
                {kind === 'swing' && Array.isArray(detailsData.buySignals) && detailsData.buySignals.length > 0 ? (
                  <View style={{ gap: 8, marginTop: 4 }}>
                    <Eyebrow>Pending buy signals</Eyebrow>
                    {(detailsData.buySignals as Record<string, unknown>[]).map((sig, i) => {
                      const sid = typeof sig.id === 'string' ? sig.id : String(i);
                      const busySig = actionKey === `signal:${sid}`;
                      return (
                        <View key={sid} style={{ gap: 6, borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 10 }}>
                          <Text style={{ fontFamily: F.bodyBold, color: c.foreground, fontSize: 14 }}>{typeof sig.symbol === 'string' ? sig.symbol : 'Token'}</Text>
                          {typeof sig.reason === 'string' ? <Body style={{ fontSize: 12 }}>{sig.reason}</Body> : null}
                          <View style={{ flexDirection: 'row', gap: 8 }}>
                            <Btn testID={`signal-${sid}-approve`} label="Approve" busy={busySig} disabled={controlsBusy || typeof sig.id !== 'string'} onPress={() => respondSignal(bot, sig, 'approve')} />
                            <Btn testID={`signal-${sid}-dismiss`} label="Dismiss" variant="outline" busy={busySig} disabled={controlsBusy || typeof sig.id !== 'string'} onPress={() => respondSignal(bot, sig, 'dismiss')} />
                          </View>
                        </View>
                      );
                    })}
                  </View>
                ) : null}
                {kind === 'auto' ? <Body>Recent executions: {executions.length}</Body> : null}
              </View>
            ) : null}
            <Body style={{ color: c.mutedForeground, fontSize: 11 }}>Actions require a fresh signature from this bot owner’s wallet. The app does not store the signing key.</Body>
          </Card>
        );
      })
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Header title="Bots" subtitle="Owner-signed Swing and auto-strategy controls" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60, gap: 14 }} keyboardShouldPersistTaps="handled">
        <Btn testID="button-create-swing-bot" label="Swing" disabled={controlsBusy} onPress={() => router.push('/bot-setup')} />
        {!wallet.supported ? (
          <Notice title="Android wallet required" body="Bot lists and actions need the Android custom build and Mobile Wallet Adapter. The browser preview and Expo Go cannot sign owner requests." />
        ) : !wallet.address ? (
          <Card style={{ gap: 10 }}>
            <Eyebrow>Connect owner wallet</Eyebrow>
            <Body>Only the connected owner wallet can unlock its bot lists or authorize actions.</Body>
            <Btn label="Connect Android wallet" onPress={() => { void wallet.connect(); }} busy={wallet.busy} />
          </Card>
        ) : (
          <>
            <Card style={{ gap: 8 }}>
              <Eyebrow>Connected owner</Eyebrow>
              <Text selectable style={{ fontFamily: F.mono, color: c.foreground, fontSize: 12 }}>{wallet.address}</Text>
              <Body>Unlocking asks you to sign a short read-only message. Starting, pausing, or stopping asks for a separate, single-use owner signature.</Body>
            </Card>

            {error ? <Notice tone="error" testID="bots-error" title="Bot request failed" body={error} /> : null}
            {notice ? <Notice tone="info" testID="bots-notice" title="Action submitted" body={notice} /> : null}
            {wallet.error ? <Notice tone="error" title="Wallet signing failed" body={wallet.error} /> : null}

            <Card style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <View style={{ flex: 1 }}>
                   <Eyebrow>Swing</Eyebrow>
                  <Body>Pause keeps open positions in place; Stop sells positions and returns funds.</Body>
                </View>
                {swing.isFetching ? <ActivityIndicator color={c.primary} /> : null}
              </View>
              {swingToken ? (
                <>
                  {swing.isError ? <Notice tone="error" title="Could not load Swing Bots" body={swing.error instanceof Error ? swing.error.message : 'Read session expired or the service is unavailable.'} actionLabel="Sign again" onAction={() => { void unlock('swing'); }} /> : null}
                  {swing.data ? renderBots('swing', swing.data) : null}
                  <Btn label="Refresh Swing Bots" variant="outline" disabled={swing.isFetching || controlsBusy} onPress={() => { setDetails({}); void swing.refetch(); }} />
                </>
              ) : (
                <Btn testID="button-unlock-swing" label="Sign to unlock Swing Bots" onPress={() => { void unlock('swing'); }} busy={unlocking === 'swing' || wallet.busy} />
              )}
            </Card>

            <Card style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Eyebrow>Automated strategies</Eyebrow>
                  <Body>Start or pause trading, cancel and withdraw, or explicitly sell everything.</Body>
                </View>
                {auto.isFetching ? <ActivityIndicator color={c.primary} /> : null}
              </View>
              {autoToken ? (
                <>
                  {auto.isError ? <Notice tone="error" title="Could not load strategies" body={auto.error instanceof Error ? auto.error.message : 'Read session expired or the service is unavailable.'} actionLabel="Sign again" onAction={() => { void unlock('auto'); }} /> : null}
                  {auto.data ? renderBots('auto', auto.data) : null}
                  <Btn label="Refresh strategies" variant="outline" disabled={auto.isFetching || wallet.busy} onPress={() => { void auto.refetch(); }} />
                </>
              ) : (
                <Btn testID="button-unlock-auto" label="Sign to unlock automated strategies" onPress={() => { void unlock('auto'); }} busy={unlocking === 'auto' || wallet.busy} />
              )}
            </Card>
            <Body style={{ fontSize: 11 }}>Live starts and sell/withdraw actions need your confirmation each time. The server-managed worker wallet can only return funds to its owner wallet fixed at creation.</Body>
          </>
        )}
      </ScrollView>
    </View>
  );
}
