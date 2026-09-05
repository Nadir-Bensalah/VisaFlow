import { useEffect, useState } from 'react'
import { Pressable, ScrollView, Switch, Text, View } from 'react-native'
import { useI18n, LOCALES, NATIVE, type Locale } from '@/i18n'
import { Card } from '@/ui/components'
import { color, font, radius, space } from '@/ui/theme'
import { registerForPush } from '@/notifications'

export default function Reglages() {
  const { t, locale, setLocale, rtl } = useI18n()
  const [push, setPush] = useState(false)

  useEffect(() => { registerForPush().then((token) => setPush(Boolean(token))) }, [])

  const align = rtl ? 'right' : 'left'

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <Card title={t('language')}>
        <View style={{ gap: space.sm }}>
          {LOCALES.map((l: Locale) => (
            <Pressable
              key={l}
              onPress={() => setLocale(l)}
              style={{
                paddingVertical: space.md, paddingHorizontal: space.lg,
                borderRadius: radius.field,
                backgroundColor: l === locale ? color.tintBlue : 'transparent',
              }}
            >
              <Text style={[font.body, { color: l === locale ? color.blue : color.text, textAlign: align }]}>{NATIVE[l]}</Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <Card title={t('notifications')}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.lg }}>
          <Text style={[font.small, { color: color.secondary, flex: 1, textAlign: align }]}>{t('notificationsHint')}</Text>
          <Switch value={push} onValueChange={async (v) => setPush(v ? Boolean(await registerForPush()) : false)} />
        </View>
      </Card>
    </ScrollView>
  )
}
