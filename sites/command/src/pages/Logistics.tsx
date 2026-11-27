// The logistics control center: shipments with vehicle, cargo, origin, destination,
// estimated delivery and status; the status transitions RouteBridge enforces; the map
// with routes; the transport plan and the fleet.
import { useMemo, useState } from "react";
import { Download, ExternalLink, Map as MapIcon, Truck } from "lucide-react";
import { IncidentMap } from "@/components/IncidentMap";
import { ExecutionView, FleetView, LogisticsView } from "@/components/views";
import { Badge, Button, Card, CardHeader, Empty, PageHeader, SearchInput, Segmented, SimBadge, Stat, Table, Td, Th, time } from "@/components/ui";
import { logisticsTotals } from "@/domain/logistics";
import { inr, num, RESOURCES } from "@/domain/resources";
import { nextStatuses, OPEN_STATUSES, STATUS_LABEL } from "@/domain/shipments";
import type { ShipmentStatus } from "@/domain/types";
import { exportShipmentsCsv } from "@/lib/export";
import { useActiveIncident, useStore } from "@/state/store";
import { useUi } from "@/state/ui";
import { setShipmentStatus } from "@/workflow/execution";
import { runStep } from "@/workflow/steps";

type Filter = "all" | "open" | "delivered" | "attention";

function eta(bookedAt: string | undefined, totalHours: number | null): string {
  if (!bookedAt || totalHours === null) return "—";
  return time(new Date(Date.parse(bookedAt) + totalHours * 3_600_000).toISOString());
}

export function LogisticsPage() {
  const incident = useActiveIncident();
  const run = useStore((state) => (incident ? state.runs[incident.id] : undefined));
  const logistics = useStore((state) => Object.values(state.peers).find((peer) => peer.role === "logistics"));
  const busy = useUi((state) => state.busyIncident);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const plan = async () => {
    if (!incident || useUi.getState().busyIncident) return;
    useUi.getState().setBusy(incident.id);
    try { const outcome = await runStep(incident.id, "logistics"); useUi.getState().notify(outcome.ok ? outcome.summary : outcome.reason || "The step did not complete.", outcome.ok ? "ok" : "warn"); } finally { useUi.getState().setBusy(null); }
  };
  const totals = logisticsTotals(run?.shipmentPlans ?? []);
  const shipments = run?.shipments ?? [];
  const inTransit = shipments.filter((item) => OPEN_STATUSES.includes(item.status)).length;
  const delivered = shipments.filter((item) => item.status === "delivered").length;
  const attention = shipments.filter((item) => item.status === "delayed" || item.status === "failed").length;
  const rows = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return shipments.filter((item) => filter === "all" || (filter === "open" && OPEN_STATUSES.includes(item.status)) || (filter === "delivered" && item.status === "delivered") || (filter === "attention" && (item.status === "delayed" || item.status === "failed")))
      .filter((item) => !words.length || words.every((word) => `${item.trackingCode} ${item.supplierName} ${item.shelterName} ${item.providerName}`.toLowerCase().includes(word)));
  }, [shipments, filter, query]);
  const move = async (trackingCode: string, status: ShipmentStatus) => { if (!incident) return; const result = await setShipmentStatus(incident.id, trackingCode, status); if (!result.ok) useUi.getState().notify(result.reason || "Not allowed.", "warn"); };
  const avgHours = run?.shipmentPlans.filter((item) => item.assigned && item.totalHours !== null).length ? Math.round((run.shipmentPlans.filter((item) => item.assigned && item.totalHours !== null).reduce((sum, item) => sum + (item.totalHours || 0), 0) / run.shipmentPlans.filter((item) => item.assigned && item.totalHours !== null).length) * 10) / 10 : null;

  return (
    <>
      <PageHeader
        eyebrow="Logistics control center"
        title="Logistics"
        subtitle="Transport providers, vehicle availability, route estimates and shipments, read from RouteBridge. Operators are checked with TrustRegistry before their vehicles are assigned."
        actions={<>
          {logistics && <a href={logistics.siteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface-3 px-3.5 py-2 text-[13.5px] font-semibold text-ink hover:bg-surface-4"><ExternalLink size={14} aria-hidden />Open {logistics.label}</a>}
          {incident && run && <Button disabled={!run.shipmentPlans.length} onClick={() => exportShipmentsCsv(incident, run)}><Download size={13} aria-hidden />Export CSV</Button>}
          <Button variant="primary" disabled={!incident || !!busy || !run?.plan || incident.status === "closed"} busy={!!incident && busy === incident.id} onClick={plan} title={!run?.plan ? "Generate the allocation plan first" : undefined}>Plan logistics</Button>
        </>}
      />
      {!incident ? <Empty title="No active incident">Open an incident first.</Empty> : (
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Stat label="Planned shipments" number={run?.shipmentPlans.length ?? 0} hint={`${totals.assigned} with transport`} />
            <Stat label="Without transport" number={totals.unassigned} tone={totals.unassigned ? "critical" : "neutral"} hint={totals.late ? `${totals.late} late` : "none late"} />
            <Stat label="Cargo" value={`${num(totals.weightKg)} kg`} hint={`${inr(totals.cost)} transport`} />
            <Stat label="Average door to door" value={avgHours !== null ? `${avgHours} h` : "—"} hint={totals.longestHours ? `longest ${totals.longestHours} h` : undefined} />
            <Stat label="Open shipments" number={inTransit} tone={inTransit ? "info" : "neutral"} hint="planned, dispatched, in transit, delayed" />
            <Stat label="Delivered" number={delivered} tone={delivered ? "ok" : "neutral"} delta={attention ? `${attention} need attention` : undefined} deltaTone="critical" hint={`${run?.deliveries.length ?? 0} receipt(s) recorded`} />
          </div>

          <Card>
            <CardHeader icon={<Truck size={16} aria-hidden />} title="Shipment control" subtitle="Booked shipments with their tracking codes. Status changes follow the same transitions RouteBridge enforces; in this demonstration a person advances each shipment, and no vehicle really moves." actions={<SimBadge label="Simulated shipments" />} />
            {shipments.length ? (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Segmented label="Filter shipments" size="xs" value={filter} onChange={setFilter} options={[{ id: "all", label: `All (${shipments.length})` }, { id: "open", label: `Open (${inTransit})` }, { id: "delivered", label: `Delivered (${delivered})` }, { id: "attention", label: `Attention (${attention})` }]} />
                  <SearchInput className="ml-auto w-64" value={query} onChange={setQuery} placeholder="Tracking code, supplier, shelter, carrier" label="Search shipments" />
                </div>
                {rows.length ? (
                  <Table label="Shipment control">
                    <thead><tr><Th>Tracking</Th><Th>Vehicle</Th><Th>Cargo</Th><Th>Origin</Th><Th>Destination</Th><Th>Estimated delivery</Th><Th>Status</Th><Th>Update status</Th></tr></thead>
                    <tbody>
                      {rows.map((item) => {
                        const last = item.history[item.history.length - 1];
                        return (
                          <tr key={item.trackingCode}>
                            <Td className="font-mono text-[12px]">{item.trackingCode}<div className="text-[11px] text-muted">{item.bookingReference}</div></Td>
                            <Td>{item.providerName}<div className="text-[11.5px] text-muted">{item.vehicles} × {item.vehicleType?.replace(/_/g, " ")}</div></Td>
                            <Td className="text-[12.5px]">{item.cargo.map((line) => `${num(line.quantity)} ${RESOURCES[line.resource].label.toLowerCase()}`).join(", ")}<div className="text-[11.5px] text-muted">{num(item.weightKg)} kg</div></Td>
                            <Td>{item.supplierName}<div className="text-[11.5px] text-muted">{item.from.label}</div></Td>
                            <Td>{item.shelterName}<div className="text-[11.5px] text-muted">{num(item.haulKm)} km</div></Td>
                            <Td className="text-[12.5px]">{eta(item.history[0]?.at, item.totalHours)}<div className="text-[11.5px] text-muted">{item.totalHours !== null ? `${item.totalHours} h door to door${item.onTime ? "" : " · late"}` : ""}</div></Td>
                            <Td><Badge tone={item.status === "delivered" ? "ok" : item.status === "delayed" || item.status === "failed" || item.status === "cancelled" ? "critical" : "info"}>{STATUS_LABEL[item.status]}</Badge><div className="mt-1 text-[11px] text-muted">{time(last?.at)} · {last?.by}</div>{item.deliveryReceipt && <div className="mt-1 font-mono text-[11px] text-ok-text">receipt {item.deliveryReceipt}</div>}</Td>
                            <Td><div className="flex flex-wrap gap-1">{nextStatuses(item.status).map((status) => <Button key={status} size="sm" variant={status === "failed" || status === "cancelled" ? "ghost" : "secondary"} onClick={() => move(item.trackingCode, status)}>{STATUS_LABEL[status]}</Button>)}{!nextStatuses(item.status).length && <span className="text-[12px] text-muted">Final</span>}</div></Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                ) : <Empty title="No shipment matches">Clear the filter or the search.</Empty>}
              </>
            ) : <Empty icon={<Truck size={18} />} title="No shipments booked yet">Shipments appear here with their tracking codes once the booking is confirmed in {logistics?.label ?? "the logistics network"}'s window.</Empty>}
          </Card>

          <Card><CardHeader icon={<MapIcon size={16} aria-hidden />} title="Routes" subtitle="Planned shipments, flood zones and transport bases. A route animates while its shipment is dispatched or in transit." actions={<SimBadge label="Simulated coordinates" />} /><IncidentMap incident={incident} height={400} /></Card>
          <Card><CardHeader title="Transport plan" subtitle="One shipment per supplier-to-shelter lane, with the chosen provider and the alternatives." /><LogisticsView incidentId={incident.id} /></Card>
          <ExecutionView incidentId={incident.id} showTracking={false} />
          <Card><CardHeader title="Providers and vehicle availability" subtitle="As RouteBridge reported them." /><FleetView incidentId={incident.id} /></Card>
        </div>
      )}
    </>
  );
}
