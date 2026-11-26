// RouteBridge page. It renders the store and wires the forms. The page's own buttons and
// the assistant's actions (site-actions.js) call the same methods on App.page, so both
// follow one set of rules.
import { RouteData } from "./route-data.js";
import { RouteStore } from "./route-store.js";
import { SiteLinks } from "./site-links.js";

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

const fmt = (value) => Number(value).toLocaleString("en-IN");
const inr = (value) => `₹${fmt(value)}`;
const vehicleLabel = (type) => RouteData.VEHICLES[type]?.label || type;
const statusLabel = (status) => String(status).replace(/_/g, " ");
const when = (iso) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

export class RoutePage {
  constructor(store) {
    this.store = store;
    this.lastPlan = null;
  }

  // ---- what the assistant reads --------------------------------------------------

  getState() {
    return this.store.providers();
  }

  // ---- operations (page buttons and assistant actions both call these) --------------

  registerProvider(args) { return this.finish(this.store.registerProvider(args), "register"); }
  checkProvider(args) { return this.store.checkProvider(args); }
  updateFleetAvailability(args) { return this.finish(this.store.updateFleetAvailability(args), "fleet"); }
  updateShipmentStatus(args) { return this.finish(this.store.updateShipmentStatus(args), "shipments"); }
  setRoutingSource(args) { return this.finish(this.store.setRoutingSource(args), "routing"); }

  /** Compare options for the planner form and show them. Books nothing. */
  async planRoute(args) {
    const result = await this.store.transportOptions(args);
    const refused = result.ok === false;
    const line = document.querySelector("#msg-planner");
    line.textContent = refused ? result.reason : "";
    line.hidden = !refused;
    if (!refused) {
      this.lastPlan = result;
      this.renderPlan();
    }
    return result;
  }

  resetDemo() {
    const result = this.store.reset();
    this.lastPlan = null;
    this.say("Demo data restored to the simulated seed. Routing is back on the demonstration dataset.", "ok");
    this.render();
    return result;
  }

  /** Re-render after an operation, and clear that panel's earlier refusal. No focus moves. */
  finish(result, panel) {
    const line = document.querySelector(`#msg-${panel}`);
    if (line) {
      line.textContent = result.ok ? "" : result.reason;
      line.hidden = result.ok;
    }
    if (result.ok) this.render();
    return result;
  }

  say(text, kind) {
    const line = document.querySelector("#page-notice");
    if (line) {
      line.textContent = text;
      line.dataset.kind = kind;
      line.hidden = !text;
    }
  }

  // ---- rendering -----------------------------------------------------------------

  render() {
    this.renderSummary();
    this.renderProviders();
    this.renderZones();
    this.renderRouting();
    this.renderPlan();
    this.renderShipments();
    this.fillSelects();
  }

  renderSummary() {
    const summary = this.store.summary();
    const tiles = [
      ["Transport providers", fmt(summary.providers)],
      ["Vehicles free now", `${fmt(summary.vehiclesFree)} / ${fmt(summary.vehicles)}`],
      ["Active shipments", fmt(summary.activeShipments)],
      ["Delivered shipments", `${fmt(summary.deliveredShipments)} of ${fmt(summary.shipments)}`],
    ];
    document.querySelector("#summary").replaceChildren(...tiles.map(([label, value]) =>
      el("div", { class: "tile" }, [el("span", { class: "tile-label", text: label }), el("strong", { class: "tile-value", text: value })])));
  }

  renderProviders() {
    const rows = [];
    for (const provider of this.store.providers().providers) {
      provider.fleet.forEach((fleet, index) => {
        rows.push(el("tr", {}, [
          index === 0
            ? el("td", { rowspan: provider.fleet.length }, [
              el("strong", { text: provider.name }),
              el("div", { class: "sub", text: `${provider.id} · ${provider.organizationId} · base ${provider.base.city}` }),
              el("div", { class: "sub", text: `${provider.base.lat.toFixed(4)}, ${provider.base.lng.toFixed(4)}` }),
            ])
            : null,
          el("td", { text: vehicleLabel(fleet.vehicleType) }),
          el("td", { class: "num", text: fmt(fleet.count) }),
          el("td", { class: "num" }, [el("strong", { class: fleet.available ? "covered" : "short", text: fmt(fleet.available) })]),
          el("td", { class: "num", text: `${fmt(fleet.capacityKg)} kg` }),
          el("td", { class: "num", text: `${fmt(fleet.avgSpeedKmh)} km/h` }),
          el("td", { class: "num", text: `${inr(fleet.ratePerKm)}/km` }),
          el("td", {}, [el("span", { class: `badge ${fleet.floodCapable ? "status-available" : "status-simulated"}`, text: fleet.floodCapable ? "yes" : "no" })]),
        ]));
      });
    }
    document.querySelector("#provider-rows").replaceChildren(...rows);
  }

  renderZones() {
    const rows = RouteStore.floodZones().map((zone) => el("tr", {}, [
      el("td", {}, [el("strong", { text: zone.name }), el("div", { class: "sub", text: zone.id })]),
      el("td", { class: "sub", text: `${zone.center.lat.toFixed(4)}, ${zone.center.lng.toFixed(4)} · ${zone.radiusKm} km` }),
      el("td", {}, [
        el("span", { class: `badge ${zone.effect === "boats_only" ? "status-flagged" : "status-pending"}`, text: zone.effect === "boats_only" ? "boats only" : `delay +${zone.delayHours} h` }),
        el("div", { class: "sub", text: zone.note }),
      ]),
    ]));
    document.querySelector("#zone-rows").replaceChildren(...rows);
  }

  renderRouting() {
    const routing = this.store.routingInfo();
    const live = routing.source !== "demo-dataset";
    document.querySelector("#routing-current").textContent = live ? `live routing service (${routing.source})` : "demonstration dataset (demo-dataset)";
    document.querySelector("#routing-method").textContent = `${routing.method}. ${routing.note}`;
    const field = document.querySelector("#routing-form").elements.baseUrl;
    if (document.activeElement !== field) field.value = this.store.state.routing.osrmBaseUrl;
  }

  renderPlan() {
    const body = document.querySelector("#option-rows");
    const meta = document.querySelector("#planner-meta");
    const plan = this.lastPlan;
    if (!plan) {
      meta.textContent = "";
      body.replaceChildren(el("tr", {}, [el("td", { colspan: 10, class: "empty", text: "Choose a lane and a load, then compare transport options." })]));
      return;
    }
    const zone = plan.zone ? ` Destination is inside ${plan.zone.name} (${plan.zone.effect === "boats_only" ? "boats only" : `delay +${plan.zone.delayHours} h`}).` : " Destination is outside every flood zone.";
    meta.textContent = `Haul ${fmt(plan.haulKm)} km for ${fmt(plan.request.weightKg)} kg.${zone} Distances: ${plan.routing.source} — ${plan.routing.method}.`;
    body.replaceChildren(...plan.options.map((option) => el("tr", { class: option.feasible ? "" : "row-muted" }, [
      el("td", {}, [el("strong", { text: option.providerName }), el("div", { class: "sub", text: `${option.providerId} · ${vehicleLabel(option.vehicleType)} · ${fmt(option.capacityKg)} kg each` })]),
      el("td", { class: "num", text: `${fmt(option.vehiclesNeeded)} of ${fmt(option.vehiclesAvailable)} free` }),
      el("td", { class: "num", text: `${fmt(option.deadheadKm)} km` }),
      el("td", { class: "num", text: `${fmt(option.haulKm)} km` }),
      el("td", { class: "num" }, [el("strong", { text: `${fmt(option.etaHours)} h` })]),
      el("td", { class: "num", text: inr(option.cost) }),
      el("td", {}, [el("span", { class: `badge ${option.feasible ? "status-available" : "status-flagged"}`, text: option.feasible ? "feasible" : "not feasible" })]),
      el("td", {}, [option.meetsDeadline === null
        ? el("span", { class: "sub", text: "no deadline" })
        : el("span", { class: `badge ${option.meetsDeadline ? "status-available" : "status-pending"}`, text: option.meetsDeadline ? "in time" : "too late" })]),
      el("td", { class: "sub advisories" }, option.advisories.length ? option.advisories.map((text) => el("div", { text })) : ["—"]),
      el("td", {}, [el("span", { class: "badge status-simulated", text: option.routeSource })]),
    ])));
  }

  renderShipments() {
    const list = this.store.shipments();
    const body = document.querySelector("#shipment-rows");
    if (!list.length) {
      body.replaceChildren(el("tr", {}, [el("td", { colspan: 6, class: "empty", text: "No shipments booked yet. A coordinating site books them here after a person at RouteBridge confirms the booking." })]));
      return;
    }
    body.replaceChildren(...list.map((shipment) => {
      const cargo = shipment.cargo.map((line) => `${fmt(line.quantity)} ${RouteData.RESOURCES[line.resource]?.label.toLowerCase() || line.resource}`).join(", ");
      const buttons = shipment.nextStatuses.map((status) => el("button", {
        type: "button",
        class: `small ${["cancelled", "failed"].includes(status) ? "secondary" : ""}`.trim(),
        "aria-label": `Mark ${shipment.trackingCode} as ${statusLabel(status)}`,
        onclick: () => {
          const result = this.updateShipmentStatus({ trackingCode: shipment.trackingCode, status });
          if (result.ok) this.say(`${shipment.trackingCode} is now ${statusLabel(result.status)}.`, "ok");
        },
        text: `Mark ${statusLabel(status)}`,
      }));
      return el("tr", {}, [
        el("td", {}, [el("strong", { text: shipment.trackingCode }), el("div", { class: "sub", text: `${shipment.bookingRef} · ${shipment.incidentRef}` }), el("div", { class: "sub", text: `ref ${shipment.reference}` })]),
        el("td", {}, [el("strong", { text: shipment.providerName }), el("div", { class: "sub", text: `${shipment.providerId} · ${fmt(shipment.vehicles)} × ${vehicleLabel(shipment.vehicleType)}` })]),
        el("td", {}, [
          el("div", { text: `${RouteStore.pointLabel(shipment.from)} → ${RouteStore.pointLabel(shipment.to)}` }),
          el("div", { class: "sub", text: `${fmt(shipment.weightKg)} kg · ${cargo}` }),
          el("div", { class: "sub", text: `${fmt(shipment.haulKm)} km haul · distances: ${shipment.routeSource}` }),
        ]),
        el("td", { class: "num" }, [el("strong", { text: `${fmt(shipment.etaHours)} h` }), el("div", { class: "sub", text: inr(shipment.cost) })]),
        el("td", {}, [
          el("span", { class: `badge status-${shipment.status}`, text: statusLabel(shipment.status) }),
          el("details", { class: "history" }, [
            el("summary", { text: "History" }),
            el("ol", {}, shipment.history.map((entry) => el("li", { text: `${statusLabel(entry.status)} — ${when(entry.at)}` }))),
          ]),
        ]),
        el("td", {}, buttons.length ? [el("div", { class: "btn-row" }, buttons)] : [el("span", { class: "sub", text: "Final" })]),
      ]);
    }));
  }

  /** Every place the planner offers: provider bases, then the demonstration's places. */
  places() {
    const bases = this.store.providers().providers.map((provider) => ({
      id: `base:${provider.id}`,
      label: `${provider.name} base, ${provider.base.city} (${provider.id})`,
      lat: provider.base.lat,
      lng: provider.base.lng,
    }));
    return [...bases, ...RouteData.PLACES.map((place) => ({ id: place.id, label: place.label, lat: place.lat, lng: place.lng }))];
  }

  fillSelects() {
    const places = this.places();
    for (const select of document.querySelectorAll("select[data-fill='places']")) {
      const current = select.value;
      select.replaceChildren(
        ...places.map((place) => el("option", { value: place.id, text: place.label })),
        el("option", { value: "custom", text: "Custom coordinates" }),
      );
      if (current && [...select.options].some((option) => option.value === current)) select.value = current;
      else select.value = select.name === "fromPlace" ? "SUP-C" : "SH-01";
      if (current !== select.value) this.applyPlace(select);
    }
    const providers = this.store.providers().providers;
    for (const select of document.querySelectorAll("select[data-fill='providers']")) {
      const current = select.value;
      select.replaceChildren(...providers.map((provider) => el("option", { value: provider.id, text: `${provider.id} — ${provider.name}` })));
      if (providers.some((provider) => provider.id === current)) select.value = current;
    }
    this.fillFleetTypes();
    for (const select of document.querySelectorAll("select[data-fill='vehicles']")) {
      if (select.options.length) continue;
      select.replaceChildren(...Object.entries(RouteData.VEHICLES).map(([id, vehicle]) => el("option", { value: id, text: vehicle.label })));
    }
  }

  /** The fleet form offers only the vehicle types the chosen provider has. */
  fillFleetTypes() {
    const form = document.querySelector("#fleet-form");
    const provider = this.store.findProvider(form.elements.providerId.value);
    const select = form.elements.vehicleType;
    const current = select.value;
    const types = provider ? provider.fleet.map((fleet) => fleet.vehicleType) : [];
    select.replaceChildren(...types.map((type) => el("option", { value: type, text: vehicleLabel(type) })));
    if (types.includes(current)) select.value = current;
  }

  /** Put a chosen place's coordinates in the lane's fields. "Custom" leaves them alone. */
  applyPlace(select) {
    const side = select.name === "fromPlace" ? "from" : "to";
    const place = this.places().find((entry) => entry.id === select.value);
    if (!place) return;
    const form = select.form;
    form.elements[`${side}Lat`].value = place.lat;
    form.elements[`${side}Lng`].value = place.lng;
  }

  renderLinks() {
    const list = document.querySelector("#partner-links");
    list.replaceChildren(...Object.values(SiteLinks.PARTNERS).map((partner) => el("li", {}, [
      el("a", { href: partner.page, text: partner.label, rel: "noopener" }), ` — ${partner.purpose}`,
    ])));
    document.querySelector("#network-url").textContent = `${SiteLinks.SELF}/routebridge`;
    document.querySelector("#manifest-link").href = "./agent-manifest.json";
    document.querySelector("#network-link").href = "./routebridge.network.json";
  }

  // ---- form wiring ---------------------------------------------------------------

  wire() {
    const number = (form, name) => {
      const raw = form.elements[name].value.trim();
      return raw === "" ? NaN : Number(raw);
    };

    const planner = document.querySelector("#planner-form");
    for (const name of ["fromPlace", "toPlace"]) {
      planner.elements[name].addEventListener("change", (event) => this.applyPlace(event.target));
    }
    // Typing coordinates by hand means the lane is no longer the chosen place.
    for (const [side, select] of [["from", "fromPlace"], ["to", "toPlace"]]) {
      for (const field of [`${side}Lat`, `${side}Lng`]) {
        planner.elements[field].addEventListener("input", () => { planner.elements[select].value = "custom"; });
      }
    }
    planner.addEventListener("submit", async (event) => {
      event.preventDefault();
      const point = (side) => {
        const select = planner.elements[`${side}Place`];
        const place = this.places().find((entry) => entry.id === select.value);
        const value = { lat: number(planner, `${side}Lat`), lng: number(planner, `${side}Lng`) };
        value.label = place ? place.label : "Custom point";
        return value;
      };
      const args = { from: point("from"), to: point("to"), weightKg: number(planner, "weightKg") };
      const deadline = planner.elements.neededWithinHours.value.trim();
      if (deadline !== "") args.neededWithinHours = Number(deadline);
      const result = await this.planRoute(args);
      if (result.ok !== false) {
        const feasible = result.options.filter((option) => option.feasible).length;
        this.say(`${feasible} of ${result.options.length} transport options are feasible for this load. Nothing was booked.`, feasible ? "ok" : "warn");
      }
    });

    document.querySelector("#register-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.target;
      const result = this.registerProvider({
        name: form.elements.name.value,
        city: form.elements.city.value,
        organizationId: form.elements.organizationId.value,
        lat: number(form, "lat"),
        lng: number(form, "lng"),
        vehicleType: form.elements.vehicleType.value,
        count: number(form, "count"),
        capacityKg: number(form, "capacityKg"),
        avgSpeedKmh: number(form, "avgSpeedKmh"),
        ratePerKm: number(form, "ratePerKm"),
      });
      if (result.ok) { this.say(`Provider ${result.providerId} registered. Partner agent sites now read it.`, "ok"); form.reset(); this.fillSelects(); }
    });

    const fleetForm = document.querySelector("#fleet-form");
    fleetForm.elements.providerId.addEventListener("change", () => this.fillFleetTypes());
    fleetForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const result = this.updateFleetAvailability({
        providerId: fleetForm.elements.providerId.value,
        vehicleType: fleetForm.elements.vehicleType.value,
        count: number(fleetForm, "count"),
      });
      if (result.ok) { this.say(`Fleet updated: ${result.providerId} has ${fmt(result.count)} ${vehicleLabel(result.vehicleType).toLowerCase()}(s), ${fmt(result.available)} free.`, "ok"); fleetForm.elements.count.value = ""; }
    });

    const routingForm = document.querySelector("#routing-form");
    routingForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const result = this.setRoutingSource({ baseUrl: routingForm.elements.baseUrl.value });
      if (result.ok) {
        this.lastPlan = null;
        this.renderPlan();
        this.say(result.routing.source === "demo-dataset"
          ? "Routing uses the demonstration dataset. No coordinates leave this site."
          : "Live routing is on. Route coordinates now go to that routing service.", result.routing.source === "demo-dataset" ? "ok" : "warn");
      }
    });
    document.querySelector("#routing-off").addEventListener("click", () => {
      routingForm.elements.baseUrl.value = "";
      const result = this.setRoutingSource({ baseUrl: "" });
      if (result.ok) {
        this.lastPlan = null;
        this.renderPlan();
        this.say("Routing uses the demonstration dataset. No coordinates leave this site.", "ok");
      }
    });

    document.querySelector("#reset-demo").addEventListener("click", () => this.resetDemo());

    // A booking confirmed in this site's window (opened by a partner agent site) lands in
    // the same storage. Pick it up without a reload.
    window.addEventListener("storage", (event) => {
      if (event.key === RouteStore.STORAGE_KEY || event.key === null) {
        this.store.state = this.store.load();
        this.render();
        this.say("Updated from another window on this site.", "ok");
      }
    });
  }
}

/**
 * The page's entry point. App.page is the single page object; site-actions.js and site.js
 * import this module by the same URL, so they share it.
 */
export class App {
  static page = null;

  static start() {
    App.page = new RoutePage(new RouteStore());
    App.page.wire();
    App.page.renderLinks();
    App.page.render();
    return App.page;
  }
}

if (typeof document !== "undefined") {
  App.start();
}
