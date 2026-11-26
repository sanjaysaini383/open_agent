# TrustRegistry

An independent agentic website for agent identity and verification. It is one of the five
sites of the [ReliefMesh](../../README.md) demonstration and follows the
[Open Agentic Web MVP specification](../../docs/worldwide_agentic_web_mvp_spec.md).

**What is simulated and what is real**

- **Simulated:** the registry's authority, every record, every credential, every
  reputation figure and every seeded report. No real organisation, licence or regulator
  is described.
- **Real:** the cryptography. Every statement the registry makes about a subject is signed
  with ECDSA P-256 / SHA-256, and anyone can verify it with the published key. The page
  itself re-checks every signature in your browser each time it renders.

## What it does

- Keeps identity records for agent networks and organisations.
- Publishes a signed attestation for each record: status, credentials and, for an agent
  network, its URL, its declared capabilities and the SHA-256 of its published network file.
- Reports each credential as valid, expired or revoked.
- Keeps reputation history (completed jobs, disputes, fulfilment rate, recent events).
- Suspends, revokes and reinstates subjects (live status).
- Takes suspicious-agent reports, from its own page or, confirmed by a person in a
  TrustRegistry window, from a partner agent site.

## Run it

Static site, no build step, no dependencies. From the repository root:

```shell
node vendor/agentify-website/scripts/serve_site.mjs sites/trustregistry --port 8083 --open-as localhost
```

Open http://localhost:8083/. `npm run serve` at the repository root starts all five sites.

## Agent network

| | |
| --- | --- |
| Network URL | `http://localhost:8083/trustregistry` |
| Front agent | `IdentityVerificationAgent` |
| Specialists | `CredentialAgent`, `ReputationAgent` |
| Source of truth | [`trustregistry.hocon`](trustregistry.hocon) → `trustregistry.network.json` (generated) |
| Manifest | [`agent-manifest.json`](agent-manifest.json) |
| Calls other networks | None. `allowed_peers` is empty: a registry is called, it does not call. |

The assistant on the page runs in the visitor's browser with the visitor's own LLM key
(⚙ AI model settings). It sends the visitor's messages, and the page data it reads, to the
provider the visitor picks. To stop using a key: **Delete setup** under Advanced settings,
then close the tab.

### Actions

| Action | Effect | On the page | Shared with partner sites |
| --- | --- | --- | --- |
| `get_registry_info` | read | yes | yes, hidden frame |
| `verify_agent` | read | yes | yes, hidden frame |
| `verify_organization` | read | yes | yes, hidden frame |
| `get_reputation` | read | yes | yes, hidden frame |
| `set_subject_status` | irreversible (confirmation dialog) | yes | no |
| `register_subject` | irreversible (confirmation dialog) | yes | no |
| `report_suspicious_agent` | irreversible | no (the page has its own form) | yes, in a TrustRegistry window where a person confirms |

Shared actions are limited to the exact origins in [`js/site-links.js`](js/site-links.js)
(`CALLERS`: ReliefMesh Command and AidSupply). The write is never shared with `"*"`. The
four reads have one definition, in [`js/action-schemas.js`](js/action-schemas.js), used by
both the page and the bridge, so they cannot drift apart.

Other agent sites that run this network get only those shared actions; with none of them
(an origin that is not listed) the assistant can only say what the registry offers and
point to this page.

### What a look-up returns

`verify_agent` and `verify_organization` return the shape in
[`docs/INTEROP_CONTRACTS.md`](../../docs/INTEROP_CONTRACTS.md) §3:
`found`, `subjectId`, `record`, `attestation {payload, signature, kid}`, `reputation`,
`reports {open, items}`. They add four convenience fields for agents, which cannot check
dates or signatures themselves:

| Field | Meaning |
| --- | --- |
| `effectiveStatus` | The status to act on: the worse of the live and the attested status. `unregistered` when there is no record, `pending` when there is no attestation. |
| `credentials[]` | Each credential with a `state`: `valid`, `expired`, `revoked` or `not_yet_valid`. |
| `checkedOn` | The date the states were worked out for. |
| `signatureCheck` | This site's own check of the signature (`valid`, `invalid`, `none`). A caller should verify it independently. |

- **A network is looked up by its full URL.** The right name at another address
  (`https://elsewhere.example/aidsupply`) is not a match, and the result says so.
- **No record means unverified**, not trusted. A subject with no record can still have
  open reports (`ORG-SUP-D` in the seed).
- **A report is an allegation.** It is shown with the subject and never changes a status.

## Signatures

| | |
| --- | --- |
| Algorithm | ECDSA, curve P-256, SHA-256 |
| What is signed | The UTF-8 bytes of the payload's canonical JSON: object keys sorted at every level, no whitespace, integers only |
| Signature format | IEEE P1363 (`r ‖ s`, 64 bytes), base64url without padding: WebCrypto's native form |
| Key fingerprint | `sha256:` + hex SHA-256 of `{"crv":"P-256","kty":"EC","x":"…","y":"…"}` |
| Published files | [`trust-keys.json`](trust-keys.json), [`attestations.json`](attestations.json) |

The whole scheme is [`js/canonical.js`](js/canonical.js): one dependency-free module that
runs unchanged in browsers and Node 22+.

```js
import { verifyAttestation } from "./js/canonical.js";

const outcome = await verifyAttestation(entry, keysDoc, { expectedSubjectId: "net:aidsupply", now: new Date() });
// { valid, signatureValid, reason, kid, fingerprint, expired }
```

A careful caller does four things:

1. Verifies the signature against the registry key, and pins the key's fingerprint the
   first time it sees it.
2. Checks that the payload is for the subject it asked about (`expectedSubjectId`).
3. For an agent network, hashes the network file it actually fetched and compares it with
   `payload.networkDigest`, and compares the URL it called with `payload.networkUrl`.
4. Takes the worse of `record.status` (live) and `payload.status` (attested), and checks
   `payload.expiresAt`.

### Signing (offline)

```shell
npm run trust:sign                       # node scripts/sign-trust.mjs
node scripts/sign-trust.mjs --verify     # verify the published files; needs no private key
node scripts/sign-trust.mjs --force      # re-issue every attestation
```

The private key is created on first use in `.keys/registry-private.jwk`, which is
git-ignored and never printed. Signing is idempotent: an attestation whose content has not
changed is kept byte for byte, so a rebuild that changes nothing changes no published file.
Re-run it whenever a site's network file, its manifest's `reliefmesh.capabilities` or the
origins profile changes (`npm run build` does). A clone without the private key gets a new
key on its first signing; callers that pinned the old fingerprint are then warned, which
is what pinning is for.

The page cannot sign. A subject registered on the page is `pending` and has no attestation;
a status changed on the page is the registry's live status, and can never be better than
the signed attestation says.

## State and static hosting

Live state (status changes, pending subjects, reports) is in this origin's `localStorage`.
A partner site reads it through a hidden frame on this origin. Browsers partition a frame's
storage when the embedding site is on a different registrable domain, so a partner there
sees the published seed plus its own partition rather than changes made on this page.
Sites on the same registrable domain (all `localhost` ports locally, or subdomains of one
domain) share it. The signed files are static and identical for everyone. A production
registry would keep its live state, and its signing key, on its own server.

## Files

```text
index.html, styles.css, favicon.svg   the page
js/registry-data.js                   simulated seed: subjects, credentials, reputation, reports
js/canonical.js                       canonical JSON, fingerprint, signature verification
js/registry-store.js                  business rules and storage (no DOM)
js/action-schemas.js                  the reads' names, descriptions and inputs (page and bridge)
js/app.js                             the page; exports App.page
js/site-links.js                      the other sites' addresses and allowed caller origins
site-actions.js                       the page's actions (website_* tools)
site.js                               mounts the assistant, with the confirmation dialogs
bridge/bridge-actions.js              the reads shared with partner sites
bridge/report-window.js               the shared write, confirmed in this site's window
bridge/action-bridge.html, bridge/agent-manifest.json   generated by the official build
trust-keys.json, attestations.json    generated by scripts/sign-trust.mjs; do not edit
trustregistry.hocon                   the agent network (source of truth)
trustregistry.network.json, agent-mcp.json, .well-known/   generated; do not edit
agent-manifest.json, links.json       public bundle files
runtime/                              the official browser runtime, unchanged
tests/                                Node tests
_headers, vercel.json                 static-hosting headers (CORS on public agent files)
.keys/                                the private signing key (git-ignored)
```

## Check it

```shell
node vendor/agentify-website/scripts/build_network.mjs sites/trustregistry/trustregistry.hocon --manifest sites/trustregistry/agent-manifest.json --check
node scripts/sign-trust.mjs --verify
node --test "sites/trustregistry/tests/*.test.mjs"
node vendor/agentify-website/scripts/check_partner.mjs http://localhost:8083/trustregistry --origin http://localhost:8080
```
