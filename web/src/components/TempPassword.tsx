import { useState } from 'react'
import { useI18n } from '@/i18n'
import { Button, Modal } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { inviteMessage } from '@/lib/invite'
import type { Locale } from '@/data/types'

/**
 * Le mot de passe provisoire, montré UNE fois.
 *
 * Il n'est écrit nulle part ailleurs : ni en base, ni dans un courriel (le
 * projet n'a pas de serveur d'envoi). C'est à qui invite de le transmettre,
 * par téléphone ou WhatsApp. Fermer cette fenêtre, c'est le perdre ; on le
 * dit avant.
 */
export function TempPassword({ name, email, phone, tempPassword, url, locale, onClose }: {
  name: string; email: string; phone?: string | null; tempPassword: string; url: string; locale: Locale; onClose: () => void
}) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const texte = inviteMessage({ name, email, tempPassword, url, locale })
  const digits = (phone ?? '').replace(/\D/g, '')
  const wa = `https://wa.me/${digits}?text=${encodeURIComponent(texte)}`

  const copier = async () => {
    try { await navigator.clipboard.writeText(texte); setCopied(true) } catch { /* presse-papiers indisponible */ }
  }

  return (
    <Modal
      title={t('equipe.tempTitle')}
      onClose={onClose}
      footer={
        <>
          <a className="btn btn--secondary" href={wa} target="_blank" rel="noreferrer">
            <Icon name="whatsapp" size={16} /> {t('equipe.whatsapp')}
          </a>
          <Button onClick={() => void copier()} icon={copied ? 'check' : 'copy'}>{copied ? t('equipe.copied') : t('equipe.copy')}</Button>
          <Button variant="primary" onClick={onClose}>{t('equipe.done')}</Button>
        </>
      }
    >
      <div className="col gap-4">
        <p className="t-small t-secondary" style={{ margin: 0 }}>{t('equipe.tempHint')}</p>
        <div className="col gap-1">
          <span className="t-caption t-tertiary">{t('login.email')}</span>
          <span className="t-mono t-small">{email}</span>
        </div>
        <div className="col gap-1">
          <span className="t-caption t-tertiary">{t('equipe.provisional')}</span>
          <span className="t-mono" style={{ fontSize: 22, letterSpacing: '0.06em', userSelect: 'all' }}>{tempPassword}</span>
        </div>
        <div className="col gap-1">
          <span className="t-caption t-tertiary">{t('nav.portal')}</span>
          <span className="t-mono t-small">{url}</span>
        </div>
      </div>
    </Modal>
  )
}
