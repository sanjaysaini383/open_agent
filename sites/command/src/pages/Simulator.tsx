// The scenario simulator. A scenario creates a real incident on this site and runs the
// real workflow against the real partner sites; pause, resume and reset control that run.
// What is simulated is the incident data, and the page says so.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Activity, Building2, CloudLightning, Factory, Flame, FlaskConical, Mountain, Pause, Play, RotateCcw, Waves, type LucideIcon } from "lucide-react";
import { ActivityFeed } from "@/components/ActivityFeed";
import { Item, LiveDot, Stagger } from "@/components/motion";
import { NetworkGraph } from "@/components/NetworkGraph";
import { WorkflowPanel } from "@/components/Workflow";
import { Badge, Button, Card, CardHeader, Field, Meter, Notice, PageHeader, SeverityBadge, SimBadge, cx, inputClass } from "@/components/ui";
import { inr, num, RESOURCE_IDS, RESOURCES } from "@/domain/resources";
import { AUTOMATED_STEPS, STEPS } from "@/state/seed";
import { useStore } from "@/state/store";
import { useUi } from "@/state/ui";
import { SCENARIOS, scenarioById, type ScenarioPreset } from "@/workflow/scenarios";
import { nextAutomatedStep, pauseSimulation, resetScenario, resumeSimulation, startScenario } from "@/workflow/simulation";

const ICON: Record<string, LucideIcon> = { "major-flood": Waves, earthquake: Mountain, cyclone: CloudLightning, "urban-fire": Flame, "industrial-accident": Factory };

function formFor(preset: ScenarioPreset) {
  return {
    name: `${preset.title}: ${preset.location.name}`.slice(0, 120), locationName: preset.location.name, lat: String(preset.location.lat), lng: String(preset.location.lng),
    severity: preset.severity, affectedPopulation: String(preset.affectedPopulation), shelterCount: String(preset.shelterCount),
    ...Object.fromEntries(RESOURCE_IDS.map((id) => [id, String(preset.requirements[id])])), budget: String(preset.budget), deadlineHours: String(preset.deadlineHours),
  } as Record<string, string>;
}

export function SimulatorPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const incidents = useStore((state) => state.incidents);
  const runs = useStore((state) => state.runs);
  const busy = useUi((state) => state.busyIncident);
  const paused = useUi((state) => state.simulationPaused);
  const [selected, setSelected] = useState<ScenarioPreset>(() => scenarioById(params.get("scenario")) ?? SCENARIOS[0]);
  const [values, setValues] = useState<Record<string, string>>(() => formFor(selected));
  const [error, setError] = useState("");
  const [incidentId, setIncidentId] = useState<string | null>(() => params.get("incident"));
  useEffect(() => { const preset = scenarioById(params.get("scenario")); if (preset && preset.id !== selected.id) { setSelected(preset); setValues(formFor(preset)); } }, [params, selected.id]);

  const incident = incidents.find((item) => item.id === incidentId) ?? null;
  const run = incident ? runs[incident.id] : null;
  const running = !!incident && busy === incident.id;
  const next = incident ? nextAutomatedStep(incident.id) : undefined;
  const done = run ? AUTOMATED_STEPS.filter((step) => ["done", "warning"].includes(run.steps[step].status)).length : 0;
  const current = run ? STEPS.find((step) => run.steps[step.id].status === "running") : undefined;
  const pick = (preset: ScenarioPreset) => { setSelected(preset); setValues(formFor(preset)); setParams({ scenario: preset.id }); };
  const set = (name: string) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setValues({ ...values, [name]: event.target.value });
  const number = (name: string) => (values[name].trim() === "" ? Number.NaN : Number(values[name]));

  const start = async () => {
    setError("");
    const result = await startScenario(selected, {
      name: values.name, locationName: values.locationName, lat: number("lat"), lng: number("lng"), severity: values.severity as ScenarioPreset["severity"],
      affectedPopulation: number("affectedPopulation"), shelterCount: number("shelterCount"), budget: number("budget"), deadlineHours: number("deadlineHours"),
      requirements: Object.fromEntries(RESOURCE_IDS.map((id) => [id, number(id)])) as Record<(typeof RESOURCE_IDS)[number], number>,
    });
    if (!result.ok) { setError(result.reason); return; }
    setIncidentId(result.incidentId);
    setParams({ scenario: selected.id, incident: result.incidentId });
  };
  const scenarioIncidents = useMemo(() => incidents.filter((item) => /^(Major flood|Earthquake|Cyclone|Urban fire|Industrial accident): /.test(item.name)).slice().reverse(), [incidents]);

  return (
    <>
      <PageHeader eyebrow="Emergency scenario simulator" title="Scenario Simulator" subtitle={<span className="flex flex-wrap items-center gap-2">Pick a disaster, adjust it, and start. The scenario creates a real incident on this site and runs the real workflow against the real partner sites. <SimBadge label="Simulated incident data" /></span>} />
      <div className="grid gap-5">
        <Stagger className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {SCENARIOS.map((preset) => {
            const Icon = ICON[preset.id] ?? FlaskConical;
            const active = preset.id === selected.id;
            return (
              <Item key={preset.id}>
                <button type="button" onClick={() => pick(preset)} aria-pressed={active} className={cx("h-full w-full rounded-[12px] border p-4 text-left transition-colors", active ? "border-accent/60 bg-accent-soft shadow-glow" : "border-line bg-surface hover:border-line-strong hover:bg-surface-2")}>
                  <div className="flex items-center justify-between"><span className={cx("grid h-9 w-9 place-items-center rounded-lg", active ? "bg-accent text-accent-ink" : "bg-surface-3 text-accent-text")}><Icon size={18} aria-hidden /></span><SeverityBadge severity={preset.severity} /></div>
                  <div className="mt-3 text-[14.5px] font-semibold">{preset.title}</div>
                  <div className="mt-0.5 text-[12.5px] text-muted">{preset.tagline}</div>
                  <dl className="tabular mt-3 grid grid-cols-2 gap-x-2 text-[11.5px] text-muted"><dt>People</dt><dd className="text-right text-ink-2">{num(preset.affectedPopulation)}</dd><dt>Deadline</dt><dd className="text-right text-ink-2">{preset.deadlineHours} h</dd><dt>Budget</dt><dd className="text-right text-ink-2">{inr(preset.budget)}</dd></dl>
                </button>
              </Item>
            );
          })}
        </Stagger>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <Card>
            <CardHeader icon={<FlaskConical size={16} aria-hidden />} title={`Configure: ${selected.title}`} subtitle={selected.description} />
            <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void start(); }} noValidate>
              <Field label="Incident name"><input className={inputClass} value={values.name} onChange={set("name")} maxLength={120} /></Field>
              <Field label="Location"><input className={inputClass} value={values.locationName} onChange={set("locationName")} maxLength={120} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Latitude"><input className={inputClass} inputMode="decimal" value={values.lat} onChange={set("lat")} /></Field>
                <Field label="Longitude"><input className={inputClass} inputMode="decimal" value={values.lng} onChange={set("lng")} /></Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Severity"><select className={inputClass} value={values.severity} onChange={set("severity")}>{["low", "moderate", "high", "critical"].map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
                <Field label="Affected population"><input className={inputClass} inputMode="numeric" value={values.affectedPopulation} onChange={set("affectedPopulation")} /></Field>
                <Field label="Shelters"><input className={inputClass} inputMode="numeric" value={values.shelterCount} onChange={set("shelterCount")} /></Field>
              </div>
              <fieldset className="rounded-lg border border-line p-3">
                <legend className="px-1 text-[12.5px] font-semibold text-ink-2">Required resources</legend>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{RESOURCE_IDS.map((id) => <Field key={id} label={RESOURCES[id].label}><input className={inputClass} inputMode="numeric" value={values[id]} onChange={set(id)} /></Field>)}</div>
              </fieldset>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Budget (INR)"><input className={inputClass} inputMode="numeric" value={values.budget} onChange={set("budget")} /></Field>
                <Field label="Deadline (hours from now)"><input className={inputClass} inputMode="numeric" value={values.deadlineHours} onChange={set("deadlineHours")} /></Field>
              </div>
              {error && <Notice tone="critical">{error}</Notice>}
              <Notice tone="info">The partner sites hold one simulated dataset: four shelters, four suppliers and three carriers around Malda, West Bengal. Every scenario is served by those partners, so a scenario far from Malda shows long routes, and the assessment reports where your declared needs differ from what the shelters themselves request.</Notice>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" type="submit" disabled={!!busy}><Play size={14} aria-hidden />Start simulation</Button>
                {busy && <span className="text-[12.5px] text-muted">A workflow is running; wait for it or pause it.</span>}
              </div>
            </form>
          </Card>

          <div className="grid content-start gap-5">
            <Card tone={running ? "accent" : undefined}>
              <CardHeader
                icon={<Activity size={16} aria-hidden />}
                title={incident ? <span className="inline-flex items-center gap-2">{running && <LiveDot tone="accent" />}{incident.name}</span> : "Simulation progress"}
                subtitle={incident ? <span className="flex flex-wrap items-center gap-2"><Badge>{incident.id}</Badge><SeverityBadge severity={incident.severity} /><span>{incident.location.name}</span></span> : "Start a scenario to watch the agents work through it."}
                actions={incident && <>
                  {running && !paused && <Button size="sm" onClick={() => pauseSimulation(incident.id)}><Pause size={13} aria-hidden />Pause</Button>}
                  {running && paused && <Badge tone="warn">Pausing after the current step…</Badge>}
                  {!running && next && <Button size="sm" variant="primary" onClick={() => resumeSimulation(incident.id)}><Play size={13} aria-hidden />{done ? "Resume" : "Start"}</Button>}
                  <Button size="sm" variant="ghost" disabled={running} onClick={async () => { const result = await resetScenario(incident.id); useUi.getState().notify(result.ok ? "Scenario reset. The incident is kept; its workflow results were cleared." : result.reason!, result.ok ? "ok" : "warn"); }}><RotateCcw size={13} aria-hidden />Reset</Button>
                  <Button size="sm" variant="ghost" onClick={() => navigate(`/incidents/${incident.id}`)}>Open incident</Button>
                </>}
              />
              {incident && run ? (
                <div className="grid gap-4">
                  <div>
                    <div className="mb-1 flex justify-between text-[12.5px]"><span className="font-semibold">{running ? (current ? `Running step ${current.number}: ${current.title} (${current.agent})` : "Running…") : paused ? "Paused" : next ? "Ready to continue" : "Automated steps complete: the plan is waiting for your approval"}</span><span className="tabular text-muted">{done} of {AUTOMATED_STEPS.length} automated steps</span></div>
                    <Meter value={(done / AUTOMATED_STEPS.length) * 100} tone={done === AUTOMATED_STEPS.length ? "ok" : "accent"} />
                  </div>
                  <WorkflowPanel incidentId={incident.id} />
                </div>
              ) : scenarioIncidents.length ? (
                <div className="text-[13px]">
                  <p className="mb-2 text-muted">Earlier scenarios on this site:</p>
                  <ul className="grid gap-1">{scenarioIncidents.map((item) => <li key={item.id}><button type="button" className="rounded-md px-2 py-1 text-left hover:bg-surface-2" onClick={() => { setIncidentId(item.id); useStore.getState().setActiveIncident(item.id); setParams({ scenario: selected.id, incident: item.id }); }}><span className="font-mono text-[12px] text-muted">{item.id}</span> {item.name} <Badge tone={item.status === "closed" ? "neutral" : "ok"}>{item.status}</Badge></button></li>)}</ul>
                </div>
              ) : <p className="text-[13px] text-muted">No scenario running. Configure one on the left and start it.</p>}
            </Card>
            {incident && (
              <>
                <Card><CardHeader icon={<Building2 size={16} aria-hidden />} title="Agents at work" subtitle="Live: an agent pulses while its task runs; links carry particles only while a real request is in flight." /><NetworkGraph compact /></Card>
                <Card><CardHeader title="Activity for this scenario" /><ActivityFeed incidentId={incident.id} limit={12} filterable={false} /></Card>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
