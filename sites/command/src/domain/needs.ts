// Needs assessment (NeedAssessmentAgent's tool). Deterministic arithmetic over the
// shelter data ShelterConnect reports. A model may explain these numbers; it never
// produces them.
import { emptyResourceRecord, RESOURCE_IDS, RESOURCES, round1, URGENCY_WEIGHT } from "./resources";
import type { Incident, NeedLine, NeedsAssessment, ResourceId, ShelterInfo, Urgency } from "./types";

export interface RawRequest {
  shelterId: string;
  shelterName: string;
  resource: ResourceId;
  quantityRequired: number;
  quantityInStock: number;
  urgency: Urgency;
  peopleServed: number;
  neededBy: string;
}

export const PRIORITY_WEIGHTS = { urgency: 50, shortageRatio: 20, criticality: 20, deadline: 10 } as const;

export function deadlinePressure(hoursToDeadline: number): number {
  if (hoursToDeadline <= 12) return 1;
  if (hoursToDeadline <= 24) return 0.7;
  if (hoursToDeadline <= 48) return 0.4;
  return 0.2;
}

/**
 * Priority of one shelter's need for one resource, 0..100:
 *   50 x urgency weight        (critical 1, high 0.75, medium 0.5, low 0.25)
 * + 20 x shortage / required   (how much of the requirement is uncovered)
 * + 20 x resource criticality  (water 1, medical 0.9, food 0.8, blankets 0.5)
 * + 10 x deadline pressure     (<=12 h: 1, <=24 h: 0.7, <=48 h: 0.4, else 0.2)
 */
export function priorityScore(input: { urgency: Urgency; required: number; shortage: number; resource: ResourceId; hoursToDeadline: number }): { score: number; basis: string[] } {
  const urgencyPart = PRIORITY_WEIGHTS.urgency * URGENCY_WEIGHT[input.urgency];
  const ratio = input.required > 0 ? Math.min(1, input.shortage / input.required) : 0;
  const ratioPart = PRIORITY_WEIGHTS.shortageRatio * ratio;
  const criticalityPart = PRIORITY_WEIGHTS.criticality * RESOURCES[input.resource].criticality;
  const deadlinePart = PRIORITY_WEIGHTS.deadline * deadlinePressure(input.hoursToDeadline);
  return {
    score: round1(urgencyPart + ratioPart + criticalityPart + deadlinePart),
    basis: [
      `Urgency ${input.urgency}: ${round1(urgencyPart)} of ${PRIORITY_WEIGHTS.urgency}`,
      `${Math.round(ratio * 100)}% of the requirement uncovered: ${round1(ratioPart)} of ${PRIORITY_WEIGHTS.shortageRatio}`,
      `${RESOURCES[input.resource].label} criticality: ${round1(criticalityPart)} of ${PRIORITY_WEIGHTS.criticality}`,
      `${round1(input.hoursToDeadline)} h to the deadline: ${round1(deadlinePart)} of ${PRIORITY_WEIGHTS.deadline}`,
    ],
  };
}

export function assessNeeds(input: {
  incident: Incident;
  shelters: ShelterInfo[];
  requests: RawRequest[];
  source: { networkUrl: string; label: string; simulated: boolean };
  now: Date;
}): NeedsAssessment {
  const { incident, shelters, requests, source, now } = input;
  const incidentDeadline = Date.parse(incident.deadline);

  const lines: NeedLine[] = requests
    .filter((request) => request.quantityRequired > 0)
    .map((request) => {
      const required = Math.max(0, Math.floor(request.quantityRequired));
      const inStock = Math.max(0, Math.floor(request.quantityInStock));
      // Recomputed here rather than trusted from the partner: a shortage is never negative.
      const shortage = Math.max(0, required - inStock);
      const shelterDeadline = Date.parse(request.neededBy);
      const effectiveDeadline = Math.min(
        Number.isFinite(shelterDeadline) ? shelterDeadline : Infinity,
        Number.isFinite(incidentDeadline) ? incidentDeadline : Infinity,
      );
      const hoursToDeadline = Number.isFinite(effectiveDeadline) ? Math.max(0, (effectiveDeadline - now.getTime()) / 3_600_000) : 72;
      const { score, basis } = priorityScore({ urgency: request.urgency, required, shortage, resource: request.resource, hoursToDeadline });
      return {
        id: `${request.shelterId}:${request.resource}`,
        shelterId: request.shelterId,
        shelterName: request.shelterName,
        resource: request.resource,
        required,
        inStock,
        shortage,
        urgency: request.urgency,
        peopleServed: request.peopleServed,
        neededBy: Number.isFinite(effectiveDeadline) ? new Date(effectiveDeadline).toISOString() : incident.deadline,
        hoursToDeadline: round1(hoursToDeadline),
        priorityScore: score,
        priorityRank: 0,
        priorityBasis: basis,
      };
    });

  // Rank: score, then the larger shortage, then a stable id, so ties never depend on input order.
  const ranked = [...lines].sort((a, b) => b.priorityScore - a.priorityScore || b.shortage - a.shortage || a.id.localeCompare(b.id));
  ranked.forEach((line, index) => { line.priorityRank = index + 1; });

  const totals = emptyResourceRecord((resource) => {
    const subset = lines.filter((line) => line.resource === resource);
    return {
      declared: incident.requirements[resource] || 0,
      required: subset.reduce((sum, line) => sum + line.required, 0),
      inStock: subset.reduce((sum, line) => sum + line.inStock, 0),
      shortage: subset.reduce((sum, line) => sum + line.shortage, 0),
    };
  });

  const discrepancies: string[] = [];
  for (const resource of RESOURCE_IDS) {
    const total = totals[resource];
    if (total.declared !== total.required) {
      discrepancies.push(`${RESOURCES[resource].label}: the incident declares ${total.declared}, shelters report a requirement of ${total.required}. The shelter figures are used for allocation.`);
    }
  }
  if (incident.shelterCount && incident.shelterCount !== shelters.length) {
    discrepancies.push(`The incident lists ${incident.shelterCount} shelters; ${source.label} reports ${shelters.length}.`);
  }

  return { incidentId: incident.id, generatedAt: now.toISOString(), source, shelters, lines: ranked, totals, discrepancies };
}

/** Total units still short across every resource. */
export function totalShortage(assessment: NeedsAssessment): number {
  return RESOURCE_IDS.reduce((sum, resource) => sum + assessment.totals[resource].shortage, 0);
}
