// Volatile UI state: the dialogs that put a person in the loop, and the session's raw
// runtime trace. None of this is persisted. In particular, an "always allow" consent
// lives only in the runtime engine for this page view, as the specification requires.
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

interface UiState {
  runtime: RuntimeStatus;
  consoleOpen: boolean;
  consent: ConsentRequest | null;
  review: ActionReview | null;
  windowPrompt: WindowPrompt | null;
  override: OverrideRequest | null;
  trace: TraceLine[];
  busyIncident: string | null;
  toast: { text: string; tone: "ok" | "warn" | "error" } | null;
  setRuntime(status: RuntimeStatus): void;
  setConsoleOpen(open: boolean): void;
  setConsent(request: ConsentRequest | null): void;
  setReview(review: ActionReview | null): void;
  setWindowPrompt(prompt: WindowPrompt | null): void;
  setOverride(request: OverrideRequest | null): void;
  pushTrace(line: TraceLine): void;
  setBusy(incidentId: string | null): void;
  notify(text: string, tone?: "ok" | "warn" | "error"): void;
  clearToast(): void;
}

export const useUi = create<UiState>((set) => ({
  runtime: { state: "loading" },
  consoleOpen: false,
  consent: null,
  review: null,
  windowPrompt: null,
  override: null,
  trace: [],
  busyIncident: null,
  toast: null,
  setRuntime: (runtime) => set({ runtime }),
  setConsoleOpen: (consoleOpen) => set({ consoleOpen }),
  setConsent: (consent) => set({ consent }),
  setReview: (review) => set({ review }),
  setWindowPrompt: (windowPrompt) => set({ windowPrompt }),
  setOverride: (override) => set({ override }),
  pushTrace: (line) => set((state) => ({ trace: [...state.trace, line].slice(-1500) })),
  setBusy: (busyIncident) => set({ busyIncident }),
  notify: (text, tone = "ok") => set({ toast: { text, tone } }),
  clearToast: () => set({ toast: null }),
}));
