import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ExternalLink, FlaskConical, Radar, Search } from "lucide-react";
import { InteractionLog, NetworkGraph } from "@/components/NetworkGraph";
import { PartnerExplorer } from "@/components/PartnerExplorer";
import { RegisterPartner } from "@/components/RegisterPartner";
import { Badge, Button, Card, CardHeader, Empty, Field, KeyValue, LiveBadge, Notice, PageHeader, Stat, Table, Td, Th, inputClass } from "@/components/ui";
import { shelterOverview } from "@/domain/schemas";
import { searchNandaIndex, type NandaSearch } from "@/interop/discovery";
import { callRead, openPeer } from "@/interop/peers";
import { registryFile } from "@/lib/boot";
import { useOwnNetwork } from "@/lib/ownNetwork";
import { AGENTS } from "@/state/seed";
import { useActiveIncident, useStore } from "@/state/store";
import { useUi } from "@/state/ui";
import { withActivity } from "@/workflow/context";
import { runStep } from "@/workflow/steps";

function OwnNetworkCard() {
  const own = useOwnNetwork();
  const runtime = useUi((state) => state.runtime);
  const inspect = useUi((state) => state.setInspectAgent);
  return (
    <Card>
      <CardHeader title="This site's network" subtitle="Loaded by the official runtime from this origin's published files." actions={<a className="text-[12.5px] font-semibold text-accent-text underline" href="./reliefmesh_command.network.json" target="_blank" rel="noreferrer">network definition</a>} />
      {own ? (
        <div className="grid gap-4">
          <KeyValue items={[
            ["Network name", <span className="font-mono text-[12.5px]">{own.name}</span>],
            ["Network URL", <span className="break-all font-mono text-[12.5px]">{own.url}</span>],
            ["Front agent", <span className="font-mono text-[12.5px]">{own.front}</span>],
            ["Peer policy", <>{own.policy} — may contact only: <span className="font-mono text-[12px]">{own.allowedPeers.join(", ") || "none"}</span></>],
            ["Site actions", <span className="flex flex-wrap gap-1">{own.actions.map((action) => <Badge key={action.name} tone={action.effect === "read" ? "ok" : action.effect === "irreversible" ? "warn" : "neutral"}>{action.name}</Badge>)}</span>],
          ]} />
          <Table label="Agents in this network">
            <thead><tr><Th>Agent</Th><Th>Responsibility</Th><Th>May call</Th></tr></thead>
            <tbody>
              {own.agents.map((agent) => (
                <tr key={agent.name}>
                  <Td className="font-mono text-[12.5px] font-semibold"><button type="button" className="hover:text-accent-text" onClick={() => inspect(agent.name)}>{agent.name}</button>{agent.name === own.front && <div><Badge tone="navy">front agent</Badge></div>}</Td>
                  <Td>{agent.description}<div className="text-[11.5px] text-muted">{AGENTS.find((item) => item.name === agent.name)?.role}</div></Td>
                  <Td className="break-all font-mono text-[11.5px]">{agent.calls.join(", ") || "website tools only"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      ) : <Empty title={runtime.state === "failed" ? "The agent runtime did not load" : "Loading the network…"}>{runtime.state === "failed" ? runtime.error : "The runtime reads agent-manifest.json and the network definition from this origin."}</Empty>}
    </Card>
  );
}

/** One independent website calling another, end to end, with the receipt shown. */
function InteropTest() {
  const [result, setResult] = useState<{ ok: boolean; lines: [string, React.ReactNode][] } | null>(null);
  const [busy, setBusy] = useState(false);
  const incident = useActiveIncident();
  const shelter = useStore((state) => Object.values(state.peers).find((peer) => peer.role === "shelter"));

  const run = async () => {
    if (!shelter || !incident) return;
    setBusy(true);
    setResult(null);
    const started = performance.now();
    let detail: [string, React.ReactNode][] = [];
    const outcome = await withActivity({ incidentId: incident.id, agent: "DiscoveryAgent", task: "Interoperability test: call a shared action on another origin" }, async (ctx) => {
      const grant = await openPeer(shelter.id, ctx.call, "Interoperability test: read the shelter overview", { calls: ["get_shelter_overview"], dataShared: "Nothing. One read with no arguments." });
      ctx.contacted(shelter);
      const data = await callRead(grant, "get_shelter_overview", {}, shelterOverview);
      const peer = useStore.getState().peers[shelter.id];
      detail = [
        ["Caller origin", <span className="font-mono text-[12.5px]">{window.location.origin}</span>],
        ["Called origin", <span className="font-mono text-[12.5px]">{new URL(shelter.networkUrl).origin}</span>],
        ["Cross-origin", window.location.origin !== new URL(shelter.networkUrl).origin ? <Badge tone="ok">Yes: different origins</Badge> : <Badge tone="warn">No: same origin</Badge>],
        ["Network loaded", <span className="break-all font-mono text-[12px]">{peer.discovery?.fetched.network}</span>],
        ["Action", <span className="font-mono text-[12.5px]">get_shelter_overview (read, ran in a hidden frame on the called origin)</span>],
        ["Result", `${data.shelters.length} shelters returned by ${data.source || shelter.label}; passed schema validation`],
        ["Marked by the partner as", data.simulated ? "simulated data" : "not marked simulated"],
        ["Round trip", `${Math.round(performance.now() - started)} ms including consent`],
      ];
      return { summary: `${shelter.label} answered a cross-origin read with ${data.shelters.length} shelters.` };
    });
    setResult({ ok: outcome.ok, lines: outcome.ok ? detail : [["Result", outcome.reason || "The test did not complete."]] });
    setBusy(false);
  };

  return (
    <Card>
      <CardHeader icon={<FlaskConical size={16} aria-hidden />} title="Interoperability test" subtitle="Calls a capability exposed by another independent website, from this one, and shows what crossed the boundary." actions={<Button variant="primary" busy={busy} disabled={!shelter || !incident} onClick={run}>Run the test</Button>} />
      {result ? <><Notice tone={result.ok ? "ok" : "warn"} title={result.ok ? "A real cross-origin interaction completed" : "The test did not complete"}>{result.ok ? "No response was hardcoded or replayed: the partner's own code produced it on the partner's origin." : "Nothing was faked to make it pass."}</Notice><div className="mt-3"><KeyValue items={result.lines} /></div></>
        : <p className="text-[13px] text-muted">The runtime asks for your consent, checks allowed_peers, fetches the partner's manifest and network definition, opens its action bridge in a hidden frame on the partner's origin, validates the arguments against the partner's schema, runs the read there and returns a receipt.</p>}
    </Card>
  );
}

function NandaLookup() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<NandaSearch | null>(null);
  const [busy, setBusy] = useState(false);
  const search = async () => {
    setBusy(true);
    const found = await searchNandaIndex(registryFile?.nandaApiBase ?? null, query);
    setResult(found);
    setBusy(false);
    const store = useStore.getState();
    await store.record({ kind: "network", actor: "DiscoveryAgent", incidentId: store.activeIncidentId, summary: found.status === "ok" ? `NANDA Index live search "${found.query}": ${found.count} result(s)` : `NANDA Index search "${found.query}" ${found.status}: ${found.reason}`, data: { source: "nanda-index-live", status: found.status } });
  };
  return (
    <Card>
      <CardHeader icon={<Radar size={16} aria-hidden />} title="NANDA Index lookup" subtitle={<>A live search of the public agent index at <span className="font-mono text-[12px]">{registryFile?.nandaApiBase ?? "not configured"}</span>. Separate from the local partner registry above; a result is a candidate, not a partner.</>} actions={<LiveBadge label="Live third-party lookup" />} />
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void search(); }}>
        <div className="min-w-[220px] flex-1"><Field label="Search words"><input className={inputClass} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="relief, logistics, shelter…" maxLength={80} /></Field></div>
        <Button variant="primary" busy={busy} disabled={query.trim().length < 2} onClick={search}><Search size={14} aria-hidden />Search the index</Button>
      </form>
      {result && (
        <div className="mt-3">
          {result.status === "ok" ? (
            result.results.length ? (
              <Table label="NANDA Index results">
                <thead><tr><Th>Name</Th><Th>Identifier</Th><Th>Description</Th><Th>Registry URL</Th></tr></thead>
                <tbody>{result.results.map((item) => (
                  <tr key={item.orgId}><Td className="font-medium">{item.displayName}</Td><Td className="font-mono text-[11.5px]">{item.orgId}</Td><Td className="text-muted">{item.description || "—"}</Td><Td>{item.registryUrl ? <a className="inline-flex items-center gap-1 break-all text-accent-text underline" href={item.registryUrl} target="_blank" rel="noreferrer">{item.registryUrl}<ExternalLink size={11} aria-hidden /></a> : "—"}</Td></tr>
                ))}</tbody>
              </Table>
            ) : <Notice tone="info">The NANDA Index answered and has no entry matching “{result.query}”. That is a real, empty result; nothing was substituted from the local registry.</Notice>
          ) : <Notice tone="warn">{result.reason}</Notice>}
          {result.status === "ok" && <p className="mt-2 text-[12px] text-muted">Source: live response from <span className="font-mono">{result.endpoint}</span>. To use a result as a partner, register its network URL below; it is then loaded, checked against allowed origins and verified like any other partner.</p>}
        </div>
      )}
    </Card>
  );
}

export function AgentNetworkPage() {
  const incident = useActiveIncident();
  const busy = useUi((state) => state.busyIncident);
  const peers = useStore((state) => state.peers);
  const interactions = useStore((state) => state.interactions);
  const [params, setParams] = useSearchParams();
  const discover = async () => {
    if (!incident || useUi.getState().busyIncident) return;
    useUi.getState().setBusy(incident.id);
    try { const outcome = await runStep(incident.id, "discover"); useUi.getState().notify(outcome.ok ? outcome.summary : outcome.reason || "Discovery did not complete.", outcome.ok ? "ok" : "warn"); } finally { useUi.getState().setBusy(null); }
  };
  useEffect(() => {
    if (params.get("discover") === "1") { setParams({}, { replace: true }); void discover(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  const inspector = registryFile?.inspector;
  const list = Object.values(peers);
  const connected = list.filter((peer) => peer.discovery?.status === "connected").length;
  const verified = list.filter((peer) => peer.role !== "trust" && peer.trust?.decision === "verified").length;
  const calls = interactions.filter((item) => item.kind !== "consent");
  const ok = calls.filter((item) => item.status === "ok").length;
  return (
    <>
      <PageHeader
        eyebrow="Agent network explorer"
        title="Agent Network"
        subtitle="Five independent agentic websites, each publishing its own manifest and network definition. This page shows what this site has learnt about the others from their public files, and every request it has sent them."
        actions={<>
          {inspector && <a href={inspector} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface-3 px-3.5 py-2 text-[13.5px] font-semibold text-ink hover:bg-surface-4"><ExternalLink size={14} aria-hidden />Interoperability Inspector</a>}
          <Button variant="primary" busy={!!incident && busy === incident.id} disabled={!incident || !!busy} onClick={discover}><Radar size={14} aria-hidden />Discover partner networks</Button>
        </>}
      />
      <div className="grid gap-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Registered networks" number={list.length} hint={`${list.filter((peer) => peer.source === "user-registered").length} registered on this device`} />
          <Stat label="Loaded" number={connected} format={(value) => `${Math.round(value)} / ${list.length}`} tone={connected === list.length && connected ? "ok" : connected ? "info" : "neutral"} hint="public files really loaded" />
          <Stat label="Verified partners" number={verified} format={(value) => `${Math.round(value)} / ${list.filter((peer) => peer.role !== "trust").length}`} tone={verified ? "ok" : "neutral"} hint="signatures checked" />
          <Stat label="Cross-origin requests" number={calls.length} tone={calls.length ? "info" : "neutral"} delta={calls.length ? `${Math.round((ok / calls.length) * 100)}% succeeded` : undefined} deltaTone={calls.length && ok === calls.length ? "ok" : "warn"} />
        </div>
        <Card>
          <CardHeader title="Live network" subtitle="Links appear after a real request and carry particles while one is in flight. Click a node for the agent's identity, task, history and actions." />
          <NetworkGraph />
          <div className="mt-4 border-t border-line pt-3"><h3 className="mb-1.5 text-[13px] font-semibold">Cross-origin interactions</h3><InteractionLog limit={16} /></div>
        </Card>
        <Card>
          <CardHeader title="Agent Network Explorer" subtitle="Per network: name, URL, agents, capabilities, shared actions, partner networks, connection and verification status, last successful interaction and communication errors. Open a network for details." />
          <PartnerExplorer />
          <div className="mt-4">
            <h3 className="mb-1.5 text-[13px] font-semibold">Add a partner network</h3>
            <RegisterPartner />
            <p className="mt-2 text-[12.5px] text-muted">The published policy is closed: the runtime refuses every origin outside <span className="font-mono">allowed_peers</span>. Registering a partner here adds its origin to the runtime's allowed list for this browser only, after you confirm. It does not change the published manifest.</p>
          </div>
        </Card>
        <div className="grid gap-5 xl:grid-cols-2"><InteropTest /><NandaLookup /></div>
        <OwnNetworkCard />
      </div>
    </>
  );
}
