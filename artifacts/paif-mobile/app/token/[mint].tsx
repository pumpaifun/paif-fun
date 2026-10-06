import React, { useCallback, useEffect, useRef } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useScanToken, useTrendingTokens } from '@/lib/research';
import type { ScanResult } from '@/lib/research';
import { isFreshQuote, quoteProblem } from '@/lib/paper';
import { BuyPanel } from '@/components/BuyPanel';
import { LiveTradePanel } from '@/components/LiveTradePanel';
import { Body, Btn, Card, Eyebrow, F, fmtPct, fmtPrice, fmtUsd, Header, MoveCandle, Notice, pctColor, shortAddr, Skeleton, useNow } from '@/components/ui';

const RISK_STALE_MS = 5 * 60 * 1000;
function ageText(ms: number) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'under a minute ago';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

function RiskCard({ risk, now }: { risk: NonNullable<ScanResult['risk']>; now: number }) {
  const c = useColors();
  const at = Date.parse(risk.generatedAt);
  const known = Number.isFinite(at) && at <= now;
  const age = known ? Math.max(0, now - at) : Infinity;
  const stale = age > RISK_STALE_MS;
  const cov = (risk.sanctionsCoverage ?? '').trim();
  const covUnknown = !cov || /unknown|unavailable|not (checked|available|covered)|partial|incomplete|none/i.test(cov);
  const critical = risk.flags.filter((f) => /crit|high|severe/i.test(f.severity));
  const warning = risk.flags.filter((f) => !/crit|high|severe/i.test(f.severity));
  const bandColor = risk.band === 'low' ? c.primary : risk.band === 'high' ? c.destructive : c.mutedForeground;
  return (
    <Card style={{ gap: 10 }}>
      <Eyebrow>Risk evidence</Eyebrow>
      {stale ? (
        <Notice testID="risk-stale" title={known ? `Historical risk snapshot - ${ageText(age)}` : 'Risk snapshot time unknown'}
          body="This risk read is older than 5 minutes (or undated). Conditions may have changed; rescan before relying on it." />
      ) : <Body style={{ fontSize: 12 }}>Risk snapshot generated {ageText(age)}. Conditions can change at any time.</Body>}
      <Text style={{ fontFamily: F.head, fontSize: 24, color: bandColor }}>{risk.band.toUpperCase()} risk <Text style={{ fontFamily: F.mono, fontSize: 14, color: c.mutedForeground }}>score {risk.score} - grade {risk.grade} - confidence {risk.confidence}</Text></Text>
      {risk.sanctioned ? (
        <Notice tone="error" testID="sanctioned" title="Sanctions match" body={risk.sanctionDetail ?? 'A sanctions match was reported.'} />
      ) : covUnknown ? (
        <Notice testID="sanctions-unknown" title="Sanctions screening not confirmed" body={`Coverage: ${cov || 'not reported'}. No match was found in what was checked, but this is not a compliance pass.`} />
      ) : (
        <Body style={{ fontSize: 13 }}>No sanctions match in covered lists. Coverage: {cov}</Body>
      )}
      {critical.map((f, i) => (
        <Notice key={`c${i}`} tone="error" title={`Critical: ${f.label}`} body={f.detail} />
      ))}
      {warning.map((f, i) => (
        <Notice key={`w${i}`} title={`Warning: ${f.label}`} body={f.detail} />
      ))}
      {risk.flags.length === 0 ? <Body style={{ fontSize: 12 }}>No flags were raised. Absence of flags is not proof of safety.</Body> : null}
      {risk.categories.map((cat) => (
        <View key={cat.key} style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ fontFamily: F.bodyBold, color: c.foreground, flex: 1 }}>{cat.label}</Text>
            <Text style={{ fontFamily: F.monoMd, color: c.mutedForeground }}>{cat.score} (w {cat.weight})</Text>
          </View>
          <Body style={{ fontSize: 13 }}>{cat.detail}</Body>
        </View>
      ))}
      <Body style={{ fontSize: 11 }}>Evidence semantics: the scanner reports on-chain and market signals it could read. Scores are heuristics, missing data lowers confidence, and none of this predicts price or guarantees safety.</Body>
    </Card>
  );
}

export default function TokenDetail() {
  const c = useColors();
  const now = useNow();
  const { mint } = useLocalSearchParams<{ mint: string }>();
  const query = decodeURIComponent(String(mint ?? ''));
  const scan = useScanToken();
  const trending = useTrendingTokens();
  const run = useRef(scan.mutateAsync);
  run.current = scan.mutateAsync;
  const doScan = useCallback(() => { run.current(query).catch(() => {}); }, [query]);
  useEffect(() => { if (query) doScan(); }, [query, doScan]);

  const r = scan.data;
  const quote = trending.data?.find((t) => t.mint === (r?.tokenAddress ?? query));
  const ratingColor = r?.rating === 'green' ? c.primary : r?.rating === 'red' ? c.destructive : c.mutedForeground;
  const ratingLabel = r?.rating === 'green' ? 'Lower risk signals' : r?.rating === 'yellow' ? 'Mixed signals' : r?.rating === 'red' ? 'High risk signals' : 'No rating';

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Header title="Research" subtitle={shortAddr(query)} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60, gap: 14 }} keyboardShouldPersistTaps="handled">
        {scan.isPending ? (<><Skeleton h={90} /><Skeleton h={120} /><Skeleton h={160} /></>) : null}
        {scan.isError ? <Notice tone="error" testID="scan-error" title="Scan failed" body={scan.error instanceof Error ? scan.error.message : 'The token could not be scanned. It may not be a valid Solana address.'} actionLabel="Retry scan" onAction={doScan} /> : null}
        {r ? (
          <>
            <Card style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                {r.tokenImage ? <Image source={{ uri: r.tokenImage }} style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.muted }} /> : null}
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontFamily: F.head, fontSize: 24, color: c.foreground }}>{r.tokenSymbol || 'Unknown'}</Text>
                  <Body numberOfLines={1}>{r.tokenName}</Body>
                </View>
                <MoveCandle change={quote?.change1h ?? null} size={44} />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: ratingColor }} />
                <Text testID="text-rating" style={{ fontFamily: F.bodyBold, fontSize: 16, color: c.foreground }}>{ratingLabel}</Text>
              </View>
              <Body>{r.ratingExplanation || 'No explanation was returned.'}</Body>
            </Card>

            {r.dataIncomplete ? <Notice testID="data-incomplete" title="Data is incomplete" body="Some holder, creator, or transaction data was unavailable. Treat the read below as partial, not a clean bill of health." /> : null}

            {r.risk ? <RiskCard risk={r.risk} now={now} /> : (
              <Notice testID="risk-missing" title="No risk score available" body="The scanner returned no risk evidence. That is a gap in the data, not a safe result, and sanctions screening was not confirmed." />
            )}

            <Card style={{ gap: 8 }}>
              <Eyebrow>Holders</Eyebrow>
              <Text style={{ fontFamily: F.monoMd, color: c.foreground }}>Top holder: {Number.isFinite(r.topHolderPercent) ? `${r.topHolderPercent.toFixed(1)}%` : 'n/a'}</Text>
              <Body style={{ fontSize: 12 }}>Creator: {r.creatorAddress ? shortAddr(r.creatorAddress) : 'not reported'}</Body>
              {r.topHolders.length ? r.topHolders.slice(0, 8).map((h) => (
                <View key={h.address} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontFamily: F.mono, color: c.mutedForeground, fontSize: 13 }}>{h.label ?? shortAddr(h.address)}{h.category ? ` (${h.category})` : ''}</Text>
                  <Text style={{ fontFamily: F.monoMd, color: c.foreground, fontSize: 13 }}>{h.percent.toFixed(2)}%</Text>
                </View>
              )) : <Body>Holder list not available.</Body>}
            </Card>

            <Card style={{ gap: 8 }}>
              <Eyebrow>Recent transactions</Eyebrow>
              {r.recentTransactions.length ? r.recentTransactions.slice(0, 8).map((t) => (
                <View key={t.signature} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontFamily: F.monoMd, color: c.foreground, fontSize: 13 }}>{t.type}</Text>
                  <Text style={{ fontFamily: F.mono, color: c.mutedForeground, fontSize: 13 }}>{String(t.amount)}</Text>
                </View>
              )) : <Body>No recent transactions were returned.</Body>}
            </Card>

            <Card style={{ gap: 8 }}>
              <Eyebrow>Market quote</Eyebrow>
              {quote ? (
                <>
                  <Text style={{ fontFamily: F.head, fontSize: 24, color: c.foreground }}>{fmtPrice(quote.price)}</Text>
                  <Text style={{ fontFamily: F.monoMd, color: pctColor(c, quote.change1h) }}>{fmtPct(quote.change1h)} 1h   {fmtPct(quote.change5m)} 5m</Text>
                  <Body style={{ fontSize: 13 }}>MCap {fmtUsd(quote.mcap)} - Liquidity {fmtUsd(quote.liquidity)} - Vol 1h {fmtUsd(quote.volume1h)}</Body>
                  {!isFreshQuote(quote, now) ? <Body style={{ color: c.destructive }}>{quoteProblem(quote, now) ?? 'Quote is stale.'}</Body> : null}
                </>
              ) : <Body>This token is not in the live trending feed, so there is no verified quote. Scanning alone does not provide a price for practice trades.</Body>}
            </Card>

            {quote ? <BuyPanel token={quote} /> : <Notice tone="info" title="Practice buy unavailable" body="Practice trades need a fresh quote from the trending feed." />}
            <LiveTradePanel mint={r.tokenAddress || query} symbol={r.tokenSymbol || 'token'} />
            <Btn label="Rescan" variant="outline" onPress={doScan} testID="button-rescan" busy={scan.isPending} />
            <Body style={{ fontSize: 11 }}>Research is informational and not financial advice.</Body>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
