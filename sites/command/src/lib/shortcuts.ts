// Keyboard shortcuts. Single keys are ignored while typing in a field or while a dialog
// is open, so they never interfere with a form or a consent decision.
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { setConsoleOpen } from "./boot";
import { NAV } from "./nav";
import { usePrefs } from "./theme";
import { useUi } from "@/state/ui";

export const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["Ctrl", "K"], label: "Open the command palette" },
  { keys: ["?"], label: "Show keyboard shortcuts" },
  { keys: ["g", "c"], label: "Go to the Command Center" },
  { keys: ["g", "i"], label: "Go to Incidents" },
  { keys: ["g", "p"], label: "Go to the Approval Center" },
  { keys: ["g", "n"], label: "Go to the Agent Network" },
  { keys: ["g", "m"], label: "Go to the Supplier Marketplace" },
  { keys: ["g", "l"], label: "Go to Logistics" },
  { keys: ["g", "t"], label: "Go to Trust & Verification" },
  { keys: ["g", "a"], label: "Go to Analytics" },
  { keys: ["g", "u"], label: "Go to the Audit Trail" },
  { keys: ["g", "s"], label: "Go to Settings" },
  { keys: ["["], label: "Collapse or expand the sidebar" },
  { keys: ["Shift", "T"], label: "Switch between dark and light theme" },
  { keys: ["Shift", "A"], label: "Open or close the agent console" },
  { keys: ["Shift", "N"], label: "Open the alert centre" },
  { keys: ["Esc"], label: "Close the open panel or dialog" },
];

function typing(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable || !!element.closest("#agent-console");
}

export function useGlobalShortcuts(): void {
  const navigate = useNavigate();
  useEffect(() => {
    let chord: string | null = null;
    let chordTimer = 0;
    const onKey = (event: KeyboardEvent) => {
      const ui = useUi.getState();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        ui.setPaletteOpen(!ui.paletteOpen);
        return;
      }
      if (event.key === "Escape") {
        if (ui.paletteOpen) { ui.setPaletteOpen(false); return; }
        if (ui.shortcutsOpen) { ui.setShortcutsOpen(false); return; }
        return;
      }
      if (typing(event.target) || document.querySelector("dialog[open]") || ui.paletteOpen || event.ctrlKey || event.metaKey || event.altKey) return;

      if (chord === "g") {
        chord = null;
        window.clearTimeout(chordTimer);
        const item = NAV.find((entry) => entry.key === event.key.toLowerCase());
        if (item) { event.preventDefault(); navigate(item.to); }
        return;
      }
      if (event.key === "g") { chord = "g"; chordTimer = window.setTimeout(() => { chord = null; }, 1200); return; }
      if (event.key === "?") { event.preventDefault(); ui.setShortcutsOpen(true); return; }
      if (event.key === "[") { event.preventDefault(); usePrefs.getState().setSidebarCollapsed(!usePrefs.getState().sidebarCollapsed); return; }
      if (event.key === "T" && event.shiftKey) { event.preventDefault(); usePrefs.getState().toggleTheme(); return; }
      if (event.key === "A" && event.shiftKey) { event.preventDefault(); setConsoleOpen(!ui.consoleOpen); return; }
      if (event.key === "N" && event.shiftKey) { event.preventDefault(); ui.setAlertsOpen(!ui.alertsOpen); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navigate]);
}
