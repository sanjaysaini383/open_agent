// Runs the official build_network.mjs for every site.
//
//   node scripts/build-networks.mjs            build <network>.network.json, bridge/, discovery files
//   node scripts/build-networks.mjs --check    the official compliance check; writes nothing
//   node scripts/build-networks.mjs --only aidsupply
//
// Nothing here re-implements the official checks: it only loops over the sites.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { abs, SITES, SKILL } from "./lib/sites.mjs";

const args = process.argv.slice(2);
const check = args.includes("--check");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const builder = path.join(SKILL, "scripts", "build_network.mjs");

let failures = 0;
for (const site of SITES) {
  if (only && site.id !== only) continue;
  const hocon = abs(site.root, `${site.network}.hocon`);
  const manifest = abs(site.root, "agent-manifest.json");
  console.log(`\n=== ${site.label} (${site.network}) ${check ? "— check" : "— build"} ===`);
  const run = spawnSync(process.execPath, [builder, hocon, "--manifest", manifest, ...(check ? ["--check"] : [])], {
    stdio: "inherit",
  });
  if (run.status !== 0) failures += 1;
}

console.log(failures ? `\n${failures} site(s) FAILED the official build${check ? " check" : ""}.` : `\nAll sites passed the official build${check ? " check" : ""}.`);
process.exitCode = failures ? 1 : 0;
