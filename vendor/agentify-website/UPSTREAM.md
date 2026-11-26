# Vendored: agentify-website skill (official Open Agentic Web tooling)

This folder is an **unmodified copy** of `skills/agentify-website/` from the official
Cognizant repository:

- Source: https://github.com/cognizant-ai-labs/agentic-web
- Commit: `0c0ca45e7540c790edd3db0cae7f8819d4e3fccb` (2026-11-25)
- Licence: Apache-2.0 (see `LICENSE` here and `runtime/LICENSE.txt`)

| Folder | What it is | How ReliefMesh uses it |
| --- | --- | --- |
| `runtime/` | The browser runtime (nsdeploy runtime with the agentic-web edits) | Copied byte-for-byte into every site by `scripts/sync-runtime.mjs`. Never edited. |
| `scripts/` | `build_network.mjs`, `serve_site.mjs`, `check_partner.mjs` | Run directly by `scripts/build-networks.mjs`, `scripts/serve-all.mjs`, `scripts/check-partners.mjs` and reused by the Interoperability Inspector CLI. |
| `templates/` | Network, manifest, bridge and mounting templates | `build_network.mjs` reads `templates/network.hocon` and `templates/bridge/action-bridge.html`. |
| `references/` | The skill's reference docs | Kept for readers; the conventions ReliefMesh follows. |

Do not edit anything here. To update, replace the folder with a newer upstream copy and
run `npm run runtime:sync` followed by `npm run networks:build`.

`npm run runtime:check` verifies that every site's `runtime/` copy is byte-identical to
`vendor/agentify-website/runtime/`.
