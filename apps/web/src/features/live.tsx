import { Card, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  Badge,
  DataError,
  Empty,
  Loading,
  Stale,
} from "../components/data-state";
import { number } from "../lib/utils";
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
const outcomes: Record<Outcome | "started", { label: string; tone: string }> = {
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
      <div className="page-heading">
        <div>
          <h1 className="title-row">
            Live activity
            <InfoTip label="How live activity works">
              Running tasks come from worker heartbeats sampled every{" "}
              {SAMPLE_MS / 1000} seconds, so tasks that start and finish between
              samples do not appear in the tail. Outcomes are looked up after a
              task leaves its worker; tasks that are not retained after success
              show as Finished.
            </InfoTip>
          </h1>
          <p>
            Tasks processing right now, what runs next, and a running tail of
            starts and finishes.
          </p>
        </div>
        <div className="heading-actions">
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
        </div>
      </div>
      <div className="live-stats">
        <div className="live-stat">
          <span>Running now</span>
          <strong>
            {running.length}
            {!queue && capacity > 0 && <small> / {capacity} slots</small>}
          </strong>
          {!queue && capacity > 0 && (
            <div className="deadline-meter" aria-hidden="true">
              <span
                data-tone="green"
                style={{
                  width: `${Math.min(100, (running.length / capacity) * 100)}%`,
                }}
              />
            </div>
          )}
        </div>
        <div className="live-stat">
          <span>Waiting</span>
          <strong>
            {number(backlog)}
            <small> pending</small>
          </strong>
        </div>
        <div className="live-stat">
          <span>Longest running</span>
          <strong className="tabular">
            {longest ? clock(now - Date.parse(longest.started)) : "—"}
          </strong>
          {longest && <small className="mono">{longest.task_type}</small>}
        </div>
        <div className="live-stat">
          <span>Next due</span>
          <strong className="tabular">
            {nextDue ? dueIn(nextDue.next_process_at, now) : "—"}
          </strong>
          {nextDue && <small className="mono">{nextDue.type}</small>}
        </div>
      </div>
      <Card className="section">
        <CardHeader className="section-heading">
          <div>
            <CardTitle>
              <h2>Running now</h2>
            </CardTitle>
            <p className="muted small">
              {paused
                ? "Paused — showing the last sample"
                : `Sampled every ${SAMPLE_MS / 1000}s from worker heartbeats`}
            </p>
          </div>
          <span className="live-status" data-live={!paused && !servers.error}>
            <span className="live-dot" />
            {paused ? "Paused" : "Live"}
          </span>
        </CardHeader>
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
          <div className="table-wrap">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>Queue</TableHead>
                  <TableHead>Worker</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className="numeric">Running for</TableHead>
                  <TableHead>Deadline</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {running.map((w) => {
                  const state = runState(w, now);
                  return (
                    <TableRow key={workerKey(w)}>
                      <TableCell>
                        <span className="run-status" data-tone={state.tone}>
                          <i />
                          {state.label}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Link
                          className="mono table-link"
                          to="/tasks/$queue/$id"
                          params={{ queue: w.queue, id: w.task_id }}
                        >
                          {w.task_type}
                        </Link>
                        <div className="mono muted small">{w.task_id}</div>
                      </TableCell>
                      <TableCell className="mono">{w.queue}</TableCell>
                      <TableCell className="mono muted small">
                        {w.host} · {w.pid}
                      </TableCell>
                      <TableCell className="muted">
                        {timeOfDay(w.started)}
                      </TableCell>
                      <TableCell className="numeric mono">
                        {clock(state.elapsed)}
                      </TableCell>
                      <TableCell>
                        {!state.deadline ? (
                          <span className="muted small">No deadline</span>
                        ) : (
                          <div className="deadline-cell">
                            <div className="deadline-meter">
                              <span
                                data-tone={state.tone}
                                style={{
                                  width: `${state.deadline.progress * 100}%`,
                                }}
                              />
                            </div>
                            <span className="muted small tabular">
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
          </div>
        )}
      </Card>
      <div className="two-columns live-columns">
        <Card className="section">
          <CardHeader className="section-heading">
            <div>
              <CardTitle>
                <h2>Up next</h2>
              </CardTitle>
              <p className="muted small">
                Scheduled tasks and retries due soonest
              </p>
            </div>
            <Link to="/scheduled" className="table-link small">
              All scheduled
            </Link>
          </CardHeader>
          {queues.isPending ? (
            <Loading rows={3} />
          ) : !upNext.length ? (
            <Empty title="Nothing waiting on a timer">
              No scheduled tasks or retries are queued
              {queue ? ` on ${queue}` : ""}.
            </Empty>
          ) : (
            <div className="table-wrap">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task</TableHead>
                    <TableHead>Queue</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead className="numeric">Due</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upNext.map((t) => (
                    <TableRow key={`${t.queue}/${t.id}`}>
                      <TableCell>
                        <Link
                          className="mono table-link"
                          to="/tasks/$queue/$id"
                          params={{ queue: t.queue, id: t.id }}
                        >
                          {t.type}
                        </Link>
                        {t.state === "retry" && (
                          <div className="muted small">
                            Attempt {t.retried + 1} of {t.max_retry + 1}
                          </div>
                        )}
                        {t.schedule && <CronChip schedule={t.schedule} />}
                      </TableCell>
                      <TableCell className="mono">{t.queue}</TableCell>
                      <TableCell>
                        <Badge state={t.state} />
                      </TableCell>
                      <TableCell className="numeric mono">
                        {dueIn(t.next_process_at, now)}
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
            <div>
              <CardTitle>
                <h2>Activity tail</h2>
              </CardTitle>
              <p className="muted small">
                {visibleTail.length
                  ? `${visibleTail.length} events since you opened this page`
                  : "Waiting for tasks to start or finish"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={clear}
              disabled={!tail.length}
            >
              <Trash2 size={14} />
              Clear
            </Button>
          </CardHeader>
          {!visibleTail.length ? (
            <Empty title="No activity yet">
              Starts and finishes appear here as workers pick up and complete
              tasks.
            </Empty>
          ) : (
            <ol className="tail" aria-live="polite" aria-relevant="additions">
              {visibleTail.map((e) => {
                const o =
                  outcomes[
                    e.kind === "started" ? "started" : (e.outcome ?? "finished")
                  ];
                return (
                  <li key={e.id}>
                    <span className="run-status" data-tone={o.tone}>
                      <i />
                      {o.label}
                    </span>
                    <span className="tail-task">
                      <Link
                        className="mono table-link"
                        to="/tasks/$queue/$id"
                        params={{ queue: e.queue, id: e.taskId }}
                      >
                        {e.type}
                      </Link>
                      <span className="mono muted small">{e.queue}</span>
                    </span>
                    <span className="tail-meta">
                      <time className="mono">{timeOfDay(e.at)}</time>
                      {e.ranMs !== undefined && (
                        <span className="tabular">ran {clock(e.ranMs)}</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}
