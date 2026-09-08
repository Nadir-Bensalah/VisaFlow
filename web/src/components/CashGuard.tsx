import { useStore } from '@/data/store'
import { useI18n } from '@/i18n'
import { Button, Modal, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { CASH_THRESHOLD, cashCheck } from '@/lib/conformite'
import type { Payment } from '@/data/types'

/**
 * Le garde-fou de l'espèces.
 *
 * Article 83 ter du code des droits et procédures fiscaux : accepter 5 000 DT
 * ou plus en liquide sur une même opération expose l'agence à une amende de
 * 20 % du montant, avec un plancher de 2 000 DT. Un dossier Omra réglé 6 000 DT
 * en billets coûte donc 2 000 DT à l'agence, et personne au comptoir ne le sait.
 *
 * On le dit PENDANT le geste, pas dans un rapport le mois suivant. Et on ne se
 * contente pas d'avertir : on propose la sortie, qui n'est pas de fractionner
 * artificiellement mais de changer de moyen de paiement pour le dépassement.
 * L'agent garde la main : il peut encaisser quand même, en connaissance de cause.
 */
export function CashGuard({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const { db, actions } = useStore()
  const { t, formatMoney } = useI18n()
  const toast = useToast()

  // Le seuil s'apprécie sur l'OPÉRATION : trois versements de 2 000 DT sur le
  // même dossier font 6 000 DT en liquide, et l'amende tombe quand même.
  const already = db.payments
    .filter((p) => p.id !== payment.id && p.caseId === payment.caseId
      && p.method === 'especes' && p.state !== 'rembourse')
    .reduce((s, p) => s + p.amount, 0)
  // Les paiements du modèle sont libellés dans la devise de l'agence.
  const check = cashCheck(already, payment.amount, db.agency.currency)

  const regler = (method: Payment['method']) => {
    actions.markPaymentPaid(payment.id, method)
    toast(t('action.markPaid'))
    onClose()
  }

  if (!check.applies || !check.over) return null

  return (
    <Modal
      title={t('cash.title')}
      onClose={onClose}
      footer={
        <>
          {/* La sortie honnête : le dépassement change de moyen de paiement. */}
          <Button variant="primary" onClick={() => regler('virement')}>{t('cash.byTransfer')}</Button>
          <Button onClick={() => regler('cheque')}>{t('cash.byCheque')}</Button>
          {/* L'agent garde la main, en connaissance de cause. */}
          <Button onClick={() => regler('especes')}>{t('cash.anyway')}</Button>
        </>
      }
    >
      <div className="col gap-4">
        <p className="fret__warn" style={{ margin: 0 }}>
          <Icon name="alert" size={16} />
          <span>
            {t('cash.exposure', {
              total: formatMoney(check.totalCash),
              threshold: formatMoney(CASH_THRESHOLD),
              penalty: formatMoney(check.penalty),
            })}
          </span>
        </p>

        <div className="col gap-2">
          {already > 0 && (
            <div className="row-between">
              <span className="t-small t-secondary">{t('cash.already')}</span>
              <span className="t-small t-num">{formatMoney(already)}</span>
            </div>
          )}
          <div className="row-between">
            <span className="t-small t-secondary">{t('cash.thisOne')}</span>
            <span className="t-small t-num">{formatMoney(payment.amount)}</span>
          </div>
          <hr className="divider" style={{ margin: 0 }} />
          <div className="row-between">
            <span className="t-small t-medium">{t('cash.total')}</span>
            <span className="t-medium t-num t-red">{formatMoney(check.totalCash)}</span>
          </div>
        </div>

        <p className="schengen__note" style={{ margin: 0 }}>
          <Icon name="sparkle" size={14} />
          <span>
            {t('cash.advice', {
              cash: formatMoney(check.cashMax),
              rest: formatMoney(check.transferMin),
            })}
          </span>
        </p>

        <p className="t-caption t-tertiary" style={{ margin: 0 }}>{t('cash.legal')}</p>
      </div>
    </Modal>
  )
}
