// Browser tests for the whole response workflow, across five independently served sites.
//
// Nothing is mocked. ReliefMesh Command (localhost:8080) really loads the partners'
// published networks from localhost:8081-8084, really calls their shared actions through
// their action bridges, and really opens their confirmation windows. The tests answer the
// consent dialogs and the partners' windows the way a person would.
//
// The tests in this file share one browser page and run in order: each continues from the
// state the one before it left.
import { expect, test } from "@playwright/test";

const COMMAND = process.env.RELIEFMESH_COMMAND || "http://localhost:8080";
const SHELTER = "http://localhost:8081";

test.describe.configure({ mode: "serial" });

/** @type {import("@playwright/test").Page} */
let page;
const problems = [];

/** Read the dashboard's persisted state, the same data the UI renders from. */
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem("reliefmesh-command-v1") || "{}").state);
const run = async (incidentId = "INC-0001") => (await state()).runs[incidentId];

/**
 * Wait for a workflow step to settle. While waiting, answer the dashboard's consent dialog
 * the way a person would: by clicking its own "Allow for this session" button.
 */
async function waitForStep(step, statuses, timeout = 150_000) {
  const deadline = Date.now() + timeout;
  const allow = page.getByRole("button", { name: "Allow for this session" });
  for (;;) {
    const current = (await run()).steps[step];
    if (statuses.test(current.status)) return current;
    if (Date.now() > deadline) throw new Error(`Step ${step} is still ${current.status} after ${timeout} ms`);
    if (await allow.isVisible()) await allow.click();
    else await page.waitForTimeout(200);
  }
}

/** Answer the partner's own confirmation window, opened from the dashboard's prompt. */
async function confirmInPartnerWindow(openButtonName, confirmButtonName) {
  // Consent is remembered for a session only. After a reload the dashboard asks again
  // before it contacts the partner, and only then offers to open the partner's window.
  const open = page.getByRole("button", { name: openButtonName });
  const allow = page.getByRole("button", { name: "Allow once" });
  for (let asked = 0; asked < 4; asked++) {
    await expect(open.or(allow)).toBeVisible({ timeout: 30_000 });
    if (await open.isVisible()) break;
    await allow.click();
  }
  const popupPromise = page.waitForEvent("popup");
  await open.click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  const origin = new URL(popup.url()).origin;
  await popup.getByRole("button", { name: confirmButtonName }).click();
  return origin;
}

test.beforeAll(async ({ browser }) => {
  // A context made by hand does not inherit the config's baseURL.
  const context = await browser.newContext({ baseURL: COMMAND, viewport: { width: 1500, height: 950 }, acceptDownloads: true });
  page = await context.newPage();
  page.on("console", (message) => { if (message.type() === "error") problems.push(`console: ${message.text()}`); });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
});

test.afterAll(async () => { await page?.context().close(); });

test("the Command Center loads with the preloaded scenario and a working agent runtime", async () => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
  // The official runtime booted and loaded this site's own ten-agent network.
  await expect(page.getByText(/No model key — workflow only|Model:/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Simulated data").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Malda district flood response" })).toBeVisible();
  // Headline numbers come from state: one active incident, 12,000 people.
  await expect(page.getByText("12,000").first()).toBeVisible();
  const engine = await page.evaluate(() => ({
    network: window.__nsweb.engine.top.network.name,
    agents: window.__nsweb.engine.top.network.config.tools.length,
    front: window.__nsweb.engine.top.network.findFrontMan(),
    policy: window.__nsweb.engine.top.manifest.peer_policy.mode,
  }));
  expect(engine).toEqual({ network: "reliefmesh_command", agents: 10, front: "EmergencyCommanderAgent", policy: "closed" });
});

test("incident creation: the form validates, then creates, edits and closes an incident", async () => {
  await page.goto("/#/incidents");
  await page.getByRole("button", { name: "Create incident" }).first().click();
  const dialog = page.getByRole("dialog");
  // Invalid input is refused and nothing is saved.
  await dialog.getByLabel("Incident name", { exact: true }).fill("x");
  await dialog.getByRole("button", { name: "Create incident" }).click();
  await expect(dialog.getByText("Some fields need attention. Nothing was saved.")).toBeVisible();
  expect((await state()).incidents).toHaveLength(1);

  await dialog.getByLabel("Incident name", { exact: true }).fill("Test cyclone drill");
  await dialog.getByLabel("Disaster category", { exact: true }).selectOption("cyclone");
  await dialog.getByLabel("Location", { exact: true }).fill("Sagar Island (test)");
  await dialog.getByLabel("Latitude", { exact: true }).fill("21.65");
  await dialog.getByLabel("Longitude", { exact: true }).fill("88.07");
  await dialog.getByLabel("Affected population", { exact: true }).fill("800");
  await dialog.getByLabel("Food packets", { exact: true }).fill("120");
  await dialog.getByRole("button", { name: "Create incident" }).click();
  await expect(page.getByRole("heading", { name: "Test cyclone drill" })).toBeVisible();
  const created = (await state()).incidents.find((incident) => incident.name === "Test cyclone drill");
  expect(created).toMatchObject({ id: "INC-0002", category: "cyclone", affectedPopulation: 800, status: "active" });
  expect(created.requirements.food_packets).toBe(120);

  // Edit it, then close it.
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("dialog").getByLabel("Affected population", { exact: true }).fill("950");
  await page.getByRole("dialog").getByRole("button", { name: "Save changes" }).click();
  await expect.poll(async () => (await state()).incidents.find((incident) => incident.id === "INC-0002").affectedPopulation).toBe(950);
  await page.goto("/#/incidents");
  await page.getByRole("row", { name: /Test cyclone drill/ }).getByRole("button", { name: "Close" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close the incident" }).click();
  await expect.poll(async () => (await state()).incidents.find((incident) => incident.id === "INC-0002").status).toBe("closed");
});

test("resource request: the assessment reads shelter requests from ShelterConnect across origins", async () => {
  await page.goto("/#/incidents/INC-0001");
  await page.getByRole("button", { name: "Start coordination workflow" }).click();
  const step = await waitForStep("assess", /done|warning|failed/);
  expect(step.status, step.error).toMatch(/done|warning/);
  const result = await run();
  expect(result.assessment.source.networkUrl).toBe(`${SHELTER}/shelterconnect`);
  expect(result.assessment.totals.food_packets).toMatchObject({ required: 2000, shortage: 1650 });
  expect(result.assessment.totals.water_kits.shortage).toBe(820);
  expect(result.assessment.lines).toHaveLength(16);
});

test("agent discovery: four independent networks are loaded from their public files and verified", async () => {
  const discover = await waitForStep("discover", /done|warning|failed/);
  expect(discover.status, discover.error).toBe("done");
  const trust = await waitForStep("trust", /done|warning|failed/);
  expect(trust.status, trust.error).toMatch(/done|warning/);

  const { peers, orgTrust, settings, interactions } = await state();
  for (const id of ["trustregistry", "shelterconnect", "aidsupply", "routebridge"]) {
    expect(peers[id].discovery.status, id).toBe("connected");
    expect(peers[id].discovery.agents, id).toHaveLength(3);
    expect(new URL(peers[id].discovery.fetched.manifest).origin, id).not.toBe("http://localhost:8080");
  }
  // Signatures were really verified, and the published network files match their attested digests.
  for (const id of ["shelterconnect", "aidsupply", "routebridge"]) {
    expect(peers[id].trust, id).toMatchObject({ decision: "verified", signatureVerified: true });
    expect(peers[id].trust.evidence.find((item) => item.id === "integrity").status, id).toBe("pass");
  }
  expect(settings.registryPin.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(orgTrust["ORG-SUP-A"].decision).toBe("verified");
  expect(orgTrust["ORG-SUP-C"].decision).toBe("caution");
  expect(orgTrust["ORG-SUP-D"]).toMatchObject({ decision: "unverified", signatureVerified: false });
  expect(orgTrust["ORG-TR-3"].decision).toBe("blocked");
  expect(interactions.filter((item) => item.status === "ok").length).toBeGreaterThan(10);

  await page.goto("/#/network");
  await expect(page.getByRole("heading", { name: "Agent Network Explorer" })).toBeVisible();
  await expect(page.getByText("Connected", { exact: true })).toHaveCount(4);
  await page.getByRole("button", { name: "Show details of AidSupply Network" }).click();
  await expect(page.getByText("SupplierOfferAgent").first()).toBeVisible();
  await expect(page.getByText("reserve_allocation")).toBeVisible();
});

test("supplier comparison: offers are ranked, and the unverified supplier with hostile text is excluded", async () => {
  await waitForStep("offers", /done|warning|failed/);
  const negotiate = await waitForStep("negotiate", /done|warning|failed/);
  expect(negotiate.status, negotiate.error).toMatch(/done|warning/);
  const result = await run();
  expect(result.offers).toHaveLength(12);
  const hostile = result.offers.find((offer) => offer.offerId === "OFF-D-FOOD");
  expect(hostile.eligible).toBe(false);
  expect(hostile.flags.map((flag) => flag.kind)).toEqual(expect.arrayContaining(["instruction_injection", "price_anomaly", "unverified_supplier"]));
  // The hostile instruction changed nothing: the supplier is still unverified, and no plan was approved.
  expect((await state()).orgTrust["ORG-SUP-D"].decision).toBe("unverified");
  expect(result.approval.status).toBe("none");
  expect(result.negotiation.some((event) => event.outcome === "improved")).toBe(true);
  expect(result.negotiation.every((event) => !event.offerId.startsWith("OFF-D"))).toBe(true);

  await page.goto("/#/marketplace");
  await expect(page.getByRole("heading", { name: "Offer comparison" })).toBeVisible();
  const row = page.getByRole("row", { name: /OFF-D-FOOD/ });
  await expect(row.getByText("Excluded")).toBeVisible();
  await expect(row.getByText(/instruction-like content/)).toBeVisible();
  await expect(page.getByText(/Saving against list prices/)).toBeVisible();
});

test("allocation approval: the plan is valid, a person approves it, and only then is anything written", async () => {
  const allocate = await waitForStep("allocate", /done|warning|failed/);
  expect(allocate.status, allocate.error).toMatch(/done|warning/);
  const logistics = await waitForStep("logistics", /done|warning|failed/, 180_000);
  expect(logistics.status, logistics.error).toMatch(/done|warning/);

  let result = await run();
  expect(result.planProblems).toEqual([]);
  expect(result.plan.totalCost).toBeLessThanOrEqual(result.plan.budget);
  expect(result.plan.lines.some((line) => line.supplierId === "SUP-D")).toBe(false);
  for (const resource of ["food_packets", "water_kits", "medical_kits", "blankets"]) expect(result.plan.fulfilment[resource].pct, resource).toBe(100);
  expect(result.shipmentPlans.length).toBeGreaterThan(0);
  expect(result.shipmentPlans.every((item) => item.providerId !== "TR-3")).toBe(true);
  // Nothing external has been written yet.
  expect(result.reservation.status).toBe("none");
  expect(result.booking.status).toBe("none");

  await page.goto("/#/incidents/INC-0001");
  // Execution is locked until a person approves.
  await page.getByRole("tab", { name: /Approval & tracking/ }).click();
  await expect(page.getByRole("button", { name: "Reserve stock", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Review and approve or reject" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Review and approve the response plan" })).toBeVisible();
  await expect(dialog.getByText("Supplier reservations")).toBeVisible();
  await dialog.getByLabel(/Note for the audit trail/).fill("Approved in the browser test.");
  await dialog.getByRole("button", { name: "Approve the plan" }).click();
  await expect.poll(async () => (await run()).approval.status).toBe("approved");
  result = await run();
  expect(result.approval).toMatchObject({ decidedBy: "human:coordinator", via: "dashboard" });
  expect(result.approval.digest).toMatch(/^[0-9a-f]{64}$/);

  // The reservation is confirmed in AidSupply's own window, on AidSupply's origin.
  await page.getByRole("button", { name: "Reserve stock", exact: true }).click();
  const supplierOrigin = await confirmInPartnerWindow(/^Open AidSupply Network$/, "Reserve this stock");
  expect(supplierOrigin).toBe("http://localhost:8082");
  await expect.poll(async () => (await run()).reservation.status, { timeout: 60_000 }).toBe("confirmed");
  expect((await run()).reservation.reference).toMatch(/^AS-RSV-\d{4}$/);

  // Then the shipments, in RouteBridge's own window.
  await page.getByRole("button", { name: "Book transport", exact: true }).click();
  const logisticsOrigin = await confirmInPartnerWindow(/^Open RouteBridge$/, "Book these shipments");
  expect(logisticsOrigin).toBe("http://localhost:8084");
  await expect.poll(async () => (await run()).booking.status, { timeout: 60_000 }).toBe("confirmed");
  result = await run();
  expect(result.booking.reference).toMatch(/^RB-BKG-\d{4}$/);
  expect(result.shipments.length).toBe(result.shipmentPlans.filter((item) => item.assigned).length);
  expect(result.shipments.every((item) => /^RB-TRK-\d{4}$/.test(item.trackingCode) && item.status === "planned")).toBe(true);
});

test("shipment tracking: statuses follow the allowed transitions and a delivery is recorded at the shelter", async () => {
  await page.goto("/#/logistics");
  // A reload must not disturb a step that is waiting for a person, nor the receipts.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Logistics", exact: true })).toBeVisible();
  const reloaded = await run();
  expect(reloaded.steps.execute.status).toBe("waiting");
  expect(reloaded.reservation.status).toBe("confirmed");
  expect(reloaded.booking.status).toBe("confirmed");
  const first = (await run()).shipments[0];
  const row = page.getByRole("row", { name: new RegExp(first.trackingCode) });
  // A planned shipment cannot jump to delivered: that button does not exist.
  await expect(row.getByRole("button", { name: "Delivered" })).toHaveCount(0);
  await row.getByRole("button", { name: "Dispatched" }).click();
  await row.getByRole("button", { name: "In transit" }).click();
  await row.getByRole("button", { name: "Delivered" }).click();
  await expect.poll(async () => (await run()).shipments[0].status).toBe("delivered");
  expect((await run()).shipments[0].history.map((entry) => entry.status)).toEqual(["planned", "dispatched", "in_transit", "delivered"]);
  await expect(row.getByText("Final")).toBeVisible();

  // The shelter confirms receipt in ShelterConnect's own window; only then does its stock change.
  await page.getByRole("button", { name: /Record 1 delivery receipt at ShelterConnect/ }).click();
  const shelterOrigin = await confirmInPartnerWindow(/^Open ShelterConnect$/, "Confirm receipt and update stock");
  expect(shelterOrigin).toBe(SHELTER);
  await expect.poll(async () => (await run()).deliveries.length, { timeout: 60_000 }).toBe(1);
  const result = await run();
  expect(result.deliveries[0].reference).toMatch(/^SC-DLV-\d{4}$/);
  expect(result.shipments[0].deliveryReceipt).toBe(result.deliveries[0].reference);
});

test("audit trail: every decision is recorded and the hash chain is intact", async () => {
  await page.goto("/#/audit");
  await expect(page.getByText("Hash chain intact")).toBeVisible();
  const { audit, consentLog } = await state();
  expect(audit.map((entry) => entry.seq)).toEqual(audit.map((_, index) => index + 1));
  const summaries = audit.map((entry) => entry.summary).join("\n");
  expect(summaries).toMatch(/APPROVED plan/);
  expect(summaries).toMatch(/Reservation AS-RSV-\d{4} confirmed/);
  expect(summaries).toMatch(/Booking RB-BKG-\d{4} confirmed/);
  expect(summaries).toMatch(/Delivery receipt SC-DLV-\d{4}/);
  expect(summaries).toMatch(/Pinned TrustRegistry's signing key on first use/);
  expect(summaries).toMatch(/Instruction-like text|tried to give instructions/);
  expect(consentLog.length).toBeGreaterThan(0);
  expect(consentLog.every((item) => ["allow", "always", "decline"].includes(item.decision))).toBe(true);
  // No credential ever reaches the log.
  expect(JSON.stringify(audit)).not.toMatch(/sk-[A-Za-z0-9]{12,}|otk_[A-Za-z0-9]{12,}/);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  expect((await download).suggestedFilename()).toMatch(/^reliefmesh-audit-.*\.json$/);

  // The incident report exports too.
  await page.goto("/#/incidents/INC-0001");
  const report = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export report" }).click();
  expect((await report).suggestedFilename()).toMatch(/^reliefmesh-INC-0001-.*\.md$/);
});

test("analytics and the remaining pages render from state without errors", async () => {
  for (const [path, heading] of [["/#/analytics", "Analytics"], ["/#/trust", "Trust & Verification"], ["/#/requests", "Resource Requests"], ["/#/settings", "Settings"], ["/#/", "Command Center"]]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  await page.goto("/#/analytics");
  await expect(page.getByText("Plan cost by supplier")).toBeVisible();
  await expect(page.locator(".recharts-bar-rectangle").first()).toBeVisible();
  expect(problems, problems.join("\n")).toEqual([]);
});
