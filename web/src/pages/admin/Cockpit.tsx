import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Pill, Segmented, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import {
  Barres, Erreur, Gravite, Kpi, KpiGrid, PageHeader, Section, Squelette, Table, Vide,
  dateHeure, delai, depuis, money, nb, useChargement,
} from './kit'
import { usePlateforme } from './contexte'
import { loadCockpit, runTache } from '@/data/plateforme'
import type { AuditAction, AuditRow, Cockpit as CockpitData, PointMois, Severite, TacheRow, Urgent, UrgentKind } from '@/data/plateforme'
import '@/styles/admin-cockpit.css'

/**
 * LE POSTE DE PILOTAGE. L'écran qu'on ouvre le matin.
 *
 * Il doit dire en trois secondes ce qui brûle, comment va l'argent, et
 * permettre d'agir sans changer d'écran quand c'est possible. Tout vient d'un
 * seul appel, platform_cockpit() : un chiffre absent ici est un chiffre absent
 * du contrat, jamais un chiffre inventé.
 */

/* ------------------------- Libellés partagés ------------------------- */

/** Chaque action du journal, en français lisible. Le journal réutilise la même table. */
export const LIBELLES: Record<AuditAction, string> = {
  'agence.ouverte': 'Agence ouverte',
  'agence.suspendue': 'Agence suspendue',
  'agence.reactivee': 'Agence réactivée',
  'agence.supprimee': 'Agence supprimée',
  'agence.entree_support': 'Entrée en assistance',
  'agence.modifiee': 'Agence modifiée',
  'bureau.enregistre': 'Bureau enregistré',
  'membre.modifie': 'Membre modifié',
  'demande.mise_a_jour': 'Demande mise à jour',
  'demande.convertie': 'Demande convertie',
  'abonnement.modifie': 'Abonnement modifié',
  'commission.modifiee': 'Commission modifiée',
  'reglement.enregistre': 'Règlement constaté',
  'factures.generees': 'Factures générées',
  'grace.rouverte': 'Grâce rouverte',
  'ticket.repondu': 'Ticket répondu',
  'ticket.statut': 'Statut du ticket changé',
  'retour.traite': 'Retour traité',
  'annonce.enregistree': 'Annonce enregistrée',
  'annonce.publiee': 'Annonce publiée',
  'admin.invite': 'Admin invité',
  'admin.role': 'Rôle d’admin changé',
  'admin.actif': 'Admin activé ou désactivé',
  'admin.retire': 'Admin retiré',
  'tache.lancee': 'Tâche lancée à la main',
}

export const CIBLES: Record<AuditRow['target_kind'], string> = {
  agence: 'agence', demande: 'demande', abonnement: 'abonnement', reglement: 'règlement', ticket: 'ticket',
  annonce: 'annonce', admin: 'admin', tache: 'tâche', bureau: 'bureau', membre: 'membre', plateforme: 'plateforme',
}

const KINDS: Record<UrgentKind, string> = {
  demande: 'Demande', ticket: 'Ticket', suspendue: 'Suspendue', grace: 'Grâce',
  essai_fin: 'Fin d’essai', tache_echouee: 'Tâche', agence_inactive: 'Inactive',
}

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
/** « 2026-09 » ou « 2026-09-01 » → « sept. ». Si la forme surprend, on montre la clé telle quelle. */
export function moisCourt(m: string): string {
  const i = Number(m.slice(5, 7))
  return MOIS[i - 1] ?? m
}

/** Le nom d'une tâche, sans le préfixe visaflow_ qui ne dit rien à l'écran. */
export const nomTache = (job: string) => job.replace(/^visaflow_/, '')

/** L'état du dernier passage d'une tâche, en une pastille. */
export function EtatTache({ t }: { t: TacheRow }) {
  if (t.last_ok === true) return <Pill tone="green" dot>OK</Pill>
  if (t.last_ok === false) return <Pill tone="red" dot>Échec</Pill>
  return <Pill tone="gray">Jamais</Pill>
}

/* ------------------------------ L'écran ------------------------------ */

type Filtre = 'tout' | Severite

export function Cockpit() {
  const { me, can, rafraichirCompteurs } = usePlateforme()
  const toast = useToast()
  const { data, loading, refreshing, error, reload } = useChargement(loadCockpit)
  const [filtre, setFiltre] = useState<Filtre>('tout')
  const [enCours, setEnCours] = useState<string | null>(null)

  // Le matin, l'onglet reste ouvert : il se remet à jour tout seul, toutes
  // les 60 s et dès qu'on revient dessus. Jamais en arrière-plan, pour ne pas
  // interroger la base pour un écran que personne ne regarde.
  useEffect(() => {
    const visible = () => document.visibilityState === 'visible'
    const t = window.setInterval(() => { if (visible()) void reload() }, 60_000)
    const onVis = () => { if (visible()) void reload() }
    document.addEventListener('visibilitychange', onVis)
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [reload])

  const prenom = me.name.trim().split(/\s+/)[0] || me.email

  const lancer = async (job: string) => {
    setEnCours(job)
    try {
      const r = await runTache(job)
      toast(r.ok
        ? `${nomTache(job)} : ${nb(r.affected ?? 0)} lignes touchées en ${nb(r.ms)} ms.`
        : `${nomTache(job)} en échec : ${r.detail ?? 'sans détail'}.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Lancement impossible.')
    } finally {
      setEnCours(null)
      void reload()
      rafraichirCompteurs()
    }
  }

  const urgents = data?.urgents ?? []
  const comptes = useMemo(() => ({
    tout: urgents.length,
    critique: urgents.filter((u) => u.severity === 'critique').length,
    attention: urgents.filter((u) => u.severity === 'attention').length,
    info: urgents.filter((u) => u.severity === 'info').length,
  }), [urgents])
  const visibles = filtre === 'tout' ? urgents : urgents.filter((u) => u.severity === filtre)

  return (
    <div className="ck-page">
      <PageHeader
        kicker="Poste de pilotage"
        title={`Bonjour, ${prenom}`}
        subtitle={data ? `${nb(urgents.length)} ${urgents.length === 1 ? 'point à traiter' : 'points à traiter'} · généré ${depuis(data.generated_at)}` : undefined}
        refreshing={refreshing}
        actions={<>
          <Button icon="refresh" onClick={() => void reload()} disabled={refreshing}>Actualiser</Button>
          {can('agences.ouvrir') && <Link to="/admin/agences/nouvelle" className="btn btn--primary"><Icon name="plus" size={16} />Nouvelle agence</Link>}
        </>}
      />

      {error && <div className="ck-erreur"><Erreur message={error} onRetry={() => void reload()} /></div>}

      {loading && !data ? (
        <>
          <Squelette type="kpis" n={4} />
          <Squelette type="kpis" n={4} />
          <Section flush><Squelette type="table" n={6} /></Section>
        </>
      ) : data && (
        <>
          <Sante s={data.sante} />
          <Argent d={data} />
          <Parc d={data} />

          <div className="ck-grid">
            <Section
              title="À traiter maintenant"
              flush
              action={<span className="t-caption t-tertiary t-num">{nb(urgents.length)}</span>}
            >
              <div className="ck-filtres">
                <Segmented<Filtre>
                  value={filtre}
                  onChange={setFiltre}
                  label="Gravité"
                  options={[
                    { value: 'tout', label: `Tout · ${comptes.tout}` },
                    { value: 'critique', label: `Critique · ${comptes.critique}` },
                    { value: 'attention', label: `Attention · ${comptes.attention}` },
                    { value: 'info', label: `Info · ${comptes.info}` },
                  ]}
                />
              </div>
              {visibles.length === 0 ? (
                <Vide
                  title={urgents.length === 0 ? 'Rien ne brûle.' : 'Rien à ce niveau.'}
                  hint={urgents.length === 0 ? 'Les demandes, les grâces, les tickets urgents et les tâches en échec apparaîtront ici.' : 'Changez de filtre pour voir le reste.'}
                />
              ) : (
                <ul className="ck-urgents">
                  {visibles.map((u) => (
                    <LigneUrgent key={`${u.kind}:${u.id}`} u={u} peutLancer={can('taches.lancer')} enCours={enCours === u.id} onLancer={lancer} />
                  ))}
                </ul>
              )}
            </Section>

            <div>
              <Section title="Douze mois" action={<span className="t-caption t-tertiary">encaissé</span>}>
                {data.series.encaisse_12m.length === 0 ? (
                  <p className="t-small t-tertiary">Aucun encaissement sur douze mois.</p>
                ) : (
                  <div className="ck-barres-scroll">
                    <Barres
                      points={data.series.encaisse_12m.map((p: PointMois) => p.amount)}
                      labels={data.series.encaisse_12m.map((p: PointMois) => moisCourt(p.month))}
                      tone="green"
                      format={(n) => money(n)}
                    />
                  </div>
                )}
              </Section>
              <Section
                title="Activité de la plateforme"
                flush
                action={<Link to="/admin/journal" className="btn btn--ghost btn--sm">Tout le journal<Icon name="arrow" size={14} /></Link>}
              >
                {data.activite.length === 0 ? (
                  <Vide title="Aucun geste enregistré." hint="Le journal se remplit à chaque action de la console." />
                ) : (
                  <ul className="ck-activite">
                    {data.activite.slice(0, 20).map((a) => (
                      <li key={a.id} className="ck-activite__item">
                        <span className="ck-activite__ligne">
                          {LIBELLES[a.action] ?? a.action}
                          {a.target_label && <> · <strong>{a.target_label}</strong></>}
                        </span>
                        <span className="ck-activite__meta">
                          <span>{a.admin_name ?? a.admin_email ?? 'système'}</span>
                          <span>{depuis(a.at)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
          </div>

          <Section
            title="Tâches planifiées"
            flush
            action={<Link to="/admin/taches" className="btn btn--ghost btn--sm">Toutes les tâches<Icon name="arrow" size={14} /></Link>}
          >
            {data.taches.length === 0 ? (
              <Vide title="Aucune tâche planifiée sur cette base." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>Tâche</th><th>Planification</th><th>Dernier passage</th><th>État</th>
                    <th className="num">Lignes</th>
                    {can('taches.lancer') && <th className="actions" />}
                  </tr>
                </thead>
                <tbody>
                  {data.taches.map((t) => (
                    <tr key={t.job} className={t.active ? undefined : 'adm-row--off'}>
                      <td>
                        <div className="adm-cell-main">
                          <span>{nomTache(t.job)}</span>
                          {!t.active && <span className="t-caption">désactivée</span>}
                        </div>
                      </td>
                      <td className="t-mono t-caption">{t.schedule}</td>
                      <td className="t-caption t-tertiary">{dateHeure(t.last_run)}</td>
                      <td><EtatTache t={t} /></td>
                      <td className="num">{nb(t.last_affected)}</td>
                      {can('taches.lancer') && (
                        <td className="actions">
                          <Button size="sm" icon="automations" disabled={enCours === t.job} onClick={() => void lancer(t.job)}>
                            {enCours === t.job ? 'En cours…' : 'Lancer'}
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Section>
        </>
      )}
    </div>
  )
}

/* ------------------------------- Blocs ------------------------------- */

/** Quatre pastilles : vert quand tout va, rouge ou orange sinon. Chacune mène là où on répare. */
function Sante({ s }: { s: CockpitData['sante'] }) {
  const items: { n: number; label: string; to: string; tone: 'red' | 'orange' }[] = [
    { n: s.taches_en_echec, label: 'tâches en échec', to: '/admin/taches', tone: 'red' },
    { n: s.courriels_echoues_24h, label: 'courriels échoués sur 24 h', to: '/admin/journal', tone: 'orange' },
    { n: s.webhooks_echoues_24h, label: 'webhooks échoués sur 24 h', to: '/admin/journal', tone: 'red' },
    { n: s.whatsapp_en_attente, label: 'WhatsApp en attente', to: '/admin/journal', tone: 'orange' },
  ]
  return (
    <div className="ck-sante" aria-label="Santé de la plateforme">
      {items.map((it) => (
        <Link
          key={it.label}
          to={it.to}
          className={`ck-sante__item ${it.n > 0 ? `ck-sante__item--ko ck-sante__item--${it.tone}` : ''}`}
          title={it.n > 0 ? 'Voir le détail' : 'Rien à signaler'}
        >
          <span className="ck-sante__dot" aria-hidden="true" />
          <span className="ck-sante__n">{nb(it.n)}</span>
          <span>{it.label}</span>
        </Link>
      ))}
    </div>
  )
}

/** L'argent : ce qui rentre chaque mois, ce qui est rentré, ce qui pourrait rentrer. */
function Argent({ d }: { d: CockpitData }) {
  const k = d.kpis
  const s = d.series
  const delta = Math.round(k.mrr - k.mrr_il_y_a_30j)
  return (
    <KpiGrid>
      <Kpi
        label="Revenu mensuel récurrent"
        value={money(k.mrr)}
        delta={{ value: delta, suffix: ' TND' }}
        spark={s.mrr_12m.map((p) => p.amount)}
        tone="blue"
        to="/admin/abonnements"
        icon="payments"
      />
      <Kpi label="Revenu annuel" value={money(k.arr)} hint="douze fois le mensuel" icon="reports" />
      <Kpi
        label="Encaissé ce mois"
        value={money(k.encaisse_mois)}
        hint={`${money(k.encaisse_30j)} sur 30 jours`}
        spark={s.encaisse_12m.map((p) => p.amount)}
        tone="green"
        to="/admin/facturation"
        icon="check"
      />
      <Kpi
        label="Potentiel des essais"
        value={money(k.mrr_potentiel)}
        hint={`${nb(k.essais_en_cours)} ${k.essais_en_cours === 1 ? 'essai' : 'essais'}, ${nb(k.essais_finissant_7j)} ${k.essais_finissant_7j === 1 ? 'finit' : 'finissent'} sous 7 j`}
        tone="orange"
        to="/admin/facturation"
        icon="sparkle"
      />
    </KpiGrid>
  )
}

/** Le parc : les agences, les gens, les dossiers, les demandes. */
function Parc({ d }: { d: CockpitData }) {
  const k = d.kpis
  const s = d.series
  return (
    <KpiGrid>
      <Kpi
        label="Agences actives"
        value={nb(k.agences_actives)}
        hint={`${nb(k.agences_total)} au total · ${nb(k.agences_suspendues)} ${k.agences_suspendues === 1 ? 'suspendue' : 'suspendues'}`}
        spark={s.agences_12m.map((p) => p.n)}
        tone={k.agences_suspendues > 0 ? 'red' : 'gray'}
        to="/admin/agences"
        icon="building"
      />
      <Kpi
        label="Comptes actifs"
        value={nb(k.comptes_actifs)}
        hint={`${nb(k.connexions_24h)} ${k.connexions_24h === 1 ? 'connecté' : 'connectés'} sur 24 h`}
        spark={s.connexions_14j.map((p) => p.n)}
        tone="gray"
        icon="clients"
      />
      <Kpi
        label="Dossiers ouverts"
        value={nb(k.dossiers_ouverts)}
        hint={`${nb(k.dossiers_30j)} ${k.dossiers_30j === 1 ? 'ouvert' : 'ouverts'} sur 30 jours`}
        spark={s.dossiers_30j.map((p) => p.n)}
        tone="gray"
        icon="cases"
      />
      <Kpi
        label="Demandes nouvelles"
        value={nb(k.demandes_nouvelles)}
        spark={s.signups_30j.map((p) => p.n)}
        tone={k.demandes_nouvelles > 0 ? 'blue' : 'gray'}
        to="/admin/demandes"
        icon="bell"
      />
    </KpiGrid>
  )
}

/** Un point à traiter, avec les gestes qu'on peut faire d'ici. */
function LigneUrgent({ u, peutLancer, enCours, onLancer }: {
  u: Urgent; peutLancer: boolean; enCours: boolean; onLancer: (job: string) => Promise<void>
}) {
  // Les grâces et les fins d'essai comptent à rebours ; le reste dit depuis quand ça attend.
  const quand = u.kind === 'grace' || u.kind === 'essai_fin' ? delai(u.days) : depuis(u.since)
  const regler = u.agency_id ? `/admin/facturation?agence=${u.agency_id}&geste=regler` : u.url
  const rouvrir = u.agency_id ? `/admin/facturation?agence=${u.agency_id}&geste=rouvrir` : u.url
  const fiche = u.agency_id ? `/admin/agences/${u.agency_id}` : u.url
  const lien = (to: string, label: string, primary?: boolean) => (
    <Link to={to} className={`btn btn--sm ${primary ? 'btn--primary' : 'btn--secondary'}`}>{label}</Link>
  )
  return (
    <li className="ck-urgent">
      <Gravite niveau={u.severity} />
      <div className="ck-urgent__body">
        <span className="ck-urgent__title">{u.title}</span>
        {u.detail && <span className="ck-urgent__detail">{u.detail}</span>}
        <span className="ck-urgent__meta">
          <span className="ck-urgent__kind">{KINDS[u.kind]}</span>
          {u.agency_name && (
            <span>{u.agency_name}{u.agency_slug && <span className="t-mono"> · {u.agency_slug}</span>}</span>
          )}
          <span>{quand}</span>
        </span>
      </div>
      <div className="ck-urgent__actions">
        {u.kind === 'demande' && lien(u.url, 'Voir', true)}
        {u.kind === 'ticket' && lien(u.url, 'Répondre', true)}
        {u.kind === 'suspendue' && <>{lien(regler, 'Constater un règlement', true)}{lien(rouvrir, 'Rouvrir')}</>}
        {u.kind === 'grace' && lien(regler, 'Constater un règlement', true)}
        {u.kind === 'essai_fin' && lien(fiche, 'Voir l’agence')}
        {u.kind === 'agence_inactive' && lien(fiche, 'Ouvrir la fiche')}
        {u.kind === 'tache_echouee' && (peutLancer
          ? <Button size="sm" variant="primary" icon="refresh" disabled={enCours} onClick={() => void onLancer(u.id)}>{enCours ? 'En cours…' : 'Relancer'}</Button>
          : lien(u.url, 'Voir'))}
      </div>
    </li>
  )
}
