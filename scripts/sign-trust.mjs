// Signs TrustRegistry's attestations, offline.
//
//   node scripts/sign-trust.mjs            sign what changed; write attestations.json and trust-keys.json
//   node scripts/sign-trust.mjs --force    re-issue every attestation, even unchanged ones
//   node scripts/sign-trust.mjs --verify   verify the published files; needs no private key; exit 1 on failure
//
// The registry's AUTHORITY is simulated (its records and credentials are invented for the
// demonstration). The SIGNATURES are real: ECDSA P-256 / SHA-256 over the canonical JSON of
// each payload, verifiable by anyone with trust-keys.json (docs/INTEROP_CONTRACTS.md §3).
//
// The private key lives in sites/trustregistry/.keys/registry-private.jwk, which is
// git-ignored. It is created on first use and never printed. Whoever holds it is the
// registry: a clone without it gets a new key, and callers that pinned the old
// fingerprint are warned, which is the point of pinning.
//
// For each agent network the script attests the SHA-256 of the exact bytes of its
// published <network>.network.json, so a caller can detect a network definition that
// changed after the registry looked at it. Re-run it whenever a network file changes.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { abs, readOrigins, siteById, SITES } from "./lib/sites.mjs";
import { canonicalJson, jwkFingerprint, sha256Digest, toBase64Url, utf8, verifyAttestation } from "../sites/trustregistry/js/canonical.js";
import { RegistryData } from "../sites/trustregistry/js/registry-data.js";

const REGISTRY = siteById("trustregistry");
const KEY_FILE = abs(REGISTRY.root, ".keys", "registry-private.jwk");
const ATTESTATIONS_FILE = abs(REGISTRY.root, "attestations.json");
const KEYS_FILE = abs(REGISTRY.root, "trust-keys.json");
const DAY_MS = 86_400_000;
// An unchanged attestation is re-issued once it has less than this left to run.
const RENEW_WHEN_DAYS_LEFT = 30;

const args = process.argv.slice(2);
const verifyOnly = args.includes("--verify");
const force = args.includes("--force");

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function publicPart(jwk) {
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
}

async function loadOrCreatePrivateKey() {
  let jwk = await readJson(KEY_FILE);
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d) {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const exported = await crypto.subtle.exportKey("jwk", pair.privateKey);
    jwk = { kty: exported.kty, crv: exported.crv, x: exported.x, y: exported.y, d: exported.d };
    await mkdir(path.dirname(KEY_FILE), { recursive: true });
    await writeFile(KEY_FILE, `${JSON.stringify(jwk, null, 2)}\n`, { mode: 0o600 });
    console.log(`Created a new registry key pair in ${path.relative(abs(), KEY_FILE)} (git-ignored; keep it private).`);
  }
  const signingKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  return { signingKey, publicJwk: publicPart(jwk) };
}

/** What the registry knows about one site's published network, read from disk. */
async function networkFacts(networkName, profile) {
  const site = SITES.find((entry) => entry.network === networkName);
  if (!site) throw new Error(`registry-data.js names the network "${networkName}", which scripts/lib/sites.mjs does not know.`);
  const networkFile = abs(site.root, `${site.network}.network.json`);
  const facts = { site, networkUrl: `${profile[site.id]}/${site.network}`, networkDigest: null, capabilities: [], networkFile };
  if (!existsSync(networkFile)) return { ...facts, missing: true };
  facts.networkDigest = await sha256Digest(await readFile(networkFile));
  const manifest = await readJson(abs(site.root, "agent-manifest.json"));
  const capabilities = manifest?.reliefmesh?.capabilities;
  facts.capabilities = Array.isArray(capabilities) ? capabilities.map(String) : [];
  return facts;
}

function payloadFor(seed, type, facts, issuedAt, expiresAt) {
  const payload = { v: 1, type, subjectId: seed.subjectId, name: seed.name, status: seed.status };
  if (type === "agent_network") {
    payload.networkUrl = facts.networkUrl;
    payload.networkDigest = facts.networkDigest;
    payload.capabilities = facts.capabilities;
  }
  payload.credentials = seed.credentials.map((credential) => ({
    type: credential.type,
    issuer: credential.issuer,
    id: credential.id,
    validFrom: credential.validFrom,
    validUntil: credential.validUntil,
  }));
  payload.issuedAt = issuedAt;
  payload.expiresAt = expiresAt;
  payload.simulated = true;
  return payload;
}

async function sign() {
  const { profile, active } = await readOrigins();
  const { signingKey, publicJwk } = await loadOrCreatePrivateKey();
  const fingerprint = await jwkFingerprint(publicJwk);
  const kid = `tr-${fingerprint.replace("sha256:", "").slice(0, 12)}`;
  const issuer = `${profile.trustregistry}/trustregistry`;

  const previousKeys = await readJson(KEYS_FILE);
  const previous = await readJson(ATTESTATIONS_FILE);
  const previousKey = previousKeys?.keys?.find((key) => key.kid === kid && key.fingerprint === fingerprint);
  const keysDoc = {
    registry: RegistryData.REGISTRY_NAME,
    simulatedAuthority: true,
    algorithm: RegistryData.ALGORITHM,
    keys: [{ kid, use: "sig", publicKeyJwk: publicJwk, fingerprint, createdAt: previousKey?.createdAt || new Date().toISOString() }],
  };

  const now = new Date();
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + RegistryData.ATTESTATION_DAYS * DAY_MS).toISOString();
  const attestations = {};
  let reused = 0;
  let issued = 0;

  for (const [seed, type] of RegistryData.seededSubjects()) {
    let facts = null;
    if (type === "agent_network") {
      facts = await networkFacts(seed.network, profile);
      if (facts.missing) {
        console.log(`WARNING: ${path.relative(abs(), facts.networkFile)} does not exist yet. ${seed.subjectId} is attested with networkDigest null and no capabilities. Build that site, then run this again.`);
      }
    }
    // Keep an existing attestation when nothing it states has changed, so that a rebuild
    // that changes nothing leaves the published files byte for byte the same.
    const old = previous?.attestations?.[seed.subjectId];
    if (!force && old && old.kid === kid && previous.issuer === issuer) {
      const same = payloadFor(seed, type, facts, old.payload?.issuedAt, old.payload?.expiresAt);
      const fresh = Date.parse(old.payload?.expiresAt) - now.getTime() > RENEW_WHEN_DAYS_LEFT * DAY_MS;
      if (fresh && canonicalJson(same) === canonicalJson(old.payload) && (await verifyAttestation(old, keysDoc)).valid) {
        attestations[seed.subjectId] = { payload: old.payload, signature: old.signature, kid };
        reused += 1;
        continue;
      }
    }
    const payload = payloadFor(seed, type, facts, issuedAt, expiresAt);
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, utf8(canonicalJson(payload)));
    attestations[seed.subjectId] = { payload, signature: toBase64Url(new Uint8Array(signature)), kid };
    issued += 1;
  }

  const unchanged = issued === 0 && previous && Object.keys(previous.attestations || {}).length === Object.keys(attestations).length;
  const document = { issuer, issuedAt: unchanged ? previous.issuedAt : issuedAt, attestations };
  await writeFile(ATTESTATIONS_FILE, `${JSON.stringify(document, null, 2)}\n`);
  await writeFile(KEYS_FILE, `${JSON.stringify(keysDoc, null, 2)}\n`);

  console.log(`Origins profile: ${active}. Issuer: ${issuer}`);
  console.log(`Registry key: ${kid}  ${fingerprint}`);
  console.log(`Attestations: ${issued} signed, ${reused} unchanged and kept.`);
  console.log(`Wrote ${path.relative(abs(), ATTESTATIONS_FILE)} and ${path.relative(abs(), KEYS_FILE)}`);
  return 0;
}

async function verify() {
  const { profile, active } = await readOrigins();
  let errors = 0;
  const ok = (text) => console.log(`OK: ${text}`);
  const fail = (text) => { errors += 1; console.log(`ERROR: ${text}`); };

  const keysDoc = await readJson(KEYS_FILE);
  const document = await readJson(ATTESTATIONS_FILE);
  if (!keysDoc || !Array.isArray(keysDoc.keys) || !keysDoc.keys.length) fail(`${path.relative(abs(), KEYS_FILE)} is missing or has no keys. Run: npm run trust:sign`);
  if (!document || !document.attestations) fail(`${path.relative(abs(), ATTESTATIONS_FILE)} is missing or has no attestations. Run: npm run trust:sign`);
  if (errors) return 1;

  console.log(`Origins profile: ${active}`);
  for (const key of keysDoc.keys) {
    const actual = await jwkFingerprint(key.publicKeyJwk).catch((error) => `unreadable (${error.message})`);
    if (actual === key.fingerprint) ok(`key ${key.kid} fingerprint ${actual}`);
    else fail(`key ${key.kid} declares ${key.fingerprint} but its public key hashes to ${actual}.`);
    if (Object.hasOwn(key.publicKeyJwk || {}, "d")) fail(`key ${key.kid} publishes a private member "d". Delete the file and sign again.`);
  }
  const issuer = `${profile.trustregistry}/trustregistry`;
  if (document.issuer === issuer) ok(`issuer ${document.issuer}`);
  else fail(`issuer is ${document.issuer}, but the active origins profile says ${issuer}. Run: npm run trust:sign`);

  const expected = RegistryData.seededSubjects();
  for (const [seed, type] of expected) {
    const entry = document.attestations[seed.subjectId];
    if (!entry) { fail(`${seed.subjectId} has no attestation. Run: npm run trust:sign`); continue; }
    const outcome = await verifyAttestation(entry, keysDoc, { expectedSubjectId: seed.subjectId, now: new Date() });
    if (!outcome.valid) { fail(`${seed.subjectId} signature: ${outcome.reason}`); continue; }
    if (outcome.expired) { fail(`${seed.subjectId} signature is valid, but the attestation expired on ${entry.payload.expiresAt}. Run: npm run trust:sign`); continue; }
    ok(`${seed.subjectId} signature valid (${entry.kid}), status ${entry.payload.status}, expires ${String(entry.payload.expiresAt).slice(0, 10)}`);
    if (entry.payload.status !== seed.status) fail(`${seed.subjectId} is attested as ${entry.payload.status}, but the registry record says ${seed.status}. Run: npm run trust:sign`);
    if (type !== "agent_network") continue;
    const facts = await networkFacts(seed.network, profile);
    if (entry.payload.networkUrl !== facts.networkUrl) {
      fail(`${seed.subjectId} is attested at ${entry.payload.networkUrl}, but the active origins profile says ${facts.networkUrl}. Run: npm run trust:sign`);
    }
    if (facts.missing) {
      if (entry.payload.networkDigest === null) console.log(`WARNING: ${seed.subjectId} has no network digest yet: ${path.relative(abs(), facts.networkFile)} does not exist. Build that site, then run: npm run trust:sign`);
      else fail(`${seed.subjectId} attests a digest, but ${path.relative(abs(), facts.networkFile)} does not exist.`);
      continue;
    }
    if (entry.payload.networkDigest === facts.networkDigest) ok(`${seed.subjectId} network digest matches ${path.relative(abs(), facts.networkFile)}`);
    else fail(`${seed.subjectId} network digest is stale: attested ${entry.payload.networkDigest}, file is ${facts.networkDigest}. Run: npm run trust:sign`);
    if (canonicalJson(entry.payload.capabilities) !== canonicalJson(facts.capabilities)) {
      fail(`${seed.subjectId} capabilities differ from its manifest's reliefmesh.capabilities. Run: npm run trust:sign`);
    }
  }
  const known = new Set(expected.map(([seed]) => seed.subjectId));
  for (const subjectId of Object.keys(document.attestations)) {
    if (!known.has(subjectId)) fail(`${subjectId} is attested but has no record in registry-data.js.`);
  }
  console.log(errors ? `\n${errors} problem(s). The published trust files do NOT verify.` : "\nAll published attestations verify.");
  return errors ? 1 : 0;
}

process.exitCode = verifyOnly ? await verify() : await sign();
