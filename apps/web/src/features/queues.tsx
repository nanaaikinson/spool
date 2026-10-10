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
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
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
import { DataError, Empty, Loading, Stale } from "../components/data-state";
import {
  FilterBar,
  PageHeader,
  Section,
  SectionBody,
  SectionHeader,
  StatTile,
  StateBadge,
  TabCount,
  cardX,
  dividedList,
  stack,
  statGrid,
  tabBar,
  tabItem,
  cardColumns,
} from "../components/page";
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
import { Phantom } from "../components/phantom";
import { placeholderQueue, placeholderQueues } from "../lib/placeholders";
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
const stateFill: Record<(typeof states)[number], string> = {
  pending: "bg-primary",
  active: "bg-green",
  scheduled: "bg-purple",
  retry: "bg-amber",
  archived: "bg-red",
  completed: "bg-muted-foreground",
  aggregating: "bg-muted-foreground",
};
/** Page columns: one on narrow screens, side by side when there is room. */
export function Distribution({
  queue,
  large = false,
  className,
}: {
  queue: Queue;
  large?: boolean;
  className?: string;
}) {
  const total = states.reduce((n, s) => n + queue[s], 0);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          tabIndex={0}
          className={cn(
            "flex h-1.5 max-w-[190px] min-w-[100px] gap-0.5 overflow-hidden rounded-[3px] bg-hover",
            large && "h-2.5 w-full max-w-none rounded-[5px]",
            className,
          )}
          aria-label={states.map((s) => `${queue[s]} ${s}`).join(", ")}
        >
          {states.map(
            (s) =>
              queue[s] > 0 && (
                <span
                  key={s}
                  data-skeleton-hide
                  className={cn("min-w-0.5", stateFill[s])}
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
        <div className="grid gap-1.5">
          <Link
            className="font-medium text-foreground font-mono"
            to="/queues/$queue"
            params={{ queue: row.original.name }}
          >
            {row.original.name}
          </Link>
          <Distribution
            queue={row.original}
            className="h-1 w-[120px] min-w-0"
          />
        </div>
      ),
    }),
    helper.accessor((q) => (q.paused ? "paused" : "running"), {
      id: "state",
      header: "State",
      cell: ({ row }) => (
        <StateBadge state={row.original.paused ? "paused" : "running"} />
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
              className={
                row.original[s] > 0
                  ? "font-medium text-foreground"
                  : "text-muted-foreground"
              }
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
          <div className="grid leading-[1.3]">
            <span>{number(processed)}</span>
            {processed > 0 && (
              <span
                className={
                  failed ? "text-red text-xs" : "text-muted-foreground text-xs"
                }
              >
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
        <span className="font-mono">
          {duration(row.original.latency_seconds)}
        </span>
      ),
    }),
    helper.accessor("memory_bytes", {
      header: "Memory",
      cell: ({ row }) => (
        <span className="font-mono text-muted-foreground">
          {bytes(row.original.memory_bytes)}
        </span>
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
        className={tabBar}
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
            className={tabItem}
          >
            {tab.label}
            <TabCount>{number(tab.count)}</TabCount>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <FilterBar>
        <InputGroup className="w-full @2xl/main:w-[min(320px,100%)]">
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
        <span className="self-center text-xs text-muted-foreground">
          {plural(filtered.length, "queue")}
        </span>
      </FilterBar>
      {!filtered.length ? (
        <Empty title="No matching queues">
          Change or clear the queue search.
        </Empty>
      ) : (
        <Table>
          <TableHeader data-shimmer-ignore>
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
                        className="flex gap-[5px] border-none bg-transparent p-0 text-inherit hover:bg-transparent hover:text-inherit has-[>svg]:px-0 dark:hover:bg-transparent"
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
    <div
      className={cn(
        "grid grid-cols-1 gap-3 @md/main:grid-cols-2 @5xl/main:grid-cols-4",
        stack,
      )}
    >
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
      <PageHeader
        title="Dashboard"
        description="Current queue state, processing health, and the signals that need attention."
        actions={
          <>
            <TimeRange />
            <RefreshButton
              onClick={() => invalidateOperational()}
              pending={query.isFetching}
            />
          </>
        }
      />
      {query.isPending ? (
        <>
          <Phantom loading label="Loading dashboard">
            <Stats
              queues={placeholderQueues}
              activeWorkers={4}
              concurrency={8}
              servers={1}
            />
          </Phantom>
          <div className={cardColumns({ layout: "even" })}>
            <Loading rows={3} />
            <Loading rows={3} />
          </div>
        </>
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
            <div className={cardColumns({ layout: "even" })}>
              <NeedsAttention />
              <ErrorGroupsCard limit={5} />
            </div>
            <div className={cardColumns()}>
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
      <PageHeader
        title="Queues"
        description="Backlog, processing state, and latency across your environment."
        actions={
          <RefreshButton
            onClick={() => query.refetch()}
            pending={query.isFetching}
          />
        }
      />
      {query.isPending ? (
        <Section>
          <Phantom loading label="Loading queues">
            <QueueTable data={placeholderQueues} />
          </Phantom>
        </Section>
      ) : query.error && !query.data ? (
        <DataError error={query.error} retry={() => query.refetch()} />
      ) : (
        query.data && (
          <>
            <Stale error={query.error} />
            <Section>
              <QueueTable data={query.data.data} />
            </Section>
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
      {/* Not PageHeader: the badge sits beside the title, outside the h1. */}
      <div
        className={cn(
          "flex flex-col gap-4 @3xl/main:flex-row @3xl/main:items-start @3xl/main:justify-between",
          stack,
        )}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-xl font-semibold tracking-tight text-balance md:text-2xl">
              {queue}
            </h1>
            {query.data && <StateBadge state={paused ? "paused" : "running"} />}
          </div>
          <p className="mt-2 max-w-[72ch] text-pretty text-muted-foreground">
            Backlog, throughput and the servers processing this queue.
          </p>
        </div>
        <div className="flex flex-none flex-wrap items-center gap-2 @3xl/main:justify-end">
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
        <Phantom loading label="Loading queue">
          <QueueFigures queue={placeholderQueue(queue)} />
        </Phantom>
      ) : query.error && !query.data ? (
        <DataError error={query.error} retry={() => query.refetch()} />
      ) : (
        query.data && (
          <>
            <Stale error={query.error} />
            <QueueFigures queue={query.data} />
            <div className={cardColumns()}>
              <ProcessedBy queue={queue} />
              <Section>
                <SectionHeader title="Task distribution" />
                <SectionBody>
                  <Distribution queue={query.data} large />
                  <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-4 gap-y-1">
                    {states.map((state) => (
                      <Link
                        to="/tasks"
                        search={{ queue, state }}
                        key={state}
                        className="flex items-center gap-2 rounded-md p-1.5 text-sm text-muted-foreground hover:bg-hover hover:text-foreground"
                      >
                        <i
                          data-skeleton-hide
                          className={cn(
                            "size-2 rounded-[2px]",
                            stateFill[state],
                          )}
                        />
                        <span>{state}</span>
                        <strong className="ml-auto font-mono font-medium text-foreground">
                          {number(query.data![state])}
                        </strong>
                      </Link>
                    ))}
                  </div>
                </SectionBody>
              </Section>
            </div>
            <div className={cardColumns()}>
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
        <Alert
          role="note"
          className="mt-3 block rounded-md border-0 bg-hover p-3 text-xs text-muted-foreground"
        >
          <AlertDescription className="text-xs">
            This action is recorded in the audit log.
          </AlertDescription>
        </Alert>
        <DialogFooter className="mt-6">
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
    <div className={statGrid({ columns: 6 })}>
      <StatTile
        label="Waiting"
        value={number(queue.pending)}
        detail={`${number(queue.scheduled)} scheduled for later`}
      />
      <StatTile
        label="Oldest wait"
        value={duration(queue.latency_seconds)}
        detail="Age of the oldest pending task"
      />
      <StatTile
        label="Processed today"
        value={number(queue.processed)}
        detail={`${number(queue.active)} running now`}
      />
      <StatTile
        label="Failed today"
        value={number(queue.failed)}
        valueClassName={queue.failed ? "text-red" : undefined}
        detail={
          queue.processed ? `${number(rate)}% of attempts` : "No attempts yet"
        }
      />
      <StatTile
        label="Retained failures"
        value={number(queue.retry + queue.archived)}
        detail={
          <>
            {number(queue.retry)} retrying · {number(queue.archived)} archived
          </>
        }
      />
      <StatTile
        label="Memory"
        value={bytes(queue.memory_bytes)}
        detail="Approximate Redis usage"
      />
    </div>
  );
}
function ProcessedBy({ queue }: { queue: string }) {
  const servers = useQuery(listServersOptions());
  const consumers = (servers.data?.data ?? []).filter((s) => queue in s.queues);
  return (
    <Section>
      <SectionHeader
        title="Processed by"
        description="Servers that pull from this queue"
        action={
          <Link to="/workers" className="text-xs font-medium text-foreground">
            All servers
          </Link>
        }
      />
      {servers.isPending ? (
        <Loading rows={2} />
      ) : servers.error && !servers.data ? (
        <SectionBody>
          <DataError error={servers.error} retry={() => servers.refetch()} />
        </SectionBody>
      ) : !consumers.length ? (
        <SectionBody>
          <Alert variant="destructive">
            <CircleX />
            <AlertDescription>
              {servers.data?.data.length
                ? "No running server lists this queue in its configuration. Tasks here wait until one does."
                : "No Asynq servers are running for this connection."}
            </AlertDescription>
          </Alert>
        </SectionBody>
      ) : (
        <ul className={dividedList}>
          {consumers.map((s) => {
            const weights = Object.values(s.queues).reduce((a, b) => a + b, 0);
            const busy = s.workers.filter((w) => w.queue === queue).length;
            return (
              <li
                key={s.id}
                className={cn(
                  "flex flex-col items-start gap-2 py-3.5 @xl/main:flex-row @xl/main:items-center @xl/main:justify-between @xl/main:gap-4",
                  cardX,
                )}
              >
                <div>
                  <strong className="font-mono">{s.host}</strong>
                  <span className="text-muted-foreground text-xs">
                    {" "}
                    · PID {s.pid}
                  </span>
                  <div className="text-muted-foreground text-xs">
                    {s.strict_priority
                      ? `Strict priority ${s.queues[queue]}`
                      : `Weight ${s.queues[queue]} of ${weights} · ~${number((s.queues[queue] / Math.max(weights, 1)) * 100)}% of slots`}
                  </div>
                </div>
                <div className="grid justify-items-start @xl/main:justify-items-end @xl/main:text-right">
                  <span className="text-xs">
                    {plural(busy, "task")} running here
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {s.workers.length}/{s.concurrency} slots busy overall
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
