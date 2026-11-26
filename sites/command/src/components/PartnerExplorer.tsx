// Agent Network Explorer: for each network, its name, URL, agents, capabilities, shared
// actions, partner networks, connection status and verification status. Everything shown
// was read from that site's own public files during discovery.
import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Plug, Unplug } from "lucide-react";
import { askConsent, connect, disconnect } from "@/interop/peers";
import { registryFile } from "@/lib/boot";
import { useStore } from "@/state/store";
import type { PeerRecord } from "@/state/types";
import { useUi } from "@/state/ui";
import { Badge, Button, Empty, KeyValue, LiveBadge, TrustBadge, cx, time } from "./ui";

function ConnectionBadge({ peer }: { peer: PeerRecord }) {
  const status = peer.discovery?.status;
  if (status === "connected") return <Badge tone="ok">Connected</Badge>;
  if (status === "declined") return <Badge tone="neutral">Contact declined</Badge>;
  if (status === "policy-refused") return <Badge tone="critical">Not in allowed_peers</Badge>;
  if (status === "failed") return <Badge tone="critical">Failed</Badge>;
  return <Badge tone="neutral">Not contacted</Badge>;
}

function PeerCard({ peer }: { peer: PeerRecord }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const discovery = peer.discovery;
  const connected = discovery?.status === "connected";

  const doConnect = async () => {
    setBusy(true);
    try {
      const grant = await askConsent(peer.id, "Load this site's public agent manifest and network definition", { agent: "DiscoveryAgent", calls: ["agent-manifest.json", "network definition", "action bridge catalogue"], dataShared: "Nothing. Only public files are fetched." }, { incidentId: useStore.getState().activeIncidentId, agent: "DiscoveryAgent" });
      await connect(grant);
      setOpen(true);
    } catch (error) {
      useUi.getState().notify((error as Error).message, "warn");
    } finally {
      setBusy(false);
    }
  };
  const doDisconnect = async () => { await disconnect(peer.id); useUi.getState().notify(`${peer.label} forgotten. Its files will be fetched again on the next contact.`, "ok"); };
  const inspector = registryFile?.inspector ? `${registryFile.inspector}?url=${encodeURIComponent(peer.networkUrl)}` : null;

  return (
    <li className="rounded-lg border border-line bg-white">
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
          <a className="mt-0.5 block break-all font-mono text-[12px] text-info underline-offset-2 hover:underline" href={peer.siteUrl} target="_blank" rel="noreferrer">{peer.networkUrl}</a>
          <p className="mt-0.5 text-[12.5px] text-muted">{connected ? discovery!.description : discovery?.error || peer.purpose}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {!connected && <Button size="sm" variant="primary" busy={busy} onClick={doConnect}><Plug size={12} aria-hidden />Connect</Button>}
          {connected && <Button size="sm" onClick={doDisconnect}><Unplug size={12} aria-hidden />Disconnect</Button>}
          {inspector && <a className="inline-flex items-center gap-1 rounded-md border border-[#c3cbd9] px-2.5 py-1 text-[12.5px] font-semibold text-ink-2 hover:bg-slate-50" href={inspector} target="_blank" rel="noreferrer"><ExternalLink size={12} aria-hidden />Inspect</a>}
        </div>
      </div>
      {open && (
        <div className="border-t border-line bg-slate-50/70 p-4">
          {connected ? (
            <div className="grid gap-4">
              <KeyValue items={[
                ["Network name", <span className="font-mono text-[12.5px]">{discovery!.networkName}</span>],
                ["Brand", discovery!.brand || "—"],
                ["Front agent", <span className="font-mono text-[12.5px]">{discovery!.frontAgent}</span>],
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
                      <li key={agent.name} className="rounded-md border border-line bg-white p-2.5 text-[12.5px]">
                        <div className="flex flex-wrap items-center gap-1.5"><span className="font-mono font-semibold">{agent.name}</span>{agent.isFront && <Badge tone="navy">front agent</Badge>}</div>
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
                        <li key={action.name} className="rounded-md border border-line bg-white p-2.5 text-[12.5px]">
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
            <p className={cx("text-[12.5px]", discovery?.status === "failed" || discovery?.status === "policy-refused" ? "text-critical" : "text-muted")}>
              {discovery?.error || "Not contacted yet. Connect to load this site's public manifest and network definition. Nothing is fetched before you agree."}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function PartnerExplorer() {
  const peers = useStore((state) => state.peers);
  const list = Object.values(peers);
  if (!list.length) return <Empty title="No partner networks configured">Add a partner's network URL in Settings.</Empty>;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
        <LiveBadge label="Read from each site's public files" />
        <span>{registryFile?.notice || "Partner URLs come from this site's own list."}</span>
      </div>
      <ul className="grid gap-2">{list.map((peer) => <PeerCard key={peer.id} peer={peer} />)}</ul>
    </div>
  );
}
