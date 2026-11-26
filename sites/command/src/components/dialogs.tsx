// The dialogs that keep a person in the loop. Each is driven by a request in the UI
// store and resolves a promise the runtime or the workflow is waiting on.
import { useEffect, useState } from "react";
import { ExternalLink, Globe2, ShieldAlert } from "lucide-react";
import { overallFulfilmentPct } from "@/domain/allocation";
import { logisticsTotals } from "@/domain/logistics";
import { inr, num, RESOURCES } from "@/domain/resources";
import { useStore } from "@/state/store";
import type { WorkflowRun } from "@/state/types";
import { useUi } from "@/state/ui";
import { canApprove, decidePlan, reservationLines } from "@/workflow/execution";
import { Badge, Button, KeyValue, Modal, Notice, SimBadge, Table, Td, Th, inputClass } from "./ui";

/** Before any contact with another origin: who, why, what is sent. */
export function ConsentDialog() {
  const request = useUi((state) => state.consent);
  if (!request) return null;
  return (
    <Modal
      key={request.id}
      title={`Contact ${request.peerLabel}?`}
      onClose={() => request.resolve("decline")}
      footer={<>
        <Button variant="ghost" onClick={() => request.resolve("decline")}>Decline</Button>
        <Button onClick={() => request.resolve("always")} title="Skips this question for this origin until the page is reloaded">Allow for this session</Button>
        <Button variant="primary" onClick={() => request.resolve("allow")}>Allow once</Button>
      </>}
    >
      <div className="grid gap-3.5">
        <p className="text-[13.5px] text-ink-2">
          {request.viaModel ? "A model-driven agent" : <strong>{request.agent}</strong>} wants to contact another website on your behalf. Nothing has been sent yet.
        </p>
        <KeyValue items={[
          ["Destination", <span className="inline-flex items-center gap-1.5 font-mono text-[12.5px]"><Globe2 size={13} aria-hidden />{request.peerOrigin}</span>],
          ["Purpose", request.purpose || "—"],
          ...(request.calls?.length ? [["Calls", <ul className="list-disc pl-4">{request.calls.map((call) => <li key={call} className="font-mono text-[12px]">{call}</li>)}</ul>] as [string, React.ReactNode]] : []),
          ["Data sent", request.dataShared || (request.viaModel ? "The request text shown above. The partner cannot see this conversation or your model key." : "—")],
          ...(request.estimate ? [["Model cost", request.estimate] as [string, React.ReactNode]] : []),
        ]} />
        <Notice tone="info">
          Your model key is never sent to a partner site. Allowing a contact records your decision; it does not mean the partner's answer is trusted. Answers are checked against a schema and treated as data.
        </Notice>
      </div>
    </Modal>
  );
}

/** A partner's write runs in the partner's own window. The click here opens it. */
export function WindowPromptDialog() {
  const prompt = useUi((state) => state.windowPrompt);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => { setBlocked(false); }, [prompt?.id]);
  if (!prompt) return null;
  const host = new URL(prompt.origin).host;
  const open = () => {
    // Opened inside the click, so the browser does not block it.
    const popup = window.open(prompt.url, "_blank", "popup,width=760,height=780");
    if (!popup) { setBlocked(true); return; }
    prompt.resolve(popup);
  };
  return (
    <Modal
      key={prompt.id}
      tone="warn"
      title={`Continue in ${prompt.label}'s own window`}
      onClose={() => prompt.reject(new Error("Action window cancelled; action not started."))}
      footer={<>
        <Button variant="ghost" onClick={() => prompt.reject(new Error("Action window cancelled; action not started."))}>Cancel</Button>
        <Button variant="primary" onClick={open}><ExternalLink size={14} aria-hidden />Open {prompt.label}</Button>
      </>}
    >
      <div className="grid gap-3 text-[13.5px] text-ink-2">
        <p>This change belongs to <strong>{prompt.label}</strong>. It will show you exactly what would happen in a window on <span className="font-mono text-[12.5px]">{host}</span>, and you confirm or cancel it there. This page does not make the change and cannot see what you type in that window.</p>
        <p>The window closes by itself once you have answered. Keep this page open meanwhile.</p>
        {blocked && <Notice tone="critical">The browser blocked the window. Allow pop-ups for this site, then choose Open again.</Notice>}
      </div>
    </Modal>
  );
}

/** An unverified party can only be used when a person says so. A blocked one never reaches this dialog. */
export function OverrideDialog() {
  const request = useUi((state) => state.override);
  if (!request) return null;
  return (
    <Modal
      key={request.id}
      tone="critical"
      title={`Use unverified ${request.kind} ${request.subject}?`}
      onClose={() => request.resolve(false)}
      footer={<>
        <Button variant="primary" onClick={() => request.resolve(false)}>Keep it excluded</Button>
        <Button variant="danger" onClick={() => request.resolve(true)}>Allow it anyway</Button>
      </>}
    >
      <div className="grid gap-3 text-[13.5px] text-ink-2">
        <Notice tone="warn" title="Trust check did not pass"><span className="inline-flex items-start gap-2"><ShieldAlert size={15} className="mt-0.5 shrink-0" aria-hidden />{request.reason}</span></Notice>
        <p>{request.consequences}</p>
      </div>
    </Modal>
  );
}

/** The transaction preview: everything an approval covers, from the store. */
export function PlanPreview({ run, compact = false }: { run: WorkflowRun; compact?: boolean }) {
  const plan = run.plan;
  if (!plan) return <Notice tone="warn">There is no allocation plan yet.</Notice>;
  const transport = logisticsTotals(run.shipmentPlans);
  const lines = reservationLines(run);
  const offers = new Map(run.offers.map((offer) => [offer.offerId, offer]));
  const high = run.risks.filter((risk) => risk.severity === "critical" || risk.severity === "high");
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Supplies", inr(plan.totalCost), `of ${inr(plan.budget)} budget`],
          ["Transport", inr(transport.cost), `${transport.assigned} of ${run.shipmentPlans.length} shipments assigned`],
          ["Shortage covered", `${overallFulfilmentPct(plan)}%`, `${num(plan.unfulfilled.reduce((sum, line) => sum + line.quantity, 0))} units unfulfilled`],
          ["Longest delivery", `${transport.longestHours || plan.estimatedCompletionHours} h`, transport.late ? `${transport.late} shipment(s) late` : "all assigned shipments on time"],
        ].map(([label, value, hint]) => (
          <div key={label} className="rounded-lg border border-line bg-slate-50 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
            <div className="tabular mt-0.5 text-[18px] font-semibold">{value}</div>
            <div className="text-[12px] text-muted">{hint}</div>
          </div>
        ))}
      </div>

      <div>
        <h3 className="mb-1.5 text-[13px] font-semibold">Supplier reservations <span className="font-normal text-muted">— written to the supplier marketplace, in its own window</span></h3>
        <Table label="Supplier reservations to approve">
          <thead><tr><Th>Offer</Th><Th>Supplier</Th><Th>Resource</Th><Th right>Quantity</Th><Th right>Unit price</Th><Th right>Line total</Th></tr></thead>
          <tbody>
            {lines.map((line) => {
              const offer = offers.get(line.offerId);
              return (
                <tr key={line.offerId}>
                  <Td className="font-mono text-[12px]">{line.offerId}</Td>
                  <Td>{offer?.supplierName ?? "—"}</Td>
                  <Td>{offer ? RESOURCES[offer.resource].label : "—"}</Td>
                  <Td right>{num(line.quantity)}</Td>
                  <Td right>{inr(line.unitPrice)}{offer && line.unitPrice < offer.listUnitPrice && <span className="ml-1 text-[11.5px] text-ok">quoted</span>}</Td>
                  <Td right>{inr(line.quantity * line.unitPrice)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>

      {!compact && (
        <div>
          <h3 className="mb-1.5 text-[13px] font-semibold">Shipments <span className="font-normal text-muted">— written to the logistics network, in its own window</span></h3>
          <Table label="Shipments to approve">
            <thead><tr><Th>Reference</Th><Th>Route</Th><Th right>Weight</Th><Th>Provider and vehicle</Th><Th right>Door to door</Th><Th right>Cost</Th></tr></thead>
            <tbody>
              {run.shipmentPlans.map((item) => (
                <tr key={item.reference}>
                  <Td className="font-mono text-[12px]">{item.reference}</Td>
                  <Td>{item.supplierName} → {item.shelterName}</Td>
                  <Td right>{num(item.weightKg)} kg</Td>
                  <Td>{item.assigned ? <>{item.providerName} · {item.vehicles} × {item.vehicleType?.replace(/_/g, " ")}</> : <Badge tone="critical">No transport</Badge>}</Td>
                  <Td right>{item.totalHours !== null ? <>{item.totalHours} h {!item.onTime && <Badge tone="warn">late</Badge>}</> : "—"}</Td>
                  <Td right>{item.assigned ? inr(item.cost) : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      {high.length > 0 && (
        <Notice tone="warn" title={`${high.length} high or critical risk(s) remain`}>
          <ul className="list-disc pl-4">{high.slice(0, 5).map((risk) => <li key={risk.id}>{risk.title}</li>)}</ul>
        </Notice>
      )}
      {plan.unfulfilled.length > 0 && (
        <Notice tone="warn" title="Not everything is covered">
          {plan.unfulfilled.slice(0, 4).map((line) => `${line.shelterName}: ${num(line.quantity)} ${RESOURCES[line.resource].label.toLowerCase()} (${line.detail})`).join(" ")}
        </Notice>
      )}
    </div>
  );
}

/** Approve or reject the whole plan. Used by the dashboard's own button. */
export function ApprovalDialog({ incidentId, onClose }: { incidentId: string; onClose: () => void }) {
  const run = useStore((state) => state.runs[incidentId]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!run) return null;
  const check = canApprove(run);
  const decide = async (approved: boolean) => {
    setBusy(true);
    const result = await decidePlan(incidentId, approved, "dashboard", note);
    setBusy(false);
    if (!result.ok) { setError(result.reason || "The decision could not be recorded."); return; }
    useUi.getState().notify(approved ? "Plan approved. Confirm each external write in the Execution panel." : "Plan rejected. Nothing will be written to any partner.", approved ? "ok" : "warn");
    onClose();
  };
  return (
    <Modal
      wide
      title="Review and approve the response plan"
      onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Decide later</Button>
        <Button variant="danger" onClick={() => decide(false)} disabled={busy || !check.ok}>Reject the plan</Button>
        <Button variant="primary" onClick={() => decide(true)} busy={busy} disabled={!check.ok}>Approve the plan</Button>
      </>}
    >
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
          <SimBadge />
          <span>Approving records your decision and unlocks execution. It writes nothing by itself: you then confirm the reservation and the shipment booking separately, each in the partner site's own window.</span>
        </div>
        {!check.ok && <Notice tone="critical">{check.reason}</Notice>}
        {error && <Notice tone="critical">{error}</Notice>}
        <PlanPreview run={run} />
        <label className="grid gap-1 text-[12.5px] font-semibold text-ink-2">
          Note for the audit trail (optional)
          <textarea className={inputClass} rows={2} maxLength={400} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why you approved or rejected" />
        </label>
      </div>
    </Modal>
  );
}

/**
 * Confirmation of one of this site's own irreversible actions, asked for by a model-driven
 * agent. The runtime, not the model, owns this dialog. For the plan-approval action it
 * shows the full plan; for anything else it shows the exact call.
 */
export function ActionReviewDialog() {
  const review = useUi((state) => state.review);
  const activeIncidentId = useStore((state) => state.activeIncidentId);
  const runs = useStore((state) => state.runs);
  if (!review) return null;
  const pageOrigin = window.location.origin;
  const approval = review.items.length === 1 && review.items[0].action === "submit_plan_for_approval" && review.items[0].origin === pageOrigin;
  const incidentId = approval ? String((review.items[0].arguments as { incidentId?: string })?.incidentId || activeIncidentId || "") : "";
  const run = incidentId ? runs[incidentId] : undefined;
  const check = approval && run ? canApprove(run) : { ok: true, reason: "" };

  const reject = () => {
    if (approval && incidentId && check.ok) void decidePlan(incidentId, false, "assistant", "Rejected in the confirmation dialog.");
    review.resolve(false);
  };

  return (
    <Modal
      key={review.id}
      wide={approval}
      tone="warn"
      title={approval ? "An agent asks you to approve the response plan" : "Confirm this action"}
      onClose={reject}
      footer={<>
        <Button variant={approval ? "danger" : "ghost"} onClick={reject}>{approval ? "Reject the plan" : "Don't do it"}</Button>
        <Button variant="primary" disabled={!check.ok} onClick={() => review.resolve(true)}>{approval ? "Approve the plan" : "Confirm"}</Button>
      </>}
    >
      <div className="grid gap-4">
        {approval ? (
          <>
            <p className="text-[13.5px] text-ink-2">The agent cannot approve anything itself. This is your decision. Approving unlocks execution; you then confirm each external write in the partner site's own window.</p>
            {!check.ok && <Notice tone="critical">{check.reason}</Notice>}
            {run && <PlanPreview run={run} />}
          </>
        ) : (
          <p className="text-[13.5px] text-ink-2">An agent proposed the action below. It runs only if you confirm.</p>
        )}
        <details className="rounded-lg border border-line bg-slate-50 p-3 text-[12.5px]" open={!approval}>
          <summary className="cursor-pointer font-semibold">Technical details</summary>
          {review.items.map((item, index) => (
            <pre key={index} className="mt-2 whitespace-pre-wrap break-words font-mono text-[12px]">{`${item.action} on ${item.origin} (${item.effect})\n${JSON.stringify(item.arguments, null, 2)}`}</pre>
          ))}
        </details>
      </div>
    </Modal>
  );
}

export function Toast() {
  const toast = useUi((state) => state.toast);
  const clear = useUi((state) => state.clearToast);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(clear, toast.tone === "error" ? 9000 : 5000);
    return () => window.clearTimeout(timer);
  }, [toast, clear]);
  if (!toast) return null;
  const tone = { ok: "border-green-200 bg-ok-soft text-[#05603a]", warn: "border-orange-200 bg-high-soft text-[#7c2d12]", error: "border-red-200 bg-critical-soft text-[#7a271a]" }[toast.tone];
  return (
    <div role="status" className={`rm-fade-in fixed bottom-5 left-1/2 z-50 max-w-[min(92vw,640px)] -translate-x-1/2 rounded-lg border px-4 py-2.5 text-[13.5px] font-medium shadow-lg ${tone}`}>
      {toast.text}
    </div>
  );
}
