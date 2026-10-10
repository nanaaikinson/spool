import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { listServersOptions } from "../api/generated/@tanstack/react-query.gen";
import type { Task } from "../api/generated/types.gen";
import { clock, dueIn, runState, timeOfDay, useNow } from "../lib/time";
import { cn, date, duration } from "../lib/utils";
import {
  Meter,
  StatusDot,
  stack,
  toneSoft,
  toneText,
  type Tone,
} from "@/components/page";
/* Left accent border, keyed by tone. */
const toneBorder: Record<Tone, string> = {
  green: "border-l-green",
  amber: "border-l-amber",
  red: "border-l-red",
  purple: "border-l-purple",
  muted: "border-l-muted-foreground",
};
/* Current lifecycle step: a filled dot ringed with the soft tone. */
const stepCurrent: Record<Tone, string> = {
  green: "border-green bg-green inset-ring-4 inset-ring-green-bg",
  amber: "border-amber bg-amber inset-ring-4 inset-ring-amber-bg",
  red: "border-red bg-red inset-ring-4 inset-ring-red-bg",
  purple: "border-purple bg-purple inset-ring-4 inset-ring-purple-bg",
  muted:
    "border-muted-foreground bg-muted-foreground inset-ring-4 inset-ring-hover",
};
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
      className={cn(
        "rounded-xl border border-l-[3px] bg-surface p-4 md:px-5",
        toneBorder[tone],
        stack,
      )}
      aria-label="Task status"
    >
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3 md:flex-nowrap">
        <span
          className={cn(
            "grid size-[34px] flex-none place-items-center rounded-full",
            toneSoft[tone],
          )}
          aria-hidden="true"
        >
          <StatusDot tone={tone} pulse={active} className="size-2.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2
            role="status"
            className={cn("text-md font-semibold", toneText[tone])}
          >
            {title}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
            {detail}
          </p>
        </div>
        {run?.deadline && (
          <div className="grid w-full justify-items-start gap-1.5 md:w-auto md:justify-items-end">
            <span className="text-xs text-muted-foreground">
              {run.deadline.left > 0
                ? `${clock(run.deadline.left)} until deadline`
                : `${clock(-run.deadline.left)} past deadline`}
            </span>
            <Meter
              value={run.deadline.progress}
              tone={run.tone as Tone}
              size="full"
              className="md:w-[180px]"
            />
          </div>
        )}
      </div>
      <ol
        className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-2 border-t border-inset-border pt-3.5 text-xs text-muted-foreground md:pl-12"
        aria-label="Lifecycle"
      >
        {labels.map((s, i) => (
          <Fragment key={s.label}>
            {i > 0 && (
              <li
                className="h-[1.5px] min-w-4 flex-[0_1_48px] bg-border"
                aria-hidden="true"
              />
            )}
            <li
              className={cn(
                "inline-flex items-center gap-[7px] whitespace-nowrap",
                s.step === "current" && "font-medium text-foreground",
              )}
            >
              <span
                className={cn(
                  "grid size-[18px] place-items-center rounded-full border-[1.5px] border-border text-primary-foreground",
                  s.step === "done" && "border-green bg-green text-background",
                  s.step === "failed" && "border-red bg-red text-background",
                  s.step === "current" && stepCurrent[tone],
                )}
              >
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
