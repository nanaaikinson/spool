import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Repeat } from "lucide-react";
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
import { date } from "../lib/utils";
export function ScheduleSpec({ spec }: { spec: string }) {
  const text = describeCron(spec);
  return (
    <div className="schedule-spec">
      <code>{spec}</code>
      <span>{text ?? "Custom cron expression"}</span>
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
    <div className="schedule-spec">
      <code className="once">one-off</code>
      <span>
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
      className="cron-chip"
      title={text ?? "Custom cron expression"}
      aria-label={`Periodic task, ${schedule.spec}${text ? `, ${text.toLowerCase()}` : ""}`}
    >
      <Repeat size={11} aria-hidden="true" />
      <code>{schedule.spec}</code>
      {text && <span>{text}</span>}
    </span>
  );
}
/** Periodic entries with their cron spec, a plain-English reading and live countdowns. */
export function PeriodicTable({ data }: { data: Scheduler[] }) {
  const now = useNow(false);
  return (
    <div className="table-wrap">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Task type</TableHead>
            <TableHead>Schedule</TableHead>
            <TableHead>Next run</TableHead>
            <TableHead>Last run</TableHead>
            <TableHead>Entry ID</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...data]
            .sort((a, b) => a.next.localeCompare(b.next))
            .map((s) => (
              <TableRow key={s.id}>
                <TableCell className="mono">{s.type}</TableCell>
                <TableCell>
                  <ScheduleSpec spec={s.spec} />
                </TableCell>
                <TableCell title={date(s.next)}>
                  <div className="tabular">{dueIn(s.next, now)}</div>
                  <div className="muted small">{timeOfDay(s.next)}</div>
                </TableCell>
                <TableCell title={date(s.previous)}>
                  {s.previous ? (
                    <>
                      <div className="tabular">
                        {clock(now - Date.parse(s.previous))} ago
                      </div>
                      <div className="muted small">{timeOfDay(s.previous)}</div>
                    </>
                  ) : (
                    <span className="muted">Not yet</span>
                  )}
                </TableCell>
                <TableCell className="mono muted small entry-id">
                  {s.id}
                </TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </div>
  );
}
