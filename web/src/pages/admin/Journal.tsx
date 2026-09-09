import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, Input, Modal, Select } from '@/components/ui'
import { Barre, Erreur, PageHeader, Section, Squelette, Table, Vide, dateHeure, depuis, nb, telechargerCsv, useChargement } from './kit'
import { loadAudit } from '@/data/plateforme'
import type { AuditAction, AuditRow } from '@/data/plateforme'
import { CIBLES, LIBELLES } from './Cockpit'
import '@/styles/admin-cockpit.css'

/**
 * LE JOURNAL. Chaque geste de la console, par qui, sur quoi.
 *
 * Le serveur filtre par action et par agence (c'est lui qui a l'index) ;
 * l'écran filtre par admin et par texte sur ce qu'il a déjà chargé, sans
 * repartir en base à chaque lettre tapée.
 */

const ACTIONS = Object.keys(LIBELLES) as AuditAction[]

/** Un résumé lisible des clés du détail, sans l'identifiant d'agence qui n'apprend rien à l'œil. */
function resume(detail: Record<string, unknown> | null): string {
  if (!detail) return ''
  return Object.entries(detail)
    .filter(([k]) => k !== 'agency_id')
    .map(([k, v]) => {
      const s = v === null || v === undefined ? '∅'
        : typeof v === 'object' ? JSON.stringify(v)
        : String(v)
      return `${k} : ${s.length > 60 ? s.slice(0, 57) + '…' : s}`
    })
    .join(' · ')
}

export function Journal() {
  const [params] = useSearchParams()
  const agence = params.get('agence')
  const [action, setAction] = useState<AuditAction | ''>('')
  const [admin, setAdmin] = useState('')
  const [texte, setTexte] = useState('')
  const [ouvert, setOuvert] = useState<AuditRow | null>(null)

  const { data, loading, refreshing, error, reload } = useChargement(
    () => loadAudit({ limit: 300, action: action || null, agency: agence }),
    [action, agence],
  )
  const lignes = data ?? []

  const admins = useMemo(() => {
    const set = new Set<string>()
    for (const l of lignes) if (l.admin_email) set.add(l.admin_email)
    return [...set].sort()
  }, [lignes])

  const visibles = useMemo(() => {
    const q = texte.trim().toLowerCase()
    return lignes.filter((l) =>
      (!admin || l.admin_email === admin) &&
      (!q || (l.target_label ?? '').toLowerCase().includes(q) || (l.admin_email ?? '').toLowerCase().includes(q)))
  }, [lignes, admin, texte])

  const exporter = () => telechargerCsv(`journal-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['Quand', 'Qui', 'Courriel', 'Geste', 'Cible', 'Type', 'Identifiant', 'Détail'],
    ...visibles.map((l) => [
      l.at, l.admin_name, l.admin_email, LIBELLES[l.action] ?? l.action, l.target_label, CIBLES[l.target_kind] ?? l.target_kind, l.target_id,
      l.detail ? JSON.stringify(l.detail) : '',
    ]),
  ])

  return (
    <div className="ck-page">
      <PageHeader
        kicker="Plateforme"
        title="Journal"
        subtitle={agence ? <>Chaque geste de la console sur cette agence. <Link to="/admin/journal">Tout le journal</Link></> : 'Chaque geste de la console, par qui, sur quoi.'}
        refreshing={refreshing}
        actions={<Button icon="refresh" onClick={() => void reload()} disabled={refreshing}>Actualiser</Button>}
      />

      {error && <div className="ck-erreur"><Erreur message={error} onRetry={() => void reload()} /></div>}

      <Section flush>
        <Barre right={<Button icon="download" onClick={exporter} disabled={visibles.length === 0}>Exporter CSV</Button>}>
          <Select className="ck-select" aria-label="Geste" value={action} onChange={(e) => setAction(e.target.value as AuditAction | '')}>
            <option value="">Toutes les actions</option>
            {ACTIONS.map((a) => <option key={a} value={a}>{LIBELLES[a]}</option>)}
          </Select>
          <Select className="ck-select" aria-label="Admin" value={admin} onChange={(e) => setAdmin(e.target.value)}>
            <option value="">Tous les admins</option>
            {admins.map((a) => <option key={a} value={a}>{a}</option>)}
          </Select>
          <Input className="ck-champ" aria-label="Filtrer" placeholder="Filtrer par cible ou courriel" value={texte} onChange={(e) => setTexte(e.target.value)} />
          <span className="t-caption t-tertiary t-num">{nb(visibles.length)} / {nb(lignes.length)}</span>
        </Barre>

        {loading && !data ? <Squelette type="table" n={8} /> : visibles.length === 0 ? (
          <Vide
            title={lignes.length === 0 ? 'Aucun geste enregistré.' : 'Rien ne correspond à ce filtre.'}
            hint={lignes.length === 0 ? 'Le journal se remplit à chaque action de la console.' : 'Élargissez le filtre ou videz le champ de recherche.'}
          />
        ) : (
          <Table>
            <thead>
              <tr><th>Quand</th><th>Qui</th><th>Geste</th><th>Cible</th><th>Détail</th></tr>
            </thead>
            <tbody>
              {visibles.map((l) => (
                <tr key={l.id}>
                  <td>
                    <div className="adm-cell-main">
                      <span className="t-num">{dateHeure(l.at)}</span>
                      <span className="t-caption">{depuis(l.at)}</span>
                    </div>
                  </td>
                  <td>
                    <div className="adm-cell-main">
                      <span>{l.admin_name ?? l.admin_email ?? 'système'}</span>
                      {l.admin_name && l.admin_email && <span className="t-caption">{l.admin_email}</span>}
                    </div>
                  </td>
                  <td>{LIBELLES[l.action] ?? l.action}</td>
                  <td>
                    <div className="adm-cell-main">
                      {l.target_kind === 'agence' && l.target_id
                        ? <Link to={`/admin/agences/${l.target_id}`}>{l.target_label ?? l.target_id}</Link>
                        : <span>{l.target_label ?? l.target_id ?? "sans cible"}</span>}
                      <span className="t-caption">{CIBLES[l.target_kind] ?? l.target_kind}</span>
                    </div>
                  </td>
                  <td>
                    {l.detail && Object.keys(l.detail).length > 0 ? (
                      <div className="ck-detail-cell">
                        <span className="ck-detail">{resume(l.detail) || 'voir le détail'}</span>
                        <Button size="sm" icon="dots" aria-label="Voir le détail complet" onClick={() => setOuvert(l)} />
                      </div>
                    ) : <span className="t-caption t-tertiary">sans détail</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      {ouvert && (
        <Modal title={`${LIBELLES[ouvert.action] ?? ouvert.action}${ouvert.target_label ? ` · ${ouvert.target_label}` : ''}`} onClose={() => setOuvert(null)} wide>
          <div className="col gap-3">
            <span className="t-caption t-tertiary">{dateHeure(ouvert.at)} · {ouvert.admin_name ?? ouvert.admin_email ?? 'système'}</span>
            <pre className="ck-json">{JSON.stringify(ouvert.detail, null, 2)}</pre>
          </div>
        </Modal>
      )}
    </div>
  )
}
