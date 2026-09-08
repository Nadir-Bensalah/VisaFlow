import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { Button, Card, Empty, Field, Input, Modal, Pill, Select, Textarea, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { FileDrop } from '@/components/FileDrop'
import {
  cancelTranslation, entrustTranslation, handOverTranslation, loadCasePieces,
  loadCaseTranslations, loadLanguages, loadTranslators, receiveTranslation,
  setNeedsTranslation, translationFileUrl, uploadTranslationFile,
} from '@/data/traduction'
import type {
  CasePiece, CaseTranslationPiece, CaseTranslations, Language, TranslationStatus, Translator,
} from '@/data/traduction'
import type { Tone } from '@/lib/derive'

/**
 * Le bloc « Traductions » du dossier.
 *
 * CE QU'IL FAIT, ET CE QU'IL NE FAIT PAS. Il n'envoie rien à personne. L'agence
 * confie sa traduction comme elle le fait déjà, par téléphone ou par WhatsApp,
 * et vient noter ici à qui, combien de pages, à quel prix et pour quand. Le
 * bouton dit donc « Confier la traduction », jamais « Envoyer » : une agence
 * qui croirait qu'un message est parti attendrait une réponse qui ne viendrait
 * jamais.
 *
 * Le coût du traducteur et la marge ne s'affichent pas ici, même pour la
 * direction : ce bloc est celui de l'agent qui suit le dossier. Les chiffres
 * de rentabilité vivent sur l'écran des traductions.
 */

const STATUS_TONE: Record<TranslationStatus, Tone> = {
  a_commander: 'gray',
  commandee: 'blue',
  en_cours: 'blue',
  livree: 'green',
  remise_client: 'green',
  annulee: 'gray',
}

const STATUS_KEY: Record<TranslationStatus, string> = {
  a_commander: 'trad.statusA_commander',
  commandee: 'trad.statusCommandee',
  en_cours: 'trad.statusEn_cours',
  livree: 'trad.statusLivree',
  remise_client: 'trad.statusRemise_client',
  annulee: 'trad.statusAnnulee',
}

export function TranslationCard({ caseId }: { caseId: string }) {
  const { db } = useStore()
  const v = useVisible()
  const { t, tt, formatDate, formatMoney } = useI18n()
  const toast = useToast()

  const [summary, setSummary] = useState<CaseTranslations | null>(null)
  const [pieces, setPieces] = useState<CasePiece[]>([])
  const [translators, setTranslators] = useState<Translator[]>([])
  const [languages, setLanguages] = useState<Language[]>([])
  const [error, setError] = useState<string | null>(null)
  const [entrusting, setEntrusting] = useState<CasePiece | 'libre' | null>(null)
  const [receiving, setReceiving] = useState<CaseTranslationPiece | null>(null)

  const canWrite = v.can('case:write')

  const reload = useCallback(async () => {
    if (!HAS_BACKEND) return
    try {
      const [s, p, tr, lg] = await Promise.all([
        loadCaseTranslations(caseId), loadCasePieces(caseId), loadTranslators(), loadLanguages(),
      ])
      setSummary(s)
      setPieces(p)
      setTranslators(tr.filter((x) => x.active))
      setLanguages(lg)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [caseId])

  useEffect(() => { void reload() }, [reload])

  // Les pièces qu'on peut encore marquer : celles qui ne sont ni cochées ni
  // déjà confiées.
  const restantes = useMemo(
    () => pieces.filter((p) => !p.needsTranslation && !p.translationOrderId),
    [pieces],
  )

  const langName = useCallback((code: string | null) => {
    if (!code) return ''
    const found = languages.find((l) => l.code === code)
    return found ? found.nameFr : code
  }, [languages])

  if (!HAS_BACKEND) {
    return (
      <Card title={t('trad.cardTitle')}>
        <Empty title={t('trad.offline')} hint={t('trad.offlineHint')} scene="alerte" />
      </Card>
    )
  }

  const openFile = async (path: string | null) => {
    if (!path) return
    const url = await translationFileUrl(path)
    if (url) window.open(url, '_blank', 'noopener')
  }

  const hand = async (orderId: string) => {
    try { await handOverTranslation(orderId); toast(t('trad.handedOver')); await reload() }
    catch (e) { toast((e as Error).message) }
  }

  const drop = async (orderId: string) => {
    try { await cancelTranslation(orderId); toast(t('trad.cancelled')); await reload() }
    catch (e) { toast((e as Error).message) }
  }

  const mark = async (documentId: string, needs: boolean) => {
    try { await setNeedsTranslation(documentId, needs); await reload() }
    catch (e) { toast((e as Error).message) }
  }

  return (
    <>
      <Card
        title={t('trad.cardTitle')}
        action={canWrite
          ? <Button variant="secondary" icon="plus" onClick={() => setEntrusting('libre')}>{t('trad.entrust')}</Button>
          : undefined}
        flush
      >
        <p className="tariff__why">
          <Icon name="shield" size={14} />
          <span>{t('trad.notebook')}</span>
        </p>

        {error && <p className="t-small t-orange" style={{ padding: '0 var(--sp-6)' }}>{error}</p>}

        {summary && summary.total > 0 && (
          <div className="row" style={{ padding: 'var(--sp-4) var(--sp-6)', gap: 'var(--sp-6)', borderBottom: '1px solid var(--hairline)' }}>
            <span className="t-small t-secondary">{t('trad.summaryTotal')} <b className="t-num">{summary.total}</b></span>
            <span className="t-small t-secondary">{t('trad.summaryDelivered')} <b className="t-num">{summary.livrees}</b></span>
            {summary.enRetard > 0 && (
              <span className="t-small" style={{ color: 'var(--red)' }}>
                {t('trad.summaryLate')} <b className="t-num">{summary.enRetard}</b>
              </span>
            )}
            {summary.toutesLivrees && <span className="t-small t-tertiary">{t('trad.allDelivered')}</span>}
          </div>
        )}

        {!summary || summary.pieces.length === 0 ? (
          <Empty title={t('trad.noPieces')} hint={t('trad.noPiecesHint')} scene="vide" />
        ) : (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('trad.piece')}</th>
                  <th>{t('trad.translator')}</th>
                  <th>{t('trad.langPair')}</th>
                  <th>{t('trad.status')}</th>
                  <th>{t('trad.promised')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {summary.pieces.map((p) => (
                  <tr key={p.documentId}>
                    <td>
                      <span className="t-medium">{tt(p.label)}</span>
                      {p.order?.swornRequired && (
                        <span className="t-caption t-tertiary"> · {t('trad.swornRequired')}</span>
                      )}
                    </td>
                    <td className="t-small">{p.order?.translatorName ?? t('trad.none')}</td>
                    <td className="t-small">
                      {p.order?.sourceLang
                        ? `${langName(p.order.sourceLang)} → ${langName(p.order.targetLang)}`
                        : ''}
                    </td>
                    <td>
                      {p.order
                        ? <Pill tone={p.order.late ? 'red' : STATUS_TONE[p.order.status]} dot>
                          {t(STATUS_KEY[p.order.status] as 'trad.statusCommandee')}
                        </Pill>
                        : <Pill tone="gray">{t('trad.statusA_commander')}</Pill>}
                    </td>
                    <td className="t-small">
                      {p.order?.promisedAt ? formatDate(p.order.promisedAt) : ''}
                      {p.order?.soldAmount != null && (
                        <span className="t-caption t-tertiary"> · {formatMoney(p.order.soldAmount, p.order.currency)}</span>
                      )}
                    </td>
                    <td className="num">
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--sp-2)' }}>
                        {p.order?.translatedPath && (
                          <Button size="sm" icon="download" onClick={() => void openFile(p.order!.translatedPath)}>
                            {t('trad.openFile')}
                          </Button>
                        )}
                        {canWrite && !p.order && (
                          <Button size="sm" variant="primary" onClick={() => setEntrusting(
                            pieces.find((x) => x.id === p.documentId) ?? 'libre',
                          )}>
                            {t('trad.entrust')}
                          </Button>
                        )}
                        {canWrite && p.order && ['commandee', 'en_cours', 'a_commander'].includes(p.order.status) && (
                          <>
                            <Button size="sm" variant="primary" onClick={() => setReceiving(p)}>
                              {t('trad.receive')}
                            </Button>
                            <Button size="sm" onClick={() => void drop(p.order!.id)}>{t('trad.cancelOrder')}</Button>
                          </>
                        )}
                        {canWrite && p.order?.status === 'livree' && (
                          <Button size="sm" variant="primary" onClick={() => void hand(p.order!.id)}>
                            {t('trad.handOver')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canWrite && restantes.length > 0 && (
          <div style={{ padding: 'var(--sp-4) var(--sp-6)', borderTop: '1px solid var(--hairline)' }}>
            <p className="t-caption t-tertiary" style={{ marginBottom: 'var(--sp-2)' }}>{t('trad.noPiecesHint')}</p>
            <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
              {restantes.map((p) => (
                <Button key={p.id} size="sm" icon="plus" onClick={() => void mark(p.id, true)}>
                  {tt(p.label)}
                </Button>
              ))}
            </div>
          </div>
        )}
      </Card>

      {entrusting && (
        <EntrustModal
          caseId={caseId}
          piece={entrusting === 'libre' ? null : entrusting}
          pieces={pieces}
          translators={translators}
          languages={languages}
          currency={db.agency.currency}
          onClose={() => setEntrusting(null)}
          onDone={async () => { setEntrusting(null); toast(t('trad.entrusted')); await reload() }}
        />
      )}

      {receiving?.order && (
        <Modal title={t('trad.receive')} onClose={() => setReceiving(null)}>
          <p className="t-small t-secondary" style={{ marginBottom: 'var(--sp-4)' }}>{t('trad.attached')}</p>
          <FileDrop
            scope="traduction"
            id={receiving.order.id}
            onUpload={async (file) => {
              const path = await uploadTranslationFile(db.agency.id, caseId, file)
              await receiveTranslation(receiving.order!.id, path)
              setReceiving(null)
              toast(t('trad.received'))
              await reload()
            }}
          />
        </Modal>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Confier une traduction                                              */
/* ------------------------------------------------------------------ */

function EntrustModal({ caseId, piece, pieces, translators, languages, currency, onClose, onDone }: {
  caseId: string
  piece: CasePiece | null
  pieces: CasePiece[]
  translators: Translator[]
  languages: Language[]
  currency: string
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const { t, tt } = useI18n()
  const toast = useToast()

  const [documentId, setDocumentId] = useState<string>(piece?.id ?? '')
  const [translatorId, setTranslatorId] = useState<string>('')
  const [sourceLang, setSourceLang] = useState('ar')
  const [targetLang, setTargetLang] = useState('fr')
  const [sworn, setSworn] = useState(false)
  const [pages, setPages] = useState('1')
  const [sold, setSold] = useState('')
  const [promised, setPromised] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const chosen = translators.find((x) => x.id === translatorId)

  const submit = async () => {
    if (!translatorId) { toast(t('trad.needTranslator')); return }
    setBusy(true)
    try {
      await entrustTranslation({
        translatorId,
        sourceLang: sourceLang || null,
        targetLang: targetLang || null,
        caseId,
        documentId: documentId || null,
        clientId: null,
        swornRequired: sworn,
        pages: pages ? Number(pages) : null,
        words: null,
        soldAmount: sold ? Number(sold) : null,
        currency: chosen?.rateCurrency ?? currency,
        promisedAt: promised ? new Date(`${promised}T12:00:00`).toISOString() : null,
        sourcePath: null,
        note: note || null,
      })
      await onDone()
    } catch (e) {
      // Le refus du serveur est lisible : traducteur non assermenté, retiré du
      // répertoire, ou d'une autre agence. On le montre tel quel.
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('trad.entrust')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('trad.cancel')}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>{t('trad.save')}</Button>
        </>
      }
    >
      <p className="tariff__why" style={{ marginBottom: 'var(--sp-4)' }}>
        <Icon name="shield" size={14} />
        <span>{t('trad.notebook')}</span>
      </p>

      <div className="col gap-4">
        <Field label={t('trad.choosePiece')}>
          <Select value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
            <option value="">{t('trad.freePiece')}</option>
            {pieces.map((p) => <option key={p.id} value={p.id}>{tt(p.label)}</option>)}
          </Select>
        </Field>

        <Field label={t('trad.translator')}>
          <Select value={translatorId} onChange={(e) => setTranslatorId(e.target.value)}>
            <option value="">{t('trad.chooseTranslator')}</option>
            {translators.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}{x.sworn ? ` · ${t('trad.sworn')}` : ''}
              </option>
            ))}
          </Select>
        </Field>

        <div className="row gap-3">
          <Field label={t('trad.sourceLang')}>
            <Select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)}>
              {languages.map((l) => <option key={l.code} value={l.code}>{l.nameFr}</option>)}
            </Select>
          </Field>
          <Field label={t('trad.targetLang')}>
            <Select value={targetLang} onChange={(e) => setTargetLang(e.target.value)}>
              {languages.map((l) => <option key={l.code} value={l.code}>{l.nameFr}</option>)}
            </Select>
          </Field>
        </div>

        <Field label={t('trad.swornRequired')} hint={t('trad.swornRequiredHint')}>
          <Select value={sworn ? 'oui' : 'non'} onChange={(e) => setSworn(e.target.value === 'oui')}>
            <option value="non">{t('trad.none')}</option>
            <option value="oui">{t('trad.swornRequired')}</option>
          </Select>
        </Field>

        <div className="row gap-3">
          <Field label={t('trad.pages')}>
            <Input type="number" min={0} value={pages} onChange={(e) => setPages(e.target.value)} />
          </Field>
          <Field label={`${t('trad.soldAmount')} (${chosen?.rateCurrency ?? currency})`}>
            <Input type="number" min={0} step="0.01" value={sold} onChange={(e) => setSold(e.target.value)} />
          </Field>
        </div>

        {/* Le coût du traducteur est calculé par le serveur : il ne s'affiche
            pas ici, et l'agent n'a pas besoin de le connaître pour confier. */}
        <p className="t-caption t-tertiary">{t('trad.costFromRate')}</p>

        <Field label={t('trad.promised')} hint={chosen?.leadTimeDays != null ? t('trad.leadTimeHint') : undefined}>
          <Input type="date" value={promised} onChange={(e) => setPromised(e.target.value)} />
        </Field>

        <Field label={t('trad.note')}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
