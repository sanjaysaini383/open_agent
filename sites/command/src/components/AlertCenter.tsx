// The alert centre: derived alerts, grouped by severity, each leading to the page where
// it can be acted on. Dismissing hides an alert for this session only; the condition
// behind it is unchanged, and "Show dismissed" brings it back.
import { useNavigate } from "react-router-dom";
import { AlertOctagon, AlertTriangle, BellOff, Info, X } from "lucide-react";
import type { Alert } from "@/lib/alerts";
import { useAlerts } from "@/lib/useAlerts";
import { useUi } from "@/state/ui";
import { AnimatePresence, motion, useMotionOff } from "./motion";
import { Badge, Button, Drawer, Empty, IconButton, cx, relative } from "./ui";

const ICON = { critical: AlertOctagon, warning: AlertTriangle, info: Info } as const;
const EDGE = { critical: "border-l-critical", warning: "border-l-high", info: "border-l-info" } as const;
const COLOR = { critical: "text-critical", warning: "text-high", info: "text-info" } as const;
const CATEGORY_LABEL: Record<Alert["category"], string> = { shortage: "Shortage", delivery: "Delivery", trust: "Trust", network: "Network", approval: "Approval", request: "Request", workflow: "Workflow", security: "Security" };

export function AlertRow({ alert, onOpen, compact = false }: { alert: Alert; onOpen: () => void; compact?: boolean }) {
  const dismiss = useUi((state) => state.dismissAlert);
  const off = useMotionOff();
  const Icon = ICON[alert.severity];
  return (
    <motion.li
      layout={!off}
      initial={off ? false : { opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={off ? undefined : { opacity: 0, x: 16, height: 0, marginBottom: 0, transition: { duration: 0.16 } }}
      className={cx("flex items-start gap-2.5 rounded-lg border border-line border-l-[3px] bg-surface-2 p-2.5", EDGE[alert.severity])}
    >
      <Icon size={15} className={cx("mt-0.5 shrink-0", COLOR[alert.severity])} aria-label={alert.severity} />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-semibold text-ink">{alert.title}</span>
          <Badge tone="neutral">{CATEGORY_LABEL[alert.category]}</Badge>
          {alert.incidentId && !compact && <span className="font-mono text-[11px] text-faint">{alert.incidentId}</span>}
        </div>
        {alert.detail && <p className={cx("mt-0.5 text-[12.5px] text-muted", compact && "line-clamp-2")}>{alert.detail}</p>}
        {alert.at && <p className="mt-0.5 text-[11.5px] text-faint">{relative(alert.at)}</p>}
      </button>
      <IconButton label={`Dismiss alert: ${alert.title}`} size={26} onClick={() => dismiss(alert.id)}><X size={13} /></IconButton>
    </motion.li>
  );
}

export function AlertList({ limit, compact }: { limit?: number; compact?: boolean }) {
  const alerts = useAlerts();
  const dismissed = useUi((state) => state.dismissedAlerts.length);
  const restore = useUi((state) => state.restoreAlerts);
  const navigate = useNavigate();
  const close = useUi((state) => state.setAlertsOpen);
  const shown = limit ? alerts.slice(0, limit) : alerts;
  return (
    <div>
      {shown.length ? (
        <ul className="grid gap-2">
          <AnimatePresence initial={false}>
            {shown.map((alert) => <AlertRow key={alert.id} alert={alert} compact={compact} onOpen={() => { close(false); navigate(alert.to); }} />)}
          </AnimatePresence>
        </ul>
      ) : <Empty icon={<BellOff size={18} />} title="No open alerts">{dismissed ? "Everything that remains was dismissed for this session." : "Shortages, late deliveries, unverified partners, failed requests and pending approvals appear here as soon as the state shows them."}</Empty>}
      {(dismissed > 0 || (limit && alerts.length > limit)) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
          {limit && alerts.length > limit && <Button size="sm" variant="ghost" onClick={() => close(true)}>All {alerts.length} alerts</Button>}
          {dismissed > 0 && <Button size="sm" variant="ghost" onClick={restore}>Show {dismissed} dismissed</Button>}
        </div>
      )}
    </div>
  );
}

export function AlertDrawer() {
  const open = useUi((state) => state.alertsOpen);
  const close = useUi((state) => state.setAlertsOpen);
  const alerts = useAlerts();
  const critical = alerts.filter((alert) => alert.severity === "critical").length;
  const warnings = alerts.filter((alert) => alert.severity === "warning").length;
  return (
    <Drawer open={open} onClose={() => close(false)} title="Alert centre" subtitle={<span className="flex flex-wrap gap-1.5">{critical > 0 && <Badge tone="critical">{critical} critical</Badge>}{warnings > 0 && <Badge tone="warn">{warnings} warning{warnings === 1 ? "" : "s"}</Badge>}<span>Derived from the current state; nothing here is a demo event.</span></span>} width={480}>
      <AlertList />
    </Drawer>
  );
}
