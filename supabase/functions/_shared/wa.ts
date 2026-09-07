/* Ce que les deux fonctions de bord partagent.
   Rien de métier ici : les règles vivent en base, pas dans le bord. */

export const GRAPH = 'https://graph.facebook.com/v21.0'

export interface Account {
  agency_id: string
  phone_number_id: string
  waba_id: string | null
  token_secret: string
  verify_token: string
  app_secret_name: string | null
  active: boolean
}

/** Le jeton vit dans le coffre, jamais dans une table lisible.
    Sans cette indirection, quiconque lit `whatsapp_accounts` peut écrire au
    nom de l'agence depuis n'importe où. */
export async function readSecret(supabaseUrl: string, serviceKey: string, name: string): Promise<string | null> {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/vault_read`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_name: name }),
  })
  if (!res.ok) return null
  const value = await res.json()
  return typeof value === 'string' ? value : null
}

/** Meta signe chaque appel entrant. Sans vérification, n'importe qui poste
    de faux messages dans les dossiers de l'agence. */
export async function validSignature(secret: string, raw: string, header: string | null): Promise<boolean> {
  if (!header?.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw))
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
  const given = header.slice(7)
  // Comparaison à temps constant : une comparaison naïve laisse deviner la
  // signature octet par octet.
  if (expected.length !== given.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i)
  return diff === 0
}

export function rpc(supabaseUrl: string, serviceKey: string) {
  return async (fn: string, args: Record<string, unknown>) => {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(args),
    })
    if (!res.ok) throw new Error(`${fn} ${res.status} ${await res.text()}`)
    const text = await res.text()
    return text ? JSON.parse(text) : null
  }
}
