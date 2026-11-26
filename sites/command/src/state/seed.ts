// The preloaded demonstration scenario and the workflow's step definitions.
//
// SIMULATED DEMONSTRATION DATA. The incident below describes no real event. The place is a
// real district of West Bengal so the map is believable; every number is invented.
import { emptyResourceRecord } from "@/domain/resources";
import type { Incident } from "@/domain/types";
import type { Settings, StepDefinition, StepId, StepState, WorkflowRun } from "./types";

export const SIMULATED_NOTICE = "Simulated demonstration data. No real incident, people, organisations or transactions.";

export const STEPS: StepDefinition[] = [
  { id: "create", number: 1, title: "Create emergency", agent: "EmergencyCommanderAgent", description: "A person records the incident: what happened, where, how severe, what is needed and by when.", contacts: [] },
  { id: "assess", number: 2, title: "Assess requirements", agent: "NeedAssessmentAgent", description: "Reads shelter requirements and stock, computes shortages and ranks every request by priority.", contacts: ["trust", "shelter"] },
  { id: "discover", number: 3, title: "Discover partner agents", agent: "DiscoveryAgent", description: "Loads each partner site's public manifest and network definition and lists its agents and shared actions.", contacts: ["trust", "shelter", "supplier", "logistics"] },
  { id: "trust", number: 4, title: "Verify trust", agent: "TrustVerificationAgent", description: "Checks identity records and credentials, verifies signed attestations and scores the evidence.", contacts: ["trust", "supplier", "logistics"] },
  { id: "offers", number: 5, title: "Collect supplier offers", agent: "SupplierMatchingAgent", description: "Collects offers, flags suspicious ones and ranks the eligible offers per resource.", contacts: ["supplier", "trust"] },
  { id: "negotiate", number: 6, title: "Negotiate", agent: "NegotiationAgent", description: "Requests non-binding quotes for the quantities the draft plan would buy.", contacts: ["supplier"] },
  { id: "allocate", number: 7, title: "Optimise allocation", agent: "ResourceAllocationAgent", description: "Assigns supplier stock to shelters within the budget and validates every invariant.", contacts: ["supplier"] },
  { id: "logistics", number: 8, title: "Coordinate logistics", agent: "LogisticsAgent", description: "Gets route estimates and transport options, re-optimises if a route is infeasible, and assigns vehicles.", contacts: ["logistics", "trust"] },
  { id: "approval", number: 9, title: "Human approval", agent: "Coordinator (human)", description: "A person reviews the whole plan and approves or rejects it. Nothing external is written before this.", contacts: [] },
  { id: "execute", number: 10, title: "Execute and track", agent: "AuditAgent", description: "The person confirms each reservation and booking in the partner's own window; shipments are then tracked to delivery.", contacts: ["supplier", "logistics", "shelter"] },
];

export const STEP_IDS: StepId[] = STEPS.map((step) => step.id);

/** Steps the "run the workflow" control executes in order, stopping before human approval. */
export const AUTOMATED_STEPS: StepId[] = ["assess", "discover", "trust", "offers", "negotiate", "allocate", "logistics"];

export const AGENTS: { name: string; role: string }[] = [
  { name: "EmergencyCommanderAgent", role: "Understands the situation, coordinates the other agents and tracks progress." },
  { name: "NeedAssessmentAgent", role: "Evaluates shelter requirements, shortages and priorities." },
  { name: "DiscoveryAgent", role: "Discovers compatible partner networks from public manifests." },
  { name: "TrustVerificationAgent", role: "Checks identities, signatures and credentials. Never trusts the unverified." },
  { name: "SupplierMatchingAgent", role: "Matches supplier inventory against requirements." },
  { name: "NegotiationAgent", role: "Requests better terms. Never commits to anything." },
  { name: "ResourceAllocationAgent", role: "Allocates stock, prevents double allocation and explains decisions." },
  { name: "LogisticsAgent", role: "Matches shipments with vehicles and estimates delivery." },
  { name: "RiskAnalysisAgent", role: "Finds shortages, suspicious offers and delivery risks; runs scenarios." },
  { name: "AuditAgent", role: "Records events, approvals and receipts in a tamper-evident log." },
];

export const DEFAULT_SETTINGS: Settings = {
  defaultBudget: 300000,
  defaultDeadlineHours: 36,
  extraPartners: [],
  registryPin: null,
  registryMismatch: null,
  guidedDemo: true,
};

export const DEMO_INCIDENT_ID = "INC-0001";

export function demoIncident(now: Date): Incident {
  return {
    id: DEMO_INCIDENT_ID,
    name: "Malda district flood response",
    category: "flood",
    location: { name: "Malda district, West Bengal (simulated scenario)", lat: 25.14, lng: 87.93 },
    severity: "critical",
    affectedPopulation: 12000,
    shelterCount: 4,
    requirements: { food_packets: 2000, water_kits: 1000, medical_kits: 300, blankets: 500 },
    deadline: new Date(now.getTime() + DEFAULT_SETTINGS.defaultDeadlineHours * 3_600_000).toISOString(),
    budget: DEFAULT_SETTINGS.defaultBudget,
    status: "active",
    simulated: true,
    notes: "Severe flooding after an embankment breach. Four emergency shelters are open. Demonstration scenario.",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function emptySteps(createdAt?: string): Record<StepId, StepState> {
  const steps = Object.fromEntries(STEP_IDS.map((id) => [id, { status: "idle" } as StepState])) as Record<StepId, StepState>;
  if (createdAt) steps.create = { status: "done", startedAt: createdAt, endedAt: createdAt, summary: "Incident recorded by the coordinator." };
  return steps;
}

export function emptyRun(incidentId: string, createdAt?: string): WorkflowRun {
  return {
    incidentId,
    steps: emptySteps(createdAt),
    assessment: null,
    suppliers: [],
    rawOffers: [],
    offers: [],
    overrides: [],
    negotiation: [],
    draftPlan: null,
    plan: null,
    planProblems: [],
    lanes: {},
    lanesSource: "estimate",
    providers: [],
    floodZones: [],
    routingSource: "",
    optionsByLane: {},
    shipmentPlans: [],
    risks: [],
    scenarios: [],
    approval: { status: "none" },
    reservation: { status: "none" },
    booking: { status: "none" },
    shipments: [],
    deliveries: [],
  };
}

export const EMPTY_REQUIREMENTS = emptyResourceRecord(() => 0);
