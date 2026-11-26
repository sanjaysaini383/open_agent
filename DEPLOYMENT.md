# Deployment

**Status: not deployed.** This repository has no hosting credentials, so nothing has been
published and no public URL is claimed. Everything needed is prepared; the steps below are
exact.

Each of the five sites is a folder of static files and deploys separately, to its own HTTPS
origin. Five origins are required: the specification's consent, the runtime's
`allowed_peers` policy and the browser's isolation are all per origin.

| Site | Deploy this folder | Build step |
| --- | --- | --- |
| ReliefMesh Command | `sites/command/dist` | `npm --prefix sites/command run build` |
| ShelterConnect | `sites/shelterconnect` | none |
| AidSupply Network | `sites/aidsupply` | none |
| TrustRegistry | `sites/trustregistry` | none |
| RouteBridge | `sites/routebridge` | none |
| Inspector (optional) | `tools/inspector` | none |

## 1. Choose the five origins

Create five empty projects on your host and note their HTTPS origins. For example, with
five Netlify sites: `https://reliefmesh-command.netlify.app`, and so on.

> **Recommended:** five subdomains of one domain you control, such as
> `command.example.org`, `shelter.example.org`, … Browsers then let a site's page, its bridge
> frame and its confirmation window share storage, so an edit on a partner site is visible to
> Command. On separate `*.netlify.app`, `*.vercel.app` or `*.pages.dev` hosts (public
> suffixes) everything still works, but bridge frames get partitioned storage and serve the
> seed data. See "State and static hosting" in ARCHITECTURE.md.

## 2. Write the origins into the published files

Put the origins in the `production` profile of `reliefmesh.origins.json` (origins only: no
path, no trailing slash), then:

```shell
npm run origins:set -- production --dry-run     # shows which files would change
npm run origins:set -- production
```

This rewrites partner URLs in every `.hocon`, `allowed_peers` in every manifest, the
`callerOrigins` of every bridge and Command's `partners.json`; re-runs the official build;
rewrites the hosting header files; and re-signs the TrustRegistry attestations, which bind
each network's URL and the digest of its published definition. It refuses a profile that
still has placeholders, uses plain http, or gives two sites the same origin.

Then rebuild Command and check:

```shell
npm --prefix sites/command run build
npm run networks:check
npm run runtime:check
```

`npm run origins:set -- local` switches back.

> Re-signing uses the private key in `sites/trustregistry/.keys/` (git-ignored). On a fresh
> clone there is none, so the script creates a new key pair: you become a new registry, and
> browsers that pinned the old key will be told the key changed.

## 3. Deploy each folder

Header files are already in each folder: `_headers` (Netlify, Cloudflare Pages) and
`vercel.json` (Vercel). They send `Access-Control-Allow-Origin: *` on the public agent files
only, the sandbox worker's CSP, and nothing that blocks framing of `bridge/`.

### Netlify

```shell
npm install -g netlify-cli && netlify login
netlify deploy --prod --dir sites/command/dist      --site <command-site-id>
netlify deploy --prod --dir sites/shelterconnect    --site <shelterconnect-site-id>
netlify deploy --prod --dir sites/aidsupply         --site <aidsupply-site-id>
netlify deploy --prod --dir sites/trustregistry     --site <trustregistry-site-id>
netlify deploy --prod --dir sites/routebridge       --site <routebridge-site-id>
```

### Cloudflare Pages

```shell
npm install -g wrangler && wrangler login
wrangler pages deploy sites/command/dist   --project-name reliefmesh-command
wrangler pages deploy sites/shelterconnect --project-name reliefmesh-shelterconnect
wrangler pages deploy sites/aidsupply      --project-name reliefmesh-aidsupply
wrangler pages deploy sites/trustregistry  --project-name reliefmesh-trustregistry
wrangler pages deploy sites/routebridge    --project-name reliefmesh-routebridge
```

### Vercel

```shell
npm install -g vercel && vercel login
vercel deploy --prod sites/command/dist
vercel deploy --prod sites/shelterconnect
vercel deploy --prod sites/aidsupply
vercel deploy --prod sites/trustregistry
vercel deploy --prod sites/routebridge
```

Vercel must not apply a build step or a framework preset to these folders: they are already
static output. The partner sites need dot-folders (`.well-known/`) served.

### Any other static host

Serve the folder as-is and send these headers (the official "Static hosting" list):

```text
/agent-manifest.json, /<network>.network.json, /links.json, /agent-mcp.json,
/.well-known/nsdeploy.json, /.well-known/nsdeploy-agent.json
    Access-Control-Allow-Origin: *
/runtime/sandbox-worker.js
    Content-Security-Policy: default-src 'none'; script-src blob:; connect-src 'none'; worker-src 'none'
```

Do not send `X-Frame-Options` or a `frame-ancestors` policy for `/bridge/`. Do not add the
CORS header to pages, scripts or the bridge. TrustRegistry may also send it on
`trust-keys.json` and `attestations.json`, and Command on `partners.json`; the generated
files already do.

## 4. Verify the deployment from another origin

Do not call it deployed until these pass against the public URLs.

```shell
npm run check:partners          # official check_partner.mjs on all 12 call paths
npm run inspect -- https://<command-origin>/reliefmesh_command
npm run inspect -- https://<shelterconnect-origin>/shelterconnect
npm run inspect -- https://<aidsupply-origin>/aidsupply
npm run inspect -- https://<trustregistry-origin>/trustregistry
npm run inspect -- https://<routebridge-origin>/routebridge
node scripts/sign-trust.mjs --verify
```

Then, in a browser:

1. Open the deployed Inspector (or run it locally) and inspect each network URL. A browser
   on a third origin is the definitive CORS test.
2. Open Command, run the workflow, and confirm on the Agent Network page that four partners
   show **Connected** and **Verified**, and that the interoperability test reports
   "Yes: different origins".
3. Approve a plan and confirm that the reservation opens the supplier site's own window on
   its own origin.

The browser tests can run against a deployment with
`RELIEFMESH_COMMAND=https://<command-origin> npm run test:e2e`, after replacing the partner
origins that the specs name.

## Optional: a Content-Security-Policy for Command

Not enabled by default. A starting point, to test before use:

```text
Content-Security-Policy:
  default-src 'self';
  script-src 'self' blob:;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https://*.tile.openstreetmap.org;
  connect-src 'self' https:;
  frame-src https://<shelterconnect> https://<aidsupply> https://<trustregistry> https://<routebridge>;
  worker-src 'self' blob:;
  object-src 'none'; base-uri 'self'; form-action 'self'
```

`connect-src` stays broad because the visitor may choose any LLM router. Narrow it if you
restrict the routers you support. `style-src 'unsafe-inline'` is needed by the runtime's and
the map's inline styles.

## Listing the sites

Once deployed and verified, the sites can be listed so others find them: a pull request to
[docs/agentic_websites.md](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/agentic_websites.md),
and registration on the [NANDA Index](https://nandaindex.org/). Both publish the site, so
they are left to the owner.

## Checklist

- [ ] Five HTTPS origins chosen and written to the `production` profile
- [ ] `npm run origins:set -- production` succeeded
- [ ] `npm --prefix sites/command run build`, `networks:check`, `runtime:check` pass
- [ ] Five folders deployed, headers in place
- [ ] `npm run check:partners` passes against the public URLs
- [ ] Inspector reports every network interoperable from a browser on another origin
- [ ] Workflow run in a browser: four partners connected and verified
- [ ] No `localhost` left: `grep -r "localhost" sites/*/agent-manifest.json sites/*/*.hocon`
- [ ] Deployed URLs added to README.md and HACKATHON_SUBMISSION.md
