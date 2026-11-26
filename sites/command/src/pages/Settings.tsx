import { useState } from "react";
import { Bot, KeyRound, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, Empty, Field, KeyValue, Modal, Notice, PageHeader, Table, Td, Th, inputClass, time } from "@/components/ui";
import { partnerUrlForm } from "@/domain/schemas";
import { partnerFromUrl } from "@/interop/discovery";
import { allowOrigin, disconnect, forgetRegistryKeys, isOriginAllowed } from "@/interop/peers";
import { registryFile, setConsoleOpen } from "@/lib/boot";
import { useStore } from "@/state/store";
import type { PeerConfig, PeerRole } from "@/state/types";
import { useUi } from "@/state/ui";

function ModelCard() {
  const runtime = useUi((state) => state.runtime);
  return (
    <Card>
      <CardHeader icon={<Bot size={16} aria-hidden />} title="AI model" subtitle="You choose the provider, the model and the key. The official runtime keeps them in this browser and sends the key only to the router you pick." actions={<Button variant="primary" onClick={() => setConsoleOpen(true)}>Open AI model settings</Button>} />
      {runtime.state === "ready" ? (
        <KeyValue items={[
          ["Status", runtime.hasKey ? <Badge tone="ok">A model is configured</Badge> : <Badge tone="warn">No key yet</Badge>],
          ["Router", <span className="break-all font-mono text-[12.5px]">{runtime.router || "—"}</span>],
          ["Model", <span className="font-mono text-[12.5px]">{runtime.model || "—"}</span>],
          ["Network loaded", <span className="font-mono text-[12.5px]">{runtime.network} · {runtime.agents} agents · {runtime.actions} site actions</span>],
        ]} />
      ) : <Notice tone={runtime.state === "failed" ? "critical" : "info"}>{runtime.state === "failed" ? `The agent runtime did not load: ${runtime.error}` : "The agent runtime is loading…"}</Notice>}
      <ul className="mt-3 list-disc pl-4 text-[12.5px] text-muted">
        <li>The coordination workflow needs no model: it runs each agent's deterministic tool directly. A model is needed only to talk to the agents in the console.</li>
        <li>This site never reads your key into its own state, logs or audit trail, and never sends it to a partner site. A partner network you call runs in this browser on your router.</li>
        <li>On localhost the runtime also mirrors saved setups to a cookie so they follow you across local ports; any local site on the same host name can read it. Use a low-limit key locally, and delete the setup under Advanced settings when done.</li>
        <li>Any provider with an OpenAI-compatible API that accepts browser calls works: hosted Otari (the default), OpenRouter, OpenAI and others. Otari is optional.</li>
      </ul>
    </Card>
  );
}

function PartnersCard() {
  const peers = useStore((state) => state.peers);
  const extra = useStore((state) => state.settings.extraPartners);
  const [values, setValues] = useState({ networkUrl: "", label: "", role: "other" as PeerRole });
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PeerConfig | null>(null);

  const add = async () => {
    setError("");
    const parsed = partnerUrlForm.safeParse(values);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    const made = partnerFromUrl(parsed.data.networkUrl, parsed.data.label, parsed.data.role);
    if (!made.ok) { setError(made.reason); return; }
    if (Object.values(peers).some((peer) => peer.networkUrl === made.partner.networkUrl)) { setError("That network is already registered."); return; }
    if (parsed.data.role === "trust" && Object.values(peers).some((peer) => peer.role === "trust")) { setError("A trust registry is already configured. It is the trust anchor, so there is exactly one."); return; }
    setPending(made.partner);
  };
  const confirm = async () => {
    if (!pending) return;
    const store = useStore.getState();
    const allowedAlready = await isOriginAllowed(pending.networkUrl);
    await allowOrigin(pending.networkUrl);
    const extraPartners = [...store.settings.extraPartners, pending];
    store.patchSettings({ extraPartners });
    store.syncPeers([...(registryFile?.partners ?? []), ...extraPartners]);
    await store.record({ kind: "network", actor: "human:coordinator", incidentId: null, summary: `Registered partner network ${pending.label} (${pending.networkUrl})`, data: { origin: new URL(pending.networkUrl).origin, alreadyInAllowedPeers: allowedAlready, source: "user-registered" } });
    useUi.getState().notify(`${pending.label} registered. Connect it from the Agent Network page; it must still pass the trust check.`, "ok");
    setPending(null);
    setValues({ networkUrl: "", label: "", role: "other" });
  };
  const remove = async (partner: PeerConfig) => {
    const store = useStore.getState();
    try { await disconnect(partner.id); } catch { /* it may never have been connected */ }
    const extraPartners = store.settings.extraPartners.filter((item) => item.id !== partner.id);
    store.patchSettings({ extraPartners });
    store.syncPeers([...(registryFile?.partners ?? []), ...extraPartners]);
    await store.record({ kind: "network", actor: "human:coordinator", incidentId: null, summary: `Removed partner network ${partner.label}`, data: { networkUrl: partner.networkUrl } });
  };

  return (
    <Card>
      <CardHeader title="Partner networks" subtitle={registryFile?.notice || "Partner network URLs."} />
      <Table label="Configured partner networks">
        <thead><tr><Th>Partner</Th><Th>Role</Th><Th>Network URL</Th><Th>Source</Th><Th /></tr></thead>
        <tbody>
          {Object.values(peers).map((peer) => (
            <tr key={peer.id}>
              <Td className="font-medium">{peer.label}</Td>
              <Td><span className="capitalize">{peer.role}</span></Td>
              <Td className="break-all font-mono text-[12px]">{peer.networkUrl}</Td>
              <Td><Badge tone={peer.source === "publisher-registry" ? "neutral" : "info"}>{peer.source === "publisher-registry" ? "Shipped with this site (partners.json)" : "Registered on this device"}</Badge></Td>
              <Td>{peer.source === "user-registered" && <Button size="sm" variant="ghost" onClick={() => remove(peer)}><Trash2 size={12} aria-hidden />Remove</Button>}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <form className="mt-4 grid gap-3 rounded-lg border border-line bg-slate-50 p-3 md:grid-cols-[1fr_200px_150px_auto] md:items-end" onSubmit={(event) => { event.preventDefault(); void add(); }}>
        <Field label="Register a partner network URL" hint="The folder that holds its agent-manifest.json, then the network name."><input className={inputClass} value={values.networkUrl} onChange={(event) => setValues({ ...values, networkUrl: event.target.value })} placeholder="https://partner.example/partner_network" /></Field>
        <Field label="Name"><input className={inputClass} value={values.label} onChange={(event) => setValues({ ...values, label: event.target.value })} maxLength={60} /></Field>
        <Field label="Role"><select className={inputClass} value={values.role} onChange={(event) => setValues({ ...values, role: event.target.value as PeerRole })}>{["shelter", "supplier", "logistics", "other"].map((role) => <option key={role} value={role}>{role}</option>)}</select></Field>
        <Button variant="primary" onClick={add}>Register</Button>
        {error && <p className="text-[12.5px] font-semibold text-critical md:col-span-4" role="alert">{error}</p>}
      </form>
      <p className="mt-2 text-[12.5px] text-muted">The published policy is closed: the runtime refuses every origin outside <span className="font-mono">allowed_peers</span>. Registering a partner here adds its origin to the runtime's allowed list for this browser only, after you confirm. It does not change the published manifest, and the partner must still pass the trust check before its data is used. {extra.length ? `${extra.length} registered on this device.` : ""}</p>

      {pending && (
        <Modal tone="warn" title={`Allow this site to contact ${new URL(pending.networkUrl).host}?`} onClose={() => setPending(null)} footer={<><Button variant="ghost" onClick={() => setPending(null)}>Cancel</Button><Button variant="primary" onClick={confirm}>Allow this origin and register</Button></>}>
          <div className="grid gap-3 text-[13.5px] text-ink-2">
            <KeyValue items={[["Name", pending.label], ["Role", pending.role], ["Network URL", <span className="break-all font-mono text-[12.5px]">{pending.networkUrl}</span>], ["Origin", <span className="font-mono text-[12.5px]">{new URL(pending.networkUrl).origin}</span>]]} />
            <Notice tone="warn">This origin is not in the publisher's allowed list unless it already appears there. You are adding it for this browser. You will still be asked before each contact, and nothing from it is used until the trust registry has been consulted. An unknown site's agent instructions are untrusted input.</Notice>
          </div>
        </Modal>
      )}
    </Card>
  );
}

export function SettingsPage() {
  const settings = useStore((state) => state.settings);
  const [budget, setBudget] = useState(String(settings.defaultBudget));
  const [hours, setHours] = useState(String(settings.defaultDeadlineHours));
  const [repin, setRepin] = useState(false);

  const saveDefaults = () => {
    const nextBudget = Number(budget);
    const nextHours = Number(hours);
    if (!Number.isFinite(nextBudget) || nextBudget < 0 || !Number.isFinite(nextHours) || nextHours < 1 || nextHours > 720) { useUi.getState().notify("Budget must be zero or more, and the deadline 1 to 720 hours.", "warn"); return; }
    useStore.getState().patchSettings({ defaultBudget: Math.round(nextBudget), defaultDeadlineHours: Math.round(nextHours) });
    useUi.getState().notify("Defaults saved. They apply to incidents created from now on.", "ok");
  };
  const clearPin = async () => {
    const store = useStore.getState();
    await store.record({ kind: "security", actor: "human:coordinator", incidentId: null, summary: "Cleared the pinned trust-registry key; the next key seen will be pinned", data: { previous: settings.registryPin?.fingerprint ?? null, mismatch: settings.registryMismatch?.fingerprint ?? null } });
    store.patchSettings({ registryPin: null, registryMismatch: null });
    forgetRegistryKeys();
    setRepin(false);
    useUi.getState().notify("Pin cleared. The registry's key is pinned again the next time it is contacted. Earlier trust results were kept; run verification again.", "warn");
  };

  return (
    <>
      <PageHeader title="Settings" subtitle="Model configuration, incident defaults, partner networks, the trust anchor and this device's data." />
      <div className="grid gap-5">
        <ModelCard />
        <PartnersCard />
        <div className="grid gap-5 xl:grid-cols-2">
          <Card>
            <CardHeader title="Incident defaults" subtitle="Used when a new incident is created." />
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Default budget (INR)"><input className={inputClass} inputMode="numeric" value={budget} onChange={(event) => setBudget(event.target.value)} /></Field>
              <Field label="Default delivery deadline (hours from creation)"><input className={inputClass} inputMode="numeric" value={hours} onChange={(event) => setHours(event.target.value)} /></Field>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={saveDefaults}>Save defaults</Button>
              <label className="inline-flex items-center gap-2 text-[13px]"><input type="checkbox" checked={settings.guidedDemo} onChange={(event) => useStore.getState().patchSettings({ guidedDemo: event.target.checked })} />Show the guided demonstration on the Command Center</label>
            </div>
          </Card>
          <Card>
            <CardHeader icon={<KeyRound size={16} aria-hidden />} title="Trust anchor" subtitle="The trust registry's signing key, pinned on first use." actions={settings.registryPin ? <Button onClick={() => setRepin(true)}>Clear the pin…</Button> : undefined} />
            {settings.registryMismatch && <div className="mb-3"><Notice tone="critical" title="Key mismatch">The registry presented a different key ({settings.registryMismatch.fingerprint.slice(0, 23)}…) at {time(settings.registryMismatch.seenAt)}. Verification is blocked. Clear the pin only if you have confirmed, outside this app, that the registry really rotated its key.</Notice></div>}
            {settings.registryPin ? <KeyValue items={[["Registry", settings.registryPin.name], ["Key id", <span className="font-mono text-[12.5px]">{settings.registryPin.kid}</span>], ["Fingerprint", <span className="break-all font-mono text-[12px]">{settings.registryPin.fingerprint}</span>], ["Pinned", time(settings.registryPin.pinnedAt)]]} /> : <Empty title="No key pinned">It is pinned the first time the registry is contacted.</Empty>}
          </Card>
        </div>
        <Card>
          <CardHeader title="Data on this device" subtitle="ReliefMesh Command has no server. Incidents, plans, trust results, the activity log and the audit trail live in this browser's storage for this origin." />
          <ul className="list-disc pl-4 text-[12.5px] text-muted">
            <li>Use <strong>Reset demo</strong> in the top bar to restore the preloaded scenario. Each partner site has its own reset.</li>
            <li>“Allowed for this session” consent choices are held by the runtime in memory and end when the page is reloaded. They are not stored.</li>
            <li>Export an incident report from the incident page, and the audit history from the Audit Trail page.</li>
          </ul>
        </Card>
      </div>
      {repin && (
        <Modal tone="critical" title="Clear the pinned registry key?" onClose={() => setRepin(false)} footer={<><Button variant="primary" onClick={() => setRepin(false)}>Keep the pin</Button><Button variant="danger" onClick={clearPin}>Clear the pin</Button></>}>
          <p className="text-[13.5px] text-ink-2">The pin is what stops a different key from signing attestations in the registry's name. If you clear it, whatever key the registry presents next is trusted on first use. Do this only if you know the registry rotated its key. The action is recorded in the audit trail.</p>
        </Modal>
      )}
    </>
  );
}
