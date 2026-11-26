// The write ShelterConnect shares with other agent sites: recording deliveries into
// shelter stock. bridge-actions.js registers it.
//
// A partner's write never runs in the partner's page. It runs here, in a window on
// ShelterConnect's own origin, where a person sees exactly what would change and confirms
// or cancels. The calling site gets back only a receipt reference and what was recorded.
import { ShelterData } from "../js/shelter-data.js";
import { ShelterStore } from "../js/shelter-store.js";
import { SiteLinks } from "../js/site-links.js";

export class DeliveryWindow {
  /** The sites allowed to make this write, as exact origins. Never "*". */
  static CALLERS = SiteLinks.CALLERS;
  static SITE_NAME = "ShelterConnect";
  static CONFIRM_LABEL = "Confirm receipt and update stock";

  static definition() {
    return {
      name: "record_deliveries",
      description: "Record delivered supplies into shelter stock, in one call. A ShelterConnect window opens where a person at the shelter desk checks each line and confirms receipt, so never ask for names or contact details. It returns only once they confirmed or cancelled: with ok true it is done and the window has closed. Returns the receipt reference and the lines recorded, or ok false with the site's reason. A shipment line is never recorded twice.",
      effect: "irreversible",
      availability: "bridge",
      callerOrigins: DeliveryWindow.CALLERS,
      confirmsInWindow: true,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["deliveries"],
        properties: {
          deliveries: {
            type: "array",
            minItems: 1,
            maxItems: 40,
            description: "One line per shelter, resource and shipment.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["shelterId", "resource", "quantity", "shipmentRef"],
              properties: {
                shelterId: { type: "string", maxLength: 12, description: "Shelter id from get_shelter_overview." },
                resource: { type: "string", enum: ShelterData.resourceIds(), description: "Resource id." },
                quantity: { type: "integer", minimum: 1, maximum: 100000, description: "Units delivered." },
                shipmentRef: { type: "string", minLength: 1, maxLength: 40, description: "The shipment's tracking reference." },
              },
            },
          },
        },
      },
      execute: DeliveryWindow.start,
    };
  }

  /** Check the request with the site's rules, then ask the person in this window. */
  static start(args, context) {
    const store = new ShelterStore();
    const check = store.checkDeliveries(args);
    // A request the site would refuse gets no form, only the site's reason.
    if (!check.ok) return { ok: false, reason: check.reason };
    const state = { store, request: args, caller: DeliveryWindow.hostOf(context?.callerOrigin), done: false };
    return new Promise((resolve) => DeliveryWindow.show(state, resolve));
  }

  static show(state, resolve) {
    state.resolve = resolve;
    document.title = `${DeliveryWindow.SITE_NAME} — confirm deliveries`;
    document.body.classList.add("write-window");
    const sheet = document.createElement("link");
    sheet.rel = "stylesheet";
    sheet.href = new URL("../styles.css", import.meta.url).href;
    document.head.append(sheet);

    const header = DeliveryWindow.element("header", "");
    header.append(DeliveryWindow.element("span", "SC", "brand-mark"), DeliveryWindow.element("span", DeliveryWindow.SITE_NAME));

    const box = DeliveryWindow.element("main", "");
    const intro = DeliveryWindow.element("section", "", "panel intro");
    intro.append(
      DeliveryWindow.element("h1", "Confirm deliveries received"),
      DeliveryWindow.element("p", `The coordination site ${state.caller} reports that these supplies were delivered. Confirm only what the shelter actually received: confirming adds the quantities to shelter stock. Its assistant gets back the receipt reference and these lines, nothing else.`),
      DeliveryWindow.element("p", "Simulated demonstration data.", "sub"),
    );
    const card = DeliveryWindow.element("section", "", "panel");
    card.setAttribute("aria-label", "What you are confirming");
    const list = DeliveryWindow.element("ul", "", "summary-list");
    for (const line of state.store.deliverySummaryLines(state.request)) list.append(DeliveryWindow.element("li", line));
    card.append(DeliveryWindow.element("h2", "Lines to record"), list);

    const actions = DeliveryWindow.element("div", "", "actions");
    const confirm = DeliveryWindow.element("button", DeliveryWindow.CONFIRM_LABEL);
    confirm.type = "button";
    const cancel = DeliveryWindow.element("button", "Do not record", "secondary");
    cancel.type = "button";
    actions.append(confirm, cancel);
    const error = DeliveryWindow.element("p", "", "field-error");
    error.setAttribute("role", "alert");
    error.hidden = true;
    card.append(error, actions);

    confirm.addEventListener("click", () => DeliveryWindow.submit(state, box, error));
    cancel.addEventListener("click", () => DeliveryWindow.cancel(state, box));
    box.append(intro, card);
    document.body.append(header, box);
    // Start on the heading, which Enter cannot activate, so a stray Enter confirms nothing.
    const heading = intro.querySelector("h1");
    heading.tabIndex = -1;
    heading.focus();
  }

  static submit(state, box, error) {
    if (state.done) return;
    // The store re-checks everything: stock may have changed since the window opened.
    const done = state.store.recordDeliveries(state.request);
    if (!done.ok) {
      error.textContent = done.reason;
      error.hidden = false;
      return;
    }
    state.done = true;
    const note = DeliveryWindow.element("section", "", "panel");
    note.append(
      DeliveryWindow.element("h2", "Recorded"),
      DeliveryWindow.element("p", `Receipt ${done.reference}. Shelter stock is updated.`),
      DeliveryWindow.element("p", `This window closes now. The site ${state.caller} shows the receipt too.`),
    );
    box.replaceChildren(note);
    state.resolve({
      ok: true,
      reference: done.reference,
      summary: done.summary,
      recorded: done.recorded.map((line) => ({ shelterId: line.shelterId, resource: line.resource, quantity: line.quantity, shipmentRef: line.shipmentRef, newStock: line.newStock })),
      note: "Confirmed by a person in ShelterConnect's own window, which has now closed.",
      simulated: true,
    });
  }

  static cancel(state, box) {
    if (state.done) return;
    state.done = true;
    const note = DeliveryWindow.element("section", "", "panel");
    note.append(
      DeliveryWindow.element("h2", "Not recorded"),
      DeliveryWindow.element("p", `Nothing was changed. This window closes now, and ${state.caller} carries on.`),
    );
    box.replaceChildren(note);
    state.resolve({ ok: false, reason: "The person at ShelterConnect declined in this site's window. Nothing was recorded." });
  }

  static hostOf(origin) {
    try { return new URL(origin).host; } catch { return "another site"; }
  }

  static element(tag, text, className = "") {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }
}
