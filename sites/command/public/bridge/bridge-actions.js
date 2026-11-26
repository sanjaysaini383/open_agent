// The actions ReliefMesh Command shares with other agent sites, through its action bridge.
// bridge/agent-manifest.json loads this module in the bridge frame, which has no
// dashboard. It reads the public incident summary from saved state (command-data.js).
//
// Two reads are shared with every site: they return only the public, simulated incident
// summary and what this site can coordinate, so any compatible agentic website can find
// out what ReliefMesh does. The one write, an assistance request, is shared with the
// partner sites only and is confirmed by a person in a ReliefMesh window.
import { AssistanceWindow } from "./assistance-window.js";
import { CommandData } from "./command-data.js";

const NO_INPUT = { type: "object", properties: {}, additionalProperties: false };

class BridgeActions {
  /** Every site on the web. Used for the two public reads only, never for a write. */
  static EVERY_SITE = ["*"];

  static registerActions(actions) {
    actions.register(BridgeActions.incidentsAction());
    actions.register(BridgeActions.capabilitiesAction());
    actions.register(AssistanceWindow.definition());
  }

  static incidentsAction() {
    return {
      name: "get_active_incidents",
      description: "Read the open incidents ReliefMesh Command is coordinating: name, category, severity, location, affected population, declared requirements, deadline and how far the response workflow has got, with links. Simulated data. Changes nothing. Call it before answering about incidents.",
      effect: "read",
      availability: "bridge",
      callerOrigins: BridgeActions.EVERY_SITE,
      inputSchema: NO_INPUT,
      execute: () => new CommandData().activeIncidents(),
    };
  }

  static capabilitiesAction() {
    return {
      name: "get_coordination_capabilities",
      description: "Read what ReliefMesh Command can coordinate, the partner networks it works with and how to request assistance. Changes nothing.",
      effect: "read",
      availability: "bridge",
      callerOrigins: BridgeActions.EVERY_SITE,
      inputSchema: NO_INPUT,
      execute: () => new CommandData().capabilities(),
    };
  }
}

// The bridge calls the module's registerActions export.
export const registerActions = BridgeActions.registerActions;
