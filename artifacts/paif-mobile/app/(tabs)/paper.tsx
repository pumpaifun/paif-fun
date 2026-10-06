import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { usePaper } from '@/context/PaperContext';
import { useTrendingTokens } from '@/lib/research';
import type { Token } from '@/lib/research';
import { isFreshQuote } from '@/lib/paper';
import { BuyPanel } from '@/components/BuyPanel';
import { Body, Btn, Card, Empty, Eyebrow, F, fmtChips, fmtPct, fmtPrice, fmtUnits, Header, Notice, pctColor, Skeleton, useBottomPad, useNow } from '@/components/ui';

export default function Paper() {
  const c = useColors();
  const pad = useBottomPad();
  const paper = usePaper();
  const now = useNow();
  const trending = useTrendingTokens();
  const [picked, setPicked] = useState<Token | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [sellErr, setSellErr] = useState<string | null>(null);
  const { cash, positions, trades } = paper.state;
  const quotes = useMemo(() => new Map((trending.data ?? []).map((t) => [t.mint, t])), [trending.data]);
  const realized = trades.reduce((a, t) => a + (t.side === 'sell' && typeof t.profit === 'number' ? t.profit : 0), 0);
  const settled = trades.filter((t) => t.side === 'sell' && typeof t.profit === 'number');

  const sell = async (mint: string) => {
    setSellErr(null);
    try { await paper.sell(mint); } catch (e) { setSellErr(e instanceof Error ? e.message : 'Sell failed.'); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Header title="Paper" subtitle="Practice chips - no real funds" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: pad, gap: 14 }} keyboardShouldPersistTaps="handled">
        {paper.error ? <Notice tone="error" testID="paper-error" title="Practice account needs attention" body={paper.error} actionLabel="Retry saved account" onAction={() => paper.retry()} /> : null}
        {!paper.loaded && !paper.error ? <Skeleton h={110} /> : paper.loaded ? (
          <Card style={{ gap: 6 }}>
            <Eyebrow>Practice cash</Eyebrow>
            <Text testID="text-cash" style={{ fontFamily: F.head, fontSize: 36, letterSpacing: -1, color: c.foreground }}>{fmtChips(cash)} <Text style={{ fontSize: 14, fontFamily: F.mono, color: c.mutedForeground }}>chips</Text></Text>
            <Text testID="text-realized" style={{ fontFamily: F.monoMd, color: pctColor(c, realized) }}>Settled return {realized >= 0 ? '+' : ''}{fmtChips(realized)} chips ({settled.length} closed)</Text>
            <Body style={{ fontSize: 12 }}>Chips are a practice unit, not SOL or dollars. Positions hold simulated token units.</Body>
          </Card>
        ) : null}

        <Eyebrow>Open positions</Eyebrow>
        {sellErr ? <Notice tone="error" title="Sell not completed" body={sellErr} testID="sell-error" /> : null}
        {paper.loaded && positions.length === 0 ? <Empty title="No open positions" body="Pick a trending token below and practice a buy with any chip amount." /> : null}
        {positions.map((p) => {
          const q = quotes.get(p.mint);
          const fresh = q ? isFreshQuote(q, now) : false;
          const value = fresh && q ? p.tokenUnits * Number(q.price) : null;
          const pl = value != null ? value - p.chipsInvested : null;
          return (
            <Card key={p.id} style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text onPress={() => router.push({ pathname: '/token/[mint]', params: { mint: p.mint } })} style={{ fontFamily: F.head, fontSize: 20, color: c.foreground }}>{p.symbol}</Text>
                <Body style={{ fontSize: 12 }}>{new Date(p.openedAt).toLocaleDateString()}</Body>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Body>Entry units</Body><Text style={{ fontFamily: F.monoMd, color: c.foreground }}>{fmtUnits(p.tokenUnits)}</Text></View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Body>Invested</Body><Text style={{ fontFamily: F.monoMd, color: c.foreground }}>{fmtChips(p.chipsInvested)} chips</Text></View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Body>Mark now</Body>
                <Text style={{ fontFamily: F.monoMd, color: pctColor(c, pl) }}>{value != null && pl != null ? `${fmtChips(value)} (${fmtPct((pl / p.chipsInvested) * 100)})` : 'No fresh quote'}</Text>
              </View>
              {value == null ? <Body style={{ fontSize: 12 }}>Current value is hidden until a fresh live quote is available{q ? ` (last ${fmtPrice(q.price)} is stale)` : ''}.</Body> : null}
              <Btn testID={`button-sell-${p.symbol}`} label="Sell position" variant="outline" onPress={() => sell(p.mint)} disabled={!fresh || !paper.loaded} busy={paper.busy} />
            </Card>
          );
        })}

        <Eyebrow>Practice a buy</Eyebrow>
        {picked ? (
          <View style={{ gap: 8 }}>
            <BuyPanel token={quotes.get(picked.mint) ?? picked} onDone={() => setPicked(null)} />
            <Btn label="Cancel" variant="outline" onPress={() => setPicked(null)} />
          </View>
        ) : trending.isLoading ? <Skeleton h={60} /> : trending.isError ? (
          <Notice tone="error" title="Quotes did not load" body="Practice buys need live quotes." actionLabel="Retry" onAction={() => trending.refetch()} />
        ) : (trending.data ?? []).slice(0, 10).map((t) => {
          const ok = isFreshQuote(t, now);
          return (
            <Card key={t.mint} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: F.monoMd, color: c.foreground }}>{t.symbol}</Text>
                <Body style={{ fontSize: 12 }}>{ok ? fmtPrice(t.price) : 'Quote unavailable or stale'}</Body>
              </View>
              <Btn testID={`pick-${t.symbol}`} label="Buy" onPress={() => setPicked(t)} disabled={!ok} style={{ minHeight: 40 }} />
            </Card>
          );
        })}

        <Eyebrow>Trade history</Eyebrow>
        {trades.length === 0 ? <Body>No trades yet.</Body> : trades.slice(0, 30).map((t) => (
          <View key={t.id} style={{ flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: c.border, paddingVertical: 8 }}>
            <Text style={{ fontFamily: F.monoMd, color: c.foreground }}>{t.side.toUpperCase()} {t.symbol}</Text>
            <Text style={{ fontFamily: F.mono, color: t.profit != null ? pctColor(c, t.profit) : c.mutedForeground }}>
              {fmtChips(t.chips)}{t.profit != null ? `  ${t.profit >= 0 ? '+' : ''}${fmtChips(t.profit)}` : ''}
            </Text>
          </View>
        ))}

        {paper.loaded || paper.error ? (confirmReset ? (
          <Card style={{ gap: 10 }}>
            <Text style={{ fontFamily: F.bodyBold, color: c.foreground }}>Erase all practice positions and history and restore 10,000 chips?</Text>
            <Btn testID="button-reset-confirm" label="Yes, reset practice account" variant="danger" busy={paper.busy} onPress={async () => { try { await paper.reset(); setConfirmReset(false); } catch { /* Error is displayed by the account provider. */ } }} />
            <Btn label="Keep my account" variant="outline" onPress={() => setConfirmReset(false)} />
          </Card>
        ) : <Btn testID="button-reset" label="Reset practice account" variant="outline" onPress={() => setConfirmReset(true)} />) : null}
      </ScrollView>
    </View>
  );
}
