import {
  Meter,
  PageHeader,
  RunStatus,
  Section,
  SectionHeader,
  StatTile,
  StateBadge,
  StatusDot,
  statGrid,
  cardX,
  dividedList,
  type Tone,
  cardColumns,
} from "@/components/page";
import { cn, number } from "@/lib/utils";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Pause, Play, Trash2 } from "lucide-react";
import {
  getTaskOptions,
  listQueuesOptions,
  listServersOptions,
  listServersQueryKey,
  listTasksOptions,
} from "../api/generated/@tanstack/react-query.gen";
import type {
  ServerList,
  TaskSummary,
  Worker,
} from "../api/generated/types.gen";
import { Button } from "../components/ui/button";
import { DataError, Empty, Loading, Stale } from "../components/data-state";
import { InfoTip } from "../components/info-tip";
import { CronChip } from "./schedules";
import { clock, dueIn, runState, timeOfDay, useNow } from "../lib/time";
import { queryClient } from "./queries";
const SAMPLE_MS = 2_000;
const UP_NEXT_MS = 5_000;
const TAIL_LIMIT = 200;
// Bounds outcome lookups per sample so a burst of completions cannot fan out.
const RESOLVE_LIMIT = 8;
type Running = Worker & { host: string; pid: number };
type Outcome = "succeeded" | "retrying" | "archived" | "requeued" | "finished";
type TailEvent = {
  id: number;
  at: number;
  kind: "started" | "finished";
  queue: string;
  taskId: string;
  type: string;
  ranMs?: number;
  outcome?: Outcome;
};
const workerKey = (w: Worker) => `${w.queue}/${w.task_id}`;
const flatten = (servers?: ServerList): Running[] =>
  (servers?.data ?? []).flatMap((s) =>
    s.workers.map((w) => ({ ...w, host: s.host, pid: s.pid })),
  );
async function resolveOutcome(queue: string, id: string): Promise<Outcome> {
  try {
    const task = await queryClient.fetchQuery({
      ...getTaskOptions({ path: { queue, id } }),
      staleTime: 0,
    });
    if (task.state === "completed") return "succeeded";
    if (task.state === "retry") return "retrying";
    if (task.state === "archived") return "archived";
    return "requeued";
  } catch {
    // Tasks without retention are deleted on success.
    return "finished";
  }
}
/** Diffs successive worker snapshots into started/finished tail events. */
function useTail(paused: boolean) {
  const [tail, setTail] = useState<TailEvent[]>([]);
  const seen = useRef<Map<string, Running> | null>(null);
  const nextId = useRef(0);
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  useEffect(() => {
    const serversId = listServersQueryKey()[0]._id;
    const ingest = (data?: ServerList) => {
      const current = new Map(flatten(data).map((w) => [workerKey(w), w]));
      const previous = seen.current;
      seen.current = current;
      if (!previous) return;
      const at = Date.now();
      const event = (w: Running, kind: TailEvent["kind"]): TailEvent => ({
        id: nextId.current++,
        at,
        kind,
        queue: w.queue,
        taskId: w.task_id,
        type: w.task_type,
        ranMs: kind === "finished" ? at - Date.parse(w.started) : undefined,
      });
      const started = [...current.values()]
        .filter((w) => !previous.has(workerKey(w)))
        .map((w) => event(w, "started"));
      const finished = [...previous.values()]
        .filter((w) => !current.has(workerKey(w)))
        .map((w) => event(w, "finished"));
      if (!started.length && !finished.length) return;
      setTail((t) => [...finished, ...started, ...t].slice(0, TAIL_LIMIT));
      for (const e of finished.slice(0, RESOLVE_LIMIT))
        resolveOutcome(e.queue, e.taskId).then((outcome) =>
          setTail((t) => t.map((x) => (x.id === e.id ? { ...x, outcome } : x))),
        );
    };
    const cached = queryClient.getQueryData<ServerList>(listServersQueryKey());
    if (cached)
      seen.current = new Map(flatten(cached).map((w) => [workerKey(w), w]));
    return queryClient.getQueryCache().subscribe((e) => {
      const key = e.query.queryKey[0];
      if (
        e.type === "updated" &&
        e.action.type === "success" &&
        !pausedRef.current &&
        typeof key === "object" &&
        key !== null &&
        "_id" in key &&
        key._id === serversId
      )
        ingest(e.query.state.data as ServerList);
    });
  }, []);
  return { tail, clear: () => setTail([]) };
}
const outcomes: Record<Outcome | "started", { label: string; tone: Tone }> = {
  started: { label: "Started", tone: "purple" },
  succeeded: { label: "Succeeded", tone: "green" },
  retrying: { label: "Failed · retrying", tone: "amber" },
  archived: { label: "Failed · archived", tone: "red" },
  requeued: { label: "Requeued", tone: "muted" },
  finished: { label: "Finished", tone: "muted" },
};
export function LivePage() {
  const search = useSearch({ from: "__root__" });
  const navigate = useNavigate();
  const [paused, setPaused] = useState(false);
  const now = useNow(paused);
  const servers = useQuery({
    ...listServersOptions(),
    refetchInterval: paused ? false : SAMPLE_MS,
    staleTime: 0,
  });
  const queues = useQuery({
    ...listQueuesOptions(),
    refetchInterval: paused ? false : UP_NEXT_MS,
  });
  const { tail, clear } = useTail(paused);
  const queue = search.queue;
  const scoped = (queues.data?.data ?? []).filter(
    (q) => !queue || q.name === queue,
  );
  const upNextQueries = useQueries({
    queries: scoped.slice(0, 12).flatMap((q) =>
      (["scheduled", "retry"] as const)
        .filter((state) => q[state] > 0)
        .map((state) => ({
          ...listTasksOptions({ query: { queue: q.name, state, limit: 10 } }),
          refetchInterval: paused ? false : UP_NEXT_MS,
        })),
    ),
  });
  const upNext = upNextQueries
    .flatMap((q) => q.data?.data ?? [])
    .filter((t): t is TaskSummary & { next_process_at: string } =>
      Boolean(t.next_process_at),
    )
    .sort((a, b) => a.next_process_at.localeCompare(b.next_process_at))
    .slice(0, 10);
  const running = useMemo(
    () =>
      flatten(servers.data)
        .filter((w) => !queue || w.queue === queue)
        .sort((a, b) => a.started.localeCompare(b.started)),
    [servers.data, queue],
  );
  const capacity = (servers.data?.data ?? []).reduce(
    (total, s) => total + s.concurrency,
    0,
  );
  const backlog = scoped.reduce((total, q) => total + q.pending, 0);
  const longest = running[0];
  const nextDue = upNext[0];
  const visibleTail = tail.filter((e) => !queue || e.queue === queue);
  return (
    <>
      <PageHeader
        title="Live activity"
        info={
          <InfoTip label="How live activity works">
            Running tasks come from worker heartbeats sampled every{" "}
            {SAMPLE_MS / 1000} seconds, so tasks that start and finish between
            samples do not appear in the tail. Outcomes are looked up after a
            task leaves its worker; tasks that are not retained after success
            show as Finished.
          </InfoTip>
        }
        description="Tasks processing right now, what runs next, and a running tail of starts and finishes."
        actions={
          <>
            <Select
              value={queue ? `queue:${queue}` : "all"}
              onValueChange={(value) =>
                navigate({
                  to: "/live",
                  search: (old) => ({
                    ...old,
                    queue: value === "all" ? "" : value.slice(6),
                  }),
                })
              }
            >
              <SelectTrigger aria-label="Queue" className="min-w-40">
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
            <Button
              variant="secondary"
              onClick={() => setPaused((p) => !p)}
              aria-pressed={paused}
            >
              {paused ? <Play size={14} /> : <Pause size={14} />}
              {paused ? "Resume" : "Pause"}
            </Button>
          </>
        }
      />
      <div className={statGrid()}>
        <StatTile
          label="Running now"
          value={
            <>
              {running.length}
              {!queue && capacity > 0 && <small> / {capacity} slots</small>}
            </>
          }
        >
          {!queue && capacity > 0 && (
            <Meter
              value={running.length / capacity}
              tone="green"
              size="full"
              className="mt-1"
            />
          )}
        </StatTile>
        <StatTile
          label="Waiting"
          value={
            <>
              {number(backlog)}
              <small> pending</small>
            </>
          }
        />
        <StatTile
          label="Longest running"
          value={longest ? clock(now - Date.parse(longest.started)) : "—"}
          detail={
            longest && <span className="font-mono">{longest.task_type}</span>
          }
        />
        <StatTile
          label="Next due"
          value={nextDue ? dueIn(nextDue.next_process_at, now) : "—"}
          detail={nextDue && <span className="font-mono">{nextDue.type}</span>}
        />
      </div>
      <Section>
        <SectionHeader
          title="Running now"
          description={
            paused
              ? "Paused — showing the last sample"
              : `Sampled every ${SAMPLE_MS / 1000}s from worker heartbeats`
          }
          action={
            <LivePill live={!paused && !servers.error}>
              {paused ? "Paused" : "Live"}
            </LivePill>
          }
        />
        <Stale error={servers.error} />
        {servers.isPending ? (
          <Loading rows={3} />
        ) : servers.error && !servers.data ? (
          <DataError error={servers.error} retry={() => servers.refetch()} />
        ) : !running.length ? (
          <Empty title="Nothing is processing">
            {servers.data?.data.length
              ? "Workers are idle. New tasks appear here as soon as a worker picks them up."
              : "No Asynq servers are running."}
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Task</TableHead>
                <TableHead>Queue</TableHead>
                <TableHead>Worker</TableHead>
                <TableHead>Started</TableHead>
                <TableHead className="text-right tabular-nums">
                  Running for
                </TableHead>
                <TableHead>Deadline</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {running.map((w) => {
                const state = runState(w, now);
                const tone = state.tone as Tone;
                return (
                  <TableRow key={workerKey(w)}>
                    <TableCell>
                      <RunStatus tone={tone} pulse={tone === "green"}>
                        {state.label}
                      </RunStatus>
                    </TableCell>
                    <TableCell>
                      <Link
                        className="font-mono font-medium text-foreground"
                        to="/tasks/$queue/$id"
                        params={{ queue: w.queue, id: w.task_id }}
                      >
                        {w.task_type}
                      </Link>
                      <div className="font-mono text-muted-foreground text-xs">
                        {w.task_id}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono">{w.queue}</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">
                      {w.host} · {w.pid}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {timeOfDay(w.started)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {clock(state.elapsed)}
                    </TableCell>
                    <TableCell>
                      {!state.deadline ? (
                        <span className="text-muted-foreground text-xs">
                          No deadline
                        </span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Meter value={state.deadline.progress} tone={tone} />
                          <span className="text-muted-foreground text-xs tabular-nums">
                            {state.deadline.left > 0
                              ? `${clock(state.deadline.left)} left`
                              : `${clock(-state.deadline.left)} over`}
                          </span>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Section>
      <div className={cardColumns({ layout: "even" })}>
        <Section>
          <SectionHeader
            title="Up next"
            description="Scheduled tasks and retries due soonest"
            action={
              <Link
                to="/scheduled"
                className="font-medium text-foreground text-xs"
              >
                All scheduled
              </Link>
            }
          />
          {queues.isPending ? (
            <Loading rows={3} />
          ) : !upNext.length ? (
            <Empty title="Nothing waiting on a timer">
              No scheduled tasks or retries are queued
              {queue ? ` on ${queue}` : ""}.
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Queue</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="text-right tabular-nums">Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {upNext.map((t) => (
                  <TableRow key={`${t.queue}/${t.id}`}>
                    <TableCell>
                      <Link
                        className="font-mono font-medium text-foreground"
                        to="/tasks/$queue/$id"
                        params={{ queue: t.queue, id: t.id }}
                      >
                        {t.type}
                      </Link>
                      {t.state === "retry" && (
                        <div className="text-muted-foreground text-xs">
                          Attempt {t.retried + 1} of {t.max_retry + 1}
                        </div>
                      )}
                      {t.schedule && <CronChip schedule={t.schedule} />}
                    </TableCell>
                    <TableCell className="font-mono">{t.queue}</TableCell>
                    <TableCell>
                      <StateBadge state={t.state} />
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {dueIn(t.next_process_at, now)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
        <Section>
          <SectionHeader
            title="Activity tail"
            description={
              visibleTail.length
                ? `${visibleTail.length} events since you opened this page`
                : "Waiting for tasks to start or finish"
            }
            action={
              <Button
                variant="ghost"
                size="sm"
                onClick={clear}
                disabled={!tail.length}
              >
                <Trash2 size={14} />
                Clear
              </Button>
            }
          />
          {!visibleTail.length ? (
            <Empty title="No activity yet">
              Starts and finishes appear here as workers pick up and complete
              tasks.
            </Empty>
          ) : (
            <ol
              className={cn(
                dividedList,
                "max-h-[440px] overflow-y-auto py-1.5",
              )}
              aria-live="polite"
              aria-relevant="additions"
            >
              {visibleTail.map((e) => {
                const o =
                  outcomes[
                    e.kind === "started" ? "started" : (e.outcome ?? "finished")
                  ];
                return (
                  <li
                    key={e.id}
                    className={cn(
                      "grid animate-tail-in grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 py-2 text-sm @xl/main:grid-cols-[128px_minmax(0,1fr)_auto] @xl/main:gap-3",
                      cardX,
                    )}
                  >
                    <RunStatus
                      tone={o.tone}
                      className="col-span-full @xl/main:col-auto"
                    >
                      {o.label}
                    </RunStatus>
                    <span className="grid min-w-0 leading-[1.35] *:truncate">
                      <Link
                        className="font-mono font-medium text-foreground"
                        to="/tasks/$queue/$id"
                        params={{ queue: e.queue, id: e.taskId }}
                      >
                        {e.type}
                      </Link>
                      <span className="font-mono text-muted-foreground text-xs">
                        {e.queue}
                      </span>
                    </span>
                    <span className="grid min-w-0 justify-items-end text-2xs leading-[1.35] text-muted-foreground">
                      <time className="font-mono">{timeOfDay(e.at)}</time>
                      {e.ranMs !== undefined && (
                        <span className="tabular-nums">
                          ran {clock(e.ranMs)}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </Section>
      </div>
    </>
  );
}

/** Pill showing whether the page is following live data. */
function LivePill({ live, children }: { live: boolean; children: ReactNode }) {
  return (
    <span className="inline-flex h-7 items-center gap-[7px] rounded-full border bg-surface px-2.5 text-xs text-muted-foreground">
      <StatusDot tone={live ? "green" : "amber"} pulse={live} />
      {children}
    </span>
  );
}
