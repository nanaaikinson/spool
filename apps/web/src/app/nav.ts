import {
  LayoutDashboard,
  Radio,
  ChartNoAxesCombined,
  Layers,
  ListTodo,
  Clock,
  CircleAlert,
  Server,
  CalendarClock,
  ScrollText,
  Database,
} from "lucide-react";
// Order matters: positions 1–9 map to the Alt+n shortcuts. Items marked
// serverLogs show only to accounts that may read server logs.
export const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, group: "Monitor" },
  { to: "/live", label: "Live activity", icon: Radio, group: "Monitor" },
  {
    to: "/metrics",
    label: "Metrics",
    icon: ChartNoAxesCombined,
    group: "Monitor",
  },
  { to: "/queues", label: "Queues", icon: Layers, group: "Tasks" },
  { to: "/tasks", label: "All tasks", icon: ListTodo, group: "Tasks" },
  { to: "/scheduled", label: "Scheduled", icon: Clock, group: "Tasks" },
  { to: "/failures", label: "Failed", icon: CircleAlert, group: "Tasks" },
  { to: "/workers", label: "Servers", icon: Server, group: "Infrastructure" },
  {
    to: "/schedulers",
    label: "Periodic schedules",
    icon: CalendarClock,
    group: "Infrastructure",
  },
  { to: "/redis", label: "Redis", icon: Database, group: "Infrastructure" },
  {
    to: "/logs",
    label: "Logs",
    icon: ScrollText,
    group: "Monitor",
    serverLogs: true,
  },
] as const;
export const navGroups = (["Monitor", "Tasks", "Infrastructure"] as const).map(
  (label) => ({ label, items: nav.filter((n) => n.group === label) }),
);
export type NavItem = (typeof nav)[number];
/** The Alt+n shortcut for an item, if it has one. */
export function shortcutOf(n: NavItem): number | undefined {
  const i = nav.indexOf(n) + 1;
  return i <= 9 ? i : undefined;
}
export const visibleNav = (n: NavItem, serverLogs: boolean) =>
  !("serverLogs" in n) || serverLogs;
export const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modLabel = isMac ? "⌘" : "Ctrl";
export const altLabel = isMac ? "⌥" : "Alt";
export function activeNav(pathname: string): NavItem | undefined {
  return nav.find((n) =>
    n.to === "/" ? pathname === "/" : pathname.startsWith(n.to),
  );
}
const compact = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});
export const compactNumber = (value: number) => compact.format(value);
