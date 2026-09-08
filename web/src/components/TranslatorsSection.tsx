import { Fragment, useCallback, useEffect, useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { Button, Card, Empty, Field, Input, Modal, Pill, Select, Textarea, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import {
  archiveTranslator, loadTranslators, loadTranslatorStats, saveTranslator, TRANSLATOR_KINDS,
} from '@/data/traduction'
import type { Translator, TranslatorDraft, TranslatorKind, TranslatorStats } from '@/data/traduction'

/**
 * Le répertoire des traducteurs de l'agence.
 *
 * AUCUN TRADUCTEUR ET AUCUN TARIF NE SONT LIVRÉS. Le prix à la page se négocie
 * entre l'agence et son traducteur, il n'est publié nulle part. Une liste
 * fournie avec le produit enverrait l'agent au mauvais numéro, et une cour
 * d'appel devinée l'enverrait au mauvais guichet : la cour reste un champ
 * libre.
 *
 * Les chiffres d'un traducteur sont bruts, calculés sur les dates réellement
 * enregistrées, et chacun porte sa taille d'échantillon. Aucune note, aucun
 * score : c'est la règle du projet sur les indicateurs de personnes.
 */

const KIND_KEY: Record<TranslatorKind, string> = {
  interne: 'trad.kindInterne',
  externe: 'trad.kindExterne',
  bureau: 'trad.kindBureau',
}

export function TranslatorsSection() {
  const { db } = useStore()
  const v = useVisible()
  const { t } = useI18n()
  const toast = useToast()

  const [rows, setRows] = useState<Translator[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Translator | 'nouveau' | null>(null)
  const [opened, setOpened] = useState<string | null>(null)

  const canManage = v.can('settings:manage')

  const reload = useCallback(async () => {
    if (!HAS_BACKEND) return
    try { setRows(await loadTranslators()); setError(null) }
    catch (e) { setError((e as Error).message) }
  }, [])

  useEffect(() => { void reload() }, [reload])

  if (!HAS_BACKEND) {
    return (
      <Card title={t('trad.translators')}>
        <Empty title={t('trad.offline')} hint={t('trad.offlineHint')} scene="alerte" />
      </Card>
    )
  }

  const archive = async (id: string) => {
    try { await archiveTranslator(id); toast(t('trad.archived')); await reload() }
    catch (e) { toast((e as Error).message) }
  }

  return (
    <>
      <Card
        title={t('trad.translators')}
        action={canManage
          ? <Button variant="primary" icon="plus" onClick={() => setEditing('nouveau')}>{t('trad.newTranslator')}</Button>
          : undefined}
        flush
      >
        <p className="tariff__why">
          <Icon name="shield" size={14} />
          <span>{t('trad.noneProvided')}</span>
        </p>

        {error && <p className="t-small t-orange" style={{ padding: '0 var(--sp-6)' }}>{error}</p>}

        {rows.length === 0 ? (
          <Empty
            title={t('trad.noTranslators')}
            hint={t('trad.noTranslatorsHint')}
            scene="vide"
            action={canManage
              ? <Button variant="primary" onClick={() => setEditing('nouveau')}>{t('trad.newTranslator')}</Button>
              : undefined}
          />
        ) : (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('trad.name')}</th>
                  <th>{t('trad.kind')}</th>
                  <th>{t('trad.languages')}</th>
                  <th className="num">{t('trad.ratePerPage')}</th>
                  <th className="num">{t('trad.leadTime')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <Fragment key={x.id}>
                    <tr>
                      <td>
                        <span className="t-medium">{x.name}</span>
                        {x.sworn && <> <Pill tone="green">{t('trad.sworn')}</Pill></>}
                        {!x.active && <> <Pill tone="gray">{t('trad.inactive')}</Pill></>}
                        {x.swornCourt && <div className="t-caption t-tertiary">{x.swornCourt}</div>}
                      </td>
                      <td className="t-small">{t(KIND_KEY[x.kind] as 'trad.kindExterne')}</td>
                      <td className="t-small">{x.languages.join(', ')}</td>
                      <td className="num t-num">
                        {x.ratePerPage !== null ? `${x.ratePerPage} ${x.rateCurrency ?? db.agency.currency}` : ''}
                      </td>
                      <td className="num t-num">{x.leadTimeDays ?? ''}</td>
                      <td className="num">
                        <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--sp-2)' }}>
                          <Button size="sm" onClick={() => setOpened(opened === x.id ? null : x.id)}>
                            {t('trad.stats')}
                          </Button>
                          {canManage && (
                            <>
                              <Button size="sm" icon="edit" onClick={() => setEditing(x)}>{t('trad.editTranslator')}</Button>
                              {x.active && (
                                <Button size="sm" onClick={() => void archive(x.id)}>{t('trad.archive')}</Button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {opened === x.id && (
                      <tr>
                        <td colSpan={6}><StatsRow translatorId={x.id} /></td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <TranslatorModal
          translator={editing === 'nouveau' ? null : editing}
          currency={db.agency.currency}
          onClose={() => setEditing(null)}
          onSave={async (draft) => {
            await saveTranslator(db.agency.id, editing === 'nouveau' ? null : editing.id, draft)
            setEditing(null)
            toast(t('trad.saved'))
            await reload()
          }}
        />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Les chiffres, bruts                                                 */
/* ------------------------------------------------------------------ */

function StatsRow({ translatorId }: { translatorId: string }) {
  const { t, formatMoney } = useI18n()
  const [stats, setStats] = useState<TranslatorStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadTranslatorStats(translatorId).then(setStats).catch((e: Error) => setError(e.message))
  }, [translatorId])

  if (error) return <p className="t-small t-orange">{error}</p>
  if (!stats) return <p className="t-small t-tertiary">{t('trad.noFigure')}</p>

  return (
    <div className="col gap-3" style={{ padding: 'var(--sp-3) 0' }}>
      <div className="row" style={{ gap: 'var(--sp-6)', flexWrap: 'wrap' }}>
        <Figure label={t('trad.statOrders')} value={String(stats.orders)} />
        <Figure label={t('trad.statDelivered')} value={String(stats.delivered)} />
        <Figure
          label={t('trad.statAvgDays')}
          value={stats.avgDays !== null ? t('trad.days', { n: stats.avgDays }) : t('trad.noFigure')}
          hint={stats.avgDaysOn > 0 ? t('trad.measuredOn', { n: stats.avgDaysOn }) : undefined}
        />
        <Figure
          label={t('trad.statLateRate')}
          value={stats.lateRate !== null ? `${stats.late} · ${stats.lateRate} %` : t('trad.noFigure')}
          hint={stats.lateOn > 0 ? t('trad.measuredOn', { n: stats.lateOn }) : t('trad.noPromise')}
        />
        {stats.avgMargin !== null && (
          <Figure
            label={t('trad.statAvgMargin')}
            value={formatMoney(stats.avgMargin, stats.currency ?? undefined)}
            hint={t('trad.measuredOn', { n: stats.avgMarginOn })}
          />
        )}
      </div>
      <p className="tariff__why">
        <Icon name="shield" size={14} />
        <span>{t('trad.statsHint')}</span>
      </p>
    </div>
  )
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <span className="col">
      <span className="t-caption t-tertiary">{label}</span>
      <span className="t-medium t-num">{value}</span>
      {hint && <span className="t-caption t-tertiary">{hint}</span>}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* La fiche d'un traducteur                                            */
/* ------------------------------------------------------------------ */

function TranslatorModal({ translator, currency, onClose, onSave }: {
  translator: Translator | null
  currency: string
  onClose: () => void
  onSave: (draft: TranslatorDraft) => Promise<void>
}) {
  const { t } = useI18n()
  const toast = useToast()

  const [name, setName] = useState(translator?.name ?? '')
  const [kind, setKind] = useState<TranslatorKind>(translator?.kind ?? 'externe')
  const [sworn, setSworn] = useState(translator?.sworn ?? false)
  const [court, setCourt] = useState(translator?.swornCourt ?? '')
  const [languages, setLanguages] = useState((translator?.languages ?? []).join('\n'))
  const [phone, setPhone] = useState(translator?.phone ?? '')
  const [email, setEmail] = useState(translator?.email ?? '')
  const [address, setAddress] = useState(translator?.address ?? '')
  const [rate, setRate] = useState(translator?.ratePerPage != null ? String(translator.ratePerPage) : '')
  const [lead, setLead] = useState(translator?.leadTimeDays != null ? String(translator.leadTimeDays) : '')
  const [active, setActive] = useState(translator?.active ?? true)
  const [note, setNote] = useState(translator?.note ?? '')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      await onSave({
        name: name.trim(),
        kind,
        sworn,
        swornCourt: court.trim() || null,
        // Un couple par ligne, forme « fr>ar ». La base vérifie la forme :
        // une saisie libre finirait en couples que personne ne peut filtrer.
        languages: languages.split('\n').map((s) => s.trim()).filter(Boolean),
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        ratePerPage: rate ? Number(rate) : null,
        rateCurrency: rate ? (translator?.rateCurrency ?? currency) : null,
        leadTimeDays: lead ? Number(lead) : null,
        active,
        note: note.trim() || null,
      })
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={translator ? t('trad.editTranslator') : t('trad.newTranslator')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('trad.cancel')}</Button>
          <Button variant="primary" disabled={busy || !name.trim()} onClick={() => void submit()}>
            {t('trad.save')}
          </Button>
        </>
      }
    >
      <div className="col gap-4">
        <Field label={t('trad.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>

        <Field label={t('trad.kind')}>
          <Select value={kind} onChange={(e) => setKind(e.target.value as TranslatorKind)}>
            {TRANSLATOR_KINDS.map((k) => (
              <option key={k} value={k}>{t(KIND_KEY[k] as 'trad.kindExterne')}</option>
            ))}
          </Select>
        </Field>

        <Field label={t('trad.sworn')} hint={t('trad.swornHint')}>
          <Select value={sworn ? 'oui' : 'non'} onChange={(e) => setSworn(e.target.value === 'oui')}>
            <option value="non">{t('trad.none')}</option>
            <option value="oui">{t('trad.sworn')}</option>
          </Select>
        </Field>

        {sworn && (
          <Field label={t('trad.swornCourt')} hint={t('trad.swornCourtHint')}>
            <Input value={court} onChange={(e) => setCourt(e.target.value)} />
          </Field>
        )}

        <Field label={t('trad.languages')} hint={t('trad.languagesHint')}>
          <Textarea rows={3} value={languages} onChange={(e) => setLanguages(e.target.value)} />
        </Field>

        <div className="row gap-3">
          <Field label={t('trad.phone')}>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label={t('trad.email')}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>

        <Field label={t('trad.address')}>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>

        <div className="row gap-3">
          <Field label={`${t('trad.ratePerPage')} (${translator?.rateCurrency ?? currency})`} hint={t('trad.rateHint')}>
            <Input type="number" min={0} step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
          </Field>
          <Field label={t('trad.leadTime')} hint={t('trad.leadTimeHint')}>
            <Input type="number" min={0} value={lead} onChange={(e) => setLead(e.target.value)} />
          </Field>
        </div>

        <Field label={t('trad.active')}>
          <Select value={active ? 'oui' : 'non'} onChange={(e) => setActive(e.target.value === 'oui')}>
            <option value="oui">{t('trad.active')}</option>
            <option value="non">{t('trad.inactive')}</option>
          </Select>
        </Field>

        <Field label={t('trad.note')}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
