// Records real footage of the demonstration for the demo film: the whole response, run
// in the system's Chrome against the five locally served sites, at 1920x1080. Consent is
// given by clicking the dashboard's own buttons; the partners' own windows are confirmed
// for real. A visible cursor is drawn into the page so the viewer sees every click, and
// the time of every beat is written next to the video so the edit can cut on it.
//
//   node tests/e2e/support/record-demo.mjs <out-dir>
import { mkdir, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const OUT = path.resolve(process.argv[2] || "video/footage");
const COMMAND = process.env.RELIEFMESH_COMMAND || "http://localhost:8080";
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || "chrome", headless: true });
const context = await browser.newContext({ baseURL: COMMAND, viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } } });
const page = await context.newPage();
const t0 = Date.now();
const beats = [];
const mark = (name, note = "") => { const at = (Date.now() - t0) / 1000; beats.push({ name, at: Math.round(at * 100) / 100, note }); console.log(`${at.toFixed(1).padStart(6)}s  ${name}${note ? ` — ${note}` : ""}`); };
const wait = (ms) => page.waitForTimeout(ms);
const run = () => page.evaluate(() => JSON.parse(localStorage.getItem("reliefmesh-command-v1")).state.runs["INC-0001"]);

// A cursor the recording can see. Hash routing keeps the document, so it survives navigation.
const CURSOR = `
  const c = document.createElement("div"); c.id = "__rm-cursor";
  c.style.cssText = "position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;transform:translate(-4px,-3px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.45));transition:transform .08s";
  c.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2 L4 19 L8.5 14.8 L11.6 21.4 L14.4 20.1 L11.4 13.6 L17.6 13.3 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  document.body.appendChild(c);
  window.__rmCursor = (x, y, down) => { c.style.left = x + "px"; c.style.top = y + "px"; c.style.transform = down ? "translate(-4px,-3px) scale(0.86)" : "translate(-4px,-3px)"; };`;
await page.addInitScript(CURSOR);
let cursor = { x: 960, y: 540 };
async function glide(x, y, ms = 650) {
  const steps = Math.max(8, Math.round(ms / 16));
  const from = { ...cursor };
  for (let index = 1; index <= steps; index++) {
    const p = index / steps; const e = 1 - Math.pow(1 - p, 3);
    const nx = from.x + (x - from.x) * e; const ny = from.y + (y - from.y) * e;
    await page.mouse.move(nx, ny);
    await page.evaluate(([cx, cy]) => window.__rmCursor?.(cx, cy, false), [nx, ny]).catch(() => {});
    await wait(16);
  }
  cursor = { x, y };
}
async function click(locator, note) {
  await locator.scrollIntoViewIfNeeded();
  await wait(250);
  const box = await locator.boundingBox();
  if (!box) throw new Error(`no box for ${note || locator}`);
  await glide(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(([cx, cy]) => window.__rmCursor?.(cx, cy, true), [cursor.x, cursor.y]).catch(() => {});
  await wait(90);
  await locator.click();
  await page.evaluate(([cx, cy]) => window.__rmCursor?.(cx, cy, false), [cursor.x, cursor.y]).catch(() => {});
  if (note) mark("click", note);
}
async function scrollTo(y, ms = 900) {
  await page.evaluate(([target, duration]) => new Promise((resolve) => {
    const start = window.scrollY; const t0 = performance.now();
    const step = (now) => { const p = Math.min(1, (now - t0) / duration); const e = 1 - Math.pow(1 - p, 3); window.scrollTo(0, start + (target - start) * e); if (p < 1) requestAnimationFrame(step); else resolve(); };
    requestAnimationFrame(step);
  }), [y, ms]);
}
async function settle(step, timeout = 200_000) {
  const allow = page.getByRole("button", { name: "Allow for this session" });
  const deadline = Date.now() + timeout;
  for (;;) {
    const status = (await run()).steps[step].status;
    if (/done|warning|failed/.test(status)) return status;
    if (Date.now() > deadline) throw new Error(`step ${step} did not settle`);
    if (await allow.isVisible()) { await wait(900); await click(allow, `consent: allow for this session`); await wait(400); } else await wait(200);
  }
}
async function partnerWindow(openName, confirmName, note) {
  const allow = page.getByRole("button", { name: "Allow once" });
  const open = page.getByRole("button", { name: openName });
  for (let asked = 0; asked < 4; asked++) {
    await open.or(allow).first().waitFor({ timeout: 30_000 });
    if (await open.isVisible()) break;
    await wait(700); await click(allow, "consent: allow once");
  }
  await wait(900);
  const popupPromise = page.waitForEvent("popup");
  await click(open, note);
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  await popup.setViewportSize({ width: 1920, height: 1080 });
  await popup.waitForTimeout(2200);
  mark("popup", `${note}: partner window open`);
  await popup.getByRole("button", { name: confirmName }).click();
  mark("popup-confirm", confirmName);
  // The partner's window closes itself once answered.
  await popup.waitForEvent("close", { timeout: 10_000 }).catch(() => {});
  await wait(600);
}

try {
  // 1. The Command Center before anything is contacted.
  await page.goto("/");
  await page.getByText(/No model key|Model:/).first().waitFor({ timeout: 30_000 });
  await wait(600);
  mark("command-center", "dashboard before the workflow");
  await glide(700, 300, 900);
  await wait(1800);
  await scrollTo(760, 1400);
  await wait(1600);
  await scrollTo(0, 900);
  await wait(600);

  // 2. The incident and the start of the workflow.
  await click(page.getByRole("button", { name: "Open incident" }), "open incident");
  await page.getByRole("heading", { name: "Malda district flood response" }).waitFor();
  await wait(1800);
  mark("incident", "incident page");
  await click(page.getByRole("button", { name: "Start coordination workflow" }), "start coordination workflow");
  await page.getByRole("heading", { name: /^Contact .+\?$/ }).waitFor();
  await wait(1200);
  mark("consent", "first consent dialog");
  const assessed = await settle("assess");
  mark("assessed", `assessment ${assessed}`);
  await settle("discover"); mark("discovered", "partners loaded");
  await settle("trust"); mark("verified", "signatures verified");
  await settle("offers"); mark("offers", "offers collected");
  await settle("negotiate"); mark("negotiated", "quotes in");
  await settle("allocate"); mark("allocated", "plan built");
  await settle("logistics"); mark("logistics", "transport planned");
  await wait(1500);

  // 3. The agent network, with a node opened.
  await page.goto("/#/network");
  await page.getByRole("heading", { name: "Agent Network Explorer" }).waitFor();
  await wait(1200);
  mark("network", "agent network page");
  await click(page.getByRole("button", { name: "TrustVerificationAgent details" }), "open TrustVerificationAgent");
  await page.getByRole("dialog").getByRole("heading", { name: "TrustVerificationAgent" }).waitFor();
  await wait(2600);
  mark("agent-panel", "agent details panel");
  await page.keyboard.press("Escape");
  await wait(500);

  // 4. Trust, then the marketplace with the hostile supplier.
  await page.goto("/#/trust");
  await page.getByRole("heading", { name: "Trust & Verification" }).waitFor();
  await wait(800); mark("trust", "trust page");
  await scrollTo(520, 1200); await wait(1800);
  await page.goto("/#/marketplace");
  await page.getByRole("heading", { name: "Offer comparison" }).waitFor();
  await wait(900); mark("marketplace", "supplier cards");
  const hostile = page.getByText("QuickAid Traders").first();
  await hostile.scrollIntoViewIfNeeded(); await wait(300);
  const hb = await hostile.boundingBox();
  if (hb) await glide(hb.x + 40, hb.y + 10, 700);
  await wait(2200); mark("hostile", "hostile supplier excluded");

  // 5. The allocation and the approval.
  await page.goto("/#/allocation");
  await page.getByRole("heading", { name: "Allocation", exact: true }).waitFor();
  await wait(900); mark("allocation", "allocation page");
  await scrollTo(430, 1200); await wait(1600);
  await page.goto("/#/approvals");
  await page.getByRole("heading", { name: /Approve the response plan/ }).waitFor();
  await wait(1200); mark("approvals", "approval center");
  await click(page.getByRole("button", { name: "Review and approve" }), "review and approve");
  await page.getByRole("heading", { name: "Review and approve the response plan" }).waitFor();
  await wait(2200); mark("approval-dialog", "plan preview");
  await click(page.getByRole("dialog").getByRole("button", { name: "Approve the plan" }), "approve the plan");
  await wait(1400); mark("approved", "plan approved");

  // 6. The writes, in the partners' own windows.
  await click(page.getByRole("button", { name: /Reserve stock in AidSupply's window/ }), "reserve stock");
  await page.getByRole("heading", { name: /Continue in AidSupply Network's own window/ }).waitFor();
  await wait(1300); mark("window-prompt", "partner window prompt");
  await partnerWindow(/^Open AidSupply Network$/, "Reserve this stock", "open AidSupply");
  for (let i = 0; i < 200 && (await run()).reservation.status !== "confirmed"; i++) await wait(200);
  mark("reserved", "reservation confirmed");
  await wait(900);
  await click(page.getByRole("button", { name: /Book transport in RouteBridge's window/ }), "book transport");
  await partnerWindow(/^Open RouteBridge$/, "Book these shipments", "open RouteBridge");
  for (let i = 0; i < 200 && (await run()).booking.status !== "confirmed"; i++) await wait(200);
  mark("booked", "booking confirmed");
  await wait(900);

  // 7. Logistics: dispatch and deliver one shipment; the map.
  await page.goto("/#/logistics");
  await page.getByRole("heading", { name: "Logistics", exact: true }).waitFor();
  await wait(1000); mark("logistics-page", "shipment control");
  const first = (await run()).shipments[0].trackingCode;
  const row = page.getByRole("row", { name: new RegExp(first) });
  for (const status of ["Dispatched", "In transit", "Delivered"]) { await click(row.getByRole("button", { name: status }), `shipment ${status}`); await wait(700); }
  await scrollTo(900, 1200); await wait(2200); mark("routes", "routes on the map");
  await scrollTo(0, 700);

  // 8. The audit trail.
  await page.goto("/#/audit");
  await page.getByText("Hash chain intact").waitFor();
  await wait(1000); mark("audit", "hash chain intact");
  await scrollTo(500, 1200); await wait(1800);

  // 9. Back home, with the network lit up.
  await page.goto("/");
  await wait(1200); mark("command-center-after", "dashboard after the response");
  await scrollTo(1250, 1600); await wait(2200);
  mark("end");
} catch (error) {
  mark("error", String(error.message || error).slice(0, 200));
  console.error(error);
} finally {
  const mainPath = await page.video()?.path();
  await context.close();
  await browser.close();
  await writeFile(path.join(OUT, "beats.json"), JSON.stringify({ recordedAt: new Date().toISOString(), beats }, null, 2));
  const { stat } = await import("node:fs/promises");
  const tryRename = async (from, to) => { for (let attempt = 0; attempt < 10; attempt++) { try { await rename(from, to); return true; } catch { await new Promise((resolve) => setTimeout(resolve, 500)); } } return false; };
  if (mainPath) await tryRename(mainPath, path.join(OUT, "main.webm"));
  const others = (await readdir(OUT)).filter((name) => name.endsWith(".webm") && name !== "main.webm" && !name.startsWith("popup-"));
  const sized = (await Promise.all(others.map(async (name) => ({ name, size: (await stat(path.join(OUT, name))).size })))).sort((a, b) => b.size - a.size);
  for (const [index, item] of sized.entries()) await tryRename(path.join(OUT, item.name), path.join(OUT, `popup-${index + 1}.webm`));
  console.log(`wrote ${OUT}/main.webm, ${sized.length} popup video(s) and beats.json`);
}
