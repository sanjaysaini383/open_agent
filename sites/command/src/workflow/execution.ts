// Steps 9 and 10: human approval, then execution and tracking.
//
// Nothing in this file is reachable by a model. An external write happens only when:
//   1. a person approved the exact plan (its digest is stored with the approval),
//   2. the plan still matches that digest at the moment of execution,
//   3. the person clicks to start the write, and
//   4. the person confirms it again in the partner site's own window.
// A write whose result never arrives is recorded as "unknown" and is never retried
// automatically.
import { canonicalJson, sha256Hex } from "@/domain/crypto";
import { logisticsTotals } from "@/domain/logistics";
import { inr } from "@/domain/resources";
import { deliveryReceipt, reservationReceipt, shipmentBooking, shipmentStatuses } from "@/domain/schemas";
import { applyTransition, canTransition, FINAL_STATUSES, STATUS_LABEL } from "@/domain/shipments";
import type { Shipment, ShipmentStatus } from "@/domain/types";
import { callRead, callWrite, openPeer, OutcomeUnknown } from "@/interop/peers";
import { useStore } from "@/state/store";
import type { ExternalWrite, WorkflowRun } from "@/state/types";
import { requirePeer, StepBlocked, withActivity, type StepOutcome } from "./context";

/** What a person is approving, reduced to the facts that bind the approval. */
export function approvalSubject(run: WorkflowRun) {
  return {
    planId: run.plan?.id ?? null,
    lines: (run.plan?.lines || []).map((line) => [line.offerId, line.shelterId, line.resource, line.quantity, line.unitPrice]).sort(),
    shipments: run.shipmentPlans.filter((item) => item.assigned).map((item) => [item.reference, item.providerId, item.vehicleType, item.vehicles, item.weightKg]).sort(),
  };
}

export async function approvalDigest(run: WorkflowRun): Promise<string> {
  return sha256Hex(canonicalJson(approvalSubject(run)));
}

export function reservationLines(run: WorkflowRun): { offerId: string; quantity: number; unitPrice: number }[] {
  const lines = new Map<string, { offerId: string; quantity: number; unitPrice: number }>();
  for (const line of run.plan?.lines || []) {
    const entry = lines.get(line.offerId) || { offerId: line.offerId, quantity: 0, unitPrice: line.unitPrice };
    entry.quantity += line.quantity;
    lines.set(line.offerId, entry);
  }
  return [...lines.values()].sort((a, b) => a.offerId.localeCompare(b.offerId));
}

export function canApprove(run: WorkflowRun): { ok: boolean; reason: string } {
  if (!run.plan) return { ok: false, reason: "There is no allocation plan to approve yet." };
  if (run.planProblems.length) return { ok: false, reason: "The plan failed validation and cannot be approved." };
  if (!run.shipmentPlans.length) return { ok: false, reason: "Plan the logistics first, so the approval covers transport too." };
  if (run.reservation.status === "confirmed" || run.booking.status === "confirmed") return { ok: false, reason: "This plan is already being executed." };
  return { ok: true, reason: "" };
}

export async function decidePlan(incidentId: string, approved: boolean, via: "dashboard" | "assistant", note = ""): Promise<{ ok: boolean; reason?: string; status?: string }> {
  const store = useStore.getState();
  const run = store.run(incidentId);
  const check = canApprove(run);
  if (!check.ok) return { ok: false, reason: check.reason };
  const now = new Date().toISOString();
  const digest = await approvalDigest(run);
  const unassigned = run.shipmentPlans.filter((item) => !item.assigned).length;
  store.patchRun(incidentId, {
    approval: { status: approved ? "approved" : "rejected", planId: run.plan!.id, digest, decidedAt: now, decidedBy: "human:coordinator", note: note.slice(0, 400), via },
  });
  store.setStep(incidentId, "approval", {
    status: approved ? "done" : "failed", startedAt: now, endedAt: now,
    summary: approved ? `Approved by the coordinator${via === "assistant" ? " (asked for through the agent console)" : ""}.` : undefined,
    error: approved ? undefined : `Rejected by the coordinator${note ? `: ${note}` : "."}`,
  });
  store.setStep(incidentId, "execute", approved ? { status: "waiting", summary: "Approved. Waiting for the coordinator to confirm each external write." } : { status: "idle", summary: undefined });
  await store.record({
    kind: "approval", actor: "human:coordinator", incidentId,
    summary: `${approved ? "APPROVED" : "REJECTED"} plan ${run.plan!.id}: ${run.plan!.lines.length} lines, ${inr(run.plan!.totalCost)} supplies + ${inr(logisticsTotals(run.shipmentPlans).cost)} transport`,
    data: { planId: run.plan!.id, digest, via, note, suppliers: run.plan!.bySupplier, shipments: run.shipmentPlans.length, unassignedShipments: unassigned, openRisks: run.risks.filter((risk) => risk.severity === "critical" || risk.severity === "high").length },
  });
  return { ok: true, status: approved ? "approved" : "rejected" };
}

async function assertApproved(run: WorkflowRun): Promise<void> {
  if (run.approval.status !== "approved") throw new StepBlocked("A person must approve the plan before anything is written to a partner site.");
  if (await approvalDigest(run) !== run.approval.digest) {
    throw new StepBlocked("The plan changed after it was approved. Review and approve the current plan again.");
  }
}

function receiptState(result: { ok: boolean; reason?: string; reference?: string; summary?: string; total?: number; totalCost?: number }): ExternalWrite {
  const at = new Date().toISOString();
  if (result.ok && result.reference) return { status: "confirmed", reference: result.reference, at, summary: result.summary, total: result.total ?? result.totalCost };
  const reason = result.reason || "The partner site did not confirm.";
  return { status: /declin|cancel/i.test(reason) ? "declined" : "refused", at, error: reason };
}

/** Reserve the approved allocation with AidSupply, in AidSupply's own window. */
export function reserveStock(incidentId: string): Promise<StepOutcome> {
  return withActivity({ incidentId, agent: "ResourceAllocationAgent", task: "Reserve approved allocation with the supplier marketplace", requiresApproval: true }, async (ctx) => {
    const run = ctx.run();
    await assertApproved(run);
    if (run.reservation.status === "confirmed") throw new StepBlocked(`Stock is already reserved (${run.reservation.reference}).`);
    if (run.reservation.status === "unknown") throw new StepBlocked("An earlier reservation attempt has an unknown outcome. Check AidSupply's reservations, then clear this state in the Execution panel.");
    const supplier = requirePeer("supplier", "supplier marketplace");
    const lines = reservationLines(run);
    const grant = await openPeer(supplier.id, ctx.call, `Reserve the approved allocation: ${lines.length} offers, ${inr(run.plan!.totalCost)}`, {
      calls: ["reserve_allocation (confirmed in the supplier marketplace's own window)"],
      dataShared: "The incident reference, offer ids, quantities and agreed unit prices.",
    });
    ctx.contacted(supplier);
    ctx.patch({ reservation: { status: "pending", at: new Date().toISOString() } });
    useStore.getState().setStep(incidentId, "execute", { status: "running", startedAt: new Date().toISOString() });
    try {
      const result = await callWrite(grant, "reserve_allocation", { incidentRef: ctx.incident.id, lines }, reservationReceipt);
      const state = receiptState(result);
      ctx.patch({ reservation: state });
      await useStore.getState().record({
        kind: "execution", actor: "human:coordinator", incidentId,
        summary: state.status === "confirmed" ? `Reservation ${state.reference} confirmed in ${supplier.label}'s window (${inr(state.total || 0)})` : `Reservation not made: ${state.error}`,
        data: { partner: supplier.networkUrl, action: "reserve_allocation", arguments: { incidentRef: ctx.incident.id, lines }, receipt: { reference: result.reference ?? null, total: result.total ?? null, ok: result.ok } },
      });
      useStore.getState().setStep(incidentId, "execute", { status: "waiting", summary: state.status === "confirmed" ? `Stock reserved (${state.reference}). Next: book transport.` : "Approved. The reservation was not made." });
      if (state.status !== "confirmed") return { summary: `Not reserved: ${state.error}`, warning: true };
      return { summary: `Reservation ${state.reference} confirmed by a person in ${supplier.label}'s own window. ${inr(state.total || 0)}. No payment is taken.` };
    } catch (error) {
      if (error instanceof OutcomeUnknown) ctx.patch({ reservation: { status: "unknown", at: new Date().toISOString(), error: error.message } });
      else ctx.patch({ reservation: { status: "none", error: (error as Error).message } });
      useStore.getState().setStep(incidentId, "execute", { status: "waiting" });
      throw error;
    }
  });
}

/** Book the approved shipments with RouteBridge, in RouteBridge's own window. */
export function bookTransport(incidentId: string): Promise<StepOutcome> {
  return withActivity({ incidentId, agent: "LogisticsAgent", task: "Book approved shipments with the logistics network", requiresApproval: true }, async (ctx) => {
    const run = ctx.run();
    await assertApproved(run);
    if (run.reservation.status !== "confirmed") throw new StepBlocked("Reserve the stock first: transport is not booked for supplies that are not reserved.");
    if (run.booking.status === "confirmed") throw new StepBlocked(`Transport is already booked (${run.booking.reference}).`);
    if (run.booking.status === "unknown") throw new StepBlocked("An earlier booking attempt has an unknown outcome. Check RouteBridge's shipments, then clear this state in the Execution panel.");
    const assigned = run.shipmentPlans.filter((item) => item.assigned);
    if (!assigned.length) throw new StepBlocked("No shipment has transport assigned.");
    const logisticsPeer = requirePeer("logistics", "logistics");
    const shipments = assigned.map((item) => ({
      reference: item.reference,
      providerId: item.providerId!,
      vehicleType: item.vehicleType!,
      vehicles: item.vehicles,
      from: { lat: item.from.lat, lng: item.from.lng, label: item.from.label },
      to: { lat: item.to.lat, lng: item.to.lng, label: item.to.label },
      weightKg: Math.max(1, item.weightKg),
      cargo: item.cargo.map((line) => ({ resource: line.resource, quantity: line.quantity })),
    }));
    const grant = await openPeer(logisticsPeer.id, ctx.call, `Book ${shipments.length} approved shipments`, {
      calls: ["create_shipments (confirmed in the logistics network's own window)"],
      dataShared: "The incident reference, pickup and delivery coordinates and labels, weights and cargo lines.",
    });
    ctx.contacted(logisticsPeer);
    ctx.patch({ booking: { status: "pending", at: new Date().toISOString() } });
    useStore.getState().setStep(incidentId, "execute", { status: "running" });
    try {
      const result = await callWrite(grant, "create_shipments", { incidentRef: ctx.incident.id, shipments }, shipmentBooking);
      const state = receiptState(result);
      const now = new Date().toISOString();
      const booked: Shipment[] = state.status === "confirmed"
        ? assigned.flatMap((plan) => {
          const match = result.shipments?.find((item) => item.reference === plan.reference);
          if (!match) return [];
          return [{ ...plan, trackingCode: match.trackingCode, bookingReference: state.reference!, status: "planned" as ShipmentStatus, history: [{ status: "planned" as ShipmentStatus, at: now, by: logisticsPeer.label, note: `Booked as ${match.trackingCode}` }] }];
        })
        : [];
      ctx.patch({ booking: state, shipments: booked });
      await useStore.getState().record({
        kind: "execution", actor: "human:coordinator", incidentId,
        summary: state.status === "confirmed" ? `Booking ${state.reference} confirmed in ${logisticsPeer.label}'s window: ${booked.length} shipments` : `Transport not booked: ${state.error}`,
        data: { partner: logisticsPeer.networkUrl, action: "create_shipments", shipments: shipments.map((item) => ({ reference: item.reference, providerId: item.providerId, vehicleType: item.vehicleType, vehicles: item.vehicles })), receipt: { reference: result.reference ?? null, trackingCodes: booked.map((item) => item.trackingCode), ok: result.ok } },
      });
      useStore.getState().setStep(incidentId, "execute", { status: "waiting", summary: state.status === "confirmed" ? `${booked.length} shipments booked (${state.reference}). Track them to delivery.` : "Stock reserved. Transport was not booked." });
      if (state.status !== "confirmed") return { summary: `Not booked: ${state.error}`, warning: true };
      return { summary: `Booking ${state.reference}: ${booked.length} shipments confirmed by a person in ${logisticsPeer.label}'s own window. No vehicle is really dispatched.` };
    } catch (error) {
      if (error instanceof OutcomeUnknown) ctx.patch({ booking: { status: "unknown", at: new Date().toISOString(), error: error.message } });
      else ctx.patch({ booking: { status: "none", error: (error as Error).message } });
      useStore.getState().setStep(incidentId, "execute", { status: "waiting" });
      throw error;
    }
  });
}

/** After a person has checked the partner site, an "unknown" write can be cleared to try again. */
export async function clearUnknown(incidentId: string, which: "reservation" | "booking"): Promise<void> {
  const store = useStore.getState();
  if (store.run(incidentId)[which].status !== "unknown") return;
  store.patchRun(incidentId, { [which]: { status: "none" } });
  await store.record({ kind: "execution", actor: "human:coordinator", incidentId, summary: `Cleared the unknown ${which} state after checking the partner site`, data: { which } });
}

function refreshExecuteStep(incidentId: string): void {
  const store = useStore.getState();
  const run = store.run(incidentId);
  if (!run.shipments.length) return;
  const open = run.shipments.filter((item) => !FINAL_STATUSES.includes(item.status)).length;
  const delivered = run.shipments.filter((item) => item.status === "delivered");
  const failed = run.shipments.filter((item) => item.status === "failed" || item.status === "cancelled").length;
  const unrecorded = delivered.filter((item) => !item.deliveryReceipt).length;
  if (open === 0 && unrecorded === 0) {
    store.setStep(incidentId, "execute", { status: failed ? "warning" : "done", endedAt: new Date().toISOString(), summary: `${delivered.length} of ${run.shipments.length} shipments delivered and recorded at the shelters${failed ? `; ${failed} failed or cancelled` : ""}.` });
  } else {
    store.setStep(incidentId, "execute", { status: "waiting", endedAt: undefined, summary: `${delivered.length} of ${run.shipments.length} delivered, ${open} open${unrecorded ? `, ${unrecorded} delivery receipt(s) to record` : ""}.` });
  }
}

/** A person updates a shipment's status. Only the documented transitions are allowed. */
export async function setShipmentStatus(incidentId: string, trackingCode: string, to: ShipmentStatus, note = ""): Promise<{ ok: boolean; reason?: string }> {
  const store = useStore.getState();
  const run = store.run(incidentId);
  const shipment = run.shipments.find((item) => item.trackingCode === trackingCode);
  if (!shipment) return { ok: false, reason: `No shipment with tracking code ${trackingCode}.` };
  const result = applyTransition(shipment, to, "human:coordinator", new Date(), note || undefined);
  if (!result.ok) return { ok: false, reason: result.reason };
  store.patchRun(incidentId, { shipments: run.shipments.map((item) => item.trackingCode === trackingCode ? result.shipment : item) });
  refreshExecuteStep(incidentId);
  await store.record({ kind: "shipment", actor: "human:coordinator", incidentId, summary: `${trackingCode}: ${STATUS_LABEL[shipment.status]} → ${STATUS_LABEL[to]}`, data: { trackingCode, from: shipment.status, to, note } });
  return { ok: true };
}

/** Read shipment statuses from RouteBridge and apply the ones that are legal moves. */
export function syncShipments(incidentId: string): Promise<StepOutcome> {
  return withActivity({ incidentId, agent: "LogisticsAgent", task: "Read shipment statuses from the logistics network" }, async (ctx) => {
    const run = ctx.run();
    if (!run.shipments.length) throw new StepBlocked("No shipments are booked yet.");
    const logisticsPeer = requirePeer("logistics", "logistics");
    const grant = await openPeer(logisticsPeer.id, ctx.call, `Read the status of ${run.shipments.length} shipments`, { calls: ["get_shipment_status"], dataShared: "Tracking codes only." });
    ctx.contacted(logisticsPeer);
    const result = await callRead(grant, "get_shipment_status", { trackingCodes: run.shipments.map((item) => item.trackingCode) }, shipmentStatuses);
    let changed = 0;
    let missing = 0;
    const shipments = run.shipments.map((item) => {
      const remote = result.shipments.find((entry) => entry.trackingCode === item.trackingCode);
      if (!remote?.found) { missing += 1; return item; }
      const status = remote.status as ShipmentStatus;
      if (!status || status === item.status || !canTransition(item.status, status)) return item;
      const moved = applyTransition(item, status, logisticsPeer.label, new Date(), "Reported by the logistics network");
      if (!moved.ok) return item;
      changed += 1;
      return moved.shipment;
    });
    ctx.patch({ shipments });
    refreshExecuteStep(incidentId);
    return {
      summary: `${changed} shipment(s) updated from ${logisticsPeer.label}.${missing ? ` ${missing} not visible from this page: on a static host the partner's bridge frame cannot see bookings made in its own window (storage is partitioned between sites).` : ""}`,
      warning: missing > 0,
    };
  });
}

/** Record delivered shipments at ShelterConnect, where a person at the shelter confirms receipt. */
export function recordDeliveries(incidentId: string): Promise<StepOutcome> {
  return withActivity({ incidentId, agent: "AuditAgent", task: "Record deliveries with the shelter network", requiresApproval: true }, async (ctx) => {
    const run = ctx.run();
    await assertApproved(run);
    const pending = run.shipments.filter((item) => item.status === "delivered" && !item.deliveryReceipt);
    if (!pending.length) throw new StepBlocked("No delivered shipment is waiting to be recorded.");
    const shelter = requirePeer("shelter", "shelter network");
    const deliveries = pending.flatMap((item) => item.cargo.map((line) => ({ shelterId: item.shelterId, resource: line.resource, quantity: line.quantity, shipmentRef: item.trackingCode })));
    if (deliveries.length > 40) throw new StepBlocked("More than 40 delivery lines are waiting; record them in two passes.");
    const grant = await openPeer(shelter.id, ctx.call, `Record ${pending.length} delivered shipment(s) into shelter stock`, {
      calls: ["record_deliveries (confirmed in the shelter network's own window)"],
      dataShared: "Shelter ids, resources, quantities and tracking codes.",
    });
    ctx.contacted(shelter);
    const result = await callWrite(grant, "record_deliveries", { deliveries }, deliveryReceipt);
    if (!result.ok || !result.reference) {
      await useStore.getState().record({ kind: "execution", actor: "human:coordinator", incidentId, summary: `Deliveries not recorded: ${result.reason || "not confirmed"}`, data: { partner: shelter.networkUrl, action: "record_deliveries" } });
      return { summary: `Not recorded: ${result.reason || "the shelter did not confirm."}`, warning: true };
    }
    const reference = result.reference;
    const codes = pending.map((item) => item.trackingCode);
    ctx.patch({
      shipments: ctx.run().shipments.map((item) => codes.includes(item.trackingCode) ? { ...item, deliveryReceipt: reference } : item),
      deliveries: [...ctx.run().deliveries, { reference, at: new Date().toISOString(), shipmentRefs: codes, lines: deliveries.length }],
    });
    refreshExecuteStep(incidentId);
    await useStore.getState().record({
      kind: "execution", actor: "human:coordinator", incidentId,
      summary: `Delivery receipt ${reference}: ${deliveries.length} lines confirmed at ${shelter.label}`,
      data: { partner: shelter.networkUrl, action: "record_deliveries", arguments: { deliveries }, receipt: { reference } },
    });
    return { summary: `Receipt ${reference}: ${deliveries.length} delivery lines confirmed by a person in ${shelter.label}'s own window and added to shelter stock.` };
  });
}
