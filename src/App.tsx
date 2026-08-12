import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useApp } from './store'
import { Shell } from './components/shell/Shell'
import { Login } from './screens/Login'
import { Dashboard } from './screens/Dashboard'
// import { Agents } from './screens/Agents' // commented out — needs a design pass
import { Analytics } from './screens/Analytics'
import { NewApplication } from './screens/NewApplication'
import { IntakeInbox } from './screens/IntakeInbox'
import { IntakeReview } from './screens/IntakeReview'
import { DocumentViewer } from './screens/DocumentViewer'
import { DocumentAuthenticity } from './screens/DocumentAuthenticity'
import { Leads } from './screens/Leads'
import { DistributorProfile } from './screens/DistributorProfile'
import { Approvals } from './screens/Approvals'
import { Documents } from './screens/Documents'
import { Communication } from './screens/Communication'
import { Grievances } from './screens/Grievances'
import { Partners } from './screens/Partners'
import { Templates } from './screens/Templates'
import { GtmCoverage } from './screens/GtmCoverage'
import { Reports } from './screens/Reports'
import { Admin } from './screens/Admin'
import { TeamAssignment } from './screens/TeamAssignment'
import { MySettings } from './screens/MySettings'
import { AuditLog } from './screens/AuditLog'
import { RequireRole } from './components/auth/RequireRole'
import type { ReactNode } from 'react'

// The session is rehydrated from the local server / localStorage asynchronously (see
// sessionFileStorage in store.ts), so roleCode is briefly null on every hard page load —
// even for an already-logged-in user. Without this gate, a refresh on any route would bounce
// straight to /login before that async read resolves. useApp.persist exposes zustand's own
// hydration status, so we just wait for it before deciding whether the user is authenticated.
function useHydrated() {
  const [hydrated, setHydrated] = useState(() => useApp.persist.hasHydrated())
  useEffect(() => {
    if (hydrated) return
    return useApp.persist.onFinishHydration(() => setHydrated(true))
  }, [hydrated])
  return hydrated
}

function RequireAuth({ children }: { children: ReactNode }) {
  const roleCode = useApp((s) => s.roleCode)
  const hydrated = useHydrated()
  if (!hydrated) return null
  if (!roleCode) return <Navigate to="/login" replace />
  return <>{children}</>
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* No Shell chrome — this is the "View full document" destination, opened in its own tab. */}
      <Route path="/document-viewer" element={<RequireAuth><DocumentViewer /></RequireAuth>} />

      <Route
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        {/* <Route path="/agents" element={<Agents />} /> commented out — needs a design pass */}
        <Route path="/intake-inbox" element={<IntakeInbox />} />
        <Route path="/intake/:id" element={<IntakeReview />} />
        <Route path="/document-authenticity" element={<DocumentAuthenticity />} />
        <Route path="/leads" element={<Leads />} />
        <Route path="/distributor" element={<DistributorProfile />} />
        <Route path="/new-application" element={<NewApplication />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/communication" element={<Communication />} />
        <Route path="/grievances" element={<Grievances />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/gtm-coverage" element={<GtmCoverage />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/partners" element={<Partners />} />
        <Route path="/templates" element={<RequireRole allow={['admin']}><Templates /></RequireRole>} />
        <Route path="/settings" element={<RequireRole allow={['admin']}><Admin /></RequireRole>} />
        <Route path="/team" element={<TeamAssignment />} />
        <Route path="/my-settings" element={<MySettings />} />
        {/* Audit trail is shared — every persona can read it; only Templates/Settings stay admin-gated */}
        <Route path="/audit-log" element={<AuditLog />} />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
