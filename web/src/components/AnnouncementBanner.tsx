import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '@/i18n'
import type { TKey } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { Button } from './ui'
import { Icon, type IconName } from './Icon'
import { loadAnnouncements, markAnnouncementRead } from '@/data/support'
import type { Announcement, AnnouncementKind, AnnouncementSeverity } from '@/data/support'
import type { I18nText } from '@/data/types'

/**
 * Le bandeau d'annonce.
 *
 * Une coupure de maintenance annoncée par courriel n'est jamais lue : l'agence
 * ouvre l'outil, pas sa boîte. Le bandeau se place donc en haut de la coquille,
 * au-dessus de tout, et il ne montre qu'UNE annonce à la fois : la plus grave
 * des non lues. Trois bandeaux empilés ne se lisent plus, ils se contournent.
 *
 * Le tri vient du serveur (non lu en premier, puis le plus grave) : on prend la
 * première ligne, on ne re-trie pas. Refaire le tri ici le ferait diverger le
 * jour où la règle change côté base.
 */

const KIND_LABEL: Record<AnnouncementKind, TKey> = {
  maintenance: 'sup.annMaintenance',
  nouveaute: 'sup.annNouveaute',
  incident: 'sup.annIncident',
  pays: 'sup.annPays',
}

const KIND_ICON: Record<AnnouncementKind, IconName> = {
  maintenance: 'settings',
  nouveaute: 'sparkle',
  incident: 'alert',
  pays: 'plane',
}

/* Trois niveaux, trois couleurs. Le critique est rouge : il n'y a pas de
   niveau au-dessus, donc pas de surenchère possible. */
const SEVERITY_STYLE: Record<AnnouncementSeverity, { bg: string; fg: string }> = {
  info: { bg: 'var(--tint-blue, rgba(0,102,204,.10))', fg: 'var(--blue, #0066CC)' },
  attention: { bg: 'var(--tint-orange, rgba(255,149,0,.12))', fg: 'var(--orange, #C25E00)' },
  critique: { bg: 'var(--tint-red, rgba(255,59,48,.12))', fg: 'var(--red, #C41E1E)' },
}

export function AnnouncementBanner() {
  const { t, tt, formatDate } = useI18n()
  const [rows, setRows] = useState<Announcement[]>([])
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    if (!HAS_BACKEND) return
    try { setRows(await loadAnnouncements()) } catch { setRows([]) }
  }, [])

  useEffect(() => { void reload() }, [reload])

  // Les annonces déjà lues restent lisibles dans l'écran d'aide, pas ici : un
  // bandeau qui ne part jamais devient un décor, et on ne lit plus les décors.
  const current = rows.find((a) => !a.read)
  if (!current) return null

  const style = SEVERITY_STYLE[current.severity]
  // Le corps est facultatif : une annonce peut n'être qu'un titre. Sans le
  // français, `tt` n'aurait pas de repli, on ne lui demande donc rien.
  const body = current.body.fr ? tt(current.body as I18nText) : ''

  const dismiss = async () => {
    setBusy(true)
    try {
      await markAnnouncementRead(current.id)
      setRows((list) => list.map((a) => (a.id === current.id ? { ...a, read: true } : a)))
    } catch {
      // Un accusé de lecture qui ne part pas ne doit pas bloquer l'écran :
      // l'annonce reviendra au prochain chargement, ce n'est pas grave.
      setRows((list) => list.filter((a) => a.id !== current.id))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="status"
      className="row gap-3"
      style={{
        background: style.bg,
        color: style.fg,
        padding: 'var(--sp-3) var(--sp-5)',
        alignItems: 'center',
        borderBottom: '1px solid var(--hairline)',
      }}
    >
      <Icon name={KIND_ICON[current.kind]} size={18} />
      <span className="col grow" style={{ minWidth: 0 }}>
        <span className="row gap-2 wrap">
          <span className="t-small t-medium">{tt(current.title)}</span>
          <span className="t-caption" style={{ opacity: 0.8 }}>{t(KIND_LABEL[current.kind])}</span>
          {current.ends_at && (
            <span className="t-caption" style={{ opacity: 0.8 }}>· {formatDate(current.ends_at)}</span>
          )}
        </span>
        {body && <span className="t-caption" style={{ opacity: 0.9 }}>{body}</span>}
      </span>
      <Button size="sm" disabled={busy} onClick={() => void dismiss()}>{t('sup.annDismiss')}</Button>
    </div>
  )
}
