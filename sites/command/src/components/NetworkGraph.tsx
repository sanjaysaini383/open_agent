// Live view of the agent network: this site's ten agents around the commander in the
// middle, each independent partner site around them. Every state comes from the activity
// and interaction logs: an agent pulses while its task runs, a link to a partner is drawn
// only after a real request, carries moving particles only while one is in flight, and is
// coloured by the outcome of the last request. Clicking a node opens its details panel.
import { useMemo } from "react";
import { useReducedMotion } from "framer-motion";
import { useTheme } from "@/lib/theme";
import { AGENTS, STEPS } from "@/state/seed";
import { useStore } from "@/state/store";
import type { NetworkInteraction, PeerRecord } from "@/state/types";
import { useUi } from "@/state/ui";
import { Badge, cx } from "./ui";

const ROLE_COLOR: Record<"dark" | "light", Record<PeerRecord["role"], string>> = {
  dark: { trust: "#7fcfa6", shelter: "#6fdccf", supplier: "#d1e8e2", logistics: "#ffcb9a", other: "#93aba5" },
  light: { trust: "#5f8f5a", shelter: "#e98074", supplier: "#8e8d8a", logistics: "#c9a66b", other: "#b3b0aa" },
};
const WIDTH = 960;
const HEIGHT = 540;
const CENTER = { x: WIDTH / 2, y: HEIGHT / 2 };
const INNER_RADIUS = 152;
const OUTER = { x: 385, y: 215 };

const SHORT: Record<string, string> = {
  EmergencyCommanderAgent: "Commander", NeedAssessmentAgent: "Needs", DiscoveryAgent: "Discovery", TrustVerificationAgent: "Trust", SupplierMatchingAgent: "Suppliers",
  NegotiationAgent: "Negotiation", ResourceAllocationAgent: "Allocation", LogisticsAgent: "Logistics", RiskAnalysisAgent: "Risk", AuditAgent: "Audit",
};

function ringPosition(index: number, total: number) {
  const angle = -Math.PI / 2 + (index / Math.max(1, total)) * Math.PI * 2;
  return { x: CENTER.x + Math.cos(angle) * INNER_RADIUS, y: CENTER.y + Math.sin(angle) * INNER_RADIUS };
}

function outerPosition(index: number, total: number) {
  // Partners sit on an ellipse, starting top-right and avoiding the exact top and bottom.
  const angle = -Math.PI / 2 + Math.PI / 4 + (index / Math.max(1, total)) * Math.PI * 2;
  return { x: CENTER.x + Math.cos(angle) * OUTER.x, y: CENTER.y + Math.sin(angle) * OUTER.y };
}

function linkState(interactions: NetworkInteraction[]) {
  const pending = interactions.filter((item) => item.status === "pending");
  const ok = interactions.filter((item) => item.status === "ok").length;
  const failed = interactions.filter((item) => item.status === "failed" || item.status === "refused").length;
  const declined = interactions.filter((item) => item.status === "declined").length;
  const last = interactions[interactions.length - 1];
  return { pending: pending.length, pendingAgent: pending[pending.length - 1]?.agent, ok, failed, declined, last, total: interactions.length };
}

/** Particles travelling along a link while a request is in flight. */
function Particles({ from, to, color, count = 3 }: { from: { x: number; y: number }; to: { x: number; y: number }; color: string; count?: number }) {
  const off = useReducedMotion();
  if (off) return null;
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <circle key={index} r={3} fill={color} opacity={0.9}>
          <animate attributeName="cx" from={from.x} to={to.x} dur="1.1s" begin={`${(index * 1.1) / count}s`} repeatCount="indefinite" />
          <animate attributeName="cy" from={from.y} to={to.y} dur="1.1s" begin={`${(index * 1.1) / count}s`} repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;0.95;0.95;0" dur="1.1s" begin={`${(index * 1.1) / count}s`} repeatCount="indefinite" />
        </circle>
      ))}
    </>
  );
}

export function NetworkGraph({ compact = false }: { compact?: boolean }) {
  const peers = useStore((state) => state.peers);
  const interactions = useStore((state) => state.interactions);
  const activity = useStore((state) => state.activity);
  const activeIncidentId = useStore((state) => state.activeIncidentId);
  const runs = useStore((state) => state.runs);
  const inspect = useUi((state) => state.setInspectAgent);
  const theme = useTheme();
  const off = useReducedMotion();
  const dark = theme === "dark";

  const list = useMemo(() => Object.values(peers), [peers]);
  const running = useMemo(() => new Set(activity.filter((item) => item.status === "running").map((item) => item.agent)), [activity]);
  const lastByAgent = useMemo(() => {
    const map = new Map<string, (typeof activity)[number]>();
    for (const item of activity) map.set(item.agent, item);
    return map;
  }, [activity]);
  const run = activeIncidentId ? runs[activeIncidentId] : null;
  const activeStep = run ? STEPS.find((step) => run.steps[step.id].status === "running") : undefined;

  const ink = dark ? "#e7f2ef" : "#2b2927";
  const muted = dark ? "#93aba5" : "#8e8d8a";
  const faint = dark ? "#43524d" : "#c9b797";
  const surface = dark ? "#2c3531" : "#f8f6f0";
  const surface2 = dark ? "#222c29" : "#efebe0";
  const accent = dark ? "#6fdccf" : "#e85a4f";
  const okColor = dark ? "#7fcfa6" : "#5f8f5a";
  const failColor = dark ? "#e3796a" : "#c8382d";

  const agentNodes = AGENTS.filter((agent) => agent.name !== "EmergencyCommanderAgent");

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Agent network: ReliefMesh Command's agents and its partner sites" className="h-auto w-full select-none">
        <defs>
          <radialGradient id="rm-hub-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={accent} stopOpacity={dark ? 0.22 : 0.14} />
            <stop offset="100%" stopColor={accent} stopOpacity={0} />
          </radialGradient>
        </defs>
        <circle cx={CENTER.x} cy={CENTER.y} r={INNER_RADIUS + 60} fill="url(#rm-hub-glow)" />
        <circle cx={CENTER.x} cy={CENTER.y} r={INNER_RADIUS} fill="none" stroke={faint} strokeDasharray="2 6" />

        {/* partner links: drawn only after a real request */}
        {list.map((peer, index) => {
          const at = outerPosition(index, list.length);
          const state = linkState(interactions.filter((item) => item.to === peer.id));
          if (!state.total) return null;
          const color = state.pending ? accent : state.last?.status === "ok" ? okColor : state.last?.status === "declined" ? muted : failColor;
          // The link starts at the agent that made the last request, when it is known.
          const agentName = state.pendingAgent ?? state.last?.agent;
          const agentIndex = agentNodes.findIndex((agent) => agent.name === agentName);
          const from = agentIndex >= 0 ? ringPosition(agentIndex, agentNodes.length) : CENTER;
          const mid = { x: (from.x + at.x) / 2, y: (from.y + at.y) / 2 };
          const label = state.pending ? "calling…" : `${state.ok} ok${state.failed ? ` · ${state.failed} failed` : ""}${state.declined ? ` · ${state.declined} declined` : ""}`;
          return (
            <g key={`link-${peer.id}`}>
              <line x1={from.x} y1={from.y} x2={at.x} y2={at.y} stroke={color} strokeWidth={state.pending ? 2.5 : 1.5} strokeOpacity={state.pending ? 1 : 0.8} className={state.pending && !off ? "rm-link-active" : undefined} strokeDasharray={!state.pending && state.last?.status === "declined" ? "3 5" : undefined} />
              {state.pending > 0 && <Particles from={from} to={at} color={accent} />}
              <g transform={`translate(${mid.x}, ${mid.y})`}>
                <rect x={-48} y={-10} width={96} height={20} rx={10} fill={surface2} stroke={faint} />
                <text textAnchor="middle" y={4} fontSize={10.5} fontWeight={600} fill={state.pending ? accent : muted}>{label}</text>
              </g>
            </g>
          );
        })}

        {/* spokes from the commander to each agent */}
        {agentNodes.map((agent, index) => {
          const at = ringPosition(index, agentNodes.length);
          const active = running.has(agent.name);
          return <line key={`spoke-${agent.name}`} x1={CENTER.x} y1={CENTER.y} x2={at.x} y2={at.y} stroke={active ? accent : faint} strokeWidth={active ? 2 : 1} strokeOpacity={active ? 0.9 : 0.6} className={active && !off ? "rm-link-active" : undefined} />;
        })}

        {/* the commander */}
        <g transform={`translate(${CENTER.x}, ${CENTER.y})`} className="cursor-pointer" onClick={() => inspect("EmergencyCommanderAgent")} role="button" tabIndex={0} aria-label="EmergencyCommanderAgent details" onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inspect("EmergencyCommanderAgent"); }}>
          {running.has("EmergencyCommanderAgent") && !off && <circle r={46} fill="none" stroke={accent} strokeWidth={2}><animate attributeName="r" values="42;62" dur="1.6s" repeatCount="indefinite" /><animate attributeName="opacity" values="0.7;0" dur="1.6s" repeatCount="indefinite" /></circle>}
          <circle r={48} fill={surface} stroke={running.has("EmergencyCommanderAgent") ? accent : faint} strokeWidth={2} />
          <text textAnchor="middle" y={-4} fontSize={13} fontWeight={700} fill={ink}>Commander</text>
          <text textAnchor="middle" y={12} fontSize={10.5} fill={muted}>{activeStep ? `step ${activeStep.number}` : "ReliefMesh"}</text>
        </g>

        {/* the specialists */}
        {agentNodes.map((agent, index) => {
          const at = ringPosition(index, agentNodes.length);
          const active = running.has(agent.name);
          const last = lastByAgent.get(agent.name);
          const stroke = active ? accent : last?.status === "failed" ? failColor : last?.status === "done" || last?.status === "warning" ? okColor : faint;
          const owns = STEPS.find((step) => step.agent === agent.name);
          const stepState = owns && run ? run.steps[owns.id].status : undefined;
          return (
            <g key={agent.name} transform={`translate(${at.x}, ${at.y})`} className="cursor-pointer" onClick={() => inspect(agent.name)} role="button" tabIndex={0} aria-label={`${agent.name} details`} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inspect(agent.name); }}>
              {active && !off && <circle r={24} fill="none" stroke={accent} strokeWidth={1.5}><animate attributeName="r" values="24;40" dur="1.4s" repeatCount="indefinite" /><animate attributeName="opacity" values="0.8;0" dur="1.4s" repeatCount="indefinite" /></circle>}
              <circle r={23} fill={active ? accent : surface} stroke={stroke} strokeWidth={active ? 0 : 1.75} />
              <text textAnchor="middle" y={4.5} fontSize={12} fontWeight={700} fill={active ? (dark ? "#07201e" : "#fff") : ink}>{owns ? owns.number : "·"}</text>
              <text textAnchor="middle" y={38} fontSize={11.5} fontWeight={600} fill={active ? accent : muted}>{SHORT[agent.name] ?? agent.name}</text>
              {stepState === "done" && <circle cx={17} cy={-16} r={4} fill={okColor} />}
              {stepState === "warning" && <circle cx={17} cy={-16} r={4} fill={dark ? "#d9b08c" : "#c07d3a"} />}
              {stepState === "failed" && <circle cx={17} cy={-16} r={4} fill={failColor} />}
            </g>
          );
        })}

        {/* partner networks */}
        {list.map((peer, index) => {
          const at = outerPosition(index, list.length);
          const status = peer.discovery?.status;
          const connected = status === "connected";
          const trust = peer.role === "trust" ? (connected ? "trust anchor" : "") : peer.trust?.decision ?? "";
          const trustColor = trust === "verified" || trust === "trust anchor" ? okColor : trust === "caution" ? (dark ? "#d9b08c" : "#c07d3a") : trust === "blocked" ? failColor : muted;
          const pending = interactions.some((item) => item.to === peer.id && item.status === "pending");
          let host = peer.networkUrl;
          try { host = new URL(peer.networkUrl).host; } catch { /* keep the raw value */ }
          const front = peer.discovery?.frontAgent;
          const open = () => { if (front) inspect(front); };
          return (
            <g key={peer.id} transform={`translate(${at.x}, ${at.y})`} className={cx(front && "cursor-pointer")} onClick={open} role={front ? "button" : undefined} tabIndex={front ? 0 : undefined} aria-label={front ? `${peer.label}: ${front} details` : undefined} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") open(); }}>
              {pending && !off && <rect x={-96} y={-40} width={192} height={80} rx={12} fill="none" stroke={accent} strokeWidth={1.5} opacity={0.6}><animate attributeName="opacity" values="0.6;0.1;0.6" dur="1.2s" repeatCount="indefinite" /></rect>}
              <rect x={-90} y={-36} width={180} height={72} rx={10} fill={surface} stroke={connected ? ROLE_COLOR[theme][peer.role] : faint} strokeWidth={connected ? 1.75 : 1.25} strokeDasharray={connected ? undefined : "4 4"} />
              <rect x={-90} y={-36} width={5} height={72} rx={2.5} fill={ROLE_COLOR[theme][peer.role]} opacity={connected ? 1 : 0.5} />
              <text x={-76} y={-15} fontSize={12.5} fontWeight={700} fill={ink}>{peer.label}</text>
              <text x={-76} y={1} fontSize={10} fill={muted} fontFamily="ui-monospace, monospace">{host}</text>
              <text x={-76} y={16} fontSize={10} fill={muted}>
                {connected ? `${peer.discovery!.agents.length} agents · ${peer.discovery!.actions.length} shared actions` : status === "declined" ? "contact declined" : status === "failed" ? "could not be loaded" : status === "policy-refused" ? "not in allowed_peers" : "not contacted yet"}
              </text>
              {trust && <text x={-76} y={29} fontSize={10} fontWeight={700} fill={trustColor}>{trust}{peer.trust ? ` · ${peer.trust.score}` : ""}</text>}
            </g>
          );
        })}
      </svg>
      {!compact && (
        <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
          <span><span className="mr-1 inline-block h-0.5 w-4 bg-ok align-middle" />last request succeeded</span>
          <span><span className="mr-1 inline-block h-0.5 w-4 bg-accent align-middle" />request in flight (particles)</span>
          <span><span className="mr-1 inline-block h-0.5 w-4 bg-critical align-middle" />last request failed</span>
          <span>Numbered nodes own a workflow step. A link appears only after a real request to that origin; dashed box: not connected. Click a node for details.</span>
        </figcaption>
      )}
    </figure>
  );
}

export function InteractionLog({ limit = 14 }: { limit?: number }) {
  const interactions = useStore((state) => state.interactions);
  const peers = useStore((state) => state.peers);
  const rows = interactions.slice(-limit).reverse();
  if (!rows.length) return <p className="text-[13px] text-muted">No cross-origin interactions yet.</p>;
  const kind = { consent: "Consent", discover: "Load network", read: "Shared read", write: "Shared write", llm: "Partner network (model)" } as const;
  const tone = { pending: "text-accent-text", ok: "text-ok-text", failed: "text-critical-text", declined: "text-muted", refused: "text-critical-text" } as const;
  return (
    <ol className="grid gap-1 text-[12.5px]">
      {rows.map((item) => (
        <li key={item.id} className="rm-fade-in flex flex-wrap items-baseline gap-x-2 border-b border-line py-1 last:border-b-0">
          <span className="tabular text-faint">{new Date(item.at).toLocaleTimeString("en-IN")}</span>
          <span className="font-semibold">{item.agent ? <span className="font-mono text-[12px]">{item.agent}</span> : "Command"} → {peers[item.to]?.label ?? item.to}</span>
          <span className="text-ink-2">{kind[item.kind]}: <span className="font-mono text-[12px]">{item.label}</span></span>
          <span className={`font-semibold ${tone[item.status]}`}>{item.status}{item.durationMs !== undefined ? ` · ${item.durationMs} ms` : ""}</span>
          {item.kind === "llm" && <Badge tone="info">model-driven</Badge>}
          {item.detail && item.status !== "ok" && <span className="basis-full text-muted">{item.detail}</span>}
        </li>
      ))}
    </ol>
  );
}
