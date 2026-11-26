// RouteBridge seed data.
//
// SIMULATED DEMONSTRATION DATA. These transport providers, fleets, rates, flood zones and
// places are invented for the ReliefMesh flood-response demonstration. The place names
// are real towns and blocks of West Bengal, so the map is believable, but no real
// operator, vehicle, road closure or shipment is described here.

export class RouteData {
  static NOTICE = "Simulated demonstration data. Not real transport providers, vehicles, routes or shipments.";

  /** The relief items a shipment can carry. Weights match the other ReliefMesh sites. */
  static RESOURCES = {
    food_packets: { label: "Food packets", unit: "packets", unitWeightKg: 1.2 },
    water_kits: { label: "Water kits", unit: "kits", unitWeightKg: 6 },
    medical_kits: { label: "Medical kits", unit: "kits", unitWeightKg: 2.5 },
    blankets: { label: "Emergency blankets", unit: "blankets", unitWeightKg: 1.5 },
  };

  /** Vehicle catalogue. nominalSpeedKmh feeds the best-case estimate of a route. */
  static VEHICLES = {
    light_truck: { label: "Light truck", nominalSpeedKmh: 38, floodCapable: false },
    heavy_truck: { label: "Heavy truck", nominalSpeedKmh: 30, floodCapable: false },
    relief_boat: { label: "Relief boat", nominalSpeedKmh: 14, floodCapable: true },
  };

  /** Road distance is the great-circle distance times this factor. */
  static ROAD_FACTOR = 1.32;

  /** Hours to load a vehicle before it leaves. */
  static LOADING_HOURS = 1;

  static CURRENCY = "INR";

  static FLOOD_ZONES = [
    {
      id: "FZ-1",
      name: "Manikchak embankment breach",
      center: { lat: 25.0773, lng: 87.9003 },
      radiusKm: 7,
      effect: "boats_only",
      note: "Approach roads submerged; only flood-capable craft can reach the last stretch.",
    },
    {
      id: "FZ-2",
      name: "Ratua low-lying approach",
      center: { lat: 25.2046, lng: 87.9281 },
      radiusKm: 5,
      effect: "delay",
      delayHours: 1.5,
      note: "Waterlogged approach road; expect slow convoy movement.",
    },
  ];

  static PROVIDERS = [
    {
      id: "TR-1",
      organizationId: "ORG-TR-1",
      name: "Malda Fleet Cooperative",
      base: { lat: 25.0108, lng: 88.1411, city: "Malda Town" },
      fleet: [
        { vehicleType: "light_truck", count: 6, capacityKg: 2500, avgSpeedKmh: 38, ratePerKm: 38, floodCapable: false },
        { vehicleType: "heavy_truck", count: 3, capacityKg: 9000, avgSpeedKmh: 30, ratePerKm: 72, floodCapable: false },
      ],
    },
    {
      id: "TR-2",
      organizationId: "ORG-TR-2",
      name: "Farakka Barge & Boat Union",
      base: { lat: 24.7743, lng: 87.9166, city: "Farakka" },
      fleet: [
        { vehicleType: "relief_boat", count: 4, capacityKg: 1200, avgSpeedKmh: 14, ratePerKm: 55, floodCapable: true },
        { vehicleType: "heavy_truck", count: 2, capacityKg: 8000, avgSpeedKmh: 28, ratePerKm: 70, floodCapable: false },
      ],
    },
    {
      id: "TR-3",
      organizationId: "ORG-TR-3",
      name: "Teesta Cargo Movers",
      base: { lat: 26.7271, lng: 88.3953, city: "Siliguri" },
      fleet: [
        { vehicleType: "heavy_truck", count: 5, capacityKg: 10000, avgSpeedKmh: 34, ratePerKm: 60, floodCapable: false },
      ],
    },
    {
      id: "TR-4",
      organizationId: "ORG-TR-4",
      name: "Murshidabad Relief Logistics",
      base: { lat: 24.1040, lng: 88.2510, city: "Berhampore" },
      fleet: [
        { vehicleType: "light_truck", count: 4, capacityKg: 3000, avgSpeedKmh: 40, ratePerKm: 40, floodCapable: false },
        { vehicleType: "heavy_truck", count: 2, capacityKg: 9000, avgSpeedKmh: 32, ratePerKm: 68, floodCapable: false },
      ],
    },
  ];

  /**
   * Places the page's route planner offers, besides the providers' own bases: the four
   * simulated shelters and the four simulated supplier depots of the demonstration.
   */
  static PLACES = [
    { id: "SH-01", kind: "shelter", label: "Manikchak High School Relief Camp (SH-01)", lat: 25.0773, lng: 87.9003 },
    { id: "SH-02", kind: "shelter", label: "Ratua Community Hall Shelter (SH-02)", lat: 25.2046, lng: 87.9281 },
    { id: "SH-03", kind: "shelter", label: "Harishchandrapur Block Shelter (SH-03)", lat: 25.4168, lng: 87.8724 },
    { id: "SH-04", kind: "shelter", label: "Kaliachak Primary School Camp (SH-04)", lat: 24.8623, lng: 88.0158 },
    { id: "SUP-A", kind: "supplier", label: "Bengal Relief Foundation depot, Kolkata (SUP-A)", lat: 22.5726, lng: 88.3639 },
    { id: "SUP-B", kind: "supplier", label: "North Bengal Aid Collective depot, Siliguri (SUP-B)", lat: 26.7271, lng: 88.3953 },
    { id: "SUP-C", kind: "supplier", label: "Ganga Basin Supplies depot, Berhampore (SUP-C)", lat: 24.1040, lng: 88.2510 },
    { id: "SUP-D", kind: "supplier", label: "QuickAid Traders depot, Raiganj (SUP-D)", lat: 25.6185, lng: 88.1256 },
  ];

  /** Shipment statuses, and the only transitions the site allows. */
  static TRANSITIONS = {
    planned: ["dispatched", "cancelled"],
    dispatched: ["in_transit", "cancelled"],
    in_transit: ["delivered", "delayed", "failed"],
    delayed: ["in_transit", "delivered", "failed"],
    delivered: [],
    cancelled: [],
    failed: [],
  };

  /** A shipment in one of these statuses holds its vehicles. */
  static HOLDING = ["planned", "dispatched", "in_transit", "delayed"];

  static statuses() {
    return Object.keys(RouteData.TRANSITIONS);
  }

  static vehicleTypes() {
    return Object.keys(RouteData.VEHICLES);
  }

  static resourceIds() {
    return Object.keys(RouteData.RESOURCES);
  }
}
