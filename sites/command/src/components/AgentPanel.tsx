// The details panel for one agent, opened from the network graph, the command palette or
// a page. Identity and capabilities come from the published network definitions; the
// current task, status and history come from the activity log.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, ExternalLink, Play, Plug, Terminal } from "lucide-react";
import { setConsoleOpen } from "@/lib/boot";
import { useOwnNetwork } from "@/lib/ownNetwork";
import { AGENTS, STEPS } from "@/state/seed";
import { useStore } from "@/state/store";
import type { AgentActivity, PeerRecord } from "@/state/types";
import { useUi } from "@/state/ui";
import { runStep } from "@/workflow/steps";
import { LiveDot } from "./motion";
import { Badge, Button, Drawer, Empty, KeyValue, StatusIcon, TrustBadge, clock, cx, relative, time } from "./ui";

interface Identity {
  name: string;
  description: string;
  network: { label: string; url: string; origin: string; own: boolean; peer?: PeerRecord };
  isFront: boolean;
  calls: string[];
  capabilities: string[];
}

function identityFor(name: string, own: ReturnType<typeof useOwnNetwork>, peers: Record<string, PeerRecord>): Identity | null {
  const mine = own?.agents.find((agent) => agent.name === name) ?? (AGENTS.some((agent) => agent.name === name) ? { name, description: "", calls: [], isFront: name === "EmergencyCommanderAgent" } : null);
  if (mine) {
    const seed = AGENTS.find((agent) => agent.name === name);
    const steps = STEPS.filter((step) => step.agent === name).map((step) => `Step ${step.number}: ${step.title}`);
    return {
      name,
      description: mine.description || seed?.role || "",
      network: { label: "ReliefMesh Command", url: own?.url ?? `${window.location.origin}/reliefmesh_command`, origin: window.location.origin, own: true },
      isFront: mine.isFront,
      calls: mine.calls,
      capabilities: [...steps, ...(seed && !steps.length ? [seed.role] : [])],
    };
  }
  for (const peer of Object.values(peers)) {
    const agent = peer.discovery?.agents.find((item) => item.name === name);
    if (agent) {
      let origin = peer.networkUrl;
      try { origin = new URL(peer.networkUrl).origin; } catch { /* keep */ }
      return { name, description: agent.description, network: { label: peer.label, url: peer.networkUrl, origin, own: false, peer }, isFront: agent.isFront, calls: agent.calls, capabilities: peer.discovery?.capabilities ?? [] };
    }
  }
  return null;
}

function History({ entries }: { entries: AgentActivity[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!entries.length) return <Empty title="No executions recorded">This agent has not run in this browser yet.</Empty>;
  return (
    <ol className="grid gap-1.5">
      {entries.map((entry) => (
        <li key={entry.id} className="rounded-md border border-line bg-surface-2">
          <button type="button" className="flex w-full items-start gap-2 px-2.5 py-2 text-left" onClick={() => setOpen(open === entry.id ? null : entry.id)} aria-expanded={open === entry.id}>
            <span className="mt-0.5"><StatusIcon status={entry.status} size={14} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-semibold text-ink">{entry.task}</span>
              <span className={cx("block text-[12px]", entry.status === "failed" ? "text-critical-text" : "text-muted")}>{entry.output || (entry.status === "running" ? "Running…" : "")}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
                {clock(entry.at)}{entry.durationMs !== undefined ? ` · ${(entry.durationMs / 1000).toFixed(1)} s` : ""}
                <Badge tone={entry.mode === "llm" ? "info" : "navy"}>{entry.mode === "llm" ? "Model-driven" : "Direct tool"}</Badge>
                {entry.networks.map((network) => <Badge key={network}>{network}</Badge>)}
              </span>
            </span>
          </button>
          {open === entry.id && (
            <div className="border-t border-line px-2.5 py-2 text-[12px]">
              <p><span className="font-semibold text-ink-2">Input:</span> {entry.input}</p>
              {entry.trace.length ? (
                <ol className="scroll-thin mt-1 max-h-48 overflow-auto rounded border border-line bg-surface p-2 font-mono text-[11px] leading-relaxed">
                  {entry.trace.map((line, index) => <li key={index} className={cx(line.status === "error" && "text-critical-text")}><span className="text-faint">{clock(line.t)}</span> {line.kind}:{line.phase} {line.label}{line.detail ? ` — ${line.detail}` : ""}</li>)}
                </ol>
              ) : <p className="mt-1 text-muted">No runtime events were recorded for this entry.</p>}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

export function AgentPanel() {
  const name = useUi((state) => state.inspectAgent);
  const close = useUi((state) => state.setInspectAgent);
  const peers = useStore((state) => state.peers);
  const activity = useStore((state) => state.activity);
  const activeIncidentId = useStore((state) => state.activeIncidentId);
  const busy = useUi((state) => state.busyIncident);
  const own = useOwnNetwork();
  const navigate = useNavigate();
  const identity = useMemo(() => (name ? identityFor(name, own, peers) : null), [name, own, peers]);
  const entries = useMemo(() => activity.filter((entry) => entry.agent === name).slice(-12).reverse(), [activity, name]);
  const running = entries.find((entry) => entry.status === "running");
  const last = entries[0];
  const step = STEPS.find((item) => item.agent === name && ["assess", "discover", "trust", "offers", "negotiate", "allocate", "logistics"].includes(item.id));

  const runOwnStep = async () => {
    if (!step || !activeIncidentId || useUi.getState().busyIncident) return;
    useUi.getState().setBusy(activeIncidentId);
    try { const outcome = await runStep(activeIncidentId, step.id); useUi.getState().notify(outcome.ok ? outcome.summary : outcome.reason || "The step did not complete.", outcome.ok ? "ok" : "warn"); } finally { useUi.getState().setBusy(null); }
  };

  return (
    <Drawer open={!!name} onClose={() => close(null)} title={<span className="inline-flex items-center gap-2 font-mono text-[15px]"><Bot size={16} className="text-accent-text" aria-hidden />{name}</span>} subtitle={identity ? `${identity.network.own ? "This site's network" : `Partner network: ${identity.network.label}`}` : "Agent details"} width={560}>
      {!name ? null : !identity ? (
        <Empty title="Unknown agent">No published network definition loaded in this browser names “{name}”. Connect the partner network first.</Empty>
      ) : (
        <div className="grid gap-5">
          <div className="flex flex-wrap items-center gap-2">
            {running ? <Badge tone="accent"><LiveDot tone="accent" /> Running</Badge> : last ? <Badge tone={last.status === "failed" ? "critical" : last.status === "warning" ? "warn" : "ok"}>Idle · last run {last.status}</Badge> : <Badge>Idle · never run here</Badge>}
            {identity.isFront && <Badge tone="navy">Front agent</Badge>}
            {identity.network.own ? <Badge tone="accent">reliefmesh_command</Badge> : <Badge tone={identity.network.peer?.discovery?.status === "connected" ? "ok" : "neutral"}>{identity.network.peer?.discovery?.status === "connected" ? "Network loaded" : "Not loaded"}</Badge>}
            {!identity.network.own && identity.network.peer && identity.network.peer.role !== "trust" && <TrustBadge decision={identity.network.peer.trust?.decision} score={identity.network.peer.trust?.score} />}
          </div>

          <section>
            <h3 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Identity</h3>
            <KeyValue items={[
              ["Agent", <span className="font-mono text-[12.5px]">{identity.name}</span>],
              ["Role", identity.description || "—"],
              ["Network", <span className="break-all font-mono text-[12px]">{identity.network.url}</span>],
              ["Origin", <span className="font-mono text-[12px]">{identity.network.origin}</span>],
              ["Runs in", identity.network.own ? "this browser, on this page" : "your browser, on your router, after consent (partner network)"],
            ]} />
          </section>

          <section>
            <h3 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Capabilities</h3>
            {identity.capabilities.length ? <ul className="flex flex-wrap gap-1">{identity.capabilities.map((item) => <li key={item}><Badge>{item}</Badge></li>)}</ul> : <p className="text-[12.5px] text-muted">None advertised.</p>}
            {identity.calls.length > 0 && <p className="mt-2 break-all text-[12px] text-ink-2"><span className="font-semibold">May call:</span> <span className="font-mono">{identity.calls.join(", ")}</span></p>}
          </section>

          <section>
            <h3 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Current task</h3>
            {running ? (
              <div className="rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-[13px]"><span className="font-semibold">{running.task}</span><span className="block text-[12px] text-muted">started {clock(running.at)}{running.networks.length ? ` · contacting ${running.networks.join(", ")}` : ""}</span></div>
            ) : <p className="text-[12.5px] text-muted">Nothing running. {last ? `Last activity ${relative(last.at)} (${time(last.at)}).` : ""}</p>}
          </section>

          <section>
            <h3 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Available actions</h3>
            <div className="flex flex-wrap gap-2">
              {identity.network.own && step && <Button size="sm" variant="primary" disabled={!activeIncidentId || !!busy} onClick={runOwnStep} title={`Runs ${step.title} for the active incident`}><Play size={13} aria-hidden />Run {step.title.toLowerCase()}</Button>}
              {identity.network.own && <Button size="sm" onClick={() => { close(null); setConsoleOpen(true); }}><Terminal size={13} aria-hidden />Ask in the agent console</Button>}
              {!identity.network.own && identity.network.peer && identity.network.peer.discovery?.status !== "connected" && <Button size="sm" variant="primary" onClick={() => { close(null); navigate("/network"); }}><Plug size={13} aria-hidden />Connect its network</Button>}
              {!identity.network.own && identity.network.peer && <a className="inline-flex items-center gap-1 rounded-md border border-line-strong bg-surface-3 px-2.5 py-1 text-[12.5px] font-semibold text-ink hover:bg-surface-4" href={identity.network.peer.siteUrl} target="_blank" rel="noreferrer"><ExternalLink size={12} aria-hidden />Open {identity.network.label}</a>}
            </div>
            {identity.network.own && <p className="mt-1.5 text-[12px] text-muted">An agent of this site never approves a plan or writes to a partner. Those actions are a person's, on the Approval Center.</p>}
          </section>

          <section>
            <h3 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Execution history ({entries.length})</h3>
            <History entries={entries} />
          </section>
        </div>
      )}
    </Drawer>
  );
}
