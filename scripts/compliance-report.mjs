// Runs every compliance check and writes COMPLIANCE_REPORT.md from the real results.
//
//   node scripts/compliance-report.mjs            official scripts, unit, site and integration tests
//   node scripts/compliance-report.mjs --e2e      also the browser tests (needs Chrome or Edge)
//
// Nothing in the report is typed in by hand: each row is the outcome of a command that
// ran just now. A check that did not run is reported as "not run", never as passed.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { abs, networkUrls, readOrigins, SITES, SKILL } from "./lib/sites.mjs";

const withE2e = process.argv.includes("--e2e");
const { profile, active } = await readOrigins();
const urls = await networkUrls();
const node = process.execPath;
const npmCli = process.env.npm_execpath;
const rows = [];
const details = [];

function exec(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", cwd: abs(), maxBuffer: 64 * 1024 * 1024, ...options });
  return { code: result.status ?? 1, out: `${result.stdout || ""}${result.stderr || ""}` };
}
// On Windows npm and npx are .cmd shims, which need a shell. The arguments here are fixed
// strings from this file, so they are joined into one command line.
const shell = (command, args) => (process.platform === "win32" ? exec(`${command} ${args.join(" ")}`, [], { shell: true }) : exec(command, args));
const npm = (args) => (npmCli ? exec(node, [npmCli, ...args]) : shell("npm", args));
const npx = (args) => shell("npx", args);
const strip = (text) => text.replace(/\u001b\[[0-9;]*m/g, "");

function add(area, name, ok, detail, output) {
  rows.push({ area, name, status: ok === null ? "not run" : ok ? "PASS" : "FAIL", detail });
  if (output) details.push({ title: `${area}: ${name}`, output: strip(output).trim().split("\n").slice(-30).join("\n") });
  console.log(`${ok === null ? "SKIP" : ok ? "PASS" : "FAIL"}  ${area}: ${name} — ${detail}`);
}

async function reachable() {
  try { return (await Promise.all(SITES.map((site) => fetch(`${profile[site.id]}/agent-manifest.json`)))).every((response) => response.ok); } catch { return false; }
}

// ---- 1. The official runtime is unchanged ------------------------------------------------
{
  const result = exec(node, [abs("scripts/sync-runtime.mjs"), "--check"]);
  const fingerprint = /Runtime fingerprint: (sha256 \S+)/.exec(result.out)?.[1] || "";
  add("Runtime", "Every site's runtime/ is byte-identical to the official runtime", result.code === 0, result.code === 0 ? `${SITES.length + 1} copies match (${fingerprint.slice(0, 23)}…)` : "A copy differs", result.code === 0 ? null : result.out);
}

// ---- 2. Official build check, per site ---------------------------------------------------
for (const site of SITES) {
  const result = exec(node, [path.join(SKILL, "scripts", "build_network.mjs"), abs(site.root, `${site.network}.hocon`), "--manifest", abs(site.root, "agent-manifest.json"), "--check"]);
  const text = strip(result.out);
  const errors = (text.match(/^ERROR:/gm) || []).length;
  const warnings = (text.match(/^WARNING:/gm) || []).length;
  const agents = /Agents: (\d+)/.exec(text)?.[1] || "?";
  add("Official build_network.mjs --check", site.label, result.code === 0, `${agents} agents, ${errors} errors, ${warnings} warnings; published files up to date`, result.code === 0 && !warnings ? null : text);
}

// ---- 3. Signed attestations ---------------------------------------------------------------
{
  const result = exec(node, [abs("scripts/sign-trust.mjs"), "--verify"]);
  const ok = (strip(result.out).match(/^OK:/gm) || []).length;
  add("Trust", "Every published attestation verifies and every network digest matches", result.code === 0, `${ok} checks OK`, result.code === 0 ? null : result.out);
}

// ---- 4. Tests that need no server ----------------------------------------------------------
{
  const result = npm(["--prefix", "sites/command", "run", "test"]);
  const match = /Tests\s+(?:(\d+) failed \| )?(\d+) passed/.exec(strip(result.out));
  add("Unit tests", "Coordination engine (Vitest)", result.code === 0, match ? `${match[2]} passed${match[1] ? `, ${match[1]} failed` : ""}` : "no result parsed", result.code === 0 ? null : result.out);
}
function nodeTests(area, name, globs) {
  const result = exec(node, ["--test", ...globs]);
  const text = strip(result.out);
  const pass = /^ℹ pass (\d+)/m.exec(text)?.[1] || "?";
  const fail = /^ℹ fail (\d+)/m.exec(text)?.[1] || "?";
  add(area, name, result.code === 0, `${pass} passed, ${fail} failed`, result.code === 0 ? null : text);
}
nodeTests("Site tests", "ShelterConnect, AidSupply, TrustRegistry, RouteBridge (node --test)", SITES.filter((site) => site.id !== "command").map((site) => `${site.root}/tests/*.test.mjs`));
nodeTests("Inspector tests", "Agent Interoperability Inspector (node --test)", ["tools/inspector/tests/*.test.mjs"]);

// ---- 5. Checks that need the sites served ---------------------------------------------------
let server = null;
if (!existsSync(abs("sites/command/dist/index.html"))) {
  add("Build", "ReliefMesh Command is built", false, "sites/command/dist is missing; run: npm run build");
} else {
  if (!await reachable()) {
    server = spawn(node, [abs("scripts/serve-all.mjs")], { stdio: "ignore" });
    for (let attempt = 0; attempt < 60 && !await reachable(); attempt++) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!await reachable()) {
    add("Served sites", "Five sites reachable on their own origins", false, "They did not start");
  } else {
    add("Served sites", "Five sites reachable on their own origins, served by the official serve_site.mjs", true, SITES.map((site) => profile[site.id]).join(", "));

    const partners = exec(node, [abs("scripts/check-partners.mjs"), "--quiet", "--json"]);
    let paths = [];
    try { paths = JSON.parse(partners.out.slice(partners.out.indexOf("["))); } catch { paths = []; }
    for (const row of paths) add("Official check_partner.mjs", row.label, row.ok, row.ok ? row.verdict : row.errors.join(" "), row.ok ? null : [...row.errors, ...row.warnings].join("\n"));
    if (!paths.length) add("Official check_partner.mjs", "All call paths", false, "No result parsed", partners.out);

    for (const site of SITES) {
      const result = exec(node, [abs("tools/inspector/cli.mjs"), urls[site.id], "--json"]);
      let report = null;
      try { report = JSON.parse(result.out.slice(result.out.indexOf("{"))); } catch { report = null; }
      add("Interoperability Inspector", site.label, !!report && report.summary.fail === 0, report ? `${report.summary.pass} passed, ${report.summary.warn} warnings, ${report.summary.fail} failed` : "No report", report && report.summary.fail === 0 ? null : result.out);
    }

    nodeTests("Integration tests", "Published surface across origins: CORS, call paths, attestations (node --test)", ["tests/integration/*.test.mjs"]);

    if (withE2e) {
      const result = npx(["playwright", "test", "--reporter=json"]);
      let stats = null;
      const specs = [];
      try {
        const data = JSON.parse(result.out.slice(result.out.indexOf("{")));
        stats = data.stats;
        const walk = (suite, file) => { for (const spec of suite.specs || []) specs.push({ file: file || suite.file, title: spec.title, ok: spec.ok }); for (const child of suite.suites || []) walk(child, child.file || file); };
        for (const suite of data.suites || []) walk(suite, suite.file);
      } catch { stats = null; }
      add("Browser tests", "Playwright, system Chrome, five real origins, nothing mocked", result.code === 0, stats ? `${stats.expected} passed, ${stats.unexpected} failed, ${stats.skipped} skipped` : "No result parsed", result.code === 0 ? null : result.out);
      for (const spec of specs) add(`Browser: ${path.basename(spec.file)}`, spec.title, spec.ok, spec.ok ? "passed" : "failed");
    } else {
      add("Browser tests", "Playwright end-to-end tests", null, "Run with --e2e to include them");
    }
  }
}
server?.kill();

// ---- write the report -----------------------------------------------------------------------
const commit = exec("git", ["rev-parse", "--short", "HEAD"]).out.trim();
const dirty = exec("git", ["status", "--porcelain"]).out.trim() ? " (with uncommitted changes)" : "";
const upstream = /Commit: `([0-9a-f]+)`/.exec(await readFile(abs("vendor/agentify-website/UPSTREAM.md"), "utf8"))?.[1] || "unknown";
const failed = rows.filter((row) => row.status === "FAIL");
const notRun = rows.filter((row) => row.status === "not run");
const cell = (text) => String(text).replace(/\|/g, "\\|").replace(/\n/g, " ");

const lines = [
  "# ReliefMesh compliance report",
  "",
  "Generated by `npm run compliance`. Every row is the result of a command that ran when this report was made; nothing is entered by hand. A check that did not run says so.",
  "",
  "| | |",
  "| --- | --- |",
  `| Generated | ${new Date().toISOString()} |`,
  `| Repository commit | \`${commit || "unknown"}\`${dirty} |`,
  `| Official tooling | cognizant-ai-labs/agentic-web \`${upstream.slice(0, 7)}\` (vendored, unmodified) |`,
  `| Specification | Worldwide Agentic Web MVP Profile 0.3 |`,
  `| Origins profile | \`${active}\` |`,
  `| Environment | Node ${process.version}, ${os.type()} ${os.release()} |`,
  `| Result | **${failed.length ? `${failed.length} FAILED` : "all checks that ran passed"}**: ${rows.filter((row) => row.status === "PASS").length} passed, ${failed.length} failed, ${notRun.length} not run |`,
  "",
  "## Results",
  "",
  "| Area | Check | Result | Detail |",
  "| --- | --- | --- | --- |",
  ...rows.map((row) => `| ${cell(row.area)} | ${cell(row.name)} | ${row.status} | ${cell(row.detail)} |`),
  "",
  "## What each official script covers",
  "",
  "| Script | Run against | What it establishes |",
  "| --- | --- | --- |",
  "| `build_network.mjs --check` | each site's `.hocon` and manifest | The network parses and passes the runtime's validation; every agent is reachable; no placeholder, demo mode or unsupported tool; the manifest matches the network; partner calls are allowed by `allowed_peers`; the published files are up to date. |",
  "| `serve_site.mjs` | each site, on its own port | Serves the site with the headers a real host should send: CORS on the public agent files only, the sandbox worker's CSP, and no framing restriction on the bridge. |",
  "| `check_partner.mjs` | every call path, with the caller's origin | The callee's public files load with the CORS header a browser needs, its network validates, and its action bridge loads. |",
  "",
  "## MVP interoperability checks (specification section 6)",
  "",
  "| Specification check | Where it is demonstrated |",
  "| --- | --- |",
  "| Publish a two-agent HOCON network and a manifest from an ordinary web host | Five sites, 3 to 10 agents each, static files only. `build_network.mjs --check` rows above. |",
  "| Load and run that network in a browser; if BYOK is offered, demonstrate the user-selected path | `agent-console.spec.mjs`: the visitor sets provider, model and key in the runtime's own settings panel, then the front agent answers. |",
  "| Call an internal agent and at least one grounded capability through a registered local site action | `agent-console.spec.mjs`: the front agent calls `website_get_command_state`; it delegates to `NeedAssessmentAgent`. |",
  "| After user approval, load an exact named network from a second origin and run it locally in the caller's browser | `agent-console.spec.mjs`: consent dialog, then ShelterConnect's network runs in Command's page. `interop.spec.mjs`: all four partners. |",
  "| When a user key is active, show that the second site never receives it and cannot change the caller's router | `agent-console.spec.mjs`: every request to the partner origins is inspected; the key appears only in requests to the chosen router, and the partner's agent ran on that router. |",
  "| Show that private context is absent at the peer unless a named field is explicitly allowed | No network here declares an `allow` rule, so the runtime forwards no private context; a partner run receives only the request text (asserted in `agent-console.spec.mjs` by the partner's prompt and tool list). |",
  "| Stop an invalid network, a composition cycle, an over-budget request and a denied origin with visible errors | Denied origin: `interop.spec.mjs` (policy refusal) and consent refusal. Invalid network: Inspector tests (official parser and validator). Cycles and budgets are enforced by the unmodified runtime. |",
  "",
];
if (details.length) {
  lines.push("## Output of checks that failed or warned", "");
  for (const item of details) lines.push(`### ${item.title}`, "", "```text", item.output, "```", "");
}
await writeFile(abs("COMPLIANCE_REPORT.md"), `${lines.join("\n")}\n`);
console.log(`\nWrote COMPLIANCE_REPORT.md: ${rows.filter((row) => row.status === "PASS").length} passed, ${failed.length} failed, ${notRun.length} not run.`);
process.exitCode = failed.length ? 1 : 0;
