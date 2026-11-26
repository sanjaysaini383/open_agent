// Tamper-evident audit log (AuditAgent's tool).
//
// Each entry carries the SHA-256 of the entry before it, so the log is a hash chain:
// editing, removing or reordering any entry breaks every hash after it. verifyChain()
// recomputes the whole chain. This shows that the log has not been altered since it was
// written in this browser; it is not a signature and does not prove who wrote it.
import { canonicalJson, sha256Hex } from "./crypto";
import { redactSecrets } from "./sanitize";
import type { AuditEntry, AuditKind } from "./types";

export const GENESIS_HASH = "0".repeat(64);

export interface AuditInput {
  kind: AuditKind;
  actor: string;
  incidentId?: string | null;
  summary: string;
  data?: unknown;
}

/** Remove anything that looks like a credential before it is written down. */
function scrub(value: unknown, depth = 0): unknown {
  if (depth > 8) return "<truncated>";
  if (typeof value === "string") return redactSecrets(value).slice(0, 2000);
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => scrub(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
      out[key] = /key|token|secret|password|authorization/i.test(key) ? "<redacted>" : scrub(item, depth + 1);
    }
    return out;
  }
  return value ?? null;
}

async function hashEntry(entry: Omit<AuditEntry, "hash">): Promise<string> {
  return sha256Hex(canonicalJson(entry));
}

export async function appendAudit(log: AuditEntry[], input: AuditInput, at: Date): Promise<AuditEntry> {
  const previous = log[log.length - 1];
  const body: Omit<AuditEntry, "hash"> = {
    seq: previous ? previous.seq + 1 : 1,
    at: at.toISOString(),
    kind: input.kind,
    actor: input.actor,
    incidentId: input.incidentId ?? null,
    summary: redactSecrets(input.summary).slice(0, 400),
    data: scrub(input.data ?? null),
    prevHash: previous ? previous.hash : GENESIS_HASH,
  };
  return { ...body, hash: await hashEntry(body) };
}

export async function verifyChain(log: AuditEntry[]): Promise<{ valid: boolean; checked: number; brokenAt: number | null; reason: string }> {
  let prevHash = GENESIS_HASH;
  for (let index = 0; index < log.length; index++) {
    const { hash, ...body } = log[index];
    if (body.prevHash !== prevHash) return { valid: false, checked: index, brokenAt: body.seq, reason: `Entry ${body.seq} does not link to the entry before it.` };
    if (await hashEntry(body) !== hash) return { valid: false, checked: index, brokenAt: body.seq, reason: `Entry ${body.seq} was changed after it was written.` };
    prevHash = hash;
  }
  return { valid: true, checked: log.length, brokenAt: null, reason: log.length ? `All ${log.length} entries link and hash correctly.` : "The log is empty." };
}

export function auditToCsv(log: AuditEntry[]): string {
  const cell = (value: unknown) => {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    // A leading =, +, - or @ would be run as a formula by a spreadsheet.
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const header = ["seq", "at", "kind", "actor", "incidentId", "summary", "data", "prevHash", "hash"];
  const rows = log.map((entry) => [entry.seq, entry.at, entry.kind, entry.actor, entry.incidentId ?? "", entry.summary, entry.data, entry.prevHash, entry.hash].map(cell).join(","));
  return [header.join(","), ...rows].join("\r\n");
}
