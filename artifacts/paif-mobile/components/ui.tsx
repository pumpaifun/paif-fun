import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

export const F = {
  body: 'Manrope_500Medium', bodyBold: 'Manrope_700Bold', heavy: 'Manrope_800ExtraBold',
  head: 'SpaceGrotesk_700Bold', mono: 'DMMono_400Regular', monoMd: 'DMMono_500Medium',
};
export const WEB_TOP = 67;
export const WEB_BOTTOM = 34;
export const TAB_H = 84;

export function useTopInset() {
  const i = useSafeAreaInsets();
  return Platform.OS === 'web' ? WEB_TOP : i.top;
}
export function useBottomPad() {
  const i = useSafeAreaInsets();
  return (Platform.OS === 'web' ? TAB_H : 56 + i.bottom) + 24;
}

export const fmtUsd = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n) || n <= 0) return 'n/a';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};
export const fmtPrice = (p: string | number | null | undefined) => {
  const n = Number(p);
  if (!Number.isFinite(n) || n <= 0) return 'n/a';
  if (n < 0.0001) return `$${n.toExponential(2)}`;
  if (n < 1) return `$${n.toPrecision(4)}`;
  return `$${n.toFixed(2)}`;
};
export const fmtPct = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? 'n/a' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
export const fmtChips = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}`;
export const fmtUnits = (n: number) =>
  !Number.isFinite(n) || n <= 0 ? 'n/a' : n >= 10000 ? Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n) : n.toLocaleString('en-US', { maximumFractionDigits: 4 });
export const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 5)}...${a.slice(-5)}` : a);

export function Header({ title, subtitle, onBack, right }: { title?: string; subtitle?: string; onBack?: () => void; right?: React.ReactNode }) {
  const c = useColors();
  const top = useTopInset();
  return (
    <View style={{ paddingTop: top + 8, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: c.background, borderBottomWidth: 1, borderBottomColor: c.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {onBack ? (
          <Pressable testID="button-back" accessibilityRole="button" accessibilityLabel="Go to previous screen" onPress={onBack} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: F.heavy, color: c.primary, fontSize: 32 }}>‹</Text>
          </Pressable>
        ) : (
          <Image source={require('@/assets/images/paif-favicon.png')} style={{ width: 30, height: 30, borderRadius: 7 }} />
        )}
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontFamily: F.head, fontSize: 22, letterSpacing: -0.6, color: c.foreground }}>{title ?? 'PAIF.fun'}</Text>
          {subtitle ? <Text numberOfLines={1} style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: 1.6, color: c.primary, textTransform: 'uppercase' }}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const c = useColors();
  return <View style={[{ backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: 18, padding: 16 }, style]}>{children}</View>;
}

export function Eyebrow({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  const c = useColors();
  return <Text style={[{ fontFamily: F.monoMd, fontSize: 11, letterSpacing: 1.8, textTransform: 'uppercase', color: c.mutedForeground }, style]}>{children}</Text>;
}

export function Body({ children, style, numberOfLines }: { children: React.ReactNode; style?: TextStyle; numberOfLines?: number }) {
  const c = useColors();
  return <Text numberOfLines={numberOfLines} style={[{ fontFamily: F.body, fontSize: 14, lineHeight: 20, color: c.mutedForeground }, style]}>{children}</Text>;
}

export function Btn({ label, onPress, variant = 'primary', disabled, busy, testID, style }: {
  label: string; onPress: () => void; variant?: 'primary' | 'outline' | 'danger'; disabled?: boolean; busy?: boolean; testID?: string; style?: ViewStyle;
}) {
  const c = useColors();
  const off = disabled || busy;
  const bg = variant === 'primary' ? c.primary : variant === 'danger' ? c.destructive : 'transparent';
  const fg = variant === 'primary' ? c.primaryForeground : variant === 'danger' ? c.destructiveForeground : c.foreground;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ disabled: !!off }} disabled={off} onPress={onPress}
      style={({ pressed }) => [{ minHeight: 46, borderRadius: 12, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, backgroundColor: bg, borderWidth: variant === 'outline' ? 1 : 0, borderColor: c.border, opacity: off ? 0.45 : pressed ? 0.85 : 1 }, style]}>
      {busy ? <ActivityIndicator size="small" color={fg} /> : null}
      <Text style={{ fontFamily: F.heavy, fontSize: 15, color: fg }}>{label}</Text>
    </Pressable>
  );
}

export function Skeleton({ h = 56, style }: { h?: number; style?: ViewStyle }) {
  const c = useColors();
  return <View style={[{ height: h, borderRadius: 14, backgroundColor: c.muted }, style]} />;
}

export function Notice({ title, body, actionLabel, onAction, tone = 'warn', testID }: {
  title: string; body?: string; actionLabel?: string; onAction?: () => void; tone?: 'warn' | 'error' | 'info'; testID?: string;
}) {
  const c = useColors();
  const edge = tone === 'error' ? c.destructive : tone === 'info' ? c.primary : c.mutedForeground;
  return (
    <View testID={testID} style={{ borderRadius: 14, borderWidth: 1, borderColor: edge, borderLeftWidth: 4, backgroundColor: c.card, padding: 14, gap: 6 }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: c.foreground }}>{title}</Text>
      {body ? <Body>{body}</Body> : null}
      {actionLabel && onAction ? <Btn label={actionLabel} onPress={onAction} variant="outline" style={{ marginTop: 6, alignSelf: 'flex-start' }} testID={testID ? `${testID}-action` : undefined} /> : null}
    </View>
  );
}

export function Empty({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={{ alignItems: 'center', padding: 24, gap: 8 }}>
      <Image source={require('@/assets/images/paif-mascot.png')} style={{ width: 64, height: 80, opacity: 0.9 }} resizeMode="contain" />
      <Text style={{ fontFamily: F.head, fontSize: 18, color: c.foreground }}>{title}</Text>
      <Body style={{ textAlign: 'center' }}>{body}</Body>
      {children}
    </View>
  );
}

/** Restrained Invaders-style candle: height encodes the REAL 1h move only. Not a price history. */
export function MoveCandle({ change, size = 40 }: { change: number | null; size?: number }) {
  const c = useColors();
  if (change == null || !Number.isFinite(change)) {
    return <View style={{ width: size, height: size, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: c.border }} accessibilityLabel="No movement data" />;
  }
  const up = change >= 0;
  const h = Math.max(10, Math.min(size, Math.abs(change) * 1.2 + 10));
  const col = up ? c.primary : c.destructive;
  return (
    <View style={{ width: size, height: size, justifyContent: up ? 'flex-end' : 'flex-start' }} accessibilityLabel={`1 hour move ${fmtPct(change)}`}>
      <View style={{ height: h, backgroundColor: col, borderRadius: 7, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4 }}>
        {h >= 18 ? (<><View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: c.primaryForeground }} /><View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: c.primaryForeground }} /></>) : null}
      </View>
    </View>
  );
}

export const pctColor = (c: ReturnType<typeof useColors>, n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? c.mutedForeground : n >= 0 ? c.primary : c.destructive;

export const s = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center' } });

/** Shared ticking clock so staleness guards re-evaluate even when no feed data changes. */
const listeners = new Set<(n: number) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
export function useNow(intervalMs = 5000) {
  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    listeners.add(setNow);
    setNow(Date.now());
    if (!timer) timer = setInterval(() => { const n = Date.now(); listeners.forEach((l) => l(n)); }, intervalMs);
    return () => {
      listeners.delete(setNow);
      if (listeners.size === 0 && timer) { clearInterval(timer); timer = null; }
    };
  }, [intervalMs]);
  return now;
}
