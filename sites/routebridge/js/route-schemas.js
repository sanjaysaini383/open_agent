// Input schemas and descriptions of RouteBridge's reads, in one place. The page's actions
// (site-actions.js) and the actions shared with partner sites (bridge/bridge-actions.js)
// use the same objects, so a read has one name, one input and one description wherever
// an agent meets it. Only the runtime's JSON Schema subset is used: every object lists
// its properties and rejects extra fields.
import { RouteData } from "./route-data.js";

export class RouteSchemas {
  static NO_INPUT = { type: "object", properties: {}, additionalProperties: false };

  static point(description) {
    return {
      type: "object",
      additionalProperties: false,
      required: ["lat", "lng"],
      description,
      properties: {
        lat: { type: "number", minimum: -90, maximum: 90, description: "Latitude in decimal degrees." },
        lng: { type: "number", minimum: -180, maximum: 180, description: "Longitude in decimal degrees." },
        label: { type: "string", maxLength: 80, description: "Optional place name, shown to people." },
      },
    };
  }

  static READS = {
    get_transport_providers: {
      description: "Read the transport providers: id, organisation id, base, and per vehicle type the count, how many are free now, capacity in kg, average speed, rate per km and whether it is flood-capable; plus the flood zones, where distances come from, and links to partner sites. Simulated data. Changes nothing. Call it before answering about providers or vehicles, and again in each turn that needs it.",
      inputSchema: RouteSchemas.NO_INPUT,
    },
    get_transport_options: {
      description: "List every provider's option to move one load from one point to another: vehicles needed and free, deadhead and haul distance in km, estimated hours, cost in INR, whether it is feasible, whether it meets the deadline, advisories such as a flooded approach, and where the distance came from. Sorted: feasible first, then fastest, then cheapest. Simulated data. Changes nothing and books nothing.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to", "weightKg"],
        properties: {
          from: RouteSchemas.point("Where the load is picked up."),
          to: RouteSchemas.point("Where the load is delivered."),
          weightKg: { type: "number", minimum: 1, maximum: 500000, description: "Total weight of the load in kg." },
          neededWithinHours: { type: "number", minimum: 0.5, maximum: 720, description: "Optional deadline, in hours from now." },
        },
      },
    },
    estimate_routes: {
      description: "Estimate up to 40 lanes at once: haul distance in km, the flood zone at the destination if any, whether trucks can make it, whether a boat is required, and best-case hours per vehicle type. Simulated data. Changes nothing. Use it to compare lanes before asking for options.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["legs"],
        properties: {
          legs: {
            type: "array",
            minItems: 1,
            maxItems: 40,
            description: "One entry per lane.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "from", "to"],
              properties: {
                id: { type: "string", minLength: 1, maxLength: 40, description: "Your own id for this lane; returned unchanged." },
                from: RouteSchemas.point("Where the lane starts."),
                to: RouteSchemas.point("Where the lane ends."),
              },
            },
          },
        },
      },
    },
    get_shipment_status: {
      description: "Read the status of shipments by tracking code: status, provider, vehicle type, last update and status history. A code this site does not know comes back with found false. Simulated data. Changes nothing.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["trackingCodes"],
        properties: {
          trackingCodes: {
            type: "array",
            minItems: 1,
            maxItems: 40,
            description: "Tracking codes, such as RB-TRK-0001.",
            items: { type: "string", minLength: 1, maxLength: 40 },
          },
        },
      },
    },
  };

  /** The input of the one shared write, booking shipments. */
  static CREATE_SHIPMENTS = {
    type: "object",
    additionalProperties: false,
    required: ["incidentRef", "shipments"],
    properties: {
      incidentRef: { type: "string", minLength: 1, maxLength: 40, description: "The coordinating site's incident reference." },
      shipments: {
        type: "array",
        minItems: 1,
        maxItems: 30,
        description: "One entry per shipment.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["reference", "providerId", "vehicleType", "vehicles", "from", "to", "weightKg", "cargo"],
          properties: {
            reference: { type: "string", minLength: 1, maxLength: 40, description: "Your own reference for this shipment; unique within the incident." },
            providerId: { type: "string", minLength: 1, maxLength: 12, description: "Provider id from website_get_transport_options." },
            vehicleType: { type: "string", enum: RouteData.vehicleTypes(), description: "Vehicle type from the chosen option." },
            vehicles: { type: "integer", minimum: 1, maximum: 50, description: "How many vehicles to book; at least the option's vehiclesNeeded." },
            from: RouteSchemas.point("Where the load is picked up."),
            to: RouteSchemas.point("Where the load is delivered."),
            weightKg: { type: "number", minimum: 1, maximum: 500000, description: "Total weight of the load in kg." },
            cargo: {
              type: "array",
              minItems: 1,
              maxItems: 8,
              description: "What the shipment carries.",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["resource", "quantity"],
                properties: {
                  resource: { type: "string", enum: RouteData.resourceIds(), description: "Resource id." },
                  quantity: { type: "integer", minimum: 1, maximum: 100000, description: "Units carried." },
                },
              },
            },
          },
        },
      },
    },
  };
}
