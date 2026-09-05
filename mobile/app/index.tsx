import { useState } from 'react'
import { Text, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useI18n } from '@/i18n'
import { Button } from '@/ui/components'
import { color, font, radius, space } from '@/ui/theme'

export default function SignIn() {
  const { t, rtl } = useI18n()
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')

  const align = rtl ? 'right' : 'left'

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.bg }}>
      <View style={{ flex: 1, justifyContent: 'center', padding: space.xl, gap: space.xl }}>
        <View style={{ gap: space.sm }}>
          <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: color.blue, alignItems: 'center', justifyContent: 'center', marginBottom: space.md }}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>TC</Text>
          </View>
          <Text style={[font.h1, { color: color.text, textAlign: align }]}>{t('welcome')}</Text>
          <Text style={[font.body, { color: color.secondary, textAlign: align }]}>{t('welcomeHint')}</Text>
        </View>

        <View style={{ gap: space.md }}>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder={t('phone')}
            keyboardType="phone-pad"
            style={{
              backgroundColor: color.card, borderRadius: radius.field, padding: space.lg,
              fontSize: 16, color: color.text, textAlign: align,
            }}
          />
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder={t('code')}
            keyboardType="number-pad"
            maxLength={4}
            style={{
              backgroundColor: color.card, borderRadius: radius.field, padding: space.lg,
              fontSize: 16, color: color.text, textAlign: align,
            }}
          />
          <Button label={t('signIn')} onPress={() => router.replace('/suivi')} />
        </View>

        <Text style={[font.caption, { color: color.tertiary, textAlign: 'center' }]}>{t('privacy')}</Text>
      </View>
    </SafeAreaView>
  )
}
