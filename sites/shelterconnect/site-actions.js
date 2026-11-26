// Registers ShelterConnect's operations with the agent runtime.
// agent-manifest.json loads this module through "actions.module". Only the names in
// "actions.agentTools" become model tools, called website_<name>.
//
// Every action wraps a method of App.page, the same object the page's own buttons and
// forms call, so the assistant and the manual UI share one set of rules. This file adds
// no business rule of its own.
import { App } from "./js/app.js";
import { ShelterData } from "./js/shelter-data.js";

const NO_INPUT = { type: "object", properties: {}, additionalProperties: false };

class SiteActions {
  static registerActions(actions) {
    actions.register(SiteActions.overviewAction());
    actions.register(SiteActions.requestsAction());
    actions.register(SiteActions.inventoryAction());
    actions.register(SiteActions.updateInventoryAction());
    actions.register(SiteActions.publishRequestAction());
    actions.register(SiteActions.setUrgencyAction());
    actions.register(SiteActions.registerShelterAction());
  }

  static overviewAction() {
    return {
      name: "get_shelter_overview",
      description: "Read the registered shelters: id, name, block, coordinates, capacity, occupancy, free places, urgency, the resource catalogue and links to partner sites. Simulated data. Changes nothing. Call it before answering about shelters, and again in each turn that needs it.",
      effect: "read",
      inputSchema: NO_INPUT,
      execute: () => App.page.getState(),
    };
  }

  static requestsAction() {
    return {
      name: "get_resource_requests",
      description: "Read the published resource requests: per shelter and resource, the quantity required, stock on hand, shortage, urgency and needed-by time, plus totals per resource. Simulated data. Changes nothing.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", enum: ["open", "covered", "all"], description: "open = still short, covered = stock meets the requirement. Default all." },
          shelterId: { type: "string", maxLength: 12, description: "Optional shelter id from website_get_shelter_overview." },
        },
      },
      execute: (args) => App.page.store.resourceRequests(args),
    };
  }

  static inventoryAction() {
    return {
      name: "get_shelter_inventory",
      description: "Read stock on hand and stated requirements per shelter, and the latest recorded deliveries. Simulated data. Changes nothing.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          shelterId: { type: "string", maxLength: 12, description: "Optional shelter id from website_get_shelter_overview." },
        },
      },
      execute: (args) => App.page.store.inventory(args),
    };
  }

  static updateInventoryAction() {
    return {
      name: "update_inventory",
      description: "Call it only when the visitor asks. Set the stock one shelter holds of one resource, as an absolute number. Returns the new stock, or ok false with the site's reason. The visitor can change it back on the page.",
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["shelterId", "resource", "quantity"],
        properties: {
          shelterId: { type: "string", maxLength: 12, description: "Shelter id from website_get_shelter_overview." },
          resource: { type: "string", enum: ShelterData.resourceIds(), description: "Resource id." },
          quantity: { type: "integer", minimum: 0, maximum: 100000, description: "Stock on hand now, from the visitor." },
        },
      },
      execute: (args) => App.page.updateInventory(args),
    };
  }

  static publishRequestAction() {
    return {
      name: "publish_resource_request",
      description: "Call it only when the visitor asks. Publish what one shelter needs of one resource in total (not the shortage). Zero withdraws it. Returns the request row with its shortage, or ok false with the site's reason. The visitor can change it on the page.",
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["shelterId", "resource", "quantityRequired"],
        properties: {
          shelterId: { type: "string", maxLength: 12, description: "Shelter id from website_get_shelter_overview." },
          resource: { type: "string", enum: ShelterData.resourceIds(), description: "Resource id." },
          quantityRequired: { type: "integer", minimum: 0, maximum: 100000, description: "Total required, from the visitor." },
          neededBy: { type: "string", maxLength: 40, description: "Optional ISO date-time, such as 2026-12-01T18:00, from the visitor." },
        },
      },
      execute: (args) => App.page.publishRequest(args),
    };
  }

  static setUrgencyAction() {
    return {
      name: "set_shelter_urgency",
      description: "Call it only when the visitor asks. Set one shelter's urgency level. Returns the new level, or ok false with the site's reason. The visitor can change it back on the page.",
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["shelterId", "urgency"],
        properties: {
          shelterId: { type: "string", maxLength: 12, description: "Shelter id from website_get_shelter_overview." },
          urgency: { type: "string", enum: ShelterData.URGENCY, description: "The level the visitor chose." },
        },
      },
      execute: (args) => App.page.setUrgency(args),
    };
  }

  static registerShelterAction() {
    return {
      name: "register_shelter",
      description: "Register a new shelter in the published register. First ask the visitor for the name, block, latitude, longitude, capacity, occupancy and urgency. The browser asks the visitor to confirm, because partner sites read the register and the page has no delete. Returns the new shelter id, or ok false with the site's reason.",
      effect: "irreversible",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["name", "block", "lat", "lng", "capacity", "occupancy", "urgency"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 80, description: "Shelter name, from the visitor." },
          block: { type: "string", minLength: 1, maxLength: 60, description: "Block or locality, from the visitor." },
          lat: { type: "number", minimum: -90, maximum: 90, description: "Latitude, from the visitor." },
          lng: { type: "number", minimum: -180, maximum: 180, description: "Longitude, from the visitor." },
          capacity: { type: "integer", minimum: 1, maximum: 100000, description: "How many people it can hold." },
          occupancy: { type: "integer", minimum: 0, maximum: 100000, description: "How many people are there now." },
          urgency: { type: "string", enum: ShelterData.URGENCY, description: "Urgency level." },
        },
      },
      execute: (args) => App.page.registerShelter(args),
    };
  }
}

// The runtime calls the module's registerActions export.
export const registerActions = SiteActions.registerActions;
