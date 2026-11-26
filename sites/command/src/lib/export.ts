// Exports: incident report (Markdown and JSON) and audit history (JSON and CSV).
// Everything is built from the store. A report says plainly that the data is simulated.
import { auditToCsv, verifyChain } from "@/domain/audit";
import { overallFulfilmentPct } from "@/domain/allocation";
import { logisticsTotals } from "@/domain/logistics";
import { totalSaving } from "@/domain/negotiation";
import { inr, num, RESOURCE_IDS, RESOURCES } from "@/domain/resources";
import { STATUS_LABEL } from "@/domain/shipments";
import type { AuditEntry, Incident } from "@/domain/types";
import { SIMULATED_NOTICE, STEPS } from "@/state/seed";
import type { PeerRecord, WorkflowRun } from "@/state/types";
import type { TrustEvaluation } from "@/domain/types";

export function download(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
const cell = (value: unknown) => String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

export function incidentReportMarkdown(input: { incident: Incident; run: WorkflowRun; peers: PeerRecord[]; orgTrust: Record<string, TrustEvaluation>; audit: AuditEntry[]; chain: { valid: boolean; reason: string } }): string {
  const { incident, run, peers, orgTrust, audit, chain } = input;
  const lines: string[] = [];
  const push = (...text: string[]) => lines.push(...text);
  push(`# Incident report: ${incident.name}`, "", `> ${SIMULATED_NOTICE}`, "", `Generated ${new Date().toISOString()} by ReliefMesh Command.`, "");
  push("## Incident", "", "| | |", "| --- | --- |",
    `| Id | ${incident.id} |`, `| Category | ${incident.category} |`, `| Severity | ${incident.severity} |`, `| Status | ${incident.status} |`,
    `| Location | ${cell(incident.location.name)} (${incident.location.lat}, ${incident.location.lng}) |`,
    `| Affected population | ${num(incident.affectedPopulation)} |`, `| Shelters | ${incident.shelterCount} |`,
    `| Delivery deadline | ${incident.deadline} |`, `| Budget | ${inr(incident.budget)} |`, "");

  push("## Workflow", "", "| # | Step | Agent | Status | Result |", "| --- | --- | --- | --- | --- |");
  for (const step of STEPS) push(`| ${step.number} | ${step.title} | ${step.agent} | ${run.steps[step.id].status} | ${cell(run.steps[step.id].summary ?? run.steps[step.id].error ?? "")} |`);
  push("");

  if (run.assessment) {
    push("## Needs assessment", "", `Source: ${run.assessment.source.label} (${run.assessment.source.networkUrl})`, "", "| Resource | Declared | Required | In stock | Shortage |", "| --- | ---: | ---: | ---: | ---: |");
    for (const resource of RESOURCE_IDS) { const total = run.assessment.totals[resource]; push(`| ${RESOURCES[resource].label} | ${num(total.declared)} | ${num(total.required)} | ${num(total.inStock)} | ${num(total.shortage)} |`); }
    push("");
  }

  push("## Partner networks and trust", "", "| Partner | Role | Network URL | Connection | Trust | Score | Signature verified |", "| --- | --- | --- | --- | --- | ---: | --- |");
  for (const peer of peers) push(`| ${cell(peer.label)} | ${peer.role} | ${peer.networkUrl} | ${peer.discovery?.status ?? "not contacted"} | ${peer.role === "trust" ? "trust anchor (pinned key)" : peer.trust?.decision ?? "not checked"} | ${peer.trust?.score ?? ""} | ${peer.trust ? (peer.trust.signatureVerified ? "yes" : "no") : ""} |`);
  push("", "| Organisation | Decision | Score | Signature verified | Notes |", "| --- | --- | ---: | --- | --- |");
  for (const evaluation of Object.values(orgTrust)) push(`| ${cell(evaluation.name)} | ${evaluation.decision} | ${evaluation.score} | ${evaluation.signatureVerified ? "yes" : "no"} | ${cell([...evaluation.blockers, ...evaluation.warnings].join(" "))} |`);
  push("", "The registry's authority and credentials are simulated. Signatures marked \"yes\" were verified with ECDSA P-256 in the browser.", "");

  if (run.negotiation.length) {
    push("## Negotiation", "", `Total saving against list prices: ${inr(totalSaving(run.negotiation))}. Quotes are non-binding.`, "", "| Round | Offer | Supplier | Quantity | List | Target | Quoted | Outcome |", "| ---: | --- | --- | ---: | ---: | ---: | ---: | --- |");
    for (const event of run.negotiation) push(`| ${event.round} | ${event.offerId} | ${cell(event.supplierName)} | ${num(event.quantity)} | ${event.listUnitPrice} | ${event.targetUnitPrice} | ${event.quotedUnitPrice ?? ""} | ${event.outcome} |`);
    push("");
  }

  if (run.plan) {
    push("## Allocation plan", "", `Plan ${run.plan.id}. ${run.plan.method}`, "", `Cost ${inr(run.plan.totalCost)} of ${inr(run.plan.budget)}. ${overallFulfilmentPct(run.plan)}% of shortages covered.`, "", "| Shelter | Resource | Supplier | Quantity | Unit price | Cost | Hours | On time |", "| --- | --- | --- | ---: | ---: | ---: | ---: | --- |");
    for (const line of run.plan.lines) push(`| ${cell(line.shelterName)} | ${RESOURCES[line.resource].label} | ${cell(line.supplierName)} | ${num(line.quantity)} | ${line.unitPrice} | ${inr(line.lineCost)} | ${line.deliveryHours} | ${line.onTime ? "yes" : "NO"} |`);
    if (run.plan.unfulfilled.length) { push("", "Unfulfilled:", ""); for (const line of run.plan.unfulfilled) push(`- ${line.shelterName}: ${num(line.quantity)} ${RESOURCES[line.resource].label.toLowerCase()} — ${line.detail}`); }
    if (run.plan.notes.length) { push("", "Notes:", ""); for (const note of run.plan.notes) push(`- ${note}`); }
    push("");
  }

  if (run.shipmentPlans.length) {
    const totals = logisticsTotals(run.shipmentPlans);
    push("## Logistics", "", `Route source: ${run.routingSource || "unknown"}. Transport cost ${inr(totals.cost)}.`, "", "| Reference | Route | Weight kg | Provider | Vehicle | Hours | On time | Tracking | Status |", "| --- | --- | ---: | --- | --- | ---: | --- | --- | --- |");
    for (const plan of run.shipmentPlans) {
      const shipment = run.shipments.find((item) => item.reference === plan.reference);
      push(`| ${plan.reference} | ${cell(plan.supplierName)} → ${cell(plan.shelterName)} | ${plan.weightKg} | ${cell(plan.providerName ?? "none")} | ${plan.vehicles ? `${plan.vehicles} × ${plan.vehicleType}` : ""} | ${plan.totalHours ?? ""} | ${plan.assigned ? (plan.onTime ? "yes" : "NO") : ""} | ${shipment?.trackingCode ?? ""} | ${shipment ? STATUS_LABEL[shipment.status] : plan.assigned ? "not booked" : "no transport"} |`);
    }
    push("");
  }

  push("## Approval and execution", "", "| | |", "| --- | --- |",
    `| Approval | ${run.approval.status}${run.approval.decidedAt ? ` by ${run.approval.decidedBy} at ${run.approval.decidedAt}` : ""} |`,
    `| Approved plan digest | ${run.approval.digest ?? "—"} |`,
    `| Supplier reservation | ${run.reservation.status}${run.reservation.reference ? ` (${run.reservation.reference})` : ""} |`,
    `| Shipment booking | ${run.booking.status}${run.booking.reference ? ` (${run.booking.reference})` : ""} |`,
    `| Delivery receipts | ${run.deliveries.map((item) => item.reference).join(", ") || "none"} |`, "");

  if (run.risks.length) { push("## Risks", ""); for (const risk of run.risks) push(`- **${risk.severity.toUpperCase()}** ${risk.title}. ${risk.detail} _${risk.recommendation}_`); push(""); }

  const mine = audit.filter((entry) => entry.incidentId === incident.id);
  push("## Audit trail", "", `Hash chain: ${chain.valid ? "intact" : "BROKEN"} — ${chain.reason}`, "", "| Seq | Time | Kind | Actor | Summary |", "| ---: | --- | --- | --- | --- |");
  for (const entry of mine) push(`| ${entry.seq} | ${entry.at} | ${entry.kind} | ${cell(entry.actor)} | ${cell(entry.summary)} |`);
  push("");
  return lines.join("\n");
}

export async function exportIncidentReport(input: { incident: Incident; run: WorkflowRun; peers: PeerRecord[]; orgTrust: Record<string, TrustEvaluation>; audit: AuditEntry[] }, format: "md" | "json"): Promise<void> {
  const chain = await verifyChain(input.audit);
  const name = `reliefmesh-${input.incident.id}-${stamp()}`;
  if (format === "md") {
    download(`${name}.md`, incidentReportMarkdown({ ...input, chain }), "text/markdown;charset=utf-8");
  } else {
    download(`${name}.json`, JSON.stringify({
      notice: SIMULATED_NOTICE, generatedAt: new Date().toISOString(), incident: input.incident, run: input.run,
      partners: input.peers, organizationTrust: input.orgTrust,
      audit: { chain, entries: input.audit.filter((entry) => entry.incidentId === input.incident.id) },
    }, null, 2), "application/json");
  }
}

export async function exportAudit(audit: AuditEntry[], format: "json" | "csv"): Promise<void> {
  const name = `reliefmesh-audit-${stamp()}`;
  if (format === "csv") { download(`${name}.csv`, auditToCsv(audit), "text/csv;charset=utf-8"); return; }
  download(`${name}.json`, JSON.stringify({ notice: SIMULATED_NOTICE, exportedAt: new Date().toISOString(), chain: await verifyChain(audit), entries: audit }, null, 2), "application/json");
}
