import React from 'react';
import { View } from 'react-native';
import { Body, Card, Eyebrow } from '@/components/ui';
import { Choice, PercentSetting, Toggle } from '@/components/BotFormControls';
import type { SwingSetupDraft } from '@/lib/swing-setup-model';

export function SwingAutomationControls({ draft, patch, editing, disabled }: {
  draft: SwingSetupDraft; patch: (p: Partial<SwingSetupDraft>) => void; editing: boolean; disabled: boolean;
}) {
  const scan = draft.kind === 'scan';
  return (
    <>
      <Card style={{ gap: 16 }}>
        <Eyebrow>Automatic protection</Eyebrow>
        {scan && draft.style === 'quick' ? (
          <>
            <PercentSetting testID="setup-stop-room" label="How far may a trade fall?"
              hint="Automatic adjusts to the token. A fixed 5% means a $10 trade may fall to about $9.50 before an exit is attempted. Prices can move past any limit."
              range="2–50" presets={['4', '5', '8', '12']} value={draft.stopRoomPct}
              onChange={(v) => patch({ stopRoomPct: v })} disabled={disabled} />
            <PercentSetting testID="setup-winner-keep" label="How much of its best gain should it keep?"
              hint="Automatic adjusts to each winner. Keeping 60% of a $5 peak gain means trying to keep $3 of that gain. Lower values give a runner more room, but risk giving back more profit. Choosing 40% also switches profit taking to Automatic."
              range="40–90" presets={['40', '60', '75', '90']} value={draft.winnerKeepPct}
              onChange={(v) => patch({ winnerKeepPct: v, ...(v === '40' ? { takeProfitPct: '' } : {}) })} disabled={disabled} />
          </>
        ) : null}
        <Toggle testID="setup-recovery-hold" label="Give losing trades time to recover"
          hint="Off by default. When on, ordinary red trades may stay open longer. Emergency loss, broken liquidity, and confirmed decline protections still apply. This does not guarantee avoiding a loss."
          value={draft.neverSellAtLoss} onChange={(v) => patch({ neverSellAtLoss: v })} disabled={disabled} />
        <View style={{ gap: 8 }}>
          <Body>When the run ends with a losing position:</Body>
          <Choice testID="setup-red-end" value={draft.redEndBehavior} onChange={(v) => patch({ redEndBehavior: v })} disabled={disabled}
            options={[{ value: 'sell', label: 'Try to sell' }, { value: 'send_tokens', label: 'Keep the tokens' }]} />
          <Body style={{ fontSize: 12 }}>{draft.mode === 'live'
            ? 'Keep the tokens returns them to the owner wallet instead of forcing an end-of-run sale. Their value can still fall; a separate Stop can liquidate them.'
            : 'Paper simulates this choice only. It does not send real tokens or money.'}</Body>
        </View>
        {editing ? <Body style={{ fontSize: 12 }}>Protection changes apply to open positions immediately and may trigger sales.</Body> : null}
      </Card>

      <Card style={{ gap: 14 }}>
        <Eyebrow>More automation</Eyebrow>
        {!editing ? (
          <Toggle testID="setup-unlimited" label="Keep running until I stop it"
            hint="Off uses the run window above. On removes the scheduled end; the loss cool-off still pauses new buys for 30 minutes, not the whole bot."
            value={draft.unlimitedWindow} onChange={(v) => patch({ unlimitedWindow: v })} disabled={disabled} />
        ) : <Body>{draft.unlimitedWindow ? 'This bot has no scheduled end.' : 'This editor keeps the existing run schedule.'}</Body>}
        {!scan ? (
          !editing ? (
            <>
              <Toggle testID="setup-watch-reentry" label="Watch for another entry after selling"
                hint="Off is a one-shot watch. On keeps watching after a sale and can buy again when a qualifying comeback appears. Live re-entries do not ask for another approval."
                value={draft.reentry} onChange={(v) => patch({ reentry: v })} disabled={disabled} />
              <Toggle testID="setup-watch-long" label="Give this token more room to run"
                hint="Off uses tighter watch protection. On uses wider profit protection: it arms after a 60% gain and allows a 30% fall from the peak. This can give back more profit."
                value={draft.watchHoldLong} onChange={(v) => patch({ watchHoldLong: v })} disabled={disabled} />
            </>
          ) : <Body>{draft.reentry ? 'This watch can automatically enter again after a qualifying comeback.' : 'This is a one-shot watch.'} Watch-entry behavior is set at creation.</Body>
        ) : (
          <>
            <Toggle testID="setup-stacking" label="Allow extra buys of the same token"
              hint="Off spreads slots across different tokens. On may use a free slot for another buy of an existing pick, concentrating more of the budget in one token."
              value={draft.allowStacking} onChange={(v) => patch({ allowStacking: v })} disabled={disabled} />
            <Toggle testID="setup-hot-full-size" label="Use full-sized buys on long hot runs"
              hint="Off keeps the smaller-buy safeguard on tokens that have already climbed for hours. On removes that safeguard. A sudden rug can lose the entire trade."
              value={draft.hotStreakFullSize} onChange={(v) => patch({ hotStreakFullSize: v })} disabled={disabled} />
          </>
        )}
        <Body style={{ fontSize: 12 }}>These settings use the existing Swing engine. They do not start or fund a live bot.</Body>
      </Card>
    </>
  );
}
