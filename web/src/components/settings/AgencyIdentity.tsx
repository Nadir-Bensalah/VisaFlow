import { useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n, LOCALES, LOCALE_META } from '@/i18n'
import { Card, Field, Input, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { versionLabel } from '@/lib/version'
import { tenantUrl } from '@/tenant'

/* La fiche de l'agence : son nom, son adresse publique, sa formule, ses
   bureaux en lecture, et les langues de l'interface.

   Ce bloc vivait dans Settings.tsx. Il en sort parce qu'un fichier d'écran de
   900 lignes est précisément ce que le patron du produit reprochait : on ne
   retrouve plus rien. */
export function AgencyIdentity() {
  const { db, actions } = useStore()
  const v = useVisible()
  const { t, locale, setLocale } = useI18n()
  const toast = useToast()
  const [name, setName] = useState(db.agency.name)
  const editable = v.can('settings:manage')

  return (
    <>
      <div className="grid grid--2">
        <Card title={t('settings.agency')}>
          <div className="col gap-4">
            <Field label={t('settings.agency')}>
              <Input
                value={name}
                readOnly={!editable}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => { if (editable && name !== db.agency.name) { actions.updateAgency({ name }); toast(t('crud.updated')) } }}
              />
            </Field>
            <Field label={t('settings.domain')} hint={t('settings.domainHint')}>
              <Input value={tenantUrl(db.agency.slug)} readOnly />
            </Field>
            <Field label={t('settings.plan')}><Input value={db.agency.plan} readOnly /></Field>
            <div className="row-between">
              <span className="t-small t-secondary">{t('settings.brand')}</span>
              <span className="row gap-2">
                <span className="sidebar__mark" style={{ background: db.agency.accent }}>{db.agency.mark}</span>
                <Input
                  type="color"
                  value={db.agency.accent}
                  disabled={!editable}
                  onChange={(e) => actions.updateAgency({ accent: e.target.value })}
                  style={{ width: 52, padding: 2 }}
                  aria-label={t('settings.brand')}
                />
              </span>
            </div>
          </div>
        </Card>

        <Card title={t('settings.offices')} flush>
          <div className="list">
            {db.agency.offices.map((o) => (
              <div key={o.id} className="list__row">
                <Icon name="building" size={18} className="t-tertiary" />
                <span className="col grow" style={{ minWidth: 0 }}>
                  <span className="t-small t-medium">{o.name}, {o.country}</span>
                  <span className="t-caption t-tertiary t-truncate">{o.address}</span>
                </span>
                <span className="t-caption t-mono t-tertiary">{o.phone}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title={t('settings.languages')}>
          <p className="t-small t-secondary" style={{ marginBottom: 'var(--sp-4)' }}>{t('msg.languageAuto')}</p>
          <div className="row gap-2 wrap">
            {LOCALES.map((l) => (
              <button key={l} type="button" className="chip" aria-pressed={locale === l} onClick={() => setLocale(l)}>
                {LOCALE_META[l].native}
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* La version publiée. GitHub Pages garde la page dix minutes en cache :
          sans repère, on ne sait jamais si l'écran qu'on regarde est le dernier.
          Ce numéro tranche la question en une seconde. */}
      <p className="t-caption t-tertiary" style={{ textAlign: 'center', marginTop: 'var(--sp-6)' }}>
        {t('settings.version', { v: versionLabel(locale) })}
      </p>
    </>
  )
}
