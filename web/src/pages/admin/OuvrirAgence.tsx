import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n'
import type { TKey } from '@/i18n'
import { Button, Card, Field, Input, Select, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { inviteMessage, inviteUser } from '@/lib/invite'
import type { InviteResult } from '@/lib/invite'
import { tenantUrl } from '@/tenant'
import { linkSignup } from '@/data/plateforme'
import {
  checkAgencyName, checkEmail, checkPhone, checkSlug, loadCountries, phoneCodeOf, searchCities, suggestSlugs,
} from '@/data/referentiels'
import type { CityOption, CountryOption, NameCheck, PhoneCheck, SlugCheck, EmailCheck } from '@/data/referentiels'
import type { Locale } from '@/data/types'
import { usePlateforme } from './contexte'
import { Confirmer, Erreur, PageHeader, Section, dateFr } from './kit'
import { chargerDemandes } from './Demandes'
import type { Signup } from './Demandes'
import '@/styles/admin-agences.css'

/**
 * Ouvrir une agence : quatre étapes, dans une PAGE.
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
 *
 * Et c'est une page, pas une modale : elle a une adresse, on peut y revenir,
 * la fermer, la rouvrir. Venant d'une demande de souscription (`?demande=`),
 * elle se préremplit et rattache la demande à l'agence née d'elle.
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
  /** La demande de souscription d'où vient cette ouverture, s'il y en a une. */
  signupId: string | null
}

const VIDE: Brouillon = {
  etape: 'identite', nom: '', slug: '', slugTouche: false, pays: 'TN',
  villeId: null, ville: '', adresse: '', codePostal: '', telephone: '',
  proprioNom: '', proprioEmail: '', langue: 'fr', phase: 'saisie', agencyId: null, signupId: null,
}
const CLE = 'visaflow.ouverture'
const JOURS_ESSAI = 15
const LOCALES: Locale[] = ['fr', 'en', 'ar', 'zh']

type Verdict<T> = { etat: 'vide' | 'attente' | 'ok' | 'ko'; detail?: T }

/** Attend que la personne ait fini de taper avant d'interroger le serveur. */
function useDebounce<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => { const id = window.setTimeout(() => setV(value), ms); return () => window.clearTimeout(id) }, [value, ms])
  return v
}

function lireBrouillon(): Brouillon {
  try { const r = window.sessionStorage.getItem(CLE); return r ? { ...VIDE, ...(JSON.parse(r) as Partial<Brouillon>) } : VIDE } catch { return VIDE }
}

/** Le brouillon est vide s'il ne porte encore aucune saisie et qu'aucune création n'a commencé. */
const brouillonVide = (b: Brouillon) => !b.nom && !b.ville && !b.proprioNom && !b.proprioEmail && !b.telephone && b.phase === 'saisie'

/** L'issue : ce qu'on garde une fois l'agence ouverte et le brouillon effacé. */
interface Issue {
  agencyId: string
  nom: string
  slug: string
  compte: InviteResult & { name: string; phone: string; locale: Locale }
}

export function OuvrirAgence() {
  const { can } = usePlateforme()
  const { t } = useI18n()
  if (!can('agences.ouvrir')) {
    return (
      <>
        <PageHeader kicker="Parc" title={t('ouv.title')} />
        <Erreur message={t('ouv.forbidden')} />
      </>
    )
  }
  return <Assistant />
}

function Assistant() {
  const { t, locale } = useI18n()
  const toast = useToast()
  const navigate = useNavigate()
  const { rafraichirCompteurs } = usePlateforme()
  const [params] = useSearchParams()
  const demandeId = params.get('demande')

  const [b, setB] = useState<Brouillon>(lireBrouillon)
  const set = <K extends keyof Brouillon>(k: K, v: Brouillon[K]) => setB((p) => ({ ...p, [k]: v }))
  useEffect(() => { try { window.sessionStorage.setItem(CLE, JSON.stringify(b)) } catch { /* stockage indisponible */ } }, [b])

  const [pays, setPays] = useState<CountryOption[]>([])
  useEffect(() => { loadCountries().then(setPays).catch(() => setPays([])) }, [])
  const paysCourant = pays.find((p) => p.iso2 === b.pays)
  const indicatif = phoneCodeOf(pays, b.pays)
  const nomPays = (p: CountryOption) => locale === 'ar' ? p.nameAr : locale === 'en' ? p.nameEn : p.nameFr

  /* ------------------------ Venant d'une demande ------------------------ */
  const [demande, setDemande] = useState<Signup | null>(null)
  useEffect(() => {
    if (!demandeId) return
    let vivant = true
    chargerDemandes().then((liste) => { if (vivant) setDemande(liste.find((d) => d.id === demandeId) ?? null) }).catch(() => { /* la page marche sans */ })
    return () => { vivant = false }
  }, [demandeId])
  // On ne préremplit que si le brouillon est vide, ou s'il concerne déjà cette
  // demande : un brouillon d'une autre ouverture ne s'écrase pas en silence.
  const prevenu = useRef(false)
  const bRef = useRef(b)
  bRef.current = b
  useEffect(() => {
    if (!demande || pays.length === 0) return
    const p = bRef.current
    if (p.signupId === demande.id && !brouillonVide(p)) return
    if (!brouillonVide(p)) {
      if (!prevenu.current) { prevenu.current = true; toast(t('ouv.draftKept')) }
      return
    }
    const iso = pays.find((c) => c.nameFr === demande.country || c.nameEn === demande.country || c.iso2 === demande.country)?.iso2 ?? p.pays
    const langue = LOCALES.includes(demande.locale as Locale) ? (demande.locale as Locale) : p.langue
    setB((q) => ({
      ...q, signupId: demande.id, nom: demande.agency_name, pays: iso, ville: demande.city ?? '', villeId: null,
      telephone: demande.phone ?? '', proprioNom: demande.contact_name, proprioEmail: demande.email ?? '', langue,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demande, pays])

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
  const [issue, setIssue] = useState<Issue | null>(null)
  const [abandon, setAbandon] = useState(false)

  const creer = async () => {
    if (!supabase) return
    setBusy(true); setErreur(null)
    let agencyId = b.agencyId
    const slug = b.slug.trim().toLowerCase()
    try {
      // Phase 1 : l'agence et son premier bureau. Sautée si déjà faite.
      if (b.phase === 'saisie' || !agencyId) {
        const { data, error } = await supabase.rpc('platform_create_agency', {
          p_name: b.nom.trim(), p_slug: slug,
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
      // Phase 3 : la demande d'où l'on vient passe en « convertie ». Si ça
      // échoue, l'agence existe quand même : on le dit, on ne bloque pas.
      if (b.signupId) {
        try { await linkSignup(b.signupId, agencyId) }
        catch (e) { toast(t('ouv.linkFailed', { msg: e instanceof Error ? e.message : '' })) }
      }
      setIssue({ agencyId, nom: b.nom.trim(), slug, compte: { ...r, name: b.proprioNom.trim(), phone: telV.detail?.normalise ?? b.telephone.trim(), locale: b.langue } })
      effacerBrouillonOuverture()
      toast(t('ouv.done'))
      rafraichirCompteurs()
    } catch (e) {
      setErreur(e instanceof Error ? e.message : t('ouv.failed'))
    } finally {
      setBusy(false)
    }
  }

  const abandonner = () => {
    effacerBrouillonOuverture()
    setAbandon(false)
    navigate('/admin/agences')
  }

  const recommencer = () => {
    effacerBrouillonOuverture()
    setIssue(null)
    setB(VIDE)
    setNomV({ etat: 'vide' }); setSlugV({ etat: 'vide' }); setTelV({ etat: 'vide' }); setEmailV({ etat: 'vide' })
    navigate('/admin/agences/nouvelle', { replace: true })
  }

  /* ---------------------------- L'issue ---------------------------- */
  if (issue) {
    return (
      <>
        <PageHeader kicker="Parc" title={t('ouv.done')} subtitle={t('ouv.doneHint')} />
        <div className="ag-ouv">
          <div className="ag-ouv__main">
            <AgenceOuverte issue={issue} onAutre={recommencer} />
          </div>
        </div>
      </>
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
    <>
      <PageHeader
        kicker="Parc"
        title={t('ouv.title')}
        subtitle={demande ? `${t('ouv.pageSubtitle')} ${t('ouv.fromSignup', { name: demande.agency_name })}` : t('ouv.pageSubtitle')}
        actions={<Button icon="close" onClick={() => setAbandon(true)}>{t('ouv.abandon')}</Button>}
      />

      <div className="ag-ouv">
        <div className="ag-ouv__main">
          <Card>
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
                      <button key={s} type="button" className="chip" aria-pressed={s === b.slug} onClick={() => { set('slug', s); set('slugTouche', true) }}>{s}</button>
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
                <div className="grid grid--2" style={{ gap: 'var(--sp-3)' }}>
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
                  <dt>{t('ouv.phone')}</dt><dd className="t-mono">{telV.detail?.normalise ?? b.telephone ?? '·'}</dd>
                  <dt>{t('ouv.ownerName')}</dt><dd>{b.proprioNom}</dd>
                  <dt>{t('ouv.ownerEmail')}</dt><dd className="t-mono">{emailD}</dd>
                </dl>
                {b.phase === 'agence_creee' && (
                  <p className="ouv__reprise t-small"><Icon name="alert" size={14} /> {t('ouv.resumeHint')}</p>
                )}
                {erreur && <p className="t-small" style={{ color: 'var(--red)', margin: 0 }}>{erreur}</p>}
              </div>
            )}

            <div className="ag-ouv__pied">
              <span className="t-caption t-tertiary grow">{t('ouv.subtitle')}</span>
              {idx > 0 && <Button onClick={precedente} disabled={busy}>{t('ouv.back')}</Button>}
              {b.etape !== 'recap'
                ? <Button variant="primary" disabled={!etapeOk[b.etape]} onClick={suivante}>{t('ouv.next')}</Button>
                : <Button variant="primary" disabled={busy || !identiteOk || !proprioOk} onClick={() => void creer()}>
                    {busy ? t('ouv.creating') : b.phase === 'agence_creee' ? t('ouv.resume') : t('ouv.create')}
                  </Button>}
            </div>
          </Card>
        </div>

        <aside className="ag-ouv__aside">
          <Section title={t('ouv.recap')}>
            <div className="ag-recap">
              <RecapItem label={t('ouv.name')} ok={nomV.etat === 'ok'} vide={t('ouv.recapEmpty')}>{b.nom.trim() || null}</RecapItem>
              <RecapItem label={t('ouv.web')} ok={slugV.etat === 'ok'} vide={t('ouv.recapEmpty')} mono>{b.slug ? `${b.slug}.visaflow.app` : null}</RecapItem>
              <RecapItem label={t('ouv.location')} ok={bureauOk} vide={t('ouv.recapEmpty')}>
                {paysCourant || b.ville ? `${paysCourant?.emoji ?? ''} ${paysCourant ? nomPays(paysCourant) : b.pays}${b.ville ? ` · ${b.ville}` : ''}`.trim() : null}
              </RecapItem>
              <RecapItem label={t('ouv.phone')} ok={telV.etat === 'ok'} vide={t('ouv.recapEmpty')} mono>{telV.detail?.normalise ?? (b.telephone.trim() || null)}</RecapItem>
              <RecapItem label={t('ouv.owner')} ok={proprioOk} vide={t('ouv.recapEmpty')}>
                {b.proprioNom.trim() || emailD ? <>{b.proprioNom.trim()}{emailD && <span className="t-caption t-mono" style={{ display: 'block' }}>{emailD}</span>}</> : null}
              </RecapItem>
            </div>
          </Section>
        </aside>
      </div>

      {abandon && (
        <Confirmer title={t('ouv.abandonTitle')} label={t('ouv.abandon')} danger onConfirm={abandonner} onClose={() => setAbandon(false)}>
          {t('ouv.abandonHint')}
        </Confirmer>
      )}
    </>
  )
}

/* ------------------------------ Le récapitulatif ------------------------------ */

function RecapItem({ label, ok, vide, mono, children }: { label: string; ok: boolean; vide: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="ag-recap__item">
      <span className={`ag-recap__coche ${ok ? 'ag-recap__coche--ok' : ''}`} aria-hidden="true">{ok && <Icon name="check" size={12} />}</span>
      <span className="ag-recap__corps">
        <span className="t-caption">{label}</span>
        {children ? <span className={`ag-recap__valeur ${mono ? 't-mono' : ''}`}>{children}</span> : <span className="ag-recap__valeur ag-recap__valeur--vide">{vide}</span>}
      </span>
    </div>
  )
}

/* ------------------------------ L'agence est ouverte ------------------------------ */

/**
 * L'issue, dans la page. Le mot de passe provisoire s'affiche UNE fois : il
 * n'est écrit nulle part ailleurs, c'est à qui ouvre l'agence de le
 * transmettre. Même contenu que la fenêtre « Accès créé » de l'équipe, mais
 * posé dans la page : le client ne veut plus de modale ici.
 */
function AgenceOuverte({ issue, onAutre }: { issue: Issue; onAutre: () => void }) {
  const { t } = useI18n()
  const [copie, setCopie] = useState(false)
  const url = tenantUrl(issue.slug)
  const texte = inviteMessage({ name: issue.compte.name, email: issue.compte.email, tempPassword: issue.compte.tempPassword, url, locale: issue.compte.locale })
  const digits = issue.compte.phone.replace(/\D/g, '')
  const wa = `https://wa.me/${digits}?text=${encodeURIComponent(texte)}`
  const finEssai = new Date(); finEssai.setDate(finEssai.getDate() + JOURS_ESSAI)

  const copier = async () => {
    try { await navigator.clipboard.writeText(texte); setCopie(true) } catch { /* presse-papiers indisponible */ }
  }

  return (
    <div className="col gap-5">
      <Card>
        <div className="ag-ouverte">
          <div className="ag-ouverte__tete">
            <span className="ag-ouverte__icone"><Icon name="check" size={20} /></span>
            <div className="col">
              <h2 className="ag-ouverte__titre">{issue.nom}</h2>
              <a className="t-mono t-small" href={url} target="_blank" rel="noreferrer">{url}</a>
            </div>
          </div>
          <dl className="ouv__recap">
            <dt>{t('ouv.trialUntil')}</dt><dd>{dateFr(finEssai.toISOString())} <span className="t-caption t-tertiary">{t('ouv.trialHint')}</span></dd>
            <dt>{t('ouv.owner')}</dt><dd>{issue.compte.name}</dd>
          </dl>
          <div className="ag-ouverte__gestes">
            <Link to={`/admin/agences/${issue.agencyId}`} className="btn btn--primary">{t('ouv.openSheet')}</Link>
            <Button icon="plus" onClick={onAutre}>{t('ouv.openAnother')}</Button>
          </div>
        </div>
      </Card>

      <Card title={t('equipe.tempTitle')}>
        <div className="col gap-4">
          <p className="t-small t-secondary" style={{ margin: 0 }}>{t('equipe.tempHint')}</p>
          <div className="col gap-1">
            <span className="t-caption t-tertiary">{t('login.email')}</span>
            <span className="t-mono t-small">{issue.compte.email}</span>
          </div>
          <div className="col gap-1">
            <span className="t-caption t-tertiary">{t('equipe.provisional')}</span>
            <span className="ag-mdp">{issue.compte.tempPassword}</span>
          </div>
          <div className="col gap-1">
            <span className="t-caption t-tertiary">{t('nav.portal')}</span>
            <span className="t-mono t-small">{url}</span>
          </div>
          <div className="row gap-2 wrap">
            <a className="btn btn--secondary" href={wa} target="_blank" rel="noreferrer"><Icon name="whatsapp" size={16} /> {t('equipe.whatsapp')}</a>
            <Button onClick={() => void copier()} icon={copie ? 'check' : 'copy'}>{copie ? t('equipe.copied') : t('equipe.copy')}</Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

/** Tout jeter et repartir de zéro : utile quand un brouillon d'hier traîne. */
export function effacerBrouillonOuverture() {
  try { window.sessionStorage.removeItem(CLE) } catch { /* rien */ }
}

export const OUVERTURE_ETAPES = ETAPES
export type { Brouillon as BrouillonOuverture }
