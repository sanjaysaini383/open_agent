// The resource allocation engine (ResourceAllocationAgent's tool).
//
// Deterministic and testable: the same inputs always give the same plan, and no model
// takes part in the arithmetic. It is a priority-ordered greedy assignment with a
// proportional fairness step under scarcity:
//
//   1. Targets. Per resource, if eligible supply covers every shortage, each shelter's
//      target is its shortage. If not, supply is shared in proportion to
//      priorityScore x shortage, so the most urgent shelters get the larger share but no
//      shelter is left with nothing while another is fully served.
//   2. Assignment. Needs are served in global priority order. For each, the candidate
//      offers are ranked by
//          wCost x price/maxPrice + wTime x hours/maxHours + wTrust x (1 - trust/100)
//      plus a fixed penalty for arriving after the deadline, and filled in that order.
//      Supply, the budget and lane feasibility are hard limits.
//   3. Minimum orders. An offer whose total would fall below its minimum order is dropped
//      and the plan is recomputed without it.
//
// validateAllocation() re-checks every invariant on the finished plan. The workflow
// refuses to present a plan that fails it.
import { emptyResourceRecord, RESOURCE_IDS, RESOURCES, round1, round2 } from "./resources";
import type { AllocationLine, AllocationPlan, GeoPoint, LaneInfo, ResourceId, UnfulfilledLine } from "./types";

export interface AllocationNeed {
  shelterId: string;
  shelterName: string;
  resource: ResourceId;
  shortage: number;
  priorityScore: number;
  hoursToDeadline: number;
}

export interface AllocationOffer {
  offerId: string;
  supplierId: string;
  supplierName: string;
  resource: ResourceId;
  quantityAvailable: number;
  unitPrice: number;
  listUnitPrice: number;
  minOrder: number;
  leadTimeHours: number;
  location: GeoPoint;
  trustScore: number;
  eligible: boolean;
  exclusionReasons: string[];
}

export interface AllocationInput {
  incidentId: string;
  needs: AllocationNeed[];
  offers: AllocationOffer[];
  /** Transit information by laneKey(supplierId, shelterId). A missing lane is infeasible. */
  lanes: Record<string, LaneInfo>;
  budget: number;
  /** Units of an offer this incident already reserved, which must not be allocated again. */
  reserved?: Record<string, number>;
  weights?: { cost: number; time: number; trust: number };
  version?: number;
  now: Date;
}

export const DEFAULT_WEIGHTS = { cost: 0.5, time: 0.3, trust: 0.2 } as const;
export const LATE_PENALTY = 1;

export const laneKey = (supplierId: string, shelterId: string): string => `${supplierId}->${shelterId}`;
const needKey = (need: { shelterId: string; resource: ResourceId }): string => `${need.shelterId}:${need.resource}`;

function sanitiseQuantity(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function sortNeeds(needs: AllocationNeed[]): AllocationNeed[] {
  return [...needs].sort((a, b) => b.priorityScore - a.priorityScore || b.shortage - a.shortage || needKey(a).localeCompare(needKey(b)));
}

/** Step 1: how much each need may receive, given eligible supply for its resource. */
export function computeTargets(needs: AllocationNeed[], supplyByResource: Record<ResourceId, number>): Map<string, number> {
  const targets = new Map<string, number>();
  for (const resource of RESOURCE_IDS) {
    const group = sortNeeds(needs.filter((need) => need.resource === resource && need.shortage > 0));
    const demand = group.reduce((sum, need) => sum + need.shortage, 0);
    const supply = supplyByResource[resource] || 0;
    if (supply >= demand) {
      for (const need of group) targets.set(needKey(need), need.shortage);
      continue;
    }
    const weightSum = group.reduce((sum, need) => sum + need.priorityScore * need.shortage, 0);
    let handedOut = 0;
    for (const need of group) {
      const share = weightSum > 0 ? Math.floor((supply * need.priorityScore * need.shortage) / weightSum) : 0;
      const target = Math.min(need.shortage, share);
      targets.set(needKey(need), target);
      handedOut += target;
    }
    // Rounding leftovers go to the highest priorities first.
    let leftover = supply - handedOut;
    for (const need of group) {
      if (leftover <= 0) break;
      const current = targets.get(needKey(need)) || 0;
      const extra = Math.min(leftover, need.shortage - current);
      targets.set(needKey(need), current + extra);
      leftover -= extra;
    }
  }
  return targets;
}

interface PassResult {
  lines: AllocationLine[];
  unfulfilled: UnfulfilledLine[];
  totalCost: number;
}

function runPass(input: AllocationInput, barred: Set<string>): PassResult {
  const weights = input.weights || DEFAULT_WEIGHTS;
  const reserved = input.reserved || {};
  const remaining = new Map<string, number>();
  const usable = input.offers.filter((offer) => offer.eligible && !barred.has(offer.offerId));
  for (const offer of usable) remaining.set(offer.offerId, Math.max(0, sanitiseQuantity(offer.quantityAvailable) - sanitiseQuantity(reserved[offer.offerId] || 0)));

  const needs = input.needs.map((need) => ({ ...need, shortage: sanitiseQuantity(need.shortage) })).filter((need) => need.shortage > 0);

  const supplyByResource = emptyResourceRecord((resource) =>
    usable.filter((offer) => offer.resource === resource).reduce((sum, offer) => sum + (remaining.get(offer.offerId) || 0), 0));
  const targets = computeTargets(needs, supplyByResource);

  // Normalisers, per resource, over every lane that could be used.
  const maxPrice = emptyResourceRecord((resource) => Math.max(0, ...usable.filter((offer) => offer.resource === resource).map((offer) => offer.unitPrice)));
  const maxHours = emptyResourceRecord((resource) => {
    const hours: number[] = [];
    for (const offer of usable.filter((item) => item.resource === resource)) {
      for (const need of needs.filter((item) => item.resource === resource)) {
        const lane = input.lanes[laneKey(offer.supplierId, need.shelterId)];
        if (lane?.feasible) hours.push(offer.leadTimeHours + lane.transitHours);
      }
    }
    return Math.max(0, ...hours);
  });

  const lines: AllocationLine[] = [];
  const unfulfilled: UnfulfilledLine[] = [];
  let totalCost = 0;
  let budgetHit = false;

  for (const need of sortNeeds(needs)) {
    const target = targets.get(needKey(need)) || 0;
    let want = target;

    const candidates = usable
      .filter((offer) => offer.resource === need.resource)
      .map((offer) => {
        const lane = input.lanes[laneKey(offer.supplierId, need.shelterId)];
        const hours = lane?.feasible ? round1(offer.leadTimeHours + lane.transitHours) : Infinity;
        const onTime = hours <= need.hoursToDeadline;
        const parts = {
          cost: maxPrice[need.resource] > 0 ? offer.unitPrice / maxPrice[need.resource] : 0,
          time: maxHours[need.resource] > 0 && Number.isFinite(hours) ? hours / maxHours[need.resource] : 0,
          trust: 1 - Math.max(0, Math.min(100, offer.trustScore)) / 100,
        };
        const score = weights.cost * parts.cost + weights.time * parts.time + weights.trust * parts.trust + (onTime ? 0 : LATE_PENALTY);
        return { offer, lane, hours, onTime, parts, score };
      })
      .filter((candidate) => candidate.lane?.feasible)
      .sort((a, b) => a.score - b.score || a.offer.unitPrice - b.offer.unitPrice || a.offer.offerId.localeCompare(b.offer.offerId));

    const feasibleCount = candidates.length;
    let stoppedByBudget = false;
    candidates.forEach((candidate, index) => {
      if (want <= 0) return;
      const available = remaining.get(candidate.offer.offerId) || 0;
      if (available <= 0) return;
      let quantity = Math.min(want, available);
      const affordable = candidate.offer.unitPrice > 0 ? Math.floor((input.budget - totalCost + 1e-9) / candidate.offer.unitPrice) : quantity;
      if (affordable < quantity) { quantity = Math.max(0, affordable); stoppedByBudget = true; budgetHit = true; }
      if (quantity <= 0) return;

      const lineCost = round2(quantity * candidate.offer.unitPrice);
      const reasons = [
        `Option ${index + 1} of ${feasibleCount} for this need (score ${candidate.score.toFixed(2)}: cost ${candidate.parts.cost.toFixed(2)}, time ${candidate.parts.time.toFixed(2)}, trust ${candidate.parts.trust.toFixed(2)}; lower is better).`,
        candidate.offer.unitPrice < candidate.offer.listUnitPrice
          ? `Negotiated ₹${candidate.offer.unitPrice} per unit, down from ₹${candidate.offer.listUnitPrice} list.`
          : `₹${candidate.offer.unitPrice} per unit (list price).`,
        candidate.onTime
          ? `${candidate.hours} h door to door, inside the ${need.hoursToDeadline} h deadline.`
          : `LATE: ${candidate.hours} h door to door against a ${need.hoursToDeadline} h deadline. No on-time option had stock left.`,
        `Priority score ${need.priorityScore} for ${need.shelterName}.`,
      ];
      if (target < need.shortage) reasons.push(`Supply is short: this shelter's fair share is ${target} of ${need.shortage}.`);
      if (candidate.lane?.note) reasons.push(candidate.lane.note);

      lines.push({
        id: `${need.shelterId}:${need.resource}:${candidate.offer.offerId}`,
        shelterId: need.shelterId,
        shelterName: need.shelterName,
        resource: need.resource,
        offerId: candidate.offer.offerId,
        supplierId: candidate.offer.supplierId,
        supplierName: candidate.offer.supplierName,
        quantity,
        unitPrice: candidate.offer.unitPrice,
        lineCost,
        deliveryHours: candidate.hours,
        onTime: candidate.onTime,
        reasons,
      });
      remaining.set(candidate.offer.offerId, available - quantity);
      want -= quantity;
      totalCost = round2(totalCost + lineCost);
    });

    const allocated = target - want;
    const missing = need.shortage - allocated;
    if (missing > 0) {
      let reason: UnfulfilledLine["reason"];
      let detail: string;
      if (stoppedByBudget) { reason = "budget"; detail = `The budget of ₹${input.budget} is used up.`; }
      else if (!feasibleCount) {
        const anyOffer = input.offers.some((offer) => offer.resource === need.resource);
        const anyEligible = usable.some((offer) => offer.resource === need.resource);
        if (anyEligible) { reason = "no_feasible_lane"; detail = "No eligible supplier has a feasible route to this shelter."; }
        else if (anyOffer) { reason = "supplier_excluded"; detail = "Every offer for this resource is excluded by the trust or safety checks."; }
        else { reason = "no_supply"; detail = "No supplier offers this resource."; }
      } else { reason = "no_supply"; detail = `Eligible supply for ${RESOURCES[need.resource].label.toLowerCase()} is exhausted.`; }
      unfulfilled.push({ shelterId: need.shelterId, shelterName: need.shelterName, resource: need.resource, quantity: missing, reason, detail });
    }
  }
  void budgetHit;
  return { lines, unfulfilled, totalCost };
}

function totalsByOffer(lines: AllocationLine[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of lines) totals.set(line.offerId, (totals.get(line.offerId) || 0) + line.quantity);
  return totals;
}

/**
 * Raise an offer that is below its minimum order up to that minimum, by moving units to
 * it from other suppliers' lines for the same resource (dearest first). A donor is never
 * pushed below its own minimum, the budget is never exceeded, and no shelter receives
 * more or less than before. Returns false, changing nothing, when that cannot be done.
 */
function topUpToMinimum(input: AllocationInput, pass: PassResult, offer: AllocationOffer): boolean {
  const offers = new Map(input.offers.map((item) => [item.offerId, item]));
  const needs = new Map(input.needs.map((need) => [needKey(need), need]));
  const totals = totalsByOffer(pass.lines);
  const have = totals.get(offer.offerId) || 0;
  let missing = offer.minOrder - have;
  const capacity = sanitiseQuantity(offer.quantityAvailable) - sanitiseQuantity(input.reserved?.[offer.offerId] || 0) - have;
  if (missing <= 0) return true;
  if (capacity < missing) return false;

  const donors = pass.lines
    .filter((line) => line.resource === offer.resource && line.offerId !== offer.offerId && input.lanes[laneKey(offer.supplierId, line.shelterId)]?.feasible)
    .sort((a, b) => b.unitPrice - a.unitPrice || a.id.localeCompare(b.id));

  const moves: { donor: AllocationLine; quantity: number }[] = [];
  const donorTotals = new Map(totals);
  let costDelta = 0;
  for (const donor of donors) {
    if (missing <= 0) break;
    const donorOffer = offers.get(donor.offerId);
    if (!donorOffer) continue;
    const spare = (donorTotals.get(donor.offerId) || 0) - donorOffer.minOrder;
    const quantity = Math.min(donor.quantity, missing, Math.max(0, spare));
    if (quantity <= 0) continue;
    moves.push({ donor, quantity });
    donorTotals.set(donor.offerId, (donorTotals.get(donor.offerId) || 0) - quantity);
    costDelta += quantity * (offer.unitPrice - donor.unitPrice);
    missing -= quantity;
  }
  if (missing > 0 || pass.totalCost + costDelta > input.budget + 1e-9) return false;

  for (const { donor, quantity } of moves) {
    donor.quantity -= quantity;
    donor.lineCost = round2(donor.quantity * donor.unitPrice);
    const need = needs.get(needKey(donor));
    const lane = input.lanes[laneKey(offer.supplierId, donor.shelterId)];
    const hours = round1(offer.leadTimeHours + lane.transitHours);
    const id = `${donor.shelterId}:${donor.resource}:${offer.offerId}`;
    const note = `Includes ${quantity} units moved from ${donor.supplierName} to meet this supplier's minimum order of ${offer.minOrder}.`;
    const existing = pass.lines.find((line) => line.id === id);
    if (existing) {
      existing.quantity += quantity;
      existing.lineCost = round2(existing.quantity * existing.unitPrice);
      existing.reasons.push(note);
    } else {
      const onTime = hours <= (need?.hoursToDeadline ?? Infinity);
      pass.lines.push({
        id,
        shelterId: donor.shelterId,
        shelterName: donor.shelterName,
        resource: donor.resource,
        offerId: offer.offerId,
        supplierId: offer.supplierId,
        supplierName: offer.supplierName,
        quantity,
        unitPrice: offer.unitPrice,
        lineCost: round2(quantity * offer.unitPrice),
        deliveryHours: hours,
        onTime,
        reasons: [
          `Option added to meet the supplier's minimum order for ${RESOURCES[donor.resource].label.toLowerCase()}.`,
          `₹${offer.unitPrice} per unit${offer.unitPrice < offer.listUnitPrice ? `, negotiated from ₹${offer.listUnitPrice} list` : " (list price)"}.`,
          onTime ? `${hours} h door to door, inside the deadline.` : `LATE: ${hours} h door to door, after the deadline.`,
          note,
        ],
      });
    }
  }
  pass.lines = pass.lines.filter((line) => line.quantity > 0);
  pass.totalCost = round2(pass.lines.reduce((sum, line) => sum + line.lineCost, 0));
  return true;
}

/**
 * Weightings tried, in order, when the caller does not fix one. The first is the balanced
 * default. The others lean progressively harder on cost, and are only preferred when the
 * budget stops the default plan from covering as much need.
 */
export const WEIGHT_LADDER: { cost: number; time: number; trust: number }[] = [
  { ...DEFAULT_WEIGHTS },
  { cost: 0.7, time: 0.15, trust: 0.15 },
  { cost: 0.9, time: 0.05, trust: 0.05 },
];

const allocatedUnits = (plan: AllocationPlan): number => plan.lines.reduce((sum, line) => sum + line.quantity, 0);

/**
 * Build the allocation plan.
 *
 * With explicit weights, one deterministic run. Without, the balanced weighting is used
 * unless the budget is what leaves need uncovered; then the cost-leaning weightings are
 * tried too and the plan that covers the most units wins (ties go to the more balanced one).
 */
export function allocate(input: AllocationInput): AllocationPlan {
  if (input.weights) return allocateOnce(input, input.weights);
  const first = allocateOnce(input, WEIGHT_LADDER[0]);
  if (!first.unfulfilled.some((line) => line.reason === "budget")) return first;
  let best = first;
  for (const weights of WEIGHT_LADDER.slice(1)) {
    const candidate = allocateOnce(input, weights);
    if (allocatedUnits(candidate) > allocatedUnits(best)) best = candidate;
  }
  if (best !== first) {
    best.notes.unshift(`The budget was binding at the balanced weighting (${allocatedUnits(first)} units covered), so cost was weighted ${best.weights.cost} instead of ${DEFAULT_WEIGHTS.cost} and ${allocatedUnits(best)} units are covered.`);
  }
  return best;
}

function allocateOnce(rawInput: AllocationInput, weights: { cost: number; time: number; trust: number }): AllocationPlan {
  const input = { ...rawInput, weights };
  const budget = Number.isFinite(input.budget) && input.budget >= 0 ? input.budget : 0;
  const safeInput = { ...input, budget };
  const barred = new Set<string>();
  const notes: string[] = [];
  let pass = runPass(safeInput, barred);

  // Step 3: minimum orders. First try to raise a short offer to its minimum by moving
  // units from dearer suppliers. Only if that is impossible is the offer dropped and the
  // plan recomputed without it.
  for (let round = 0; round <= input.offers.length; round++) {
    const totals = totalsByOffer(pass.lines);
    const violating = input.offers
      .filter((offer) => { const total = totals.get(offer.offerId) || 0; return total > 0 && total < offer.minOrder; })
      .sort((a, b) => a.offerId.localeCompare(b.offerId));
    if (!violating.length) break;
    let dropped = false;
    for (const offer of violating) {
      const before = totalsByOffer(pass.lines).get(offer.offerId) || 0;
      if (before >= offer.minOrder) continue;
      if (topUpToMinimum(safeInput, pass, offer)) {
        notes.push(`${offer.supplierName} (${offer.offerId}): raised from ${before} to its minimum order of ${offer.minOrder} by moving units from dearer suppliers.`);
      } else {
        barred.add(offer.offerId);
        dropped = true;
        notes.push(`${offer.supplierName} (${offer.offerId}) dropped: ${before} units would be below its minimum order of ${offer.minOrder}, and no units could be moved to it.`);
      }
    }
    if (dropped) pass = runPass(safeInput, barred);
  }

  const lines = pass.lines;
  const fulfilment = emptyResourceRecord((resource) => {
    const shortage = input.needs.filter((need) => need.resource === resource).reduce((sum, need) => sum + sanitiseQuantity(need.shortage), 0);
    const allocated = lines.filter((line) => line.resource === resource).reduce((sum, line) => sum + line.quantity, 0);
    return { shortage, allocated, pct: shortage > 0 ? round1((allocated / shortage) * 100) : 100 };
  });

  const supplierMap = new Map<string, { supplierId: string; supplierName: string; cost: number; units: number }>();
  for (const line of lines) {
    const entry = supplierMap.get(line.supplierId) || { supplierId: line.supplierId, supplierName: line.supplierName, cost: 0, units: 0 };
    entry.cost = round2(entry.cost + line.lineCost);
    entry.units += line.quantity;
    supplierMap.set(line.supplierId, entry);
  }

  const lateLines = lines.filter((line) => !line.onTime).length;
  if (lateLines) notes.push(`${lateLines} allocation line(s) are expected after the deadline.`);
  if (pass.unfulfilled.some((line) => line.reason === "budget")) notes.push("The budget limit was reached before every need was covered. Lower-priority needs lost out first.");

  const version = input.version || 1;
  return {
    id: `${input.incidentId}-plan-v${version}`,
    incidentId: input.incidentId,
    generatedAt: input.now.toISOString(),
    version,
    lines,
    unfulfilled: pass.unfulfilled,
    totalCost: round2(pass.totalCost),
    budget,
    budgetRemaining: round2(budget - pass.totalCost),
    estimatedCompletionHours: lines.length ? Math.max(...lines.map((line) => line.deliveryHours)) : 0,
    fulfilment,
    bySupplier: [...supplierMap.values()].sort((a, b) => b.cost - a.cost),
    excludedOffers: input.offers.filter((offer) => !offer.eligible).map((offer) => ({ offerId: offer.offerId, supplierName: offer.supplierName, reasons: offer.exclusionReasons })),
    weights: { ...weights },
    method: "Priority-ordered greedy assignment with proportional fair shares under scarcity; deterministic.",
    notes,
  };
}

/** Re-check every invariant on a finished plan. An empty list means the plan is sound. */
export function validateAllocation(input: AllocationInput, plan: AllocationPlan): string[] {
  const problems: string[] = [];
  const offers = new Map(input.offers.map((offer) => [offer.offerId, offer]));
  const needs = new Map(input.needs.map((need) => [needKey(need), need]));
  const reserved = input.reserved || {};
  const seen = new Set<string>();
  const byOffer = new Map<string, number>();
  const byNeed = new Map<string, number>();
  let cost = 0;

  for (const line of plan.lines) {
    const key = `${line.shelterId}:${line.resource}:${line.offerId}`;
    if (seen.has(key)) problems.push(`Duplicate allocation: ${key}.`);
    seen.add(key);
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) problems.push(`Invalid quantity ${line.quantity} on ${key}.`);
    const offer = offers.get(line.offerId);
    if (!offer) { problems.push(`Unknown offer ${line.offerId}.`); continue; }
    if (!offer.eligible) problems.push(`Ineligible offer ${line.offerId} was allocated.`);
    if (offer.resource !== line.resource) problems.push(`Offer ${line.offerId} is for ${offer.resource}, not ${line.resource}.`);
    if (!needs.has(needKey(line))) problems.push(`No such need: ${needKey(line)}.`);
    if (Math.abs(line.lineCost - round2(line.quantity * line.unitPrice)) > 0.01) problems.push(`Line cost mismatch on ${key}.`);
    if (!input.lanes[laneKey(line.supplierId, line.shelterId)]?.feasible) problems.push(`Infeasible lane used on ${key}.`);
    byOffer.set(line.offerId, (byOffer.get(line.offerId) || 0) + line.quantity);
    byNeed.set(needKey(line), (byNeed.get(needKey(line)) || 0) + line.quantity);
    cost += line.lineCost;
  }
  for (const [offerId, total] of byOffer) {
    const offer = offers.get(offerId);
    if (!offer) continue;
    const available = sanitiseQuantity(offer.quantityAvailable) - sanitiseQuantity(reserved[offerId] || 0);
    if (total > available) problems.push(`Offer ${offerId} over-allocated: ${total} of ${available} available.`);
    if (total < offer.minOrder) problems.push(`Offer ${offerId} is below its minimum order: ${total} of ${offer.minOrder}.`);
  }
  for (const [key, total] of byNeed) {
    const need = needs.get(key);
    if (need && total > sanitiseQuantity(need.shortage)) problems.push(`Over-ordering for ${key}: ${total} allocated against a shortage of ${need.shortage}.`);
  }
  if (Math.abs(cost - plan.totalCost) > 0.05) problems.push(`Plan total ₹${plan.totalCost} does not equal the sum of its lines ₹${round2(cost)}.`);
  if (plan.totalCost > input.budget + 0.01) problems.push(`Plan cost ₹${plan.totalCost} exceeds the budget ₹${input.budget}.`);
  for (const line of plan.unfulfilled) if (line.quantity <= 0) problems.push(`Unfulfilled line with non-positive quantity for ${needKey(line)}.`);
  return problems;
}

/** Units allocated per offer, the form a negotiation or a reservation needs. */
export function quantityByOffer(plan: AllocationPlan): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const line of plan.lines) totals[line.offerId] = (totals[line.offerId] || 0) + line.quantity;
  return totals;
}

export function overallFulfilmentPct(plan: AllocationPlan): number {
  const shortage = RESOURCE_IDS.reduce((sum, resource) => sum + plan.fulfilment[resource].shortage, 0);
  const allocated = RESOURCE_IDS.reduce((sum, resource) => sum + plan.fulfilment[resource].allocated, 0);
  return shortage > 0 ? round1((allocated / shortage) * 100) : 100;
}
