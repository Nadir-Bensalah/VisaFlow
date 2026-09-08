import { useEffect, useMemo, useState } from 'react'
import { useStore } from '@/data/store'
import { useI18n } from '@/i18n'
import { Button, Card, Empty, Field, Input, Modal, Select, Switch, Textarea, useToast } from '@/components/ui'
import { HAS_BACKEND } from '@/lib/supabase'
import { buildHtml, printHtml } from '@/lib/pdf'
import type { DocLocale, DocumentKind } from '@/lib/pdf'
import {
  DOCUMENT_KINDS, deleteTemplate, listTemplates, saveTemplate,
} from '@/data/documents'
import type { DocumentTemplate, TemplateDraft } from '@/data/documents'

/* Le réglage des modèles de document, pour les Réglages.
 *
 * Ce qui se règle ici n'est pas de la décoration. En Tunisie, une facture sans
 * matricule fiscal est refusée par l'administration et par le client. Le
 * matricule vit sur l'agence, mais les mentions qui l'accompagnent (RC, forme
 * juridique, capital, régime de TVA) changent d'une agence à l'autre : elles se
 * saisissent une fois, ici, et se réimpriment sur chaque document.
 *
 * L'aperçu imprime un document d'exemple avec des chiffres visiblement faux,
 * pour qu'un aperçu enregistré par erreur ne ressemble jamais à une vraie
 * facture.
 */

const LOCALES: DocLocale[] = ['fr', 'en', 'ar', 'zh']
const POSITIONS = ['gauche', 'centre', 'droite', 'aucun'] as const

const EMPTY: TemplateDraft = {
  kind: 'facture', name: '', locale: 'fr',
  headerHtml: null, footerHtml: null, css: null,
  logoPosition: 'gauche', showStamp: false, legalMentions: null, active: true,
}

export function DocumentTemplates() {
  const { db } = useStore()
  const { t } = useI18n()
  const toast = useToast()
  const [list, setList] = useState<DocumentTemplate[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id?: string; draft: TemplateDraft } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => {
    if (!HAS_BACKEND) return
    listTemplates().then(setList).catch((e: Error) => setError(e.message))
  }
  useEffect(load, [])

  const kindLabel = (kind: DocumentKind) =>
    t(`doc2.kind${kind[0].toUpperCase()}${kind.slice(1)}` as 'doc2.kindFacture')

  const save = async () => {
    if (!editing) return
    setBusy(true)
    try {
      await saveTemplate(db.agency.id, editing.draft, editing.id)
      toast(t('doc2.tplSaved'))
      setEditing(null)
      load()
    } catch (e) {
      toast(t('doc2.loadError', { msg: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    try {
      await deleteTemplate(id)
      toast(t('doc2.tplDeleted'))
      setEditing(null)
      load()
    } catch (e) {
      toast(t('doc2.loadError', { msg: (e as Error).message }))
    }
  }

  /** Un document d'exemple, aux chiffres volontairement invraisemblables. */
  const preview = (draft: TemplateDraft) => {
    const html = buildHtml({
      kind: draft.kind,
      entity_kind: 'apercu',
      entity_id: null,
      number: 'APERCU-0000',
      locale: draft.locale,
      generated_at: new Date().toISOString(),
      agency: {
        name: db.agency.name, mark: db.agency.mark, currency: db.agency.currency,
        phone: db.agency.phone, email: db.agency.email,
      },
      office: { name: db.agency.offices[0]?.name ?? '' },
      client: { first_name: 'APERÇU', last_name: 'APERÇU', native_name: 'معاينة', phone: '00 000 000' },
      template: {
        header_html: draft.headerHtml, footer_html: draft.footerHtml, css: draft.css,
        logo_position: draft.logoPosition, show_stamp: draft.showStamp,
        legal_mentions: draft.legalMentions,
      },
      meta: { currency: db.agency.currency, note: '' },
      lines: [
        { line_no: 1, description: 'Ligne d’exemple', quantity: 1, unit_price: 111.11, tax_rate: 19, line_total: 132.22 },
      ],
      totals: { subtotal: 111.11, tax_total: 21.11, discount: 0, total: 132.22, paid: 0, balance: 132.22 },
      extra: {},
      legal: {
        mentions: draft.legalMentions,
        tax_id: db.agency.taxId ?? null,
        missing_tax_id: !db.agency.taxId,
      },
    })
    void printHtml(html)
  }

  const noTaxId = useMemo(() => !db.agency.taxId, [db.agency.taxId])

  if (!HAS_BACKEND) {
    return <Card title={t('doc2.tplTitle')}><Empty title={t('doc2.offline')} hint={t('doc2.offlineHint')} /></Card>
  }

  return (
    <Card
      title={t('doc2.tplTitle')}
      action={<Button icon="plus" onClick={() => setEditing({ draft: { ...EMPTY } })}>{t('doc2.tplAdd')}</Button>}
    >
      <p className="t-small t-tertiary">{t('doc2.tplSub')}</p>
      {/* L'arabe est le point qui a décidé de l'architecture d'impression :
          on le dit ici, parce que c'est ici qu'on choisit la langue. */}
      <p className="t-caption t-tertiary" style={{ marginTop: 6 }}>{t('doc2.tplRtlOk')}</p>
      {noTaxId && (
        <p className="t-small" style={{ color: 'var(--red)', marginTop: 8 }}>{t('doc2.tplNoTaxId')}</p>
      )}
      {error && <p className="t-small" style={{ color: 'var(--red)' }}>{t('doc2.loadError', { msg: error })}</p>}

      {list.length === 0 ? (
        <Empty title={t('doc2.tplNone')} hint={t('doc2.tplNoneHint')} />
      ) : (
        <div className="tablewrap" style={{ marginTop: 12 }}>
          <table className="table">
            <thead>
              <tr>
                <th>{t('doc2.tplName')}</th>
                <th>{t('doc2.tplKind')}</th>
                <th>{t('doc2.tplLocale')}</th>
                <th>{t('doc2.tplActive')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((tpl) => (
                <tr key={tpl.id}>
                  <td>{tpl.name}</td>
                  <td>{kindLabel(tpl.kind)}</td>
                  <td>{tpl.locale}</td>
                  <td>{tpl.active ? '✓' : ''}</td>
                  <td>
                    <Button onClick={() => setEditing({
                      id: tpl.id,
                      draft: {
                        kind: tpl.kind, name: tpl.name, locale: tpl.locale,
                        headerHtml: tpl.headerHtml, footerHtml: tpl.footerHtml, css: tpl.css,
                        logoPosition: tpl.logoPosition, showStamp: tpl.showStamp,
                        legalMentions: tpl.legalMentions, active: tpl.active,
                      },
                    })}>{t('doc2.save')}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal
          title={editing.draft.name || t('doc2.tplAdd')}
          onClose={() => setEditing(null)}
          wide
          footer={
            <>
              {editing.id && (
                <Button variant="danger" onClick={() => void remove(editing.id!)}>{t('doc2.tplDelete')}</Button>
              )}
              <Button onClick={() => preview(editing.draft)}>{t('doc2.tplPreview')}</Button>
              <Button variant="primary" disabled={busy || !editing.draft.name.trim()} onClick={() => void save()}>
                {t('doc2.save')}
              </Button>
            </>
          }
        >
          <div className="col gap-4">
            <div className="grid grid--2">
              <Field label={t('doc2.tplName')}>
                <Input value={editing.draft.name}
                  onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, name: e.target.value } })} />
              </Field>
              <Field label={t('doc2.tplKind')}>
                <Select value={editing.draft.kind}
                  onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, kind: e.target.value as DocumentKind } })}>
                  {DOCUMENT_KINDS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
                </Select>
              </Field>
              <Field label={t('doc2.tplLocale')}>
                <Select value={editing.draft.locale}
                  onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, locale: e.target.value as DocLocale } })}>
                  {LOCALES.map((l) => <option key={l} value={l}>{l}</option>)}
                </Select>
              </Field>
              <Field label={t('doc2.tplLogoPosition')}>
                <Select value={editing.draft.logoPosition}
                  onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, logoPosition: e.target.value as TemplateDraft['logoPosition'] } })}>
                  {POSITIONS.map((p) => (
                    <option key={p} value={p}>{t(`doc2.tplLogo${p[0].toUpperCase()}${p.slice(1)}` as 'doc2.tplLogoGauche')}</option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field label={t('doc2.tplLegal')} hint={t('doc2.tplLegalHint')}>
              <Textarea rows={3} value={editing.draft.legalMentions ?? ''}
                onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, legalMentions: e.target.value || null } })} />
            </Field>

            <Field label={t('doc2.tplHeader')} hint={t('doc2.tplHeaderHint')}>
              <Textarea rows={3} value={editing.draft.headerHtml ?? ''}
                onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, headerHtml: e.target.value || null } })} />
            </Field>

            <Field label={t('doc2.tplFooter')}>
              <Textarea rows={2} value={editing.draft.footerHtml ?? ''}
                onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, footerHtml: e.target.value || null } })} />
            </Field>

            <Field label={t('doc2.tplCss')} hint={t('doc2.tplCssHint')}>
              <Textarea rows={3} value={editing.draft.css ?? ''}
                onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, css: e.target.value || null } })} />
            </Field>

            <div className="row gap-4" style={{ alignItems: 'center' }}>
              <span className="t-small">{t('doc2.tplStamp')}</span>
              <Switch checked={editing.draft.showStamp} label={t('doc2.tplStamp')}
                onChange={(value) => setEditing({ ...editing, draft: { ...editing.draft, showStamp: value } })} />
            </div>
            <div className="row gap-4" style={{ alignItems: 'center' }}>
              <span className="t-small">{t('doc2.tplActive')}</span>
              <Switch checked={editing.draft.active} label={t('doc2.tplActive')}
                onChange={(value) => setEditing({ ...editing, draft: { ...editing.draft, active: value } })} />
            </div>
            <p className="t-caption t-tertiary">{t('doc2.tplActiveHint')}</p>
          </div>
        </Modal>
      )}
    </Card>
  )
}
