import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { ActionReviewDialog, ConsentDialog, OverrideDialog, Toasts, WindowPromptDialog } from "./components/dialogs";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AnimatePresence, PageTransition } from "./components/motion";
import { AgentNetworkPage } from "./pages/AgentNetwork";
import { AllocationPage } from "./pages/Allocation";
import { AnalyticsPage } from "./pages/Analytics";
import { ApprovalsPage } from "./pages/Approvals";
import { AuditTrailPage } from "./pages/AuditTrail";
import { CommandCenterPage } from "./pages/CommandCenter";
import { IncidentDetailPage } from "./pages/IncidentDetail";
import { IncidentsPage } from "./pages/Incidents";
import { LogisticsPage } from "./pages/Logistics";
import { MarketplacePage } from "./pages/Marketplace";
import { ReportPage } from "./pages/Report";
import { ResourceRequestsPage } from "./pages/ResourceRequests";
import { SettingsPage } from "./pages/Settings";
import { SimulatorPage } from "./pages/Simulator";
import { TrustPage } from "./pages/Trust";

export function App() {
  const location = useLocation();
  // The report page is a print view: no shell around it.
  if (location.pathname.startsWith("/report/")) {
    return (
      <>
        <Routes location={location}><Route path="/report/:incidentId" element={<ReportPage />} /></Routes>
        <Toasts />
      </>
    );
  }
  return (
    <AppShell>
      <ErrorBoundary resetKey={location.pathname}>
        <AnimatePresence mode="wait" initial={false}>
          <PageTransition id={location.pathname}>
            <Routes location={location}>
              <Route path="/" element={<CommandCenterPage />} />
              <Route path="/incidents" element={<IncidentsPage />} />
              <Route path="/incidents/:incidentId" element={<IncidentDetailPage />} />
              <Route path="/simulator" element={<SimulatorPage />} />
              <Route path="/approvals" element={<ApprovalsPage />} />
              <Route path="/requests" element={<ResourceRequestsPage />} />
              <Route path="/allocation" element={<AllocationPage />} />
              <Route path="/network" element={<AgentNetworkPage />} />
              <Route path="/marketplace" element={<MarketplacePage />} />
              <Route path="/logistics" element={<LogisticsPage />} />
              <Route path="/trust" element={<TrustPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/audit" element={<AuditTrailPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </PageTransition>
        </AnimatePresence>
      </ErrorBoundary>
      <ConsentDialog />
      <ActionReviewDialog />
      <WindowPromptDialog />
      <OverrideDialog />
      <Toasts />
    </AppShell>
  );
}
