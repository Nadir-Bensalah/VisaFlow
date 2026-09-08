import { useCallback, useEffect, useState } from 'react'
import { HAS_BACKEND } from '@/lib/supabase'
import { useI18n } from '@/i18n'
import type { TKey } from '@/i18n'
import { Button, Card, Empty, useToast } from '@/components/ui'
import { WorkStyleBadge } from '@/components/WorkStyleBadge'
import {
  loadAgencyWorkMode, setAgencyWorkMode,
  MODE_EFFECT, MODE_KEY, MODE_ONELINER,
} from '@/data/travail'
import type { AgencyWorkMode, WorkMode } from '@/data/travail'

/* La façon de travailler de l'agence. Se monte dans les Réglages.
 *
 * CE QUE CET ÉCRAN DOIT FAIRE, ET C'EST TOUT SON INTÉRÊT : montrer la
 * CONSÉQUENCE. Un réglage dont on ne voit pas l'effet ne se règle jamais. Le
 * patron ouvre les réglages, lit « portefeuille / file / les deux », ne sait pas
 * ce que ça change, et referme. On lui montre donc trois choses, dans cet
 * ordre :
 *
 *   1. Ce que veut dire chaque mode, en UNE phrase. Pas trois.
 *   2. La réalité d'aujourd'hui : combien de personnes travaillent dans chaque
 *      style, et qui. C'est ce qui rend le réglage concret : il ne choisit pas
 *      dans le vide, il regarde son agence.
 *   3. Ce que le changement va provoquer, écrit avant de valider, pas après.
 *
 * ET UNE PHRASE QUI COMPTE AUTANT QUE LES TROIS : aucun droit ne bouge. Un
 * patron qui craint de fermer une porte en changeant une mise en page ne
 * touchera à rien. La base tient cette promesse, l'écran la dit.
 *
 * LE STYLE DE CHACUN NE SE RÈGLE PAS ICI, et il n'y a rien à ajouter pour
 * mélanger les deux. Le style vient du poste : un conseiller suit son
 * portefeuille, un vérificateur travaille une file. Trois conseillers plus un
 * vérificateur, c'est déjà un mélange, sans un réglage de plus. C'est pourquoi
 * cette carte renvoie vers l'écran d'équipe au lieu d'offrir une deuxième
 * façon de dire la même chose. */

const MODES: WorkMode[] = ['portefeuille', 'file', 'mixte']

export function WorkModeSection() {
  const { t, tt } = useI18n()
  const toast = useToast()

  const [data, setData] = useState<AgencyWorkMode | null>(null)
  const [choix, setChoix] = useState<WorkMode | null>(null)
  const [loading, setLoading] = useState(HAS_BACKEND)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const charger = useCallback(async () => {
    if (!HAS_BACKEND) { setLoading(false); return }
    setLoading(true)
    try {
      const d = await loadAgencyWorkMode()
      setData(d)
      setChoix(d?.mode ?? null)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void charger() }, [charger])

  async function enregistrer() {
    if (!data || !choix || choix === data.mode) return
    setBusy(true)
    try {
      const d = await setAgencyWorkMode(choix)
      if (d) { setData(d); setChoix(d.mode) }
      toast(t('trv.saved'))
    } catch (e) {
      setChoix(data.mode)
      toast(t('trv.loadError', { msg: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  if (!HAS_BACKEND) {
    return <Card title={t('trv.title')}><Empty title={t('trv.offline')} hint={t('trv.offlineHint')} /></Card>
  }
  if (loading) return <Card title={t('trv.title')}><Empty title="…" /></Card>
  if (error || !data) {
    return <Card title={t('trv.title')}><Empty title={t('trv.loadError', { msg: error ?? '' })} /></Card>
  }

  const canChange = data.canChange
  const enAttente = choix !== null && choix !== data.mode

  return (
    <Card title={t('trv.title')}>
      <p className="t-small t-secondary" style={{ marginBottom: 'var(--sp-4)' }}>{t('trv.subtitle')}</p>

      {/* 1 · Les trois modes, une phrase chacun */}
      <div className="col gap-3">
        {MODES.map((m) => {
          const actif = choix === m
          return (
            <button
              key={m}
              type="button"
              disabled={!canChange}
              aria-pressed={actif}
              onClick={() => setChoix(m)}
              className="card"
              style={{
                textAlign: 'start',
                padding: 'var(--sp-3) var(--sp-4)',
                cursor: canChange ? 'pointer' : 'default',
                borderColor: actif ? 'var(--accent)' : undefined,
                boxShadow: actif ? 'inset 0 0 0 1px var(--accent)' : undefined,
              }}
            >
              <span className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
                <span className="t-medium">{t(MODE_KEY[m] as TKey)}</span>
                {m === data.mode && <span className="t-caption t-tertiary">·&nbsp;{t('trv.todayTitle')}</span>}
              </span>
              <span className="t-small t-secondary" style={{ display: 'block', marginTop: 2 }}>
                {t(MODE_ONELINER[m] as TKey)}
              </span>
            </button>
          )
        })}
      </div>

      {/* 2 · La réalité d'aujourd'hui. Le décompte se fait par POSTE, pas par
             mode : c'est le poste qui décide, et c'est ce qu'il faut lire avant
             de basculer quoi que ce soit. */}
      <div style={{ marginTop: 'var(--sp-5)' }}>
        <h3 className="t-small t-medium">{t('trv.todayTitle')}</h3>
        <p className="t-small t-secondary" style={{ marginTop: 2 }}>
          {t('trv.countPortefeuille', { n: data.portefeuille })}
          {' · '}
          {t('trv.countFile', { n: data.file })}
          {data.sansPoste > 0 && <> {' · '}{t('trv.countNoJob', { n: data.sansPoste })}</>}
        </p>
        {data.sansPoste > 0 && (
          <p className="t-caption t-tertiary" style={{ marginTop: 2 }}>{t('trv.noJobHint')}</p>
        )}

        <ul className="col gap-2" style={{ marginTop: 'var(--sp-3)', listStyle: 'none', padding: 0 }}>
          {data.membres.map((m) => (
            <li key={m.id} className="row" style={{ gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="t-small" style={{ minWidth: 120 }}>{m.name}</span>
              <WorkStyleBadge style={m.style} source={m.source} compact />
              <span className="t-caption t-tertiary">
                {m.poste ? tt(m.posteLabel ?? undefined) || m.poste : t('trv.noJob')}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* 3 · Ce que le changement va provoquer, écrit AVANT de valider. */}
      {enAttente && choix && (
        <div style={{ marginTop: 'var(--sp-5)' }}>
          <h3 className="t-small t-medium">{t('trv.effect')}</h3>
          <p className="t-small t-secondary" style={{ marginTop: 2 }}>{t(MODE_EFFECT[choix] as TKey)}</p>
          <p className="t-caption t-tertiary" style={{ marginTop: 2 }}>{t('trv.effectNone')}</p>
          <p className="t-caption t-tertiary" style={{ marginTop: 2 }}>{t('trv.noRights')}</p>
          <div className="row" style={{ gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
            <Button variant="primary" disabled={busy} onClick={() => void enregistrer()}>
              {t('trv.apply')}
            </Button>
            <Button disabled={busy} onClick={() => setChoix(data.mode)}>{t('trv.cancel')}</Button>
          </div>
        </div>
      )}

      {!canChange && (
        <p className="t-caption t-tertiary" style={{ marginTop: 'var(--sp-4)' }}>{t('trv.readOnly')}</p>
      )}
      {canChange && !enAttente && (
        <p className="t-caption t-tertiary" style={{ marginTop: 'var(--sp-4)' }}>{t('trv.noRights')}</p>
      )}
    </Card>
  )
}
