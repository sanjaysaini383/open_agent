// Runs the demonstration once in the system's Chrome and saves screenshots of the main
// views to docs/screenshots/. The five sites must be served (npm run serve).
//
//   node tests/e2e/support/capture-screenshots.mjs
//
// The screenshots show real state: the workflow is actually run, consent is actually
// given, and the partners' own windows are actually confirmed.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/screenshots");
const COMMAND = process.env.RELIEFMESH_COMMAND || "http://localhost:8080";
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || "chrome", headless: true });
const context = await browser.newContext({ baseURL: COMMAND, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const shot = async (name, options = {}) => {
  // Back to the top so the sticky header sits where a reader expects it; a moment for counters to settle.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), ...options });
  console.log(`saved ${name}.png`);
};
const run = () => page.evaluate(() => JSON.parse(localStorage.getItem("reliefmesh-command-v1")).state.runs["INC-0001"]);
const allow = page.getByRole("button", { name: "Allow for this session" });

async function settle(step) {
  for (let i = 0; i < 900; i++) {
    const status = (await run()).steps[step].status;
    if (/done|warning|failed/.test(status)) return;
    if (await allow.isVisible()) await allow.click(); else await page.waitForTimeout(200);
  }
  throw new Error(`step ${step} did not settle`);
}
async function partnerWindow(open, confirm) {
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: open }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  await popup.getByRole("button", { name: confirm }).waitFor();
  return popup;
}

await page.goto("/");
await page.getByText(/No model key|Model:/).first().waitFor({ timeout: 30000 });
await shot("01-command-center-start");

await page.goto("/#/incidents/INC-0001");
await page.getByRole("button", { name: "Start coordination workflow" }).click();
await page.getByRole("heading", { name: /^Contact .+\?$/ }).waitFor();
await shot("02-consent-dialog");
await settle("logistics");
await page.waitForTimeout(800);
await shot("03-incident-workflow", { fullPage: true });

await page.goto("/#/network");
await page.getByRole("button", { name: "Show details of AidSupply Network" }).click();
await shot("04-agent-network", { fullPage: true });
await page.getByRole("button", { name: "NeedAssessmentAgent details" }).click();
await page.getByRole("dialog").getByRole("heading", { name: "NeedAssessmentAgent" }).waitFor();
await shot("16-agent-panel");
await page.keyboard.press("Escape");
await page.goto("/#/approvals");
await page.getByRole("heading", { name: /Approve the response plan/ }).waitFor();
await shot("17-approval-center", { fullPage: true });
await page.goto("/#/allocation");
await page.getByRole("button", { name: "Edit allocation" }).click();
await page.getByText("Allocation editor").first().waitFor();
await shot("18-allocation-editor", { fullPage: true });
await page.goto("/#/trust");
await shot("05-trust-verification", { fullPage: true });
await page.goto("/#/marketplace");
await shot("06-supplier-marketplace", { fullPage: true });

await page.goto("/#/incidents/INC-0001");
await page.getByRole("tab", { name: /Allocation/ }).click();
await shot("07-allocation");
await page.getByRole("tab", { name: /Approval & tracking/ }).click();
await page.getByRole("button", { name: "Review and approve or reject" }).click();
await page.getByRole("heading", { name: "Review and approve the response plan" }).waitFor();
await shot("08-approval-dialog");
await page.getByRole("dialog").getByRole("button", { name: "Approve the plan" }).click();
await page.waitForTimeout(600);

await page.getByRole("button", { name: "Reserve stock", exact: true }).click();
await page.getByRole("heading", { name: /Continue in AidSupply Network's own window/ }).waitFor();
await shot("09-partner-window-prompt");
const reserve = await partnerWindow(/^Open AidSupply Network$/, "Reserve this stock");
await reserve.screenshot({ path: path.join(OUT, "10-aidsupply-confirmation-window.png") });
console.log("saved 10-aidsupply-confirmation-window.png");
await reserve.getByRole("button", { name: "Reserve this stock" }).click();
for (let i = 0; i < 200 && (await run()).reservation.status !== "confirmed"; i++) await page.waitForTimeout(200);

await page.getByRole("button", { name: "Book transport", exact: true }).click();
const booking = await partnerWindow(/^Open RouteBridge$/, "Book these shipments");
await booking.getByRole("button", { name: "Book these shipments" }).click();
for (let i = 0; i < 200 && (await run()).booking.status !== "confirmed"; i++) await page.waitForTimeout(200);

await page.goto("/#/logistics");
const first = (await run()).shipments[0].trackingCode;
const row = page.getByRole("row", { name: new RegExp(first) });
for (const status of ["Dispatched", "In transit", "Delivered"]) await row.getByRole("button", { name: status }).click();
const second = (await run()).shipments[1].trackingCode;
await page.getByRole("row", { name: new RegExp(second) }).getByRole("button", { name: "Dispatched" }).click();
await shot("11-logistics-tracking", { fullPage: true });

await page.goto("/#/analytics");
await page.locator(".recharts-bar-rectangle").first().waitFor();
await shot("12-analytics", { fullPage: true });
await page.goto("/#/audit");
await page.getByText("Hash chain intact").waitFor();
await shot("13-audit-trail");
await page.goto("/");
await shot("14-command-center-after", { fullPage: true });
await page.keyboard.press("Control+k");
await page.getByRole("dialog", { name: "Command palette" }).waitFor();
await shot("19-command-palette");
await page.keyboard.press("Escape");
await page.getByRole("button", { name: /^Alerts/ }).click();
await page.getByRole("dialog").getByRole("heading", { name: "Alert centre" }).waitFor();
await shot("20-alert-centre");
await page.keyboard.press("Escape");
await page.goto("/#/simulator");
await page.getByRole("heading", { name: "Scenario Simulator" }).waitFor();
await shot("21-scenario-simulator", { fullPage: true });
await page.goto("/");
await page.getByRole("button", { name: "Switch to the dark theme" }).click();
await shot("22-command-center-dark", { fullPage: true });
await page.getByRole("button", { name: "Switch to the light theme" }).click();

const inspector = await context.newPage();
await inspector.goto(`http://localhost:8090/?url=${encodeURIComponent(`${COMMAND}/reliefmesh_command`)}`);
await inspector.getByRole("heading", { name: /^Interoperable/ }).waitFor({ timeout: 45000 });
await inspector.screenshot({ path: path.join(OUT, "15-interoperability-inspector.png"), fullPage: true });
console.log("saved 15-interoperability-inspector.png");

await browser.close();
