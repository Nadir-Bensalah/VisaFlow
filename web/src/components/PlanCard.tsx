import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Empty, Pill, Progress } from '@/components/ui'
import { useI18n } from '@/i18n'
import { loadMyPlan, refreshUsage, type MyPlan, type FeatureCode, type InvoiceLine } from '@/data/abonnements'
import { useUsage } from '@/data/usage'
import { UsageGauges } from './UsageGauges'
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
 * Le montant est montré DÉCOMPOSÉ : le socle, les bureaux en plus, les
 * comptes en plus, puis HT, TVA, retenue à la source et net à payer. C'est ce
 * que la facture TTN imprime, et c'est ce qu'une agence comprend du premier
 * coup d'œil. Rien ici n'est calculé : les lignes viennent de `my_plan`.
 *
 * LA CONSOMMATION EN TEMPS RÉEL vient d'une autre porte, `agency_usage`, qui
 * recompte à chaque appel et rend le niveau (info, attention, bloque). Tant
 * que cette porte n'existe pas sur la base, l'ancienne jauge lue dans
 * `my_plan` reste affichée : on ne montre jamais deux consommations.
 */

/** Les ressources montrées, dans l'ordre où une agence les regarde. */
const RESSOURCES: QuotaResource[] = ['users', 'offices', 'clients', 'cases', 'shipments', 'storage']

type FormuleKey = 'plan.formule.essai' | 'plan.formule.active' | 'plan.formule.premium'
type LigneKey = 'plan.line.socle' | 'plan.line.bureau' | 'plan.line.compte' | 'plan.line.premium' | 'plan.line.remise'
type PeriodeKey = 'plan.period.annuel' | 'plan.period.semestriel' | 'plan.period.mensuel'

const LIGNES: Record<string, LigneKey> = {
  socle: 'plan.line.socle', bureau: 'plan.line.bureau', compte: 'plan.line.compte',
  premium: 'plan.line.premium', remise: 'plan.line.remise',
}

export function PlanCard({ compact }: { compact?: boolean } = {}) {
  const { t, formatDate, formatMoney, formatNumber } = useI18n()
  const [plan, setPlan] = useState<MyPlan | null>(null)
  const [state, setState] = useState<'chargement' | 'pret' | 'erreur'>('chargement')
  const [busy, setBusy] = useState(false)
  const { usage, reload: reloadUsage } = useUsage()
  const [usageBusy, setUsageBusy] = useState(false)

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
  const code = plan.plan_code ?? plan.code
  const devise = plan.currency
  const mensuel = Number(plan.monthly_amount ?? 0)
  const periode = Number(plan.annual_amount ?? 0)
  const totaux = plan.invoice_totals
  const lignes: InvoiceLine[] = Array.isArray(plan.invoice_lines) ? plan.invoice_lines : []
  const extraUsers = Number(plan.extra_users ?? 0)
  const extraOffices = Number(plan.extra_offices ?? 0)
  const pct = (r: number) => formatNumber(Math.round(r * 10000) / 100)

  // La consommation ramenée aux mêmes unités que les limites. Le stockage est
  // le seul à changer d'unité : la base compte en octets, la grille en Mo.
  const valeur = (r: QuotaResource): number =>
    r === 'storage' ? enMo(plan.usage.storage_bytes) : plan.usage[r]
  const limite = (r: QuotaResource): number | null =>
    r === 'storage' ? plan.limits.storage_mb
      : r === 'clients' ? null
      : plan.limits[r]

  const enDepassement = RESSOURCES.some((r) => depasse(valeur(r), limite(r)))
  const comptesAutorises = plan.seats_allowed ?? plan.limits.users

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
      {/* La formule, son état, et l'échéance. Trois informations, une ligne. */}
      <div className="row gap-3 wrap" style={{ alignItems: 'baseline' }}>
        <span className="t-title" style={{ fontSize: 'var(--size-lead)' }}>{t(`plan.formule.${code}` as FormuleKey)}</span>
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

      {/* La consommation, en tête : c'est ce que l'agence vient regarder.
          Compté en direct par la base, rechargé à chaque geste et toutes
          les 60 s. Premium n'a pas de limite : ses jauges vont vers l'usage
          raisonnable, et la phrase le dit. */}
      {usage && (
        <div style={{ marginTop: 'var(--sp-5)' }}>
          <div className="row gap-2 wrap" style={{ alignItems: 'center', marginBottom: 'var(--sp-3)' }}>
            <span className="t-small t-medium">{t(usage.premium ? 'usage.titlePremium' : 'usage.title')}</span>
            <span className="grow" />
            <span className="t-caption t-tertiary">{calculeIlYA(usage.computed_at, t, formatDate)}</span>
            <Button size="sm" icon="refresh" disabled={usageBusy} onClick={async () => {
              setUsageBusy(true)
              try { await reloadUsage() } finally { setUsageBusy(false) }
            }}>{t('usage.refresh')}</Button>
          </div>
          <UsageGauges usage={usage} />
        </div>
      )}

      {/* Les comptes et les bureaux que la souscription autorise, et les ajouts. */}
      <div className="col gap-2" style={{ marginTop: 'var(--sp-4)' }}>
        <div className="row gap-3" style={{ alignItems: 'baseline' }}>
          <span className="t-caption t-tertiary">{t('plan.seats')}</span>
          <span className="t-small t-medium">
            {illimite(comptesAutorises)
              ? t('plan.seatsUnlimited', { used: formatNumber(plan.usage.users) })
              : t('plan.seatsValue', { used: formatNumber(plan.usage.users), allowed: formatNumber(comptesAutorises as number) })}
          </span>
        </div>
        <div className="row gap-3" style={{ alignItems: 'baseline' }}>
          <span className="t-caption t-tertiary">{t('plan.offices')}</span>
          <span className="t-small t-medium">
            {illimite(plan.limits.offices)
              ? `${formatNumber(plan.usage.offices)} · ${t('plan.unlimited')}`
              : t('plan.officesValue', { used: formatNumber(plan.usage.offices), allowed: formatNumber(plan.limits.offices as number) })}
          </span>
        </div>
        {code === 'active' && (
          <div className="row gap-3" style={{ alignItems: 'baseline' }}>
            <span className="t-caption t-tertiary">{t('plan.addons')}</span>
            <span className="t-small t-medium">
              {extraUsers === 0 && extraOffices === 0 ? t('plan.noAddons')
                : [
                  extraOffices > 0 ? t('plan.addonOffices', { n: formatNumber(extraOffices) }) : null,
                  extraUsers > 0 ? t('plan.addonUsers', { n: formatNumber(extraUsers) }) : null,
                ].filter(Boolean).join(' · ')}
            </span>
          </div>
        )}
      </div>

      {/* Le montant, décomposé. Jamais un forfait sec. */}
      {!enEssai && periode > 0 && (
        <div style={{ marginTop: 'var(--sp-5)' }}>
          <div className="row gap-4 wrap" style={{ alignItems: 'baseline' }}>
            <span>
              <span className="t-caption t-tertiary">{t('plan.monthly')} · </span>
              <span className="t-title" style={{ fontSize: 'var(--size-lead)' }}>{formatMoney(mensuel, devise)}</span>
            </span>
            <span>
              <span className="t-caption t-tertiary">{t('plan.annual')} · </span>
              <span className="t-title" style={{ fontSize: 'var(--size-lead)' }}>{formatMoney(periode, devise)}</span>
            </span>
          </div>
          <p className="t-caption t-tertiary" style={{ marginTop: 'var(--sp-1)' }}>
            {t('plan.billed', { period: t(`plan.period.${plan.billing_period}` as PeriodeKey) })}
          </p>

          {lignes.length > 0 && (
            <div style={{ marginTop: 'var(--sp-3)' }}>
              <p className="t-caption t-tertiary" style={{ marginBottom: 'var(--sp-2)' }}>{t('plan.invoiceLines')}</p>
              <div className="col gap-1">
                {lignes.map((l, i) => (
                  <div key={i} className="row gap-3" style={{ alignItems: 'baseline' }}>
                    <span className="t-small">{LIGNES[l.kind] ? t(LIGNES[l.kind]) : l.label}</span>
                    <span className="t-caption t-tertiary">{t('plan.lineQty', { n: formatNumber(Number(l.quantity)), price: formatMoney(Number(l.unit_price), devise) })}</span>
                    <span className="grow" />
                    <span className="t-small t-medium t-num">{formatMoney(Number(l.total), devise)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {totaux && (
            <div className="col gap-1" style={{ marginTop: 'var(--sp-3)', paddingTop: 'var(--sp-2)', borderTop: '1px solid var(--hairline)' }}>
              <Total label={t('plan.ht')} value={formatMoney(Number(totaux.ht), devise)} />
              {Number(totaux.tva) > 0 && <Total label={t('plan.tva', { rate: pct(Number(totaux.tva_rate)) })} value={formatMoney(Number(totaux.tva), devise)} />}
              {Number(totaux.tva) > 0 && <Total label={t('plan.ttc')} value={formatMoney(Number(totaux.ttc), devise)} />}
              {Number(totaux.retenue) > 0 && <Total label={t('plan.retenue', { rate: pct(Number(totaux.withholding_rate)) })} value={`− ${formatMoney(Number(totaux.retenue), devise)}`} />}
              <Total label={t('plan.net')} value={formatMoney(Number(totaux.net_a_payer), devise)} fort />
            </div>
          )}

          <p className="t-caption t-tertiary" style={{ marginTop: 'var(--sp-2)' }}>
            {t('plan.invoiceNote')}
          </p>
        </div>
      )}

      {/* Premium n'a pas de garde : il a des repères. On les montre pour qu'ils ne surprennent pas. */}
      {code === 'premium' && plan.fair_use && (
        <div style={{ marginTop: 'var(--sp-5)' }}>
          <p className="t-caption t-tertiary" style={{ marginBottom: 'var(--sp-2)' }}>{t('plan.fairUse')}</p>
          <div className="row gap-2 wrap">
            {plan.fair_use.users !== null && <Pill tone="gray">{t('plan.fairUseUsers', { n: formatNumber(plan.fair_use.users) })}</Pill>}
            {plan.fair_use.offices !== null && <Pill tone="gray">{t('plan.fairUseOffices', { n: formatNumber(plan.fair_use.offices) })}</Pill>}
            {plan.fair_use.storage_mb_per_user !== null && <Pill tone="gray">{t('plan.fairUseStorage', { n: formatNumber(Math.round(plan.fair_use.storage_mb_per_user / 1024)) })}</Pill>}
            {plan.fair_use.support_hours_month !== null && <Pill tone="gray">{t('plan.fairUseSupport', { n: formatNumber(plan.fair_use.support_hours_month) })}</Pill>}
          </div>
          <p className="t-caption t-tertiary" style={{ marginTop: 'var(--sp-2)' }}>{t('plan.fairUseNote')}</p>
        </div>
      )}

      {/* L'ancienne jauge, lue dans `my_plan` : seulement tant que la porte
          `agency_usage` ne répond pas. Deux consommations à l'écran, c'est une
          de trop. */}
      {!usage && <div style={{ marginTop: 'var(--sp-5)' }}>
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
      </div>}

      {!usage && enDepassement && (
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

/** « Calculé à l'instant », « il y a 3 min », ou l'heure : le moment du dernier comptage. */
function calculeIlYA(
  iso: string,
  t: ReturnType<typeof useI18n>['t'],
  formatDate: ReturnType<typeof useI18n>['formatDate'],
): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (Number.isNaN(s) || s < 60) return t('usage.computedNow')
  if (s < 3600) return t('usage.computedAgo', { n: Math.floor(s / 60) })
  return t('usage.computedAt', { time: formatDate(iso, { hour: '2-digit', minute: '2-digit' }) })
}

function Total({ label, value, fort }: { label: string; value: string; fort?: boolean }) {
  return (
    <div className="row gap-3" style={{ alignItems: 'baseline' }}>
      <span className={fort ? 't-small t-medium' : 't-caption t-tertiary'}>{label}</span>
      <span className="grow" />
      <span className={`t-num ${fort ? 't-small t-medium' : 't-caption'}`}>{value}</span>
    </div>
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
