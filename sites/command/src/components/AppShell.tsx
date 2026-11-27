// The application shell: collapsible sidebar, header with the incident selector and the
// network, agent and model status, the alert centre, the profile menu, the theme toggle,
// the command palette and the keyboard shortcuts. Every number in the header is read
// from the store.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { Bell, Bot, ChevronDown, ChevronsLeft, ChevronsRight, Keyboard, Menu, Moon, RotateCcw, Search, Settings as SettingsIcon, Sun, X } from "lucide-react";
import { forgetRegistryKeys } from "@/interop/peers";
import { setConsoleOpen } from "@/lib/boot";
import { NAV_GROUPS, navItemFor } from "@/lib/nav";
import { SHORTCUTS, useGlobalShortcuts } from "@/lib/shortcuts";
import { usePrefs } from "@/lib/theme";
import { useAlerts } from "@/lib/useAlerts";
import { useStore } from "@/state/store";
import { useUi } from "@/state/ui";
import { AgentPanel } from "./AgentPanel";
import { AlertDrawer } from "./AlertCenter";
import { CommandPalette } from "./CommandPalette";
import { AnimatePresence, LiveDot, Pop, useMotionOff } from "./motion";
import { Badge, Button, IconButton, Kbd, Modal, SimBadge, Tooltip, cx } from "./ui";

function Logo({ compact }: { compact: boolean }) {
  return (
    <div className={cx("flex h-[60px] items-center gap-2.5 border-b border-line", compact ? "justify-center px-2" : "px-4")}>
      <span className="btn-primary rm-shine relative grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[12px] font-bold tracking-wide text-accent-ink shadow-glow" aria-hidden>
        RM
      </span>
      {!compact && (
        <div className="min-w-0 leading-tight">
          <div className="text-[15px] font-semibold tracking-tight">ReliefMesh</div>
          <div className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-text">Command</div>
        </div>
      )}
    </div>
  );
}

function Sidebar({ collapsed, mobileOpen, onClose }: { collapsed: boolean; mobileOpen: boolean; onClose: () => void }) {
  const pending = useStore((state) => state.inbox);
  const alerts = useAlerts();
  const setCollapsed = usePrefs((state) => state.setSidebarCollapsed);
  const newRequests = pending.filter((item) => item.status === "new").length;
  const approvals = alerts.filter((alert) => alert.category === "approval").length;
  const badges: Record<string, number> = { "/requests": newRequests, "/approvals": approvals };
  return (
    <aside
      className={cx(
        "glass-strong fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col border-r border-line transition-[transform,width] duration-200 ease-out lg:static lg:translate-x-0",
        collapsed ? "w-[68px]" : "w-[236px]",
        mobileOpen ? "translate-x-0 shadow-pop" : "-translate-x-full",
      )}
      aria-label="Sidebar"
    >
      <div className="relative">
        <Logo compact={collapsed} />
        <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted lg:hidden" aria-label="Close menu" onClick={onClose}><X size={18} /></button>
      </div>
      <nav aria-label="Main" className="scroll-thin flex-1 overflow-y-auto px-2 py-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-2">
            {!collapsed && <div className="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">{group.label}</div>}
            {collapsed && <div className="mx-auto my-2 h-px w-6 bg-line" aria-hidden />}
            <ul className="grid gap-0.5">
              {group.items.map(({ to, label, icon: Icon, end }) => {
                const count = badges[to] || 0;
                const link = (
                  <NavLink
                    to={to}
                    end={end}
                    onClick={onClose}
                    className={({ isActive }) => cx(
                      "group relative flex items-center gap-2.5 rounded-md py-2 text-[13.5px] font-medium transition-colors",
                      collapsed ? "justify-center px-0" : "px-2.5",
                      isActive ? "bg-accent-soft text-accent-text shadow-[inset_0_1px_0_var(--glass-sheen)]" : "text-ink-2 hover:bg-surface-3 hover:text-ink",
                    )}
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" aria-hidden />}
                        <Icon size={16} aria-hidden className="shrink-0" />
                        {!collapsed && <span className="flex-1 truncate">{label}</span>}
                        {count > 0 && (collapsed
                          ? <span className="absolute right-2 top-1 h-2 w-2 rounded-full bg-high" aria-label={`${count} pending`} />
                          : <span className="rounded-full bg-high px-1.5 text-[11px] font-semibold text-white">{count}</span>)}
                      </>
                    )}
                  </NavLink>
                );
                return <li key={to}>{collapsed ? <Tooltip text={label} side="bottom" className="w-full">{link}</Tooltip> : link}</li>;
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className={cx("border-t border-line p-2", !collapsed && "px-3")}>
        {!collapsed && <p className="mb-2 text-[11.5px] leading-snug text-muted">Open Agentic Web MVP spec. Five independent sites; agents run in your browser.</p>}
        <button type="button" onClick={() => setCollapsed(!collapsed)} className="hidden w-full items-center justify-center gap-2 rounded-md border border-line-strong py-1.5 text-[12px] font-semibold text-muted hover:bg-surface-3 hover:text-ink lg:flex" aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"} title="Press [ to toggle">
          {collapsed ? <ChevronsRight size={15} /> : <><ChevronsLeft size={15} />Collapse</>}
        </button>
      </div>
    </aside>
  );
}

function IncidentSelector() {
  const incidents = useStore((state) => state.incidents);
  const activeId = useStore((state) => state.activeIncidentId);
  const navigate = useNavigate();
  const active = incidents.find((incident) => incident.id === activeId);
  const dot = { critical: "bg-critical", high: "bg-high", moderate: "bg-medium", low: "bg-ok" }[active?.severity ?? "low"];
  return (
    <label className="relative hidden w-[280px] min-w-[140px] shrink items-center md:flex">
      <span className="sr-only">Current incident</span>
      <span className={cx("pointer-events-none absolute left-2.5 h-2 w-2 rounded-full", dot, active?.severity === "critical" && active.status === "active" && "rm-pulse")} aria-hidden />
      <select
        value={activeId ?? ""}
        onChange={(event) => { const id = event.target.value; if (id) { useStore.getState().setActiveIncident(id); navigate(`/incidents/${id}`); } }}
        className="h-8 w-full cursor-pointer appearance-none truncate rounded-md border border-line-strong bg-surface-2 pl-6 pr-7 text-[12.5px] font-semibold text-ink hover:bg-surface-3"
      >
        {!incidents.length && <option value="">No incidents</option>}
        {incidents.map((incident) => <option key={incident.id} value={incident.id}>{incident.id} · {incident.name}{incident.status === "closed" ? " (closed)" : ""}</option>)}
      </select>
      <ChevronDown size={13} className="pointer-events-none absolute right-2 text-faint" aria-hidden />
    </label>
  );
}

function NetworkStatus() {
  const peers = useStore((state) => state.peers);
  const interactions = useStore((state) => state.interactions);
  const list = Object.values(peers);
  const connected = list.filter((peer) => peer.discovery?.status === "connected").length;
  const inFlight = interactions.some((item) => item.status === "pending");
  const failed = list.filter((peer) => peer.discovery?.status === "failed" || peer.discovery?.status === "policy-refused").length;
  const tone = failed ? "critical" : connected && connected === list.length ? "ok" : connected ? "info" : "neutral";
  return (
    <Tooltip text={<>Partner networks loaded from their public files: {connected} of {list.length}.{inFlight ? " A request is in flight." : ""}{failed ? ` ${failed} could not be loaded.` : ""}</>} side="bottom">
      <Badge tone={tone}>
        <LiveDot tone={inFlight ? "accent" : tone === "ok" ? "ok" : tone === "critical" ? "critical" : "muted"} active={inFlight} />
        <span className="tabular">{connected}/{list.length}</span> partner networks
      </Badge>
    </Tooltip>
  );
}

function ActiveAgents() {
  const activity = useStore((state) => state.activity);
  const running = activity.filter((item) => item.status === "running");
  const names = [...new Set(running.map((item) => item.agent))];
  return (
    <Tooltip text={names.length ? `Running now: ${names.join(", ")}` : "No agent is running right now"} side="bottom">
      <Badge tone={names.length ? "accent" : "neutral"}>
        {names.length ? <LiveDot tone="accent" /> : <Bot size={12} aria-hidden />}
        <span className="tabular">{names.length}</span> agent{names.length === 1 ? "" : "s"} active
      </Badge>
    </Tooltip>
  );
}

function RuntimeChip() {
  const runtime = useUi((state) => state.runtime);
  if (runtime.state === "loading") return <Badge tone="neutral">Agent runtime loading…</Badge>;
  if (runtime.state === "failed") return <Badge tone="critical" title={runtime.error}>Agent runtime failed</Badge>;
  return runtime.hasKey
    ? <Badge tone="ok" title={`Router ${runtime.router}`}>Model: {runtime.model || "configured"}</Badge>
    : <Badge tone="warn" title="The coordination workflow runs without a model. Add a key in the agent console to talk to the agents.">No model key — workflow only</Badge>;
}

export function ResetDemoDialog({ onClose }: { onClose: () => void }) {
  const reset = () => {
    useStore.getState().resetDemo();
    forgetRegistryKeys();
    useUi.getState().restoreAlerts();
    onClose();
    useUi.getState().notify("Demo reset. This site's data is back to the simulated starting scenario. Partner sites keep their own data; each has its own reset.", "ok");
  };
  return (
    <Modal title="Reset the demonstration?" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Keep my data</Button><Button variant="danger" onClick={reset}>Reset this site</Button></>}>
      <p className="text-[13.5px] text-ink-2">This clears incidents, plans, shipments, trust results, the activity log and the audit trail on ReliefMesh Command, and restores the preloaded flood scenario. The pinned registry key, your model settings and your interface preferences are kept. Each partner site has its own Reset demo data button.</p>
    </Modal>
  );
}

function ProfileMenu({ onReset }: { onReset: () => void }) {
  const name = usePrefs((state) => state.displayName);
  const theme = usePrefs((state) => state.theme);
  const toggleTheme = usePrefs((state) => state.toggleTheme);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const initials = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "C";
  const item = "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-ink-2 hover:bg-surface-3 hover:text-ink";
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label="Profile menu" onClick={() => setOpen(!open)} className="flex h-8 items-center gap-2 rounded-full border border-line-strong bg-surface-2 pl-0.5 pr-2 hover:bg-surface-3">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-accent-2 text-[11px] font-bold text-white" aria-hidden>{initials}</span>
        <span className="hidden max-w-[120px] truncate text-[12.5px] font-semibold xl:block">{name}</span>
        <ChevronDown size={13} className="text-faint" aria-hidden />
      </button>
      <AnimatePresence>
        {open && (
          <Pop origin="right" className="absolute right-0 top-full z-50 mt-1.5 w-64 rounded-lg border border-line-strong bg-surface p-1.5 shadow-pop">
            <div role="menu">
              <div className="px-2.5 py-2">
                <div className="text-[13.5px] font-semibold">{name}</div>
                <div className="text-[12px] text-muted">Coordinator · this browser</div>
                <div className="mt-1 text-[11.5px] text-faint">Decisions are recorded as human:coordinator.</div>
              </div>
              <div className="my-1 h-px bg-line" />
              <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); toggleTheme(); }}>{theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}{theme === "dark" ? "Light theme" : "Dark theme"}<Kbd>⇧T</Kbd></button>
              <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); useUi.getState().setShortcutsOpen(true); }}><Keyboard size={14} />Keyboard shortcuts<Kbd>?</Kbd></button>
              <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); navigate("/settings"); }}><SettingsIcon size={14} />Settings and profile</button>
              <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); onReset(); }}><RotateCcw size={14} />Reset demo</button>
            </div>
          </Pop>
        )}
      </AnimatePresence>
    </div>
  );
}

function ShortcutsDialog() {
  const open = useUi((state) => state.shortcutsOpen);
  const close = useUi((state) => state.setShortcutsOpen);
  if (!open) return null;
  return (
    <Modal title="Keyboard shortcuts" onClose={() => close(false)} footer={<Button variant="primary" onClick={() => close(false)}>Done</Button>}>
      <ul className="grid gap-1.5 text-[13px] sm:grid-cols-2">
        {SHORTCUTS.map((shortcut) => (
          <li key={shortcut.label} className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-2 px-2.5 py-1.5">
            <span className="text-ink-2">{shortcut.label}</span>
            <span className="inline-flex shrink-0 items-center gap-0.5">{shortcut.keys.map((key) => <Kbd key={key}>{key}</Kbd>)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] text-muted">Single-key shortcuts are ignored while you type in a field or while a dialog is open.</p>
    </Modal>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const collapsed = usePrefs((state) => state.sidebarCollapsed);
  const theme = usePrefs((state) => state.theme);
  const toggleTheme = usePrefs((state) => state.toggleTheme);
  const consoleOpen = useUi((state) => state.consoleOpen);
  const setAlertsOpen = useUi((state) => state.setAlertsOpen);
  const setPalette = useUi((state) => state.setPaletteOpen);
  const alerts = useAlerts();
  const [menu, setMenu] = useState(false);
  const [resetting, setResetting] = useState(false);
  const location = useLocation();
  const off = useMotionOff();
  useGlobalShortcuts();
  useEffect(() => { setMenu(false); }, [location.pathname]);
  useEffect(() => { if (new URLSearchParams(location.search).get("reset") === "1") setResetting(true); }, [location.search]);

  const urgent = alerts.filter((alert) => alert.severity !== "info").length;
  const critical = alerts.some((alert) => alert.severity === "critical");
  const current = navItemFor(location.pathname);

  return (
    <div className="rm-canvas flex min-h-screen">
      <Sidebar collapsed={collapsed} mobileOpen={menu} onClose={() => setMenu(false)} />
      {menu && <button type="button" aria-label="Close menu" className="fixed inset-0 z-40 bg-[var(--backdrop)] lg:hidden" onClick={() => setMenu(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass-strong sticky top-0 z-30 flex h-[60px] items-center gap-2 border-b border-line px-3 lg:px-5">
          <button type="button" className="shrink-0 rounded p-1.5 text-ink-2 lg:hidden" aria-label="Open menu" onClick={() => setMenu(true)}><Menu size={19} /></button>
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            <IncidentSelector />
            <span className="hidden truncate text-[12.5px] font-semibold text-muted 2xl:block" aria-current="page">{current?.label}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden md:inline-flex"><NetworkStatus /></span>
            <span className="hidden lg:inline-flex"><ActiveAgents /></span>
            <span className="hidden sm:inline-flex"><RuntimeChip /></span>
            <span className="hidden xl:inline-flex"><SimBadge /></span>
            <Tooltip text={<>Search and commands <Kbd>Ctrl</Kbd> <Kbd>K</Kbd></>} side="bottom">
              <button type="button" onClick={() => setPalette(true)} className="hidden h-8 items-center gap-2 rounded-md border border-line-strong bg-surface-2 px-2.5 text-[12.5px] text-muted hover:bg-surface-3 hover:text-ink lg:flex" aria-label="Open the command palette"><Search size={14} /><span className="hidden 2xl:inline">Search…</span><Kbd>⌘K</Kbd></button>
            </Tooltip>
            <Tooltip text={urgent ? `${urgent} alert${urgent === 1 ? "" : "s"} need attention` : "No open alerts"} side="bottom">
              <IconButton label={`Alerts${urgent ? `: ${urgent} need attention` : ""}`} onClick={() => setAlertsOpen(true)} className="relative">
                <Bell size={17} className={cx(critical && !off && "animate-[rm-spin_0s]")} />
                {urgent > 0 && <span className={cx("absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold text-white", critical ? "bg-critical" : "bg-high")}>{urgent}{critical && <span className="absolute inset-0 rounded-full bg-critical opacity-60 motion-safe:animate-ping" aria-hidden />}</span>}
              </IconButton>
            </Tooltip>
            <Tooltip text={theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"} side="bottom">
              <IconButton label={theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"} onClick={toggleTheme}>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</IconButton>
            </Tooltip>
            <Button size="sm" variant="primary" onClick={() => setConsoleOpen(!consoleOpen)} aria-expanded={consoleOpen} aria-label="Agent console"><Bot size={14} aria-hidden /><span className="hidden sm:inline">Agent console</span></Button>
            <ProfileMenu onReset={() => setResetting(true)} />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1560px] flex-1 p-4 lg:p-6">{children}</main>

        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-6 py-3 text-[12px] text-muted">
          <span>All incident and partner data is simulated. Cross-origin calls, signature checks and the NANDA Index lookup are real.</span>
          <a className="underline hover:text-ink" href="./agent-manifest.json" target="_blank" rel="noreferrer">agent-manifest.json</a>
          <a className="underline hover:text-ink" href="./reliefmesh_command.network.json" target="_blank" rel="noreferrer">network definition</a>
          <button type="button" className="underline hover:text-ink" onClick={() => useUi.getState().setShortcutsOpen(true)}>Keyboard shortcuts</button>
        </footer>
      </div>

      <AlertDrawer />
      <AgentPanel />
      <CommandPalette />
      <ShortcutsDialog />
      {resetting && <ResetDemoDialog onClose={() => setResetting(false)} />}
    </div>
  );
}
