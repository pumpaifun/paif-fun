import React from 'react';
import { Platform, View, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { F, TAB_H } from '@/components/ui';

export default function TabLayout() {
  const c = useColors();
  const web = Platform.OS === 'web';
  const icon = (name: React.ComponentProps<typeof Feather>['name']) => ({ color }: { color: string | import('react-native').ColorValue }) => <Feather name={name} size={22} color={color as string} />;
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: c.primary,
      tabBarInactiveTintColor: c.mutedForeground,
      tabBarLabelStyle: { fontFamily: F.bodyBold, fontSize: 11 },
      tabBarStyle: { backgroundColor: c.background, borderTopColor: c.border, borderTopWidth: 1, elevation: 0, ...(web ? { height: TAB_H } : {}) },
      tabBarBackground: () => <View style={[StyleSheet.absoluteFill, { backgroundColor: c.background }]} />,
    }}>
      <Tabs.Screen name="index" options={{ title: 'Discover', tabBarIcon: icon('compass'), tabBarButtonTestID: 'tab-discover' }} />
      <Tabs.Screen name="paper" options={{ title: 'Paper', tabBarIcon: icon('layers'), tabBarButtonTestID: 'tab-paper' }} />
      <Tabs.Screen name="wallet" options={{ title: 'Wallet', tabBarIcon: icon('credit-card'), tabBarButtonTestID: 'tab-wallet' }} />
    </Tabs>
  );
}
