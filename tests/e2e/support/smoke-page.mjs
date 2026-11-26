// Opens one page in the system's Chrome and reports what a visitor would notice:
// console errors, failed requests, and whether the assistant booted.
//
//   node tests/e2e/support/smoke-page.mjs http://localhost:8081/ [--shot out.png]
//
// Used while developing a site; the Playwright suite in tests/e2e covers the real flows.
import { chromium } from "@playwright/test";

const url = process.argv[2];
const shotIndex = process.argv.indexOf("--shot");
const shot = shotIndex > 0 ? process.argv[shotIndex + 1] : null;
if (!url) {
  console.error("Usage: node tests/e2e/support/smoke-page.mjs <url> [--shot file.png]");
  process.exit(2);
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on("console", (message) => { if (message.type() === "error") problems.push(`console: ${message.text()}`); });
page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
page.on("requestfailed", (request) => problems.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`));
page.on("response", (response) => { if (response.status() >= 400) problems.push(`http ${response.status()}: ${response.url()}`); });

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const status = await page.locator("#assistant-status").first().textContent().catch(() => null);
const title = await page.title();
const mounted = await page.locator("#agent-app.ns-composed-app, #agent-app [data-nsdeploy-ui], #agent-app[data-nsdeploy-ui]").count();
if (shot) await page.screenshot({ path: shot, fullPage: true });
await browser.close();

console.log(JSON.stringify({ url, title, assistantStatus: status, assistantMounted: mounted > 0, problems }, null, 2));
process.exitCode = problems.length ? 1 : 0;
