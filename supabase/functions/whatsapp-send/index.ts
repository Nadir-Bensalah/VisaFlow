/* La file d'envoi, vidée à intervalle régulier.
   Deux façons d'envoyer, et le choix ne nous appartient pas : dans la fenêtre
   de 24 heures ouverte par un message du client, on envoie du texte libre, et
   c'est gratuit ; hors fenêtre, il faut un modèle approuvé par Meta, et c'est
   facturé au message. Répondre coûte donc moins cher que relancer à froid.

   POURQUOI IL N'Y A PAS DE FONCTION `whatsapp-due` À CÔTÉ.

   La migration 0051 a posé `wa_outbox_due` : la même file, moins ce qui n'est
   pas encore dû. Une règle de notification à délai date son message du futur, et
   `wa_outbox` ne regarde pas cette date. Sans le filtre, un message réglé pour
   partir dans deux heures partait tout de suite, et le délai que l'agence avait
   choisi ne servait à rien.

   Écrire une deuxième fonction de bord pour ça aurait dupliqué tout ce qui suit :
   la fenêtre de 24 heures, le choix du modèle, la lecture du jeton dans le
   coffre, la mise à jour de l'état. Deux copies divergent au premier correctif,
   et c'est toujours celle qu'on a oubliée qui tourne en production. La source
   est donc un PARAMÈTRE, et le défaut est le bon comportement :

     { "agency_id": "…" }                     la file due de cette agence
     { }                                      la file due de TOUTES les agences
                                              raccordées et actives
     { "agency_id": "…", "source": "toute" }  tout ce qui est envoyable, dû ou
                                              non. Le « vider maintenant » d'un
                                              écran de réglages, à la main.

   La tâche planifiée appelle donc cette fonction sans corps, et chaque agence
   raccordée voit sa file due partir. */

import { GRAPH, rpc, readSecret } from '../_shared/wa.ts'
import { parPaquets } from '../_shared/bord.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const call = rpc(SUPABASE_URL, SERVICE_KEY)

interface Outgoing {
  id: string
  client_id: string
  to_number: string
  body: string
  locale: string
  template_name: string | null
  category: string
  in_window: boolean
}

interface Compte {
  agency_id: string
  phone_number_id: string
  token_secret: string
}

async function patchMessage(id: string, patch: Record<string, unknown>) {
  await fetch(`${SUPABASE_URL}/rest/v1/messages?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=minimal',
    },
    body: JSON.stringify(patch),
  })
}

async function comptesActifs(agencyId: string | null): Promise<Compte[]> {
  const filtre = agencyId ? `agency_id=eq.${agencyId}&` : ''
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/whatsapp_accounts?${filtre}active=is.true&select=agency_id,phone_number_id,token_secret`,
    { headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` } },
  )
  if (!res.ok) return []
  return (await res.json()) as Compte[]
}

/** Vider la file d'UNE agence. Tout le reste du fichier n'est que le tour des
    agences et la réponse. */
async function viderAgence(account: Compte, source: 'due' | 'toute') {
  const token = await readSecret(SUPABASE_URL, SERVICE_KEY, account.token_secret)
  if (!token) return { agency_id: account.agency_id, sent: 0, failed: 0, queued: 0, reason: 'jeton absent' }

  // La seule différence entre les deux sources. `wa_outbox_due` enveloppe
  // `wa_outbox` : elle ne contourne ni la fenêtre de 24 heures ni le contrôle
  // des modèles approuvés, elle retire seulement ce qui n'est pas encore dû.
  const fonction = source === 'toute' ? 'wa_outbox' : 'wa_outbox_due'
  const queue: Outgoing[] = (await call(fonction, { p_agency: account.agency_id, p_limit: 50 })) ?? []

  let sent = 0
  let failed = 0

  for (const item of queue) {
    // Le numéro part en chiffres seuls : Meta refuse tout le reste.
    const to = item.to_number.replace(/[^0-9]/g, '')

    const payload = item.in_window
      ? { messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: false, body: item.body } }
      : {
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: item.template_name,
            language: { code: item.locale === 'zh' ? 'zh_CN' : item.locale },
            // Le corps du message local sert de variable unique. Un modèle à
            // plusieurs variables se déclare dans whatsapp_templates.variables.
            components: [{ type: 'body', parameters: [{ type: 'text', text: item.body }] }],
          },
        }

    try {
      const res = await fetch(`${GRAPH}/${account.phone_number_id}/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()

      if (!res.ok) {
        failed++
        await patchMessage(item.id, {
          status: 'echec',
          status_at: new Date().toISOString(),
          error: json?.error?.message ?? `HTTP ${res.status}`,
        })
        continue
      }

      sent++
      await patchMessage(item.id, {
        status: 'envoye',
        status_at: new Date().toISOString(),
        provider_id: json?.messages?.[0]?.id ?? null,
        wa_template_name: item.in_window ? null : item.template_name,
        wa_category: item.in_window ? 'service' : item.category,
        error: null,
      })
    } catch (e) {
      failed++
      await patchMessage(item.id, {
        status: 'echec',
        status_at: new Date().toISOString(),
        error: String(e),
      })
    }
  }

  return { agency_id: account.agency_id, sent, failed, queued: queue.length }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('non', { status: 405 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const agencyId = body?.agency_id ? String(body.agency_id) : null
  const source: 'due' | 'toute' = body?.source === 'toute' ? 'toute' : 'due'

  const comptes = await comptesActifs(agencyId)
  if (comptes.length === 0) {
    return new Response(
      JSON.stringify({ sent: 0, failed: 0, agencies: 0, reason: 'aucune agence raccordée' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }

  // Trois agences à la fois. Meta limite par numéro, pas par appelant : le tour
  // des agences n'a aucune raison d'être fait en file indienne, et une agence
  // lente ne doit pas retarder les autres.
  const detail = await parPaquets(comptes, 3, (c) => viderAgence(c, source))

  return new Response(JSON.stringify({
    agencies: detail.length,
    source,
    sent: detail.reduce((n, d) => n + d.sent, 0),
    failed: detail.reduce((n, d) => n + d.failed, 0),
    detail,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
})
