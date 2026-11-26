// Browser check of RouteBridge's bridge and booking window, as a calling site sees them.
//
//   1. serve the site:  node vendor/agentify-website/scripts/serve_site.mjs sites/routebridge --port 8084 --open-as localhost
//   2. run this file:   node sites/routebridge/tests/bridge-browser-check.mjs
//
// It opens the system's Chrome on a stand-in page at http://localhost:8080 (the origin
// RouteBridge shares its actions with; the page is answered from memory, so nothing has
// to listen on that port). The page loads RouteBridge's bridge with the official
// runtime's own action transport, runs a shared read in the hidden frame, books a
// shipment through the confirmation window, declines a second booking, and then checks
// that a page on an origin RouteBridge does not list gets no actions at all.
//
// It is not a *.test.mjs file, because it needs a browser and a running server.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const SITE = process.env.ROUTEBRIDGE_ORIGIN || "http://localhost:8084";
const CALLER = "http://localhost:8080";
const STRANGER = "http://localhost:8099";
const RUNTIME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "runtime");

const LANE = {
  reference: "CHECK-1",
  providerId: "TR-2",
  vehicleType: "relief_boat",
  vehicles: 2,
  from: { lat: 24.104, lng: 88.251, label: "SUP-C depot, Berhampore" },
  to: { lat: 25.0773, lng: 87.9003, label: "SH-01 Manikchak" },
  weightKg: 2400,
  cargo: [{ resource: "food_packets", quantity: 500 }, { resource: "water_kits", quantity: 300 }],
};

// The stand-in pages are answered from memory, so Chrome does not see them as loopback
// pages and would block their requests to the loopback server. A real calling site on
// localhost needs no such flag.
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-features=LocalNetworkAccessChecks"] });
const context = await browser.newContext();
const problems = [];

// Stand-in calling sites: an empty page plus the official runtime, answered from disk.
await context.route((url) => [CALLER, STRANGER].includes(url.origin), async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === "/") {
    await route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Calling site</title><body></body>" });
  } else if (url.pathname.startsWith("/runtime/") && !url.pathname.includes("..")) {
    try {
      await route.fulfill({ contentType: "text/javascript", body: await readFile(path.join(RUNTIME, url.pathname.slice("/runtime/".length))) });
    } catch {
      await route.fulfill({ status: 404, body: "" });
    }
  } else {
    await route.fulfill({ status: 404, body: "" });
  }
});

/** Load RouteBridge's bridge in a page, the way a calling site's runtime does. */
async function connect(page) {
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return page.evaluate(async (site) => {
    const { ActionRegistry } = await import("/runtime/actions.js");
    const { registerRemoteActions } = await import("/runtime/action-transport.js");
    const manifest = await (await fetch(`${site}/agent-manifest.json`)).json();
    const registry = new ActionRegistry();
    const scope = { base: site, network: manifest.networks[0].name };
    await registerRemoteActions(registry, scope, manifest);
    window.bridge = {
      registry,
      scope,
      run(name, args, id) {
        const entry = registry.catalog(scope).find((action) => action.name === name);
        const plan = registry.prepare({ kind: "action", action: entry.ref, arguments: args });
        return registry.execute(plan, async () => true, id).then((receipts) => receipts[0]);
      },
    };
    return registry.catalog(scope).map((action) => `${action.name}:${action.effect}`);
  }, SITE);
}

/** Start a shared write, open RouteBridge's window from the runtime's prompt, and answer it. */
async function book(page, args, id, buttonName) {
  await page.evaluate(({ args, id }) => { window.pending = window.bridge.run("create_shipments", args, id); }, { args, id });
  const [popup] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("button", { name: "Open action site" }).click(),
  ]);
  await popup.getByRole("heading", { name: "Confirm this shipment booking" }).waitFor();
  const text = await popup.locator("main").innerText();
  await popup.getByRole("button", { name: buttonName }).click();
  const receipt = await page.evaluate(() => window.pending);
  return { receipt, text, url: popup.url() };
}

try {
  // ---- a listed caller ------------------------------------------------------------
  const caller = await context.newPage();
  await caller.goto(`${CALLER}/`);
  const catalog = await connect(caller);
  assert.deepEqual(catalog, [
    "get_transport_providers:read", "get_transport_options:read", "estimate_routes:read", "get_shipment_status:read", "create_shipments:irreversible",
  ]);
  console.log(`OK: ${CALLER} is offered ${catalog.length} shared actions.`);

  const options = await caller.evaluate((lane) => window.bridge.run("get_transport_options", { from: lane.from, to: lane.to, weightKg: lane.weightKg, neededWithinHours: 24 }, "read-1"), LANE);
  assert.equal(options.status, "succeeded");
  assert.equal(options.result.simulated, true);
  assert.equal(options.result.source, `${SITE}/`);
  assert.deepEqual([options.result.options[0].providerId, options.result.options[0].vehicleType, options.result.options[0].etaHours, options.result.options[0].cost], ["TR-2", "relief_boat", 19.5, 22479]);
  assert.equal(options.result.routing.source, "demo-dataset");
  console.log("OK: a shared read ran in the hidden frame on RouteBridge's origin.");

  const booked = await book(caller, { incidentRef: "INC-CHECK", shipments: [LANE] }, "write-1", "Book these shipments");
  assert.ok(booked.url.startsWith(`${SITE}/bridge/action-bridge.html`), booked.url);
  for (const expected of ["localhost:8080", "INC-CHECK", "CHECK-1", "Farakka Barge & Boat Union", "Relief boat", "SUP-C depot, Berhampore", "SH-01 Manikchak", "2,400 kg", "500 food packets", "19.5 hours", "22,479", "Simulated", "no vehicle is really dispatched"]) {
    assert.ok(booked.text.includes(expected), `the window does not show "${expected}"`);
  }
  assert.equal(booked.receipt.status, "succeeded");
  assert.deepEqual(Object.keys(booked.receipt.result).sort(), ["currency", "note", "ok", "reference", "shipments", "simulated", "summary", "totalCost"]);
  assert.equal(booked.receipt.result.ok, true);
  assert.match(booked.receipt.result.reference, /^RB-BKG-\d{4}$/);
  assert.equal(booked.receipt.result.totalCost, 22479);
  const tracking = booked.receipt.result.shipments[0].trackingCode;
  assert.match(tracking, /^RB-TRK-\d{4}$/);
  console.log(`OK: a person confirmed the booking in RouteBridge's own window (${booked.receipt.result.reference}, ${tracking}).`);

  const status = await caller.evaluate((code) => window.bridge.run("get_shipment_status", { trackingCodes: [code] }, "read-2"), tracking);
  assert.deepEqual([status.result.shipments[0].found, status.result.shipments[0].status], [true, "planned"]);
  const providers = await caller.evaluate(() => window.bridge.run("get_transport_providers", {}, "read-3"));
  const boats = providers.result.providers.find((provider) => provider.id === "TR-2").fleet.find((fleet) => fleet.vehicleType === "relief_boat");
  assert.deepEqual([boats.count, boats.available], [4, 2]);
  console.log("OK: the booking holds 2 of 4 relief boats, and the shipment is tracked as planned.");

  // A repeat of the same shipment: the window opens, the site refuses before any form,
  // and the window closes with nothing to confirm.
  await caller.evaluate((lane) => { window.pending = window.bridge.run("create_shipments", { incidentRef: "INC-CHECK", shipments: [lane] }, "write-2"); }, LANE);
  await Promise.all([context.waitForEvent("page"), caller.getByRole("button", { name: "Open action site" }).click()]);
  const repeat = await caller.evaluate(() => window.pending);
  assert.equal(repeat.status, "succeeded");
  assert.equal(repeat.result.ok, false);
  assert.match(repeat.result.reason, new RegExp(`already booked as ${tracking}`));
  console.log("OK: the same shipment is refused the second time, with no form.");

  const declined = await book(caller, { incidentRef: "INC-CHECK", shipments: [{ ...LANE, reference: "CHECK-2", vehicles: 2 }] }, "write-3", "Do not book");
  assert.equal(declined.receipt.status, "succeeded");
  assert.equal(declined.receipt.result.ok, false);
  assert.match(declined.receipt.result.reason, /declined/);
  console.log("OK: declining in the window books nothing.");

  // ---- RouteBridge's own page shows the booking ----------------------------------------
  const site = await context.newPage();
  site.on("pageerror", (error) => problems.push(`site pageerror: ${error.message}`));
  site.on("console", (message) => { if (message.type() === "error") problems.push(`site console: ${message.text()}`); });
  await site.goto(`${SITE}/`, { waitUntil: "networkidle" });
  const row = site.locator("#shipment-rows tr", { hasText: tracking });
  await row.waitFor();
  assert.equal(await site.locator("#shipment-rows tr").count(), 1, "only the confirmed booking is stored");
  await row.getByRole("button", { name: `Mark ${tracking} as dispatched` }).click();
  await site.locator("#shipment-rows .status-dispatched").waitFor();
  await row.getByRole("button", { name: `Mark ${tracking} as in transit` }).click();
  await row.getByRole("button", { name: `Mark ${tracking} as delivered` }).click();
  await site.locator("#shipment-rows .status-delivered").waitFor();
  assert.equal(await row.getByRole("button").count(), 0, "a delivered shipment offers no next step");
  console.log("OK: the page shows the booking and walks it planned → dispatched → in transit → delivered.");

  await site.getByRole("button", { name: "Compare transport options" }).click();
  await site.locator("#option-rows tr .badge").first().waitFor();
  assert.equal(await site.locator("#option-rows tr").count(), 7);
  assert.ok((await site.locator("#option-rows tr").first().innerText()).includes("Farakka Barge & Boat Union"));
  assert.ok((await site.locator("#planner-meta").innerText()).includes("demo-dataset"));
  console.log("OK: the route planner ranks 7 options, the flood-capable boats first.");

  const afterDelivery = await caller.evaluate(() => window.bridge.run("get_transport_providers", {}, "read-4"));
  assert.equal(afterDelivery.result.providers.find((provider) => provider.id === "TR-2").fleet[0].available, 4);
  console.log("OK: delivery freed the boats, and the calling site's next read sees it.");

  // ---- an origin RouteBridge does not list ---------------------------------------------
  const stranger = await context.newPage();
  await stranger.goto(`${STRANGER}/`);
  const none = await connect(stranger);
  assert.deepEqual(none, []);
  console.log(`OK: ${STRANGER}, which RouteBridge does not list, is offered no actions.`);

  await site.getByRole("button", { name: "Reset demo data" }).click();
  assert.deepEqual(problems, []);
  console.log("\nAll bridge checks passed.");
} catch (error) {
  console.error(`\nFAILED: ${error.message}`);
  if (problems.length) console.error(problems.join("\n"));
  process.exitCode = 1;
} finally {
  await browser.close();
}
