import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { DialogFooter } from "@/components/ui/dialog";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Radio, Trash2 } from "lucide-react";
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
import {
  Badge,
  DataError,
  Empty,
  Loading,
  Stale,
} from "../components/data-state";
import { number } from "../lib/utils";
import { clock, useClock } from "../lib/time";
import { InfoTip, RefreshButton } from "../components/info-tip";
import { Time } from "../components/time";
import { HistoricalChart, LiveReadings, TimeRange } from "./charts";
import { useSession } from "./session";
import { PeriodicTable } from "./schedules";
import { queryClient } from "./queries";
import { errorMessage } from "../api/client";
export function WorkersPage() {
  const query = useQuery(listServersOptions());
  const now = useClock();
  return (
    <>
      <div className="page-heading">
        <div>
          <h1 className="title-row">
            Servers
            <InfoTip label="About servers">
              Asynq servers register a heartbeat while they run; stopped servers
              drop out of this list. Priorities are per server: each one splits
              its worker slots across queues by weight, or drains them in order
              under strict priority.
            </InfoTip>
          </h1>
          <p>
            Running Asynq servers, how busy their worker slots are, and which
            queues each one pulls from.
          </p>
        </div>
        <RefreshButton
          onClick={() => query.refetch()}
          pending={query.isFetching}
        />
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.error && !query.data ? (
        <DataError error={query.error} retry={() => query.refetch()} />
      ) : (
        query.data && (
          <>
            <Stale error={query.error} />
            {!query.data.data.length ? (
              <Card className="section">
                <Empty title="No servers running">
                  Start an Asynq server for this Redis connection. Only servers
                  with a current heartbeat are listed.
                </Empty>
              </Card>
            ) : (
              <div className="server-grid">
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
                    <Card className="section server-card" key={server.id}>
                      <CardHeader className="section-heading">
                        <div>
                          <h2 className="mono">
                            {server.host}{" "}
                            <span className="muted small">
                              PID {server.pid}
                            </span>
                          </h2>
                          <p className="muted small">
                            Up {clock(now - Date.parse(server.started))} ·{" "}
                            {server.strict_priority
                              ? "Strict priority"
                              : "Weighted priority"}
                          </p>
                        </div>
                        <Badge state={server.status} />
                      </CardHeader>
                      <CardContent className="section-body server-body">
                        <div>
                          <div className="server-slots-label">
                            <span>Worker slots</span>
                            <strong className="tabular">
                              {busy} / {server.concurrency} busy
                            </strong>
                          </div>
                          <div className="deadline-meter server-slots">
                            <span
                              data-tone={
                                busy >= server.concurrency ? "amber" : "green"
                              }
                              style={{
                                width: `${(busy / Math.max(server.concurrency, 1)) * 100}%`,
                              }}
                            />
                          </div>
                          {types.length > 0 && (
                            <p className="muted small server-running">
                              Running{" "}
                              {types
                                .map(([type, n]) => `${n}× ${type}`)
                                .join(", ")}
                            </p>
                          )}
                        </div>
                        <div className="server-queues">
                          {Object.entries(server.queues)
                            .sort((a, b) => b[1] - a[1])
                            .map(([queue, weight]) => (
                              <Link
                                key={queue}
                                to="/queues/$queue"
                                params={{ queue }}
                                className="server-queue"
                              >
                                <span className="mono">{queue}</span>
                                <span className="muted small">
                                  {server.strict_priority
                                    ? `priority ${weight}`
                                    : `weight ${weight} · ${number((weight / Math.max(weights, 1)) * 100)}%`}
                                </span>
                              </Link>
                            ))}
                        </div>
                      </CardContent>
                      <div className="server-footer">
                        <span className="mono muted small">{server.id}</span>
                        <Link to="/live" className="table-link small">
                          Live activity
                        </Link>
                      </div>
                    </Card>
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
      <div className="page-heading">
        <div>
          <h1>Periodic schedules</h1>
          <p>
            Cron entries registered by live Asynq schedulers. Each run enqueues
            a new task at the time shown.
          </p>
        </div>
        <RefreshButton
          onClick={() => query.refetch()}
          pending={query.isFetching}
        />
      </div>
      <Card className="section">
        {query.isPending ? (
          <Loading />
        ) : query.error ? (
          <CardContent className="section-body">
            <DataError error={query.error} retry={() => query.refetch()} />
          </CardContent>
        ) : !query.data?.data.length ? (
          <Empty title="No periodic schedules registered">
            Start an Asynq scheduler to see its cron entries here. One-off
            delayed tasks are on the Scheduled page.
          </Empty>
        ) : (
          <PeriodicTable data={query.data.data} />
        )}
      </Card>
      <Button variant="secondary" asChild>
        <Link to="/scheduled">Inspect scheduled tasks</Link>
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
      <div className="page-heading">
        <div>
          <h1 className="title-row">
            Metrics
            <InfoTip label="Reading these metrics">
              Throughput counts both successful and failed attempts. Queue depth
              includes retained completed tasks. Asynq&apos;s &ldquo;tasks
              enqueued&rdquo; series are current counts per state, not running
              totals. Live mode refreshes every 15 seconds and keeps the window
              ending at now.
            </InfoTip>
          </h1>
          <p>
            Trends for every queue over time, from Asynq’s Prometheus metrics.
            Other pages show what’s true right now; this one shows how you got
            here. Tell a brief spike from a backlog that has grown for hours,
            spot latency creeping past your targets, and confirm a fix brought
            failures down.
          </p>
        </div>
        <div className="heading-actions">
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
            {live ? (
              <span className="live-dot" data-live="true" />
            ) : (
              <Radio size={14} />
            )}
            {live ? "Live · every 15s" : "Go live"}
          </Button>
          <TimeRange />
        </div>
      </div>
      {health.error && (
        <DataError error={health.error} retry={() => health.refetch()} />
      )}
      <LiveReadings live={live} />
      <div className="two-columns metric-charts">
        {charts.map((c) => (
          <HistoricalChart key={c.metric} {...c} live={live} />
        ))}
      </div>
    </>
  );
}
export function SettingsPage() {
  const session = useSession();
  const audit = useQuery(listAuditOptions());
  const views = useQuery(listViewsOptions());
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
      <div className="page-heading">
        <div>
          <h1>Settings & audit</h1>
          <p>
            Your environment and access, saved task filters, and the log of
            queue and task actions.
          </p>
        </div>
      </div>
      <div className="live-stats env-stats">
        <div className="live-stat">
          <span>Environment</span>
          <strong>{session.data?.environment ?? "—"}</strong>
          <small>Spool v{session.data?.version ?? "—"}</small>
        </div>
        <div className="live-stat">
          <span>Signed in as</span>
          <strong>{session.data?.actor || "—"}</strong>
          <small>
            {session.data?.auth_required
              ? "Password sign-in"
              : "Local development, no sign-in"}
          </small>
        </div>
        <div className="live-stat">
          <span>Access</span>
          <strong>
            {session.data?.role === "admin" ? "Full access" : "Read only"}
          </strong>
          <small>
            {session.data?.role === "admin"
              ? "Can pause queues and act on tasks"
              : "Can view, but not change"}
          </small>
        </div>
        <div className="live-stat">
          <span className="title-row">
            Configuration
            <InfoTip label="About configuration">
              Redis, Prometheus, credentials and the session key are set by
              environment variables on the server. Nothing here can change them.
            </InfoTip>
          </span>
          <strong>Server-side</strong>
          <small>Set through environment variables</small>
        </div>
      </div>
      <Card className="section">
        <CardHeader className="section-heading">
          <CardTitle>
            <h2>Saved views</h2>
          </CardTitle>
          <span className="muted small">Your last 100 views</span>
        </CardHeader>
        {views.isPending ? (
          <Loading rows={2} />
        ) : views.error ? (
          <CardContent className="section-body">
            <DataError error={views.error} retry={() => views.refetch()} />
          </CardContent>
        ) : !views.data?.data.length ? (
          <Empty title="No saved views">
            Filter any task list, then choose Save view.
          </Empty>
        ) : (
          <div className="table-wrap">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>View</TableHead>
                  <TableHead>Saved</TableHead>
                  <TableHead>
                    <span className="screen-reader">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {views.data.data.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>
                      <a className="table-link" href={v.path}>
                        {v.name}
                      </a>
                    </TableCell>
                    <TableCell className="mono muted small">{v.path}</TableCell>
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
          </div>
        )}
      </Card>
      <Card className="section">
        <CardHeader className="section-heading">
          <CardTitle>
            <h2 className="title-row">
              Audit log
              <InfoTip label="About the audit log">
                Every queue and task action is recorded before it runs. Pending
                means the outcome is unknown, for example if the process stopped
                before it finished. The newest 100 entries are shown.
              </InfoTip>
            </h2>
          </CardTitle>
          <RefreshButton
            onClick={() => audit.refetch()}
            pending={audit.isFetching}
          />
        </CardHeader>
        {audit.isPending ? (
          <Loading rows={3} />
        ) : audit.error ? (
          <CardContent className="section-body">
            <DataError error={audit.error} retry={() => audit.refetch()} />
          </CardContent>
        ) : !audit.data?.data.length ? (
          <Empty title="No actions yet">
            Queue and task actions are recorded here before they run.
          </Empty>
        ) : (
          <div className="table-wrap">
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
                    <TableCell className="mono">{a.queue}</TableCell>
                    <TableCell className="mono small">
                      {a.task_id || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge state={a.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
      <OperationDialog
        open={!!deleteID}
        onOpenChange={(open) => !open && !remove.isPending && setDeleteID(null)}
        title="Delete saved view?"
        description="Only the saved filters are removed. Tasks aren’t affected."
      >
        <DialogFooter className="dialog-actions">
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
