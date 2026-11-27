# Tasks

Implementation checklist for ReliefMesh. `[x]` done and verified, `[ ]` not done.
Verification for each area is in [COMPLIANCE_REPORT.md](COMPLIANCE_REPORT.md).

## Phase 1 — Research and architecture

- [x] Clone and read the official repository: MVP specification, README, agentify-website
      skill and its references (linking, site actions, network design, hosting)
- [x] Read the runtime source: engine, runner, action transport, actions, kernel, trace
- [x] Read the official build, serve and partner-check scripts and the linked examples
- [x] Decide the architecture: five independent sites, official runtime unmodified, no backend
- [x] Define each site's public interface ([docs/INTEROP_CONTRACTS.md](docs/INTEROP_CONTRACTS.md))
- [x] Document decisions ([ARCHITECTURE.md](ARCHITECTURE.md))

## Phase 2 — Core infrastructure

- [x] Vendor the official skill unmodified; copy the runtime into every site; integrity check
- [x] Five independent project directories on separate local origins
- [x] `agent-manifest.json`, `.hocon` and generated network JSON for every site
- [x] Every site passes the official `build_network.mjs --check` with no warnings
- [x] CORS on public agent files only; hosting header files for Netlify, Cloudflare, Vercel
- [x] Site actions registered on every site; shared reads and writes on every bridge
- [x] Origin profiles and a script to move the sites between origins

## Phase 3 — Agent system

- [x] Main network: EmergencyCommanderAgent, NeedAssessmentAgent, DiscoveryAgent,
      TrustVerificationAgent, SupplierMatchingAgent, NegotiationAgent,
      ResourceAllocationAgent, LogisticsAgent, RiskAnalysisAgent, AuditAgent
- [x] ShelterConnect: ShelterStatusAgent, ShelterRequestAgent, ShelterInventoryAgent
- [x] AidSupply: SupplierOfferAgent, SupplierInventoryAgent, SupplierNegotiationAgent
- [x] TrustRegistry: IdentityVerificationAgent, CredentialAgent, ReputationAgent
- [x] RouteBridge: RoutePlanningAgent, TransportDiscoveryAgent, ShipmentTrackingAgent
- [x] Partner network connections by URL, with `allowed_peers` and consent-card labels
- [x] Discovery from public manifests; publisher registry; person-registered partners
- [x] NANDA Index: live search of the public API, labelled separately from the local list
- [x] Trust checks: signed attestations, key pinning, network digests, evidence scoring
- [x] Consent before every contact; human approval before every write

## Phase 4 — Business logic

- [x] Incident create, edit, close, reopen
- [x] Needs assessment with documented priority scoring
- [x] Supplier marketplace: offers, comparison, eligibility, suspicious-offer flags
- [x] Negotiation: non-binding quotes tied to exact quantities, re-quote on change
- [x] Allocation engine with fairness, budget, minimum orders and an invariant checker
- [x] Logistics: route estimates, transport options, vehicle assignment, feedback into allocation
- [x] Risk analysis and what-if scenarios
- [x] Shipment status state machine; delivery receipts at the shelter
- [x] Hash-chained audit log; incident report and audit exports

## Phase 5 — Frontend

- [x] Command Center, Incidents, Resource Requests, Agent Network, Supplier Marketplace,
      Logistics, Trust & Verification, Analytics, Audit Trail, Settings
- [x] Interactive map: incident, shelters, suppliers, transport bases, routes, flood zones
- [x] Live network visualisation driven by real interactions
- [x] Agent activity panel with expandable technical trace
- [x] Agent Network Explorer and an interoperability test
- [x] Consent, approval, partner-window and override dialogs
- [x] Guided demonstration and one-click Reset demo
- [x] Partner sites: working pages with forms, tables, assistant and reset
- [x] Responsive layout; labelled form fields; error boundary

## Phase 6 — Testing

- [x] Unit: allocation, supplier matching, trust scoring, request validation, shipment
      transitions, negotiation, logistics, audit, signatures, approval digest (82)
- [x] Site tests for the four partner sites (100)
- [x] Integration: Command to each partner, call paths, CORS, attestations (36)
- [x] Browser: incident creation, discovery, resource request, supplier comparison,
      allocation approval, shipment tracking, consent, policy, model-driven path (24)
- [x] Official `build_network.mjs --check`, `serve_site.mjs`, `check_partner.mjs` on every site
- [x] Generated compliance report
- [ ] Tests against deployed public URLs from another origin (needs a deployment)

## Phase 7 — Deployment

- [x] Production build of Command; static partner sites need none
- [x] Hosting configuration and exact deployment commands ([DEPLOYMENT.md](DEPLOYMENT.md))
- [x] CI workflow for the official checks and tests
- [ ] Deploy the five sites to separate HTTPS origins — **needs hosting credentials**
- [ ] Verify public URLs, CORS and cross-origin calls on the deployment
- [ ] List the sites in the agentic-web directory and the NANDA Index (owner's decision)

## Phase 8 — Hackathon submission

- [x] Project description and architecture explanation ([HACKATHON_SUBMISSION.md](HACKATHON_SUBMISSION.md))
- [x] Screenshots, generated from a real run (`docs/screenshots/`)
- [x] Demonstration script under two minutes ([DEMO_GUIDE.md](DEMO_GUIDE.md))
- [x] Technical details and the community contribution (Interoperability Inspector)
- [ ] Record a demo video (needs a person)
- [ ] Submit on Devpost with the deployed URLs (needs the account owner)

## Phase 9 — Interface redesign (command centre)

- [x] Plan from an inspection of the codebase ([docs/UI_PLAN.md](docs/UI_PLAN.md))
- [x] Design system: semantic tokens, teal glass (default) and whitish themes, Inter and JetBrains
      Mono, UI kit with press and loading feedback, tooltips, skeletons, sortable tables,
      pagination, breadcrumbs, drawers, segmented controls, toast stack
- [x] Motion with Framer Motion: page transitions, staggered entrances, animated counters,
      drawers, alerts, toasts; `prefers-reduced-motion` respected
- [x] Shell: collapsible sidebar, header with incident selector, partner and agent status,
      model chip, alert bell, theme toggle, profile menu; command palette (Ctrl+K);
      keyboard shortcuts
- [x] Command Center: metric cards with real comparisons, live map, live agent network with
      click-to-inspect panel, live activity feed, critical alerts
- [x] Agent network graph: internal agents and partner networks, particles while a request
      is in flight, pulse on the active agent, outcome colours, agent details panel
- [x] Scenario simulator with five presets, start, pause, resume, reset
- [x] Agent Network Explorer: last successful interaction, communication errors, connectivity
      test, manifest inspection, partner registration on the page
- [x] Allocation page with the interactive editor and what-if weights on the existing engine
- [x] Supplier marketplace cards with search, filters, sorting and side-by-side comparison
- [x] Logistics control center with shipment filters, ETA, status transitions, animated routes
- [x] Trust & security center with expired credentials, suspicious activity, profiles, history
- [x] Analytics with response time, fulfilment, delivery time, supplier performance, shelter
      coverage, communication success rate, time windows, latency chart
- [x] Approval Center for plans, supplier selections, external writes, receipts, requests
- [x] Incident report page: print to PDF, Markdown, JSON, allocation and shipment CSV
- [x] Responsive layout and accessibility pass (labels, roles, focus, keyboard dismissal)
- [x] All existing suites pass against the redesign

## Definition of done

- [x] Main application runs
- [x] All five independent websites implemented
- [x] Every website exposes its public agent manifest and network definition
- [x] Official browser runtime integrated, unmodified
- [x] User-controlled model configuration works
- [x] Independent networks communicate across origins
- [x] A complete multi-network emergency workflow works
- [x] Trust and verification features work
- [x] Resource allocation produces testable results
- [x] Human approval gates work
- [x] Dashboard fully functional
- [x] Audit history works
- [x] Interoperability Inspector works
- [x] Automated tests pass
- [x] Official compliance scripts pass
- [x] Production deployment prepared
- [ ] Public deployment verified — not possible without deployment credentials
- [x] Documentation and submission materials complete
