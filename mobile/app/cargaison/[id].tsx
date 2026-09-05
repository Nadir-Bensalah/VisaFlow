import { useEffect, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { useI18n } from '@/i18n'
import { Card, Loading, Progress, Timeline } from '@/ui/components'
import { color, font, space } from '@/ui/theme'
import { fetchShipments, type ShipmentSummary } from '@/data/api'

const STAGE_LABEL: Record<string, string> = {
  demande: 'Demande reçue', ramassage: 'Ramassage', entrepot: 'Entrepôt Guangzhou',
  empotage: 'Empotage', depart: 'Départ du port', transit: 'En transit',
  arrivee: 'Arrivé au port', douane: 'Dédouanement', livraison: 'En livraison', livre: 'Livré',
}

export default function Cargaison() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { t, rtl } = useI18n()
  const [shipment, setShipment] = useState<ShipmentSummary | null>(null)

  useEffect(() => {
    fetchShipments().then((list) => setShipment(list.find((s) => s.id === id) ?? list[0] ?? null))
  }, [id])

  if (!shipment) return <Loading />

  const align = rtl ? 'right' : 'left'
  const index = shipment.stages.indexOf(shipment.stage)

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <View style={{ gap: space.xs }}>
        <Text style={[font.h1, { color: color.text, textAlign: align }]}>{shipment.from} → {shipment.to}</Text>
        <Text style={[font.small, { color: color.tertiary, textAlign: align }]}>{shipment.reference} · {shipment.goods}</Text>
      </View>

      <Card title={t('tracking')}>
        <Progress pct={Math.round(((index + 1) / shipment.stages.length) * 100)} tone={color.violet} />
        {shipment.eta && (
          <Text style={[font.small, { color: color.secondary, textAlign: align }]}>
            {t('eta')} · {new Date(shipment.eta).toLocaleDateString()}
          </Text>
        )}
        <Timeline steps={shipment.stages.map((s) => STAGE_LABEL[s] ?? s)} currentIndex={index} />
      </Card>
    </ScrollView>
  )
}
