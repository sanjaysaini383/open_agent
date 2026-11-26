// Analytics. Every chart is computed from the store at render time. A chart with no data
// behind it shows an empty state, never a placeholder series.
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardHeader, Empty, PageHeader, SimBadge, Stat } from "@/components/ui";
import { overallFulfilmentPct } from "@/domain/allocation";
import { logisticsTotals } from "@/domain/logistics";
import { totalSaving } from "@/domain/negotiation";
import { inr, num, RESOURCE_IDS, RESOURCES } from "@/domain/resources";
import { STATUS_LABEL } from "@/domain/shipments";
import type { ShipmentStatus } from "@/domain/types";
import { STEPS } from "@/state/seed";
import { useActiveIncident, useStore } from "@/state/store";

const NAVY = "#1b4079";
const GREEN = "#15803d";
const ORANGE = "#c2410c";
const RED = "#b42318";
const SLATE = "#94a3b8";

function Chart({ title, subtitle, empty, children, height = 260 }: { title: string; subtitle: string; empty: boolean; children: React.ReactElement; height?: number }) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      {empty ? <Empty title="No data yet">This chart fills in as the workflow produces the numbers behind it.</Empty> : <div style={{ height }}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>}
    </Card>
  );
}

const axis = { fontSize: 12, fill: "#5b6b85" };
const short = (text: string, max = 16) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function AnalyticsPage() {
  const incident = useActiveIncident();
  const run = useStore((state) => (incident ? state.runs[incident.id] : undefined));
  const peers = useStore((state) => state.peers);
  const orgTrust = useStore((state) => state.orgTrust);
  const interactions = useStore((state) => state.interactions);
  if (!incident || !run) return <><PageHeader title="Analytics" /><Empty title="No active incident">Open an incident first.</Empty></>;

  const resources = run.assessment ? RESOURCE_IDS.map((id) => ({
    name: RESOURCES[id].label,
    "In stock": run.assessment!.totals[id].inStock,
    Allocated: run.plan?.fulfilment[id].allocated ?? 0,
    Unfulfilled: Math.max(0, run.assessment!.totals[id].shortage - (run.plan?.fulfilment[id].allocated ?? 0)),
  })) : [];

  const bySupplier = (run.plan?.bySupplier ?? []).map((supplier) => ({ name: short(supplier.supplierName, 22), Cost: Math.round(supplier.cost), units: supplier.units }));

  const shelters = run.assessment ? run.assessment.shelters.map((shelter) => {
    const lines = run.assessment!.lines.filter((line) => line.shelterId === shelter.id);
    const shortage = lines.reduce((sum, line) => sum + line.shortage, 0);
    const allocated = (run.plan?.lines ?? []).filter((line) => line.shelterId === shelter.id).reduce((sum, line) => sum + line.quantity, 0);
    return { name: short(shelter.name, 20), Allocated: allocated, "Still short": Math.max(0, shortage - allocated) };
  }) : [];

  const savings = Object.values(run.negotiation.reduce<Record<string, { name: string; Saving: number }>>((map, event) => {
    if (event.outcome !== "improved") return map;
    // The latest event per offer decides, as in the plan.
    const key = event.supplierName;
    map[key] ??= { name: short(key, 22), Saving: 0 };
    return map;
  }, {}));
  const latest = new Map(run.negotiation.slice().sort((a, b) => a.round - b.round).map((event) => [event.offerId, event]));
  for (const event of latest.values()) {
    if (event.outcome !== "improved") continue;
    const row = savings.find((item) => item.name === short(event.supplierName, 22));
    if (row) row.Saving += event.saving;
  }

  const durations = STEPS.map((step) => {
    const state = run.steps[step.id];
    const seconds = state.startedAt && state.endedAt ? Math.max(0, (Date.parse(state.endedAt) - Date.parse(state.startedAt)) / 1000) : null;
    return { name: `${step.number}. ${short(step.title, 18)}`, Seconds: seconds === null ? 0 : Math.round(seconds * 10) / 10, ran: seconds !== null && step.id !== "create" && step.id !== "approval" };
  }).filter((item) => item.ran);

  const trust = [
    ...Object.values(peers).filter((peer) => peer.trust).map((peer) => peer.trust!),
    ...Object.values(orgTrust),
  ].map((item) => ({ name: short(item.name, 20), Score: item.score, decision: item.decision }));
  const trustColor = { verified: GREEN, caution: ORANGE, unverified: SLATE, blocked: RED } as const;

  const statuses = (Object.keys(STATUS_LABEL) as ShipmentStatus[]).map((status) => ({ name: STATUS_LABEL[status], Shipments: run.shipments.filter((item) => item.status === status).length }));
  const calls = Object.values(peers).map((peer) => {
    const mine = interactions.filter((item) => item.to === peer.id && item.kind !== "consent");
    return { name: peer.label, Succeeded: mine.filter((item) => item.status === "ok").length, "Failed or declined": mine.filter((item) => item.status !== "ok" && item.status !== "pending").length };
  });
  const transport = logisticsTotals(run.shipmentPlans);

  return (
    <>
      <PageHeader title="Analytics" subtitle={<span className="flex flex-wrap items-center gap-2">Figures for <strong>{incident.name}</strong>, computed from the current state of this dashboard. <SimBadge /></span>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Shortage covered" value={run.plan ? `${overallFulfilmentPct(run.plan)}%` : "—"} tone={run.plan && overallFulfilmentPct(run.plan) >= 100 ? "ok" : "neutral"} />
        <Stat label="Supplies cost" value={run.plan ? inr(run.plan.totalCost) : "—"} hint={run.plan ? `of ${inr(run.plan.budget)}` : undefined} />
        <Stat label="Transport cost" value={run.shipmentPlans.length ? inr(transport.cost) : "—"} hint={run.shipmentPlans.length ? `${num(transport.weightKg)} kg` : undefined} />
        <Stat label="Negotiated saving" value={run.negotiation.length ? inr(totalSaving(run.negotiation)) : "—"} tone="ok" />
        <Stat label="Cross-origin calls" value={interactions.filter((item) => item.kind !== "consent").length} hint={`${interactions.filter((item) => item.status === "ok").length} succeeded`} tone="info" />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Chart title="Requirement coverage by resource" subtitle="Units in shelter stock, allocated by the plan, and still unfulfilled." empty={!resources.length}>
          <BarChart data={resources} margin={{ left: 0, right: 8 }}><CartesianGrid strokeDasharray="3 3" stroke="#e5e9f0" /><XAxis dataKey="name" tick={axis} /><YAxis tick={axis} /><Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} /><Bar dataKey="In stock" stackId="a" fill={SLATE} /><Bar dataKey="Allocated" stackId="a" fill={GREEN} /><Bar dataKey="Unfulfilled" stackId="a" fill={RED} /></BarChart>
        </Chart>
        <Chart title="Plan cost by supplier" subtitle="What the allocation plan would spend with each supplier (INR)." empty={!bySupplier.length}>
          <BarChart data={bySupplier} layout="vertical" margin={{ left: 40, right: 16 }}><CartesianGrid strokeDasharray="3 3" stroke="#e5e9f0" /><XAxis type="number" tick={axis} /><YAxis type="category" dataKey="name" tick={axis} width={140} /><Tooltip formatter={(value: number) => inr(value)} /><Bar dataKey="Cost" fill={NAVY} /></BarChart>
        </Chart>
        <Chart title="Distribution across shelters" subtitle="Units allocated to each shelter against what it is still short." empty={!shelters.length}>
          <BarChart data={shelters} margin={{ left: 0, right: 8 }}><CartesianGrid strokeDasharray="3 3" stroke="#e5e9f0" /><XAxis dataKey="name" tick={{ ...axis, fontSize: 11 }} interval={0} /><YAxis tick={axis} /><Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} /><Bar dataKey="Allocated" stackId="a" fill={GREEN} /><Bar dataKey="Still short" stackId="a" fill={ORANGE} /></BarChart>
        </Chart>
        <Chart title="Negotiated savings by supplier" subtitle="Saving against list price from the latest quote for each offer (INR)." empty={!savings.some((item) => item.Saving > 0)}>
          <BarChart data={savings} layout="vertical" margin={{ left: 40, right: 16 }}><CartesianGrid strokeDasharray="3 3" stroke="#e5e9f0" /><XAxis type="number" tick={axis} /><YAxis type="category" dataKey="name" tick={axis} width={140} /><Tooltip formatter={(value: number) => inr(value)} /><Bar dataKey="Saving" fill={GREEN} /></BarChart>
        </Chart>
        <Chart title="Trust scores" subtitle="Evidence score per partner network and organisation, coloured by decision." empty={!trust.length}>
          <BarChart data={trust} layout="vertical" margin={{ left: 40, right: 16 }}><CartesianGrid strokeDasharray="3 3" stroke="#e5e9f0" /><XAxis type="number" domain={[0, 100]} tick={axis} /><YAxis type="category" dataKey="name" tick={{ ...axis, fontSize: 11 }} width={140} /><Tooltip /><Bar dataKey="Score">{trust.map((item, index) => <Cell key={index} fill={trustColor[item.decision]} />)}</Bar></BarChart>
        </Chart>
        <Chart title="Response performance" subtitle="Wall-clock seconds each automated step took, including time spent waiting for your consent." empty={!durations.length}>
          <BarChart data={durations} layout="vertical" margin={{ left: 40, right: 16 }}><CartesianGrid strokeDasharray="3 3" stroke="#e5e9f0" /><XAxis type="number" tick={axis} unit=" s" /><YAxis type="category" dataKey="name" tick={{ ...axis, fontSize: 11 }} width={150} /><Tooltip /><Bar dataKey="Seconds" fill={NAVY} /></BarChart>
        </Chart>
        <Chart title="Shipments by status" subtitle="Booked shipments in each state." empty={!run.shipments.length}>
          <BarChart data={statuses} margin={{ left: 0, right: 8 }}><CartesianGrid strokeDasharray="3 3" stroke="#e5e9f0" /><XAxis dataKey="name" tick={{ ...axis, fontSize: 11 }} interval={0} /><YAxis tick={axis} allowDecimals={false} /><Tooltip /><Bar dataKey="Shipments" fill={NAVY} /></BarChart>
        </Chart>
        <Chart title="Cross-origin calls by partner" subtitle="Requests this site sent to each independent partner site." empty={!calls.some((item) => item.Succeeded + item["Failed or declined"] > 0)}>
          <BarChart data={calls} margin={{ left: 0, right: 8 }}><CartesianGrid strokeDasharray="3 3" stroke="#e5e9f0" /><XAxis dataKey="name" tick={{ ...axis, fontSize: 11 }} interval={0} /><YAxis tick={axis} allowDecimals={false} /><Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} /><Bar dataKey="Succeeded" stackId="a" fill={GREEN} /><Bar dataKey="Failed or declined" stackId="a" fill={RED} /></BarChart>
        </Chart>
      </div>
    </>
  );
}
