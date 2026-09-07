/* Le banc de non-régression de l'interface.
   Il ne juge pas le design : il attrape les deux fautes qui passent le
   typecheck et cassent l'écran quand même, une erreur de rendu dans la console
   et un débordement horizontal. Les deux se voient sur un téléphone, jamais
   sur l'écran du développeur. */

import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE ?? 'http://localhost:4173'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/* Les tailles qui comptent : le plus petit téléphone encore vendu, un
   téléphone courant, et un ordinateur. */
const SIZES = [
  { name: 'téléphone 375', width: 375, height: 812 },
  { name: 'téléphone 414', width: 414, height: 896 },
  { name: 'bureau 1440', width: 1440, height: 900 },
]

const ROUTES = [
  '/', '/tableau-de-bord', '/pipeline', '/demandes', '/dossiers', '/creneaux',
  '/cargaisons', '/clients', '/pieces', '/rendez-vous', '/messages', '/taches',
  '/paiements', '/automatisations', '/rapports', '/reglages',
  '/reglages?section=consulats', '/reglages?section=whatsapp',
  '/agence', '/demande', '/suivi',
]

const problems = []

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

for (const size of SIZES) {
  const page = await browser.newPage()
  await page.setViewport({ width: size.width, height: size.height })

  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))

  // La session : sans elle, tout redirige vers la connexion et le banc ne
  // teste rien du tout.
  await page.goto(`${BASE}/connexion`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => {
    window.localStorage.setItem('visaflow.session.tca', 'u_1')
  })

  for (const route of ROUTES) {
    errors.length = 0
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle0' })
    await new Promise((r) => setTimeout(r, 250))

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement
      const extra = doc.scrollWidth - doc.clientWidth
      if (extra <= 1) return null
      // Quel élément dépasse réellement, pour ne pas chercher à l'aveugle.
      const guilty = [...document.querySelectorAll('*')]
        .map((el) => ({ el, rect: el.getBoundingClientRect() }))
        .filter(({ rect }) => rect.right > doc.clientWidth + 1 && rect.width > 0)
        .sort((a, b) => b.rect.right - a.rect.right)[0]
      return {
        extra,
        tag: guilty ? `${guilty.el.tagName.toLowerCase()}.${guilty.el.className}`.slice(0, 90) : 'inconnu',
      }
    })

    if (overflow) {
      problems.push(`${size.name} · ${route} · déborde de ${overflow.extra}px · ${overflow.tag}`)
    }
    for (const e of errors) {
      // Le bruit de développement de React n'est pas un défaut d'écran.
      if (e.includes('Download the React DevTools')) continue
      problems.push(`${size.name} · ${route} · console : ${e.slice(0, 160)}`)
    }
  }

  await page.close()
}

await browser.close()

if (problems.length === 0) {
  console.log(`Banc d'écran : ${SIZES.length} tailles × ${ROUTES.length} écrans, tout est vert.`)
} else {
  console.log(`Banc d'écran : ${problems.length} problèmes.`)
  for (const p of problems) console.log('  ' + p)
  process.exit(1)
}
