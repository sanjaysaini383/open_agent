// Shipment status state machine. The same transitions RouteBridge enforces
// (docs/INTEROP_CONTRACTS.md, section 4), so the two sites cannot disagree on what is legal.
import type { Shipment, ShipmentStatus } from "./types";

export const TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  planned: ["dispatched", "cancelled"],
  dispatched: ["in_transit", "cancelled"],
  in_transit: ["delivered", "delayed", "failed"],
  delayed: ["in_transit", "delivered", "failed"],
  delivered: [],
  cancelled: [],
  failed: [],
};

export const FINAL_STATUSES: ShipmentStatus[] = ["delivered", "cancelled", "failed"];
export const OPEN_STATUSES: ShipmentStatus[] = ["planned", "dispatched", "in_transit", "delayed"];

export const STATUS_LABEL: Record<ShipmentStatus, string> = {
  planned: "Pending dispatch",
  dispatched: "Dispatched",
  in_transit: "In transit",
  delayed: "Delayed",
  delivered: "Delivered",
  cancelled: "Cancelled",
  failed: "Failed",
};

export function canTransition(from: ShipmentStatus, to: ShipmentStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextStatuses(status: ShipmentStatus): ShipmentStatus[] {
  return TRANSITIONS[status] ?? [];
}

export type TransitionResult = { ok: true; shipment: Shipment } | { ok: false; reason: string };

export function applyTransition(shipment: Shipment, to: ShipmentStatus, by: string, at: Date, note?: string): TransitionResult {
  if (!canTransition(shipment.status, to)) {
    const allowed = nextStatuses(shipment.status);
    return {
      ok: false,
      reason: allowed.length
        ? `A shipment that is ${STATUS_LABEL[shipment.status].toLowerCase()} can only become: ${allowed.map((status) => STATUS_LABEL[status].toLowerCase()).join(", ")}.`
        : `A shipment that is ${STATUS_LABEL[shipment.status].toLowerCase()} is final and cannot change.`,
    };
  }
  return {
    ok: true,
    shipment: { ...shipment, status: to, history: [...shipment.history, { status: to, at: at.toISOString(), by, ...(note ? { note } : {}) }] },
  };
}

export function needsIntervention(shipment: Shipment): boolean {
  return shipment.status === "delayed" || shipment.status === "failed";
}

export function summariseShipments(shipments: Shipment[]): Record<ShipmentStatus, number> & { total: number } {
  const counts = { planned: 0, dispatched: 0, in_transit: 0, delayed: 0, delivered: 0, cancelled: 0, failed: 0, total: shipments.length };
  for (const shipment of shipments) counts[shipment.status] += 1;
  return counts;
}
