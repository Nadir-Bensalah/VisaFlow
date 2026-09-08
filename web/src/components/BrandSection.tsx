import { useRef, useState } from 'react'
import { useStore } from '@/data/store'
import { useI18n } from '@/i18n'
import { HAS_BACKEND, supabase } from '@/lib/supabase'
import { Button, Card, Field, Input, useToast } from '@/components/ui'
import {
  DEFAULT_ACCENT, DEFAULT_SIDEBAR, brandTheme, contrastRatio,
} from '@/lib/marque'

/**
 * La marque de l'agence : son logo, son titre, ses couleurs.
 *
 * L'agence choisit une couleur de barre et une couleur d'accent. Elle ne choisit
 * PAS la couleur de son texte, ni celle des séparateurs, ni celle de l'élément
 * actif : tout cela se calcule à partir de son choix. Sans ça, la première
 * agence qui prend un bleu marine se retrouve avec du texte noir illisible, et
 * conclut que l'outil est cassé.
 *
 * L'aperçu montre le résultat pendant qu'on choisit, et le rapport de contraste
 * est affiché : c'est une mesure, pas une opinion.
 */

const PALETTE = [
  '#FFFFFF', '#0B2545', '#13293D', '#1D3557',
  '#2A9D8F', '#264653', '#6D597A', '#8B1E3F',
]

export function BrandSection() {
  const { db, actions } = useStore()
  const { t } = useI18n()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const a = db.agency
  const [draft, setDraft] = useState({
    displayName: a.displayName ?? '',
    sidebarColor: a.sidebarColor ?? DEFAULT_SIDEBAR,
    accentColor: a.accentColor ?? a.accent ?? DEFAULT_ACCENT,
  })
  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) =>
    setDraft((d) => ({ ...d, [k]: v }))

  const theme = brandTheme(draft.sidebarColor, draft.accentColor)
  const ratio = contrastRatio(theme.sidebar, theme.sidebarText)
  const titre = draft.displayName || a.name

  const save = () => {
    actions.updateAgency({
      displayName: draft.displayName || undefined,
      sidebarColor: draft.sidebarColor,
      accentColor: draft.accentColor,
    })
    toast(t('crud.updated'))
  }

  /**
   * Le logo part dans un seau public : il s'affiche sur la page publique de
   * l'agence et dans le suivi client, où personne n'est connecté. Le chemin est
   * imposé (le dossier de l'agence), le navigateur ne le choisit pas.
   */
  const upload = async (file: File) => {
    if (!HAS_BACKEND || !supabase) {
      // En démonstration, on garde le logo dans le navigateur : il n'y a pas de
      // seau où l'envoyer, et l'aperçu doit quand même fonctionner.
      const reader = new FileReader()
      reader.onload = () => {
        actions.updateAgency({ logoUrl: String(reader.result) })
        toast(t('brand.logoSaved'))
      }
      reader.readAsDataURL(file)
      return
    }
    setBusy(true)
    try {
      const ext = (file.name.split('.').pop() ?? 'png').toLowerCase()
      const path = `${a.id}/logo.${ext}`
      const { error } = await supabase.storage.from('marques').upload(path, file, { upsert: true })
      if (error) throw new Error(error.message)
      const { data } = supabase.storage.from('marques').getPublicUrl(path)
      actions.updateAgency({ logoPath: path, logoUrl: `${data.publicUrl}?v=${Date.now()}` })
      toast(t('brand.logoSaved'))
    } catch (e) {
      toast(e instanceof Error ? e.message : t('sync.ecriture'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      title={t('brand.title')}
      action={<Button variant="primary" onClick={save}>{t('action.save')}</Button>}
    >
      <div className="col gap-5">
        <div className="grid grid--2">
          <Field label={t('brand.displayName')} hint={t('brand.displayNameHint')}>
            <Input
              value={draft.displayName}
              onChange={(e) => set('displayName', e.target.value)}
              placeholder={a.name}
            />
          </Field>

          <Field label={t('brand.logo')} hint={t('brand.logoHint')}>
            <div className="row gap-2" style={{ alignItems: 'center' }}>
              {a.logoUrl && <img src={a.logoUrl} alt="" className="sidebar__logo" />}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f) }}
              />
              <Button icon="upload" disabled={busy} onClick={() => fileRef.current?.click()}>
                {a.logoUrl ? t('brand.logoChange') : t('brand.logoAdd')}
              </Button>
            </div>
          </Field>
        </div>

        <div className="col gap-3">
          <span className="t-caption t-tertiary">{t('brand.sidebarColor')}</span>
          <div className="row gap-2" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                className="brand__swatch"
                style={{ background: c, outline: draft.sidebarColor === c ? '2px solid var(--blue)' : undefined, outlineOffset: 2 }}
                aria-label={c}
                onClick={() => set('sidebarColor', c)}
              />
            ))}
            <Input
              value={draft.sidebarColor}
              onChange={(e) => set('sidebarColor', e.target.value)}
              style={{ width: 120 }}
              aria-label={t('brand.sidebarColor')}
            />
          </div>
        </div>

        <div className="col gap-3">
          <span className="t-caption t-tertiary">{t('brand.accentColor')}</span>
          <div className="row gap-2" style={{ alignItems: 'center' }}>
            <input
              type="color"
              className="brand__swatch"
              value={/^#[0-9a-fA-F]{6}$/.test(draft.accentColor) ? draft.accentColor : DEFAULT_ACCENT}
              onChange={(e) => set('accentColor', e.target.value)}
              aria-label={t('brand.accentColor')}
            />
            <Input
              value={draft.accentColor}
              onChange={(e) => set('accentColor', e.target.value)}
              style={{ width: 120 }}
            />
          </div>
        </div>

        {/* L'aperçu : on voit ce qu'on choisit, avant de l'imposer à toute l'équipe. */}
        <div className="col gap-2">
          <span className="t-caption t-tertiary">{t('brand.preview')}</span>
          <div className="brand__preview">
            <div className="brand__previewSide" style={{ background: theme.sidebar }}>
              <div className="row gap-2" style={{ alignItems: 'center', marginBottom: 6 }}>
                {a.logoUrl
                  ? <img src={a.logoUrl} alt="" style={{ height: 22, maxWidth: 80, objectFit: 'contain' }} />
                  : <span className="brand__previewMark" style={{ background: theme.accent, color: theme.accentText }}>{a.mark}</span>}
                <span style={{ color: theme.sidebarText, fontSize: 12, fontWeight: 600 }}>{titre}</span>
              </div>
              <span className="brand__previewRow" style={{ background: theme.sidebarActive, color: theme.sidebarText }}>
                {t('today.title')}
              </span>
              <span className="brand__previewRow" style={{ color: theme.sidebarMuted }}>{t('cases.title')}</span>
              <span className="brand__previewRow" style={{ color: theme.sidebarMuted }}>{t('clients.title')}</span>
            </div>
            <div className="brand__previewBody">
              <span className="t-small t-medium">{t('portal.hello', { name: '…' })}</span>
              <div style={{ marginTop: 10 }}>
                <span
                  className="brand__previewRow"
                  style={{ background: theme.accent, color: theme.accentText, display: 'inline-flex', padding: '0 12px' }}
                >
                  {t('action.confirm')}
                </span>
              </div>
            </div>
          </div>

          {/* Le contraste est une mesure, pas une opinion. */}
          <p className={`t-caption ${ratio >= 4.5 ? 't-tertiary' : 't-orange'}`} style={{ margin: 0 }}>
            {ratio >= 4.5
              ? t('brand.contrastOk', { n: ratio.toFixed(1) })
              : t('brand.contrastLow', { n: ratio.toFixed(1) })}
          </p>
        </div>
      </div>
    </Card>
  )
}
