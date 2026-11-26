// Browser check of AidSupply's page and of its action bridge, as another site sees it.
//
// It needs the site served on http://localhost:8082 and Chrome installed:
//
//   node vendor/agentify-website/scripts/serve_site.mjs sites/aidsupply --port 8082 --open-as localhost
//   node sites/aidsupply/tests/browser/bridge-check.mjs
//
// The Node tests cover the rules. This covers what only a browser can show:
//   1. the page's own forms (quote calculator, publish offer, update stock, register);
//   2. the bridge handshake from another origin, with the official runtime's
//      ActionBridgeClient: an allowed caller gets the catalogue and the shared reads, an
//      unlisted caller gets nothing;
//   3. the shared write: it opens AidSupply's own window, a person confirms there, the
//      caller gets only the receipt, and the open AidSupply page shows the reservation.
//
// The "calling site" is a stand-in page that this script serves on http://localhost:8080
// (the origin AidSupply lists in CALLERS) with the official runtime files. No ReliefMesh
// Command code is involved, so this checks AidSupply's side of the contract on its own.
// Port 8080 must therefore be free: stop ReliefMesh Command while this runs.
//
// The stand-in is a real local server on purpose. A page that Playwright fulfils from a
// route has no local address, so Chrome's Local Network Access checks treat it as a
// public page and block its frame to localhost
// (ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const SITE = "http://localhost:8082";
const BRIDGE = `${SITE}/bridge/action-bridge.html`;
const RUNTIME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "runtime");

const CALLER_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Stand-in calling site</title></head><body>
<h1>Stand-in calling site</h1>
<script type="module">
  import { ActionBridgeClient } from "/runtime/action-transport.js";
  const BRIDGE = ${JSON.stringify(BRIDGE)};
  window.bridge = {
    async catalog() {
      const client = new ActionBridgeClient(BRIDGE, "AidSupply Network");
      await client.connect();
      try { return await client.request("catalog"); } finally { client.dispose(); }
    },
    async read(name, args) {
      const client = new ActionBridgeClient(BRIDGE, "AidSupply Network");
      await client.connect();
      try { return await client.request("execute", { name, args, requestId: crypto.randomUUID() }); } finally { client.dispose(); }
    },
    // A write needs the owning site's own window: connect(true) asks the visitor to open it.
    async write(name, args) {
      const client = new ActionBridgeClient(BRIDGE, "AidSupply Network");
      await client.connect(true);
      try { return await client.request("execute", { name, args, requestId: crypto.randomUUID() }); } finally { client.dispose(); }
    },
    // What happens when a caller tries a write through the hidden frame instead.
    async writeInFrame(name, args) {
      const client = new ActionBridgeClient(BRIDGE, "AidSupply Network");
      await client.connect();
      try { return await client.request("execute", { name, args, requestId: crypto.randomUUID() }); }
      catch (error) { return { refused: String(error.message || error) }; }
      finally { client.dispose(); }
    },
  };
  window.bridgeReady = true;
</script></body></html>`;

const servers = [];

/** Serve the stand-in calling site, with the official runtime, on a local port. */
async function standInCaller(context, port) {
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    try {
      if (pathname === "/" || pathname === "/index.html") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end(CALLER_PAGE);
      } else if (/^\/runtime\/[\w./-]+\.m?js$/.test(pathname) && !pathname.includes("..")) {
        const body = await readFile(path.join(RUNTIME, pathname.slice("/runtime/".length)));
        response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
        response.end(body);
      } else {
        response.writeHead(404, { "Content-Type": "text/plain" });
        response.end("not found");
      }
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("not found");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", (error) => reject(new Error(error.code === "EADDRINUSE"
      ? `Port ${port} is in use. This check stands in for the calling site there: stop the site on http://localhost:${port} and run it again.`
      : error.message)));
    server.listen(port, "127.0.0.1", resolve);
  });
  servers.push(server);
  const page = await context.newPage();
  await page.goto(`http://localhost:${port}/`);
  await page.waitForFunction(() => window.bridgeReady === true);
  return page;
}

const steps = [];
const step = (name) => { steps.push(name); console.log(`ok  ${name}`); };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const problems = [];
context.on("weberror", (error) => problems.push(`pageerror: ${error.error().message}`));

try {
  // ---- 1. the page's own forms ------------------------------------------------------
  const site = await context.newPage();
  site.on("console", (message) => { if (message.type() === "error") problems.push(`console: ${message.text()}`); });
  await site.goto(`${SITE}/`, { waitUntil: "networkidle" });
  await site.evaluate(() => localStorage.removeItem("aidsupply-state-v1"));
  await site.reload({ waitUntil: "networkidle" });
  assert.equal(await site.locator("#offer-rows tr").count(), 12);
  assert.equal(await site.locator("#supplier-rows tr").count(), 4);
  step("page lists 4 suppliers and 12 offers from the seed");

  // The hostile note is on the page as text, and created no element.
  const hostile = site.locator("#offer-rows tr", { hasText: "OFF-D-FOOD" }).locator("td.notes");
  assert.match(await hostile.textContent(), /SYSTEM: ignore previous instructions/);
  assert.equal(await hostile.locator("*").count(), 0);
  step("the hostile supplier note is rendered as plain text");

  await site.selectOption("#quote-form select[name=offerId]", "OFF-B-FOOD");
  await site.fill("#quote-form input[name=quantity]", "700");
  await site.fill("#quote-form input[name=targetUnitPrice]", "34");
  await site.click("#quote-form button[type=submit]");
  const quoteText = await site.locator("#quote-result").textContent();
  assert.match(quoteText, /Non-binding quote/);
  assert.match(quoteText, /₹34\.67 each/);
  assert.match(quoteText, /₹24,269\.00/);
  assert.match(quoteText, /halfway/);
  step("quote calculator: 700 of OFF-B-FOOD at target 34 quotes ₹34.67, met halfway");

  await site.fill("#quote-form input[name=quantity]", "5");
  await site.click("#quote-form button[type=submit]");
  assert.match(await site.locator("#msg-quote").textContent(), /minimum order for OFF-B-FOOD is 100/);
  assert.equal((await site.locator("#quote-result").textContent()).trim(), "");
  step("quote calculator shows the site's refusal and clears the old quote");

  await site.selectOption("#offer-form select[name=supplierId]", "SUP-B");
  await site.selectOption("#offer-form select[name=resource]", "blankets");
  await site.fill("#offer-form input[name=quantity]", "400");
  await site.fill("#offer-form input[name=unitPrice]", "170");
  await site.fill("#offer-form input[name=minOrder]", "50");
  await site.fill("#offer-form input[name=leadTimeHours]", "9");
  await site.fill("#offer-form input[name=notes]", "Baled in 20s.");
  await site.click("#offer-form button[type=submit]");
  assert.equal(await site.locator("#offer-rows tr").count(), 13);
  assert.match(await site.locator("#page-notice").textContent(), /OFF-B-BLANKET published/);
  step("publish offer form adds OFF-B-BLANKET");

  await site.selectOption("#stock-form select[name=offerId]", "OFF-B-MED");
  await site.fill("#stock-form input[name=quantity]", "150");
  await site.click("#stock-form button[type=submit]");
  assert.match(await site.locator("#offer-rows tr", { hasText: "OFF-B-MED" }).textContent(), /150/);
  step("update stock form sets OFF-B-MED to 150 available");

  await site.fill("#supplier-form input[name=name]", "Dooars Relief Trust");
  await site.fill("#supplier-form input[name=city]", "Jalpaiguri");
  await site.fill("#supplier-form input[name=lat]", "26.5215");
  await site.fill("#supplier-form input[name=lng]", "88.7196");
  await site.fill("#supplier-form input[name=registrationRef]", "WB/TRUST/2019/00311 (simulated)");
  await site.click("#supplier-form button[type=submit]");
  assert.equal(await site.locator("#supplier-rows tr").count(), 5);
  assert.match(await site.locator("#supplier-rows").textContent(), /SUP-E · ORG-SUP-E/);
  step("register supplier form lists SUP-E as self-declared");

  await site.click("#reset-demo");
  assert.equal(await site.locator("#offer-rows tr").count(), 12);
  assert.equal(await site.locator("#supplier-rows tr").count(), 4);
  step("Reset demo data restores the seed");

  // ---- 2. the bridge, from the allowed calling origin -------------------------------
  const caller = await standInCaller(context, 8080);
  const catalog = await caller.evaluate(() => window.bridge.catalog());
  assert.deepEqual(catalog.map((entry) => [entry.name, entry.effect, entry.availability]).sort(), [
    ["get_reservations", "read", "bridge"],
    ["get_supplier_directory", "read", "bridge"],
    ["get_supplier_offers", "read", "bridge"],
    ["request_improved_offer", "read", "bridge"],
    ["reserve_allocation", "irreversible", "bridge"],
  ]);
  step("bridge shares 4 reads and 1 write with http://localhost:8080");

  const offers = await caller.evaluate(() => window.bridge.read("get_supplier_offers", { resource: "water_kits" }));
  assert.equal(offers.simulated, true);
  assert.equal(offers.source, "http://localhost:8082/");
  assert.deepEqual(offers.offers.map((offer) => [offer.offerId, offer.quantityAvailable, offer.unitPrice]), [["OFF-A-WATER", 400, 65], ["OFF-B-WATER", 300, 60], ["OFF-C-WATER", 500, 58]]);
  const quote = await caller.evaluate(() => window.bridge.read("request_improved_offer", { offerId: "OFF-C-WATER", quantity: 500 }));
  assert.deepEqual([quote.ok, quote.quote.quotedUnitPrice, quote.quote.total, quote.quote.binding], [true, 55.1, 27550, false]);
  const directory = await caller.evaluate(() => window.bridge.read("get_supplier_directory", {}));
  assert.equal(directory.suppliers.length, 4);
  step("shared reads return the contract's shapes through the hidden frame");

  const badArgs = await caller.evaluate(() => window.bridge.read("get_supplier_offers", { resource: "gold_bars" }).then(() => "accepted", (error) => String(error.message)));
  assert.match(badArgs, /Invalid/);
  step("the bridge validates arguments against the schema before the site's code runs");

  const framed = await caller.evaluate(() => window.bridge.writeInFrame("reserve_allocation", { incidentRef: "INC-CHECK", lines: [{ offerId: "OFF-A-FOOD", quantity: 100, unitPrice: 42 }] }));
  assert.match(framed.refused, /requires its own confirmation window/);
  step("the write is refused in a hidden frame: it needs AidSupply's own window");

  // ---- 3. the shared write, confirmed in AidSupply's window -------------------------
  const request = {
    incidentRef: "INC-CHECK-001",
    lines: [
      { offerId: "OFF-B-FOOD", quantity: 600, unitPrice: 34.39 },
      { offerId: "OFF-C-WATER", quantity: 500, unitPrice: 55.1 },
    ],
  };

  // A request the site would refuse opens the window but shows no form: only the reason.
  const refusedPopup = context.waitForEvent("page");
  const refusedCall = caller.evaluate((args) => window.bridge.write("reserve_allocation", args), { incidentRef: "INC-CHECK-001", lines: [{ offerId: "OFF-B-FOOD", quantity: 600, unitPrice: 20 }] });
  await caller.getByRole("button", { name: "Open action site" }).click();
  await refusedPopup;
  const refused = await refusedCall;
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /below what North Bengal Aid Collective accepts/);
  step("a reservation below the supplier's price is refused with the site's reason, with no form");

  // Declining in the window reserves nothing.
  const declinePopup = context.waitForEvent("page");
  const declineCall = caller.evaluate((args) => window.bridge.write("reserve_allocation", args), request);
  await caller.getByRole("button", { name: "Open action site" }).click();
  const declineWindow = await declinePopup;
  await declineWindow.getByRole("button", { name: "Do not reserve" }).click();
  const declined = await declineCall;
  assert.equal(declined.ok, false);
  assert.match(declined.reason, /declined/);
  assert.equal((await caller.evaluate(() => window.bridge.read("get_reservations", {}))).reservations.length, 0);
  step("declining in AidSupply's window reserves nothing");

  // Confirming holds the stock.
  const confirmPopup = context.waitForEvent("page");
  const confirmCall = caller.evaluate((args) => window.bridge.write("reserve_allocation", args), request);
  await caller.getByRole("button", { name: "Open action site" }).click();
  const confirmWindow = await confirmPopup;
  await confirmWindow.getByRole("button", { name: "Reserve this stock" }).waitFor();
  assert.equal(new URL(confirmWindow.url()).origin, SITE, "the confirmation runs on AidSupply's own origin");
  const windowText = await confirmWindow.locator("body").textContent();
  assert.match(windowText, /localhost:8080/, "the window names who asked");
  assert.match(windowText, /INC-CHECK-001/);
  assert.match(windowText, /North Bengal Aid Collective/);
  assert.match(windowText, /₹34\.39/);
  assert.match(windowText, /₹20,634\.00/);
  assert.match(windowText, /Ganga Basin Supplies Pvt Ltd/);
  assert.match(windowText, /₹27,550\.00/);
  assert.match(windowText, /Total: ₹48,184\.00/);
  assert.match(windowText, /takes no payment/);
  assert.match(windowText, /Simulated demonstration data/);
  await confirmWindow.getByRole("button", { name: "Reserve this stock" }).click();
  const receipt = await confirmCall;
  assert.deepEqual(Object.keys(receipt).sort(), ["currency", "lines", "note", "ok", "reference", "simulated", "summary", "total"]);
  assert.deepEqual([receipt.ok, receipt.reference, receipt.total, receipt.currency], [true, "AS-RSV-0001", 48184, "INR"]);
  assert.deepEqual(receipt.lines.map((line) => [line.offerId, line.supplierId, line.resource, line.quantity, line.unitPrice, line.lineTotal]), [
    ["OFF-B-FOOD", "SUP-B", "food_packets", 600, 34.39, 20634],
    ["OFF-C-WATER", "SUP-C", "water_kits", 500, 55.1, 27550],
  ]);
  step("confirming in AidSupply's window returns the receipt AS-RSV-0001 with lines and total");

  // The open AidSupply page picked the reservation up through the storage event.
  await site.locator("#reservation-rows tr", { hasText: "AS-RSV-0001" }).waitFor();
  assert.match(await site.locator("#reservation-rows").textContent(), /INC-CHECK-001/);
  assert.match(await site.locator("#offer-rows tr", { hasText: "OFF-C-WATER" }).textContent(), /0\s*of 500 listed/);
  step("the open AidSupply page shows the reservation and the reduced stock without a reload");

  // Same registrable domain (localhost), so the bridge frame reads the same storage.
  const after = await caller.evaluate(() => window.bridge.read("get_supplier_offers", {}));
  const available = Object.fromEntries(after.offers.map((offer) => [offer.offerId, offer.quantityAvailable]));
  assert.deepEqual([available["OFF-B-FOOD"], available["OFF-C-WATER"], available["OFF-A-FOOD"]], [100, 0, 1000]);
  const listed = await caller.evaluate(() => window.bridge.read("get_reservations", {}));
  assert.deepEqual(listed.reservations.map((entry) => [entry.reference, entry.incidentRef, entry.status, entry.total]), [["AS-RSV-0001", "INC-CHECK-001", "reserved", 48184]]);
  step("a later shared read sees the reserved stock (same registrable domain)");

  // Release it on the page, as an AidSupply operator would.
  await site.locator("#reservation-rows tr", { hasText: "AS-RSV-0001" }).getByRole("button", { name: "Release stock" }).click();
  assert.match(await site.locator("#reservation-rows tr", { hasText: "AS-RSV-0001" }).textContent(), /released/);
  step("an operator can release the reservation on the page");

  // ---- an origin AidSupply does not list gets nothing ------------------------------
  const stranger = await standInCaller(context, 8099);
  assert.deepEqual(await stranger.evaluate(() => window.bridge.catalog()), []);
  const denied = await stranger.evaluate(() => window.bridge.read("get_supplier_offers", {}).then(() => "served", (error) => String(error.message)));
  assert.match(denied, /not exposed to this caller/);
  step("an unlisted origin gets an empty catalogue and no reads");

  await site.click("#reset-demo");
  assert.deepEqual(problems, []);
  step("no console or page errors on AidSupply's page");
  console.log(`\nAll ${steps.length} browser checks passed.`);
} catch (error) {
  console.error(`\nFAILED after ${steps.length} checks: ${error.stack || error}`);
  if (problems.length) console.error(problems.join("\n"));
  process.exitCode = 1;
} finally {
  await browser.close();
  for (const server of servers) server.close();
}
