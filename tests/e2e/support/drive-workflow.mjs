// Development aid: runs the automated workflow steps in the system's Chrome against the
// five locally served sites and prints what happened. Consent is granted by clicking the
// dashboard's own "Allow for this session" button whenever the consent dialog appears.
//
//   node tests/e2e/support/drive-workflow.mjs [--shot out.png] [--headed]
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const shot = args.includes("--shot") ? args[args.indexOf("--shot") + 1] : null;
const base = process.env.RELIEFMESH_COMMAND || "http://localhost:8080";

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || "chrome", headless: !args.includes("--headed") });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
const problems = [];
page.on("console", (message) => { if (message.type() === "error") problems.push(`console: ${message.text()}`); });
page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
page.on("response", (response) => { if (response.status() >= 400) problems.push(`http ${response.status()}: ${response.url()}`); });

await page.addLocatorHandler(page.getByRole("button", { name: "Allow for this session" }), async (button) => { await button.click(); });

await page.goto(`${base}/#/incidents/INC-0001`, { waitUntil: "networkidle" });
await page.getByText(/No model key|Model:/).first().waitFor({ timeout: 30_000 });
await page.getByRole("button", { name: /Start coordination workflow|Continue workflow/ }).click();

const deadline = Date.now() + 150_000;
let state = null;
while (Date.now() < deadline) {
  // A no-op action gives the consent handler a chance to run.
  await page.locator("body").hover({ position: { x: 5, y: 5 }, timeout: 5000 }).catch(() => {});
  state = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("reliefmesh-command-v1") || "{}");
    const run = raw.state?.runs?.["INC-0001"];
    return run ? Object.fromEntries(Object.entries(run.steps).map(([id, step]) => [id, { status: step.status, text: step.summary || step.error || "" }])) : null;
  });
  const statuses = state ? Object.values(state).map((step) => step.status) : [];
  if (state && (state.logistics.status !== "idle" && state.logistics.status !== "running")) break;
  if (statuses.includes("failed") && !statuses.includes("running")) break;
  await page.waitForTimeout(700);
}

if (shot) await page.screenshot({ path: shot, fullPage: true });
const detail = await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem("reliefmesh-command-v1") || "{}").state;
  const run = raw.runs["INC-0001"];
  return {
    peers: Object.values(raw.peers).map((peer) => `${peer.label}: ${peer.discovery?.status} / ${peer.trust?.decision ?? "-"} ${peer.trust?.score ?? ""} sig=${peer.trust?.signatureVerified ?? "-"}`),
    orgs: Object.values(raw.orgTrust).map((item) => `${item.name}: ${item.decision} ${item.score} sig=${item.signatureVerified}`),
    plan: run.plan ? { cost: run.plan.totalCost, lines: run.plan.lines.length, unfulfilled: run.plan.unfulfilled, notes: run.plan.notes, weights: run.plan.weights, bySupplier: run.plan.bySupplier } : null,
    negotiation: run.negotiation.map((event) => `${event.round} ${event.offerId} q${event.quantity} ${event.listUnitPrice}->${event.quotedUnitPrice} ${event.outcome}`),
    shipments: run.shipmentPlans.map((item) => `${item.reference}: ${item.assigned ? `${item.providerName} ${item.vehicles}x${item.vehicleType} ${item.totalHours}h ${item.onTime ? "on-time" : "LATE"} ₹${item.cost}` : `UNASSIGNED ${item.reason}`}`),
    risks: run.risks.map((risk) => `${risk.severity}: ${risk.title}`),
    interactions: raw.interactions.length,
    audit: raw.audit.length,
  };
});
await browser.close();
console.log(JSON.stringify({ steps: state, ...detail, problems }, null, 1));
