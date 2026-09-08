import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n, LOCALES, LOCALE_META } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { rpc } from '@/data/remote'
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
 *   · La grille doit être par unité d'œuvre, 45 DT par utilisateur et par mois,
 *     jamais un forfait sec, sinon la banque refuse le transfert (article 3 de
 *     la circulaire BCT 2016-09).
 *
 * Le prix se discute donc, il ne se clique pas. La page demande ce qu'il faut
 * pour chiffrer sans rappeler, et affiche l'estimation pendant la saisie : une
 * agence qui découvre le prix après trois échanges se sent piégée.
 */

const PRIX_UTILISATEUR_MOIS = 45

export function Souscrire() {
  const { t, locale, setLocale } = useI18n()
  const [step, setStep] = useState<'formulaire' | 'fini'>('formulaire')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [f, setF] = useState({
    agencyName: '', contactName: '', phone: '', email: '',
    country: 'Tunisie', city: '',
    visas: true, fret: false,
    teamSize: '', monthlyCases: '', currentTool: '', note: '',
  })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }))

  const users = Number(f.teamSize) || 0
  const estimation = users > 0 ? users * PRIX_UTILISATEUR_MOIS * 12 : 0
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
        p_note: f.note.trim() || null,
        p_locale: locale,
      })
      setStep('fini')
    } catch (e) {
      setError(e instanceof Error ? e.message : t('sync.ecriture'))
    } finally {
      setBusy(false)
    }
  }

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
                      <option>Tunisie</option>
                      <option>Libye</option>
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
                  <Field label={t('sub.teamSize')} hint={t('sub.teamSizeHint')}>
                    <Input type="number" min={1} value={f.teamSize} onChange={(e) => set('teamSize', e.target.value)} />
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
                {estimation > 0 && (
                  <p className="schengen__note" style={{ margin: 0 }}>
                    <Icon name="sparkle" size={14} />
                    <span>{t('sub.estimate', { users, month: users * PRIX_UTILISATEUR_MOIS, year: estimation })}</span>
                  </p>
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
