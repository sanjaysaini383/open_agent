// The actions TrustRegistry shares with other agent sites, through its action bridge.
// bridge/agent-manifest.json loads this module in the bridge frame, which has no registry
// page. So it opens the registry store directly: the signed documents published next to
// this site's pages, plus this origin's live state. Each read has the name and input of
// the page's own action (both build from js/action-schemas.js), so the network's
// instructions fit both.
//
// Reads run in a hidden frame on this site's origin. The one shared write, filing a
// suspicious-agent report, runs in a TrustRegistry window where a person here confirms it
// (report-window.js).
import { ReportWindow } from "./report-window.js";
import { ReadActions } from "../js/action-schemas.js";
import { RegistryStore } from "../js/registry-store.js";
import { SiteLinks } from "../js/site-links.js";

class BridgeActions {
  /**
   * The sites allowed to call these reads, as exact origins with the port. The registry's
   * records are public on its page, so "*" would be defensible for the reads; a strict
   * allowlist is the safer default for a trust service, and it is one line to change.
   */
  static CALLERS = SiteLinks.CALLERS;

  static registerActions(actions) {
    actions.register(BridgeActions.shared(ReadActions.INFO, async () => (await RegistryStore.open()).registryInfo()));
    actions.register(BridgeActions.shared(ReadActions.VERIFY_AGENT, async (args) => (await RegistryStore.open()).verifyAgent(args)));
    actions.register(BridgeActions.shared(ReadActions.VERIFY_ORGANIZATION, async (args) => (await RegistryStore.open()).verifyOrganization(args)));
    actions.register(BridgeActions.shared(ReadActions.REPUTATION, async (args) => (await RegistryStore.open()).reputationOf(args)));
    actions.register(ReportWindow.definition());
  }

  /** One of the page's reads, shared with the callers above. */
  static shared(read, execute) {
    return {
      ...read,
      effect: "read",
      availability: "bridge",
      callerOrigins: BridgeActions.CALLERS,
      execute,
    };
  }
}

// The bridge calls the module's registerActions export.
export const registerActions = BridgeActions.registerActions;
