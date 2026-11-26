// The write ReliefMesh Command shares with partner sites: filing an assistance request.
// bridge-actions.js registers it.
//
// It runs in a window on ReliefMesh Command's own origin. The person sees exactly what
// would be filed and who asked, and confirms or cancels. The calling site gets back only
// a reference. The request lands in the dashboard's inbox; it commits Command to nothing.
import { CommandData } from "./command-data.js";

export class AssistanceWindow {
  static SITE_NAME = "ReliefMesh Command";
  static CONFIRM_LABEL = "File this request";

  static definition() {
    return {
      name: "request_assistance",
      description: "File a request for coordinated help with ReliefMesh Command, in one call. A ReliefMesh window opens where the visitor checks the request and confirms it, so never ask for names of people, emails or phone numbers. It returns only once they confirmed or cancelled. Returns the reference, or ok false with the site's reason. Filing a request does not order or dispatch anything.",
      effect: "irreversible",
      availability: "bridge",
      callerOrigins: CommandData.WRITE_CALLERS,
      confirmsInWindow: true,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["organization", "category", "urgency", "summary"],
        properties: {
          organization: { type: "string", minLength: 2, maxLength: 80, description: "The organisation asking, such as the shelter network's name. Not a person's name." },
          category: { type: "string", enum: CommandData.CATEGORIES, description: "What kind of help." },
          urgency: { type: "string", enum: CommandData.URGENCY, description: "How urgent, from the requesting site's own data." },
          summary: { type: "string", minLength: 10, maxLength: 280, description: "One or two sentences on what is needed. No personal details." },
          resource: { type: "string", enum: CommandData.RESOURCES, description: "Optional: the resource needed." },
          quantity: { type: "integer", minimum: 1, maximum: 1000000, description: "Optional: how many units, with resource." },
        },
      },
      execute: AssistanceWindow.start,
    };
  }

  static start(args, context) {
    const data = new CommandData();
    const check = data.checkRequest(args);
    // A request the site would refuse gets no form, only the site's reason.
    if (!check.ok) return { ok: false, reason: check.reason };
    const state = { data, request: args, callerOrigin: context?.callerOrigin, caller: AssistanceWindow.hostOf(context?.callerOrigin), done: false };
    return new Promise((resolve) => AssistanceWindow.show(state, resolve));
  }

  static show(state, resolve) {
    state.resolve = resolve;
    document.title = `${AssistanceWindow.SITE_NAME} — confirm assistance request`;
    const sheet = document.createElement("link");
    sheet.rel = "stylesheet";
    sheet.href = new URL("./window.css", import.meta.url).href;
    document.head.append(sheet);

    const header = AssistanceWindow.element("header", "");
    header.append(AssistanceWindow.element("span", "RM", "mark"), AssistanceWindow.element("span", AssistanceWindow.SITE_NAME));

    const box = AssistanceWindow.element("main", "");
    const intro = AssistanceWindow.element("section", "", "panel");
    const heading = AssistanceWindow.element("h1", "File an assistance request?");
    intro.append(
      heading,
      AssistanceWindow.element("p", `The assistant on ${state.caller} asked ReliefMesh Command to record this request. Confirming puts it in the coordinator's inbox. It does not order supplies or dispatch transport. That site's assistant gets back the reference only.`),
      AssistanceWindow.element("p", "Simulated demonstration data.", "sub"),
    );

    const card = AssistanceWindow.element("section", "", "panel");
    card.setAttribute("aria-label", "What you are confirming");
    const list = document.createElement("dl");
    const rows = [
      ["Organisation", state.request.organization],
      ["Category", state.request.category],
      ["Urgency", state.request.urgency],
      ["Request", state.request.summary],
    ];
    if (state.request.resource) rows.push(["Resource", `${state.request.quantity} × ${state.request.resource.replace(/_/g, " ")}`]);
    rows.push(["Asked by", state.caller]);
    for (const [label, value] of rows) list.append(AssistanceWindow.element("dt", label), AssistanceWindow.element("dd", String(value)));

    const error = AssistanceWindow.element("p", "", "error");
    error.setAttribute("role", "alert");
    error.hidden = true;
    const actions = AssistanceWindow.element("div", "", "actions");
    const confirm = AssistanceWindow.element("button", AssistanceWindow.CONFIRM_LABEL);
    confirm.type = "button";
    const cancel = AssistanceWindow.element("button", "Do not file", "secondary");
    cancel.type = "button";
    actions.append(confirm, cancel);
    card.append(list, error, actions);

    confirm.addEventListener("click", () => AssistanceWindow.submit(state, box, error));
    cancel.addEventListener("click", () => AssistanceWindow.cancel(state, box));
    box.append(intro, card);
    document.body.append(header, box);
    // Start on the heading, which Enter cannot activate, so a stray Enter confirms nothing.
    heading.tabIndex = -1;
    heading.focus();
  }

  static submit(state, box, error) {
    if (state.done) return;
    let done;
    try {
      done = state.data.fileRequest(state.request, state.callerOrigin);
    } catch (failure) {
      error.textContent = failure.message;
      error.hidden = false;
      return;
    }
    if (!done.ok) {
      error.textContent = done.reason;
      error.hidden = false;
      return;
    }
    state.done = true;
    const note = AssistanceWindow.element("section", "", "panel");
    note.append(
      AssistanceWindow.element("h2", "Filed"),
      AssistanceWindow.element("p", `Reference ${done.reference}. It is in the coordinator's inbox.`),
      AssistanceWindow.element("p", `This window closes now. The chat on ${state.caller} shows the reference too.`),
    );
    box.replaceChildren(note);
    state.resolve({
      ok: true,
      reference: done.reference,
      summary: done.summary,
      note: "Confirmed by a person in ReliefMesh Command's own window, which has now closed. Nothing was ordered or dispatched.",
      simulated: true,
    });
  }

  static cancel(state, box) {
    if (state.done) return;
    state.done = true;
    const note = AssistanceWindow.element("section", "", "panel");
    note.append(
      AssistanceWindow.element("h2", "Not filed"),
      AssistanceWindow.element("p", `Nothing was recorded. This window closes now, and ${state.caller} carries on.`),
    );
    box.replaceChildren(note);
    state.resolve({ ok: false, reason: "The visitor declined in ReliefMesh Command's window. Nothing was filed." });
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
