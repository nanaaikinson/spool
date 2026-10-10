import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Session } from "../api/generated/types.gen";
import { getDeploymentStatusOptions } from "../api/generated/@tanstack/react-query.gen";
import { DataError, Empty, Loading } from "../components/data-state";
import { RefreshButton } from "../components/info-tip";
import {
  Section,
  SectionBody,
  SectionHeader,
  StatusDot,
} from "../components/page";
import { Time } from "../components/time";
import { useSession } from "./session";

/** Only public deployment metadata belongs here; connections stay server-side. */
export function InstanceIdentity({ session }: { session?: Session }) {
  if (!session) return null;
  const name = session.instance_name || session.environment;
  return (
    <span
      className="grid min-w-0 text-left leading-tight"
      title={`${name} · ${session.environment}`}
    >
      <strong className="truncate text-xs font-medium">{name}</strong>
      {name !== session.environment && (
        <span className="truncate text-2xs text-muted-foreground">
          {session.environment}
        </span>
      )}
    </span>
  );
}

export function DeploymentHelp({
  session,
  account = false,
}: {
  session?: Session;
  account?: boolean;
}) {
  const hosted = session?.deployment_mode === "hosted";
  return (
    <span>
      {account ? "Forgot your password? " : "Need help? "}
      {session?.support_url ? (
        <a
          className="underline underline-offset-4"
          href={session.support_url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {hosted ? "Contact support" : "Contact your operator"}
        </a>
      ) : hosted ? (
        "Contact your hosting operator"
      ) : (
        "Ask whoever runs this deployment"
      )}
      .
      {account &&
        !hosted &&
        " If you installed Spool, use the account saved in your private installation configuration."}
    </span>
  );
}

export function EmptyQueues() {
  const session = useSession();
  return (
    <Empty title="No Asynq queues found">
      This Redis connection has no Asynq queues yet. A new environment may be
      empty; confirm that Spool uses the same Redis database as your workers.
      <Link to="/settings" className="mt-2 block underline underline-offset-4">
        Check connection status
      </Link>
      <span className="mt-2 block">
        <DeploymentHelp session={session.data} />
      </span>
    </Empty>
  );
}

export function ConnectionDiagnostics() {
  const session = useSession();
  const status = useQuery({
    ...getDeploymentStatusOptions(),
    refetchInterval: 30_000,
  });
  const metrics = status.data?.metrics;
  const services = status.data
    ? [
        {
          name: "Asynq Redis",
          state: status.data.redis.available ? "Connected" : "Unavailable",
          tone: status.data.redis.available ? "green" : "red",
          message: status.data.redis.message,
        },
        {
          name: "PostgreSQL",
          state: !status.data.database.configured
            ? "Not configured"
            : status.data.database.available
              ? "Connected"
              : "Unavailable",
          tone: status.data.database.available ? "green" : "amber",
          message: status.data.database.message,
        },
        {
          name: "Prometheus",
          state: !metrics?.configured
            ? "Not configured"
            : !metrics.available
              ? "Unavailable"
              : metrics.warming_up
                ? "Collecting first samples"
                : metrics.scrape_status === "up"
                  ? "Collecting"
                  : metrics.scrape_status === "down"
                    ? "Scrape failing"
                    : metrics.scrape_status === "pending"
                      ? "Awaiting first scrape"
                      : metrics.scrape_status === "missing"
                        ? "Target missing"
                        : "Scrape unverified",
          tone: metrics?.scrape_status === "up" ? "green" : "amber",
          message: metrics?.message,
        },
      ]
    : [];
  return (
    <Section>
      <SectionHeader
        title="Connection status"
        description="Live checks from this Spool instance. Credentials stay on the server."
        action={
          <RefreshButton
            onClick={() => status.refetch()}
            pending={status.isFetching}
          />
        }
      />
      {status.isPending ? (
        <Loading rows={3} />
      ) : status.error ? (
        <SectionBody>
          <DataError error={status.error} retry={() => status.refetch()} />
        </SectionBody>
      ) : (
        <SectionBody>
          <dl className="divide-y">
            {services.map((service) => (
              <div
                key={service.name}
                className="grid gap-1.5 py-3 first:pt-0 sm:grid-cols-[150px_1fr]"
              >
                <dt className="text-sm font-medium">{service.name}</dt>
                <dd className="min-w-0">
                  <span className="flex items-center gap-2 text-sm">
                    <StatusDot
                      tone={service.tone as "green" | "red" | "amber"}
                    />
                    {service.state}
                  </span>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {service.message}
                  </p>
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <DeploymentHelp session={session.data} />
            {status.data && (
              <span>
                Checked <Time value={status.data.checked_at} />
              </span>
            )}
          </div>
        </SectionBody>
      )}
    </Section>
  );
}
