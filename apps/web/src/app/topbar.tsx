import { Fragment, type ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { Moon, Search, Sun } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTheme } from "./theme";
import { activeNav, modLabel } from "./nav";
type Crumb = { label: ReactNode; link?: ReactNode };
const decode = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};
function useCrumbs(): Crumb[] {
  const { pathname } = useLocation();
  const [, section, ...rest] = pathname.split("/").map(decode);
  const active = activeNav(pathname);
  if (section === "settings") return [{ label: "Settings & audit" }];
  if (!active) return [{ label: "Not found" }];
  const root = (
    <Link to={active.to}>
      <active.icon size={14} />
      {active.label}
    </Link>
  );
  if (section === "queues" && rest[0])
    return [
      { label: active.label, link: root },
      { label: <span className="mono">{rest[0]}</span> },
    ];
  if (section === "tasks" && rest[1])
    return [
      { label: active.label, link: root },
      {
        label: rest[0],
        link: (
          <Link
            to="/queues/$queue"
            params={{ queue: rest[0] }}
            className="mono"
          >
            {rest[0]}
          </Link>
        ),
      },
      { label: <span className="mono">{rest[1]}</span> },
    ];
  return [
    {
      label: (
        <>
          <active.icon size={14} />
          {active.label}
        </>
      ),
    },
  ];
}
export function Topbar({
  live,
  onSearch,
}: {
  live: boolean;
  onSearch: () => void;
}) {
  const { theme, toggle } = useTheme();
  const crumbs = useCrumbs();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <header className="topbar">
      <div className="topbar-start">
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarTrigger aria-label="Toggle navigation" />
          </TooltipTrigger>
          <TooltipContent>
            Toggle navigation <Kbd>{modLabel} B</Kbd>
          </TooltipContent>
        </Tooltip>
        <Separator orientation="vertical" className="topbar-divider" />
        <Breadcrumb className="topbar-crumbs">
          <BreadcrumbList>
            {crumbs.map((c, i) => (
              <Fragment key={i}>
                {i > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem>
                  {c.link ? (
                    <BreadcrumbLink asChild>{c.link}</BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>{c.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div className="topbar-actions">
        <Button
          variant="outline"
          className="command-trigger"
          onClick={onSearch}
          aria-label="Search pages, queues and actions"
          aria-keyshortcuts="Meta+K Control+K"
        >
          <Search />
          <span className="search-label">Search…</span>
          <KbdGroup>
            <Kbd>{modLabel}</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="live-status" data-live={live} tabIndex={0}>
              <span className="live-dot" />
              <span className="live-label">{live ? "Live" : "Connecting"}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {live
              ? "Receiving real-time updates"
              : "Connecting to the event stream"}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={toggle}
              aria-label={`Switch to ${next} mode`}
            >
              {theme === "dark" ? <Sun /> : <Moon />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Switch to {next} mode</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
