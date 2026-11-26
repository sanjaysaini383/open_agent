// Start-up: publish the page object for the agents' tools, load the partner registry,
// boot the official runtime, and keep the assistance inbox in step with storage.
import { loadPublisherRegistry, type PartnerRegistryFile } from "@/interop/discovery";
import { allowOrigin } from "@/interop/peers";
import { loadRuntime, refreshRuntimeStatus } from "@/interop/runtime";
import { INBOX_KEY, useStore } from "@/state/store";
import { useUi } from "@/state/ui";
import { installPage } from "@/workflow/page";

export let registryFile: PartnerRegistryFile | null = null;

export function setConsoleOpen(open: boolean): void {
  document.documentElement.dataset.console = open ? "open" : "closed";
  const panel = document.getElementById("agent-console");
  if (panel) {
    // While closed the console is off-screen; inert keeps it out of the tab order too.
    if (open) panel.removeAttribute("inert"); else panel.setAttribute("inert", "");
    if (open) (panel.querySelector("#ns-input") as HTMLElement | null)?.focus();
  }
  useUi.getState().setConsoleOpen(open);
}

function setAssistantStatus(text: string): void {
  const line = document.getElementById("assistant-status");
  if (line) line.textContent = text;
}

export async function startApp(): Promise<void> {
  // The agents' tools call this object. It must exist before the runtime loads site-actions.js.
  installPage();
  document.getElementById("agent-console-close")?.addEventListener("click", () => setConsoleOpen(false));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && useUi.getState().consoleOpen && !document.querySelector("dialog[open]")) setConsoleOpen(false); });

  const store = useStore.getState();
  try {
    registryFile = await loadPublisherRegistry();
    store.syncPeers([...registryFile.partners, ...store.settings.extraPartners]);
  } catch (error) {
    console.error("Partner registry could not be loaded", error);
    useUi.getState().notify("The partner registry (partners.json) could not be loaded. Partner features are unavailable.", "error");
  }

  // A request filed in this site's own confirmation window lands in storage.
  store.syncInbox();
  window.addEventListener("storage", (event) => { if (event.key === INBOX_KEY || event.key === null) useStore.getState().syncInbox(); });
  window.setInterval(() => useStore.getState().syncInbox(), 5000);

  try {
    const runtime = await loadRuntime();
    // Origins a person registered earlier are allowed again for this page view.
    for (const partner of useStore.getState().settings.extraPartners) await allowOrigin(partner.networkUrl);
    const status = useUi.getState().runtime;
    setAssistantStatus(status.state === "ready" && status.hasKey
      ? "Agents are connected to this dashboard."
      : "Agents need your AI provider key. Add it in AI model settings below. The coordination workflow works without one.");
    // The settings panel can change the key or model at any time.
    window.setInterval(() => refreshRuntimeStatus(runtime), 4000);
  } catch (error) {
    console.error("Agent runtime failed to start", error);
    setAssistantStatus("The agent runtime could not load. The dashboard still works, but partner calls and the agent console are unavailable.");
  }
}
