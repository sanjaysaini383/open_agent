// The scenario simulator's controls. Starting a scenario creates a real incident and
// runs the real workflow; pausing stops the workflow before its next step; resuming
// continues from that step; resetting clears the incident's run. Nothing is simulated
// here beyond the incident's data, which is labelled as such.
import { incidentForm } from "@/domain/schemas";
import type { Incident, ResourceId } from "@/domain/types";
import { runCoordination } from "@/components/Workflow";
import { AUTOMATED_STEPS } from "@/state/seed";
import { useStore } from "@/state/store";
import { useUi } from "@/state/ui";
import type { ScenarioPreset } from "./scenarios";

export interface ScenarioInput {
  name?: string;
  locationName?: string;
  lat?: number;
  lng?: number;
  severity?: ScenarioPreset["severity"];
  affectedPopulation?: number;
  shelterCount?: number;
  requirements?: Partial<Record<ResourceId, number>>;
  budget?: number;
  deadlineHours?: number;
}

export function nextAutomatedStep(incidentId: string) {
  const run = useStore.getState().run(incidentId);
  return AUTOMATED_STEPS.find((step) => !["done", "warning"].includes(run.steps[step].status));
}

/** Create the incident for a scenario and start the workflow. Returns the incident id, or a validation error. */
export async function startScenario(preset: ScenarioPreset, input: ScenarioInput = {}): Promise<{ ok: true; incidentId: string } | { ok: false; reason: string }> {
  const ui = useUi.getState();
  if (ui.busyIncident) return { ok: false, reason: "A workflow is already running. Wait for it to finish or pause it first." };
  const store = useStore.getState();
  const deadlineHours = input.deadlineHours ?? preset.deadlineHours;
  const deadline = new Date(Date.now() + deadlineHours * 3_600_000);
  const requirements = { ...preset.requirements, ...input.requirements };
  const parsed = incidentForm.safeParse({
    name: input.name ?? `${preset.title}: ${input.locationName ?? preset.location.name}`.slice(0, 120),
    category: preset.kind,
    locationName: input.locationName ?? preset.location.name,
    lat: input.lat ?? preset.location.lat,
    lng: input.lng ?? preset.location.lng,
    severity: input.severity ?? preset.severity,
    affectedPopulation: input.affectedPopulation ?? preset.affectedPopulation,
    shelterCount: input.shelterCount ?? preset.shelterCount,
    food_packets: requirements.food_packets, water_kits: requirements.water_kits, medical_kits: requirements.medical_kits, blankets: requirements.blankets,
    deadline: deadline.toISOString(),
    budget: input.budget ?? preset.budget,
    notes: preset.notes,
  });
  if (!parsed.success) return { ok: false, reason: parsed.error.issues.map((issue) => `${issue.path[0]}: ${issue.message}`).join(" ") };
  const data = parsed.data;
  const now = new Date().toISOString();
  const id = store.nextIncidentId();
  const incident: Incident = {
    id, name: data.name, category: data.category, location: { name: data.locationName, lat: data.lat, lng: data.lng }, severity: data.severity,
    affectedPopulation: data.affectedPopulation, shelterCount: data.shelterCount,
    requirements: { food_packets: data.food_packets, water_kits: data.water_kits, medical_kits: data.medical_kits, blankets: data.blankets },
    deadline: deadline.toISOString(), budget: data.budget, status: "active", simulated: true, notes: data.notes || undefined, createdAt: now, updatedAt: now,
  };
  store.addIncident(incident);
  await store.record({ kind: "incident", actor: "human:coordinator", incidentId: id, summary: `Scenario started: ${preset.title} (${incident.name})`, data: { scenario: preset.id, simulated: true, requirements: incident.requirements, budget: incident.budget, deadline: incident.deadline } });
  ui.setSimulationPaused(false);
  void runCoordination(id, "assess");
  return { ok: true, incidentId: id };
}

/** Stop before the next step. The step in flight finishes; it cannot be interrupted half-way through a partner call. */
export function pauseSimulation(incidentId: string): void {
  useUi.getState().setSimulationPaused(true);
  void useStore.getState().record({ kind: "workflow", actor: "human:coordinator", incidentId, summary: "Simulation paused by the coordinator: the workflow stops before its next step", data: {} });
}

export async function resumeSimulation(incidentId: string): Promise<void> {
  const ui = useUi.getState();
  if (ui.busyIncident) return;
  ui.setSimulationPaused(false);
  const next = nextAutomatedStep(incidentId);
  if (!next) { ui.notify("The automated steps are complete. The plan is waiting for your approval.", "info"); return; }
  await useStore.getState().record({ kind: "workflow", actor: "human:coordinator", incidentId, summary: "Simulation resumed by the coordinator", data: { from: next } });
  void runCoordination(incidentId, next);
}

/** Clear the incident's run so the scenario can be replayed. Refused while a step is running or after a partner confirmed a write. */
export async function resetScenario(incidentId: string): Promise<{ ok: boolean; reason?: string }> {
  const store = useStore.getState();
  if (useUi.getState().busyIncident === incidentId) return { ok: false, reason: "A step is running. Pause and wait for it to finish first." };
  const run = store.run(incidentId);
  if (run.reservation.status === "confirmed" || run.booking.status === "confirmed") return { ok: false, reason: "Stock or transport for this incident was confirmed with a partner. Those records stay; create a new scenario to plan again." };
  store.resetRun(incidentId);
  useUi.getState().setSimulationPaused(false);
  await store.record({ kind: "workflow", actor: "human:coordinator", incidentId, summary: "Scenario reset: the incident's workflow results were cleared", data: {} });
  return { ok: true };
}
