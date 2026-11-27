// Analytics and impact. Every figure and chart is computed from the store at render time.
// A chart with no data behind it shows an empty state, never a placeholder series. The
// time filter narrows the event-based figures (requests, agent runs) to a window.
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardHeader, Empty, PageHeader, Segmented, SimBadge, Stat, Table, Td, Th } from "@/components/ui";
import { overallFulfilmentPct } from "@/domain/allocation";
import { logisticsTotals } from "@/domain/logistics";
import { totalSaving } from "@/domain/negotiation";
import { inr, num, RESOURCE_IDS, RESOURCES } from "@/domain/resources";
import { STATUS_LABEL } from "@/domain/shipments";
import type { ShipmentStatus } from "@/domain/types";
import { usePalette } from "@/lib/theme";
import { STEPS } from "@/state/seed";
import { useActiveIncident, useStore } from "@/state/store";

type Window = "1h" | "24h" | "all";
const WINDOW_MS: Record<Window, number> = { "1h": 3_600_000, "24h": 86_400_000, all: Infinity };

function Chart({ title, subtitle, empty, children, height = 260 }: { title: string; subtitle: string; empty: boolean; children: React.ReactElement; height?: number }) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      {empty ? <Empty title="No data yet">This chart fills in as the workflow produces the numbers behind it.</Empty> : <div style={{ height }}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>}
    </Card>
  );
}

const short = (text: string, max = 16) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function AnalyticsPage() {
  const incident = useActiveIncident();
  const run = useStore((state) => (incident ? state.runs[incident.id] : undefined));
  const peers = useStore((state) => state.peers);
  const orgTrust = useStore((state) => state.orgTrust);
  const interactions = useStore((state) => state.interactions);
  const activity = useStore((state) => state.activity);
  const colors = usePalette();
  const [window_, setWindow] = useState<Window>("all");
  const since = Date.now() - WINDOW_MS[window_];
  const axis = { fontSize: 12, fill: colors.muted };
  const tooltip = { contentStyle: { background: colors.surface, border: `1px solid ${colors.line}`, borderRadius: 8, color: colors.ink, fontSize: 12 }, labelStyle: { color: colors.ink }, itemStyle: { color: colors.ink } };

  const windowed = useMemo(() => ({ interactions: interactions.filter((item) => Date.parse(item.at) >= since && item.kind !== "consent"), activity: activity.filter((item) => Date.parse(item.at) >= since) }), [interactions, activity, since]);

  if (!incident || !run) return <><PageHeader title="Analytics" /><Empty title="No active incident">Open an incident first.</Empty></>;

  const responseMinutes = run.steps.assess.startedAt && run.steps.logistics.endedAt ? Math.max(0, (Date.parse(run.steps.logistics.endedAt) - Date.parse(run.steps.assess.startedAt)) / 60_000) : null;
  const transport = logisticsTotals(run.shipmentPlans);
  const assigned = run.shipmentPlans.filter((item) => item.assigned && item.totalHours !== null);
  const avgDelivery = assigned.length ? Math.round((assigned.reduce((sum, item) => sum + (item.totalHours || 0), 0) / assigned.length) * 10) / 10 : null;
  const allocatedUnits = run.plan ? run.plan.lines.reduce((sum, line) => sum + line.quantity, 0) : 0;
  const okCalls = windowed.interactions.filter((item) => item.status === "ok").length;
  const settledCalls = windowed.interactions.filter((item) => item.status !== "pending").length;
  const successRate = settledCalls ? Math.round((okCalls / settledCalls) * 1000) / 10 : null;

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
    return { name: short(shelter.name, 20), Allocated: allocated, "Still short": Math.max(0, shortage - allocated), pct: shortage ? Math.round((Math.min(allocated, shortage) / shortage) * 100) : 100 };
  }) : [];
  const latest = new Map(run.negotiation.slice().sort((a, b) => a.round - b.round).map((event) => [event.offerId, event]));
  const savings = Object.values([...latest.values()].filter((event) => event.outcome === "improved").reduce<Record<string, { name: string; Saving: number }>>((map, event) => { map[event.supplierName] ??= { name: short(event.supplierName, 22), Saving: 0 }; map[event.supplierName].Saving += event.saving; return map; }, {}));
  const durations = STEPS.map((step) => {
    const state = run.steps[step.id];
    const seconds = state.startedAt && state.endedAt ? Math.max(0, (Date.parse(state.endedAt) - Date.parse(state.startedAt)) / 1000) : null;
    return { name: `${step.number}. ${short(step.title, 18)}`, Seconds: seconds === null ? 0 : Math.round(seconds * 10) / 10, ran: seconds !== null && step.id !== "create" && step.id !== "approval" };
  }).filter((item) => item.ran);
  const trust = [...Object.values(peers).filter((peer) => peer.trust).map((peer) => peer.trust!), ...Object.values(orgTrust)].map((item) => ({ name: short(item.name, 20), Score: item.score, decision: item.decision }));
  const trustColor = { verified: colors.ok, caution: colors.high, unverified: colors.faint, blocked: colors.critical } as const;
  const statuses = (Object.keys(STATUS_LABEL) as ShipmentStatus[]).map((status) => ({ name: STATUS_LABEL[status], Shipments: run.shipments.filter((item) => item.status === status).length }));
  const calls = Object.values(peers).map((peer) => {
    const mine = windowed.interactions.filter((item) => item.to === peer.id);
    return { name: peer.label, Succeeded: mine.filter((item) => item.status === "ok").length, "Failed or declined": mine.filter((item) => item.status !== "ok" && item.status !== "pending").length };
  });
  const latency = windowed.interactions.filter((item) => item.status === "ok" && item.durationMs !== undefined).slice(-40).map((item, index) => ({ index: index + 1, ms: item.durationMs!, to: peers[item.to]?.label ?? item.to }));
  const supplierPerformance = (run.plan?.bySupplier ?? []).map((supplier) => {
    const offers = run.offers.filter((offer) => offer.supplierId === supplier.supplierId);
    const quotes = run.negotiation.filter((event) => offers.some((offer) => offer.offerId === event.offerId));
    const improved = quotes.filter((event) => event.outcome === "improved").length;
    const shipments = run.shipmentPlans.filter((item) => item.supplierId === supplier.supplierId);
    return { ...supplier, trust: orgTrust[offers[0]?.organizationId]?.decision ?? offers[0]?.trust ?? "unverified", score: orgTrust[offers[0]?.organizationId]?.score, leadTime: offers.length ? Math.min(...offers.map((offer) => offer.leadTimeHours)) : null, quotes: quotes.length, improved, onTime: shipments.filter((item) => item.assigned && item.onTime).length, shipments: shipments.filter((item) => item.assigned).length };
  });

  return (
    <>
      <PageHeader
        eyebrow="Analytics and impact"
        title="Analytics"
        subtitle={<span className="flex flex-wrap items-center gap-2">Figures for <strong>{incident.name}</strong>, computed from the current state of this dashboard. <SimBadge label="Demonstration data" /></span>}
        actions={<Segmented label="Time window for event-based figures" value={window_} onChange={setWindow} options={[{ id: "1h", label: "Last hour" }, { id: "24h", label: "Last 24 h" }, { id: "all", label: "All time" }]} />}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Response time" value={responseMinutes !== null ? `${responseMinutes < 1 ? "<1" : Math.round(responseMinutes)} min` : "—"} hint="assessment start to transport plan" tone={responseMinutes !== null ? "ok" : "neutral"} />
        <Stat label="Fulfilment" value={run.plan ? `${overallFulfilmentPct(run.plan)}%` : "—"} tone={run.plan && overallFulfilmentPct(run.plan) >= 100 ? "ok" : "neutral"} hint="of assessed shortage" />
        <Stat label="Resources allocated" number={allocatedUnits} format={num} hint={run.plan ? `${inr(run.plan.totalCost)} supplies` : "no plan yet"} />
        <Stat label="Average delivery" value={avgDelivery !== null ? `${avgDelivery} h` : "—"} hint={transport.longestHours ? `longest ${transport.longestHours} h` : undefined} />
        <Stat label="Shelter coverage" value={shelters.length ? `${Math.round(shelters.reduce((sum, item) => sum + item.pct, 0) / shelters.length)}%` : "—"} hint={shelters.length ? `${shelters.filter((item) => item.pct >= 100).length} of ${shelters.length} fully covered` : undefined} />
        <Stat label="Negotiated saving" value={run.negotiation.length ? inr(totalSaving(run.negotiation)) : "—"} tone="ok" />
        <Stat label="Agent comms success" value={successRate !== null ? `${successRate}%` : "—"} tone={successRate === null ? "neutral" : successRate >= 95 ? "ok" : "warn"} hint={`${okCalls} of ${settledCalls} requests (${window_ === "all" ? "all time" : `last ${window_}`})`} />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Chart title="Requirement coverage by resource" subtitle="Units in shelter stock, allocated by the plan, and still unfulfilled." empty={!resources.length}>
          <BarChart data={resources} margin={{ left: 0, right: 8 }}><CartesianGrid strokeDasharray="3 3" stroke={colors.grid} /><XAxis dataKey="name" tick={axis} /><YAxis tick={axis} /><Tooltip {...tooltip} /><Legend wrapperStyle={{ fontSize: 12, color: colors.muted }} /><Bar dataKey="In stock" stackId="a" fill={colors.faint} /><Bar dataKey="Allocated" stackId="a" fill={colors.ok} /><Bar dataKey="Unfulfilled" stackId="a" fill={colors.critical} /></BarChart>
        </Chart>
        <Chart title="Plan cost by supplier" subtitle="What the allocation plan would spend with each supplier (INR)." empty={!bySupplier.length}>
          <BarChart data={bySupplier} layout="vertical" margin={{ left: 40, right: 16 }}><CartesianGrid strokeDasharray="3 3" stroke={colors.grid} /><XAxis type="number" tick={axis} /><YAxis type="category" dataKey="name" tick={axis} width={140} /><Tooltip {...tooltip} formatter={(value: number) => inr(value)} /><Bar dataKey="Cost" fill={colors.accent} radius={[0, 4, 4, 0]} /></BarChart>
        </Chart>
        <Chart title="Distribution across shelters" subtitle="Units allocated to each shelter against what it is still short." empty={!shelters.length}>
          <BarChart data={shelters} margin={{ left: 0, right: 8 }}><CartesianGrid strokeDasharray="3 3" stroke={colors.grid} /><XAxis dataKey="name" tick={{ ...axis, fontSize: 11 }} interval={0} /><YAxis tick={axis} /><Tooltip {...tooltip} /><Legend wrapperStyle={{ fontSize: 12, color: colors.muted }} /><Bar dataKey="Allocated" stackId="a" fill={colors.ok} /><Bar dataKey="Still short" stackId="a" fill={colors.high} /></BarChart>
        </Chart>
        <Chart title="Negotiated savings by supplier" subtitle="Saving against list price from the latest quote for each offer (INR)." empty={!savings.some((item) => item.Saving > 0)}>
          <BarChart data={savings} layout="vertical" margin={{ left: 40, right: 16 }}><CartesianGrid strokeDasharray="3 3" stroke={colors.grid} /><XAxis type="number" tick={axis} /><YAxis type="category" dataKey="name" tick={axis} width={140} /><Tooltip {...tooltip} formatter={(value: number) => inr(value)} /><Bar dataKey="Saving" fill={colors.ok} radius={[0, 4, 4, 0]} /></BarChart>
        </Chart>
        <Chart title="Trust scores" subtitle="Evidence score per partner network and organisation, coloured by decision." empty={!trust.length}>
          <BarChart data={trust} layout="vertical" margin={{ left: 40, right: 16 }}><CartesianGrid strokeDasharray="3 3" stroke={colors.grid} /><XAxis type="number" domain={[0, 100]} tick={axis} /><YAxis type="category" dataKey="name" tick={{ ...axis, fontSize: 11 }} width={140} /><Tooltip {...tooltip} /><Bar dataKey="Score" radius={[0, 4, 4, 0]}>{trust.map((item, index) => <Cell key={index} fill={trustColor[item.decision]} />)}</Bar></BarChart>
        </Chart>
        <Chart title="Response performance" subtitle="Wall-clock seconds each automated step took, including time spent waiting for your consent." empty={!durations.length}>
          <BarChart data={durations} layout="vertical" margin={{ left: 40, right: 16 }}><CartesianGrid strokeDasharray="3 3" stroke={colors.grid} /><XAxis type="number" tick={axis} unit=" s" /><YAxis type="category" dataKey="name" tick={{ ...axis, fontSize: 11 }} width={150} /><Tooltip {...tooltip} /><Bar dataKey="Seconds" fill={colors.accent2} radius={[0, 4, 4, 0]} /></BarChart>
        </Chart>
        <Chart title="Shipments by status" subtitle="Booked shipments in each state." empty={!run.shipments.length}>
          <BarChart data={statuses} margin={{ left: 0, right: 8 }}><CartesianGrid strokeDasharray="3 3" stroke={colors.grid} /><XAxis dataKey="name" tick={{ ...axis, fontSize: 11 }} interval={0} /><YAxis tick={axis} allowDecimals={false} /><Tooltip {...tooltip} /><Bar dataKey="Shipments" fill={colors.accent} radius={[4, 4, 0, 0]} /></BarChart>
        </Chart>
        <Chart title={`Cross-origin calls by partner (${window_ === "all" ? "all time" : `last ${window_}`})`} subtitle="Requests this site sent to each independent partner site in the selected window." empty={!calls.some((item) => item.Succeeded + item["Failed or declined"] > 0)}>
          <BarChart data={calls} margin={{ left: 0, right: 8 }}><CartesianGrid strokeDasharray="3 3" stroke={colors.grid} /><XAxis dataKey="name" tick={{ ...axis, fontSize: 11 }} interval={0} /><YAxis tick={axis} allowDecimals={false} /><Tooltip {...tooltip} /><Legend wrapperStyle={{ fontSize: 12, color: colors.muted }} /><Bar dataKey="Succeeded" stackId="a" fill={colors.ok} /><Bar dataKey="Failed or declined" stackId="a" fill={colors.critical} /></BarChart>
        </Chart>
        <Chart title={`Request latency (${window_ === "all" ? "all time" : `last ${window_}`})`} subtitle="Round-trip milliseconds of the last successful cross-origin requests, in order." empty={latency.length < 2}>
          <LineChart data={latency} margin={{ left: 0, right: 8 }}><CartesianGrid strokeDasharray="3 3" stroke={colors.grid} /><XAxis dataKey="index" tick={axis} /><YAxis tick={axis} unit=" ms" /><Tooltip {...tooltip} formatter={(value: number, _name, item) => [`${value} ms`, (item.payload as { to: string }).to]} /><Line type="monotone" dataKey="ms" stroke={colors.accent} strokeWidth={2} dot={{ r: 2.5, fill: colors.accent }} isAnimationActive /></LineChart>
        </Chart>
        <Card className="xl:col-span-2">
          <CardHeader title="Supplier performance" subtitle="Per supplier in the plan: units, cost, trust, lead time, quotes improved and on-time shipments." />
          {supplierPerformance.length ? (
            <Table label="Supplier performance">
              <thead><tr><Th>Supplier</Th><Th right>Units</Th><Th right>Cost</Th><Th>Trust</Th><Th right>Lead time</Th><Th right>Quotes improved</Th><Th right>On-time shipments</Th></tr></thead>
              <tbody>{supplierPerformance.map((row) => <tr key={row.supplierId}><Td className="font-medium">{row.supplierName}<div className="font-mono text-[11.5px] text-muted">{row.supplierId}</div></Td><Td right>{num(row.units)}</Td><Td right>{inr(row.cost)}</Td><Td><span className="capitalize">{row.trust}</span>{row.score !== undefined ? ` · ${row.score}` : ""}</Td><Td right>{row.leadTime !== null ? `${row.leadTime} h` : "—"}</Td><Td right>{row.improved} / {row.quotes}</Td><Td right>{row.shipments ? `${row.onTime} / ${row.shipments}` : "—"}</Td></tr>)}</tbody>
            </Table>
          ) : <Empty title="No plan yet">Supplier performance is computed from the allocation plan, the negotiation and the transport plan.</Empty>}
        </Card>
      </div>
    </>
  );
}
