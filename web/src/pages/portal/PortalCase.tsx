import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useI18n, LOCALES, LOCALE_META } from '@/i18n'
import { Button, Card, Empty, Pill, Progress, Select, Textarea, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { progress } from '@/lib/derive'
import type { Locale } from '@/data/types'

export function PortalCase() {
  const { token = '' } = useParams()
  const { db, actions } = useStore()
  const { t, tt, locale, setLocale, formatDate, formatMoney } = useI18n()
  const toast = useToast()
  const [question, setQuestion] = useState('')

  const kase = db.cases.find((c) => c.portalToken === token)

  if (!kase) {
    return (
      <div className="portal">
        <main className="portal__main">
          <Empty title={t('search.noResult')} hint={t('portal.noAccount')} action={<Link to="/portail" className="btn btn--secondary">{t('action.back')}</Link>} />
        </main>
      </div>
    )
  }

  const client = db.clients.find((c) => c.id === kase.clientId)!
  const visa = db.visaTypes.find((v) => v.id === kase.visaTypeId)!
  const office = db.agency.offices.find((o) => o.id === kase.officeId)!
  const docs = db.documents.filter((d) => d.caseId === kase.id)
  const missing = docs.filter((d) => ['manquante', 'demandee', 'refusee', 'expiree'].includes(d.state))
  const appt = db.appointments.filter((a) => a.caseId === kase.id && a.status === 'prevu').sort((a, b) => a.at.localeCompare(b.at))[0]
  const payments = db.payments.filter((p) => p.caseId === kase.id)
  const due = payments.filter((p) => p.state !== 'regle').reduce((s, p) => s + p.amount, 0)
  // Jamais de canal interne dans le portail : ce sont des notes d'equipe.
  const messages = db.messages
    .filter((m) => m.caseId === kase.id && m.channel !== 'interne')
    .slice(-6)
  const stages = visa.stages
  const currentIndex = stages.indexOf(kase.stage)
  const p = progress(db, kase.id)

  return (
    <div className="portal">
      <header className="portal__bar">
        <span className="sidebar__mark" style={{ background: db.agency.accent }}>{db.agency.mark}</span>
        <span className="t-medium grow t-truncate">{db.agency.name}</span>
        <Select value={locale} onChange={(e) => setLocale(e.target.value as Locale)} style={{ width: 'auto', minHeight: 32 }}>
          {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_META[l].native}</option>)}
        </Select>
      </header>

      <main className="portal__main">
        <div className="portal__hero">
          <h1>{t('portal.hello', { name: client.firstName })}</h1>
          <p>{tt(visa.country)} · {tt(visa.label)}</p>
          <div className="row gap-3" style={{ justifyContent: 'center', marginTop: 'var(--sp-5)' }}>
            <Pill tone="blue" dot>{t('portal.step', { n: currentIndex + 1, total: stages.length })}</Pill>
            <span className="t-small t-tertiary t-mono">{kase.reference}</span>
          </div>
        </div>

        <div className="stack">
          <Card title={t('portal.timeline')}>
            <div className="col gap-4">
              <Progress pct={Math.round(((currentIndex + 1) / stages.length) * 100)} tone={currentIndex + 1 === stages.length ? 'green' : undefined} />
              <ul className="timeline">
                {stages.map((s, i) => (
                  <li key={s} className="timeline__item">
                    <span className={`timeline__dot ${i < currentIndex ? 'timeline__dot--done' : i === currentIndex ? 'timeline__dot--current' : ''}`} />
                    <span className={i === currentIndex ? 't-medium' : 't-secondary'} style={{ fontSize: 14 }}>
                      {t(`stage.${s}` as 'stage.nouveau')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          <Card title={t('portal.whatWeNeed')}>
            {missing.length === 0 ? (
              <div className="row gap-3">
                <Icon name="check" size={20} style={{ color: 'var(--green)' }} />
                <span className="t-medium">{t('portal.allGood')}</span>
              </div>
            ) : (
              <div className="col gap-4">
                <p className="t-small t-secondary">{t('portal.uploadHint')}</p>
                {missing.map((d) => (
                  <div key={d.id} className="row-between wrap gap-3" style={{ paddingBottom: 'var(--sp-3)', borderBottom: '1px solid var(--hairline)' }}>
                    <div className="col grow" style={{ minWidth: 0 }}>
                      <span className="t-medium t-small">{tt(d.label)}</span>
                      {d.rejectionReason && d.state === 'refusee' && (
                        <span className="t-caption" style={{ color: 'var(--red)' }}>{d.rejectionReason}</span>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="primary"
                      icon="upload"
                      onClick={() => { actions.setDocState(d.id, 'recue'); toast(t('action.upload')) }}
                    >
                      {t('action.upload')}
                    </Button>
                  </div>
                ))}
                <span className="t-caption t-tertiary">{t('caseDetail.completion', { done: p.done, total: p.total })}</span>
              </div>
            )}
          </Card>

          {appt && (
            <Card title={t('portal.yourAppointment')}>
              <div className="row-between wrap gap-4">
                <div className="col">
                  <span className="t-medium">{t(`appt.${appt.kind}` as 'appt.agence')}</span>
                  <span className="t-small t-secondary">{appt.location}</span>
                </div>
                <div className="col" style={{ textAlign: 'end' }}>
                  <span className="t-medium t-num">{formatDate(appt.at, { weekday: 'long', day: '2-digit', month: 'long' })}</span>
                  <span className="t-small t-secondary t-num">{new Date(appt.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </div>
            </Card>
          )}

          {due > 0 && (
            <Card title={t('portal.yourPayments')}>
              <div className="col gap-3">
                {payments.map((pay) => (
                  <div key={pay.id} className="row-between">
                    <span className="t-small">{tt(pay.label)}</span>
                    <span className="row gap-3">
                      <span className="t-small t-num">{formatMoney(pay.amount)}</span>
                      <Pill tone={pay.state === 'regle' ? 'green' : 'orange'} dot>{t(`payment.${pay.state}` as 'payment.du')}</Pill>
                    </span>
                  </div>
                ))}
                <p className="t-caption t-tertiary">{t('pay.subtitle')}</p>
              </div>
            </Card>
          )}

          <Card title={t('portal.askQuestion')}>
            <div className="col gap-4">
              {messages.length > 0 && (
                <div className="col gap-3">
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      style={{
                        alignSelf: m.direction === 'sortant' ? 'flex-start' : 'flex-end',
                        maxWidth: '80%',
                        background: m.direction === 'sortant' ? 'var(--bg-hover)' : 'var(--tint-blue)',
                        borderRadius: 'var(--radius-card-sm)',
                        padding: 'var(--sp-3) var(--sp-4)',
                      }}
                    >
                      <p className="t-small" style={{ whiteSpace: 'pre-wrap' }}>{m.body}</p>
                    </div>
                  ))}
                </div>
              )}
              <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t('portal.askQuestion')} />
              <div className="row-between">
                <span className="t-caption t-tertiary">{t('portal.weAnswer')}</span>
                <Button
                  variant="primary"
                  disabled={!question.trim()}
                  onClick={() => { actions.sendMessage({ caseId: kase.id, body: question.trim(), channel: 'portail' }); setQuestion(''); toast(t('msg.sent')) }}
                >
                  {t('action.send')}
                </Button>
              </div>
            </div>
          </Card>

          <Card title={t('portal.contactAgency')}>
            <div className="col gap-3">
              <div className="row-between"><span className="t-small t-secondary">{office.name}</span><span className="t-small">{office.address}</span></div>
              <div className="row-between"><span className="t-small t-secondary">{t('clients.contact')}</span><span className="t-small t-mono">{office.phone}</span></div>
              <div className="row gap-2" style={{ marginTop: 'var(--sp-2)' }}>
                <a className="btn btn--secondary btn--sm" href={`https://wa.me/${office.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer">
                  <Icon name="whatsapp" size={16} /> WhatsApp
                </a>
                <a className="btn btn--secondary btn--sm" href={`tel:${office.phone.replace(/\s/g, '')}`}>
                  <Icon name="phone" size={16} /> {t('action.call')}
                </a>
              </div>
            </div>
          </Card>

          <p className="t-caption t-tertiary" style={{ textAlign: 'center', marginTop: 'var(--sp-6)' }}>
            {t('portal.privacy')} · {t('portal.poweredBy')}
          </p>
        </div>
      </main>
    </div>
  )
}
