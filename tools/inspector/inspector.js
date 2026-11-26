// Agent Interoperability Inspector — the web front-end.
//
// It supplies the check engine (checks.js) with a browser environment: real CORS
// enforcement through fetch, and the official runtime's own bridge client to ask a
// site's action bridge which actions it shares with this origin. The report is rendered
// with textContent only: everything a remote site says is shown as text, never as HTML.
import { inspect } from "./checks.js";
import { GROUP_LABEL, groups, STATUS_LABEL, toMarkdown } from "./report.js";
import { ActionBridgeClient } from "./runtime/action-transport.js";
import { parseHocon } from "./runtime/hocon.js";
import { AgentNetwork, validateNetwork } from "./runtime/kernel.js";

const $ = (selector) => document.querySelector(selector);

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of [].concat(children)) if (child !== null && child !== undefined) node.append(child.nodeType ? child : document.createTextNode(String(child)));
  return node;
}

/** The browser environment for the check engine. */
function browserEnv() {
  const origin = location.origin;
  return {
    origin,
    mode: "browser",
    runtime: { parseHocon, AgentNetwork, validateNetwork },

    async fetchPublic(url) {
      try {
        // A CORS-mode fetch without credentials: exactly what a calling site's runtime does.
        const response = await fetch(url, { mode: "cors", credentials: "omit", cache: "no-store" });
        return { ok: response.ok, status: response.status, text: await response.text(), contentType: response.headers.get("content-type") || "", cors: "readable", acao: null };
      } catch (error) {
        // The browser hides why. A no-cors probe tells "blocked by CORS" from "not reachable".
        try {
          await fetch(url, { mode: "no-cors", credentials: "omit", cache: "no-store" });
          return { ok: true, status: 0, text: "", contentType: "", cors: "blocked", acao: null };
        } catch {
          return { ok: false, status: 0, text: "", contentType: "", cors: "unknown", acao: null, error: "network error or the host is unreachable" };
        }
      }
    },

    async probe(url) {
      try {
        await fetch(url, { mode: "no-cors", credentials: "omit", cache: "no-store" });
        // An opaque response hides headers, so framing is tested by the bridge handshake itself.
        return { reachable: true, framingBlocked: "" };
      } catch {
        return { reachable: false, framingBlocked: "" };
      }
    },

    /** Ask the site's bridge, with the official runtime's client, what it shares with this origin. */
    async bridgeCatalog(bridgeUrl, brand) {
      const client = new ActionBridgeClient(bridgeUrl, brand);
      try {
        await client.connect(false);
        const catalog = await client.request("catalog");
        if (!Array.isArray(catalog)) throw new Error("The bridge returned no catalogue.");
        return catalog.slice(0, 100).map((action) => ({ name: String(action.name), effect: String(action.effect), description: String(action.description || "").slice(0, 400), availability: String(action.availability || "") }));
      } finally {
        client.dispose();
      }
    },
  };
}

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = el("a", { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderReport(report) {
  const root = $("#report");
  const verdict = { compatible: "Interoperable", "compatible-with-warnings": "Interoperable, with warnings", "not-compatible": "Not interoperable yet" }[report.summary.verdict];
  const stamp = report.generatedAt.slice(0, 19).replace(/[:T]/g, "-");
  const host = (() => { try { return new URL(report.input).host.replace(/[^a-z0-9.-]/gi, "_"); } catch { return "site"; } })();

  const head = el("div", { class: `verdict verdict-${report.summary.verdict}` }, [
    el("div", {}, [el("h2", { text: verdict }), el("p", { text: report.summary.headline })]),
    el("div", { class: "counts" }, ["pass", "warn", "fail", "info"].map((status) => el("span", { class: `pill pill-${status}`, text: `${report.summary[status]} ${STATUS_LABEL[status].toLowerCase()}` }))),
  ]);

  const facts = el("dl", { class: "facts" }, [
    el("dt", { text: "Inspected" }), el("dd", { text: report.input }),
    el("dt", { text: "Network URL" }), el("dd", {}, [el("code", { text: report.networkUrl || "not resolved" })]),
    el("dt", { text: "Checked from" }), el("dd", { text: `${report.checkedFrom} — a browser on another origin, with CORS enforced` }),
    el("dt", { text: "Specification" }), el("dd", { text: report.specification }),
  ]);

  const actions = el("div", { class: "actions" }, [
    el("button", { type: "button", onclick: () => download(`interop-report-${host}-${stamp}.md`, toMarkdown(report), "text/markdown;charset=utf-8"), text: "Download report (Markdown)" }),
    el("button", { type: "button", class: "secondary", onclick: () => download(`interop-report-${host}-${stamp}.json`, JSON.stringify(report, null, 2), "application/json"), text: "Download JSON" }),
    el("button", { type: "button", class: "secondary", onclick: async (event) => { try { await navigator.clipboard.writeText(`${location.origin}${location.pathname}?url=${encodeURIComponent(report.input)}`); event.target.textContent = "Link copied"; } catch { event.target.textContent = "Copy failed"; } }, text: "Copy link to this check" }),
  ]);

  const sections = groups(report).map(({ group, checks }) => el("section", { class: "panel" }, [
    el("h3", { text: GROUP_LABEL[group] || group }),
    el("ul", { class: "checks" }, checks.map((check) => el("li", { class: `check check-${check.status}` }, [
      el("span", { class: `pill pill-${check.status}`, text: STATUS_LABEL[check.status] }),
      el("div", {}, [
        el("strong", { text: check.title }),
        el("p", { text: check.detail }),
        check.fix ? el("p", { class: "fix" }, [el("b", { text: "Fix: " }), check.fix]) : null,
      ]),
    ]))),
  ]));

  const extras = [];
  if (report.network) {
    extras.push(el("section", { class: "panel" }, [
      el("h3", { text: `Agents in ${report.network.name}` }),
      el("div", { class: "table-wrap" }, [el("table", {}, [
        el("thead", {}, [el("tr", {}, ["Agent", "What it does", "May call"].map((text) => el("th", { text })))]),
        el("tbody", {}, report.network.agents.map((agent) => el("tr", {}, [
          el("td", {}, [el("code", { text: agent.name }), agent.isFront ? el("span", { class: "pill pill-info", text: "front" }) : null]),
          el("td", { text: agent.description || "—" }),
          el("td", {}, agent.tools.length ? agent.tools.map((tool) => el("div", {}, [el("code", { text: tool.ref }), ` ${tool.kind}`])) : "—"),
        ]))),
      ])]),
      report.network.sampleQueries.length ? el("div", {}, [el("h4", { text: "Sample queries" }), el("ul", {}, report.network.sampleQueries.map((query) => el("li", { text: query })))]) : null,
    ]));
  }
  if (report.actions) {
    extras.push(el("section", { class: "panel" }, [
      el("h3", { text: `Actions shared with ${report.actions.sharedWith}` }),
      report.actions.catalog.length
        ? el("div", { class: "table-wrap" }, [el("table", {}, [
          el("thead", {}, [el("tr", {}, ["Action", "Effect", "Description"].map((text) => el("th", { text })))]),
          el("tbody", {}, report.actions.catalog.map((action) => el("tr", {}, [el("td", {}, [el("code", { text: action.name })]), el("td", { text: action.effect === "read" ? "read (hidden frame)" : `${action.effect} (the site's own window)` }), el("td", { text: action.description })]))),
        ])])
        : el("p", { text: "None. The list depends on which origin asks; this origin is not one the site shares actions with." }),
    ]));
  }
  if (report.callerAdds) {
    extras.push(el("section", { class: "panel" }, [
      el("h3", { text: "To call this network from your site" }),
      el("pre", { text: [`allowed_peers in agent-manifest.json:  "${report.callerAdds.allowedPeers}"`, `tools of the calling agent:            "${report.callerAdds.tool}"`, `link_labels in the .hocon:             "${report.callerAdds.tool}": "${report.callerAdds.linkLabel}"`, `tool name the model sees:              ${report.callerAdds.toolName}`].join("\n") }),
    ]));
  }

  root.replaceChildren(el("section", { class: "panel" }, [head, facts, actions]), ...sections, ...extras);
  root.hidden = false;
}

async function run(url) {
  const status = $("#status");
  const button = $("#run");
  $("#form-error").hidden = true;
  $("#report").hidden = true;
  status.hidden = false;
  status.textContent = `Reading ${url} from ${location.origin}…`;
  button.disabled = true;
  try {
    const report = await inspect(url, browserEnv());
    status.hidden = true;
    renderReport(report);
    history.replaceState(null, "", `${location.pathname}?url=${encodeURIComponent(url)}`);
    window.__inspector = { report };
  } catch (error) {
    status.textContent = `The inspection could not complete: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}

function start() {
  $("#origin").textContent = location.origin;
  const input = $("#url");
  $("#inspect-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const value = input.value.trim();
    let parsed = null;
    try { parsed = new URL(value); } catch { parsed = null; }
    if (!parsed || !["http:", "https:"].includes(parsed.protocol)) {
      const error = $("#form-error");
      error.textContent = "Enter a full URL that starts with http:// or https://.";
      error.hidden = false;
      input.focus();
      return;
    }
    void run(parsed.href);
  });

  // On a development machine, offer the sites that are usually running locally.
  if (["localhost", "127.0.0.1"].includes(location.hostname)) {
    const examples = $("#examples");
    const local = ["http://localhost:8080/reliefmesh_command", "http://localhost:8081/shelterconnect", "http://localhost:8082/aidsupply", "http://localhost:8083/trustregistry", "http://localhost:8084/routebridge"];
    examples.append(el("span", { text: "Local sites: " }), ...local.map((url) => el("button", { type: "button", class: "chip", text: new URL(url).pathname.slice(1), onclick: () => { input.value = url; void run(url); } })));
    examples.hidden = false;
  }

  const preset = new URLSearchParams(location.search).get("url");
  if (preset) {
    input.value = preset;
    try { void run(new URL(preset).href); } catch { /* the form shows the problem when submitted */ }
  }
}

start();
