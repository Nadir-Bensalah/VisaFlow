import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n'
import type { TKey } from '@/i18n'
import { Button, Field, Input, Modal, Select } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { TempPassword } from '@/components/TempPassword'
import { inviteUser } from '@/lib/invite'
import type { InviteResult } from '@/lib/invite'
import { tenantUrl } from '@/tenant'
import {
  checkAgencyName, checkEmail, checkPhone, checkSlug, loadCountries, phoneCodeOf, searchCities, suggestSlugs,
} from '@/data/referentiels'
import type { CityOption, CountryOption, NameCheck, PhoneCheck, SlugCheck, EmailCheck } from '@/data/referentiels'
import type { Locale } from '@/data/types'

/**
 * Ouvrir une agence : quatre étapes, pas un formulaire à plat.
 *
 * C'est le geste par lequel un client entre. Il engage un contrat, un essai qui
 * court, un compte propriétaire qui reçoit un mot de passe. Un formulaire de
 * huit champs validés au clic final apprenait ses erreurs trop tard : le nom
 * pris, l'adresse déjà utilisée, le sous-domaine réservé, tout arrivait au
 * moment de créer, et parfois après avoir créé la moitié.
 *
 * TROIS RÈGLES ICI.
 *
 * Chaque champ se vérifie pendant la saisie, auprès du serveur, et le dit :
 * une coche quand c'est bon, la raison quand ça ne l'est pas. On n'avance pas
 * tant que l'étape n'est pas propre.
 *
 * La saisie survit : elle est gardée dans la session du navigateur. Un onglet
 * fermé par erreur, un rafraîchissement, et l'on reprend où l'on était.
 *
 * Une création qui échoue à mi-chemin ne laisse pas un demi-résultat muet.
 * La phase atteinte est mémorisée : si l'agence est créée mais que l'ouverture
 * du compte échoue, on reprend exactement là, sans recréer l'agence.
 */

type Etape = 'identite' | 'bureau' | 'proprietaire' | 'recap'
const ETAPES: Etape[] = ['identite', 'bureau', 'proprietaire', 'recap']

interface Brouillon {
  etape: Etape
  nom: string
  slug: string
  slugTouche: boolean
  pays: string
  villeId: string | null
  ville: string
  adresse: string
  codePostal: string
  telephone: string
  proprioNom: string
  proprioEmail: string
  langue: Locale
  /** La phase de création atteinte, pour reprendre après un échec. */
  phase: 'saisie' | 'agence_creee' | 'compte_ouvert'
  agencyId: string | null
}

const VIDE: Brouillon = {
  etape: 'identite', nom: '', slug: '', slugTouche: false, pays: 'TN',
  villeId: null, ville: '', adresse: '', codePostal: '', telephone: '',
  proprioNom: '', proprioEmail: '', langue: 'fr', phase: 'saisie', agencyId: null,
}
const CLE = 'visaflow.ouverture'

type Verdict<T> = { etat: 'vide' | 'attente' | 'ok' | 'ko'; detail?: T }

/** Attend que la personne ait fini de taper avant d'interroger le serveur. */
function useDebounce<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => { const id = window.setTimeout(() => setV(value), ms); return () => window.clearTimeout(id) }, [value, ms])
  return v
}

export function OuvrirAgence({ onClose, onDone, toast }: { onClose: () => void; onDone: () => void; toast: (m: string) => void }) {
  const { t, locale } = useI18n()
  const [b, setB] = useState<Brouillon>(() => {
    try { const r = window.sessionStorage.getItem(CLE); return r ? { ...VIDE, ...(JSON.parse(r) as Partial<Brouillon>) } : VIDE } catch { return VIDE }
  })
  const set = <K extends keyof Brouillon>(k: K, v: Brouillon[K]) => setB((p) => ({ ...p, [k]: v }))
  useEffect(() => { try { window.sessionStorage.setItem(CLE, JSON.stringify(b)) } catch { /* stockage indisponible */ } }, [b])

  const [pays, setPays] = useState<CountryOption[]>([])
  useEffect(() => { loadCountries().then(setPays).catch(() => setPays([])) }, [])
  const paysCourant = pays.find((p) => p.iso2 === b.pays)
  const indicatif = phoneCodeOf(pays, b.pays)
  const nomPays = (p: CountryOption) => locale === 'ar' ? p.nameAr : locale === 'en' ? p.nameEn : p.nameFr

  /* ---------------------------- Le nom ------------------------------ */
  const nomD = useDebounce(b.nom.trim(), 400)
  const [nomV, setNomV] = useState<Verdict<NameCheck>>({ etat: 'vide' })
  useEffect(() => {
    if (!nomD) { setNomV({ etat: 'vide' }); return }
    let vivant = true
    setNomV({ etat: 'attente' })
    checkAgencyName(nomD).then((r) => { if (vivant) setNomV({ etat: r.ok ? 'ok' : 'ko', detail: r }) })
      .catch(() => { if (vivant) setNomV({ etat: 'ko' }) })
    return () => { vivant = false }
  }, [nomD])

  /* ------------------------- Le sous-domaine ------------------------ */
  const [suggestions, setSuggestions] = useState<string[]>([])
  useEffect(() => {
    if (nomV.etat !== 'ok') { setSuggestions([]); return }
    let vivant = true
    suggestSlugs(nomD, 5, b.ville || null).then((s) => {
      if (!vivant) return
      setSuggestions(s)
      // Tant que la personne n'a pas touché au sous-domaine, on lui propose
      // le premier libre. Dès qu'elle l'édite, on ne le lui reprend plus.
      if (!b.slugTouche && s[0]) setB((p) => (p.slugTouche ? p : { ...p, slug: s[0] }))
    }).catch(() => { if (vivant) setSuggestions([]) })
    return () => { vivant = false }
  }, [nomV.etat, nomD, b.ville, b.slugTouche])

  const slugD = useDebounce(b.slug.trim(), 400)
  const [slugV, setSlugV] = useState<Verdict<SlugCheck>>({ etat: 'vide' })
  useEffect(() => {
    if (!slugD) { setSlugV({ etat: 'vide' }); return }
    let vivant = true
    setSlugV({ etat: 'attente' })
    checkSlug(slugD).then((r) => { if (vivant) setSlugV({ etat: r.ok ? 'ok' : 'ko', detail: r }) })
      .catch(() => { if (vivant) setSlugV({ etat: 'ko' }) })
    return () => { vivant = false }
  }, [slugD])

  /* ---------------------------- La ville ---------------------------- */
  const [villes, setVilles] = useState<CityOption[]>([])
  const [villeOuverte, setVilleOuverte] = useState(false)
  const villeD = useDebounce(b.ville, 250)
  useEffect(() => {
    if (!villeOuverte) return
    let vivant = true
    searchCities(b.pays, villeD, 12).then((v) => { if (vivant) setVilles(v) }).catch(() => { if (vivant) setVilles([]) })
    return () => { vivant = false }
  }, [b.pays, villeD, villeOuverte])
  const villeRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const ferme = (e: MouseEvent) => { if (!villeRef.current?.contains(e.target as Node)) setVilleOuverte(false) }
    document.addEventListener('mousedown', ferme); return () => document.removeEventListener('mousedown', ferme)
  }, [])

  /* -------------------------- Le téléphone -------------------------- */
  const telD = useDebounce(b.telephone.trim(), 400)
  const [telV, setTelV] = useState<Verdict<PhoneCheck>>({ etat: 'vide' })
  useEffect(() => {
    if (!telD) { setTelV({ etat: 'vide' }); return }
    let vivant = true
    setTelV({ etat: 'attente' })
    checkPhone(telD, b.pays).then((r) => { if (vivant) setTelV({ etat: r.ok ? 'ok' : 'ko', detail: r }) })
      .catch(() => { if (vivant) setTelV({ etat: 'ko' }) })
    return () => { vivant = false }
  }, [telD, b.pays])

  /* ---------------------------- L'e-mail ---------------------------- */
  const emailD = useDebounce(b.proprioEmail.trim().toLowerCase(), 400)
  const [emailV, setEmailV] = useState<Verdict<EmailCheck>>({ etat: 'vide' })
  useEffect(() => {
    if (!emailD) { setEmailV({ etat: 'vide' }); return }
    let vivant = true
    setEmailV({ etat: 'attente' })
    checkEmail(emailD).then((r) => { if (vivant) setEmailV({ etat: r.ok ? 'ok' : 'ko', detail: r }) })
      .catch(() => { if (vivant) setEmailV({ etat: 'ko' }) })
    return () => { vivant = false }
  }, [emailD])

  /* ---------------------- Ce qui autorise à avancer ------------------ */
  const identiteOk = nomV.etat === 'ok' && slugV.etat === 'ok'
  const bureauOk = !!b.pays && b.ville.trim().length >= 2 && (telV.etat === 'ok' || (telV.etat === 'vide'))
  const proprioOk = b.proprioNom.trim().length >= 2 && emailV.etat === 'ok'
  const etapeOk: Record<Etape, boolean> = { identite: identiteOk, bureau: bureauOk, proprietaire: proprioOk, recap: true }
  const idx = ETAPES.indexOf(b.etape)
  const suivante = () => { if (idx < ETAPES.length - 1) set('etape', ETAPES[idx + 1]) }
  const precedente = () => { if (idx > 0) set('etape', ETAPES[idx - 1]) }

  /* ----------------------------- Créer ------------------------------ */
  const [busy, setBusy] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [cree, setCree] = useState<(InviteResult & { name: string; phone: string; locale: Locale }) | null>(null)

  const creer = async () => {
    if (!supabase) return
    setBusy(true); setErreur(null)
    let agencyId = b.agencyId
    try {
      // Phase 1 : l'agence et son premier bureau. Sautée si déjà faite.
      if (b.phase === 'saisie' || !agencyId) {
        const { data, error } = await supabase.rpc('platform_create_agency', {
          p_name: b.nom.trim(), p_slug: b.slug.trim().toLowerCase(),
          p_country: paysCourant ? paysCourant.nameFr : 'Tunisie',
          p_commission_kind: 'par_utilisateur', p_commission_amount: 45,
          p_city: b.ville.trim() || null, p_phone: (telV.detail?.normalise ?? b.telephone.trim()) || null,
        })
        if (error) throw new Error(error.message)
        agencyId = String(data)
        setB((p) => ({ ...p, phase: 'agence_creee', agencyId }))
      }
      // Phase 1 bis : l'adresse du bureau, que la création ne connaît pas.
      const { data: det } = await supabase.rpc('platform_agency_detail', { p_agency: agencyId })
      const bureau = (det as { offices?: { id: string; name: string; active: boolean }[] } | null)?.offices?.find((o) => o.active)
      if (bureau && (b.adresse.trim() || b.codePostal.trim())) {
        await supabase.rpc('platform_save_office', {
          p_agency: agencyId, p_office: bureau.id, p_name: bureau.name, p_city: b.ville.trim() || null,
          p_country: paysCourant ? paysCourant.nameFr : 'Tunisie',
          p_phone: (telV.detail?.normalise ?? b.telephone.trim()) || null,
          p_address: [b.adresse.trim(), b.codePostal.trim()].filter(Boolean).join(', ') || null, p_active: true,
        })
      }
      // Phase 2 : le compte du propriétaire. C'est ici que ça échouait en
      // silence : on mémorise la phase pour reprendre sans recréer l'agence.
      if (!bureau) throw new Error(t('ouv.failed'))
      const r = await inviteUser({
        agencyId, officeId: bureau.id, role: 'owner', name: b.proprioNom.trim(),
        email: emailD, phone: (telV.detail?.normalise ?? b.telephone.trim()) || undefined, locale: b.langue,
      })
      setB((p) => ({ ...p, phase: 'compte_ouvert' }))
      setCree({ ...r, name: b.proprioNom.trim(), phone: telV.detail?.normalise ?? b.telephone.trim(), locale: b.langue })
      try { window.sessionStorage.removeItem(CLE) } catch { /* rien */ }
    } catch (e) {
      setErreur(e instanceof Error ? e.message : t('ouv.failed'))
    } finally {
      setBusy(false)
    }
  }

  if (cree) {
    return (
      <TempPassword name={cree.name} email={cree.email} phone={cree.phone} tempPassword={cree.tempPassword}
        url={tenantUrl(b.slug.trim().toLowerCase())} locale={cree.locale}
        onClose={() => { onDone(); toast(t('ouv.done')) }} />
    )
  }

  /* ---------------------------- Le rendu ---------------------------- */
  const Coche = ({ v }: { v: Verdict<unknown> }) => (
    <span className={`ouv__coche ouv__coche--${v.etat}`} aria-hidden="true">
      {v.etat === 'ok' && <Icon name="check" size={13} />}
      {v.etat === 'ko' && <Icon name="close" size={13} />}
      {v.etat === 'attente' && <span className="ouv__spin" />}
    </span>
  )
  const raison = (prefix: string, v: Verdict<{ raison?: string | null }>) =>
    v.etat === 'ko' && v.detail?.raison ? t(`ouv.${prefix}${v.detail.raison.charAt(0).toUpperCase()}${v.detail.raison.slice(1).replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())}` as TKey) : undefined

  return (
    <Modal
      title={t('ouv.title')}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="t-caption t-tertiary grow">{t('ouv.subtitle')}</span>
          {idx > 0 && <Button onClick={precedente} disabled={busy}>{t('ouv.back')}</Button>}
          {b.etape !== 'recap'
            ? <Button variant="primary" disabled={!etapeOk[b.etape]} onClick={suivante}>{t('ouv.next')}</Button>
            : <Button variant="primary" disabled={busy || !identiteOk || !proprioOk} onClick={() => void creer()}>
                {busy ? t('ouv.creating') : b.phase === 'agence_creee' ? t('ouv.resume') : t('ouv.create')}
              </Button>}
        </>
      }
    >
      <ol className="ouv__etapes">
        {ETAPES.map((e, i) => (
          <li key={e} className={`ouv__etape ${i === idx ? 'ouv__etape--active' : ''} ${i < idx ? 'ouv__etape--faite' : ''}`}>
            <span className="ouv__num">{i < idx ? <Icon name="check" size={11} /> : i + 1}</span>
            <span>{t(`ouv.step${e === 'identite' ? 'Identity' : e === 'bureau' ? 'Address' : e === 'proprietaire' ? 'Owner' : 'Review'}` as TKey)}</span>
          </li>
        ))}
      </ol>

      {b.etape === 'identite' && (
        <div className="col gap-4">
          <Field label={t('ouv.name')} hint={raison('name', nomV) ?? t('ouv.nameHint')}>
            <div className="ouv__champ">
              <Input value={b.nom} autoFocus onChange={(e) => set('nom', e.target.value)} />
              <Coche v={nomV} />
            </div>
          </Field>
          {nomV.etat === 'ok' && (nomV.detail?.proches?.length ?? 0) > 0 && (
            <div className="ouv__proches">
              <span className="t-small t-medium">{t('ouv.nameProches')}</span>
              <span className="t-caption t-tertiary">{t('ouv.nameProchesHint')}</span>
              <ul>{nomV.detail!.proches.map((p) => <li key={p.slug}><b>{p.name}</b> <span className="t-caption t-tertiary">{p.slug}</span></li>)}</ul>
            </div>
          )}
          <Field label={t('ouv.slug')} hint={raison('slug', slugV) ?? `${b.slug || 'agence'}.visaflow.app`}>
            <div className="ouv__champ">
              <Input value={b.slug} onChange={(e) => { set('slug', e.target.value.toLowerCase()); set('slugTouche', true) }} />
              <Coche v={slugV} />
            </div>
          </Field>
          {(suggestions.length > 0 || (slugV.detail?.suggestions?.length ?? 0) > 0) && (
            <div className="row gap-2 wrap">
              <span className="t-caption t-tertiary">{t('ouv.slugSuggestions')}</span>
              {[...new Set([...(slugV.detail?.suggestions ?? []), ...suggestions])].slice(0, 6).map((s) => (
                <button key={s} type="button" className={`chip ${s === b.slug ? 'chip--on' : ''}`} onClick={() => { set('slug', s); set('slugTouche', true) }}>{s}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {b.etape === 'bureau' && (
        <div className="col gap-4">
          <Field label={t('ouv.country')} hint={t('ouv.countryHint')}>
            <Select value={b.pays} onChange={(e) => { set('pays', e.target.value); set('ville', ''); set('villeId', null) }}>
              {pays.map((p) => <option key={p.iso2} value={p.iso2}>{p.emoji ?? ''} {nomPays(p)}</option>)}
            </Select>
          </Field>
          <Field label={t('ouv.city')} hint={t('ouv.cityHint')}>
            <div className="ouv__ville" ref={villeRef}>
              <Input value={b.ville} onFocus={() => setVilleOuverte(true)}
                onChange={(e) => { set('ville', e.target.value); set('villeId', null); setVilleOuverte(true) }} />
              {villeOuverte && (
                <ul className="ouv__liste" role="listbox">
                  {villes.length === 0 && (
                    <li className="ouv__liste-vide"><b>{t('ouv.cityNoResult')}</b><span className="t-caption t-tertiary">{t('ouv.cityNoResultHint')}</span></li>
                  )}
                  {villes.map((v) => (
                    <li key={v.id} role="option" aria-selected={v.id === b.villeId}>
                      <button type="button" onClick={() => { set('ville', v.name); set('villeId', v.id); setVilleOuverte(false) }}>
                        <span>{v.name}{v.nameAr && locale === 'ar' ? ` · ${v.nameAr}` : ''}</span>
                        {v.region && <span className="t-caption t-tertiary">{v.region}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Field>
          <div className="grid grid--2">
            <Field label={t('ouv.address')} hint={t('ouv.addressHint')}><Input value={b.adresse} onChange={(e) => set('adresse', e.target.value)} /></Field>
            <Field label={t('ouv.postalCode')}><Input value={b.codePostal} onChange={(e) => set('codePostal', e.target.value)} /></Field>
          </div>
          <Field label={t('ouv.phone')} hint={raison('phone', telV) ?? (telV.detail?.normalise ? `${t('ouv.phoneNormalise')} ${telV.detail.normalise}` : t('ouv.phoneHint'))}>
            <div className="ouv__champ">
              <span className="ouv__indicatif">{paysCourant?.emoji ?? ''} {indicatif ?? '+…'}</span>
              <Input type="tel" value={b.telephone} onChange={(e) => set('telephone', e.target.value)} />
              <Coche v={telV} />
            </div>
          </Field>
        </div>
      )}

      {b.etape === 'proprietaire' && (
        <div className="col gap-4">
          <Field label={t('ouv.ownerName')}>
            <Input value={b.proprioNom} autoFocus onChange={(e) => set('proprioNom', e.target.value)} />
          </Field>
          <Field label={t('ouv.ownerEmail')} hint={raison('email', emailV) ?? (emailV.detail?.dejaUtilise ? t('ouv.emailDejaUtiliseHint') : t('ouv.ownerEmailHint'))}>
            <div className="ouv__champ">
              <Input type="email" value={b.proprioEmail} onChange={(e) => set('proprioEmail', e.target.value)} />
              <Coche v={emailV} />
            </div>
          </Field>
          <Field label={t('misc.language')}>
            <Select value={b.langue} onChange={(e) => set('langue', e.target.value as Locale)}>
              <option value="fr">Français</option><option value="ar">العربية</option><option value="en">English</option>
            </Select>
          </Field>
        </div>
      )}

      {b.etape === 'recap' && (
        <div className="col gap-4">
          <p className="t-small t-secondary" style={{ margin: 0 }}>{t('ouv.reviewHint')}</p>
          <dl className="ouv__recap">
            <dt>{t('ouv.name')}</dt><dd>{b.nom}</dd>
            <dt>{t('ouv.slug')}</dt><dd className="t-mono">{b.slug}.visaflow.app</dd>
            <dt>{t('ouv.country')}</dt><dd>{paysCourant?.emoji} {paysCourant ? nomPays(paysCourant) : b.pays}</dd>
            <dt>{t('ouv.city')}</dt><dd>{b.ville}{b.adresse ? `, ${b.adresse}` : ''}{b.codePostal ? ` ${b.codePostal}` : ''}</dd>
            <dt>{t('ouv.phone')}</dt><dd className="t-mono">{telV.detail?.normalise ?? b.telephone ?? '—'}</dd>
            <dt>{t('ouv.ownerName')}</dt><dd>{b.proprioNom}</dd>
            <dt>{t('ouv.ownerEmail')}</dt><dd className="t-mono">{emailD}</dd>
          </dl>
          {b.phase === 'agence_creee' && (
            <p className="ouv__reprise t-small"><Icon name="alert" size={14} /> {t('ouv.resumeHint')}</p>
          )}
          {erreur && <p className="t-small" style={{ color: 'var(--red)', margin: 0 }}>{erreur}</p>}
        </div>
      )}
    </Modal>
  )
}

/** Tout jeter et repartir de zéro : utile quand un brouillon d'hier traîne. */
export function effacerBrouillonOuverture() {
  try { window.sessionStorage.removeItem(CLE) } catch { /* rien */ }
}

export const OUVERTURE_ETAPES = ETAPES
export type { Brouillon as BrouillonOuverture }
