// Interactive map (Leaflet + OpenStreetMap tiles). Every marker and line comes from the
// store: the incident, the shelters ShelterConnect reported, the suppliers AidSupply
// listed, the transport providers and flood zones RouteBridge returned, and the routes of
// the planned shipments. The coordinates are simulated demonstration data.
import { useEffect, useMemo } from "react";
import L from "leaflet";
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import { inr, num, RESOURCES } from "@/domain/resources";
import type { GeoPoint, Incident } from "@/domain/types";
import { useStore } from "@/state/store";
import { supplierPoints } from "@/workflow/steps";

function pin(color: string, label: string, size = 26): L.DivIcon {
  return L.divIcon({ className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2], html: `<div class="rm-pin" style="width:${size}px;height:${size}px;background:${color}">${label}</div>` });
}

const URGENCY_COLOR = { critical: "#b42318", high: "#c2410c", medium: "#a16207", low: "#3f6212" } as const;

function FitBounds({ points }: { points: GeoPoint[] }) {
  const map = useMap();
  const key = points.map((point) => `${point.lat.toFixed(3)},${point.lng.toFixed(3)}`).join("|");
  useEffect(() => {
    // Not animated: an animation still running when the page changes would touch a map
    // that no longer exists.
    if (points.length > 1) map.fitBounds(L.latLngBounds(points.map((point) => [point.lat, point.lng] as [number, number])), { padding: [28, 28], maxZoom: 11, animate: false });
    else if (points.length === 1) map.setView([points[0].lat, points[0].lng], 9, { animate: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

export function IncidentMap({ incident, height = 420 }: { incident: Incident; height?: number }) {
  const run = useStore((state) => state.runs[incident.id]);
  const orgTrust = useStore((state) => state.orgTrust);
  const shelters = run?.assessment?.shelters ?? [];
  const lines = run?.assessment?.lines ?? [];
  const suppliers = useMemo(() => {
    const fromOffers = run ? supplierPoints(run.offers) : {};
    const list = (run?.suppliers ?? []).map((supplier) => ({ id: supplier.id, name: supplier.name, organizationId: supplier.organizationId, city: supplier.city, point: supplier.location as GeoPoint }));
    for (const [id, point] of Object.entries(fromOffers)) if (!list.some((item) => item.id === id)) list.push({ id, name: point.label, organizationId: "", city: "", point });
    return list;
  }, [run]);
  const providers = run?.providers ?? [];
  const zones = run?.floodZones ?? [];
  const shipments = run?.shipmentPlans ?? [];
  const booked = run?.shipments ?? [];
  const focus: GeoPoint[] = [incident.location, ...shelters.map((shelter) => shelter.location), ...suppliers.map((supplier) => supplier.point), ...providers.map((provider) => provider.base)];

  return (
    <div>
      <MapContainer center={[incident.location.lat, incident.location.lng]} zoom={8} scrollWheelZoom={false} style={{ height }} attributionControl>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <FitBounds points={focus} />

        {zones.map((zone) => (
          <Circle key={zone.id} center={[zone.center.lat, zone.center.lng]} radius={zone.radiusKm * 1000} pathOptions={{ color: zone.effect === "boats_only" ? "#b42318" : "#c2410c", weight: 1.5, fillOpacity: 0.12, dashArray: "5 5" }}>
            <Popup><strong>{zone.name}</strong><br />{zone.effect === "boats_only" ? "Flood zone: flood-capable craft only" : "Flood zone: expect delays"}<br />{zone.note}<br /><em>Simulated, from RouteBridge</em></Popup>
          </Circle>
        ))}

        {shipments.filter((item) => item.assigned).map((item) => {
          const status = booked.find((shipment) => shipment.reference === item.reference)?.status;
          const color = status === "delivered" ? "#15803d" : status === "failed" || status === "cancelled" ? "#94a3b8" : !item.onTime ? "#c2410c" : "#1b4079";
          return (
            <Polyline key={item.reference} positions={[[item.from.lat, item.from.lng], [item.to.lat, item.to.lng]]} pathOptions={{ color, weight: status === "in_transit" ? 3.5 : 2.25, opacity: 0.85, dashArray: status && status !== "planned" ? undefined : "6 6" }}>
              <Popup>
                <strong>{item.supplierName} → {item.shelterName}</strong><br />
                {item.cargo.map((line) => `${num(line.quantity)} ${RESOURCES[line.resource].label.toLowerCase()}`).join(", ")}<br />
                {item.providerName}: {item.vehicles} × {item.vehicleType?.replace(/_/g, " ")}, {item.haulKm} km, {item.totalHours} h door to door, {inr(item.cost)}<br />
                {status ? `Status: ${status.replace(/_/g, " ")}` : "Planned, not booked"}<br />
                <em>Straight line between endpoints; distance from RouteBridge ({item.routeSource})</em>
              </Popup>
            </Polyline>
          );
        })}

        <Marker position={[incident.location.lat, incident.location.lng]} icon={pin("#b42318", "!", 30)}>
          <Popup><strong>{incident.name}</strong><br />{incident.location.name}<br />{num(incident.affectedPopulation)} people affected · severity {incident.severity}<br /><em>Simulated incident</em></Popup>
        </Marker>

        {shelters.map((shelter) => {
          const mine = lines.filter((line) => line.shelterId === shelter.id && line.shortage > 0);
          return (
            <Marker key={shelter.id} position={[shelter.location.lat, shelter.location.lng]} icon={pin(URGENCY_COLOR[shelter.urgency], "S")}>
              <Popup>
                <strong>{shelter.name}</strong><br />{shelter.id} · urgency {shelter.urgency} · {num(shelter.occupancy)} of {num(shelter.capacity)} people<br />
                {mine.length ? <>Short: {mine.map((line) => `${num(line.shortage)} ${RESOURCES[line.resource].label.toLowerCase()}`).join(", ")}</> : "No open shortage"}<br />
                <em>Simulated, from ShelterConnect</em>
              </Popup>
            </Marker>
          );
        })}

        {suppliers.map((supplier) => {
          const decision = orgTrust[supplier.organizationId]?.decision;
          const color = decision === "verified" ? "#1d4ed8" : decision === "caution" ? "#7c3aed" : "#64748b";
          return (
            <Marker key={supplier.id} position={[supplier.point.lat, supplier.point.lng]} icon={pin(color, "$")}>
              <Popup><strong>{supplier.name}</strong><br />{supplier.id}{supplier.city ? ` · ${supplier.city}` : ""}<br />Trust: {decision ?? "not checked"}<br /><em>Simulated, from AidSupply</em></Popup>
            </Marker>
          );
        })}

        {providers.map((provider) => {
          const decision = orgTrust[provider.organizationId]?.decision;
          return (
            <Marker key={provider.id} position={[provider.base.lat, provider.base.lng]} icon={pin(decision === "blocked" ? "#94a3b8" : "#b45309", "T", 24)}>
              <Popup><strong>{provider.name}</strong><br />{provider.base.city}<br />{provider.fleet.map((vehicle) => `${vehicle.available}/${vehicle.count} ${vehicle.vehicleType.replace(/_/g, " ")}`).join(", ")}<br />Trust: {decision ?? "not checked"}<br /><em>Simulated, from RouteBridge</em></Popup>
            </Marker>
          );
        })}
      </MapContainer>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        {[["#b42318", "Incident"], ["#c2410c", "Shelter (colour = urgency)"], ["#1d4ed8", "Supplier"], ["#b45309", "Transport base"]].map(([color, label]) => (
          <li key={label} className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />{label}</li>
        ))}
        <li className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-navy-700" />Planned shipment</li>
        <li className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full border border-dashed border-critical" />Flood zone</li>
        <li>Simulated coordinates. Markers appear as each partner site is read.</li>
      </ul>
    </div>
  );
}
