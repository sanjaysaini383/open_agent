// The human-approval gate: what an approval binds, and when one is allowed at all.
import { describe, expect, it } from "vitest";
import { quotesFromEvents, withdrawQuote } from "@/domain/negotiation";
import type { AllocationLine, AllocationPlan, NegotiationEvent, ShipmentPlan } from "@/domain/types";
import { emptyRun } from "@/state/seed";
import type { WorkflowRun } from "@/state/types";
import { approvalDigest, approvalSubject, canApprove, reservationLines } from "./execution";

const line = (shelterId: string, offerId: string, quantity: number, unitPrice: number): AllocationLine => ({
  id: `${shelterId}:water_kits:${offerId}`, shelterId, shelterName: shelterId, resource: "water_kits", offerId,
  supplierId: offerId.slice(4, 5), supplierName: "Supplier", quantity, unitPrice, lineCost: quantity * unitPrice,
  deliveryHours: 10, onTime: true, reasons: ["because"],
});

const shipment = (reference: string, vehicles: number, assigned = true): ShipmentPlan => ({
  reference, supplierId: "S", supplierName: "Supplier", shelterId: "SH-01", shelterName: "Shelter",
  from: { lat: 1, lng: 1, label: "A" }, to: { lat: 2, lng: 2, label: "B" }, cargo: [{ resource: "water_kits", quantity: 10 }], weightKg: 60,
  readyInHours: 4, providerId: assigned ? "TR-1" : null, providerName: assigned ? "Fleet" : null, organizationId: assigned ? "ORG-TR-1" : null,
  vehicleType: assigned ? "light_truck" : null, vehicles: assigned ? vehicles : 0, haulKm: 50, etaHours: assigned ? 3 : null, totalHours: assigned ? 7 : null,
  cost: 1000, onTime: true, assigned, reason: "", advisories: [], alternatives: [], routeSource: "demo-dataset",
});

function runWith(lines = [line("SH-01", "OFF-A-WATER", 100, 60), line("SH-02", "OFF-A-WATER", 50, 60), line("SH-01", "OFF-B-WATER", 30, 55)], shipments = [shipment("SHP-1", 1)]): WorkflowRun {
  const run = emptyRun("INC-1", "2026-11-26T10:00:00.000Z");
  run.plan = { id: "INC-1-plan-v2", lines, unfulfilled: [], totalCost: 10650, budget: 20000 } as unknown as AllocationPlan;
  run.shipmentPlans = shipments;
  return run;
}

describe("what an approval binds", () => {
  it("is the same digest for the same plan, whatever the order of its lines", async () => {
    const a = runWith();
    const b = runWith([...a.plan!.lines].reverse());
    expect(await approvalDigest(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(await approvalDigest(b)).toBe(await approvalDigest(a));
  });

  it("changes when a quantity, a price, a supplier or a shipment changes", async () => {
    const base = await approvalDigest(runWith());
    expect(await approvalDigest(runWith([line("SH-01", "OFF-A-WATER", 101, 60), line("SH-02", "OFF-A-WATER", 50, 60), line("SH-01", "OFF-B-WATER", 30, 55)]))).not.toBe(base);
    expect(await approvalDigest(runWith([line("SH-01", "OFF-A-WATER", 100, 59.5), line("SH-02", "OFF-A-WATER", 50, 60), line("SH-01", "OFF-B-WATER", 30, 55)]))).not.toBe(base);
    expect(await approvalDigest(runWith([line("SH-01", "OFF-C-WATER", 100, 60), line("SH-02", "OFF-A-WATER", 50, 60), line("SH-01", "OFF-B-WATER", 30, 55)]))).not.toBe(base);
    expect(await approvalDigest(runWith(undefined, [shipment("SHP-1", 2)]))).not.toBe(base);
    expect(await approvalDigest(runWith(undefined, [shipment("SHP-1", 1), shipment("SHP-2", 1)]))).not.toBe(base);
  });

  it("does not change when only explanatory text changes", async () => {
    const run = runWith();
    const reworded = runWith(run.plan!.lines.map((item) => ({ ...item, reasons: ["a different explanation"] })));
    expect(await approvalDigest(reworded)).toBe(await approvalDigest(run));
  });

  it("covers only shipments that have transport", () => {
    expect(approvalSubject(runWith(undefined, [shipment("SHP-1", 1), shipment("SHP-2", 0, false)])).shipments).toHaveLength(1);
  });
});

describe("when a plan may be approved", () => {
  it("needs a valid plan and a transport plan", () => {
    expect(canApprove(emptyRun("INC-1"))).toMatchObject({ ok: false, reason: expect.stringMatching(/no allocation plan/) });
    expect(canApprove(runWith(undefined, []))).toMatchObject({ ok: false, reason: expect.stringMatching(/Plan the logistics first/) });
    const invalid = runWith();
    invalid.planProblems = ["Offer over-allocated."];
    expect(canApprove(invalid)).toMatchObject({ ok: false, reason: expect.stringMatching(/failed validation/) });
    expect(canApprove(runWith())).toEqual({ ok: true, reason: "" });
  });

  it("refuses once execution has begun", () => {
    const run = runWith();
    run.reservation = { status: "confirmed", reference: "AS-RSV-0001" };
    expect(canApprove(run).ok).toBe(false);
  });
});

describe("what is sent to the supplier", () => {
  it("aggregates the plan per offer, because a reservation lists each offer once", () => {
    expect(reservationLines(runWith())).toEqual([
      { offerId: "OFF-A-WATER", quantity: 150, unitPrice: 60 },
      { offerId: "OFF-B-WATER", quantity: 30, unitPrice: 55 },
    ]);
  });
});

describe("quotes follow the quantity they were given for", () => {
  const improved: NegotiationEvent = {
    id: "neg-1-OFF-B-FOOD", at: "2026-11-26T10:00:00.000Z", round: 1, offerId: "OFF-B-FOOD", supplierName: "North Bengal Aid Collective", resource: "food_packets",
    quantity: 700, listUnitPrice: 38, targetUnitPrice: 34.96, quotedUnitPrice: 35.15, discountPct: 7.5, saving: 1995, outcome: "improved", basis: [], note: "",
  };

  it("a later withdrawal removes the quote, so the list price is used", () => {
    expect(quotesFromEvents([improved])).toEqual({ "OFF-B-FOOD": { unitPrice: 35.15, quantity: 700 } });
    const withdrawn = withdrawQuote(improved, 2, new Date("2026-11-26T11:00:00.000Z"), 640);
    expect(withdrawn).toMatchObject({ round: 2, outcome: "unchanged", quotedUnitPrice: null, saving: 0, quantity: 640 });
    expect(quotesFromEvents([improved, withdrawn])).toEqual({});
  });

  it("a later re-quote replaces the earlier one", () => {
    const requote = { ...improved, id: "neg-2-OFF-B-FOOD", round: 2, quantity: 640, quotedUnitPrice: 35.2 };
    expect(quotesFromEvents([requote, improved])).toEqual({ "OFF-B-FOOD": { unitPrice: 35.2, quantity: 640 } });
  });
});
