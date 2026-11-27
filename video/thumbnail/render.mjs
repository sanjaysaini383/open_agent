// Renders video/thumbnail/thumbnail.html to the two files a video upload needs:
//   reliefmesh-thumbnail.png       1920x1080 master
//   reliefmesh-thumbnail-1280.jpg  1280x720, under YouTube's 2 MB limit
// Every image in the thumbnail is a crop of the real product: assets/command.png is the
// top of docs/screenshots/14-command-center-after.png; assets/hostile.png is the excluded
// supplier card from the demo recording at 131 s.
//   node video/thumbnail/render.mjs
import { chromium } from "@playwright/test";
import { stat } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(pathToFileURL(path.join(dir, "thumbnail.html")).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const master = path.join(dir, "reliefmesh-thumbnail.png");
await page.screenshot({ path: master });

const small = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await small.goto(pathToFileURL(path.join(dir, "thumbnail.html")).href, { waitUntil: "networkidle" });
await small.evaluate(() => { document.body.style.zoom = String(1280 / 1920); return document.fonts.ready; });
const youtube = path.join(dir, "reliefmesh-thumbnail-1280.jpg");
await small.screenshot({ path: youtube, type: "jpeg", quality: 90 });
await browser.close();

for (const file of [master, youtube]) console.log(`${path.basename(file)}  ${((await stat(file)).size / 1024).toFixed(0)} KB`);
