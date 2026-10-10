import { Link, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { LogOut, Settings, Spool } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  listQueuesOptions,
  listServersOptions,
} from "../api/generated/@tanstack/react-query.gen";
import { useSession } from "../features/session";
import { activeNav, altLabel, compactNumber, nav, navGroups } from "./nav";
const envTone = (env: string) =>
  /prod/i.test(env) ? "production" : /stag/i.test(env) ? "staging" : "other";
export function AppSidebar({ onSignOut }: { onSignOut: () => void }) {
  const session = useSession();
  const location = useLocation();
  const { setOpenMobile } = useSidebar();
  const queues = useQuery({
    ...listQueuesOptions(),
    enabled: session.data?.authenticated === true,
  });
  const servers = useQuery({
    ...listServersOptions(),
    enabled: session.data?.authenticated === true,
  });
  const running = servers.data?.data.reduce(
    (total, s) => total + s.workers.length,
    0,
  );
  const failures = queues.data?.data.reduce(
    (total, q) => total + q.retry + q.archived,
    0,
  );
  const active = activeNav(location.pathname);
  const close = () => setOpenMobile(false);
  const readOnly = session.data?.role === "viewer";
  const actor = session.data?.actor || "local";
  return (
    <Sidebar collapsible="icon" aria-label="Primary navigation">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="Spool">
              <Link to="/" className="sidebar-brand" onClick={close}>
                <span className="brand-tile">
                  <Spool size={18} />
                </span>
                <span className="sidebar-text">
                  <strong>Spool</strong>
                  <span>Asynq console</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Primary navigation">
          {navGroups.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((n) => {
                    const isActive = active?.to === n.to;
                    const shortcut = nav.indexOf(n) + 1;
                    return (
                      <SidebarMenuItem key={n.to}>
                        <SidebarMenuButton
                          asChild
                          isActive={isActive}
                          tooltip={`${n.label} · ${altLabel}${shortcut}`}
                        >
                          <Link
                            to={n.to}
                            className="nav-link"
                            aria-current={isActive ? "page" : undefined}
                            onClick={close}
                          >
                            <n.icon />
                            <span>{n.label}</span>
                          </Link>
                        </SidebarMenuButton>
                        {n.to === "/failures" && !!failures && (
                          <SidebarMenuBadge
                            className="nav-badge"
                            title={`${failures.toLocaleString()} retained failures`}
                          >
                            {compactNumber(failures)}
                          </SidebarMenuBadge>
                        )}
                        {n.to === "/live" && !!running && (
                          <SidebarMenuBadge
                            className="nav-badge live"
                            title={`${running} tasks running`}
                          >
                            {compactNumber(running)}
                          </SidebarMenuBadge>
                        )}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={location.pathname === "/settings"}
              tooltip="Settings"
            >
              <Link
                to="/settings"
                className="nav-link"
                aria-current={
                  location.pathname === "/settings" ? "page" : undefined
                }
                onClick={close}
              >
                <Settings />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="sidebar-account">
          <span className="avatar" aria-hidden="true">
            {actor.slice(0, 1).toUpperCase()}
          </span>
          <span className="sidebar-text">
            <strong>{actor}</strong>
            <span>{readOnly ? "Read only" : "Full access"}</span>
          </span>
          {session.data?.auth_required && session.data.authenticated && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  onClick={onSignOut}
                  aria-label="Sign out"
                >
                  <LogOut size={15} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Sign out</TooltipContent>
            </Tooltip>
          )}
        </div>
        {session.data && (
          <p
            className="sidebar-meta"
            data-tone={envTone(session.data.environment)}
            title={`Environment ${session.data.environment}, Spool ${session.data.version}`}
          >
            <span className="env-dot" />
            {session.data.environment}
            <span aria-hidden="true">·</span>v{session.data.version}
          </p>
        )}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
