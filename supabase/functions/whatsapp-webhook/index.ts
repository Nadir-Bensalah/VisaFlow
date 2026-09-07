/* Le point d'entrée des messages entrants et des retours d'état.
   Meta appelle cette adresse. Deux verbes : GET pour l'abonnement, POST pour
   le reste. Tout le métier est en base : ici on vérifie, on range, on répond
   200 le plus vite possible, parce que Meta rejoue tout ce qui traîne. */

import { rpc, validSignature } from '../_shared/wa.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const APP_SECRET = Deno.env.get('WHATSAPP_APP_SECRET') ?? ''

const call = rpc(SUPABASE_URL, SERVICE_KEY)

/** Le numéro professionnel appelé dit de quelle agence il s'agit. */
async function agencyOf(phoneNumberId: string): Promise<string | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/whatsapp_accounts?phone_number_id=eq.${encodeURIComponent(phoneNumberId)}&active=is.true&select=agency_id`,
    { headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` } },
  )
  if (!res.ok) return null
  const rows = await res.json()
  return rows?.[0]?.agency_id ?? null
}

Deno.serve(async (req) => {
  const url = new URL(req.url)

  // Abonnement : Meta renvoie le défi une seule fois, à la configuration.
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')
    if (mode !== 'subscribe' || !token) return new Response('non', { status: 403 })

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_accounts?verify_token=eq.${encodeURIComponent(token)}&select=agency_id`,
      { headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` } },
    )
    const rows = res.ok ? await res.json() : []
    if (!rows?.length) return new Response('non', { status: 403 })
    return new Response(challenge ?? '', { status: 200 })
  }

  if (req.method !== 'POST') return new Response('non', { status: 405 })

  const raw = await req.text()

  // Sans signature vérifiée, n'importe qui poste de faux messages dans les
  // dossiers de l'agence. On refuse plutôt que de faire confiance.
  if (APP_SECRET) {
    const ok = await validSignature(APP_SECRET, raw, req.headers.get('x-hub-signature-256'))
    if (!ok) return new Response('signature', { status: 401 })
  }

  let body: any
  try { body = JSON.parse(raw) } catch { return new Response('json', { status: 400 }) }

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {}
      const phoneNumberId = value.metadata?.phone_number_id
      if (!phoneNumberId) continue
      const agency = await agencyOf(phoneNumberId)
      if (!agency) continue

      // Les messages du client.
      for (const message of value.messages ?? []) {
        // On ne traite que le texte pour l'instant : une image ou un document
        // demande le téléchargement du média, qui viendra avec le seau.
        const text = message.text?.body
          ?? message.button?.text
          ?? message.interactive?.list_reply?.title
          ?? (message.type ? `[${message.type}]` : '')
        const profile = value.contacts?.find((c: any) => c.wa_id === message.from)?.profile?.name ?? null
        try {
          await call('wa_receive', {
            p_agency: agency,
            p_from: message.from,
            p_body: text,
            p_provider_id: message.id,
            p_profile_name: profile,
          })
        } catch (e) {
          console.error('wa_receive', message.id, String(e))
        }
      }

      // Les retours d'état, coût compris.
      for (const status of value.statuses ?? []) {
        const price = status.pricing?.billable ? status.pricing : null
        try {
          await call('wa_status', {
            p_provider_id: status.id,
            p_status: status.status,
            p_error: status.errors?.[0]?.title ?? null,
            // Meta ne donne pas toujours le montant : on garde ce qu'on a.
            p_cost: price?.amount ? Number(price.amount) : null,
            p_currency: price?.currency ?? null,
          })
        } catch (e) {
          console.error('wa_status', status.id, String(e))
        }
      }
    }
  }

  // Toujours 200. Un code d'erreur fait rejouer l'appel en boucle.
  return new Response('ok', { status: 200 })
})
