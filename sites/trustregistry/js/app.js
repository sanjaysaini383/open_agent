// TrustRegistry page. It renders the store and wires the forms. The page's own buttons
// and the assistant's actions (site-actions.js) call the same methods on App.page, so
// both follow one set of rules.
import { RegistryData } from "./registry-data.js";
import { RegistryStore } from "./registry-store.js";
import { SiteLinks } from "./site-links.js";

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

const fmt = (value) => Number(value).toLocaleString("en-IN");
const when = (iso) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
const TYPE_LABEL = { agent_network: "Agent network", organization: "Organisation" };
const SIGNATURE_LABEL = { valid: "signature valid", invalid: "signature INVALID", none: "no attestation" };
const SIGNATURE_CLASS = { valid: "status-verified", invalid: "status-revoked", none: "status-simulated" };
const CREDENTIAL_CLASS = { valid: "status-active", expired: "status-pending", revoked: "status-revoked", not_yet_valid: "status-simulated" };

export class RegistryPage {
  constructor(store) {
    this.store = store;
    this.lastLookup = null;
    this.renderToken = 0;
  }

  // ---- what the assistant reads --------------------------------------------------

  getState() {
    return this.store.registryInfo();
  }

  // ---- operations (page buttons and assistant actions both call these) --------------

  setSubjectStatus(args) { return this.finish(this.store.setSubjectStatus(args), "status"); }
  registerSubject(args) { return this.finish(this.store.registerSubject(args), "register"); }
  fileReport(args) { return this.finish(this.store.fileReport(args, { reportedBy: "this site's page" }), "report"); }
  checkStatusChange(args) { return this.store.checkStatusChange(args); }
  checkRegistration(args) { return this.store.checkRegistration(args); }

  resetDemo() {
    const result = this.store.reset();
    this.say("Demo data restored to the simulated seed. The signed attestations are static files and were not changed.", "ok");
    this.render();
    return result;
  }

  /** Re-render after an operation, and clear that panel's earlier refusal. No focus moves. */
  finish(result, panel) {
    const line = document.querySelector(`#msg-${panel}`);
    if (line) {
      line.textContent = result.ok ? "" : result.reason;
      line.hidden = result.ok;
    }
    if (result.ok) this.render();
    return result;
  }

  say(text, kind) {
    const line = document.querySelector("#page-notice");
    if (line) {
      line.textContent = text;
      line.dataset.kind = kind;
      line.hidden = !text;
    }
  }

  // ---- rendering -----------------------------------------------------------------

  render() {
    this.renderSummary(null);
    this.renderKey();
    this.renderSubjects();
    this.renderReports();
    this.fillSelects();
    if (this.lastLookup) this.lookup(this.lastLookup);
    // The signature of every attestation is checked here, in this browser, each time.
    const token = ++this.renderToken;
    this.store.signatureReport().then((report) => {
      if (token !== this.renderToken) return;
      this.renderSignatures(report);
      this.renderSummary(report);
    }).catch((error) => console.error("Signature check failed", error));
  }

  renderSummary(signatures) {
    const info = this.store.registryInfo();
    const attested = info.subjects.filter((subject) => subject.attested).length;
    const valid = signatures ? Object.values(signatures).filter((check) => check.state === "valid").length : null;
    const tiles = [
      ["Agent networks", fmt(info.counts.agentNetworks)],
      ["Organisations", fmt(info.counts.organizations)],
      ["Open reports", fmt(info.counts.openReports)],
      ["Signatures valid", valid === null ? "checking…" : `${fmt(valid)} / ${fmt(attested)}`],
    ];
    document.querySelector("#summary").replaceChildren(...tiles.map(([label, value]) =>
      el("div", { class: "tile" }, [el("span", { class: "tile-label", text: label }), el("strong", { class: "tile-value", text: value })])));
    const warning = document.querySelector("#load-warning");
    warning.textContent = info.warning || "";
    warning.hidden = !info.warning;
  }

  renderKey() {
    const info = this.store.registryInfo();
    const list = document.querySelector("#key-facts");
    if (!info.registry.keys.length) {
      list.replaceChildren(el("dt", { text: "Key" }), el("dd", { text: "No published key could be loaded. Nothing on this page can be verified." }));
      return;
    }
    const rows = [];
    for (const key of info.registry.keys) {
      rows.push(
        el("dt", { text: "Key id" }), el("dd", {}, [el("code", { text: key.kid })]),
        el("dt", { text: "Algorithm" }), el("dd", { text: `${info.registry.algorithm} — ECDSA on curve P-256 with SHA-256` }),
        el("dt", { text: "Fingerprint" }), el("dd", {}, [el("code", { text: key.fingerprint })]),
        el("dt", { text: "Key created" }), el("dd", { text: when(key.createdAt) }),
      );
    }
    rows.push(
      el("dt", { text: "Issuer" }), el("dd", {}, [el("code", { text: info.registry.issuer })]),
      el("dt", { text: "Attestations signed" }), el("dd", { text: info.attestationsIssuedAt ? when(info.attestationsIssuedAt) : "not available" }),
    );
    list.replaceChildren(...rows);
  }

  renderSubjects() {
    const rows = this.store.subjects().map((subject) => {
      const credentials = this.store.credentialsOf(subject);
      const credentialCell = credentials.length
        ? el("ul", { class: "cred-list" }, credentials.map((credential) => el("li", {}, [
          el("span", { class: `badge ${CREDENTIAL_CLASS[credential.state]}`, text: credential.state.replaceAll("_", " ") }),
          ` ${credential.type}`,
          el("div", { class: "sub", text: `${credential.validFrom} → ${credential.validUntil}` }),
        ])))
        : el("span", { class: "sub", text: "none on record" });
      const effective = this.store.effectiveStatus(subject);
      return el("tr", {}, [
        el("td", { text: TYPE_LABEL[subject.type] }),
        el("td", {}, [
          el("strong", { text: subject.name }),
          el("div", { class: "sub", text: subject.subjectId }),
          subject.networkUrl ? el("div", { class: "sub mono", text: subject.networkUrl }) : null,
        ]),
        el("td", {}, [
          el("span", { class: `badge status-${subject.status}`, text: subject.status }),
          effective !== subject.status ? el("div", { class: "sub", text: `attested: ${subject.baseStatus}` }) : null,
          subject.statusReason ? el("div", { class: "sub", text: subject.statusReason }) : null,
        ]),
        el("td", {}, [credentialCell]),
        el("td", { "data-signature": subject.subjectId }, [el("span", { class: "sub", text: subject.attestation ? "checking…" : "" })]),
      ]);
    });
    document.querySelector("#subject-rows").replaceChildren(...rows);
  }

  renderSignatures(report) {
    for (const cell of document.querySelectorAll("[data-signature]")) {
      const check = report[cell.dataset.signature];
      if (!check) continue;
      const subject = this.store.findSubject(cell.dataset.signature);
      const expires = subject?.attestation?.payload?.expiresAt;
      const parts = [el("span", { class: `badge ${SIGNATURE_CLASS[check.state]}`, text: SIGNATURE_LABEL[check.state] })];
      if (check.state === "valid" && expires) parts.push(el("div", { class: "sub", text: `${check.expired ? "expired" : "expires"} ${String(expires).slice(0, 10)}` }));
      if (check.state === "invalid") parts.push(el("div", { class: "sub short", text: check.reason }));
      cell.replaceChildren(...parts);
    }
  }

  renderReports() {
    const reports = this.store.allReports();
    const body = document.querySelector("#report-rows");
    if (!reports.length) {
      body.replaceChildren(el("tr", {}, [el("td", { colspan: 5, class: "empty", text: "No reports on file." })]));
      return;
    }
    body.replaceChildren(...reports.map((report) => {
      const subject = this.store.findSubject(report.subjectId);
      return el("tr", {}, [
        el("td", { text: report.reference }),
        el("td", {}, [el("strong", { text: subject ? subject.name : "Not in the registry" }), el("div", { class: "sub", text: report.subjectId })]),
        el("td", {}, [el("span", { class: "badge status-flagged", text: RegistryData.REPORT_REASONS[report.reason] || report.reason })]),
        el("td", { text: report.details }),
        el("td", { class: "sub", text: `${when(report.reportedAt)} · ${report.reportedBy === "seed" ? "seeded for the demonstration" : `filed by ${report.reportedBy}`}` }),
      ]);
    }));
  }

  fillSelects() {
    const subjects = this.store.subjects();
    for (const select of document.querySelectorAll("select[data-fill='subjects']")) {
      const current = select.value;
      select.replaceChildren(...subjects.map((subject) => el("option", { value: subject.subjectId, text: `${subject.name} — ${subject.subjectId} (${subject.status})` })));
      if (subjects.some((subject) => subject.subjectId === current)) select.value = current;
    }
    for (const select of document.querySelectorAll("select[data-fill='statuses']")) {
      if (select.options.length) continue;
      select.replaceChildren(...RegistryData.STATUSES.map((status) => el("option", { value: status, text: status })));
      select.value = "suspended";
    }
    for (const select of document.querySelectorAll("select[data-fill='reasons']")) {
      if (select.options.length) continue;
      select.replaceChildren(...Object.entries(RegistryData.REPORT_REASONS).map(([id, label]) => el("option", { value: id, text: label })));
    }
    for (const select of document.querySelectorAll("select[data-fill='org-types']")) {
      if (select.options.length) continue;
      select.replaceChildren(...RegistryData.ORGANIZATION_TYPES.map((type) => el("option", { value: type, text: type })));
      select.value = "other";
    }
    for (const list of document.querySelectorAll("datalist[data-fill='subject-ids']")) {
      list.replaceChildren(...subjects.map((subject) => el("option", { value: subject.networkUrl || subject.organizationId || subject.subjectId })));
    }
  }

  /** Look a subject up from whatever the visitor typed: a network URL, an organisation id or a subject id. */
  async lookup(query) {
    const text = String(query || "").trim();
    const box = document.querySelector("#lookup-result");
    if (!text) {
      this.lastLookup = null;
      box.replaceChildren();
      return null;
    }
    this.lastLookup = text;
    let result;
    if (/^https?:\/\//i.test(text)) result = await this.store.verifyAgent({ networkUrl: text });
    else if (/^(net|org):/.test(text)) result = await this.store.verifySubject({ subjectId: text });
    else result = await this.store.verifyOrganization({ organizationId: text.toUpperCase() });
    if (this.lastLookup !== text) return result;
    box.replaceChildren(this.lookupCard(result, text));
    return result;
  }

  lookupCard(result, query) {
    const card = el("div", { class: "lookup-card" });
    if (!result.found) {
      card.append(
        el("h3", {}, [el("span", { class: "badge status-unverified", text: "unverified" }), ` No record for ${query}`]),
        el("p", { class: "hint", text: result.note || "No registry record. Treat this subject as unverified." }),
      );
    } else {
      const facts = [
        ["Subject", `${result.record.name} (${result.subjectId})`],
        ["Live status", result.record.status],
        ["Status to act on", `${result.effectiveStatus} — the worse of the live and the attested status`],
        ["Registered", result.record.registeredAt],
      ];
      if (result.statusReason) facts.push(["Status note", result.statusReason]);
      if (result.record.operator) facts.push(["Operator", result.record.operator]);
      if (result.record.type) facts.push(["Organisation type", result.record.type]);
      if (result.record.capabilities) facts.push(["Attested capabilities", result.record.capabilities.join(", ") || "none"]);
      if (result.attestation?.payload?.networkDigest) facts.push(["Attested network digest", result.attestation.payload.networkDigest]);
      facts.push(["Signature", `${SIGNATURE_LABEL[result.signatureCheck.state]} — ${result.signatureCheck.reason}`]);
      card.append(el("h3", {}, [el("span", { class: `badge status-${result.effectiveStatus}`, text: result.effectiveStatus }), ` ${result.record.name}`]));
      if (result.note) card.append(el("p", { class: "hint", text: result.note }));
      card.append(el("dl", { class: "facts" }, facts.flatMap(([label, value]) => [el("dt", { text: label }), el("dd", { text: value })])));
      card.append(el("h3", { text: "Credentials" }));
      card.append(result.credentials.length
        ? el("ul", { class: "cred-list" }, result.credentials.map((credential) => el("li", {}, [
          el("span", { class: `badge ${CREDENTIAL_CLASS[credential.state]}`, text: credential.state.replaceAll("_", " ") }),
          ` ${credential.type} · ${credential.issuer} · ${credential.id}`,
          el("div", { class: "sub", text: `${credential.validFrom} → ${credential.validUntil}` }),
        ])))
        : el("p", { class: "hint", text: "No credentials on record." }));
      card.append(el("h3", { text: "Reputation" }));
      if (result.reputation) {
        card.append(
          el("p", { text: `${fmt(result.reputation.completed)} completed · ${fmt(result.reputation.disputes)} disputes · fulfilment ${(result.reputation.fulfilmentRate * 100).toFixed(0)}% · last activity ${result.reputation.lastActivity}` }),
          el("ul", { class: "history" }, result.reputation.history.map((item) => el("li", {}, [el("span", { class: "sub", text: item.date }), ` ${item.event} — `, el("strong", { text: item.outcome })]))),
        );
      } else {
        card.append(el("p", { class: "hint", text: "No history recorded yet." }));
      }
    }
    card.append(el("h3", { text: `Open reports (${result.reports.open})` }));
    card.append(result.reports.open
      ? el("ul", { class: "history" }, result.reports.items.map((item) => el("li", {}, [el("strong", { text: item.reference }), ` ${RegistryData.REPORT_REASONS[item.reason] || item.reason} · `, el("span", { class: "sub", text: when(item.reportedAt) })])))
      : el("p", { class: "hint", text: "None." }));
    return card;
  }

  renderLinks() {
    document.querySelector("#partner-links").replaceChildren(...Object.values(SiteLinks.PAGES).map((partner) => el("li", {}, [
      el("a", { href: partner.page, text: partner.label, rel: "noopener" }), ` — ${partner.purpose}`,
    ])));
    document.querySelector("#network-url").textContent = `${SiteLinks.SELF}/trustregistry`;
  }

  // ---- form wiring ---------------------------------------------------------------

  toggleRegisterFields() {
    const form = document.querySelector("#register-form");
    const network = form.elements.kind.value === "agent_network";
    for (const node of form.querySelectorAll("[data-kind]")) node.hidden = (node.dataset.kind === "agent_network") !== network;
  }

  wire() {
    document.querySelector("#lookup-form").addEventListener("submit", (event) => {
      event.preventDefault();
      this.lookup(event.target.elements.query.value);
    });
    document.querySelector("#report-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.target;
      const result = this.fileReport({ subjectId: form.elements.subjectId.value.trim(), reason: form.elements.reason.value, details: form.elements.details.value });
      if (result.ok) { this.say(result.summary, "ok"); form.elements.details.value = ""; }
    });
    document.querySelector("#status-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.target;
      const result = this.setSubjectStatus({ subjectId: form.elements.subjectId.value, status: form.elements.status.value, reason: form.elements.reason.value });
      if (result.ok) { this.say(`${result.name} is now ${result.status} (was ${result.previousStatus}). Partner sites read the new status on their next look-up.`, "ok"); form.elements.reason.value = ""; }
    });
    const register = document.querySelector("#register-form");
    register.elements.kind.addEventListener("change", () => this.toggleRegisterFields());
    register.addEventListener("submit", (event) => {
      event.preventDefault();
      const network = register.elements.kind.value === "agent_network";
      const args = { kind: register.elements.kind.value, name: register.elements.name.value };
      if (network) {
        args.networkUrl = register.elements.networkUrl.value;
        args.operator = register.elements.operator.value;
      } else {
        args.organizationId = register.elements.organizationId.value.trim().toUpperCase();
        args.organizationType = register.elements.organizationType.value;
      }
      const result = this.registerSubject(args);
      if (result.ok) { this.say(`${result.name} recorded as ${result.subjectId}, pending. It has no signed attestation yet.`, "ok"); register.reset(); this.fillSelects(); this.toggleRegisterFields(); }
    });
    document.querySelector("#reset-demo").addEventListener("click", () => this.resetDemo());
    // A report filed in this site's confirmation window (opened by a partner agent site)
    // lands in the same storage. Pick it up without a reload.
    window.addEventListener("storage", (event) => {
      if (event.key === RegistryStore.STORAGE_KEY || event.key === null) {
        this.store.state = this.store.load();
        this.render();
        this.say("Updated from another window on this site.", "ok");
      }
    });
  }
}

/**
 * The page's entry point. App.page is the single page object; site-actions.js and site.js
 * import this module by the same URL, so they share it.
 */
export class App {
  static page = null;

  static async start() {
    // The signed documents are static files next to the page. The page still works, and
    // says so, when they cannot be loaded.
    App.page = new RegistryPage(await RegistryStore.open());
    App.page.wire();
    App.page.renderLinks();
    App.page.toggleRegisterFields();
    App.page.render();
    return App.page;
  }
}

// Top-level await: modules that import this one (site-actions.js, site.js) run only after
// the page object exists.
if (typeof document !== "undefined") {
  await App.start();
}
