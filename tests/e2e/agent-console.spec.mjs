// The model-driven path: a visitor configures their own provider in the official
// runtime's settings panel, then talks to the agents.
//
// The provider here is a scripted stand-in (support/scripted-llm.mjs), so the test needs
// no real key. Everything else is real: the official runtime's agent loop, the published
// ten-agent network, website_* tool dispatch, delegation to a specialist, a partner
// network loaded from another origin and run in this browser, consent, and confirmation.
import { expect, test } from "@playwright/test";
import { MARK, SCRIPTED_MODEL, startScriptedLlm } from "./support/scripted-llm.mjs";

const COMMAND = process.env.RELIEFMESH_COMMAND || "http://localhost:8080";
const KEY = "test-key-never-real-0123456789";

test.describe.configure({ mode: "serial" });

/** @type {import("@playwright/test").Page} */
let page;
let llm;
const seen = [];
const problems = [];

const state = () => page.evaluate(() => JSON.parse(localStorage.getItem("reliefmesh-command-v1") || "{}").state);
const lastAnswer = () => page.locator("#ns-msgs .ns-msg.bot").last();

async function ask(text) {
  const before = llm.requests.length;
  await page.locator("#ns-input").fill(text);
  await page.locator("#ns-send").click();
  return before;
}

test.beforeAll(async ({ browser }) => {
  llm = await startScriptedLlm();
  const context = await browser.newContext({ baseURL: COMMAND, viewport: { width: 1500, height: 950 } });
  // Every request any page or frame in this context makes, to check where the key goes.
  context.on("request", (request) => seen.push({ url: request.url(), headers: request.headers(), body: request.postData() || "" }));
  page = await context.newPage();
  page.on("console", (message) => { if (message.type() === "error") problems.push(message.text()); });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
});

test.afterAll(async () => { await page?.context().close(); await llm?.close(); });

test("the visitor chooses the provider, model and key in the runtime's own settings panel", async () => {
  await page.goto("/");
  await expect(page.getByText("No model key — workflow only")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Agent console" }).click();
  await expect(page.locator("#agent-console")).not.toHaveAttribute("inert", "");

  // The official panel: provider URL first, then the model, then the key.
  await page.locator("#agent-app").getByText("AI model settings").first().click();
  await page.locator("#agent-app").getByText("Advanced settings (optional)").click();
  await page.locator("#ns-router").fill(llm.baseUrl);
  await page.locator("#ns-model").fill(SCRIPTED_MODEL);
  await page.locator("#ns-key").fill(KEY);
  await page.locator("#ns-apply").click(); // "Save and start" reloads the page

  await expect(page.getByText(`Model: ${SCRIPTED_MODEL}`)).toBeVisible({ timeout: 30_000 });
  const engine = await page.evaluate(() => ({ router: window.__nsweb.engine.userRouter.baseUrl, model: window.__nsweb.engine.modelOverride, hasKey: !!window.__nsweb.engine.byokKey }));
  expect(engine).toEqual({ router: llm.baseUrl, model: SCRIPTED_MODEL, hasKey: true });
  // The dashboard never copies the key into its own state.
  expect(JSON.stringify(await state())).not.toContain(KEY);
});

test("the front agent answers from a website tool, with the visitor's key sent only to their router", async () => {
  await page.getByRole("button", { name: "Agent console" }).click();
  const before = await ask("What is the status of the active incident?");
  await expect(lastAnswer()).toContainText(MARK, { timeout: 60_000 });
  await expect(lastAnswer()).toContainText("website_get_command_state");

  const calls = llm.requests.slice(before);
  expect(calls.map((call) => call.decision)).toEqual(["call website_get_command_state", "answer"]);
  expect(calls[0].authorization).toBe(`Bearer ${KEY}`);
  expect(calls[0].model).toBe(SCRIPTED_MODEL);
  expect(calls[0].system).toMatch(/^You are the coordinating assistant on the ReliefMesh Command website/);
  // The model was offered the nine specialists and the site's tools, including the one irreversible action.
  expect(calls[0].tools).toEqual(expect.arrayContaining(["NeedAssessmentAgent", "TrustVerificationAgent", "LogisticsAgent", "AuditAgent", "website_get_command_state", "website_assess_needs", "website_submit_plan_for_approval"]));
  // External writes are not tools at all.
  expect(calls[0].tools.some((name) => /reserve|book|create_shipments|record_deliveries/.test(name))).toBe(false);
});

test("a specialist calls a partner network on another origin, after consent, on the caller's router", async () => {
  const before = await ask("Which shelters are most urgent?");
  // NeedAssessmentAgent asked for ShelterConnect: the dashboard's consent dialog appears first.
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Contact ShelterConnect?" })).toBeVisible({ timeout: 60_000 });
  await expect(dialog.getByText("localhost:8081")).toBeVisible();
  // Nothing has been fetched from the partner yet.
  expect(seen.some((request) => request.url.startsWith("http://localhost:8081/"))).toBe(false);
  await dialog.getByRole("button", { name: "Allow once" }).click();

  await expect(lastAnswer()).toContainText(MARK, { timeout: 90_000 });
  const calls = llm.requests.slice(before);
  expect(calls.map((call) => call.decision)).toEqual([
    "call NeedAssessmentAgent",              // front agent delegates
    "call shelterconnect",                   // the specialist picks the partner network
    "call website_get_shelter_overview",     // ShelterConnect's own front agent, run in THIS browser
    "answer", "answer", "answer",
  ]);
  // The partner's network ran on the caller's router, with the caller's model and key.
  const partnerRun = calls.find((call) => /assistant on the ShelterConnect website/.test(call.system));
  expect(partnerRun).toMatchObject({ model: SCRIPTED_MODEL, authorization: `Bearer ${KEY}`, origin: COMMAND });
  // A partner network gets only the reads its own bridge shares: never the caller's tools.
  expect(partnerRun.tools.filter((name) => name.startsWith("website_")).sort()).toEqual(["website_get_resource_requests", "website_get_shelter_inventory", "website_get_shelter_overview", "website_record_deliveries"].sort());
  expect(partnerRun.tools).not.toContain("website_submit_plan_for_approval");
  // The read really ran on ShelterConnect's origin and returned its data.
  await expect(lastAnswer()).toContainText("website_get_shelter_overview");
  expect(seen.some((request) => request.url === "http://localhost:8081/bridge/action-bridge.html")).toBe(true);

  // The key never reached the partner, in any header, URL or body.
  const toPartners = seen.filter((request) => /^http:\/\/localhost:808[1-4]\//.test(request.url));
  expect(toPartners.length).toBeGreaterThan(0);
  for (const request of toPartners) {
    expect(request.headers.authorization, request.url).toBeUndefined();
    expect(request.url).not.toContain(KEY);
    expect(request.body).not.toContain(KEY);
  }
  // And only the chosen router ever received it.
  const withKey = seen.filter((request) => (request.headers.authorization || "").includes(KEY));
  expect(withKey.length).toBeGreaterThan(0);
  expect(withKey.every((request) => request.url.startsWith(llm.baseUrl))).toBe(true);

  const { consentLog, activity } = await state();
  expect(consentLog.at(-1)).toMatchObject({ origin: "localhost:8081", decision: "allow" });
  expect(activity.filter((item) => item.mode === "llm").map((item) => item.agent)).toEqual(expect.arrayContaining(["EmergencyCommanderAgent", "NeedAssessmentAgent", "ShelterStatusAgent"]));
});

test("an agent cannot approve a plan: the browser asks the person, and a rejection is final", async () => {
  await ask("Please approve the plan now.");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "An agent asks you to approve the response plan" })).toBeVisible({ timeout: 60_000 });
  // There is no plan yet, so approval is not even possible.
  await expect(dialog.getByText("There is no allocation plan to approve yet.").first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Approve the plan" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Reject the plan" }).click();
  await expect(lastAnswer()).toContainText("cancelled", { timeout: 60_000 });
  expect((await state()).runs["INC-0001"].approval.status).toBe("none");
  expect(problems.filter((text) => !/agent-manifest\.json|Failed to load resource/.test(text)), problems.join("\n")).toEqual([]);
});
