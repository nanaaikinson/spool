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
import { envTone, versionLabel } from "../lib/utils";
import { cn } from "@/lib/utils";
import { useTheme } from "./theme";
import { DeploymentHelp, InstanceIdentity } from "../features/deployment";
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
const envDot: Record<string, string> = {
  production: "bg-red",
  staging: "bg-amber",
};
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
    <div className="grid min-h-dvh bg-background min-[960px]:grid-cols-[minmax(400px,5fr)_7fr]">
      {/* Brand panel beside the form from 960px, in the logo kit's ink, paper
          and copper in both themes. The ::after line is a faint thread. */}
      <aside
        className="relative hidden flex-col justify-between gap-8 overflow-hidden p-12 text-paper [background:radial-gradient(120%_80%_at_0%_100%,rgba(182,92,58,0.22),transparent_60%),#161616] after:pointer-events-none after:absolute after:inset-x-[-40%] after:inset-y-[-20%] after:[background:linear-gradient(150deg,transparent_49.6%,rgba(228,160,122,0.16)_49.8%,rgba(228,160,122,0.16)_50.2%,transparent_50.4%)] min-[960px]:flex"
        aria-hidden="true"
      >
        <BrandLogo height={36} onDark />
        <div className="relative z-1 max-w-[440px]">
          <p className="text-3xl/[1.2] font-medium tracking-[-0.02em] text-balance">
            Observability and operations for your Asynq queues.
          </p>
          <ul className="mt-8 grid gap-5">
            {highlights.map((h) => (
              <li key={h.title} className="flex gap-3">
                <span className="grid size-8 flex-none place-items-center rounded-lg border border-paper/12 bg-paper/4 text-light-copper">
                  <h.icon size={16} />
                </span>
                <div>
                  <strong className="block font-semibold">{h.title}</strong>
                  <span className="mt-0.5 block text-sm/normal text-paper/65">
                    {h.text}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative z-1 flex items-center gap-2 text-xs/normal text-paper/55">
          <Activity size={14} /> Reads your Asynq data in Redis directly. No
          agents, no worker changes.
        </p>
      </aside>
      <main className="relative flex flex-col items-center justify-center px-4 py-16">
        <div className="absolute top-3 right-3 min-[960px]:top-5 min-[960px]:right-5">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label={`Switch to ${next} mode`}
          >
            {theme === "dark" ? <Sun /> : <Moon />}
          </Button>
        </div>
        <div className="w-[min(400px,100%)]">
          <div className="mb-8 min-[960px]:hidden">
            <BrandLogo height={32} />
          </div>
          <h1 className="text-2xl/[1.25] font-semibold tracking-[-0.02em] text-balance">
            Sign in
          </h1>
          <p className="mt-2 text-muted-foreground">
            Use the account set up for{" "}
            {session?.instance_name || "this Spool deployment"}.
          </p>
          <form
            className="mt-6 grid gap-4"
            noValidate
            onSubmit={form.handleSubmit((values) =>
              mutation.mutate({ body: values }),
            )}
          >
            <Field>
              <FieldLabel htmlFor={`${id}-username`}>Username</FieldLabel>
              <Input
                className="h-10"
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
              <div className="relative">
                <Input
                  id={`${id}-password`}
                  type={showPassword ? "text" : "password"}
                  className="h-10 pr-11"
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
                  className="absolute top-1/2 right-1 grid size-8 -translate-y-1/2 place-items-center rounded-md border-0 bg-transparent text-muted-foreground hover:bg-hover hover:text-foreground"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {capsLock && (
                <p id={`${id}-caps`} className="text-xs/normal text-amber">
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
              <div
                className="flex items-start gap-2 rounded-lg border border-red/35 bg-red-bg px-3 py-2.5 text-sm/normal text-red"
                role="alert"
              >
                <CircleAlert
                  size={16}
                  aria-hidden="true"
                  className="mt-0.5 flex-none"
                />
                {errorMessage(mutation.error)}
              </div>
            )}
            <Button
              type="submit"
              size="lg"
              className="mt-1 w-full"
              disabled={mutation.isPending}
            >
              {mutation.isPending && (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              )}
              Sign in
            </Button>
          </form>
          <p className="mt-5 text-xs/normal text-pretty text-muted-foreground">
            <DeploymentHelp session={session} account />
          </p>
        </div>
        {session && (
          <p className="absolute bottom-4 flex items-center gap-1.5 text-2xs/normal text-muted-foreground">
            <span
              className={cn(
                "size-1.5 rounded-full bg-muted-foreground",
                envDot[envTone(session.environment)],
              )}
              data-tone={envTone(session.environment)}
            />
            <InstanceIdentity session={session} />
            <span aria-hidden="true">·</span>
            {versionLabel(session.version)}
          </p>
        )}
      </main>
    </div>
  );
}
