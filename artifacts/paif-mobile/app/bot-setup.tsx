import React, { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Platform, Pressable, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { Body, Btn, Card, Eyebrow, F, Header, Notice, Skeleton, WEB_BOTTOM } from '@/components/ui';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { Field, Choice, Toggle } from '@/components/BotFormControls';
import { SwingAutomationControls } from '@/components/SwingAutomationControls';
import { useColors } from '@/hooks/useColors';
import { useWallet } from '@/context/WalletContext';
import { createBotReadToken, getOwnerBotDetails } from '@/lib/bot-control';
import { apiOrigin } from '@/lib/research';
import {
  createOwnerSwingBot, defaultSwingDraft, draftFromBot, saveOwnerSwingSettings, validateSwingDraft,
  type SwingSetupDraft,
} from '@/lib/swing-setup';

type Created = { id: string; name: string; mode: string; status: string; fundingAddress: string; recommendedFundingSol: number };
const TP_PRESETS = ['3', '5', '10', '20', '50', '100'];

const AMBIGUOUS = /result could not be confirmed|network|timed out|timeout|failed to fetch|abort|unreadable/i;
const ENTITLEMENT = /402|access pass|trial|payment required/i;

export default function BotSetupScreen() {
  const c = useColors();
  const wallet = useWallet();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const editing = !!id;
  const [draft, setDraft] = useState<SwingSetupDraft>(defaultSwingDraft());
  const [loaded, setLoaded] = useState(!editing);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ambiguous, setAmbiguous] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [customTp, setCustomTp] = useState(false);
  const epoch = useRef(0);
  const inFlight = useRef(false);
  const [reloadKey, setReloadKey] = useState(0);
  const owner = wallet.address;
  const patch = (p: Partial<SwingSetupDraft>) => {
    if (!inFlight.current) {
      setDraft((d) => ({ ...d, ...p }));
      if (p.takeProfitPct === '') setCustomTp(false);
    }
  };

  // Reset and (when editing) load authoritative settings; stale results ignored after owner/id change.
  useEffect(() => {
    const mine = ++epoch.current;
    setError(null); setCreated(null); setSaved(null); setAmbiguous(false); setLoadError(null);
    setCustomTp(false); setLoading(false);
    if (!editing) {
      setDraft(defaultSwingDraft()); setLoaded(true);
      return () => { epoch.current++; };
    }
    setLoaded(false);
    if (!owner || !wallet.supported) return () => { epoch.current++; };
    setLoading(true);
    (async () => {
      try {
        const token = await createBotReadToken('swing', owner, wallet.signMessage);
        const data = await getOwnerBotDetails('swing', id!, token);
        const strategy = data.strategy;
        if (!strategy || typeof strategy !== 'object') throw new Error('The server did not return this bot’s settings.');
        const record = strategy as Record<string, unknown>;
        if (record.id !== id || record.ownerWallet !== owner) throw new Error('The saved bot does not match this owner and selection.');
        const next = draftFromBot(record);
        if (epoch.current !== mine) return;
        setDraft(next);
        setCustomTp(!!next.takeProfitPct && !TP_PRESETS.includes(next.takeProfitPct));
        setLoaded(true);
      } catch (cause) {
        if (epoch.current === mine) setLoadError(cause instanceof Error ? cause.message : 'Settings could not be loaded.');
      } finally {
        if (epoch.current === mine) setLoading(false);
      }
    })();
    return () => { epoch.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, id, reloadKey]);

  const live = draft.mode === 'live';
  const scan = draft.kind === 'scan';
  const canSign = wallet.supported && !!owner;
  const validation = loaded ? validateSwingDraft(draft, editing) : null;
  const disabled = busy || wallet.busy || !canSign || !loaded || !!validation || ambiguous;

  const openAccess = () => {
    let origin: unknown;
    try { origin = apiOrigin() || Constants.expoConfig?.extra?.apiOrigin; } catch { /* handled below */ }
    if (typeof origin !== 'string' || !/^https:\/\/[^/]+\/?$/.test(origin)) {
      setError('The PAIF access-page address is not configured.');
      return;
    }
    void Linking.openURL(`${origin.replace(/\/$/, '')}/upgrade`).catch(() => setError('The PAIF access page could not be opened.'));
  };

  const run = async (confirmed: SwingSetupDraft, confirmedOwner: string, mine: number) => {
    if (!confirmedOwner || epoch.current !== mine || inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(null); wallet.clearError();
    try {
      if (editing) {
        const r = await saveOwnerSwingSettings(id!, confirmed, confirmedOwner, wallet.signMessage);
        if (epoch.current !== mine) return;
        setSaved(`Settings saved for ${r.strategy.name}.`);
      } else {
        const r = await createOwnerSwingBot(confirmed, confirmedOwner, wallet.signMessage);
        if (epoch.current !== mine) return;
        setCreated({ id: r.strategy.id, name: r.strategy.name, mode: r.strategy.mode, status: r.strategy.status, fundingAddress: r.fundingAddress, recommendedFundingSol: r.recommendedFundingSol });
      }
      await queryClient.invalidateQueries({ queryKey: ['mobile', 'swing-bots'] });
    } catch (cause) {
      if (epoch.current !== mine) return;
      const m = cause instanceof Error ? cause.message : 'The request failed.';
      setError(m);
      if (AMBIGUOUS.test(m) && !ENTITLEMENT.test(m)) setAmbiguous(true);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const confirm = () => {
    if (disabled || !owner) return;
    const confirmed = { ...draft };
    const confirmedOwner = owner;
    const mine = epoch.current;
    const automaticBuys = scan && !draft.requireApproval;
    const title = editing ? 'Save Swing Bot settings?' : live ? 'Create a live Swing Bot?' : 'Create a paper Swing Bot?';
    const message = editing
      ? `Your wallet signs this change. Exit-setting changes apply to open positions and may trigger sells.${live ? ' This bot trades real money.' : ''}${automaticBuys ? ' Ask me first is OFF: qualifying tokens can be bought automatically without another approval.' : ''}`
      : live
        ? `This creates a live bot and a worker wallet. It does not start trading or send funds. You must fund it yourself, then start it. Real trades can lose money and fees apply.${automaticBuys || !scan ? ' After you start it, this bot can buy automatically without asking again.' : ' Each discovered buy idea waits for your approval.'}`
        : 'This creates a paper bot and starts simulating right away with practice funds. No transactions are sent. It needs your PAIF Access Pass or trial.';
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: editing ? 'Sign and save' : 'Sign and create', onPress: () => { void run(confirmed, confirmedOwner, mine); } },
    ]);
  };

  const bottom = (Platform.OS === 'web' ? WEB_BOTTOM : insets.bottom) + 40;
  const tpPresets = TP_PRESETS;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Header title="Swing" subtitle={editing ? 'Owner-signed settings' : 'Owner-signed setup'} onBack={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/bots')} />
      <KeyboardAwareScrollViewCompat contentContainerStyle={{ padding: 16, paddingBottom: bottom, gap: 14 }} bottomOffset={24}>
        {!wallet.supported ? (
          <Notice testID="setup-unsupported" title="Android wallet required to submit" body="You can read the form here, but the browser preview and Expo Go cannot sign. Submitting is disabled." />
        ) : !owner ? (
          <Card style={{ gap: 10 }}>
            <Eyebrow>Connect owner wallet</Eyebrow>
            <Body>Your connected wallet will own this bot and sign each change.</Body>
            <Btn testID="setup-connect" label="Connect Android wallet" onPress={() => { void wallet.connect(); }} busy={wallet.busy} />
          </Card>
        ) : null}

        {created ? (
          <Card style={{ gap: 10 }}>
            <Eyebrow>Created</Eyebrow>
            <Text testID="setup-created-name" style={{ fontFamily: F.head, fontSize: 20, color: c.foreground }}>{created.name}</Text>
            <Body>Server reports: {created.mode.toUpperCase()} · {created.status.replaceAll('_', ' ')}</Body>
            {created.mode === 'live' ? (
              <>
                <Notice tone="warn" title="Not funded yet" body={`Send at least ${created.recommendedFundingSol} SOL to this address yourself. This app does not fund it and the bot has not started trading. Start it from Bots after funding. Funds can lose value and fees apply.`} />
                <Text testID="setup-funding-address" selectable style={{ fontFamily: F.mono, fontSize: 13, color: c.foreground }}>{created.fundingAddress}</Text>
              </>
            ) : (
              <Body>Paper simulation has begun on the server. No real funds are involved.</Body>
            )}
            <Btn testID="setup-done" label="View Bots" onPress={() => router.replace('/(tabs)/bots')} />
          </Card>
        ) : editing && !loaded ? (
          loadError ? (
            <Notice tone="error" testID="setup-load-error" title="Settings could not be loaded" body={`${loadError} Nothing was assumed or changed.`} actionLabel="Sign and retry" onAction={() => setReloadKey((k) => k + 1)} />
          ) : (
            <>
              <Skeleton h={90} /><Skeleton h={160} />
              <Body>{loading ? 'Loading this bot’s saved settings…' : 'Connect your owner wallet to load settings.'}</Body>
            </>
          )
        ) : (
          <>
            {saved ? <Notice tone="info" testID="setup-saved" title="Saved" body={saved} /> : null}
            {error ? (
              <Notice tone="error" testID="setup-error" title={editing ? 'Could not save' : 'Could not create'} body={error}
                actionLabel={ENTITLEMENT.test(error) ? 'Open PAIF access page' : undefined} onAction={ENTITLEMENT.test(error) ? openAccess : undefined} />
            ) : null}
            {ambiguous ? (
              <Notice tone="warn" testID="setup-ambiguous" title="Outcome unknown" body="The request may or may not have reached the server. Open Bots and refresh before trying again, or you could create a duplicate."
                actionLabel="I checked, allow retry" onAction={() => setAmbiguous(false)} />
            ) : null}
            {wallet.error ? <Notice tone="error" title="Wallet signing failed" body={wallet.error} /> : null}

            <Card style={{ gap: 14 }}>
              <Eyebrow>Basics</Eyebrow>
              <Field testID="setup-name" label="Name" hint="Example: Morning scanner" value={draft.name} onChangeText={(v) => patch({ name: v })} />
              {!editing ? (
                <>
                  <View style={{ gap: 6 }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: c.foreground }}>Money</Text>
                    <Choice testID="setup-mode" value={draft.mode} onChange={(v) => patch({ mode: v })} options={[{ value: 'paper', label: 'Paper (practice)' }, { value: 'live', label: 'Live (real SOL)' }]} />
                    <Body style={{ fontSize: 12 }}>{live ? 'Real money. You fund a worker wallet yourself; trades can lose value and cost fees. Nothing starts automatically.' : 'Simulated funds. Starts simulating as soon as it is created and needs a PAIF Access Pass or trial.'}</Body>
                  </View>
                  <View style={{ gap: 6 }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: c.foreground }}>How it finds tokens</Text>
                    <Choice testID="setup-kind" value={draft.kind} onChange={(v) => patch({ kind: v })} options={[{ value: 'scan', label: 'Scan the market' }, { value: 'watch', label: 'Watch one token' }]} />
                  </View>
                  {!scan ? <Field testID="setup-target-mint" label="Token mint address" hint="The token this bot watches. It cannot be changed later." value={draft.targetMint} onChangeText={(v) => patch({ targetMint: v.trim() })} /> : null}
                  <Field testID="setup-budget" label="Budget (SOL)" hint="Example: 0.5. Fixed after creation." keyboard="decimal-pad" value={draft.budgetSol} onChangeText={(v) => patch({ budgetSol: v })} />
                  {!draft.unlimitedWindow ? <Field testID="setup-window" label="Run window (hours)" hint="Example: 24. Choose unlimited in More automation below to remove the scheduled end." keyboard="decimal-pad" value={draft.windowHours} onChangeText={(v) => patch({ windowHours: v })} /> : <Body>No scheduled end. You can stop this bot yourself.</Body>}
                </>
              ) : (
                <Body>{draft.mode.toUpperCase()} · {scan ? 'scanning' : `watching ${draft.targetMint}`}. Mode, token, budget and window cannot be changed.</Body>
              )}
            </Card>

            <Card style={{ gap: 14 }}>
              <Eyebrow>Risk limits</Eyebrow>
              {scan ? <Field testID="setup-max-positions" label="Max open positions" hint="Example: 3. Spreads the budget across at most this many tokens." keyboard="number-pad" value={draft.maxPositions} onChangeText={(v) => patch({ maxPositions: v })} /> : <Body>A watch bot holds one position in your chosen token.</Body>}
              {scan ? (
                <>
                  <Field testID="setup-min-liquidity" label="Minimum money in the pool (USD)" hint="Example: 50000. Skips small trading pools that are hard to sell into. Bigger pools do not guarantee safety." keyboard="decimal-pad" value={draft.minLiquidityUsd} onChangeText={(v) => patch({ minLiquidityUsd: v })} />
                  <Field testID="setup-min-pool-age" label="Minimum pool age (hours)" hint="Example: 24. Skips brand-new pools." keyboard="decimal-pad" value={draft.minPoolAgeHours} onChangeText={(v) => patch({ minPoolAgeHours: v })} />
                  <Toggle testID="setup-approval" label="Ask me first" value={draft.requireApproval} onChange={(v) => patch({ requireApproval: v })} disabled={busy || wallet.busy}
                    hint={draft.requireApproval ? 'Buy ideas wait for your Approve in bot details.' : 'The bot buys on its own when a token qualifies.'} />
                </>
              ) : null}
            </Card>

            <Card style={{ gap: 12 }}>
              <Eyebrow>Taking profit</Eyebrow>
              <Body>Sell when a position is up by this percent. Leave automatic to let the bot decide. Profit is never guaranteed and fees reduce results.</Body>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {[{ v: '', l: 'Automatic' }, ...tpPresets.map((p) => ({ v: p, l: `${p}%` }))].map((o) => {
                  const on = !customTp && draft.takeProfitPct === o.v;
                  return (
                    <Pressable key={o.l} testID={`setup-tp-${o.v || 'auto'}`} accessibilityRole="button" accessibilityState={{ selected: on }}
                      onPress={() => { setCustomTp(false); patch({ takeProfitPct: o.v }); }}
                      style={{ paddingHorizontal: 14, minHeight: 40, borderRadius: 10, justifyContent: 'center', borderWidth: 1, borderColor: on ? c.primary : c.border, backgroundColor: on ? c.primary : 'transparent' }}>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: on ? c.primaryForeground : c.foreground }}>{o.l}</Text>
                    </Pressable>
                  );
                })}
                <Pressable testID="setup-tp-custom" accessibilityRole="button" accessibilityState={{ selected: customTp }} onPress={() => setCustomTp(true)}
                  style={{ paddingHorizontal: 14, minHeight: 40, borderRadius: 10, justifyContent: 'center', borderWidth: 1, borderColor: customTp ? c.primary : c.border, backgroundColor: customTp ? c.primary : 'transparent' }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: customTp ? c.primaryForeground : c.foreground }}>Custom</Text>
                </Pressable>
              </View>
              {customTp ? <Field testID="setup-tp-input" label="Custom target (%)" hint="Example: 35" keyboard="decimal-pad" value={draft.takeProfitPct} onChangeText={(v) => patch({ takeProfitPct: v })} /> : null}
              {editing ? <Body style={{ fontSize: 12 }}>Changing the target can apply to open positions immediately and may sell them.</Body> : null}
              <Text style={{ fontFamily: F.bodyBold, color: c.foreground }}>How much profit should it set aside?</Text>
              <Choice testID="setup-skim-preset" value={draft.profitSkimPct} onChange={(v) => patch({ profitSkimPct: v })} options={['0', '25', '50', '75', '100'].map((value) => ({ value, label: `${value}%` }))} />
              <Field testID="setup-skim" label="Custom profit set-aside (%)" hint="Example: 50 sets aside half of each net win. Paper tracks this in simulation; live sends it to the owner wallet." keyboard="number-pad" value={draft.profitSkimPct} onChangeText={(v) => patch({ profitSkimPct: v })} />
              <Field testID="setup-loss-stop" label="Cool off after losing trades" hint="Example: 4. After this many losses, pause new buys for 30 minutes. Open-position exits continue; the bot does not stop. Losses can still exceed expectations." keyboard="number-pad" value={draft.lossStopCount} onChangeText={(v) => patch({ lossStopCount: v })} />
            </Card>

            <SwingAutomationControls draft={draft} patch={patch} editing={editing} disabled={busy || wallet.busy} />

            {validation ? <Body style={{ color: c.destructive }}>{validation}</Body> : null}
            {!wallet.supported ? <Body>Submit is disabled: this environment cannot sign with a wallet.</Body> : !owner ? <Body>Connect your wallet to submit.</Body> : null}
            <Btn testID="setup-submit" label={editing ? 'Review and save' : live ? 'Review and create live bot' : 'Review and create paper bot'} onPress={confirm} disabled={disabled} busy={busy} />
          </>
        )}
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}
