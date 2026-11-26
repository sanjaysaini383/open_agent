// Agent Interoperability Inspector — the check engine.
//
// Given the URL of an agentic website (its home, the folder that holds
// agent-manifest.json, or a network URL), it reads the site's PUBLIC files the way a
// calling site's browser would, and reports whether another origin could load and run
// its agent network, following the Worldwide Agentic Web MVP specification.
//
// The engine is isomorphic. It never touches `window` or `process`; everything that
// differs between a browser and Node comes in through `env`:
//
//   env.origin        the origin the checks are made FROM (the "caller")
//   env.mode          "browser" (real CORS enforcement) or "node" (headers inspected)
//   env.fetchPublic   (url) -> { ok, status, text, contentType, cors, acao, headers, error }
//   env.runtime       { parseHocon, AgentNetwork, validateNetwork } from the official runtime
//   env.bridgeCatalog optional (bridgeUrl, brand) -> the actions the bridge shares with env.origin
//
// Parsing and validation are done by the official runtime's own modules, so a network
// that passes here is one the reference runtime would accept. Nothing is re-implemented.

export const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
export const INSTRUCTION_BUDGET = 5000;
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/, /\botk_[A-Za-z0-9_-]{16,}\b/, /\bAKIA[0-9A-Z]{16}\b/, /\bghp_[A-Za-z0-9]{30,}\b/,
  /-----BEGIN (RSA |EC |)PRIVATE KEY-----/, /"(api[_-]?key|secret|password|access[_-]?token)"\s*:\s*"[^"<>{}\s]{8,}"/i,
];

function isLoopback(url) {
  try { return LOOPBACK_HOSTS.includes(new URL(url).hostname); } catch { return false; }
}

function originOf(url) {
  try { return new URL(url).origin; } catch { return ""; }
}

/** Resolve a path from a manifest against the site base, as the runtime does. */
function resolveUrl(base, path) {
  if (/^https?:\/\//i.test(path)) return path;
  return base.replace(/\/$/, "") + (path.startsWith("/") ? path : `/${path.replace(/^\.\//, "")}`);
}

class Report {
  constructor(input, env) {
    this.input = input;
    this.origin = env.origin;
    this.mode = env.mode;
    this.generatedAt = new Date().toISOString();
    this.checks = [];
    this.base = "";
    this.networkName = "";
    this.networkUrl = "";
    this.manifest = null;
    this.network = null;
    this.actions = null;
    this.partners = [];
    this.callerAdds = null;
  }

  add(group, id, title, status, detail, fix) {
    this.checks.push({ group, id, title, status, detail, ...(fix ? { fix } : {}) });
    return status;
  }

  finish() {
    const count = (status) => this.checks.filter((check) => check.status === status).length;
    const summary = { pass: count("pass"), warn: count("warn"), fail: count("fail"), info: count("info"), skip: count("skip") };
    summary.verdict = summary.fail ? "not-compatible" : summary.warn ? "compatible-with-warnings" : "compatible";
    summary.headline = summary.fail
      ? `Not interoperable yet: ${summary.fail} check(s) failed.`
      : summary.warn
        ? `Interoperable, with ${summary.warn} warning(s) to review.`
        : "Interoperable: every check passed.";
    return {
      tool: "ReliefMesh Agent Interoperability Inspector",
      specification: "Worldwide Agentic Web MVP Profile 0.3",
      input: this.input, base: this.base, networkName: this.networkName, networkUrl: this.networkUrl,
      checkedFrom: this.origin, mode: this.mode, generatedAt: this.generatedAt,
      summary, checks: this.checks, manifest: this.manifest, network: this.network, actions: this.actions,
      partners: this.partners, callerAdds: this.callerAdds,
    };
  }
}

function describeFetch(result, env) {
  if (result.error) return `could not be fetched (${result.error})`;
  if (!result.ok) return `answered HTTP ${result.status}`;
  if (result.cors === "blocked") return env.mode === "browser" ? "is reachable but the browser blocked the read: no usable Access-Control-Allow-Origin header" : `sends no Access-Control-Allow-Origin header that allows ${env.origin}`;
  return "is readable";
}

function corsFix(file) {
  return `Serve ${file} with "Access-Control-Allow-Origin: *". It is a public file; do not add the header to business endpoints.`;
}

/** Candidate (base, networkName) pairs for whatever URL the person typed. */
export function candidates(input) {
  const url = new URL(input);
  url.hash = "";
  url.search = "";
  const clean = url.href.replace(/\/$/, "");
  const segments = url.pathname.split("/").filter(Boolean);
  const list = [];
  const endsWithFile = /\.(html?|json)$/i.test(url.pathname);
  // 1. The URL is a network URL: its last segment is the network name.
  if (segments.length && !url.pathname.endsWith("/") && !endsWithFile) {
    list.push({ base: new URL("./", url).href.replace(/\/$/, ""), name: segments[segments.length - 1] });
  }
  // 2. The URL is the folder that holds agent-manifest.json (or a page in it).
  list.push({ base: endsWithFile ? new URL("./", url).href.replace(/\/$/, "") : clean, name: "" });
  if (segments.length) list.push({ base: url.origin, name: "" });
  return list.filter((item, index) => list.findIndex((other) => other.base === item.base && other.name === item.name) === index);
}

export async function inspect(input, env) {
  const report = new Report(input, env);
  const { parseHocon, AgentNetwork, validateNetwork } = env.runtime;

  // ---- 1. The URL ----------------------------------------------------------------
  let parsed;
  try { parsed = new URL(input); } catch { parsed = null; }
  if (!parsed || !["http:", "https:"].includes(parsed.protocol)) {
    report.add("address", "url", "URL", "fail", "Enter a full http(s) URL of an agentic website.", "Use the site's address, or its network URL: the folder that holds agent-manifest.json, then the network name.");
    return report.finish();
  }
  if (parsed.protocol === "http:" && !isLoopback(input)) {
    report.add("address", "https", "HTTPS", "fail", "The site is served over plain http. The specification requires HTTPS except on loopback hosts (spec 3.2).", "Host the site with HTTPS.");
  } else {
    report.add("address", "https", "HTTPS", "pass", parsed.protocol === "https:" ? "Served over HTTPS." : "Loopback host: http is acceptable for local development only.");
  }

  // ---- 2. The manifest ------------------------------------------------------------
  let manifest = null;
  let manifestResult = null;
  let chosen = null;
  const tried = [];
  for (const candidate of candidates(input)) {
    const url = `${candidate.base}/agent-manifest.json`;
    const result = await env.fetchPublic(url);
    tried.push(`${url} ${describeFetch(result, env)}`);
    if (result.ok && result.cors !== "blocked" && result.text) {
      try {
        const json = JSON.parse(result.text);
        if (json && Array.isArray(json.networks)) { manifest = json; manifestResult = result; chosen = { ...candidate, url }; break; }
      } catch { /* not a manifest; try the next candidate */ }
    }
    if (result.ok && result.cors === "blocked" && !chosen) chosen = { ...candidate, url, blocked: true };
  }
  if (!manifest) {
    if (chosen?.blocked) {
      report.add("publication", "manifest", "agent-manifest.json is readable from another origin", "fail", `${chosen.url} exists, but another origin's browser cannot read it.`, corsFix("agent-manifest.json"));
    } else {
      report.add("publication", "manifest", "agent-manifest.json is published", "fail", `No agent manifest was found. Tried: ${tried.join("; ")}.`, "Publish agent-manifest.json in the site's base folder, with CORS enabled (spec 3.3).");
    }
    return report.finish();
  }
  report.base = chosen.base;
  report.add("publication", "manifest", "agent-manifest.json is readable from another origin", "pass", `${chosen.url} is readable from ${env.origin}${manifestResult.acao ? ` (Access-Control-Allow-Origin: ${manifestResult.acao})` : ""}.`);
  if (manifestResult.contentType && !/json/i.test(manifestResult.contentType)) {
    report.add("publication", "manifest-type", "Manifest content type", "warn", `Served as "${manifestResult.contentType}", not JSON.`, "Serve it as application/json.");
  }

  // ---- 3. Manifest contents ---------------------------------------------------------
  const networks = manifest.networks.filter((entry) => entry && typeof entry === "object");
  const missing = [];
  networks.forEach((entry, index) => { for (const key of ["name", "front_man", "hocon"]) if (!entry[key] || typeof entry[key] !== "string") missing.push(`networks[${index}].${key}`); });
  if (!networks.length) {
    report.add("manifest", "manifest-fields", "Manifest lists at least one network", "fail", "The manifest's networks array is empty.", "Add an entry with name, front_man and hocon (spec 3.3).");
    return report.finish();
  }
  report.add("manifest", "manifest-fields", "Each network has name, front_man and hocon", missing.length ? "fail" : "pass", missing.length ? `Missing or not a string: ${missing.join(", ")}.` : `${networks.length} network(s): ${networks.map((entry) => entry.name).join(", ")}.`, missing.length ? "Add the missing fields (spec 3.3)." : undefined);

  let entry;
  if (chosen.name) {
    entry = networks.find((item) => item.name === chosen.name);
    report.add("manifest", "network-name", "The requested network is published under that exact name", entry ? "pass" : "fail",
      entry ? `"${chosen.name}" is listed in the manifest.` : `No network named "${chosen.name}". Published: ${networks.map((item) => item.name).join(", ")}. A caller fails closed rather than run a different network (spec 3.2).`,
      entry ? undefined : "Use one of the published names as the last path segment of the network URL.");
    if (!entry) return report.finish();
  } else {
    entry = networks[0];
    report.add("manifest", "network-name", "Network selected", "info", `No network name in the URL, so the first published network, "${entry.name}", was inspected.`);
  }
  report.networkName = entry.name;
  report.networkUrl = `${chosen.base}/${entry.name}`;

  const router = manifest.llm_router || {};
  if (!router.base_url && !router.byok_router) {
    report.add("manifest", "router", "LLM router metadata", "warn", "The manifest names no llm_router. A visitor would have to enter a router by hand.", "Publish llm_router.base_url and byok_router (spec 3.3, tenet 3).");
  } else if (router.mock === true) {
    report.add("manifest", "router", "LLM router metadata", "warn", "llm_router.mock is true: the site answers with a mock model, not real inference.", "Set mock to false for a real site.");
  } else {
    report.add("manifest", "router", "LLM router metadata", "pass", `Default router ${router.base_url || "(none)"}${router.publisher_funded ? ", paid for by the publisher" : ""}; visitor keys go to ${router.byok_router || router.base_url}.`);
  }
  if (router.publisher_funded === true && router.byok_router && router.byok_router === router.base_url) {
    report.add("manifest", "router-separation", "Visitor keys and the publisher's router are separate", "fail", "byok_router equals the publisher-funded base_url, so a visitor's own key would go to the publisher's proxy.", "Use a different byok_router.");
  }

  const policy = manifest.peer_policy || manifest.web_policy || {};
  const allowedPeers = Array.isArray(manifest.allowed_peers) ? manifest.allowed_peers : [];
  const badPeers = allowedPeers.filter((peer) => originOf(peer) !== String(peer).replace(/\/$/, ""));
  if (policy.mode === "open") report.add("manifest", "peer-policy", "Peer policy", "warn", "peer_policy.mode is \"open\": the network may contact any origin.", "Use \"closed\" and list partner origins in allowed_peers.");
  else if (policy.mode === "closed") report.add("manifest", "peer-policy", "Peer policy", "pass", `Closed. Allowed peers: ${allowedPeers.join(", ") || "none"}.`);
  else report.add("manifest", "peer-policy", "Peer policy", "warn", "The manifest states no peer_policy.mode.", "State \"closed\" and list partners in allowed_peers (spec 3.3).");
  if (badPeers.length) report.add("manifest", "peer-origins", "allowed_peers entries are origins", "warn", `Not plain origins: ${badPeers.join(", ")}.`, "List scheme, host and port only, such as https://partner.example.");

  if (manifest.deployment?.mode && manifest.deployment.mode !== "static") {
    report.add("manifest", "deployment", "Deployment mode", "info", `deployment.mode is "${manifest.deployment.mode}". A static bundle needs no server-side runtime.`);
  }

  report.manifest = {
    brand: manifest.brand || "", networks: networks.map((item) => ({ name: item.name, frontAgent: item.front_man, definition: item.hocon, description: item.description || "" })),
    router: { baseUrl: router.base_url || "", byokRouter: router.byok_router || "", mock: router.mock === true, publisherFunded: router.publisher_funded === true },
    peerPolicy: policy.mode || "", allowedPeers, hasActions: !!manifest.actions, agentTools: manifest.actions?.agentTools || [], tags: entry.tags || [],
  };

  // ---- 4. The network definition ------------------------------------------------------
  const definitionUrl = resolveUrl(chosen.base, entry.hocon);
  const definition = await env.fetchPublic(definitionUrl);
  if (!definition.ok || definition.cors === "blocked" || !definition.text) {
    report.add("publication", "definition", "Network definition is readable from another origin", "fail", `${definitionUrl} ${describeFetch(definition, env)}.`, definition.cors === "blocked" ? corsFix(entry.hocon) : "Publish the resolved network definition at the location the manifest declares (spec 3.3).");
    return report.finish();
  }
  report.add("publication", "definition", "Network definition is readable from another origin", "pass", `${definitionUrl} is readable from ${env.origin}.`);

  let network = null;
  try {
    network = new AgentNetwork(parseHocon(definition.text), entry.name);
  } catch (error) {
    report.add("network", "parse", "Network definition parses", "fail", `The official runtime's parser rejected it: ${error.message}`, "Publish valid, fully resolved JSON (or the runtime's HOCON subset). Includes and substitutions must be resolved before publishing (spec 2).");
    return report.finish();
  }
  report.add("network", "parse", "Network definition parses", "pass", "Parsed with the official runtime's parser.");

  const validation = validateNetwork(network);
  report.add("network", "validate", "Network passes the runtime's validation", validation.errors.length ? "fail" : "pass",
    validation.errors.length ? validation.errors.join(" ") : "No malformed agents, missing references or missing front agent.",
    validation.errors.length ? "Fix the errors; a runtime refuses to run a network that fails validation (spec 3.1)." : undefined);

  const agents = Array.isArray(network.config.tools) ? network.config.tools : [];
  const front = (() => { try { return network.findFrontMan(); } catch { return null; } })();
  if (front && front !== entry.front_man) report.add("network", "front", "Front agent matches the manifest", "fail", `The manifest says "${entry.front_man}", but the network's front agent is "${front}".`, "Make them agree.");
  else if (front) report.add("network", "front", "Front agent matches the manifest", "pass", `Front agent: ${front}.`);

  // ---- 5. Agent definitions -----------------------------------------------------------
  const names = agents.map((agent) => agent?.name);
  const duplicates = names.filter((name, index) => name && names.indexOf(name) !== index);
  if (duplicates.length) report.add("agents", "duplicates", "Agent names are unique", "fail", `Duplicate names: ${[...new Set(duplicates)].join(", ")}.`, "Give each agent a unique name (spec 2.1).");

  const referenced = new Set();
  for (const agent of agents) for (const tool of agent?.tools || []) if (typeof tool === "string") referenced.add(tool);
  const problems = { description: [], instructions: [], parameters: [], unreachable: [], long: [], model: [], unsupported: [] };
  const partnerUrls = new Set();
  const mcpUrls = new Set();
  const summary = [];
  for (const agent of agents) {
    if (!agent || typeof agent.name !== "string") continue;
    const description = String(agent.function?.description || "");
    const instructions = String(agent.instructions || "");
    if (description.trim().length < 20) problems.description.push(agent.name);
    if (!agent.class && !agent.toolbox && !instructions.trim()) problems.instructions.push(agent.name);
    const properties = agent.function?.parameters?.properties;
    if (!properties || typeof properties !== "object") problems.parameters.push(agent.name);
    if (agent.name !== front && !referenced.has(agent.name)) problems.unreachable.push(agent.name);
    if (instructions.length > INSTRUCTION_BUDGET) problems.long.push(`${agent.name} (${instructions.length})`);
    if (!agent.llm_config?.model_name && !agent.class && !agent.toolbox) problems.model.push(agent.name);
    if (agent.class || agent.toolbox) problems.unsupported.push(agent.name);
    const tools = [];
    for (const tool of agent.tools || []) {
      const kind = network.classifyTool(tool).kind;
      const ref = typeof tool === "string" ? tool : tool?.url || "";
      tools.push({ ref, kind });
      if (kind === "remote") partnerUrls.add(ref);
      if (kind === "mcp") mcpUrls.add(ref);
    }
    summary.push({ name: agent.name, isFront: agent.name === front, description, instructionChars: instructions.length, tools, model: agent.llm_config?.model_name || "" });
  }
  report.add("agents", "count", "Agents", "info", `${summary.length} agent(s): ${summary.map((agent) => agent.name).join(", ")}.`);
  report.add("agents", "descriptions", "Every agent describes what it does", problems.description.length ? "warn" : "pass", problems.description.length ? `Missing or too short a function.description: ${problems.description.join(", ")}. A caller decides whether to use an agent from this text.` : "Every agent has a function description.", problems.description.length ? "Write one clear sentence per agent (spec 2.1)." : undefined);
  report.add("agents", "instructions", "Every LLM agent has instructions", problems.instructions.length ? "fail" : "pass", problems.instructions.length ? `No instructions: ${problems.instructions.join(", ")}.` : "Every agent has instructions.", problems.instructions.length ? "Add instructions (spec 2.1)." : undefined);
  report.add("agents", "schemas", "Every agent declares an input schema", problems.parameters.length ? "warn" : "pass", problems.parameters.length ? `No function.parameters: ${problems.parameters.join(", ")}.` : "Every agent declares JSON Schema-compatible inputs.", problems.parameters.length ? "Declare function.parameters; a \"request\" string is the usual shape (spec 2.1)." : undefined);
  if (problems.unreachable.length) report.add("agents", "reachable", "Every agent can be called", "warn", `Listed in no agent's tools, so never called: ${problems.unreachable.join(", ")}.`, "Add it to a caller's tools or remove it.");
  if (problems.long.length) report.add("agents", "length", "Instruction size", "warn", `Over ${INSTRUCTION_BUDGET} characters: ${problems.long.join(", ")}. Every model call sends them.`, "Shorten the site's own lines.");
  if (problems.unsupported.length) report.add("agents", "portable", "No server-only tools", "fail", `Uses class or toolbox tools, which do not run in a browser bundle: ${problems.unsupported.join(", ")}.`, "Use a site action or an MCP URL (spec 2.2).");
  if (problems.model.length) report.add("agents", "model", "A default model is named", "warn", `No llm_config.model_name for: ${problems.model.join(", ")}. A caller with no model selected would send a placeholder.`, "Set llm_config.model_name for the network.");
  if (network.config.demo_mode) report.add("agents", "demo", "No demo mode", "fail", "demo_mode is set: agents may invent answers.", "Remove it and ground every agent in tool results.");

  const sampleQueries = network.config.metadata?.sample_queries || entry.sample_queries || [];
  const description = String(entry.description || network.config.metadata?.description || "");
  report.add("agents", "capabilities", "The network describes its capabilities", description.trim().length >= 20 ? "pass" : "warn", description.trim().length >= 20 ? `"${description.slice(0, 140)}${description.length > 140 ? "…" : ""}"` : "No usable description of what the network can do.", description.trim().length >= 20 ? undefined : "Add a one-sentence description to the manifest entry.");
  if (!sampleQueries.length) report.add("agents", "samples", "Sample queries", "warn", "No sample_queries are published.", "Add four to six queries the site can really answer.");

  report.network = { name: entry.name, frontAgent: front || "", description, sampleQueries: sampleQueries.slice(0, 8), agents: summary, cruse: !!network.config.cruse, maxSteps: network.config.max_steps || null };

  // ---- 6. Secrets --------------------------------------------------------------------
  const leaked = SECRET_PATTERNS.filter((pattern) => pattern.test(manifestResult.text) || pattern.test(definition.text));
  report.add("security", "secrets", "No credentials in public files", leaked.length ? "fail" : "pass", leaked.length ? "Text shaped like a credential appears in the manifest or the network definition. These files are public." : "Nothing shaped like a key, token or private key in the manifest or the network definition.", leaked.length ? "Remove it and rotate the credential." : undefined);

  // ---- 7. links.json -----------------------------------------------------------------
  const links = await env.fetchPublic(`${chosen.base}/links.json`);
  if (links.ok && links.cors !== "blocked") {
    let ok = true;
    try { const doc = JSON.parse(links.text); ok = !!doc && typeof doc === "object"; } catch { ok = false; }
    report.add("publication", "links", "links.json", ok ? "pass" : "warn", ok ? "Readable and valid JSON." : "Readable, but not valid JSON.", ok ? undefined : "Publish {\"version\": 1, \"networks\": {…}} (spec 3.3).");
  } else if (links.ok) {
    report.add("publication", "links", "links.json", "warn", "Exists, but another origin's browser cannot read it.", corsFix("links.json"));
  } else {
    report.add("publication", "links", "links.json", Object.keys(network.config.link_slots || {}).length ? "warn" : "info", "Not published. It is only needed for named peer-network links.");
  }

  // ---- 8. Runtime ---------------------------------------------------------------------
  if (env.probe) {
    const runtime = await env.probe(`${chosen.base}/runtime/index.js`);
    report.add("runtime", "runtime", "A browser runtime is published with the site", runtime.reachable ? "pass" : "warn", runtime.reachable ? `${chosen.base}/runtime/index.js is served.` : `No runtime at ${chosen.base}/runtime/index.js. The site may mount its runtime elsewhere; a caller does not need it, but the site's own page does.`, runtime.reachable ? undefined : "Copy the official runtime into the site's runtime/ folder.");
  }

  // ---- 9. Actions and the bridge ------------------------------------------------------
  if (!manifest.actions) {
    report.add("actions", "actions", "Site actions", "info", "The manifest declares no site actions. The network answers from its instructions only.");
  } else {
    if (manifest.actions.version !== 1) report.add("actions", "actions-version", "Action protocol version", "fail", `actions.version is ${JSON.stringify(manifest.actions.version)}; the runtime supports 1.`, "Set actions.version to 1.");
    if (!manifest.actions.bridge) {
      report.add("actions", "bridge", "An action bridge is declared", "fail", "actions.bridge is missing. A caller waits 10 seconds for it, then asks its visitor to open a popup, and the network never runs.", "Add \"bridge\": \"./bridge/action-bridge.html\".");
    } else {
      let bridgeUrl = "";
      try { bridgeUrl = new URL(manifest.actions.bridge, `${chosen.base}/`).href; } catch { bridgeUrl = ""; }
      if (!bridgeUrl || originOf(bridgeUrl) !== originOf(chosen.base)) {
        report.add("actions", "bridge", "The bridge is on the site's own origin", "fail", `actions.bridge resolves to ${bridgeUrl || "an invalid URL"}; it must belong to the publishing origin.`, "Serve the bridge from the site's own origin.");
      } else {
        const bridge = env.probe ? await env.probe(bridgeUrl) : { reachable: true };
        if (!bridge.reachable) {
          report.add("actions", "bridge", "The action bridge page loads", "fail", `${bridgeUrl} could not be loaded.`, "Publish the bridge page the official build writes.");
        } else if (bridge.framingBlocked) {
          report.add("actions", "bridge", "The action bridge can be framed", "fail", `${bridgeUrl} sends ${bridge.framingBlocked}, so a caller cannot load it in a frame.`, "Do not send X-Frame-Options or a frame-ancestors policy for the bridge folder.");
        } else {
          report.add("actions", "bridge", "The action bridge page loads", "pass", `${bridgeUrl} is served and may be framed.`);
        }
        if (env.bridgeCatalog && bridge.reachable) {
          try {
            const catalog = await env.bridgeCatalog(bridgeUrl, manifest.brand);
            report.actions = { sharedWith: env.origin, catalog };
            const writes = catalog.filter((action) => action.effect !== "read");
            report.add("actions", "catalog", `Actions shared with ${env.origin}`, catalog.length ? "pass" : "info", catalog.length ? `${catalog.length} action(s): ${catalog.map((action) => `${action.name} (${action.effect})`).join(", ")}. The list depends on who asks.` : "The bridge answered and shares no actions with this origin. A caller's agents would answer from instructions only.");
            if (writes.length) report.add("security", "open-writes", "Writes are not shared with arbitrary origins", "warn", `This origin (${env.origin}) is offered ${writes.map((action) => action.name).join(", ")}, which change something. If this origin is not a named partner, the write is shared too widely.`, "List exact partner origins in callerOrigins; never \"*\" for a write.");
          } catch (error) {
            report.add("actions", "catalog", "The bridge answers a caller", "fail", `The bridge page loaded but did not complete the handshake: ${error.message}`, "Check that the bridge page loads the runtime's action-bridge.js and that nothing blocks framing.");
          }
        } else if (!env.bridgeCatalog) {
          report.add("actions", "catalog", "Actions shared with a caller", "skip", "Listing shared actions needs a browser: the bridge runs in a frame. Use the web inspector for this check.");
        }
      }
    }
  }

  // ---- 10. Partner networks ------------------------------------------------------------
  const allowedOrigins = allowedPeers.map(originOf);
  for (const url of partnerUrls) {
    const origin = originOf(url);
    const partner = { url, origin, allowed: policy.mode === "open" || allowedOrigins.includes(origin), reachable: false, published: false, note: "" };
    if (!partner.allowed) report.add("partners", `partner-allowed-${url}`, `Partner ${url} is allowed`, "fail", `${origin} is not in allowed_peers, so the runtime refuses to contact it.`, `Add "${origin}" to allowed_peers.`);
    if (new URL(url).protocol === "http:" && !isLoopback(url)) report.add("partners", `partner-https-${url}`, `Partner ${url} uses HTTPS`, "fail", "A partner on a non-loopback host must use https.", "Use the partner's https network URL.");
    else if (isLoopback(url) && !isLoopback(chosen.base)) report.add("partners", `partner-local-${url}`, `Partner ${url} is reachable by visitors`, "fail", "A hosted site names a partner on localhost. No visitor can reach it.", "Replace it with the partner's public https URL, in tools, link_labels and allowed_peers.");
    try {
      const target = new URL(url);
      const partnerBase = new URL("./", target).href.replace(/\/$/, "");
      const name = target.pathname.split("/").filter(Boolean).pop();
      const result = await env.fetchPublic(`${partnerBase}/agent-manifest.json`);
      partner.reachable = result.ok && result.cors !== "blocked";
      if (partner.reachable) {
        try { partner.published = (JSON.parse(result.text).networks || []).some((item) => item.name === name); } catch { partner.published = false; }
        partner.note = partner.published ? "Manifest readable; the named network is published." : `Manifest readable, but it publishes no network named "${name}".`;
      } else partner.note = `Its manifest ${describeFetch(result, env)}.`;
    } catch (error) { partner.note = `Not a valid network URL: ${error.message}`; }
    report.partners.push(partner);
    report.add("partners", `partner-${url}`, `Partner network ${url}`, partner.reachable && partner.published ? "pass" : "warn", partner.note, partner.reachable && partner.published ? undefined : "A call to this partner would fail until it is reachable and publishes that network.");
    if (!network.linkLabels?.[url]) report.add("partners", `partner-label-${url}`, `Partner ${url} has a consent-card label`, "warn", "No link_labels entry: the visitor's consent card would show a bare tool name.", "Add the partner's name under link_labels.");
  }
  if (!partnerUrls.size) report.add("partners", "partners", "Partner networks", "info", "This network calls no other agent network.");
  const unused = allowedOrigins.filter((origin) => origin && ![...partnerUrls, ...mcpUrls].some((url) => originOf(url) === origin));
  if (unused.length) report.add("partners", "unused-peers", "allowed_peers has no unused origins", "warn", `Listed but never called: ${unused.join(", ")}.`, "Remove origins nothing calls.");
  for (const url of mcpUrls) if (!(policy.mode === "open" || allowedOrigins.includes(originOf(url)))) report.add("partners", `mcp-${url}`, `MCP server ${url} is allowed`, "fail", `${originOf(url)} is not in allowed_peers.`, "Add its origin to allowed_peers.");

  // ---- 11. Optional discovery files -----------------------------------------------------
  const wellKnown = await env.fetchPublic(`${chosen.base}/.well-known/nsdeploy.json`);
  report.add("publication", "well-known", "Optional discovery metadata", "info", wellKnown.ok && wellKnown.cors !== "blocked" ? ".well-known/nsdeploy.json is published and readable." : "No readable .well-known/nsdeploy.json. It is optional (spec 3.3).");

  // ---- What a caller adds ---------------------------------------------------------------
  report.callerAdds = {
    allowedPeers: originOf(chosen.base),
    tool: report.networkUrl,
    linkLabel: manifest.brand || entry.name,
    toolName: (new URL(report.networkUrl).pathname.replace(/^\//, "")).replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+/, "").slice(0, 60),
  };
  return report.finish();
}
