import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
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
import { Badge as UiBadge } from "@/components/ui/badge";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CardContent, Card, CardHeader, CardTitle } from "@/components/ui/card";
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
  RefreshCw,
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
import {
  Badge,
  DataError,
  Empty,
  Loading,
  Stale,
} from "../components/data-state";
import { date, duration, number } from "../lib/utils";
import { errorMessage } from "../api/client";
import { invalidateOperational, queryClient } from "./queries";
import { useSession } from "./session";
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
          `${failed.length} action${failed.length === 1 ? "" : "s"} failed. Inspect task states and audit records.`,
        );
      else
        toast.success(
          `${result.data.length} task${result.data.length === 1 ? "" : "s"} updated.`,
        );
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
                className="table-link"
                to="/tasks/$queue/$id"
                params={{ queue: row.original.queue, id: row.original.id }}
              >
                {row.original.type}
              </Link>
              <div className="mono muted small" style={{ marginTop: 4 }}>
                {row.original.id}
              </div>
            </div>
          ),
        }),
        helper.accessor("queue", {
          header: "Queue",
          cell: ({ row }) => (
            <Link
              className="mono"
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
              <Badge state={row.original.state} />
              {row.original.orphaned && (
                <div className="danger small">Orphaned · awaiting recovery</div>
              )}
            </>
          ),
        }),
        helper.accessor("retried", {
          header: "Retries",
          cell: ({ row }) => (
            <span className="mono">
              {row.original.retried} / {row.original.max_retry}
            </span>
          ),
        }),
        helper.display({
          id: "time",
          header:
            preset === "scheduled"
              ? "Next process"
              : "Last failure / next process",
          cell: ({ row }) => (
            <span className="small muted">
              {date(
                (preset === "scheduled"
                  ? row.original.next_process_at
                  : row.original.last_failed_at) ??
                  row.original.next_process_at ??
                  row.original.completed_at,
              )}
            </span>
          ),
        }),
        helper.accessor("last_error", {
          header: "Last error",
          cell: ({ row }) => (
            <span
              className={row.original.last_error ? "danger" : "muted"}
              style={{ display: "block", maxWidth: 340, whiteSpace: "normal" }}
            >
              {row.original.last_error || "—"}
            </span>
          ),
        }),
      ]),
    [query.data, selection, preset],
  );
  const empty: TaskSummary[] = useMemo(() => [], []);
  const table = useTable({
    features,
    columns,
    data: query.data?.data ?? empty,
    getRowId: (t) => `${t.queue}/${t.id}`,
  });
  const title =
    preset === "failed"
      ? "Failures"
      : preset === "scheduled"
        ? "Scheduled tasks"
        : "Tasks";
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
        <TabsList variant="line" className="table-tabs" aria-label="Task views">
          {preset === "scheduled" ? (
            <>
              <TabsTrigger asChild value="scheduled">
                <Link
                  className="table-tab selected"
                  to="/scheduled"
                  search={{ queue }}
                  aria-current="page"
                >
                  Scheduled tasks{" "}
                  <UiBadge className="tab-count">
                    {number(stateCount("scheduled"))}
                  </UiBadge>
                </Link>
              </TabsTrigger>
              <TabsTrigger asChild value="periodic">
                <Link className="table-tab" to="/schedulers">
                  Periodic schedules{" "}
                  <UiBadge className="tab-count">
                    {number(schedules.data?.data.length ?? 0)}
                  </UiBadge>
                </Link>
              </TabsTrigger>
              <TabsTrigger asChild value="retry">
                <Link
                  className="table-tab"
                  to="/tasks"
                  search={{ queue, state: "retry" }}
                >
                  Retrying{" "}
                  <UiBadge className="tab-count">
                    {number(stateCount("retry"))}
                  </UiBadge>
                </Link>
              </TabsTrigger>
            </>
          ) : preset === "failed" ? (
            <>
              <TabsTrigger asChild value="failed">
                <Link
                  className="table-tab selected"
                  to="/failures"
                  search={{ queue }}
                  aria-current="page"
                >
                  All failures{" "}
                  <UiBadge className="tab-count">
                    {number(stateCount("retry") + stateCount("archived"))}
                  </UiBadge>
                </Link>
              </TabsTrigger>
              <TabsTrigger asChild value="retry">
                <Link
                  className="table-tab"
                  to="/tasks"
                  search={{ queue, state: "retry" }}
                >
                  Retrying{" "}
                  <UiBadge className="tab-count">
                    {number(stateCount("retry"))}
                  </UiBadge>
                </Link>
              </TabsTrigger>
              <TabsTrigger asChild value="archived">
                <Link
                  className="table-tab"
                  to="/tasks"
                  search={{ queue, state: "archived" }}
                >
                  Archived{" "}
                  <UiBadge className="tab-count">
                    {number(stateCount("archived"))}
                  </UiBadge>
                </Link>
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
                ...(state === "completed" ||
                state === "aggregating" ||
                state === "failed"
                  ? [state]
                  : []),
              ] as const
            ).map((tab) => (
              <TabsTrigger
                value={tab || "all"}
                className="table-tab"
                key={tab}
                type="button"
              >
                {tab ? tab[0].toUpperCase() + tab.slice(1) : "All"}
                <UiBadge className="tab-count">
                  {number(
                    tab === "failed"
                      ? stateCount("retry") + stateCount("archived")
                      : tab
                        ? stateCount(tab)
                        : states
                            .filter((s) => s !== "aggregating")
                            .reduce((sum, s) => sum + stateCount(s), 0),
                  )}
                </UiBadge>
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
          asChild
        >
          <form
            className="filters"
            onSubmit={form.handleSubmit((values) =>
              navigate({
                to: ".",
                search: (old) => ({ ...old, ...values, cursor: "" }),
              }),
            )}
          >
            {!scopedQueue && (
              <Field>
                <Label htmlFor={`${filtersID}-queue`}>Queue</Label>
                <Controller
                  name="queue"
                  control={form.control}
                  render={({ field }) => (
                    <Select
                      value={field.value ? `queue:${field.value}` : "all"}
                      onValueChange={(value) =>
                        field.onChange(value === "all" ? "" : value.slice(6))
                      }
                    >
                      <SelectTrigger
                        id={`${filtersID}-queue`}
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
              <Field>
                <Label htmlFor={`${filtersID}-state`}>State</Label>
                <Controller
                  name="state"
                  control={form.control}
                  render={({ field }) => (
                    <Select
                      value={field.value || "all"}
                      onValueChange={(value) =>
                        field.onChange(value === "all" ? "" : value)
                      }
                    >
                      <SelectTrigger
                        id={`${filtersID}-state`}
                        ref={field.ref}
                        onBlur={field.onBlur}
                      >
                        <SelectValue placeholder="All inspectable states" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">
                          All inspectable states
                        </SelectItem>
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
            <Field>
              <FieldLabel htmlFor={`${filtersID}-type`}>Task type</FieldLabel>
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
            <Button
              variant="secondary"
              type="submit"
              style={{ alignSelf: "end" }}
            >
              Apply filters
            </Button>
            <CollapsibleTrigger asChild>
              <Button
                variant="secondary"
                type="button"
                className="advanced-trigger"
              >
                <SlidersHorizontal size={15} />
                Filter
                {(search.id ||
                  search.group ||
                  search.min_retry ||
                  search.failed_after) && <span className="dot" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="advanced-filters">
              <Field>
                <FieldLabel htmlFor={`${filtersID}-id`}>Task ID</FieldLabel>
                <Input
                  id={`${filtersID}-id`}
                  placeholder="Exact ID…"
                  {...form.register("id")}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${filtersID}-min_retry`}>
                  Minimum retries
                </FieldLabel>
                <Input
                  id={`${filtersID}-min_retry`}
                  type="number"
                  min={0}
                  max={100000}
                  style={{ width: 100 }}
                  {...form.register("min_retry", { valueAsNumber: true })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${filtersID}-group`}>Group</FieldLabel>
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
                <FieldError
                  id={`${filtersID}-group-error`}
                  className="form-error"
                >
                  {form.formState.errors.group.message}
                </FieldError>
              )}
              <Field>
                <FieldLabel htmlFor={`${filtersID}-failed_after`}>
                  Failed after
                </FieldLabel>
                <Input
                  id={`${filtersID}-failed_after`}
                  placeholder="2026-10-02T12:00:00Z"
                  {...form.register("failed_after")}
                />
              </Field>
            </CollapsibleContent>
          </form>
        </Collapsible>
        <Alert role="note" className="filter-info">
          <AlertDescription>
            Type, retry, and failure-time filters apply to the current page of
            up to 50 tasks.
          </AlertDescription>
        </Alert>
        {selected.length > 0 && (
          <div className="filters">
            <span className="small">{selected.length} selected</span>
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
          </div>
        )}
        {query.isPending ? (
          <Loading />
        ) : query.error && !query.data ? (
          <CardContent className="section-body">
            <DataError error={query.error} retry={() => query.refetch()} />
          </CardContent>
        ) : (
          <>
            <Stale error={query.error} />
            {!query.data?.data.length ? (
              <Empty
                title={
                  query.data?.pagination.has_more
                    ? "No matching tasks in this page"
                    : "No tasks in this view"
                }
              >
                {query.data?.pagination.has_more
                  ? "Use Next page to inspect the next bounded page, or narrow the queue and state filters."
                  : "Adjust the filters or enqueue tasks in this environment."}
              </Empty>
            ) : (
              <div className="table-wrap">
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
              </div>
            )}
            <div className="pagination">
              <span className="muted small">
                {query.data?.data.length ?? 0} matches in this page ·{" "}
                {number(query.data?.pagination.total ?? 0)} tasks before page
                filters
              </span>
              <Pagination className="m-0 w-auto" aria-label="Task pages">
                <PaginationContent className="pagination-buttons">
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
            </div>
          </>
        )}
      </TabsContent>
    </Tabs>
  );
  return (
    <>
      {!embedded && (
        <div className="page-heading">
          <div>
            <h1>{title}</h1>
            <p>
              {preset === "failed"
                ? "Inspect retained failures, understand the last error, and retry eligible tasks."
                : preset === "scheduled"
                  ? "Tasks waiting for a future processing time."
                  : "Inspect tasks across queues without scanning your Redis database."}
            </p>
          </div>
          <div className="heading-actions">
            {preset === "scheduled" && (
              <Button asChild variant="secondary">
                <Link to="/schedulers">Periodic schedules</Link>
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
            <Button
              variant="secondary"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCw size={14} />
              Refresh
            </Button>
          </div>
        </div>
      )}
      {!embedded && preset === "scheduled" && (
        <div className="summary-grid">
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
            note="Registered in this environment"
          >
            <Link className="table-link summary-link" to="/schedulers">
              Inspect cron entries <ChevronRight size={13} />
            </Link>
            <p className="small muted">Managed by your Asynq scheduler</p>
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
            note="Retained tasks with a retry time"
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
            label="Next in this page"
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
                  : "No scheduled tasks in this page"
            }
          >
            {nextTask ? (
              <>
                <Link
                  className="table-link"
                  to="/tasks/$queue/$id"
                  aria-label={`Inspect next task ${nextTask.type}`}
                  params={{ queue: nextTask.queue, id: nextTask.id }}
                >
                  {nextTask.type}
                </Link>
                <p className="mono small muted">{nextTask.queue}</p>
              </>
            ) : (
              <p>Inspect tasks to see their next processing time.</p>
            )}
          </SummaryCard>
        </div>
      )}
      <Card className="section">
        <CardHeader className="section-heading">
          <div>
            <h2>
              {embedded
                ? "Queue tasks"
                : preset === "scheduled"
                  ? "Upcoming tasks"
                  : preset === "failed"
                    ? "Retained failures"
                    : "Task explorer"}
            </h2>
            <p className="muted small">
              {number(query.data?.pagination.total ?? 0)} tasks before page
              filters
            </p>
          </div>
          {embedded ? (
            <Link
              to="/tasks"
              search={{ queue: scopedQueue }}
              className="table-link small"
            >
              Open explorer
            </Link>
          ) : (
            <UiBadge className="badge">Live snapshot</UiBadge>
          )}
        </CardHeader>
        {content}
      </Card>
      <OperationDialog
        open={!!bulk}
        onOpenChange={(open) =>
          !open && !bulkMutation.isPending && setBulk(null)
        }
        title={`${bulk ?? "Update"} ${selected.length} selected tasks?`}
        description="Tasks are checked against their current state. Each action receives an audit record; partial failures are reported."
      >
        <Alert role="note" className="notice">
          <AlertDescription>
            {bulk === "delete"
              ? "Deletion permanently removes retained task data."
              : "Ineligible tasks will fail safely without changing their state."}
          </AlertDescription>
        </Alert>
        <DialogFooter className="dialog-actions">
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
        kind="form"
        open={save}
        onOpenChange={setSave}
        title="Save this view"
        description="Store the current filters and URL for later."
      >
        <form
          className="form"
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
            <FieldError className="form-error">
              {viewForm.formState.errors.name.message}
            </FieldError>
          )}
          <DialogFooter className="dialog-actions">
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
function PayloadPanel({ payload, title }: { payload: Payload; title: string }) {
  return (
    <Card className="section">
      <CardHeader className="section-heading">
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        <div className="toolbar">
          <span className="muted small">
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
      </CardHeader>
      <CardContent className="section-body">
        {payload.truncated && (
          <Alert role="note" className="notice" style={{ marginBottom: 12 }}>
            <AlertDescription>
              Display truncated at 256 KiB. This is not the complete payload.
            </AlertDescription>
          </Alert>
        )}
        <ScrollArea
          className="payload-scroll"
          tabIndex={0}
          aria-label={`${title} contents`}
        >
          <pre className="payload">
            {payload.bytes ? formatPayload(payload) : "No data stored."}
          </pre>
        </ScrollArea>
      </CardContent>
    </Card>
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
  const query = useQuery(getTaskOptions({ path: { queue, id } }));
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
          ? "Cancellation requested. The worker must acknowledge it."
          : `Task ${action === "retry" ? "queued for processing" : action === "archive" ? "archived" : "deleted"}.`,
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
    { title: "Last failure", time: task.last_failed_at },
    { title: "Next processing time", time: task.next_process_at },
    { title: "Completed", time: task.completed_at },
  ]
    .filter((e) => e.time)
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));
  return (
    <>
      <div className="page-heading">
        <div>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to="/tasks" search={{ queue }}>
                    Tasks
                  </Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{queue}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <h1 className="mono task-heading" style={{ marginTop: 8 }}>
            {task.type}
          </h1>
          <div className="toolbar" style={{ marginTop: 10 }}>
            <Badge state={task.state} />
            <span className="mono muted small">{task.id}</span>
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
          </div>
        </div>
        <div className="heading-actions">
          {task.actions.map((a) => (
            <Button
              key={a}
              variant={a === "delete" ? "destructive" : "secondary"}
              disabled={
                session.data?.role !== "admin" ||
                (a === "clone" &&
                  (task.payload.truncated ||
                    task.payload.encoding === "base64"))
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
        </div>
      </div>
      <Stale error={query.error} />
      {task.orphaned && (
        <Alert variant="destructive" className="mb-5">
          <AlertDescription>
            This active task is orphaned. Asynq will recover it when a server
            processes the queue.
          </AlertDescription>
        </Alert>
      )}
      <div className="two-columns">
        <div>
          {task.last_error && (
            <Card className="section">
              <CardHeader className="section-heading">
                <CardTitle>
                  <h2>Last error</h2>
                </CardTitle>
                <span className="muted small">{date(task.last_failed_at)}</span>
              </CardHeader>
              <CardContent className="section-body">
                <pre className="error-text mono">{task.last_error}</pre>
              </CardContent>
            </Card>
          )}
          <PayloadPanel title="Payload" payload={task.payload} />
          {task.result.bytes > 0 && (
            <PayloadPanel title="Result" payload={task.result} />
          )}
        </div>
        <div>
          <Card className="section">
            <CardHeader className="section-heading">
              <CardTitle>
                <h2>Task details</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="section-body">
              <dl className="metadata">
                <dt>Queue</dt>
                <dd>
                  <Link
                    className="mono table-link"
                    to="/queues/$queue"
                    params={{ queue }}
                  >
                    {queue}
                  </Link>
                </dd>
                <dt>Retries</dt>
                <dd className="mono">
                  {task.retried} / {task.max_retry}
                </dd>
                <dt>Timeout</dt>
                <dd>
                  {task.timeout_seconds
                    ? duration(task.timeout_seconds)
                    : "Not specified"}
                </dd>
                <dt>Deadline</dt>
                <dd>{date(task.deadline)}</dd>
                <dt>Retention</dt>
                <dd>{duration(task.retention_seconds)}</dd>
                <dt>Group</dt>
                <dd className="mono">{task.group || "None"}</dd>
              </dl>
            </CardContent>
          </Card>
          <Card className="section">
            <CardHeader className="section-heading">
              <CardTitle>
                <h2>Observed timestamps</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="section-body">
              <ol className="timeline">
                {events.map((e) => (
                  <li key={e.title}>
                    <span className="timeline-mark" />
                    <div>
                      <h3>{e.title}</h3>
                      <p className="muted small">{date(e.time)}</p>
                    </div>
                  </li>
                ))}
              </ol>
              {!events.length && (
                <p className="muted small">
                  No lifecycle timestamps retained for this state.
                </p>
              )}
              <Alert role="note" className="notice">
                <AlertDescription>
                  Asynq retains selected timestamps and the last error. A full
                  attempt timeline and enqueue time require worker
                  instrumentation.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
          {Object.keys(task.headers).length > 0 && (
            <Card className="section">
              <CardHeader className="section-heading">
                <CardTitle>
                  <h2>Task headers</h2>
                </CardTitle>
              </CardHeader>
              <CardContent className="section-body">
                <ScrollArea
                  className="payload-scroll"
                  tabIndex={0}
                  aria-label="Task header contents"
                >
                  <pre className="payload">
                    {JSON.stringify(task.headers, null, 2)}
                  </pre>
                </ScrollArea>
              </CardContent>
            </Card>
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
            : `${action === "retry" ? "Run" : (action ?? "Update")} this task?`
        }
        description={
          action === "delete"
            ? "Deletion permanently removes this task and its retained payload and error."
            : action === "cancel"
              ? "Cancellation is cooperative. The worker must acknowledge the request."
              : action === "clone"
                ? "A new task ID is created. Review the payload and options before enqueueing."
                : "This action checks the current state and is recorded in the audit log."
        }
      >
        {action === "clone" ? (
          <form className="form" onSubmit={cloneTask}>
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
                className="mono"
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
            <Alert role="note" className="notice">
              <AlertDescription>
                The new task uses 24-hour retention and the worker's default
                timeout. Original unique, schedule, group and deadline options
                are not copied.
              </AlertDescription>
            </Alert>
            {Object.values(form.formState.errors).map((e, i) => (
              <FieldError className="form-error" key={i}>
                {e.message}
              </FieldError>
            ))}
            {error && (
              <FieldError role="alert" className="form-error">
                {error}
              </FieldError>
            )}
            <DialogFooter className="dialog-actions">
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
              <FieldError
                role="alert"
                className="form-error"
                style={{ marginTop: 16 }}
              >
                {error}
              </FieldError>
            )}
            <DialogFooter className="dialog-actions">
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
