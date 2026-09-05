import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '@/data/store'
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
  const { db, slug, actions } = useStore()
  const { t, tt, locale, setLocale } = useI18n()
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>('formulaire')
  const [kind, setKind] = useState<'visa' | 'fret'>(db.agency.services.includes('visas') ? 'visa' : 'fret')
  const [visaTypeId, setVisaTypeId] = useState(db.visaTypes.find((v) => v.active)?.id ?? '')
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

  const sendCode = () => {
    setIssued(issueCode(slug, phone))
    setError('')
    setStep('code')
  }

  const confirm = () => {
    if (!checkCode(slug, phone, code)) {
      setError(t('ask.codeWrong'))
      return
    }
    rememberDevice(slug, phone)
    const visa = db.visaTypes.find((v) => v.id === visaTypeId)
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
  }

  return (
    <div className="portal">
      <header className="portal__bar">
        <Link to="/agence" className="row gap-2" style={{ color: 'inherit' }}>
          <span className="sidebar__mark" style={{ background: db.agency.accent }}>{db.agency.mark}</span>
          <span className="t-medium t-truncate">{db.agency.name}</span>
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
                    {db.agency.services.includes('visas') && (
                      <button type="button" className="chip" aria-pressed={kind === 'visa'} onClick={() => setKind('visa')}>
                        <Icon name="passport" size={15} /> {t('ask.visa')}
                      </button>
                    )}
                    {db.agency.services.includes('fret') && (
                      <button type="button" className="chip" aria-pressed={kind === 'fret'} onClick={() => setKind('fret')}>
                        <Icon name="ship" size={15} /> {t('ask.freight')}
                      </button>
                    )}
                  </div>

                  {kind === 'visa' ? (
                    <div className="grid grid--2">
                      <Field label={t('ask.destination')}>
                        <Select value={visaTypeId} onChange={(e) => setVisaTypeId(e.target.value)}>
                          {db.visaTypes.filter((v) => v.active).map((v) => (
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
                  <Button variant="primary" size="lg" block disabled={!canSend} onClick={sendCode}>
                    {t('ask.send')}
                  </Button>
                </div>
              </Card>
            </div>
          </>
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
                    onKeyDown={(e) => e.key === 'Enter' && confirm()}
                    style={{ fontSize: 24, letterSpacing: '0.3em', textAlign: 'center' }}
                  />
                </Field>
                <Pill tone="orange">{t('ask.codeDemo', { code: issued })}</Pill>
                <Button variant="primary" size="lg" block disabled={code.length < 6} onClick={confirm}>
                  {t('ask.verify')}
                </Button>
                <Button block onClick={() => setIssued(issueCode(slug, phone))}>{t('ask.resend')}</Button>
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
