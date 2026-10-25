import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { History, Repeat } from "lucide-react";
import { listSchedulerEventsOptions } from "../api/generated/@tanstack/react-query.gen";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DataError, Empty, Loading } from "../components/data-state";
import { Time } from "../components/time";
import type {
  Scheduler,
  ScheduleRef,
  TaskSummary,
} from "../api/generated/types.gen";
import { describeCron } from "../lib/cron";
import {
  clock,
  dueIn,
  relative,
  timeOfDay,
  useClock,
  useNow,
} from "../lib/time";
import { cn, date } from "../lib/utils";
const specCode =
  "justify-self-start rounded-[5px] border bg-hover px-1.5 py-px font-mono text-xs";
export function ScheduleSpec({ spec }: { spec: string }) {
  const text = describeCron(spec);
  return (
    <div className="grid gap-[3px]">
      <code className={specCode}>{spec}</code>
      <span className="text-xs text-muted-foreground">
        {text ?? "Custom cron expression"}
      </span>
    </div>
  );
}
/**
 * How a task is scheduled: the cron entry that enqueued it, or a one-off run.
 * Asynq links tasks to entries only through its recent enqueue history.
 */
export function TaskSchedule({ task }: { task: TaskSummary }) {
  const now = useClock();
  if (task.schedule) return <ScheduleSpec spec={task.schedule.spec} />;
  return (
    <div className="grid gap-[3px]">
      <code className={cn(specCode, "text-muted-foreground italic")}>
        one-off
      </code>
      <span className="text-xs text-muted-foreground">
        {task.next_process_at
          ? `Runs once, ${relative(task.next_process_at, now)}`
          : "Runs once"}
      </span>
    </div>
  );
}
/** Compact marker for tasks enqueued by a periodic entry. */
export function CronChip({ schedule }: { schedule: ScheduleRef }) {
  const text = describeCron(schedule.spec);
  return (
    <span
      className="mt-1.5 inline-flex max-w-full items-center gap-1.5 text-2xs text-purple"
      title={text ?? "Custom cron expression"}
      aria-label={`Periodic task, ${schedule.spec}${text ? `, ${text.toLowerCase()}` : ""}`}
    >
      <Repeat size={11} aria-hidden="true" />
      <code className="rounded-sm bg-purple-bg px-[5px] font-mono">
        {schedule.spec}
      </code>
      {text && <span className="truncate text-muted-foreground">{text}</span>}
    </span>
  );
}
/** Periodic entries with their cron spec, a plain-English reading and live countdowns. */
/** Asynq keeps the last enqueues of a live entry and drops them when its scheduler stops cleanly. */
function ScheduleHistory({ entry }: { entry: Scheduler }) {
  const [open, setOpen] = useState(false);
  const events = useQuery({
    ...listSchedulerEventsOptions({
      path: { id: entry.id },
      query: { limit: 50 },
    }),
    enabled: open,
  });
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Enqueue history for ${entry.type}`}
        onClick={() => setOpen(true)}
      >
        <History size={14} /> History
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Enqueue history <span className="font-mono">{entry.type}</span>
            </DialogTitle>
            <DialogDescription>
              The newest tasks this entry enqueued, from the scheduler&apos;s
              own record. It clears when the scheduler shuts down.
            </DialogDescription>
          </DialogHeader>
          {events.isPending ? (
            <Loading rows={4} />
          ) : events.error ? (
            <DataError error={events.error} retry={() => events.refetch()} />
          ) : !events.data.data.length ? (
            <Empty title="No enqueues recorded">
              This entry has not run yet, or its scheduler stopped and cleared
              the record.
            </Empty>
          ) : (
            <ul className="max-h-80 divide-y overflow-y-auto text-sm">
              {events.data.data.map((ev) => (
                <li
                  key={ev.task_id + ev.enqueued_at}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <Link
                    to="/tasks"
                    search={{ id: ev.task_id }}
                    className="min-w-0 truncate font-mono text-xs underline underline-offset-4"
                    onClick={() => setOpen(false)}
                  >
                    {ev.task_id}
                  </Link>
                  <span className="flex-none text-xs text-muted-foreground">
                    <Time value={ev.enqueued_at} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PeriodicTable({ data }: { data: Scheduler[] }) {
  const now = useNow(false);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Task type</TableHead>
          <TableHead>Schedule</TableHead>
          <TableHead>Next run</TableHead>
          <TableHead>Last run</TableHead>
          <TableHead>Entry ID</TableHead>
          <TableHead>
            <span className="sr-only">History</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {[...data]
          .sort((a, b) => a.next.localeCompare(b.next))
          .map((s) => (
            <TableRow key={s.id}>
              <TableCell className="font-mono">{s.type}</TableCell>
              <TableCell>
                <ScheduleSpec spec={s.spec} />
              </TableCell>
              <TableCell title={date(s.next)}>
                <div className="tabular-nums">{dueIn(s.next, now)}</div>
                <div className="text-muted-foreground text-xs">
                  {timeOfDay(s.next)}
                </div>
              </TableCell>
              <TableCell title={date(s.previous)}>
                {s.previous ? (
                  <>
                    <div className="tabular-nums">
                      {clock(now - Date.parse(s.previous))} ago
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {timeOfDay(s.previous)}
                    </div>
                  </>
                ) : (
                  <span className="text-muted-foreground">Not yet</span>
                )}
              </TableCell>
              <TableCell className="max-w-40 truncate font-mono text-xs text-muted-foreground">
                {s.id}
              </TableCell>
              <TableCell className="text-right">
                <ScheduleHistory entry={s} />
              </TableCell>
            </TableRow>
          ))}
      </TableBody>
    </Table>
  );
}
