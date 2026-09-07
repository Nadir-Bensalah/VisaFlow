/* La file d'envoi, vidée à intervalle régulier.
   Deux façons d'envoyer, et le choix ne nous appartient pas : dans la fenêtre
   de 24 heures ouverte par un message du client, on envoie du texte libre, et
   c'est gratuit ; hors fenêtre, il faut un modèle approuvé par Meta, et c'est
   facturé au message. Répondre coûte donc moins cher que relancer à froid. */

import { GRAPH, rpc, readSecret } from '../_shared/wa.ts'

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

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('non', { status: 405 })

  const { agency_id } = await req.json().catch(() => ({ agency_id: null }))
  if (!agency_id) return new Response('agence', { status: 400 })

  const accountRes = await fetch(
    `${SUPABASE_URL}/rest/v1/whatsapp_accounts?agency_id=eq.${agency_id}&active=is.true&select=*`,
    { headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` } },
  )
  const account = (await accountRes.json())?.[0]
  if (!account) return new Response(JSON.stringify({ sent: 0, reason: 'non raccordée' }), { status: 200 })

  const token = await readSecret(SUPABASE_URL, SERVICE_KEY, account.token_secret)
  if (!token) return new Response(JSON.stringify({ sent: 0, reason: 'jeton absent' }), { status: 200 })

  const queue: Outgoing[] = await call('wa_outbox', { p_agency: agency_id, p_limit: 50 })

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

  return new Response(JSON.stringify({ sent, failed, queued: queue.length }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
})
