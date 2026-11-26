// Logistics planning (LogisticsAgent's tool): group an allocation plan into
// supplier-to-shelter lanes, then pick a transport option for each from the options
// RouteBridge returned. Vehicle counts are tracked across lanes, so two lanes can never
// both claim the same vehicles.
import { RESOURCES, round1 } from "./resources";
import { isUsable } from "./trust";
import type { AllocationPlan, CargoLine, GeoPoint, ShipmentPlan, TransportOption, TrustEvaluation } from "./types";

export interface Lane {
  reference: string;
  supplierId: string;
  supplierName: string;
  shelterId: string;
  shelterName: string;
  from: GeoPoint & { label: string };
  to: GeoPoint & { label: string };
  cargo: CargoLine[];
  weightKg: number;
  /** Hours until the supplier has the whole load ready: the longest lead time on the lane. */
  readyInHours: number;
  hoursToDeadline: number;
  priority: number;
}

export function cargoWeightKg(cargo: CargoLine[]): number {
  return round1(cargo.reduce((sum, line) => sum + line.quantity * RESOURCES[line.resource].unitWeightKg, 0));
}

export const shipmentReference = (supplierId: string, shelterId: string): string => `SHP-${supplierId}-${shelterId}`;

/** One lane per supplier and shelter, carrying every allocated line between them. */
export function buildLanes(input: {
  plan: AllocationPlan;
  supplierLocations: Record<string, GeoPoint & { label: string }>;
  shelterLocations: Record<string, GeoPoint & { label: string }>;
  leadTimeByOffer: Record<string, number>;
  needByShelter: Record<string, { hoursToDeadline: number; priority: number }>;
}): Lane[] {
  const lanes = new Map<string, Lane>();
  for (const line of input.plan.lines) {
    const from = input.supplierLocations[line.supplierId];
    const to = input.shelterLocations[line.shelterId];
    if (!from || !to) continue;
    const reference = shipmentReference(line.supplierId, line.shelterId);
    const lane = lanes.get(reference) || {
      reference,
      supplierId: line.supplierId,
      supplierName: line.supplierName,
      shelterId: line.shelterId,
      shelterName: line.shelterName,
      from,
      to,
      cargo: [],
      weightKg: 0,
      readyInHours: 0,
      hoursToDeadline: input.needByShelter[line.shelterId]?.hoursToDeadline ?? 0,
      priority: input.needByShelter[line.shelterId]?.priority ?? 0,
    };
    const existing = lane.cargo.find((item) => item.resource === line.resource);
    if (existing) existing.quantity += line.quantity;
    else lane.cargo.push({ resource: line.resource, quantity: line.quantity });
    lane.readyInHours = Math.max(lane.readyInHours, input.leadTimeByOffer[line.offerId] ?? 0);
    lanes.set(reference, lane);
  }
  const result = [...lanes.values()];
  for (const lane of result) lane.weightKg = cargoWeightKg(lane.cargo);
  // Highest-priority shelters choose their vehicles first; ties by reference for stability.
  return result.sort((a, b) => b.priority - a.priority || a.reference.localeCompare(b.reference));
}

const usageKey = (providerId: string, vehicleType: string): string => `${providerId}|${vehicleType}`;

/**
 * Pick a transport option per lane.
 *
 * An option is usable when RouteBridge says it is feasible, its operator passes the trust
 * check, and enough of its vehicles are still free after earlier lanes took theirs.
 * Among usable options: on-time ones first, cheapest first, then fastest. When nothing
 * is on time, the fastest is taken and the shipment is marked late.
 */
export function assignTransport(input: {
  lanes: Lane[];
  optionsByLane: Record<string, TransportOption[]>;
  trustByOrganization: Record<string, TrustEvaluation>;
}): ShipmentPlan[] {
  const used = new Map<string, number>();
  const plans: ShipmentPlan[] = [];

  for (const lane of input.lanes) {
    const options = input.optionsByLane[lane.reference] || [];
    const assessed = options.map((option) => {
      const trust = input.trustByOrganization[option.organizationId];
      const trusted = trust ? isUsable(trust.decision) : false;
      const free = option.vehiclesAvailable - (used.get(usageKey(option.providerId, option.vehicleType)) || 0);
      const enough = option.vehiclesNeeded > 0 && option.vehiclesNeeded <= free;
      const totalHours = round1(lane.readyInHours + option.etaHours);
      const onTime = totalHours <= lane.hoursToDeadline;
      let note = "";
      if (!option.feasible) note = option.advisories[0] || "Not feasible on this route.";
      else if (!trusted) note = trust ? `Operator ${trust.decision}: ${trust.blockers[0] || trust.warnings[0] || "failed the trust check"}` : "Operator is unverified.";
      else if (!enough) note = `Needs ${option.vehiclesNeeded} vehicle(s); ${Math.max(0, free)} free after earlier lanes.`;
      else if (!onTime) note = `Would arrive in ${totalHours} h, after the ${lane.hoursToDeadline} h deadline.`;
      return { option, usable: option.feasible && trusted && enough, totalHours, onTime, note };
    });

    const usable = assessed.filter((item) => item.usable).sort((a, b) =>
      Number(b.onTime) - Number(a.onTime)
      || (a.onTime && b.onTime ? a.option.cost - b.option.cost || a.totalHours - b.totalHours : a.totalHours - b.totalHours || a.option.cost - b.option.cost)
      || a.option.providerId.localeCompare(b.option.providerId) || a.option.vehicleType.localeCompare(b.option.vehicleType));
    const chosen = usable[0];

    const alternatives = assessed
      .filter((item) => item !== chosen)
      .sort((a, b) => Number(b.usable) - Number(a.usable) || a.totalHours - b.totalHours)
      .slice(0, 3)
      .map((item) => ({
        providerName: item.option.providerName,
        vehicleType: item.option.vehicleType,
        etaHours: item.option.etaHours,
        cost: item.option.cost,
        feasible: item.usable,
        note: item.usable ? (item.onTime ? "Usable alternative." : item.note) : item.note,
      }));

    const base = {
      reference: lane.reference,
      supplierId: lane.supplierId,
      supplierName: lane.supplierName,
      shelterId: lane.shelterId,
      shelterName: lane.shelterName,
      from: lane.from,
      to: lane.to,
      cargo: lane.cargo,
      weightKg: lane.weightKg,
      readyInHours: lane.readyInHours,
      alternatives,
    };

    if (!chosen) {
      plans.push({
        ...base,
        providerId: null, providerName: null, organizationId: null, vehicleType: null, vehicles: 0,
        haulKm: options[0]?.haulKm ?? 0, etaHours: null, totalHours: null, cost: 0, onTime: false, assigned: false,
        reason: options.length ? "No usable transport option: every option is infeasible, untrusted or out of vehicles." : "RouteBridge returned no options for this lane.",
        advisories: [...new Set(options.flatMap((option) => option.advisories))].slice(0, 4),
        routeSource: options[0]?.routeSource ?? "none",
      });
      continue;
    }

    const key = usageKey(chosen.option.providerId, chosen.option.vehicleType);
    used.set(key, (used.get(key) || 0) + chosen.option.vehiclesNeeded);
    plans.push({
      ...base,
      providerId: chosen.option.providerId,
      providerName: chosen.option.providerName,
      organizationId: chosen.option.organizationId,
      vehicleType: chosen.option.vehicleType,
      vehicles: chosen.option.vehiclesNeeded,
      haulKm: chosen.option.haulKm,
      etaHours: chosen.option.etaHours,
      totalHours: chosen.totalHours,
      cost: chosen.option.cost,
      onTime: chosen.onTime,
      assigned: true,
      reason: chosen.onTime
        ? `Cheapest usable option that arrives on time (${chosen.totalHours} h of ${lane.hoursToDeadline} h).`
        : `No option arrives on time; this is the fastest (${chosen.totalHours} h against ${lane.hoursToDeadline} h).`,
      advisories: chosen.option.advisories,
      routeSource: chosen.option.routeSource,
    });
  }
  return plans;
}

export function logisticsTotals(plans: ShipmentPlan[]): { cost: number; weightKg: number; assigned: number; unassigned: number; late: number; longestHours: number } {
  return {
    cost: plans.reduce((sum, plan) => sum + plan.cost, 0),
    weightKg: round1(plans.reduce((sum, plan) => sum + plan.weightKg, 0)),
    assigned: plans.filter((plan) => plan.assigned).length,
    unassigned: plans.filter((plan) => !plan.assigned).length,
    late: plans.filter((plan) => plan.assigned && !plan.onTime).length,
    longestHours: Math.max(0, ...plans.map((plan) => plan.totalHours ?? 0)),
  };
}
