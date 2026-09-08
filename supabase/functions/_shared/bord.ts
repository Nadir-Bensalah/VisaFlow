/* La plomberie commune à toutes les fonctions de bord.
   Rien de métier ici : les règles vivent en base, pas dans le bord.

   Elle était écrite dans `wa.ts` du temps où WhatsApp était le seul sujet.
   Le courriel et les webhooks ont le même besoin : appeler l'API REST, appeler
   une fonction SQL, lire un secret dans le coffre. Trois copies auraient
   divergé au premier correctif. */

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
export const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
export const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

/** Une réponse JSON, avec les en-têtes qu'un navigateur exige. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, content-type, apikey',
    },
  })
}

/** Un appel à l'API REST, avec la clé de service par défaut. Le jeton d'un
    compte connecté se passe en troisième argument, et c'est alors la sécurité
    au niveau des lignes qui décide. */
export async function rest(
  supabaseUrl: string,
  serviceKey: string,
  path: string,
  init: RequestInit = {},
  token = serviceKey,
) {
  const res = await fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const texte = await res.text()
  let data: unknown = null
  try { data = texte ? JSON.parse(texte) : null } catch { data = texte }
  return { ok: res.ok, status: res.status, data }
}

/** Appeler une fonction SQL. Tout le métier est là-bas, pas ici. */
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
    const texte = await res.text()
    return texte ? JSON.parse(texte) : null
  }
}

/** Le secret vit dans le coffre, jamais dans une table lisible.
    Sans cette indirection, quiconque lit la table peut agir au nom de
    l'agence depuis n'importe où. */
export async function readSecret(
  supabaseUrl: string,
  serviceKey: string,
  name: string,
): Promise<string | null> {
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
  const valeur = await res.json()
  return typeof valeur === 'string' && valeur.length > 0 ? valeur : null
}

/** Un HMAC SHA-256 en hexadécimal. C'est ce que le monde entier attend d'une
    signature de webhook, Meta et Stripe compris. */
export async function hmacHex(secret: string, corps: string): Promise<string> {
  const cle = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', cle, new TextEncoder().encode(corps))
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Traiter une liste par petits paquets.
    En série, cinquante points de réception à dix secondes chacun dépassent la
    durée de vie d'une fonction de bord. Tous en même temps, on ouvre cinquante
    connexions et on se fait prendre pour une attaque. */
export async function parPaquets<T, R>(
  items: T[],
  taille: number,
  travail: (item: T) => Promise<R>,
): Promise<R[]> {
  const sortie: R[] = []
  for (let i = 0; i < items.length; i += taille) {
    sortie.push(...await Promise.all(items.slice(i, i + taille).map(travail)))
  }
  return sortie
}

/** Le porteur présenté est il une clé de service ?
    On ne compare pas des octets avec SUPABASE_SERVICE_ROLE_KEY : un projet
    Supabase peut avoir deux clés de service valables en parallèle, l'ancienne
    en JWT et la nouvelle en `sb_secret_…`, et la comparaison refuserait la
    seconde sans rien expliquer. On demande donc à la base : `is_service_key`
    n'est exécutable que par `service_role`, et c'est PostgREST qui valide le
    jeton. Un refus vaut « ce n'est pas une clé de service ». */
export async function estCleDeService(supabaseUrl: string, porteur: string): Promise<boolean> {
  if (!porteur) return false
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/is_service_key`, {
      method: 'POST',
      headers: { apikey: porteur, authorization: `Bearer ${porteur}`, 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(10_000),
    })
    return res.ok
  } catch {
    return false
  }
}
