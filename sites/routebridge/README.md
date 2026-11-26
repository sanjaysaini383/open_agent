# RouteBridge

An independent agentic website for emergency logistics coordination. It is one of the five
sites of the [ReliefMesh](../../README.md) demonstration and follows the
[Open Agentic Web MVP specification](../../docs/worldwide_agentic_web_mvp_spec.md).

**All data is simulated demonstration data.** No real transport provider, vehicle, route
or shipment is shown, and no vehicle is ever dispatched.

## What it does

- Registers transport providers and publishes their vehicle availability and capacity.
- Estimates route distances and delivery times, and flags flood zones on the way.
- Ranks every provider's option to move a load, with alternatives.
- Books shipments for a coordinating site, confirmed by a person here, and tracks their
  status through a fixed set of transitions.

## Run it

Static site, no build step, no dependencies. From the repository root:

```shell
node vendor/agentify-website/scripts/serve_site.mjs sites/routebridge --port 8084 --open-as localhost
```

Open http://localhost:8084/. `npm run serve` at the repository root starts all five sites.

## Agent network

| | |
| --- | --- |
| Network URL | `http://localhost:8084/routebridge` |
| Front agent | `RoutePlanningAgent` |
| Specialists | `TransportDiscoveryAgent`, `ShipmentTrackingAgent` |
| Source of truth | [`routebridge.hocon`](routebridge.hocon) → `routebridge.network.json` (generated) |
| Manifest | [`agent-manifest.json`](agent-manifest.json) |

The assistant on the page runs in the visitor's browser with the visitor's own LLM key
(⚙ AI model settings). It sends the visitor's messages, and the page data it reads, to the
provider the visitor picks. To stop using a key: **Delete setup** under Advanced settings,
then close the tab.

### Actions

| Action | Effect | On the page | Shared with partner sites |
| --- | --- | --- | --- |
| `get_transport_providers` | read | yes | yes, hidden frame |
| `get_transport_options` | read | yes | yes, hidden frame |
| `estimate_routes` | read | yes | yes, hidden frame |
| `get_shipment_status` | read | yes | yes, hidden frame |
| `register_provider` | irreversible (confirmation dialog) | yes | no |
| `update_fleet_availability` | write | yes | no |
| `update_shipment_status` | write | yes | no |
| `create_shipments` | irreversible | no | yes, in a RouteBridge window where a person confirms |

Shared actions are limited to the exact origins in [`js/site-links.js`](js/site-links.js)
(`CALLERS`). The write is never shared with `"*"`. A read has one name, one input schema
and one description on the page and on the bridge: both come from
[`js/route-schemas.js`](js/route-schemas.js). The full contract, with result shapes, is in
[`docs/INTEROP_CONTRACTS.md`](../../docs/INTEROP_CONTRACTS.md), section 4.

## Routing model

Deterministic, and the same code answers the page, the assistant and partner sites
([`js/routing.js`](js/routing.js)):

```text
roadKm(a, b)   = round1(haversineKm(a, b) × 1.32)
vehiclesNeeded = ceil(weightKg / capacityKg)
available      = fleet count − vehicles on shipments that are planned, dispatched, in_transit or delayed
zone           = the first flood zone whose circle contains the destination
feasible       = vehiclesNeeded ≤ available, and not (zone is boats_only and the vehicle is not flood-capable)
etaHours       = round1((deadheadKm + haulKm) / avgSpeedKmh + 1 loading hour + zone delay)
cost           = round((deadheadKm × 0.5 + haulKm) × ratePerKm × vehicles)
```

Options are sorted feasible first, then by time, then by cost.

### Routing source

By default distances come from the **demonstration dataset** above, and every result says
`routeSource: "demo-dataset"`. They are estimates, not live routing.

An operator can turn on a real routing service in the page's **Routing source** panel by
entering the base URL of an OSRM-compatible server. RouteBridge then asks
`<base URL>/route/v1/driving/<lng>,<lat>;<lng>,<lat>?overview=false` for each distance and
labels those results `"osrm"`. Turning it on **sends the coordinates of every route asked
for here, by a visitor or by a partner agent site, to that third-party service**, so it is
off unless someone here chooses it. If the service does not answer, the demonstration
distance is used for that leg, the result is labelled `"demo-dataset"` and carries an
advisory. Speeds, loading time, zone delays and rates always come from RouteBridge.

## Shipment statuses

```text
planned    -> dispatched | cancelled
dispatched -> in_transit | cancelled
in_transit -> delivered | delayed | failed
delayed    -> in_transit | delivered | failed
delivered, cancelled, failed are final
```

Any other change is refused with the reason. A shipment reference is booked at most once
per incident; a cancelled one may be booked again.

## Linked site

- **ShelterConnect** — `http://localhost:8081/shelterconnect`. The assistant can ask it for
  shelter locations, head counts and urgency.
- Before anything is sent, the visitor sees a consent card with the partner's name, its
  host and the first 140 characters of the request. **Always allow** skips the card for
  that host until the page is reloaded.
- A request contains only route-level facts. The assistant is told never to put names,
  emails, phone numbers or booking codes in it; the runtime does not filter it, so the
  visitor checks it on the card.
- The partner's network runs in this browser on the visitor's key, with only the actions
  the partner's bridge shares with this site. A call costs more than the card's estimate.

Other agent sites that call RouteBridge's network get only the actions above marked
"shared". A calling site's visitor also gets a consent card for ShelterConnect when this
network asks it.

## State and static hosting

State lives in this origin's `localStorage` (`routebridge-state-v1`): providers, fleets,
shipments and the routing source. A partner site reads it through a hidden frame on this
origin. Browsers partition a frame's storage when the embedding site is on a different
registrable domain, so a partner there sees the published seed plus its own partition
rather than bookings and edits made on this page. Sites on the same registrable domain
(all `localhost` ports locally, or subdomains of one domain) share it. A production
deployment would keep this state on RouteBridge's own server.

## Files

```text
index.html, styles.css, favicon.svg   the page
js/route-data.js                      simulated seed data: providers, fleets, flood zones, catalogues
js/routing.js                         the routing model and the router adapters (demo dataset, OSRM)
js/route-store.js                     business rules and storage (no DOM)
js/route-schemas.js                   the reads' input schemas and descriptions, shared by page and bridge
js/app.js                             the page; exports App.page
js/site-links.js                      partner addresses and allowed caller origins
site-actions.js                       the page's actions (website_* tools)
site.js                               mounts the assistant, with the confirmation dialog
bridge/bridge-actions.js              the reads shared with partner sites
bridge/shipment-window.js             the shared write, confirmed in this site's window
bridge/action-bridge.html, bridge/agent-manifest.json   generated by the official build
routebridge.hocon                     the agent network (source of truth)
routebridge.network.json, agent-mcp.json, .well-known/   generated; do not edit
agent-manifest.json, links.json       public bundle files
runtime/                              the official browser runtime, unchanged
tests/routebridge.test.mjs            Node tests
tests/bridge-browser-check.mjs        optional browser check of the bridge and the booking window
_headers, vercel.json                 static-hosting headers (CORS on public agent files)
```

## Check it

```shell
node vendor/agentify-website/scripts/build_network.mjs sites/routebridge/routebridge.hocon --manifest sites/routebridge/agent-manifest.json --check
node --test "sites/routebridge/tests/*.test.mjs"
node vendor/agentify-website/scripts/check_partner.mjs http://localhost:8084/routebridge --origin http://localhost:8080
```

With the site served on port 8084, `node sites/routebridge/tests/bridge-browser-check.mjs`
opens Chrome as a page on `http://localhost:8080`, loads RouteBridge's bridge the way a
calling site's runtime does, runs a shared read in the hidden frame, books a shipment
through the confirmation window, and checks that an origin that is not listed gets no
actions.
