/* La répartition des webhooks.
 *
 * Depuis la migration 0051, `notify_event` remplit `webhook_deliveries` à
 * chaque fait du métier. Personne ne les postait. Les remises s'empilaient,
 * `webhook_pending` rendait sagement ce qui attendait, et aucun logiciel tiers
 * n'a jamais rien reçu. C'est cette fonction qui manquait.
 *
 * Elle est réveillée par la tâche planifiée `visaflow_webhooks`, toutes les
 * cinq minutes. Elle ne décide de rien : la base dit quoi envoyer et où, elle
 * signe, elle poste, elle rapporte.
 *
 * QUI A LE DROIT DE LA RÉVEILLER, ET POURQUOI CE N'EST PAS UN JETON.
 *
 * La tâche part de PostgreSQL, par pg_net, qui range chaque appel en attente
 * dans `net.http_request_queue`, en-têtes compris. Cette table est lisible par
 * tout compte connecté, et Supabase ne laisse pas `postgres` refermer ce droit.
 * Une clé de service posée dans un en-tête d'autorisation y serait donc à
 * ramasser. On signe donc l'appel au lieu de le porter : la tâche envoie un
 * horodatage et son empreinte HMAC, calculée avec un secret partagé. Volée dans
 * la file, l'empreinte ne vaut que cinq minutes et pour ce seul appel.
 *
 * La clé de service reste acceptée, pour l'appel à la main depuis un poste :
 * elle, au moins, ne traverse aucune table.
 *
 * TROIS CHOIX QUI COMPTENT.
 *
 * 1. LA SIGNATURE. Sans elle, celui qui reçoit ne peut pas savoir que ça vient
 *    de nous, et n'importe qui connaissant son adresse peut lui écrire de faux
 *    événements. Le corps est signé en HMAC SHA-256 avec le secret du webhook,
 *    lu dans le coffre par son NOM. Si le webhook déclare un secret et que le
 *    coffre ne le contient pas, on n'envoie PAS : envoyer non signé serait
 *    dégrader la sécurité en silence.
 *
 * 2. L'IDEMPOTENCE. Un point de réception lent répond après notre délai
 *    d'attente alors qu'il a bien traité la remise. On rejoue, il reçoit deux
 *    fois. L'en-tête `X-VisaFlow-Delivery` porte l'identifiant de la remise, et
 *    cet identifiant NE CHANGE PAS entre les huit tentatives : celui qui reçoit
 *    n'a qu'à ignorer un identifiant déjà vu. `Idempotency-Key` porte la même
 *    valeur, parce que c'est le nom que la plupart des bibliothèques attendent.
 *
 * 3. LE DÉLAI D'ATTENTE COURT. Dix secondes. Un serveur tiers qui met une
 *    minute à répondre ne doit pas empêcher les quarante-neuf autres remises de
 *    partir. Le recul croissant de `webhook_backoff` s'occupe de lui.
 */

import {
  SUPABASE_URL, SERVICE_KEY, json, rpc, readSecret, hmacHex, parPaquets, estCleDeService,
} from '../_shared/bord.ts'

const call = rpc(SUPABASE_URL, SERVICE_KEY)

// Le même secret que celui du coffre, posé aussi en variable de la fonction.
// La base signe, le bord vérifie : les deux côtés doivent connaître la valeur.
const SECRET_TACHE = Deno.env.get('WEBHOOK_DISPATCH_SECRET') ?? ''
// Cinq minutes. Au delà, l'empreinte est périmée : elle ne se rejoue pas.
const FENETRE_S = 300

// Dix secondes par point de réception. Voir le choix n°3 en tête de fichier.
const ATTENTE_MS = 10_000
// Six à la fois : cinquante en série dépasseraient la durée de vie de la
// fonction, cinquante en parallèle ressembleraient à une attaque.
const PAQUET = 6

interface Remise {
  id: string
  agency_id: string
  webhook_id: string
  event: string
  endpoint: string
  secret_name: string | null
  payload: unknown
  attempts: number
}

/** Un secret est partagé par toutes les remises d'un même webhook. On ne
    rouvre pas le coffre cinquante fois pour la même clé. */
const secrets = new Map<string, string | null>()
async function secretDe(nom: string): Promise<string | null> {
  if (!secrets.has(nom)) secrets.set(nom, await readSecret(SUPABASE_URL, SERVICE_KEY, nom))
  return secrets.get(nom) ?? null
}

async function remettre(r: Remise): Promise<'envoye' | 'echoue'> {
  const corps = JSON.stringify(r.payload ?? {})

  const entetes: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'VisaFlow/1.0 (+webhooks)',
    // L'identifiant stable de la remise, dans les deux noms d'en-tête qui
    // servent : le nôtre, et celui que tout le monde connaît.
    'X-VisaFlow-Delivery': r.id,
    'Idempotency-Key': r.id,
    'X-VisaFlow-Event': r.event,
    // Le rang de la tentative. Il change, lui, et c'est voulu : celui qui
    // reçoit peut distinguer un rejeu d'une nouvelle remise.
    'X-VisaFlow-Attempt': String((r.attempts ?? 0) + 1),
  }

  if (r.secret_name) {
    const secret = await secretDe(r.secret_name)
    if (!secret) {
      // On n'envoie pas. Un webhook qui déclare un secret absent du coffre est
      // mal réglé : l'envoyer sans signature serait faire passer un réglage
      // cassé pour un envoi réussi.
      await call('webhook_mark', {
        p_delivery: r.id, p_ok: false, p_http_status: null,
        p_excerpt: `secret « ${r.secret_name} » absent du coffre : remise non signée, donc non envoyée`,
      })
      return 'echoue'
    }
    entetes['X-VisaFlow-Signature'] = `sha256=${await hmacHex(secret, corps)}`
  }

  try {
    const res = await fetch(r.endpoint, {
      method: 'POST',
      headers: entetes,
      body: corps,
      signal: AbortSignal.timeout(ATTENTE_MS),
    })
    // Les cinq cents premiers caractères, comme la colonne le prévoit. Un corps
    // entier remplirait la base, et la moitié du temps c'est une page HTML.
    const texte = (await res.text().catch(() => '')).slice(0, 500)
    await call('webhook_mark', {
      p_delivery: r.id, p_ok: res.ok, p_http_status: res.status, p_excerpt: texte,
    })
    return res.ok ? 'envoye' : 'echoue'
  } catch (e) {
    // Délai dépassé, DNS mort, certificat refusé : tout se dit pareil ici, et
    // la base reprogramme la tentative suivante.
    await call('webhook_mark', {
      p_delivery: r.id, p_ok: false, p_http_status: null, p_excerpt: String(e).slice(0, 500),
    })
    return 'echoue'
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({}, 204)
  if (req.method !== 'POST') return json({ error: 'méthode' }, 405)

  // Cette fonction lit les remises de TOUTES les agences : elle n'a aucun
  // filtre à opposer à un compte d'agence. Deux portes, et deux seulement.
  const porteur = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  // La comparaison d'octets d'abord, parce qu'elle ne coûte rien. La question
  // à la base ensuite, parce qu'un projet peut avoir deux clés de service
  // valables et que refuser la seconde serait une panne incompréhensible.
  const cleDeService = (SERVICE_KEY !== '' && porteur === SERVICE_KEY)
    || await estCleDeService(SUPABASE_URL, porteur)

  let signe = false
  const horodatage = req.headers.get('x-visaflow-timestamp')
  const empreinte = req.headers.get('x-visaflow-auth')
  if (!cleDeService && horodatage && empreinte?.startsWith('sha256=')) {
    // Fermé par défaut : sans secret posé, la porte ne s'ouvre pas. C'est la
    // faute que la red team avait trouvée sur `whatsapp-webhook`, où un secret
    // absent sautait toute la vérification.
    if (!SECRET_TACHE) {
      console.error('WEBHOOK_DISPATCH_SECRET absent : appel signé refusé')
      return json({ error: 'secret de la tâche non configuré' }, 503)
    }
    const age = Math.abs(Math.floor(Date.now() / 1000) - Number(horodatage))
    if (Number.isFinite(age) && age <= FENETRE_S) {
      const attendu = await hmacHex(SECRET_TACHE, horodatage)
      const donne = empreinte.slice(7)
      // Comparaison à temps constant : une comparaison naïve laisse deviner
      // l'empreinte octet par octet.
      if (attendu.length === donne.length) {
        let diff = 0
        for (let i = 0; i < attendu.length; i++) diff |= attendu.charCodeAt(i) ^ donne.charCodeAt(i)
        signe = diff === 0
      }
    }
  }

  if (!cleDeService && !signe) {
    return json({ error: 'réservé à la tâche planifiée et à la clé de service' }, 403)
  }

  let attente: Remise[]
  try {
    attente = (await call('webhook_pending', { p_limit: 50 })) ?? []
  } catch (e) {
    console.error('webhook_pending', String(e))
    return json({ error: 'lecture de la file impossible', detail: String(e) }, 502)
  }

  // Rien à faire est le cas normal la plupart du temps. On le dit, et on rend
  // 200 : une tâche qui passe toutes les cinq minutes ne doit pas remplir le
  // journal d'erreurs parce qu'il n'y avait rien à envoyer.
  if (attente.length === 0) return json({ pending: 0, sent: 0, failed: 0 })

  const resultats = await parPaquets(attente, PAQUET, remettre)
  const sent = resultats.filter((r) => r === 'envoye').length

  return json({ pending: attente.length, sent, failed: resultats.length - sent })
})
