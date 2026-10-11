import {
  Meter,
  PageHeader,
  PaginationBar,
  Section,
  SectionBody,
  SectionHeader,
  StatTile,
  StateBadge,
  StatusDot,
  cardX,
  statGrid,
  cardColumns,
} from "@/components/page";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination";
import { DialogFooter } from "@/components/ui/dialog";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Radio, Trash2 } from "lucide-react";
import {
  listServersOptions,
  listSchedulersOptions,
  listAuditOptions,
  listViewsOptions,
  deleteViewMutation,
  listViewsQueryKey,
  metricsHealthOptions,
} from "../api/generated/@tanstack/react-query.gen";
import { Button } from "../components/ui/button";
import { OperationDialog } from "../components/operation-dialog";
import { AlertDialogCancel } from "@/components/ui/alert-dialog";
import { DataError, Empty, Loading, Stale } from "../components/data-state";
import { cn, number, plural, versionLabel } from "@/lib/utils";
import { clock, useClock } from "../lib/time";
import { InfoTip, RefreshButton } from "../components/info-tip";
import { Time } from "../components/time";
import { HistoricalChart, LiveReadings, TimeRange } from "./charts";
import { useSession } from "./session";
import { ConnectionDiagnostics, DeploymentHelp } from "./deployment";
import { PeriodicTable } from "./schedules";
import { queryClient } from "./queries";
import { errorMessage } from "../api/client";
/** Column gap between paired cards; matches the vertical stack rhythm. */
export function WorkersPage() {
  const query = useQuery(listServersOptions());
  const now = useClock();
  return (
    <>
      <PageHeader
        title="Servers"
        info={
          <InfoTip label="About servers">
            Asynq servers register a heartbeat while they run; stopped servers
            drop out of this list. Priorities are per server: each one splits
            its worker slots across queues by weight, or drains them in order
            under strict priority.
          </InfoTip>
        }
        description="Running Asynq servers, how busy their worker slots are, and which queues each one pulls from."
        actions={
          <RefreshButton
            onClick={() => query.refetch()}
            pending={query.isFetching}
          />
        }
      />
      {query.isPending ? (
        <Loading />
      ) : query.error && !query.data ? (
        <DataError error={query.error} retry={() => query.refetch()} />
      ) : (
        query.data && (
          <>
            <Stale error={query.error} />
            {!query.data.data.length ? (
              <Section>
                <Empty title="No servers running">
                  Start an Asynq server for this Redis connection. Only servers
                  with a current heartbeat are listed.
                </Empty>
              </Section>
            ) : (
              <div className={cardColumns({ layout: "even" })}>
                {query.data.data.map((server) => {
                  const busy = server.workers.length;
                  const types = Object.entries(
                    server.workers.reduce<Record<string, number>>(
                      (counts, w) => ({
                        ...counts,
                        [w.task_type]: (counts[w.task_type] ?? 0) + 1,
                      }),
                      {},
                    ),
                  ).sort((a, b) => b[1] - a[1]);
                  const weights = Object.values(server.queues).reduce(
                    (a, b) => a + b,
                    0,
                  );
                  return (
                    <Section key={server.id}>
                      <SectionHeader
                        title={
                          <span className="font-mono">
                            {server.host}{" "}
                            <span className="text-muted-foreground text-xs">
                              PID {server.pid}
                            </span>
                          </span>
                        }
                        description={
                          <>
                            Up {clock(now - Date.parse(server.started))} ·{" "}
                            {server.strict_priority
                              ? "Strict priority"
                              : "Weighted priority"}
                          </>
                        }
                        action={<StateBadge state={server.status} />}
                      />
                      <SectionBody className="grid gap-4">
                        <div>
                          <div className="mb-2 flex justify-between text-sm text-muted-foreground">
                            <span>Worker slots</span>
                            <strong className="font-[550] text-foreground tabular-nums">
                              {busy} / {server.concurrency} busy
                            </strong>
                          </div>
                          <Meter
                            value={busy / Math.max(server.concurrency, 1)}
                            tone={
                              busy >= server.concurrency ? "amber" : "green"
                            }
                            size="md"
                          />
                          {types.length > 0 && (
                            <p className="mt-2 text-muted-foreground text-xs">
                              Running{" "}
                              {types
                                .map(([type, n]) => `${n}× ${type}`)
                                .join(", ")}
                            </p>
                          )}
                        </div>
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
                          {Object.entries(server.queues)
                            .sort((a, b) => b[1] - a[1])
                            .map(([queue, weight]) => (
                              <Link
                                key={queue}
                                to="/queues/$queue"
                                params={{ queue }}
                                className="grid gap-0.5 rounded-lg border px-2.5 py-2 hover:bg-hover"
                              >
                                <span className="font-mono">{queue}</span>
                                <span className="text-muted-foreground text-xs">
                                  {server.strict_priority
                                    ? `priority ${weight}`
                                    : `weight ${weight} · ${number((weight / Math.max(weights, 1)) * 100)}%`}
                                </span>
                              </Link>
                            ))}
                        </div>
                      </SectionBody>
                      <div
                        className={cn(
                          "flex items-center justify-between gap-3 border-t border-inset-border py-2.5",
                          cardX,
                        )}
                      >
                        <span className="truncate font-mono text-muted-foreground text-xs">
                          {server.id}
                        </span>
                        <Link
                          to="/live"
                          className="font-medium text-foreground text-xs"
                        >
                          Live activity
                        </Link>
                      </div>
                    </Section>
                  );
                })}
              </div>
            )}
          </>
        )
      )}
    </>
  );
}
export function SchedulersPage() {
  const query = useQuery(listSchedulersOptions());
  return (
    <>
      <PageHeader
        title="Periodic schedules"
        description="Cron entries registered by live Asynq schedulers. Each run enqueues a new task at the time shown."
        actions={
          <RefreshButton
            onClick={() => query.refetch()}
            pending={query.isFetching}
          />
        }
      />
      <Section>
        {query.isPending ? (
          <Loading />
        ) : query.error ? (
          <SectionBody>
            <DataError error={query.error} retry={() => query.refetch()} />
          </SectionBody>
        ) : !query.data?.data.length ? (
          <Empty title="No periodic schedules registered">
            Start an Asynq scheduler to see its cron entries here. One-off
            delayed tasks are on the Scheduled page.
          </Empty>
        ) : (
          <PeriodicTable data={query.data.data} />
        )}
      </Section>
      <Button
        variant="secondary"
        nativeButton={false}
        render={<Link to="/scheduled" />}
      >
        Inspect scheduled tasks
      </Button>
    </>
  );
}
const charts = [
  {
    metric: "depth",
    title: "Queue depth",
    description:
      "Tasks held in each queue. A line that keeps climbing means work arrives faster than workers finish it.",
  },
  {
    metric: "latency",
    title: "Queue latency",
    description:
      "How long the oldest pending task has waited. Spikes mean tasks sit idle before a worker picks them up.",
  },
  {
    metric: "processed",
    title: "Processing throughput",
    description:
      "Attempts finished per second, successful or not. A sudden drop often means stuck or missing workers.",
  },
  {
    metric: "failed",
    title: "Failure rate",
    description:
      "Failed attempts per second. Compare with throughput to see what share of work is failing.",
  },
  {
    metric: "retry",
    title: "Tasks awaiting retry",
    description:
      "Failed tasks scheduled for another attempt. Growth here usually tracks a struggling dependency.",
  },
  {
    metric: "archived",
    title: "Archived tasks",
    description:
      "Tasks that used up their retries. These will not run again unless someone retries them.",
  },
] as const;
export function MetricsPage() {
  const health = useQuery(metricsHealthOptions());
  const search = useSearch({ from: "__root__" });
  const navigate = useNavigate();
  const live = search.live;
  return (
    <>
      <PageHeader
        title="Metrics"
        info={
          <InfoTip label="Reading these metrics">
            Throughput counts both successful and failed attempts. Queue depth
            includes retained completed tasks. Asynq&apos;s &ldquo;tasks
            enqueued&rdquo; series are current counts per state, not running
            totals. Live mode refreshes every 15 seconds and keeps the window
            ending at now.
          </InfoTip>
        }
        description="Trends for every queue over time, from Asynq’s Prometheus metrics. Other pages show what’s true right now; this one shows how you got here. Tell a brief spike from a backlog that has grown for hours, spot latency creeping past your targets, and confirm a fix brought failures down."
        actions={
          <>
            <Button
              variant={live ? "default" : "secondary"}
              aria-pressed={live}
              onClick={() =>
                navigate({
                  to: ".",
                  search: (old) => ({
                    ...old,
                    live: !old.live,
                    // Live mode is about the last few minutes.
                    range: old.live ? old.range : "15m",
                  }),
                })
              }
            >
              {live ? <StatusDot tone="green" pulse /> : <Radio size={14} />}
              {live ? "Live · every 15s" : "Go live"}
            </Button>
            <TimeRange />
          </>
        }
      />
      {health.error && (
        <DataError error={health.error} retry={() => health.refetch()} />
      )}
      <LiveReadings live={live} />
      <div className={cardColumns()}>
        {charts.map((c) => (
          <HistoricalChart key={c.metric} {...c} live={live} />
        ))}
      </div>
    </>
  );
}
const auditPageSize = 25;
export function SettingsPage() {
  const session = useSession();
  // Saved views and the audit log live in the SQLite database.
  const noDatabase = session.data?.read_only_reason === "no_database";
  const [auditPage, setAuditPage] = useState(1);
  const audit = useQuery({
    ...listAuditOptions({ query: { page: auditPage, limit: auditPageSize } }),
    enabled: !noDatabase,
    placeholderData: keepPreviousData,
  });
  const auditPages = Math.max(
    1,
    Math.ceil((audit.data?.total ?? 0) / auditPageSize),
  );
  const views = useQuery({ ...listViewsOptions(), enabled: !noDatabase });
  const [deleteID, setDeleteID] = useState<string | null>(null);
  const remove = useMutation({
    ...deleteViewMutation(),
    onSuccess: () => {
      setDeleteID(null);
      queryClient.invalidateQueries({ queryKey: listViewsQueryKey() });
      toast.success("Saved view deleted.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <PageHeader
        title="Settings & audit"
        description="Your environment and access, saved task filters, and the log of queue and task actions."
      />
      <div className={statGrid()}>
        <StatTile
          label="Instance"
          value={
            session.data?.instance_name || session.data?.environment || "—"
          }
          detail={`${session.data?.environment ?? "—"} · Spool ${session.data ? versionLabel(session.data.version) : "—"}`}
        />
        <StatTile
          label="Signed in as"
          value={session.data?.actor || "—"}
          detail={
            session.data?.auth_required
              ? "Password sign-in"
              : "Local development, no sign-in"
          }
        />
        <StatTile
          label="Access"
          value={session.data?.role === "admin" ? "Full access" : "Read only"}
          detail={
            noDatabase
              ? "No database configured"
              : session.data?.read_only_reason === "configured"
                ? "Read-only mode is on"
                : session.data?.role === "admin"
                  ? "Can pause queues and act on tasks"
                  : "Can view, but not change"
          }
        />
        <StatTile
          label={
            <span className="flex flex-wrap items-center gap-2">
              Configuration
              <InfoTip label="About configuration">
                Connections and accounts are managed by this instance’s
                operator. Connection credentials stay on the server.
              </InfoTip>
            </span>
          }
          value="Self-hosted"
          detail={<DeploymentHelp session={session.data} />}
        />
      </div>
      <ConnectionDiagnostics />
      <Section>
        <SectionHeader
          title="Saved views"
          action={
            <span className="text-muted-foreground text-xs">
              Your last 100 views
            </span>
          }
        />
        {noDatabase ? (
          <Empty title="Saved views need a database">
            Ask the operator to configure persistent storage to save filtered
            task lists.
          </Empty>
        ) : views.isPending ? (
          <Loading rows={2} />
        ) : views.error ? (
          <SectionBody>
            <DataError error={views.error} retry={() => views.refetch()} />
          </SectionBody>
        ) : !views.data?.data.length ? (
          <Empty title="No saved views">
            Filter any task list, then choose Save view.
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>View</TableHead>
                <TableHead>Saved</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {views.data.data.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>
                    <a className="font-medium text-foreground" href={v.path}>
                      {v.name}
                    </a>
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground text-xs">
                    {v.path}
                  </TableCell>
                  <TableCell>
                    <Time value={v.created_at} />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={session.data?.role !== "admin"}
                      onClick={() => setDeleteID(v.id)}
                      aria-label={`Delete ${v.name}`}
                    >
                      <Trash2 size={15} />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
      <Section>
        <SectionHeader
          title="Audit log"
          info={
            <InfoTip label="About the audit log">
              Every queue and task action is recorded before it runs. Pending
              means the outcome is unknown, for example if the process stopped
              before it finished. The newest entries are shown first.
            </InfoTip>
          }
          action={
            <RefreshButton
              onClick={() => audit.refetch()}
              pending={audit.isFetching}
            />
          }
        />
        {noDatabase ? (
          <Empty title="The audit log needs a database">
            Ask the operator to configure persistent storage to record queue and
            task actions.
          </Empty>
        ) : audit.isPending ? (
          <Loading rows={3} />
        ) : audit.error ? (
          <SectionBody>
            <DataError error={audit.error} retry={() => audit.refetch()} />
          </SectionBody>
        ) : !audit.data?.data.length ? (
          <Empty title="No actions yet">
            Queue and task actions are recorded here before they run.
          </Empty>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Queue</TableHead>
                  <TableHead>Task ID</TableHead>
                  <TableHead>Outcome</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audit.data.data.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Time value={a.created_at} />
                    </TableCell>
                    <TableCell>{a.actor}</TableCell>
                    <TableCell>{a.action}</TableCell>
                    <TableCell className="font-mono">{a.queue}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {a.task_id || "—"}
                    </TableCell>
                    <TableCell>
                      <StateBadge state={a.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PaginationBar>
              <span className="text-xs text-muted-foreground">
                {number((auditPage - 1) * auditPageSize + 1)}–
                {number(
                  (auditPage - 1) * auditPageSize + audit.data.data.length,
                )}{" "}
                of {plural(audit.data.total, "entry", "entries")}
              </span>
              <Pagination className="m-0 w-auto" aria-label="Audit log pages">
                <PaginationContent className="gap-2">
                  <PaginationItem>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={auditPage <= 1 || audit.isFetching}
                      onClick={() => setAuditPage((p) => p - 1)}
                    >
                      <ChevronLeft />
                      Newer
                    </Button>
                  </PaginationItem>
                  <PaginationItem>
                    <span className="px-1 text-xs text-muted-foreground tabular-nums">
                      Page {number(auditPage)} of {number(auditPages)}
                    </span>
                  </PaginationItem>
                  <PaginationItem>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={auditPage >= auditPages || audit.isFetching}
                      onClick={() => setAuditPage((p) => p + 1)}
                    >
                      Older
                      <ChevronRight />
                    </Button>
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </PaginationBar>
          </>
        )}
      </Section>
      <OperationDialog
        open={!!deleteID}
        onOpenChange={(open) => !open && !remove.isPending && setDeleteID(null)}
        title="Delete saved view?"
        description="Only the saved filters are removed. Tasks aren’t affected."
      >
        <DialogFooter className="mt-6">
          <AlertDialogCancel
            variant="secondary"
            onClick={() => setDeleteID(null)}
          >
            Cancel
          </AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() =>
              deleteID &&
              remove.mutate({
                path: { id: deleteID },
                body: { confirm: true },
                headers: { "X-Spool-Action": "confirmed" },
              })
            }
          >
            Delete view
          </Button>
        </DialogFooter>
      </OperationDialog>
    </>
  );
}
