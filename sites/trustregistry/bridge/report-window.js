// The write TrustRegistry shares with other agent sites: filing a suspicious-agent report.
// bridge-actions.js registers it.
//
// A partner's write never runs in the partner's page. It runs here, in a window on
// TrustRegistry's own origin, where a person sees exactly what would be filed and confirms
// or cancels. The calling site gets back only the report's reference and a summary.
import { ReadActions } from "../js/action-schemas.js";
import { RegistryStore } from "../js/registry-store.js";
import { SiteLinks } from "../js/site-links.js";

export class ReportWindow {
  /** The sites allowed to make this write, as exact origins. Never "*". */
  static CALLERS = SiteLinks.CALLERS;
  static SITE_NAME = "TrustRegistry";
  static CONFIRM_LABEL = "File this report";

  static definition() {
    return {
      name: "report_suspicious_agent",
      description: "File a suspicious-agent report against an agent network (net:<name>) or an organisation (org:<id>), in one call. Call it only when the visitor asks, or after they approved reporting. A TrustRegistry window opens where a person checks the report and confirms it, so never ask for names or contact details. It returns only once they confirmed or cancelled: with ok true it is filed and the window has closed. Returns the report reference and a summary, or ok false with the site's reason. A report is an allegation: it does not change the subject's status.",
      effect: "irreversible",
      availability: "bridge",
      callerOrigins: ReportWindow.CALLERS,
      confirmsInWindow: true,
      inputSchema: ReadActions.REPORT_INPUT,
      execute: ReportWindow.start,
    };
  }

  /** Check the request with the site's rules, then ask the person in this window. */
  static async start(args, context) {
    const store = await RegistryStore.open();
    const check = store.checkReport(args);
    // A request the site would refuse gets no form, only the site's reason.
    if (!check.ok) return { ok: false, reason: check.reason };
    const state = { store, request: args, caller: ReportWindow.hostOf(context?.callerOrigin), done: false };
    return new Promise((resolve) => ReportWindow.show(state, resolve));
  }

  static show(state, resolve) {
    state.resolve = resolve;
    document.title = `${ReportWindow.SITE_NAME} — confirm report`;
    document.body.classList.add("write-window");
    const sheet = document.createElement("link");
    sheet.rel = "stylesheet";
    sheet.href = new URL("../styles.css", import.meta.url).href;
    document.head.append(sheet);

    const header = ReportWindow.element("header", "");
    header.append(ReportWindow.element("span", "TR", "brand-mark"), ReportWindow.element("span", ReportWindow.SITE_NAME));

    const box = ReportWindow.element("main", "");
    const intro = ReportWindow.element("section", "", "panel intro");
    intro.append(
      ReportWindow.element("h1", "File a suspicious-agent report"),
      ReportWindow.element("p", `The site ${state.caller} asks TrustRegistry to put this report on file. A report is an allegation: it is shown to everyone who looks the subject up, but it does not change the subject's status. Its assistant gets back the report's reference and a one-line summary, nothing else.`),
      ReportWindow.element("p", "Simulated demonstration registry.", "sub"),
    );
    const card = ReportWindow.element("section", "", "panel");
    card.setAttribute("aria-label", "What you are confirming");
    const list = ReportWindow.element("ul", "", "summary-list");
    for (const line of state.store.reportSummaryLines(state.request)) list.append(ReportWindow.element("li", line));
    card.append(ReportWindow.element("h2", "Report to file"), list);

    const actions = ReportWindow.element("div", "", "actions");
    const confirm = ReportWindow.element("button", ReportWindow.CONFIRM_LABEL);
    confirm.type = "button";
    const cancel = ReportWindow.element("button", "Do not file", "secondary");
    cancel.type = "button";
    actions.append(confirm, cancel);
    const error = ReportWindow.element("p", "", "field-error");
    error.setAttribute("role", "alert");
    error.hidden = true;
    card.append(error, actions);

    confirm.addEventListener("click", () => ReportWindow.submit(state, box, error));
    cancel.addEventListener("click", () => ReportWindow.cancel(state, box));
    box.append(intro, card);
    document.body.append(header, box);
    // Start on the heading, which Enter cannot activate, so a stray Enter confirms nothing.
    const heading = intro.querySelector("h1");
    heading.tabIndex = -1;
    heading.focus();
  }

  static submit(state, box, error) {
    if (state.done) return;
    // The store re-checks everything: the same report may have been filed meanwhile.
    const done = state.store.fileReport(state.request, { reportedBy: state.caller });
    if (!done.ok) {
      error.textContent = done.reason;
      error.hidden = false;
      return;
    }
    state.done = true;
    const note = ReportWindow.element("section", "", "panel");
    note.append(
      ReportWindow.element("h2", "Report filed"),
      ReportWindow.element("p", `Reference ${done.reference}. It is now shown with the subject's record.`),
      ReportWindow.element("p", `This window closes now. The site ${state.caller} shows the reference too.`),
    );
    box.replaceChildren(note);
    state.resolve({
      ok: true,
      reference: done.reference,
      summary: done.summary,
      subjectId: done.subjectId,
      reason: done.reason,
      openReportsForSubject: done.openReportsForSubject,
      note: "Confirmed by a person in TrustRegistry's own window, which has now closed. A report does not change the subject's status.",
      simulated: true,
    });
  }

  static cancel(state, box) {
    if (state.done) return;
    state.done = true;
    const note = ReportWindow.element("section", "", "panel");
    note.append(
      ReportWindow.element("h2", "Not filed"),
      ReportWindow.element("p", `Nothing was changed. This window closes now, and ${state.caller} carries on.`),
    );
    box.replaceChildren(note);
    state.resolve({ ok: false, reason: "The person at TrustRegistry declined in this site's window. No report was filed." });
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
