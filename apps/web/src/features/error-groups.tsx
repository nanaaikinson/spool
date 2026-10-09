import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { listErrorGroupsOptions } from "../api/generated/@tanstack/react-query.gen";
import { Button } from "../components/ui/button";
import { DataError, Loading } from "../components/data-state";
import { InfoTip } from "../components/info-tip";
import { Time } from "../components/time";
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
    <Card className="section">
      <CardHeader className="section-heading">
        <div>
          <CardTitle>
            <h2 className="title-row">
              Top errors
              <InfoTip label="How errors are grouped">
                Failures are grouped by task type and error message, with IDs,
                timestamps, addresses and long numbers removed so similar errors
                merge. Spool reads the newest failures in each queue rather than
                scanning all of Redis.
              </InfoTip>
            </h2>
          </CardTitle>
          <p className="muted small">
            {data
              ? data.sampled < data.total
                ? `Newest ${number(data.sampled)} of ${number(data.total)} retained failures`
                : `All ${number(data.total)} retained failures`
              : "Grouped by task type and message"}
          </p>
        </div>
        <Link
          to="/failures"
          search={{ queue: queue ?? "" }}
          className="table-link small"
        >
          All failures
        </Link>
      </CardHeader>
      {query.isPending ? (
        <Loading rows={3} />
      ) : query.error && !data ? (
        <div className="section-body">
          <DataError error={query.error} retry={() => query.refetch()} />
        </div>
      ) : !data?.data.length ? (
        <div className="all-clear">
          <CircleCheck size={18} />
          <div>
            <strong>No retained failures</strong>
            <p className="muted small">
              Nothing is waiting to retry or sitting in the archive
              {queue ? ` on ${queue}` : ""}.
            </p>
          </div>
        </div>
      ) : (
        <>
          <ol className="error-groups">
            {groups!.map((g) => (
              <li key={g.signature}>
                <div className="error-count">
                  <strong>{number(g.count)}</strong>
                  <div className="error-share" aria-hidden="true">
                    <span
                      style={{
                        width: `${(g.count / Math.max(data.sampled, 1)) * 100}%`,
                      }}
                    />
                  </div>
                </div>
                <div className="error-body">
                  <div className="error-title">
                    <Link
                      to="/failures"
                      search={{
                        type: g.type,
                        queue: g.queues.length === 1 ? g.queues[0] : "",
                      }}
                      className="mono table-link"
                    >
                      {g.type}
                    </Link>
                    <span className="muted small">
                      {g.queues.length === 1
                        ? g.queues[0]
                        : plural(g.queues.length, "queue")}
                    </span>
                  </div>
                  <p className="error-pattern mono" title={g.error}>
                    {g.pattern}
                  </p>
                  <div className="error-meta muted small">
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
                      className="table-link"
                    >
                      Latest task
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {data.data.length > limit && (
            <div className="error-groups-more">
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
    </Card>
  );
}
