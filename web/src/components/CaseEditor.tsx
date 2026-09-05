import { useState } from 'react'
import { useStore } from '@/data/store'
import { useI18n } from '@/i18n'
import { Button, Field, Input, Modal, Select, useToast } from './ui'
import type { Priority, VisaCase } from '@/data/types'

/* Corriger un dossier. Sans cet écran, une faute de frappe est définitive et
   la référence du consulat ne peut jamais être saisie. */
export function CaseEditor({ kase, onClose }: { kase: VisaCase; onClose: () => void }) {
  const { db, actions } = useStore()
  const { t } = useI18n()
  const toast = useToast()

  const [assigneeId, setAssigneeId] = useState(kase.assigneeId)
  const [priority, setPriority] = useState<Priority>(kase.priority)
  const [officeId, setOfficeId] = useState(kase.officeId)
  const [travelDate, setTravelDate] = useState(kase.travelDate?.slice(0, 10) ?? '')
  const [consulateRef, setConsulateRef] = useState(kase.consulateRef ?? '')
  const [source, setSource] = useState(kase.source)

  return (
    <Modal
      title={t('crud.edit')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button
            variant="primary"
            onClick={() => {
              actions.updateCase(kase.id, {
                assigneeId, priority, officeId, source,
                travelDate: travelDate ? new Date(travelDate).toISOString() : undefined,
                consulateRef: consulateRef.trim() || undefined,
              })
              onClose()
              toast(t('crud.updated'))
            }}
          >
            {t('action.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid--2">
        <Field label={t('cases.assignee')}>
          <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            {db.users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </Field>
        <Field label={t('priority.haute')}>
          <Select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {(['basse', 'normale', 'haute', 'urgente'] as Priority[]).map((p) => (
              <option key={p} value={p}>{t(`priority.${p}` as 'priority.haute')}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('caseDetail.travelOn')}>
          <Input type="date" value={travelDate} onChange={(e) => setTravelDate(e.target.value)} />
        </Field>
        <Field label={t('caseDetail.consulateRef')} hint={t('caseDetail.nextStep')}>
          <Input value={consulateRef} onChange={(e) => setConsulateRef(e.target.value)} />
        </Field>
        <Field label={t('misc.office')}>
          <Select value={officeId} onChange={(e) => setOfficeId(e.target.value)}>
            {db.agency.offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
        </Field>
        <Field label={t('caseDetail.source')}>
          <Select value={source} onChange={(e) => setSource(e.target.value as VisaCase['source'])}>
            {(['comptoir', 'whatsapp', 'site', 'recommandation', 'partenaire'] as VisaCase['source'][]).map((x) => (
              <option key={x} value={x}>{t(`source.${x}` as 'source.comptoir')}</option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  )
}
