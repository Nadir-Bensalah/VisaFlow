import { useCallback, useEffect, useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Button, Card, Empty, Field, Input, Modal, Pill, Select, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { avisConteneur } from '@/lib/conteneur'
import {
  CONTAINER_STATUSES, CONTAINER_TYPES, archiveCargoLine, listContainers, saveContainer,
} from '@/data/fretref'
import type { CargoContainer, ContainerStatus, ContainerType } from '@/data/fretref'

/**
 * Les conteneurs d'une cargaison.
 *
 * Le cœur de cette carte n'est pas le tableau : c'est la vérification du
 * numéro À LA FRAPPE. Un numéro mal saisi ne fait rien planter, il fait
 * PERDRE le conteneur : la recherche chez l'armateur ne rend rien, le
 * terminal ne trouve pas la boîte, et trois semaines plus tard personne ne
 * relie la panne à la lettre échangée. La norme ISO 6346 a prévu ce cas avec
 * une clé de contrôle ; on la calcule pendant que l'agent tape.
 *
 * On distingue « pas encore fini » de « faux ». Dire « numéro invalide » à la
 * troisième lettre est le meilleur moyen d'apprendre à ignorer le message.
 */
export function ContainersCard({ shipmentId }: { shipmentId: string }) {
  const { db } = useStore()
  const v = useVisible()
  const { t, formatNumber, formatDate } = useI18n()
  const toast = useToast()
  const [rows, setRows] = useState<CargoContainer[]>([])
  const [editing, setEditing] = useState<CargoContainer | null>(null)

  const reload = useCallback(() => {
    listContainers(shipmentId).then(setRows).catch(() => setRows([]))
  }, [shipmentId])

  useEffect(() => { reload() }, [reload])

  const writable = v.can('shipment:write')

  return (
    <>
      <Card
        title={t('ref.containers')}
        action={writable ? (
          <Button
            size="sm"
            icon="plus"
            onClick={() => setEditing({
              shipmentId, containerNumber: '', containerType: '40GP', status: 'vide',
            })}
          >
            {t('ref.addContainer')}
          </Button>
        ) : undefined}
        flush={rows.length > 0}
      >
        {rows.length === 0 ? (
          <Empty title={t('ref.noContainer')} hint={t('ref.keyHint')} scene="aucune" />
        ) : (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('ref.containerNumber')}</th>
                  <th>{t('ref.containerType')}</th>
                  <th className="col-optional">{t('ref.seal')}</th>
                  <th className="num">{t('ref.gross')}</th>
                  <th className="num col-optional">{t('ref.volume')}</th>
                  <th>{t('ref.status')}</th>
                  <th className="col-optional">{t('ref.gateOut')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td className="t-mono t-medium">{c.containerNumber}</td>
                    <td className="t-small">{c.containerType}</td>
                    <td className="t-small t-mono col-optional">{c.sealNumber ?? '·'}</td>
                    <td className="num t-small">
                      {c.grossWeightKg != null ? `${formatNumber(c.grossWeightKg)} kg` : '·'}
                    </td>
                    <td className="num t-small col-optional">
                      {c.volumeCbm != null ? `${c.volumeCbm} m³` : '·'}
                    </td>
                    <td>
                      <Pill tone={c.status === 'livre' || c.status === 'restitue' ? 'green' : 'gray'}>
                        {t(`ref.s.${c.status}` as 'ref.s.vide')}
                      </Pill>
                    </td>
                    <td className="t-small t-tertiary col-optional">
                      {c.gateOutAt ? formatDate(c.gateOutAt) : '·'}
                    </td>
                    <td className="num">
                      {writable && (
                        <Button size="sm" icon="edit" onClick={() => setEditing(c)}>
                          {t('crud.edit')}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <ContainerEditor
          agencyId={db.agency.id}
          value={editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => { setEditing(null); toast(message); reload() }}
        />
      )}
    </>
  )
}

function ContainerEditor({ agencyId, value, onClose, onSaved }: {
  agencyId: string
  value: CargoContainer
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { t } = useI18n()
  const [form, setForm] = useState<CargoContainer>(value)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const avis = avisConteneur(form.containerNumber)

  const set = <K extends keyof CargoContainer>(key: K, val: CargoContainer[K]) =>
    setForm((f) => ({ ...f, [key]: val }))

  const num = (raw: string): number | null => (raw.trim() === '' ? null : Number(raw))

  // Le message suit l'état réel de la saisie. « Il manque des caractères »
  // n'est pas une erreur, c'est une information : on ne l'affiche pas en rouge.
  const message =
    avis.probleme === 'vide' ? null
    : avis.probleme === 'forme' ? t('ref.keyForm')
    : avis.probleme === 'incomplet' ? t('ref.keyIncomplete')
    : avis.probleme === 'cle' ? t('ref.keyBad', { n: avis.cleAttendue ?? '?' })
    : t('ref.keyOk')

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await saveContainer(agencyId, { ...form, containerNumber: avis.numero })
      onSaved(t('crud.updated'))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const archive = async () => {
    if (!form.id) return
    setBusy(true)
    try {
      await archiveCargoLine('containers', form.id)
      onSaved(t('ref.archived'))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={form.id ? t('ref.containers') : t('ref.addContainer')}
      onClose={onClose}
      footer={
        <div className="row-between grow">
          {form.id
            ? <Button variant="danger" icon="trash" disabled={busy} onClick={archive}>{t('ref.archive')}</Button>
            : <span />}
          <div className="row gap-2">
            <Button onClick={onClose}>{t('action.cancel')}</Button>
            <Button variant="primary" icon="save" disabled={busy || !avis.valide} onClick={save}>
              {t('action.save')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="col gap-4">
        <Field
          label={t('ref.containerNumber')}
          hint={t('ref.keyHint')}
          error={avis.probleme === 'cle' || avis.probleme === 'forme' ? message ?? undefined : undefined}
        >
          <Input
            className="t-mono"
            value={form.containerNumber}
            placeholder="CSQU3054383"
            autoFocus
            onChange={(e) => set('containerNumber', e.target.value)}
          />
        </Field>

        {/* L'avis en clair, pendant la frappe. Le serveur refusera de toute
            façon un numéro faux : ici on évite l'aller-retour, et surtout
            l'enregistrement qu'on ne relira jamais. */}
        {avis.probleme !== 'vide' && (
          <p className={`t-caption ${avis.valide ? 't-green' : avis.probleme === 'incomplet' ? 't-tertiary' : 't-orange'}`}>
            <Icon name={avis.valide ? 'check' : 'alert'} size={13} /> {message}
          </p>
        )}
        {avis.categorieInhabituelle && (
          <p className="t-caption t-tertiary">{t('ref.categoryHint')}</p>
        )}

        <div className="row gap-3 wrap">
          <Field label={t('ref.containerType')}>
            <Select value={form.containerType} onChange={(e) => set('containerType', e.target.value as ContainerType)}>
              {CONTAINER_TYPES.map((k) => <option key={k} value={k}>{k}</option>)}
            </Select>
          </Field>
          <Field label={t('ref.status')}>
            <Select value={form.status} onChange={(e) => set('status', e.target.value as ContainerStatus)}>
              {CONTAINER_STATUSES.map((k) => (
                <option key={k} value={k}>{t(`ref.s.${k}` as 'ref.s.vide')}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('ref.seal')}>
            <Input className="t-mono" value={form.sealNumber ?? ''} onChange={(e) => set('sealNumber', e.target.value)} />
          </Field>
        </div>

        <div className="row gap-3 wrap">
          <Field label={`${t('ref.gross')} (kg)`}>
            <Input type="number" value={form.grossWeightKg ?? ''} onChange={(e) => set('grossWeightKg', num(e.target.value))} />
          </Field>
          <Field label={`${t('ref.net')} (kg)`}>
            <Input type="number" value={form.netWeightKg ?? ''} onChange={(e) => set('netWeightKg', num(e.target.value))} />
          </Field>
          {/* La tare est gravée sur la porte. Brut moins tare donne ce que la
              douane pèse : c'est le chiffre qu'on cherche au moment du litige. */}
          <Field label={`${t('ref.tare')} (kg)`}>
            <Input type="number" value={form.tareKg ?? ''} onChange={(e) => set('tareKg', num(e.target.value))} />
          </Field>
          <Field label={`${t('ref.volume')} (m³)`}>
            <Input type="number" value={form.volumeCbm ?? ''} onChange={(e) => set('volumeCbm', num(e.target.value))} />
          </Field>
        </div>

        <div className="row gap-3 wrap">
          <Field label={t('ref.gateOut')}>
            <Input
              type="date"
              value={(form.gateOutAt ?? '').slice(0, 10)}
              onChange={(e) => set('gateOutAt', e.target.value || null)}
            />
          </Field>
          <Field label={t('ref.returned')}>
            <Input
              type="date"
              value={(form.returnedAt ?? '').slice(0, 10)}
              onChange={(e) => set('returnedAt', e.target.value || null)}
            />
          </Field>
        </div>

        <Field label={t('ref.note')}>
          <Input value={form.note ?? ''} onChange={(e) => set('note', e.target.value)} />
        </Field>

        {error && <p className="t-small t-red" role="alert">{error}</p>}
      </div>
    </Modal>
  )
}
