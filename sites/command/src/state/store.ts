// The dashboard's state. Everything the UI shows is derived from this store; nothing on
// screen is a hardcoded number. Persisted to this origin's localStorage.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { appendAudit, type AuditInput } from "@/domain/audit";
import type { Incident, TrustEvaluation } from "@/domain/types";
import { DEFAULT_SETTINGS, demoIncident, emptyRun } from "./seed";
import type {
  AgentActivity, AssistanceRequest, ConsentRecord, NetworkInteraction, PeerConfig, PeerRecord, PersistedState,
  Settings, StepId, StepState, WorkflowRun,
} from "./types";

export const STATE_KEY = "reliefmesh-command-v1";
export const INBOX_KEY = "reliefmesh-command-inbox-v1";

const ACTIVITY_LIMIT = 400;
const INTERACTION_LIMIT = 400;
const AUDIT_LIMIT = 2000;

interface Actions {
  // incidents
  addIncident(incident: Incident): void;
  updateIncident(id: string, patch: Partial<Incident>): void;
  setActiveIncident(id: string | null): void;
  nextIncidentId(): string;
  // workflow runs
  run(incidentId: string): WorkflowRun;
  patchRun(incidentId: string, patch: Partial<WorkflowRun> | ((run: WorkflowRun) => Partial<WorkflowRun>)): void;
  setStep(incidentId: string, step: StepId, patch: Partial<StepState>): void;
  resetRun(incidentId: string): void;
  // partners and trust
  syncPeers(configs: PeerConfig[]): void;
  patchPeer(id: string, patch: Partial<PeerRecord>): void;
  setOrgTrust(organizationId: string, evaluation: TrustEvaluation): void;
  // logs
  addActivity(activity: AgentActivity): void;
  patchActivity(id: string, patch: Partial<AgentActivity>): void;
  addInteraction(interaction: NetworkInteraction): void;
  patchInteraction(id: string, patch: Partial<NetworkInteraction>): void;
  addConsent(record: ConsentRecord): void;
  record(input: AuditInput): Promise<void>;
  // inbox and settings
  syncInbox(): void;
  setInboxStatus(reference: string, status: AssistanceRequest["status"]): void;
  patchSettings(patch: Partial<Settings>): void;
  resetDemo(): void;
}

export type AppState = PersistedState & Actions;

function initialState(now: Date): PersistedState {
  const incident = demoIncident(now);
  return {
    incidents: [incident],
    activeIncidentId: incident.id,
    runs: { [incident.id]: emptyRun(incident.id, incident.createdAt) },
    peers: {},
    orgTrust: {},
    activity: [],
    interactions: [],
    audit: [],
    consentLog: [],
    inbox: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

// Audit appends are hashed asynchronously, so they are queued: each entry must see the
// entry before it or the chain would fork.
let auditQueue: Promise<void> = Promise.resolve();

function readInbox(): AssistanceRequest[] {
  try {
    const raw = localStorage.getItem(INBOX_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((item) => item && typeof item.reference === "string") : [];
  } catch {
    return [];
  }
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...initialState(new Date()),

      addIncident: (incident) => set((state) => ({
        incidents: [...state.incidents, incident],
        runs: { ...state.runs, [incident.id]: emptyRun(incident.id, incident.createdAt) },
        activeIncidentId: incident.id,
      })),

      updateIncident: (id, patch) => set((state) => ({
        incidents: state.incidents.map((incident) => incident.id === id ? { ...incident, ...patch, updatedAt: new Date().toISOString() } : incident),
      })),

      setActiveIncident: (id) => set({ activeIncidentId: id }),

      nextIncidentId: () => {
        const numbers = get().incidents.map((incident) => Number(incident.id.replace(/\D/g, "")) || 0);
        return `INC-${String(Math.max(0, ...numbers) + 1).padStart(4, "0")}`;
      },

      run: (incidentId) => get().runs[incidentId] || emptyRun(incidentId),

      patchRun: (incidentId, patch) => set((state) => {
        const current = state.runs[incidentId] || emptyRun(incidentId);
        const delta = typeof patch === "function" ? patch(current) : patch;
        return { runs: { ...state.runs, [incidentId]: { ...current, ...delta } } };
      }),

      setStep: (incidentId, step, patch) => set((state) => {
        const current = state.runs[incidentId] || emptyRun(incidentId);
        return { runs: { ...state.runs, [incidentId]: { ...current, steps: { ...current.steps, [step]: { ...current.steps[step], ...patch } } } } };
      }),

      resetRun: (incidentId) => set((state) => {
        const incident = state.incidents.find((item) => item.id === incidentId);
        return { runs: { ...state.runs, [incidentId]: emptyRun(incidentId, incident?.createdAt) } };
      }),

      syncPeers: (configs) => set((state) => {
        const peers: Record<string, PeerRecord> = {};
        for (const config of configs) {
          const existing = state.peers[config.id];
          // A partner whose address changed is a different partner: drop what we knew.
          const same = existing && existing.networkUrl === config.networkUrl;
          peers[config.id] = { ...config, discovery: same ? existing.discovery : null, trust: same ? existing.trust : null, overridden: same ? existing.overridden : false };
        }
        return { peers };
      }),

      patchPeer: (id, patch) => set((state) => state.peers[id] ? { peers: { ...state.peers, [id]: { ...state.peers[id], ...patch } } } : {}),

      setOrgTrust: (organizationId, evaluation) => set((state) => ({ orgTrust: { ...state.orgTrust, [organizationId]: evaluation } })),

      addActivity: (activity) => set((state) => ({ activity: [...state.activity, activity].slice(-ACTIVITY_LIMIT) })),
      patchActivity: (id, patch) => set((state) => ({ activity: state.activity.map((item) => item.id === id ? { ...item, ...patch } : item) })),
      addInteraction: (interaction) => set((state) => ({ interactions: [...state.interactions, interaction].slice(-INTERACTION_LIMIT) })),
      patchInteraction: (id, patch) => set((state) => ({ interactions: state.interactions.map((item) => item.id === id ? { ...item, ...patch } : item) })),
      addConsent: (record) => set((state) => ({ consentLog: [...state.consentLog, record].slice(-300) })),

      record: (input) => {
        auditQueue = auditQueue.then(async () => {
          const entry = await appendAudit(get().audit, input, new Date());
          set((state) => ({ audit: [...state.audit, entry].slice(-AUDIT_LIMIT) }));
        }).catch((error) => { console.error("Audit append failed", error); });
        return auditQueue;
      },

      syncInbox: () => set((state) => {
        const stored = readInbox();
        const known = new Map(state.inbox.map((item) => [item.reference, item]));
        // The window writes new requests; the dashboard owns their status.
        const merged = stored.map((item) => ({ ...item, status: known.get(item.reference)?.status ?? item.status ?? "new" }));
        return merged.length === state.inbox.length && merged.every((item, index) => item.reference === state.inbox[index]?.reference && item.status === state.inbox[index]?.status)
          ? {}
          : { inbox: merged };
      }),

      setInboxStatus: (reference, status) => set((state) => ({ inbox: state.inbox.map((item) => item.reference === reference ? { ...item, status } : item) })),

      patchSettings: (patch) => set((state) => ({ settings: { ...state.settings, ...patch } })),

      resetDemo: () => {
        try { localStorage.removeItem(INBOX_KEY); } catch { /* nothing to clear */ }
        auditQueue = Promise.resolve();
        const fresh = initialState(new Date());
        // Partner addresses are configuration, not demo progress: keep them, forget what we learnt.
        const peers = Object.fromEntries(Object.values(get().peers)
          .filter((peer) => peer.source === "publisher-registry")
          .map((peer) => [peer.id, { ...peer, discovery: null, trust: null, overridden: false }]));
        set({ ...fresh, peers });
      },
    }),
    {
      name: STATE_KEY,
      version: 1,
      partialize: (state): PersistedState => ({
        incidents: state.incidents,
        activeIncidentId: state.activeIncidentId,
        runs: state.runs,
        peers: state.peers,
        orgTrust: state.orgTrust,
        activity: state.activity,
        interactions: state.interactions,
        audit: state.audit,
        consentLog: state.consentLog,
        inbox: state.inbox,
        settings: state.settings,
      }),
      // A step that was mid-flight when the tab closed did not finish: say so on reload.
      // "waiting" is different: it means waiting for a person, which survives a reload.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        for (const run of Object.values(state.runs)) {
          for (const step of Object.values(run.steps)) {
            if (step.status === "running") {
              step.status = "failed";
              step.error = "Interrupted: the page was closed or reloaded while this step was running. Run it again.";
            }
          }
          for (const write of [run.reservation, run.booking]) {
            if (write.status === "pending") {
              write.status = "unknown";
              write.error = "The page was reloaded while the partner's window was open. Check the partner site before trying again.";
            }
          }
        }
        state.activity = state.activity.map((item) => item.status === "running" || item.status === "waiting" ? { ...item, status: "failed", output: "Interrupted by a page reload." } : item);
        state.interactions = state.interactions.map((item) => item.status === "pending" ? { ...item, status: "failed", detail: "Interrupted by a page reload." } : item);
      },
    },
  ),
);

/** The incident the dashboard is working on, or null. */
export function useActiveIncident(): Incident | null {
  return useStore((state) => state.incidents.find((incident) => incident.id === state.activeIncidentId) ?? null);
}

export function useRun(incidentId: string | null | undefined): WorkflowRun | null {
  return useStore((state) => (incidentId ? state.runs[incidentId] ?? null : null));
}

let counter = 0;
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}
