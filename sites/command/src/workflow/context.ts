// Shared plumbing for workflow steps: status, activity, trace and audit bookkeeping, so
// each step's own code is only its logic.
import { ConsentDeclined, OutcomeUnknown, PolicyRefused, TrustRefused, type CallContext } from "@/interop/peers";
import { STEPS } from "@/state/seed";
import { uid, useStore } from "@/state/store";
import type { AgentActivity, PeerRecord, StepId, StepStatus, TraceLine, WorkflowRun } from "@/state/types";
import { useUi } from "@/state/ui";
import type { Incident } from "@/domain/types";

export interface StepOutcome {
  ok: boolean;
  status: StepStatus;
  summary: string;
  reason?: string;
}

export interface StepContext {
  incident: Incident;
  call: CallContext;
  run(): WorkflowRun;
  patch(patch: Partial<WorkflowRun>): void;
  /** A line in the developer trace for this step. */
  note(label: string, detail?: string): void;
  /** Record that a partner network was contacted. */
  contacted(peer: PeerRecord): void;
}

export interface StepResult {
  summary: string;
  /** True when the step finished but something needs attention. */
  warning?: boolean;
  input?: string;
}

export class StepBlocked extends Error {
  constructor(message: string) { super(message); this.name = "StepBlocked"; }
}

export function stepDefinition(stepId: StepId) {
  const definition = STEPS.find((step) => step.id === stepId);
  if (!definition) throw new Error(`Unknown step ${stepId}`);
  return definition;
}

export function incidentById(incidentId: string): Incident {
  const incident = useStore.getState().incidents.find((item) => item.id === incidentId);
  if (!incident) throw new StepBlocked(`No incident with id ${incidentId}.`);
  return incident;
}

export function requirePeer(role: PeerRecord["role"], what: string): PeerRecord {
  const peer = Object.values(useStore.getState().peers).find((item) => item.role === role);
  if (!peer) throw new StepBlocked(`No ${what} partner is configured. Add one in Settings.`);
  return peer;
}

function explain(error: unknown): { message: string; kind: string } {
  if (error instanceof ConsentDeclined) return { message: error.message, kind: "declined" };
  if (error instanceof TrustRefused) return { message: error.message, kind: "trust" };
  if (error instanceof PolicyRefused) return { message: error.message, kind: "policy" };
  if (error instanceof OutcomeUnknown) return { message: error.message, kind: "unknown" };
  if (error instanceof StepBlocked) return { message: error.message, kind: "blocked" };
  return { message: (error as Error)?.message || String(error), kind: "error" };
}

/**
 * Run one unit of agent work with full bookkeeping: an activity entry attributed to the
 * agent that owns the tool, the runtime's trace lines produced meanwhile, an audit entry,
 * and (for a workflow step) the step's status. Failures are caught and reported; a failed
 * step never leaves the workflow in a "running" state.
 */
export async function withActivity(input: {
  incidentId: string;
  step?: StepId;
  agent: string;
  task: string;
  requiresApproval?: boolean;
}, work: (ctx: StepContext) => Promise<StepResult>): Promise<StepOutcome> {
  const store = useStore.getState();
  const ui = useUi.getState();
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const traceStart = ui.trace.length;
  const networks = new Set<string>();
  const activityId = uid("act");
  let incident: Incident;
  try {
    incident = incidentById(input.incidentId);
  } catch (error) {
    return { ok: false, status: "failed", summary: "", reason: (error as Error).message };
  }

  const activity: AgentActivity = {
    id: activityId, at: startedAt, incidentId: input.incidentId, agent: input.agent, task: input.task,
    input: `Incident ${incident.id} — ${incident.name}`, output: "", status: "running", networks: [],
    requiresApproval: !!input.requiresApproval, mode: "direct", trace: [],
  };
  store.addActivity(activity);
  if (input.step) store.setStep(input.incidentId, input.step, { status: "running", startedAt, endedAt: undefined, error: undefined, summary: undefined });

  const ctx: StepContext = {
    incident,
    call: { incidentId: input.incidentId, agent: input.agent },
    run: () => useStore.getState().run(input.incidentId),
    patch: (patch) => useStore.getState().patchRun(input.incidentId, patch),
    note: (label, detail) => useUi.getState().pushTrace({ t: new Date().toISOString(), kind: "workflow", phase: "note", label, detail }),
    contacted: (peer) => { networks.add(peer.label); useStore.getState().patchActivity(activityId, { networks: [...networks] }); },
  };

  const finish = (status: AgentActivity["status"], output: string, extra: Partial<AgentActivity> = {}) => {
    const lines: TraceLine[] = useUi.getState().trace.slice(traceStart).slice(-80);
    useStore.getState().patchActivity(activityId, { status, output, networks: [...networks], durationMs: Math.round(performance.now() - started), trace: lines, ...extra });
  };

  try {
    const result = await work(ctx);
    const status: StepStatus = result.warning ? "warning" : "done";
    finish(result.warning ? "warning" : "done", result.summary, result.input ? { input: result.input } : {});
    if (input.step) useStore.getState().setStep(input.incidentId, input.step, { status, endedAt: new Date().toISOString(), summary: result.summary });
    void useStore.getState().record({
      kind: input.step ? "workflow" : "agent", actor: input.agent, incidentId: input.incidentId,
      summary: `${input.task}: ${result.summary}`,
      data: { step: input.step ?? null, networks: [...networks], mode: "direct tool execution, no model", warning: !!result.warning },
    });
    return { ok: true, status, summary: result.summary };
  } catch (error) {
    const { message, kind } = explain(error);
    finish("failed", message);
    if (input.step) useStore.getState().setStep(input.incidentId, input.step, { status: "failed", endedAt: new Date().toISOString(), error: message });
    void useStore.getState().record({
      kind: input.step ? "workflow" : "agent", actor: input.agent, incidentId: input.incidentId,
      summary: `${input.task} did not complete: ${message}`,
      data: { step: input.step ?? null, reason: kind, networks: [...networks] },
    });
    if (kind === "error") console.error(`[${input.task}]`, error);
    return { ok: false, status: "failed", summary: "", reason: message };
  }
}
