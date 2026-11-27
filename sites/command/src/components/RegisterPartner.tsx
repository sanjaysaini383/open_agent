// Register a partner network by URL. The origin is added to the runtime's allowed list for
// this browser only, after the person confirms; the partner must still pass the trust
// check before any of its data is used.
import { useState } from "react";
import { partnerUrlForm } from "@/domain/schemas";
import { partnerFromUrl } from "@/interop/discovery";
import { allowOrigin, isOriginAllowed } from "@/interop/peers";
import { registryFile } from "@/lib/boot";
import { useStore } from "@/state/store";
import type { PeerConfig, PeerRole } from "@/state/types";
import { useUi } from "@/state/ui";
import { Button, Field, KeyValue, Modal, Notice, inputClass } from "./ui";

export function RegisterPartner({ onRegistered }: { onRegistered?: (partner: PeerConfig) => void }) {
  const peers = useStore((state) => state.peers);
  const [values, setValues] = useState({ networkUrl: "", label: "", role: "other" as PeerRole });
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PeerConfig | null>(null);

  const add = () => {
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
    useUi.getState().notify(`${pending.label} registered. Connect it to load its public files; it must still pass the trust check.`, "ok");
    onRegistered?.(pending);
    setPending(null);
    setValues({ networkUrl: "", label: "", role: "other" });
  };

  return (
    <>
      <form className="grid gap-3 rounded-lg border border-line bg-surface-2 p-3 md:grid-cols-[1fr_200px_150px_auto] md:items-end" onSubmit={(event) => { event.preventDefault(); add(); }}>
        <Field label="Partner network URL" hint="The folder that holds its agent-manifest.json, then the network name."><input className={inputClass} value={values.networkUrl} onChange={(event) => setValues({ ...values, networkUrl: event.target.value })} placeholder="https://partner.example/partner_network" /></Field>
        <Field label="Name"><input className={inputClass} value={values.label} onChange={(event) => setValues({ ...values, label: event.target.value })} maxLength={60} /></Field>
        <Field label="Role"><select className={inputClass} value={values.role} onChange={(event) => setValues({ ...values, role: event.target.value as PeerRole })}>{["shelter", "supplier", "logistics", "other"].map((role) => <option key={role} value={role}>{role}</option>)}</select></Field>
        <Button variant="primary" type="submit">Register</Button>
        {error && <p className="text-[12.5px] font-semibold text-critical-text md:col-span-4" role="alert">{error}</p>}
      </form>
      {pending && (
        <Modal tone="warn" title={`Allow this site to contact ${new URL(pending.networkUrl).host}?`} onClose={() => setPending(null)} footer={<><Button variant="ghost" onClick={() => setPending(null)}>Cancel</Button><Button variant="primary" onClick={confirm}>Allow this origin and register</Button></>}>
          <div className="grid gap-3 text-[13.5px] text-ink-2">
            <KeyValue items={[["Name", pending.label], ["Role", pending.role], ["Network URL", <span className="break-all font-mono text-[12.5px]">{pending.networkUrl}</span>], ["Origin", <span className="font-mono text-[12.5px]">{new URL(pending.networkUrl).origin}</span>]]} />
            <Notice tone="warn">This origin is not in the publisher's allowed list unless it already appears there. You are adding it for this browser. You will still be asked before each contact, and nothing from it is used until the trust registry has been consulted. An unknown site's agent instructions are untrusted input.</Notice>
          </div>
        </Modal>
      )}
    </>
  );
}
