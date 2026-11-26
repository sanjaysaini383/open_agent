// RouteBridge's routing model: pure functions, no DOM and no storage.
//
// Distances come from a "router". The default, DemoDatasetRouter, is the deterministic
// demonstration model: great-circle distance times a road factor. OsrmRouter is an
// optional adapter for a real routing service; an operator turns it on, and when a call
// to it fails it falls back to the demonstration model and says so. Nothing here ever
// labels a demonstration distance as live routing.
import { RouteData } from "./route-data.js";

const EARTH_RADIUS_KM = 6371.0088;
const toRadians = (degrees) => (degrees * Math.PI) / 180;

export class Routing {
  static round1(value) {
    return Math.round((value + Number.EPSILON) * 10) / 10;
  }

  /** Great-circle distance between two {lat, lng} points, in kilometres. */
  static haversineKm(a, b) {
    const dLat = toRadians(b.lat - a.lat);
    const dLng = toRadians(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /** The demonstration road distance: great-circle distance times ROAD_FACTOR, 1 decimal. */
  static roadKm(a, b) {
    return Routing.round1(Routing.haversineKm(a, b) * RouteData.ROAD_FACTOR);
  }

  /** The first flood zone whose circle contains the point, or null. */
  static findZone(point, zones = RouteData.FLOOD_ZONES) {
    for (const zone of zones) {
      if (Routing.haversineKm(zone.center, point) <= zone.radiusKm) return zone;
    }
    return null;
  }

  static zoneSummary(zone) {
    if (!zone) return null;
    const summary = { id: zone.id, name: zone.name, effect: zone.effect };
    if (zone.delayHours) summary.delayHours = zone.delayHours;
    return summary;
  }

  static vehiclesNeeded(weightKg, capacityKg) {
    return Math.max(1, Math.ceil(weightKg / capacityKg));
  }

  static etaHours(deadheadKm, haulKm, avgSpeedKmh, zone) {
    return Routing.round1((deadheadKm + haulKm) / avgSpeedKmh + RouteData.LOADING_HOURS + (zone?.delayHours || 0));
  }

  static cost(deadheadKm, haulKm, ratePerKm, vehicles) {
    return Math.round((deadheadKm * 0.5 + haulKm) * ratePerKm * vehicles);
  }

  /** Haul-only time at each vehicle type's nominal speed, with loading and any zone delay. */
  static bestCaseHours(haulKm, zone) {
    const hours = {};
    for (const [type, vehicle] of Object.entries(RouteData.VEHICLES)) {
      hours[type] = Routing.round1(haulKm / vehicle.nominalSpeedKmh + RouteData.LOADING_HOURS + (zone?.delayHours || 0));
    }
    return hours;
  }

  /** Whether a vehicle of this kind may enter the zone at all. */
  static zoneBlocks(zone, floodCapable) {
    return !!zone && zone.effect === "boats_only" && !floodCapable;
  }

  /**
   * One transport option: one provider's vehicle type on one lane.
   *
   * :param input: provider, fleet entry, vehicles available now, the two distances, the
   *   load, the optional deadline, the destination's zone, where the distances came from
   *   and any advisories the router raised.
   * :return: The option as the contract lists it.
   */
  static option({ provider, fleet, available, deadheadKm, haulKm, weightKg, neededWithinHours, zone, routeSource, routerAdvisories = [] }) {
    const vehiclesNeeded = Routing.vehiclesNeeded(weightKg, fleet.capacityKg);
    const blocked = Routing.zoneBlocks(zone, fleet.floodCapable);
    const enough = vehiclesNeeded <= available;
    const etaHours = Routing.etaHours(deadheadKm, haulKm, fleet.avgSpeedKmh, zone);
    const hasDeadline = typeof neededWithinHours === "number" && Number.isFinite(neededWithinHours);
    const advisories = [];
    if (blocked) advisories.push(`${zone.name}: ${zone.note} A ${RouteData.VEHICLES[fleet.vehicleType]?.label.toLowerCase() || fleet.vehicleType} cannot make this delivery.`);
    else if (zone?.effect === "boats_only") advisories.push(`${zone.name}: ${zone.note} This craft is flood-capable.`);
    else if (zone?.effect === "delay") advisories.push(`${zone.name}: ${zone.note} ${zone.delayHours} h added to the estimate.`);
    if (!enough) advisories.push(`Needs ${vehiclesNeeded} vehicle(s); ${available} free right now.`);
    advisories.push(...routerAdvisories);
    return {
      providerId: provider.id,
      organizationId: provider.organizationId,
      providerName: provider.name,
      vehicleType: fleet.vehicleType,
      floodCapable: fleet.floodCapable,
      vehiclesNeeded,
      vehiclesAvailable: available,
      capacityKg: fleet.capacityKg,
      deadheadKm,
      haulKm,
      etaHours,
      cost: Routing.cost(deadheadKm, haulKm, fleet.ratePerKm, vehiclesNeeded),
      currency: RouteData.CURRENCY,
      feasible: enough && !blocked,
      meetsDeadline: hasDeadline ? etaHours <= neededWithinHours : null,
      advisories,
      routeSource,
    };
  }

  /** Feasible first, then the shortest time, then the lowest cost. Stable for ties. */
  static sortOptions(options) {
    return options
      .map((option, index) => ({ option, index }))
      .sort((a, b) => (Number(b.option.feasible) - Number(a.option.feasible))
        || (a.option.etaHours - b.option.etaHours)
        || (a.option.cost - b.option.cost)
        || (a.index - b.index))
      .map((entry) => entry.option);
  }

  static isPoint(point) {
    return !!point && typeof point.lat === "number" && typeof point.lng === "number"
      && Number.isFinite(point.lat) && Number.isFinite(point.lng)
      && point.lat >= -90 && point.lat <= 90 && point.lng >= -180 && point.lng <= 180;
  }
}

/**
 * The router interface: distance(from, to) resolves to {km, source, advisory}.
 * describe() says where distances come from, for the "routing" block of every result.
 */
export class DemoDatasetRouter {
  static SOURCE = "demo-dataset";

  get source() {
    return DemoDatasetRouter.SOURCE;
  }

  async distance(from, to) {
    return { km: Routing.roadKm(from, to), source: DemoDatasetRouter.SOURCE, advisory: null };
  }

  describe() {
    return {
      source: DemoDatasetRouter.SOURCE,
      method: `great-circle distance × ${RouteData.ROAD_FACTOR} road factor`,
      note: "Demonstration routing dataset: distances are estimates, not live routing, traffic or road conditions.",
    };
  }
}

/**
 * Optional adapter for an OSRM-compatible routing service. Off unless an operator of this
 * site turns it on, because it sends route coordinates to that third-party service.
 */
export class OsrmRouter {
  static SOURCE = "osrm";
  static TIMEOUT_MS = 6000;
  static FALLBACK_ADVISORY = "The live routing service did not answer; the demonstration distance was used for this leg.";

  /**
   * :param baseUrl: The service's base URL, such as https://router.project-osrm.org.
   * :param fetchImpl: fetch, injectable for tests.
   */
  constructor(baseUrl, fetchImpl = globalThis.fetch?.bind(globalThis)) {
    this.baseUrl = String(baseUrl || "").replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
    this.fallback = new DemoDatasetRouter();
  }

  get source() {
    return OsrmRouter.SOURCE;
  }

  static url(baseUrl, from, to) {
    return `${baseUrl}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
  }

  async distance(from, to) {
    try {
      if (typeof this.fetchImpl !== "function") throw new Error("fetch is not available");
      const controller = typeof AbortController === "undefined" ? null : new AbortController();
      const timer = controller ? setTimeout(() => controller.abort(), OsrmRouter.TIMEOUT_MS) : null;
      let body;
      try {
        const response = await this.fetchImpl(OsrmRouter.url(this.baseUrl, from, to), { signal: controller?.signal });
        if (!response.ok) throw new Error(`routing service answered ${response.status}`);
        body = await response.json();
      } finally {
        if (timer) clearTimeout(timer);
      }
      const metres = body?.routes?.[0]?.distance;
      if (body?.code !== "Ok" || typeof metres !== "number" || !Number.isFinite(metres) || metres < 0) {
        throw new Error("routing service returned no route");
      }
      return { km: Routing.round1(metres / 1000), source: OsrmRouter.SOURCE, advisory: null };
    } catch {
      const demo = await this.fallback.distance(from, to);
      return { ...demo, advisory: OsrmRouter.FALLBACK_ADVISORY };
    }
  }

  describe() {
    return {
      source: OsrmRouter.SOURCE,
      method: `road distance from the routing service at ${this.baseUrl}`,
      note: "Live routing is turned on by this site's operator. A leg the service cannot answer falls back to the demonstration dataset and is labelled demo-dataset.",
    };
  }
}

/**
 * Remembers each distance for one computation, so a lane shared by several options is
 * asked for once, and reports whether every distance really came from the live service.
 */
export class DistanceBook {
  constructor(router) {
    this.router = router;
    this.cache = new Map();
  }

  static key(from, to) {
    return `${from.lat},${from.lng}>${to.lat},${to.lng}`;
  }

  distance(from, to) {
    const key = DistanceBook.key(from, to);
    if (!this.cache.has(key)) this.cache.set(key, Promise.resolve(this.router.distance(from, to)));
    return this.cache.get(key);
  }

  /** The source and advisories of an option built from these legs. */
  static combine(legs) {
    const live = legs.every((leg) => leg.source === OsrmRouter.SOURCE);
    return {
      routeSource: live ? OsrmRouter.SOURCE : DemoDatasetRouter.SOURCE,
      advisories: [...new Set(legs.map((leg) => leg.advisory).filter(Boolean))],
    };
  }
}
