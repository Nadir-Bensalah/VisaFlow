import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n, LOCALES } from '@/i18n'
import { Avatar, Card, Empty, Pill, Segmented } from '@/components/ui'
import { Ago, PageHead } from '@/components/bits'
import { Icon } from '@/components/Icon'
import { clientName } from '@/lib/derive'

type View = 'tous' | 'entrants' | 'automatiques'

export function Messages() {
  const { db } = useStore()
  const v = useVisible()
  const { t, tt } = useI18n()
  const navigate = useNavigate()
  const [view, setView] = useState<View>('tous')

  /* Une conversation par dossier, avec le dernier message en tete :
     c'est la vue qui remplace le fil WhatsApp de l'agence. */
  const threads = useMemo(() => {
    const byCase = new Map<string, typeof db.messages>()
    v.messages.forEach((m) => {
      const list = byCase.get(m.caseId) ?? []
      list.push(m)
      byCase.set(m.caseId, list)
    })
    return [...byCase.entries()]
      .map(([caseId, list]) => {
        const sorted = [...list].sort((a, b) => b.at.localeCompare(a.at))
        return { caseId, last: sorted[0], count: list.length, unread: sorted[0].direction === 'entrant' }
      })
      .filter((x) => (view === 'entrants' ? x.unread : view === 'automatiques' ? x.last.automated : true))
      .sort((a, b) => b.last.at.localeCompare(a.last.at))
  }, [db, v.messages, view])

  return (
    <>
      <PageHead title={t('msg.title')} subtitle={t('msg.subtitle')} />

      <div className="grid grid--main">
        <Card flush>
          <div className="row" style={{ padding: 'var(--sp-4) var(--sp-6)', borderBottom: '1px solid var(--hairline)' }}>
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: 'tous', label: t('misc.everything') },
                { value: 'entrants', label: t('msg.inbox') },
                { value: 'automatiques', label: t('msg.automated') },
              ]}
            />
          </div>

          {threads.length === 0 ? (
            <Empty title={t('msg.none')} />
          ) : (
            <div className="list">
              {threads.map(({ caseId, last, count, unread }) => {
                const kase = v.cases.find((c) => c.id === caseId)
                if (!kase) return null
                const name = clientName(db, kase.clientId)
                return (
                  <button key={caseId} type="button" className="list__row" onClick={() => navigate(`/dossiers/${caseId}`)}>
                    <Avatar name={name} />
                    <span className="col grow" style={{ minWidth: 0 }}>
                      <span className="row gap-2">
                        <span className="t-medium t-truncate">{name}</span>
                        <span className="t-caption t-tertiary">{kase.reference}</span>
                        {unread && <Pill tone="blue" dot>{t('msg.inbox')}</Pill>}
                        {last.automated && <Pill tone="violet">{t('msg.automated')}</Pill>}
                      </span>
                      <span className="t-small t-tertiary t-truncate">{last.body}</span>
                    </span>
                    <span className="col" style={{ textAlign: 'end' }}>
                      <span className="t-caption t-tertiary"><Ago iso={last.at} /></span>
                      <span className="t-caption t-tertiary row gap-1" style={{ justifyContent: 'flex-end' }}>
                        <Icon name={last.channel === 'whatsapp' ? 'whatsapp' : last.channel === 'email' ? 'mail' : 'portal'} size={12} />
                        {count}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </Card>

        <Card
          title={t('msg.templates')}
          action={
            v.can('catalog:manage')
              ? <Link to="/reglages?section=modeles" className="btn btn--ghost btn--sm">{t('crud.add')}</Link>
              : undefined
          }
          flush
        >
          <div className="list">
            {db.templates.map((tpl) => (
              <Link
                key={tpl.id}
                to="/reglages?section=modeles"
                className="list__row col gap-2"
                style={{ alignItems: 'stretch' }}
              >
                <span className="row gap-2">
                  <Icon name={tpl.channel === 'whatsapp' ? 'whatsapp' : 'mail'} size={14} className="t-tertiary" />
                  <span className="t-small t-medium grow">{tt(tpl.name)}</span>
                  <span className="t-caption t-tertiary">{LOCALES.filter((l) => tpl.body[l]).length} / {LOCALES.length}</span>
                </span>
                <span className="t-caption t-tertiary" style={{ lineHeight: 1.45 }}>{tpl.body.fr}</span>
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </>
  )
}
