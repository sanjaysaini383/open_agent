// Risk analysis (RiskAnalysisAgent's tool): findings derived from the plan's own data,
// and "what if" scenarios computed by re-running the allocation engine. Nothing here is
// estimated by a model.
import { allocate, overallFulfilmentPct, type AllocationInput } from "./allocation";
import { RESOURCE_IDS, RESOURCES, round1, round2 } from "./resources";
import type { AllocationPlan, NeedsAssessment, Risk, Scenario, ScoredOffer, ShipmentPlan, TrustEvaluation } from "./types";

export const CONCENTRATION_LIMIT = 0.6;
export const BUDGET_WARNING = 0.9;

export function analyseRisks(input: {
  assessment: NeedsAssessment | null;
  offers: ScoredOffer[];
  plan: AllocationPlan | null;
  shipments: ShipmentPlan[];
  partnerTrust: TrustEvaluation[];
}): Risk[] {
  const risks: Risk[] = [];
  const { offers, plan, shipments } = input;

  // Suspicious offers
  for (const offer of offers) {
    for (const flag of offer.flags) {
      if (flag.kind === "instruction_injection") {
        risks.push({
          id: `injection-${offer.offerId}`, category: "supplier", severity: "critical",
          title: `Hostile text in an offer from ${offer.supplierName}`,
          detail: `${flag.detail} Offer ${offer.offerId} is excluded from allocation.`,
          recommendation: "Report the supplier to the trust registry. Do not override the exclusion.",
        });
      } else if (flag.kind === "price_anomaly") {
        risks.push({
          id: `price-${offer.offerId}`, category: "supplier", severity: offer.eligible ? "medium" : "high",
          title: `Unusually low price from ${offer.supplierName}`,
          detail: `${flag.detail} ${offer.eligible ? "The supplier passed the trust check." : "The supplier also failed or lacks a trust check."}`,
          recommendation: "Treat as a possible scam or quality problem. Confirm stock and quality before relying on it.",
        });
      }
    }
  }

  // Trust findings on partners that are in use
  for (const evaluation of input.partnerTrust) {
    if (evaluation.decision === "blocked") {
      risks.push({
        id: `trust-blocked-${evaluation.subjectId}`, category: "trust", severity: "high",
        title: `${evaluation.name} is blocked`,
        detail: evaluation.blockers.join(" "),
        recommendation: "Do not use this party. Look for an alternative provider.",
      });
    } else if (evaluation.decision === "unverified") {
      risks.push({
        id: `trust-unverified-${evaluation.subjectId}`, category: "trust", severity: "medium",
        title: `${evaluation.name} is unverified`,
        detail: "The trust registry holds no record for this party.",
        recommendation: "Keep it excluded, or have a person allow it explicitly after independent checks.",
      });
    }
  }

  if (plan) {
    // Shortages left uncovered
    for (const resource of RESOURCE_IDS) {
      const item = plan.fulfilment[resource];
      if (item.shortage > 0 && item.allocated < item.shortage) {
        const missing = item.shortage - item.allocated;
        const pct = round1((missing / item.shortage) * 100);
        risks.push({
          id: `shortage-${resource}`, category: "shortage", severity: pct >= 30 ? "critical" : pct >= 10 ? "high" : "medium",
          title: `${missing} ${RESOURCES[resource].unit} of ${RESOURCES[resource].label.toLowerCase()} unfulfilled`,
          detail: `${pct}% of the shortage is not covered. ${plan.unfulfilled.filter((line) => line.resource === resource).map((line) => `${line.shelterName}: ${line.quantity} (${line.detail})`).slice(0, 3).join(" ")}`,
          recommendation: "Discover more suppliers, raise the budget, or ask a person to review excluded suppliers.",
        });
      }
    }

    // Budget
    if (plan.budget > 0 && plan.totalCost >= plan.budget * BUDGET_WARNING) {
      const pct = round1((plan.totalCost / plan.budget) * 100);
      risks.push({
        id: "budget", category: "budget", severity: plan.unfulfilled.some((line) => line.reason === "budget") ? "high" : "medium",
        title: `Plan uses ${pct}% of the budget`,
        detail: `₹${round2(plan.totalCost)} of ₹${plan.budget}. Transport cost is on top of this.`,
        recommendation: "Leave headroom for transport, or approve a higher limit before execution.",
      });
    }

    // Concentration: one supplier carrying most of a resource
    for (const resource of RESOURCE_IDS) {
      const lines = plan.lines.filter((line) => line.resource === resource);
      const total = lines.reduce((sum, line) => sum + line.quantity, 0);
      if (!total) continue;
      const bySupplier = new Map<string, { name: string; units: number }>();
      for (const line of lines) {
        const entry = bySupplier.get(line.supplierId) || { name: line.supplierName, units: 0 };
        entry.units += line.quantity;
        bySupplier.set(line.supplierId, entry);
      }
      for (const entry of bySupplier.values()) {
        if (entry.units / total > CONCENTRATION_LIMIT && bySupplier.size > 0) {
          risks.push({
            id: `concentration-${resource}`, category: "concentration", severity: "medium",
            title: `${Math.round((entry.units / total) * 100)}% of ${RESOURCES[resource].label.toLowerCase()} comes from ${entry.name}`,
            detail: "A failure at this one supplier would remove most of this resource.",
            recommendation: "See the scenario analysis for the impact, and keep a second supplier on standby.",
          });
        }
      }
    }

    // Late allocation lines
    const late = plan.lines.filter((line) => !line.onTime);
    if (late.length) {
      risks.push({
        id: "late-lines", category: "delivery", severity: "high",
        title: `${late.length} allocation line(s) expected after the deadline`,
        detail: late.slice(0, 3).map((line) => `${line.shelterName}: ${RESOURCES[line.resource].label.toLowerCase()} in ${line.deliveryHours} h`).join("; "),
        recommendation: "Prefer nearer suppliers for these shelters, or accept a later arrival explicitly.",
      });
    }
  }

  // Logistics
  for (const shipment of shipments) {
    if (!shipment.assigned) {
      risks.push({
        id: `unassigned-${shipment.reference}`, category: "delivery", severity: "critical",
        title: `No transport for ${shipment.supplierName} → ${shipment.shelterName}`,
        detail: `${shipment.reason} ${shipment.advisories.join(" ")}`.trim(),
        recommendation: "Re-optimise the allocation with route feasibility, or register another transport provider.",
      });
    } else if (!shipment.onTime) {
      risks.push({
        id: `late-${shipment.reference}`, category: "delivery", severity: "high",
        title: `${shipment.supplierName} → ${shipment.shelterName} arrives late`,
        detail: `${shipment.totalHours} h door to door by ${shipment.vehicleType}. ${shipment.advisories.join(" ")}`.trim(),
        recommendation: shipment.alternatives.find((option) => option.feasible)
          ? "A usable alternative exists; compare it in the logistics view."
          : "No faster usable option. Consider a nearer supplier for this shelter.",
      });
    }
  }
  const boatLanes = shipments.filter((shipment) => shipment.assigned && shipment.vehicleType === "relief_boat");
  const boatProviders = new Set(boatLanes.map((shipment) => shipment.providerId));
  if (boatLanes.length && boatProviders.size === 1) {
    risks.push({
      id: "single-boat-provider", category: "delivery", severity: "medium",
      title: `${boatLanes.length} flood-zone shipment(s) depend on one boat operator`,
      detail: `Only ${boatLanes[0].providerName} can reach the flooded area with the registered fleet.`,
      recommendation: "Register a second flood-capable operator, or stage supplies at the edge of the zone.",
    });
  }

  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  return risks.sort((a, b) => order[a.severity] - order[b.severity] || a.id.localeCompare(b.id));
}

/** "What if this supplier fails?" for each supplier in the plan, by re-running the engine. */
export function runScenarios(input: AllocationInput, plan: AllocationPlan): Scenario[] {
  const baseline = overallFulfilmentPct(plan);
  return plan.bySupplier.slice(0, 4).map((supplier) => {
    const without = allocate({
      ...input,
      offers: input.offers.map((offer) => offer.supplierId === supplier.supplierId
        ? { ...offer, eligible: false, exclusionReasons: ["Scenario: supplier unavailable."] }
        : offer),
    });
    const pct = overallFulfilmentPct(without);
    const delta = round1(pct - baseline);
    const unfulfilledUnits = without.unfulfilled.reduce((sum, line) => sum + line.quantity, 0);
    return {
      id: `fail-${supplier.supplierId}`,
      title: `${supplier.supplierName} cannot deliver`,
      description: `Re-allocate ${supplier.units} units (₹${round2(supplier.cost)}) across the remaining eligible suppliers within the same budget.`,
      fulfilmentPct: pct,
      fulfilmentDeltaPct: delta,
      costDelta: round2(without.totalCost - plan.totalCost),
      unfulfilledUnits,
      verdict: delta >= -1 ? "absorbed" : delta >= -15 ? "degraded" : "critical",
    } satisfies Scenario;
  });
}
