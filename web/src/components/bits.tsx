import { Link } from 'react-router-dom'
import type { CaseStatus, DocState, Priority, Stage, VisaCase } from '@/data/types'
import { useI18n } from '@/i18n'
import { useStore } from '@/data/store'
import { useNow } from '@/data/clock'
import { DOC_TONE, PRIORITY_TONE, STAGE_TONE, clientName, daysSince, daysUntil, progress, urgency } from '@/lib/derive'
import { Avatar, Pill, Progress } from './ui'
import { Icon } from './Icon'
import type { ReactNode } from 'react'

export function PageHead({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="page-head row-between wrap">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="t-small">{subtitle}</p>}
      </div>
      {action}
    </header>
  )
}

export function StagePill({ stage }: { stage: Stage }) {
  const { t } = useI18n()
  return <Pill tone={STAGE_TONE[stage]} dot>{t(`stage.${stage}` as 'stage.nouveau')}</Pill>
}

export function DocPill({ state }: { state: DocState }) {
  const { t } = useI18n()
  return <Pill tone={DOC_TONE[state]} dot>{t(`doc.${state}` as 'doc.manquante')}</Pill>
}

export function PriorityPill({ priority }: { priority: Priority }) {
  const { t } = useI18n()
  if (priority === 'normale' || priority === 'basse') return null
  return <Pill tone={PRIORITY_TONE[priority]}>{t(`priority.${priority}` as 'priority.haute')}</Pill>
}

export function StatusPill({ status }: { status: CaseStatus }) {
  const { t } = useI18n()
  const tone = status === 'accepte' ? 'green' : status === 'refuse' ? 'red' : status === 'annule' ? 'gray' : 'blue'
  return <Pill tone={tone} dot>{t(`status.${status}` as 'status.ouvert')}</Pill>
}

/** Date relative, dans la langue courante, sans dependance externe. */
export function Ago({ iso }: { iso?: string }) {
  const { t } = useI18n()
  // L'horloge fait re-rendre : « il y a 3 min » ne reste pas figé.
  const now = useNow()
  if (!iso) return <span className="t-tertiary">—</span>
  const days = daysSince(iso)
  if (days <= 0) {
    const hours = Math.round((now - new Date(iso).getTime()) / 3600000)
    return <span>{hours < 1 ? t('time.justNow') : t('time.hoursAgo', { n: hours })}</span>
  }
  if (days === 1) return <span>{t('time.yesterday')}</span>
  return <span>{t('time.daysAgo', { n: days })}</span>
}

export function Countdown({ iso }: { iso?: string }) {
  const { t } = useI18n()
  useNow()
  if (!iso) return <span className="t-tertiary">—</span>
  const days = daysUntil(iso)
  if (days < 0) return <span style={{ color: 'var(--red)' }}>{t('time.overdue', { n: -days })}</span>
  if (days === 0) return <span style={{ color: 'var(--orange)' }}>{t('time.today')}</span>
  if (days === 1) return <span style={{ color: 'var(--orange)' }}>{t('time.tomorrow')}</span>
  return <span style={{ color: days <= 7 ? 'var(--orange)' : undefined }}>{t('time.inDays', { n: days })}</span>
}

export function UrgencyReason({ kase }: { kase: VisaCase }) {
  const { db } = useStore()
  const { t } = useI18n()
  const u = urgency(db, kase)
  if (u.reason === 'aucune') return null
  const text: Record<string, string> = {
    depart: t('time.inDays', { n: Math.max(u.days, 0) }) + ' · ' + t('cases.travel').toLowerCase(),
    bloque: `${u.days} ${t('cases.blocked').toLowerCase()}`,
    silence: t('time.daysAgo', { n: u.days }),
    impaye: t('pay.outstanding'),
    passeport: t('clients.passportSoon'),
    aucune: '',
  }
  const tone = u.score >= 60 ? 'red' : u.score >= 30 ? 'orange' : 'gray'
  return <Pill tone={tone}>{text[u.reason]}</Pill>
}

/** Ligne de dossier reutilisee par le tableau de bord, la recherche et le client. */
export function CaseRow({ kase, showUrgency }: { kase: VisaCase; showUrgency?: boolean }) {
  const { db } = useStore()
  const { t, tt } = useI18n()
  const visa = db.visaTypes.find((v) => v.id === kase.visaTypeId)
  const p = progress(db, kase.id)
  const name = clientName(db, kase.clientId)

  return (
    <Link to={`/dossiers/${kase.id}`} className="list__row">
      <Avatar name={name} />
      <span className="col grow" style={{ minWidth: 0 }}>
        <span className="row gap-2">
          <span className="t-medium t-truncate">{name}</span>
          <PriorityPill priority={kase.priority} />
        </span>
        <span className="t-caption t-tertiary t-truncate">
          {kase.reference} · {tt(visa?.country)} {tt(visa?.label)}
        </span>
      </span>
      {showUrgency && <UrgencyReason kase={kase} />}
      <span className="col gap-1 caserow__progress" style={{ width: 92 }}>
        <Progress
          pct={p.pct}
          label={t('cases.progress')}
          valueText={`${p.done}/${p.total}`}
          tone={p.pct === 100 ? 'green' : p.pct < 40 ? 'orange' : undefined}
        />
        <span className="t-caption t-tertiary t-num">{p.done}/{p.total}</span>
      </span>
      <StagePill stage={kase.stage} />
      <Icon name="chevron" size={16} className="t-tertiary" />
    </Link>
  )
}
