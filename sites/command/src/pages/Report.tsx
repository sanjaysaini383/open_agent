// The incident report: a print-styled page (the browser's "Save as PDF" is the PDF
// export) with Markdown, JSON and CSV downloads. Everything comes from the store, and the
// report says plainly that the data is simulated.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { Badge, Button, Table, Td, Th, time } from "@/components/ui";
import { overallFulfilmentPct } from "@/domain/allocation";
import { verifyChain } from "@/domain/audit";
import { logisticsTotals } from "@/domain/logistics";
import { inr, num, RESOURCE_IDS, RESOURCES } from "@/domain/resources";
import { STATUS_LABEL } from "@/domain/shipments";
import { deriveAlerts } from "@/lib/alerts";
import { exportIncidentReport, exportPlanCsv, exportShipmentsCsv } from "@/lib/export";
import { SIMULATED_NOTICE, STEPS } from "@/state/seed";
import { useStore } from "@/state/store";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mb-7"><h2 className="mb-2 border-b border-line pb-1 text-[16px] font-semibold">{title}</h2>{children}</section>;
}

export function ReportPage() {
  const { incidentId = "" } = useParams();
  const state = useStore();
  const incident = state.incidents.find((item) => item.id === incidentId);
  const run = state.runs[incidentId];
  const [chain, setChain] = useState<{ valid: boolean; reason: string } | null>(null);
  useEffect(() => { let live = true; void verifyChain(state.audit).then((result) => { if (live) setChain(result); }); return () => { live = false; }; }, [state.audit]);
  useEffect(() => { document.documentElement.dataset.theme = "light"; return () => { const prefs = localStorage.getItem("reliefmesh-ui-prefs"); document.documentElement.dataset.theme = prefs && /"theme":"light"/.test(prefs) ? "light" : "dark"; }; }, []);
  if (!incident || !run) return <div className="p-8"><p>No incident has the id “{incidentId}”.</p><Link to="/incidents" className="underline">Back</Link></div>;

  const plan = run.plan;
  const transport = logisticsTotals(run.shipmentPlans);
  const activity = state.activity.filter((item) => item.incidentId === incident.id);
  const alerts = deriveAlerts(state).filter((alert) => !alert.incidentId || alert.incidentId === incident.id);
  const audit = state.audit.filter((entry) => entry.incidentId === incident.id);
  const exportInput = { incident, run, peers: Object.values(state.peers), orgTrust: state.orgTrust, audit: state.audit };

  return (
    <div className="print-page mx-auto max-w-[960px] bg-surface p-6 text-ink lg:p-10">
      <div className="print-hidden mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 p-3">
        <Link to={`/incidents/${incident.id}`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted hover:text-ink"><ArrowLeft size={14} aria-hidden />Back to the incident</Link>
        <span className="ml-auto flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => window.print()}><Printer size={14} aria-hidden />Print / Save as PDF</Button>
          <Button onClick={() => exportIncidentReport(exportInput, "md")}><Download size={13} aria-hidden />Markdown</Button>
          <Button onClick={() => exportIncidentReport(exportInput, "json")}><Download size={13} aria-hidden />JSON</Button>
          <Button disabled={!plan} onClick={() => exportPlanCsv(incident, run)}><Download size={13} aria-hidden />Allocation CSV</Button>
          <Button disabled={!run.shipmentPlans.length} onClick={() => exportShipmentsCsv(incident, run)}><Download size={13} aria-hidden />Shipments CSV</Button>
        </span>
      </div>

      <header className="mb-6">
        <p className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-accent-text">ReliefMesh Command · incident report</p>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight">{incident.name}</h1>
        <p className="mt-1 text-[13px] text-muted">Generated {new Date().toLocaleString("en-IN")} · {incident.id} · {incident.location.name}</p>
        <p className="mt-3 rounded-md border border-high/40 bg-high-soft px-3 py-2 text-[12.5px] text-high-text">{SIMULATED_NOTICE} Cross-origin calls, signature checks and the audit hash chain are real; the organisations, stock, prices, reservations and shipments are not.</p>
      </header>

      <Section title="1. Incident overview">
        <Table label="Incident overview"><tbody>
          {([["Category", incident.category], ["Severity", incident.severity], ["Status", incident.status], ["Affected population", num(incident.affectedPopulation)], ["Shelters", String(incident.shelterCount)], ["Delivery deadline", time(incident.deadline)], ["Budget", inr(incident.budget)], ["Created", time(incident.createdAt)], ["Notes", incident.notes ?? "—"]] as [string, string][]).map(([key, value]) => <tr key={key}><Td className="w-48 font-semibold text-muted">{key}</Td><Td className="capitalize">{value}</Td></tr>)}
        </tbody></Table>
        <h3 className="mb-1 mt-3 text-[13.5px] font-semibold">Workflow</h3>
        <Table label="Workflow steps"><thead><tr><Th>#</Th><Th>Step</Th><Th>Agent</Th><Th>Status</Th><Th>Result</Th></tr></thead><tbody>{STEPS.map((step) => <tr key={step.id}><Td>{step.number}</Td><Td>{step.title}</Td><Td className="font-mono text-[12px]">{step.agent}</Td><Td><Badge tone={run.steps[step.id].status === "done" ? "ok" : run.steps[step.id].status === "failed" ? "critical" : run.steps[step.id].status === "warning" ? "warn" : "neutral"}>{run.steps[step.id].status}</Badge></Td><Td className="text-[12.5px]">{run.steps[step.id].summary ?? run.steps[step.id].error ?? ""}</Td></tr>)}</tbody></Table>
      </Section>

      <Section title="2. Resource demand">
        {run.assessment ? (
          <Table label="Resource demand"><thead><tr><Th>Resource</Th><Th right>Declared</Th><Th right>Required by shelters</Th><Th right>In stock</Th><Th right>Shortage</Th><Th right>Allocated</Th></tr></thead><tbody>{RESOURCE_IDS.map((id) => { const total = run.assessment!.totals[id]; return <tr key={id}><Td>{RESOURCES[id].label}</Td><Td right>{num(total.declared)}</Td><Td right>{num(total.required)}</Td><Td right>{num(total.inStock)}</Td><Td right>{num(total.shortage)}</Td><Td right>{plan ? num(plan.fulfilment[id].allocated) : "—"}</Td></tr>; })}</tbody></Table>
        ) : <p className="text-[13px] text-muted">No assessment was made.</p>}
        {run.assessment?.discrepancies.length ? <p className="mt-2 text-[12.5px] text-high-text">{run.assessment.discrepancies.join(" ")}</p> : null}
      </Section>

      <Section title="3. Supplier allocation">
        {plan ? (
          <>
            <p className="mb-2 text-[13px]">Plan {plan.id}: {plan.lines.length} lines, {inr(plan.totalCost)} of {inr(plan.budget)}, {overallFulfilmentPct(plan)}% of shortages covered. {plan.method}</p>
            <Table label="Allocation lines"><thead><tr><Th>Shelter</Th><Th>Resource</Th><Th>Supplier</Th><Th right>Quantity</Th><Th right>Unit price</Th><Th right>Cost</Th><Th right>Hours</Th><Th>On time</Th></tr></thead><tbody>{plan.lines.map((line) => <tr key={line.id}><Td>{line.shelterName}</Td><Td>{RESOURCES[line.resource].label}</Td><Td>{line.supplierName}</Td><Td right>{num(line.quantity)}</Td><Td right>{line.unitPrice}</Td><Td right>{inr(line.lineCost)}</Td><Td right>{line.deliveryHours}</Td><Td>{line.onTime ? "yes" : "NO"}</Td></tr>)}</tbody></Table>
            {plan.unfulfilled.length > 0 && <ul className="mt-2 list-disc pl-5 text-[12.5px] text-high-text">{plan.unfulfilled.map((line, index) => <li key={index}>{line.shelterName}: {num(line.quantity)} {RESOURCES[line.resource].label.toLowerCase()} unfulfilled — {line.detail}</li>)}</ul>}
          </>
        ) : <p className="text-[13px] text-muted">No allocation plan was produced.</p>}
      </Section>

      <Section title="4. Logistics plan">
        {run.shipmentPlans.length ? (
          <>
            <p className="mb-2 text-[13px]">{run.shipmentPlans.length} shipments, {num(transport.weightKg)} kg, {transport.assigned} assigned, {transport.late} late, transport {inr(transport.cost)}. Route source: {run.routingSource || "unknown"}.</p>
            <Table label="Shipments"><thead><tr><Th>Reference</Th><Th>Route</Th><Th right>Weight</Th><Th>Provider</Th><Th right>Hours</Th><Th>Tracking</Th><Th>Status</Th></tr></thead><tbody>{run.shipmentPlans.map((item) => { const shipment = run.shipments.find((entry) => entry.reference === item.reference); return <tr key={item.reference}><Td className="font-mono text-[12px]">{item.reference}</Td><Td>{item.supplierName} → {item.shelterName}</Td><Td right>{num(item.weightKg)} kg</Td><Td>{item.assigned ? `${item.providerName}, ${item.vehicles} × ${item.vehicleType?.replace(/_/g, " ")}` : "none"}</Td><Td right>{item.totalHours ?? "—"}{item.assigned && !item.onTime ? " (late)" : ""}</Td><Td className="font-mono text-[12px]">{shipment?.trackingCode ?? "—"}</Td><Td>{shipment ? STATUS_LABEL[shipment.status] : item.assigned ? "not booked" : "no transport"}</Td></tr>; })}</tbody></Table>
          </>
        ) : <p className="text-[13px] text-muted">No transport plan was produced.</p>}
      </Section>

      <Section title="5. Agent activity">
        {activity.length ? <Table label="Agent activity"><thead><tr><Th>Time</Th><Th>Agent</Th><Th>Task</Th><Th>Mode</Th><Th>Networks</Th><Th>Status</Th><Th>Result</Th></tr></thead><tbody>{activity.slice(-40).map((item) => <tr key={item.id}><Td className="whitespace-nowrap">{time(item.at)}</Td><Td className="font-mono text-[12px]">{item.agent}</Td><Td>{item.task}</Td><Td>{item.mode === "llm" ? "model-driven" : "direct tool"}</Td><Td>{item.networks.join(", ")}</Td><Td>{item.status}</Td><Td className="text-[12.5px]">{item.output}</Td></tr>)}</tbody></Table> : <p className="text-[13px] text-muted">No agent activity recorded.</p>}
      </Section>

      <Section title="6. Pending issues">
        {alerts.length || run.risks.length ? (
          <ul className="list-disc pl-5 text-[13px]">
            {alerts.map((alert) => <li key={alert.id}><strong className="uppercase">{alert.severity}</strong> {alert.title}. {alert.detail}</li>)}
            {run.risks.map((risk) => <li key={risk.id}><strong className="uppercase">{risk.severity} risk</strong> {risk.title}. {risk.detail} <em>{risk.recommendation}</em></li>)}
          </ul>
        ) : <p className="text-[13px] text-muted">No open alerts or risks.</p>}
      </Section>

      <Section title="7. Final outcomes">
        <Table label="Outcomes"><tbody>
          <tr><Td className="w-48 font-semibold text-muted">Approval</Td><Td>{run.approval.status}{run.approval.decidedAt ? ` by ${run.approval.decidedBy} at ${time(run.approval.decidedAt)} (${run.approval.via})` : ""}{run.approval.note ? ` — "${run.approval.note}"` : ""}</Td></tr>
          <tr><Td className="font-semibold text-muted">Approved plan digest</Td><Td className="break-all font-mono text-[11.5px]">{run.approval.digest ?? "—"}</Td></tr>
          <tr><Td className="font-semibold text-muted">Supplier reservation</Td><Td>{run.reservation.status}{run.reservation.reference ? ` (${run.reservation.reference}, ${time(run.reservation.at)})` : ""}</Td></tr>
          <tr><Td className="font-semibold text-muted">Transport booking</Td><Td>{run.booking.status}{run.booking.reference ? ` (${run.booking.reference}, ${time(run.booking.at)})` : ""}</Td></tr>
          <tr><Td className="font-semibold text-muted">Shipments delivered</Td><Td>{run.shipments.filter((item) => item.status === "delivered").length} of {run.shipments.length}</Td></tr>
          <tr><Td className="font-semibold text-muted">Delivery receipts</Td><Td>{run.deliveries.map((item) => `${item.reference} (${item.lines} lines)`).join(", ") || "none"}</Td></tr>
          <tr><Td className="font-semibold text-muted">Audit trail</Td><Td>{audit.length} entries for this incident · hash chain {chain ? (chain.valid ? "intact" : "BROKEN") : "checking…"}{chain ? ` — ${chain.reason}` : ""}</Td></tr>
        </tbody></Table>
      </Section>
      <p className="text-[11.5px] text-muted">The hash chain shows the log was not altered after it was written in this browser; it is not a signature. Signatures on partner attestations were verified with ECDSA P-256 in the browser where noted in the Trust &amp; Verification page.</p>
    </div>
  );
}
