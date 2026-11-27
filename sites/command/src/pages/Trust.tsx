// Trust and security center: verified, caution, unverified and blocked subjects, expired
// credentials, suspicious activity, trust profiles with their evidence, and the
// verification history. Every result here was produced by a real check against
// TrustRegistry; nothing is fabricated when a check has not run.
import { useMemo, useState } from "react";
import { ExternalLink, KeyRound, ShieldAlert, ShieldCheck } from "lucide-react";
import { EvidenceList, ReportButton } from "@/components/views";
import { Badge, Button, Card, CardHeader, Drawer, Empty, KeyValue, Notice, PageHeader, Segmented, Stat, Table, Td, Th, TrustBadge, cx, time } from "@/components/ui";
import { NETWORK_WEIGHTS, ORGANIZATION_WEIGHTS, THRESHOLDS } from "@/domain/trust";
import type { TrustEvaluation } from "@/domain/types";
import { useActiveIncident, useStore } from "@/state/store";
import { useUi } from "@/state/ui";
import { runStep } from "@/workflow/steps";

type Filter = "all" | "verified" | "caution" | "unverified" | "blocked";

function Profile({ evaluation, onClose }: { evaluation: TrustEvaluation | null; onClose: () => void }) {
  const audit = useStore((state) => state.audit);
  const peers = useStore((state) => state.peers);
  const history = useMemo(() => (evaluation ? audit.filter((entry) => (entry.kind === "trust" || entry.kind === "security") && (entry.summary.includes(evaluation.name) || entry.summary.includes(evaluation.subjectId))).slice(-12).reverse() : []), [audit, evaluation]);
  const peer = evaluation ? Object.values(peers).find((item) => item.trust?.subjectId === evaluation.subjectId) : undefined;
  return (
    <Drawer open={!!evaluation} onClose={onClose} title={evaluation ? <span className="inline-flex items-center gap-2"><ShieldCheck size={16} className="text-accent-text" aria-hidden />{evaluation.name}</span> : ""} subtitle={evaluation ? <span className="font-mono text-[11.5px]">{evaluation.subjectId}</span> : undefined} width={560}>
      {evaluation && (
        <div className="grid gap-5">
          <div className="flex flex-wrap items-center gap-2"><TrustBadge decision={evaluation.decision} score={evaluation.score} />{evaluation.signatureVerified ? <Badge tone="ok">Signature verified (ECDSA P-256)</Badge> : <Badge tone="neutral">No verified signature</Badge>}<Badge>{evaluation.subjectType === "agent_network" ? "Partner network" : "Organisation"}</Badge>{peer?.overridden && <Badge tone="warn">Allowed by a person</Badge>}</div>
          <KeyValue items={[["Checked", time(evaluation.evaluatedAt)], ["Registry", <span className="break-all font-mono text-[12px]">{evaluation.registry}</span>], ...(peer ? [["Network URL", <span className="break-all font-mono text-[12px]">{peer.networkUrl}</span>] as [string, React.ReactNode]] : [])]} />
          <section><h3 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Evidence</h3><EvidenceList evaluation={evaluation} /></section>
          <section>
            <h3 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Verification history</h3>
            {history.length ? <ol className="grid gap-1 text-[12.5px]">{history.map((entry) => <li key={entry.seq} className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5"><span className="text-faint">{time(entry.at)}</span> · <span className="font-mono text-[11.5px]">{entry.actor}</span> · {entry.summary}</li>)}</ol> : <p className="text-[12.5px] text-muted">No audit entries mention this subject yet.</p>}
          </section>
          {(evaluation.decision === "unverified" || evaluation.decision === "blocked") && <div><ReportButton subjectId={evaluation.subjectId} name={evaluation.name} reason={evaluation.decision === "unverified" ? "identity_mismatch" : "other"} details={[...evaluation.blockers, ...evaluation.warnings].join(" ") || "Flagged during a ReliefMesh trust check."} /></div>}
        </div>
      )}
    </Drawer>
  );
}

export function TrustPage() {
  const incident = useActiveIncident();
  const peers = useStore((state) => state.peers);
  const orgTrust = useStore((state) => state.orgTrust);
  const settings = useStore((state) => state.settings);
  const consentLog = useStore((state) => state.consentLog);
  const audit = useStore((state) => state.audit);
  const runs = useStore((state) => state.runs);
  const busy = useUi((state) => state.busyIncident);
  const [filter, setFilter] = useState<Filter>("all");
  const [profile, setProfile] = useState<TrustEvaluation | null>(null);
  const registry = Object.values(peers).find((peer) => peer.role === "trust");
  const networks = Object.values(peers).filter((peer) => peer.role !== "trust");
  const evaluations = [...networks.map((peer) => peer.trust).filter((item): item is NonNullable<typeof item> => !!item), ...Object.values(orgTrust)];
  const count = (decision: string) => evaluations.filter((item) => item.decision === decision).length;
  const signed = evaluations.filter((item) => item.signatureVerified).length;
  const expired = evaluations.filter((item) => item.evidence.some((evidence) => /expired/i.test(evidence.detail) && evidence.status !== "pass") || item.warnings.some((warning) => /expired/i.test(warning)));
  const security = useMemo(() => audit.filter((entry) => entry.kind === "security").slice(-15).reverse(), [audit]);
  const hostile = useMemo(() => Object.values(runs).flatMap((run) => run.offers.filter((offer) => offer.flags.some((flag) => flag.severity === "critical")).map((offer) => ({ run, offer }))), [runs]);
  const history = useMemo(() => audit.filter((entry) => entry.kind === "trust").slice(-40).reverse(), [audit]);
  const shown = evaluations.filter((item) => filter === "all" || item.decision === filter);

  const verify = async () => {
    if (!incident || useUi.getState().busyIncident) return;
    useUi.getState().setBusy(incident.id);
    try { const outcome = await runStep(incident.id, "trust"); useUi.getState().notify(outcome.ok ? outcome.summary : outcome.reason || "Verification did not complete.", outcome.ok ? "ok" : "warn"); } finally { useUi.getState().setBusy(null); }
  };

  return (
    <>
      <PageHeader
        eyebrow="Trust and security center"
        title="Trust & Verification"
        subtitle="Before a partner's data or an organisation's offer is used, its identity record is checked with TrustRegistry and the signature on its attestation is verified in this browser. An unverified party is never treated as trusted."
        actions={<>
          {registry && <a href={registry.siteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface-3 px-3.5 py-2 text-[13.5px] font-semibold text-ink hover:bg-surface-4"><ExternalLink size={14} aria-hidden />Open {registry.label}</a>}
          <Button variant="primary" busy={!!incident && busy === incident.id} disabled={!incident || !!busy} onClick={verify}>Verify agent information</Button>
        </>}
      />
      <div className="grid gap-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <Stat label="Verified" number={count("verified")} tone="ok" />
          <Stat label="Caution" number={count("caution")} tone={count("caution") ? "warn" : "neutral"} hint="usable, with warnings" />
          <Stat label="Unverified" number={count("unverified")} hint="excluded unless a person allows" />
          <Stat label="Blocked" number={count("blocked")} tone={count("blocked") ? "critical" : "neutral"} hint="never usable" />
          <Stat label="Expired credentials" number={expired.length} tone={expired.length ? "warn" : "neutral"} hint="from the evidence" />
          <Stat label="Suspicious activity" number={security.length + hostile.length} tone={security.length + hostile.length ? "critical" : "neutral"} hint="security entries and hostile offers" />
          <Stat label="Signatures verified" number={signed} tone="info" hint="ECDSA P-256 in this browser" />
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
          <CardHeader title="Trust profiles" subtitle="Partner networks and organisations, with their decision, score, signature and main finding. Open a row for the full evidence and its verification history." actions={<Segmented label="Filter by decision" size="xs" value={filter} onChange={setFilter} options={[{ id: "all", label: `All (${evaluations.length})` }, { id: "verified", label: "Verified" }, { id: "caution", label: "Caution" }, { id: "unverified", label: "Unverified" }, { id: "blocked", label: "Blocked" }]} />} />
          {shown.length ? (
            <Table label="Trust profiles">
              <thead><tr><Th>Subject</Th><Th>Type</Th><Th>Decision</Th><Th right>Score</Th><Th>Signature</Th><Th>Main finding</Th><Th>Checked</Th><Th /></tr></thead>
              <tbody>{shown.map((evaluation) => {
                const peer = networks.find((item) => item.trust?.subjectId === evaluation.subjectId);
                return (
                  <tr key={evaluation.subjectId} className={cx(evaluation.decision === "blocked" && "bg-critical-soft/40")}>
                    <Td><button type="button" className="text-left font-medium hover:text-accent-text" onClick={() => setProfile(evaluation)}>{evaluation.name}</button><div className="font-mono text-[11.5px] text-muted">{evaluation.subjectId}</div></Td>
                    <Td>{evaluation.subjectType === "agent_network" ? "Partner network" : "Organisation"}</Td>
                    <Td><TrustBadge decision={evaluation.decision} />{peer?.overridden && <div className="mt-1"><Badge tone="warn">Allowed by a person</Badge></div>}</Td>
                    <Td right>{evaluation.score}</Td>
                    <Td>{evaluation.signatureVerified ? <Badge tone="ok">Verified</Badge> : <Badge tone="neutral">None</Badge>}</Td>
                    <Td className="text-muted">{[...evaluation.blockers, ...evaluation.warnings][0] || "No concerns."}</Td>
                    <Td className="whitespace-nowrap text-muted">{time(evaluation.evaluatedAt)}</Td>
                    <Td><Button size="sm" variant="ghost" onClick={() => setProfile(evaluation)}>Profile</Button></Td>
                  </tr>
                );
              })}</tbody>
            </Table>
          ) : <Empty title={evaluations.length ? "No subject matches the filter" : "Nothing verified yet"}>{evaluations.length ? "Choose another decision." : "Run “Verify agent information”, or the workflow's step 4. Results appear only after a real check."}</Empty>}
        </Card>

        <div className="grid gap-5 xl:grid-cols-2">
          <Card tone={security.length + hostile.length ? "critical" : undefined}>
            <CardHeader icon={<ShieldAlert size={16} aria-hidden />} title="Suspicious activity" subtitle="Instruction-like text in partner responses, malformed responses, hostile offers and key changes, from the audit trail and the offer scan." />
            {security.length || hostile.length ? (
              <ul className="grid gap-1.5 text-[12.5px]">
                {hostile.map(({ run, offer }) => <li key={`${run.incidentId}-${offer.offerId}`} className="rounded-md border border-critical/30 bg-critical-soft px-2.5 py-1.5"><span className="font-semibold">{offer.supplierName}</span> ({offer.offerId}, {run.incidentId}): {offer.flags.filter((flag) => flag.severity === "critical").map((flag) => flag.detail).join(" ")} <span className="text-muted">Excluded; not acted on.</span></li>)}
                {security.map((entry) => <li key={entry.seq} className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5"><span className="text-faint">{time(entry.at)}</span> · <span className="font-mono text-[11.5px]">{entry.actor}</span> · {entry.summary}</li>)}
              </ul>
            ) : <Empty title="Nothing suspicious recorded">Security findings appear here when a partner's response contains instruction-like text or fails its schema, or when the registry key changes.</Empty>}
          </Card>
          <Card>
            <CardHeader title="Verification history" subtitle="Every trust check recorded in the audit trail, newest first." />
            {history.length ? <ol className="scroll-thin grid max-h-80 gap-1 overflow-y-auto text-[12.5px]">{history.map((entry) => <li key={entry.seq} className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5"><span className="text-faint">{time(entry.at)}</span> · <span className="font-mono text-[11.5px]">{entry.actor}</span> · {entry.summary}</li>)}</ol> : <Empty title="No checks yet" />}
          </Card>
        </div>

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
      <Profile evaluation={profile} onClose={() => setProfile(null)} />
    </>
  );
}
