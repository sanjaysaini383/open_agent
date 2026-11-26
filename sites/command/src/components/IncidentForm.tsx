// Create or edit an incident. Every field is validated with the same zod schema the
// tests use; nothing is saved until the whole form passes.
import { useState } from "react";
import { RESOURCE_IDS, RESOURCES } from "@/domain/resources";
import { incidentForm } from "@/domain/schemas";
import type { Incident } from "@/domain/types";
import { useStore } from "@/state/store";
import { useUi } from "@/state/ui";
import { Button, Field, Modal, Notice, inputClass } from "./ui";

const toLocalInput = (iso: string): string => {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

export function IncidentFormDialog({ incident, onClose, onSaved }: { incident?: Incident; onClose: () => void; onSaved?: (id: string) => void }) {
  const settings = useStore((state) => state.settings);
  const [values, setValues] = useState<Record<string, string>>(() => ({
    name: incident?.name ?? "",
    category: incident?.category ?? "flood",
    locationName: incident?.location.name ?? "",
    lat: incident ? String(incident.location.lat) : "",
    lng: incident ? String(incident.location.lng) : "",
    severity: incident?.severity ?? "high",
    affectedPopulation: incident ? String(incident.affectedPopulation) : "",
    shelterCount: incident ? String(incident.shelterCount) : "0",
    ...Object.fromEntries(RESOURCE_IDS.map((id) => [id, incident ? String(incident.requirements[id]) : "0"])),
    deadline: toLocalInput(incident?.deadline ?? new Date(Date.now() + settings.defaultDeadlineHours * 3_600_000).toISOString()),
    budget: String(incident?.budget ?? settings.defaultBudget),
    notes: incident?.notes ?? "",
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (key: string) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setValues({ ...values, [key]: event.target.value });
  const number = (key: string) => (values[key].trim() === "" ? Number.NaN : Number(values[key]));

  const save = async () => {
    const parsed = incidentForm.safeParse({
      name: values.name, category: values.category, locationName: values.locationName, lat: number("lat"), lng: number("lng"),
      severity: values.severity, affectedPopulation: number("affectedPopulation"), shelterCount: number("shelterCount"),
      food_packets: number("food_packets"), water_kits: number("water_kits"), medical_kits: number("medical_kits"), blankets: number("blankets"),
      deadline: values.deadline, budget: number("budget"), notes: values.notes,
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])));
      return;
    }
    const data = parsed.data;
    const deadline = new Date(data.deadline);
    if (!incident && deadline.getTime() <= Date.now()) { setErrors({ deadline: "The delivery deadline must be in the future." }); return; }
    const store = useStore.getState();
    const now = new Date().toISOString();
    const fields = {
      name: data.name, category: data.category, location: { name: data.locationName, lat: data.lat, lng: data.lng }, severity: data.severity,
      affectedPopulation: data.affectedPopulation, shelterCount: data.shelterCount,
      requirements: { food_packets: data.food_packets, water_kits: data.water_kits, medical_kits: data.medical_kits, blankets: data.blankets },
      deadline: deadline.toISOString(), budget: data.budget, notes: data.notes || undefined,
    };
    if (incident) {
      store.updateIncident(incident.id, fields);
      await store.record({ kind: "incident", actor: "human:coordinator", incidentId: incident.id, summary: `Incident edited: ${data.name}`, data: fields });
      useUi.getState().notify("Incident updated. Re-run the workflow steps that depend on what you changed.", "ok");
      onSaved?.(incident.id);
    } else {
      const id = store.nextIncidentId();
      // An incident a person creates here is still part of the demonstration: partner data is simulated.
      store.addIncident({ id, ...fields, status: "active", simulated: true, createdAt: now, updatedAt: now });
      await store.record({ kind: "incident", actor: "human:coordinator", incidentId: id, summary: `Incident created: ${data.name}`, data: fields });
      useUi.getState().notify(`Incident ${id} created and set as the active incident.`, "ok");
      onSaved?.(id);
    }
    onClose();
  };

  return (
    <Modal wide title={incident ? `Edit incident ${incident.id}` : "Create emergency incident"} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>{incident ? "Save changes" : "Create incident"}</Button></>}>
      <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }} noValidate>
        {Object.keys(errors).length > 0 && <Notice tone="critical">Some fields need attention. Nothing was saved.</Notice>}
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Incident name" error={errors.name}><input className={inputClass} value={values.name} onChange={set("name")} maxLength={120} autoComplete="off" /></Field>
          <Field label="Disaster category" error={errors.category}>
            <select className={inputClass} value={values.category} onChange={set("category")}>{["flood", "cyclone", "earthquake", "landslide", "fire", "other"].map((item) => <option key={item} value={item}>{item}</option>)}</select>
          </Field>
          <Field label="Location" error={errors.locationName}><input className={inputClass} value={values.locationName} onChange={set("locationName")} maxLength={120} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude" error={errors.lat}><input className={inputClass} inputMode="decimal" value={values.lat} onChange={set("lat")} placeholder="25.14" /></Field>
            <Field label="Longitude" error={errors.lng}><input className={inputClass} inputMode="decimal" value={values.lng} onChange={set("lng")} placeholder="87.93" /></Field>
          </div>
          <Field label="Severity" error={errors.severity}>
            <select className={inputClass} value={values.severity} onChange={set("severity")}>{["low", "moderate", "high", "critical"].map((item) => <option key={item} value={item}>{item}</option>)}</select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Affected population" error={errors.affectedPopulation}><input className={inputClass} inputMode="numeric" value={values.affectedPopulation} onChange={set("affectedPopulation")} /></Field>
            <Field label="Emergency shelters" error={errors.shelterCount}><input className={inputClass} inputMode="numeric" value={values.shelterCount} onChange={set("shelterCount")} /></Field>
          </div>
        </div>
        <fieldset className="rounded-lg border border-line p-3">
          <legend className="px-1 text-[12.5px] font-semibold text-ink-2">Required resources (declared totals)</legend>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {RESOURCE_IDS.map((id) => <Field key={id} label={RESOURCES[id].label} error={errors[id]}><input className={inputClass} inputMode="numeric" value={values[id]} onChange={set(id)} /></Field>)}
          </div>
          <p className="mt-2 text-[12px] text-muted">The assessment step compares these with what the shelters themselves report, and uses the shelter figures for allocation.</p>
        </fieldset>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Delivery deadline" error={errors.deadline}><input className={inputClass} type="datetime-local" value={values.deadline} onChange={set("deadline")} /></Field>
          <Field label="Budget (INR)" error={errors.budget} hint="A hard limit for the allocation engine."><input className={inputClass} inputMode="numeric" value={values.budget} onChange={set("budget")} /></Field>
        </div>
        <Field label="Notes (optional)" error={errors.notes}><textarea className={inputClass} rows={2} maxLength={600} value={values.notes} onChange={set("notes")} /></Field>
      </form>
    </Modal>
  );
}
