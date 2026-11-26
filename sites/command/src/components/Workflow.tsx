// The ten-step workflow: status of each step, and the controls that run them.
import { useState } from "react";
import { Play, RefreshCw, UserCheck } from "lucide-react";
import { AUTOMATED_STEPS, STEPS } from "@/state/seed";
import { useStore } from "@/state/store";
import type { StepId, WorkflowRun } from "@/state/types";
import { useUi } from "@/state/ui";
import { canApprove } from "@/workflow/execution";
import { runStep } from "@/workflow/steps";
import { ApprovalDialog } from "./dialogs";
import { Badge, Button, StatusIcon, cx, time } from "./ui";

export function workflowProgress(run: WorkflowRun | null | undefined): { done: number; total: number; pct: number } {
  const total = STEPS.length;
  const done = run ? STEPS.filter((step) => ["done", "warning"].includes(run.steps[step.id].status)).length : 0;
  return { done, total, pct: Math.round((done / total) * 100) };
}

/** Run the automated steps in order. Stops at the first one that does not complete. */
export async function runCoordination(incidentId: string, from: StepId = "assess"): Promise<void> {
  const ui = useUi.getState();
  if (ui.busyIncident) return;
  ui.setBusy(incidentId);
  try {
    const start = AUTOMATED_STEPS.indexOf(from);
    for (const step of AUTOMATED_STEPS.slice(Math.max(0, start))) {
      const outcome = await runStep(incidentId, step);
      if (!outcome.ok) {
        ui.notify(`Stopped at "${STEPS.find((item) => item.id === step)!.title}": ${outcome.reason}`, "warn");
        return;
      }
    }
    ui.notify("The plan is ready. Review it and approve or reject it.", "ok");
  } finally {
    useUi.getState().setBusy(null);
  }
}

export function WorkflowPanel({ incidentId, onSelect, selected }: { incidentId: string; onSelect?: (step: StepId) => void; selected?: StepId }) {
  const run = useStore((state) => state.runs[incidentId]);
  const closed = useStore((state) => state.incidents.find((incident) => incident.id === incidentId)?.status === "closed");
  const busy = useUi((state) => state.busyIncident);
  const [approving, setApproving] = useState(false);
  const [single, setSingle] = useState<StepId | null>(null);
  if (!run) return null;

  const next = AUTOMATED_STEPS.find((step) => !["done", "warning"].includes(run.steps[step].status));
  const approvable = canApprove(run).ok && run.approval.status !== "approved";
  const runOne = async (step: StepId) => {
    if (useUi.getState().busyIncident) return;
    setSingle(step);
    useUi.getState().setBusy(incidentId);
    try {
      const outcome = await runStep(incidentId, step);
      if (!outcome.ok) useUi.getState().notify(outcome.reason || "The step did not complete.", "warn");
    } finally {
      useUi.getState().setBusy(null);
      setSingle(null);
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={!!busy || closed || !next} busy={busy === incidentId && !single} onClick={() => runCoordination(incidentId, next)}>
          <Play size={14} aria-hidden />{next === "assess" ? "Start coordination workflow" : next ? "Continue workflow" : "Automated steps complete"}
        </Button>
        {approvable && <Button variant="primary" onClick={() => setApproving(true)}><UserCheck size={14} aria-hidden />Review and approve</Button>}
        <Badge tone="navy" title="Steps run each agent's deterministic tool directly. No model is called. Use the agent console to have a model drive the same tools.">Direct tool execution · no model call</Badge>
      </div>
      <ol className="grid gap-1.5">
        {STEPS.map((step) => {
          const state = run.steps[step.id];
          const automated = AUTOMATED_STEPS.includes(step.id);
          return (
            <li key={step.id} className={cx("rounded-lg border bg-white transition-colors", selected === step.id ? "border-navy-700 ring-1 ring-navy-100" : "border-line")}>
              <div className="flex items-start gap-3 p-3">
                <span className="mt-0.5"><StatusIcon status={state.status} /></span>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelect?.(step.id)} aria-current={selected === step.id ? "step" : undefined}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-[13.5px] font-semibold">{step.number}. {step.title}</span>
                    <span className="text-[12px] text-muted">{step.agent}</span>
                  </div>
                  <p className={cx("mt-0.5 text-[12.5px]", state.status === "failed" ? "text-critical" : "text-muted")}>
                    {state.status === "failed" ? state.error : state.summary || step.description}
                  </p>
                  {state.endedAt && <p className="mt-0.5 text-[11.5px] text-slate-400">{time(state.endedAt)}</p>}
                </button>
                {automated && !closed && (
                  <Button size="sm" variant="ghost" disabled={!!busy} busy={single === step.id} onClick={() => runOne(step.id)} title={state.status === "idle" ? "Run this step" : "Run this step again"}>
                    {state.status === "idle" ? <Play size={13} aria-hidden /> : <RefreshCw size={13} aria-hidden />}
                    {state.status === "idle" ? "Run" : "Re-run"}
                  </Button>
                )}
                {step.id === "approval" && approvable && <Button size="sm" onClick={() => setApproving(true)}>Review</Button>}
              </div>
            </li>
          );
        })}
      </ol>
      {approving && <ApprovalDialog incidentId={incidentId} onClose={() => setApproving(false)} />}
    </div>
  );
}
