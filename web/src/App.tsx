import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell'
import { Card, Empty, ToastProvider } from './components/ui'
import { useStore } from './data/store'
import { useVisible } from './data/scope'
import { useI18n } from './i18n'
import type { Capability } from './lib/permissions'
import { Today } from './pages/Today'
import { Dashboard } from './pages/Dashboard'
import { Pipeline } from './pages/Pipeline'
import { Cases } from './pages/Cases'
import { CaseDetail } from './pages/CaseDetail'
import { Shipments } from './pages/Shipments'
import { ShipmentDetail } from './pages/ShipmentDetail'
import { Clients } from './pages/Clients'
import { ClientDetail } from './pages/ClientDetail'
import { Documents } from './pages/Documents'
import { Appointments } from './pages/Appointments'
import { Messages } from './pages/Messages'
import { Payments } from './pages/Payments'
import { Tasks } from './pages/Tasks'
import { Automations } from './pages/Automations'
import { Reports } from './pages/Reports'
import { Settings } from './pages/Settings'
import { Login } from './pages/Login'
import { AgencyHome } from './pages/public/AgencyHome'
import { AskForm } from './pages/public/AskForm'
import { FindMine } from './pages/public/FindMine'
import { Signup } from './pages/public/Signup'
import { PortalRequest } from './pages/portal/PortalRequest'
import { Inbox } from './pages/Inbox'
import { PortalCase } from './pages/portal/PortalCase'
import { PortalShipment } from './pages/portal/PortalShipment'
import { NotFound } from './pages/NotFound'

/** Personne n'entre dans l'espace agence sans session. */
function RequireSession({ children }: { children: ReactNode }) {
  const { signedIn } = useStore()
  if (!signedIn) return <Navigate to="/connexion" replace />
  return <>{children}</>
}

/** Le rôle décide de l'écran, pas seulement de ce qu'on affiche dedans. */
function Require({ capability, children }: { capability: Capability; children: ReactNode }) {
  const v = useVisible()
  const { t } = useI18n()
  if (!v.can(capability)) {
    return (
      <Card>
        <Empty title={t('access.denied')} hint={t('access.deniedHint')} scene="alerte" />
      </Card>
    )
  }
  return <>{children}</>
}

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/connexion" element={<Login />} />
        <Route path="/inscription" element={<Signup />} />
        <Route path="/agence" element={<AgencyHome />} />
        <Route path="/demande" element={<AskForm />} />
        <Route path="/suivi" element={<FindMine />} />
        <Route path="/portail" element={<Navigate to="/agence" replace />} />
        <Route path="/portail/demande/:token" element={<PortalRequest />} />
        <Route path="/portail/cargaison/:token" element={<PortalShipment />} />
        <Route path="/portail/:token" element={<PortalCase />} />

        <Route element={<RequireSession><Shell /></RequireSession>}>
          <Route path="/" element={<Today />} />
          <Route path="/tableau-de-bord" element={<Dashboard />} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/demandes" element={<Inbox />} />
          <Route path="/dossiers" element={<Cases />} />
          <Route path="/dossiers/:id" element={<CaseDetail />} />
          <Route path="/cargaisons" element={<Shipments />} />
          <Route path="/cargaisons/:id" element={<ShipmentDetail />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/:id" element={<ClientDetail />} />
          <Route path="/pieces" element={<Documents />} />
          <Route path="/rendez-vous" element={<Appointments />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/taches" element={<Tasks />} />
          <Route path="/paiements" element={<Require capability="finance:global"><Payments /></Require>} />
          <Route path="/automatisations" element={<Require capability="automation:manage"><Automations /></Require>} />
          <Route path="/rapports" element={<Require capability="reports:view"><Reports /></Require>} />
          <Route path="/reglages" element={<Require capability="settings:view"><Settings /></Require>} />
        </Route>

        <Route path="/index.html" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </ToastProvider>
  )
}
