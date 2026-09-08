import { useState } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import type { TKey } from '@/i18n'
import { Card, Empty, Input, Segmented, Tabs } from '@/components/ui'
import { PageHead } from '@/components/bits'
import { Icon } from '@/components/Icon'

import { TariffsSection } from '@/components/TariffsSection'
import { BrandSection } from '@/components/BrandSection'
import { EncaissementSection } from '@/components/EncaissementSection'
import { OfficesSection } from '@/components/OfficesSection'
import { ServicesSection } from '@/components/ServicesSection'
import { PlanCard } from '@/components/PlanCard'
import { TranslatorsSection } from '@/components/TranslatorsSection'
import { NotificationRules } from '@/components/NotificationRules'
import { WebhooksSection } from '@/components/WebhooksSection'
import { SecuritySection } from '@/components/SecuritySection'
import { CustomFieldsAdmin } from '@/components/CustomFieldsAdmin'
import { NumberingSection } from '@/components/NumberingSection'
import { DuplicatesCard } from '@/components/DuplicatesCard'
import { DocumentTemplates } from '@/components/DocumentTemplates'
import { CustomsChecklistsAdmin } from '@/components/CustomsChecklistsAdmin'
import { SlaSection } from '@/components/SlaSection'
import { ComplianceSection } from '@/components/ComplianceSection'

import { AgencyIdentity } from '@/components/settings/AgencyIdentity'
import { VisaCatalogSection } from '@/components/settings/VisaCatalogSection'
import { ConsulatesSection } from '@/components/settings/ConsulatesSection'
import { MessageTemplatesSection } from '@/components/settings/MessageTemplatesSection'
import { WhatsAppSection } from '@/components/settings/WhatsAppSection'
import { DataSection } from '@/components/settings/DataSection'
import { AuditLogSection } from '@/components/settings/AuditLogSection'

/* ====================================================================== */
/* L'écran des réglages, en deux niveaux                                  */
/* ====================================================================== */
/*
 * LE PROBLÈME QU'ON RÉPARE. Quinze onglets sur une seule barre qui défilait.
 * Chaque module livré en rajoutait un. Personne ne retrouvait rien, et le
 * patron de l'agence ne savait même pas ce qu'il avait à régler.
 *
 * LA FORME RETENUE. Cinq familles, puis un second niveau à l'intérieur de
 * chacune. Le premier niveau est une barre de pastilles (Segmented), le second
 * une barre soulignée (Tabs). Deux composants qui existent déjà, deux allures
 * différentes pour deux niveaux différents, et surtout deux barres qui défilent
 * horizontalement sans jamais faire déborder la page : c'est déjà réglé dans
 * leur CSS, donc rien à réinventer sur un téléphone de 375 px.
 *
 * L'ADRESSE NE BOUGE PAS. `?section=` continue de porter la SOUS-SECTION, avec
 * exactement les mêmes valeurs qu'avant. La famille se déduit de la
 * sous-section, elle ne s'écrit pas dans l'URL. Conséquence : les quinze
 * anciens liens ouvrent la bonne famille sur la bonne sous-section, sans table
 * d'alias à maintenir. Une valeur inconnue retombe sur la première sous-section
 * ouverte à la personne, comme avant.
 *
 * LES DROITS NE BOUGENT PAS NON PLUS. Chaque entrée garde la capacité qui la
 * gardait. Une famille dont aucune entrée n'est visible disparaît de la barre.
 */

type Family = 'agence' | 'metier' | 'messages' | 'argent' | 'securite'

interface Entry {
  /** La valeur de `?section=`. Ne jamais renommer : des liens existent. */
  id: string
  family: Family
  label: TKey
  /** Mots que la personne tape et que le libellé ne contient pas. */
  keywords?: TKey
  visible: boolean
  node: ReactNode
}

const FAMILIES: { value: Family; label: TKey; hint: TKey }[] = [
  { value: 'agence', label: 'rg.famAgence', hint: 'rg.famAgenceHint' },
  { value: 'metier', label: 'rg.famMetier', hint: 'rg.famMetierHint' },
  { value: 'messages', label: 'rg.famMessages', hint: 'rg.famMessagesHint' },
  { value: 'argent', label: 'rg.famArgent', hint: 'rg.famArgentHint' },
  { value: 'securite', label: 'rg.famSecurite', hint: 'rg.famSecuriteHint' },
]

/** Minuscules sans accents : « Modèles » se trouve en tapant « modeles ». */
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export function Settings() {
  const v = useVisible()
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')

  // Les droits, une fois, en clair. Ils sont repris tels quels de l'ancienne
  // barre : aucune section ne change de gardien.
  const manage = v.can('settings:manage')
  const catalog = v.can('catalog:manage')
  const automation = v.can('automation:manage')
  const audit = v.can('audit:view')
  const exportData = v.can('data:export')

  const entries: Entry[] = [
    /* ---------------------------- Mon agence --------------------------- */
    { id: 'agence', family: 'agence', label: 'settings.agency', keywords: 'rg.kwAgence', visible: true, node: <AgencyIdentity /> },
    { id: 'plan', family: 'agence', label: 'plan.title', visible: true, node: <PlanCard /> },
    // Les bureaux : le périmètre de chacun. Les créer, c'est décider qui voit quoi.
    { id: 'bureaux', family: 'agence', label: 'settings.offices', visible: manage, node: <OfficesSection /> },
    { id: 'marque', family: 'agence', label: 'brand.title', visible: manage, node: <BrandSection /> },

    /* EMPLACEMENT RÉSERVÉ : l'organisation du travail (portefeuille ou file).
       Le composant `@/components/WorkModeSection` est livré en parallèle. Quand
       le fichier existera, ajouter l'import en haut puis cette ligne ici même,
       juste après « marque » :

       { id: 'travail', family: 'agence', label: 'rg.workMode', visible: manage, node: <WorkModeSection /> },

       Le libellé `rg.workMode` est déjà traduit dans les quatre langues. Rien
       d'autre à toucher : la famille, la recherche et `?section=travail`
       marcheront tout seuls. */

    /* ---------------------------- Mon métier --------------------------- */
    { id: 'visas', family: 'metier', label: 'settings.visaTypes', keywords: 'rg.kwVisas', visible: catalog, node: <VisaCatalogSection /> },
    { id: 'consulats', family: 'metier', label: 'consulates.title', visible: catalog, node: <ConsulatesSection /> },
    { id: 'services', family: 'metier', label: 'com.services', visible: manage, node: <ServicesSection /> },
    { id: 'traducteurs', family: 'metier', label: 'trad.translators', visible: manage, node: <TranslatorsSection /> },
    // Un barème change le montant de toutes les factures à venir : c'est un
    // réglage, pas une saisie d'exploitation.
    { id: 'baremes', family: 'metier', label: 'tariff.title', keywords: 'rg.kwBaremes', visible: manage, node: <TariffsSection /> },
    { id: 'douane', family: 'metier', label: 'cg2.checklists', visible: manage, node: <CustomsChecklistsAdmin /> },
    // Les papiers imprimés : facture, devis, reçu, bon de livraison. En
    // Tunisie, une facture sans matricule fiscal est refusée.
    { id: 'papiers', family: 'metier', label: 'doc2.tplTitle', keywords: 'rg.kwPapiers', visible: manage, node: <DocumentTemplates /> },

    /* --------------------------- Mes messages -------------------------- */
    { id: 'modeles', family: 'messages', label: 'settings.templates', keywords: 'rg.kwModeles', visible: catalog, node: <MessageTemplatesSection /> },
    { id: 'whatsapp', family: 'messages', label: 'wa.title', visible: manage, node: <WhatsAppSection /> },
    // Les alertes décident de ce qui part chez le client : c'est un réglage
    // qui engage de l'argent et l'image de l'agence.
    { id: 'alertes', family: 'messages', label: 'notif.rules.title', visible: automation, node: <NotificationRules /> },
    { id: 'webhooks', family: 'messages', label: 'notif.wh.title', visible: automation, node: <WebhooksSection /> },
    { id: 'sla', family: 'messages', label: 'pil.slaTitle', visible: automation, node: <SlaSection /> },

    /* ----------------------------- L'argent ---------------------------- */
    // Brancher un compte de paiement engage l'argent de l'agence. Les devises
    // acceptées vivent dans le même écran : on ne choisit pas un moyen sans
    // savoir dans quelle monnaie il encaisse.
    { id: 'encaissement', family: 'argent', label: 'pay2.providers', keywords: 'rg.kwEncaissement', visible: manage, node: <EncaissementSection /> },

    /* ----------------------- Sécurité et données ----------------------- */
    // La conformité porte des amendes chiffrées : elle relève des réglages,
    // pas de l'exploitation.
    { id: 'conformite', family: 'securite', label: 'conf.title', keywords: 'rg.kwConformite', visible: manage, node: <ComplianceSection /> },
    // Mes appareils sont visibles par tous ; le fil de sécurité exige le droit
    // d'audit, et le composant s'en charge lui-même.
    { id: 'securite', family: 'securite', label: 'sec.title', keywords: 'rg.kwSecurite', visible: true, node: <SecuritySection /> },
    { id: 'journal', family: 'securite', label: 'settings.audit', keywords: 'rg.kwJournal', visible: audit, node: <AuditLogSection /> },
    { id: 'donnees', family: 'securite', label: 'settings.compliance', keywords: 'rg.kwDonnees', visible: exportData, node: <DataSection /> },
    // Ces trois-là étaient imbriqués dans l'ancien onglet « Données » : visible
    // avec `data:export`, contenu réservé à `settings:manage`. La double
    // condition reproduit exactement l'ancien comportement.
    { id: 'numerotation', family: 'securite', label: 'int.numbering', visible: exportData && manage, node: <NumberingSection /> },
    { id: 'champs', family: 'securite', label: 'int.customAdmin', visible: exportData && manage, node: <CustomFieldsAdmin /> },
    { id: 'doublons', family: 'securite', label: 'int.duplicates', visible: exportData && manage, node: <DuplicatesCard /> },
  ]

  const allowed = entries.filter((e) => e.visible)
  const families = FAMILIES.filter((f) => allowed.some((e) => e.family === f.value))

  // La sous-section vient de l'URL ; la famille s'en déduit.
  const asked = params.get('section')
  const currentEntry = allowed.find((e) => e.id === asked) ?? allowed[0]
  const currentFamily = currentEntry?.family ?? families[0]?.value
  const siblings = allowed.filter((e) => e.family === currentFamily)

  const go = (id: string) => { setQuery(''); setParams({ section: id }, { replace: true }) }
  const goFamily = (family: Family) => {
    const first = allowed.find((e) => e.family === family)
    if (first) go(first.id)
  }

  // La recherche : trente réglages se cherchent, ils ne se parcourent pas.
  // Elle cherche dans le libellé, dans le nom de la famille et dans les mots
  // que le libellé ne dit pas (« devise » pour l'encaissement, par exemple).
  const q = norm(query.trim())
  const found = q === '' ? [] : allowed.filter((e) => {
    const famille = FAMILIES.find((f) => f.value === e.family)
    const haystack = [t(e.label), famille ? t(famille.label) : '', e.keywords ? t(e.keywords) : ''].join(' ')
    return norm(haystack).includes(q)
  })

  if (allowed.length === 0) {
    return (
      <>
        <PageHead title={t('settings.title')} subtitle={t('settings.subtitle')} />
        <Card><Empty title={t('rg.none')} hint={t('rg.noneHint')} /></Card>
      </>
    )
  }

  return (
    <>
      <PageHead title={t('settings.title')} subtitle={t('settings.subtitle')} />

      <div className="col gap-4" style={{ marginBottom: 'var(--sp-6)' }}>
        <div className="row-between wrap gap-3">
          <Segmented
            label={t('settings.title')}
            value={currentFamily as Family}
            onChange={goFamily}
            options={families.map((f) => ({ value: f.value, label: t(f.label) }))}
          />
          <div style={{ flex: '1 1 200px', minWidth: 0, maxWidth: 280 }}>
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('rg.search')}
              aria-label={t('rg.search')}
            />
          </div>
        </div>

        {q === '' && (
          <>
            {/* Un seul onglet ne fait pas une barre : on ne montre pas un choix
                qui n'en est pas un. */}
            {siblings.length > 1 && (
              <Tabs
                idPrefix="rg"
                value={currentEntry.id}
                onChange={go}
                options={siblings.map((e) => ({ value: e.id, label: t(e.label) }))}
              />
            )}
            <p className="t-small t-secondary" style={{ margin: 0 }}>
              {t(FAMILIES.find((f) => f.value === currentFamily)?.hint ?? 'rg.famAgenceHint')}
            </p>
          </>
        )}
      </div>

      {q !== '' ? (
        found.length === 0 ? (
          <Card>
            <Empty title={t('rg.searchNone', { q: query.trim() })} hint={t('rg.searchNoneHint')} />
          </Card>
        ) : (
          <Card title={t('rg.searchCount', { n: found.length })} flush>
            <div className="list">
              {found.map((e) => {
                const famille = FAMILIES.find((f) => f.value === e.family)
                return (
                  <button
                    key={e.id}
                    type="button"
                    className="list__row"
                    onClick={() => go(e.id)}
                    style={{ width: '100%', textAlign: 'start', background: 'transparent', border: 0, cursor: 'pointer', font: 'inherit', color: 'inherit' }}
                  >
                    <Icon name="settings" size={18} className="t-tertiary" />
                    <span className="col grow" style={{ minWidth: 0 }}>
                      <span className="t-small t-medium t-truncate">{t(e.label)}</span>
                      <span className="t-caption t-tertiary t-truncate">
                        {famille ? t('rg.searchIn', { family: t(famille.label) }) : ''}
                      </span>
                    </span>
                    <Icon name="chevronRight" size={16} className="t-tertiary" />
                  </button>
                )
              })}
            </div>
          </Card>
        )
      ) : (
        <div id={`rg-panel-${currentEntry.id}`} role="tabpanel" aria-labelledby={`rg-${currentEntry.id}`}>
          {currentEntry.node}
        </div>
      )}
    </>
  )
}
