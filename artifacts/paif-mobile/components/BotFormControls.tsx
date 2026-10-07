import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Body, F } from '@/components/ui';
import { useColors } from '@/hooks/useColors';

export function Field({ label, hint, value, onChangeText, testID, disabled, keyboard = 'default', placeholder }: {
  label: string; hint?: string; value: string; onChangeText: (v: string) => void; testID: string;
  disabled?: boolean; keyboard?: 'default' | 'decimal-pad' | 'number-pad'; placeholder?: string;
}) {
  const c = useColors();
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: c.foreground }}>{label}</Text>
      <TextInput testID={testID} accessibilityLabel={label} value={value} onChangeText={onChangeText} editable={!disabled} keyboardType={keyboard}
        placeholder={placeholder} placeholderTextColor={c.mutedForeground} autoCapitalize="none" autoCorrect={false}
        style={{ fontFamily: F.mono, fontSize: 15, color: c.foreground, borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingHorizontal: 14, minHeight: 46, opacity: disabled ? 0.5 : 1 }} />
      {hint ? <Body style={{ fontSize: 12, lineHeight: 17 }}>{hint}</Body> : null}
    </View>
  );
}

export function Choice<T extends string>({ options, value, onChange, testID, disabled }: {
  options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; testID: string; disabled?: boolean;
}) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} testID={`${testID}-${o.value || 'auto'}`} accessibilityRole="button" accessibilityState={{ selected: on, disabled: !!disabled }}
            disabled={disabled} onPress={() => onChange(o.value)}
            style={{ paddingHorizontal: 14, minHeight: 44, borderRadius: 10, justifyContent: 'center', borderWidth: 1, borderColor: on ? c.primary : c.border, backgroundColor: on ? c.primary : 'transparent', opacity: disabled ? 0.5 : 1 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: on ? c.primaryForeground : c.foreground }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Toggle({ label, hint, value, onChange, testID, disabled }: {
  label: string; hint: string; value: boolean; onChange: (v: boolean) => void; testID: string; disabled?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable testID={testID} accessibilityLabel={label} accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }} disabled={disabled} onPress={() => onChange(!value)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: value ? c.primary : c.border, borderRadius: 12, padding: 12, opacity: disabled ? 0.5 : 1 }}>
      <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: c.primary, backgroundColor: value ? c.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {value ? <Text style={{ color: c.primaryForeground, fontFamily: F.heavy, fontSize: 13 }}>✓</Text> : null}
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: c.foreground }}>{label}</Text>
        <Body style={{ fontSize: 12, lineHeight: 17 }}>{hint}</Body>
      </View>
    </Pressable>
  );
}

export function PercentSetting({ label, hint, value, onChange, presets, range, testID, disabled }: {
  label: string; hint: string; value: string; onChange: (v: string) => void;
  presets: string[]; range: string; testID: string; disabled?: boolean;
}) {
  const c = useColors();
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: c.foreground }}>{label}</Text>
      <Body style={{ fontSize: 12 }}>{hint}</Body>
      <Choice testID={testID} value={value} onChange={onChange} disabled={disabled}
        options={[{ value: '', label: 'Automatic' }, ...presets.map((v) => ({ value: v, label: `${v}%` }))]} />
      <Field testID={`${testID}-custom`} label="Custom value (%)" keyboard="number-pad" placeholder="Automatic"
        hint={`Use ${range} whole percent, or leave blank for Automatic.`} value={value} onChangeText={onChange} disabled={disabled} />
    </View>
  );
}
