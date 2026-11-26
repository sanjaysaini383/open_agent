// The actions ShelterConnect shares with other agent sites, through its action bridge.
// bridge/agent-manifest.json loads this module in the bridge frame, which has no shelter
// page. So it reads the shelter store directly. Each read has the name and input of the
// page's own action (site-actions.js), so the network's instructions fit both.
//
// Reads run in a hidden frame on this site's origin. The one shared write, recording
// deliveries, runs in a ShelterConnect window where a person here confirms it
// (delivery-window.js).
import { DeliveryWindow } from "./delivery-window.js";
import { ShelterStore } from "../js/shelter-store.js";
import { SiteLinks } from "../js/site-links.js";

const NO_INPUT = { type: "object", properties: {}, additionalProperties: false };

class BridgeActions {
  /**
   * The sites allowed to call these reads, as exact origins with the port. The data is
   * simulated and public on the page, so "*" would also be defensible, but a shelter
   * register is exactly what a strict allowlist is for.
   */
  static CALLERS = SiteLinks.CALLERS;

  static registerActions(actions) {
    actions.register(BridgeActions.overviewAction());
    actions.register(BridgeActions.requestsAction());
    actions.register(BridgeActions.inventoryAction());
    actions.register(DeliveryWindow.definition());
  }

  static overviewAction() {
    return {
      name: "get_shelter_overview",
      description: "Read the registered shelters: id, name, block, coordinates, capacity, occupancy, free places, urgency, the resource catalogue and links to partner sites. Simulated data. Changes nothing. Call it before answering about shelters.",
      effect: "read",
      availability: "bridge",
      callerOrigins: BridgeActions.CALLERS,
      inputSchema: NO_INPUT,
      execute: () => new ShelterStore().overview(),
    };
  }

  static requestsAction() {
    return {
      name: "get_resource_requests",
      description: "Read the published resource requests: per shelter and resource, the quantity required, stock on hand, shortage, urgency and needed-by time, plus totals per resource. Simulated data. Changes nothing.",
      effect: "read",
      availability: "bridge",
      callerOrigins: BridgeActions.CALLERS,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", enum: ["open", "covered", "all"], description: "open = still short, covered = stock meets the requirement. Default all." },
          shelterId: { type: "string", maxLength: 12, description: "Optional shelter id from get_shelter_overview." },
        },
      },
      execute: (args) => new ShelterStore().resourceRequests(args),
    };
  }

  static inventoryAction() {
    return {
      name: "get_shelter_inventory",
      description: "Read stock on hand and stated requirements per shelter, and the latest recorded deliveries. Simulated data. Changes nothing.",
      effect: "read",
      availability: "bridge",
      callerOrigins: BridgeActions.CALLERS,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          shelterId: { type: "string", maxLength: 12, description: "Optional shelter id from get_shelter_overview." },
        },
      },
      execute: (args) => new ShelterStore().inventory(args),
    };
  }
}

// The bridge calls the module's registerActions export.
export const registerActions = BridgeActions.registerActions;
