// Inspector tests. A stand-in fetch serves a known-good site (ShelterConnect's real
// published files, read from disk) at https://good.example, and each test breaks one
// thing to check that the inspector reports exactly that.
// Run: node --test "tools/inspector/tests/*.test.mjs"
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { candidates, inspect } from "../checks.js";
import { ANY_SITE, nodeEnv, parseArgs, runOfficialChecker } from "../cli.mjs";
import { toMarkdown, toText } from "../report.js";

const SITE = new URL("../../../sites/shelterconnect/", import.meta.url);
const read = (file) => readFile(new URL(file, SITE), "utf8");
const BASE = "https://good.example";
const CORS = { "access-control-allow-origin": "*", "content-type": "application/json; charset=utf-8" };

async function goodSite() {
  // The fixture is hosted, so its partner must be too: point it at a hosted partner.
  const localize = (text) => text.replaceAll("http://localhost:8080", "https://partner.example");
  return {
    [`${BASE}/agent-manifest.json`]: { body: localize(await read("agent-manifest.json")), headers: CORS },
    [`${BASE}/shelterconnect.network.json`]: { body: localize(await read("shelterconnect.network.json")), headers: CORS },
    [`${BASE}/links.json`]: { body: await read("links.json"), headers: CORS },
    [`${BASE}/.well-known/nsdeploy.json`]: { body: await read(".well-known/nsdeploy.json"), headers: CORS },
    [`${BASE}/runtime/index.js`]: { body: "export {};", headers: { "content-type": "text/javascript" } },
    [`${BASE}/runtime/action-bridge.js`]: { body: await read("runtime/action-bridge.js"), headers: { "content-type": "text/javascript" } },
    [`${BASE}/bridge/action-bridge.html`]: { body: await read("bridge/action-bridge.html"), headers: { "content-type": "text/html" } },
    [`${BASE}/bridge/agent-manifest.json`]: { body: await read("bridge/agent-manifest.json"), headers: { "content-type": "application/json" } },
    [`${BASE}/bridge/bridge-actions.js`]: { body: await read("bridge/bridge-actions.js"), headers: { "content-type": "text/javascript" } },
    "https://partner.example/agent-manifest.json": { body: JSON.stringify({ networks: [{ name: "reliefmesh_command", front_man: "A", hocon: "./x.json" }] }), headers: CORS },
  };
}

function fakeFetch(files) {
  return async (url) => {
    const entry = files[String(url)];
    if (!entry) return new Response("not found", { status: 404 });
    return new Response(entry.body, { status: entry.status || 200, headers: entry.headers || {} });
  };
}

async function inspectWith(change, url = `${BASE}/shelterconnect`) {
  const files = await goodSite();
  if (change) await change(files);
  return inspect(url, nodeEnv(ANY_SITE, fakeFetch(files)));
}

const status = (report, id) => report.checks.find((check) => check.id === id || check.id.startsWith(id))?.status;
const failed = (report) => report.checks.filter((check) => check.status === "fail").map((check) => check.id);

test("a correctly published site passes every check", async () => {
  const report = await inspectWith();
  assert.deepEqual(failed(report), []);
  assert.equal(report.summary.verdict, "compatible");
  assert.equal(report.networkUrl, `${BASE}/shelterconnect`);
  assert.equal(report.network.frontAgent, "ShelterStatusAgent");
  assert.deepEqual(report.network.agents.map((agent) => agent.name), ["ShelterStatusAgent", "ShelterRequestAgent", "ShelterInventoryAgent"]);
  assert.deepEqual(report.callerAdds, { allowedPeers: BASE, tool: `${BASE}/shelterconnect`, linkLabel: "ShelterConnect Assistant", toolName: "shelterconnect" });
  assert.equal(report.partners[0].published, true);
});

test("the site address, the manifest folder and the network URL all resolve to the same network", async () => {
  for (const url of [`${BASE}/shelterconnect`, BASE, `${BASE}/`, `${BASE}/index.html`]) {
    const report = await inspectWith(null, url);
    assert.equal(report.networkName, "shelterconnect", url);
    assert.deepEqual(failed(report), [], url);
  }
  assert.deepEqual(candidates("https://a.example/agents/transit"), [{ base: "https://a.example/agents", name: "transit" }, { base: "https://a.example/agents/transit", name: "" }, { base: "https://a.example", name: "" }]);
});

test("a manifest without the CORS header fails, and the fix says which header", async () => {
  const report = await inspectWith((files) => { files[`${BASE}/agent-manifest.json`].headers = { "content-type": "application/json" }; });
  assert.deepEqual(failed(report), ["manifest"]);
  assert.match(report.checks.find((check) => check.id === "manifest").fix, /Access-Control-Allow-Origin/);
  assert.equal(report.summary.verdict, "not-compatible");
});

test("a CORS header for one other origin only is not enough for an arbitrary caller", async () => {
  const report = await inspectWith((files) => { files[`${BASE}/agent-manifest.json`].headers = { ...CORS, "access-control-allow-origin": "https://someone-else.example" }; });
  assert.deepEqual(failed(report), ["manifest"]);
});

test("a network definition that another origin cannot read fails", async () => {
  const report = await inspectWith((files) => { files[`${BASE}/shelterconnect.network.json`].headers = {}; });
  assert.deepEqual(failed(report), ["definition"]);
});

test("a network name the manifest does not publish fails closed", async () => {
  const report = await inspectWith(null, `${BASE}/some_other_network`);
  assert.deepEqual(failed(report), ["network-name"]);
  assert.match(report.checks.find((check) => check.id === "network-name").detail, /Published: shelterconnect/);
});

test("a malformed network definition is rejected by the official parser", async () => {
  const report = await inspectWith((files) => { files[`${BASE}/shelterconnect.network.json`].body = "{ \"tools\": [ "; });
  assert.deepEqual(failed(report), ["parse"]);
});

test("a reference to an agent that does not exist fails the runtime's validation", async () => {
  const report = await inspectWith((files) => {
    const network = JSON.parse(files[`${BASE}/shelterconnect.network.json`].body);
    network.tools[0].tools.push("GhostAgent");
    files[`${BASE}/shelterconnect.network.json`].body = JSON.stringify(network);
  });
  assert.ok(failed(report).includes("validate"));
  assert.match(report.checks.find((check) => check.id === "validate").detail, /GhostAgent/);
});

test("a front agent that disagrees with the manifest fails", async () => {
  const report = await inspectWith((files) => {
    const manifest = JSON.parse(files[`${BASE}/agent-manifest.json`].body);
    manifest.networks[0].front_man = "ShelterInventoryAgent";
    files[`${BASE}/agent-manifest.json`].body = JSON.stringify(manifest);
  });
  assert.ok(failed(report).includes("front"));
});

test("plain http on a public host fails; on localhost it is accepted", async () => {
  const files = await goodSite();
  const remapped = Object.fromEntries(Object.entries(files).map(([url, entry]) => [url.replace(BASE, "http://plain.example"), entry]));
  const report = await inspect("http://plain.example/shelterconnect", nodeEnv(ANY_SITE, fakeFetch(remapped)));
  assert.ok(failed(report).includes("https"));
  const local = Object.fromEntries(Object.entries(files).map(([url, entry]) => [url.replace(BASE, "http://localhost:8081"), entry]));
  assert.equal(status(await inspect("http://localhost:8081/shelterconnect", nodeEnv(ANY_SITE, fakeFetch(local))), "https"), "pass");
});

test("a credential in a public file is reported", async () => {
  const report = await inspectWith((files) => {
    const manifest = JSON.parse(files[`${BASE}/agent-manifest.json`].body);
    manifest.llm_router.api_key = "sk-live-abcdefghijklmnopqrstuvwx";
    files[`${BASE}/agent-manifest.json`].body = JSON.stringify(manifest);
  });
  assert.deepEqual(failed(report), ["secrets"]);
});

test("a partner outside allowed_peers fails, and a hosted site naming localhost fails", async () => {
  const notAllowed = await inspectWith((files) => {
    const manifest = JSON.parse(files[`${BASE}/agent-manifest.json`].body);
    manifest.allowed_peers = [];
    files[`${BASE}/agent-manifest.json`].body = JSON.stringify(manifest);
  });
  assert.ok(failed(notAllowed).some((id) => id.startsWith("partner-allowed-")));

  const local = await inspectWith(async (files) => {
    files[`${BASE}/agent-manifest.json`].body = files[`${BASE}/agent-manifest.json`].body.replaceAll("https://partner.example", "http://localhost:8080");
    files[`${BASE}/shelterconnect.network.json`].body = files[`${BASE}/shelterconnect.network.json`].body.replaceAll("https://partner.example", "http://localhost:8080");
  });
  assert.ok(failed(local).some((id) => id.startsWith("partner-local-")));
});

test("an unreachable partner is a warning, not a pass", async () => {
  const report = await inspectWith((files) => { delete files["https://partner.example/agent-manifest.json"]; });
  assert.equal(report.partners[0].reachable, false);
  assert.equal(report.summary.verdict, "compatible-with-warnings");
});

test("a bridge that forbids framing fails", async () => {
  const report = await inspectWith((files) => { files[`${BASE}/bridge/action-bridge.html`].headers = { "content-type": "text/html", "x-frame-options": "DENY" }; });
  assert.deepEqual(failed(report), ["bridge"]);
  assert.match(report.checks.find((check) => check.id === "bridge").detail, /X-Frame-Options: DENY/);
});

test("a manifest with actions but no bridge fails", async () => {
  const report = await inspectWith((files) => {
    const manifest = JSON.parse(files[`${BASE}/agent-manifest.json`].body);
    delete manifest.actions.bridge;
    files[`${BASE}/agent-manifest.json`].body = JSON.stringify(manifest);
  });
  assert.deepEqual(failed(report), ["bridge"]);
});

test("a site with no manifest says where it looked", async () => {
  const report = await inspect("https://nothing.example/some/network", nodeEnv(ANY_SITE, fakeFetch({})));
  assert.deepEqual(failed(report), ["manifest"]);
  assert.match(report.checks.find((check) => check.id === "manifest").detail, /https:\/\/nothing\.example\/some\/agent-manifest\.json/);
});

test("an agent with no description or instructions is reported", async () => {
  const report = await inspectWith((files) => {
    const network = JSON.parse(files[`${BASE}/shelterconnect.network.json`].body);
    network.tools[1].function.description = "";
    network.tools[2].instructions = "";
    files[`${BASE}/shelterconnect.network.json`].body = JSON.stringify(network);
  });
  assert.equal(status(report, "descriptions"), "warn");
  assert.equal(status(report, "instructions"), "fail");
});

test("the browser-only check is marked skipped in Node, never passed", async () => {
  assert.equal(status(await inspectWith(), "catalog"), "skip");
});

test("the official check_partner.mjs runs unchanged and its verdict joins the report", async () => {
  const files = await goodSite();
  const checks = await runOfficialChecker(`${BASE}/shelterconnect`, ANY_SITE, null, fakeFetch(files));
  assert.equal(checks[0].id, "official");
  assert.equal(checks[0].status, "pass", JSON.stringify(checks));
  delete files[`${BASE}/bridge/action-bridge.html`];
  const broken = await runOfficialChecker(`${BASE}/shelterconnect`, ANY_SITE, null, fakeFetch(files));
  assert.equal(broken[0].status, "fail");
  assert.ok(broken.some((check) => check.id.startsWith("official-error")));
});

test("reports render as Markdown and text", async () => {
  const report = await inspectWith((files) => { files[`${BASE}/links.json`].headers = {}; });
  const markdown = toMarkdown(report);
  assert.match(markdown, /^# Agent interoperability report/);
  assert.match(markdown, /\| WARN \| links\.json \|/);
  assert.match(markdown, /`ShelterStatusAgent` \(front\)/);
  assert.match(markdown, /allowed_peers in agent-manifest\.json:\s+"https:\/\/good\.example"/);
  assert.match(toText(report), /\[WARN\] links\.json/);
});

test("command-line arguments are validated", () => {
  assert.deepEqual(parseArgs(["https://x.example/n", "--origin", "https://me.example/path", "--json"]), { url: "https://x.example/n", origin: "https://me.example", json: true, md: null, skill: null, official: true });
  assert.throws(() => parseArgs(["https://x.example/n", "--origin"]), /needs a value/);
  assert.throws(() => parseArgs(["https://x.example/n", "--origin", "nonsense"]), /must be an origin/);
  assert.throws(() => parseArgs(["a", "b"]), /Unexpected argument/);
  assert.throws(() => parseArgs(["--frobnicate"]), /Unknown option/);
});
