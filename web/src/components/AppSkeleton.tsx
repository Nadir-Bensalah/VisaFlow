/**
 * Le seul moment où l'utilisateur attend vraiment : le temps que l'agence se
 * charge depuis la base, ou que la session se restaure après un rechargement dur.
 * Un texte nu « Chargement… » donne l'impression que rien ne vient. À la place,
 * on dessine la charpente de l'app avec des blocs qui respirent : l'œil sait déjà
 * où les choses vont apparaître, et l'attente paraît deux fois plus courte.
 */
export function AppSkeleton() {
  return (
    <div className="skel" aria-busy="true" aria-label="Chargement">
      <aside className="skel__side">
        <div className="skel__brand">
          <span className="skel__box skel__logo" />
          <span className="skel__box skel__line" style={{ width: 96 }} />
        </div>
        <div className="skel__nav">
          {Array.from({ length: 8 }).map((_, i) => (
            <span key={i} className="skel__box skel__navrow" style={{ width: `${64 + ((i * 17) % 32)}%` }} />
          ))}
        </div>
      </aside>
      <div className="skel__main">
        <div className="skel__top">
          <span className="skel__box" style={{ height: 34, width: 'min(420px, 40vw)', borderRadius: 10 }} />
          <span className="grow" />
          <span className="skel__box" style={{ height: 34, width: 34, borderRadius: 10 }} />
          <span className="skel__box" style={{ height: 34, width: 96, borderRadius: 10 }} />
        </div>
        <div className="skel__body">
          <span className="skel__box" style={{ height: 18, width: 180 }} />
          <span className="skel__box" style={{ height: 40, width: 320, marginTop: 4 }} />
          <div className="skel__cards">
            {Array.from({ length: 3 }).map((_, i) => (
              <span key={i} className="skel__box skel__card" />
            ))}
          </div>
          <span className="skel__box" style={{ height: 320, borderRadius: 16, marginTop: 8 }} />
        </div>
      </div>
    </div>
  )
}

/**
 * La charpente de la console plateforme, le temps que la session se restaure
 * ou que le serveur dise qui est connecté. Même barre latérale (largeur,
 * fond, bandeau de marque), même zone de contenu que AdminShell : quand la
 * vraie console arrive, rien ne bouge. L'ancienne console montrait le
 * squelette de l'espace agence, avec une barre que la console n'avait pas.
 */
export function AdminSkeleton() {
  return (
    <div className="adm adm--skel" aria-busy="true" aria-label="Chargement de la console">
      <aside className="adm__side">
        <div className="adm-skel__brand">
          <span className="skel__box skel__logo" />
          <span className="col grow" style={{ gap: 6 }}>
            <span className="skel__box skel__line" style={{ width: 120 }} />
            <span className="skel__box skel__line" style={{ width: 84, height: 10 }} />
          </span>
        </div>
        <div className="adm-skel__nav">
          {Array.from({ length: 10 }).map((_, i) => (
            <span key={i} className="skel__box adm-skel__navrow" style={{ width: `${58 + ((i * 17) % 34)}%` }} />
          ))}
        </div>
      </aside>
      <div className="adm__main">
        <div className="adm__page">
          <div className="adm-skel__head">
            <span className="skel__box" style={{ height: 12, width: 96 }} />
            <span className="skel__box" style={{ height: 30, width: 'min(360px, 60%)' }} />
            <span className="skel__box" style={{ height: 14, width: 'min(520px, 80%)' }} />
          </div>
          <div className="adm-skel__kpis">
            {Array.from({ length: 4 }).map((_, i) => (
              <span key={i} className="skel__box adm-skel__kpi" />
            ))}
          </div>
          <span className="skel__box adm-skel__bloc" />
        </div>
      </div>
    </div>
  )
}
