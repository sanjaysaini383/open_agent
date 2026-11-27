import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Download, Pencil, Printer } from "lucide-react";
import { ActivityPanel } from "@/components/ActivityPanel";
import { IncidentFormDialog } from "@/components/IncidentForm";
import { IncidentMap } from "@/components/IncidentMap";
import { InteractionLog, NetworkGraph } from "@/components/NetworkGraph";
import { runCoordination, WorkflowPanel } from "@/components/Workflow";
import { PartnerExplorer } from "@/components/PartnerExplorer";
import { AllocationView, AssessmentView, ExecutionView, FleetView, LogisticsView, NegotiationView, OffersView, RisksView, TrustRow } from "@/components/views";
import { Badge, Breadcrumbs, Button, Card, CardHeader, Empty, KeyValue, Notice, PageHeader, SeverityBadge, SimBadge, Table, Tabs, Th, time } from "@/components/ui";
import { inr, num, RESOURCE_IDS, RESOURCES } from "@/domain/resources";
import { exportIncidentReport } from "@/lib/export";
import { AUTOMATED_STEPS } from "@/state/seed";
import { useStore } from "@/state/store";
import type { StepId } from "@/state/types";
import { useUi } from "@/state/ui";

type TabId = "assess" | "discover" | "trust" | "offers" | "negotiate" | "allocate" | "logistics" | "execute" | "risks" | "activity";

const STEP_TAB: Record<StepId, TabId> = { create: "assess", assess: "assess", discover: "discover", trust: "trust", offers: "offers", negotiate: "negotiate", allocate: "allocate", logistics: "logistics", approval: "execute", execute: "execute" };
const TAB_STEP: Partial<Record<TabId, StepId>> = { assess: "assess", discover: "discover", trust: "trust", offers: "offers", negotiate: "negotiate", allocate: "allocate", logistics: "logistics", execute: "approval" };

function TrustTab() {
  const peers = useStore((state) => state.peers);
  const orgTrust = useStore((state) => state.orgTrust);
  const pin = useStore((state) => state.settings.registryPin);
  const networks = Object.values(peers).filter((peer) => peer.trust);
  const organizations = Object.values(orgTrust);
  if (!networks.length && !organizations.length) return <Empty title="Nothing verified yet">Step 4 checks each partner network and organisation with TrustRegistry and verifies the signatures on its attestations.</Empty>;
  return (
    <div className="grid gap-3">
      <Notice tone="info">
        The registry's <strong>authority and credentials are simulated</strong>. Its <strong>signatures are real</strong>: each attestation below was verified in this browser with ECDSA P-256 against the registry key{pin ? <> pinned on first use (<span className="font-mono text-[12px]">{pin.fingerprint.slice(0, 23)}…</span>)</> : ""}. For a partner network, the published network file's SHA-256 is also compared with the attested digest.
      </Notice>
      <Table label="Trust decisions">
        <thead><tr><Th>Subject</Th><Th>Decision</Th><Th right>Score</Th><Th>Signature</Th><Th>Main finding</Th><Th /></tr></thead>
        <tbody>
          {networks.map((peer) => <TrustRow key={peer.id} evaluation={peer.trust!} />)}
          {organizations.map((evaluation) => <TrustRow key={evaluation.subjectId} evaluation={evaluation} />)}
        </tbody>
      </Table>
      <p className="text-[12.5px] text-muted">Open a row for the evidence behind its score. See <Link className="underline" to="/trust">Trust &amp; Verification</Link> for the scoring rules and the consent log.</p>
    </div>
  );
}

export function IncidentDetailPage() {
  const { incidentId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const incident = useStore((state) => state.incidents.find((item) => item.id === incidentId));
  const run = useStore((state) => state.runs[incidentId]);
  const [tab, setTab] = useState<TabId>("assess");
  const [editing, setEditing] = useState(false);

  useEffect(() => { if (incident) useStore.getState().setActiveIncident(incident.id); }, [incident]);
  // Follow the workflow: show the results of whichever step is running or just finished.
  const running = run ? (Object.entries(run.steps).find(([, state]) => state.status === "running")?.[0] as StepId | undefined) : undefined;
  useEffect(() => { if (running) setTab(STEP_TAB[running]); }, [running]);
  // The command palette can ask for the workflow to start or continue.
  useEffect(() => {
    if (params.get("run") === "1" && incident && run && !useUi.getState().busyIncident) {
      setParams({}, { replace: true });
      const next = AUTOMATED_STEPS.find((step) => !["done", "warning"].includes(run.steps[step].status));
      if (next && incident.status !== "closed") void runCoordination(incident.id, next);
    }
  }, [params, incident, run, setParams]);

  if (!incident || !run) {
    return <Empty title="Incident not found" action={<Link to="/incidents" className="underline">Back to incidents</Link>}>No incident has the id “{incidentId}”.</Empty>;
  }
  const report = (format: "md" | "json") => {
    const state = useStore.getState();
    void exportIncidentReport({ incident, run, peers: Object.values(state.peers), orgTrust: state.orgTrust, audit: state.audit }, format);
  };
  const highRisks = run.risks.filter((risk) => risk.severity === "critical" || risk.severity === "high").length;

  return (
    <>
      <Breadcrumbs items={[{ label: "Command Center", to: "/" }, { label: "Incidents", to: "/incidents" }, { label: incident.id }]} />
      <PageHeader
        title={incident.name}
        subtitle={<span className="flex flex-wrap items-center gap-2"><span className="font-mono text-[12.5px]">{incident.id}</span><SeverityBadge severity={incident.severity} /><Badge tone={incident.status === "active" ? "ok" : "neutral"}><span className="capitalize">{incident.status}</span></Badge><SimBadge /><span>{incident.location.name}</span></span>}
        actions={<>
          <Button onClick={() => setEditing(true)} disabled={incident.status === "closed"}><Pencil size={13} aria-hidden />Edit</Button>
          <Button onClick={() => report("md")}><Download size={13} aria-hidden />Export report</Button>
          <Button variant="ghost" onClick={() => report("json")}>JSON</Button>
          <Link to={`/report/${incident.id}`} className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface-3 px-3.5 py-2 text-[13.5px] font-semibold text-ink hover:bg-surface-4"><Printer size={13} aria-hidden />Report / PDF</Link>
        </>}
      />
      {incident.status === "closed" && <div className="mb-4"><Notice tone="warn">This incident is closed. Reopen it on the Incidents page to run workflow steps.</Notice></div>}

      <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="grid content-start gap-5">
          <Card>
            <CardHeader title="Incident" />
            <KeyValue items={[
              ["Category", <span className="capitalize">{incident.category}</span>],
              ["Affected population", num(incident.affectedPopulation)],
              ["Shelters", String(incident.shelterCount)],
              ["Declared needs", RESOURCE_IDS.map((id) => `${num(incident.requirements[id])} ${RESOURCES[id].label.toLowerCase()}`).join(", ")],
              ["Delivery deadline", time(incident.deadline)],
              ["Budget", inr(incident.budget)],
              ...(incident.notes ? [["Notes", incident.notes] as [string, React.ReactNode]] : []),
            ]} />
          </Card>
          <Card>
            <CardHeader title="Response workflow" subtitle="Ten steps. Seven run automatically; a person approves the plan and confirms every external write." />
            <WorkflowPanel incidentId={incident.id} selected={TAB_STEP[tab]} onSelect={(step) => setTab(STEP_TAB[step])} />
          </Card>
        </div>

        <div className="grid min-w-0 content-start gap-5">
          <Card>
            <CardHeader title="Live agent network" subtitle="Requests between this site and each independent partner site, as they happen. Click a node for details." />
            <NetworkGraph compact />
            <details className="mt-3 text-[12.5px]"><summary className="cursor-pointer font-semibold text-ink-2">Recent cross-origin interactions</summary><div className="mt-2"><InteractionLog limit={10} /></div></details>
          </Card>

          <Card padded={false}>
            <div className="px-5 pt-3">
              <Tabs<TabId>
                value={tab}
                onChange={setTab}
                tabs={[
                  { id: "assess", label: "Needs", count: run.assessment?.lines.length },
                  { id: "discover", label: "Partners" },
                  { id: "trust", label: "Trust" },
                  { id: "offers", label: "Offers", count: run.offers.length || undefined },
                  { id: "negotiate", label: "Negotiation", count: run.negotiation.length || undefined },
                  { id: "allocate", label: "Allocation", count: run.plan?.lines.length },
                  { id: "logistics", label: "Logistics", count: run.shipmentPlans.length || undefined },
                  { id: "execute", label: "Approval & tracking", count: run.shipments.length || undefined },
                  { id: "risks", label: "Risks", count: run.risks.length || undefined, alert: highRisks > 0 },
                  { id: "activity", label: "Agent activity" },
                ]}
              />
            </div>
            <div className="p-5">
              {tab === "assess" && <AssessmentView incidentId={incident.id} />}
              {tab === "discover" && <PartnerExplorer />}
              {tab === "trust" && <TrustTab />}
              {tab === "offers" && <OffersView incidentId={incident.id} />}
              {tab === "negotiate" && <NegotiationView incidentId={incident.id} />}
              {tab === "allocate" && <AllocationView incidentId={incident.id} />}
              {tab === "logistics" && <div className="grid gap-5"><LogisticsView incidentId={incident.id} /><FleetView incidentId={incident.id} /></div>}
              {tab === "execute" && <ExecutionView incidentId={incident.id} />}
              {tab === "risks" && <RisksView incidentId={incident.id} />}
              {tab === "activity" && <ActivityPanel incidentId={incident.id} limit={40} />}
            </div>
          </Card>

          <Card>
            <CardHeader title="Map" subtitle="Incident, shelters, suppliers, transport bases, flood zones and planned shipment routes." actions={<SimBadge label="Simulated coordinates" />} />
            <IncidentMap incident={incident} />
          </Card>
        </div>
      </div>
      {editing && <IncidentFormDialog incident={incident} onClose={() => setEditing(false)} />}
    </>
  );
}
