import { describe, expect, it } from "vitest";
import { allocate, computeTargets, laneKey, overallFulfilmentPct, quantityByOffer, validateAllocation, type AllocationNeed, type AllocationOffer } from "./allocation";
import { fixtureInput, fixtureNeeds, NOW, policyQuote, RAW_OFFERS, toAllocationOffers, TRUST_BY_ORG } from "./fixtures";
import { planNegotiation, quotesFromEvents, recordQuote, totalSaving } from "./negotiation";
import { scoreOffers } from "./offers";
import type { LaneInfo } from "./types";

const scored = () => scoreOffers({ rawOffers: RAW_OFFERS, trustByOrganization: TRUST_BY_ORG, referencePoint: { lat: 25.14, lng: 87.93 }, now: NOW });
const offers = () => toAllocationOffers(scored());

describe("allocation engine — the demonstration scenario", () => {
  const input = fixtureInput({}, offers());
  const plan = allocate(input);

  it("produces a plan that passes every invariant", () => {
    expect(validateAllocation(input, plan)).toEqual([]);
  });

  it("covers every shortage from verified suppliers within the budget", () => {
    expect(plan.fulfilment.food_packets).toMatchObject({ shortage: 1650, allocated: 1650, pct: 100 });
    expect(plan.fulfilment.water_kits).toMatchObject({ shortage: 820, allocated: 820 });
    expect(plan.fulfilment.medical_kits).toMatchObject({ shortage: 243, allocated: 243 });
    expect(plan.fulfilment.blankets).toMatchObject({ shortage: 385, allocated: 385 });
    expect(plan.unfulfilled).toEqual([]);
    expect(plan.totalCost).toBeLessThanOrEqual(input.budget);
    expect(overallFulfilmentPct(plan)).toBe(100);
  });

  it("at list prices the budget binds, so it leans on cost and says so", () => {
    const balanced = allocate({ ...input, weights: { cost: 0.5, time: 0.3, trust: 0.2 } });
    expect(balanced.totalCost).toBeLessThanOrEqual(input.budget);
    expect(balanced.unfulfilled.some((line) => line.reason === "budget")).toBe(true);
    expect(plan.weights.cost).toBeGreaterThan(0.5);
    expect(plan.notes[0]).toMatch(/budget was binding/);
    expect(validateAllocation({ ...input, weights: balanced.weights }, balanced)).toEqual([]);
  });

  it("after negotiation the balanced weighting fits the budget and is cheaper than list", () => {
    const quantities = quantityByOffer(plan);
    const { requests } = planNegotiation(quantities, scored());
    const events = requests.map((request) => recordQuote(request, policyQuote(RAW_OFFERS.find((raw) => raw.offerId === request.offerId)!, request.quantity, request.targetUnitPrice), 1, NOW));
    expect(events.some((event) => event.outcome === "refused")).toBe(false);
    expect(events.filter((event) => event.outcome === "improved").length).toBeGreaterThanOrEqual(events.length / 2);
    const quotes = Object.fromEntries(Object.entries(quotesFromEvents(events)).map(([offerId, quote]) => [offerId, quote.unitPrice]));
    const negotiated = toAllocationOffers(scoreOffers({ rawOffers: RAW_OFFERS, trustByOrganization: TRUST_BY_ORG, referencePoint: { lat: 25.14, lng: 87.93 }, now: NOW, quotes }));
    const finalInput = fixtureInput({}, negotiated);
    const finalPlan = allocate(finalInput);
    expect(validateAllocation(finalInput, finalPlan)).toEqual([]);
    expect(overallFulfilmentPct(finalPlan)).toBe(100);
    expect(finalPlan.totalCost).toBeLessThan(plan.totalCost);
    expect(totalSaving(events)).toBeGreaterThan(5000);
  });

  it("never allocates from the unverified supplier, however cheap", () => {
    expect(plan.lines.some((line) => line.supplierId === "SUP-D")).toBe(false);
    expect(plan.excludedOffers.map((offer) => offer.offerId).sort()).toEqual(["OFF-D-FOOD", "OFF-D-MED"]);
  });

  it("is deterministic: the same input gives the same plan", () => {
    expect(allocate(fixtureInput({}, offers()))).toEqual(plan);
    const shuffled = fixtureInput({}, [...offers()].reverse());
    shuffled.needs = [...shuffled.needs].reverse();
    expect(allocate(shuffled).lines.map((line) => `${line.id}=${line.quantity}`).sort())
      .toEqual(plan.lines.map((line) => `${line.id}=${line.quantity}`).sort());
  });

  it("totals add up line by line", () => {
    const sum = plan.lines.reduce((total, line) => total + line.lineCost, 0);
    expect(Math.abs(sum - plan.totalCost)).toBeLessThan(0.05);
    expect(plan.budgetRemaining).toBeCloseTo(plan.budget - plan.totalCost, 2);
    expect(plan.bySupplier.reduce((total, supplier) => total + supplier.cost, 0)).toBeCloseTo(plan.totalCost, 1);
  });

  it("explains every line", () => {
    for (const line of plan.lines) {
      expect(line.reasons.length).toBeGreaterThanOrEqual(3);
      expect(line.reasons[0]).toMatch(/^Option /);
    }
  });
});

describe("allocation engine — constraints", () => {
  const one = (extra: Partial<AllocationOffer>): AllocationOffer => ({
    offerId: "O1", supplierId: "S1", supplierName: "Supplier One", resource: "water_kits", quantityAvailable: 100,
    unitPrice: 10, listUnitPrice: 10, minOrder: 1, leadTimeHours: 2, location: { lat: 25, lng: 88 }, trustScore: 90,
    eligible: true, exclusionReasons: [], ...extra,
  });
  const need = (shelterId: string, shortage: number, priorityScore: number, extra: Partial<AllocationNeed> = {}): AllocationNeed =>
    ({ shelterId, shelterName: shelterId, resource: "water_kits", shortage, priorityScore, hoursToDeadline: 36, ...extra });
  const lanesFor = (suppliers: string[], shelters: string[], info: Partial<LaneInfo> = {}): Record<string, LaneInfo> =>
    Object.fromEntries(suppliers.flatMap((supplier) => shelters.map((shelter) => [laneKey(supplier, shelter), { feasible: true, transitHours: 3, source: "estimate" as const, ...info }])));
  const base = { incidentId: "T", budget: 1_000_000, now: NOW };

  it("never allocates more than a supplier has", () => {
    const input = { ...base, needs: [need("A", 80, 90), need("B", 80, 60)], offers: [one({})], lanes: lanesFor(["S1"], ["A", "B"]) };
    const plan = allocate(input);
    expect(quantityByOffer(plan).O1).toBe(100);
    expect(plan.unfulfilled.reduce((sum, line) => sum + line.quantity, 0)).toBe(60);
    expect(validateAllocation(input, plan)).toEqual([]);
  });

  it("shares scarce supply by priority-weighted need instead of starving the lower priority", () => {
    const needs = [need("A", 80, 90), need("B", 80, 60)];
    const targets = computeTargets(needs, { food_packets: 0, water_kits: 100, medical_kits: 0, blankets: 0 });
    expect(targets.get("A:water_kits")).toBe(60);
    expect(targets.get("B:water_kits")).toBe(40);
    const plan = allocate({ ...base, needs, offers: [one({})], lanes: lanesFor(["S1"], ["A", "B"]) });
    const got = Object.fromEntries(plan.lines.map((line) => [line.shelterId, line.quantity]));
    expect(got).toEqual({ A: 60, B: 40 });
  });

  it("never orders more than a shelter is short", () => {
    const input = { ...base, needs: [need("A", 30, 90)], offers: [one({ quantityAvailable: 500 })], lanes: lanesFor(["S1"], ["A"]) };
    const plan = allocate(input);
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0].quantity).toBe(30);
  });

  it("stops at the budget and cuts the lowest priority first", () => {
    const input = { ...base, budget: 1000, needs: [need("A", 80, 90), need("B", 80, 60)], offers: [one({ quantityAvailable: 500 })], lanes: lanesFor(["S1"], ["A", "B"]) };
    const plan = allocate(input);
    expect(plan.totalCost).toBeLessThanOrEqual(1000);
    const got = Object.fromEntries(plan.lines.map((line) => [line.shelterId, line.quantity]));
    expect(got).toEqual({ A: 80, B: 20 });
    expect(plan.unfulfilled).toEqual([expect.objectContaining({ shelterId: "B", quantity: 60, reason: "budget" })]);
    expect(validateAllocation(input, plan)).toEqual([]);
  });

  it("allocates nothing with a zero budget, and reports why", () => {
    const plan = allocate({ ...base, budget: 0, needs: [need("A", 10, 90)], offers: [one({})], lanes: lanesFor(["S1"], ["A"]) });
    expect(plan.lines).toEqual([]);
    expect(plan.unfulfilled[0]).toMatchObject({ quantity: 10, reason: "budget" });
  });

  it("subtracts units already reserved, so nothing is allocated twice", () => {
    const input = { ...base, reserved: { O1: 70 }, needs: [need("A", 80, 90)], offers: [one({})], lanes: lanesFor(["S1"], ["A"]) };
    const plan = allocate(input);
    expect(plan.lines[0].quantity).toBe(30);
    expect(plan.unfulfilled[0].quantity).toBe(50);
    expect(validateAllocation(input, plan)).toEqual([]);
  });

  it("raises an offer to its minimum order by moving units from a dearer supplier, losing no fulfilment", () => {
    // S1 is cheapest but only has 80; S3 would get the last 20, below its minimum of 50.
    const input = {
      ...base,
      needs: [need("A", 100, 90)],
      offers: [
        one({ quantityAvailable: 80 }),
        one({ offerId: "O3", supplierId: "S3", supplierName: "Supplier Three", unitPrice: 12, listUnitPrice: 12, minOrder: 50 }),
      ],
      lanes: lanesFor(["S1", "S3"], ["A"]),
    };
    const plan = allocate(input);
    expect(quantityByOffer(plan)).toEqual({ O1: 50, O3: 50 });
    expect(plan.fulfilment.water_kits).toMatchObject({ shortage: 100, allocated: 100 });
    expect(plan.notes.join(" ")).toMatch(/raised from 20 to its minimum order of 50/);
    expect(validateAllocation(input, plan)).toEqual([]);
  });

  it("drops an offer that would fall below its minimum order", () => {
    const input = { ...base, needs: [need("A", 30, 90)], offers: [one({ minOrder: 50 }), one({ offerId: "O2", supplierId: "S2", supplierName: "Supplier Two", unitPrice: 14, listUnitPrice: 14 })], lanes: lanesFor(["S1", "S2"], ["A"]) };
    const plan = allocate(input);
    expect(plan.lines.map((line) => line.offerId)).toEqual(["O2"]);
    expect(plan.notes.join(" ")).toMatch(/minimum order/);
    expect(validateAllocation(input, plan)).toEqual([]);
  });

  it("skips an infeasible lane and reports it when nothing else can reach the shelter", () => {
    const lanes = { ...lanesFor(["S1"], ["A"], { feasible: false }), ...lanesFor(["S1"], ["B"]) };
    const plan = allocate({ ...base, needs: [need("A", 20, 90), need("B", 20, 60)], offers: [one({})], lanes });
    expect(plan.lines.map((line) => line.shelterId)).toEqual(["B"]);
    expect(plan.unfulfilled[0]).toMatchObject({ shelterId: "A", reason: "no_feasible_lane" });
  });

  it("prefers an on-time offer over a cheaper late one", () => {
    const lanes = { [laneKey("S1", "A")]: { feasible: true, transitHours: 60, source: "estimate" as const }, [laneKey("S2", "A")]: { feasible: true, transitHours: 3, source: "estimate" as const } };
    const plan = allocate({ ...base, needs: [need("A", 20, 90)], offers: [one({ unitPrice: 5, listUnitPrice: 5 }), one({ offerId: "O2", supplierId: "S2", supplierName: "Supplier Two", unitPrice: 20, listUnitPrice: 20 })], lanes });
    expect(plan.lines[0]).toMatchObject({ offerId: "O2", onTime: true });
  });

  it("uses a late offer only when no on-time stock exists, and says so", () => {
    const lanes = { [laneKey("S1", "A")]: { feasible: true, transitHours: 60, source: "estimate" as const } };
    const plan = allocate({ ...base, needs: [need("A", 20, 90)], offers: [one({})], lanes });
    expect(plan.lines[0].onTime).toBe(false);
    expect(plan.lines[0].reasons.join(" ")).toMatch(/LATE/);
    expect(plan.notes.join(" ")).toMatch(/after the deadline/);
  });

  it("ignores invalid quantities instead of producing negative or fractional lines", () => {
    const input = { ...base, needs: [need("A", -5, 90), need("B", 12.9, 80), need("C", Number.NaN, 70)], offers: [one({ quantityAvailable: 40.7 })], lanes: lanesFor(["S1"], ["A", "B", "C"]) };
    const plan = allocate(input);
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]).toMatchObject({ shelterId: "B", quantity: 12 });
    for (const line of plan.lines) expect(Number.isInteger(line.quantity) && line.quantity > 0).toBe(true);
  });

  it("reports excluded suppliers as the reason when every offer is ineligible", () => {
    const plan = allocate({ ...base, needs: [need("A", 10, 90)], offers: [one({ eligible: false, exclusionReasons: ["Supplier is unverified."] })], lanes: lanesFor(["S1"], ["A"]) });
    expect(plan.unfulfilled[0].reason).toBe("supplier_excluded");
  });

  it("validateAllocation catches a tampered plan", () => {
    const input = { ...base, needs: [need("A", 30, 90)], offers: [one({})], lanes: lanesFor(["S1"], ["A"]) };
    const plan = allocate(input);
    const tampered = { ...plan, lines: [{ ...plan.lines[0], quantity: 500 }] };
    const problems = validateAllocation(input, tampered).join(" ");
    expect(problems).toMatch(/over-allocated/);
    expect(problems).toMatch(/Over-ordering/);
    expect(validateAllocation(input, { ...plan, lines: [plan.lines[0], plan.lines[0]] }).join(" ")).toMatch(/Duplicate/);
  });
});

describe("allocation engine — scenario fixtures stay consistent", () => {
  it("has sixteen needs matching the shelter data", () => {
    expect(fixtureNeeds()).toHaveLength(16);
  });
});
