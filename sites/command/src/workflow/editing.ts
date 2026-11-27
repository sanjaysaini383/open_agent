// The allocation editor's logic: build the engine's input from a run, turn a person's
// edited quantities into a plan with the same shape the engine produces, re-check every
// invariant with the engine's own validator, and apply the result. A plan that fails
// validation is never stored.
import { allocate, laneKey, validateAllocation, type AllocationInput } from "@/domain/allocation";
import { estimateTransitHours } from "@/domain/geo";
import { emptyResourceRecord, inr, RESOURCES, round1, round2 } from "@/domain/resources";
import type { AllocationLine, AllocationPlan, Incident, LaneInfo, ResourceId, UnfulfilledLine } from "@/domain/types";
import { useStore } from "@/state/store";
import { useUi } from "@/state/ui";
import type { WorkflowRun } from "@/state/types";
import { needsFromAssessment, supplierPoints, toAllocationOffers } from "./steps";

export interface EditLine { shelterId: string; resource: ResourceId; offerId: string; quantity: number }

export function inputFromRun(incident: Incident, run: WorkflowRun): AllocationInput | null {
  if (!run.assessment || !run.offers.length) return null;
  let lanes: Record<string, LaneInfo> = run.lanes;
  if (!Object.keys(lanes).length) {
    lanes = {};
    const shelters = Object.fromEntries(run.assessment.shelters.map((shelter) => [shelter.id, shelter.location]));
    for (const [supplierId, from] of Object.entries(supplierPoints(run.offers))) {
      for (const [shelterId, to] of Object.entries(shelters)) lanes[laneKey(supplierId, shelterId)] = { feasible: true, transitHours: estimateTransitHours(from, to), source: "estimate", note: "Transit time is ReliefMesh's own estimate." };
    }
  }
  return { incidentId: incident.id, needs: needsFromAssessment(run.assessment), offers: toAllocationOffers(run.offers), lanes, budget: incident.budget, version: (run.plan?.version || 0) + 1, now: new Date() };
}

export function linesFromPlan(plan: AllocationPlan | null): EditLine[] {
  return (plan?.lines ?? []).map((line) => ({ shelterId: line.shelterId, resource: line.resource, offerId: line.offerId, quantity: line.quantity }));
}

/** A plan from edited quantities, in the engine's shape, with the same derived fields. */
export function buildEditedPlan(input: AllocationInput, edits: EditLine[], base: AllocationPlan | null): AllocationPlan {
  const offers = new Map(input.offers.map((offer) => [offer.offerId, offer]));
  const needs = new Map(input.needs.map((need) => [`${need.shelterId}:${need.resource}`, need]));
  const lines: AllocationLine[] = [];
  for (const edit of edits) {
    const quantity = Number.isFinite(edit.quantity) ? Math.max(0, Math.floor(edit.quantity)) : 0;
    const offer = offers.get(edit.offerId);
    const need = needs.get(`${edit.shelterId}:${edit.resource}`);
    if (!offer || !need || quantity <= 0) continue;
    const lane = input.lanes[laneKey(offer.supplierId, need.shelterId)];
    const hours = lane?.feasible ? round1(offer.leadTimeHours + lane.transitHours) : Infinity;
    const existing = lines.find((line) => line.offerId === edit.offerId && line.shelterId === edit.shelterId && line.resource === edit.resource);
    if (existing) { existing.quantity += quantity; existing.lineCost = round2(existing.quantity * existing.unitPrice); continue; }
    const previous = base?.lines.find((line) => line.offerId === edit.offerId && line.shelterId === edit.shelterId && line.resource === edit.resource);
    lines.push({
      id: `${need.shelterId}:${need.resource}:${offer.offerId}`,
      shelterId: need.shelterId, shelterName: need.shelterName, resource: need.resource,
      offerId: offer.offerId, supplierId: offer.supplierId, supplierName: offer.supplierName,
      quantity, unitPrice: offer.unitPrice, lineCost: round2(quantity * offer.unitPrice),
      deliveryHours: Number.isFinite(hours) ? hours : 0,
      onTime: hours <= need.hoursToDeadline,
      reasons: [
        previous && previous.quantity === quantity ? "Unchanged from the engine's plan." : `Set by the coordinator${previous ? ` (engine proposed ${previous.quantity})` : " (not in the engine's plan)"}.`,
        `${offer.unitPrice < offer.listUnitPrice ? `Negotiated ₹${offer.unitPrice} per unit, down from ₹${offer.listUnitPrice} list.` : `₹${offer.unitPrice} per unit (list price).`}`,
        Number.isFinite(hours) ? (hours <= need.hoursToDeadline ? `${hours} h door to door, inside the ${need.hoursToDeadline} h deadline.` : `LATE: ${hours} h door to door against a ${need.hoursToDeadline} h deadline.`) : "No feasible route for this lane.",
      ],
    });
  }
  const unfulfilled: UnfulfilledLine[] = [];
  for (const need of input.needs) {
    const got = lines.filter((line) => line.shelterId === need.shelterId && line.resource === need.resource).reduce((sum, line) => sum + line.quantity, 0);
    const missing = Math.floor(need.shortage) - got;
    if (missing > 0) unfulfilled.push({ shelterId: need.shelterId, shelterName: need.shelterName, resource: need.resource, quantity: missing, reason: "no_supply", detail: "Left unallocated in the coordinator's edit." });
  }
  const totalCost = round2(lines.reduce((sum, line) => sum + line.lineCost, 0));
  const fulfilment = emptyResourceRecord((resource) => {
    const shortage = input.needs.filter((need) => need.resource === resource).reduce((sum, need) => sum + Math.floor(need.shortage), 0);
    const allocated = lines.filter((line) => line.resource === resource).reduce((sum, line) => sum + line.quantity, 0);
    return { shortage, allocated, pct: shortage > 0 ? round1((allocated / shortage) * 100) : 100 };
  });
  const supplierMap = new Map<string, { supplierId: string; supplierName: string; cost: number; units: number }>();
  for (const line of lines) {
    const entry = supplierMap.get(line.supplierId) || { supplierId: line.supplierId, supplierName: line.supplierName, cost: 0, units: 0 };
    entry.cost = round2(entry.cost + line.lineCost); entry.units += line.quantity; supplierMap.set(line.supplierId, entry);
  }
  const version = input.version || 1;
  const late = lines.filter((line) => !line.onTime).length;
  return {
    id: `${input.incidentId}-plan-v${version}`, incidentId: input.incidentId, generatedAt: input.now.toISOString(), version,
    lines, unfulfilled, totalCost, budget: input.budget, budgetRemaining: round2(input.budget - totalCost),
    estimatedCompletionHours: lines.length ? Math.max(...lines.map((line) => line.deliveryHours)) : 0,
    fulfilment, bySupplier: [...supplierMap.values()].sort((a, b) => b.cost - a.cost),
    excludedOffers: input.offers.filter((offer) => !offer.eligible).map((offer) => ({ offerId: offer.offerId, supplierName: offer.supplierName, reasons: offer.exclusionReasons })),
    weights: base?.weights ?? { cost: 0.5, time: 0.3, trust: 0.2 },
    method: `Edited by the coordinator${base ? ` from the engine's plan v${base.version}` : ""}; every invariant re-checked by the engine's validator before it was stored.`,
    notes: [...(late ? [`${late} allocation line(s) are expected after the deadline.`] : []), ...(unfulfilled.length ? ["Some demand is left unallocated by this edit."] : [])],
  };
}

export interface PlanSummary {
  cost: number; budget: number; budgetRemaining: number; coveragePct: number; allocatedUnits: number; unfulfilledUnits: number; late: number;
  remainingByOffer: { offerId: string; supplierName: string; resource: ResourceId; available: number; used: number; remaining: number; minOrder: number; unitPrice: number; eligible: boolean }[];
  shelters: { shelterId: string; shelterName: string; shortage: number; allocated: number; pct: number }[];
}

export function summarise(input: AllocationInput, plan: AllocationPlan): PlanSummary {
  const used = new Map<string, number>();
  for (const line of plan.lines) used.set(line.offerId, (used.get(line.offerId) || 0) + line.quantity);
  const shortage = input.needs.reduce((sum, need) => sum + Math.floor(need.shortage), 0);
  const allocated = plan.lines.reduce((sum, line) => sum + line.quantity, 0);
  const shelterIds = [...new Set(input.needs.map((need) => need.shelterId))];
  return {
    cost: plan.totalCost, budget: input.budget, budgetRemaining: round2(input.budget - plan.totalCost),
    coveragePct: shortage > 0 ? round1((Math.min(allocated, shortage) / shortage) * 100) : 100,
    allocatedUnits: allocated, unfulfilledUnits: plan.unfulfilled.reduce((sum, line) => sum + line.quantity, 0), late: plan.lines.filter((line) => !line.onTime).length,
    remainingByOffer: input.offers.map((offer) => ({ offerId: offer.offerId, supplierName: offer.supplierName, resource: offer.resource, available: offer.quantityAvailable, used: used.get(offer.offerId) || 0, remaining: offer.quantityAvailable - (used.get(offer.offerId) || 0), minOrder: offer.minOrder, unitPrice: offer.unitPrice, eligible: offer.eligible })),
    shelters: shelterIds.map((shelterId) => {
      const needs = input.needs.filter((need) => need.shelterId === shelterId);
      const want = needs.reduce((sum, need) => sum + Math.floor(need.shortage), 0);
      const got = plan.lines.filter((line) => line.shelterId === shelterId).reduce((sum, line) => sum + line.quantity, 0);
      return { shelterId, shelterName: needs[0]?.shelterName ?? shelterId, shortage: want, allocated: got, pct: want > 0 ? round1((Math.min(got, want) / want) * 100) : 100 };
    }),
  };
}

export function validate(input: AllocationInput, plan: AllocationPlan): string[] {
  return validateAllocation(input, plan);
}

export function optimise(input: AllocationInput, weights?: { cost: number; time: number; trust: number }): AllocationPlan {
  return allocate(weights ? { ...input, weights } : input);
}

export function canEditPlan(run: WorkflowRun): { ok: boolean; reason: string } {
  if (!run.assessment) return { ok: false, reason: "Assess the requirements first (step 2)." };
  if (!run.offers.length) return { ok: false, reason: "Collect supplier offers first (step 5)." };
  if (run.reservation.status === "confirmed" || run.reservation.status === "pending" || run.booking.status === "confirmed" || run.booking.status === "pending") return { ok: false, reason: "Stock or transport for this incident was already confirmed with a partner. Create a new incident to plan again." };
  return { ok: true, reason: "" };
}

/** Store a person's plan. The validator ran already; it runs once more here so nothing unsound is stored. */
export async function applyPlan(incidentId: string, input: AllocationInput, plan: AllocationPlan, how: "edited" | "reweighted"): Promise<{ ok: boolean; reason?: string }> {
  const store = useStore.getState();
  const run = store.run(incidentId);
  const editable = canEditPlan(run);
  if (!editable.ok) return { ok: false, reason: editable.reason };
  const problems = validateAllocation(input, plan);
  if (problems.length) return { ok: false, reason: `The plan fails validation and was not stored: ${problems.join(" ")}` };
  // Transport and approval were for the previous plan: they must be redone.
  store.patchRun(incidentId, { plan, planProblems: [], shipmentPlans: [], optionsByLane: {}, approval: { status: "none" }, scenarios: [] });
  for (const step of ["logistics", "approval", "execute"] as const) store.setStep(incidentId, step, { status: "idle", summary: undefined, error: undefined, startedAt: undefined, endedAt: undefined });
  store.setStep(incidentId, "allocate", { status: plan.unfulfilled.length || plan.lines.some((line) => !line.onTime) ? "warning" : "done", endedAt: new Date().toISOString(), summary: `${how === "edited" ? "Edited by the coordinator" : "Re-optimised with the coordinator's weights"}: ${plan.lines.length} lines, ${inr(plan.totalCost)} of ${inr(plan.budget)}, ${plan.unfulfilled.reduce((sum, line) => sum + line.quantity, 0)} units unfulfilled. Validated.` });
  await store.record({
    kind: "allocation", actor: "human:coordinator", incidentId,
    summary: `Allocation plan v${plan.version} ${how === "edited" ? "edited by the coordinator" : "re-optimised with the coordinator's weights"}: ${plan.lines.length} lines, ${inr(plan.totalCost)}; logistics and approval reset`,
    data: { planId: plan.id, how, weights: plan.weights, lines: plan.lines.map((line) => [line.offerId, line.shelterId, line.resource, line.quantity]), unfulfilled: plan.unfulfilled.length, validated: true },
  });
  useUi.getState().notify(`Plan v${plan.version} stored. Plan the logistics again, then approve it.`, "ok");
  return { ok: true };
}

export const resourceLabel = (resource: ResourceId): string => RESOURCES[resource].label;
