// The write RouteBridge shares with other agent sites: booking shipments.
// bridge-actions.js registers it.
//
// A partner's write never runs in the partner's page. It runs here, in a window on
// RouteBridge's own origin, where a person sees every shipment that would be booked, with
// its vehicles, time and cost, and confirms or declines. The calling site gets back only
// the booking reference, the shipments with their tracking codes, and the total cost.
import { RouteData } from "../js/route-data.js";
import { RouteSchemas } from "../js/route-schemas.js";
import { RouteStore } from "../js/route-store.js";
import { SiteLinks } from "../js/site-links.js";

const fmt = (value) => Number(value).toLocaleString("en-IN");

export class ShipmentWindow {
  /** The sites allowed to make this write, as exact origins. Never "*". */
  static CALLERS = SiteLinks.CALLERS;
  static SITE_NAME = "RouteBridge";
  static CONFIRM_LABEL = "Book these shipments";

  static definition() {
    return {
      name: "create_shipments",
      description: "Book shipments with transport providers, in one call. Call website_get_transport_options first and use a feasible option's providerId, vehicleType and vehiclesNeeded. A RouteBridge window opens where a person at the logistics desk checks each shipment, its vehicles, time and cost, and confirms the booking, so never ask for names or contact details. It returns only once they confirmed or declined: with ok true it is done and the window has closed. Returns the booking reference, each shipment's tracking code, time and cost, and the total, or ok false with the site's reason. A shipment reference is never booked twice for one incident. Simulated: no vehicle is dispatched.",
      effect: "irreversible",
      availability: "bridge",
      callerOrigins: ShipmentWindow.CALLERS,
      confirmsInWindow: true,
      inputSchema: RouteSchemas.CREATE_SHIPMENTS,
      execute: ShipmentWindow.start,
    };
  }

  /** Check the request with the site's rules, then ask the person in this window. */
  static async start(args, context) {
    const store = new RouteStore();
    const check = await store.checkShipments(args);
    // A request the site would refuse gets no form, only the site's reason.
    if (!check.ok) return { ok: false, reason: check.reason };
    const state = { store, request: args, check, caller: ShipmentWindow.hostOf(context?.callerOrigin), done: false, busy: false };
    return new Promise((resolve) => ShipmentWindow.show(state, resolve));
  }

  static show(state, resolve) {
    state.resolve = resolve;
    document.title = `${ShipmentWindow.SITE_NAME} — confirm shipment booking`;
    document.body.classList.add("write-window");
    const sheet = document.createElement("link");
    sheet.rel = "stylesheet";
    sheet.href = new URL("../styles.css", import.meta.url).href;
    document.head.append(sheet);

    const header = ShipmentWindow.element("header", "");
    header.append(ShipmentWindow.element("span", "RB", "brand-mark"), ShipmentWindow.element("span", ShipmentWindow.SITE_NAME));

    const box = ShipmentWindow.element("main", "");
    const intro = ShipmentWindow.element("section", "", "panel intro");
    intro.append(
      ShipmentWindow.element("h1", "Confirm this shipment booking"),
      ShipmentWindow.element("p", `The coordination site ${state.caller} asks RouteBridge to book the shipments below for incident ${state.check.incidentRef}. Confirming holds the vehicles and gives each shipment a tracking code. Its assistant gets back the booking reference, the tracking codes, times and costs, nothing else.`),
      ShipmentWindow.element("p", "Simulated demonstration data: no vehicle is really dispatched and nothing is charged.", "sub"),
    );

    const card = ShipmentWindow.element("section", "", "panel");
    card.setAttribute("aria-label", "What you are confirming");
    card.append(ShipmentWindow.element("h2", `${state.check.lines.length} shipment(s) to book`));
    for (const line of state.check.lines) card.append(ShipmentWindow.shipmentCard(line));
    card.append(ShipmentWindow.element("p", `Total estimated cost: ₹${fmt(state.check.totalCost)} (${RouteData.CURRENCY})`, "total"));

    const actions = ShipmentWindow.element("div", "", "actions");
    const confirm = ShipmentWindow.element("button", ShipmentWindow.CONFIRM_LABEL);
    confirm.type = "button";
    const decline = ShipmentWindow.element("button", "Do not book", "secondary");
    decline.type = "button";
    actions.append(confirm, decline);
    const error = ShipmentWindow.element("p", "", "field-error");
    error.setAttribute("role", "alert");
    error.hidden = true;
    card.append(error, actions);

    confirm.addEventListener("click", () => ShipmentWindow.submit(state, box, error));
    decline.addEventListener("click", () => ShipmentWindow.cancel(state, box));
    box.append(intro, card);
    document.body.append(header, box);
    // Start on the heading, which Enter cannot activate, so a stray Enter confirms nothing.
    const heading = intro.querySelector("h1");
    heading.tabIndex = -1;
    heading.focus();
  }

  /** One shipment's details, as the person confirming needs to read them. */
  static shipmentCard(line) {
    const card = ShipmentWindow.element("div", "", "shipment-card");
    card.append(ShipmentWindow.element("h3", `Shipment ${line.reference}`));
    const list = document.createElement("dl");
    for (const [label, value] of ShipmentWindow.shipmentFacts(line)) {
      list.append(ShipmentWindow.element("dt", label), ShipmentWindow.element("dd", value));
    }
    card.append(list);
    return card;
  }

  /** The label and value pairs of one checked shipment line. Plain data, so tests can read it. */
  static shipmentFacts(line) {
    const vehicle = RouteData.VEHICLES[line.fleet.vehicleType]?.label || line.fleet.vehicleType;
    const cargo = line.cargo.map((item) => `${fmt(item.quantity)} ${RouteData.RESOURCES[item.resource]?.label.toLowerCase() || item.resource}`).join(", ");
    const facts = [
      ["Provider", `${line.provider.name} (${line.provider.id})`],
      ["Vehicles", `${fmt(line.vehicles)} × ${vehicle}, ${fmt(line.fleet.capacityKg)} kg each`],
      ["From", RouteStore.pointLabel(line.from)],
      ["To", RouteStore.pointLabel(line.to)],
      ["Weight", `${fmt(line.weightKg)} kg`],
      ["Cargo", cargo],
      ["Distance", `${fmt(line.haulKm)} km haul, ${fmt(line.deadheadKm)} km to the pickup (${line.routeSource})`],
      ["Estimated time", `${fmt(line.etaHours)} hours`],
      ["Estimated cost", `₹${fmt(line.cost)}`],
    ];
    if (line.zone) facts.push(["Flood zone", `${line.zone.name} (${line.zone.effect === "boats_only" ? "boats only" : `delay +${line.zone.delayHours} h`})`]);
    for (const advisory of line.advisories) facts.push(["Advisory", advisory]);
    return facts;
  }

  static async submit(state, box, error) {
    if (state.done || state.busy) return;
    state.busy = true;
    // The store re-checks everything: availability may have changed since the window opened.
    let done;
    try {
      done = await state.store.createShipments(state.request);
    } finally {
      state.busy = false;
    }
    if (!done.ok) {
      error.textContent = done.reason;
      error.hidden = false;
      return;
    }
    state.done = true;
    const note = ShipmentWindow.element("section", "", "panel");
    const codes = done.shipments.map((shipment) => shipment.trackingCode).join(", ");
    note.append(
      ShipmentWindow.element("h2", "Booked"),
      ShipmentWindow.element("p", `Booking ${done.reference}. Tracking codes: ${codes}.`),
      ShipmentWindow.element("p", `This window closes now. The site ${state.caller} shows the booking too.`),
    );
    box.replaceChildren(note);
    state.resolve({
      ok: true,
      reference: done.reference,
      summary: done.summary,
      shipments: done.shipments,
      totalCost: done.totalCost,
      currency: done.currency,
      note: "Confirmed by a person in RouteBridge's own window, which has now closed. Simulated: no vehicle was dispatched.",
      simulated: true,
    });
  }

  static cancel(state, box) {
    if (state.done || state.busy) return;
    state.done = true;
    const note = ShipmentWindow.element("section", "", "panel");
    note.append(
      ShipmentWindow.element("h2", "Not booked"),
      ShipmentWindow.element("p", `Nothing was changed. This window closes now, and ${state.caller} carries on.`),
    );
    box.replaceChildren(note);
    state.resolve({ ok: false, reason: "The person at RouteBridge declined in this site's window. Nothing was booked." });
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
