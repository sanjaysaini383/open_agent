// The Approval Center: everything that waits for a person, in one place. Each item says
// what will happen, which agent asked, why it is recommended and what the consequences
// are. Sensitive actions ask for explicit confirmation; external writes are confirmed
// again in the partner's own window.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, ClipboardCheck, ExternalLink, Inbox, PackageCheck, ShieldQuestion, Truck, UserCheck, XCircle } from "lucide-react";
import { ApprovalDialog, PlanPreview } from "@/components/dialogs";
import { Item, Stagger } from "@/components/motion";
import { Badge, Button, Card, CardHeader, Empty, KeyValue, Modal, Notice, PageHeader, SimBadge, Stat, Table, Td, Th, time } from "@/components/ui";
import { overallFulfilmentPct } from "@/domain/allocation";
import { logisticsTotals } from "@/domain/logistics";
import { inr, num, RESOURCES } from "@/domain/resources";
import type { Incident } from "@/domain/types";
import { useStore } from "@/state/store";
import type { AssistanceRequest, WorkflowRun } from "@/state/types";
import { useUi } from "@/state/ui";
import { bookTransport, canApprove, clearUnknown, decidePlan, recordDeliveries, reserveStock } from "@/workflow/execution";
import { setSupplierOverride } from "@/workflow/steps";

type Kind = "plan" | "supplier" | "reservation" | "booking" | "receipts" | "request" | "unknown";

interface PendingItem {
  id: string;
  kind: Kind;
  incident: Incident;
  run: WorkflowRun;
  title: string;
  what: string;
  requestedBy: string;
  why: string[];
  consequences: string;
  sensitive: boolean;
  request?: AssistanceRequest;
  organizationId?: string;
  which?: "reservation" | "booking";
}

const ICON: Record<Kind, typeof ClipboardCheck> = { plan: ClipboardCheck, supplier: ShieldQuestion, reservation: PackageCheck, booking: Truck, receipts: CheckCircle2, request: Inbox, unknown: XCircle };

function pendingItems(incidents: Incident[], runs: Record<string, WorkflowRun>, inbox: AssistanceRequest[], orgTrust: ReturnType<typeof useStore.getState>["orgTrust"]): PendingItem[] {
  const items: PendingItem[] = [];
  for (const incident of incidents.filter((item) => item.status !== "closed")) {
    const run = runs[incident.id];
    if (!run) continue;
    const base = { incident, run };
    if (canApprove(run).ok && run.approval.status === "none") {
      const plan = run.plan!;
      const transport = logisticsTotals(run.shipmentPlans);
      items.push({
        ...base, id: `${incident.id}:plan`, kind: "plan", title: `Approve the response plan for ${incident.name}`,
        what: `${plan.lines.length} allocation lines across ${plan.bySupplier.length} suppliers (${inr(plan.totalCost)} of ${inr(plan.budget)}) and ${run.shipmentPlans.length} shipments (${inr(transport.cost)} transport).`,
        requestedBy: "ResourceAllocationAgent and LogisticsAgent",
        why: [`${overallFulfilmentPct(plan)}% of the assessed shortage is covered.`, ...plan.notes.slice(0, 2), ...(transport.late ? [`${transport.late} shipment(s) arrive after the deadline.`] : ["Every assigned shipment is on time."]), ...run.risks.filter((risk) => risk.severity === "critical" || risk.severity === "high").slice(0, 2).map((risk) => `Risk: ${risk.title}.`)],
        consequences: "Approving records your decision with a digest of this exact plan and unlocks execution. It writes nothing by itself: the reservation and the booking are confirmed separately, each in the partner's own window. Rejecting keeps the plan from being executed.",
        sensitive: true,
      });
    }
    if (run.approval.status === "approved" && ["none", "declined", "refused"].includes(run.reservation.status)) {
      const lines = plan_lines(run);
      items.push({ ...base, id: `${incident.id}:reservation`, kind: "reservation", title: `Reserve stock with the supplier marketplace for ${incident.id}`, what: `${lines} reservation line(s) totalling ${inr(run.plan?.totalCost ?? 0)}, at the quoted or list prices in the approved plan.`, requestedBy: "ResourceAllocationAgent (after your approval)", why: ["The plan is approved and its digest still matches.", "Stock is not held for you until the supplier confirms the reservation."], consequences: "Opens AidSupply's own window on its origin. You confirm there; this page only receives the receipt. In this demonstration the reservation is a record in the partner's storage, not a real order.", sensitive: true });
    }
    if (run.reservation.status === "confirmed" && ["none", "declined", "refused"].includes(run.booking.status)) {
      const transport = logisticsTotals(run.shipmentPlans);
      items.push({ ...base, id: `${incident.id}:booking`, kind: "booking", title: `Book transport with the logistics network for ${incident.id}`, what: `${transport.assigned} shipment(s), ${num(transport.weightKg)} kg, ${inr(transport.cost)} transport cost.`, requestedBy: "LogisticsAgent (after your approval)", why: ["The stock reservation is confirmed.", transport.late ? `${transport.late} shipment(s) are expected late; the plan says so.` : "All assigned shipments are on time."], consequences: "Opens RouteBridge's own window on its origin. You confirm there. Tracking codes are issued by the partner; no vehicle really moves in this demonstration.", sensitive: true });
    }
    const undelivered = run.shipments.filter((item) => item.status === "delivered" && !item.deliveryReceipt);
    if (undelivered.length) items.push({ ...base, id: `${incident.id}:receipts`, kind: "receipts", title: `Record ${undelivered.length} delivery receipt${undelivered.length === 1 ? "" : "s"} at the shelter`, what: undelivered.map((item) => `${item.trackingCode}: ${item.cargo.map((line) => `${num(line.quantity)} ${RESOURCES[line.resource].label.toLowerCase()}`).join(", ")} to ${item.shelterName}`).join("; "), requestedBy: "AuditAgent", why: ["These shipments were marked delivered. The shelter's stock changes only when it confirms receipt."], consequences: "Opens ShelterConnect's own window, where the shelter confirms receipt and updates its stock.", sensitive: false });
    for (const which of ["reservation", "booking"] as const) {
      if (run[which].status === "unknown") items.push({ ...base, id: `${incident.id}:${which}:unknown`, kind: "unknown", which, title: `The ${which}'s outcome is unknown for ${incident.id}`, what: run[which].error || "The partner did not confirm the result.", requestedBy: "AuditAgent", why: ["A write whose result never arrived is never retried automatically."], consequences: "Check the partner site. Clearing allows one more attempt.", sensitive: true });
    }
    for (const offer of run.offers) {
      const injected = offer.flags.some((flag) => flag.kind === "instruction_injection");
      if (offer.trust === "unverified" && !injected && !run.overrides.includes(offer.organizationId) && !items.some((item) => item.organizationId === offer.organizationId && item.incident.id === incident.id)) {
        const evaluation = orgTrust[offer.organizationId];
        items.push({ ...base, id: `${incident.id}:supplier:${offer.organizationId}`, kind: "supplier", organizationId: offer.organizationId, title: `Allow unverified supplier ${offer.supplierName}?`, what: `${offer.supplierName} offers ${run.offers.filter((item) => item.organizationId === offer.organizationId).map((item) => `${num(item.quantityAvailable)} ${RESOURCES[item.resource].label.toLowerCase()}`).join(", ")}. It is excluded from the allocation.`, requestedBy: "SupplierMatchingAgent (flagged, not recommended)", why: [evaluation ? [...evaluation.blockers, ...evaluation.warnings].join(" ") || "No registry record for this organisation." : "The trust registry has no record for this organisation.", "An unverified supplier is never used unless a person allows it, and the override is audited."], consequences: "Its offers become eligible for this incident only. A blocked supplier can never be allowed.", sensitive: true });
      }
    }
  }
  for (const request of inbox.filter((item) => item.status === "new")) {
    const incident = incidents[0];
    if (!incident) break;
    items.push({ incident, run: runs[incident.id], id: `request:${request.reference}`, kind: "request", request, title: `${request.organization} asks for assistance (${request.reference})`, what: request.summary + (request.resource && request.quantity ? ` — ${num(request.quantity)} × ${RESOURCES[request.resource as keyof typeof RESOURCES]?.label ?? request.resource}` : ""), requestedBy: `A partner agent on ${request.callerOrigin}, confirmed by a person in a ReliefMesh window`, why: [`Urgency ${request.urgency}, category ${request.category}.`], consequences: "Acknowledging records the request; it orders nothing. Dismissing records that too.", sensitive: false });
  }
  return items;
}

function plan_lines(run: WorkflowRun): number {
  return new Set((run.plan?.lines ?? []).map((line) => line.offerId)).size;
}

function PendingCard({ item }: { item: PendingItem }) {
  const [approving, setApproving] = useState(false);
  const [confirm, setConfirm] = useState<"reject" | "allow" | "clear" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const navigate = useNavigate();
  const Icon = ICON[item.kind];
  const act = async (name: string, work: () => Promise<{ ok: boolean; reason?: string; summary?: string }>) => {
    setBusy(name);
    try { const outcome = await work(); useUi.getState().notify(outcome.ok ? outcome.summary || "Done." : outcome.reason || "Not completed.", outcome.ok ? "ok" : "warn"); } finally { setBusy(null); }
  };
  const decideRequest = async (status: AssistanceRequest["status"]) => {
    const store = useStore.getState();
    store.setInboxStatus(item.request!.reference, status);
    await store.record({ kind: "incident", actor: "human:coordinator", incidentId: store.activeIncidentId, summary: `Assistance request ${item.request!.reference} ${status}`, data: { organization: item.request!.organization, callerOrigin: item.request!.callerOrigin } });
  };
  const tone = item.kind === "plan" ? "warn" : item.kind === "unknown" ? "critical" : item.kind === "supplier" ? "warn" : "accent";
  return (
    <Card tone={tone === "accent" ? "accent" : tone}>
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-3 text-accent-text" aria-hidden><Icon size={17} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold">{item.title}</h2>
            <Badge tone="neutral">{item.incident.id}</Badge>
            {item.sensitive && <Badge tone="warn">Explicit confirmation</Badge>}
          </div>
          <div className="mt-2"><KeyValue items={[["What will happen", item.what], ["Requested by", <span className="font-mono text-[12.5px]">{item.requestedBy}</span>], ["Why", <ul className="list-disc pl-4">{item.why.map((reason, index) => <li key={index}>{reason}</li>)}</ul>], ["Consequences", item.consequences]]} /></div>
          {item.kind === "plan" && <details className="mt-3 rounded-lg border border-line bg-surface-2 p-3 text-[12.5px]"><summary className="cursor-pointer font-semibold">Full plan preview</summary><div className="mt-2"><PlanPreview run={item.run} /></div></details>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {item.kind === "plan" && <>
              <Button variant="primary" onClick={() => setApproving(true)}><UserCheck size={14} aria-hidden />Review and approve</Button>
              <Button variant="danger" onClick={() => setConfirm("reject")}>Reject</Button>
              <Button variant="ghost" onClick={() => navigate(`/incidents/${item.incident.id}`)}>Open incident</Button>
            </>}
            {item.kind === "reservation" && <Button variant="primary" busy={busy === "reserve"} onClick={() => act("reserve", () => reserveStock(item.incident.id))}><ExternalLink size={14} aria-hidden />Reserve stock in AidSupply's window</Button>}
            {item.kind === "booking" && <Button variant="primary" busy={busy === "book"} onClick={() => act("book", () => bookTransport(item.incident.id))}><ExternalLink size={14} aria-hidden />Book transport in RouteBridge's window</Button>}
            {item.kind === "receipts" && <Button variant="primary" busy={busy === "deliver"} onClick={() => act("deliver", () => recordDeliveries(item.incident.id))}><ExternalLink size={14} aria-hidden />Record receipts in ShelterConnect's window</Button>}
            {item.kind === "unknown" && <Button onClick={() => setConfirm("clear")}>I checked the partner: clear and allow a retry</Button>}
            {item.kind === "supplier" && <>
              <Button variant="danger" onClick={() => setConfirm("allow")}>Allow this supplier for this incident</Button>
              <Button variant="ghost" onClick={() => navigate("/trust")}>See the trust evidence</Button>
            </>}
            {item.kind === "request" && <>
              <Button variant="primary" onClick={() => decideRequest("acknowledged")}>Acknowledge</Button>
              <Button variant="ghost" onClick={() => decideRequest("dismissed")}>Dismiss</Button>
            </>}
          </div>
        </div>
      </div>
      {approving && <ApprovalDialog incidentId={item.incident.id} onClose={() => setApproving(false)} />}
      {confirm === "reject" && (
        <Modal tone="critical" title="Reject the response plan?" onClose={() => setConfirm(null)} footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Keep deciding</Button><Button variant="danger" onClick={async () => { const result = await decidePlan(item.incident.id, false, "dashboard", "Rejected in the Approval Center."); setConfirm(null); useUi.getState().notify(result.ok ? "Plan rejected. Nothing will be written to any partner." : result.reason || "Not recorded.", result.ok ? "warn" : "error"); }}>Reject the plan</Button></>}>
          <p className="text-[13.5px] text-ink-2">Rejecting records your decision in the audit trail. The plan stays visible and can be re-planned; nothing is written to any partner.</p>
        </Modal>
      )}
      {confirm === "allow" && (
        <Modal tone="critical" title={`Use unverified supplier ${item.title.replace(/^Allow unverified supplier /, "").replace(/\?$/, "")}?`} onClose={() => setConfirm(null)} footer={<><Button variant="primary" onClick={() => setConfirm(null)}>Keep it excluded</Button><Button variant="danger" onClick={async () => { await setSupplierOverride(item.incident.id, item.organizationId!, true); setConfirm(null); useUi.getState().notify("Override recorded. The supplier's offers are eligible for this incident; re-run the allocation to use them.", "warn"); }}>Allow it anyway</Button></>}>
          <Notice tone="warn" title="Trust check did not pass">{item.why[0]}</Notice>
          <p className="mt-3 text-[13.5px] text-ink-2">{item.consequences} This override is recorded in the audit trail with your identity as coordinator.</p>
        </Modal>
      )}
      {confirm === "clear" && (
        <Modal tone="warn" title="Clear the unknown outcome?" onClose={() => setConfirm(null)} footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="primary" onClick={async () => { await clearUnknown(item.incident.id, item.which!); setConfirm(null); }}>Clear and allow a retry</Button></>}>
          <p className="text-[13.5px] text-ink-2">Only do this after checking on the partner site whether the {item.which} happened. A retry after a successful write would duplicate it.</p>
        </Modal>
      )}
    </Card>
  );
}

export function ApprovalsPage() {
  const incidents = useStore((state) => state.incidents);
  const runs = useStore((state) => state.runs);
  const inbox = useStore((state) => state.inbox);
  const orgTrust = useStore((state) => state.orgTrust);
  const audit = useStore((state) => state.audit);
  const items = useMemo(() => pendingItems(incidents, runs, inbox, orgTrust), [incidents, runs, inbox, orgTrust]);
  const decided = useMemo(() => audit.filter((entry) => entry.kind === "approval" || entry.kind === "execution" || (entry.kind === "trust" && /override|allowed/i.test(entry.summary))).slice(-20).reverse(), [audit]);
  const counts = { plans: items.filter((item) => item.kind === "plan").length, writes: items.filter((item) => item.kind === "reservation" || item.kind === "booking" || item.kind === "receipts").length, suppliers: items.filter((item) => item.kind === "supplier").length, requests: items.filter((item) => item.kind === "request").length };
  return (
    <>
      <PageHeader eyebrow="Human in the loop" title="Approval Center" subtitle={<span className="flex flex-wrap items-center gap-2">Everything waiting for a person: plans, supplier selections, external writes and partner requests. An agent can propose any of these; none happens without you. <SimBadge /></span>} />
      <div className="grid gap-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Plans to approve" number={counts.plans} tone={counts.plans ? "warn" : "neutral"} />
          <Stat label="External writes" number={counts.writes} tone={counts.writes ? "info" : "neutral"} hint="confirmed in the partner's window" />
          <Stat label="Supplier selections" number={counts.suppliers} tone={counts.suppliers ? "warn" : "neutral"} hint="unverified, excluded unless allowed" />
          <Stat label="Partner requests" number={counts.requests} tone={counts.requests ? "info" : "neutral"} />
        </div>
        {items.length ? (
          <Stagger className="grid gap-4">{items.map((item) => <Item key={item.id}><PendingCard item={item} /></Item>)}</Stagger>
        ) : <Empty icon={<ClipboardCheck size={18} />} title="Nothing is waiting for you">Pending approvals appear here as the workflow produces them: a plan to approve, a reservation or booking to confirm, a delivery to record, a supplier to allow, or a partner's request.</Empty>}
        <Card>
          <CardHeader title="Recent decisions" subtitle="From the audit trail: approvals, rejections, confirmed writes and overrides." />
          {decided.length ? (
            <Table label="Recent decisions">
              <thead><tr><Th>Time</Th><Th>Kind</Th><Th>Actor</Th><Th>Decision</Th></tr></thead>
              <tbody>{decided.map((entry) => <tr key={entry.seq}><Td className="whitespace-nowrap">{time(entry.at)}</Td><Td><Badge tone={entry.kind === "approval" ? "warn" : entry.kind === "execution" ? "ok" : "navy"}>{entry.kind}</Badge></Td><Td className="font-mono text-[12px]">{entry.actor}</Td><Td>{entry.summary}</Td></tr>)}</tbody>
            </Table>
          ) : <p className="text-[13px] text-muted">No decisions recorded yet.</p>}
        </Card>
      </div>
    </>
  );
}
