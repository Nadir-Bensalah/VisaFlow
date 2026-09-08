import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useI18n, LOCALES, LOCALE_META } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { Button, Card, Empty, Pill, Progress, Select, Textarea, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { FileDrop } from '@/components/FileDrop'
import { SchengenGauge } from '@/components/SchengenCard'
import { usePortalView, portalSendQuestion, portalUploadDoc } from './usePortalView'
import type { Locale } from '@/data/types'

/**
 * Le suivi client.
 *
 * La page rend depuis une forme unique, remplie par la fonction serveur
 * `portal_case` quand un backend existe, et par la démonstration sinon. Elle ne
 * sait pas d'où viennent ses données, et c'est exactement ce qu'on veut : il n'y
 * a qu'un rendu à tenir, donc un seul endroit où se tromper.
 */
export function PortalCase() {
  const { token = '' } = useParams()
  const { actions } = useStore()
  const { t, tt, locale, setLocale, formatDate, formatMoney } = useI18n()
  const toast = useToast()
  const [question, setQuestion] = useState('')
  const [sending, setSending] = useState(false)

  const result = usePortalView(token)

  if (result.status === 'chargement') {
    return (
      <div className="portal">
        <main className="portal__main">
          <div className="portal__hero"><p className="t-secondary">…</p></div>
        </main>
      </div>
    )
  }

  if (result.status === 'erreur') {
    return (
      <div className="portal">
        <main className="portal__main">
          <Empty
            title={t('sync.connexion')}
            hint={result.message}
            action={<Button onClick={() => window.location.reload()}>{t('sync.retry')}</Button>}
          />
        </main>
      </div>
    )
  }

  if (result.status === 'absent') {
    return (
      <div className="portal">
        <main className="portal__main">
          <Empty
            title={t('search.noResult')}
            hint={t('portal.noAccount')}
            action={<Link to="/portail" className="btn btn--secondary">{t('action.back')}</Link>}
          />
        </main>
      </div>
    )
  }

  const v = result.view
  const stages = v.visa.stages
  const currentIndex = stages.indexOf(v.case.stage)
  const missing = v.documents.filter((d) => ['manquante', 'demandee', 'refusee', 'expiree'].includes(d.state))
  const doneDocs = v.documents.filter((d) => d.required && (d.state === 'validee' || d.state === 'recue')).length
  const totalDocs = v.documents.filter((d) => d.required).length
  const due = v.payments.filter((p) => p.state !== 'regle').reduce((s, p) => s + p.amount, 0)

  const ask = async () => {
    const body = question.trim()
    if (!body) return
    setSending(true)
    try {
      if (HAS_BACKEND) await portalSendQuestion(token, body)
      else if (result.caseId) actions.sendMessage({ caseId: result.caseId, body, channel: 'portail', fromClient: true })
      setQuestion('')
      toast(t('msg.sent'))
      result.reload()
    } catch (e) {
      // Le client n'a pas de support technique : s'il ne voit rien, il appelle.
      toast(e instanceof Error ? e.message : t('sync.ecriture'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="portal">
      <header className="portal__bar">
        <span className="sidebar__mark" style={{ background: v.agency.accent }}>{v.agency.mark}</span>
        <span className="t-medium grow t-truncate">{v.agency.name}</span>
        <Select value={locale} onChange={(e) => setLocale(e.target.value as Locale)} style={{ width: 'auto', minHeight: 32 }}>
          {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_META[l].native}</option>)}
        </Select>
      </header>

      <main className="portal__main">
        <div className="portal__hero">
          <h1>{t('portal.hello', { name: v.client.firstName })}</h1>
          <p>{tt(v.visa.country)} · {tt(v.visa.label)}</p>
          <div className="row gap-3" style={{ justifyContent: 'center', marginTop: 'var(--sp-5)' }}>
            <Pill tone="blue" dot>{t('portal.step', { n: currentIndex + 1, total: stages.length })}</Pill>
            <span className="t-small t-tertiary t-mono">{v.case.reference}</span>
          </div>
        </div>

        <div className="stack">
          <Card title={t('portal.timeline')}>
            <div className="col gap-4">
              <Progress
                pct={Math.round(((currentIndex + 1) / Math.max(1, stages.length)) * 100)}
                tone={currentIndex + 1 === stages.length ? 'green' : undefined}
              />
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
                  <div key={d.key} className="row-between wrap gap-3" style={{ paddingBottom: 'var(--sp-3)', borderBottom: '1px solid var(--hairline)' }}>
                    <div className="col grow" style={{ minWidth: 0 }}>
                      <span className="t-medium t-small">{tt(d.label)}</span>
                      {d.rejectionReason && d.state === 'refusee' && (
                        <span className="t-caption" style={{ color: 'var(--red)' }}>{d.rejectionReason}</span>
                      )}
                    </div>
                    {/* Le geste naturel du client est la photo prise avec son
                        téléphone. Elle arrive ici, pas dans un fil WhatsApp. */}
                    <div style={{ minWidth: 200, flex: '1 1 200px' }}>
                      <FileDrop
                        scope="dossier"
                        id={d.id ?? d.key}
                        current={d.file}
                        // Avec un backend, la pièce part droit à la fonction de
                        // bord. En démonstration, elle reste dans le navigateur.
                        onUpload={HAS_BACKEND ? async (file) => {
                          await portalUploadDoc(token, d.key, file)
                          toast(t('file.uploaded'))
                          // Sans ça, la pièce resterait affichée comme manquante.
                          result.reload()
                        } : undefined}
                        onAttach={HAS_BACKEND || !d.id ? undefined : (f) => {
                          actions.attachFile(d.id as string, f, true)
                          toast(t('file.uploaded'))
                        }}
                        compact
                      />
                    </div>
                  </div>
                ))}
                <span className="t-caption t-tertiary">{t('caseDetail.completion', { done: doneDocs, total: totalDocs })}</span>
              </div>
            )}
          </Card>

          {/* Le compteur 90 jours sur 180. L'étude est nette : c'est la question
              client la plus fréquente depuis l'EES, et personne ne l'offre en
              Tunisie. Sa place naturelle est ici, chez le client lui-même. */}
          {v.stays.length > 0 && (
            <Card title={t('schengen.title')}>
              <SchengenGauge stays={v.stays} />
            </Card>
          )}

          {/* Le rang dans la file. Aucune agence tunisienne ne sait dire ça
              aujourd'hui, et c'est la première question du client. */}
          {!v.appointment && v.queue && v.queue.rank > 0 && (
            <Card title={t('slots.inQueue')}>
              <div className="col gap-2">
                <span className="t-display t-num">{v.queue.rank}</span>
                <span className="t-medium">
                  {t('slots.yourRank', {
                    rank: v.queue.rank, total: v.queue.total,
                    place: `${tt(v.queue.country)} · ${v.queue.city}`,
                  })}
                </span>
                {v.queue.waitDays > 0 && (
                  <span className="t-small t-secondary">{t('slots.realWait', { n: v.queue.waitDays })}</span>
                )}
              </div>
            </Card>
          )}

          {v.appointment && (
            <Card title={t('portal.yourAppointment')}>
              <div className="row-between wrap gap-4">
                <div className="col">
                  <span className="t-medium">{t(`appt.${v.appointment.kind}` as 'appt.agence')}</span>
                  <span className="t-small t-secondary">{v.appointment.location}</span>
                </div>
                <div className="col" style={{ textAlign: 'end' }}>
                  <span className="t-medium t-num">{formatDate(v.appointment.at, { weekday: 'long', day: '2-digit', month: 'long' })}</span>
                  <span className="t-small t-secondary t-num">
                    {new Date(v.appointment.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            </Card>
          )}

          {due > 0 && (
            <Card title={t('portal.yourPayments')}>
              <div className="col gap-3">
                {v.payments.map((pay, i) => (
                  <div key={i} className="row-between">
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
              {v.messages.length > 0 && (
                <div className="col gap-3">
                  {[...v.messages].reverse().map((m, i) => {
                    const rtl = locale === 'ar'
                    return (
                      <div
                        key={i}
                        dir={rtl ? 'rtl' : 'ltr'}
                        style={{
                          alignSelf: m.direction === 'sortant' ? 'flex-start' : 'flex-end',
                          maxWidth: '80%',
                          background: m.direction === 'sortant' ? 'var(--bg-hover)' : 'var(--tint-blue)',
                          borderRadius: 'var(--radius-card-sm)',
                          padding: 'var(--sp-3) var(--sp-4)',
                          textAlign: rtl ? 'right' : 'left',
                        }}
                      >
                        <p className="t-small" style={{ whiteSpace: 'pre-wrap' }}>{m.body}</p>
                      </div>
                    )
                  })}
                </div>
              )}
              <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t('portal.askQuestion')} />
              <div className="row-between">
                <span className="t-caption t-tertiary">{t('portal.weAnswer')}</span>
                <Button variant="primary" disabled={!question.trim() || sending} onClick={() => void ask()}>
                  {t('action.send')}
                </Button>
              </div>
            </div>
          </Card>

          {v.office && (
            <Card title={t('portal.contactAgency')}>
              <div className="col gap-3">
                <div className="row-between">
                  <span className="t-small t-secondary">{v.office.name}</span>
                  <span className="t-small">{v.office.address}</span>
                </div>
                {v.office.phone && (
                  <>
                    <div className="row-between">
                      <span className="t-small t-secondary">{t('clients.contact')}</span>
                      <span className="t-small t-mono">{v.office.phone}</span>
                    </div>
                    <div className="row gap-2" style={{ marginTop: 'var(--sp-2)' }}>
                      <a className="btn btn--secondary btn--sm" href={`https://wa.me/${v.office.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer">
                        <Icon name="whatsapp" size={16} /> WhatsApp
                      </a>
                      <a className="btn btn--secondary btn--sm" href={`tel:${v.office.phone.replace(/\s/g, '')}`}>
                        <Icon name="phone" size={16} /> {t('action.call')}
                      </a>
                    </div>
                  </>
                )}
              </div>
            </Card>
          )}

          <p className="t-caption t-tertiary" style={{ textAlign: 'center', marginTop: 'var(--sp-6)' }}>
            {t('portal.privacy')} · {t('portal.poweredBy')}
          </p>
        </div>
      </main>
    </div>
  )
}
