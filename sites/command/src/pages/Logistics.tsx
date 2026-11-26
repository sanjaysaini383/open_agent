import { ExternalLink } from "lucide-react";
import { IncidentMap } from "@/components/IncidentMap";
import { ExecutionView, FleetView, LogisticsView } from "@/components/views";
import { Button, Card, CardHeader, Empty, PageHeader, SimBadge, Stat } from "@/components/ui";
import { logisticsTotals } from "@/domain/logistics";
import { inr, num } from "@/domain/resources";
import { OPEN_STATUSES } from "@/domain/shipments";
import { useActiveIncident, useStore } from "@/state/store";
import { useUi } from "@/state/ui";
import { runStep } from "@/workflow/steps";

export function LogisticsPage() {
  const incident = useActiveIncident();
  const run = useStore((state) => (incident ? state.runs[incident.id] : undefined));
  const logistics = useStore((state) => Object.values(state.peers).find((peer) => peer.role === "logistics"));
  const busy = useUi((state) => state.busyIncident);
  const plan = async () => {
    if (!incident || useUi.getState().busyIncident) return;
    useUi.getState().setBusy(incident.id);
    try { const outcome = await runStep(incident.id, "logistics"); useUi.getState().notify(outcome.ok ? outcome.summary : outcome.reason || "The step did not complete.", outcome.ok ? "ok" : "warn"); } finally { useUi.getState().setBusy(null); }
  };
  const totals = logisticsTotals(run?.shipmentPlans ?? []);
  const inTransit = (run?.shipments ?? []).filter((item) => OPEN_STATUSES.includes(item.status)).length;
  const delivered = (run?.shipments ?? []).filter((item) => item.status === "delivered").length;

  return (
    <>
      <PageHeader
        title="Logistics"
        subtitle="Transport providers, vehicle availability, route estimates and shipments, read from RouteBridge. Operators are checked with TrustRegistry before their vehicles are assigned."
        actions={<>
          {logistics && <a href={logistics.siteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-[#c3cbd9] bg-white px-3.5 py-2 text-[13.5px] font-semibold text-ink-2 hover:bg-slate-50"><ExternalLink size={14} aria-hidden />Open {logistics.label}</a>}
          <Button variant="primary" disabled={!incident || !!busy || !run?.plan || incident.status === "closed"} busy={!!incident && busy === incident.id} onClick={plan} title={!run?.plan ? "Generate the allocation plan first" : undefined}>Plan logistics</Button>
        </>}
      />
      {!incident ? <Empty title="No active incident">Open an incident first.</Empty> : (
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Planned shipments" value={run?.shipmentPlans.length ?? 0} hint={`${totals.assigned} with transport`} />
            <Stat label="Without transport" value={totals.unassigned} tone={totals.unassigned ? "critical" : "neutral"} hint={totals.late ? `${totals.late} late` : "none late"} />
            <Stat label="Cargo" value={`${num(totals.weightKg)} kg`} hint={`${inr(totals.cost)} transport`} />
            <Stat label="Open shipments" value={inTransit} tone={inTransit ? "info" : "neutral"} hint="pending, dispatched, in transit, delayed" />
            <Stat label="Delivered" value={delivered} tone={delivered ? "ok" : "neutral"} hint={`${run?.deliveries.length ?? 0} receipt(s) recorded`} />
          </div>
          <Card><CardHeader title="Transport plan" subtitle="One shipment per supplier-to-shelter lane, with the chosen provider and the alternatives." /><LogisticsView incidentId={incident.id} /></Card>
          <Card><CardHeader title="Routes" subtitle="Planned shipments, flood zones and transport bases." actions={<SimBadge label="Simulated coordinates" />} /><IncidentMap incident={incident} height={380} /></Card>
          <ExecutionView incidentId={incident.id} />
          <Card><CardHeader title="Providers and vehicle availability" subtitle="As RouteBridge reported them." /><FleetView incidentId={incident.id} /></Card>
        </div>
      )}
    </>
  );
}
