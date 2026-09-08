import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Card, Empty } from '@/components/ui'
import { BOITE, colonnes, largeurPct, maxDe, moisCourt, plusieursAnnees, poids } from '@/lib/graphes'
import { loadPlatformAnalytics, type PlatformAnalytics } from '@/data/pilotage'

/* L'analyse de la plateforme, section 189. En français en dur, comme le reste
   de la console : elle n'a qu'un lecteur, et il parle français.

   LE POINT QUI SE TROMPE TOUT SEUL, ET POURQUOI IL EST ÉCRIT À L'ÉCRAN.

   Un abonnement annuel réglé sur facture n'est pas un revenu récurrent au sens
   habituel. L'argent tombe une fois ; si l'agence ne renouvelle pas, il ne
   tombe plus du tout. Pour le comparer à un abonnement mensuel, on le ramène au
   douzième. Additionner les deux sans le dire donnerait un total juste
   arithmétiquement et faux dans la tête de celui qui le lit. Les deux parts
   sont donc affichées séparément, avec la phrase du serveur en dessous. */

export function Analytics() {
  const [a, setA] = useState<PlatformAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const charger = useCallback(async () => {
    if (!supabase) { setLoading(false); return }
    setLoading(true)
    try {
      setA(await loadPlatformAnalytics())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void charger() }, [charger])

  if (loading) return <Card><Empty title="Chargement…" /></Card>
  if (error) return <Card><Empty title={`Chargement impossible : ${error}`} /></Card>
  if (!a) return <Card><Empty title="Aucune donnée." /></Card>

  const dinars = (n: number) =>
    new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'TND', maximumFractionDigits: 0 }).format(n)

  const points = a.signupsByMonth.map((s) => ({ label: s.month, value: s.n }))
  const barres = colonnes(points)
  const avecAnnee = plusieursAnnees(points)
  const plans = Object.entries(a.byPlan).sort((x, y) => y[1] - x[1])
  const maxPlan = maxDe(plans.map(([, n]) => n))

  return (
    <div className="stack">
      <div className="grid grid--4">
        <Stat label="Revenu mensuel récurrent" value={dinars(a.mrrTotal)}
              hint={a.mrrSource === 'subscriptions' ? 'Depuis les abonnements' : 'Depuis les factures de plateforme'} />
        <Stat label="Revenu annuel" value={dinars(a.arr)} hint="Douze fois le mensuel" />
        <Stat label="Agences actives" value={String(a.agenciesActive)}
              hint={`${a.agenciesTotal} au total · ${a.agenciesSuspended} suspendues`} />
        <Stat label="Essais en cours" value={String(a.trials)}
              hint={`${a.trialsEnding30d} se terminent sous 30 jours`} />
      </div>

      <Card title="Le revenu récurrent, et ce qu'il recouvre">
        <div className="col gap-3">
          <Ligne label="Abonnements mensuels" value={dinars(a.mrrMonthlyPlans)} />
          <Ligne label="Abonnements annuels, ramenés au douzième" value={dinars(a.mrrAnnualTwelfth)} />
          <Ligne label="Total mensuel comparable" value={dinars(a.mrrTotal)} />
        </div>
        <p className="t-caption t-tertiary" style={{ marginTop: 'var(--sp-4)' }}>{a.mrrNote}</p>
      </Card>

      <div className="grid grid--2">
        <Card title="Conversions et attrition, sur 90 jours">
          <div className="col gap-3">
            <Ligne label="Nouveaux abonnements" value={String(a.conversions90d)} />
            <Ligne label="Résiliations" value={String(a.churn90d)} />
            <Ligne
              label="Taux d'attrition"
              value={a.churnRate90d === null ? 'Pas assez de données' : `${a.churnRate90d} %`}
            />
          </div>
          <p className="t-caption t-tertiary" style={{ marginTop: 'var(--sp-4)' }}>
            Rapporté au parc d'agences actives. Un parc vide ne rend pas 0 % : il ne rend rien.
          </p>
        </Card>

        <Card title="Le parc">
          <div className="col gap-3">
            <Ligne label="Comptes actifs" value={String(a.accounts)} />
            <Ligne label="Bureaux" value={String(a.offices)} />
            <Ligne label="Clients" value={String(a.clients)} />
            <Ligne label="Dossiers" value={`${a.cases} · ${a.casesOpen} ouverts`} />
            <Ligne label="Cargaisons" value={`${a.shipments} · ${a.shipmentsOpen} en cours`} />
            <Ligne label="Stockage" value={poids(a.storageBytes)} />
          </div>
        </Card>

        <Card title="Inscriptions, mois par mois" className="grid__wide">
          {points.length === 0 ? <Empty title="Aucune inscription sur douze mois." /> : (
            <div style={{ overflowX: 'auto' }}>
              <svg
                viewBox={`0 0 ${BOITE.width} ${BOITE.height + 20}`}
                width="100%"
                height={BOITE.height + 20}
                role="img"
                aria-label="Inscriptions mois par mois"
              >
                {barres.map((c) => (
                  <rect key={c.p.label} x={c.x} y={c.y} width={c.w} height={c.h}
                        rx={3} fill="var(--blue)" opacity={0.85} />
                ))}
                {barres.map((c) => (
                  <text key={`v-${c.p.label}`} x={c.x + c.w / 2} y={Math.max(10, c.y - 4)}
                        textAnchor="middle" fontSize="10" fill="var(--text-tertiary)">
                    {c.p.value}
                  </text>
                ))}
                {barres.map((c) => (
                  <text key={`m-${c.p.label}`} x={c.x + c.w / 2} y={BOITE.height + 14}
                        textAnchor="middle" fontSize="10" fill="var(--text-tertiary)">
                    {moisCourt(c.p.label, 'fr-FR', avecAnnee)}
                  </text>
                ))}
              </svg>
            </div>
          )}
        </Card>

        <Card title="Par formule" className="grid__wide">
          {plans.length === 0 ? <Empty title="Aucune agence." /> : (
            <div className="col gap-3">
              {plans.map(([k, n]) => (
                <div key={k} className="col gap-2">
                  <div className="row-between">
                    <span className="t-small">{k}</span>
                    <span className="t-small t-num t-medium">{n}</span>
                  </div>
                  <div className="progress">
                    <div className="progress__bar" style={{ width: `${largeurPct(n, maxPlan)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <div className="stat" style={{ padding: 0 }}>
        <div className="stat__label">{label}</div>
        <div className="stat__value">{value}</div>
        {hint && <div className="stat__hint">{hint}</div>}
      </div>
    </Card>
  )
}

function Ligne({ label, value }: { label: string; value: string }) {
  return (
    <div className="row-between">
      <span className="t-small t-secondary">{label}</span>
      <span className="t-small t-num t-medium">{value}</span>
    </div>
  )
}
