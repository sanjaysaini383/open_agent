// ShelterConnect's business rules and storage. No DOM here: the page, the assistant's
// actions, the bridge that other agent sites call, and the Node tests all use this class.
//
// Operations validate the whole input first and refuse by RETURNING
// {ok: false, reason, field}; they throw only on unexpected failures. The agent runtime
// reports a throw as "outcome unknown", so a refusal must never throw.
import { ShelterData } from "./shelter-data.js";
import { SiteLinks } from "./site-links.js";

export class ShelterStore {
  static STORAGE_KEY = "shelterconnect-state-v1";

  /**
   * :param storage: A Storage-like object (localStorage), or null for memory only. In a
   *   bridge frame embedded by a site on another registrable domain, browsers partition
   *   storage, so the frame sees its own copy rather than what this site's page stored.
   * :param now: Clock, injectable for tests.
   */
  constructor(storage = ShelterStore.defaultStorage(), now = () => new Date()) {
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
    const neededBy = new Date(this.now().getTime() + ShelterData.SEED_NEEDED_IN_HOURS * 3600_000).toISOString();
    const stamp = this.now().toISOString();
    return {
      version: 1,
      seeded: true,
      shelters: ShelterData.SHELTERS.map((shelter) => ({
        ...structuredClone(shelter),
        neededBy,
        updatedAt: stamp,
      })),
      deliveries: [],
    };
  }

  load() {
    try {
      const raw = this.storage?.getItem(ShelterStore.STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.shelters) && Array.isArray(parsed.deliveries)) return parsed;
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
      this.storage?.setItem(ShelterStore.STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Storage full or blocked: the change still holds for this page view.
    }
  }

  reset() {
    try { this.storage?.removeItem(ShelterStore.STORAGE_KEY); } catch { /* nothing to clear */ }
    this.state = this.seed();
    return { ok: true, version: this.state.version };
  }

  // ---- reads ---------------------------------------------------------------------

  findShelter(shelterId) {
    return this.state.shelters.find((shelter) => shelter.id === shelterId) || null;
  }

  shelterIds() {
    return this.state.shelters.map((shelter) => shelter.id);
  }

  static envelope(extra) {
    return { simulated: true, dataNotice: ShelterData.NOTICE, source: `${SiteLinks.SELF}/`, ...extra };
  }

  overview() {
    return ShelterStore.envelope({
      generatedAt: this.now().toISOString(),
      stateVersion: this.state.version,
      shelters: this.state.shelters.map((shelter) => ({
        id: shelter.id,
        name: shelter.name,
        block: shelter.block,
        district: shelter.district,
        state: shelter.state,
        location: { ...shelter.location },
        capacity: shelter.capacity,
        occupancy: shelter.occupancy,
        freeCapacity: Math.max(0, shelter.capacity - shelter.occupancy),
        urgency: shelter.urgency,
        managedBy: shelter.managedBy,
        updatedAt: shelter.updatedAt,
      })),
      totals: {
        shelters: this.state.shelters.length,
        capacity: this.state.shelters.reduce((sum, shelter) => sum + shelter.capacity, 0),
        occupancy: this.state.shelters.reduce((sum, shelter) => sum + shelter.occupancy, 0),
      },
      resources: ShelterData.RESOURCES,
      links: SiteLinks.asFacts(),
    });
  }

  /** One row per shelter and resource with a stated requirement. */
  requestRows() {
    const rows = [];
    for (const shelter of this.state.shelters) {
      for (const resource of ShelterData.resourceIds()) {
        const required = shelter.requirements[resource] || 0;
        if (required <= 0) continue;
        const inStock = shelter.inventory[resource] || 0;
        const shortage = Math.max(0, required - inStock);
        rows.push({
          id: `${shelter.id}:${resource}`,
          shelterId: shelter.id,
          shelterName: shelter.name,
          resource,
          resourceLabel: ShelterData.RESOURCES[resource].label,
          unit: ShelterData.RESOURCES[resource].unit,
          quantityRequired: required,
          quantityInStock: inStock,
          shortage,
          urgency: shelter.urgency,
          peopleServed: shelter.occupancy,
          neededBy: shelter.neededBy,
          status: shortage > 0 ? "open" : "covered",
        });
      }
    }
    return rows;
  }

  resourceRequests(filter = {}) {
    let rows = this.requestRows();
    if (filter.status && filter.status !== "all") rows = rows.filter((row) => row.status === filter.status);
    if (filter.shelterId) rows = rows.filter((row) => row.shelterId === filter.shelterId);
    const totals = {};
    for (const resource of ShelterData.resourceIds()) {
      const subset = rows.filter((row) => row.resource === resource);
      totals[resource] = {
        required: subset.reduce((sum, row) => sum + row.quantityRequired, 0),
        inStock: subset.reduce((sum, row) => sum + row.quantityInStock, 0),
        shortage: subset.reduce((sum, row) => sum + row.shortage, 0),
      };
    }
    return ShelterStore.envelope({
      generatedAt: this.now().toISOString(),
      stateVersion: this.state.version,
      requests: rows,
      totals,
    });
  }

  inventory(filter = {}) {
    const shelters = filter.shelterId ? this.state.shelters.filter((shelter) => shelter.id === filter.shelterId) : this.state.shelters;
    return ShelterStore.envelope({
      generatedAt: this.now().toISOString(),
      stateVersion: this.state.version,
      inventory: shelters.map((shelter) => ({
        shelterId: shelter.id,
        shelterName: shelter.name,
        stock: { ...shelter.inventory },
        requirements: { ...shelter.requirements },
        updatedAt: shelter.updatedAt,
      })),
      recentDeliveries: this.state.deliveries.slice(-20),
    });
  }

  // ---- checks (read-only; every write calls its check first) -----------------------

  static isWholeNumber(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
  }

  checkInventory(args) {
    const shelter = this.findShelter(args.shelterId);
    if (!shelter) return { ok: false, field: "shelterId", reason: `No shelter with id ${args.shelterId}.` };
    if (!ShelterData.RESOURCES[args.resource]) return { ok: false, field: "resource", reason: `Unknown resource ${args.resource}.` };
    if (!ShelterStore.isWholeNumber(args.quantity, 0, 100000)) return { ok: false, field: "quantity", reason: "Stock must be a whole number from 0 to 100,000." };
    return { ok: true, shelter };
  }

  checkRequest(args) {
    const shelter = this.findShelter(args.shelterId);
    if (!shelter) return { ok: false, field: "shelterId", reason: `No shelter with id ${args.shelterId}.` };
    if (!ShelterData.RESOURCES[args.resource]) return { ok: false, field: "resource", reason: `Unknown resource ${args.resource}.` };
    if (!ShelterStore.isWholeNumber(args.quantityRequired, 0, 100000)) return { ok: false, field: "quantityRequired", reason: "Required quantity must be a whole number from 0 to 100,000." };
    if (args.neededBy !== undefined && args.neededBy !== "") {
      const when = Date.parse(args.neededBy);
      if (!Number.isFinite(when)) return { ok: false, field: "neededBy", reason: "Needed-by must be a date and time, such as 2026-12-01T18:00." };
      if (when < this.now().getTime()) return { ok: false, field: "neededBy", reason: "Needed-by cannot be in the past." };
    }
    return { ok: true, shelter };
  }

  checkShelter(args) {
    const name = String(args.name || "").trim();
    const block = String(args.block || "").trim();
    if (name.length < 3 || name.length > 80) return { ok: false, field: "name", reason: "Shelter name must be 3 to 80 characters." };
    if (this.state.shelters.some((shelter) => shelter.name.toLowerCase() === name.toLowerCase())) return { ok: false, field: "name", reason: "A shelter with this name is already registered." };
    if (block.length < 2 || block.length > 60) return { ok: false, field: "block", reason: "Block or locality must be 2 to 60 characters." };
    if (typeof args.lat !== "number" || args.lat < -90 || args.lat > 90) return { ok: false, field: "lat", reason: "Latitude must be between -90 and 90." };
    if (typeof args.lng !== "number" || args.lng < -180 || args.lng > 180) return { ok: false, field: "lng", reason: "Longitude must be between -180 and 180." };
    if (!ShelterStore.isWholeNumber(args.capacity, 1, 100000)) return { ok: false, field: "capacity", reason: "Capacity must be a whole number from 1 to 100,000." };
    if (!ShelterStore.isWholeNumber(args.occupancy, 0, 100000)) return { ok: false, field: "occupancy", reason: "Occupancy must be a whole number from 0 to 100,000." };
    if (args.occupancy > args.capacity) return { ok: false, field: "occupancy", reason: "Occupancy cannot be more than capacity." };
    if (!ShelterData.URGENCY.includes(args.urgency)) return { ok: false, field: "urgency", reason: `Urgency must be one of: ${ShelterData.URGENCY.join(", ")}.` };
    return { ok: true, name, block };
  }

  checkDeliveries(args) {
    const list = Array.isArray(args.deliveries) ? args.deliveries : [];
    if (!list.length) return { ok: false, field: "deliveries", reason: "List at least one delivery." };
    if (list.length > 40) return { ok: false, field: "deliveries", reason: "At most 40 deliveries can be recorded at once." };
    const seen = new Set();
    const lines = [];
    for (const [index, item] of list.entries()) {
      const where = `deliveries[${index}]`;
      const shelter = this.findShelter(item.shelterId);
      if (!shelter) return { ok: false, field: where, reason: `No shelter with id ${item.shelterId}.` };
      if (!ShelterData.RESOURCES[item.resource]) return { ok: false, field: where, reason: `Unknown resource ${item.resource}.` };
      if (!ShelterStore.isWholeNumber(item.quantity, 1, 100000)) return { ok: false, field: where, reason: "Each delivered quantity must be a whole number from 1 to 100,000." };
      const ref = String(item.shipmentRef || "").trim();
      if (!ref || ref.length > 40) return { ok: false, field: where, reason: "Each delivery needs a shipment reference of up to 40 characters." };
      const key = `${ref}|${item.shelterId}|${item.resource}`;
      if (seen.has(key)) return { ok: false, field: where, reason: `Shipment ${ref} lists ${item.resource} for ${item.shelterId} twice.` };
      seen.add(key);
      // Idempotency: the same shipment line is never counted into stock twice.
      if (this.state.deliveries.some((done) => done.shipmentRef === ref && done.shelterId === item.shelterId && done.resource === item.resource)) {
        return { ok: false, field: where, reason: `Shipment ${ref} (${item.resource} for ${item.shelterId}) was already recorded. Nothing was changed.` };
      }
      lines.push({ shelter, resource: item.resource, quantity: item.quantity, shipmentRef: ref });
    }
    return { ok: true, lines };
  }

  // ---- writes --------------------------------------------------------------------

  updateInventory(args) {
    const check = this.checkInventory(args);
    if (!check.ok) return check;
    check.shelter.inventory[args.resource] = args.quantity;
    check.shelter.updatedAt = this.now().toISOString();
    this.save();
    return { ok: true, shelterId: args.shelterId, resource: args.resource, stock: args.quantity, stateVersion: this.state.version };
  }

  publishRequest(args) {
    const check = this.checkRequest(args);
    if (!check.ok) return check;
    check.shelter.requirements[args.resource] = args.quantityRequired;
    if (args.neededBy) check.shelter.neededBy = new Date(args.neededBy).toISOString();
    check.shelter.updatedAt = this.now().toISOString();
    this.save();
    const row = this.requestRows().find((entry) => entry.id === `${args.shelterId}:${args.resource}`);
    return { ok: true, request: row || null, stateVersion: this.state.version };
  }

  setUrgency(args) {
    const shelter = this.findShelter(args.shelterId);
    if (!shelter) return { ok: false, field: "shelterId", reason: `No shelter with id ${args.shelterId}.` };
    if (!ShelterData.URGENCY.includes(args.urgency)) return { ok: false, field: "urgency", reason: `Urgency must be one of: ${ShelterData.URGENCY.join(", ")}.` };
    shelter.urgency = args.urgency;
    shelter.updatedAt = this.now().toISOString();
    this.save();
    return { ok: true, shelterId: shelter.id, urgency: shelter.urgency, stateVersion: this.state.version };
  }

  updateOccupancy(args) {
    const shelter = this.findShelter(args.shelterId);
    if (!shelter) return { ok: false, field: "shelterId", reason: `No shelter with id ${args.shelterId}.` };
    if (!ShelterStore.isWholeNumber(args.occupancy, 0, shelter.capacity)) return { ok: false, field: "occupancy", reason: `Occupancy must be a whole number from 0 to this shelter's capacity (${shelter.capacity}).` };
    shelter.occupancy = args.occupancy;
    shelter.updatedAt = this.now().toISOString();
    this.save();
    return { ok: true, shelterId: shelter.id, occupancy: shelter.occupancy, freeCapacity: shelter.capacity - shelter.occupancy, stateVersion: this.state.version };
  }

  registerShelter(args) {
    const check = this.checkShelter(args);
    if (!check.ok) return check;
    const numbers = this.state.shelters.map((shelter) => Number(shelter.id.replace(/\D/g, "")) || 0);
    const id = `SH-${String(Math.max(0, ...numbers) + 1).padStart(2, "0")}`;
    const empty = Object.fromEntries(ShelterData.resourceIds().map((resource) => [resource, 0]));
    this.state.shelters.push({
      id,
      name: check.name,
      block: check.block,
      district: "Malda",
      state: "West Bengal",
      location: { lat: args.lat, lng: args.lng },
      capacity: args.capacity,
      occupancy: args.occupancy,
      urgency: args.urgency,
      managedBy: "Registered on ShelterConnect (simulated)",
      inventory: { ...empty },
      requirements: { ...empty },
      neededBy: new Date(this.now().getTime() + ShelterData.SEED_NEEDED_IN_HOURS * 3600_000).toISOString(),
      updatedAt: this.now().toISOString(),
    });
    this.save();
    return { ok: true, shelterId: id, name: check.name, stateVersion: this.state.version };
  }

  recordDeliveries(args) {
    const check = this.checkDeliveries(args);
    if (!check.ok) return check;
    const reference = `SC-DLV-${String(this.state.deliveries.length + 1).padStart(4, "0")}`;
    const recordedAt = this.now().toISOString();
    const recorded = [];
    for (const line of check.lines) {
      line.shelter.inventory[line.resource] = (line.shelter.inventory[line.resource] || 0) + line.quantity;
      line.shelter.updatedAt = recordedAt;
      const entry = { reference, shelterId: line.shelter.id, resource: line.resource, quantity: line.quantity, shipmentRef: line.shipmentRef, recordedAt };
      this.state.deliveries.push(entry);
      recorded.push({ ...entry, newStock: line.shelter.inventory[line.resource] });
    }
    this.save();
    return {
      ok: true,
      reference,
      summary: `Recorded ${recorded.length} delivery line(s) into shelter stock.`,
      recorded,
      stateVersion: this.state.version,
    };
  }

  /** Readable lines for a confirmation screen. Changes nothing. */
  deliverySummaryLines(args) {
    const check = this.checkDeliveries(args);
    if (!check.ok) return [];
    return check.lines.map((line) => `${line.quantity.toLocaleString("en-IN")} ${ShelterData.RESOURCES[line.resource].label.toLowerCase()} for ${line.shelter.name} (shipment ${line.shipmentRef})`);
  }
}
