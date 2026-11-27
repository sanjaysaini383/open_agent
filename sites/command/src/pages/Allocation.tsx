// Resource allocation: demand, inventory, supply, shortages, the engine's plan, and an
// editor where a person changes quantities and sees cost, coverage, inventory and
// unfulfilled demand update at once. Every edited plan goes through the engine's own
// validator before it can be stored.
import { useEffect, useMemo, useState } from "react";
import { Download, Pencil, RefreshCw, RotateCcw, SlidersHorizontal, Trash2 } from "lucide-react";
import { AllocationView } from "@/components/views";
import { Badge, Button, Card, CardHeader, Empty, Field, Meter, Notice, PageHeader, SimBadge, Stat, Table, Td, Th, inputClass } from "@/components/ui";
import { DEFAULT_WEIGHTS, overallFulfilmentPct } from "@/domain/allocation";
import { inr, num, price, RESOURCE_IDS, RESOURCES } from "@/domain/resources";
import type { AllocationPlan, ResourceId } from "@/domain/types";
import { exportPlanCsv } from "@/lib/export";
import { useActiveIncident, useStore } from "@/state/store";
import { useUi } from "@/state/ui";
import { applyPlan, buildEditedPlan, canEditPlan, inputFromRun, linesFromPlan, optimise, summarise, validate, type EditLine } from "@/workflow/editing";
import { runStep } from "@/workflow/steps";

const key = (line: EditLine) => `${line.shelterId}:${line.resource}:${line.offerId}`;

function Editor({ incidentId }: { incidentId: string }) {
  const incident = useStore((state) => state.incidents.find((item) => item.id === incidentId))!;
  const run = useStore((state) => state.runs[incidentId]);
  const input = useMemo(() => inputFromRun(incident, run), [incident, run]);
  const [edits, setEdits] = useState<EditLine[]>(() => linesFromPlan(run.plan));
  const [weights, setWeights] = useState(run.plan?.weights ?? { ...DEFAULT_WEIGHTS });
  const [adding, setAdding] = useState<{ need: string; offerId: string; quantity: string }>({ need: "", offerId: "", quantity: "" });
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { setEdits(linesFromPlan(run.plan)); }, [run.plan]);
  const editable = canEditPlan(run);

  const edited = useMemo(() => (input ? buildEditedPlan(input, edits, run.plan) : null), [input, edits, run.plan]);
  const problems = useMemo(() => (input && edited ? validate(input, edited) : []), [input, edited]);
  const summary = useMemo(() => (input && edited ? summarise(input, edited) : null), [input, edited]);
  const changed = useMemo(() => JSON.stringify(linesFromPlan(run.plan).sort((a, b) => key(a).localeCompare(key(b)))) !== JSON.stringify([...edits].filter((line) => line.quantity > 0).sort((a, b) => key(a).localeCompare(key(b)))), [run.plan, edits]);
  const reweighted = useMemo<AllocationPlan | null>(() => {
    if (!input) return null;
    const sum = weights.cost + weights.time + weights.trust;
    return sum > 0 ? optimise({ ...input, version: (run.plan?.version || 0) + 1 }, { cost: weights.cost / sum, time: weights.time / sum, trust: weights.trust / sum }) : null;
  }, [input, weights, run.plan]);

  if (!input || !summary || !edited) return <Empty title="Nothing to edit yet">{editable.reason || "Run the assessment and collect offers first."}</Empty>;

  const needs = input.needs.filter((need) => need.shortage > 0);
  const offersFor = (resource: ResourceId) => input.offers.filter((offer) => offer.resource === resource && offer.eligible);
  const setQuantity = (line: EditLine, quantity: number) => setEdits(edits.map((item) => (key(item) === key(line) ? { ...item, quantity } : item)));
  const remove = (line: EditLine) => setEdits(edits.filter((item) => key(item) !== key(line)));
  const add = () => {
    const [shelterId, resource] = adding.need.split(":");
    const quantity = Number(adding.quantity);
    if (!shelterId || !resource || !adding.offerId || !Number.isFinite(quantity) || quantity <= 0) return;
    const line = { shelterId, resource: resource as ResourceId, offerId: adding.offerId, quantity: Math.floor(quantity) };
    setEdits(edits.some((item) => key(item) === key(line)) ? edits.map((item) => (key(item) === key(line) ? { ...item, quantity: item.quantity + line.quantity } : item)) : [...edits, line]);
    setAdding({ need: "", offerId: "", quantity: "" });
  };
  const apply = async (plan: AllocationPlan, how: "edited" | "reweighted") => {
    setBusy(how);
    const result = await applyPlan(incidentId, input, plan, how);
    setBusy(null);
    if (!result.ok) useUi.getState().notify(result.reason || "Not stored.", "warn");
  };
  const coverageTone = summary.coveragePct >= 100 ? "ok" : summary.coveragePct >= 70 ? "warn" : "critical";
  const budgetPct = input.budget > 0 ? (summary.cost / input.budget) * 100 : 0;

  return (
    <div className="grid gap-5">
      {!editable.ok && <Notice tone="warn">{editable.reason}</Notice>}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-3">
          <Table label="Allocation lines being edited">
            <thead><tr><Th>Shelter</Th><Th>Resource</Th><Th>Supplier · offer</Th><Th right>Unit price</Th><Th right>Quantity</Th><Th right>Line cost</Th><Th right>Hours</Th><Th /></tr></thead>
            <tbody>
              {edits.length ? edits.map((line) => {
                const offer = input.offers.find((item) => item.offerId === line.offerId);
                const planned = edited.lines.find((item) => item.id === key(line));
                const need = input.needs.find((item) => item.shelterId === line.shelterId && item.resource === line.resource);
                return (
                  <tr key={key(line)}>
                    <Td><span className="font-medium">{need?.shelterName ?? line.shelterId}</span><div className="text-[11.5px] text-muted">short {num(need?.shortage ?? 0)}</div></Td>
                    <Td>{RESOURCES[line.resource].label}</Td>
                    <Td>{offer?.supplierName ?? "—"}<div className="font-mono text-[11.5px] text-muted">{line.offerId}</div></Td>
                    <Td right>{offer ? price(offer.unitPrice) : "—"}</Td>
                    <Td right>
                      <input type="number" min={0} max={offer?.quantityAvailable} step={1} aria-label={`Quantity of ${RESOURCES[line.resource].label} from ${offer?.supplierName} for ${need?.shelterName}`} className={`${inputClass} w-24 text-right`} value={line.quantity} disabled={!editable.ok} onChange={(event) => setQuantity(line, Number(event.target.value))} />
                    </Td>
                    <Td right>{planned ? inr(planned.lineCost) : "—"}</Td>
                    <Td right>{planned ? <>{planned.deliveryHours} h {!planned.onTime && <Badge tone="warn">late</Badge>}</> : "—"}</Td>
                    <Td><Button size="xs" variant="ghost" disabled={!editable.ok} onClick={() => remove(line)} aria-label={`Remove ${line.offerId} for ${need?.shelterName}`}><Trash2 size={12} aria-hidden /></Button></Td>
                  </tr>
                );
              }) : <tr><Td colSpan={8} className="text-center text-muted">No lines. Add one below, or re-run the engine.</Td></tr>}
            </tbody>
          </Table>
          <div className="grid gap-2 rounded-lg border border-line bg-surface-2 p-3 md:grid-cols-[1fr_1fr_120px_auto] md:items-end">
            <Field label="Need"><select className={inputClass} value={adding.need} disabled={!editable.ok} onChange={(event) => setAdding({ ...adding, need: event.target.value, offerId: "" })}><option value="">Choose a shelter and resource</option>{needs.map((need) => <option key={`${need.shelterId}:${need.resource}`} value={`${need.shelterId}:${need.resource}`}>{need.shelterName} · {RESOURCES[need.resource].label} ({num(need.shortage)} short)</option>)}</select></Field>
            <Field label="Offer"><select className={inputClass} value={adding.offerId} disabled={!adding.need} onChange={(event) => setAdding({ ...adding, offerId: event.target.value })}><option value="">Choose an eligible offer</option>{adding.need && offersFor(adding.need.split(":")[1] as ResourceId).map((offer) => <option key={offer.offerId} value={offer.offerId}>{offer.supplierName} · {price(offer.unitPrice)} · {num(offer.quantityAvailable)} available</option>)}</select></Field>
            <Field label="Quantity"><input className={inputClass} inputMode="numeric" value={adding.quantity} disabled={!adding.offerId} onChange={(event) => setAdding({ ...adding, quantity: event.target.value })} /></Field>
            <Button onClick={add} disabled={!adding.offerId || !adding.quantity}>Add line</Button>
          </div>
          {problems.length > 0 && <Notice tone="critical" title="This edit breaks an invariant and cannot be stored"><ul className="list-disc pl-4">{problems.map((problem, index) => <li key={index}>{problem}</li>)}</ul></Notice>}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" busy={busy === "edited"} disabled={!editable.ok || !changed || problems.length > 0} onClick={() => apply(edited, "edited")}><Pencil size={13} aria-hidden />Apply edited plan</Button>
            <Button variant="ghost" disabled={!changed} onClick={() => setEdits(linesFromPlan(run.plan))}><RotateCcw size={13} aria-hidden />Reset to the engine's plan</Button>
            <span className="text-[12.5px] text-muted">Applying stores plan v{input.version}, resets logistics and approval, and is recorded in the audit trail.</span>
          </div>
        </div>

        <div className="grid content-start gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Total cost" value={inr(summary.cost)} tone={summary.cost > summary.budget ? "critical" : "neutral"} hint={`${inr(summary.budgetRemaining)} of ${inr(summary.budget)} left`} />
            <Stat label="Shortage covered" value={`${summary.coveragePct}%`} tone={coverageTone} hint={`${num(summary.allocatedUnits)} units allocated`} />
            <Stat label="Unfulfilled demand" value={num(summary.unfulfilledUnits)} tone={summary.unfulfilledUnits ? "warn" : "ok"} hint="units" />
            <Stat label="Late lines" value={summary.late} tone={summary.late ? "warn" : "ok"} hint="after the deadline" />
          </div>
          <div>
            <div className="mb-1 flex justify-between text-[12.5px]"><span className="font-semibold">Budget used</span><span className="tabular text-muted">{Math.round(budgetPct)}%</span></div>
            <Meter value={budgetPct} tone={budgetPct > 100 ? "critical" : budgetPct > 90 ? "warn" : "accent"} />
          </div>
          <div>
            <h3 className="mb-1.5 text-[12.5px] font-semibold">Shelter coverage</h3>
            <ul className="grid gap-1.5">{summary.shelters.map((shelter) => <li key={shelter.shelterId} className="text-[12.5px]"><div className="mb-0.5 flex justify-between"><span>{shelter.shelterName}</span><span className="tabular text-muted">{num(shelter.allocated)} / {num(shelter.shortage)} · {shelter.pct}%</span></div><Meter value={shelter.pct} tone={shelter.pct >= 100 ? "ok" : shelter.pct >= 70 ? "warn" : "critical"} height={4} /></li>)}</ul>
          </div>
          <div>
            <h3 className="mb-1.5 text-[12.5px] font-semibold">Remaining supplier inventory</h3>
            <Table label="Remaining inventory per offer">
              <thead><tr><Th>Offer</Th><Th>Resource</Th><Th right>Used</Th><Th right>Remaining</Th></tr></thead>
              <tbody>{summary.remainingByOffer.filter((offer) => offer.eligible).map((offer) => (
                <tr key={offer.offerId}><Td><span className="font-medium">{offer.supplierName}</span><div className="font-mono text-[11px] text-muted">{offer.offerId} · min {offer.minOrder}</div></Td><Td>{RESOURCES[offer.resource].label}</Td><Td right>{num(offer.used)}</Td><Td right className={offer.remaining < 0 ? "font-semibold text-critical-text" : offer.remaining === 0 ? "text-muted" : ""}>{num(offer.remaining)}</Td></tr>
              ))}</tbody>
            </Table>
          </div>
        </div>
      </div>

      <Card className="bg-surface-2">
        <CardHeader icon={<SlidersHorizontal size={16} aria-hidden />} title="What-if: re-optimise with different weights" subtitle="The engine is run again with your weighting of cost, delivery time and trust. The preview below is its plan, not an edit." />
        <div className="grid gap-4 md:grid-cols-[320px_1fr]">
          <div className="grid gap-2">
            {(["cost", "time", "trust"] as const).map((name) => (
              <label key={name} className="grid gap-1 text-[12.5px] font-semibold text-ink-2">
                <span className="flex justify-between"><span className="capitalize">{name}</span><span className="tabular text-muted">{weights[name].toFixed(2)}</span></span>
                <input type="range" min={0} max={1} step={0.05} value={weights[name]} onChange={(event) => setWeights({ ...weights, [name]: Number(event.target.value) })} className="accent-[var(--accent)]" />
              </label>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setWeights({ ...DEFAULT_WEIGHTS })}>Balanced default</Button>
          </div>
          {reweighted ? (
            <div className="grid gap-2">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Cost" value={inr(reweighted.totalCost)} hint={`${run.plan ? (reweighted.totalCost - run.plan.totalCost >= 0 ? "+" : "−") + inr(Math.abs(reweighted.totalCost - run.plan.totalCost)) : ""} vs stored`} />
                <Stat label="Covered" value={`${overallFulfilmentPct(reweighted)}%`} hint={run.plan ? `stored ${overallFulfilmentPct(run.plan)}%` : undefined} />
                <Stat label="Completion" value={`${reweighted.estimatedCompletionHours} h`} hint={run.plan ? `stored ${run.plan.estimatedCompletionHours} h` : undefined} />
                <Stat label="Late lines" value={reweighted.lines.filter((line) => !line.onTime).length} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="primary" busy={busy === "reweighted"} disabled={!editable.ok} onClick={() => apply(reweighted, "reweighted")}>Use this plan</Button>
                <Button size="sm" variant="ghost" onClick={() => setEdits(linesFromPlan(reweighted))}>Load it into the editor</Button>
                <span className="text-[12px] text-muted">{reweighted.lines.length} lines across {reweighted.bySupplier.length} suppliers. {reweighted.notes[0] ?? ""}</span>
              </div>
            </div>
          ) : <Empty title="Set at least one weight above zero" />}
        </div>
      </Card>
    </div>
  );
}

export function AllocationPage() {
  const incident = useActiveIncident();
  const run = useStore((state) => (incident ? state.runs[incident.id] : undefined));
  const busy = useUi((state) => state.busyIncident);
  const [editing, setEditing] = useState(false);
  const rerun = async () => {
    if (!incident || useUi.getState().busyIncident) return;
    useUi.getState().setBusy(incident.id);
    try { const outcome = await runStep(incident.id, "allocate"); useUi.getState().notify(outcome.ok ? outcome.summary : outcome.reason || "The step did not complete.", outcome.ok ? "ok" : "warn"); } finally { useUi.getState().setBusy(null); }
  };
  if (!incident || !run) return <><PageHeader title="Allocation" /><Empty title="No active incident">Open an incident first.</Empty></>;

  const assessment = run.assessment;
  const eligibleSupply = (resource: ResourceId) => run.offers.filter((offer) => offer.eligible && offer.resource === resource).reduce((sum, offer) => sum + offer.quantityAvailable, 0);
  const demand = assessment ? RESOURCE_IDS.reduce((sum, id) => sum + assessment.totals[id].required, 0) : 0;
  const stock = assessment ? RESOURCE_IDS.reduce((sum, id) => sum + assessment.totals[id].inStock, 0) : 0;
  const shortage = assessment ? RESOURCE_IDS.reduce((sum, id) => sum + assessment.totals[id].shortage, 0) : 0;
  const supply = RESOURCE_IDS.reduce((sum, id) => sum + eligibleSupply(id), 0);
  const allocated = run.plan ? run.plan.lines.reduce((sum, line) => sum + line.quantity, 0) : 0;
  const unfulfilled = run.plan ? run.plan.unfulfilled.reduce((sum, line) => sum + line.quantity, 0) : Math.max(0, shortage);

  return (
    <>
      <PageHeader
        eyebrow="Intelligent resource allocation"
        title="Allocation"
        subtitle={<span className="flex flex-wrap items-center gap-2">Shelter demand against supplier inventory for <strong>{incident.name}</strong>, the engine's recommended allocation, and an editor that re-checks every invariant. <SimBadge /></span>}
        actions={<>
          <Button disabled={!run.plan} onClick={() => exportPlanCsv(incident, run)}><Download size={13} aria-hidden />Export CSV</Button>
          <Button variant={editing ? "secondary" : "outline"} onClick={() => setEditing(!editing)} disabled={!run.assessment || !run.offers.length}><Pencil size={13} aria-hidden />{editing ? "Close the editor" : "Edit allocation"}</Button>
          <Button variant="primary" busy={busy === incident.id} disabled={!!busy || !run.offers.length || incident.status === "closed"} onClick={rerun} title={!run.offers.length ? "Collect offers first" : undefined}><RefreshCw size={13} aria-hidden />{run.plan ? "Re-run the engine" : "Run the allocation engine"}</Button>
        </>}
      />
      <div className="grid gap-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Shelter demand" number={demand} format={num} hint="units required" />
          <Stat label="Shelter stock" number={stock} format={num} hint="units in stock" />
          <Stat label="Shortage" number={shortage} format={num} tone={shortage ? "warn" : "ok"} hint="units to supply" />
          <Stat label="Eligible supply" number={supply} format={num} tone={supply >= shortage && shortage ? "ok" : supply ? "info" : "neutral"} hint="units from verified offers" />
          <Stat label="Allocated" number={allocated} format={num} tone={run.plan ? (overallFulfilmentPct(run.plan) >= 100 ? "ok" : "warn") : "neutral"} hint={run.plan ? `${inr(run.plan.totalCost)} of ${inr(run.plan.budget)}` : "no plan yet"} />
          <Stat label="Unfulfilled" number={unfulfilled} format={num} tone={unfulfilled ? "critical" : "ok"} hint="units" />
        </div>

        <Card>
          <CardHeader title="Demand, stock and supply by resource" subtitle="Required and in stock from ShelterConnect; eligible supply from AidSupply after trust and safety checks; allocated and unfulfilled from the plan." />
          {assessment ? (
            <Table label="Demand and supply by resource">
              <thead><tr><Th>Resource</Th><Th right>Required</Th><Th right>In stock</Th><Th right>Shortage</Th><Th right>Eligible supply</Th><Th right>Allocated</Th><Th right>Unfulfilled</Th><Th right>Plan cost</Th><Th>Coverage</Th></tr></thead>
              <tbody>
                {RESOURCE_IDS.map((id) => {
                  const total = assessment.totals[id];
                  const got = run.plan?.fulfilment[id].allocated ?? 0;
                  const cost = (run.plan?.lines ?? []).filter((line) => line.resource === id).reduce((sum, line) => sum + line.lineCost, 0);
                  const pct = total.shortage ? Math.min(100, Math.round((got / total.shortage) * 100)) : 100;
                  const supplyFor = eligibleSupply(id);
                  return (
                    <tr key={id}>
                      <Td className="font-medium">{RESOURCES[id].label}</Td>
                      <Td right>{num(total.required)}</Td>
                      <Td right>{num(total.inStock)}</Td>
                      <Td right className={total.shortage ? "font-semibold text-critical-text" : "text-ok-text"}>{num(total.shortage)}</Td>
                      <Td right className={supplyFor < total.shortage ? "text-high-text" : ""}>{num(supplyFor)}</Td>
                      <Td right>{run.plan ? num(got) : "—"}</Td>
                      <Td right>{run.plan ? num(Math.max(0, total.shortage - got)) : "—"}</Td>
                      <Td right>{run.plan ? inr(cost) : "—"}</Td>
                      <Td><div className="w-28"><Meter value={run.plan ? pct : 0} tone={pct >= 100 ? "ok" : pct >= 70 ? "warn" : "critical"} /><div className="mt-0.5 text-[11px] text-muted">{run.plan ? `${pct}%` : "no plan"}</div></div></Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          ) : <Empty title="No assessment yet">Step 2 reads shelter requirements and stock from ShelterConnect.</Empty>}
        </Card>

        {editing && (
          <Card tone="accent">
            <CardHeader icon={<Pencil size={16} aria-hidden />} title="Allocation editor" subtitle="Change quantities, add or remove lines, and watch remaining inventory, total cost, shelter coverage and unfulfilled demand update. The engine's validator refuses an unsound plan." />
            <Editor incidentId={incident.id} />
          </Card>
        )}

        <Card>
          <CardHeader title="Recommended allocation" subtitle="The stored plan, with the reason behind every line." />
          <AllocationView incidentId={incident.id} />
        </Card>
      </div>
    </>
  );
}
