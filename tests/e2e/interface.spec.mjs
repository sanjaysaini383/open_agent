// The command-centre interface: shell, theme, command palette, agent panel, alert centre,
// scenario simulator, allocation editor and approval center. Each test starts from a fresh
// browser context. Nothing is mocked: the simulator runs the real workflow against the
// real partner sites.
import { expect, test } from "@playwright/test";

const COMMAND = process.env.RELIEFMESH_COMMAND || "http://localhost:8080";
const state = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("reliefmesh-command-v1") || "{}").state);

async function open(page, hash = "/") {
  await page.goto(`${COMMAND}/#${hash}`);
  await expect(page.getByText(/No model key — workflow only|Model:/)).toBeVisible({ timeout: 30_000 });
}

/** Answer consent dialogs until the predicate holds. */
async function untilSettled(page, settled, timeout = 120_000) {
  const allow = page.getByRole("button", { name: "Allow for this session" });
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await settled()) return;
    if (Date.now() > deadline) throw new Error("timed out");
    if (await allow.isVisible()) await allow.click(); else await page.waitForTimeout(200);
  }
}

test("the shell: theme toggle, sidebar collapse, shortcuts dialog and the command palette navigate", async ({ page }) => {
  await open(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Switch to the light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem("reliefmesh-ui-prefs"))).state.theme).toBe("light");
  await page.getByRole("button", { name: "Switch to the dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { name: "Collapse the sidebar" }).click();
  await expect(page.getByRole("button", { name: "Expand the sidebar" })).toBeVisible();
  await page.keyboard.press("[");
  await expect(page.getByRole("button", { name: "Collapse the sidebar" })).toBeVisible();

  await page.keyboard.press("?");
  await expect(page.getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Keyboard shortcuts" })).toHaveCount(0);

  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await palette.getByRole("combobox").fill("scenario sim");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Scenario Simulator" })).toBeVisible();
  // "g" then "p" is the Approval Center.
  await page.keyboard.press("g");
  await page.keyboard.press("p");
  await expect(page.getByRole("heading", { name: "Approval Center" })).toBeVisible();
  await expect(page.getByText("Nothing is waiting for you")).toBeVisible();
});

test("the agent panel opens from the network graph and from the palette, and shows real history", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "EmergencyCommanderAgent details" }).click();
  const panel = page.getByRole("dialog");
  await expect(panel.getByRole("heading", { name: "EmergencyCommanderAgent" })).toBeVisible();
  await expect(panel.getByText("Idle · never run here")).toBeVisible();
  await expect(panel.getByText("Front agent")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.keyboard.press("Control+k");
  await page.getByRole("dialog", { name: "Command palette" }).getByRole("combobox").fill("NeedAssessment");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog").getByRole("heading", { name: "NeedAssessmentAgent" })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Step 2: Assess requirements")).toBeVisible();
});

test("the scenario simulator creates a real incident, runs the real workflow, pauses and resumes", async ({ page }) => {
  await open(page, "/simulator?scenario=urban-fire");
  await expect(page.getByRole("button", { name: "Urban fire", exact: false })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Affected population", { exact: true }).fill("2600");
  await page.getByRole("button", { name: "Start simulation" }).click();

  // A new incident exists and the first step reads ShelterConnect, after consent.
  await untilSettled(page, async () => { const s = await state(page); const incident = s.incidents.find((item) => item.name.startsWith("Urban fire:")); return !!incident && /done|warning/.test(s.runs[incident.id].steps.assess.status); });
  const current = await state(page);
  const incident = current.incidents.find((item) => item.name.startsWith("Urban fire:"));
  expect(incident).toMatchObject({ category: "fire", affectedPopulation: 2600, simulated: true, status: "active" });
  expect(current.activeIncidentId).toBe(incident.id);
  expect(current.audit.some((entry) => /Scenario started: Urban fire/.test(entry.summary))).toBe(true);
  // The partners hold the Malda dataset, so the assessment reports the discrepancy with the declared needs.
  expect(current.runs[incident.id].assessment.source.networkUrl).toMatch(/shelterconnect$/);

  // Pause as soon as no consent dialog is in the way; the step in flight finishes, the next does not start.
  const pause = page.getByRole("button", { name: "Pause" });
  const allow = page.getByRole("button", { name: "Allow for this session" });
  for (let tries = 0; tries < 300; tries++) {
    if (await pause.click({ timeout: 400 }).then(() => true, () => false)) break;
    if (await allow.isVisible()) await allow.click();
  }
  await untilSettled(page, async () => page.getByRole("button", { name: /^(Resume|Start)$/ }).isVisible().catch(() => false));
  const paused = await state(page);
  const run = paused.runs[incident.id];
  expect(run.steps.logistics.status).toBe("idle");
  expect(Object.values(run.steps).some((step) => step.status === "running")).toBe(false);
  expect(paused.audit.some((entry) => /Simulation paused/.test(entry.summary))).toBe(true);

  await page.getByRole("button", { name: /^(Resume|Start)$/ }).click();
  await untilSettled(page, async () => /done|warning|failed/.test((await state(page)).runs[incident.id].steps.logistics.status), 180_000);
  const finished = (await state(page)).runs[incident.id];
  expect(finished.steps.logistics.status).toMatch(/done|warning/);
  expect(finished.plan).not.toBeNull();

  // The alert centre and the Approval Center now show the plan waiting for a person.
  await page.getByRole("button", { name: /^Alerts/ }).click();
  await expect(page.getByRole("dialog").getByText("A response plan is waiting for your approval")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto(`${COMMAND}/#/approvals`);
  await expect(page.getByRole("heading", { name: /Approve the response plan for Urban fire/ })).toBeVisible();
  await expect(page.getByText("Requested by").first()).toBeVisible();
});

test("the allocation editor refuses an unsound plan and applies a valid edit through the engine's validator", async ({ page }) => {
  await open(page, "/incidents/INC-0001");
  await page.getByRole("button", { name: "Start coordination workflow" }).click();
  await untilSettled(page, async () => /done|warning|failed/.test((await state(page)).runs["INC-0001"].steps.logistics.status), 200_000);
  const before = (await state(page)).runs["INC-0001"];
  expect(before.plan).not.toBeNull();

  await page.goto(`${COMMAND}/#/allocation`);
  await page.getByRole("button", { name: "Edit allocation" }).click();
  const first = page.getByRole("spinbutton").first();
  const original = Number(await first.inputValue());
  // Over-allocating is refused: the validator reports it and the apply button is disabled.
  await first.fill(String(original + 100_000));
  await expect(page.getByText("This edit breaks an invariant and cannot be stored")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply edited plan" })).toBeDisabled();
  // A smaller quantity is sound: it is stored as a new version, and logistics must be redone.
  await first.fill(String(Math.max(1, original - 1)));
  await expect(page.getByText("This edit breaks an invariant and cannot be stored")).toHaveCount(0);
  await page.getByRole("button", { name: "Apply edited plan" }).click();
  await expect.poll(async () => (await state(page)).runs["INC-0001"].plan.version).toBe(before.plan.version + 1);
  const after = (await state(page));
  expect(after.runs["INC-0001"].plan.method).toMatch(/Edited by the coordinator/);
  expect(after.runs["INC-0001"].steps.logistics.status).toBe("idle");
  expect(after.audit.some((entry) => /edited by the coordinator/.test(entry.summary))).toBe(true);
});
