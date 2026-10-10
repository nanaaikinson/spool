import { Link, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronsUpDown, LogOut, Settings } from "lucide-react";
import { BrandMark } from "../components/brand";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  listQueuesOptions,
  listServersOptions,
} from "../api/generated/@tanstack/react-query.gen";
import { useSession } from "../features/session";
import { activeNav, altLabel, compactNumber, nav, navGroups } from "./nav";
import { envTone, versionLabel } from "../lib/utils";
import { cn } from "@/lib/utils";

import { InstanceIdentity } from "../features/deployment";
import { OrganizationSwitcher } from "../features/access";
const navLink =
  "h-9 gap-2.5 text-muted-foreground data-active:bg-surface data-active:shadow-[0_0_0_1px_var(--border),0_1px_2px_rgba(0,0,0,0.06)]";
const navBadge =
  "right-1.5 h-[18px] -translate-y-1/2 rounded-full px-1.5 text-2xs font-semibold peer-data-[size=default]/menu-button:top-1/2";
const envDot: Record<string, string> = {
  production: "bg-red",
  staging: "bg-amber",
};

export function AppSidebar({ onSignOut }: { onSignOut: () => void }) {
  const session = useSession();
  const location = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();
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
  const access = !session.data?.authenticated
    ? "Not signed in"
    : readOnly
      ? "Read only"
      : session.data?.role === "operator"
        ? "Operator"
        : "Full access";
  return (
    <Sidebar collapsible="icon" aria-label="Primary navigation">
      <SidebarHeader className="gap-2.5 px-2 pt-3 pb-1.5">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip="Spool"
              className="gap-2.5"
              render={<Link to="/" onClick={close} />}
            >
              <span className="grid size-8 flex-none place-items-center rounded-lg bg-ink shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_1px_3px_rgba(0,0,0,0.25)]">
                <BrandMark size={20} />
              </span>
              <span className="grid min-w-0 flex-1 leading-[1.3]">
                <strong className="truncate text-md/[1.3] font-[650] tracking-[-0.02em] text-foreground">
                  Spool
                </strong>
                <span className="truncate text-2xs/[1.3] text-muted-foreground">
                  Asynq console
                </span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <OrganizationSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Primary navigation">
          {navGroups.map((group) => (
            <SidebarGroup key={group.label} className="px-2 py-1.5">
              <SidebarGroupLabel className="h-7 text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
                {group.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((n) => {
                    const isActive = active?.to === n.to;
                    const shortcut = nav.indexOf(n) + 1;
                    return (
                      <SidebarMenuItem key={n.to}>
                        <SidebarMenuButton
                          isActive={isActive}
                          tooltip={`${n.label} · ${altLabel}${shortcut}`}
                          className={navLink}
                          render={
                            <Link
                              to={n.to}
                              aria-current={isActive ? "page" : undefined}
                              onClick={close}
                            />
                          }
                        >
                          <n.icon />
                          <span>{n.label}</span>
                        </SidebarMenuButton>
                        {n.to === "/failures" && !!failures && (
                          <SidebarMenuBadge
                            className={cn(
                              navBadge,
                              "bg-red-bg text-red peer-hover/menu-button:text-red peer-data-active/menu-button:text-red",
                            )}
                            title={`${failures.toLocaleString()} retained failures`}
                          >
                            {compactNumber(failures)}
                          </SidebarMenuBadge>
                        )}
                        {n.to === "/live" && !!running && (
                          <SidebarMenuBadge
                            className={cn(
                              navBadge,
                              "bg-green-bg text-green peer-hover/menu-button:text-green peer-data-active/menu-button:text-green",
                            )}
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
      <SidebarFooter className="gap-1.5 border-t p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={location.pathname === "/settings"}
              tooltip="Settings"
              className={navLink}
              render={
                <Link
                  to="/settings"
                  aria-current={
                    location.pathname === "/settings" ? "page" : undefined
                  }
                  onClick={close}
                />
              }
            >
              <Settings />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    size="lg"
                    tooltip={actor}
                    aria-label={`${actor}, account menu`}
                    className="gap-2.5 data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
                  />
                }
              >
                <AccountIdentity actor={actor} access={access} />
                <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="min-w-56 rounded-lg"
                side={isMobile ? "bottom" : "right"}
                align="end"
                sideOffset={4}
              >
                <div className="flex items-center gap-2.5 px-1.5 py-1.5">
                  <AccountIdentity actor={actor} access={access} />
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    render={<Link to="/settings" onClick={close} />}
                  >
                    <Settings />
                    Settings &amp; audit
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                {session.data?.auth_required && session.data.authenticated ? (
                  <DropdownMenuItem onClick={onSignOut}>
                    <LogOut />
                    Sign out
                  </DropdownMenuItem>
                ) : (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">
                    Sign-in is off on this server.
                  </p>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
        {session.data && (
          <p
            className="flex items-center gap-1.5 px-1 pt-0.5 text-2xs/normal text-muted-foreground opacity-75 group-data-[collapsible=icon]:hidden"
            data-tone={envTone(session.data.environment)}
            title={`Environment ${session.data.environment}, Spool ${session.data.version}`}
          >
            <span
              className={cn(
                "size-1.5 rounded-full bg-muted-foreground",
                envDot[envTone(session.data.environment)],
              )}
            />
            <InstanceIdentity session={session.data} />
            <span aria-hidden="true">·</span>
            {versionLabel(session.data.version)}
          </p>
        )}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/** Avatar initial, name and access level for the signed-in account. */
function AccountIdentity({ actor, access }: { actor: string; access: string }) {
  return (
    <>
      <span
        className="grid size-8 flex-none place-items-center rounded-full border bg-accent-bg text-xs/normal font-semibold text-foreground"
        aria-hidden="true"
      >
        {actor.slice(0, 1).toUpperCase()}
      </span>
      <span className="grid min-w-0 flex-1 text-left leading-[1.3]">
        <strong className="truncate text-sm/[1.3] font-[550] text-foreground">
          {actor}
        </strong>
        <span className="truncate text-2xs/[1.3] text-muted-foreground">
          {access}
        </span>
      </span>
    </>
  );
}
