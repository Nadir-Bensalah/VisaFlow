import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n, LOCALES, LOCALE_META } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { rpc } from '@/data/remote'
import { loadPublicPlans, type Currency, type PublicPlan } from '@/data/abonnements'
import { estimer, type LigneCode } from '@/data/grille'
import { Button, Card, Field, Input, Select, Textarea } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { Illustration } from '@/components/Illustration'
import type { Locale } from '@/data/types'

/**
 * La demande de souscription d'une agence.
 *
 * Ce n'est PAS une inscription en libre-service, et c'est délibéré :
 *
 *   · L'abonnement se facture à l'année, au format TTN. On ne prélève pas.
 *   · Il n'existe pas de paiement récurrent par carte en Tunisie, et Stripe ne
 *     couvre pas le pays : personne ne peut « payer et entrer » tout seul.
 *   · La facture doit porter des unités (« 1 licence Active, 12 mois »,
 *     « 2 comptes × 12 mois »), jamais un forfait sec, sinon la banque refuse
 *     le transfert (article 3 de la circulaire BCT 2016-09).
 *
 * Le prix se discute donc, il ne se clique pas. La page demande ce qu'il faut
 * pour chiffrer sans rappeler, et affiche l'estimation pendant la saisie : une
 * agence qui découvre le prix après trois échanges se sent piégée.
 *
 * L'estimation applique la formule de la grille (data/grille.ts) aux lignes
 * de `public_plans`. Aucun prix n'est écrit ici : la grille bouge en base,
 * la page suit.
 */

/** Les pays proposés. TND pour la Tunisie et la Libye, EUR pour tout l'export. */
const PAYS: { value: string; devise: Currency; fcfa?: boolean }[] = [
  { value: 'Tunisie', devise: 'TND' },
  { value: 'Libye', devise: 'TND' },
  { value: 'Maroc', devise: 'EUR' },
  { value: 'Algérie', devise: 'EUR' },
  { value: 'Sénégal', devise: 'EUR', fcfa: true },
  { value: 'Côte d’Ivoire', devise: 'EUR', fcfa: true },
  { value: 'Autre', devise: 'EUR' },
]

/** La parité fixe EUR/FCFA (UEMOA). Ce n'est pas un prix : c'est une loi. */
const FCFA_PAR_EUR = 655.957

type LigneKey = 'grille.line.socle' | 'grille.line.bureau' | 'grille.line.compte' | 'grille.line.premium'
const LIGNE_KEY: Record<LigneCode, LigneKey> = {
  socle: 'grille.line.socle', bureau: 'grille.line.bureau', compte: 'grille.line.compte', premium: 'grille.line.premium',
}

export function Souscrire() {
  const { t, locale, setLocale, formatMoney, formatNumber } = useI18n()
  const [step, setStep] = useState<'formulaire' | 'fini'>('formulaire')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [f, setF] = useState({
    agencyName: '', contactName: '', phone: '', email: '',
    country: 'Tunisie', city: '',
    visas: true, fret: false,
    teamSize: '', offices: '1', monthlyCases: '', currentTool: '', note: '',
  })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }))

  const pays = PAYS.find((p) => p.value === f.country) ?? PAYS[0]
  const devise = pays.devise

  // La grille dans la devise du pays. Elle se relit quand la devise change,
  // et un échec n'empêche pas d'envoyer la demande : l'estimation devient un
  // message, le formulaire reste.
  const [grille, setGrille] = useState<{ devise: Currency; plans: PublicPlan[] } | null>(null)
  const [grilleEtat, setGrilleEtat] = useState<'chargement' | 'pret' | 'erreur'>('chargement')
  useEffect(() => {
    if (!HAS_BACKEND) { setGrilleEtat('erreur'); return }
    let vivant = true
    setGrilleEtat('chargement')
    loadPublicPlans(devise)
      .then((plans) => { if (vivant) { setGrille({ devise, plans }); setGrilleEtat('pret') } })
      .catch(() => { if (vivant) setGrilleEtat('erreur') })
    return () => { vivant = false }
  }, [devise])

  const users = Number(f.teamSize) || 0
  const bureaux = Math.max(1, Number(f.offices) || 1)
  const estimation = useMemo(
    () => (grille && grille.devise === devise && users > 0 ? estimer(grille.plans, users, bureaux) : null),
    [grille, devise, users, bureaux],
  )
  const essai = grille?.plans.find((p) => p.code === 'essai')
  const premium = grille?.plans.find((p) => p.code === 'premium')

  // L'e-mail est obligatoire : c'est l'identifiant de connexion du compte
  // qu'on ouvrira au propriétaire. Sans lui, l'agence ne pourrait pas entrer.
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())
  const valide = f.agencyName.trim() !== '' && f.contactName.trim() !== '' && f.phone.trim().length >= 8 && emailOk

  const envoyer = async () => {
    setError('')
    if (!HAS_BACKEND) {
      // Sans backend branché, la demande n'irait NULLE PART. Afficher « c'est
      // envoyé » ferait remplir le formulaire dans le vide, et l'agence
      // attendrait un rappel qui ne viendrait jamais. On le dit.
      setError(t('sub.demoOnly'))
      return
    }
    setBusy(true)
    try {
      await rpc('request_agency_signup', {
        p_agency_name: f.agencyName.trim(),
        p_contact_name: f.contactName.trim(),
        p_phone: f.phone.trim(),
        p_email: f.email.trim().toLowerCase(),
        p_country: f.country,
        p_city: f.city.trim() || null,
        p_services: [f.visas ? 'visas' : null, f.fret ? 'fret' : null].filter(Boolean),
        p_team_size: users || null,
        p_monthly_cases: Number(f.monthlyCases) || null,
        p_current_tool: f.currentTool.trim() || null,
        // Le nombre de bureaux n'a pas de colonne dans la demande : il part
        // dans la note, où le commercial le lira avant d'appeler.
        p_note: [bureaux > 1 ? `${t('grille.offices')} ${bureaux}` : null, f.note.trim() || null].filter(Boolean).join('\n') || null,
        p_locale: locale,
      })
      setStep('fini')
    } catch (e) {
      setError(e instanceof Error ? e.message : t('sync.ecriture'))
    } finally {
      setBusy(false)
    }
  }

  const argent = (n: number) => formatMoney(n, devise)

  return (
    <div className="portal">
      <header className="portal__bar">
        <Link to="/" className="row gap-2" style={{ color: 'inherit' }}>
          <span className="sidebar__mark" style={{ background: 'var(--blue)' }}>VF</span>
          <span className="t-medium">VisaFlow</span>
        </Link>
        <span className="grow" />
        <Select
          aria-label={t('misc.language')}
          value={locale}
          onChange={(e) => setLocale(e.target.value as Locale)}
          style={{ width: 'auto', minHeight: 32 }}
        >
          {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_META[l].native}</option>)}
        </Select>
      </header>

      <main className="portal__main">
        {step === 'fini' ? (
          <>
            <div className="portal__hero">
              <Illustration scene="termine" size={140} />
              <h1>{t('sub.doneTitle')}</h1>
              <p>{t('sub.doneHint')}</p>
            </div>
            <Card>
              <p className="t-small t-secondary" style={{ margin: 0 }}>{t('sub.doneWhat')}</p>
            </Card>
          </>
        ) : (
          <>
            <div className="portal__hero">
              <h1>{t('sub.title')}</h1>
              <p>{t('sub.subtitle')}</p>
            </div>

            <Card>
              <div className="col gap-5">
                <div className="grid grid--2">
                  <Field label={t('sub.agencyName')}>
                    <Input value={f.agencyName} onChange={(e) => set('agencyName', e.target.value)} />
                  </Field>
                  <Field label={t('sub.country')}>
                    <Select value={f.country} onChange={(e) => set('country', e.target.value)}>
                      {PAYS.map((p) => <option key={p.value} value={p.value}>{p.value}</option>)}
                    </Select>
                  </Field>
                  <Field label={t('sub.city')}>
                    <Input value={f.city} onChange={(e) => set('city', e.target.value)} />
                  </Field>
                  <Field label={t('sub.contactName')}>
                    <Input value={f.contactName} onChange={(e) => set('contactName', e.target.value)} />
                  </Field>
                  {/* Le téléphone d'abord : c'est par là qu'une agence se joint. */}
                  <Field label={t('sub.phone')} hint={t('sub.phoneHint')}>
                    <Input type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
                  </Field>
                  <Field label={t('sub.email')} hint={t('sub.emailHint')}>
                    <Input type="email" required value={f.email} onChange={(e) => set('email', e.target.value)} />
                  </Field>
                </div>

                <div className="col gap-2">
                  <span className="t-caption t-tertiary">{t('sub.services')}</span>
                  <div className="row gap-2">
                    <button type="button" className={`btn ${f.visas ? 'btn--primary' : 'btn--secondary'} btn--sm`} onClick={() => set('visas', !f.visas)}>
                      {t('sub.visas')}
                    </button>
                    <button type="button" className={`btn ${f.fret ? 'btn--primary' : 'btn--secondary'} btn--sm`} onClick={() => set('fret', !f.fret)}>
                      {t('sub.fret')}
                    </button>
                  </div>
                </div>

                <div className="grid grid--2">
                  <Field label={t('grille.people')} hint={t('sub.teamSizeHint')}>
                    <Input type="number" min={1} value={f.teamSize} onChange={(e) => set('teamSize', e.target.value)} />
                  </Field>
                  <Field label={t('grille.offices')} hint={t('grille.officesHint')}>
                    <Input type="number" min={1} value={f.offices} onChange={(e) => set('offices', e.target.value)} />
                  </Field>
                  <Field label={t('sub.monthlyCases')}>
                    <Input type="number" min={0} value={f.monthlyCases} onChange={(e) => set('monthlyCases', e.target.value)} />
                  </Field>
                  <Field label={t('sub.currentTool')} hint={t('sub.currentToolHint')}>
                    <Input value={f.currentTool} onChange={(e) => set('currentTool', e.target.value)} />
                  </Field>
                </div>

                <Field label={t('sub.note')}>
                  <Textarea value={f.note} onChange={(e) => set('note', e.target.value)} placeholder={t('sub.notePlaceholder')} />
                </Field>

                {/* Le prix s'affiche pendant la saisie. Une agence qui le
                    découvre après trois échanges se sent piégée. */}
                {users > 0 && grilleEtat === 'erreur' && (
                  <p className="schengen__note" style={{ margin: 0 }}>
                    <Icon name="alert" size={14} />
                    <span>{t('grille.error')}</span>
                  </p>
                )}
                {users > 0 && grilleEtat === 'chargement' && (
                  <p className="schengen__note" style={{ margin: 0 }}>
                    <Icon name="sparkle" size={14} />
                    <span>{t('grille.loading')}</span>
                  </p>
                )}
                {estimation && (
                  <div className="schengen__note" style={{ margin: 0, flexDirection: 'column', gap: 'var(--sp-2)' }}>
                    <div className="row gap-2" style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <Icon name="sparkle" size={14} />
                      <span className="t-caption t-tertiary">{t('grille.recommended')}</span>
                      <span className="t-medium" style={{ color: 'var(--text-primary)' }}>
                        {t(estimation.conseille === 'active' ? 'grille.formule.active' : 'grille.formule.premium')}
                      </span>
                      <span className="grow" />
                      <span className="t-medium t-num" style={{ color: 'var(--text-primary)' }}>{t('grille.perMonth', { amount: argent(estimation.mensuel) })}</span>
                      <span className="t-num">{t('grille.perYear', { amount: argent(estimation.annuel) })}</span>
                    </div>

                    {estimation.conseille === 'devis' && premium && (
                      <span>{t('grille.devis', { users: formatNumber(premium.fair_use_users ?? users), offices: formatNumber(premium.fair_use_offices ?? bureaux) })}</span>
                    )}
                    {estimation.conseille === 'premium' && estimation.activeMensuel !== null && (
                      <span>{t('grille.premiumWhy', { active: argent(estimation.activeMensuel) })}</span>
                    )}

                    {estimation.conseille === 'active' && (
                      <div className="col gap-1">
                        <span className="t-caption t-tertiary">{t('grille.detail')}</span>
                        {estimation.lignes.map((l) => (
                          <span key={l.label} className="row gap-2" style={{ alignItems: 'baseline' }}>
                            <span>{t(LIGNE_KEY[l.label])}</span>
                            <span className="t-caption t-tertiary">{t('grille.lineQty', { n: formatNumber(l.quantite), price: argent(l.unitaire) })}</span>
                            <span className="grow" />
                            <span className="t-num">{argent(l.total)}</span>
                          </span>
                        ))}
                      </div>
                    )}

                    <span className="t-caption t-tertiary">
                      {t('grille.ht')}
                      {pays.fcfa ? ` ${t('grille.fcfa', { amount: formatNumber(Math.round(estimation.annuel * FCFA_PAR_EUR)) })}` : ''}
                    </span>

                    {estimation.alternative && (
                      <span className="t-caption">
                        {t('grille.alternative', { month: argent(estimation.alternative.mensuel), year: argent(estimation.alternative.annuel) })}
                      </span>
                    )}
                    {essai && essai.trial_days > 0 && (
                      <span className="t-caption">{t('grille.trial', { days: formatNumber(essai.trial_days) })}</span>
                    )}
                  </div>
                )}

                {error && <p className="t-small" style={{ color: 'var(--red)', margin: 0 }}>{error}</p>}

                <div className="row-between wrap gap-3">
                  <span className="t-caption t-tertiary" style={{ maxWidth: 380 }}>{t('sub.noCard')}</span>
                  <Button variant="primary" size="lg" disabled={!valide || busy} onClick={() => void envoyer()}>
                    {t('sub.send')}
                  </Button>
                </div>
              </div>
            </Card>
          </>
        )}

        <p className="t-caption t-tertiary" style={{ textAlign: 'center', marginTop: 'var(--sp-6)' }}>
          {t('portal.poweredBy')}
        </p>
      </main>
    </div>
  )
}
