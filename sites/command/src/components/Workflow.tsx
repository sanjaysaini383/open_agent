// The ten-step workflow: a timeline of each step's status, with the controls that run
// them and the execution details behind each one.
import { useState } from "react";
import { ChevronDown, ChevronRight, Play, RefreshCw, UserCheck } from "lucide-react";
import { AUTOMATED_STEPS, STEPS } from "@/state/seed";
import { useStore } from "@/state/store";
import type { StepId, WorkflowRun } from "@/state/types";
import { useUi } from "@/state/ui";
import { canApprove } from "@/workflow/execution";
import { runStep } from "@/workflow/steps";
import { ApprovalDialog } from "./dialogs";
import { Collapse, LiveDot } from "./motion";
import { Badge, Button, StatusIcon, clock, cx, time } from "./ui";

export function workflowProgress(run: WorkflowRun | null | undefined): { done: number; total: number; pct: number } {
  const total = STEPS.length;
  const done = run ? STEPS.filter((step) => ["done", "warning"].includes(run.steps[step.id].status)).length : 0;
  return { done, total, pct: Math.round((done / total) * 100) };
}

/** Run the automated steps in order. Stops at the first one that does not complete, or when the simulator pauses it. */
export async function runCoordination(incidentId: string, from: StepId = "assess"): Promise<void> {
  const ui = useUi.getState();
  if (ui.busyIncident) return;
  ui.setBusy(incidentId);
  ui.setSimulationPaused(false);
  try {
    const start = AUTOMATED_STEPS.indexOf(from);
    const steps = AUTOMATED_STEPS.slice(Math.max(0, start));
    for (const [index, step] of steps.entries()) {
      const outcome = await runStep(incidentId, step);
      if (!outcome.ok) {
        ui.notify(`Stopped at "${STEPS.find((item) => item.id === step)!.title}": ${outcome.reason}`, "warn");
        return;
      }
      // The scenario simulator can ask the workflow to stop before its next step.
      if (useUi.getState().simulationPaused && index < steps.length - 1) {
        ui.notify(`Paused after "${STEPS.find((item) => item.id === step)!.title}". Resume to continue with the next step.`, "info");
        return;
      }
    }
    ui.notify("The plan is ready. Review it and approve or reject it.", "ok");
  } finally {
    useUi.getState().setBusy(null);
  }
}

function StepDetails({ incidentId, stepId }: { incidentId: string; stepId: StepId }) {
  const definition = STEPS.find((step) => step.id === stepId)!;
  const entries = useStore((state) => state.activity).filter((item) => item.incidentId === incidentId && item.agent === definition.agent && item.task === definition.title).slice(-1);
  const entry = entries[0];
  if (!entry) return <p className="text-[12px] text-muted">{definition.description}</p>;
  return (
    <div className="grid gap-1.5 text-[12px]">
      <p className="text-muted">{definition.description}</p>
      <p><span className="font-semibold text-ink-2">Input:</span> {entry.input}</p>
      <p className="flex flex-wrap items-center gap-1.5"><span className="font-semibold text-ink-2">Mode:</span><Badge tone="navy">Direct tool · no model</Badge>{entry.networks.map((network) => <Badge key={network}>{network}</Badge>)}{entry.durationMs !== undefined && <span className="text-muted">{(entry.durationMs / 1000).toFixed(1)} s</span>}</p>
      {entry.trace.length > 0 && (
        <ol className="scroll-thin max-h-40 overflow-auto rounded border border-line bg-surface p-2 font-mono text-[11px] leading-relaxed">
          {entry.trace.map((line, index) => <li key={index} className={cx(line.status === "error" && "text-critical-text")}><span className="text-faint">{clock(line.t)}</span> {line.kind}:{line.phase} {line.label}{line.detail ? ` — ${line.detail}` : ""}</li>)}
        </ol>
      )}
    </div>
  );
}

export function WorkflowPanel({ incidentId, onSelect, selected }: { incidentId: string; onSelect?: (step: StepId) => void; selected?: StepId }) {
  const run = useStore((state) => state.runs[incidentId]);
  const closed = useStore((state) => state.incidents.find((incident) => incident.id === incidentId)?.status === "closed");
  const busy = useUi((state) => state.busyIncident);
  const [approving, setApproving] = useState(false);
  const [single, setSingle] = useState<StepId | null>(null);
  const [expanded, setExpanded] = useState<StepId | null>(null);
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
      <ol className="relative grid gap-1.5">
        {STEPS.map((step, index) => {
          const state = run.steps[step.id];
          const automated = AUTOMATED_STEPS.includes(step.id);
          const running = state.status === "running";
          const last = index === STEPS.length - 1;
          return (
            <li key={step.id} className={cx("relative rounded-lg border bg-surface transition-colors", selected === step.id ? "border-accent ring-1 ring-accent/30" : running ? "border-accent/50" : "border-line")}>
              {!last && <span className={cx("absolute left-[22px] top-[38px] h-[calc(100%-18px)] w-px", ["done", "warning"].includes(state.status) ? "bg-ok/50" : "bg-line")} aria-hidden />}
              <div className="flex items-start gap-3 p-3">
                <span className="relative z-10 mt-0.5 grid h-5 w-5 place-items-center rounded-full bg-surface">{running ? <LiveDot tone="accent" label="Running" /> : <StatusIcon status={state.status} />}</span>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelect?.(step.id)} aria-current={selected === step.id ? "step" : undefined}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-[13.5px] font-semibold">{step.number}. {step.title}</span>
                    <span className="font-mono text-[11.5px] text-muted">{step.agent}</span>
                    {running && <Badge tone="accent">running</Badge>}
                  </div>
                  <p className={cx("mt-0.5 text-[12.5px]", state.status === "failed" ? "text-critical-text" : "text-muted")}>
                    {state.status === "failed" ? state.error : state.summary || step.description}
                  </p>
                  {state.endedAt && <p className="mt-0.5 text-[11.5px] text-faint">{time(state.endedAt)}{state.startedAt ? ` · ${Math.max(0, Math.round((Date.parse(state.endedAt) - Date.parse(state.startedAt)) / 100) / 10)} s` : ""}</p>}
                </button>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {automated && !closed && (
                    <Button size="sm" variant="ghost" disabled={!!busy} busy={single === step.id} onClick={() => runOne(step.id)} title={state.status === "idle" ? "Run this step" : "Run this step again"}>
                      {state.status === "idle" ? <Play size={13} aria-hidden /> : <RefreshCw size={13} aria-hidden />}
                      {state.status === "idle" ? "Run" : "Re-run"}
                    </Button>
                  )}
                  {step.id === "approval" && approvable && <Button size="sm" onClick={() => setApproving(true)}>Review</Button>}
                  {automated && state.status !== "idle" && (
                    <Button size="xs" variant="ghost" aria-expanded={expanded === step.id} onClick={() => setExpanded(expanded === step.id ? null : step.id)}>
                      {expanded === step.id ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}Details
                    </Button>
                  )}
                </div>
              </div>
              <Collapse open={expanded === step.id}><div className="border-t border-line bg-surface-2 px-3 py-2.5 pl-11"><StepDetails incidentId={incidentId} stepId={step.id} /></div></Collapse>
            </li>
          );
        })}
      </ol>
      {approving && <ApprovalDialog incidentId={incidentId} onClose={() => setApproving(false)} />}
    </div>
  );
}
