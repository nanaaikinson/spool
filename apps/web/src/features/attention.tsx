import { useState } from "react";
import { Link, type LinkProps } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import {
  listQueuesOptions,
  listSchedulersOptions,
  listServersOptions,
} from "../api/generated/@tanstack/react-query.gen";
import type { Queue, Scheduler, Server } from "../api/generated/types.gen";
import { Button } from "../components/ui/button";
import { DataError, Loading } from "../components/data-state";
import { InfoTip } from "../components/info-tip";
import { useClock } from "../lib/time";
import { duration, number, plural } from "../lib/utils";
import { useQueueTrends } from "./charts";
export const THRESHOLDS = {
  latencyWarnSeconds: 60,
  latencyCriticalSeconds: 300,
  failureWarnRatio: 0.1,
  failureCriticalRatio: 0.5,
  /** Below this many attempts today a failure ratio is too noisy to flag. */
  failureMinAttempts: 20,
  scheduleGraceMs: 2 * 60_000,
};
export type Issue = {
  id: string;
  severity: "critical" | "warning";
  title: string;
  detail: string;
  link: Pick<LinkProps, "to" | "params" | "search">;
};
/** Pure rules so they can be tested without rendering. */
export function findIssues({
  queues,
  servers,
  schedulers,
  archivedTrend,
  now,
}: {
  queues: Queue[];
  servers: Server[];
  schedulers: Scheduler[];
  archivedTrend: Map<string, number[]>;
  now: number;
}): Issue[] {
  const issues: Issue[] = [];
  const waiting = (q: Queue) => q.pending + q.retry + q.scheduled;
  const backlog = queues.reduce((n, q) => n + waiting(q), 0);
  if (!servers.length && backlog > 0)
    issues.push({
      id: "no-servers",
      severity: "critical",
      title: "No Asynq servers are running",
      detail: `${plural(backlog, "task")} are waiting with nothing to process them.`,
      link: { to: "/workers" },
    });
  for (const q of queues) {
    const queueLink = {
      to: "/queues/$queue",
      params: { queue: q.name },
    } as const;
    if (
      servers.length &&
      !q.paused &&
      waiting(q) > 0 &&
      !servers.some((s) => q.name in s.queues)
    )
      issues.push({
        id: `unconsumed-${q.name}`,
        severity: "critical",
        title: `Nothing processes ${q.name}`,
        detail: `${plural(waiting(q), "task")} waiting, but no running server lists this queue in its configuration.`,
        link: queueLink,
      });
    if (q.paused && q.pending > 0)
      issues.push({
        id: `paused-${q.name}`,
        severity: "warning",
        title: `${q.name} is paused`,
        detail: `${plural(q.pending, "task")} waiting until it resumes.`,
        link: queueLink,
      });
    if (!q.paused && q.latency_seconds >= THRESHOLDS.latencyWarnSeconds)
      issues.push({
        id: `latency-${q.name}`,
        severity:
          q.latency_seconds >= THRESHOLDS.latencyCriticalSeconds
            ? "critical"
            : "warning",
        title: `${q.name}: oldest task waiting ${duration(q.latency_seconds)}`,
        detail: "Work is arriving faster than it is processed.",
        link: queueLink,
      });
    const ratio = q.processed ? q.failed / q.processed : 0;
    if (
      q.processed >= THRESHOLDS.failureMinAttempts &&
      ratio >= THRESHOLDS.failureWarnRatio
    )
      issues.push({
        id: `failing-${q.name}`,
        severity:
          ratio >= THRESHOLDS.failureCriticalRatio ? "critical" : "warning",
        title: `${q.name}: ${number(ratio * 100)}% of attempts failing today`,
        detail: `${number(q.failed)} of ${number(q.processed)} attempts failed.`,
        link: { to: "/failures", search: { queue: q.name } },
      });
    const trend = archivedTrend.get(q.name);
    const growth =
      trend && trend.length > 1 ? trend[trend.length - 1] - trend[0] : 0;
    if (growth > 0)
      issues.push({
        id: `archived-${q.name}`,
        severity: "warning",
        title: `${q.name}: ${number(growth)} more archived in the last hour`,
        detail: "These tasks used up their retries and will not run again.",
        link: { to: "/failures", search: { queue: q.name } },
      });
  }
  for (const s of servers)
    if (s.concurrency > 0 && s.workers.length >= s.concurrency)
      issues.push({
        id: `capacity-${s.id}`,
        severity: "warning",
        title: `${s.host} is at capacity`,
        detail: `All ${s.concurrency} worker slots are busy; new tasks queue up behind them.`,
        link: { to: "/live" },
      });
  for (const s of schedulers) {
    const overdue = now - Date.parse(s.next);
    if (overdue > THRESHOLDS.scheduleGraceMs)
      issues.push({
        id: `schedule-${s.id}`,
        severity: "warning",
        title: `Schedule for ${s.type} is overdue`,
        detail: `Expected to run ${duration(overdue / 1000)} ago (${s.spec}). The scheduler may have stopped.`,
        link: { to: "/schedulers" },
      });
  }
  return issues.sort(
    (a, b) =>
      Number(b.severity === "critical") - Number(a.severity === "critical"),
  );
}
const VISIBLE = 6;
export function NeedsAttention() {
  const queues = useQuery(listQueuesOptions());
  const servers = useQuery(listServersOptions());
  const schedulers = useQuery(listSchedulersOptions());
  const archivedTrend = useQueueTrends("archived");
  const now = useClock();
  const [expanded, setExpanded] = useState(false);
  const pending = queues.isPending || servers.isPending || schedulers.isPending;
  const error =
    (!queues.data && queues.error) || (!servers.data && servers.error);
  const issues =
    queues.data && servers.data
      ? findIssues({
          queues: queues.data.data,
          servers: servers.data.data,
          schedulers: schedulers.data?.data ?? [],
          archivedTrend,
          now,
        })
      : [];
  const visible = expanded ? issues : issues.slice(0, VISIBLE);
  const critical = issues.filter((i) => i.severity === "critical").length;
  return (
    <Card className="section">
      <CardHeader className="section-heading">
        <div>
          <CardTitle>
            <h2 className="title-row">
              Needs attention
              <InfoTip label="What is checked">
                Queues nothing processes, paused queues with work waiting, slow
                queues (oldest task over {THRESHOLDS.latencyWarnSeconds}s),
                failure rates over {THRESHOLDS.failureWarnRatio * 100}% today,
                archive growth in the last hour, servers at capacity, and
                overdue periodic schedules.
              </InfoTip>
            </h2>
          </CardTitle>
          <p className="muted small">
            {pending
              ? "Checking queues, servers and schedules"
              : issues.length
                ? `${plural(critical, "critical issue")} · ${plural(issues.length - critical, "warning")}`
                : "Queues, servers and schedules look healthy"}
          </p>
        </div>
      </CardHeader>
      {pending ? (
        <Loading rows={3} />
      ) : error ? (
        <div className="section-body">
          <DataError
            error={error}
            retry={() => {
              queues.refetch();
              servers.refetch();
            }}
          />
        </div>
      ) : !issues.length ? (
        <div className="all-clear">
          <CircleCheck size={18} />
          <div>
            <strong>All clear</strong>
            <p className="muted small">
              Every queue has a server, nothing is slow or failing heavily, and
              schedules are on time.
            </p>
          </div>
        </div>
      ) : (
        <>
          <ul className="issues">
            {visible.map((issue) => (
              <li key={issue.id} data-severity={issue.severity}>
                {issue.severity === "critical" ? (
                  <CircleAlert size={16} aria-label="Critical" />
                ) : (
                  <TriangleAlert size={16} aria-label="Warning" />
                )}
                <Link {...issue.link} className="issue-link">
                  <strong>{issue.title}</strong>
                  <span className="muted small">{issue.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
          {issues.length > VISIBLE && (
            <div className="error-groups-more">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded
                  ? "Show fewer"
                  : `Show ${issues.length - VISIBLE} more`}
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
