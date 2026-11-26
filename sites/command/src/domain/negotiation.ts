// Negotiation planning (NegotiationAgent's tool).
//
// The agent asks a supplier for a better price on the exact quantity the draft plan
// would buy. A quote is non-binding and commits nothing: only a person can turn a plan
// into a reservation. This module decides what to ask for and records what came back.
import { round2 } from "./resources";
import type { NegotiationEvent, ResourceId, ScoredOffer } from "./types";

export interface NegotiationRequest {
  offerId: string;
  supplierName: string;
  resource: ResourceId;
  quantity: number;
  listUnitPrice: number;
  targetUnitPrice: number;
  rationale: string;
}

export interface QuoteReply {
  ok: boolean;
  reason?: string;
  quote?: { quantity: number; listUnitPrice: number; quotedUnitPrice: number; discountPct: number; basis: string[] };
}

/** Ask for this share off list when the offer is already the cheapest one. */
export const OPENING_DISCOUNT = 0.08;

/**
 * What to ask each supplier in the draft plan.
 *
 * Target = the lower of (list price less 8%) and (the best competing eligible list price
 * for the same resource). A request is only made where it is appropriate: the offer is
 * eligible, the plan actually buys from it, and the quantity meets its minimum order.
 */
export function planNegotiation(quantities: Record<string, number>, offers: ScoredOffer[]): { requests: NegotiationRequest[]; skipped: { offerId: string; reason: string }[] } {
  const requests: NegotiationRequest[] = [];
  const skipped: { offerId: string; reason: string }[] = [];
  for (const offerId of Object.keys(quantities).sort()) {
    const quantity = quantities[offerId];
    const offer = offers.find((item) => item.offerId === offerId);
    if (!offer || quantity <= 0) continue;
    if (!offer.eligible) { skipped.push({ offerId, reason: "Offer is not eligible; no negotiation with an excluded supplier." }); continue; }
    if (quantity < offer.minOrder) { skipped.push({ offerId, reason: `Quantity ${quantity} is below the minimum order of ${offer.minOrder}.` }); continue; }
    const competitors = offers.filter((item) => item.eligible && item.resource === offer.resource && item.supplierId !== offer.supplierId);
    const benchmark = competitors.length ? Math.min(...competitors.map((item) => item.listUnitPrice)) : Infinity;
    const opening = round2(offer.listUnitPrice * (1 - OPENING_DISCOUNT));
    const target = round2(Math.min(opening, benchmark));
    requests.push({
      offerId,
      supplierName: offer.supplierName,
      resource: offer.resource,
      quantity,
      listUnitPrice: offer.listUnitPrice,
      targetUnitPrice: target,
      rationale: benchmark < opening
        ? `Asked to match the best competing list price (₹${round2(benchmark)}).`
        : `Asked for ${Math.round(OPENING_DISCOUNT * 100)}% off list for ${quantity} units.`,
    });
  }
  return { requests, skipped };
}

/** Turn a supplier's reply into an audit-ready event. Never accepts a price above list. */
export function recordQuote(request: NegotiationRequest, reply: QuoteReply, round: number, at: Date): NegotiationEvent {
  const base = {
    id: `neg-${round}-${request.offerId}`,
    at: at.toISOString(),
    round,
    offerId: request.offerId,
    supplierName: request.supplierName,
    resource: request.resource,
    quantity: request.quantity,
    listUnitPrice: request.listUnitPrice,
    targetUnitPrice: request.targetUnitPrice,
  };
  if (!reply.ok || !reply.quote) {
    return { ...base, quotedUnitPrice: null, discountPct: 0, saving: 0, outcome: "refused", basis: [], note: reply.reason || "The supplier declined to quote." };
  }
  const quoted = round2(reply.quote.quotedUnitPrice);
  // A reply for a different quantity, or above list, is not an improvement: ignore it.
  if (reply.quote.quantity !== request.quantity || quoted > request.listUnitPrice || quoted <= 0) {
    return { ...base, quotedUnitPrice: null, discountPct: 0, saving: 0, outcome: "unchanged", basis: [], note: "The reply did not match the request, so the list price stands." };
  }
  const saving = round2((request.listUnitPrice - quoted) * request.quantity);
  return {
    ...base,
    quotedUnitPrice: quoted,
    discountPct: round2((1 - quoted / request.listUnitPrice) * 100),
    saving,
    outcome: saving > 0 ? "improved" : "unchanged",
    basis: reply.quote.basis.slice(0, 6),
    note: saving > 0 ? `${request.rationale} Supplier quoted ₹${quoted}.` : `${request.rationale} Supplier kept the list price.`,
  };
}

/**
 * The negotiated price per offer. The latest event for each offer decides: a later
 * refusal, or a later note that the quantity changed, withdraws an earlier quote.
 */
export function quotesFromEvents(events: NegotiationEvent[]): Record<string, { unitPrice: number; quantity: number }> {
  const quotes: Record<string, { unitPrice: number; quantity: number }> = {};
  for (const event of [...events].sort((a, b) => a.round - b.round)) {
    if (event.outcome === "improved" && event.quotedUnitPrice !== null) quotes[event.offerId] = { unitPrice: event.quotedUnitPrice, quantity: event.quantity };
    else delete quotes[event.offerId];
  }
  return quotes;
}

/** An event recording that a quote no longer applies, because the planned quantity moved. */
export function withdrawQuote(previous: NegotiationEvent, round: number, at: Date, plannedQuantity: number): NegotiationEvent {
  return {
    ...previous,
    id: `neg-${round}-${previous.offerId}`,
    at: at.toISOString(),
    round,
    quantity: plannedQuantity,
    quotedUnitPrice: null,
    discountPct: 0,
    saving: 0,
    outcome: "unchanged",
    basis: [],
    note: `The plan now needs ${plannedQuantity} units, not the ${previous.quantity} that were quoted, so the list price is used.`,
  };
}

export function totalSaving(events: NegotiationEvent[]): number {
  const latest = new Map<string, NegotiationEvent>();
  for (const event of [...events].sort((a, b) => a.round - b.round)) latest.set(event.offerId, event);
  return round2([...latest.values()].reduce((sum, event) => sum + (event.outcome === "improved" ? event.saving : 0), 0));
}
