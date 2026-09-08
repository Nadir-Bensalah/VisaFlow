import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { HAS_BACKEND } from '@/lib/supabase'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Card, Empty } from '@/components/ui'
import { PageHead } from '@/components/bits'
import { Icon, type IconName } from '@/components/Icon'
import { Illustration } from '@/components/Illustration'
import { OverdueCard } from '@/components/OverdueCard'
import { loadTodo, type Todo, type TodoGroup, type TodoItem } from '@/data/pilotage'

/* L'écran « À traiter » de la section 130.
 *
 * Le cahier des charges dit que c'est l'écran le plus important du logiciel, et
 * c'est vrai : c'est le seul qu'on ouvre tous les matins.
 *
 * Sa règle tient en une phrase : CE SONT DES CHOSES À FAIRE, PAS DES
 * STATISTIQUES. Un chiffre sur lequel on ne peut poser aucun geste appartient
 * aux rapports, pas ici. C'est pourquoi chaque entrée porte un lien, et pourquoi
 * une entrée à zéro ne descend même pas du serveur : vingt lignes dont
 * dix-huit à zéro font un écran qu'on cesse de lire au bout d'une semaine.
 *
 * Deuxième différence avec l'ancien écran : rien n'est compté ici. Le serveur
 * rend des nombres déjà calculés sur TOUTE la donnée. L'ancien comptait sur
 * l'instantané chargé par le magasin, ce qui marche à cent dossiers et ment à
 * dix mille sans jamais le dire. */

const ICONE: Record<string, IconName> = {
  docsMissing: 'documents',
  apptsToday: 'appointments',
  apptsTomorrow: 'appointments',
  passportsReady: 'passport',
  passportsHeld: 'passport',
  clientsToCall: 'phone',
  staleCases: 'clock',
  decisionsUntreated: 'cases',
  arrivalsToday: 'ship',
  arrivalsWeek: 'ship',
  inCustoms: 'building',
  containersOut: 'box',
  demurrageRisk: 'alert',
  deliveriesToday: 'box',
  paymentsDue: 'payments',
  invoicesOverdue: 'payments',
  caseBalances: 'payments',
  passportsUnpaid: 'lock',
  tasksOverdue: 'tasks',
  tasksToday: 'tasks',
}

const GROUPES: { key: TodoGroup; label: 'pil.groupVisa' }[] = [
  { key: 'visa', label: 'pil.groupVisa' },
  { key: 'cargo', label: 'pil.groupCargo' as 'pil.groupVisa' },
  { key: 'finance', label: 'pil.groupFinance' as 'pil.groupVisa' },
  { key: 'tasks', label: 'pil.groupTasks' as 'pil.groupVisa' },
]

const COULEUR: Record<string, string> = {
  red: 'var(--red)',
  orange: 'var(--orange)',
  blue: 'var(--blue)',
  green: 'var(--green)',
  gray: 'var(--text-secondary)',
}

export function Aujourdhui() {
  const v = useVisible()
  const { t } = useI18n()
  const [todo, setTodo] = useState<Todo | null>(null)
  const [loading, setLoading] = useState(HAS_BACKEND)
  const [error, setError] = useState<string | null>(null)

  const charger = useCallback(async () => {
    if (!HAS_BACKEND) { setLoading(false); return }
    setLoading(true)
    try {
      setTodo(await loadTodo(v.officeId))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [v.officeId])

  useEffect(() => { void charger() }, [charger])

  const hour = new Date().getHours()
  const bonjour = hour < 12 ? 'today.morning' : hour < 18 ? 'today.afternoon' : 'today.evening'

  if (!HAS_BACKEND) {
    return (
      <>
        <PageHead title={t('pil.todayTitle')} subtitle={t('pil.todaySub')} />
        <Card><Empty title={t('pil.offline')} hint={t('pil.offlineHint')} /></Card>
      </>
    )
  }

  return (
    <>
      <header className="today__hero">
        <div className="col gap-2 grow">
          <span className="t-caption t-tertiary">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </span>
          <h1>{t(bonjour as 'today.morning', { name: v.user.name.split(' ')[0] })}</h1>
          <p className="t-secondary">{t('pil.todaySub')}</p>
        </div>
        <Illustration scene={todo && todo.total === 0 ? 'termine' : 'journee'} />
      </header>

      {loading && <Card><Empty title={t('pil.loading')} /></Card>}
      {error && <Card><Empty title={t('pil.loadError', { msg: error })} /></Card>}

      {todo && todo.items.length === 0 && (
        <Card>
          <Empty title={t('pil.nothing')} hint={t('pil.nothingHint')} scene="termine" />
        </Card>
      )}

      {todo && todo.items.length > 0 && (
        <div className="grid grid--2">
          {GROUPES.map((g) => {
            const lignes = todo.items.filter((i) => i.group === g.key)
            if (lignes.length === 0) return null
            return (
              <Card key={g.key} title={t(g.label)} flush>
                <div className="list">
                  {lignes.map((i) => (
                    <Entree key={i.key} item={i} todo={todo} />
                  ))}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <div style={{ marginTop: 'var(--sp-5)' }}>
        <OverdueCard officeId={v.officeId} limit={8} />
      </div>
    </>
  )
}

function Entree({ item, todo }: { item: TodoItem; todo: Todo }) {
  const { t } = useI18n()
  // Deux entrées portent un seuil, et il vaut mieux le dire : « sans activité »
  // n'a de sens que si l'on sait depuis combien de temps.
  const aide =
    item.key === 'staleCases' ? t('pil.staleHint', { n: todo.staleDays })
    : item.key === 'passportsHeld' ? t('pil.heldHint', { n: todo.heldDays })
    : null

  return (
    <Link to={item.link} className="list__row">
      <Icon name={ICONE[item.key] ?? 'check'} size={18} className="t-tertiary" />
      <span className="col grow" style={{ minWidth: 0 }}>
        <span className="t-small t-medium t-truncate">
          {t(item.label as 'pil.docsMissing')}
        </span>
        {aide && <span className="t-caption t-tertiary t-truncate">{aide}</span>}
      </span>
      <span className="t-num t-medium" style={{ color: COULEUR[item.tone] ?? 'inherit', fontSize: 'var(--size-h4)' }}>
        {item.count}
      </span>
      <Icon name="arrow" size={16} className="t-tertiary" />
    </Link>
  )
}
