// Agent Network Explorer: for each network, its name, URL, agents, capabilities, shared
// actions, partner networks, connection status, verification status, last successful
// interaction and communication errors. Everything shown was read from that site's own
// public files during discovery, or from this browser's interaction log. A network is
// called "connected" only after its files really loaded.
import { useState } from "react";
import { Bot, ChevronDown, ChevronRight, ExternalLink, FileJson, Plug, Radar, Unplug } from "lucide-react";
import { askConsent, connect, disconnect } from "@/interop/peers";
import { registryFile } from "@/lib/boot";
import { useStore } from "@/state/store";
import type { PeerRecord } from "@/state/types";
import { useUi } from "@/state/ui";
import { Collapse } from "./motion";
import { Badge, Button, Drawer, Empty, KeyValue, LiveBadge, Notice, TrustBadge, cx, relative, time } from "./ui";

function ConnectionBadge({ peer }: { peer: PeerRecord }) {
  const status = peer.discovery?.status;
  if (status === "connected") return <Badge tone="ok">Connected</Badge>;
  if (status === "declined") return <Badge tone="neutral">Contact declined</Badge>;
  if (status === "policy-refused") return <Badge tone="critical">Not in allowed_peers</Badge>;
  if (status === "failed") return <Badge tone="critical">Failed</Badge>;
  return <Badge tone="neutral">Not contacted</Badge>;
}

function useLinkStats(peerId: string) {
  const interactions = useStore((state) => state.interactions);
  const mine = interactions.filter((item) => item.to === peerId && item.kind !== "consent");
  const lastOk = [...mine].reverse().find((item) => item.status === "ok");
  const errors = mine.filter((item) => item.status === "failed" || item.status === "refused");
  return { total: mine.length, lastOk, errors, lastError: errors[errors.length - 1] };
}

function ManifestDrawer({ peer, onClose }: { peer: PeerRecord | null; onClose: () => void }) {
  const [text, setText] = useState<string>("");
  const [error, setError] = useState("");
  const url = peer?.discovery?.fetched.manifest;
  const load = async () => {
    if (!url) return;
    setText(""); setError("");
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setText(JSON.stringify(await response.json(), null, 2));
    } catch (cause) { setError(`Could not fetch the manifest: ${(cause as Error).message}`); }
  };
  return (
    <Drawer open={!!peer} onClose={onClose} title={peer ? `${peer.label}: agent-manifest.json` : ""} subtitle={url ? <span className="break-all font-mono text-[11.5px]">{url}</span> : undefined} width={620} footer={<Button variant="primary" onClick={load} disabled={!url}>Fetch the public file again</Button>}>
      {!url ? <Empty title="Not connected">Connect the network first; its manifest URL is known only after a real load.</Empty> : error ? <Notice tone="critical">{error}</Notice> : text ? <pre className="scroll-thin max-h-[70vh] overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[11.5px] leading-relaxed">{text}</pre> : <p className="text-[13px] text-muted">This is a plain GET of the partner's public manifest, the same file the runtime loaded. Choose “Fetch the public file again” to read it now.</p>}
    </Drawer>
  );
}

function PeerCard({ peer, onManifest }: { peer: PeerRecord; onManifest: (peer: PeerRecord) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"connect" | "test" | null>(null);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const inspect = useUi((state) => state.setInspectAgent);
  const stats = useLinkStats(peer.id);
  const discovery = peer.discovery;
  const connected = discovery?.status === "connected";

  const load = async (kind: "connect" | "test") => {
    setBusy(kind);
    const started = performance.now();
    try {
      const grant = await askConsent(peer.id, kind === "test" ? "Connectivity test: load this site's public manifest and network definition" : "Load this site's public agent manifest and network definition", { agent: "DiscoveryAgent", calls: ["agent-manifest.json", "network definition", "action bridge catalogue"], dataShared: "Nothing. Only public files are fetched." }, { incidentId: useStore.getState().activeIncidentId, agent: "DiscoveryAgent" });
      const result = await connect(grant);
      const ms = Math.round(performance.now() - started);
      if (kind === "test") setTest({ ok: true, text: `Reachable: manifest and network definition loaded from ${new URL(result.fetched.network).origin} in ${ms} ms (including consent). ${result.agents.length} agents, ${result.actions.length} actions shared with this origin.` });
      setOpen(true);
    } catch (error) {
      if (kind === "test") setTest({ ok: false, text: `Not reachable: ${(error as Error).message}` });
      else useUi.getState().notify((error as Error).message, "warn");
    } finally {
      setBusy(null);
    }
  };
  const doDisconnect = async () => { await disconnect(peer.id); setTest(null); useUi.getState().notify(`${peer.label} forgotten. Its files will be fetched again on the next contact.`, "ok"); };
  const inspector = registryFile?.inspector ? `${registryFile.inspector}?url=${encodeURIComponent(peer.networkUrl)}` : null;

  return (
    <li className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-start gap-3 p-3.5">
        <button type="button" className="mt-0.5 text-muted" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} details of ${peer.label}`}>{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold">{peer.label}</span>
            <Badge tone="navy"><span className="capitalize">{peer.role}</span></Badge>
            <ConnectionBadge peer={peer} />
            {peer.role === "trust" ? (connected ? <Badge tone="ok">Trust anchor · pinned key</Badge> : null) : <TrustBadge decision={peer.trust?.decision} score={peer.trust?.score} />}
            {peer.overridden && <Badge tone="warn">Allowed by a person</Badge>}
            <Badge tone="neutral">{peer.source === "publisher-registry" ? "Local registry" : "Registered here"}</Badge>
          </div>
          <a className="mt-0.5 block break-all font-mono text-[12px] text-accent-text underline-offset-2 hover:underline" href={peer.siteUrl} target="_blank" rel="noreferrer">{peer.networkUrl}</a>
          <p className="mt-0.5 text-[12.5px] text-muted">{connected ? discovery!.description : discovery?.error || peer.purpose}</p>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-muted">
            <span>Last successful interaction: <span className="text-ink-2">{stats.lastOk ? `${relative(stats.lastOk.at)} (${stats.lastOk.label})` : "none yet"}</span></span>
            <span>Communication errors: <span className={stats.errors.length ? "font-semibold text-critical-text" : "text-ink-2"}>{stats.errors.length}</span>{stats.lastError && <span className="text-faint"> · last: {stats.lastError.detail || stats.lastError.status}</span>}</span>
            <span>Requests: <span className="text-ink-2">{stats.total}</span></span>
          </p>
          {test && <p className={cx("mt-1 text-[12.5px] font-semibold", test.ok ? "text-ok-text" : "text-critical-text")}>{test.text}</p>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {!connected && <Button size="sm" variant="primary" busy={busy === "connect"} disabled={!!busy} onClick={() => load("connect")}><Plug size={12} aria-hidden />Connect</Button>}
          <Button size="sm" busy={busy === "test"} disabled={!!busy} onClick={() => load("test")} title="Loads the public files again and times it"><Radar size={12} aria-hidden />Test connectivity</Button>
          {connected && <Button size="sm" onClick={() => onManifest(peer)}><FileJson size={12} aria-hidden />Inspect manifest</Button>}
          {connected && <Button size="sm" variant="ghost" onClick={doDisconnect}><Unplug size={12} aria-hidden />Disconnect</Button>}
          {inspector && <a className="inline-flex items-center gap-1 rounded-md border border-line-strong bg-surface-3 px-2.5 py-1 text-[12.5px] font-semibold text-ink hover:bg-surface-4" href={inspector} target="_blank" rel="noreferrer"><ExternalLink size={12} aria-hidden />Inspect</a>}
        </div>
      </div>
      <Collapse open={open}>
        <div className="border-t border-line bg-surface-2/70 p-4">
          {connected ? (
            <div className="grid gap-4">
              <KeyValue items={[
                ["Network name", <span className="font-mono text-[12.5px]">{discovery!.networkName}</span>],
                ["Brand", discovery!.brand || "—"],
                ["Front agent", <button type="button" className="font-mono text-[12.5px] text-accent-text hover:underline" onClick={() => inspect(discovery!.frontAgent!)}>{discovery!.frontAgent}</button>],
                ["Capabilities", discovery!.capabilities.length ? <span className="flex flex-wrap gap-1">{discovery!.capabilities.map((item) => <Badge key={item}>{item}</Badge>)}</span> : "None advertised"],
                ["Peer policy", discovery!.peerPolicy || "—"],
                ["Data", discovery!.dataClassification || "—"],
                ["Fetched", <span className="break-all font-mono text-[11.5px]">{discovery!.fetched.manifest}<br />{discovery!.fetched.network}</span>],
                ["Network file digest", <span className="break-all font-mono text-[11.5px]">{discovery!.observedDigest || "could not be computed"}</span>],
                ["Loaded", time(discovery!.at)],
              ]} />
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <h4 className="mb-1.5 text-[12.5px] font-semibold uppercase tracking-wide text-muted">Agents ({discovery!.agents.length})</h4>
                  <ul className="grid gap-1.5">
                    {discovery!.agents.map((agent) => (
                      <li key={agent.name} className="rounded-md border border-line bg-surface p-2.5 text-[12.5px]">
                        <div className="flex flex-wrap items-center gap-1.5"><button type="button" className="inline-flex items-center gap-1 font-mono font-semibold hover:text-accent-text" onClick={() => inspect(agent.name)}><Bot size={12} aria-hidden />{agent.name}</button>{agent.isFront && <Badge tone="navy">front agent</Badge>}</div>
                        <p className="mt-0.5 text-muted">{agent.description}</p>
                        {agent.calls.length > 0 && <p className="mt-1 break-all text-[11.5px] text-ink-2">May call: {agent.calls.join(", ")}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="mb-1.5 text-[12.5px] font-semibold uppercase tracking-wide text-muted">Actions shared with this site ({discovery!.actions.length})</h4>
                  {discovery!.actions.length ? (
                    <ul className="grid gap-1.5">
                      {discovery!.actions.map((action) => (
                        <li key={action.name} className="rounded-md border border-line bg-surface p-2.5 text-[12.5px]">
                          <div className="flex flex-wrap items-center gap-1.5"><span className="font-mono font-semibold">{action.name}</span><Badge tone={action.effect === "read" ? "ok" : "warn"}>{action.effect === "read" ? "read · hidden frame" : `${action.effect} · partner's own window`}</Badge></div>
                          <p className="mt-0.5 text-muted">{action.description}</p>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-[12.5px] text-muted">This site's bridge shares no actions with this origin.</p>}
                  <h4 className="mb-1.5 mt-3 text-[12.5px] font-semibold uppercase tracking-wide text-muted">Partner networks it may call</h4>
                  {discovery!.partnerNetworks.length ? <ul className="grid gap-1 font-mono text-[12px]">{discovery!.partnerNetworks.map((url) => <li key={url} className="break-all">{url}</li>)}</ul> : <p className="text-[12.5px] text-muted">None.</p>}
                </div>
              </div>
            </div>
          ) : (
            <p className={cx("text-[12.5px]", discovery?.status === "failed" || discovery?.status === "policy-refused" ? "text-critical-text" : "text-muted")}>
              {discovery?.error || "Not contacted yet. Connect to load this site's public manifest and network definition. Nothing is fetched before you agree."}
            </p>
          )}
        </div>
      </Collapse>
    </li>
  );
}

export function PartnerExplorer() {
  const peers = useStore((state) => state.peers);
  const [manifestPeer, setManifestPeer] = useState<PeerRecord | null>(null);
  const list = Object.values(peers);
  if (!list.length) return <Empty title="No partner networks configured">Register a partner's network URL below or in Settings.</Empty>;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
        <LiveBadge label="Read from each site's public files" />
        <span>{registryFile?.notice || "Partner URLs come from this site's own list."}</span>
      </div>
      <ul className="grid gap-2">{list.map((peer) => <PeerCard key={peer.id} peer={peer} onManifest={setManifestPeer} />)}</ul>
      <ManifestDrawer peer={manifestPeer} onClose={() => setManifestPeer(null)} />
    </div>
  );
}
