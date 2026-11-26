// The five independent ReliefMesh sites, plus the paths the tooling needs for each.
// "root" holds the published agent files (manifest, .hocon, network JSON, bridge, runtime).
// "serve" is the folder a static host serves. They differ only for Command, which is a
// Vite app: its agent files live in public/ and are copied unchanged into dist/.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SKILL = path.join(REPO, "vendor", "agentify-website");

export const SITES = [
  { id: "command", label: "ReliefMesh Command", network: "reliefmesh_command", root: "sites/command/public", serve: "sites/command/dist", port: 8080 },
  { id: "shelterconnect", label: "ShelterConnect", network: "shelterconnect", root: "sites/shelterconnect", serve: "sites/shelterconnect", port: 8081 },
  { id: "aidsupply", label: "AidSupply Network", network: "aidsupply", root: "sites/aidsupply", serve: "sites/aidsupply", port: 8082 },
  { id: "trustregistry", label: "TrustRegistry", network: "trustregistry", root: "sites/trustregistry", serve: "sites/trustregistry", port: 8083 },
  { id: "routebridge", label: "RouteBridge", network: "routebridge", root: "sites/routebridge", serve: "sites/routebridge", port: 8084 },
];

// Folders that carry a copy of the official runtime.
export const RUNTIME_COPIES = [
  ...SITES.map((site) => path.join(site.root, "runtime")),
  "tools/inspector/runtime",
];

export function abs(...parts) {
  return path.join(REPO, ...parts);
}

export async function readOrigins() {
  const doc = JSON.parse(await readFile(abs("reliefmesh.origins.json"), "utf8"));
  const profile = doc.profiles[doc.active];
  if (!profile) throw new Error(`reliefmesh.origins.json: active profile "${doc.active}" is not defined.`);
  return { doc, active: doc.active, profile };
}

/** The network URL of a site under the active profile: its origin, then its network name. */
export async function networkUrls() {
  const { profile } = await readOrigins();
  return Object.fromEntries(SITES.map((site) => [site.id, `${profile[site.id]}/${site.network}`]));
}

export function siteById(id) {
  const site = SITES.find((entry) => entry.id === id);
  if (!site) throw new Error(`Unknown site "${id}". Known: ${SITES.map((entry) => entry.id).join(", ")}`);
  return site;
}
