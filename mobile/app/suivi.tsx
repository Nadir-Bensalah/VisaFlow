import { useEffect, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { Link, useNavigation } from 'expo-router'
import { useI18n } from '@/i18n'
import { Card, Loading, Pill, Progress } from '@/ui/components'
import { color, font, space } from '@/ui/theme'
import { fetchCases, fetchShipments, type CaseSummary, type ShipmentSummary } from '@/data/api'
import { registerForPush } from '@/notifications'

export default function Suivi() {
  const { t, rtl } = useI18n()
  const navigation = useNavigation()
  const [cases, setCases] = useState<CaseSummary[] | null>(null)
  const [shipments, setShipments] = useState<ShipmentSummary[] | null>(null)

  useEffect(() => {
    fetchCases().then(setCases).catch(() => setCases([]))
    fetchShipments().then(setShipments).catch(() => setShipments([]))
    registerForPush()
  }, [])

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Link href="/reglages" asChild>
          <Pressable hitSlop={12}>
            <Text style={[font.small, { color: color.blue }]}>{t('settings')}</Text>
          </Pressable>
        </Link>
      ),
    })
  }, [navigation, t])

  if (!cases || !shipments) return <Loading />

  const align = rtl ? 'right' : 'left'

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <Text style={[font.h2, { color: color.text, textAlign: align }]}>{t('myFiles')}</Text>
      {cases.length === 0 && <Text style={[font.small, { color: color.tertiary }]}>{t('empty')}</Text>}
      {cases.map((c) => {
        const index = c.stages.indexOf(c.stage)
        const missing = c.documents.filter((d) => d.state !== 'validee').length
        return (
          <Link key={c.id} href={{ pathname: '/dossier/[id]', params: { id: c.id } }} asChild>
            <Pressable>
              <Card>
                <View style={{ gap: space.sm }}>
                  <Text style={[font.body, { color: color.text, fontWeight: '600', textAlign: align }]}>{c.visa}</Text>
                  <Text style={[font.caption, { color: color.tertiary, textAlign: align }]}>{c.reference}</Text>
                  <Progress pct={Math.round(((index + 1) / c.stages.length) * 100)} />
                  <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xs }}>
                    <Pill tone="blue">{t('step', { n: index + 1, total: c.stages.length })}</Pill>
                    {missing > 0 && <Pill tone="orange">{`${missing}`}</Pill>}
                  </View>
                </View>
              </Card>
            </Pressable>
          </Link>
        )
      })}

      <Text style={[font.h2, { color: color.text, marginTop: space.md, textAlign: align }]}>{t('shipments')}</Text>
      {shipments.length === 0 && <Text style={[font.small, { color: color.tertiary }]}>{t('empty')}</Text>}
      {shipments.map((s) => {
        const index = s.stages.indexOf(s.stage)
        return (
          <Link key={s.id} href={{ pathname: '/cargaison/[id]', params: { id: s.id } }} asChild>
            <Pressable>
              <Card>
                <View style={{ gap: space.sm }}>
                  <Text style={[font.body, { color: color.text, fontWeight: '600', textAlign: align }]}>{s.from} → {s.to}</Text>
                  <Text style={[font.caption, { color: color.tertiary, textAlign: align }]}>{s.reference} · {s.goods}</Text>
                  <Progress pct={Math.round(((index + 1) / s.stages.length) * 100)} tone={color.violet} />
                  {s.eta && (
                    <Text style={[font.caption, { color: color.secondary, textAlign: align }]}>
                      {t('eta')} · {new Date(s.eta).toLocaleDateString()}
                    </Text>
                  )}
                </View>
              </Card>
            </Pressable>
          </Link>
        )
      })}
    </ScrollView>
  )
}
