import { Link } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useI18n } from '@/i18n'
import { Button, Card, Progress, useToast } from './ui'
import { Icon, type IconName } from './Icon'

/* Le premier jour. Une agence qui s'inscrit ne doit pas tomber dans un trou :
   cinq gestes, faits une fois, qui la mènent de l'outil vide au premier dossier
   suivi par son client. */
export function SetupCard() {
  const { db, actions } = useStore()
  const { t } = useI18n()
  const toast = useToast()

  const steps: { key: string; label: string; hint: string; icon: IconName; to: string }[] = [
    { key: 'offices', label: t('setup.offices'), hint: t('setup.officesHint'), icon: 'building', to: '/reglages?section=agence' },
    { key: 'team', label: t('setup.team'), hint: t('setup.teamHint'), icon: 'clients', to: '/reglages?section=equipe' },
    { key: 'catalog', label: t('setup.catalog'), hint: t('setup.catalogHint'), icon: 'documents', to: '/reglages?section=visas' },
    { key: 'firstCase', label: t('setup.firstCase'), hint: t('setup.firstCaseHint'), icon: 'cases', to: '/dossiers' },
    { key: 'share', label: t('setup.share'), hint: t('setup.shareHint'), icon: 'portal', to: '/agence' },
  ]

  const done = steps.filter((s) => db.agency.setupDone.includes(s.key)).length
  if (db.agency.setupHidden || done === steps.length) return null

  const publicUrl = `${window.location.origin}${import.meta.env.BASE_URL}agence?agency=${db.agency.slug}`

  return (
    <Card
      title={t('setup.title')}
      action={
        <span className="row gap-3">
          <span className="t-caption t-tertiary t-num">{t('setup.done', { done, total: steps.length })}</span>
          <Button size="sm" onClick={() => { actions.hideSetup(); toast(t('setup.hide')) }}>{t('setup.hide')}</Button>
        </span>
      }
    >
      <div className="col gap-4">
        <p className="t-small t-secondary">{t('setup.subtitle')}</p>
        <Progress pct={Math.round((done / steps.length) * 100)} label={t('setup.title')} tone={done === steps.length ? 'green' : undefined} />
        <div className="col gap-2">
          {steps.map((step) => {
            const isDone = db.agency.setupDone.includes(step.key)
            return (
              <div key={step.key} className="row gap-3" style={{ padding: 'var(--sp-2) 0' }}>
                <span
                  className="today__check"
                  style={{ borderColor: isDone ? 'var(--green)' : undefined, background: isDone ? 'var(--green)' : 'transparent', color: isDone ? 'var(--text-white)' : 'transparent' }}
                >
                  <Icon name="check" size={12} />
                </span>
                <span className="col grow" style={{ minWidth: 0 }}>
                  <span className={isDone ? 't-small t-tertiary' : 't-small t-medium'}>{step.label}</span>
                  <span className="t-caption t-tertiary">{step.hint}</span>
                </span>
                {step.key === 'share' ? (
                  <Button
                    size="sm"
                    icon="copy"
                    onClick={() => {
                      navigator.clipboard?.writeText(publicUrl)
                      actions.markSetup('share')
                      toast(t('action.copied'))
                    }}
                  >
                    {t('action.copy')}
                  </Button>
                ) : (
                  <Link to={step.to} className="btn btn--secondary btn--sm" onClick={() => actions.markSetup(step.key)}>
                    {t('action.open')}
                  </Link>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}
