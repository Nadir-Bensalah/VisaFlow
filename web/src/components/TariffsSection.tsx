import { useMemo, useState } from 'react'
import { useStore } from '@/data/store'
import { useI18n } from '@/i18n'
import { Button, Card, Empty, Field, Input, Modal, Pill, Select, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import type { ContainerType, CounterKind, DemurrageTariff, DemurrageTier } from '@/data/types'

/**
 * Les barèmes de stationnement, saisis par l'agence.
 *
 * Aucun tarif n'est livré avec le produit, et c'est délibéré : les barèmes
 * tunisiens ne sont pas publics. Le site de la STAM renvoie une erreur de base
 * de données, l'arrêté portuaire du 18 juillet 2017 est un PDF scanné, et les
 * pages tarifaires de CMA CGM, Maersk et Hapag-Lloyd Tunisie renvoient 403.
 * Livrer un chiffre inventé ferait facturer faux, au dinar près, tous les jours.
 *
 * Ce que le produit apporte, ce sont les RÈGLES : trois compteurs distincts,
 * des paliers progressifs, une majoration de congestion, et un historique de
 * validité pour qu'un dépassement déjà couru reste calculable au tarif qui
 * était en vigueur ce jour-là.
 */

const KINDS: CounterKind[] = ['surestaries', 'detention', 'magasinage']
const TYPES: ContainerType[] = ['20', '40', '40HC', '45HC', 'LCL']

const today = () => new Date().toISOString().slice(0, 10)

export function TariffsSection() {
  const { db } = useStore()
  const { t, formatMoney, formatDate } = useI18n()
  const [editing, setEditing] = useState<DemurrageTariff | 'nouveau' | null>(null)

  const rows = useMemo(
    () => [...db.tariffs].sort((a, b) =>
      a.port.localeCompare(b.port) || a.kind.localeCompare(b.kind) ||
      a.containerType.localeCompare(b.containerType) || b.validFrom.localeCompare(a.validFrom),
    ),
    [db.tariffs],
  )

  return (
    <>
      <Card
        title={t('tariff.title')}
        action={<Button variant="primary" icon="plus" onClick={() => setEditing('nouveau')}>{t('tariff.new')}</Button>}
        flush
      >
        <p className="tariff__why">
          <Icon name="shield" size={14} />
          <span>{t('tariff.why')}</span>
        </p>

        {rows.length === 0 ? (
          <Empty
            title={t('tariff.none')}
            hint={t('tariff.noneHint')}
            scene="alerte"
            action={<Button variant="primary" icon="plus" onClick={() => setEditing('nouveau')}>{t('tariff.new')}</Button>}
          />
        ) : (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('tariff.kind')}</th>
                  <th>{t('tariff.port')}</th>
                  <th>{t('tariff.container')}</th>
                  <th>{t('tariff.billedBy')}</th>
                  <th className="num">{t('tariff.freeDays')}</th>
                  <th>{t('tariff.tiers')}</th>
                  <th>{t('tariff.validity')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((tar) => {
                  const closed = !!tar.validTo && tar.validTo < today()
                  return (
                    <tr key={tar.id} style={closed ? { opacity: 0.55 } : undefined}>
                      <td className="t-small t-medium">{t(`fret.${tar.kind}` as 'fret.surestaries')}</td>
                      <td className="t-small">{tar.port}</td>
                      <td className="t-caption t-mono">{tar.containerType}</td>
                      <td className="t-small">{tar.billedBy}</td>
                      <td className="num t-small">{tar.freeDays}</td>
                      <td className="t-caption t-tertiary">
                        {tar.tiers.map((x, i) => (
                          <span key={i}>
                            {i > 0 ? ' · ' : ''}
                            {t('tariff.tierLine', {
                              from: x.fromDay,
                              to: x.toDay ?? '∞',
                              rate: formatMoney(x.rate),
                            })}
                          </span>
                        ))}
                        {tar.surchargePct > 0 && (
                          <> · <span className="t-orange">{t('tariff.surcharge', { n: tar.surchargePct })}</span></>
                        )}
                      </td>
                      <td className="t-caption t-tertiary">
                        {formatDate(tar.validFrom)}{tar.validTo ? ` → ${formatDate(tar.validTo)}` : ' →'}
                        {closed && <> <Pill tone="gray">{t('tariff.closed')}</Pill></>}
                      </td>
                      <td>
                        <Button icon="edit" onClick={() => setEditing(tar)}>{t('crud.edit')}</Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <TariffEditor
          tariff={editing === 'nouveau' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

function TariffEditor({ tariff, onClose }: { tariff: DemurrageTariff | null; onClose: () => void }) {
  const { actions } = useStore()
  const { t } = useI18n()
  const toast = useToast()

  const [kind, setKind] = useState<CounterKind>(tariff?.kind ?? 'surestaries')
  const [billedBy, setBilledBy] = useState(tariff?.billedBy ?? '')
  const [port, setPort] = useState(tariff?.port ?? '')
  const [containerType, setContainerType] = useState<ContainerType>(tariff?.containerType ?? '40')
  const [freeDays, setFreeDays] = useState(String(tariff?.freeDays ?? 5))
  const [currency, setCurrency] = useState(tariff?.currency ?? 'TND')
  const [surcharge, setSurcharge] = useState(String(tariff?.surchargePct ?? 0))
  const [validFrom, setValidFrom] = useState(tariff?.validFrom ?? today())
  const [tiers, setTiers] = useState<DemurrageTier[]>(
    tariff?.tiers?.length ? tariff.tiers : [{ fromDay: 1, toDay: null, rate: 0 }],
  )

  const setTier = (i: number, patch: Partial<DemurrageTier>) =>
    setTiers((prev) => prev.map((x, k) => (k === i ? { ...x, ...patch } : x)))

  const valid = port.trim() !== '' && billedBy.trim() !== '' && tiers.every((x) => x.rate > 0)

  const submit = () => {
    actions.saveTariff({
      ...(tariff ? { id: tariff.id } : {}),
      kind, billedBy: billedBy.trim(), port: port.trim(), containerType,
      freeDays: Math.max(0, Number(freeDays) || 0),
      currency, tiers,
      surchargePct: Math.max(0, Number(surcharge) || 0),
      validFrom,
      validTo: tariff?.validTo,
    })
    toast(t('crud.updated'))
    onClose()
  }

  return (
    <Modal
      title={tariff ? t('tariff.edit') : t('tariff.new')}
      onClose={onClose}
      wide
      footer={
        <>
          {tariff && (
            <Button
              icon="lock"
              onClick={() => { actions.closeTariff(tariff.id); toast(t('tariff.closedDone')); onClose() }}
            >
              {t('tariff.close')}
            </Button>
          )}
          <span className="grow" />
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="primary" disabled={!valid} onClick={submit}>{t('action.confirm')}</Button>
        </>
      }
    >
      <div className="col gap-4">
        <div className="grid grid--2">
          <Field label={t('tariff.kind')} hint={t(`fret.${kind}Hint` as 'fret.surestariesHint')}>
            <Select value={kind} onChange={(e) => setKind(e.target.value as CounterKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>{t(`fret.${k}` as 'fret.surestaries')}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('tariff.billedBy')} hint={t('tariff.billedByHint')}>
            <Input value={billedBy} onChange={(e) => setBilledBy(e.target.value)} placeholder={kind === 'magasinage' ? 'STAM' : 'CMA CGM'} />
          </Field>
          <Field label={t('tariff.port')}>
            <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="Radès" />
          </Field>
          <Field label={t('tariff.container')}>
            <Select value={containerType} onChange={(e) => setContainerType(e.target.value as ContainerType)}>
              {TYPES.map((x) => <option key={x} value={x}>{x}</option>)}
            </Select>
          </Field>
          <Field label={t('tariff.freeDays')} hint={t('tariff.freeDaysHint')}>
            <Input type="number" min={0} value={freeDays} onChange={(e) => setFreeDays(e.target.value)} />
          </Field>
          <Field label={t('tariff.surcharge2')} hint={t('tariff.surchargeHint')}>
            <Input type="number" min={0} value={surcharge} onChange={(e) => setSurcharge(e.target.value)} />
          </Field>
          <Field label={t('tariff.validFrom')} hint={t('tariff.validFromHint')}>
            <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </Field>
          <Field label={t('tariff.currency')}>
            <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} />
          </Field>
        </div>

        {/* Les paliers : le tarif journalier n'est pas constant, il monte à
            partir du 3e ou 4e jour de dépassement. Les jours se comptent APRÈS
            les jours francs. */}
        <div className="col gap-3">
          <div className="row-between">
            <span className="t-small t-medium">{t('tariff.tiers')}</span>
            <span className="t-caption t-tertiary">{t('tariff.tiersHint')}</span>
          </div>
          {tiers.map((x, i) => (
            <div key={i} className="row gap-2" style={{ alignItems: 'flex-end' }}>
              <Field label={t('tariff.fromDay')}>
                <Input type="number" min={1} value={x.fromDay}
                  onChange={(e) => setTier(i, { fromDay: Math.max(1, Number(e.target.value) || 1) })} />
              </Field>
              <Field label={t('tariff.toDay')} hint={t('tariff.toDayHint')}>
                <Input type="number" min={1} value={x.toDay ?? ''}
                  onChange={(e) => setTier(i, { toDay: e.target.value === '' ? null : Number(e.target.value) })} />
              </Field>
              <Field label={t('tariff.rate')}>
                <Input type="number" min={0} step="0.01" value={x.rate}
                  onChange={(e) => setTier(i, { rate: Number(e.target.value) || 0 })} />
              </Field>
              {tiers.length > 1 && (
                <Button icon="trash" onClick={() => setTiers((prev) => prev.filter((_, k) => k !== i))}>
                  {t('crud.remove')}
                </Button>
              )}
            </div>
          ))}
          <div>
            <Button
              icon="plus"
              onClick={() => setTiers((prev) => [
                ...prev,
                { fromDay: (prev[prev.length - 1]?.toDay ?? prev.length) + 1, toDay: null, rate: 0 },
              ])}
            >
              {t('tariff.addTier')}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
