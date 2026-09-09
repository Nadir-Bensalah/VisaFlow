import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import {
  Button, Card, Combobox, Field, Input, Modal, Segmented, Select, useToast,
} from '@/components/ui'
import { Vide } from '@/components/page'
import { Icon } from '@/components/Icon'
import {
  PACKAGE_TYPES, archiveCargoLine, listGoods, listHsChapters, listPackages,
  saveGoods, savePackage,
} from '@/data/fretref'
import type { CargoGoods, CargoPackage, HsChapter, PackageType } from '@/data/fretref'

/**
 * Les marchandises et les colis d'une cargaison.
 *
 * Deux tables, une seule carte, parce que c'est une seule question dans la
 * tête de l'agent : « qu'y a-t-il dans ce conteneur ? ». Les marchandises
 * disent la nature et la valeur, les colis disent l'encombrement. Les deux
 * servent, et à des interlocuteurs différents : la douane lit les premières,
 * le groupeur facture sur les seconds.
 *
 * Le code SH se choisit PAR CHAPITRE, et pas autrement. La base ne porte que
 * les 99 chapitres du système harmonisé, parce que les positions à six ou dix
 * chiffres se comptent par milliers et qu'en inventer une seule ferait
 * déclarer faux. L'agent choisit le chapitre dans la liste, puis complète les
 * chiffres qu'il lit sur la facture du fournisseur.
 */
export function GoodsCard({ shipmentId }: { shipmentId: string }) {
  const { db } = useStore()
  const v = useVisible()
  const { t, formatNumber } = useI18n()
  const toast = useToast()
  const [tab, setTab] = useState<'goods' | 'packages'>('goods')
  const [goods, setGoods] = useState<CargoGoods[]>([])
  const [packs, setPacks] = useState<CargoPackage[]>([])
  const [chapters, setChapters] = useState<HsChapter[]>([])
  const [editGoods, setEditGoods] = useState<CargoGoods | null>(null)
  const [editPack, setEditPack] = useState<CargoPackage | null>(null)

  const reload = useCallback(() => {
    listGoods(shipmentId).then(setGoods).catch(() => setGoods([]))
    listPackages(shipmentId).then(setPacks).catch(() => setPacks([]))
  }, [shipmentId])

  useEffect(() => { reload() }, [reload])
  useEffect(() => { listHsChapters().then(setChapters).catch(() => setChapters([])) }, [])

  const writable = v.can('shipment:write')
  const totalPacks = packs.reduce((s, p) => s + (p.quantity ?? 0), 0)
  const totalCbm = packs.reduce((s, p) => s + (p.volumeCbm ?? 0), 0)

  return (
    <>
      <Card
        title={t('ref.goods')}
        action={
          <div className="row gap-2">
            <Segmented
              value={tab}
              onChange={setTab}
              label={t('ref.goods')}
              options={[
                { value: 'goods', label: `${t('ref.goods')} ${goods.length}` },
                { value: 'packages', label: `${t('ref.packages')} ${totalPacks}` },
              ]}
            />
            {writable && tab === 'goods' && (
              <Button size="sm" icon="plus" onClick={() => setEditGoods({
                shipmentId, description: '', currency: 'USD', dangerousGoods: false,
              })}>{t('ref.addGoods')}</Button>
            )}
            {writable && tab === 'packages' && (
              <Button size="sm" icon="plus" onClick={() => setEditPack({
                shipmentId, packageType: 'CARTON', quantity: 1,
              })}>{t('ref.addPackage')}</Button>
            )}
          </div>
        }
        flush
      >
        {tab === 'goods' ? (
          goods.length === 0 ? (
            <Vide icon="box" title={t('fcargo.noGoods')} hint={t('ref.chapterHint')} />
          ) : (
            <div className="tablewrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('ref.description')}</th>
                    <th>{t('ref.hsCode')}</th>
                    <th className="col-optional">{t('ref.origin')}</th>
                    <th className="num">{t('ref.quantity')}</th>
                    <th className="num">{t('ref.totalValue')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {goods.map((g) => (
                    <tr key={g.id}>
                      <td>
                        <span className="col">
                          <span className="t-small t-medium">{g.description}</span>
                          {g.dangerousGoods && (
                            // Le numéro ONU commande l'emballage, l'étiquetage,
                            // et parfois le refus de l'armateur. Le savoir au
                            // dépôt, pas au quai.
                            <span className="t-caption t-orange">
                              <Icon name="alert" size={12} /> {g.unNumber ?? t('ref.dangerous')}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="t-small t-mono">{g.hsCode ?? '·'}</td>
                      <td className="t-small col-optional">{g.originCountry ?? '·'}</td>
                      <td className="num t-small">
                        {g.quantity != null ? `${formatNumber(g.quantity)} ${g.unit ?? ''}` : '·'}
                      </td>
                      <td className="num t-small">
                        {g.totalValue != null ? `${formatNumber(g.totalValue)} ${g.currency}` : '·'}
                      </td>
                      <td className="num">
                        {writable && <Button size="sm" icon="edit" onClick={() => setEditGoods(g)}>{t('crud.edit')}</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : packs.length === 0 ? (
          <Vide icon="box" title={t('fcargo.noPackage')} hint={t('ref.computedHint')} />
        ) : (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('ref.packageType')}</th>
                  <th className="col-optional">{t('ref.packageNumber')}</th>
                  <th className="num">{t('ref.quantity')}</th>
                  <th className="col-optional">{t('ref.dims')}</th>
                  <th className="num">{t('ref.computedVolume')}</th>
                  <th className="num col-optional">{t('ref.gross')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {packs.map((p) => (
                  <tr key={p.id}>
                    <td className="t-small t-medium">{t(`ref.p.${p.packageType}` as 'ref.p.CARTON')}</td>
                    <td className="t-small t-mono col-optional">{p.packageNumber ?? '·'}</td>
                    <td className="num t-small">{p.quantity}</td>
                    <td className="t-small t-tertiary col-optional">
                      {p.lengthCm && p.widthCm && p.heightCm ? `${p.lengthCm} × ${p.widthCm} × ${p.heightCm}` : '·'}
                    </td>
                    <td className="num t-small">{p.volumeCbm != null ? `${p.volumeCbm} m³` : '·'}</td>
                    <td className="num t-small col-optional">
                      {p.grossWeightKg != null ? `${formatNumber(p.grossWeightKg)} kg` : '·'}
                    </td>
                    <td className="num">
                      {writable && <Button size="sm" icon="edit" onClick={() => setEditPack(p)}>{t('crud.edit')}</Button>}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={4} className="t-small t-secondary">{t('ref.totalPackages')}</td>
                  <td className="num t-small t-medium">{totalCbm.toFixed(3)} m³</td>
                  <td className="col-optional" />
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editGoods && (
        <GoodsEditor
          agencyId={db.agency.id}
          chapters={chapters}
          value={editGoods}
          onClose={() => setEditGoods(null)}
          onSaved={(m) => { setEditGoods(null); toast(m); reload() }}
        />
      )}
      {editPack && (
        <PackageEditor
          agencyId={db.agency.id}
          value={editPack}
          onClose={() => setEditPack(null)}
          onSaved={(m) => { setEditPack(null); toast(m); reload() }}
        />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */

function GoodsEditor({ agencyId, chapters, value, onClose, onSaved }: {
  agencyId: string
  chapters: HsChapter[]
  value: CargoGoods
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { t, locale } = useI18n()
  const [form, setForm] = useState<CargoGoods>(value)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof CargoGoods>(k: K, v: CargoGoods[K]) => setForm((f) => ({ ...f, [k]: v }))
  const num = (raw: string): number | null => (raw.trim() === '' ? null : Number(raw))

  // Le chapitre est la partie du code qu'on connaît avec certitude. Le reste
  // se lit sur la facture, il ne se devine pas.
  const chapter = (form.hsCode ?? '').slice(0, 2)
  const options = useMemo(() => chapters.map((c) => ({
    value: c.code,
    label: `${c.code} · ${locale === 'en' ? c.descriptionEn : c.descriptionFr}`,
  })), [chapters, locale])

  const total = form.quantity != null && form.unitValue != null
    ? form.quantity * form.unitValue
    : null

  const save = async () => {
    setBusy(true); setError(null)
    try {
      await saveGoods(agencyId, form)
      onSaved(t('crud.updated'))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false) }
  }

  const archive = async () => {
    if (!form.id) return
    setBusy(true)
    try { await archiveCargoLine('shipment_goods', form.id); onSaved(t('ref.archived')) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false) }
  }

  return (
    <Modal
      title={form.id ? t('ref.goods') : t('ref.addGoods')}
      onClose={onClose}
      wide
      footer={
        <div className="row-between grow">
          {form.id
            ? <Button variant="danger" icon="trash" disabled={busy} onClick={archive}>{t('ref.archive')}</Button>
            : <span />}
          <div className="row gap-2">
            <Button onClick={onClose}>{t('action.cancel')}</Button>
            <Button variant="primary" icon="save" disabled={busy || !form.description.trim()} onClick={save}>
              {t('action.save')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="col gap-4">
        <Field label={t('ref.description')}>
          <Input value={form.description} autoFocus onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Field label={t('ref.commercialDescription')} hint={t('ref.textKept')}>
          <Input value={form.commercialDescription ?? ''} onChange={(e) => set('commercialDescription', e.target.value)} />
        </Field>

        <Field label={t('ref.chapter')} hint={t('ref.chapterHint')}>
          <Combobox
            value={chapter}
            options={options}
            placeholder={t('ref.chapter')}
            emptyLabel={t('ref.none')}
            onChange={(code) => set('hsCode', code + (form.hsCode ?? '').slice(2))}
          />
        </Field>
        <div className="row gap-3 wrap">
          <Field label={t('ref.hsCode')}>
            <Input
              className="t-mono"
              value={form.hsCode ?? ''}
              placeholder="8504"
              onChange={(e) => set('hsCode', e.target.value.replace(/[^0-9]/g, ''))}
            />
          </Field>
          <Field label={t('ref.origin')}>
            <Input
              className="t-mono"
              value={form.originCountry ?? ''}
              placeholder="CN"
              maxLength={2}
              onChange={(e) => set('originCountry', e.target.value.toUpperCase() || null)}
            />
          </Field>
        </div>

        <div className="row gap-3 wrap">
          <Field label={t('ref.quantity')}>
            <Input type="number" value={form.quantity ?? ''} onChange={(e) => set('quantity', num(e.target.value))} />
          </Field>
          <Field label={t('ref.unit')}>
            <Input value={form.unit ?? ''} placeholder="PCE" onChange={(e) => set('unit', e.target.value)} />
          </Field>
          <Field label={t('ref.unitValue')}>
            <Input type="number" value={form.unitValue ?? ''} onChange={(e) => set('unitValue', num(e.target.value))} />
          </Field>
          <Field label={t('ref.currency')}>
            <Input className="t-mono" maxLength={3} value={form.currency}
                   onChange={(e) => set('currency', e.target.value.toUpperCase())} />
          </Field>
        </div>
        {/* La valeur totale est calculée par la base. On la montre pendant la
            saisie pour que l'agent voie tout de suite un zéro de trop. */}
        {total != null && (
          <p className="t-caption t-tertiary">
            {t('ref.totalValue')} · {total.toLocaleString()} {form.currency}
          </p>
        )}

        <div className="row gap-3 wrap">
          <Field label={`${t('ref.gross')} (kg)`}>
            <Input type="number" value={form.grossWeightKg ?? ''} onChange={(e) => set('grossWeightKg', num(e.target.value))} />
          </Field>
          <Field label={`${t('ref.net')} (kg)`}>
            <Input type="number" value={form.netWeightKg ?? ''} onChange={(e) => set('netWeightKg', num(e.target.value))} />
          </Field>
        </div>

        <label className="row gap-2">
          <input
            type="checkbox"
            checked={form.dangerousGoods}
            onChange={(e) => set('dangerousGoods', e.target.checked)}
          />
          <span className="t-small">{t('ref.dangerous')}</span>
        </label>
        {form.dangerousGoods && (
          <div className="row gap-3 wrap">
            <Field label={t('ref.unNumber')}>
              <Input className="t-mono" placeholder="UN3480" value={form.unNumber ?? ''}
                     onChange={(e) => set('unNumber', e.target.value.toUpperCase() || null)} />
            </Field>
            <Field label={`${t('ref.tempMin')} (°C)`}>
              <Input type="number" value={form.temperatureMin ?? ''} onChange={(e) => set('temperatureMin', num(e.target.value))} />
            </Field>
            <Field label={`${t('ref.tempMax')} (°C)`}>
              <Input type="number" value={form.temperatureMax ?? ''} onChange={(e) => set('temperatureMax', num(e.target.value))} />
            </Field>
          </div>
        )}

        {error && <p className="t-small t-red" role="alert">{error}</p>}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */

function PackageEditor({ agencyId, value, onClose, onSaved }: {
  agencyId: string
  value: CargoPackage
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { t } = useI18n()
  const [form, setForm] = useState<CargoPackage>(value)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof CargoPackage>(k: K, v: CargoPackage[K]) => setForm((f) => ({ ...f, [k]: v }))
  const num = (raw: string): number | null => (raw.trim() === '' ? null : Number(raw))

  // Le même calcul que la colonne générée de la base, montré pendant la
  // saisie. Il n'est PAS envoyé : la base fait foi, sinon deux chiffres se
  // contredisent et la facture se conteste.
  const volume = form.lengthCm && form.widthCm && form.heightCm
    ? (form.lengthCm * form.widthCm * form.heightCm) / 1_000_000 * form.quantity
    : null

  const save = async () => {
    setBusy(true); setError(null)
    try { await savePackage(agencyId, form); onSaved(t('crud.updated')) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false) }
  }

  const archive = async () => {
    if (!form.id) return
    setBusy(true)
    try { await archiveCargoLine('packages', form.id); onSaved(t('ref.archived')) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false) }
  }

  return (
    <Modal
      title={form.id ? t('ref.packages') : t('ref.addPackage')}
      onClose={onClose}
      footer={
        <div className="row-between grow">
          {form.id
            ? <Button variant="danger" icon="trash" disabled={busy} onClick={archive}>{t('ref.archive')}</Button>
            : <span />}
          <div className="row gap-2">
            <Button onClick={onClose}>{t('action.cancel')}</Button>
            <Button variant="primary" icon="save" disabled={busy} onClick={save}>{t('action.save')}</Button>
          </div>
        </div>
      }
    >
      <div className="col gap-4">
        <div className="row gap-3 wrap">
          <Field label={t('ref.packageType')}>
            <Select value={form.packageType} onChange={(e) => set('packageType', e.target.value as PackageType)}>
              {PACKAGE_TYPES.map((k) => (
                <option key={k} value={k}>{t(`ref.p.${k}` as 'ref.p.CARTON')}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('ref.packageNumber')}>
            <Input className="t-mono" value={form.packageNumber ?? ''} onChange={(e) => set('packageNumber', e.target.value)} />
          </Field>
          <Field label={t('ref.quantity')}>
            <Input type="number" min={1} value={form.quantity}
                   onChange={(e) => set('quantity', Math.max(1, Number(e.target.value) || 1))} />
          </Field>
        </div>

        <div className="row gap-3 wrap">
          <Field label="L (cm)">
            <Input type="number" value={form.lengthCm ?? ''} onChange={(e) => set('lengthCm', num(e.target.value))} />
          </Field>
          <Field label="l (cm)">
            <Input type="number" value={form.widthCm ?? ''} onChange={(e) => set('widthCm', num(e.target.value))} />
          </Field>
          <Field label="H (cm)">
            <Input type="number" value={form.heightCm ?? ''} onChange={(e) => set('heightCm', num(e.target.value))} />
          </Field>
        </div>
        <p className="t-caption t-tertiary">
          {t('ref.computedVolume')} · {volume != null ? `${volume.toFixed(3)} m³` : '·'}
          {' · '}{t('ref.computedHint')}
        </p>

        <div className="row gap-3 wrap">
          <Field label={`${t('ref.gross')} (kg)`}>
            <Input type="number" value={form.grossWeightKg ?? ''} onChange={(e) => set('grossWeightKg', num(e.target.value))} />
          </Field>
          <Field label={`${t('ref.net')} (kg)`}>
            <Input type="number" value={form.netWeightKg ?? ''} onChange={(e) => set('netWeightKg', num(e.target.value))} />
          </Field>
        </div>

        <Field label={t('ref.description')}>
          <Input value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} />
        </Field>

        {error && <p className="t-small t-red" role="alert">{error}</p>}
      </div>
    </Modal>
  )
}
