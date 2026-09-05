import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Button, Card, Empty, Field, Modal, Pill, Segmented, Select, Textarea, useToast } from '@/components/ui'
import { Ago, PageHead } from '@/components/bits'
import { Icon } from '@/components/Icon'
import type { ClientRequest, RequestStatus } from '@/data/types'

type View = 'nouvelles' | 'toutes'

/* La boîte des demandes. C'est la porte d'entrée du métier : ce qui arrive de
   la page publique de l'agence, avant que quiconque décide d'en faire un
   dossier. */
export function Inbox() {
  const { db, actions } = useStore()
  const v = useVisible()
  const { t, tt, formatDate } = useI18n()
  const navigate = useNavigate()
  const toast = useToast()
  const [view, setView] = useState<View>('nouvelles')
  const [converting, setConverting] = useState<ClientRequest | null>(null)
  const [refusing, setRefusing] = useState<ClientRequest | null>(null)
  const [reason, setReason] = useState('')
  const [assigneeId, setAssigneeId] = useState(v.user.id)

  const rows = db.requests
    .filter((r) => (view === 'nouvelles' ? r.status === 'nouvelle' || r.status === 'qualifiee' : true))
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))

  const tone: Record<RequestStatus, 'blue' | 'orange' | 'green' | 'gray'> = {
    nouvelle: 'blue', qualifiee: 'orange', convertie: 'green', ecartee: 'gray',
  }
  const label: Record<RequestStatus, string> = {
    nouvelle: t('inbox.new'), qualifiee: t('inbox.qualified'),
    convertie: t('inbox.converted'), ecartee: t('inbox.refused'),
  }

  return (
    <>
      <PageHead title={t('inbox.title')} subtitle={t('inbox.subtitle')} />

      <Card flush>
        <div className="row" style={{ padding: 'var(--sp-4) var(--sp-6)', borderBottom: '1px solid var(--hairline)' }}>
          <Segmented
            label={t('inbox.title')}
            value={view}
            onChange={setView}
            options={[
              { value: 'nouvelles', label: t('inbox.new') },
              { value: 'toutes', label: t('misc.everything') },
            ]}
          />
          <span className="grow" />
          <span className="t-small t-tertiary t-num" role="status" aria-live="polite">{rows.length}</span>
        </div>

        {rows.length === 0 ? (
          <Empty
            title={t('inbox.none')}
            hint={t('inbox.noneHint')}
            scene="message"
            action={<Button icon="copy" onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}${import.meta.env.BASE_URL}agence?agency=${db.agency.slug}`); toast(t('action.copied')) }}>{t('setup.share')}</Button>}
          />
        ) : (
          <div className="list">
            {rows.map((r) => (
              <div key={r.id} className="list__row">
                <Icon name={r.kind === 'fret' ? 'ship' : 'passport'} size={18} className="t-tertiary" />
                <span className="col grow" style={{ minWidth: 0 }}>
                  <span className="row gap-2">
                    <span className="t-medium t-small">{r.firstName} {r.lastName}</span>
                    <Pill tone={tone[r.status]} dot>{label[r.status]}</Pill>
                    {r.phoneVerified
                      ? <Pill tone="green">{t('inbox.verified')}</Pill>
                      : <Pill tone="orange">{t('inbox.unverified')}</Pill>}
                  </span>
                  <span className="t-caption t-tertiary t-truncate">
                    {r.reference} · {r.destination ?? r.goods} · {r.phone}
                    {r.travelDate && ` · ${formatDate(r.travelDate)}`}
                  </span>
                  {r.note && <span className="t-caption t-secondary">{r.note}</span>}
                </span>
                <span className="t-caption t-tertiary"><Ago iso={r.receivedAt} /></span>
                {(r.status === 'nouvelle' || r.status === 'qualifiee') && v.can('case:create') && (
                  <span className="row gap-2">
                    <Button size="sm" onClick={() => { setRefusing(r); setReason('') }}>{t('inbox.refuse')}</Button>
                    {r.kind === 'visa' && (
                      <Button size="sm" variant="primary" onClick={() => { setConverting(r); setAssigneeId(v.user.id) }}>
                        {t('inbox.convert')}
                      </Button>
                    )}
                  </span>
                )}
                {r.caseId && (
                  <Button size="sm" onClick={() => navigate(`/dossiers/${r.caseId}`)}>{t('action.open')}</Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {converting && (
        <Modal
          title={t('inbox.convert')}
          onClose={() => setConverting(null)}
          footer={
            <>
              <Button onClick={() => setConverting(null)}>{t('action.cancel')}</Button>
              <Button
                variant="primary"
                onClick={() => {
                  const caseId = actions.convertRequest(converting.id, assigneeId)
                  setConverting(null)
                  toast(t('crud.created'))
                  if (caseId) navigate(`/dossiers/${caseId}`)
                }}
              >
                {t('action.confirm')}
              </Button>
            </>
          }
        >
          <div className="col gap-4">
            <p className="t-small t-secondary">
              {converting.firstName} {converting.lastName} · {converting.phone}
              {' · '}
              {tt(db.visaTypes.find((x) => x.id === converting.visaTypeId)?.label)}
            </p>
            <Field label={t('cases.assignee')}>
              <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                {db.users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </Field>
          </div>
        </Modal>
      )}

      {refusing && (
        <Modal
          title={t('inbox.refuse')}
          onClose={() => setRefusing(null)}
          footer={
            <>
              <Button onClick={() => setRefusing(null)}>{t('action.cancel')}</Button>
              <Button variant="danger" onClick={() => { actions.refuseRequest(refusing.id, reason); setRefusing(null); toast(t('crud.updated')) }}>
                {t('inbox.refuse')}
              </Button>
            </>
          }
        >
          <Field label={t('inbox.refuseReason')}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </Modal>
      )}
    </>
  )
}
