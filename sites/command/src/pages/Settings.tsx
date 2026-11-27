import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bot, KeyRound, Moon, Sun, Trash2, UserRound } from "lucide-react";
import { ResetDemoDialog } from "@/components/AppShell";
import { RegisterPartner } from "@/components/RegisterPartner";
import { Badge, Button, Card, CardHeader, Empty, Field, KeyValue, Modal, Notice, PageHeader, Segmented, Table, Td, Th, inputClass, time } from "@/components/ui";
import { disconnect, forgetRegistryKeys } from "@/interop/peers";
import { registryFile, setConsoleOpen } from "@/lib/boot";
import { usePrefs } from "@/lib/theme";
import { useStore } from "@/state/store";
import type { PeerConfig } from "@/state/types";
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

function ProfileCard() {
  const displayName = usePrefs((state) => state.displayName);
  const setDisplayName = usePrefs((state) => state.setDisplayName);
  const theme = usePrefs((state) => state.theme);
  const setTheme = usePrefs((state) => state.setTheme);
  const collapsed = usePrefs((state) => state.sidebarCollapsed);
  const setCollapsed = usePrefs((state) => state.setSidebarCollapsed);
  const [name, setName] = useState(displayName);
  return (
    <Card>
      <CardHeader icon={<UserRound size={16} aria-hidden />} title="Profile and appearance" subtitle="Interface preferences for this browser. Decisions are recorded as human:coordinator; the display name is a label, not an identity." />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-3">
          <Field label="Display name" hint="Shown in the header. Not sent anywhere."><input className={inputClass} value={name} maxLength={40} onChange={(event) => setName(event.target.value)} /></Field>
          <div><Button variant="primary" size="sm" onClick={() => { setDisplayName(name); useUi.getState().notify("Display name saved.", "ok"); }}>Save name</Button></div>
        </div>
        <div className="grid content-start gap-3">
          <div className="grid gap-1 text-[12.5px] font-semibold text-ink-2">
            <span>Theme</span>
            <Segmented label="Theme" value={theme} onChange={setTheme} options={[{ id: "dark", label: <span className="inline-flex items-center gap-1"><Moon size={12} />Dark</span> }, { id: "light", label: <span className="inline-flex items-center gap-1"><Sun size={12} />Light</span> }]} />
          </div>
          <label className="inline-flex items-center gap-2 text-[13px]"><input type="checkbox" checked={collapsed} onChange={(event) => setCollapsed(event.target.checked)} />Collapse the sidebar to icons</label>
          <p className="text-[12px] text-muted">Shortcuts: <kbd className="font-mono">Shift+T</kbd> theme, <kbd className="font-mono">[</kbd> sidebar, <kbd className="font-mono">?</kbd> all shortcuts.</p>
        </div>
      </div>
    </Card>
  );
}

function PartnersCard() {
  const peers = useStore((state) => state.peers);
  const extra = useStore((state) => state.settings.extraPartners);
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
      <div className="mt-4"><RegisterPartner /></div>
      <p className="mt-2 text-[12.5px] text-muted">The published policy is closed: the runtime refuses every origin outside <span className="font-mono">allowed_peers</span>. Registering a partner here adds its origin to the runtime's allowed list for this browser only, after you confirm. It does not change the published manifest, and the partner must still pass the trust check before its data is used. {extra.length ? `${extra.length} registered on this device.` : ""}</p>
    </Card>
  );
}

export function SettingsPage() {
  const settings = useStore((state) => state.settings);
  const [budget, setBudget] = useState(String(settings.defaultBudget));
  const [hours, setHours] = useState(String(settings.defaultDeadlineHours));
  const [repin, setRepin] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [params, setParams] = useSearchParams();
  useEffect(() => { if (params.get("reset") === "1") { setResetting(true); setParams({}, { replace: true }); } }, [params, setParams]);

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
      <PageHeader title="Settings" subtitle="Profile and appearance, model configuration, incident defaults, partner networks, the trust anchor and this device's data." />
      <div className="grid gap-5">
        <ProfileCard />
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
          <CardHeader title="Data on this device" subtitle="ReliefMesh Command has no server. Incidents, plans, trust results, the activity log and the audit trail live in this browser's storage for this origin." actions={<Button onClick={() => setResetting(true)}>Reset demo…</Button>} />
          <ul className="list-disc pl-4 text-[12.5px] text-muted">
            <li>Reset demo restores the preloaded scenario. Each partner site has its own reset.</li>
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
      {resetting && <ResetDemoDialog onClose={() => setResetting(false)} />}
    </>
  );
}
