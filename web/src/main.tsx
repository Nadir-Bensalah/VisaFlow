import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { I18nProvider } from './i18n'
import { StoreProvider } from './data/store'
import { ClockProvider } from './data/clock'
import { resolveTenantSlug } from './tenant'
import './styles/base.css'
import './styles/ui.css'

const slug = resolveTenantSlug()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <I18nProvider>
        <StoreProvider slug={slug}>
          <ClockProvider>
            <App />
          </ClockProvider>
        </StoreProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>,
)
