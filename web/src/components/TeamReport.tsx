import { useCallback, useEffect, useState } from 'react'
import { HAS_BACKEND } from '@/lib/supabase'
import { useI18n } from '@/i18n'
import { Card, Empty } from '@/components/ui'
import { loadTeamReport, type TeamReport as TeamData } from '@/data/pilotage'

/* La performance de l'équipe, section 129.
 *
 * CE QUE CET ÉCRAN NE FAIT PAS, ET POURQUOI.
 *
 * Pas de note globale. Pas de classement. Pas de feu vert ni de feu rouge. Pas
 * même un tri par nombre de dossiers, parce qu'un tri par performance est un
 * classement qui ne dit pas son nom.
 *
 * La raison est simple : un score qui range les gens du meilleur au pire finit
 * toujours par servir à autre chose que ce pour quoi il a été écrit, et
 * personne ne relit jamais la formule. Les mêmes chiffres bruts, lus par
 * quelqu'un qui connaît son équipe, disent la vérité ; agrégés en une note, ils
 * la cachent.
 *
 * Les lignes sortent donc du serveur triées par NOM, et cet écran ne les
 * retrie pas. */

/* Les quatre niveaux d'accès. Le bloc `pil` porte ses propres libellés : le
   dictionnaire principal range les siens sous un autre chemin, et un module ne
   réécrit jamais le dictionnaire principal. */
const ROLE: Record<string, 'pil.roleOwner'> = {
  owner: 'pil.roleOwner',
  manager: 'pil.roleManager' as 'pil.roleOwner',
  agent: 'pil.roleAgent' as 'pil.roleOwner',
  viewer: 'pil.roleViewer' as 'pil.roleOwner',
}

export function TeamReport({ from, to }: { from: string; to: string }) {
  const { t, formatMoney } = useI18n()
  const [rep, setRep] = useState<TeamData | null>(null)
  const [loading, setLoading] = useState(HAS_BACKEND)
  const [error, setError] = useState<string | null>(null)

  const charger = useCallback(async () => {
    if (!HAS_BACKEND) { setLoading(false); return }
    setLoading(true)
    try {
      setRep(await loadTeamReport(from, to))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => { void charger() }, [charger])

  if (!HAS_BACKEND) return <Card><Empty title={t('pil.offline')} hint={t('pil.offlineHint')} /></Card>
  if (loading) return <Card><Empty title={t('pil.loading')} /></Card>
  if (error) return <Card><Empty title={t('pil.loadError', { msg: error })} /></Card>
  if (!rep || rep.rows.length === 0) return <Card><Empty title={t('pil.empty')} /></Card>

  const avecProspects = rep.rows.some((r) => r.leadsAssigned !== null)

  return (
    <Card title={t('pil.teamTitle')} flush>
      <p className="t-caption t-tertiary" style={{ padding: 'var(--sp-3) var(--sp-5) 0' }}>
        {t('pil.teamHint')}
      </p>
      <div className="tablewrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t('pil.person')}</th>
              <th>{t('pil.role')}</th>
              <th className="num">{t('pil.casesActive')}</th>
              <th className="num">{t('pil.casesDone')}</th>
              <th className="num">{t('pil.tasksDone')}</th>
              <th className="num">{t('pil.tasksOverdue')}</th>
              <th className="num">{t('pil.clientsFollowed')}</th>
              <th className="num">{t('pil.docsHandled')}</th>
              <th className="num">{t('pil.messagesSent')}</th>
              {avecProspects && <th className="num">{t('pil.leadsAssigned')}</th>}
              {avecProspects && <th className="num">{t('pil.leadsWon')}</th>}
              {rep.moneyVisible && <th className="num">{t('pil.revenue')}</th>}
            </tr>
          </thead>
          <tbody>
            {rep.rows.map((r) => (
              <tr key={r.userId} style={{ opacity: r.active ? 1 : 0.55 }}>
                <td className="t-small t-medium">{r.name}</td>
                <td className="t-caption t-tertiary">{t(ROLE[r.role] ?? 'pil.roleAgent')}</td>
                <td className="num t-small">{r.casesActive}</td>
                <td className="num t-small">{r.casesDone}</td>
                <td className="num t-small">{r.tasksDone}</td>
                <td className="num t-small">{r.tasksOverdue}</td>
                <td className="num t-small">{r.clientsFollowed}</td>
                <td className="num t-small">{r.documentsHandled}</td>
                <td className="num t-small">{r.messagesSent}</td>
                {avecProspects && <td className="num t-small">{r.leadsAssigned ?? '·'}</td>}
                {avecProspects && <td className="num t-small">{r.leadsWon ?? '·'}</td>}
                {rep.moneyVisible && (
                  <td className="num t-small">
                    {r.revenue === null ? '·' : formatMoney(r.revenue)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
