// ShelterConnect page. It renders the store and wires the forms. The page's own buttons
// and the assistant's actions (site-actions.js) call the same methods on App.page, so
// both follow one set of rules.
import { ShelterData } from "./shelter-data.js";
import { ShelterStore } from "./shelter-store.js";
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

export class ShelterPage {
  constructor(store) {
    this.store = store;
    this.notice = { text: "", kind: "" };
  }

  // ---- what the assistant reads --------------------------------------------------

  getState() {
    return {
      ...this.store.overview(),
      openRequests: this.store.resourceRequests({ status: "open" }).requests.length,
    };
  }

  shelterIds() {
    return this.store.shelterIds();
  }

  // ---- operations (page buttons and assistant actions both call these) --------------

  updateInventory(args) { return this.finish(this.store.updateInventory(args), "inventory"); }
  publishRequest(args) { return this.finish(this.store.publishRequest(args), "request"); }
  setUrgency(args) { return this.finish(this.store.setUrgency(args), "shelters"); }
  updateOccupancy(args) { return this.finish(this.store.updateOccupancy(args), "shelters"); }
  registerShelter(args) { return this.finish(this.store.registerShelter(args), "register"); }
  checkShelter(args) { return this.store.checkShelter(args); }

  resetDemo() {
    const result = this.store.reset();
    this.say("Demo data restored to the simulated seed.", "ok");
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
    this.notice = { text, kind };
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
    this.renderShelters();
    this.renderRequests();
    this.renderDeliveries();
    this.fillSelects();
  }

  renderSummary() {
    const overview = this.store.overview();
    const requests = this.store.resourceRequests({ status: "all" });
    const open = requests.requests.filter((row) => row.status === "open");
    const tiles = [
      ["Registered shelters", fmt(overview.totals.shelters)],
      ["People sheltered", `${fmt(overview.totals.occupancy)} / ${fmt(overview.totals.capacity)}`],
      ["Open resource requests", fmt(open.length)],
      ["Units still short", fmt(open.reduce((sum, row) => sum + row.shortage, 0))],
    ];
    document.querySelector("#summary").replaceChildren(...tiles.map(([label, value]) =>
      el("div", { class: "tile" }, [el("span", { class: "tile-label", text: label }), el("strong", { class: "tile-value", text: value })])));
  }

  renderShelters() {
    const rows = this.store.overview().shelters.map((shelter) => {
      const select = el("select", { "aria-label": `Urgency of ${shelter.name}`, onchange: (event) => this.setUrgency({ shelterId: shelter.id, urgency: event.target.value }) },
        ShelterData.URGENCY.map((level) => el("option", { value: level, selected: level === shelter.urgency, text: level })));
      return el("tr", {}, [
        el("td", {}, [el("strong", { text: shelter.name }), el("div", { class: "sub", text: `${shelter.id} · ${shelter.block}, ${shelter.district}` })]),
        el("td", { class: "num", text: `${fmt(shelter.occupancy)} / ${fmt(shelter.capacity)}` }),
        el("td", { class: "num", text: fmt(shelter.freeCapacity) }),
        el("td", {}, [el("span", { class: `badge urgency-${shelter.urgency}`, text: shelter.urgency }), " ", select]),
        el("td", { class: "sub", text: `${shelter.location.lat.toFixed(4)}, ${shelter.location.lng.toFixed(4)}` }),
      ]);
    });
    document.querySelector("#shelter-rows").replaceChildren(...rows);
  }

  renderRequests() {
    const data = this.store.resourceRequests({ status: "all" });
    const rows = data.requests.map((row) => el("tr", {}, [
      el("td", {}, [el("strong", { text: row.shelterName }), el("div", { class: "sub", text: row.shelterId })]),
      el("td", { text: row.resourceLabel }),
      el("td", { class: "num", text: fmt(row.quantityRequired) }),
      el("td", { class: "num", text: fmt(row.quantityInStock) }),
      el("td", { class: "num" }, [el("strong", { class: row.shortage ? "short" : "covered", text: fmt(row.shortage) })]),
      el("td", {}, [el("span", { class: `badge urgency-${row.urgency}`, text: row.urgency })]),
      el("td", { class: "sub", text: new Date(row.neededBy).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) }),
      el("td", {}, [el("span", { class: `badge status-${row.status}`, text: row.status })]),
    ]));
    document.querySelector("#request-rows").replaceChildren(...rows);
    const totals = Object.entries(data.totals).map(([resource, total]) =>
      el("li", {}, [el("span", { text: ShelterData.RESOURCES[resource].label }), el("strong", { text: `${fmt(total.shortage)} short of ${fmt(total.required)}` })]));
    document.querySelector("#request-totals").replaceChildren(...totals);
  }

  renderDeliveries() {
    const list = this.store.inventory().recentDeliveries.slice().reverse();
    const body = document.querySelector("#delivery-rows");
    if (!list.length) {
      body.replaceChildren(el("tr", {}, [el("td", { colspan: 5, class: "empty", text: "No deliveries recorded yet. A coordinating site records them here after the shelter confirms receipt." })]));
      return;
    }
    body.replaceChildren(...list.map((item) => el("tr", {}, [
      el("td", { text: item.reference }),
      el("td", { text: item.shelterId }),
      el("td", { text: ShelterData.RESOURCES[item.resource]?.label || item.resource }),
      el("td", { class: "num", text: fmt(item.quantity) }),
      el("td", { class: "sub", text: `${item.shipmentRef} · ${new Date(item.recordedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}` }),
    ])));
  }

  fillSelects() {
    const shelters = this.store.overview().shelters;
    for (const select of document.querySelectorAll("select[data-fill='shelters']")) {
      const current = select.value;
      select.replaceChildren(...shelters.map((shelter) => el("option", { value: shelter.id, text: `${shelter.id} — ${shelter.name}` })));
      if (shelters.some((shelter) => shelter.id === current)) select.value = current;
    }
    for (const select of document.querySelectorAll("select[data-fill='resources']")) {
      if (select.options.length) continue;
      select.replaceChildren(...Object.entries(ShelterData.RESOURCES).map(([id, resource]) => el("option", { value: id, text: resource.label })));
    }
    for (const select of document.querySelectorAll("select[data-fill='urgency']")) {
      if (select.options.length) continue;
      select.replaceChildren(...ShelterData.URGENCY.map((level) => el("option", { value: level, text: level })));
      select.value = "high";
    }
  }

  renderLinks() {
    const list = document.querySelector("#partner-links");
    list.replaceChildren(...Object.values(SiteLinks.PARTNERS).map((partner) => el("li", {}, [
      el("a", { href: partner.page, text: partner.label, rel: "noopener" }), ` — ${partner.purpose}`,
    ])));
    const network = `${SiteLinks.SELF}/shelterconnect`;
    document.querySelector("#network-url").textContent = network;
    document.querySelector("#manifest-link").href = "./agent-manifest.json";
    document.querySelector("#network-link").href = "./shelterconnect.network.json";
  }

  // ---- form wiring ---------------------------------------------------------------

  wire() {
    const number = (form, name) => {
      const raw = form.elements[name].value.trim();
      return raw === "" ? NaN : Number(raw);
    };
    document.querySelector("#inventory-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.target;
      const result = this.updateInventory({ shelterId: form.elements.shelterId.value, resource: form.elements.resource.value, quantity: number(form, "quantity") });
      if (result.ok) { this.say(`Stock updated: ${result.shelterId} now holds ${fmt(result.stock)} ${ShelterData.RESOURCES[result.resource].label.toLowerCase()}.`, "ok"); form.elements.quantity.value = ""; }
    });
    document.querySelector("#request-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.target;
      const result = this.publishRequest({ shelterId: form.elements.shelterId.value, resource: form.elements.resource.value, quantityRequired: number(form, "quantityRequired"), neededBy: form.elements.neededBy.value });
      if (result.ok) { this.say("Resource request published. Partner agent sites now read the new requirement.", "ok"); form.elements.quantityRequired.value = ""; }
    });
    document.querySelector("#register-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.target;
      const result = this.registerShelter({
        name: form.elements.name.value, block: form.elements.block.value,
        lat: number(form, "lat"), lng: number(form, "lng"),
        capacity: number(form, "capacity"), occupancy: number(form, "occupancy"), urgency: form.elements.urgency.value,
      });
      if (result.ok) { this.say(`Shelter ${result.shelterId} registered. Publish its resource requests next.`, "ok"); form.reset(); this.fillSelects(); }
    });
    document.querySelector("#reset-demo").addEventListener("click", () => this.resetDemo());
    // A delivery recorded in this site's confirmation window (opened by a partner agent
    // site) lands in the same storage. Pick it up without a reload.
    window.addEventListener("storage", (event) => {
      if (event.key === ShelterStore.STORAGE_KEY || event.key === null) {
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
    App.page = new ShelterPage(new ShelterStore());
    App.page.wire();
    App.page.renderLinks();
    App.page.render();
    return App.page;
  }
}

if (typeof document !== "undefined") {
  App.start();
}
