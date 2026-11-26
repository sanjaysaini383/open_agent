// Zod schemas for everything that crosses a boundary: what partners send us, and what
// people type into forms. A partner payload that does not fit is rejected outright.
// z.object() strips unknown keys, so a partner cannot smuggle extra fields into our state.
import { z } from "zod";

const text = (max: number) => z.string().max(max * 4).transform((value) => value.slice(0, max));
const count = z.number().int().min(0).max(10_000_000);
const money = z.number().min(0).max(1_000_000_000);
const hours = z.number().min(0).max(10_000);

export const geoPoint = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const resourceId = z.enum(["food_packets", "water_kits", "medical_kits", "blankets"]);
export const urgency = z.enum(["low", "medium", "high", "critical"]);

const envelope = {
  simulated: z.boolean().optional().default(true),
  dataNotice: text(300).optional().default(""),
  source: text(200).optional().default(""),
  generatedAt: text(40).optional().default(""),
};

// ---- ShelterConnect ---------------------------------------------------------------

export const shelterOverview = z.object({
  ...envelope,
  shelters: z.array(z.object({
    id: text(20),
    name: text(120),
    block: text(80).optional().default(""),
    location: geoPoint,
    capacity: count,
    occupancy: count,
    urgency,
  })).max(500),
});

export const resourceRequests = z.object({
  ...envelope,
  requests: z.array(z.object({
    id: text(60),
    shelterId: text(20),
    shelterName: text(120),
    resource: resourceId,
    quantityRequired: count,
    quantityInStock: count,
    shortage: count,
    urgency,
    peopleServed: count.optional().default(0),
    neededBy: text(40),
    status: text(20),
  })).max(5000),
});

export const deliveryReceipt = z.object({
  ok: z.boolean(),
  reason: text(300).optional(),
  reference: text(40).optional(),
  summary: text(300).optional(),
  recorded: z.array(z.object({
    shelterId: text(20), resource: resourceId, quantity: count, shipmentRef: text(40), newStock: count.optional(),
  })).max(100).optional(),
});

// ---- AidSupply -------------------------------------------------------------------

export const supplierDirectory = z.object({
  ...envelope,
  suppliers: z.array(z.object({
    id: text(20),
    organizationId: text(40),
    name: text(120),
    type: z.enum(["ngo", "commercial"]),
    city: text(80),
    location: geoPoint,
    registrationRef: text(80).optional().default(""),
  })).max(500),
});

export const supplierOffers = z.object({
  ...envelope,
  offers: z.array(z.object({
    offerId: text(40),
    supplierId: text(20),
    organizationId: text(40),
    supplierName: text(120),
    supplierType: z.enum(["ngo", "commercial"]),
    resource: resourceId,
    quantityAvailable: count,
    unitPrice: money,
    minOrder: count,
    leadTimeHours: hours,
    location: geoPoint.extend({ city: text(80).optional().default("") }),
    validUntil: text(40).optional().default(""),
    // Free text from the supplier. Kept long enough to scan, never trusted.
    notes: z.string().max(4000).optional().default(""),
  })).max(2000),
});

export const improvedOffer = z.object({
  ok: z.boolean(),
  reason: text(300).optional(),
  field: text(40).optional(),
  quote: z.object({
    offerId: text(40),
    supplierName: text(120).optional().default(""),
    quantity: count,
    listUnitPrice: money,
    quotedUnitPrice: money,
    discountPct: z.number().min(0).max(100),
    total: money,
    saving: money.optional().default(0),
    basis: z.array(text(200)).max(10).optional().default([]),
    leadTimeHours: hours.optional(),
    binding: z.boolean().optional().default(false),
    validUntil: text(40).optional().default(""),
  }).optional(),
});

export const reservationReceipt = z.object({
  ok: z.boolean(),
  reason: text(300).optional(),
  reference: text(40).optional(),
  summary: text(300).optional(),
  total: money.optional(),
  lines: z.array(z.object({
    offerId: text(40), supplierId: text(20).optional(), supplierName: text(120).optional(),
    resource: resourceId, quantity: count, unitPrice: money, lineTotal: money,
  })).max(100).optional(),
});

// ---- TrustRegistry ----------------------------------------------------------------

export const publicKeyJwk = z.object({
  kty: z.literal("EC"),
  crv: z.literal("P-256"),
  x: z.string().min(40).max(50),
  y: z.string().min(40).max(50),
});

export const registryInfo = z.object({
  ...envelope,
  registry: z.object({
    name: text(120),
    issuer: text(200).optional().default(""),
    simulatedAuthority: z.boolean().optional().default(true),
    algorithm: text(40),
    keys: z.array(z.object({
      kid: text(40),
      publicKeyJwk,
      fingerprint: text(80),
      createdAt: text(40).optional().default(""),
    })).min(1).max(10),
  }),
});

export const attestationPayload = z.object({
  v: z.number().int(),
  type: z.enum(["agent_network", "organization"]),
  subjectId: z.string().max(120),
  name: z.string().max(200),
  status: z.enum(["active", "suspended", "revoked"]),
  networkUrl: z.string().max(300).optional(),
  networkDigest: z.string().max(100).nullable().optional(),
  capabilities: z.array(z.string().max(80)).max(50).optional(),
  credentials: z.array(z.object({
    type: z.string().max(120),
    issuer: z.string().max(200),
    id: z.string().max(120),
    validFrom: z.string().max(20),
    validUntil: z.string().max(20),
    status: z.string().max(20).optional(),
  }).passthrough()).max(30),
  issuedAt: z.string().max(40),
  expiresAt: z.string().max(40),
  simulated: z.boolean(),
}).passthrough(); // signed bytes: keep every field exactly as sent, or the signature would not verify

export const verification = z.object({
  ...envelope,
  found: z.boolean(),
  subjectId: text(120).optional().default(""),
  record: z.object({
    name: text(200),
    status: z.enum(["active", "suspended", "revoked", "pending"]),
    capabilities: z.array(text(80)).max(50).optional(),
    type: text(40).optional(),
    registeredAt: text(40).optional(),
  }).nullable().optional(),
  attestation: z.object({
    payload: attestationPayload,
    signature: z.string().min(20).max(200),
    kid: text(40),
  }).nullable().optional(),
  reputation: z.object({
    completed: count,
    disputes: count,
    fulfilmentRate: z.number().min(0).max(1),
    lastActivity: text(40).optional(),
  }).passthrough().nullable().optional(),
  reports: z.object({
    open: count,
    items: z.array(z.object({ reference: text(40), reason: text(60), reportedAt: text(40).optional() })).max(50).optional().default([]),
  }).optional().default({ open: 0, items: [] }),
});

export const reportReceipt = z.object({
  ok: z.boolean(),
  reason: text(300).optional(),
  reference: text(40).optional(),
  summary: text(300).optional(),
});

// ---- RouteBridge -----------------------------------------------------------------

export const transportProviders = z.object({
  ...envelope,
  providers: z.array(z.object({
    id: text(20),
    organizationId: text(40),
    name: text(120),
    base: geoPoint.extend({ city: text(80).optional().default("") }),
    fleet: z.array(z.object({
      vehicleType: text(40),
      count,
      available: count,
      capacityKg: z.number().min(0).max(1_000_000),
      avgSpeedKmh: z.number().min(0).max(300),
      ratePerKm: money,
      floodCapable: z.boolean().optional().default(false),
    })).max(50),
  })).max(500),
  floodZones: z.array(z.object({
    id: text(20), name: text(120), center: geoPoint, radiusKm: z.number().min(0).max(1000),
    effect: text(40), delayHours: z.number().min(0).max(100).optional(), note: text(300).optional(),
  })).max(100).optional().default([]),
  routing: z.object({ source: text(40), method: text(200).optional().default(""), note: text(300).optional().default("") }).optional(),
});

export const transportOptions = z.object({
  ...envelope,
  haulKm: z.number().min(0).max(100_000).optional().default(0),
  zone: z.object({ id: text(20), name: text(120), effect: text(40) }).passthrough().nullable().optional(),
  options: z.array(z.object({
    providerId: text(20),
    organizationId: text(40),
    providerName: text(120),
    vehicleType: text(40),
    floodCapable: z.boolean().optional().default(false),
    vehiclesNeeded: count,
    vehiclesAvailable: count,
    capacityKg: z.number().min(0).max(1_000_000),
    deadheadKm: z.number().min(0).max(100_000),
    haulKm: z.number().min(0).max(100_000),
    etaHours: hours,
    cost: money,
    feasible: z.boolean(),
    advisories: z.array(text(300)).max(10).optional().default([]),
    routeSource: text(40).optional().default("demo-dataset"),
  })).max(200),
  routing: z.object({ source: text(40) }).passthrough().optional(),
});

export const routeEstimates = z.object({
  ...envelope,
  legs: z.array(z.object({
    id: text(80),
    haulKm: z.number().min(0).max(100_000),
    zone: z.object({ id: text(20), name: text(120), effect: text(40) }).nullable().optional(),
    truckFeasible: z.boolean(),
    boatRequired: z.boolean(),
    bestCaseHours: z.object({ light_truck: hours, heavy_truck: hours, relief_boat: hours }),
  })).max(200),
  routing: z.object({ source: text(40) }).passthrough().optional(),
});

export const shipmentBooking = z.object({
  ok: z.boolean(),
  reason: text(300).optional(),
  reference: text(40).optional(),
  summary: text(300).optional(),
  totalCost: money.optional(),
  shipments: z.array(z.object({
    reference: text(40),
    trackingCode: text(40),
    providerId: text(20).optional(),
    providerName: text(120).optional(),
    vehicleType: text(40).optional(),
    vehicles: count.optional(),
    etaHours: hours.optional(),
    cost: money.optional(),
    status: text(20).optional(),
  })).max(100).optional(),
});

export const shipmentStatuses = z.object({
  ...envelope,
  shipments: z.array(z.object({
    trackingCode: text(40),
    found: z.boolean(),
    status: text(20).optional(),
    updatedAt: text(40).optional(),
  })).max(200),
});

// ---- forms ----------------------------------------------------------------------

export const incidentForm = z.object({
  name: z.string().trim().min(3, "Give the incident a name of at least 3 characters.").max(120),
  category: z.enum(["flood", "cyclone", "earthquake", "landslide", "fire", "other"]),
  locationName: z.string().trim().min(2, "Enter a location.").max(120),
  lat: z.number({ invalid_type_error: "Latitude must be a number." }).min(-90).max(90),
  lng: z.number({ invalid_type_error: "Longitude must be a number." }).min(-180).max(180),
  severity: z.enum(["low", "moderate", "high", "critical"]),
  affectedPopulation: z.number({ invalid_type_error: "Enter the affected population." }).int().min(1).max(100_000_000),
  shelterCount: z.number().int().min(0).max(100_000),
  food_packets: z.number().int().min(0).max(10_000_000),
  water_kits: z.number().int().min(0).max(10_000_000),
  medical_kits: z.number().int().min(0).max(10_000_000),
  blankets: z.number().int().min(0).max(10_000_000),
  deadline: z.string().refine((value) => Number.isFinite(Date.parse(value)), "Enter a delivery deadline."),
  budget: z.number({ invalid_type_error: "Enter a budget." }).min(0).max(1_000_000_000),
  notes: z.string().max(600).optional(),
});

export const partnerUrlForm = z.object({
  networkUrl: z.string().trim().url("Enter the partner's full network URL.").max(300),
  label: z.string().trim().min(2).max(60),
  role: z.enum(["shelter", "supplier", "trust", "logistics", "other"]),
});

export type IncidentFormValues = z.infer<typeof incidentForm>;
export type VerificationResult = z.infer<typeof verification>;
export type RegistryInfo = z.infer<typeof registryInfo>;
export type TransportOptionsResult = z.infer<typeof transportOptions>;
