// ShelterConnect tests: the store's rules, and that the actions match the manifest.
// Run: node --test "sites/shelterconnect/tests/*.test.mjs"
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { ActionRegistry } from "../runtime/actions.js";
import { ShelterStore } from "../js/shelter-store.js";
import { ShelterData } from "../js/shelter-data.js";
import { SiteLinks } from "../js/site-links.js";
import { registerActions as registerBridge } from "../bridge/bridge-actions.js";
import { registerActions as registerSite } from "../site-actions.js";

const NOW = () => new Date("2026-11-26T10:00:00.000Z");
const fresh = () => new ShelterStore(null, NOW);
const manifest = JSON.parse(await readFile(new URL("../agent-manifest.json", import.meta.url), "utf8"));
const SCOPE = { base: "http://localhost:8081", network: "shelterconnect" };

function registryOf(register) {
  const registry = new ActionRegistry();
  register({ register: (definition) => registry.register(SCOPE, definition) });
  return registry;
}

test("seed matches the demonstration scenario totals", () => {
  const totals = fresh().resourceRequests({ status: "all" }).totals;
  assert.deepEqual(
    Object.fromEntries(Object.entries(totals).map(([resource, total]) => [resource, total.required])),
    { food_packets: 2000, water_kits: 1000, medical_kits: 300, blankets: 500 },
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(totals).map(([resource, total]) => [resource, total.shortage])),
    { food_packets: 1650, water_kits: 820, medical_kits: 243, blankets: 385 },
  );
  assert.equal(fresh().overview().shelters.length, 4);
});

test("every read is labelled as simulated data", () => {
  const store = fresh();
  for (const result of [store.overview(), store.resourceRequests(), store.inventory()]) {
    assert.equal(result.simulated, true);
    assert.match(result.dataNotice, /Simulated/);
  }
});

test("updateInventory refuses bad input without changing anything, then accepts good input", () => {
  const store = fresh();
  const before = JSON.stringify(store.state);
  for (const args of [
    { shelterId: "SH-99", resource: "water_kits", quantity: 5 },
    { shelterId: "SH-01", resource: "gold_bars", quantity: 5 },
    { shelterId: "SH-01", resource: "water_kits", quantity: -1 },
    { shelterId: "SH-01", resource: "water_kits", quantity: 2.5 },
    { shelterId: "SH-01", resource: "water_kits", quantity: Number.NaN },
  ]) {
    const result = store.updateInventory(args);
    assert.equal(result.ok, false, JSON.stringify(args));
    assert.ok(result.reason);
  }
  assert.equal(JSON.stringify(store.state), before);
  const done = store.updateInventory({ shelterId: "SH-01", resource: "water_kits", quantity: 200 });
  assert.equal(done.ok, true);
  const row = store.resourceRequests({ shelterId: "SH-01" }).requests.find((entry) => entry.resource === "water_kits");
  assert.equal(row.quantityInStock, 200);
  assert.equal(row.shortage, 150);
});

test("a requirement fully covered by stock is reported as covered, never negative", () => {
  const store = fresh();
  store.updateInventory({ shelterId: "SH-04", resource: "blankets", quantity: 500 });
  const row = store.resourceRequests({ shelterId: "SH-04" }).requests.find((entry) => entry.resource === "blankets");
  assert.equal(row.shortage, 0);
  assert.equal(row.status, "covered");
});

test("publishRequest sets the total requirement and refuses a past deadline", () => {
  const store = fresh();
  const past = store.publishRequest({ shelterId: "SH-03", resource: "food_packets", quantityRequired: 600, neededBy: "2020-01-01T00:00" });
  assert.equal(past.ok, false);
  assert.equal(past.field, "neededBy");
  const done = store.publishRequest({ shelterId: "SH-03", resource: "food_packets", quantityRequired: 600 });
  assert.equal(done.ok, true);
  assert.equal(done.request.quantityRequired, 600);
  assert.equal(done.request.shortage, 540);
});

test("registerShelter validates every field and assigns the next id", () => {
  const store = fresh();
  const good = { name: "Test Camp", block: "Chanchal", lat: 25.39, lng: 88.0, capacity: 300, occupancy: 120, urgency: "medium" };
  for (const [field, value] of [["name", "x"], ["block", ""], ["lat", 123], ["lng", -999], ["capacity", 0], ["occupancy", 301], ["urgency", "panic"]]) {
    const result = store.registerShelter({ ...good, [field]: value });
    assert.equal(result.ok, false, field);
    assert.equal(result.field, field);
  }
  assert.equal(store.registerShelter({ ...good, name: "Ratua Community Hall Shelter" }).ok, false, "duplicate name");
  const done = store.registerShelter(good);
  assert.deepEqual([done.ok, done.shelterId], [true, "SH-05"]);
  assert.equal(store.overview().shelters.length, 5);
});

test("recordDeliveries adds to stock once and refuses a repeated shipment line", () => {
  const store = fresh();
  const deliveries = [
    { shelterId: "SH-01", resource: "food_packets", quantity: 300, shipmentRef: "RB-TRK-0001" },
    { shelterId: "SH-01", resource: "water_kits", quantity: 100, shipmentRef: "RB-TRK-0001" },
  ];
  const done = store.recordDeliveries({ deliveries });
  assert.equal(done.ok, true);
  assert.equal(done.reference, "SC-DLV-0001");
  assert.equal(store.findShelter("SH-01").inventory.food_packets, 420);
  assert.equal(store.findShelter("SH-01").inventory.water_kits, 160);
  const again = store.recordDeliveries({ deliveries });
  assert.equal(again.ok, false);
  assert.match(again.reason, /already recorded/);
  assert.equal(store.findShelter("SH-01").inventory.food_packets, 420, "stock unchanged by the refused repeat");
  for (const bad of [
    { deliveries: [] },
    { deliveries: [{ shelterId: "SH-77", resource: "food_packets", quantity: 1, shipmentRef: "X" }] },
    { deliveries: [{ shelterId: "SH-01", resource: "food_packets", quantity: 0, shipmentRef: "X" }] },
    { deliveries: [{ shelterId: "SH-01", resource: "food_packets", quantity: 1, shipmentRef: "" }] },
  ]) assert.equal(store.recordDeliveries(bad).ok, false);
});

test("state survives a reload through storage, and reset restores the seed", () => {
  const memory = new Map();
  const storage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: (key) => memory.delete(key) };
  const first = new ShelterStore(storage, NOW);
  first.setUrgency({ shelterId: "SH-04", urgency: "critical" });
  const second = new ShelterStore(storage, NOW);
  assert.equal(second.findShelter("SH-04").urgency, "critical");
  second.reset();
  assert.equal(new ShelterStore(storage, NOW).findShelter("SH-04").urgency, "medium");
});

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
});

test("bridge actions are shared only with exact partner origins, and writes never with *", () => {
  const bridge = registryOf(registerBridge);
  for (const entry of bridge.entries.values()) {
    assert.equal(entry.availability, "bridge", entry.name);
    assert.deepEqual(entry.callerOrigins, SiteLinks.CALLERS, entry.name);
    assert.ok(!entry.callerOrigins.includes("*"), entry.name);
    if (entry.effect !== "read") assert.equal(entry.confirmsInWindow, true, `${entry.name} must confirm in this site's window`);
  }
});

test("a shared read has the same name and input as the page's own action", () => {
  const local = registryOf(registerSite);
  const bridge = registryOf(registerBridge);
  for (const shared of bridge.entries.values()) {
    if (shared.effect !== "read") continue;
    const own = [...local.entries.values()].find((entry) => entry.name === shared.name);
    assert.ok(own, `${shared.name} has no page action of the same name`);
    assert.deepEqual(JSON.parse(JSON.stringify(shared.inputSchema).replaceAll("get_shelter_overview", "X")), JSON.parse(JSON.stringify(own.inputSchema).replaceAll("website_get_shelter_overview", "X")));
  }
});

test("a shared read runs through the runtime's registry and returns a succeeded receipt", async () => {
  const bridge = registryOf(registerBridge);
  const entry = [...bridge.entries.values()].find((item) => item.name === "get_resource_requests");
  const plan = bridge.prepare({ kind: "action", action: entry.ref, arguments: { status: "open" } });
  const receipts = await bridge.execute(plan, async () => true, "test-invocation");
  assert.equal(receipts[0].status, "succeeded");
  assert.equal(receipts[0].result.simulated, true);
  assert.equal(receipts[0].result.requests.length, 16);
  // The runtime refuses arguments outside the schema before the site's code runs.
  assert.throws(() => bridge.prepare({ kind: "action", action: entry.ref, arguments: { status: "everything" } }), /Invalid/);
  assert.throws(() => bridge.prepare({ kind: "action", action: entry.ref, arguments: { extra: 1 } }), /Unexpected/);
});

test("the resource catalogue is complete", () => {
  for (const resource of ShelterData.resourceIds()) {
    assert.ok(ShelterData.RESOURCES[resource].unitWeightKg > 0);
    assert.ok(ShelterData.RESOURCES[resource].label);
  }
});
