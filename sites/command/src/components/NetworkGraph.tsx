// Live view of the agent network: ReliefMesh Command in the middle, each independent
// partner site around it. A link is drawn only between sites that have really exchanged a
// request, and it animates only while a request is in flight. Nothing here is decorative:
// every state comes from the interaction log.
import { useMemo } from "react";
import { useStore } from "@/state/store";
import type { NetworkInteraction, PeerRecord } from "@/state/types";
import { STEPS } from "@/state/seed";

const ROLE_COLOR: Record<PeerRecord["role"], string> = { trust: "#166534", shelter: "#0f766e", supplier: "#1d4ed8", logistics: "#b45309", other: "#475569" };
const WIDTH = 760;
const HEIGHT = 380;
const CENTER = { x: WIDTH / 2, y: HEIGHT / 2 };

function position(index: number, total: number) {
  const angle = (-Math.PI / 2) + (index / Math.max(1, total)) * Math.PI * 2 + Math.PI / 4;
  return { x: CENTER.x + Math.cos(angle) * 270, y: CENTER.y + Math.sin(angle) * 132 };
}

function linkState(interactions: NetworkInteraction[]) {
  const pending = interactions.filter((item) => item.status === "pending").length;
  const ok = interactions.filter((item) => item.status === "ok").length;
  const failed = interactions.filter((item) => item.status === "failed" || item.status === "refused").length;
  const declined = interactions.filter((item) => item.status === "declined").length;
  const last = interactions[interactions.length - 1];
  return { pending, ok, failed, declined, last, total: interactions.length };
}

export function NetworkGraph() {
  const peers = useStore((state) => state.peers);
  const interactions = useStore((state) => state.interactions);
  const activeStep = useStore((state) => {
    const run = state.activeIncidentId ? state.runs[state.activeIncidentId] : null;
    return run ? STEPS.find((step) => run.steps[step.id].status === "running") : undefined;
  });
  const list = useMemo(() => Object.values(peers), [peers]);

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Agent network: ReliefMesh Command and its partner sites" className="h-auto w-full">
        {list.map((peer, index) => {
          const at = position(index, list.length);
          const state = linkState(interactions.filter((item) => item.to === peer.id));
          if (!state.total) return null;
          const color = state.pending ? "#1d4ed8" : state.last?.status === "ok" ? "#15803d" : state.last?.status === "declined" ? "#94a3b8" : "#b42318";
          const mid = { x: (CENTER.x + at.x) / 2, y: (CENTER.y + at.y) / 2 };
          return (
            <g key={`link-${peer.id}`}>
              <line x1={CENTER.x} y1={CENTER.y} x2={at.x} y2={at.y} stroke={color} strokeWidth={state.pending ? 2.5 : 1.75} className={state.pending ? "rm-link-active" : undefined} strokeDasharray={!state.pending && state.last?.status === "declined" ? "3 5" : undefined} />
              <g transform={`translate(${mid.x}, ${mid.y})`}>
                <rect x={-46} y={-11} width={92} height={22} rx={11} fill="#fff" stroke="#d9e0ea" />
                <text textAnchor="middle" y={4} fontSize={11} fontWeight={600} fill="#33415c">
                  {state.pending ? "calling…" : `${state.ok} ok${state.failed ? ` · ${state.failed} failed` : ""}${state.declined ? ` · ${state.declined} declined` : ""}`}
                </text>
              </g>
            </g>
          );
        })}

        <g transform={`translate(${CENTER.x}, ${CENTER.y})`}>
          <rect x={-104} y={-38} width={208} height={76} rx={12} fill="#12305a" />
          <text textAnchor="middle" y={-12} fontSize={13.5} fontWeight={700} fill="#fff">ReliefMesh Command</text>
          <text textAnchor="middle" y={5} fontSize={11} fill="#c7d5ea">{activeStep ? activeStep.agent : "EmergencyCommanderAgent"}</text>
          <text textAnchor="middle" y={22} fontSize={10.5} fill="#9db3d3">{activeStep ? `running: ${activeStep.title.toLowerCase()}` : "10 agents · this origin"}</text>
        </g>

        {list.map((peer, index) => {
          const at = position(index, list.length);
          const status = peer.discovery?.status;
          const trust = peer.role === "trust" ? (status === "connected" ? "trust anchor" : "") : peer.trust?.decision ?? "";
          const trustColor = trust === "verified" || trust === "trust anchor" ? "#15803d" : trust === "caution" ? "#c2410c" : trust === "blocked" ? "#b42318" : "#64748b";
          let host = peer.networkUrl;
          try { host = new URL(peer.networkUrl).host; } catch { /* keep the raw value */ }
          return (
            <g key={peer.id} transform={`translate(${at.x}, ${at.y})`}>
              <rect x={-88} y={-36} width={176} height={72} rx={10} fill="#fff" stroke={status === "connected" ? ROLE_COLOR[peer.role] : "#c3cbd9"} strokeWidth={status === "connected" ? 2 : 1.25} strokeDasharray={status === "connected" ? undefined : "4 4"} />
              <rect x={-88} y={-36} width={6} height={72} rx={3} fill={ROLE_COLOR[peer.role]} />
              <text x={-72} y={-15} fontSize={12.5} fontWeight={700} fill="#0f1f3d">{peer.label}</text>
              <text x={-72} y={1} fontSize={10.5} fill="#5b6b85">{host}</text>
              <text x={-72} y={17} fontSize={10.5} fill="#5b6b85">
                {status === "connected" ? `${peer.discovery!.agents.length} agents · ${peer.discovery!.actions.length} shared actions` : status === "declined" ? "contact declined" : status === "failed" ? "could not be loaded" : status === "policy-refused" ? "not in allowed_peers" : "not contacted yet"}
              </text>
              {trust && <text x={-72} y={30} fontSize={10.5} fontWeight={700} fill={trustColor}>{trust}{peer.trust ? ` · ${peer.trust.score}` : ""}</text>}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        <span><span className="mr-1 inline-block h-0.5 w-4 bg-ok align-middle" />last request succeeded</span>
        <span><span className="mr-1 inline-block h-0.5 w-4 bg-info align-middle" />request in flight</span>
        <span><span className="mr-1 inline-block h-0.5 w-4 bg-critical align-middle" />last request failed</span>
        <span>A link appears only after a real request to that origin. Dashed box: not connected.</span>
      </figcaption>
    </figure>
  );
}

export function InteractionLog({ limit = 14 }: { limit?: number }) {
  const interactions = useStore((state) => state.interactions);
  const peers = useStore((state) => state.peers);
  const rows = interactions.slice(-limit).reverse();
  if (!rows.length) return <p className="text-[13px] text-muted">No cross-origin interactions yet.</p>;
  const kind = { consent: "Consent", discover: "Load network", read: "Shared read", write: "Shared write", llm: "Partner network (model)" } as const;
  const tone = { pending: "text-info", ok: "text-ok", failed: "text-critical", declined: "text-muted", refused: "text-critical" } as const;
  return (
    <ol className="grid gap-1 text-[12.5px]">
      {rows.map((item) => (
        <li key={item.id} className="rm-fade-in flex flex-wrap items-baseline gap-x-2 border-b border-line py-1 last:border-b-0">
          <span className="tabular text-slate-400">{new Date(item.at).toLocaleTimeString("en-IN")}</span>
          <span className="font-semibold">Command → {peers[item.to]?.label ?? item.to}</span>
          <span className="text-ink-2">{kind[item.kind]}: <span className="font-mono text-[12px]">{item.label}</span></span>
          <span className={`font-semibold ${tone[item.status]}`}>{item.status}{item.durationMs !== undefined ? ` · ${item.durationMs} ms` : ""}</span>
          {item.detail && item.status !== "ok" && <span className="basis-full text-muted">{item.detail}</span>}
        </li>
      ))}
    </ol>
  );
}
