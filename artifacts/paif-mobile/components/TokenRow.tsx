import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import type { Token } from '@/lib/research';
import { F, fmtPct, fmtPrice, fmtUsd, MoveCandle, pctColor } from '@/components/ui';

export function TokenRow({ token }: { token: Token }) {
  const c = useColors();
  return (
    <Pressable testID={`token-${token.symbol}`} onPress={() => router.push({ pathname: '/token/[mint]', params: { mint: token.mint } })}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, opacity: pressed ? 0.85 : 1 })}>
      {token.imageUrl ? <Image source={{ uri: token.imageUrl }} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.muted }} /> :
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.muted, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontFamily: F.head, color: c.foreground }}>{token.symbol.slice(0, 1)}</Text></View>}
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontFamily: F.monoMd, fontSize: 15, color: c.foreground }}>{token.symbol}</Text>
        <Text numberOfLines={1} style={{ fontFamily: F.body, fontSize: 12, color: c.mutedForeground }}>{token.name} - MCap {fmtUsd(token.mcap)}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ fontFamily: F.monoMd, fontSize: 13, color: c.foreground }}>{fmtPrice(token.price)}</Text>
        <Text style={{ fontFamily: F.monoMd, fontSize: 12, color: pctColor(c, token.change1h) }}>{fmtPct(token.change1h)} 1h</Text>
      </View>
      <MoveCandle change={token.change1h} size={34} />
    </Pressable>
  );
}
