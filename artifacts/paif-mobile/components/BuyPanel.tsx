import React, { useState } from 'react';
import { Text, TextInput, View, Pressable } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { usePaper } from '@/context/PaperContext';
import { isFreshQuote, quoteProblem } from '@/lib/paper';
import type { Token } from '@/lib/research';
import { Body, Btn, Card, Eyebrow, F, fmtChips, fmtPrice, Notice, useNow } from '@/components/ui';

export function BuyPanel({ token, onDone }: { token: Token; onDone?: () => void }) {
  const c = useColors();
  const now = useNow();
  const paper = usePaper();
  const [text, setText] = useState('100');
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const cash = paper.state.cash;
  const amt = Number(text);
  const validAmt = Number.isFinite(amt) && amt > 0;
  const overCash = validAmt && amt > cash;
  const problem = quoteProblem(token, now) ?? (!isFreshQuote(token, now) ? 'Quote is stale.' : null);
  const reason = !paper.loaded ? 'Paper account is still loading.' : problem ? problem : !validAmt ? 'Enter a chip amount above 0.' : overCash ? `Only ${fmtChips(cash)} chips available.` : null;

  const submit = async () => {
    setErr(null); setOk(null);
    try {
      await paper.buy(token, amt);
      setOk(`Bought ${token.symbol} with ${fmtChips(amt)} practice chips.`);
      onDone?.();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Buy failed.'); }
  };

  return (
    <Card style={{ gap: 12 }}>
      <Eyebrow>Practice buy - {token.symbol}</Eyebrow>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Body>Quote</Body><Text style={{ fontFamily: F.monoMd, color: c.foreground }}>{fmtPrice(token.price)}</Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Body>Practice cash</Body><Text style={{ fontFamily: F.monoMd, color: c.foreground }}>{fmtChips(cash)} chips</Text>
      </View>
      <TextInput testID="input-chips" value={text} onChangeText={setText} keyboardType="decimal-pad" placeholder="Chips"
        placeholderTextColor={c.mutedForeground}
        style={{ borderWidth: 1, borderColor: c.input, borderRadius: 12, paddingHorizontal: 14, height: 48, fontFamily: F.monoMd, fontSize: 18, color: c.foreground, backgroundColor: c.background }} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[10, 100, 500].map((n) => (
          <Pressable key={n} testID={`chip-preset-${n}`} onPress={() => setText(String(n))} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.secondary }}>
            <Text style={{ fontFamily: F.monoMd, color: c.foreground, fontSize: 13 }}>{n}</Text>
          </Pressable>
        ))}
        <Pressable testID="chip-preset-max" onPress={() => setText(String(Math.floor(cash * 100) / 100))} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.secondary }}>
          <Text style={{ fontFamily: F.monoMd, color: c.foreground, fontSize: 13 }}>Max</Text>
        </Pressable>
      </View>
      {reason ? <Body style={{ color: c.destructive }}>{reason}</Body> : null}
      {err ? <Notice tone="error" title="Buy not completed" body={err} testID="buy-error" /> : null}
      {ok ? <Notice tone="info" title={ok} testID="buy-ok" /> : null}
      <Btn testID="button-buy" label="Buy with practice chips" onPress={submit} disabled={!!reason} busy={paper.busy} />
      <Body style={{ fontSize: 12 }}>Simulated token units at a fresh server quote. No wallet, no real funds.</Body>
    </Card>
  );
}
