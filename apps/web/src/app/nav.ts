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
} from "lucide-react";
// Order matters: position n maps to the Alt+n shortcut.
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
] as const;
export const navGroups = (["Monitor", "Tasks", "Infrastructure"] as const).map(
  (label) => ({ label, items: nav.filter((n) => n.group === label) }),
);
export type NavItem = (typeof nav)[number];
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
