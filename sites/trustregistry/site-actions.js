// Registers TrustRegistry's operations with the agent runtime.
// agent-manifest.json loads this module through "actions.module". Only the names in
// "actions.agentTools" become model tools, called website_<name>.
//
// Every action wraps a method of App.page, the same object the page's own buttons and
// forms call, so the assistant and the manual UI share one set of rules. This file adds
// no business rule of its own.
import { App } from "./js/app.js";
import { ReadActions } from "./js/action-schemas.js";
import { RegistryData } from "./js/registry-data.js";

class SiteActions {
  static registerActions(actions) {
    actions.register({ ...ReadActions.INFO, effect: "read", execute: () => App.page.getState() });
    actions.register({ ...ReadActions.VERIFY_AGENT, effect: "read", execute: (args) => App.page.store.verifyAgent(args) });
    actions.register({ ...ReadActions.VERIFY_ORGANIZATION, effect: "read", execute: (args) => App.page.store.verifyOrganization(args) });
    actions.register({ ...ReadActions.REPUTATION, effect: "read", execute: (args) => App.page.store.reputationOf(args) });
    actions.register(SiteActions.setStatusAction());
    actions.register(SiteActions.registerSubjectAction());
  }

  static setStatusAction() {
    return {
      name: "set_subject_status",
      description: "Change the registry's live status of one registered subject to active, suspended or revoked, with a reason. First ask the visitor for the subject and the reason. The browser asks the visitor to confirm, because partner sites act on this status. It cannot set a status better than the signed attestation says, and it does not re-sign anything. Returns the new and the previous status, or ok false with the site's reason.",
      effect: "irreversible",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["subjectId", "status", "reason"],
        properties: {
          subjectId: { type: "string", minLength: 1, maxLength: 80, description: "Subject id from website_get_registry_info, such as org:ORG-TR-4." },
          status: { type: "string", enum: RegistryData.STATUSES, description: "The status the visitor chose." },
          reason: { type: "string", minLength: 3, maxLength: 200, description: "Why, in the visitor's words." },
        },
      },
      execute: (args) => App.page.setSubjectStatus(args),
    };
  }

  static registerSubjectAction() {
    return {
      name: "register_subject",
      description: "Add an agent network or an organisation to the registry as pending. First ask the visitor for the kind, the name and, for a network, its network URL or, for an organisation, its organisation id. The browser asks the visitor to confirm, because the page has no delete. A pending subject has no signed attestation, so callers treat it as unverified. Returns the subject id, or ok false with the site's reason.",
      effect: "irreversible",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "name"],
        properties: {
          kind: { type: "string", enum: ["agent_network", "organization"], description: "What is being registered." },
          name: { type: "string", minLength: 3, maxLength: 80, description: "Its name, from the visitor." },
          networkUrl: { type: "string", maxLength: 300, description: "For an agent network: its network URL, ending in the network name." },
          operator: { type: "string", maxLength: 80, description: "For an agent network: who operates it. Optional." },
          organizationId: { type: "string", maxLength: 40, description: "For an organisation: its id, such as ORG-SUP-E." },
          organizationType: { type: "string", enum: RegistryData.ORGANIZATION_TYPES, description: "For an organisation: its type. Default other." },
        },
      },
      execute: (args) => App.page.registerSubject(args),
    };
  }
}

// The runtime calls the module's registerActions export.
export const registerActions = SiteActions.registerActions;
