// Application state types: what the dashboard keeps beyond the pure domain types.
import type { RawOffer } from "@/domain/offers";
import type {
  AllocationPlan, AuditEntry, GeoPoint, Incident, LaneInfo, NeedsAssessment, NegotiationEvent, Risk, Scenario,
  ScoredOffer, Shipment, ShipmentPlan, TransportOption, TrustEvaluation,
} from "@/domain/types";

export type StepId = "create" | "assess" | "discover" | "trust" | "offers" | "negotiate" | "allocate" | "logistics" | "approval" | "execute";
export type StepStatus = "idle" | "running" | "waiting" | "done" | "warning" | "failed";

export interface StepDefinition {
  id: StepId;
  number: number;
  title: string;
  agent: string;
  description: string;
  /** Partner roles this step contacts. */
  contacts: PeerRole[];
}

export interface StepState {
  status: StepStatus;
  startedAt?: string;
  endedAt?: string;
  summary?: string;
  error?: string;
}

export type PeerRole = "trust" | "shelter" | "supplier" | "logistics" | "other";

export interface PeerConfig {
  id: string;
  label: string;
  role: PeerRole;
  networkUrl: string;
  siteUrl: string;
  purpose: string;
  source: "publisher-registry" | "user-registered";
}

export interface PeerDiscovery {
  status: "connected" | "declined" | "failed" | "policy-refused";
  at: string;
  error?: string;
  brand?: string;
  networkName?: string;
  frontAgent?: string;
  description?: string;
  capabilities: string[];
  dataClassification?: string;
  peerPolicy?: string;
  agents: { name: string; description: string; isFront: boolean; calls: string[] }[];
  actions: { name: string; description: string; effect: string }[];
  /** Other networks this partner's agents may call. */
  partnerNetworks: string[];
  fetched: { manifest: string; network: string };
  observedDigest: string | null;
  sampleQueries: string[];
}

export interface PeerRecord extends PeerConfig {
  discovery: PeerDiscovery | null;
  trust: TrustEvaluation | null;
  /** A person allowed this unverified partner for this incident response. */
  overridden: boolean;
}

export interface ProviderInfo {
  id: string;
  organizationId: string;
  name: string;
  base: GeoPoint & { city: string };
  fleet: { vehicleType: string; count: number; available: number; capacityKg: number; avgSpeedKmh: number; ratePerKm: number; floodCapable: boolean }[];
}

export interface FloodZone {
  id: string;
  name: string;
  center: GeoPoint;
  radiusKm: number;
  effect: string;
  note?: string;
}

export interface SupplierInfo {
  id: string;
  organizationId: string;
  name: string;
  type: "ngo" | "commercial";
  city: string;
  location: GeoPoint;
}

export interface ApprovalState {
  status: "none" | "approved" | "rejected";
  planId?: string;
  /** SHA-256 over the exact plan and shipments the person reviewed. Execution re-checks it. */
  digest?: string;
  decidedAt?: string;
  decidedBy?: string;
  note?: string;
  via?: "dashboard" | "assistant";
}

export interface ExternalWrite {
  status: "none" | "pending" | "confirmed" | "declined" | "refused" | "unknown";
  reference?: string;
  at?: string;
  summary?: string;
  error?: string;
  total?: number;
}

export interface DeliveryReceipt {
  reference: string;
  at: string;
  shipmentRefs: string[];
  lines: number;
}

export interface WorkflowRun {
  incidentId: string;
  steps: Record<StepId, StepState>;
  assessment: NeedsAssessment | null;
  suppliers: SupplierInfo[];
  rawOffers: RawOffer[];
  offers: ScoredOffer[];
  /** Organisation ids a person explicitly allowed although unverified. */
  overrides: string[];
  negotiation: NegotiationEvent[];
  draftPlan: AllocationPlan | null;
  plan: AllocationPlan | null;
  planProblems: string[];
  lanes: Record<string, LaneInfo>;
  lanesSource: "estimate" | "routebridge";
  providers: ProviderInfo[];
  floodZones: FloodZone[];
  routingSource: string;
  optionsByLane: Record<string, TransportOption[]>;
  shipmentPlans: ShipmentPlan[];
  risks: Risk[];
  scenarios: Scenario[];
  approval: ApprovalState;
  reservation: ExternalWrite;
  booking: ExternalWrite;
  shipments: Shipment[];
  deliveries: DeliveryReceipt[];
}

export interface AgentActivity {
  id: string;
  at: string;
  incidentId: string | null;
  agent: string;
  task: string;
  input: string;
  output: string;
  status: "running" | "done" | "warning" | "failed" | "waiting";
  /** Partner networks contacted. */
  networks: string[];
  requiresApproval: boolean;
  /** "direct": the workflow engine ran the agent's tool, no model. "llm": a model-driven agent run. */
  mode: "direct" | "llm";
  durationMs?: number;
  trace: TraceLine[];
}

export interface TraceLine {
  t: string;
  kind: string;
  phase: string;
  label: string;
  status?: string;
  detail?: string;
}

export interface NetworkInteraction {
  id: string;
  at: string;
  from: string;
  to: string;
  kind: "consent" | "discover" | "read" | "write" | "llm";
  label: string;
  status: "pending" | "ok" | "failed" | "declined" | "refused";
  /** The agent on whose behalf the request was made, when known. */
  agent?: string;
  durationMs?: number;
  detail?: string;
}

export interface ConsentRecord {
  at: string;
  origin: string;
  label: string;
  purpose: string;
  decision: "allow" | "always" | "decline";
  kind: string;
}

export interface AssistanceRequest {
  reference: string;
  organization: string;
  category: string;
  urgency: string;
  summary: string;
  resource: string | null;
  quantity: number | null;
  callerOrigin: string;
  status: "new" | "acknowledged" | "dismissed";
  receivedAt: string;
}

export interface RegistryPin {
  fingerprint: string;
  kid: string;
  name: string;
  pinnedAt: string;
}

export interface Settings {
  defaultBudget: number;
  defaultDeadlineHours: number;
  extraPartners: PeerConfig[];
  registryPin: RegistryPin | null;
  /** A registry key that differs from the pin. Verification is blocked until a person decides. */
  registryMismatch: { fingerprint: string; seenAt: string } | null;
  guidedDemo: boolean;
}

export interface PersistedState {
  incidents: Incident[];
  activeIncidentId: string | null;
  runs: Record<string, WorkflowRun>;
  peers: Record<string, PeerRecord>;
  orgTrust: Record<string, TrustEvaluation>;
  activity: AgentActivity[];
  interactions: NetworkInteraction[];
  audit: AuditEntry[];
  consentLog: ConsentRecord[];
  inbox: AssistanceRequest[];
  settings: Settings;
}
