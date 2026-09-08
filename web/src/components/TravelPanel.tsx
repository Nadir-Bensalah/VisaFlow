import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import type { Tone } from '@/lib/derive'
import { Button, Card, Combobox, Empty, Field, Input, Modal, Pill, Select, Textarea, useToast } from '@/components/ui'
import type { ComboOption } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { FileDrop } from '@/components/FileDrop'
import {
  archiveTravelService, attachTravelDocument, BOARDS, createTravelService,
  loadTravelAllowance, loadTravelMoney, loadTravelServices, TRAVEL_STATUSES,
  updateTravelService,
} from '@/data/voyage'
import type {
  Board, TravelAllowance, TravelDraft, TravelKind, TravelMoney, TravelService, TravelStatus,
} from '@/data/voyage'

/**
 * Le bloc « Voyage » d'un dossier.
 *
 * CE QUE CET ÉCRAN NE FAIT PAS, ET IL FAUT LE LIRE AVANT DE LE MODIFIER :
 * il ne réserve rien. L'agence réserve chez la compagnie, chez son
 * consolidateur ou chez son assureur, puis elle vient noter ici la référence,
 * les dates, le prix et le document. Aucun bouton ne dit « Réserver » : ce
 * serait promettre une fonction qui n'existe pas, et le client l'attendrait.
 *
 * LE PARTAGE DES CHIFFRES. Tout le monde voit ce qu'on a facturé au client.
 * Le coût et la marge, eux, ne descendent que pour `finance:global`, et pas
 * depuis la table : la base a retiré à tout le monde le droit de lire ces
 * colonnes, elles sortent par une fonction qui vérifie le droit à chaque
 * appel. Un agent note donc un billet toute la journée sans jamais voir ce que
 * l'agence gagne dessus.
 */

const SECTIONS: { key: string; kinds: TravelKind[]; title: string; add: string; empty: string }[] = [
  { key: 'billet', kinds: ['BILLET'], title: 'voy.sectionBillet', add: 'voy.addBillet', empty: 'voy.emptyBillet' },
  { key: 'hebergement', kinds: ['HEBERGEMENT'], title: 'voy.sectionHebergement', add: 'voy.addHebergement', empty: 'voy.emptyHebergement' },
  { key: 'assurance', kinds: ['ASSURANCE'], title: 'voy.sectionAssurance', add: 'voy.addAssurance', empty: 'voy.emptyAssurance' },
  { key: 'autres', kinds: ['TRANSFERT', 'TRANSPORT', 'AUTRE'], title: 'voy.sectionAutres', add: 'voy.addAutre', empty: 'voy.emptyAutres' },
]

const TONE: Record<TravelStatus, Tone> = {
  a_faire: 'gray', enregistre: 'blue', confirme: 'green', annule: 'red', rembourse: 'orange',
}

export function TravelPanel({ caseId, clientId, officeId }: {
  /* Nul sur la fiche client : on y voit alors tout ce que la personne a
     acheté, dossier de visa ou pas. Le billet sec compte aussi. */
  caseId: string | null
  clientId: string | null
  officeId: string | null
}) {
  const { db } = useStore()
  const v = useVisible()
  const { t } = useI18n()
  const toast = useToast()

  const [rows, setRows] = useState<TravelService[]>([])
  const [money, setMoney] = useState<TravelMoney[]>([])
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({ billet: true })
  const [editing, setEditing] = useState<{ kind: TravelKind; row: TravelService | null } | null>(null)

  const canWrite = v.can('payment:write')
  const canMoney = v.can('finance:global')

  const reload = useCallback(async () => {
    if (!HAS_BACKEND) return
    try {
      setRows(await loadTravelServices(
        caseId ? { caseId } : clientId ? { clientId } : {}))
      // Le coût sort par une fonction, jamais par la table : sans le droit,
      // on ne demande même pas, et l'écran reste juste.
      setMoney(canMoney && caseId ? await loadTravelMoney({ caseId }) : [])
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [caseId, clientId, canMoney])

  useEffect(() => { void reload() }, [reload])

  const byId = useMemo(() => {
    const m = new Map<string, TravelMoney>()
    for (const x of money) m.set(x.id, x)
    return m
  }, [money])

  if (!HAS_BACKEND) {
    return (
      <Card title={t('voy.travel')}>
        <Empty title={t('voy.offline')} hint={t('voy.offlineHint')} scene="alerte" />
      </Card>
    )
  }

  return (
    <>
      <Card title={t('voy.travel')} action={<span className="t-caption t-tertiary">{t('voy.travelSub')}</span>}>
        <p className="tariff__why" style={{ marginBottom: 'var(--sp-4)' }}>
          <Icon name="shield" size={14} />
          <span>{t('voy.notBooking')}</span>
        </p>

        {error && <p className="t-small t-orange">{t('voy.loadError', { msg: error })}</p>}

        <div className="col gap-3">
          {SECTIONS.map((s) => {
            const lines = rows.filter((r) => s.kinds.includes(r.kind))
            const shown = open[s.key] ?? false
            return (
              <div key={s.key} className="col gap-2" style={{ borderTop: '1px solid var(--hairline)', paddingTop: 'var(--sp-3)' }}>
                <div className="row-between">
                  <button
                    type="button"
                    className="row gap-2"
                    style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
                    aria-expanded={shown}
                    onClick={() => setOpen((o) => ({ ...o, [s.key]: !shown }))}
                  >
                    <Icon name="chevron" size={14} style={{ transform: shown ? 'rotate(90deg)' : undefined }} />
                    <span className="t-small t-medium">{t(s.title as 'voy.sectionBillet')}</span>
                    {lines.length > 0 && <span className="t-caption t-tertiary">({lines.length})</span>}
                  </button>
                  {canWrite && (
                    <Button size="sm" icon="plus" onClick={() => setEditing({ kind: s.kinds[0], row: null })}>
                      {t(s.add as 'voy.addBillet')}
                    </Button>
                  )}
                </div>

                {shown && (
                  lines.length === 0
                    ? <p className="t-small t-tertiary">{t(s.empty as 'voy.emptyBillet')}</p>
                    : (
                      <div className="col gap-3">
                        {lines.map((r) => (
                          <TravelLine
                            key={r.id}
                            row={r}
                            money={byId.get(r.id) ?? null}
                            canWrite={canWrite}
                            onEdit={() => setEditing({ kind: r.kind, row: r })}
                            onChanged={reload}
                          />
                        ))}
                      </div>
                    )
                )}
              </div>
            )
          })}
        </div>
      </Card>

      {editing && (
        <TravelEditor
          agencyId={db.agency.id}
          currency={db.agency.currency}
          caseId={caseId}
          clientId={clientId}
          officeId={officeId}
          kind={editing.kind}
          row={editing.row}
          money={editing.row ? byId.get(editing.row.id) ?? null : null}
          canMoney={canMoney}
          onClose={() => setEditing(null)}
          onDone={async () => { setEditing(null); await reload(); toast(t('voy.saved')) }}
        />
      )}
    </>
  )
}

/* Une prestation notée, telle qu'on la lit sans ouvrir la fiche. */
function TravelLine({ row, money, canWrite, onEdit, onChanged }: {
  row: TravelService
  money: TravelMoney | null
  canWrite: boolean
  onEdit: () => void
  onChanged: () => Promise<void>
}) {
  const { t, formatDate, formatMoney } = useI18n()
  const toast = useToast()

  return (
    <div className="col gap-2" style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-md)', padding: 'var(--sp-3)' }}>
      <div className="row-between wrap gap-2">
        <div className="col gap-1" style={{ minWidth: 0 }}>
          <span className="t-small t-medium">
            {row.reference || row.pnr || row.policyNumber || row.hotelName || row.carrier || t('voy.none')}
          </span>
          <span className="t-caption t-tertiary">{describe(row, formatDate)}</span>
        </div>
        <div className="row gap-2" style={{ alignItems: 'center' }}>
          <Pill tone={TONE[row.status]} dot>{t(`voy.status_${row.status}` as 'voy.status_a_faire')}</Pill>
          <span className="t-small t-medium">{formatMoney(row.soldAmount, row.currency)}</span>
          {money && (
            <span className="t-caption" style={{ color: money.margin < 0 ? 'var(--red)' : 'var(--green)' }}>
              {t('voy.margin')} {formatMoney(money.margin, money.currency)}
            </span>
          )}
          {canWrite && <Button size="sm" icon="edit" onClick={onEdit}>{t('voy.editLine')}</Button>}
          {canWrite && (
            <Button
              size="sm"
              icon="trash"
              onClick={() => void archiveTravelService(row.id).then(async () => { await onChanged(); toast(t('voy.archived')) })}
            >
              {t('voy.archive')}
            </Button>
          )}
        </div>
      </div>

      <FileDrop
        scope="prestation"
        id={row.id}
        compact
        readOnly={!canWrite}
        current={row.documentPath ? { key: row.documentPath, name: row.documentName ?? undefined } : undefined}
        onAttach={(f) => void attachTravelDocument(row.id, f.key, f.name).then(onChanged)}
        onDetach={() => void attachTravelDocument(row.id, null, null).then(onChanged)}
      />
    </div>
  )
}

/* La ligne en une phrase : ce que l'employé lit sans ouvrir la fiche. */
function describe(r: TravelService, formatDate: (iso?: string) => string): string {
  const parts: string[] = []
  if (r.kind === 'BILLET') {
    if (r.departFrom || r.departTo) parts.push(`${r.departFrom ?? '?'} → ${r.departTo ?? '?'}`)
    if (r.departAt) parts.push(formatDate(r.departAt))
    if (r.carrier) parts.push(r.carrier)
  } else if (r.kind === 'HEBERGEMENT') {
    if (r.hotelCity) parts.push(r.hotelCity)
    if (r.checkinDate) parts.push(`${formatDate(r.checkinDate)} → ${formatDate(r.checkoutDate ?? undefined)}`)
    if (r.nights) parts.push(`${r.nights}`)
  } else if (r.kind === 'ASSURANCE') {
    if (r.insurer) parts.push(r.insurer)
    if (r.coverFrom) parts.push(`${formatDate(r.coverFrom)} → ${formatDate(r.coverTo ?? undefined)}`)
  } else {
    if (r.pickupPlace || r.dropoffPlace) parts.push(`${r.pickupPlace ?? '?'} → ${r.dropoffPlace ?? '?'}`)
    if (r.supplierName) parts.push(r.supplierName)
  }
  return parts.join(' · ')
}

/* --------------------------- La saisie --------------------------- */

export function TravelEditor({
  agencyId, currency, caseId, clientId, officeId, kind, row, money, canMoney,
  clientOptions, onClose, onDone,
}: {
  agencyId: string
  currency: string
  caseId: string | null
  clientId: string | null
  officeId: string | null
  kind: TravelKind
  row: TravelService | null
  money: TravelMoney | null
  canMoney: boolean
  /* Fourni par l'écran des prestations, où l'on note un billet sec : le
     dossier de visa n'existe pas toujours, le client, lui, existe toujours. */
  clientOptions?: ComboOption[]
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useI18n()
  const [k, setK] = useState<TravelKind>(row?.kind ?? kind)
  const [who, setWho] = useState<string>(row?.clientId ?? clientId ?? '')
  const [f, setF] = useState<Record<string, string>>(() => initial(row, money, currency))
  const [warn, setWarn] = useState<TravelAllowance | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (key: string, value: string) => setF((s) => ({ ...s, [key]: value }))

  // Le rappel réglementaire vient du serveur, jamais de l'écran : c'est lui qui
  // connaît la catégorie de licence de l'agence. Il ne bloque rien.
  useEffect(() => {
    let alive = true
    void loadTravelAllowance(agencyId, k).then((a) => { if (alive) setWarn(a) }).catch(() => {})
    return () => { alive = false }
  }, [agencyId, k])

  const submit = async () => {
    // Deux inversions que la base refuse de toute façon. On les dit ici pour
    // que l'employé corrige avant d'envoyer, plutôt que de lire un message
    // de contrainte en anglais.
    if (f.departAt && f.returnAt && f.returnAt < f.departAt) { setError(t('voy.returnBeforeDepart')); return }
    if (f.checkinDate && f.checkoutDate && f.checkoutDate < f.checkinDate) { setError(t('voy.checkoutBeforeCheckin')); return }

    setBusy(true)
    try {
      const draft: TravelDraft = {
        officeId, caseId, clientId: who || null,
        kind: k,
        status: (f.status as TravelStatus) || 'a_faire',
        supplierName: f.supplierName ?? null,
        supplierId: row?.supplierId ?? null,
        serviceId: row?.serviceId ?? null,
        reference: f.reference ?? null,
        bookedAt: f.bookedAt ? new Date(f.bookedAt).toISOString() : row?.bookedAt ?? null,
        note: f.note ?? null,
        soldAmount: numOr0(f.soldAmount),
        // Un agent qui ne voit pas le coût n'en envoie pas : sans ce null, il
        // remettrait le coût à zéro en enregistrant, et la marge gonflerait.
        costAmount: canMoney ? numOr0(f.costAmount) : null,
        currency: f.currency || currency,
        fxRate: Number(f.fxRate) > 0 ? Number(f.fxRate) : 1,

        carrier: f.carrier, flightNoOut: f.flightNoOut, flightNoBack: f.flightNoBack,
        pnr: f.pnr, ticketNumber: f.ticketNumber,
        departFrom: f.departFrom, departTo: f.departTo,
        departAt: f.departAt || null, returnAt: f.returnAt || null,
        passengers: intOrNull(f.passengers), cabin: f.cabin, baggageKg: numOrNull(f.baggageKg),

        hotelName: f.hotelName, hotelCity: f.hotelCity, hotelAddress: f.hotelAddress,
        checkinDate: f.checkinDate || null, checkoutDate: f.checkoutDate || null,
        rooms: intOrNull(f.rooms), guests: intOrNull(f.guests),
        board: (f.board as Board) || null,

        insurer: f.insurer, policyNumber: f.policyNumber,
        coverageAmount: numOrNull(f.coverageAmount), coverageCurrency: f.coverageCurrency,
        coverFrom: f.coverFrom || null, coverTo: f.coverTo || null,
        coverArea: f.coverArea, assistancePhone: f.assistancePhone,

        pickupPlace: f.pickupPlace, dropoffPlace: f.dropoffPlace,
        pickupAt: f.pickupAt ? new Date(f.pickupAt).toISOString() : null,
        vehicle: f.vehicle, driverPhone: f.driverPhone,
      }
      if (row) await updateTravelService(row.id, draft)
      else await createTravelService(agencyId, draft)
      onDone()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t(`voy.kind${k}` as 'voy.kindBILLET')}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="grow" />
          <Button onClick={onClose}>{t('voy.cancel')}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>{t('voy.save')}</Button>
        </>
      }
    >
      <div className="col gap-4">
        {/* Les rappels. Ce ne sont pas des refus : l'enregistrement passe. */}
        {warn && warn.avertissements.length > 0 && (
          <div className="col gap-2" style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-md)', padding: 'var(--sp-3)' }}>
            <span className="t-small t-medium">{t('voy.warnTitle')}</span>
            {warn.avertissements.map((code) => (
              <p key={code} className="t-caption t-secondary">
                {t(`voy.warn_${code}` as 'voy.warn_licence_b_a_verifier')}
              </p>
            ))}
            <p className="t-caption t-tertiary">{t('voy.warnRecordOnly')}</p>
          </div>
        )}

        <div className="grid grid--2">
          <Field label={t('voy.filterKind')}>
            <Select value={k} onChange={(e) => setK(e.target.value as TravelKind)}>
              {(['BILLET', 'HEBERGEMENT', 'ASSURANCE', 'TRANSFERT', 'TRANSPORT', 'AUTRE'] as TravelKind[]).map((x) => (
                <option key={x} value={x}>{t(`voy.kind${x}` as 'voy.kindBILLET')}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('voy.status')}>
            <Select value={f.status} onChange={(e) => set('status', e.target.value)}>
              {TRAVEL_STATUSES.map((s) => (
                <option key={s} value={s}>{t(`voy.status_${s}` as 'voy.status_a_faire')}</option>
              ))}
            </Select>
          </Field>
        </div>

        {clientOptions && (
          <Field label={t('voy.client')}>
            <Combobox value={who} onChange={setWho} options={clientOptions} emptyLabel={t('voy.none')} />
          </Field>
        )}

        <div className="grid grid--2">
          <Field label={t('voy.supplier')}>
            <Input value={f.supplierName ?? ''} onChange={(e) => set('supplierName', e.target.value)} />
          </Field>
          <Field label={t('voy.reference')}>
            <Input value={f.reference ?? ''} onChange={(e) => set('reference', e.target.value)} />
          </Field>
        </div>

        {k === 'BILLET' && (
          <>
            <div className="grid grid--2">
              <Field label={t('voy.carrier')}>
                <Input value={f.carrier ?? ''} onChange={(e) => set('carrier', e.target.value)} />
              </Field>
              <Field label={t('voy.pnr')}>
                <Input value={f.pnr ?? ''} onChange={(e) => set('pnr', e.target.value)} />
              </Field>
              <Field label={t('voy.ticketNumber')}>
                <Input value={f.ticketNumber ?? ''} onChange={(e) => set('ticketNumber', e.target.value)} />
              </Field>
              <Field label={t('voy.passengers')}>
                <Input type="number" min={1} value={f.passengers ?? ''} onChange={(e) => set('passengers', e.target.value)} />
              </Field>
              <Field label={t('voy.departFrom')}>
                <Input value={f.departFrom ?? ''} onChange={(e) => set('departFrom', e.target.value)} />
              </Field>
              <Field label={t('voy.departTo')}>
                <Input value={f.departTo ?? ''} onChange={(e) => set('departTo', e.target.value)} />
              </Field>
              <Field label={t('voy.departAt')}>
                <Input type="date" value={f.departAt ?? ''} onChange={(e) => set('departAt', e.target.value)} />
              </Field>
              <Field label={t('voy.returnAt')}>
                <Input type="date" value={f.returnAt ?? ''} onChange={(e) => set('returnAt', e.target.value)} />
              </Field>
              <Field label={t('voy.flightOut')}>
                <Input value={f.flightNoOut ?? ''} onChange={(e) => set('flightNoOut', e.target.value)} />
              </Field>
              <Field label={t('voy.flightBack')}>
                <Input value={f.flightNoBack ?? ''} onChange={(e) => set('flightNoBack', e.target.value)} />
              </Field>
              <Field label={t('voy.cabin')}>
                <Input value={f.cabin ?? ''} onChange={(e) => set('cabin', e.target.value)} />
              </Field>
              <Field label={t('voy.baggage')}>
                <Input type="number" min={0} step="0.5" value={f.baggageKg ?? ''} onChange={(e) => set('baggageKg', e.target.value)} />
              </Field>
            </div>
          </>
        )}

        {k === 'HEBERGEMENT' && (
          <div className="grid grid--2">
            <Field label={t('voy.hotelName')}>
              <Input value={f.hotelName ?? ''} onChange={(e) => set('hotelName', e.target.value)} />
            </Field>
            <Field label={t('voy.hotelCity')}>
              <Input value={f.hotelCity ?? ''} onChange={(e) => set('hotelCity', e.target.value)} />
            </Field>
            <Field label={t('voy.hotelAddress')}>
              <Input value={f.hotelAddress ?? ''} onChange={(e) => set('hotelAddress', e.target.value)} />
            </Field>
            <Field label={t('voy.board')}>
              <Select value={f.board ?? ''} onChange={(e) => set('board', e.target.value)}>
                <option value="">{t('voy.none')}</option>
                {BOARDS.map((b) => <option key={b} value={b}>{t(`voy.board_${b}` as 'voy.board_chambre_seule')}</option>)}
              </Select>
            </Field>
            <Field label={t('voy.checkin')}>
              <Input type="date" value={f.checkinDate ?? ''} onChange={(e) => set('checkinDate', e.target.value)} />
            </Field>
            <Field label={t('voy.checkout')}>
              <Input type="date" value={f.checkoutDate ?? ''} onChange={(e) => set('checkoutDate', e.target.value)} />
            </Field>
            <Field label={t('voy.rooms')}>
              <Input type="number" min={1} value={f.rooms ?? ''} onChange={(e) => set('rooms', e.target.value)} />
            </Field>
            <Field label={t('voy.guests')}>
              <Input type="number" min={1} value={f.guests ?? ''} onChange={(e) => set('guests', e.target.value)} />
            </Field>
          </div>
        )}

        {k === 'ASSURANCE' && (
          <div className="grid grid--2">
            <Field label={t('voy.insurer')}>
              <Input value={f.insurer ?? ''} onChange={(e) => set('insurer', e.target.value)} />
            </Field>
            <Field label={t('voy.policyNumber')}>
              <Input value={f.policyNumber ?? ''} onChange={(e) => set('policyNumber', e.target.value)} />
            </Field>
            <Field label={t('voy.coverage')}>
              <Input type="number" min={0} step="0.01" value={f.coverageAmount ?? ''} onChange={(e) => set('coverageAmount', e.target.value)} />
            </Field>
            <Field label={t('voy.currency')}>
              <Input maxLength={3} value={f.coverageCurrency ?? ''} onChange={(e) => set('coverageCurrency', e.target.value.toUpperCase())} />
            </Field>
            <Field label={t('voy.coverFrom')}>
              <Input type="date" value={f.coverFrom ?? ''} onChange={(e) => set('coverFrom', e.target.value)} />
            </Field>
            <Field label={t('voy.coverTo')}>
              <Input type="date" value={f.coverTo ?? ''} onChange={(e) => set('coverTo', e.target.value)} />
            </Field>
            <Field label={t('voy.coverArea')}>
              <Input value={f.coverArea ?? ''} onChange={(e) => set('coverArea', e.target.value)} />
            </Field>
            <Field label={t('voy.assistancePhone')}>
              <Input value={f.assistancePhone ?? ''} onChange={(e) => set('assistancePhone', e.target.value)} />
            </Field>
          </div>
        )}

        {(k === 'TRANSFERT' || k === 'TRANSPORT' || k === 'AUTRE') && (
          <div className="grid grid--2">
            <Field label={t('voy.pickupPlace')}>
              <Input value={f.pickupPlace ?? ''} onChange={(e) => set('pickupPlace', e.target.value)} />
            </Field>
            <Field label={t('voy.dropoffPlace')}>
              <Input value={f.dropoffPlace ?? ''} onChange={(e) => set('dropoffPlace', e.target.value)} />
            </Field>
            <Field label={t('voy.pickupAt')}>
              <Input type="datetime-local" value={f.pickupAt ?? ''} onChange={(e) => set('pickupAt', e.target.value)} />
            </Field>
            <Field label={t('voy.vehicle')}>
              <Input value={f.vehicle ?? ''} onChange={(e) => set('vehicle', e.target.value)} />
            </Field>
            <Field label={t('voy.driverPhone')}>
              <Input value={f.driverPhone ?? ''} onChange={(e) => set('driverPhone', e.target.value)} />
            </Field>
          </div>
        )}

        {/* L'argent. Le coût n'apparaît que pour la direction : le serveur ne
            le rend pas aux autres, l'écran ne fait pas semblant de l'avoir. */}
        <div className="grid grid--2" style={{ borderTop: '1px solid var(--hairline)', paddingTop: 'var(--sp-4)' }}>
          <Field label={`${t('voy.sold')} (${f.currency || currency})`}>
            <Input type="number" min={0} step="0.01" value={f.soldAmount ?? ''} onChange={(e) => set('soldAmount', e.target.value)} />
          </Field>
          {canMoney ? (
            <Field label={`${t('voy.cost')} (${f.currency || currency})`} hint={t('voy.costHint')}>
              <Input type="number" min={0} step="0.01" value={f.costAmount ?? ''} onChange={(e) => set('costAmount', e.target.value)} />
            </Field>
          ) : (
            <Field label={t('voy.cost')}>
              <p className="t-caption t-tertiary">{t('voy.costHidden')}</p>
            </Field>
          )}
          <Field label={t('voy.currency')}>
            <Input maxLength={3} value={f.currency ?? ''} onChange={(e) => set('currency', e.target.value.toUpperCase())} />
          </Field>
          <Field label={t('voy.fxRate')} hint={t('voy.fxHint')}>
            <Input type="number" min={0} step="0.000001" value={f.fxRate ?? ''} onChange={(e) => set('fxRate', e.target.value)} />
          </Field>
          <Field label={t('voy.bookedAt')}>
            <Input type="date" value={f.bookedAt ?? ''} onChange={(e) => set('bookedAt', e.target.value)} />
          </Field>
        </div>

        <Field label={t('voy.note')}>
          <Textarea rows={2} value={f.note ?? ''} onChange={(e) => set('note', e.target.value)} />
        </Field>

        {error && <p className="t-small t-orange">{error}</p>}
      </div>
    </Modal>
  )
}

/* ------------------------------ Outils ------------------------------ */

const day = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : '')
const numOr0 = (s: string | undefined): number => (s && Number.isFinite(Number(s)) ? Number(s) : 0)
const numOrNull = (s: string | undefined): number | null =>
  (s && s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : null)
const intOrNull = (s: string | undefined): number | null => {
  const v = numOrNull(s)
  return v === null ? null : Math.round(v)
}

function initial(row: TravelService | null, money: TravelMoney | null, currency: string): Record<string, string> {
  if (!row) return { status: 'a_faire', currency, fxRate: '1', soldAmount: '0', costAmount: '0' }
  return {
    status: row.status,
    supplierName: row.supplierName ?? '',
    reference: row.reference ?? '',
    bookedAt: day(row.bookedAt),
    note: row.note ?? '',
    soldAmount: String(row.soldAmount),
    // Le coût vient de la fonction, jamais de la ligne : la colonne est fermée.
    costAmount: money ? String(money.cost) : '',
    currency: row.currency,
    fxRate: String(row.fxRate),

    carrier: row.carrier ?? '',
    flightNoOut: row.flightNoOut ?? '',
    flightNoBack: row.flightNoBack ?? '',
    pnr: row.pnr ?? '',
    ticketNumber: row.ticketNumber ?? '',
    departFrom: row.departFrom ?? '',
    departTo: row.departTo ?? '',
    departAt: day(row.departAt),
    returnAt: day(row.returnAt),
    passengers: row.passengers === null ? '' : String(row.passengers),
    cabin: row.cabin ?? '',
    baggageKg: row.baggageKg === null ? '' : String(row.baggageKg),

    hotelName: row.hotelName ?? '',
    hotelCity: row.hotelCity ?? '',
    hotelAddress: row.hotelAddress ?? '',
    checkinDate: row.checkinDate ?? '',
    checkoutDate: row.checkoutDate ?? '',
    rooms: row.rooms === null ? '' : String(row.rooms),
    guests: row.guests === null ? '' : String(row.guests),
    board: row.board ?? '',

    insurer: row.insurer ?? '',
    policyNumber: row.policyNumber ?? '',
    coverageAmount: row.coverageAmount === null ? '' : String(row.coverageAmount),
    coverageCurrency: row.coverageCurrency ?? '',
    coverFrom: row.coverFrom ?? '',
    coverTo: row.coverTo ?? '',
    coverArea: row.coverArea ?? '',
    assistancePhone: row.assistancePhone ?? '',

    pickupPlace: row.pickupPlace ?? '',
    dropoffPlace: row.dropoffPlace ?? '',
    pickupAt: row.pickupAt ? row.pickupAt.slice(0, 16) : '',
    vehicle: row.vehicle ?? '',
    driverPhone: row.driverPhone ?? '',
  }
}
