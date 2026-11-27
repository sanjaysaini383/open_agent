// The live activity feed: agent tasks, cross-origin requests, consent decisions and
// assistance requests, merged in time order. Every event is a record from the store;
// nothing is scripted. A filter narrows it to one kind of event.
import { useMemo, useState } from "react";
import { ArrowLeftRight, Bot, Cpu, Inbox, ShieldCheck, Wrench } from "lucide-react";
import { useStore } from "@/state/store";
import { useUi } from "@/state/ui";
import { AnimatePresence, motion, useMotionOff } from "./motion";
import { Badge, Empty, Segmented, StatusIcon, clock, cx } from "./ui";

type Kind = "agent" | "network" | "consent" | "request";

export interface FeedEvent {
  id: string;
  at: string;
  kind: Kind;
  title: string;
  detail?: string;
  status: "running" | "done" | "warning" | "failed" | "waiting" | "ok" | "pending" | "declined" | "refused";
  agent?: string;
  mode?: "direct" | "llm";
  network?: string;
}

export function useFeed(incidentId?: string | null): FeedEvent[] {
  const activity = useStore((state) => state.activity);
  const interactions = useStore((state) => state.interactions);
  const consentLog = useStore((state) => state.consentLog);
  const inbox = useStore((state) => state.inbox);
  const peers = useStore((state) => state.peers);
  return useMemo(() => {
    const events: FeedEvent[] = [];
    for (const item of activity) {
      if (incidentId && item.incidentId !== incidentId) continue;
      events.push({ id: item.id, at: item.at, kind: "agent", title: `${item.agent} · ${item.task}`, detail: item.output || (item.status === "running" ? "In progress…" : undefined), status: item.status, agent: item.agent, mode: item.mode, network: item.networks.join(", ") || undefined });
    }
    for (const item of interactions) {
      const label = peers[item.to]?.label ?? item.to;
      const what = { consent: "consent", discover: "loaded the network of", read: `read ${item.label} from`, write: `wrote ${item.label} to`, llm: "ran the network of" }[item.kind];
      if (item.kind === "consent") continue;
      events.push({ id: item.id, at: item.at, kind: "network", title: `${item.agent ?? "Command"} ${what} ${label}`, detail: item.status === "ok" ? `${item.durationMs ?? "—"} ms` : item.detail, status: item.status, agent: item.agent, network: label, mode: item.kind === "llm" ? "llm" : undefined });
    }
    consentLog.forEach((item, index) => events.push({ id: `consent-${index}-${item.at}`, at: item.at, kind: "consent", title: `${item.decision === "decline" ? "Declined" : item.decision === "always" ? "Allowed for this session" : "Allowed once"}: contact ${item.label}`, detail: item.purpose, status: item.decision === "decline" ? "declined" : "ok", network: item.label }));
    for (const item of inbox) events.push({ id: `inbox-${item.reference}`, at: item.receivedAt, kind: "request", title: `${item.organization} filed an assistance request (${item.reference})`, detail: item.summary, status: item.status === "new" ? "waiting" : "done", network: item.callerOrigin });
    return events.sort((a, b) => b.at.localeCompare(a.at));
  }, [activity, interactions, consentLog, inbox, peers, incidentId]);
}

const ICON: Record<Kind, typeof Bot> = { agent: Bot, network: ArrowLeftRight, consent: ShieldCheck, request: Inbox };

export function ActivityFeed({ incidentId, limit = 20, filterable = true }: { incidentId?: string | null; limit?: number; filterable?: boolean }) {
  const events = useFeed(incidentId);
  const [kind, setKind] = useState<Kind | "all">("all");
  const inspect = useUi((state) => state.setInspectAgent);
  const off = useMotionOff();
  const shown = events.filter((event) => kind === "all" || event.kind === kind).slice(0, limit);
  return (
    <div>
      {filterable && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Segmented label="Filter the feed" size="xs" value={kind} onChange={setKind} options={[{ id: "all", label: "All" }, { id: "agent", label: "Agents" }, { id: "network", label: "Cross-origin" }, { id: "consent", label: "Consent" }, { id: "request", label: "Requests" }]} />
          <span className="text-[11.5px] text-muted">{events.length} events · newest first · all from this browser's records</span>
        </div>
      )}
      {shown.length ? (
        <ol className="relative grid gap-0 border-l border-line pl-4">
          <AnimatePresence initial={false}>
            {shown.map((event) => {
              const Icon = ICON[event.kind];
              return (
                <motion.li key={event.id} layout={!off} initial={off ? false : { opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }} className="relative py-1.5">
                  <span className={cx("absolute -left-[21px] top-2.5 grid h-[18px] w-[18px] place-items-center rounded-full border bg-surface", event.status === "running" || event.status === "pending" ? "border-accent text-accent-text" : event.status === "failed" || event.status === "refused" ? "border-critical/50 text-critical" : "border-line-strong text-muted")} aria-hidden>
                    <Icon size={10} />
                  </span>
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="tabular text-[11.5px] text-faint">{clock(event.at)}</span>
                    <span className="inline-flex items-center gap-1"><StatusIcon status={event.status} size={13} /></span>
                    {event.agent ? (
                      <button type="button" className="text-[13px] font-semibold text-ink hover:text-accent-text" onClick={() => inspect(event.agent!)}>{event.title}</button>
                    ) : <span className="text-[13px] font-semibold text-ink">{event.title}</span>}
                    {event.mode === "llm" && <Badge tone="info"><Cpu size={10} aria-hidden />Model-driven</Badge>}
                    {event.mode === "direct" && <Badge tone="navy"><Wrench size={10} aria-hidden />Direct tool</Badge>}
                    {event.network && event.kind !== "network" && <Badge>{event.network}</Badge>}
                  </div>
                  {event.detail && <p className={cx("mt-0.5 line-clamp-2 text-[12.5px]", event.status === "failed" ? "text-critical-text" : "text-muted")}>{event.detail}</p>}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      ) : <Empty title="No activity yet">Start the coordination workflow, or ask the agents something in the agent console. Every event here is a record from the store, not a demo script.</Empty>}
    </div>
  );
}
