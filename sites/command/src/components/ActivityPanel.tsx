// Agent activity: who did what, with what input, what came back, which network was
// called, and whether a person had to approve. Each entry opens to its technical trace.
import { useState } from "react";
import { ChevronDown, ChevronRight, Cpu, UserCheck, Wrench } from "lucide-react";
import { useStore } from "@/state/store";
import type { AgentActivity } from "@/state/types";
import { Badge, Empty, StatusIcon, clock, cx } from "./ui";

function Entry({ activity }: { activity: AgentActivity }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rm-fade-in border-b border-line last:border-b-0">
      <button type="button" className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-surface-2" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="mt-0.5"><StatusIcon status={activity.status === "waiting" ? "waiting" : activity.status} size={15} /></span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-[13px] font-semibold">{activity.agent}</span>
            <span className="text-[12.5px] text-ink-2">{activity.task}</span>
          </span>
          {activity.output && <span className={cx("mt-0.5 block text-[12.5px]", activity.status === "failed" ? "text-critical" : "text-muted")}>{activity.output}</span>}
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="text-[11.5px] text-faint">{clock(activity.at)}{activity.durationMs !== undefined ? ` · ${(activity.durationMs / 1000).toFixed(1)} s` : ""}</span>
            {activity.mode === "llm"
              ? <Badge tone="info" title="A model drove this agent"><Cpu size={11} aria-hidden />Model-driven</Badge>
              : <Badge tone="navy" title="The workflow engine ran this agent's tool directly. No model was called."><Wrench size={11} aria-hidden />Direct tool</Badge>}
            {activity.networks.map((network) => <Badge key={network} tone="neutral" title="Network contacted">{network}</Badge>)}
            {activity.requiresApproval && <Badge tone="warn"><UserCheck size={11} aria-hidden />Needed human approval</Badge>}
          </span>
        </span>
        {open ? <ChevronDown size={15} className="mt-1 shrink-0 text-muted" aria-hidden /> : <ChevronRight size={15} className="mt-1 shrink-0 text-muted" aria-hidden />}
      </button>
      {open && (
        <div className="border-t border-line bg-surface-2 px-4 py-3 text-[12.5px]">
          <p><span className="font-semibold text-ink-2">Input:</span> {activity.input}</p>
          <p className="mt-1 font-semibold text-ink-2">Technical trace ({activity.trace.length} events)</p>
          {activity.trace.length ? (
            <ol className="scroll-thin mt-1 max-h-64 overflow-auto rounded border border-line bg-surface p-2 font-mono text-[11.5px] leading-relaxed">
              {activity.trace.map((line, index) => (
                <li key={index} className={cx(line.status === "error" && "text-critical")}>
                  <span className="text-faint">{clock(line.t)}</span> <span className="font-semibold">{line.kind}</span>:{line.phase} {line.label}{line.status ? ` [${line.status}]` : ""}{line.detail ? ` — ${line.detail}` : ""}
                </li>
              ))}
            </ol>
          ) : <p className="text-muted">No runtime events were recorded for this entry.</p>}
        </div>
      )}
    </li>
  );
}

export function ActivityPanel({ incidentId, limit = 12 }: { incidentId?: string | null; limit?: number }) {
  const activity = useStore((state) => state.activity);
  const shown = (incidentId ? activity.filter((item) => item.incidentId === incidentId) : activity).slice(-limit).reverse();
  if (!shown.length) return <Empty title="No agent activity yet">Start the coordination workflow, or ask the agents something in the agent console.</Empty>;
  return <ol className="overflow-hidden rounded-lg border border-line bg-surface">{shown.map((item) => <Entry key={item.id} activity={item} />)}</ol>;
}
