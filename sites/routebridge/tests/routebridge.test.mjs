// RouteBridge tests: the routing model, the store's rules, the live-routing adapter, and
// that the actions match the manifest.
// Run: node --test "sites/routebridge/tests/*.test.mjs"
//
// Expected distances, times and costs below were worked out independently of the site's
// code (spherical law of cosines and the contract's formulas), not copied from its output.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { ActionRegistry } from "../runtime/actions.js";
import { App } from "../js/app.js";
import { RouteData } from "../js/route-data.js";
import { RouteSchemas } from "../js/route-schemas.js";
import { RouteStore } from "../js/route-store.js";
import { DemoDatasetRouter, OsrmRouter, Routing } from "../js/routing.js";
import { SiteLinks } from "../js/site-links.js";
import { registerActions as registerBridge } from "../bridge/bridge-actions.js";
import { ShipmentWindow } from "../bridge/shipment-window.js";
import { registerActions as registerSite } from "../site-actions.js";
import { AssistantMount } from "../site.js";

const NOW = () => new Date("2026-11-26T10:00:00.000Z");
const fresh = (router = null, fetchImpl = undefined) => new RouteStore(null, NOW, router, fetchImpl);
const manifest = JSON.parse(await readFile(new URL("../agent-manifest.json", import.meta.url), "utf8"));
const SCOPE = { base: "http://localhost:8084", network: "routebridge" };

const MALDA = { lat: 25.0108, lng: 88.1411 };
const FARAKKA = { lat: 24.7743, lng: 87.9166 };
const SILIGURI = { lat: 26.7271, lng: 88.3953 };
const BERHAMPORE = { lat: 24.1040, lng: 88.2510 };
const KOLKATA = { lat: 22.5726, lng: 88.3639 };
const SH01 = { lat: 25.0773, lng: 87.9003, label: "SH-01 Manikchak" };
const SH02 = { lat: 25.2046, lng: 87.9281, label: "SH-02 Ratua" };
const SH03 = { lat: 25.4168, lng: 87.8724, label: "SH-03 Harishchandrapur" };
const SH04 = { lat: 24.8623, lng: 88.0158, label: "SH-04 Kaliachak" };
const KM_PER_DEGREE_LAT = 111.195;

function registryOf(register) {
  const registry = new ActionRegistry();
  register({ register: (definition) => registry.register(SCOPE, definition) });
  return registry;
}

const pick = (result, providerId, vehicleType) => result.options.find((option) => option.providerId === providerId && option.vehicleType === vehicleType);

/** One shipment line for a booking, overridable. Berhampore to Kaliachak, outside every zone. */
function line(overrides = {}) {
  return {
    reference: "LANE-1",
    providerId: "TR-4",
    vehicleType: "light_truck",
    vehicles: 1,
    from: { ...BERHAMPORE, label: "SUP-C depot" },
    to: { ...SH04 },
    weightKg: 2400,
    cargo: [{ resource: "food_packets", quantity: 500 }, { resource: "water_kits", quantity: 300 }],
    ...overrides,
  };
}

const booking = (shipments, incidentRef = "INC-0001") => ({ incidentRef, shipments });

// ---- the routing model -------------------------------------------------------------

test("haversineKm matches two hand-computed distances within 1%", () => {
  // Malda Town to Farakka: 0.2365 deg of latitude is 26.30 km; 0.2245 deg of longitude at
  // 24.89 deg N is 22.64 km; the hypotenuse is 34.70 km.
  const short = Routing.haversineKm(MALDA, FARAKKA);
  assert.ok(Math.abs(short - 34.70) / 34.70 < 0.01, `Malda-Farakka ${short}`);
  // Kolkata to Siliguri: 4.1545 deg of latitude is 461.96 km; the 0.0314 deg of longitude
  // adds 3.2 km across, so 461.97 km.
  const long = Routing.haversineKm(KOLKATA, SILIGURI);
  assert.ok(Math.abs(long - 461.97) / 461.97 < 0.01, `Kolkata-Siliguri ${long}`);
  assert.equal(Routing.haversineKm(MALDA, MALDA), 0);
  assert.ok(Math.abs(Routing.haversineKm(MALDA, FARAKKA) - Routing.haversineKm(FARAKKA, MALDA)) < 1e-9);
});

test("roadKm is the great-circle distance times 1.32, rounded to one decimal", () => {
  // 34.7034 km x 1.32 = 45.808 km -> 45.8
  assert.equal(Routing.roadKm(MALDA, FARAKKA), 45.8);
  assert.equal(Routing.roadKm(BERHAMPORE, BERHAMPORE), 0);
  for (const [a, b] of [[MALDA, SILIGURI], [KOLKATA, SH03], [FARAKKA, SH02]]) {
    const km = Routing.roadKm(a, b);
    assert.equal(km, Math.round(km * 10) / 10);
    assert.ok(Math.abs(km - Routing.haversineKm(a, b) * 1.32) <= 0.05);
  }
  assert.equal(RouteData.ROAD_FACTOR, 1.32);
});

test("zone lookup holds on both sides of each radius", () => {
  const north = (center, km) => ({ lat: center.lat + km / KM_PER_DEGREE_LAT, lng: center.lng });
  const [fz1, fz2] = RouteData.FLOOD_ZONES;
  assert.equal(Routing.findZone(north(fz1.center, 6.9))?.id, "FZ-1");
  assert.equal(Routing.findZone(north(fz1.center, 7.1)), null);
  assert.equal(Routing.findZone(north(fz2.center, 4.9))?.id, "FZ-2");
  assert.equal(Routing.findZone(north(fz2.center, 5.1)), null);
  assert.equal(Routing.findZone(SH01)?.effect, "boats_only");
  assert.equal(Routing.findZone(SH02)?.effect, "delay");
  assert.equal(Routing.findZone(SH02)?.delayHours, 1.5);
  assert.equal(Routing.findZone(SH03), null);
  assert.equal(Routing.findZone(SH04), null);
});

test("an option outside every zone matches the hand-computed numbers", async () => {
  // TR-4 light truck (3,000 kg, 40 km/h, 40 INR/km) based at Berhampore, 2,400 kg from
  // Berhampore to Kaliachak: deadhead 0, haul 115.7 km, 1 vehicle,
  // 115.7 / 40 + 1 = 3.8925 -> 3.9 h, 115.7 x 40 = 4,628 INR.
  const result = await fresh().transportOptions({ from: BERHAMPORE, to: SH04, weightKg: 2400 });
  const option = pick(result, "TR-4", "light_truck");
  assert.deepEqual(
    [option.vehiclesNeeded, option.deadheadKm, option.haulKm, option.etaHours, option.cost],
    [1, 0, 115.7, 3.9, 4628],
  );
  assert.equal(option.feasible, true);
  assert.equal(option.meetsDeadline, null);
  assert.equal(option.vehiclesAvailable, 4);
  assert.equal(option.capacityKg, 3000);
  assert.equal(option.organizationId, "ORG-TR-4");
  assert.equal(option.currency, "INR");
  assert.equal(result.zone, null);
  assert.equal(result.haulKm, 115.7);
});

test("an option into the delay zone adds its 1.5 hours", async () => {
  // TR-1 heavy truck (9,000 kg, 30 km/h, 72 INR/km) based at Malda Town, 20,000 kg from
  // Siliguri to Ratua (FZ-2): ceil(20000 / 9000) = 3 vehicles, deadhead 254.1 km,
  // haul 231.8 km, (254.1 + 231.8) / 30 + 1 + 1.5 = 18.697 -> 18.7 h,
  // (254.1 x 0.5 + 231.8) x 72 x 3 = 77,511.6 -> 77,512 INR.
  const result = await fresh().transportOptions({ from: SILIGURI, to: SH02, weightKg: 20000 });
  const option = pick(result, "TR-1", "heavy_truck");
  assert.deepEqual(
    [option.vehiclesNeeded, option.deadheadKm, option.haulKm, option.etaHours, option.cost],
    [3, 254.1, 231.8, 18.7, 77512],
  );
  assert.equal(option.feasible, true, "3 needed, 3 free");
  assert.deepEqual(result.zone, { id: "FZ-2", name: "Ratua low-lying approach", effect: "delay", delayHours: 1.5 });
  assert.ok(option.advisories.some((text) => text.includes("1.5 h")));
  // 20,000 kg needs 7 light trucks of 3,000 kg; TR-4 has 4, so that option is not feasible.
  const tooFew = pick(result, "TR-4", "light_truck");
  assert.deepEqual([tooFew.vehiclesNeeded, tooFew.vehiclesAvailable, tooFew.feasible], [7, 4, false]);
});

test("into the boats-only zone, trucks are infeasible and boats are feasible", async () => {
  // TR-2 relief boat (1,200 kg, 14 km/h, 55 INR/km) based at Farakka, 2,400 kg from
  // Berhampore to Manikchak (FZ-1): 2 boats, deadhead 108.1 km, haul 150.3 km,
  // (108.1 + 150.3) / 14 + 1 = 19.457 -> 19.5 h, (108.1 x 0.5 + 150.3) x 55 x 2 = 22,478.5 -> 22,479 INR.
  const result = await fresh().transportOptions({ from: BERHAMPORE, to: SH01, weightKg: 2400 });
  const boat = pick(result, "TR-2", "relief_boat");
  assert.deepEqual(
    [boat.vehiclesNeeded, boat.deadheadKm, boat.haulKm, boat.etaHours, boat.cost, boat.feasible, boat.floodCapable],
    [2, 108.1, 150.3, 19.5, 22479, true, true],
  );
  // TR-1 light truck would be faster (133.9 + 150.3) / 38 + 1 = 8.5 h, but the road is submerged.
  const truck = pick(result, "TR-1", "light_truck");
  assert.deepEqual([truck.vehiclesNeeded, truck.deadheadKm, truck.etaHours, truck.cost, truck.feasible], [1, 133.9, 8.5, 8256, false]);
  assert.ok(truck.advisories.some((text) => text.includes("Manikchak embankment breach")));
  for (const option of result.options) assert.equal(option.feasible, option.floodCapable, `${option.providerId} ${option.vehicleType}`);
  assert.equal(result.zone.effect, "boats_only");
});

test("options are sorted: feasible first, then time, then cost", async () => {
  const result = await fresh().transportOptions({ from: BERHAMPORE, to: SH01, weightKg: 2400 });
  assert.equal(result.options.length, 7, "one option per provider vehicle type");
  assert.deepEqual([result.options[0].providerId, result.options[0].vehicleType], ["TR-2", "relief_boat"]);
  const rest = result.options.slice(1);
  assert.ok(rest.every((option) => !option.feasible));
  for (let i = 1; i < rest.length; i++) assert.ok(rest[i - 1].etaHours <= rest[i].etaHours);

  const make = (id, feasible, etaHours, cost) => ({ id, feasible, etaHours, cost });
  const sorted = Routing.sortOptions([
    make("slow-feasible", true, 9, 100),
    make("fast-infeasible", false, 1, 1),
    make("dear", true, 5, 900),
    make("cheap", true, 5, 300),
    make("faster", true, 4.9, 5000),
  ]).map((option) => option.id);
  assert.deepEqual(sorted, ["faster", "cheap", "dear", "slow-feasible", "fast-infeasible"]);
});

test("meetsDeadline is true at the deadline, false just under it, and null without one", async () => {
  const store = fresh();
  const lane = { from: BERHAMPORE, to: SH04, weightKg: 2400 };
  assert.equal(pick(await store.transportOptions({ ...lane, neededWithinHours: 3.9 }), "TR-4", "light_truck").meetsDeadline, true);
  assert.equal(pick(await store.transportOptions({ ...lane, neededWithinHours: 3.8 }), "TR-4", "light_truck").meetsDeadline, false);
  assert.equal(pick(await store.transportOptions(lane), "TR-4", "light_truck").meetsDeadline, null);
  assert.equal((await store.transportOptions({ ...lane, neededWithinHours: 3.9 })).request.neededWithinHours, 3.9);
});

test("transportOptions refuses a bad lane or load by returning a reason", async () => {
  const store = fresh();
  for (const [args, field] of [
    [{ from: { lat: 95, lng: 88 }, to: SH04, weightKg: 100 }, "from"],
    [{ from: BERHAMPORE, to: { lat: 24, lng: Number.NaN }, weightKg: 100 }, "to"],
    [{ from: BERHAMPORE, to: SH04, weightKg: 0 }, "weightKg"],
    [{ from: BERHAMPORE, to: SH04, weightKg: 100, neededWithinHours: -2 }, "neededWithinHours"],
  ]) {
    const result = await store.transportOptions(args);
    assert.equal(result.ok, false, field);
    assert.equal(result.field, field);
    assert.ok(result.reason);
  }
});

test("estimateRoutes returns the lane fields of the contract", async () => {
  const result = await fresh().estimateRoutes({
    legs: [
      { id: "C>SH-01", from: BERHAMPORE, to: SH01 },
      { id: "B>SH-02", from: SILIGURI, to: SH02 },
      { id: "C>SH-04", from: BERHAMPORE, to: SH04 },
    ],
  });
  assert.deepEqual(result.legs.map((leg) => leg.id), ["C>SH-01", "B>SH-02", "C>SH-04"]);
  // Boats only: haul 150.3 km -> 150.3/38+1 = 5.0, /30+1 = 6.0, /14+1 = 11.7
  assert.deepEqual(result.legs[0], {
    id: "C>SH-01",
    haulKm: 150.3,
    zone: { id: "FZ-1", name: "Manikchak embankment breach", effect: "boats_only" },
    truckFeasible: false,
    boatRequired: true,
    bestCaseHours: { light_truck: 5, heavy_truck: 6, relief_boat: 11.7 },
  });
  // Delay zone: haul 231.8 km, plus loading 1 h and delay 1.5 h -> 8.6, 10.2, 19.1
  assert.deepEqual(result.legs[1].bestCaseHours, { light_truck: 8.6, heavy_truck: 10.2, relief_boat: 19.1 });
  assert.deepEqual([result.legs[1].truckFeasible, result.legs[1].boatRequired, result.legs[1].zone.effect], [true, false, "delay"]);
  assert.deepEqual([result.legs[2].zone, result.legs[2].truckFeasible, result.legs[2].boatRequired, result.legs[2].haulKm], [null, true, false, 115.7]);
  assert.equal(result.routing.source, "demo-dataset");
  assert.equal((await fresh().estimateRoutes({ legs: [] })).ok, false);
  assert.equal((await fresh().estimateRoutes({ legs: [{ id: "", from: BERHAMPORE, to: SH01 }] })).ok, false);
});

// ---- seed and envelope ---------------------------------------------------------------

test("the seed matches the contract and every read is labelled as simulated", async () => {
  const store = fresh();
  const providers = store.providers();
  assert.deepEqual(providers.providers.map((provider) => [provider.id, provider.organizationId, provider.base.city]), [
    ["TR-1", "ORG-TR-1", "Malda Town"], ["TR-2", "ORG-TR-2", "Farakka"], ["TR-3", "ORG-TR-3", "Siliguri"], ["TR-4", "ORG-TR-4", "Berhampore"],
  ]);
  assert.deepEqual(providers.providers[1].fleet[0], { vehicleType: "relief_boat", count: 4, available: 4, capacityKg: 1200, avgSpeedKmh: 14, ratePerKm: 55, floodCapable: true });
  assert.deepEqual(providers.floodZones.map((zone) => [zone.id, zone.radiusKm, zone.effect]), [["FZ-1", 7, "boats_only"], ["FZ-2", 5, "delay"]]);
  assert.deepEqual(Object.keys(providers.routing), ["source", "method", "note"]);
  assert.equal(providers.routing.source, "demo-dataset");
  assert.ok(providers.links.shelterconnect.page);
  for (const result of [
    providers,
    await store.transportOptions({ from: BERHAMPORE, to: SH04, weightKg: 100 }),
    await store.estimateRoutes({ legs: [{ id: "x", from: BERHAMPORE, to: SH04 }] }),
    store.shipmentStatus({ trackingCodes: ["RB-TRK-0001"] }),
  ]) {
    assert.equal(result.simulated, true);
    assert.match(result.dataNotice, /Simulated/);
    assert.equal(result.source, "http://localhost:8084/");
    assert.equal(result.generatedAt, "2026-11-26T10:00:00.000Z");
  }
  const options = await store.transportOptions({ from: BERHAMPORE, to: SH04, weightKg: 100 });
  assert.ok(options.options.every((option) => option.routeSource === "demo-dataset"));
});

// ---- bookings and availability -------------------------------------------------------

test("a booking holds vehicles, and delivery or cancellation frees them", async () => {
  const store = fresh();
  const free = () => store.providers().providers.find((provider) => provider.id === "TR-4").fleet.find((fleet) => fleet.vehicleType === "light_truck").available;
  assert.equal(free(), 4);
  const done = await store.createShipments(booking([line({ vehicles: 2 }), line({ reference: "LANE-2", vehicles: 1 })]));
  assert.equal(done.ok, true);
  assert.equal(free(), 1);
  assert.equal(pick(await store.transportOptions({ from: BERHAMPORE, to: SH04, weightKg: 2400 }), "TR-4", "light_truck").vehiclesAvailable, 1);
  const [first, second] = done.shipments.map((shipment) => shipment.trackingCode);
  store.updateShipmentStatus({ trackingCode: second, status: "cancelled" });
  assert.equal(free(), 2, "a cancelled shipment frees its vehicle");
  for (const status of ["dispatched", "in_transit"]) store.updateShipmentStatus({ trackingCode: first, status });
  assert.equal(free(), 2, "vehicles stay held while in transit");
  store.updateShipmentStatus({ trackingCode: first, status: "delivered" });
  assert.equal(free(), 4, "a delivered shipment frees its vehicles");
  assert.equal(store.summary().deliveredShipments, 1);
});

test("a booking returns the contract's receipt, with hand-computed time and cost", async () => {
  const store = fresh();
  const done = await store.createShipments(booking([line()]));
  assert.equal(done.reference, "RB-BKG-0001");
  assert.equal(done.currency, "INR");
  assert.equal(done.totalCost, 4628);
  assert.deepEqual(done.shipments, [{
    reference: "LANE-1", trackingCode: "RB-TRK-0001", providerId: "TR-4", providerName: "Murshidabad Relief Logistics",
    vehicleType: "light_truck", vehicles: 1, etaHours: 3.9, cost: 4628, status: "planned",
  }]);
  const status = store.shipmentStatus({ trackingCodes: ["RB-TRK-0001", "RB-TRK-9999"] });
  assert.deepEqual(status.shipments[0], {
    trackingCode: "RB-TRK-0001", found: true, status: "planned", providerId: "TR-4", vehicleType: "light_truck",
    updatedAt: "2026-11-26T10:00:00.000Z", history: [{ status: "planned", at: "2026-11-26T10:00:00.000Z" }],
  });
  assert.deepEqual(status.shipments[1], { trackingCode: "RB-TRK-9999", found: false, status: null, providerId: null, vehicleType: null, updatedAt: null, history: [] });
  // Booking more vehicles than the load needs is allowed, and the cost follows the vehicles booked.
  const two = await store.createShipments(booking([line({ reference: "LANE-2", vehicles: 2 })]));
  assert.equal(two.shipments[0].cost, 9256);
});

test("a booking that needs more vehicles than are free is refused and changes nothing", async () => {
  const store = fresh();
  const before = JSON.stringify(store.state);
  // TR-2 has 4 relief boats. Two lines of 3 boats each need 6.
  const toManikchak = { providerId: "TR-2", vehicleType: "relief_boat", vehicles: 3, to: { ...SH01 }, weightKg: 3000 };
  const refused = await store.createShipments(booking([line(toManikchak), line({ ...toManikchak, reference: "LANE-2" })]));
  assert.equal(refused.ok, false);
  assert.equal(refused.field, "shipments[1]");
  assert.match(refused.reason, /needs 6 relief_boat.*4 are free/);
  assert.equal(JSON.stringify(store.state), before);
  // Too few vehicles for the weight is refused too: 3,000 kg needs 3 boats of 1,200 kg.
  const light = await store.createShipments(booking([line({ ...toManikchak, vehicles: 2 })]));
  assert.equal(light.ok, false);
  assert.match(light.reason, /needs 3 relief_boat/);
  assert.equal(JSON.stringify(store.state), before);
  assert.equal((await store.createShipments(booking([line(toManikchak)]))).ok, true);
});

test("a truck booking into the boats-only zone is refused; a boat booking is accepted", async () => {
  const store = fresh();
  const before = JSON.stringify(store.state);
  const refused = await store.createShipments(booking([line({ providerId: "TR-1", vehicleType: "light_truck", to: { ...SH01 } })]));
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /Manikchak embankment breach/);
  assert.match(refused.reason, /flood-capable/);
  assert.equal(JSON.stringify(store.state), before);
  const boats = await store.createShipments(booking([line({ providerId: "TR-2", vehicleType: "relief_boat", vehicles: 2, to: { ...SH01 } })]));
  assert.equal(boats.ok, true);
  assert.deepEqual([boats.shipments[0].etaHours, boats.shipments[0].cost], [19.5, 22479]);
});

test("each bad booking field is refused with its reason, and nothing is stored", async () => {
  const store = fresh();
  const before = JSON.stringify(store.state);
  for (const [args, pattern] of [
    [booking([line()], ""), /incident reference/],
    [booking([]), /at least one shipment/],
    [booking([line({ reference: "" })]), /needs a reference/],
    [booking([line(), line()]), /listed twice/],
    [booking([line({ providerId: "TR-99" })]), /No provider/],
    [booking([line({ providerId: "TR-3", vehicleType: "relief_boat" })]), /has no relief_boat/],
    [booking([line({ from: { lat: 200, lng: 0 } })]), /origin needs/],
    [booking([line({ weightKg: 0 })]), /Weight must be/],
    [booking([line({ vehicles: 0 })]), /vehicles must be/],
    [booking([line({ cargo: [] })]), /1 to 8 cargo lines/],
    [booking([line({ cargo: [{ resource: "gold_bars", quantity: 1 }] })]), /unknown resource/],
    [booking([line({ cargo: [{ resource: "blankets", quantity: 0 }] })]), /cargo quantity/],
  ]) {
    const result = await store.createShipments(args);
    assert.equal(result.ok, false, String(pattern));
    assert.match(result.reason, pattern);
  }
  assert.equal(JSON.stringify(store.state), before);
});

test("tracking codes and booking references increment, and a shipment is never booked twice", async () => {
  const store = fresh();
  const first = await store.createShipments(booking([line(), line({ reference: "LANE-2" })]));
  const second = await store.createShipments(booking([line({ reference: "LANE-3" })]));
  assert.deepEqual([first.reference, second.reference], ["RB-BKG-0001", "RB-BKG-0002"]);
  assert.deepEqual([...first.shipments, ...second.shipments].map((shipment) => shipment.trackingCode), ["RB-TRK-0001", "RB-TRK-0002", "RB-TRK-0003"]);
  const again = await store.createShipments(booking([line({ reference: "LANE-3" })]));
  assert.equal(again.ok, false);
  assert.match(again.reason, /already booked as RB-TRK-0003/);
  assert.equal(store.state.shipments.length, 3);
  // The same reference under another incident is a different shipment.
  assert.equal((await store.createShipments(booking([line({ reference: "LANE-3" })], "INC-0002"))).ok, true);
});

// ---- the status state machine --------------------------------------------------------

test("every allowed status transition works and every other pair is refused", async () => {
  const PATHS = {
    planned: [],
    dispatched: ["dispatched"],
    in_transit: ["dispatched", "in_transit"],
    delayed: ["dispatched", "in_transit", "delayed"],
    delivered: ["dispatched", "in_transit", "delivered"],
    cancelled: ["cancelled"],
    failed: ["dispatched", "in_transit", "failed"],
  };
  const ALLOWED = {
    planned: ["dispatched", "cancelled"],
    dispatched: ["in_transit", "cancelled"],
    in_transit: ["delivered", "delayed", "failed"],
    delayed: ["in_transit", "delivered", "failed"],
    delivered: [],
    cancelled: [],
    failed: [],
  };
  let allowedCount = 0;
  for (const from of Object.keys(PATHS)) {
    for (const to of Object.keys(PATHS)) {
      const store = fresh();
      const code = (await store.createShipments(booking([line()]))).shipments[0].trackingCode;
      for (const step of PATHS[from]) assert.equal(store.updateShipmentStatus({ trackingCode: code, status: step }).ok, true, `${from}: walk ${step}`);
      const before = JSON.stringify(store.state);
      const result = store.updateShipmentStatus({ trackingCode: code, status: to });
      const expected = ALLOWED[from].includes(to);
      assert.equal(result.ok, expected, `${from} -> ${to}`);
      if (expected) {
        allowedCount += 1;
        assert.equal(store.findShipment(code).status, to);
        assert.equal(store.findShipment(code).history.at(-1).status, to);
        assert.deepEqual(result.nextStatuses, ALLOWED[to]);
      } else {
        assert.ok(result.reason.includes(from), `${from} -> ${to}: ${result.reason}`);
        assert.equal(JSON.stringify(store.state), before, `${from} -> ${to} changed state`);
      }
    }
  }
  assert.equal(allowedCount, 10);
  const store = fresh();
  assert.equal(store.updateShipmentStatus({ trackingCode: "RB-TRK-0404", status: "dispatched" }).ok, false);
  const code = (await store.createShipments(booking([line()]))).shipments[0].trackingCode;
  assert.equal(store.updateShipmentStatus({ trackingCode: code, status: "teleported" }).ok, false);
});

// ---- providers and fleets ------------------------------------------------------------

test("registerProvider validates every field and assigns the next id", () => {
  const store = fresh();
  const good = { name: "Test Haulage", city: "Chanchal", lat: 25.39, lng: 88.0, vehicleType: "relief_boat", count: 3, capacityKg: 900, avgSpeedKmh: 12, ratePerKm: 50 };
  for (const [field, value] of [["name", "x"], ["city", ""], ["lat", 123], ["lng", -999], ["vehicleType", "hovercraft"], ["count", 0], ["capacityKg", 50], ["avgSpeedKmh", 0], ["ratePerKm", 0]]) {
    const result = store.registerProvider({ ...good, [field]: value });
    assert.equal(result.ok, false, field);
    assert.equal(result.field, field);
  }
  assert.equal(store.registerProvider({ ...good, name: "malda fleet cooperative" }).ok, false, "duplicate name");
  assert.equal(store.providers().providers.length, 4);
  const done = store.registerProvider(good);
  assert.deepEqual([done.ok, done.providerId], [true, "TR-5"]);
  const added = store.providers().providers.at(-1);
  assert.deepEqual([added.organizationId, added.fleet[0].floodCapable, added.fleet[0].available], ["ORG-TR-5", true, 3]);
});

test("updateFleetAvailability sets the count and refuses one below the vehicles in use", async () => {
  const store = fresh();
  await store.createShipments(booking([line({ vehicles: 2 })]));
  for (const [args, field] of [
    [{ providerId: "TR-99", vehicleType: "light_truck", count: 3 }, "providerId"],
    [{ providerId: "TR-3", vehicleType: "relief_boat", count: 3 }, "vehicleType"],
    [{ providerId: "TR-4", vehicleType: "light_truck", count: -1 }, "count"],
    [{ providerId: "TR-4", vehicleType: "light_truck", count: 1.5 }, "count"],
    [{ providerId: "TR-4", vehicleType: "light_truck", count: 1 }, "count"],
  ]) {
    const result = store.updateFleetAvailability(args);
    assert.equal(result.ok, false, JSON.stringify(args));
    assert.equal(result.field, field);
  }
  const done = store.updateFleetAvailability({ providerId: "TR-4", vehicleType: "light_truck", count: 8 });
  assert.deepEqual([done.ok, done.count, done.available], [true, 8, 6]);
  assert.equal(store.updateFleetAvailability({ providerId: "TR-4", vehicleType: "light_truck", count: 2 }).available, 0);
});

test("state survives a reload through storage, and reset restores the seed", async () => {
  const memory = new Map();
  const storage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: (key) => memory.delete(key) };
  const first = new RouteStore(storage, NOW);
  await first.createShipments(booking([line()]));
  first.setRoutingSource({ baseUrl: "https://router.example/" });
  assert.ok(memory.has("routebridge-state-v1"));
  const second = new RouteStore(storage, NOW);
  assert.equal(second.findShipment("RB-TRK-0001").status, "planned");
  assert.equal(second.routingInfo().source, "osrm");
  second.reset();
  const third = new RouteStore(storage, NOW);
  assert.equal(third.state.shipments.length, 0);
  assert.equal(third.routingInfo().source, "demo-dataset");
});

// ---- the live-routing adapter --------------------------------------------------------

test("live routing is off by default and the routing source is validated", () => {
  const store = fresh();
  assert.ok(store.router instanceof DemoDatasetRouter);
  assert.equal(store.state.routing.osrmBaseUrl, "");
  for (const baseUrl of ["not a url", "ftp://router.example", "https://user:pw@router.example", "https://router.example/?key=1"]) {
    const result = store.setRoutingSource({ baseUrl });
    assert.equal(result.ok, false, baseUrl);
    assert.equal(result.field, "baseUrl");
  }
  assert.ok(store.router instanceof DemoDatasetRouter);
  assert.equal(store.setRoutingSource({ baseUrl: " https://router.example/osrm/ " }).routing.source, "osrm");
  assert.equal(store.state.routing.osrmBaseUrl, "https://router.example/osrm");
  assert.equal(store.setRoutingSource({ baseUrl: "" }).routing.source, "demo-dataset");
});

test("the OSRM adapter labels live distances osrm and asks for lng,lat pairs", async () => {
  const asked = [];
  const fetchOk = async (url) => {
    asked.push(url);
    return { ok: true, status: 200, json: async () => ({ code: "Ok", routes: [{ distance: 123456, duration: 9999 }] }) };
  };
  const leg = await new OsrmRouter("https://router.example/", fetchOk).distance(BERHAMPORE, SH04);
  assert.deepEqual(leg, { km: 123.5, source: "osrm", advisory: null });
  assert.equal(asked[0], "https://router.example/route/v1/driving/88.251,24.104;88.0158,24.8623?overview=false");

  const store = fresh(null, fetchOk);
  store.setRoutingSource({ baseUrl: "https://router.example" });
  const result = await store.transportOptions({ from: BERHAMPORE, to: SH04, weightKg: 2400 });
  assert.equal(result.routing.source, "osrm");
  assert.equal(result.haulKm, 123.5);
  assert.ok(result.options.every((option) => option.routeSource === "osrm" && option.haulKm === 123.5 && option.deadheadKm === 123.5));
  // 123.5 km from the service for both legs: (123.5 + 123.5) / 40 + 1 = 7.175 -> 7.2 h
  assert.equal(pick(result, "TR-4", "light_truck").etaHours, 7.2);
  const estimate = await store.estimateRoutes({ legs: [{ id: "x", from: BERHAMPORE, to: SH04 }] });
  assert.deepEqual([estimate.routing.source, estimate.legs[0].haulKm], ["osrm", 123.5]);
  const booked = await store.createShipments(booking([line()]));
  assert.equal(store.findShipment(booked.shipments[0].trackingCode).routeSource, "osrm");
});

test("when the routing service fails, the demo distance is used and labelled as such", async () => {
  const failures = [
    async () => { throw new Error("network down"); },
    async () => ({ ok: false, status: 500, json: async () => ({}) }),
    async () => ({ ok: true, status: 200, json: async () => ({ code: "NoRoute", routes: [] }) }),
  ];
  for (const fetchFail of failures) {
    const leg = await new OsrmRouter("https://router.example", fetchFail).distance(BERHAMPORE, SH04);
    assert.deepEqual(leg, { km: 115.7, source: "demo-dataset", advisory: OsrmRouter.FALLBACK_ADVISORY });
    const store = fresh(null, fetchFail);
    store.setRoutingSource({ baseUrl: "https://router.example" });
    const result = await store.transportOptions({ from: BERHAMPORE, to: SH04, weightKg: 2400 });
    assert.equal(result.routing.source, "demo-dataset");
    assert.match(result.routing.note, /fell back/);
    const option = pick(result, "TR-4", "light_truck");
    assert.deepEqual([option.routeSource, option.haulKm, option.etaHours, option.cost], ["demo-dataset", 115.7, 3.9, 4628]);
    assert.ok(option.advisories.includes(OsrmRouter.FALLBACK_ADVISORY));
  }
  // An injected router is used as given.
  const fixed = { source: "demo-dataset", distance: async () => ({ km: 10, source: "demo-dataset", advisory: null }), describe: () => new DemoDatasetRouter().describe() };
  assert.equal((await fresh(fixed).transportOptions({ from: BERHAMPORE, to: SH04, weightKg: 2400 })).haulKm, 10);
});

// ---- actions, manifest and bridge ----------------------------------------------------

test("every manifest agentTools name is registered, on the page or on the bridge", () => {
  const local = registryOf(registerSite);
  const bridge = registryOf(registerBridge);
  const localNames = [...local.entries.values()].map((entry) => entry.name);
  const bridgeNames = [...bridge.entries.values()].map((entry) => entry.name);
  for (const name of manifest.actions.agentTools) {
    assert.ok(localNames.includes(name) || bridgeNames.includes(name), `${name} is not registered anywhere`);
  }
  for (const entry of local.entries.values()) assert.equal(entry.availability, "local-only", entry.name);
  for (const name of [...localNames, ...bridgeNames]) assert.ok(manifest.actions.agentTools.includes(name), `${name} is missing from agentTools`);
  assert.deepEqual(localNames, ["get_transport_providers", "get_transport_options", "estimate_routes", "get_shipment_status", "register_provider", "update_fleet_availability", "update_shipment_status"]);
  assert.deepEqual(bridgeNames, ["get_transport_providers", "get_transport_options", "estimate_routes", "get_shipment_status", "create_shipments"]);
  const effects = Object.fromEntries([...local.entries.values()].map((entry) => [entry.name, entry.effect]));
  assert.deepEqual([effects.register_provider, effects.update_fleet_availability, effects.update_shipment_status], ["irreversible", "write", "write"]);
});

test("the manifest names the partner this network calls, and only that origin", () => {
  assert.deepEqual(manifest.allowed_peers, ["http://localhost:8081"]);
  assert.equal(manifest.peer_policy.mode, "closed");
  assert.equal(manifest.networks[0].front_man, "RoutePlanningAgent");
  assert.equal(SiteLinks.PARTNERS.shelterconnect.network, "http://localhost:8081/shelterconnect");
  assert.deepEqual(manifest.reliefmesh.capabilities, ["transport_providers", "vehicle_availability", "route_estimation", "transport_options", "shipment_booking", "shipment_tracking"]);
});

test("bridge actions are shared only with exact partner origins, and writes never with *", () => {
  const bridge = registryOf(registerBridge);
  assert.deepEqual(SiteLinks.CALLERS, ["http://localhost:8080"]);
  for (const entry of bridge.entries.values()) {
    assert.equal(entry.availability, "bridge", entry.name);
    assert.deepEqual(entry.callerOrigins, SiteLinks.CALLERS, entry.name);
    assert.ok(!entry.callerOrigins.includes("*"), entry.name);
    if (entry.effect !== "read") assert.equal(entry.confirmsInWindow, true, `${entry.name} must confirm in this site's window`);
  }
  const write = [...bridge.entries.values()].find((entry) => entry.name === "create_shipments");
  assert.equal(write.effect, "irreversible");
  assert.deepEqual(ShipmentWindow.CALLERS, SiteLinks.CALLERS);
});

test("a shared read has the same name, input and description as the page's own action", () => {
  const local = registryOf(registerSite);
  const bridge = registryOf(registerBridge);
  let reads = 0;
  for (const shared of bridge.entries.values()) {
    if (shared.effect !== "read") continue;
    reads += 1;
    const own = [...local.entries.values()].find((entry) => entry.name === shared.name);
    assert.ok(own, `${shared.name} has no page action of the same name`);
    assert.equal(own.effect, "read");
    assert.deepEqual(shared.inputSchema, own.inputSchema);
    assert.equal(shared.description, own.description);
    assert.deepEqual(shared.inputSchema, JSON.parse(JSON.stringify(RouteSchemas.READS[shared.name].inputSchema)));
  }
  assert.equal(reads, 4);
});

test("shared reads run through the runtime's registry and return succeeded receipts", async () => {
  const bridge = registryOf(registerBridge);
  const entryOf = (name) => [...bridge.entries.values()].find((item) => item.name === name);
  const run = async (name, args) => (await bridge.execute(bridge.prepare({ kind: "action", action: entryOf(name).ref, arguments: args }), async () => true, "test-invocation"))[0];

  const options = await run("get_transport_options", { from: { lat: 24.104, lng: 88.251, label: "SUP-C" }, to: { lat: 25.0773, lng: 87.9003 }, weightKg: 2400, neededWithinHours: 24 });
  assert.equal(options.status, "succeeded");
  assert.equal(options.result.simulated, true);
  assert.equal(options.result.options[0].providerId, "TR-2");
  assert.equal(options.result.options[0].meetsDeadline, true);

  const providers = await run("get_transport_providers", {});
  assert.equal(providers.status, "succeeded");
  assert.equal(providers.result.providers.length, 4);

  const estimate = await run("estimate_routes", { legs: [{ id: "a", from: { lat: 24.104, lng: 88.251 }, to: { lat: 25.2046, lng: 87.9281 } }] });
  assert.equal(estimate.result.legs[0].zone.id, "FZ-2");

  const status = await run("get_shipment_status", { trackingCodes: ["RB-TRK-0001"] });
  assert.equal(status.result.shipments[0].found, false);

  // The runtime refuses arguments outside the schema before the site's code runs.
  const ref = entryOf("get_transport_options").ref;
  assert.throws(() => bridge.prepare({ kind: "action", action: ref, arguments: { from: { lat: 24, lng: 88 }, to: { lat: 25, lng: 87 } } }), /Missing/);
  assert.throws(() => bridge.prepare({ kind: "action", action: ref, arguments: { from: { lat: 240, lng: 88 }, to: { lat: 25, lng: 87 }, weightKg: 5 } }), /Invalid/);
  assert.throws(() => bridge.prepare({ kind: "action", action: ref, arguments: { from: { lat: 24, lng: 88, zoom: 3 }, to: { lat: 25, lng: 87 }, weightKg: 5 } }), /Unexpected/);
  const writeRef = entryOf("create_shipments").ref;
  assert.throws(() => bridge.prepare({ kind: "action", action: writeRef, arguments: booking([line({ vehicleType: "hovercraft" })]) }), /Invalid/);
  assert.ok(bridge.prepare({ kind: "action", action: writeRef, arguments: booking([line()]) }));
});

test("the booking window refuses before any form, and lists what the person must see", async () => {
  // A request the site would refuse returns the reason without touching the document.
  const refused = await ShipmentWindow.start(booking([line({ providerId: "TR-1", vehicleType: "heavy_truck", to: { ...SH01 } })]), { callerOrigin: "http://localhost:8080" });
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /Manikchak embankment breach/);

  const check = await fresh().checkShipments(booking([line({ providerId: "TR-2", vehicleType: "relief_boat", vehicles: 2, to: { ...SH01 } })]));
  assert.equal(check.ok, true);
  assert.equal(check.totalCost, 22479);
  const facts = Object.fromEntries(ShipmentWindow.shipmentFacts(check.lines[0]));
  assert.equal(facts.Provider, "Farakka Barge & Boat Union (TR-2)");
  assert.match(facts.Vehicles, /^2 × Relief boat/);
  assert.equal(facts.From, "SUP-C depot");
  assert.equal(facts.To, "SH-01 Manikchak");
  assert.match(facts.Weight, /2,400 kg/);
  assert.match(facts.Cargo, /500 food packets, 300 water kits/);
  assert.match(facts["Estimated time"], /19\.5 hours/);
  assert.match(facts["Estimated cost"], /22,479/);
  assert.match(facts["Flood zone"], /boats only/);
  assert.match(facts.Distance, /demo-dataset/);
  assert.equal(ShipmentWindow.hostOf("http://localhost:8080"), "localhost:8080");
  assert.equal(ShipmentWindow.hostOf(undefined), "another site");
  assert.notEqual(ShipmentWindow.CONFIRM_LABEL.toLowerCase(), "confirm");
});

test("the page's confirmation dialog shows the provider's details, or the site's refusal", () => {
  const store = fresh();
  App.page = { checkProvider: (args) => store.checkProvider(args) };
  try {
    const args = { name: " Test Haulage ", city: "Chanchal", lat: 25.39, lng: 88.0, vehicleType: "relief_boat", count: 3, capacityKg: 900, avgSpeedKmh: 12, ratePerKm: 50 };
    const content = AssistantMount.dialogContent({ action: "register_provider", origin: "http://localhost:8084", effect: "irreversible", arguments: args });
    assert.ok(content.title.endsWith("?"));
    assert.equal(content.confirm, "Register the provider");
    assert.equal(content.details.Provider, "Test Haulage");
    assert.equal(content.details.Fleet, "3 × Relief boat, 900 kg each");
    assert.equal(content.refusal, undefined);
    const refused = AssistantMount.dialogContent({ action: "register_provider", origin: "http://localhost:8084", effect: "irreversible", arguments: { ...args, count: 0 } });
    assert.match(refused.refusal, /Vehicle count/);
  } finally {
    App.page = null;
  }
});

test("the vehicle and resource catalogues are complete", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(RouteData.VEHICLES).map(([type, vehicle]) => [type, vehicle.nominalSpeedKmh])), { light_truck: 38, heavy_truck: 30, relief_boat: 14 });
  assert.deepEqual(Object.fromEntries(Object.entries(RouteData.RESOURCES).map(([id, resource]) => [id, resource.unitWeightKg])), { food_packets: 1.2, water_kits: 6, medical_kits: 2.5, blankets: 1.5 });
  assert.equal(RouteData.PLACES.length, 8);
  assert.equal(RouteData.LOADING_HOURS, 1);
});
