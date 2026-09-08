import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '@/i18n'
import { useVisible } from '@/data/scope'
import { Button, Card, Empty, Field, Pill, Select, Switch, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { Ago } from '@/components/bits'
import {
  trackingIssue, trackingList, trackingRevoke,
  type TrackingKind, type TrackingLink,
} from '@/data/securite'

/**
 * Les liens de suivi d'un dossier ou d'une cargaison.
 *
 * Pourquoi cet écran existe. Le dossier porte déjà UN jeton de portail, unique
 * et permanent. Quand l'agence l'envoie au client, puis au conjoint, puis au
 * partenaire, elle a envoyé le même secret trois fois, et le jour où il
 * circule elle ne peut ni savoir lequel a fuité, ni le retirer sans casser le
 * suivi de tout le monde. Ici, un lien par destinataire, avec sa date de fin,
 * son compteur d'ouvertures et son bouton de révocation.
 *
 * DEUX CHOSES À DIRE HONNÊTEMENT, ET QUI SONT ÉCRITES DANS L'ÉCRAN :
 *
 * 1. Le jeton n'est affiché QU'UNE FOIS, à l'émission. Le serveur n'en garde
 *    que l'empreinte SHA-256, comme pour un mot de passe. On ne peut donc pas
 *    le retrouver : on en émet un nouveau et on révoque l'ancien.
 *
 * 2. Le portail public ne résout pas encore ces jetons. Le lien est émis,
 *    compté et révocable, mais la page de suivi ne s'ouvre pas encore avec :
 *    la fonction de résolution existe côté base et n'est pas ouverte aux
 *    visiteurs sans compte. Tant que ce n'est pas branché, l'écran le dit au
 *    lieu de laisser une agente envoyer un lien mort à son client.
 */
export function TrackingLinks({ kind, entityId }: {
  kind: TrackingKind
  entityId: string
}) {
  const { t, formatDate } = useI18n()
  const v = useVisible()
  const toast = useToast()

  const [liens, setLiens] = useState<TrackingLink[]>([])
  const [chargement, setChargement] = useState(true)
  const [jours, setJours] = useState('30')
  const [otp, setOtp] = useState(false)
  const [emis, setEmis] = useState<string | null>(null)
  const [occupe, setOccupe] = useState(false)

  const peutEmettre = v.can(kind === 'VISA_CASE' ? 'case:write' : 'shipment:write')

  const recharger = useCallback(async () => {
    setLiens(await trackingList(kind, entityId))
    setChargement(false)
  }, [kind, entityId])

  useEffect(() => { void recharger() }, [recharger])

  const emettre = async () => {
    setOccupe(true)
    try {
      const jeton = await trackingIssue(kind, entityId, Number(jours), otp)
      setEmis(urlDuJeton(kind, jeton))
      toast(t('sec.issued'))
      await recharger()
    } catch (e) {
      toast(e instanceof Error ? e.message : t('sec.auditDenied'))
    } finally {
      setOccupe(false)
    }
  }

  const revoquer = async (l: TrackingLink) => {
    setOccupe(true)
    try {
      await trackingRevoke(l.id)
      toast(t('sec.revokeLinkDone'))
      await recharger()
    } finally {
      setOccupe(false)
    }
  }

  const copier = async () => {
    if (!emis) return
    try {
      await navigator.clipboard.writeText(emis)
      toast(t('sec.copied'))
    } catch {
      // Presse-papiers refusé par le navigateur : le lien reste sélectionnable
      // à l'écran, on ne prétend pas l'avoir copié.
    }
  }

  return (
    <Card title={t('sec.links')}>
      <p className="t-caption t-tertiary" style={{ marginBottom: 'var(--sp-4)' }}>{t('sec.linksHint')}</p>

      {/* Le branchement qui manque, dit avant que l'agente n'envoie le lien. */}
      <p className="fret__warn" style={{ margin: '0 0 var(--sp-4)' }}>
        <Icon name="alert" size={16} />
        <span>{t('sec.portalPending')}</span>
      </p>

      {emis && (
        <div className="col gap-2" style={{ marginBottom: 'var(--sp-5)' }}>
          <span className="t-caption t-tertiary">{t('sec.copyOnce')}</span>
          <code
            className="t-caption t-mono"
            style={{ wordBreak: 'break-all', display: 'block', padding: 'var(--sp-3)', background: 'var(--tint-gray)', borderRadius: 'var(--radius-sm, 8px)' }}
          >
            {emis}
          </code>
          <Button icon="copy" onClick={() => void copier()}>{t('sec.copy')}</Button>
        </div>
      )}

      {peutEmettre && (
        <div className="row wrap" style={{ gap: 'var(--sp-3)', alignItems: 'flex-end', marginBottom: 'var(--sp-5)' }}>
          <Field label={t('sec.issueDays', { n: Number(jours) })}>
            <Select value={jours} onChange={(e) => setJours(e.target.value)}>
              <option value="7">7</option>
              <option value="30">30</option>
              <option value="90">90</option>
              <option value="365">365</option>
            </Select>
          </Field>
          <span className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
            <Switch checked={otp} onChange={setOtp} label={t('sec.issueOtp')} />
            <span className="t-small t-secondary">{t('sec.issueOtp')}</span>
          </span>
          <Button variant="primary" icon="plus" disabled={occupe} onClick={() => void emettre()}>
            {t('sec.issue')}
          </Button>
        </div>
      )}

      {chargement ? (
        <p className="t-small t-tertiary">…</p>
      ) : liens.length === 0 ? (
        <Empty title={t('sec.noLinks')} scene="aucune" />
      ) : (
        <div className="list">
          {liens.map((l) => {
            const perime = !!l.expiresAt && new Date(l.expiresAt) < new Date()
            return (
              <div key={l.id} className="list__row">
                <Icon name={l.revokedAt ? 'close' : 'portal'} size={16} className="t-tertiary" />
                <span className="col grow" style={{ minWidth: 0 }}>
                  <span className="t-small">
                    {l.openCount > 0 ? t('sec.opens', { n: l.openCount }) : t('sec.neverOpened')}
                    {l.requiresOtp && <> · {t('sec.otpRequired')}</>}
                  </span>
                  <span className="t-caption t-tertiary">
                    <Ago iso={l.createdAt} />
                    {l.expiresAt && ` · ${t('sec.expires', { date: formatDate(l.expiresAt) })}`}
                  </span>
                </span>
                {l.revokedAt ? (
                  <Pill tone="gray">{t('sec.linkRevoked')}</Pill>
                ) : perime ? (
                  <Pill tone="orange">{t('sec.expired')}</Pill>
                ) : peutEmettre ? (
                  <Button variant="danger" size="sm" disabled={occupe} onClick={() => void revoquer(l)}>
                    {t('sec.revokeLink')}
                  </Button>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

/**
 * L'adresse que prendra le lien. Elle suit les routes déjà en place
 * (`/portail/:token` et `/portail/cargaison/:token`), pour qu'il n'y ait rien
 * à changer ici le jour où le portail saura résoudre ces jetons.
 */
function urlDuJeton(kind: TrackingKind, jeton: string): string {
  const base = `${window.location.origin}${import.meta.env.BASE_URL}`
  return kind === 'SHIPMENT'
    ? `${base}portail/cargaison/${jeton}`
    : `${base}portail/${jeton}`
}
