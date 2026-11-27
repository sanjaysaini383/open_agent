// Interactive map (Leaflet). Every marker and line comes from the store: the incident,
// the shelters ShelterConnect reported, the suppliers AidSupply listed, the transport
// providers and flood zones RouteBridge returned, and the routes of the planned shipments.
// The coordinates are simulated demonstration data. Tiles follow the theme.
import { useEffect, useMemo } from "react";
import L from "leaflet";
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import { inr, num, RESOURCES } from "@/domain/resources";
import type { GeoPoint, Incident } from "@/domain/types";
import { useTheme } from "@/lib/theme";
import { useStore } from "@/state/store";
import { supplierPoints } from "@/workflow/steps";

function pin(color: string, label: string, size = 26, hot = false): L.DivIcon {
  return L.divIcon({ className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2], html: `<div class="rm-pin${hot ? " rm-pin-hot" : ""}" style="width:${size}px;height:${size}px;background:${color}">${label}</div>` });
}

const URGENCY_COLOR = { critical: "#ef5e5e", high: "#f59e0b", medium: "#eab308", low: "#34d399" } as const;

// One keyless tile source. In the dark theme the tile layer is inverted and desaturated
// with CSS (see index.css), so no commercial dark basemap or API key is needed.
const TILES = { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' };

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
  const theme = useTheme();
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
  const allocatedTo = (shelterId: string) => (run?.plan?.lines ?? []).filter((line) => line.shelterId === shelterId).reduce((sum, line) => sum + line.quantity, 0);

  return (
    <div>
      <MapContainer center={[incident.location.lat, incident.location.lng]} zoom={8} scrollWheelZoom={false} style={{ height }} attributionControl>
        <TileLayer attribution={TILES.attribution} url={TILES.url} className={theme === "dark" ? "rm-tiles-dark" : undefined} />
        <FitBounds points={focus} />

        {zones.map((zone) => (
          <Circle key={zone.id} center={[zone.center.lat, zone.center.lng]} radius={zone.radiusKm * 1000} pathOptions={{ color: zone.effect === "boats_only" ? "#ef5e5e" : "#f59e0b", weight: 1.5, fillOpacity: 0.12, dashArray: "5 5" }}>
            <Popup><strong>{zone.name}</strong><br />{zone.effect === "boats_only" ? "Flood zone: flood-capable craft only" : "Flood zone: expect delays"}<br />{zone.note}<br /><em>Simulated, from RouteBridge</em></Popup>
          </Circle>
        ))}

        {shipments.filter((item) => item.assigned).map((item) => {
          const shipment = booked.find((entry) => entry.reference === item.reference);
          const status = shipment?.status;
          const moving = status === "dispatched" || status === "in_transit";
          const color = status === "delivered" ? "#34d399" : status === "failed" || status === "cancelled" ? "#8494ad" : status === "delayed" ? "#ef5e5e" : !item.onTime ? "#f59e0b" : "#22d3ee";
          return (
            <Polyline key={`${item.reference}-${status ?? "planned"}`} positions={[[item.from.lat, item.from.lng], [item.to.lat, item.to.lng]]} pathOptions={{ color, weight: moving ? 3.5 : 2.25, opacity: 0.9, dashArray: status && status !== "planned" ? undefined : "6 6", className: moving ? "rm-route-live" : undefined }}>
              <Popup>
                <strong>{item.supplierName} → {item.shelterName}</strong><br />
                {item.cargo.map((line) => `${num(line.quantity)} ${RESOURCES[line.resource].label.toLowerCase()}`).join(", ")}<br />
                {item.providerName}: {item.vehicles} × {item.vehicleType?.replace(/_/g, " ")}, {item.haulKm} km, {item.totalHours} h door to door, {inr(item.cost)}<br />
                {status ? `Status: ${status.replace(/_/g, " ")}${shipment?.trackingCode ? ` (${shipment.trackingCode})` : ""}` : "Planned, not booked"}<br />
                <em>Straight line between endpoints; distance from RouteBridge ({item.routeSource})</em>
              </Popup>
            </Polyline>
          );
        })}

        <Marker position={[incident.location.lat, incident.location.lng]} icon={pin("#ef5e5e", "!", 30, incident.severity === "critical")}>
          <Popup><strong>{incident.name}</strong><br />{incident.location.name}<br />{num(incident.affectedPopulation)} people affected · severity {incident.severity}<br /><em>Simulated incident</em></Popup>
        </Marker>

        {shelters.map((shelter) => {
          const mine = lines.filter((line) => line.shelterId === shelter.id && line.shortage > 0);
          const short = mine.reduce((sum, line) => sum + line.shortage, 0);
          const got = allocatedTo(shelter.id);
          const hot = shelter.urgency === "critical" && short > got;
          return (
            <Marker key={shelter.id} position={[shelter.location.lat, shelter.location.lng]} icon={pin(URGENCY_COLOR[shelter.urgency], "S", hot ? 30 : 26, hot)}>
              <Popup>
                <strong>{shelter.name}</strong><br />{shelter.id} · urgency {shelter.urgency} · {num(shelter.occupancy)} of {num(shelter.capacity)} people<br />
                {mine.length ? <>Short: {mine.map((line) => `${num(line.shortage)} ${RESOURCES[line.resource].label.toLowerCase()}`).join(", ")}</> : "No open shortage"}<br />
                {run?.plan ? `Allocated: ${num(got)} of ${num(short)} units` : "Not allocated yet"}<br />
                <em>Simulated, from ShelterConnect</em>
              </Popup>
            </Marker>
          );
        })}

        {suppliers.map((supplier) => {
          const decision = orgTrust[supplier.organizationId]?.decision;
          const color = decision === "verified" ? "#60a5fa" : decision === "caution" ? "#a78bfa" : "#8494ad";
          return (
            <Marker key={supplier.id} position={[supplier.point.lat, supplier.point.lng]} icon={pin(color, "$")}>
              <Popup><strong>{supplier.name}</strong><br />{supplier.id}{supplier.city ? ` · ${supplier.city}` : ""}<br />Trust: {decision ?? "not checked"}<br /><em>Simulated, from AidSupply</em></Popup>
            </Marker>
          );
        })}

        {providers.map((provider) => {
          const decision = orgTrust[provider.organizationId]?.decision;
          return (
            <Marker key={provider.id} position={[provider.base.lat, provider.base.lng]} icon={pin(decision === "blocked" ? "#8494ad" : "#f59e0b", "T", 24)}>
              <Popup><strong>{provider.name}</strong><br />{provider.base.city}<br />{provider.fleet.map((vehicle) => `${vehicle.available}/${vehicle.count} ${vehicle.vehicleType.replace(/_/g, " ")}`).join(", ")}<br />Trust: {decision ?? "not checked"}<br /><em>Simulated, from RouteBridge</em></Popup>
            </Marker>
          );
        })}
      </MapContainer>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        {[["#ef5e5e", "Incident"], ["#f59e0b", "Shelter (colour = urgency; ring = critical shortage)"], ["#60a5fa", "Supplier"], ["#f59e0b", "Transport base"]].map(([color, label]) => (
          <li key={label} className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />{label}</li>
        ))}
        <li className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-accent" />Planned shipment (moving when in transit)</li>
        <li className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full border border-dashed border-critical" />Flood zone</li>
        <li>Simulated coordinates. Markers appear as each partner site is read.</li>
      </ul>
    </div>
  );
}
