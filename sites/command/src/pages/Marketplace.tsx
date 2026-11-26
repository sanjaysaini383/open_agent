import { ExternalLink } from "lucide-react";
import { NegotiationView, OffersView } from "@/components/views";
import { Button, Card, CardHeader, Empty, PageHeader, Stat } from "@/components/ui";
import { totalSaving } from "@/domain/negotiation";
import { inr } from "@/domain/resources";
import { useActiveIncident, useStore } from "@/state/store";
import type { StepId } from "@/state/types";
import { useUi } from "@/state/ui";
import { runStep } from "@/workflow/steps";

export function MarketplacePage() {
  const incident = useActiveIncident();
  const run = useStore((state) => (incident ? state.runs[incident.id] : undefined));
  const supplier = useStore((state) => Object.values(state.peers).find((peer) => peer.role === "supplier"));
  const busy = useUi((state) => state.busyIncident);
  const step = async (id: StepId) => {
    if (!incident || useUi.getState().busyIncident) return;
    useUi.getState().setBusy(incident.id);
    try { const outcome = await runStep(incident.id, id); useUi.getState().notify(outcome.ok ? outcome.summary : outcome.reason || "The step did not complete.", outcome.ok ? "ok" : "warn"); } finally { useUi.getState().setBusy(null); }
  };
  const offers = run?.offers ?? [];
  const suppliers = new Set(offers.map((offer) => offer.supplierId)).size;
  const eligible = offers.filter((offer) => offer.eligible).length;
  const flagged = offers.filter((offer) => offer.flags.some((flag) => flag.severity === "critical" || flag.kind === "price_anomaly")).length;
  const disabled = !incident || !!busy || incident.status === "closed";

  return (
    <>
      <PageHeader
        title="Supplier Marketplace"
        subtitle="Offers from independent NGOs and suppliers, read from AidSupply and compared side by side. Each supplier is checked with TrustRegistry before its offers can be used."
        actions={<>
          {supplier && <a href={supplier.siteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-[#c3cbd9] bg-white px-3.5 py-2 text-[13.5px] font-semibold text-ink-2 hover:bg-slate-50"><ExternalLink size={14} aria-hidden />Open {supplier.label}</a>}
          <Button disabled={disabled || !run?.assessment} busy={!!incident && busy === incident.id} onClick={() => step("offers")} title={!run?.assessment ? "Assess the requirements first" : undefined}>Collect offers</Button>
          <Button variant="primary" disabled={disabled || !offers.length} onClick={() => step("negotiate")}>Request negotiation</Button>
        </>}
      />
      {!incident ? <Empty title="No active incident">Open an incident first.</Empty> : (
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Offers" value={offers.length} hint={`${suppliers} suppliers`} />
            <Stat label="Eligible" value={eligible} tone={eligible ? "ok" : "neutral"} hint={`${offers.length - eligible} excluded`} />
            <Stat label="Flagged" value={flagged} tone={flagged ? "critical" : "neutral"} hint="suspicious price or hostile text" />
            <Stat label="Negotiated saving" value={run?.negotiation.length ? inr(totalSaving(run.negotiation)) : "—"} tone="ok" hint="against list prices; non-binding quotes" />
          </div>
          <Card><CardHeader title="Offer comparison" subtitle="Ranked per resource. Open the score for its parts." /><OffersView incidentId={incident.id} /></Card>
          <Card><CardHeader title="Negotiation" subtitle="Each quote request and reply, in the order they happened." /><NegotiationView incidentId={incident.id} /></Card>
        </div>
      )}
    </>
  );
}
