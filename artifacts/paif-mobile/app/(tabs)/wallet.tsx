import React from 'react';
import { Linking, Platform, ScrollView, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useWallet } from '@/context/WalletContext';
import { Body, Btn, Card, Eyebrow, F, Header, Notice, shortAddr, useBottomPad } from '@/components/ui';

export default function WalletScreen() {
  const c = useColors();
  const pad = useBottomPad();
  const w = useWallet();
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Header title="Wallet" subtitle="Non-custodial" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: pad, gap: 14 }}>
        {!w.supported ? (
          <Notice tone="info" testID="wallet-unsupported" title="Wallet needs the Android build"
            body={Platform.OS === 'android' ? 'This build does not include the Solana Mobile wallet module.' : 'Wallet connection works only in the custom Android build with a compatible Solana wallet installed. It is unavailable on web and in Expo Go.'}
            actionLabel="Open setup info" onAction={() => Linking.openURL('https://docs.solanamobile.com/get-started/development-setup')} />
        ) : null}
        {w.error ? <Notice tone="error" testID="wallet-error" title="Wallet message" body={w.error} actionLabel="Dismiss" onAction={w.clearError} /> : null}

        <Card style={{ gap: 10 }}>
          <Eyebrow>Connection</Eyebrow>
          <Text testID="text-address" style={{ fontFamily: F.monoMd, fontSize: 16, color: c.foreground }}>{w.address ? shortAddr(w.address) : 'Not connected'}</Text>
          <Body>Connecting only shares your public address. PAIF never holds keys or moves funds from this app.</Body>
          {w.address ? <Btn testID="button-disconnect" label="Disconnect" variant="outline" onPress={w.disconnect} busy={w.busy} />
            : <Btn testID="button-connect" label="Connect wallet" onPress={w.connect} disabled={!w.supported} busy={w.busy} />}
        </Card>

        <Card style={{ gap: 10 }}>
          <Eyebrow>Message signing demo</Eyebrow>
          <Body>Signs a harmless text message to prove wallet ownership. No transaction, no fee.</Body>
          <Btn testID="button-sign" label="Sign demo message" onPress={w.signDemo} disabled={!w.address || !w.supported} busy={w.busy} />
          {!w.address ? <Body style={{ fontSize: 12 }}>Connect a wallet first.</Body> : null}
          {w.proof ? (
            <View testID="proof" style={{ gap: 4, padding: 12, borderRadius: 12, backgroundColor: c.muted }}>
              <Text style={{ fontFamily: F.bodyBold, color: w.proof.verified ? c.primary : c.destructive }}>{w.proof.verified ? 'Signature verified' : 'Signature NOT verified'}</Text>
              <Text style={{ fontFamily: F.mono, fontSize: 12, color: c.foreground }}>{w.proof.message}</Text>
              <Text numberOfLines={3} style={{ fontFamily: F.mono, fontSize: 11, color: c.mutedForeground }}>{w.proof.signature}</Text>
            </View>
          ) : null}
        </Card>

        <Card style={{ gap: 6 }}>
          <Eyebrow>Limits of this build</Eyebrow>
          <Body>Android only, custom development build. Requires an installed Mobile Wallet Adapter wallet.</Body>
          <Body>No trading, swaps, or bot controls. Paper practice is separate and uses simulated chips.</Body>
        </Card>
      </ScrollView>
    </View>
  );
}
