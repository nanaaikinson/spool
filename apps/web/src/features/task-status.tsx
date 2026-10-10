import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { listServersOptions } from "../api/generated/@tanstack/react-query.gen";
import type { Task } from "../api/generated/types.gen";
import { clock, dueIn, runState, timeOfDay, useNow } from "../lib/time";
import { date, duration } from "../lib/utils";
type Tone = "green" | "amber" | "red" | "purple" | "muted";
type Step = "todo" | "current" | "done" | "failed";
/** States that change without user action; task pages poll while in them. */
export const LIVE_TASK_STATES = new Set<Task["state"]>([
  "active",
  "pending",
  "scheduled",
  "retry",
  "aggregating",
]);
function steps(task: Task): [Step, Step, Step] {
  switch (task.state) {
    case "active":
      return ["done", "current", "todo"];
    case "retry":
      return ["done", "failed", "current"];
    case "completed":
      return ["done", "done", "done"];
    case "archived":
      return ["done", task.last_error ? "failed" : "done", "failed"];
    default:
      return ["current", "todo", "todo"];
  }
}
/** The live worker running this task, from server heartbeats polled every 2s. */
export function useTaskWorker(task: Task | undefined, enabled: boolean) {
  const servers = useQuery({
    ...listServersOptions(),
    enabled,
    refetchInterval: enabled ? 2_000 : false,
  });
  if (!enabled || !task) return undefined;
  return servers.data?.data
    .flatMap((s) => s.workers.map((w) => ({ ...w, host: s.host, pid: s.pid })))
    .find((w) => w.task_id === task.id && w.queue === task.queue);
}
export function TaskStatus({ task, gone }: { task: Task; gone: boolean }) {
  const active = task.state === "active" && !gone;
  const worker = useTaskWorker(task, active);
  const ticking = !gone && LIVE_TASK_STATES.has(task.state);
  const now = useNow(!ticking);
  const run = worker && runState(worker, now);
  const attempts = task.max_retry + 1;
  let tone: Tone;
  let title: string;
  let detail: string;
  if (gone) {
    tone = "muted";
    title = "No longer retained";
    detail =
      "This task left Redis while you were watching. It most likely completed without retention, or it was deleted.";
  } else if (task.state === "active" && task.orphaned) {
    tone = "red";
    title = "Orphaned";
    detail =
      "The worker running this task stopped responding. Asynq recovers it the next time a server processes this queue.";
  } else if (task.state === "active") {
    tone =
      run?.tone === "red" ? "red" : run?.tone === "amber" ? "amber" : "green";
    title = run?.label ?? "Running";
    detail = worker
      ? `Running for ${clock(run!.elapsed)} on ${worker.host} · PID ${worker.pid}, started ${timeOfDay(worker.started)}`
      : "A worker has picked up this task.";
  } else if (task.state === "pending") {
    tone = "amber";
    title = "Queued";
    detail = `Waiting for a free worker on ${task.queue}.`;
  } else if (task.state === "scheduled") {
    tone = "purple";
    title = "Scheduled";
    detail = task.next_process_at
      ? `Runs ${dueIn(task.next_process_at, now)} · ${date(task.next_process_at)}`
      : "Waiting for its scheduled time.";
  } else if (task.state === "retry") {
    tone = "amber";
    title = "Retrying";
    detail = `Attempt ${task.retried} of ${attempts} failed. Attempt ${task.retried + 1} ${
      task.next_process_at
        ? `starts ${dueIn(task.next_process_at, now)}`
        : "is queued"
    }.`;
  } else if (task.state === "archived") {
    tone = "red";
    title = task.last_error ? "Failed" : "Archived";
    detail = task.last_error
      ? `Archived after ${task.retried + 1} of ${attempts} attempts. Last failure ${date(task.last_failed_at)}.`
      : "Archived without a recorded failure.";
  } else if (task.state === "completed") {
    tone = "green";
    title = "Completed";
    detail = `Finished ${date(task.completed_at)}. Retained for ${duration(task.retention_seconds)}.`;
  } else {
    tone = "purple";
    title = "Aggregating";
    detail = `Collecting into group ${task.group || "—"} before processing.`;
  }
  const [queued, running, finished] = steps(task);
  const labels = [
    {
      label: task.state === "scheduled" ? "Scheduled" : "Queued",
      step: queued,
    },
    {
      label: task.state === "retry" ? "Attempt failed" : "Running",
      step: running,
    },
    {
      label:
        task.state === "retry"
          ? "Retry scheduled"
          : task.state === "archived"
            ? "Archived"
            : task.state === "completed"
              ? "Completed"
              : "Finished",
      step: finished,
    },
  ];
  return (
    <section
      className="task-status"
      data-tone={tone}
      data-live={active || undefined}
      aria-label="Task status"
    >
      <div className="task-status-main">
        <span className="task-status-icon" aria-hidden="true">
          <i />
        </span>
        <div className="task-status-text">
          <h2 role="status">{title}</h2>
          <p>{detail}</p>
        </div>
        {run?.deadline && (
          <div className="task-status-deadline">
            <span className="muted small">
              {run.deadline.left > 0
                ? `${clock(run.deadline.left)} until deadline`
                : `${clock(-run.deadline.left)} past deadline`}
            </span>
            <div className="deadline-meter">
              <span
                data-tone={run.tone}
                style={{ width: `${run.deadline.progress * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>
      <ol className="task-steps" aria-label="Lifecycle">
        {labels.map((s, i) => (
          <Fragment key={s.label}>
            {i > 0 && <li className="task-step-line" aria-hidden="true" />}
            <li className="task-step" data-step={s.step}>
              <span className="task-step-dot">
                {s.step === "done" ? (
                  <Check size={11} strokeWidth={3} />
                ) : s.step === "failed" ? (
                  <X size={11} strokeWidth={3} />
                ) : null}
              </span>
              {s.label}
            </li>
          </Fragment>
        ))}
      </ol>
    </section>
  );
}
