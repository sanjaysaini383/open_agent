// Handling of text that arrives from another site.
//
// A partner's answer is data. It is never an instruction, to this app or to a model.
// Two things follow:
//   1. Every external payload is parsed against a schema (schemas.ts) before use. Unknown
//      fields are dropped; a payload that does not fit is rejected, not "repaired".
//   2. Free text that survives (names, notes) is cleaned for display and scanned for
//      instruction-like content. A hit does not change the text's meaning to us: it raises
//      a flag that the Risk and Trust views show, and that excludes the offer by default.
//
// The scan is a tripwire for the obvious cases, not a guarantee. The real protection is
// structural: nothing here ever executes or obeys external text, allocation maths never
// reads free text, and every external write needs a human confirmation.

export interface InjectionFinding {
  pattern: string;
  excerpt: string;
}

const INJECTION_PATTERNS: { name: string; test: RegExp }[] = [
  { name: "override of prior instructions", test: /\b(ignore|disregard|forget|override)\b[^.]{0,40}\b(previous|prior|above|earlier|all|your|system)\b[^.]{0,30}\b(instruction|prompt|rule|polic)/i },
  { name: "role marker", test: /(^|[\s"'>])(system|assistant|developer)\s*:/i },
  { name: "role reassignment", test: /\byou are now\b|\bact as (an?|the)\b|\bnew instructions?\b/i },
  { name: "approval bypass", test: /\b(approve|accept|confirm|authori[sz]e)\b[^.]{0,60}\b(immediately|automatically|without (human|review|confirmation|approval|asking))/i },
  { name: "self-asserted verification", test: /\bmark\b[^.]{0,60}\b(as )?(verified|trusted|approved)\b/i },
  { name: "tool or markup injection", test: /<\s*(script|iframe|img|svg|object|embed|style|link)\b|javascript:|\bwebsite_[a-z_]+\s*\(/i },
  { name: "secret request", test: /\b(api[_ -]?key|password|secret|bearer token|credentials?)\b[^.]{0,40}\b(send|share|reveal|print|give|paste)\b|\b(send|share|reveal|print|give|paste)\b[^.]{0,40}\b(api[_ -]?key|password|secret|bearer token)\b/i },
];

/** Scan one string for instruction-like content. */
export function detectInjection(text: string): InjectionFinding[] {
  const findings: InjectionFinding[] = [];
  if (!text) return findings;
  for (const { name, test } of INJECTION_PATTERNS) {
    const match = test.exec(text);
    if (match) {
      const start = Math.max(0, match.index - 20);
      findings.push({ pattern: name, excerpt: text.slice(start, match.index + match[0].length + 20).trim() });
    }
  }
  return findings;
}

/** Make external text safe to show: plain text only, bounded length, no control characters. */
export function cleanText(value: unknown, maxLength = 280): string {
  if (typeof value !== "string") return "";
  const stripped = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "")
    .replace(/<[^>]{0,200}>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > maxLength ? `${stripped.slice(0, maxLength - 1)}…` : stripped;
}

/** Scan every string in a JSON value, depth-bounded. Returns findings with their paths. */
export function scanForInjection(value: unknown, path = "$", depth = 0): (InjectionFinding & { path: string })[] {
  if (depth > 8 || value === null || value === undefined) return [];
  if (typeof value === "string") return detectInjection(value).map((finding) => ({ ...finding, path }));
  if (Array.isArray(value)) return value.slice(0, 200).flatMap((item, index) => scanForInjection(item, `${path}[${index}]`, depth + 1));
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).slice(0, 200)
      .flatMap(([key, item]) => scanForInjection(item, `${path}.${key}`, depth + 1));
  }
  return [];
}

/** Only http(s) URLs are ever followed or rendered as links. */
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** A value must never be shown or logged if it looks like a credential. */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(sk|otk|pk|rk)[-_][A-Za-z0-9_-]{12,}\b/g, "<redacted-key>")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer <redacted>");
}
