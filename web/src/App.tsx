import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { loadGate } from './data/facturation'
import type { AccessGate } from './data/facturation'
import { BillingWall } from './components/BillingBanner'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell'
import { Card, Empty, ToastProvider } from './components/ui'
import { useStore } from './data/store'
import { useAuth } from './data/auth'
import { HAS_BACKEND } from './lib/supabase'
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
import { Slots } from './pages/Slots'
import { Messages } from './pages/Messages'
import { Payments } from './pages/Payments'
import { Tasks } from './pages/Tasks'
import { Automations } from './pages/Automations'
import { Reports } from './pages/Reports'
import { Stats } from './pages/Stats'
import { Settings } from './pages/Settings'
import { Equipe } from './pages/Equipe'
import { Leads } from './pages/Leads'
import { Quotes } from './pages/Quotes'
import { Invoices } from './pages/Invoices'
import { Deliveries } from './pages/Deliveries'
import { Warehouse } from './pages/Warehouse'
import { Directory } from './pages/Directory'
import { Support } from './pages/Support'
import { Traductions } from './pages/Traductions'
import { Prestations } from './pages/Prestations'
import { Pilotage } from './pages/Pilotage'
import { Login } from './pages/Login'
import { AgencyHome } from './pages/public/AgencyHome'
import { AskForm } from './pages/public/AskForm'
import { FindMine } from './pages/public/FindMine'
import { Signup } from './pages/public/Signup'
import { Souscrire } from './pages/public/Souscrire'
import { PortalRequest } from './pages/portal/PortalRequest'
import { Inbox } from './pages/Inbox'
import { PortalCase } from './pages/portal/PortalCase'
import { PortalShipment } from './pages/portal/PortalShipment'
import { NotFound } from './pages/NotFound'
import { AdminGate } from './pages/admin/AdminGate'
import { Cockpit } from './pages/admin/Cockpit'
import { Agences } from './pages/admin/Agences'
import { OuvrirAgence } from './pages/admin/OuvrirAgence'
import { Agence } from './pages/admin/Agence'
import { Demandes } from './pages/admin/Demandes'
import { Abonnements } from './pages/admin/Abonnements'
import { Facturation } from './pages/admin/Facturation'
import { Assistance } from './pages/admin/Assistance'
import { Annonces } from './pages/admin/Annonces'
import { Equipe as EquipePlateforme } from './pages/admin/Equipe'
import { Journal } from './pages/admin/Journal'
import { Taches } from './pages/admin/Taches'
import { AppSkeleton } from '@/components/AppSkeleton'
import { ChangePassword } from './pages/ChangePassword'

/** Personne n'entre dans l'espace agence sans session. */
function RequireSession({ children }: { children: ReactNode }) {
  const { signedIn, db, currentUserId, readOnly } = useStore()
  const auth = useAuth()
  /* Le mur de facturation. Il vit côté application et non dans les politiques
     de la base : couper les 148 politiques d'une agence suspendue l'empêcherait
     de lire sa propre situation, donc de comprendre et de payer. Ce qui coupe
     vraiment (portail public, fonctionnalités) est déjà coupé côté serveur. */
  const [gate, setGate] = useState<AccessGate | null>(null)
  useEffect(() => {
    if (!HAS_BACKEND || !auth.session || readOnly) { setGate(null); return }
    let vivant = true
    loadGate().then((g) => { if (vivant) setGate(g) }).catch(() => { if (vivant) setGate(null) })
    return () => { vivant = false }
  }, [auth.session, readOnly])
  // Sur un rechargement dur, la session Supabase met un instant à se restaurer.
  // On attend ce verdict avant de renvoyer vers la connexion, sinon on éjecte
  // un utilisateur pourtant connecté.
  if (HAS_BACKEND && !auth.ready) {
    return <AppSkeleton />
  }
  if (!signedIn) return <Navigate to="/connexion" replace />
  // Un compte invité entre avec un mot de passe provisoire : il en choisit un
  // à lui avant de voir quoi que ce soit. La vue support (lecture seule) n'est
  // pas concernée : l'admin regarde avec son propre compte.
  const me = db.users.find((u) => u.id === currentUserId)
  // Deux chemins mènent au même écran : le mot de passe provisoire d'une
  // invitation, et le retour d'un lien « mot de passe oublié ». Dans les deux
  // cas la session existe, et dans les deux cas elle ne doit servir qu'à ça.
  if (HAS_BACKEND && !readOnly && (auth.recovering || me?.mustResetPassword)) return <ChangePassword />
  if (gate?.bloquant && gate.message_cle) {
    return <BillingWall messageKey={gate.message_cle} contact={gate.contact} onSignOut={() => { void auth.signOut() }} />
  }
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
        {/* La console plateforme : une vraie application, barre latérale et
            pages routées. AdminGate garde la porte et rend AdminShell, qui
            porte l'Outlet. */}
        <Route path="/admin" element={<AdminGate />}>
          <Route index element={<Cockpit />} />
          <Route path="agences" element={<Agences />} />
          <Route path="agences/nouvelle" element={<OuvrirAgence />} />
          <Route path="agences/:id" element={<Agence />} />
          <Route path="demandes" element={<Demandes />} />
          <Route path="abonnements" element={<Abonnements />} />
          <Route path="facturation" element={<Facturation />} />
          <Route path="assistance" element={<Assistance />} />
          <Route path="annonces" element={<Annonces />} />
          <Route path="equipe" element={<EquipePlateforme />} />
          <Route path="journal" element={<Journal />} />
          <Route path="taches" element={<Taches />} />
        </Route>
        <Route path="/inscription" element={<Signup />} />
        {/* La porte d'entrée commerciale : une agence demande à souscrire. */}
        <Route path="/souscrire" element={<Souscrire />} />
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
          {/* Les deux écrans d'accueil n'en font plus qu'un. Celui-ci portait
              les gestes du matin, il a reçu la file de travail calculée par le
              serveur. L'ancienne adresse redirige : un lien déjà partagé ne
              doit pas tomber dans le vide. */}
          <Route path="/aujourdhui" element={<Navigate to="/" replace />} />
          <Route path="/pilotage" element={<Require capability="reports:view"><Pilotage /></Require>} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/demandes" element={<Inbox />} />
          <Route path="/dossiers" element={<Cases />} />
          <Route path="/dossiers/:id" element={<CaseDetail />} />
          <Route path="/cargaisons" element={<Shipments />} />
          <Route path="/cargaisons/:id" element={<ShipmentDetail />} />
          <Route path="/livraisons" element={<Deliveries />} />
          <Route path="/entrepot" element={<Warehouse />} />
          <Route path="/repertoires" element={<Directory />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/:id" element={<ClientDetail />} />
          <Route path="/pieces" element={<Documents />} />
          <Route path="/traductions" element={<Traductions />} />
          <Route path="/prestations" element={<Prestations />} />
          <Route path="/rendez-vous" element={<Appointments />} />
          <Route path="/creneaux" element={<Slots />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/taches" element={<Tasks />} />
          <Route path="/commercial" element={<Leads />} />
          <Route path="/devis" element={<Require capability="payment:write"><Quotes /></Require>} />
          <Route path="/factures" element={<Require capability="payment:write"><Invoices /></Require>} />
          <Route path="/paiements" element={<Require capability="finance:global"><Payments /></Require>} />
          <Route path="/automatisations" element={<Require capability="automation:manage"><Automations /></Require>} />
          <Route path="/rapports" element={<Require capability="reports:view"><Reports /></Require>} />
          <Route path="/statistiques" element={<Require capability="reports:view"><Stats /></Require>} />
          <Route path="/aide" element={<Support />} />
          <Route path="/equipe" element={<Require capability="settings:view"><Equipe /></Require>} />
          <Route path="/reglages" element={<Require capability="settings:view"><Settings /></Require>} />
        </Route>

        <Route path="/index.html" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </ToastProvider>
  )
}
