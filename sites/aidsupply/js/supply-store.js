// AidSupply's business rules and storage. No DOM here: the page, the assistant's actions,
// the bridge that other agent sites call, the reservation window and the Node tests all
// use this class.
//
// Operations validate the whole input first and refuse by RETURNING
// {ok: false, reason, field}; they throw only on unexpected failures. The agent runtime
// reports a throw as "outcome unknown", so a refusal must never throw.
import { Pricing } from "./pricing.js";
import { SiteLinks } from "./site-links.js";
import { SupplyData } from "./supply-data.js";

export class SupplyStore {
  static STORAGE_KEY = "aidsupply-state-v1";

  /**
   * :param storage: A Storage-like object (localStorage), or null for memory only. In a
   *   bridge frame embedded by a site on another registrable domain, browsers partition
   *   storage, so the frame sees its own copy rather than what this site's page stored.
   * :param now: Clock, injectable for tests.
   */
  constructor(storage = SupplyStore.defaultStorage(), now = () => new Date()) {
    this.storage = storage;
    this.now = now;
    this.state = this.load();
  }

  static defaultStorage() {
    try {
      return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
      return null;
    }
  }

  seed() {
    return {
      version: 1,
      seeded: true,
      suppliers: structuredClone(SupplyData.SUPPLIERS),
      offers: SupplyData.OFFERS.map((offer) => ({ ...offer, validForHours: SupplyData.OFFER_VALID_HOURS })),
      reservations: [],
    };
  }

  load() {
    try {
      const raw = this.storage?.getItem(SupplyStore.STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.suppliers) && Array.isArray(parsed.offers) && Array.isArray(parsed.reservations)) return parsed;
      }
    } catch {
      // Unreadable or blocked storage: fall back to the seed.
    }
    return this.seed();
  }

  save() {
    this.state.version += 1;
    this.state.seeded = false;
    try {
      this.storage?.setItem(SupplyStore.STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Storage full or blocked: the change still holds for this page view.
    }
  }

  reset() {
    try { this.storage?.removeItem(SupplyStore.STORAGE_KEY); } catch { /* nothing to clear */ }
    this.state = this.seed();
    return { ok: true, version: this.state.version };
  }

  // ---- lookups -------------------------------------------------------------------

  findSupplier(supplierId) {
    return this.state.suppliers.find((supplier) => supplier.id === supplierId) || null;
  }

  findOffer(offerId) {
    return this.state.offers.find((offer) => offer.offerId === offerId) || null;
  }

  supplierIds() {
    return this.state.suppliers.map((supplier) => supplier.id);
  }

  offerIds() {
    return this.state.offers.map((offer) => offer.offerId);
  }

  /** Units of one offer held by reservations that still stand. */
  reservedFor(offerId) {
    let held = 0;
    for (const reservation of this.state.reservations) {
      if (reservation.status !== "reserved") continue;
      for (const line of reservation.lines) if (line.offerId === offerId) held += line.quantity;
    }
    return held;
  }

  availableFor(offer) {
    return Math.max(0, offer.quantity - this.reservedFor(offer.offerId));
  }

  envelope(extra) {
    return {
      simulated: true,
      dataNotice: SupplyData.NOTICE,
      source: `${SiteLinks.SELF}/`,
      generatedAt: this.now().toISOString(),
      stateVersion: this.state.version,
      ...extra,
    };
  }

  hoursFromNow(hours) {
    return new Date(this.now().getTime() + hours * 3600_000).toISOString();
  }

  /** One offer as buyers see it. The supplier's negotiating limit is never included. */
  publicOffer(offer) {
    const supplier = this.findSupplier(offer.supplierId);
    return {
      offerId: offer.offerId,
      supplierId: offer.supplierId,
      organizationId: supplier.organizationId,
      supplierName: supplier.name,
      supplierType: supplier.type,
      resource: offer.resource,
      unit: SupplyData.RESOURCES[offer.resource].unit,
      quantityAvailable: this.availableFor(offer),
      unitPrice: offer.unitPrice,
      minOrder: offer.minOrder,
      leadTimeHours: offer.leadTimeHours,
      location: { lat: supplier.location.lat, lng: supplier.location.lng, city: supplier.city },
      validUntil: this.hoursFromNow(offer.validForHours ?? SupplyData.OFFER_VALID_HOURS),
      notes: offer.notes || "",
    };
  }

  // ---- reads ---------------------------------------------------------------------

  directory() {
    return this.envelope({
      suppliers: this.state.suppliers.map((supplier) => ({
        id: supplier.id,
        organizationId: supplier.organizationId,
        name: supplier.name,
        type: supplier.type,
        city: supplier.city,
        state: supplier.state,
        location: { ...supplier.location },
        registrationRef: supplier.registrationRef,
        // What the supplier told AidSupply. AidSupply does not verify it.
        selfDeclared: true,
        listedSince: supplier.listedSince,
      })),
      resources: SupplyData.RESOURCES,
      links: SiteLinks.asFacts(),
    });
  }

  offers(filter = {}) {
    let list = this.state.offers;
    if (filter.resource) list = list.filter((offer) => offer.resource === filter.resource);
    if (filter.supplierId) list = list.filter((offer) => offer.supplierId === filter.supplierId);
    return this.envelope({
      currency: SupplyData.CURRENCY,
      offers: list.map((offer) => this.publicOffer(offer)),
    });
  }

  /** A non-binding quote for one quantity of one offer. Changes nothing. */
  improvedOffer(args) {
    const check = this.checkQuote(args);
    if (!check.ok) return this.envelope(check);
    const { offer, supplier } = check;
    const priced = Pricing.quote(offer, supplier.type, args.quantity, args.targetUnitPrice);
    return this.envelope({
      ok: true,
      quote: {
        offerId: offer.offerId,
        supplierId: supplier.id,
        supplierName: supplier.name,
        resource: offer.resource,
        quantity: args.quantity,
        listUnitPrice: priced.listUnitPrice,
        quotedUnitPrice: priced.quotedUnitPrice,
        discountPct: priced.discountPct,
        listTotal: priced.listTotal,
        total: priced.total,
        saving: priced.saving,
        basis: priced.basis,
        leadTimeHours: offer.leadTimeHours,
        binding: false,
        validUntil: this.hoursFromNow(SupplyData.QUOTE_VALID_HOURS),
      },
    });
  }

  reservationsList() {
    return this.envelope({
      currency: SupplyData.CURRENCY,
      reservations: this.state.reservations.map((reservation) => ({
        reference: reservation.reference,
        incidentRef: reservation.incidentRef,
        createdAt: reservation.createdAt,
        status: reservation.status,
        total: reservation.total,
        lines: reservation.lines.map((line) => ({ ...line })),
      })),
    });
  }

  // ---- checks (read-only; every write calls its check first) -----------------------

  static isWholeNumber(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
  }

  static isAmount(value, max) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= max;
  }

  checkQuote(args) {
    const offer = this.findOffer(args.offerId);
    if (!offer) return { ok: false, field: "offerId", reason: `No offer with id ${args.offerId}.` };
    const supplier = this.findSupplier(offer.supplierId);
    if (!SupplyStore.isWholeNumber(args.quantity, 1, 1_000_000)) return { ok: false, field: "quantity", reason: "Quantity must be a whole number of at least 1." };
    if (args.quantity < offer.minOrder) return { ok: false, field: "quantity", reason: `The minimum order for ${offer.offerId} is ${offer.minOrder}.` };
    const available = this.availableFor(offer);
    if (args.quantity > available) return { ok: false, field: "quantity", reason: `Only ${available} are available on ${offer.offerId}.` };
    if (args.targetUnitPrice !== undefined && args.targetUnitPrice !== null) {
      if (!SupplyStore.isAmount(args.targetUnitPrice, 1_000_000)) return { ok: false, field: "targetUnitPrice", reason: "Target unit price must be a number above 0." };
    }
    return { ok: true, offer, supplier };
  }

  checkSupplier(args) {
    const name = String(args.name ?? "").trim();
    const city = String(args.city ?? "").trim();
    const state = String(args.state ?? "West Bengal").trim() || "West Bengal";
    const registrationRef = String(args.registrationRef ?? "").trim();
    if (name.length < 3 || name.length > 80) return { ok: false, field: "name", reason: "Supplier name must be 3 to 80 characters." };
    if (this.state.suppliers.some((supplier) => supplier.name.toLowerCase() === name.toLowerCase())) return { ok: false, field: "name", reason: "A supplier with this name is already listed." };
    if (!SupplyData.SUPPLIER_TYPES.includes(args.type)) return { ok: false, field: "type", reason: `Type must be one of: ${SupplyData.SUPPLIER_TYPES.join(", ")}.` };
    if (city.length < 2 || city.length > 60) return { ok: false, field: "city", reason: "City must be 2 to 60 characters." };
    if (state.length < 2 || state.length > 60) return { ok: false, field: "state", reason: "State must be 2 to 60 characters." };
    if (typeof args.lat !== "number" || !(args.lat >= -90 && args.lat <= 90)) return { ok: false, field: "lat", reason: "Latitude must be between -90 and 90." };
    if (typeof args.lng !== "number" || !(args.lng >= -180 && args.lng <= 180)) return { ok: false, field: "lng", reason: "Longitude must be between -180 and 180." };
    if (registrationRef.length < 3 || registrationRef.length > 60) return { ok: false, field: "registrationRef", reason: "Registration reference must be 3 to 60 characters. Write \"Not provided\" if there is none." };
    return { ok: true, name, city, state, registrationRef };
  }

  /** The offer a supplier already lists for a resource, if any: publishing replaces it. */
  offerFor(supplierId, resource) {
    return this.state.offers.find((offer) => offer.supplierId === supplierId && offer.resource === resource) || null;
  }

  checkOffer(args) {
    const supplier = this.findSupplier(args.supplierId);
    if (!supplier) return { ok: false, field: "supplierId", reason: `No supplier with id ${args.supplierId}.` };
    if (!SupplyData.RESOURCES[args.resource]) return { ok: false, field: "resource", reason: `Unknown resource ${args.resource}.` };
    if (!SupplyStore.isWholeNumber(args.quantity, 1, 1_000_000)) return { ok: false, field: "quantity", reason: "Quantity must be a whole number from 1 to 1,000,000." };
    if (!SupplyStore.isAmount(args.unitPrice, 1_000_000)) return { ok: false, field: "unitPrice", reason: "Unit price must be a number above 0." };
    if (!SupplyStore.isWholeNumber(args.minOrder, 1, 1_000_000)) return { ok: false, field: "minOrder", reason: "Minimum order must be a whole number of at least 1." };
    if (args.minOrder > args.quantity) return { ok: false, field: "minOrder", reason: "Minimum order cannot be more than the quantity offered." };
    if (!SupplyStore.isWholeNumber(args.leadTimeHours, 1, 720)) return { ok: false, field: "leadTimeHours", reason: "Lead time must be a whole number of hours from 1 to 720." };
    const notes = String(args.notes ?? "").trim();
    if (notes.length > 240) return { ok: false, field: "notes", reason: "Notes can be at most 240 characters." };
    const maxDiscountPct = args.maxDiscountPct ?? 0;
    if (!SupplyStore.isWholeNumber(maxDiscountPct, 0, 30)) return { ok: false, field: "maxDiscountPct", reason: "The negotiating limit must be a whole percentage from 0 to 30." };
    const existing = this.offerFor(supplier.id, args.resource);
    if (existing) {
      const held = this.reservedFor(existing.offerId);
      if (args.quantity < held) return { ok: false, field: "quantity", reason: `${held} units of ${existing.offerId} are already reserved, so the quantity offered cannot be less.` };
    }
    return { ok: true, supplier, existing, notes, maxDiscountPct, unitPrice: Pricing.round2(args.unitPrice) };
  }

  checkStock(args) {
    const offer = this.findOffer(args.offerId);
    if (!offer) return { ok: false, field: "offerId", reason: `No offer with id ${args.offerId}.` };
    if (!SupplyStore.isWholeNumber(args.quantity, 0, 1_000_000)) return { ok: false, field: "quantity", reason: "Available stock must be a whole number from 0 to 1,000,000." };
    return { ok: true, offer };
  }

  /**
   * Check a whole reservation request, line by line, without changing anything. The
   * confirmation window shows the lines this returns, and reserveAllocation runs it again
   * before it writes, so the person confirms exactly what is then reserved.
   */
  checkReservation(args) {
    const incidentRef = String(args.incidentRef ?? "").trim();
    if (!incidentRef || incidentRef.length > 40) return { ok: false, field: "incidentRef", reason: "An incident reference of 1 to 40 characters is required." };
    const list = Array.isArray(args.lines) ? args.lines : [];
    if (!list.length) return { ok: false, field: "lines", reason: "List at least one line to reserve." };
    if (list.length > 20) return { ok: false, field: "lines", reason: "At most 20 lines can be reserved at once." };
    const seen = new Set();
    const lines = [];
    for (const [index, item] of list.entries()) {
      const where = `lines[${index}]`;
      const offer = this.findOffer(item?.offerId);
      if (!offer) return { ok: false, field: where, reason: `No offer with id ${item?.offerId}.` };
      if (seen.has(offer.offerId)) return { ok: false, field: where, reason: `Offer ${offer.offerId} is listed twice. Put the whole quantity on one line.` };
      seen.add(offer.offerId);
      const supplier = this.findSupplier(offer.supplierId);
      if (!SupplyStore.isWholeNumber(item.quantity, 1, 1_000_000)) return { ok: false, field: where, reason: `The quantity for ${offer.offerId} must be a whole number of at least 1.` };
      if (item.quantity < offer.minOrder) return { ok: false, field: where, reason: `The minimum order for ${offer.offerId} is ${offer.minOrder}.` };
      const available = this.availableFor(offer);
      if (item.quantity > available) return { ok: false, field: where, reason: `Only ${available} are available on ${offer.offerId}; ${item.quantity} were asked for. Nothing was reserved.` };
      if (!SupplyStore.isAmount(item.unitPrice, 1_000_000)) return { ok: false, field: where, reason: `The unit price for ${offer.offerId} must be a number above 0.` };
      const unitPrice = Pricing.round2(item.unitPrice);
      if (unitPrice < Pricing.lowestAcceptable(offer, supplier.type, item.quantity)) {
        return { ok: false, field: where, reason: `The unit price ${unitPrice} for ${item.quantity} of ${offer.offerId} is below what ${supplier.name} accepts at that quantity. Ask for a quote with request_improved_offer and use its price. Nothing was reserved.` };
      }
      lines.push({
        offerId: offer.offerId,
        supplierId: supplier.id,
        supplierName: supplier.name,
        resource: offer.resource,
        quantity: item.quantity,
        unitPrice,
        lineTotal: Pricing.round2(unitPrice * item.quantity),
      });
    }
    const total = Pricing.round2(lines.reduce((sum, line) => sum + line.lineTotal, 0));
    return { ok: true, incidentRef, lines, total };
  }

  // ---- writes --------------------------------------------------------------------

  static letters(index) {
    let label = "";
    for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) label = String.fromCharCode(65 + (n % 26)) + label;
    return label;
  }

  nextSupplierSuffix() {
    const used = new Set(this.state.suppliers.map((supplier) => supplier.id.replace(/^SUP-/, "")));
    for (let index = 0; ; index += 1) {
      const suffix = SupplyStore.letters(index);
      if (!used.has(suffix)) return suffix;
    }
  }

  registerSupplier(args) {
    const check = this.checkSupplier(args);
    if (!check.ok) return check;
    const suffix = this.nextSupplierSuffix();
    const supplier = {
      id: `SUP-${suffix}`,
      organizationId: `ORG-SUP-${suffix}`,
      name: check.name,
      type: args.type,
      city: check.city,
      state: check.state,
      location: { lat: args.lat, lng: args.lng },
      registrationRef: check.registrationRef,
      listedSince: this.now().toISOString().slice(0, 10),
    };
    this.state.suppliers.push(supplier);
    this.save();
    return { ok: true, supplierId: supplier.id, organizationId: supplier.organizationId, name: supplier.name, stateVersion: this.state.version };
  }

  /** List an offer. A supplier has one offer per resource, so publishing again replaces it. */
  publishOffer(args) {
    const check = this.checkOffer(args);
    if (!check.ok) return check;
    const fields = {
      quantity: args.quantity,
      unitPrice: check.unitPrice,
      minOrder: args.minOrder,
      leadTimeHours: args.leadTimeHours,
      maxDiscountPct: check.maxDiscountPct,
      validForHours: SupplyData.OFFER_VALID_HOURS,
      notes: check.notes,
    };
    let offer = check.existing;
    if (offer) {
      Object.assign(offer, fields);
    } else {
      offer = {
        offerId: `OFF-${check.supplier.id.replace(/^SUP-/, "")}-${SupplyData.RESOURCES[args.resource].code}`,
        supplierId: check.supplier.id,
        resource: args.resource,
        ...fields,
      };
      this.state.offers.push(offer);
    }
    this.save();
    return { ok: true, replaced: Boolean(check.existing), offer: this.publicOffer(offer), stateVersion: this.state.version };
  }

  /** Set how many units of an offer buyers can still reserve. Reserved units stay reserved. */
  updateOfferStock(args) {
    const check = this.checkStock(args);
    if (!check.ok) return check;
    check.offer.quantity = args.quantity + this.reservedFor(check.offer.offerId);
    this.save();
    return { ok: true, offerId: check.offer.offerId, quantityAvailable: this.availableFor(check.offer), stateVersion: this.state.version };
  }

  reserveAllocation(args) {
    const check = this.checkReservation(args);
    if (!check.ok) return check;
    const reference = `AS-RSV-${String(this.state.reservations.length + 1).padStart(4, "0")}`;
    this.state.reservations.push({
      reference,
      incidentRef: check.incidentRef,
      createdAt: this.now().toISOString(),
      status: "reserved",
      total: check.total,
      lines: check.lines,
    });
    this.save();
    const units = check.lines.reduce((sum, line) => sum + line.quantity, 0);
    return {
      ok: true,
      reference,
      summary: `Reserved ${units.toLocaleString("en-IN")} units on ${check.lines.length} offer line(s) for ${check.incidentRef}. No payment was taken.`,
      lines: check.lines.map((line) => ({ ...line })),
      total: check.total,
      currency: SupplyData.CURRENCY,
      stateVersion: this.state.version,
    };
  }

  /** Give a reservation's stock back to its offers. Page only: partners cannot release. */
  releaseReservation(args) {
    const reservation = this.state.reservations.find((entry) => entry.reference === args.reference);
    if (!reservation) return { ok: false, field: "reference", reason: `No reservation with reference ${args.reference}.` };
    if (reservation.status !== "reserved") return { ok: false, field: "reference", reason: `Reservation ${reservation.reference} is already ${reservation.status}.` };
    reservation.status = "released";
    reservation.releasedAt = this.now().toISOString();
    this.save();
    return { ok: true, reference: reservation.reference, status: reservation.status, stateVersion: this.state.version };
  }
}
