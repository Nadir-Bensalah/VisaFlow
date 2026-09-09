import { useState } from 'react'
import { Button, useToast } from '@/components/ui'
import { Confirmer, Erreur, PageHeader, Section, Squelette, Table, Vide, dateHeure, depuis, nb, useChargement } from './kit'
import { usePlateforme } from './contexte'
import { loadTaches, runTache } from '@/data/plateforme'
import type { TacheRow } from '@/data/plateforme'
import { EtatTache, nomTache } from './Cockpit'
import '@/styles/admin-cockpit.css'

/**
 * LES TÂCHES PLANIFIÉES. Ce que le serveur fait tout seul, et quand.
 *
 * On peut en lancer une à la main, après confirmation : une tâche qui envoie
 * des relances ne se déclenche pas d'un clic distrait.
 */

export function Taches() {
  const { can, rafraichirCompteurs } = usePlateforme()
  const toast = useToast()
  const { data, loading, refreshing, error, reload } = useChargement(loadTaches)
  const [aLancer, setALancer] = useState<TacheRow | null>(null)
  const [enCours, setEnCours] = useState(false)

  const lancer = async () => {
    if (!aLancer) return
    setEnCours(true)
    try {
      const r = await runTache(aLancer.job)
      toast(r.ok
        ? `${nomTache(aLancer.job)} : ${nb(r.affected ?? 0)} lignes touchées en ${nb(r.ms)} ms.`
        : `${nomTache(aLancer.job)} en échec : ${r.detail ?? 'sans détail'}.`)
      setALancer(null)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Lancement impossible.')
    } finally {
      setEnCours(false)
      void reload()
      rafraichirCompteurs()
    }
  }

  const taches = data ?? []

  return (
    <div className="ck-page">
      <PageHeader
        kicker="Plateforme"
        title="Tâches planifiées"
        subtitle="Ce que le serveur fait tout seul, et quand."
        refreshing={refreshing}
        actions={<Button icon="refresh" onClick={() => void reload()} disabled={refreshing}>Actualiser</Button>}
      />

      {error && <div className="ck-erreur"><Erreur message={error} onRetry={() => void reload()} /></div>}

      <Section flush>
        {loading && !data ? <Squelette type="table" n={5} /> : taches.length === 0 ? (
          <Vide title="Aucune tâche planifiée sur cette base." hint="En production, pg_cron en déclare plusieurs. Ici, la liste vient de la base à laquelle vous êtes connecté." />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Tâche</th><th>Planification</th><th>Dernier passage</th><th>État</th>
                <th className="num">Lignes</th><th>Détail</th>
                {can('taches.lancer') && <th className="actions" />}
              </tr>
            </thead>
            <tbody>
              {taches.map((t) => (
                <tr key={t.job} className={t.active ? undefined : 'adm-row--off'}>
                  <td>
                    <div className="adm-cell-main">
                      <span>{nomTache(t.job)}</span>
                      <span className="t-caption">{t.active ? t.job : `${t.job} · désactivée`}</span>
                    </div>
                  </td>
                  <td className="t-mono t-caption">{t.schedule}</td>
                  <td>
                    <div className="adm-cell-main">
                      <span className="t-num">{dateHeure(t.last_run)}</span>
                      {t.last_run && <span className="t-caption">{depuis(t.last_run)}</span>}
                    </div>
                  </td>
                  <td><EtatTache t={t} /></td>
                  <td className="num">{nb(t.last_affected)}</td>
                  <td><span className="ck-detail">{t.last_detail ?? 'sans détail'}</span></td>
                  {can('taches.lancer') && (
                    <td className="actions">
                      <Button size="sm" icon="automations" disabled={enCours} onClick={() => setALancer(t)}>Lancer maintenant</Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="ck-note">
          La base locale de test n’a pas pg_cron : hors production, cette liste peut être vide sans que rien ne soit cassé.
        </p>
      </Section>

      {aLancer && (
        <Confirmer
          title={`Lancer ${nomTache(aLancer.job)} maintenant`}
          label="Lancer"
          busy={enCours}
          onConfirm={() => void lancer()}
          onClose={() => setALancer(null)}
        >
          La tâche s’exécute tout de suite, en plus de sa planification <span className="t-mono">{aLancer.schedule}</span>.
          {aLancer.last_run && <> Dernier passage : {dateHeure(aLancer.last_run)}.</>}
        </Confirmer>
      )}
    </div>
  )
}
