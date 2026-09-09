import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { rpc } from '@/data/remote'
import { Icon } from '@/components/Icon'
import type { IconName } from '@/components/Icon'
import type { VisaCase } from '@/data/types'

/**
 * Où en est ce dossier, dans l'ordre où l'agence le raconte.
 *
 * Quand on demande à une agente où en est un dossier, elle ne répond jamais
 * « étape quatre sur neuf ». Elle déroule : le client, son passeport, la
 * destination, le type de visa, les pièces, ce qui manque, le formulaire, le
 * règlement, les traductions, l'assurance, l'hôtel, le billet, le rendez-vous,
 * le dépôt, le suivi, la décision, le passeport rendu, et le recours s'il y a
 * lieu. Cet écran affiche exactement cette liste, dans cet ordre.
 *
 * DEUX CHOSES QU'IL NE FAIT PAS, ET C'EST VOULU.
 *
 * Il ne se coche pas à la main. Chaque ligne se déduit de ce qui est déjà
 * saisi ailleurs : la fiche client, les pièces, la caisse, les rendez-vous, la
 * garde du passeport. Une case à cocher de plus, c'est une case qu'on oublie de
 * cocher, et un écran qui ment le lendemain.
 *
 * Il ne remplace pas les étapes du métier (`stage`). Celles-là suivent le
 * dossier consulaire et servent au pipeline. Celle-ci sert à répondre au
 * téléphone. Les deux cohabitent parce qu'elles répondent à deux questions
 * différentes.
 *
 * Il se lit en deux colonnes sur un bureau, l'œil descend la première puis la
 * seconde. Chaque jalon sur lequel on peut agir mène à l'onglet de la fiche
 * où le geste se fait : les pièces, les paiements, les prestations, les
 * rendez-vous. Il vit dans l'onglet Aperçu de la fiche, sans carte à lui.
 */

type Etat = 'fait' | 'encours' | 'afaire' | 'bloque' | 'sansobjet'

interface Jalon {
  key: string
  label: string
  etat: Etat
  detail?: string
  icon: IconName
  href?: string
}

/** Ce que le serveur sait du voyage et des traductions, quand les modules sont là. */
interface Note { note?: boolean; reference?: string | null; date?: string | null; status?: string | null }
interface Extra {
  travel?: { billet?: Note; hebergement?: Note; assurance?: Note }
  trad?: { total: number; livrees: number; en_retard: number; toutes_livrees: boolean }
}

const TON: Record<Etat, string> = {
  fait: 'green', encours: 'blue', afaire: 'gray', bloque: 'red', sansobjet: 'gray',
}

export function CaseJourney({ kase }: { kase: VisaCase }) {
  const { db } = useStore()
  const v = useVisible()
  const { t, tt, formatDate, formatMoney } = useI18n()
  const [extra, setExtra] = useState<Extra>({})

  // Les deux modules « voyage » et « traduction » sont récents : une agence
  // installée avant eux n'a pas leurs fonctions. On demande, et on se passe de
  // la réponse si elle ne vient pas, plutôt que d'afficher une erreur pour une
  // information d'appoint.
  useEffect(() => {
    if (!HAS_BACKEND) return
    let vivant = true
    const lire = async () => {
      const out: Extra = {}
      try {
        const r = await rpc('travel_readiness', { p_case: kase.id })
        if (r && typeof r === 'object') out.travel = r as Extra['travel']
      } catch { /* module absent : la ligne retombe sur les pièces */ }
      try {
        const r = await rpc('case_translations', { p_case: kase.id })
        const o = r as { total?: number; livrees?: number; en_retard?: number; toutes_livrees?: boolean } | null
        if (o && typeof o.total === 'number') {
          out.trad = { total: o.total, livrees: o.livrees ?? 0, en_retard: o.en_retard ?? 0, toutes_livrees: !!o.toutes_livrees }
        }
      } catch { /* idem */ }
      if (vivant) setExtra(out)
    }
    void lire()
    return () => { vivant = false }
  }, [kase.id])

  const client = db.clients.find((c) => c.id === kase.clientId)
  const visa = db.visaTypes.find((x) => x.id === kase.visaTypeId)
  const docs = v.documents.filter((d) => d.caseId === kase.id)
  const requis = docs.filter((d) => d.required)
  const manquants = requis.filter((d) => d.state === 'manquante' || d.state === 'demandee' || d.state === 'refusee' || d.state === 'expiree')
  const rdv = v.appointments.filter((a) => a.caseId === kase.id).sort((a, b) => a.at.localeCompare(b.at))
  const attente = v.queue.find((q) => q.caseId === kase.id && q.status === 'attente')
  const garde = v.custody.find((g) => g.caseId === kase.id)
  const rendu = v.custody.find((g) => g.caseId === kase.id && g.returnedAt)

  /** L'état d'une pièce nommée de la liste : c'est là que vivent déjà le
      formulaire, l'assurance, l'hôtel et le billet. */
  const piece = (key: string) => docs.find((d) => d.key === key)
  const pieceEtat = (key: string): Etat => {
    const d = piece(key)
    if (!d) return 'sansobjet'
    if (d.state === 'validee' || d.state === 'recue') return 'fait'
    if (d.state === 'refusee' || d.state === 'expiree') return 'bloque'
    if (d.state === 'demandee') return 'encours'
    return 'afaire'
  }

  const passeIndex = ['nouveau', 'pieces', 'verification', 'rendez_vous', 'depot', 'consulat', 'decision', 'retrait', 'clos']
  const rang = passeIndex.indexOf(kase.stage)
  const apres = (etape: string) => rang > passeIndex.indexOf(etape)
  const a = (etape: string) => rang === passeIndex.indexOf(etape)

  /* Les onglets de la fiche : un jalon actionnable mène là où le geste se
     fait, pas vers une page globale où il faudrait retrouver le dossier. */
  const onglet = (nom: 'pieces' | 'paiements' | 'prestations' | 'rdv') => `/dossiers/${kase.id}?onglet=${nom}`

  /* Une ligne « voyage » se lit d'abord dans le suivi voyage quand il existe,
     sinon dans la pièce de la liste. Les deux disent la même chose vue de deux
     endroits : la pièce prouve au consulat, le suivi sert à l'agence. */
  const ligneVoyage = (key: 'assurance' | 'hotel' | 'billet', n?: Note): { etat: Etat; detail?: string; href?: string } => {
    if (n?.note) {
      const bout = [n.reference, n.date ? formatDate(n.date) : null].filter(Boolean).join(' · ')
      return { etat: 'fait', detail: bout || t('parc.noted'), href: onglet('prestations') }
    }
    const e = pieceEtat(key)
    if (e === 'sansobjet') return { etat: 'sansobjet', detail: t('parc.notNoted'), href: HAS_BACKEND ? onglet('prestations') : undefined }
    return { etat: e, detail: t('parc.fromDoc'), href: onglet('pieces') }
  }

  const assurance = ligneVoyage('assurance', extra.travel?.assurance)
  const hotel = ligneVoyage('hotel', extra.travel?.hebergement)
  const billet = ligneVoyage('billet', extra.travel?.billet)

  const solde = Math.max(0, kase.amountTotal - kase.amountPaid)
  const rdvPris = rdv.find((r) => r.status === 'prevu' || r.status === 'fait')
  const depose = rdv.some((r) => (r.kind === 'consulat' || r.kind === 'biometrie') && r.status === 'fait') || apres('depot')

  const jalons: Jalon[] = [
    {
      key: 'client', label: t('parc.client'), icon: 'clients', etat: client ? 'fait' : 'afaire',
      detail: client ? `${client.firstName} ${client.lastName}` : undefined,
      href: client ? `/clients/${client.id}` : undefined,
    },
    {
      key: 'passport', label: t('parc.passport'), icon: 'passport',
      etat: !client?.passportNumber ? 'bloque' : 'fait',
      detail: !client?.passportNumber
        ? t('parc.noPassport')
        : client.passportExpiry
          ? t('parc.passportSoon', { date: formatDate(client.passportExpiry) })
          : client.passportNumber,
      href: client && !client.passportNumber ? `/clients/${client.id}` : undefined,
    },
    {
      key: 'destination', label: t('parc.destination'), icon: 'plane',
      etat: visa ? 'fait' : 'afaire', detail: visa ? tt(visa.country) : undefined,
    },
    {
      key: 'visaType', label: t('parc.visaType'), icon: 'documents',
      etat: visa ? 'fait' : 'afaire', detail: visa ? tt(visa.label) : undefined,
    },
    {
      key: 'documents', label: t('parc.documents'), icon: 'documents',
      etat: requis.length === 0 ? 'afaire' : manquants.length === 0 ? 'fait' : 'encours',
      detail: `${requis.length - manquants.length}/${requis.length}`,
      href: onglet('pieces'),
    },
    {
      key: 'missing', label: t('parc.missing'), icon: 'alert',
      etat: manquants.length === 0 ? 'fait' : 'bloque',
      detail: manquants.length === 0
        ? t('parc.allDocs')
        : manquants.length === 1 ? t('parc.missingCount', { n: 1 }) : t('parc.missingCountP', { n: manquants.length }),
      href: manquants.length > 0 ? onglet('pieces') : undefined,
    },
    { key: 'form', label: t('parc.form'), icon: 'documents', etat: pieceEtat('formulaire'), href: piece('formulaire') ? onglet('pieces') : undefined },
    {
      key: 'payment', label: t('parc.payment'), icon: 'payments',
      etat: kase.amountTotal === 0 ? 'sansobjet' : solde === 0 ? 'fait' : kase.amountPaid > 0 ? 'encours' : 'afaire',
      detail: kase.amountTotal === 0
        ? undefined
        : solde === 0
          ? t('parc.paidAll')
          : t('parc.paidPart', { paid: formatMoney(kase.amountPaid), total: formatMoney(kase.amountTotal) }),
      href: kase.amountTotal > 0 ? onglet('paiements') : undefined,
    },
    {
      key: 'translations', label: t('parc.translations'), icon: 'language',
      etat: !extra.trad || extra.trad.total === 0
        ? 'sansobjet'
        : extra.trad.en_retard > 0
          ? 'bloque'
          : extra.trad.toutes_livrees ? 'fait' : 'encours',
      detail: !extra.trad || extra.trad.total === 0
        ? t('parc.noTranslation')
        : extra.trad.en_retard > 0
          ? t('parc.translationsLate', { n: extra.trad.en_retard })
          : extra.trad.toutes_livrees
            ? `${extra.trad.livrees}/${extra.trad.total}`
            : t('parc.translationsLeft', { n: extra.trad.total - extra.trad.livrees }),
      href: HAS_BACKEND ? onglet('prestations') : undefined,
    },
    { key: 'insurance', label: t('parc.insurance'), icon: 'shield', etat: assurance.etat, detail: assurance.detail, href: assurance.href },
    { key: 'hotel', label: t('parc.hotel'), icon: 'building', etat: hotel.etat, detail: hotel.detail, href: hotel.href },
    { key: 'ticket', label: t('parc.ticket'), icon: 'plane', etat: billet.etat, detail: billet.detail, href: billet.href },
    {
      key: 'appointment', label: t('parc.appointment'), icon: 'appointments',
      etat: rdvPris ? 'fait' : attente ? 'encours' : 'afaire',
      detail: rdvPris
        ? t('parc.apptOn', { date: formatDate(rdvPris.at) })
        : attente
          ? t('parc.queued', { date: formatDate(attente.joinedAt) })
          : t('parc.noAppt'),
      href: onglet('rdv'),
    },
    {
      key: 'submission', label: t('parc.submission'), icon: 'upload',
      etat: depose ? 'fait' : a('depot') ? 'encours' : 'afaire',
    },
    {
      key: 'tracking', label: t('parc.tracking'), icon: 'clock',
      etat: apres('consulat') ? 'fait' : a('consulat') ? 'encours' : 'afaire',
    },
    {
      key: 'decision', label: t('parc.decision'), icon: kase.status === 'refuse' ? 'close' : 'check',
      etat: kase.status === 'accepte' || kase.status === 'refuse' ? 'fait' : a('decision') ? 'encours' : 'afaire',
      detail: kase.decisionAt
        ? kase.status === 'accepte'
          ? t('parc.decisionOk', { date: formatDate(kase.decisionAt) })
          : t('parc.decisionKo', { date: formatDate(kase.decisionAt) })
        : undefined,
    },
    {
      key: 'passportBack', label: t('parc.passportBack'), icon: 'passport',
      etat: rendu ? 'fait' : garde ? 'encours' : 'sansobjet',
      detail: rendu
        ? formatDate(rendu.returnedAt)
        : garde ? t('parc.passportHeld', { date: formatDate(garde.receivedAt) }) : undefined,
    },
    // Le recours n'existe que si le dossier a été refusé. L'afficher « à faire »
    // sur un dossier accepté suggérerait qu'il manque quelque chose.
    {
      key: 'appeal', label: t('parc.appeal'), icon: 'alert',
      etat: kase.status !== 'refuse'
        ? 'sansobjet'
        : kase.appealFiledAt ? 'fait' : 'afaire',
      detail: kase.appealFiledAt
        ? t('parc.appealFiled', { date: formatDate(kase.appealFiledAt) })
        : kase.appealDueAt ? t('parc.appealUntil', { date: formatDate(kase.appealDueAt) }) : undefined,
    },
  ]

  const comptes = jalons.filter((j) => j.etat !== 'sansobjet')
  const faits = comptes.filter((j) => j.etat === 'fait').length
  // Deux colonnes remplies de haut en bas : la grille a besoin du nombre de
  // lignes pour couper la liste en son milieu.
  const lignes = Math.ceil(jalons.length / 2)

  return (
    <section className="fd-parc" aria-label={t('parc.title')}>
      <div className="fd-parc__head">
        <h3 className="fd-parc__title">{t('parc.title')}</h3>
        <span className="t-caption t-tertiary">{t('parc.subtitle', { done: faits, total: comptes.length })}</span>
      </div>
      <div className="fd-parc__grid" style={{ '--fd-rows': lignes } as CSSProperties}>
        {jalons.map((j) => (
          <div key={j.key} className={`fd-jalon fd-jalon--${j.etat}`} aria-current={j.etat === 'encours' ? 'step' : undefined}>
            <span className={`parcours__dot parcours__dot--${TON[j.etat]}`}>
              {j.etat === 'fait' && <Icon name="check" size={11} />}
              {j.etat === 'bloque' && <Icon name="alert" size={11} />}
            </span>
            <Icon name={j.icon} size={14} className="fd-jalon__icon" />
            <span className="fd-jalon__label">{j.label}</span>
            <span className="fd-jalon__detail" title={j.detail}>{j.detail ?? ''}</span>
            {j.href ? (
              <Link to={j.href} className="fd-jalon__go" aria-label={`${t('fiche.view')} : ${j.label}`}>
                <Icon name="arrow" size={13} />
              </Link>
            ) : (
              <span className="fd-jalon__go" />
            )}
          </div>
        ))}
      </div>
      <p className="t-caption t-tertiary fd-parc__hint">{t('parc.hint')}</p>
    </section>
  )
}
