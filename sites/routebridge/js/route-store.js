// RouteBridge's business rules and storage. No DOM here: the page, the assistant's
// actions, the bridge that other agent sites call, and the Node tests all use this class.
//
// Operations validate the whole input first and refuse by RETURNING
// {ok: false, reason, field}; they throw only on unexpected failures. The agent runtime
// reports a throw as "outcome unknown", so a refusal must never throw.
import { RouteData } from "./route-data.js";
import { DemoDatasetRouter, DistanceBook, OsrmRouter, Routing } from "./routing.js";
import { SiteLinks } from "./site-links.js";

const pad4 = (value) => String(value).padStart(4, "0");

export class RouteStore {
  static STORAGE_KEY = "routebridge-state-v1";

  /**
   * :param storage: A Storage-like object (localStorage), or null for memory only. In a
   *   bridge frame embedded by a site on another registrable domain, browsers partition
   *   storage, so the frame sees its own copy rather than what this site's page stored.
   * :param now: Clock, injectable for tests.
   * :param router: Where distances come from. Leave it out to use the operator's saved
   *   choice: the demonstration dataset unless live routing was turned on.
   * :param fetchImpl: fetch for the live-routing adapter, injectable for tests.
   */
  constructor(storage = RouteStore.defaultStorage(), now = () => new Date(), router = null, fetchImpl = undefined) {
    this.storage = storage;
    this.now = now;
    this.fetchImpl = fetchImpl;
    this.injectedRouter = router;
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
      providers: structuredClone(RouteData.PROVIDERS),
      shipments: [],
      bookings: 0,
      routing: { osrmBaseUrl: "" },
    };
  }

  load() {
    try {
      const raw = this.storage?.getItem(RouteStore.STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.providers) && Array.isArray(parsed.shipments)) {
          parsed.bookings = Number.isInteger(parsed.bookings) ? parsed.bookings : 0;
          parsed.routing = { osrmBaseUrl: String(parsed.routing?.osrmBaseUrl || "") };
          return parsed;
        }
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
      this.storage?.setItem(RouteStore.STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Storage full or blocked: the change still holds for this page view.
    }
  }

  reset() {
    try { this.storage?.removeItem(RouteStore.STORAGE_KEY); } catch { /* nothing to clear */ }
    this.state = this.seed();
    return { ok: true, version: this.state.version };
  }

  // ---- routing source ------------------------------------------------------------

  /** The router in use: an injected one, the operator's live service, or the demo dataset. */
  get router() {
    if (this.injectedRouter) return this.injectedRouter;
    const baseUrl = this.state.routing?.osrmBaseUrl;
    return baseUrl ? new OsrmRouter(baseUrl, this.fetchImpl) : new DemoDatasetRouter();
  }

  /** The "routing" block for a result that computed no distance. */
  routingInfo() {
    return this.router.describe();
  }

  /** The "routing" block for a result built from these legs' distances. */
  routingFor(legs) {
    const configured = this.router.describe();
    if (configured.source === DemoDatasetRouter.SOURCE) return configured;
    const live = legs.filter((leg) => leg.source === OsrmRouter.SOURCE).length;
    if (legs.length && live === legs.length) return configured;
    const demo = new DemoDatasetRouter().describe();
    return {
      ...demo,
      note: `${live} of ${legs.length} distance(s) came from the live routing service; the rest fell back to the demonstration dataset. ${demo.note}`,
    };
  }

  setRoutingSource(args) {
    const raw = String(args?.baseUrl ?? "").trim();
    if (raw === "") {
      this.state.routing = { osrmBaseUrl: "" };
      this.save();
      return { ok: true, routing: this.routingInfo(), stateVersion: this.state.version };
    }
    let url;
    try { url = new URL(raw); } catch { url = null; }
    if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      return { ok: false, field: "baseUrl", reason: "Enter the routing service's base URL, such as https://router.project-osrm.org, or leave it empty to use the demonstration dataset." };
    }
    if (raw.length > 200) return { ok: false, field: "baseUrl", reason: "The base URL must be 200 characters or fewer." };
    this.state.routing = { osrmBaseUrl: `${url.origin}${url.pathname}`.replace(/\/+$/, "") };
    this.save();
    return { ok: true, routing: this.routingInfo(), stateVersion: this.state.version };
  }

  // ---- reads ---------------------------------------------------------------------

  envelope(extra) {
    return { simulated: true, dataNotice: RouteData.NOTICE, source: `${SiteLinks.SELF}/`, generatedAt: this.now().toISOString(), ...extra };
  }

  findProvider(providerId) {
    return this.state.providers.find((provider) => provider.id === providerId) || null;
  }

  static findFleet(provider, vehicleType) {
    return provider?.fleet.find((entry) => entry.vehicleType === vehicleType) || null;
  }

  findShipment(trackingCode) {
    return this.state.shipments.find((shipment) => shipment.trackingCode === trackingCode) || null;
  }

  /** Vehicles of one provider and type held by shipments that are not finished. */
  held(providerId, vehicleType) {
    return this.state.shipments
      .filter((shipment) => shipment.providerId === providerId && shipment.vehicleType === vehicleType && RouteData.HOLDING.includes(shipment.status))
      .reduce((sum, shipment) => sum + shipment.vehicles, 0);
  }

  available(provider, fleet) {
    return Math.max(0, fleet.count - this.held(provider.id, fleet.vehicleType));
  }

  static floodZones() {
    return RouteData.FLOOD_ZONES.map((zone) => ({ ...zone, center: { ...zone.center } }));
  }

  providers() {
    return this.envelope({
      stateVersion: this.state.version,
      providers: this.state.providers.map((provider) => ({
        id: provider.id,
        organizationId: provider.organizationId,
        name: provider.name,
        base: { ...provider.base },
        fleet: provider.fleet.map((fleet) => ({
          vehicleType: fleet.vehicleType,
          count: fleet.count,
          available: this.available(provider, fleet),
          capacityKg: fleet.capacityKg,
          avgSpeedKmh: fleet.avgSpeedKmh,
          ratePerKm: fleet.ratePerKm,
          floodCapable: fleet.floodCapable,
        })),
      })),
      floodZones: RouteStore.floodZones(),
      routing: this.routingInfo(),
      links: SiteLinks.asFacts(),
    });
  }

  summary() {
    const fleets = this.state.providers.flatMap((provider) => provider.fleet.map((fleet) => ({ provider, fleet })));
    const active = this.state.shipments.filter((shipment) => RouteData.HOLDING.includes(shipment.status));
    return {
      providers: this.state.providers.length,
      vehicles: fleets.reduce((sum, entry) => sum + entry.fleet.count, 0),
      vehiclesFree: fleets.reduce((sum, entry) => sum + this.available(entry.provider, entry.fleet), 0),
      activeShipments: active.length,
      deliveredShipments: this.state.shipments.filter((shipment) => shipment.status === "delivered").length,
      shipments: this.state.shipments.length,
    };
  }

  static checkLane(args) {
    if (!Routing.isPoint(args?.from)) return { ok: false, field: "from", reason: "The origin needs a latitude from -90 to 90 and a longitude from -180 to 180." };
    if (!Routing.isPoint(args?.to)) return { ok: false, field: "to", reason: "The destination needs a latitude from -90 to 90 and a longitude from -180 to 180." };
    return { ok: true };
  }

  static checkWeight(weightKg) {
    if (typeof weightKg !== "number" || !Number.isFinite(weightKg) || weightKg < 1 || weightKg > 500000) {
      return { ok: false, field: "weightKg", reason: "Weight must be a number from 1 to 500,000 kg." };
    }
    return { ok: true };
  }

  /** Every provider's option for one load on one lane, ranked. Changes nothing. */
  async transportOptions(args) {
    const lane = RouteStore.checkLane(args);
    if (!lane.ok) return lane;
    const weight = RouteStore.checkWeight(args.weightKg);
    if (!weight.ok) return weight;
    const hasDeadline = args.neededWithinHours !== undefined && args.neededWithinHours !== null;
    if (hasDeadline && (typeof args.neededWithinHours !== "number" || !Number.isFinite(args.neededWithinHours) || args.neededWithinHours <= 0)) {
      return { ok: false, field: "neededWithinHours", reason: "The deadline must be a number of hours greater than 0." };
    }
    const book = new DistanceBook(this.router);
    const zone = Routing.findZone(args.to);
    const haul = await book.distance(args.from, args.to);
    const used = [haul];
    const options = [];
    for (const provider of this.state.providers) {
      const deadhead = await book.distance(provider.base, args.from);
      used.push(deadhead);
      const combined = DistanceBook.combine([deadhead, haul]);
      for (const fleet of provider.fleet) {
        options.push(Routing.option({
          provider,
          fleet,
          available: this.available(provider, fleet),
          deadheadKm: deadhead.km,
          haulKm: haul.km,
          weightKg: args.weightKg,
          neededWithinHours: hasDeadline ? args.neededWithinHours : undefined,
          zone,
          routeSource: combined.routeSource,
          routerAdvisories: combined.advisories,
        }));
      }
    }
    return this.envelope({
      stateVersion: this.state.version,
      request: {
        from: { ...args.from },
        to: { ...args.to },
        weightKg: args.weightKg,
        neededWithinHours: hasDeadline ? args.neededWithinHours : null,
      },
      haulKm: haul.km,
      zone: Routing.zoneSummary(zone),
      options: Routing.sortOptions(options),
      routing: this.routingFor(used),
    });
  }

  /** Haul distance, flood zone and best-case hours for several lanes. Changes nothing. */
  async estimateRoutes(args) {
    const legs = Array.isArray(args?.legs) ? args.legs : [];
    if (!legs.length) return { ok: false, field: "legs", reason: "List at least one lane." };
    if (legs.length > 40) return { ok: false, field: "legs", reason: "At most 40 lanes can be estimated at once." };
    for (const [index, leg] of legs.entries()) {
      const id = String(leg?.id ?? "").trim();
      if (!id || id.length > 40) return { ok: false, field: `legs[${index}]`, reason: "Each lane needs an id of up to 40 characters." };
      const lane = RouteStore.checkLane(leg);
      if (!lane.ok) return { ...lane, field: `legs[${index}].${lane.field}` };
    }
    const book = new DistanceBook(this.router);
    const distances = await Promise.all(legs.map((leg) => book.distance(leg.from, leg.to)));
    return this.envelope({
      stateVersion: this.state.version,
      legs: legs.map((leg, index) => {
        const zone = Routing.findZone(leg.to);
        const boatsOnly = zone?.effect === "boats_only";
        return {
          id: String(leg.id),
          haulKm: distances[index].km,
          zone: Routing.zoneSummary(zone),
          truckFeasible: !boatsOnly,
          boatRequired: boatsOnly,
          bestCaseHours: Routing.bestCaseHours(distances[index].km, zone),
        };
      }),
      routing: this.routingFor(distances),
    });
  }

  static shipmentView(shipment) {
    return {
      trackingCode: shipment.trackingCode,
      bookingRef: shipment.bookingRef,
      incidentRef: shipment.incidentRef,
      reference: shipment.reference,
      providerId: shipment.providerId,
      providerName: shipment.providerName,
      vehicleType: shipment.vehicleType,
      vehicles: shipment.vehicles,
      from: { ...shipment.from },
      to: { ...shipment.to },
      weightKg: shipment.weightKg,
      cargo: shipment.cargo.map((line) => ({ ...line })),
      deadheadKm: shipment.deadheadKm,
      haulKm: shipment.haulKm,
      etaHours: shipment.etaHours,
      cost: shipment.cost,
      routeSource: shipment.routeSource,
      status: shipment.status,
      nextStatuses: [...RouteData.TRANSITIONS[shipment.status]],
      createdAt: shipment.createdAt,
      updatedAt: shipment.updatedAt,
      history: shipment.history.map((entry) => ({ ...entry })),
    };
  }

  /** Every shipment, newest first, for this site's own page. */
  shipments() {
    return this.state.shipments.map(RouteStore.shipmentView).reverse();
  }

  shipmentStatus(args) {
    const codes = Array.isArray(args?.trackingCodes) ? args.trackingCodes : [];
    if (!codes.length) return { ok: false, field: "trackingCodes", reason: "List at least one tracking code." };
    if (codes.length > 40) return { ok: false, field: "trackingCodes", reason: "At most 40 tracking codes can be read at once." };
    return this.envelope({
      stateVersion: this.state.version,
      shipments: codes.map((raw) => {
        const trackingCode = String(raw).trim();
        const shipment = this.findShipment(trackingCode);
        if (!shipment) {
          return { trackingCode, found: false, status: null, providerId: null, vehicleType: null, updatedAt: null, history: [] };
        }
        return {
          trackingCode,
          found: true,
          status: shipment.status,
          providerId: shipment.providerId,
          vehicleType: shipment.vehicleType,
          updatedAt: shipment.updatedAt,
          history: shipment.history.map((entry) => ({ ...entry })),
        };
      }),
    });
  }

  // ---- checks (read-only; every write calls its check first) -----------------------

  static isWholeNumber(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
  }

  checkProvider(args) {
    const name = String(args?.name || "").trim();
    const city = String(args?.city || "").trim();
    const organizationId = String(args?.organizationId || "").trim();
    if (name.length < 3 || name.length > 80) return { ok: false, field: "name", reason: "Provider name must be 3 to 80 characters." };
    if (this.state.providers.some((provider) => provider.name.toLowerCase() === name.toLowerCase())) return { ok: false, field: "name", reason: "A provider with this name is already registered." };
    if (city.length < 2 || city.length > 60) return { ok: false, field: "city", reason: "Base town must be 2 to 60 characters." };
    if (organizationId.length > 20) return { ok: false, field: "organizationId", reason: "Organisation id must be 20 characters or fewer." };
    if (typeof args.lat !== "number" || !(args.lat >= -90 && args.lat <= 90)) return { ok: false, field: "lat", reason: "Latitude must be between -90 and 90." };
    if (typeof args.lng !== "number" || !(args.lng >= -180 && args.lng <= 180)) return { ok: false, field: "lng", reason: "Longitude must be between -180 and 180." };
    if (!RouteData.VEHICLES[args.vehicleType]) return { ok: false, field: "vehicleType", reason: `Vehicle type must be one of: ${RouteData.vehicleTypes().join(", ")}.` };
    if (!RouteStore.isWholeNumber(args.count, 1, 500)) return { ok: false, field: "count", reason: "Vehicle count must be a whole number from 1 to 500." };
    if (!RouteStore.isWholeNumber(args.capacityKg, 100, 100000)) return { ok: false, field: "capacityKg", reason: "Capacity must be a whole number from 100 to 100,000 kg." };
    if (typeof args.avgSpeedKmh !== "number" || !(args.avgSpeedKmh >= 1 && args.avgSpeedKmh <= 120)) return { ok: false, field: "avgSpeedKmh", reason: "Average speed must be from 1 to 120 km/h." };
    if (typeof args.ratePerKm !== "number" || !(args.ratePerKm >= 1 && args.ratePerKm <= 10000)) return { ok: false, field: "ratePerKm", reason: "Rate must be from 1 to 10,000 INR per km." };
    return { ok: true, name, city, organizationId };
  }

  checkFleet(args) {
    const provider = this.findProvider(args?.providerId);
    if (!provider) return { ok: false, field: "providerId", reason: `No provider with id ${args?.providerId}.` };
    const fleet = RouteStore.findFleet(provider, args.vehicleType);
    if (!fleet) return { ok: false, field: "vehicleType", reason: `${provider.name} has no ${args.vehicleType} in its fleet.` };
    if (!RouteStore.isWholeNumber(args.count, 0, 500)) return { ok: false, field: "count", reason: "Vehicle count must be a whole number from 0 to 500." };
    const held = this.held(provider.id, fleet.vehicleType);
    if (args.count < held) return { ok: false, field: "count", reason: `${held} of these vehicles are on shipments that are not finished, so the count cannot go below ${held}.` };
    return { ok: true, provider, fleet };
  }

  checkStatus(args) {
    const shipment = this.findShipment(String(args?.trackingCode || "").trim());
    if (!shipment) return { ok: false, field: "trackingCode", reason: `No shipment with tracking code ${args?.trackingCode}.` };
    if (!RouteData.TRANSITIONS[args.status]) return { ok: false, field: "status", reason: `Status must be one of: ${RouteData.statuses().join(", ")}.` };
    const allowed = RouteData.TRANSITIONS[shipment.status];
    if (!allowed.includes(args.status)) {
      const next = allowed.length ? `It can only become: ${allowed.join(", ")}.` : "That status is final.";
      return { ok: false, field: "status", reason: `Shipment ${shipment.trackingCode} is ${shipment.status}. ${next}` };
    }
    return { ok: true, shipment };
  }

  /**
   * Check a whole booking with the site's rules, and work out each shipment's distance,
   * time and cost. Changes nothing.
   *
   * :return: {ok: true, lines, totalCost}, or the first refusal.
   */
  async checkShipments(args) {
    const incidentRef = String(args?.incidentRef || "").trim();
    if (!incidentRef || incidentRef.length > 40) return { ok: false, field: "incidentRef", reason: "The booking needs an incident reference of up to 40 characters." };
    const list = Array.isArray(args?.shipments) ? args.shipments : [];
    if (!list.length) return { ok: false, field: "shipments", reason: "List at least one shipment." };
    if (list.length > 30) return { ok: false, field: "shipments", reason: "At most 30 shipments can be booked at once." };
    const book = new DistanceBook(this.router);
    const seen = new Set();
    const wanted = new Map();
    const lines = [];
    for (const [index, item] of list.entries()) {
      const where = `shipments[${index}]`;
      const reference = String(item?.reference || "").trim();
      if (!reference || reference.length > 40) return { ok: false, field: where, reason: "Each shipment needs a reference of up to 40 characters." };
      if (seen.has(reference)) return { ok: false, field: where, reason: `Reference ${reference} is listed twice.` };
      seen.add(reference);
      // Idempotency: the same shipment of the same incident is never booked twice.
      const earlier = this.state.shipments.find((shipment) => shipment.incidentRef === incidentRef && shipment.reference === reference && shipment.status !== "cancelled");
      if (earlier) return { ok: false, field: where, reason: `Shipment ${reference} of ${incidentRef} is already booked as ${earlier.trackingCode}. Nothing was changed.` };
      const provider = this.findProvider(item.providerId);
      if (!provider) return { ok: false, field: where, reason: `No provider with id ${item.providerId}.` };
      const fleet = RouteStore.findFleet(provider, item.vehicleType);
      if (!fleet) return { ok: false, field: where, reason: `${provider.name} has no ${item.vehicleType} in its fleet.` };
      const lane = RouteStore.checkLane(item);
      if (!lane.ok) return { ok: false, field: where, reason: `${reference}: ${lane.reason}` };
      const weight = RouteStore.checkWeight(item.weightKg);
      if (!weight.ok) return { ok: false, field: where, reason: `${reference}: ${weight.reason}` };
      if (!RouteStore.isWholeNumber(item.vehicles, 1, 50)) return { ok: false, field: where, reason: `${reference}: vehicles must be a whole number from 1 to 50.` };
      const cargo = Array.isArray(item.cargo) ? item.cargo : [];
      if (!cargo.length || cargo.length > 8) return { ok: false, field: where, reason: `${reference}: list 1 to 8 cargo lines.` };
      for (const line of cargo) {
        if (!RouteData.RESOURCES[line?.resource]) return { ok: false, field: where, reason: `${reference}: unknown resource ${line?.resource}.` };
        if (!RouteStore.isWholeNumber(line.quantity, 1, 100000)) return { ok: false, field: where, reason: `${reference}: each cargo quantity must be a whole number from 1 to 100,000.` };
      }
      const zone = Routing.findZone(item.to);
      if (Routing.zoneBlocks(zone, fleet.floodCapable)) {
        return { ok: false, field: where, reason: `${reference}: ${zone.name}. ${zone.note} A ${RouteData.VEHICLES[fleet.vehicleType].label.toLowerCase()} cannot make this delivery; book a flood-capable craft.` };
      }
      const needed = Routing.vehiclesNeeded(item.weightKg, fleet.capacityKg);
      if (item.vehicles < needed) {
        return { ok: false, field: where, reason: `${reference}: ${item.weightKg} kg needs ${needed} ${item.vehicleType} of ${fleet.capacityKg} kg each, not ${item.vehicles}.` };
      }
      const key = `${provider.id}|${fleet.vehicleType}`;
      const total = (wanted.get(key) || 0) + item.vehicles;
      const free = this.available(provider, fleet);
      if (total > free) {
        return { ok: false, field: where, reason: `${reference}: this booking needs ${total} ${item.vehicleType} from ${provider.name}, and ${free} are free right now. Nothing was changed.` };
      }
      wanted.set(key, total);
      const deadhead = await book.distance(provider.base, item.from);
      const haul = await book.distance(item.from, item.to);
      const combined = DistanceBook.combine([deadhead, haul]);
      lines.push({
        reference,
        provider,
        fleet,
        vehicles: item.vehicles,
        from: RouteStore.cleanPoint(item.from),
        to: RouteStore.cleanPoint(item.to),
        weightKg: item.weightKg,
        cargo: cargo.map((line) => ({ resource: line.resource, quantity: line.quantity })),
        zone: Routing.zoneSummary(zone),
        deadheadKm: deadhead.km,
        haulKm: haul.km,
        etaHours: Routing.etaHours(deadhead.km, haul.km, fleet.avgSpeedKmh, zone),
        cost: Routing.cost(deadhead.km, haul.km, fleet.ratePerKm, item.vehicles),
        routeSource: combined.routeSource,
        advisories: combined.advisories,
      });
    }
    return { ok: true, incidentRef, lines, totalCost: lines.reduce((sum, line) => sum + line.cost, 0) };
  }

  static cleanPoint(point) {
    const clean = { lat: point.lat, lng: point.lng };
    const label = String(point.label || "").trim().slice(0, 80);
    if (label) clean.label = label;
    return clean;
  }

  static pointLabel(point) {
    return point.label || `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
  }

  // ---- writes --------------------------------------------------------------------

  registerProvider(args) {
    const check = this.checkProvider(args);
    if (!check.ok) return check;
    const numbers = this.state.providers.map((provider) => Number(provider.id.replace(/\D/g, "")) || 0);
    const id = `TR-${Math.max(0, ...numbers) + 1}`;
    this.state.providers.push({
      id,
      organizationId: check.organizationId || `ORG-${id}`,
      name: check.name,
      base: { lat: args.lat, lng: args.lng, city: check.city },
      fleet: [{
        vehicleType: args.vehicleType,
        count: args.count,
        capacityKg: args.capacityKg,
        avgSpeedKmh: args.avgSpeedKmh,
        ratePerKm: args.ratePerKm,
        floodCapable: RouteData.VEHICLES[args.vehicleType].floodCapable,
      }],
    });
    this.save();
    return { ok: true, providerId: id, name: check.name, stateVersion: this.state.version };
  }

  updateFleetAvailability(args) {
    const check = this.checkFleet(args);
    if (!check.ok) return check;
    check.fleet.count = args.count;
    this.save();
    return {
      ok: true,
      providerId: check.provider.id,
      vehicleType: check.fleet.vehicleType,
      count: check.fleet.count,
      available: this.available(check.provider, check.fleet),
      stateVersion: this.state.version,
    };
  }

  updateShipmentStatus(args) {
    const check = this.checkStatus(args);
    if (!check.ok) return check;
    const at = this.now().toISOString();
    const previous = check.shipment.status;
    check.shipment.status = args.status;
    check.shipment.updatedAt = at;
    check.shipment.history.push({ status: args.status, at });
    this.save();
    return {
      ok: true,
      trackingCode: check.shipment.trackingCode,
      previousStatus: previous,
      status: check.shipment.status,
      nextStatuses: [...RouteData.TRANSITIONS[check.shipment.status]],
      updatedAt: at,
      stateVersion: this.state.version,
    };
  }

  /** Book the shipments: everything is checked again first, then all are stored or none. */
  async createShipments(args) {
    const check = await this.checkShipments(args);
    if (!check.ok) return check;
    const at = this.now().toISOString();
    this.state.bookings += 1;
    const bookingRef = `RB-BKG-${pad4(this.state.bookings)}`;
    const booked = [];
    for (const line of check.lines) {
      const shipment = {
        trackingCode: `RB-TRK-${pad4(this.state.shipments.length + 1)}`,
        bookingRef,
        incidentRef: check.incidentRef,
        reference: line.reference,
        providerId: line.provider.id,
        providerName: line.provider.name,
        vehicleType: line.fleet.vehicleType,
        vehicles: line.vehicles,
        from: line.from,
        to: line.to,
        weightKg: line.weightKg,
        cargo: line.cargo,
        deadheadKm: line.deadheadKm,
        haulKm: line.haulKm,
        etaHours: line.etaHours,
        cost: line.cost,
        routeSource: line.routeSource,
        status: "planned",
        createdAt: at,
        updatedAt: at,
        history: [{ status: "planned", at }],
      };
      this.state.shipments.push(shipment);
      booked.push({
        reference: shipment.reference,
        trackingCode: shipment.trackingCode,
        providerId: shipment.providerId,
        providerName: shipment.providerName,
        vehicleType: shipment.vehicleType,
        vehicles: shipment.vehicles,
        etaHours: shipment.etaHours,
        cost: shipment.cost,
        status: shipment.status,
      });
    }
    this.save();
    return {
      ok: true,
      reference: bookingRef,
      summary: `Booked ${booked.length} shipment(s) for ${check.incidentRef}.`,
      shipments: booked,
      totalCost: check.totalCost,
      currency: RouteData.CURRENCY,
      stateVersion: this.state.version,
    };
  }
}
