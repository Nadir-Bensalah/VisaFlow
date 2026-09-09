import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Empty, Field, Input, Modal, Pill, Segmented, Select, useToast } from '@/components/ui'
import {
  loadBillingBoard, loadAgencyPayments, recordPayment, reactivateAgency,
  type AgencyPayment, type BillingRow, type BillingState, type PaymentMethod,
} from '@/data/facturation'

/* L'écran plateforme du cycle de facturation.
   En français en dur, comme le reste de la console : elle n'a qu'un
   utilisateur, et l'y traduire coûterait quatre langues pour personne.

   Ce que cet écran fait : montrer qui va être coupé, dans quel ordre, et
   permettre d'enregistrer le virement reçu. Il n'encaisse rien. L'abonnement
   se règle par virement, sur facture TTN : il n'existe pas de prélèvement
   récurrent par carte en Tunisie. Aucun bouton ici ne doit laisser croire le
   contraire, et « Enregistrer le règlement » veut dire « je l'ai vu sur mon
   relevé », pas « prélever ». */

const ETAT_LABEL: Record<BillingState, string> = {
  essai: 'Essai',
  grace: 'Délai de grâce',
  a_jour: 'À jour',
  suspendue: 'Suspendue',
}

const ETAT_TON: Record<BillingState, 'gray' | 'blue' | 'green' | 'orange' | 'red'> = {
  essai: 'blue', grace: 'orange', a_jour: 'green', suspendue: 'red',
}

const METHODES: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'virement', label: 'Virement' },
  { value: 'cheque', label: 'Chèque' },
  { value: 'especes', label: 'Espèces' },
  { value: 'carte', label: 'Carte' },
  { value: 'autre', label: 'Autre' },
]

const MOTIF_LABEL: Record<string, string> = {
  grace_depassee: 'Délai de grâce dépassé',
  reprise_0066: 'Suspension antérieure au cycle',
}

const dt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('fr-TN', { day: '2-digit', month: 'short', year: 'numeric' }) : '·'
const dinars = (n: number, devise = 'TND') =>
  new Intl.NumberFormat('fr-TN', { maximumFractionDigits: 0 }).format(n) + (devise === 'TND' ? ' DT' : ' ' + devise)
const nb = (n: number) => new Intl.NumberFormat('fr-TN').format(n)
const aujourdhui = () => new Date().toISOString().slice(0, 10)

/* « Dans 5 jours » et « en retard de 5 jours » se lisent sur le même chiffre :
   c'est voulu côté base, le signe porte le sens. Il faut donc l'écrire ici, et
   pas afficher un « -5 » que personne ne sait lire. */
function delai(jours: number | null): { texte: string; retard: boolean } {
  if (jours === null) return { texte: '·', retard: false }
  if (jours < 0) return { texte: `en retard de ${Math.abs(jours)} j`, retard: true }
  if (jours === 0) return { texte: "aujourd'hui", retard: true }
  return { texte: `dans ${jours} j`, retard: false }
}

export function Facturation() {
  const toast = useToast()
  const [rows, setRows] = useState<BillingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filtre, setFiltre] = useState<'urgent' | 'tous' | 'essais' | 'suspendues'>('urgent')
  const [paying, setPaying] = useState<BillingRow | null>(null)
  const [journal, setJournal] = useState<BillingRow | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      // L'ordre vient du serveur : suspendues, grâces, essais qui finissent,
      // puis à jour. On ne re-trie pas ici, sinon la règle diverge le jour où
      // elle change côté base.
      setRows(await loadBillingBoard())
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Chargement impossible.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => rows.filter((r) =>
    filtre === 'tous' ? true
      : filtre === 'essais' ? r.etat === 'essai'
      : filtre === 'suspendues' ? r.etat === 'suspendue'
      : r.etat !== 'a_jour'), [rows, filtre])

  const suspendues = rows.filter((r) => r.etat === 'suspendue').length
  const graces = rows.filter((r) => r.etat === 'grace').length
  const essais = rows.filter((r) => r.etat === 'essai').length
  // Ce qui va tomber dans la semaine : la seule ligne qu'on regarde le lundi.
  const imminent = rows.filter((r) => r.etat === 'grace'
    && r.jours_restants !== null && r.jours_restants <= 7).length

  if (loading) return <Card title="Facturation"><Empty title="Chargement…" scene="aucune" /></Card>

  return (
    <>
      <div className="admin__grid" style={{ marginBottom: 'var(--sp-6)' }}>
        <Chiffre label="Suspendues" value={nb(suspendues)} hint="accès coupé, données intactes" accent={suspendues > 0} />
        <Chiffre label="En délai de grâce" value={nb(graces)} hint={`${nb(imminent)} coupées sous 7 jours`} />
        <Chiffre label="En essai" value={nb(essais)} />
        <Chiffre label="Agences suivies" value={nb(rows.length)} />
      </div>

      <Card
        title="Cycle de facturation"
        action={
          <div className="row gap-2" style={{ alignItems: 'center' }}>
            <Segmented value={filtre} onChange={setFiltre} options={[
              { value: 'urgent', label: 'À traiter' },
              { value: 'suspendues', label: 'Suspendues' },
              { value: 'essais', label: 'Essais' },
              { value: 'tous', label: 'Toutes' },
            ]} />
            <Button icon="refresh" size="sm" onClick={() => void load()}>Recharger</Button>
          </div>
        }
        flush
      >
        {shown.length === 0 ? (
          <div style={{ padding: 'var(--sp-5)' }}>
            <Empty title="Rien à traiter dans ce filtre." hint="Tout le monde est à jour." />
          </div>
        ) : (
          <div className="admin__scroll">
            <table className="admin__table">
              <thead>
                <tr>
                  <th>Agence</th><th>État</th><th>Échéance</th>
                  <th className="num">Sièges</th><th className="num">Montant attendu</th>
                  <th>Dernier règlement</th><th />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const d = delai(r.jours_restants)
                  return (
                    <tr key={r.agency_id} className={r.suspendue ? 'admin__row--off' : ''}>
                      <td className="t-small t-medium">
                        {r.name}
                        <div className="t-caption t-tertiary t-mono">{r.slug}</div>
                      </td>
                      <td>
                        <span className="row gap-1 wrap">
                          <Pill tone={ETAT_TON[r.etat]} dot>{ETAT_LABEL[r.etat]}</Pill>
                          {/* La base replie « impayée » sur la grâce à l'écran
                              du client. La console, elle, a le droit de savoir
                              qu'il s'agit d'un renouvellement et pas d'un essai. */}
                          {r.billing_state === 'impayee' && <Pill tone="orange">Renouvellement</Pill>}
                          {r.motif && <Pill tone="gray">{MOTIF_LABEL[r.motif] ?? r.motif}</Pill>}
                        </span>
                      </td>
                      <td className="t-small">
                        {dt(r.echeance)}
                        <div className="t-caption" style={d.retard ? { color: 'var(--red)' } : undefined}>
                          {d.texte}
                        </div>
                      </td>
                      <td className="num">{nb(r.sieges)}</td>
                      {/* Sièges signés × 45 DT × 12 mois. C'est la ligne de la
                          facture, pas une somme encaissée. */}
                      <td className="num t-medium">{dinars(Number(r.montant_attendu ?? 0), r.devise)}</td>
                      <td className="t-small">
                        {r.dernier_paiement ? (
                          <>
                            {dt(r.dernier_paiement)}
                            {r.dernier_montant !== null && (
                              <div className="t-caption t-tertiary">
                                {dinars(Number(r.dernier_montant), r.devise)}
                              </div>
                            )}
                          </>
                        ) : <span className="t-tertiary">jamais</span>}
                      </td>
                      <td>
                        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
                          <Button icon="clock" onClick={() => setJournal(r)}>Règlements</Button>
                          {r.etat === 'suspendue' && (
                            <Button
                              icon="lock"
                              disabled={busy === r.agency_id}
                              onClick={async () => {
                                setBusy(r.agency_id)
                                try {
                                  const out = await reactivateAgency(r.agency_id, 'Réouverture depuis la console.')
                                  toast(`Accès rouvert. Nouveau délai de grâce jusqu'au ${dt(out.grace_ends_on)}.`)
                                  await load()
                                } catch (e) {
                                  toast(e instanceof Error ? e.message : 'Réouverture impossible.')
                                } finally { setBusy(null) }
                              }}
                            >Rouvrir</Button>
                          )}
                          <Button icon="payments" variant="primary" onClick={() => setPaying(r)}>
                            Règlement
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="t-caption t-tertiary" style={{ padding: 'var(--sp-3) var(--sp-5)', margin: 0 }}>
          Une agence naît en essai de 15 jours, puis dispose de 7 jours de grâce. Passé ce délai
          et sans règlement enregistré, la balayeuse la suspend, jamais ne la supprime : ses
          dossiers, ses clients et ses documents restent intacts et reviennent au premier paiement.
          Les avertissements partent automatiquement à 5, 2 et 1 jour de la coupure.
        </p>
      </Card>

      {paying && (
        <FormeReglement
          row={paying}
          onClose={() => setPaying(null)}
          onDone={() => { setPaying(null); void load() }}
          toast={toast}
        />
      )}
      {journal && <Reglements row={journal} onClose={() => setJournal(null)} toast={toast} />}
    </>
  )
}

/* Enregistrer un règlement reçu.
   Le montant attendu est proposé, jamais imposé : un client règle parfois une
   partie, ou un montant négocié, et forcer le calcul ferait saisir un chiffre
   faux pour aller vite. */
function FormeReglement({ row, onClose, onDone, toast }: {
  row: BillingRow
  onClose: () => void
  onDone: () => void
  toast: (m: string) => void
}) {
  const [montant, setMontant] = useState(String(row.montant_attendu ?? ''))
  const [methode, setMethode] = useState<PaymentMethod>('virement')
  const [reference, setReference] = useState('')
  const [debut, setDebut] = useState(aujourdhui())
  const [fin, setFin] = useState(() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() + 1)
    d.setDate(d.getDate() - 1)
    return d.toISOString().slice(0, 10)
  })
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const n = Number(montant)
  const valide = Number.isFinite(n) && n > 0 && fin >= debut

  return (
    <Modal
      title={`Règlement · ${row.name}`}
      onClose={onClose}
      footer={<>
        <Button onClick={onClose}>Annuler</Button>
        <Button variant="primary" disabled={busy || !valide} onClick={async () => {
          setBusy(true)
          try {
            const out = await recordPayment({
              agencyId: row.agency_id,
              amount: n,
              currency: row.devise || 'TND',
              periodStart: debut,
              periodEnd: fin,
              method: methode,
              reference: reference.trim() || null,
              note: note.trim() || null,
            })
            toast(out.reactivee
              ? 'Règlement enregistré. L’agence est rouverte.'
              : 'Règlement enregistré.')
            onDone()
          } catch (e) {
            toast(e instanceof Error ? e.message : 'Enregistrement impossible.')
          } finally { setBusy(false) }
        }}>Enregistrer le règlement</Button>
      </>}
    >
      <div className="col gap-4">
        <p className="t-caption t-tertiary" style={{ margin: 0 }}>
          Ce geste constate un virement DÉJÀ reçu. Il ne prélève rien : il remet l'agence à jour,
          repousse son échéance, et rouvre son accès si elle était suspendue.
        </p>

        <Field label="Montant" hint={`Attendu : ${dinars(Number(row.montant_attendu ?? 0), row.devise)} (${nb(row.sieges)} sièges × 45 DT × 12 mois)`}>
          <Input type="number" min="0" step="0.001" value={montant}
                 onChange={(e) => setMontant(e.target.value)} />
        </Field>

        <Field label="Moyen">
          <Select value={methode} onChange={(e) => setMethode(e.target.value as PaymentMethod)}>
            {METHODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
        </Field>

        <Field label="Référence" hint="La référence du virement. Elle ne s'enregistre qu'une fois : c'est ce qui empêche de saisir deux fois le même règlement.">
          <Input value={reference} onChange={(e) => setReference(e.target.value)}
                 placeholder="VIR-2026-0142" />
        </Field>

        <div className="row gap-3">
          <Field label="Période du">
            <Input type="date" value={debut} onChange={(e) => setDebut(e.target.value)} />
          </Field>
          <Field label="au" error={fin < debut ? 'La période finit avant de commencer.' : undefined}>
            <Input type="date" value={fin} onChange={(e) => setFin(e.target.value)} />
          </Field>
        </div>

        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)}
                 placeholder="Reçu sur le compte le 12 septembre." />
        </Field>
      </div>
    </Modal>
  )
}

/* L'histoire des règlements. C'est ce qu'on ouvre quand un client dit
   « mais j'ai payé ». */
function Reglements({ row, onClose, toast }: {
  row: BillingRow
  onClose: () => void
  toast: (m: string) => void
}) {
  const [items, setItems] = useState<AgencyPayment[] | null>(null)

  useEffect(() => {
    let vivant = true
    loadAgencyPayments(row.agency_id, 50)
      .then((r) => { if (vivant) setItems(r) })
      .catch((e) => { toast(e instanceof Error ? e.message : 'Lecture impossible.'); if (vivant) setItems([]) })
    return () => { vivant = false }
  }, [row.agency_id, toast])

  return (
    <Modal title={`Règlements · ${row.name}`} onClose={onClose} wide
           footer={<Button onClick={onClose}>Fermer</Button>}>
      {items === null ? <Empty title="Chargement…" scene="aucune" />
        : items.length === 0 ? <Empty title="Aucun règlement enregistré." hint="Cette agence n'a jamais payé." />
        : (
          <table className="admin__table">
            <thead>
              <tr><th>Enregistré le</th><th className="num">Montant</th><th>Période</th><th>Moyen</th><th>Référence</th><th>Par</th></tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td className="t-small">{dt(p.recorded_at)}</td>
                  <td className="num t-medium">{dinars(Number(p.amount), p.currency)}</td>
                  <td className="t-small">{dt(p.period_start)} → {dt(p.period_end)}</td>
                  <td className="t-small">{METHODES.find((m) => m.value === p.method)?.label ?? p.method}</td>
                  <td className="t-caption t-mono">{p.reference ?? '·'}</td>
                  <td className="t-small">{p.recorded_by ?? '·'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </Modal>
  )
}

/* La même vignette que l'écran des abonnements, avec les mêmes classes : deux
   grammaires visuelles dans la même console se remarquent tout de suite. */
function Chiffre({ label, value, hint, accent }: {
  label: string; value: string; hint?: string; accent?: boolean
}) {
  return (
    <div className={`admin__metric ${accent ? 'admin__metric--accent' : ''}`}>
      <span className="t-caption t-tertiary">{label}</span>
      <span className="admin__metric-value">{value}</span>
      {hint && <span className="t-caption t-tertiary">{hint}</span>}
    </div>
  )
}
