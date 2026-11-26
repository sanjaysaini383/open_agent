// The name, description and input of each read TrustRegistry offers. The page's actions
// (site-actions.js) and the actions shared with other agent sites (bridge/bridge-actions.js)
// both build from these, so a shared read always has the name and input of the page's own
// action and the network's instructions fit both.
import { RegistryData } from "./registry-data.js";

export class ReadActions {
  static NO_INPUT = { type: "object", properties: {}, additionalProperties: false };

  static INFO = {
    name: "get_registry_info",
    description: "Read the registry itself: its name, issuer, signing algorithm and public keys with their fingerprints, how many agent networks, organisations and open reports it holds, the list of registered subjects with their status, and links to the partner sites. The registry's authority and credentials are simulated; its signatures are real. Changes nothing. Call it first, and again in each turn that needs it.",
    inputSchema: ReadActions.NO_INPUT,
  };

  static VERIFY_AGENT = {
    name: "verify_agent",
    description: "Look up one agent network by its full network URL (the folder that holds its agent-manifest.json, then the network name). Returns found, the record with its live status, the signed attestation, each credential with its state (valid, expired, revoked), reputation, open reports and effectiveStatus (the worse of the live and the attested status). A network with the same name at another URL is not a match. found false means unverified. Changes nothing.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["networkUrl"],
      properties: {
        networkUrl: { type: "string", minLength: 1, maxLength: 300, description: "The network URL exactly as given, such as https://site.example/network_name." },
      },
    },
  };

  static VERIFY_ORGANIZATION = {
    name: "verify_organization",
    description: "Look up one organisation, such as a supplier or a transport provider, by its organisation id. Returns found, the record with its live status, the signed attestation, each credential with its state (valid, expired, revoked), reputation, open reports and effectiveStatus (the worse of the live and the attested status). found false means the organisation has no record: unverified, though it may still have open reports. Changes nothing.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["organizationId"],
      properties: {
        organizationId: { type: "string", minLength: 1, maxLength: 40, description: "The organisation id, such as ORG-SUP-A." },
      },
    },
  };

  static REPUTATION = {
    name: "get_reputation",
    description: "Read one subject's reputation history: completed jobs, disputes, fulfilment rate, last activity and the latest events with their outcomes. Simulated data. Changes nothing.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["subjectId"],
      properties: {
        subjectId: { type: "string", minLength: 1, maxLength: 80, description: "net:<network name> for an agent network, or org:<organisation id> for an organisation." },
      },
    },
  };

  /** The input of the suspicious-agent report, shared by the bridge's write and its tests. */
  static REPORT_INPUT = {
    type: "object",
    additionalProperties: false,
    required: ["subjectId", "reason", "details"],
    properties: {
      subjectId: { type: "string", minLength: 1, maxLength: 80, description: "net:<network name> or org:<organisation id>. The subject need not be registered." },
      reason: { type: "string", enum: Object.keys(RegistryData.REPORT_REASONS), description: "The kind of problem." },
      details: { type: "string", minLength: 1, maxLength: 280, description: "What was observed, in plain words. No names of private people, emails or phone numbers." },
    },
  };
}
