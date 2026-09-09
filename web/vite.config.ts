import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { execSync } from 'node:child_process'

/* La version publiée, gravée dans le build.
   GitHub Pages cache index.html dix minutes : sans repère, on ne sait jamais si
   l'écran qu'on regarde est la dernière version ou celle d'il y a une heure.
   Un numéro affiché dans les réglages tranche la question en une seconde. */
function versionDuBuild(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
    return sha
  } catch {
    // Hors dépôt git (une archive téléchargée, par exemple).
    return 'local'
  }
}

// base : sur GitHub Pages le site vit sous /VisaFlow/.
// En local et sur un domaine propre (agence.visaflow.app) la base reste /.
const base = process.env.VITE_BASE ?? '/'

/* LE JEU DE DÉMONSTRATION NE PART PAS CHEZ LES AGENCES.
   `src/data/seed.ts` fabrique une agence inventée avec ses clients et ses
   dossiers : utile au développement et au banc d'écran, inacceptable dans le
   fichier que télécharge une vraie agence, où ces noms finissaient par
   apparaître. Sauf demande explicite (VITE_DEMO=1), la construction remplace
   ce module par `seed.vide.ts`, qui rend une base vide. */
const avecDemo = process.env.VITE_DEMO === '1'

export default defineConfig({
  base,
  plugins: [react()],
  define: {
    __VF_VERSION__: JSON.stringify(versionDuBuild()),
    __VF_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: [
      ...(avecDemo ? [] : [{
        find: /^@\/data\/seed$/,
        replacement: fileURLToPath(new URL('./src/data/seed.vide.ts', import.meta.url)),
      }]),
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
    ],
  },
  build: { outDir: 'dist', sourcemap: false },
})
