import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Button, Card, Empty, Segmented, useToast } from '@/components/ui'
import { DocPill, PageHead } from '@/components/bits'
import { clientName, daysSince } from '@/lib/derive'
import type { DocState } from '@/data/types'

type View = 'bloquantes' | 'attente' | 'toutes'

export function Documents() {
  const { db, actions } = useStore()
  const v = useVisible()
  const { t, tt } = useI18n()
  const navigate = useNavigate()
  const toast = useToast()
  const [view, setView] = useState<View>('bloquantes')

  const rows = useMemo(() => {
    const openIds = new Set(v.cases.filter((c) => c.status === 'ouvert').map((c) => c.id))
    const states: Record<View, DocState[]> = {
      bloquantes: ['manquante', 'refusee', 'expiree'],
      attente: ['manquante', 'demandee', 'recue', 'refusee', 'expiree'],
      toutes: ['manquante', 'demandee', 'recue', 'refusee', 'expiree', 'validee'],
    }
    return v.documents
      .filter((d) => openIds.has(d.caseId) && states[view].includes(d.state) && (view === 'toutes' || d.required))
      .map((d) => {
        const kase = v.cases.find((c) => c.id === d.caseId)!
        return { doc: d, kase, waiting: daysSince(d.requestedAt ?? kase.openedAt) }
      })
      .sort((a, b) => b.waiting - a.waiting)
  }, [db, v, view])

  const remindAll = () => {
    const late = rows.filter((r) => r.doc.state === 'demandee' && r.waiting >= 3)
    late.forEach((r) => actions.remindDoc(r.doc.id))
    toast(late.length ? `${late.length} · ${t('action.remind')}` : t('docs.none'))
  }

  return (
    <>
      <PageHead
        title={t('docs.title')}
        subtitle={t('docs.subtitle')}
        action={<Button variant="primary" icon="bell" onClick={remindAll}>{t('docs.remindAll')}</Button>}
      />

      <Card flush>
        <div className="row" style={{ padding: 'var(--sp-4) var(--sp-6)', borderBottom: '1px solid var(--hairline)' }}>
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'bloquantes', label: t('cases.blocked') },
              { value: 'attente', label: t('docs.state') },
              { value: 'toutes', label: t('misc.everything') },
            ]}
          />
          <span className="grow" />
          <span className="t-small t-tertiary t-num">{rows.length}</span>
        </div>

        {rows.length === 0 ? (
          <Empty title={t('docs.none')} />
        ) : (
          <div className="tablewrap">
            <table className="table table--clickable">
              <thead>
                <tr>
                  <th>{t('docs.item')}</th>
                  <th>{t('cases.client')}</th>
                  <th>{t('cases.reference')}</th>
                  <th>{t('docs.state')}</th>
                  <th className="num">{t('docs.since')}</th>
                  <th className="num col-optional">{t('docs.reminders')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ doc, kase, waiting }) => (
                  <tr
                    key={doc.id}
                    tabIndex={0}
                    role="link"
                    aria-label={`${tt(doc.label)} ${kase.reference}`}
                    onClick={() => navigate(`/dossiers/${kase.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/dossiers/${kase.id}`) }
                    }}
                  >
                    <td className="t-medium t-small">{tt(doc.label)}</td>
                    <td className="t-small">{clientName(db, kase.clientId)}</td>
                    <td className="t-mono t-small t-tertiary">{kase.reference}</td>
                    <td><DocPill state={doc.state} /></td>
                    <td className="num t-small" style={{ color: waiting > 7 ? 'var(--red)' : waiting > 3 ? 'var(--orange)' : undefined }}>
                      {Number.isFinite(waiting) ? t('time.daysAgo', { n: waiting }) : '—'}
                    </td>
                    <td className="num t-small t-tertiary col-optional">{doc.reminders || '—'}</td>
                    <td style={{ textAlign: 'end' }}>
                      <Button
                        size="sm"
                        icon={doc.state === 'manquante' ? 'messages' : 'bell'}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (doc.state === 'manquante') actions.setDocState(doc.id, 'demandee')
                          else actions.remindDoc(doc.id)
                          toast(t('msg.sent'))
                        }}
                      >
                        {doc.state === 'manquante' ? t('action.request') : t('action.remind')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
