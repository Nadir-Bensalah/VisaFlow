import { useState } from 'react'
import { useStore } from '@/data/store'
import { useI18n } from '@/i18n'
import { Button, Card, Field, Input, Pill, Switch, useToast } from '@/components/ui'

/* Le canal réel de l'agence. Tant que ce raccordement n'existe pas, le
   produit ne sait que pré-remplir un lien wa.me : le message part du
   téléphone personnel de l'employé, et rien ne revient. */
export function WhatsAppSection() {
  const { db, actions, slug } = useStore()
  const { t } = useI18n()
  const toast = useToast()
  const wa = db.agency.whatsapp
  const [draft, setDraft] = useState({
    phoneNumberId: wa?.phoneNumberId ?? '',
    wabaId: wa?.wabaId ?? '',
    displayNumber: wa?.displayNumber ?? '',
    tokenSecret: wa?.tokenSecret ?? `wa_token_${slug}`,
    verifyToken: wa?.verifyToken ?? '',
    active: wa?.active ?? false,
  })
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => setDraft({ ...draft, [key]: value })

  // Le coût du mois, à la ligne près. Une agence qui relance cinq fois à
  // froid paie cinq messages modèles.
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const sentThisMonth = db.messages.filter(
    (m) => m.channel === 'whatsapp' && m.direction === 'sortant' && new Date(m.at) >= monthStart,
  ).length

  const webhook = `https://<projet>.supabase.co/functions/v1/whatsapp-webhook`

  return (
    <div className="grid grid--2">
      <Card title={t('wa.title')} className="grid__wide">
        <p className="t-small t-secondary" style={{ marginBottom: 'var(--sp-5)' }}>{t('wa.subtitle')}</p>
        <div className="grid grid--2">
          <Field label={t('wa.phoneNumberId')}>
            <Input value={draft.phoneNumberId} onChange={(e) => set('phoneNumberId', e.target.value)} />
          </Field>
          <Field label={t('wa.wabaId')}>
            <Input value={draft.wabaId} onChange={(e) => set('wabaId', e.target.value)} />
          </Field>
          <Field label={t('wa.displayNumber')}>
            <Input value={draft.displayNumber} onChange={(e) => set('displayNumber', e.target.value)} />
          </Field>
          <Field label={t('wa.tokenSecret')} hint={t('wa.tokenHint')}>
            <Input value={draft.tokenSecret} onChange={(e) => set('tokenSecret', e.target.value)} />
          </Field>
          <Field label={t('wa.verifyToken')} hint={t('wa.verifyHint')}>
            <Input value={draft.verifyToken} onChange={(e) => set('verifyToken', e.target.value)} />
          </Field>
          <Field label={t('wa.active')}>
            <Switch checked={draft.active} onChange={(x) => set('active', x)} label={t('wa.active')} />
          </Field>
        </div>
        <div className="row-between wrap gap-3" style={{ marginTop: 'var(--sp-5)' }}>
          <span className="col" style={{ minWidth: 0 }}>
            <span className="t-caption t-tertiary">{t('wa.webhookUrl')}</span>
            <span className="t-small t-num t-truncate">{webhook}</span>
          </span>
          <Button
            variant="primary"
            icon="save"
            disabled={!draft.phoneNumberId.trim() || !draft.verifyToken.trim()}
            onClick={() => {
              actions.updateAgency({
                whatsapp: {
                  phoneNumberId: draft.phoneNumberId.trim(),
                  wabaId: draft.wabaId.trim() || undefined,
                  displayNumber: draft.displayNumber.trim() || undefined,
                  tokenSecret: draft.tokenSecret.trim(),
                  verifyToken: draft.verifyToken.trim(),
                  active: draft.active,
                  linkedAt: wa?.linkedAt ?? new Date().toISOString(),
                },
              })
              toast(t('crud.updated'))
            }}
          >
            {t('action.save')}
          </Button>
        </div>
      </Card>

      <Card title={t('wa.cost')}>
        <div className="col gap-2">
          <span className="t-display t-num">{sentThisMonth}</span>
          <span className="t-small t-secondary">{t('wa.costHint')}</span>
        </div>
      </Card>

      <Card title={t('wa.templates')}>
        <p className="t-small t-secondary" style={{ marginBottom: 'var(--sp-4)' }}>{t('wa.templatesHint')}</p>
        <div className="col gap-3">
          {db.templates.filter((x) => x.channel === 'whatsapp').map((x) => (
            <div key={x.id} className="row-between gap-3">
              <span className="t-small t-truncate">{x.key}</span>
              {/* Tant que le compte Meta n'existe pas, tout est en attente.
                  On ne prétend pas le contraire. */}
              <Pill tone="orange">{t('wa.pending')}</Pill>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
