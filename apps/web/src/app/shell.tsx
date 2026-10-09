import { Card } from "@/components/ui/card";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useId, useEffect, useState, Suspense } from "react";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import {
  Activity,
  Layers,
  ListTodo,
  Cpu,
  Clock,
  CircleAlert,
  ChartNoAxesCombined,
  Settings,
  Search,
  Sun,
  Moon,
  Spool,
  LogOut,
  RefreshCw,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { DataError, Loading } from "../components/data-state";
import { useTheme } from "./theme";
import { useSession } from "../features/session";
import {
  loginMutation,
  logoutMutation,
  getSessionQueryKey,
  listQueuesOptions,
} from "../api/generated/@tanstack/react-query.gen";
import { errorCode, errorMessage } from "../api/client";
import { invalidateOperational, queryClient } from "../features/queries";
const nav = [
  { to: "/", label: "Overview", icon: Activity },
  { to: "/queues", label: "Queues", icon: Layers },
  { to: "/tasks", label: "Tasks", icon: ListTodo },
  { to: "/workers", label: "Workers", icon: Cpu },
  { to: "/scheduled", label: "Scheduled", icon: Clock },
  { to: "/failures", label: "Failures", icon: CircleAlert },
  { to: "/metrics", label: "Metrics", icon: ChartNoAxesCombined },
] as const;
const loginSchema = z.object({
  username: z.string().min(1, "Enter your username."),
  password: z.string().min(1, "Enter your password."),
});
function Login() {
  const fieldsID = useId();
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
  });
  const mutation = useMutation({
    ...loginMutation(),
    onSuccess: (data) => {
      queryClient.removeQueries({
        predicate: (q) =>
          q.queryKey[0] !== getSessionQueryKey()[0] &&
          !(
            typeof q.queryKey[0] === "object" &&
            q.queryKey[0] !== null &&
            "_id" in q.queryKey[0] &&
            q.queryKey[0]._id === getSessionQueryKey()[0]._id
          ),
      });
      queryClient.setQueryData(getSessionQueryKey(), data);
    },
  });
  return (
    <Card className="login gap-0">
      <div className="brand">
        <Spool className="accent" size={30} />
        Spool
      </div>
      <h1>Sign in</h1>
      <p className="muted" style={{ marginTop: 8 }}>
        Access your Asynq operations console.
      </p>
      <form
        className="form"
        onSubmit={form.handleSubmit((values) =>
          mutation.mutate({ body: values }),
        )}
      >
        <Field>
          <FieldLabel htmlFor={`${fieldsID}-username`}>Username</FieldLabel>
          <Input
            id={`${fieldsID}-username`}
            autoComplete="username"
            {...form.register("username")}
            aria-invalid={!!form.formState.errors.username}
          />
          {form.formState.errors.username && (
            <FieldError className="form-error">
              {form.formState.errors.username.message}
            </FieldError>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor={`${fieldsID}-password`}>Password</FieldLabel>
          <Input
            id={`${fieldsID}-password`}
            type="password"
            autoComplete="current-password"
            {...form.register("password")}
            aria-invalid={!!form.formState.errors.password}
          />
          {form.formState.errors.password && (
            <FieldError className="form-error">
              {form.formState.errors.password.message}
            </FieldError>
          )}
        </Field>
        {mutation.error && (
          <FieldError className="form-error" role="alert">
            {errorMessage(mutation.error)}
          </FieldError>
        )}
        <Button disabled={mutation.isPending} type="submit">
          {mutation.isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </Card>
  );
}
export function Shell() {
  return (
    <SidebarProvider
      style={{ "--sidebar-width": "208px" } as React.CSSProperties}
    >
      <ShellContent />
    </SidebarProvider>
  );
}
function ShellContent() {
  const { theme, toggle } = useTheme();
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [palette, setPalette] = useState(false);
  const { setOpenMobile: setMobile } = useSidebar();
  const [live, setLive] = useState(false);
  const queues = useQuery({
    ...listQueuesOptions(),
    enabled: session.data?.authenticated === true,
  });
  const logout = useMutation({
    ...logoutMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getSessionQueryKey() });
      queryClient.removeQueries({
        predicate: (q) =>
          !(
            typeof q.queryKey[0] === "object" &&
            q.queryKey[0] !== null &&
            "_id" in q.queryKey[0] &&
            q.queryKey[0]._id === getSessionQueryKey()[0]._id
          ),
      });
      navigate({ to: "/" });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      }
      if (e.altKey && /^[1-7]$/.test(e.key)) {
        e.preventDefault();
        navigate({ to: nav[Number(e.key) - 1].to });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [navigate]);
  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (
          event.type === "updated" &&
          event.action.type === "error" &&
          errorCode(event.action.error) === "AUTH_REQUIRED"
        )
          queryClient.invalidateQueries({ queryKey: getSessionQueryKey() });
      }),
    [],
  );
  useEffect(() => {
    if (!session.data?.authenticated) return;
    let source: EventSource | undefined;
    const open = () => {
      source?.close();
      if (document.hidden) {
        setLive(false);
        return;
      }
      source = new EventSource("/api/v1/events");
      source.addEventListener("connected", () => {
        setLive(true);
        invalidateOperational();
      });
      source.addEventListener("snapshot", () => invalidateOperational());
      source.addEventListener("changed", () => invalidateOperational());
      source.onerror = () => {
        setLive(false);
        queryClient.invalidateQueries({ queryKey: getSessionQueryKey() });
      };
    };
    open();
    document.addEventListener("visibilitychange", open);
    return () => {
      source?.close();
      document.removeEventListener("visibilitychange", open);
    };
  }, [session.data?.authenticated]);
  const active = nav.find((n) =>
    n.to === "/"
      ? location.pathname === "/"
      : location.pathname.startsWith(n.to),
  );
  const openPage = (to: (typeof nav)[number]["to"]) => {
    navigate({ to });
    setPalette(false);
    setMobile(false);
  };
  const themeButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        Switch to {theme === "dark" ? "light" : "dark"} mode
      </TooltipContent>
    </Tooltip>
  );
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Sidebar aria-label="Primary navigation">
        <SidebarHeader>
          <Link to="/" className="brand">
            <span className="brand-mark">
              <Spool size={29} />
            </span>
            Spool
          </Link>
          <div className="environment">
            <span className="dot" />
            <div>
              <div>{session.data?.environment ?? "Connecting"}</div>
              <div className="muted small">Asynq environment</div>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <nav aria-label="Primary navigation">
            <SidebarMenu>
              {nav.map((n, i) => (
                <SidebarMenuItem key={n.to}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <SidebarMenuButton asChild isActive={active?.to === n.to}>
                        <Link
                          to={n.to}
                          className={`nav-link ${active?.to === n.to ? "active" : ""}`}
                          aria-current={
                            active?.to === n.to ? "page" : undefined
                          }
                          onClick={() => setMobile(false)}
                        >
                          <n.icon size={17} />
                          {n.label}
                        </Link>
                      </SidebarMenuButton>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {n.label} · Alt+{i + 1}
                    </TooltipContent>
                  </Tooltip>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </nav>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={location.pathname === "/settings"}
              >
                <Link
                  to="/settings"
                  className={`nav-link ${location.pathname === "/settings" ? "active" : ""}`}
                  onClick={() => setMobile(false)}
                >
                  <Settings size={17} />
                  Settings & audit
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <div className="footer-line">
            <span className="muted small">
              {session.data?.role === "viewer"
                ? "Read only"
                : "Operations access"}
            </span>
            {themeButton}
          </div>
          <div className="footer-line">
            <span className="muted small">
              Spool v{session.data?.version ?? "0.1.0"}
            </span>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="topbar">
          <div className="toolbar">
            <SidebarTrigger
              className="mobile-menu"
              aria-label="Toggle navigation"
            />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link to="/">Workspace</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>{active?.label ?? "Settings"}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="topbar-actions">
            <Button
              variant="outline"
              className="command-trigger"
              onClick={() => setPalette(true)}
            >
              <Search size={14} />
              <span className="search-label">Find a queue or view</span>
              <Kbd>⌘ K</Kbd>
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="small muted" tabIndex={0}>
                  <span
                    className="dot"
                    style={{
                      background: live ? "var(--green)" : "var(--amber)",
                      marginRight: 6,
                    }}
                  />
                  {live ? "Live" : "Connecting"}
                </span>
              </TooltipTrigger>
              <TooltipContent>SSE connection status</TooltipContent>
            </Tooltip>
            {themeButton}
            {session.data?.auth_required && session.data.authenticated && (
              <Button
                size="icon"
                variant="ghost"
                onClick={() =>
                  logout.mutate({
                    body: { confirm: true },
                    headers: { "X-Spool-Action": "confirmed" },
                  })
                }
                aria-label="Sign out"
              >
                <LogOut size={16} />
              </Button>
            )}
          </div>
        </header>
        <div className="main" id="main" tabIndex={-1}>
          {session.isPending ? (
            <Loading />
          ) : session.error ? (
            <DataError error={session.error} retry={() => session.refetch()} />
          ) : !session.data?.authenticated ? (
            <Login />
          ) : (
            <Suspense fallback={<Loading />}>
              <Outlet />
            </Suspense>
          )}
        </div>
      </SidebarInset>
      <CommandDialog
        open={palette}
        onOpenChange={setPalette}
        title="Go to…"
        description="Search queues and views. Use Alt+1 through Alt+7 for primary views."
      >
        <CommandInput placeholder="Search queues and views…" />
        <CommandList>
          <CommandEmpty>No matching queues or views.</CommandEmpty>
          <CommandGroup heading="Views">
            {nav.map((n) => (
              <CommandItem key={n.to} onSelect={() => openPage(n.to)}>
                <n.icon size={16} />
                {n.label}
              </CommandItem>
            ))}
            <CommandItem
              onSelect={() => {
                navigate({ to: "/schedulers" });
                setPalette(false);
              }}
            >
              <Clock size={16} />
              Periodic schedules
            </CommandItem>
            <CommandItem
              onSelect={() => {
                toggle();
                setPalette(false);
              }}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              Switch to {theme === "dark" ? "light" : "dark"} mode
            </CommandItem>
            <CommandItem
              onSelect={() => {
                invalidateOperational();
                setPalette(false);
              }}
            >
              <RefreshCw size={16} />
              Refresh current data
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Queues">
            {queues.data?.data.map((q) => (
              <CommandItem
                key={q.name}
                value={`queue ${q.name}`}
                onSelect={() => {
                  navigate({
                    to: "/queues/$queue",
                    params: { queue: q.name },
                  });
                  setPalette(false);
                }}
              >
                <Layers size={16} />
                <span className="mono">{q.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
      <Toaster theme={theme} richColors position="bottom-right" />
    </>
  );
}
