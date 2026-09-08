import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Button, Card, Combobox, Field, Modal, Pill, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import {
  entryLabel, linkShipmentActors, listDirectory, listIncoterms, listLocations,
  shipmentActors, shipmentTotals,
} from '@/data/fretref'
import type {
  ActorLinks, DirectoryEntry, Incoterm, ResolvedActor, ShipmentActors,
  ShipmentTotals, TransportLocation,
} from '@/data/fretref'

/**
 * Les intervenants d'une cargaison.
 *
 * La règle tenue par la base et rendue visible ici : le répertoire d'abord,
 * le texte ensuite. La migration n'a converti AUCUNE cargaison existante,
 * volontairement. Rapprocher automatiquement « Ningbo Sunrise CO » d'une
 * fiche approchante ferait perdre la seule trace de ce qui était vraiment
 * écrit sur la facture, et se tromperait en silence une fois sur dix.
 *
 * L'écran dit donc toujours d'où vient le nom : « fiche du répertoire » ou
 * « saisi à la main ». Le second n'est pas une erreur, c'est un état, et
 * l'agence le range quand elle veut.
 */
export function ActorsCard({ shipmentId }: { shipmentId: string }) {
  const v = useVisible()
  const { t, formatNumber } = useI18n()
  const [actors, setActors] = useState<ShipmentActors | null>(null)
  const [totals, setTotals] = useState<ShipmentTotals | null>(null)
  const [linking, setLinking] = useState(false)

  const reload = useCallback(() => {
    shipmentActors(shipmentId).then(setActors).catch(() => setActors(null))
    shipmentTotals(shipmentId).then(setTotals).catch(() => setTotals(null))
  }, [shipmentId])

  useEffect(() => { reload() }, [reload])

  const writable = v.can('shipment:write')

  return (
    <>
      <Card
        title={t('ref.actors')}
        action={writable ? (
          <Button size="sm" icon="edit" onClick={() => setLinking(true)}>{t('ref.link')}</Button>
        ) : undefined}
      >
        <div className="col gap-4">
          <ActorRow label={t('ref.supplier')} actor={actors?.supplier} />
          <ActorRow label={t('ref.consignee')} actor={actors?.consignee} />
          <ActorRow label={t('ref.shipper')} actor={actors?.shipper} />
          <ActorRow label={t('ref.carrier')} actor={actors?.carrier} />
          <ActorRow label={t('ref.broker')} actor={actors?.broker} />
          <ActorRow label={t('ref.handler')} actor={actors?.handler} />
          <hr className="divider" style={{ margin: 0 }} />
          <ActorRow label={t('ref.originPlace')} actor={actors?.origin} />
          <ActorRow label={t('ref.destPlace')} actor={actors?.dest} />

          {actors?.incoterm && (
            <div className="col gap-1">
              <div className="row-between">
                <span className="t-small t-secondary">{t('ref.incoterm')}</span>
                <span className="row gap-2">
                  <span className="t-small t-mono t-medium">{actors.incoterm.code}</span>
                  {actors.incoterm.coherent
                    ? null
                    // Une règle maritime sur un vol ou un camion n'a pas de
                    // sens : il n'y a pas de navire, donc pas de point de
                    // transfert. On le dit sans bloquer la saisie.
                    : <Pill tone="orange">{t('ref.incoherent')}</Pill>}
                </span>
              </div>
              {actors.incoterm.transfer_point_fr && (
                <span className="t-caption t-tertiary">
                  {t('ref.transferPoint')} · {actors.incoterm.transfer_point_fr}
                </span>
              )}
            </div>
          )}
        </div>
      </Card>

      {totals && (
        <Card title={t('ref.totals')}>
          <div className="col gap-4">
            <Line label={t('ref.totalContainers')} value={formatNumber(totals.containers)} />
            <Line label={t('ref.totalPackages')} value={formatNumber(totals.packages)} />
            <Line
              label={t('ref.gross')}
              value={totals.gross_weight_kg != null ? `${formatNumber(totals.gross_weight_kg)} kg` : undefined}
            />
            <Line
              label={t('ref.volume')}
              value={totals.volume_cbm != null ? `${totals.volume_cbm} m³` : undefined}
            />
            <Line
              label={t('ref.chargeableUnits')}
              value={totals.chargeable_units != null ? formatNumber(totals.chargeable_units) : undefined}
            />
            {totals.values.map((val) => (
              <Line key={val.currency} label={`${t('ref.declaredValue')} ${val.currency}`}
                    value={formatNumber(val.amount)} />
            ))}
            {totals.dangerous_goods && (
              <p className="t-caption t-orange">
                <Icon name="alert" size={13} /> {t('ref.dangerousFlag')}
              </p>
            )}
            {/* Un total sans sa provenance n'est pas contestable, donc pas
                corrigeable. On dit d'où vient le poids, à chaque fois. */}
            {totals.weight_source && (
              <p className="t-caption t-tertiary">
                {t('ref.source')} · {t(`ref.src.${totals.weight_source}` as 'ref.src.colis')}
                {' · '}{t('ref.sourceHint')}
              </p>
            )}
          </div>
        </Card>
      )}

      {linking && (
        <LinkEditor
          shipmentId={shipmentId}
          onClose={() => setLinking(false)}
          onSaved={() => { setLinking(false); reload() }}
        />
      )}
    </>
  )
}

function ActorRow({ label, actor }: { label: string; actor?: ResolvedActor | null }) {
  const { t } = useI18n()
  if (!actor) {
    return (
      <div className="row-between">
        <span className="t-small t-secondary">{label}</span>
        <span className="t-small t-tertiary">{t('ref.notSet')}</span>
      </div>
    )
  }
  const fromText = actor.source === 'texte'
  return (
    <div className="col gap-1">
      <div className="row-between">
        <span className="t-small t-secondary">{label}</span>
        <span className="t-small" style={{ textAlign: 'end' }}>{actor.name}</span>
      </div>
      <div className="row-between">
        <span className="t-caption t-tertiary">
          {fromText ? t('ref.fromText') : t('ref.fromDirectory')}
        </span>
        <span className="t-caption t-tertiary">
          {[actor.code, actor.contact, actor.phone, actor.customs_code, actor.scac_code]
            .filter(Boolean).join(' · ')}
        </span>
      </div>
    </div>
  )
}

function Line({ label, value }: { label: string; value?: string }) {
  return (
    <div className="row-between">
      <span className="t-small t-secondary">{label}</span>
      <span className="t-small t-num">{value ?? '·'}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function LinkEditor({ shipmentId, onClose, onSaved }: {
  shipmentId: string
  onClose: () => void
  onSaved: () => void
}) {
  const { db } = useStore()
  const { t } = useI18n()
  const toast = useToast()
  const [links, setLinks] = useState<ActorLinks>({})
  const [suppliers, setSuppliers] = useState<DirectoryEntry[]>([])
  const [consignees, setConsignees] = useState<DirectoryEntry[]>([])
  const [shippers, setShippers] = useState<DirectoryEntry[]>([])
  const [carriers, setCarriers] = useState<DirectoryEntry[]>([])
  const [brokers, setBrokers] = useState<DirectoryEntry[]>([])
  const [places, setPlaces] = useState<TransportLocation[]>([])
  const [incoterms, setIncoterms] = useState<Incoterm[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const agencyId = db.agency.id

  useEffect(() => {
    listDirectory('suppliers', agencyId).then(setSuppliers).catch(() => setSuppliers([]))
    listDirectory('consignees', agencyId).then(setConsignees).catch(() => setConsignees([]))
    listDirectory('shippers', agencyId).then(setShippers).catch(() => setShippers([]))
    listDirectory('carriers', agencyId).then(setCarriers).catch(() => setCarriers([]))
    listDirectory('customs_brokers', agencyId).then(setBrokers).catch(() => setBrokers([]))
    listLocations().then(setPlaces).catch(() => setPlaces([]))
    listIncoterms().then(setIncoterms).catch(() => setIncoterms([]))
  }, [agencyId])

  const opts = (list: DirectoryEntry[]) =>
    list.map((e) => ({ value: e.id ?? '', label: entryLabel(e), hint: e.country ?? undefined }))

  const placeOpts = useMemo(() => places.map((p) => ({
    value: p.id,
    // Le code seul est illisible pour l'agent, le libellé seul ne rapproche
    // pas deux sources. On montre les deux, et le code manquant se voit.
    label: p.code ? `${p.name} (${p.code})` : p.name,
    hint: p.countryCode,
  })), [places])

  const incotermOpts = useMemo(() => incoterms.map((i) => ({
    value: i.code,
    label: `${i.code} · ${i.nameFr}`,
    hint: i.mode === 'maritime' ? 'maritime' : undefined,
  })), [incoterms])

  const set = (k: keyof ActorLinks, val: string) =>
    setLinks((l) => ({ ...l, [k]: val || null }))

  const save = async () => {
    setBusy(true); setError(null)
    try {
      await linkShipmentActors(shipmentId, links)
      toast(t('ref.linked'))
      onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false) }
  }

  return (
    <Modal
      title={t('ref.chooseInDirectory')}
      onClose={onClose}
      wide
      footer={
        <div className="row gap-2">
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="primary" icon="save" disabled={busy} onClick={save}>{t('action.save')}</Button>
        </div>
      }
    >
      <div className="col gap-4">
        {/* Rattacher n'efface rien. Les colonnes texte de la cargaison restent
            telles quelles : c'est la seule trace de ce qui était écrit sur la
            facture le jour de la saisie. */}
        <p className="t-caption t-tertiary">{t('ref.textKept')}</p>

        <Field label={t('ref.supplier')}>
          <Combobox value={links.supplierId ?? ''} options={opts(suppliers)}
                    emptyLabel={t('ref.none')} onChange={(x) => set('supplierId', x)} />
        </Field>
        <Field label={t('ref.consignee')}>
          <Combobox value={links.consigneeId ?? ''} options={opts(consignees)}
                    emptyLabel={t('ref.none')} onChange={(x) => set('consigneeId', x)} />
        </Field>
        <Field label={t('ref.shipper')}>
          <Combobox value={links.shipperId ?? ''} options={opts(shippers)}
                    emptyLabel={t('ref.none')} onChange={(x) => set('shipperId', x)} />
        </Field>
        <Field label={t('ref.carrier')}>
          <Combobox value={links.carrierId ?? ''} options={opts(carriers)}
                    emptyLabel={t('ref.none')} onChange={(x) => set('carrierId', x)} />
        </Field>
        <Field label={t('ref.broker')}>
          <Combobox value={links.brokerId ?? ''} options={opts(brokers)}
                    emptyLabel={t('ref.none')} onChange={(x) => set('brokerId', x)} />
        </Field>
        <Field label={t('ref.originPlace')}>
          <Combobox value={links.originLocationId ?? ''} options={placeOpts}
                    emptyLabel={t('ref.none')} onChange={(x) => set('originLocationId', x)} />
        </Field>
        <Field label={t('ref.destPlace')}>
          <Combobox value={links.destLocationId ?? ''} options={placeOpts}
                    emptyLabel={t('ref.none')} onChange={(x) => set('destLocationId', x)} />
        </Field>
        <Field label={t('ref.incoterm')}>
          <Combobox value={links.incotermCode ?? ''} options={incotermOpts}
                    emptyLabel={t('ref.none')} onChange={(x) => set('incotermCode', x)} />
        </Field>

        {error && <p className="t-small t-red" role="alert">{error}</p>}
      </div>
    </Modal>
  )
}
