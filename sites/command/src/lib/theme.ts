// Interface preferences that belong to this browser, not to the demonstration data:
// colour theme (warm cream by default; charcoal-teal available), sidebar mode and the coordinator's
// display name. Kept apart from the persisted dashboard state so Reset demo never
// touches them.
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "dark" | "light";
export const PREFS_KEY = "reliefmesh-ui-prefs";

interface Prefs {
  theme: Theme;
  sidebarCollapsed: boolean;
  displayName: string;
  shortcutsSeen: boolean;
  setTheme(theme: Theme): void;
  toggleTheme(): void;
  setSidebarCollapsed(collapsed: boolean): void;
  setDisplayName(name: string): void;
  setShortcutsSeen(seen: boolean): void;
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export const usePrefs = create<Prefs>()(
  persist(
    (set, get) => ({
      theme: "light",
      sidebarCollapsed: false,
      displayName: "Coordinator",
      shortcutsSeen: false,
      setTheme: (theme) => { applyTheme(theme); set({ theme }); },
      toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setDisplayName: (displayName) => set({ displayName: displayName.trim().slice(0, 40) || "Coordinator" }),
      setShortcutsSeen: (shortcutsSeen) => set({ shortcutsSeen }),
    }),
    {
      name: PREFS_KEY,
      partialize: (state) => ({ theme: state.theme, sidebarCollapsed: state.sidebarCollapsed, displayName: state.displayName, shortcutsSeen: state.shortcutsSeen }),
      onRehydrateStorage: () => (state) => { if (state) applyTheme(state.theme); },
    },
  ),
);

/** Apply the stored theme before the first paint. index.html does the same inline, so there is no flash. */
export function initTheme(): void {
  applyTheme(usePrefs.getState().theme);
}

export function useTheme(): Theme {
  return usePrefs((state) => state.theme);
}

/** Colours for charts and SVG, read from the theme so they follow dark and light mode. */
export interface Palette {
  accent: string; accent2: string; ok: string; high: string; critical: string; muted: string; faint: string; ink: string; grid: string; surface: string; line: string;
}

export function palette(theme: Theme): Palette {
  return theme === "dark"
    ? { accent: "#6fdccf", accent2: "#ffcb9a", ok: "#7fcfa6", high: "#d9b08c", critical: "#e3796a", muted: "#93aba5", faint: "#65807a", ink: "#e7f2ef", grid: "#2b3733", surface: "#2c3531", line: "#43524d" }
    : { accent: "#e85a4f", accent2: "#d8c3a5", ok: "#5f8f5a", high: "#c07d3a", critical: "#c8382d", muted: "#8e8d8a", faint: "#b3b0aa", ink: "#2b2927", grid: "#e0d9c8", surface: "#f6f3eb", line: "#c9b797" };
}

export function usePalette(): Palette {
  return palette(useTheme());
}
