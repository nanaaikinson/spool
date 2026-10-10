import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { listErrorGroupsOptions } from "../api/generated/@tanstack/react-query.gen";
import { Button } from "../components/ui/button";
import { DataError, Loading } from "../components/data-state";
import { InfoTip } from "../components/info-tip";
import { Time } from "../components/time";
import {
  Section,
  SectionBody,
  SectionHeader,
  cardX,
  dividedList,
  AllClear,
} from "../components/page";
import { number, plural } from "../lib/utils";
/** Retained failures grouped by task type and normalized error message. */
export function ErrorGroupsCard({
  limit,
  queue,
}: {
  limit: number;
  queue?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const query = useQuery({
    ...listErrorGroupsOptions({ query: { queue: queue || undefined } }),
    staleTime: 30_000,
  });
  const data = query.data;
  const groups = expanded ? data?.data : data?.data.slice(0, limit);
  return (
    <Section>
      <SectionHeader
        title="Top errors"
        info={
          <InfoTip label="How errors are grouped">
            Failures are grouped by task type and error message, with IDs,
            timestamps, addresses and long numbers removed so similar errors
            merge. Spool reads the newest failures in each queue rather than
            scanning all of Redis.
          </InfoTip>
        }
        description={
          data
            ? data.sampled < data.total
              ? `Newest ${number(data.sampled)} of ${number(data.total)} retained failures`
              : `All ${number(data.total)} retained failures`
            : "Grouped by task type and message"
        }
        action={
          <Link
            to="/failures"
            search={{ queue: queue ?? "" }}
            className="text-xs font-medium text-foreground"
          >
            All failures
          </Link>
        }
      />
      {query.isPending ? (
        <Loading rows={3} />
      ) : query.error && !data ? (
        <SectionBody>
          <DataError error={query.error} retry={() => query.refetch()} />
        </SectionBody>
      ) : !data?.data.length ? (
        <AllClear title="No retained failures">
          Nothing is waiting to retry or sitting in the archive
          {queue ? ` on ${queue}` : ""}.
        </AllClear>
      ) : (
        <>
          <ol className={dividedList}>
            {groups!.map((g) => (
              <li
                key={g.signature}
                className={cn(
                  "grid grid-cols-[56px_minmax(0,1fr)] gap-3 py-3.5",
                  cardX,
                )}
              >
                <div>
                  <strong className="block text-lg font-semibold tabular-nums">
                    {number(g.count)}
                  </strong>
                  <div
                    className="mt-1.5 h-1 overflow-hidden rounded-[2px] bg-hover"
                    aria-hidden="true"
                  >
                    <span
                      data-skeleton-hide
                      className="block h-full bg-red"
                      style={{
                        width: `${(g.count / Math.max(data.sampled, 1)) * 100}%`,
                      }}
                    />
                  </div>
                </div>
                <div className="grid min-w-0 gap-1">
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <Link
                      to="/failures"
                      search={{
                        type: g.type,
                        queue: g.queues.length === 1 ? g.queues[0] : "",
                      }}
                      className="font-mono font-medium text-foreground"
                    >
                      {g.type}
                    </Link>
                    <span className="text-muted-foreground text-xs">
                      {g.queues.length === 1
                        ? g.queues[0]
                        : plural(g.queues.length, "queue")}
                    </span>
                  </div>
                  <p
                    className="line-clamp-2 font-mono text-xs wrap-anywhere text-red"
                    title={g.error}
                  >
                    {g.pattern}
                  </p>
                  <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
                    {g.retry > 0 && <span>{number(g.retry)} retrying</span>}
                    {g.archived > 0 && (
                      <span>{number(g.archived)} archived</span>
                    )}
                    <span>
                      Last seen <Time value={g.last_seen} empty="unknown" />
                    </span>
                    <Link
                      to="/tasks/$queue/$id"
                      params={{ queue: g.sample.queue, id: g.sample.id }}
                      className="font-medium text-foreground"
                    >
                      Latest task
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {data.data.length > limit && (
            <div className="flex justify-center border-t border-inset-border p-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded
                  ? "Show fewer"
                  : `Show all ${number(data.data.length)} groups`}
              </Button>
            </div>
          )}
        </>
      )}
    </Section>
  );
}
