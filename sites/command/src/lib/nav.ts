// The navigation, shared by the sidebar, the command palette and the keyboard shortcuts.
import { BarChart3, ClipboardCheck, ClipboardList, FlaskConical, Gauge, Network, Package, ScrollText, Settings, ShieldCheck, Siren, Store, Truck, type LucideIcon } from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Second key of the "g" chord: g then this key goes to the page. */
  key: string;
  hint: string;
}

export interface NavGroup { label: string; items: NavItem[] }

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { to: "/", label: "Command Center", icon: Gauge, end: true, key: "c", hint: "Operational overview" },
      { to: "/incidents", label: "Incidents", icon: Siren, key: "i", hint: "Every emergency being coordinated" },
      { to: "/simulator", label: "Scenario Simulator", icon: FlaskConical, key: "x", hint: "Run a predefined disaster scenario" },
      { to: "/approvals", label: "Approval Center", icon: ClipboardCheck, key: "p", hint: "Everything waiting for a person" },
    ],
  },
  {
    label: "Coordination",
    items: [
      { to: "/requests", label: "Resource Requests", icon: ClipboardList, key: "q", hint: "Shelter needs and assistance requests" },
      { to: "/allocation", label: "Allocation", icon: Package, key: "r", hint: "Demand, supply and the allocation editor" },
      { to: "/marketplace", label: "Supplier Marketplace", icon: Store, key: "m", hint: "Offers, comparison and negotiation" },
      { to: "/logistics", label: "Logistics", icon: Truck, key: "l", hint: "Shipments, vehicles and routes" },
    ],
  },
  {
    label: "Network",
    items: [
      { to: "/network", label: "Agent Network", icon: Network, key: "n", hint: "Partner networks and live interactions" },
      { to: "/trust", label: "Trust & Verification", icon: ShieldCheck, key: "t", hint: "Verification results and the consent log" },
    ],
  },
  {
    label: "Insight",
    items: [
      { to: "/analytics", label: "Analytics", icon: BarChart3, key: "a", hint: "Response metrics and impact" },
      { to: "/audit", label: "Audit Trail", icon: ScrollText, key: "u", hint: "The hash-chained log" },
    ],
  },
  {
    label: "System",
    items: [{ to: "/settings", label: "Settings", icon: Settings, key: "s", hint: "Model, partners, trust anchor, profile" }],
  },
];

export const NAV: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export function navItemFor(pathname: string): NavItem | undefined {
  if (pathname.startsWith("/incidents/")) return NAV.find((item) => item.to === "/incidents");
  if (pathname.startsWith("/report/")) return NAV.find((item) => item.to === "/incidents");
  return NAV.find((item) => (item.end ? pathname === item.to : pathname.startsWith(item.to)));
}
