import { Link, useNavigate } from "react-router-dom";
import { Bot, CheckCircle2, Circle, ClipboardCheck, Package, ShieldCheck, Siren, Timer, Truck, Users } from "lucide-react";
import { ActivityPanel } from "@/components/ActivityPanel";
import { IncidentMap } from "@/components/IncidentMap";
import { runCoordination, workflowProgress } from "@/components/Workflow";
import { Badge, Button, Card, CardHeader, Empty, Meter, PageHeader, SeverityBadge, SimBadge, Stat, StatusIcon, time } from "@/components/ui";
import { overallFulfilmentPct } from "@/domain/allocation";
import { totalShortage } from "@/domain/needs";
import { num, RESOURCE_IDS, RESOURCES } from "@/domain/resources";
import { OPEN_STATUSES } from "@/domain/shipments";
import { setConsoleOpen } from "@/lib/boot";
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
    { label: "Watch resource allocation", done: done("allocate"), to: `/incidents/${incident.id}` },
    { label: "Review logistics proposals", done: done("logistics"), to: "/logistics" },
    { label: "Approve the proposed plan", done: run.approval.status === "approved", to: `/incidents/${incident.id}` },
    { label: "Track shipments", done: run.shipments.length > 0, to: "/logistics" },
    { label: "Inspect the final audit trail", done: audit > 0 && run.shipments.some((item) => item.status === "delivered"), to: "/audit" },
  ];
  const next = steps.find((step) => !step.done);
  return (
    <Card>
      <CardHeader
        title="Guided demonstration"
        subtitle="Twelve steps, about two minutes. Partner data is simulated; every call between the five sites is real."
        actions={<Button size="sm" variant="ghost" onClick={() => useStore.getState().patchSettings({ guidedDemo: false })}>Hide</Button>}
      />
      <ol className="grid gap-1 md:grid-cols-2">
        {steps.map((step, index) => (
          <li key={index}>
            <button type="button" onClick={() => navigate(step.to)} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-slate-50 ${step === next ? "bg-navy-50 font-semibold text-navy-800" : step.done ? "text-muted" : "text-ink-2"}`}>
              {step.done ? <CheckCircle2 size={15} className="shrink-0 text-ok" aria-label="Done" /> : <Circle size={15} className="shrink-0 text-slate-400" aria-label="To do" />}
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
  const navigate = useNavigate();

  const open = incidents.filter((incident) => incident.status !== "closed");
  const openRuns = open.map((incident) => runs[incident.id]).filter(Boolean);
  const assessed = openRuns.filter((run) => run.assessment);
  const shortage = assessed.reduce((sum, run) => sum + totalShortage(run.assessment!), 0);
  const partnerPeers = Object.values(peers).filter((peer) => peer.role !== "trust");
  const verified = partnerPeers.filter((peer) => peer.trust?.decision === "verified").length;
  const activeShipments = openRuns.reduce((sum, run) => sum + run.shipments.filter((item) => OPEN_STATUSES.includes(item.status)).length, 0);
  const delivered = openRuns.reduce((sum, run) => sum + run.shipments.filter((item) => item.status === "delivered").length, 0);
  const pendingApprovals = openRuns.filter((run) => canApprove(run).ok && run.approval.status === "none").length;
  const run = active ? runs[active.id] : undefined;
  const progress = workflowProgress(run);
  const planning = planningMinutes(run);
  const next = run ? AUTOMATED_STEPS.find((step) => !["done", "warning"].includes(run.steps[step].status)) : undefined;
  const currentStep = run ? STEPS.find((step) => run.steps[step.id].status === "running") ?? STEPS.find((step) => !["done", "warning"].includes(run.steps[step.id].status)) : undefined;

  return (
    <>
      <PageHeader
        title="Command Center"
        subtitle="ReliefMesh connects independently operated shelters, suppliers, logistics providers and a trust registry through interoperable agents. This site coordinates; each partner is a separate website on its own origin."
        actions={<>
          {runtime.state === "ready" && <Button onClick={() => setConsoleOpen(true)}><Bot size={14} aria-hidden />{runtime.hasKey ? "Ask the agents" : "Set up a model"}</Button>}
          {active && next && <Button variant="primary" busy={busy === active.id} disabled={!!busy || active.status === "closed"} onClick={() => { navigate(`/incidents/${active.id}`); void runCoordination(active.id, next); }}>{next === "assess" ? "Start coordination" : "Continue coordination"}</Button>}
        </>}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Active incidents" value={open.length} icon={<Siren size={15} />} tone={open.some((incident) => incident.severity === "critical") ? "critical" : "neutral"} hint={`${open.filter((incident) => incident.severity === "critical").length} critical`} />
        <Stat label="Affected population" value={num(open.reduce((sum, incident) => sum + incident.affectedPopulation, 0))} icon={<Users size={15} />} hint={`${open.reduce((sum, incident) => sum + incident.shelterCount, 0)} shelters`} />
        <Stat label="Critical shortages" value={assessed.length ? num(shortage) : "—"} icon={<Package size={15} />} tone={shortage > 0 ? "warn" : "neutral"} hint={assessed.length ? "units short across assessed incidents" : "not assessed yet"} />
        <Stat label="Verified partner agents" value={`${verified} / ${partnerPeers.length}`} icon={<ShieldCheck size={15} />} tone={verified === partnerPeers.length && verified > 0 ? "ok" : "neutral"} hint={verified ? "signatures checked" : "not verified yet"} />
        <Stat label="Active shipments" value={activeShipments} icon={<Truck size={15} />} hint={`${delivered} delivered`} tone={activeShipments ? "info" : "neutral"} />
        <Stat label="Pending approvals" value={pendingApprovals} icon={<ClipboardCheck size={15} />} tone={pendingApprovals ? "warn" : "neutral"} hint={pendingApprovals ? "a plan is waiting for a person" : "nothing waiting"} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 content-start gap-5">
          {active ? (
            <Card>
              <CardHeader
                title={<Link to={`/incidents/${active.id}`} className="underline-offset-2 hover:underline">{active.name}</Link>}
                subtitle={<span className="flex flex-wrap items-center gap-2"><SeverityBadge severity={active.severity} /><span>{active.location.name}</span><SimBadge /></span>}
                actions={<Button onClick={() => navigate(`/incidents/${active.id}`)}>Open incident</Button>}
              />
              <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <div className="mb-1 flex justify-between text-[12.5px]"><span className="font-semibold">Response workflow</span><span className="tabular text-muted">{progress.done} of {progress.total} steps</span></div>
                  <Meter value={progress.pct} tone={progress.pct === 100 ? "ok" : "navy"} />
                  {currentStep && run && <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-ink-2"><StatusIcon status={run.steps[currentStep.id].status} size={14} />{run.steps[currentStep.id].status === "running" ? "Running" : "Next"}: <strong>{currentStep.number}. {currentStep.title}</strong> — {currentStep.agent}</p>}
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
                    const allocated = run.plan?.fulfilment[id].allocated ?? 0;
                    return (
                      <li key={id} className="rounded-lg border border-line bg-slate-50 p-2.5 text-[12.5px]">
                        <div className="font-semibold">{RESOURCES[id].label}</div>
                        <div className="tabular text-muted">{num(total.shortage)} short{run.plan ? ` · ${num(allocated)} allocated` : ""}</div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          ) : <Empty title="No active incident" action={<Button variant="primary" onClick={() => navigate("/incidents")}>Go to incidents</Button>}>Create an incident, or use Reset demo to restore the preloaded scenario.</Empty>}

          {active && (
            <Card>
              <CardHeader title="Operational map" subtitle="Markers appear as each partner site is read. Lines are planned shipment routes." actions={<SimBadge label="Simulated coordinates" />} />
              <IncidentMap incident={active} height={400} />
            </Card>
          )}
        </div>

        <div className="grid min-w-0 content-start gap-5">
          {guided && <GuidedDemo />}
          {inbox.length > 0 && (
            <Card>
              <CardHeader title="Assistance requests" subtitle="Filed by partner sites' agents and confirmed by a person in a ReliefMesh window." actions={<Button size="sm" onClick={() => navigate("/requests")}>Review</Button>} />
              <ul className="grid gap-1.5 text-[13px]">{inbox.slice(0, 3).map((item) => <li key={item.reference} className="flex flex-wrap items-center gap-2"><Badge tone="warn">{item.urgency}</Badge><span className="font-semibold">{item.organization}</span><span className="text-muted">{item.summary}</span></li>)}</ul>
            </Card>
          )}
          <Card>
            <CardHeader
              icon={<Timer size={16} aria-hidden />}
              title="Recent agent activity"
              subtitle="Which agent did what, which network it called, and whether a person had to approve. Open an entry for its trace."
              actions={<Button size="sm" variant="ghost" onClick={() => navigate("/audit")}>Audit trail</Button>}
            />
            <ActivityPanel limit={8} />
          </Card>
        </div>
      </div>
    </>
  );
}
