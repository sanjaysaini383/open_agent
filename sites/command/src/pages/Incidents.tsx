import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Download, Pencil, Plus, Printer } from "lucide-react";
import { IncidentFormDialog } from "@/components/IncidentForm";
import { workflowProgress } from "@/components/Workflow";
import { Badge, Button, Empty, Meter, Modal, PageHeader, SearchInput, Segmented, SeverityBadge, SimBadge, SortableTh, Td, Th, time, useSort } from "@/components/ui";
import { num, inr } from "@/domain/resources";
import type { Incident } from "@/domain/types";
import { exportIncidentReport } from "@/lib/export";
import { useStore } from "@/state/store";
import { useUi } from "@/state/ui";

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, moderate: 2, low: 1 };
type Status = "all" | "active" | "monitoring" | "closed";

export function IncidentsPage() {
  const incidents = useStore((state) => state.incidents);
  const runs = useStore((state) => state.runs);
  const activeId = useStore((state) => state.activeIncidentId);
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Incident | null>(null);
  const [closing, setClosing] = useState<Incident | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const filtered = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return incidents.filter((incident) => (status === "all" || incident.status === status) && (!words.length || words.every((word) => `${incident.id} ${incident.name} ${incident.location.name} ${incident.category}`.toLowerCase().includes(word))));
  }, [incidents, query, status]);
  const accessors = useMemo(() => ({
    name: (incident: Incident) => incident.name,
    severity: (incident: Incident) => SEVERITY_RANK[incident.severity] ?? 0,
    status: (incident: Incident) => incident.status,
    affected: (incident: Incident) => incident.affectedPopulation,
    budget: (incident: Incident) => incident.budget,
    deadline: (incident: Incident) => incident.deadline,
    progress: (incident: Incident) => workflowProgress(runs[incident.id]).pct,
  }), [runs]);
  const [sorted, sort, setSort] = useSort(filtered, accessors, null);

  const setIncidentStatus = async (incident: Incident, next: Incident["status"]) => {
    const store = useStore.getState();
    store.updateIncident(incident.id, { status: next, closedAt: next === "closed" ? new Date().toISOString() : undefined });
    await store.record({ kind: "incident", actor: "human:coordinator", incidentId: incident.id, summary: next === "closed" ? `Incident closed: ${incident.name}` : `Incident reopened: ${incident.name}`, data: { status: next } });
    useUi.getState().notify(next === "closed" ? `${incident.id} closed. Its record and audit trail are kept.` : `${incident.id} reopened.`, "ok");
    setClosing(null);
  };
  const report = (incident: Incident, format: "md" | "json") => {
    const state = useStore.getState();
    void exportIncidentReport({ incident, run: state.run(incident.id), peers: Object.values(state.peers), orgTrust: state.orgTrust, audit: state.audit }, format);
  };

  return (
    <>
      <PageHeader
        title="Incidents"
        subtitle="Every emergency the network is coordinating. Create an incident, open it to run the response workflow, edit it, close it, or export its report."
        actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus size={14} aria-hidden />Create incident</Button>}
      />
      {incidents.length ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SearchInput className="w-72" value={query} onChange={setQuery} placeholder="Search incidents" label="Search incidents" />
            <Segmented label="Filter by status" size="xs" value={status} onChange={setStatus} options={[{ id: "all", label: `All (${incidents.length})` }, { id: "active", label: "Active" }, { id: "monitoring", label: "Monitoring" }, { id: "closed", label: "Closed" }]} />
            <span className="ml-auto text-[12.5px] text-muted">{sorted.length} shown</span>
          </div>
          {sorted.length ? (
            <div className="scroll-thin overflow-x-auto rounded-lg border border-line">
              <table aria-label="Incidents" className="w-full border-collapse [&_tbody_tr:last-child_td]:border-b-0">
                <thead><tr><SortableTh sortKey="name" sort={sort} onSort={setSort}>Incident</SortableTh><SortableTh sortKey="severity" sort={sort} onSort={setSort}>Severity</SortableTh><SortableTh sortKey="status" sort={sort} onSort={setSort}>Status</SortableTh><SortableTh sortKey="affected" sort={sort} onSort={setSort} right>Affected</SortableTh><SortableTh sortKey="budget" sort={sort} onSort={setSort} right>Budget</SortableTh><SortableTh sortKey="deadline" sort={sort} onSort={setSort}>Deadline</SortableTh><SortableTh sortKey="progress" sort={sort} onSort={setSort}>Workflow</SortableTh><Th>Actions</Th></tr></thead>
                <tbody>
                  {sorted.map((incident) => {
                    const progress = workflowProgress(runs[incident.id]);
                    return (
                      <tr key={incident.id}>
                        <Td>
                          <Link to={`/incidents/${incident.id}`} className="font-semibold text-accent-text underline-offset-2 hover:underline">{incident.name}</Link>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted"><span className="font-mono">{incident.id}</span><span className="capitalize">{incident.category}</span><span>{incident.location.name}</span>{incident.id === activeId && <Badge tone="accent">Active</Badge>}{incident.simulated && <SimBadge label="Simulated" />}</div>
                        </Td>
                        <Td><SeverityBadge severity={incident.severity} /></Td>
                        <Td><Badge tone={incident.status === "active" ? "ok" : incident.status === "closed" ? "neutral" : "info"}><span className="capitalize">{incident.status}</span></Badge></Td>
                        <Td right>{num(incident.affectedPopulation)}</Td>
                        <Td right>{inr(incident.budget)}</Td>
                        <Td>{time(incident.deadline)}</Td>
                        <Td><div className="w-28"><Meter value={progress.pct} tone={progress.pct === 100 ? "ok" : "accent"} /><div className="mt-1 text-[11.5px] text-muted">{progress.done} of {progress.total} steps</div></div></Td>
                        <Td>
                          <div className="flex flex-wrap gap-1">
                            <Button size="sm" variant="primary" onClick={() => { useStore.getState().setActiveIncident(incident.id); navigate(`/incidents/${incident.id}`); }}>Open</Button>
                            <Button size="sm" onClick={() => setEditing(incident)} disabled={incident.status === "closed"} title="Edit"><Pencil size={12} aria-hidden />Edit</Button>
                            {incident.status === "closed"
                              ? <Button size="sm" onClick={() => setIncidentStatus(incident, "active")}>Reopen</Button>
                              : <Button size="sm" onClick={() => setClosing(incident)}>Close</Button>}
                            <Button size="sm" onClick={() => report(incident, "md")} title="Export the incident report as Markdown"><Download size={12} aria-hidden />Report</Button>
                            <Button size="sm" variant="ghost" onClick={() => report(incident, "json")} title="Export the incident report as JSON">JSON</Button>
                            <Button size="sm" variant="ghost" onClick={() => navigate(`/report/${incident.id}`)} title="Open the printable report (save as PDF)"><Printer size={12} aria-hidden />PDF</Button>
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <Empty title="No incident matches">Clear the search or the status filter.</Empty>}
        </>
      ) : <Empty title="No incidents" action={<Button variant="primary" onClick={() => setCreating(true)}>Create incident</Button>}>Create one to start coordinating a response, run a scenario in the simulator, or use Reset demo to restore the preloaded flood scenario.</Empty>}

      {creating && <IncidentFormDialog onClose={() => setCreating(false)} onSaved={(id) => navigate(`/incidents/${id}`)} />}
      {editing && <IncidentFormDialog incident={editing} onClose={() => setEditing(null)} />}
      {closing && (
        <Modal title={`Close ${closing.id}?`} onClose={() => setClosing(null)} footer={<><Button variant="ghost" onClick={() => setClosing(null)}>Keep it open</Button><Button variant="danger" onClick={() => setIncidentStatus(closing, "closed")}>Close the incident</Button></>}>
          <p className="text-[13.5px] text-ink-2">Closing stops the workflow for <strong>{closing.name}</strong>. Its plan, shipments, receipts and audit entries are kept, and you can reopen it. Reservations and bookings already confirmed with partner sites are not cancelled by closing.</p>
        </Modal>
      )}
    </>
  );
}
