import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Button, Card, Empty, Field, Input, Modal, Pill, Select, Textarea, useToast } from '@/components/ui'
import {
  ANNOUNCEMENT_KINDS, ANNOUNCEMENT_SEVERITIES, ANNOUNCEMENT_TARGETS,
  loadPlatformAnnouncements, publishAnnouncement, savePlatformAnnouncement,
} from '@/data/support'
import type {
  AnnouncementKind, AnnouncementSeverity, AnnouncementTarget, PlatformAnnouncement,
} from '@/data/support'
import type { I18nText, Locale } from '@/data/types'

/* La rédaction des annonces, côté plateforme.
   En français en dur, comme le reste de la console.

   Deux choses que cet écran impose, et qui ne sont pas du confort :

   1. QUATRE LANGUES. Une agence chinoise de Sfax lit le bandeau comme les
      autres. Le français fait foi et il est obligatoire ; les trois autres
      retombent dessus si elles manquent, mais l'écran les demande, parce qu'une
      annonce écrite un mardi ne se traduit jamais le mercredi.

   2. UN BROUILLON D'ABORD. Rien n'est visible tant qu'on n'a pas publié. Une
      annonce critique envoyée à toutes les agences par un doigt qui glisse ne
      se rattrape pas : elle est déjà lue. */

const LANGS: { code: Locale; label: string }[] = [
  { code: 'fr', label: 'Français (fait foi)' },
  { code: 'en', label: 'Anglais' },
  { code: 'ar', label: 'Arabe' },
  { code: 'zh', label: 'Chinois' },
]

const KIND_LABEL: Record<AnnouncementKind, string> = {
  maintenance: 'Maintenance', nouveaute: 'Nouveauté', incident: 'Incident', pays: 'Alerte pays',
}

const SEVERITY_LABEL: Record<AnnouncementSeverity, string> = {
  info: 'Information', attention: 'Attention', critique: 'Critique',
}

const SEVERITY_TONE: Record<AnnouncementSeverity, 'blue' | 'orange' | 'red'> = {
  info: 'blue', attention: 'orange', critique: 'red',
}

const TARGET_LABEL: Record<AnnouncementTarget, string> = {
  toutes: 'Toutes les agences',
  essai: 'Les agences en essai',
  payantes: 'Les agences payantes',
  une_agence: 'Une agence précise',
}

interface AgencyOption { id: string; name: string; slug: string }

type Draft = {
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

const NOUVELLE: Draft = {
  id: null, kind: 'nouveaute', title: { ...VIDE }, body: { ...VIDE },
  severity: 'info', startsAt: '', endsAt: '', target: 'toutes', targetAgencyId: '',
}

/** Un jsonb qui ne garde que les langues remplies : une clé vide vaut moins que rien. */
function pack(v: Record<Locale, string>): I18nText {
  const out: Record<string, string> = {}
  for (const l of LANGS) if (v[l.code].trim()) out[l.code] = v[l.code].trim()
  return out as I18nText
}

function unpack(v: Partial<Record<Locale, string>> | undefined): Record<Locale, string> {
  return {
    fr: v?.fr ?? '', en: v?.en ?? '', ar: v?.ar ?? '', zh: v?.zh ?? '',
  }
}

export function Announcements() {
  const toast = useToast()
  const [rows, setRows] = useState<PlatformAnnouncement[]>([])
  const [agencies, setAgencies] = useState<AgencyOption[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setRows(await loadPlatformAnnouncements()) } catch (e) { toast((e as Error).message) }
    if (supabase) {
      const { data } = await supabase.rpc('platform_agencies')
      if (data) setAgencies((data as AgencyOption[]).map((a) => ({ id: a.id, name: a.name, slug: a.slug })))
    }
  }, [toast])

  useEffect(() => { void load() }, [load])

  const edit = (a: PlatformAnnouncement) => setDraft({
    id: a.id, kind: a.kind, title: unpack(a.title), body: unpack(a.body),
    severity: a.severity,
    startsAt: a.starts_at ? a.starts_at.slice(0, 16) : '',
    endsAt: a.ends_at ? a.ends_at.slice(0, 16) : '',
    target: a.target, targetAgencyId: a.target_agency_id ?? '',
  })

  const save = async () => {
    if (!draft) return
    if (!draft.title.fr.trim()) { toast('Le titre français fait foi : il ne peut pas être vide.'); return }
    if (draft.target === 'une_agence' && !draft.targetAgencyId) { toast('Choisissez l’agence visée.'); return }
    setBusy(true)
    try {
      await savePlatformAnnouncement({
        id: draft.id, kind: draft.kind,
        title: pack(draft.title), body: pack(draft.body),
        severity: draft.severity,
        startsAt: draft.startsAt ? new Date(draft.startsAt).toISOString() : null,
        endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : null,
        target: draft.target,
        targetAgencyId: draft.target === 'une_agence' ? draft.targetAgencyId : null,
      })
      setDraft(null)
      await load()
      toast('Annonce enregistrée. Elle reste un brouillon tant qu’elle n’est pas publiée.')
    } catch (e) { toast((e as Error).message) } finally { setBusy(false) }
  }

  const togglePublish = async (a: PlatformAnnouncement) => {
    setBusy(true)
    try {
      await publishAnnouncement(a.id, a.published_at === null)
      await load()
      toast(a.published_at === null ? 'Annonce publiée.' : 'Annonce retirée.')
    } catch (e) { toast((e as Error).message) } finally { setBusy(false) }
  }

  const quand = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-TN') : '—')

  return (
    <>
      <Card
        title="Annonces"
        action={<Button icon="plus" onClick={() => setDraft({ ...NOUVELLE, title: { ...VIDE }, body: { ...VIDE } })}>Nouvelle annonce</Button>}
        flush
      >
        {rows.length === 0 ? (
          <div style={{ padding: 'var(--sp-6)' }}><Empty title="Aucune annonce." /></div>
        ) : (
          <div className="admin__scroll">
            <table className="admin__table">
              <thead>
                <tr>
                  <th>Titre</th><th>Nature</th><th>Gravité</th><th>Cible</th>
                  <th>Du</th><th>Au</th><th className="num">Lue par</th><th>État</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className={a.published_at ? '' : 'admin__row--off'}>
                    <td className="t-small t-medium">{a.title.fr}</td>
                    <td className="t-caption t-secondary">{KIND_LABEL[a.kind]}</td>
                    <td><Pill tone={SEVERITY_TONE[a.severity]}>{SEVERITY_LABEL[a.severity]}</Pill></td>
                    <td className="t-caption">
                      {a.target === 'une_agence' ? (a.target_agency_name ?? 'une agence') : TARGET_LABEL[a.target]}
                    </td>
                    <td className="t-caption t-tertiary">{quand(a.starts_at)}</td>
                    <td className="t-caption t-tertiary">{quand(a.ends_at)}</td>
                    <td className="num">{a.reads}</td>
                    <td>
                      <Pill tone={a.published_at ? 'green' : 'gray'} dot>
                        {a.published_at ? 'Publiée' : 'Brouillon'}
                      </Pill>
                    </td>
                    <td>
                      <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
                        <Button icon="edit" onClick={() => edit(a)}>Modifier</Button>
                        <Button
                          icon={a.published_at ? 'lock' : 'check'}
                          disabled={busy}
                          onClick={() => void togglePublish(a)}
                        >
                          {a.published_at ? 'Retirer' : 'Publier'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {draft && (
        <Modal
          title={draft.id ? 'Modifier l’annonce' : 'Nouvelle annonce'}
          onClose={() => setDraft(null)}
          wide
          footer={
            <>
              <span className="grow" />
              <Button onClick={() => setDraft(null)}>Annuler</Button>
              <Button variant="primary" disabled={busy} onClick={() => void save()}>Enregistrer</Button>
            </>
          }
        >
          <div className="col gap-4">
            <div className="grid grid--2">
              <Field label="Nature">
                <Select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as AnnouncementKind })}>
                  {ANNOUNCEMENT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </Select>
              </Field>
              <Field label="Gravité" hint="Le critique est rouge. Il n’y a pas de niveau au-dessus.">
                <Select value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value as AnnouncementSeverity })}>
                  {ANNOUNCEMENT_SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
                </Select>
              </Field>
            </div>

            <div className="grid grid--2">
              <Field label="Cible">
                <Select value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value as AnnouncementTarget })}>
                  {ANNOUNCEMENT_TARGETS.map((tg) => <option key={tg} value={tg}>{TARGET_LABEL[tg]}</option>)}
                </Select>
              </Field>
              {draft.target === 'une_agence' && (
                <Field label="Agence visée">
                  <Select value={draft.targetAgencyId} onChange={(e) => setDraft({ ...draft, targetAgencyId: e.target.value })}>
                    <option value="">Choisir…</option>
                    {agencies.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.slug})</option>)}
                  </Select>
                </Field>
              )}
            </div>

            <div className="grid grid--2">
              <Field label="Visible à partir du" hint="Vide : tout de suite.">
                <Input type="datetime-local" value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} />
              </Field>
              <Field label="Jusqu’au" hint="Vide : jusqu’au retrait.">
                <Input type="datetime-local" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} />
              </Field>
            </div>

            {LANGS.map((l) => (
              <div key={l.code} className="col gap-2">
                <span className="t-small t-medium">{l.label}</span>
                <Field label="Titre">
                  <Input
                    dir={l.code === 'ar' ? 'rtl' : 'ltr'}
                    value={draft.title[l.code]}
                    onChange={(e) => setDraft({ ...draft, title: { ...draft.title, [l.code]: e.target.value } })}
                  />
                </Field>
                <Field label="Message">
                  <Textarea
                    rows={2}
                    dir={l.code === 'ar' ? 'rtl' : 'ltr'}
                    value={draft.body[l.code]}
                    onChange={(e) => setDraft({ ...draft, body: { ...draft.body, [l.code]: e.target.value } })}
                  />
                </Field>
              </div>
            ))}

            <p className="t-caption t-tertiary">
              Une annonce enregistrée reste un brouillon : personne ne la voit tant qu’elle
              n’est pas publiée. Une annonce critique envoyée par erreur ne se rattrape pas,
              elle est déjà lue.
            </p>
          </div>
        </Modal>
      )}
    </>
  )
}
