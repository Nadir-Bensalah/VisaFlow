import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '@/data/store'
import { HAS_BACKEND } from '@/lib/supabase'
import { rpc } from '@/data/remote'
import { fetchMyTracking, usePublicAgency, type MyTracking } from './usePublicAgency'
import { useI18n, LOCALES, LOCALE_META } from '@/i18n'
import { Button, Card, Empty, Field, Input, Pill, Select, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { Illustration } from '@/components/Illustration'
import { checkCode, forgetDevice, issueCode, knownDevice, rememberDevice, samePhone } from '@/data/identity'
import type { Locale } from '@/data/types'

/* Retrouver ses dossiers sans compte et sans lien.
   Le numero est la cle. Un code confirme l'appareil une fois, puis l'appareil
   est reconnu 90 jours : c'est ce qui rend le cout d'envoi tenable. */
export function FindMine() {
  const { db, slug } = useStore()
  const { t, tt, locale, setLocale } = useI18n()
  const navigate = useNavigate()
  const toast = useToast()

  const device = knownDevice(slug)
  const [phone, setPhone] = useState(device?.phone ?? '')
  const [step, setStep] = useState<'numero' | 'code' | 'liste'>(device ? 'liste' : 'numero')
  const [code, setCode] = useState('')
  const [issued, setIssued] = useState('')
  const [error, setError] = useState('')

  const known = step === 'liste' ? (device?.phone ?? phone) : phone
  const vitrine = usePublicAgency(slug)
  const ag = vitrine.status === 'ok' ? vitrine.agency : null
  const [busy, setBusy] = useState(false)
  const [mine, setMine] = useState<MyTracking | null>(null)

  /* La démonstration se sert du magasin local ; en réel, seul le serveur sait
     ce qui appartient à ce numéro, et il ne le dit qu'à un appareil vérifié. */
  const local: MyTracking = {
    cases: db.cases
      .filter((c) => samePhone(db.clients.find((x) => x.id === c.clientId)?.phone, known))
      .map((c) => {
        const v = db.visaTypes.find((x) => x.id === c.visaTypeId)
        return { reference: c.reference, stage: c.stage, status: c.status, token: c.portalToken, country: v?.country, label: v?.label }
      }),
    shipments: db.shipments
      .filter((sh) => db.lots.some((l) => l.shipmentId === sh.id && samePhone(db.clients.find((x) => x.id === l.clientId)?.phone, known))
        || samePhone(db.clients.find((x) => x.id === sh.clientId)?.phone, known))
      .map((sh) => ({ reference: sh.reference, stage: sh.stage, token: sh.portalToken, originPort: sh.originPort, destPort: sh.destPort, goods: sh.goods })),
    requests: db.requests
      .filter((r) => samePhone(r.phone, known) && r.status !== 'convertie')
      .map((r) => ({ reference: r.reference, status: r.status, kind: r.kind, token: r.portalToken, destination: r.destination, goods: r.goods })),
  }
  const liste = HAS_BACKEND ? (mine ?? { cases: [], shipments: [], requests: [] }) : local
  const cases = liste.cases
  const shipments = liste.shipments
  const requests = liste.requests

  // L'appareil déjà reconnu recharge sa liste tout seul.
  useEffect(() => {
    if (!HAS_BACKEND || step !== 'liste' || !device?.token) return
    let alive = true
    fetchMyTracking(slug, device.token).then((r) => { if (alive) setMine(r) }).catch(() => {})
    return () => { alive = false }
  }, [step, device?.token, slug])

  const start = async () => {
    setError('')
    if (!HAS_BACKEND) { setIssued(issueCode(slug, phone)); setStep('code'); return }
    setBusy(true)
    try {
      await rpc('issue_otp', { p_agency_slug: slug, p_phone: phone.trim(), p_purpose: 'suivi' })
      setStep('code')
    } catch (e) {
      setError(e instanceof Error ? e.message : t('ask.codeWrong'))
    } finally { setBusy(false) }
  }

  const confirm = async () => {
    if (!HAS_BACKEND) {
      if (!checkCode(slug, phone, code)) { setError(t('ask.codeWrong')); return }
      rememberDevice(slug, phone)
      setStep('liste')
      return
    }
    setBusy(true)
    try {
      // Le code se vérifie EN BASE, et c'est elle qui délivre le jeton
      // d'appareil : le navigateur ne s'auto-déclare pas vérifié.
      const v = await rpc('verify_otp', {
        p_agency_slug: slug, p_phone: phone.trim(), p_code: code.trim(), p_platform: 'web',
      }) as { ok?: boolean; reason?: string; device_token?: string } | null
      if (!v?.ok || !v.device_token) {
        setError(v?.reason === 'expire' ? t('ask.codeExpired')
          : v?.reason === 'bloque' ? t('ask.codeBlocked') : t('ask.codeWrong'))
        return
      }
      rememberDevice(slug, phone, v.device_token)
      setMine(await fetchMyTracking(slug, v.device_token))
      setStep('liste')
    } catch (e) {
      setError(e instanceof Error ? e.message : t('ask.codeWrong'))
    } finally { setBusy(false) }
  }

  const nothing = cases.length === 0 && shipments.length === 0 && requests.length === 0

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
        {step !== 'liste' && (
          <div className="portal__hero">
            <Illustration scene={step === 'code' ? 'message' : 'passeport'} size={140} />
            <h1>{t('find.title')}</h1>
            <p>{step === 'code' ? t('ask.codeSent', { phone }) : t('find.subtitle')}</p>
          </div>
        )}

        {step === 'numero' && (
          <Card>
            <div className="col gap-4">
              <Field label={t('find.phone')}>
                <Input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && phone.length >= 8 && !busy) void start() }}
                  placeholder="+216 …"
                />
              </Field>
              <Button variant="primary" size="lg" block disabled={phone.trim().length < 8 || busy} onClick={() => void start()}>
                {t('find.continue')}
              </Button>
              <p className="t-caption t-tertiary">{t('find.changedPhone')}</p>
            </div>
          </Card>
        )}

        {step === 'code' && (
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
              <Button variant="primary" size="lg" block disabled={code.length < 6 || busy} onClick={() => void confirm()}>
                {t('ask.verify')}
              </Button>
            </div>
          </Card>
        )}

        {step === 'liste' && (
          <div className="stack">
            <div className="portal__hero" style={{ paddingBottom: 0 }}>
              <h1>{t('find.yours')}</h1>
              <p className="t-mono t-small">{known}</p>
            </div>

            {nothing && (
              <Card>
                <Empty
                  title={t('find.nothing')}
                  hint={t('find.changedPhone')}
                  scene="vide"
                  action={
                    <a className="btn btn--primary" href={`https://wa.me/${db.agency.offices[0].phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer">
                      <Icon name="whatsapp" size={16} /> WhatsApp
                    </a>
                  }
                />
              </Card>
            )}

            {requests.length > 0 && (
              <Card title={t('find.yourRequests')} flush>
                <div className="list">
                  {requests.map((r) => (
                    <button key={r.token} type="button" className="list__row" onClick={() => navigate(`/portail/demande/${r.token}`)}>
                      <Icon name="documents" size={18} className="t-tertiary" />
                      <span className="col grow" style={{ minWidth: 0 }}>
                        <span className="t-small t-medium">{r.destination ?? r.goods}</span>
                        <span className="t-caption t-tertiary">{r.reference}</span>
                      </span>
                      <Pill tone={r.status === 'nouvelle' ? 'blue' : 'gray'} dot>{t(`inbox.${r.status === 'nouvelle' ? 'new' : r.status === 'qualifiee' ? 'qualified' : 'refused'}` as 'inbox.new')}</Pill>
                    </button>
                  ))}
                </div>
              </Card>
            )}

            {cases.length > 0 && (
              <Card title={t('portal.yourCase')} flush>
                <div className="list">
                  {cases.map((c) => {
                    return (
                      <button key={c.token} type="button" className="list__row" onClick={() => navigate(`/portail/${c.token}`)}>
                        <Icon name="passport" size={18} className="t-tertiary" />
                        <span className="col grow" style={{ minWidth: 0 }}>
                          <span className="t-small t-medium">{tt(c.country)} · {tt(c.label)}</span>
                          <span className="t-caption t-tertiary">{c.reference}</span>
                        </span>
                        <Pill tone="blue" dot>{t(`stage.${c.stage}` as 'stage.nouveau')}</Pill>
                      </button>
                    )
                  })}
                </div>
              </Card>
            )}

            {shipments.length > 0 && (
              <Card title={t('find.yourShipments')} flush>
                <div className="list">
                  {shipments.map((s) => (
                    <button key={s.token} type="button" className="list__row" onClick={() => navigate(`/portail/cargaison/${s.token}`)}>
                      <Icon name="ship" size={18} className="t-tertiary" />
                      <span className="col grow" style={{ minWidth: 0 }}>
                        <span className="t-small t-medium">{s.originPort} → {s.destPort}</span>
                        <span className="t-caption t-tertiary">{s.reference} · {tt(s.goods)}</span>
                      </span>
                      <Pill tone="violet" dot>{t(`ship.s.${s.stage}` as 'ship.s.transit')}</Pill>
                    </button>
                  ))}
                </div>
              </Card>
            )}

            <p className="t-caption t-tertiary" style={{ textAlign: 'center' }}>
              {t('find.remembered')}
              {' · '}
              <button
                type="button"
                className="t-caption"
                style={{ border: 0, background: 'transparent', color: 'var(--blue)', cursor: 'pointer' }}
                onClick={() => { forgetDevice(slug); setStep('numero'); setPhone(''); toast(t('find.forgotten')) }}
              >
                {t('find.forget')}
              </button>
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
