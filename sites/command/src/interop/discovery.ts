// Where partner network URLs come from.
//
// The specification needs no central registry: a network is found by its URL. ReliefMesh
// has three sources, and the UI always says which one a result came from:
//
//   1. Publisher registry   partners.json, a list shipped with this site. Local. Not a lookup.
//   2. Person-registered    a URL someone typed into Settings, kept in this browser.
//   3. NANDA Index          a LIVE search of the public index at api.nandaindex.org.
//
// A local list is never presented as a NANDA lookup, and a NANDA result is only a
// candidate: nothing is connected until a person registers it and consents to contact.
import { z } from "zod";
import { cleanText, safeHttpUrl } from "@/domain/sanitize";
import type { PeerConfig, PeerRole } from "@/state/types";
import { loadRuntime, siteBase } from "./runtime";

export interface PartnerRegistryFile {
  notice: string;
  partners: PeerConfig[];
  inspector: string | null;
  nandaApiBase: string | null;
  nandaSite: string | null;
}

const registryFile = z.object({
  notice: z.string().max(400).optional().default(""),
  partners: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9_-]{1,30}$/),
    label: z.string().min(1).max(60),
    role: z.enum(["trust", "shelter", "supplier", "logistics", "other"]),
    networkUrl: z.string().url().max(300),
    siteUrl: z.string().url().max(300),
    purpose: z.string().max(200).optional().default(""),
  })).max(50),
  inspector: z.string().url().optional(),
  nandaIndex: z.object({ apiBase: z.string().url(), site: z.string().url().optional() }).optional(),
});

/** Source 1: the publisher's own list, shipped with the site. */
export async function loadPublisherRegistry(): Promise<PartnerRegistryFile> {
  const response = await fetch(`${siteBase()}/partners.json`, { cache: "no-store" });
  if (!response.ok) throw new Error(`partners.json answered ${response.status}`);
  const parsed = registryFile.parse(await response.json());
  return {
    notice: parsed.notice,
    partners: parsed.partners.map((partner) => ({ ...partner, source: "publisher-registry" as const })),
    inspector: parsed.inspector ?? null,
    nandaApiBase: parsed.nandaIndex?.apiBase ?? null,
    nandaSite: parsed.nandaIndex?.site ?? null,
  };
}

/** Source 2: turn a URL a person typed into a partner entry. Validates the shape only. */
export function partnerFromUrl(networkUrl: string, label: string, role: PeerRole): { ok: true; partner: PeerConfig } | { ok: false; reason: string } {
  const safe = safeHttpUrl(networkUrl.trim());
  if (!safe) return { ok: false, reason: "Enter a full http(s) network URL, such as https://partner.example/partner_network." };
  const url = new URL(safe);
  const name = url.pathname.split("/").filter(Boolean).pop();
  if (!name || url.pathname.endsWith("/") || url.search || url.hash) {
    return { ok: false, reason: "A network URL ends in the network name, with no slash, query or # after it." };
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) return { ok: false, reason: "Use https for every host except localhost." };
  const id = `${url.hostname.replace(/[^a-z0-9]/gi, "-")}-${name}`.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 30);
  return {
    ok: true,
    partner: {
      id: /^[a-z]/.test(id) ? id : `p-${id}`,
      label: cleanText(label, 60) || name,
      role,
      networkUrl: safe.replace(/\/$/, ""),
      siteUrl: new URL("./", url).href,
      purpose: "Registered by a person on this device.",
      source: "user-registered",
    },
  };
}

// ---- Source 3: NANDA Index (live) -----------------------------------------------------

export interface NandaResult {
  orgId: string;
  displayName: string;
  registryUrl: string | null;
  domain: string | null;
  description: string;
  tags: string[];
}

export type NandaSearch =
  | { status: "ok"; source: "nanda-index-live"; query: string; count: number; results: NandaResult[]; endpoint: string; at: string }
  | { status: "declined" | "failed" | "not-configured"; source: "nanda-index-live"; query: string; reason: string };

const nandaResponse = z.object({
  query: z.string().optional(),
  count: z.number().optional(),
  results: z.array(z.object({
    org_id: z.string().max(200),
    display_name: z.string().max(300).optional().nullable(),
    registry_url: z.string().max(500).optional().nullable(),
    domain: z.string().max(300).optional().nullable(),
    description: z.string().max(4000).optional().nullable(),
    tags: z.array(z.string().max(80)).max(50).optional().nullable(),
  }).passthrough()).max(60),
});

/**
 * Search the public NANDA Index (GET /api/v1/search, documented at nandaindex.org/developers;
 * no key needed). This is a real request to a third party, so the runtime's consent gate
 * asks first. Results are untrusted text and are cleaned before display.
 */
export async function searchNandaIndex(apiBase: string | null, query: string): Promise<NandaSearch> {
  const q = query.trim();
  if (!apiBase) return { status: "not-configured", source: "nanda-index-live", query: q, reason: "No NANDA Index endpoint is configured in partners.json." };
  if (q.length < 2) return { status: "failed", source: "nanda-index-live", query: q, reason: "Enter at least two characters." };
  const endpoint = `${apiBase.replace(/\/$/, "")}/api/v1/search?q=${encodeURIComponent(q)}`;
  const runtime = await loadRuntime();
  const decision = await runtime.engine.requestConsent({
    kind: "directory",
    peerLabel: "NANDA Index",
    peerOrigin: new URL(apiBase).host,
    requestText: `Search the public agent index for "${q}"`,
    est: { totalTokens: 0, costText: "no model call" },
    reliefmesh: { agent: "DiscoveryAgent", calls: ["GET /api/v1/search"], dataShared: "Only the search words you typed." },
  });
  if (decision === "decline") return { status: "declined", source: "nanda-index-live", query: q, reason: "You declined to contact the NANDA Index. Nothing was sent." };
  try {
    const response = await fetch(endpoint, { credentials: "omit", headers: { Accept: "application/json" } });
    if (!response.ok) return { status: "failed", source: "nanda-index-live", query: q, reason: `The NANDA Index answered HTTP ${response.status}.` };
    const parsed = nandaResponse.safeParse(await response.json());
    if (!parsed.success) return { status: "failed", source: "nanda-index-live", query: q, reason: "The NANDA Index answered in a shape this app does not recognise." };
    const results = parsed.data.results.map((item) => ({
      orgId: cleanText(item.org_id, 120),
      displayName: cleanText(item.display_name || item.org_id, 120),
      registryUrl: safeHttpUrl(item.registry_url || ""),
      domain: item.domain ? cleanText(item.domain, 120) : null,
      description: cleanText(item.description || "", 240),
      tags: (item.tags || []).map((tag) => cleanText(tag, 30)).filter(Boolean).slice(0, 8),
    }));
    return { status: "ok", source: "nanda-index-live", query: q, count: results.length, results, endpoint, at: new Date().toISOString() };
  } catch (error) {
    return { status: "failed", source: "nanda-index-live", query: q, reason: `The NANDA Index could not be reached from this browser: ${(error as Error).message}` };
  }
}
