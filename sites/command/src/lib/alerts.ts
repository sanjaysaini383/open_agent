// The alert centre. Every alert is derived from the persisted state at render time:
// shortages the plan leaves open, shipments that are late or stuck, partners that could
// not be verified or reached, writes whose outcome is unknown, and anything waiting for a
// person. Nothing here is invented; if the state has no problem, the list is empty.
import { num, RESOURCES } from "@/domain/resources";
import { needsIntervention } from "@/domain/shipments";
import { canApprove } from "@/workflow/execution";
import type { PersistedState, WorkflowRun } from "@/state/types";
import { STEPS } from "@/state/seed";

export type AlertSeverity = "critical" | "warning" | "info";
export type AlertCategory = "shortage" | "delivery" | "trust" | "network" | "approval" | "request" | "workflow" | "security";

export interface Alert {
  id: string;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  detail: string;
  /** Where to act on it. */
  to: string;
  at?: string;
  incidentId?: string | null;
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

function runAlerts(state: PersistedState, run: WorkflowRun): Alert[] {
  const incident = state.incidents.find((item) => item.id === run.incidentId);
  if (!incident || incident.status === "closed") return [];
  const alerts: Alert[] = [];
  const id = run.incidentId;
  const page = `/incidents/${id}`;

  if (run.plan && run.plan.unfulfilled.length) {
    const units = run.plan.unfulfilled.reduce((sum, line) => sum + line.quantity, 0);
    alerts.push({ id: `${id}:unfulfilled`, severity: "critical", category: "shortage", title: `${num(units)} units of demand are unfulfilled`, detail: run.plan.unfulfilled.slice(0, 3).map((line) => `${line.shelterName}: ${num(line.quantity)} ${RESOURCES[line.resource].label.toLowerCase()}`).join("; "), to: "/allocation", at: run.plan.generatedAt, incidentId: id });
  } else if (run.assessment && !run.plan) {
    const short = Object.values(run.assessment.totals).reduce((sum, total) => sum + total.shortage, 0);
    if (short > 0) alerts.push({ id: `${id}:shortage`, severity: run.steps.allocate.status === "running" ? "info" : "warning", category: "shortage", title: `${num(short)} units short across ${run.assessment.shelters.length} shelters`, detail: "Assessed from ShelterConnect; no allocation plan covers it yet.", to: "/requests", at: run.assessment.generatedAt, incidentId: id });
  }

  for (const plan of run.shipmentPlans) {
    if (!plan.assigned) alerts.push({ id: `${id}:notransport:${plan.reference}`, severity: "critical", category: "delivery", title: `No transport for ${plan.supplierName} → ${plan.shelterName}`, detail: plan.reason, to: "/logistics", incidentId: id });
    else if (!plan.onTime && !run.shipments.some((item) => item.reference === plan.reference && item.status === "delivered")) alerts.push({ id: `${id}:late:${plan.reference}`, severity: "warning", category: "delivery", title: `${plan.shelterName} delivery arrives after the deadline`, detail: `${plan.totalHours} h door to door with ${plan.providerName}.`, to: "/logistics", incidentId: id });
  }
  for (const shipment of run.shipments) {
    if (needsIntervention(shipment)) alerts.push({ id: `${id}:shipment:${shipment.trackingCode}`, severity: shipment.status === "failed" ? "critical" : "warning", category: "delivery", title: `Shipment ${shipment.trackingCode} is ${shipment.status}`, detail: `${shipment.supplierName} → ${shipment.shelterName}, ${shipment.providerName}.`, to: "/logistics", at: shipment.history[shipment.history.length - 1]?.at, incidentId: id });
  }

  if (canApprove(run).ok && run.approval.status === "none") {
    alerts.push({ id: `${id}:approval`, severity: "warning", category: "approval", title: "A response plan is waiting for your approval", detail: `${run.plan!.lines.length} allocation lines, ${run.shipmentPlans.length} shipments. Nothing is written to any partner until you decide.`, to: "/approvals", at: run.plan!.generatedAt, incidentId: id });
  }
  if (run.approval.status === "approved" && run.reservation.status === "none") alerts.push({ id: `${id}:reserve`, severity: "info", category: "approval", title: "Stock reservation needs your confirmation", detail: "Confirm it in the supplier marketplace's own window.", to: "/approvals", incidentId: id });
  if (run.reservation.status === "confirmed" && run.booking.status === "none") alerts.push({ id: `${id}:book`, severity: "info", category: "approval", title: "Transport booking needs your confirmation", detail: "Confirm it in the logistics network's own window.", to: "/approvals", incidentId: id });
  for (const [which, write] of [["reservation", run.reservation], ["booking", run.booking]] as const) {
    if (write.status === "unknown") alerts.push({ id: `${id}:${which}:unknown`, severity: "critical", category: "approval", title: `The ${which}'s outcome is unknown`, detail: write.error || "Check the partner site before trying again.", to: page, incidentId: id });
  }
  const undelivered = run.shipments.filter((item) => item.status === "delivered" && !item.deliveryReceipt).length;
  if (undelivered) alerts.push({ id: `${id}:receipts`, severity: "info", category: "approval", title: `${undelivered} delivery receipt${undelivered === 1 ? "" : "s"} to record at the shelter`, detail: "The shelter confirms receipt in ShelterConnect's own window; only then does its stock change.", to: "/approvals", incidentId: id });

  for (const step of STEPS) {
    const state = run.steps[step.id];
    if (state.status === "failed") alerts.push({ id: `${id}:step:${step.id}`, severity: "warning", category: "workflow", title: `Step ${step.number} did not complete: ${step.title}`, detail: state.error || "", to: page, at: state.endedAt, incidentId: id });
  }

  const excluded = run.offers.filter((offer) => !offer.eligible && offer.flags.some((flag) => flag.severity === "critical"));
  if (excluded.length) alerts.push({ id: `${id}:hostile`, severity: "warning", category: "security", title: `${excluded.length} supplier offer${excluded.length === 1 ? "" : "s"} excluded for suspicious content`, detail: excluded.map((offer) => `${offer.supplierName}: ${offer.flags.find((flag) => flag.severity === "critical")?.detail}`).join(" ").slice(0, 220), to: "/marketplace", incidentId: id });

  for (const risk of run.risks.filter((item) => item.severity === "critical")) {
    if (risk.category === "shortage" || risk.category === "delivery" || risk.category === "supplier") continue; // covered above with more precision
    alerts.push({ id: `${id}:risk:${risk.id}`, severity: "warning", category: risk.category === "trust" ? "trust" : "shortage", title: risk.title, detail: risk.detail, to: page, incidentId: id });
  }
  return alerts;
}

export function deriveAlerts(state: PersistedState): Alert[] {
  const alerts: Alert[] = [];
  if (state.settings.registryMismatch) alerts.push({ id: "registry:mismatch", severity: "critical", category: "security", title: "The trust registry presented a different signing key", detail: "Verification is blocked until a person reviews the new key in Settings.", to: "/settings", at: state.settings.registryMismatch.seenAt });

  for (const peer of Object.values(state.peers)) {
    if (peer.trust?.decision === "blocked") alerts.push({ id: `peer:${peer.id}:blocked`, severity: "critical", category: "trust", title: `${peer.label} is blocked by the trust registry`, detail: peer.trust.blockers.join(" "), to: "/trust", at: peer.trust.evaluatedAt });
    else if (peer.trust?.decision === "unverified" && !peer.overridden) alerts.push({ id: `peer:${peer.id}:unverified`, severity: "warning", category: "trust", title: `${peer.label} could not be verified`, detail: [...peer.trust.blockers, ...peer.trust.warnings].join(" ") || "No registry record.", to: "/trust", at: peer.trust.evaluatedAt });
    if (peer.discovery?.status === "failed") alerts.push({ id: `peer:${peer.id}:failed`, severity: "warning", category: "network", title: `${peer.label} could not be loaded`, detail: peer.discovery.error || "", to: "/network", at: peer.discovery.at });
    if (peer.discovery?.status === "policy-refused") alerts.push({ id: `peer:${peer.id}:policy`, severity: "warning", category: "network", title: `${peer.label} is outside allowed_peers`, detail: peer.discovery.error || "", to: "/network", at: peer.discovery.at });
  }
  const lastByPeer = new Map<string, (typeof state.interactions)[number]>();
  for (const item of state.interactions) if (item.kind !== "consent") lastByPeer.set(item.to, item);
  for (const [peerId, last] of lastByPeer) {
    if (last.status === "failed" || last.status === "refused") alerts.push({ id: `net:${peerId}:${last.id}`, severity: "warning", category: "network", title: `Last request to ${state.peers[peerId]?.label ?? peerId} failed`, detail: `${last.label}: ${last.detail || last.status}`, to: "/network", at: last.at });
  }
  for (const evaluation of Object.values(state.orgTrust)) {
    if (evaluation.decision === "blocked") alerts.push({ id: `org:${evaluation.subjectId}`, severity: "warning", category: "trust", title: `${evaluation.name} is blocked`, detail: evaluation.blockers.join(" "), to: "/trust", at: evaluation.evaluatedAt });
  }
  const requests = state.inbox.filter((item) => item.status === "new");
  if (requests.length) alerts.push({ id: `inbox:${requests.map((item) => item.reference).join(",")}`, severity: requests.some((item) => item.urgency === "critical") ? "warning" : "info", category: "request", title: `${requests.length} assistance request${requests.length === 1 ? "" : "s"} from partner sites`, detail: requests.slice(0, 2).map((item) => `${item.organization}: ${item.summary}`).join(" "), to: "/requests", at: requests[requests.length - 1].receivedAt });

  for (const run of Object.values(state.runs)) alerts.push(...runAlerts(state, run));
  return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (b.at || "").localeCompare(a.at || ""));
}
