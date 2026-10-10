import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Activity,
  CircleAlert,
  Eye,
  EyeOff,
  Layers,
  LoaderCircle,
  Moon,
  Radio,
  Sun,
} from "lucide-react";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "../components/ui/button";
import { BrandLogo } from "../components/brand";
import {
  getSessionQueryKey,
  loginMutation,
} from "../api/generated/@tanstack/react-query.gen";
import type { Session } from "../api/generated/types.gen";
import { errorMessage } from "../api/client";
import { queryClient } from "../features/queries";
import { envTone } from "../lib/utils";
import { useTheme } from "./theme";
const loginSchema = z.object({
  username: z.string().trim().min(1, "Enter your username."),
  password: z.string().min(1, "Enter your password."),
});
const highlights = [
  {
    icon: Radio,
    title: "Live activity",
    text: "See what's running, what runs next, and how long each task takes.",
  },
  {
    icon: CircleAlert,
    title: "Failures, grouped",
    text: "Spot the errors that matter and retry or archive in a few clicks.",
  },
  {
    icon: Layers,
    title: "Queues and servers",
    text: "Know when a queue backs up or nothing is processing it.",
  },
];
/** Full-screen sign-in, shown instead of the app shell until a session exists. */
export function LoginScreen({ session }: { session?: Session }) {
  const id = useId();
  const { theme, toggle } = useTheme();
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });
  const mutation = useMutation({
    ...loginMutation(),
    onSuccess: (data) => {
      // Drop everything cached for the previous identity, except the session.
      queryClient.removeQueries({
        predicate: (q) => {
          const key = q.queryKey[0];
          return !(
            typeof key === "object" &&
            key !== null &&
            "_id" in key &&
            key._id === getSessionQueryKey()[0]._id
          );
        },
      });
      queryClient.setQueryData(getSessionQueryKey(), data);
    },
    onError: () => form.setValue("password", ""),
  });
  const errors = form.formState.errors;
  const next = theme === "dark" ? "light" : "dark";
  return (
    <div className="login-screen">
      <aside className="login-brand" aria-hidden="true">
        <BrandLogo height={36} onDark />
        <div className="login-pitch">
          <p className="login-tagline">
            Observability and operations for your Asynq queues.
          </p>
          <ul className="login-highlights">
            {highlights.map((h) => (
              <li key={h.title}>
                <span className="login-highlight-icon">
                  <h.icon size={16} />
                </span>
                <div>
                  <strong>{h.title}</strong>
                  <span>{h.text}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="login-brand-footer">
          <Activity size={14} /> Reads your Asynq data in Redis directly. No
          agents, no worker changes.
        </p>
      </aside>
      <main className="login-main">
        <div className="login-toolbar">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label={`Switch to ${next} mode`}
          >
            {theme === "dark" ? <Sun /> : <Moon />}
          </Button>
        </div>
        <div className="login-panel">
          <div className="login-mobile-logo">
            <BrandLogo height={32} />
          </div>
          <h1>Sign in</h1>
          <p className="login-intro">
            Use the account set up for this Spool deployment.
          </p>
          <form
            className="login-form"
            noValidate
            onSubmit={form.handleSubmit((values) =>
              mutation.mutate({ body: values }),
            )}
          >
            <Field>
              <FieldLabel htmlFor={`${id}-username`}>Username</FieldLabel>
              <Input
                id={`${id}-username`}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                aria-invalid={!!errors.username}
                aria-describedby={
                  errors.username ? `${id}-username-error` : undefined
                }
                {...form.register("username")}
              />
              {errors.username && (
                <FieldError id={`${id}-username-error`}>
                  {errors.username.message}
                </FieldError>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-password`}>Password</FieldLabel>
              <div className="password-field">
                <Input
                  id={`${id}-password`}
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  aria-invalid={!!errors.password}
                  aria-describedby={
                    [
                      errors.password && `${id}-password-error`,
                      capsLock && `${id}-caps`,
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                  onKeyUp={(e) => setCapsLock(e.getModifierState("CapsLock"))}
                  {...form.register("password", {
                    onBlur: () => setCapsLock(false),
                  })}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {capsLock && (
                <p id={`${id}-caps`} className="caps-hint">
                  Caps Lock is on.
                </p>
              )}
              {errors.password && (
                <FieldError id={`${id}-password-error`}>
                  {errors.password.message}
                </FieldError>
              )}
            </Field>
            {mutation.error && (
              <div className="login-error" role="alert">
                <CircleAlert size={16} aria-hidden="true" />
                {errorMessage(mutation.error)}
              </div>
            )}
            <Button
              type="submit"
              size="lg"
              className="login-submit"
              disabled={mutation.isPending}
            >
              {mutation.isPending && (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              )}
              Sign in
            </Button>
          </form>
          <p className="login-help">
            Forgot your password? Accounts are set on the server, so ask whoever
            runs this deployment.
          </p>
        </div>
        {session && (
          <p className="login-meta">
            <span
              className="env-dot"
              data-tone={envTone(session.environment)}
            />
            {session.environment}
            <span aria-hidden="true">·</span>
            {/^\d/.test(session.version)
              ? `v${session.version}`
              : session.version}
          </p>
        )}
      </main>
    </div>
  );
}
