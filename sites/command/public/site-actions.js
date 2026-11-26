// Registers ReliefMesh Command's operations with the agent runtime.
// agent-manifest.json loads this module through "actions.module". Only the names in
// "actions.agentTools" become model tools, called website_<name>.
//
// The dashboard is a bundled app, so this plain module cannot import it. The app
// publishes one page object instead, `globalThis.__reliefmesh.page`, and every action
// here calls a method on it. The dashboard's own buttons call the same methods, so the
// assistant and the manual UI follow one set of rules. No business rule lives here.
//
// Each step tool runs a deterministic workflow step (arithmetic, schema checks, calls to
// partner sites' shared actions). The model reads the result; it never produces it.

const INCIDENT = {
  type: "string",
  maxLength: 40,
  description: "Incident id from website_get_command_state. Leave out for the active incident.",
};
const STEP_INPUT = { type: "object", additionalProperties: false, properties: { incidentId: INCIDENT } };

function page() {
  const current = globalThis.__reliefmesh && globalThis.__reliefmesh.page;
  // A throw is reported to the agent as "unknown outcome", which is right: the dashboard
  // is not ready, so nothing can be said about the step.
  if (!current) throw new Error("The ReliefMesh dashboard has not finished loading.");
  return current;
}

class SiteActions {
  static registerActions(actions) {
    for (const definition of SiteActions.definitions()) actions.register(definition);
  }

  static definitions() {
    return [
      {
        name: "get_command_state",
        description: "Read the incidents, the active incident's workflow steps with their status, headline numbers (shortages, plan cost, shipments, pending approvals) and links to partner sites. Simulated data. Changes nothing. Call it before answering about status, and again in each turn that needs it.",
        effect: "read",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        execute: () => page().getState(),
      },
      {
        name: "assess_needs",
        description: "Call it when asked to assess needs. Reads shelter requirements and stock from ShelterConnect, after the visitor agrees to the contact, and computes totals, shortages and the priority of each request. Returns totals per resource and the top needs, or ok false with the reason. Re-running replaces the earlier assessment.",
        effect: "write",
        inputSchema: STEP_INPUT,
        execute: (args) => page().runStep("assess", args),
      },
      {
        name: "discover_partners",
        description: "Call it when asked to discover or list partner networks. Loads each configured partner's public manifest and network definition, after the visitor agrees to each contact, and reports its agents, shared actions and connection status. Returns one entry per partner. Discovery does not mean a partner is trusted.",
        effect: "write",
        inputSchema: STEP_INPUT,
        execute: (args) => page().runStep("discover", args),
      },
      {
        name: "verify_partner_trust",
        description: "Call it when asked whether partners, suppliers or transport operators can be trusted. Asks TrustRegistry for each subject's record and signed attestation, verifies the signature in this browser, and scores the evidence. Returns each decision (verified, caution, unverified, blocked), score, signatureVerified and evidence.",
        effect: "write",
        inputSchema: STEP_INPUT,
        execute: (args) => page().runStep("trust", args),
      },
      {
        name: "collect_supplier_offers",
        description: "Call it when asked for supplier offers or a comparison. Needs an assessment first. Reads offers from AidSupply, checks each supplier with TrustRegistry, flags suspicious offers and ranks the eligible ones per resource. Returns ranked offers with exclusion reasons.",
        effect: "write",
        inputSchema: STEP_INPUT,
        execute: (args) => page().runStep("offers", args),
      },
      {
        name: "negotiate_offers",
        description: "Call it when asked to negotiate or get better prices. Needs offers first. Asks each supplier in the draft plan for a non-binding quote on the planned quantity. Returns list price, target, quoted price and saving per offer. Commits nothing.",
        effect: "write",
        inputSchema: STEP_INPUT,
        execute: (args) => page().runStep("negotiate", args),
      },
      {
        name: "generate_allocation_plan",
        description: "Call it when asked to allocate resources or build the plan. Needs offers first. Runs the deterministic allocation engine and validates the result. Returns allocation lines with reasons, unfulfilled demand, total cost and budget remaining. It is a proposal: nothing is ordered.",
        effect: "write",
        inputSchema: STEP_INPUT,
        execute: (args) => page().runStep("allocate", args),
      },
      {
        name: "plan_logistics",
        description: "Call it when asked to plan transport or delivery. Needs an allocation plan first. Asks RouteBridge for transport options per supplier-to-shelter lane, checks each operator with TrustRegistry and assigns vehicles. Returns shipments with provider, vehicle, hours, cost, advisories, alternatives and the route source.",
        effect: "write",
        inputSchema: STEP_INPUT,
        execute: (args) => page().runStep("logistics", args),
      },
      {
        name: "analyze_risks",
        description: "Read the risks in the current offers, plan and transport (shortages, suspicious offers, late or unassigned shipments, budget, concentration) and the what-if scenarios. Changes nothing. Call it when asked about risk or contingencies.",
        effect: "read",
        inputSchema: STEP_INPUT,
        execute: (args) => page().getRisks(args),
      },
      {
        name: "submit_plan_for_approval",
        description: "Call it only when the visitor asks to submit or approve the plan. Needs an allocation plan and a transport plan. The browser shows the visitor the whole plan (suppliers, quantities, cost, shipments, risks) to approve or reject. Approval only unlocks execution: the visitor then confirms each reservation and shipment in the partner site's own window. Returns the decision.",
        effect: "irreversible",
        inputSchema: STEP_INPUT,
        execute: (args) => page().recordApproval(args),
      },
      {
        name: "get_execution_status",
        description: "Read what was confirmed after approval: the supplier reservation receipt, the shipment booking, each shipment's status, deliveries recorded at shelters, unfulfilled requests and problems that need a person. Changes nothing.",
        effect: "read",
        inputSchema: STEP_INPUT,
        execute: (args) => page().getExecution(args),
      },
      {
        name: "get_audit_trail",
        description: "Read the latest audit entries (sequence, time, kind, actor, summary) and the result of the hash-chain check. Changes nothing. Call it when asked what happened, who approved something, or whether the log is intact.",
        effect: "read",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            incidentId: INCIDENT,
            limit: { type: "integer", minimum: 1, maximum: 60, description: "How many of the latest entries. Default 25." },
          },
        },
        execute: (args) => page().getAudit(args),
      },
    ];
  }
}

// The runtime calls the module's registerActions export.
export const registerActions = SiteActions.registerActions;
