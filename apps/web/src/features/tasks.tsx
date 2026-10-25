import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
} from "@/components/ui/input-group";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { Options } from "../api/generated/sdk.gen";
import { useEffect, useId, useMemo, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  createColumnHelper,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  Copy,
  ChevronRight,
  Save,
  SlidersHorizontal,
  Search,
  CalendarClock,
  Clock,
  RotateCcw,
  Timer,
} from "lucide-react";
import {
  listTasksOptions,
  getTaskOptions,
  listQueuesOptions,
  listSchedulersOptions,
  bulkActionMutation,
  bulkActionAllMutation,
  retryTaskMutation,
  archiveTaskMutation,
  deleteTaskMutation,
  cancelTaskMutation,
  cloneTaskMutation,
  saveViewMutation,
  listViewsQueryKey,
} from "../api/generated/@tanstack/react-query.gen";
import type {
  TaskSummary,
  Payload,
  RetryTaskData,
} from "../api/generated/types.gen";
import { Button } from "../components/ui/button";
import { OperationDialog } from "../components/operation-dialog";
import { AlertDialogCancel } from "@/components/ui/alert-dialog";
import { SummaryCard, SnapshotBar } from "../components/summary-card";
import { DataError, Empty, Loading, Stale } from "../components/data-state";
import {
  PageHeader,
  PaginationBar,
  Section,
  SectionBody,
  SectionHeader,
  FilterBar,
  StateBadge,
  StatusDot,
  TabCount,
  cardX,
  filterField,
  stack,
  tabBar,
  tabItem,
  cardColumns,
} from "../components/page";
import { cn, date, duration, number, plural, capitalize } from "../lib/utils";
import { errorCode, errorMessage } from "../api/client";
import { invalidateOperational, queryClient, queueItems } from "./queries";
import { useSession } from "./session";
import { LIVE_TASK_STATES, TaskStatus, useTaskWorker } from "./task-status";
import { CronChip, PeriodicTable, TaskSchedule } from "./schedules";
import { Phantom } from "../components/phantom";
import { placeholderTasks } from "../lib/placeholders";
import { ErrorGroupsCard } from "./error-groups";
import { InfoTip, RefreshButton } from "../components/info-tip";
import { Time } from "../components/time";
/* Filter-row labels and inline form errors. */
const filterLabel = "text-xs text-muted-foreground";
const formError = "text-xs text-red";
/* Grey callout inside dialogs and payload panels. */
/** Actions Spool can apply to every task in a state at once; active tasks have none. */
const wholeState: Record<string, readonly ("retry" | "archive" | "delete")[]> =
  {
    pending: ["archive", "delete"],
    scheduled: ["retry", "archive", "delete"],
    retry: ["retry", "archive", "delete"],
    archived: ["retry", "delete"],
    completed: ["delete"],
    aggregating: ["retry", "archive", "delete"],
  };
const notice =
  "mt-3 block rounded-md border-0 bg-hover p-3 text-xs text-muted-foreground";
const noticeText = "text-xs";
const dialogActions = "mt-6";
const dialogForm = "mt-5 grid gap-4";
const features = tableFeatures({});
const helper = createColumnHelper<typeof features, TaskSummary>();
const states = [
  "pending",
  "active",
  "scheduled",
  "retry",
  "archived",
  "completed",
  "aggregating",
] as const;
const stateItems = [
  { value: "all", label: "All states" },
  ...[...states, "failed"].map((s) => ({ value: s, label: s })),
];
/**
 * Attempts made so far. Asynq counts failed attempts in `retried`, except the
 * final one before archiving; add the run in progress, completed or exhausted.
 */
export const attempts = (t: TaskSummary) =>
  t.retried +
  (t.state === "active" ||
  t.state === "completed" ||
  (t.state === "archived" && t.last_error)
    ? 1
    : 0);
const filterSchema = z
  .object({
    queue: z.string().max(200),
    state: z.enum(["", ...states, "failed"]),
    type: z.string().max(200),
    id: z.string().max(200),
    group: z.string().max(200),
    min_retry: z.number().int().min(0).max(100000),
    failed_after: z.string(),
  })
  .refine((v) => v.state !== "aggregating" || v.group.length > 0, {
    path: ["group"],
    message: "Enter a group for aggregating tasks.",
  });
export function TasksPage({
  preset,
  scopedQueue,
  embedded = false,
}: {
  preset?: "failed" | "scheduled";
  scopedQueue?: string;
  embedded?: boolean;
}) {
  const search = useSearch({ from: "__root__" });
  const navigate = useNavigate();
  const session = useSession();
  const queues = useQuery(listQueuesOptions());
  const schedules = useQuery({
    ...listSchedulersOptions(),
    enabled: preset === "scheduled",
  });
  const [advanced, setAdvanced] = useState(
    () =>
      !!(
        search.id ||
        search.group ||
        search.min_retry ||
        search.failed_after ||
        search.state === "aggregating"
      ),
  );
  const filtersID = useId();
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [bulk, setBulk] = useState<"retry" | "archive" | "delete" | null>(null);
  // Kept after the dialog closes so its text doesn't change during the exit animation.
  const [bulkAll, setBulkAll] = useState<{
    action: "retry" | "archive" | "delete";
    count?: number;
    state?: string;
    group?: string;
  } | null>(null);
  const [bulkAllOpen, setBulkAllOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [save, setSave] = useState(false);
  const viewForm = useForm<{ name: string }>({
    resolver: zodResolver(
      z.object({
        name: z.string().trim().min(1, "Enter a view name.").max(80),
      }),
    ),
    defaultValues: { name: "" },
  });
  const state = preset ?? search.state;
  // Scheduled tasks get a dedicated Schedule column; other views tag cron tasks inline.
  const showSchedule = state === "scheduled";
  const queue = scopedQueue ?? search.queue;
  const query = useQuery(
    listTasksOptions({
      query: {
        queue: queue || undefined,
        state: state || undefined,
        type: search.type || undefined,
        id: search.id || undefined,
        group: search.group || undefined,
        min_retry: search.min_retry,
        failed_after: search.failed_after || undefined,
        cursor: search.cursor || undefined,
        limit: 50,
      },
    }),
  );
  const form = useForm<z.infer<typeof filterSchema>>({
    resolver: zodResolver(filterSchema),
    defaultValues: {
      queue,
      state,
      type: search.type,
      id: search.id,
      group: search.group,
      min_retry: search.min_retry,
      failed_after: search.failed_after,
    },
  });
  useEffect(() => {
    form.reset({
      queue,
      state,
      type: search.type,
      id: search.id,
      group: search.group,
      min_retry: search.min_retry,
      failed_after: search.failed_after,
    });
    setSelection({});
  }, [
    queue,
    state,
    search.type,
    search.id,
    search.group,
    search.min_retry,
    search.failed_after,
    search.cursor,
    form,
  ]);
  const bulkMutation = useMutation({
    ...bulkActionMutation(),
    onSuccess: (result) => {
      invalidateOperational();
      setBulk(null);
      setSelection({});
      const failed = result.data.filter((r) => !r.success);
      if (failed.length)
        toast.error(
          `${failed.length} action${failed.length === 1 ? "" : "s"} failed. Check those tasks’ current state and the audit log.`,
        );
      else
        toast.success(
          `${result.data.length} task${result.data.length === 1 ? "" : "s"} updated.`,
        );
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const bulkAllMutation = useMutation({
    ...bulkActionAllMutation(),
    onSuccess: (result) => {
      invalidateOperational();
      setBulkAllOpen(false);
      setTyped("");
      setSelection({});
      toast.success(`${plural(result.affected, "task")} updated.`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const saveMutation = useMutation({
    ...saveViewMutation(),
    onSuccess: () => {
      setSave(false);
      viewForm.reset();
      queryClient.invalidateQueries({ queryKey: listViewsQueryKey() });
      toast.success("View saved.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const selected = (query.data?.data ?? []).filter(
    (t) => selection[`${t.queue}/${t.id}`],
  );
  const scopedQueues = (queues.data?.data ?? []).filter(
    (q) => !queue || q.name === queue,
  );
  const stateCount = (state: (typeof states)[number]) =>
    scopedQueues.reduce((sum, q) => sum + q[state], 0);
  const wholeActions = wholeState[state ?? ""] ?? [];
  // Aggregating tasks are counted per group, which the queue totals don't give.
  const wholeCount =
    state === "aggregating"
      ? undefined
      : stateCount(state as (typeof states)[number]);
  const canActOnAll =
    !!queue &&
    wholeActions.length > 0 &&
    session.data?.role === "admin" &&
    (state === "aggregating" ? !!search.group : !!wholeCount);
  const nextTask = query.data?.data
    .filter((t) => t.next_process_at)
    .sort((a, b) => a.next_process_at!.localeCompare(b.next_process_at!))[0];
  const columns = useMemo(
    () =>
      helper.columns([
        helper.display({
          id: "select",
          header: () => (
            <Checkbox
              aria-label="Select this page"
              checked={
                !!query.data?.data.length &&
                query.data.data.every((t) => selection[`${t.queue}/${t.id}`])
              }
              onCheckedChange={(value) => {
                const checked = value === true;
                setSelection(
                  Object.fromEntries(
                    (query.data?.data ?? []).map((t) => [
                      `${t.queue}/${t.id}`,
                      checked,
                    ]),
                  ),
                );
              }}
            />
          ),
          cell: ({ row }) => (
            <Checkbox
              aria-label={`Select ${row.original.id}`}
              checked={!!selection[`${row.original.queue}/${row.original.id}`]}
              onCheckedChange={(value) => {
                const checked = value === true;
                setSelection((old) => ({
                  ...old,
                  [`${row.original.queue}/${row.original.id}`]: checked,
                }));
              }}
            />
          ),
        }),
        helper.accessor("type", {
          header: "Task",
          cell: ({ row }) => (
            <div>
              <Link
                className="font-medium text-foreground"
                to="/tasks/$queue/$id"
                params={{ queue: row.original.queue, id: row.original.id }}
              >
                {row.original.type}
              </Link>
              <div className="mt-1 font-mono text-xs text-muted-foreground">
                {row.original.id}
              </div>
              {!showSchedule && row.original.schedule && (
                <CronChip schedule={row.original.schedule} />
              )}
            </div>
          ),
        }),
        helper.accessor("queue", {
          header: "Queue",
          cell: ({ row }) => (
            <Link
              className="font-mono"
              to="/queues/$queue"
              params={{ queue: row.original.queue }}
            >
              {row.original.queue}
            </Link>
          ),
        }),
        helper.accessor("state", {
          header: "State",
          cell: ({ row }) => (
            <>
              <StateBadge state={row.original.state} />
              {row.original.orphaned && (
                <div className="text-xs text-red">
                  Orphaned · awaiting recovery
                </div>
              )}
            </>
          ),
        }),
        helper.accessor("retried", {
          header: "Attempts",
          cell: ({ row }) => (
            <span className="font-mono">
              {attempts(row.original)} / {row.original.max_retry + 1}
            </span>
          ),
        }),
        ...(showSchedule
          ? [
              helper.display({
                id: "schedule",
                header: "Schedule",
                cell: ({ row }) => <TaskSchedule task={row.original} />,
              }),
            ]
          : []),
        helper.display({
          id: "time",
          header: showSchedule ? "Next process" : "Last failure / next process",
          cell: ({ row }) => (
            <span className="text-xs text-muted-foreground">
              <Time
                value={
                  (showSchedule
                    ? row.original.next_process_at
                    : row.original.last_failed_at) ??
                  row.original.next_process_at ??
                  row.original.completed_at
                }
              />
            </span>
          ),
        }),
        helper.accessor("last_error", {
          header: "Last error",
          cell: ({ row }) => (
            <span
              className={cn(
                "line-clamp-2 w-max max-w-[340px] min-w-[200px] whitespace-normal wrap-anywhere",
                row.original.last_error ? "text-red" : "text-muted-foreground",
              )}
              title={row.original.last_error || undefined}
            >
              {row.original.last_error || "—"}
            </span>
          ),
        }),
      ]),
    [query.data, selection, showSchedule],
  );
  const empty: TaskSummary[] = useMemo(() => [], []);
  const table = useTable({
    features,
    columns,
    data: query.data?.data ?? (query.isPending ? placeholderTasks : empty),
    getRowId: (t) => `${t.queue}/${t.id}`,
  });
  const title =
    preset === "failed"
      ? "Failed tasks"
      : preset === "scheduled"
        ? "Scheduled tasks"
        : "All tasks";
  const content = (
    <Tabs
      className="gap-0"
      value={preset ?? (state || "all")}
      onValueChange={(value) => {
        if (value === "periodic") navigate({ to: "/schedulers" });
        else if (preset && value === preset)
          navigate({
            to: preset === "scheduled" ? "/scheduled" : "/failures",
            search: { queue },
          });
        else {
          const nextState =
            value === "all" ? "" : filterSchema.shape.state.parse(value);
          if (preset)
            navigate({ to: "/tasks", search: { queue, state: nextState } });
          else
            navigate({
              to: ".",
              search: (old) => ({ ...old, state: nextState, cursor: "" }),
            });
        }
      }}
    >
      {!embedded && (
        <TabsList variant="line" className={tabBar} aria-label="Task views">
          {preset === "scheduled" ? (
            <>
              <TabsTrigger
                className={tabItem}
                value="scheduled"
                render={
                  <Link
                    to="/scheduled"
                    search={{ queue }}
                    aria-current="page"
                  />
                }
              >
                Scheduled tasks{" "}
                <TabCount>{number(stateCount("scheduled"))}</TabCount>
              </TabsTrigger>
              <TabsTrigger
                nativeButton={false}
                className={tabItem}
                value="periodic"
                render={<Link to="/schedulers" />}
              >
                Periodic schedules{" "}
                <TabCount>{number(schedules.data?.data.length ?? 0)}</TabCount>
              </TabsTrigger>
              <TabsTrigger
                nativeButton={false}
                className={tabItem}
                value="retry"
                render={<Link to="/tasks" search={{ queue, state: "retry" }} />}
              >
                Retrying <TabCount>{number(stateCount("retry"))}</TabCount>
              </TabsTrigger>
            </>
          ) : preset === "failed" ? (
            <>
              <TabsTrigger
                className={tabItem}
                value="failed"
                render={
                  <Link to="/failures" search={{ queue }} aria-current="page" />
                }
              >
                All failures{" "}
                <TabCount>
                  {number(stateCount("retry") + stateCount("archived"))}
                </TabCount>
              </TabsTrigger>
              <TabsTrigger
                nativeButton={false}
                className={tabItem}
                value="retry"
                render={<Link to="/tasks" search={{ queue, state: "retry" }} />}
              >
                Retrying <TabCount>{number(stateCount("retry"))}</TabCount>
              </TabsTrigger>
              <TabsTrigger
                className={tabItem}
                value="archived"
                render={
                  <Link to="/tasks" search={{ queue, state: "archived" }} />
                }
              >
                Archived <TabCount>{number(stateCount("archived"))}</TabCount>
              </TabsTrigger>
            </>
          ) : (
            (
              [
                "",
                "pending",
                "active",
                "scheduled",
                "retry",
                "archived",
                "completed",
                ...(state === "aggregating" || state === "failed"
                  ? [state]
                  : []),
              ] as const
            ).map((tab) => (
              <TabsTrigger
                value={tab || "all"}
                className={tabItem}
                key={tab}
                type="button"
              >
                {tab ? tab[0].toUpperCase() + tab.slice(1) : "All"}
                <TabCount>
                  {number(
                    tab === "failed"
                      ? stateCount("retry") + stateCount("archived")
                      : tab
                        ? stateCount(tab)
                        : states
                            .filter((s) => s !== "aggregating")
                            .reduce((sum, s) => sum + stateCount(s), 0),
                  )}
                </TabCount>
              </TabsTrigger>
            ))
          )}
        </TabsList>
      )}
      <TabsContent
        value={preset ?? (state || "all")}
        className="m-0"
        {...(embedded
          ? { "aria-label": "Queue task results", "aria-labelledby": undefined }
          : {})}
      >
        <Collapsible
          open={
            advanced || state === "aggregating" || !!form.formState.errors.group
          }
          onOpenChange={setAdvanced}
          render={
            <form
              className={cn(
                "flex flex-wrap items-end gap-3 border-b py-3",
                cardX,
              )}
              onSubmit={form.handleSubmit((values) =>
                navigate({
                  to: ".",
                  search: (old) => ({ ...old, ...values, cursor: "" }),
                }),
              )}
            />
          }
        >
          {!scopedQueue && (
            <Field className={filterField}>
              <Label htmlFor={`${filtersID}-queue`} className={filterLabel}>
                Queue
              </Label>
              <Controller
                name="queue"
                control={form.control}
                render={({ field }) => (
                  <Select
                    items={queueItems(queues.data?.data)}
                    value={field.value ? `queue:${field.value}` : "all"}
                    onValueChange={(value) =>
                      field.onChange(
                        !value || value === "all" ? "" : value.slice(6),
                      )
                    }
                  >
                    <SelectTrigger
                      id={`${filtersID}-queue`}
                      className="@2xl/main:min-w-40"
                      ref={field.ref}
                      onBlur={field.onBlur}
                    >
                      <SelectValue placeholder="All queues" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All queues</SelectItem>
                      {queues.data?.data.map((q) => (
                        <SelectItem key={q.name} value={`queue:${q.name}`}>
                          {q.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          )}
          {!preset && (
            <Field className={filterField}>
              <Label htmlFor={`${filtersID}-state`} className={filterLabel}>
                State
              </Label>
              <Controller
                name="state"
                control={form.control}
                render={({ field }) => (
                  <Select
                    items={stateItems}
                    value={field.value || "all"}
                    onValueChange={(value) =>
                      field.onChange(!value || value === "all" ? "" : value)
                    }
                  >
                    <SelectTrigger
                      id={`${filtersID}-state`}
                      className="@2xl/main:min-w-40"
                      ref={field.ref}
                      onBlur={field.onBlur}
                    >
                      <SelectValue placeholder="All states" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All states</SelectItem>
                      {[...states, "failed"].map((state) => (
                        <SelectItem key={state} value={state}>
                          {state}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          )}
          <Field className={cn(filterField, "max-w-full @2xl/main:w-80")}>
            <FieldLabel htmlFor={`${filtersID}-type`} className={filterLabel}>
              Task type
            </FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <Search aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                id={`${filtersID}-type`}
                type="search"
                placeholder="Filter task type…"
                {...form.register("type")}
              />
            </InputGroup>
          </Field>
          <Button variant="secondary" type="submit" className="self-end">
            Apply filters
          </Button>
          <CollapsibleTrigger
            render={
              <Button variant="secondary" type="button" className="ml-auto" />
            }
          >
            <SlidersHorizontal size={15} />
            Filter
            {(search.id ||
              search.group ||
              search.min_retry ||
              search.failed_after) && <StatusDot tone="green" />}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1 flex w-full flex-wrap items-end gap-3 border-t pt-4">
            <Field className={filterField}>
              <FieldLabel htmlFor={`${filtersID}-id`} className={filterLabel}>
                Task ID
              </FieldLabel>
              <Input
                id={`${filtersID}-id`}
                placeholder="Exact task ID"
                {...form.register("id")}
              />
            </Field>
            <Field className={filterField}>
              <FieldLabel
                htmlFor={`${filtersID}-min_retry`}
                className={filterLabel}
              >
                Minimum retries
              </FieldLabel>
              <Input
                id={`${filtersID}-min_retry`}
                type="number"
                min={0}
                max={100000}
                className="max-w-[100px]"
                {...form.register("min_retry", { valueAsNumber: true })}
              />
            </Field>
            <Field className={filterField}>
              <FieldLabel
                htmlFor={`${filtersID}-group`}
                className={filterLabel}
              >
                Group
              </FieldLabel>
              <Input
                id={`${filtersID}-group`}
                placeholder="For aggregating tasks"
                aria-invalid={!!form.formState.errors.group}
                aria-describedby={
                  form.formState.errors.group
                    ? `${filtersID}-group-error`
                    : undefined
                }
                {...form.register("group")}
              />
            </Field>
            {form.formState.errors.group && (
              <FieldError id={`${filtersID}-group-error`} className={formError}>
                {form.formState.errors.group.message}
              </FieldError>
            )}
            <Field className={filterField}>
              <FieldLabel
                htmlFor={`${filtersID}-failed_after`}
                className={filterLabel}
              >
                Failed after
              </FieldLabel>
              <Input
                id={`${filtersID}-failed_after`}
                placeholder="2026-10-02T12:00:00Z"
                {...form.register("failed_after")}
              />
            </Field>
          </CollapsibleContent>
        </Collapsible>
        {selected.length > 0 && (
          <FilterBar>
            <span className="text-xs">{selected.length} selected</span>
            {(["retry", "archive", "delete"] as const).map((a) => (
              <Button
                key={a}
                size="sm"
                variant={a === "delete" ? "destructive" : "secondary"}
                disabled={session.data?.role !== "admin"}
                onClick={() => setBulk(a)}
              >
                {a[0].toUpperCase() + a.slice(1)} selected
              </Button>
            ))}
          </FilterBar>
        )}
        {canActOnAll && (
          <FilterBar>
            <span className="text-xs">
              {state === "aggregating"
                ? `Every task in group ${search.group}`
                : `All ${plural(wholeCount ?? 0, `${state} task`)} in ${queue}`}
            </span>
            {wholeActions.map((a) => (
              <Button
                key={a}
                size="sm"
                variant={a === "delete" ? "destructive" : "secondary"}
                onClick={() => {
                  setBulkAll({
                    action: a,
                    count: wholeCount,
                    state,
                    group: search.group,
                  });
                  setBulkAllOpen(true);
                }}
              >
                {capitalize(a)} all
              </Button>
            ))}
          </FilterBar>
        )}
        {query.isPending ? (
          <Phantom loading label="Loading tasks">
            <Table>
              <TableHeader data-shimmer-ignore>
                {table.getHeaderGroups().map((g) => (
                  <TableRow key={g.id}>
                    {g.headers.map((h) => (
                      <TableHead key={h.id}>
                        <table.FlexRender header={h} />
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getAllCells().map((c) => (
                      <TableCell key={c.id}>
                        <table.FlexRender cell={c} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Phantom>
        ) : query.error && !query.data ? (
          <SectionBody>
            <DataError error={query.error} retry={() => query.refetch()} />
          </SectionBody>
        ) : (
          <>
            <Stale error={query.error} />
            {!query.data?.data.length ? (
              <Empty
                title={
                  query.data?.pagination.has_more
                    ? "No matches on this page"
                    : "No tasks here"
                }
              >
                {query.data?.pagination.has_more
                  ? "Try the next page, or narrow the queue and state filters."
                  : "Change the filters, or check back once tasks are enqueued."}
              </Empty>
            ) : (
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map((g) => (
                    <TableRow key={g.id}>
                      {g.headers.map((h) => (
                        <TableHead key={h.id}>
                          <table.FlexRender header={h} />
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {table.getRowModel().rows.map((row) => (
                    <TableRow key={row.id}>
                      {row.getAllCells().map((c) => (
                        <TableCell key={c.id}>
                          <table.FlexRender cell={c} />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <PaginationBar>
              <span className="text-muted-foreground text-xs">
                {plural(query.data?.data.length ?? 0, "match", "matches")} on
                this page · {number(query.data?.pagination.total ?? 0)} tasks in
                total
              </span>
              <Pagination className="m-0 w-auto" aria-label="Task pages">
                <PaginationContent className="gap-2">
                  <PaginationItem>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!search.cursor}
                      onClick={() =>
                        navigate({
                          to: ".",
                          search: (old) => ({ ...old, cursor: "" }),
                        })
                      }
                    >
                      First page
                    </Button>
                  </PaginationItem>
                  <PaginationItem>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={
                        !query.data?.pagination.has_more || query.isFetching
                      }
                      onClick={() =>
                        navigate({
                          to: ".",
                          search: (old) => ({
                            ...old,
                            cursor: query.data?.pagination.next_cursor ?? "",
                          }),
                        })
                      }
                    >
                      Next page
                      <ChevronRight size={14} />
                    </Button>
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </PaginationBar>
          </>
        )}
      </TabsContent>
    </Tabs>
  );
  return (
    <>
      {!embedded && (
        <PageHeader
          title={title}
          description={
            preset === "failed"
              ? "Tasks that failed and are retrying or archived. See why they failed, then retry or clean up."
              : preset === "scheduled"
                ? "One-off tasks set to run later, and the periodic schedules that enqueue tasks on a timer."
                : "Every task across your queues, filtered by queue, state and type."
          }
          actions={
            <>
              {preset === "scheduled" && (
                <Button
                  variant="secondary"
                  nativeButton={false}
                  render={<Link to="/schedulers" />}
                >
                  Periodic schedules
                </Button>
              )}
              <Button
                variant="secondary"
                disabled={session.data?.role !== "admin"}
                onClick={() => setSave(true)}
              >
                <Save size={14} />
                Save view
              </Button>
              <RefreshButton
                onClick={() => query.refetch()}
                pending={query.isFetching}
              />
            </>
          }
        />
      )}
      {!embedded && preset === "scheduled" && (
        <div
          className={cn(
            "grid grid-cols-1 gap-3 @md/main:grid-cols-2 @5xl/main:grid-cols-4",
            stack,
          )}
        >
          <SummaryCard
            icon={<CalendarClock size={18} />}
            label="Scheduled workload"
            value={
              queues.isPending
                ? "…"
                : queues.error && !queues.data
                  ? "—"
                  : number(stateCount("scheduled"))
            }
            note={queue ? `In ${queue}` : "Across all queues"}
          >
            <SnapshotBar
              segments={[
                {
                  label: "Scheduled",
                  value: stateCount("scheduled"),
                  color: "purple",
                },
                {
                  label: "Pending",
                  value: stateCount("pending"),
                  color: "muted",
                },
              ]}
            />
          </SummaryCard>
          <SummaryCard
            icon={<Clock size={18} />}
            label="Periodic schedules"
            value={
              schedules.isPending
                ? "…"
                : schedules.error
                  ? "—"
                  : number(schedules.data?.data.length ?? 0)
            }
            note="Registered by running schedulers"
          >
            <Link
              className="mb-1 flex items-center gap-1 font-medium text-foreground"
              to="/schedulers"
            >
              Inspect cron entries <ChevronRight size={13} />
            </Link>
            <p className="text-xs text-muted-foreground">
              Managed by your Asynq scheduler
            </p>
          </SummaryCard>
          <SummaryCard
            icon={<RotateCcw size={18} />}
            label="Waiting to retry"
            value={
              queues.isPending
                ? "…"
                : queues.error && !queues.data
                  ? "—"
                  : number(stateCount("retry"))
            }
            note="Failed tasks with another attempt scheduled"
          >
            <SnapshotBar
              segments={[
                {
                  label: "Retrying",
                  value: stateCount("retry"),
                  color: "amber",
                },
                {
                  label: "Archived",
                  value: stateCount("archived"),
                  color: "red",
                },
              ]}
            />
          </SummaryCard>
          <SummaryCard
            icon={<Timer size={18} />}
            label="Next on this page"
            value={
              nextTask?.next_process_at ? (
                new Date(nextTask.next_process_at).getTime() <= Date.now() ? (
                  "Due now"
                ) : (
                  <>
                    in{" "}
                    {duration(
                      (new Date(nextTask.next_process_at).getTime() -
                        Date.now()) /
                        1000,
                    )}
                  </>
                )
              ) : (
                "—"
              )
            }
            note={
              nextTask
                ? date(nextTask.next_process_at)
                : query.isPending
                  ? "Loading scheduled tasks"
                  : "No scheduled tasks on this page"
            }
          >
            {nextTask ? (
              <>
                <Link
                  className="font-medium text-foreground"
                  to="/tasks/$queue/$id"
                  aria-label={`Inspect next task ${nextTask.type}`}
                  params={{ queue: nextTask.queue, id: nextTask.id }}
                >
                  {nextTask.type}
                </Link>
                <p className="font-mono text-xs text-muted-foreground">
                  {nextTask.queue}
                </p>
              </>
            ) : (
              <p>Inspect tasks to see their next processing time.</p>
            )}
          </SummaryCard>
        </div>
      )}
      {!embedded && preset === "failed" && (
        <ErrorGroupsCard limit={5} queue={queue} />
      )}
      <Section>
        <SectionHeader
          title={
            embedded
              ? "Queue tasks"
              : preset === "scheduled"
                ? "Upcoming tasks"
                : preset === "failed"
                  ? "Retained failures"
                  : "Tasks"
          }
          description={
            <span className="flex flex-wrap items-center gap-2">
              {plural(query.data?.pagination.total ?? 0, "task")}
              <InfoTip label="How filters work">
                Spool reads one page of up to 50 tasks at a time instead of
                scanning Redis. Queue and state narrow what is read; type,
                attempt and failure-time filters apply to the page already
                loaded.
              </InfoTip>
            </span>
          }
          action={
            embedded ? (
              <Link
                to="/tasks"
                search={{ queue: scopedQueue }}
                className="text-xs font-medium text-foreground"
              >
                Open in All tasks
              </Link>
            ) : undefined
          }
        />
        {content}
      </Section>
      {!embedded && preset === "scheduled" && !!schedules.data?.data.length && (
        <Section>
          <SectionHeader
            title="Periodic schedules"
            description="Cron entries enqueue a fresh task on every run"
            action={
              <Link
                to="/schedulers"
                className="text-xs font-medium text-foreground"
              >
                View all
              </Link>
            }
          />
          <PeriodicTable data={schedules.data.data} />
        </Section>
      )}
      <OperationDialog
        open={!!bulk}
        onOpenChange={(open) =>
          !open && !bulkMutation.isPending && setBulk(null)
        }
        title={`${capitalize(bulk ?? "update")} ${plural(selected.length, "selected task")}?`}
        description="Each task is checked against its current state and recorded in the audit log. You’ll see which ones fail."
      >
        <Alert role="note" className={notice}>
          <AlertDescription className={noticeText}>
            {bulk === "delete"
              ? "This permanently removes the selected tasks and their data."
              : "Tasks that can’t take this action are left unchanged."}
          </AlertDescription>
        </Alert>
        <DialogFooter className={dialogActions}>
          <AlertDialogCancel
            variant="secondary"
            disabled={bulkMutation.isPending}
            onClick={() => setBulk(null)}
          >
            Cancel
          </AlertDialogCancel>
          <Button
            variant={bulk === "delete" ? "destructive" : "default"}
            disabled={bulkMutation.isPending}
            onClick={() => {
              if (bulk)
                bulkMutation.mutate({
                  body: {
                    confirm: true,
                    action: bulk,
                    tasks: selected.map((t) => ({ queue: t.queue, id: t.id })),
                  },
                  headers: { "X-Spool-Action": "confirmed" },
                });
            }}
          >
            {bulkMutation.isPending ? "Applying…" : `Confirm ${bulk}`}
          </Button>
        </DialogFooter>
      </OperationDialog>
      <OperationDialog
        open={bulkAllOpen}
        onOpenChange={(open) => {
          if (!open && !bulkAllMutation.isPending) {
            setBulkAllOpen(false);
            setTyped("");
          }
        }}
        title={`${capitalize(bulkAll?.action ?? "update")} ${
          bulkAll?.count === undefined
            ? `every task in group ${bulkAll?.group}`
            : `all ${plural(bulkAll.count, `${bulkAll.state} task`)}`
        } in ${queue}?`}
        description="This acts on every task in this state of the queue, not only the ones on this page. It is recorded in the audit log as one action; tasks added meanwhile are included."
      >
        <Alert role="note" className={notice}>
          <AlertDescription className={noticeText}>
            {bulkAll?.action === "delete"
              ? "This permanently removes these tasks and their data. Active tasks are never touched."
              : "Active tasks are never touched."}
          </AlertDescription>
        </Alert>
        {bulkAll?.action === "delete" && (
          <Field className="mt-3">
            <FieldLabel htmlFor={`${filtersID}-confirm-queue`}>
              Type {queue} to confirm
            </FieldLabel>
            <Input
              id={`${filtersID}-confirm-queue`}
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </Field>
        )}
        <DialogFooter className={dialogActions}>
          <AlertDialogCancel
            variant="secondary"
            disabled={bulkAllMutation.isPending}
            onClick={() => {
              setBulkAllOpen(false);
              setTyped("");
            }}
          >
            Cancel
          </AlertDialogCancel>
          <Button
            variant={bulkAll?.action === "delete" ? "destructive" : "default"}
            disabled={
              bulkAllMutation.isPending ||
              (bulkAll?.action === "delete" && typed !== queue)
            }
            onClick={() => {
              if (bulkAll?.state)
                bulkAllMutation.mutate({
                  path: { queue },
                  body: {
                    confirm: true,
                    action: bulkAll.action,
                    state: bulkAll.state,
                    group:
                      bulkAll.state === "aggregating"
                        ? (bulkAll.group ?? "")
                        : "",
                  },
                  headers: { "X-Spool-Action": "confirmed" },
                });
            }}
          >
            {bulkAllMutation.isPending
              ? "Applying…"
              : `Confirm ${bulkAll?.action}`}
          </Button>
        </DialogFooter>
      </OperationDialog>
      <OperationDialog
        kind="form"
        open={save}
        onOpenChange={setSave}
        title="Save this view"
        description="Keep the current filters so you can reopen them from Settings."
      >
        <form
          className={dialogForm}
          onSubmit={viewForm.handleSubmit((values) =>
            saveMutation.mutate({
              body: {
                name: values.name,
                path: window.location.pathname + window.location.search,
              },
              headers: { "X-Spool-Action": "confirmed" },
            }),
          )}
        >
          <Field>
            <FieldLabel htmlFor={`${filtersID}-name`}>View name</FieldLabel>
            <Input
              id={`${filtersID}-name`}
              required
              maxLength={80}
              {...viewForm.register("name")}
            />
          </Field>
          {viewForm.formState.errors.name && (
            <FieldError className={formError}>
              {viewForm.formState.errors.name.message}
            </FieldError>
          )}
          <DialogFooter className={dialogActions}>
            <Button disabled={saveMutation.isPending} type="submit">
              {saveMutation.isPending ? "Saving…" : "Save view"}
            </Button>
          </DialogFooter>
        </form>
      </OperationDialog>
    </>
  );
}
export function formatPayload(payload: Payload): string {
  if (payload.encoding === "json" && !payload.truncated) {
    try {
      return JSON.stringify(JSON.parse(payload.data), null, 2);
    } catch {
      /* Display the original data when decoding fails. */
    }
  }
  return payload.data;
}
/* Scrollable, monospaced block for payloads, results and headers. */
const payloadScroll =
  "max-h-[580px] rounded-md bg-background [&>[data-slot=scroll-area-viewport]]:max-h-[580px]";
const payloadText =
  "rounded-md bg-background p-4 font-mono text-xs leading-[1.7] whitespace-pre-wrap wrap-anywhere";
function PayloadPanel({ payload, title }: { payload: Payload; title: string }) {
  return (
    <Section>
      <SectionHeader
        title={title}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {number(payload.bytes)} bytes · {payload.encoding}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Copy ${title.toLowerCase()}`}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(formatPayload(payload));
                  toast.success(`${title} copied.`);
                } catch {
                  toast.error(
                    "Clipboard access failed. Select and copy the text.",
                  );
                }
              }}
            >
              <Copy size={15} />
            </Button>
          </div>
        }
      />
      <SectionBody>
        {payload.truncated && (
          <Alert role="note" className={cn(notice, "mb-3")}>
            <AlertDescription className={noticeText}>
              Showing the first 256 KB. The full payload is larger.
            </AlertDescription>
          </Alert>
        )}
        <ScrollArea
          className={payloadScroll}
          tabIndex={0}
          aria-label={`${title} contents`}
        >
          <pre data-testid="payload" className={payloadText}>
            {payload.bytes ? formatPayload(payload) : "No data stored."}
          </pre>
        </ScrollArea>
      </SectionBody>
    </Section>
  );
}
const cloneSchema = z.object({
  queue: z.string().min(1).max(200),
  type: z.string().min(1).max(200),
  payload: z.string().max(256 * 1024),
  max_retry: z.number().int().min(0).max(100),
});
export function TaskPage() {
  const fieldsID = useId();
  const { queue, id } = useParams({ from: "/tasks/$queue/$id" });
  const query = useQuery({
    ...getTaskOptions({ path: { queue, id } }),
    // Follow states that change on their own; stop once the task is gone.
    refetchInterval: (q) =>
      q.state.data &&
      LIVE_TASK_STATES.has(q.state.data.state) &&
      errorCode(q.state.error) !== "NOT_FOUND"
        ? 3_000
        : false,
  });
  const gone = !!query.data && errorCode(query.error) === "NOT_FOUND";
  const worker = useTaskWorker(
    query.data,
    query.data?.state === "active" && !gone,
  );
  const session = useSession();
  const navigate = useNavigate();
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState("");
  const retry = useMutation(retryTaskMutation());
  const archive = useMutation(archiveTaskMutation());
  const remove = useMutation(deleteTaskMutation());
  const cancel = useMutation(cancelTaskMutation());
  const clone = useMutation(cloneTaskMutation());
  const pending =
    retry.isPending ||
    archive.isPending ||
    remove.isPending ||
    cancel.isPending ||
    clone.isPending;
  const form = useForm<z.infer<typeof cloneSchema>>({
    resolver: zodResolver(cloneSchema),
  });
  const openAction = (value: string) => {
    setError("");
    setAction(value);
    if (value === "clone" && query.data)
      form.reset({
        queue: query.data.queue,
        type: query.data.type,
        payload: query.data.payload.data,
        max_retry: query.data.max_retry,
      });
  };
  const run = async () => {
    setError("");
    const vars: Options<RetryTaskData> = {
      path: { queue, id },
      body: { confirm: true },
      headers: { "X-Spool-Action": "confirmed" as const },
    };
    try {
      if (action === "retry") await retry.mutateAsync(vars);
      if (action === "archive") await archive.mutateAsync(vars);
      if (action === "delete") await remove.mutateAsync(vars);
      if (action === "cancel") await cancel.mutateAsync(vars);
      await invalidateOperational();
      setAction(null);
      toast.success(
        action === "cancel"
          ? "Cancellation requested. It takes effect when the worker checks for it."
          : `Task ${action === "retry" ? "queued to run now" : action === "archive" ? "archived" : "deleted"}.`,
      );
      if (action === "delete") navigate({ to: "/tasks", search: { queue } });
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const cloneTask = form.handleSubmit(async (values) => {
    try {
      const result = await clone.mutateAsync({
        path: { queue, id },
        body: { ...values, confirm: true },
        headers: { "X-Spool-Action": "confirmed" },
      });
      invalidateOperational();
      setAction(null);
      toast.success("New task enqueued.");
      navigate({
        to: "/tasks/$queue/$id",
        params: { queue: result.queue, id: result.id },
      });
    } catch (e) {
      setError(errorMessage(e));
    }
  });
  if (query.isPending) return <Loading />;
  if (query.error && !query.data)
    return <DataError error={query.error} retry={() => query.refetch()} />;
  const task = query.data;
  if (!task) return null;
  const events = [
    { title: "Started on worker", time: worker?.started },
    { title: "Last failure", time: task.last_failed_at },
    { title: "Next run", time: task.next_process_at },
    { title: "Completed", time: task.completed_at },
  ]
    .filter((e) => e.time)
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));
  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            to="/queues/$queue"
            params={{ queue }}
            className="inline-block font-mono text-xs text-muted-foreground"
          >
            {queue}
          </Link>
        }
        title={task.type}
        titleClassName="mt-1 font-mono wrap-anywhere"
        description={
          <span className="flex flex-wrap items-center gap-2 pt-0.5 text-foreground">
            <StateBadge state={task.state} data-testid="task-state" />
            <span className="font-mono text-xs text-muted-foreground">
              {task.id}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Copy task ID"
              onClick={() =>
                navigator.clipboard.writeText(task.id).then(
                  () => toast.success("Task ID copied."),
                  () => toast.error("Clipboard access failed."),
                )
              }
            >
              <Copy size={14} />
            </Button>
          </span>
        }
        actions={task.actions.map((a) => (
          <Button
            key={a}
            variant={a === "delete" ? "destructive" : "secondary"}
            disabled={
              session.data?.role !== "admin" ||
              (a === "clone" &&
                (task.payload.truncated || task.payload.encoding === "base64"))
            }
            onClick={() => openAction(a)}
          >
            {a === "retry"
              ? "Run now"
              : a === "clone"
                ? "Clone task"
                : a[0].toUpperCase() + a.slice(1)}
          </Button>
        ))}
      />
      {!gone && <Stale error={query.error} />}
      <TaskStatus task={task} gone={gone} />
      <div className={cardColumns()}>
        <div>
          {task.last_error && (
            <Section>
              <SectionHeader
                title="Last error"
                action={
                  <span className="text-xs text-muted-foreground">
                    {date(task.last_failed_at)}
                  </span>
                }
              />
              <SectionBody>
                <pre className="font-mono text-xs leading-[1.7] whitespace-pre-wrap text-red wrap-anywhere">
                  {task.last_error}
                </pre>
              </SectionBody>
            </Section>
          )}
          <PayloadPanel title="Payload" payload={task.payload} />
          {task.result.bytes > 0 && (
            <PayloadPanel title="Result" payload={task.result} />
          )}
        </div>
        <div>
          <Section>
            <SectionHeader title="Task details" />
            <SectionBody>
              <dl className="grid grid-cols-[minmax(96px,0.8fr)_1.2fr] gap-3 text-sm [&>dd]:wrap-anywhere [&>dt]:text-muted-foreground">
                <dt>Queue</dt>
                <dd>
                  <Link
                    className="font-mono font-medium text-foreground"
                    to="/queues/$queue"
                    params={{ queue }}
                  >
                    {queue}
                  </Link>
                </dd>
                <dt>Schedule</dt>
                <dd>
                  {task.schedule || task.state === "scheduled" ? (
                    <TaskSchedule task={task} />
                  ) : (
                    <span className="text-muted-foreground">
                      Enqueued directly
                    </span>
                  )}
                </dd>
                <dt>Attempts</dt>
                <dd className="font-mono">
                  {attempts(task)} of {task.max_retry + 1}
                </dd>
                <dt>Timeout</dt>
                <dd>
                  {task.timeout_seconds
                    ? duration(task.timeout_seconds)
                    : "Server default"}
                </dd>
                <dt>Deadline</dt>
                <dd>
                  {task.deadline || worker?.deadline ? (
                    date(task.deadline ?? worker?.deadline)
                  ) : (
                    <span className="text-muted-foreground">None set</span>
                  )}
                </dd>
                <dt>Retention</dt>
                <dd>{duration(task.retention_seconds)}</dd>
                <dt>Group</dt>
                <dd className="font-mono">{task.group || "None"}</dd>
              </dl>
            </SectionBody>
          </Section>
          <Section>
            <SectionHeader
              title="Timestamps"
              info={
                <InfoTip label="About timestamps">
                  Asynq keeps only selected timestamps and the last error. A
                  full attempt history and the enqueue time need instrumentation
                  in your workers.
                </InfoTip>
              }
            />
            <SectionBody>
              <ol>
                {events.map((e) => (
                  <li
                    key={e.title}
                    className="grid grid-cols-[16px_1fr] gap-3 pb-5 last:pb-0"
                  >
                    <span className="mt-1.5 size-[7px] rounded-full bg-primary" />
                    <div>
                      <h3 className="text-base font-semibold">{e.title}</h3>
                      <p className="text-muted-foreground text-xs">
                        {date(e.time)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
              {!events.length && (
                <p className="text-muted-foreground text-xs">
                  Asynq hasn’t kept any timestamps for this task yet.
                </p>
              )}
            </SectionBody>
          </Section>
          {Object.keys(task.headers).length > 0 && (
            <Section>
              <SectionHeader title="Task headers" />
              <SectionBody>
                <ScrollArea
                  className={payloadScroll}
                  tabIndex={0}
                  aria-label="Task header contents"
                >
                  <pre className={payloadText}>
                    {JSON.stringify(task.headers, null, 2)}
                  </pre>
                </ScrollArea>
              </SectionBody>
            </Section>
          )}
        </div>
      </div>
      <OperationDialog
        kind={action === "clone" ? "form" : "confirm"}
        open={!!action}
        onOpenChange={(open) => !open && !pending && setAction(null)}
        title={
          action === "clone"
            ? "Clone task"
            : `${action === "retry" ? "Run" : capitalize(action ?? "update")} this task?`
        }
        description={
          action === "delete"
            ? "This permanently removes the task, its payload and its last error."
            : action === "cancel"
              ? "The worker stops the task only if its handler checks for cancellation."
              : action === "clone"
                ? "This enqueues a copy with a new ID. Review the payload and options first."
                : "The task’s current state is checked first, and the action is recorded in the audit log."
        }
      >
        {action === "clone" ? (
          <form className={dialogForm} onSubmit={cloneTask}>
            <Field>
              <FieldLabel htmlFor={`${fieldsID}-queue`}>Queue</FieldLabel>
              <Input id={`${fieldsID}-queue`} {...form.register("queue")} />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${fieldsID}-type`}>Type</FieldLabel>
              <Input id={`${fieldsID}-type`} {...form.register("type")} />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${fieldsID}-payload`}>Payload</FieldLabel>
              <Textarea
                id={`${fieldsID}-payload`}
                className="font-mono"
                rows={8}
                {...form.register("payload")}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${fieldsID}-max_retry`}>
                Maximum retries
              </FieldLabel>
              <Input
                id={`${fieldsID}-max_retry`}
                type="number"
                min={0}
                max={100}
                {...form.register("max_retry", { valueAsNumber: true })}
              />
            </Field>
            <Alert role="note" className={notice}>
              <AlertDescription className={noticeText}>
                The copy keeps results for 24 hours and uses the worker’s
                default timeout. Uniqueness, schedule, group and deadline
                settings aren’t copied.
              </AlertDescription>
            </Alert>
            {Object.values(form.formState.errors).map((e, i) => (
              <FieldError className={formError} key={i}>
                {e.message}
              </FieldError>
            ))}
            {error && (
              <FieldError role="alert" className={formError}>
                {error}
              </FieldError>
            )}
            <DialogFooter className={dialogActions}>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => setAction(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Enqueueing…" : "Confirm and enqueue"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <>
            {error && (
              <FieldError role="alert" className={cn(formError, "mt-4")}>
                {error}
              </FieldError>
            )}
            <DialogFooter className={dialogActions}>
              <AlertDialogCancel
                variant="secondary"
                disabled={pending}
                onClick={() => setAction(null)}
              >
                Cancel
              </AlertDialogCancel>
              <Button
                variant={action === "delete" ? "destructive" : "default"}
                disabled={pending}
                onClick={run}
              >
                {pending
                  ? "Applying…"
                  : action === "retry"
                    ? "Confirm run now"
                    : `Confirm ${action}`}
              </Button>
            </DialogFooter>
          </>
        )}
      </OperationDialog>
    </>
  );
}
