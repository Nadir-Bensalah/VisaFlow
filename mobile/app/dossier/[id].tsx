import { useEffect, useState } from 'react'
import { Alert, ScrollView, Text, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { useI18n } from '@/i18n'
import { Button, Card, Loading, Pill, Timeline } from '@/ui/components'
import { color, font, space } from '@/ui/theme'
import { fetchCases, type CaseSummary } from '@/data/api'

const STAGE_LABEL: Record<string, string> = {
  nouveau: 'Nouveau', pieces: 'Pièces à réunir', verification: 'Vérification',
  rendez_vous: 'Rendez-vous', depot: 'Dépôt', consulat: 'Au consulat',
  decision: 'Décision', retrait: 'À retirer', clos: 'Clos',
}

export default function Dossier() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { t, rtl } = useI18n()
  const [kase, setCase] = useState<CaseSummary | null>(null)

  useEffect(() => {
    fetchCases().then((list) => setCase(list.find((c) => c.id === id) ?? list[0] ?? null))
  }, [id])

  if (!kase) return <Loading />

  const align = rtl ? 'right' : 'left'
  const index = kase.stages.indexOf(kase.stage)
  const missing = kase.documents.filter((d) => d.state !== 'validee')

  const send = async (label: string) => {
    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (!permission.granted) {
      Alert.alert(label, t('upload'))
      return
    }
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.7 })
    if (!shot.canceled) Alert.alert(label, t('upload'))
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <View style={{ gap: space.xs }}>
        <Text style={[font.h1, { color: color.text, textAlign: align }]}>{kase.visa}</Text>
        <Text style={[font.small, { color: color.tertiary, textAlign: align }]}>{kase.reference}</Text>
      </View>

      <Card title={t('tracking')}>
        <Timeline steps={kase.stages.map((s) => STAGE_LABEL[s] ?? s)} currentIndex={index} />
      </Card>

      <Card title={t('missing')}>
        {missing.length === 0 ? (
          <Text style={[font.body, { color: color.green, textAlign: align }]}>{t('allGood')}</Text>
        ) : (
          <View style={{ gap: space.md }}>
            {missing.map((d) => (
              <View key={d.id} style={{ gap: space.sm, borderBottomWidth: 1, borderBottomColor: color.hairline, paddingBottom: space.md }}>
                <Text style={[font.small, { color: color.text, textAlign: align }]}>{d.label}</Text>
                <Pill tone={d.state === 'manquante' ? 'red' : 'orange'}>{d.state}</Pill>
                <Button label={t('upload')} variant="secondary" onPress={() => send(d.label)} />
              </View>
            ))}
          </View>
        )}
      </Card>

      {kase.appointment && (
        <Card title={t('appointment')}>
          <Text style={[font.body, { color: color.text, textAlign: align }]}>
            {new Date(kase.appointment.at).toLocaleString()}
          </Text>
          <Text style={[font.small, { color: color.secondary, textAlign: align }]}>{kase.appointment.location}</Text>
        </Card>
      )}

      {kase.balance > 0 && (
        <Card title={t('balance')}>
          <Text style={[font.h2, { color: color.text, textAlign: align }]}>{kase.balance} {kase.currency}</Text>
        </Card>
      )}

      <Text style={[font.caption, { color: color.tertiary, textAlign: 'center' }]}>{t('privacy')}</Text>
    </ScrollView>
  )
}
