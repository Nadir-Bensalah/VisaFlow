import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/i18n'
import type { TKey } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { Card } from '@/components/ui'
import { Icon } from '@/components/Icon'
import type { IconName } from '@/components/Icon'
import { loadMyWorklist } from '@/data/travail'
import type { Worklist } from '@/data/travail'

/**
 * Ce qui attend mon geste, aujourd'hui.
 *
 * DEUX FAÇONS DE TRAVAILLER, UN SEUL ÉCRAN.
 *
 * Une agence en portefeuille donne ses clients à chaque conseiller : sa question
 * du matin est « où en sont MES dossiers ». Une agence en file spécialise les
 * gestes : une personne vérifie toutes les pièces, une autre encaisse tout. Sa
 * question du matin est « qu'est-ce qui attend MON geste », sur tous les
 * dossiers de son bureau.
 *
 * Le style ne se règle pas ici et ne se règle pas par personne : il vient du
 * poste, et le poste vient de l'écran d'équipe. Deux endroits pour dire la même
 * chose finissent toujours par se contredire.
 *
 * Sans backend, ce bloc ne s'affiche pas du tout : la démonstration garde ses
 * compteurs locaux plus bas, et un bloc vide en tête d'écran ferait croire à
 * une panne.
 */

const ICONE: Record<string, IconName> = {
  pieces: 'documents',
  encaissement: 'payments',
  factures: 'payments',
  creneaux: 'clock',
  passeports: 'passport',
  messages: 'messages',
  traductions: 'language',
  douane: 'shield',
  livraisons: 'box',
  prospects: 'sparkle',
  taches: 'tasks',
}

export function WorklistCard() {
  const { t } = useI18n()
  const [liste, setListe] = useState<Worklist | null>(null)

  useEffect(() => {
    if (!HAS_BACKEND) return
    let vivant = true
    loadMyWorklist()
      .then((r) => { if (vivant) setListe(r) })
      // Un accueil qui affiche une erreur pour un bloc d'appoint fait plus de
      // mal que le bloc absent : le reste de l'écran suffit à travailler.
      .catch(() => { if (vivant) setListe(null) })
    return () => { vivant = false }
  }, [])

  if (!liste || liste.groupes.length === 0) return null

  return (
    <Card
      title={t(liste.titreCleTrv as TKey)}
      action={
        <span className="row gap-2">
          <span className={`worklist__style worklist__style--${liste.style}`}>
            {t(liste.style === 'file' ? 'trv.styleFile' : 'trv.stylePortefeuille')}
          </span>
          <span className="t-caption t-tertiary t-num">{liste.total}</span>
        </span>
      }
      flush
    >
      <div className="worklist">
        {liste.groupes.map((g) => (
          <Link key={g.geste} to={g.url} className={`worklist__item worklist__item--${g.urgence}`}>
            <span className="worklist__icon">
              <Icon name={ICONE[g.geste] ?? 'dots'} size={16} />
            </span>
            <span className="worklist__compte t-num">{g.compte}</span>
            <span className="worklist__label t-small grow">{t(g.cleLibelle as TKey)}</span>
            <Icon name="arrow" size={14} className="t-tertiary" />
          </Link>
        ))}
      </div>
    </Card>
  )
}
