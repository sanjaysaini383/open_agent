// Loads the official Open Agentic Web browser runtime and connects it to the dashboard.
//
// The runtime in public/runtime/ is the unmodified copy from the official repository.
// It is loaded with a native dynamic import at run time, so the bundler never touches
// it. Everything ReliefMesh adds is done through the hooks the runtime itself offers:
//
//   engine.onConsent          -> the dashboard's consent dialog (origin and purpose shown)
//   engine.onActionConfirm    -> the dashboard's confirmation and plan-approval dialogs
//   setActionWindowPrompt     -> the dashboard's "open the partner's window" dialog
//   trace "event"             -> the live activity and network views
//
// The same engine instance serves the chat (model-driven agents) and the workflow
// (direct calls to partners' shared actions), so both go through one consent gate, one
// allowed_peers policy and one action registry.
import { redactSecrets } from "@/domain/sanitize";
import { uid, useStore } from "@/state/store";
import type { AgentActivity, NetworkInteraction, TraceLine } from "@/state/types";
import { useUi } from "@/state/ui";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Runtime {
  engine: any;
  trace: any;
  base: string;
  transport: any;
}

let booting: Promise<Runtime> | null = null;

/** The folder that holds agent-manifest.json. Works at a domain root and under a subpath. */
export function siteBase(): string {
  return new URL("./", document.baseURI).href.replace(/\/$/, "");
}

export function loadRuntime(): Promise<Runtime> {
  if (!booting) booting = boot();
  return booting;
}

async function boot(): Promise<Runtime> {
  const ui = useUi.getState();
  const base = siteBase();
  try {
    const mod = await import(/* @vite-ignore */ `${base}/runtime/index.js`);
    const booted = await mod.boot("#agent-app", { originUrl: base, sandboxWorkerUrl: `${base}/runtime/sandbox-worker.js` });
    const transport = await import(/* @vite-ignore */ `${base}/runtime/action-transport.js`);
    const { engine, trace } = booted;

    engine.onConsent = consentHook;
    engine.onActionConfirm = reviewHook;
    transport.setActionWindowPrompt(windowPromptHook);
    trace.addEventListener("event", (event: CustomEvent) => onTrace(event.detail));

    const runtime = { engine, trace, base, transport };
    refreshRuntimeStatus(runtime);
    return runtime;
  } catch (error) {
    booting = null;
    ui.setRuntime({ state: "failed", error: (error as Error).message || String(error) });
    throw error;
  }
}

export function refreshRuntimeStatus(runtime: Runtime): void {
  const { engine } = runtime;
  const network = engine.top?.network;
  const hasKey = !!engine.mockLLM || !!engine.publisherFundedLLM || (!!engine.byokKey && engine.byokKey !== "demo");
  useUi.getState().setRuntime({
    state: "ready",
    hasKey,
    model: String(engine.modelOverride || engine.callerModel?.() || ""),
    // Only the router's address is shown. The key itself is never read into app state.
    router: String(engine.userRouter?.baseUrl || engine.top?.manifest?.llm_router?.base_url || ""),
    network: String(network?.name || ""),
    agents: Array.isArray(network?.config?.tools) ? network.config.tools.length : 0,
    actions: engine.actions?.catalog?.({ base: engine.top?.base, network: network?.name })?.length ?? 0,
  });
}

// ---- consent ---------------------------------------------------------------------

export interface ConsentDetail {
  agent: string;
  calls: string[];
  dataShared: string;
}

function consentHook(info: any): Promise<"allow" | "always" | "decline"> {
  return new Promise((resolve) => {
    const detail: ConsentDetail | undefined = info.reliefmesh;
    const estimate = info.est?.costText || (info.est?.totalTokens ? `~${info.est.totalTokens} tokens` : "");
    const label = String(info.peerLabel || info.peerOrigin || "another site");
    const origin = String(info.peerOrigin || "");
    const purpose = String(info.requestText || "");
    useUi.getState().setConsent({
      id: uid("consent"),
      kind: String(info.kind || "network"),
      peerLabel: label,
      peerOrigin: origin,
      purpose,
      dataShared: detail?.dataShared,
      calls: detail?.calls,
      agent: detail?.agent,
      viaModel: !detail,
      estimate,
      resolve: (decision) => {
        useUi.getState().setConsent(null);
        const store = useStore.getState();
        store.addConsent({ at: new Date().toISOString(), origin, label, purpose, decision, kind: String(info.kind || "network") });
        void store.record({
          kind: "consent",
          actor: "human:coordinator",
          incidentId: store.activeIncidentId,
          summary: `${decision === "decline" ? "Declined" : decision === "always" ? "Allowed for this session" : "Allowed once"}: contact ${label} (${origin})`,
          data: { origin, purpose, decision, agent: detail?.agent ?? "model-driven agent", calls: detail?.calls ?? [], dataShared: detail?.dataShared ?? "the request text shown" },
        });
        if (decision === "decline") {
          store.addInteraction({ id: uid("ix"), at: new Date().toISOString(), from: "command", to: peerIdForHost(origin), kind: "consent", label: "Consent declined", status: "declined", detail: purpose });
        }
        resolve(decision);
      },
    });
  });
}

// ---- confirmation of this site's own irreversible actions ---------------------------

function reviewHook(items: any[]): Promise<boolean> {
  return new Promise((resolve) => {
    useUi.getState().setReview({
      id: uid("review"),
      items: items.map((item) => ({
        action: String(item.action),
        description: String(item.description || ""),
        origin: String(item.origin),
        effect: String(item.effect),
        arguments: item.arguments,
      })),
      resolve: (confirmed) => {
        useUi.getState().setReview(null);
        resolve(confirmed);
      },
    });
  });
}

// ---- a partner's write opens the partner's own window ------------------------------

function windowPromptHook({ url, origin, brand, signal }: { url: string; origin: string; brand?: string; signal?: AbortSignal }): Promise<Window> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("Action was cancelled.")); return; }
    const host = new URL(origin).host;
    const peer = Object.values(useStore.getState().peers).find((item) => new URL(item.networkUrl).host === host);
    const close = () => { useUi.getState().setWindowPrompt(null); signal?.removeEventListener("abort", abort); };
    const abort = () => { close(); reject(new Error("Action window cancelled; action not started.")); };
    signal?.addEventListener("abort", abort, { once: true });
    useUi.getState().setWindowPrompt({
      id: uid("window"),
      url,
      origin,
      label: peer?.label || brand || host,
      resolve: (popup) => { close(); resolve(popup); },
      reject: (error) => { close(); reject(error); },
    });
  });
}

// ---- runtime trace -> live views ----------------------------------------------------

const llmSpans = new Map<string, string>();
const fetchSpans = new Map<string, string>();

export function peerIdForHost(host: string): string {
  const peers = Object.values(useStore.getState().peers);
  const match = peers.find((peer) => { try { return new URL(peer.networkUrl).host === host; } catch { return false; } });
  return match?.id || host || "unknown";
}

function describe(event: any): string {
  if (event.kind === "agent") return `${event.agent} (${event.network})`;
  if (event.kind === "tool") return `${event.tool} [${event.toolKind}]`;
  if (event.kind === "remote_fetch" || event.kind === "remote_call") return `${event.peerOrigin}${event.network ? ` / ${event.network}` : ""}`;
  if (event.kind === "llm" || event.kind === "model") return `${event.model || "model call"}`;
  if (event.kind === "consent") return `${event.peerOrigin}: ${event.decision}`;
  if (event.kind === "compile") return `${event.what || "network"} ${event.network || ""}`;
  return String(event.agent || event.tool || event.url || event.reason || event.kind);
}

function onTrace(event: any): void {
  const line: TraceLine = {
    t: new Date(event.wall || Date.now()).toISOString(),
    kind: String(event.kind),
    phase: String(event.phase),
    label: redactSecrets(describe(event)).slice(0, 160),
    status: event.status ? String(event.status) : undefined,
    detail: event.error ? redactSecrets(String(event.error)).slice(0, 300) : event.resultPreview ? redactSecrets(String(event.resultPreview)).slice(0, 200) : undefined,
  };
  useUi.getState().pushTrace(line);
  const store = useStore.getState();

  // A model-driven agent run becomes an activity entry, marked as such.
  if (event.kind === "agent") {
    if (event.phase === "start") {
      const id = uid("act");
      llmSpans.set(event.id, id);
      const activity: AgentActivity = {
        id, at: line.t, incidentId: store.activeIncidentId, agent: String(event.agent),
        task: event.isTopFrontMan ? "Answer the coordinator in the agent console" : "Delegated task",
        input: "(model-driven run; see the trace)", output: "", status: "running",
        networks: event.network && event.network !== "reliefmesh_command" ? [String(event.network)] : [],
        requiresApproval: false, mode: "llm", trace: [line],
      };
      store.addActivity(activity);
    } else if (event.phase === "end") {
      const id = llmSpans.get(event.id);
      if (id) {
        store.patchActivity(id, {
          status: event.status === "error" ? "failed" : "done",
          output: event.status === "error" ? String(event.error || "failed") : `Answered (${event.answerChars ?? 0} characters).`,
          durationMs: Math.round(event.durationMs || 0),
        });
        llmSpans.delete(event.id);
      }
    }
  }

  // Every fetch of a partner's public files, whoever asked for it.
  if (event.kind === "remote_fetch") {
    if (event.phase === "start") {
      const id = uid("ix");
      fetchSpans.set(event.id, id);
      const interaction: NetworkInteraction = { id, at: line.t, from: "command", to: peerIdForHost(String(event.peerOrigin)), kind: "discover", label: "Load manifest and network definition", status: "pending" };
      store.addInteraction(interaction);
    } else if (event.phase === "end") {
      const id = fetchSpans.get(event.id);
      if (id) {
        store.patchInteraction(id, { status: event.status === "error" ? "failed" : "ok", durationMs: Math.round(event.durationMs || 0), detail: event.error ? String(event.error) : undefined });
        fetchSpans.delete(event.id);
      }
    }
  }

  // A partner network run by a model in this browser.
  if (event.kind === "remote_call") {
    if (event.phase === "start") {
      const id = uid("ix");
      fetchSpans.set(event.id, id);
      store.addInteraction({ id, at: line.t, from: "command", to: peerIdForHost(String(event.peerOrigin)), kind: "llm", label: `Run ${event.network} with the visitor's model`, status: "pending" });
    } else if (event.phase === "end") {
      const id = fetchSpans.get(event.id);
      if (id) {
        store.patchInteraction(id, { status: event.status === "error" ? "failed" : "ok", durationMs: Math.round(event.durationMs || 0) });
        fetchSpans.delete(event.id);
      }
    }
  }
}
