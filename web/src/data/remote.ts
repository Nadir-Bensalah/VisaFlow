import { supabase } from '@/lib/supabase'
import { camelKeys, snakeKeys } from '@/lib/case'
import type { Database, VisaCase, CaseNote } from './types'

/* La couche distante : elle charge l'agence connectée depuis Supabase et
   pousse les mutations. Le reste de l'application ne la voit pas : le magasin
   présente le même objet Database et les mêmes actions, qu'on soit en
   démonstration locale ou branché sur le vrai backend.

   Le format du front (camelCase, quelques champs imbriqués hérités du jeu de
   démonstration) ne colle pas exactement au schéma SQL (snake_case, tables
   séparées). Ce fichier est le seul endroit qui connaît les deux mondes. */

function client() {
  if (!supabase) throw new Error('backend absent')
  return supabase
}

/** L'agence de la personne connectée, lue depuis son profil. */
export async function currentAgencyId(): Promise<string | null> {
  const { data } = await client().auth.getUser()
  if (!data.user) return null
  const { data: prof } = await client()
    .from('profiles').select('agency_id').eq('id', data.user.id).maybeSingle()
  return prof?.agency_id ?? null
}

async function rows(table: string, agencyId: string, order?: string): Promise<any[]> {
  let q = client().from(table).select('*').eq('agency_id', agencyId)
  if (order) q = q.order(order)
  const { data, error } = await q
  if (error) throw new Error(`${table}: ${error.message}`)
  return (data ?? []).map((r) => camelKeys(r))
}

/** Charge toute l'agence en un instantané, au format Database du front. */
export async function loadSnapshot(agencyId: string): Promise<Database> {
  const sb = client()

  const [
    agencyRow, offices, users, clients, visaTypes, consulates, checklists,
    checklistVersions, cases, documents, custody, notes, messages, templates,
    appointments, payments, rules, events, tasks, shipments, shipmentDocs,
    shipmentEvents, requests, queue, attempts,
    lots, legs, tariffs, bls, declarations, customsArticles, tce, stays, providers,
  ] = await Promise.all([
    sb.from('agencies').select('*').eq('id', agencyId).single(),
    rows('offices', agencyId),
    rows('profiles', agencyId),
    rows('clients', agencyId, 'created_at'),
    rows('visa_types', agencyId),
    rows('consulates', agencyId),
    rows('checklists', agencyId),
    rows('checklist_versions', agencyId),
    rows('cases', agencyId, 'opened_at'),
    rows('case_documents', agencyId),
    rows('passport_custody', agencyId),
    rows('case_notes', agencyId),
    rows('messages', agencyId),
    rows('message_templates', agencyId),
    rows('appointments', agencyId),
    rows('payments', agencyId),
    rows('automation_rules', agencyId),
    // Le journal est lourd : on ne prend que le récent.
    sb.from('activity_events').select('*').eq('agency_id', agencyId).order('at', { ascending: false }).limit(200),
    rows('tasks', agencyId),
    rows('shipments', agencyId),
    rows('shipment_documents', agencyId),
    rows('shipment_events', agencyId),
    rows('client_requests', agencyId),
    rows('appointment_queue', agencyId),
    rows('slot_attempts', agencyId),
    // Le fret réel : les lots du groupage, les tronçons du trajet, les barèmes
    // de stationnement, les deux niveaux de connaissement et la douane.
    rows('shipment_lots', agencyId),
    rows('shipment_legs', agencyId),
    rows('demurrage_tariffs', agencyId),
    rows('bills_of_lading', agencyId),
    rows('customs_declarations', agencyId),
    rows('customs_articles', agencyId),
    rows('tce_titles', agencyId),
    rows('schengen_stays', agencyId),
    rows('payment_providers', agencyId),
  ])

  const agency = camelKeys<any>(agencyRow.data)
  agency.offices = offices
  // Le logo : la base garde le chemin, l'écran a besoin de l'URL publique.
  if (agency.logoPath) {
    agency.logoUrl = sb.storage.from('marques').getPublicUrl(agency.logoPath).data.publicUrl
  }

  // La liste de pièces du front porte ses items ; en base ils vivent dans la
  // version courante de la checklist. On les rapatrie.
  const versionByChecklist = new Map<string, any>()
  for (const v of checklistVersions) {
    const prev = versionByChecklist.get(v.checklistId)
    if (!prev || v.version > prev.version) versionByChecklist.set(v.checklistId, v)
  }
  const checklistsFull = checklists.map((c) => ({
    ...c,
    items: versionByChecklist.get(c.id)?.items ?? [],
  }))

  // Les notes du front sont attachées au dossier ; en base c'est une table.
  const notesByCase = new Map<string, CaseNote[]>()
  for (const n of notes as CaseNote[]) {
    const cid = (n as any).caseId as string | undefined
    if (!cid) continue
    ;(notesByCase.get(cid) ?? notesByCase.set(cid, []).get(cid)!).push(n)
  }
  const casesFull: VisaCase[] = cases.map((c) => ({
    ...c,
    notes: (notesByCase.get(c.id) ?? []).sort((a, b) => b.at.localeCompare(a.at)),
  }))

  const eventsData = (events.data ?? []).map((r) => camelKeys(r))

  return {
    version: 3,
    agency,
    users,
    clients,
    visaTypes,
    consulates,
    checklists: checklistsFull,
    cases: casesFull,
    documents,
    custody,
    messages,
    templates,
    appointments,
    payments,
    rules,
    events: eventsData,
    tasks,
    shipments,
    shipmentDocs,
    shipmentEvents,
    requests,
    queue,
    attempts,
    lots,
    legs,
    tariffs,
    bls,
    declarations,
    customsArticles,
    tce,
    stays,
    providers,
  } as Database
}

/* ------------------------------------------------------------------ */
/* Les écritures                                                       */
/* ------------------------------------------------------------------ */

/** Un patch générique sur une table, en convertissant les clés. */
export async function patch(table: string, id: string, changes: Record<string, unknown>) {
  const { error } = await client().from(table).update(snakeKeys(changes)).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function insert(table: string, row: Record<string, unknown>) {
  const { data, error } = await client().from(table).insert(snakeKeys(row)).select().single()
  if (error) throw new Error(error.message)
  return camelKeys(data)
}

export async function remove(table: string, id: string) {
  const { error } = await client().from(table).delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** Un appel de fonction métier. */
export async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await client().rpc(name, args)
  if (error) throw new Error(error.message)
  return data
}
