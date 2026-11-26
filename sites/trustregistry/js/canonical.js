// Canonical JSON, key fingerprints and attestation verification for TrustRegistry.
//
// This is the whole verification scheme, in one dependency-free module that runs unchanged
// in browsers and in Node 22+. It uses only WebCrypto (crypto.subtle), TextEncoder, btoa
// and atob. scripts/sign-trust.mjs signs with the same canonicalJson, so signer and
// verifier can never disagree about the bytes.
//
// Scheme (docs/INTEROP_CONTRACTS.md, section 3):
//   canonical form  JSON, object keys sorted at every level, no whitespace, integers only
//   signature       ECDSA P-256 / SHA-256 over the UTF-8 bytes of the canonical form,
//                   IEEE P1363 (r || s, 64 bytes), base64url without padding
//   fingerprint     "sha256:" + hex SHA-256 of {"crv":"P-256","kty":"EC","x":"…","y":"…"}

const ENCODER = new TextEncoder();

/**
 * Serialise a JSON value with object keys sorted lexicographically at every level and no
 * whitespace. Keys whose value is undefined are left out, as JSON.stringify does.
 *
 * :raises Error: For a number that is not a safe integer, or a value JSON cannot hold.
 */
export function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("canonicalJson: every number must be a safe integer.");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(",")}]`;
  if (typeof value === "object") {
    const parts = [];
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    }
    return `{${parts.join(",")}}`;
  }
  throw new Error(`canonicalJson: a ${typeof value} cannot be serialised.`);
}

/** UTF-8 bytes of a string. */
export function utf8(text) {
  return ENCODER.encode(String(text));
}

/** Lower-case hex of a byte array. */
export function toHex(bytes) {
  let out = "";
  for (const byte of new Uint8Array(bytes)) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** base64url without padding. */
export function toBase64Url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decode base64url without padding.
 *
 * :raises Error: For anything that is not the one canonical encoding of its bytes, so two
 *   different strings never decode to the same signature.
 */
export function fromBase64Url(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) {
    throw new Error("Not base64url.");
  }
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (toBase64Url(bytes) !== text) throw new Error("Not canonical base64url.");
  return bytes;
}

function subtle() {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new Error("WebCrypto is unavailable. It needs https, localhost, or Node 22+.");
  return api;
}

/** "sha256:<hex>" of a string (as UTF-8) or of bytes. */
export async function sha256Digest(data) {
  const bytes = typeof data === "string" ? utf8(data) : data;
  return `sha256:${toHex(await subtle().digest("SHA-256", bytes))}`;
}

/** The RFC 7638 thumbprint input of an EC public key: required members, sorted, no whitespace. */
export function jwkThumbprintInput(jwk) {
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.x !== "string" || typeof jwk.y !== "string") {
    throw new Error("Only EC P-256 public keys are supported.");
  }
  return `{"crv":${JSON.stringify(jwk.crv)},"kty":${JSON.stringify(jwk.kty)},"x":${JSON.stringify(jwk.x)},"y":${JSON.stringify(jwk.y)}}`;
}

/** The key fingerprint: "sha256:<hex>" of the thumbprint input. */
export async function jwkFingerprint(jwk) {
  return sha256Digest(jwkThumbprintInput(jwk));
}

/** Import an EC P-256 public JWK for signature verification. */
export async function importVerifyKey(jwk) {
  jwkThumbprintInput(jwk);
  return subtle().importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
}

/**
 * Verify one signed attestation against the registry's published keys.
 *
 * :param entry: {payload, signature, kid}, as attestations.json and the verify_* actions return it.
 * :param keysDoc: trust-keys.json: {keys: [{kid, publicKeyJwk, fingerprint, ...}]}.
 * :param options: Optional. expectedSubjectId: the subject the caller asked about; the
 *   attestation must be for it. now: a Date, to also report whether it has expired.
 * :return: {valid, signatureValid, reason, kid, fingerprint, expired}. valid is true only
 *   when the signature matches the payload and, if expectedSubjectId was given, the
 *   payload is for that subject. fingerprint is recomputed from the key actually used, so
 *   a caller can compare it with the fingerprint it has pinned. expired is null when no
 *   `now` was given. This function never throws: every failure is a reason.
 */
export async function verifyAttestation(entry, keysDoc, options = {}) {
  const result = { valid: false, signatureValid: false, reason: "", kid: entry?.kid ?? null, fingerprint: null, expired: null };
  try {
    if (!entry || typeof entry !== "object" || !entry.payload || typeof entry.payload !== "object" || typeof entry.signature !== "string") {
      return { ...result, reason: "No attestation to verify." };
    }
    const key = (Array.isArray(keysDoc?.keys) ? keysDoc.keys : []).find((item) => item && item.kid === entry.kid);
    if (!key) return { ...result, reason: `No published registry key has the id ${entry.kid}.` };
    result.fingerprint = await jwkFingerprint(key.publicKeyJwk);
    const signature = fromBase64Url(entry.signature);
    if (signature.length !== 64) return { ...result, reason: "The signature is not a 64-byte P-256 signature." };
    const publicKey = await importVerifyKey(key.publicKeyJwk);
    result.signatureValid = await subtle().verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, signature, utf8(canonicalJson(entry.payload)));
    if (!result.signatureValid) return { ...result, reason: "The signature does not match the payload." };
    if (options.expectedSubjectId !== undefined && entry.payload.subjectId !== options.expectedSubjectId) {
      return { ...result, reason: `The attestation is signed for ${entry.payload.subjectId}, not for ${options.expectedSubjectId}.` };
    }
    if (options.now instanceof Date) {
      const expires = Date.parse(entry.payload.expiresAt);
      result.expired = !Number.isFinite(expires) || expires < options.now.getTime();
    }
    return { ...result, valid: true, reason: result.expired ? "Signature valid, but the attestation has expired." : "Signature valid." };
  } catch (error) {
    return { ...result, valid: false, reason: String(error?.message || error) };
  }
}
