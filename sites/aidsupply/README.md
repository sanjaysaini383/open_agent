# AidSupply Network

An independent agentic website: a marketplace where NGOs and suppliers list relief stock,
prices and delivery terms. It is one of the five sites of the
[ReliefMesh](../../README.md) demonstration and follows the
[Open Agentic Web MVP specification](../../docs/worldwide_agentic_web_mvp_spec.md).

**All data is simulated demonstration data.** No real supplier, stock level, price or
registration is shown.

## What it does

- Lists organisations (NGOs and commercial suppliers) with what they declared.
- Publishes offers: resource, quantity available, unit price, minimum order, lead time.
- Prices non-binding quotes under a deterministic volume and relief-rate policy.
- Holds stock for a coordinating site, after a person here confirms the reservation.

AidSupply **never says a supplier is verified**. Every directory entry is marked
`selfDeclared: true`. Verification is TrustRegistry's job.

## Run it

Static site, no build step, no dependencies. From the repository root:

```shell
node vendor/agentify-website/scripts/serve_site.mjs sites/aidsupply --port 8082 --open-as localhost
```

Open http://localhost:8082/. `npm run serve` at the repository root starts all five sites.

## Agent network

| | |
| --- | --- |
| Network URL | `http://localhost:8082/aidsupply` |
| Front agent | `SupplierOfferAgent` |
| Specialists | `SupplierInventoryAgent`, `SupplierNegotiationAgent` |
| Source of truth | [`aidsupply.hocon`](aidsupply.hocon) → `aidsupply.network.json` (generated) |
| Manifest | [`agent-manifest.json`](agent-manifest.json) |

The assistant on the page runs in the visitor's browser with the visitor's own LLM key
(⚙ AI model settings). It sends the visitor's messages, and the page data it reads, to the
provider the visitor picks. To stop using a key: **Delete setup** under Advanced settings,
then close the tab.

### Actions

| Action | Effect | On the page | Shared with partner sites |
| --- | --- | --- | --- |
| `get_supplier_directory` | read | yes | yes, hidden frame |
| `get_supplier_offers` | read | yes | yes, hidden frame |
| `request_improved_offer` | read (non-binding quote) | yes | yes, hidden frame |
| `get_reservations` | read | yes | yes, hidden frame |
| `publish_offer` | write | yes | no |
| `update_offer_stock` | write | yes | no |
| `register_supplier` | irreversible (confirmation dialog) | yes | no |
| `reserve_allocation` | irreversible | no | yes, in an AidSupply window where a person confirms |

Shared actions are limited to the exact origins in [`js/site-links.js`](js/site-links.js)
(`CALLERS`). The write is never shared with `"*"`. The four shared reads take the same
input as the page's own actions: both use [`js/action-schemas.js`](js/action-schemas.js).

The interface other sites may rely on is section 2 of
[`docs/INTEROP_CONTRACTS.md`](../../docs/INTEROP_CONTRACTS.md).

### Pricing policy

One module, [`js/pricing.js`](js/pricing.js), prices the page's quote calculator, the
`request_improved_offer` read and the `reserve_allocation` write, so they cannot disagree.

```text
tierPct      = quantity >= 1000 ? 8 : quantity >= 500 ? 5 : quantity >= 200 ? 2 : 0
reliefPct    = supplier.type == "ngo" ? 2 : 0
standardPct  = min(tierPct + reliefPct, offer.maxDiscountPct)
standard     = round2(listUnitPrice * (1 - standardPct / 100))
floor        = round2(listUnitPrice * (1 - offer.maxDiscountPct / 100))

no target, or target >= standard   -> quoted = standard
floor <= target < standard         -> quoted = round2((standard + target) / 2)
target < floor                     -> quoted = standard

lowestAcceptable(quantity) = round2((standard + floor) / 2)
```

`reserve_allocation` accepts a line only if its unit price is at least
`lowestAcceptable(quantity)`, its quantity is at least the minimum order and at most what
is available, and the offer appears on one line only. A request is all-or-nothing: one
refused line reserves nothing. `maxDiscountPct` is the supplier's private limit and no
read returns it.

A quote reserves nothing and commits nobody. Only a reservation holds stock, and it takes
no payment.

### Untrusted supplier text

An offer's `notes` is free text written by the supplier. The seed includes one
deliberately hostile note (`OFF-D-FOOD`), so that sites calling AidSupply can show they
treat partner text as data. This page always renders notes as plain text.

## Linked site

- **TrustRegistry** — `http://localhost:8083/trustregistry`. The assistant can ask it
  whether an organisation is verified, by organisation id.
- Before anything is sent, the visitor sees a consent card with the partner's name, its
  host and the first 140 characters of the request. **Always allow** skips the card for
  that host until the page is reloaded.
- A request contains an organisation id or name from the directory. The assistant is told
  never to put names of people, emails, phone numbers or booking codes in it; the runtime
  does not filter it, so the visitor checks it on the card.
- The partner's network runs in this browser on the visitor's key, with only the actions
  the partner's bridge shares with this site. A call costs more than the card's estimate.

Other agent sites that call this network get no page tools: only the four shared reads
and, for ReliefMesh Command, the reservation in AidSupply's own window. Their visitor
also gets a consent card when this network asks TrustRegistry.

## State and static hosting

State lives in this origin's `localStorage` (key `aidsupply-state-v1`). A partner site
reads it through a hidden frame on this origin. Browsers partition a frame's storage when
the embedding site is on a different registrable domain, so a partner there sees the
published seed plus its own partition rather than edits made on this page, and a
reservation confirmed in AidSupply's window shows on this page but not to that frame.
Sites on the same registrable domain (all `localhost` ports locally, or subdomains of one
domain) share it. A production deployment would keep this state on AidSupply's own server.

Offer validity rolls: `validUntil` is always 72 hours after the read, so the
demonstration never opens on expired offers.

## Files

```text
index.html, styles.css, favicon.svg   the page
js/supply-data.js                     simulated seed data and the resource catalogue
js/pricing.js                         the pricing policy, as pure functions
js/supply-store.js                    business rules and storage (no DOM)
js/action-schemas.js                  input schemas shared by the page's and the bridge's reads
js/app.js                             the page; exports App.page
js/site-links.js                      partner addresses and allowed caller origins
site-actions.js                       the page's actions (website_* tools)
site.js                               mounts the assistant, with the confirmation dialog
bridge/bridge-actions.js              the reads shared with partner sites
bridge/reservation-window.js          the shared write, confirmed in this site's window
bridge/action-bridge.html, bridge/agent-manifest.json   generated by the official build
aidsupply.hocon                       the agent network (source of truth)
aidsupply.network.json, agent-mcp.json, .well-known/   generated; do not edit
agent-manifest.json, links.json       public bundle files
runtime/                              the official browser runtime, unchanged
tests/aidsupply.test.mjs              Node tests (rules, pricing, actions against the manifest)
tests/browser/bridge-check.mjs        browser check of the page's forms and the action bridge
_headers, vercel.json                 static-hosting headers (CORS on public agent files)
```

## Check it

```shell
node vendor/agentify-website/scripts/build_network.mjs sites/aidsupply/aidsupply.hocon --manifest sites/aidsupply/agent-manifest.json --check
node --test "sites/aidsupply/tests/*.test.mjs"
node vendor/agentify-website/scripts/check_partner.mjs http://localhost:8082/aidsupply --origin http://localhost:8080
```

With the site served on port 8082 and port 8080 free, a browser check exercises the page's
forms and the action bridge the way a calling site uses it (the official runtime's
`ActionBridgeClient` from a stand-in page on `http://localhost:8080`): the catalogue, the
shared reads, the reservation confirmed, declined and refused in AidSupply's own window,
and an unlisted origin that gets nothing. It needs Chrome and the repository's
`@playwright/test`.

```shell
node sites/aidsupply/tests/browser/bridge-check.mjs
```
