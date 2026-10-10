import { Fragment, type ReactElement, type ReactNode } from "react";
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
import { StatusDot } from "@/components/page";
import { cn } from "@/lib/utils";
import { useTheme } from "./theme";
import { activeNav, modLabel } from "./nav";
import { useSession } from "../features/session";
import { InstanceIdentity } from "../features/deployment";
type Crumb = { label: ReactNode; link?: ReactElement };
/** Long queue names and task IDs in the trail are cut short. */
const mono =
  "inline-block max-w-[18ch] truncate align-bottom font-mono md:max-w-[26ch]";
const crumb = "inline-flex items-center gap-1.5 whitespace-nowrap";
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
      { label: <span className={mono}>{rest[0]}</span> },
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
            className={mono}
          >
            {rest[0]}
          </Link>
        ),
      },
      { label: <span className={mono}>{rest[1]}</span> },
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
  const session = useSession();
  const crumbs = useCrumbs();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <header className="sticky top-0 z-20 flex h-[52px] items-center justify-between gap-2 border-b bg-[color-mix(in_srgb,var(--background)_82%,transparent)] pr-3 pl-2 [backdrop-filter:saturate(1.4)_blur(10px)] md:h-14 md:gap-3 md:pr-6 md:pl-3 xl:pr-8">
      <div className="flex min-w-0 items-center gap-2">
        <Tooltip>
          <TooltipTrigger
            render={<SidebarTrigger aria-label="Toggle navigation" />}
          />
          <TooltipContent>
            Toggle navigation <Kbd>{modLabel} B</Kbd>
          </TooltipContent>
        </Tooltip>
        <Separator
          orientation="vertical"
          className="data-[orientation=vertical]:h-[18px]"
        />
        <Breadcrumb className="min-w-0">
          <BreadcrumbList className="flex-nowrap text-sm">
            {crumbs.map((c, i) => (
              <Fragment key={i}>
                {i > 0 && (
                  <BreadcrumbSeparator className="hidden md:inline-flex" />
                )}
                <BreadcrumbItem
                  className={cn(
                    i < crumbs.length - 1 && "hidden md:inline-flex",
                  )}
                >
                  {c.link ? (
                    <BreadcrumbLink className={crumb} render={c.link} />
                  ) : (
                    <BreadcrumbPage className={cn(crumb, "font-medium")}>
                      {c.label}
                    </BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <div className="max-w-24 sm:max-w-40">
          <InstanceIdentity session={session.data} />
        </div>
        <Button
          variant="outline"
          className="h-8 w-8 justify-center gap-2 bg-surface! p-0 font-normal text-muted-foreground shadow-none hover:text-foreground has-[>svg]:p-0 md:w-50 md:justify-start md:has-[>svg]:pr-[5px] md:has-[>svg]:pl-2.5 xl:w-60"
          onClick={onSearch}
          aria-label="Search pages, queues and actions"
          aria-keyshortcuts="Meta+K Control+K"
        >
          <Search />
          <span className="hidden flex-1 text-left md:inline">Search…</span>
          <KbdGroup className="hidden border text-2xs md:inline-flex">
            <Kbd className="border text-2xs">{modLabel}</Kbd>
            <Kbd className="border text-2xs">K</Kbd>
          </KbdGroup>
        </Button>
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className="inline-flex h-7 items-center gap-[7px] rounded-full border bg-surface px-2.5 text-xs/normal text-muted-foreground"
                data-live={live}
                tabIndex={0}
              />
            }
          >
            <StatusDot tone={live ? "green" : "amber"} pulse={live} />
            <span className="hidden md:inline">
              {live ? "Live" : "Connecting"}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {live
              ? "Receiving real-time updates"
              : "Connecting to the event stream"}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={toggle}
                aria-label={`Switch to ${next} mode`}
              />
            }
          >
            {theme === "dark" ? <Sun /> : <Moon />}
          </TooltipTrigger>
          <TooltipContent>Switch to {next} mode</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
