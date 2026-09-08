import { supabase, HAS_BACKEND } from '@/lib/supabase'
import type { Role, Locale } from '@/data/types'

/**
 * Ouvrir un compte à quelqu'un.
 *
 * Un profil référence un compte de connexion, et un compte ne se crée qu'avec
 * la clé de service, qui ne touche jamais un navigateur. Le geste passe donc
 * par la fonction de bord `invite-user`, qui vérifie qui invite qui : la
 * plateforme partout, le propriétaire dans son agence, un manager seulement
 * pour des agents et des lecteurs.
 *
 * Elle rend un mot de passe PROVISOIRE, une seule fois. Il n'est écrit nulle
 * part : c'est à qui invite de le transmettre, par téléphone ou WhatsApp.
 */
export type InviteInput = {
  agencyId: string
  officeId: string
  role: Role
  name: string
  email: string
  phone?: string
  locale?: Locale
}

export type InviteResult = { userId: string; email: string; tempPassword: string }

export async function inviteUser(input: InviteInput): Promise<InviteResult> {
  if (!HAS_BACKEND || !supabase) throw new Error('demo')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('session')

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      agency_id: input.agencyId,
      office_id: input.officeId,
      role: input.role,
      name: input.name,
      email: input.email,
      phone: input.phone ?? null,
      locale: input.locale ?? 'fr',
    }),
  })
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean; user_id?: string; email?: string; temp_password?: string; error?: string
  }
  if (!res.ok || !body.ok || !body.user_id || !body.temp_password) {
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return { userId: body.user_id, email: body.email ?? input.email, tempPassword: body.temp_password }
}

/** Le texte prêt à coller dans WhatsApp, pour transmettre l'accès. */
export function inviteMessage(opts: { name: string; email: string; tempPassword: string; url: string; locale: Locale }): string {
  const { name, email, tempPassword, url } = opts
  if (opts.locale === 'ar') {
    return `مرحباً ${name}، هذا حسابك على VisaFlow:\n${url}\nالبريد: ${email}\nكلمة المرور المؤقتة: ${tempPassword}\nستُطلب منك كلمة مرور جديدة عند أول دخول.`
  }
  if (opts.locale === 'en') {
    return `Hello ${name}, here is your VisaFlow access:\n${url}\nEmail: ${email}\nTemporary password: ${tempPassword}\nYou will be asked to choose a new one on first sign-in.`
  }
  return `Bonjour ${name}, voici votre accès VisaFlow :\n${url}\nE-mail : ${email}\nMot de passe provisoire : ${tempPassword}\nUn nouveau mot de passe vous sera demandé à la première connexion.`
}
