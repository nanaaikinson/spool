import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
} from "@/components/ui/input-group";
import { Badge as UiBadge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DialogFooter } from "@/components/ui/dialog";
import type { Options } from "../api/generated/sdk.gen";
import { useMemo, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_text,
  sortFn_alphanumeric,
  tableFeatures,
  useTable,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  RefreshCw,
  Pause,
  Play,
  Layers,
  Activity,
  CircleX,
  Cpu,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import type { Queue, PauseQueueData } from "../api/generated/types.gen";
import {
  getOverviewOptions,
  getQueueOptions,
  listQueuesOptions,
  listTasksOptions,
  pauseQueueMutation,
  resumeQueueMutation,
} from "../api/generated/@tanstack/react-query.gen";
import { errorMessage } from "../api/client";
import {
  Badge,
  DataError,
  Empty,
  Loading,
  Stale,
} from "../components/data-state";
import { Button } from "../components/ui/button";
import { OperationDialog } from "../components/operation-dialog";
import { AlertDialogCancel } from "@/components/ui/alert-dialog";
import { SnapshotBar, SummaryCard } from "../components/summary-card";
import { number, duration, date } from "../lib/utils";
import { HistoricalChart, TimeRange } from "./charts";
import { invalidateOperational } from "./queries";
import { useSession } from "./session";
import { TasksPage } from "./tasks";
const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { text: sortFn_text, alphanumeric: sortFn_alphanumeric },
});
const helper = createColumnHelper<typeof features, Queue>();
const states = [
  "pending",
  "active",
  "scheduled",
  "retry",
  "archived",
  "completed",
  "aggregating",
] as const;
export function Distribution({ queue }: { queue: Queue }) {
  const total = states.reduce((n, s) => n + queue[s], 0);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          tabIndex={0}
          className="distribution"
          aria-label={states.map((s) => `${queue[s]} ${s}`).join(", ")}
        >
          {states.map(
            (s) =>
              queue[s] > 0 && (
                <span
                  key={s}
                  className={s}
                  style={{ width: `${(queue[s] / Math.max(total, 1)) * 100}%` }}
                />
              ),
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent>
        {states.map((s) => `${number(queue[s])} ${s}`).join(" · ")}
      </TooltipContent>
    </Tooltip>
  );
}
const columns = helper.columns([
  helper.accessor("name", {
    header: "Queue",
    cell: ({ row }) => (
      <Link
        className="table-link mono"
        to="/queues/$queue"
        params={{ queue: row.original.name }}
      >
        {row.original.name}
      </Link>
    ),
  }),
  helper.accessor((q) => (q.paused ? "paused" : "running"), {
    id: "state",
    header: "State",
    cell: ({ row }) => (
      <Badge state={row.original.paused ? "paused" : "running"} />
    ),
  }),
  ...(["pending", "active", "scheduled", "retry", "archived"] as const).map(
    (s) =>
      helper.accessor(s, {
        header: s[0].toUpperCase() + s.slice(1),
        cell: ({ row }) => (
          <Link
            to="/tasks"
            search={{ queue: row.original.name, state: s }}
            className={row.original[s] > 0 ? "table-link" : ""}
          >
            {number(row.original[s])}
          </Link>
        ),
      }),
  ),
  helper.accessor("processed", {
    header: "Processed today",
    cell: ({ row }) => number(row.original.processed),
  }),
  helper.accessor("failed", {
    header: "Failed today",
    cell: ({ row }) => (
      <span className={row.original.failed ? "danger" : ""}>
        {number(row.original.failed)}
      </span>
    ),
  }),
  helper.accessor("latency_seconds", {
    header: "Latency",
    cell: ({ row }) => (
      <span className="mono">{duration(row.original.latency_seconds)}</span>
    ),
  }),
  helper.display({
    id: "distribution",
    header: "Task distribution",
    cell: ({ row }) => <Distribution queue={row.original} />,
  }),
]);
export function QueueTable({ data }: { data: Queue[] }) {
  const search = useSearch({ from: "__root__" });
  const navigate = useNavigate();
  const filtered = useMemo(
    () =>
      data.filter(
        (q) =>
          q.name.toLowerCase().includes(search.q.toLowerCase()) &&
          (search.queue_status === "all" ||
            (search.queue_status === "running" && !q.paused) ||
            (search.queue_status === "attention" &&
              (q.retry > 0 || q.archived > 0)) ||
            (search.queue_status === "paused" && q.paused)),
      ),
    [data, search.q, search.queue_status],
  );
  const sorting: SortingState = useMemo(
    () => [{ id: search.sort, desc: search.desc }],
    [search.sort, search.desc],
  );
  const table = useTable({
    features,
    columns,
    data: filtered,
    state: { sorting },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      navigate({
        to: ".",
        search: (old) => ({
          ...old,
          sort: next[0]?.id ?? "name",
          desc: next[0]?.desc ?? false,
        }),
      });
    },
    getRowId: (q) => q.name,
    enableSortingRemoval: false,
  });
  if (!data.length)
    return (
      <Empty title="No queues yet">
        Enqueue tasks in your Asynq application or start the demo worker to
        create traffic.
      </Empty>
    );
  return (
    <>
      <ToggleGroup
        type="single"
        value={search.queue_status}
        onValueChange={(value) => {
          if (value)
            navigate({
              to: ".",
              search: (old) => ({
                ...old,
                queue_status: value as typeof search.queue_status,
              }),
            });
        }}
        className="table-tabs"
        aria-label="Queue status"
      >
        {(
          [
            { value: "all", label: "All", count: data.length },
            {
              value: "running",
              label: "Running",
              count: data.filter((q) => !q.paused).length,
            },
            {
              value: "attention",
              label: "With failures",
              count: data.filter((q) => q.retry > 0 || q.archived > 0).length,
            },
            {
              value: "paused",
              label: "Paused",
              count: data.filter((q) => q.paused).length,
            },
          ] as const
        ).map((tab) => (
          <ToggleGroupItem
            value={tab.value}
            key={tab.value}
            type="button"
            className="table-tab"
          >
            {tab.label}
            <UiBadge className="tab-count">{number(tab.count)}</UiBadge>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="filters">
        <InputGroup className="queue-search">
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search queues"
            type="search"
            placeholder="Search queues…"
            value={search.q}
            onChange={(e) =>
              navigate({
                to: ".",
                search: (old) => ({ ...old, q: e.target.value }),
              })
            }
          />
        </InputGroup>
        <span className="muted small">{filtered.length} queues</span>
      </div>
      {!filtered.length ? (
        <Empty title="No matching queues">
          Change or clear the queue search.
        </Empty>
      ) : (
        <div className="table-wrap">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id}>
                  {group.headers.map((h) => (
                    <TableHead
                      key={h.id}
                      aria-sort={
                        h.column.getIsSorted() === "asc"
                          ? "ascending"
                          : h.column.getIsSorted() === "desc"
                            ? "descending"
                            : undefined
                      }
                    >
                      {h.column.getCanSort() ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="sortable"
                          onClick={h.column.getToggleSortingHandler()}
                        >
                          <table.FlexRender header={h} />
                          {h.column.getIsSorted() === "desc" ? (
                            <ArrowDown size={12} />
                          ) : h.column.getIsSorted() === "asc" ? (
                            <ArrowUp size={12} />
                          ) : null}
                        </Button>
                      ) : (
                        <table.FlexRender header={h} />
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
function Stats({
  queues,
  workers,
  servers,
}: {
  queues: Queue[];
  workers?: number;
  servers?: number;
}) {
  const sum = (
    key: "pending" | "active" | "retry" | "archived" | "processed" | "failed",
  ) => queues.reduce((n, q) => n + q[key], 0);
  const processed = sum("processed");
  const failed = sum("failed");
  const succeeded = Math.max(0, processed - failed);
  const paused = queues.filter((q) => q.paused).length;
  const attention = queues.filter(
    (q) => !q.paused && (q.retry > 0 || q.archived > 0),
  ).length;
  const clear = queues.length - paused - attention;
  return (
    <div className="summary-grid">
      <SummaryCard
        icon={<Layers size={18} />}
        label="Running queues"
        note={`${number(paused)} paused`}
        value={
          <>
            {number(queues.length - paused)}{" "}
            <small>of {number(queues.length)}</small>
          </>
        }
      >
        <div className="queue-ticks" aria-hidden="true">
          {queues.slice(0, 40).map((q) => (
            <i
              key={q.name}
              style={{
                background: `var(--${q.paused ? "purple" : q.retry > 0 || q.archived > 0 ? "red" : "green"})`,
              }}
            />
          ))}
        </div>
        <div className="snapshot-legend">
          <span>
            <i style={{ background: "var(--green)" }} />
            {number(clear)} clear
          </span>
          <span>
            <i style={{ background: "var(--red)" }} />
            {number(attention)} with failures
          </span>
          <span>
            <i style={{ background: "var(--purple)" }} />
            {number(paused)} paused
          </span>
        </div>
      </SummaryCard>
      <SummaryCard
        icon={<Activity size={18} />}
        label="Success today"
        note={`${number(succeeded)} of ${number(processed)} attempts`}
        value={processed ? `${number((succeeded / processed) * 100)}%` : "—"}
      >
        <SnapshotBar
          segments={[
            { label: "Succeeded", value: succeeded, color: "green" },
            { label: "Failed", value: failed, color: "red" },
          ]}
        />
      </SummaryCard>
      <SummaryCard
        icon={<CircleX size={18} />}
        label="Retained failures"
        note={`${number(failed)} failed attempts today`}
        value={number(sum("retry") + sum("archived"))}
      >
        <SnapshotBar
          segments={[
            { label: "Retrying", value: sum("retry"), color: "amber" },
            { label: "Archived", value: sum("archived"), color: "red" },
          ]}
        />
      </SummaryCard>
      <SummaryCard
        icon={<Cpu size={18} />}
        label="Processing now"
        note={
          servers === undefined
            ? "Current task snapshot"
            : `${number(workers ?? 0)} active workers · ${number(servers)} servers`
        }
        value={
          <>
            {number(sum("active"))} <small>active tasks</small>
          </>
        }
      >
        <SnapshotBar
          segments={[
            { label: "Pending", value: sum("pending"), color: "muted" },
            { label: "Active", value: sum("active"), color: "green" },
          ]}
        />
      </SummaryCard>
    </div>
  );
}
export function OverviewPage() {
  const query = useQuery(getOverviewOptions());
  const failures = useQuery(
    listTasksOptions({ query: { state: "failed", limit: 5 } }),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Overview</h1>
          <p>
            Current queue state, processing health, and the signals that need
            attention.
          </p>
        </div>
        <div className="heading-actions">
          <TimeRange />
          <Button variant="secondary" onClick={() => invalidateOperational()}>
            <RefreshCw size={14} />
            Refresh
          </Button>
        </div>
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.error && !query.data ? (
        <DataError error={query.error} retry={() => query.refetch()} />
      ) : (
        query.data && (
          <>
            <Stale error={query.error} />
            <Stats
              queues={query.data.queues}
              workers={query.data.active_workers}
              servers={query.data.servers}
            />
            <div className="two-columns">
              <HistoricalChart
                metric="processed"
                title="Processing throughput"
              />
              <HistoricalChart metric="failed" title="Failure rate" />
            </div>
            <Card className="section">
              <CardHeader className="section-heading">
                <CardTitle>
                  <h2>Queues</h2>
                </CardTitle>
                <span className="muted small">
                  Snapshot · {date(query.data.observed_at)}
                </span>
              </CardHeader>
              <QueueTable data={query.data.queues} />
            </Card>
            <Card className="section">
              <CardHeader className="section-heading">
                <CardTitle>
                  <h2>Retained failures</h2>
                </CardTitle>
                <Link to="/failures" className="table-link small">
                  Inspect failures
                </Link>
              </CardHeader>
              {failures.isPending ? (
                <Loading rows={2} />
              ) : failures.error ? (
                <CardContent className="section-body">
                  <DataError
                    error={failures.error}
                    retry={() => failures.refetch()}
                  />
                </CardContent>
              ) : !failures.data?.data.length ? (
                <Empty title="No failures in this page">
                  Open the failure explorer to inspect all queues and retained
                  failures.
                </Empty>
              ) : (
                <div className="table-wrap">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Task type</TableHead>
                        <TableHead>Queue</TableHead>
                        <TableHead>State</TableHead>
                        <TableHead>Last error</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {failures.data.data.map((t) => (
                        <TableRow key={`${t.queue}/${t.id}`}>
                          <TableCell>
                            <Link
                              className="mono table-link"
                              to="/tasks/$queue/$id"
                              params={{ queue: t.queue, id: t.id }}
                            >
                              {t.type}
                            </Link>
                          </TableCell>
                          <TableCell className="mono">{t.queue}</TableCell>
                          <TableCell>
                            <Badge state={t.state} />
                          </TableCell>
                          <TableCell
                            className="danger"
                            style={{ maxWidth: 520, whiteSpace: "normal" }}
                          >
                            {t.last_error}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
          </>
        )
      )}
    </>
  );
}
export function QueuesPage() {
  const query = useQuery(listQueuesOptions());
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Queues</h1>
          <p>Backlog, processing state, and latency across your environment.</p>
        </div>
        <Button
          variant="secondary"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
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
            <Stats queues={query.data.data} />
            <Card className="section">
              <CardHeader className="section-heading">
                <div>
                  <h2>Queue inventory</h2>
                  <p className="muted small">
                    {number(query.data.data.length)} queues in this environment
                  </p>
                </div>
                <UiBadge className="badge">Live snapshot</UiBadge>
              </CardHeader>
              <QueueTable data={query.data.data} />
            </Card>
          </>
        )
      )}
    </>
  );
}
export function QueuePage() {
  const { queue } = useParams({ from: "/queues/$queue" });
  const query = useQuery(getQueueOptions({ path: { queue } }));
  const session = useSession();
  const [confirm, setConfirm] = useState(false);
  const pause = useMutation({
    ...pauseQueueMutation(),
    onSuccess: () => {
      invalidateOperational();
      setConfirm(false);
      toast.success("Queue paused. Active tasks continue processing.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const resume = useMutation({
    ...resumeQueueMutation(),
    onSuccess: () => {
      invalidateOperational();
      setConfirm(false);
      toast.success("Queue resumed.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const pending = pause.isPending || resume.isPending;
  const paused = query.data?.paused;
  return (
    <>
      <div className="page-heading">
        <div>
          <Link to="/queues" className="muted small">
            Queues
          </Link>
          <h1 className="mono" style={{ marginTop: 8 }}>
            {queue}
          </h1>
          <p>Current state and retained tasks for this queue.</p>
        </div>
        <div className="heading-actions">
          <TimeRange />
          <Button
            variant="secondary"
            onClick={() => setConfirm(true)}
            disabled={!query.data || session.data?.role !== "admin"}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}{" "}
            {paused ? "Resume" : "Pause"} queue
          </Button>
        </div>
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.error && !query.data ? (
        <DataError error={query.error} retry={() => query.refetch()} />
      ) : (
        query.data && (
          <>
            <Stale error={query.error} />
            <Stats queues={[query.data]} />
            <div className="two-columns">
              <HistoricalChart
                metric="depth"
                title="Queue depth"
                queue={queue}
              />
              <HistoricalChart
                metric="latency"
                title="Queue latency"
                queue={queue}
              />
            </div>
            <Card className="section">
              <CardHeader className="section-heading">
                <CardTitle>
                  <h2>Task distribution</h2>
                </CardTitle>
                <Badge state={paused ? "paused" : "running"} />
              </CardHeader>
              <div className="section-body toolbar">
                {states.map((state) => (
                  <Link to="/tasks" search={{ queue, state }} key={state}>
                    <Badge state={state} />{" "}
                    <span className="mono">{number(query.data![state])}</span>
                  </Link>
                ))}
                <span className="muted small">
                  Approx. memory {number(query.data.memory_bytes / 1024)} KiB
                </span>
              </div>
            </Card>
            <TasksPage scopedQueue={queue} embedded />
          </>
        )
      )}
      <OperationDialog
        open={confirm}
        onOpenChange={(open) => {
          if (!pending) setConfirm(open);
        }}
        title={`${paused ? "Resume" : "Pause"} ${queue}?`}
        description={
          paused
            ? "Pending tasks become eligible for processing again."
            : "New processing will stop. Tasks already active continue until they finish."
        }
      >
        <Alert role="note" className="notice">
          <AlertDescription>
            This action is recorded in the audit log.
          </AlertDescription>
        </Alert>
        <DialogFooter className="dialog-actions">
          <AlertDialogCancel
            variant="secondary"
            disabled={pending}
            onClick={() => setConfirm(false)}
          >
            Cancel
          </AlertDialogCancel>
          <Button
            disabled={pending}
            onClick={() => {
              const vars: Options<PauseQueueData> = {
                path: { queue },
                body: { confirm: true },
                headers: { "X-Spool-Action": "confirmed" as const },
              };
              if (paused) resume.mutate(vars);
              else pause.mutate(vars);
            }}
          >
            {pending ? "Applying…" : paused ? "Resume queue" : "Pause queue"}
          </Button>
        </DialogFooter>
      </OperationDialog>
    </>
  );
}
