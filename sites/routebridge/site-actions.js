// Registers RouteBridge's operations with the agent runtime.
// agent-manifest.json loads this module through "actions.module". Only the names in
// "actions.agentTools" become model tools, called website_<name>.
//
// Every action wraps a method of App.page, the same object the page's own buttons and
// forms call, so the assistant and the manual UI share one set of rules. This file adds
// no business rule of its own. The reads' names, inputs and descriptions come from
// js/route-schemas.js, which the bridge shares with partner sites too.
import { App } from "./js/app.js";
import { RouteData } from "./js/route-data.js";
import { RouteSchemas } from "./js/route-schemas.js";

class SiteActions {
  static registerActions(actions) {
    actions.register(SiteActions.read("get_transport_providers", () => App.page.getState()));
    actions.register(SiteActions.read("get_transport_options", (args) => App.page.store.transportOptions(args)));
    actions.register(SiteActions.read("estimate_routes", (args) => App.page.store.estimateRoutes(args)));
    actions.register(SiteActions.read("get_shipment_status", (args) => App.page.store.shipmentStatus(args)));
    actions.register(SiteActions.registerProviderAction());
    actions.register(SiteActions.updateFleetAction());
    actions.register(SiteActions.updateStatusAction());
  }

  /** A read: answers from the store and changes nothing on the page. */
  static read(name, execute) {
    return {
      name,
      description: RouteSchemas.READS[name].description,
      effect: "read",
      inputSchema: RouteSchemas.READS[name].inputSchema,
      execute,
    };
  }

  static registerProviderAction() {
    return {
      name: "register_provider",
      description: "Register a new transport provider, with its first vehicle type, in the published register. First ask the visitor for the name, base town, latitude, longitude, vehicle type, number of vehicles, capacity in kg, average speed and rate per km. The browser asks the visitor to confirm, because partner sites read the register and the page has no delete. Returns the new provider id, or ok false with the site's reason.",
      effect: "irreversible",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["name", "city", "lat", "lng", "vehicleType", "count", "capacityKg", "avgSpeedKmh", "ratePerKm"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 80, description: "Provider name, from the visitor." },
          city: { type: "string", minLength: 1, maxLength: 60, description: "Base town, from the visitor." },
          organizationId: { type: "string", maxLength: 20, description: "Optional organisation id, such as ORG-TR-9, from the visitor." },
          lat: { type: "number", minimum: -90, maximum: 90, description: "Base latitude, from the visitor." },
          lng: { type: "number", minimum: -180, maximum: 180, description: "Base longitude, from the visitor." },
          vehicleType: { type: "string", enum: RouteData.vehicleTypes(), description: "Vehicle type." },
          count: { type: "integer", minimum: 1, maximum: 500, description: "How many vehicles of that type." },
          capacityKg: { type: "integer", minimum: 100, maximum: 100000, description: "Capacity of one vehicle in kg." },
          avgSpeedKmh: { type: "number", minimum: 1, maximum: 120, description: "Average speed in km/h." },
          ratePerKm: { type: "number", minimum: 1, maximum: 10000, description: "Rate in INR per km." },
        },
      },
      execute: (args) => App.page.registerProvider(args),
    };
  }

  static updateFleetAction() {
    return {
      name: "update_fleet_availability",
      description: "Call it only when the visitor asks. Set how many vehicles of one type a provider has, as an absolute number. The site refuses a count below the vehicles on unfinished shipments. Returns the new count and how many are free, or ok false with the site's reason. The visitor can change it back on the page.",
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["providerId", "vehicleType", "count"],
        properties: {
          providerId: { type: "string", minLength: 1, maxLength: 12, description: "Provider id from website_get_transport_providers." },
          vehicleType: { type: "string", enum: RouteData.vehicleTypes(), description: "A vehicle type that provider has." },
          count: { type: "integer", minimum: 0, maximum: 500, description: "Vehicles in the fleet now, from the visitor." },
        },
      },
      execute: (args) => App.page.updateFleetAvailability(args),
    };
  }

  static updateStatusAction() {
    return {
      name: "update_shipment_status",
      description: "Call it only when the visitor asks. Move one shipment to its next status. Allowed: planned to dispatched or cancelled; dispatched to in_transit or cancelled; in_transit to delivered, delayed or failed; delayed to in_transit, delivered or failed. The site refuses any other change and says what is allowed. Returns the new status and its next allowed statuses, or ok false with the site's reason.",
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["trackingCode", "status"],
        properties: {
          trackingCode: { type: "string", minLength: 1, maxLength: 40, description: "Tracking code, such as RB-TRK-0001, from the visitor or website_get_shipment_status." },
          status: { type: "string", enum: RouteData.statuses(), description: "The status the visitor asked for." },
        },
      },
      execute: (args) => App.page.updateShipmentStatus(args),
    };
  }
}

// The runtime calls the module's registerActions export.
export const registerActions = SiteActions.registerActions;
