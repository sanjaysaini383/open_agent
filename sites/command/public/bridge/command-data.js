// What ReliefMesh Command's bridge can see. The bridge frame and the confirmation window
// have no dashboard, so this small module reads the dashboard's saved state directly and
// keeps the assistance-request inbox. No DOM, so Node tests can import it.
//
// SIMULATED DEMONSTRATION DATA: the seeded incident describes no real event.

export class CommandData {
  static NOTICE = "Simulated demonstration data. Not a real incident, and no real people or organisations.";
  static SELF = "http://localhost:8080";
  static STATE_KEY = "reliefmesh-command-v1";
  static INBOX_KEY = "reliefmesh-command-inbox-v1";

  /** Sites allowed to file an assistance request. Exact origins; a write is never shared with "*". */
  static WRITE_CALLERS = [
    "http://localhost:8081",
    "http://localhost:8082",
    "http://localhost:8083",
    "http://localhost:8084",
  ];

  static PARTNERS = [
    { label: "ShelterConnect", role: "shelter", networkUrl: "http://localhost:8081/shelterconnect", page: "http://localhost:8081/" },
    { label: "AidSupply Network", role: "supplier", networkUrl: "http://localhost:8082/aidsupply", page: "http://localhost:8082/" },
    { label: "TrustRegistry", role: "trust", networkUrl: "http://localhost:8083/trustregistry", page: "http://localhost:8083/" },
    { label: "RouteBridge", role: "logistics", networkUrl: "http://localhost:8084/routebridge", page: "http://localhost:8084/" },
  ];

  static CAPABILITIES = [
    { id: "needs_assessment", title: "Needs assessment", description: "Reads shelter requirements and stock and ranks every request by documented priority." },
    { id: "partner_discovery", title: "Partner discovery", description: "Loads partner sites' public manifests and network definitions by URL." },
    { id: "trust_verification", title: "Trust verification", description: "Checks identity records and verifies signed attestations before a partner's data is used." },
    { id: "offer_comparison", title: "Offer comparison and negotiation", description: "Compares supplier offers and requests non-binding quotes." },
    { id: "resource_allocation", title: "Resource allocation", description: "Assigns supplier stock to shelters within a budget, with reasons, using a deterministic engine." },
    { id: "logistics_coordination", title: "Logistics coordination", description: "Matches shipments with transport providers and tracks delivery." },
    { id: "assistance_requests", title: "Assistance requests", description: "Accepts a request for help from a partner site, confirmed by a person in a ReliefMesh window." },
  ];

  static CATEGORIES = ["shelter", "supplier", "logistics", "other"];
  static URGENCY = ["low", "medium", "high", "critical"];
  static RESOURCES = ["food_packets", "water_kits", "medical_kits", "blankets"];

  /** The incident a fresh dashboard starts with, for a frame that has no saved state. */
  static SEED_INCIDENT = {
    id: "INC-0001",
    name: "Malda district flood response",
    category: "flood",
    severity: "critical",
    status: "active",
    location: { name: "Malda district, West Bengal (simulated scenario)", lat: 25.14, lng: 87.93 },
    affectedPopulation: 12000,
    shelters: 4,
    requirements: { food_packets: 2000, water_kits: 1000, medical_kits: 300, blankets: 500 },
    deadline: null,
    workflowStage: "not started",
  };

  constructor(storage = CommandData.defaultStorage(), now = () => new Date()) {
    this.storage = storage;
    this.now = now;
  }

  static defaultStorage() {
    try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
  }

  envelope(extra) {
    return { simulated: true, dataNotice: CommandData.NOTICE, source: `${CommandData.SELF}/`, generatedAt: this.now().toISOString(), ...extra };
  }

  readJson(key) {
    try {
      const raw = this.storage?.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  links() {
    const links = { reliefmesh_command: { label: "ReliefMesh Command", page: `${CommandData.SELF}/` } };
    for (const partner of CommandData.PARTNERS) links[partner.networkUrl.split("/").pop()] = { label: partner.label, page: partner.page };
    return links;
  }

  /** Public summary of each open incident. Never includes approvals, receipts or the audit log. */
  activeIncidents() {
    const saved = this.readJson(CommandData.STATE_KEY);
    const state = saved && saved.state ? saved.state : null;
    let incidents = [CommandData.SEED_INCIDENT];
    if (state && Array.isArray(state.incidents)) {
      incidents = state.incidents.filter((incident) => incident && incident.status !== "closed").slice(0, 25).map((incident) => {
        const run = state.runs && state.runs[incident.id];
        const steps = run && run.steps ? Object.values(run.steps) : [];
        const done = steps.filter((step) => step.status === "done" || step.status === "warning").length;
        return {
          id: String(incident.id),
          name: String(incident.name).slice(0, 120),
          category: incident.category,
          severity: incident.severity,
          status: incident.status,
          location: { name: String(incident.location?.name || "").slice(0, 120), lat: incident.location?.lat, lng: incident.location?.lng },
          affectedPopulation: incident.affectedPopulation,
          shelters: incident.shelterCount,
          requirements: incident.requirements,
          deadline: incident.deadline,
          workflowStage: steps.length ? `${done} of ${steps.length} steps complete` : "not started",
        };
      });
    }
    return this.envelope({ incidents, links: this.links() });
  }

  capabilities() {
    return this.envelope({
      capabilities: CommandData.CAPABILITIES,
      partnerNetworks: CommandData.PARTNERS.map(({ label, role, networkUrl }) => ({ label, role, networkUrl })),
      howToRequest: "Call request_assistance with the organisation, a category, the urgency and a one-sentence summary. A person confirms it in a ReliefMesh window.",
      links: this.links(),
    });
  }

  inbox() {
    const list = this.readJson(CommandData.INBOX_KEY);
    return Array.isArray(list) ? list : [];
  }

  /** Read-only check of a request. The write calls it first, and so does the window. */
  checkRequest(args) {
    const organization = String(args.organization || "").trim();
    const summary = String(args.summary || "").trim();
    if (organization.length < 2 || organization.length > 80) return { ok: false, field: "organization", reason: "Give the organisation's name, 2 to 80 characters." };
    if (!CommandData.CATEGORIES.includes(args.category)) return { ok: false, field: "category", reason: `Category must be one of: ${CommandData.CATEGORIES.join(", ")}.` };
    if (!CommandData.URGENCY.includes(args.urgency)) return { ok: false, field: "urgency", reason: `Urgency must be one of: ${CommandData.URGENCY.join(", ")}.` };
    if (summary.length < 10 || summary.length > 280) return { ok: false, field: "summary", reason: "Describe the request in 10 to 280 characters." };
    if (args.resource !== undefined && !CommandData.RESOURCES.includes(args.resource)) return { ok: false, field: "resource", reason: `Resource must be one of: ${CommandData.RESOURCES.join(", ")}.` };
    if (args.quantity !== undefined && (!Number.isInteger(args.quantity) || args.quantity < 1 || args.quantity > 1000000)) return { ok: false, field: "quantity", reason: "Quantity must be a whole number from 1 to 1,000,000." };
    if ((args.resource === undefined) !== (args.quantity === undefined)) return { ok: false, field: "quantity", reason: "Give both a resource and a quantity, or neither." };
    const duplicate = this.inbox().some((item) => item.status === "new" && item.organization === organization && item.summary === summary);
    if (duplicate) return { ok: false, field: "summary", reason: "The same request from this organisation is already waiting. Nothing was added." };
    return { ok: true, organization, summary };
  }

  fileRequest(args, callerOrigin) {
    const check = this.checkRequest(args);
    if (!check.ok) return check;
    const list = this.inbox();
    const reference = `RM-REQ-${String(list.length + 1).padStart(4, "0")}`;
    const entry = {
      reference,
      organization: check.organization,
      category: args.category,
      urgency: args.urgency,
      summary: check.summary,
      resource: args.resource || null,
      quantity: args.quantity || null,
      callerOrigin: typeof callerOrigin === "string" ? callerOrigin : "",
      status: "new",
      receivedAt: this.now().toISOString(),
    };
    try {
      this.storage?.setItem(CommandData.INBOX_KEY, JSON.stringify([...list, entry].slice(-200)));
    } catch {
      throw new Error("The request could not be saved in this browser.");
    }
    return { ok: true, reference, summary: `Assistance request ${reference} filed for ${check.organization}.`, entry };
  }
}
