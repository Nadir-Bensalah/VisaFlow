import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n, LOCALES, LOCALE_META } from '@/i18n'
import { Button, Card, Field, Input, Pill, Select } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { Illustration } from '@/components/Illustration'
import { provisionAgency } from '@/data/provision'
import { slugAvailable, slugify } from '@/tenant'
import type { Locale, Service } from '@/data/types'

/* L'inscription d'une agence, en une page.
   Rien n'est demande qui ne serve pas tout de suite : le registre de commerce
   et le contrat viennent avant le premier vrai passeport, pas avant l'essai. */
export function Signup() {
  const { t, locale, setLocale, formatDate } = useI18n()
  const [agencyName, setAgencyName] = useState('')
  const [country, setCountry] = useState('Tunisie')
  const [services, setServices] = useState<Service[]>(['visas'])
  const [ownerName, setOwnerName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [ownerPhone, setOwnerPhone] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [slug, setSlug] = useState('')
  const [withDemoData, setWithDemoData] = useState(true)
  const [busy, setBusy] = useState(false)

  const proposed = slugTouched ? slug : slugify(agencyName)
  const available = proposed.length >= 3 && slugAvailable(proposed)
  const trialEnd = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + 15)
    return d.toISOString()
  }, [])

  const complete = agencyName.trim() && ownerName.trim() && ownerEmail.trim() && ownerPhone.trim() && available && services.length > 0

  const submit = () => {
    if (!complete) return
    setBusy(true)
    const { slug: created } = provisionAgency({
      agencyName: agencyName.trim(),
      country,
      services,
      ownerName: ownerName.trim(),
      ownerEmail: ownerEmail.trim(),
      ownerPhone: ownerPhone.trim(),
      slug: proposed,
      locale,
      withDemoData,
    })
    // Le magasin est lie a l'agence au montage : on recharge sur la nouvelle.
    window.location.href = `${import.meta.env.BASE_URL}?agency=${created}`
  }

  const toggleService = (service: Service) =>
    setServices((current) =>
      current.includes(service) ? current.filter((s) => s !== service) : [...current, service],
    )

  return (
    <div className="portal">
      <header className="portal__bar">
        <span className="sidebar__mark" style={{ background: 'var(--blue)' }}>VF</span>
        <span className="t-medium grow">VisaFlow</span>
        <Select
          aria-label={t('misc.language')}
          value={locale}
          onChange={(e) => setLocale(e.target.value as Locale)}
          style={{ width: 'auto', minHeight: 32 }}
        >
          {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_META[l].native}</option>)}
        </Select>
        <Link to="/connexion" className="btn btn--ghost btn--sm">{t('action.signIn')}</Link>
      </header>

      <main className="portal__main">
        <div className="portal__hero">
          <Illustration scene="equipe" size={150} />
          <h1>{t('signup.title')}</h1>
          <p>{t('signup.subtitle')}</p>
        </div>

        <div className="stack">
          <Card>
            <div className="col gap-5">
              <div className="grid grid--2">
                <Field label={t('signup.agencyName')}>
                  <Input value={agencyName} onChange={(e) => setAgencyName(e.target.value)} placeholder="Tunis Consulting" />
                </Field>
                <Field label={t('signup.country')}>
                  <Select value={country} onChange={(e) => setCountry(e.target.value)}>
                    <option>Tunisie</option>
                    <option>Libye</option>
                    <option>Algérie</option>
                    <option>Maroc</option>
                    <option>Chine</option>
                  </Select>
                </Field>
              </div>

              <Field label={t('signup.services')} hint={t('signup.servicesHint')}>
                <div className="row gap-2 wrap">
                  <button type="button" className="chip" aria-pressed={services.includes('visas')} onClick={() => toggleService('visas')}>
                    <Icon name="passport" size={15} /> {t('signup.visas')}
                  </button>
                  <button type="button" className="chip" aria-pressed={services.includes('fret')} onClick={() => toggleService('fret')}>
                    <Icon name="ship" size={15} /> {t('signup.freight')}
                  </button>
                </div>
              </Field>

              <hr className="divider" />

              <div className="grid grid--2">
                <Field label={t('signup.yourName')}>
                  <Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
                </Field>
                <Field label={t('signup.yourEmail')}>
                  <Input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
                </Field>
                <Field label={t('signup.yourPhone')}>
                  <Input value={ownerPhone} onChange={(e) => setOwnerPhone(e.target.value)} placeholder="+216 …" />
                </Field>
                <Field
                  label={t('signup.domain')}
                  hint={proposed ? `${proposed}.visaflow.app` : undefined}
                  error={proposed.length >= 3 && !available ? t('signup.domainTaken') : undefined}
                >
                  <Input
                    value={proposed}
                    onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)) }}
                  />
                </Field>
              </div>

              <div className="row-between">
                <span className="col">
                  <span className="t-small t-medium">{t('signup.withDemo')}</span>
                  <span className="t-caption t-tertiary">{t('signup.withDemoHint')}</span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={withDemoData}
                  aria-label={t('signup.withDemo')}
                  className="switch"
                  onClick={() => setWithDemoData((v) => !v)}
                />
              </div>

              <Button variant="primary" size="lg" block disabled={!complete || busy} onClick={submit}>
                {busy ? t('signup.creating') : t('signup.create')}
              </Button>
              <p className="t-caption t-tertiary" style={{ textAlign: 'center' }}>
                {t('signup.trial', { date: formatDate(trialEnd) })}
              </p>
            </div>
          </Card>

          <Card title={t('signup.included')}>
            <div className="col gap-3">
              {[
                { icon: 'documents' as const, text: t('signup.includedVisas') },
                { icon: 'ship' as const, text: t('signup.includedFreight') },
                { icon: 'messages' as const, text: t('signup.includedTemplates') },
                { icon: 'automations' as const, text: t('signup.includedRules') },
              ].map((line) => (
                <span key={line.text} className="row gap-3">
                  <Icon name={line.icon} size={17} className="t-tertiary" />
                  <span className="t-small">{line.text}</span>
                </span>
              ))}
              <div className="row gap-2" style={{ marginTop: 'var(--sp-2)' }}>
                <Pill tone="green" dot>{t('signup.trial', { date: formatDate(trialEnd) })}</Pill>
              </div>
            </div>
          </Card>
        </div>

        <p className="t-caption t-tertiary" style={{ textAlign: 'center', marginTop: 'var(--sp-6)' }}>
          {t('signup.already')} <Link to="/connexion">{t('action.signIn')}</Link>
        </p>
      </main>
    </div>
  )
}
