// The command palette (Ctrl+K / Cmd+K): pages, incidents, agents, pending approvals,
// scenarios and frequent actions, all from the store.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, CornerDownLeft, FlaskConical, Moon, Play, Radar, RotateCcw, Search, Siren, Sun, UserCheck, Users, type LucideIcon } from "lucide-react";
import { NAV } from "@/lib/nav";
import { setConsoleOpen } from "@/lib/boot";
import { usePrefs } from "@/lib/theme";
import { useAlerts } from "@/lib/useAlerts";
import { AGENTS } from "@/state/seed";
import { useStore } from "@/state/store";
import { useUi } from "@/state/ui";
import { SCENARIOS } from "@/workflow/scenarios";
import { AnimatePresence, motion, useMotionOff } from "./motion";
import { Kbd, cx } from "./ui";

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  keywords?: string;
  run: () => void;
}

function matches(command: Command, query: string): boolean {
  if (!query) return true;
  const haystack = `${command.label} ${command.hint || ""} ${command.keywords || ""} ${command.group}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}

export function CommandPalette() {
  const open = useUi((state) => state.paletteOpen);
  const setOpen = useUi((state) => state.setPaletteOpen);
  const incidents = useStore((state) => state.incidents);
  const peers = useStore((state) => state.peers);
  const alerts = useAlerts();
  const theme = usePrefs((state) => state.theme);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const off = useMotionOff();

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => { setOpen(false); navigate(to); };
    const list: Command[] = NAV.map((item) => ({ id: `page:${item.to}`, group: "Pages", label: item.label, hint: item.hint, icon: item.icon, keywords: `go ${item.key}`, run: go(item.to) }));
    for (const incident of incidents) list.push({ id: `incident:${incident.id}`, group: "Incidents", label: incident.name, hint: `${incident.id} · ${incident.severity} · ${incident.status}`, icon: Siren, keywords: incident.location.name, run: () => { setOpen(false); useStore.getState().setActiveIncident(incident.id); navigate(`/incidents/${incident.id}`); } });
    for (const agent of AGENTS) list.push({ id: `agent:${agent.name}`, group: "Agents", label: agent.name, hint: agent.role, icon: Bot, keywords: "reliefmesh command agent", run: () => { setOpen(false); useUi.getState().setInspectAgent(agent.name); } });
    for (const peer of Object.values(peers)) for (const agent of peer.discovery?.agents ?? []) list.push({ id: `agent:${peer.id}:${agent.name}`, group: "Agents", label: agent.name, hint: `${peer.label} · ${agent.description}`, icon: Users, keywords: `partner ${peer.role}`, run: () => { setOpen(false); useUi.getState().setInspectAgent(agent.name); } });
    for (const alert of alerts.filter((item) => item.category === "approval" || item.category === "request")) list.push({ id: `approval:${alert.id}`, group: "Pending approvals", label: alert.title, hint: alert.detail, icon: UserCheck, run: go(alert.to) });
    for (const scenario of SCENARIOS) list.push({ id: `scenario:${scenario.id}`, group: "Simulations", label: `Start simulation: ${scenario.title}`, hint: `${scenario.kind} · ${scenario.location.name}`, icon: FlaskConical, run: go(`/simulator?scenario=${scenario.id}`) });
    list.push(
      { id: "action:discover", group: "Actions", label: "Discover partner networks", hint: "Load each partner's public manifest and network", icon: Radar, run: go("/network?discover=1") },
      { id: "action:console", group: "Actions", label: "Open the agent console", hint: "Talk to EmergencyCommanderAgent with your own model key", icon: Bot, run: () => { setOpen(false); setConsoleOpen(true); } },
      { id: "action:theme", group: "Actions", label: theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme", icon: theme === "dark" ? Sun : Moon, run: () => { usePrefs.getState().toggleTheme(); setOpen(false); } },
      { id: "action:start", group: "Actions", label: "Start or continue the coordination workflow", hint: "Runs the next automated step of the active incident", icon: Play, run: go(`/incidents/${useStore.getState().activeIncidentId ?? ""}?run=1`) },
      { id: "action:reset", group: "Actions", label: "Reset the demonstration", hint: "Restores the preloaded scenario on this site", icon: RotateCcw, run: go("/settings?reset=1") },
    );
    return list;
  }, [incidents, peers, alerts, theme, navigate, setOpen]);

  const shown = useMemo(() => commands.filter((command) => matches(command, query)).slice(0, 40), [commands, query]);
  const groups = useMemo(() => {
    const map = new Map<string, Command[]>();
    for (const command of shown) map.set(command.group, [...(map.get(command.group) || []), command]);
    return [...map.entries()];
  }, [shown]);

  useEffect(() => { if (open) { setQuery(""); setIndex(0); window.setTimeout(() => inputRef.current?.focus(), 20); } }, [open]);
  useEffect(() => { setIndex(0); }, [query]);
  useEffect(() => {
    if (!open) return;
    const item = document.querySelector<HTMLElement>(`[data-palette-index="${index}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [index, open]);

  if (!open) return null;
  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setIndex((value) => Math.min(shown.length - 1, value + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setIndex((value) => Math.max(0, value - 1)); }
    else if (event.key === "Enter") { event.preventDefault(); shown[index]?.run(); }
    else if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
  };

  let position = -1;
  return (
    <AnimatePresence>
      <motion.div key="backdrop" className="fixed inset-0 z-[70] bg-[var(--backdrop)] backdrop-blur-[2px]" initial={off ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
      <motion.div
        key="panel"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="glass-strong fixed left-1/2 top-[12vh] z-[71] w-[min(94vw,640px)] -translate-x-1/2 overflow-hidden rounded-xl border border-line-strong text-ink shadow-pop"
        initial={off ? false : { opacity: 0, scale: 0.97, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={off ? undefined : { opacity: 0, scale: 0.98, y: -4 }}
        transition={{ duration: 0.18 }}
        onKeyDown={onKey}
      >
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search size={16} className="text-faint" aria-hidden />
          <input ref={inputRef} role="combobox" aria-expanded aria-controls="palette-list" aria-activedescendant={shown[index] ? `palette-${shown[index].id}` : undefined} className="h-12 w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-faint" placeholder="Search pages, incidents, agents, approvals, actions…" value={query} onChange={(event) => setQuery(event.target.value)} />
          <Kbd>Esc</Kbd>
        </div>
        <div id="palette-list" role="listbox" className="scroll-thin max-h-[52vh] overflow-y-auto p-2">
          {groups.length ? groups.map(([group, items]) => (
            <div key={group} className="mb-1">
              <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-faint">{group}</div>
              {items.map((command) => {
                position += 1;
                const current = position === index;
                const Icon = command.icon;
                return (
                  <div
                    key={command.id}
                    id={`palette-${command.id}`}
                    role="option"
                    aria-selected={current}
                    data-palette-index={position}
                    onMouseEnter={() => setIndex(position)}
                    onClick={command.run}
                    className={cx("flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2", current ? "bg-accent-soft text-ink" : "text-ink-2")}
                  >
                    <Icon size={15} className={cx("shrink-0", current ? "text-accent-text" : "text-muted")} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium">{command.label}</span>
                      {command.hint && <span className="block truncate text-[12px] text-muted">{command.hint}</span>}
                    </span>
                    {current && <CornerDownLeft size={13} className="text-faint" aria-hidden />}
                  </div>
                );
              })}
            </div>
          )) : <p className="px-3 py-6 text-center text-[13px] text-muted">Nothing matches “{query}”.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-line bg-surface-2 px-4 py-2 text-[11.5px] text-muted">
          <span className="inline-flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
          <span className="inline-flex items-center gap-1"><Kbd>↵</Kbd> open</span>
          <span className="inline-flex items-center gap-1"><Kbd>?</Kbd> all shortcuts</span>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
