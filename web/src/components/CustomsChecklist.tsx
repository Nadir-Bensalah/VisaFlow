import { useCallback, useEffect, useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { Card, Empty, Pill, Select, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { loadChecklistFor, loadPublicStatus, loadPublicStatusOptions, publishStatus } from '@/data/cargo2'
import type { ChecklistResult, PublicStatus, PublicStatusOption } from '@/data/cargo2'

/**
 * La checklist douanière d'une cargaison, et ce qui manque.
 *
 * La liste retenue est la plus spécifique qui corresponde : plus elle remplit
 * de critères (sens, pays, chapitre SH, mode), plus elle est prioritaire. Le
 * serveur choisit, l'écran affiche.
 *
 * En bas, ce que le client verra. C'est la règle la plus importante du module :
 * VisaFlow n'annonce JAMAIS une décision douanière. Pas « votre marchandise
 * sera libérée demain », mais « le dossier est en attente de mainlevée ». Le
 * libellé vient du serveur, il n'est jamais composé ici, et on ne lui ajoute
 * jamais de date.
 */

export function CustomsChecklist({ shipmentId }: { shipmentId: string }) {
  const { db } = useStore()
  const v = useVisible()
  const { t, tt, formatDate } = useI18n()
  const toast = useToast()

  const [result, setResult] = useState<ChecklistResult | null>(null)
  const [status, setStatus] = useState<PublicStatus | null>(null)
  const [options, setOptions] = useState<PublicStatusOption[]>([])
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!HAS_BACKEND) return
    try {
      const [r, s, o] = await Promise.all([
        loadChecklistFor(shipmentId), loadPublicStatus(shipmentId), loadPublicStatusOptions(),
      ])
      setResult(r); setStatus(s); setOptions(o); setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [shipmentId])

  useEffect(() => { void reload() }, [reload])

  const publish = async (code: string) => {
    try {
      await publishStatus(db.agency.id, shipmentId, code)
      toast(t('cg2.saved')); await reload()
    } catch (e) { setError((e as Error).message) }
  }

  if (!HAS_BACKEND) {
    return (
      <Card title={t('cg2.checklist')}>
        <Empty title={t('cg2.offline')} hint={t('cg2.offlineHint')} scene="alerte" />
      </Card>
    )
  }

  return (
    <Card
      title={t('cg2.checklist')}
      action={result?.checklist
        ? <span className="t-caption t-tertiary">
            {t('cg2.specificity', { n: result.checklist.specificite })}
          </span>
        : undefined}
    >
      {error && <p className="t-small t-orange">{t('cg2.loadError', { msg: error })}</p>}

      {!result || !result.checklist ? (
        <Empty title={t('cg2.checklistNone')} hint={t('cg2.checklistNoneHint')} scene="vide" />
      ) : (
        <div className="col gap-4">
          <div className="row-between">
            <span className="t-small t-medium">{result.checklist.name}</span>
            <div className="row gap-2">
              {result.manquantes === 0
                ? <Pill tone="green" dot>{t('cg2.allPresent')}</Pill>
                : <Pill tone={result.manquantes_requises > 0 ? 'red' : 'orange'} dot>
                    {t('cg2.missing', { n: result.manquantes })}
                  </Pill>}
              {result.manquantes_requises > 0 && (
                <span className="t-caption t-red">
                  {t('cg2.missingRequired', { n: result.manquantes_requises })}
                </span>
              )}
            </div>
          </div>

          <div className="col gap-2">
            {result.pieces.map((p) => (
              <div key={p.code} className="row-between" style={{ alignItems: 'flex-start', gap: 'var(--sp-4)' }}>
                <div className="col gap-1 grow" style={{ minWidth: 0 }}>
                  <span className="t-small">
                    <Icon name={p.etat === 'presente' ? 'check' : 'close'} size={13} />
                    {' '}
                    {tt(p.label)}
                  </span>
                  {/* L'aide dit POURQUOI une pièce est facultative. C'est là
                      qu'on refuse d'inventer une obligation réglementaire. */}
                  {p.help && <span className="t-caption t-tertiary">{p.help}</span>}
                </div>
                <div className="col gap-1" style={{ textAlign: 'end', flex: 'none' }}>
                  {p.etat === 'presente'
                    ? <Pill tone="green">{t('cg2.present')}</Pill>
                    : <Pill tone={p.required ? 'red' : 'gray'}>{t('cg2.missingLabel')}</Pill>}
                  <span className="t-caption t-tertiary">
                    {p.required ? t('cg2.required') : t('cg2.optional')}
                  </span>
                  {p.received_at && (
                    <span className="t-caption t-tertiary">{formatDate(p.received_at)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <p className="t-caption t-tertiary">
            <Icon name="alert" size={12} /> {t('cg2.requiredHint')}
          </p>
        </div>
      )}

      {/* ------------- Ce que voit le client ------------- */}
      <hr className="divider" style={{ margin: 'var(--sp-5) 0' }} />

      <div className="col gap-2">
        <span className="t-small t-medium">{t('cg2.publicStatus')}</span>
        {status ? (
          <>
            {/* Le libellé descend du serveur tel quel. On ne l'habille jamais
                d'une date, ni d'un « bientôt ». */}
            <p className="t-small">{tt(status.label)}</p>
            <span className="t-caption t-tertiary">{formatDate(status.as_of)}</span>
          </>
        ) : (
          <span className="t-small t-tertiary">{t('cg2.none')}</span>
        )}

        {v.can('shipment:write') && options.length > 0 && (
          <Select
            value=""
            onChange={(e) => { if (e.target.value) void publish(e.target.value) }}
            aria-label={t('cg2.publicStatus')}
          >
            <option value="">{t('cg2.publicStatus')}</option>
            {options.map((o) => (
              <option key={o.code} value={o.code}>{tt(o.label)}</option>
            ))}
          </Select>
        )}

        <p className="t-caption t-tertiary">{t('cg2.publicStatusHint')}</p>
      </div>
    </Card>
  )
}
