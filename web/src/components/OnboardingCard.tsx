import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/i18n'
import type { TKey } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { Button, Card, Progress, useToast } from './ui'
import { Icon, type IconName } from './Icon'
import {
  completeStep, hideOnboarding, loadOnboarding, skipStep,
} from '@/data/support'
import type { OnboardingState, OnboardingStepKey } from '@/data/support'

/**
 * Le premier soir.
 *
 * Une agence qui s'inscrit ouvre l'outil une fois, après la fermeture. Si elle
 * ne sait pas quoi faire dans les dix minutes, elle ne le rouvre pas.
 *
 * Ce que cette carte fait de nouveau par rapport à l'accueil précédent : elle
 * NE DEMANDE RIEN QUI SOIT DÉJÀ FAIT. Le serveur regarde les bureaux, l'équipe,
 * le catalogue, les clients et les dossiers, et rend l'étape en cours. Une
 * agence qui a créé trois clients ne voit pas « créer un premier client ».
 *
 * Rien n'est calculé ici : ni le pourcentage, ni l'étape suivante. Un calcul
 * refait dans le navigateur finit par contredire celui de la base, et c'est
 * celui de la base qui décide de ce que l'agence peut faire.
 */

const META: Record<OnboardingStepKey, { label: TKey; hint: TKey; icon: IconName; to: string }> = {
  profil:          { label: 'sup.stepProfil',         hint: 'sup.stepProfilHint',         icon: 'building',  to: '/reglages?section=agence' },
  bureau:          { label: 'sup.stepBureau',          hint: 'sup.stepBureauHint',         icon: 'pin',       to: '/reglages?section=bureaux' },
  equipe:          { label: 'sup.stepEquipe',          hint: 'sup.stepEquipeHint',         icon: 'clients',   to: '/reglages?section=equipe' },
  services:        { label: 'sup.stepServices',        hint: 'sup.stepServicesHint',       icon: 'documents', to: '/reglages?section=visas' },
  prix:            { label: 'sup.stepPrix',            hint: 'sup.stepPrixHint',           icon: 'payments',  to: '/reglages?section=visas' },
  marque:          { label: 'sup.stepMarque',          hint: 'sup.stepMarqueHint',         icon: 'sparkle',   to: '/reglages?section=marque' },
  premier_client:  { label: 'sup.stepPremierClient',   hint: 'sup.stepPremierClientHint',  icon: 'clients',   to: '/clients' },
  premier_dossier: { label: 'sup.stepPremierDossier',  hint: 'sup.stepPremierDossierHint', icon: 'cases',     to: '/dossiers' },
}

export function OnboardingCard() {
  const { t } = useI18n()
  const toast = useToast()
  const [state, setState] = useState<OnboardingState | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    if (!HAS_BACKEND) return
    try {
      setState(await loadOnboarding())
    } catch {
      // Un accueil qui ne charge pas ne doit rien afficher, surtout pas une
      // erreur : ce n'est pas la première chose à montrer le premier soir.
      setState(null)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  if (!state || state.hidden || state.complete) return null

  const act = async (job: () => Promise<OnboardingState>) => {
    setBusy(true)
    try { setState(await job()) } catch (e) { toast((e as Error).message) } finally { setBusy(false) }
  }

  const hide = async () => {
    setBusy(true)
    try {
      await hideOnboarding(true)
      setState({ ...state, hidden: true })
      toast(t('sup.startHidden'))
    } catch (e) { toast((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Card
      title={t('sup.startTitle')}
      action={
        <span className="row gap-3">
          <span className="t-caption t-tertiary t-num">
            {t('sup.startProgress', { done: state.done, total: state.total })}
          </span>
          <Button size="sm" disabled={busy} onClick={() => void hide()}>{t('sup.startHide')}</Button>
        </span>
      }
    >
      <div className="col gap-4">
        <p className="t-small t-secondary">{t('sup.startSub')}</p>

        <Progress
          pct={state.percent}
          label={t('sup.startTitle')}
          valueText={`${state.done}/${state.total}`}
          tone={state.percent === 100 ? 'green' : state.percent < 40 ? 'orange' : undefined}
        />

        <div className="col gap-2">
          {state.steps.map((step) => {
            const meta = META[step.step]
            const settled = step.done || step.skipped
            const isCurrent = state.current === step.step
            return (
              <div
                key={step.step}
                className="row gap-3"
                style={{ padding: 'var(--sp-2) 0', opacity: step.skipped && !step.done ? 0.55 : 1 }}
              >
                <span
                  className="today__check"
                  style={{
                    borderColor: step.done ? 'var(--green)' : undefined,
                    background: step.done ? 'var(--green)' : 'transparent',
                    color: step.done ? 'var(--text-white)' : 'transparent',
                  }}
                >
                  <Icon name="check" size={12} />
                </span>

                <span className="col grow" style={{ minWidth: 0 }}>
                  <span className={step.done ? 't-small t-tertiary' : 't-small t-medium'}>
                    {t(meta.label)}
                  </span>
                  <span className="t-caption t-tertiary">
                    {/* « Déjà fait » dit d'où vient la coche : la donnée, pas un
                        clic. Sans ça, l'agence croit qu'on a coché à sa place. */}
                    {step.done && step.auto ? t('sup.stepAuto')
                      : step.skipped ? t('sup.stepSkipped')
                        : t(meta.hint)}
                  </span>
                </span>

                {!settled && (
                  <>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => void act(() => skipStep(step.step))}
                    >
                      {t('sup.stepSkip')}
                    </Button>
                    <Link
                      to={meta.to}
                      className={isCurrent ? 'btn btn--primary btn--sm' : 'btn btn--secondary btn--sm'}
                    >
                      <Icon name={meta.icon} size={16} />
                      {t('sup.stepOpen')}
                    </Link>
                  </>
                )}

                {/* Une étape passée se rattrape : le refus n'est pas définitif. */}
                {step.skipped && !step.done && (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void act(() => completeStep(step.step))}
                  >
                    {t('sup.stepMark')}
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}
