import { useState } from 'react'
import { useI18n } from '@/i18n'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { Button, useToast } from '@/components/ui'
import { HAS_BACKEND } from '@/lib/supabase'
import { buildHtml, printHtml, sha256Hex } from '@/lib/pdf'
import type { DocumentKind } from '@/lib/pdf'
import { fetchPayload, traceDocument } from '@/data/documents'

/* Le bouton d'impression, montable sur n'importe quel écran.
 *
 * Il fait quatre choses, dans cet ordre, et une seule requête :
 *   1. il demande au serveur tout ce que le document doit imprimer ;
 *   2. il compose la page dans la langue du CLIENT, pas celle de l'employé ;
 *   3. il la remet au moteur d'impression du navigateur, qui sait écrire
 *      l'arabe de droite à gauche là où aucune bibliothèque PDF ne le sait ;
 *   4. il pose la trace, avec l'empreinte de ce qui a été composé.
 *
 * Si la personne ne voit pas le dossier, l'étape 1 échoue et rien ne s'imprime.
 * C'est voulu : l'impression ne doit pas être la porte dérobée du périmètre.
 */

export function PrintButton({ kind, entityId, label, variant = 'secondary', block }: {
  kind: DocumentKind
  /** Null pour le rapport d'agence, qui n'a pas d'objet. */
  entityId: string | null
  label?: string
  variant?: 'primary' | 'secondary' | 'ghost'
  block?: boolean
}) {
  const { t } = useI18n()
  const { db } = useStore()
  const v = useVisible()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (!HAS_BACKEND) { toast(t('doc2.printNoBackend')); return }
    setBusy(true)
    try {
      const payload = await fetchPayload(kind, entityId)
      const html = buildHtml(payload)
      const fingerprint = await sha256Hex(html)
      await printHtml(html)
      toast(t('doc2.printHint'))
      const traced = await traceDocument({
        kind,
        entityKind: payload.entity_kind,
        entityId,
        number: payload.number,
        locale: payload.locale,
        sha256: fingerprint,
        officeId: v.officeId ?? db.agency.offices[0]?.id ?? null,
      })
      // Une impression non tracée n'est pas un détail : c'est ce qui rend une
      // facture réimprimée invisible. On le dit, on ne l'avale pas.
      if (!traced) toast(t('doc2.traceFailed'))
    } catch (error) {
      toast(t('doc2.printFailed', { msg: (error as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button icon="documents" variant={variant} block={block} disabled={busy} onClick={() => void run()}>
      {busy ? t('doc2.printing') : (label ?? t('doc2.printPdf'))}
    </Button>
  )
}
