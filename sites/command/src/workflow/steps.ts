// The automated workflow steps (2 to 8). Each one is the tool of the agent that owns it,
// run directly by the workflow engine: deterministic arithmetic, schema checks and real
// calls to partners' shared actions. No model takes part, and the UI says so. The same
// functions back the website_* tools a model-driven agent calls from the console.
import { allocate, laneKey, overallFulfilmentPct, quantityByOffer, validateAllocation, type AllocationInput, type AllocationNeed, type AllocationOffer } from "@/domain/allocation";
import { centroid, estimateTransitHours } from "@/domain/geo";
import { assignTransport, buildLanes, logisticsTotals } from "@/domain/logistics";
import { assessNeeds, totalShortage } from "@/domain/needs";
import { planNegotiation, quotesFromEvents, recordQuote, totalSaving, withdrawQuote, type NegotiationRequest } from "@/domain/negotiation";
import { scoreOffers } from "@/domain/offers";
import { inr, num, RESOURCE_IDS, RESOURCES } from "@/domain/resources";
import { analyseRisks, runScenarios } from "@/domain/risk";
import { improvedOffer, resourceRequests, routeEstimates, shelterOverview, supplierDirectory, supplierOffers, transportOptions, transportProviders } from "@/domain/schemas";
import { isUsable } from "@/domain/trust";
import type { AllocationPlan, GeoPoint, LaneInfo, NegotiationEvent, ScoredOffer, TransportOption, TrustEvaluation } from "@/domain/types";
import { askConsent, callRead, connect, ConsentDeclined, openPeer, openRegistry, verifyOrganization, verifyPeer, type Grant } from "@/interop/peers";
import { useStore } from "@/state/store";
import type { PeerRecord, ProviderInfo, StepId, SupplierInfo } from "@/state/types";
import { requirePeer, StepBlocked, stepDefinition, withActivity, type StepContext, type StepOutcome, type StepResult } from "./context";

// ---- shared helpers ----------------------------------------------------------------

function trustMap() {
  return useStore.getState().orgTrust;
}

function needsOf(ctx: StepContext): AllocationNeed[] {
  const assessment = ctx.run().assessment;
  if (!assessment) return [];
  return assessment.lines.map((line) => ({
    shelterId: line.shelterId, shelterName: line.shelterName, resource: line.resource,
    shortage: line.shortage, priorityScore: line.priorityScore, hoursToDeadline: line.hoursToDeadline,
  }));
}

function toAllocationOffers(offers: ScoredOffer[]): AllocationOffer[] {
  return offers.map((offer) => ({
    offerId: offer.offerId, supplierId: offer.supplierId, supplierName: offer.supplierName, resource: offer.resource,
    quantityAvailable: offer.quantityAvailable, unitPrice: offer.unitPrice, listUnitPrice: offer.listUnitPrice,
    minOrder: offer.minOrder, leadTimeHours: offer.leadTimeHours, location: offer.location,
    trustScore: offer.trustScore, eligible: offer.eligible, exclusionReasons: offer.exclusionReasons,
  }));
}

export function supplierPoints(offers: ScoredOffer[]): Record<string, GeoPoint & { label: string }> {
  const points: Record<string, GeoPoint & { label: string }> = {};
  for (const offer of offers) points[offer.supplierId] ??= { lat: offer.location.lat, lng: offer.location.lng, label: `${offer.supplierName}, ${offer.location.city}`.slice(0, 80) };
  return points;
}

function shelterPoints(ctx: StepContext): Record<string, GeoPoint & { label: string }> {
  return Object.fromEntries((ctx.run().assessment?.shelters || []).map((shelter) => [shelter.id, { ...shelter.location, label: shelter.name.slice(0, 80) }]));
}

/** Command's own transit estimate for every supplier-to-shelter lane, used until RouteBridge answers. */
function estimateLanes(ctx: StepContext, offers: ScoredOffer[]): Record<string, LaneInfo> {
  const lanes: Record<string, LaneInfo> = {};
  const shelters = shelterPoints(ctx);
  for (const [supplierId, from] of Object.entries(supplierPoints(offers))) {
    for (const [shelterId, to] of Object.entries(shelters)) {
      lanes[laneKey(supplierId, shelterId)] = { feasible: true, transitHours: estimateTransitHours(from, to), source: "estimate", note: "Transit time is ReliefMesh's own estimate; RouteBridge has not been asked yet." };
    }
  }
  return lanes;
}

function rescore(ctx: StepContext, quotes: Record<string, number>): ScoredOffer[] {
  const run = ctx.run();
  const shelters = run.assessment?.shelters || [];
  return scoreOffers({
    rawOffers: run.rawOffers,
    trustByOrganization: trustMap(),
    referencePoint: shelters.length ? centroid(shelters.map((shelter) => shelter.location)) : ctx.incident.location,
    now: new Date(),
    overrides: run.overrides,
    quotes,
  });
}

function allocationInput(ctx: StepContext, offers: ScoredOffer[], lanes: Record<string, LaneInfo>, version: number): AllocationInput {
  return { incidentId: ctx.incident.id, needs: needsOf(ctx), offers: toAllocationOffers(offers), lanes, budget: ctx.incident.budget, version, now: new Date() };
}

const unitPrices = (events: NegotiationEvent[]): Record<string, number> =>
  Object.fromEntries(Object.entries(quotesFromEvents(events)).map(([offerId, quote]) => [offerId, quote.unitPrice]));

async function supplierGrant(ctx: StepContext, purpose: string, calls: string[], dataShared: string): Promise<Grant> {
  const supplier = requirePeer("supplier", "supplier marketplace");
  const grant = await openPeer(supplier.id, ctx.call, purpose, { calls, dataShared });
  ctx.contacted(supplier);
  return grant;
}

async function requestQuotes(ctx: StepContext, grant: Grant, requests: NegotiationRequest[], round: number): Promise<void> {
  for (const request of requests) {
    ctx.note(`Quote request: ${request.offerId}`, `${request.quantity} units, target ₹${request.targetUnitPrice}`);
    let event: NegotiationEvent;
    try {
      const reply = await callRead(grant, "request_improved_offer", { offerId: request.offerId, quantity: request.quantity, targetUnitPrice: request.targetUnitPrice }, improvedOffer);
      event = recordQuote(request, {
        ok: reply.ok,
        reason: reply.reason,
        quote: reply.quote ? { quantity: reply.quote.quantity, listUnitPrice: reply.quote.listUnitPrice, quotedUnitPrice: reply.quote.quotedUnitPrice, discountPct: reply.quote.discountPct, basis: reply.quote.basis } : undefined,
      }, round, new Date());
    } catch (error) {
      event = recordQuote(request, { ok: false, reason: (error as Error).message }, round, new Date());
    }
    // Stored one by one, so the negotiation view shows each reply as it arrives.
    ctx.patch({ negotiation: [...ctx.run().negotiation, event] });
    void useStore.getState().record({
      kind: "negotiation", actor: ctx.call.agent, incidentId: ctx.incident.id,
      summary: `${event.supplierName} ${event.offerId}: ${event.outcome}${event.quotedUnitPrice !== null ? ` at ₹${event.quotedUnitPrice} (list ₹${event.listUnitPrice})` : ""}`,
      data: { round, quantity: event.quantity, target: event.targetUnitPrice, quoted: event.quotedUnitPrice, saving: event.saving, binding: false },
    });
  }
}

/**
 * Build the allocation plan at the negotiated prices.
 *
 * A quote is for an exact quantity. If the plan at quoted prices ends up buying a
 * different quantity from an offer, that offer is quoted again for the new quantity (one
 * more round). Any quote that still does not match is withdrawn and the list price, which
 * a supplier always honours, is used. So the plan never relies on a price that was not
 * quoted for exactly what it buys.
 */
async function planAtQuotedPrices(ctx: StepContext, lanes: Record<string, LaneInfo>, version: number): Promise<{ plan: AllocationPlan; offers: ScoredOffer[]; input: AllocationInput }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const quotes = quotesFromEvents(ctx.run().negotiation);
    const offers = rescore(ctx, Object.fromEntries(Object.entries(quotes).map(([offerId, quote]) => [offerId, quote.unitPrice])));
    const input = allocationInput(ctx, offers, lanes, version);
    const plan = allocate(input);
    const quantities = quantityByOffer(plan);
    const stale = Object.entries(quotes).filter(([offerId, quote]) => (quantities[offerId] || 0) > 0 && quantities[offerId] !== quote.quantity);
    if (!stale.length) return { plan, offers, input };

    const round = Math.max(0, ...ctx.run().negotiation.map((event) => event.round)) + 1;
    if (attempt < 1) {
      const { requests } = planNegotiation(Object.fromEntries(stale.map(([offerId]) => [offerId, quantities[offerId]])), offers);
      ctx.note("Quantities changed after quoting", `${stale.length} offer(s) need a quote for the new quantity.`);
      try {
        const grant = await supplierGrant(ctx, `Re-quote ${requests.length} offer(s) whose planned quantity changed`, [`request_improved_offer × ${requests.length}`], "Offer ids, quantities and target unit prices. No shelter or incident details.");
        await requestQuotes(ctx, grant, requests, round);
        continue;
      } catch (error) {
        if (!(error instanceof ConsentDeclined)) throw error;
        ctx.note("Re-quote declined", "Falling back to list prices for those offers.");
      }
    }
    const events = ctx.run().negotiation;
    const withdrawn = stale.map(([offerId]) => {
      const previous = [...events].reverse().find((event) => event.offerId === offerId)!;
      return withdrawQuote(previous, round, new Date(), quantities[offerId]);
    });
    ctx.patch({ negotiation: [...events, ...withdrawn] });
  }
  const offers = rescore(ctx, unitPrices(ctx.run().negotiation));
  const input = allocationInput(ctx, offers, lanes, version);
  return { plan: allocate(input), offers, input };
}

function describeShortage(ctx: StepContext): string {
  const totals = ctx.run().assessment?.totals;
  if (!totals) return "";
  return RESOURCE_IDS.filter((resource) => totals[resource].shortage > 0)
    .map((resource) => `${num(totals[resource].shortage)} ${RESOURCES[resource].label.toLowerCase()}`).join(", ");
}

function storePlan(ctx: StepContext, built: { plan: AllocationPlan; offers: ScoredOffer[]; input: AllocationInput }, shipmentPlans = ctx.run().shipmentPlans): string[] {
  const problems = validateAllocation(built.input, built.plan);
  const partnerTrust = [...Object.values(useStore.getState().peers).map((peer) => peer.trust), ...Object.values(trustMap())].filter((item): item is NonNullable<typeof item> => !!item);
  ctx.patch({
    offers: built.offers,
    plan: problems.length ? null : built.plan,
    planProblems: problems,
    risks: analyseRisks({ assessment: ctx.run().assessment, offers: built.offers, plan: problems.length ? null : built.plan, shipments: shipmentPlans, partnerTrust }),
    scenarios: problems.length ? [] : runScenarios(built.input, built.plan),
  });
  return problems;
}

/** A plan that has been approved or acted on must not be silently replaced. */
function assertNotCommitted(ctx: StepContext, what: string): void {
  const run = ctx.run();
  if (run.reservation.status === "confirmed" || run.booking.status === "confirmed" || run.reservation.status === "pending" || run.booking.status === "pending") {
    throw new StepBlocked(`${what} cannot be re-run: stock or transport for this incident has already been confirmed with a partner. Create a new incident to plan again.`);
  }
}

/** Re-running a step makes the results of later steps stale: clear them. */
function invalidateAfter(ctx: StepContext, step: StepId): void {
  const order: StepId[] = ["assess", "discover", "trust", "offers", "negotiate", "allocate", "logistics", "approval", "execute"];
  const index = order.indexOf(step);
  const patch: Record<string, unknown> = {};
  const later = (id: StepId) => order.indexOf(id) > index;
  if (later("offers")) Object.assign(patch, { rawOffers: [], offers: [] });
  if (later("negotiate")) Object.assign(patch, { negotiation: [], draftPlan: null });
  if (later("allocate")) Object.assign(patch, { plan: null, planProblems: [], scenarios: [] });
  if (later("logistics")) Object.assign(patch, { optionsByLane: {}, shipmentPlans: [], lanes: {}, lanesSource: "estimate" });
  if (later("approval")) Object.assign(patch, { approval: { status: "none" } });
  // Discovery and trust are about partners, not about one incident's numbers.
  const dataSteps: StepId[] = ["offers", "negotiate", "allocate", "logistics", "approval", "execute"];
  ctx.patch(patch);
  for (const id of dataSteps) if (later(id)) useStore.getState().setStep(ctx.incident.id, id, { status: "idle", summary: undefined, error: undefined, startedAt: undefined, endedAt: undefined });
}

// ---- step 2: assess requirements ------------------------------------------------------

async function assess(ctx: StepContext): Promise<StepResult> {
  assertNotCommitted(ctx, "The assessment");
  const shelter = requirePeer("shelter", "shelter network");
  const grant = await openPeer(shelter.id, ctx.call, `Read the shelter register, stock and resource requests for "${ctx.incident.name}"`, {
    calls: ["get_shelter_overview", "get_resource_requests"],
    dataShared: "Nothing about the incident. Two read requests with no personal data.",
  });
  ctx.contacted(shelter);
  const overview = await callRead(grant, "get_shelter_overview", {}, shelterOverview);
  const requests = await callRead(grant, "get_resource_requests", { status: "all" }, resourceRequests);

  const assessment = assessNeeds({
    incident: ctx.incident,
    shelters: overview.shelters.map((item) => ({ id: item.id, name: item.name, block: item.block, location: item.location, capacity: item.capacity, occupancy: item.occupancy, urgency: item.urgency })),
    requests: requests.requests.map((item) => ({
      shelterId: item.shelterId, shelterName: item.shelterName, resource: item.resource, quantityRequired: item.quantityRequired,
      quantityInStock: item.quantityInStock, urgency: item.urgency, peopleServed: item.peopleServed, neededBy: item.neededBy,
    })),
    source: { networkUrl: shelter.networkUrl, label: shelter.label, simulated: requests.simulated },
    now: new Date(),
  });
  invalidateAfter(ctx, "assess");
  ctx.patch({ assessment });
  const short = totalShortage(assessment);
  return {
    summary: short
      ? `${assessment.lines.length} requests across ${assessment.shelters.length} shelters. Short: ${describeShortage(ctx)}.`
      : `${assessment.lines.length} requests across ${assessment.shelters.length} shelters. Stock on hand covers every requirement.`,
    warning: assessment.discrepancies.length > 0,
  };
}

// ---- step 3: discover partner agents -----------------------------------------------

async function discover(ctx: StepContext): Promise<StepResult> {
  const order = { trust: 0, shelter: 1, supplier: 2, logistics: 3, other: 4 };
  const peers = Object.values(useStore.getState().peers).sort((a, b) => order[a.role] - order[b.role]);
  if (!peers.length) throw new StepBlocked("No partner networks are configured.");
  let connected = 0;
  const problems: string[] = [];
  for (const peer of peers) {
    ctx.note(`Discover ${peer.label}`, peer.networkUrl);
    try {
      const grant = await askConsent(peer.id, "Load this site's public agent manifest and network definition", {
        agent: ctx.call.agent,
        calls: ["agent-manifest.json", "network definition", "links.json", "action bridge catalogue"],
        dataShared: "Nothing. Only the site's public files are fetched.",
      }, ctx.call);
      ctx.contacted(peer);
      await connect(grant);
      connected += 1;
    } catch (error) {
      if (error instanceof ConsentDeclined) {
        useStore.getState().patchPeer(peer.id, { discovery: { status: "declined", at: new Date().toISOString(), error: "You declined this contact. Nothing was fetched.", capabilities: [], agents: [], actions: [], partnerNetworks: [], fetched: { manifest: "", network: "" }, observedDigest: null, sampleQueries: [] } });
      }
      problems.push(`${peer.label}: ${(error as Error).message}`);
    }
  }
  const state = useStore.getState().peers;
  const agents = Object.values(state).reduce((sum, peer) => sum + (peer.discovery?.agents.length || 0), 0);
  const actions = Object.values(state).reduce((sum, peer) => sum + (peer.discovery?.actions.length || 0), 0);
  return {
    summary: `${connected} of ${peers.length} partner networks connected: ${agents} agents and ${actions} shared actions found.${problems.length ? ` Not connected: ${problems.join(" ")}` : ""}`,
    warning: connected < peers.length,
    input: `${peers.length} configured partner network URLs`,
  };
}

// ---- step 4: verify trust ----------------------------------------------------------

async function ensureDirectories(ctx: StepContext): Promise<{ suppliers: SupplierInfo[]; providers: ProviderInfo[] }> {
  const state = useStore.getState().peers;
  let suppliers = ctx.run().suppliers;
  let providers = ctx.run().providers;
  const supplierPeer = Object.values(state).find((peer) => peer.role === "supplier");
  const logisticsPeer = Object.values(state).find((peer) => peer.role === "logistics");

  if (supplierPeer && usablePeer(supplierPeer)) {
    const grant = await openPeer(supplierPeer.id, ctx.call, "Read the supplier directory, to check each organisation", { calls: ["get_supplier_directory"], dataShared: "Nothing. One read with no arguments." });
    ctx.contacted(supplierPeer);
    const directory = await callRead(grant, "get_supplier_directory", {}, supplierDirectory);
    suppliers = directory.suppliers.map((item) => ({ id: item.id, organizationId: item.organizationId, name: item.name, type: item.type, city: item.city, location: item.location }));
    ctx.patch({ suppliers });
  }
  if (logisticsPeer && usablePeer(logisticsPeer)) {
    const grant = await openPeer(logisticsPeer.id, ctx.call, "Read the transport providers, to check each operator", { calls: ["get_transport_providers"], dataShared: "Nothing. One read with no arguments." });
    ctx.contacted(logisticsPeer);
    const directory = await callRead(grant, "get_transport_providers", {}, transportProviders);
    providers = directory.providers.map((item) => ({ id: item.id, organizationId: item.organizationId, name: item.name, base: item.base, fleet: item.fleet }));
    ctx.patch({ providers, floodZones: directory.floodZones, routingSource: directory.routing?.source || "" });
  }
  return { suppliers, providers };
}

function usablePeer(peer: PeerRecord): boolean {
  return !!peer.trust && (isUsable(peer.trust.decision) || peer.overridden) && peer.trust.decision !== "blocked";
}

async function trust(ctx: StepContext): Promise<StepResult> {
  const registry = requirePeer("trust", "trust registry");
  const partners = Object.values(useStore.getState().peers).filter((peer) => peer.role !== "trust");
  const registryGrant = await openRegistry(ctx.call, "Check partner networks' identity records and signed attestations", ["get_registry_info", `verify_agent × ${partners.length}`, "verify_organization per supplier and transport operator"]);
  ctx.contacted(registry);

  // A partner must be loaded before it can be checked: the check compares the published
  // network file with the digest the registry attested.
  for (const peer of partners) {
    if (peer.discovery?.status !== "connected") {
      try {
        const grant = await askConsent(peer.id, "Load this site's public files, so they can be compared with the registry's attestation", { agent: ctx.call.agent, calls: ["agent-manifest.json", "network definition"], dataShared: "Nothing. Only public files are fetched." }, ctx.call);
        ctx.contacted(peer);
        await connect(grant);
      } catch (error) {
        ctx.note(`${peer.label} not loaded`, (error as Error).message);
        continue;
      }
    }
    ctx.note(`Verify ${peer.label}`, peer.networkUrl);
    await verifyPeer(registryGrant, peer.id);
  }

  const { suppliers, providers } = await ensureDirectories(ctx);
  const organizations = [
    ...suppliers.map((item) => ({ id: item.organizationId, name: item.name })),
    ...providers.map((item) => ({ id: item.organizationId, name: item.name })),
  ];
  for (const organization of organizations) {
    ctx.note(`Verify ${organization.name}`, organization.id);
    await verifyOrganization(registryGrant, organization.id, organization.name);
  }

  const present = (item: TrustEvaluation | null | undefined): item is TrustEvaluation => !!item;
  const peerResults = Object.values(useStore.getState().peers).filter((peer) => peer.role !== "trust").map((peer) => peer.trust).filter(present);
  const orgResults = organizations.map((organization) => trustMap()[organization.id]).filter(present);
  const count = (list: TrustEvaluation[], decision: string) => list.filter((item) => item.decision === decision).length;
  const signatures = [...peerResults, ...orgResults].filter((item) => item.signatureVerified).length;
  const concerns = [...peerResults, ...orgResults].filter((item) => item.decision === "blocked" || item.decision === "unverified");
  return {
    summary: `${count(peerResults, "verified")} of ${peerResults.length} partner networks verified. Organisations: ${count(orgResults, "verified")} verified, ${count(orgResults, "caution")} caution, ${count(orgResults, "unverified")} unverified, ${count(orgResults, "blocked")} blocked. ${signatures} signatures checked with ECDSA P-256.`,
    warning: concerns.length > 0,
    input: `${partners.length} partner networks, ${organizations.length} organisations`,
  };
}

// ---- step 5: collect supplier offers ---------------------------------------------------

async function offers(ctx: StepContext): Promise<StepResult> {
  assertNotCommitted(ctx, "Offer collection");
  if (!ctx.run().assessment) throw new StepBlocked("Assess the requirements first: offers are matched against the assessed shortages.");
  const grant = await supplierGrant(ctx, "Collect current supplier offers", ["get_supplier_offers", "get_supplier_directory"], "Nothing about the incident. Two reads with no arguments.");
  const result = await callRead(grant, "get_supplier_offers", {}, supplierOffers);
  if (!ctx.run().suppliers.length) {
    const directory = await callRead(grant, "get_supplier_directory", {}, supplierDirectory);
    ctx.patch({ suppliers: directory.suppliers.map((item) => ({ id: item.id, organizationId: item.organizationId, name: item.name, type: item.type, city: item.city, location: item.location })) });
  }

  // Every supplier is checked before its offers can be used.
  const unknown = [...new Map(result.offers.map((offer) => [offer.organizationId, offer.supplierName])).entries()].filter(([organizationId]) => !trustMap()[organizationId]);
  if (unknown.length) {
    const registry = requirePeer("trust", "trust registry");
    const registryGrant = await openRegistry(ctx.call, `Check ${unknown.length} supplier organisation(s) before their offers are used`, [`verify_organization × ${unknown.length}`]);
    ctx.contacted(registry);
    for (const [organizationId, name] of unknown) await verifyOrganization(registryGrant, organizationId, name);
  }

  invalidateAfter(ctx, "offers");
  ctx.patch({ rawOffers: result.offers });
  const scored = rescore(ctx, {});
  ctx.patch({ offers: scored });

  const excluded = scored.filter((offer) => !offer.eligible);
  for (const offer of scored) {
    for (const flag of offer.flags.filter((item) => item.kind === "instruction_injection")) {
      void useStore.getState().record({ kind: "security", actor: ctx.call.agent, incidentId: ctx.incident.id, summary: `Offer ${offer.offerId} from ${offer.supplierName} excluded: its text tried to give instructions`, data: { detail: flag.detail } });
    }
  }
  const suppliers = new Set(scored.map((offer) => offer.supplierId)).size;
  const excludedSuppliers = [...new Set(excluded.map((offer) => offer.supplierName))];
  return {
    summary: `${scored.length} offers from ${suppliers} suppliers; ${scored.length - excluded.length} eligible.${excludedSuppliers.length ? ` Excluded: ${excludedSuppliers.join(", ")}.` : ""}`,
    warning: excluded.length > 0,
    input: `Shortages: ${describeShortage(ctx) || "none"}`,
  };
}

// ---- step 6: negotiate ---------------------------------------------------------------

async function negotiate(ctx: StepContext): Promise<StepResult> {
  assertNotCommitted(ctx, "Negotiation");
  if (!ctx.run().rawOffers.length) throw new StepBlocked("Collect supplier offers first.");
  invalidateAfter(ctx, "negotiate");

  const listOffers = rescore(ctx, {});
  const lanes = estimateLanes(ctx, listOffers);
  const draft = allocate(allocationInput(ctx, listOffers, lanes, 0));
  ctx.patch({ draftPlan: draft, offers: listOffers });
  const { requests, skipped } = planNegotiation(quantityByOffer(draft), listOffers);
  if (!requests.length) return { summary: "The draft plan buys from no supplier that can be asked for a better price.", warning: true };

  const grant = await supplierGrant(ctx, `Request non-binding quotes for ${requests.length} offers in the draft plan`, [`request_improved_offer × ${requests.length}`], "Offer ids, quantities and target unit prices. No shelter or incident details.");
  await requestQuotes(ctx, grant, requests, 1);

  const events = ctx.run().negotiation;
  ctx.patch({ offers: rescore(ctx, unitPrices(events)) });
  const improved = events.filter((event) => event.outcome === "improved").length;
  const saving = totalSaving(events);
  return {
    summary: `${requests.length} quotes requested; ${improved} improved. Saving against list prices: ${inr(saving)}. Quotes are non-binding.${skipped.length ? ` ${skipped.length} offer(s) not asked.` : ""}`,
    input: `Draft plan at list prices: ${inr(draft.totalCost)}`,
  };
}

// ---- step 7: optimise resource allocation ----------------------------------------------

async function allocation(ctx: StepContext): Promise<StepResult> {
  assertNotCommitted(ctx, "Allocation");
  const run = ctx.run();
  if (!run.assessment) throw new StepBlocked("Assess the requirements first.");
  if (!run.rawOffers.length) throw new StepBlocked("Collect supplier offers first.");
  invalidateAfter(ctx, "allocate");

  const lanes = run.lanesSource === "routebridge" && Object.keys(run.lanes).length ? run.lanes : estimateLanes(ctx, rescore(ctx, {}));
  const built = await planAtQuotedPrices(ctx, lanes, (run.plan?.version || 0) + 1);
  ctx.patch({ lanes, lanesSource: run.lanesSource === "routebridge" && Object.keys(run.lanes).length ? "routebridge" : "estimate" });
  const problems = storePlan(ctx, built, []);
  if (problems.length) throw new Error(`The engine produced a plan that fails validation, so it is not shown: ${problems.join(" ")}`);

  const { plan } = built;
  void useStore.getState().record({
    kind: "allocation", actor: ctx.call.agent, incidentId: ctx.incident.id,
    summary: `Allocation plan v${plan.version}: ${plan.lines.length} lines, ${inr(plan.totalCost)} of ${inr(plan.budget)}, ${overallFulfilmentPct(plan)}% of shortages covered`,
    data: { planId: plan.id, weights: plan.weights, unfulfilled: plan.unfulfilled.length, method: plan.method },
  });
  const pct = overallFulfilmentPct(plan);
  return {
    summary: `${plan.lines.length} allocation lines across ${plan.bySupplier.length} suppliers. ${inr(plan.totalCost)} of ${inr(plan.budget)} budget. ${pct}% of shortages covered${plan.unfulfilled.length ? `; ${plan.unfulfilled.reduce((sum, line) => sum + line.quantity, 0)} units unfulfilled` : ""}. All invariants hold.`,
    warning: plan.unfulfilled.length > 0 || plan.lines.some((line) => !line.onTime),
    input: `${needsOf(ctx).filter((need) => need.shortage > 0).length} needs, ${built.offers.filter((offer) => offer.eligible).length} eligible offers, budget ${inr(ctx.incident.budget)}`,
  };
}

// ---- step 8: coordinate logistics ------------------------------------------------------

async function logistics(ctx: StepContext): Promise<StepResult> {
  assertNotCommitted(ctx, "Logistics planning");
  if (!ctx.run().plan) throw new StepBlocked("Generate the allocation plan first.");
  invalidateAfter(ctx, "logistics");

  const logisticsPeer = requirePeer("logistics", "logistics");
  const eligible = ctx.run().offers.filter((offer) => offer.eligible);
  const suppliers = supplierPoints(eligible);
  const shelters = shelterPoints(ctx);
  const legs = Object.entries(suppliers).flatMap(([supplierId, from]) => Object.entries(shelters).map(([shelterId, to]) => ({ id: laneKey(supplierId, shelterId), from: { lat: from.lat, lng: from.lng }, to: { lat: to.lat, lng: to.lng } })));
  if (legs.length > 40) throw new StepBlocked(`RouteBridge estimates at most 40 lanes at once; this plan has ${legs.length}.`);

  const grant = await openPeer(logisticsPeer.id, ctx.call, `Get route estimates and transport options for "${ctx.incident.name}"`, {
    calls: ["get_transport_providers", `estimate_routes (${legs.length} lanes)`, "get_transport_options per shipment"],
    dataShared: "Supplier depot and shelter coordinates, and shipment weights. No names or personal data.",
  });
  ctx.contacted(logisticsPeer);

  const directory = await callRead(grant, "get_transport_providers", {}, transportProviders);
  const providers: ProviderInfo[] = directory.providers.map((item) => ({ id: item.id, organizationId: item.organizationId, name: item.name, base: item.base, fleet: item.fleet }));
  ctx.patch({ providers, floodZones: directory.floodZones, routingSource: directory.routing?.source || "" });

  // Every operator is checked before its vehicles can be assigned.
  const unknown = providers.filter((provider) => !trustMap()[provider.organizationId]);
  if (unknown.length) {
    const registry = requirePeer("trust", "trust registry");
    const registryGrant = await openRegistry(ctx.call, `Check ${unknown.length} transport operator(s) before their vehicles are assigned`, [`verify_organization × ${unknown.length}`]);
    ctx.contacted(registry);
    for (const provider of unknown) await verifyOrganization(registryGrant, provider.organizationId, provider.name);
  }
  const usableProviders = providers.filter((provider) => { const evaluation = trustMap()[provider.organizationId]; return evaluation && isUsable(evaluation.decision); });
  const hasBoats = usableProviders.some((provider) => provider.fleet.some((vehicle) => vehicle.floodCapable && vehicle.count > 0));
  const hasTrucks = usableProviders.some((provider) => provider.fleet.some((vehicle) => !vehicle.floodCapable && vehicle.count > 0));

  // Route feasibility for every lane the allocation could use, from RouteBridge.
  const estimates = await callRead(grant, "estimate_routes", { legs }, routeEstimates);
  const lanes: Record<string, LaneInfo> = {};
  for (const leg of estimates.legs) {
    const byBoat = leg.boatRequired || !leg.truckFeasible;
    const feasible = byBoat ? hasBoats : hasTrucks;
    lanes[leg.id] = {
      feasible,
      transitHours: byBoat ? leg.bestCaseHours.relief_boat : Math.min(leg.bestCaseHours.light_truck, leg.bestCaseHours.heavy_truck),
      source: "routebridge",
      note: leg.zone
        ? `${leg.zone.name}: ${byBoat ? (hasBoats ? "reachable by flood-capable craft only" : "no trusted flood-capable craft available") : "expect delays"} (RouteBridge, ${estimates.routing?.source || "demo-dataset"}).`
        : undefined,
    };
  }
  ctx.patch({ lanes, lanesSource: "routebridge" });

  // Re-optimise the allocation with real route feasibility instead of Command's estimate.
  const before = ctx.run().plan!;
  const signature = (plan: AllocationPlan) => plan.lines.map((line) => `${line.id}=${line.quantity}@${line.unitPrice}`).sort().join("|");
  let built = await planAtQuotedPrices(ctx, lanes, before.version + 1);

  const assessment = ctx.run().assessment!;
  const needByShelter = Object.fromEntries(assessment.shelters.map((shelter) => {
    const lines = assessment.lines.filter((line) => line.shelterId === shelter.id);
    return [shelter.id, { hoursToDeadline: Math.min(...lines.map((line) => line.hoursToDeadline), Infinity), priority: Math.max(...lines.map((line) => line.priorityScore), 0) }];
  }));

  // Options are fetched once per lane and load; a re-plan only asks for what changed.
  const fetched = new Map<string, TransportOption[]>();
  let shipmentPlans: ReturnType<typeof assignTransport> = [];
  let optionsByLane: Record<string, TransportOption[]> = {};
  let rounds = 0;

  for (let pass = 0; pass < 3; pass++) {
    rounds = pass + 1;
    const problems = storePlan(ctx, built, []);
    if (problems.length) throw new Error(`Re-optimisation produced a plan that fails validation: ${problems.join(" ")}`);
    const shipmentLanes = buildLanes({
      plan: built.plan,
      supplierLocations: supplierPoints(ctx.run().offers),
      shelterLocations: shelters,
      leadTimeByOffer: Object.fromEntries(ctx.run().offers.map((offer) => [offer.offerId, offer.leadTimeHours])),
      needByShelter,
    });

    optionsByLane = {};
    for (const lane of shipmentLanes) {
      const window = Math.round(Math.min(720, Math.max(0.5, lane.hoursToDeadline - lane.readyInHours)) * 10) / 10;
      const cacheKey = `${lane.reference}|${lane.weightKg}|${window}`;
      if (!fetched.has(cacheKey)) {
        ctx.note(`Transport options: ${lane.supplierName} → ${lane.shelterName}`, `${lane.weightKg} kg`);
        const result = await callRead(grant, "get_transport_options", {
          from: { lat: lane.from.lat, lng: lane.from.lng, label: lane.from.label },
          to: { lat: lane.to.lat, lng: lane.to.lng, label: lane.to.label },
          weightKg: Math.max(1, lane.weightKg),
          neededWithinHours: window,
        }, transportOptions);
        fetched.set(cacheKey, result.options);
      }
      optionsByLane[lane.reference] = fetched.get(cacheKey)!;
      ctx.patch({ optionsByLane: { ...optionsByLane } });
    }

    shipmentPlans = assignTransport({ lanes: shipmentLanes, optionsByLane, trustByOrganization: trustMap() });
    ctx.patch({ shipmentPlans });

    // Feedback: the route estimate is a best case that ignores how long a vehicle takes to
    // reach the pickup point. Where the real options are slower, or there is none, tell
    // the allocation engine and let it choose again.
    let corrected = false;
    for (const lane of shipmentLanes) {
      const key = laneKey(lane.supplierId, lane.shelterId);
      const usable = (optionsByLane[lane.reference] || []).filter((option) => {
        const evaluation = trustMap()[option.organizationId];
        return option.feasible && !!evaluation && isUsable(evaluation.decision);
      });
      const current = lanes[key];
      if (!current) continue;
      if (!usable.length) {
        if (current.feasible) { lanes[key] = { ...current, feasible: false, note: "RouteBridge has no usable transport option for this lane." }; corrected = true; }
        continue;
      }
      const best = Math.min(...usable.map((option) => option.etaHours));
      if (best > current.transitHours + 0.5) {
        lanes[key] = { ...current, transitHours: best, note: `${current.note ? `${current.note} ` : ""}Transit includes the time a vehicle needs to reach the pickup point (RouteBridge options).` };
        corrected = true;
      }
    }
    ctx.patch({ lanes: { ...lanes } });

    const trouble = shipmentPlans.some((item) => !item.assigned || !item.onTime);
    if (!trouble || !corrected || pass === 2) break;
    const next = await planAtQuotedPrices(ctx, lanes, built.plan.version + 1);
    if (signature(next.plan) === signature(built.plan)) break;
    ctx.note("Allocation re-optimised", "Real transport times showed a lane would be late or unreachable; the engine chose again.");
    built = next;
  }

  const changed = signature(before) !== signature(built.plan);
  if (!changed) built.plan = { ...built.plan, version: before.version, id: before.id };
  storePlan(ctx, built, shipmentPlans);
  if (changed) {
    void useStore.getState().record({ kind: "allocation", actor: "ResourceAllocationAgent", incidentId: ctx.incident.id, summary: `Allocation re-optimised with RouteBridge route feasibility and transport times (plan v${built.plan.version})`, data: { planId: built.plan.id, cost: built.plan.totalCost, rounds } });
  }
  const plan = ctx.run().plan!;

  const totals = logisticsTotals(shipmentPlans);
  void useStore.getState().record({
    kind: "logistics", actor: ctx.call.agent, incidentId: ctx.incident.id,
    summary: `Transport plan: ${totals.assigned} of ${shipmentPlans.length} shipments assigned, ${totals.late} late, ${inr(totals.cost)}`,
    data: { routeSource: estimates.routing?.source || directory.routing?.source, shipments: shipmentPlans.map((item) => ({ reference: item.reference, provider: item.providerName, vehicle: item.vehicleType, hours: item.totalHours, onTime: item.onTime })) },
  });
  return {
    summary: `${shipmentPlans.length} shipments, ${num(totals.weightKg)} kg: ${totals.assigned} assigned${totals.unassigned ? `, ${totals.unassigned} without transport` : ""}${totals.late ? `, ${totals.late} late` : ""}. Transport ${inr(totals.cost)}. Longest door-to-door ${totals.longestHours} h. Routes: ${estimates.routing?.source || "demo-dataset"}.${changed ? " The allocation was re-optimised with route feasibility and real transport times." : ""}`,
    warning: totals.unassigned > 0 || totals.late > 0,
    input: `${shipmentPlans.length} supplier-to-shelter lanes from plan v${plan.version}`,
  };
}

// ---- running steps -----------------------------------------------------------------

const IMPLEMENTATIONS: Partial<Record<StepId, (ctx: StepContext) => Promise<StepResult>>> = {
  assess, discover, trust, offers, negotiate, allocate: allocation, logistics,
};

export function runStep(incidentId: string, stepId: StepId): Promise<StepOutcome> {
  const implementation = IMPLEMENTATIONS[stepId];
  const definition = stepDefinition(stepId);
  if (!implementation) return Promise.resolve({ ok: false, status: "failed", summary: "", reason: `"${definition.title}" is done by a person on the page, not by an automated step.` });
  const incident = useStore.getState().incidents.find((item) => item.id === incidentId);
  if (incident?.status === "closed") return Promise.resolve({ ok: false, status: "failed", summary: "", reason: "This incident is closed. Reopen it or create a new one." });
  return withActivity({ incidentId, step: stepId, agent: definition.agent, task: definition.title }, implementation);
}

/** Allow or withdraw a person's override for an unverified supplier, and rescore. */
export async function setSupplierOverride(incidentId: string, organizationId: string, allowed: boolean): Promise<void> {
  const store = useStore.getState();
  const run = store.run(incidentId);
  const evaluation = store.orgTrust[organizationId];
  if (allowed && evaluation?.decision === "blocked") return; // a blocked supplier is never overridable
  const overrides = allowed ? [...new Set([...run.overrides, organizationId])] : run.overrides.filter((id) => id !== organizationId);
  store.patchRun(incidentId, { overrides });
  const incident = store.incidents.find((item) => item.id === incidentId);
  const shelters = run.assessment?.shelters || [];
  const offers = scoreOffers({
    rawOffers: run.rawOffers, trustByOrganization: store.orgTrust,
    referencePoint: shelters.length ? centroid(shelters.map((shelter) => shelter.location)) : incident?.location || { lat: 0, lng: 0 },
    now: new Date(), overrides, quotes: unitPrices(run.negotiation),
  });
  store.patchRun(incidentId, { offers });
  await store.record({
    kind: "trust", actor: "human:coordinator", incidentId,
    summary: allowed ? `Override: allowed offers from unverified supplier ${evaluation?.name || organizationId}` : `Override withdrawn for ${evaluation?.name || organizationId}`,
    data: { organizationId, decision: evaluation?.decision ?? "unverified" },
  });
}
