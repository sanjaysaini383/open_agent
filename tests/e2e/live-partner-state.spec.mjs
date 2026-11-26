// A partner site is independent: what its own operator changes on its own page is what
// Command sees the next time it asks. These tests change a partner's state through that
// partner's page, then check Command's reaction.
//
// They rely on the page and the bridge frame sharing storage, which holds when the sites
// are on one registrable domain (every localhost port locally). See ARCHITECTURE.md.
import { expect, test } from "@playwright/test";

const COMMAND = process.env.RELIEFMESH_COMMAND || "http://localhost:8080";

const commandState = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("reliefmesh-command-v1") || "{}").state);

async function runStep(page, name, settled) {
  const row = page.getByRole("listitem").filter({ hasText: name });
  await row.getByRole("button", { name: /^(Run|Re-run)$/ }).click();
  const allow = page.getByRole("button", { name: "Allow for this session" });
  for (let i = 0; i < 600; i++) {
    const status = await settled();
    if (/done|warning|failed/.test(status)) return status;
    if (await allow.isVisible()) await allow.click(); else await page.waitForTimeout(200);
  }
  throw new Error(`"${name}" did not settle`);
}

test("a stock update on ShelterConnect's own page changes Command's next assessment", async ({ context }) => {
  const command = await context.newPage();
  await command.goto(`${COMMAND}/#/incidents/INC-0001`);
  await expect(command.getByText(/No model key — workflow only|Model:/)).toBeVisible({ timeout: 30_000 });
  const assess = () => commandState(command).then((state) => state.runs["INC-0001"].steps.assess.status);

  expect(await runStep(command, "2. Assess requirements", assess)).toMatch(/done|warning/);
  expect((await commandState(command)).runs["INC-0001"].assessment.totals.water_kits.shortage).toBe(820);

  // The shelter's own operator records more water at SH-02, on ShelterConnect's page.
  const shelter = await context.newPage();
  await shelter.goto("http://localhost:8081/");
  const form = shelter.locator("#inventory-form");
  await form.locator('select[name="shelterId"]').selectOption("SH-02");
  await form.locator('select[name="resource"]').selectOption("water_kits");
  await form.locator('input[name="quantity"]').fill("200");
  await form.getByRole("button", { name: "Update stock" }).click();
  await expect(shelter.locator("#page-notice")).toContainText("SH-02 now holds 200");

  await command.bringToFront();
  // Wait for an assessment newer than the one above.
  const before = (await commandState(command)).runs["INC-0001"].assessment.generatedAt;
  await runStep(command, "2. Assess requirements", async () => {
    const run = (await commandState(command)).runs["INC-0001"];
    return run.assessment && run.assessment.generatedAt !== before ? run.steps.assess.status : "running";
  });
  const totals = (await commandState(command)).runs["INC-0001"].assessment.totals.water_kits;
  // SH-02 had 40 of 260; it now has 200, so its shortage fell by 160.
  expect(totals).toMatchObject({ inStock: 340, shortage: 660 });
});

test("a partner suspended in TrustRegistry is refused by Command", async ({ context }) => {
  const registry = await context.newPage();
  await registry.goto("http://localhost:8083/");
  const form = registry.locator("#status-form");
  await expect(form.locator('select[name="subjectId"] option[value="net:routebridge"]')).toBeAttached({ timeout: 30_000 });
  await form.locator('select[name="subjectId"]').selectOption("net:routebridge");
  await form.locator('select[name="status"]').selectOption("suspended");
  await form.locator('input[name="reason"]').fill("Suspended in a browser test.");
  await form.getByRole("button").click();
  // The registry asks its own operator to confirm a status change.
  const confirm = registry.getByRole("dialog").getByRole("button").first();
  if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) await confirm.click();
  await expect(registry.locator("#subject-rows, table").first()).toContainText(/suspended/i);

  const command = await context.newPage();
  await command.goto(`${COMMAND}/#/incidents/INC-0001`);
  await expect(command.getByText(/No model key — workflow only|Model:/)).toBeVisible({ timeout: 30_000 });
  const trust = () => commandState(command).then((state) => state.runs["INC-0001"].steps.trust.status);
  await runStep(command, "4. Verify trust", trust);

  const state = await commandState(command);
  expect(state.peers.routebridge.trust.decision).toBe("blocked");
  expect(state.peers.routebridge.trust.blockers.join(" ")).toMatch(/suspended/);
  // A blocked partner's data is never used: the transport providers were not read.
  expect(state.runs["INC-0001"].providers).toEqual([]);
  expect(state.peers.shelterconnect.trust.decision).toBe("verified");
});
