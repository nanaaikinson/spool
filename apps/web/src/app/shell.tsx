import { useEffect, useState, Suspense } from "react";
import { Outlet, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { DataError, Loading } from "../components/data-state";
import { useTheme } from "./theme";
import { useSession } from "../features/session";
import {
  logoutMutation,
  getSessionQueryKey,
} from "../api/generated/@tanstack/react-query.gen";
import { errorCode, errorMessage } from "../api/client";
import { invalidateOperational, queryClient } from "../features/queries";
import { nav } from "./nav";
import { AppSidebar } from "./app-sidebar";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";
import { LoginScreen } from "./login";
export function Shell() {
  const session = useSession();
  // Signed-out visitors get the sign-in screen without any of the app frame.
  if (session.data && !session.data.authenticated)
    return <LoginScreen session={session.data} />;
  return (
    <SidebarProvider
      defaultOpen={!document.cookie.includes("sidebar_state=false")}
    >
      <ShellContent />
    </SidebarProvider>
  );
}
function ShellContent() {
  const { theme } = useTheme();
  const session = useSession();
  const navigate = useNavigate();
  const [palette, setPalette] = useState(false);
  const [live, setLive] = useState(false);
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
  const signOut = () =>
    logout.mutate({
      body: { confirm: true },
      headers: { "X-Spool-Action": "confirmed" },
    });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      }
      // e.code, not e.key: Option+digit produces symbols like "¡" on macOS.
      const digit = /^Digit([1-9])$/.exec(e.code)?.[1];
      if (e.altKey && !e.metaKey && !e.ctrlKey && digit) {
        e.preventDefault();
        setPalette(false);
        navigate({ to: nav[Number(digit) - 1].to });
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
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <AppSidebar onSignOut={signOut} />
      <SidebarInset>
        <Topbar live={live} onSearch={() => setPalette(true)} />
        {session.data?.read_only_reason === "no_database" && (
          <div className="mode-banner" role="status">
            <strong>Read-only.</strong> No database is configured, so changes
            are off. Set <code>DATABASE_URL</code> to pause queues, act on
            tasks, save views and keep an audit log.
          </div>
        )}
        <div className="main" id="main" tabIndex={-1}>
          {session.isPending ? (
            <Loading />
          ) : session.error ? (
            <DataError error={session.error} retry={() => session.refetch()} />
          ) : (
            <Suspense fallback={<Loading />}>
              <Outlet />
            </Suspense>
          )}
        </div>
      </SidebarInset>
      <CommandPalette
        open={palette}
        onOpenChange={setPalette}
        onSignOut={signOut}
      />
      <Toaster theme={theme} richColors position="bottom-right" />
    </>
  );
}
