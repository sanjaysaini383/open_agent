// The page object that public/site-actions.js calls: globalThis.__reliefmesh.page.
//
// It is the same set of operations the dashboard's own buttons use, so a model-driven
// agent and a person follow one set of rules. Results are compact summaries (the runtime
// limits an action result to 64 KB) built from the store, never from a model.
import { verifyChain } from "@/domain/audit";
import { overallFulfilmentPct } from "@/domain/allocation";
import { logisticsTotals } from "@/domain/logistics";
import { totalSaving } from "@/domain/negotiation";
import { RESOURCE_IDS, RESOURCES } from "@/domain/resources";
import { needsIntervention, summariseShipments } from "@/domain/shipments";
import { SIMULATED_NOTICE, STEPS } from "@/state/seed";
import { useStore } from "@/state/store";
import type { StepId, WorkflowRun } from "@/state/types";
import { canApprove, decidePlan } from "./execution";
import { runStep } from "./steps";

interface IncidentArgs { incidentId?: string }

function resolveIncident(args: IncidentArgs | undefined): { id: string } | { ok: false; reason: string } {
  const store = useStore.getState();
  const id = args?.incidentId || store.activeIncidentId;
  if (!id) return { ok: false, reason: "There is no active incident. Create one on the Incidents page first." };
  if (!store.incidents.some((incident) => incident.id === id)) return { ok: false, reason: `No incident with id ${id}.` };
  return { id };
}

const envelope = () => ({ simulated: true, dataNotice: SIMULATED_NOTICE });

function links() {
  const out: Record<string, { label: string; page: string }> = {};
  for (const peer of Object.values(useStore.getState().peers)) {
    const name = peer.networkUrl.split("/").pop() || peer.id;
    out[name] = { label: peer.label, page: peer.siteUrl };
  }
  return out;
}

function stepSummary(run: WorkflowRun) {
  return STEPS.map((step) => ({ number: step.number, id: step.id, title: step.title, agent: step.agent, status: run.steps[step.id].status, summary: run.steps[step.id].summary ?? run.steps[step.id].error ?? "" }));
}

function nextStep(run: WorkflowRun): string {
  const next = STEPS.find((step) => !["done", "warning"].includes(run.steps[step.id].status));
  return next ? `${next.number}. ${next.title}` : "All steps complete.";
}

/** A compact, model-readable view of what a step produced. */
function stepResult(step: StepId, run: WorkflowRun): Record<string, unknown> {
  switch (step) {
    case "assess":
      return {
        totals: run.assessment?.totals ?? null,
        shelters: run.assessment?.shelters.map((shelter) => ({ id: shelter.id, name: shelter.name, urgency: shelter.urgency, occupancy: shelter.occupancy })) ?? [],
        topNeeds: run.assessment?.lines.slice(0, 8).map((line) => ({ rank: line.priorityRank, shelter: line.shelterName, resource: RESOURCES[line.resource].label, shortage: line.shortage, required: line.required, urgency: line.urgency, priorityScore: line.priorityScore })) ?? [],
        discrepancies: run.assessment?.discrepancies ?? [],
        source: run.assessment?.source ?? null,
      };
    case "discover":
      return {
        partners: Object.values(useStore.getState().peers).map((peer) => ({
          label: peer.label, role: peer.role, networkUrl: peer.networkUrl, registry: peer.source,
          status: peer.discovery?.status ?? "not contacted", error: peer.discovery?.error,
          frontAgent: peer.discovery?.frontAgent, agents: peer.discovery?.agents.map((agent) => agent.name) ?? [],
          sharedActions: peer.discovery?.actions.map((action) => `${action.name} (${action.effect})`) ?? [],
          capabilities: peer.discovery?.capabilities ?? [],
        })),
        note: "Discovery reports what a site publishes. It does not mean the site is trusted.",
      };
    case "trust": {
      const brief = (item: NonNullable<ReturnType<typeof useStore.getState>["orgTrust"][string]>) => ({
        subject: item.name, subjectId: item.subjectId, decision: item.decision, score: item.score, signatureVerified: item.signatureVerified,
        evidence: item.evidence.map((line) => `${line.label}: ${line.earned}/${line.weight} — ${line.detail}`), warnings: item.warnings, blockers: item.blockers,
      });
      const state = useStore.getState();
      return {
        registry: { pinnedKey: state.settings.registryPin?.fingerprint ?? null, note: "The registry's authority and credentials are simulated. Its signatures are really verified in this browser." },
        partnerNetworks: Object.values(state.peers).filter((peer) => peer.trust).map((peer) => brief(peer.trust!)),
        organizations: Object.values(state.orgTrust).map(brief),
      };
    }
    case "offers":
      return {
        offers: run.offers.map((offer) => ({
          offerId: offer.offerId, supplier: offer.supplierName, resource: RESOURCES[offer.resource].label, quantityAvailable: offer.quantityAvailable,
          unitPrice: offer.unitPrice, listUnitPrice: offer.listUnitPrice, leadTimeHours: offer.leadTimeHours, city: offer.location.city, distanceKm: offer.distanceKm,
          trust: offer.trust, eligible: offer.eligible, rank: offer.rank || null, exclusionReasons: offer.exclusionReasons, flags: offer.flags.map((flag) => `${flag.kind}: ${flag.detail}`),
        })),
        note: "Supplier notes are untrusted text and are not included here.",
      };
    case "negotiate":
      return {
        events: run.negotiation.map((event) => ({ round: event.round, offerId: event.offerId, supplier: event.supplierName, quantity: event.quantity, listUnitPrice: event.listUnitPrice, targetUnitPrice: event.targetUnitPrice, quotedUnitPrice: event.quotedUnitPrice, saving: event.saving, outcome: event.outcome, note: event.note })),
        totalSaving: totalSaving(run.negotiation),
        binding: false,
      };
    case "allocate":
      return {
        planId: run.plan?.id ?? null,
        totalCost: run.plan?.totalCost ?? 0, budget: run.plan?.budget ?? 0, budgetRemaining: run.plan?.budgetRemaining ?? 0,
        fulfilmentPct: run.plan ? overallFulfilmentPct(run.plan) : 0,
        fulfilment: run.plan?.fulfilment ?? null,
        bySupplier: run.plan?.bySupplier ?? [],
        lines: (run.plan?.lines || []).slice().sort((a, b) => b.lineCost - a.lineCost).slice(0, 14).map((line) => ({ shelter: line.shelterName, resource: RESOURCES[line.resource].label, supplier: line.supplierName, quantity: line.quantity, unitPrice: line.unitPrice, lineCost: line.lineCost, deliveryHours: line.deliveryHours, onTime: line.onTime, reasons: line.reasons })),
        lineCount: run.plan?.lines.length ?? 0,
        unfulfilled: run.plan?.unfulfilled ?? [],
        excludedOffers: run.plan?.excludedOffers ?? [],
        notes: run.plan?.notes ?? [], method: run.plan?.method ?? "", validationProblems: run.planProblems,
        status: "Proposal only. Nothing is ordered until a person approves and confirms.",
      };
    case "logistics":
      return {
        routeSource: run.routingSource || "not asked yet",
        totals: logisticsTotals(run.shipmentPlans),
        shipments: run.shipmentPlans.map((item) => ({
          reference: item.reference, from: item.from.label, to: item.to.label, weightKg: item.weightKg, cargo: item.cargo.map((line) => `${line.quantity} ${RESOURCES[line.resource].label.toLowerCase()}`),
          assigned: item.assigned, provider: item.providerName, vehicleType: item.vehicleType, vehicles: item.vehicles, haulKm: item.haulKm, etaHours: item.etaHours, totalHours: item.totalHours,
          cost: item.cost, onTime: item.onTime, reason: item.reason, advisories: item.advisories, alternatives: item.alternatives.slice(0, 2),
        })),
      };
    default:
      return {};
  }
}

export const page = {
  getState() {
    const state = useStore.getState();
    const active = state.incidents.find((incident) => incident.id === state.activeIncidentId) ?? null;
    const run = active ? state.run(active.id) : null;
    return {
      ...envelope(),
      incidents: state.incidents.map((incident) => ({ id: incident.id, name: incident.name, category: incident.category, severity: incident.severity, status: incident.status, location: incident.location.name, affectedPopulation: incident.affectedPopulation, deadline: incident.deadline, budget: incident.budget })),
      activeIncidentId: active?.id ?? null,
      workflow: run ? { steps: stepSummary(run), nextStep: nextStep(run), mode: "Steps run the site's deterministic tools. A person approves the plan and confirms each external write." } : null,
      headline: run ? {
        shortages: run.assessment ? Object.fromEntries(RESOURCE_IDS.map((resource) => [RESOURCES[resource].label, run.assessment!.totals[resource].shortage])) : null,
        planCost: run.plan?.totalCost ?? null,
        fulfilmentPct: run.plan ? overallFulfilmentPct(run.plan) : null,
        shipments: summariseShipments(run.shipments),
        approval: run.approval.status,
        openRisks: run.risks.filter((risk) => risk.severity === "critical" || risk.severity === "high").length,
      } : null,
      pendingAssistanceRequests: state.inbox.filter((item) => item.status === "new").length,
      links: links(),
    };
  },

  /** Run one workflow step. A refusal is returned, not thrown, so the agent can report it. */
  async runStep(step: StepId, args?: IncidentArgs) {
    const target = resolveIncident(args);
    if ("ok" in target) return target;
    const outcome = await runStep(target.id, step);
    const run = useStore.getState().run(target.id);
    if (!outcome.ok) return { ok: false, reason: outcome.reason, step, incidentId: target.id };
    return { ok: true, ...envelope(), incidentId: target.id, step, status: outcome.status, summary: outcome.summary, result: stepResult(step, run), nextStep: nextStep(run) };
  },

  getRisks(args?: IncidentArgs) {
    const target = resolveIncident(args);
    if ("ok" in target) return target;
    const run = useStore.getState().run(target.id);
    return { ...envelope(), incidentId: target.id, hasPlan: !!run.plan, risks: run.risks, scenarios: run.scenarios, note: run.plan ? "Scenarios re-run the allocation engine with one supplier removed." : "No allocation plan yet, so only offer and trust risks are listed." };
  },

  /** Called after the person approved in the browser's own dialog (the runtime owns confirmation). */
  async recordApproval(args?: IncidentArgs) {
    const target = resolveIncident(args);
    if ("ok" in target) return target;
    const result = await decidePlan(target.id, true, "assistant");
    if (!result.ok) return result;
    return { ok: true, incidentId: target.id, status: "approved", next: "The coordinator must now confirm each external write on the incident's Execution panel, in the partner site's own window. You cannot do that for them." };
  },

  /** Read-only check the confirmation dialog uses before it opens. */
  checkApproval(args?: IncidentArgs) {
    const target = resolveIncident(args);
    if ("ok" in target) return target;
    const check = canApprove(useStore.getState().run(target.id));
    return check.ok ? { ok: true, incidentId: target.id } : { ok: false, reason: check.reason };
  },

  getExecution(args?: IncidentArgs) {
    const target = resolveIncident(args);
    if ("ok" in target) return target;
    const run = useStore.getState().run(target.id);
    return {
      ...envelope(), incidentId: target.id,
      approval: { status: run.approval.status, decidedAt: run.approval.decidedAt ?? null, decidedBy: run.approval.decidedBy ?? null, planId: run.approval.planId ?? null },
      reservation: run.reservation, booking: run.booking,
      shipmentCounts: summariseShipments(run.shipments),
      shipments: run.shipments.map((item) => ({ trackingCode: item.trackingCode, from: item.from.label, to: item.to.label, provider: item.providerName, vehicleType: item.vehicleType, status: item.status, deliveryReceipt: item.deliveryReceipt ?? null })),
      deliveries: run.deliveries,
      unfulfilled: run.plan?.unfulfilled ?? [],
      needsIntervention: [
        ...run.shipments.filter(needsIntervention).map((item) => `${item.trackingCode} is ${item.status}`),
        ...run.shipmentPlans.filter((item) => !item.assigned).map((item) => `${item.reference} has no transport: ${item.reason}`),
        ...(run.reservation.status === "unknown" ? ["The reservation's outcome is unknown; check the supplier marketplace."] : []),
        ...(run.booking.status === "unknown" ? ["The booking's outcome is unknown; check the logistics network."] : []),
      ],
    };
  },

  async getAudit(args?: IncidentArgs & { limit?: number }) {
    const state = useStore.getState();
    const limit = Math.min(60, Math.max(1, args?.limit ?? 25));
    const entries = args?.incidentId ? state.audit.filter((entry) => entry.incidentId === args.incidentId) : state.audit;
    const chain = await verifyChain(state.audit);
    return {
      totalEntries: state.audit.length,
      chain: { intact: chain.valid, checked: chain.checked, reason: chain.reason, note: "A hash chain shows the log was not altered after it was written in this browser. It is not a signature." },
      entries: entries.slice(-limit).map((entry) => ({ seq: entry.seq, at: entry.at, kind: entry.kind, actor: entry.actor, incidentId: entry.incidentId, summary: entry.summary })),
    };
  },
};

export type ReliefMeshPage = typeof page;

export function installPage(): void {
  (globalThis as unknown as { __reliefmesh: { page: ReliefMeshPage } }).__reliefmesh = { page };
}
