// Serves the five independent sites, each on its own origin, with the official
// serve_site.mjs (which sends the CORS header on the public agent files only).
//
//   node scripts/serve-all.mjs                   all five sites + the inspector
//   node scripts/serve-all.mjs --skip command    partners only (run Command with `vite dev`)
//   node scripts/serve-all.mjs --log             write one JSON line per request to .serve-logs/
//
// Each site is a separate process on a separate port: they share nothing but the browser.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { abs, readOrigins, SITES, SKILL } from "./lib/sites.mjs";

const args = process.argv.slice(2);
const skip = new Set();
for (let i = 0; i < args.length; i++) if (args[i] === "--skip") skip.add(args[i + 1]);
const withLog = args.includes("--log");
const server = path.join(SKILL, "scripts", "serve_site.mjs");
const { profile, active } = await readOrigins();

const targets = [
  ...SITES.map((site) => ({ id: site.id, label: site.label, folder: site.serve, origin: profile[site.id], fallbackPort: site.port })),
  { id: "inspector", label: "Interoperability Inspector", folder: "tools/inspector", origin: "http://localhost:8090", fallbackPort: 8090 },
];

if (withLog) mkdirSync(abs(".serve-logs"), { recursive: true });
const children = [];

for (const target of targets) {
  if (skip.has(target.id)) continue;
  const folder = abs(target.folder);
  if (!existsSync(folder)) {
    console.error(`SKIP ${target.label}: ${target.folder} does not exist${target.id === "command" ? " (run: npm run build)" : ""}.`);
    continue;
  }
  let url;
  try { url = new URL(target.origin); } catch { url = new URL(`http://localhost:${target.fallbackPort}`); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  // Under a production profile the published files name https origins; serve locally anyway.
  const port = local && url.port ? url.port : String(target.fallbackPort);
  const host = url.hostname === "[::1]" ? "::1" : "127.0.0.1";
  const openAs = local ? url.hostname.replace(/^\[|\]$/g, "") : "localhost";
  const childArgs = [server, folder, "--host", host, "--port", port];
  if (host !== "::1") childArgs.push("--open-as", openAs);
  if (withLog) childArgs.push("--log", abs(".serve-logs", `${target.id}.jsonl`));
  const child = spawn(process.execPath, childArgs, { stdio: ["ignore", "pipe", "pipe"] });
  const tag = `[${target.id}]`.padEnd(17);
  child.stdout.on("data", (chunk) => process.stdout.write(String(chunk).split("\n").filter(Boolean).map((line) => `${tag}${line}\n`).join("")));
  child.stderr.on("data", (chunk) => process.stderr.write(String(chunk).split("\n").filter(Boolean).map((line) => `${tag}${line}\n`).join("")));
  child.on("exit", (code) => { if (code) console.error(`${tag}exited with code ${code}`); });
  children.push(child);
}

console.log(`Origins profile: ${active}. Press Ctrl+C to stop all servers.`);
const stop = () => { for (const child of children) child.kill(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
