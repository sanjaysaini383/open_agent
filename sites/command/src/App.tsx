import { useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Activity, BarChart3, Bot, ClipboardList, Gauge, Menu, Network, RotateCcw, ScrollText, Settings as SettingsIcon, ShieldCheck, Siren, Store, Truck, X } from "lucide-react";
import { ActionReviewDialog, ConsentDialog, OverrideDialog, Toast, WindowPromptDialog } from "./components/dialogs";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Badge, Button, Modal, SimBadge, cx } from "./components/ui";
import { setConsoleOpen } from "./lib/boot";
import { forgetRegistryKeys } from "./interop/peers";
import { AgentNetworkPage } from "./pages/AgentNetwork";
import { AnalyticsPage } from "./pages/Analytics";
import { AuditTrailPage } from "./pages/AuditTrail";
import { CommandCenterPage } from "./pages/CommandCenter";
import { IncidentDetailPage } from "./pages/IncidentDetail";
import { IncidentsPage } from "./pages/Incidents";
import { LogisticsPage } from "./pages/Logistics";
import { MarketplacePage } from "./pages/Marketplace";
import { ResourceRequestsPage } from "./pages/ResourceRequests";
import { SettingsPage } from "./pages/Settings";
import { TrustPage } from "./pages/Trust";
import { useStore } from "./state/store";
import { useUi } from "./state/ui";

const NAV = [
  { to: "/", label: "Command Center", icon: Gauge, end: true },
  { to: "/incidents", label: "Incidents", icon: Siren },
  { to: "/requests", label: "Resource Requests", icon: ClipboardList },
  { to: "/network", label: "Agent Network", icon: Network },
  { to: "/marketplace", label: "Supplier Marketplace", icon: Store },
  { to: "/logistics", label: "Logistics", icon: Truck },
  { to: "/trust", label: "Trust & Verification", icon: ShieldCheck },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/audit", label: "Audit Trail", icon: ScrollText },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

function RuntimeChip() {
  const runtime = useUi((state) => state.runtime);
  if (runtime.state === "loading") return <Badge tone="neutral">Agent runtime loading…</Badge>;
  if (runtime.state === "failed") return <Badge tone="critical" title={runtime.error}>Agent runtime failed</Badge>;
  return runtime.hasKey
    ? <Badge tone="ok" title={`Router ${runtime.router}`}>Model: {runtime.model || "configured"}</Badge>
    : <Badge tone="warn" title="The coordination workflow runs without a model. Add a key in the agent console to talk to the agents.">No model key — workflow only</Badge>;
}

function ResetDemo() {
  const [open, setOpen] = useState(false);
  const reset = () => {
    useStore.getState().resetDemo();
    forgetRegistryKeys();
    setOpen(false);
    useUi.getState().notify("Demo reset. This site's data is back to the simulated starting scenario. Partner sites keep their own data; each has its own reset.", "ok");
  };
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} title="Restore the preloaded scenario"><RotateCcw size={13} aria-hidden />Reset demo</Button>
      {open && (
        <Modal title="Reset the demonstration?" onClose={() => setOpen(false)} footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Keep my data</Button><Button variant="danger" onClick={reset}>Reset this site</Button></>}>
          <p className="text-[13.5px] text-ink-2">This clears incidents, plans, shipments, trust results, the activity log and the audit trail on ReliefMesh Command, and restores the preloaded flood scenario. The pinned registry key and your model settings are kept. Each partner site has its own Reset demo data button.</p>
        </Modal>
      )}
    </>
  );
}

export function App() {
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  const consoleOpen = useUi((state) => state.consoleOpen);
  const pending = useStore((state) => state.inbox.filter((item) => item.status === "new").length);

  return (
    <div className="flex min-h-screen">
      <aside className={cx("fixed inset-y-0 left-0 z-30 w-[236px] shrink-0 border-r border-line bg-white transition-transform lg:static lg:translate-x-0", menu ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex h-[60px] items-center gap-2.5 border-b border-line px-4">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-navy-800 text-[12px] font-bold tracking-wide text-white" aria-hidden>RM</span>
          <div className="min-w-0 leading-tight">
            <div className="text-[15px] font-semibold">ReliefMesh</div>
            <div className="truncate text-[11.5px] text-muted">Command</div>
          </div>
          <button type="button" className="ml-auto rounded p-1 text-muted lg:hidden" aria-label="Close menu" onClick={() => setMenu(false)}><X size={18} /></button>
        </div>
        <nav aria-label="Main" className="grid gap-0.5 p-2.5">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setMenu(false)}
              className={({ isActive }) => cx("flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] font-medium transition-colors", isActive ? "bg-navy-50 text-navy-800" : "text-ink-2 hover:bg-slate-50")}
            >
              <Icon size={16} aria-hidden />
              <span className="flex-1">{label}</span>
              {to === "/requests" && pending > 0 && <span className="rounded-full bg-high px-1.5 text-[11px] font-semibold text-white">{pending}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="absolute inset-x-0 bottom-0 border-t border-line p-3.5 text-[11.5px] leading-snug text-muted">
          Built on the Open Agentic Web MVP specification. Five independent sites; agents run in your browser.
        </div>
      </aside>
      {menu && <button type="button" aria-label="Close menu" className="fixed inset-0 z-20 bg-navy-950/30 lg:hidden" onClick={() => setMenu(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-[60px] items-center gap-3 border-b border-line bg-white/95 px-4 backdrop-blur lg:px-6">
          <button type="button" className="rounded p-1.5 text-ink-2 lg:hidden" aria-label="Open menu" onClick={() => setMenu(true)}><Menu size={19} /></button>
          <p className="hidden min-w-0 truncate text-[13px] text-muted md:block">When disaster strikes, agents coordinate before humans have to.</p>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <SimBadge />
            <RuntimeChip />
            <ResetDemo />
            <Button size="sm" variant="primary" onClick={() => setConsoleOpen(!consoleOpen)} aria-expanded={consoleOpen}>
              <Bot size={14} aria-hidden />Agent console
            </Button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1500px] flex-1 p-4 lg:p-6">
          <ErrorBoundary resetKey={location.pathname}>
          <Routes>
            <Route path="/" element={<CommandCenterPage />} />
            <Route path="/incidents" element={<IncidentsPage />} />
            <Route path="/incidents/:incidentId" element={<IncidentDetailPage />} />
            <Route path="/requests" element={<ResourceRequestsPage />} />
            <Route path="/network" element={<AgentNetworkPage />} />
            <Route path="/marketplace" element={<MarketplacePage />} />
            <Route path="/logistics" element={<LogisticsPage />} />
            <Route path="/trust" element={<TrustPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/audit" element={<AuditTrailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </ErrorBoundary>
        </main>
        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-6 py-3 text-[12px] text-muted">
          <span className="inline-flex items-center gap-1.5"><Activity size={13} aria-hidden />All incident and partner data is simulated. Cross-origin calls are real.</span>
          <a className="underline" href="./agent-manifest.json" target="_blank" rel="noreferrer">agent-manifest.json</a>
          <a className="underline" href="./reliefmesh_command.network.json" target="_blank" rel="noreferrer">network definition</a>
        </footer>
      </div>

      <ConsentDialog />
      <ActionReviewDialog />
      <WindowPromptDialog />
      <OverrideDialog />
      <Toast />
    </div>
  );
}
