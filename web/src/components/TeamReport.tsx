import { HAS_BACKEND } from '@/lib/supabase'
import { useI18n } from '@/i18n'
import { Empty } from '@/components/ui'
import { Erreur, Section, Squelette, Table, Vide, useChargement } from '@/components/page'
import { loadTeamReport, type TeamReport as TeamData } from '@/data/pilotage'
import '@/styles/modules.css'

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
 * retrie pas. Pas de chiffres de tête non plus : une tuile « meilleur agent »
 * serait exactement le classement qu'on refuse. */

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
  const { data: rep, loading, error, reload } = useChargement(
    () => (HAS_BACKEND ? loadTeamReport(from, to) : Promise.resolve(null as TeamData | null)),
    [from, to],
  )

  if (!HAS_BACKEND) return <Section><Empty title={t('mq.demoTitle')} hint={t('mq.demoHint')} scene="equipe" /></Section>
  if (error) return <Erreur message={error} retryLabel={t('mq.retry')} onRetry={() => void reload()} />
  if (loading && !rep) return <Section flush><Squelette type="table" n={5} /></Section>
  if (!rep || rep.rows.length === 0) return <Section><Vide title={t('pil.empty')} icon="clients" /></Section>

  const avecProspects = rep.rows.some((r) => r.leadsAssigned !== null)

  return (
    <Section title={t('pil.teamTitle')} flush action={<span className="t-caption t-tertiary t-num">{rep.rows.length}</span>}>
      <p className="t-caption t-tertiary md-note">{t('pil.teamHint')}</p>
      <Table>
        <thead>
          <tr>
            <th>{t('pil.person')}</th>
            <th className="col-optional">{t('pil.role')}</th>
            <th className="num">{t('pil.casesActive')}</th>
            <th className="num">{t('pil.casesDone')}</th>
            <th className="num col-optional">{t('pil.tasksDone')}</th>
            <th className="num col-optional">{t('pil.tasksOverdue')}</th>
            <th className="num col-optional">{t('pil.clientsFollowed')}</th>
            <th className="num col-optional">{t('pil.docsHandled')}</th>
            <th className="num col-optional">{t('pil.messagesSent')}</th>
            {avecProspects && <th className="num col-optional">{t('pil.leadsAssigned')}</th>}
            {avecProspects && <th className="num col-optional">{t('pil.leadsWon')}</th>}
            {rep.moneyVisible && <th className="num">{t('pil.revenue')}</th>}
          </tr>
        </thead>
        <tbody>
          {rep.rows.map((r) => (
            <tr key={r.userId} className={r.active ? '' : 'adm-row--off'}>
              <td>
                <div className="adm-cell-main">
                  <span>{r.name}</span>
                  <span className="t-caption">{t(ROLE[r.role] ?? 'pil.roleAgent')}</span>
                </div>
              </td>
              <td className="col-optional t-tertiary">{t(ROLE[r.role] ?? 'pil.roleAgent')}</td>
              <td className="num">{r.casesActive}</td>
              <td className="num">{r.casesDone}</td>
              <td className="num col-optional">{r.tasksDone}</td>
              <td className="num col-optional">{r.tasksOverdue}</td>
              <td className="num col-optional">{r.clientsFollowed}</td>
              <td className="num col-optional">{r.documentsHandled}</td>
              <td className="num col-optional">{r.messagesSent}</td>
              {avecProspects && <td className="num col-optional">{r.leadsAssigned ?? '·'}</td>}
              {avecProspects && <td className="num col-optional">{r.leadsWon ?? '·'}</td>}
              {rep.moneyVisible && (
                <td className="num">{r.revenue === null ? '·' : formatMoney(r.revenue)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </Table>
    </Section>
  )
}
