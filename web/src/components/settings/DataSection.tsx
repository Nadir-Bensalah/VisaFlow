import { useState } from 'react'
import { useStore } from '@/data/store'
import { useI18n } from '@/i18n'
import { Button, Card, Modal, Pill, useToast } from '@/components/ui'

/* L'export et la purge. Deux gestes qui engagent la loi : la loi tunisienne
   2004-63 impose de rendre ses données à qui les demande, et de les effacer
   quand le dossier est clos. La remise à zéro est irréversible, elle passe
   donc par une confirmation nommée. */
export function DataSection() {
  const { db, actions, slug } = useStore()
  const { t } = useI18n()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)

  const exportAll = () => {
    const url = URL.createObjectURL(new Blob([actions.exportJson()], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${slug}-visaflow-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast(t('settings.exportAll'))
  }

  return (
    <>
      <div className="grid grid--2">
        <Card title={t('settings.compliance')}>
          <p className="t-small t-secondary" style={{ marginBottom: 'var(--sp-5)' }}>{t('settings.complianceHint')}</p>
          <div className="col gap-4">
            <div className="row-between"><span className="t-small t-secondary">{t('settings.inpdp')}</span><Pill tone="orange" dot>{db.agency.inpdpRef}</Pill></div>
            <div className="row-between"><span className="t-small t-secondary">{t('settings.retention')}</span><span className="t-small">{t('settings.retentionValue', { n: 24 })}</span></div>
          </div>
        </Card>
        <Card title={t('misc.demoData')}>
          <div className="col gap-3">
            <Button icon="download" onClick={exportAll}>{t('settings.exportAll')}</Button>
            <Button variant="danger" icon="trash" onClick={() => setConfirming(true)}>{t('misc.resetDemo')}</Button>
            <p className="t-caption t-tertiary">{t('login.demoHint')}</p>
          </div>
        </Card>
      </div>

      {confirming && (
        <Modal
          title={t('misc.resetDemo')}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button onClick={() => setConfirming(false)}>{t('action.cancel')}</Button>
              <Button variant="danger" onClick={() => { actions.reset(); setConfirming(false); toast(t('misc.resetDone')) }}>
                {t('action.confirm')}
              </Button>
            </>
          }
        >
          <p className="t-small">{t('crud.confirmRemove', { name: db.agency.name })}</p>
          <p className="t-caption t-tertiary" style={{ marginTop: 'var(--sp-2)' }}>{t('crud.confirmHint')}</p>
        </Modal>
      )}
    </>
  )
}
