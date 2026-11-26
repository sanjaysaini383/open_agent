// Shared domain types for ReliefMesh Command. Pure data: no React, no browser APIs.

export type ResourceId = "food_packets" | "water_kits" | "medical_kits" | "blankets";
export type Urgency = "low" | "medium" | "high" | "critical";
export type Severity = "low" | "moderate" | "high" | "critical";
export type IncidentCategory = "flood" | "cyclone" | "earthquake" | "landslide" | "fire" | "other";
export type IncidentStatus = "active" | "monitoring" | "closed";

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface Incident {
  id: string;
  name: string;
  category: IncidentCategory;
  location: GeoPoint & { name: string };
  severity: Severity;
  affectedPopulation: number;
  shelterCount: number;
  /** Declared total requirement per resource, as entered when the incident was created. */
  requirements: Record<ResourceId, number>;
  /** ISO time by which supplies must be delivered. */
  deadline: string;
  /** Spending limit for the response, in INR. */
  budget: number;
  status: IncidentStatus;
  simulated: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

// ---- needs ---------------------------------------------------------------------

export interface ShelterInfo {
  id: string;
  name: string;
  block: string;
  location: GeoPoint;
  capacity: number;
  occupancy: number;
  urgency: Urgency;
}

export interface NeedLine {
  id: string;
  shelterId: string;
  shelterName: string;
  resource: ResourceId;
  required: number;
  inStock: number;
  shortage: number;
  urgency: Urgency;
  peopleServed: number;
  neededBy: string;
  hoursToDeadline: number;
  priorityScore: number;
  priorityRank: number;
  priorityBasis: string[];
}

export interface ResourceTotals {
  declared: number;
  required: number;
  inStock: number;
  shortage: number;
}

export interface NeedsAssessment {
  incidentId: string;
  generatedAt: string;
  source: { networkUrl: string; label: string; simulated: boolean };
  shelters: ShelterInfo[];
  lines: NeedLine[];
  totals: Record<ResourceId, ResourceTotals>;
  discrepancies: string[];
}

// ---- trust ---------------------------------------------------------------------

export type TrustDecision = "verified" | "caution" | "unverified" | "blocked";
export type EvidenceStatus = "pass" | "warn" | "fail" | "info";

export interface TrustEvidence {
  id: string;
  label: string;
  weight: number;
  earned: number;
  status: EvidenceStatus;
  detail: string;
}

export interface TrustEvaluation {
  subjectId: string;
  subjectType: "agent_network" | "organization";
  name: string;
  decision: TrustDecision;
  score: number;
  evidence: TrustEvidence[];
  warnings: string[];
  blockers: string[];
  /** True only when an ECDSA signature was actually checked and was valid. */
  signatureVerified: boolean;
  evaluatedAt: string;
  registry: string;
}

// ---- suppliers and offers --------------------------------------------------------

export interface SupplierOffer {
  offerId: string;
  supplierId: string;
  organizationId: string;
  supplierName: string;
  supplierType: "ngo" | "commercial";
  resource: ResourceId;
  quantityAvailable: number;
  /** The supplier's published list price. */
  listUnitPrice: number;
  /** The price the allocation uses: the negotiated quote when there is one, else list. */
  unitPrice: number;
  minOrder: number;
  leadTimeHours: number;
  location: GeoPoint & { city: string };
  validUntil: string;
  notes: string;
  /** Findings from treating the supplier's free text as untrusted data. */
  flags: OfferFlag[];
}

export interface OfferFlag {
  kind: "instruction_injection" | "price_anomaly" | "unverified_supplier" | "blocked_supplier" | "trust_caution" | "expired_offer";
  severity: "info" | "warning" | "critical";
  detail: string;
}

export interface ScoredOffer extends SupplierOffer {
  trust: TrustDecision;
  trustScore: number;
  eligible: boolean;
  exclusionReasons: string[];
  distanceKm: number;
  /** Lower is better. Each term is normalised 0..1 within the resource's offers. */
  score: number;
  scoreParts: { price: number; delivery: number; distance: number; reliability: number };
  rank: number;
}

export interface NegotiationEvent {
  id: string;
  at: string;
  round: number;
  offerId: string;
  supplierName: string;
  resource: ResourceId;
  quantity: number;
  listUnitPrice: number;
  targetUnitPrice: number;
  quotedUnitPrice: number | null;
  discountPct: number;
  saving: number;
  outcome: "improved" | "unchanged" | "refused" | "skipped";
  basis: string[];
  note: string;
}

// ---- allocation ----------------------------------------------------------------

export interface LaneInfo {
  feasible: boolean;
  /** Transit hours from the supplier's dispatch point to the shelter. */
  transitHours: number;
  source: "estimate" | "routebridge";
  note?: string;
}

export interface AllocationLine {
  id: string;
  shelterId: string;
  shelterName: string;
  resource: ResourceId;
  offerId: string;
  supplierId: string;
  supplierName: string;
  quantity: number;
  unitPrice: number;
  lineCost: number;
  /** Supplier lead time plus transit. */
  deliveryHours: number;
  onTime: boolean;
  reasons: string[];
}

export interface UnfulfilledLine {
  shelterId: string;
  shelterName: string;
  resource: ResourceId;
  quantity: number;
  reason: "no_supply" | "budget" | "no_feasible_lane" | "min_order" | "supplier_excluded";
  detail: string;
}

export interface AllocationPlan {
  id: string;
  incidentId: string;
  generatedAt: string;
  version: number;
  lines: AllocationLine[];
  unfulfilled: UnfulfilledLine[];
  totalCost: number;
  budget: number;
  budgetRemaining: number;
  estimatedCompletionHours: number;
  fulfilment: Record<ResourceId, { shortage: number; allocated: number; pct: number }>;
  bySupplier: { supplierId: string; supplierName: string; cost: number; units: number }[];
  excludedOffers: { offerId: string; supplierName: string; reasons: string[] }[];
  weights: { cost: number; time: number; trust: number };
  method: string;
  notes: string[];
}

// ---- logistics -----------------------------------------------------------------

export type ShipmentStatus = "planned" | "dispatched" | "in_transit" | "delayed" | "delivered" | "cancelled" | "failed";

export interface TransportOption {
  providerId: string;
  organizationId: string;
  providerName: string;
  vehicleType: string;
  floodCapable: boolean;
  vehiclesNeeded: number;
  vehiclesAvailable: number;
  capacityKg: number;
  deadheadKm: number;
  haulKm: number;
  etaHours: number;
  cost: number;
  feasible: boolean;
  advisories: string[];
  routeSource: string;
}

export interface CargoLine {
  resource: ResourceId;
  quantity: number;
}

export interface ShipmentPlan {
  reference: string;
  supplierId: string;
  supplierName: string;
  shelterId: string;
  shelterName: string;
  from: GeoPoint & { label: string };
  to: GeoPoint & { label: string };
  cargo: CargoLine[];
  weightKg: number;
  readyInHours: number;
  providerId: string | null;
  providerName: string | null;
  organizationId: string | null;
  vehicleType: string | null;
  vehicles: number;
  haulKm: number;
  etaHours: number | null;
  totalHours: number | null;
  cost: number;
  onTime: boolean;
  assigned: boolean;
  reason: string;
  advisories: string[];
  alternatives: { providerName: string; vehicleType: string; etaHours: number; cost: number; feasible: boolean; note: string }[];
  routeSource: string;
}

export interface Shipment extends ShipmentPlan {
  trackingCode: string;
  bookingReference: string;
  status: ShipmentStatus;
  history: { status: ShipmentStatus; at: string; by: string; note?: string }[];
  deliveryReceipt?: string;
}

// ---- risk ----------------------------------------------------------------------

export interface Risk {
  id: string;
  category: "shortage" | "supplier" | "delivery" | "budget" | "trust" | "concentration";
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  detail: string;
  recommendation: string;
}

export interface Scenario {
  id: string;
  title: string;
  description: string;
  fulfilmentPct: number;
  fulfilmentDeltaPct: number;
  costDelta: number;
  unfulfilledUnits: number;
  verdict: "absorbed" | "degraded" | "critical";
}

// ---- audit ---------------------------------------------------------------------

export type AuditKind =
  | "incident" | "workflow" | "agent" | "consent" | "network" | "trust" | "offer" | "negotiation"
  | "allocation" | "logistics" | "approval" | "execution" | "shipment" | "security" | "system";

export interface AuditEntry {
  seq: number;
  at: string;
  kind: AuditKind;
  actor: string;
  incidentId: string | null;
  summary: string;
  data: unknown;
  prevHash: string;
  hash: string;
}
