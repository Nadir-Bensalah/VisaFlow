/* Ouvrir un compte à quelqu'un : un employé, un manager, un propriétaire.
 *
 * Un profil référence auth.users, et un compte ne se crée qu'avec la clé de
 * service, qui ne doit jamais toucher un navigateur. Cette fonction est donc le
 * SEUL endroit où un compte naît. Elle décide qui a le droit d'inviter qui :
 *
 *   · La plateforme (super-admin) invite n'importe qui dans n'importe quelle
 *     agence : c'est ainsi qu'une agence reçoit son premier propriétaire.
 *   · Le propriétaire d'une agence invite dans SON agence, tout rôle.
 *   · Un manager invite dans SON agence, mais seulement des agents ou des
 *     lecteurs : il ne fabrique pas ses pairs, encore moins son patron.
 *   · Personne d'autre.
 *
 * Le projet n'a pas de serveur d'envoi de courriels (Supabase en offre deux
 * par heure, vers localhost). Le compte naît donc avec un mot de passe
 * PROVISOIRE, rendu UNE fois à qui invite, qui le transmet par téléphone ou
 * WhatsApp, comme une agence tunisienne le ferait de toute façon. Le profil
 * porte must_reset_password : l'application bloque tout jusqu'au changement. */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const ROLES = new Set(['owner', 'manager', 'agent', 'viewer'])

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, content-type, apikey',
    },
  })

async function rest(path: string, init: RequestInit = {}, token = SERVICE_KEY) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  let data: unknown = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { ok: res.ok, status: res.status, data }
}

/* Un mot de passe provisoire lisible au téléphone : pas de 0/O ni de 1/l/I,
   et des groupes de quatre. Il ne sert qu'une fois. */
function motDePasseProvisoire(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length])
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8).join('')}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({}, 204)
  if (req.method !== 'POST') return json({ error: 'méthode' }, 405)

  // 1. Qui appelle ? Le jeton du navigateur, vérifié par l'auth elle-même.
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!bearer || bearer === ANON_KEY) return json({ error: 'connexion requise' }, 401)
  const who = await rest('/auth/v1/user', { method: 'GET' }, bearer)
  if (!who.ok) return json({ error: 'jeton invalide' }, 401)
  const callerId = (who.data as { id?: string }).id
  if (!callerId) return json({ error: 'jeton invalide' }, 401)

  // 2. Ce qu'on demande.
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'corps illisible' }, 400) }
  const agencyId = String(body.agency_id ?? '')
  const officeId = String(body.office_id ?? '')
  const role = String(body.role ?? 'agent')
  const name = String(body.name ?? '').trim()
  const email = String(body.email ?? '').trim().toLowerCase()
  const phone = body.phone ? String(body.phone).trim() : null
  const locale = String(body.locale ?? 'fr')
  if (!agencyId || !officeId || !name || !email) return json({ error: 'agence, bureau, nom et e-mail obligatoires' }, 400)
  if (!ROLES.has(role)) return json({ error: 'rôle inconnu' }, 400)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'adresse e-mail invalide' }, 400)

  // 3. Qui a le droit d'inviter qui.
  const isPlatform = await rest('/rest/v1/rpc/is_platform_admin', { method: 'POST', body: '{}' }, bearer)
  const plateforme = isPlatform.ok && isPlatform.data === true

  if (!plateforme) {
    const prof = await rest(`/rest/v1/profiles?id=eq.${callerId}&select=agency_id,role,active`)
    const me = Array.isArray(prof.data) ? (prof.data[0] as { agency_id?: string; role?: string; active?: boolean } | undefined) : undefined
    if (!me || !me.active) return json({ error: 'profil introuvable ou inactif' }, 403)
    if (me.agency_id !== agencyId) return json({ error: 'pas votre agence' }, 403)
    if (me.role === 'owner') {
      // Le propriétaire invite tout rôle dans son agence.
    } else if (me.role === 'manager') {
      if (role === 'owner' || role === 'manager') return json({ error: 'un manager n\'invite que des agents et des lecteurs' }, 403)
    } else {
      return json({ error: 'réservé au propriétaire et aux managers' }, 403)
    }
  }

  // 4. Le bureau doit appartenir à l'agence : on n'invite pas quelqu'un dans
  //    le bureau d'une autre agence par une faute de frappe.
  const off = await rest(`/rest/v1/offices?id=eq.${officeId}&agency_id=eq.${agencyId}&select=id`)
  if (!Array.isArray(off.data) || off.data.length === 0) return json({ error: 'bureau inconnu dans cette agence' }, 400)

  // 5. Le compte. Une adresse déjà prise est une erreur claire, pas un doublon.
  const password = motDePasseProvisoire()
  const created = await rest('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email, password, email_confirm: true,
      user_metadata: { name, locale, invited_by: callerId },
    }),
  })
  if (!created.ok) {
    const msg = String((created.data as { msg?: string; message?: string })?.msg
      ?? (created.data as { message?: string })?.message ?? '')
    if (created.status === 422 || /already|exists|registered/i.test(msg)) {
      return json({ error: 'cette adresse a déjà un compte' }, 409)
    }
    return json({ error: 'création du compte refusée', detail: created.data }, 502)
  }
  const userId = (created.data as { id: string }).id

  // 6. Le profil, avec le drapeau du mot de passe provisoire.
  const profile = await rest('/rest/v1/profiles', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      id: userId, agency_id: agencyId, office_id: officeId,
      name, email, phone, role, locale, active: true,
      invited_by: callerId, must_reset_password: true,
    }),
  })
  if (!profile.ok) {
    // Un compte sans profil ne servirait à rien et polluerait la liste : on
    // le retire aussitôt.
    await rest(`/auth/v1/admin/users/${userId}`, { method: 'DELETE' })
    return json({ error: 'profil refusé', detail: profile.data }, 502)
  }

  // 7. Le mot de passe provisoire, rendu UNE fois. Il n'est écrit nulle part.
  return json({ ok: true, user_id: userId, email, temp_password: password })
})
