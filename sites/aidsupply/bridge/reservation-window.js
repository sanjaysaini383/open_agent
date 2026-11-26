// The write AidSupply shares with other agent sites: reserving stock against offers.
// bridge-actions.js registers it.
//
// A partner's write never runs in the partner's page. It runs here, in a window on
// AidSupply's own origin, where a person sees every line, price and the total and
// confirms or cancels. The calling site gets back only a reservation reference, the lines
// and the total.
import { SiteLinks } from "../js/site-links.js";
import { SupplyData } from "../js/supply-data.js";
import { SupplyStore } from "../js/supply-store.js";

export class ReservationWindow {
  /** The sites allowed to make this write, as exact origins. Never "*". */
  static CALLERS = SiteLinks.CALLERS;
  static SITE_NAME = "AidSupply Network";
  static CONFIRM_LABEL = "Reserve this stock";

  static definition() {
    return {
      name: "reserve_allocation",
      description: "Reserve stock against one or more offers, in one call, at the unit prices given. Call request_improved_offer first and use its quoted prices: a price below what the supplier accepts is refused. An AidSupply window opens where a person checks every line, price and the total and confirms, so never ask for names, contact or payment details. It returns only once they confirmed or cancelled: with ok true the stock is held and the window has closed. No payment is taken. Returns the reservation reference, the lines and the total in INR, or ok false with the site's reason.",
      effect: "irreversible",
      availability: "bridge",
      callerOrigins: ReservationWindow.CALLERS,
      // The window below shows the reservation and asks the person to confirm or cancel,
      // so the bridge's generic dialog of the raw arguments is not needed.
      confirmsInWindow: true,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["incidentRef", "lines"],
        properties: {
          incidentRef: { type: "string", minLength: 1, maxLength: 40, description: "The coordinating site's incident reference." },
          lines: {
            type: "array",
            minItems: 1,
            maxItems: 20,
            description: "One line per offer. An offer may appear once.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["offerId", "quantity", "unitPrice"],
              properties: {
                offerId: { type: "string", minLength: 1, maxLength: 40, description: "Offer id from get_supplier_offers." },
                quantity: { type: "integer", minimum: 1, maximum: 1000000, description: "Units to reserve." },
                unitPrice: { type: "number", minimum: 0, maximum: 1000000, description: "Agreed unit price in INR, from request_improved_offer." },
              },
            },
          },
        },
      },
      execute: ReservationWindow.start,
    };
  }

  /** Check the request with the site's rules, then ask the person in this window. */
  static start(args, context) {
    const store = new SupplyStore();
    const check = store.checkReservation(args);
    // A request the site would refuse gets no form, only the site's reason.
    if (!check.ok) return { ok: false, reason: check.reason };
    const state = { store, request: args, check, caller: ReservationWindow.hostOf(context?.callerOrigin), done: false };
    return new Promise((resolve) => ReservationWindow.show(state, resolve));
  }

  static money(value) {
    return `₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  static show(state, resolve) {
    state.resolve = resolve;
    document.title = `${ReservationWindow.SITE_NAME} — confirm reservation`;
    document.body.classList.add("write-window");
    const sheet = document.createElement("link");
    sheet.rel = "stylesheet";
    sheet.href = new URL("../styles.css", import.meta.url).href;
    document.head.append(sheet);

    const header = ReservationWindow.element("header", "");
    header.append(ReservationWindow.element("span", "AS", "brand-mark"), ReservationWindow.element("span", ReservationWindow.SITE_NAME));

    const box = ReservationWindow.element("main", "");
    const intro = ReservationWindow.element("section", "", "panel intro");
    const asked = ReservationWindow.element("p", "");
    asked.append("The coordination site ", ReservationWindow.element("span", state.caller, "caller"), ` asks AidSupply to reserve the stock below for incident ${state.check.incidentRef}.`);
    intro.append(
      ReservationWindow.element("h1", "Reserve this stock?"),
      asked,
      ReservationWindow.element("p", "Confirming holds these quantities at these prices so nobody else can reserve them. It takes no payment and places no order. The site that asked gets back the reservation reference, these lines and the total, nothing else."),
      ReservationWindow.element("p", "Simulated demonstration data.", "sub"),
    );

    const card = ReservationWindow.element("section", "", "panel");
    card.setAttribute("aria-label", "What you are confirming");
    card.append(ReservationWindow.element("h2", "Lines to reserve"), ReservationWindow.linesTable(state.check));
    card.append(ReservationWindow.element("p", `Total: ${ReservationWindow.money(state.check.total)} (${SupplyData.CURRENCY})`, "grand-total"));

    const error = ReservationWindow.element("p", "", "field-error");
    error.setAttribute("role", "alert");
    error.hidden = true;
    const actions = ReservationWindow.element("div", "", "actions");
    const confirm = ReservationWindow.element("button", ReservationWindow.CONFIRM_LABEL);
    confirm.type = "button";
    const cancel = ReservationWindow.element("button", "Do not reserve", "secondary");
    cancel.type = "button";
    actions.append(confirm, cancel);
    card.append(error, actions);

    confirm.addEventListener("click", () => ReservationWindow.submit(state, box, error));
    cancel.addEventListener("click", () => ReservationWindow.cancel(state, box));
    box.append(intro, card);
    document.body.append(header, box);
    // Start on the heading, which Enter cannot activate, so a stray Enter confirms nothing.
    const heading = intro.querySelector("h1");
    heading.tabIndex = -1;
    heading.focus();
  }

  /** Every line with its supplier, resource, quantity, unit price and line total. */
  static linesTable(check) {
    const wrap = ReservationWindow.element("div", "", "table-wrap");
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const [label, numeric] of [["Supplier", false], ["Resource", false], ["Quantity", true], ["Unit price", true], ["Line total", true]]) {
      headRow.append(ReservationWindow.element("th", label, numeric ? "num" : ""));
    }
    head.append(headRow);
    const body = document.createElement("tbody");
    for (const line of check.lines) {
      const row = document.createElement("tr");
      const supplier = document.createElement("td");
      supplier.append(ReservationWindow.element("strong", line.supplierName), ReservationWindow.element("div", line.offerId, "sub"));
      row.append(
        supplier,
        ReservationWindow.element("td", SupplyData.RESOURCES[line.resource]?.label || line.resource),
        ReservationWindow.element("td", line.quantity.toLocaleString("en-IN"), "num"),
        ReservationWindow.element("td", ReservationWindow.money(line.unitPrice), "num"),
        ReservationWindow.element("td", ReservationWindow.money(line.lineTotal), "num"),
      );
      body.append(row);
    }
    table.append(head, body);
    wrap.append(table);
    return wrap;
  }

  static submit(state, box, error) {
    if (state.done) return;
    // The store re-checks everything: stock may have gone since the window opened.
    const done = state.store.reserveAllocation(state.request);
    if (!done.ok) {
      error.textContent = done.reason;
      error.hidden = false;
      return;
    }
    state.done = true;
    const note = ReservationWindow.element("section", "", "panel");
    note.append(
      ReservationWindow.element("h2", "Reserved"),
      ReservationWindow.element("p", `Reservation ${done.reference}. ${ReservationWindow.money(done.total)} of stock is held. No payment was taken.`),
      ReservationWindow.element("p", `This window closes now. The site ${state.caller} shows the reference too.`),
    );
    box.replaceChildren(note);
    state.resolve({
      ok: true,
      reference: done.reference,
      summary: done.summary,
      lines: done.lines,
      total: done.total,
      currency: done.currency,
      note: "Confirmed by a person in AidSupply's own window, which has now closed. Stock is held; no payment was taken.",
      simulated: true,
    });
  }

  static cancel(state, box) {
    if (state.done) return;
    state.done = true;
    const note = ReservationWindow.element("section", "", "panel");
    note.append(
      ReservationWindow.element("h2", "Not reserved"),
      ReservationWindow.element("p", `Nothing was changed. This window closes now, and ${state.caller} carries on.`),
    );
    box.replaceChildren(note);
    state.resolve({ ok: false, reason: "The person at AidSupply declined in this site's window. Nothing was reserved." });
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
