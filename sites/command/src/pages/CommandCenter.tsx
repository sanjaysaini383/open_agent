// The Command Center: the operational overview. Every figure is read from the store and
// every comparison is a real one (allocated against short, verified against checked).
import { Link, useNavigate } from "react-router-dom";
import { AlertOctagon, Bot, CheckCircle2, Circle, ClipboardCheck, Map as MapIcon, Network, Package, Play, Radio, ShieldCheck, Siren, Timer, Truck, Users } from "lucide-react";
import { ActivityFeed } from "@/components/ActivityFeed";
import { AlertList } from "@/components/AlertCenter";
import { IncidentMap } from "@/components/IncidentMap";
import { Item, LiveDot, Stagger } from "@/components/motion";
import { NetworkGraph } from "@/components/NetworkGraph";
import { runCoordination, workflowProgress } from "@/components/Workflow";
import { Badge, Button, Card, CardHeader, Empty, Meter, PageHeader, SeverityBadge, SimBadge, Stat, StatusIcon, time } from "@/components/ui";
import { overallFulfilmentPct } from "@/domain/allocation";
import { totalShortage } from "@/domain/needs";
import { num, RESOURCE_IDS, RESOURCES } from "@/domain/resources";
import { OPEN_STATUSES } from "@/domain/shipments";
import { setConsoleOpen } from "@/lib/boot";
import { useAlerts } from "@/lib/useAlerts";
import { AUTOMATED_STEPS, STEPS } from "@/state/seed";
import { useActiveIncident, useStore } from "@/state/store";
import type { WorkflowRun } from "@/state/types";
import { useUi } from "@/state/ui";
import { canApprove } from "@/workflow/execution";

function minutesBetween(from?: string, to?: string): number | null {
  if (!from || !to) return null;
  const value = (Date.parse(to) - Date.parse(from)) / 60_000;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Time from the first automated step starting to the transport plan being ready. */
function planningMinutes(run: WorkflowRun | undefined): number | null {
  if (!run) return null;
  return minutesBetween(run.steps.assess.startedAt, run.steps.logistics.endedAt);
}

function GuidedDemo() {
  const incident = useActiveIncident();
  const run = useStore((state) => (incident ? state.runs[incident.id] : undefined));
  const peers = useStore((state) => state.peers);
  const audit = useStore((state) => state.audit.length);
  const navigate = useNavigate();
  if (!incident || !run) return null;
  const done = (id: keyof WorkflowRun["steps"]) => ["done", "warning"].includes(run.steps[id].status);
  const connected = Object.values(peers).filter((peer) => peer.discovery?.status === "connected").length;
  const steps: { label: string; done: boolean; to: string }[] = [
    { label: "Open the Command Center", done: true, to: "/" },
    { label: "Open the simulated flood incident", done: true, to: `/incidents/${incident.id}` },
    { label: "Start the coordination workflow", done: run.steps.assess.status !== "idle", to: `/incidents/${incident.id}` },
    { label: "Watch agent discovery", done: done("discover"), to: "/network" },
    { label: `Watch independent websites being contacted (${connected} of ${Object.keys(peers).length})`, done: connected >= 4, to: "/network" },
    { label: "Review verification results", done: done("trust"), to: "/trust" },
    { label: "Compare supplier offers", done: done("offers") && done("negotiate"), to: "/marketplace" },
    { label: "Watch resource allocation", done: done("allocate"), to: "/allocation" },
    { label: "Review logistics proposals", done: done("logistics"), to: "/logistics" },
    { label: "Approve the proposed plan", done: run.approval.status === "approved", to: "/approvals" },
    { label: "Track shipments", done: run.shipments.length > 0, to: "/logistics" },
    { label: "Inspect the final audit trail", done: audit > 0 && run.shipments.some((item) => item.status === "delivered"), to: "/audit" },
  ];
  const next = steps.find((step) => !step.done);
  const completed = steps.filter((step) => step.done).length;
  return (
    <Card>
      <CardHeader
        title="Guided demonstration"
        subtitle="Twelve steps, about two minutes. Partner data is simulated; every call between the five sites is real."
        actions={<><Badge tone={completed === steps.length ? "ok" : "accent"}>{completed} / {steps.length}</Badge><Button size="sm" variant="ghost" onClick={() => useStore.getState().patchSettings({ guidedDemo: false })}>Hide</Button></>}
      />
      <ol className="grid gap-1 md:grid-cols-2">
        {steps.map((step, index) => (
          <li key={index}>
            <button type="button" onClick={() => navigate(step.to)} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-surface-2 ${step === next ? "bg-accent-soft font-semibold text-accent-text" : step.done ? "text-muted" : "text-ink-2"}`}>
              {step.done ? <CheckCircle2 size={15} className="shrink-0 text-ok" aria-label="Done" /> : <Circle size={15} className="shrink-0 text-faint" aria-label="To do" />}
              <span>{index + 1}. {step.label}</span>
            </button>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function CommandCenterPage() {
  const incidents = useStore((state) => state.incidents);
  const runs = useStore((state) => state.runs);
  const peers = useStore((state) => state.peers);
  const guided = useStore((state) => state.settings.guidedDemo);
  // Select the stored array and filter while rendering: a selector must return a stable reference.
  const allRequests = useStore((state) => state.inbox);
  const inbox = allRequests.filter((item) => item.status === "new");
  const active = useActiveIncident();
  const busy = useUi((state) => state.busyIncident);
  const runtime = useUi((state) => state.runtime);
  const alerts = useAlerts();
  const navigate = useNavigate();

  const open = incidents.filter((incident) => incident.status !== "closed");
  const openRuns = open.map((incident) => runs[incident.id]).filter(Boolean);
  const assessed = openRuns.filter((run) => run.assessment);
  const shortage = assessed.reduce((sum, run) => sum + totalShortage(run.assessment!), 0);
  const allocated = openRuns.reduce((sum, run) => sum + (run.plan ? RESOURCE_IDS.reduce((units, id) => units + run.plan!.fulfilment[id].allocated, 0) : 0), 0);
  const partnerPeers = Object.values(peers).filter((peer) => peer.role !== "trust");
  const verified = partnerPeers.filter((peer) => peer.trust?.decision === "verified").length;
  const checked = partnerPeers.filter((peer) => peer.trust).length;
  const signatures = [...partnerPeers.map((peer) => peer.trust), ...Object.values(useStore.getState().orgTrust)].filter((item) => item?.signatureVerified).length;
  const activeShipments = openRuns.reduce((sum, run) => sum + run.shipments.filter((item) => OPEN_STATUSES.includes(item.status)).length, 0);
  const delivered = openRuns.reduce((sum, run) => sum + run.shipments.filter((item) => item.status === "delivered").length, 0);
  const pendingApprovals = openRuns.filter((run) => canApprove(run).ok && run.approval.status === "none").length;
  const pendingWrites = alerts.filter((alert) => alert.category === "approval" && alert.severity === "info").length;
  const run = active ? runs[active.id] : undefined;
  const progress = workflowProgress(run);
  const planning = planningMinutes(run);
  const next = run ? AUTOMATED_STEPS.find((step) => !["done", "warning"].includes(run.steps[step].status)) : undefined;
  const currentStep = run ? STEPS.find((step) => run.steps[step.id].status === "running") ?? STEPS.find((step) => !["done", "warning"].includes(run.steps[step.id].status)) : undefined;
  const critical = open.filter((incident) => incident.severity === "critical").length;
  const criticalAlerts = alerts.filter((alert) => alert.severity === "critical").length;

  return (
    <>
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-2"><LiveDot tone={busy ? "accent" : "ok"} active={!!busy} />{busy ? "Workflow running" : "Operational overview"}</span>}
        title="Command Center"
        subtitle="ReliefMesh connects independently operated shelters, suppliers, logistics providers and a trust registry through interoperable agents. This site coordinates; each partner is a separate website on its own origin."
        actions={<>
          {runtime.state === "ready" && <Button onClick={() => setConsoleOpen(true)}><Bot size={14} aria-hidden />{runtime.hasKey ? "Ask the agents" : "Set up a model"}</Button>}
          {active && next && <Button variant="primary" busy={busy === active.id} disabled={!!busy || active.status === "closed"} onClick={() => { navigate(`/incidents/${active.id}`); void runCoordination(active.id, next); }}><Play size={14} aria-hidden />{next === "assess" ? "Start coordination" : "Continue coordination"}</Button>}
        </>}
      />

      <Stagger className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Item><Stat label="Active emergencies" number={open.length} icon={<Siren size={15} />} tone={critical ? "critical" : "neutral"} delta={critical ? `${critical} critical` : undefined} deltaTone="critical" hint={critical ? undefined : "none critical"} /></Item>
        <Item><Stat label="People affected" number={open.reduce((sum, incident) => sum + incident.affectedPopulation, 0)} format={num} icon={<Users size={15} />} hint={`${open.reduce((sum, incident) => sum + incident.shelterCount, 0)} shelters`} /></Item>
        <Item><Stat label="Critical shortages" number={assessed.length ? shortage : 0} format={(value) => (assessed.length ? num(value) : "—")} icon={<Package size={15} />} tone={shortage > 0 && allocated < shortage ? "warn" : shortage > 0 ? "ok" : "neutral"} delta={allocated ? `${Math.min(100, Math.round((allocated / Math.max(1, shortage)) * 100))}% covered` : undefined} deltaTone={allocated >= shortage ? "ok" : "warn"} hint={assessed.length ? "units short, assessed" : "not assessed yet"} /></Item>
        <Item><Stat label="Verified agents" number={verified} format={(value) => `${Math.round(value)} / ${partnerPeers.length}`} icon={<ShieldCheck size={15} />} tone={verified === partnerPeers.length && verified > 0 ? "ok" : checked ? "warn" : "neutral"} delta={signatures ? `${signatures} signatures` : undefined} deltaTone="ok" hint={checked ? `${checked} checked` : "not verified yet"} /></Item>
        <Item><Stat label="Active shipments" number={activeShipments} icon={<Truck size={15} />} tone={activeShipments ? "info" : "neutral"} delta={delivered ? `${delivered} delivered` : undefined} deltaTone="ok" hint={activeShipments || delivered ? undefined : "none booked"} /></Item>
        <Item><Stat label="Pending approvals" number={pendingApprovals + pendingWrites} icon={<ClipboardCheck size={15} />} tone={pendingApprovals ? "warn" : pendingWrites ? "info" : "neutral"} hint={pendingApprovals ? "a plan is waiting for a person" : pendingWrites ? "a write needs your confirmation" : "nothing waiting"} /></Item>
      </Stagger>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 content-start gap-5">
          {active ? (
            <Card tone={active.severity === "critical" && active.status === "active" ? "critical" : undefined}>
              <CardHeader
                title={<Link to={`/incidents/${active.id}`} className="underline-offset-2 hover:underline">{active.name}</Link>}
                subtitle={<span className="flex flex-wrap items-center gap-2">{active.severity === "critical" && <LiveDot tone="critical" />}<SeverityBadge severity={active.severity} /><span>{active.location.name}</span><SimBadge /></span>}
                actions={<Button onClick={() => navigate(`/incidents/${active.id}`)}>Open incident</Button>}
              />
              <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <div className="mb-1 flex justify-between text-[12.5px]"><span className="font-semibold">Response workflow</span><span className="tabular text-muted">{progress.done} of {progress.total} steps</span></div>
                  <Meter value={progress.pct} tone={progress.pct === 100 ? "ok" : "accent"} />
                  {currentStep && run && <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-ink-2"><StatusIcon status={run.steps[currentStep.id].status} size={14} />{run.steps[currentStep.id].status === "running" ? "Running" : "Next"}: <strong>{currentStep.number}. {currentStep.title}</strong> — <button type="button" className="font-mono text-[12px] hover:text-accent-text" onClick={() => useUi.getState().setInspectAgent(currentStep.agent)}>{currentStep.agent}</button></p>}
                </div>
                <dl className="grid grid-cols-3 gap-4 text-center">
                  <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">Deadline</dt><dd className="tabular text-[13.5px] font-semibold">{time(active.deadline)}</dd></div>
                  <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">Shortage covered</dt><dd className="tabular text-[13.5px] font-semibold">{run?.plan ? `${overallFulfilmentPct(run.plan)}%` : "—"}</dd></div>
                  <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">Time to plan</dt><dd className="tabular text-[13.5px] font-semibold">{planning !== null ? `${planning < 1 ? "<1" : Math.round(planning)} min` : "—"}</dd></div>
                </dl>
              </div>
              {run?.assessment && (
                <ul className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                  {RESOURCE_IDS.map((id) => {
                    const total = run.assessment!.totals[id];
                    const got = run.plan?.fulfilment[id].allocated ?? 0;
                    const pct = total.shortage ? Math.min(100, Math.round((got / total.shortage) * 100)) : 100;
                    return (
                      <li key={id} className="rounded-lg border border-line bg-surface-2 p-2.5 text-[12.5px]">
                        <div className="flex items-center justify-between"><span className="font-semibold">{RESOURCES[id].label}</span>{run.plan && <span className="tabular text-[11.5px] text-muted">{pct}%</span>}</div>
                        <div className="tabular text-muted">{num(total.shortage)} short{run.plan ? ` · ${num(got)} allocated` : ""}</div>
                        {run.plan && <div className="mt-1.5"><Meter value={pct} tone={pct >= 100 ? "ok" : pct >= 70 ? "warn" : "critical"} height={4} /></div>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          ) : <Empty title="No active incident" action={<Button variant="primary" onClick={() => navigate("/incidents")}>Go to incidents</Button>}>Create an incident, run a scenario in the simulator, or use Reset demo to restore the preloaded scenario.</Empty>}

          {active && (
            <Card>
              <CardHeader icon={<MapIcon size={16} aria-hidden />} title="Live emergency map" subtitle="Incident, shelters, suppliers, carriers, flood zones and shipment routes. Markers appear as each partner site is read; shelters with critical shortages are highlighted." actions={<SimBadge label="Simulated coordinates" />} />
              <IncidentMap incident={active} height={420} />
            </Card>
          )}

          <Card>
            <CardHeader icon={<Network size={16} aria-hidden />} title="Live agent network" subtitle="This site's ten agents and the independent partner sites. Particles travel along a link only while a real request is in flight. Click any node." actions={<Button size="sm" variant="ghost" onClick={() => navigate("/network")}>Agent Network</Button>} />
            <NetworkGraph />
          </Card>
        </div>

        <div className="grid min-w-0 content-start gap-5">
          <Card tone={criticalAlerts ? "critical" : undefined}>
            <CardHeader icon={<AlertOctagon size={16} aria-hidden />} title={<span className="inline-flex items-center gap-2">Critical alerts {alerts.length > 0 && <Badge tone={criticalAlerts ? "critical" : "warn"}>{alerts.length}</Badge>}</span>} subtitle="Shortages, late deliveries, unverified agents, failed requests and pending approvals, derived from the current state." actions={<Button size="sm" variant="ghost" onClick={() => useUi.getState().setAlertsOpen(true)}>Open</Button>} />
            <AlertList limit={5} compact />
          </Card>
          {guided && <GuidedDemo />}
          {inbox.length > 0 && (
            <Card tone="warn">
              <CardHeader title="Assistance requests" subtitle="Filed by partner sites' agents and confirmed by a person in a ReliefMesh window." actions={<Button size="sm" onClick={() => navigate("/requests")}>Review</Button>} />
              <ul className="grid gap-1.5 text-[13px]">{inbox.slice(0, 3).map((item) => <li key={item.reference} className="flex flex-wrap items-center gap-2"><Badge tone="warn">{item.urgency}</Badge><span className="font-semibold">{item.organization}</span><span className="text-muted">{item.summary}</span></li>)}</ul>
            </Card>
          )}
          <Card>
            <CardHeader
              icon={<Radio size={16} aria-hidden />}
              title={<span className="inline-flex items-center gap-2">Live activity feed {busy && <LiveDot tone="accent" />}</span>}
              subtitle="Agent tasks, cross-origin requests, consent decisions and assistance requests as they happen."
              actions={<Button size="sm" variant="ghost" onClick={() => navigate("/audit")}><Timer size={13} aria-hidden />Audit trail</Button>}
            />
            <ActivityFeed limit={14} />
          </Card>
        </div>
      </div>
    </>
  );
}
