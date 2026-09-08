import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '@/data/store'
import { HAS_BACKEND } from '@/lib/supabase'
import { rpc } from '@/data/remote'
import { usePublicAgency } from './usePublicAgency'
import { useI18n, LOCALES, LOCALE_META } from '@/i18n'
import { Button, Card, Field, Input, Pill, Select, Textarea } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { Illustration } from '@/components/Illustration'
import { checkCode, issueCode, rememberDevice } from '@/data/identity'
import type { Locale } from '@/data/types'

type Step = 'formulaire' | 'code' | 'fini'

/* Le formulaire de demande. Trois écrans, jamais plus.
   Le numéro est confirmé par un code dès la première seconde : c'est ce qui
   distingue une vraie demande d'un formulaire rempli au hasard, et c'est ce qui
   permettra au client de revenir sans compte. */
export function AskForm() {
  const { slug, actions } = useStore()
  const { t, tt, locale, setLocale } = useI18n()
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>('formulaire')
  // La devanture vient du serveur : sans elle, le formulaire proposait des
  // types de visa de démonstration, avec des identifiants que la base refuse.
  const vitrine = usePublicAgency(slug)
  const ag = vitrine.status === 'ok' ? vitrine.agency : null
  const services = ag?.services ?? []
  const visaTypes = ag?.visaTypes ?? []

  const [kind, setKind] = useState<'visa' | 'fret'>('visa')
  const [visaTypeId, setVisaTypeId] = useState('')

  // Le premier visa proposé, dès que la devanture est arrivée.
  useEffect(() => {
    if (!ag) return
    setKind((k) => (services.includes(k === 'visa' ? 'visas' : 'fret') ? k : services.includes('visas') ? 'visa' : 'fret'))
    setVisaTypeId((id) => (id && visaTypes.some((v) => v.id === id) ? id : visaTypes[0]?.id ?? ''))
  }, [ag])
  const [travelDate, setTravelDate] = useState('')
  const [goods, setGoods] = useState('')
  const [originCity, setOriginCity] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [code, setCode] = useState('')
  const [issued, setIssued] = useState('')
  const [error, setError] = useState('')
  const [reference, setReference] = useState('')
  const [token, setToken] = useState('')

  const canSend = firstName.trim() && lastName.trim() && phone.trim().length >= 8 &&
    (kind === 'visa' ? Boolean(visaTypeId) : goods.trim().length > 0)

  const [busy, setBusy] = useState(false)
  const [undeliverable, setUndeliverable] = useState(false)

  /**
   * Le code de vérification. Avec un backend, il part par le serveur : le code
   * n'existe nulle part dans le navigateur, seul son empreinte est en base.
   * Sans backend, la démonstration le fabrique en local.
   */
  const sendCode = async () => {
    setError('')
    setUndeliverable(false)
    if (!HAS_BACKEND) {
      setIssued(issueCode(slug, phone))
      setStep('code')
      return
    }
    setBusy(true)
    try {
      const r = await rpc('issue_otp', { p_agency_slug: slug, p_phone: phone.trim(), p_purpose: 'demande' }) as
        { deliverable?: boolean } | null
      // Un prospect n'a jamais de fenêtre WhatsApp de 24 heures : sans modèle
      // approuvé chez Meta, le code reste bloqué en file. Le dire tout de suite
      // vaut mieux que de laisser le visiteur attendre un message qui ne
      // viendra pas.
      if (r && r.deliverable === false) setUndeliverable(true)
      setStep('code')
    } catch (e) {
      setError(e instanceof Error ? e.message : t('ask.codeWrong'))
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    setError('')
    const visa = visaTypes.find((v) => v.id === visaTypeId)

    if (!HAS_BACKEND) {
      if (!checkCode(slug, phone, code)) { setError(t('ask.codeWrong')); return }
      rememberDevice(slug, phone)
      const request = actions.submitRequest({
        kind,
        visaTypeId: kind === 'visa' ? visaTypeId : undefined,
        destination: kind === 'visa' ? visa?.country.fr : undefined,
        travelDate: travelDate ? new Date(travelDate).toISOString() : undefined,
        goods: kind === 'fret' ? goods.trim() : undefined,
        originCity: kind === 'fret' ? originCity.trim() : undefined,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        locale,
        note: note.trim() || undefined,
        phoneVerified: true,
      })
      setReference(request.reference)
      setToken(request.portalToken)
      setStep('fini')
      return
    }

    setBusy(true)
    try {
      // Le code se vérifie EN BASE. Le navigateur ne décide pas s'il est bon.
      const v = await rpc('verify_otp', {
        p_agency_slug: slug, p_phone: phone.trim(), p_code: code.trim(), p_platform: 'web',
      }) as { ok?: boolean; reason?: string } | null
      if (!v?.ok) {
        setError(v?.reason === 'expire' ? t('ask.codeExpired')
          : v?.reason === 'bloque' ? t('ask.codeBlocked')
          : t('ask.codeWrong'))
        return
      }
      rememberDevice(slug, phone)
      const r = await rpc('portal_submit_request', {
        p_agency_slug: slug,
        p_kind: kind,
        p_visa_type: kind === 'visa' ? visaTypeId : null,
        p_travel: travelDate || null,
        p_goods: kind === 'fret' ? goods.trim() : null,
        p_origin: kind === 'fret' ? originCity.trim() : null,
        p_first: firstName.trim(),
        p_last: lastName.trim(),
        p_phone: phone.trim(),
        p_locale: locale,
        p_note: note.trim() || null,
        // Le serveur ne fait aucune confiance à ce drapeau : il impose
        // lui-même « non vérifié ». On l'envoie par respect de la signature.
        p_verified: true,
      }) as { reference?: string; token?: string } | null
      setReference(r?.reference ?? '')
      setToken(r?.token ?? '')
      setStep('fini')
    } catch (e) {
      setError(e instanceof Error ? e.message : t('ask.codeWrong'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="portal">
      <header className="portal__bar">
        <Link to="/agence" className="row gap-2" style={{ color: 'inherit' }}>
          <span className="sidebar__mark" style={{ background: ag?.accent }}>{ag?.mark}</span>
          <span className="t-medium t-truncate">{ag?.name ?? ''}</span>
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
        {step === 'formulaire' && (
          <>
            <div className="portal__hero">
              <h1>{t('ask.title')}</h1>
              <p>{t('ask.subtitle')}</p>
            </div>

            <div className="stack">
              <Card title={t('ask.what')}>
                <div className="col gap-4">
                  <div className="row gap-2 wrap">
                    {services.includes('visas') && (
                      <button type="button" className="chip" aria-pressed={kind === 'visa'} onClick={() => setKind('visa')}>
                        <Icon name="passport" size={15} /> {t('ask.visa')}
                      </button>
                    )}
                    {services.includes('fret') && (
                      <button type="button" className="chip" aria-pressed={kind === 'fret'} onClick={() => setKind('fret')}>
                        <Icon name="ship" size={15} /> {t('ask.freight')}
                      </button>
                    )}
                  </div>

                  {kind === 'visa' ? (
                    <div className="grid grid--2">
                      <Field label={t('ask.destination')}>
                        <Select value={visaTypeId} onChange={(e) => setVisaTypeId(e.target.value)}>
                          {visaTypes.map((v) => (
                            <option key={v.id} value={v.id}>{tt(v.country)} · {tt(v.label)}</option>
                          ))}
                        </Select>
                      </Field>
                      <Field label={t('ask.travelWhen')}>
                        <Input type="date" value={travelDate} onChange={(e) => setTravelDate(e.target.value)} />
                      </Field>
                    </div>
                  ) : (
                    <div className="grid grid--2">
                      <Field label={t('ask.goods')}>
                        <Input value={goods} onChange={(e) => setGoods(e.target.value)} />
                      </Field>
                      <Field label={t('ask.fromWhere')}>
                        <Input value={originCity} onChange={(e) => setOriginCity(e.target.value)} placeholder="Guangzhou" />
                      </Field>
                    </div>
                  )}
                </div>
              </Card>

              <Card title={t('ask.identity')}>
                <div className="col gap-4">
                  <div className="grid grid--2">
                    <Field label={t('ask.firstName')}><Input value={firstName} onChange={(e) => setFirstName(e.target.value)} /></Field>
                    <Field label={t('ask.lastName')}><Input value={lastName} onChange={(e) => setLastName(e.target.value)} /></Field>
                  </div>
                  <Field label={t('ask.phone')} hint={t('ask.phoneHint')}>
                    <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+216 …" />
                  </Field>
                  <Field label={t('ask.language')}>
                    <Select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
                      {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_META[l].native}</option>)}
                    </Select>
                  </Field>
                  <Field label={t('ask.note')}>
                    <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
                  </Field>
                  <Button variant="primary" size="lg" block disabled={!canSend || busy} onClick={() => void sendCode()}>
                    {t('ask.send')}
                  </Button>
                </div>
              </Card>
            </div>
          </>
        )}

        {step === 'code' && undeliverable && (
          /* Le code est en file mais ne peut pas partir : l'agence n'a pas de
             compte WhatsApp branché, ou pas de modèle approuvé chez Meta. Le
             visiteur doit le savoir maintenant, pas dans une demi-heure. */
          <p className="fret__warn" style={{ maxWidth: 420, margin: '0 auto var(--sp-4)' }}>
            <span>{t('ask.codeUndeliverable')}</span>
          </p>
        )}
        {step === 'code' && (
          <>
            <div className="portal__hero">
              <Illustration scene="message" size={140} />
              <h1>{t('ask.codeTitle')}</h1>
              <p>{t('ask.codeSent', { phone })}</p>
            </div>
            <Card>
              <div className="col gap-4">
                <Field label={t('ask.code')} error={error || undefined}>
                  <Input
                    inputMode="numeric"
                    maxLength={6}
                    value={code}
                    onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setError('') }}
                    onKeyDown={(e) => { if (e.key === 'Enter') void confirm() }}
                    style={{ fontSize: 24, letterSpacing: '0.3em', textAlign: 'center' }}
                  />
                </Field>
                <Pill tone="orange">{t('ask.codeDemo', { code: issued })}</Pill>
                <Button variant="primary" size="lg" block disabled={code.length < 6 || busy} onClick={() => void confirm()}>
                  {t('ask.verify')}
                </Button>
                <Button block disabled={busy} onClick={() => void sendCode()}>{t('ask.resend')}</Button>
              </div>
            </Card>
          </>
        )}

        {step === 'fini' && (
          <>
            <div className="portal__hero">
              <Illustration scene="termine" size={150} />
              <h1>{t('ask.sent')}</h1>
              <p>{t('ask.sentHint')}</p>
            </div>
            <Card>
              <div className="col gap-4">
                <div className="row-between">
                  <span className="t-small t-secondary">{t('ask.reference')}</span>
                  <span className="t-mono t-medium">{reference}</span>
                </div>
                <Button variant="primary" block onClick={() => navigate(`/portail/demande/${token}`)}>
                  {t('ask.track')}
                </Button>
              </div>
            </Card>
          </>
        )}
      </main>
    </div>
  )
}
