import { useId, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertDialogCancel } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Section, SectionHeader, SectionBody } from "@/components/page";
import { DataError, Loading } from "@/components/data-state";
import { BrandLogo } from "@/components/brand";
import { OperationDialog } from "@/components/operation-dialog";
import {
  listMembersOptions,
  listOrganizationsOptions,
  listUsersOptions,
} from "@/api/generated/@tanstack/react-query.gen";
import {
  addMember,
  changeMember,
  changeAdministration,
  changePassword,
  createOrganization,
  logout,
  removeMember,
  renameOrganization,
  setup,
  switchOrganization,
  updateOrganizationConnection,
  updateUser,
} from "@/api/generated/sdk.gen";
import type { Member, User } from "@/api/generated/types.gen";
import { selectOrganization, errorMessage } from "@/api/client";
import { queryClient } from "./queries";
import { useSession } from "./session";

const roles = z.enum(["admin", "operator", "viewer"]);
const selectClass =
  "h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-ring disabled:opacity-50";
type FormInput = {
  name: string;
  label: string;
  type?: "password";
  optional?: boolean;
  value?: string;
  help?: string;
  roles?: boolean;
};
const organizationFields: FormInput[] = [
  { name: "name", label: "Organization name" },
  {
    name: "redis_url",
    label: "Asynq Redis URL",
    type: "password",
    help: "Use the same Redis host and database as your workers. Use rediss:// over public networks.",
  },
  {
    name: "prometheus_url",
    label: "Prometheus URL",
    type: "password",
    optional: true,
    help: "Leave empty to use this deployment’s Prometheus. Scraped metrics must carry this organization’s label.",
  },
];

function ActionForm({
  fields,
  action,
  run,
  onSuccess,
}: {
  fields: FormInput[];
  action: string;
  run: (values: Record<string, string>) => Promise<unknown>;
  onSuccess?: () => void;
}) {
  const id = useId();
  const form = useForm<Record<string, string>>({
    defaultValues: Object.fromEntries(
      fields.map((f) => [f.name, f.value ?? (f.roles ? "viewer" : "")]),
    ),
  });
  const mutation = useMutation({
    mutationFn: run,
    onSuccess: () => {
      form.reset();
      toast.success(`${action} completed.`);
      queryClient.invalidateQueries();
      onSuccess?.();
    },
  });
  return (
    <form
      className="grid max-w-xl gap-4"
      onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
    >
      {fields.map((f) => (
        <Field key={f.name}>
          <FieldLabel htmlFor={`${id}-${f.name}`}>
            {f.label}
            {f.optional && " (optional)"}
          </FieldLabel>
          {f.roles ? (
            <select
              className={selectClass}
              id={`${id}-${f.name}`}
              {...form.register(f.name)}
            >
              {roles.options.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          ) : (
            <Input
              id={`${id}-${f.name}`}
              type={f.type ?? "text"}
              required={!f.optional}
              autoComplete={f.type === "password" ? "off" : undefined}
              maxLength={
                f.name.includes("password")
                  ? 72
                  : f.name === "name" || f.name === "username"
                    ? 80
                    : undefined
              }
              minLength={f.name === "password" ? 12 : undefined}
              {...form.register(f.name, { required: !f.optional })}
            />
          )}
          {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
        </Field>
      ))}
      {mutation.error && (
        <p role="alert" className="text-sm text-red">
          {errorMessage(mutation.error)}
        </p>
      )}
      <Button
        type="submit"
        className="justify-self-start"
        disabled={mutation.isPending}
      >
        {mutation.isPending ? "Saving…" : action}
      </Button>
    </form>
  );
}

export function SetupScreen() {
  const [done, setDone] = useState(false);
  return (
    <main className="mx-auto grid min-h-dvh max-w-2xl content-center gap-6 px-5 py-12">
      <BrandLogo height={32} />
      <div>
        <h1 className="text-2xl font-semibold">Set up your organization</h1>
        <p className="mt-2 text-muted-foreground">
          Create the first organization and administrator account. You can add
          more organizations after signing in.
        </p>
      </div>
      {done ? (
        <>
          <p role="status">
            Your organization is ready. Sign in with the account you just
            created.
          </p>
          <Button onClick={() => window.location.reload()}>
            Continue to sign in
          </Button>
        </>
      ) : (
        <ActionForm
          action="Complete setup"
          fields={[
            {
              name: "token",
              label: "Setup token",
              type: "password",
              help: "Find SPOOL_SETUP_TOKEN in your private deployment configuration.",
            },
            { name: "name", label: "Organization name" },
            { name: "username", label: "Administrator username" },
            {
              name: "password",
              label: "Administrator password",
              type: "password",
              help: "Use 12–72 bytes. Store it in your password manager.",
            },
            {
              ...organizationFields[1],
              optional: true,
              help: "Leave empty to use the Redis connection configured for this deployment.",
            },
            organizationFields[2],
          ]}
          run={(v) =>
            setup({
              body: {
                token: v.token,
                username: v.username,
                password: v.password,
                organization: {
                  name: v.name,
                  redis_url: v.redis_url,
                  prometheus_url: v.prometheus_url,
                },
              },
              headers: { "X-Spool-Action": "confirmed" },
              throwOnError: true,
            })
          }
          onSuccess={() => setDone(true)}
        />
      )}
    </main>
  );
}

export function OrganizationSwitcher() {
  const session = useSession();
  const organizations = useQuery({
    ...listOrganizationsOptions(),
    enabled: !!session.data?.managed && !!session.data?.authenticated,
  });
  const mutation = useMutation({
    mutationFn: (id: string) =>
      switchOrganization({
        body: { id },
        headers: { "X-Spool-Action": "confirmed" },
        throwOnError: true,
      }),
    onSuccess: (_, id) => {
      // A full navigation drops caches, pending requests, drafts and SSE subscriptions together.
      selectOrganization(id);
      window.location.assign("/");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!session.data?.managed) return null;
  if (organizations.error)
    return (
      <DataError
        error={organizations.error}
        retry={() => organizations.refetch()}
      />
    );
  return (
    <div className="grid min-w-0 gap-1 group-data-[collapsible=icon]:hidden">
      <label
        htmlFor="organization-switcher"
        className="text-xs text-muted-foreground"
      >
        Organization
      </label>
      <select
        id="organization-switcher"
        className={`${selectClass} w-full`}
        value={session.data.organization?.id ?? ""}
        disabled={mutation.isPending || organizations.isPending}
        onChange={(e) => mutation.mutate(e.target.value)}
      >
        {!session.data.organization && (
          <option value="">Select organization</option>
        )}
        {organizations.data?.data.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name} ({org.role})
          </option>
        ))}
      </select>
    </div>
  );
}

type Confirmation = {
  title: string;
  description: string;
  run: () => Promise<unknown>;
};
function ConfirmAction({
  value,
  close,
  finalFocus,
}: {
  value: Confirmation | null;
  close: () => void;
  finalFocus: React.RefObject<HTMLElement | null>;
}) {
  const mutation = useMutation({
    mutationFn: () => value!.run(),
    onSuccess: () => {
      close();
      queryClient.invalidateQueries();
      toast.success("Changes saved.");
    },
  });
  return (
    <OperationDialog
      finalFocus={finalFocus}
      open={!!value}
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) close();
      }}
      title={value?.title ?? "Confirm change"}
      description={value?.description ?? ""}
    >
      {mutation.error && (
        <p role="alert" className="text-red">
          {errorMessage(mutation.error)}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <AlertDialogCancel disabled={mutation.isPending} onClick={close}>
          Cancel
        </AlertDialogCancel>
        <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          Confirm
        </Button>
      </div>
    </OperationDialog>
  );
}
function MemberRow({
  member,
  confirm,
  disabled,
}: {
  member: Member;
  confirm: (v: Confirmation) => void;
  disabled: boolean;
}) {
  const [role, setRole] = useState(member.role);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b py-3 last:border-0">
      <div className="min-w-0">
        <strong className="break-all text-sm">{member.username}</strong>
        <p className="text-xs text-muted-foreground">
          {member.disabled ? "Account disabled" : member.role}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={selectClass}
          aria-label={`Role for ${member.username}`}
          value={role}
          disabled={disabled}
          onChange={(e) => setRole(roles.parse(e.target.value))}
        >
          {roles.options.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || role === member.role}
          onClick={() =>
            confirm({
              title: `Change ${member.username}’s role?`,
              description: `Give ${member.username} ${role} access to this organization. Permissions take effect immediately.`,
              run: () =>
                changeMember({
                  path: { id: member.id },
                  body: { role },
                  headers: { "X-Spool-Action": "confirmed" },
                  throwOnError: true,
                }),
            })
          }
        >
          Save role
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() =>
            confirm({
              title: `Remove ${member.username}?`,
              description:
                "Remove access to this organization. Memberships in other organizations are preserved.",
              run: () =>
                removeMember({
                  path: { id: member.id },
                  body: { confirm: true },
                  headers: { "X-Spool-Action": "confirmed" },
                  throwOnError: true,
                }),
            })
          }
        >
          Remove
        </Button>
      </div>
    </div>
  );
}
type AdministrationAction = "grant" | "revoke" | "transfer";

function UserRow({
  user,
  administration,
  actor,
  confirm,
  reset,
  disabled,
}: {
  user: User;
  actor: string;
  administration: (user: User, action: AdministrationAction) => void;
  confirm: (v: Confirmation) => void;
  reset: (u: User) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b py-3 last:border-0">
      <div className="min-w-0">
        <strong className="break-all text-sm">{user.username}</strong>
        <p className="text-xs text-muted-foreground">
          {user.platform_admin ? "Deployment administrator · " : ""}
          {user.disabled ? "Disabled" : "Active"}
        </p>
      </div>
      <div className="flex min-w-0 max-w-full flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || (user.disabled && !user.platform_admin)}
          onClick={() =>
            administration(user, user.platform_admin ? "revoke" : "grant")
          }
        >
          {user.platform_admin ? "Remove administrator" : "Make administrator"}
        </Button>
        {user.username !== actor && (
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || user.disabled}
            onClick={() => administration(user, "transfer")}
          >
            Transfer administration
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => reset(user)}
        >
          Reset password
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() =>
            confirm({
              title: `${user.disabled ? "Enable" : "Disable"} ${user.username}?`,
              description:
                "This affects every organization and revokes the account’s existing sessions.",
              run: () =>
                updateUser({
                  path: { id: user.id },
                  body: { disabled: !user.disabled, password: "" },
                  headers: { "X-Spool-Action": "confirmed" },
                  throwOnError: true,
                }),
            })
          }
        >
          {user.disabled ? "Enable" : "Disable"}
        </Button>
      </div>
    </div>
  );
}

export function AccessSettings() {
  const session = useSession();
  const s = session.data;
  const accessRef = useRef<HTMLDivElement>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [administration, setAdministration] = useState<{
    user: User;
    action: AdministrationAction;
  } | null>(null);
  const [resetUser, setResetUser] = useState<User | null>(null);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const members = useQuery({
    ...listMembersOptions(),
    enabled: !!s?.managed && !!s?.organization && s.role === "admin",
  });
  const users = useQuery({
    ...listUsersOptions(),
    enabled: !!s?.managed && !!s?.platform_admin,
  });
  if (!s?.managed) return null;
  const admin = s.role === "admin" && !s.read_only;
  return (
    <div
      id="organization-access"
      ref={accessRef}
      tabIndex={-1}
      className="outline-none"
    >
      {s.organization && (
        <Section>
          <SectionHeader
            title="Organization"
            description="Roles and saved data belong to the selected organization."
          />
          <SectionBody>
            {admin ? (
              <ActionForm
                key={s.organization.id}
                action="Save organization name"
                fields={[
                  {
                    name: "name",
                    label: "Organization name",
                    value: s.organization.name,
                  },
                ]}
                run={(v) =>
                  renameOrganization({
                    body: { name: v.name },
                    headers: { "X-Spool-Action": "confirmed" },
                    throwOnError: true,
                  })
                }
              />
            ) : (
              <p>
                {s.organization.name} · {s.role} access
              </p>
            )}
            {s.platform_admin && !s.read_only && (
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => setConnectionOpen(true)}
              >
                Replace connection
              </Button>
            )}
          </SectionBody>
        </Section>
      )}
      {s.organization && s.role === "admin" && (
        <Section>
          <SectionHeader
            title="Organization members"
            description="Admins manage membership. Operators run queue and task actions. Viewers can read data."
          />
          <SectionBody>
            {members.isPending ? (
              <Loading />
            ) : members.error ? (
              <DataError
                error={members.error}
                retry={() => members.refetch()}
              />
            ) : (
              members.data?.data.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  confirm={setConfirmation}
                  disabled={!admin}
                />
              ))
            )}
            {admin && (
              <div className="mt-6">
                <h3 className="mb-3 font-semibold">Add member</h3>
                <ActionForm
                  action="Add member"
                  fields={[
                    { name: "username", label: "Member username" },
                    {
                      name: "password",
                      label: "New account password",
                      type: "password",
                      optional: true,
                      help: "Use 12–72 bytes for a new account. Leave empty to add an existing username; this never resets their password.",
                    },
                    { name: "role", label: "Organization role", roles: true },
                  ]}
                  run={(v) =>
                    addMember({
                      body: {
                        username: v.username,
                        password: v.password,
                        role: roles.parse(v.role),
                      },
                      headers: { "X-Spool-Action": "confirmed" },
                      throwOnError: true,
                    })
                  }
                />
              </div>
            )}
          </SectionBody>
        </Section>
      )}
      {s.platform_admin && (
        <Section>
          <SectionHeader
            title="Deployment accounts"
            description="Deployment administrators can access every organization. Administration changes require your current password."
          />
          <SectionBody>
            {users.isPending ? (
              <Loading />
            ) : users.error ? (
              <DataError error={users.error} retry={() => users.refetch()} />
            ) : (
              users.data?.data.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  actor={s.actor}
                  administration={(user, action) =>
                    setAdministration({ user, action })
                  }
                  confirm={setConfirmation}
                  reset={setResetUser}
                  disabled={s.read_only}
                />
              ))
            )}
          </SectionBody>
        </Section>
      )}
      {s.platform_admin && !s.read_only && (
        <Section>
          <SectionHeader
            title="Create organization"
            description="Connect another team’s Asynq Redis. Connections are managed by deployment administrators."
          />
          <SectionBody>
            <ActionForm
              fields={organizationFields}
              action="Create organization"
              run={(v) =>
                createOrganization({
                  body: {
                    name: v.name,
                    redis_url: v.redis_url,
                    prometheus_url: v.prometheus_url,
                  },
                  headers: { "X-Spool-Action": "confirmed" },
                  throwOnError: true,
                })
              }
            />
          </SectionBody>
        </Section>
      )}
      <Section>
        <SectionHeader
          title="Your password"
          description="Changing your password signs you out on every device."
        />
        <SectionBody>
          <ActionForm
            action="Change password"
            fields={[
              {
                name: "current_password",
                label: "Current password",
                type: "password",
              },
              {
                name: "password",
                label: "New password",
                type: "password",
                help: "Use 12–72 bytes.",
              },
            ]}
            run={(v) =>
              changePassword({
                body: {
                  current_password: v.current_password,
                  password: v.password,
                },
                headers: { "X-Spool-Action": "confirmed" },
                throwOnError: true,
              })
            }
            onSuccess={() => window.location.reload()}
          />
        </SectionBody>
      </Section>
      <ConfirmAction
        key={confirmation?.title ?? "closed"}
        finalFocus={accessRef}
        value={confirmation}
        close={() => setConfirmation(null)}
      />
      <OperationDialog
        kind="form"
        finalFocus={accessRef}
        open={!!administration}
        onOpenChange={(open) => {
          if (!open) setAdministration(null);
        }}
        title={
          administration?.action === "grant"
            ? `Make ${administration.user.username} a deployment administrator?`
            : administration?.action === "revoke"
              ? `Remove ${administration.user.username}’s deployment administration?`
              : `Transfer administration to ${administration?.user.username ?? "account"}?`
        }
        description={
          administration?.action === "transfer"
            ? "This account gains access to every organization and deployment account. You lose deployment administration. Existing membership roles are retained, and both accounts must sign in again."
            : administration?.action === "grant"
              ? "This account will access every organization, manage accounts and replace connections. Its existing sessions will be revoked."
              : "This account will keep its organization membership roles. Its existing sessions will be revoked. At least one active deployment administrator must remain."
        }
      >
        {administration && (
          <ActionForm
            key={`${administration.user.id}-${administration.action}`}
            fields={[
              {
                name: "current_password",
                label: "Your current password",
                type: "password",
              },
            ]}
            action={
              administration.action === "transfer"
                ? "Transfer administration"
                : administration.action === "grant"
                  ? "Make administrator"
                  : "Remove administrator"
            }
            run={(v) =>
              changeAdministration({
                path: { id: administration.user.id },
                body: {
                  action: administration.action,
                  current_password: v.current_password,
                  confirm: true,
                },
                headers: { "X-Spool-Action": "confirmed" },
                throwOnError: true,
              })
            }
            onSuccess={() => window.location.assign("/settings")}
          />
        )}
      </OperationDialog>
      <OperationDialog
        kind="form"
        open={!!resetUser}
        onOpenChange={(open) => {
          if (!open) setResetUser(null);
        }}
        title={`Reset ${resetUser?.username ?? "account"}’s password`}
        description="Set a new password and share it privately. Existing sessions will be revoked."
      >
        {resetUser && (
          <ActionForm
            action="Reset password"
            fields={[
              { name: "password", label: "New password", type: "password" },
            ]}
            run={(v) =>
              updateUser({
                path: { id: resetUser.id },
                body: { disabled: null, password: v.password },
                headers: { "X-Spool-Action": "confirmed" },
                throwOnError: true,
              })
            }
            onSuccess={() => setResetUser(null)}
          />
        )}
      </OperationDialog>
      <OperationDialog
        kind="form"
        open={connectionOpen}
        onOpenChange={setConnectionOpen}
        title="Replace organization connection"
        description="This replaces the entire connection. Existing credentials are never displayed. Changing the Redis destination clears existing schedule links. Historical samples remain associated with this organization."
      >
        <ActionForm
          fields={organizationFields.map((f) =>
            f.name === "name" ? { ...f, value: s.organization?.name } : f,
          )}
          action="Replace connection"
          run={(v) =>
            updateOrganizationConnection({
              body: {
                name: v.name,
                redis_url: v.redis_url,
                prometheus_url: v.prometheus_url,
              },
              headers: { "X-Spool-Action": "confirmed" },
              throwOnError: true,
            })
          }
          onSuccess={() => {
            window.location.assign("/settings");
          }}
        />
      </OperationDialog>
    </div>
  );
}

export function NoOrganizationScreen() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <BrandLogo height={32} />
      <h1 className="mt-6 text-2xl font-semibold">Choose an organization</h1>
      <p className="mt-2 mb-6 text-muted-foreground">
        Ask an administrator to add you if no organizations appear.
      </p>
      <OrganizationSwitcher />
      <div className="mt-6">
        <AccessSettings />
      </div>
      <Button
        variant="outline"
        onClick={async () => {
          await logout({
            body: { confirm: true },
            headers: { "X-Spool-Action": "confirmed" },
            throwOnError: true,
          });
          window.location.reload();
        }}
      >
        Sign out
      </Button>
    </main>
  );
}
