// The actions RouteBridge shares with other agent sites, through its action bridge.
// bridge/agent-manifest.json loads this module in the bridge frame, which has no
// RouteBridge page. So it reads the route store directly. Each read has the name, input
// and description of the page's own action (js/route-schemas.js), so the network's
// instructions fit both.
//
// Reads run in a hidden frame on this site's origin. The one shared write, booking
// shipments, runs in a RouteBridge window where a person here confirms it
// (shipment-window.js).
import { ShipmentWindow } from "./shipment-window.js";
import { RouteSchemas } from "../js/route-schemas.js";
import { RouteStore } from "../js/route-store.js";
import { SiteLinks } from "../js/site-links.js";

class BridgeActions {
  /**
   * The sites allowed to call these reads, as exact origins with the port. The data is
   * simulated and public on the page, so "*" would also be defensible, but fleet
   * availability is exactly what a strict allowlist is for.
   */
  static CALLERS = SiteLinks.CALLERS;

  static registerActions(actions) {
    actions.register(BridgeActions.read("get_transport_providers", () => new RouteStore().providers()));
    actions.register(BridgeActions.read("get_transport_options", (args) => new RouteStore().transportOptions(args)));
    actions.register(BridgeActions.read("estimate_routes", (args) => new RouteStore().estimateRoutes(args)));
    actions.register(BridgeActions.read("get_shipment_status", (args) => new RouteStore().shipmentStatus(args)));
    actions.register(ShipmentWindow.definition());
  }

  /** A shared read: a fresh store each call, so it always answers from current storage. */
  static read(name, execute) {
    return {
      name,
      description: RouteSchemas.READS[name].description,
      effect: "read",
      availability: "bridge",
      callerOrigins: BridgeActions.CALLERS,
      inputSchema: RouteSchemas.READS[name].inputSchema,
      execute,
    };
  }
}

// The bridge calls the module's registerActions export.
export const registerActions = BridgeActions.registerActions;
