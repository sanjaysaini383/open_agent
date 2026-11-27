// The one path every cross-site call takes.
//
//   consent  ->  allowed_peers policy  ->  load the partner's published network (spec 3.2)
//            ->  trust gate            ->  call a shared action through the partner's bridge
//            ->  schema validation     ->  receipt
//
// Nothing here talks to a partner except through the official runtime's engine:
//   engine.requestConsent   the runtime's consent gate (remembers "always" for the session)
//   engine.resolveRemote    fetches and validates the partner's manifest and network,
//                           enforces allowed_peers, and discovers its action bridge
//   engine.actions          validates arguments against the partner's schema and runs the
//                           action on the partner's origin (hidden frame for a read, the
//                           partner's own window for a write)
//
// These are real cross-origin interactions. No response is hardcoded or replayed.
import type { ZodType, ZodTypeDef } from "zod";
import { digestOfBytes, jwkFingerprint, verifySignature, type PublicJwk } from "@/domain/crypto";
import { scanForInjection } from "@/domain/sanitize";
import { registryInfo, verification } from "@/domain/schemas";
import { evaluateTrust, isUsable } from "@/domain/trust";
import type { TrustEvaluation } from "@/domain/types";
import { uid, useStore } from "@/state/store";
import type { PeerDiscovery, PeerRecord } from "@/state/types";
import { useUi } from "@/state/ui";
import { loadRuntime, type ConsentDetail, type Runtime } from "./runtime";

/* eslint-disable @typescript-eslint/no-explicit-any */

export class ConsentDeclined extends Error {
  constructor(public readonly peerLabel: string) { super(`You declined to contact ${peerLabel}. Nothing was sent.`); this.name = "ConsentDeclined"; }
}
export class TrustRefused extends Error {
  constructor(message: string) { super(message); this.name = "TrustRefused"; }
}
export class PolicyRefused extends Error {
  constructor(message: string) { super(message); this.name = "PolicyRefused"; }
}
/** A write whose result never arrived. It may or may not have happened; never retried automatically. */
export class OutcomeUnknown extends Error {
  constructor(message: string) { super(message); this.name = "OutcomeUnknown"; }
}

export interface CallContext {
  incidentId: string | null;
  agent: string;
}

/** Proof that the person agreed to this contact, for this purpose. Calls need one. */
export interface Grant {
  peerId: string;
  purpose: string;
  agent: string;
  incidentId: string | null;
}

const hostOf = (url: string): string => { try { return new URL(url).host; } catch { return url; } };
const originOf = (url: string): string => new URL(url).origin;

function peer(peerId: string): PeerRecord {
  const record = useStore.getState().peers[peerId];
  if (!record) throw new Error(`No partner named "${peerId}" is configured.`);
  return record;
}

export function findPeerByRole(role: PeerRecord["role"]): PeerRecord | null {
  return Object.values(useStore.getState().peers).find((item) => item.role === role) ?? null;
}

// ---- consent ---------------------------------------------------------------------

export async function askConsent(peerId: string, purpose: string, detail: ConsentDetail, ctx: CallContext): Promise<Grant> {
  const runtime = await loadRuntime();
  const target = peer(peerId);
  const info = {
    kind: "network",
    peerLabel: target.label,
    peerOrigin: hostOf(target.networkUrl),
    requestText: purpose,
    est: { totalTokens: 0, costText: "no model call" },
    reliefmesh: detail,
  };
  const decision = await runtime.engine.requestConsent(info);
  if (decision === "decline") throw new ConsentDeclined(target.label);
  return { peerId, purpose, agent: ctx.agent, incidentId: ctx.incidentId };
}

// ---- connect: load the partner's published network ----------------------------------

function sessionOf(runtime: Runtime, target: PeerRecord): any | null {
  const url = new URL(target.networkUrl);
  const base = new URL("./", url).href.replace(/\/$/, "");
  const name = url.pathname.split("/").filter(Boolean).pop() || "";
  return runtime.engine.registry.get(base, name) || null;
}

function summarise(session: any, runtime: Runtime, observedDigest: string | null): PeerDiscovery {
  const manifest = session.manifest || {};
  const network = session.network;
  const front = network.findFrontMan();
  const entry = (manifest.networks || []).find((item: any) => item.name === network.name) || {};
  const agents = (network.config.tools || []).map((agent: any) => ({
    name: String(agent.name),
    description: String(agent.function?.description || "").slice(0, 400),
    isFront: agent.name === front,
    calls: (agent.tools || []).map((tool: any) => typeof tool === "string" ? tool : String(tool?.url || "")).filter(Boolean),
  }));
  const catalog = runtime.engine.actions.catalog({ base: session.base, network: network.name });
  const partnerNetworks = [...new Set<string>(agents.flatMap((agent: any) => agent.calls.filter((call: string) => /^https?:\/\//i.test(call))))];
  return {
    status: "connected",
    at: new Date().toISOString(),
    brand: String(manifest.brand || "").slice(0, 120),
    networkName: String(network.name),
    frontAgent: String(front || ""),
    description: String(entry.description || network.config.metadata?.description || "").slice(0, 400),
    capabilities: Array.isArray(manifest.reliefmesh?.capabilities) ? manifest.reliefmesh.capabilities.map(String).slice(0, 40) : [],
    dataClassification: manifest.reliefmesh?.data_classification ? String(manifest.reliefmesh.data_classification) : undefined,
    peerPolicy: manifest.peer_policy?.mode ? String(manifest.peer_policy.mode) : undefined,
    agents,
    actions: catalog.map((action: any) => ({ name: String(action.name), description: String(action.description).slice(0, 400), effect: String(action.effect) })),
    partnerNetworks,
    fetched: { manifest: String(session.fetchedUrls?.manifest || ""), network: String(session.fetchedUrls?.hocon || "") },
    observedDigest,
    sampleQueries: Array.isArray(entry.sample_queries) ? entry.sample_queries.map(String).slice(0, 8) : [],
  };
}

/** Load a partner's network into the runtime, or return the session already loaded. */
export async function connect(grant: Grant): Promise<PeerDiscovery> {
  const runtime = await loadRuntime();
  const target = peer(grant.peerId);
  const store = useStore.getState();
  const existing = sessionOf(runtime, target);
  if (existing && target.discovery?.status === "connected") return target.discovery;

  try {
    const chain = [`${runtime.engine.top.base}::${runtime.engine.top.network.name}`];
    // resolveRemote: allowed_peers gate, exact-name manifest lookup, network validation,
    // then the action-bridge handshake on the partner's origin.
    const session = await runtime.engine.resolveRemote(target.networkUrl, chain, undefined, runtime.engine.top.manifest);
    let observedDigest: string | null = null;
    try {
      const response = await fetch(session.fetchedUrls.hocon, { credentials: "omit" });
      if (response.ok) observedDigest = await digestOfBytes(await response.arrayBuffer());
    } catch {
      observedDigest = null; // reported as "could not be compared", never assumed to match
    }
    const discovery = summarise(session, runtime, observedDigest);
    store.patchPeer(target.id, { discovery });
    void store.record({
      kind: "network", actor: grant.agent, incidentId: grant.incidentId,
      summary: `Loaded ${target.label}'s published network "${discovery.networkName}" (${discovery.agents.length} agents, ${discovery.actions.length} shared actions)`,
      data: { networkUrl: target.networkUrl, fetched: discovery.fetched, digest: observedDigest, agents: discovery.agents.map((agent) => agent.name), actions: discovery.actions.map((action) => `${action.name} (${action.effect})`) },
    });
    return discovery;
  } catch (error) {
    const message = (error as Error).message || String(error);
    const policy = /^Policy:/.test(message);
    const discovery: PeerDiscovery = {
      status: policy ? "policy-refused" : "failed", at: new Date().toISOString(), error: message,
      capabilities: [], agents: [], actions: [], partnerNetworks: [], fetched: { manifest: "", network: "" }, observedDigest: null, sampleQueries: [],
    };
    store.patchPeer(target.id, { discovery });
    void store.record({ kind: "network", actor: grant.agent, incidentId: grant.incidentId, summary: `Could not load ${target.label}: ${message}`, data: { networkUrl: target.networkUrl } });
    if (policy) throw new PolicyRefused(message);
    throw new Error(`${target.label} could not be loaded: ${message}`);
  }
}

/** Forget a loaded partner, so the next connect fetches its files again. */
export async function disconnect(peerId: string): Promise<void> {
  const runtime = await loadRuntime();
  const target = peer(peerId);
  const session = sessionOf(runtime, target);
  if (session) {
    const key = runtime.engine.registry.cacheKey(session.base, session.network.name);
    runtime.engine.registry.cache.delete(key);
    for (const [ref, entry] of [...runtime.engine.actions.entries]) {
      if (entry.base === session.base && entry.network === session.network.name) runtime.engine.actions.entries.delete(ref);
    }
    runtime.engine.actions.remoteLoads?.delete(`${session.base}::${session.network.name}`);
  }
  useStore.getState().patchPeer(peerId, { discovery: null, trust: null, overridden: false });
}

// ---- calling a shared action --------------------------------------------------------

async function execute(grant: Grant, actionName: string, args: Record<string, unknown>, expect: "read" | "write"): Promise<unknown> {
  const runtime = await loadRuntime();
  const target = peer(grant.peerId);
  const session = sessionOf(runtime, target);
  if (!session) throw new Error(`${target.label} is not connected.`);
  const catalog: any[] = runtime.engine.actions.catalog({ base: session.base, network: session.network.name });
  const entry = catalog.find((item) => item.name === actionName);
  if (!entry) throw new Error(`${target.label} does not share an action named "${actionName}" with this site.`);
  if (expect === "read" && entry.effect !== "read") throw new Error(`"${actionName}" on ${target.label} is not a read; it will not be called without an approved plan.`);
  if (expect === "write" && entry.effect === "read") throw new Error(`"${actionName}" on ${target.label} is a read, not a write.`);

  const store = useStore.getState();
  const interactionId = uid("ix");
  const started = performance.now();
  store.addInteraction({ id: interactionId, at: new Date().toISOString(), from: "command", to: target.id, kind: expect, label: actionName, status: "pending", agent: grant.agent });
  try {
    // prepare() validates the arguments against the partner's own schema before anything is sent.
    const plan = runtime.engine.actions.prepare({ kind: "action", action: entry.ref, arguments: args });
    // A partner's write is confirmed in the partner's own window, not here. The dashboard's
    // own approval already happened, and is checked by the caller before this point.
    const receipts = await runtime.engine.actions.execute(plan, async () => true, crypto.randomUUID());
    const receipt = receipts?.[0];
    const durationMs = Math.round(performance.now() - started);
    if (!receipt) throw new Error("The action was cancelled before it started.");
    if (receipt.status !== "succeeded") {
      const reason = String(receipt.error || "no result");
      // For a read nothing changed, so it is a plain failure. For a write the outcome is unknown.
      const declined = /declined|cancelled|closed/i.test(reason) && !/timed out/i.test(reason);
      store.patchInteraction(interactionId, { status: declined ? "declined" : "failed", durationMs, detail: reason });
      if (expect === "write" && !declined) throw new OutcomeUnknown(`${target.label} did not confirm the result of "${actionName}": ${reason}. It may or may not have happened. Check ${target.label} before trying again.`);
      throw new Error(`${target.label} "${actionName}" failed: ${reason}`);
    }
    store.patchInteraction(interactionId, { status: "ok", durationMs });
    return receipt.result;
  } catch (error) {
    const current = useStore.getState().interactions.find((item) => item.id === interactionId);
    if (current?.status === "pending") store.patchInteraction(interactionId, { status: "failed", durationMs: Math.round(performance.now() - started), detail: (error as Error).message });
    throw error;
  }
}

function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, raw: unknown, target: PeerRecord, actionName: string, grant: Grant): T {
  // A read whose arguments pass the schema but fail the site's own check answers {ok:false, reason}.
  if (raw && typeof raw === "object" && (raw as any).ok === false && typeof (raw as any).reason === "string" && !("quote" in (raw as any)) && !("reference" in (raw as any))) {
    const shape = schema.safeParse(raw);
    if (!shape.success) throw new Error(`${target.label} refused "${actionName}": ${String((raw as any).reason).slice(0, 200)}`);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    void useStore.getState().record({
      kind: "security", actor: grant.agent, incidentId: grant.incidentId,
      summary: `Rejected a malformed response from ${target.label} to "${actionName}"`,
      data: { path: issue?.path.join("."), message: issue?.message },
    });
    throw new Error(`${target.label} answered "${actionName}" with data that does not match the published contract (${issue?.path.join(".") || "root"}: ${issue?.message}). It was rejected.`);
  }
  // External text is data. Record any instruction-like content; never act on it.
  const findings = scanForInjection(raw);
  if (findings.length) {
    void useStore.getState().record({
      kind: "security", actor: grant.agent, incidentId: grant.incidentId,
      summary: `Instruction-like text found in ${target.label}'s response to "${actionName}". Treated as data; not acted on.`,
      data: { findings: findings.slice(0, 5) },
    });
  }
  return result.data;
}

export async function callRead<T>(grant: Grant, actionName: string, args: Record<string, unknown>, schema: ZodType<T, ZodTypeDef, unknown>): Promise<T> {
  const target = peer(grant.peerId);
  return parse(schema, await execute(grant, actionName, args, "read"), target, actionName, grant);
}

/** A write runs in the partner's own window, where the person confirms it there. */
export async function callWrite<T>(grant: Grant, actionName: string, args: Record<string, unknown>, schema: ZodType<T, ZodTypeDef, unknown>): Promise<T> {
  const target = peer(grant.peerId);
  return parse(schema, await execute(grant, actionName, args, "write"), target, actionName, grant);
}

// ---- trust -----------------------------------------------------------------------

interface RegistryKeys {
  name: string;
  keys: Map<string, { jwk: PublicJwk; fingerprint: string }>;
}
let registryKeys: RegistryKeys | null = null;

/** Consent to, connect and pin the trust registry. It is the trust anchor, so it is not itself scored. */
export async function openRegistry(ctx: CallContext, purpose: string, calls: string[]): Promise<Grant> {
  const registry = findPeerByRole("trust");
  if (!registry) throw new TrustRefused("No trust registry is configured, so nothing can be verified.");
  const grant = await askConsent(registry.id, purpose, { agent: ctx.agent, calls, dataShared: "The network URLs and organisation ids being checked. No incident details." }, ctx);
  await connect(grant);
  if (!registryKeys) {
    const info = await callRead(grant, "get_registry_info", {}, registryInfo);
    const keys = new Map<string, { jwk: PublicJwk; fingerprint: string }>();
    for (const key of info.registry.keys) {
      const computed = await jwkFingerprint(key.publicKeyJwk);
      if (computed !== key.fingerprint) throw new TrustRefused(`${registry.label} advertises a fingerprint that does not match its own key ${key.kid}. Its statements are not accepted.`);
      keys.set(key.kid, { jwk: key.publicKeyJwk, fingerprint: computed });
    }
    const store = useStore.getState();
    const pin = store.settings.registryPin;
    const first = info.registry.keys[0];
    if (!pin) {
      // Trust on first use: remember the key, and tell the person that is what happened.
      store.patchSettings({ registryPin: { fingerprint: first.fingerprint, kid: first.kid, name: info.registry.name, pinnedAt: new Date().toISOString() }, registryMismatch: null });
      void store.record({ kind: "trust", actor: ctx.agent, incidentId: ctx.incidentId, summary: `Pinned ${registry.label}'s signing key on first use (${first.fingerprint.slice(0, 23)}…)`, data: { kid: first.kid, fingerprint: first.fingerprint, simulatedAuthority: info.registry.simulatedAuthority } });
    } else if (![...keys.values()].some((key) => key.fingerprint === pin.fingerprint)) {
      store.patchSettings({ registryMismatch: { fingerprint: first.fingerprint, seenAt: new Date().toISOString() } });
      void store.record({ kind: "security", actor: ctx.agent, incidentId: ctx.incidentId, summary: `${registry.label}'s signing key differs from the pinned key. Verification is blocked.`, data: { pinned: pin.fingerprint, seen: first.fingerprint } });
      throw new TrustRefused(`${registry.label}'s signing key changed since it was pinned. Verification is blocked until a person reviews it in Settings.`);
    }
    registryKeys = { name: info.registry.name, keys };
  }
  return grant;
}

export function forgetRegistryKeys(): void {
  registryKeys = null;
}

async function checkSubject(grant: Grant, input: {
  subjectType: "agent_network" | "organization";
  expectedSubjectId: string;
  name: string;
  lookup: { action: string; args: Record<string, unknown> };
  networkUrl?: string;
  observedDigest?: string | null;
  advertisedCapabilities?: string[];
}): Promise<TrustEvaluation> {
  const registry = peer(grant.peerId);
  const result = await callRead(grant, input.lookup.action, input.lookup.args, verification);
  const attestation = result.attestation ?? null;
  let signature: { valid: boolean; reason: string } | null = null;

  if (attestation) {
    const key = registryKeys?.keys.get(attestation.kid);
    if (!key) {
      signature = { valid: false, reason: `Signed with key "${attestation.kid}", which the registry does not publish.` };
    } else {
      // A real ECDSA P-256 verification in this browser.
      signature = await verifySignature(attestation.payload, attestation.signature, key.jwk);
      // A genuine signature moved under another subject is still the wrong statement.
      if (signature.valid && attestation.payload.subjectId !== input.expectedSubjectId) {
        signature = { valid: false, reason: `The attestation is for "${attestation.payload.subjectId}", not "${input.expectedSubjectId}".` };
      }
      if (signature.valid && input.networkUrl && attestation.payload.networkUrl !== input.networkUrl) {
        signature = { valid: false, reason: `The attestation names ${attestation.payload.networkUrl}, not ${input.networkUrl}.` };
      }
    }
  }

  const evaluation = evaluateTrust({
    subjectId: input.expectedSubjectId,
    subjectType: input.subjectType,
    name: result.record?.name || input.name,
    registry: registry.label,
    now: new Date(),
    found: result.found,
    liveStatus: result.record?.status ?? null,
    attestation: attestation ? {
      status: attestation.payload.status,
      expiresAt: attestation.payload.expiresAt,
      credentials: attestation.payload.credentials.map((credential) => ({ type: credential.type, validUntil: credential.validUntil, status: credential.status })),
      capabilities: attestation.payload.capabilities,
      networkDigest: attestation.payload.networkDigest ?? null,
    } : null,
    signature,
    observedDigest: input.observedDigest,
    advertisedCapabilities: input.advertisedCapabilities,
    reputation: result.reputation ? { completed: result.reputation.completed, disputes: result.reputation.disputes, fulfilmentRate: result.reputation.fulfilmentRate } : null,
    openReports: result.reports.open,
  });

  void useStore.getState().record({
    kind: "trust", actor: grant.agent, incidentId: grant.incidentId,
    summary: `${evaluation.name}: ${evaluation.decision} (score ${evaluation.score}${evaluation.signatureVerified ? ", signature verified" : ", no verified signature"})`,
    data: { subjectId: evaluation.subjectId, decision: evaluation.decision, score: evaluation.score, signatureVerified: evaluation.signatureVerified, warnings: evaluation.warnings, blockers: evaluation.blockers },
  });
  return evaluation;
}

export async function verifyPeer(registryGrant: Grant, peerId: string): Promise<TrustEvaluation> {
  const target = peer(peerId);
  const name = new URL(target.networkUrl).pathname.split("/").filter(Boolean).pop() || target.id;
  const evaluation = await checkSubject(registryGrant, {
    subjectType: "agent_network",
    expectedSubjectId: `net:${name}`,
    name: target.label,
    lookup: { action: "verify_agent", args: { networkUrl: target.networkUrl } },
    networkUrl: target.networkUrl,
    observedDigest: target.discovery?.observedDigest ?? null,
    advertisedCapabilities: target.discovery?.capabilities ?? [],
  });
  useStore.getState().patchPeer(peerId, { trust: evaluation });
  return evaluation;
}

export async function verifyOrganization(registryGrant: Grant, organizationId: string, name: string): Promise<TrustEvaluation> {
  const evaluation = await checkSubject(registryGrant, {
    subjectType: "organization",
    expectedSubjectId: `org:${organizationId}`,
    name,
    lookup: { action: "verify_organization", args: { organizationId } },
  });
  useStore.getState().setOrgTrust(organizationId, evaluation);
  return evaluation;
}

/** Ask a person whether an unverified party may be used anyway. Blocked parties are never offered. */
export function requestOverride(subject: string, kind: "partner" | "organization", reason: string, consequences: string): Promise<boolean> {
  return new Promise((resolve) => {
    useUi.getState().setOverride({
      id: uid("override"), subject, kind, reason, consequences,
      resolve: (allowed) => { useUi.getState().setOverride(null); resolve(allowed); },
    });
  });
}

/**
 * Open a partner for use in a step: consent, connect, and pass the trust gate.
 *
 * No data from a partner is used before this has passed. A blocked partner is refused.
 * An unverified partner is refused unless a person explicitly allows it, which is audited.
 */
export async function openPeer(peerId: string, ctx: CallContext, purpose: string, detail: { calls: string[]; dataShared: string }): Promise<Grant> {
  const target = peer(peerId);
  if (target.role === "trust") return openRegistry(ctx, purpose, detail.calls);

  const grant = await askConsent(peerId, purpose, { agent: ctx.agent, ...detail }, ctx);
  await connect(grant);

  let evaluation = peer(peerId).trust;
  if (!evaluation) {
    const registryGrant = await openRegistry(ctx, `Verify ${target.label} before its data is used`, ["verify_agent"]);
    evaluation = await verifyPeer(registryGrant, peerId);
  }
  if (evaluation.decision === "blocked") {
    throw new TrustRefused(`${target.label} is blocked by the trust check: ${evaluation.blockers.join(" ")} Its data will not be used.`);
  }
  if (!isUsable(evaluation.decision) && !peer(peerId).overridden) {
    const allowed = await requestOverride(target.label, "partner",
      `${target.label} has no record in the trust registry.`,
      "Its data would be used in this response without any verification. The decision is recorded in the audit trail.");
    void useStore.getState().record({
      kind: "trust", actor: "human:coordinator", incidentId: ctx.incidentId,
      summary: allowed ? `Override: allowed unverified partner ${target.label}` : `Kept unverified partner ${target.label} excluded`,
      data: { peer: target.networkUrl, decision: evaluation.decision },
    });
    if (!allowed) throw new TrustRefused(`${target.label} is unverified and was not allowed. Its data will not be used.`);
    useStore.getState().patchPeer(peerId, { overridden: true });
  }
  return grant;
}

/** Add a person-approved origin to the runtime's allowed peers for this page view. */
export async function allowOrigin(networkUrl: string): Promise<void> {
  const runtime = await loadRuntime();
  runtime.engine.runtimeAllowedPeers.add(originOf(networkUrl));
}

export async function isOriginAllowed(networkUrl: string): Promise<boolean> {
  const runtime = await loadRuntime();
  const origin = originOf(networkUrl);
  const manifest = runtime.engine.top?.manifest || {};
  const declared: string[] = (manifest.allowed_peers || []).map((item: string) => { try { return new URL(item).origin; } catch { return item; } });
  return declared.includes(origin) || runtime.engine.runtimeAllowedPeers.has(origin);
}
