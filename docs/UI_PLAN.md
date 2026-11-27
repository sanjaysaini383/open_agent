# UI improvement plan

Written before the redesign of ReliefMesh Command, after inspecting the whole codebase.
Status of each item is tracked in [TASKS.md](../TASKS.md), "Phase 9".

## What exists

| Area | Found |
| --- | --- |
| Framework | React 18.3, TypeScript, Vite 6, Tailwind CSS 4 (`@theme` tokens in `src/index.css`) |
| State | Zustand 5: `useStore` (persisted, every number on screen derives from it) and `useUi` (volatile dialogs, trace, toast) |
| Routing | `HashRouter`, ten pages, one `ErrorBoundary` per route |
| Design tokens | Light theme only: navy, slate, restrained red/orange, green. Inter named but not loaded |
| Components | `components/ui.tsx` (Badge, Button, Card, Modal, Table, Tabs, Field, Meter, KeyValue, Stat, Empty, Notice), result views, dialogs, map, network graph, activity panel |
| Integrations that must keep working | The official runtime mounted outside React (`#agent-console`), consent / action-review / window-prompt hooks, the workflow engine (`workflow/steps.ts`), execution (`workflow/execution.ts`), `interop/peers.ts`, the page object used by the agents' tools, the persisted state key `reliefmesh-command-v1` the browser tests read |
| Libraries already installed | lucide-react, recharts, leaflet / react-leaflet, zod |

## Decisions

1. **Keep every piece of business logic.** The redesign touches `src/components`, `src/pages`, `src/lib`, `src/index.css` and adds small, pure helpers under `src/workflow` (allocation editing, scenario presets). Domain modules, interop, the runtime bundle in `public/` and the partner sites are untouched.
2. **Semantic tokens, two themes.** Colours become CSS variables for the default teal-glass theme and `html[data-theme="light"]`, exposed to Tailwind through `@theme inline`, so utilities such as `bg-surface` and `text-muted` follow the theme at run time. Legacy classes (`bg-white`, `bg-slate-50`, `text-navy-800`, hard-coded hex) are swept out of every component.
3. **One animation dependency: Framer Motion.** Page transitions, staggered entrances, counters, drawers, toasts and the network graph's particles. Everything respects `prefers-reduced-motion` through `useReducedMotion`, and the CSS fallback keeps durations near zero.
4. **No decorative data.** Metric cards, alerts, the activity feed and the graph read the store. A comparison indicator is a real comparison (allocated against short, verified against checked), never a fabricated trend.
5. **Selectors the browser tests rely on stay.** Button names, headings, tab names and table rows keep their text, so the 24 existing Playwright tests remain the regression suite for the redesign, and four new ones cover the shell, the agent panel, the simulator and the allocation editor.
6. **PDF export is the browser's print of a dedicated report view.** No PDF library; the report page is print-styled and says so.

## Phases

1. Inspect and plan (this file).
2. Design system: tokens, fonts, motion primitives, UI kit (buttons with press and loading feedback, tooltips, skeletons, sortable tables, pagination, breadcrumbs, drawers, command palette, toast stack); application shell with collapsible sidebar, header (incident selector, network status, active agents, notifications, profile, theme toggle).
3. Command Center: metric cards with animated counters, live map, live agent network with click-to-inspect panel, live activity feed, critical alerts.
4. Agent network graph: internal agents and partner networks, animated connections, particles while a request is in flight, pulse on the active agent, status colours from the interaction log.
5. New modules: scenario simulator, allocation editor on the existing engine, supplier marketplace cards with search/filter/sort/compare, logistics control center, trust & security center, analytics with time filters, approval center, command palette, report generator (print to PDF, CSV).
6. Responsive layout and accessibility pass.
7. Run the unit, site, integration and browser suites; fix regressions.
8. Production build; regenerate screenshots; update documentation.
