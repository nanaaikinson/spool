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
            </TableRow>
          ))}
      </TableBody>
    </Table>
  );
}
