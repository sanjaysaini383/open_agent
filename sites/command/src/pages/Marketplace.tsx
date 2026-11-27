// The supplier marketplace: supplier cards built from the offers AidSupply published,
// with search, filters, sorting and a side-by-side comparison, plus the ranked offer
// table and the negotiation log. Verification comes from TrustRegistry, never from the
// supplier; the engine, not a person's preference, picks suppliers for the plan.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Columns3, ExternalLink, MapPin, Package, Scale, Store, Truck, X } from "lucide-react";
import { Item, Stagger } from "@/components/motion";
import { NegotiationView, OffersView, ReportButton } from "@/components/views";
import { Badge, Button, Card, CardHeader, Empty, PageHeader, SearchInput, Segmented, SimBadge, Stat, Table, Td, Th, TrustBadge, cx, inputClass } from "@/components/ui";
import { ESTIMATE_ROAD_FACTOR, ESTIMATE_SPEED_KMH } from "@/domain/geo";
import { totalSaving } from "@/domain/negotiation";
import { inr, num, price, RESOURCE_IDS, RESOURCES } from "@/domain/resources";
import type { ResourceId, ScoredOffer, TrustDecision } from "@/domain/types";
import { useActiveIncident, useStore } from "@/state/store";
import type { StepId } from "@/state/types";
import { useUi } from "@/state/ui";
import { runStep, setSupplierOverride } from "@/workflow/steps";

type Sort = "score" | "price" | "lead" | "distance" | "trust";
type Verification = "all" | TrustDecision;
type Eligibility = "all" | "eligible" | "excluded";

interface SupplierCard { id: string; organizationId: string; name: string; type: "ngo" | "commercial"; city: string; distanceKm: number; offers: ScoredOffer[]; bestScore: number; minPrice: number; minLead: number; eligible: number }

function supplierCards(offers: ScoredOffer[]): SupplierCard[] {
  const map = new Map<string, SupplierCard>();
  for (const offer of offers) {
    const card = map.get(offer.supplierId) || { id: offer.supplierId, organizationId: offer.organizationId, name: offer.supplierName, type: offer.supplierType, city: offer.location.city, distanceKm: offer.distanceKm, offers: [], bestScore: Infinity, minPrice: Infinity, minLead: Infinity, eligible: 0 };
    card.offers.push(offer);
    if (offer.eligible) { card.eligible += 1; card.bestScore = Math.min(card.bestScore, offer.score); }
    card.minPrice = Math.min(card.minPrice, offer.unitPrice);
    card.minLead = Math.min(card.minLead, offer.leadTimeHours);
    map.set(offer.supplierId, card);
  }
  return [...map.values()];
}

const transitEstimate = (km: number): number => Math.round(((km * ESTIMATE_ROAD_FACTOR) / ESTIMATE_SPEED_KMH) * 10) / 10;

export function MarketplacePage() {
  const incident = useActiveIncident();
  const run = useStore((state) => (incident ? state.runs[incident.id] : undefined));
  const supplier = useStore((state) => Object.values(state.peers).find((peer) => peer.role === "supplier"));
  const orgTrust = useStore((state) => state.orgTrust);
  const busy = useUi((state) => state.busyIncident);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [resource, setResource] = useState<ResourceId | "all">("all");
  const [verification, setVerification] = useState<Verification>("all");
  const [eligibility, setEligibility] = useState<Eligibility>("all");
  const [sort, setSort] = useState<Sort>("score");
  const [compare, setCompare] = useState<string[]>([]);

  const step = async (id: StepId) => {
    if (!incident || useUi.getState().busyIncident) return;
    useUi.getState().setBusy(incident.id);
    try { const outcome = await runStep(incident.id, id); useUi.getState().notify(outcome.ok ? outcome.summary : outcome.reason || "The step did not complete.", outcome.ok ? "ok" : "warn"); } finally { useUi.getState().setBusy(null); }
  };
  const offers = run?.offers ?? [];
  const cards = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return supplierCards(offers)
      .map((card) => ({ ...card, offers: card.offers.filter((offer) => (resource === "all" || offer.resource === resource) && (eligibility === "all" || (eligibility === "eligible") === offer.eligible)) }))
      .filter((card) => card.offers.length)
      .filter((card) => verification === "all" || (orgTrust[card.organizationId]?.decision ?? card.offers[0].trust) === verification)
      .filter((card) => !words.length || words.every((word) => `${card.name} ${card.city} ${card.id} ${card.offers.map((offer) => offer.offerId).join(" ")}`.toLowerCase().includes(word)))
      .sort((a, b) => {
        if (sort === "price") return Math.min(...a.offers.map((offer) => offer.unitPrice)) - Math.min(...b.offers.map((offer) => offer.unitPrice));
        if (sort === "lead") return Math.min(...a.offers.map((offer) => offer.leadTimeHours)) - Math.min(...b.offers.map((offer) => offer.leadTimeHours));
        if (sort === "distance") return a.distanceKm - b.distanceKm;
        if (sort === "trust") return (orgTrust[b.organizationId]?.score ?? 0) - (orgTrust[a.organizationId]?.score ?? 0);
        return (a.offers.some((offer) => offer.eligible) ? Math.min(...a.offers.filter((offer) => offer.eligible).map((offer) => offer.score)) : Infinity) - (b.offers.some((offer) => offer.eligible) ? Math.min(...b.offers.filter((offer) => offer.eligible).map((offer) => offer.score)) : Infinity);
      });
  }, [offers, query, resource, eligibility, verification, sort, orgTrust]);

  const suppliers = new Set(offers.map((offer) => offer.supplierId)).size;
  const eligible = offers.filter((offer) => offer.eligible).length;
  const flagged = offers.filter((offer) => offer.flags.some((flag) => flag.severity === "critical" || flag.kind === "price_anomaly")).length;
  const disabled = !incident || !!busy || incident.status === "closed";
  const compared = compare.map((id) => offers.find((offer) => offer.offerId === id)).filter((offer): offer is ScoredOffer => !!offer);
  const toggleCompare = (offerId: string) => setCompare(compare.includes(offerId) ? compare.filter((id) => id !== offerId) : compare.length >= 4 ? [...compare.slice(1), offerId] : [...compare, offerId]);
  const shortage = (id: ResourceId) => run?.assessment?.totals[id].shortage ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="Supplier marketplace"
        title="Supplier Marketplace"
        subtitle="Offers from independent NGOs and suppliers, read from AidSupply and compared side by side. Each supplier is checked with TrustRegistry before its offers can be used."
        actions={<>
          {supplier && <a href={supplier.siteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface-3 px-3.5 py-2 text-[13.5px] font-semibold text-ink hover:bg-surface-4"><ExternalLink size={14} aria-hidden />Open {supplier.label}</a>}
          <Button disabled={disabled || !run?.assessment} busy={!!incident && busy === incident.id} onClick={() => step("offers")} title={!run?.assessment ? "Assess the requirements first" : undefined}>Collect offers</Button>
          <Button variant="primary" disabled={disabled || !offers.length} onClick={() => step("negotiate")}>Request negotiation</Button>
        </>}
      />
      {!incident ? <Empty title="No active incident">Open an incident first.</Empty> : (
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Offers" number={offers.length} icon={<Package size={15} />} hint={`${suppliers} suppliers`} />
            <Stat label="Eligible" number={eligible} tone={eligible ? "ok" : "neutral"} hint={`${offers.length - eligible} excluded`} />
            <Stat label="Flagged" number={flagged} tone={flagged ? "critical" : "neutral"} hint="suspicious price or hostile text" />
            <Stat label="Negotiated saving" value={run?.negotiation.length ? inr(totalSaving(run.negotiation)) : "—"} tone="ok" hint="against list prices; non-binding quotes" />
          </div>

          <Card>
            <CardHeader icon={<Store size={16} aria-hidden />} title="Suppliers" subtitle={<span className="flex flex-wrap items-center gap-2">One card per supplier, built from its published offers. <SimBadge /></span>} />
            {offers.length ? (
              <>
                <div className="mb-4 grid gap-2 lg:grid-cols-[1fr_auto_auto_auto_auto] lg:items-center">
                  <SearchInput value={query} onChange={setQuery} placeholder="Search suppliers, cities, offer ids" label="Search suppliers" />
                  <select className={cx(inputClass, "w-auto")} aria-label="Filter by resource" value={resource} onChange={(event) => setResource(event.target.value as ResourceId | "all")}><option value="all">All resources</option>{RESOURCE_IDS.map((id) => <option key={id} value={id}>{RESOURCES[id].label}</option>)}</select>
                  <select className={cx(inputClass, "w-auto")} aria-label="Filter by verification" value={verification} onChange={(event) => setVerification(event.target.value as Verification)}><option value="all">Any verification</option><option value="verified">Verified</option><option value="caution">Caution</option><option value="unverified">Unverified</option><option value="blocked">Blocked</option></select>
                  <Segmented label="Eligibility" size="xs" value={eligibility} onChange={setEligibility} options={[{ id: "all", label: "All" }, { id: "eligible", label: "Eligible" }, { id: "excluded", label: "Excluded" }]} />
                  <select className={cx(inputClass, "w-auto")} aria-label="Sort suppliers" value={sort} onChange={(event) => setSort(event.target.value as Sort)}><option value="score">Sort: best score</option><option value="price">Sort: lowest price</option><option value="lead">Sort: shortest lead time</option><option value="distance">Sort: nearest</option><option value="trust">Sort: highest trust</option></select>
                </div>
                {cards.length ? (
                  <Stagger className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {cards.map((card) => {
                      const evaluation = orgTrust[card.organizationId];
                      const decision = evaluation?.decision ?? card.offers[0].trust;
                      const critical = card.offers.some((offer) => offer.flags.some((flag) => flag.severity === "critical"));
                      const injected = card.offers.some((offer) => offer.flags.some((flag) => flag.kind === "instruction_injection"));
                      const overridable = decision === "unverified" && !injected;
                      const overridden = run!.overrides.includes(card.organizationId);
                      const reputation = evaluation?.evidence.filter((item) => item.id === "reputation" || item.id === "credentials" || item.id === "reports") ?? [];
                      return (
                        <Item key={card.id}>
                          <article className={cx("flex h-full flex-col rounded-[12px] border bg-surface p-4 shadow-card transition-colors", critical ? "border-critical/40" : decision === "verified" ? "border-line hover:border-ok/40" : "border-line")}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <h3 className="truncate text-[14.5px] font-semibold">{card.name}</h3>
                                <p className="text-[12px] text-muted"><span className="font-mono">{card.id}</span> · {card.type === "ngo" ? "NGO" : "Commercial"} · <MapPin size={11} className="inline" aria-hidden /> {card.city}, {num(card.distanceKm)} km</p>
                              </div>
                              <TrustBadge decision={decision} score={evaluation?.score} />
                            </div>
                            <ul className="mt-3 grid gap-1.5">
                              {card.offers.map((offer) => (
                                <li key={offer.offerId} className={cx("flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px]", !offer.eligible && "opacity-70")}>
                                  <label className="inline-flex items-center gap-1.5"><input type="checkbox" aria-label={`Compare ${offer.offerId}`} checked={compare.includes(offer.offerId)} onChange={() => toggleCompare(offer.offerId)} /><span className="font-semibold">{RESOURCES[offer.resource].label}</span></label>
                                  <span className="tabular text-muted">{num(offer.quantityAvailable)} avail · min {num(offer.minOrder)}</span>
                                  <span className="tabular ml-auto font-semibold">{price(offer.unitPrice)}{offer.unitPrice < offer.listUnitPrice && <span className="ml-1 text-[11px] font-normal text-ok-text">quoted</span>}</span>
                                  <span className="tabular text-muted"><Truck size={11} className="inline" aria-hidden /> {offer.leadTimeHours} h + ~{transitEstimate(offer.distanceKm)} h</span>
                                  {offer.eligible ? <Badge tone="ok">rank {offer.rank}</Badge> : <Badge tone="critical">Excluded</Badge>}
                                  {offer.flags.filter((flag) => flag.severity !== "info").map((flag, index) => <span key={index} className={cx("basis-full text-[11.5px]", flag.severity === "critical" ? "text-critical-text" : "text-high-text")}><AlertTriangle size={11} className="inline" aria-hidden /> {flag.detail}</span>)}
                                </li>
                              ))}
                            </ul>
                            <div className="mt-3 text-[12px] text-muted">
                              <span className="font-semibold text-ink-2">Reputation evidence:</span>{" "}
                              {reputation.length ? reputation.map((item) => `${item.label} ${item.earned}/${item.weight}`).join(" · ") : evaluation ? "no reputation record" : "not checked with TrustRegistry yet"}
                              {evaluation?.signatureVerified && <span className="ml-1 text-ok-text">· signature verified</span>}
                            </div>
                            <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
                              <Button size="sm" variant={card.offers.every((offer) => compare.includes(offer.offerId)) ? "secondary" : "outline"} onClick={() => setCompare([...new Set([...compare, ...card.offers.map((offer) => offer.offerId)])].slice(-4))}><Columns3 size={12} aria-hidden />Compare</Button>
                              <Button size="sm" variant="outline" disabled={!run!.plan} onClick={() => navigate("/allocation")} title={run!.plan ? "Open the allocation editor to change what this supplier provides" : "Run the allocation first"}><Scale size={12} aria-hidden />Select in allocation</Button>
                              {overridable && <Button size="sm" variant={overridden ? "secondary" : "danger"} onClick={() => setSupplierOverride(incident.id, card.organizationId, !overridden)}>{overridden ? "Withdraw override" : "Allow anyway…"}</Button>}
                              {(injected || card.offers.some((offer) => offer.flags.some((flag) => flag.kind === "price_anomaly"))) && <ReportButton subjectId={`org:${card.organizationId}`} name={card.name} reason={injected ? "instruction_injection" : "price_anomaly"} details={card.offers.flatMap((offer) => offer.flags.map((flag) => flag.detail)).join(" ")} />}
                            </div>
                          </article>
                        </Item>
                      );
                    })}
                  </Stagger>
                ) : <Empty title="No supplier matches">Clear a filter or the search.</Empty>}
              </>
            ) : <Empty icon={<Store size={18} />} title="No offers yet">Step 5 collects offers from AidSupply, checks every supplier with TrustRegistry and ranks the eligible offers.</Empty>}
          </Card>

          {compared.length > 0 && (
            <Card tone="accent">
              <CardHeader icon={<Columns3 size={16} aria-hidden />} title={`Side-by-side comparison (${compared.length})`} subtitle="Up to four offers. Scores are normalised within each resource; lower is better." actions={<Button size="sm" variant="ghost" onClick={() => setCompare([])}><X size={12} aria-hidden />Clear</Button>} />
              <Table label="Offer comparison side by side">
                <thead><tr><Th>Attribute</Th>{compared.map((offer) => <Th key={offer.offerId}>{offer.supplierName}<div className="font-mono text-[10.5px] font-normal normal-case text-muted">{offer.offerId}</div></Th>)}</tr></thead>
                <tbody>
                  {([
                    ["Resource", (offer: ScoredOffer) => RESOURCES[offer.resource].label],
                    ["Verification", (offer: ScoredOffer) => <TrustBadge decision={orgTrust[offer.organizationId]?.decision ?? offer.trust} score={orgTrust[offer.organizationId]?.score} />],
                    ["Eligible", (offer: ScoredOffer) => (offer.eligible ? <Badge tone="ok">Yes · rank {offer.rank}</Badge> : <Badge tone="critical">No</Badge>)],
                    ["Unit price", (offer: ScoredOffer) => <>{price(offer.unitPrice)}{offer.unitPrice < offer.listUnitPrice ? <span className="text-[11px] text-muted"> (list {price(offer.listUnitPrice)})</span> : null}</>],
                    ["Cost to cover shortage", (offer: ScoredOffer) => inr(Math.min(offer.quantityAvailable, shortage(offer.resource)) * offer.unitPrice)],
                    ["Available / minimum", (offer: ScoredOffer) => `${num(offer.quantityAvailable)} / ${num(offer.minOrder)}`],
                    ["Lead time", (offer: ScoredOffer) => `${offer.leadTimeHours} h`],
                    ["Distance (estimate)", (offer: ScoredOffer) => `${num(offer.distanceKm)} km · ~${transitEstimate(offer.distanceKm)} h`],
                    ["Location", (offer: ScoredOffer) => offer.location.city],
                    ["Score (lower is better)", (offer: ScoredOffer) => (offer.eligible ? `${offer.score.toFixed(2)} (price ${offer.scoreParts.price}, delivery ${offer.scoreParts.delivery}, distance ${offer.scoreParts.distance}, reliability ${offer.scoreParts.reliability})` : "—")],
                    ["Flags", (offer: ScoredOffer) => (offer.flags.filter((flag) => flag.severity !== "info").map((flag) => flag.detail).join(" ") || "none")],
                    ["Valid until", (offer: ScoredOffer) => new Date(offer.validUntil).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })],
                  ] as [string, (offer: ScoredOffer) => React.ReactNode][]).map(([label, cell]) => (
                    <tr key={label}><Td className="font-semibold text-muted">{label}</Td>{compared.map((offer) => <Td key={offer.offerId}>{cell(offer)}</Td>)}</tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}

          <Card><CardHeader title="Offer comparison" subtitle="Ranked per resource. Open the score for its parts." /><OffersView incidentId={incident.id} /></Card>
          <Card><CardHeader title="Negotiation" subtitle="Each quote request and reply, in the order they happened." /><NegotiationView incidentId={incident.id} /></Card>
        </div>
      )}
    </>
  );
}
