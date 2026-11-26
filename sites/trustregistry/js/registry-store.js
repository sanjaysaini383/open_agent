// TrustRegistry's business rules and storage. No DOM here: the page, the assistant's
// actions, the bridge that other agent sites call, and the Node tests all use this class.
//
// The registry has two kinds of state:
//   - the SIGNED documents (attestations.json, trust-keys.json), produced offline by
//     scripts/sign-trust.mjs and published as static files. This class only reads them.
//   - the LIVE state in this origin's storage: status overrides (suspend, revoke),
//     subjects registered on the page (pending, with no attestation) and reports.
//
// Operations validate the whole input first and refuse by RETURNING
// {ok: false, reason, field}; they throw only on unexpected failures.
import { verifyAttestation } from "./canonical.js";
import { RegistryData } from "./registry-data.js";
import { SiteLinks } from "./site-links.js";

export class RegistryStore {
  static STORAGE_KEY = "trustregistry-state-v1";

  /** The two signed documents, fetched once per page or frame. Tests may set this. */
  static documents = null;

  static SUBJECT_ID = /^(net|org):[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/;
  static NETWORK_NAME = /^[A-Za-z][\w-]{0,79}$/;
  static ORGANIZATION_ID = /^ORG-[A-Z0-9][A-Z0-9-]{1,30}$/;
  static LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

  /**
   * :param options.storage: A Storage-like object (localStorage), or null for memory only.
   *   In a bridge frame embedded by a site on another registrable domain, browsers
   *   partition storage, so the frame sees its own copy rather than this site's page's.
   * :param options.now: Clock, injectable for tests.
   * :param options.attestations: The parsed attestations.json, or null when unavailable.
   * :param options.keys: The parsed trust-keys.json, or null when unavailable.
   * :param options.loadError: Why the signed documents could not be loaded, if they could not.
   */
  constructor({ storage = RegistryStore.defaultStorage(), now = () => new Date(), attestations = null, keys = null, loadError = "" } = {}) {
    this.storage = storage;
    this.now = now;
    this.attestations = attestations;
    this.keys = keys;
    this.loadError = loadError;
    this.state = this.load();
  }

  static defaultStorage() {
    try {
      return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
      return null;
    }
  }

  /** Fetch the two signed documents that sit next to this site's pages. Never throws. */
  static async fetchDocuments() {
    const read = async (name) => {
      const response = await fetch(new URL(`../${name}`, import.meta.url), { cache: "no-store" });
      if (!response.ok) throw new Error(`${name} answered ${response.status}`);
      return response.json();
    };
    try {
      const [attestations, keys] = await Promise.all([read("attestations.json"), read("trust-keys.json")]);
      return { attestations, keys, loadError: "" };
    } catch (error) {
      return { attestations: null, keys: null, loadError: `The signed documents could not be loaded: ${error?.message || error}` };
    }
  }

  /** A store with the signed documents loaded. Used by the page and by the bridge frame. */
  static async open(options = {}) {
    RegistryStore.documents ||= RegistryStore.fetchDocuments();
    const documents = await RegistryStore.documents;
    // A failed load is not remembered, so the next call tries again.
    if (documents.loadError) RegistryStore.documents = null;
    return new RegistryStore({ ...documents, ...options });
  }

  static pad(number) {
    return String(number).padStart(4, "0");
  }

  seed() {
    return {
      version: 1,
      seeded: true,
      statusOverrides: {},
      registered: [],
      reports: RegistryData.REPORTS.map((report, index) => ({
        reference: `TR-RPT-${RegistryStore.pad(index + 1)}`,
        ...report,
        status: "open",
      })),
    };
  }

  load() {
    try {
      const raw = this.storage?.getItem(RegistryStore.STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.registered) && Array.isArray(parsed.reports)
          && parsed.statusOverrides && typeof parsed.statusOverrides === "object") return parsed;
      }
    } catch {
      // Unreadable or blocked storage: fall back to the seed.
    }
    return this.seed();
  }

  save() {
    this.state.version += 1;
    this.state.seeded = false;
    try {
      this.storage?.setItem(RegistryStore.STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Storage full or blocked: the change still holds for this page view.
    }
  }

  reset() {
    try { this.storage?.removeItem(RegistryStore.STORAGE_KEY); } catch { /* nothing to clear */ }
    this.state = this.seed();
    return { ok: true, version: this.state.version };
  }

  // ---- helpers -------------------------------------------------------------------

  envelope(extra) {
    return {
      simulated: true,
      dataNotice: RegistryData.NOTICE,
      source: `${SiteLinks.SELF}/`,
      generatedAt: this.now().toISOString(),
      ...extra,
    };
  }

  /** Today's date as YYYY-MM-DD (UTC), the form credential dates use. */
  today() {
    return this.now().toISOString().slice(0, 10);
  }

  issuer() {
    return this.attestations?.issuer || `${SiteLinks.SELF}/trustregistry`;
  }

  /** The signed entry published for a subject, or null. */
  attestationFor(subjectId) {
    const all = this.attestations?.attestations;
    if (!all || typeof all !== "object" || !Object.hasOwn(all, subjectId)) return null;
    const entry = all[subjectId];
    if (!entry || typeof entry !== "object" || !entry.payload || typeof entry.signature !== "string") return null;
    return { payload: entry.payload, signature: entry.signature, kid: entry.kid };
  }

  credentialState(credential) {
    const today = this.today();
    const revokedOn = RegistryData.REVOKED_CREDENTIALS[credential.id];
    if (revokedOn && revokedOn <= today) return "revoked";
    if (credential.validFrom > today) return "not_yet_valid";
    if (credential.validUntil < today) return "expired";
    return "valid";
  }

  credentialsOf(subject) {
    return subject.credentials.map((credential) => ({
      type: credential.type,
      issuer: credential.issuer,
      id: credential.id,
      validFrom: credential.validFrom,
      validUntil: credential.validUntil,
      state: this.credentialState(credential),
    }));
  }

  /**
   * Normalise what a caller gives as a network URL: the folder that holds a site's
   * agent-manifest.json, then the network name.
   *
   * :return: {ok: true, url, name} or {ok: false, reason}.
   */
  static parseNetworkUrl(raw) {
    const text = String(raw ?? "").trim();
    let parsed;
    try { parsed = new URL(text); } catch { return { ok: false, reason: "That is not a URL. A network URL looks like https://site.example/network_name." }; }
    if (!["http:", "https:"].includes(parsed.protocol)) return { ok: false, reason: "A network URL must use http or https." };
    if (parsed.username || parsed.password) return { ok: false, reason: "A network URL must not contain credentials." };
    const path = parsed.pathname.replace(/\/+$/, "");
    const name = path.split("/").filter(Boolean).pop() || "";
    if (!RegistryStore.NETWORK_NAME.test(name)) return { ok: false, reason: "A network URL must end in the network name, such as https://site.example/network_name." };
    return { ok: true, url: `${parsed.origin}${path}`, name, parsed };
  }

  // ---- subjects ------------------------------------------------------------------

  fromSeed(seed, type) {
    const attestation = this.attestationFor(seed.subjectId);
    const override = this.state.statusOverrides[seed.subjectId];
    return {
      subjectId: seed.subjectId,
      type,
      name: seed.name,
      status: override ? override.status : seed.status,
      statusReason: override ? override.reason : (seed.statusReason || ""),
      statusChangedAt: override ? override.at : null,
      baseStatus: attestation?.payload?.status || seed.status,
      attestedStatus: attestation?.payload?.status || null,
      operator: seed.operator || null,
      organizationType: seed.type || null,
      organizationId: seed.organizationId || null,
      networkUrl: attestation?.payload?.networkUrl || null,
      capabilities: Array.isArray(attestation?.payload?.capabilities) ? [...attestation.payload.capabilities] : [],
      registeredAt: seed.registeredAt,
      credentials: seed.credentials,
      reputation: seed.reputation,
      attestation,
      pending: false,
    };
  }

  fromRegistered(item) {
    const override = this.state.statusOverrides[item.subjectId];
    return {
      subjectId: item.subjectId,
      type: item.type,
      name: item.name,
      status: override ? override.status : "pending",
      statusReason: override ? override.reason : "Registered on the page. No signed attestation has been issued yet.",
      statusChangedAt: override ? override.at : null,
      baseStatus: "pending",
      attestedStatus: null,
      operator: item.operator || null,
      organizationType: item.organizationType || null,
      organizationId: item.organizationId || null,
      networkUrl: item.networkUrl || null,
      capabilities: [],
      registeredAt: item.registeredAt,
      credentials: [],
      reputation: null,
      attestation: null,
      pending: true,
    };
  }

  /** Every subject with a registry record: the seeded ones, then those registered on the page. */
  subjects() {
    return [
      ...RegistryData.seededSubjects().map(([seed, type]) => this.fromSeed(seed, type)),
      ...this.state.registered.map((item) => this.fromRegistered(item)),
    ];
  }

  findSubject(subjectId) {
    return this.subjects().find((subject) => subject.subjectId === subjectId) || null;
  }

  /** The status a caller should act on: the worse of the live and the attested status. */
  effectiveStatus(subject) {
    if (!subject) return "unregistered";
    return RegistryData.worseStatus(subject.status, subject.baseStatus);
  }

  recordOf(subject) {
    if (subject.type === "agent_network") {
      return { name: subject.name, status: subject.status, operator: subject.operator, registeredAt: subject.registeredAt, capabilities: [...subject.capabilities] };
    }
    return { name: subject.name, status: subject.status, type: subject.organizationType, registeredAt: subject.registeredAt };
  }

  reportsFor(subjectId) {
    const open = this.state.reports.filter((report) => report.subjectId === subjectId && report.status === "open");
    return {
      open: open.length,
      items: open.map((report) => ({ reference: report.reference, reason: report.reason, reportedAt: report.reportedAt })),
    };
  }

  /** Every report, newest first, for this site's own page. */
  allReports() {
    return this.state.reports.slice().sort((left, right) => String(right.reportedAt).localeCompare(String(left.reportedAt)));
  }

  /** This site's own check of one subject's signature. A caller verifies it independently. */
  async signatureCheck(subject) {
    const checkedBy = "TrustRegistry's own page code. Verify the signature yourself against the registry key.";
    if (!subject?.attestation) return { state: "none", reason: "No signed attestation is published for this subject.", expired: null, kid: null, checkedBy };
    const outcome = await verifyAttestation(subject.attestation, this.keys, { expectedSubjectId: subject.subjectId, now: this.now() });
    return { state: outcome.valid ? "valid" : "invalid", reason: outcome.reason, expired: outcome.expired, kid: outcome.kid, checkedBy };
  }

  /** The signature check of every subject, by subject id. */
  async signatureReport() {
    const report = {};
    for (const subject of this.subjects()) report[subject.subjectId] = await this.signatureCheck(subject);
    return report;
  }

  // ---- reads ---------------------------------------------------------------------

  registryInfo() {
    const subjects = this.subjects();
    const keys = (Array.isArray(this.keys?.keys) ? this.keys.keys : []).map((key) => ({
      kid: key.kid,
      publicKeyJwk: key.publicKeyJwk,
      fingerprint: key.fingerprint,
      createdAt: key.createdAt,
    }));
    return this.envelope({
      stateVersion: this.state.version,
      registry: {
        name: RegistryData.REGISTRY_NAME,
        issuer: this.issuer(),
        simulatedAuthority: true,
        algorithm: RegistryData.ALGORITHM,
        keys,
      },
      counts: {
        agentNetworks: subjects.filter((subject) => subject.type === "agent_network").length,
        organizations: subjects.filter((subject) => subject.type === "organization").length,
        openReports: this.state.reports.filter((report) => report.status === "open").length,
      },
      subjects: subjects.map((subject) => ({
        subjectId: subject.subjectId,
        type: subject.type,
        name: subject.name,
        status: subject.status,
        effectiveStatus: this.effectiveStatus(subject),
        networkUrl: subject.networkUrl,
        organizationId: subject.organizationId,
        attested: Boolean(subject.attestation),
      })),
      attestationsIssuedAt: this.attestations?.issuedAt || null,
      statusRule: "record.status is the registry's live status. Take the worse of it and the attested status (effectiveStatus). No record means unverified.",
      ...(this.loadError ? { warning: this.loadError } : {}),
      links: SiteLinks.asFacts(),
    });
  }

  async verification(subject, subjectId, extra = {}) {
    const checkedOn = this.today();
    if (!subject) {
      return this.envelope({
        found: false,
        subjectId,
        record: null,
        attestation: null,
        reputation: null,
        reports: subjectId ? this.reportsFor(subjectId) : { open: 0, items: [] },
        effectiveStatus: "unregistered",
        credentials: [],
        checkedOn,
        signatureCheck: await this.signatureCheck(null),
        note: "No registry record. Treat this subject as unverified, not as trusted.",
        ...extra,
      });
    }
    return this.envelope({
      found: true,
      subjectId: subject.subjectId,
      record: this.recordOf(subject),
      attestation: subject.attestation,
      reputation: subject.reputation ? structuredClone(subject.reputation) : null,
      reports: this.reportsFor(subject.subjectId),
      effectiveStatus: this.effectiveStatus(subject),
      statusReason: subject.statusReason,
      credentials: this.credentialsOf(subject),
      checkedOn,
      signatureCheck: await this.signatureCheck(subject),
      ...(subject.pending ? { note: "Registered on the registry's page, but no signed attestation has been issued. Treat it as unverified." } : {}),
      ...extra,
    });
  }

  /** Look an agent network up by its full network URL. A matching name at another URL is NOT a match. */
  async verifyAgent(args) {
    const target = RegistryStore.parseNetworkUrl(args?.networkUrl);
    if (!target.ok) return this.verification(null, null, { note: `${target.reason} Nothing was looked up.` });
    const subjects = this.subjects().filter((subject) => subject.type === "agent_network");
    const exact = subjects.find((subject) => subject.networkUrl === target.url);
    if (exact) return this.verification(exact, exact.subjectId, { networkUrl: target.url });
    const sameName = subjects.find((subject) => subject.subjectId === `net:${target.name}`);
    return this.verification(null, null, {
      networkUrl: target.url,
      note: sameName
        ? `No record for this URL. A network named "${target.name}" is registered at a different address, so this URL is not that network. Treat it as unverified.`
        : "No registry record for this URL. Treat the network as unverified, not as trusted.",
    });
  }

  async verifyOrganization(args) {
    const organizationId = String(args?.organizationId ?? "").trim();
    if (!RegistryStore.ORGANIZATION_ID.test(organizationId)) {
      return this.verification(null, null, { note: "An organisation id looks like ORG-SUP-A. Nothing was looked up." });
    }
    const subjectId = `org:${organizationId}`;
    const subject = this.findSubject(subjectId);
    return this.verification(subject && subject.type === "organization" ? subject : null, subjectId, { organizationId });
  }

  /** Look a subject up by its subject id (net:… or org:…). Used by this site's own page. */
  async verifySubject(args) {
    const subjectId = String(args?.subjectId ?? "").trim();
    if (!RegistryStore.SUBJECT_ID.test(subjectId)) return this.verification(null, null, { note: "A subject id looks like net:aidsupply or org:ORG-SUP-A. Nothing was looked up." });
    return this.verification(this.findSubject(subjectId), subjectId);
  }

  reputationOf(args) {
    const subjectId = String(args?.subjectId ?? "").trim();
    if (!RegistryStore.SUBJECT_ID.test(subjectId)) {
      return this.envelope({ found: false, subjectId: null, reputation: null, note: "A subject id looks like net:aidsupply or org:ORG-SUP-A. Nothing was looked up." });
    }
    const subject = this.findSubject(subjectId);
    if (!subject) return this.envelope({ found: false, subjectId, reputation: null, note: "No registry record, so no reputation history." });
    return this.envelope({
      found: true,
      subjectId,
      name: subject.name,
      reputation: subject.reputation ? structuredClone(subject.reputation) : null,
      ...(subject.reputation ? {} : { note: "The subject is registered but has no recorded history yet." }),
    });
  }

  // ---- checks (read-only; every write calls its check first) -----------------------

  checkStatusChange(args) {
    const subjectId = String(args?.subjectId ?? "").trim();
    const subject = this.findSubject(subjectId);
    if (!subject) return { ok: false, field: "subjectId", reason: `No registry record with the id ${subjectId || "(empty)"}.` };
    if (!RegistryData.STATUSES.includes(args.status)) return { ok: false, field: "status", reason: `Status must be one of: ${RegistryData.STATUSES.join(", ")}.` };
    const reason = String(args.reason ?? "").trim();
    if (reason.length < 3 || reason.length > 200) return { ok: false, field: "reason", reason: "Give a reason of 3 to 200 characters." };
    if (subject.status === args.status) return { ok: false, field: "status", reason: `${subject.name} is already ${args.status}.` };
    if (RegistryData.SEVERITY[args.status] < RegistryData.SEVERITY[subject.baseStatus]) {
      return {
        ok: false,
        field: "status",
        reason: subject.pending
          ? `${subject.name} has no signed attestation, so it stays pending until the offline signing step issues one. It can be suspended or revoked.`
          : `The signed attestation for ${subject.name} says ${subject.baseStatus}. A better live status needs a newly signed attestation, which this page cannot issue.`,
      };
    }
    return { ok: true, subject, reason };
  }

  checkRegistration(args) {
    const kind = args?.kind;
    if (!["agent_network", "organization"].includes(kind)) return { ok: false, field: "kind", reason: "Kind must be agent_network or organization." };
    const name = String(args.name ?? "").trim();
    if (name.length < 3 || name.length > 80) return { ok: false, field: "name", reason: "Name must be 3 to 80 characters." };
    const existing = this.subjects();
    if (kind === "agent_network") {
      const raw = String(args.networkUrl ?? "").trim();
      if (!raw) return { ok: false, field: "networkUrl", reason: "An agent network needs its network URL." };
      const target = RegistryStore.parseNetworkUrl(raw);
      if (!target.ok) return { ok: false, field: "networkUrl", reason: target.reason };
      if (target.parsed.search || target.parsed.hash || /\/$/.test(target.parsed.pathname)) {
        return { ok: false, field: "networkUrl", reason: "A network URL ends in the network name, with no \"/\" at the end, no query and no \"#\"." };
      }
      if (target.parsed.protocol !== "https:" && !RegistryStore.LOOPBACK.includes(target.parsed.hostname)) {
        return { ok: false, field: "networkUrl", reason: "A network URL must use https, except on localhost, 127.0.0.1 and [::1]." };
      }
      const subjectId = `net:${target.name}`;
      if (existing.some((subject) => subject.networkUrl === target.url)) return { ok: false, field: "networkUrl", reason: "This network URL is already registered." };
      if (existing.some((subject) => subject.subjectId === subjectId)) return { ok: false, field: "networkUrl", reason: `A network named "${target.name}" is already registered.` };
      const operator = String(args.operator ?? "").trim();
      if (operator.length > 80) return { ok: false, field: "operator", reason: "Operator must be at most 80 characters." };
      return { ok: true, kind, subjectId, name, networkUrl: target.url, operator };
    }
    const organizationId = String(args.organizationId ?? "").trim();
    if (!RegistryStore.ORGANIZATION_ID.test(organizationId)) return { ok: false, field: "organizationId", reason: "An organisation id looks like ORG-SUP-A: ORG-, then capital letters, digits or hyphens." };
    const subjectId = `org:${organizationId}`;
    if (existing.some((subject) => subject.subjectId === subjectId)) return { ok: false, field: "organizationId", reason: `${organizationId} is already registered.` };
    const organizationType = args.organizationType === undefined || args.organizationType === "" ? "other" : args.organizationType;
    if (!RegistryData.ORGANIZATION_TYPES.includes(organizationType)) return { ok: false, field: "organizationType", reason: `Organisation type must be one of: ${RegistryData.ORGANIZATION_TYPES.join(", ")}.` };
    return { ok: true, kind, subjectId, name, organizationId, organizationType };
  }

  checkReport(args) {
    const subjectId = String(args?.subjectId ?? "").trim();
    if (!RegistryStore.SUBJECT_ID.test(subjectId)) return { ok: false, field: "subjectId", reason: "A subject id looks like net:aidsupply or org:ORG-SUP-A." };
    if (!Object.hasOwn(RegistryData.REPORT_REASONS, String(args.reason))) return { ok: false, field: "reason", reason: `Reason must be one of: ${Object.keys(RegistryData.REPORT_REASONS).join(", ")}.` };
    if (typeof args.details !== "string") return { ok: false, field: "details", reason: "Say what happened, in up to 280 characters." };
    const details = args.details.trim();
    if (details.length < 1 || details.length > 280) return { ok: false, field: "details", reason: "Say what happened, in 1 to 280 characters." };
    if (this.state.reports.some((report) => report.status === "open" && report.subjectId === subjectId && report.reason === args.reason && report.details === details)) {
      return { ok: false, field: "details", reason: "The same report is already on file for this subject. Nothing was changed." };
    }
    const subject = this.findSubject(subjectId);
    return { ok: true, subjectId, reason: args.reason, details, subjectName: subject ? subject.name : null };
  }

  // ---- writes --------------------------------------------------------------------

  setSubjectStatus(args) {
    const check = this.checkStatusChange(args);
    if (!check.ok) return check;
    const previousStatus = check.subject.status;
    const seedStatus = check.subject.pending ? "pending" : (RegistryData.seededSubjects().find(([seed]) => seed.subjectId === check.subject.subjectId)?.[0].status);
    if (args.status === seedStatus) {
      // Back to what the registry's own record says: no override is needed.
      delete this.state.statusOverrides[check.subject.subjectId];
    } else {
      this.state.statusOverrides[check.subject.subjectId] = { status: args.status, reason: check.reason, at: this.now().toISOString() };
    }
    this.save();
    return {
      ok: true,
      subjectId: check.subject.subjectId,
      name: check.subject.name,
      status: args.status,
      previousStatus,
      note: "This is the registry's live status. The signed attestation is unchanged until the offline signing step runs; callers take the worse of the two.",
      stateVersion: this.state.version,
    };
  }

  registerSubject(args) {
    const check = this.checkRegistration(args);
    if (!check.ok) return check;
    const item = {
      subjectId: check.subjectId,
      type: check.kind,
      name: check.name,
      registeredAt: this.today(),
    };
    if (check.kind === "agent_network") {
      item.networkUrl = check.networkUrl;
      item.operator = check.operator || "Registered on TrustRegistry (simulated)";
    } else {
      item.organizationId = check.organizationId;
      item.organizationType = check.organizationType;
    }
    this.state.registered.push(item);
    this.save();
    return {
      ok: true,
      subjectId: check.subjectId,
      name: check.name,
      status: "pending",
      note: "Recorded as pending. It has no signed attestation, so callers treat it as unverified until the registry signs one offline.",
      stateVersion: this.state.version,
    };
  }

  /**
   * File a suspicious-agent report. The page's own form and the confirmation window that a
   * partner site opens both call this.
   *
   * :param meta.reportedBy: Who filed it: "this site's page", or the calling site's host.
   */
  fileReport(args, meta = {}) {
    const check = this.checkReport(args);
    if (!check.ok) return check;
    const reference = `TR-RPT-${RegistryStore.pad(this.state.reports.length + 1)}`;
    this.state.reports.push({
      reference,
      subjectId: check.subjectId,
      reason: check.reason,
      details: check.details,
      reportedAt: this.now().toISOString(),
      reportedBy: String(meta.reportedBy || "this site's page").slice(0, 80),
      status: "open",
    });
    this.save();
    const label = RegistryData.REPORT_REASONS[check.reason].toLowerCase();
    return {
      ok: true,
      reference,
      summary: `Report ${reference} filed against ${check.subjectName ? `${check.subjectName} (${check.subjectId})` : check.subjectId} for ${label}.`,
      subjectId: check.subjectId,
      reason: check.reason,
      openReportsForSubject: this.reportsFor(check.subjectId).open,
      stateVersion: this.state.version,
    };
  }

  /** Readable lines for a confirmation screen. Changes nothing. */
  reportSummaryLines(args) {
    const check = this.checkReport(args);
    if (!check.ok) return [];
    return [
      `Subject: ${check.subjectName ? `${check.subjectName} (${check.subjectId})` : `${check.subjectId} — not in the registry`}`,
      `Reason: ${RegistryData.REPORT_REASONS[check.reason]}`,
      `Details: ${check.details}`,
    ];
  }
}
