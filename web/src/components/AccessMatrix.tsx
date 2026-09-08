import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useI18n } from '@/i18n'
import { Card, Pill, Segmented } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { MATRIX_ROWS, scopeOfRole } from '@/data/equipe'
import type { PermissionMeta, TeamMember } from '@/data/equipe'
import type { Office } from '@/data/types'

/**
 * Le tableau comparatif : les personnes en colonnes, les droits en lignes.
 *
 * C'est la vue qui vaut l'écran. Le patron ne demande pas « quels sont les
 * droits d'Amira », il demande « qui peut encaisser chez moi ». Une fiche par
 * personne ne répond jamais à cette question : il faut ouvrir six fiches et
 * tenir le compte de tête. Une ligne par droit y répond en une seconde.
 *
 * La PREMIÈRE ligne n'est pas un droit, c'est le périmètre. Elle est là parce
 * que c'est la chose que le patron n'arrivait pas à visualiser : un agent ne
 * voit que son bureau, la direction voit toute l'agence. Aucun droit ne dit ça,
 * et pourtant c'est la frontière la plus large du produit.
 */
export function AccessMatrix({ members, permissions, offices, jobName }: {
  members: TeamMember[]
  permissions: PermissionMeta[]
  offices: Pick<Office, 'id' | 'name'>[]
  /** Le poste d'une personne, déjà traduit par la page : « Caissier », ou « Personnalisé ». */
  jobName: (m: TeamMember) => string
}) {
  const { t, tt } = useI18n()
  const [view, setView] = useState<'clefs' | 'tous'>('clefs')

  const byCode = useMemo(() => {
    const m = new Map<string, PermissionMeta>()
    for (const p of permissions) m.set(p.code, p)
    return m
  }, [permissions])

  // Les lignes : soit les douze qui comptent, soit les dix-neuf. On garde
  // l'ordre du catalogue, qui est celui des domaines : les dossiers d'abord,
  // les données en dernier.
  const rows = useMemo(() => {
    const codes = view === 'clefs' ? (MATRIX_ROWS as string[]) : permissions.map((p) => p.code)
    return codes.map((c) => byCode.get(c)).filter((p): p is PermissionMeta => Boolean(p))
  }, [view, permissions, byCode])

  // Les comptes désactivés ne sont pas une colonne : ils n'ont aucun droit, et
  // une colonne vide de plus rendrait le tableau plus large sans rien dire.
  const shown = members.filter((m) => m.active)

  if (shown.length === 0) {
    return (
      <Card title={t('eq.matrixTitle')}>
        <p className="t-small t-tertiary" style={{ margin: 0 }}>{t('eq.matrixEmpty')}</p>
      </Card>
    )
  }

  const officeName = (id: string | null) => offices.find((o) => o.id === id)?.name ?? ''

  return (
    <Card
      title={t('eq.matrixTitle')}
      action={
        <Segmented
          label={t('eq.matrixTitle')}
          value={view}
          onChange={setView}
          options={[
            { value: 'clefs', label: t('eq.matrixShowKey') },
            { value: 'tous', label: t('eq.matrixShowAll') },
          ]}
        />
      }
      flush
    >
      <p className="t-small t-secondary" style={{ padding: 'var(--sp-4) var(--sp-5) 0', margin: 0 }}>
        {t('eq.matrixHint')}
      </p>

      <div className="tablewrap">
        <table className="table">
          <thead>
            <tr>
              <th style={STICKY_HEAD} />
              {shown.map((m) => (
                <th key={m.id} style={{ textAlign: 'center', minWidth: 108 }}>
                  <span className="col gap-1" style={{ alignItems: 'center' }}>
                    <span className="t-small t-medium t-truncate" style={{ maxWidth: 120 }}>{m.name}</span>
                    <span className="t-caption t-tertiary t-truncate" style={{ maxWidth: 120, fontWeight: 'var(--w-body)' }}>
                      {jobName(m)}
                    </span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Le périmètre, en tête, parce que c'est la frontière la plus large. */}
            <tr>
              <th scope="row" style={{ ...STICKY_CELL, textAlign: 'start' }}>
                <span className="row gap-2">
                  <Icon name="building" size={14} className="t-tertiary" />
                  <span className="t-small t-medium">{t('eq.matrixScope')}</span>
                </span>
              </th>
              {shown.map((m) => {
                const scope = scopeOfRole(m.role)
                return (
                  <td key={m.id} style={{ textAlign: 'center' }}>
                    {scope === 'agence' ? (
                      <Pill tone="blue">{t('eq.scopeAgency')}</Pill>
                    ) : (
                      <Pill tone="gray">{officeName(m.officeId) || t('eq.scopeOffice')}</Pill>
                    )}
                  </td>
                )
              })}
            </tr>

            {rows.map((p) => (
              <tr key={p.code}>
                <th scope="row" style={{ ...STICKY_CELL, textAlign: 'start' }}>
                  <span className="row gap-2">
                    {p.sensitive && <Icon name="lock" size={13} className="t-tertiary" />}
                    <span className="t-small" style={{ fontWeight: 'var(--w-body)' }}>{tt(p.label)}</span>
                  </span>
                </th>
                {shown.map((m) => {
                  const has = m.capabilities.includes(p.code)
                  // Un droit ajouté ou retiré à la main ne se lit pas comme un
                  // droit qui vient du poste : on le signale, sinon le patron
                  // croit que le poste fait ça et le reproduit ailleurs.
                  const touched = m.overrides.some((o) => o.permission === p.code)
                  return (
                    <td key={m.id} style={{ textAlign: 'center' }}>
                      {has ? (
                        <span
                          className="row gap-1"
                          style={{ justifyContent: 'center', color: p.sensitive ? 'var(--orange)' : 'var(--green)' }}
                          title={touched ? t('eq.added') : undefined}
                        >
                          <Icon name="check" size={16} />
                          {touched && <span className="t-caption">+</span>}
                        </span>
                      ) : (
                        // Une case vide se lirait « sans objet ». Un point dit
                        // « non », et le point rouge dit « non, parce qu'on le
                        // lui a retiré à la main ».
                        <span
                          className="t-caption"
                          style={{ color: touched ? 'var(--red)' : 'var(--text-tertiary)' }}
                          title={touched ? t('eq.removed') : undefined}
                        >
                          ·
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="t-caption t-tertiary" style={{ padding: '0 var(--sp-5) var(--sp-4)', margin: 0 }}>
        {t('eq.sensitiveHint')}
      </p>
    </Card>
  )
}

/* La première colonne reste visible quand le tableau part à droite : sans ça,
   à la sixième personne, on ne sait plus quelle ligne on regarde. */
const STICKY_CELL: CSSProperties = {
  position: 'sticky',
  insetInlineStart: 0,
  background: 'var(--surface)',
  zIndex: 1,
  minWidth: 190,
}

const STICKY_HEAD: CSSProperties = { ...STICKY_CELL, zIndex: 2 }
