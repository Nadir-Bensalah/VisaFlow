/* Ce que les fonctions de bord WhatsApp partagent.
   Rien de métier ici : les règles vivent en base, pas dans le bord.

   La plomberie générique (appel REST, appel d'une fonction SQL, lecture du
   coffre) a déménagé dans `bord.ts` le jour où le courriel et les webhooks en
   ont eu besoin. Elle est réexportée ici pour que rien n'ait à changer de nom,
   et surtout pour qu'il n'en existe qu'une seule écriture. */

import { rpc, readSecret } from './bord.ts'
export { rpc, readSecret }

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
