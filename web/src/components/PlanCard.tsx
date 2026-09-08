import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Empty, Pill, Progress } from '@/components/ui'
import { useI18n } from '@/i18n'
import { loadMyPlan, refreshUsage, type MyPlan, type FeatureCode } from '@/data/abonnements'
import {
  alerte, depasse, enMo, illimite, joursAvant, pourcentage, reste, taille, ton,
  type QuotaResource,
} from '@/lib/quotas'

/* Ce que l'AGENCE voit de son propre abonnement.
 *
 * Elle lit, elle ne décide pas : il n'y a aucun bouton « changer de plan » ici,
 * et c'est volontaire. L'abonnement se facture à l'année sur facture TTN, le
 * prix se discute au téléphone, et la base refuse de toute façon qu'une agence
 * touche à son propre plan. Un bouton qui mène à une erreur vaut moins qu'un
 * numéro de téléphone.
 *
 * Le montant est montré DÉCOMPOSÉ : tant d'utilisateurs, tel prix unitaire,
 * douze mois. C'est ce que la circulaire BCT 2016-09 exige de lire sur la
 * facture, et c'est aussi ce qu'une agence comprend du premier coup d'œil.
 */

/** Les ressources montrées, dans l'ordre où une agence les regarde. */
const RESSOURCES: QuotaResource[] = ['users', 'offices', 'clients', 'cases', 'shipments', 'storage']

export function PlanCard({ compact }: { compact?: boolean } = {}) {
  const { t, formatDate, formatMoney, formatNumber } = useI18n()
  const [plan, setPlan] = useState<MyPlan | null>(null)
  const [state, setState] = useState<'chargement' | 'pret' | 'erreur'>('chargement')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setPlan(await loadMyPlan())
      setState('pret')
    } catch {
      setState('erreur')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  if (state === 'chargement') return <Card title={t('plan.title')}><Empty title={t('plan.loading')} scene="aucune" /></Card>
  if (state === 'erreur' || !plan) return <Card title={t('plan.title')}><Empty title={t('plan.error')} /></Card>

  const jours = joursAvant(plan.renewal_on)
  const enEssai = plan.status === 'essai'
  const coupe = plan.status === 'suspendue' || plan.status === 'resiliee'

  // La consommation ramenée aux mêmes unités que les limites. Le stockage est
  // le seul à changer d'unité : la base compte en octets, la grille en Mo.
  const valeur = (r: QuotaResource): number =>
    r === 'storage' ? enMo(plan.usage.storage_bytes) : plan.usage[r]
  const limite = (r: QuotaResource): number | null =>
    r === 'storage' ? plan.limits.storage_mb
      : r === 'clients' ? null
      : plan.limits[r]

  const enDepassement = RESSOURCES.some((r) => depasse(valeur(r), limite(r)))

  return (
    <Card
      title={t('plan.title')}
      action={
        <Button icon="refresh" size="sm" disabled={busy} onClick={async () => {
          setBusy(true)
          try { await refreshUsage(plan.agency_id); await load() } finally { setBusy(false) }
        }}>{t('plan.refresh')}</Button>
      }
    >
      {/* Le plan, son état, et l'échéance. Trois informations, une ligne. */}
      <div className="row gap-3 wrap" style={{ alignItems: 'baseline' }}>
        <span className="t-title" style={{ fontSize: 'var(--size-lead)' }}>{plan.name}</span>
        <Pill tone={coupe ? 'red' : enEssai ? 'blue' : plan.status === 'impayee' ? 'orange' : 'green'} dot>
          {t(`plan.status.${plan.status}` as 'plan.status.active')}
        </Pill>
        <span className="grow" />
        <span className="t-caption t-tertiary">
          {plan.renewal_on
            ? `${t('plan.renewal')} · ${formatDate(plan.renewal_on)}`
            : t('plan.noRenewal')}
        </span>
      </div>

      {enEssai && plan.renewal_on && (
        <p className="t-small t-secondary" style={{ marginTop: 'var(--sp-2)' }}>
          {jours !== null && jours >= 0 && jours <= 7
            ? t('plan.trialEndsSoon', { days: jours })
            : t('plan.trialEnds', { date: formatDate(plan.renewal_on) })}
        </p>
      )}
      {coupe && (
        <p className="t-small" style={{ marginTop: 'var(--sp-2)', color: 'var(--red)' }}>
          {t('plan.suspendedNote')}
        </p>
      )}
      {jours !== null && jours < 0 && !enEssai && !coupe && (
        <p className="t-small" style={{ marginTop: 'var(--sp-2)', color: 'var(--orange)' }}>
          {t('plan.renewalPassed', { days: Math.abs(jours) })}
        </p>
      )}

      {/* Le montant, décomposé. Jamais un forfait sec. */}
      {!enEssai && plan.annual_amount > 0 && (
        <div style={{ marginTop: 'var(--sp-5)' }}>
          <div className="row gap-3" style={{ alignItems: 'baseline' }}>
            <span className="t-caption t-tertiary">{t('plan.annual')}</span>
            <span className="t-title" style={{ fontSize: 'var(--size-lead)' }}>
              {formatMoney(plan.annual_amount, plan.currency)}
            </span>
          </div>
          <p className="t-caption t-tertiary" style={{ marginTop: 'var(--sp-1)' }}>
            {t('plan.formula', {
              seats: plan.seats,
              price: formatMoney(plan.price_per_user_month, plan.currency),
            })}
          </p>
          <p className="t-caption t-tertiary" style={{ marginTop: 'var(--sp-2)' }}>
            {t('plan.invoiceNote')}
          </p>
        </div>
      )}

      {/* La consommation, ressource par ressource. */}
      <div style={{ marginTop: 'var(--sp-5)' }}>
        <p className="t-caption t-tertiary" style={{ marginBottom: 'var(--sp-3)' }}>{t('plan.usage')}</p>
        <div className="col gap-4">
          {RESSOURCES.map((r) => (
            <Jauge
              key={r}
              label={t(`plan.res.${r}` as 'plan.res.users')}
              utilise={valeur(r)}
              limite={limite(r)}
              octets={r === 'storage' ? plan.usage.storage_bytes : null}
              t={t}
              formatNumber={formatNumber}
            />
          ))}
        </div>
      </div>

      {enDepassement && (
        <p className="t-small" style={{ marginTop: 'var(--sp-4)', color: 'var(--orange)' }}>
          {t('plan.overNote')}
        </p>
      )}

      {/* Ce que le plan comprend. Masqué en version compacte : dans les
          réglages, l'agence veut d'abord savoir où elle en est. */}
      {!compact && plan.features.length > 0 && (
        <div style={{ marginTop: 'var(--sp-5)' }}>
          <p className="t-caption t-tertiary" style={{ marginBottom: 'var(--sp-2)' }}>{t('plan.included')}</p>
          <div className="row gap-2 wrap">
            {plan.features.map((f: FeatureCode) => (
              <Pill key={f} tone="gray">{t(`plan.feature.${f}` as 'plan.feature.VISA')}</Pill>
            ))}
          </div>
        </div>
      )}

      <p className="t-caption t-tertiary" style={{ marginTop: 'var(--sp-5)', marginBottom: 0 }}>
        {t('plan.contact')}
      </p>
    </Card>
  )
}

/* Une jauge. Illimité n'affiche PAS de barre : une barre pleine dirait
   « bloqué » là où l'agence a justement payé pour ne plus l'être. */
function Jauge({ label, utilise, limite, octets, t, formatNumber }: {
  label: string
  utilise: number
  limite: number | null
  octets: number | null
  t: ReturnType<typeof useI18n>['t']
  formatNumber: (n: number) => string
}) {
  const pct = pourcentage(utilise, limite)
  const libre = reste(utilise, limite)
  const affiche = octets !== null ? taille(octets, formatNumber) : formatNumber(utilise)

  return (
    <div>
      <div className="row gap-2" style={{ alignItems: 'baseline' }}>
        <span className="t-small t-medium">{label}</span>
        <span className="grow" />
        <span className="t-caption t-tertiary">
          {illimite(limite)
            ? `${affiche} · ${t('plan.unlimited')}`
            : `${affiche} / ${formatNumber(limite as number)}${octets !== null ? ' Mo' : ''}`}
        </span>
        {depasse(utilise, limite) && <Pill tone="red">{t('plan.over')}</Pill>}
        {!depasse(utilise, limite) && libre === 0 && <Pill tone="orange">{t('plan.full')}</Pill>}
        {alerte(utilise, limite) && libre !== 0 && <Pill tone="orange">{t('plan.near')}</Pill>}
      </div>
      {pct !== null && (
        <div style={{ marginTop: 'var(--sp-2)' }}>
          <Progress
            pct={pct}
            tone={ton(utilise, limite) === 'green' ? 'green' : 'orange'}
            label={label}
            valueText={libre === null ? t('plan.unlimited') : t('plan.remaining', { n: libre })}
          />
        </div>
      )}
    </div>
  )
}
