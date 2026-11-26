// Runs the official check_partner.mjs on every call path between the five sites.
//
//   node scripts/check-partners.mjs            the sites must be reachable (npm run serve, or deployed)
//
// For each "caller -> callee" edge it checks the callee's network URL with the caller's
// origin, the way the caller's browser would read it. It also checks each site with no
// origin, as any other site on the web would see it. Nothing here re-implements the
// official checker: it only decides which pairs to check.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { networkUrls, readOrigins, SITES, SKILL } from "./lib/sites.mjs";

export const EDGES = [
  ["command", "shelterconnect"],
  ["command", "aidsupply"],
  ["command", "trustregistry"],
  ["command", "routebridge"],
  ["shelterconnect", "command"],
  ["aidsupply", "trustregistry"],
  ["routebridge", "shelterconnect"],
];

const checker = path.join(SKILL, "scripts", "check_partner.mjs");
const { profile, active } = await readOrigins();
const urls = await networkUrls();
const quiet = process.argv.includes("--quiet");

const rows = [];
function check(label, url, origin) {
  const result = spawnSync(process.execPath, [checker, url, ...(origin ? ["--origin", origin] : [])], { encoding: "utf8" });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  const errors = output.split("\n").filter((line) => line.startsWith("ERROR:"));
  const warnings = output.split("\n").filter((line) => line.startsWith("WARNING:"));
  const verdict = output.split("\n").filter((line) => /^(OK:|FAILED)/.test(line)).pop() || "no verdict";
  rows.push({ label, url, origin: origin || "any site", ok: result.status === 0, errors, warnings, verdict });
  if (!quiet) {
    console.log(`${result.status === 0 ? "OK  " : "FAIL"} ${label}`);
    for (const line of [...errors, ...warnings]) console.log(`       ${line}`);
  }
}

console.log(`Origins profile: ${active}\n`);
for (const site of SITES) check(`any site -> ${site.label}`, urls[site.id], null);
for (const [caller, callee] of EDGES) {
  const from = SITES.find((site) => site.id === caller);
  const to = SITES.find((site) => site.id === callee);
  check(`${from.label} -> ${to.label}`, urls[callee], profile[caller]);
}

const failed = rows.filter((row) => !row.ok);
console.log(`\n${rows.length - failed.length} of ${rows.length} call paths passed the official partner check.`);
if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 2));
process.exitCode = failed.length ? 1 : 0;
