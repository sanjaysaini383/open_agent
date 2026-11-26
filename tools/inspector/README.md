# Agent Interoperability Inspector

A small, dependency-free developer tool for the [Open Agentic Web](https://github.com/cognizant-ai-labs/agentic-web).
Give it the URL of an agentic website and it tells you whether **another site's browser
could load and run that site's agent network**, and exactly what to fix if not.

It was built for the ReliefMesh project and has no dependency on it. Use it on any site
that follows the [Worldwide Agentic Web MVP specification](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md).

Two front-ends share one check engine:

| | Web inspector | Command line |
| --- | --- | --- |
| Run it | serve this folder, open it | `node cli.mjs <url>` |
| CORS | **enforced for real** by the browser, from the inspector's own origin | `Origin` sent, `Access-Control-Allow-Origin` read back |
| Action bridge | live handshake; lists the actions shared with the inspector's origin | page and framing headers checked; the live catalogue needs a browser |
| Official `check_partner.mjs` | not available in a browser | **run unchanged**, its verdict included in the report |
| Output | on screen, Markdown and JSON download, shareable `?url=` link | text, `--json`, `--md <file>`; exit code 1 on a failure |

## It builds on the official tooling

- Parsing and validation use the official browser runtime's own modules (`runtime/hocon.js`,
  `runtime/kernel.js`), copied unchanged. A network that passes here is one the reference
  runtime accepts.
- The bridge handshake uses the runtime's own `ActionBridgeClient`.
- The CLI runs the official `check_partner.mjs` as it is and adds its errors and warnings
  to the report. The inspector's own checks cover what that script does not report as
  findings.

## What it checks

| Group | Checks |
| --- | --- |
| Address | http(s) URL; HTTPS except on loopback |
| Public files and CORS | `agent-manifest.json`, the network definition and `links.json` are readable from another origin; optional `.well-known` metadata |
| Manifest | `networks[]` with `name`, `front_man`, `hocon`; exact network-name match (fail closed); router metadata; visitor keys kept apart from a publisher-funded router; peer policy and `allowed_peers` |
| Network definition | parses; passes the runtime's validation; front agent matches the manifest |
| Agents and capabilities | unique names; every agent has a description, instructions and an input schema; unreachable agents; instruction size; server-only tools; demo mode; a default model; a network description and sample queries |
| Runtime | a browser runtime is published with the site |
| Site actions and bridge | protocol version; bridge declared, on the site's own origin, loadable and frameable; the actions shared with the caller; writes offered to an arbitrary origin |
| Partner networks | each partner is in `allowed_peers`, uses HTTPS, is not a `localhost` URL on a hosted site, is reachable, publishes the named network and has a consent-card label; unused `allowed_peers` |
| Security | nothing shaped like a credential in the public files |

Each check is `PASS`, `WARN`, `FAIL`, `INFO` or `SKIP`, with a plain explanation and, where
there is one, the fix. A check that cannot run in the current front-end is `SKIP`, never
`PASS`.

## Web inspector

Serve this folder with any static server and open it:

```shell
node ../../vendor/agentify-website/scripts/serve_site.mjs . --port 8090 --open-as localhost
# or: npx serve .   /   python -m http.server 8090
```

Open http://localhost:8090/, paste a URL and choose **Inspect**. You can enter:

- a network URL, such as `https://site.example/network_name`
- the folder that holds `agent-manifest.json`, such as `https://site.example/`
- a page of the site, such as `https://site.example/index.html`

`?url=<encoded url>` runs a check on load, so a result can be linked to.

The page reads only the target's public files, and opens its action bridge in a hidden
frame to ask which actions it shares. It sends the target nothing else, stores nothing,
and loads no third-party script. Everything a target says is rendered as text.

## Command line

Node 22 or newer.

```shell
node cli.mjs https://site.example/network_name
node cli.mjs https://site.example/network_name --origin https://my-site.example
node cli.mjs https://site.example/network_name --json
node cli.mjs https://site.example/network_name --md report.md
```

| Option | Meaning |
| --- | --- |
| `--origin <origin>` | Check as this calling site. Default: any other site. |
| `--json` | Print the report as JSON. |
| `--md <file>` | Also write the report as Markdown. |
| `--skill <folder>` | Where the official `agentify-website` skill is, to run `check_partner.mjs`. Also `AGENTIFY_SKILL_DIR`. In this repository it is found automatically. |
| `--no-official` | Skip the official checker. |

Exit code `0` when nothing failed, `1` when a check failed, `2` on bad arguments, so it
fits a CI step:

```shell
node cli.mjs "$DEPLOYED_NETWORK_URL" --md interop-report.md
```

## Using it outside this repository

Copy this folder. It needs:

- `runtime/` — the official browser runtime, unchanged (it is in this folder).
- For the CLI's official check only: the `agentify-website` skill folder from the
  agentic-web repository, passed with `--skill`.

## Files

```text
checks.js       the check engine; isomorphic, no DOM and no Node APIs
report.js       Markdown and text rendering
inspector.js    web front-end: browser environment and rendering
cli.mjs         command line: Node environment and the official checker
index.html, styles.css, favicon.svg
runtime/        the official browser runtime, unchanged
tests/          Node tests with a stand-in fetch and known-broken sites
```

## Tests

```shell
node --test "tests/*.test.mjs"
```

A stand-in `fetch` serves a known-good site, and each test breaks one thing (CORS header,
network name, parser input, front agent, framing header, credential, partner policy…) to
check that the inspector reports exactly that. The browser front-end is covered by the
repository's Playwright suite, which inspects five live sites from a third origin.

## Limits

- It reads public files. It cannot tell whether a site's agents answer well; that needs a
  model and a conversation.
- The action catalogue depends on who asks. The web inspector shows what its own origin is
  offered, which for a site with a strict allowlist is nothing. That is correct behaviour.
- From Node, CORS is inferred from headers. Only a browser enforces it; use the web
  inspector for the definitive answer.

Licence: Apache-2.0.
