import { Card } from "@/components/ui/card";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useId, useEffect, useState, Suspense } from "react";
import { Outlet, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Spool } from "lucide-react";
import { Button } from "../components/ui/button";
import { DataError, Loading } from "../components/data-state";
import { useTheme } from "./theme";
import { useSession } from "../features/session";
import {
  loginMutation,
  logoutMutation,
  getSessionQueryKey,
} from "../api/generated/@tanstack/react-query.gen";
import { errorCode, errorMessage } from "../api/client";
import { invalidateOperational, queryClient } from "../features/queries";
import { nav } from "./nav";
import { AppSidebar } from "./app-sidebar";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";
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
        Sign in to monitor and manage your Asynq queues.
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
          ) : !session.data?.authenticated ? (
            <Login />
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
