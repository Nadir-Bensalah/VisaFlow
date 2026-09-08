import { patch, insert, remove, rpc } from './remote'
import type { Database } from './types'

/* Le miroir : il traduit une action du magasin en écriture Supabase.
   Le magasin reste synchrone et optimiste (l'écran répond tout de suite) ;
   ici, en tâche de fond, on persiste, puis on recharge pour réconcilier.
   Un seul endroit connaît la correspondance action vers backend. */

type Ctx = {
  db: Database
  agencyId: string
  reload: () => void
}

/** Rend true si l'action a été persistée (ou n'avait rien à persister),
    false si elle n'est pas encore branchée sur le backend. */
export async function mirror(name: string, args: any[], ctx: Ctx): Promise<boolean> {
  const { db } = ctx
  const findDoc = (id: string) => db.documents.find((d) => d.id === id)
  const findPay = (id: string) => db.payments.find((p) => p.id === id)

  switch (name) {
    case 'setStage':
      await patch('cases', args[0], { stage: args[1], updatedAt: new Date().toISOString() })
      return true
    case 'advance': {
      const c = db.cases.find((x) => x.id === args[0])
      if (c) await patch('cases', c.id, { stage: c.stage, updatedAt: new Date().toISOString() })
      return true
    }
    case 'setDocState': {
      const d = findDoc(args[0])
      if (d) await patch('case_documents', d.id, {
        state: args[1],
        rejectionReason: args[1] === 'refusee' ? args[2] : null,
        receivedAt: args[1] === 'recue' ? new Date().toISOString() : d.receivedAt,
        validatedAt: args[1] === 'validee' ? new Date().toISOString() : null,
      })
      return true
    }
    case 'remindDoc': {
      const d = findDoc(args[0])
      if (d) await patch('case_documents', d.id, { reminders: (d.reminders ?? 0) + 1, lastReminderAt: new Date().toISOString() })
      return true
    }
    case 'sendMessage': {
      const i = args[0]
      await insert('messages', {
        agencyId: ctx.agencyId, caseId: i.caseId, channel: i.channel, direction: i.fromClient ? 'entrant' : 'sortant',
        body: i.body, templateKey: i.templateKey, automated: !!i.automated, status: i.fromClient ? 'remis' : 'file',
        clientId: db.cases.find((c) => c.id === i.caseId)?.clientId,
      })
      return true
    }
    case 'addNote':
      await insert('case_notes', { agencyId: ctx.agencyId, caseId: args[0], text: args[1], kind: args[2] ?? 'note' })
      return true
    case 'updateClient':
      await patch('clients', args[0], stripId(args[1]))
      return true
    case 'updateCase':
      await patch('cases', args[0], { ...stripId(args[1]), updatedAt: new Date().toISOString() })
      return true
    case 'updateAppointment':
      await patch('appointments', args[0], stripId(args[1]))
      return true
    case 'addAppointment':
      await insert('appointments', { ...args[0], agencyId: ctx.agencyId })
      return true
    case 'markPaymentPaid': {
      const p = findPay(args[0])
      if (p) await patch('payments', p.id, { state: 'regle', method: args[1], at: new Date().toISOString() })
      return true
    }
    case 'toggleRule': {
      const r = db.rules.find((x) => x.id === args[0])
      if (r) await patch('automation_rules', r.id, { active: !r.active })
      return true
    }
    case 'toggleTask': {
      const t = db.tasks.find((x) => x.id === args[0])
      if (t) await patch('tasks', t.id, { done: !t.done })
      return true
    }
    case 'createTask':
      await insert('tasks', { ...args[0], agencyId: ctx.agencyId, done: false, automated: false })
      ctx.reload()
      return true
    case 'createClient':
      await insert('clients', { ...args[0], agencyId: ctx.agencyId })
      ctx.reload()
      return true

    /* Les gestes qui passent par une fonction serveur : le serveur génère la
       référence, le rendez-vous, le journal. On recharge pour tout récupérer. */
    case 'createCase':
      await rpc('open_case', {
        p_client: args[0].clientId, p_visa_type: args[0].visaTypeId, p_assignee: args[0].assigneeId,
        p_travel: args[0].travelDate ?? null, p_source: args[0].source, p_group: null,
      })
      ctx.reload()
      return true
    case 'decideCase':
    case 'recordDecision': {
      const isRecord = name === 'recordDecision'
      await rpc('record_decision', {
        p_case: args[0], p_status: args[1],
        p_code: isRecord ? args[2]?.code ?? null : null,
        p_reason: isRecord ? args[2]?.reason ?? null : args[2] ?? null,
      })
      ctx.reload()
      return true
    }
    case 'markPaymentPaidRpc':
      return false
    case 'convertRequest':
      await rpc('convert_request', { p_request: args[0], p_assignee: args[1] })
      ctx.reload()
      return true
    case 'refuseRequest':
      await patch('client_requests', args[0], { status: 'ecartee', refusalReason: args[1], handledAt: new Date().toISOString() })
      return true
    case 'runRules':
      await rpc('run_automations', { p_agency: ctx.agencyId, p_dry_run: false })
      ctx.reload()
      return true

    /* Le catalogue et l'équipe : des upserts et des suppressions simples. */
    case 'saveConsulate':
      await upsert('consulates', args[0], ctx.agencyId)
      ctx.reload()
      return true
    case 'removeConsulate':
      await patch('consulates', args[0], { active: false })
      return true
    case 'saveStay':
      await upsert('schengen_stays', args[0], ctx.agencyId)
      ctx.reload()
      return true
    case 'removeStay':
      await remove('schengen_stays', args[0])
      return true
    case 'saveProvider':
      await upsert('payment_providers', args[0], ctx.agencyId)
      ctx.reload()
      return true
    case 'saveTariff':
      await upsert('demurrage_tariffs', args[0], ctx.agencyId)
      ctx.reload()
      return true
    case 'closeTariff':
      // On clôt la période de validité, on ne supprime pas la ligne.
      await patch('demurrage_tariffs', args[0], { valid_to: new Date().toISOString().slice(0, 10) })
      return true
    case 'saveVisaType':
      await upsert('visa_types', args[0], ctx.agencyId)
      ctx.reload()
      return true
    case 'removeVisaType':
      await patch('visa_types', args[0], { active: false })
      return true
    case 'saveTemplate':
      await upsert('message_templates', args[0], ctx.agencyId)
      ctx.reload()
      return true
    case 'removeTemplate':
      await remove('message_templates', args[0])
      return true
    case 'saveRule':
      await upsert('automation_rules', args[0], ctx.agencyId)
      ctx.reload()
      return true
    case 'removeRule':
      await remove('automation_rules', args[0])
      return true
    case 'saveUser':
      // Un profil est lié à un compte auth : sa création passe par l'invitation
      // (à brancher). On persiste seulement les mises à jour d'un profil existant.
      if (args[0].id) { await patch('profiles', args[0].id, stripId(args[0])); return true }
      return false
    case 'removeUser':
      await patch('profiles', args[0], { active: false })
      return true
    case 'updateAgency':
      await patch('agencies', ctx.agencyId, stripAgency(args[0]))
      return true

    /* Le fret. */
    case 'saveShipment': {
      // En base, une cargaison n'a PAS de client : le lien passe par les lots.
      // Envoyer le champ tel quel faisait échouer toute création de cargaison
      // avec « column client_id does not exist ».
      const { clientId, ...cargaison } = args[0] as Record<string, unknown> & { clientId?: string }
      const saved = await upsert('shipments', cargaison, ctx.agencyId) as { id?: string } | undefined
      const shipmentId = (cargaison.id as string) ?? saved?.id
      // Un client désigné à la création devient un lot : c'est ce que le métier
      // fait vraiment, et ça marche aussi bien pour un conteneur complet.
      if (clientId && shipmentId) {
        const dejaLa = db.lots.some((l) => l.shipmentId === shipmentId && l.clientId === clientId)
        if (!dejaLa) {
          await insert('shipment_lots', {
            agencyId: ctx.agencyId, shipmentId, clientId,
            weightKg: (cargaison.weightKg as number) ?? null,
            volumeCbm: (cargaison.volumeCbm as number) ?? null,
            packages: (cargaison.packages as number) ?? null,
          })
        }
      }
      ctx.reload()
      return true
    }
    case 'advanceShipment': {
      const s = db.shipments.find((x) => x.id === args[0])
      if (s) await patch('shipments', s.id, { stage: s.stage })
      return true
    }
    case 'stepBackShipment': {
      const s = db.shipments.find((x) => x.id === args[0])
      if (s) await patch('shipments', s.id, { stage: s.stage })
      return true
    }
    case 'setShipmentDocState':
      await patch('shipment_documents', args[0], { state: args[1] })
      return true

    /* Les créneaux : la file passe par des fonctions serveur. */
    case 'joinQueue':
      await insert('appointment_queue', {
        agencyId: ctx.agencyId, caseId: args[0].caseId, consulateId: args[0].consulateId,
        priority: args[0].priority ?? 'normale', status: 'attente', note: args[0].note,
      })
      ctx.reload()
      return true
    case 'leaveQueue':
      await patch('appointment_queue', args[0], { status: 'abandonne', leftAt: new Date().toISOString() })
      return true
    case 'setQueuePriority':
      await patch('appointment_queue', args[0], { priority: args[1] })
      return true
    case 'serveQueue':
      await rpc('serve_queue', { p_entry: args[0], p_slot_at: args[1], p_location: args[2] ?? null })
      ctx.reload()
      return true
    case 'logAttempt':
      await insert('slot_attempts', {
        agencyId: ctx.agencyId, consulateId: args[0].consulateId, caseId: args[0].caseId ?? null,
        centre: args[0].centre, result: args[0].result, slotAt: args[0].slotAt ?? null, note: args[0].note,
      })
      return true

    /* Les pièces déposées. */
    case 'attachFile': {
      const d = findDoc(args[0])
      if (d) await patch('case_documents', d.id, {
        storagePath: args[1].key, fileName: args[1].name, fileSize: args[1].size,
        state: 'recue', receivedAt: new Date().toISOString(),
      })
      return true
    }
    case 'detachFile': {
      const d = findDoc(args[0])
      if (d) await patch('case_documents', d.id, { storagePath: null, fileName: null, fileSize: null, state: 'demandee' })
      return true
    }

    case 'receivePassport':
      await insert('passport_custody', {
        agencyId: ctx.agencyId, caseId: args[0].caseId, clientId: args[0].clientId,
        passportNumber: args[0].passportNumber, location: args[0].location ?? 'coffre',
      })
      ctx.reload()
      return true
    case 'releasePassport': {
      const cu = db.custody.find((c) => c.id === args[0])
      if (cu) { await rpc('release_passport', { p_custody: cu.id, p_force: !!args[1] }); ctx.reload() }
      return true
    }

    /* Purement locaux, sans persistance backend (préférences d'affichage). */
    case 'markSetup':
    case 'hideSetup':
    case 'requestMissingDocs':
    case 'exportJson':
    case 'reset':
    case 'clearAll':
      return true

    default:
      return false
  }
}

function stripId(o: Record<string, unknown>) {
  const { id, agencyId, ...rest } = o
  return rest
}

function stripAgency(o: Record<string, unknown>) {
  const { id, offices, whatsapp, logoUrl, ...rest } = o as any
  // whatsapp et offices ne sont pas des colonnes de agencies (tables/coffre).
  // logoUrl non plus : la base garde le CHEMIN, l'URL publique s'en déduit au
  // chargement. Envoyer l'URL ferait échouer la mise à jour.
  return rest
}

async function upsert(table: string, row: any, agencyId: string) {
  const body = { ...row, agencyId }
  if (row.id) { await patch(table, row.id, stripId(body)); return }
  await insert(table, body)
}
