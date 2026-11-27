// Volatile UI state: the dialogs that put a person in the loop, the session's raw
// runtime trace, toasts, the command palette and the open side panels. None of this is
// persisted. In particular, an "always allow" consent lives only in the runtime engine
// for this page view, as the specification requires.
import { create } from "zustand";
import type { TraceLine } from "./types";

export interface ConsentRequest {
  id: string;
  kind: string;
  peerLabel: string;
  /** Host of the destination, as the runtime reports it. */
  peerOrigin: string;
  purpose: string;
  /** What will be sent, in plain words. */
  dataShared?: string;
  /** Calls this consent covers. */
  calls?: string[];
  agent?: string;
  viaModel: boolean;
  estimate?: string;
  resolve: (decision: "allow" | "always" | "decline") => void;
}

export interface ActionReview {
  id: string;
  items: { action: string; description: string; origin: string; effect: string; arguments: unknown }[];
  resolve: (confirmed: boolean) => void;
}

export interface WindowPrompt {
  id: string;
  url: string;
  origin: string;
  label: string;
  resolve: (popup: Window) => void;
  reject: (error: Error) => void;
}

export interface OverrideRequest {
  id: string;
  subject: string;
  kind: "partner" | "organization";
  reason: string;
  consequences: string;
  resolve: (allowed: boolean) => void;
}

export type RuntimeStatus =
  | { state: "loading" }
  | { state: "ready"; hasKey: boolean; model: string; router: string; network: string; agents: number; actions: number }
  | { state: "failed"; error: string };

export type ToastTone = "ok" | "warn" | "error" | "info";
export interface ToastItem { id: number; text: string; tone: ToastTone; at: number }

interface UiState {
  runtime: RuntimeStatus;
  consoleOpen: boolean;
  consent: ConsentRequest | null;
  review: ActionReview | null;
  windowPrompt: WindowPrompt | null;
  override: OverrideRequest | null;
  trace: TraceLine[];
  busyIncident: string | null;
  toasts: ToastItem[];
  paletteOpen: boolean;
  alertsOpen: boolean;
  shortcutsOpen: boolean;
  /** Agent whose details panel is open, or null. */
  inspectAgent: string | null;
  dismissedAlerts: string[];
  /** The scenario simulator asked the workflow to stop before its next step. */
  simulationPaused: boolean;
  setRuntime(status: RuntimeStatus): void;
  setConsoleOpen(open: boolean): void;
  setConsent(request: ConsentRequest | null): void;
  setReview(review: ActionReview | null): void;
  setWindowPrompt(prompt: WindowPrompt | null): void;
  setOverride(request: OverrideRequest | null): void;
  pushTrace(line: TraceLine): void;
  setBusy(incidentId: string | null): void;
  notify(text: string, tone?: ToastTone): void;
  dismissToast(id: number): void;
  clearToast(): void;
  setPaletteOpen(open: boolean): void;
  setAlertsOpen(open: boolean): void;
  setShortcutsOpen(open: boolean): void;
  setInspectAgent(agent: string | null): void;
  dismissAlert(id: string): void;
  restoreAlerts(): void;
  setSimulationPaused(paused: boolean): void;
}

let toastSeq = 0;

export const useUi = create<UiState>((set) => ({
  runtime: { state: "loading" },
  consoleOpen: false,
  consent: null,
  review: null,
  windowPrompt: null,
  override: null,
  trace: [],
  busyIncident: null,
  toasts: [],
  paletteOpen: false,
  alertsOpen: false,
  shortcutsOpen: false,
  inspectAgent: null,
  dismissedAlerts: [],
  simulationPaused: false,
  setRuntime: (runtime) => set({ runtime }),
  setConsoleOpen: (consoleOpen) => set({ consoleOpen }),
  setConsent: (consent) => set({ consent }),
  setReview: (review) => set({ review }),
  setWindowPrompt: (windowPrompt) => set({ windowPrompt }),
  setOverride: (override) => set({ override }),
  pushTrace: (line) => set((state) => ({ trace: [...state.trace, line].slice(-1500) })),
  setBusy: (busyIncident) => set({ busyIncident }),
  notify: (text, tone = "ok") => set((state) => ({ toasts: [...state.toasts, { id: ++toastSeq, text, tone, at: Date.now() }].slice(-4) })),
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
  clearToast: () => set({ toasts: [] }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setAlertsOpen: (alertsOpen) => set({ alertsOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setInspectAgent: (inspectAgent) => set({ inspectAgent }),
  dismissAlert: (id) => set((state) => ({ dismissedAlerts: [...new Set([...state.dismissedAlerts, id])] })),
  restoreAlerts: () => set({ dismissedAlerts: [] }),
  setSimulationPaused: (simulationPaused) => set({ simulationPaused }),
}));
