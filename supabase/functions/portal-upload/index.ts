/* Le dépôt de pièce depuis l'application client.
   Le client n'a pas de compte, seulement un jeton de suivi. Il ne peut donc
   pas écrire dans le stockage lui-même. Cette fonction fait le pont : elle
   valide le jeton, dépose le fichier avec la clé de service (qui ne quitte
   jamais le serveur), et marque la pièce reçue. Le client ne choisit ni le
   seau, ni le chemin : le serveur les impose depuis le dossier. */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

/** 12 Mo, la même limite que le seau et que le contrôle côté app. */
const MAX_BYTES = 12 * 1024 * 1024
const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'application/pdf'])

async function rpc(fn: string, args: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!res.ok) throw new Error(`${fn} ${res.status}`)
  const t = await res.text()
  return t ? JSON.parse(t) : null
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'méthode' }, 405)

  const token = req.headers.get('x-portal-token')
  const docKey = req.headers.get('x-document-key')
  const name = req.headers.get('x-file-name') ?? 'piece'
  const type = req.headers.get('content-type') ?? 'application/octet-stream'
  if (!token || !docKey) return json({ error: 'jeton ou pièce manquants' }, 400)
  if (!ACCEPTED.has(type)) return json({ error: 'format refusé' }, 415)

  // Où déposer, et seulement si le jeton et la pièce vont ensemble.
  const target = await rpc('portal_doc_target', { p_token: token, p_doc_key: docKey })
  if (!target) return json({ error: 'jeton invalide' }, 403)

  const bytes = new Uint8Array(await req.arrayBuffer())
  if (bytes.byteLength === 0) return json({ error: 'fichier vide' }, 400)
  if (bytes.byteLength > MAX_BYTES) return json({ error: 'fichier trop lourd' }, 413)

  // Dépôt avec la clé de service, sur le chemin imposé par le serveur.
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${target.bucket}/${target.path}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': type, 'x-upsert': 'true',
    },
    body: bytes,
  })
  if (!up.ok) return json({ error: 'dépôt refusé', detail: await up.text() }, 502)

  // La pièce passe reçue. Le client n'a jamais touché case_documents.
  await rpc('portal_doc_received', {
    p_document: target.document_id, p_path: target.path, p_name: name, p_size: bytes.byteLength,
  })

  return json({ ok: true })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
