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
  listServersOptions,
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
import { bytes, number, duration, plural } from "../lib/utils";
import {
  HistoricalChart,
  Sparkline,
  TimeRange,
  useQueueTrends,
} from "./charts";
import { RefreshButton } from "../components/info-tip";
import { NeedsAttention } from "./attention";
import { ErrorGroupsCard } from "./error-groups";
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
export function Distribution({
  queue,
  large = false,
}: {
  queue: Queue;
  large?: boolean;
}) {
  const total = states.reduce((n, s) => n + queue[s], 0);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          tabIndex={0}
          className={large ? "distribution large" : "distribution"}
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
function columns(trends: Map<string, number[]>) {
  return helper.columns([
    helper.accessor("name", {
      header: "Queue",
      cell: ({ row }) => (
        <div className="queue-cell">
          <Link
            className="table-link mono"
            to="/queues/$queue"
            params={{ queue: row.original.name }}
          >
            {row.original.name}
          </Link>
          <Distribution queue={row.original} />
        </div>
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
              className={row.original[s] > 0 ? "table-link" : "muted"}
            >
              {number(row.original[s])}
            </Link>
          ),
        }),
    ),
    helper.accessor("processed", {
      header: "Today",
      cell: ({ row }) => {
        const { processed, failed } = row.original;
        return (
          <div className="today-cell">
            <span>{number(processed)}</span>
            {processed > 0 && (
              <span className={failed ? "danger small" : "muted small"}>
                {number((failed / processed) * 100)}% failed
              </span>
            )}
          </div>
        );
      },
    }),
    helper.accessor("latency_seconds", {
      header: "Latency",
      cell: ({ row }) => (
        <span className="mono">{duration(row.original.latency_seconds)}</span>
      ),
    }),
    helper.accessor("memory_bytes", {
      header: "Memory",
      cell: ({ row }) => (
        <span className="mono muted">{bytes(row.original.memory_bytes)}</span>
      ),
    }),
    helper.display({
      id: "trend",
      header: "Last hour",
      cell: ({ row }) => (
        <Sparkline
          values={trends.get(row.original.name)}
          label={`Processing rate for ${row.original.name} over the last hour`}
        />
      ),
    }),
  ]);
}
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
  const trends = useQueueTrends("processed");
  const tableColumns = useMemo(() => columns(trends), [trends]);
  const table = useTable({
    features,
    columns: tableColumns,
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
        Enqueue tasks from your Asynq application. For sample traffic, run{" "}
        <code>make demo</code>.
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
                // One history entry per search, not per keystroke.
                replace: true,
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
  activeWorkers,
  concurrency,
  servers,
}: {
  queues: Queue[];
  activeWorkers: number;
  concurrency: number;
  servers: number;
}) {
  const sum = (
    key:
      | "pending"
      | "scheduled"
      | "active"
      | "retry"
      | "archived"
      | "processed"
      | "failed",
  ) => queues.reduce((n, q) => n + q[key], 0);
  const processed = sum("processed");
  const failed = sum("failed");
  const succeeded = Math.max(0, processed - failed);
  const oldest = queues.reduce<Queue | undefined>(
    (worst, q) =>
      !worst || q.latency_seconds > worst.latency_seconds ? q : worst,
    undefined,
  );
  return (
    <div className="summary-grid">
      <SummaryCard
        icon={<Layers size={18} />}
        label="Backlog"
        note={
          oldest && oldest.latency_seconds > 0
            ? `Oldest waiting ${duration(oldest.latency_seconds)} in ${oldest.name}`
            : "Nothing waiting"
        }
        value={
          <>
            {number(sum("pending"))} <small>waiting</small>
          </>
        }
      >
        <SnapshotBar
          segments={[
            { label: "Pending", value: sum("pending"), color: "primary" },
            { label: "Scheduled", value: sum("scheduled"), color: "purple" },
          ]}
        />
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
        note={`${number(activeWorkers)} of ${number(concurrency)} worker slots busy · ${plural(servers, "server")}`}
        value={
          <>
            {number(sum("active"))} <small>active tasks</small>
          </>
        }
      >
        <SnapshotBar
          segments={[
            { label: "Busy", value: activeWorkers, color: "green" },
            {
              label: "Idle",
              value: Math.max(0, concurrency - activeWorkers),
              color: "muted",
            },
          ]}
        />
      </SummaryCard>
    </div>
  );
}
export function OverviewPage() {
  const query = useQuery(getOverviewOptions());
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Dashboard</h1>
          <p>
            Current queue state, processing health, and the signals that need
            attention.
          </p>
        </div>
        <div className="heading-actions">
          <TimeRange />
          <RefreshButton
            onClick={() => invalidateOperational()}
            pending={query.isFetching}
          />
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
              activeWorkers={query.data.active_workers}
              concurrency={query.data.concurrency}
              servers={query.data.servers}
            />
            <div className="two-columns dashboard-columns">
              <NeedsAttention />
              <ErrorGroupsCard limit={5} />
            </div>
            <div className="two-columns">
              <HistoricalChart
                metric="processed"
                title="Processing throughput"
              />
              <HistoricalChart metric="failed" title="Failure rate" />
            </div>
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
            <Card className="section">
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
      toast.success("Queue paused. Running tasks will finish.");
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
          <div className="title-row">
            <h1 className="mono">{queue}</h1>
            {query.data && <Badge state={paused ? "paused" : "running"} />}
          </div>
          <p>Backlog, throughput and the servers processing this queue.</p>
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
            <QueueFigures queue={query.data} />
            <div className="two-columns">
              <ProcessedBy queue={queue} />
              <Card className="section">
                <CardHeader className="section-heading">
                  <CardTitle>
                    <h2>Task distribution</h2>
                  </CardTitle>
                </CardHeader>
                <CardContent className="section-body">
                  <Distribution queue={query.data} large />
                  <div className="distribution-legend">
                    {states.map((state) => (
                      <Link
                        to="/tasks"
                        search={{ queue, state }}
                        key={state}
                        className="distribution-item"
                      >
                        <i className={state} />
                        <span>{state}</span>
                        <strong className="mono">
                          {number(query.data![state])}
                        </strong>
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
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
            ? "Workers start picking up waiting tasks again."
            : "Workers stop picking up new tasks from this queue. Tasks already running finish normally."
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
function QueueFigures({ queue }: { queue: Queue }) {
  const rate = queue.processed ? (queue.failed / queue.processed) * 100 : 0;
  return (
    <div className="live-stats queue-figures">
      <div className="live-stat">
        <span>Waiting</span>
        <strong>{number(queue.pending)}</strong>
        <small>{number(queue.scheduled)} scheduled for later</small>
      </div>
      <div className="live-stat">
        <span>Oldest wait</span>
        <strong>{duration(queue.latency_seconds)}</strong>
        <small>Age of the oldest pending task</small>
      </div>
      <div className="live-stat">
        <span>Processed today</span>
        <strong>{number(queue.processed)}</strong>
        <small>{number(queue.active)} running now</small>
      </div>
      <div className="live-stat">
        <span>Failed today</span>
        <strong className={queue.failed ? "danger" : undefined}>
          {number(queue.failed)}
        </strong>
        <small>
          {queue.processed ? `${number(rate)}% of attempts` : "No attempts yet"}
        </small>
      </div>
      <div className="live-stat">
        <span>Retained failures</span>
        <strong>{number(queue.retry + queue.archived)}</strong>
        <small>
          {number(queue.retry)} retrying · {number(queue.archived)} archived
        </small>
      </div>
      <div className="live-stat">
        <span>Memory</span>
        <strong>{bytes(queue.memory_bytes)}</strong>
        <small>Approximate Redis usage</small>
      </div>
    </div>
  );
}
function ProcessedBy({ queue }: { queue: string }) {
  const servers = useQuery(listServersOptions());
  const consumers = (servers.data?.data ?? []).filter((s) => queue in s.queues);
  return (
    <Card className="section">
      <CardHeader className="section-heading">
        <div>
          <CardTitle>
            <h2>Processed by</h2>
          </CardTitle>
          <p className="muted small">Servers that pull from this queue</p>
        </div>
        <Link to="/workers" className="table-link small">
          All servers
        </Link>
      </CardHeader>
      {servers.isPending ? (
        <Loading rows={2} />
      ) : servers.error && !servers.data ? (
        <CardContent className="section-body">
          <DataError error={servers.error} retry={() => servers.refetch()} />
        </CardContent>
      ) : !consumers.length ? (
        <CardContent className="section-body">
          <Alert variant="destructive">
            <CircleX />
            <AlertDescription>
              {servers.data?.data.length
                ? "No running server lists this queue in its configuration. Tasks here wait until one does."
                : "No Asynq servers are running for this connection."}
            </AlertDescription>
          </Alert>
        </CardContent>
      ) : (
        <ul className="consumer-list">
          {consumers.map((s) => {
            const weights = Object.values(s.queues).reduce((a, b) => a + b, 0);
            const busy = s.workers.filter((w) => w.queue === queue).length;
            return (
              <li key={s.id}>
                <div>
                  <strong className="mono">{s.host}</strong>
                  <span className="muted small"> · PID {s.pid}</span>
                  <div className="muted small">
                    {s.strict_priority
                      ? `Strict priority ${s.queues[queue]}`
                      : `Weight ${s.queues[queue]} of ${weights} · ~${number((s.queues[queue] / Math.max(weights, 1)) * 100)}% of slots`}
                  </div>
                </div>
                <div className="consumer-busy">
                  <span className="small">
                    {plural(busy, "task")} running here
                  </span>
                  <span className="muted small">
                    {s.workers.length}/{s.concurrency} slots busy overall
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
