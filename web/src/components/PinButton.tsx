import { useEffect, useState } from 'react'
import { useI18n } from '@/i18n'
import { IconButton, useToast } from '@/components/ui'
import { listPins, pin as doPin, unpin as doUnpin, type EntityKind } from '@/data/integrite'

/**
 * Épingler une fiche, ou retirer l'épingle.
 *
 * Une épingle est un geste privé : deux personnes du même bureau ne suivent
 * pas les mêmes dossiers, et la politique du serveur ne rend que les épingles
 * de la personne connectée. Il n'y a donc rien à filtrer ici, et surtout
 * aucun compteur « 3 personnes suivent ce dossier » à afficher : il serait
 * toujours faux.
 *
 * L'état bascule tout de suite à l'écran et se remet en place si le serveur
 * refuse. Attendre l'aller-retour sur un geste aussi léger donne l'impression
 * que le bouton ne marche pas.
 */
export function PinButton({ entityKind, entityId }: { entityKind: EntityKind; entityId: string }) {
  const { t } = useI18n()
  const toast = useToast()
  const [pinned, setPinned] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    listPins()
      .then((rows) => {
        if (alive) setPinned(rows.some((p) => p.entityKind === entityKind && p.entityId === entityId))
      })
      .catch(() => { /* sans backend, l'épingle reste éteinte */ })
    return () => { alive = false }
  }, [entityKind, entityId])

  const toggle = async () => {
    if (busy) return
    const next = !pinned
    setPinned(next)
    setBusy(true)
    try {
      if (next) await doPin(entityKind, entityId)
      else await doUnpin(entityKind, entityId)
      toast(next ? t('int.pinned') : t('int.unpinned'))
    } catch (e) {
      setPinned(!next)
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <IconButton
      icon={pinned ? 'star' : 'pin'}
      label={pinned ? t('int.unpin') : t('int.pin')}
      aria-pressed={pinned}
      onClick={toggle}
    />
  )
}
