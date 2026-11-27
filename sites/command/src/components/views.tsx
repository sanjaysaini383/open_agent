// Result views for each workflow step. Used on the incident page and on the dedicated
// pages (Resource Requests, Marketplace, Logistics, Trust). All read from the store.
import { useState } from "react";
import { AlertTriangle, ArrowRight, ChevronDown, ChevronRight, ExternalLink, Flag, PackageCheck, RefreshCw, Truck } from "lucide-react";
import { overallFulfilmentPct } from "@/domain/allocation";
import { logisticsTotals } from "@/domain/logistics";
import { totalSaving } from "@/domain/negotiation";
import { COMPARISON_WEIGHTS } from "@/domain/offers";
import { inr, num, price, RESOURCE_IDS, RESOURCES } from "@/domain/resources";
import { reportReceipt } from "@/domain/schemas";
import { nextStatuses, STATUS_LABEL, summariseShipments } from "@/domain/shipments";
import type { ResourceId, ShipmentStatus, TrustEvaluation } from "@/domain/types";
import { callWrite, openRegistry } from "@/interop/peers";
import { useStore } from "@/state/store";
import type { WorkflowRun } from "@/state/types";
import { useUi } from "@/state/ui";
import { bookTransport, clearUnknown, recordDeliveries, reserveStock, setShipmentStatus, syncShipments } from "@/workflow/execution";
import { setSupplierOverride } from "@/workflow/steps";
import { ApprovalDialog, PlanPreview } from "./dialogs";
import { Badge, Button, Card, CardHeader, Empty, KeyValue, LiveBadge, Meter, Notice, SimBadge, Table, Td, Th, TrustBadge, UrgencyBadge, cx, time } from "./ui";

const useRunOf = (incidentId: string) => useStore((state) => state.runs[incidentId]);

// ---- needs ---------------------------------------------------------------------

export function AssessmentView({ incidentId }: { incidentId: string }) {
  const run = useRunOf(incidentId);
  const assessment = run?.assessment;
  if (!assessment) return <Empty title="No assessment yet">Step 2 reads shelter requirements and stock from ShelterConnect and computes the shortages.</Empty>;
  const allocated = (shelterId: string, resource: ResourceId) => (run.plan?.lines || []).filter((line) => line.shelterId === shelterId && line.resource === resource).reduce((sum, line) => sum + line.quantity, 0);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
        <SimBadge /><LiveBadge label={`Read from ${assessment.source.label}`} />
        <span>Assessed {time(assessment.generatedAt)} from <span className="font-mono">{assessment.source.networkUrl}</span></span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {RESOURCE_IDS.map((resource) => {
          const total = assessment.totals[resource];
          const covered = total.required ? Math.round((total.inStock / total.required) * 100) : 100;
          return (
            <div key={resource} className="rounded-lg border border-line bg-surface p-3.5">
              <div className="text-[12px] font-semibold text-muted">{RESOURCES[resource].label}</div>
              <div className="tabular mt-1 text-[22px] font-semibold text-critical">{num(total.shortage)} <span className="text-[12.5px] font-medium text-muted">short</span></div>
              <div className="tabular mt-0.5 text-[12.5px] text-muted">{num(total.required)} required · {num(total.inStock)} in stock</div>
              <div className="mt-2"><Meter value={covered} tone={covered >= 60 ? "ok" : covered >= 25 ? "warn" : "critical"} /></div>
              {total.declared !== total.required && <div className="mt-1.5 text-[11.5px] text-high">Incident declared {num(total.declared)}</div>}
            </div>
          );
        })}
      </div>
      {assessment.discrepancies.length > 0 && <Notice tone="warn" title="Declared and reported figures differ">{assessment.discrepancies.join(" ")}</Notice>}
      <Table label="Shelter needs by priority">
        <thead><tr><Th right>Rank</Th><Th>Shelter</Th><Th>Resource</Th><Th right>Required</Th><Th right>In stock</Th><Th right>Shortage</Th><Th right>Allocated</Th><Th>Urgency</Th><Th right>Priority</Th><Th right>Deadline</Th></tr></thead>
        <tbody>
          {assessment.lines.map((line) => {
            const got = allocated(line.shelterId, line.resource);
            return (
              <tr key={line.id}>
                <Td right>{line.priorityRank}</Td>
                <Td><span className="font-medium">{line.shelterName}</span><div className="text-[11.5px] text-muted">{line.shelterId} · {num(line.peopleServed)} people</div></Td>
                <Td>{RESOURCES[line.resource].label}</Td>
                <Td right>{num(line.required)}</Td>
                <Td right>{num(line.inStock)}</Td>
                <Td right><span className={line.shortage ? "font-semibold text-critical" : "text-ok"}>{num(line.shortage)}</span></Td>
                <Td right>{run.plan ? <span className={got >= line.shortage ? "text-ok" : "text-high"}>{num(got)}</span> : "—"}</Td>
                <Td><UrgencyBadge urgency={line.urgency} /></Td>
                <Td right><span title={line.priorityBasis.join("\n")} className="cursor-help underline decoration-dotted">{line.priorityScore}</span></Td>
                <Td right>{line.hoursToDeadline} h</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <p className="text-[12.5px] text-muted">Priority = 50 × urgency + 20 × share uncovered + 20 × resource criticality + 10 × deadline pressure. Hover a score for its parts. Computed here, not by a model.</p>
    </div>
  );
}

// ---- trust ---------------------------------------------------------------------

export function EvidenceList({ evaluation }: { evaluation: TrustEvaluation }) {
  const tone = { pass: "text-ok", warn: "text-high", fail: "text-critical", info: "text-muted" } as const;
  return (
    <div className="grid gap-2">
      <ul className="grid gap-1 text-[12.5px]">
        {evaluation.evidence.map((item) => (
          <li key={item.id} className="grid grid-cols-[150px_52px_1fr] items-baseline gap-2">
            <span className="font-semibold text-ink-2">{item.label}</span>
            <span className={cx("tabular font-semibold", tone[item.status])}>{item.earned}/{item.weight}</span>
            <span className="text-muted">{item.detail}</span>
          </li>
        ))}
      </ul>
      {evaluation.blockers.length > 0 && <Notice tone="critical">{evaluation.blockers.join(" ")}</Notice>}
      {evaluation.warnings.length > 0 && <Notice tone="warn">{evaluation.warnings.join(" ")}</Notice>}
      <p className="text-[12px] text-muted">
        {evaluation.signatureVerified ? "The signature on this attestation was verified in your browser (ECDSA P-256, SHA-256)." : "No signature was verified for this subject."} Checked {time(evaluation.evaluatedAt)} against {evaluation.registry}.
      </p>
    </div>
  );
}

export function TrustRow({ evaluation, extra }: { evaluation: TrustEvaluation; extra?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr>
        <Td>
          <button type="button" className="flex items-center gap-1.5 text-left font-medium" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}{evaluation.name}
          </button>
          <div className="pl-5 font-mono text-[11.5px] text-muted">{evaluation.subjectId}</div>
        </Td>
        <Td><TrustBadge decision={evaluation.decision} /></Td>
        <Td right>{evaluation.score}</Td>
        <Td>{evaluation.signatureVerified ? <Badge tone="ok">Signature verified</Badge> : <Badge tone="neutral">No verified signature</Badge>}</Td>
        <Td className="text-muted">{[...evaluation.blockers, ...evaluation.warnings][0] || "No concerns."}</Td>
        <Td>{extra}</Td>
      </tr>
      {open && <tr><Td colSpan={6} className="bg-surface-2"><EvidenceList evaluation={evaluation} /></Td></tr>}
    </>
  );
}

/** File a suspicious-agent report with TrustRegistry. It is confirmed in the registry's own window. */
export function ReportButton({ subjectId, name, reason, details }: { subjectId: string; name: string; reason: string; details: string }) {
  const [busy, setBusy] = useState(false);
  const report = async () => {
    setBusy(true);
    const store = useStore.getState();
    try {
      const grant = await openRegistry({ incidentId: store.activeIncidentId, agent: "TrustVerificationAgent" }, `File a suspicious-agent report about ${name}`, ["report_suspicious_agent (confirmed in the registry's own window)"]);
      const result = await callWrite(grant, "report_suspicious_agent", { subjectId, reason, details: details.slice(0, 280) }, reportReceipt);
      await store.record({ kind: "trust", actor: "human:coordinator", incidentId: store.activeIncidentId, summary: result.ok ? `Reported ${name} to the trust registry (${result.reference})` : `Report about ${name} not filed: ${result.reason}`, data: { subjectId, reason, reference: result.reference ?? null } });
      useUi.getState().notify(result.ok ? `Report ${result.reference} filed with the trust registry.` : `Not filed: ${result.reason}`, result.ok ? "ok" : "warn");
    } catch (error) {
      useUi.getState().notify((error as Error).message, "warn");
    } finally {
      setBusy(false);
    }
  };
  return <Button size="sm" busy={busy} onClick={report} title="Opens the trust registry's own window, where you confirm the report"><Flag size={12} aria-hidden />Report</Button>;
}

// ---- offers and negotiation ---------------------------------------------------------

export function OffersView({ incidentId }: { incidentId: string }) {
  const run = useRunOf(incidentId);
  const orgTrust = useStore((state) => state.orgTrust);
  const [resource, setResource] = useState<ResourceId | "all">("all");
  if (!run?.offers.length) return <Empty title="No offers yet">Step 5 collects offers from AidSupply, checks every supplier with TrustRegistry and ranks the eligible offers.</Empty>;
  const shortage = (id: ResourceId) => run.assessment?.totals[id].shortage ?? 0;
  const groups = RESOURCE_IDS.filter((id) => resource === "all" || resource === id).map((id) => ({ id, offers: run.offers.filter((offer) => offer.resource === id) })).filter((group) => group.offers.length);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SimBadge /><LiveBadge label="Read from AidSupply" />
        <div className="ml-auto flex flex-wrap gap-1">
          {(["all", ...RESOURCE_IDS] as const).map((id) => (
            <Button key={id} size="sm" variant={resource === id ? "primary" : "secondary"} onClick={() => setResource(id)}>{id === "all" ? "All resources" : RESOURCES[id].label}</Button>
          ))}
        </div>
      </div>
      {groups.map((group) => (
        <div key={group.id}>
          <h3 className="mb-1.5 text-[13.5px] font-semibold">{RESOURCES[group.id].label} <span className="font-normal text-muted">— {num(shortage(group.id))} short</span></h3>
          <Table label={`Offers for ${RESOURCES[group.id].label}`}>
            <thead><tr><Th right>Rank</Th><Th>Organisation</Th><Th right>Available</Th><Th right>Unit price</Th><Th right>Cost to cover</Th><Th>Location</Th><Th right>Lead time</Th><Th>Verification</Th><Th right>Score</Th><Th>Status</Th></tr></thead>
            <tbody>
              {group.offers.map((offer) => {
                const need = Math.min(offer.quantityAvailable, shortage(group.id));
                const evaluation = orgTrust[offer.organizationId];
                const injected = offer.flags.some((flag) => flag.kind === "instruction_injection");
                const overridable = offer.trust === "unverified" && !injected;
                return (
                  <tr key={offer.offerId} className={offer.eligible ? undefined : "bg-surface-2/70"}>
                    <Td right>{offer.rank || "—"}</Td>
                    <Td>
                      <span className="font-medium">{offer.supplierName}</span>
                      <div className="font-mono text-[11.5px] text-muted">{offer.offerId} · {offer.supplierType === "ngo" ? "NGO" : "commercial"}</div>
                      {offer.flags.filter((flag) => flag.severity !== "info").map((flag, index) => (
                        <div key={index} className={cx("mt-1 flex items-start gap-1 text-[11.5px]", flag.severity === "critical" ? "text-critical" : "text-high")}><AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />{flag.detail}</div>
                      ))}
                    </Td>
                    <Td right>{num(offer.quantityAvailable)}<div className="text-[11.5px] text-muted">min {num(offer.minOrder)}</div></Td>
                    <Td right>{price(offer.unitPrice)}{offer.unitPrice < offer.listUnitPrice && <div className="text-[11.5px] text-ok">list {price(offer.listUnitPrice)}</div>}</Td>
                    <Td right>{inr(need * offer.unitPrice)}<div className="text-[11.5px] text-muted">for {num(need)}</div></Td>
                    <Td>{offer.location.city}<div className="text-[11.5px] text-muted">{num(offer.distanceKm)} km est.</div></Td>
                    <Td right>{offer.leadTimeHours} h</Td>
                    <Td><TrustBadge decision={evaluation?.decision ?? offer.trust} score={evaluation?.score} /></Td>
                    <Td right><span className="cursor-help underline decoration-dotted" title={`price ${offer.scoreParts.price} · delivery ${offer.scoreParts.delivery} · distance ${offer.scoreParts.distance} · reliability ${offer.scoreParts.reliability}`}>{offer.score.toFixed(2)}</span></Td>
                    <Td>
                      {offer.eligible ? <Badge tone="ok">Eligible</Badge> : <Badge tone="critical">Excluded</Badge>}
                      {!offer.eligible && <div className="mt-1 max-w-[230px] text-[11.5px] text-muted">{offer.exclusionReasons[0]}</div>}
                      {overridable && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          <Button size="sm" onClick={() => setSupplierOverride(incidentId, offer.organizationId, !run.overrides.includes(offer.organizationId))}>{run.overrides.includes(offer.organizationId) ? "Withdraw override" : "Allow anyway…"}</Button>
                        </div>
                      )}
                      {(injected || offer.flags.some((flag) => flag.kind === "price_anomaly")) && (
                        <div className="mt-1.5"><ReportButton subjectId={`org:${offer.organizationId}`} name={offer.supplierName} reason={injected ? "instruction_injection" : "price_anomaly"} details={offer.flags.map((flag) => flag.detail).join(" ")} /></div>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      ))}
      <p className="text-[12.5px] text-muted">
        Score = {COMPARISON_WEIGHTS.price} × price + {COMPARISON_WEIGHTS.delivery} × delivery + {COMPARISON_WEIGHTS.distance} × distance + {COMPARISON_WEIGHTS.reliability} × (1 − trust score ÷ 100), each normalised within the resource; lower is better. Supplier free text is treated as untrusted data: it is scanned, never obeyed, and never shown to the allocation engine. Verification comes from TrustRegistry, not from the supplier.
      </p>
    </div>
  );
}

export function NegotiationView({ incidentId }: { incidentId: string }) {
  const run = useRunOf(incidentId);
  if (!run?.negotiation.length) return <Empty title="No negotiation yet">Step 6 asks each supplier in the draft plan for a non-binding quote on the exact quantity the plan would buy.</Empty>;
  const outcome = { improved: "ok", unchanged: "neutral", refused: "critical", skipped: "neutral" } as const;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SimBadge /><LiveBadge label="Quotes requested from AidSupply" />
        <span className="ml-auto text-[13px]">Saving against list prices: <strong className="text-ok">{inr(totalSaving(run.negotiation))}</strong></span>
      </div>
      <ol className="grid gap-2">
        {run.negotiation.map((event) => (
          <li key={event.id} className="rm-fade-in rounded-lg border border-line bg-surface p-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
              <Badge tone="navy">Round {event.round}</Badge>
              <span className="font-semibold">{event.supplierName}</span>
              <span className="text-muted">{num(event.quantity)} × {RESOURCES[event.resource].label.toLowerCase()}</span>
              <span className="tabular ml-auto flex items-center gap-1.5">
                <span className="text-muted">list {price(event.listUnitPrice)}</span><ArrowRight size={12} className="text-faint" aria-hidden />
                <span className="text-muted">asked {price(event.targetUnitPrice)}</span><ArrowRight size={12} className="text-faint" aria-hidden />
                <strong>{event.quotedUnitPrice !== null ? price(event.quotedUnitPrice) : "no quote"}</strong>
              </span>
              <Badge tone={outcome[event.outcome]}>{event.outcome}{event.saving > 0 ? ` · saves ${inr(event.saving)}` : ""}</Badge>
            </div>
            <p className="mt-1 text-[12.5px] text-muted">{event.note}{event.basis.length ? ` Supplier's basis: ${event.basis.join("; ")}.` : ""}</p>
          </li>
        ))}
      </ol>
      <Notice tone="info">A quote is non-binding and commits nothing. The agent cannot reserve stock: that needs your approval of the plan and your confirmation in AidSupply's own window.</Notice>
    </div>
  );
}

// ---- allocation ----------------------------------------------------------------

export function AllocationView({ incidentId }: { incidentId: string }) {
  const run = useRunOf(incidentId);
  const [open, setOpen] = useState<string | null>(null);
  if (run?.planProblems.length) return <Notice tone="critical" title="The engine's plan failed validation and is not shown">{run.planProblems.join(" ")}</Notice>;
  const plan = run?.plan;
  if (!plan) return <Empty title="No allocation plan yet">Step 7 assigns supplier stock to shelters within the budget and validates every invariant.</Empty>;
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Plan cost", inr(plan.totalCost), `${inr(plan.budgetRemaining)} of budget left`],
          ["Shortage covered", `${overallFulfilmentPct(plan)}%`, `${plan.lines.length} allocation lines`],
          ["Unfulfilled", num(plan.unfulfilled.reduce((sum, line) => sum + line.quantity, 0)), "units"],
          ["Estimated completion", `${plan.estimatedCompletionHours} h`, run.lanesSource === "routebridge" ? "transit from RouteBridge" : "transit is ReliefMesh's estimate"],
        ].map(([label, value, hint]) => (
          <div key={label} className="rounded-lg border border-line bg-surface p-3.5">
            <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{label}</div>
            <div className="tabular mt-1 text-[21px] font-semibold">{value}</div>
            <div className="text-[12px] text-muted">{hint}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {RESOURCE_IDS.map((resource) => {
          const item = plan.fulfilment[resource];
          return (
            <div key={resource} className="text-[12.5px]">
              <div className="mb-1 flex justify-between"><span className="font-semibold">{RESOURCES[resource].label}</span><span className="tabular text-muted">{num(item.allocated)} / {num(item.shortage)}</span></div>
              <Meter value={item.pct} tone={item.pct >= 100 ? "ok" : item.pct >= 70 ? "warn" : "critical"} />
            </div>
          );
        })}
      </div>
      {plan.notes.length > 0 && <Notice tone="info" title="Engine notes"><ul className="list-disc pl-4">{plan.notes.map((note, index) => <li key={index}>{note}</li>)}</ul></Notice>}
      <Table label="Allocation lines">
        <thead><tr><Th>Shelter</Th><Th>Resource</Th><Th>Supplier</Th><Th right>Quantity</Th><Th right>Unit price</Th><Th right>Cost</Th><Th right>Door to door</Th><Th>Why</Th></tr></thead>
        <tbody>
          {plan.lines.map((line) => (
            <FragmentRow key={line.id} open={open === line.id} onToggle={() => setOpen(open === line.id ? null : line.id)} reasons={line.reasons}>
              <Td><span className="font-medium">{line.shelterName}</span></Td>
              <Td>{RESOURCES[line.resource].label}</Td>
              <Td>{line.supplierName}</Td>
              <Td right>{num(line.quantity)}</Td>
              <Td right>{price(line.unitPrice)}</Td>
              <Td right>{inr(line.lineCost)}</Td>
              <Td right>{line.deliveryHours} h {!line.onTime && <Badge tone="warn">late</Badge>}</Td>
            </FragmentRow>
          ))}
        </tbody>
      </Table>
      {plan.unfulfilled.length > 0 && (
        <Notice tone="warn" title="Unfulfilled demand">
          <ul className="list-disc pl-4">{plan.unfulfilled.map((line, index) => <li key={index}>{line.shelterName}: {num(line.quantity)} {RESOURCES[line.resource].label.toLowerCase()} — {line.detail}</li>)}</ul>
        </Notice>
      )}
      {plan.excludedOffers.length > 0 && (
        <details className="rounded-lg border border-line bg-surface p-3 text-[12.5px]">
          <summary className="cursor-pointer font-semibold">{plan.excludedOffers.length} offer(s) were not available to the engine</summary>
          <ul className="mt-2 list-disc pl-4 text-muted">{plan.excludedOffers.map((offer) => <li key={offer.offerId}><span className="font-mono">{offer.offerId}</span> ({offer.supplierName}): {offer.reasons.join(" ")}</li>)}</ul>
        </details>
      )}
      <p className="text-[12.5px] text-muted">{plan.method} Weights: cost {plan.weights.cost}, time {plan.weights.time}, trust {plan.weights.trust}. The plan was re-checked against every invariant (no over-allocation, no over-ordering, no duplicates, minimum orders, budget) before it was shown. A model may explain this plan; it cannot change a number in it.</p>
    </div>
  );
}

function FragmentRow({ children, open, onToggle, reasons }: { children: React.ReactNode; open: boolean; onToggle: () => void; reasons: string[] }) {
  return (
    <>
      <tr>
        {children}
        <Td><Button size="sm" variant="ghost" onClick={onToggle} aria-expanded={open}>{open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}Reasons</Button></Td>
      </tr>
      {open && <tr><Td colSpan={8} className="bg-surface-2"><ul className="list-disc pl-5 text-[12.5px] text-ink-2">{reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul></Td></tr>}
    </>
  );
}

// ---- logistics -----------------------------------------------------------------

export function LogisticsView({ incidentId }: { incidentId: string }) {
  const run = useRunOf(incidentId);
  const [open, setOpen] = useState<string | null>(null);
  if (!run?.shipmentPlans.length) return <Empty title="No transport plan yet">Step 8 asks RouteBridge for route estimates and transport options, re-optimises the allocation if a route is infeasible, and assigns vehicles.</Empty>;
  const totals = logisticsTotals(run.shipmentPlans);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
        <SimBadge /><LiveBadge label="Options from RouteBridge" />
        <Badge tone={run.routingSource === "osrm" ? "info" : "neutral"}>Route source: {run.routingSource === "osrm" ? "OSRM routing service" : "demonstration routing dataset"}</Badge>
        <span>{totals.assigned} of {run.shipmentPlans.length} assigned · {num(totals.weightKg)} kg · {inr(totals.cost)}</span>
      </div>
      <Table label="Shipment plan">
        <thead><tr><Th>Shipment</Th><Th>Cargo</Th><Th right>Weight</Th><Th>Provider and vehicle</Th><Th right>Distance</Th><Th right>Ready + transit</Th><Th right>Cost</Th><Th>Feasibility</Th><Th /></tr></thead>
        <tbody>
          {run.shipmentPlans.map((item) => (
            <FragmentRowWide key={item.reference} open={open === item.reference} onToggle={() => setOpen(open === item.reference ? null : item.reference)} detail={
              <div className="grid gap-2 text-[12.5px]">
                <p><span className="font-semibold">Decision:</span> {item.reason}</p>
                {item.advisories.length > 0 && <p><span className="font-semibold">Advisories:</span> {item.advisories.join(" ")}</p>}
                {item.alternatives.length > 0 && (
                  <div>
                    <p className="font-semibold">Alternative providers</p>
                    <ul className="list-disc pl-5">{item.alternatives.map((option, index) => <li key={index} className={option.feasible ? undefined : "text-muted"}>{option.providerName}, {option.vehicleType.replace(/_/g, " ")}: {option.etaHours} h, {inr(option.cost)} — {option.note}</li>)}</ul>
                  </div>
                )}
              </div>
            }>
              <Td><span className="font-medium">{item.supplierName} → {item.shelterName}</span><div className="font-mono text-[11.5px] text-muted">{item.reference}</div></Td>
              <Td className="text-[12.5px]">{item.cargo.map((line) => `${num(line.quantity)} ${RESOURCES[line.resource].label.toLowerCase()}`).join(", ")}</Td>
              <Td right>{num(item.weightKg)} kg</Td>
              <Td>{item.assigned ? <>{item.providerName}<div className="text-[11.5px] text-muted">{item.vehicles} × {item.vehicleType?.replace(/_/g, " ")}</div></> : <Badge tone="critical">No transport</Badge>}</Td>
              <Td right>{num(item.haulKm)} km</Td>
              <Td right>{item.totalHours !== null ? `${item.readyInHours} + ${item.etaHours} = ${item.totalHours} h` : "—"}</Td>
              <Td right>{item.assigned ? inr(item.cost) : "—"}</Td>
              <Td>{!item.assigned ? <Badge tone="critical">Unassigned</Badge> : item.onTime ? <Badge tone="ok">On time</Badge> : <Badge tone="warn">Late</Badge>}</Td>
            </FragmentRowWide>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function FragmentRowWide({ children, open, onToggle, detail }: { children: React.ReactNode; open: boolean; onToggle: () => void; detail: React.ReactNode }) {
  return (
    <>
      <tr>{children}<Td><Button size="sm" variant="ghost" onClick={onToggle} aria-expanded={open}>{open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}Details</Button></Td></tr>
      {open && <tr><Td colSpan={9} className="bg-surface-2">{detail}</Td></tr>}
    </>
  );
}

export function FleetView({ incidentId }: { incidentId: string }) {
  const run = useRunOf(incidentId);
  const orgTrust = useStore((state) => state.orgTrust);
  if (!run?.providers.length) return <Empty title="No transport providers read yet">They are read from RouteBridge in the trust or logistics step.</Empty>;
  return (
    <div className="grid gap-3">
      <Table label="Transport providers and vehicle availability">
        <thead><tr><Th>Provider</Th><Th>Base</Th><Th>Verification</Th><Th>Vehicle</Th><Th right>Free / total</Th><Th right>Capacity</Th><Th right>Speed</Th><Th right>Rate</Th></tr></thead>
        <tbody>
          {run.providers.flatMap((provider) => provider.fleet.map((vehicle, index) => (
            <tr key={`${provider.id}-${vehicle.vehicleType}`}>
              {index === 0 && <><Td className="font-medium" >{provider.name}<div className="font-mono text-[11.5px] text-muted">{provider.id}</div></Td><Td>{provider.base.city}</Td><Td><TrustBadge decision={orgTrust[provider.organizationId]?.decision} score={orgTrust[provider.organizationId]?.score} /></Td></>}
              {index > 0 && <><Td /><Td /><Td /></>}
              <Td>{vehicle.vehicleType.replace(/_/g, " ")}{vehicle.floodCapable && <Badge tone="info">flood-capable</Badge>}</Td>
              <Td right>{vehicle.available} / {vehicle.count}</Td>
              <Td right>{num(vehicle.capacityKg)} kg</Td>
              <Td right>{vehicle.avgSpeedKmh} km/h</Td>
              <Td right>{inr(vehicle.ratePerKm)}/km</Td>
            </tr>
          )))}
        </tbody>
      </Table>
      {run.floodZones.length > 0 && (
        <ul className="grid gap-1 text-[12.5px] text-ink-2">
          {run.floodZones.map((zone) => <li key={zone.id}><Badge tone={zone.effect === "boats_only" ? "critical" : "warn"}>{zone.effect === "boats_only" ? "Boats only" : "Delays"}</Badge> <strong>{zone.name}</strong> ({zone.radiusKm} km radius). {zone.note}</li>)}
        </ul>
      )}
    </div>
  );
}

// ---- risks ----------------------------------------------------------------------

export function RisksView({ incidentId }: { incidentId: string }) {
  const run = useRunOf(incidentId);
  if (!run || (!run.risks.length && !run.scenarios.length)) return <Empty title="No risks identified yet">Risks are derived from the offers, the plan and the transport plan as each becomes available.</Empty>;
  const tone = { critical: "critical", high: "warn", medium: "neutral", low: "ok" } as const;
  return (
    <div className="grid gap-4">
      <ul className="grid gap-2">
        {run.risks.map((risk) => (
          <li key={risk.id} className="rounded-lg border border-line bg-surface p-3">
            <div className="flex flex-wrap items-center gap-2"><Badge tone={tone[risk.severity]}><span className="capitalize">{risk.severity}</span></Badge><Badge tone="neutral">{risk.category}</Badge><span className="text-[13.5px] font-semibold">{risk.title}</span></div>
            <p className="mt-1 text-[12.5px] text-ink-2">{risk.detail}</p>
            <p className="mt-1 text-[12.5px] text-muted"><span className="font-semibold">Recommended:</span> {risk.recommendation}</p>
          </li>
        ))}
      </ul>
      {run.scenarios.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-[13.5px] font-semibold">Scenario analysis <span className="font-normal text-muted">— the allocation engine re-run with one supplier removed</span></h3>
          <Table label="What-if scenarios">
            <thead><tr><Th>Scenario</Th><Th right>Shortage covered</Th><Th right>Change</Th><Th right>Cost change</Th><Th right>Unfulfilled units</Th><Th>Verdict</Th></tr></thead>
            <tbody>
              {run.scenarios.map((scenario) => (
                <tr key={scenario.id}>
                  <Td><span className="font-medium">{scenario.title}</span><div className="text-[11.5px] text-muted">{scenario.description}</div></Td>
                  <Td right>{scenario.fulfilmentPct}%</Td>
                  <Td right>{scenario.fulfilmentDeltaPct > 0 ? "+" : ""}{scenario.fulfilmentDeltaPct} pts</Td>
                  <Td right>{scenario.costDelta >= 0 ? "+" : "−"}{inr(Math.abs(scenario.costDelta))}</Td>
                  <Td right>{num(scenario.unfulfilledUnits)}</Td>
                  <Td><Badge tone={scenario.verdict === "absorbed" ? "ok" : scenario.verdict === "degraded" ? "warn" : "critical"}>{scenario.verdict}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ---- approval, execution and tracking -------------------------------------------------

function WriteCard({ title, partner, state, action, disabled, disabledReason, onClear }: { title: string; partner: string; state: WorkflowRun["reservation"]; action: () => Promise<unknown>; disabled: boolean; disabledReason: string; onClear: () => void }) {
  const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { const outcome = await action() as { ok: boolean; reason?: string }; if (!outcome.ok) useUi.getState().notify(outcome.reason || "Not completed.", "warn"); } finally { setBusy(false); } };
  const badge = { none: <Badge tone="neutral">Not started</Badge>, pending: <Badge tone="info">Waiting in {partner}'s window</Badge>, confirmed: <Badge tone="ok">Confirmed</Badge>, declined: <Badge tone="warn">Declined in {partner}'s window</Badge>, refused: <Badge tone="critical">Refused by {partner}</Badge>, unknown: <Badge tone="critical">Outcome unknown</Badge> }[state.status];
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-[14px] font-semibold">{title}</h3>{badge}</div>
      <p className="mt-1 text-[12.5px] text-muted">Written to {partner}. You confirm it in {partner}'s own window; this page only receives the receipt.</p>
      {state.status === "confirmed" && <div className="mt-2"><KeyValue items={[["Receipt", <span className="font-mono">{state.reference}</span>], ["Confirmed", time(state.at)], ...(state.total ? [["Total", inr(state.total)] as [string, React.ReactNode]] : []), ["Partner says", state.summary || "—"]]} /></div>}
      {state.error && state.status !== "confirmed" && <div className="mt-2"><Notice tone={state.status === "unknown" ? "critical" : "warn"}>{state.error}</Notice></div>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {state.status !== "confirmed" && state.status !== "unknown" && <Button variant="primary" busy={busy} disabled={disabled} onClick={run} title={disabled ? disabledReason : undefined}><ExternalLink size={14} aria-hidden />{state.status === "none" ? title : "Try again"}</Button>}
        {state.status === "unknown" && <Button onClick={onClear}>I checked {partner}: clear and allow a retry</Button>}
        {disabled && state.status !== "confirmed" && <span className="text-[12.5px] text-muted">{disabledReason}</span>}
      </div>
    </div>
  );
}

export function ExecutionView({ incidentId, showTracking = true }: { incidentId: string; showTracking?: boolean }) {
  const run = useRunOf(incidentId);
  const peers = useStore((state) => state.peers);
  const [approving, setApproving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  if (!run) return null;
  const label = (role: string) => Object.values(peers).find((peer) => peer.role === role)?.label ?? role;
  const approved = run.approval.status === "approved";
  const counts = summariseShipments(run.shipments);
  const undelivered = run.shipments.filter((item) => item.status === "delivered" && !item.deliveryReceipt).length;
  const act = async (key: string, work: () => Promise<{ ok: boolean; reason?: string; summary?: string }>) => {
    setBusy(key);
    try { const outcome = await work(); useUi.getState().notify(outcome.ok ? outcome.summary || "Done." : outcome.reason || "Not completed.", outcome.ok ? "ok" : "warn"); } finally { setBusy(null); }
  };
  const move = async (trackingCode: string, status: ShipmentStatus) => { const result = await setShipmentStatus(incidentId, trackingCode, status); if (!result.ok) useUi.getState().notify(result.reason || "Not allowed.", "warn"); };

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader
          title="Step 9 — Human approval"
          subtitle="Nothing is written to any partner site until a person approves the plan below."
          actions={run.approval.status === "approved" ? <Badge tone="ok">Approved {time(run.approval.decidedAt)}</Badge> : run.approval.status === "rejected" ? <Badge tone="critical">Rejected {time(run.approval.decidedAt)}</Badge> : <Badge tone="warn">Awaiting decision</Badge>}
        />
        {run.plan ? <PlanPreview run={run} compact /> : <Empty title="Nothing to approve yet">Run the workflow to produce an allocation plan and a transport plan.</Empty>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {run.plan && !approved && <Button variant="primary" onClick={() => setApproving(true)}>Review and approve or reject</Button>}
          {run.approval.note && <span className="text-[12.5px] text-muted">Note: {run.approval.note}</span>}
          {run.approval.digest && <span className="font-mono text-[11.5px] text-faint" title="SHA-256 of the exact plan that was reviewed. Execution re-checks it.">approved digest {run.approval.digest.slice(0, 16)}…</span>}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <WriteCard title="Reserve stock" partner={label("supplier")} state={run.reservation} action={() => reserveStock(incidentId)} disabled={!approved} disabledReason="Approve the plan first." onClear={() => clearUnknown(incidentId, "reservation")} />
        <WriteCard title="Book transport" partner={label("logistics")} state={run.booking} action={() => bookTransport(incidentId)} disabled={!approved || run.reservation.status !== "confirmed"} disabledReason={!approved ? "Approve the plan first." : "Reserve the stock first."} onClear={() => clearUnknown(incidentId, "booking")} />
      </div>

      <Card>
        <CardHeader
          icon={<Truck size={16} aria-hidden />}
          title="Step 10 — Shipment tracking"
          subtitle="Status changes follow the same transitions RouteBridge enforces. In this demonstration a person advances each shipment; no vehicle is really moving."
          actions={<>
            <Button size="sm" busy={busy === "sync"} disabled={!run.shipments.length} onClick={() => act("sync", () => syncShipments(incidentId))}><RefreshCw size={13} aria-hidden />Read statuses from {label("logistics")}</Button>
            <Button size="sm" variant="primary" busy={busy === "deliver"} disabled={!undelivered} onClick={() => act("deliver", () => recordDeliveries(incidentId))}><PackageCheck size={13} aria-hidden />Record {undelivered || ""} delivery receipt{undelivered === 1 ? "" : "s"} at {label("shelter")}</Button>
          </>}
        />
        {!showTracking ? <p className="text-[12.5px] text-muted">{run.shipments.length ? `${run.shipments.length} booked shipment(s): see the shipment control table above.` : `Shipments appear once the booking is confirmed in ${label("logistics")}'s window.`}</p> : run.shipments.length ? (
          <>
            <div className="mb-3 flex flex-wrap gap-2 text-[12.5px]">
              {(["planned", "dispatched", "in_transit", "delayed", "delivered", "cancelled", "failed"] as ShipmentStatus[]).map((status) => <Badge key={status} tone={status === "delivered" ? "ok" : status === "delayed" || status === "failed" ? "critical" : counts[status] ? "info" : "neutral"}>{STATUS_LABEL[status]}: {counts[status]}</Badge>)}
            </div>
            <Table label="Booked shipments">
              <thead><tr><Th>Tracking</Th><Th>Route</Th><Th>Provider</Th><Th>Status</Th><Th>Last update</Th><Th>Update status</Th></tr></thead>
              <tbody>
                {run.shipments.map((item) => (
                  <tr key={item.trackingCode}>
                    <Td className="font-mono text-[12px]">{item.trackingCode}</Td>
                    <Td>{item.supplierName} → {item.shelterName}<div className="text-[11.5px] text-muted">{num(item.weightKg)} kg</div></Td>
                    <Td>{item.providerName}<div className="text-[11.5px] text-muted">{item.vehicles} × {item.vehicleType?.replace(/_/g, " ")}</div></Td>
                    <Td><Badge tone={item.status === "delivered" ? "ok" : item.status === "delayed" || item.status === "failed" || item.status === "cancelled" ? "critical" : "info"}>{STATUS_LABEL[item.status]}</Badge>{item.deliveryReceipt && <div className="mt-1 font-mono text-[11.5px] text-ok">receipt {item.deliveryReceipt}</div>}</Td>
                    <Td className="text-[12.5px] text-muted">{time(item.history[item.history.length - 1]?.at)}<div>{item.history[item.history.length - 1]?.by}</div></Td>
                    <Td><div className="flex flex-wrap gap-1">{nextStatuses(item.status).map((status) => <Button key={status} size="sm" variant={status === "failed" || status === "cancelled" ? "ghost" : "secondary"} onClick={() => move(item.trackingCode, status)}>{STATUS_LABEL[status]}</Button>)}{!nextStatuses(item.status).length && <span className="text-[12px] text-muted">Final</span>}</div></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        ) : <Empty title="No shipments booked yet">Shipments appear here with their tracking codes once the booking is confirmed in {label("logistics")}'s window.</Empty>}
        {run.plan && run.plan.unfulfilled.length > 0 && <div className="mt-3"><Notice tone="warn" title="Unfulfilled requests">{run.plan.unfulfilled.map((line) => `${line.shelterName}: ${num(line.quantity)} ${RESOURCES[line.resource].label.toLowerCase()}`).join("; ")}</Notice></div>}
      </Card>
      {approving && <ApprovalDialog incidentId={incidentId} onClose={() => setApproving(false)} />}
    </div>
  );
}
