import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DialogFooter } from "@/components/ui/dialog";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw, Sun, Moon, Trash2 } from "lucide-react";
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
import { date, number } from "../lib/utils";
import { useTheme } from "../app/theme";
import { HistoricalChart, TimeRange } from "./charts";
import { useSession } from "./session";
import { queryClient } from "./queries";
import { errorMessage } from "../api/client";
export function WorkersPage() {
  const query = useQuery(listServersOptions());
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Workers & servers</h1>
          <p>
            Live Asynq servers, configured capacity, and tasks currently
            processing.
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={query.isFetching}
          onClick={() => query.refetch()}
        >
          <RefreshCw size={14} />
          Refresh
        </Button>
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
                <Empty title="No live servers registered">
                  Start an Asynq server for this Redis connection. Inspector
                  returns currently registered servers; dead-server history is
                  not retained here.
                </Empty>
              </Card>
            ) : (
              query.data.data.map((server) => (
                <Card className="section" key={server.id}>
                  <CardHeader className="section-heading">
                    <div>
                      <h2 className="mono">
                        {server.host}{" "}
                        <span className="muted small">PID {server.pid}</span>
                      </h2>
                      <p className="mono muted small">{server.id}</p>
                    </div>
                    <Badge state={server.status} />
                  </CardHeader>
                  <CardContent className="section-body">
                    <div className="toolbar">
                      <span>
                        {server.workers.length} active / {server.concurrency}{" "}
                        concurrency
                      </span>
                      <span className="muted small">
                        Started {date(server.started)}
                      </span>
                      <span className="muted small">
                        {server.strict_priority
                          ? "Strict priority"
                          : "Weighted priority"}
                      </span>
                    </div>
                    <div className="toolbar" style={{ marginTop: 10 }}>
                      {Object.entries(server.queues).map(([queue, weight]) => (
                        <Link
                          key={queue}
                          to="/queues/$queue"
                          params={{ queue }}
                        >
                          <span className="badge mono">
                            {queue} · weight {weight}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </CardContent>
                  {!server.workers.length ? (
                    <Empty title="No tasks currently processing">
                      This server has no active worker tasks in the current
                      snapshot.
                    </Empty>
                  ) : (
                    <div className="table-wrap">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Task</TableHead>
                            <TableHead>Queue</TableHead>
                            <TableHead>Started processing</TableHead>
                            <TableHead>Deadline</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {server.workers.map((worker) => (
                            <TableRow key={`${worker.queue}/${worker.task_id}`}>
                              <TableCell>
                                <Link
                                  className="mono table-link"
                                  to="/tasks/$queue/$id"
                                  params={{
                                    queue: worker.queue,
                                    id: worker.task_id,
                                  }}
                                >
                                  {worker.task_type}
                                </Link>
                                <div className="mono muted small">
                                  {worker.task_id}
                                </div>
                              </TableCell>
                              <TableCell className="mono">
                                {worker.queue}
                              </TableCell>
                              <TableCell>{date(worker.started)}</TableCell>
                              <TableCell>{date(worker.deadline)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </Card>
              ))
            )}
            <Alert role="note" className="notice">
              <AlertDescription>
                Priorities are server-specific. Asynq does not expose public
                heartbeat timestamps through Inspector, so this view does not
                infer stale or dead workers.
              </AlertDescription>
            </Alert>
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
          <p>Entries registered by live Asynq schedulers.</p>
        </div>
        <Button variant="secondary" onClick={() => query.refetch()}>
          <RefreshCw size={14} />
          Refresh
        </Button>
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
            Start an Asynq scheduler to inspect its cron entries. One-off
            scheduled tasks are available in the Scheduled view.
          </Empty>
        ) : (
          <div className="table-wrap">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entry ID</TableHead>
                  <TableHead>Task type</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Next enqueue</TableHead>
                  <TableHead>Previous enqueue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.data.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="mono">{s.id}</TableCell>
                    <TableCell className="mono">{s.type}</TableCell>
                    <TableCell className="mono">{s.spec}</TableCell>
                    <TableCell>{date(s.next)}</TableCell>
                    <TableCell>{date(s.previous)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
      <Button variant="secondary" asChild>
        <Link to="/scheduled">Inspect scheduled tasks</Link>
      </Button>
    </>
  );
}
export function MetricsPage() {
  const health = useQuery(metricsHealthOptions());
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Metrics</h1>
          <p>Historical signals from the native Asynq Prometheus collector.</p>
        </div>
        <TimeRange />
      </div>
      {health.error && (
        <DataError error={health.error} retry={() => health.refetch()} />
      )}
      <div className="two-columns">
        <HistoricalChart metric="depth" title="Queue depth" />
        <HistoricalChart metric="latency" title="Queue latency" />
        <HistoricalChart metric="processed" title="Processing throughput" />
        <HistoricalChart metric="failed" title="Failure rate" />
        <HistoricalChart metric="retry" title="Tasks awaiting retry" />
        <HistoricalChart metric="archived" title="Archived tasks" />
      </div>
      <Alert role="note" className="notice">
        <AlertDescription>
          Processed rate counts both successful and failed attempts. Queue depth
          includes retained completed tasks. Native “tasks enqueued” series are
          state gauges, not cumulative enqueue counters. Application HTTP
          metrics use the spool_ prefix.
        </AlertDescription>
      </Alert>
    </>
  );
}
export function SettingsPage() {
  const { theme, toggle } = useTheme();
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
            Display preferences, saved operational views, and administrative
            actions.
          </p>
        </div>
      </div>
      <div className="two-columns">
        <Card className="section">
          <CardHeader className="section-heading">
            <CardTitle>
              <h2>Appearance</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="section-body">
            <div
              className="toolbar"
              style={{ justifyContent: "space-between" }}
            >
              <div>
                <p>{theme === "dark" ? "Dark" : "Light"} mode</p>
                <p className="muted small">
                  Dark is the first-visit default. Your choice is saved on this
                  browser.
                </p>
              </div>
              <Button variant="secondary" onClick={toggle}>
                {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
                Switch to {theme === "dark" ? "light" : "dark"}
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card className="section">
          <CardHeader className="section-heading">
            <CardTitle>
              <h2>Environment</h2>
            </CardTitle>
            <Badge
              state={session.data?.role === "admin" ? "active" : "paused"}
            />
          </CardHeader>
          <CardContent className="section-body">
            <dl className="metadata">
              <dt>Name</dt>
              <dd>{session.data?.environment}</dd>
              <dt>Account</dt>
              <dd>{session.data?.actor}</dd>
              <dt>Access</dt>
              <dd>
                {session.data?.role === "admin" ? "Operations" : "Read only"}
              </dd>
              <dt>Authentication</dt>
              <dd>
                {session.data?.auth_required ? "Enabled" : "Local development"}
              </dd>
            </dl>
            <Alert role="note" className="notice">
              <AlertDescription>
                Connections and credentials are configured exclusively on the
                server.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
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
            Apply filters in the task explorer, then choose Save view.
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
                    <TableCell>{date(v.created_at)}</TableCell>
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
            <h2>Administrative audit</h2>
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => audit.refetch()}>
            <RefreshCw size={14} />
            Refresh
          </Button>
        </CardHeader>
        {audit.isPending ? (
          <Loading rows={3} />
        ) : audit.error ? (
          <CardContent className="section-body">
            <DataError error={audit.error} retry={() => audit.refetch()} />
          </CardContent>
        ) : !audit.data?.data.length ? (
          <Empty title="No administrative actions yet">
            Queue and task operations are recorded here before they run.
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
                    <TableCell>{date(a.created_at)}</TableCell>
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
        <Alert role="note" className="filter-info">
          <AlertDescription>
            Showing up to {number(audit.data?.data.length ?? 0)} recent intents.
            Pending means outcome unknown, including a process crash before
            finalization.
          </AlertDescription>
        </Alert>
      </Card>
      <OperationDialog
        open={!!deleteID}
        onOpenChange={(open) => !open && !remove.isPending && setDeleteID(null)}
        title="Delete saved view?"
        description="This removes the bookmark from your account."
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
