// Predefined emergency scenarios for the simulator.
//
// SIMULATED DEMONSTRATION DATA. Each scenario creates an incident on this site with its
// own location, severity, population, declared needs, budget and deadline, then runs the
// real coordination workflow against the real partner sites. The partner sites hold one
// simulated dataset (four shelters, four suppliers and three carriers around Malda,
// West Bengal), so every scenario is served by the same shelters and suppliers; the
// assessment step reports where the scenario's declared needs differ from what the
// shelters themselves request.
import type { IncidentCategory, ResourceId, Severity } from "@/domain/types";

export interface ScenarioPreset {
  id: string;
  title: string;
  kind: IncidentCategory;
  tagline: string;
  description: string;
  location: { name: string; lat: number; lng: number };
  severity: Severity;
  affectedPopulation: number;
  shelterCount: number;
  requirements: Record<ResourceId, number>;
  budget: number;
  deadlineHours: number;
  notes: string;
}

export const SCENARIOS: ScenarioPreset[] = [
  {
    id: "major-flood",
    title: "Major flood",
    kind: "flood",
    tagline: "Embankment breach, four shelters cut off by water",
    description: "The preloaded scenario. Severe flooding after an embankment breach; one shelter is reachable by flood-capable craft only.",
    location: { name: "Malda district, West Bengal (simulated scenario)", lat: 25.14, lng: 87.93 },
    severity: "critical",
    affectedPopulation: 12000,
    shelterCount: 4,
    requirements: { food_packets: 2000, water_kits: 1000, medical_kits: 300, blankets: 500 },
    budget: 300000,
    deadlineHours: 36,
    notes: "Severe flooding after an embankment breach. Four emergency shelters are open. Demonstration scenario.",
  },
  {
    id: "earthquake",
    title: "Earthquake",
    kind: "earthquake",
    tagline: "Magnitude 6.1 near the hills, damaged roads",
    description: "A shallow earthquake in the north of the state. Roads are damaged, medical needs dominate and the deadline is short.",
    location: { name: "Siliguri subdivision, West Bengal (simulated scenario)", lat: 26.72, lng: 88.4 },
    severity: "critical",
    affectedPopulation: 8500,
    shelterCount: 4,
    requirements: { food_packets: 1500, water_kits: 900, medical_kits: 450, blankets: 900 },
    budget: 320000,
    deadlineHours: 24,
    notes: "Shallow earthquake; several buildings collapsed. Medical kits and blankets are the priority. Demonstration scenario.",
  },
  {
    id: "cyclone",
    title: "Cyclone",
    kind: "cyclone",
    tagline: "Landfall on the coast, storm surge in the delta",
    description: "A severe cyclonic storm made landfall in the Sundarbans delta. Shelters are crowded and drinking water is the first shortage.",
    location: { name: "Sagar Island, South 24 Parganas (simulated scenario)", lat: 21.65, lng: 88.07 },
    severity: "high",
    affectedPopulation: 15000,
    shelterCount: 4,
    requirements: { food_packets: 2500, water_kits: 1600, medical_kits: 250, blankets: 400 },
    budget: 350000,
    deadlineHours: 48,
    notes: "Cyclone landfall with storm surge. Water sources are contaminated. Demonstration scenario.",
  },
  {
    id: "urban-fire",
    title: "Urban fire",
    kind: "fire",
    tagline: "A fire in a dense settlement, families displaced overnight",
    description: "A large fire displaced several hundred families in a dense urban settlement. Smaller numbers, but everything is needed tonight.",
    location: { name: "Kolkata, Topsia (simulated scenario)", lat: 22.54, lng: 88.39 },
    severity: "high",
    affectedPopulation: 2400,
    shelterCount: 2,
    requirements: { food_packets: 600, water_kits: 300, medical_kits: 120, blankets: 600 },
    budget: 120000,
    deadlineHours: 12,
    notes: "Fire in a dense settlement; the displaced are in two school buildings. Blankets and medical kits first. Demonstration scenario.",
  },
  {
    id: "industrial-accident",
    title: "Industrial accident",
    kind: "other",
    tagline: "Chemical release at a port-side plant, evacuation zone",
    description: "A chemical release forced an evacuation around an industrial estate. Medical kits and clean water are critical; food is secondary.",
    location: { name: "Haldia industrial estate (simulated scenario)", lat: 22.03, lng: 88.06 },
    severity: "critical",
    affectedPopulation: 5200,
    shelterCount: 3,
    requirements: { food_packets: 900, water_kits: 1200, medical_kits: 400, blankets: 300 },
    budget: 260000,
    deadlineHours: 18,
    notes: "Chemical release; a 3 km evacuation zone. Respiratory complaints reported at the shelters. Demonstration scenario.",
  },
];

export function scenarioById(id: string | null | undefined): ScenarioPreset | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}
