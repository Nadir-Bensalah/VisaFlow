import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/i18n'
import { Icon } from './Icon'
import { ACCEPT_ATTR, check, humanSize, keyFor, put, remove, url } from '@/data/files'
import type { RejectReason, StoredFile } from '@/data/files'

/* Déposer une pièce.
   Le geste naturel du client est la photo prise avec son téléphone, celui de
   l'employé le glisser-déposer d'un scan. Les deux passent par ici, et le
   contrôle se fait au dépôt : une pièce refusée par le consulat, c'est un
   dossier perdu et trois semaines de retard. */

export interface Attached {
  key: string
  name: string
  size: number
  type: string
}

export function FileDrop({ scope, id, current, onAttach, onDetach, readOnly, compact }: {
  /** Espace de nommage de la clé : « dossier », « cargaison ». */
  scope: string
  id: string
  current?: { key?: string; name?: string; size?: number; type?: string }
  onAttach: (file: Attached) => void
  onDetach?: () => void
  readOnly?: boolean
  compact?: boolean
}) {
  const { t } = useI18n()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<RejectReason | null>(null)
  const [preview, setPreview] = useState<string | undefined>()

  // L'aperçu vit dans une URL d'objet : sans révocation, le blob reste en
  // mémoire tant que l'onglet est ouvert.
  useEffect(() => {
    let revoked: string | undefined
    let alive = true
    if (current?.key && current.type?.startsWith('image/')) {
      url(current.key).then((u) => {
        if (!alive) { if (u) URL.revokeObjectURL(u); return }
        revoked = u
        setPreview(u)
      })
    } else {
      setPreview(undefined)
    }
    return () => {
      alive = false
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [current?.key, current?.type])

  const accept = async (file: File | undefined) => {
    if (!file) return
    const bad = check(file)
    if (bad) { setError(bad); return }
    setError(null)
    setBusy(true)
    try {
      const key = keyFor(scope, id)
      const meta: StoredFile = await put(key, file)
      // Le fichier remplacé n'a plus de raison d'occuper la place.
      if (current?.key) await remove(current.key)
      onAttach({ key: meta.key, name: meta.name, size: meta.size, type: meta.type })
    } catch {
      setError('stockage')
    } finally {
      setBusy(false)
    }
  }

  const download = async () => {
    if (!current?.key) return
    const u = await url(current.key)
    if (!u) return
    const a = document.createElement('a')
    a.href = u
    a.download = current.name ?? 'piece'
    a.click()
    URL.revokeObjectURL(u)
  }

  if (current?.key) {
    return (
      <div className={`filecard ${compact ? 'filecard--compact' : ''}`}>
        {preview
          ? <img className="filecard__thumb" src={preview} alt="" />
          : <span className="filecard__thumb filecard__thumb--doc"><Icon name="documents" size={18} /></span>}
        <span className="col grow" style={{ minWidth: 0 }}>
          <span className="t-small t-medium t-truncate">{current.name}</span>
          <span className="t-caption t-tertiary">{current.size !== undefined ? humanSize(current.size) : ''}</span>
        </span>
        <button type="button" className="filecard__act" onClick={download} aria-label={t('action.export')}>
          <Icon name="download" size={16} />
        </button>
        {!readOnly && onDetach && (
          <button
            type="button"
            className="filecard__act"
            onClick={async () => { await remove(current.key!); onDetach() }}
            aria-label={t('action.delete')}
          >
            <Icon name="trash" size={16} />
          </button>
        )}
      </div>
    )
  }

  if (readOnly) return null

  return (
    <>
      <button
        type="button"
        className={`filedrop ${over ? 'filedrop--over' : ''} ${compact ? 'filedrop--compact' : ''}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void accept(e.dataTransfer.files[0]) }}
        disabled={busy}
      >
        <Icon name="upload" size={compact ? 16 : 20} />
        <span className="col" style={{ alignItems: 'flex-start' }}>
          <span className="t-small t-medium">{busy ? t('file.busy') : t('file.drop')}</span>
          {!compact && <span className="t-caption t-tertiary">{t('file.limits')}</span>}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT_ATTR}
        // Le téléphone ouvre l'appareil photo, l'ordinateur ouvre le disque.
        capture={undefined}
        hidden
        onChange={(e) => { void accept(e.target.files?.[0]); e.target.value = '' }}
      />
      {error && (
        <span className="t-caption" style={{ color: 'var(--red)' }}>
          {t(`file.${error}` as 'file.trop_gros')}
        </span>
      )}
    </>
  )
}
