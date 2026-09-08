import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/i18n'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { Button, useToast } from '@/components/ui'
import { exportRows } from '@/lib/export'
import type { Column, ExportFormat } from '@/lib/export'
import { noteExport } from '@/data/documents'

/* Le bouton d'export, montable sur n'importe quelle liste.
 *
 * LE POINT IMPORTANT : il reçoit `rows`, c'est-à-dire les lignes que l'écran
 * AFFICHE DÉJÀ. Ces lignes sont passées par `useVisible()` et par les
 * politiques du serveur. Le bouton ne requête rien de son côté, et c'est ce qui
 * garantit qu'un agent n'exporte que ce qu'il voit.
 *
 * Le jour où quelqu'un lui passera le résultat d'une requête non filtrée, la
 * garantie tombera. D'où ce commentaire, et d'où l'absence de toute lecture ici.
 */

export function ExportButton<T>({ rows, columns, base, scope, sheetName, label, disabled }: {
  /** Les lignes DÉJÀ filtrées par l'écran. Jamais une requête à part. */
  rows: T[]
  columns: Column<T>[]
  /** La racine du nom de fichier : « clients », « dossiers ». */
  base: string
  /** Ce qui sort, pour la trace : « clients », « factures ». */
  scope: string
  sheetName?: string
  label?: string
  disabled?: boolean
}) {
  const { t } = useI18n()
  const { db } = useStore()
  const v = useVisible()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // Le droit se vérifie ici ET côté serveur. Ici pour ne pas proposer un geste
  // qui échouera, côté serveur parce que c'est lui qui décide.
  const allowed = v.can('data:export')

  const run = async (format: ExportFormat) => {
    setOpen(false)
    if (!allowed) { toast(t('doc2.exportNoRight')); return }
    if (rows.length === 0) { toast(t('doc2.exportEmpty')); return }
    const { name } = exportRows(rows, columns, { format, base, sheetName })
    toast(t('doc2.exportDone', { n: rows.length, name }))
    // La trace part APRÈS le fichier : si elle échoue, on le dit, mais on ne
    // retient pas un export déjà légitime.
    const traced = await noteExport(scope, db.agency.id)
    if (!traced) toast(t('doc2.exportUntraced'))
  }

  return (
    <div className="combo" ref={rootRef} style={{ display: 'inline-block' }}>
      <Button
        icon="download"
        disabled={disabled || !allowed}
        title={allowed ? t('doc2.exportScope') : t('doc2.exportNoRight')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {label ?? t('doc2.export')}
      </Button>
      {open && (
        <ul className="combo__list" role="menu" style={{ minWidth: 200 }}>
          <li className="combo__opt" role="menuitem" onMouseDown={(e) => { e.preventDefault(); void run('csv') }}>
            <span className="combo__optLabel">{t('doc2.exportCsv')}</span>
          </li>
          <li className="combo__opt" role="menuitem" onMouseDown={(e) => { e.preventDefault(); void run('xlsx') }}>
            <span className="combo__optLabel">{t('doc2.exportXlsx')}</span>
          </li>
        </ul>
      )}
    </div>
  )
}
