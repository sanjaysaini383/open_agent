// Supplier matching (SupplierMatchingAgent's tool): turn raw partner offers into
// comparable, scored offers with an explicit eligibility decision for each.
import { estimateRoadKm, estimateTransitHours } from "./geo";
import { round2 } from "./resources";
import { cleanText, detectInjection } from "./sanitize";
import { isUsable } from "./trust";
import type { GeoPoint, OfferFlag, ResourceId, ScoredOffer, SupplierOffer, TrustEvaluation } from "./types";

export interface RawOffer {
  offerId: string;
  supplierId: string;
  organizationId: string;
  supplierName: string;
  supplierType: "ngo" | "commercial";
  resource: ResourceId;
  quantityAvailable: number;
  unitPrice: number;
  minOrder: number;
  leadTimeHours: number;
  location: GeoPoint & { city?: string };
  validUntil?: string;
  notes?: string;
}

export const COMPARISON_WEIGHTS = { price: 0.35, delivery: 0.25, distance: 0.1, reliability: 0.3 } as const;

/** An offer priced below this share of the other suppliers' median is flagged. */
export const PRICE_ANOMALY_RATIO = 0.5;

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Clean one raw offer and attach the flags that come from the offer alone. */
export function normaliseOffer(raw: RawOffer, others: RawOffer[], now: Date): SupplierOffer {
  const flags: OfferFlag[] = [];
  const rawNotes = raw.notes || "";

  const findings = detectInjection(rawNotes);
  if (findings.length) {
    const patterns = [...new Set(findings.map((finding) => finding.pattern))].join(", ");
    flags.push({ kind: "instruction_injection", severity: "critical", detail: `Supplier text contains instruction-like content (${patterns}). It is treated as data and was not acted on.` });
  }

  const peerPrices = others
    .filter((other) => other.resource === raw.resource && other.supplierId !== raw.supplierId)
    .map((other) => other.unitPrice);
  const peerMedian = median(peerPrices);
  if (peerPrices.length >= 2 && raw.unitPrice < peerMedian * PRICE_ANOMALY_RATIO) {
    const pct = Math.round((1 - raw.unitPrice / peerMedian) * 100);
    flags.push({ kind: "price_anomaly", severity: "warning", detail: `Unit price is ${pct}% below the median of other suppliers (₹${round2(peerMedian)}).` });
  }

  if (raw.validUntil && Number.isFinite(Date.parse(raw.validUntil)) && Date.parse(raw.validUntil) < now.getTime()) {
    flags.push({ kind: "expired_offer", severity: "warning", detail: `Offer validity ended ${raw.validUntil.slice(0, 10)}.` });
  }

  return {
    offerId: raw.offerId,
    supplierId: raw.supplierId,
    organizationId: raw.organizationId,
    supplierName: cleanText(raw.supplierName, 120),
    supplierType: raw.supplierType,
    resource: raw.resource,
    quantityAvailable: Math.max(0, Math.floor(raw.quantityAvailable)),
    listUnitPrice: round2(raw.unitPrice),
    unitPrice: round2(raw.unitPrice),
    minOrder: Math.max(0, Math.floor(raw.minOrder)),
    leadTimeHours: raw.leadTimeHours,
    location: { lat: raw.location.lat, lng: raw.location.lng, city: cleanText(raw.location.city || "", 80) },
    validUntil: raw.validUntil || "",
    notes: cleanText(rawNotes, 240),
    flags,
  };
}

/**
 * Score and rank offers per resource.
 *
 * score = 0.35 x price + 0.25 x delivery + 0.10 x distance + 0.30 x (1 - trust/100)
 * where price, delivery and distance are min-max normalised within the resource. Lower is
 * better. Ineligible offers are scored too, so the table shows why they lost, but they
 * get rank 0 and never reach the allocation engine.
 */
export function scoreOffers(input: {
  rawOffers: RawOffer[];
  trustByOrganization: Record<string, TrustEvaluation>;
  referencePoint: GeoPoint;
  now: Date;
  /** Organisation ids a person explicitly allowed although they are unverified. */
  overrides?: string[];
  /** Negotiated unit prices by offer id. */
  quotes?: Record<string, number>;
}): ScoredOffer[] {
  const { rawOffers, trustByOrganization, referencePoint, now } = input;
  const overrides = new Set(input.overrides || []);
  const prepared = rawOffers.map((raw) => {
    const offer = normaliseOffer(raw, rawOffers, now);
    const quoted = input.quotes?.[offer.offerId];
    if (typeof quoted === "number" && quoted > 0 && quoted <= offer.listUnitPrice) offer.unitPrice = round2(quoted);
    const evaluation = trustByOrganization[offer.organizationId];
    const trust = evaluation?.decision ?? "unverified";
    const trustScore = evaluation?.score ?? 0;
    const exclusionReasons: string[] = [];
    const flags = [...offer.flags];

    if (trust === "blocked") {
      flags.push({ kind: "blocked_supplier", severity: "critical", detail: evaluation?.blockers[0] || "Blocked by the trust check." });
      exclusionReasons.push(`Supplier is blocked: ${evaluation?.blockers[0] || "failed the trust check"}`);
    } else if (trust === "unverified") {
      flags.push({ kind: "unverified_supplier", severity: "warning", detail: "No record in the trust registry." });
      if (!overrides.has(offer.organizationId)) exclusionReasons.push("Supplier is unverified. A person must explicitly allow it before it can be used.");
    } else if (trust === "caution") {
      flags.push({ kind: "trust_caution", severity: "warning", detail: evaluation?.warnings[0] || "Verified with warnings." });
    }
    if (flags.some((flag) => flag.kind === "instruction_injection")) exclusionReasons.push("Supplier text tried to give instructions. The offer is excluded and cannot be overridden.");
    if (flags.some((flag) => flag.kind === "expired_offer")) exclusionReasons.push("The offer has expired.");
    if (offer.quantityAvailable <= 0) exclusionReasons.push("No stock available.");
    if (!isUsable(trust) && trust !== "unverified") { /* reason already recorded above */ }

    const distanceKm = estimateRoadKm(offer.location, referencePoint);
    const deliveryHours = offer.leadTimeHours + estimateTransitHours(offer.location, referencePoint);
    return { offer: { ...offer, flags }, trust, trustScore, exclusionReasons, distanceKm, deliveryHours };
  });

  const scored: ScoredOffer[] = [];
  const resources = [...new Set(prepared.map((item) => item.offer.resource))];
  for (const resource of resources) {
    const group = prepared.filter((item) => item.offer.resource === resource);
    const range = (values: number[]) => ({ min: Math.min(...values), max: Math.max(...values) });
    const price = range(group.map((item) => item.offer.unitPrice));
    const delivery = range(group.map((item) => item.deliveryHours));
    const distance = range(group.map((item) => item.distanceKm));
    const norm = (value: number, r: { min: number; max: number }) => (r.max > r.min ? (value - r.min) / (r.max - r.min) : 0);

    const rows = group.map((item) => {
      const parts = {
        price: round2(norm(item.offer.unitPrice, price)),
        delivery: round2(norm(item.deliveryHours, delivery)),
        distance: round2(norm(item.distanceKm, distance)),
        reliability: round2(1 - item.trustScore / 100),
      };
      const score = round2(
        COMPARISON_WEIGHTS.price * parts.price + COMPARISON_WEIGHTS.delivery * parts.delivery
        + COMPARISON_WEIGHTS.distance * parts.distance + COMPARISON_WEIGHTS.reliability * parts.reliability,
      );
      return {
        ...item.offer,
        trust: item.trust,
        trustScore: item.trustScore,
        eligible: item.exclusionReasons.length === 0,
        exclusionReasons: item.exclusionReasons,
        distanceKm: item.distanceKm,
        score,
        scoreParts: parts,
        rank: 0,
      } satisfies ScoredOffer;
    });
    rows.filter((row) => row.eligible)
      .sort((a, b) => a.score - b.score || a.unitPrice - b.unitPrice || a.offerId.localeCompare(b.offerId))
      .forEach((row, index) => { row.rank = index + 1; });
    scored.push(...rows.sort((a, b) => (a.rank || 99) - (b.rank || 99) || a.offerId.localeCompare(b.offerId)));
  }
  return scored;
}

export function eligibleSupply(offers: ScoredOffer[], resource: ResourceId): number {
  return offers.filter((offer) => offer.eligible && offer.resource === resource).reduce((sum, offer) => sum + offer.quantityAvailable, 0);
}
