// Trust scoring (TrustVerificationAgent's tool).
//
// The score is a transparent sum of documented evidence. Each line of evidence has a
// fixed weight and says what was checked and what was found, so a person can see exactly
// why a partner got its score. Nothing here is a model's opinion.
//
// Hard rules that no score can override:
//   - a revoked or suspended record               -> blocked
//   - a signature that fails verification         -> blocked
//   - a published network that does not match the attested digest -> blocked
//   - no registry record at all                   -> unverified (never "trusted")
//   - an expired or revoked credential, or open reports -> at most "caution"
import type { TrustDecision, TrustEvaluation, TrustEvidence } from "./types";

export interface TrustInputs {
  subjectId: string;
  subjectType: "agent_network" | "organization";
  name: string;
  registry: string;
  now: Date;
  /** Whether the registry answered with a record. */
  found: boolean;
  liveStatus: "active" | "suspended" | "revoked" | "pending" | null;
  attestation: {
    status: "active" | "suspended" | "revoked";
    expiresAt: string;
    credentials: { type: string; validUntil: string; status?: string }[];
    capabilities?: string[];
    networkDigest?: string | null;
  } | null;
  /** Result of the real signature check; null when there was nothing to check. */
  signature: { valid: boolean; reason: string } | null;
  /** agent_network only: digest of the published network file as fetched just now. */
  observedDigest?: string | null;
  /** agent_network only: capabilities the site itself advertises in its manifest. */
  advertisedCapabilities?: string[];
  reputation: { completed: number; disputes: number; fulfilmentRate: number } | null;
  openReports: number;
}

export const NETWORK_WEIGHTS = { identity: 30, signature: 25, integrity: 20, capabilities: 10, freshness: 5, reports: 10 } as const;
export const ORGANIZATION_WEIGHTS = { identity: 25, signature: 20, credentials: 20, reputation: 25, reports: 10 } as const;

export const THRESHOLDS = { verified: 75, caution: 50 } as const;

const worstStatus = (a: string | null, b: string | null): string | null => {
  const order = ["revoked", "suspended", "pending", "active"];
  const present = [a, b].filter((value): value is string => !!value);
  if (!present.length) return null;
  return present.sort((x, y) => order.indexOf(x) - order.indexOf(y))[0];
};

/** Reputation points out of `max`: mostly the fulfilment rate, a little for track record, minus disputes. */
export function reputationPoints(reputation: { completed: number; disputes: number; fulfilmentRate: number }, max: number): number {
  const raw = reputation.fulfilmentRate * (max * 0.8) + (Math.min(reputation.completed, 25) / 25) * (max * 0.2) - reputation.disputes;
  return Math.max(0, Math.min(max, Math.round(raw)));
}

export function evaluateTrust(input: TrustInputs): TrustEvaluation {
  const evidence: TrustEvidence[] = [];
  const warnings: string[] = [];
  const blockers: string[] = [];
  const isNetwork = input.subjectType === "agent_network";
  const weights = isNetwork ? NETWORK_WEIGHTS : ORGANIZATION_WEIGHTS;
  const status = worstStatus(input.liveStatus, input.attestation?.status ?? null);

  // 1. Identity record
  if (!input.found) {
    evidence.push({ id: "identity", label: "Identity record", weight: weights.identity, earned: 0, status: "fail", detail: `${input.registry} has no record for this subject.` });
  } else if (status === "active") {
    evidence.push({ id: "identity", label: "Identity record", weight: weights.identity, earned: weights.identity, status: "pass", detail: `Registered and active in ${input.registry}.` });
  } else if (status === "pending") {
    const earned = Math.round(weights.identity / 3);
    evidence.push({ id: "identity", label: "Identity record", weight: weights.identity, earned, status: "warn", detail: "Registered, but the registry has not attested this record yet." });
    warnings.push("Registry record is pending: no signed attestation exists.");
  } else {
    evidence.push({ id: "identity", label: "Identity record", weight: weights.identity, earned: 0, status: "fail", detail: `Record status is ${status}.` });
    blockers.push(`The registry lists this subject as ${status}.`);
  }

  // 2. Signature
  let signatureVerified = false;
  if (!input.attestation || !input.signature) {
    evidence.push({ id: "signature", label: "Signed attestation", weight: weights.signature, earned: 0, status: input.found ? "warn" : "info", detail: "No signed attestation to verify." });
    if (input.found) warnings.push("No signed attestation was provided, so nothing was cryptographically verified.");
  } else if (input.signature.valid) {
    signatureVerified = true;
    evidence.push({ id: "signature", label: "Signed attestation", weight: weights.signature, earned: weights.signature, status: "pass", detail: input.signature.reason });
  } else {
    evidence.push({ id: "signature", label: "Signed attestation", weight: weights.signature, earned: 0, status: "fail", detail: input.signature.reason });
    blockers.push("The attestation's signature failed verification.");
  }

  // An attestation whose signature failed tells us nothing: ignore its contents below.
  const attested = signatureVerified ? input.attestation : null;
  const expired = attested ? Date.parse(attested.expiresAt) < input.now.getTime() : false;

  if (isNetwork) {
    // 3. Integrity of the published network definition
    const w = NETWORK_WEIGHTS.integrity;
    if (!attested || !attested.networkDigest) {
      evidence.push({ id: "integrity", label: "Network definition integrity", weight: w, earned: 0, status: "warn", detail: "No attested digest to compare the published network file against." });
    } else if (!input.observedDigest) {
      evidence.push({ id: "integrity", label: "Network definition integrity", weight: w, earned: 0, status: "warn", detail: "The published network file could not be fetched for comparison." });
      warnings.push("Network file could not be compared with its attested digest.");
    } else if (input.observedDigest === attested.networkDigest) {
      evidence.push({ id: "integrity", label: "Network definition integrity", weight: w, earned: w, status: "pass", detail: `SHA-256 of the published network file matches the attested digest (${attested.networkDigest.slice(0, 19)}…).` });
    } else {
      evidence.push({ id: "integrity", label: "Network definition integrity", weight: w, earned: 0, status: "fail", detail: "The published network file differs from the one the registry attested." });
      blockers.push("The published network definition changed since it was attested.");
    }

    // 4. Advertised capabilities are all attested
    const cw = NETWORK_WEIGHTS.capabilities;
    const advertised = input.advertisedCapabilities || [];
    const attestedCaps = attested?.capabilities || [];
    if (!attested) {
      evidence.push({ id: "capabilities", label: "Capability validation", weight: cw, earned: 0, status: "info", detail: "No verified attestation to validate capabilities against." });
    } else if (!advertised.length) {
      evidence.push({ id: "capabilities", label: "Capability validation", weight: cw, earned: Math.round(cw / 2), status: "warn", detail: "The site advertises no capabilities in its manifest." });
    } else {
      const unattested = advertised.filter((capability) => !attestedCaps.includes(capability));
      if (!unattested.length) {
        evidence.push({ id: "capabilities", label: "Capability validation", weight: cw, earned: cw, status: "pass", detail: `All ${advertised.length} advertised capabilities are attested.` });
      } else {
        const earned = Math.round(cw * (1 - unattested.length / advertised.length));
        evidence.push({ id: "capabilities", label: "Capability validation", weight: cw, earned, status: "warn", detail: `Advertised but not attested: ${unattested.join(", ")}.` });
        warnings.push(`Unattested capabilities: ${unattested.join(", ")}.`);
      }
    }

    // 5. Freshness
    const fw = NETWORK_WEIGHTS.freshness;
    if (!attested) evidence.push({ id: "freshness", label: "Attestation freshness", weight: fw, earned: 0, status: "info", detail: "No verified attestation." });
    else if (expired) { evidence.push({ id: "freshness", label: "Attestation freshness", weight: fw, earned: 0, status: "warn", detail: `Attestation expired on ${attested.expiresAt.slice(0, 10)}.` }); warnings.push("The attestation has expired."); }
    else evidence.push({ id: "freshness", label: "Attestation freshness", weight: fw, earned: fw, status: "pass", detail: `Valid until ${attested.expiresAt.slice(0, 10)}.` });
  } else {
    // 3. Credentials
    const w = ORGANIZATION_WEIGHTS.credentials;
    const credentials = attested?.credentials || [];
    if (!attested) {
      evidence.push({ id: "credentials", label: "Credentials", weight: w, earned: 0, status: "info", detail: "No verified attestation carrying credentials." });
    } else if (!credentials.length) {
      evidence.push({ id: "credentials", label: "Credentials", weight: w, earned: 0, status: "warn", detail: "The attestation lists no credentials." });
    } else {
      const today = input.now.toISOString().slice(0, 10);
      const invalid = credentials.filter((credential) => credential.status === "revoked" || credential.validUntil < today);
      const earned = Math.round(w * ((credentials.length - invalid.length) / credentials.length));
      if (!invalid.length) {
        evidence.push({ id: "credentials", label: "Credentials", weight: w, earned, status: "pass", detail: `${credentials.length} of ${credentials.length} credentials are in date.` });
      } else {
        const names = invalid.map((credential) => `${credential.type} (${credential.status === "revoked" ? "revoked" : `expired ${credential.validUntil}`})`).join("; ");
        evidence.push({ id: "credentials", label: "Credentials", weight: w, earned, status: "warn", detail: `${credentials.length - invalid.length} of ${credentials.length} in date. Not valid: ${names}.` });
        warnings.push(`Credential not valid: ${names}.`);
      }
    }
    if (attested && expired) warnings.push("The attestation has expired.");

    // 4. Reputation
    const rw = ORGANIZATION_WEIGHTS.reputation;
    if (!input.reputation || !input.found) {
      evidence.push({ id: "reputation", label: "Reputation history", weight: rw, earned: 0, status: "info", detail: "No reputation history on record." });
    } else {
      const earned = reputationPoints(input.reputation, rw);
      const pct = Math.round(input.reputation.fulfilmentRate * 100);
      evidence.push({
        id: "reputation", label: "Reputation history", weight: rw, earned,
        status: earned >= rw * 0.8 ? "pass" : "warn",
        detail: `${input.reputation.completed} completed, ${input.reputation.disputes} disputes, ${pct}% fulfilment.`,
      });
      if (input.reputation.fulfilmentRate < 0.75) warnings.push(`Low fulfilment rate (${pct}%).`);
    }
  }

  // Reports
  const reportWeight = weights.reports;
  if (input.openReports === 0) {
    evidence.push({ id: "reports", label: "Suspicious-agent reports", weight: reportWeight, earned: input.found ? reportWeight : 0, status: input.found ? "pass" : "info", detail: "No open reports." });
  } else {
    evidence.push({ id: "reports", label: "Suspicious-agent reports", weight: reportWeight, earned: 0, status: "fail", detail: `${input.openReports} open report(s) against this subject.` });
    warnings.push(`${input.openReports} open suspicious-agent report(s).`);
  }

  const score = Math.max(0, Math.min(100, evidence.reduce((sum, item) => sum + item.earned, 0)));

  let decision: TrustDecision;
  if (blockers.length) decision = "blocked";
  else if (!input.found) decision = "unverified";
  else if (score >= THRESHOLDS.verified && !warnings.length) decision = "verified";
  else if (score >= THRESHOLDS.caution) decision = "caution";
  else decision = "blocked";
  if (decision === "blocked" && !blockers.length) blockers.push(`Trust score ${score} is below the minimum of ${THRESHOLDS.caution}.`);
  if (decision === "unverified") warnings.unshift("Not found in the registry. An unverified party is never treated as trusted.");

  return {
    subjectId: input.subjectId,
    subjectType: input.subjectType,
    name: input.name,
    decision,
    score,
    evidence,
    warnings,
    blockers,
    signatureVerified,
    evaluatedAt: input.now.toISOString(),
    registry: input.registry,
  };
}

/** May this party's data or offers be used without a person overriding the trust gate? */
export function isUsable(decision: TrustDecision): boolean {
  return decision === "verified" || decision === "caution";
}
