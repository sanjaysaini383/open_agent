// Mounts the assistant inside the TrustRegistry page (from the official template,
// templates/site.js). Loaded with <script type="module" src="site.js"></script>.
import { App } from "./js/app.js";
import { RegistryData } from "./js/registry-data.js";

/**
 * Boots the browser runtime in the page's assistant section.
 *
 * It points the runtime at this folder, so the manifest, network and actions load from
 * the same place as the page. Before each irreversible action, it shows its own
 * confirmation dialog, written for the visitor.
 */
export class AssistantMount {
  static GREETING = "I can look up agent networks and organisations in this registry: status, credentials, reputation and open reports. I can also suspend, revoke or register a subject for you. The registry's authority and records are simulated; its signatures are real.";

  /** The confirmation dialog's words for each irreversible action. */
  static DIALOGS = {
    set_subject_status: {
      title: "Change this subject's status?",
      sentence: "The registry's live status of the subject below changes at once. Partner agent sites act on it the next time they look the subject up.",
      confirm: "Change the status",
      decline: "Leave it as it is",
    },
    register_subject: {
      title: "Register this subject?",
      sentence: "The subject below is added to the registry as pending, with no signed attestation. This page has no delete.",
      confirm: "Register as pending",
      decline: "Don't register",
    },
  };

  static async start() {
    const status = document.querySelector("#assistant-status");
    const siteBase = new URL("./", import.meta.url).href;
    try {
      // Load the runtime here, so a missing or broken runtime is reported too.
      const { boot } = await import("./runtime/index.js");
      const booted = await boot("#agent-app", {
        originUrl: siteBase,
        sandboxWorkerUrl: new URL("runtime/sandbox-worker.js", siteBase).href,
      });
      AssistantMount.engine = booted.engine;
      AssistantMount.defaultReview = booted.engine.onActionConfirm;
      booted.engine.onActionConfirm = AssistantMount.review;
      AssistantMount.defaultConsent = booted.engine.onConsent;
      booted.engine.onConsent = AssistantMount.consent;
      // Without a key the chat cannot answer yet. Same test as the runtime's badge.
      const needsKey = !booted.engine.mockLLM
        && !booted.engine.publisherFundedLLM
        && (!booted.engine.byokKey || booted.engine.byokKey === "demo");
      status.textContent = needsKey
        ? "Assistant needs your AI provider key. Add it in AI model settings below."
        : "Assistant connected to this page.";
      if (!needsKey) AssistantMount.greet();
      return booted.engine;
    } catch (error) {
      // The page must keep working without the assistant.
      status.textContent = "The assistant could not load. You can still use the page directly.";
      console.error("Assistant startup failed", error);
      return null;
    }
  }

  static greet() {
    const first = document.querySelector("#ns-msgs .ns-msg.bot");
    if (first) first.textContent = AssistantMount.GREETING;
  }

  /**
   * Ask the visitor to confirm actions before they run. One of this page's actions listed
   * in DIALOGS gets this page's dialog. Anything else gets the runtime's own dialog.
   */
  static async review(items) {
    let confirmed = false;
    const pageOrigin = new URL(document.URL).origin;
    if (items.length > 1) {
      for (const item of items) {
        if (item.origin === pageOrigin && Object.hasOwn(AssistantMount.DIALOGS, item.action)) {
          throw new Error(`Nothing ran. "${AssistantMount.DIALOGS[item.action].confirm}" needs its own confirmation, so ask the assistant to do that on its own.`);
        }
      }
    }
    const own = items.length === 1 && items[0].origin === pageOrigin;
    if (own && Object.hasOwn(AssistantMount.DIALOGS, items[0].action)) {
      const content = AssistantMount.dialogContent(items[0]);
      if (content.refusal) throw new Error(content.refusal);
      confirmed = await new Promise(AssistantMount.openDialog.bind(null, content));
    } else {
      confirmed = await AssistantMount.defaultReview(items);
    }
    AssistantMount.keepFocusInChat();
    return confirmed;
  }

  /** Ask the visitor, with the runtime's consent card, whether to contact another site. */
  static async consent(info) {
    const answer = AssistantMount.defaultConsent(info);
    AssistantMount.focusConsentCard();
    const decision = await answer;
    AssistantMount.keepFocusInChat();
    return decision;
  }

  static focusConsentCard() {
    const cards = document.querySelectorAll("#ns-msgs .ns-consent");
    const card = cards[cards.length - 1];
    const title = card ? card.querySelector(".ns-consent-title") : null;
    if (!title) return;
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", title.textContent);
    const active = document.activeElement;
    if (active && active !== document.body && !active.closest("#agent-app")) return;
    title.tabIndex = -1;
    title.focus();
  }

  static dialogContent(item) {
    let details = {};
    try {
      details = AssistantMount.reviewDetails(item.action, item.arguments) || {};
    } catch (error) {
      console.error("Could not add details to the confirmation dialog", error);
    }
    return {
      ...AssistantMount.DIALOGS[item.action],
      details,
      refusal: details.refusal,
      exact: `${item.action} on ${item.origin} (${item.effect})\n${JSON.stringify(item.arguments, null, 2)}`,
    };
  }

  /** Readable details from the page's own read-only checks, so no rule is copied here. */
  static reviewDetails(action, args) {
    if (action === "set_subject_status") {
      const check = App.page.checkStatusChange(args);
      if (!check.ok) return { refusal: check.reason };
      return {
        "Subject": `${check.subject.name} (${check.subject.subjectId})`,
        "Status now": check.subject.status,
        "New status": args.status,
        "Signed attestation says": check.subject.attestedStatus || "no attestation",
        "Reason": check.reason,
      };
    }
    if (action === "register_subject") {
      const check = App.page.checkRegistration(args);
      if (!check.ok) return { refusal: check.reason };
      const details = {
        "Kind": check.kind === "agent_network" ? "Agent network" : "Organisation",
        "Name": check.name,
        "Subject id": check.subjectId,
      };
      if (check.kind === "agent_network") {
        details["Network URL"] = check.networkUrl;
        if (check.operator) details["Operator"] = check.operator;
      } else {
        details["Organisation type"] = check.organizationType;
      }
      details["Status"] = `pending (${RegistryData.REGISTRY_NAME} has not signed it)`;
      return details;
    }
    return {};
  }

  static openDialog(content, resolve) {
    const dialog = document.createElement("dialog");
    dialog.className = "assistant-review";
    dialog.setAttribute("aria-labelledby", "assistant-review-title");
    const heading = document.createElement("h2");
    heading.id = "assistant-review-title";
    heading.textContent = content.title;
    heading.tabIndex = -1;
    heading.autofocus = true;
    const sentence = document.createElement("p");
    sentence.textContent = content.sentence;
    dialog.append(heading, sentence);
    const exact = document.createElement("details");
    const exactLabel = document.createElement("summary");
    exactLabel.textContent = "Technical details";
    const exactText = document.createElement("pre");
    exactText.textContent = content.exact;
    exact.append(exactLabel, exactText);
    const entries = Object.entries(content.details);
    if (entries.length) {
      const list = document.createElement("dl");
      for (const [label, value] of entries) {
        const term = document.createElement("dt");
        term.textContent = label;
        const description = document.createElement("dd");
        description.textContent = String(value);
        list.append(term, description);
      }
      dialog.append(list);
    } else {
      exact.open = true;
    }
    const confirmButton = document.createElement("button");
    confirmButton.textContent = content.confirm;
    confirmButton.addEventListener("click", dialog.close.bind(dialog, "confirm"));
    const declineButton = document.createElement("button");
    declineButton.className = "assistant-decline";
    declineButton.textContent = content.decline;
    declineButton.addEventListener("click", dialog.close.bind(dialog, "decline"));
    dialog.addEventListener("close", AssistantMount.finishDialog.bind(null, dialog, resolve));
    dialog.append(exact, confirmButton, declineButton);
    document.body.append(dialog);
    dialog.showModal();
  }

  static finishDialog(dialog, resolve) {
    dialog.remove();
    resolve(dialog.returnValue === "confirm");
  }

  static keepFocusInChat() {
    if (document.activeElement === document.body || document.activeElement === null) {
      document.querySelector("#ns-input")?.focus();
    }
  }
}

// Boot only in a browser. Node tests import this file to check the dialog's words.
if (typeof window !== "undefined") {
  await AssistantMount.start();
}
