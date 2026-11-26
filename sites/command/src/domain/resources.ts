import type { ResourceId, Urgency } from "./types";

export interface ResourceSpec {
  id: ResourceId;
  label: string;
  unit: string;
  unitWeightKg: number;
  /** How quickly a shortage of this resource becomes dangerous, 0..1. Used in priority scoring. */
  criticality: number;
  color: string;
}

export const RESOURCES: Record<ResourceId, ResourceSpec> = {
  water_kits: { id: "water_kits", label: "Water kits", unit: "kits", unitWeightKg: 6, criticality: 1, color: "#0e7490" },
  medical_kits: { id: "medical_kits", label: "Medical kits", unit: "kits", unitWeightKg: 2.5, criticality: 0.9, color: "#b42318" },
  food_packets: { id: "food_packets", label: "Food packets", unit: "packets", unitWeightKg: 1.2, criticality: 0.8, color: "#b45309" },
  blankets: { id: "blankets", label: "Emergency blankets", unit: "blankets", unitWeightKg: 1.5, criticality: 0.5, color: "#475569" },
};

export const RESOURCE_IDS: ResourceId[] = ["food_packets", "water_kits", "medical_kits", "blankets"];

export const URGENCY_WEIGHT: Record<Urgency, number> = { critical: 1, high: 0.75, medium: 0.5, low: 0.25 };
export const URGENCY_ORDER: Urgency[] = ["critical", "high", "medium", "low"];

export function isResourceId(value: unknown): value is ResourceId {
  return typeof value === "string" && value in RESOURCES;
}

export function emptyResourceRecord<T>(make: (id: ResourceId) => T): Record<ResourceId, T> {
  return Object.fromEntries(RESOURCE_IDS.map((id) => [id, make(id)])) as Record<ResourceId, T>;
}

export const inr = (value: number): string =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Math.round(value));

/** A unit price, to the paisa: a quote of ₹170.70 must not read as ₹171. */
export const price = (value: number): string =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

export const num = (value: number): string => new Intl.NumberFormat("en-IN").format(value);

export const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
export const round1 = (value: number): number => Math.round((value + Number.EPSILON) * 10) / 10;
