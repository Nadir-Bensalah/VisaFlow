import { ActivityIndicator, Pressable, Text, View, type ViewStyle } from 'react-native'
import type { ReactNode } from 'react'
import { color, font, radius, shadow, space } from './theme'

export function Card({ title, children, style }: { title?: string; children: ReactNode; style?: ViewStyle }) {
  return (
    <View style={[{ backgroundColor: color.card, borderRadius: radius.card, padding: space.lg, gap: space.md }, shadow, style]}>
      {title ? <Text style={[font.h2, { color: color.text }]}>{title}</Text> : null}
      {children}
    </View>
  )
}

export function Pill({ tone = 'gray', children }: { tone?: 'gray' | 'blue' | 'green' | 'orange' | 'red' | 'violet'; children: ReactNode }) {
  const bg = {
    gray: color.tintGray, blue: color.tintBlue, green: color.tintGreen,
    orange: color.tintOrange, red: color.tintRed, violet: 'rgba(94,92,230,0.12)',
  }[tone]
  const fg = { gray: color.secondary, blue: color.blue, green: color.green, orange: color.orange, red: color.red, violet: color.violet }[tone]
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' }}>
      <Text style={[font.caption, { color: fg, fontWeight: '500' }]}>{children}</Text>
    </View>
  )
}

export function Progress({ pct, tone = color.blue }: { pct: number; tone?: string }) {
  return (
    <View style={{ height: 6, borderRadius: radius.pill, backgroundColor: color.tintGray, overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(pct, 2)}%`, height: 6, borderRadius: radius.pill, backgroundColor: tone }} />
    </View>
  )
}

export function Button({ label, onPress, variant = 'primary', disabled }: {
  label: string
  onPress: () => void
  variant?: 'primary' | 'secondary'
  disabled?: boolean
}) {
  const primary = variant === 'primary'
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        backgroundColor: primary ? color.blue : color.card,
        borderColor: primary ? 'transparent' : color.hairline,
        borderWidth: 1,
        borderRadius: radius.pill,
        paddingVertical: 13,
        paddingHorizontal: space.xl,
        alignItems: 'center',
        opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
      })}
    >
      <Text style={[font.body, { color: primary ? '#fff' : color.text, fontWeight: '500' }]}>{label}</Text>
    </Pressable>
  )
}

export function Timeline({ steps, currentIndex }: { steps: string[]; currentIndex: number }) {
  return (
    <View style={{ gap: space.md }}>
      {steps.map((label, i) => (
        <View key={label + i} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View
            style={{
              width: 14, height: 14, borderRadius: 7, borderWidth: 2,
              backgroundColor: i < currentIndex ? color.green : color.card,
              borderColor: i < currentIndex ? color.green : i === currentIndex ? color.blue : color.hairline,
            }}
          />
          <Text style={[font.small, { color: i === currentIndex ? color.text : color.secondary, fontWeight: i === currentIndex ? '600' : '400' }]}>
            {label}
          </Text>
        </View>
      ))}
    </View>
  )
}

export function Loading() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={color.blue} />
    </View>
  )
}
