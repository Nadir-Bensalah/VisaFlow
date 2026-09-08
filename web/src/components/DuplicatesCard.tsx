import { useState } from 'react'
import { useI18n } from '@/i18n'
import { Button, Card, Empty, Field, Modal, Pill, Select, Textarea, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import {
  mergeClients, scanDuplicates,
  type DuplicateGroup, type MergeReport,
} from '@/data/integrite'

/* Le motif rendu par le serveur est un mot technique. On le traduit, et on
   retombe sur le mot brut plutôt que sur du vide si un critère s'ajoute un
   jour côté base sans passer par ici. */
const MOTIFS: Record<string, string> = {
  passeport_et_naissance: 'int.cPasseport',
  meme_telephone: 'int.cTelephone',
  nom_arabe_et_naissance: 'int.cNomArabe',
  email: 'int.cEmail',
  cin: 'int.cCin',
  conteneur: 'int.cConteneur',
  connaissement: 'int.cConnaissement',
  identifiant_fiscal: 'int.cFiscal',
}

/**
 * Les doublons de l'agence, et le geste de fusion.
 *
 * Le balayage ne part PAS tout seul à l'ouverture de l'écran : il parcourt
 * toutes les fiches de l'agence, et le déclencher sans qu'on l'ait demandé
 * ralentirait une page que l'agent ouvre cent fois par jour.
 *
 * La fusion demande deux choses avant de partir : laquelle des deux fiches on
 * garde, et pourquoi. La raison n'est pas une politesse : elle reste écrite sur
 * la fiche absorbée, et c'est ce qui permet de comprendre six mois plus tard.
 *
 * Le compte rendu est affiché ligne par ligne, table par table. Une fusion sans
 * compte rendu est irréversible ET invérifiable.
 */
export function DuplicatesCard({ entityKind = 'CLIENT' }: { entityKind?: 'CLIENT' | 'SHIPMENT' | 'COMPANY' }) {
  const { t } = useI18n()
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [merging, setMerging] = useState<DuplicateGroup | null>(null)

  const scan = async () => {
    setBusy(true)
    setError(null)
    try {
      setGroups(await scanDuplicates(entityKind))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Card
        title={t('int.duplicates')}
        action={<Button icon="search" disabled={busy} onClick={scan}>{busy ? t('int.scanning') : t('int.scan')}</Button>}
      >
        <p className="t-small t-secondary" style={{ marginTop: 0 }}>{t('int.duplicatesSub')}</p>

        {error && <p className="t-small t-tertiary">{t('int.loadError', { msg: error })}</p>}

        {groups !== null && groups.length === 0 && (
          <Empty title={t('int.noDuplicates')} hint={t('int.noDuplicatesHint')} scene="vide" />
        )}

        {groups !== null && groups.length > 0 && (
          <div className="col gap-4" style={{ marginTop: 'var(--sp-4)' }}>
            {groups.map((g, i) => (
              <div key={`${g.criterion}-${g.value ?? i}`} className="col gap-2">
                <div className="row gap-2">
                  <Pill tone="orange" dot>{t((MOTIFS[g.criterion] ?? 'int.criterion') as 'int.cEmail')}</Pill>
                  {g.value && <span className="t-caption t-tertiary t-mono">{g.value}</span>}
                </div>
                <div className="list">
                  {g.members.map((m) => (
                    <div key={m.id} className="list__row">
                      <Icon name="clients" size={16} className="t-tertiary" />
                      <span className="col grow" style={{ minWidth: 0 }}>
                        <span className="t-small t-truncate">{m.label}</span>
                        {m.sublabel && <span className="t-caption t-tertiary">{m.sublabel}</span>}
                      </span>
                    </div>
                  ))}
                </div>
                {g.kind === 'CLIENT' && g.members.length >= 2 && (
                  <div className="row">
                    <Button icon="copy" onClick={() => setMerging(g)}>{t('int.merge')}</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {merging && (
        <MergeDialog group={merging} onClose={() => setMerging(null)} onDone={() => { setMerging(null); void scan() }} />
      )}
    </>
  )
}

function MergeDialog({ group, onClose, onDone }: {
  group: DuplicateGroup
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useI18n()
  const toast = useToast()
  const [keep, setKeep] = useState(group.members[0]?.id ?? '')
  const [absorb, setAbsorb] = useState(group.members[1]?.id ?? '')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<MergeReport | null>(null)

  const valid = keep !== '' && absorb !== '' && keep !== absorb && reason.trim() !== ''

  const run = async () => {
    setBusy(true)
    try {
      setReport(await mergeClients(keep, absorb, reason.trim()))
      toast(t('int.mergeDone'))
    } catch (e) {
      toast(t('int.mergeRefused', { msg: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  const lines = report ? Object.entries(report.moved) : []

  return (
    <Modal
      title={t('int.mergeTitle')}
      onClose={report ? onDone : onClose}
      footer={
        report ? (
          <Button variant="primary" onClick={onDone}>{t('int.close')}</Button>
        ) : (
          <>
            <Button onClick={onClose}>{t('int.cancel')}</Button>
            <Button variant="danger" disabled={!valid || busy} onClick={run}>{t('int.mergeConfirm')}</Button>
          </>
        )
      }
    >
      {report ? (
        <div className="col gap-4">
          <p className="t-small t-medium">{t('int.mergeReport')}</p>
          {lines.length === 0 ? (
            <p className="t-small t-tertiary">{t('int.mergeNothing')}</p>
          ) : (
            <div className="list">
              {lines.map(([table, n]) => (
                <div key={table} className="list__row">
                  <span className="t-small t-mono grow">{table}</span>
                  <span className="t-small t-num">{n}</span>
                </div>
              ))}
            </div>
          )}
          <p className="t-caption t-tertiary" style={{ margin: 0 }}>{t('int.mergeTotal', { n: report.total })}</p>
        </div>
      ) : (
        <div className="col gap-4">
          <Field label={t('int.mergeKeep')}>
            <Select value={keep} onChange={(e) => setKeep(e.target.value)}>
              {group.members.map((m) => <option key={m.id} value={m.id}>{m.label}{m.sublabel ? ` · ${m.sublabel}` : ''}</option>)}
            </Select>
          </Field>
          <Field label={t('int.mergeAbsorb')}>
            <Select value={absorb} onChange={(e) => setAbsorb(e.target.value)}>
              {group.members.map((m) => <option key={m.id} value={m.id}>{m.label}{m.sublabel ? ` · ${m.sublabel}` : ''}</option>)}
            </Select>
          </Field>
          <Field label={t('int.mergeReason')} hint={t('int.mergeReasonHint')}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </Field>
          <p className="t-small t-secondary" style={{ margin: 0 }}>
            <Icon name="alert" size={14} /> {t('int.mergeWarning')}
          </p>
        </div>
      )}
    </Modal>
  )
}
