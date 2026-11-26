// ShelterConnect seed data.
//
// SIMULATED DEMONSTRATION DATA. These shelters, head counts and stock levels are invented
// for the ReliefMesh flood-response demonstration. The place names are real blocks of
// Malda district, West Bengal, so the map is believable, but no real shelter, person or
// organisation is described here.

export class ShelterData {
  static NOTICE = "Simulated demonstration data. Not real shelters, people or stock levels.";

  /** The relief items a shelter can hold or request. Weights feed transport planning. */
  static RESOURCES = {
    food_packets: { label: "Food packets", unit: "packets", unitWeightKg: 1.2 },
    water_kits: { label: "Water kits", unit: "kits", unitWeightKg: 6 },
    medical_kits: { label: "Medical kits", unit: "kits", unitWeightKg: 2.5 },
    blankets: { label: "Emergency blankets", unit: "blankets", unitWeightKg: 1.5 },
  };

  static URGENCY = ["low", "medium", "high", "critical"];

  /** How many hours from "now" the seeded requests are needed by. */
  static SEED_NEEDED_IN_HOURS = 36;

  static SHELTERS = [
    {
      id: "SH-01",
      name: "Manikchak High School Relief Camp",
      block: "Manikchak",
      district: "Malda",
      state: "West Bengal",
      location: { lat: 25.0773, lng: 87.9003 },
      capacity: 1600,
      occupancy: 1450,
      urgency: "critical",
      managedBy: "Block Disaster Management Cell (simulated)",
      inventory: { food_packets: 120, water_kits: 60, medical_kits: 15, blankets: 40 },
      requirements: { food_packets: 700, water_kits: 350, medical_kits: 110, blankets: 180 },
    },
    {
      id: "SH-02",
      name: "Ratua Community Hall Shelter",
      block: "Ratua",
      district: "Malda",
      state: "West Bengal",
      location: { lat: 25.2046, lng: 87.9281 },
      capacity: 1200,
      occupancy: 1050,
      urgency: "high",
      managedBy: "Ratua Gram Panchayat volunteers (simulated)",
      inventory: { food_packets: 90, water_kits: 40, medical_kits: 20, blankets: 25 },
      requirements: { food_packets: 520, water_kits: 260, medical_kits: 80, blankets: 130 },
    },
    {
      id: "SH-03",
      name: "Harishchandrapur Block Shelter",
      block: "Harishchandrapur",
      district: "Malda",
      state: "West Bengal",
      location: { lat: 25.4168, lng: 87.8724 },
      capacity: 1000,
      occupancy: 900,
      urgency: "high",
      managedBy: "Harishchandrapur Relief Committee (simulated)",
      inventory: { food_packets: 60, water_kits: 50, medical_kits: 10, blankets: 30 },
      requirements: { food_packets: 440, water_kits: 220, medical_kits: 60, blankets: 110 },
    },
    {
      id: "SH-04",
      name: "Kaliachak Primary School Camp",
      block: "Kaliachak",
      district: "Malda",
      state: "West Bengal",
      location: { lat: 24.8623, lng: 88.0158 },
      capacity: 900,
      occupancy: 700,
      urgency: "medium",
      managedBy: "Kaliachak Youth Relief Group (simulated)",
      inventory: { food_packets: 80, water_kits: 30, medical_kits: 12, blankets: 20 },
      requirements: { food_packets: 340, water_kits: 170, medical_kits: 50, blankets: 80 },
    },
  ];

  static resourceIds() {
    return Object.keys(ShelterData.RESOURCES);
  }

  static shelterIds() {
    return ShelterData.SHELTERS.map((shelter) => shelter.id);
  }
}
