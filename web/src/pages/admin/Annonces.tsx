import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Button, Field, Input, Modal, Pill, Segmented, Select, Textarea, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import type { IconName } from '@/components/Icon'
import {
  Confirmer, Erreur, Gravite, Kpi, KpiGrid, PageHeader, Section, Squelette, Table, Vide,
  dateFr, dateHeure, nb, useChargement,
} from './kit'
import { usePlateforme } from './contexte'
import {
  ANNOUNCEMENT_KINDS, ANNOUNCEMENT_SEVERITIES, ANNOUNCEMENT_TARGETS,
  loadPlatformAnnouncements, publishAnnouncement, savePlatformAnnouncement,
} from '@/data/support'
import type { AnnouncementKind, AnnouncementSeverity, AnnouncementTarget, PlatformAnnouncement } from '@/data/support'
import type { I18nText, Locale } from '@/data/types'

/**
 * LES ANNONCES. Ce que toutes les agences, ou certaines, voient en bandeau.
 *
 * Deux choses que cet écran impose, et qui ne sont pas du confort :
 *
 * 1. QUATRE LANGUES. Une agence chinoise de Sfax lit le bandeau comme les
 *    autres. Le français fait foi et il est obligatoire ; les trois autres
 *    retombent dessus si elles manquent, mais l'écran les demande, parce
 *    qu'une annonce écrite un mardi ne se traduit jamais le mercredi.
 *
 * 2. UN BROUILLON D'ABORD. Rien n'est visible tant qu'on n'a pas publié, et
 *    publier passe par une confirmation. Une annonce critique envoyée à
 *    toutes les agences par un doigt qui glisse ne se rattrape pas : elle
 *    est déjà lue.
 */

const LANGS: { code: Locale; label: string }[] = [
  { code: 'fr', label: 'Français (fait foi)' },
  { code: 'en', label: 'Anglais' },
  { code: 'ar', label: 'Arabe' },
  { code: 'zh', label: 'Chinois' },
]

const KIND_LABEL: Record<AnnouncementKind, string> = {
  maintenance: 'Maintenance', nouveaute: 'Nouveauté', incident: 'Incident', pays: 'Alerte pays',
}
/* Les mêmes icônes que le bandeau des agences (AnnouncementBanner) : l'aperçu doit lui ressembler. */
const KIND_ICON: Record<AnnouncementKind, IconName> = {
  maintenance: 'settings', nouveaute: 'sparkle', incident: 'alert', pays: 'plane',
}
const SEVERITY_LABEL: Record<AnnouncementSeverity, string> = { info: 'Information', attention: 'Attention', critique: 'Critique' }
/* Les couleurs du bandeau, reprises telles quelles : le composant ne les exporte pas et on ne le modifie pas. */
const SEVERITY_STYLE: Record<AnnouncementSeverity, { bg: string; fg: string }> = {
  info: { bg: 'var(--tint-blue, rgba(0,102,204,.10))', fg: 'var(--blue, #0066CC)' },
  attention: { bg: 'var(--tint-orange, rgba(255,149,0,.12))', fg: 'var(--orange, #C25E00)' },
  critique: { bg: 'var(--tint-red, rgba(255,59,48,.12))', fg: 'var(--red, #C41E1E)' },
}
const TARGET_LABEL: Record<AnnouncementTarget, string> = {
  toutes: 'Toutes les agences', essai: 'Les agences en essai', payantes: 'Les agences payantes', une_agence: 'Une agence précise',
}

interface AgencyOption { id: string; name: string; slug: string }

interface Brouillon {
  id: string | null
  kind: AnnouncementKind
  title: Record<Locale, string>
  body: Record<Locale, string>
  severity: AnnouncementSeverity
  startsAt: string
  endsAt: string
  target: AnnouncementTarget
  targetAgencyId: string
}

const VIDE: Record<Locale, string> = { fr: '', en: '', ar: '', zh: '' }

const nouveau = (): Brouillon => ({
  id: null, kind: 'nouveaute', title: { ...VIDE }, body: { ...VIDE },
  severity: 'info', startsAt: '', endsAt: '', target: 'toutes', targetAgencyId: '',
})

/** Un jsonb qui ne garde que les langues remplies : une clé vide vaut moins que rien. */
function pack(v: Record<Locale, string>): I18nText {
  const out: Record<string, string> = {}
  for (const l of LANGS) if (v[l.code].trim()) out[l.code] = v[l.code].trim()
  return out as I18nText
}

function unpack(v: Partial<Record<Locale, string>> | undefined): Record<Locale, string> {
  return { fr: v?.fr ?? '', en: v?.en ?? '', ar: v?.ar ?? '', zh: v?.zh ?? '' }
}

/* Une annonce est « en cours » quand elle est publiée et que sa période la couvre. */
function enCours(a: PlatformAnnouncement, maintenant: number): boolean {
  if (!a.published_at) return false
  if (new Date(a.starts_at).getTime() > maintenant) return false
  if (a.ends_at && new Date(a.ends_at).getTime() < maintenant) return false
  return true
}

const message = (e: unknown, repli: string) => (e instanceof Error && e.message ? e.message : repli)

interface Donnees { annonces: PlatformAnnouncement[]; agences: AgencyOption[] }

async function charger(): Promise<Donnees> {
  const annonces = await loadPlatformAnnouncements()
  /* La liste des agences ne sert qu'au ciblage d'une seule : si elle manque, l'écran vit quand même. */
  let agences: AgencyOption[] = []
  if (supabase) {
    const { data } = await supabase.rpc('platform_agencies')
    if (Array.isArray(data)) agences = (data as AgencyOption[]).map((a) => ({ id: a.id, name: a.name, slug: a.slug }))
  }
  return { annonces, agences }
}

export function Annonces() {
  const toast = useToast()
  const { can, rafraichirCompteurs } = usePlateforme()
  const { data, loading, refreshing, error, reload } = useChargement(charger)

  const publier = can('annonces.publier')
  const [brouillon, setBrouillon] = useState<Brouillon | null>(null)
  const [aPublier, setAPublier] = useState<PlatformAnnouncement | null>(null)
  const [busy, setBusy] = useState(false)

  const annonces = data?.annonces ?? []
  const kpis = useMemo(() => {
    const maintenant = Date.now()
    return {
      enCours: annonces.filter((a) => enCours(a, maintenant)).length,
      brouillons: annonces.filter((a) => !a.published_at).length,
      lectures: annonces.reduce((s, a) => s + a.reads, 0),
    }
  }, [annonces])

  const apres = async (texte: string) => {
    toast(texte)
    await reload()
    rafraichirCompteurs()
  }

  const modifier = (a: PlatformAnnouncement) => setBrouillon({
    id: a.id, kind: a.kind, title: unpack(a.title), body: unpack(a.body), severity: a.severity,
    startsAt: a.starts_at ? a.starts_at.slice(0, 16) : '',
    endsAt: a.ends_at ? a.ends_at.slice(0, 16) : '',
    target: a.target, targetAgencyId: a.target_agency_id ?? '',
  })

  const enregistrer = async () => {
    if (!brouillon) return
    if (!brouillon.title.fr.trim()) { toast('Le titre français fait foi : il ne peut pas être vide.'); return }
    if (brouillon.target === 'une_agence' && !brouillon.targetAgencyId) { toast('Choisissez l’agence visée.'); return }
    setBusy(true)
    try {
      await savePlatformAnnouncement({
        id: brouillon.id, kind: brouillon.kind,
        title: pack(brouillon.title), body: pack(brouillon.body),
        severity: brouillon.severity,
        startsAt: brouillon.startsAt ? new Date(brouillon.startsAt).toISOString() : null,
        endsAt: brouillon.endsAt ? new Date(brouillon.endsAt).toISOString() : null,
        target: brouillon.target,
        targetAgencyId: brouillon.target === 'une_agence' ? brouillon.targetAgencyId : null,
      })
      setBrouillon(null)
      await apres(brouillon.id ? 'Annonce enregistrée.' : 'Annonce enregistrée. Elle reste un brouillon tant qu’elle n’est pas publiée.')
    } catch (e) { toast(message(e, 'Enregistrement impossible.')) } finally { setBusy(false) }
  }

  const basculer = async (a: PlatformAnnouncement) => {
    const vers = a.published_at === null
    setBusy(true)
    try {
      await publishAnnouncement(a.id, vers)
      setAPublier(null)
      await apres(vers ? 'Annonce publiée : les agences visées la voient dès maintenant.' : 'Annonce dépubliée.')
    } catch (e) { toast(message(e, 'Publication impossible.')) } finally { setBusy(false) }
  }

  const cible = (a: PlatformAnnouncement) => a.target === 'une_agence' ? (a.target_agency_name ?? 'une agence') : TARGET_LABEL[a.target]

  return (
    <>
      <PageHeader
        kicker="Relation"
        title="Annonces"
        subtitle="Ce que toutes les agences, ou certaines, voient en bandeau."
        refreshing={refreshing}
        actions={publier && <Button variant="primary" icon="plus" onClick={() => setBrouillon(nouveau())}>Nouvelle annonce</Button>}
      />

      {error && !data && <Erreur message={error} onRetry={() => void reload()} />}

      {loading ? <Squelette type="kpis" n={3} /> : (
        <KpiGrid>
          <Kpi label="En cours" value={nb(kpis.enCours)} icon="bell" tone="blue" hint="publiées et dans leur période" />
          <Kpi label="Brouillons" value={nb(kpis.brouillons)} icon="edit" tone={kpis.brouillons ? 'orange' : 'gray'} />
          <Kpi label="Lectures" value={nb(kpis.lectures)} icon="eye" hint="toutes annonces confondues" />
        </KpiGrid>
      )}

      <Section flush>
        {loading ? <Squelette type="table" n={5} /> : annonces.length === 0 ? (
          <Vide
            title="Aucune annonce."
            hint="Une maintenance, une nouveauté, un incident, une alerte pays : le bandeau est lu, le courriel ne l’est pas."
            action={publier ? <Button variant="primary" icon="plus" onClick={() => setBrouillon(nouveau())}>Écrire la première</Button> : undefined}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <th aria-label="Gravité" /><th>Titre</th><th>Cible</th><th>Période</th>
                <th className="num">Lue par</th><th>État</th>
                {publier && <th className="actions" aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {annonces.map((a) => (
                <tr key={a.id} className={a.published_at ? '' : 'adm-row--off'}>
                  <td style={{ width: 24 }}><Gravite niveau={a.severity} /></td>
                  <td>
                    <div className="adm-cell-main" style={{ maxWidth: 420 }}>
                      <span style={{ overflowWrap: 'anywhere' }}>{a.title.fr}</span>
                      <span className="t-caption">{KIND_LABEL[a.kind]} · {SEVERITY_LABEL[a.severity].toLowerCase()}</span>
                    </div>
                  </td>
                  <td className="t-small">{cible(a)}</td>
                  <td className="t-caption t-tertiary" style={{ whiteSpace: 'nowrap' }}>
                    {dateFr(a.starts_at)}{a.ends_at ? ` → ${dateFr(a.ends_at)}` : ' → sans fin'}
                  </td>
                  <td className="num">{nb(a.reads)}</td>
                  <td>
                    <Pill tone={a.published_at ? 'green' : 'gray'} dot>{a.published_at ? 'Publiée' : 'Brouillon'}</Pill>
                  </td>
                  {publier && (
                    <td className="actions">
                      <span className="row gap-2" style={{ justifyContent: 'flex-end' }}>
                        <Button size="sm" icon="edit" disabled={busy} onClick={() => modifier(a)}>Modifier</Button>
                        {a.published_at
                          ? <Button size="sm" icon="lock" disabled={busy} onClick={() => void basculer(a)}>Dépublier</Button>
                          : <Button size="sm" variant="primary" icon="check" disabled={busy} onClick={() => setAPublier(a)}>Publier</Button>}
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      {aPublier && (
        <Confirmer
          title="Publier l’annonce"
          label="Publier"
          danger={aPublier.severity === 'critique'}
          busy={busy}
          onConfirm={() => void basculer(aPublier)}
          onClose={() => setAPublier(null)}
        >
          <div className="col gap-3">
            <span>« {aPublier.title.fr} » sera visible par <strong>{cible(aPublier).toLowerCase()}</strong> dès {aPublier.starts_at && new Date(aPublier.starts_at).getTime() > Date.now() ? `le ${dateHeure(aPublier.starts_at)}` : 'maintenant'}.</span>
            <Apercu kind={aPublier.kind} severity={aPublier.severity} title={aPublier.title.fr} body={aPublier.body.fr ?? ''} endsAt={aPublier.ends_at} />
            <span className="t-caption t-tertiary">Une annonce lue ne se reprend pas. Relisez-la avant de publier.</span>
          </div>
        </Confirmer>
      )}

      {brouillon && (
        <Formulaire
          brouillon={brouillon}
          agences={data?.agences ?? []}
          busy={busy}
          onChange={setBrouillon}
          onSave={() => void enregistrer()}
          onClose={() => setBrouillon(null)}
        />
      )}
    </>
  )
}

/* ----------------------------- L'aperçu ------------------------------ */

/**
 * Le bandeau tel qu'une agence le verra. Même disposition, mêmes couleurs,
 * même icône que AnnouncementBanner ; seul le bouton est inerte.
 */
function Apercu({ kind, severity, title, body, endsAt }: {
  kind: AnnouncementKind; severity: AnnouncementSeverity; title: string; body: string; endsAt: string | null
}) {
  const style = SEVERITY_STYLE[severity]
  return (
    <div
      className="row gap-3"
      aria-label="Aperçu du bandeau"
      style={{
        background: style.bg, color: style.fg, padding: 'var(--sp-3) var(--sp-5)',
        alignItems: 'center', border: '1px solid var(--hairline)', borderRadius: 'var(--radius-card-sm)', minWidth: 0,
      }}
    >
      <Icon name={KIND_ICON[kind]} size={18} />
      <span className="col grow" style={{ minWidth: 0 }}>
        <span className="row gap-2 wrap">
          <span className="t-small t-medium" style={{ overflowWrap: 'anywhere' }}>{title || 'Le titre de l’annonce'}</span>
          <span className="t-caption" style={{ opacity: 0.8 }}>{KIND_LABEL[kind]}</span>
          {endsAt && <span className="t-caption" style={{ opacity: 0.8 }}>· {dateFr(endsAt)}</span>}
        </span>
        {body && <span className="t-caption" style={{ opacity: 0.9, overflowWrap: 'anywhere' }}>{body}</span>}
      </span>
      <Button size="sm" disabled>Compris</Button>
    </div>
  )
}

/* --------------------------- Le formulaire --------------------------- */

function Formulaire({ brouillon, agences, busy, onChange, onSave, onClose }: {
  brouillon: Brouillon; agences: AgencyOption[]; busy: boolean
  onChange: (b: Brouillon) => void; onSave: () => void; onClose: () => void
}) {
  const [langue, setLangue] = useState<Locale>('fr')
  const b = brouillon
  /* L'aperçu montre la langue choisie ; une langue vide retombe sur le français, comme dans l'espace des agences. */
  const titreApercu = b.title[langue].trim() || b.title.fr
  const corpsApercu = b.body[langue].trim() || b.body.fr

  return (
    <Modal
      title={b.id ? 'Modifier l’annonce' : 'Nouvelle annonce'}
      onClose={onClose}
      wide
      footer={<>
        <span className="grow" />
        <Button onClick={onClose}>Annuler</Button>
        <Button variant="primary" icon="save" disabled={busy} onClick={onSave}>{busy ? 'Enregistrement…' : 'Enregistrer'}</Button>
      </>}
    >
      <div className="col gap-4">
        <div className="col gap-2">
          <div className="row gap-2 wrap" style={{ justifyContent: 'space-between' }}>
            <span className="t-caption t-tertiary">Aperçu, tel qu’une agence le verra</span>
            <Segmented<Locale> value={langue} onChange={setLangue} label="Langue de l’aperçu" options={LANGS.map((l) => ({ value: l.code, label: l.code.toUpperCase() }))} />
          </div>
          <div dir={langue === 'ar' ? 'rtl' : 'ltr'}>
            <Apercu kind={b.kind} severity={b.severity} title={titreApercu} body={corpsApercu} endsAt={b.endsAt ? new Date(b.endsAt).toISOString() : null} />
          </div>
        </div>

        <div className="grid grid--2">
          <Field label="Nature">
            <Select value={b.kind} onChange={(e) => onChange({ ...b, kind: e.target.value as AnnouncementKind })}>
              {ANNOUNCEMENT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </Select>
          </Field>
          <Field label="Gravité" hint="Le critique est rouge. Il n’y a pas de niveau au-dessus.">
            <Select value={b.severity} onChange={(e) => onChange({ ...b, severity: e.target.value as AnnouncementSeverity })}>
              {ANNOUNCEMENT_SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
            </Select>
          </Field>
        </div>

        <div className="grid grid--2">
          <Field label="Cible">
            <Select value={b.target} onChange={(e) => onChange({ ...b, target: e.target.value as AnnouncementTarget })}>
              {ANNOUNCEMENT_TARGETS.map((tg) => <option key={tg} value={tg}>{TARGET_LABEL[tg]}</option>)}
            </Select>
          </Field>
          {b.target === 'une_agence' && (
            <Field label="Agence visée" error={agences.length === 0 ? 'La liste des agences n’a pas pu être chargée.' : undefined}>
              <Select value={b.targetAgencyId} onChange={(e) => onChange({ ...b, targetAgencyId: e.target.value })}>
                <option value="">Choisir…</option>
                {agences.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.slug})</option>)}
              </Select>
            </Field>
          )}
        </div>

        <div className="grid grid--2">
          <Field label="Visible à partir du" hint="Vide : tout de suite.">
            <Input type="datetime-local" value={b.startsAt} onChange={(e) => onChange({ ...b, startsAt: e.target.value })} />
          </Field>
          <Field label="Jusqu’au" hint="Vide : jusqu’au retrait.">
            <Input type="datetime-local" value={b.endsAt} onChange={(e) => onChange({ ...b, endsAt: e.target.value })} />
          </Field>
        </div>

        {LANGS.map((l) => (
          <div key={l.code} className="col gap-2">
            <span className="t-small t-medium">{l.label}</span>
            <Field label="Titre" error={l.code === 'fr' && !b.title.fr.trim() ? 'Obligatoire : le français fait foi.' : undefined}>
              <Input
                dir={l.code === 'ar' ? 'rtl' : 'ltr'}
                value={b.title[l.code]}
                onFocus={() => setLangue(l.code)}
                onChange={(e) => onChange({ ...b, title: { ...b.title, [l.code]: e.target.value } })}
              />
            </Field>
            <Field label="Message" hint={l.code === 'fr' ? 'Facultatif : une annonce peut n’être qu’un titre.' : undefined}>
              <Textarea
                rows={2}
                dir={l.code === 'ar' ? 'rtl' : 'ltr'}
                value={b.body[l.code]}
                onFocus={() => setLangue(l.code)}
                onChange={(e) => onChange({ ...b, body: { ...b.body, [l.code]: e.target.value } })}
              />
            </Field>
          </div>
        ))}

        <p className="t-caption t-tertiary" style={{ margin: 0 }}>
          Une annonce enregistrée reste un brouillon : personne ne la voit tant qu’elle n’est pas publiée depuis la liste.
        </p>
      </div>
    </Modal>
  )
}
