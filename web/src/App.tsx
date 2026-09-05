import { Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell'
import { ToastProvider } from './components/ui'
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
import { PortalIndex } from './pages/portal/PortalIndex'
import { PortalCase } from './pages/portal/PortalCase'
import { PortalShipment } from './pages/portal/PortalShipment'
import { NotFound } from './pages/NotFound'

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/connexion" element={<Login />} />
        <Route path="/portail" element={<PortalIndex />} />
        <Route path="/portail/cargaison/:token" element={<PortalShipment />} />
        <Route path="/portail/:token" element={<PortalCase />} />

        <Route element={<Shell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/dossiers" element={<Cases />} />
          <Route path="/dossiers/:id" element={<CaseDetail />} />
          <Route path="/cargaisons" element={<Shipments />} />
          <Route path="/cargaisons/:id" element={<ShipmentDetail />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/:id" element={<ClientDetail />} />
          <Route path="/pieces" element={<Documents />} />
          <Route path="/rendez-vous" element={<Appointments />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/paiements" element={<Payments />} />
          <Route path="/taches" element={<Tasks />} />
          <Route path="/automatisations" element={<Automations />} />
          <Route path="/rapports" element={<Reports />} />
          <Route path="/reglages" element={<Settings />} />
        </Route>

        <Route path="/index.html" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </ToastProvider>
  )
}
