// Input schemas of the reads AidSupply offers both on its page (site-actions.js) and to
// partner sites (bridge/bridge-actions.js). One definition, so the two can never drift:
// a partner's agent and the page's own assistant call a read with the same arguments.
//
// Only the runtime's schema subset is used (runtime/actions.js, checkSchema).
import { SupplyData } from "./supply-data.js";

export class ActionSchemas {
  static NO_INPUT = { type: "object", properties: {}, additionalProperties: false };

  static OFFERS_INPUT = {
    type: "object",
    additionalProperties: false,
    properties: {
      resource: { type: "string", enum: SupplyData.resourceIds(), description: "Optional resource id, to list only that resource." },
      supplierId: { type: "string", maxLength: 12, description: "Optional supplier id from the supplier directory." },
    },
  };

  static QUOTE_INPUT = {
    type: "object",
    additionalProperties: false,
    required: ["offerId", "quantity"],
    properties: {
      offerId: { type: "string", minLength: 1, maxLength: 40, description: "Offer id from the offers list, such as OFF-B-FOOD." },
      quantity: { type: "integer", minimum: 1, maximum: 1000000, description: "Units wanted. At least the offer's minimum order, at most what is available." },
      targetUnitPrice: { type: "number", minimum: 0, maximum: 1000000, description: "Optional unit price hoped for, in INR." },
    },
  };

  /** A fresh copy, because the runtime's registry keeps what it is given. */
  static copy(schema) {
    return structuredClone(schema);
  }
}
