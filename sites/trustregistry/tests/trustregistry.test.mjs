// TrustRegistry tests: canonical JSON, real signature verification of the PUBLISHED files,
// the store's rules, and that the actions match the manifest.
// Run: node --test "sites/trustregistry/tests/*.test.mjs"
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { ActionRegistry } from "../runtime/actions.js";
import { canonicalJson, fromBase64Url, jwkFingerprint, jwkThumbprintInput, sha256Digest, toBase64Url, verifyAttestation } from "../js/canonical.js";
import { ReadActions } from "../js/action-schemas.js";
import { RegistryData } from "../js/registry-data.js";
import { RegistryStore } from "../js/registry-store.js";
import { SiteLinks } from "../js/site-links.js";
import { registerActions as registerBridge } from "../bridge/bridge-actions.js";
import { registerActions as registerSite } from "../site-actions.js";

const NOW = () => new Date("2026-11-26T10:00:00.000Z");
const readJson = async (name) => JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), "utf8"));
const manifest = await readJson("agent-manifest.json");
const attestations = await readJson("attestations.json");
const keys = await readJson("trust-keys.json");
const SCOPE = { base: "http://localhost:8083", network: "trustregistry" };
const clone = (value) => JSON.parse(JSON.stringify(value));

const fresh = (options = {}) => new RegistryStore({ storage: null, now: NOW, attestations, keys, ...options });

function registryOf(register) {
  const registry = new ActionRegistry();
  register({ register: (definition) => registry.register(SCOPE, definition) });
  return registry;
}

// ---- canonical form, fingerprint, encoding ---------------------------------------

test("canonicalJson sorts keys at every depth and has no whitespace", () => {
  const value = { b: 1, a: { z: [{ y: 2, x: "two words" }], c: null }, "A": true };
  assert.equal(canonicalJson(value), '{"A":true,"a":{"c":null,"z":[{"x":"two words","y":2}]},"b":1}');
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }), "key order of the input does not matter");
  assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}', "undefined is left out, as JSON does");
  const text = canonicalJson(attestations.attestations["org:ORG-SUP-A"].payload);
  assert.ok(!/\s(?=(?:[^"]*"[^"]*")*[^"]*$)/.test(text), "no whitespace outside strings");
  assert.deepEqual(JSON.parse(text), attestations.attestations["org:ORG-SUP-A"].payload, "it is still the same JSON value");
});

test("canonicalJson refuses numbers that are not integers and values JSON cannot hold", () => {
  assert.throws(() => canonicalJson({ rate: 0.5 }), /integer/);
  assert.throws(() => canonicalJson({ n: Number.NaN }), /integer/);
  assert.throws(() => canonicalJson({ f: () => 1 }), /cannot be serialised/);
});

test("every number in a published payload is an integer, as the scheme requires", () => {
  for (const entry of Object.values(attestations.attestations)) assert.doesNotThrow(() => canonicalJson(entry.payload));
});

test("the key fingerprint matches an independent computation", async () => {
  for (const key of keys.keys) {
    const { crv, kty, x, y } = key.publicKeyJwk;
    const independent = `sha256:${createHash("sha256").update(`{"crv":"${crv}","kty":"${kty}","x":"${x}","y":"${y}"}`, "utf8").digest("hex")}`;
    assert.equal(jwkThumbprintInput(key.publicKeyJwk), `{"crv":"${crv}","kty":"${kty}","x":"${x}","y":"${y}"}`);
    assert.equal(await jwkFingerprint(key.publicKeyJwk), independent);
    assert.equal(key.fingerprint, independent, "the published fingerprint is the real one");
    assert.equal(key.kid, `tr-${independent.slice(7, 19)}`);
    assert.ok(!Object.hasOwn(key.publicKeyJwk, "d"), "no private key member is published");
  }
  assert.equal(await sha256Digest("abc"), `sha256:${createHash("sha256").update("abc").digest("hex")}`);
});

test("base64url round-trips and refuses non-canonical input", () => {
  const bytes = Uint8Array.from({ length: 64 }, (_, index) => (index * 37 + 11) % 256);
  const text = toBase64Url(bytes);
  assert.ok(/^[A-Za-z0-9_-]+$/.test(text) && !text.includes("="));
  assert.deepEqual(fromBase64Url(text), bytes);
  assert.throws(() => fromBase64Url(`${text}=`));
  assert.throws(() => fromBase64Url("a+b/"));
  // 64 bytes leave 4 unused bits in the last character: a different last character that
  // decodes to the same bytes must be refused, so a signature has exactly one spelling.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const twin = text.slice(0, -1) + alphabet[alphabet.indexOf(text.at(-1)) ^ 1];
  assert.throws(() => fromBase64Url(twin), /canonical/);
});

// ---- the published signatures -------------------------------------------------------

test("every signature in the published attestations.json verifies against trust-keys.json", async () => {
  const expected = RegistryData.seededSubjects().map(([seed]) => seed.subjectId).sort();
  assert.deepEqual(Object.keys(attestations.attestations).sort(), expected, "one attestation per registry record, and none for ORG-SUP-D");
  for (const [subjectId, entry] of Object.entries(attestations.attestations)) {
    const outcome = await verifyAttestation(entry, keys, { expectedSubjectId: subjectId, now: NOW() });
    assert.equal(outcome.valid, true, `${subjectId}: ${outcome.reason}`);
    assert.equal(outcome.signatureValid, true);
    assert.equal(outcome.expired, false);
    assert.equal(outcome.fingerprint, keys.keys[0].fingerprint);
    assert.equal(fromBase64Url(entry.signature).length, 64, "IEEE P1363 r||s");
    assert.equal(entry.payload.v, 1);
    assert.equal(entry.payload.subjectId, subjectId);
    assert.equal(entry.payload.simulated, true);
  }
});

test("agent-network payloads carry the network URL, digest and capabilities; organisations do not", () => {
  for (const entry of Object.values(attestations.attestations)) {
    const payload = entry.payload;
    if (payload.type === "agent_network") {
      assert.match(payload.networkUrl, /^https?:\/\/.+\/[a-z_]+$/);
      assert.ok(payload.networkDigest === null || /^sha256:[0-9a-f]{64}$/.test(payload.networkDigest));
      assert.ok(Array.isArray(payload.capabilities));
    } else {
      assert.equal(payload.type, "organization");
      for (const field of ["networkUrl", "networkDigest", "capabilities"]) assert.ok(!Object.hasOwn(payload, field), field);
    }
    for (const credential of payload.credentials) assert.deepEqual(Object.keys(credential).sort(), ["id", "issuer", "type", "validFrom", "validUntil"]);
  }
});

test("a changed payload, a changed signature or a swapped signature fails verification", async () => {
  const good = attestations.attestations["org:ORG-TR-3"];
  assert.equal((await verifyAttestation(good, keys)).valid, true);

  const upgraded = clone(good);
  upgraded.payload.status = "active";
  assert.equal((await verifyAttestation(upgraded, keys)).valid, false, "a revoked record cannot be edited to active");

  const oneCharacter = clone(good);
  oneCharacter.payload.name = oneCharacter.payload.name.replace("T", "t");
  assert.equal((await verifyAttestation(oneCharacter, keys)).valid, false);

  const badSignature = clone(good);
  badSignature.signature = (good.signature[0] === "A" ? "B" : "A") + good.signature.slice(1);
  assert.equal((await verifyAttestation(badSignature, keys)).valid, false);

  const swapped = clone(good);
  swapped.signature = attestations.attestations["org:ORG-TR-1"].signature;
  assert.equal((await verifyAttestation(swapped, keys)).valid, false, "another subject's signature does not fit");

  const short = clone(good);
  short.signature = good.signature.slice(0, 40);
  const shortOutcome = await verifyAttestation(short, keys);
  assert.equal(shortOutcome.valid, false);
});

test("a whole entry moved under another subject is refused when the caller names the subject", async () => {
  const moved = attestations.attestations["org:ORG-TR-1"];
  const outcome = await verifyAttestation(moved, keys, { expectedSubjectId: "org:ORG-TR-3" });
  assert.equal(outcome.signatureValid, true, "the signature itself is genuine");
  assert.equal(outcome.valid, false, "but it is not an attestation for the subject that was asked about");
  assert.match(outcome.reason, /not for org:ORG-TR-3/);
});

test("a wrong key, an unknown key id or no keys at all fails verification", async () => {
  const good = attestations.attestations["net:shelterconnect"];
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const other = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const wrongKey = { keys: [{ kid: good.kid, publicKeyJwk: { kty: other.kty, crv: other.crv, x: other.x, y: other.y } }] };
  assert.equal((await verifyAttestation(good, wrongKey)).valid, false, "same key id, different key");
  const unknown = await verifyAttestation({ ...good, kid: "tr-000000000000" }, keys);
  assert.equal(unknown.valid, false);
  assert.match(unknown.reason, /No published registry key/);
  assert.equal((await verifyAttestation(good, null)).valid, false);
  assert.equal((await verifyAttestation(null, keys)).valid, false);
  assert.equal((await verifyAttestation({ payload: good.payload }, keys)).valid, false);
});

test("an attestation past its expiry is reported as expired", async () => {
  const good = attestations.attestations["org:ORG-SUP-A"];
  const later = new Date(Date.parse(good.payload.expiresAt) + 1000);
  const outcome = await verifyAttestation(good, keys, { now: later });
  assert.equal(outcome.signatureValid, true);
  assert.equal(outcome.expired, true);
});

// ---- the store's reads ---------------------------------------------------------------

test("registry info lists the key, the counts and the subjects, labelled as simulated", () => {
  const info = fresh().registryInfo();
  assert.equal(info.simulated, true);
  assert.match(info.dataNotice, /Simulated/);
  assert.equal(info.source, `${SiteLinks.SELF}/`);
  assert.equal(info.generatedAt, NOW().toISOString());
  assert.equal(info.registry.simulatedAuthority, true);
  assert.equal(info.registry.algorithm, "ECDSA-P256-SHA256");
  assert.equal(info.registry.issuer, attestations.issuer);
  assert.deepEqual(Object.keys(info.registry.keys[0]).sort(), ["createdAt", "fingerprint", "kid", "publicKeyJwk"]);
  assert.deepEqual(info.counts, { agentNetworks: 4, organizations: 7, openReports: 3 });
  assert.equal(info.subjects.length, 11);
  assert.ok(info.links.reliefmesh_command.page);
});

test("verify_agent finds a network by its exact URL and returns its signed attestation", async () => {
  const store = fresh();
  const url = attestations.attestations["net:aidsupply"].payload.networkUrl;
  const result = await store.verifyAgent({ networkUrl: url });
  assert.equal(result.found, true);
  assert.equal(result.subjectId, "net:aidsupply");
  assert.deepEqual(Object.keys(result.record).sort(), ["capabilities", "name", "operator", "registeredAt", "status"]);
  assert.equal(result.record.status, "active");
  assert.deepEqual(Object.keys(result.attestation).sort(), ["kid", "payload", "signature"]);
  assert.equal((await verifyAttestation(result.attestation, keys, { expectedSubjectId: result.subjectId })).valid, true);
  assert.equal(result.signatureCheck.state, "valid");
  assert.equal(result.effectiveStatus, "active");
  assert.ok(result.reputation.completed > 0);
  assert.deepEqual(result.reports, { open: 0, items: [] });
  // A trailing slash is the same network.
  assert.equal((await store.verifyAgent({ networkUrl: `${url}/` })).found, true);
});

test("verify_agent does not match an unknown URL, or a known name at another address", async () => {
  const store = fresh();
  for (const networkUrl of ["https://unknown.example/some_network", "https://evil.example/aidsupply", "not a url", "", "ftp://localhost:8082/aidsupply"]) {
    const result = await store.verifyAgent({ networkUrl });
    assert.equal(result.found, false, networkUrl);
    assert.equal(result.record, null);
    assert.equal(result.attestation, null);
    assert.equal(result.effectiveStatus, "unregistered");
    assert.equal(result.simulated, true);
  }
  const impostor = await store.verifyAgent({ networkUrl: "https://evil.example/aidsupply" });
  assert.match(impostor.note, /different address/);
});

test("ORG-SUP-D has no record but two open reports", async () => {
  const result = await fresh().verifyOrganization({ organizationId: "ORG-SUP-D" });
  assert.equal(result.found, false);
  assert.equal(result.subjectId, "org:ORG-SUP-D");
  assert.equal(result.record, null);
  assert.equal(result.attestation, null);
  assert.equal(result.reputation, null);
  assert.equal(result.reports.open, 2);
  assert.deepEqual(result.reports.items.map((item) => item.reason).sort(), ["price_anomaly", "unverifiable_address"]);
  for (const item of result.reports.items) assert.deepEqual(Object.keys(item).sort(), ["reason", "reference", "reportedAt"]);
  assert.equal(result.effectiveStatus, "unregistered");
});

test("ORG-TR-3 is revoked, in the record and in the signed attestation", async () => {
  const result = await fresh().verifyOrganization({ organizationId: "ORG-TR-3" });
  assert.equal(result.found, true);
  assert.equal(result.record.status, "revoked");
  assert.equal(result.attestation.payload.status, "revoked");
  assert.equal(result.effectiveStatus, "revoked");
  assert.deepEqual(result.credentials.map((credential) => credential.state), ["revoked"]);
  assert.equal(result.reports.open, 1);
  assert.deepEqual([result.reputation.completed, result.reputation.disputes, result.reputation.fulfilmentRate], [12, 5, 0.58]);
});

test("ORG-SUP-C is active with exactly one expired credential", async () => {
  const result = await fresh().verifyOrganization({ organizationId: "ORG-SUP-C" });
  assert.equal(result.record.status, "active");
  assert.deepEqual(Object.keys(result.record).sort(), ["name", "registeredAt", "status", "type"]);
  const expired = result.credentials.filter((credential) => credential.state === "expired");
  assert.equal(expired.length, 1);
  assert.match(expired[0].type, /Food safety licence/);
  assert.equal(expired[0].validUntil, "2026-09-30");
  assert.equal(result.credentials.filter((credential) => credential.state === "valid").length, 2);
  assert.equal(result.checkedOn, "2026-11-26");
});

test("the seeded organisations match the contract's reputation table", async () => {
  const table = { "ORG-SUP-A": [46, 1, 0.97], "ORG-SUP-B": [31, 0, 0.98], "ORG-SUP-C": [18, 2, 0.89], "ORG-TR-1": [64, 1, 0.96], "ORG-TR-2": [22, 0, 0.95], "ORG-TR-3": [12, 5, 0.58], "ORG-TR-4": [27, 1, 0.93] };
  const store = fresh();
  for (const [organizationId, [completed, disputes, fulfilmentRate]] of Object.entries(table)) {
    const result = store.reputationOf({ subjectId: `org:${organizationId}` });
    assert.equal(result.found, true, organizationId);
    assert.deepEqual([result.reputation.completed, result.reputation.disputes, result.reputation.fulfilmentRate], [completed, disputes, fulfilmentRate], organizationId);
    for (const item of result.reputation.history) assert.deepEqual(Object.keys(item).sort(), ["date", "event", "outcome"]);
  }
  assert.equal(store.reputationOf({ subjectId: "org:ORG-SUP-D" }).found, false);
  assert.equal(store.reputationOf({ subjectId: "org:ORG-SUP-D" }).reputation, null);
  assert.equal(store.reputationOf({ subjectId: "nonsense" }).found, false);
});

test("without the signed documents the registry still answers, with no attestation and a warning", async () => {
  const store = fresh({ attestations: null, keys: null, loadError: "The signed documents could not be loaded: test" });
  const info = store.registryInfo();
  assert.deepEqual(info.registry.keys, []);
  assert.match(info.warning, /could not be loaded/);
  const result = await store.verifyOrganization({ organizationId: "ORG-SUP-A" });
  assert.equal(result.found, true);
  assert.equal(result.attestation, null);
  assert.equal(result.signatureCheck.state, "none");
});

// ---- live status ---------------------------------------------------------------------

test("a live revoked overrides an active attestation in record.status", async () => {
  const store = fresh();
  const done = store.setSubjectStatus({ subjectId: "org:ORG-SUP-A", status: "revoked", reason: "Licence withdrawn (test)" });
  assert.deepEqual([done.ok, done.status, done.previousStatus], [true, "revoked", "active"]);
  const result = await store.verifyOrganization({ organizationId: "ORG-SUP-A" });
  assert.equal(result.record.status, "revoked");
  assert.equal(result.attestation.payload.status, "active", "the signed attestation is unchanged");
  assert.equal(result.signatureCheck.state, "valid");
  assert.equal(result.effectiveStatus, "revoked", "a caller acts on the worse of the two");
  // And back again: the attestation allows active.
  assert.equal(store.setSubjectStatus({ subjectId: "org:ORG-SUP-A", status: "active", reason: "Withdrawn in error" }).ok, true);
  assert.equal((await store.verifyOrganization({ organizationId: "ORG-SUP-A" })).record.status, "active");
  assert.deepEqual(store.state.statusOverrides, {}, "back at the registry's own record, no override is kept");
});

test("set_subject_status refuses bad input, a no-op, and a status better than the attestation", () => {
  const store = fresh();
  const before = JSON.stringify(store.state);
  for (const [args, field] of [
    [{ subjectId: "org:ORG-NOPE", status: "revoked", reason: "because" }, "subjectId"],
    [{ subjectId: "org:ORG-SUP-D", status: "revoked", reason: "because" }, "subjectId"],
    [{ subjectId: "org:ORG-SUP-A", status: "pending", reason: "because" }, "status"],
    [{ subjectId: "org:ORG-SUP-A", status: "deleted", reason: "because" }, "status"],
    [{ subjectId: "org:ORG-SUP-A", status: "suspended", reason: "x" }, "reason"],
    [{ subjectId: "org:ORG-SUP-A", status: "suspended", reason: "y".repeat(201) }, "reason"],
    [{ subjectId: "org:ORG-SUP-A", status: "active", reason: "already so" }, "status"],
    [{ subjectId: "org:ORG-TR-3", status: "active", reason: "reinstate please" }, "status"],
    [{ subjectId: "org:ORG-TR-3", status: "suspended", reason: "soften it" }, "status"],
  ]) {
    const result = store.setSubjectStatus(args);
    assert.equal(result.ok, false, JSON.stringify(args));
    assert.equal(result.field, field, JSON.stringify(args));
    assert.ok(result.reason);
  }
  assert.equal(JSON.stringify(store.state), before, "a refusal changes nothing");
});

test("register_subject records a pending subject with no attestation, and validates every field", async () => {
  const store = fresh();
  const before = JSON.stringify(store.state);
  for (const [args, field] of [
    [{ kind: "company", name: "New Org" }, "kind"],
    [{ kind: "organization", name: "x", organizationId: "ORG-NEW-1" }, "name"],
    [{ kind: "organization", name: "New Org", organizationId: "new-1" }, "organizationId"],
    [{ kind: "organization", name: "New Org", organizationId: "ORG-SUP-A" }, "organizationId"],
    [{ kind: "organization", name: "New Org", organizationId: "ORG-NEW-1", organizationType: "charity" }, "organizationType"],
    [{ kind: "agent_network", name: "New Net" }, "networkUrl"],
    [{ kind: "agent_network", name: "New Net", networkUrl: "nonsense" }, "networkUrl"],
    [{ kind: "agent_network", name: "New Net", networkUrl: "http://plain.example/new_net" }, "networkUrl"],
    [{ kind: "agent_network", name: "New Net", networkUrl: "https://site.example/new_net/" }, "networkUrl"],
    [{ kind: "agent_network", name: "New Net", networkUrl: "https://site.example/new_net?x=1" }, "networkUrl"],
    [{ kind: "agent_network", name: "New Net", networkUrl: "https://elsewhere.example/aidsupply" }, "networkUrl"],
    [{ kind: "agent_network", name: "New Net", networkUrl: "https://site.example/new_net", operator: "o".repeat(81) }, "operator"],
  ]) {
    const result = store.registerSubject(args);
    assert.equal(result.ok, false, JSON.stringify(args));
    assert.equal(result.field, field, JSON.stringify(args));
  }
  assert.equal(JSON.stringify(store.state), before, "a refusal changes nothing");

  const org = store.registerSubject({ kind: "organization", name: "  QuickAid Traders  ", organizationId: "ORG-SUP-D", organizationType: "commercial" });
  assert.deepEqual([org.ok, org.subjectId, org.status, org.name], [true, "org:ORG-SUP-D", "pending", "QuickAid Traders"]);
  const looked = await store.verifyOrganization({ organizationId: "ORG-SUP-D" });
  assert.equal(looked.found, true);
  assert.equal(looked.record.status, "pending");
  assert.equal(looked.attestation, null, "registering on the page signs nothing");
  assert.equal(looked.signatureCheck.state, "none");
  assert.equal(looked.reports.open, 2, "its earlier reports are still on file");
  assert.equal(looked.effectiveStatus, "pending");

  const net = store.registerSubject({ kind: "agent_network", name: "Field Clinic Network", networkUrl: "https://clinic.example/agents/field_clinic" });
  assert.deepEqual([net.ok, net.subjectId], [true, "net:field_clinic"]);
  const found = await store.verifyAgent({ networkUrl: "https://clinic.example/agents/field_clinic" });
  assert.deepEqual([found.found, found.record.status, found.attestation], [true, "pending", null]);
  assert.equal((await store.verifyAgent({ networkUrl: "https://clinic.example/field_clinic" })).found, false, "another path is another network");

  // A pending subject can be suspended or revoked, never made active without an attestation.
  const activate = store.setSubjectStatus({ subjectId: "org:ORG-SUP-D", status: "active", reason: "looks fine to me" });
  assert.equal(activate.ok, false);
  assert.match(activate.reason, /no signed attestation/);
  assert.equal(store.setSubjectStatus({ subjectId: "org:ORG-SUP-D", status: "suspended", reason: "under review" }).ok, true);
});

// ---- reports -------------------------------------------------------------------------

test("report rules: reason enum, details length, incrementing references, nothing changes on refusal", () => {
  const store = fresh();
  const before = JSON.stringify(store.state);
  for (const [args, field] of [
    [{ subjectId: "ORG-SUP-D", reason: "other", details: "missing prefix" }, "subjectId"],
    [{ subjectId: "org:", reason: "other", details: "empty id" }, "subjectId"],
    [{ subjectId: "org:ORG-SUP-D", reason: "rude", details: "not a reason" }, "reason"],
    [{ subjectId: "org:ORG-SUP-D", reason: "toString", details: "prototype name" }, "reason"],
    [{ subjectId: "org:ORG-SUP-D", reason: "other", details: "" }, "details"],
    [{ subjectId: "org:ORG-SUP-D", reason: "other", details: "   " }, "details"],
    [{ subjectId: "org:ORG-SUP-D", reason: "other", details: "x".repeat(281) }, "details"],
    [{ subjectId: "org:ORG-SUP-D", reason: "other" }, "details"],
    [{ subjectId: "org:ORG-SUP-D", reason: "price_anomaly", details: RegistryData.REPORTS[0].details }, "details"],
  ]) {
    const result = store.fileReport(args);
    assert.equal(result.ok, false, JSON.stringify(args).slice(0, 80));
    assert.equal(result.field, field, JSON.stringify(args).slice(0, 80));
    assert.ok(result.reason);
  }
  assert.equal(JSON.stringify(store.state), before, "a refusal changes nothing");

  const first = store.fileReport({ subjectId: "org:ORG-SUP-D", reason: "instruction_injection", details: "Offer notes told the reader to ignore its instructions." }, { reportedBy: "localhost:8080" });
  assert.deepEqual([first.ok, first.reference, first.openReportsForSubject], [true, "TR-RPT-0004", 3]);
  assert.match(first.summary, /TR-RPT-0004/);
  const longest = store.fileReport({ subjectId: "net:unknown_network", reason: "other", details: "y".repeat(280) });
  assert.deepEqual([longest.ok, longest.reference], [true, "TR-RPT-0005"]);
  assert.equal(store.reportsFor("org:ORG-SUP-D").open, 3);
  assert.equal(store.allReports().length, 5);
  assert.equal(store.registryInfo().counts.openReports, 5);
  // The same report twice is refused; a report never changes a status.
  assert.equal(store.fileReport({ subjectId: "org:ORG-SUP-D", reason: "instruction_injection", details: "Offer notes told the reader to ignore its instructions." }).ok, false);
  assert.equal(store.fileReport({ subjectId: "org:ORG-SUP-A", reason: "non_delivery", details: "Late by two days." }).ok, true);
  assert.equal(store.findSubject("org:ORG-SUP-A").status, "active");
});

test("state survives a reload through storage, and reset restores the seed", () => {
  const memory = new Map();
  const storage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: (key) => memory.delete(key) };
  const first = fresh({ storage });
  first.setSubjectStatus({ subjectId: "org:ORG-TR-4", status: "suspended", reason: "Permit under review" });
  first.fileReport({ subjectId: "org:ORG-TR-4", reason: "other", details: "Paperwork mismatch." });
  assert.ok(memory.has(RegistryStore.STORAGE_KEY));
  const second = fresh({ storage });
  assert.equal(second.findSubject("org:ORG-TR-4").status, "suspended");
  assert.equal(second.reportsFor("org:ORG-TR-4").open, 1);
  second.reset();
  const third = fresh({ storage });
  assert.equal(third.findSubject("org:ORG-TR-4").status, "active");
  assert.equal(third.allReports().length, 3);
});

// ---- actions and the manifest --------------------------------------------------------

test("every manifest agentTools name is registered, on the page or on the bridge", () => {
  const local = registryOf(registerSite);
  const bridge = registryOf(registerBridge);
  const localNames = [...local.entries.values()].map((entry) => entry.name);
  const bridgeNames = [...bridge.entries.values()].map((entry) => entry.name);
  for (const name of manifest.actions.agentTools) {
    assert.ok(localNames.includes(name) || bridgeNames.includes(name), `${name} is not registered anywhere`);
  }
  for (const entry of local.entries.values()) assert.equal(entry.availability, "local-only", entry.name);
  for (const name of [...localNames, ...bridgeNames]) assert.ok(manifest.actions.agentTools.includes(name), `${name} is missing from agentTools`);
  assert.deepEqual(localNames.sort(), ["get_registry_info", "get_reputation", "register_subject", "set_subject_status", "verify_agent", "verify_organization"]);
  assert.deepEqual(bridgeNames.sort(), ["get_registry_info", "get_reputation", "report_suspicious_agent", "verify_agent", "verify_organization"]);
  for (const name of ["set_subject_status", "register_subject"]) {
    assert.equal([...local.entries.values()].find((entry) => entry.name === name).effect, "irreversible", name);
  }
});

test("bridge actions are shared only with exact partner origins, and writes never with *", () => {
  const bridge = registryOf(registerBridge);
  // Two callers: ReliefMesh Command and AidSupply. The origins follow the active profile.
  assert.equal(SiteLinks.CALLERS.length, 2);
  assert.ok(!SiteLinks.CALLERS.includes(SiteLinks.SELF));
  for (const entry of bridge.entries.values()) {
    assert.equal(entry.availability, "bridge", entry.name);
    assert.deepEqual(entry.callerOrigins, SiteLinks.CALLERS, entry.name);
    assert.ok(!entry.callerOrigins.includes("*"), entry.name);
    for (const origin of entry.callerOrigins) assert.equal(new URL(origin).origin, origin, "an exact origin");
    if (entry.effect !== "read") assert.equal(entry.confirmsInWindow, true, `${entry.name} must confirm in this site's window`);
  }
  const write = [...bridge.entries.values()].find((entry) => entry.name === "report_suspicious_agent");
  assert.equal(write.effect, "irreversible");
  assert.deepEqual(write.inputSchema.properties.reason.enum, Object.keys(RegistryData.REPORT_REASONS));
  assert.equal(write.inputSchema.properties.details.maxLength, 280);
});

test("a shared read has the same name and input as the page's own action", () => {
  const local = registryOf(registerSite);
  const bridge = registryOf(registerBridge);
  let reads = 0;
  for (const shared of bridge.entries.values()) {
    if (shared.effect !== "read") continue;
    reads += 1;
    const own = [...local.entries.values()].find((entry) => entry.name === shared.name);
    assert.ok(own, `${shared.name} has no page action of the same name`);
    assert.equal(own.effect, "read");
    assert.deepEqual(shared.inputSchema, own.inputSchema);
    assert.equal(shared.description, own.description);
  }
  assert.equal(reads, 4);
  assert.equal(ReadActions.VERIFY_AGENT.inputSchema.required[0], "networkUrl");
});

test("shared reads run through the runtime's registry and return succeeded receipts", async () => {
  // The bridge frame fetches the signed documents; here they are handed over directly.
  RegistryStore.documents = Promise.resolve({ attestations, keys, loadError: "" });
  try {
    const bridge = registryOf(registerBridge);
    const entryOf = (name) => [...bridge.entries.values()].find((item) => item.name === name);

    const url = attestations.attestations["net:shelterconnect"].payload.networkUrl;
    const plan = bridge.prepare({ kind: "action", action: entryOf("verify_agent").ref, arguments: { networkUrl: url } });
    const receipts = await bridge.execute(plan, async () => true, "test-invocation");
    assert.equal(receipts[0].status, "succeeded");
    assert.equal(receipts[0].result.simulated, true);
    assert.equal(receipts[0].result.found, true);
    // What crosses the bridge is still verifiable by the caller.
    assert.equal((await verifyAttestation(receipts[0].result.attestation, keys, { expectedSubjectId: "net:shelterconnect" })).valid, true);

    const info = await bridge.execute(bridge.prepare({ kind: "action", action: entryOf("get_registry_info").ref, arguments: {} }), async () => true, "test-info");
    assert.equal(info[0].status, "succeeded");
    assert.equal(info[0].result.registry.keys[0].fingerprint, keys.keys[0].fingerprint);

    const organisation = await bridge.execute(bridge.prepare({ kind: "action", action: entryOf("verify_organization").ref, arguments: { organizationId: "ORG-SUP-D" } }), async () => true, "test-org");
    assert.deepEqual([organisation[0].status, organisation[0].result.found, organisation[0].result.reports.open], ["succeeded", false, 2]);

    const reputation = await bridge.execute(bridge.prepare({ kind: "action", action: entryOf("get_reputation").ref, arguments: { subjectId: "org:ORG-TR-1" } }), async () => true, "test-rep");
    assert.deepEqual([reputation[0].status, reputation[0].result.reputation.completed], ["succeeded", 64]);

    // The runtime refuses arguments outside the schema before the site's code runs.
    assert.throws(() => bridge.prepare({ kind: "action", action: entryOf("verify_agent").ref, arguments: {} }), /Missing/);
    assert.throws(() => bridge.prepare({ kind: "action", action: entryOf("verify_agent").ref, arguments: { networkUrl: url, extra: 1 } }), /Unexpected/);
    assert.throws(() => bridge.prepare({ kind: "action", action: entryOf("report_suspicious_agent").ref, arguments: { subjectId: "org:ORG-SUP-D", reason: "rude", details: "x" } }), /Invalid/);
    assert.throws(() => bridge.prepare({ kind: "action", action: entryOf("report_suspicious_agent").ref, arguments: { subjectId: "org:ORG-SUP-D", reason: "other", details: "x".repeat(281) } }), /Invalid/);
  } finally {
    RegistryStore.documents = null;
  }
});

test("the seed is complete and consistent", () => {
  assert.deepEqual(RegistryData.AGENT_NETWORKS.map((seed) => seed.subjectId), ["net:reliefmesh_command", "net:shelterconnect", "net:aidsupply", "net:routebridge"]);
  for (const [seed, type] of RegistryData.seededSubjects()) {
    assert.match(seed.subjectId, RegistryStore.SUBJECT_ID);
    assert.ok(seed.name && seed.registeredAt, seed.subjectId);
    assert.ok(RegistryData.STATUSES.includes(seed.status), seed.subjectId);
    assert.ok(seed.credentials.length >= 1, seed.subjectId);
    if (type === "agent_network") assert.equal(seed.subjectId, `net:${seed.network}`);
    else assert.equal(seed.subjectId, `org:${seed.organizationId}`);
    for (const credential of seed.credentials) {
      assert.match(credential.type, /simulated/, "every credential says it is simulated");
      assert.ok(credential.validFrom < credential.validUntil, credential.id);
    }
  }
  assert.ok(!RegistryData.ORGANIZATIONS.some((seed) => seed.organizationId === "ORG-SUP-D"), "QuickAid Traders has no record");
  for (const report of RegistryData.REPORTS) assert.ok(Object.hasOwn(RegistryData.REPORT_REASONS, report.reason));
});
