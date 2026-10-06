import React, { useState } from 'react';
import { Image, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useMarketWeather, useTrendingTokens } from '@/lib/research';
import { Body, Btn, Card, Empty, Eyebrow, F, fmtPct, fmtPrice, Header, Notice, pctColor, Skeleton, useBottomPad } from '@/components/ui';
import { TokenRow } from '@/components/TokenRow';

export default function Discover() {
  const c = useColors();
  const pad = useBottomPad();
  const [q, setQ] = useState('');
  const trending = useTrendingTokens();
  const weather = useMarketWeather();
  const w = weather.data;
  const go = () => { const v = q.trim(); if (v) router.push({ pathname: '/token/[mint]', params: { mint: v } }); };
  const refresh = () => { trending.refetch(); weather.refetch(); };

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Header subtitle="Pump AI Fun" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: pad, gap: 16 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={trending.isRefetching} onRefresh={refresh} tintColor={c.primary} />}>
        <View>
          <Text style={{ fontFamily: F.head, fontSize: 34, lineHeight: 36, letterSpacing: -1.6, color: c.foreground }}>Check a token before you trade.</Text>
          <Body style={{ marginTop: 8 }}>Scan a Solana token address or pump.fun URL. Practice with simulated chips first.</Body>
        </View>

        <View style={{ gap: 10 }}>
          <TextInput testID="input-search" value={q} onChangeText={setQ} onSubmitEditing={go} autoCapitalize="none" autoCorrect={false} returnKeyType="search"
            placeholder="Contract address or pump.fun URL" placeholderTextColor={c.mutedForeground}
            style={{ height: 50, borderRadius: 12, borderWidth: 1, borderColor: c.input, paddingHorizontal: 14, fontFamily: F.body, fontSize: 15, color: c.foreground, backgroundColor: c.card }} />
          <Btn testID="button-scan" label="Scan token" onPress={go} disabled={!q.trim()} />
        </View>

        <Card style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Eyebrow>Market weather</Eyebrow>
              {weather.isLoading ? <Skeleton h={40} style={{ marginTop: 8 }} /> :
                weather.isError ? <Body style={{ marginTop: 6 }}>Could not load market data.</Body> :
                !w?.available ? <Body style={{ marginTop: 6 }}>Market data is not available right now. Nothing is estimated.</Body> :
                <Text style={{ fontFamily: F.head, fontSize: 22, color: c.foreground, marginTop: 4, textTransform: 'capitalize' }}>{w.mood ?? 'No mood read'}</Text>}
            </View>
            <Image source={require('@/assets/images/paif-mascot.png')} style={{ width: 52, height: 64 }} resizeMode="contain" />
          </View>
          {w?.available ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[['SOL', w.solChg24, w.solUsd], ['BTC', w.btcChg24, undefined], ['NASDAQ', w.nasdaqChg1d, undefined]].map(([k, v, p]) => (
                <View key={String(k)} style={{ flex: 1, padding: 10, borderRadius: 12, backgroundColor: c.muted }}>
                  <Text style={{ fontFamily: F.monoMd, fontSize: 10, color: c.mutedForeground, letterSpacing: 1 }}>{String(k)}</Text>
                  <Text style={{ fontFamily: F.monoMd, fontSize: 14, color: pctColor(c, v as number | null | undefined), marginTop: 2 }}>{fmtPct(v as number | null | undefined)}</Text>
                  {p ? <Text style={{ fontFamily: F.mono, fontSize: 10, color: c.mutedForeground }}>{fmtPrice(p as number)}</Text> : null}
                </View>
              ))}
            </View>
          ) : null}
          {w?.available && w.facts ? <Body style={{ fontSize: 12 }}>{w.facts}</Body> : null}
          {w?.available && w.nasdaqChg1d == null ? <Body style={{ fontSize: 12 }}>Nasdaq read unavailable (market closed or no data).</Body> : null}
          {weather.isError ? <Btn label="Retry" variant="outline" onPress={() => weather.refetch()} testID="retry-weather" style={{ alignSelf: 'flex-start' }} /> : null}
        </Card>

        <View style={{ gap: 10 }}>
          <Eyebrow>Trending on Solana</Eyebrow>
          {trending.isLoading ? [0, 1, 2, 3].map((i) => <Skeleton key={i} h={66} />) :
            trending.isError ? <Notice tone="error" title="Trending tokens did not load" body="Check your connection and try again." actionLabel="Retry" onAction={() => trending.refetch()} testID="trending-error" /> :
            !trending.data?.length ? <Empty title="Nothing trending" body="The market feed returned no tokens. Pull to refresh." /> :
            trending.data.map((t) => <TokenRow key={t.mint} token={t} />)}
          <Body style={{ fontSize: 11 }}>Candle height shows the real 1 hour move only. It is not a price history.</Body>
        </View>
      </ScrollView>
    </View>
  );
}
