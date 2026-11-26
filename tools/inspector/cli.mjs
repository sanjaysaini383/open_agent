#!/usr/bin/env node
// Agent Interoperability Inspector — command line.
//
//   node tools/inspector/cli.mjs <site or network URL> [--origin <caller origin>]
//        [--json] [--md <file>] [--skill <agentify-website folder>] [--no-official]
//
// It runs two things and merges them into one report:
//
//   1. The OFFICIAL checker, check_partner.mjs from the agentic-web repository, unchanged.
//      Its errors and warnings appear in the report under "Official checker".
//   2. The inspector's own checks (checks.js), which add what the official script does not
//      report as findings: manifest field checks, agent definitions and capability
//      descriptions, partner-network reachability, secrets in public files, and more.
//
// Node's fetch does not enforce CORS, so each request sends an Origin header and the
// Access-Control-Allow-Origin header is read back. For a check in a real browser, with
// real CORS enforcement and the action bridge's live catalogue, use the web inspector.
//
// Exit code: 0 no failures, 1 at least one failed check, 2 bad arguments.
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspect } from "./checks.js";
import { toMarkdown, toText } from "./report.js";
import { parseHocon } from "./runtime/hocon.js";
import { AgentNetwork, validateNetwork } from "./runtime/kernel.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const USAGE = "Usage: node cli.mjs <site or network URL> [--origin <caller origin>] [--json] [--md <file>] [--skill <agentify-website folder>] [--no-official]";
/** Stands for "any other site": .example is never a real site. */
export const ANY_SITE = "https://caller.example";

export function parseArgs(argv) {
  const options = { url: null, origin: null, json: false, md: null, skill: null, official: true };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--no-official") options.official = false;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (["--origin", "--md", "--skill"].includes(arg)) {
      const value = argv[++index];
      if (!value) throw new Error(`${arg} needs a value.`);
      options[arg.slice(2)] = value;
    } else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}.`);
    else if (!options.url) options.url = arg;
    else throw new Error(`Unexpected argument ${arg}.`);
  }
  if (options.origin) {
    let origin;
    try { origin = new URL(options.origin).origin; } catch { throw new Error("--origin must be an origin, such as https://my-site.example."); }
    options.origin = origin;
  }
  return options;
}

/** The environment the check engine needs, for Node. */
export function nodeEnv(origin, fetchImpl = fetch) {
  const corsOf = (response) => {
    const acao = response.headers.get("access-control-allow-origin");
    return { acao, cors: acao === "*" || acao === origin ? "readable" : "blocked" };
  };
  return {
    origin,
    mode: "node",
    runtime: { parseHocon, AgentNetwork, validateNetwork },
    async fetchPublic(url) {
      try {
        const response = await fetchImpl(url, { headers: { Origin: origin, Accept: "application/json, */*" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
        const text = await response.text();
        return { ok: response.ok, status: response.status, text, contentType: response.headers.get("content-type") || "", ...corsOf(response) };
      } catch (error) {
        return { ok: false, status: 0, text: "", contentType: "", cors: "unknown", acao: null, error: error.cause?.code || error.message };
      }
    },
    async probe(url) {
      try {
        const response = await fetchImpl(url, { headers: { Origin: origin }, redirect: "follow", signal: AbortSignal.timeout(15000) });
        await response.arrayBuffer();
        const frameOptions = response.headers.get("x-frame-options");
        const csp = response.headers.get("content-security-policy") || "";
        const ancestors = /frame-ancestors\s+([^;]+)/i.exec(csp);
        let framingBlocked = "";
        if (frameOptions) framingBlocked = `X-Frame-Options: ${frameOptions}`;
        else if (ancestors && !/\*|https?:/.test(ancestors[1])) framingBlocked = `Content-Security-Policy frame-ancestors ${ancestors[1].trim()}`;
        return { reachable: response.ok, status: response.status, framingBlocked };
      } catch {
        return { reachable: false, status: 0, framingBlocked: "" };
      }
    },
  };
}

function findOfficialChecker(skill) {
  const places = [skill, process.env.AGENTIFY_SKILL_DIR, path.join(HERE, "..", "..", "vendor", "agentify-website"), path.join(HERE, "agentify-website")].filter(Boolean);
  for (const place of places) {
    const file = path.join(place, "scripts", "check_partner.mjs");
    if (existsSync(file)) return file;
  }
  return null;
}

/** Run the official check_partner.mjs, unchanged, and turn its findings into report checks. */
export async function runOfficialChecker(networkUrl, origin, skill, fetchImpl = fetch) {
  const file = findOfficialChecker(skill);
  if (!file) {
    return [{ group: "official", id: "official", title: "Official checker", status: "skip", detail: "check_partner.mjs was not found. Pass --skill <agentify-website folder> or set AGENTIFY_SKILL_DIR to run it." }];
  }
  const { PartnerCheck } = await import(pathToFileURL(file).href);
  const lines = [];
  const check = new PartnerCheck({ url: networkUrl, origin: origin === ANY_SITE ? null : origin }, fetchImpl, (line) => lines.push(String(line)));
  let code;
  try { code = await check.run(); } catch (error) { check.errors.push(`The official checker stopped: ${error.message}`); code = 1; }
  const checks = [
    ...check.errors.map((message, index) => ({ group: "official", id: `official-error-${index}`, title: "Official checker error", status: "fail", detail: message })),
    ...check.warnings.map((message, index) => ({ group: "official", id: `official-warning-${index}`, title: "Official checker warning", status: "warn", detail: message })),
  ];
  checks.unshift({
    group: "official", id: "official", title: "check_partner.mjs",
    status: code === 0 ? "pass" : "fail",
    detail: code === 0 ? (lines.filter((line) => line.startsWith("OK:")).pop() || "Passed.") : `Reported ${check.errors.length} error(s).`,
  });
  return checks;
}

export async function main(argv, print = console.log) {
  let options;
  try { options = parseArgs(argv); } catch (error) { print(error.message); print(USAGE); return 2; }
  if (options.help || !options.url) { print(USAGE); return options.help ? 0 : 2; }

  const origin = options.origin || ANY_SITE;
  const report = await inspect(options.url, nodeEnv(origin));
  if (options.official && report.networkUrl) {
    report.checks.push(...await runOfficialChecker(report.networkUrl, origin, options.skill));
    const count = (status) => report.checks.filter((check) => check.status === status).length;
    Object.assign(report.summary, { pass: count("pass"), warn: count("warn"), fail: count("fail"), info: count("info"), skip: count("skip") });
    report.summary.verdict = report.summary.fail ? "not-compatible" : report.summary.warn ? "compatible-with-warnings" : "compatible";
    report.summary.headline = report.summary.fail ? `Not interoperable yet: ${report.summary.fail} check(s) failed.` : report.summary.warn ? `Interoperable, with ${report.summary.warn} warning(s) to review.` : "Interoperable: every check passed.";
  }
  if (options.md) {
    await writeFile(options.md, toMarkdown(report));
    print(`Wrote ${options.md}`);
  }
  print(options.json ? JSON.stringify(report, null, 2) : toText(report));
  return report.summary.fail ? 1 : 0;
}

const startedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (startedDirectly) process.exitCode = await main(process.argv.slice(2));
