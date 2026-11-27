import { useMemo } from "react";
import { useStore } from "@/state/store";
import { useUi } from "@/state/ui";
import { deriveAlerts, type Alert } from "./alerts";

/** Alerts derived from the current state, without the ones this session dismissed. */
export function useAlerts(): Alert[] {
  const state = useStore();
  const dismissed = useUi((ui) => ui.dismissedAlerts);
  return useMemo(() => deriveAlerts(state).filter((alert) => !dismissed.includes(alert.id)), [state, dismissed]);
}
