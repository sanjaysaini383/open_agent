// Cryptographic checks, done with the platform's WebCrypto. Nothing here is simulated:
// when this module says a signature is valid, an ECDSA P-256 / SHA-256 signature was
// really verified against the registry's public key.
//
// The scheme is the one TrustRegistry documents (docs/INTEROP_CONTRACTS.md, section 3):
// canonical JSON (keys sorted at every level, no whitespace), IEEE P1363 signatures,
// base64url without padding.

export interface PublicJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(",")}}`;
}

export function base64UrlToBytes(text: string): Uint8Array {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(view, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return bytesToHex(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

/** RFC 7638 thumbprint input for an EC key, hashed with SHA-256 and written as hex. */
export async function jwkFingerprint(jwk: PublicJwk): Promise<string> {
  const input = `{"crv":${JSON.stringify(jwk.crv)},"kty":${JSON.stringify(jwk.kty)},"x":${JSON.stringify(jwk.x)},"y":${JSON.stringify(jwk.y)}}`;
  return `sha256:${await sha256Hex(input)}`;
}

export interface SignatureCheck {
  valid: boolean;
  reason: string;
}

/** Verify a registry signature over a payload. Never throws: a failure is a result. */
export async function verifySignature(payload: unknown, signatureB64Url: string, jwk: PublicJwk): Promise<SignatureCheck> {
  try {
    const key = await crypto.subtle.importKey("jwk", { ...jwk, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const signature = base64UrlToBytes(signatureB64Url);
    if (signature.length !== 64) return { valid: false, reason: `Signature is ${signature.length} bytes; an ECDSA P-256 signature is 64.` };
    const data = new TextEncoder().encode(canonicalJson(payload));
    const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature as BufferSource, data as BufferSource);
    return valid
      ? { valid: true, reason: "ECDSA P-256 / SHA-256 signature verified against the registry key." }
      : { valid: false, reason: "Signature does not match the payload: it was altered, or signed by another key." };
  } catch (error) {
    return { valid: false, reason: `Signature could not be checked: ${(error as Error).message}` };
  }
}

/** SHA-256 of a published file's exact bytes, as "sha256:<hex>". */
export async function digestOfBytes(bytes: ArrayBuffer): Promise<string> {
  return `sha256:${await sha256Hex(bytes)}`;
}
