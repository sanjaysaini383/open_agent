// AidSupply page. It renders the store and wires the forms. The page's own buttons and
// the assistant's actions (site-actions.js) call the same methods on App.page, so both
// follow one set of rules.
import { SiteLinks } from "./site-links.js";
import { SupplyData } from "./supply-data.js";
import { SupplyStore } from "./supply-store.js";

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
const money = (value) => `₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (iso) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
const resourceLabel = (id) => SupplyData.RESOURCES[id]?.label || id;

export class SupplyPage {
  constructor(store) {
    this.store = store;
  }

  // ---- what the assistant reads --------------------------------------------------

  getState() {
    const offers = this.store.offers().offers;
    return {
      ...this.store.directory(),
      activeOffers: offers.length,
      standingReservations: this.store.reservationsList().reservations.filter((entry) => entry.status === "reserved").length,
    };
  }

  // ---- operations (page buttons and assistant actions both call these) --------------

  registerSupplier(args) { return this.finish(this.store.registerSupplier(args), "supplier"); }
  checkSupplier(args) { return this.store.checkSupplier(args); }
  publishOffer(args) { return this.finish(this.store.publishOffer(args), "offer"); }
  updateOfferStock(args) { return this.finish(this.store.updateOfferStock(args), "stock"); }
  releaseReservation(args) { return this.finish(this.store.releaseReservation(args), "reservations"); }

  resetDemo() {
    const result = this.store.reset();
    document.querySelector("#quote-result").replaceChildren();
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
    this.renderSuppliers();
    this.renderOffers();
    this.renderReservations();
    this.fillSelects();
  }

  renderSummary() {
    const suppliers = this.store.directory().suppliers;
    const offers = this.store.offers().offers;
    const standing = this.store.reservationsList().reservations.filter((entry) => entry.status === "reserved");
    const tiles = [
      ["Listed suppliers", fmt(suppliers.length)],
      ["Published offers", fmt(offers.length)],
      ["Units available", fmt(offers.reduce((sum, offer) => sum + offer.quantityAvailable, 0))],
      ["Standing reservations", `${fmt(standing.length)} · ${money(standing.reduce((sum, entry) => sum + entry.total, 0))}`],
    ];
    document.querySelector("#summary").replaceChildren(...tiles.map(([label, value]) =>
      el("div", { class: "tile" }, [el("span", { class: "tile-label", text: label }), el("strong", { class: "tile-value", text: value })])));
  }

  renderSuppliers() {
    const rows = this.store.directory().suppliers.map((supplier) => el("tr", {}, [
      el("td", {}, [el("strong", { text: supplier.name }), el("div", { class: "sub", text: `${supplier.id} · ${supplier.organizationId}` })]),
      el("td", {}, [el("span", { class: "badge status-simulated", text: supplier.type === "ngo" ? "NGO" : "Commercial" })]),
      el("td", {}, [supplier.city, el("div", { class: "sub", text: supplier.state })]),
      el("td", { class: "sub", text: `${supplier.location.lat.toFixed(4)}, ${supplier.location.lng.toFixed(4)}` }),
      el("td", {}, [supplier.registrationRef, el("div", { class: "sub", text: "Self-declared, not verified here" })]),
      el("td", { class: "sub", text: supplier.listedSince }),
    ]));
    document.querySelector("#supplier-rows").replaceChildren(...rows);
  }

  renderOffers() {
    const rows = this.store.offers().offers.map((offer) => {
      const listed = this.store.findOffer(offer.offerId).quantity;
      return el("tr", {}, [
        el("td", {}, [el("strong", { text: offer.offerId }), el("div", { class: "sub", text: offer.supplierName })]),
        el("td", { text: resourceLabel(offer.resource) }),
        el("td", { class: "num" }, [el("strong", { class: offer.quantityAvailable ? "covered" : "short", text: fmt(offer.quantityAvailable) }), el("div", { class: "sub", text: `of ${fmt(listed)} listed` })]),
        el("td", { class: "num", text: money(offer.unitPrice) }),
        el("td", { class: "num", text: fmt(offer.minOrder) }),
        el("td", { class: "num", text: `${offer.leadTimeHours} h` }),
        el("td", { class: "sub", text: when(offer.validUntil) }),
        // Supplier-written text: always shown as plain text, never as markup.
        el("td", { class: "notes", text: offer.notes }),
      ]);
    });
    document.querySelector("#offer-rows").replaceChildren(...rows);
  }

  renderReservations() {
    const list = this.store.reservationsList().reservations.slice().reverse();
    const body = document.querySelector("#reservation-rows");
    if (!list.length) {
      body.replaceChildren(el("tr", {}, [el("td", { colspan: 6, class: "empty", text: "No reservations yet. A coordinating site asks to reserve stock; a person confirms it in an AidSupply window, and it appears here." })]));
      return;
    }
    body.replaceChildren(...list.map((entry) => el("tr", {}, [
      el("td", {}, [el("strong", { text: entry.reference }), el("div", { class: "sub", text: when(entry.createdAt) })]),
      el("td", { text: entry.incidentRef }),
      el("td", {}, entry.lines.map((line) => el("div", { text: `${fmt(line.quantity)} ${resourceLabel(line.resource).toLowerCase()} · ${line.supplierName} · ${money(line.unitPrice)} each` }))),
      el("td", { class: "num", text: money(entry.total) }),
      el("td", {}, [el("span", { class: `badge status-${entry.status}`, text: entry.status })]),
      el("td", {}, entry.status === "reserved"
        ? [el("button", { type: "button", class: "mini", text: "Release stock", onclick: () => {
          const result = this.releaseReservation({ reference: entry.reference });
          if (result.ok) this.say(`Reservation ${result.reference} released. Its stock is available again.`, "ok");
        } })]
        : []),
    ])));
  }

  fillSelects() {
    const suppliers = this.store.directory().suppliers;
    const offers = this.store.offers().offers;
    for (const select of document.querySelectorAll("select[data-fill='suppliers']")) {
      const current = select.value;
      select.replaceChildren(...suppliers.map((supplier) => el("option", { value: supplier.id, text: `${supplier.id} — ${supplier.name}` })));
      if (suppliers.some((supplier) => supplier.id === current)) select.value = current;
    }
    for (const select of document.querySelectorAll("select[data-fill='offers']")) {
      const current = select.value;
      select.replaceChildren(...offers.map((offer) => el("option", { value: offer.offerId, text: `${offer.offerId} — ${resourceLabel(offer.resource)}, ${offer.supplierName}` })));
      if (offers.some((offer) => offer.offerId === current)) select.value = current;
    }
    for (const select of document.querySelectorAll("select[data-fill='resources']")) {
      if (select.options.length) continue;
      select.replaceChildren(...Object.entries(SupplyData.RESOURCES).map(([id, resource]) => el("option", { value: id, text: resource.label })));
    }
    for (const select of document.querySelectorAll("select[data-fill='types']")) {
      if (select.options.length) continue;
      select.replaceChildren(el("option", { value: "ngo", text: "NGO" }), el("option", { value: "commercial", text: "Commercial" }));
    }
  }

  /** Show a quote in the calculator panel. The visitor asked for it with the form. */
  showQuote(result) {
    const box = document.querySelector("#quote-result");
    if (!result.ok) {
      box.replaceChildren();
      return;
    }
    const quote = result.quote;
    box.replaceChildren(el("div", { class: "quote-box" }, [
      el("span", { class: "badge status-simulated quote-flag", text: "Non-binding quote · reserves nothing" }),
      el("h3", { text: `${fmt(quote.quantity)} ${resourceLabel(quote.resource).toLowerCase()} from ${quote.supplierName}` }),
      el("dl", { class: "facts" }, [
        el("dt", { text: "List price" }), el("dd", { text: `${money(quote.listUnitPrice)} each · ${money(quote.listTotal)}` }),
        el("dt", { text: "Quoted price" }), el("dd", {}, [el("strong", { text: `${money(quote.quotedUnitPrice)} each · ${money(quote.total)}` })]),
        el("dt", { text: "Discount" }), el("dd", { text: `${quote.discountPct}% · saves ${money(quote.saving)}` }),
        el("dt", { text: "Lead time" }), el("dd", { text: `${quote.leadTimeHours} hours` }),
        el("dt", { text: "Quote valid until" }), el("dd", { text: when(quote.validUntil) }),
      ]),
      el("ul", {}, quote.basis.map((line) => el("li", { text: line }))),
    ]));
  }

  renderLinks() {
    document.querySelector("#partner-links").replaceChildren(...Object.values(SiteLinks.PARTNERS).map((partner) => el("li", {}, [
      el("a", { href: partner.page, text: partner.label, rel: "noopener" }), ` — ${partner.purpose}`,
    ])));
    document.querySelector("#network-url").textContent = `${SiteLinks.SELF}/aidsupply`;
    document.querySelector("#manifest-link").href = "./agent-manifest.json";
    document.querySelector("#network-link").href = "./aidsupply.network.json";
  }

  // ---- form wiring ---------------------------------------------------------------

  wire() {
    const number = (form, name) => {
      const raw = form.elements[name].value.trim();
      return raw === "" ? NaN : Number(raw);
    };
    const optionalNumber = (form, name) => {
      const raw = form.elements[name].value.trim();
      return raw === "" ? undefined : Number(raw);
    };

    document.querySelector("#quote-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.target;
      const args = { offerId: form.elements.offerId.value, quantity: number(form, "quantity") };
      const target = optionalNumber(form, "targetUnitPrice");
      if (target !== undefined) args.targetUnitPrice = target;
      const result = this.finish(this.store.improvedOffer(args), "quote");
      this.showQuote(result);
    });

    document.querySelector("#supplier-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.target;
      const result = this.registerSupplier({
        name: form.elements.name.value, type: form.elements.type.value,
        city: form.elements.city.value, state: form.elements.state.value,
        lat: number(form, "lat"), lng: number(form, "lng"),
        registrationRef: form.elements.registrationRef.value,
      });
      if (result.ok) { this.say(`Supplier ${result.supplierId} listed. Its details are self-declared until TrustRegistry verifies ${result.organizationId}.`, "ok"); form.reset(); this.fillSelects(); }
    });

    document.querySelector("#offer-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.target;
      const args = {
        supplierId: form.elements.supplierId.value, resource: form.elements.resource.value,
        quantity: number(form, "quantity"), unitPrice: number(form, "unitPrice"),
        minOrder: number(form, "minOrder"), leadTimeHours: number(form, "leadTimeHours"),
        notes: form.elements.notes.value,
      };
      const limit = optionalNumber(form, "maxDiscountPct");
      if (limit !== undefined) args.maxDiscountPct = limit;
      const result = this.publishOffer(args);
      if (result.ok) {
        this.say(`Offer ${result.offer.offerId} ${result.replaced ? "updated" : "published"}. Partner agent sites now read it.`, "ok");
        for (const name of ["quantity", "unitPrice", "minOrder", "leadTimeHours", "notes", "maxDiscountPct"]) form.elements[name].value = "";
      }
    });

    document.querySelector("#stock-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.target;
      const result = this.updateOfferStock({ offerId: form.elements.offerId.value, quantity: number(form, "quantity") });
      if (result.ok) { this.say(`Stock updated: ${fmt(result.quantityAvailable)} now available on ${result.offerId}.`, "ok"); form.elements.quantity.value = ""; }
    });

    document.querySelector("#reset-demo").addEventListener("click", () => this.resetDemo());

    // A reservation confirmed in this site's window (opened by a partner agent site) lands
    // in the same storage. Pick it up without a reload.
    window.addEventListener("storage", (event) => {
      if (event.key === SupplyStore.STORAGE_KEY || event.key === null) {
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
    App.page = new SupplyPage(new SupplyStore());
    App.page.wire();
    App.page.renderLinks();
    App.page.render();
    return App.page;
  }
}

if (typeof document !== "undefined") {
  App.start();
}
