import { ExternalLink, KeyRound } from "lucide-react";
import { ReportButton, TrustRow } from "@/components/views";
import { Badge, Button, Card, CardHeader, Empty, KeyValue, Notice, PageHeader, Stat, Table, Td, Th, time } from "@/components/ui";
import { NETWORK_WEIGHTS, ORGANIZATION_WEIGHTS, THRESHOLDS } from "@/domain/trust";
import { useActiveIncident, useStore } from "@/state/store";
import { useUi } from "@/state/ui";
import { runStep } from "@/workflow/steps";

export function TrustPage() {
  const incident = useActiveIncident();
  const peers = useStore((state) => state.peers);
  const orgTrust = useStore((state) => state.orgTrust);
  const settings = useStore((state) => state.settings);
  const consentLog = useStore((state) => state.consentLog);
  const busy = useUi((state) => state.busyIncident);
  const registry = Object.values(peers).find((peer) => peer.role === "trust");
  const networks = Object.values(peers).filter((peer) => peer.role !== "trust");
  const evaluations = [...networks.map((peer) => peer.trust).filter((item): item is NonNullable<typeof item> => !!item), ...Object.values(orgTrust)];
  const count = (decision: string) => evaluations.filter((item) => item.decision === decision).length;
  const signed = evaluations.filter((item) => item.signatureVerified).length;

  const verify = async () => {
    if (!incident || useUi.getState().busyIncident) return;
    useUi.getState().setBusy(incident.id);
    try { const outcome = await runStep(incident.id, "trust"); useUi.getState().notify(outcome.ok ? outcome.summary : outcome.reason || "Verification did not complete.", outcome.ok ? "ok" : "warn"); } finally { useUi.getState().setBusy(null); }
  };

  return (
    <>
      <PageHeader
        title="Trust & Verification"
        subtitle="Before a partner's data or an organisation's offer is used, its identity record is checked with TrustRegistry and the signature on its attestation is verified in this browser. An unverified party is never treated as trusted."
        actions={<>
          {registry && <a href={registry.siteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-[#c3cbd9] bg-white px-3.5 py-2 text-[13.5px] font-semibold text-ink-2 hover:bg-slate-50"><ExternalLink size={14} aria-hidden />Open {registry.label}</a>}
          <Button variant="primary" busy={!!incident && busy === incident.id} disabled={!incident || !!busy} onClick={verify}>Verify agent information</Button>
        </>}
      />
      <div className="grid gap-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Verified" value={count("verified")} tone="ok" />
          <Stat label="Caution" value={count("caution")} tone={count("caution") ? "warn" : "neutral"} hint="usable, with warnings" />
          <Stat label="Unverified" value={count("unverified")} hint="excluded unless a person allows" />
          <Stat label="Blocked" value={count("blocked")} tone={count("blocked") ? "critical" : "neutral"} hint="never usable" />
          <Stat label="Signatures verified" value={signed} tone="info" hint="ECDSA P-256 in this browser" />
        </div>

        <Notice tone="info" title="What is real and what is simulated here">
          The registry's <strong>authority, organisations and credentials are simulated</strong> demonstration data. The <strong>cryptography is real</strong>: attestations are signed with ECDSA P-256, and this page shows “signature verified” only when your browser's WebCrypto checked that signature against the pinned registry key. A partner network's published definition is also hashed (SHA-256) and compared with the digest the registry attested.
        </Notice>

        <Card>
          <CardHeader icon={<KeyRound size={16} aria-hidden />} title="Trust anchor" subtitle="The registry's signing key, pinned the first time it was seen. A different key later blocks verification until a person reviews it." />
          {settings.registryMismatch && <div className="mb-3"><Notice tone="critical" title="The registry's key changed">The registry now presents <span className="font-mono text-[12px]">{settings.registryMismatch.fingerprint}</span>, seen {time(settings.registryMismatch.seenAt)}. Verification is blocked. Review it in Settings before trusting the new key.</Notice></div>}
          {settings.registryPin ? <KeyValue items={[
            ["Registry", settings.registryPin.name],
            ["Key id", <span className="font-mono text-[12.5px]">{settings.registryPin.kid}</span>],
            ["Fingerprint", <span className="break-all font-mono text-[12px]">{settings.registryPin.fingerprint}</span>],
            ["Pinned", `${time(settings.registryPin.pinnedAt)} (trust on first use)`],
            ["Algorithm", "ECDSA P-256 with SHA-256, canonical JSON, IEEE P1363 signatures"],
          ]} /> : <Empty title="No registry key pinned yet">It is pinned the first time the registry is contacted.</Empty>}
        </Card>

        <Card>
          <CardHeader title="Partner networks" subtitle="Identity record, signed attestation, integrity of the published network definition, advertised capabilities, freshness and open reports." />
          {networks.some((peer) => peer.trust) ? (
            <Table label="Partner network trust">
              <thead><tr><Th>Network</Th><Th>Decision</Th><Th right>Score</Th><Th>Signature</Th><Th>Main finding</Th><Th /></tr></thead>
              <tbody>{networks.filter((peer) => peer.trust).map((peer) => <TrustRow key={peer.id} evaluation={peer.trust!} extra={peer.overridden ? <Badge tone="warn">Allowed by a person</Badge> : undefined} />)}</tbody>
            </Table>
          ) : <Empty title="No partner network verified yet">Run “Verify agent information”, or the workflow's step 4.</Empty>}
        </Card>

        <Card>
          <CardHeader title="Organisations" subtitle="Suppliers and transport operators: identity record, signed attestation, credentials, reputation history and open reports." />
          {Object.keys(orgTrust).length ? (
            <Table label="Organisation trust">
              <thead><tr><Th>Organisation</Th><Th>Decision</Th><Th right>Score</Th><Th>Signature</Th><Th>Main finding</Th><Th /></tr></thead>
              <tbody>{Object.values(orgTrust).map((evaluation) => (
                <TrustRow key={evaluation.subjectId} evaluation={evaluation} extra={evaluation.decision === "unverified" || evaluation.decision === "blocked" ? <ReportButton subjectId={evaluation.subjectId} name={evaluation.name} reason={evaluation.decision === "unverified" ? "identity_mismatch" : "other"} details={[...evaluation.blockers, ...evaluation.warnings].join(" ") || "Flagged during a ReliefMesh trust check."} /> : undefined} />
              ))}</tbody>
            </Table>
          ) : <Empty title="No organisation verified yet">Organisations are read from the supplier and logistics sites, then checked one by one.</Empty>}
        </Card>

        <div className="grid gap-5 xl:grid-cols-2">
          <Card>
            <CardHeader title="How the score is built" subtitle="A transparent sum of documented evidence. No model takes part." />
            <div className="grid gap-4 text-[12.5px] md:grid-cols-2">
              <div><h3 className="mb-1 font-semibold">Partner network (100)</h3><ul className="grid gap-0.5 text-ink-2">{Object.entries(NETWORK_WEIGHTS).map(([key, weight]) => <li key={key} className="flex justify-between"><span className="capitalize">{key}</span><span className="tabular">{weight}</span></li>)}</ul></div>
              <div><h3 className="mb-1 font-semibold">Organisation (100)</h3><ul className="grid gap-0.5 text-ink-2">{Object.entries(ORGANIZATION_WEIGHTS).map(([key, weight]) => <li key={key} className="flex justify-between"><span className="capitalize">{key}</span><span className="tabular">{weight}</span></li>)}</ul></div>
            </div>
            <ul className="mt-3 list-disc pl-4 text-[12.5px] text-muted">
              <li>Verified: score ≥ {THRESHOLDS.verified} and no warning. Caution: score ≥ {THRESHOLDS.caution}, or any warning such as an expired credential or an open report.</li>
              <li>Blocked, whatever the score: a revoked or suspended record, a signature that fails, or a published network that differs from the attested digest.</li>
              <li>Unverified: no registry record. Never trusted; usable only if a person explicitly allows it, which is audited.</li>
            </ul>
          </Card>
          <Card>
            <CardHeader title="Consent log" subtitle="Every decision to contact another origin. “Allowed for this session” lasts until the page is reloaded." />
            {consentLog.length ? (
              <Table label="Consent decisions">
                <thead><tr><Th>Time</Th><Th>Destination</Th><Th>Purpose</Th><Th>Decision</Th></tr></thead>
                <tbody>{consentLog.slice(-12).reverse().map((item, index) => (
                  <tr key={index}><Td>{time(item.at)}</Td><Td><span className="font-medium">{item.label}</span><div className="font-mono text-[11.5px] text-muted">{item.origin}</div></Td><Td className="text-muted">{item.purpose}</Td><Td><Badge tone={item.decision === "decline" ? "critical" : item.decision === "always" ? "info" : "ok"}>{item.decision === "decline" ? "Declined" : item.decision === "always" ? "Allowed for session" : "Allowed once"}</Badge></Td></tr>
                ))}</tbody>
              </Table>
            ) : <Empty title="No consent decisions yet">You are asked before every contact with another origin.</Empty>}
          </Card>
        </div>
      </div>
    </>
  );
}
