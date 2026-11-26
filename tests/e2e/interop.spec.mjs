// Interoperability and safety boundaries between the five sites, in a real browser.
// Each test starts from a fresh browser context, so no consent or state carries over.
import { expect, test } from "@playwright/test";

const COMMAND = process.env.RELIEFMESH_COMMAND || "http://localhost:8080";
const PARTNERS = {
  shelterconnect: "http://localhost:8081/shelterconnect",
  aidsupply: "http://localhost:8082/aidsupply",
  trustregistry: "http://localhost:8083/trustregistry",
  routebridge: "http://localhost:8084/routebridge",
};
const INSPECTOR = "http://localhost:8090";

async function openCommand(page, hash = "/") {
  await page.goto(`${COMMAND}/#${hash}`);
  await expect(page.getByText(/No model key — workflow only|Model:/)).toBeVisible({ timeout: 30_000 });
}
const commandState = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("reliefmesh-command-v1") || "{}").state);

test("consent comes before contact: declining means the partner is never fetched", async ({ page, context }) => {
  const toPartners = [];
  context.on("request", (request) => { if (/^http:\/\/localhost:808[1-4]\//.test(request.url())) toPartners.push(request.url()); });
  await openCommand(page, "/incidents/INC-0001");
  await page.getByRole("button", { name: "Start coordination workflow" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: /^Contact .+\?$/ })).toBeVisible();
  // The dialog names the destination origin and the purpose before anything is sent.
  await expect(dialog.getByText(/localhost:808[1-4]/)).toBeVisible();
  await expect(dialog.getByText("Purpose")).toBeVisible();
  expect(toPartners, "no request before the person answered").toEqual([]);

  await dialog.getByRole("button", { name: "Decline" }).click();
  await expect.poll(async () => (await commandState(page)).runs["INC-0001"].steps.assess.status).toBe("failed");
  const state = await commandState(page);
  expect(state.runs["INC-0001"].steps.assess.error).toMatch(/You declined to contact .+\. Nothing was sent\./);
  expect(state.runs["INC-0001"].assessment).toBeNull();
  expect(state.consentLog.at(-1).decision).toBe("decline");
  expect(state.audit.some((entry) => entry.kind === "consent" && /^Declined/.test(entry.summary))).toBe(true);
  expect(toPartners, "no request after declining either").toEqual([]);
});

test("the closed peer policy refuses an origin that is not in allowed_peers", async ({ page }) => {
  await openCommand(page);
  const result = await page.evaluate(async (target) => {
    const { engine } = window.__nsweb;
    try {
      await engine.resolveRemote(target, [`${engine.top.base}::${engine.top.network.name}`], undefined, engine.top.manifest);
      return "loaded";
    } catch (error) { return String(error.message); }
  }, `${INSPECTOR}/some_network`);
  expect(result).toMatch(/^Policy: localhost:8090 is not in reliefmesh_command's allowed_peers; refusing to contact it\.$/);
});

test("Command calls a capability on each of the four independent partner sites", async ({ page }) => {
  await openCommand(page);
  // Driven through the runtime's own engine, exactly as the workflow does.
  const results = await page.evaluate(async (partners) => {
    const { engine } = window.__nsweb;
    const chain = [`${engine.top.base}::${engine.top.network.name}`];
    const read = { shelterconnect: ["get_shelter_overview", {}], aidsupply: ["get_supplier_offers", {}], trustregistry: ["get_registry_info", {}], routebridge: ["get_transport_providers", {}] };
    const out = {};
    for (const [id, url] of Object.entries(partners)) {
      const session = await engine.resolveRemote(url, chain, undefined, engine.top.manifest);
      const catalog = engine.actions.catalog({ base: session.base, network: session.network.name });
      const [name, args] = read[id];
      const entry = catalog.find((action) => action.name === name);
      const receipts = await engine.actions.execute(engine.actions.prepare({ kind: "action", action: entry.ref, arguments: args }), async () => true, crypto.randomUUID());
      out[id] = {
        calledOrigin: new URL(session.base).origin,
        network: session.network.name,
        front: session.network.findFrontMan(),
        shared: catalog.map((action) => `${action.name}:${action.effect}`),
        status: receipts[0].status,
        simulated: receipts[0].result.simulated,
        source: receipts[0].result.source,
      };
    }
    return out;
  }, PARTNERS);

  expect(results.shelterconnect).toMatchObject({ calledOrigin: "http://localhost:8081", front: "ShelterStatusAgent", status: "succeeded", simulated: true });
  expect(results.aidsupply).toMatchObject({ calledOrigin: "http://localhost:8082", front: "SupplierOfferAgent", status: "succeeded", simulated: true });
  expect(results.trustregistry).toMatchObject({ calledOrigin: "http://localhost:8083", front: "IdentityVerificationAgent", status: "succeeded" });
  expect(results.routebridge).toMatchObject({ calledOrigin: "http://localhost:8084", front: "RoutePlanningAgent", status: "succeeded", simulated: true });
  for (const [id, result] of Object.entries(results)) {
    expect(result.calledOrigin, id).not.toBe(COMMAND);
    // Each partner shares its writes as writes: they can only run in its own window.
    expect(result.shared.some((item) => item.endsWith(":irreversible")), id).toBe(true);
  }
});

test("a partner's write cannot be run from a hidden frame: it needs the partner's own window", async ({ page }) => {
  await openCommand(page);
  const message = await page.evaluate(async (url) => {
    // Talk to AidSupply's bridge directly in a hidden frame and try the write there.
    const { ActionBridgeClient } = await import(`${location.origin}/runtime/action-transport.js`);
    const client = new ActionBridgeClient(`${new URL("./", url).href}bridge/action-bridge.html`, "AidSupply");
    try {
      await client.connect(false);
      await client.request("execute", { name: "reserve_allocation", args: { incidentRef: "INC-TEST", lines: [{ offerId: "OFF-B-FOOD", quantity: 100, unitPrice: 38 }] }, requestId: "test-1" });
      return "executed";
    } catch (error) { return String(error.message); } finally { client.dispose(); }
  }, PARTNERS.aidsupply);
  expect(message).toBe("This action requires its own confirmation window.");
});

test("the interoperability test on the Agent Network page shows a real cross-origin round trip", async ({ page }) => {
  await openCommand(page, "/network");
  await page.getByRole("button", { name: "Run the test" }).click();
  // ShelterConnect is verified before its data is used, so the registry is asked first.
  for (let answered = 0; answered < 3; answered++) {
    const allow = page.getByRole("button", { name: "Allow once" });
    const done = page.getByText("A real cross-origin interaction completed");
    await expect(allow.or(done)).toBeVisible({ timeout: 30_000 });
    if (await done.isVisible()) break;
    await allow.click();
  }
  await expect(page.getByText("A real cross-origin interaction completed")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Yes: different origins")).toBeVisible();
  await expect(page.getByText(/4 shelters returned by/)).toBeVisible();
  const state = await commandState(page);
  expect(state.peers.shelterconnect.trust).toMatchObject({ decision: "verified", signatureVerified: true });
});

test("a partner site can file an assistance request with Command, confirmed in a ReliefMesh window", async ({ context }) => {
  const shelter = await context.newPage();
  await shelter.goto("http://localhost:8081/");
  await expect(shelter.locator("#assistant-status")).toContainText(/Assistant/, { timeout: 30_000 });

  // ShelterConnect's own runtime loads Command's network and calls the write its bridge shares.
  const pending = shelter.evaluate(async (commandUrl) => {
    const { engine } = window.__nsweb;
    const session = await engine.resolveRemote(commandUrl, [`${engine.top.base}::${engine.top.network.name}`], undefined, engine.top.manifest);
    const catalog = engine.actions.catalog({ base: session.base, network: session.network.name });
    const entry = catalog.find((action) => action.name === "request_assistance");
    const plan = engine.actions.prepare({ kind: "action", action: entry.ref, arguments: { organization: "ShelterConnect", category: "shelter", urgency: "critical", summary: "Manikchak camp needs water kits and medical kits within 24 hours.", resource: "water_kits", quantity: 290 } });
    const receipts = await engine.actions.execute(plan, async () => true, crypto.randomUUID());
    return { shared: catalog.map((action) => `${action.name}:${action.effect}`), receipt: receipts[0] };
  }, `${COMMAND}/reliefmesh_command`);

  // The runtime asks, in ShelterConnect's chat, before Command's window opens.
  const popupPromise = context.waitForEvent("page");
  await shelter.getByRole("button", { name: /^Open ReliefMesh Command/ }).click();
  const popup = await popupPromise;
  expect(new URL(popup.url()).origin).toBe(COMMAND);
  await expect(popup.getByRole("heading", { name: "File an assistance request?" })).toBeVisible();
  await expect(popup.getByText("localhost:8081").first()).toBeVisible();
  await popup.getByRole("button", { name: "File this request" }).click();

  const result = await pending;
  expect(result.shared.sort()).toEqual(["get_active_incidents:read", "get_coordination_capabilities:read", "request_assistance:irreversible"]);
  expect(result.receipt.status).toBe("succeeded");
  expect(result.receipt.result).toMatchObject({ ok: true });
  expect(result.receipt.result.reference).toMatch(/^RM-REQ-\d{4}$/);

  // The request is now in Command's inbox, attributed to the origin that asked.
  const command = await context.newPage();
  await openCommand(command, "/requests");
  const row = command.getByRole("row", { name: new RegExp(result.receipt.result.reference) });
  await expect(row).toBeVisible();
  await expect(row.getByText("http://localhost:8081")).toBeVisible();
  await row.getByRole("button", { name: "Acknowledge" }).click();
  await expect(row.getByText("Acknowledged")).toBeVisible();
});

test("the Inspector reports each site as interoperable, from a third origin with real CORS", async ({ page }) => {
  for (const url of [`${COMMAND}/reliefmesh_command`, ...Object.values(PARTNERS)]) {
    await page.goto(`${INSPECTOR}/?url=${encodeURIComponent(url)}`);
    await expect(page.getByRole("heading", { name: /^Interoperable/ })).toBeVisible({ timeout: 45_000 });
    const report = await page.evaluate(() => window.__inspector.report);
    expect(report.checkedFrom, url).toBe(INSPECTOR);
    expect(report.summary.fail, `${url}: ${JSON.stringify(report.checks.filter((check) => check.status === "fail"))}`).toBe(0);
    expect(report.networkUrl).toBe(url);
    expect(report.network.agents.length, url).toBeGreaterThanOrEqual(3);
  }
});

test("the Inspector sees what a stranger is offered: Command's public reads, and none of ShelterConnect's actions", async ({ page }) => {
  await page.goto(`${INSPECTOR}/?url=${encodeURIComponent(`${COMMAND}/reliefmesh_command`)}`);
  await expect(page.getByRole("heading", { name: /^Interoperable/ })).toBeVisible({ timeout: 45_000 });
  let report = await page.evaluate(() => window.__inspector.report);
  // The inspector's origin is no partner of Command: it gets the two public reads and not the write.
  expect(report.actions.catalog.map((action) => action.name).sort()).toEqual(["get_active_incidents", "get_coordination_capabilities"]);

  await page.goto(`${INSPECTOR}/?url=${encodeURIComponent(PARTNERS.shelterconnect)}`);
  await expect(page.getByRole("heading", { name: /^Interoperable/ })).toBeVisible({ timeout: 45_000 });
  report = await page.evaluate(() => window.__inspector.report);
  expect(report.actions.catalog).toEqual([]);
  await expect(page.getByRole("button", { name: "Download report (Markdown)" })).toBeVisible();
});

test("the Inspector explains a site that is not an agentic website", async ({ page }) => {
  await page.goto(`${INSPECTOR}/?url=${encodeURIComponent(`${INSPECTOR}/nothing_here`)}`);
  await expect(page.getByRole("heading", { name: "Not interoperable yet" })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/No agent manifest was found/)).toBeVisible();
});
