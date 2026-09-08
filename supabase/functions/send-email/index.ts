/* L'envoi de courriel. Le dernier vrai bloquant du produit.
 *
 * Sans lui : pas de mot de passe oublié, pas de facture envoyée, pas
 * d'invitation par lien, pas de vérification d'adresse. `invite-user` rend
 * aujourd'hui un mot de passe provisoire à recopier au téléphone, faute de
 * mieux. C'est cette fonction qui débloque le reste.
 *
 * QUI PEUT L'APPELER.
 *
 *   · Le serveur, avec la clé de service : un travail planifié, une autre
 *     fonction de bord. Il choisit l'agence, ou aucune (un mot de passe oublié
 *     part avant qu'on sache à quelle agence appartient l'adresse).
 *   · L'application, avec le jeton d'un compte connecté. Mêmes vérifications
 *     que `invite-user` : la plateforme partout, un compte d'agence dans SON
 *     agence, et nulle part ailleurs.
 *
 * LA RÈGLE QUI GOUVERNE TOUT.
 *
 * On ne prétend jamais qu'un message est parti s'il n'est pas parti. Trois
 * conséquences visibles :
 *
 *   1. Sans clé de fournisseur, la réponse est un 503 qui le DIT, et une trace
 *      « non_configure » est écrite quand même, avec le destinataire et l'objet.
 *      Le produit continue de marcher sans courriel, comme aujourd'hui, mais on
 *      sait exactement ce qui aurait dû partir.
 *   2. La date d'envoi n'est pas un paramètre : `email_record` la pose, et
 *      seulement quand le statut vaut « envoye ».
 *   3. L'état du transport est écrit à chaque appel dans `email_config`, par
 *      cette fonction qui est la seule à le connaître. `email_ready()` le rend
 *      à l'application, qui grise ses boutons au lieu de proposer une action
 *      qui échouera.
 *
 * L'EXPÉDITEUR. On envoie TOUJOURS depuis un domaine à nous (EMAIL_FROM), et
 * on met l'adresse de l'agence en réponse. Envoyer depuis l'adresse du client
 * sans authentifier son domaine (SPF, DKIM, DMARC) fait tomber le message en
 * indésirable, et abîme au passage la réputation de notre domaine.
 */

import {
  SUPABASE_URL, SERVICE_KEY, ANON_KEY, json, rest, rpc, estCleDeService,
} from '../_shared/bord.ts'

const call = rpc(SUPABASE_URL, SERVICE_KEY)

const GENRES = new Set([
  'invitation', 'mot_de_passe', 'facture', 'devis', 'rappel',
  'decision', 'document_demande', 'systeme',
])

/* ------------------------------------------------------------------ */
/* Le fournisseur                                                      */
/* ------------------------------------------------------------------ */
/*
 * L'abstraction est volontairement minuscule : un objet, trois champs. Le jour
 * où Resend ferme la porte à la Tunisie, ou coûte trop cher, on ajoute un objet
 * à côté et on change une variable d'environnement. Pas le fichier.
 *
 * Resend d'abord parce que c'est le plus simple à ouvrir depuis la Tunisie :
 * une carte, un domaine, une clé, et zéro appel commercial.
 */

interface Message {
  from: string
  to: string
  subject: string
  html: string | null
  text: string | null
  replyTo: string | null
  tags: Record<string, string>
}

interface Resultat {
  ok: boolean
  providerId: string | null
  httpStatus: number | null
  erreur: string | null
}

interface Fournisseur {
  nom: string
  /** La clé, ou undefined si elle n'est pas posée. */
  cle(): string | undefined
  envoyer(m: Message, cle: string): Promise<Resultat>
}

/** Resend n'accepte dans une étiquette que des lettres, des chiffres, un tiret
    bas et un tiret. Une étiquette refusée fait échouer TOUT le message. */
const propre = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60)

const RESEND: Fournisseur = {
  nom: 'resend',
  cle: () => Deno.env.get('RESEND_API_KEY') || undefined,
  async envoyer(m, cle) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${cle}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: m.from,
          to: [m.to],
          subject: m.subject,
          ...(m.html ? { html: m.html } : {}),
          ...(m.text ? { text: m.text } : {}),
          ...(m.replyTo ? { reply_to: [m.replyTo] } : {}),
          tags: Object.entries(m.tags).map(([name, value]) => ({
            name: propre(name), value: propre(value),
          })),
        }),
        // Trente secondes : au-delà, on préfère une trace « echoue » honnête à
        // une fonction qui pend.
        signal: AbortSignal.timeout(30_000),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        return {
          ok: false, providerId: null, httpStatus: res.status,
          erreur: String((data as { message?: string })?.message ?? `HTTP ${res.status}`),
        }
      }
      return {
        ok: true,
        providerId: String((data as { id?: string })?.id ?? ''),
        httpStatus: res.status,
        erreur: null,
      }
    } catch (e) {
      return { ok: false, providerId: null, httpStatus: null, erreur: String(e) }
    }
  },
}

/**
 * Brevo, l'autre porte, et celle qu'on emprunte aujourd'hui.
 *
 * Capmedia a déjà un compte Brevo : c'est celui-là qui sert en attendant qu'un
 * compte propre à VisaFlow soit ouvert. Deux différences avec Resend, et il
 * faut les connaître :
 *
 *   · La clé passe dans un en-tête `api-key`, pas en jeton porteur.
 *   · Brevo peut restreindre une clé à une liste d'adresses IP. Une fonction
 *     de bord sort par des adresses qui changent, donc cette restriction doit
 *     être DÉSACTIVÉE côté Brevo, sinon tout est refusé en 401 avec un message
 *     qui parle d'adresse non reconnue. On le remonte tel quel plutôt que de
 *     le traduire en « échec » : c'est la seule information utile ce jour-là.
 */
const BREVO: Fournisseur = {
  nom: 'brevo',
  cle: () => Deno.env.get('BREVO_API_KEY') || undefined,
  async envoyer(m, cle) {
    try {
      // Brevo veut l'expéditeur en deux morceaux. On accepte les deux écritures
      // d'EMAIL_FROM : « Nom <adresse> » ou l'adresse seule.
      const brut = m.from.trim()
      const avecNom = brut.match(/^\s*(.*?)\s*<([^>]+)>\s*$/)
      const expNom = avecNom ? avecNom[1].replace(/^"|"$/g, '') : 'VisaFlow'
      const expMail = avecNom ? avecNom[2] : brut

      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': cle, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { name: expNom, email: expMail },
          to: [{ email: m.to }],
          subject: m.subject,
          ...(m.html ? { htmlContent: m.html } : {}),
          ...(m.text ? { textContent: m.text } : {}),
          ...(m.replyTo ? { replyTo: { email: m.replyTo } } : {}),
          // Brevo range les étiquettes dans un tableau de chaînes, et refuse
          // le message entier si l'une d'elles est mal formée.
          tags: Object.entries(m.tags).map(([k, v]) => propre(`${k}_${v}`)),
        }),
        signal: AbortSignal.timeout(30_000),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const d = data as { message?: string; code?: string }
        return {
          ok: false, providerId: null, httpStatus: res.status,
          erreur: [d.code, d.message].filter(Boolean).join(' : ') || `HTTP ${res.status}`,
        }
      }
      return {
        ok: true,
        providerId: String((data as { messageId?: string })?.messageId ?? ''),
        httpStatus: res.status, erreur: null,
      }
    } catch (e) {
      return { ok: false, providerId: null, httpStatus: null, erreur: String(e) }
    }
  },
}

const FOURNISSEURS: Record<string, Fournisseur> = { resend: RESEND, brevo: BREVO }
const fournisseur = FOURNISSEURS[Deno.env.get('EMAIL_PROVIDER') ?? 'resend'] ?? RESEND

/* ------------------------------------------------------------------ */

/** Écrire la trace. Elle ne doit JAMAIS faire échouer l'appel : un journal qui
    tombe ne doit pas empêcher un mot de passe oublié de partir. */
async function tracer(champs: Record<string, unknown>): Promise<string | null> {
  try {
    return await call('email_record', champs)
  } catch (e) {
    console.error('email_record', String(e))
    return null
  }
}

/** Dire à la base ce que le bord vient de constater. Même remarque. */
async function constater(pret: boolean, note: string | null, from: string | null) {
  try {
    await call('email_state_set', {
      p_provider: fournisseur.nom, p_from: from, p_ready: pret, p_note: note,
    })
  } catch (e) {
    console.error('email_state_set', String(e))
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({}, 204)
  if (req.method !== 'POST') return json({ error: 'méthode' }, 405)

  // 1. Qui appelle ?
  const porteur = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!porteur || porteur === ANON_KEY) return json({ error: 'connexion requise' }, 401)
  // Comparaison d'octets d'abord, question à la base ensuite : un projet peut
  // porter deux clés de service valables en parallèle, l'ancienne en JWT et la
  // nouvelle en `sb_secret_…`. Refuser la seconde serait une panne que
  // personne ne saurait lire.
  const serveur = porteur === SERVICE_KEY || await estCleDeService(SUPABASE_URL, porteur)

  let callerId: string | null = null
  let plateforme = false
  let agenceDuCompte: string | null = null

  if (!serveur) {
    const qui = await rest(SUPABASE_URL, SERVICE_KEY, '/auth/v1/user', { method: 'GET' }, porteur)
    if (!qui.ok) return json({ error: 'jeton invalide' }, 401)
    callerId = (qui.data as { id?: string })?.id ?? null
    if (!callerId) return json({ error: 'jeton invalide' }, 401)

    const admin = await rest(SUPABASE_URL, SERVICE_KEY, '/rest/v1/rpc/is_platform_admin',
      { method: 'POST', body: '{}' }, porteur)
    plateforme = admin.ok && admin.data === true

    if (!plateforme) {
      const prof = await rest(SUPABASE_URL, SERVICE_KEY,
        `/rest/v1/profiles?id=eq.${callerId}&select=agency_id,active`)
      const moi = Array.isArray(prof.data)
        ? (prof.data[0] as { agency_id?: string; active?: boolean } | undefined)
        : undefined
      if (!moi || !moi.active) return json({ error: 'profil introuvable ou inactif' }, 403)
      agenceDuCompte = moi.agency_id ?? null
    }
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'corps illisible' }, 400) }

  const from = Deno.env.get('EMAIL_FROM') || ''
  const cle = fournisseur.cle()
  // La raison exacte, pour que Nadir sache quoi poser. Deux variables, pas une.
  const manque = !cle
    ? `${fournisseur.nom === 'resend' ? 'RESEND_API_KEY' : fournisseur.nom === 'brevo' ? 'BREVO_API_KEY' : 'la clé du fournisseur'} n'est pas posée`
    : !from
      ? 'EMAIL_FROM n\'est pas posée : sans adresse d\'expéditeur sur un domaine à nous, le message tomberait en indésirable'
      : null
  const pret = manque === null

  // Le sondage : l'application veut savoir si l'envoi marche, sans envoyer.
  // Sans lui, l'état de `email_config` ne se rafraîchirait qu'au premier envoi,
  // c'est à dire au premier échec.
  if (body.probe === true) {
    await constater(pret, manque, pret ? from : null)
    return json({ ready: pret, provider: fournisseur.nom, from: pret ? from : null, reason: manque })
  }

  // 2. Ce qu'on demande.
  const genre = String(body.kind ?? '')
  const to = String(body.to ?? '').trim()
  const subject = String(body.subject ?? '').trim()
  const html = body.html ? String(body.html) : null
  const text = body.text ? String(body.text) : null
  const replyToDemande = body.reply_to ? String(body.reply_to).trim() : null
  const tags = (body.tags && typeof body.tags === 'object')
    ? (body.tags as Record<string, string>) : {}

  if (!GENRES.has(genre)) return json({ error: 'genre de courriel inconnu' }, 400)
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json({ error: 'adresse destinataire invalide' }, 400)
  if (!subject) return json({ error: 'objet obligatoire' }, 400)
  if (!html && !text) return json({ error: 'corps obligatoire : html ou text' }, 400)

  // 3. Quelle agence, et le droit d'écrire en son nom.
  let agency: string | null = body.agency_id ? String(body.agency_id) : null
  if (!serveur && !plateforme) {
    // Un compte d'agence n'envoie que pour la sienne, et jamais au nom de la
    // plateforme. Même règle que `invite-user`.
    if (agency && agency !== agenceDuCompte) return json({ error: 'pas votre agence' }, 403)
    agency = agenceDuCompte
    if (!agency) return json({ error: 'profil sans agence' }, 403)
  }

  // 4. La limite de débit, tenue en base. Une boucle mal écrite côté
  //    application, et c'est le domaine d'envoi qui se retrouve sur une liste
  //    noire. Elle se répare en semaines, pas en minutes.
  try {
    const permis = await call('email_rate_ok', { p_agency: agency })
    if (permis === false) {
      await tracer({
        p_agency: agency, p_kind: genre, p_to: to, p_subject: subject,
        p_status: 'echoue', p_provider: fournisseur.nom, p_provider_id: null,
        p_error: 'limite de débit atteinte : 200 courriels par heure et par agence',
        p_sent_by: callerId,
      })
      return json({ error: 'trop de courriels cette heure ci, réessayez plus tard' }, 429)
    }
  } catch (e) {
    // Le compteur est en panne : on laisse passer plutôt que de bloquer le
    // produit, mais on le dit dans le journal du bord.
    console.error('email_rate_ok', String(e))
  }

  // 5. L'expéditeur de l'agence, en réponse et pas en expéditeur.
  let replyTo = replyToDemande
  if (!replyTo && agency) {
    const ag = await rest(SUPABASE_URL, SERVICE_KEY, `/rest/v1/agencies?id=eq.${agency}&select=email`)
    const mail = Array.isArray(ag.data) ? (ag.data[0] as { email?: string })?.email : null
    if (mail) replyTo = mail
  }

  // 6. Pas de clé : on écrit ce qui SERAIT parti, et on répond 503. On ne
  //    prétend pas que c'est envoyé, et on ne casse pas l'appelant non plus.
  if (!pret) {
    await constater(false, manque, null)
    const trace = await tracer({
      p_agency: agency, p_kind: genre, p_to: to, p_subject: subject,
      p_status: 'non_configure', p_provider: fournisseur.nom, p_provider_id: null,
      p_error: manque, p_sent_by: callerId,
    })
    return json({
      error: 'l\'envoi de courriels n\'est pas configuré : rien n\'est parti',
      reason: manque,
      configured: false,
      log_id: trace,
    }, 503)
  }

  // 7. L'envoi.
  await constater(true, null, from)
  const res = await fournisseur.envoyer(
    { from, to, subject, html, text, replyTo, tags: { ...tags, kind: genre } },
    cle!,
  )

  const trace = await tracer({
    p_agency: agency, p_kind: genre, p_to: to, p_subject: subject,
    p_status: res.ok ? 'envoye' : 'echoue',
    p_provider: fournisseur.nom,
    p_provider_id: res.providerId,
    p_error: res.erreur,
    p_sent_by: callerId,
  })

  if (!res.ok) {
    return json({ error: 'le fournisseur a refusé le message', reason: res.erreur, log_id: trace }, 502)
  }
  return json({ ok: true, provider: fournisseur.nom, provider_id: res.providerId, log_id: trace })
})
